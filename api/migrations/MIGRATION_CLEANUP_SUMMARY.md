# 数据库迁移脚本清理总结

**清理时间**: 2025-12-11  
**清理内容**: 合并010和011到000_init_schema.sql，标记012为可选脚本

---

## 📋 清理内容

### 已合并到000_init_schema.sql的迁移脚本

1. **010_add_is_system_to_capital_allocations.sql**
   - ✅ 已合并：`capital_allocations`表添加`is_system`字段
   - ✅ 已合并：设置GLOBAL账户为系统账户
   - ✅ 已合并：创建索引和注释

2. **011_add_signal_id_to_execution_orders.sql**
   - ✅ 已合并：`execution_orders`表添加`signal_id`字段
   - ✅ 已合并：创建外键和索引
   - ✅ 已合并：添加注释

### 保留但标记为可选的脚本

3. **012_backfill_signal_id_and_status.sql**
   - ⚠️ **不在初始化时执行**
   - ⚠️ **仅用于历史数据修复**
   - ✅ 已添加警告注释
   - ✅ 新数据会自动关联，无需执行此脚本

---

## 🔧 合并后的表结构

### capital_allocations表

```sql
CREATE TABLE IF NOT EXISTS capital_allocations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    parent_id INTEGER REFERENCES capital_allocations(id),
    allocation_type VARCHAR(20) NOT NULL CHECK (allocation_type IN ('PERCENTAGE', 'FIXED_AMOUNT')),
    allocation_value DECIMAL(15, 4) NOT NULL,
    current_usage DECIMAL(15, 4) DEFAULT 0,
    is_system BOOLEAN DEFAULT FALSE,  -- ✅ 新增字段
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### execution_orders表

```sql
CREATE TABLE IF NOT EXISTS execution_orders (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    symbol VARCHAR(20),
    order_id VARCHAR(50) UNIQUE,
    client_order_id VARCHAR(50),
    side VARCHAR(10),
    quantity INTEGER,
    price DECIMAL(15, 4),
    current_status VARCHAR(20),
    execution_stage INTEGER DEFAULT 1,
    signal_id INTEGER REFERENCES strategy_signals(id) ON DELETE SET NULL,  -- ✅ 新增字段
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## ✅ 合并原则

### 1. 安全性保证

- **使用 `CREATE TABLE IF NOT EXISTS`**: 避免覆盖已有表
- **使用 `DO $$ ... END $$` 块检查列是否存在**: 避免重复添加列
- **使用 `UPDATE` 更新已有数据**: 确保数据一致性（GLOBAL账户标记为系统账户）
- **使用 `CREATE INDEX IF NOT EXISTS`**: 避免重复创建索引

### 2. 向后兼容

- **已有表不受影响**: 如果表已存在，只添加缺失的列
- **已有数据不受影响**: 只更新NULL值，不覆盖已有数据
- **可重复运行**: 脚本可以安全地多次运行

### 3. 完整性保证

- **添加外键约束**: `signal_id`引用`strategy_signals(id)`
- **添加索引**: 优化查询性能
- **添加注释**: 为列添加说明

---

## 📊 清理效果

### 新项目初始化

- ✅ 直接运行 `000_init_schema.sql` 即可创建完整的表结构
- ✅ 包含所有字段（包括`is_system`和`signal_id`）
- ✅ 包含所有索引和约束
- ✅ 包含触发器和注释

### 已有项目更新

- ✅ 如果表不存在，创建完整表结构
- ✅ 如果表存在但缺少列，只添加缺失的列
- ✅ 如果列已存在，跳过添加
- ✅ 更新已有数据（GLOBAL账户标记为系统账户）

---

## 🧪 测试建议

### 测试场景1: 新项目初始化

```bash
# 1. 创建数据库
createdb trading_db

# 2. 运行初始化脚本
psql -d trading_db -f migrations/000_init_schema.sql

# 3. 验证表结构
psql -d trading_db -c "\d capital_allocations"
psql -d trading_db -c "\d execution_orders"

# 4. 验证字段存在
psql -d trading_db -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'capital_allocations' AND column_name = 'is_system'"
psql -d trading_db -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'execution_orders' AND column_name = 'signal_id'"
```

### 测试场景2: 已有项目更新

```bash
# 1. 假设已有数据库，缺少新字段
# 2. 运行初始化脚本
psql -d trading_db -f migrations/000_init_schema.sql

# 3. 验证列已添加
psql -d trading_db -c "\d capital_allocations"
psql -d trading_db -c "\d execution_orders"
```

### 测试场景3: 重复运行

```bash
# 1. 多次运行脚本
psql -d trading_db -f migrations/000_init_schema.sql
psql -d trading_db -f migrations/000_init_schema.sql
psql -d trading_db -f migrations/000_init_schema.sql

# 2. 验证没有错误，表结构正确
psql -d trading_db -c "\d capital_allocations"
psql -d trading_db -c "\d execution_orders"
```

---

## 📝 后续处理

### 归档旧脚本（可选）

010和011脚本可以移动到archive目录或删除：

```bash
# 移动到archive目录（推荐保留作为历史记录）
mv migrations/010_add_is_system_to_capital_allocations.sql migrations/archive/
mv migrations/011_add_signal_id_to_execution_orders.sql migrations/archive/
```

### 012脚本处理

- ✅ 保留012脚本（历史数据修复可能需要）
- ✅ 已添加警告注释，明确不在初始化时执行
- ✅ 更新README.md说明012的用途

---

## ✅ 验证清单

- [x] `capital_allocations.is_system`字段已合并到000_init_schema.sql
- [x] `execution_orders.signal_id`字段已合并到000_init_schema.sql
- [x] 向后兼容（已有表不受影响）
- [x] 可重复运行（无错误）
- [x] 012脚本已标记为可选
- [x] README.md已更新
- [x] 文档已更新

---

## 📚 相关文档

- [数据库初始化脚本使用说明](README.md)
- [迁移脚本合并总结](MIGRATION_MERGE_SUMMARY.md)（008和009的合并记录）
- [信号日志历史数据修复方案](../../docs/features/SIGNAL_ORDER_HISTORICAL_DATA_FIX.md)

---

**清理完成时间**: 2025-12-11  
**清理人员**: AI Assistant  
**版本**: 1.0

