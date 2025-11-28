/**
 * ZIG指标（之字转向指标）计算函数
 * 
 * 参考TradingView Pine Script ZigZag库的实现逻辑
 * 
 * ZIG指标原理：
 * 1. 跟踪最近的高点和低点（pivot points）
 * 2. 当价格从最近的极值点偏离超过设定百分比时，记录转折点
 * 3. 在转折点之间使用线性插值绘制直线
 * 
 * @param data K线数据数组
 * @param priceType 计算依据：'close' | 'high' | 'low'
 * @param reversalPercent 转向幅度（百分比），例如5表示5%
 * @returns 包含ZIG数据的数组，所有点都有值（转折点之间使用线性插值）
 */
export function calculateZIG(
  data: Array<{ open: number; high: number; low: number; close: number; [key: string]: any }>,
  priceType: 'close' | 'high' | 'low' = 'close',
  reversalPercent: number = 5
): number[] {
  if (data.length === 0) return []
  if (data.length === 1) {
    return [getPrice(data[0], priceType)]
  }
  
  const reversalThreshold = reversalPercent / 100 // 转换为小数，如0.05表示5%
  
  // 获取价格值的辅助函数
  function getPrice(item: any, type: 'close' | 'high' | 'low'): number {
    switch (type) {
      case 'high':
        return item.high
      case 'low':
        return item.low
      case 'close':
      default:
        return item.close
    }
  }
  
  // 存储转折点：[index, price, direction]
  const pivotPoints: Array<{ index: number; price: number; direction: 'high' | 'low' }> = []
  
  // 初始化：第一个点作为起始点
  let lastPivotIndex = 0
  let lastPivotPrice = getPrice(data[0], priceType)
  let lastPivotDirection: 'high' | 'low' = 'high' // 初始方向
  
  // 添加第一个转折点
  pivotPoints.push({ index: 0, price: lastPivotPrice, direction: lastPivotDirection })
  
  // 从第二个点开始遍历
  for (let i = 1; i < data.length; i++) {
    const currentPrice = getPrice(data[i], priceType)
    
    if (lastPivotDirection === 'high') {
      // 当前是高点模式，寻找更高的高点或达到转向幅度的低点
      if (currentPrice > lastPivotPrice) {
        // 找到更高的高点，更新最后一个转折点
        lastPivotPrice = currentPrice
        lastPivotIndex = i
        pivotPoints[pivotPoints.length - 1] = { index: i, price: currentPrice, direction: 'high' }
      } else {
        // 价格回落，检查是否达到转向幅度
        const dropPercent = (lastPivotPrice - currentPrice) / lastPivotPrice
        if (dropPercent >= reversalThreshold) {
          // 达到转向幅度，记录新的低点转折点
          pivotPoints.push({ index: i, price: currentPrice, direction: 'low' })
          lastPivotPrice = currentPrice
          lastPivotIndex = i
          lastPivotDirection = 'low'
        }
      }
    } else {
      // 当前是低点模式，寻找更低的低点或达到转向幅度的高点
      if (currentPrice < lastPivotPrice) {
        // 找到更低的低点，更新最后一个转折点
        lastPivotPrice = currentPrice
        lastPivotIndex = i
        pivotPoints[pivotPoints.length - 1] = { index: i, price: currentPrice, direction: 'low' }
      } else {
        // 价格反弹，检查是否达到转向幅度
        const risePercent = (currentPrice - lastPivotPrice) / lastPivotPrice
        if (risePercent >= reversalThreshold) {
          // 达到转向幅度，记录新的高点转折点
          pivotPoints.push({ index: i, price: currentPrice, direction: 'high' })
          lastPivotPrice = currentPrice
          lastPivotIndex = i
          lastPivotDirection = 'high'
        }
      }
    }
  }
  
  // 确保最后一个数据点包含在转折点中（如果还没有）
  const lastDataIndex = data.length - 1
  if (pivotPoints.length === 0 || pivotPoints[pivotPoints.length - 1].index !== lastDataIndex) {
    const lastPrice = getPrice(data[lastDataIndex], priceType)
    // 如果最后一个转折点不是最后一个数据点，添加最后一个点
    if (pivotPoints.length > 0 && pivotPoints[pivotPoints.length - 1].index < lastDataIndex) {
      pivotPoints.push({ index: lastDataIndex, price: lastPrice, direction: lastPivotDirection })
    }
  }
  
  // 生成ZIG值数组：在转折点之间进行线性插值
  const zigValues: number[] = new Array(data.length)
  
  // 如果没有转折点，直接返回价格
  if (pivotPoints.length === 0) {
    for (let i = 0; i < data.length; i++) {
      zigValues[i] = getPrice(data[i], priceType)
    }
    return zigValues
  }
  
  // 填充转折点的值
  for (const pivot of pivotPoints) {
    zigValues[pivot.index] = pivot.price
  }
  
  // 在转折点之间进行线性插值
  for (let i = 0; i < pivotPoints.length - 1; i++) {
    const startPivot = pivotPoints[i]
    const endPivot = pivotPoints[i + 1]
    
    const startIndex = startPivot.index
    const endIndex = endPivot.index
    const startPrice = startPivot.price
    const endPrice = endPivot.price
    
    // 计算插值
    const steps = endIndex - startIndex
    if (steps > 0) {
      for (let j = startIndex + 1; j < endIndex; j++) {
        const ratio = (j - startIndex) / steps
        zigValues[j] = startPrice + (endPrice - startPrice) * ratio
      }
    }
    
    // 确保转折点本身有值
    zigValues[startIndex] = startPrice
    zigValues[endIndex] = endPrice
  }
  
  // 确保第一个和最后一个点有值
  if (zigValues[0] === undefined || zigValues[0] === null) {
    zigValues[0] = getPrice(data[0], priceType)
  }
  if (zigValues[data.length - 1] === undefined || zigValues[data.length - 1] === null) {
    zigValues[data.length - 1] = getPrice(data[data.length - 1], priceType)
  }
  
  return zigValues
}
