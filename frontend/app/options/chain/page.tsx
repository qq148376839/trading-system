'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { optionsApi, quoteApi } from '@/lib/api'
import AppLayout from '@/components/AppLayout'
import { Card, Input, Button, Table, Tag, Space, Alert, Spin, AutoComplete, message } from 'antd'
import { SearchOutlined } from '@ant-design/icons'

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

  const optionChainColumns = [
    {
      title: '成交量',
      key: 'callVolume',
      render: (_: any, record: OptionChainRow) => record.callOption?.openInterest || '--',
    },
    {
      title: '涨跌额',
      key: 'callChange',
      render: () => '--',
    },
    {
      title: '涨跌幅',
      key: 'callChangePercent',
      render: () => '--',
    },
    {
      title: '最新价',
      key: 'callPrice',
      render: (_: any, record: OptionChainRow) => (
        record.callOption ? (
          <span
            style={{ color: '#ff4d4f', fontWeight: 600, cursor: 'pointer' }}
            onClick={() => handleOptionClick(record.callOption!.optionId, record.callOption!.code)}
            title="点击查看详情"
          >
            {record.callOption.code}
          </span>
        ) : '--'
      ),
    },
    {
      title: '卖盘',
      key: 'callAsk',
      render: () => '--',
    },
    {
      title: '买盘',
      key: 'callBid',
      render: () => '--',
    },
    {
      title: '行权价',
      key: 'strikePrice',
      render: (_: any, record: OptionChainRow) => {
        const strikePrice = record.callOption?.strikePrice || record.putOption?.strikePrice || '0'
        const isHighlighted = highlightedStrike === strikePrice
        return (
          <div
            style={{
              background: isHighlighted ? '#fffbe6' : '#fafafa',
              padding: '8px',
              fontWeight: 500,
              textAlign: 'center',
              border: isHighlighted ? '2px solid #faad14' : 'none',
            }}
          >
            {formatPrice(strikePrice)}
          </div>
        )
      },
    },
    {
      title: '买盘',
      key: 'putBid',
      render: () => '--',
    },
    {
      title: '卖盘',
      key: 'putAsk',
      render: () => '--',
    },
    {
      title: '最新价',
      key: 'putPrice',
      render: (_: any, record: OptionChainRow) => (
        record.putOption ? (
          <span
            style={{ color: '#52c41a', fontWeight: 600, cursor: 'pointer' }}
            onClick={() => handleOptionClick(record.putOption!.optionId, record.putOption!.code)}
            title="点击查看详情"
          >
            {record.putOption.code}
          </span>
        ) : '--'
      ),
    },
    {
      title: '涨跌幅',
      key: 'putChangePercent',
      render: () => '--',
    },
    {
      title: '涨跌额',
      key: 'putChange',
      render: () => '--',
    },
    {
      title: '成交量',
      key: 'putVolume',
      render: (_: any, record: OptionChainRow) => record.putOption?.openInterest || '--',
    },
  ]

  return (
    <AppLayout>
      <Card>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>期权链</h1>
        
        {/* 股票搜索框 */}
        <Card style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>股票代码</div>
          <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
            <AutoComplete
              value={symbol}
              onChange={(value) => {
                setSymbol(value)
                searchStock(value)
              }}
              onFocus={() => {
                if (searchSuggestions.length > 0) {
                  setShowSuggestions(true)
                }
              }}
              onBlur={() => {
                setTimeout(() => setShowSuggestions(false), 200)
              }}
              options={showSuggestions ? searchSuggestions.map((stock) => ({
                value: stock.symbol,
                label: (
                  <div>
                    <div style={{ fontWeight: 500 }}>{stock.symbol}</div>
                    <div style={{ fontSize: 12, color: '#999' }}>
                      {stock.name_cn || stock.name_en}
                    </div>
                  </div>
                ),
              })) : []}
              placeholder="请输入股票代码，例如：TSLA.US"
              style={{ flex: 1 }}
              onSelect={(value) => selectStock(value)}
            />
            <Button
              type="primary"
              icon={<SearchOutlined />}
              onClick={fetchStrikeDates}
              loading={loading}
              disabled={!symbol.trim()}
            >
              查询
            </Button>
          </Space.Compact>
        </Card>

        {/* 错误提示 */}
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

        {/* 成交量统计 */}
        {volStats && (
          <Alert
            message={
              <Space split={<span style={{ color: '#d9d9d9' }}>|</span>}>
                <span>
                  <span style={{ color: '#666' }}>看涨期权成交量: </span>
                  <span style={{ fontWeight: 600, color: '#ff4d4f' }}>{volStats.callNum}</span>
                  <span style={{ color: '#666', marginLeft: 8 }}>({volStats.callRatio}%)</span>
                </span>
                <span>
                  <span style={{ color: '#666' }}>看跌期权成交量: </span>
                  <span style={{ fontWeight: 600, color: '#52c41a' }}>{volStats.putNum}</span>
                  <span style={{ color: '#666', marginLeft: 8 }}>({volStats.putRatio}%)</span>
                </span>
              </Space>
            }
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        {/* 到期日期选择器 */}
        {strikeDates.length > 0 && (
          <Card style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>到期日期</div>
            <Space wrap>
              {strikeDates.map((date) => (
                <Button
                  key={date.strikeDate}
                  type={selectedStrikeDate === date.strikeDate ? 'primary' : 'default'}
                  disabled={date.expiration === 0}
                  onClick={() => setSelectedStrikeDate(date.strikeDate)}
                >
                  {formatDate(date.strikeDate)}{date.suffix}
                  {date.leftDay > 0 && (
                    <span style={{ marginLeft: 4, fontSize: 12 }}>({date.leftDay}天)</span>
                  )}
                </Button>
              ))}
            </Space>
          </Card>
        )}

        {/* 正股价格显示 */}
        {underlyingPrice !== null && (
          <Alert
            message={
              <Space>
                <span style={{ color: '#666' }}>正股当前价格:</span>
                <span style={{ fontSize: 18, fontWeight: 600, color: '#1890ff' }}>
                  {underlyingPrice.toFixed(2)}
                </span>
                {highlightedStrike && (
                  <span style={{ color: '#999', fontSize: 12 }}>
                    (已高亮最近行权价: {highlightedStrike})
                  </span>
                )}
              </Space>
            }
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        {/* 期权链表格 */}
        {optionChain.length > 0 && (
          <Card>
            <div style={{ position: 'relative', maxHeight: '70vh', overflow: 'auto' }}>
              <table ref={tableRef} style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 20, background: '#fff' }}>
                  <tr>
                    <th colSpan={6} style={{ padding: '12px', textAlign: 'center', background: '#fff1f0', border: '1px solid #d9d9d9' }}>
                      看涨期权 (Call)
                    </th>
                    <th style={{ padding: '12px', textAlign: 'center', background: '#fafafa', border: '1px solid #d9d9d9' }}>
                      行权价
                    </th>
                    <th colSpan={6} style={{ padding: '12px', textAlign: 'center', background: '#f6ffed', border: '1px solid #d9d9d9' }}>
                      看跌期权 (Put)
                    </th>
                  </tr>
                  <tr>
                    <th style={{ padding: '8px', fontSize: 12, fontWeight: 500, border: '1px solid #d9d9d9' }}>成交量</th>
                    <th style={{ padding: '8px', fontSize: 12, fontWeight: 500, border: '1px solid #d9d9d9' }}>涨跌额</th>
                    <th style={{ padding: '8px', fontSize: 12, fontWeight: 500, border: '1px solid #d9d9d9' }}>涨跌幅</th>
                    <th style={{ padding: '8px', fontSize: 12, fontWeight: 500, border: '1px solid #d9d9d9' }}>最新价</th>
                    <th style={{ padding: '8px', fontSize: 12, fontWeight: 500, border: '1px solid #d9d9d9' }}>卖盘</th>
                    <th style={{ padding: '8px', fontSize: 12, fontWeight: 500, border: '1px solid #d9d9d9' }}>买盘</th>
                    <th style={{ padding: '8px', fontSize: 12, fontWeight: 500, border: '1px solid #d9d9d9', background: '#fafafa' }}>行权价</th>
                    <th style={{ padding: '8px', fontSize: 12, fontWeight: 500, border: '1px solid #d9d9d9' }}>买盘</th>
                    <th style={{ padding: '8px', fontSize: 12, fontWeight: 500, border: '1px solid #d9d9d9' }}>卖盘</th>
                    <th style={{ padding: '8px', fontSize: 12, fontWeight: 500, border: '1px solid #d9d9d9' }}>最新价</th>
                    <th style={{ padding: '8px', fontSize: 12, fontWeight: 500, border: '1px solid #d9d9d9' }}>涨跌幅</th>
                    <th style={{ padding: '8px', fontSize: 12, fontWeight: 500, border: '1px solid #d9d9d9' }}>涨跌额</th>
                    <th style={{ padding: '8px', fontSize: 12, fontWeight: 500, border: '1px solid #d9d9d9' }}>成交量</th>
                  </tr>
                </thead>
                <tbody>
                  {optionChain.map((row, index) => {
                    const strikePrice = row.callOption?.strikePrice || row.putOption?.strikePrice || '0'
                    const isHighlighted = highlightedStrike === strikePrice
                    
                    return (
                      <tr
                        key={index}
                        ref={(el) => {
                          if (el) rowRefs.current.set(strikePrice, el)
                        }}
                        style={{
                          background: isHighlighted ? '#fffbe6' : undefined,
                          border: isHighlighted ? '2px solid #faad14' : undefined,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#f5f5f5'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = isHighlighted ? '#fffbe6' : undefined
                        }}
                      >
                        {/* 看涨期权数据 */}
                        {row.callOption ? (
                          <>
                            <td style={{ padding: '8px', fontSize: 12, border: '1px solid #d9d9d9', textAlign: 'right' }}>
                              {row.callOption.openInterest || '--'}
                            </td>
                            <td style={{ padding: '8px', fontSize: 12, color: '#ff4d4f', border: '1px solid #d9d9d9', textAlign: 'right' }}>--</td>
                            <td style={{ padding: '8px', fontSize: 12, color: '#ff4d4f', border: '1px solid #d9d9d9', textAlign: 'right' }}>--</td>
                            <td
                              style={{ padding: '8px', fontSize: 12, color: '#ff4d4f', fontWeight: 600, cursor: 'pointer', border: '1px solid #d9d9d9', textAlign: 'center' }}
                              onClick={() => handleOptionClick(row.callOption!.optionId, row.callOption!.code)}
                              title="点击查看详情"
                            >
                              {row.callOption.code}
                            </td>
                            <td style={{ padding: '8px', fontSize: 12, border: '1px solid #d9d9d9', textAlign: 'right' }}>--</td>
                            <td style={{ padding: '8px', fontSize: 12, border: '1px solid #d9d9d9', textAlign: 'right' }}>--</td>
                          </>
                        ) : (
                          <td colSpan={6} style={{ padding: '8px', fontSize: 12, color: '#999', textAlign: 'center', border: '1px solid #d9d9d9' }}>--</td>
                        )}
                        
                        {/* 行权价 */}
                        <td style={{ padding: '8px', fontSize: 14, fontWeight: 500, background: '#fafafa', textAlign: 'center', border: '1px solid #d9d9d9' }}>
                          {formatPrice(strikePrice)}
                        </td>
                        
                        {/* 看跌期权数据 */}
                        {row.putOption ? (
                          <>
                            <td style={{ padding: '8px', fontSize: 12, border: '1px solid #d9d9d9', textAlign: 'right' }}>--</td>
                            <td style={{ padding: '8px', fontSize: 12, border: '1px solid #d9d9d9', textAlign: 'right' }}>--</td>
                            <td
                              style={{ padding: '8px', fontSize: 12, color: '#52c41a', fontWeight: 600, cursor: 'pointer', border: '1px solid #d9d9d9', textAlign: 'center' }}
                              onClick={() => handleOptionClick(row.putOption!.optionId, row.putOption!.code)}
                              title="点击查看详情"
                            >
                              {row.putOption.code}
                            </td>
                            <td style={{ padding: '8px', fontSize: 12, color: '#52c41a', border: '1px solid #d9d9d9', textAlign: 'right' }}>--</td>
                            <td style={{ padding: '8px', fontSize: 12, color: '#52c41a', border: '1px solid #d9d9d9', textAlign: 'right' }}>--</td>
                            <td style={{ padding: '8px', fontSize: 12, border: '1px solid #d9d9d9', textAlign: 'right' }}>
                              {row.putOption.openInterest || '--'}
                            </td>
                          </>
                        ) : (
                          <td colSpan={6} style={{ padding: '8px', fontSize: 12, color: '#999', textAlign: 'center', border: '1px solid #d9d9d9' }}>--</td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Alert
              message="注意"
              description={
                <div>
                  <p>期权链数据需要点击期权获取实时行情。当前显示的是基础信息（行权价、未平仓合约数）。</p>
                  <p>点击期权代码可查看详细信息和实时价格。</p>
                </div>
              }
              type="info"
              showIcon
              style={{ marginTop: 16 }}
            />
          </Card>
        )}

        {optionChain.length === 0 && !loading && !error && strikeDates.length > 0 && (
          <Card>
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
              请选择到期日期查看期权链
            </div>
          </Card>
        )}

        {strikeDates.length === 0 && !loading && !error && (
          <Card>
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
              请输入股票代码查询期权
            </div>
          </Card>
        )}
      </Card>
    </AppLayout>
  )
}

