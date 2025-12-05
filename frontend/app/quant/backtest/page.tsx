'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { backtestApi, quantApi } from '@/lib/api';
import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { DatePicker } from 'antd';
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
      alert('请填写所有必填字段');
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
        alert('回测任务已创建，正在后台执行...');
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
        alert(response.error || '创建回测任务失败');
      }
    } catch (err: any) {
      alert(err.message || '创建回测任务失败');
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
            alert('回测完成！');
          } else if (status === 'FAILED') {
            clearInterval(pollInterval);
            setPollingTasks(prev => {
              const newSet = new Set(prev);
              newSet.delete(taskId);
              return newSet;
            });
            // 刷新列表
            await loadData();
            alert(`回测失败: ${statusRes.data.errorMessage || '未知错误'}`);
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
    if (!confirm('确定要重试这个回测任务吗？')) {
      return;
    }

    try {
      // 需要获取标的代码，这里假设从策略配置中获取
      // 实际应该从数据库或配置中获取
      const strategyRes = await quantApi.getStrategy(result.strategyId);
      if (strategyRes.success && strategyRes.data) {
        const symbols = strategyRes.data.symbolPoolConfig?.symbols || [];
        if (symbols.length === 0) {
          alert('无法获取标的代码，请手动重试');
          return;
        }

        const retryRes = await backtestApi.retryBacktest(result.id, symbols);
        if (retryRes.success) {
          alert('回测任务已重新开始执行');
          startPolling(result.id);
          await loadData();
        } else {
          alert(retryRes.error || '重试失败');
        }
      }
    } catch (err: any) {
      alert(err.message || '重试失败');
    }
  };

  // 删除回测结果
  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个回测结果吗？此操作不可恢复。')) {
      return;
    }

    try {
      const response = await backtestApi.deleteBacktestResult(id);
      if (response.success) {
        alert('回测结果已删除');
        await loadData();
      } else {
        alert(response.error || '删除失败');
      }
    } catch (err: any) {
      alert(err.message || '删除失败');
    }
  };

  // 批量删除回测结果
  const handleBatchDelete = async () => {
    if (selectedForCompare.length === 0) {
      alert('请先选择要删除的回测结果');
      return;
    }

    if (!confirm(`确定要删除选中的 ${selectedForCompare.length} 条回测结果吗？此操作不可恢复。`)) {
      return;
    }

    try {
      const response = await backtestApi.deleteBacktestResults(selectedForCompare);
      if (response.success) {
        alert(`成功删除 ${response.data?.deletedCount || selectedForCompare.length} 条回测结果`);
        setSelectedForCompare([]);
        await loadData();
      } else {
        alert(response.error || '批量删除失败');
      }
    } catch (err: any) {
      alert(err.message || '批量删除失败');
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };

  const getReturnColor = (returnValue: number) => {
    return returnValue >= 0 ? 'text-green-600' : 'text-red-600';
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">加载中...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <BackButton />
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">回测管理</h1>
        <div className="flex gap-2">
          {selectedForCompare.length > 0 && (
            <>
              <button
                onClick={() => setShowCompareModal(true)}
                className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600"
              >
                对比分析 ({selectedForCompare.length})
              </button>
              <button
                onClick={handleBatchDelete}
                className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
              >
                批量删除 ({selectedForCompare.length})
              </button>
            </>
          )}
          <button
            onClick={() => setShowRunModal(true)}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            执行回测
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* 筛选功能 */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <h2 className="text-lg font-bold mb-4">筛选条件</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">策略</label>
            <select
              value={filterStrategyId || ''}
              onChange={(e) => setFilterStrategyId(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="">全部策略</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">日期范围</label>
            <DatePicker.RangePicker
              value={filterDateRange}
              onChange={(dates) => setFilterDateRange(dates)}
              format="YYYY-MM-DD"
              className="w-full"
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
          <div className="flex items-end">
            <button
              onClick={() => {
                setFilterStrategyId(null);
                setFilterDateRange(null);
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              清除筛选
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">策略</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">时间范围</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">总收益率</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">交易次数</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">胜率</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">最大回撤</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">对比</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {backtestResults.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-4 text-center text-gray-500">
                  暂无回测结果
                </td>
              </tr>
            ) : (
              backtestResults
                .filter((result) => {
                  if (filterStrategyId && result.strategyId !== filterStrategyId) return false;
                  if (filterDateRange && filterDateRange[0] && filterDateRange[1]) {
                    const startDate = filterDateRange[0].format('YYYY-MM-DD');
                    const endDate = filterDateRange[1].format('YYYY-MM-DD');
                    if (result.startDate < startDate) return false;
                    if (result.endDate > endDate) return false;
                  }
                  return true;
                })
                .map((result) => {
                const strategy = strategies.find(s => s.id === result.strategyId);
                return (
                  <tr key={result.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      {strategy?.name || `策略 #${result.strategyId}`}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(result.startDate)} ~ {formatDate(result.endDate)}
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm font-semibold ${getReturnColor(result.totalReturn || 0)}`}>
                      {result.status === 'PENDING' || result.status === 'RUNNING' ? (
                        <span className="text-yellow-600">进行中...</span>
                      ) : result.status === 'FAILED' ? (
                        <span className="text-red-600">失败</span>
                      ) : (
                        `${result.totalReturn && result.totalReturn >= 0 ? '+' : ''}${(result.totalReturn || 0).toFixed(2)}%`
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {result.totalTrades || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {result.winRate !== undefined ? `${result.winRate.toFixed(2)}%` : '-'}
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm ${getReturnColor(result.maxDrawdown || 0)}`}>
                      {result.maxDrawdown !== undefined ? `${result.maxDrawdown.toFixed(2)}%` : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* 查看详情 - 所有状态都可以查看 */}
                        <Link
                          href={`/quant/backtest/${result.id}`}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          查看详情
                        </Link>
                        
                        {/* 重试 - 仅失败状态显示 */}
                        {result.status === 'FAILED' && (
                          <button
                            onClick={() => handleRetry(result)}
                            className="text-orange-600 hover:text-orange-800 text-sm"
                          >
                            重试
                          </button>
                        )}
                        
                        {/* 删除 - 所有状态都可以删除 */}
                        <button
                          onClick={() => handleDelete(result.id)}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          删除
                        </button>
                        
                        {/* 状态提示 - 进行中时显示 */}
                        {(result.status === 'PENDING' || result.status === 'RUNNING') && (
                          <span className="text-yellow-600 text-xs">
                            {pollingTasks.has(result.id) ? '监控中...' : '等待中...'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={selectedForCompare.includes(result.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedForCompare([...selectedForCompare, result.id]);
                          } else {
                            setSelectedForCompare(selectedForCompare.filter(id => id !== result.id));
                          }
                        }}
                        className="rounded"
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showRunModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">执行回测</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  策略 *
                </label>
                <select
                  value={selectedStrategyId || ''}
                  onChange={(e) => handleStrategyChange(parseInt(e.target.value))}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                >
                  <option value="">请选择策略</option>
                  {strategies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.type})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  标的代码 * (从策略中选择)
                </label>
                {availableSymbols.length === 0 ? (
                  <div className="text-sm text-gray-500 py-2">
                    {selectedStrategyId ? '该策略暂无标的代码' : '请先选择策略'}
                  </div>
                ) : (
                  <div className="border border-gray-300 rounded p-3 max-h-48 overflow-y-auto">
                    <div className="mb-2">
                      <button
                        type="button"
                        onClick={() => setSelectedSymbols(availableSymbols)}
                        className="text-xs text-blue-600 hover:text-blue-800 mr-2"
                      >
                        全选
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedSymbols([])}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        全不选
                      </button>
                    </div>
                    <div className="space-y-1">
                      {availableSymbols.map((symbol) => (
                        <label key={symbol} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={selectedSymbols.includes(symbol)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedSymbols([...selectedSymbols, symbol]);
                              } else {
                                setSelectedSymbols(selectedSymbols.filter(s => s !== symbol));
                              }
                            }}
                            className="rounded"
                          />
                          <span className="text-sm">{symbol}</span>
                        </label>
                      ))}
                    </div>
                    {selectedSymbols.length > 0 && (
                      <div className="mt-2 text-xs text-gray-500">
                        已选择 {selectedSymbols.length} / {availableSymbols.length} 个标的
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  日期范围 *
                </label>
                <DatePicker.RangePicker
                  value={backtestDateRange}
                  onChange={(dates) => setBacktestDateRange(dates)}
                  format="YYYY-MM-DD"
                  className="w-full"
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
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowRunModal(false)}
                className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                disabled={running}
              >
                取消
              </button>
              <button
                onClick={handleRunBacktest}
                disabled={running}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              >
                {running ? '执行中...' : '执行回测'}
              </button>
            </div>
          </div>
        </div>
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
    </div>
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
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 w-full max-w-6xl max-h-[90vh] overflow-y-auto">
          <div className="text-center">加载中...</div>
        </div>
      </div>
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-6xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">回测结果对比</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl"
          >
            ×
          </button>
        </div>

        {/* 对比表格 */}
        <div className="mb-6 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">策略</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">总收益率</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">胜率</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">最大回撤</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">夏普比率</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">交易次数</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">平均收益率</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {comparisonData.map((data, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap font-medium">{data.name}</td>
                  <td className={`px-4 py-3 whitespace-nowrap text-sm font-semibold ${data.totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {data.totalReturn >= 0 ? '+' : ''}{data.totalReturn.toFixed(2)}%
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">{data.winRate.toFixed(2)}%</td>
                  <td className={`px-4 py-3 whitespace-nowrap text-sm ${data.maxDrawdown >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {data.maxDrawdown.toFixed(2)}%
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">{data.sharpeRatio.toFixed(2)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">{data.totalTrades}</td>
                  <td className={`px-4 py-3 whitespace-nowrap text-sm ${data.avgReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {data.avgReturn >= 0 ? '+' : ''}{data.avgReturn.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 对比图表 */}
        {chartData.length > 0 && (
          <div className="mb-6">
            <h3 className="text-lg font-bold mb-4">累计收益率对比</h3>
            <div className="h-64">
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

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

