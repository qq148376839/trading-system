'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { configApi, tokenRefreshApi } from '@/lib/api'
import AppLayout from '@/components/AppLayout'
import { Button, Input, Table, Card, Space, Modal, message, Alert, Tag, Spin, Switch, Form } from 'antd'

interface ConfigItem {
  key: string
  value: string
  encrypted: boolean
  description: string
  updatedAt: string
  updatedBy: string | null
}

interface MoomooCookieRow {
  id: string
  csrfToken: string
  cookies: string
  label: string
  status: 'unknown' | 'testing' | 'valid' | 'expired'
  testMessage?: string
}

// 配置表格中隐藏的键（由 Moomoo Cookie 管理区接管）
const HIDDEN_CONFIG_KEYS = ['moomoo_guest_cookies', 'futunn_cookies', 'futunn_csrf_token', 'futunn_search_cookies']

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
    oldPassword: string
    newPassword: string
    confirmPassword: string
    is_active: boolean
  } | null>(null)
  const [newAdmin, setNewAdmin] = useState({ username: '', password: '', confirmPassword: '' })

  // Moomoo Cookie 管理状态
  const [cookieRows, setCookieRows] = useState<MoomooCookieRow[]>([])
  const [cookieSaving, setCookieSaving] = useState(false)

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

  // 加载 Moomoo Cookies
  const loadMoomooCookies = useCallback(async (authUsername?: string, authPassword?: string) => {
    const u = authUsername || username
    const p = authPassword || password
    try {
      const result = await configApi.getConfigValue('moomoo_guest_cookies', u, p)
      if (result.success && result.data?.value) {
        const raw = result.data.value
        if (raw && raw.trim() !== '' && raw.trim() !== '[]') {
          const parsed: Array<{ csrfToken?: string; cookies?: string; label?: string }> = JSON.parse(raw)
          const rows: MoomooCookieRow[] = parsed.map((item, idx) => ({
            id: `cookie-${Date.now()}-${idx}`,
            csrfToken: item.csrfToken || '',
            cookies: item.cookies || '',
            label: item.label || `Guest #${idx + 1}`,
            status: 'unknown' as const,
          }))
          setCookieRows(rows)
          return
        }
      }
      setCookieRows([])
    } catch {
      // 初次加载失败时不报错，保持空列表
      setCookieRows([])
    }
  }, [username, password])

  // 登录
  const handleLogin = async (values: { username: string; password: string }) => {
    setLoading(true)
    setError(null)

    try {
      const result = await configApi.login(values.username, values.password)
      if (result.success) {
        setUsername(values.username)
        setPassword(values.password)
        setIsAuthenticated(true)
        await loadConfigs(values.username, values.password)
        await loadMoomooCookies(values.username, values.password)
      }
    } catch (error: any) {
      setError(error.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  // 加载配置
  const loadConfigs = async (authUsername?: string, authPassword?: string) => {
    const currentUsername = authUsername || username
    const currentPassword = authPassword || password
    try {
      const result = await configApi.getConfigs(currentUsername, currentPassword)
      if (result.success) {
        setConfigs(result.data.configs)
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
  const loadAdmins = async (authUsername?: string, authPassword?: string) => {
    const currentUsername = authUsername || username
    const currentPassword = authPassword || password
    try {
      const result = await configApi.getAdminList(currentUsername, currentPassword)
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
    const hasUpdates = (updates.username !== undefined && updates.username !== null && updates.username !== '') ||
                      (updates.newPassword !== undefined && updates.newPassword !== null && updates.newPassword !== '') ||
                      (updates.is_active !== undefined && updates.is_active !== null)

    if (!hasUpdates) {
      message.warning('没有需要更新的内容')
      return
    }

    if (updates.newPassword) {
      if (!updates.oldPassword) {
        message.error('修改密码需要提供原密码')
        return
      }
      if (updates.newPassword !== updates.confirmPassword) {
        message.error('新密码两次输入不一致')
        return
      }
      if (updates.newPassword.length < 6) {
        message.error('密码长度至少6位')
        return
      }
    }

    setLoading(true)
    setError(null)

    try {
      const result = await configApi.updateAdmin(adminId, updates, username, password)
      if (result.success) {
        message.success('更新成功')
        await loadAdmins()
        setEditingAdmin(null)
      }
    } catch (error: any) {
      message.error(error.message || '更新管理员账户失败')
    } finally {
      setLoading(false)
    }
  }

  // 创建管理员账户
  const handleCreateAdmin = async () => {
    if (!newAdmin.username || !newAdmin.password) {
      message.error('请输入用户名和密码')
      return
    }

    if (newAdmin.password !== newAdmin.confirmPassword) {
      message.error('密码两次输入不一致')
      return
    }

    if (newAdmin.password.length < 6) {
      message.error('密码长度至少6位')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await configApi.createAdmin(newAdmin.username, newAdmin.password, username, password)
      if (result.success) {
        message.success('创建成功')
        await loadAdmins()
        setNewAdmin({ username: '', password: '', confirmPassword: '' })
      } else {
        message.error(result.error?.message || '创建管理员账户失败')
      }
    } catch (error: any) {
      message.error(error.message || '创建管理员账户失败')
    } finally {
      setLoading(false)
    }
  }

  // 更新配置
  const handleUpdateConfig = async (key: string, value: string) => {
    if (!value.trim()) {
      message.warning('配置值不能为空')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const config = configs.find(c => c.key === key)
      const encrypted = config?.encrypted || false

      await configApi.updateConfig(key, value, encrypted, username, password)
      message.success('配置更新成功')
      await loadConfigs()
      setEditingConfig(null)
    } catch (error: any) {
      message.error(error.message || '更新配置失败')
    } finally {
      setLoading(false)
    }
  }

  // 刷新Token
  const handleRefreshToken = async () => {
    Modal.confirm({
      title: '确认刷新Token',
      content: '确定要刷新Token吗？刷新后旧的Token将失效。',
      onOk: async () => {
        setLoading(true)
        setError(null)

        try {
          const result = await tokenRefreshApi.refreshToken()
          if (result.success) {
            message.success('Token刷新成功！')
            await loadConfigs()
            const statusResult = await tokenRefreshApi.getTokenStatus()
            if (statusResult.success) {
              setTokenStatus(statusResult.data)
            }
          }
        } catch (error: any) {
          message.error(error.message || '刷新Token失败')
        } finally {
          setLoading(false)
        }
      },
    })
  }

  // ── Moomoo Cookie 管理 ──────────────────────────────────
  const handleAddCookieRow = () => {
    setCookieRows(prev => [
      ...prev,
      {
        id: `cookie-${Date.now()}`,
        csrfToken: '',
        cookies: '',
        label: `Guest #${prev.length + 1}`,
        status: 'unknown',
      },
    ])
  }

  const handleRemoveCookieRow = (id: string) => {
    setCookieRows(prev => prev.filter(r => r.id !== id))
  }

  const handleUpdateCookieRow = (id: string, field: keyof MoomooCookieRow, value: string) => {
    setCookieRows(prev =>
      prev.map(r => (r.id === id ? { ...r, [field]: value, status: 'unknown' as const, testMessage: undefined } : r))
    )
  }

  const handleTestCookie = async (id: string) => {
    const row = cookieRows.find(r => r.id === id)
    if (!row) return
    if (!row.csrfToken.trim() || !row.cookies.trim()) {
      message.warning('请先填写 csrfToken 和 cookies')
      return
    }

    setCookieRows(prev => prev.map(r => (r.id === id ? { ...r, status: 'testing' as const, testMessage: undefined } : r)))

    try {
      const result = await configApi.testMoomooCookie(row.cookies.trim(), row.csrfToken.trim(), username, password)
      if (result.success && result.data) {
        const { cookieValid, duration, dataPoints, responseMessage } = result.data
        setCookieRows(prev =>
          prev.map(r =>
            r.id === id
              ? {
                  ...r,
                  status: cookieValid ? 'valid' : 'expired',
                  testMessage: cookieValid
                    ? `${duration} | ${dataPoints}条数据`
                    : responseMessage,
                }
              : r
          )
        )
      }
    } catch (err: any) {
      setCookieRows(prev =>
        prev.map(r => (r.id === id ? { ...r, status: 'expired' as const, testMessage: err.message } : r))
      )
    }
  }

  const handleSaveCookies = async () => {
    // 过滤空行
    const validRows = cookieRows.filter(r => r.csrfToken.trim() && r.cookies.trim())
    const payload = validRows.map((r, idx) => ({
      csrfToken: r.csrfToken.trim(),
      cookies: r.cookies.trim(),
      label: r.label.trim() || `Guest #${idx + 1}`,
    }))

    setCookieSaving(true)
    try {
      await configApi.updateConfig('moomoo_guest_cookies', JSON.stringify(payload), true, username, password)
      message.success('Moomoo Cookies 保存成功')
      await loadConfigs()
    } catch (err: any) {
      message.error(err.message || '保存失败')
    } finally {
      setCookieSaving(false)
    }
  }

  const statusTag = (row: MoomooCookieRow) => {
    switch (row.status) {
      case 'testing':
        return <Tag color="processing">测试中...</Tag>
      case 'valid':
        return <Tag color="success">有效 {row.testMessage}</Tag>
      case 'expired':
        return <Tag color="error">过期 {row.testMessage ? `- ${row.testMessage}` : ''}</Tag>
      default:
        return <Tag>未测试</Tag>
    }
  }

  if (!isAuthenticated) {
    return (
      <AppLayout>
        <Card style={{ maxWidth: 500, margin: '40px auto' }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24, textAlign: 'center' }}>配置管理登录</h1>
          <Form onFinish={handleLogin} layout="vertical">
            <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input
                placeholder="请输入用户名"
              />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password
                placeholder="请输入密码"
              />
            </Form.Item>
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
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block>
                登录
              </Button>
            </Form.Item>
          </Form>
          <Alert
            message="注意"
            description={
              <div>
                <p style={{ marginBottom: 8 }}>管理员账户需要在数据库中手动创建。</p>
                <p>可以使用以下SQL创建管理员账户：</p>
                <code style={{ display: 'block', marginTop: 8, padding: 8, background: '#f5f5f5', borderRadius: 4, fontSize: 12 }}>
                  INSERT INTO admin_users (username, password_hash) VALUES<br/>
                  &nbsp;&nbsp;('admin', '$2b$10$...'); -- 密码需要使用bcrypt加密
                </code>
              </div>
            }
            type="info"
            showIcon
            style={{ marginTop: 16 }}
          />
        </Card>
      </AppLayout>
    )
  }

  const configColumns = [
    {
      title: '配置项',
      key: 'key',
      dataIndex: 'key',
      render: (_: any, record: ConfigItem) => (
        <div>
          <div style={{ fontWeight: 500 }}>{record.key}</div>
          {record.encrypted && (
            <Tag color="orange" style={{ marginTop: 4 }}>已加密</Tag>
          )}
        </div>
      ),
    },
    {
      title: '描述',
      key: 'description',
      dataIndex: 'description',
    },
    {
      title: '当前值',
      key: 'value',
      render: (_: any, record: ConfigItem) => {
        if (editingConfig?.key === record.key) {
          return (
            <Input
              type={record.encrypted ? 'password' : 'text'}
              value={editingConfig.value === '***已加密***' ? '' : editingConfig.value}
              onChange={(e) => setEditingConfig({ key: record.key, value: e.target.value })}
              onBlur={(e) => {
                if (e.target.value !== record.value && e.target.value !== '') {
                  handleUpdateConfig(record.key, e.target.value)
                } else {
                  setEditingConfig(null)
                }
              }}
              onPressEnter={(e) => {
                const target = e.target as HTMLInputElement
                if (target.value !== record.value && target.value !== '') {
                  handleUpdateConfig(record.key, target.value)
                } else {
                  setEditingConfig(null)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setEditingConfig(null)
                }
              }}
              autoFocus
            />
          )
        }
        return (
          <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{record.value}</div>
        )
      },
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: ConfigItem) => (
        <Button
          type="link"
          onClick={() => setEditingConfig({ key: record.key, value: record.value })}
        >
          编辑
        </Button>
      ),
    },
  ]

  const adminColumns = [
    {
      title: '用户名',
      key: 'username',
      render: (_: any, record: typeof admins[0]) => {
        if (editingAdmin?.id === record.id) {
          return (
            <Input
              value={editingAdmin.username}
              onChange={(e) => setEditingAdmin({ ...editingAdmin, username: e.target.value })}
              autoFocus
            />
          )
        }
        return record.username
      },
    },
    {
      title: '创建时间',
      key: 'created_at',
      render: (_: any, record: typeof admins[0]) =>
        new Date(record.created_at).toLocaleString('zh-CN'),
    },
    {
      title: '最后登录',
      key: 'last_login_at',
      render: (_: any, record: typeof admins[0]) =>
        record.last_login_at ? new Date(record.last_login_at).toLocaleString('zh-CN') : '从未登录',
    },
    {
      title: '状态',
      key: 'is_active',
      render: (_: any, record: typeof admins[0]) => (
        <Tag color={record.is_active ? 'success' : 'error'}>
          {record.is_active ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 300,
      render: (_: any, record: typeof admins[0]) => {
        if (editingAdmin?.id === record.id) {
          return (
            <div>
              <div style={{ marginBottom: 8 }}>
                {editingAdmin.username !== record.username && (
                  <div style={{ fontSize: 12, color: '#999' }}>用户名已修改</div>
                )}
              </div>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Input.Password
                  placeholder="原密码（修改密码时必填）"
                  value={editingAdmin.oldPassword}
                  onChange={(e) => setEditingAdmin({ ...editingAdmin, oldPassword: e.target.value })}
                  size="small"
                />
                <Input.Password
                  placeholder="新密码（留空不修改）"
                  value={editingAdmin.newPassword}
                  onChange={(e) => setEditingAdmin({ ...editingAdmin, newPassword: e.target.value })}
                  size="small"
                />
                <Input.Password
                  placeholder="确认新密码"
                  value={editingAdmin.confirmPassword}
                  onChange={(e) => setEditingAdmin({ ...editingAdmin, confirmPassword: e.target.value })}
                  size="small"
                />
              </Space>
              <Space style={{ marginTop: 8 }}>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => {
                    const updates: any = {}

                    if (editingAdmin.username !== record.username && editingAdmin.username.trim() !== '') {
                      updates.username = editingAdmin.username.trim()
                    }

                    if (editingAdmin.newPassword && editingAdmin.newPassword.trim() !== '') {
                      updates.oldPassword = editingAdmin.oldPassword
                      updates.newPassword = editingAdmin.newPassword.trim()
                      updates.confirmPassword = editingAdmin.confirmPassword
                    }

                    if (Object.keys(updates).length > 0) {
                      handleUpdateAdmin(record.id, updates)
                    } else {
                      message.warning('没有需要更新的内容')
                    }
                  }}
                >
                  保存
                </Button>
                <Button size="small" onClick={() => setEditingAdmin(null)}>
                  取消
                </Button>
              </Space>
            </div>
          )
        }
        return (
          <Space>
            <Button
              type="link"
              size="small"
              onClick={() => setEditingAdmin({
                id: record.id,
                username: record.username,
                oldPassword: '',
                newPassword: '',
                confirmPassword: '',
                is_active: record.is_active
              })}
            >
              编辑
            </Button>
            <Button
              type="link"
              size="small"
              danger={record.is_active}
              onClick={() => handleUpdateAdmin(record.id, { is_active: !record.is_active })}
            >
              {record.is_active ? '禁用' : '启用'}
            </Button>
          </Space>
        )
      },
    },
  ]

  // 过滤掉由 Cookie 管理区接管的配置键
  const filteredConfigs = configs.filter(c => !HIDDEN_CONFIG_KEYS.includes(c.key))

  return (
    <AppLayout>
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Link href="/" style={{ color: '#1890ff' }}>
              &larr; 返回主页
            </Link>
            <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>系统配置管理</h1>
          </div>
          <Space wrap>
            <Button
              onClick={async () => {
                const newValue = !showAdminManagement
                setShowAdminManagement(newValue)
                if (newValue) {
                  await loadAdmins()
                }
              }}
            >
              {showAdminManagement ? '隐藏' : '显示'}管理员管理
            </Button>
            <Button
              onClick={() => {
                setIsAuthenticated(false)
                setUsername('')
                setPassword('')
              }}
            >
              退出登录
            </Button>
          </Space>
        </div>

        {/* Token状态显示 */}
        {tokenStatus && (
          <Card style={{ marginBottom: 16, backgroundColor: '#e6f7ff', borderColor: '#91d5ff' }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Token状态</h2>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>过期时间:</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {tokenStatus.expiredAt
                      ? new Date(tokenStatus.expiredAt).toLocaleString('zh-CN')
                      : '未设置'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>剩余天数:</div>
                  <div style={{
                    fontWeight: 600,
                    color: tokenStatus.daysUntilExpiry !== null && tokenStatus.daysUntilExpiry <= 10
                      ? '#ff4d4f'
                      : '#52c41a'
                  }}>
                    {tokenStatus.daysUntilExpiry !== null
                      ? `${tokenStatus.daysUntilExpiry} 天`
                      : '未知'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>自动刷新:</div>
                  <div>
                    {configs.find(c => c.key === 'longport_token_auto_refresh')?.value === 'true'
                      ? <Tag color="success">已启用（&lt;10天自动刷新）</Tag>
                      : <Tag>已禁用</Tag>}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>需要刷新:</div>
                  <div>
                    <Tag color={tokenStatus.shouldRefresh ? 'error' : 'success'}>
                      {tokenStatus.shouldRefresh ? '是（&lt;10天）' : '否'}
                    </Tag>
                  </div>
                </div>
              </div>
              <Button
                type="primary"
                onClick={handleRefreshToken}
                loading={loading}
              >
                刷新Token
              </Button>
            </Space>
          </Card>
        )}

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

        {/* Moomoo Cookie 管理 */}
        <Card style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Moomoo Cookie 管理</h2>
          <Alert
            message="使用说明"
            description="无痕浏览器打开 moomoo.com -> F12 -> Network -> 复制任意API请求的 Cookie 和 csrfToken。多组Cookie轮询可分散频率限制。保存后约5分钟生效（后端定时刷新）。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />

          {cookieRows.map((row, idx) => (
            <Card
              key={row.id}
              size="small"
              style={{ marginBottom: 12 }}
              title={
                <Space>
                  <span>#{idx + 1}</span>
                  <Input
                    size="small"
                    value={row.label}
                    onChange={(e) => handleUpdateCookieRow(row.id, 'label', e.target.value)}
                    style={{ width: 140 }}
                    placeholder="标签"
                  />
                  {statusTag(row)}
                </Space>
              }
              extra={
                <Space>
                  <Button
                    size="small"
                    onClick={() => handleTestCookie(row.id)}
                    loading={row.status === 'testing'}
                  >
                    测试
                  </Button>
                  <Button
                    size="small"
                    danger
                    onClick={() => handleRemoveCookieRow(row.id)}
                  >
                    删除
                  </Button>
                </Space>
              }
            >
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <div>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>csrfToken:</div>
                  <Input
                    size="small"
                    value={row.csrfToken}
                    onChange={(e) => handleUpdateCookieRow(row.id, 'csrfToken', e.target.value)}
                    placeholder="粘贴 csrfToken"
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>cookies:</div>
                  <Input.TextArea
                    rows={2}
                    value={row.cookies}
                    onChange={(e) => handleUpdateCookieRow(row.id, 'cookies', e.target.value)}
                    placeholder="粘贴完整 Cookie 字符串"
                    style={{ fontSize: 11, fontFamily: 'monospace' }}
                  />
                </div>
              </Space>
            </Card>
          ))}

          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 8 }}>
            <Button onClick={handleAddCookieRow}>+ 添加Cookie</Button>
            <Button type="primary" onClick={handleSaveCookies} loading={cookieSaving}>
              保存
            </Button>
          </div>
        </Card>

        {/* 管理员账户管理 */}
        {showAdminManagement && (
          <Card style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>管理员账户管理</h2>

            {/* 创建新管理员 */}
            <Card size="small" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>创建新管理员</h3>
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <Input
                  placeholder="用户名"
                  value={newAdmin.username}
                  onChange={(e) => setNewAdmin({ ...newAdmin, username: e.target.value })}
                />
                <Input.Password
                  placeholder="密码（至少6位）"
                  value={newAdmin.password}
                  onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })}
                />
                <Input.Password
                  placeholder="确认密码"
                  value={newAdmin.confirmPassword}
                  onChange={(e) => setNewAdmin({ ...newAdmin, confirmPassword: e.target.value })}
                />
                <Button
                  type="primary"
                  onClick={handleCreateAdmin}
                  loading={loading}
                  block
                  style={{ background: '#52c41a', borderColor: '#52c41a' }}
                >
                  创建
                </Button>
              </Space>
            </Card>

            {/* 管理员列表 */}
            <Table
              dataSource={admins}
              columns={adminColumns}
              rowKey="id"
              locale={{
                emptyText: '暂无管理员账户',
              }}
            />
          </Card>
        )}

        <Table
          dataSource={filteredConfigs}
          columns={configColumns}
          rowKey="key"
          pagination={false}
        />

        <Alert
          message="注意"
          description={
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>加密的配置项（如API密钥）显示为"***已加密***"，编辑时需要输入完整的新值</li>
              <li>修改配置后，相关服务可能需要重启才能生效</li>
              <li>Token刷新后，旧的Token将失效，系统会自动重新初始化</li>
            </ul>
          }
          type="info"
          showIcon
          style={{ marginTop: 16 }}
        />
      </Card>
    </AppLayout>
  )
}
