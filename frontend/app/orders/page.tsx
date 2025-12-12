'use client'

// 重定向到量化模块的订单管理页面
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function OrdersPage() {
  const router = useRouter()
  
  useEffect(() => {
    router.replace('/quant/orders')
  }, [router])
  
  return null
}
