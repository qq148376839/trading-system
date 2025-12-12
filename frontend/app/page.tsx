'use client'

import { useEffect, useState, useRef } from 'react'
import React from 'react'
import Link from 'next/link'
import { quoteApi, watchlistApi, positionsApi, tradingRulesApi, ordersApi, tradingRecommendationApi } from '@/lib/api'
import TradeModal from '@/components/TradeModal'
import AppLayout from '@/components/AppLayout'
import { Button, Input, Card, Table, Tag, Badge, Spin, message, Space, AutoComplete, Switch, Select, Skeleton, Modal, Alert } from 'antd'

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
  trade_status?: number
  pre_market_quote?: {
    last_done: string
    timestamp: number
    volume: number
    turnover: string
    high: string
    low: string
    prev_close: string
  }
  post_market_quote?: {
    last_done: string
    timestamp: number
    volume: number
    turnover: string
    high: string
    low: string
    prev_close: string
  }
  overnight_quote?: {
    last_done: string
    timestamp: number
    volume: number
    turnover: string
    high: string
    low: string
    prev_close: string
  }
}

interface Position {
  id: number
  symbol: string
  symbol_name: string
  quantity: number
  cost_price: string
  current_price: string
  market_value: string
  unrealized_pl: string
  unrealized_pl_ratio: string
  currency: string
  contract_multiplier?: number  // 期权合约乘数
}

interface WatchlistItem {
  id: number
  symbol: string
  enabled: boolean
}

interface TradingRecommendation {
  symbol: string
  action: 'BUY' | 'SELL' | 'HOLD'
  entry_price_range: {
    min: number
    max: number
  }
  stop_loss: number
  take_profit: number
  risk_reward_ratio: number
  market_environment: '良好' | '较差' | '中性' | '中性利好' | '中性利空'
  comprehensive_market_strength: number
  trend_consistency: string
  analysis_summary: string
  risk_note: string
}

interface StockRow extends Quote {
  isWatched: boolean
  isHeld: boolean
  position?: Position
  tradingRecommendation?: TradingRecommendation
  _error?: boolean // 标记为获取失败的股票
}

export default function Home() {
  const [stocks, setStocks] = useState<StockRow[]>([])
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [newSymbol, setNewSymbol] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [expandedRecommendations, setExpandedRecommendations] = useState<Set<string>>(new Set())
  const [refreshingRecommendations, setRefreshingRecommendations] = useState<Set<string>>(new Set())
  
  // 辅助函数：获取市场环境的样式
  const getMarketEnvironmentStyle = (env: '良好' | '较差' | '中性' | '中性利好' | '中性利空') => {
    switch (env) {
      case '良好':
        return { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300', icon: '✓' }
      case '较差':
        return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300', icon: '⚠' }
      case '中性利好':
        return { bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-200', icon: '↑' }
      case '中性利空':
        return { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', icon: '↓' }
      default: // '中性'
        return { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300', icon: '○' }
    }
  }
  
  // 辅助函数：获取趋势一致性的样式
  const getTrendConsistencyStyle = (consistency: string) => {
    if (consistency.includes('利好')) {
      return { text: 'text-green-600', bg: 'bg-green-50' }
    } else if (consistency.includes('利空')) {
      return { text: 'text-red-600', bg: 'bg-red-50' }
    } else {
      return { text: 'text-yellow-600', bg: 'bg-yellow-50' }
    }
  }
  
  // 辅助函数：获取市场强度的样式
  const getMarketStrengthStyle = (strength: number) => {
    if (strength > 50) {
      return { text: 'text-green-600', bg: 'bg-green-50' }
    } else if (strength < -50) {
      return { text: 'text-red-600', bg: 'bg-red-50' }
    } else {
      return { text: 'text-gray-600', bg: 'bg-gray-50' }
    }
  }
  
  // 切换推荐详情展开/收起
  const toggleRecommendationDetails = (symbol: string) => {
    const newExpanded = new Set(expandedRecommendations)
    if (newExpanded.has(symbol)) {
      newExpanded.delete(symbol)
    } else {
      newExpanded.add(symbol)
    }
    setExpandedRecommendations(newExpanded)
  }
  
  // 自动完成相关状态
  const [autocompleteSuggestions, setAutocompleteSuggestions] = useState<Array<{
    symbol: string
    name_cn: string
    name_en: string
  }>>([])
  const [showAutocomplete, setShowAutocomplete] = useState(false)
  const [searchingAutocomplete, setSearchingAutocomplete] = useState(false)
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null) // 用于设置交易规则的股票
  const [tradeSymbol, setTradeSymbol] = useState<string | null>(null) // 用于交易的股票
  const [tradePrice, setTradePrice] = useState<string | null>(null) // 交易时的价格
  const [accountBalance, setAccountBalance] = useState<{
    currency: string
    totalCash: string
    netAssets: string
    buyPower: string
    maxFinanceAmount?: string
    remainingFinanceAmount?: string
    riskLevel?: string
    marginCall?: string
    initMargin?: string
    maintenanceMargin?: string
    market?: string
    cashInfos: Array<{
      currency: string
      availableCash: string
      frozenCash: string
      settlingCash: string
      withdrawCash: string
    }>
    frozenTransactionFees?: Array<{
      currency: string
      frozenTransactionFee: string
    }>
  } | null>(null)
  const [accountDetailsExpanded, setAccountDetailsExpanded] = useState(false)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [lastBalanceFetch, setLastBalanceFetch] = useState<number>(0)

  // 加载持仓列表
  const fetchPositions = async () => {
    try {
      const response = await positionsApi.getPositions()
      if (response.success && response.data?.positions) {
        setPositions(response.data.positions)
      }
    } catch (err: any) {
      console.error('获取持仓失败:', err)
    }
  }

  // 加载关注列表
  const fetchWatchlist = async () => {
    try {
      const response = await watchlistApi.getWatchlist()
      if (response.success && response.data?.watchlist) {
        setWatchlist(response.data.watchlist)
      }
    } catch (err: any) {
      console.error('获取关注列表失败:', err)
    }
  }

  // 加载行情数据
  const fetchQuotes = async (isRefresh: boolean = false) => {
    setLoading(true)
    setError(null)

    try {
      // 获取所有持仓和关注的股票代码
      const positionSymbols = positions.map(p => p.symbol)
      const watchlistSymbols = watchlist.filter(w => w.enabled).map(w => w.symbol)
      const allSymbols = [...new Set([...positionSymbols, ...watchlistSymbols])]

      if (allSymbols.length === 0) {
        setStocks([])
        setLoading(false)
        return
      }

      // 分离普通股票和期权
      const stockSymbols = allSymbols.filter(s => !isOptionSymbol(s))
      const optionSymbols = allSymbols.filter(s => isOptionSymbol(s))

      // 并行获取股票和期权行情
      // 注意：期权权限错误不应该影响普通股票的显示
      let stockResponse: any = { success: true, data: { secu_quote: [], failed_symbols: [] } }
      let optionResponse: any = { success: true, data: { secu_quote: [], failed_symbols: [] } }
      
      // 获取普通股票行情（必须成功）
      if (stockSymbols.length > 0) {
        try {
          stockResponse = await quoteApi.getQuote(stockSymbols)
        } catch (err: any) {
          console.error('获取普通股票行情失败:', err)
          stockResponse = { success: false, data: { secu_quote: [], failed_symbols: stockSymbols } }
        }
      }
      
      // 获取期权行情（失败不影响其他股票）
      if (optionSymbols.length > 0) {
        try {
          optionResponse = await quoteApi.getOptionQuote(optionSymbols)
        } catch (err: any) {
          console.warn('获取期权行情失败（可能是权限不足）:', err)
          // 期权权限错误不影响其他股票，将期权标记为失败即可
          optionResponse = { 
            success: false, 
            data: { 
              secu_quote: [], 
              failed_symbols: optionSymbols 
            } 
          }
        }
      }

      // 合并结果（即使期权失败，只要普通股票成功就继续）
      const response = {
        success: stockResponse.success, // 只检查普通股票是否成功
        data: {
          secu_quote: [
            ...(stockResponse.data?.secu_quote || []),
            ...(optionResponse.data?.secu_quote || [])
          ],
          failed_symbols: [
            ...(stockResponse.data?.failed_symbols || []),
            ...(optionResponse.data?.failed_symbols || [])
          ]
        }
      }
      
      if (response.success && response.data) {
        const quotes: Quote[] = response.data.secu_quote || []
        const failedSymbols: string[] = response.data.failed_symbols || []
        
        // 处理成功的股票
        const stockRows: StockRow[] = quotes.map(quote => {
          const isWatched = watchlist.some(w => w.symbol === quote.symbol && w.enabled)
          const position = positions.find(p => p.symbol === quote.symbol)
          const isHeld = !!position

          return {
            ...quote,
            isWatched,
            isHeld,
            position,
          }
        })
        
        // 处理失败的股票（只显示关注的股票，持仓的股票不显示因为没有数据）
        const failedWatchlistSymbols = failedSymbols.filter(symbol => {
          const isWatched = watchlist.some(w => w.symbol === symbol && w.enabled)
          const isHeld = positions.some(p => p.symbol === symbol)
          // 如果是关注的股票，或者有持仓但没行情数据，也要显示出来
          return isWatched || isHeld
        })
        
        // 为失败的股票创建占位行
        const failedRows: StockRow[] = failedWatchlistSymbols.map(symbol => {
          const isWatched = watchlist.some(w => w.symbol === symbol && w.enabled)
          const position = positions.find(p => p.symbol === symbol)
          const isHeld = !!position
          
          return {
            symbol,
            last_done: '0',
            prev_close: '0',
            open: '0',
            high: '0',
            low: '0',
            volume: 0,
            turnover: '0',
            timestamp: 0,
            trade_status: 0,
            isWatched,
            isHeld,
            position: position || undefined,
            _error: true, // 标记为错误
          }
        })
        
        // 合并成功和失败的股票，并排序：持仓的股票排在前面
        const allStocks = [...stockRows, ...failedRows]
        // 排序：持仓的股票优先，然后按代码排序
        allStocks.sort((a, b) => {
          // 如果a是持仓，b不是持仓，a排在前面
          if (a.isHeld && !b.isHeld) return -1
          // 如果b是持仓，a不是持仓，b排在前面
          if (!a.isHeld && b.isHeld) return 1
          // 如果都是持仓或都不是持仓，按代码排序
          return a.symbol.localeCompare(b.symbol)
        })
        setStocks(allStocks)

        // 如果有失败的股票，显示警告
        if (failedSymbols.length > 0) {
          console.warn('以下股票未能获取到行情数据:', failedSymbols.join(', '))
        }

        // 获取交易推荐（只针对US股票，异步获取，不阻塞行情显示）
        // 如果是刷新，保留旧的推荐数据，只更新新数据
        fetchRecommendations(allSymbols.filter(s => s.endsWith('.US') && !isOptionSymbol(s)), isRefresh)
      }
    } catch (err: any) {
      setError(err.message || '获取行情失败')
    } finally {
      setLoading(false)
    }
  }

  // 获取交易推荐
  const fetchRecommendations = async (usSymbols: string[], isRefresh: boolean = false) => {
    if (usSymbols.length === 0) return

    // 如果是刷新，标记正在刷新的股票
    if (isRefresh) {
      setRefreshingRecommendations(new Set(usSymbols))
    }

    try {
      console.log('获取交易推荐:', usSymbols)
      const response = await tradingRecommendationApi.getRecommendations(usSymbols)

      if (response.success && response.data?.recommendations) {
        const recommendationsMap = new Map(
          response.data.recommendations.map((r: TradingRecommendation) => [r.symbol, r])
        )

        // 更新stocks状态，添加推荐信息
        // 如果是刷新，保留旧数据；如果是首次加载，替换数据
        setStocks((prevStocks: StockRow[]) =>
          prevStocks.map((stock: StockRow) => {
            const newRecommendation = recommendationsMap.get(stock.symbol)
            if (newRecommendation) {
              return {
                ...stock,
                tradingRecommendation: newRecommendation,
              } as StockRow
            }
            // 如果没有新数据，保留旧数据（避免闪烁和布局跳动）
            return stock
          })
        )

        console.log(`成功获取 ${response.data.recommendations.length} 个交易推荐`)
      }
    } catch (error: any) {
      console.error('获取交易推荐失败:', error)
      // 不影响页面显示，只记录错误
    } finally {
      // 清除刷新状态
      if (isRefresh) {
        setRefreshingRecommendations(new Set())
      }
    }
  }

  // 加载账户余额（带节流，避免频繁请求）
  const fetchAccountBalance = async (force: boolean = false) => {
    const now = Date.now()
    const MIN_INTERVAL = 5000 // 最小间隔5秒
    
    // 如果不是强制刷新，且距离上次请求不足5秒，则跳过
    if (!force && now - lastBalanceFetch < MIN_INTERVAL) {
      console.log('账户余额请求被节流，距离上次请求不足5秒')
      return
    }
    
    // 如果正在加载中，跳过
    if (balanceLoading) {
      return
    }
    
    setBalanceLoading(true)
    setLastBalanceFetch(now)
    
    try {
      const response = await ordersApi.getAccountBalance() // 不传currency，获取所有币种
      if (response.success && response.data?.balances && response.data.balances.length > 0) {
        const balance = response.data.balances[0]
        
        // 保存完整的账户余额信息，包括所有币种和详细信息
        setAccountBalance({
          currency: balance.currency || 'USD',
          totalCash: balance.totalCash || '0',
          netAssets: balance.netAssets || '0',
          buyPower: balance.buyPower || '0',
          maxFinanceAmount: balance.maxFinanceAmount,
          remainingFinanceAmount: balance.remainingFinanceAmount,
          riskLevel: balance.riskLevel,
          marginCall: balance.marginCall,
          initMargin: balance.initMargin,
          maintenanceMargin: balance.maintenanceMargin,
          market: balance.market,
          cashInfos: balance.cashInfos || [],
          frozenTransactionFees: balance.frozenTransactionFees || []
        })
      }
    } catch (err: any) {
      console.error('获取账户余额失败:', err)
      // 如果是频率限制错误，不显示错误，静默失败
      if (err.message && err.message.includes('429')) {
        console.warn('账户余额请求频率过高，已自动节流')
      }
    } finally {
      setBalanceLoading(false)
    }
  }

  // 初始加载
  useEffect(() => {
    const loadData = async () => {
      await fetchPositions()
      await fetchWatchlist()
      await fetchAccountBalance(true) // 初始加载强制刷新
    }
    loadData()
  }, [])

  // 当持仓或关注列表变化时，重新加载行情
  useEffect(() => {
    if (positions.length > 0 || watchlist.length > 0) {
      fetchQuotes()
    }
  }, [positions, watchlist])

  // 自动刷新行情（每30秒）
  useEffect(() => {
    const interval = setInterval(() => {
      if (positions.length > 0 || watchlist.length > 0) {
        fetchQuotes(true) // 传递 isRefresh=true，保留旧数据
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [positions, watchlist])

  // 清理自动完成搜索定时器
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])

  // 添加关注
  const handleAddWatchlist = async () => {
    if (!newSymbol.trim()) {
      setError('请输入股票代码')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      await watchlistApi.addWatchlist(newSymbol.trim())
      setSuccess('添加成功')
      setNewSymbol('')
      await fetchWatchlist()
    } catch (err: any) {
      setError(err.message || '添加失败')
    } finally {
      setLoading(false)
    }
  }

  // 移除关注
  const handleRemoveWatchlist = async (symbol: string) => {
    if (!confirm(`确定要移除 ${symbol} 吗？`)) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      await watchlistApi.removeWatchlist(symbol)
      setSuccess('移除成功')
      await fetchWatchlist()
    } catch (err: any) {
      setError(err.message || '移除失败')
    } finally {
      setLoading(false)
    }
  }

  // 自动完成搜索（带防抖）
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const handleSymbolInputChange = (value: string) => {
    setNewSymbol(value)
    
    // 清除之前的定时器
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    
    // 如果输入为空或长度小于2，隐藏下拉列表
    if (!value || value.trim().length < 2) {
      setShowAutocomplete(false)
      setAutocompleteSuggestions([])
      return
    }
    
    // 如果已经包含完整的股票代码格式（如 .US 或 .HK），不搜索
    if (value.includes('.') && value.trim().length > 3) {
      setShowAutocomplete(false)
      return
    }
    
    // 防抖：延迟500ms后执行搜索
    searchTimeoutRef.current = setTimeout(async () => {
      setSearchingAutocomplete(true)
      try {
        const response = await quoteApi.getSecurityList(value.trim())
        if (response.success && response.data?.securities) {
          setAutocompleteSuggestions(response.data.securities)
          setShowAutocomplete(true)
        }
      } catch (err: any) {
        console.error('搜索标的失败:', err)
        // 搜索失败不影响输入，静默处理
      } finally {
        setSearchingAutocomplete(false)
      }
    }, 500)
  }

  // 选择自动完成项
  const handleSelectSuggestion = (symbol: string) => {
    setNewSymbol(symbol)
    setShowAutocomplete(false)
    setAutocompleteSuggestions([])
  }

  const calculateChange = (last: string, prev: string) => {
    const lastNum = parseFloat(last)
    const prevNum = parseFloat(prev)
    const change = lastNum - prevNum
    const changePercent = prevNum > 0 ? ((change / prevNum) * 100).toFixed(2) : '0.00'
    return { change, changePercent }
  }

  // 检测美国是否处于夏令时
  // 夏令时规则：
  // - 开始：3月的第二个星期日 02:00（美国东部时间）
  // - 结束：11月的第一个星期日 02:00（美国东部时间）
  // 注意：这里简化处理，只判断日期，不精确到小时
  // 夏令时期间：3月第二个星期日 - 11月第一个星期日（不包括11月第一个星期日）
  const isUSDaylightSavingTime = (): boolean => {
    const now = new Date()
    const year = now.getFullYear()
    
    // 获取3月的第二个星期日（夏令时开始）
    const marchSecondSunday = getNthSundayOfMonth(year, 3, 2)
    // 获取11月的第一个星期日（夏令时结束）
    const novemberFirstSunday = getNthSundayOfMonth(year, 11, 1)
    
    // 获取当前日期（只比较年月日，不考虑时间）
    const currentDate = new Date(year, now.getMonth(), now.getDate())
    
    // 创建日期对象用于比较（只比较年月日）
    const marchDate = new Date(year, 2, marchSecondSunday.getDate()) // 月份从0开始，3月是2
    const novemberDate = new Date(year, 10, novemberFirstSunday.getDate()) // 11月是10
    
    // 如果当前日期在3月第二个星期日之后（包括当天），且在11月第一个星期日之前，则为夏令时
    // 注意：由于夏令时在凌晨2:00切换，我们简化处理，认为当天就是夏令时
    // 这样可能在某些切换日的凌晨2:00之前有1小时的误差，但对大多数场景影响不大
    return currentDate >= marchDate && currentDate < novemberDate
  }

  // 获取指定年份、月份的第N个星期日
  // 参数：year（年份），month（月份，1-12），n（第几个星期日，从1开始）
  // 返回：Date对象，表示该日期
  const getNthSundayOfMonth = (year: number, month: number, n: number): Date => {
    // 月份从0开始，所以需要减1
    const firstDay = new Date(year, month - 1, 1)
    const firstDayOfWeek = firstDay.getDay() // 0=周日, 1=周一, ..., 6=周六
    
    // 计算第一个星期日的日期
    // 如果1号是周日（getDay() === 0），第一个星期日就是1号
    // 如果1号是周一（getDay() === 1），第一个星期日就是7号（8-1=7）
    // 如果1号是周二（getDay() === 2），第一个星期日就是6号（8-2=6）
    // 通用公式：firstSunday = firstDayOfWeek === 0 ? 1 : 8 - firstDayOfWeek
    const firstSunday = firstDayOfWeek === 0 ? 1 : 8 - firstDayOfWeek
    
    // 计算第N个星期日的日期（第1个星期日 + (N-1) * 7天）
    const nthSunday = firstSunday + (n - 1) * 7
    
    return new Date(year, month - 1, nthSunday)
  }

  // 判断是否为期权代码
  // 期权代码格式：TSLA251128P395000.US (股票代码 + 6位日期 + P/C + 行权价 + .US)
  const isOptionSymbol = (symbol: string): boolean => {
    const optionPattern = /^\w+\d{6}[PC]\d+\.US$/
    return optionPattern.test(symbol)
  }

  // 根据交易状态和时间戳获取当前应该显示的价格
  // 需要考虑不同市场的交易时段
  const getCurrentPrice = (stock: StockRow) => {
    // 判断股票市场：.US是美股，.HK是港股，.CN是A股
    const isUSStock = stock.symbol.endsWith('.US')
    const isHKStock = stock.symbol.endsWith('.HK')
    
    // 获取当前北京时间（使用Intl API，更可靠）
    const now = new Date()
    const beijingTimeString = now.toLocaleString('en-US', { 
      timeZone: 'Asia/Shanghai',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    // 解析时间字符串，格式：MM/DD/YYYY, HH:mm:ss
    const [datePart, timePart] = beijingTimeString.split(', ')
    const [hour, minute] = timePart.split(':').map(Number)
    const currentTime = hour * 60 + minute // 转换为分钟数，便于比较
    
    // 收集所有可用的价格和它们的时间戳
    const priceOptions: Array<{
      price: string
      prevClose: string
      label: string
      badgeClass: string
      priceClass: string
      timestamp: number
      priority: number // 优先级，数字越大优先级越高
    }> = []
    
    if (isUSStock) {
      // 美股交易时段判断（根据夏令时/冬令时自动切换）
      // 夏令时：盘前 16:00-21:30，常规 21:30-次日4:00，盘后 4:00-8:00（北京时间）
      // 冬令时：盘前 17:00-22:30，常规 22:30-次日5:00，盘后 5:00-9:00（北京时间）
      
      const isDST = isUSDaylightSavingTime()
      
      // 根据夏令时/冬令时设置交易时段
      const preMarketStart = isDST ? 16 * 60 : 17 * 60 // 夏令时16:00，冬令时17:00
      const preMarketEnd = isDST ? 21 * 60 + 30 : 22 * 60 + 30 // 夏令时21:30，冬令时22:30
      const regularMarketStart = preMarketEnd // 常规交易开始 = 盘前结束
      const regularMarketEnd = isDST ? 4 * 60 : 5 * 60 // 夏令时次日4:00，冬令时次日5:00
      const postMarketStart = regularMarketEnd // 盘后开始 = 常规结束
      const postMarketEnd = isDST ? 8 * 60 : 9 * 60 // 夏令时8:00，冬令时9:00
      
      const isPreMarket = currentTime >= preMarketStart && currentTime < preMarketEnd
      const isRegularMarket = currentTime >= regularMarketStart || currentTime < regularMarketEnd
      const isPostMarket = currentTime >= postMarketStart && currentTime < postMarketEnd
      
      // 夜盘价格（最高优先级）
      if (stock.overnight_quote?.last_done) {
        let timestamp = stock.overnight_quote.timestamp || 0
        if (timestamp > 1e12) {
          timestamp = timestamp / 1000
        }
        priceOptions.push({
          price: stock.overnight_quote.last_done,
          prevClose: stock.overnight_quote.prev_close,
          label: '夜盘',
          badgeClass: 'bg-purple-100 text-purple-800',
          priceClass: 'text-purple-600',
          timestamp: timestamp,
          priority: isPostMarket ? 5 : 4 // 盘后时段夜盘优先级最高
        })
      }
      
      // 盘后价格
      if (stock.post_market_quote?.last_done) {
        let timestamp = stock.post_market_quote.timestamp || 0
        if (timestamp > 1e12) {
          timestamp = timestamp / 1000
        }
        priceOptions.push({
          price: stock.post_market_quote.last_done,
          prevClose: stock.post_market_quote.prev_close,
          label: '盘后',
          badgeClass: 'bg-blue-100 text-blue-800',
          priceClass: 'text-blue-600',
          timestamp: timestamp,
          priority: isPostMarket ? 4 : 3 // 盘后时段优先级高
        })
      }
      
      // 常规交易价格
      if (stock.last_done) {
        let timestamp = stock.timestamp || 0
        if (timestamp > 1e12) {
          timestamp = timestamp / 1000
        }
        priceOptions.push({
          price: stock.last_done,
          prevClose: stock.prev_close,
          label: '盘中',
          badgeClass: '',
          priceClass: '',
          timestamp: timestamp,
          priority: isRegularMarket ? 4 : 2 // 常规时段优先级高
        })
      }
      
      // 盘前价格
      if (stock.pre_market_quote?.last_done) {
        let timestamp = stock.pre_market_quote.timestamp || 0
        if (timestamp > 1e12) {
          timestamp = timestamp / 1000
        }
        priceOptions.push({
          price: stock.pre_market_quote.last_done,
          prevClose: stock.pre_market_quote.prev_close,
          label: '盘前',
          badgeClass: 'bg-orange-100 text-orange-800',
          priceClass: 'text-orange-600',
          timestamp: timestamp,
          priority: isPreMarket ? 4 : 2 // 盘前时段优先级高
        })
      }
      
    } else if (isHKStock) {
      // 港股交易时段判断（北京时间）
      // 早市：9:30 - 12:00
      // 午市：13:00 - 16:00
      // 港股没有盘前盘后交易，只有常规交易
      
      const isMorningSession = currentTime >= 9 * 60 + 30 && currentTime < 12 * 60 // 9:30 - 12:00
      const isAfternoonSession = currentTime >= 13 * 60 && currentTime < 16 * 60 // 13:00 - 16:00
      const isTrading = isMorningSession || isAfternoonSession
      
      // 港股只有常规交易价格
      if (stock.last_done) {
        let timestamp = stock.timestamp || 0
        if (timestamp > 1e12) {
          timestamp = timestamp / 1000
        }
        priceOptions.push({
          price: stock.last_done,
          prevClose: stock.prev_close,
          label: isTrading ? '交易中' : '休市',
          badgeClass: isTrading ? '' : 'bg-gray-100 text-gray-800',
          priceClass: isTrading ? '' : 'text-gray-600',
          timestamp: timestamp,
          priority: 3
        })
      }
      
      // 港股没有盘前盘后，但如果有数据也显示（可能数据源问题）
      if (stock.pre_market_quote?.last_done) {
        let timestamp = stock.pre_market_quote.timestamp || 0
        if (timestamp > 1e12) {
          timestamp = timestamp / 1000
        }
        priceOptions.push({
          price: stock.pre_market_quote.last_done,
          prevClose: stock.pre_market_quote.prev_close,
          label: '盘前',
          badgeClass: 'bg-orange-100 text-orange-800',
          priceClass: 'text-orange-600',
          timestamp: timestamp,
          priority: 1
        })
      }
      
      if (stock.post_market_quote?.last_done) {
        let timestamp = stock.post_market_quote.timestamp || 0
        if (timestamp > 1e12) {
          timestamp = timestamp / 1000
        }
        priceOptions.push({
          price: stock.post_market_quote.last_done,
          prevClose: stock.post_market_quote.prev_close,
          label: '盘后',
          badgeClass: 'bg-blue-100 text-blue-800',
          priceClass: 'text-blue-600',
          timestamp: timestamp,
          priority: 1
        })
      }
      
    } else {
      // 其他市场（如A股），只显示常规价格
      if (stock.last_done) {
        let timestamp = stock.timestamp || 0
        if (timestamp > 1e12) {
          timestamp = timestamp / 1000
        }
        priceOptions.push({
          price: stock.last_done,
          prevClose: stock.prev_close,
          label: '盘中',
          badgeClass: '',
          priceClass: '',
          timestamp: timestamp,
          priority: 3
        })
      }
    }
    
    // 如果没有可用的价格，返回默认值
    if (priceOptions.length === 0) {
      return {
        price: stock.last_done || '0',
        prevClose: stock.prev_close || '0',
        label: '盘中',
        badgeClass: '',
        priceClass: ''
      }
    }
    
    // 根据当前时段和优先级选择价格
    // 优先选择当前时段的价格，如果时间戳相同，按优先级选择
    const latestPrice = priceOptions.reduce((latest, current) => {
      // 如果时间戳都为0，按优先级选择
      if (latest.timestamp === 0 && current.timestamp === 0) {
        return current.priority > latest.priority ? current : latest
      }
      // 如果当前时间戳为0，保持latest（如果latest优先级足够高）
      if (current.timestamp === 0) {
        return latest.priority >= 3 ? latest : current
      }
      // 如果latest时间戳为0，使用current
      if (latest.timestamp === 0) {
        return current
      }
      // 时间戳都很新（5分钟内），按优先级选择
      const nowSeconds = Date.now() / 1000
      const timeDiff = Math.abs(nowSeconds - current.timestamp)
      const latestTimeDiff = Math.abs(nowSeconds - latest.timestamp)
      
      if (timeDiff < 300 && latestTimeDiff < 300) {
        // 都是5分钟内的数据，按优先级选择
        return current.priority > latest.priority ? current : latest
      }
      // 否则比较时间戳（选择最新的）
      return current.timestamp > latest.timestamp ? current : latest
    }, priceOptions[0])
    
    // 返回最新价格的信息（不包含timestamp和priority）
    return {
      price: latestPrice.price,
      prevClose: latestPrice.prevClose,
      label: latestPrice.label,
      badgeClass: latestPrice.badgeClass,
      priceClass: latestPrice.priceClass
    }
  }

  return (
    <AppLayout>
      {/* 账户资产信息 */}
      {accountBalance && (
            <Card
              style={{
                background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)',
                border: 'none',
                marginBottom: 24
              }}
              bodyStyle={{ color: '#fff', padding: 24 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, color: '#fff', margin: 0 }}>账户资产</h2>
                <Button
                  type="text"
                  onClick={() => setAccountDetailsExpanded(!accountDetailsExpanded)}
                  style={{ padding: 0, color: '#fff' }}
                >
                  {accountDetailsExpanded ? '收起详情 ▲' : '展开详情 ▼'}
                </Button>
              </div>
              
              {/* 总体资产信息 */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div>
                  <div className="text-sm opacity-90 mb-1">总资产 ({accountBalance.currency})</div>
                  <div className="text-2xl font-bold">
                    {accountBalance.currency === 'USD' ? '$' : accountBalance.currency === 'HKD' ? 'HK$' : ''}
                    {parseFloat(accountBalance.totalCash).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div className="text-sm opacity-90 mb-1">净资产 ({accountBalance.currency})</div>
                  <div className="text-2xl font-bold">
                    {accountBalance.currency === 'USD' ? '$' : accountBalance.currency === 'HKD' ? 'HK$' : ''}
                    {parseFloat(accountBalance.netAssets).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div className="text-sm opacity-90 mb-1">购买力 ({accountBalance.currency})</div>
                  <div className="text-2xl font-bold">
                    {accountBalance.currency === 'USD' ? '$' : accountBalance.currency === 'HKD' ? 'HK$' : ''}
                    {parseFloat(accountBalance.buyPower).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div className="text-sm opacity-90 mb-1">持仓市值</div>
                  <div className="text-2xl font-bold">
                    ${positions.reduce((sum, p) => sum + parseFloat(p.market_value || '0'), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
              
              {/* 详细信息（可折叠） */}
              {accountDetailsExpanded && (
                <div className="border-t border-white/20 pt-4 space-y-4">
                  {/* 融资融券信息 */}
                  {(accountBalance.maxFinanceAmount || accountBalance.remainingFinanceAmount) && (
                    <div className="bg-white/10 rounded-lg p-4">
                      <h3 className="text-md font-semibold mb-3">融资融券</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {accountBalance.maxFinanceAmount && (
                          <div>
                            <div className="text-sm opacity-90 mb-1">最大融资金额</div>
                            <div className="text-lg font-semibold">
                              {accountBalance.currency === 'USD' ? '$' : accountBalance.currency === 'HKD' ? 'HK$' : ''}
                              {parseFloat(accountBalance.maxFinanceAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          </div>
                        )}
                        {accountBalance.remainingFinanceAmount !== undefined && (
                          <div>
                            <div className="text-sm opacity-90 mb-1">剩余融资金额</div>
                            <div className="text-lg font-semibold">
                              {accountBalance.currency === 'USD' ? '$' : accountBalance.currency === 'HKD' ? 'HK$' : ''}
                              {parseFloat(accountBalance.remainingFinanceAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* 风控信息 */}
                  {(accountBalance.riskLevel || accountBalance.marginCall || accountBalance.initMargin || accountBalance.maintenanceMargin) && (
                    <div className="bg-white/10 rounded-lg p-4">
                      <h3 className="text-md font-semibold mb-3">风控信息</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {accountBalance.riskLevel !== undefined && (
                          <div>
                            <div className="text-sm opacity-90 mb-1">风控等级</div>
                            <div className={`text-lg font-semibold ${
                              accountBalance.riskLevel === '0' ? 'text-green-300' :
                              accountBalance.riskLevel === '1' ? 'text-yellow-300' :
                              accountBalance.riskLevel === '2' ? 'text-orange-300' :
                              accountBalance.riskLevel === '3' ? 'text-red-300' : ''
                            }`}>
                              {accountBalance.riskLevel === '0' ? '安全' :
                               accountBalance.riskLevel === '1' ? '中风险' :
                               accountBalance.riskLevel === '2' ? '预警' :
                               accountBalance.riskLevel === '3' ? '危险' : accountBalance.riskLevel}
                            </div>
                          </div>
                        )}
                        {accountBalance.marginCall && parseFloat(accountBalance.marginCall) > 0 && (
                          <div>
                            <div className="text-sm opacity-90 mb-1">追缴保证金</div>
                            <div className="text-lg font-semibold text-red-300">
                              {accountBalance.currency === 'USD' ? '$' : accountBalance.currency === 'HKD' ? 'HK$' : ''}
                              {parseFloat(accountBalance.marginCall).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          </div>
                        )}
                        {accountBalance.initMargin && (
                          <div>
                            <div className="text-sm opacity-90 mb-1">初始保证金</div>
                            <div className="text-lg font-semibold">
                              {accountBalance.currency === 'USD' ? '$' : accountBalance.currency === 'HKD' ? 'HK$' : ''}
                              {parseFloat(accountBalance.initMargin).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          </div>
                        )}
                        {accountBalance.maintenanceMargin && (
                          <div>
                            <div className="text-sm opacity-90 mb-1">维持保证金</div>
                            <div className="text-lg font-semibold">
                              {accountBalance.currency === 'USD' ? '$' : accountBalance.currency === 'HKD' ? 'HK$' : ''}
                              {parseFloat(accountBalance.maintenanceMargin).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* 各币种现金信息 */}
                  {accountBalance.cashInfos && accountBalance.cashInfos.length > 0 && (
                    <div>
                      <h3 className="text-md font-semibold mb-3">各币种现金详情</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {accountBalance.cashInfos.map((cashInfo: any, index: number) => (
                          <div key={index} className="bg-white/10 rounded-lg p-4">
                            <div className="text-sm font-semibold mb-3">{cashInfo.currency} 账户</div>
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <span className="text-sm opacity-90">可用资金:</span>
                                <span className="font-semibold">
                                  {cashInfo.currency === 'USD' ? '$' : cashInfo.currency === 'HKD' ? 'HK$' : ''}
                                  {parseFloat(cashInfo.availableCash).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-sm opacity-90">冻结资金:</span>
                                <span className="font-semibold">
                                  {cashInfo.currency === 'USD' ? '$' : cashInfo.currency === 'HKD' ? 'HK$' : ''}
                                  {parseFloat(cashInfo.frozenCash).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                              {parseFloat(cashInfo.settlingCash || '0') !== 0 && (
                                <div className="flex justify-between">
                                  <span className="text-sm opacity-90">待结算现金:</span>
                                  <span className="font-semibold">
                                    {cashInfo.currency === 'USD' ? '$' : cashInfo.currency === 'HKD' ? 'HK$' : ''}
                                    {parseFloat(cashInfo.settlingCash).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span className="text-sm opacity-90">可提现:</span>
                                <span className="font-semibold">
                                  {cashInfo.currency === 'USD' ? '$' : cashInfo.currency === 'HKD' ? 'HK$' : ''}
                                  {parseFloat(cashInfo.withdrawCash).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* 冻结费用 */}
                  {accountBalance.frozenTransactionFees && accountBalance.frozenTransactionFees.length > 0 && (
                    <div className="bg-white/10 rounded-lg p-4">
                      <h3 className="text-md font-semibold mb-3">冻结费用</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {accountBalance.frozenTransactionFees.map((fee: any, index: number) => (
                          <div key={index} className="flex justify-between items-center">
                            <span className="text-sm opacity-90">{fee.currency} 冻结费用:</span>
                            <span className="font-semibold">
                              {fee.currency === 'USD' ? '$' : fee.currency === 'HKD' ? 'HK$' : ''}
                              {parseFloat(fee.frozenTransactionFee).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* 市场信息 */}
                  {accountBalance.market && (
                    <div className="bg-white/10 rounded-lg p-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm opacity-90">市场:</span>
                        <span className="font-semibold">{accountBalance.market}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
      )}

      {/* 页面标题和添加关注 */}
      <Card className="mb-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">持仓与关注股票</h1>
          <Space.Compact style={{ width: '100%', maxWidth: 600 }}>
            <AutoComplete
              value={newSymbol}
              onChange={(value) => handleSymbolInputChange(value)}
              onSelect={handleSelectSuggestion}
              options={autocompleteSuggestions.map(item => ({
                value: item.symbol,
                label: (
                  <div>
                    <div style={{ fontWeight: 500 }}>{item.symbol}</div>
                    <div style={{ fontSize: 12, color: '#666' }}>
                      {item.name_cn && item.name_en 
                        ? `${item.name_cn} • ${item.name_en}` 
                        : item.name_cn || item.name_en || ''}
                    </div>
                  </div>
                ),
              }))}
              placeholder="添加关注股票，例如：AAPL.US 或输入 goo 搜索"
              style={{ flex: 1 }}
              open={showAutocomplete && autocompleteSuggestions.length > 0}
              onFocus={() => {
                if (autocompleteSuggestions.length > 0) {
                  setShowAutocomplete(true)
                }
              }}
              onBlur={() => {
                setTimeout(() => setShowAutocomplete(false), 200)
              }}
              notFoundContent={searchingAutocomplete ? <Spin size="small" /> : null}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleAddWatchlist()
                }
              }}
            />
            <Button
              type="primary"
              onClick={handleAddWatchlist}
              loading={loading}
              style={{ whiteSpace: 'nowrap' }}
            >
              {loading ? '添加中...' : '添加关注'}
            </Button>
          </Space.Compact>
        </div>

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
        {success && (
          <Alert
            message={success}
            type="success"
            showIcon
            closable
            onClose={() => setSuccess(null)}
            style={{ marginBottom: 16 }}
          />
        )}
      </Card>

      {/* 持仓和行情列表 */}
      <Card>
        <Table
          dataSource={stocks}
          loading={loading && stocks.length === 0}
          rowKey="symbol"
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText: stocks.length === 0 && !loading ? '暂无持仓或关注股票，请添加关注股票开始使用' : undefined
          }}
          columns={[
                {
                  title: '标的代码',
                  key: 'symbol',
                  width: 200,
                  fixed: 'left',
                  render: (_, stock: StockRow) => {
                    if (stock._error) {
                      return (
                        <Space wrap>
                          <span>{stock.symbol}</span>
                          {stock.isWatched && <Tag color="orange">关注</Tag>}
                          {stock.isHeld && <Tag color="blue">持仓</Tag>}
                        </Space>
                      )
                    }
                    const currentPriceInfo = getCurrentPrice(stock)
                    return (
                      <Space wrap>
                        <span>{stock.symbol}</span>
                        {stock.isWatched && <Tag color="orange">关注</Tag>}
                        {stock.isHeld && <Tag color="blue">持仓</Tag>}
                        {currentPriceInfo.label !== '盘中' && (
                          <Tag>{currentPriceInfo.label}</Tag>
                        )}
                      </Space>
                    )
                  }
                },
                {
                  title: '持仓数量',
                  key: 'quantity',
                  width: 120,
                  render: (_, stock: StockRow) => {
                    if (stock._error) return null
                    if (!stock.position) return '-'
                    return (
                      <div>
                        <div>{stock.position.quantity}</div>
                        {isOptionSymbol(stock.symbol) && stock.position.contract_multiplier && (
                          <div style={{ fontSize: 12, color: '#999' }}>
                            ({stock.position.quantity > 0 ? '多' : '空'}{Math.abs(stock.position.quantity)}张)
                          </div>
                        )}
                      </div>
                    )
                  }
                },
                {
                  title: '价格',
                  key: 'price',
                  width: 150,
                  render: (_, stock: StockRow) => {
                    if (stock._error) return null
                    const currentPriceInfo = getCurrentPrice(stock)
                    const { change } = calculateChange(currentPriceInfo.price, currentPriceInfo.prevClose)
                    const isPositive = change >= 0
                    const priceColor = currentPriceInfo.priceClass || (isPositive ? '#ff4d4f' : '#52c41a')
                    
                    if (stock.position) {
                      return (
                        <div>
                          <div style={{ fontWeight: 600, color: priceColor }}>
                            {currentPriceInfo.price}
                            {currentPriceInfo.label !== '盘中' && (
                              <span style={{ fontSize: 12, marginLeft: 4 }}>({currentPriceInfo.label})</span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                            成本: {parseFloat(stock.position.cost_price).toFixed(2)}
                          </div>
                        </div>
                      )
                    }
                    return (
                      <div style={{ fontWeight: 600, color: priceColor }}>
                        {currentPriceInfo.price}
                        {currentPriceInfo.label !== '盘中' && (
                          <span style={{ fontSize: 12, marginLeft: 4 }}>({currentPriceInfo.label})</span>
                        )}
                      </div>
                    )
                  }
                },
                {
                  title: '涨跌',
                  key: 'change',
                  width: 100,
                  render: (_, stock: StockRow) => {
                    if (stock._error) return null
                    const currentPriceInfo = getCurrentPrice(stock)
                    const { change } = calculateChange(currentPriceInfo.price, currentPriceInfo.prevClose)
                    const isPositive = change >= 0
                    return (
                      <span style={{ color: isPositive ? '#ff4d4f' : '#52c41a' }}>
                        {isPositive ? '+' : ''}{change.toFixed(2)}
                      </span>
                    )
                  }
                },
                {
                  title: '涨跌幅',
                  key: 'changePercent',
                  width: 100,
                  render: (_, stock: StockRow) => {
                    if (stock._error) return null
                    const currentPriceInfo = getCurrentPrice(stock)
                    const { changePercent } = calculateChange(currentPriceInfo.price, currentPriceInfo.prevClose)
                    const isPositive = parseFloat(changePercent) >= 0
                    return (
                      <span style={{ color: isPositive ? '#ff4d4f' : '#52c41a' }}>
                        {isPositive ? '+' : ''}{changePercent}%
                      </span>
                    )
                  }
                },
                {
                  title: '盈亏',
                  key: 'unrealizedPl',
                  width: 120,
                  render: (_, stock: StockRow) => {
                    if (stock._error) return null
                    if (!stock.position) return '-'
                    const unrealizedPl = parseFloat(stock.position.unrealized_pl)
                    return (
                      <div>
                        <div style={{ fontWeight: 600, color: unrealizedPl >= 0 ? '#ff4d4f' : '#52c41a' }}>
                          {unrealizedPl >= 0 ? '+' : ''}{unrealizedPl.toFixed(2)}
                        </div>
                        {stock.position.unrealized_pl_ratio && (
                          <div style={{ fontSize: 12, color: unrealizedPl >= 0 ? '#ff4d4f' : '#52c41a' }}>
                            {unrealizedPl >= 0 ? '+' : ''}{parseFloat(stock.position.unrealized_pl_ratio).toFixed(2)}%
                          </div>
                        )}
                      </div>
                    )
                  }
                },
                {
                  title: '市值/数量',
                  key: 'marketValue',
                  width: 120,
                  render: (_, stock: StockRow) => {
                    if (stock._error) return null
                    if (!stock.position) return '-'
                    return (
                      <div>
                        <div>{parseFloat(stock.position.market_value).toFixed(2)}</div>
                        {isOptionSymbol(stock.symbol) && stock.position.contract_multiplier && (
                          <div style={{ fontSize: 12, color: '#999' }}>市值</div>
                        )}
                      </div>
                    )
                  }
                },
                {
                  title: '交易推荐',
                  key: 'recommendation',
                  width: 320,
                  render: (_, stock: StockRow) => {
                    if (stock._error) return null
                    if (!stock.tradingRecommendation) {
                      if (stock.symbol.endsWith('.US') && !isOptionSymbol(stock.symbol)) {
                        return <Skeleton active paragraph={{ rows: 3 }} />
                      }
                      return <span style={{ color: '#999' }}>-</span>
                    }
                    
                    const rec = stock.tradingRecommendation
                    const envStyle = getMarketEnvironmentStyle(rec.market_environment)
                    const trendStyle = getTrendConsistencyStyle(rec.trend_consistency)
                    const strengthStyle = getMarketStrengthStyle(rec.comprehensive_market_strength)
                    const isExpanded = expandedRecommendations.has(stock.symbol)
                    const isRefreshing = refreshingRecommendations.has(stock.symbol)
                    
                    const getBgColor = () => {
                      if (rec.action === 'BUY') return '#f6ffed'
                      if (rec.action === 'SELL') return '#fff1f0'
                      return '#fafafa'
                    }
                    
                    const getBorderColor = () => {
                      if (rec.action === 'BUY') return '#52c41a'
                      if (rec.action === 'SELL') return '#ff4d4f'
                      return '#d9d9d9'
                    }
                    
                    return (
                      <Card
                        size="small"
                        style={{
                          minWidth: 280,
                          opacity: isRefreshing ? 0.75 : 1,
                          borderColor: getBorderColor(),
                          backgroundColor: getBgColor()
                        }}
                      >
                        {isRefreshing && (
                          <Spin size="small" style={{ position: 'absolute', top: 8, right: 8 }} />
                        )}
                        <div style={{ fontWeight: 600, marginBottom: 8, color: rec.action === 'BUY' ? '#52c41a' : rec.action === 'SELL' ? '#ff4d4f' : '#666' }}>
                          {rec.action === 'BUY' ? '买入' : rec.action === 'SELL' ? '卖出（做空）' : '持有'}
                        </div>
                        {rec.action === 'SELL' && (
                          <div style={{ fontSize: 12, color: '#ff4d4f', fontStyle: 'italic', marginBottom: 8 }}>
                            做空：在较高价卖出，价格下跌后买回获利
                          </div>
                        )}
                        <div style={{ marginBottom: 8, padding: 4, borderRadius: 4, backgroundColor: getBgColor() }}>
                          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>
                              {envStyle.icon} 市场环境: {rec.market_environment}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>
                              {rec.comprehensive_market_strength > 0 ? '+' : ''}{rec.comprehensive_market_strength.toFixed(1)}
                            </span>
                          </Space>
                        </div>
                        <div style={{ marginBottom: 8, padding: 4, borderRadius: 4, fontSize: 12 }}>
                          趋势: {rec.trend_consistency}
                        </div>
                        <div style={{ fontSize: 12 }}>
                          <div style={{ marginBottom: 4 }}>
                            <span style={{ color: '#666' }}>入场: </span>
                            <span style={{ fontWeight: 600 }}>${rec.entry_price_range.min.toFixed(2)} - ${rec.entry_price_range.max.toFixed(2)}</span>
                          </div>
                          <div style={{ marginBottom: 4 }}>
                            <span style={{ color: '#ff4d4f' }}>{rec.action === 'SELL' ? '止损↑: ' : '止损: '}</span>
                            <span style={{ fontWeight: 600 }}>${rec.stop_loss.toFixed(2)}</span>
                            {rec.action === 'SELL' && <span style={{ fontSize: 10, color: '#ff4d4f', marginLeft: 4 }}>(价格上涨会亏损)</span>}
                          </div>
                          <div style={{ marginBottom: 4 }}>
                            <span style={{ color: '#52c41a' }}>{rec.action === 'SELL' ? '止盈↓: ' : '止盈: '}</span>
                            <span style={{ fontWeight: 600 }}>${rec.take_profit.toFixed(2)}</span>
                            {rec.action === 'SELL' && <span style={{ fontSize: 10, color: '#52c41a', marginLeft: 4 }}>(价格下跌会盈利)</span>}
                          </div>
                          <div style={{ paddingTop: 4, borderTop: '1px solid #e5e7eb' }}>
                            <span style={{ color: '#666' }}>R/R: </span>
                            <span style={{ fontWeight: 600, color: rec.risk_reward_ratio >= 1.5 ? '#52c41a' : '#faad14' }}>
                              {rec.risk_reward_ratio.toFixed(2)}
                            </span>
                          </div>
                          {rec.risk_note && rec.risk_note !== '无特别风险提示' && (
                            <div style={{ paddingTop: 4, borderTop: '1px solid #e5e7eb', fontSize: 12, color: '#faad14' }}>
                              ⚠ {rec.risk_note}
                            </div>
                          )}
                          <Button
                            type="link"
                            size="small"
                            onClick={() => toggleRecommendationDetails(stock.symbol)}
                            style={{ width: '100%', paddingTop: 4, marginTop: 4, fontSize: 12, borderTop: '1px solid #e5e7eb' }}
                          >
                            {isExpanded ? '收起详情 ▲' : '展开详情 ▼'}
                          </Button>
                          {isExpanded && (
                            <div style={{ paddingTop: 8, marginTop: 8, borderTop: '1px solid #d9d9d9' }}>
                              <Card size="small" style={{ backgroundColor: '#fafafa' }}>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>分析摘要:</div>
                                <div style={{ fontSize: 12, lineHeight: 1.6 }}>{rec.analysis_summary}</div>
                              </Card>
                            </div>
                          )}
                        </div>
                      </Card>
                    )
                  }
                },
                {
                  title: '操作',
                  key: 'actions',
                  width: 200,
                  fixed: 'right',
                  render: (_, stock: StockRow) => {
                    if (stock._error) {
                      return (
                        <div>
                          <div style={{ color: '#ff4d4f', fontSize: 12, marginBottom: 8 }}>
                            无法获取行情数据（可能是代码错误或没有权限）
                          </div>
                          {stock.isWatched && (
                            <Button
                              type="primary"
                              danger
                              size="small"
                              onClick={() => handleRemoveWatchlist(stock.symbol)}
                            >
                              删除关注
                            </Button>
                          )}
                        </div>
                      )
                    }
                    
                    const currentPriceInfo = getCurrentPrice(stock)
                    return (
                      <Space wrap>
                        {stock.isWatched && (
                          <Button
                            type="link"
                            danger
                            onClick={() => handleRemoveWatchlist(stock.symbol)}
                            title="取消关注"
                            style={{ padding: 0 }}
                          >
                            取消关注
                          </Button>
                        )}
                        <Button
                          type="primary"
                          onClick={() => {
                            setTradeSymbol(stock.symbol)
                            setTradePrice(currentPriceInfo.price)
                          }}
                          title="交易"
                        >
                          {stock.isHeld ? '卖出' : '买入'}
                        </Button>
                        <Button
                          type="link"
                          onClick={() => setSelectedSymbol(stock.symbol)}
                          title="设置交易规则"
                          style={{ padding: 0 }}
                        >
                          设置规则
                        </Button>
                        <Link href={`/candles?symbol=${stock.symbol}`} style={{ color: '#52c41a' }}>
                          查看K线
                        </Link>
                        {stock.symbol.endsWith('.US') && !isOptionSymbol(stock.symbol) && (
                          <Link href={`/options/chain?symbol=${stock.symbol}`} style={{ color: '#722ed1' }}>
                            期权
                          </Link>
                        )}
                      </Space>
                    )
                  }
                }
          ]}
        />
      </Card>

      {/* 交易规则设置模态框 */}
      {selectedSymbol && (
        <TradingRuleModal
          symbol={selectedSymbol}
          onClose={() => setSelectedSymbol(null)}
          onSuccess={() => {
            setSelectedSymbol(null)
            setSuccess('交易规则设置成功')
          }}
        />
      )}

      {/* 交易下单模态框 */}
      {tradeSymbol && (
        <TradeModal
          symbol={tradeSymbol}
          currentPrice={tradePrice || undefined}
          onClose={() => {
            setTradeSymbol(null)
            setTradePrice(null)
          }}
          onSuccess={() => {
            setTradeSymbol(null)
            setTradePrice(null)
            setSuccess('订单提交成功')
            // 延迟同步订单状态和持仓，然后刷新数据
            setTimeout(async () => {
              try {
                // 同步订单状态和持仓
                await ordersApi.syncStatus()
                // 刷新持仓和账户余额
                fetchPositions()
                fetchAccountBalance(true)
              } catch (err) {
                console.error('同步订单状态失败:', err)
                // 即使同步失败，也刷新持仓
                fetchPositions()
                fetchAccountBalance(true)
              }
            }, 2000)
          }}
        />
      )}
      </AppLayout>
  )
}

// 交易规则设置模态框组件
function TradingRuleModal({ symbol, onClose, onSuccess }: { symbol: string; onClose: () => void; onSuccess: () => void }) {
  const [ruleType, setRuleType] = useState<string>('price_alert')
  const [ruleName, setRuleName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [config, setConfig] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!ruleName.trim()) {
      setError('请输入规则名称')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await tradingRulesApi.createRule({
        symbol,
        rule_name: ruleName,
        rule_type: ruleType as any,
        enabled,
        config,
      })
      onSuccess()
    } catch (err: any) {
      setError(err.message || '设置失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title={`设置交易规则 - ${symbol}`}
      open={true}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="submit"
          type="primary"
          onClick={handleSubmit}
          loading={loading}
        >
          确认设置
        </Button>,
      ]}
      width={500}
    >
      {error && (
        <Alert
          message={error}
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            规则名称
          </label>
          <Input
            value={ruleName}
            onChange={(e) => setRuleName(e.target.value)}
            placeholder="例如：价格突破提醒"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            规则类型
          </label>
          <Select
            value={ruleType}
            onChange={(value) => setRuleType(value)}
            style={{ width: '100%' }}
            options={[
              { value: 'price_alert', label: '价格提醒' },
              { value: 'auto_trade', label: '自动交易' },
              { value: 'stop_loss', label: '止损' },
              { value: 'take_profit', label: '止盈' },
              { value: 'trailing_stop', label: '跟踪止损' },
              { value: 'dca', label: '定投' },
            ]}
          />
        </div>

        <div>
          <label className="flex items-center">
            <Switch
              checked={enabled}
              onChange={setEnabled}
            />
            <span className="ml-2 text-sm text-gray-700">启用规则</span>
          </label>
        </div>
      </Space>
    </Modal>
  )
}
