'use client';

import { useState, useEffect } from 'react';
import { quantApi } from '@/lib/api';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import { Card, Table, Tag, Space, Button, Spin, Row, Col, Statistic, Tooltip } from 'antd';

interface Overview {
  runningStrategies: number;
  totalCapital: number;
  todayTrades: number;
  todayBuyOrders?: number;  // 新增：今日买入订单数量
  todaySellOrders?: number; // 新增：今日卖出订单数量
  todayPnl: number;
}

interface Signal {
  id: number;
  symbol: string;
  signal_type: string;
  price: number;
  reason: string;
  status: string;
  created_at: string;
}

export default function QuantTradingPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [recentSignals, setRecentSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // 加载总览数据
      const strategiesRes = await quantApi.getStrategies();
      const strategies = strategiesRes.data || [];
      const runningStrategies = strategies.filter((s: any) => s.status === 'RUNNING').length;

      const capitalRes = await quantApi.getCapitalUsage();
      const totalCapital = capitalRes.data?.totalCapital || 0;

      // 调用新的统计接口获取今日盈亏和今日交易数量
      const statsRes = await quantApi.getDashboardStats();
      const todayPnl = statsRes.data?.todayPnl || 0;
      const todayTrades = statsRes.data?.todayTrades || 0;
      const todayBuyOrders = statsRes.data?.todayBuyOrders || 0;
      const todaySellOrders = statsRes.data?.todaySellOrders || 0;

      setOverview({
        runningStrategies,
        totalCapital,
        todayTrades,
        todayBuyOrders,
        todaySellOrders,
        todayPnl,
      });

      // 加载最近信号
      const signalsRes = await quantApi.getSignals({ limit: 10 });
      setRecentSignals(signalsRes.data || []);
    } catch (error: any) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const signalColumns = [
    {
      title: '时间',
      key: 'created_at',
      dataIndex: 'created_at',
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
    },
    {
      title: '标的',
      key: 'symbol',
      dataIndex: 'symbol',
      render: (text: string) => <span style={{ fontFamily: 'monospace' }}>{text}</span>,
    },
    {
      title: '信号',
      key: 'signal_type',
      dataIndex: 'signal_type',
      render: (text: string) => (
        <Tag color={text === 'BUY' ? 'success' : 'error'}>{text}</Tag>
      ),
    },
    {
      title: '价格',
      key: 'price',
      dataIndex: 'price',
      render: (price: number | null) =>
        price != null ? `$${parseFloat(String(price)).toFixed(2)}` : '-',
    },
    {
      title: '状态',
      key: 'status',
      dataIndex: 'status',
      render: (status: string) => {
        const statusMap: Record<string, { color: string; text: string }> = {
          EXECUTED: { color: 'processing', text: '已执行' },
          REJECTED: { color: 'error', text: '已拒绝' },
          PENDING: { color: 'default', text: '待处理' },
        };
        const config = statusMap[status] || { color: 'default', text: status };
        return <Tag color={config.color}>{config.text}</Tag>;
      },
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

  return (
    <AppLayout>
      <Card>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>量化交易中心</h1>

        {/* 总览卡片 */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="运行中策略"
                value={overview?.runningStrategies || 0}
                valueStyle={{ fontSize: 24, fontWeight: 600 }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="总资金"
                value={(overview?.totalCapital || 0).toFixed(2)}
                prefix="$"
                valueStyle={{ fontSize: 24, fontWeight: 600 }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Tooltip
                title={
                  <div>
                    <div>总交易：{overview?.todayTrades || 0}笔</div>
                    <div>买入：{overview?.todayBuyOrders || 0}笔</div>
                    <div>卖出：{overview?.todaySellOrders || 0}笔</div>
                  </div>
                }
              >
                <Statistic
                  title="今日交易"
                  value={overview?.todayTrades || 0}
                  valueStyle={{ fontSize: 24, fontWeight: 600, cursor: 'help' }}
                />
              </Tooltip>
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="今日盈亏"
                value={(overview?.todayPnl || 0).toFixed(2)}
                prefix="$"
                valueStyle={{
                  fontSize: 24,
                  fontWeight: 600,
                  color: (overview?.todayPnl || 0) >= 0 ? '#52c41a' : '#ff4d4f',
                }}
              />
            </Card>
          </Col>
        </Row>

        {/* 实时信号流 */}
        <Card>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>最近信号</h2>
          <Table
            dataSource={recentSignals}
            columns={signalColumns}
            rowKey="id"
            pagination={false}
            locale={{
              emptyText: '暂无信号',
            }}
          />
        </Card>
      </Card>
    </AppLayout>
  );
}

