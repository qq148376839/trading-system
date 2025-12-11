'use client';

import { useState, useEffect } from 'react';
import { quantApi } from '@/lib/api';
import AppLayout from '@/components/AppLayout';
import { Card, Table, Tag, Space, Input, Select, Alert, Spin, Row, Col } from 'antd';

interface Signal {
  id: number;
  strategy_id: number;
  symbol: string;
  signal_type: string;
  price: number;
  reason: string;
  metadata: any;
  status: string;
  created_at: string;
}

export default function SignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    strategyId: '',
    status: '',
    limit: 100,
  });

  useEffect(() => {
    loadSignals();
  }, [filters]);

  const loadSignals = async () => {
    try {
      setLoading(true);
      const params: any = { limit: filters.limit };
      if (filters.strategyId) params.strategyId = filters.strategyId;
      if (filters.status) params.status = filters.status;

      const response = await quantApi.getSignals(params);
      if (response.success) {
        setSignals(response.data || []);
      } else {
        setError('加载信号日志失败');
      }
    } catch (err: any) {
      setError(err.message || '加载信号日志失败');
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      title: '时间',
      key: 'created_at',
      dataIndex: 'created_at',
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
    },
    {
      title: '策略ID',
      key: 'strategy_id',
      dataIndex: 'strategy_id',
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
          IGNORED: { color: 'default', text: '已忽略' },
          PENDING: { color: 'warning', text: '待处理' },
        };
        const config = statusMap[status] || { color: 'default', text: status };
        return <Tag color={config.color}>{config.text}</Tag>;
      },
    },
    {
      title: '原因',
      key: 'reason',
      dataIndex: 'reason',
      ellipsis: true,
      render: (text: string) => text || '-',
    },
  ];

  return (
    <AppLayout>
      <Card>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>信号日志</h1>

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

        {/* 筛选器 */}
        <Card style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col xs={24} sm={8}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>策略ID</div>
              <Input
                type="number"
                value={filters.strategyId}
                onChange={(e) => setFilters({ ...filters, strategyId: e.target.value })}
                placeholder="留空显示所有"
              />
            </Col>
            <Col xs={24} sm={8}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>状态</div>
              <Select
                value={filters.status || undefined}
                onChange={(value) => setFilters({ ...filters, status: value || '' })}
                style={{ width: '100%' }}
                allowClear
              >
                <Select.Option value="PENDING">待处理</Select.Option>
                <Select.Option value="EXECUTED">已执行</Select.Option>
                <Select.Option value="REJECTED">已拒绝</Select.Option>
                <Select.Option value="IGNORED">已忽略</Select.Option>
              </Select>
            </Col>
            <Col xs={24} sm={8}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>数量限制</div>
              <Input
                type="number"
                value={filters.limit}
                onChange={(e) => setFilters({ ...filters, limit: parseInt(e.target.value) || 100 })}
                min={1}
                max={1000}
              />
            </Col>
          </Row>
        </Card>

        <Table
          dataSource={signals}
          columns={columns}
          rowKey="id"
          loading={loading}
          locale={{
            emptyText: signals.length === 0 && !loading ? '暂无信号' : undefined,
          }}
        />
      </Card>
    </AppLayout>
  );
}

