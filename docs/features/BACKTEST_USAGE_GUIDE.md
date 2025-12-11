# 回测功能使用指南

**创建日期**: 2025-12-03  
**状态**: 已实现 ✅

## 📋 概述

回测功能允许您使用历史数据测试策略的表现，评估策略优化效果和参数调整。

## 🚀 快速开始

### 1. 数据库迁移

首先，需要运行数据库迁移创建回测结果表：

```bash
# 连接到PostgreSQL数据库
psql -U your_user -d your_database

# 运行迁移
\i api/migrations/008_add_backtest_results.sql
```

或者使用数据库管理工具执行迁移文件。

### 2. 命令行回测

使用回测脚本进行命令行回测：

```bash
cd api

# 基本用法
npm run backtest -- --strategy-id=1 --start-date=2025-01-01 --end-date=2025-12-01 --symbol=AAPL.US

# 参数说明:
# --strategy-id: 策略ID（必需）
# --start-date: 回测开始日期，格式: YYYY-MM-DD（必需）
# --end-date: 回测结束日期，格式: YYYY-MM-DD（必需）
# --symbol: 回测标的，格式: SYMBOL.US（必需）
```

### 3. API回测

使用API接口进行回测：

```bash
# 执行回测
curl -X POST http://localhost:3001/api/quant/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "strategyId": 1,
    "symbols": ["AAPL.US", "MSFT.US"],
    "startDate": "2025-01-01",
    "endDate": "2025-12-01",
    "config": {}
  }'

# 获取回测结果
curl http://localhost:3001/api/quant/backtest/1

# 获取策略的所有回测结果
curl http://localhost:3001/api/quant/backtest/strategy/1
```

## 📊 API接口说明

### POST /api/quant/backtest

执行回测。

**请求体**:
```json
{
  "strategyId": 1,
  "symbols": ["AAPL.US"],
  "startDate": "2025-01-01",
  "endDate": "2025-12-01",
  "config": {}
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "strategyId": 1,
    "startDate": "2025-01-01",
    "endDate": "2025-12-01",
    "totalReturn": 15.5,
    "totalTrades": 50,
    "winningTrades": 32,
    "losingTrades": 18,
    "winRate": 64.0,
    "avgReturn": 2.1,
    "maxDrawdown": -8.5,
    "sharpeRatio": 1.5,
    "avgHoldingTime": 4.5,
    "trades": [...],
    "dailyReturns": [...]
  }
}
```

### GET /api/quant/backtest/:id

获取指定ID的回测结果。

**响应**: 同POST接口的data字段。

### GET /api/quant/backtest/strategy/:strategyId

获取指定策略的所有回测结果。

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "strategyId": 1,
      ...
    },
    ...
  ]
}
```

## 📈 回测结果说明

### 性能指标

- **totalReturn**: 总收益率（%）
- **totalTrades**: 总交易次数
- **winningTrades**: 盈利交易次数
- **losingTrades**: 亏损交易次数
- **winRate**: 胜率（%）
- **avgReturn**: 平均收益率（%）
- **maxDrawdown**: 最大回撤（%）
- **sharpeRatio**: 夏普比率
- **avgHoldingTime**: 平均持仓时间（小时）

### 交易明细

每笔交易包含：
- **symbol**: 标的代码
- **entryDate**: 买入日期
- **exitDate**: 卖出日期
- **entryPrice**: 买入价格
- **exitPrice**: 卖出价格
- **quantity**: 交易数量
- **pnl**: 盈亏金额
- **pnlPercent**: 盈亏百分比
- **entryReason**: 买入原因
- **exitReason**: 卖出原因（STOP_LOSS, TAKE_PROFIT, BACKTEST_END等）

### 每日收益

每日权益和收益率数据，可用于绘制收益曲线。

## 🔍 注意事项

1. **数据获取**: 回测需要从Longbridge API获取历史K线数据，确保API配置正确。

2. **时间范围**: 
   - 开始日期和结束日期必须是有效的交易日期
   - 建议回测时间范围至少1个月，以获得有意义的统计结果

3. **策略限制**: 
   - 当前回测仅支持 `RECOMMENDATION_V1` 策略类型
   - 回测使用简化的执行逻辑，可能与实际交易有差异

4. **性能考虑**:
   - 回测大量标的或长时间范围可能需要较长时间
   - 建议先使用小范围测试

5. **结果准确性**:
   - 回测结果仅供参考，实际表现可能因市场环境、滑点、手续费等因素而有所不同
   - 建议结合其他分析方法综合评估策略

## 📝 示例

### 示例1: 单标的回测

```bash
npm run backtest -- --strategy-id=1 --start-date=2025-01-01 --end-date=2025-12-01 --symbol=AAPL.US
```

### 示例2: API多标的回测

```bash
curl -X POST http://localhost:3001/api/quant/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "strategyId": 1,
    "symbols": ["AAPL.US", "MSFT.US", "GOOGL.US"],
    "startDate": "2025-01-01",
    "endDate": "2025-12-01"
  }'
```

### 示例3: 查看回测历史

```bash
# 查看策略的所有回测结果
curl http://localhost:3001/api/quant/backtest/strategy/1

# 查看特定回测结果
curl http://localhost:3001/api/quant/backtest/1
```

## 🔗 相关文档

- [回测功能实施计划](BACKTEST_FEATURE_PLAN.md)
- [动态交易策略设计](DYNAMIC_TRADING_STRATEGY_DESIGN.md)
- [动态交易策略实施总结](DYNAMIC_TRADING_STRATEGY_IMPLEMENTATION.md)

---

**最后更新**: 2025-12-03

