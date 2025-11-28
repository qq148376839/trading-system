# 数据库初始化脚本使用说明

## 使用方法

1. 确保PostgreSQL数据库已创建：
```bash
createdb trading_db
```

2. 运行初始化脚本：
```bash
psql -U user -d trading_db -f migrations/001_initial_schema.sql
```

或者在psql中执行：
```sql
\i migrations/001_initial_schema.sql
```

## 表结构说明

### watchlist（关注股票列表）
- `id`: 主键
- `symbol`: 标的代码（唯一索引）
- `enabled`: 是否启用
- `created_at`: 创建时间
- `updated_at`: 更新时间

### quotes（行情数据历史）
- `id`: 主键
- `symbol`: 标的代码（索引）
- `last_done`: 最新价
- `prev_close`: 昨收价
- `open`: 开盘价
- `high`: 最高价
- `low`: 最低价
- `volume`: 成交量
- `turnover`: 成交额
- `timestamp`: 时间戳（索引）
- `trade_status`: 交易状态

### trades（交易记录）
- `id`: 主键
- `symbol`: 标的代码（索引）
- `side`: 交易方向（BUY/SELL）
- `quantity`: 数量
- `price`: 价格
- `status`: 状态（PENDING/SUCCESS/FAILED/CANCELLED）
- `order_id`: 订单ID
- `error_message`: 错误信息
- `created_at`: 创建时间（索引）
- `updated_at`: 更新时间

### settings（用户配置）
- `id`: 主键
- `key`: 配置键（唯一索引）
- `value`: 配置值
- `updated_at`: 更新时间


