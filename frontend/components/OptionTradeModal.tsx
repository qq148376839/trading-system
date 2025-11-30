'use client'

import { useState, useEffect } from 'react'
import { ordersApi } from '@/lib/api'

interface OptionTradeModalProps {
  optionCode: string
  optionDetail: {
    price: number
    option: {
      strikePrice: number
      multiplier: number
      optionType: 'Call' | 'Put'
    }
  } | null
  onClose: () => void
  onSuccess: () => void
}

// 订单类型配置（期权交易简化版）
const ORDER_TYPES = {
  LO: { label: '限价单', requiresPrice: true },
  MO: { label: '市价单', requiresPrice: false },
}

export default function OptionTradeModal({
  optionCode,
  optionDetail,
  onClose,
  onSuccess,
}: OptionTradeModalProps) {
  const [side, setSide] = useState<'Buy' | 'Sell'>('Buy')
  const [orderType, setOrderType] = useState<string>('LO')
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [outsideRth, setOutsideRth] = useState<'RTH_ONLY' | 'ANY_TIME' | 'OVERNIGHT'>('RTH_ONLY')
  const [timeInForce, setTimeInForce] = useState<'Day' | 'GTC' | 'GTD'>('Day')
  const [remark, setRemark] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [maxQuantity, setMaxQuantity] = useState<{ cash: string; margin: string; max_qty: string } | null>(null)
  const [loadingMaxQty, setLoadingMaxQty] = useState(false)

  const orderConfig = ORDER_TYPES[orderType as keyof typeof ORDER_TYPES]
  const market = optionCode.endsWith('.US') ? 'US' : 'HK'

  // 初始化价格
  useEffect(() => {
    if (optionDetail?.price) {
      setPrice(optionDetail.price.toFixed(2))
    }
  }, [optionDetail])

  // 获取最大可买数量
  useEffect(() => {
    if (optionCode && side === 'Buy' && orderType && (price || orderType === 'MO')) {
      fetchMaxQuantity()
    } else {
      setMaxQuantity(null)
    }
  }, [optionCode, side, orderType, price])

  const fetchMaxQuantity = async () => {
    setLoadingMaxQty(true)
    try {
      const response = await ordersApi.estimateMaxQuantity({
        symbol: optionCode,
        order_type: orderType,
        side,
        price: price || undefined,
      })
      if (response.success && response.data) {
        setMaxQuantity(response.data)
      }
    } catch (err: any) {
      console.error('获取最大可买数量失败:', err)
      setMaxQuantity(null)
    } finally {
      setLoadingMaxQty(false)
    }
  }

  const handleSubmit = async () => {
    // 验证输入
    if (!quantity.trim()) {
      setError('请输入数量')
      return
    }

    const qty = parseInt(quantity)
    if (isNaN(qty) || qty <= 0) {
      setError('数量必须是大于0的整数')
      return
    }

    if (orderConfig.requiresPrice && !price.trim()) {
      setError('限价单需要输入价格')
      return
    }

    const priceNum = orderConfig.requiresPrice ? parseFloat(price) : undefined
    if (priceNum !== undefined && (isNaN(priceNum) || priceNum <= 0)) {
      setError('价格必须是大于0的数字')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      // 确保期权代码格式正确（添加.US后缀如果不存在）
      let normalizedOptionCode = optionCode
      if (!normalizedOptionCode.endsWith('.US') && !normalizedOptionCode.endsWith('.HK')) {
        normalizedOptionCode = `${normalizedOptionCode}.US`
      }
      
      // 根据规范化后的代码判断市场类型
      const normalizedMarket = normalizedOptionCode.endsWith('.US') ? 'US' : 'HK'
      
      const orderData: any = {
        symbol: normalizedOptionCode,
        order_type: orderType,
        side,
        submitted_quantity: qty.toString(),
      }

      if (priceNum !== undefined) {
        orderData.submitted_price = priceNum.toString()
      }

      // 美股订单必须提供 outside_rth 参数
      if (normalizedMarket === 'US') {
        orderData.outside_rth = outsideRth
      }

      orderData.time_in_force = timeInForce

      if (remark.trim()) {
        orderData.remark = remark.trim()
      }

      await ordersApi.submitOrder(orderData)
      setSuccess('订单提交成功')
      setTimeout(() => {
        onSuccess()
      }, 1500)
    } catch (err: any) {
      setError(err.message || '订单提交失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">交易期权 - {optionCode}</h2>

        {/* 期权信息 */}
        {optionDetail && (
          <div className="mb-4 p-3 bg-gray-50 rounded-md">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-gray-600">类型:</span>
                <span className="ml-2 font-medium">
                  {optionDetail.option.optionType === 'Call' ? '看涨' : '看跌'}
                </span>
              </div>
              <div>
                <span className="text-gray-600">行权价:</span>
                <span className="ml-2 font-medium">{optionDetail.option.strikePrice.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-gray-600">合约乘数:</span>
                <span className="ml-2 font-medium">{optionDetail.option.multiplier}</span>
              </div>
              <div>
                <span className="text-gray-600">当前价:</span>
                <span className="ml-2 font-medium text-blue-600">{optionDetail.price.toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-md text-green-700">
            {success}
          </div>
        )}

        <div className="space-y-4">
          {/* 买卖方向 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">交易方向</label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="Buy"
                  checked={side === 'Buy'}
                  onChange={(e) => setSide(e.target.value as 'Buy' | 'Sell')}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">买入</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="Sell"
                  checked={side === 'Sell'}
                  onChange={(e) => setSide(e.target.value as 'Buy' | 'Sell')}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">卖出</span>
              </label>
            </div>
          </div>

          {/* 订单类型 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">订单类型</label>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {Object.entries(ORDER_TYPES).map(([key, config]) => (
                <option key={key} value={key}>
                  {config.label}
                </option>
              ))}
            </select>
          </div>

          {/* 数量 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              数量（张）
            </label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="请输入数量"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {maxQuantity && side === 'Buy' && (
              <div className="mt-1 text-xs text-gray-500">
                最大可买: {maxQuantity.max_qty} 张
                {maxQuantity.cash && ` (现金: ${maxQuantity.cash})`}
              </div>
            )}
          </div>

          {/* 价格（限价单） */}
          {orderConfig.requiresPrice && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">价格</label>
              <input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="请输入价格"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* 美股盘前盘后选项 */}
          {market === 'US' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">盘前盘后</label>
              <select
                value={outsideRth}
                onChange={(e) => setOutsideRth(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="RTH_ONLY">不允许盘前盘后</option>
                <option value="ANY_TIME">允许盘前盘后</option>
                <option value="OVERNIGHT">允许夜盘</option>
              </select>
            </div>
          )}

          {/* 有效期 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">有效期</label>
            <select
              value={timeInForce}
              onChange={(e) => setTimeInForce(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="Day">当日有效</option>
              <option value="GTC">撤销前有效</option>
              <option value="GTD">指定日期有效</option>
            </select>
          </div>

          {/* 备注 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">备注（可选）</label>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="订单备注"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 订单预览 */}
          {quantity && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
              <div className="text-sm font-semibold mb-2">订单预览:</div>
              <div className="text-xs space-y-1">
                <div>标的: {optionCode}</div>
                <div>方向: {side === 'Buy' ? '买入' : '卖出'}</div>
                <div>类型: {orderConfig.label}</div>
                <div>数量: {quantity} 张</div>
                {orderConfig.requiresPrice && price && (
                  <div>价格: ${price}</div>
                )}
                {optionDetail && (
                  <div className="mt-2 pt-2 border-t border-blue-300">
                    <div>合约价值: ${(parseFloat(quantity || '0') * parseFloat(price || '0') * optionDetail.option.multiplier).toFixed(2)}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 按钮 */}
          <div className="flex gap-4 pt-4">
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
            >
              {loading ? '提交中...' : '提交订单'}
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

