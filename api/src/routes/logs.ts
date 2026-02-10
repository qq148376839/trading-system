/**
 * 日志查询API路由
 * 提供日志查询、导出、清理功能
 */

import express, { Request, Response, NextFunction } from 'express';
import { PoolClient } from 'pg';
import QueryStream from 'pg-query-stream';
import pool from '../config/database';
import { logger } from '../utils/logger';
import { ErrorFactory } from '../utils/errors';
import logCleanupService from '../services/log-cleanup.service';
import { getAllModuleMappings, getModuleChineseName } from '../utils/log-module-mapper';

const logsRouter = express.Router();

/**
 * 查询日志
 * GET /api/logs
 * 
 * 查询参数：
 * - module: 模块名称（可选）
 * - level: 日志级别，多个用逗号分隔（可选）
 * - start_time: 开始时间 ISO 8601格式（可选）
 * - end_time: 结束时间 ISO 8601格式（可选）
 * - trace_id: 链路追踪ID（可选）
 * - limit: 返回数量限制，默认100，最大1000（可选）
 * - offset: 偏移量，默认0（可选）
 */
logsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      module,
      level,
      start_time,
      end_time,
      trace_id,
      limit = '100',
      offset = '0',
      order = 'DESC', // 排序方式：DESC（降序，最新的在前）或 ASC（升序，最旧的在前）
    } = req.query;

    // 参数验证
    const limitNum = parseInt(limit as string, 10);
    let offsetNum = parseInt(offset as string, 10);

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
      return next(ErrorFactory.validationError('limit必须在1-1000之间'));
    }

    if (isNaN(offsetNum) || offsetNum < 0) {
      return next(ErrorFactory.validationError('offset必须大于等于0'));
    }

    // 验证排序参数
    const orderBy = (order as string).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // 构建查询条件
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (module) {
      conditions.push(`module = $${paramIndex++}`);
      params.push(module);
    }

    if (level) {
      const levels = (level as string).split(',').map((l) => l.trim().toUpperCase());
      if (levels.length === 1) {
        conditions.push(`level = $${paramIndex++}`);
        params.push(levels[0]);
      } else {
        conditions.push(`level = ANY($${paramIndex++})`);
        params.push(levels);
      }
    }

    if (start_time) {
      try {
        const startDate = new Date(start_time as string);
        if (isNaN(startDate.getTime())) {
          return next(ErrorFactory.validationError('start_time格式错误，请使用ISO 8601格式'));
        }
        // 使用CAST函数确保PostgreSQL正确识别时间类型
        conditions.push(`timestamp >= CAST($${paramIndex++} AS TIMESTAMPTZ)`);
        params.push(startDate.toISOString());
      } catch (error) {
        return next(ErrorFactory.validationError('start_time格式错误，请使用ISO 8601格式'));
      }
    }

    if (end_time) {
      try {
        const endDate = new Date(end_time as string);
        if (isNaN(endDate.getTime())) {
          return next(ErrorFactory.validationError('end_time格式错误，请使用ISO 8601格式'));
        }
        // 使用CAST函数确保PostgreSQL正确识别时间类型
        conditions.push(`timestamp <= CAST($${paramIndex++} AS TIMESTAMPTZ)`);
        params.push(endDate.toISOString());
      } catch (error) {
        return next(ErrorFactory.validationError('end_time格式错误，请使用ISO 8601格式'));
      }
    }

    if (trace_id) {
      conditions.push(`trace_id = $${paramIndex++}`);
      params.push(trace_id);
    }

    // 构建SQL查询
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    // 调试日志：记录查询条件和参数
    if (start_time || end_time) {
      logger.debug('[Logs.API] 查询日志 - 时间筛选', {
        start_time: start_time ? new Date(start_time as string).toISOString() : null,
        end_time: end_time ? new Date(end_time as string).toISOString() : null,
        whereClause,
        conditions: conditions,
        params: params,
      });
    }
    
    // 查询总数
    const countQuery = `SELECT COUNT(*) as total FROM system_logs ${whereClause}`;
    logger.debug('[Logs.API] 执行COUNT查询:', countQuery, '参数:', params);
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total, 10);
    logger.debug('[Logs.API] COUNT查询结果:', total);
    
    // 保护：如果 offset 超过总数，则重置为 0
    if (offsetNum >= total) {
      logger.debug(`[Logs.API] offset (${offsetNum}) 超过总数 (${total})，重置为 0`);
      offsetNum = 0;
    }
    
    // 查询日志列表
    const queryParams = [...params]; // 复制参数数组，避免影响countQuery
    const query = `
      SELECT 
        id,
        timestamp,
        level,
        module,
        message,
        trace_id,
        extra_data,
        file_path,
        line_no,
        created_at
      FROM system_logs
      ${whereClause}
      ORDER BY timestamp ${orderBy}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    
    queryParams.push(limitNum, offsetNum);
    const result = await pool.query(query, queryParams);

    // 格式化返回数据
    const logs = result.rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      level: row.level,
      module: row.module,
      message: row.message,
      traceId: row.trace_id,
      extraData: row.extra_data,
      filePath: row.file_path,
      lineNo: row.line_no,
      createdAt: row.created_at,
    }));

    res.json({
      success: true,
      data: {
        logs,
        total,
        limit: limitNum,
        offset: offsetNum,
      },
    });
  } catch (error: any) {
    logger.error('[Logs.API] 查询日志失败', { error: error.message });
    next(ErrorFactory.internalError('查询日志失败', error));
  }
});

/**
 * 导出日志
 * GET /api/logs/export
 * 
 * 查询参数与查询API相同，但返回JSON文件下载
 */
logsRouter.get('/export', async (req: Request, res: Response, next: NextFunction) => {
  let client: PoolClient | undefined;
  let released = false;

  const releaseClient = (): void => {
    if (!released && client) {
      released = true;
      client.release();
    }
  };

  try {
    const {
      module,
      level,
      start_time,
      end_time,
      trace_id,
    } = req.query;

    // 构建查询条件（与查询API相同）
    const conditions: string[] = [];
    const params: (string | string[])[] = [];
    let paramIndex = 1;

    if (module) {
      conditions.push(`module = $${paramIndex++}`);
      params.push(module as string);
    }

    if (level) {
      const levels = (level as string).split(',').map((l) => l.trim().toUpperCase());
      if (levels.length === 1) {
        conditions.push(`level = $${paramIndex++}`);
        params.push(levels[0]);
      } else {
        conditions.push(`level = ANY($${paramIndex++})`);
        params.push(levels);
      }
    }

    if (start_time) {
      try {
        const startDate = new Date(start_time as string);
        if (isNaN(startDate.getTime())) {
          return next(ErrorFactory.validationError('start_time格式错误，请使用ISO 8601格式'));
        }
        conditions.push(`timestamp >= $${paramIndex++}::timestamptz`);
        params.push(startDate.toISOString());
      } catch (error) {
        return next(ErrorFactory.validationError('start_time格式错误，请使用ISO 8601格式'));
      }
    }

    if (end_time) {
      try {
        const endDate = new Date(end_time as string);
        if (isNaN(endDate.getTime())) {
          return next(ErrorFactory.validationError('end_time格式错误，请使用ISO 8601格式'));
        }
        conditions.push(`timestamp <= $${paramIndex++}::timestamptz`);
        params.push(endDate.toISOString());
      } catch (error) {
        return next(ErrorFactory.validationError('end_time格式错误，请使用ISO 8601格式'));
      }
    }

    if (trace_id) {
      conditions.push(`trace_id = $${paramIndex++}`);
      params.push(trace_id as string);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 调试日志：记录导出查询条件和参数
    if (start_time || end_time || module || level || trace_id) {
      logger.debug('[Logs.API] 导出日志(流式) - 筛选条件', {
        start_time: start_time ? new Date(start_time as string).toISOString() : null,
        end_time: end_time ? new Date(end_time as string).toISOString() : null,
        module,
        level,
        trace_id,
        whereClause,
        conditions: conditions,
        params: params,
      });
    }

    // 限制最大导出数量（100000条）
    const maxExportLimit = 100000;
    const queryText = `
      SELECT
        id,
        timestamp,
        level,
        module,
        message,
        trace_id,
        extra_data,
        file_path,
        line_no,
        created_at
      FROM system_logs
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT $${paramIndex++}
    `;
    params.push(String(maxExportLimit));

    // 获取独立的数据库连接用于流式查询
    client = await pool.connect();

    // 客户端断开时释放连接
    req.on('close', releaseClient);

    const stream = client.query(new QueryStream(queryText, params, { batchSize: 500 }));

    // 生成文件名
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const filename = `logs-${dateStr}.ndjson`;

    // 设置流式响应头
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Transfer-Encoding', 'chunked');

    // 写入 meta 行
    const filters: Record<string, string> = {};
    if (module) filters.module = module as string;
    if (level) filters.level = level as string;
    if (start_time) filters.start_time = start_time as string;
    if (end_time) filters.end_time = end_time as string;
    if (trace_id) filters.trace_id = trace_id as string;

    res.write(JSON.stringify({ meta: { exportedAt: now.toISOString(), filters } }) + '\n');

    let total = 0;

    stream.on('data', (row: Record<string, unknown>) => {
      total++;
      const formatted = {
        id: row.id,
        timestamp: row.timestamp,
        level: row.level,
        module: row.module,
        message: row.message,
        traceId: row.trace_id,
        extraData: row.extra_data,
        filePath: row.file_path,
        lineNo: row.line_no,
        createdAt: row.created_at,
      };
      res.write(JSON.stringify(formatted) + '\n');
    });

    stream.on('end', () => {
      // 写入 summary 行
      res.write(JSON.stringify({ summary: { total } }) + '\n');
      res.end();
      releaseClient();
      logger.info(`[Logs.API] 流式导出完成，共 ${total} 条`);
    });

    stream.on('error', (err: Error) => {
      logger.error('[Logs.API] 流式导出查询出错', { error: err.message });
      releaseClient();
      // 如果还没开始发送数据头之外的内容，可以尝试发送错误
      if (!res.headersSent) {
        next(ErrorFactory.internalError('导出日志失败', err));
      } else {
        // 已经开始发送数据，只能中断连接
        res.end();
      }
    });
  } catch (error: unknown) {
    releaseClient();
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('[Logs.API] 导出日志失败', { error: errMsg });
    next(ErrorFactory.internalError('导出日志失败', error));
  }
});

/**
 * 清理日志
 * DELETE /api/logs/cleanup
 * 
 * 查询参数：
 * - before_date: 删除此日期之前的日志（ISO 8601格式，必填）
 * - dry_run: 是否仅预览，不实际删除（默认false）
 */
logsRouter.delete('/cleanup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { before_date, dry_run = 'false' } = req.query;

    if (!before_date) {
      return next(ErrorFactory.missingParameter('before_date'));
    }

    const beforeDate = new Date(before_date as string);
    if (isNaN(beforeDate.getTime())) {
      return next(ErrorFactory.validationError('before_date格式错误，请使用ISO 8601格式'));
    }

    const isDryRun = dry_run === 'true' || dry_run === '1';

    // 调用清理服务
    const result = await logCleanupService.cleanup(beforeDate, isDryRun);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('[Logs.API] 清理日志失败', { error: error.message });
    next(ErrorFactory.internalError('清理日志失败', error));
  }
});

/**
 * 获取所有可用的日志模块列表
 * GET /api/logs/modules
 */
logsRouter.get('/modules', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 查询数据库获取所有唯一的模块名称
    const query = `
      SELECT DISTINCT module
      FROM system_logs
      ORDER BY module
    `
    const result = await pool.query(query)
    
    // 获取所有映射规则
    const allMappings = getAllModuleMappings()
    const moduleMap = new Map(allMappings.map(m => [m.module, m]))
    
    // 获取模块中文名称和描述
    const modules = result.rows.map((row) => {
      const module = row.module
      const mapping = moduleMap.get(module)
      return {
        module,
        chineseName: mapping?.chineseName || '',
        description: mapping?.description || '',
      }
    })
    
    res.json({
      success: true,
      data: { modules },
    })
  } catch (error: any) {
    logger.error('[Logs.API] 获取模块列表失败', { error: error.message })
    next(ErrorFactory.internalError('获取模块列表失败', error))
  }
})

export { logsRouter };

