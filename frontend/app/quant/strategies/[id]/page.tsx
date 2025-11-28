'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { quantApi } from '@/lib/api';
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

interface StrategyInstance {
  symbol: string;
  currentState: string;
  context: any;
  lastUpdated: string;
}

export default function StrategyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const strategyId = parseInt(params.id as string);

  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [instances, setInstances] = useState<StrategyInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    if (strategyId) {
      loadData();
    }
  }, [strategyId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [strategyRes, instancesRes] = await Promise.all([
        quantApi.getStrategy(strategyId),
        quantApi.getStrategyInstances(strategyId),
      ]);

      if (strategyRes.success) {
        setStrategy(strategyRes.data);
      } else {
        setError('加载策略详情失败');
      }

      if (instancesRes.success) {
        setInstances(instancesRes.data || []);
      }
    } catch (err: any) {
      setError(err.message || '加载策略详情失败');
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    try {
      await quantApi.startStrategy(strategyId);
      alert('策略已启动');
      await loadData();
    } catch (err: any) {
      alert(err.message || '启动策略失败');
    }
  };

  const handleStop = async () => {
    if (!confirm('确定要停止该策略吗？')) return;
    try {
      await quantApi.stopStrategy(strategyId);
      alert('策略已停止');
      await loadData();
    } catch (err: any) {
      alert(err.message || '停止策略失败');
    }
  };

  const handleDelete = async () => {
    if (!confirm('确定要删除该策略吗？此操作不可恢复！')) return;
    try {
      await quantApi.deleteStrategy(strategyId);
      alert('策略已删除');
      router.push('/quant/strategies');
    } catch (err: any) {
      alert(err.message || '删除策略失败');
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">加载中...</div>
      </div>
    );
  }

  if (error || !strategy) {
    return (
      <div className="container mx-auto p-6">
        <BackButton />
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mt-4">
          {error || '策略不存在'}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <BackButton />
        <div className="flex gap-2">
          {strategy.status === 'STOPPED' && (
            <button
              onClick={handleStart}
              className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
            >
              启动策略
            </button>
          )}
          {strategy.status === 'RUNNING' && (
            <button
              onClick={handleStop}
              className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
            >
              停止策略
            </button>
          )}
          {strategy.status === 'STOPPED' && (
            <button
              onClick={() => setShowEditModal(true)}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            >
              编辑
            </button>
          )}
          <button
            onClick={handleDelete}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
          >
            删除
          </button>
        </div>
      </div>

      <h1 className="text-3xl font-bold mb-6">{strategy.name}</h1>

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-bold mb-4">基本信息</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-500">策略ID</label>
            <div className="text-lg">{strategy.id}</div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">策略类型</label>
            <div className="text-lg">{strategy.type}</div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">状态</label>
            <div>
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
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">资金分配</label>
            <div className="text-lg">{strategy.allocationName || '-'}</div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">创建时间</label>
            <div className="text-lg">{new Date(strategy.createdAt).toLocaleString()}</div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">更新时间</label>
            <div className="text-lg">{new Date(strategy.updatedAt).toLocaleString()}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-bold mb-4">标的池配置</h2>
        <pre className="bg-gray-50 p-4 rounded overflow-auto">
          {JSON.stringify(strategy.symbolPoolConfig, null, 2)}
        </pre>
      </div>

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-bold mb-4">策略配置</h2>
        <pre className="bg-gray-50 p-4 rounded overflow-auto">
          {JSON.stringify(strategy.config, null, 2)}
        </pre>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold mb-4">策略实例 ({instances.length})</h2>
        {instances.length === 0 ? (
          <div className="text-gray-500 text-center py-4">暂无实例</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">标的</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">最后更新</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {instances.map((instance) => (
                <tr key={instance.symbol} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap font-medium">{instance.symbol}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        instance.currentState === 'HOLDING'
                          ? 'bg-green-100 text-green-800'
                          : instance.currentState === 'OPENING' || instance.currentState === 'CLOSING'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {instance.currentState}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(instance.lastUpdated).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showEditModal && strategy && (
        <EditStrategyModal
          strategy={strategy}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false);
            loadData();
          }}
        />
      )}
    </div>
  );
}

function EditStrategyModal({
  strategy,
  onClose,
  onSuccess,
}: {
  strategy: Strategy;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    name: strategy.name,
    type: strategy.type,
    capitalAllocationId: strategy.capitalAllocationId,
    symbolPoolConfig: strategy.symbolPoolConfig,
    config: strategy.config,
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
      await quantApi.updateStrategy(strategy.id, formData);
      alert('策略已更新');
      onSuccess();
    } catch (err: any) {
      alert(err.message || '更新策略失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold mb-4">编辑策略</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">策略名称</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="border rounded px-3 py-2 w-full"
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">策略类型</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              className="border rounded px-3 py-2 w-full"
            >
              <option value="RECOMMENDATION_V1">RECOMMENDATION_V1</option>
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
            <label className="block text-sm font-medium mb-1">标的池配置 (JSON)</label>
            <textarea
              value={JSON.stringify(formData.symbolPoolConfig, null, 2)}
              onChange={(e) => {
                try {
                  setFormData({ ...formData, symbolPoolConfig: JSON.parse(e.target.value) });
                } catch (err) {
                  // 忽略无效JSON
                }
              }}
              className="border rounded px-3 py-2 w-full font-mono text-sm"
              rows={4}
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">策略配置 (JSON)</label>
            <textarea
              value={JSON.stringify(formData.config, null, 2)}
              onChange={(e) => {
                try {
                  setFormData({ ...formData, config: JSON.parse(e.target.value) });
                } catch (err) {
                  // 忽略无效JSON
                }
              }}
              className="border rounded px-3 py-2 w-full font-mono text-sm"
              rows={6}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
            >
              {loading ? '保存中...' : '保存'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

