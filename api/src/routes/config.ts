/**
 * 配置管理API路由
 * 支持Windows和Docker部署
 */

import { Router, Request, Response, NextFunction } from 'express';
import configService from '../services/config.service';
import bcrypt from 'bcryptjs';
import pool from '../config/database';
import { ErrorFactory, normalizeError } from '../utils/errors';
import { logger } from '../utils/logger';

export const configRouter = Router();

/**
 * 中间件：验证管理员身份
 * 支持两种认证方式：
 * 1. username/password（用于兼容旧代码）
 * 2. authUsername/authPassword（用于区分认证和更新字段）
 */
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    // 优先使用authUsername/authPassword，如果没有则使用username/password（向后兼容）
    const { username, password, authUsername, authPassword } = req.body;
    const authUser = authUsername || username;
    const authPass = authPassword || password;
    
    if (!authUser || !authPass) {
      return next(ErrorFactory.unauthorized('缺少用户名或密码'));
    }

    const result = await pool.query(
      'SELECT password_hash FROM admin_users WHERE username = $1 AND is_active = true',
      [authUser]
    );
    
    if (result.rows.length === 0) {
      return next(ErrorFactory.unauthorized('管理员账户不存在或已禁用'));
    }

    const isValid = await bcrypt.compare(authPass, result.rows[0].password_hash);
    if (!isValid) {
      return next(ErrorFactory.unauthorized('密码错误'));
    }

    // 更新最后登录时间
    await pool.query(
      'UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE username = $1',
      [authUser]
    );

    // 将用户名附加到请求对象，供后续使用
    (req as any).adminUsername = authUser;
    next();
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
}

/**
 * @openapi
 * /config/auth:
 *   post:
 *     tags:
 *       - 系统配置
 *     summary: 管理员登录
 *     description: 验证管理员用户名和密码
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: 登录成功
 *       401:
 *         description: 认证失败
 */
configRouter.post('/auth', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return next(ErrorFactory.missingParameter('username 或 password'));
    }

    const result = await pool.query(
      'SELECT password_hash FROM admin_users WHERE username = $1 AND is_active = true',
      [username]
    );
    
    if (result.rows.length === 0) {
      return next(ErrorFactory.unauthorized('管理员账户不存在或已禁用'));
    }

    const isValid = await bcrypt.compare(password, result.rows[0].password_hash);
    if (!isValid) {
      return next(ErrorFactory.unauthorized('密码错误'));
    }

    // 更新最后登录时间
    await pool.query(
      'UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE username = $1',
      [username]
    );

    res.json({
      success: true,
      data: { message: '登录成功' },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /config:
 *   get:
 *     tags:
 *       - 系统配置
 *     summary: 获取所有配置
 *     description: 获取系统全部配置项 (需要管理员权限)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 查询成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     configs:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           key:
 *                             type: string
 *                           value:
 *                             type: string
 *                           encrypted:
 *                             type: boolean
 *                           updated_at:
 *                             type: string
 */
configRouter.get('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const configs = await configService.getAllConfigs();
    res.json({ 
      success: true, 
      data: { configs } 
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * POST /api/config
 * 获取所有配置（需要管理员认证，支持POST请求）
 */
configRouter.post('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const configs = await configService.getAllConfigs();
    res.json({ 
      success: true, 
      data: { configs } 
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * POST /api/config/get-value
 * 获取单个配置的解密值（需要管理员认证）
 */
configRouter.post('/get-value', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key } = req.body;
    if (!key) {
      return next(ErrorFactory.missingParameter('key'));
    }

    const value = await configService.getConfig(key);

    res.json({
      success: true,
      data: { key, value: value ?? '' },
    });
  } catch (error: unknown) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * POST /api/config/test-moomoo-cookie
 * 测试指定 Cookie 是否可用（需要管理员认证）
 * 通过边缘函数代理请求 SPX 日K 数据来验证
 */
configRouter.post('/test-moomoo-cookie', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cookies, csrfToken } = req.body;
    if (!cookies || !csrfToken) {
      return next(ErrorFactory.missingParameter('cookies 或 csrfToken'));
    }

    const { moomooProxy } = await import('../utils/moomoo-proxy');
    const startTime = Date.now();

    try {
      // 请求 SPX 日K（stockId=200003）来测试 cookie 有效性
      const response = await moomooProxy({
        path: '/api/quote/kline',
        params: {
          stockId: '200003',
          marketType: 1,
          type: 2,       // 日K
          count: 100,
        },
        cookies,
        csrfToken,
        timeout: 20000,
      });

      const duration = Date.now() - startTime;
      const code = response?.code ?? response?.data?.code;
      const msg = response?.message ?? response?.data?.message ?? 'OK';
      const dataList = response?.data?.list ?? response?.list ?? [];

      res.json({
        success: true,
        data: {
          cookieValid: code === 0 || code === undefined,
          responseCode: code ?? 0,
          responseMessage: msg,
          duration: `${duration}ms`,
          dataPoints: Array.isArray(dataList) ? dataList.length : 0,
        },
      });
    } catch (testError: unknown) {
      const duration = Date.now() - startTime;
      const msg = testError instanceof Error ? testError.message : String(testError);

      res.json({
        success: true,
        data: {
          cookieValid: false,
          responseCode: -1,
          responseMessage: msg,
          duration: `${duration}ms`,
          dataPoints: 0,
        },
      });
    }
  } catch (error: unknown) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/config/:key
 * 获取单个配置值（需要管理员认证）
 */
configRouter.get('/:key', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key } = req.params;
    const value = await configService.getConfig(key);
    
    if (value === null) {
      return next(ErrorFactory.notFound(`配置项 ${key}`));
    }

    res.json({
      success: true,
      data: { key, value },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /config/{key}:
 *   put:
 *     tags:
 *       - 系统配置
 *     summary: 更新单项配置
 *     description: 更新指定配置项的值 (需要管理员权限)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: 配置键名
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - value
 *             properties:
 *               value:
 *                 type: string
 *                 description: 配置值
 *               encrypted:
 *                 type: boolean
 *                 description: 是否加密存储 (可选)
 *     responses:
 *       200:
 *         description: 更新成功
 */
configRouter.put('/:key', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key } = req.params;
    const { value, encrypted } = req.body;
    const adminUsername = (req as any).adminUsername;

    if (value === undefined) {
      return next(ErrorFactory.missingParameter('value'));
    }

    // 确定是否需要加密（根据配置项类型）
    const shouldEncrypt = encrypted !== undefined 
      ? encrypted 
      : ['longport_app_key', 'longport_app_secret', 'longport_access_token', 'futunn_csrf_token', 'futunn_cookies', 'moomoo_guest_cookies'].includes(key);

    await configService.setConfig(key, String(value), shouldEncrypt, adminUsername);
    
    res.json({ 
      success: true, 
      data: { message: '配置更新成功' } 
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * POST /api/config/batch
 * 批量更新配置（需要管理员认证）
 */
configRouter.post('/batch', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { configs } = req.body;
    const adminUsername = (req as any).adminUsername;

    if (!Array.isArray(configs)) {
      return next(ErrorFactory.validationError('configs必须是数组'));
    }

    // 确定每个配置项是否需要加密
    const configsWithEncryption = configs.map((config: any) => ({
      key: config.key,
      value: String(config.value),
      encrypted: config.encrypted !== undefined 
        ? config.encrypted 
        : ['longport_app_key', 'longport_app_secret', 'longport_access_token', 'futunn_csrf_token', 'futunn_cookies', 'moomoo_guest_cookies'].includes(config.key),
    }));

    await configService.setConfigs(configsWithEncryption, adminUsername);
    
    res.json({ 
      success: true, 
      data: { message: '批量配置更新成功' } 
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * DELETE /api/config/:key
 * 删除配置（需要管理员认证）
 */
configRouter.delete('/:key', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key } = req.params;
    await configService.deleteConfig(key);
    
    res.json({ 
      success: true, 
      data: { message: '配置删除成功' } 
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * POST /api/config/admin/list
 * 获取所有管理员账户列表（需要管理员认证）
 */
configRouter.post('/admin/list', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      'SELECT id, username, created_at, last_login_at, is_active FROM admin_users ORDER BY created_at DESC'
    );
    
    res.json({
      success: true,
      data: { admins: result.rows },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * PUT /api/config/admin/:id
 * 更新管理员账户（需要管理员认证）
 */
configRouter.put('/admin/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    // requireAdmin中间件已经验证了当前登录管理员身份（使用req.body中的username和password）
    // 现在从body中读取要更新的字段
    // 注意：使用updateUsername来避免与认证字段username冲突
    const { 
      updateUsername,            // 要更新的用户名（使用updateUsername避免与认证字段冲突）
      oldPassword,               // 修改密码时需要验证的原密码
      newPassword,               // 新密码
      confirmPassword,           // 确认新密码
      is_active 
    } = req.body;

    // 先查询当前账户信息
    const currentAdmin = await pool.query(
      'SELECT id, username, password_hash, is_active FROM admin_users WHERE id = $1',
      [parseInt(id)]
    );

    if (currentAdmin.rows.length === 0) {
      return next(ErrorFactory.notFound('管理员账户'));
    }

    const currentUsername = currentAdmin.rows[0].username;
    const currentPasswordHash = currentAdmin.rows[0].password_hash;
    const currentIsActive = currentAdmin.rows[0].is_active;

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // 用户名更新：只有当新用户名与当前用户名不同时才更新
    if (updateUsername !== undefined && updateUsername !== null && updateUsername !== '' && updateUsername !== currentUsername) {
      updates.push(`username = $${paramIndex++}`);
      values.push(updateUsername);
    }

    // 密码更新：如果提供了新密码，需要验证原密码和确认密码
    if (newPassword !== undefined && newPassword !== null && newPassword !== '') {
      // 1. 验证原密码
      if (!oldPassword) {
        return next(ErrorFactory.missingParameter('oldPassword'));
      }

      const isOldPasswordValid = await bcrypt.compare(oldPassword, currentPasswordHash);
      if (!isOldPasswordValid) {
        return next(ErrorFactory.validationError('原密码错误'));
      }

      // 2. 验证新密码两次输入一致
      if (newPassword !== confirmPassword) {
        return next(ErrorFactory.validationError('新密码两次输入不一致'));
      }

      // 3. 验证新密码长度
      if (newPassword.length < 6) {
        return next(ErrorFactory.validationError('密码长度至少6位'));
      }

      // 4. 验证新密码不能与原密码相同
      const isSamePassword = await bcrypt.compare(newPassword, currentPasswordHash);
      if (isSamePassword) {
        return next(ErrorFactory.validationError('新密码不能与原密码相同'));
      }

      // 5. 更新密码
      const passwordHash = await bcrypt.hash(newPassword, 10);
      updates.push(`password_hash = $${paramIndex++}`);
      values.push(passwordHash);
    }

    // 状态更新：只有当状态有变化时才更新
    if (is_active !== undefined && is_active !== null && is_active !== currentIsActive) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(is_active);
    }

    // 如果没有要更新的字段，返回错误
    if (updates.length === 0) {
      return next(ErrorFactory.validationError('没有有效的更新字段（所有字段都没有变化）'));
    }

    values.push(parseInt(id));

    // 执行更新
    const query = `UPDATE admin_users SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return next(ErrorFactory.notFound('管理员账户'));
    }

    // 验证更新是否成功：重新查询更新后的账户信息
    const updatedAdmin = await pool.query(
      'SELECT id, username, is_active FROM admin_users WHERE id = $1',
      [parseInt(id)]
    );

    res.json({
      success: true,
      data: { 
        message: '管理员账户更新成功',
        updated: updatedAdmin.rows[0]
      },
    });
  } catch (error: any) {
    logger.error('更新管理员账户失败:', error.message);
    
    // 检查是否是用户名重复错误
    if (error.code === '23505') {
      return next(ErrorFactory.resourceConflict('用户名已存在'));
    }

    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * POST /api/config/admin
 * 创建管理员账户（需要管理员认证）
 * 注意：requireAdmin中间件会从req.body读取username和password进行认证
 * 创建新账户时，新账户的用户名和密码使用newUsername和newPassword字段
 */
configRouter.post('/admin', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // requireAdmin已经验证了当前管理员身份，现在读取新账户信息
    const { newUsername, newPassword } = req.body;

    if (!newUsername || !newPassword) {
      return next(ErrorFactory.missingParameter('newUsername 或 newPassword'));
    }

    if (newPassword.length < 6) {
      return next(ErrorFactory.validationError('密码长度至少6位'));
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      'INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)',
      [newUsername, passwordHash]
    );

    res.json({
      success: true,
      data: { message: '管理员账户创建成功' },
    });
  } catch (error: any) {
    logger.error('创建管理员账户失败:', error.message);
    
    if (error.code === '23505') {
      return next(ErrorFactory.resourceConflict('用户名已存在'));
    }

    const appError = normalizeError(error);
    return next(appError);
  }
});

