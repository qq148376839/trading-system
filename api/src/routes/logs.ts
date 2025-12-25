/**
 * 日志查询API路由
 * 提供日志查询、导出、清理功能
 */

import express, { Request, Response, NextFunction } from 'express';
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
    
    // 调试日志：记录查询条件和参数（使用console.log确保输出）
    if (start_time || end_time) {
      console.log('[Logs.API] 查询日志 - 时间筛选调试信息:', {
        start_time: start_time ? new Date(start_time as string).toISOString() : null,
        end_time: end_time ? new Date(end_time as string).toISOString() : null,
        whereClause,
        conditions: conditions,
        params: params,
        paramCount: params.length,
      });
      logger.debug('Logs.API', '查询日志 - 时间筛选', {
        start_time: start_time ? new Date(start_time as string).toISOString() : null,
        end_time: end_time ? new Date(end_time as string).toISOString() : null,
        conditions: conditions,
        params: params,
      });
    }
    
    // 查询总数
    const countQuery = `SELECT COUNT(*) as total FROM system_logs ${whereClause}`;
    console.log('[Logs.API] 执行COUNT查询:', countQuery, '参数:', params);
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total, 10);
    console.log('[Logs.API] COUNT查询结果:', total);
    
    // 保护：如果 offset 超过总数，则重置为 0
    if (offsetNum >= total) {
      console.log(`[Logs.API] offset (${offsetNum}) 超过总数 (${total})，重置为 0`);
      offsetNum = 0;
    }
    
    // 调试：检查时间范围内的数据分布
    if (start_time || end_time) {
      const rangeQuery = `
        SELECT 
          MIN(timestamp) as min_time,
          MAX(timestamp) as max_time,
          COUNT(*) as count
        FROM system_logs
        ${whereClause}
      `;
      const rangeResult = await pool.query(rangeQuery, params);
      console.log('[Logs.API] 时间范围内数据分布:', rangeResult.rows[0]);
      
      // 调试：检查数据库中的总数据量（无筛选条件）
      const totalCountQuery = `SELECT COUNT(*) as total FROM system_logs`;
      const totalCountResult = await pool.query(totalCountQuery);
      const totalCount = parseInt(totalCountResult.rows[0].total, 10);
      console.log('[Logs.API] 数据库总数据量:', totalCount);
      console.log('[Logs.API] 筛选后数据量:', total, '占比:', ((total / totalCount) * 100).toFixed(2) + '%');
      
      // 调试：检查筛选条件外的数据量
      if (start_time) {
        const beforeStartQuery = `SELECT COUNT(*) as count FROM system_logs WHERE timestamp < $1::timestamptz`;
        const beforeStartResult = await pool.query(beforeStartQuery, [new Date(start_time as string).toISOString()]);
        console.log('[Logs.API] 开始时间之前的数据量:', beforeStartResult.rows[0].count);
      }
      if (end_time) {
        const afterEndQuery = `SELECT COUNT(*) as count FROM system_logs WHERE timestamp > $1::timestamptz`;
        const afterEndResult = await pool.query(afterEndQuery, [new Date(end_time as string).toISOString()]);
        console.log('[Logs.API] 结束时间之后的数据量:', afterEndResult.rows[0].count);
      }
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
    console.log('[Logs.API] 执行SELECT查询:', query.replace(/\s+/g, ' '), '参数:', queryParams);
    const result = await pool.query(query, queryParams);
    console.log('[Logs.API] SELECT查询结果数量:', result.rows.length);
    
    // 调试：检查返回数据的时间范围
    if (result.rows.length > 0 && (start_time || end_time)) {
      const timestamps = result.rows.map(row => row.timestamp);
      const minTime = timestamps.reduce((min, ts) => ts < min ? ts : min, timestamps[0]);
      const maxTime = timestamps.reduce((max, ts) => ts > max ? ts : max, timestamps[0]);
      console.log('[Logs.API] 返回数据时间范围:', {
        min: minTime,
        max: maxTime,
        expectedStart: start_time ? new Date(start_time as string).toISOString() : null,
        expectedEnd: end_time ? new Date(end_time as string).toISOString() : null,
      });
    }

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
    logger.error('Logs.API', '查询日志失败', { error: error.message });
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
        // 使用ISO字符串，PostgreSQL的TIMESTAMPTZ可以直接解析
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
        // 使用ISO字符串，PostgreSQL的TIMESTAMPTZ可以直接解析
        conditions.push(`timestamp <= $${paramIndex++}::timestamptz`);
        params.push(endDate.toISOString());
      } catch (error) {
        return next(ErrorFactory.validationError('end_time格式错误，请使用ISO 8601格式'));
      }
    }

    if (trace_id) {
      conditions.push(`trace_id = $${paramIndex++}`);
      params.push(trace_id);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 调试日志：记录导出查询条件和参数
    if (start_time || end_time || module || level || trace_id) {
      console.log('[Logs.API] 导出日志 - 筛选条件:', {
        start_time: start_time ? new Date(start_time as string).toISOString() : null,
        end_time: end_time ? new Date(end_time as string).toISOString() : null,
        module,
        level,
        trace_id,
        whereClause,
        conditions: conditions,
        params: params,
      });
      logger.debug('Logs.API', '导出日志 - 筛选条件', {
        start_time: start_time ? new Date(start_time as string).toISOString() : null,
        end_time: end_time ? new Date(end_time as string).toISOString() : null,
        module,
        level,
        trace_id,
        conditions: conditions,
        params: params,
      });
    }

    // 限制最大导出数量（100000条）
    const maxExportLimit = 100000;
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
      ORDER BY timestamp DESC
      LIMIT $${paramIndex++}
    `;
    
    params.push(maxExportLimit);
    const result = await pool.query(query, params);

    // 格式化数据
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

    // 生成文件名
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const filename = `logs-${dateStr}.json`;

    // 设置响应头
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // 返回JSON数据
    res.json({
      success: true,
      data: {
        exportedAt: now.toISOString(),
        total: logs.length,
        logs,
      },
    });
  } catch (error: any) {
    logger.error('Logs.API', '导出日志失败', { error: error.message });
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
    logger.error('Logs.API', '清理日志失败', { error: error.message });
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
    logger.error('Logs.API', '获取模块列表失败', { error: error.message })
    next(ErrorFactory.internalError('获取模块列表失败', error))
  }
})

export { logsRouter };

