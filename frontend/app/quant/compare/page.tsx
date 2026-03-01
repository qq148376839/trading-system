'use client';

import { useState, useEffect } from 'react';
import { quantApi } from '@/lib/api';
import AppLayout from '@/components/AppLayout';
import { Card, Row, Col, Statistic, Table, Tag, Spin, Radio } from 'antd';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface StrategyStats {
  strategyId: number;
  strategyName: string;
  strategyType: string;
  todayPnl: number;
  todayTrades: number;
  todayWinRate: number;
  weekPnl: number;
  weekTrades: number;
  weekWinRate: number;
  avgPnlPerTrade: number;
  maxDrawdown: number;
}

interface DayData {
  date: string;
  strategies: Array<{
    strategyId: number;
    strategyName: string;
    pnl: number;
    trades: number;
    winRate: number;
  }>;
}

const COLORS = ['#1890ff', '#52c41a', '#faad14', '#ff4d4f', '#722ed1', '#13c2c2'];

export default function StrategyComparePage() {
  const [period, setPeriod] = useState<string>('7d');
  const [strategies, setStrategies] = useState<StrategyStats[]>([]);
  const [series, setSeries] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [period]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [compRes, detailRes] = await Promise.all([
        quantApi.getStrategyComparison(),
        quantApi.getStrategyComparisonDetail(period),
      ]);

      if (compRes.success && compRes.data?.strategies) {
        setStrategies(compRes.data.strategies);
      }
      if (detailRes.success && detailRes.data?.series) {
        setSeries(detailRes.data.series);
      }
    } catch (error) {
      console.error('加载对比数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // Build chart data: cumulative PnL per strategy
  const chartData = (() => {
    if (!series.length || !strategies.length) return [];

    const cumPnl: Record<number, number> = {};
    strategies.forEach(s => { cumPnl[s.strategyId] = 0; });

    return series.map(day => {
      const point: Record<string, any> = { date: day.date };
      for (const s of day.strategies) {
        cumPnl[s.strategyId] = (cumPnl[s.strategyId] || 0) + s.pnl;
      }
      strategies.forEach(s => {
        point[`pnl_${s.strategyId}`] = Number((cumPnl[s.strategyId] || 0).toFixed(2));
      });
      return point;
    });
  })();

  // Build table data: daily detail
  const tableData = series.map(day => {
    const row: Record<string, any> = { date: day.date, key: day.date };
    for (const s of day.strategies) {
      row[`pnl_${s.strategyId}`] = s.pnl;
      row[`trades_${s.strategyId}`] = s.trades;
      row[`winRate_${s.strategyId}`] = s.winRate;
    }
    return row;
  }).reverse(); // newest first

  const tableColumns: any[] = [
    { title: '日期', dataIndex: 'date', key: 'date', width: 120, fixed: 'left' as const },
    ...strategies.map((s, i) => ({
      title: s.strategyName,
      children: [
        {
          title: 'PnL',
          dataIndex: `pnl_${s.strategyId}`,
          key: `pnl_${s.strategyId}`,
          width: 100,
          render: (v: number) => v !== undefined ? (
            <span style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f' }}>
              ${v?.toFixed(2) || '0.00'}
            </span>
          ) : '-',
        },
        {
          title: '交易',
          dataIndex: `trades_${s.strategyId}`,
          key: `trades_${s.strategyId}`,
          width: 60,
          render: (v: number) => v ?? '-',
        },
        {
          title: '胜率',
          dataIndex: `winRate_${s.strategyId}`,
          key: `winRate_${s.strategyId}`,
          width: 70,
          render: (v: number) => v !== undefined ? `${v}%` : '-',
        },
      ],
    })),
  ];

  const getTypeLabel = (type: string) => {
    if (type === 'OPTION_SCHWARTZ_V1') return 'Schwartz';
    if (type === 'OPTION_INTRADAY_V1') return 'Momentum';
    if (type === 'RECOMMENDATION_V1') return '推荐';
    return type;
  };

  if (loading) {
    return (
      <AppLayout>
        <Card>
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>加载对比数据...</div>
          </div>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>策略对比分析</h1>
          <Radio.Group value={period} onChange={(e) => setPeriod(e.target.value)} buttonStyle="solid" size="small">
            <Radio.Button value="7d">7天</Radio.Button>
            <Radio.Button value="30d">30天</Radio.Button>
            <Radio.Button value="90d">90天</Radio.Button>
          </Radio.Group>
        </div>

        {strategies.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            暂无运行中的策略数据
          </div>
        ) : (
          <>
            {/* Strategy stat cards */}
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              {strategies.map((s, i) => (
                <Col xs={24} sm={12} md={Math.min(12, Math.floor(24 / strategies.length))} key={s.strategyId}>
                  <Card
                    size="small"
                    style={{ borderTop: `3px solid ${COLORS[i % COLORS.length]}` }}
                  >
                    <div style={{ marginBottom: 12 }}>
                      <Tag color={s.strategyType === 'OPTION_SCHWARTZ_V1' ? 'green' : 'blue'}>
                        {getTypeLabel(s.strategyType)}
                      </Tag>
                      <span style={{ fontWeight: 600 }}>{s.strategyName}</span>
                    </div>
                    <Row gutter={[8, 12]}>
                      <Col xs={12} sm={8}>
                        <Statistic
                          title={`${period === '7d' ? '周' : period === '30d' ? '月' : '季'} PnL`}
                          value={s.weekPnl}
                          precision={2}
                          prefix="$"
                          valueStyle={{ fontSize: 18, color: s.weekPnl >= 0 ? '#52c41a' : '#ff4d4f' }}
                        />
                      </Col>
                      <Col xs={12} sm={8}>
                        <Statistic
                          title="交易"
                          value={s.weekTrades}
                          suffix="笔"
                          valueStyle={{ fontSize: 18 }}
                        />
                      </Col>
                      <Col xs={12} sm={8}>
                        <Statistic
                          title="胜率"
                          value={s.weekWinRate}
                          suffix="%"
                          valueStyle={{ fontSize: 18 }}
                        />
                      </Col>
                      <Col xs={12} sm={8}>
                        <Statistic
                          title="均笔盈亏"
                          value={s.avgPnlPerTrade}
                          precision={2}
                          prefix="$"
                          valueStyle={{ fontSize: 14, color: s.avgPnlPerTrade >= 0 ? '#52c41a' : '#ff4d4f' }}
                        />
                      </Col>
                      <Col xs={12} sm={8}>
                        <Statistic
                          title="最大单笔亏损"
                          value={s.maxDrawdown}
                          precision={2}
                          prefix="$"
                          valueStyle={{ fontSize: 14, color: '#ff4d4f' }}
                        />
                      </Col>
                      <Col xs={12} sm={8}>
                        <Statistic
                          title="今日 PnL"
                          value={s.todayPnl}
                          precision={2}
                          prefix="$"
                          valueStyle={{ fontSize: 14, color: s.todayPnl >= 0 ? '#52c41a' : '#ff4d4f' }}
                        />
                      </Col>
                    </Row>
                  </Card>
                </Col>
              ))}
            </Row>

            {/* PnL chart */}
            {chartData.length > 0 && (
              <Card size="small" style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>累计 PnL 走势</h3>
                <div style={{ width: '100%', overflowX: 'auto' }}>
                  <div style={{ minWidth: 400 }}>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                        <Tooltip formatter={(value: number) => [`$${value.toFixed(2)}`, '']} />
                        <Legend />
                        {strategies.map((s, i) => (
                          <Line
                            key={s.strategyId}
                            type="monotone"
                            dataKey={`pnl_${s.strategyId}`}
                            name={s.strategyName}
                            stroke={COLORS[i % COLORS.length]}
                            strokeWidth={2}
                            dot={{ r: 3 }}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </Card>
            )}

            {/* Daily detail table */}
            {tableData.length > 0 && (
              <Card size="small">
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>每日明细</h3>
                <div style={{ overflowX: 'auto' }}>
                  <Table
                    dataSource={tableData}
                    columns={tableColumns}
                    pagination={{ pageSize: 15, showSizeChanger: false }}
                    size="small"
                    scroll={{ x: 'max-content' }}
                    bordered
                  />
                </div>
              </Card>
            )}
          </>
        )}
      </Card>
    </AppLayout>
  );
}
