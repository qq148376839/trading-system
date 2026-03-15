'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, Tabs, Table, Tag, Statistic, Row, Col, DatePicker, Select, Spin, Alert, Empty, Descriptions } from 'antd'
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ScatterChart, Scatter, LineChart, Line, ReferenceLine, Legend } from 'recharts'
import dayjs, { Dayjs } from 'dayjs'
import AppLayout from '@/components/AppLayout'
import { ordersApi, quantApi } from '@/lib/api'
import { useIsMobile } from '@/hooks/useIsMobile'

const { RangePicker } = DatePicker

// Standard project colors for profit/loss
const PROFIT_COLOR = '#52c41a'
const LOSS_COLOR = '#ff4d4f'
const NEUTRAL_COLOR = '#faad14'

interface AnalysisRow {
  order_id: string
  original_symbol: string
  reverse_symbol: string
  underlying: string
  trade_date: string
  strategy: string
  direction: string
  original_entry_price: number
  original_exit_price: number
  original_qty: number
  original_pnl: number
  original_pnl_pct: number
  reverse_price_at_entry: number
  reverse_price_at_exit: number
  reverse_pnl: number
  reverse_pnl_pct: number
  reverse_high: number
  reverse_low: number
  entry_time: string
  exit_time: string
  signal_score: number
  exit_type: string
  original_candle_count: number
  reverse_candle_count: number
  collection_status: string
}

interface OrderRow {
  order_id: string
  symbol: string
  side: string
  quantity: number
  executed_price: number
  status: string
  created_at: string
  updated_at: string
}

interface SignalRow {
  id: number
  symbol: string
  signal_type: string
  price: number
  reason: string
  metadata: Record<string, unknown>
  status: string
  created_at: string
  strategy_id: number
}

interface StrategyInfo {
  id: number
  name: string
}

/** 配对后的完整交易记录（BUY + SELL 合并） */
interface TradeRecord {
  id: number           // SELL signal id
  symbol: string
  strategy_id: number
  trade_date: string   // SELL created_at 日期
  created_at: string   // SELL created_at
  pnl: number
  pnlPct: number | null
  exitType: string
  score: number | null
  direction: string
  regime: Record<string, unknown> | null  // regimeDetection from BUY
  strategyName: string // from BUY metadata.selectedStrategy
}

export default function AnalysisPage() {
  const isMobile = useIsMobile()

  // 日期范围（默认最近 7 天）
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(7, 'day'),
    dayjs(),
  ])
  const [activeTab, setActiveTab] = useState('overview')

  // 策略筛选
  const [strategies, setStrategies] = useState<StrategyInfo[]>([])
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null)

  // 数据
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [signals, setSignals] = useState<SignalRow[]>([])
  const [analysis, setAnalysis] = useState<AnalysisRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // K线 tab 状态
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [klineData, setKlineData] = useState<{ original: Record<string, unknown>[]; reverse: Record<string, unknown>[] }>({ original: [], reverse: [] })
  const [klineLoading, setKlineLoading] = useState(false)

  // 加载策略列表
  useEffect(() => {
    (async () => {
      try {
        const res = await quantApi.getStrategies()
        const list = ((res as Record<string, unknown>)?.data || []) as Record<string, unknown>[]
        setStrategies(list.map((s) => ({ id: Number(s.id), name: String(s.name) })))
      } catch { /* ignore */ }
    })()
  }, [])

  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const startDate = dateRange[0].format('YYYY-MM-DD')
      const endDate = dateRange[1].format('YYYY-MM-DD')
      const startTs = Math.floor(dateRange[0].startOf('day').valueOf() / 1000)
      const endTs = Math.floor(dateRange[1].endOf('day').valueOf() / 1000)

      const [ordersRes, signalsRes, analysisRes] = await Promise.all([
        ordersApi.getHistoryOrders({
          market: 'US',
          status: ['FilledStatus'],
          start_at: startTs,
          end_at: endTs,
        }),
        quantApi.getSignals({ startDate, endDate, limit: 500 }),
        quantApi.getOptionKlineAnalysis({ startDate, endDate }),
      ])

      // 过滤期权订单
      const allOrders = ((ordersRes as Record<string, unknown>)?.data as Record<string, unknown>)?.orders || (ordersRes as Record<string, unknown>)?.data || []
      const optionOrders = (allOrders as OrderRow[]).filter((o) => {
        const sym = String(o.symbol || '')
        return /^[A-Z]+\d{6}[CP]\d+\.US$/i.test(sym)
      })
      setOrders(optionOrders)

      const allSignals = ((signalsRes as Record<string, unknown>)?.data as Record<string, unknown>)?.signals || (signalsRes as Record<string, unknown>)?.data || []
      setSignals(allSignals as SignalRow[])

      const allAnalysis = (analysisRes as Record<string, unknown>)?.data || []
      setAnalysis(allAnalysis as AnalysisRow[])
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '加载数据失败'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [dateRange])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 加载K线数据
  const loadKline = useCallback(async (orderId: string) => {
    setKlineLoading(true)
    try {
      const [origRes, revRes] = await Promise.all([
        quantApi.getOptionKlineCandles(orderId, 'ORIGINAL'),
        quantApi.getOptionKlineCandles(orderId, 'REVERSE'),
      ])
      setKlineData({
        original: ((origRes as Record<string, unknown>)?.data || []) as Record<string, unknown>[],
        reverse: ((revRes as Record<string, unknown>)?.data || []) as Record<string, unknown>[],
      })
    } catch {
      setKlineData({ original: [], reverse: [] })
    } finally {
      setKlineLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedOrderId) {
      loadKline(selectedOrderId)
    }
  }, [selectedOrderId, loadKline])

  const strategyNameById = (id: number) => strategies.find(s => s.id === id)?.name || `策略 ${id}`

  // -- BUY/SELL 信号配对 → 统一 TradeRecord --
  // BUY 信号有: finalScore, optionDirection, selectedStrategy, regimeDetection
  // SELL 信号有: netPnL, netPnLPercent, exitAction
  // 按 symbol + strategy_id 配对，SELL 匹配最近的前序 BUY
  const trades = useMemo(() => {
    const buySignals = signals.filter(s => s.signal_type === 'BUY')
    const sellSignals = signals.filter(s => s.signal_type === 'SELL' && (s.metadata as Record<string, unknown>)?.netPnL !== undefined && (s.metadata as Record<string, unknown>)?.netPnL !== null)

    // 按 symbol+strategy_id 建立 BUY 索引（按时间排序）
    const buyIndex = new Map<string, SignalRow[]>()
    for (const b of buySignals) {
      const key = `${b.symbol}::${b.strategy_id || 0}`
      const arr = buyIndex.get(key) || []
      arr.push(b)
      buyIndex.set(key, arr)
    }
    // 每组按时间排序
    for (const arr of buyIndex.values()) {
      arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }

    const usedBuys = new Set<number>()
    const records: TradeRecord[] = []

    for (const sell of sellSignals) {
      const key = `${sell.symbol}::${sell.strategy_id || 0}`
      const buys = buyIndex.get(key)
      const sellTime = new Date(sell.created_at).getTime()

      // 找最近的未使用 BUY（在 SELL 之前）
      let matchedBuy: SignalRow | null = null
      if (buys) {
        for (let i = buys.length - 1; i >= 0; i--) {
          const b = buys[i]
          if (!usedBuys.has(b.id) && new Date(b.created_at).getTime() <= sellTime) {
            matchedBuy = b
            usedBuys.add(b.id)
            break
          }
        }
      }

      const meta = sell.metadata as Record<string, unknown>
      const buyMeta = matchedBuy?.metadata as Record<string, unknown> | undefined
      const pnl = Number(meta.netPnL)
      const pnlPctVal = meta.netPnLPercent
      const pnlPct = pnlPctVal !== undefined && pnlPctVal !== null ? Number(pnlPctVal) : null

      records.push({
        id: sell.id,
        symbol: sell.symbol,
        strategy_id: sell.strategy_id || 0,
        trade_date: (sell.created_at || '').split('T')[0],
        created_at: sell.created_at,
        pnl,
        pnlPct,
        exitType: String(meta.exitAction ?? ''),
        score: buyMeta?.finalScore !== undefined ? Number(buyMeta.finalScore) : null,
        direction: String(buyMeta?.optionDirection ?? buyMeta?.selectedStrategy ?? ''),
        regime: (buyMeta?.regimeDetection as Record<string, unknown>) ?? null,
        strategyName: String(buyMeta?.selectedStrategy ?? ''),
      })
    }

    return records
  }, [signals])

  // -- 按策略筛选交易 --
  const filteredTrades = useMemo(() => {
    if (!selectedStrategyId) return trades
    return trades.filter(t => t.strategy_id === selectedStrategyId)
  }, [trades, selectedStrategyId])

  // -- 计算统计数据 --
  const stats = useMemo(() => {
    const totalPnl = Math.round(filteredTrades.reduce((sum, t) => sum + t.pnl, 0) * 100) / 100
    const wins = filteredTrades.filter(t => t.pnl > 0)
    const losses = filteredTrades.filter(t => t.pnl < 0)
    const winRate = filteredTrades.length > 0 ? (wins.length / filteredTrades.length) * 100 : 0
    const avgWin = Math.round((wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0) * 100) / 100
    const avgLoss = Math.round((losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0) * 100) / 100
    const tradingDays = new Set(filteredTrades.map(t => t.trade_date)).size

    return { totalPnl, tradeCount: filteredTrades.length, winRate, avgWin, avgLoss, tradingDays }
  }, [filteredTrades])

  // -- 每日盈亏数据 --
  const dailyPnlData = useMemo(() => {
    const byDay = new Map<string, number>()
    for (const t of filteredTrades) {
      if (!t.trade_date) continue
      byDay.set(t.trade_date, (byDay.get(t.trade_date) || 0) + t.pnl)
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, pnl]) => ({ date, pnl: Math.round(pnl * 100) / 100 }))
  }, [filteredTrades])

  // -- 得分 vs 盈亏散点数据 --
  const scoreVsPnlData = useMemo(() => {
    return filteredTrades
      .filter(t => t.score !== null)
      .map(t => ({
        score: Number(t.score),
        pnl: Math.round(t.pnl * 100) / 100,
        symbol: t.symbol,
      }))
  }, [filteredTrades])

  // -- 方向/策略类型分组统计 --
  const strategyStats = useMemo(() => {
    const groups = new Map<string, { trades: number; wins: number; totalPnl: number }>()
    for (const t of filteredTrades) {
      const dir = t.direction || 'UNKNOWN'
      let label = dir
      if (t.regime?.shouldReverse) label = `${dir} (反向)`
      else if (t.regime?.regime === 'UNCERTAIN') label = `${dir} (不确定)`
      const g = groups.get(label) || { trades: 0, wins: 0, totalPnl: 0 }
      g.trades++
      if (t.pnl > 0) g.wins++
      g.totalPnl += t.pnl
      groups.set(label, g)
    }
    return Array.from(groups.entries()).map(([type, g]) => ({
      type,
      ...g,
      winRate: g.trades > 0 ? (g.wins / g.trades) * 100 : 0,
    }))
  }, [filteredTrades])

  // -- 按策略 ID 分组统计（跨策略对比）--
  const perStrategyStats = useMemo(() => {
    const groups = new Map<number, { trades: number; wins: number; totalPnl: number; reversed: number }>()
    for (const t of trades) {
      const sid = t.strategy_id
      const g = groups.get(sid) || { trades: 0, wins: 0, totalPnl: 0, reversed: 0 }
      g.trades++
      if (t.pnl > 0) g.wins++
      g.totalPnl += t.pnl
      if (t.regime?.shouldReverse) g.reversed++
      groups.set(sid, g)
    }
    return Array.from(groups.entries()).map(([sid, g]) => ({
      strategyId: sid,
      strategyName: strategyNameById(sid),
      ...g,
      winRate: g.trades > 0 ? (g.wins / g.trades) * 100 : 0,
    }))
  }, [trades, strategies])

  // -- 退出方式统计 --
  const exitStats = useMemo(() => {
    const groups = new Map<string, { trades: number; wins: number; totalPnl: number }>()
    for (const t of filteredTrades) {
      const exitType = t.exitType || 'UNKNOWN'
      const g = groups.get(exitType) || { trades: 0, wins: 0, totalPnl: 0 }
      g.trades++
      if (t.pnl > 0) g.wins++
      g.totalPnl += t.pnl
      groups.set(exitType, g)
    }
    return Array.from(groups.entries()).map(([type, g]) => ({
      type,
      ...g,
      winRate: g.trades > 0 ? (g.wins / g.trades) * 100 : 0,
    }))
  }, [filteredTrades])

  // -- 得分区间胜率（绝对值区间，匹配 HTML 报告）--
  const scoreBuckets = useMemo(() => {
    const buckets = [
      { label: '|得分| < 10', min: 0, max: 10, trades: 0, wins: 0, totalPnl: 0 },
      { label: '10 ≤ |得分| < 12', min: 10, max: 12, trades: 0, wins: 0, totalPnl: 0 },
      { label: '12 ≤ |得分| < 15', min: 12, max: 15, trades: 0, wins: 0, totalPnl: 0 },
      { label: '|得分| ≥ 15', min: 15, max: Infinity, trades: 0, wins: 0, totalPnl: 0 },
    ]
    for (const t of filteredTrades) {
      if (t.score === null) continue
      const absScore = Math.abs(t.score)
      for (const b of buckets) {
        if (absScore >= b.min && absScore < b.max) {
          b.trades++
          if (t.pnl > 0) b.wins++
          b.totalPnl += t.pnl
          break
        }
      }
    }
    return buckets.map(b => ({
      ...b,
      winRate: b.trades > 0 ? (b.wins / b.trades) * 100 : 0,
      avgPnl: b.trades > 0 ? Math.round((b.totalPnl / b.trades) * 100) / 100 : 0,
      totalPnl: Math.round(b.totalPnl * 100) / 100,
    }))
  }, [filteredTrades])

  // -- 每日明细分组 --
  const dailyDetails = useMemo(() => {
    const byDay = new Map<string, TradeRecord[]>()
    for (const t of filteredTrades) {
      if (!t.trade_date) continue
      const arr = byDay.get(t.trade_date) || []
      arr.push(t)
      byDay.set(t.trade_date, arr)
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => b.localeCompare(a))
  }, [filteredTrades])

  // -- 反向分析对比（原始PnL从信号trades、反向PnL从analysis API）--
  const reverseComparison = useMemo(() => {
    if (filteredTrades.length === 0 && analysis.length === 0) return null

    // 原始策略统计：从 BUY/SELL 配对的 trades 获取
    const origTotal = filteredTrades.reduce((s, t) => s + t.pnl, 0)
    const origWins = filteredTrades.filter(t => t.pnl > 0).length

    // 反向策略统计：从 option_trade_analysis 获取
    const validRev = analysis.filter(a => a.reverse_pnl !== null)
    const revTotal = validRev.reduce((s, a) => s + Number(a.reverse_pnl || 0), 0)
    const revWins = validRev.filter(a => Number(a.reverse_pnl) > 0).length

    return {
      origTotal: Math.round(origTotal * 100) / 100,
      revTotal: Math.round(revTotal * 100) / 100,
      origWinRate: filteredTrades.length > 0 ? (origWins / filteredTrades.length) * 100 : 0,
      revWinRate: validRev.length > 0 ? (revWins / validRev.length) * 100 : 0,
      origCount: filteredTrades.length,
      revCount: validRev.length,
    }
  }, [filteredTrades, analysis])

  // -- K线选择器选项 --
  const klineOptions = useMemo(() => {
    return analysis
      .filter(a => a.original_candle_count > 0 || a.reverse_candle_count > 0)
      .map(a => ({
        value: a.order_id,
        label: `${a.original_symbol || a.underlying} (${(a.trade_date || '').split('T')[0]}) ${a.collection_status === 'SUCCESS' ? '' : `[${a.collection_status}]`}`.trim(),
      }))
  }, [analysis])

  // -- 获取选中交易的分析数据 --
  const selectedAnalysis = useMemo(() => {
    if (!selectedOrderId) return null
    return analysis.find(a => a.order_id === selectedOrderId) || null
  }, [selectedOrderId, analysis])

  // -- 标签颜色（使用标准 Ant Design Tag color 名称）--
  const directionTagColor = (dir: string): string => {
    if (dir?.includes('BULL') || dir?.includes('CALL')) return 'green'
    if (dir?.includes('BEAR') || dir?.includes('PUT')) return 'red'
    if (dir?.includes('REV')) return 'purple'
    return 'blue'
  }

  const exitTagColor = (exitType: string): string => {
    if (exitType?.includes('PROFIT') || exitType?.includes('TAKE')) return 'green'
    if (exitType?.includes('TRAIL')) return 'orange'
    if (exitType?.includes('STOP') || exitType?.includes('LOSS')) return 'red'
    return 'default'
  }

  const pnlColor = (v: number) => (v > 0 ? PROFIT_COLOR : v < 0 ? LOSS_COLOR : NEUTRAL_COLOR)

  // -- 格式化时间戳为 HH:mm --
  const formatTime = (ts: number): string => {
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  return (
    <AppLayout>
      <Card
        title="交易分析"
        extra={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Select
              placeholder="全部策略"
              allowClear
              style={{ minWidth: 140 }}
              value={selectedStrategyId}
              onChange={(v) => setSelectedStrategyId(v ?? null)}
              options={strategies.map(s => ({ value: s.id, label: s.name }))}
            />
            <RangePicker
              value={dateRange}
              onChange={(v) => {
                if (v && v[0] && v[1]) setDateRange([v[0], v[1]])
              }}
              style={isMobile ? { width: '100%' } : undefined}
            />
          </div>
        }
      >
        {error && <Alert message={error} type="error" showIcon closable style={{ marginBottom: 16 }} />}

        {/* 摘要卡片 */}
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          {[
            { title: '总盈亏', value: stats.totalPnl, prefix: '$', color: pnlColor(stats.totalPnl) },
            { title: '有效交易', value: stats.tradeCount, color: undefined },
            { title: '胜率', value: stats.winRate, suffix: '%', precision: 1, color: stats.winRate >= 50 ? PROFIT_COLOR : LOSS_COLOR },
            { title: '平均盈利', value: stats.avgWin, prefix: '$', precision: 2, color: PROFIT_COLOR },
            { title: '平均亏损', value: stats.avgLoss, prefix: '$', precision: 2, color: LOSS_COLOR },
            { title: '交易天数', value: stats.tradingDays, color: undefined },
          ].map((item, i) => (
            <Col key={i} xs={12} sm={8} md={4}>
              <Card size="small" style={{ marginBottom: 0 }}>
                <Statistic
                  title={item.title}
                  value={item.value}
                  prefix={item.prefix}
                  suffix={item.suffix}
                  precision={item.precision}
                  valueStyle={{ color: item.color, fontSize: isMobile ? 16 : 20 }}
                />
              </Card>
            </Col>
          ))}
        </Row>

        <Spin spinning={loading}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: 'overview',
                label: '综合分析',
                children: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* 策略对比（按策略 ID）*/}
                    {perStrategyStats.length > 0 && (
                      <Card size="small" title="策略对比" style={{ marginBottom: 0 }}>
                        <Table
                          dataSource={perStrategyStats}
                          rowKey="strategyId"
                          size="small"
                          pagination={false}
                          scroll={{ x: 'max-content' }}
                          onRow={(record) => ({
                            style: { cursor: 'pointer', background: selectedStrategyId === record.strategyId ? '#e6f4ff' : undefined },
                            onClick: () => setSelectedStrategyId(selectedStrategyId === record.strategyId ? null : record.strategyId),
                          })}
                          columns={[
                            { title: '策略', dataIndex: 'strategyName' },
                            { title: '笔数', dataIndex: 'trades' },
                            { title: '胜率', dataIndex: 'winRate', render: (v: number) => <span style={{ color: v >= 50 ? PROFIT_COLOR : LOSS_COLOR }}>{v.toFixed(1)}%</span> },
                            { title: '总盈亏', dataIndex: 'totalPnl', render: (v: number) => <span style={{ color: pnlColor(v) }}>${v.toFixed(2)}</span> },
                            { title: '反向笔数', dataIndex: 'reversed', render: (v: number) => v > 0 ? <Tag color="volcano">{v}</Tag> : <span style={{ color: '#999' }}>0</span> },
                          ]}
                        />
                      </Card>
                    )}

                    {/* 策略类型分析 */}
                    <Card size="small" title="方向/Regime 分析" style={{ marginBottom: 0 }}>
                      <Table
                        dataSource={strategyStats}
                        rowKey="type"
                        size="small"
                        pagination={false}
                        scroll={{ x: 'max-content' }}
                        columns={[
                          { title: '策略', dataIndex: 'type', render: (v: string) => <Tag color={directionTagColor(v)}>{v}</Tag> },
                          { title: '笔数', dataIndex: 'trades' },
                          { title: '胜率', dataIndex: 'winRate', render: (v: number) => <span style={{ color: v >= 50 ? PROFIT_COLOR : LOSS_COLOR }}>{v.toFixed(1)}%</span> },
                          { title: '总盈亏', dataIndex: 'totalPnl', render: (v: number) => <span style={{ color: pnlColor(v) }}>${v.toFixed(2)}</span> },
                        ]}
                      />
                    </Card>

                    {/* 退出方式分析 */}
                    <Card size="small" title="退出方式分析" style={{ marginBottom: 0 }}>
                      <Table
                        dataSource={exitStats}
                        rowKey="type"
                        size="small"
                        pagination={false}
                        scroll={{ x: 'max-content' }}
                        columns={[
                          { title: '退出方式', dataIndex: 'type', render: (v: string) => <Tag color={exitTagColor(v)}>{v}</Tag> },
                          { title: '笔数', dataIndex: 'trades' },
                          { title: '胜率', dataIndex: 'winRate', render: (v: number) => <span style={{ color: v >= 50 ? PROFIT_COLOR : LOSS_COLOR }}>{v.toFixed(1)}%</span> },
                          { title: '总盈亏', dataIndex: 'totalPnl', render: (v: number) => <span style={{ color: pnlColor(v) }}>${v.toFixed(2)}</span> },
                        ]}
                      />
                    </Card>

                    {/* 每日盈亏瀑布图 */}
                    <Card size="small" title="每日盈亏" style={{ marginBottom: 0 }}>
                      {dailyPnlData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={isMobile ? 200 : 300}>
                          <BarChart data={dailyPnlData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
                            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <RechartsTooltip />
                            <ReferenceLine y={0} stroke="#999" />
                            <Bar dataKey="pnl" isAnimationActive={false}>
                              {dailyPnlData.map((entry, idx) => (
                                <Cell key={idx} fill={entry.pnl >= 0 ? PROFIT_COLOR : LOSS_COLOR} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      ) : <Empty description="暂无数据" />}
                    </Card>

                    {/* 得分 vs 盈亏散点图 */}
                    <Card size="small" title="信号得分 vs 盈亏" style={{ marginBottom: 0 }}>
                      {scoreVsPnlData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={isMobile ? 200 : 300}>
                          <ScatterChart>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
                            <XAxis dataKey="score" name="得分" tick={{ fontSize: 11 }} type="number" domain={['auto', 'auto']} />
                            <YAxis dataKey="pnl" name="盈亏" tick={{ fontSize: 11 }} />
                            <RechartsTooltip
                              formatter={(value: number, name: string) => [`${Number(value).toFixed(2)}`, name === 'pnl' ? '盈亏 ($)' : '得分']}
                              labelFormatter={() => ''}
                            />
                            <ReferenceLine y={0} stroke="#999" />
                            <Scatter data={scoreVsPnlData} fill="#1677ff">
                              {scoreVsPnlData.map((entry, idx) => (
                                <Cell key={idx} fill={entry.pnl >= 0 ? PROFIT_COLOR : LOSS_COLOR} />
                              ))}
                            </Scatter>
                          </ScatterChart>
                        </ResponsiveContainer>
                      ) : <Empty description="暂无数据" />}
                    </Card>

                    {/* 得分区间胜率分析 */}
                    <Card size="small" title="得分区间胜率分析" style={{ marginBottom: 0 }}>
                      <Table
                        dataSource={scoreBuckets}
                        rowKey="label"
                        size="small"
                        pagination={false}
                        columns={[
                          { title: '得分区间', dataIndex: 'label' },
                          { title: '笔数', dataIndex: 'trades' },
                          { title: '盈利笔数', dataIndex: 'wins' },
                          { title: '胜率', dataIndex: 'winRate', render: (v: number) => <span style={{ color: v >= 50 ? PROFIT_COLOR : LOSS_COLOR }}>{v.toFixed(1)}%</span> },
                          { title: '总盈亏', dataIndex: 'totalPnl', render: (v: number) => <span style={{ color: pnlColor(v) }}>${v.toFixed(2)}</span> },
                          { title: '平均盈亏', dataIndex: 'avgPnl', render: (v: number) => <span style={{ color: pnlColor(v) }}>${v.toFixed(2)}</span> },
                        ]}
                      />
                    </Card>
                  </div>
                ),
              },
              {
                key: 'daily',
                label: '每日明细',
                children: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {dailyDetails.length === 0 && <Empty description="暂无交易数据" />}
                    {dailyDetails.map(([date, dayTrades]) => {
                      const dayPnl = dayTrades.reduce((s, t) => s + t.pnl, 0)
                      return (
                        <Card
                          key={date}
                          size="small"
                          title={<span>{date} <Tag color={dayPnl >= 0 ? 'green' : 'red'}>${dayPnl.toFixed(2)}</Tag></span>}
                          style={{ marginBottom: 0 }}
                        >
                          <Table
                            dataSource={dayTrades}
                            rowKey="id"
                            size="small"
                            pagination={false}
                            scroll={{ x: 'max-content' }}
                            columns={[
                              { title: '标的', dataIndex: 'symbol', width: 180, ellipsis: true },
                              { title: '方向', key: 'direction', render: (_: unknown, r: TradeRecord) => (
                                <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                                  <Tag color={directionTagColor(r.direction)}>{r.direction || '-'}</Tag>
                                  {Boolean(r.regime?.shouldReverse) && <Tag color="volcano">反向</Tag>}
                                  {String(r.regime?.regime ?? '') === 'UNCERTAIN' && <Tag color="orange">不确定</Tag>}
                                </span>
                              )},
                              ...(isMobile ? [] : [
                                { title: '得分', key: 'score', render: (_: unknown, r: TradeRecord) => r.score !== null ? Number(r.score).toFixed(0) : '-' },
                                { title: '策略', key: 'strategy', render: (_: unknown, r: TradeRecord) => <span style={{ color: '#999', fontSize: 12 }}>{strategyNameById(r.strategy_id)}</span> },
                              ]),
                              { title: '盈亏', key: 'pnl', render: (_: unknown, r: TradeRecord) => <span style={{ color: pnlColor(r.pnl), fontWeight: 600 }}>${r.pnl.toFixed(2)}</span> },
                              { title: '盈亏%', key: 'pnlPct', render: (_: unknown, r: TradeRecord) => r.pnlPct !== null ? <span style={{ color: pnlColor(r.pnlPct) }}>{r.pnlPct.toFixed(1)}%</span> : '-' },
                              { title: '退出', key: 'exit', render: (_: unknown, r: TradeRecord) => r.exitType ? <Tag color={exitTagColor(r.exitType)}>{r.exitType}</Tag> : '-' },
                            ]}
                          />
                        </Card>
                      )
                    })}
                  </div>
                ),
              },
              {
                key: 'reverse',
                label: '反向分析',
                children: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* 总览对比 */}
                    {reverseComparison ? (
                      <Row gutter={[12, 12]}>
                        <Col xs={24} sm={12}>
                          <Card size="small" title={<span style={{ color: '#1677ff' }}>原始策略</span>} style={{ marginBottom: 0 }}>
                            <Statistic title="总盈亏" value={reverseComparison.origTotal} prefix="$" valueStyle={{ color: pnlColor(reverseComparison.origTotal) }} />
                            <Statistic title="胜率" value={reverseComparison.origWinRate} suffix="%" precision={1} valueStyle={{ color: reverseComparison.origWinRate >= 50 ? PROFIT_COLOR : LOSS_COLOR, fontSize: 16, marginTop: 8 }} />
                          </Card>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Card size="small" title={<span style={{ color: '#fa8c16' }}>反向策略</span>} style={{ marginBottom: 0 }}>
                            <Statistic title="模拟总盈亏" value={reverseComparison.revTotal} prefix="$" valueStyle={{ color: pnlColor(reverseComparison.revTotal) }} />
                            <Statistic title="胜率" value={reverseComparison.revWinRate} suffix="%" precision={1} valueStyle={{ color: reverseComparison.revWinRate >= 50 ? PROFIT_COLOR : LOSS_COLOR, fontSize: 16, marginTop: 8 }} />
                            <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>有效对比: {reverseComparison.revCount} 笔（原始 {reverseComparison.origCount} 笔）</div>
                          </Card>
                        </Col>
                      </Row>
                    ) : (
                      <Alert message="尚无反向分析数据，请先通过手动采集获取K线数据" type="info" showIcon />
                    )}

                    {/* 逐笔对比表 */}
                    <Card size="small" title="逐笔反向对比" style={{ marginBottom: 0 }}>
                      <Table
                        dataSource={analysis}
                        rowKey="order_id"
                        size="small"
                        pagination={{ pageSize: 20 }}
                        scroll={{ x: 'max-content' }}
                        columns={[
                          { title: '日期', dataIndex: 'trade_date', width: 100 },
                          { title: '标的', dataIndex: 'underlying', width: 60 },
                          { title: '原始盈亏', dataIndex: 'original_pnl', render: (v: number) => v !== null ? <span style={{ color: pnlColor(Number(v)) }}>${Number(v).toFixed(2)}</span> : '-' },
                          { title: '原始%', dataIndex: 'original_pnl_pct', render: (v: number) => v !== null ? <span style={{ color: pnlColor(Number(v)) }}>{Number(v).toFixed(1)}%</span> : '-' },
                          { title: '反向盈亏', dataIndex: 'reverse_pnl', render: (v: number) => v !== null ? <span style={{ color: pnlColor(Number(v)) }}>${Number(v).toFixed(2)}</span> : '-' },
                          { title: '反向%', dataIndex: 'reverse_pnl_pct', render: (v: number) => v !== null ? <span style={{ color: pnlColor(Number(v)) }}>{Number(v).toFixed(1)}%</span> : '-' },
                          { title: '状态', dataIndex: 'collection_status', render: (v: string) => {
                            const colorMap: Record<string, string> = { SUCCESS: 'green', PARTIAL: 'orange', FAILED: 'red', NO_DATA: 'default', PENDING: 'blue' }
                            return <Tag color={colorMap[v] || 'default'}>{v}</Tag>
                          }},
                        ]}
                      />
                    </Card>
                  </div>
                ),
              },
              {
                key: 'kline',
                label: 'K线图表',
                children: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <Card size="small" style={{ marginBottom: 0 }}>
                      <Select
                        placeholder="选择交易查看K线"
                        style={{ width: '100%' }}
                        value={selectedOrderId}
                        onChange={setSelectedOrderId}
                        options={klineOptions}
                        showSearch
                        filterOption={(input, option) =>
                          (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                        }
                      />
                    </Card>

                    {selectedOrderId && (
                      <Spin spinning={klineLoading}>
                        {klineData.original.length === 0 && klineData.reverse.length === 0 ? (
                          <Empty description="暂无K线数据" />
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {/* 交易信息概览 */}
                            {selectedAnalysis && (
                              <Card size="small" title="交易信息" style={{ marginBottom: 0 }}>
                                <Descriptions size="small" column={isMobile ? 1 : 3} bordered>
                                  <Descriptions.Item label="正向标的">{selectedAnalysis.original_symbol}</Descriptions.Item>
                                  <Descriptions.Item label="反向标的">{selectedAnalysis.reverse_symbol || '-'}</Descriptions.Item>
                                  <Descriptions.Item label="交易日期">{selectedAnalysis.trade_date}</Descriptions.Item>
                                  <Descriptions.Item label="入场价">${Number(selectedAnalysis.original_entry_price).toFixed(2)}</Descriptions.Item>
                                  <Descriptions.Item label="出场价">${Number(selectedAnalysis.original_exit_price).toFixed(2)}</Descriptions.Item>
                                  <Descriptions.Item label="盈亏">
                                    <span style={{ color: pnlColor(Number(selectedAnalysis.original_pnl)), fontWeight: 600 }}>
                                      ${Number(selectedAnalysis.original_pnl).toFixed(2)}
                                    </span>
                                  </Descriptions.Item>
                                </Descriptions>
                              </Card>
                            )}

                            {/* 正向期权 K 线 */}
                            {klineData.original.length > 0 && (() => {
                              const entryTs = selectedAnalysis?.entry_time ? new Date(selectedAnalysis.entry_time).getTime() : null
                              const exitTs = selectedAnalysis?.exit_time ? new Date(selectedAnalysis.exit_time).getTime() : null
                              const chartData = klineData.original.map(k => {
                                const ts = Number(k.timestamp)
                                const close = Number(k.close)
                                return {
                                  timestamp: ts,
                                  close,
                                  buyPoint: (entryTs && Math.abs(ts - entryTs) < 60000) ? close : undefined,
                                  sellPoint: (exitTs && Math.abs(ts - exitTs) < 60000) ? close : undefined,
                                }
                              })
                              // If no exact match found, inject entry/exit as special points
                              const hasBuy = chartData.some(d => d.buyPoint !== undefined)
                              const hasSell = chartData.some(d => d.sellPoint !== undefined)
                              if (!hasBuy && entryTs) {
                                const closest = chartData.reduce((best, d) => Math.abs(d.timestamp - entryTs) < Math.abs(best.timestamp - entryTs) ? d : best, chartData[0])
                                if (closest) closest.buyPoint = closest.close
                              }
                              if (!hasSell && exitTs) {
                                const closest = chartData.reduce((best, d) => Math.abs(d.timestamp - exitTs) < Math.abs(best.timestamp - exitTs) ? d : best, chartData[0])
                                if (closest) closest.sellPoint = closest.close
                              }
                              return (
                                <Card
                                  size="small"
                                  title={`正向期权 (${selectedAnalysis?.original_symbol || 'Original'})`}
                                  style={{ marginBottom: 0 }}
                                >
                                  <ResponsiveContainer width="100%" height={isMobile ? 180 : 250}>
                                    <LineChart data={chartData}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
                                      <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                                      <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                                      <RechartsTooltip
                                        labelFormatter={(ts: number) => formatTime(ts)}
                                        formatter={(value: number, name: string) => {
                                          const labels: Record<string, string> = { close: '价格', buyPoint: '买入', sellPoint: '卖出' }
                                          return value !== undefined ? [`$${Number(value).toFixed(4)}`, labels[name] || name] : ['-', name]
                                        }}
                                      />
                                      <Legend />
                                      <Line dataKey="close" name="价格" stroke="#1677ff" dot={false} strokeWidth={1.5} />
                                      <Line
                                        dataKey="buyPoint"
                                        name="买入"
                                        stroke={PROFIT_COLOR}
                                        dot={{ r: 6, fill: PROFIT_COLOR, stroke: '#fff', strokeWidth: 2 }}
                                        legendType="circle"
                                        connectNulls={false}
                                        strokeWidth={0}
                                      />
                                      <Line
                                        dataKey="sellPoint"
                                        name="卖出"
                                        stroke={LOSS_COLOR}
                                        dot={{ r: 6, fill: LOSS_COLOR, stroke: '#fff', strokeWidth: 2 }}
                                        legendType="circle"
                                        connectNulls={false}
                                        strokeWidth={0}
                                      />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </Card>
                              )
                            })()}

                            {/* 反向期权 K 线 */}
                            {klineData.reverse.length > 0 && (() => {
                              const entryTs = selectedAnalysis?.entry_time ? new Date(selectedAnalysis.entry_time).getTime() : null
                              const exitTs = selectedAnalysis?.exit_time ? new Date(selectedAnalysis.exit_time).getTime() : null
                              const chartData = klineData.reverse.map(k => {
                                const ts = Number(k.timestamp)
                                const close = Number(k.close)
                                return {
                                  timestamp: ts,
                                  close,
                                  buyPoint: (entryTs && Math.abs(ts - entryTs) < 60000) ? close : undefined,
                                  sellPoint: (exitTs && Math.abs(ts - exitTs) < 60000) ? close : undefined,
                                }
                              })
                              const hasBuy = chartData.some(d => d.buyPoint !== undefined)
                              const hasSell = chartData.some(d => d.sellPoint !== undefined)
                              if (!hasBuy && entryTs) {
                                const closest = chartData.reduce((best, d) => Math.abs(d.timestamp - entryTs) < Math.abs(best.timestamp - entryTs) ? d : best, chartData[0])
                                if (closest) closest.buyPoint = closest.close
                              }
                              if (!hasSell && exitTs) {
                                const closest = chartData.reduce((best, d) => Math.abs(d.timestamp - exitTs) < Math.abs(best.timestamp - exitTs) ? d : best, chartData[0])
                                if (closest) closest.sellPoint = closest.close
                              }
                              return (
                                <Card
                                  size="small"
                                  title={`反向期权 (${selectedAnalysis?.reverse_symbol || 'Reverse'})`}
                                  style={{ marginBottom: 0 }}
                                >
                                  <ResponsiveContainer width="100%" height={isMobile ? 180 : 250}>
                                    <LineChart data={chartData}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
                                      <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                                      <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                                      <RechartsTooltip
                                        labelFormatter={(ts: number) => formatTime(ts)}
                                        formatter={(value: number, name: string) => {
                                          const labels: Record<string, string> = { close: '价格', buyPoint: '买入', sellPoint: '卖出' }
                                          return value !== undefined ? [`$${Number(value).toFixed(4)}`, labels[name] || name] : ['-', name]
                                        }}
                                      />
                                      <Legend />
                                      <Line dataKey="close" name="价格" stroke="#fa8c16" dot={false} strokeWidth={1.5} />
                                      <Line
                                        dataKey="buyPoint"
                                        name="买入"
                                        stroke={PROFIT_COLOR}
                                        dot={{ r: 6, fill: PROFIT_COLOR, stroke: '#fff', strokeWidth: 2 }}
                                        legendType="circle"
                                        connectNulls={false}
                                        strokeWidth={0}
                                      />
                                      <Line
                                        dataKey="sellPoint"
                                        name="卖出"
                                        stroke={LOSS_COLOR}
                                        dot={{ r: 6, fill: LOSS_COLOR, stroke: '#fff', strokeWidth: 2 }}
                                        legendType="circle"
                                        connectNulls={false}
                                        strokeWidth={0}
                                      />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </Card>
                              )
                            })()}
                          </div>
                        )}
                      </Spin>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </Spin>
      </Card>
    </AppLayout>
  )
}
