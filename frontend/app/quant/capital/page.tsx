'use client';

import { useState, useEffect, useRef } from 'react';
import { quantApi } from '@/lib/api';
import AppLayout from '@/components/AppLayout';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { Button, Table, Card, Space, Modal, message, Alert, Tag, Spin, Input, Select, Progress } from 'antd';

interface Allocation {
  id: number;
  name: string;
  allocationType: string;
  allocationValue: number;
  currentUsage: number;
  strategyCount: number;
  childrenCount?: number;
  isSystem?: boolean;
}

interface CapitalUsage {
  totalCapital: number;
  allocations: Allocation[];
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

interface Alert {
  strategyId: number;
  strategyName: string;
  recordedUsage: number;
  actualUsage: number;
  difference: number;
  differencePercent: number;
  severity: 'ERROR' | 'WARNING';
  expectedAllocation: number;
}

export default function CapitalPage() {
  const [capitalUsage, setCapitalUsage] = useState<CapitalUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAllocation, setEditingAllocation] = useState<Allocation | null>(null);
  const isLoadingRef = useRef(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);

  useEffect(() => {
    loadData();
    loadAlerts();
    
    // 每分钟刷新告警
    const interval = setInterval(() => {
      loadAlerts();
    }, 60000);
    
    return () => clearInterval(interval);
  }, []);

  const loadAlerts = async () => {
    try {
      setAlertsLoading(true);
      const response = await quantApi.getCapitalAlerts();
      if (response.success && response.data) {
        setAlerts(response.data.alerts || []);
      }
    } catch (err: any) {
      console.error('获取告警失败:', err);
    } finally {
      setAlertsLoading(false);
    }
  };

  const loadData = async () => {
    // 防止重复请求
    if (isLoadingRef.current) {
      return;
    }
    try {
      isLoadingRef.current = true;
      setLoading(true);
      const response = await quantApi.getCapitalUsage();
      if (response.success) {
        setCapitalUsage(response.data);
      } else {
        setError('加载资金使用情况失败');
      }
    } catch (err: any) {
      setError(err.message || '加载资金使用情况失败');
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  };

  const handleSyncBalance = async () => {
    try {
      await quantApi.syncBalance();
      message.success('余额同步完成');
      await loadData();
    } catch (err: any) {
      message.error(err.message || '余额同步失败');
    }
  };

  const handleEdit = (alloc: Allocation) => {
    setEditingAllocation(alloc);
  };

  const handleDelete = async (id: number) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除该资金分配账户吗？',
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        try {
          await quantApi.deleteCapitalAllocation(id);
          message.success('删除成功');
          await loadData();
        } catch (err: any) {
          message.error(err.message || '删除失败');
        }
      },
    });
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

  if (!capitalUsage) {
    return (
      <AppLayout>
        <Card>
          <Alert message="加载失败" type="error" showIcon />
        </Card>
      </AppLayout>
    );
  }

  // 计算饼图数据：需要将百分比转换为实际金额，并排除系统账户（GLOBAL）
  const chartData = capitalUsage.allocations
    .filter((alloc) => !(alloc.isSystem && alloc.name === 'GLOBAL')) // 排除GLOBAL系统账户
    .map((alloc) => {
      // 根据分配类型计算实际分配金额
      const allocatedAmount =
        alloc.allocationType === 'PERCENTAGE'
          ? capitalUsage.totalCapital * parseFloat(alloc.allocationValue.toString())
          : parseFloat(alloc.allocationValue.toString());
      
      return {
        name: alloc.name,
        value: allocatedAmount, // 使用实际金额而不是原始值
        usage: parseFloat(alloc.currentUsage.toString()),
      };
    })
    .filter((item) => item.value > 0); // 过滤掉金额为0的账户

  const columns = [
    {
      title: '账户名称',
      key: 'name',
      dataIndex: 'name',
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: '分配类型',
      key: 'allocationType',
      render: (_: any, record: Allocation) =>
        record.allocationType === 'PERCENTAGE'
          ? `${(parseFloat(record.allocationValue.toString()) * 100).toFixed(1)}%`
          : '固定金额',
    },
    {
      title: '分配金额',
      key: 'allocated',
      render: (_: any, record: Allocation) => {
        const allocated =
          record.allocationType === 'PERCENTAGE'
            ? capitalUsage.totalCapital * parseFloat(record.allocationValue.toString())
            : parseFloat(record.allocationValue.toString());
        return `$${allocated.toFixed(2)}`;
      },
    },
    {
      title: '已使用',
      key: 'used',
      render: (_: any, record: Allocation) => {
        const used = parseFloat(record.currentUsage.toString());
        return `$${used.toFixed(2)}`;
      },
    },
    {
      title: '可用',
      key: 'available',
      render: (_: any, record: Allocation) => {
        const allocated =
          record.allocationType === 'PERCENTAGE'
            ? capitalUsage.totalCapital * parseFloat(record.allocationValue.toString())
            : parseFloat(record.allocationValue.toString());
        const used = parseFloat(record.currentUsage.toString());
        const available = allocated - used;
        return `$${available.toFixed(2)}`;
      },
    },
    {
      title: '使用率',
      key: 'usageRate',
      render: (_: any, record: Allocation) => {
        const allocated =
          record.allocationType === 'PERCENTAGE'
            ? capitalUsage.totalCapital * parseFloat(record.allocationValue.toString())
            : parseFloat(record.allocationValue.toString());
        const used = parseFloat(record.currentUsage.toString());
        const usageRate = allocated > 0 ? (used / allocated) * 100 : 0;
        const status = usageRate > 90 ? 'exception' : usageRate > 70 ? 'active' : 'success';
        return (
          <div>
            <Progress percent={Math.min(usageRate, 100)} status={status} size="small" />
            <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>{usageRate.toFixed(1)}%</span>
          </div>
        );
      },
    },
    {
      title: '类型',
      key: 'type',
      render: (_: any, record: Allocation) => {
        const isSystem = record.isSystem || false;
        return isSystem ? <Tag color="red">系统账户</Tag> : <Tag>普通账户</Tag>;
      },
    },
    {
      title: '策略数',
      key: 'strategyCount',
      render: (_: any, record: Allocation) => {
        const strategyCount = typeof record.strategyCount === 'number'
          ? record.strategyCount
          : parseInt(String(record.strategyCount || '0'));
        return strategyCount;
      },
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: Allocation) => {
        const isSystem = record.isSystem || false;
        const strategyCount = typeof record.strategyCount === 'number'
          ? record.strategyCount
          : parseInt(String(record.strategyCount || '0'));
        const childrenCount = typeof record.childrenCount === 'number'
          ? record.childrenCount
          : parseInt(String(record.childrenCount || '0'));
        const canEdit = !isSystem && strategyCount === 0 && childrenCount === 0;
        const canDelete = !isSystem && strategyCount === 0 && childrenCount === 0;

        let deleteTooltip = '';
        if (isSystem) {
          deleteTooltip = '系统账户无法删除';
        } else if (strategyCount > 0) {
          deleteTooltip = `该账户正在被 ${strategyCount} 个策略使用，无法删除`;
        } else if (childrenCount > 0) {
          deleteTooltip = `该账户有 ${childrenCount} 个子账户，无法删除`;
        }

        let editTooltip = '';
        if (isSystem) {
          editTooltip = '系统账户无法编辑名称';
        } else if (strategyCount > 0) {
          editTooltip = `该账户正在被 ${strategyCount} 个策略使用，无法编辑`;
        } else if (childrenCount > 0) {
          editTooltip = `该账户有 ${childrenCount} 个子账户，无法编辑`;
        }

        return (
          <Space>
            <Button 
              type="link" 
              onClick={() => handleEdit(record)}
              disabled={!canEdit}
              title={editTooltip || undefined}
            >
              编辑
            </Button>
            <Button 
              type="link" 
              danger 
              onClick={() => handleDelete(record.id)}
              disabled={!canDelete}
              title={deleteTooltip || undefined}
            >
              删除
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <AppLayout>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>资金管理</h1>
          <Space>
            <Button type="primary" onClick={handleSyncBalance} style={{ background: '#52c41a', borderColor: '#52c41a' }}>
              同步余额
            </Button>
            <Button type="primary" onClick={() => setShowCreateModal(true)}>
              创建分配账户
            </Button>
          </Space>
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

        {/* 资金差异告警横幅 */}
        {alerts.length > 0 && (
          <Alert
            message={
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <strong>
                    {alerts.some(a => a.severity === 'ERROR') ? '🔴 严重资金差异告警' : '🟠 资金差异警告'}
                  </strong>
                  <Tag color={alerts.some(a => a.severity === 'ERROR') ? 'red' : 'orange'}>
                    共 {alerts.length} 个告警
                  </Tag>
                </div>
                <Space direction="vertical" style={{ width: '100%' }} size="small">
                  {alerts.map((alert, index) => (
                    <Card
                      key={index}
                      size="small"
                      style={{
                        backgroundColor: alert.severity === 'ERROR' ? '#fff1f0' : '#fffbe6',
                        borderColor: alert.severity === 'ERROR' ? '#ffccc7' : '#ffe58f',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div>
                          <strong>{alert.strategyName}</strong>
                          <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>(ID: {alert.strategyId})</span>
                        </div>
                        <Tag color={alert.severity === 'ERROR' ? 'red' : 'orange'}>{alert.severity}</Tag>
                      </div>
                      <Space direction="vertical" size="small" style={{ width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#666' }}>记录值:</span>
                          <strong>${alert.recordedUsage.toFixed(2)}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#666' }}>实际值:</span>
                          <strong>${alert.actualUsage.toFixed(2)}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#666' }}>差异:</span>
                          <strong style={{ color: alert.severity === 'ERROR' ? '#ff4d4f' : '#faad14' }}>
                            ${alert.difference.toFixed(2)} ({alert.differencePercent.toFixed(2)}%)
                          </strong>
                        </div>
                      </Space>
                    </Card>
                  ))}
                </Space>
              </div>
            }
            type={alerts.some(a => a.severity === 'ERROR') ? 'error' : 'warning'}
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        {/* 超配警告横幅 */}
        {capitalUsage && capitalUsage.allocations.some((alloc) => {
          const allocated = alloc.allocationType === 'PERCENTAGE'
            ? capitalUsage.totalCapital * parseFloat(alloc.allocationValue.toString())
            : parseFloat(alloc.allocationValue.toString());
          const used = parseFloat(alloc.currentUsage.toString());
          const usageRate = allocated > 0 ? (used / allocated) * 100 : 0;
          return usageRate > 100;
        }) && (
          <Alert
            message={
              <div>
                <div style={{ marginBottom: 12 }}>
                  <strong>⚠️ 资金超配警告</strong>
                </div>
                <Space direction="vertical" style={{ width: '100%' }} size="small">
                  {capitalUsage.allocations
                    .filter((alloc) => {
                      const allocated = alloc.allocationType === 'PERCENTAGE'
                        ? capitalUsage.totalCapital * parseFloat(alloc.allocationValue.toString())
                        : parseFloat(alloc.allocationValue.toString());
                      const used = parseFloat(alloc.currentUsage.toString());
                      const usageRate = allocated > 0 ? (used / allocated) * 100 : 0;
                      return usageRate > 100;
                    })
                    .map((alloc) => {
                      const allocated = alloc.allocationType === 'PERCENTAGE'
                        ? capitalUsage.totalCapital * parseFloat(alloc.allocationValue.toString())
                        : parseFloat(alloc.allocationValue.toString());
                      const used = parseFloat(alloc.currentUsage.toString());
                      const usageRate = allocated > 0 ? (used / allocated) * 100 : 0;
                      const overAllocation = used - allocated;
                      
                      return (
                        <Card
                          key={alloc.id}
                          size="small"
                          style={{
                            backgroundColor: '#fff7e6',
                            borderColor: '#ffd591',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <div>
                              <strong>{alloc.name}</strong>
                              <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>(ID: {alloc.id})</span>
                            </div>
                            <Tag color="orange">超配 {usageRate.toFixed(1)}%</Tag>
                          </div>
                          <Space direction="vertical" size="small" style={{ width: '100%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: '#666' }}>分配金额:</span>
                              <strong>${allocated.toFixed(2)}</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: '#666' }}>已使用:</span>
                              <strong>${used.toFixed(2)}</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: '#666' }}>超配金额:</span>
                              <strong style={{ color: '#fa8c16' }}>
                                ${overAllocation.toFixed(2)} ({usageRate.toFixed(1)}%)
                              </strong>
                            </div>
                          </Space>
                        </Card>
                      );
                    })}
                </Space>
              </div>
            }
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        {/* 总资金卡片 */}
        <Card style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>总资金</h2>
          <div style={{ fontSize: 32, fontWeight: 600, color: '#1890ff' }}>
            ${capitalUsage.totalCapital.toFixed(2)}
          </div>
        </Card>

        {/* 资金分配饼图 */}
        {chartData.length > 0 && (
          <Card style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>资金分配</h2>
            <ResponsiveContainer width="100%" height={400}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* 资金分配表格 */}
        <Table
          dataSource={capitalUsage.allocations}
          columns={columns}
          rowKey="id"
          pagination={false}
        />

      {showCreateModal && (
        <CreateAllocationModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            loadData();
          }}
        />
      )}

      {editingAllocation && (
        <EditAllocationModal
          allocation={editingAllocation}
          onClose={() => setEditingAllocation(null)}
          onSuccess={() => {
            setEditingAllocation(null);
            loadData();
          }}
        />
      )}
      </Card>
    </AppLayout>
  );
}

function CreateAllocationModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    name: '',
    parentId: null as number | null,
    allocationType: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED_AMOUNT',
    allocationValue: 0,
  });
  const [allocations, setAllocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    quantApi.getCapitalAllocations().then((res) => {
      if (res.success) {
        setAllocations(res.data || []);
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await quantApi.createCapitalAllocation(formData);
      message.success('创建成功');
      onSuccess();
    } catch (err: any) {
      message.error(err.message || '创建资金分配账户失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="创建资金分配账户"
      open={true}
      onCancel={onClose}
      footer={null}
      width={500}
    >
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>账户名称</label>
          <Input
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="请输入账户名称"
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>父账户（可选）</label>
          <Select
            value={formData.parentId || undefined}
            onChange={(value) =>
              setFormData({
                ...formData,
                parentId: value || null,
              })
            }
            style={{ width: '100%' }}
            placeholder="请选择父账户"
            allowClear
          >
            {allocations.map((alloc) => (
              <Select.Option key={alloc.id} value={alloc.id}>
                {alloc.name}
              </Select.Option>
            ))}
          </Select>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>分配类型</label>
          <Select
            value={formData.allocationType}
            onChange={(value) =>
              setFormData({
                ...formData,
                allocationType: value as 'PERCENTAGE' | 'FIXED_AMOUNT',
              })
            }
            style={{ width: '100%' }}
          >
            <Select.Option value="PERCENTAGE">百分比</Select.Option>
            <Select.Option value="FIXED_AMOUNT">固定金额</Select.Option>
          </Select>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
            分配值 ({formData.allocationType === 'PERCENTAGE' ? '百分比 (0-1)' : '金额 (USD)'})
          </label>
          <Input
            type="number"
            required
            step={formData.allocationType === 'PERCENTAGE' ? '0.01' : '0.01'}
            min="0"
            max={formData.allocationType === 'PERCENTAGE' ? '1' : undefined}
            value={formData.allocationValue}
            onChange={(e) =>
              setFormData({ ...formData, allocationValue: parseFloat(e.target.value) })
            }
            placeholder={formData.allocationType === 'PERCENTAGE' ? '0.00 - 1.00' : '0.00'}
          />
        </div>
        <div style={{ textAlign: 'right', marginTop: 24, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              创建
            </Button>
          </Space>
        </div>
      </form>
    </Modal>
  );
}

function EditAllocationModal({ 
  allocation, 
  onClose, 
  onSuccess 
}: { 
  allocation: Allocation; 
  onClose: () => void; 
  onSuccess: () => void 
}) {
  const [formData, setFormData] = useState({
    name: allocation.name,
    allocationType: allocation.allocationType as 'PERCENTAGE' | 'FIXED_AMOUNT',
    allocationValue: parseFloat(allocation.allocationValue.toString()),
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await quantApi.updateCapitalAllocation(allocation.id, formData);
      message.success('更新成功');
      onSuccess();
    } catch (err: any) {
      message.error(err.message || '更新资金分配账户失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="编辑资金分配账户"
      open={true}
      onCancel={onClose}
      footer={null}
      width={500}
    >
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>账户名称</label>
          <Input
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="请输入账户名称"
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>分配类型</label>
          <Select
            value={formData.allocationType}
            onChange={(value) =>
              setFormData({
                ...formData,
                allocationType: value as 'PERCENTAGE' | 'FIXED_AMOUNT',
              })
            }
            style={{ width: '100%' }}
          >
            <Select.Option value="PERCENTAGE">百分比</Select.Option>
            <Select.Option value="FIXED_AMOUNT">固定金额</Select.Option>
          </Select>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
            分配值 ({formData.allocationType === 'PERCENTAGE' ? '百分比 (0-1)' : '金额 (USD)'})
          </label>
          <Input
            type="number"
            required
            step={formData.allocationType === 'PERCENTAGE' ? '0.01' : '0.01'}
            min="0"
            max={formData.allocationType === 'PERCENTAGE' ? '1' : undefined}
            value={formData.allocationValue}
            onChange={(e) =>
              setFormData({ ...formData, allocationValue: parseFloat(e.target.value) })
            }
            placeholder={formData.allocationType === 'PERCENTAGE' ? '0.00 - 1.00' : '0.00'}
          />
        </div>
        <div style={{ textAlign: 'right', marginTop: 24, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              更新
            </Button>
          </Space>
        </div>
      </form>
    </Modal>
  );
}

