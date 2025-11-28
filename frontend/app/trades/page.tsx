'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import BackButton from '@/components/BackButton'

/**
 * 交易记录页面已迁移到订单管理页面
 * 此页面自动重定向到 /orders
 */
export default function TradesPage() {
  const router = useRouter()

  useEffect(() => {
    // 自动重定向到订单管理页面
    router.replace('/orders')
  }, [router])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-4">
            <BackButton />
          </div>
          <div className="bg-white shadow rounded-lg p-6">
            <div className="text-center py-8">
              <h1 className="text-2xl font-bold text-gray-900 mb-4">交易记录已迁移</h1>
              <p className="text-gray-600 mb-6">
                交易记录功能已整合到订单管理页面，正在跳转...
              </p>
              <a
                href="/orders"
                className="text-blue-600 hover:text-blue-800 font-medium underline"
              >
                立即前往订单管理页面 →
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


