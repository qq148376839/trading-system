import type { Metadata } from 'next'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { antdTheme } from '@/lib/antd-theme'
import './globals.css'
import 'antd/dist/reset.css'

export const metadata: Metadata = {
  title: '长桥股票交易系统',
  description: '基于NAS+Docker的股票交易系统',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>
        <ConfigProvider theme={antdTheme} locale={zhCN}>
          {children}
        </ConfigProvider>
      </body>
    </html>
  )
}


