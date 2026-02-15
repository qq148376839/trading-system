'use client'

import { useEffect, useState } from 'react'
import { quoteApi } from '@/lib/api'
import { useIsMobile } from '@/hooks/useIsMobile'
import AppLayout from '@/components/AppLayout'
import { Card, Input, Button, Table, Alert, Space } from 'antd'
import { SearchOutlined } from '@ant-design/icons'

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
  const isMobile = useIsMobile()
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

  const columns = [
    {
      title: '标的代码',
      key: 'symbol',
      dataIndex: 'symbol',
      width: isMobile ? 90 : undefined,
      render: (text: string) => <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{text}</span>,
    },
    {
      title: '最新价',
      key: 'last_done',
      dataIndex: 'last_done',
      width: isMobile ? 80 : undefined,
      render: (text: string, record: Quote) => {
        const { change } = calculateChange(record.last_done, record.prev_close)
        const isPositive = change >= 0
        return (
          <span style={{ color: isPositive ? '#ff4d4f' : '#52c41a', fontWeight: 600 }}>
            {text}
          </span>
        )
      },
    },
    {
      title: '涨跌',
      key: 'change',
      width: isMobile ? 70 : undefined,
      render: (_: unknown, record: Quote) => {
        const { change } = calculateChange(record.last_done, record.prev_close)
        const isPositive = change >= 0
        return (
          <span style={{ color: isPositive ? '#ff4d4f' : '#52c41a' }}>
            {isPositive ? '+' : ''}{change.toFixed(2)}
          </span>
        )
      },
    },
    {
      title: '涨跌幅',
      key: 'changePercent',
      width: isMobile ? 80 : undefined,
      render: (_: unknown, record: Quote) => {
        const { changePercent } = calculateChange(record.last_done, record.prev_close)
        const isPositive = parseFloat(changePercent) >= 0
        return (
          <span style={{ color: isPositive ? '#ff4d4f' : '#52c41a' }}>
            {isPositive ? '+' : ''}{changePercent}%
          </span>
        )
      },
    },
    ...(isMobile ? [] : [{
      title: '开盘价',
      key: 'open',
      dataIndex: 'open',
    }]),
    ...(isMobile ? [] : [{
      title: '最高价',
      key: 'high',
      dataIndex: 'high',
    }]),
    ...(isMobile ? [] : [{
      title: '最低价',
      key: 'low',
      dataIndex: 'low',
    }]),
    ...(isMobile ? [] : [{
      title: '成交量',
      key: 'volume',
      dataIndex: 'volume',
      render: (volume: number) => volume.toLocaleString(),
    }]),
    ...(isMobile ? [] : [{
      title: '成交额',
      key: 'turnover',
      dataIndex: 'turnover',
    }]),
  ]

  return (
    <AppLayout>
      <Card>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>实时行情</h1>
        
        {/* 搜索框 */}
        <Card style={{ marginBottom: 16 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={symbols}
              onChange={(e) => setSymbols(e.target.value)}
              placeholder="请输入股票代码，用逗号分隔，例如：AAPL.US,TSLA.US（美股）"
              onPressEnter={fetchQuotes}
              style={{ flex: 1 }}
            />
            <Button
              type="primary"
              icon={<SearchOutlined />}
              onClick={fetchQuotes}
              loading={loading}
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

        {/* 行情列表 */}
        {quotes.length > 0 && (
          <Card>
            <Table
              dataSource={quotes}
              columns={columns}
              rowKey="symbol"
              size={isMobile ? 'small' : 'middle'}
              pagination={{ pageSize: 20 }}
              scroll={isMobile ? { x: 350 } : undefined}
            />
          </Card>
        )}

        {quotes.length === 0 && !loading && !error && (
          <Card>
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
              暂无行情数据，请输入股票代码查询
            </div>
          </Card>
        )}
      </Card>
    </AppLayout>
  )
}

