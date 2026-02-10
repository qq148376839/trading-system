'use client'

import AppLayout from '@/components/AppLayout'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || ''

export default function ApiDocsPage() {
  // 开发环境: http://localhost:3001/api/docs
  // 生产环境(同源): /api/docs
  const docsUrl = API_BASE_URL ? `${API_BASE_URL}/docs` : '/api/docs'

  return (
    <AppLayout>
      <div style={{ margin: -24, height: 'calc(100vh - 112px)' }}>
        <iframe
          src={docsUrl}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          title="API 文档"
        />
      </div>
    </AppLayout>
  )
}
