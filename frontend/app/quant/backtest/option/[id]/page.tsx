'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { optionBacktestApi } from '@/lib/api';
import AppLayout from '@/components/AppLayout';
import { Card, Table, Tag, Space, Button, Alert, Spin, Row, Col, Statistic } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useIsMobile } from '@/hooks/useIsMobile';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface OptionBacktestTrade {
  date: string;
  symbol: string;
  optionSymbol: string;
  direction: 'CALL' | 'PUT';
  entryTime: string;
  exitTime: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  grossPnL: number;
  netPnL: number;
  grossPnLPercent: number;
  netPnLPercent: number;
  entryReason: string;
  exitReason: string | null;
  exitTag?: string;
  entryScore: number;
  marketScore: number;
  intradayScore: number;
  timeWindowAdjustment: number;
  holdingMinutes: number;
  peakPnLPercent: number;
}

interface OptionBacktestResult {
  id: number;
  status: string;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  dates: string[];
  symbols: string[];
  trades: OptionBacktestTrade[];
  summary: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalGrossPnL: number;
    totalNetPnL: number;
    avgGrossPnLPercent: number;
    maxDrawdownPercent: number;
    avgHoldingMinutes: number;
    profitFactor: number;
  };
  diagnosticLog?: {
    dataFetch: Array<{ source: string; date: string; count: number; ok: boolean; error?: string }>;
    signals: Array<{
      date: string;
      time: string;
      score: number;
      marketScore: number;
      intradayScore: number;
      direction: string;
      action: string;
    }>;
  };
}

export default function OptionBacktestDetailPage() {
  const isMobile = useIsMobile();
  const params = useParams();
  const router = useRouter();
  const backtestId = parseInt(params.id as string);

  const [result, setResult] = useState<OptionBacktestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (backtestId) loadData();
  }, [backtestId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await optionBacktestApi.getResult(backtestId);
      if (res.success && res.data) {
        setResult(res.data);
      } else {
        setError('期权回测结果不存在');
      }
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('zh-CN', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <Card>
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>加载中...</div>
          </div>
        </Card>
      </AppLayout>
    );
  }

  if (error || !result) {
    return (
      <AppLayout>
        <Alert message={error || '回测结果不存在'} type="error" showIcon />
      </AppLayout>
    );
  }

  const { summary, trades, diagnosticLog } = result;

  // 逐笔交易表格列
  const tradeColumns = [
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      width: 100,
    },
    {
      title: '方向',
      dataIndex: 'direction',
      key: 'direction',
      width: 70,
      render: (dir: string) => (
        <Tag color={dir === 'CALL' ? 'green' : 'red'}>{dir}</Tag>
      ),
    },
    {
      title: '期权合约',
      dataIndex: 'optionSymbol',
      key: 'optionSymbol',
      render: (text: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{text}</span>,
    },
    {
      title: '入场时间 (ET)',
      dataIndex: 'entryTime',
      key: 'entryTime',
      width: 100,
      render: (text: string) => formatTime(text),
    },
    {
      title: '退出时间 (ET)',
      dataIndex: 'exitTime',
      key: 'exitTime',
      width: 100,
      render: (text: string | null) => text ? formatTime(text) : '-',
    },
    {
      title: '入场价',
      dataIndex: 'entryPrice',
      key: 'entryPrice',
      width: 90,
      render: (p: number) => `$${p.toFixed(2)}`,
    },
    {
      title: '退出价',
      dataIndex: 'exitPrice',
      key: 'exitPrice',
      width: 90,
      render: (p: number | null) => p != null ? `$${p.toFixed(2)}` : '-',
    },
    {
      title: 'PnL',
      key: 'pnl',
      width: 140,
      render: (_: unknown, record: OptionBacktestTrade) => (
        <div style={{ fontWeight: 600 }}>
          <span style={{ color: record.grossPnL >= 0 ? '#52c41a' : '#ff4d4f' }}>
            ${record.grossPnL.toFixed(2)}
          </span>
          <span style={{ color: record.grossPnLPercent >= 0 ? '#52c41a' : '#ff4d4f', marginLeft: 4, fontSize: 12 }}>
            ({record.grossPnLPercent >= 0 ? '+' : ''}{record.grossPnLPercent.toFixed(1)}%)
          </span>
        </div>
      ),
    },
    {
      title: '持仓(分)',
      dataIndex: 'holdingMinutes',
      key: 'holdingMinutes',
      width: 80,
    },
    {
      title: '评分',
      key: 'scores',
      width: 100,
      render: (_: unknown, record: OptionBacktestTrade) => (
        <span style={{ fontSize: 12, fontFamily: 'monospace' }}>
          {record.entryScore.toFixed(1)}
        </span>
      ),
    },
    {
      title: '退出原因',
      dataIndex: 'exitReason',
      key: 'exitReason',
      ellipsis: true,
      render: (text: string | null) => {
        if (!text) return '-';
        // 提取退出标签
        const match = text.match(/^(\w+):/);
        const tag = match ? match[1] : text;
        let color = 'default';
        if (tag.includes('TAKE_PROFIT')) color = 'green';
        else if (tag.includes('STOP_LOSS')) color = 'red';
        else if (tag.includes('TRAILING')) color = 'orange';
        else if (tag.includes('TIME_STOP') || tag.includes('MARKET_CLOSE') || tag.includes('FORCE')) color = 'purple';
        return <Tag color={color} style={{ fontSize: 11 }}>{tag}</Tag>;
      },
    },
  ];

  // PnL 柱状图数据
  const pnlChartData = trades.map((t, i) => ({
    name: `#${i + 1}`,
    pnl: t.grossPnLPercent,
    label: `${t.optionSymbol} ${t.direction}`,
  }));

  // 数据获取诊断表格列
  const dataFetchColumns = [
    { title: '数据源', dataIndex: 'source', key: 'source' },
    { title: '日期', dataIndex: 'date', key: 'date' },
    {
      title: '状态',
      key: 'ok',
      render: (_: unknown, record: { ok: boolean }) => (
        <Tag color={record.ok ? 'success' : 'error'}>{record.ok ? '成功' : '失败'}</Tag>
      ),
    },
    { title: '数据条数', dataIndex: 'count', key: 'count' },
    {
      title: '错误',
      dataIndex: 'error',
      key: 'error',
      render: (text: string | undefined) => text || '-',
    },
  ];

  // 信号日志表格列
  const signalColumns = [
    { title: '日期', dataIndex: 'date', key: 'date', width: 100 },
    { title: '时间', dataIndex: 'time', key: 'time', width: 70 },
    {
      title: '方向',
      dataIndex: 'direction',
      key: 'direction',
      width: 70,
      render: (dir: string) => {
        let color = 'default';
        if (dir === 'CALL') color = 'green';
        else if (dir === 'PUT') color = 'red';
        return <Tag color={color}>{dir}</Tag>;
      },
    },
    {
      title: '综合评分',
      dataIndex: 'score',
      key: 'score',
      width: 90,
      render: (score: number) => (
        <span style={{ color: score >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
          {score >= 0 ? '+' : ''}{score.toFixed(1)}
        </span>
      ),
    },
    {
      title: '市场分',
      dataIndex: 'marketScore',
      key: 'marketScore',
      width: 80,
      render: (s: number) => s.toFixed(1),
    },
    {
      title: '分时分',
      dataIndex: 'intradayScore',
      key: 'intradayScore',
      width: 80,
      render: (s: number) => s.toFixed(1),
    },
    {
      title: '动作',
      dataIndex: 'action',
      key: 'action',
      render: (action: string) => {
        let color = 'default';
        if (action === 'ENTRY') color = 'blue';
        else if (action.startsWith('SKIP')) color = 'orange';
        return <Tag color={color}>{action}</Tag>;
      },
    },
  ];

  return (
    <AppLayout>
      <Card>
        {/* 头部 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 24 }}>
          <div>
            <div style={{ marginBottom: 8 }}>
              <Button
                type="text"
                icon={<ArrowLeftOutlined />}
                onClick={() => router.push('/quant/backtest')}
                style={{ padding: 0, color: '#1890ff' }}
              >
                返回回测列表
              </Button>
            </div>
            <h1 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 600, marginBottom: 8 }}>
              期权回测详情 #{result.id}
            </h1>
            <Space>
              <span style={{ color: '#666' }}>日期: {result.dates.join(', ')}</span>
              <span style={{ color: '#666' }}>标的: {result.symbols.join(', ')}</span>
            </Space>
          </div>
        </div>

        {/* 汇总指标 */}
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={12} sm={8} lg={4}>
            <Card>
              <Statistic
                title="总交易"
                value={summary.totalTrades}
                valueStyle={{ fontSize: 24, fontWeight: 600 }}
              />
              <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                {summary.winningTrades} 胜 / {summary.losingTrades} 负
              </div>
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card>
              <Statistic
                title="胜率"
                value={summary.winRate}
                suffix="%"
                valueStyle={{ fontSize: 24, fontWeight: 600 }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card>
              <Statistic
                title="总净 PnL"
                value={summary.totalNetPnL}
                prefix="$"
                valueStyle={{
                  fontSize: 24,
                  fontWeight: 600,
                  color: summary.totalNetPnL >= 0 ? '#52c41a' : '#ff4d4f',
                }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card>
              <Statistic
                title="平均 PnL%"
                value={summary.avgGrossPnLPercent}
                suffix="%"
                prefix={summary.avgGrossPnLPercent >= 0 ? '+' : ''}
                valueStyle={{
                  fontSize: 24,
                  fontWeight: 600,
                  color: summary.avgGrossPnLPercent >= 0 ? '#52c41a' : '#ff4d4f',
                }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card>
              <Statistic
                title="最大回撤"
                value={summary.maxDrawdownPercent}
                suffix="%"
                valueStyle={{
                  fontSize: 24,
                  fontWeight: 600,
                  color: '#ff4d4f',
                }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card>
              <Statistic
                title="盈利因子"
                value={summary.profitFactor}
                valueStyle={{ fontSize: 24, fontWeight: 600 }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card>
              <Statistic
                title="平均持仓"
                value={summary.avgHoldingMinutes}
                suffix="分钟"
                valueStyle={{ fontSize: 24, fontWeight: 600 }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} lg={4}>
            <Card>
              <Statistic
                title="总毛利 PnL"
                value={summary.totalGrossPnL}
                prefix="$"
                valueStyle={{
                  fontSize: 24,
                  fontWeight: 600,
                  color: summary.totalGrossPnL >= 0 ? '#52c41a' : '#ff4d4f',
                }}
              />
            </Card>
          </Col>
        </Row>

        {/* 逐笔 PnL 柱状图 */}
        {pnlChartData.length > 0 && (
          <Card style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>逐笔 PnL%</h2>
            <ResponsiveContainer width="100%" height={isMobile ? 200 : 300}>
              <BarChart data={pnlChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                <Tooltip
                  formatter={(value: number, _name: string, props: any) => [
                    `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`,
                    props?.payload?.label || '',
                  ]}
                />
                <Legend />
                <Bar dataKey="pnl" name="PnL%" radius={[4, 4, 0, 0]}>
                  {pnlChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#52c41a' : '#ff4d4f'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* 交易明细 */}
        <Card style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
            交易明细 ({trades.length})
          </h2>
          <Table
            dataSource={trades}
            columns={tradeColumns}
            rowKey={(_, index) => `trade-${index}`}
            scroll={{ x: 1200 }}
            locale={{ emptyText: '无交易记录' }}
            size="small"
          />
        </Card>

        {/* 数据获取诊断 */}
        {diagnosticLog && diagnosticLog.dataFetch && diagnosticLog.dataFetch.length > 0 && (
          <Card style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>数据获取诊断</h2>
            <Table
              dataSource={diagnosticLog.dataFetch}
              columns={dataFetchColumns}
              rowKey={(_, index) => `df-${index}`}
              pagination={false}
              size="small"
            />
          </Card>
        )}

        {/* 信号日志 */}
        {diagnosticLog && diagnosticLog.signals && diagnosticLog.signals.length > 0 && (
          <Card>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
              信号日志 ({diagnosticLog.signals.length})
            </h2>
            <Table
              dataSource={diagnosticLog.signals}
              columns={signalColumns}
              rowKey={(_, index) => `sig-${index}`}
              size="small"
              scroll={{ x: 700 }}
            />
          </Card>
        )}
      </Card>
    </AppLayout>
  );
}
