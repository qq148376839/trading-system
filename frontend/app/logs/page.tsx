'use client'

import { useState, useEffect, useCallback } from 'react'
import { logsApi } from '@/lib/api'
import AppLayout from '@/components/AppLayout'
import { 
  Card, 
  Table, 
  Input, 
  Select, 
  DatePicker, 
  Button, 
  Space, 
  Tag, 
  message, 
  Modal,
  Alert,
  Tooltip,
  Typography
} from 'antd'
import { DownloadOutlined, DeleteOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { ColumnsType } from 'antd/es/table'

// 配置 dayjs 插件
dayjs.extend(utc)
dayjs.extend(timezone)

const { RangePicker } = DatePicker
const { Text } = Typography

interface LogEntry {
  id: number
  timestamp: string
  level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG'
  module: string
  message: string
  traceId?: string
  extraData?: Record<string, any>
  filePath?: string
  lineNo?: number
  createdAt: string
}

interface ModuleInfo {
  module: string
  chineseName: string
  description: string
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [moduleList, setModuleList] = useState<ModuleInfo[]>([])
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set())

  // 筛选条件
  const [filters, setFilters] = useState({
    module: '',
    level: [] as string[],
    traceId: '',
    dateRange: null as [Dayjs | null, Dayjs | null] | null,
  })

  // 加载模块列表
  const loadModules = useCallback(async () => {
    try {
      const response = await logsApi.getModules()
      if (response.success && response.data) {
        setModuleList(response.data.modules)
      }
    } catch (err) {
      console.error('加载模块列表失败:', err)
      message.warning('加载模块列表失败，请手动输入模块名称')
    }
  }, [])

  // 初始加载模块列表
  useEffect(() => {
    loadModules()
  }, [loadModules])

  // 获取模块显示名称
  const getModuleDisplayName = (module: string) => {
    const item = moduleList.find(m => m.module === module)
    if (item && item.chineseName) {
      return `${item.chineseName} (${module})`
    }
    return module
  }

  // 美股盘中时间（美东时间 9:30-16:00）
  const getUSTradingHours = (): [Dayjs, Dayjs] => {
    const now = dayjs()
    const today = now.format('YYYY-MM-DD')
    
    // 美东时间 9:30
    const start = dayjs.tz(`${today} 09:30:00`, 'America/New_York')
    // 美东时间 16:00
    const end = dayjs.tz(`${today} 16:00:00`, 'America/New_York')
    
    // 转换为当前时区
    return [
      start.tz(dayjs.tz.guess()),
      end.tz(dayjs.tz.guess()),
    ]
  }

  // 切换消息展开/收起
  const toggleMessage = (id: number) => {
    const newExpanded = new Set(expandedMessages)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedMessages(newExpanded)
  }

  // 加载日志
  const loadLogs = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // 每次查询日志时，同时刷新模块列表（静默更新，不显示错误提示）
      loadModules().catch(() => {
        // 静默失败，不影响日志查询
      })

      const params: any = {
        limit: pageSize,
        offset: (currentPage - 1) * pageSize,
      }

      if (filters.module) {
        params.module = filters.module
      }

      if (filters.level.length > 0) {
        params.level = filters.level.join(',')
      }

      if (filters.traceId) {
        params.trace_id = filters.traceId
      }

      if (filters.dateRange && filters.dateRange[0] && filters.dateRange[1]) {
        params.start_time = filters.dateRange[0].toISOString()
        params.end_time = filters.dateRange[1].toISOString()
      }

      const response = await logsApi.getLogs(params)
      if (response.success && response.data) {
        setLogs(response.data.logs)
        setTotal(response.data.total)
      } else {
        setError(response.error?.message || '查询日志失败')
      }
    } catch (err: any) {
      setError(err.message || '查询日志失败')
    } finally {
      setLoading(false)
    }
  }, [currentPage, pageSize, filters, loadModules])

  // 初始加载
  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  // 导出日志
  const handleExport = async () => {
    try {
      const params: any = {}

      if (filters.module) {
        params.module = filters.module
      }

      if (filters.level.length > 0) {
        params.level = filters.level.join(',')
      }

      if (filters.traceId) {
        params.trace_id = filters.traceId
      }

      if (filters.dateRange && filters.dateRange[0] && filters.dateRange[1]) {
        params.start_time = filters.dateRange[0].toISOString()
        params.end_time = filters.dateRange[1].toISOString()
      }

      message.loading({ content: '正在导出日志...', key: 'export' })
      const blob = await logsApi.exportLogs(params)
      
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `logs-${dayjs().format('YYYY-MM-DD')}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)

      message.success({ content: '导出成功', key: 'export' })
    } catch (err: any) {
      message.error({ content: err.message || '导出失败', key: 'export' })
    }
  }

  // 清理日志
  const handleCleanup = () => {
    Modal.confirm({
      title: '清理日志',
      content: (
        <div>
          <p>请输入要清理的日期（将删除此日期之前的所有日志）：</p>
          <DatePicker
            style={{ width: '100%', marginTop: 8 }}
            placeholder="选择日期"
            onChange={(date) => {
              if (date) {
                Modal.confirm({
                  title: '确认清理',
                  content: `确定要删除 ${date.format('YYYY-MM-DD')} 之前的所有日志吗？`,
                  onOk: async () => {
                    try {
                      message.loading({ content: '正在清理日志...', key: 'cleanup' })
                      const response = await logsApi.cleanupLogs(date.toISOString(), false)
                      if (response.success && response.data) {
                        message.success({ 
                          content: `已删除 ${response.data.deletedCount} 条日志`, 
                          key: 'cleanup' 
                        })
                        loadLogs()
                      }
                    } catch (err: any) {
                      message.error({ content: err.message || '清理失败', key: 'cleanup' })
                    }
                  },
                })
              }
            }}
          />
        </div>
      ),
      onOk: () => {
        // 实际清理逻辑在DatePicker的onChange中处理
      },
    })
  }

  // 获取日志级别颜色
  const getLevelColor = (level: string) => {
    switch (level) {
      case 'ERROR':
        return 'red'
      case 'WARNING':
        return 'orange'
      case 'INFO':
        return 'blue'
      case 'DEBUG':
        return 'default'
      default:
        return 'default'
    }
  }

  // 表格列定义
  const columns: ColumnsType<LogEntry> = [
    {
      title: '时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 180,
      render: (timestamp: string) => dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss'),
      sorter: true,
    },
    {
      title: '级别',
      dataIndex: 'level',
      key: 'level',
      width: 100,
      render: (level: string) => (
        <Tag color={getLevelColor(level)}>{level}</Tag>
      ),
      filters: [
        { text: 'ERROR', value: 'ERROR' },
        { text: 'WARNING', value: 'WARNING' },
        { text: 'INFO', value: 'INFO' },
        { text: 'DEBUG', value: 'DEBUG' },
      ],
    },
    {
      title: '模块',
      dataIndex: 'module',
      key: 'module',
      width: 200,
      render: (module: string) => getModuleDisplayName(module),
      ellipsis: true,
    },
    {
      title: '消息',
      dataIndex: 'message',
      key: 'message',
      render: (message: string, record: LogEntry) => {
        const isExpanded = expandedMessages.has(record.id)
        const shouldTruncate = message.length > 100

        if (!shouldTruncate || isExpanded) {
          return (
            <div>
              <Text>{message}</Text>
              {shouldTruncate && (
                <Button
                  type="link"
                  size="small"
                  onClick={() => toggleMessage(record.id)}
                  style={{ padding: '0 4px', height: 'auto' }}
                >
                  收起
                </Button>
              )}
            </div>
          )
        }

        return (
          <div>
            <Text>{message.substring(0, 100)}...</Text>
            <Button
              type="link"
              size="small"
              onClick={() => toggleMessage(record.id)}
              style={{ padding: '0 4px', height: 'auto' }}
            >
              展开
            </Button>
          </div>
        )
      },
    },
    {
      title: 'TraceID',
      dataIndex: 'traceId',
      key: 'traceId',
      width: 200,
      render: (traceId?: string) => (
        traceId ? (
          <Tooltip title={traceId}>
            <Text code style={{ fontSize: 11 }} ellipsis>
              {traceId.substring(0, 8)}...
            </Text>
          </Tooltip>
        ) : (
          <Text type="secondary">-</Text>
        )
      ),
    },
    {
      title: '文件位置',
      key: 'location',
      width: 200,
      render: (_: any, record: LogEntry) => (
        record.filePath ? (
          <Tooltip title={`${record.filePath}:${record.lineNo}`}>
            <Text type="secondary" style={{ fontSize: 11 }} ellipsis>
              {record.filePath.split('/').pop()}:{record.lineNo}
            </Text>
          </Tooltip>
        ) : (
          <Text type="secondary">-</Text>
        )
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_: any, record: LogEntry) => {
        const moduleDisplayName = getModuleDisplayName(record.module)
        return (
          <Button
            type="link"
            size="small"
            onClick={() => {
              Modal.info({
                title: '日志详情',
                width: 800,
                content: (
                  <div style={{ marginTop: 16 }}>
                    <p><strong>时间:</strong> {dayjs(record.timestamp).format('YYYY-MM-DD HH:mm:ss.SSS')}</p>
                    <p><strong>级别:</strong> <Tag color={getLevelColor(record.level)}>{record.level}</Tag></p>
                    <p><strong>模块:</strong> {moduleDisplayName}</p>
                    <p><strong>消息:</strong> {record.message}</p>
                    {record.traceId && <p><strong>TraceID:</strong> <Text code>{record.traceId}</Text></p>}
                    {record.filePath && <p><strong>文件路径:</strong> {record.filePath}</p>}
                    {record.lineNo && <p><strong>行号:</strong> {record.lineNo}</p>}
                    {record.extraData && (
                      <div>
                        <p><strong>额外数据:</strong></p>
                        <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, overflow: 'auto' }}>
                          {JSON.stringify(record.extraData, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ),
              })
            }}
          >
            详情
          </Button>
        )
      },
    },
  ]

  return (
    <AppLayout>
      <Card>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>系统日志查询</h1>
          
          {/* 筛选器 */}
          <Card size="small" style={{ marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Space wrap>
                <Select
                  placeholder="选择模块"
                  value={filters.module || undefined}
                  onChange={(value) => setFilters({ ...filters, module: value || '' })}
                  style={{ width: 250 }}
                  showSearch
                  allowClear
                  filterOption={(input, option) => {
                    const label = option?.label || ''
                    return label.toLowerCase().includes(input.toLowerCase())
                  }}
                  notFoundContent={moduleList.length === 0 ? '加载中...' : '未找到匹配的模块'}
                >
                  {moduleList.map((item) => (
                    <Select.Option
                      key={item.module}
                      value={item.module}
                      label={item.chineseName ? `${item.chineseName} (${item.module})` : item.module}
                    >
                      {item.chineseName ? `${item.chineseName} (${item.module})` : item.module}
                    </Select.Option>
                  ))}
                </Select>
                <Select
                  mode="multiple"
                  placeholder="日志级别"
                  value={filters.level}
                  onChange={(value) => setFilters({ ...filters, level: value })}
                  style={{ width: 200 }}
                  allowClear
                >
                  <Select.Option value="ERROR">ERROR</Select.Option>
                  <Select.Option value="WARNING">WARNING</Select.Option>
                  <Select.Option value="INFO">INFO</Select.Option>
                  <Select.Option value="DEBUG">DEBUG</Select.Option>
                </Select>
                <Input
                  placeholder="TraceID"
                  value={filters.traceId}
                  onChange={(e) => setFilters({ ...filters, traceId: e.target.value })}
                  style={{ width: 200 }}
                  allowClear
                />
                <RangePicker
                  value={filters.dateRange}
                  onChange={(dates) => setFilters({ ...filters, dateRange: dates })}
                  showTime
                  format="YYYY-MM-DD HH:mm:ss"
                />
                <Button
                  type="primary"
                  icon={<SearchOutlined />}
                  onClick={() => {
                    setCurrentPage(1)
                    loadLogs()
                  }}
                >
                  查询
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    setFilters({
                      module: '',
                      level: [],
                      traceId: '',
                      dateRange: null,
                    })
                    setCurrentPage(1)
                  }}
                >
                  重置
                </Button>
              </Space>
              
              {/* 日期快捷选择 */}
              <Space wrap>
                <Button
                  size="small"
                  onClick={() => {
                    const end = dayjs()
                    const start = end.subtract(8, 'hour')
                    setFilters({
                      ...filters,
                      dateRange: [start, end],
                    })
                  }}
                >
                  最近8小时
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    const end = dayjs()
                    const start = end.subtract(1, 'day')
                    setFilters({
                      ...filters,
                      dateRange: [start, end],
                    })
                  }}
                >
                  一天
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    const [start, end] = getUSTradingHours()
                    setFilters({
                      ...filters,
                      dateRange: [start, end],
                    })
                  }}
                >
                  美股盘中时间
                </Button>
              </Space>
            </Space>
          </Card>

          {/* 操作按钮 */}
          <Space style={{ marginBottom: 16 }}>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleExport}
            >
              导出日志
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={handleCleanup}
            >
              清理日志
            </Button>
          </Space>

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
        </div>

        {/* 日志表格 */}
        <Table
          columns={columns}
          dataSource={logs}
          rowKey="id"
          loading={loading}
          pagination={{
            current: currentPage,
            pageSize: pageSize,
            total: total,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, size) => {
              setCurrentPage(page)
              setPageSize(size)
            },
          }}
          scroll={{ x: 1200 }}
        />
      </Card>
    </AppLayout>
  )
}
