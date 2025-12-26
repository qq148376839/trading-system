# 市场温度与VIX恐慌指数实现方案 PRD

## 📋 文档信息
- **文档版本**：v1.0
- **创建时间**：2025-12-18
- **状态**：待实现
- **目标**：在交易推荐系统中引入"市场温度"和"VIX恐慌指数"，解决原有策略对市场广度和极端情绪感知不足的问题。

---

## 1. 背景与目标

### 1.1 背景
当前的交易推荐逻辑主要依赖 SPX、USD Index 和 BTC 的价格趋势，虽然涵盖了宏观和风险偏好，但缺乏以下两个关键维度：
1. **市场广度 (Market Breadth)**：指数上涨是否由少数权重股拉动？（LongPort 市场温度解决）
2. **隐含波动率 (Implied Volatility)**：市场对未来的恐惧程度是多少？（Moomoo VIX 数据解决）

### 1.2 目标
- 集成 LongPort `marketTemperature` 接口。
- 集成 Moomoo VIX K线数据。
- 构建 **市场状态矩阵 (Market Regime Matrix)**，优化 `market_environment` 的判定逻辑。

---

## 2. 数据源与接口定义

### 2.1 市场温度 (LongPort)
- **来源**: LongPort SDK
- **接口**: `ctx.marketTemperature(market: Market)`
- **参数**: `Market.US`
- **返回值**:
  ```typescript
  interface MarketTemperature {
    value: number; // 假设范围 0-100
    // 可能包含的其他字段，需实测确认
  }
  ```

### 2.2 VIX 恐慌指数 (Moomoo)
- **来源**: Moomoo API (via `market-data.service.ts`)
- **接口**: `get-kline`
- **参数**:
  - `stockId`: 需查找 VIX 对应的 stockId (通常是 `VIX` 或其期货代码，需确认 Moomoo 中的准确 ID)
  - `marketId`: US Market ID
- **目标代码**: `.VIX` 或 `VIX` (需在 `market-data.service.ts` 中配置)

---

## 3. 核心逻辑变更

### 3.1 市场状态矩阵 (Market Regime Matrix)

| 市场温度 (LongPort) | VIX 指数 (Moomoo) | 市场状态 | 策略建议 |
| :--- | :--- | :--- | :--- |
| **高 (>50)** | **低 (<20)** | **🟢 黄金做多期** | 趋势强且稳，仓位正常，止损正常 |
| **高 (>50)** | **高 (>20)** | **🟡 疯狂博弈期** | 涨但风险大，需减半仓位，收紧止损 |
| **低 (<50)** | **高 (>20)** | **🔴 恐慌下跌期** | 市场普跌且恐慌，适合做空或空仓 |
| **低 (<50)** | **低 (<20)** | **⚪️ 阴跌/盘整期** | 无热点无波动，流动性枯竭，不建议操作 |

### 3.2 环境分计算公式
```typescript
const env_score = basic_market_strength * 0.4 + (market_temp_normalized) * 0.4 + (vix_reverse_normalized) * 0.2;
```

---

## 4. 实施计划

### 4.1 修改 `api/src/services/market-data.service.ts`
1. **配置 VIX 代码**: 在 `config` 对象中添加 `vix` 配置。
   - 需调研 Moomoo API 中 VIX 的准确 `stockId`、`marketCode`、`instrumentType`。
   - 临时方案：参考 Python 脚本中的 VIX 获取方式，或尝试搜索 `.VIX`。
2. **新增方法**:
   - `getVIXData(count: number)`: 获取 VIX 历史数据。
   - `getMarketTemperature()`: 封装 LongPort SDK 调用。

### 4.2 修改 `api/src/services/market-data-cache.service.ts`
1. 更新缓存接口 `MarketDataCache`，增加 `vix` 和 `marketTemperature` 字段。
2. 在 `getMarketData` 中并行获取这两个新指标。

### 4.3 修改 `api/src/services/trading-recommendation.service.ts`
1. **输入扩展**: `calculateRecommendation` 接收 VIX 和温度数据。
2. **逻辑实现**:
   - 实现 `calculateMarketRegime(temp, vix)` 方法。
   - 在 `calculateTradingDecision` 中引入 `env_score` 和 "一票否决" 逻辑。
3. **输出更新**: `TradingRecommendation` 接口增加 `market_regime` 字段说明。

---

## 5. 风险与应对

| 风险点 | 应对措施 |
| :--- | :--- |
| **VIX 数据获取失败** | 降级策略：默认 VIX 为 15 (正常值)，并在日志中警告。 |
| **LongPort 温度接口无权限** | 降级策略：默认温度为 50 (中性)，仅依赖 SPX 趋势。 |
| **API 频次限制** | 严格使用 `market-data-cache`，确保缓存时间合理 (如 5-10 分钟)。 |

---

## 6. 测试验证
1. **单元测试**: 模拟 VIX=40 的情况，验证系统是否强制输出 `market_environment = '较差'`。
2. **回测验证**: 跑通最近一次大跌（如 2024 年某次回调），看新策略是否提前发出了预警信号。





