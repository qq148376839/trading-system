'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { quantApi, watchlistApi } from '@/lib/api';
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
    symbolPoolConfig: { mode: 'STATIC', symbols: [] as string[] },
    config: { atrPeriod: 14, atrMultiplier: 2.0, riskRewardRatio: 1.5 },
  });
  const [allocations, setAllocations] = useState<any[]>([]);
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [newSymbol, setNewSymbol] = useState('');
  const [symbolError, setSymbolError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      quantApi.getCapitalAllocations(),
      watchlistApi.getWatchlist(true), // 只获取启用的关注股票
    ]).then(([allocRes, watchRes]) => {
      if (allocRes.success) {
        setAllocations(allocRes.data || []);
      }
      if (watchRes.success && watchRes.data?.watchlist) {
        setWatchlist(watchRes.data.watchlist);
      }
    });
  }, []);

  // 验证股票代码格式
  const validateSymbol = (symbol: string): string | null => {
    const trimmed = symbol.trim().toUpperCase();
    if (!trimmed) {
      return '请输入股票代码';
    }
    
    // 自动修正常见错误：APPL -> AAPL
    let corrected = trimmed;
    if (corrected === 'APPL.US') {
      corrected = 'AAPL.US';
    }
    
    // 验证格式：ticker.region 或 .ticker.region
    const symbolPattern = /^\.?[A-Z0-9]+\.[A-Z]{2}$/;
    if (!symbolPattern.test(corrected)) {
      return '无效的标的代码格式。请使用 ticker.region 格式，例如：AAPL.US 或 700.HK';
    }
    
    return corrected;
  };

  // 添加股票
  const handleAddSymbol = () => {
    setSymbolError(null);
    const validation = validateSymbol(newSymbol);
    
    if (typeof validation === 'string' && validation.startsWith('无效')) {
      setSymbolError(validation);
      return;
    }
    
    if (typeof validation === 'string') {
      const symbol = validation;
      
      // 检查是否已存在
      if (formData.symbolPoolConfig.symbols.includes(symbol)) {
        setSymbolError('该股票已在股票池中');
        return;
      }
      
      // 添加到股票池
      setFormData({
        ...formData,
        symbolPoolConfig: {
          ...formData.symbolPoolConfig,
          symbols: [...formData.symbolPoolConfig.symbols, symbol],
        },
      });
      setNewSymbol('');
    }
  };

  // 从关注列表添加
  const handleAddFromWatchlist = (symbol: string) => {
    if (!formData.symbolPoolConfig.symbols.includes(symbol)) {
      setFormData({
        ...formData,
        symbolPoolConfig: {
          ...formData.symbolPoolConfig,
          symbols: [...formData.symbolPoolConfig.symbols, symbol],
        },
      });
    }
  };

  // 移除股票
  const handleRemoveSymbol = (symbol: string) => {
    setFormData({
      ...formData,
      symbolPoolConfig: {
        ...formData.symbolPoolConfig,
        symbols: formData.symbolPoolConfig.symbols.filter((s) => s !== symbol),
      },
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 验证至少有一个股票
    if (formData.symbolPoolConfig.symbols.length === 0) {
      alert('请至少添加一个股票到股票池');
      return;
    }
    
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
            <label className="block text-sm font-medium mb-1">股票池</label>
            
            {/* 添加股票输入框 */}
            <div className="mb-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSymbol}
                  onChange={(e) => {
                    setNewSymbol(e.target.value);
                    setSymbolError(null);
                  }}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddSymbol();
                    }
                  }}
                  placeholder="输入股票代码，例如：AAPL.US"
                  className="flex-1 border rounded px-3 py-2"
                />
                <button
                  type="button"
                  onClick={handleAddSymbol}
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                  添加
                </button>
              </div>
              {symbolError && (
                <div className="mt-1 text-sm text-red-600">{symbolError}</div>
              )}
              <p className="mt-1 text-xs text-gray-500">
                格式：ticker.region，例如：AAPL.US（美股）、700.HK（港股）
              </p>
            </div>

            {/* 从关注列表快速添加 */}
            {watchlist.length > 0 && (
              <div className="mb-2">
                <label className="block text-xs text-gray-500 mb-1">从关注列表快速添加：</label>
                <div className="flex flex-wrap gap-2">
                  {watchlist
                    .filter((item) => !formData.symbolPoolConfig.symbols.includes(item.symbol))
                    .slice(0, 10)
                    .map((item) => (
                      <button
                        key={item.symbol}
                        type="button"
                        onClick={() => handleAddFromWatchlist(item.symbol)}
                        className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                      >
                        + {item.symbol}
                      </button>
                    ))}
                </div>
              </div>
            )}

            {/* 已添加的股票列表 */}
            <div className="border rounded p-2 min-h-[60px] max-h-[200px] overflow-y-auto">
              {formData.symbolPoolConfig.symbols.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-2">暂无股票，请添加</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {formData.symbolPoolConfig.symbols.map((symbol) => (
                    <span
                      key={symbol}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm"
                    >
                      {symbol}
                      <button
                        type="button"
                        onClick={() => handleRemoveSymbol(symbol)}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          {/* 策略配置 */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">策略配置</label>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">ATR周期</label>
                <input
                  type="number"
                  value={formData.config.atrPeriod || 14}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      config: { ...formData.config, atrPeriod: parseInt(e.target.value) || 14 },
                    })
                  }
                  className="border rounded px-3 py-2 w-full"
                  min="1"
                  max="100"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ATR倍数</label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.config.atrMultiplier || 2.0}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      config: { ...formData.config, atrMultiplier: parseFloat(e.target.value) || 2.0 },
                    })
                  }
                  className="border rounded px-3 py-2 w-full"
                  min="0.1"
                  max="10"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">风险收益比</label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.config.riskRewardRatio || 1.5}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      config: { ...formData.config, riskRewardRatio: parseFloat(e.target.value) || 1.5 },
                    })
                  }
                  className="border rounded px-3 py-2 w-full"
                  min="0.1"
                  max="10"
                />
              </div>
            </div>
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

