'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { quantApi, watchlistApi, quoteApi } from '@/lib/api';
import AppLayout from '@/components/AppLayout';
import EditStrategyModal from '@/components/EditStrategyModal';
import { Card, Table, Tag, Space, Button, Alert, Spin, Row, Col, Descriptions, Modal, message, Typography, Collapse, InputNumber } from 'antd';

interface Strategy {
  id: number;
  name: string;
  type: string;
  capitalAllocationId: number | null;
  allocationName: string | null;
  symbolPoolConfig: any;
  config: any;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface StrategyInstance {
  symbol: string;
  currentState: string;
  context: any;
  lastUpdated: string;
}

interface InstanceWithDetails extends StrategyInstance {
  entryPrice?: number;
  quantity?: number;
  stopLoss?: number;
  takeProfit?: number;
  entryTime?: string;
  currentPrice?: number;
  pnl?: number;
  pnlPercent?: number;
  marketValue?: number;
  holdingDuration?: string;
}

export default function StrategyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const strategyId = parseInt(params.id as string);

  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [instances, setInstances] = useState<InstanceWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [pricesLoading, setPricesLoading] = useState(false);

  // 相关性分组
  const [corrThreshold, setCorrThreshold] = useState(0.75);
  const [corrDays, setCorrDays] = useState(60);
  const [corrComputing, setCorrComputing] = useState(false);

  useEffect(() => {
    if (strategyId) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [strategyRes, instancesRes] = await Promise.all([
        quantApi.getStrategy(strategyId),
        quantApi.getStrategyInstances(strategyId),
      ]);

      if (strategyRes.success) {
        setStrategy(strategyRes.data);
      } else {
        setError('加载策略详情失败');
      }

      if (instancesRes.success) {
        const instancesData = instancesRes.data || [];
        // 处理实例数据，提取context中的信息
        const processedInstances = instancesData.map((instance: StrategyInstance) => {
          const context = instance.context || {};
          const entryPrice = context.entryPrice;
          const quantity = context.quantity;
          const stopLoss = context.stopLoss || context.currentStopLoss;
          const takeProfit = context.takeProfit || context.currentTakeProfit;
          const entryTime = context.entryTime || instance.lastUpdated;
          
          // 计算持仓时长
          let holdingDuration = '-';
          if (entryTime) {
            const entryDate = new Date(entryTime);
            const now = new Date();
            const diffMs = now.getTime() - entryDate.getTime();
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            if (diffDays > 0) {
              holdingDuration = `${diffDays}天${diffHours > 0 ? diffHours + '小时' : ''}`;
            } else if (diffHours > 0) {
              holdingDuration = `${diffHours}小时`;
            } else {
              const diffMinutes = Math.floor(diffMs / (1000 * 60));
              holdingDuration = diffMinutes > 0 ? `${diffMinutes}分钟` : '刚刚';
            }
          }
          
          return {
            ...instance,
            entryPrice,
            quantity,
            stopLoss,
            takeProfit,
            entryTime,
            holdingDuration,
          } as InstanceWithDetails;
        });
        
        setInstances(processedInstances);
        
        // 异步加载当前价格
        loadCurrentPrices(processedInstances);
      }
    } catch (err: any) {
      setError(err.message || '加载策略详情失败');
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentPrices = async (instances: InstanceWithDetails[]) => {
    const holdingInstances = instances.filter(i => i.currentState === 'HOLDING' && i.symbol);
    if (holdingInstances.length === 0) return;
    
    try {
      setPricesLoading(true);
      const symbols = holdingInstances.map(i => i.symbol);
      const quoteRes = await quoteApi.getQuote(symbols);
      
      if (quoteRes.success && quoteRes.data) {
        const quotes = Array.isArray(quoteRes.data) ? quoteRes.data : [quoteRes.data];
        const priceMap: Record<string, number> = {};
        
        quotes.forEach((quote: any) => {
          const symbol = quote.symbol || quote.code;
          const price = parseFloat(quote.lastPrice || quote.price || '0');
          if (symbol && price > 0) {
            priceMap[symbol] = price;
          }
        });
        
        // 更新实例的当前价格和盈亏
        setInstances(prev => prev.map(instance => {
          if (instance.currentState === 'HOLDING' && priceMap[instance.symbol]) {
            const currentPrice = priceMap[instance.symbol];
            const entryPrice = instance.entryPrice || 0;
            const quantity = instance.quantity || 0;
            const pnl = entryPrice > 0 && quantity > 0 
              ? (currentPrice - entryPrice) * quantity 
              : 0;
            const pnlPercent = entryPrice > 0 
              ? ((currentPrice - entryPrice) / entryPrice) * 100 
              : 0;
            const marketValue = currentPrice * quantity;
            
            return {
              ...instance,
              currentPrice,
              pnl,
              pnlPercent,
              marketValue,
            };
          }
          return instance;
        }));
      }
    } catch (err) {
      console.error('加载当前价格失败:', err);
    } finally {
      setPricesLoading(false);
    }
  };

  const handleStart = async () => {
    try {
      await quantApi.startStrategy(strategyId);
      message.success('策略已启动');
      await loadData();
    } catch (err: any) {
      message.error(err.message || '启动策略失败');
    }
  };

  const handleStop = async () => {
    Modal.confirm({
      title: '确认停止',
      content: '确定要停止该策略吗？',
      onOk: async () => {
        try {
          await quantApi.stopStrategy(strategyId);
          message.success('策略已停止');
          await loadData();
        } catch (err: any) {
          message.error(err.message || '停止策略失败');
        }
      },
    });
  };

  const handleDelete = async () => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除该策略吗？此操作不可恢复！',
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        try {
          await quantApi.deleteStrategy(strategyId);
          message.success('策略已删除');
          router.push('/quant/strategies');
        } catch (err: any) {
          message.error(err.message || '删除策略失败');
        }
      },
    });
  };

  const handleComputeCorrelation = async () => {
    try {
      setCorrComputing(true);
      const res = await quantApi.computeCorrelationGroups(strategyId, {
        threshold: corrThreshold,
        days: corrDays,
      });
      if (res.success) {
        message.success(`分组计算完成，共 ${res.data?.symbolCount} 个标的`);
        await loadData(); // 重新加载策略数据以获取最新 config
      } else {
        message.error(res.error?.message || '计算失败');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '计算失败';
      message.error(errMsg);
    } finally {
      setCorrComputing(false);
    }
  };

  const getStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      RUNNING: { color: 'success', text: '🟢 运行中' },
      STOPPED: { color: 'default', text: '⚪ 已停止' },
      ERROR: { color: 'error', text: '🔴 错误' },
      PAUSED: { color: 'warning', text: '🟡 已暂停' },
    };
    const config = statusMap[status] || { color: 'default', text: status };
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  const getInstanceStateTag = (state: string) => {
    const stateMap: Record<string, { color: string; text: string }> = {
      HOLDING: { color: 'success', text: '🟢 持仓中' },
      OPENING: { color: 'warning', text: '🟡 买入中' },
      CLOSING: { color: 'warning', text: '🟡 卖出中' },
      IDLE: { color: 'default', text: '⚪ 空闲' },
    };
    const config = stateMap[state] || { color: 'default', text: state };
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  if (loading) {
    return (
      <AppLayout>
        <Card>
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>加载中...</div>
          </div>
        </Card>
      </AppLayout>
    );
  }

  if (error || !strategy) {
    return (
      <AppLayout>
        <Alert
          message={error || '策略不存在'}
          type="error"
          showIcon
        />
      </AppLayout>
    );
  }

  const hasHoldingInstances = instances.some(i => i.currentState === 'HOLDING');
  
  const baseColumns = [
    {
      title: '标的',
      key: 'symbol',
      dataIndex: 'symbol',
      render: (text: string) => <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{text}</span>,
    },
    {
      title: '状态',
      key: 'currentState',
      dataIndex: 'currentState',
      render: (state: string) => getInstanceStateTag(state || 'HOLDING'),
    },
  ];

  const holdingColumns = hasHoldingInstances ? [
    {
      title: '持仓价格',
      key: 'entryPrice',
      render: (_: any, record: InstanceWithDetails) =>
        record.entryPrice && record.quantity ? `$${record.entryPrice.toFixed(2)}` : '-',
    },
    {
      title: '当前价格',
      key: 'currentPrice',
      render: (_: any, record: InstanceWithDetails) => {
        if (record.currentState === 'HOLDING') {
          return record.currentPrice ? `$${record.currentPrice.toFixed(2)}` : '加载中...';
        }
        return '-';
      },
    },
    {
      title: '盈亏',
      key: 'pnl',
      render: (_: any, record: InstanceWithDetails) => {
        if (record.pnl !== undefined && record.pnlPercent !== undefined) {
          return (
            <div style={{ color: record.pnl >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
              {record.pnl >= 0 ? '+' : ''}${record.pnl.toFixed(2)}
              <span style={{ marginLeft: 4, fontSize: 12 }}>
                ({record.pnlPercent >= 0 ? '+' : ''}{record.pnlPercent.toFixed(2)}%)
              </span>
            </div>
          );
        }
        return <span style={{ color: '#999' }}>-</span>;
      },
    },
    {
      title: '数量',
      key: 'quantity',
      render: (_: any, record: InstanceWithDetails) =>
        record.entryPrice && record.quantity ? record.quantity : '-',
    },
    {
      title: '市值',
      key: 'marketValue',
      render: (_: any, record: InstanceWithDetails) =>
        record.marketValue ? `$${record.marketValue.toFixed(2)}` : '-',
    },
    {
      title: '入场时间',
      key: 'entryTime',
      render: (_: any, record: InstanceWithDetails) =>
        record.entryTime ? new Date(record.entryTime).toLocaleString('zh-CN') : '-',
    },
    {
      title: '持仓时长',
      key: 'holdingDuration',
      dataIndex: 'holdingDuration',
      render: (text: string) => text || '-',
    },
  ] : [];

  const instanceColumns = [
    ...baseColumns,
    ...holdingColumns,
    {
      title: '最后更新',
      key: 'lastUpdated',
      dataIndex: 'lastUpdated',
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
    },
  ];

  return (
    <AppLayout>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Typography.Title level={2} style={{ margin: 0 }}>{strategy.name}</Typography.Title>
          <Space>
            {strategy.status === 'STOPPED' && (
              <Button type="primary" style={{ background: '#52c41a', borderColor: '#52c41a' }} onClick={handleStart}>
                启动策略
              </Button>
            )}
            {strategy.status === 'RUNNING' && (
              <Button danger onClick={handleStop}>
                停止策略
              </Button>
            )}
            {strategy.status === 'STOPPED' && (
              <Button type="primary" onClick={() => setShowEditModal(true)}>
                编辑
              </Button>
            )}
            <Button danger onClick={handleDelete}>
              删除
            </Button>
          </Space>
        </div>

        <Card style={{ marginBottom: 16 }}>
          <Typography.Title level={4} style={{ marginBottom: 16 }}>基本信息</Typography.Title>
          <Descriptions column={2} bordered>
            <Descriptions.Item label="策略ID">{strategy.id}</Descriptions.Item>
            <Descriptions.Item label="策略类型">{strategy.type}</Descriptions.Item>
            <Descriptions.Item label="状态">{getStatusTag(strategy.status)}</Descriptions.Item>
            <Descriptions.Item label="资金分配">{strategy.allocationName || '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{new Date(strategy.createdAt).toLocaleString('zh-CN')}</Descriptions.Item>
            <Descriptions.Item label="更新时间">{new Date(strategy.updatedAt).toLocaleString('zh-CN')}</Descriptions.Item>
          </Descriptions>
        </Card>

        <Card style={{ marginBottom: 16 }}>
          <Typography.Title level={4} style={{ marginBottom: 16 }}>标的池配置</Typography.Title>
          <Descriptions column={1} bordered>
            <Descriptions.Item label="模式">
              {strategy.symbolPoolConfig?.mode === 'INSTITUTION' ? '机构选股' : '静态列表'}
            </Descriptions.Item>
            <Descriptions.Item label="股票数量">
              {Array.isArray(strategy.symbolPoolConfig?.symbols) 
                ? strategy.symbolPoolConfig.symbols.length 
                : 0}只
            </Descriptions.Item>
            {Array.isArray(strategy.symbolPoolConfig?.symbols) && strategy.symbolPoolConfig.symbols.length > 0 && (
              <Descriptions.Item label="股票列表">
                <Space wrap>
                  {strategy.symbolPoolConfig.symbols.map((symbol: string) => (
                    <Tag key={symbol} color="blue">{symbol}</Tag>
                  ))}
                </Space>
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>

        <Card style={{ marginBottom: 16 }}>
          <Typography.Title level={4} style={{ marginBottom: 16 }}>策略参数配置</Typography.Title>
          <Descriptions column={3} bordered>
            <Descriptions.Item label="ATR周期">{strategy.config?.atrPeriod || 14}天</Descriptions.Item>
            <Descriptions.Item label="ATR倍数">{strategy.config?.atrMultiplier || 2.0}</Descriptions.Item>
            <Descriptions.Item label="风险收益比">{strategy.config?.riskRewardRatio || 1.5}</Descriptions.Item>
          </Descriptions>
          <Alert
            message="💡 参数说明"
            description={
              <div>
                <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                  <li><strong>ATR周期</strong>：计算平均真实波幅的周期，默认14天。周期越长，ATR值越平滑但反应越慢。</li>
                  <li><strong>ATR倍数</strong>：用于计算止损距离的倍数，默认2.0。倍数越大，止损距离越远，风险越小但可能错过更多机会。</li>
                  <li><strong>风险收益比</strong>：止盈价格与止损价格的比例，默认1.5。比例越大，潜在收益越高，但需要更强的趋势支持。</li>
                </ul>
                <p style={{ marginTop: 8, marginBottom: 0 }}>
                  <strong>计算公式：</strong>止损价 = 入场价 - (ATR × ATR倍数)，止盈价 = 入场价 + (止损距离 × 风险收益比)
                </p>
              </div>
            }
            type="info"
            showIcon
            style={{ marginTop: 16 }}
          />
        </Card>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Typography.Title level={4} style={{ margin: 0 }}>策略实例 ({instances.length})</Typography.Title>
            {pricesLoading && (
              <span style={{ fontSize: 12, color: '#999' }}>正在加载价格...</span>
            )}
          </div>
          <Table
            dataSource={instances}
            columns={instanceColumns}
            rowKey="symbol"
            locale={{
              emptyText: '暂无实例',
            }}
          />
        </Card>

        {/* R5v2: 相关性分组 */}
        {strategy.type === 'OPTION_INTRADAY_V1' && (
          <Card style={{ marginTop: 16 }}>
            <Collapse
              ghost
              items={[{
                key: 'correlation',
                label: <Typography.Title level={4} style={{ margin: 0 }}>相关性分组</Typography.Title>,
                children: (
                  <div>
                    {/* 参数 + 计算按钮 */}
                    <Space style={{ marginBottom: 16 }} wrap>
                      <span>相关系数阈值:</span>
                      <InputNumber
                        value={corrThreshold}
                        onChange={(v) => v !== null && setCorrThreshold(v)}
                        min={0.5}
                        max={1.0}
                        step={0.05}
                        style={{ width: 100 }}
                      />
                      <span>历史天数:</span>
                      <InputNumber
                        value={corrDays}
                        onChange={(v) => v !== null && setCorrDays(v)}
                        min={20}
                        max={250}
                        step={10}
                        style={{ width: 80 }}
                      />
                      <Button
                        type="primary"
                        loading={corrComputing}
                        onClick={handleComputeCorrelation}
                      >
                        {corrComputing ? '计算中...' : '计算分组'}
                      </Button>
                    </Space>

                    {/* 已有分组结果展示 */}
                    {strategy.config?.correlationGroups ? (() => {
                      const cg = strategy.config.correlationGroups;
                      const groups: Record<string, string[]> = cg.groups || {};
                      const matrix: Record<string, number> = cg.matrix || {};

                      // 构建矩阵表格数据
                      const allSymbols = Array.from(
                        new Set(Object.values(groups).flat())
                      ).sort();
                      const matrixRows = allSymbols.map((sym) => {
                        const row: Record<string, string | number> = { symbol: sym };
                        for (const other of allSymbols) {
                          if (sym === other) {
                            row[other] = 1;
                          } else {
                            const key1 = `${sym}|${other}`;
                            const key2 = `${other}|${sym}`;
                            row[other] = matrix[key1] ?? matrix[key2] ?? '-';
                          }
                        }
                        return row;
                      });

                      const matrixColumns = [
                        {
                          title: '',
                          dataIndex: 'symbol',
                          key: 'symbol',
                          fixed: 'left' as const,
                          width: 100,
                          render: (t: string) => <strong>{t.replace('.US', '')}</strong>,
                        },
                        ...allSymbols.map((sym) => ({
                          title: sym.replace('.US', ''),
                          dataIndex: sym,
                          key: sym,
                          width: 80,
                          render: (val: string | number) => {
                            if (val === '-') return <span style={{ color: '#ccc' }}>-</span>;
                            const n = typeof val === 'number' ? val : parseFloat(String(val));
                            if (isNaN(n)) return '-';
                            const abs = Math.abs(n);
                            let color = '#333';
                            let bg = 'transparent';
                            if (n === 1) {
                              color = '#999';
                              bg = '#f5f5f5';
                            } else if (abs >= (cg.threshold || 0.75)) {
                              color = '#fff';
                              bg = '#ff4d4f';
                            } else if (abs >= 0.5) {
                              color = '#333';
                              bg = '#fff7e6';
                            }
                            return (
                              <span style={{
                                color,
                                background: bg,
                                padding: '2px 6px',
                                borderRadius: 3,
                                fontFamily: 'monospace',
                                fontSize: 12,
                              }}>
                                {n === 1 ? '1.00' : n.toFixed(2)}
                              </span>
                            );
                          },
                        })),
                      ];

                      return (
                        <div>
                          <Descriptions column={3} size="small" style={{ marginBottom: 16 }}>
                            <Descriptions.Item label="阈值">{cg.threshold}</Descriptions.Item>
                            <Descriptions.Item label="天数">{cg.days}</Descriptions.Item>
                            <Descriptions.Item label="计算时间">
                              {cg.calculatedAt ? new Date(cg.calculatedAt).toLocaleString('zh-CN') : '-'}
                            </Descriptions.Item>
                          </Descriptions>

                          <Typography.Title level={5}>分组结果</Typography.Title>
                          <Space wrap style={{ marginBottom: 16 }}>
                            {Object.entries(groups).map(([groupName, members]) => (
                              <Tag
                                key={groupName}
                                color={members.length > 1 ? 'volcano' : 'default'}
                                style={{ padding: '4px 8px' }}
                              >
                                <strong>{groupName}:</strong>{' '}
                                {(members as string[]).map((s: string) => s.replace('.US', '')).join(', ')}
                              </Tag>
                            ))}
                          </Space>

                          {allSymbols.length > 1 && (
                            <>
                              <Typography.Title level={5}>相关性矩阵</Typography.Title>
                              <Table
                                dataSource={matrixRows}
                                columns={matrixColumns}
                                rowKey="symbol"
                                pagination={false}
                                size="small"
                                bordered
                                scroll={{ x: 100 + allSymbols.length * 80 }}
                              />
                            </>
                          )}
                        </div>
                      );
                    })() : (
                      <Alert
                        message="尚未计算相关性分组"
                        description="点击上方「计算分组」按钮，根据标的池的日K收盘价自动计算 Pearson 相关系数并分组。"
                        type="info"
                        showIcon
                      />
                    )}
                  </div>
                ),
              }]}
            />
          </Card>
        )}
      </Card>

      {showEditModal && strategy && (
        <EditStrategyModal
          strategy={strategy}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false);
            loadData();
          }}
        />
      )}
    </AppLayout>
  );
}

