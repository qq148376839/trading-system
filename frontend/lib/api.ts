import axios from 'axios'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 30000, // 增加到30秒，因为持仓查询可能需要较长时间（期权行情查询）
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    return response.data
  },
  (error) => {
    if (error.response) {
      // 服务器返回了错误状态码
      const errorData = error.response.data
      throw new Error(errorData.error?.message || '请求失败')
    } else if (error.request) {
      // 请求已发出但没有收到响应
      throw new Error('网络错误，请检查API服务是否运行')
    } else {
      // 在设置请求时出错
      throw new Error(error.message || '请求失败')
    }
  }
)

// API接口封装
export const quoteApi = {
  /**
   * 获取标的实时行情
   * @param symbols 标的代码列表，例如：['700.HK', 'AAPL.US']
   */
  getQuote: (symbols: string[]) => {
    const symbolsParam = symbols.join(',')
    return api.get('/quote', { params: { symbol: symbolsParam } })
  },
  /**
   * 获取期权实时行情
   * @param symbols 期权代码列表，例如：['TSLA251128P395000.US']
   */
  getOptionQuote: (symbols: string[]) => {
    const symbolsParam = symbols.join(',')
    return api.get('/quote/option', { params: { symbol: symbolsParam } })
  },
  /**
   * 获取美股标的列表（用于自动完成）
   * @param query 搜索关键词，可选
   */
  getSecurityList: (query?: string) => {
    return api.get('/quote/security-list', { params: query ? { query } : {} })
  },
}

export const candlesticksApi = {
  /**
   * 获取K线数据
   * @param symbol 标的代码，例如：'700.HK'
   * @param period K线周期：1m, 5m, 15m, 30m, 60m, day, week, month, year
   * @param count K线数量
   */
  getCandlesticks: (symbol: string, period: string, count: number) => {
    return api.get('/candlesticks', {
      params: { symbol, period, count },
    })
  },
}

export const watchlistApi = {
  /**
   * 获取关注股票列表
   */
  getWatchlist: (enabled?: boolean) => {
    return api.get('/watchlist', {
      params: enabled !== undefined ? { enabled: enabled.toString() } : {},
    })
  },

  /**
   * 添加关注股票
   * @param symbol 标的代码，例如：'700.HK'
   */
  addWatchlist: (symbol: string) => {
    return api.post('/watchlist', { symbol })
  },

  /**
   * 移除关注股票
   * @param symbol 标的代码
   */
  removeWatchlist: (symbol: string) => {
    return api.delete(`/watchlist/${symbol}`)
  },

  /**
   * 启用/禁用关注股票
   * @param symbol 标的代码
   * @param enabled 是否启用
   */
  updateWatchlist: (symbol: string, enabled: boolean) => {
    return api.put(`/watchlist/${symbol}`, { enabled })
  },
}

export const tradesApi = {
  /**
   * 查询交易记录
   */
  getTrades: (params?: {
    symbol?: string
    status?: string
    start_date?: string
    end_date?: string
    limit?: number
    offset?: number
  }) => {
    return api.get('/trades', { params })
  },
}

export const positionsApi = {
  /**
   * 获取持仓列表
   */
  getPositions: () => {
    return api.get('/positions')
  },

  /**
   * 获取单个持仓详情
   * @param symbol 标的代码
   */
  getPosition: (symbol: string) => {
    return api.get(`/positions/${symbol}`)
  },

  /**
   * 创建或更新持仓
   */
  updatePosition: (data: {
    symbol: string
    symbol_name?: string
    quantity: number
    available_quantity?: number
    cost_price: number
    current_price: number
    currency?: string
    position_side?: 'Long' | 'Short'
  }) => {
    return api.post('/positions', data)
  },

  /**
   * 删除持仓（清仓）
   * @param symbol 标的代码
   */
  deletePosition: (symbol: string) => {
    return api.delete(`/positions/${symbol}`)
  },
}

export const tradingRulesApi = {
  /**
   * 获取交易规则列表
   * @param params 查询参数
   */
  getRules: (params?: {
    symbol?: string
    enabled?: boolean
  }) => {
    return api.get('/trading-rules', { params })
  },

  /**
   * 获取单个交易规则详情
   * @param id 规则ID
   */
  getRule: (id: number) => {
    return api.get(`/trading-rules/${id}`)
  },

  /**
   * 创建交易规则
   */
  createRule: (data: {
    symbol: string
    rule_name: string
    rule_type: 'price_alert' | 'auto_trade' | 'stop_loss' | 'take_profit' | 'trailing_stop' | 'dca'
    enabled?: boolean
    config?: Record<string, any>
  }) => {
    return api.post('/trading-rules', data)
  },

  /**
   * 更新交易规则
   * @param id 规则ID
   */
  updateRule: (id: number, data: {
    rule_name?: string
    rule_type?: string
    enabled?: boolean
    config?: Record<string, any>
  }) => {
    return api.put(`/trading-rules/${id}`, data)
  },

  /**
   * 删除交易规则
   * @param id 规则ID
   */
  deleteRule: (id: number) => {
    return api.delete(`/trading-rules/${id}`)
  },
}

export const ordersApi = {
  /**
   * 提交交易订单
   */
  submitOrder: (data: {
    symbol: string
    side: 'Buy' | 'Sell'
    order_type: string
    submitted_quantity: string
    submitted_price?: string
    trigger_price?: string
    limit_offset?: string
    trailing_amount?: string
    trailing_percent?: string
    expire_date?: string
    outside_rth?: 'RTH_ONLY' | 'ANY_TIME' | 'OVERNIGHT'
    time_in_force?: 'Day' | 'GTC' | 'GTD'
    remark?: string
  }) => {
    return api.post('/orders/submit', data)
  },

  /**
   * 预估最大购买数量
   */
  estimateMaxQuantity: (params: {
    symbol: string
    order_type: string
    side: 'Buy' | 'Sell'
    price?: string
    currency?: string
    order_id?: string
    use_margin?: boolean | string
  }) => {
    return api.get('/orders/estimate-max-quantity', { params })
  },

  /**
   * 取消订单
   * @param orderId 订单ID
   */
  cancelOrder: (orderId: string) => {
    return api.delete(`/orders/${orderId}`)
  },

  /**
   * 查询账户余额
   */
  getAccountBalance: (currency?: string) => {
    return api.get('/orders/account-balance', { params: currency ? { currency } : {} })
  },

  /**
   * 查询今日订单
   */
  getTodayOrders: (params?: {
    symbol?: string
    status?: string[]
    side?: 'Buy' | 'Sell'
    market?: 'US' | 'HK'
    order_id?: string
  }) => {
    return api.get('/orders/today', { params })
  },

  /**
   * 查询历史订单
   */
  getHistoryOrders: (params?: {
    symbol?: string
    status?: string[]
    side?: 'Buy' | 'Sell'
    market?: 'US' | 'HK'
    start_at?: number | string  // 时间戳（秒）或ISO字符串
    end_at?: number | string    // 时间戳（秒）或ISO字符串
  }) => {
    return api.get('/orders/history', { params })
  },

  /**
   * 查询订单详情
   * @param orderId 订单ID
   */
  getOrderDetail: (orderId: string) => {
    return api.get(`/orders/${orderId}`)
  },

  /**
   * 修改订单
   * @param orderId 订单ID
   * @param data 修改数据（quantity和/或price）
   */
  replaceOrder: (orderId: string, data: {
    quantity?: number
    price?: number
  }) => {
    return api.put(`/orders/${orderId}`, data)
  },

  /**
   * 同步订单状态和持仓数据
   */
  syncStatus: () => {
    return api.post('/orders/sync-status')
  },
}

export const forexApi = {
  /**
   * 获取支持的外汇产品列表
   */
  getProducts: () => {
    return api.get('/forex/products')
  },

  /**
   * 获取外汇实时报价
   * @param product 外汇产品代码：USDINDEX, EURINDEX, XAUUSD
   */
  getQuote: (product: string) => {
    return api.get('/forex/quote', { params: { product } })
  },

  /**
   * 获取外汇K线数据
   * @param product 外汇产品代码：USDINDEX, EURINDEX, XAUUSD
   * @param type K线类型：minute, 5day, day, week, month, quarter, year
   */
  getCandlestick: (product: string, type: string) => {
    return api.get('/forex/candlestick', { params: { product, type } })
  },
}

export const healthApi = {
  /**
   * 健康检查
   */
  checkHealth: () => {
    return api.get('/health')
  },
}

export const configApi = {
  /**
   * 管理员登录
   */
  login: (username: string, password: string) => {
    return api.post('/config/auth', { username, password })
  },

  /**
   * 获取所有配置
   */
  getConfigs: (username: string, password: string) => {
    return api.post('/config', { username, password })
  },

  /**
   * 更新配置
   */
  updateConfig: (key: string, value: string, encrypted: boolean, username: string, password: string) => {
    return api.put(`/config/${key}`, { value, encrypted, username, password })
  },

  /**
   * 批量更新配置
   */
  batchUpdateConfigs: (configs: Array<{ key: string; value: string; encrypted?: boolean }>, username: string, password: string) => {
    return api.post('/config/batch', { configs, username, password })
  },

  /**
   * 删除配置
   */
  deleteConfig: (key: string, username: string, password: string) => {
    return api.delete(`/config/${key}`, { data: { username, password } })
  },

  /**
   * 获取管理员列表
   */
  getAdminList: (username: string, password: string) => {
    return api.post('/config/admin/list', { username, password })
  },

  /**
   * 更新管理员账户
   * @param id 管理员账户ID
   * @param data 更新数据
   * @param username 当前登录用户名（用于认证）
   * @param password 当前登录密码（用于认证）
   */
  updateAdmin: (
    id: number, 
    data: { 
      username?: string
      oldPassword?: string      // 修改密码时的原密码
      newPassword?: string      // 新密码
      confirmPassword?: string   // 确认新密码
      is_active?: boolean 
    }, 
    username: string, 
    password: string
  ) => {
    // 构建请求体，确保认证字段不被覆盖
    const requestBody: any = {
      // 认证字段（用于requireAdmin中间件）- 必须存在
      username, 
      password,
    }
    
    // 添加更新字段
    if (data.username !== undefined) {
      requestBody.updateUsername = data.username  // 使用不同的字段名避免覆盖认证字段
    }
    if (data.oldPassword !== undefined) {
      requestBody.oldPassword = data.oldPassword
    }
    if (data.newPassword !== undefined) {
      requestBody.newPassword = data.newPassword
    }
    if (data.confirmPassword !== undefined) {
      requestBody.confirmPassword = data.confirmPassword
    }
    if (data.is_active !== undefined) {
      requestBody.is_active = data.is_active
    }
    
    return api.put(`/config/admin/${id}`, requestBody)
  },

  /**
   * 创建管理员账户
   */
  createAdmin: (newUsername: string, newPassword: string, username: string, password: string) => {
    return api.post('/config/admin', { newUsername, newPassword, username, password })
  },
}

export const tokenRefreshApi = {
  /**
   * 手动刷新Token
   */
  refreshToken: () => {
    return api.post('/token-refresh/refresh')
  },

  /**
   * 获取Token状态
   */
  getTokenStatus: () => {
    return api.get('/token-refresh/status')
  },

  /**
   * 触发自动刷新检查
   */
  autoRefresh: () => {
    return api.post('/token-refresh/auto-refresh')
  },
}

export const tradingRecommendationApi = {
  /**
   * 获取交易推荐（批量）
   * @param symbols 股票代码列表，例如：['AAPL.US', 'TSLA.US']
   */
  getRecommendations: (symbols: string[]) => {
    const symbolsParam = symbols.join(',')
    return api.get('/trading-recommendation', { params: { symbols: symbolsParam } })
  },

  /**
   * 获取单个股票的交易推荐
   * @param symbol 股票代码，例如：'AAPL.US'
   */
  getRecommendation: (symbol: string) => {
    return api.get(`/trading-recommendation/${symbol}`)
  },
}

export const optionsApi = {
  /**
   * 获取期权到期日期列表
   * @param stockId 正股ID（可选，如果提供则直接使用）
   * @param symbol 股票代码（可选，例如：'TSLA.US'，如果提供symbol会自动查找stockId）
   */
  getStrikeDates: (params?: { stockId?: string; symbol?: string }) => {
    return api.get('/options/strike-dates', { params })
  },

  /**
   * 获取期权链数据
   * @param stockId 正股ID（可选）
   * @param strikeDate 到期日期时间戳（秒级）
   * @param symbol 股票代码（可选，如果提供symbol会自动查找stockId）
   */
  getOptionChain: (params: {
    stockId?: string
    strikeDate: number
    symbol?: string
  }) => {
    return api.get('/options/chain', { params })
  },

  /**
   * 获取期权详情
   * @param optionId 期权ID
   * @param underlyingStockId 正股ID
   * @param marketType 市场类型（可选，默认2=美股）
   */
  getOptionDetail: (params: {
    optionId: string
    underlyingStockId: string
    marketType?: number
  }) => {
    return api.get('/options/detail', { params })
  },

  /**
   * 获取正股行情
   * @param stockId 正股ID（可选）
   * @param symbol 股票代码（可选，例如：'TSLA.US'）
   */
  getUnderlyingQuote: (params?: { stockId?: string; symbol?: string }) => {
    return api.get('/options/underlying-quote', { params })
  },
}

// 量化交易 API
export const backtestApi = {
  /**
   * 执行回测
   */
  runBacktest: (data: {
    strategyId: number;
    symbols: string[];
    startDate: string;
    endDate: string;
    config?: any;
  }) => {
    return api.post('/quant/backtest', data);
  },

  /**
   * 获取回测结果
   */
  getBacktestResult: (id: number) => {
    return api.get(`/quant/backtest/${id}`);
  },

  /**
   * 获取回测状态
   */
  getBacktestStatus: (id: number) => {
    return api.get(`/quant/backtest/${id}/status`);
  },

  /**
   * 重试失败的回测任务
   */
  retryBacktest: (id: number, symbols: string[]) => {
    return api.post(`/quant/backtest/${id}/retry`, { symbols });
  },

  /**
   * 获取策略的所有回测结果
   */
  getBacktestResultsByStrategy: (strategyId: number) => {
    return api.get(`/quant/backtest/strategy/${strategyId}`);
  },
  /**
   * 删除回测结果
   */
  deleteBacktestResult: (id: number) => {
    return api.delete(`/quant/backtest/${id}`);
  },

  /**
   * 批量删除回测结果
   */
  deleteBacktestResults: (ids: number[]) => {
    return api.delete('/quant/backtest/batch', { data: { ids } });
  },

  /**
   * 导出回测结果为JSON文件
   */
  exportBacktest: async (id: number): Promise<Blob> => {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const response = await axios.get(`${API_BASE_URL}/api/quant/backtest/${id}/export`, {
      responseType: 'blob',
    });
    return response.data;
  },
};

export const quantApi = {
  // 策略管理
  getStrategies: () => {
    return api.get('/quant/strategies')
  },
  getStrategy: (id: number) => {
    return api.get(`/quant/strategies/${id}`)
  },
  createStrategy: (data: any) => {
    return api.post('/quant/strategies', data)
  },
  updateStrategy: (id: number, data: any) => {
    return api.put(`/quant/strategies/${id}`, data)
  },
  deleteStrategy: (id: number) => {
    return api.delete(`/quant/strategies/${id}`)
  },
  startStrategy: (id: number) => {
    return api.post(`/quant/strategies/${id}/start`)
  },
  stopStrategy: (id: number) => {
    return api.post(`/quant/strategies/${id}/stop`)
  },
  getStrategyInstances: (id: number) => {
    return api.get(`/quant/strategies/${id}/instances`)
  },

  // 资金管理
  getCapitalAllocations: () => {
    return api.get('/quant/capital/allocations')
  },
  createCapitalAllocation: (data: any) => {
    return api.post('/quant/capital/allocations', data)
  },
  updateCapitalAllocation: (id: number, data: any) => {
    return api.put(`/quant/capital/allocations/${id}`, data)
  },
  deleteCapitalAllocation: (id: number) => {
    return api.delete(`/quant/capital/allocations/${id}`)
  },
  getCapitalUsage: () => {
    return api.get('/quant/capital/usage')
  },
  syncBalance: () => {
    return api.post('/quant/capital/sync-balance')
  },
  getBalanceDiscrepancies: () => {
    return api.get('/quant/capital/balance-discrepancies')
  },

  // 选股器
  getBlacklist: () => {
    return api.get('/quant/stock-selector/blacklist')
  },
  addToBlacklist: (data: { symbol: string; reason?: string }) => {
    return api.post('/quant/stock-selector/blacklist', data)
  },
  removeFromBlacklist: (symbol: string) => {
    return api.delete(`/quant/stock-selector/blacklist/${symbol}`)
  },

  // 信号日志
  getSignals: (params?: { strategyId?: number; status?: string; limit?: number }) => {
    return api.get('/quant/signals', { params })
  },

  // 交易记录
  getTrades: (params?: { strategyId?: number; symbol?: string; limit?: number }) => {
    return api.get('/quant/trades', { params })
  },
}


