'use client'

import { useState, useEffect, useCallback } from 'react'
import { Empty, Statistic, Tooltip } from 'antd'
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, ReferenceLine, Tooltip as RechartsTooltip,
} from 'recharts'
import AppLayout from '@/components/AppLayout'
import { quantApi } from '@/lib/api'
import { useIsMobile } from '@/hooks/useIsMobile'
import dayjs from 'dayjs'
import './monitor.css'

// ============================================
// Types
// ============================================

interface MarketScoreData {
  marketScore: number
  marketComponents: {
    spxDaily: { raw: number; weighted: number }
    spxMinute: { raw: number; weighted: number }
    gap: { pct: number; score: number }
    usdDaily: { raw: number; weighted: number }
    usdMinute: { raw: number; weighted: number }
    btcDaily: { raw: number; weighted: number; resonance: boolean }
    btcMinute: { raw: number; weighted: number }
    vix: { value: number; source: string; impact: number }
    temperature: { value: number; impact: number }
  }
  intradayScore: number
  timeWindowScore: number
  finalScore: number
  direction: 'CALL' | 'PUT' | 'HOLD'
  confidence: number
  regime: { type: string; confidence: string; label: string }
  suitableStrategies: string[]
  scoreLabel: string
  timestamp: number
}

interface StrategyOverview {
  strategyId: number
  strategyName: string
  strategyType: string
  todayPnl: number
  todayTrades: number
  instances: Array<{
    symbol: string
    state: string
    entryPrice: number | null
    quantity: number | null
    stopLoss: number | null
    takeProfit: number | null
    unrealizedPnl: number | null
    cooldownUntil: string | null
    lastUpdated: string
  }>
  summary: { total: number; idle: number; holding: number; opening: number; closing: number; cooldown: number }
}

interface Signal {
  id: number
  strategy_id: number
  symbol: string
  signal_type: string
  price: number
  reason: string
  status: string
  metadata: Record<string, unknown>
  created_at: string
}

interface ScoreHistoryPoint {
  time: number
  score: number
  label: string
}

// ============================================
// Theme constants
// ============================================

const COLORS = {
  accent: '#00d4ff',
  positive: '#00ff88',
  negative: '#ff4757',
  neutral: '#ffa502',
  text: '#e8eaed',
  textSecondary: '#8892a4',
  cardBg: 'rgba(16, 24, 48, 0.8)',
}

const scoreColor = (v: number) =>
  v > 20 ? COLORS.positive : v < -20 ? COLORS.negative : COLORS.neutral

const pnlColor = (v: number) =>
  v > 0 ? COLORS.positive : v < 0 ? COLORS.negative : COLORS.textSecondary

const stateColor = (state: string) => {
  const map: Record<string, string> = {
    IDLE: '#4a5568',
    HOLDING: COLORS.accent,
    OPENING: COLORS.neutral,
    CLOSING: COLORS.neutral,
    COOLDOWN: '#718096',
  }
  return map[state] || COLORS.textSecondary
}

// ============================================
// Sub-components
// ============================================

function ScoreGauge({ score }: { score: number }) {
  const clamped = Math.max(-100, Math.min(100, score))
  const angle = 180 - ((clamped + 100) / 200) * 180
  const rad = (angle * Math.PI) / 180
  const cx = 100, cy = 100, r = 80
  const endX = cx + r * Math.cos(rad)
  const endY = cy - r * Math.sin(rad)
  const color = scoreColor(clamped)
  const largeArc = angle < 90 ? 1 : 0

  return (
    <svg viewBox="0 0 200 120" style={{ width: '100%', maxWidth: 200 }}>
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={10} strokeLinecap="round" />
      <path d={`M 20 100 A 80 80 0 ${largeArc} 1 ${endX.toFixed(1)} ${endY.toFixed(1)}`} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" filter="url(#glow)" />
      <text x={100} y={85} textAnchor="middle" fill={color} fontSize={36} fontFamily="'SF Mono', monospace" fontWeight="bold">
        {clamped > 0 ? '+' : ''}{clamped.toFixed(0)}
      </text>
      <text x={100} y={110} textAnchor="middle" fill={COLORS.textSecondary} fontSize={11}>
        FINAL SCORE
      </text>
    </svg>
  )
}

function ScoreTrendChart({ data, isMobile }: { data: ScoreHistoryPoint[]; isMobile: boolean }) {
  if (data.length < 2) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: isMobile ? 120 : 160, color: COLORS.textSecondary, fontSize: 13 }}>
        数据采集中...
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={isMobile ? 120 : 160}>
      <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={COLORS.accent} stopOpacity={0.3} />
            <stop offset="95%" stopColor={COLORS.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="time"
          tickFormatter={(t: number) => dayjs(t).format('HH:mm')}
          stroke="#4a5568"
          tick={{ fontSize: 10, fill: COLORS.textSecondary }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[-100, 100]}
          stroke="#4a5568"
          tick={{ fontSize: 10, fill: COLORS.textSecondary }}
          axisLine={false}
          tickLine={false}
          ticks={[-100, -50, 0, 50, 100]}
        />
        <ReferenceLine y={0} stroke="#4a5568" strokeDasharray="3 3" />
        <RechartsTooltip
          contentStyle={{ background: '#0d1321', border: '1px solid rgba(0,212,255,0.2)', borderRadius: 6, fontSize: 12, color: COLORS.text }}
          labelFormatter={(t: number) => dayjs(t).format('HH:mm:ss')}
          formatter={(value: number) => [`${value > 0 ? '+' : ''}${value.toFixed(1)}`, '评分']}
        />
        <Area type="monotone" dataKey="score" stroke={COLORS.accent} fill="url(#scoreGradient)" strokeWidth={2} dot={false} animationDuration={300} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function ComponentBadges({ components, isMobile }: { components: MarketScoreData['marketComponents']; isMobile: boolean }) {
  const items = [
    { label: 'SPX日', value: components.spxDaily.weighted },
    { label: 'SPX分', value: components.spxMinute.weighted },
    { label: 'USD日', value: components.usdDaily.weighted },
    { label: 'USD分', value: components.usdMinute.weighted },
    { label: 'BTC日', value: components.btcDaily.weighted, extra: components.btcDaily.resonance ? '共振' : undefined },
    { label: 'BTC分', value: components.btcMinute.weighted },
    { label: 'VIX', value: components.vix.impact, extra: components.vix.value > 0 ? `${components.vix.value.toFixed(1)}` : undefined },
    { label: '温度', value: components.temperature.impact, extra: components.temperature.value > 0 ? `${components.temperature.value.toFixed(0)}` : undefined },
  ]

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 4 : 6, marginTop: 12 }}>
      {items.map(item => (
        <Tooltip key={item.label} title={item.extra ? `${item.label}: ${item.extra}` : item.label}>
          <span
            className="monitor-score-badge"
            style={{ color: scoreColor(item.value * 5) }}
          >
            <span style={{ color: COLORS.textSecondary, fontSize: 11 }}>{item.label}</span>
            {item.value > 0 ? '+' : ''}{item.value.toFixed(1)}
          </span>
        </Tooltip>
      ))}
      {components.gap.score !== 0 && (
        <span className="monitor-score-badge" style={{ color: scoreColor(components.gap.score * 5) }}>
          <span style={{ color: COLORS.textSecondary, fontSize: 11 }}>Gap</span>
          {components.gap.score > 0 ? '+' : ''}{components.gap.score.toFixed(1)}
        </span>
      )}
    </div>
  )
}

function StrategyCard({ strategy, isMobile }: { strategy: StrategyOverview; isMobile: boolean }) {
  const { summary } = strategy

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: COLORS.text }}>{strategy.strategyName}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {summary.holding > 0 && <span style={{ fontSize: 12, color: COLORS.accent }}>持仓 {summary.holding}</span>}
          {summary.cooldown > 0 && <span style={{ fontSize: 12, color: '#718096' }}>冷却 {summary.cooldown}</span>}
          <span className="monitor-number" style={{ fontSize: 13, color: pnlColor(strategy.todayPnl) }}>
            {strategy.todayPnl > 0 ? '+' : ''}{strategy.todayPnl !== 0 ? `$${strategy.todayPnl.toFixed(2)}` : '--'}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {strategy.instances.map(inst => (
          <Tooltip
            key={inst.symbol}
            title={
              inst.state === 'HOLDING'
                ? `入场: $${inst.entryPrice?.toFixed(2) || '--'} | 止损: $${inst.stopLoss?.toFixed(2) || '--'} | 止盈: $${inst.takeProfit?.toFixed(2) || '--'}`
                : inst.state === 'COOLDOWN' && inst.cooldownUntil
                  ? `冷却至 ${dayjs(inst.cooldownUntil).format('HH:mm:ss')}`
                  : undefined
            }
          >
            <span className="monitor-badge" style={{ borderColor: `${stateColor(inst.state)}40` }}>
              <span style={{ color: COLORS.text, fontSize: isMobile ? 12 : 13 }}>{inst.symbol.replace('.US', '')}</span>
              <span style={{ color: stateColor(inst.state), fontSize: 11, fontWeight: 600 }}>{inst.state}</span>
              {inst.state === 'HOLDING' && inst.unrealizedPnl != null && (
                <span className="monitor-number" style={{ fontSize: 11, color: pnlColor(inst.unrealizedPnl) }}>
                  {inst.unrealizedPnl > 0 ? '+' : ''}{`$${inst.unrealizedPnl.toFixed(2)}`}
                </span>
              )}
            </span>
          </Tooltip>
        ))}
        {strategy.instances.length === 0 && (
          <span style={{ color: COLORS.textSecondary, fontSize: 12 }}>无实例</span>
        )}
      </div>
    </div>
  )
}

function SignalFeed({ signals, isMobile }: { signals: Signal[]; isMobile: boolean }) {
  if (signals.length === 0) {
    return <Empty description="暂无信号" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  }

  return (
    <div className="monitor-signal-feed">
      {signals.map(sig => {
        const meta = sig.metadata || {}
        const finalScore = Number(meta.finalScore)
        const direction = String(meta.optionDirection || sig.signal_type || '')
        const isEntry = sig.signal_type === 'ENTRY' || sig.signal_type === 'BUY'
        const isExit = sig.signal_type === 'EXIT' || sig.signal_type === 'SELL'

        return (
          <div key={sig.id} className="monitor-signal-item">
            <span className="monitor-number" style={{ color: COLORS.textSecondary, fontSize: 12, minWidth: isMobile ? 40 : 48 }}>
              {dayjs(sig.created_at).format('HH:mm')}
            </span>
            <span style={{ color: COLORS.text, fontSize: 13, minWidth: isMobile ? 50 : 70 }}>
              {sig.symbol.replace('.US', '')}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: 3,
                background: isEntry ? 'rgba(0, 255, 136, 0.12)' : isExit ? 'rgba(255, 71, 87, 0.12)' : 'rgba(255, 255, 255, 0.06)',
                color: isEntry ? COLORS.positive : isExit ? COLORS.negative : COLORS.textSecondary,
              }}
            >
              {direction || sig.signal_type}
            </span>
            {!isNaN(finalScore) && (
              <span className="monitor-number" style={{ fontSize: 12, color: scoreColor(finalScore) }}>
                {finalScore > 0 ? '+' : ''}{finalScore.toFixed(0)}
              </span>
            )}
            <span style={{ fontSize: 11, color: sig.status === 'EXECUTED' ? COLORS.positive : sig.status === 'REJECTED' ? COLORS.negative : COLORS.textSecondary, marginLeft: 'auto' }}>
              {sig.status === 'EXECUTED' ? 'OK' : sig.status === 'REJECTED' ? 'REJ' : sig.status?.slice(0, 3)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ============================================
// Main Page
// ============================================

export default function MonitorPage() {
  const isMobile = useIsMobile()

  // State
  const [marketScore, setMarketScore] = useState<MarketScoreData | null>(null)
  const [scoreHistory, setScoreHistory] = useState<ScoreHistoryPoint[]>([])
  const [strategies, setStrategies] = useState<StrategyOverview[]>([])
  const [signals, setSignals] = useState<Signal[]>([])
  const [dashboardStats, setDashboardStats] = useState<{ todayPnl?: number; closedTradesPnl?: number; holdingPnl?: number; todayTrades?: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Fetch market score
  const fetchMarketScore = useCallback(async () => {
    try {
      const res = await quantApi.getMonitorMarketScore()
      if (res.success && res.data) {
        setMarketScore(res.data)
        setScoreHistory(prev => {
          const next = [...prev, { time: res.data!.timestamp, score: res.data!.finalScore, label: res.data!.scoreLabel }]
          return next.length > 240 ? next.slice(-240) : next
        })
        setErrors(prev => { const { score, ...rest } = prev; return rest })
      }
    } catch (err: unknown) {
      setErrors(prev => ({ ...prev, score: err instanceof Error ? err.message : '评分获取失败' }))
    }
  }, [])

  // Fetch strategies overview
  const fetchStrategies = useCallback(async () => {
    try {
      const res = await quantApi.getMonitorStrategiesOverview()
      if (res.success && res.data) {
        setStrategies(res.data)
      }
    } catch {
      // silent
    }
  }, [])

  // Fetch signals + stats
  const fetchSignalsAndStats = useCallback(async () => {
    try {
      const [sigRes, statsRes] = await Promise.all([
        quantApi.getSignals({ limit: 20 }),
        quantApi.getDashboardStats() as Promise<{ success?: boolean; data?: Record<string, unknown> }>,
      ])
      if (sigRes.success) setSignals((sigRes.data as Signal[]) || [])
      const stats = statsRes as { success?: boolean; data?: Record<string, unknown> }
      if (stats.success && stats.data) setDashboardStats(stats.data as { todayPnl?: number; closedTradesPnl?: number; holdingPnl?: number; todayTrades?: number })
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  // Polling intervals
  useEffect(() => {
    fetchMarketScore()
    const id = setInterval(fetchMarketScore, 30000)
    return () => clearInterval(id)
  }, [fetchMarketScore])

  useEffect(() => {
    fetchStrategies()
    const id = setInterval(fetchStrategies, 10000)
    return () => clearInterval(id)
  }, [fetchStrategies])

  useEffect(() => {
    fetchSignalsAndStats()
    const id = setInterval(fetchSignalsAndStats, 30000)
    return () => clearInterval(id)
  }, [fetchSignalsAndStats])

  // Aggregate P&L across strategies
  const totalTodayPnl = strategies.reduce((sum, s) => sum + s.todayPnl, 0)
  const totalTodayTrades = strategies.reduce((sum, s) => sum + s.todayTrades, 0)
  const holdingPnl = Number(dashboardStats?.holdingPnl || 0)

  return (
    <AppLayout>
      <div className="monitor-page-wrapper">
        <div className="monitor-page">
          <div style={{ display: 'grid', gap: 16 }}>

            {/* Section 1: Market Score */}
            <div className="monitor-card">
              <div className="monitor-card-title">
                <span className="monitor-live-dot" />
                <span>市场评分</span>
                {marketScore && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: COLORS.textSecondary }}>
                    {dayjs(marketScore.timestamp).format('HH:mm:ss')}
                  </span>
                )}
              </div>

              {marketScore ? (
                <>
                  <div style={{ display: 'flex', gap: 16, flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'flex-start' }}>
                    {/* Left: Gauge + Labels */}
                    <div style={{ flex: '0 0 auto', width: isMobile ? '100%' : 220, textAlign: 'center' }}>
                      <ScoreGauge score={marketScore.finalScore} />

                      {/* Score label */}
                      <div className="monitor-score-label" style={{ color: scoreColor(marketScore.finalScore), marginTop: 4 }}>
                        {marketScore.scoreLabel}
                      </div>

                      {/* Direction + confidence */}
                      <div style={{ marginTop: 8, fontSize: 13, color: COLORS.textSecondary }}>
                        <span style={{
                          color: marketScore.direction === 'CALL' ? COLORS.positive : marketScore.direction === 'PUT' ? COLORS.negative : COLORS.neutral,
                          fontWeight: 600, fontSize: 14,
                        }}>
                          {marketScore.direction}
                        </span>
                        <span style={{ marginLeft: 8 }}>置信 {marketScore.confidence}%</span>
                      </div>

                      {/* Regime */}
                      <div style={{ marginTop: 10 }}>
                        <span className="monitor-regime-tag">
                          {marketScore.regime.label}
                          <span style={{ fontSize: 10, opacity: 0.7 }}>({marketScore.regime.confidence})</span>
                        </span>
                      </div>

                      {/* Suitable strategies */}
                      <div style={{ marginTop: 8 }}>
                        {marketScore.suitableStrategies.map(s => (
                          <span key={s} className="monitor-strategy-tag">{s}</span>
                        ))}
                      </div>

                      {/* Sub-scores */}
                      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', gap: 12, fontSize: 11 }}>
                        <div>
                          <div style={{ color: COLORS.textSecondary }}>大盘</div>
                          <div className="monitor-number" style={{ color: scoreColor(marketScore.marketScore) }}>
                            {marketScore.marketScore > 0 ? '+' : ''}{marketScore.marketScore.toFixed(1)}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: COLORS.textSecondary }}>日内</div>
                          <div className="monitor-number" style={{ color: scoreColor(marketScore.intradayScore) }}>
                            {marketScore.intradayScore > 0 ? '+' : ''}{marketScore.intradayScore.toFixed(1)}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: COLORS.textSecondary }}>时间</div>
                          <div className="monitor-number" style={{ color: scoreColor(marketScore.timeWindowScore) }}>
                            {marketScore.timeWindowScore > 0 ? '+' : ''}{marketScore.timeWindowScore.toFixed(1)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right: Trend Chart */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <ScoreTrendChart data={scoreHistory} isMobile={isMobile} />
                    </div>
                  </div>

                  {/* Component badges */}
                  <ComponentBadges components={marketScore.marketComponents} isMobile={isMobile} />
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: COLORS.textSecondary }}>
                  {errors.score ? `错误: ${errors.score}` : '加载中...'}
                </div>
              )}
            </div>

            {/* Section 2: Strategy Overview */}
            <div className="monitor-card">
              <div className="monitor-card-title">
                <span className="monitor-live-dot" />
                <span>策略状态</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: COLORS.textSecondary }}>
                  {strategies.length} 个运行中
                </span>
              </div>

              {strategies.length > 0 ? (
                strategies.map(s => <StrategyCard key={s.strategyId} strategy={s} isMobile={isMobile} />)
              ) : (
                <div style={{ color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', padding: 20 }}>
                  {loading ? '加载中...' : '无运行中的策略'}
                </div>
              )}
            </div>

            {/* Sections 3+4: Signal Feed + P&L */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>

              {/* Signal Feed */}
              <div className="monitor-card">
                <div className="monitor-card-title">
                  <span className="monitor-live-dot" />
                  <span>信号流</span>
                </div>
                <SignalFeed signals={signals} isMobile={isMobile} />
              </div>

              {/* P&L Summary */}
              <div className="monitor-card">
                <div className="monitor-card-title">
                  <span className="monitor-live-dot" />
                  <span>今日 P&L</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Statistic
                    title="已实现"
                    value={totalTodayPnl}
                    precision={2}
                    prefix="$"
                    valueStyle={{ color: pnlColor(totalTodayPnl), fontSize: isMobile ? 18 : 22, fontFamily: "'SF Mono', monospace" }}
                  />
                  <Statistic
                    title="未实现"
                    value={holdingPnl}
                    precision={2}
                    prefix="$"
                    valueStyle={{ color: pnlColor(holdingPnl), fontSize: isMobile ? 18 : 22, fontFamily: "'SF Mono', monospace" }}
                  />
                  <Statistic
                    title="总计"
                    value={totalTodayPnl + holdingPnl}
                    precision={2}
                    prefix="$"
                    valueStyle={{ color: pnlColor(totalTodayPnl + holdingPnl), fontSize: isMobile ? 20 : 26, fontWeight: 700, fontFamily: "'SF Mono', monospace" }}
                  />
                  <Statistic
                    title="交易笔数"
                    value={totalTodayTrades}
                    valueStyle={{ color: COLORS.text, fontSize: isMobile ? 18 : 22, fontFamily: "'SF Mono', monospace" }}
                  />
                </div>

                {/* Per-strategy breakdown */}
                {strategies.filter(s => s.todayPnl !== 0 || s.todayTrades > 0).length > 0 && (
                  <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
                    <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 8 }}>分策略明细</div>
                    {strategies.filter(s => s.todayPnl !== 0 || s.todayTrades > 0).map(s => (
                      <div key={s.strategyId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
                        <span style={{ color: COLORS.text }}>{s.strategyName}</span>
                        <span className="monitor-number" style={{ color: pnlColor(s.todayPnl) }}>
                          {s.todayPnl > 0 ? '+' : ''}${s.todayPnl.toFixed(2)} ({s.todayTrades}笔)
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </AppLayout>
  )
}
