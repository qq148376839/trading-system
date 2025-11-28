'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { quantApi } from '@/lib/api';
import Link from 'next/link';
import BackButton from '@/components/BackButton';

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
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
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
      await loadStrategies();
    } catch (err: any) {
      alert(err.message || '启动策略失败');
    }
  };

  const handleStop = async (id: number) => {
    if (!confirm('确定要停止该策略吗？')) return;
    try {
      await quantApi.stopStrategy(id);
      await loadStrategies();
    } catch (err: any) {
      alert(err.message || '停止策略失败');
    }
  };

  const handleEdit = (id: number) => {
    router.push(`/quant/strategies/${id}`);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除该策略吗？此操作不可恢复！')) return;
    try {
      await quantApi.deleteStrategy(id);
      alert('策略已删除');
      await loadStrategies();
    } catch (err: any) {
      alert(err.message || '删除策略失败');
    }
  };

  const filteredStrategies = strategies.filter((s) =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="container mx-auto p-6">
      <BackButton />
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">策略管理</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          创建策略
        </button>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="mb-4">
        <input
          type="text"
          placeholder="搜索策略..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="border rounded px-3 py-2 w-full max-w-md"
        />
      </div>

      {loading ? (
        <div className="text-center py-8">加载中...</div>
      ) : filteredStrategies.length === 0 ? (
        <div className="text-center py-8 text-gray-500">暂无策略</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">名称</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">类型</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">资金分配</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredStrategies.map((strategy) => (
                <tr key={strategy.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Link
                      href={`/quant/strategies/${strategy.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {strategy.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {strategy.type}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        strategy.status === 'RUNNING'
                          ? 'bg-green-100 text-green-800'
                          : strategy.status === 'ERROR'
                          ? 'bg-red-100 text-red-800'
                          : strategy.status === 'PAUSED'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {strategy.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {strategy.allocationName || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex gap-2">
                      {strategy.status === 'STOPPED' && (
                        <button
                          onClick={() => handleStart(strategy.id)}
                          className="text-green-600 hover:text-green-800"
                        >
                          启动
                        </button>
                      )}
                      {strategy.status === 'RUNNING' && (
                        <button
                          onClick={() => handleStop(strategy.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          停止
                        </button>
                      )}
                      {strategy.status === 'STOPPED' && (
                        <button
                          onClick={() => handleEdit(strategy.id)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          编辑
                        </button>
                      )}
                      {strategy.status === 'STOPPED' && (
                        <button
                          onClick={() => handleDelete(strategy.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          删除
                        </button>
                      )}
                      <Link
                        href={`/quant/strategies/${strategy.id}`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        详情
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateModal && (
        <CreateStrategyModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            loadStrategies();
          }}
        />
      )}
    </div>
  );
}

function CreateStrategyModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'RECOMMENDATION_V1',
    capitalAllocationId: null as number | null,
    symbolPoolConfig: { mode: 'STATIC', symbols: [''] },
    config: { atrPeriod: 14, atrMultiplier: 2.0, riskRewardRatio: 1.5 },
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
      await quantApi.createStrategy(formData);
      onSuccess();
    } catch (err: any) {
      alert(err.message || '创建策略失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold mb-4">创建策略</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">策略名称</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="border rounded px-3 py-2 w-full"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">策略类型</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              className="border rounded px-3 py-2 w-full"
            >
              <option value="RECOMMENDATION_V1">推荐策略 V1</option>
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">资金分配账户</label>
            <select
              value={formData.capitalAllocationId || ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  capitalAllocationId: e.target.value ? parseInt(e.target.value) : null,
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
            <label className="block text-sm font-medium mb-1">股票池（符号，每行一个）</label>
            <textarea
              value={formData.symbolPoolConfig.symbols.join('\n')}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  symbolPoolConfig: {
                    ...formData.symbolPoolConfig,
                    symbols: e.target.value.split('\n').filter((s) => s.trim()),
                  },
                })
              }
              className="border rounded px-3 py-2 w-full h-24"
              placeholder="AAPL.US&#10;MSFT.US"
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

