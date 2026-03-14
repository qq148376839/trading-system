'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, Tabs, Table, Tag, Statistic, Row, Col, DatePicker, Select, Spin, Alert, Empty, Button } from 'antd'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ScatterChart, Scatter, LineChart, Line, ReferenceLine, Legend } from 'recharts'
import dayjs, { Dayjs } from 'dayjs'
import AppLayout from '@/components/AppLayout'
import { ordersApi, quantApi } from '@/lib/api'
import { useIsMobile } from '@/hooks/useIsMobile'

const { RangePicker } = DatePicker

// -- 颜色常量 --
const COLOR = {
  profit: '#3fb950',
  loss: '#f85149',
  neutral: '#d29922',
  cardBg: '#161b22',
  cardBorder: '#30363d',
  bull: '#3fb950',
  bear: '#f85149',
  revBear: '#a371f7',
  takeProfit: '#3fb950',
  trailingStop: '#d29922',
  stopLoss: '#f85149',
  original: '#58a6ff',
  reverse: '#f0883e',
}

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
  metadata: any
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
  regime: any          // regimeDetection from BUY
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
  const [klineData, setKlineData] = useState<{ original: any[]; reverse: any[] }>({ original: [], reverse: [] })
  const [klineLoading, setKlineLoading] = useState(false)

  // 加载策略列表
  useEffect(() => {
    (async () => {
      try {
        const res = await quantApi.getStrategies()
        const list = (res as any)?.data || []
        setStrategies(list.map((s: any) => ({ id: s.id, name: s.name })))
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
      const allOrders = (ordersRes as any)?.data?.orders || (ordersRes as any)?.data || []
      const optionOrders = allOrders.filter((o: any) => {
        const sym = String(o.symbol || '')
        return /^[A-Z]+\d{6}[CP]\d+\.US$/i.test(sym)
      })
      setOrders(optionOrders)

      const allSignals = (signalsRes as any)?.data?.signals || (signalsRes as any)?.data || []
      setSignals(allSignals)

      const allAnalysis = (analysisRes as any)?.data || []
      setAnalysis(allAnalysis)
    } catch (err: any) {
      setError(err.message || '加载数据失败')
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
        original: (origRes as any)?.data || [],
        reverse: (revRes as any)?.data || [],
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
    const sellSignals = signals.filter(s => s.signal_type === 'SELL' && s.metadata?.netPnL !== undefined && s.metadata?.netPnL !== null)

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

      const pnl = Number(sell.metadata.netPnL)
      const pnlPctVal = sell.metadata.netPnLPercent
      const pnlPct = pnlPctVal !== undefined && pnlPctVal !== null ? Number(pnlPctVal) : null

      records.push({
        id: sell.id,
        symbol: sell.symbol,
        strategy_id: sell.strategy_id || 0,
        trade_date: (sell.created_at || '').split('T')[0],
        created_at: sell.created_at,
        pnl,
        pnlPct,
        exitType: String(sell.metadata.exitAction ?? ''),
        score: matchedBuy?.metadata?.finalScore !== undefined ? Number(matchedBuy.metadata.finalScore) : null,
        direction: String(matchedBuy?.metadata?.optionDirection ?? matchedBuy?.metadata?.selectedStrategy ?? ''),
        regime: matchedBuy?.metadata?.regimeDetection ?? null,
        strategyName: String(matchedBuy?.metadata?.selectedStrategy ?? ''),
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
    const totalPnl = filteredTrades.reduce((sum, t) => sum + t.pnl, 0)
    const wins = filteredTrades.filter(t => t.pnl > 0)
    const losses = filteredTrades.filter(t => t.pnl < 0)
    const winRate = filteredTrades.length > 0 ? (wins.length / filteredTrades.length) * 100 : 0
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0
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
        pnl: t.pnl,
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

  // -- 得分区间胜率 --
  const scoreBuckets = useMemo(() => {
    const buckets = [
      { label: '< 60', min: -Infinity, max: 60, trades: 0, wins: 0 },
      { label: '60-70', min: 60, max: 70, trades: 0, wins: 0 },
      { label: '70-80', min: 70, max: 80, trades: 0, wins: 0 },
      { label: '80-90', min: 80, max: 90, trades: 0, wins: 0 },
      { label: '90+', min: 90, max: Infinity, trades: 0, wins: 0 },
    ]
    for (const t of filteredTrades) {
      if (t.score === null) continue
      for (const b of buckets) {
        if (t.score >= b.min && t.score < b.max) {
          b.trades++
          if (t.pnl > 0) b.wins++
          break
        }
      }
    }
    return buckets.map(b => ({ ...b, winRate: b.trades > 0 ? (b.wins / b.trades) * 100 : 0 }))
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

  // -- 反向分析对比 --
  const reverseComparison = useMemo(() => {
    if (analysis.length === 0) return null
    const origTotal = analysis.reduce((s, a) => s + Number(a.original_pnl || 0), 0)
    const revTotal = analysis.reduce((s, a) => s + Number(a.reverse_pnl || 0), 0)
    const origWins = analysis.filter(a => Number(a.original_pnl) > 0).length
    const revWins = analysis.filter(a => Number(a.reverse_pnl) > 0).length
    const validCount = analysis.filter(a => a.reverse_pnl !== null).length
    return {
      origTotal: Math.round(origTotal * 100) / 100,
      revTotal: Math.round(revTotal * 100) / 100,
      origWinRate: analysis.length > 0 ? (origWins / analysis.length) * 100 : 0,
      revWinRate: validCount > 0 ? (revWins / validCount) * 100 : 0,
      count: analysis.length,
      validCount,
    }
  }, [analysis])

  // -- K线选择器选项 --
  const klineOptions = useMemo(() => {
    return analysis
      .filter(a => a.original_candle_count > 0 || a.reverse_candle_count > 0)
      .map(a => ({
        value: a.order_id,
        label: `${a.original_symbol || a.underlying} (${a.trade_date}) ${a.collection_status === 'SUCCESS' ? '' : `[${a.collection_status}]`}`,
      }))
  }, [analysis])

  // -- 标签颜色 --
  const directionColor = (dir: string) => {
    if (dir?.includes('BULL') || dir?.includes('CALL')) return COLOR.bull
    if (dir?.includes('BEAR') || dir?.includes('PUT')) return COLOR.bear
    if (dir?.includes('REV')) return COLOR.revBear
    return COLOR.neutral
  }

  const exitColor = (exitType: string) => {
    if (exitType?.includes('PROFIT') || exitType?.includes('TAKE')) return COLOR.takeProfit
    if (exitType?.includes('TRAIL')) return COLOR.trailingStop
    if (exitType?.includes('STOP') || exitType?.includes('LOSS')) return COLOR.stopLoss
    return COLOR.neutral
  }

  const pnlColor = (v: number) => (v > 0 ? COLOR.profit : v < 0 ? COLOR.loss : COLOR.neutral)

  // -- 渲染 --
  const darkCard = { background: COLOR.cardBg, border: `1px solid ${COLOR.cardBorder}`, borderRadius: 8 }

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
        styles={{ header: { borderBottom: `1px solid ${COLOR.cardBorder}` } }}
      >
        {error && <Alert message={error} type="error" showIcon closable style={{ marginBottom: 16 }} />}

        {/* 摘要卡片 */}
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          {[
            { title: '总盈亏', value: stats.totalPnl, prefix: '$', color: pnlColor(stats.totalPnl) },
            { title: '有效交易', value: stats.tradeCount, color: undefined },
            { title: '胜率', value: stats.winRate, suffix: '%', precision: 1, color: stats.winRate >= 50 ? COLOR.profit : COLOR.loss },
            { title: '平均盈利', value: stats.avgWin, prefix: '$', precision: 2, color: COLOR.profit },
            { title: '平均亏损', value: stats.avgLoss, prefix: '$', precision: 2, color: COLOR.loss },
            { title: '交易天数', value: stats.tradingDays, color: undefined },
          ].map((item, i) => (
            <Col key={i} xs={12} sm={8} md={4}>
              <Card size="small" style={darkCard}>
                <Statistic
                  title={<span style={{ color: '#8b949e' }}>{item.title}</span>}
                  value={item.value}
                  prefix={item.prefix}
                  suffix={item.suffix}
                  precision={item.precision}
                  valueStyle={{ color: item.color || '#e6edf3', fontSize: isMobile ? 16 : 20 }}
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
                      <Card size="small" title="策略对比" style={darkCard} styles={{ header: { color: '#e6edf3', borderBottom: `1px solid ${COLOR.cardBorder}` }, body: { padding: isMobile ? 8 : 16 } }}>
                        <Table
                          dataSource={perStrategyStats}
                          rowKey="strategyId"
                          size="small"
                          pagination={false}
                          scroll={{ x: 'max-content' }}
                          onRow={(record) => ({
                            style: { cursor: 'pointer', background: selectedStrategyId === record.strategyId ? '#1c2128' : undefined },
                            onClick: () => setSelectedStrategyId(selectedStrategyId === record.strategyId ? null : record.strategyId),
                          })}
                          columns={[
                            { title: '策略', dataIndex: 'strategyName', render: (v: string, r: any) => <span style={{ color: '#e6edf3' }}>{v}</span> },
                            { title: '笔数', dataIndex: 'trades' },
                            { title: '胜率', dataIndex: 'winRate', render: (v: number) => <span style={{ color: v >= 50 ? COLOR.profit : COLOR.loss }}>{v.toFixed(1)}%</span> },
                            { title: '总盈亏', dataIndex: 'totalPnl', render: (v: number) => <span style={{ color: pnlColor(v) }}>${v.toFixed(2)}</span> },
                            { title: '反向笔数', dataIndex: 'reversed', render: (v: number) => v > 0 ? <Tag color="volcano">{v}</Tag> : <span style={{ color: '#484f58' }}>0</span> },
                          ]}
                        />
                      </Card>
                    )}

                    {/* 策略类型分析 */}
                    <Card size="small" title="方向/Regime 分析" style={darkCard} styles={{ header: { color: '#e6edf3', borderBottom: `1px solid ${COLOR.cardBorder}` }, body: { padding: isMobile ? 8 : 16 } }}>
                      <Table
                        dataSource={strategyStats}
                        rowKey="type"
                        size="small"
                        pagination={false}
                        scroll={{ x: 'max-content' }}
                        columns={[
                          { title: '策略', dataIndex: 'type', render: (v: string) => <Tag color={directionColor(v)}>{v}</Tag> },
                          { title: '笔数', dataIndex: 'trades' },
                          { title: '胜率', dataIndex: 'winRate', render: (v: number) => <span style={{ color: v >= 50 ? COLOR.profit : COLOR.loss }}>{v.toFixed(1)}%</span> },
                          { title: '总盈亏', dataIndex: 'totalPnl', render: (v: number) => <span style={{ color: pnlColor(v) }}>${v.toFixed(2)}</span> },
                        ]}
                      />
                    </Card>

                    {/* 退出方式分析 */}
                    <Card size="small" title="退出方式分析" style={darkCard} styles={{ header: { color: '#e6edf3', borderBottom: `1px solid ${COLOR.cardBorder}` }, body: { padding: isMobile ? 8 : 16 } }}>
                      <Table
                        dataSource={exitStats}
                        rowKey="type"
                        size="small"
                        pagination={false}
                        scroll={{ x: 'max-content' }}
                        columns={[
                          { title: '退出方式', dataIndex: 'type', render: (v: string) => <Tag color={exitColor(v)}>{v}</Tag> },
                          { title: '笔数', dataIndex: 'trades' },
                          { title: '胜率', dataIndex: 'winRate', render: (v: number) => <span style={{ color: v >= 50 ? COLOR.profit : COLOR.loss }}>{v.toFixed(1)}%</span> },
                          { title: '总盈亏', dataIndex: 'totalPnl', render: (v: number) => <span style={{ color: pnlColor(v) }}>${v.toFixed(2)}</span> },
                        ]}
                      />
                    </Card>

                    {/* 每日盈亏瀑布图 */}
                    <Card size="small" title="每日盈亏" style={darkCard} styles={{ header: { color: '#e6edf3', borderBottom: `1px solid ${COLOR.cardBorder}` } }}>
                      {dailyPnlData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={isMobile ? 200 : 300}>
                          <BarChart data={dailyPnlData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                            <XAxis dataKey="date" tick={{ fill: '#8b949e', fontSize: 11 }} />
                            <YAxis tick={{ fill: '#8b949e', fontSize: 11 }} />
                            <RechartsTooltip contentStyle={{ background: '#1c2128', border: `1px solid ${COLOR.cardBorder}` }} />
                            <ReferenceLine y={0} stroke="#484f58" />
                            <Bar dataKey="pnl" fill={COLOR.profit} isAnimationActive={false}>
                              {dailyPnlData.map((entry, idx) => (
                                <rect key={idx} fill={entry.pnl >= 0 ? COLOR.profit : COLOR.loss} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      ) : <Empty description="暂无数据" />}
                    </Card>

                    {/* 得分 vs 盈亏散点图 */}
                    <Card size="small" title="信号得分 vs 盈亏" style={darkCard} styles={{ header: { color: '#e6edf3', borderBottom: `1px solid ${COLOR.cardBorder}` } }}>
                      {scoreVsPnlData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={isMobile ? 200 : 300}>
                          <ScatterChart>
                            <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                            <XAxis dataKey="score" name="得分" tick={{ fill: '#8b949e', fontSize: 11 }} />
                            <YAxis dataKey="pnl" name="盈亏" tick={{ fill: '#8b949e', fontSize: 11 }} />
                            <RechartsTooltip contentStyle={{ background: '#1c2128', border: `1px solid ${COLOR.cardBorder}` }} />
                            <ReferenceLine y={0} stroke="#484f58" />
                            <Scatter data={scoreVsPnlData} fill={COLOR.original} />
                          </ScatterChart>
                        </ResponsiveContainer>
                      ) : <Empty description="暂无数据" />}
                    </Card>

                    {/* 得分区间胜率分析 */}
                    <Card size="small" title="得分区间胜率分析" style={darkCard} styles={{ header: { color: '#e6edf3', borderBottom: `1px solid ${COLOR.cardBorder}` }, body: { padding: isMobile ? 8 : 16 } }}>
                      <Table
                        dataSource={scoreBuckets}
                        rowKey="label"
                        size="small"
                        pagination={false}
                        columns={[
                          { title: '得分区间', dataIndex: 'label' },
                          { title: '笔数', dataIndex: 'trades' },
                          { title: '胜率', dataIndex: 'winRate', render: (v: number) => <span style={{ color: v >= 50 ? COLOR.profit : COLOR.loss }}>{v.toFixed(1)}%</span> },
                          { title: '盈利笔数', dataIndex: 'wins' },
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
                          title={<span style={{ color: '#e6edf3' }}>{date} <Tag color={dayPnl >= 0 ? 'green' : 'red'}>${dayPnl.toFixed(2)}</Tag></span>}
                          style={darkCard}
                          styles={{ header: { borderBottom: `1px solid ${COLOR.cardBorder}` }, body: { padding: isMobile ? 4 : 12 } }}
                        >
                          <Table
                            dataSource={dayTrades}
                            rowKey="id"
                            size="small"
                            pagination={false}
                            scroll={{ x: 'max-content' }}
                            columns={[
                              { title: '标的', dataIndex: 'symbol', width: 180, ellipsis: true },
                              { title: '方向', key: 'direction', render: (_: any, r: TradeRecord) => (
                                <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                                  <Tag color={directionColor(r.direction)}>{r.direction || '-'}</Tag>
                                  {r.regime?.shouldReverse && <Tag color="volcano">反向</Tag>}
                                  {r.regime?.regime === 'UNCERTAIN' && <Tag color="orange">不确定</Tag>}
                                </span>
                              )},
                              ...(isMobile ? [] : [
                                { title: '得分', key: 'score', render: (_: any, r: TradeRecord) => r.score !== null ? Number(r.score).toFixed(0) : '-' },
                                { title: '策略', key: 'strategy', render: (_: any, r: TradeRecord) => <span style={{ color: '#8b949e', fontSize: 12 }}>{strategyNameById(r.strategy_id)}</span> },
                              ]),
                              { title: '盈亏', key: 'pnl', render: (_: any, r: TradeRecord) => <span style={{ color: pnlColor(r.pnl), fontWeight: 600 }}>${r.pnl.toFixed(2)}</span> },
                              { title: '盈亏%', key: 'pnlPct', render: (_: any, r: TradeRecord) => r.pnlPct !== null ? <span style={{ color: pnlColor(r.pnlPct) }}>{r.pnlPct.toFixed(1)}%</span> : '-' },
                              { title: '退出', key: 'exit', render: (_: any, r: TradeRecord) => r.exitType ? <Tag color={exitColor(r.exitType)}>{r.exitType}</Tag> : '-' },
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
                          <Card size="small" title={<span style={{ color: COLOR.original }}>原始策略</span>} style={darkCard} styles={{ header: { borderBottom: `1px solid ${COLOR.cardBorder}` } }}>
                            <Statistic title={<span style={{ color: '#8b949e' }}>总盈亏</span>} value={reverseComparison.origTotal} prefix="$" valueStyle={{ color: pnlColor(reverseComparison.origTotal) }} />
                            <Statistic title={<span style={{ color: '#8b949e' }}>胜率</span>} value={reverseComparison.origWinRate} suffix="%" precision={1} valueStyle={{ color: reverseComparison.origWinRate >= 50 ? COLOR.profit : COLOR.loss, fontSize: 16, marginTop: 8 }} />
                          </Card>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Card size="small" title={<span style={{ color: COLOR.reverse }}>反向策略</span>} style={darkCard} styles={{ header: { borderBottom: `1px solid ${COLOR.cardBorder}` } }}>
                            <Statistic title={<span style={{ color: '#8b949e' }}>模拟总盈亏</span>} value={reverseComparison.revTotal} prefix="$" valueStyle={{ color: pnlColor(reverseComparison.revTotal) }} />
                            <Statistic title={<span style={{ color: '#8b949e' }}>胜率</span>} value={reverseComparison.revWinRate} suffix="%" precision={1} valueStyle={{ color: reverseComparison.revWinRate >= 50 ? COLOR.profit : COLOR.loss, fontSize: 16, marginTop: 8 }} />
                            <div style={{ color: '#8b949e', fontSize: 12, marginTop: 4 }}>有效对比: {reverseComparison.validCount}/{reverseComparison.count} 笔</div>
                          </Card>
                        </Col>
                      </Row>
                    ) : (
                      <Alert message="尚无反向分析数据，请先通过手动采集获取K线数据" type="info" showIcon />
                    )}

                    {/* 逐笔对比表 */}
                    <Card size="small" title="逐笔反向对比" style={darkCard} styles={{ header: { color: '#e6edf3', borderBottom: `1px solid ${COLOR.cardBorder}` }, body: { padding: isMobile ? 4 : 12 } }}>
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
                    <Card size="small" style={darkCard}>
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
                          <Card size="small" title="正向 vs 反向期权价格" style={darkCard} styles={{ header: { color: '#e6edf3', borderBottom: `1px solid ${COLOR.cardBorder}` } }}>
                            <ResponsiveContainer width="100%" height={isMobile ? 250 : 400}>
                              <LineChart>
                                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                                <XAxis
                                  dataKey="timestamp"
                                  type="number"
                                  domain={['dataMin', 'dataMax']}
                                  tickFormatter={(ts: number) => {
                                    const d = new Date(ts)
                                    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
                                  }}
                                  tick={{ fill: '#8b949e', fontSize: 11 }}
                                  allowDuplicatedCategory={false}
                                />
                                <YAxis yAxisId="left" tick={{ fill: COLOR.original, fontSize: 11 }} />
                                <YAxis yAxisId="right" orientation="right" tick={{ fill: COLOR.reverse, fontSize: 11 }} />
                                <RechartsTooltip
                                  contentStyle={{ background: '#1c2128', border: `1px solid ${COLOR.cardBorder}` }}
                                  labelFormatter={(ts: number) => new Date(ts).toLocaleTimeString()}
                                />
                                <Legend />
                                {klineData.original.length > 0 && (
                                  <Line
                                    yAxisId="left"
                                    data={klineData.original.map(k => ({ timestamp: Number(k.timestamp), close: Number(k.close) }))}
                                    dataKey="close"
                                    name="正向期权"
                                    stroke={COLOR.original}
                                    dot={false}
                                    strokeWidth={2}
                                  />
                                )}
                                {klineData.reverse.length > 0 && (
                                  <Line
                                    yAxisId="right"
                                    data={klineData.reverse.map(k => ({ timestamp: Number(k.timestamp), close: Number(k.close) }))}
                                    dataKey="close"
                                    name="反向期权"
                                    stroke={COLOR.reverse}
                                    dot={false}
                                    strokeWidth={2}
                                  />
                                )}
                              </LineChart>
                            </ResponsiveContainer>
                          </Card>
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
