'use client'

import { useEffect, useState, useMemo } from 'react'
import { forexApi } from '@/lib/api'
import { calculateZIG } from '@/lib/indicators'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import BackButton from '@/components/BackButton'

interface ForexProduct {
  code: string
  name: string
  stockId: string
}

interface ForexQuote {
  code?: string
  name?: string
  price?: number
  changeRate?: number
  change?: number
  [key: string]: any
}

export default function ForexPage() {
  const [products, setProducts] = useState<ForexProduct[]>([])
  const [selectedProduct, setSelectedProduct] = useState<string>('USDINDEX')
  const [quoteType, setQuoteType] = useState<string>('minute')
  const [quote, setQuote] = useState<ForexQuote | null>(null)
  const [candlestick, setCandlestick] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showZIG, setShowZIG] = useState(false)
  const [zigPriceType, setZigPriceType] = useState<'close' | 'high' | 'low'>('close')
  const [zigReversalPercent, setZigReversalPercent] = useState(5)

  // 加载产品列表
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await forexApi.getProducts()
        if (response.success && response.data?.products) {
          setProducts(response.data.products)
        }
      } catch (err: any) {
        console.error('获取外汇产品列表失败:', err)
      }
    }
    fetchProducts()
  }, [])

  // 加载报价和K线数据
  const fetchData = async () => {
    if (!selectedProduct) return

    setLoading(true)
    setError(null)

    try {
      // 并行获取报价和K线数据
      const [quoteResponse, candlestickResponse] = await Promise.all([
        forexApi.getQuote(selectedProduct),
        forexApi.getCandlestick(selectedProduct, quoteType),
      ])

      if (quoteResponse.success && quoteResponse.data?.quote) {
        setQuote(quoteResponse.data.quote)
      }

      if (candlestickResponse.success && candlestickResponse.data?.candlestick) {
        setCandlestick(candlestickResponse.data.candlestick)
      }
    } catch (err: any) {
      setError(err.message || '获取外汇数据失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [selectedProduct, quoteType])

  // 准备图表数据
  const chartData = useMemo(() => {
    if (!candlestick?.list || candlestick.list.length === 0) return []
    
    const data = candlestick.list.map((item: any, index: number) => {
      // 时间戳转换为可读格式（Unix时间戳，秒）
      const timestamp = item.time || 0
      const date = new Date(timestamp * 1000)
      const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`
      
      // 使用cc_price（实际显示价格，如100.18）而不是price（原始价格，如100181.799886）
      const price = parseFloat(item.cc_price || item.price || '0')
      
      return {
        time: timeStr,
        timestamp: timestamp,
        price: price,
        value: price, // 用于tooltip显示
        change: item.change_price || 0,
        ratio: item.ratio || '0',
        // 为了ZIG计算，需要提供high/low/close字段
        high: price, // 外汇数据通常只有price，使用price作为high/low/close
        low: price,
        close: price,
        open: price,
      }
    })
    
    // 计算ZIG指标
    if (showZIG && data.length > 0) {
      const zigValues = calculateZIG(data, zigPriceType, zigReversalPercent)
      return data.map((item: any, index: number) => ({
        ...item,
        zig: zigValues[index] !== null && zigValues[index] !== undefined ? zigValues[index] : null,
      }))
    }
    
    return data
  }, [candlestick, showZIG, zigPriceType, zigReversalPercent])

  const selectedProductInfo = products.find(p => p.code === selectedProduct)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-4">
            <BackButton />
          </div>

          <div className="bg-white shadow rounded-lg p-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-6">外汇市场行情</h1>

            {/* 产品选择和K线类型 */}
            <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  外汇产品
                </label>
                <select
                  value={selectedProduct}
                  onChange={(e) => setSelectedProduct(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {products.map((product) => (
                    <option key={product.code} value={product.code}>
                      {product.name} ({product.code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  K线类型
                </label>
                <select
                  value={quoteType}
                  onChange={(e) => setQuoteType(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="minute">分时</option>
                  <option value="5day">5日</option>
                  <option value="day">日K</option>
                  <option value="week">周K</option>
                  <option value="month">月K</option>
                  <option value="quarter">季K</option>
                  <option value="year">年K</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  onClick={fetchData}
                  disabled={loading}
                  className="w-full px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {loading ? '加载中...' : '刷新数据'}
                </button>
              </div>
            </div>

            {/* ZIG指标设置 */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center mb-3">
                <input
                  type="checkbox"
                  id="showZIGForex"
                  checked={showZIG}
                  onChange={(e) => setShowZIG(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="showZIGForex" className="ml-2 text-sm font-medium text-gray-700">
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

            {/* 实时报价 */}
            {quote && (
              <div className="mb-6 p-4 bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg shadow-lg text-white">
                <h2 className="text-lg font-semibold mb-3">
                  {selectedProductInfo?.name || selectedProduct} 实时报价
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-sm opacity-90 mb-1">最新价</div>
                    <div className="text-2xl font-bold">
                      {quote.price || quote.lastPrice || '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm opacity-90 mb-1">涨跌</div>
                    <div className={`text-2xl font-bold ${(quote.change || 0) >= 0 ? 'text-green-200' : 'text-red-200'}`}>
                      {(quote.change || 0) >= 0 ? '+' : ''}{quote.change || '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm opacity-90 mb-1">涨跌幅</div>
                    <div className={`text-2xl font-bold ${(quote.changeRate || 0) >= 0 ? 'text-green-200' : 'text-red-200'}`}>
                      {(quote.changeRate || 0) >= 0 ? '+' : ''}{quote.changeRate || '-'}%
                    </div>
                  </div>
                  <div>
                    <div className="text-sm opacity-90 mb-1">代码</div>
                    <div className="text-2xl font-bold">
                      {quote.code || selectedProduct}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* K线图表 */}
            {chartData.length > 0 && (
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  {selectedProductInfo?.name} - {
                    quoteType === 'minute' ? '分时' :
                    quoteType === '5day' ? '5日' :
                    quoteType === 'day' ? '日K' :
                    quoteType === 'week' ? '周K' :
                    quoteType === 'month' ? '月K' :
                    quoteType === 'quarter' ? '季K' :
                    quoteType === 'year' ? '年K' : ''
                  }走势
                  {showZIG && (
                    <span className="ml-2 text-sm font-normal text-gray-600">
                      (ZIG: {zigPriceType === 'close' ? '收盘价' : zigPriceType === 'high' ? '最高价' : '最低价'}, {zigReversalPercent}%)
                    </span>
                  )}
                </h2>
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="time" 
                      angle={-45}
                      textAnchor="end"
                      height={60}
                      interval="preserveStartEnd"
                    />
                    <YAxis 
                      domain={['auto', 'auto']}
                      label={{ value: '价格', angle: -90, position: 'insideLeft' }}
                    />
                    <Tooltip 
                      formatter={(value: any) => [value, '价格']}
                      labelFormatter={(label) => `时间: ${label}`}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="price" 
                      stroke="#3b82f6" 
                      strokeWidth={2} 
                      name="价格"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    {showZIG && (
                      <Line
                        type="monotone"
                        dataKey="zig"
                        stroke="#10b981"
                        strokeWidth={2}
                        name={`ZIG(${zigPriceType === 'close' ? '收盘价' : zigPriceType === 'high' ? '最高价' : '最低价'},${zigReversalPercent}%)`}
                        dot={false}
                        connectNulls={true}
                        activeDot={{ r: 4 }}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* 原始数据展示（调试用） */}
            {candlestick && (
              <div className="mt-6">
                <details className="bg-gray-50 p-4 rounded-lg">
                  <summary className="cursor-pointer text-sm font-medium text-gray-700 mb-2">
                    查看原始数据（调试）
                  </summary>
                  <pre className="text-xs overflow-auto max-h-96 bg-white p-4 rounded border">
                    {JSON.stringify(candlestick, null, 2)}
                  </pre>
                </details>
              </div>
            )}

            {!loading && !quote && !candlestick && (
              <div className="text-center py-8 text-gray-500">
                暂无数据，请选择外汇产品并点击刷新
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

