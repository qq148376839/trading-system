'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { backtestApi, quantApi, optionBacktestApi, tradingDaysApi } from '@/lib/api';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import { DatePicker, Button, Table, Card, Space, Modal, message, Alert, Tag, Spin, Select, Checkbox, Row, Col, Tabs, InputNumber, Input, Typography } from 'antd';
const { Text } = Typography;
import { useIsMobile } from '@/hooks/useIsMobile';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface Strategy {
  id: number;
  name: string;
  type: string;
  status: string;
  symbolPoolConfig?: {
    mode?: string;
    symbols?: string[];
  };
}

interface BacktestResult {
  id: number;
  strategyId: number;
  startDate: string;
  endDate: string;
  status?: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  totalReturn?: number;
  totalTrades?: number;
  winningTrades?: number;
  losingTrades?: number;
  winRate?: number;
  avgReturn?: number;
  maxDrawdown?: number;
  sharpeRatio?: number;
  avgHoldingTime?: number;
  created_at?: string;
  dailyReturns?: Array<{ date: string; return: number; equity: number }>;
}

export default function BacktestPage() {
  const isMobile = useIsMobile();
  const router = useRouter();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [backtestResults, setBacktestResults] = useState<BacktestResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRunModal, setShowRunModal] = useState(false);
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [backtestDateRange, setBacktestDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [running, setRunning] = useState(false);
  const [filterStrategyId, setFilterStrategyId] = useState<number | null>(null);
  const [filterDateRange, setFilterDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<number[]>([]);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [pollingTasks, setPollingTasks] = useState<Set<number>>(new Set());

  useEffect(() => {
    loadData();
  }, []);

  // 页面加载时检查是否有进行中的任务，开始轮询
  useEffect(() => {
    const pendingTasks = backtestResults.filter(
      r => r.status === 'PENDING' || r.status === 'RUNNING'
    );
    pendingTasks.forEach(task => {
      if (!pollingTasks.has(task.id)) {
        startPolling(task.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backtestResults.length]); // 只在结果列表变化时检查

  const loadData = async () => {
    try {
      setLoading(true);
      const [strategiesRes, resultsRes] = await Promise.all([
        quantApi.getStrategies(),
        backtestApi.getBacktestResultsByStrategy(0).catch(() => ({ success: false, data: [] })),
      ]);

      if (strategiesRes.success) {
        setStrategies(strategiesRes.data || []);
        
        // 加载所有策略的回测结果
        if (strategiesRes.data && strategiesRes.data.length > 0) {
          const allResults: BacktestResult[] = [];
          for (const strategy of strategiesRes.data) {
            try {
              const res = await backtestApi.getBacktestResultsByStrategy(strategy.id);
              if (res.success && res.data) {
                allResults.push(...res.data);
              }
            } catch (err) {
              // 忽略错误
            }
          }
          setBacktestResults(allResults.sort((a, b) => {
            const dateA = new Date(a.created_at || a.startDate).getTime();
            const dateB = new Date(b.created_at || b.startDate).getTime();
            return dateB - dateA;
          }));
        }
      }
    } catch (err: any) {
      setError(err.message || '加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleStrategyChange = async (strategyId: number) => {
    setSelectedStrategyId(strategyId);
    setSelectedSymbols([]);
    
    if (strategyId) {
      try {
        const strategyRes = await quantApi.getStrategy(strategyId);
        if (strategyRes.success && strategyRes.data) {
          const strategy = strategyRes.data;
          setSelectedStrategy(strategy);
          
          // 从策略配置中提取标的代码
          const symbols = strategy.symbolPoolConfig?.symbols || [];
          setAvailableSymbols(symbols);
          
          // 默认全选
          if (symbols.length > 0) {
            setSelectedSymbols(symbols);
          }
        }
      } catch (err: any) {
        console.error('加载策略详情失败:', err);
        setAvailableSymbols([]);
      }
    } else {
      setSelectedStrategy(null);
      setAvailableSymbols([]);
    }
  };

  const handleRunBacktest = async () => {
    if (!selectedStrategyId || selectedSymbols.length === 0 || !backtestDateRange || !backtestDateRange[0] || !backtestDateRange[1]) {
      message.warning('请填写所有必填字段');
      return;
    }

    const startDate = backtestDateRange[0].format('YYYY-MM-DD');
    const endDate = backtestDateRange[1].format('YYYY-MM-DD');

    try {
      setRunning(true);
      const response = await backtestApi.runBacktest({
        strategyId: selectedStrategyId,
        symbols: selectedSymbols,
        startDate,
        endDate,
      });

      if (response.success && response.data?.id) {
        message.success('回测任务已创建，正在后台执行...');
        setShowRunModal(false);
        // 重置表单
        setSelectedStrategyId(null);
        setSelectedSymbols([]);
        setBacktestDateRange(null);
        
        // 开始轮询状态
        startPolling(response.data.id);
        
        // 刷新列表
        await loadData();
      } else {
        const errorMsg = typeof response.error === 'string' ? response.error : response.error?.message || '创建回测任务失败';
        message.error(errorMsg);
      }
    } catch (err: any) {
      message.error(err.message || '创建回测任务失败');
    } finally {
      setRunning(false);
    }
  };

  // 轮询回测状态
  const startPolling = (taskId: number) => {
    if (pollingTasks.has(taskId)) {
      return; // 已经在轮询中
    }

    setPollingTasks(prev => new Set(prev).add(taskId));
    
    const pollInterval = setInterval(async () => {
      try {
        const statusRes = await backtestApi.getBacktestStatus(taskId);
        if (statusRes.success && statusRes.data) {
          const status = statusRes.data.status;
          
          if (status === 'COMPLETED') {
            clearInterval(pollInterval);
            setPollingTasks(prev => {
              const newSet = new Set(prev);
              newSet.delete(taskId);
              return newSet;
            });
            // 刷新列表
            await loadData();
            message.success('回测完成！');
          } else if (status === 'FAILED') {
            clearInterval(pollInterval);
            setPollingTasks(prev => {
              const newSet = new Set(prev);
              newSet.delete(taskId);
              return newSet;
            });
            // 刷新列表
            await loadData();
            message.error(`回测失败: ${statusRes.data.errorMessage || '未知错误'}`);
          }
          // PENDING 和 RUNNING 状态继续轮询
        }
      } catch (err) {
        console.error('轮询回测状态失败:', err);
        // 继续轮询，不中断
      }
    }, 2000); // 每2秒轮询一次

    // 30分钟后停止轮询（防止无限轮询）
    setTimeout(() => {
      clearInterval(pollInterval);
      setPollingTasks(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    }, 30 * 60 * 1000);
  };

  // 重试失败的回测
  const handleRetry = async (result: BacktestResult) => {
    Modal.confirm({
      title: '确认重试',
      content: '确定要重试这个回测任务吗？',
      onOk: async () => {
        try {
          // 需要获取标的代码，这里假设从策略配置中获取
          // 实际应该从数据库或配置中获取
          const strategyRes = await quantApi.getStrategy(result.strategyId);
          if (strategyRes.success && strategyRes.data) {
            const symbols = strategyRes.data.symbolPoolConfig?.symbols || [];
            if (symbols.length === 0) {
              message.error('无法获取标的代码，请手动重试');
              return;
            }

            const retryRes = await backtestApi.retryBacktest(result.id, symbols);
            if (retryRes.success) {
              message.success('回测任务已重新开始执行');
              startPolling(result.id);
              await loadData();
            } else {
              const errorMsg = typeof retryRes.error === 'string' ? retryRes.error : retryRes.error?.message || '重试失败';
              message.error(errorMsg);
            }
          }
        } catch (err: any) {
          message.error(err.message || '重试失败');
        }
      },
    });
  };

  // 删除回测结果
  const handleDelete = async (id: number) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个回测结果吗？此操作不可恢复。',
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        try {
          const response = await backtestApi.deleteBacktestResult(id);
          if (response.success) {
            message.success('回测结果已删除');
            await loadData();
          } else {
            const errorMsg = typeof response.error === 'string' ? response.error : response.error?.message || '删除失败';
            message.error(errorMsg);
          }
        } catch (err: any) {
          message.error(err.message || '删除失败');
        }
      },
    });
  };

  // 批量删除回测结果
  const handleBatchDelete = async () => {
    if (selectedForCompare.length === 0) {
      message.warning('请先选择要删除的回测结果');
      return;
    }

    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedForCompare.length} 条回测结果吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        try {
          const response = await backtestApi.deleteBacktestResults(selectedForCompare);
          if (response.success) {
            message.success(`成功删除 ${response.data?.deletedCount || selectedForCompare.length} 条回测结果`);
            setSelectedForCompare([]);
            await loadData();
          } else {
            const errorMsg = typeof response.error === 'string' ? response.error : response.error?.message || '批量删除失败';
            message.error(errorMsg);
          }
        } catch (err: any) {
          message.error(err.message || '批量删除失败');
        }
      },
    });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };

  const filteredResults = backtestResults.filter((result) => {
    if (filterStrategyId && result.strategyId !== filterStrategyId) return false;
    if (filterDateRange && filterDateRange[0] && filterDateRange[1]) {
      const startDate = filterDateRange[0].format('YYYY-MM-DD');
      const endDate = filterDateRange[1].format('YYYY-MM-DD');
      if (result.startDate < startDate) return false;
      if (result.endDate > endDate) return false;
    }
    return true;
  });

  const columns = [
    {
      title: '策略',
      key: 'strategy',
      render: (_: any, record: BacktestResult) => {
        const strategy = strategies.find(s => s.id === record.strategyId);
        return strategy?.name || `策略 #${record.strategyId}`;
      },
    },
    {
      title: '时间范围',
      key: 'dateRange',
      render: (_: any, record: BacktestResult) =>
        `${formatDate(record.startDate)} ~ ${formatDate(record.endDate)}`,
    },
    {
      title: '总收益率',
      key: 'totalReturn',
      render: (_: any, record: BacktestResult) => {
        if (record.status === 'PENDING' || record.status === 'RUNNING') {
          return <Tag color="processing">进行中...</Tag>;
        }
        if (record.status === 'FAILED') {
          return <Tag color="error">失败</Tag>;
        }
        const returnValue = record.totalReturn || 0;
        return (
          <span style={{ color: returnValue >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
            {returnValue >= 0 ? '+' : ''}{returnValue.toFixed(2)}%
          </span>
        );
      },
    },
    {
      title: '交易次数',
      key: 'totalTrades',
      dataIndex: 'totalTrades',
      render: (text: number) => text || '-',
    },
    {
      title: '胜率',
      key: 'winRate',
      dataIndex: 'winRate',
      render: (text: number) => text !== undefined ? `${text.toFixed(2)}%` : '-',
    },
    {
      title: '最大回撤',
      key: 'maxDrawdown',
      dataIndex: 'maxDrawdown',
      render: (text: number) => {
        if (text === undefined) return '-';
        return (
          <span style={{ color: text >= 0 ? '#52c41a' : '#ff4d4f' }}>
            {text.toFixed(2)}%
          </span>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: BacktestResult) => (
        <Space>
          <Link href={`/quant/backtest/${record.id}`} style={{ color: '#1890ff' }}>
            查看详情
          </Link>
          {record.status === 'FAILED' && (
            <Button type="link" onClick={() => handleRetry(record)} style={{ color: '#fa8c16' }}>
              重试
            </Button>
          )}
          <Button type="link" danger onClick={() => handleDelete(record.id)}>
            删除
          </Button>
          {(record.status === 'PENDING' || record.status === 'RUNNING') && (
            <Tag color="processing">
              {pollingTasks.has(record.id) ? '监控中...' : '等待中...'}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: '对比',
      key: 'compare',
      render: (_: any, record: BacktestResult) => (
        <Checkbox
          checked={selectedForCompare.includes(record.id)}
          onChange={(e) => {
            if (e.target.checked) {
              setSelectedForCompare([...selectedForCompare, record.id]);
            } else {
              setSelectedForCompare(selectedForCompare.filter(id => id !== record.id));
            }
          }}
        />
      ),
    },
  ];

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

  return (
    <AppLayout>
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h1 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 600, margin: 0 }}>回测管理</h1>
        </div>

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            closable
            onClose={() => setError(null)}
            style={{ marginBottom: 16 }}
          />
        )}

        <Tabs
          defaultActiveKey="strategy"
          items={[
            {
              key: 'strategy',
              label: '策略回测',
              children: (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                    <Space wrap>
                      {selectedForCompare.length > 0 && (
                        <>
                          <Button
                            type="primary"
                            style={{ background: '#722ed1', borderColor: '#722ed1' }}
                            onClick={() => setShowCompareModal(true)}
                          >
                            对比分析 ({selectedForCompare.length})
                          </Button>
                          <Button type="primary" danger onClick={handleBatchDelete}>
                            批量删除 ({selectedForCompare.length})
                          </Button>
                        </>
                      )}
                      <Button type="primary" onClick={() => setShowRunModal(true)}>
                        执行回测
                      </Button>
                    </Space>
                  </div>
                  {/* 筛选功能 */}
                  <Card style={{ marginBottom: 16 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>筛选条件</h2>
                    <Row gutter={16}>
                      <Col xs={24} sm={8}>
                        <div style={{ marginBottom: 8, fontWeight: 500 }}>策略</div>
                        <Select
                          value={filterStrategyId || undefined}
                          onChange={(value) => setFilterStrategyId(value || null)}
                          style={{ width: '100%' }}
                          placeholder="全部策略"
                          allowClear
                        >
                          {strategies.map((s) => (
                            <Select.Option key={s.id} value={s.id}>
                              {s.name}
                            </Select.Option>
                          ))}
                        </Select>
                      </Col>
                      <Col xs={24} sm={8}>
                        <div style={{ marginBottom: 8, fontWeight: 500 }}>日期范围</div>
                        <DatePicker.RangePicker
                          value={filterDateRange}
                          onChange={(dates) => setFilterDateRange(dates)}
                          format="YYYY-MM-DD"
                          style={{ width: '100%' }}
                          placeholder={['开始日期', '结束日期']}
                          presets={[
                            {
                              label: '最近一个月',
                              value: [dayjs().subtract(1, 'month'), dayjs()],
                            },
                            {
                              label: '最近三个月',
                              value: [dayjs().subtract(3, 'month'), dayjs()],
                            },
                            {
                              label: '最近六个月',
                              value: [dayjs().subtract(6, 'month'), dayjs()],
                            },
                            {
                              label: '最近九个月',
                              value: [dayjs().subtract(9, 'month'), dayjs()],
                            },
                            {
                              label: '最近一年',
                              value: [dayjs().subtract(1, 'year'), dayjs()],
                            },
                          ]}
                        />
                      </Col>
                      <Col xs={24} sm={8}>
                        <div style={{ marginBottom: 8 }}>&nbsp;</div>
                        <Button
                          onClick={() => {
                            setFilterStrategyId(null);
                            setFilterDateRange(null);
                          }}
                          block
                        >
                          清除筛选
                        </Button>
                      </Col>
                    </Row>
                  </Card>
                  <Table
                    dataSource={filteredResults}
                    columns={columns}
                    rowKey="id"
                    locale={{
                      emptyText: '暂无回测结果',
                    }}
                  />
                </>
              ),
            },
            {
              key: 'option',
              label: '期权回测',
              children: <OptionBacktestTab isMobile={isMobile} />,
            },
          ]}
        />
      </Card>

      {showRunModal && (
        <Modal
          title="执行回测"
          open={true}
          onCancel={() => setShowRunModal(false)}
          footer={null}
          width={600}
        >
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>策略 *</div>
              <Select
                value={selectedStrategyId || undefined}
                onChange={(value) => handleStrategyChange(value)}
                style={{ width: '100%' }}
                placeholder="请选择策略"
              >
                {strategies.map((s) => (
                  <Select.Option key={s.id} value={s.id}>
                    {s.name} ({s.type})
                  </Select.Option>
                ))}
              </Select>
            </div>
            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>标的代码 * (从策略中选择)</div>
              {availableSymbols.length === 0 ? (
                <div style={{ padding: '8px 0', color: '#999', fontSize: 14 }}>
                  {selectedStrategyId ? '该策略暂无标的代码' : '请先选择策略'}
                </div>
              ) : (
                <Card size="small" style={{ maxHeight: 200, overflowY: 'auto' }}>
                  <div style={{ marginBottom: 8 }}>
                    <Space>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => setSelectedSymbols(availableSymbols)}
                      >
                        全选
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => setSelectedSymbols([])}
                      >
                        全不选
                      </Button>
                    </Space>
                  </div>
                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                    {availableSymbols.map((symbol) => (
                      <Checkbox
                        key={symbol}
                        checked={selectedSymbols.includes(symbol)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedSymbols([...selectedSymbols, symbol]);
                          } else {
                            setSelectedSymbols(selectedSymbols.filter(s => s !== symbol));
                          }
                        }}
                      >
                        {symbol}
                      </Checkbox>
                    ))}
                  </Space>
                  {selectedSymbols.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                      已选择 {selectedSymbols.length} / {availableSymbols.length} 个标的
                    </div>
                  )}
                </Card>
              )}
            </div>
            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>日期范围 *</div>
              <DatePicker.RangePicker
                value={backtestDateRange}
                onChange={(dates) => setBacktestDateRange(dates)}
                format="YYYY-MM-DD"
                style={{ width: '100%' }}
                placeholder={['开始日期', '结束日期']}
                presets={[
                  {
                    label: '最近一个月',
                    value: [dayjs().subtract(1, 'month'), dayjs()],
                  },
                  {
                    label: '最近三个月',
                    value: [dayjs().subtract(3, 'month'), dayjs()],
                  },
                  {
                    label: '最近六个月',
                    value: [dayjs().subtract(6, 'month'), dayjs()],
                  },
                  {
                    label: '最近九个月',
                    value: [dayjs().subtract(9, 'month'), dayjs()],
                  },
                  {
                    label: '最近一年',
                    value: [dayjs().subtract(1, 'year'), dayjs()],
                  },
                ]}
              />
            </div>
          </Space>
          <div style={{ textAlign: 'right', marginTop: 24, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
            <Space>
              <Button onClick={() => setShowRunModal(false)} disabled={running}>
                取消
              </Button>
              <Button type="primary" onClick={handleRunBacktest} loading={running}>
                执行回测
              </Button>
            </Space>
          </div>
        </Modal>
      )}

      {/* 对比分析模态框 */}
      {showCompareModal && selectedForCompare.length > 0 && (
        <CompareModal
          backtestIds={selectedForCompare}
          strategies={strategies}
          onClose={() => {
            setShowCompareModal(false);
            setSelectedForCompare([]);
          }}
        />
      )}
    </AppLayout>
  );
}

// ============================
// 期权回测 Tab 组件
// ============================

interface OptionBacktestResultItem {
  id: number;
  strategyId: number;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  errorMessage?: string;
  dates: string[];
  symbols: string[];
  summary: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalGrossPnL: number;
    totalNetPnL: number;
    avgGrossPnLPercent: number;
    maxDrawdownPercent: number;
    avgHoldingMinutes: number;
    profitFactor: number;
  };
  startedAt?: string;
  completedAt?: string;
}

function OptionBacktestTab({ isMobile }: { isMobile: boolean }) {
  const router = useRouter();
  const [showRunModal, setShowRunModal] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<OptionBacktestResultItem[]>([]);
  const [optionStrategies, setOptionStrategies] = useState<Strategy[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [pollingTasks, setPollingTasks] = useState<Set<number>>(new Set());

  // 表单状态
  const [optStrategyId, setOptStrategyId] = useState<number | null>(null);
  const [optStrategySymbols, setOptStrategySymbols] = useState<string[]>([]);
  const [optDateRange, setOptDateRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const [tradingDays, setTradingDays] = useState<string[]>([]);
  const [optEntryThreshold, setOptEntryThreshold] = useState<number>(15);
  const [optRiskPref, setOptRiskPref] = useState<'AGGRESSIVE' | 'CONSERVATIVE'>('CONSERVATIVE');
  const [optContracts, setOptContracts] = useState<number>(1);
  const [optWindowStart, setOptWindowStart] = useState<number>(570);
  const [optWindowEnd, setOptWindowEnd] = useState<number>(630);
  const [optMaxTrades, setOptMaxTrades] = useState<number>(3);
  const [optAvoidFirst, setOptAvoidFirst] = useState<number>(15);
  const [optNoNewEntry, setOptNoNewEntry] = useState<number>(180);
  const [optForceClose, setOptForceClose] = useState<number>(30);
  const [optVixAdjust, setOptVixAdjust] = useState<boolean>(true);
  const [overrideConfig, setOverrideConfig] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [strategyConfig, setStrategyConfig] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    loadOptionData();
  }, []);

  // 选日期区间后调用后端获取交易日
  useEffect(() => {
    const [start, end] = optDateRange;
    if (!start || !end) { setTradingDays([]); return; }
    tradingDaysApi.getTradingDays(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'), 'US')
      .then(data => {
        // API 返回 YYYYMMDD 格式，转为 YYYY-MM-DD
        const days = (data.data?.tradingDays || []).map((d: string) =>
          d.includes('-') ? d : `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`
        );
        setTradingDays(days);
      })
      .catch(() => setTradingDays([]));
  }, [optDateRange]);

  // 页面加载时检查是否有进行中的任务
  useEffect(() => {
    const pending = results.filter(r => r.status === 'PENDING' || r.status === 'RUNNING');
    pending.forEach(task => {
      if (!pollingTasks.has(task.id)) {
        startOptionPolling(task.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.length]);

  const loadOptionData = async () => {
    try {
      setLoadingResults(true);
      // 加载期权类型策略
      const strategiesRes = await quantApi.getStrategies();
      if (strategiesRes.success && strategiesRes.data) {
        const optStrategies = strategiesRes.data.filter(
          (s: Strategy) => s.type === 'OPTION_INTRADAY_V1'
        );
        setOptionStrategies(optStrategies);

        // 加载所有期权策略的回测结果
        const allResults: OptionBacktestResultItem[] = [];
        for (const strategy of optStrategies) {
          try {
            const res = await backtestApi.getBacktestResultsByStrategy(strategy.id);
            if (res.success && res.data) {
              for (const row of res.data) {
                const config = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
                const result = typeof row.result === 'string' ? JSON.parse(row.result) : row.result;
                if (config?.type === 'OPTION_BACKTEST') {
                  allResults.push({
                    id: row.id,
                    strategyId: row.strategyId || strategy.id,
                    status: row.status || 'COMPLETED',
                    errorMessage: row.errorMessage,
                    dates: config?.dates || [row.startDate, row.endDate],
                    symbols: config?.symbols || result?.symbols || [],
                    summary: result?.summary || {
                      totalTrades: row.totalTrades || 0,
                      winningTrades: row.winningTrades || 0,
                      losingTrades: row.losingTrades || 0,
                      winRate: row.winRate || 0,
                      totalGrossPnL: 0,
                      totalNetPnL: 0,
                      avgGrossPnLPercent: row.avgReturn || 0,
                      maxDrawdownPercent: row.maxDrawdown || 0,
                      avgHoldingMinutes: 0,
                      profitFactor: 0,
                    },
                    startedAt: row.startedAt || row.created_at,
                    completedAt: row.completedAt,
                  });
                }
              }
            }
          } catch (err) {
            // 忽略单个策略加载错误
          }
        }
        setResults(allResults.sort((a, b) => b.id - a.id));
      }
    } catch (err) {
      // 静默处理
    } finally {
      setLoadingResults(false);
    }
  };

  const handleStrategySelect = async (strategyId: number) => {
    setOptStrategyId(strategyId);
    setOptStrategySymbols([]);
    setStrategyConfig(null);
    if (strategyId) {
      try {
        const res = await quantApi.getStrategy(strategyId);
        if (res.success && res.data) {
          const symbols = res.data.symbolPoolConfig?.symbols || [];
          setOptStrategySymbols(symbols);
          const cfg = res.data.config || {};
          setStrategyConfig(cfg);
          // 用策略值初始化表单默认值
          setOptRiskPref(cfg.riskPreference || 'CONSERVATIVE');
          setOptEntryThreshold(cfg.entryThresholdOverride?.directionalScoreMin ?? cfg.entryThreshold ?? 15);
          setOptContracts(cfg.positionContracts ?? 1);
          setOptWindowStart(570);
          // 对齐实盘: tradeWindow.firstHourOnly 决定窗口
          const tw = cfg?.tradeWindow || {};
          if (tw.firstHourOnly === false) {
            const endMin = 960 - (tw.noNewEntryBeforeCloseMinutes || 0);
            if (endMin >= 900) setOptWindowEnd(960);
            else if (endMin >= 720) setOptWindowEnd(endMin);
            else setOptWindowEnd(630);
          } else {
            setOptWindowEnd(630);
          }
          setOptMaxTrades(cfg.maxTradesPerDay ?? 3);
          setOptAvoidFirst(cfg.avoidFirstMinutes ?? 15);
          setOptNoNewEntry(cfg.noNewEntryBeforeCloseMinutes ?? 180);
          setOptForceClose(cfg.forceCloseBeforeCloseMinutes ?? 30);
          setOptVixAdjust(cfg.vixAdjustThreshold !== false);
        }
      } catch (err) {
        // 忽略
      }
    }
  };

  const startOptionPolling = (taskId: number) => {
    if (pollingTasks.has(taskId)) return;
    setPollingTasks(prev => new Set(prev).add(taskId));

    const interval = setInterval(async () => {
      try {
        const res = await optionBacktestApi.getResult(taskId);
        if (res.success && res.data) {
          const status = res.data.status;
          if (status === 'COMPLETED') {
            clearInterval(interval);
            setPollingTasks(prev => { const s = new Set(prev); s.delete(taskId); return s; });
            await loadOptionData();
            message.success('期权回测完成!');
          } else if (status === 'FAILED') {
            clearInterval(interval);
            setPollingTasks(prev => { const s = new Set(prev); s.delete(taskId); return s; });
            await loadOptionData();
            message.error(`期权回测失败: ${res.data.errorMessage || '未知错误'}`);
          }
        }
      } catch (err) {
        // 继续轮询
      }
    }, 3000);

    setTimeout(() => {
      clearInterval(interval);
      setPollingTasks(prev => { const s = new Set(prev); s.delete(taskId); return s; });
    }, 30 * 60 * 1000);
  };

  const handleRunOptionBacktest = async () => {
    if (!optStrategyId) {
      message.warning('请选择策略');
      return;
    }
    if (tradingDays.length === 0) {
      message.error('所选区间无交易日');
      return;
    }

    const dates = tradingDays;

    try {
      setRunning(true);
      const res = await optionBacktestApi.run({
        strategyId: optStrategyId,
        dates,
        config: overrideConfig ? {
          entryThreshold: optEntryThreshold,
          riskPreference: optRiskPref,
          positionContracts: optContracts,
          tradeWindowStartET: optWindowStart,
          tradeWindowEndET: optWindowEnd,
          maxTradesPerDay: optMaxTrades,
          avoidFirstMinutes: optAvoidFirst,
          noNewEntryBeforeCloseMinutes: optNoNewEntry,
          forceCloseBeforeCloseMinutes: optForceClose,
          vixAdjustThreshold: optVixAdjust,
        } : undefined,
      });

      if (res.success && res.data?.id) {
        message.success('期权回测任务已创建');
        setShowRunModal(false);
        startOptionPolling(res.data.id);
        await loadOptionData();
      } else {
        const errMsg = typeof res.error === 'string' ? res.error : res.error?.message || '创建失败';
        message.error(errMsg);
      }
    } catch (err: any) {
      message.error(err.message || '创建期权回测任务失败');
    } finally {
      setRunning(false);
    }
  };

  const handleDeleteOptionResult = (id: number) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个期权回测结果吗?',
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        try {
          const res = await optionBacktestApi.deleteResult(id);
          if (res.success) {
            message.success('已删除');
            await loadOptionData();
          }
        } catch (err: any) {
          message.error(err.message || '删除失败');
        }
      },
    });
  };

  const optColumns = [
    {
      title: '策略',
      key: 'strategy',
      render: (_: unknown, record: OptionBacktestResultItem) => {
        const strategy = optionStrategies.find(s => s.id === record.strategyId);
        return strategy?.name || `策略 #${record.strategyId}`;
      },
    },
    {
      title: '回测日期',
      key: 'dates',
      render: (_: unknown, record: OptionBacktestResultItem) => {
        const dates = record.dates || [];
        if (dates.length === 0) return '-';
        if (dates.length === 1) return dates[0];
        return `${dates[0]} ~ ${dates[dates.length - 1]} (${dates.length}天)`;
      },
    },
    {
      title: '标的',
      key: 'symbols',
      render: (_: unknown, record: OptionBacktestResultItem) => record.symbols?.join(', ') || '-',
    },
    {
      title: '状态',
      key: 'status',
      render: (_: unknown, record: OptionBacktestResultItem) => {
        if (record.status === 'PENDING' || record.status === 'RUNNING') {
          return <Tag color="processing">{pollingTasks.has(record.id) ? '执行中...' : record.status}</Tag>;
        }
        if (record.status === 'FAILED') return <Tag color="error">失败</Tag>;
        return <Tag color="success">完成</Tag>;
      },
    },
    {
      title: '交易数',
      key: 'trades',
      render: (_: unknown, record: OptionBacktestResultItem) => record.summary?.totalTrades ?? '-',
    },
    {
      title: '胜率',
      key: 'winRate',
      render: (_: unknown, record: OptionBacktestResultItem) => {
        const wr = record.summary?.winRate;
        return wr !== undefined ? `${wr}%` : '-';
      },
    },
    {
      title: '总 PnL',
      key: 'totalPnL',
      render: (_: unknown, record: OptionBacktestResultItem) => {
        const pnl = record.summary?.totalNetPnL;
        if (pnl === undefined) return '-';
        return (
          <span style={{ color: pnl >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
            {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
          </span>
        );
      },
    },
    {
      title: '平均 PnL%',
      key: 'avgPnL',
      render: (_: unknown, record: OptionBacktestResultItem) => {
        const avg = record.summary?.avgGrossPnLPercent;
        if (avg === undefined) return '-';
        return (
          <span style={{ color: avg >= 0 ? '#52c41a' : '#ff4d4f' }}>
            {avg >= 0 ? '+' : ''}{avg.toFixed(2)}%
          </span>
        );
      },
    },
    {
      title: '盈利因子',
      key: 'pf',
      render: (_: unknown, record: OptionBacktestResultItem) => {
        const pf = record.summary?.profitFactor;
        return pf !== undefined ? pf.toFixed(2) : '-';
      },
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: OptionBacktestResultItem) => (
        <Space>
          {record.status === 'COMPLETED' && (
            <Link href={`/quant/backtest/option/${record.id}`} style={{ color: '#1890ff' }}>
              查看详情
            </Link>
          )}
          <Button type="link" danger onClick={() => handleDeleteOptionResult(record.id)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" onClick={() => setShowRunModal(true)}>
          执行期权回测
        </Button>
      </div>

      {loadingResults ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : (
        <Table
          dataSource={results}
          columns={optColumns}
          rowKey="id"
          locale={{ emptyText: '暂无期权回测结果' }}
        />
      )}

      {/* 期权回测执行 Modal */}
      {showRunModal && (
        <Modal
          title="执行期权回测"
          open={true}
          onCancel={() => setShowRunModal(false)}
          footer={null}
          width={640}
        >
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {/* 选择策略 */}
            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>策略 *</div>
              {optionStrategies.length === 0 ? (
                <Alert
                  message="暂无 OPTION_INTRADAY_V1 类型的策略"
                  description="请先在策略管理中创建期权日内策略"
                  type="warning"
                  showIcon
                />
              ) : (
                <Select
                  value={optStrategyId || undefined}
                  onChange={(value) => handleStrategySelect(value)}
                  style={{ width: '100%' }}
                  placeholder="请选择期权策略"
                >
                  {optionStrategies.map((s) => (
                    <Select.Option key={s.id} value={s.id}>
                      {s.name} ({s.status})
                    </Select.Option>
                  ))}
                </Select>
              )}
            </div>

            {/* 显示策略配置的标的 */}
            {optStrategyId && (
              <div>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>回测标的（来自策略配置）</div>
                {optStrategySymbols.length > 0 ? (
                  <Space wrap>
                    {optStrategySymbols.map(s => (
                      <Tag key={s} color="blue">{s}</Tag>
                    ))}
                  </Space>
                ) : (
                  <span style={{ color: '#999', fontSize: 14 }}>该策略未配置标的代码</span>
                )}
              </div>
            )}

            {/* 回测日期 */}
            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>回测日期 *</div>
              <DatePicker.RangePicker
                value={optDateRange}
                onChange={(dates) => setOptDateRange(dates ? [dates[0], dates[1]] : [null, null])}
                format="YYYY-MM-DD"
                style={{ width: '100%' }}
                placeholder={['开始日期', '结束日期']}
                disabledDate={(current) => current && current > dayjs().endOf('day')}
                presets={[
                  { label: '最近一周', value: [dayjs().subtract(1, 'week'), dayjs()] },
                  { label: '最近两周', value: [dayjs().subtract(2, 'week'), dayjs()] },
                  { label: '最近一个月', value: [dayjs().subtract(1, 'month'), dayjs()] },
                  { label: '最近三个月', value: [dayjs().subtract(3, 'month'), dayjs()] },
                ]}
              />
              {tradingDays.length > 0 && (
                <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                  {`共 ${tradingDays.length} 个交易日`}
                </Text>
              )}
            </div>

            {/* 策略当前参数（只读） */}
            {optStrategyId && strategyConfig && (
              <Card size="small" title="策略当前参数" style={{ background: '#fafafa' }}>
                <Row gutter={[16, 8]}>
                  <Col xs={8}><span style={{ fontSize: 12, color: '#999' }}>风险偏好:</span> <span style={{ fontSize: 12 }}>{strategyConfig.riskPreference || 'CONSERVATIVE'}</span></Col>
                  <Col xs={8}><span style={{ fontSize: 12, color: '#999' }}>入场阈值:</span> <span style={{ fontSize: 12 }}>{strategyConfig.entryThresholdOverride?.directionalScoreMin ?? strategyConfig.entryThreshold ?? '-'}</span></Col>
                  <Col xs={8}><span style={{ fontSize: 12, color: '#999' }}>合约数:</span> <span style={{ fontSize: 12 }}>{strategyConfig.positionContracts ?? 1}</span></Col>
                  <Col xs={8}><span style={{ fontSize: 12, color: '#999' }}>每日最大交易:</span> <span style={{ fontSize: 12 }}>{strategyConfig.maxTradesPerDay ?? 3}</span></Col>
                  <Col xs={8}><span style={{ fontSize: 12, color: '#999' }}>禁入窗口:</span> <span style={{ fontSize: 12 }}>{strategyConfig.avoidFirstMinutes ?? 15}分钟</span></Col>
                  <Col xs={8}><span style={{ fontSize: 12, color: '#999' }}>VIX动态阈值:</span> <span style={{ fontSize: 12 }}>{strategyConfig.vixAdjustThreshold !== false ? '开启' : '关闭'}</span></Col>
                </Row>
              </Card>
            )}

            {/* 自定义参数覆盖 */}
            <Checkbox
              checked={overrideConfig}
              onChange={e => setOverrideConfig(e.target.checked)}
            >
              自定义参数覆盖（不勾选则使用策略配置）
            </Checkbox>

            {overrideConfig && (
              <Card size="small" title="覆盖参数">
                <Row gutter={16}>
                  <Col xs={12}>
                    <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>入场阈值</div>
                    <InputNumber
                      value={optEntryThreshold}
                      onChange={v => setOptEntryThreshold(v ?? 15)}
                      min={5}
                      max={50}
                      style={{ width: '100%' }}
                    />
                  </Col>
                  <Col xs={12}>
                    <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>风险偏好</div>
                    <Select
                      value={optRiskPref}
                      onChange={setOptRiskPref}
                      style={{ width: '100%' }}
                    >
                      <Select.Option value="CONSERVATIVE">保守</Select.Option>
                      <Select.Option value="AGGRESSIVE">激进</Select.Option>
                    </Select>
                  </Col>
                </Row>
                <Row gutter={16} style={{ marginTop: 12 }}>
                  <Col xs={8}>
                    <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>合约数</div>
                    <InputNumber
                      value={optContracts}
                      onChange={v => setOptContracts(v ?? 1)}
                      min={1}
                      max={10}
                      style={{ width: '100%' }}
                    />
                  </Col>
                  <Col xs={8}>
                    <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>每日最大交易</div>
                    <InputNumber
                      value={optMaxTrades}
                      onChange={v => setOptMaxTrades(v ?? 3)}
                      min={1}
                      max={10}
                      style={{ width: '100%' }}
                    />
                  </Col>
                  <Col xs={8}>
                    <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>交易窗口</div>
                    <Select
                      value={`${optWindowStart}-${optWindowEnd}`}
                      onChange={v => {
                        const [s, e] = v.split('-').map(Number);
                        setOptWindowStart(s);
                        setOptWindowEnd(e);
                      }}
                      style={{ width: '100%' }}
                    >
                      <Select.Option value="570-630">9:30-10:30 (首小时)</Select.Option>
                      <Select.Option value="570-720">9:30-12:00 (上午)</Select.Option>
                      <Select.Option value="570-900">9:30-15:00 (全天)</Select.Option>
                      <Select.Option value="570-960">9:30-16:00 (含尾盘)</Select.Option>
                    </Select>
                  </Col>
                </Row>
                <Row gutter={16} style={{ marginTop: 12 }}>
                  <Col xs={8}>
                    <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>开盘禁入(分钟)</div>
                    <InputNumber
                      value={optAvoidFirst}
                      onChange={v => setOptAvoidFirst(v ?? 15)}
                      min={0}
                      max={60}
                      style={{ width: '100%' }}
                    />
                  </Col>
                  <Col xs={8}>
                    <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>收盘前禁开(分钟)</div>
                    <InputNumber
                      value={optNoNewEntry}
                      onChange={v => setOptNoNewEntry(v ?? 180)}
                      min={0}
                      max={390}
                      style={{ width: '100%' }}
                    />
                  </Col>
                  <Col xs={8}>
                    <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>收盘前强平(分钟)</div>
                    <InputNumber
                      value={optForceClose}
                      onChange={v => setOptForceClose(v ?? 30)}
                      min={0}
                      max={120}
                      style={{ width: '100%' }}
                    />
                  </Col>
                </Row>
                <Row gutter={16} style={{ marginTop: 12 }}>
                  <Col xs={12}>
                    <Checkbox
                      checked={optVixAdjust}
                      onChange={e => setOptVixAdjust(e.target.checked)}
                    >
                      VIX 动态阈值调整
                    </Checkbox>
                  </Col>
                </Row>
              </Card>
            )}
          </Space>
          <div style={{ textAlign: 'right', marginTop: 24, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
            <Space>
              <Button onClick={() => setShowRunModal(false)} disabled={running}>取消</Button>
              <Button type="primary" onClick={handleRunOptionBacktest} loading={running}>
                执行回测
              </Button>
            </Space>
          </div>
        </Modal>
      )}
    </>
  );
}

// 对比分析组件
function CompareModal({
  backtestIds,
  strategies,
  onClose,
}: {
  backtestIds: number[];
  strategies: Strategy[];
  onClose: () => void;
}) {
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCompareData();
  }, []);

  const loadCompareData = async () => {
    try {
      setLoading(true);
      const allResults = await Promise.all(
        backtestIds.map(id => backtestApi.getBacktestResult(id))
      );
      setResults(
        allResults
          .filter(res => res.success && res.data)
          .map(res => res.data!)
      );
    } catch (err: any) {
      console.error('加载对比数据失败:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Modal
        title="回测结果对比"
        open={true}
        onCancel={onClose}
        footer={null}
        width={1000}
        styles={{ body: { maxHeight: '80vh', overflowY: 'auto' } }}
      >
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>加载中...</div>
        </div>
      </Modal>
    );
  }

  // 准备对比数据
  const comparisonData = results.map(result => ({
    name: strategies.find(s => s.id === result.strategyId)?.name || `策略 #${result.strategyId}`,
    totalReturn: result.totalReturn,
    winRate: result.winRate,
    maxDrawdown: result.maxDrawdown,
    sharpeRatio: result.sharpeRatio,
    totalTrades: result.totalTrades,
    avgReturn: result.avgReturn,
  }));

  // 准备图表数据 - 合并所有回测结果的日期
  const chartData: any[] = [];
  if (results.length > 0 && results[0].dailyReturns) {
    // 获取所有日期
    const allDates = new Set<string>();
    results.forEach(result => {
      if (result.dailyReturns) {
        result.dailyReturns.forEach(day => allDates.add(day.date));
      }
    });
    const sortedDates = Array.from(allDates).sort();

    // 为每个日期创建数据点
    sortedDates.forEach(date => {
      const dataPoint: any = { date };
      results.forEach((result, index) => {
        if (result.dailyReturns) {
          const dayData = result.dailyReturns.find(d => d.date === date);
          if (dayData) {
            const initialEquity = result.dailyReturns[0].equity;
            const cumulativeReturn = ((dayData.equity - initialEquity) / initialEquity) * 100;
            const strategyName = strategies.find(s => s.id === result.strategyId)?.name || `策略${index + 1}`;
            dataPoint[strategyName] = cumulativeReturn;
          }
        }
      });
      chartData.push(dataPoint);
    });
  }

  const compareColumns = [
    {
      title: '策略',
      key: 'name',
      dataIndex: 'name',
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: '总收益率',
      key: 'totalReturn',
      dataIndex: 'totalReturn',
      render: (value: number) => (
        <span style={{ color: value >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
          {value >= 0 ? '+' : ''}{value.toFixed(2)}%
        </span>
      ),
    },
    {
      title: '胜率',
      key: 'winRate',
      dataIndex: 'winRate',
      render: (value: number) => `${value.toFixed(2)}%`,
    },
    {
      title: '最大回撤',
      key: 'maxDrawdown',
      dataIndex: 'maxDrawdown',
      render: (value: number) => (
        <span style={{ color: value >= 0 ? '#52c41a' : '#ff4d4f' }}>
          {value.toFixed(2)}%
        </span>
      ),
    },
    {
      title: '夏普比率',
      key: 'sharpeRatio',
      dataIndex: 'sharpeRatio',
      render: (value: number) => value.toFixed(2),
    },
    {
      title: '交易次数',
      key: 'totalTrades',
      dataIndex: 'totalTrades',
    },
    {
      title: '平均收益率',
      key: 'avgReturn',
      dataIndex: 'avgReturn',
      render: (value: number) => (
        <span style={{ color: value >= 0 ? '#52c41a' : '#ff4d4f' }}>
          {value >= 0 ? '+' : ''}{value.toFixed(2)}%
        </span>
      ),
    },
  ];

  return (
    <Modal
      title="回测结果对比"
      open={true}
      onCancel={onClose}
      footer={null}
      width={1000}
      styles={{ body: { maxHeight: '80vh', overflowY: 'auto' } }}
    >
      {/* 对比表格 */}
      <Table
        dataSource={comparisonData}
        columns={compareColumns}
        rowKey={(_, index) => `compare-${index}`}
        pagination={false}
        style={{ marginBottom: 24 }}
      />

      {/* 对比图表 */}
      {chartData.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>累计收益率对比</h3>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date"
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                <YAxis 
                  tickFormatter={(value) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`}
                />
                <Tooltip 
                  formatter={(value: number) => [`${value >= 0 ? '+' : ''}${value.toFixed(2)}%`, '累计收益率']}
                  labelFormatter={(label) => `日期: ${new Date(label).toLocaleDateString('zh-CN')}`}
                />
                <Legend />
                {results.map((result, index) => {
                  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
                  const strategyName = strategies.find(s => s.id === result.strategyId)?.name || `策略${index + 1}`;
                  return (
                    <Line
                      key={index}
                      type="monotone"
                      dataKey={strategyName}
                      stroke={colors[index % colors.length]}
                      strokeWidth={2}
                      dot={false}
                      name={strategyName}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div style={{ textAlign: 'right', borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
        <Button onClick={onClose}>关闭</Button>
      </div>
    </Modal>
  );
}

