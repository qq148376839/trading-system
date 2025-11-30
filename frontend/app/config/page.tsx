'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { configApi, tokenRefreshApi } from '@/lib/api'

interface ConfigItem {
  key: string
  value: string
  encrypted: boolean
  description: string
  updatedAt: string
  updatedBy: string | null
}

export default function ConfigPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [configs, setConfigs] = useState<ConfigItem[]>([])
  const [editingConfig, setEditingConfig] = useState<{ key: string; value: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tokenStatus, setTokenStatus] = useState<{
    expiredAt: string | null
    issuedAt: string | null
    daysUntilExpiry: number | null
    shouldRefresh: boolean
  } | null>(null)
  const [admins, setAdmins] = useState<Array<{
    id: number
    username: string
    created_at: string
    last_login_at: string | null
    is_active: boolean
  }>>([])
  const [showAdminManagement, setShowAdminManagement] = useState(false)
  const [editingAdmin, setEditingAdmin] = useState<{ 
    id: number
    username: string
    oldPassword: string      // 原密码（用于修改密码时验证）
    newPassword: string       // 新密码
    confirmPassword: string   // 确认新密码
    is_active: boolean 
  } | null>(null)
  const [newAdmin, setNewAdmin] = useState({ username: '', password: '', confirmPassword: '' })

  // 检查Token状态
  useEffect(() => {
    const checkTokenStatus = async () => {
      try {
        const result = await tokenRefreshApi.getTokenStatus()
        if (result.success) {
          setTokenStatus(result.data)
        }
      } catch (error: any) {
        console.error('获取Token状态失败:', error.message)
      }
    }
    if (isAuthenticated) {
      checkTokenStatus()
    }
  }, [isAuthenticated])

  // 登录
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const result = await configApi.login(username, password)
      if (result.success) {
        setIsAuthenticated(true)
        await loadConfigs()
      }
    } catch (error: any) {
      setError(error.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  // 加载配置
  const loadConfigs = async () => {
    try {
      const result = await configApi.getConfigs(username, password)
      if (result.success) {
        setConfigs(result.data.configs)
        // 重新获取Token状态（因为配置可能影响Token状态显示）
        try {
          const statusResult = await tokenRefreshApi.getTokenStatus()
          if (statusResult.success) {
            setTokenStatus(statusResult.data)
          }
        } catch (e) {
          // 忽略Token状态获取失败
        }
      }
    } catch (error: any) {
      setError(error.message || '加载配置失败')
    }
  }

  // 加载管理员列表
  const loadAdmins = async () => {
    try {
      const result = await configApi.getAdminList(username, password)
      if (result.success) {
        setAdmins(result.data.admins)
      }
    } catch (error: any) {
      setError(error.message || '加载管理员列表失败')
    }
  }

  // 更新管理员账户
  const handleUpdateAdmin = async (
    adminId: number, 
    updates: { 
      username?: string
      oldPassword?: string
      newPassword?: string
      confirmPassword?: string
      is_active?: boolean 
    }
  ) => {
    // 检查是否有有效的更新字段
    const hasUpdates = (updates.username !== undefined && updates.username !== null && updates.username !== '') ||
                      (updates.newPassword !== undefined && updates.newPassword !== null && updates.newPassword !== '') ||
                      (updates.is_active !== undefined && updates.is_active !== null)
    
    if (!hasUpdates) {
      setError('没有需要更新的内容')
      setTimeout(() => setError(null), 3000)
      return
    }

    // 如果更新密码，验证两次输入是否一致
    if (updates.newPassword) {
      if (!updates.oldPassword) {
        setError('修改密码需要提供原密码')
        setTimeout(() => setError(null), 3000)
        return
      }
      if (updates.newPassword !== updates.confirmPassword) {
        setError('新密码两次输入不一致')
        setTimeout(() => setError(null), 3000)
        return
      }
      if (updates.newPassword.length < 6) {
        setError('密码长度至少6位')
        setTimeout(() => setError(null), 3000)
        return
      }
    }

    setLoading(true)
    setError(null)

    try {
      const result = await configApi.updateAdmin(adminId, updates, username, password)
      if (result.success) {
        await loadAdmins()
        setEditingAdmin(null)
      }
    } catch (error: any) {
      setError(error.message || '更新管理员账户失败')
    } finally {
      setLoading(false)
    }
  }

  // 创建管理员账户
  const handleCreateAdmin = async () => {
    if (!newAdmin.username || !newAdmin.password) {
      setError('请输入用户名和密码')
      return
    }

    if (newAdmin.password !== newAdmin.confirmPassword) {
      setError('密码两次输入不一致')
      return
    }

    if (newAdmin.password.length < 6) {
      setError('密码长度至少6位')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await configApi.createAdmin(newAdmin.username, newAdmin.password, username, password)
      if (result.success) {
        await loadAdmins()
        setNewAdmin({ username: '', password: '', confirmPassword: '' })
      } else {
        setError(result.error?.message || '创建管理员账户失败')
      }
    } catch (error: any) {
      setError(error.message || '创建管理员账户失败')
    } finally {
      setLoading(false)
    }
  }

  // 更新配置
  const handleUpdateConfig = async (key: string, value: string) => {
    if (!value.trim()) {
      setError('配置值不能为空')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const config = configs.find(c => c.key === key)
      const encrypted = config?.encrypted || false

      await configApi.updateConfig(key, value, encrypted, username, password)
      await loadConfigs()
      setEditingConfig(null)
    } catch (error: any) {
      setError(error.message || '更新配置失败')
    } finally {
      setLoading(false)
    }
  }

  // 刷新Token
  const handleRefreshToken = async () => {
    if (!confirm('确定要刷新Token吗？刷新后旧的Token将失效。')) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await tokenRefreshApi.refreshToken()
      if (result.success) {
        alert('Token刷新成功！')
        await loadConfigs()
        // 重新获取Token状态
        const statusResult = await tokenRefreshApi.getTokenStatus()
        if (statusResult.success) {
          setTokenStatus(statusResult.data)
        }
      }
    } catch (error: any) {
      setError(error.message || '刷新Token失败')
    } finally {
      setLoading(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-md p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold mb-6 text-center">配置管理登录</h1>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                用户名
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </form>
          <div className="mt-4 text-sm text-gray-600">
            <p className="mb-2">注意：管理员账户需要在数据库中手动创建。</p>
            <p>可以使用以下SQL创建管理员账户：</p>
            <code className="block mt-2 p-2 bg-gray-100 rounded text-xs overflow-x-auto">
              INSERT INTO admin_users (username, password_hash) VALUES<br/>
              &nbsp;&nbsp;('admin', '$2b$10$...'); -- 密码需要使用bcrypt加密
            </code>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-blue-600 hover:text-blue-800">
                ← 返回主页
              </Link>
              <h1 className="text-2xl font-bold">系统配置管理</h1>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={async () => {
                  const newValue = !showAdminManagement
                  setShowAdminManagement(newValue)
                  if (newValue) {
                    await loadAdmins()
                  }
                }}
                className="text-gray-600 hover:text-gray-800"
              >
                {showAdminManagement ? '隐藏' : '显示'}管理员管理
              </button>
              <button
                onClick={() => {
                  setIsAuthenticated(false)
                  setUsername('')
                  setPassword('')
                }}
                className="text-gray-600 hover:text-gray-800"
              >
                退出登录
              </button>
            </div>
          </div>

          {/* Token状态显示 */}
          {tokenStatus && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h2 className="text-lg font-semibold mb-2">Token状态</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">过期时间:</span>
                  <div className="font-mono">
                    {tokenStatus.expiredAt 
                      ? new Date(tokenStatus.expiredAt).toLocaleString('zh-CN')
                      : '未设置'}
                  </div>
                </div>
                <div>
                  <span className="text-gray-600">剩余天数:</span>
                  <div className={`font-semibold ${
                    tokenStatus.daysUntilExpiry !== null && tokenStatus.daysUntilExpiry <= 10
                      ? 'text-red-600'
                      : 'text-green-600'
                  }`}>
                    {tokenStatus.daysUntilExpiry !== null 
                      ? `${tokenStatus.daysUntilExpiry} 天`
                      : '未知'}
                  </div>
                </div>
                <div>
                  <span className="text-gray-600">自动刷新:</span>
                  <div className="text-sm">
                    {configs.find(c => c.key === 'longport_token_auto_refresh')?.value === 'true' 
                      ? <span className="text-green-600">已启用（&lt;10天自动刷新）</span>
                      : <span className="text-gray-500">已禁用</span>}
                  </div>
                </div>
                <div>
                  <span className="text-gray-600">需要刷新:</span>
                  <div className={tokenStatus.shouldRefresh ? 'text-red-600 font-semibold' : 'text-green-600'}>
                    {tokenStatus.shouldRefresh ? '是（&lt;10天）' : '否'}
                  </div>
                </div>
                <div>
                  <button
                    onClick={handleRefreshToken}
                    disabled={loading}
                    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {loading ? '刷新中...' : '刷新Token'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {/* 管理员账户管理 */}
          {showAdminManagement && (
            <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <h2 className="text-lg font-semibold mb-4">管理员账户管理</h2>
              
              {/* 创建新管理员 */}
              <div className="mb-4 p-3 bg-white rounded border">
                <h3 className="text-sm font-medium mb-2">创建新管理员</h3>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="用户名"
                    value={newAdmin.username}
                    onChange={(e) => setNewAdmin({ ...newAdmin, username: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                  <input
                    type="password"
                    placeholder="密码（至少6位）"
                    value={newAdmin.password}
                    onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                  <input
                    type="password"
                    placeholder="确认密码"
                    value={newAdmin.confirmPassword}
                    onChange={(e) => setNewAdmin({ ...newAdmin, confirmPassword: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                  <button
                    onClick={handleCreateAdmin}
                    disabled={loading}
                    className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
                  >
                    创建
                  </button>
                </div>
              </div>

              {/* 管理员列表 */}
              <div className="overflow-x-auto">
                {admins.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    暂无管理员账户
                  </div>
                ) : (
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">用户名</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">创建时间</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">最后登录</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">状态</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">操作</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {admins.map((admin) => (
                      <tr key={admin.id}>
                        <td className="px-4 py-2 text-sm">
                          {editingAdmin?.id === admin.id ? (
                            <input
                              type="text"
                              value={editingAdmin.username}
                              onChange={(e) => setEditingAdmin({ ...editingAdmin, username: e.target.value })}
                              className="w-full px-2 py-1 border border-gray-300 rounded"
                              autoFocus
                            />
                          ) : (
                            admin.username
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-600">
                          {new Date(admin.created_at).toLocaleString('zh-CN')}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-600">
                          {admin.last_login_at ? new Date(admin.last_login_at).toLocaleString('zh-CN') : '从未登录'}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          <span className={`px-2 py-1 rounded text-xs ${
                            admin.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {admin.is_active ? '启用' : '禁用'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm">
                          <div className="flex gap-2 flex-wrap">
                            {editingAdmin?.id === admin.id ? (
                              <div className="w-full space-y-2">
                                {/* 用户名编辑提示 */}
                                {editingAdmin.username !== admin.username && (
                                  <div className="text-xs text-gray-600">用户名已修改</div>
                                )}
                                
                                {/* 密码修改区域 */}
                                <div className="space-y-1">
                                  <input
                                    type="password"
                                    placeholder="原密码（修改密码时必填）"
                                    value={editingAdmin.oldPassword}
                                    onChange={(e) => setEditingAdmin({ ...editingAdmin, oldPassword: e.target.value })}
                                    className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                                  />
                                  <input
                                    type="password"
                                    placeholder="新密码（留空不修改）"
                                    value={editingAdmin.newPassword}
                                    onChange={(e) => setEditingAdmin({ ...editingAdmin, newPassword: e.target.value })}
                                    className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                                  />
                                  <input
                                    type="password"
                                    placeholder="确认新密码"
                                    value={editingAdmin.confirmPassword}
                                    onChange={(e) => setEditingAdmin({ ...editingAdmin, confirmPassword: e.target.value })}
                                    className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                                  />
                                </div>
                                
                                {/* 操作按钮 */}
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => {
                                      const updates: any = {}
                                      
                                      // 用户名更新
                                      if (editingAdmin.username !== admin.username && editingAdmin.username.trim() !== '') {
                                        updates.username = editingAdmin.username.trim()
                                      }
                                      
                                      // 密码更新
                                      if (editingAdmin.newPassword && editingAdmin.newPassword.trim() !== '') {
                                        updates.oldPassword = editingAdmin.oldPassword
                                        updates.newPassword = editingAdmin.newPassword.trim()
                                        updates.confirmPassword = editingAdmin.confirmPassword
                                      }
                                      
                                      if (Object.keys(updates).length > 0) {
                                        handleUpdateAdmin(admin.id, updates)
                                      } else {
                                        setError('没有需要更新的内容')
                                        setTimeout(() => setError(null), 3000)
                                      }
                                    }}
                                    className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                                  >
                                    保存
                                  </button>
                                  <button
                                    onClick={() => setEditingAdmin(null)}
                                    className="px-2 py-1 bg-gray-400 text-white rounded text-xs hover:bg-gray-500"
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <button
                                  onClick={() => setEditingAdmin({ 
                                    id: admin.id, 
                                    username: admin.username, 
                                    oldPassword: '',
                                    newPassword: '',
                                    confirmPassword: '',
                                    is_active: admin.is_active 
                                  })}
                                  className="text-blue-600 hover:text-blue-800 text-xs whitespace-nowrap"
                                >
                                  编辑
                                </button>
                                <button
                                  onClick={() => handleUpdateAdmin(admin.id, { is_active: !admin.is_active })}
                                  className={`text-xs whitespace-nowrap ${
                                    admin.is_active ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'
                                  }`}
                                >
                                  {admin.is_active ? '禁用' : '启用'}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    配置项
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    描述
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    当前值
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {configs.map((config) => (
                  <tr key={config.key}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{config.key}</div>
                      {config.encrypted && (
                        <div className="text-xs text-gray-500">已加密</div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">{config.description}</div>
                    </td>
                    <td className="px-6 py-4">
                      {editingConfig?.key === config.key ? (
                        <input
                          type={config.encrypted ? 'password' : 'text'}
                          value={editingConfig.value === '***已加密***' ? '' : editingConfig.value}
                          onChange={(e) => setEditingConfig({ key: config.key, value: e.target.value })}
                          onBlur={(e) => {
                            if (e.target.value !== config.value && e.target.value !== '') {
                              handleUpdateConfig(config.key, e.target.value)
                            } else {
                              setEditingConfig(null)
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              if (e.currentTarget.value !== config.value && e.currentTarget.value !== '') {
                                handleUpdateConfig(config.key, e.currentTarget.value)
                              } else {
                                setEditingConfig(null)
                              }
                            } else if (e.key === 'Escape') {
                              setEditingConfig(null)
                            }
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                        />
                      ) : (
                        <div className="text-sm text-gray-900 font-mono">
                          {config.value}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => setEditingConfig({ key: config.key, value: config.value })}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 text-sm text-gray-600">
            <p className="mb-2">注意：</p>
            <ul className="list-disc list-inside space-y-1">
              <li>加密的配置项（如API密钥）显示为"***已加密***"，编辑时需要输入完整的新值</li>
              <li>修改配置后，相关服务可能需要重启才能生效</li>
              <li>Token刷新后，旧的Token将失效，系统会自动重新初始化</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

