import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import pool from '../config/database';

/**
 * API 认证中间件
 *
 * 支持两种认证方式（任一通过即可）：
 *
 * A) Cloudflare Access SSO（推荐用于浏览器访问）
 *    - 检测 `Cf-Access-Jwt-Assertion` 请求头（由 Cloudflare Tunnel + Access 自动注入）
 *    - 如果存在，说明请求已通过 Cloudflare SSO 认证，直接放行
 *
 * B) API Key（用于程序化/内部调用）
 *    - 从请求头读取 API Key（Authorization: Bearer <key> 或 X-API-Key）
 *    - 先与环境变量 API_AUTH_KEY 比较
 *    - 如果环境变量未配置，回退到 system_config 表中 key='api_auth_key' 的值（5 分钟内存缓存）
 *
 * 如果两种方式均未配置（无 Cloudflare 头 + 无 API Key 配置），视为认证未启用，放行并警告。
 */

// ---- DB key 缓存 ----
interface CachedKey {
  value: string | null;
  fetchedAt: number;
}

const DB_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cachedDbKey: CachedKey | null = null;

/**
 * 从请求头中提取 API Key
 */
function extractApiKey(req: Request): string | null {
  // Authorization: Bearer <key>
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) {
      return token;
    }
  }

  // X-API-Key header
  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.trim().length > 0) {
    return xApiKey.trim();
  }

  return null;
}

/**
 * 从 system_config 表获取 api_auth_key（带内存缓存）
 */
async function getDbAuthKey(): Promise<string | null> {
  // 命中缓存且未过期
  if (cachedDbKey && Date.now() - cachedDbKey.fetchedAt < DB_CACHE_TTL_MS) {
    return cachedDbKey.value;
  }

  try {
    const result = await pool.query(
      'SELECT config_value FROM system_config WHERE config_key = $1',
      ['api_auth_key'],
    );

    const value =
      result.rows.length > 0 && result.rows[0].config_value
        ? (result.rows[0].config_value as string).trim()
        : null;

    cachedDbKey = { value: value || null, fetchedAt: Date.now() };
    return cachedDbKey.value;
  } catch (error: unknown) {
    // DB 查询失败时不阻塞请求——使用上一次缓存值（如有），否则返回 null
    logger.warn('Auth middleware: failed to fetch api_auth_key from DB', {
      error: error instanceof Error ? error.message : String(error),
    });
    return cachedDbKey?.value ?? null;
  }
}

/**
 * 时间安全的字符串比较，防止时序攻击
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // 仍需遍历以保持恒定时间
    let dummy = 0;
    for (let i = 0; i < a.length; i++) {
      dummy |= a.charCodeAt(i) ^ a.charCodeAt(i);
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    dummy;
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * API 认证中间件
 */
export async function apiAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // ---- 方式 A: Cloudflare Access SSO ----
  // Cloudflare Tunnel + Access 会在通过 SSO 认证后自动注入此头
  const cfJwt = req.headers['cf-access-jwt-assertion'];
  if (cfJwt && typeof cfJwt === 'string' && cfJwt.length > 0) {
    // 请求已通过 Cloudflare Access SSO 认证，直接放行
    // 注意：JWT 签名验证由 Cloudflare 边缘完成，应用层信任该头的存在性
    next();
    return;
  }

  // ---- 方式 B: API Key ----
  const clientKey = extractApiKey(req);
  const envKey = process.env.API_AUTH_KEY;
  const dbKey = await getDbAuthKey();

  // B-1: 客户端提供了 key，验证是否匹配
  if (clientKey) {
    if (envKey && timingSafeEqual(clientKey, envKey)) {
      next();
      return;
    }
    if (dbKey && timingSafeEqual(clientKey, dbKey)) {
      next();
      return;
    }
    // key 提供了但不匹配
    logger.warn('Auth: invalid API key', { path: req.path, method: req.method, ip: req.ip });
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid or missing API key' },
    });
    return;
  }

  // B-2: 客户端未提供 key
  //   如果服务端也没有配置 key（env 和 DB 都为空），视为认证未启用，放行
  //   这兼容内网直接访问（NAS 本地 IP:端口）且尚未配置 API Key 的场景
  if (!envKey && !dbKey) {
    next();
    return;
  }

  // B-3: 服务端配了 key 但客户端没提供且不是 Cloudflare SSO
  logger.warn('Auth: missing API key', { path: req.path, method: req.method, ip: req.ip });
  res.status(401).json({
    success: false,
    error: { code: 'UNAUTHORIZED', message: 'Invalid or missing API key' },
  });
}
