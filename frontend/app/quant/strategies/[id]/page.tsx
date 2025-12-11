'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { quantApi, watchlistApi, quoteApi } from '@/lib/api';
import AppLayout from '@/components/AppLayout';
import EditStrategyModal from '@/components/EditStrategyModal';
import { Card, Table, Tag, Space, Button, Alert, Spin, Row, Col, Descriptions, Modal, message, Typography } from 'antd';

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

