'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { optionsApi } from '@/lib/api'
import BackButton from '@/components/BackButton'
import OptionTradeModal from '@/components/OptionTradeModal'

interface OptionDetail {
  price: number
  change: number
  changeRatio: number
  priceOpen: number
  priceLastClose: number
  priceHighest: number
  priceLowest: number
  volume: number
  turnover: number
  priceBid: number
  priceAsk: number
  volumeBid: number
  volumeAsk: number
  option: {
    strikePrice: number
    contractSize: number
    openInterest: number
    premium: number
    impliedVolatility: number
    greeks: {
      delta: number
      gamma: number
      vega: number
      theta: number
      rho: number
      hpDelta: number
      hpGamma: number
      hpVega: number
      hpTheta: number
      hpRho: number
    }
    leverage: number
    effectiveLeverage: number
    intrinsicValue: number
    timeValue: number
    daysToExpiration: number
    optionType: 'Call' | 'Put'
    multiplier: number
  }
  underlyingStock: {
    code: string
    name: string
    price: number
    change: number
    changeRatio: number
  }
  marketStatus: number
  marketStatusText: string
  delayTime: number
}

export default function OptionDetailPage() {
  const params = useParams()
  const router = useRouter()
  const optionCode = params?.optionCode as string
  
  // 从URL查询参数获取optionId和underlyingStockId
  const [optionId, setOptionId] = useState<string | null>(null)
  const [underlyingStockId, setUnderlyingStockId] = useState<string | null>(null)
  
  const [detail, setDetail] = useState<OptionDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chartType, setChartType] = useState<'minute' | '5day' | 'day'>('minute')
  const [showTradeModal, setShowTradeModal] = useState(false)

  // 从URL查询参数获取optionId和underlyingStockId
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const id = searchParams.get('optionId')
    const stockId = searchParams.get('underlyingStockId')
    const symbol = searchParams.get('symbol')
    
    if (id) {
      setOptionId(id)
      
      if (stockId) {
        setUnderlyingStockId(stockId)
      } else if (symbol) {
        // 如果没有stockId但有symbol，通过API查找stockId
        optionsApi.getStrikeDates({ symbol }).then((response) => {
          if (response.success && response.data?.stockId) {
            setUnderlyingStockId(response.data.stockId)
          } else {
            setError('无法获取正股ID。请从期权链页面点击期权进入。')
          }
        }).catch(() => {
          setError('无法获取正股ID。请从期权链页面点击期权进入。')
        })
      } else {
        setError('缺少必需参数：underlyingStockId 或 symbol。请从期权链页面点击期权进入。')
      }
    } else {
      setError('缺少必需参数：optionId。请从期权链页面点击期权进入。')
    }
  }, [])

  // 获取期权详情
  const fetchOptionDetail = async () => {
    if (!optionId || !underlyingStockId) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await optionsApi.getOptionDetail({
        optionId,
        underlyingStockId,
        marketType: 2, // 美股
      })
      
      if (response.success && response.data) {
        setDetail(response.data)
      } else {
        setError('获取期权详情失败')
      }
    } catch (err: any) {
      setError(err.message || '获取期权详情失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (optionId && underlyingStockId) {
      fetchOptionDetail()
      
      // 每30秒自动刷新
      const interval = setInterval(fetchOptionDetail, 30000)
      return () => clearInterval(interval)
    }
  }, [optionId, underlyingStockId])

  // 格式化价格
  const formatPrice = (price: number) => {
    return isNaN(price) ? '--' : price.toFixed(2)
  }

  // 格式化百分比
  const formatPercentage = (percent: number) => {
    return isNaN(percent) ? '--' : `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`
  }

  // 格式化数字（带千分位）
  const formatNumber = (num: number) => {
    return isNaN(num) ? '--' : num.toLocaleString()
  }

  if (!optionId || !underlyingStockId) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          <div className="px-4 py-6 sm:px-0">
            <BackButton />
            <div className="bg-white shadow rounded-lg p-6">
              <div className="text-center py-8 text-red-600">
                {error || '缺少必需参数'}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-4">
            <BackButton />
          </div>
          
          <div className="bg-white shadow rounded-lg p-6">
            {/* 顶部信息栏 */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h1 className="text-3xl font-bold text-gray-900">
                  {optionCode || '--'}
                </h1>
                <button
                  onClick={() => setShowTradeModal(true)}
                  className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold"
                >
                  交易
                </button>
              </div>
              
              {detail && (
                <div className="flex items-center gap-4">
                  <div>
                    <div className={`text-4xl font-bold ${
                      detail.change >= 0 ? 'text-red-600' : 'text-green-600'
                    }`}>
                      {formatPrice(detail.price)}
                    </div>
                    <div className={`text-lg ${
                      detail.change >= 0 ? 'text-red-600' : 'text-green-600'
                    }`}>
                      {detail.change >= 0 ? '+' : ''}{formatPrice(detail.change)} ({formatPercentage(detail.changeRatio)})
                    </div>
                  </div>
                  
                  {detail.delayTime > 0 && (
                    <div className="text-sm text-gray-500">
                      延时{detail.delayTime}秒行情 | {detail.marketStatusText}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
                {error}
              </div>
            )}

            {/* 图表区域 */}
            {detail && (
              <div className="mb-6">
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={() => setChartType('minute')}
                    className={`px-4 py-2 rounded-md ${
                      chartType === 'minute'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    分时
                  </button>
                  <button
                    onClick={() => setChartType('5day')}
                    className={`px-4 py-2 rounded-md ${
                      chartType === '5day'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    5日
                  </button>
                  <button
                    onClick={() => setChartType('day')}
                    className={`px-4 py-2 rounded-md ${
                      chartType === 'day'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    日K
                  </button>
                </div>
                
                <div className="border border-gray-300 rounded-lg p-4 bg-gray-50">
                  <div className="text-center text-gray-500 py-20">
                    图表功能待实现
                    <br />
                    <span className="text-sm">（需要集成K线数据API）</span>
                  </div>
                </div>
              </div>
            )}

            {/* 详细信息面板 */}
            {detail && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 价格信息 */}
                <div className="border border-gray-300 rounded-lg p-4">
                  <h2 className="text-lg font-semibold mb-4">价格信息</h2>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">最高价:</span>
                      <span className="font-medium">{formatPrice(detail.priceHighest)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">最低价:</span>
                      <span className="font-medium">{formatPrice(detail.priceLowest)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">今开:</span>
                      <span className="font-medium">{formatPrice(detail.priceOpen)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">昨收:</span>
                      <span className="font-medium">{formatPrice(detail.priceLastClose)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">买盘:</span>
                      <span className="font-medium">{formatPrice(detail.priceBid)} (x{detail.volumeBid})</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">卖盘:</span>
                      <span className="font-medium">{formatPrice(detail.priceAsk)} (x{detail.volumeAsk})</span>
                    </div>
                  </div>
                </div>

                {/* 成交量信息 */}
                <div className="border border-gray-300 rounded-lg p-4">
                  <h2 className="text-lg font-semibold mb-4">成交量信息</h2>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">成交量:</span>
                      <span className="font-medium">{formatNumber(detail.volume)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">成交额:</span>
                      <span className="font-medium">{formatNumber(detail.turnover)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">未平仓合约数:</span>
                      <span className="font-medium">{formatNumber(detail.option.openInterest)}</span>
                    </div>
                  </div>
                </div>

                {/* 期权参数 */}
                <div className="border border-gray-300 rounded-lg p-4">
                  <h2 className="text-lg font-semibold mb-4">期权参数</h2>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">行权价:</span>
                      <span className="font-medium">{formatPrice(detail.option.strikePrice)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">到期日:</span>
                      <span className="font-medium">{detail.option.daysToExpiration}天</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">合约乘数:</span>
                      <span className="font-medium">{detail.option.multiplier}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">合约规模:</span>
                      <span className="font-medium">{detail.option.contractSize}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">期权类型:</span>
                      <span className="font-medium">{detail.option.optionType === 'Call' ? '看涨' : '看跌'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">隐含波动率:</span>
                      <span className="font-medium">{formatPercentage(detail.option.impliedVolatility)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">溢价:</span>
                      <span className="font-medium">{formatPercentage(detail.option.premium)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">内在价值:</span>
                      <span className="font-medium">{formatPrice(detail.option.intrinsicValue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">时间价值:</span>
                      <span className="font-medium">{formatPrice(detail.option.timeValue)}</span>
                    </div>
                  </div>
                </div>

                {/* Greeks */}
                <div className="border border-gray-300 rounded-lg p-4">
                  <h2 className="text-lg font-semibold mb-4">Greeks</h2>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Delta:</span>
                      <span className="font-medium">{formatPrice(detail.option.greeks.delta)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Gamma:</span>
                      <span className="font-medium">{formatPrice(detail.option.greeks.gamma)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Vega:</span>
                      <span className="font-medium">{formatPrice(detail.option.greeks.vega)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Theta:</span>
                      <span className="font-medium">{formatPrice(detail.option.greeks.theta)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Rho:</span>
                      <span className="font-medium">{formatPrice(detail.option.greeks.rho)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">杠杆倍数:</span>
                      <span className="font-medium">{formatPrice(detail.option.leverage)}x</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">有效杠杆:</span>
                      <span className="font-medium">{formatPrice(detail.option.effectiveLeverage)}x</span>
                    </div>
                  </div>
                </div>

                {/* 正股信息 */}
                <div className="border border-gray-300 rounded-lg p-4 md:col-span-2">
                  <h2 className="text-lg font-semibold mb-4">正股信息</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">代码:</span>
                      <span className="ml-2 font-medium">{detail.underlyingStock.code}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">名称:</span>
                      <span className="ml-2 font-medium">{detail.underlyingStock.name}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">价格:</span>
                      <span className="ml-2 font-medium">{formatPrice(detail.underlyingStock.price)}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">涨跌幅:</span>
                      <span className={`ml-2 font-medium ${
                        detail.underlyingStock.change >= 0 ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {formatPercentage(detail.underlyingStock.changeRatio)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {loading && (
              <div className="text-center py-8 text-gray-500">
                加载中...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 期权交易模态框 */}
      {showTradeModal && (
        <OptionTradeModal
          optionCode={optionCode}
          optionDetail={detail ? {
            price: detail.price,
            option: {
              strikePrice: detail.option.strikePrice,
              multiplier: detail.option.multiplier,
              optionType: detail.option.optionType,
            },
          } : null}
          onClose={() => setShowTradeModal(false)}
          onSuccess={() => {
            setShowTradeModal(false)
            // 可以在这里刷新数据或显示成功消息
          }}
        />
      )}
    </div>
  )
}

