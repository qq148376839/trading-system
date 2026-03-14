#!/usr/bin/env node

/**
 * UserPromptSubmit Hook — Rule RAG Auto-Injection
 *
 * Reads user prompt from stdin, queries RAG API for matching rules,
 * falls back to local keyword matching when RAG is unavailable.
 * Outputs additionalContext JSON to stdout.
 *
 * 新增规则时：在 RULE_MAP 追加 { id, title, exact[], context[] }
 *   exact: 高精度关键词，单独命中即触发
 *   context: [{ kw, ctx[] }] 歧义词需与上下文词共现才触发
 * 完整 SOP 见 docs/guides/260307-错误规则集.md → "新增规则 SOP"
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Constants ──────────────────────────────────────────────────────────

const RAG_URL = 'https://rag.riowang.win/api/query';
const RAG_TIMEOUT_MS = 3000;
const MIN_SCORE = 0.40;
const MIN_PROMPT_LENGTH = 6;
const RAG_SOURCE_FILTER = '错误规则集.md';

// Always-inject rule IDs — safety-critical, must survive context compression
const ALWAYS_INJECT_IDS = [2, 6, 7, 8, 9];

// ── Local keyword fallback map ─────────────────────────────────────────
// Two-tier matching to reduce false positives:
//   exact:   single keyword match is sufficient (high-precision terms)
//   context: keyword must co-occur with at least one contextWord
//            (for ambiguous terms like "日志", "删除", "退出" etc.)

const RULE_MAP = [
  { id: 1, title: 'cookies 认证用 Node.js fetch',
    action: '禁 WebFetch/curl/Python。用 Bash+node -e+fetch，cookies 放 JS 字符串变量',
    exact: ['cookie', 'cookies', 'webfetch'],
    context: [{ kw: '认证', ctx: ['cookie', 'fetch', 'api', '接口', '登录'] },
              { kw: 'curl', ctx: ['api', '接口', '请求', '认证'] }] },
  { id: 2, title: 'commit 前必须 pnpm run build',
    action: '代码变更后 commit 前必须在 api/ 和 frontend/ 跑 pnpm run build，失败则修复再提交',
    exact: ['pnpm run build', 'pnpm build'],
    context: [{ kw: 'commit', ctx: ['代码', '提交', 'git', 'build'] },
              { kw: 'build', ctx: ['commit', '提交', '编译', 'pnpm'] }] },
  { id: 3, title: 'JSONB 数字用 Number()+isNaN',
    action: 'JSONB 字段做运算前必须 Number(field)+isNaN 守卫。禁 parseInt/parseFloat',
    exact: ['jsonb', 'parseint', 'parsefloat', 'isnan'],
    context: [{ kw: '数字', ctx: ['jsonb', 'json', '转换', 'parse', '类型'] }] },
  { id: 4, title: '状态机转换幂等防重复',
    action: '先查当前状态，只在预期前置状态下才转换。禁无条件 updateStatus',
    exact: ['状态机', '状态转换', '幂等', 'state machine'],
    context: [{ kw: '重复', ctx: ['状态', '订单', 'status', '转换', '幂等'] }] },
  { id: 5, title: 'JSONB 更新用 || 合并',
    action: 'SQL: SET config = config || $1::jsonb。禁 SET config = $1 全量覆盖',
    exact: ['jsonb更新', 'jsonb 更新', 'jsonb合并'],
    context: [{ kw: 'jsonb', ctx: ['更新', 'update', '覆盖', '合并', '||'] },
              { kw: '覆盖', ctx: ['jsonb', 'json', '配置', 'config'] }] },
  { id: 6, title: '连续2次修复失败必须停下',
    action: '同一问题修 2 次仍失败→立即停下，记 blocker 到 claude-progress.json，请求用户指导',
    exact: ['修复失败', '连续失败', '死循环'],
    context: [{ kw: 'blocker', ctx: ['修复', 'fix', '失败', '停'] }] },
  { id: 7, title: '安全防护不能移除只能替换',
    action: '重构安全代码（资金检查/风控/仓位限制）必须先建新防护→验证→再拆旧。禁注释/删除',
    exact: ['安全防护', '资金检查', '风控'],
    context: [{ kw: '移除', ctx: ['防护', '检查', '风控', '安全', '验证'] },
              { kw: '删除', ctx: ['防护', '检查', '风控', '安全', '验证'] },
              { kw: '重构', ctx: ['防护', '检查', '风控', '安全', '验证'] }] },
  { id: 8, title: '变更后更新文档+push',
    action: '代码变更完成后更新 CHANGELOG.md + PROJECT_STATUS.md，然后 git push',
    exact: ['changelog', 'project_status'],
    context: [{ kw: '文档更新', ctx: ['变更', '改动', 'push', '提交'] },
              { kw: '重构', ctx: ['组件', '模块', '合并', '拆分', '代码', 'component', 'service'] },
              { kw: '合并', ctx: ['组件', '模块', '模态框', 'modal', 'component'] },
              { kw: '实现', ctx: ['plan', '计划', '方案', '步骤', 'step'] },
              { kw: 'implement', ctx: ['plan', '计划', '方案'] }] },
  { id: 9, title: '会话工作文档实时持久化',
    action: '非简单问答的规划/方案/分析必须保存到 docs/ 对应子目录，命名 YYMMDD-功能名.md',
    exact: ['文档持久化', 'claude-progress'],
    context: [{ kw: '规划', ctx: ['文档', 'docs/', '持久化', '落盘'] },
              { kw: '方案', ctx: ['文档', 'docs/', '持久化', '落盘'] },
              { kw: '重构', ctx: ['组件', '模块', '合并', '拆分', '代码', 'component', 'service'] },
              { kw: '合并', ctx: ['组件', '模块', '模态框', 'modal', 'component'] },
              { kw: '实现', ctx: ['plan', '计划', '方案', '步骤', 'step'] },
              { kw: 'implement', ctx: ['plan', '计划', '方案'] }] },
  { id: 10, title: '新表/改表同步更新 000_init_schema',
    action: '写增量 migration 后必须同步合并到 api/migrations/000_init_schema.sql（用 IF NOT EXISTS）',
    exact: ['migration', '000_init', 'alter table'],
    context: [{ kw: 'schema', ctx: ['migration', '迁移', '表', 'table'] },
              { kw: '建表', ctx: ['migration', '迁移', 'schema'] },
              { kw: '改表', ctx: ['migration', '迁移', 'schema'] }] },
  { id: 11, title: '前端必须适配移动端',
    action: '用 useIsMobile() + 响应式布局，完成后 375px 宽度验证。禁固定宽度',
    exact: ['移动端', '响应式', '375px', 'ismobile'],
    context: [{ kw: '前端', ctx: ['页面', '组件', 'component', '界面', 'ui', 'modal', '表单', '列表'] },
              { kw: 'mobile', ctx: ['前端', 'ui', '适配', 'responsive'] },
              { kw: 'tailwind', ctx: ['前端', '样式', 'css', '响应'] },
              { kw: 'modal', ctx: ['组件', 'component', '合并', '重构', '创建', '编辑', '新建'] },
              { kw: '组件', ctx: ['modal', '模态框', '合并', '重构', '创建', '编辑', '表单', 'form'] },
              { kw: 'component', ctx: ['modal', 'merge', 'refactor', 'create', 'edit', 'form'] }] },
  { id: 12, title: 'HOLDING→IDLE 用 POSITION_EXIT_CLEANUP',
    action: '所有退出路径必须 ...POSITION_EXIT_CLEANUP（第一位）+ lastExitTime + dailyTradeCount++ + dailyRealizedPnL。禁 ...context',
    exact: ['position_exit', 'position_exit_cleanup', 'position_context_reset', 'peakpnl', 'context泄露'],
    context: [{ kw: 'holding', ctx: ['idle', '退出', 'exit', 'cleanup', '状态', '策略'] },
              { kw: 'idle', ctx: ['holding', '退出', 'exit', 'cleanup', '状态', '策略'] },
              { kw: '退出', ctx: ['holding', 'idle', '策略', '持仓', 'exit', 'cleanup'] }] },
  { id: 13, title: 'LongPort 文档用 .md 后缀',
    action: 'URL 加 .md 后缀获取 Markdown。索引入口: open.longbridge.com/llms.txt',
    exact: ['longport', 'longbridge', 'llms.txt'],
    context: [{ kw: 'api文档', ctx: ['longport', 'longbridge', 'sdk'] }] },
  { id: 14, title: '0DTE 非首笔冷却 >= 1分钟',
    action: '首笔0冷却 / 2-4笔≥1min / 5笔起≥3min。禁非首笔冷却=0',
    exact: ['0dte', 'cooldown'],
    context: [{ kw: '冷却', ctx: ['交易', '0dte', '首笔', '入场', 'cooldown', '策略'] },
              { kw: '首笔', ctx: ['冷却', '0dte', 'cooldown'] }] },
  { id: 15, title: '非交易时段日志降级',
    action: '非交易时段策略日志→debug 或跳过，周期性日志→节流≥5min。禁无条件 logger.info',
    exact: ['日志降级', '非交易时段', 'logservice', 'log.service', 'setinterval'],
    context: [{ kw: '日志', ctx: ['降级', '节流', 'logger', '级别', 'debug', 'info', '非交易', '定时'] },
              { kw: 'logger', ctx: ['降级', '节流', '级别', 'debug', 'info', '非交易'] },
              { kw: '定时任务', ctx: ['日志', 'logger', '降级', '节流'] }] },
  { id: 16, title: '部署 NAS 标准步骤',
    action: 'ssh -p 32000 riowang@192.168.31.18 → cd /volume1/docker/trading-system → git pull → docker compose up -d --build',
    exact: ['nas', 'docker compose'],
    context: [{ kw: '部署', ctx: ['nas', 'docker', '上线', '发布', 'compose', '服务器'] },
              { kw: 'docker', ctx: ['部署', 'nas', '上线', 'compose'] }] },
];

// ── Helpers ─────────────────────────────────────────────────────────────

function loadEnvToken() {
  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR
      || resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const envPath = resolve(projectDir, '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    const match = envContent.match(/^RAG_API_TOKEN=(.+)$/m);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

function buildOutput(context) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context,
    },
  });
}

// ── RAG query ───────────────────────────────────────────────────────────

async function queryRAG(prompt, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RAG_TIMEOUT_MS);

  try {
    const res = await fetch(RAG_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query: prompt, limit: 5 }),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const data = await res.json();
    // Expected: { results: [{ content, score, metadata: { source } }] }
    const results = data.results || data.data || [];
    return results.filter(
      (r) => r.score >= MIN_SCORE
        && ((r.metadata?.source || '') + (r.metadata?.file_path || '')).includes(RAG_SOURCE_FILTER)
    );
  } catch {
    return null; // network error or timeout → fallback
  } finally {
    clearTimeout(timer);
  }
}

// ── Local keyword fallback ──────────────────────────────────────────────

function localMatch(prompt) {
  const lower = prompt.toLowerCase();
  const has = (kw) => lower.includes(kw.toLowerCase());

  return RULE_MAP.filter((rule) => {
    // Tier 1: exact keywords — single match is sufficient
    if (rule.exact && rule.exact.some(has)) return true;
    // Tier 2: context keywords — keyword + at least one context word
    if (rule.context) {
      return rule.context.some(
        ({ kw, ctx }) => has(kw) && ctx.some(has)
      );
    }
    return false;
  });
}

// ── Format output ───────────────────────────────────────────────────────

function formatRules(rules, source, extraAlwaysRules) {
  if (!rules || rules.length === 0) return null;

  const lines = rules.map((r) => {
    if (r.id !== undefined) {
      // local match — include action for direct executability
      return r.action
        ? `- 规则 #${r.id}: ${r.title}\n  → ${r.action}`
        : `- 规则 #${r.id}: ${r.title}`;
    }
    // RAG result
    const content = (r.content || '').trim();
    const ruleMatch = content.match(/规则\s*(\d+)/);
    const ruleId = ruleMatch ? `#${ruleMatch[1]}` : '';
    const firstLine = content.split('\n').find((l) => l.trim().length > 0) || content.slice(0, 100);
    return `- 规则 ${ruleId}: ${firstLine}`;
  });

  // Append always-inject rules (for RAG path, deduplicate by extracting IDs from RAG content)
  if (extraAlwaysRules && extraAlwaysRules.length > 0) {
    const existingIds = new Set();
    for (const r of rules) {
      if (r.id !== undefined) existingIds.add(r.id);
      const content = r.content || '';
      const m = content.match(/规则\s*(\d+)/);
      if (m) existingIds.add(Number(m[1]));
    }
    for (const ar of extraAlwaysRules) {
      if (!existingIds.has(ar.id)) {
        lines.push(ar.action
          ? `- 规则 #${ar.id}: ${ar.title}\n  → ${ar.action}`
          : `- 规则 #${ar.id}: ${ar.title}`);
      }
    }
  }

  return [
    `相关规则提醒 (${source}):`,
    ...lines,
    '',
    '详情: docs/guides/260307-错误规则集.md',
  ].join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  // Read stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let prompt = '';
  try {
    const parsed = JSON.parse(input);
    prompt = parsed.prompt || '';
  } catch {
    // Can't parse → skip
    console.log(JSON.stringify({}));
    return;
  }

  // Skip short prompts (simple commands like /commit, 继续)
  if (prompt.length < MIN_PROMPT_LENGTH) {
    console.log(JSON.stringify({}));
    return;
  }

  // Always-inject rules (safety-critical, survive context compression)
  const alwaysRules = RULE_MAP.filter((r) => ALWAYS_INJECT_IDS.includes(r.id));

  // Try RAG first
  const token = loadEnvToken();
  const ragResults = await queryRAG(prompt, token);

  if (ragResults && ragResults.length > 0) {
    const context = formatRules(ragResults, 'RAG', alwaysRules);
    if (context) {
      console.log(buildOutput(context));
      return;
    }
  }

  // Fallback to local keyword matching
  const localResults = localMatch(prompt);
  // Merge: always-inject + matched, deduplicate by id
  const seenIds = new Set(localResults.map((r) => r.id));
  const merged = [...localResults, ...alwaysRules.filter((r) => !seenIds.has(r.id))];

  if (merged.length > 0) {
    const context = formatRules(merged, 'local');
    if (context) {
      console.log(buildOutput(context));
      return;
    }
  }

  // No matches
  console.log(JSON.stringify({}));
}

main();
