'use client'

import { useEffect, useState } from 'react'
import { ordersApi } from '@/lib/api'
import BackButton from '@/components/BackButton'

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

  // 查询今日订单
  const fetchTodayOrders = async () => {
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
  }

  // 查询历史订单
  const fetchHistoryOrders = async () => {
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
      if (filters.start_at) {
        params.start_at = filters.start_at
      }
      if (filters.end_at) {
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
  }

  // 根据当前Tab调用对应的查询函数
  const fetchOrders = () => {
    if (activeTab === 'today') {
      fetchTodayOrders()
    } else {
      fetchHistoryOrders()
    }
  }

  useEffect(() => {
    fetchOrders()
  }, [activeTab, filters.symbol, filters.status, filters.side, filters.market, filters.order_id, filters.start_at, filters.end_at])

  // 自动刷新（仅今日订单，每30秒）
  useEffect(() => {
    if (!autoRefresh || activeTab !== 'today') return

    const interval = setInterval(() => {
      fetchTodayOrders()
    }, 30000) // 每30秒刷新一次

    return () => clearInterval(interval)
  }, [autoRefresh, activeTab, filters.symbol, filters.status, filters.side, filters.market, filters.order_id])

  const handleCancelOrder = async (orderId: string) => {
    if (!confirm('确定要取消这个订单吗？')) {
      return
    }

    try {
      await ordersApi.cancelOrder(orderId)
      setError(null)
      // 刷新订单列表
      await fetchOrders()
      // 关闭详情弹窗
      setSelectedOrder(null)
    } catch (err: any) {
      setError(err.message || '取消订单失败')
    }
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
  const filteredOrders = orders

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-4">
            <BackButton />
          </div>
          <div className="bg-white shadow rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-2xl font-bold text-gray-900">订单管理</h1>
              <div className="flex items-center gap-4">
                {activeTab === 'today' && (
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={autoRefresh}
                      onChange={(e) => setAutoRefresh(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="ml-2 text-sm text-gray-700">自动刷新</span>
                  </label>
                )}
                <button
                  onClick={fetchOrders}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 text-sm"
                >
                  {loading ? '刷新中...' : '刷新'}
                </button>
              </div>
            </div>

            {/* Tab切换 */}
            <div className="mb-6 border-b border-gray-200">
              <nav className="-mb-px flex space-x-8">
                <button
                  onClick={() => setActiveTab('today')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'today'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  今日订单
                </button>
                <button
                  onClick={() => setActiveTab('history')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'history'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  历史订单
                </button>
              </nav>
            </div>

            {/* 统一筛选器 */}
            <div className="mb-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <input
                  type="text"
                  placeholder="标的代码..."
                  value={filters.symbol}
                  onChange={(e) => setFilters({ ...filters, symbol: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <select
                  value={filters.side}
                  onChange={(e) => setFilters({ ...filters, side: e.target.value as 'Buy' | 'Sell' | '' })}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">全部方向</option>
                  <option value="Buy">买入</option>
                  <option value="Sell">卖出</option>
                </select>
                <select
                  value={filters.market}
                  onChange={(e) => setFilters({ ...filters, market: e.target.value as 'US' | 'HK' | '' })}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">全部市场</option>
                  <option value="US">美股</option>
                  <option value="HK">港股</option>
                </select>
                {activeTab === 'today' && (
                  <input
                    type="text"
                    placeholder="订单ID..."
                    value={filters.order_id}
                    onChange={(e) => setFilters({ ...filters, order_id: e.target.value })}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                )}
              </div>
              
              {/* 历史订单时间范围 */}
              {activeTab === 'history' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    type="date"
                    value={filters.start_at}
                    onChange={(e) => setFilters({ ...filters, start_at: e.target.value })}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="开始日期"
                  />
                  <input
                    type="date"
                    value={filters.end_at}
                    onChange={(e) => setFilters({ ...filters, end_at: e.target.value })}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="结束日期"
                  />
                </div>
              )}
              
              {/* 状态筛选 */}
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setFilters({ ...filters, status: [] })}
                  className={`px-3 py-1 text-sm rounded ${
                    filters.status.length === 0
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  全部状态
                </button>
                <button
                  onClick={() => setFilters({ ...filters, status: ['Filled', 'FilledStatus', 'PartialFilledStatus'] })}
                  className={`px-3 py-1 text-sm rounded ${
                    filters.status.some(s => s.includes('Filled'))
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  已成交
                </button>
                <button
                  onClick={() => setFilters({ ...filters, status: ['New', 'NewStatus', 'NotReported', 'WaitToNew'] })}
                  className={`px-3 py-1 text-sm rounded ${
                    filters.status.some(s => ['New', 'NotReported', 'WaitToNew'].includes(s))
                      ? 'bg-yellow-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  待处理
                </button>
                <button
                  onClick={() => setFilters({ ...filters, status: ['CanceledStatus', 'PendingCancelStatus', 'WaitToCancel'] })}
                  className={`px-3 py-1 text-sm rounded ${
                    filters.status.some(s => s.includes('Cancel'))
                      ? 'bg-gray-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  已取消
                </button>
                <button
                  onClick={() => setFilters({ ...filters, status: ['RejectedStatus'] })}
                  className={`px-3 py-1 text-sm rounded ${
                    filters.status.includes('RejectedStatus')
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  已拒绝
                </button>
              </div>
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
                {error}
              </div>
            )}

            {/* 订单列表 */}
            {filteredOrders.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        标的代码
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        方向
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        订单类型
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        数量
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        价格
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        状态
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        下单时间
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredOrders.map((order) => (
                      <tr key={order.orderId} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {order.symbol}
                          {order.stockName && (
                            <div className="text-xs text-gray-500">{order.stockName}</div>
                          )}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${order.side === 'Buy' ? 'text-red-600' : 'text-green-600'}`}>
                          {order.side === 'Buy' ? '买入' : '卖出'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {order.orderTypeText || order.orderType}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {order.executedQuantity !== '0' ? (
                            <span>
                              {order.executedQuantity} / {order.quantity}
                            </span>
                          ) : (
                            order.quantity
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {order.executedPrice !== '0' ? (
                            <span>
                              {order.executedPrice} <span className="text-gray-400">({order.price})</span>
                            </span>
                          ) : (
                            order.price || '-'
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(order.status)}`}>
                            {getStatusText(order.status)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {order.submittedAt ? new Date(order.submittedAt).toLocaleString('zh-CN') : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <div className="flex gap-2">
                            <button
                              onClick={() => setSelectedOrder(order)}
                              className="text-blue-600 hover:text-blue-800"
                            >
                              详情
                            </button>
                            {activeTab === 'today' && canCancelOrder(order.status) && (
                              <button
                                onClick={() => handleCancelOrder(order.orderId)}
                                className="text-red-600 hover:text-red-800"
                              >
                                取消
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                
                {/* 分页提示（历史订单） */}
                {activeTab === 'history' && hasMore && (
                  <div className="mt-4 text-center text-sm text-gray-500">
                    提示：还有更多订单，请缩小查询范围查看
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                {loading ? '加载中...' : '暂无订单'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 订单详情弹窗 */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onCancel={handleCancelOrder}
          onModify={async () => {
            await fetchOrders()
            setSelectedOrder(null)
          }}
        />
      )}
    </div>
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

