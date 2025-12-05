'use client';

import { useState, useEffect } from 'react';
import { quantApi } from '@/lib/api';
import Link from 'next/link';

interface Overview {
  runningStrategies: number;
  totalCapital: number;
  todayTrades: number;
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

      const tradesRes = await quantApi.getTrades({ limit: 100 });
      const trades = tradesRes.data || [];
      const today = new Date().toISOString().split('T')[0];
      const todayTrades = trades.filter((t: any) => 
        t.open_time?.startsWith(today)
      ).length;
      const todayPnl = trades
        .filter((t: any) => t.open_time?.startsWith(today) && t.pnl)
        .reduce((sum: number, t: any) => sum + parseFloat(t.pnl || 0), 0);

      setOverview({
        runningStrategies,
        totalCapital,
        todayTrades,
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

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">加载中...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      {/* 顶部导航栏 */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">量化交易</h1>
        <div className="flex gap-4">
          <Link
            href="/orders"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            <span>📋</span>
            <span>订单查询</span>
          </Link>
        </div>
      </div>
      <h1 className="text-3xl font-bold mb-6">量化交易中心</h1>

      {/* 总览卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-gray-500 text-sm">运行中策略</div>
          <div className="text-2xl font-bold">{overview?.runningStrategies || 0}</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-gray-500 text-sm">总资金</div>
          <div className="text-2xl font-bold">${(overview?.totalCapital || 0).toFixed(2)}</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-gray-500 text-sm">今日交易</div>
          <div className="text-2xl font-bold">{overview?.todayTrades || 0}</div>
        </div>
        <div className={`bg-white p-4 rounded-lg shadow ${(overview?.todayPnl || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          <div className="text-gray-500 text-sm">今日盈亏</div>
          <div className="text-2xl font-bold">${(overview?.todayPnl || 0).toFixed(2)}</div>
        </div>
      </div>

      {/* 快速操作 */}
      <div className="mb-6 flex gap-4 flex-wrap">
        <Link
          href="/quant/strategies"
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition-colors"
        >
          策略管理
        </Link>
        <Link
          href="/quant/capital"
          className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 transition-colors"
        >
          资金管理
        </Link>
        <Link
          href="/quant/signals"
          className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600 transition-colors"
        >
          信号日志
        </Link>
        <Link
          href="/quant/trades"
          className="bg-orange-500 text-white px-4 py-2 rounded hover:bg-orange-600 transition-colors"
        >
          交易记录
        </Link>
        <Link
          href="/quant/backtest"
          className="bg-teal-500 text-white px-4 py-2 rounded hover:bg-teal-600 transition-colors"
        >
          回测管理
        </Link>
        <Link
          href="/orders"
          className="bg-indigo-500 text-white px-4 py-2 rounded hover:bg-indigo-600 transition-colors flex items-center gap-2"
        >
          <span>📋</span>
          <span>订单查询</span>
        </Link>
      </div>

      {/* 实时信号流 */}
      <div className="bg-white p-4 rounded-lg shadow">
        <h2 className="text-xl font-bold mb-4">最近信号</h2>
        {recentSignals.length === 0 ? (
          <div className="text-gray-500 text-center py-8">暂无信号</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-4 py-2 text-left">时间</th>
                  <th className="px-4 py-2 text-left">标的</th>
                  <th className="px-4 py-2 text-left">信号</th>
                  <th className="px-4 py-2 text-left">价格</th>
                  <th className="px-4 py-2 text-left">状态</th>
                </tr>
              </thead>
              <tbody>
                {recentSignals.map((signal) => (
                  <tr key={signal.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      {new Date(signal.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 font-mono">{signal.symbol}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`px-2 py-1 rounded ${
                          signal.signal_type === 'BUY'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {signal.signal_type}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {signal.price != null 
                        ? `$${parseFloat(String(signal.price)).toFixed(2)}` 
                        : '-'}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`px-2 py-1 rounded ${
                          signal.status === 'EXECUTED'
                            ? 'bg-blue-100 text-blue-800'
                            : signal.status === 'REJECTED'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {signal.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

