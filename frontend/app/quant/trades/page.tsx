'use client';

import { useState, useEffect } from 'react';
import { quantApi } from '@/lib/api';
import BackButton from '@/components/BackButton';

interface Trade {
  id: number;
  strategy_id: number;
  symbol: string;
  side: string;
  quantity: number;
  avg_price: number;
  pnl: number | null;
  fees: number;
  estimated_fees: number;
  status: string;
  open_time: string;
  close_time: string | null;
  order_id: string;
}

export default function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    strategyId: '',
    symbol: '',
    limit: 100,
  });
  const [stats, setStats] = useState({
    totalTrades: 0,
    totalPnl: 0,
    totalFees: 0,
  });

  useEffect(() => {
    loadTrades();
  }, [filters]);

  const loadTrades = async () => {
    try {
      setLoading(true);
      const params: any = { limit: filters.limit };
      if (filters.strategyId) params.strategyId = filters.strategyId;
      if (filters.symbol) params.symbol = filters.symbol;

      const response = await quantApi.getTrades(params);
      if (response.success) {
        const tradesData = response.data || [];
        setTrades(tradesData);

        // 计算统计信息
        const totalPnl = tradesData.reduce((sum: number, t: Trade) => sum + (parseFloat(t.pnl?.toString() || '0')), 0);
        const totalFees = tradesData.reduce((sum: number, t: Trade) => sum + (parseFloat(t.fees?.toString() || '0')), 0);
        setStats({
          totalTrades: tradesData.length,
          totalPnl,
          totalFees,
        });
      } else {
        setError('加载交易记录失败');
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '加载交易记录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6">
      <BackButton />
      <h1 className="text-3xl font-bold mb-6">交易记录</h1>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-gray-500 text-sm">总交易数</div>
          <div className="text-2xl font-bold">{stats.totalTrades}</div>
        </div>
        <div className={`bg-white p-4 rounded-lg shadow ${stats.totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          <div className="text-gray-500 text-sm">总盈亏</div>
          <div className="text-2xl font-bold">${stats.totalPnl.toFixed(2)}</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-gray-500 text-sm">总手续费</div>
          <div className="text-2xl font-bold">${stats.totalFees.toFixed(2)}</div>
        </div>
      </div>

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
            <label className="block text-sm font-medium mb-1">标的代码</label>
            <input
              type="text"
              value={filters.symbol}
              onChange={(e) => setFilters({ ...filters, symbol: e.target.value })}
              className="border rounded px-3 py-2 w-full"
              placeholder="如: AAPL.US"
            />
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
      ) : trades.length === 0 ? (
        <div className="text-center py-8 text-gray-500">暂无交易记录</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">开仓时间</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">策略ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">标的</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">方向</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">数量</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">均价</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">盈亏</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">手续费</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">订单ID</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {trades.map((trade) => (
                <tr key={trade.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {new Date(trade.open_time).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">{trade.strategy_id}</td>
                  <td className="px-6 py-4 whitespace-nowrap font-mono text-sm">{trade.symbol}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        trade.side === 'BUY'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {trade.side}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">{trade.quantity}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    ${parseFloat(trade.avg_price?.toString() || '0').toFixed(2)}
                  </td>
                  <td className={`px-6 py-4 whitespace-nowrap text-sm ${
                    trade.pnl && parseFloat(trade.pnl.toString()) >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {trade.pnl !== null ? `$${parseFloat(trade.pnl.toString()).toFixed(2)}` : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    ${parseFloat(trade.fees?.toString() || '0').toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        trade.status === 'FILLED'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {trade.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-xs">
                    {trade.order_id || '-'}
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

