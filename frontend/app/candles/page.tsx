'use client'

import { useEffect, useState, Suspense, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { candlesticksApi } from '@/lib/api'
import { calculateZIG } from '@/lib/indicators'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import AppLayout from '@/components/AppLayout'
import { Card, Input, Select, Button, Table, Alert, Spin, Checkbox, Row, Col, Space, Tag } from 'antd'
import { SearchOutlined } from '@ant-design/icons'

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

  const tableColumns = [
    {
      title: '时间',
      key: 'timestamp',
      render: (_: any, record: Candlestick) => {
        let date: Date;
        if (typeof record.timestamp === 'string') {
          date = new Date(record.timestamp)
        } else {
          date = new Date(record.timestamp > 1e12 ? record.timestamp : record.timestamp * 1000)
        }
        
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
          <div>
            <div>{date.toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}</div>
            {record.trade_session !== undefined && (
              <Tag size="small" style={{ marginTop: 4 }}>
                {getTradeSessionLabel(record.trade_session)}
              </Tag>
            )}
          </div>
        )
      },
    },
    {
      title: '开盘',
      key: 'open',
      dataIndex: 'open',
    },
    {
      title: '最高',
      key: 'high',
      dataIndex: 'high',
      render: (text: string) => <span style={{ color: '#ff4d4f' }}>{text}</span>,
    },
    {
      title: '最低',
      key: 'low',
      dataIndex: 'low',
      render: (text: string) => <span style={{ color: '#52c41a' }}>{text}</span>,
    },
    {
      title: '收盘',
      key: 'close',
      dataIndex: 'close',
      render: (text: string) => <span style={{ fontWeight: 500 }}>{text}</span>,
    },
    {
      title: '成交量',
      key: 'volume',
      dataIndex: 'volume',
      render: (volume: number) => volume.toLocaleString(),
    },
  ]

  return (
    <AppLayout>
      <Card>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>K线图表</h1>

        {/* 查询条件 */}
        <Card style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col xs={24} sm={8} md={6}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>股票代码</div>
              <Input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="AAPL.US（美股）"
                onPressEnter={fetchCandlesticks}
              />
            </Col>
            <Col xs={24} sm={8} md={6}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>周期</div>
              <Select
                value={period}
                onChange={setPeriod}
                style={{ width: '100%' }}
              >
                <Select.Option value="1m">1分钟</Select.Option>
                <Select.Option value="5m">5分钟</Select.Option>
                <Select.Option value="15m">15分钟</Select.Option>
                <Select.Option value="30m">30分钟</Select.Option>
                <Select.Option value="60m">60分钟</Select.Option>
                <Select.Option value="day">日线</Select.Option>
                <Select.Option value="week">周线</Select.Option>
                <Select.Option value="month">月线</Select.Option>
                <Select.Option value="year">年线</Select.Option>
              </Select>
            </Col>
            <Col xs={24} sm={8} md={6}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>数量</div>
              <Input
                type="number"
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value) || 30)}
                min={1}
                max={1000}
                onPressEnter={fetchCandlesticks}
              />
            </Col>
            <Col xs={24} sm={24} md={6}>
              <div style={{ marginBottom: 8 }}>&nbsp;</div>
              <Button
                type="primary"
                icon={<SearchOutlined />}
                onClick={fetchCandlesticks}
                loading={loading}
                block
              >
                查询
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

        {/* 图表 */}
        {chartData.length > 0 && (
          <Card style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
              收盘价走势
              {showZIG && (
                <span style={{ marginLeft: 8, fontSize: 14, fontWeight: 400, color: '#666' }}>
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
                <Line type="monotone" dataKey="close" stroke="#1890ff" strokeWidth={2} name="收盘价" />
                {showZIG && (
                  <Line
                    type="monotone"
                    dataKey="zig"
                    stroke="#52c41a"
                    strokeWidth={2}
                    name={`ZIG(${zigPriceType === 'close' ? '收盘价' : zigPriceType === 'high' ? '最高价' : '最低价'},${zigReversalPercent}%)`}
                    dot={false}
                    connectNulls={true}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* 数据表格 */}
        {candlesticks.length > 0 && (
          <Card>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>K线数据</h2>
            <Table
              dataSource={[...candlesticks].reverse()}
              columns={tableColumns}
              rowKey={(_, index) => `candle-${index}`}
              pagination={{ pageSize: 20 }}
            />
          </Card>
        )}

        {candlesticks.length === 0 && !loading && !error && (
          <Card>
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
              暂无K线数据，请输入股票代码查询
            </div>
          </Card>
        )}
      </Card>
    </AppLayout>
  )
}

export default function CandlesPage() {
  return (
    <Suspense fallback={
      <AppLayout>
        <Card>
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>加载中...</div>
          </div>
        </Card>
      </AppLayout>
    }>
      <CandlesContent />
    </Suspense>
  )
}
