'use client'

import { useEffect, useState } from 'react'
import { watchlistApi } from '@/lib/api'
import BackButton from '@/components/BackButton'

interface WatchlistItem {
  id: number
  symbol: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export default function WatchlistPage() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [newSymbol, setNewSymbol] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const fetchWatchlist = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await watchlistApi.getWatchlist()
      if (response.success && response.data?.watchlist) {
        setWatchlist(response.data.watchlist)
      }
    } catch (err: any) {
      setError(err.message || '获取关注列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWatchlist()
  }, [])

  const handleAdd = async () => {
    if (!newSymbol.trim()) {
      setError('请输入股票代码')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      await watchlistApi.addWatchlist(newSymbol.trim())
      setSuccess('添加成功')
      setNewSymbol('')
      fetchWatchlist()
    } catch (err: any) {
      setError(err.message || '添加失败')
    } finally {
      setLoading(false)
    }
  }

  const handleRemove = async (symbol: string) => {
    if (!confirm(`确定要移除 ${symbol} 吗？`)) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      await watchlistApi.removeWatchlist(symbol)
      setSuccess('移除成功')
      fetchWatchlist()
    } catch (err: any) {
      setError(err.message || '移除失败')
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = async (symbol: string, enabled: boolean) => {
    setLoading(true)
    setError(null)

    try {
      await watchlistApi.updateWatchlist(symbol, !enabled)
      setSuccess('更新成功')
      fetchWatchlist()
    } catch (err: any) {
      setError(err.message || '更新失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-4">
            <BackButton />
          </div>
          <div className="bg-white shadow rounded-lg p-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">关注股票管理</h1>

            {/* 添加股票 */}
            <div className="mb-6">
              <div className="flex gap-4">
                <input
                  type="text"
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value)}
                  placeholder="请输入股票代码，例如：AAPL.US（美股）"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
                />
                <button
                  onClick={handleAdd}
                  disabled={loading}
                  className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {loading ? '添加中...' : '添加'}
                </button>
              </div>
              <p className="mt-2 text-sm text-gray-500">格式：ticker.region，例如：AAPL.US（美股）。注意：当前账户只有美股Basic行情权限</p>
            </div>

            {/* 消息提示 */}
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
                {error}
              </div>
            )}
            {success && (
              <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-md text-green-700">
                {success}
              </div>
            )}

            {/* 关注列表 */}
            {watchlist.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        标的代码
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        状态
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        添加时间
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {watchlist.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {item.symbol}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <label className="inline-flex items-center">
                            <input
                              type="checkbox"
                              checked={item.enabled}
                              onChange={() => handleToggle(item.symbol, item.enabled)}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="ml-2 text-sm text-gray-700">
                              {item.enabled ? '启用' : '禁用'}
                            </span>
                          </label>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(item.created_at).toLocaleString('zh-CN')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => handleRemove(item.symbol)}
                            className="text-red-600 hover:text-red-800"
                          >
                            移除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                暂无关注股票，请添加您关注的股票
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

