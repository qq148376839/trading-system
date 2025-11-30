'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { optionsApi, quoteApi } from '@/lib/api'
import BackButton from '@/components/BackButton'

interface StrikeDate {
  strikeDate: number
  expiration: number
  suffix: string
  leftDay: number
}

interface OptionInfo {
  optionId: string
  optionType: number
  code: string
  strikePrice: string
  strikeDate: number
  openInterest: string
}

interface OptionChainRow {
  callOption?: OptionInfo
  putOption?: OptionInfo
}

export default function OptionChainPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [symbol, setSymbol] = useState<string>(searchParams.get('symbol') || 'TSLA.US')
  const [stockId, setStockId] = useState<string | null>(null)
  const [strikeDates, setStrikeDates] = useState<StrikeDate[]>([])
  const [selectedStrikeDate, setSelectedStrikeDate] = useState<number | null>(null)
  const [optionChain, setOptionChain] = useState<OptionChainRow[]>([])
  const [volStats, setVolStats] = useState<{
    callNum: string
    putNum: string
    callRatio: number
    putRatio: number
    total: number
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchSuggestions, setSearchSuggestions] = useState<Array<{
    symbol: string
    name_cn: string
    name_en: string
  }>>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [underlyingPrice, setUnderlyingPrice] = useState<number | null>(null)
  const [highlightedStrike, setHighlightedStrike] = useState<string | null>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())

  // 搜索股票
  const searchStock = async (keyword: string) => {
    if (!keyword.trim()) {
      setSearchSuggestions([])
      return
    }

    try {
      const response = await quoteApi.getSecurityList(keyword.trim())
      if (response.success && response.data?.securities) {
        setSearchSuggestions(response.data.securities.slice(0, 10))
        setShowSuggestions(true)
      }
    } catch (err) {
      console.error('搜索股票失败:', err)
    }
  }

  // 选择股票
  const selectStock = (selectedSymbol: string) => {
    setSymbol(selectedSymbol)
    setShowSuggestions(false)
    setSearchSuggestions([])
    // 更新URL
    router.push(`/options/chain?symbol=${encodeURIComponent(selectedSymbol)}`)
  }

  // 获取期权到期日期列表
  const fetchStrikeDates = async () => {
    if (!symbol.trim()) {
      setError('请输入股票代码')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // 先通过symbol获取strikeDates（API内部会自动查找stockId）
      const response = await optionsApi.getStrikeDates({ symbol })
      
      if (response.success && response.data) {
        const dates = response.data.strikeDates || []
        setStrikeDates(dates)
        setVolStats(response.data.vol || null)
        
        // 保存stockId供后续使用
        if (response.data.stockId) {
          setStockId(response.data.stockId)
        }
        
        // 自动选择第一个未过期的到期日期
        const firstActive = dates.find(d => d.expiration === 1)
        if (firstActive) {
          setSelectedStrikeDate(firstActive.strikeDate)
        } else if (dates.length > 0) {
          setSelectedStrikeDate(dates[0].strikeDate)
        }
      } else {
        setError('获取期权到期日期列表失败')
      }
    } catch (err: any) {
      setError(err.message || '获取期权到期日期列表失败')
    } finally {
      setLoading(false)
    }
  }

  // 获取期权链数据
  const fetchOptionChain = async (strikeDate: number) => {
    if (!symbol.trim()) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await optionsApi.getOptionChain({
        symbol,
        strikeDate,
      })
      
      if (response.success && response.data?.chain) {
        setOptionChain(response.data.chain)
      } else {
        setError('获取期权链失败')
      }
    } catch (err: any) {
      setError(err.message || '获取期权链失败')
    } finally {
      setLoading(false)
    }
  }

  // 格式化日期
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}/${month}/${day}`
  }

  // 格式化价格
  const formatPrice = (price: string | number) => {
    const num = typeof price === 'string' ? parseFloat(price) : price
    return isNaN(num) ? '--' : num.toFixed(2)
  }

  // 点击期权跳转到详情页
  const handleOptionClick = (optionId: string, optionCode: string) => {
    if (stockId) {
      router.push(`/options/${optionCode}?optionId=${optionId}&underlyingStockId=${stockId}`)
    } else if (symbol) {
      // 如果没有stockId但有symbol，传递symbol让详情页查找
      router.push(`/options/${optionCode}?optionId=${optionId}&symbol=${encodeURIComponent(symbol)}`)
    } else {
      setError('无法获取正股信息，请重新查询')
    }
  }

  // 初始化：获取到期日期列表
  useEffect(() => {
    if (symbol) {
      fetchStrikeDates()
    }
  }, [symbol])

  // 获取正股当前价格
  const fetchUnderlyingQuote = async () => {
    if (!symbol || !stockId) return
    
    try {
      const response = await optionsApi.getUnderlyingQuote({ stockId })
      if (response.success && response.data) {
        setUnderlyingPrice(response.data.price)
      }
    } catch (err) {
      console.error('获取正股行情失败:', err)
    }
  }

  // 计算最近行权价并滚动
  useEffect(() => {
    if (optionChain.length > 0 && underlyingPrice !== null) {
      // 找到最近的行权价
      let minDiff = Infinity
      let closestStrike: string | null = null
      
      optionChain.forEach((row) => {
        const strikePrice = parseFloat(row.callOption?.strikePrice || row.putOption?.strikePrice || '0')
        const diff = Math.abs(strikePrice - underlyingPrice)
        if (diff < minDiff) {
          minDiff = diff
          closestStrike = strikePrice.toFixed(2)
        }
      })
      
      if (closestStrike) {
        setHighlightedStrike(closestStrike)
        
        // 延迟滚动，确保DOM已渲染
        setTimeout(() => {
          const rowElement = rowRefs.current.get(closestStrike!)
          if (rowElement) {
            rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }, 300)
      }
    }
  }, [optionChain, underlyingPrice])

  // 当选择到期日期时，获取期权链
  useEffect(() => {
    if (selectedStrikeDate) {
      fetchOptionChain(selectedStrikeDate)
    }
  }, [selectedStrikeDate, symbol])

  // 在获取期权链后获取正股价格
  useEffect(() => {
    if (optionChain.length > 0 && stockId) {
      fetchUnderlyingQuote()
    }
  }, [optionChain, stockId])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-4">
            <BackButton />
          </div>
          
          <div className="bg-white shadow rounded-lg p-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">期权链</h1>
            
            {/* 股票搜索框 */}
            <div className="mb-6 relative">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                股票代码
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => {
                    setSymbol(e.target.value)
                    searchStock(e.target.value)
                  }}
                  onFocus={() => {
                    if (searchSuggestions.length > 0) {
                      setShowSuggestions(true)
                    }
                  }}
                  placeholder="请输入股票代码，例如：TSLA.US"
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                
                {/* 搜索建议下拉框 */}
                {showSuggestions && searchSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                    {searchSuggestions.map((stock) => (
                      <div
                        key={stock.symbol}
                        onClick={() => selectStock(stock.symbol)}
                        className="px-4 py-2 hover:bg-gray-100 cursor-pointer"
                      >
                        <div className="font-medium">{stock.symbol}</div>
                        <div className="text-sm text-gray-500">
                          {stock.name_cn || stock.name_en}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <button
                onClick={fetchStrikeDates}
                disabled={loading || !symbol.trim()}
                className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
              >
                {loading ? '查询中...' : '查询'}
              </button>
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
                {error}
              </div>
            )}

            {/* 成交量统计 */}
            {volStats && (
              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-gray-600">看涨期权成交量: </span>
                    <span className="font-semibold text-red-600">{volStats.callNum}</span>
                    <span className="text-sm text-gray-600 ml-2">({volStats.callRatio}%)</span>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">看跌期权成交量: </span>
                    <span className="font-semibold text-green-600">{volStats.putNum}</span>
                    <span className="text-sm text-gray-600 ml-2">({volStats.putRatio}%)</span>
                  </div>
                </div>
              </div>
            )}

            {/* 到期日期选择器 */}
            {strikeDates.length > 0 && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  到期日期
                </label>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {strikeDates.map((date) => (
                    <button
                      key={date.strikeDate}
                      onClick={() => setSelectedStrikeDate(date.strikeDate)}
                      className={`px-4 py-2 rounded-md whitespace-nowrap ${
                        selectedStrikeDate === date.strikeDate
                          ? 'bg-blue-600 text-white'
                          : date.expiration === 0
                          ? 'bg-gray-200 text-gray-500'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {formatDate(date.strikeDate)}{date.suffix}
                      {date.leftDay > 0 && (
                        <span className="ml-1 text-xs">({date.leftDay}天)</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 正股价格显示 */}
            {underlyingPrice !== null && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">正股当前价格:</span>
                  <span className="text-lg font-bold text-blue-600">{underlyingPrice.toFixed(2)}</span>
                  {highlightedStrike && (
                    <span className="text-sm text-gray-500">
                      (已高亮最近行权价: {highlightedStrike})
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 期权链表格 */}
            {optionChain.length > 0 && (
              <div className="relative" style={{ maxHeight: '70vh', overflow: 'auto' }}>
                <table ref={tableRef} className="min-w-full divide-y divide-gray-200 border border-gray-300">
                  <thead className="bg-gray-50 sticky top-0 z-20 shadow-sm">
                    <tr>
                      {/* 看涨期权列 */}
                      <th colSpan={6} className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase bg-red-50">
                        看涨期权 (Call)
                      </th>
                      {/* 行权价列 */}
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase bg-gray-100">
                        行权价
                      </th>
                      {/* 看跌期权列 */}
                      <th colSpan={6} className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase bg-green-50">
                        看跌期权 (Put)
                      </th>
                    </tr>
                    <tr>
                      {/* 看涨期权表头 */}
                      <th className="px-2 py-2 text-xs font-medium text-gray-500">成交量</th>
                      <th className="px-2 py-2 text-xs font-medium text-gray-500">涨跌额</th>
                      <th className="px-2 py-2 text-xs font-medium text-gray-500">涨跌幅</th>
                      <th className="px-2 py-2 text-xs font-medium text-gray-500">最新价</th>
                      <th className="px-2 py-2 text-xs font-medium text-gray-500">卖盘</th>
                      <th className="px-2 py-2 text-xs font-medium text-gray-500">买盘</th>
                      {/* 行权价表头 */}
                      <th className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-100">行权价</th>
                      {/* 看跌期权表头 */}
                      <th className="px-2 py-2 text-xs font-medium text-gray-500">买盘</th>
                      <th className="px-2 py-2 text-xs font-medium text-gray-500">卖盘</th>
                      <th className="px-2 py-2 text-xs font-medium text-gray-500">最新价</th>
                      <th className="px-2 py-2 text-xs font-medium text-gray-500">涨跌幅</th>
                      <th className="px-2 py-2 text-xs font-medium text-gray-500">涨跌额</th>
                      <th className="px-2 py-2 text-xs font-medium text-gray-500">成交量</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {optionChain.map((row, index) => {
                      const strikePrice = row.callOption?.strikePrice || row.putOption?.strikePrice || '0'
                      const isHighlighted = highlightedStrike === strikePrice
                      
                      return (
                        <tr
                          key={index}
                          ref={(el) => {
                            if (el) rowRefs.current.set(strikePrice, el)
                          }}
                          className={`hover:bg-gray-50 ${isHighlighted ? 'bg-yellow-100 border-2 border-yellow-400' : ''}`}
                        >
                          {/* 看涨期权数据 */}
                          {row.callOption ? (
                            <>
                              <td className="px-2 py-2 text-xs text-gray-600">
                                {row.callOption.openInterest || '--'}
                              </td>
                              <td className="px-2 py-2 text-xs text-red-600">--</td>
                              <td className="px-2 py-2 text-xs text-red-600">--</td>
                              <td 
                                className="px-2 py-2 text-xs text-red-600 font-semibold cursor-pointer hover:underline"
                                onClick={() => handleOptionClick(row.callOption!.optionId, row.callOption!.code)}
                                title="点击查看详情"
                              >
                                {row.callOption.code}
                              </td>
                              <td className="px-2 py-2 text-xs text-gray-600">--</td>
                              <td className="px-2 py-2 text-xs text-gray-600">--</td>
                            </>
                          ) : (
                            <td colSpan={6} className="px-2 py-2 text-xs text-gray-400 text-center">--</td>
                          )}
                          
                          {/* 行权价 */}
                          <td className="px-4 py-2 text-sm font-medium text-gray-900 bg-gray-50 text-center">
                            {formatPrice(strikePrice)}
                          </td>
                          
                          {/* 看跌期权数据 */}
                          {row.putOption ? (
                            <>
                              <td className="px-2 py-2 text-xs text-gray-600">--</td>
                              <td className="px-2 py-2 text-xs text-gray-600">--</td>
                              <td 
                                className="px-2 py-2 text-xs text-green-600 font-semibold cursor-pointer hover:underline"
                                onClick={() => handleOptionClick(row.putOption!.optionId, row.putOption!.code)}
                                title="点击查看详情"
                              >
                                {row.putOption.code}
                              </td>
                              <td className="px-2 py-2 text-xs text-green-600">--</td>
                              <td className="px-2 py-2 text-xs text-green-600">--</td>
                              <td className="px-2 py-2 text-xs text-gray-600">
                                {row.putOption.openInterest || '--'}
                              </td>
                            </>
                          ) : (
                            <td colSpan={6} className="px-2 py-2 text-xs text-gray-400 text-center">--</td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                
                <div className="mt-4 text-sm text-gray-500">
                  <p>注意：期权链数据需要点击期权获取实时行情。当前显示的是基础信息（行权价、未平仓合约数）。</p>
                  <p>点击期权代码可查看详细信息和实时价格。</p>
                </div>
              </div>
            )}

            {optionChain.length === 0 && !loading && !error && strikeDates.length > 0 && (
              <div className="text-center py-8 text-gray-500">
                请选择到期日期查看期权链
              </div>
            )}

            {strikeDates.length === 0 && !loading && !error && (
              <div className="text-center py-8 text-gray-500">
                请输入股票代码查询期权
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

