# 前端 API 连接问题修复

## 问题描述

前端页面报错：`获取持仓失败: Error: 网络错误，请检查API服务是否运行`

### 根本原因

1. **前端超时时间过短**：前端设置的超时时间为 10 秒，但后端处理持仓查询（特别是期权行情查询）可能需要更长时间
2. **后端期权行情查询阻塞**：富途牛牛 API 查询超时（10秒），导致整个请求被阻塞
3. **缺少环境变量配置**：前端没有 `.env.local` 文件，虽然代码有默认值，但 Next.js 需要明确配置

## 解决方案

### 1. 增加前端超时时间

**文件：** `frontend/lib/api.ts`

```typescript
export const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 30000, // 从 10000 增加到 30000（30秒）
  // ...
})
```

**原因：** 持仓查询需要获取期权行情数据，可能需要较长时间

### 2. 优化后端超时处理

**文件：** `api/src/services/futunn-option-quote.service.ts`

- 将富途牛牛 API 的超时从 10 秒减少到 5 秒
- 快速失败，避免长时间阻塞

**文件：** `api/src/routes/positions.ts`

- 添加 `Promise.race` 机制，确保富途牛牛 API 查询不会阻塞超过 5 秒
- 即使期权行情查询失败，也能快速返回基本持仓数据

### 3. 创建前端环境变量文件

**文件：** `frontend/.env.local`

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
```

**注意：** 如果前端服务正在运行，需要重启才能读取新的环境变量

## 验证修复

### 1. 检查前端环境变量

```bash
cd frontend
cat .env.local
# 应该显示：NEXT_PUBLIC_API_URL=http://localhost:3001
```

### 2. 重启前端服务

```bash
# 停止当前前端服务（Ctrl+C）
# 然后重新启动
cd frontend
npm run dev
```

### 3. 测试 API 连接

在浏览器控制台或使用 curl：

```bash
# 测试健康检查
curl http://localhost:3001/api/health

# 测试持仓查询（应该能在30秒内返回）
curl http://localhost:3001/api/positions
```

### 4. 检查浏览器网络请求

1. 打开浏览器开发者工具（F12）
2. 切换到 Network 标签
3. 刷新页面
4. 查看 `/api/positions` 请求：
   - Status 应该是 200
   - Time 应该小于 30 秒
   - Response 应该包含持仓数据

## 性能优化建议

### 1. 异步加载期权行情

考虑将期权行情查询改为异步任务，不阻塞持仓列表返回：
- 先返回基本持仓数据（使用成本价）
- 后台异步更新期权行情
- 前端通过 WebSocket 或轮询获取更新

### 2. 缓存期权行情

- 缓存期权行情数据，减少 API 调用
- 设置合理的缓存过期时间（如 1 分钟）

### 3. 分批查询

如果持仓中有多个期权，考虑分批查询，避免一次性查询过多

## 故障排除

### 问题 1：前端仍然超时

**检查：**
1. 前端服务是否已重启
2. `.env.local` 文件是否存在且内容正确
3. 浏览器是否缓存了旧代码（尝试硬刷新：Ctrl+Shift+R）

### 问题 2：后端响应时间仍然很长

**检查：**
1. 富途牛牛 API 是否可访问
2. 网络连接是否正常
3. 查看后端日志，确认哪个步骤耗时最长

### 问题 3：期权行情无法获取

**这是正常的**，如果：
- 长桥 API 没有期权行情权限（错误码 301604）
- 富途牛牛 API 查询超时或失败

**解决方案：**
- 持仓数据仍会返回，但使用成本价作为当前价格
- 盈亏计算可能不准确，但不影响基本功能

## 相关文件

- `frontend/lib/api.ts` - 前端 API 客户端配置
- `frontend/.env.local` - 前端环境变量（需要创建）
- `api/src/routes/positions.ts` - 持仓查询路由
- `api/src/services/futunn-option-quote.service.ts` - 富途牛牛期权行情服务

