'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { backtestApi, quantApi } from '@/lib/api';
import AppLayout from '@/components/AppLayout';
import { Card, Table, Tag, Space, Button, Alert, Spin, Row, Col, Statistic, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useIsMobile } from '@/hooks/useIsMobile';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts';

interface BacktestTrade {
  symbol: string;
  entryDate: string;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  entryReason: string;
  exitReason: string | null;
}

interface DiagnosticLog {
  dataFetch: Array<{ symbol: string; success: boolean; count: number; error?: string }>;
  signalGeneration: Array<{ date: string; symbol: string; signal: string | null; error?: string }>;
  buyAttempts: Array<{ date: string; symbol: string; success: boolean; reason: string; details?: any }>;
  summary: {
    totalDates: number;
    totalSignals: number;
    totalBuyAttempts: number;
    totalBuySuccess: number;
    buyRejectReasons: Record<string, number>;
  };
}

interface BacktestResult {
  id: number;
  strategyId: number;
  startDate: string;
  endDate: string;
  totalReturn: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  avgHoldingTime: number;
  trades: BacktestTrade[];
  dailyReturns: Array<{ date: string; return: number; equity: number }>;
  diagnosticLog?: DiagnosticLog;
}

interface Strategy {
  id: number;
  name: string;
  type: string;
}

export default function BacktestDetailPage() {
  const isMobile = useIsMobile();
  const params = useParams();
  const router = useRouter();
  const backtestId = parseInt(params.id as string);

  const [result, setResult] = useState<BacktestResult | null>(null);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (backtestId) {
      loadData();
    }
  }, [backtestId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const resultRes = await backtestApi.getBacktestResult(backtestId);
      
      if (resultRes.success && resultRes.data) {
        setResult(resultRes.data);
        
        // 加载策略信息
        try {
          const strategyRes = await quantApi.getStrategy(resultRes.data.strategyId);
          if (strategyRes.success && strategyRes.data) {
            setStrategy(strategyRes.data);
          }
        } catch (err) {
          // 忽略策略加载错误
        }
      } else {
        setError('回测结果不存在');
      }
    } catch (err: any) {
      setError(err.message || '加载回测结果失败');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  const handleExport = async () => {
    if (!result) {
      message.error('回测结果不存在，无法导出');
      return;
    }
    
    try {
      const blob = await backtestApi.exportBacktest(backtestId);
      
      // 创建下载链接
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // 生成文件名
      const filename = `backtest_${result.strategyId}_${result.startDate}_${result.endDate}_${result.id}.json`;
      link.download = filename;
      
      // 触发下载
      document.body.appendChild(link);
      link.click();
      
      // 清理
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      message.success('导出成功');
    } catch (err: any) {
      message.error('导出失败: ' + (err.message || '未知错误'));
    }
  };

  const tradeColumns = [
    {
      title: '标的',
      key: 'symbol',
      dataIndex: 'symbol',
      render: (text: string) => <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{text}</span>,
    },
    {
      title: '买入日期',
      key: 'entryDate',
      dataIndex: 'entryDate',
      render: (text: string) => formatDate(text),
    },
    {
      title: '卖出日期',
      key: 'exitDate',
      dataIndex: 'exitDate',
      render: (text: string | null) => text ? formatDate(text) : '-',
    },
    {
      title: '买入价',
      key: 'entryPrice',
      dataIndex: 'entryPrice',
      render: (price: number) => `$${price.toFixed(2)}`,
    },
    {
      title: '卖出价',
      key: 'exitPrice',
      dataIndex: 'exitPrice',
      render: (price: number | null) => price ? `$${price.toFixed(2)}` : '-',
    },
    {
      title: '数量',
      key: 'quantity',
      dataIndex: 'quantity',
    },
    {
      title: '盈亏',
      key: 'pnl',
      render: (_: any, record: BacktestTrade) => (
        <div style={{ color: record.pnl >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
          ${record.pnl.toFixed(2)} ({record.pnlPercent >= 0 ? '+' : ''}{record.pnlPercent.toFixed(2)}%)
        </div>
      ),
    },
    {
      title: '卖出原因',
      key: 'exitReason',
      dataIndex: 'exitReason',
      render: (text: string | null) => text || '-',
    },
  ];

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
        <Alert
          message={error || '回测结果不存在'}
          type="error"
          showIcon
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 600, marginBottom: 8 }}>回测结果详情</h1>
            {strategy && (
              <div style={{ color: '#666', marginBottom: 4 }}>
                策略: {strategy.name} ({strategy.type})
              </div>
            )}
            <div style={{ color: '#666' }}>
              时间范围: {formatDate(result.startDate)} ~ {formatDate(result.endDate)}
            </div>
          </div>
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}>
            导出JSON
          </Button>
        </div>

        {/* 性能指标卡片 */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="总收益率"
                value={result.totalReturn.toFixed(2)}
                suffix="%"
                prefix={result.totalReturn >= 0 ? '+' : ''}
                valueStyle={{
                  color: result.totalReturn >= 0 ? '#52c41a' : '#ff4d4f',
                  fontSize: 24,
                  fontWeight: 600,
                }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="总交易次数"
                value={result.totalTrades}
                valueStyle={{ fontSize: 24, fontWeight: 600 }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="胜率"
                value={result.winRate.toFixed(2)}
                suffix="%"
                valueStyle={{ fontSize: 24, fontWeight: 600 }}
              />
              <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                {result.winningTrades} 胜 / {result.losingTrades} 负
              </div>
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="最大回撤"
                value={result.maxDrawdown.toFixed(2)}
                suffix="%"
                valueStyle={{
                  color: result.maxDrawdown >= 0 ? '#52c41a' : '#ff4d4f',
                  fontSize: 24,
                  fontWeight: 600,
                }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="平均收益率"
                value={result.avgReturn.toFixed(2)}
                suffix="%"
                prefix={result.avgReturn >= 0 ? '+' : ''}
                valueStyle={{
                  color: result.avgReturn >= 0 ? '#52c41a' : '#ff4d4f',
                  fontSize: 24,
                  fontWeight: 600,
                }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="夏普比率"
                value={result.sharpeRatio.toFixed(2)}
                valueStyle={{ fontSize: 24, fontWeight: 600 }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="平均持仓时间"
                value={result.avgHoldingTime.toFixed(1)}
                suffix="小时"
                valueStyle={{ fontSize: 24, fontWeight: 600 }}
              />
            </Card>
          </Col>
        </Row>

        {/* 诊断日志（当没有交易时显示） */}
        {result.totalTrades === 0 && result.diagnosticLog && (
          <Card style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#fa8c16' }}>
              ⚠️ 诊断日志：为什么没有交易数据？
            </h2>
            <Alert
              message="本次回测没有产生任何交易"
              description="以下是详细的诊断信息，帮助您了解原因"
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
            />
            
            {/* 数据获取情况 */}
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>数据获取情况</h3>
              <Table
                dataSource={result.diagnosticLog.dataFetch}
                columns={[
                  { title: '标的', dataIndex: 'symbol', key: 'symbol' },
                  { 
                    title: '状态', 
                    key: 'status',
                    render: (_: any, record: any) => (
                      <Tag color={record.success ? 'success' : 'error'}>
                        {record.success ? '成功' : '失败'}
                      </Tag>
                    )
                  },
                  { title: '数据条数', dataIndex: 'count', key: 'count' },
                  { 
                    title: '错误信息', 
                    dataIndex: 'error', 
                    key: 'error',
                    render: (text: string) => text || '-'
                  },
                ]}
                rowKey={(_, index) => `data-${index}`}
                pagination={false}
                size="small"
              />
            </div>

            {/* 信号生成统计 */}
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>信号生成统计</h3>
              <Row gutter={16}>
                <Col xs={12} sm={6}>
                  <Statistic
                    title="总日期数"
                    value={result.diagnosticLog.summary.totalDates}
                  />
                </Col>
                <Col xs={12} sm={6}>
                  <Statistic
                    title="生成信号数"
                    value={result.diagnosticLog.summary.totalSignals}
                  />
                </Col>
                <Col xs={12} sm={6}>
                  <Statistic
                    title="买入尝试数"
                    value={result.diagnosticLog.summary.totalBuyAttempts}
                  />
                </Col>
                <Col xs={12} sm={6}>
                  <Statistic
                    title="成功买入数"
                    value={result.diagnosticLog.summary.totalBuySuccess}
                    valueStyle={{ color: result.diagnosticLog.summary.totalBuySuccess > 0 ? '#52c41a' : '#ff4d4f' }}
                  />
                </Col>
              </Row>
            </div>

            {/* 买入拒绝原因 */}
            {Object.keys(result.diagnosticLog.summary.buyRejectReasons).length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>买入拒绝原因统计</h3>
                <Table
                  dataSource={Object.entries(result.diagnosticLog.summary.buyRejectReasons).map(([reason, count]) => ({
                    reason,
                    count,
                  }))}
                  columns={[
                    { title: '拒绝原因', dataIndex: 'reason', key: 'reason' },
                    { 
                      title: '次数', 
                      dataIndex: 'count', 
                      key: 'count',
                      render: (count: number) => <Tag color="red">{count}</Tag>
                    },
                  ]}
                  rowKey="reason"
                  pagination={false}
                  size="small"
                />
              </div>
            )}

            {/* 信号生成详情（最近20条） */}
            {result.diagnosticLog.signalGeneration.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>信号生成详情（最近20条）</h3>
                <Table
                  dataSource={result.diagnosticLog.signalGeneration.slice(-20)}
                  columns={[
                    { title: '日期', dataIndex: 'date', key: 'date', render: (text: string) => formatDate(text) },
                    { title: '标的', dataIndex: 'symbol', key: 'symbol' },
                    { 
                      title: '信号', 
                      dataIndex: 'signal', 
                      key: 'signal',
                      render: (signal: string | null) => {
                        if (!signal) return <Tag color="default">无信号</Tag>;
                        if (signal === 'BUY') return <Tag color="green">买入</Tag>;
                        return <Tag>{signal}</Tag>;
                      }
                    },
                    { 
                      title: '错误', 
                      dataIndex: 'error', 
                      key: 'error',
                      render: (text: string) => text ? <span style={{ color: '#ff4d4f' }}>{text}</span> : '-'
                    },
                  ]}
                  rowKey={(_, index) => `signal-${index}`}
                  pagination={false}
                  size="small"
                />
              </div>
            )}

            {/* 买入尝试详情（最近20条） */}
            {result.diagnosticLog.buyAttempts.length > 0 && (
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>买入尝试详情（最近20条）</h3>
                <Table
                  dataSource={result.diagnosticLog.buyAttempts.slice(-20)}
                  columns={[
                    { title: '日期', dataIndex: 'date', key: 'date', render: (text: string) => formatDate(text) },
                    { title: '标的', dataIndex: 'symbol', key: 'symbol' },
                    { 
                      title: '结果', 
                      dataIndex: 'success', 
                      key: 'success',
                      render: (success: boolean) => (
                        <Tag color={success ? 'success' : 'error'}>
                          {success ? '成功' : '失败'}
                        </Tag>
                      )
                    },
                    { title: '原因', dataIndex: 'reason', key: 'reason' },
                  ]}
                  rowKey={(_, index) => `buy-${index}`}
                  pagination={false}
                  size="small"
                />
              </div>
            )}
          </Card>
        )}

        {/* 交易明细 */}
        <Card style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>交易明细 ({result.trades.length})</h2>
          <Table
            dataSource={result.trades}
            columns={tradeColumns}
            rowKey={(_, index) => `trade-${index}`}
            locale={{
              emptyText: '暂无交易记录',
            }}
          />
        </Card>

        {/* 每日收益曲线（使用 Recharts） */}
        {result.dailyReturns && result.dailyReturns.length > 0 && (
          <Card style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>每日权益变化</h2>
            <ResponsiveContainer width="100%" height={isMobile ? 200 : 400}>
              <AreaChart data={result.dailyReturns}>
                <defs>
                  <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                <YAxis 
                  tickFormatter={(value) => `$${value.toFixed(0)}`}
                />
                <Tooltip 
                  formatter={(value: number) => [`$${value.toFixed(2)}`, '权益']}
                  labelFormatter={(label) => `日期: ${new Date(label).toLocaleDateString('zh-CN')}`}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="equity"
                  stroke="#3b82f6"
                  fillOpacity={1}
                  fill="url(#colorEquity)"
                  name="权益"
                />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* 每日收益率 */}
        {result.dailyReturns && result.dailyReturns.length > 0 && (
          <Card style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>每日收益率</h2>
            <ResponsiveContainer width="100%" height={isMobile ? 200 : 300}>
              <BarChart data={result.dailyReturns}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                <YAxis 
                  tickFormatter={(value) => `${value.toFixed(2)}%`}
                />
                <Tooltip 
                  formatter={(value: number) => [
                    <span style={{ color: value >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
                      {value >= 0 ? '+' : ''}{value.toFixed(2)}%
                    </span>,
                    '收益率'
                  ]}
                  labelFormatter={(label) => `日期: ${new Date(label).toLocaleDateString('zh-CN')}`}
                />
                <Legend />
                <Bar 
                  dataKey="return" 
                  name="收益率"
                  radius={[4, 4, 0, 0]}
                >
                  {result.dailyReturns.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.return >= 0 ? '#52c41a' : '#ff4d4f'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* 累计收益率曲线 */}
        {result.dailyReturns && result.dailyReturns.length > 0 && (
          <Card>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>累计收益率</h2>
            <ResponsiveContainer width="100%" height={isMobile ? 200 : 300}>
              <LineChart data={result.dailyReturns.map((day) => {
                const initialEquity = result.dailyReturns[0].equity;
                const cumulativeReturn = ((day.equity - initialEquity) / initialEquity) * 100;
                return {
                  date: day.date,
                  cumulativeReturn: cumulativeReturn,
                };
              })}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                <YAxis 
                  tickFormatter={(value) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`}
                />
                <Tooltip 
                  formatter={(value: number) => [`${value >= 0 ? '+' : ''}${value.toFixed(2)}%`, '累计收益率']}
                  labelFormatter={(label) => `日期: ${new Date(label).toLocaleDateString('zh-CN')}`}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="cumulativeReturn"
                  stroke="#722ed1"
                  strokeWidth={2}
                  dot={false}
                  name="累计收益率"
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}
      </Card>
    </AppLayout>
  );
}

