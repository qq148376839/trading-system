'use client'

import { useEffect, useState } from 'react'
import { quoteApi } from '@/lib/api'
import BackButton from '@/components/BackButton'

interface Quote {
  symbol: string
  last_done: string
  prev_close: string
  open: string
  high: string
  low: string
  volume: number
  turnover: string
  timestamp: number
}

export default function QuotePage() {
  const [symbols, setSymbols] = useState<string>('AAPL.US,TSLA.US,MSFT.US')
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchQuotes = async () => {
    if (!symbols.trim()) {
      setError('请输入股票代码')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const symbolList = symbols.split(',').map(s => s.trim()).filter(s => s)
      const response = await quoteApi.getQuote(symbolList)
      
      if (response.success && response.data?.secu_quote) {
        setQuotes(response.data.secu_quote)
      } else {
        setError('获取行情失败')
      }
    } catch (err: any) {
      setError(err.message || '获取行情失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchQuotes()
    // 每30秒自动刷新
    const interval = setInterval(fetchQuotes, 30000)
    return () => clearInterval(interval)
  }, [])

  const calculateChange = (last: string, prev: string) => {
    const lastNum = parseFloat(last)
    const prevNum = parseFloat(prev)
    const change = lastNum - prevNum
    const changePercent = ((change / prevNum) * 100).toFixed(2)
    return { change, changePercent }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-4">
            <BackButton />
          </div>
          <div className="bg-white shadow rounded-lg p-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">实时行情</h1>
            
            {/* 搜索框 */}
            <div className="mb-6">
              <div className="flex gap-4">
                <input
                  type="text"
                  value={symbols}
                  onChange={(e) => setSymbols(e.target.value)}
                  placeholder="请输入股票代码，用逗号分隔，例如：AAPL.US,TSLA.US（美股）"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={fetchQuotes}
                  disabled={loading}
                  className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {loading ? '查询中...' : '查询'}
                </button>
              </div>
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
                {error}
              </div>
            )}

            {/* 行情列表 */}
            {quotes.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        标的代码
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        最新价
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        涨跌
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        涨跌幅
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        开盘价
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        最高价
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        最低价
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        成交量
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        成交额
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {quotes.map((quote) => {
                      const { change, changePercent } = calculateChange(quote.last_done, quote.prev_close)
                      const isPositive = change >= 0

                      return (
                        <tr key={quote.symbol} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {quote.symbol}
                          </td>
                          <td className={`px-6 py-4 whitespace-nowrap text-sm font-semibold ${isPositive ? 'text-red-600' : 'text-green-600'}`}>
                            {quote.last_done}
                          </td>
                          <td className={`px-6 py-4 whitespace-nowrap text-sm ${isPositive ? 'text-red-600' : 'text-green-600'}`}>
                            {isPositive ? '+' : ''}{change.toFixed(2)}
                          </td>
                          <td className={`px-6 py-4 whitespace-nowrap text-sm ${isPositive ? 'text-red-600' : 'text-green-600'}`}>
                            {isPositive ? '+' : ''}{changePercent}%
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {quote.open}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {quote.high}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {quote.low}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {quote.volume.toLocaleString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {quote.turnover}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {quotes.length === 0 && !loading && !error && (
              <div className="text-center py-8 text-gray-500">
                暂无行情数据，请输入股票代码查询
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

