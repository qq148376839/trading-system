'use client'

import { useState } from 'react'
import { Layout, Menu, Breadcrumb } from 'antd'
import {
  HomeOutlined,
  ShoppingCartOutlined,
  LineChartOutlined,
  DollarOutlined,
  SettingOutlined,
  BarChartOutlined,
  GlobalOutlined,
  FileTextOutlined,
  EyeOutlined,
  StockOutlined,
  FileSearchOutlined,
} from '@ant-design/icons'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'

const { Header, Sider, Content } = Layout

interface AppLayoutProps {
  children: React.ReactNode
}

/**
 * 应用主布局组件 - 侧边布局方案
 * 统一使用 Ant Design Layout，提升导航体验和页面一致性
 */
export default function AppLayout({ children }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  // 菜单项配置
  const menuItems = [
    {
      key: '/',
      icon: <HomeOutlined />,
      label: <Link href="/">首页</Link>,
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'quant',
      icon: <BarChartOutlined />,
      label: '量化交易',
      children: [
        {
          key: '/quant',
          icon: <BarChartOutlined />,
          label: <Link href="/quant">量化首页</Link>,
        },
        {
          key: '/quant/strategies',
          icon: <FileTextOutlined />,
          label: <Link href="/quant/strategies">策略管理</Link>,
        },
        {
          key: '/quant/capital',
          icon: <DollarOutlined />,
          label: <Link href="/quant/capital">资金管理</Link>,
        },
        {
          key: '/quant/signals',
          icon: <LineChartOutlined />,
          label: <Link href="/quant/signals">信号日志</Link>,
        },
        {
          key: '/quant/orders',
          icon: <ShoppingCartOutlined />,
          label: <Link href="/quant/orders">订单管理</Link>,
        },
        {
          key: '/quant/backtest',
          icon: <BarChartOutlined />,
          label: <Link href="/quant/backtest">回测管理</Link>,
        },
      ],
    },
    {
      type: 'divider' as const,
    },
    {
      key: '/candles',
      icon: <LineChartOutlined />,
      label: <Link href="/candles">K线图</Link>,
    },
    {
      key: '/forex',
      icon: <GlobalOutlined />,
      label: <Link href="/forex">外汇行情</Link>,
    },
    {
      key: '/quote',
      icon: <FileTextOutlined />,
      label: <Link href="/quote">行情查询</Link>,
    },
    {
      key: '/watchlist',
      icon: <EyeOutlined />,
      label: <Link href="/watchlist">关注列表</Link>,
    },
    {
      type: 'divider' as const,
    },
    {
      key: '/logs',
      icon: <FileSearchOutlined />,
      label: <Link href="/logs">系统日志</Link>,
    },
    {
      key: '/config',
      icon: <SettingOutlined />,
      label: <Link href="/config">系统配置</Link>,
    },
  ]

  // 获取当前选中的菜单项
  const getSelectedKeys = () => {
    if (pathname === '/') return ['/']
    if (pathname.startsWith('/quant')) {
      return [pathname]
    }
    return [pathname]
  }

  // 获取当前打开的子菜单
  const getOpenKeys = () => {
    if (pathname.startsWith('/quant')) {
      return ['quant']
    }
    return []
  }

  // 生成面包屑
  const getBreadcrumbItems = () => {
    const items: Array<{ title: React.ReactNode }> = [{ title: <Link href="/">首页</Link> }]
    
    if (pathname === '/') {
      return items
    }

    const paths = pathname.split('/').filter(Boolean)
    let currentPath = ''

    paths.forEach((path, index) => {
      currentPath += `/${path}`
      const isLast = index === paths.length - 1
      
      if (path === 'quant') {
        items.push({ title: isLast ? '量化交易' : <Link href={currentPath}>量化交易</Link> })
      } else if (path === 'strategies') {
        items.push({ title: isLast ? '策略管理' : <Link href={currentPath}>策略管理</Link> })
      } else if (path === 'capital') {
        items.push({ title: isLast ? '资金管理' : <Link href={currentPath}>资金管理</Link> })
      } else if (path === 'signals') {
        items.push({ title: isLast ? '信号日志' : <Link href={currentPath}>信号日志</Link> })
      } else if (path === 'trades') {
        items.push({ title: isLast ? '交易记录' : <Link href={currentPath}>交易记录</Link> })
      } else if (path === 'backtest') {
        items.push({ title: isLast ? '回测管理' : <Link href={currentPath}>回测管理</Link> })
      } else if (path === 'orders') {
        items.push({ title: isLast ? '订单管理' : <Link href={currentPath}>订单管理</Link> })
      } else if (path === 'candles') {
        items.push({ title: isLast ? 'K线图' : <Link href={currentPath}>K线图</Link> })
      } else if (path === 'forex') {
        items.push({ title: isLast ? '外汇行情' : <Link href={currentPath}>外汇行情</Link> })
      } else if (path === 'quote') {
        items.push({ title: isLast ? '行情查询' : <Link href={currentPath}>行情查询</Link> })
      } else if (path === 'watchlist') {
        items.push({ title: isLast ? '关注列表' : <Link href={currentPath}>关注列表</Link> })
      } else if (path === 'logs') {
        items.push({ title: isLast ? '系统日志' : <Link href={currentPath}>系统日志</Link> })
      } else if (path === 'config') {
        items.push({ title: isLast ? '系统配置' : <Link href={currentPath}>系统配置</Link> })
      } else if (path === 'options') {
        items.push({ title: isLast ? '期权链' : <Link href={currentPath}>期权链</Link> })
      } else {
        items.push({ title: path })
      }
    })

    return items
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={200}
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
        }}
      >
        <div
          style={{
            height: 64,
            margin: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255, 255, 255, 0.85)',
            fontSize: collapsed ? 16 : 16,
            fontWeight: 500,
            transition: 'all 0.2s',
            gap: 8,
          }}
        >
          <StockOutlined style={{ fontSize: collapsed ? 20 : 20 }} />
          {!collapsed && <span style={{ fontSize: 16 }}>长桥交易系统</span>}
          {collapsed && <span style={{ fontSize: 16 }}>长桥</span>}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={getSelectedKeys()}
          defaultOpenKeys={getOpenKeys()}
          items={menuItems}
        />
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 80 : 200, transition: 'margin-left 0.2s' }}>
        <Header
          style={{
            padding: '0 24px',
            background: '#fff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          }}
        >
          <Breadcrumb
            items={getBreadcrumbItems()}
            style={{ lineHeight: '64px' }}
          />
        </Header>
        <Content
          style={{
            margin: '24px 16px',
            padding: 24,
            minHeight: 280,
            background: '#fff',
            borderRadius: 6,
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  )
}

