/**
 * 期权策略决策日志服务
 *
 * 功能：
 * 1. 记录期权策略的完整决策链路（9个检查点）
 * 2. 仅在美股交易时间写入数据库（避免非交易时间数据污染）
 * 3. 支持分步记录和最终汇总
 *
 * 设计原则：
 * - 只在交易时间写入数据库，非交易时间只输出console
 * - 使用构建器模式收集各个检查点数据
 * - 支持错误处理和部分数据记录
 */

import pool from '../config/database';
import { isTradingHours, isPreMarketHours } from '../utils/trading-hours';

export interface OptionDecisionLog {
  strategyId: number;
  underlyingSymbol: string;

  // 检查点1: 市场数据充足性
  dataCheck?: {
    spxCount: number;
    usdCount: number;
    btcCount: number;
    vixAvailable: boolean;
    temperatureAvailable: boolean;
    passed: boolean;
    error?: string;
  };

  // 检查点2: 信号方向判定
  signal?: {
    direction: 'CALL' | 'PUT' | 'HOLD';
    confidence: number;
    marketScore: number;
    intradayScore: number;
    timeAdjustment: number;
    finalScore: number;
  };

  // 检查点3: 风险等级评估
  risk?: {
    level: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    vixValue?: number;
    temperatureValue?: number;
    score?: number;
    blocked: boolean;
  };

  // 检查点4: 0DTE期权可用性
  dteCheck?: {
    mode: '0DTE' | 'NEAREST';
    available: boolean;
    expiryDate?: string;
    leftDays?: number;
  };

  // 检查点5: 期权链数据
  chainData?: {
    contractsCount: number;
    strikeRangeMin?: number;
    strikeRangeMax?: number;
    available: boolean;
  };

  // 检查点6+7: 流动性和Greeks筛选
  filtering?: {
    candidatesBefore: number;
    liquidityPassed: number;
    greeksPassed: number;
    finalSelected: boolean;
    reason?: string;
  };

  // 检查点8: 入场价格有效性
  pricing?: {
    mode: 'ASK' | 'MID';
    ask?: number;
    bid?: number;
    mid?: number;
    selected?: number;
    valid: boolean;
  };

  // 检查点9: 信号生成结果
  signalGenerated?: {
    success: boolean;
    signalId?: number;
    optionSymbol?: string;
    contracts?: number;
    premium?: number;
    delta?: number;
    theta?: number;
    estimatedCost?: number;
  };

  // 最终结果
  finalResult: 'SIGNAL_GENERATED' | 'NO_SIGNAL' | 'ERROR';
  rejectionReason?: string;
  rejectionCheckpoint?: string;
  extraData?: any;
}

class OptionDecisionLoggerService {
  /**
   * 记录完整的决策日志
   * @param log 决策日志对象
   * @returns 日志ID（如果成功写入数据库），否则返回null
   */
  async logDecision(log: OptionDecisionLog): Promise<number | null> {
    // 检查是否在交易时间（包括盘前）
    const shouldWriteToDb = isTradingHours() || isPreMarketHours();

    if (!shouldWriteToDb) {
      // 非交易时间只输出到console
      console.log(`[非交易时间] 跳过数据库写入: ${log.underlyingSymbol} -> ${log.finalResult}`);
      return null;
    }

    try {
      const query = `
        INSERT INTO option_strategy_decision_logs (
          strategy_id, underlying_symbol, execution_time,

          -- 检查点1
          data_check_spx_count, data_check_usd_count, data_check_btc_count,
          data_check_vix_available, data_check_temperature_available,
          data_check_passed, data_check_error,

          -- 检查点2
          signal_direction, signal_confidence,
          signal_market_score, signal_intraday_score,
          signal_time_adjustment, signal_final_score,

          -- 检查点3
          risk_level, risk_vix_value, risk_temperature_value,
          risk_score, risk_blocked,

          -- 检查点4
          dte_check_mode, dte_check_available,
          dte_check_expiry_date, dte_check_left_days,

          -- 检查点5
          chain_contracts_count, chain_strike_range_min, chain_strike_range_max,
          chain_data_available,

          -- 检查点6+7
          filter_candidates_before, filter_liquidity_passed,
          filter_greeks_passed, filter_final_selected, filter_reason,

          -- 检查点8
          price_mode, price_ask, price_bid, price_mid,
          price_selected, price_valid,

          -- 检查点9
          signal_generated, signal_id, option_symbol,
          option_contracts, option_premium, option_delta,
          option_theta, estimated_cost,

          -- 最终结果
          final_result, rejection_reason, rejection_checkpoint, extra_data
        )
        VALUES (
          $1, $2, NOW(),
          $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20,
          $21, $22, $23, $24,
          $25, $26, $27, $28,
          $29, $30, $31, $32, $33,
          $34, $35, $36, $37, $38, $39,
          $40, $41, $42, $43, $44, $45, $46, $47,
          $48, $49, $50, $51
        )
        RETURNING id
      `;

      const values = [
        log.strategyId,
        log.underlyingSymbol,

        // 检查点1
        log.dataCheck?.spxCount ?? null,
        log.dataCheck?.usdCount ?? null,
        log.dataCheck?.btcCount ?? null,
        log.dataCheck?.vixAvailable ?? null,
        log.dataCheck?.temperatureAvailable ?? null,
        log.dataCheck?.passed ?? false,
        log.dataCheck?.error ?? null,

        // 检查点2
        log.signal?.direction ?? null,
        log.signal?.confidence ?? null,
        log.signal?.marketScore ?? null,
        log.signal?.intradayScore ?? null,
        log.signal?.timeAdjustment ?? null,
        log.signal?.finalScore ?? null,

        // 检查点3
        log.risk?.level ?? null,
        log.risk?.vixValue ?? null,
        log.risk?.temperatureValue ?? null,
        log.risk?.score ?? null,
        log.risk?.blocked ?? false,

        // 检查点4
        log.dteCheck?.mode ?? null,
        log.dteCheck?.available ?? null,
        log.dteCheck?.expiryDate ?? null,
        log.dteCheck?.leftDays ?? null,

        // 检查点5
        log.chainData?.contractsCount ?? null,
        log.chainData?.strikeRangeMin ?? null,
        log.chainData?.strikeRangeMax ?? null,
        log.chainData?.available ?? false,

        // 检查点6+7
        log.filtering?.candidatesBefore ?? null,
        log.filtering?.liquidityPassed ?? null,
        log.filtering?.greeksPassed ?? null,
        log.filtering?.finalSelected ?? false,
        log.filtering?.reason ?? null,

        // 检查点8
        log.pricing?.mode ?? null,
        log.pricing?.ask ?? null,
        log.pricing?.bid ?? null,
        log.pricing?.mid ?? null,
        log.pricing?.selected ?? null,
        log.pricing?.valid ?? false,

        // 检查点9
        log.signalGenerated?.success ?? false,
        log.signalGenerated?.signalId ?? null,
        log.signalGenerated?.optionSymbol ?? null,
        log.signalGenerated?.contracts ?? null,
        log.signalGenerated?.premium ?? null,
        log.signalGenerated?.delta ?? null,
        log.signalGenerated?.theta ?? null,
        log.signalGenerated?.estimatedCost ?? null,

        // 最终结果
        log.finalResult,
        log.rejectionReason ?? null,
        log.rejectionCheckpoint ?? null,
        log.extraData ? JSON.stringify(log.extraData) : null,
      ];

      const result = await pool.query(query, values);
      const logId = result.rows[0].id;

      console.log(`✅ [决策日志已写入] ID=${logId} | ${log.underlyingSymbol} -> ${log.finalResult}`);

      return logId;
    } catch (error: any) {
      console.error(`❌ [决策日志写入失败] ${log.underlyingSymbol}:`, error.message);
      return null;
    }
  }

  /**
   * 查询最近的决策日志
   * @param strategyId 策略ID（可选）
   * @param limit 返回记录数量
   * @returns 决策日志列表
   */
  async getRecentLogs(strategyId?: number, limit: number = 100): Promise<any[]> {
    try {
      let query = `
        SELECT * FROM option_strategy_decision_logs
        WHERE 1=1
      `;
      const params: any[] = [];

      if (strategyId) {
        params.push(strategyId);
        query += ` AND strategy_id = $${params.length}`;
      }

      query += ` ORDER BY execution_time DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await pool.query(query, params);
      return result.rows;
    } catch (error: any) {
      console.error('查询决策日志失败:', error.message);
      return [];
    }
  }

  /**
   * 统计未生成信号的原因
   * @param hours 统计最近N小时的数据
   * @returns 原因统计
   */
  async getNoSignalReasons(hours: number = 24): Promise<any[]> {
    try {
      const query = `
        SELECT
          rejection_checkpoint,
          rejection_reason,
          COUNT(*) as count
        FROM option_strategy_decision_logs
        WHERE execution_time > NOW() - INTERVAL '${hours} hours'
          AND final_result = 'NO_SIGNAL'
        GROUP BY rejection_checkpoint, rejection_reason
        ORDER BY count DESC
      `;

      const result = await pool.query(query);
      return result.rows;
    } catch (error: any) {
      console.error('统计未生成信号原因失败:', error.message);
      return [];
    }
  }
}

// 导出单例
const optionDecisionLoggerService = new OptionDecisionLoggerService();
export default optionDecisionLoggerService;
