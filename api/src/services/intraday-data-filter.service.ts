/**
 * 分时数据噪音过滤服务
 * 过滤异常值、验证数据质量、平滑处理
 */

interface CandlestickData {
  close: number;
  open: number;
  low: number;
  high: number;
  volume: number;
  turnover: number;
  timestamp: number;
}

interface FilterConfig {
  zScoreThreshold: number;        // Z-score阈值（默认2.5）
  volumeThreshold: number;         // 成交量阈值（低于平均值的比例）
  priceChangeThreshold: number;     // 价格变化阈值（百分比）
  emaAlpha: number;                // EMA平滑系数（0-1）
  minDataPoints: number;           // 最小数据点数
}

class IntradayDataFilterService {
  private config: FilterConfig = {
    zScoreThreshold: 2.5,
    volumeThreshold: 0.5,
    priceChangeThreshold: 0.05, // 5%
    emaAlpha: 0.3,
    minDataPoints: 10,
  };
  
  // 用于记录已处理的数据签名，避免重复输出日志
  private processedDataSignatures: Set<string> = new Set();

  /**
   * 综合过滤（应用所有过滤方法）
   */
  filterData(
    data: CandlestickData[],
    config?: Partial<FilterConfig>
  ): CandlestickData[] {
    if (!data || data.length === 0) {
      return [];
    }

    // 合并配置
    const mergedConfig = { ...this.config, ...config };

    // 如果数据点太少，不进行过滤
    if (data.length < mergedConfig.minDataPoints) {
      console.warn(`数据点不足（${data.length} < ${mergedConfig.minDataPoints}），跳过过滤`);
      return data;
    }

    // 生成数据签名用于去重日志
    const dataSignature = this.generateDataSignature(data);

    let filtered = [...data];

    // 1. Z-Score异常值过滤
    filtered = this.filterOutliers(filtered, mergedConfig.zScoreThreshold);

    // 2. 成交量验证（传入数据签名用于去重日志）
    filtered = this.filterByVolume(filtered, mergedConfig.volumeThreshold, dataSignature);

    // 3. 价格变化率验证
    filtered = this.filterByPriceChange(filtered, mergedConfig.priceChangeThreshold);

    // 4. EMA平滑（仅对close价格）
    filtered = this.applyEMASmoothing(filtered, mergedConfig.emaAlpha);

    return filtered;
  }

  /**
   * 过滤异常值（Z-Score方法）
   */
  private filterOutliers(
    data: CandlestickData[],
    threshold: number
  ): CandlestickData[] {
    const prices = data.map(d => d.close);
    const mean = this.calculateMean(prices);
    const stdDev = this.calculateStdDev(prices, mean);

    // 如果标准差为0，说明所有价格相同，不需要过滤
    if (stdDev === 0) {
      return data;
    }

    return data.map((item, index) => {
      const zScore = Math.abs((item.close - mean) / stdDev);

      if (zScore > threshold) {
        // 使用前一个和后一个有效值的平均值替代
        let replacement = item.close;

        if (index > 0 && index < data.length - 1) {
          // 前后都有数据，使用平均值
          replacement = (data[index - 1].close + data[index + 1].close) / 2;
        } else if (index > 0) {
          // 只有前一个数据
          replacement = data[index - 1].close;
        } else if (index < data.length - 1) {
          // 只有后一个数据
          replacement = data[index + 1].close;
        } else {
          // 只有一条数据，使用均值
          replacement = mean;
        }

        console.warn(
          `检测到异常值（Z-score: ${zScore.toFixed(2)}），价格: ${item.close} -> ${replacement.toFixed(2)}`
        );

        return {
          ...item,
          close: replacement,
          high: Math.max(item.high, replacement),
          low: Math.min(item.low, replacement),
        };
      }

      return item;
    });
  }

  /**
   * 生成数据签名（用于去重日志）
   */
  private generateDataSignature(data: CandlestickData[]): string {
    if (!data || data.length === 0) {
      return '';
    }
    // 使用数据长度、第一个和最后一个时间戳作为签名
    const firstTimestamp = data[0]?.timestamp || 0;
    const lastTimestamp = data[data.length - 1]?.timestamp || 0;
    return `${data.length}-${firstTimestamp}-${lastTimestamp}`;
  }

  /**
   * 成交量验证过滤
   */
  private filterByVolume(
    data: CandlestickData[],
    threshold: number,
    dataSignature?: string
  ): CandlestickData[] {
    const volumes = data.map(d => d.volume);
    const avgVolume = this.calculateMean(volumes);

    // 如果平均成交量为0，跳过过滤
    if (avgVolume === 0) {
      return data;
    }

    let anomalyCount = 0;
    const filtered = data.map((item, index) => {
      if (item.volume < avgVolume * threshold && index > 0) {
        // 成交量异常低，使用前一个值（可能是数据错误）
        anomalyCount++;

        return {
          ...item,
          close: data[index - 1].close,
          high: Math.max(item.high, data[index - 1].high),
          low: Math.min(item.low, data[index - 1].low),
        };
      }
      return item;
    });

    // 只在有异常时输出一次汇总日志，避免日志刷屏
    // 使用数据签名去重，避免相同数据重复输出日志
    if (anomalyCount > 0 && dataSignature) {
      if (!this.processedDataSignatures.has(dataSignature)) {
        this.processedDataSignatures.add(dataSignature);
        const percentage = ((anomalyCount / data.length) * 100).toFixed(1);
        const thresholdValue = (avgVolume * threshold).toFixed(2);
        // 添加数据来源说明
        console.warn(
          `[成交量过滤] 检测到 ${anomalyCount}/${data.length} (${percentage}%) 个数据点成交量异常低（< ${thresholdValue}，平均成交量: ${avgVolume.toFixed(2)}），已使用前一个值修正。数据来源：富途API K线数据`
        );
        
        // 限制缓存大小，避免内存泄漏（只保留最近100个签名）
        if (this.processedDataSignatures.size > 100) {
          const firstSignature = Array.from(this.processedDataSignatures)[0];
          this.processedDataSignatures.delete(firstSignature);
        }
      }
    }

    return filtered;
  }

  /**
   * 价格变化率过滤
   */
  private filterByPriceChange(
    data: CandlestickData[],
    threshold: number
  ): CandlestickData[] {
    return data.map((item, index) => {
      if (index === 0) {
        return item;
      }

      const previous = data[index - 1];
      const changeRate = Math.abs((item.close - previous.close) / previous.close);

      if (changeRate > threshold) {
        // 价格变化超过阈值，检查是否是连续异常
        const isConsecutiveAnomaly = index > 1 && 
          Math.abs((data[index - 2].close - previous.close) / data[index - 2].close) > threshold;

        if (!isConsecutiveAnomaly) {
          // 单个异常点，可能是数据错误，使用前一个值
          console.warn(
            `价格变化异常（${(changeRate * 100).toFixed(2)}%），使用前一个值`
          );

          return {
            ...item,
            close: previous.close,
            high: Math.max(item.high, previous.high),
            low: Math.min(item.low, previous.low),
          };
        }
        // 连续异常，可能是真实的市场波动，保留数据
      }

      return item;
    });
  }

  /**
   * EMA平滑处理
   */
  private applyEMASmoothing(
    data: CandlestickData[],
    alpha: number
  ): CandlestickData[] {
    if (data.length === 0) {
      return data;
    }

    let ema = data[0].close;
    const smoothed: CandlestickData[] = [{ ...data[0] }];

    for (let i = 1; i < data.length; i++) {
      ema = (data[i].close * alpha) + (ema * (1 - alpha));
      
      smoothed.push({
        ...data[i],
        close: ema,
        // 保持high和low的合理性
        high: Math.max(data[i].high, ema),
        low: Math.min(data[i].low, ema),
      });
    }

    return smoothed;
  }

  /**
   * 计算平均值
   */
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * 计算标准差
   */
  private calculateStdDev(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    const variance = values.reduce(
      (sum, v) => sum + Math.pow(v - mean, 2),
      0
    ) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * 验证数据质量
   */
  validateData(data: CandlestickData[]): {
    isValid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    if (!data || data.length === 0) {
      return { isValid: false, issues: ['数据为空'] };
    }

    // 检查数据完整性
    for (let i = 0; i < data.length; i++) {
      const item = data[i];

      if (item.close <= 0) {
        issues.push(`第${i + 1}条数据：收盘价无效 (${item.close})`);
      }

      if (item.high < item.low) {
        issues.push(`第${i + 1}条数据：最高价低于最低价`);
      }

      if (item.close > item.high || item.close < item.low) {
        issues.push(`第${i + 1}条数据：收盘价超出高低价范围`);
      }

      // 检查时间戳顺序
      if (i > 0 && item.timestamp < data[i - 1].timestamp) {
        issues.push(`第${i + 1}条数据：时间戳顺序错误`);
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
    };
  }
}

export default new IntradayDataFilterService();

