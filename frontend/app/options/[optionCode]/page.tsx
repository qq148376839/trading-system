'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { optionsApi } from '@/lib/api'
import AppLayout from '@/components/AppLayout'
import OptionTradeModal from '@/components/OptionTradeModal'
import { Card, Button, Alert, Spin, Space, Row, Col, Descriptions, Tag, Radio } from 'antd'
import { ShoppingCartOutlined } from '@ant-design/icons'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

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
    },
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
  const [klineData, setKlineData] = useState<Array<{
    timestamp: number
    open: number
    close: number
    high: number
    low: number
    volume: number
    turnover: number
    prevClose: number
    change: number
    openInterest?: number
  }>>([])
  const [minuteData, setMinuteData] = useState<Array<{
    timestamp: number
    price: number
    volume: number
    turnover: number
    changeRatio: number
    changePrice: number
  }>>([])
  const [chartLoading, setChartLoading] = useState(false)

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

  // 获取图表数据
  const fetchChartData = async () => {
    if (!optionId) return

    setChartLoading(true)
    try {
      if (chartType === 'minute') {
        // 获取分时数据
        const response = await optionsApi.getOptionMinute({
          optionId,
          marketType: 2,
        })
        if (response.success && response.data?.minuteData) {
          setMinuteData(response.data.minuteData)
        }
      } else {
        // 获取日K数据
        const response = await optionsApi.getOptionKline({
          optionId,
          marketType: 2,
          count: chartType === '5day' ? 5 : 100,
        })
        if (response.success && response.data?.klineData) {
          setKlineData(response.data.klineData)
        }
      }
    } catch (err: any) {
      console.error('获取图表数据失败:', err.message)
    } finally {
      setChartLoading(false)
    }
  }

  useEffect(() => {
    if (optionId) {
      fetchChartData()
    }
  }, [optionId, chartType])

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

  // 准备图表数据
  const chartData = useMemo(() => {
    if (chartType === 'minute') {
      return minuteData.map(item => ({
        time: new Date(item.timestamp * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        price: item.price,
        volume: item.volume,
        changeRatio: item.changeRatio,
      }))
    } else {
      const data = chartType === '5day' 
        ? klineData.slice(-5) 
        : klineData
      
      return data.map(item => ({
        date: new Date(item.timestamp * 1000).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
        close: item.close,
        open: item.open,
        high: item.high,
        low: item.low,
        volume: item.volume,
        change: item.change,
      }))
    }
  }, [chartType, minuteData, klineData])

  if (!optionId || !underlyingStockId) {
    return (
      <AppLayout>
        <Card>
          <Alert
            message={error || '缺少必需参数'}
            type="error"
            showIcon
          />
        </Card>
      </AppLayout>
    )
  }

  if (loading && !detail) {
    return (
      <AppLayout>
        <Card>
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>加载中...</div>
          </div>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <Card>
        {/* 顶部信息栏 */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>
              {optionCode || '--'}
            </h1>
            <Button
              type="primary"
              size="large"
              icon={<ShoppingCartOutlined />}
              onClick={() => setShowTradeModal(true)}
            >
              交易
            </Button>
          </div>
          
          {detail && (
            <Space size="large" align="start">
              <div>
                <div style={{
                  fontSize: 36,
                  fontWeight: 600,
                  color: detail.change >= 0 ? '#ff4d4f' : '#52c41a',
                  lineHeight: 1.2,
                }}>
                  {formatPrice(detail.price)}
                </div>
                <div style={{
                  fontSize: 16,
                  color: detail.change >= 0 ? '#ff4d4f' : '#52c41a',
                  marginTop: 4,
                }}>
                  {detail.change >= 0 ? '+' : ''}{formatPrice(detail.change)} ({formatPercentage(detail.changeRatio)})
                </div>
              </div>
              
              {detail.delayTime > 0 && (
                <div style={{ color: '#999', fontSize: 14, marginTop: 8 }}>
                  延时{detail.delayTime}秒行情 | {detail.marketStatusText}
                </div>
              )}
            </Space>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            closable
            onClose={() => setError(null)}
            style={{ marginBottom: 24 }}
          />
        )}

        {/* 图表区域 */}
        {detail && (
          <Card style={{ marginBottom: 24 }}>
            <Radio.Group
              value={chartType}
              onChange={(e) => setChartType(e.target.value)}
              style={{ marginBottom: 16 }}
            >
              <Radio.Button value="minute">分时</Radio.Button>
              <Radio.Button value="5day">5日</Radio.Button>
              <Radio.Button value="day">日K</Radio.Button>
            </Radio.Group>
            
            {chartLoading ? (
              <div style={{ textAlign: 'center', padding: '80px 0' }}>
                <Spin size="large" />
                <div style={{ marginTop: 16, color: '#999' }}>加载图表数据...</div>
              </div>
            ) : chartData.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#999', padding: '80px 0' }}>
                暂无图表数据
              </div>
            ) : chartType === 'minute' ? (
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis 
                    domain={['dataMin - 0.1', 'dataMax + 0.1']}
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => `$${value.toFixed(2)}`}
                  />
                  <Tooltip 
                    formatter={(value: number) => [`$${value.toFixed(2)}`, '价格']}
                    labelFormatter={(label) => `时间: ${label}`}
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #d9d9d9',
                      borderRadius: 4,
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke="#1890ff"
                    strokeWidth={2}
                    dot={false}
                    name="价格"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis 
                    domain={['dataMin - 0.1', 'dataMax + 0.1']}
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => `$${value.toFixed(2)}`}
                  />
                  <Tooltip 
                    formatter={(value: number) => [`$${value.toFixed(2)}`, '收盘价']}
                    labelFormatter={(label) => `日期: ${label}`}
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #d9d9d9',
                      borderRadius: 4,
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="close"
                    stroke="#1890ff"
                    strokeWidth={2}
                    dot={false}
                    name="收盘价"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>
        )}

        {/* 详细信息面板 */}
        {detail && (
          <Row gutter={[16, 16]}>
            {/* 价格信息 */}
            <Col xs={24} md={12}>
              <Card title="价格信息" size="small">
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="最高价">{formatPrice(detail.priceHighest)}</Descriptions.Item>
                  <Descriptions.Item label="最低价">{formatPrice(detail.priceLowest)}</Descriptions.Item>
                  <Descriptions.Item label="今开">{formatPrice(detail.priceOpen)}</Descriptions.Item>
                  <Descriptions.Item label="昨收">{formatPrice(detail.priceLastClose)}</Descriptions.Item>
                  <Descriptions.Item label="买盘">{formatPrice(detail.priceBid)} (x{detail.volumeBid})</Descriptions.Item>
                  <Descriptions.Item label="卖盘">{formatPrice(detail.priceAsk)} (x{detail.volumeAsk})</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>

            {/* 成交量信息 */}
            <Col xs={24} md={12}>
              <Card title="成交量信息" size="small">
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="成交量">{formatNumber(detail.volume)}</Descriptions.Item>
                  <Descriptions.Item label="成交额">{formatNumber(detail.turnover)}</Descriptions.Item>
                  <Descriptions.Item label="未平仓合约数">{formatNumber(detail.option.openInterest)}</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>

            {/* 期权参数 */}
            <Col xs={24} md={12}>
              <Card title="期权参数" size="small">
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="行权价">{formatPrice(detail.option.strikePrice)}</Descriptions.Item>
                  <Descriptions.Item label="到期日">{detail.option.daysToExpiration}天</Descriptions.Item>
                  <Descriptions.Item label="合约乘数">{detail.option.multiplier}</Descriptions.Item>
                  <Descriptions.Item label="合约规模">{detail.option.contractSize}</Descriptions.Item>
                  <Descriptions.Item label="期权类型">
                    <Tag color={detail.option.optionType === 'Call' ? 'red' : 'green'}>
                      {detail.option.optionType === 'Call' ? '看涨' : '看跌'}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="隐含波动率">{formatPercentage(detail.option.impliedVolatility)}</Descriptions.Item>
                  <Descriptions.Item label="溢价">{formatPercentage(detail.option.premium)}</Descriptions.Item>
                  <Descriptions.Item label="内在价值">{formatPrice(detail.option.intrinsicValue)}</Descriptions.Item>
                  <Descriptions.Item label="时间价值">{formatPrice(detail.option.timeValue)}</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>

            {/* Greeks */}
            <Col xs={24} md={12}>
              <Card title="Greeks" size="small">
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="Delta">{formatPrice(detail.option.greeks.delta)}</Descriptions.Item>
                  <Descriptions.Item label="Gamma">{formatPrice(detail.option.greeks.gamma)}</Descriptions.Item>
                  <Descriptions.Item label="Vega">{formatPrice(detail.option.greeks.vega)}</Descriptions.Item>
                  <Descriptions.Item label="Theta">{formatPrice(detail.option.greeks.theta)}</Descriptions.Item>
                  <Descriptions.Item label="Rho">{formatPrice(detail.option.greeks.rho)}</Descriptions.Item>
                  <Descriptions.Item label="杠杆倍数">{formatPrice(detail.option.leverage)}x</Descriptions.Item>
                  <Descriptions.Item label="有效杠杆">{formatPrice(detail.option.effectiveLeverage)}x</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>

            {/* 正股信息 */}
            <Col xs={24}>
              <Card title="正股信息" size="small">
                <Descriptions column={{ xs: 1, sm: 2, md: 4 }}>
                  <Descriptions.Item label="代码">{detail.underlyingStock.code}</Descriptions.Item>
                  <Descriptions.Item label="名称">{detail.underlyingStock.name}</Descriptions.Item>
                  <Descriptions.Item label="价格">{formatPrice(detail.underlyingStock.price)}</Descriptions.Item>
                  <Descriptions.Item label="涨跌幅">
                    <span style={{ color: detail.underlyingStock.change >= 0 ? '#ff4d4f' : '#52c41a' }}>
                      {formatPercentage(detail.underlyingStock.changeRatio)}
                    </span>
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
          </Row>
        )}
      </Card>

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
    </AppLayout>
  )
}

