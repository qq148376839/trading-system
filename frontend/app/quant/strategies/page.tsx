'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { quantApi } from '@/lib/api';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import StrategyFormModal from '@/components/StrategyFormModal';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Button, Input, Table, Tag, Card, Space, Modal, message, Alert } from 'antd';

interface Strategy {
  id: number;
  name: string;
  type: string;
  capitalAllocationId: number | null;
  allocationName: string | null;
  symbolPoolConfig: any;
  config: any;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export default function StrategiesPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadStrategies();
  }, []);

  const loadStrategies = async () => {
    try {
      setLoading(true);
      const response = await quantApi.getStrategies();
      if (response.success) {
        setStrategies(response.data || []);
      } else {
        setError('加载策略列表失败');
      }
    } catch (err: any) {
      setError(err.message || '加载策略列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async (id: number) => {
    try {
      await quantApi.startStrategy(id);
      message.success('策略启动成功');
      await loadStrategies();
    } catch (err: any) {
      message.error(err.message || '启动策略失败');
    }
  };

  const handleStop = async (id: number) => {
    Modal.confirm({
      title: '确认停止策略',
      content: '确定要停止该策略吗？',
      onOk: async () => {
        try {
          await quantApi.stopStrategy(id);
          message.success('策略已停止');
          await loadStrategies();
        } catch (err: any) {
          message.error(err.message || '停止策略失败');
        }
      },
    });
  };

  const handleEdit = (strategy: Strategy) => {
    setEditingStrategy(strategy);
    setShowEditModal(true);
  };

  const handleDelete = async (id: number) => {
    Modal.confirm({
      title: '确认删除策略',
      content: '确定要删除该策略吗？此操作不可恢复！',
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        try {
          await quantApi.deleteStrategy(id);
          message.success('策略已删除');
          await loadStrategies();
        } catch (err: any) {
          message.error(err.message || '删除策略失败');
        }
      },
    });
  };

  const filteredStrategies = strategies.filter((s) =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      RUNNING: { color: 'success', text: '运行中' },
      ERROR: { color: 'error', text: '错误' },
      PAUSED: { color: 'warning', text: '暂停' },
      STOPPED: { color: 'default', text: '已停止' },
    };
    const config = statusMap[status] || { color: 'default', text: status };
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  const columns = [
    {
      title: '名称',
      key: 'name',
      dataIndex: 'name',
      render: (_: any, record: Strategy) => (
        <Link href={`/quant/strategies/${record.id}`} style={{ color: '#1890ff' }}>
          {record.name}
        </Link>
      ),
    },
    ...(isMobile ? [] : [{
      title: '类型',
      key: 'type',
      dataIndex: 'type',
    }]),
    {
      title: '状态',
      key: 'status',
      dataIndex: 'status',
      render: (_: any, record: Strategy) => getStatusTag(record.status),
    },
    ...(isMobile ? [] : [{
      title: '资金分配',
      key: 'allocationName',
      dataIndex: 'allocationName',
      render: (text: string) => text || '-',
    }]),
    {
      title: '操作',
      key: 'actions',
      width: isMobile ? 80 : undefined,
      render: (_: any, record: Strategy) => (
        <Space direction={isMobile ? 'vertical' : 'horizontal'} size="small">
          {record.status === 'STOPPED' && (
            <Button type="link" onClick={() => handleStart(record.id)} style={{ color: '#52c41a', padding: isMobile ? '0 4px' : undefined }}>
              启动
            </Button>
          )}
          {record.status === 'RUNNING' && (
            <Button type="link" danger onClick={() => handleStop(record.id)} style={{ padding: isMobile ? '0 4px' : undefined }}>
              停止
            </Button>
          )}
          {!isMobile && record.status === 'STOPPED' && (
            <Button type="link" onClick={() => handleEdit(record)}>
              编辑
            </Button>
          )}
          {!isMobile && record.status === 'STOPPED' && (
            <Button type="link" danger onClick={() => handleDelete(record.id)}>
              删除
            </Button>
          )}
          <Link href={`/quant/strategies/${record.id}`} style={{ color: '#1890ff', padding: isMobile ? '0 4px' : undefined }}>
            详情
          </Link>
        </Space>
      ),
    },
  ];

  return (
    <AppLayout>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>策略管理</h1>
          <Button type="primary" onClick={() => setShowCreateModal(true)}>
            创建策略
          </Button>
        </div>

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

        <div style={{ marginBottom: 16 }}>
          <Input
            placeholder="搜索策略..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ maxWidth: 400 }}
            allowClear
          />
        </div>

        <Table
          dataSource={filteredStrategies}
          columns={columns}
          rowKey="id"
          loading={loading}
          size={isMobile ? 'small' : 'middle'}
          scroll={isMobile ? { x: 400 } : { x: 'max-content' }}
          locale={{
            emptyText: filteredStrategies.length === 0 && !loading ? '暂无策略' : undefined,
          }}
        />

      {showCreateModal && (
        <StrategyFormModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            loadStrategies();
          }}
        />
      )}

      {showEditModal && editingStrategy && (
        <StrategyFormModal
          strategy={editingStrategy}
          onClose={() => {
            setShowEditModal(false);
            setEditingStrategy(null);
          }}
          onSuccess={() => {
            setShowEditModal(false);
            setEditingStrategy(null);
            loadStrategies();
          }}
        />
      )}
      </Card>
    </AppLayout>
  );
}
