# 日志分析工具

## 快速开始

### 1. 分析日志并生成看板

一键执行所有分析：

```bash
# Windows PowerShell
python scripts/analyze-logs.py; python scripts/generate-html-dashboard.py

# Linux/Mac
python scripts/analyze-logs.py && python scripts/generate-html-dashboard.py
```

### 2. 查看结果

生成的文件：
- `logs-analysis-dashboard.txt` - 文本版看板
- `logs-analysis-dashboard.html` - HTML交互式看板（推荐）
- `logs-analysis-detailed.json` - 详细分析数据

在浏览器中打开 `logs-analysis-dashboard.html` 查看美观的交互式看板。

## 工具说明

### analyze-logs.py

**功能**: 分析日志文件，生成统计数据

**输入**: `logs-2026-01-27.json`

**输出**:
- `logs-analysis-dashboard.txt` - 文本版报告
- `logs-analysis-detailed.json` - JSON格式的详细分析数据

**支持的日志格式**:
- `{success: true, data: {logs: [...]}}`
- `{logs: [...]}`
- `[{log1}, {log2}, ...]`
- 每行一个JSON对象（NDJSON格式）

### generate-html-dashboard.py

**功能**: 根据分析数据生成HTML看板

**输入**: `logs-analysis-detailed.json`

**输出**: `logs-analysis-dashboard.html`

**特点**:
- 美观的渐变色设计
- 响应式布局
- 可视化图表
- 易于阅读和分享

## 分析内容

### 1. 概览统计
- 总日志数量
- 各级别日志分布
- 错误率和警告率

### 2. 关键问题识别
- **数据库错误**: 表缺失、连接问题等
- **API限流**: 429错误统计
- **订单问题**: 信号关联失败、价格更新失败等

### 3. 模块活动
- Top 10 最活跃的模块
- 每个模块的日志数量和占比

### 4. 策略执行统计
- 执行次数
- 执行耗时
- 标的状态分布
- 信号和错误统计

### 5. Top 错误和警告
- 按出现次数排序
- 显示错误详情
- 便于快速定位高频问题

### 6. 优化建议
- 基于分析结果自动生成
- 优先级排序
- 具体的改进方向

## 实际应用场景

### 场景1: 日常监控
每天运行一次，快速了解系统状态：
```bash
python scripts/analyze-logs.py
```

### 场景2: 问题排查
系统出现异常时，生成详细报告：
```bash
python scripts/analyze-logs.py
python scripts/generate-html-dashboard.py
# 打开 logs-analysis-dashboard.html 查看详情
```

### 场景3: 性能优化
定期分析，找出性能瓶颈：
- 查看策略执行耗时
- 分析高频错误
- 识别API限流问题

### 场景4: 团队协作
分享HTML看板给团队成员：
- 美观易读
- 包含所有关键信息
- 可以直接在浏览器中打开

## 当前发现的主要问题

### 🔴 高优先级

1. **数据库表缺失** (780次错误)
   - 缺失表: validation_failure_logs
   - 需要立即修复

2. **API限流严重** (1,088次)
   - 主要在 Strategy.Scheduler 模块
   - 需要实现速率控制

### ⚠️ 中优先级

3. **订单-信号关联失败** (1,867次)
   - 时间窗口匹配算法需要优化

4. **Decimal类型转换问题** (1,040次)
   - 订单价格更新失败
   - 需要检查LongPort SDK使用

### 📊 统计数据

- 总日志: 24,630条
- 错误率: 15.2% (需要降低到 <5%)
- 警告率: 18.2% (需要降低到 <10%)

## 修复建议

### 1. 数据库修复

创建缺失的表：

```sql
-- 验证失败日志表
CREATE TABLE IF NOT EXISTS validation_failure_logs (
  id SERIAL PRIMARY KEY,
  strategy_id INTEGER NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  failure_type VARCHAR(50) NOT NULL,
  reason TEXT,
  timestamp TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 添加索引
CREATE INDEX idx_validation_logs_strategy ON validation_failure_logs(strategy_id);
CREATE INDEX idx_validation_logs_symbol ON validation_failure_logs(symbol);
CREATE INDEX idx_validation_logs_timestamp ON validation_failure_logs(timestamp);
```

### 2. API限流修复

实现速率限制器：

```typescript
// api/src/utils/rate-limiter.ts
export class RateLimiter {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;
  private lastRequestTime = 0;
  private minInterval = 100; // 最小请求间隔100ms

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const now = Date.now();
          const elapsed = now - this.lastRequestTime;
          if (elapsed < this.minInterval) {
            await new Promise(r => setTimeout(r, this.minInterval - elapsed));
          }
          const result = await fn();
          this.lastRequestTime = Date.now();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private async processQueue() {
    this.processing = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) await task();
    }
    this.processing = false;
  }
}

// 使用示例
const rateLimiter = new RateLimiter();
await rateLimiter.execute(() => tradeClient.submitOrder(order));
```

### 3. Decimal类型修复

检查订单数量的类型转换：

```typescript
// 错误的写法
const quantity = order.quantity; // 可能是number或string

// 正确的写法
import { Decimal } from '@longport/openapi';
const quantity = new Decimal(order.quantity.toString());
```

### 4. 订单-信号关联优化

扩大时间窗口，增加容错性：

```typescript
// 从1小时扩大到2小时
const timeWindow = {
  start: new Date(signal.created_at.getTime() - 2 * 60 * 60 * 1000),
  end: new Date(signal.created_at.getTime() + 2 * 60 * 60 * 1000)
};
```

## 自定义分析

### 修改日志文件路径

编辑 `scripts/analyze-logs.py`:

```python
# 第368行
log_file = Path("your-log-file.json")
```

### 调整分析参数

编辑 `scripts/analyze-logs.py`:

```python
# 修改Top错误/警告数量（默认10）
for i, (error_key, count) in enumerate(error_counts[:20], 1):  # 改为20

# 修改模块Top数量（默认10）
for i, (module, count) in enumerate(list(analysis['module_counts'].items())[:15], 1):  # 改为15
```

### 添加自定义分析

在 `analyze_logs()` 函数中添加自定义逻辑：

```python
# 例如：分析特定股票的问题
tsla_issues = []
for log in logs:
    if 'TSLA' in log.get('message', ''):
        tsla_issues.append(log)

return {
    # ... 其他统计
    'tsla_issues': tsla_issues
}
```

## 故障排除

### 问题: 文件找不到

```
错误: 找不到日志文件 logs-2026-01-27.json
```

**解决**: 确保日志文件在项目根目录，或修改脚本中的文件路径。

### 问题: JSON解析错误

```
JSON解析错误: Expecting value: line 1 column 1 (char 0)
```

**解决**: 检查日志文件格式是否正确，可能需要重新导出日志。

### 问题: 编码错误

```
UnicodeEncodeError: 'gbk' codec can't encode character
```

**解决**: 脚本已经处理了Windows编码问题，如果仍然出现，请检查Python版本 (建议3.7+)。

### 问题: 内存不足

```
MemoryError: Unable to allocate array
```

**解决**: 日志文件太大，可以：
1. 分批处理日志
2. 增加系统内存
3. 使用流式处理（待实现）

## 未来改进

### v2.0 计划功能
- [ ] 时间序列分析（错误趋势）
- [ ] 实时日志监控
- [ ] 自动告警功能
- [ ] 多日志文件对比
- [ ] 导出PDF报告
- [ ] API接口（RESTful）

### v3.0 计划功能
- [ ] 机器学习异常检测
- [ ] 日志智能分类
- [ ] 根因分析（Root Cause Analysis）
- [ ] 性能预测
- [ ] 集成到Web界面

## 贡献

欢迎提交Issue和Pull Request！

改进建议请发送到项目Issue页面。

---

**版本**: 1.0.0
**更新时间**: 2026-01-27
**维护者**: Trading System Team
