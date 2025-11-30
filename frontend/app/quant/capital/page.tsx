'use client';

import { useState, useEffect, useRef } from 'react';
import { quantApi } from '@/lib/api';
import BackButton from '@/components/BackButton';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

interface Allocation {
  id: number;
  name: string;
  allocationType: string;
  allocationValue: number;
  currentUsage: number;
  strategyCount: number;
  childrenCount?: number;
}

interface CapitalUsage {
  totalCapital: number;
  allocations: Allocation[];
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

export default function CapitalPage() {
  const [capitalUsage, setCapitalUsage] = useState<CapitalUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAllocation, setEditingAllocation] = useState<Allocation | null>(null);
  const isLoadingRef = useRef(false);

  useEffect(() => {
    loadData();
  }, []);

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
      alert('余额同步完成');
      await loadData();
    } catch (err: any) {
      alert(err.message || '余额同步失败');
    }
  };

  const handleEdit = (alloc: Allocation) => {
    setEditingAllocation(alloc);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除该资金分配账户吗？')) return;
    try {
      await quantApi.deleteCapitalAllocation(id);
      alert('删除成功');
      await loadData();
    } catch (err: any) {
      alert(err.message || '删除失败');
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">加载中...</div>
      </div>
    );
  }

  if (!capitalUsage) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-red-500">加载失败</div>
      </div>
    );
  }

  const chartData = capitalUsage.allocations.map((alloc) => ({
    name: alloc.name,
    value: parseFloat(alloc.allocationValue.toString()),
    usage: parseFloat(alloc.currentUsage.toString()),
  }));

  return (
    <div className="container mx-auto p-6">
      <BackButton />
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">资金管理</h1>
        <div className="flex gap-2">
          <button
            onClick={handleSyncBalance}
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
          >
            同步余额
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            创建分配账户
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* 总资金卡片 */}
      <div className="bg-white p-6 rounded-lg shadow mb-6">
        <h2 className="text-xl font-bold mb-2">总资金</h2>
        <div className="text-3xl font-bold text-blue-600">
          ${capitalUsage.totalCapital.toFixed(2)}
        </div>
      </div>

      {/* 资金分配饼图 */}
      {chartData.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <h2 className="text-xl font-bold mb-4">资金分配</h2>
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
        </div>
      )}

      {/* 资金分配表格 */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">账户名称</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">分配类型</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">分配金额</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">已使用</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">可用</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">使用率</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">策略数</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {capitalUsage.allocations.map((alloc) => {
              const allocated =
                alloc.allocationType === 'PERCENTAGE'
                  ? capitalUsage.totalCapital * parseFloat(alloc.allocationValue.toString())
                  : parseFloat(alloc.allocationValue.toString());
              const used = parseFloat(alloc.currentUsage.toString());
              const available = allocated - used;
              const usageRate = allocated > 0 ? (used / allocated) * 100 : 0;
              const strategyCount = typeof alloc.strategyCount === 'number' 
                ? alloc.strategyCount 
                : parseInt(String(alloc.strategyCount || '0'));
              const childrenCount = typeof alloc.childrenCount === 'number'
                ? alloc.childrenCount
                : parseInt(String(alloc.childrenCount || '0'));
              // 只有非GLOBAL账户才能编辑/删除，且没有策略在使用，且没有子账户
              const canEdit = alloc.name !== 'GLOBAL' && strategyCount === 0 && childrenCount === 0;
              const canDelete = alloc.name !== 'GLOBAL' && strategyCount === 0 && childrenCount === 0;

              return (
                <tr key={alloc.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap font-medium">{alloc.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {alloc.allocationType === 'PERCENTAGE'
                      ? `${(parseFloat(alloc.allocationValue.toString()) * 100).toFixed(1)}%`
                      : '固定金额'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">${allocated.toFixed(2)}</td>
                  <td className="px-6 py-4 whitespace-nowrap">${used.toFixed(2)}</td>
                  <td className="px-6 py-4 whitespace-nowrap">${available.toFixed(2)}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          usageRate > 90 ? 'bg-red-600' : usageRate > 70 ? 'bg-yellow-600' : 'bg-blue-600'
                        }`}
                        style={{ width: `${Math.min(usageRate, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">{usageRate.toFixed(1)}%</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {strategyCount}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex gap-2">
                      {canEdit && (
                        <button
                          onClick={() => handleEdit(alloc)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          编辑
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(alloc.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          删除
                        </button>
                      )}
                      {!canEdit && !canDelete && (
                        <span className="text-gray-400 text-xs">系统账户</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
    </div>
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
      onSuccess();
    } catch (err: any) {
      alert(err.message || '创建资金分配账户失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h2 className="text-2xl font-bold mb-4">创建资金分配账户</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">账户名称</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="border rounded px-3 py-2 w-full"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">父账户（可选）</label>
            <select
              value={formData.parentId || ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  parentId: e.target.value ? parseInt(e.target.value) : null,
                })
              }
              className="border rounded px-3 py-2 w-full"
            >
              <option value="">无</option>
              {allocations.map((alloc) => (
                <option key={alloc.id} value={alloc.id}>
                  {alloc.name}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">分配类型</label>
            <select
              value={formData.allocationType}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  allocationType: e.target.value as 'PERCENTAGE' | 'FIXED_AMOUNT',
                })
              }
              className="border rounded px-3 py-2 w-full"
            >
              <option value="PERCENTAGE">百分比</option>
              <option value="FIXED_AMOUNT">固定金额</option>
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">
              分配值 ({formData.allocationType === 'PERCENTAGE' ? '百分比 (0-1)' : '金额 (USD)'})
            </label>
            <input
              type="number"
              required
              step={formData.allocationType === 'PERCENTAGE' ? '0.01' : '0.01'}
              min="0"
              max={formData.allocationType === 'PERCENTAGE' ? '1' : undefined}
              value={formData.allocationValue}
              onChange={(e) =>
                setFormData({ ...formData, allocationValue: parseFloat(e.target.value) })
              }
              className="border rounded px-3 py-2 w-full"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
            >
              {loading ? '创建中...' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

