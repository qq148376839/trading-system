'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { ordersApi } from '@/lib/api'
import AppLayout from '@/components/AppLayout'
import { DatePicker, Button, Input, Select, Table, Tag, Card, Tabs, Switch, Space, Alert, Modal, message } from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'

interface Order {
  orderId: string
  symbol: string
  stockName: string
  side: string
  orderType: string
  orderTypeText?: string // 订单类型中文翻译
  status: string
  quantity: string
  executedQuantity: string
  price: string
  executedPrice: string
  submittedAt: string
  updatedAt: string
  currency: string
  msg: string
  // 新增字段（完整订单信息）
  lastDone?: string
  triggerPrice?: string
  triggerStatus?: string
  trailingAmount?: string
  trailingPercent?: string
  limitOffset?: string
  tag?: string
  timeInForce?: string
  expireDate?: string
  triggerAt?: string
  outsideRth?: string
  outsideRthText?: string // 盘前盘后中文翻译
  remark?: string
}

type TabType = 'today' | 'history'

export default function OrdersPage() {
  const [activeTab, setActiveTab] = useState<TabType>('today')
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [hasMore, setHasMore] = useState(false)
  
  // 统一筛选器
  const [filters, setFilters] = useState({
    symbol: '',
    status: [] as string[],
    side: '' as 'Buy' | 'Sell' | '',
    market: '' as 'US' | 'HK' | '',
    order_id: '',
    start_at: '',
    end_at: '',
  })
  const [orderDateRange, setOrderDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)

  // 查询今日订单（使用 useCallback 稳定函数引用）
  const fetchTodayOrders = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params: any = {}
      if (filters.symbol) {
        params.symbol = filters.symbol
      }
      if (filters.status.length > 0) {
        params.status = filters.status
      }
      if (filters.side) {
        params.side = filters.side
      }
      if (filters.market) {
        params.market = filters.market
      }
      if (filters.order_id) {
        params.order_id = filters.order_id
      }

      const response = await ordersApi.getTodayOrders(params)
      if (response.success && response.data?.orders) {
        setOrders(response.data.orders)
        setHasMore(false) // 今日订单没有hasMore
      } else {
        setError(response.error?.message || '获取今日订单失败')
      }
    } catch (err: any) {
      // 处理频率限制错误
      if (err.response?.status === 429 || err.message?.includes('429') || err.message?.includes('频率')) {
        setError('API请求频率过高，请稍后再试。建议关闭自动刷新或等待一段时间。')
        setAutoRefresh(false)
      } else {
        setError(err.response?.data?.error?.message || err.message || '获取今日订单失败')
      }
    } finally {
      setLoading(false)
    }
  }, [filters.symbol, filters.status, filters.side, filters.market, filters.order_id])

  // 查询历史订单（使用 useCallback 稳定函数引用）
  const fetchHistoryOrders = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params: any = {}
      if (filters.symbol) {
        params.symbol = filters.symbol
      }
      if (filters.status.length > 0) {
        params.status = filters.status
      }
      if (filters.side) {
        params.side = filters.side
      }
      if (filters.market) {
        params.market = filters.market
      }
      if (orderDateRange && orderDateRange[0] && orderDateRange[1]) {
        params.start_at = orderDateRange[0].format('YYYY-MM-DD')
        params.end_at = orderDateRange[1].format('YYYY-MM-DD')
      } else if (filters.start_at) {
        params.start_at = filters.start_at
      } else if (filters.end_at) {
        params.end_at = filters.end_at
      }

      const response = await ordersApi.getHistoryOrders(params)
      if (response.success && response.data?.orders) {
        setOrders(response.data.orders)
        setHasMore(response.data.hasMore || false)
      } else {
        setError(response.error?.message || '获取历史订单失败')
      }
    } catch (err: any) {
      // 处理频率限制错误
      if (err.response?.status === 429 || err.message?.includes('429') || err.message?.includes('频率')) {
        setError('API请求频率过高，请稍后再试。建议关闭自动刷新或等待一段时间。')
        setAutoRefresh(false)
      } else {
        setError(err.response?.data?.error?.message || err.message || '获取历史订单失败')
      }
    } finally {
      setLoading(false)
    }
  }, [filters.symbol, filters.status, filters.side, filters.market, orderDateRange])

  // 使用 useRef 防止重复请求
  const isFetchingRef = useRef(false)
  const lastFetchParamsRef = useRef<string>('')

  // 根据当前Tab调用对应的查询函数（优化版本，防止重复请求）
  const fetchOrdersOptimized = useCallback(() => {
    // 生成请求参数的唯一标识
    const paramsKey = JSON.stringify({
      activeTab,
      ...filters
    })

    // 如果正在请求或参数相同，跳过
    if (isFetchingRef.current || lastFetchParamsRef.current === paramsKey) {
      return
    }

    isFetchingRef.current = true
    lastFetchParamsRef.current = paramsKey

    if (activeTab === 'today') {
      fetchTodayOrders().finally(() => {
        isFetchingRef.current = false
      })
    } else {
      fetchHistoryOrders().finally(() => {
        isFetchingRef.current = false
      })
    }
  }, [activeTab, filters.symbol, filters.status, filters.side, filters.market, filters.order_id, orderDateRange, fetchTodayOrders, fetchHistoryOrders])

  // 首次加载和筛选条件变化时请求（使用优化版本）
  useEffect(() => {
    fetchOrdersOptimized()
  }, [fetchOrdersOptimized])

  // 自动刷新（仅今日订单，每30秒）
  useEffect(() => {
    if (!autoRefresh || activeTab !== 'today') return

    const interval = setInterval(() => {
      // 自动刷新时，重置请求状态，允许刷新
      isFetchingRef.current = false
      lastFetchParamsRef.current = ''
      fetchTodayOrders()
    }, 30000) // 每30秒刷新一次

    return () => clearInterval(interval)
  }, [autoRefresh, activeTab, fetchTodayOrders]) // 只依赖必要的变量

  const handleCancelOrder = async (orderId: string) => {
    Modal.confirm({
      title: '确认取消订单',
      content: '确定要取消这个订单吗？',
      onOk: async () => {
        try {
          await ordersApi.cancelOrder(orderId)
          setError(null)
          message.success('订单取消成功')
          // 刷新订单列表（重置请求状态，允许刷新）
          isFetchingRef.current = false
          lastFetchParamsRef.current = ''
          await fetchOrdersOptimized()
          // 关闭详情弹窗
          setSelectedOrder(null)
        } catch (err: any) {
          setError(err.message || '取消订单失败')
        }
      }
    })
  }

  const getStatusColor = (status: string) => {
    const statusStr = status?.toString() || ''
    // 根据Longbridge API文档的OrderStatus枚举值：https://open.longbridge.com/zh-CN/docs/trade/trade-definition#orderstatus
    // 使用完整的枚举值名称进行精确匹配
    if (statusStr === 'FilledStatus' || statusStr === 'PartialFilledStatus') {
      return 'text-green-600 bg-green-50'
    } else if (statusStr === 'CanceledStatus' || statusStr === 'PendingCancelStatus' || statusStr === 'WaitToCancel') {
      return 'text-gray-600 bg-gray-50'
    } else if (statusStr === 'RejectedStatus') {
      return 'text-red-600 bg-red-50'
    } else if (statusStr === 'NewStatus' || statusStr === 'WaitToNew') {
      return 'text-blue-600 bg-blue-50'
    } else if (statusStr === 'NotReported' || statusStr === 'ReplacedNotReported' || 
               statusStr === 'ProtectedNotReported' || statusStr === 'VarietiesNotReported') {
      return 'text-yellow-600 bg-yellow-50'
    } else if (statusStr === 'ExpiredStatus') {
      return 'text-gray-500 bg-gray-100'
    } else {
      // 兼容简写形式（向后兼容）
      if (statusStr === 'Filled' || statusStr.includes('Filled')) {
        return 'text-green-600 bg-green-50'
      } else if (statusStr.includes('Cancel')) {
        return 'text-gray-600 bg-gray-50'
      } else if (statusStr.includes('Reject')) {
        return 'text-red-600 bg-red-50'
      }
      return 'text-yellow-600 bg-yellow-50'
    }
  }

  const getStatusText = (status: string) => {
    const statusStr = status?.toString() || ''
    // 根据Longbridge API文档的OrderStatus枚举值：https://open.longbridge.com/zh-CN/docs/trade/trade-definition#orderstatus
    // 使用完整的枚举值名称进行精确匹配
    if (statusStr === 'FilledStatus') {
      return '已成交'
    } else if (statusStr === 'PartialFilledStatus') {
      return '部分成交'
    } else if (statusStr === 'CanceledStatus' || statusStr === 'PendingCancelStatus' || statusStr === 'WaitToCancel') {
      return '已取消'
    } else if (statusStr === 'RejectedStatus') {
      return '已拒绝'
    } else if (statusStr === 'NewStatus' || statusStr === 'WaitToNew') {
      return '已委托'
    } else if (statusStr === 'NotReported' || statusStr === 'ReplacedNotReported' || 
               statusStr === 'ProtectedNotReported' || statusStr === 'VarietiesNotReported') {
      return '待提交'
    } else if (statusStr === 'ExpiredStatus') {
      return '已过期'
    } else if (statusStr === 'WaitToReplace' || statusStr === 'PendingReplaceStatus' || statusStr === 'ReplacedStatus') {
      return '修改中'
    } else if (statusStr === 'PartialWithdrawal') {
      return '部分撤单'
    } else {
      // 兼容简写形式（向后兼容）
      if (statusStr === 'Filled' || (statusStr.includes('Filled') && !statusStr.includes('Partial'))) {
        return '已成交'
      } else if (statusStr === 'PartialFilled' || statusStr.includes('PartialFilled')) {
        return '部分成交'
      } else if (statusStr.includes('Cancel')) {
        return '已取消'
      } else if (statusStr.includes('Reject')) {
        return '已拒绝'
      }
      return '处理中'
    }
  }

  const canCancelOrder = (status: string) => {
    const statusStr = status?.toString() || ''
    // 根据Longbridge API文档，只有未成交的订单可以取消
    // 使用完整的枚举值名称进行精确判断
    return statusStr !== 'FilledStatus' && 
           statusStr !== 'PartialFilledStatus' &&
           statusStr !== 'CanceledStatus' &&
           statusStr !== 'PendingCancelStatus' &&
           statusStr !== 'WaitToCancel' &&
           statusStr !== 'RejectedStatus' &&
           statusStr !== 'ExpiredStatus' &&
           // 兼容简写形式
           statusStr !== 'Filled' &&
           !statusStr.includes('Filled') &&
           !statusStr.includes('Cancel') &&
           !statusStr.includes('Reject')
  }

  const canModifyOrder = (status: string) => {
    const statusStr = status?.toString() || ''
    // 根据Longbridge API文档，只有未成交的订单可以修改
    // 使用完整的枚举值名称进行精确判断
    return statusStr !== 'FilledStatus' && 
           statusStr !== 'PartialFilledStatus' &&
           statusStr !== 'CanceledStatus' &&
           statusStr !== 'PendingCancelStatus' &&
           statusStr !== 'WaitToCancel' &&
           statusStr !== 'RejectedStatus' &&
           statusStr !== 'ExpiredStatus' &&
           // 兼容简写形式
           statusStr !== 'Filled' &&
           !statusStr.includes('Filled') &&
           !statusStr.includes('Cancel') &&
           !statusStr.includes('Reject')
  }

  // 客户端筛选（如果需要的话，但主要筛选已经在服务端完成）
  const filteredOrders = orders;

  return (
    <AppLayout>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>订单管理</h1>
          <Space>
            {activeTab === 'today' && (
              <Space>
                <Switch
                  checked={autoRefresh}
                  onChange={setAutoRefresh}
                />
                <span>自动刷新</span>
              </Space>
            )}
            <Button
              type="primary"
              onClick={() => {
                isFetchingRef.current = false
                lastFetchParamsRef.current = ''
                fetchOrdersOptimized()
              }}
              loading={loading}
            >
              刷新
            </Button>
          </Space>
        </div>

        {/* Tab切换 */}
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as TabType)}
          items={[
            {
              key: 'today',
              label: '今日订单',
            },
            {
              key: 'history',
              label: '历史订单',
            },
          ]}
        />

        {/* 统一筛选器 */}
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap>
            <Input
              placeholder="标的代码..."
              value={filters.symbol}
              onChange={(e) => setFilters({ ...filters, symbol: e.target.value })}
              style={{ width: 150 }}
            />
            <Select
              value={filters.side || undefined}
              onChange={(value) => setFilters({ ...filters, side: value as 'Buy' | 'Sell' | '' })}
              style={{ width: 120 }}
              placeholder="全部方向"
              options={[
                { value: '', label: '全部方向' },
                { value: 'Buy', label: '买入' },
                { value: 'Sell', label: '卖出' },
              ]}
            />
            <Select
              value={filters.market || undefined}
              onChange={(value) => setFilters({ ...filters, market: value as 'US' | 'HK' | '' })}
              style={{ width: 120 }}
              placeholder="全部市场"
              options={[
                { value: '', label: '全部市场' },
                { value: 'US', label: '美股' },
                { value: 'HK', label: '港股' },
              ]}
            />
            {activeTab === 'today' && (
              <Input
                placeholder="订单ID..."
                value={filters.order_id}
                onChange={(e) => setFilters({ ...filters, order_id: e.target.value })}
                style={{ width: 150 }}
              />
            )}
          </Space>
              
              {/* 历史订单时间范围 */}
              {activeTab === 'history' && (
                <div>
                  <DatePicker.RangePicker
                    value={orderDateRange}
                    onChange={(dates) => {
                      setOrderDateRange(dates)
                      if (dates && dates[0] && dates[1]) {
                        setFilters({
                          ...filters,
                          start_at: dates[0].format('YYYY-MM-DD'),
                          end_at: dates[1].format('YYYY-MM-DD'),
                        })
                      } else {
                        setFilters({
                          ...filters,
                          start_at: '',
                          end_at: '',
                        })
                      }
                    }}
                    format="YYYY-MM-DD"
                    className="w-full"
                    placeholder={['开始日期', '结束日期']}
                    presets={[
                      {
                        label: '最近一个月',
                        value: [dayjs().subtract(1, 'month'), dayjs()],
                      },
                      {
                        label: '最近三个月',
                        value: [dayjs().subtract(3, 'month'), dayjs()],
                      },
                      {
                        label: '最近六个月',
                        value: [dayjs().subtract(6, 'month'), dayjs()],
                      },
                      {
                        label: '最近九个月',
                        value: [dayjs().subtract(9, 'month'), dayjs()],
                      },
                      {
                        label: '最近一年',
                        value: [dayjs().subtract(1, 'year'), dayjs()],
                      },
                    ]}
                  />
                </div>
              )}
              
          {/* 状态筛选 */}
          <Space wrap>
            <Button
              type={filters.status.length === 0 ? 'primary' : 'default'}
              onClick={() => setFilters({ ...filters, status: [] })}
            >
              全部状态
            </Button>
            <Button
              type={filters.status.some(s => s.includes('Filled')) ? 'primary' : 'default'}
              onClick={() => setFilters({ ...filters, status: ['Filled', 'FilledStatus', 'PartialFilledStatus'] })}
            >
              已成交
            </Button>
            <Button
              type={filters.status.some(s => ['New', 'NotReported', 'WaitToNew'].includes(s)) ? 'primary' : 'default'}
              onClick={() => setFilters({ ...filters, status: ['New', 'NewStatus', 'NotReported', 'WaitToNew'] })}
            >
              待处理
            </Button>
            <Button
              type={filters.status.some(s => s.includes('Cancel')) ? 'primary' : 'default'}
              onClick={() => setFilters({ ...filters, status: ['CanceledStatus', 'PendingCancelStatus', 'WaitToCancel'] })}
            >
              已取消
            </Button>
            <Button
              type={filters.status.includes('RejectedStatus') ? 'primary' : 'default'}
              onClick={() => setFilters({ ...filters, status: ['RejectedStatus'] })}
            >
              已拒绝
            </Button>
          </Space>
        </Space>

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

        {/* 订单列表 */}
        <Table
          dataSource={filteredOrders}
          loading={loading}
          rowKey="orderId"
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText: filteredOrders.length === 0 && !loading ? '暂无订单' : undefined
          }}
          columns={[
            {
              title: '标的代码',
              key: 'symbol',
              width: 150,
              render: (_, order: Order) => (
                <div>
                  <div>{order.symbol}</div>
                  {order.stockName && (
                    <div style={{ fontSize: 12, color: '#999' }}>{order.stockName}</div>
                  )}
                </div>
              )
            },
            {
              title: '方向',
              key: 'side',
              width: 80,
              render: (_, order: Order) => (
                <span style={{ color: order.side === 'Buy' ? '#ff4d4f' : '#52c41a', fontWeight: 600 }}>
                  {order.side === 'Buy' ? '买入' : '卖出'}
                </span>
              )
            },
            {
              title: '订单类型',
              key: 'orderType',
              width: 120,
              render: (_, order: Order) => order.orderTypeText || order.orderType
            },
            {
              title: '数量',
              key: 'quantity',
              width: 120,
              render: (_, order: Order) => (
                order.executedQuantity !== '0' ? (
                  <span>
                    {order.executedQuantity} / {order.quantity}
                  </span>
                ) : (
                  order.quantity
                )
              )
            },
            {
              title: '价格',
              key: 'price',
              width: 150,
              render: (_, order: Order) => (
                order.executedPrice !== '0' ? (
                  <span>
                    {order.executedPrice} <span style={{ color: '#999' }}>({order.price})</span>
                  </span>
                ) : (
                  order.price || '-'
                )
              )
            },
            {
              title: '状态',
              key: 'status',
              width: 120,
              render: (_, order: Order) => {
                const statusStr = order.status?.toString() || ''
                let color = 'default'
                if (statusStr === 'FilledStatus' || statusStr === 'PartialFilledStatus' || statusStr.includes('Filled')) {
                  color = 'success'
                } else if (statusStr === 'RejectedStatus' || statusStr.includes('Reject')) {
                  color = 'error'
                } else if (statusStr === 'CanceledStatus' || statusStr.includes('Cancel')) {
                  color = 'default'
                } else if (statusStr === 'NewStatus' || statusStr === 'NotReported' || statusStr === 'WaitToNew') {
                  color = 'processing'
                }
                return <Tag color={color}>{getStatusText(order.status)}</Tag>
              }
            },
            {
              title: '下单时间',
              key: 'submittedAt',
              width: 180,
              render: (_, order: Order) => order.submittedAt ? new Date(order.submittedAt).toLocaleString('zh-CN') : '-'
            },
            {
              title: '操作',
              key: 'actions',
              width: 120,
              render: (_, order: Order) => (
                <Space>
                  <Button type="link" onClick={() => setSelectedOrder(order)}>
                    详情
                  </Button>
                  {activeTab === 'today' && canCancelOrder(order.status) && (
                    <Button type="link" danger onClick={() => handleCancelOrder(order.orderId)}>
                      取消
                    </Button>
                  )}
                </Space>
              )
            }
          ]}
        />
        
        {/* 分页提示（历史订单） */}
        {activeTab === 'history' && hasMore && (
          <div style={{ marginTop: 16, textAlign: 'center', color: '#999', fontSize: 12 }}>
            提示：还有更多订单，请缩小查询范围查看
          </div>
        )}
      </Card>

      {/* 订单详情弹窗 */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onCancel={handleCancelOrder}
          onModify={async () => {
            // 重置请求状态，允许刷新
            isFetchingRef.current = false
            lastFetchParamsRef.current = ''
            await fetchOrdersOptimized()
            setSelectedOrder(null)
          }}
        />
      )}
    </AppLayout>
  )
}

// 订单详情弹窗组件
function OrderDetailModal({
  order,
  onClose,
  onCancel,
  onModify,
}: {
  order: Order
  onClose: () => void
  onCancel: (orderId: string) => void
  onModify: () => void
}) {
  const [modifying, setModifying] = useState(false)
  const [newQuantity, setNewQuantity] = useState(order.quantity)
  const [newPrice, setNewPrice] = useState(order.price)
  const [error, setError] = useState<string | null>(null)

  const canCancel = !order.status?.toString().includes('Filled') && 
                   !order.status?.toString().includes('Cancel') && 
                   !order.status?.toString().includes('Reject')

  const canModify = !order.status?.toString().includes('Filled') && 
                    !order.status?.toString().includes('Cancel') && 
                    !order.status?.toString().includes('Reject')

  const handleModify = async () => {
    setError(null)
    setModifying(true)

    try {
      const updates: any = {}
      if (newQuantity !== order.quantity) {
        updates.quantity = parseInt(newQuantity)
      }
      if (newPrice !== order.price && newPrice) {
        updates.price = parseFloat(newPrice)
      }

      if (Object.keys(updates).length === 0) {
        setError('请至少修改一个字段')
        setModifying(false)
        return
      }

      await ordersApi.replaceOrder(order.orderId, updates)
      setError(null)
      onModify()
    } catch (err: any) {
      setError(err.message || '修改订单失败')
    } finally {
      setModifying(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900">订单详情</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">标的代码</label>
              <div className="mt-1 text-sm text-gray-900">{order.symbol}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">股票名称</label>
              <div className="mt-1 text-sm text-gray-900">{order.stockName || '-'}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">订单ID</label>
              <div className="mt-1 text-sm text-gray-900 font-mono">{order.orderId}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">方向</label>
              <div className={`mt-1 text-sm font-medium ${order.side === 'Buy' ? 'text-red-600' : 'text-green-600'}`}>
                {order.side === 'Buy' ? '买入' : '卖出'}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">订单类型</label>
              <div className="mt-1 text-sm text-gray-900">{order.orderTypeText || order.orderType}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">状态</label>
              <div className="mt-1">
                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                  order.status?.toString().includes('Filled') ? 'text-green-600 bg-green-50' :
                  order.status?.toString().includes('Cancel') ? 'text-gray-600 bg-gray-50' :
                  order.status?.toString().includes('Reject') ? 'text-red-600 bg-red-50' :
                  'text-yellow-600 bg-yellow-50'
                }`}>
                  {order.status?.toString().includes('Filled') ? '已成交' :
                   order.status?.toString().includes('Cancel') ? '已取消' :
                   order.status?.toString().includes('Reject') ? '已拒绝' : '处理中'}
                </span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">数量</label>
              <div className="mt-1 text-sm text-gray-900">
                {order.executedQuantity !== '0' ? (
                  <span>
                    已成交: {order.executedQuantity} / 总数: {order.quantity}
                  </span>
                ) : (
                  order.quantity
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">价格</label>
              <div className="mt-1 text-sm text-gray-900">
                {order.executedPrice !== '0' ? (
                  <span>
                    成交价: {order.executedPrice} <span className="text-gray-400">(下单: {order.price})</span>
                  </span>
                ) : (
                  order.price || '-'
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">下单时间</label>
              <div className="mt-1 text-sm text-gray-900">
                {order.submittedAt ? new Date(order.submittedAt).toLocaleString('zh-CN') : '-'}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">更新时间</label>
              <div className="mt-1 text-sm text-gray-900">
                {order.updatedAt ? new Date(order.updatedAt).toLocaleString('zh-CN') : '-'}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">货币</label>
              <div className="mt-1 text-sm text-gray-900">{order.currency || 'USD'}</div>
            </div>
            {order.lastDone && (
              <div>
                <label className="block text-sm font-medium text-gray-700">最新成交价</label>
                <div className="mt-1 text-sm text-gray-900">{order.lastDone}</div>
              </div>
            )}
            {order.tag && (
              <div>
                <label className="block text-sm font-medium text-gray-700">订单标记</label>
                <div className="mt-1 text-sm text-gray-900">{order.tag}</div>
              </div>
            )}
            {order.timeInForce && (
              <div>
                <label className="block text-sm font-medium text-gray-700">有效期类型</label>
                <div className="mt-1 text-sm text-gray-900">{order.timeInForce}</div>
              </div>
            )}
            {order.expireDate && (
              <div>
                <label className="block text-sm font-medium text-gray-700">过期日期</label>
                <div className="mt-1 text-sm text-gray-900">{order.expireDate}</div>
              </div>
            )}
            {order.triggerPrice && (
              <div>
                <label className="block text-sm font-medium text-gray-700">触发价格</label>
                <div className="mt-1 text-sm text-gray-900">{order.triggerPrice}</div>
              </div>
            )}
            {order.triggerStatus && order.triggerStatus !== 'NOT_USED' && (
              <div>
                <label className="block text-sm font-medium text-gray-700">触发状态</label>
                <div className="mt-1 text-sm text-gray-900">{order.triggerStatus}</div>
              </div>
            )}
            {order.outsideRth && order.outsideRth !== 'UnknownOutsideRth' && (
              <div>
                <label className="block text-sm font-medium text-gray-700">盘前盘后</label>
                <div className="mt-1 text-sm text-gray-900">{order.outsideRthText || order.outsideRth}</div>
              </div>
            )}
            {order.msg && (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700">备注/错误信息</label>
                <div className="mt-1 text-sm text-red-600">{order.msg}</div>
              </div>
            )}
            {order.remark && (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700">备注</label>
                <div className="mt-1 text-sm text-gray-600">{order.remark}</div>
              </div>
            )}
          </div>

          {/* 修改订单 */}
          {canModify && (
            <div className="border-t pt-4">
              <h3 className="text-lg font-medium text-gray-900 mb-4">修改订单</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    数量
                  </label>
                  <input
                    type="number"
                    value={newQuantity}
                    onChange={(e) => setNewQuantity(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    min="1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    价格 {order.orderType === 'LO' || order.orderType === 'ELO' ? '(限价单)' : '(可选)'}
                  </label>
                  <input
                    type="number"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    step="0.01"
                    min="0"
                    disabled={order.orderType !== 'LO' && order.orderType !== 'ELO'}
                  />
                </div>
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            {canModify && (
              <button
                onClick={handleModify}
                disabled={modifying}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 text-sm"
              >
                {modifying ? '修改中...' : '修改订单'}
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => {
                  if (confirm('确定要取消这个订单吗？')) {
                    onCancel(order.orderId)
                  }
                }}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
              >
                取消订单
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

