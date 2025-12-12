'use client'

import { useState, useEffect } from 'react'
import { ordersApi } from '@/lib/api'

interface TradeModalProps {
  symbol: string
  currentPrice?: string
  onClose: () => void
  onSuccess: () => void
}

// 订单类型配置
const ORDER_TYPES = {
  // 基础订单类型
  LO: { label: '限价单', requiresPrice: true, category: 'basic' },
  ELO: { label: '增强限价单', requiresPrice: true, category: 'basic' },
  MO: { label: '市价单', requiresPrice: false, category: 'basic' },
  AO: { label: '竞价市价单', requiresPrice: false, category: 'basic' },
  ALO: { label: '竞价限价单', requiresPrice: true, category: 'basic' },
  ODD: { label: '碎股单', requiresPrice: true, category: 'basic' },
  SLO: { label: '特殊限价单', requiresPrice: true, category: 'basic' },
  
  // 条件单
  LIT: { label: '触价限价单', requiresPrice: true, requiresTrigger: true, category: 'conditional' },
  MIT: { label: '触价市价单', requiresPrice: false, requiresTrigger: true, category: 'conditional' },
  
  // 跟踪止损单
  TSLPAMT: { label: '跟踪止损限价单（跟踪金额）', requiresTrailingAmount: true, category: 'trailing' },
  TSLPPCT: { label: '跟踪止损限价单（跟踪涨跌幅）', requiresTrailingPercent: true, category: 'trailing' },
}

// 检测市场类型
function detectMarket(symbol: string): 'US' | 'HK' | 'UNKNOWN' {
  if (symbol.endsWith('.US')) return 'US'
  if (symbol.endsWith('.HK')) return 'HK'
  return 'UNKNOWN'
}

export default function TradeModal({ symbol, currentPrice, onClose, onSuccess }: TradeModalProps) {
  const [side, setSide] = useState<'Buy' | 'Sell'>('Buy')
  const [orderType, setOrderType] = useState<string>('LO')
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState(currentPrice || '')
  const [triggerPrice, setTriggerPrice] = useState('')
  const [trailingAmount, setTrailingAmount] = useState('')
  const [trailingPercent, setTrailingPercent] = useState('')
  const [limitOffset, setLimitOffset] = useState('')
  const [expireDate, setExpireDate] = useState('')
  const [outsideRth, setOutsideRth] = useState<'RTH_ONLY' | 'ANY_TIME' | 'OVERNIGHT'>('RTH_ONLY')
  const [timeInForce, setTimeInForce] = useState<'Day' | 'GTC' | 'GTD'>('Day')
  const [remark, setRemark] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [maxQuantity, setMaxQuantity] = useState<{ cash: string; margin: string; max_qty: string } | null>(null)
  const [loadingMaxQty, setLoadingMaxQty] = useState(false)
  const [useMargin, setUseMargin] = useState(false)  // 是否使用融资
  const [lotSize, setLotSize] = useState<number | null>(null)  // 最小交易单位
  const [loadingLotSize, setLoadingLotSize] = useState(false)

  const market = detectMarket(symbol)
  const orderConfig = ORDER_TYPES[orderType as keyof typeof ORDER_TYPES]

  // 获取标的基础信息（lot size）
  useEffect(() => {
    fetchLotSize()
  }, [symbol])

  const fetchLotSize = async () => {
    setLoadingLotSize(true)
    try {
      const response = await ordersApi.getSecurityInfo(symbol)
      if (response.data && response.data.lot_size) {
        setLotSize(response.data.lot_size)
      }
    } catch (err) {
      console.error('获取最小交易单位失败', err)
      setLotSize(null)
    } finally {
      setLoadingLotSize(false)
    }
  }

  // 获取最大可买数量
  useEffect(() => {
    if (symbol && side === 'Buy' && orderType && (price || orderType === 'MO' || orderType === 'AO')) {
      fetchMaxQuantity()
    } else {
      setMaxQuantity(null)
    }
  }, [symbol, side, orderType, price, useMargin])

  const fetchMaxQuantity = async () => {
    setLoadingMaxQty(true)
    try {
      const response = await ordersApi.estimateMaxQuantity({
        symbol,
        order_type: orderType,
        side,
        price: price || undefined,
        use_margin: useMargin,
      })
      if (response.data) {
        setMaxQuantity({
          cash: response.data.cash_max_qty || '0',
          margin: response.data.margin_max_qty || '0',
          max_qty: response.data.max_qty || '0',
        })
      }
    } catch (err) {
      console.error('获取最大可买数量失败', err)
      setMaxQuantity(null)
    } finally {
      setLoadingMaxQty(false)
    }
  }

  const handleSubmit = async () => {
    // 基础验证
    if (!quantity || isNaN(parseInt(quantity)) || parseInt(quantity) <= 0) {
      setError('请输入有效的数量')
      return
    }

    const quantityNum = parseInt(quantity)

    // 验证最小交易单位（lot size）
    if (lotSize && lotSize > 0) {
      if (quantityNum % lotSize !== 0) {
        const suggestedQty = Math.ceil(quantityNum / lotSize) * lotSize
        setError(`数量不符合最小交易单位要求。最小交易单位为 ${lotSize}，请输入 ${lotSize} 的倍数。建议数量：${suggestedQty}`)
        return
      }
    }

    // 价格验证
    if (orderConfig && 'requiresPrice' in orderConfig && orderConfig.requiresPrice && (!price || isNaN(parseFloat(price)))) {
      setError(`${orderConfig.label}需要提供价格`)
      return
    }

    // 触发价格验证
    if (orderConfig && 'requiresTrigger' in orderConfig && orderConfig.requiresTrigger && (!triggerPrice || isNaN(parseFloat(triggerPrice)))) {
      setError(`${orderConfig.label}需要提供触发价格`)
      return
    }

    // 跟踪金额验证
    if (orderType === 'TSLPAMT') {
      if (!trailingAmount || isNaN(parseFloat(trailingAmount))) {
        setError('跟踪止损限价单（跟踪金额）需要提供跟踪金额')
        return
      }
      if (!limitOffset || isNaN(parseFloat(limitOffset))) {
        setError('跟踪止损限价单需要提供指定价差')
        return
      }
    }

    // 跟踪涨跌幅验证
    if (orderType === 'TSLPPCT') {
      if (!trailingPercent || isNaN(parseFloat(trailingPercent))) {
        setError('跟踪止损限价单（跟踪涨跌幅）需要提供跟踪涨跌幅')
        return
      }
      if (!limitOffset || isNaN(parseFloat(limitOffset))) {
        setError('跟踪止损限价单需要提供指定价差')
        return
      }
    }

    // 过期日期验证
    if (timeInForce === 'GTD' && !expireDate) {
      setError('GTD订单需要提供过期日期')
      return
    }

    // 美股盘前盘后验证
    if (market === 'US' && !outsideRth) {
      setError('美股订单需要选择盘前盘后选项')
      return
    }

    // 验证数量是否超过最大可买数量
    if (side === 'Buy' && maxQuantity) {
      const requestedQty = quantityNum
      const maxQty = parseInt(maxQuantity.max_qty || '0')
      
      if (requestedQty > maxQty && maxQty > 0) {
        const cashQty = parseInt(maxQuantity.cash || '0')
        const marginQty = parseInt(maxQuantity.margin || '0')
        const source = useMargin ? '融资' : '现金'
        setError(`数量超过最大可买数量（${maxQty}，${source}）。现金可买：${cashQty}，融资可买：${marginQty}`)
        return
      }
    }

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const orderData: any = {
        symbol,
        order_type: orderType,
        side,
        submitted_quantity: quantity,
      }

      // 添加价格
      if (price) {
        orderData.submitted_price = price
      }

      // 添加触发价格
      if (triggerPrice) {
        orderData.trigger_price = triggerPrice
      }

      // 添加跟踪参数
      if (trailingAmount) {
        orderData.trailing_amount = trailingAmount
      }
      if (trailingPercent) {
        orderData.trailing_percent = trailingPercent
      }
      if (limitOffset) {
        orderData.limit_offset = limitOffset
      }

      // 添加过期日期
      if (expireDate) {
        orderData.expire_date = expireDate
      }

      // 添加盘前盘后
      if (market === 'US') {
        orderData.outside_rth = outsideRth
      }

      // 添加订单有效期
      if (timeInForce !== 'Day') {
        orderData.time_in_force = timeInForce
      }

      // 添加备注
      if (remark) {
        orderData.remark = remark
      }

      const response = await ordersApi.submitOrder(orderData)

      if (response.success) {
        setSuccess(`订单提交成功！订单ID: ${response.data?.orderId}`)
        setTimeout(() => {
          onSuccess()
          onClose()
        }, 2000)
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.error?.details 
        ? err.response.data.error.details.join('; ')
        : err.response?.data?.error?.message || err.message || '提交订单失败'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  // 获取订单类型选项（按分类）
  const getOrderTypeOptions = () => {
    const basic = Object.entries(ORDER_TYPES).filter(([_, config]) => config.category === 'basic')
    const conditional = Object.entries(ORDER_TYPES).filter(([_, config]) => config.category === 'conditional')
    const trailing = Object.entries(ORDER_TYPES).filter(([_, config]) => config.category === 'trailing')
    
    return { basic, conditional, trailing }
  }

  const { basic, conditional, trailing } = getOrderTypeOptions()

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 my-8">
        <h2 className="text-xl font-bold mb-4">
          {side === 'Buy' ? '买入' : '卖出'} - {symbol}
        </h2>

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

        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/* 交易方向 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              交易方向 <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="Buy"
                  checked={side === 'Buy'}
                  onChange={(e) => setSide(e.target.value as 'Buy' | 'Sell')}
                  className="mr-2"
                />
                <span className={`text-lg font-semibold ${side === 'Buy' ? 'text-red-600' : 'text-gray-600'}`}>
                  买入
                </span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="Sell"
                  checked={side === 'Sell'}
                  onChange={(e) => setSide(e.target.value as 'Buy' | 'Sell')}
                  className="mr-2"
                />
                <span className={`text-lg font-semibold ${side === 'Sell' ? 'text-green-600' : 'text-gray-600'}`}>
                  卖出
                </span>
              </label>
            </div>
          </div>

          {/* 订单类型 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              订单类型 <span className="text-red-500">*</span>
            </label>
            <select
              value={orderType}
              onChange={(e) => {
                setOrderType(e.target.value)
                // 重置相关字段
                setTriggerPrice('')
                setTrailingAmount('')
                setTrailingPercent('')
                setLimitOffset('')
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <optgroup label="基础订单">
                {basic.map(([key, config]) => (
                  <option key={key} value={key}>{config.label} ({key})</option>
                ))}
              </optgroup>
              <optgroup label="条件单">
                {conditional.map(([key, config]) => (
                  <option key={key} value={key}>{config.label} ({key})</option>
                ))}
              </optgroup>
              <optgroup label="跟踪止损单">
                {trailing.map(([key, config]) => (
                  <option key={key} value={key}>{config.label} ({key})</option>
                ))}
              </optgroup>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              {orderConfig?.label} - {orderConfig && 'requiresPrice' in orderConfig && orderConfig.requiresPrice ? '需要指定价格' : '不需要指定价格'}
              {orderConfig && 'requiresTrigger' in orderConfig && orderConfig.requiresTrigger && ' - 需要触发价格'}
            </p>
          </div>

          {/* 数量 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              数量 <span className="text-red-500">*</span>
              {lotSize && lotSize > 0 && (
                <span className="ml-2 text-xs text-gray-500">(最小交易单位: {lotSize})</span>
              )}
            </label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="请输入数量"
              min="1"
              step={lotSize || 1}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {/* 最小交易单位提示 */}
            {lotSize && lotSize > 0 && quantity && !isNaN(parseInt(quantity)) && (
              <div className="mt-1 text-xs">
                {parseInt(quantity) % lotSize === 0 ? (
                  <span className="text-green-600">✓ 数量符合最小交易单位要求</span>
                ) : (
                  <span className="text-red-600">
                    数量必须是 {lotSize} 的倍数，建议数量：{Math.ceil(parseInt(quantity) / lotSize) * lotSize}
                  </span>
                )}
              </div>
            )}
            {/* 融资选项（仅买入时显示） */}
            {side === 'Buy' && (
              <div className="mt-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={useMargin}
                    onChange={(e) => setUseMargin(e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm text-gray-700">使用融资下单</span>
                </label>
              </div>
            )}
            {/* 最大可买数量显示 */}
            {side === 'Buy' && maxQuantity && (
              <div className="mt-2 text-xs text-gray-600">
                {loadingMaxQty ? (
                  <span>正在查询最大可买数量...</span>
                ) : (
                  <>
                    <div className="mb-1">
                      <span className="font-semibold text-blue-600">
                        最大可买: {maxQuantity.max_qty} ({useMargin ? '融资' : '现金'})
                      </span>
                    </div>
                    <div className="text-gray-500">
                      <div>现金可买: <span className="font-semibold">{maxQuantity.cash}</span></div>
                      <div>融资可买: <span className="font-semibold">{maxQuantity.margin}</span></div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 价格（限价单需要） */}
          {orderConfig && 'requiresPrice' in orderConfig && orderConfig.requiresPrice && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                价格 <span className="text-red-500">*</span> {currentPrice && `(当前价: ${currentPrice})`}
              </label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="请输入价格"
                step="0.01"
                min="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {currentPrice && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPrice((parseFloat(currentPrice) * 0.99).toFixed(2))}
                    className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                  >
                    -1%
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrice(currentPrice)}
                    className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                  >
                    当前价
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrice((parseFloat(currentPrice) * 1.01).toFixed(2))}
                    className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                  >
                    +1%
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 触发价格（条件单需要） */}
          {orderConfig && 'requiresTrigger' in orderConfig && orderConfig.requiresTrigger && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                触发价格 <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={triggerPrice}
                onChange={(e) => setTriggerPrice(e.target.value)}
                placeholder="请输入触发价格"
                step="0.01"
                min="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                当行情价格达到触发价格时，订单会被提交
              </p>
            </div>
          )}

          {/* 跟踪止损单参数 */}
          {orderType === 'TSLPAMT' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  跟踪金额 <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={trailingAmount}
                  onChange={(e) => setTrailingAmount(e.target.value)}
                  placeholder="请输入跟踪金额"
                  step="0.01"
                  min="0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  指定价差 <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={limitOffset}
                  onChange={(e) => setLimitOffset(e.target.value)}
                  placeholder="请输入指定价差"
                  step="0.01"
                  min="0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          {orderType === 'TSLPPCT' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  跟踪涨跌幅 <span className="text-red-500">*</span> (%)
                </label>
                <input
                  type="number"
                  value={trailingPercent}
                  onChange={(e) => setTrailingPercent(e.target.value)}
                  placeholder="请输入跟踪涨跌幅，例如：0.5 表示 0.5%"
                  step="0.01"
                  min="0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  指定价差 <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={limitOffset}
                  onChange={(e) => setLimitOffset(e.target.value)}
                  placeholder="请输入指定价差"
                  step="0.01"
                  min="0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          {/* 高级选项 */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              {showAdvanced ? '▼' : '▶'} 高级选项
            </button>
          </div>

          {showAdvanced && (
            <div className="space-y-4 pl-4 border-l-2 border-gray-200">
              {/* 订单有效期 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  订单有效期
                </label>
                <select
                  value={timeInForce}
                  onChange={(e) => setTimeInForce(e.target.value as 'Day' | 'GTC' | 'GTD')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Day">当日有效</option>
                  <option value="GTC">撤单前有效</option>
                  <option value="GTD">到期前有效</option>
                </select>
              </div>

              {/* 过期日期（GTD需要） */}
              {timeInForce === 'GTD' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    过期日期 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={expireDate}
                    onChange={(e) => setExpireDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {/* 美股盘前盘后 */}
              {market === 'US' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    盘前盘后 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={outsideRth}
                    onChange={(e) => setOutsideRth(e.target.value as 'RTH_ONLY' | 'ANY_TIME' | 'OVERNIGHT')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="RTH_ONLY">不允许盘前盘后</option>
                    <option value="ANY_TIME">允许盘前盘后</option>
                    <option value="OVERNIGHT">夜盘</option>
                  </select>
                </div>
              )}

              {/* 备注 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  备注（最多64字符）
                </label>
                <input
                  type="text"
                  value={remark}
                  onChange={(e) => {
                    if (e.target.value.length <= 64) {
                      setRemark(e.target.value)
                    }
                  }}
                  placeholder="请输入备注"
                  maxLength={64}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {remark.length}/64 字符
                </p>
              </div>
            </div>
          )}

          {/* 金额计算 */}
          {quantity && price && !isNaN(parseFloat(price)) && (
            <div className="p-3 bg-gray-50 rounded-md">
              <div className="text-sm text-gray-600">
                预计金额: <span className="font-semibold text-gray-900">
                  ${(parseFloat(quantity) * parseFloat(price)).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* 按钮 */}
          <div className="flex gap-4 pt-4">
            <button
              onClick={handleSubmit}
              disabled={loading}
              className={`flex-1 px-4 py-2 rounded-md font-semibold text-white ${
                side === 'Buy'
                  ? 'bg-red-600 hover:bg-red-700 disabled:bg-gray-400'
                  : 'bg-green-600 hover:bg-green-700 disabled:bg-gray-400'
              }`}
            >
              {loading ? '提交中...' : side === 'Buy' ? '确认买入' : '确认卖出'}
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
