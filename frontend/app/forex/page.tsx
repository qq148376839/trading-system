'use client'

import { useEffect, useState, useMemo } from 'react'
import { forexApi } from '@/lib/api'
import { calculateZIG } from '@/lib/indicators'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import AppLayout from '@/components/AppLayout'
import { Card, Select, Button, Alert, Spin, Checkbox, Row, Col, Space, Statistic, Collapse, Input } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'

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
    <AppLayout>
      <Card>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>外汇市场行情</h1>

        {/* 产品选择和K线类型 */}
        <Card style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={8}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>外汇产品</div>
              <Select
                value={selectedProduct}
                onChange={setSelectedProduct}
                style={{ width: '100%' }}
              >
                {products.map((product) => (
                  <Select.Option key={product.code} value={product.code}>
                    {product.name} ({product.code})
                  </Select.Option>
                ))}
              </Select>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>K线类型</div>
              <Select
                value={quoteType}
                onChange={setQuoteType}
                style={{ width: '100%' }}
              >
                <Select.Option value="minute">分时</Select.Option>
                <Select.Option value="5day">5日</Select.Option>
                <Select.Option value="day">日K</Select.Option>
                <Select.Option value="week">周K</Select.Option>
                <Select.Option value="month">月K</Select.Option>
                <Select.Option value="quarter">季K</Select.Option>
                <Select.Option value="year">年K</Select.Option>
              </Select>
            </Col>
            <Col xs={24} sm={24} md={8}>
              <div style={{ marginBottom: 8 }}>&nbsp;</div>
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                onClick={fetchData}
                loading={loading}
                block
              >
                刷新数据
              </Button>
            </Col>
          </Row>
        </Card>

        {/* ZIG指标设置 */}
        <Card style={{ marginBottom: 16 }}>
          <Checkbox
            checked={showZIG}
            onChange={(e) => setShowZIG(e.target.checked)}
            style={{ marginBottom: showZIG ? 16 : 0 }}
          >
            显示ZIG指标（之字转向）
          </Checkbox>
          {showZIG && (
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>计算依据</div>
                <Select
                  value={zigPriceType}
                  onChange={(value) => setZigPriceType(value)}
                  style={{ width: '100%' }}
                >
                  <Select.Option value="close">收盘价</Select.Option>
                  <Select.Option value="high">最高价</Select.Option>
                  <Select.Option value="low">最低价</Select.Option>
                </Select>
              </Col>
              <Col xs={24} sm={12}>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>转向幅度 (%)</div>
                <Input
                  type="number"
                  value={zigReversalPercent}
                  onChange={(e) => setZigReversalPercent(parseFloat(e.target.value) || 5)}
                  min={0.1}
                  max={50}
                  step={0.1}
                />
              </Col>
            </Row>
          )}
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

        {/* 实时报价 */}
        {quote && (
          <Card
            style={{
              marginBottom: 16,
              background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)',
              color: '#fff',
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#fff' }}>
              {selectedProductInfo?.name || selectedProduct} 实时报价
            </h2>
            <Row gutter={16}>
              <Col xs={12} sm={6}>
                <Statistic
                  title={<span style={{ color: 'rgba(255,255,255,0.9)' }}>最新价</span>}
                  value={quote.price || quote.lastPrice || '-'}
                  valueStyle={{ color: '#fff', fontSize: 24, fontWeight: 600 }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title={<span style={{ color: 'rgba(255,255,255,0.9)' }}>涨跌</span>}
                  value={(quote.change || 0) >= 0 ? '+' : ''}
                  suffix={quote.change || '-'}
                  valueStyle={{
                    color: (quote.change || 0) >= 0 ? '#fff' : '#fff',
                    fontSize: 24,
                    fontWeight: 600,
                  }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title={<span style={{ color: 'rgba(255,255,255,0.9)' }}>涨跌幅</span>}
                  value={(quote.changeRate || 0) >= 0 ? '+' : ''}
                  suffix={`${quote.changeRate || '-'}%`}
                  valueStyle={{
                    color: '#fff',
                    fontSize: 24,
                    fontWeight: 600,
                  }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title={<span style={{ color: 'rgba(255,255,255,0.9)' }}>代码</span>}
                  value={quote.code || selectedProduct}
                  valueStyle={{ color: '#fff', fontSize: 24, fontWeight: 600 }}
                />
              </Col>
            </Row>
          </Card>
        )}

        {/* K线图表 */}
        {chartData.length > 0 && (
          <Card style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
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
                <span style={{ marginLeft: 8, fontSize: 14, fontWeight: 400, color: '#666' }}>
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
                  stroke="#1890ff" 
                  strokeWidth={2} 
                  name="价格"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                {showZIG && (
                  <Line
                    type="monotone"
                    dataKey="zig"
                    stroke="#52c41a"
                    strokeWidth={2}
                    name={`ZIG(${zigPriceType === 'close' ? '收盘价' : zigPriceType === 'high' ? '最高价' : '最低价'},${zigReversalPercent}%)`}
                    dot={false}
                    connectNulls={true}
                    activeDot={{ r: 4 }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* 原始数据展示（调试用） */}
        {candlestick && (
          <Card>
            <Collapse
              items={[
                {
                  key: '1',
                  label: '查看原始数据（调试）',
                  children: (
                    <pre style={{ fontSize: 12, overflow: 'auto', maxHeight: 400, background: '#f5f5f5', padding: 16, borderRadius: 4 }}>
                      {JSON.stringify(candlestick, null, 2)}
                    </pre>
                  ),
                },
              ]}
            />
          </Card>
        )}

        {!loading && !quote && !candlestick && (
          <Card>
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
              暂无数据，请选择外汇产品并点击刷新
            </div>
          </Card>
        )}
      </Card>
    </AppLayout>
  )
}

