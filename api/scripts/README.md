# API 测试工具使用说明

## 量化交易 API 测试工具

本目录包含用于测试量化交易 API 的工具脚本。

## 工具列表

### 1. Node.js 测试脚本 (`test-quant-api.js`) - 跨平台推荐 ⭐

功能最完整的测试脚本，支持所有平台（Windows/Linux/macOS）。

功能完整的 Node.js 测试脚本，支持所有量化交易 API 端点测试。

**使用方法：**

```bash
# 使用默认 URL (http://localhost:3001)
node scripts/test-quant-api.js

# 指定 API URL
API_URL=http://localhost:3001 node scripts/test-quant-api.js

# 启用策略启动测试（谨慎使用）
TEST_START_STRATEGY=true node scripts/test-quant-api.js
```

**功能：**
- ✅ 测试所有资金管理 API
- ✅ 测试选股器 API
- ✅ 测试策略管理 API
- ✅ 测试信号日志 API
- ✅ 测试交易记录 API
- ✅ 彩色输出和详细错误信息
- ✅ 测试结果统计

### 2. Shell 测试脚本 (`test-quant-api.sh`) - Linux/macOS

基于 curl 的 Shell 脚本，适合快速测试和 CI/CD 集成。

**使用方法：**

```bash
# 添加执行权限
chmod +x scripts/test-quant-api.sh

# 运行测试
./scripts/test-quant-api.sh

# 指定 API URL
API_URL=http://localhost:3001 ./scripts/test-quant-api.sh
```

**依赖：**
- `curl`
- `jq` (可选，用于格式化 JSON 输出)

**安装依赖（Ubuntu/Debian）：**
```bash
sudo apt-get install curl jq
```

**安装依赖（macOS）：**
```bash
brew install curl jq
```

### 3. PowerShell 测试脚本 (`test-quant-api.ps1`) - Windows

基于 PowerShell 的测试脚本，适合 Windows 环境。

**使用方法：**

```powershell
# 直接运行
.\scripts\test-quant-api.ps1

# 指定 API URL
$env:API_URL="http://localhost:3001"; .\scripts\test-quant-api.ps1

# 如果遇到执行策略限制，先运行：
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**特点：**
- ✅ 彩色输出
- ✅ JSON 格式化显示
- ✅ 详细的错误信息
- ✅ 测试结果统计

### 4. 批处理测试脚本 (`test-quant-api.bat`) - Windows

基于批处理文件和 curl 的测试脚本，适合 Windows 命令行环境（CMD）。

**使用方法：**

```cmd
REM 直接运行
cd api
scripts\test-quant-api.bat

REM 指定 API URL
set API_URL=http://localhost:3001
scripts\test-quant-api.bat
```

**依赖：**
- `curl` (Windows 10 1803+ 内置，或需要单独安装)

**安装 curl（如果未安装）：**
- Windows 10 1803+ 已内置 curl
- 或下载：https://curl.se/windows/

**注意：** 批处理脚本功能较简单，推荐使用 PowerShell 脚本或 Node.js 脚本获得更好的体验。

## 测试覆盖范围

### 资金管理 API
- ✅ GET `/api/quant/capital/allocations` - 获取资金分配列表
- ✅ POST `/api/quant/capital/allocations` - 创建资金分配账户
- ✅ GET `/api/quant/capital/usage` - 获取资金使用情况
- ✅ POST `/api/quant/capital/sync-balance` - 手动触发余额同步
- ✅ GET `/api/quant/capital/balance-discrepancies` - 查询余额差异

### 选股器 API
- ✅ GET `/api/quant/stock-selector/blacklist` - 获取黑名单列表
- ✅ POST `/api/quant/stock-selector/blacklist` - 添加股票到黑名单
- ✅ DELETE `/api/quant/stock-selector/blacklist/:symbol` - 从黑名单移除股票

### 策略管理 API
- ✅ GET `/api/quant/strategies` - 获取策略列表
- ✅ POST `/api/quant/strategies` - 创建策略
- ✅ GET `/api/quant/strategies/:id` - 获取策略详情
- ✅ POST `/api/quant/strategies/:id/start` - 启动策略（可选）
- ✅ POST `/api/quant/strategies/:id/stop` - 停止策略
- ✅ GET `/api/quant/strategies/:id/instances` - 获取策略实例状态

### 信号日志 API
- ✅ GET `/api/quant/signals` - 获取信号日志
- ✅ GET `/api/quant/signals?strategyId=:id` - 按策略ID获取信号

### 交易记录 API
- ✅ GET `/api/quant/trades` - 获取交易记录
- ✅ GET `/api/quant/trades?strategyId=:id` - 按策略ID获取交易记录

## 注意事项

1. **策略启动测试**：默认情况下，测试脚本不会启动策略（避免意外执行交易）。如需测试策略启动功能，请设置环境变量 `TEST_START_STRATEGY=true`。

2. **数据库状态**：测试脚本会创建测试数据（资金分配账户、策略等），请确保在测试环境中运行。

3. **API 服务**：确保 API 服务已启动并运行在指定端口（默认 3001）。

4. **数据库迁移**：运行测试前，请确保已执行数据库迁移脚本：
   ```bash
   psql -U postgres -d trading_db -f migrations/005_quant_trading_schema.sql
   ```

## 示例输出

```
=== 量化交易 API 测试工具 ===

Base URL: http://localhost:3001

--- 资金管理 API ---

ℹ Testing: GET /capital/allocations
✓ GET /capital/allocations - Status: 200
ℹ Testing: POST /capital/allocations
✓ POST /capital/allocations - Status: 200
...

=== 测试总结 ===

✓ 通过: 15
✗ 失败: 0
⚠ 跳过: 1
ℹ 总计: 16

✓ 所有测试通过！
```

## 故障排除

### 1. 连接错误
- 检查 API 服务是否运行：`curl http://localhost:3001/api/health`
- 检查端口是否正确
- 检查防火墙设置

### 2. 认证错误
- 检查 Longbridge SDK 配置
- 检查数据库中的配置项

### 3. 数据库错误
- 确保数据库已创建
- 确保迁移脚本已执行
- 检查数据库连接配置

## 扩展测试

如需添加新的测试用例，请编辑相应的测试脚本：

- **Node.js 脚本**：在 `runTests()` 函数中添加新的 `testAPI()` 调用
- **Shell 脚本**：添加新的 `test_api()` 调用

