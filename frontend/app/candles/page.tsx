'use client'

import { useEffect, useState, Suspense, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { candlesticksApi } from '@/lib/api'
import { calculateZIG } from '@/lib/indicators'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import BackButton from '@/components/BackButton'

interface Candlestick {
  timestamp: string // ISO字符串格式
  open: string
  high: string
  low: string
  close: string
  volume: number
  turnover: string
  trade_session?: number // 交易时段
}

function CandlesContent() {
  const searchParams = useSearchParams()
  const [symbol, setSymbol] = useState(searchParams.get('symbol') || 'AAPL.US')
  const [period, setPeriod] = useState('day')
  const [count, setCount] = useState(30)
  const [candlesticks, setCandlesticks] = useState<Candlestick[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showZIG, setShowZIG] = useState(false)
  const [zigPriceType, setZigPriceType] = useState<'close' | 'high' | 'low'>('close')
  const [zigReversalPercent, setZigReversalPercent] = useState(5)

  const fetchCandlesticks = async () => {
    if (!symbol.trim()) {
      setError('请输入股票代码')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await candlesticksApi.getCandlesticks(symbol.trim(), period, count)
      
      if (response.success && response.data?.candlesticks) {
        setCandlesticks(response.data.candlesticks)
      } else {
        setError('获取K线数据失败')
      }
    } catch (err: any) {
      setError(err.message || '获取K线数据失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCandlesticks()
  }, [])

  const chartData = useMemo(() => {
    const data = candlesticks.map(c => {
      // 解析时间戳（可能是ISO字符串或时间戳）
      let date: Date;
      if (typeof c.timestamp === 'string') {
        date = new Date(c.timestamp)
      } else {
        // 如果是数字，判断是秒还是毫秒
        date = new Date(c.timestamp > 1e12 ? c.timestamp : c.timestamp * 1000)
      }
      
      return {
        time: date.toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
        date: date.toLocaleDateString('zh-CN'),
        datetime: date.toLocaleString('zh-CN'),
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
        volume: c.volume,
      }
    }).reverse() // 反转数组，让最新的数据在最后
    
    // 计算ZIG指标
    if (showZIG && data.length > 0) {
      const zigValues = calculateZIG(data, zigPriceType, zigReversalPercent)
      return data.map((item, index) => ({
        ...item,
        zig: zigValues[index] !== null && zigValues[index] !== undefined ? zigValues[index] : null,
      }))
    }
    
    return data
  }, [candlesticks, showZIG, zigPriceType, zigReversalPercent])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-4">
            <BackButton />
          </div>
          <div className="bg-white shadow rounded-lg p-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">K线图表</h1>

            {/* 查询条件 */}
            <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  股票代码
                </label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="AAPL.US（美股）"
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  周期
                </label>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="1m">1分钟</option>
                  <option value="5m">5分钟</option>
                  <option value="15m">15分钟</option>
                  <option value="30m">30分钟</option>
                  <option value="60m">60分钟</option>
                  <option value="day">日线</option>
                  <option value="week">周线</option>
                  <option value="month">月线</option>
                  <option value="year">年线</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  数量
                </label>
                <input
                  type="number"
                  value={count}
                  onChange={(e) => setCount(parseInt(e.target.value) || 30)}
                  min="1"
                  max="1000"
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={fetchCandlesticks}
                  disabled={loading}
                  className="w-full px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {loading ? '查询中...' : '查询'}
                </button>
              </div>
            </div>

            {/* ZIG指标设置 */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center mb-3">
                <input
                  type="checkbox"
                  id="showZIG"
                  checked={showZIG}
                  onChange={(e) => setShowZIG(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="showZIG" className="ml-2 text-sm font-medium text-gray-700">
                  显示ZIG指标（之字转向）
                </label>
              </div>
              {showZIG && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      计算依据
                    </label>
                    <select
                      value={zigPriceType}
                      onChange={(e) => setZigPriceType(e.target.value as 'close' | 'high' | 'low')}
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="close">收盘价</option>
                      <option value="high">最高价</option>
                      <option value="low">最低价</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      转向幅度 (%)
                    </label>
                    <input
                      type="number"
                      value={zigReversalPercent}
                      onChange={(e) => setZigReversalPercent(parseFloat(e.target.value) || 5)}
                      min="0.1"
                      max="50"
                      step="0.1"
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
                {error}
              </div>
            )}

            {/* 图表 */}
            {chartData.length > 0 && (
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  收盘价走势
                  {showZIG && (
                    <span className="ml-2 text-sm font-normal text-gray-600">
                      (ZIG: {zigPriceType === 'close' ? '收盘价' : zigPriceType === 'high' ? '最高价' : '最低价'}, {zigReversalPercent}%)
                    </span>
                  )}
                </h2>
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} name="收盘价" />
                    {showZIG && (
                      <Line
                        type="monotone"
                        dataKey="zig"
                        stroke="#10b981"
                        strokeWidth={2}
                        name={`ZIG(${zigPriceType === 'close' ? '收盘价' : zigPriceType === 'high' ? '最高价' : '最低价'},${zigReversalPercent}%)`}
                        dot={false}
                        connectNulls={true}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* 数据表格 */}
            {candlesticks.length > 0 && (
              <div className="overflow-x-auto">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">K线数据</h2>
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        时间
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        开盘
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        最高
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        最低
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        收盘
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        成交量
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {candlesticks.reverse().map((c, index) => {
                      // 解析时间戳
                      let date: Date;
                      if (typeof c.timestamp === 'string') {
                        date = new Date(c.timestamp)
                      } else {
                        date = new Date(c.timestamp > 1e12 ? c.timestamp : c.timestamp * 1000)
                      }
                      
                      // 获取交易时段标签
                      const getTradeSessionLabel = (session?: number) => {
                        if (session === undefined) return ''
                        const labels: Record<number, string> = {
                          0: '盘中',
                          1: '盘前',
                          2: '盘后',
                          3: '夜盘',
                        }
                        return labels[session] || ''
                      }
                      
                      return (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <div>
                              <div>{date.toLocaleString('zh-CN', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}</div>
                              {c.trade_session !== undefined && (
                                <div className="text-xs text-gray-500 mt-1">
                                  {getTradeSessionLabel(c.trade_session)}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {c.open}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">
                            {c.high}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">
                            {c.low}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {c.close}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {c.volume.toLocaleString()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {candlesticks.length === 0 && !loading && !error && (
              <div className="text-center py-8 text-gray-500">
                暂无K线数据，请输入股票代码查询
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CandlesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center">加载中...</div>}>
      <CandlesContent />
    </Suspense>
  )
}
