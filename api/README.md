# API 服务

Node.js + Express + TypeScript 实现的API服务。

## 功能

- 查询实时行情（GET /api/quote）
- 查询K线数据（GET /api/candlesticks）
- 关注股票管理（GET/POST/DELETE/PUT /api/watchlist）
- 交易记录查询（GET /api/trades）
- 订单管理（GET/POST/PUT/DELETE /api/orders）
- 交易推荐（GET /api/trading-recommendation）
- 持仓查询（GET /api/positions）
- 外汇/指数行情（GET /api/forex/*）
- 健康检查（GET /api/health）

## 环境变量配置

创建 `api/.env` 文件：

```bash
# 数据库配置
DATABASE_URL=postgresql://postgres:password@localhost:5432/trading_db

# 长桥API配置（必需）
# 请访问 https://open.longportapp.com/ 获取API密钥
LONGPORT_APP_KEY=your_app_key
LONGPORT_APP_SECRET=your_app_secret
LONGPORT_ACCESS_TOKEN=your_access_token

# 可选：开启美股夜盘
LONGPORT_ENABLE_OVERNIGHT=false

# 服务器配置
PORT=3001
NODE_ENV=development
```

**重要提示**:
- ACCESS_TOKEN有效期为3个月，过期后需要到 https://open.longportapp.com/ 重新生成
- 如果遇到401003或401004错误，请检查Token是否有效

## 开发

```bash
cd api
npm install
npm run dev
```

API服务将在 http://localhost:3001 启动

## 技术栈

- Express.js
- TypeScript
- longport SDK (Node.js)
- PostgreSQL (pg)
- dotenv
- axios (富途API调用)

## API端点

### 行情相关
- `GET /api/quote` - 获取股票行情（支持期权）
- `GET /api/candlesticks` - 获取K线数据
- `GET /api/forex/quote` - 获取外汇/指数行情
- `GET /api/forex/candlestick` - 获取外汇/指数K线数据

### 交易相关
- `POST /api/orders` - 提交订单
- `GET /api/orders/today` - 查询今日订单
- `GET /api/orders/:orderId` - 查询订单详情
- `PUT /api/orders/:orderId` - 修改订单
- `DELETE /api/orders/:orderId` - 取消订单
- `GET /api/trades` - 获取交易记录
- `GET /api/positions` - 获取持仓列表

### 交易推荐
- `GET /api/trading-recommendation` - 获取交易推荐（单个股票）
- `POST /api/trading-recommendation/batch` - 批量获取交易推荐

### 其他
- `GET /api/watchlist` - 关注列表管理
- `GET /api/health` - 健康检查

## 测试

### 健康检查
```bash
curl http://localhost:3001/api/health
```

### 查询行情
```bash
curl "http://localhost:3001/api/quote?symbol=AAPL.US"
```

### 查询交易推荐
```bash
curl "http://localhost:3001/api/trading-recommendation?symbol=AAPL.US"
```

## 故障排除

- [Token故障排除](TOKEN_TROUBLESHOOTING.md) - 401004错误排查指南
- [交易上下文故障排除](TRADE_CONTEXT_TROUBLESHOOTING.md) - TradeContext初始化失败排查
- [富途API检查](FUTUNN_API_REVIEW.md) - 富途API调用检查总结
- [富途API测试](FUTUNN_API_TEST.md) - 富途API测试接口文档


