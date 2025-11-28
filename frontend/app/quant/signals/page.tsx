'use client';

import { useState, useEffect } from 'react';
import { quantApi } from '@/lib/api';
import BackButton from '@/components/BackButton';

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

  return (
    <div className="container mx-auto p-6">
      <BackButton />
      <h1 className="text-3xl font-bold mb-6">信号日志</h1>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* 筛选器 */}
      <div className="bg-white p-4 rounded-lg shadow mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">策略ID</label>
            <input
              type="number"
              value={filters.strategyId}
              onChange={(e) => setFilters({ ...filters, strategyId: e.target.value })}
              className="border rounded px-3 py-2 w-full"
              placeholder="留空显示所有"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">状态</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="border rounded px-3 py-2 w-full"
            >
              <option value="">全部</option>
              <option value="PENDING">待处理</option>
              <option value="EXECUTED">已执行</option>
              <option value="REJECTED">已拒绝</option>
              <option value="IGNORED">已忽略</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">数量限制</label>
            <input
              type="number"
              value={filters.limit}
              onChange={(e) => setFilters({ ...filters, limit: parseInt(e.target.value) })}
              className="border rounded px-3 py-2 w-full"
              min="1"
              max="1000"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">加载中...</div>
      ) : signals.length === 0 ? (
        <div className="text-center py-8 text-gray-500">暂无信号</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">时间</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">策略ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">标的</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">信号</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">价格</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">原因</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {signals.map((signal) => (
                <tr key={signal.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {new Date(signal.created_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">{signal.strategy_id}</td>
                  <td className="px-6 py-4 whitespace-nowrap font-mono text-sm">{signal.symbol}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        signal.signal_type === 'BUY'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {signal.signal_type}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {signal.price != null 
                      ? `$${parseFloat(String(signal.price)).toFixed(2)}` 
                      : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        signal.status === 'EXECUTED'
                          ? 'bg-blue-100 text-blue-800'
                          : signal.status === 'REJECTED'
                          ? 'bg-red-100 text-red-800'
                          : signal.status === 'IGNORED'
                          ? 'bg-gray-100 text-gray-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {signal.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                    {signal.reason || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

