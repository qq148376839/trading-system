'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { backtestApi, quantApi } from '@/lib/api';
import BackButton from '@/components/BackButton';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';

interface BacktestTrade {
  symbol: string;
  entryDate: string;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  entryReason: string;
  exitReason: string | null;
}

interface BacktestResult {
  id: number;
  strategyId: number;
  startDate: string;
  endDate: string;
  totalReturn: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  avgHoldingTime: number;
  trades: BacktestTrade[];
  dailyReturns: Array<{ date: string; return: number; equity: number }>;
}

interface Strategy {
  id: number;
  name: string;
  type: string;
}

export default function BacktestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const backtestId = parseInt(params.id as string);

  const [result, setResult] = useState<BacktestResult | null>(null);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (backtestId) {
      loadData();
    }
  }, [backtestId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const resultRes = await backtestApi.getBacktestResult(backtestId);
      
      if (resultRes.success && resultRes.data) {
        setResult(resultRes.data);
        
        // 加载策略信息
        try {
          const strategyRes = await quantApi.getStrategy(resultRes.data.strategyId);
          if (strategyRes.success && strategyRes.data) {
            setStrategy(strategyRes.data);
          }
        } catch (err) {
          // 忽略策略加载错误
        }
      } else {
        setError('回测结果不存在');
      }
    } catch (err: any) {
      setError(err.message || '加载回测结果失败');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  const getReturnColor = (returnValue: number) => {
    return returnValue >= 0 ? 'text-green-600' : 'text-red-600';
  };

  const handleExport = async () => {
    if (!result) {
      alert('回测结果不存在，无法导出');
      return;
    }
    
    try {
      const blob = await backtestApi.exportBacktest(backtestId);
      
      // 创建下载链接
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // 生成文件名
      const filename = `backtest_${result.strategyId}_${result.startDate}_${result.endDate}_${result.id}.json`;
      link.download = filename;
      
      // 触发下载
      document.body.appendChild(link);
      link.click();
      
      // 清理
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('导出失败: ' + (err.message || '未知错误'));
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">加载中...</div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="container mx-auto p-6">
        <BackButton />
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error || '回测结果不存在'}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <BackButton />
      
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold mb-2">回测结果详情</h1>
          {strategy && (
            <p className="text-gray-600">
              策略: {strategy.name} ({strategy.type})
            </p>
          )}
          <p className="text-gray-600">
            时间范围: {formatDate(result.startDate)} ~ {formatDate(result.endDate)}
          </p>
        </div>
        <button
          onClick={handleExport}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition-colors flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          导出JSON
        </button>
      </div>

      {/* 性能指标卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500 mb-1">总收益率</div>
          <div className={`text-2xl font-bold ${getReturnColor(result.totalReturn)}`}>
            {result.totalReturn >= 0 ? '+' : ''}{result.totalReturn.toFixed(2)}%
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500 mb-1">总交易次数</div>
          <div className="text-2xl font-bold">{result.totalTrades}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500 mb-1">胜率</div>
          <div className="text-2xl font-bold">{result.winRate.toFixed(2)}%</div>
          <div className="text-xs text-gray-400 mt-1">
            {result.winningTrades} 胜 / {result.losingTrades} 负
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500 mb-1">最大回撤</div>
          <div className={`text-2xl font-bold ${getReturnColor(result.maxDrawdown)}`}>
            {result.maxDrawdown.toFixed(2)}%
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500 mb-1">平均收益率</div>
          <div className={`text-2xl font-bold ${getReturnColor(result.avgReturn)}`}>
            {result.avgReturn >= 0 ? '+' : ''}{result.avgReturn.toFixed(2)}%
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500 mb-1">夏普比率</div>
          <div className="text-2xl font-bold">{result.sharpeRatio.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500 mb-1">平均持仓时间</div>
          <div className="text-2xl font-bold">{result.avgHoldingTime.toFixed(1)}</div>
          <div className="text-xs text-gray-400 mt-1">小时</div>
        </div>
      </div>

      {/* 交易明细 */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-bold mb-4">交易明细 ({result.trades.length})</h2>
        {result.trades.length === 0 ? (
          <div className="text-gray-500 text-center py-4">暂无交易记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">标的</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">买入日期</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">卖出日期</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">买入价</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">卖出价</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">数量</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">盈亏</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">卖出原因</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {result.trades.map((trade, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap font-medium">{trade.symbol}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(trade.entryDate)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {trade.exitDate ? formatDate(trade.exitDate) : '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">${trade.entryPrice.toFixed(2)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      {trade.exitPrice ? `$${trade.exitPrice.toFixed(2)}` : '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">{trade.quantity}</td>
                    <td className={`px-4 py-3 whitespace-nowrap text-sm font-semibold ${getReturnColor(trade.pnl)}`}>
                      ${trade.pnl.toFixed(2)} ({trade.pnlPercent >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%)
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {trade.exitReason || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 每日收益曲线（使用 Recharts） */}
      {result.dailyReturns && result.dailyReturns.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">每日权益变化</h2>
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={result.dailyReturns}>
              <defs>
                <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return `${date.getMonth() + 1}/${date.getDate()}`;
                }}
              />
              <YAxis 
                tickFormatter={(value) => `$${value.toFixed(0)}`}
              />
              <Tooltip 
                formatter={(value: number) => [`$${value.toFixed(2)}`, '权益']}
                labelFormatter={(label) => `日期: ${new Date(label).toLocaleDateString('zh-CN')}`}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="equity"
                stroke="#3b82f6"
                fillOpacity={1}
                fill="url(#colorEquity)"
                name="权益"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 每日收益率 */}
      {result.dailyReturns && result.dailyReturns.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">每日收益率</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={result.dailyReturns}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return `${date.getMonth() + 1}/${date.getDate()}`;
                }}
              />
              <YAxis 
                tickFormatter={(value) => `${value.toFixed(2)}%`}
              />
              <Tooltip 
                formatter={(value: number) => [`${value >= 0 ? '+' : ''}${value.toFixed(2)}%`, '收益率']}
                labelFormatter={(label) => `日期: ${new Date(label).toLocaleDateString('zh-CN')}`}
              />
              <Legend />
              <Bar 
                dataKey="return" 
                fill="#10b981"
                name="收益率"
                radius={[4, 4, 0, 0]}
              >
                {result.dailyReturns.map((entry, index) => (
                  <Bar key={index} fill={entry.return >= 0 ? '#10b981' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 累计收益率曲线 */}
      {result.dailyReturns && result.dailyReturns.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">累计收益率</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={result.dailyReturns.map((day, index) => {
              const initialEquity = result.dailyReturns[0].equity;
              const cumulativeReturn = ((day.equity - initialEquity) / initialEquity) * 100;
              return {
                date: day.date,
                cumulativeReturn: cumulativeReturn,
              };
            })}>
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
              <Line
                type="monotone"
                dataKey="cumulativeReturn"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={false}
                name="累计收益率"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

