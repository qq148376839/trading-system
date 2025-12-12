'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { backtestApi, quantApi } from '@/lib/api';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import { DatePicker, Button, Table, Card, Space, Modal, message, Alert, Tag, Spin, Select, Checkbox, Row, Col } from 'antd';
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>回测管理</h1>
          <Space>
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

