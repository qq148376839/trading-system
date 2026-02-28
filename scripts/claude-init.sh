#!/usr/bin/env bash
# Claude Code 会话初始化健康检查脚本
# 用途：验证开发环境就绪，显示项目当前状态

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== Claude Code 会话初始化 ==="
echo ""

# 1. 环境检查
echo "--- 环境版本 ---"
echo "Node.js: $(node --version 2>/dev/null || echo '未安装')"
echo "pnpm:    $(pnpm --version 2>/dev/null || echo '未安装')"
echo ""

# 2. 依赖检查
echo "--- 依赖状态 ---"
if [ -d "$ROOT_DIR/api/node_modules" ]; then
  echo "api/node_modules:      存在"
else
  echo "api/node_modules:      缺失 — 请运行 cd api && pnpm install"
fi
if [ -d "$ROOT_DIR/frontend/node_modules" ]; then
  echo "frontend/node_modules: 存在"
else
  echo "frontend/node_modules: 缺失 — 请运行 cd frontend && pnpm install"
fi
echo ""

# 3. Build 验证
echo "--- Build 验证 ---"
if (cd "$ROOT_DIR/api" && pnpm run build 2>&1 | tail -3); then
  echo "api build: 通过"
else
  echo "api build: 失败 — 请检查编译错误"
fi
echo ""

# 4. Git 状态
echo "--- Git 状态 ---"
git status --short
echo ""
echo "--- 最近 10 条提交 ---"
git log --oneline -10
echo ""

# 5. 进度文件
echo "--- 任务进度 ---"
if [ -f "$ROOT_DIR/claude-progress.json" ]; then
  echo "存在未完成的任务："
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('$ROOT_DIR/claude-progress.json', 'utf8'));
    console.log('  任务: ' + p.task);
    console.log('  开始: ' + p.startedAt);
    console.log('  当前子任务: #' + p.currentSubtask);
    const done = p.subtasks.filter(s => s.status === 'done').length;
    const total = p.subtasks.length;
    console.log('  进度: ' + done + '/' + total);
    if (p.blockers && p.blockers.length > 0) {
      console.log('  阻塞项: ' + p.blockers.join(', '));
    }
  " 2>/dev/null || echo "  (进度文件格式异常，建议删除重建)"
else
  echo "无进行中的任务"
fi
echo ""
echo "=== 初始化完成 ==="
