'use client'

import { useEffect, useState } from 'react'
import { watchlistApi } from '@/lib/api'
import { useIsMobile } from '@/hooks/useIsMobile'
import AppLayout from '@/components/AppLayout'
import { Card, Input, Button, Table, Alert, Space, Switch, message, Modal } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'

interface WatchlistItem {
  id: number
  symbol: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export default function WatchlistPage() {
  const isMobile = useIsMobile()
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [newSymbol, setNewSymbol] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const fetchWatchlist = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await watchlistApi.getWatchlist()
      if (response.success && response.data?.watchlist) {
        setWatchlist(response.data.watchlist)
      }
    } catch (err: any) {
      setError(err.message || '获取关注列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWatchlist()
  }, [])

  const handleAdd = async () => {
    if (!newSymbol.trim()) {
      setError('请输入股票代码')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      await watchlistApi.addWatchlist(newSymbol.trim())
      message.success('添加成功')
      setNewSymbol('')
      fetchWatchlist()
    } catch (err: any) {
      setError(err.message || '添加失败')
    } finally {
      setLoading(false)
    }
  }

  const handleRemove = async (symbol: string) => {
    Modal.confirm({
      title: '确认移除',
      content: `确定要移除 ${symbol} 吗？`,
      onOk: async () => {
        setLoading(true)
        setError(null)

        try {
          await watchlistApi.removeWatchlist(symbol)
          message.success('移除成功')
          fetchWatchlist()
        } catch (err: any) {
          setError(err.message || '移除失败')
        } finally {
          setLoading(false)
        }
      },
    })
  }

  const handleToggle = async (symbol: string, enabled: boolean) => {
    setLoading(true)
    setError(null)

    try {
      await watchlistApi.updateWatchlist(symbol, !enabled)
      message.success('更新成功')
      fetchWatchlist()
    } catch (err: any) {
      setError(err.message || '更新失败')
    } finally {
      setLoading(false)
    }
  }

  const columns = [
    {
      title: '标的代码',
      key: 'symbol',
      dataIndex: 'symbol',
      render: (text: string) => <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{text}</span>,
    },
    {
      title: '状态',
      key: 'enabled',
      dataIndex: 'enabled',
      width: isMobile ? 80 : undefined,
      render: (enabled: boolean, record: WatchlistItem) => (
        <Switch
          checked={enabled}
          onChange={() => handleToggle(record.symbol, enabled)}
          checkedChildren="启用"
          unCheckedChildren="禁用"
        />
      ),
    },
    ...(isMobile ? [] : [{
      title: '添加时间',
      key: 'created_at',
      dataIndex: 'created_at',
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
    }]),
    {
      title: '操作',
      key: 'actions',
      width: isMobile ? 70 : undefined,
      render: (_: unknown, record: WatchlistItem) => (
        <Button
          type="link"
          danger
          icon={<DeleteOutlined />}
          onClick={() => handleRemove(record.symbol)}
        >
          {isMobile ? '' : '移除'}
        </Button>
      ),
    },
  ]

  return (
    <AppLayout>
      <Card>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>关注股票管理</h1>

        {/* 添加股票 */}
        <Card style={{ marginBottom: 16 }}>
          <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
            <Input
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              placeholder="请输入股票代码，例如：AAPL.US（美股）"
              onPressEnter={handleAdd}
              style={{ flex: 1 }}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAdd}
              loading={loading}
            >
              添加
            </Button>
          </Space.Compact>
          <div style={{ fontSize: 12, color: '#999' }}>
            格式：ticker.region，例如：AAPL.US（美股）。注意：当前账户只有美股Basic行情权限
          </div>
        </Card>

        {/* 消息提示 */}
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

        {/* 关注列表 */}
        {watchlist.length > 0 ? (
          <Card>
            <Table
              dataSource={watchlist}
              columns={columns}
              rowKey="id"
              size={isMobile ? 'small' : 'middle'}
              pagination={{ pageSize: 20 }}
              scroll={isMobile ? { x: 350 } : undefined}
            />
          </Card>
        ) : (
          <Card>
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
              暂无关注股票，请添加您关注的股票
            </div>
          </Card>
        )}
      </Card>
    </AppLayout>
  )
}

