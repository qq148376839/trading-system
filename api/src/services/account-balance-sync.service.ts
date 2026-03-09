/**
 * 账户余额同步服务
 * 定期同步账户余额，确保资金分配数据与实际账户一致
 */

import { getTradeContext } from '../config/longport';
import pool from '../config/database';
import { logger } from '../utils/logger';
import capitalManager from './capital-manager.service';
import stateManager from './state-manager.service';
import basicExecutionService from './basic-execution.service';
import orderPreventionMetrics from './order-prevention-metrics.service';
import { getOptionPrefixesForUnderlying, isLikelyOptionSymbol } from '../utils/options-symbol';

interface BalanceDiscrepancy {
  strategyId: number;
  expected: number;
  actual: number;
  difference: number;
  severity?: 'ERROR' | 'WARNING' | 'INFO';
  differencePercent?: number;
}

interface SyncResult {
  success: boolean;
  totalCapital: number;
  discrepancies?: BalanceDiscrepancy[];
  error?: string;
  lastSyncTime?: Date;
  strategies?: Array<{
    id: number;
    name: string;
    expectedAllocation: number;
  }>;
}

class AccountBalanceSyncService {
  private syncInterval: NodeJS.Timeout | null = null;
  private isSyncing: boolean = false;

  /**
   * 标准化Symbol格式
   * 确保symbol格式一致，便于匹配
   */
  private normalizeSymbol(symbol: string): string {
    if (!symbol) return symbol;
    
    // 如果symbol不包含市场后缀，添加.US（美股默认）
    if (!symbol.includes('.')) {
      return `${symbol}.US`;
    }
    
    return symbol.toUpperCase();
  }

  /**
   * 同步账户余额
   * 1. 从 Longbridge SDK 获取实时余额
   * 2. 查询数据库中所有策略的资金分配和使用情况
   * 3. 对比实际持仓价值与数据库记录
   * 4. 返回差异报告
   */
  async syncAccountBalance(): Promise<SyncResult> {
    if (this.isSyncing) {
      return {
        success: false,
        totalCapital: 0,
        error: '同步正在进行中，请稍后再试',
      };
    }

    this.isSyncing = true;

    try {
      // 1. 获取实时账户余额
      const tradeCtx = await getTradeContext();
      
      // 提取 USD 余额（与 capital-manager.service.ts 的逻辑保持一致）
      let totalCapital = 0;
      let foundUsd = false;
      
      // 首先尝试直接获取 USD 余额（如果SDK支持按币种查询）
      try {
        const usdBalances = await tradeCtx.accountBalance('USD');
        if (usdBalances && usdBalances.length > 0) {
          const usdBalance = usdBalances[0];
          // 优先使用 cashInfos 中的 availableCash
          if (usdBalance.cashInfos && Array.isArray(usdBalance.cashInfos) && usdBalance.cashInfos.length > 0) {
            const usdCashInfo = usdBalance.cashInfos.find((ci: any) => ci.currency === 'USD');
            if (usdCashInfo && usdCashInfo.availableCash) {
              totalCapital = parseFloat(usdCashInfo.availableCash.toString());
              foundUsd = true;
            }
          }
          // 如果没有 cashInfos，使用 buyPower 或 netAssets
          if (!foundUsd) {
            if (usdBalance.buyPower) {
              totalCapital = parseFloat(usdBalance.buyPower.toString());
              foundUsd = true;
            } else if (usdBalance.netAssets) {
              totalCapital = parseFloat(usdBalance.netAssets.toString());
              foundUsd = true;
            } else if (usdBalance.totalCash) {
              totalCapital = parseFloat(usdBalance.totalCash.toString());
              foundUsd = true;
            }
          }
        }
      } catch (usdError: any) {
        // 如果按币种查询失败，继续使用通用查询方式
        logger.debug('按USD币种查询失败，使用通用查询:', usdError.message);
      }
      
      // 如果直接查询USD失败，使用通用查询方式
      if (!foundUsd) {
        const balances = await tradeCtx.accountBalance();
        
        // 优先查找 USD 余额：遍历所有账户的 cashInfos 数组
        for (const balance of balances) {
          if (balance.cashInfos && Array.isArray(balance.cashInfos)) {
            const usdCashInfo = balance.cashInfos.find((ci: any) => ci.currency === 'USD');
            if (usdCashInfo && usdCashInfo.availableCash) {
              totalCapital = parseFloat(usdCashInfo.availableCash.toString());
              foundUsd = true;
              break;
            }
          }
        }

        // 如果 cashInfos 中没有 USD，查找顶层 currency 为 USD 的账户
        if (!foundUsd) {
          const usdBalance = balances.find((bal: any) => bal.currency === 'USD');
          if (usdBalance) {
            // 优先使用 buyPower（购买力）作为可用金额
            if (usdBalance.buyPower) {
              totalCapital = parseFloat(usdBalance.buyPower.toString());
              foundUsd = true;
            } else if (usdBalance.netAssets) {
              // 使用 netAssets（净资产）
              totalCapital = parseFloat(usdBalance.netAssets.toString());
              foundUsd = true;
            } else if (usdBalance.totalCash) {
              // 最后使用 totalCash
              totalCapital = parseFloat(usdBalance.totalCash.toString());
              foundUsd = true;
            }
          }
        }
        
        // 调试日志：如果仍未找到USD，输出所有账户信息
        if (!foundUsd) {
          logger.debug('账户余额详情:', JSON.stringify(balances.map((bal: any) => ({
            currency: bal.currency,
            cashInfos: bal.cashInfos?.map((ci: any) => ({
              currency: ci.currency,
              availableCash: ci.availableCash?.toString(),
            })),
            buyPower: bal.buyPower?.toString(),
            netAssets: bal.netAssets?.toString(),
            totalCash: bal.totalCash?.toString(),
          })), null, 2));
        }
      }

      // 如果没有找到 USD，使用第一个币种的可用现金（但记录警告）
      const allBalances = await tradeCtx.accountBalance();
      if (!foundUsd && allBalances && allBalances.length > 0) {
        const firstBalance = allBalances[0];
        // 优先使用 cashInfos 中的 availableCash
        if (firstBalance.cashInfos && Array.isArray(firstBalance.cashInfos) && firstBalance.cashInfos.length > 0) {
          const firstCashInfo = firstBalance.cashInfos[0];
          if (firstCashInfo.availableCash) {
            totalCapital = parseFloat(firstCashInfo.availableCash.toString());
          } else {
            totalCapital = parseFloat(firstBalance.netAssets?.toString() || firstBalance.totalCash?.toString() || '0');
          }
        } else {
          // 如果没有 cashInfos，使用 buyPower 或 netAssets
          if (firstBalance.buyPower) {
            totalCapital = parseFloat(firstBalance.buyPower.toString());
          } else {
            totalCapital = parseFloat(firstBalance.netAssets?.toString() || firstBalance.totalCash?.toString() || '0');
          }
        }
        logger.warn(`未找到 USD 余额，使用 ${firstBalance.currency} 余额: ${totalCapital.toFixed(2)}`);
      }

      // 2. 查询数据库中所有策略的资金分配和使用情况
      const strategiesQuery = await pool.query(`
        SELECT 
          s.id as strategy_id,
          s.name as strategy_name,
          ca.id as allocation_id,
          ca.allocation_type,
          ca.allocation_value,
          ca.current_usage,
          ca.name as allocation_name
        FROM strategies s
        LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
        WHERE s.status = 'RUNNING'
      `);

      // 3. 获取实际持仓（从 SDK）
      const positions = await tradeCtx.stockPositions();
      const positionMap = new Map<string, number>();
      
      // 处理不同的数据结构：可能是 positions.positions 或 positions.channels[].positions
      let positionsArray: any[] = [];
      
      if (positions) {
        // 尝试直接访问 positions.positions
        if (positions.positions && Array.isArray(positions.positions)) {
          positionsArray = positions.positions;
        }
        // 尝试访问 positions.channels[].positions
        else if (positions.channels && Array.isArray(positions.channels)) {
          for (const channel of positions.channels) {
            if (channel.positions && Array.isArray(channel.positions)) {
              positionsArray.push(...channel.positions);
            }
          }
        }
      }
      
      if (positionsArray.length > 0) {
        logger.debug(`[账户余额同步] 获取到 ${positionsArray.length} 个实际持仓`);
        
        // 检测卖空持仓
        const shortPositions: Array<{ symbol: string; quantity: number }> = [];
        
        for (const pos of positionsArray) {
          const symbol = pos.symbol;
          const quantity = parseInt(pos.quantity?.toString() || '0');
          
          // 检测卖空持仓（数量为负数）
          if (quantity < 0) {
            shortPositions.push({ symbol, quantity });
            logger.warn(`[账户余额同步] 检测到卖空持仓: ${symbol}, 持仓数量=${quantity}`);
          }
          
          // 尝试多种价格字段：currentPrice, costPrice, avgPrice
          const price = parseFloat(
            pos.currentPrice?.toString() || 
            pos.costPrice?.toString() || 
            pos.avgPrice?.toString() || 
            '0'
          );
          // 期权持仓需要乘以合约乘数（通常100），因为broker返回的是每股价格
          const multiplier = isLikelyOptionSymbol(symbol) ? 100 : 1;
          const positionValue = quantity * price * multiplier;

          if (positionValue > 0) {
            // 存储原始格式
            positionMap.set(symbol, positionValue);
            
            // 同时存储标准化格式（如果不同）
            const normalizedSymbol = this.normalizeSymbol(symbol);
            if (normalizedSymbol !== symbol) {
              positionMap.set(normalizedSymbol, positionValue);
              logger.debug(`[账户余额同步] Symbol格式转换: ${symbol} -> ${normalizedSymbol}, 价值=${positionValue.toFixed(2)}`);
            }
          }
        }
        
        // 自动平仓卖空持仓
        if (shortPositions.length > 0) {
          logger.warn(`[账户余额同步] 检测到 ${shortPositions.length} 个卖空持仓，开始自动平仓`);
          // 记录监控指标
          orderPreventionMetrics.recordShortPositionDetected(shortPositions.length);
          
          for (const shortPos of shortPositions) {
            const closeResult = await this.closeShortPosition(shortPos.symbol, shortPos.quantity);
            // 记录监控指标
            orderPreventionMetrics.recordShortPositionClose(closeResult.success);
            
            if (closeResult.success) {
              logger.log(`[账户余额同步] 卖空持仓平仓成功: ${shortPos.symbol}, 订单ID=${closeResult.orderId}`);
            } else {
              logger.error(`[账户余额同步] 卖空持仓平仓失败: ${shortPos.symbol}, 错误=${closeResult.error}`);
            }
          }
        }
        
        logger.debug(`[账户余额同步] positionMap构建完成，共 ${positionMap.size} 个条目`);
        if (positionMap.size > 0) {
          logger.debug(`[账户余额同步] positionMap keys: ${Array.from(positionMap.keys()).slice(0, 20).join(', ')}${positionMap.size > 20 ? '...' : ''}`);
        }
      } else {
        logger.debug('[账户余额同步] 实际持仓数据为空或格式异常');
        logger.debug(`[账户余额同步] positions数据结构: ${JSON.stringify(positions, null, 2)}`);
      }

      // 4. 对比数据库记录与实际持仓
      const discrepancies: BalanceDiscrepancy[] = [];
      
      for (const strategy of strategiesQuery.rows) {
        if (!strategy.allocation_id) continue;

        // 计算策略应该分配的资金
        let expectedAllocation = 0;
        if (strategy.allocation_type === 'PERCENTAGE') {
          expectedAllocation = totalCapital * parseFloat(strategy.allocation_value.toString());
        } else {
          expectedAllocation = parseFloat(strategy.allocation_value.toString());
        }

        // 计算策略实际使用的资金（从持仓）
        let actualUsage = 0;
        // 查询所有非IDLE状态的标的（HOLDING, OPENING, CLOSING）
        const strategyInstances = await pool.query(`
          SELECT symbol, current_state, context FROM strategy_instances 
          WHERE strategy_id = $1 AND current_state IN ('HOLDING', 'OPENING', 'CLOSING')
        `, [strategy.strategy_id]);
        
        // 查询未成交订单（用于判断OPENING/CLOSING状态是否合理）
        const pendingOrders = await pool.query(`
          SELECT DISTINCT symbol FROM execution_orders
          WHERE strategy_id = $1 
          AND current_status NOT IN ('FILLED', 'CANCELLED', 'REJECTED')
          AND created_at >= NOW() - INTERVAL '7 days'
        `, [strategy.strategy_id]);
        
        const pendingOrderSymbols = new Set(pendingOrders.rows.map((r: any) => r.symbol));

        logger.debug(
          `[账户余额同步] 策略 ${strategy.strategy_name} (ID: ${strategy.strategy_id}) ` +
          `资金使用计算开始:`
        );
        logger.debug(`  - 非IDLE状态标的数量: ${strategyInstances.rows.length}`);
        logger.debug(`  - positionMap大小: ${positionMap.size}`);
        logger.debug(`  - 未成交订单标的数量: ${pendingOrderSymbols.size}`);

        if (strategyInstances.rows.length > 0) {
          const byState = strategyInstances.rows.reduce((acc: any, r: any) => {
            acc[r.current_state] = (acc[r.current_state] || []).concat(r.symbol);
            return acc;
          }, {});
          logger.debug(`  - 状态分布: ${Object.entries(byState).map(([state, symbols]: [string, any]) => `${state}=${symbols.length}(${symbols.join(',')})`).join(', ')}`);
        }

        // 记录需要修复的标的（状态非IDLE但实际持仓不存在且无未成交订单）
        const symbolsToFix: Array<{ symbol: string; state: string; context: any; targetState?: string }> = [];

        for (const instance of strategyInstances.rows) {
          const originalSymbol = instance.symbol;
          const currentState = instance.current_state;
          const normalizedSymbol = this.normalizeSymbol(originalSymbol);
          
          // 解析context（提前，供后续匹配使用）
          let context: any = {};
          if (instance.context) {
            try {
              context = typeof instance.context === 'string'
                ? JSON.parse(instance.context)
                : instance.context;
            } catch (e) {
              logger.warn(`[账户余额同步] 解析策略实例上下文失败 (${originalSymbol}):`, e);
            }
          }

          // 尝试多种格式匹配
          let positionValue = positionMap.get(originalSymbol) || 0;
          if (positionValue === 0 && normalizedSymbol !== originalSymbol) {
            positionValue = positionMap.get(normalizedSymbol) || 0;
          }
          // 期权匹配：underlying symbol (如SPY.US) 对应期权持仓 (如SPY260210C694000.US)
          if (positionValue === 0 && !isLikelyOptionSymbol(originalSymbol)) {
            const prefixes = getOptionPrefixesForUnderlying(originalSymbol).map(p => p.toUpperCase());
            for (const [posKey, posVal] of positionMap) {
              const posKeyUpper = posKey.toUpperCase();
              if (isLikelyOptionSymbol(posKeyUpper) && prefixes.some(p => posKeyUpper.startsWith(p))) {
                positionValue = posVal;
                break;
              }
            }
          }
          // 反向匹配：context.tradedSymbol 可能是期权symbol，也检查它
          if (positionValue === 0 && context?.tradedSymbol) {
            positionValue = positionMap.get(context.tradedSymbol) || 0;
          }

          // 检查是否有未成交订单
          const hasPendingOrder = pendingOrderSymbols.has(originalSymbol);
          
          // 判断是否需要修复
          // 1. HOLDING状态但实际持仓不存在 -> 需要修复
          // 2. OPENING/CLOSING状态但实际持仓不存在且无未成交订单 -> 需要修复
          // 3. OPENING状态但实际持仓已存在 -> 需要修复（转为HOLDING）
          const needsFixToIdle = positionValue === 0 && (
            currentState === 'HOLDING' || 
            (currentState === 'OPENING' && !hasPendingOrder) ||
            (currentState === 'CLOSING' && !hasPendingOrder)
          );
          
          const needsFixToHolding = positionValue > 0 && currentState === 'OPENING';
          
          if (needsFixToIdle) {
            logger.warn(
              `[账户余额同步] 策略 ${strategy.strategy_name} 标的 ${originalSymbol} ` +
              `状态为${currentState}但实际持仓中未找到匹配（尝试了 ${originalSymbol} 和 ${normalizedSymbol}），` +
              `未成交订单: ${hasPendingOrder ? '有' : '无'}`
            );
            
            symbolsToFix.push({ symbol: originalSymbol, state: currentState, context, targetState: 'IDLE' });
          } else if (needsFixToHolding) {
            // OPENING状态但实际持仓已存在，应该转为HOLDING
            logger.warn(
              `[账户余额同步] 策略 ${strategy.strategy_name} 标的 ${originalSymbol} ` +
              `状态为OPENING但实际持仓已存在（持仓价值=${positionValue.toFixed(2)}），需要转为HOLDING`
            );
            symbolsToFix.push({ symbol: originalSymbol, state: currentState, context, targetState: 'HOLDING' });
          } else if (positionValue > 0) {
            logger.debug(
              `[账户余额同步] 策略 ${strategy.strategy_name} 标的 ${originalSymbol}: ` +
              `匹配成功，持仓价值=${positionValue.toFixed(2)}`
            );
          } else if (hasPendingOrder) {
            logger.debug(
              `[账户余额同步] 策略 ${strategy.strategy_name} 标的 ${originalSymbol}: ` +
              `状态为${currentState}，无实际持仓但有未成交订单，跳过修复`
            );
          }
          
          // 计算实际使用值：
          // 1. HOLDING状态且有实际持仓 -> 使用实际持仓价值
          // 2. OPENING/CLOSING状态且有未成交订单 -> 使用context中的allocationAmount（如果有）
          if (currentState === 'HOLDING') {
            actualUsage += positionValue;
          } else if ((currentState === 'OPENING' || currentState === 'CLOSING') && hasPendingOrder) {
            // OPENING/CLOSING状态且有未成交订单，使用申请的资金
            if (context && context.allocationAmount) {
              const allocationAmount = parseFloat(context.allocationAmount.toString() || '0');
              if (allocationAmount > 0) {
                actualUsage += allocationAmount;
                logger.debug(
                  `[账户余额同步] 策略 ${strategy.strategy_name} 标的 ${originalSymbol}: ` +
                  `状态为${currentState}，计入申请资金 ${allocationAmount.toFixed(2)}`
                );
              }
            }
          }
        }

        // 自动修复状态不一致的标的
        if (symbolsToFix.length > 0) {
          logger.warn(
            `[账户余额同步] 策略 ${strategy.strategy_name} (ID: ${strategy.strategy_id}) ` +
            `发现 ${symbolsToFix.length} 个状态不一致的标的，开始自动修复...`
          );
          
          let fixedCount = 0;
          let releasedAmount = 0;
          
          for (const { symbol, state, context, targetState } of symbolsToFix) {
            try {
              const finalTargetState = targetState || 'IDLE';
              
              // 1. 更新状态
              await stateManager.updateState(strategy.strategy_id, symbol, finalTargetState);
              
              if (finalTargetState === 'HOLDING') {
                // 转为HOLDING：更新context，保存持仓信息
                // 获取实际持仓信息
                const actualPosition = positionsArray.find((pos: any) => {
                  const posSymbol = pos.symbol || pos.stock_name;
                  return posSymbol === symbol || posSymbol === this.normalizeSymbol(symbol);
                });
                
                const updatedContext = {
                  ...context,
                  entryPrice: actualPosition?.costPrice || actualPosition?.avgPrice || context.entryPrice || context.intent?.entryPrice,
                  quantity: actualPosition?.quantity || context.quantity || context.intent?.quantity,
                  syncedFromPosition: true,
                  syncedAt: new Date().toISOString(),
                };
                await stateManager.updateState(strategy.strategy_id, symbol, 'HOLDING', updatedContext);
                
                logger.log(
                  `[账户余额同步] 策略 ${strategy.strategy_name} 标的 ${symbol}: ` +
                  `状态已从${state}更新为HOLDING（实际持仓已存在，数量=${updatedContext.quantity || 'N/A'}）`
                );
              } else {
                // 转为IDLE：释放资金
                logger.log(
                  `[账户余额同步] 策略 ${strategy.strategy_name} 标的 ${symbol}: ` +
                  `状态已从${state}更新为IDLE（实际持仓不存在且无未成交订单）`
                );
              }
              
              fixedCount++;
              
              // 2. 如果转为IDLE，释放资金（如果有allocationAmount记录）
              if (finalTargetState === 'IDLE' && context && context.allocationAmount) {
                const allocationAmount = parseFloat(context.allocationAmount.toString() || '0');
                if (allocationAmount > 0) {
                  try {
                    await capitalManager.releaseAllocation(
                      strategy.strategy_id,
                      allocationAmount,
                      symbol
                    );
                    releasedAmount += allocationAmount;
                    logger.log(
                      `[账户余额同步] 策略 ${strategy.strategy_name} 标的 ${symbol}: ` +
                      `已释放资金 ${allocationAmount.toFixed(2)}`
                    );
                  } catch (releaseError: any) {
                    logger.error(
                      `[账户余额同步] 策略 ${strategy.strategy_name} 标的 ${symbol}: ` +
                      `释放资金失败: ${releaseError.message}`
                    );
                  }
                }
              } else {
                logger.warn(
                  `[账户余额同步] 策略 ${strategy.strategy_name} 标的 ${symbol}: ` +
                  `上下文缺少allocationAmount，无法自动释放资金。` +
                  `Context keys: ${context ? Object.keys(context).join(', ') : 'null'}`
                );
              }
            } catch (fixError: any) {
              logger.error(
                `[账户余额同步] 策略 ${strategy.strategy_name} 标的 ${symbol}: ` +
                `自动修复失败: ${fixError.message}`
              );
            }
          }
          
          if (fixedCount > 0) {
            logger.log(
              `[账户余额同步] 策略 ${strategy.strategy_name} (ID: ${strategy.strategy_id}) ` +
              `自动修复完成: 修复${fixedCount}个标的，释放资金${releasedAmount.toFixed(2)}`
            );
          }
        }

        logger.debug(
          `[账户余额同步] 策略 ${strategy.strategy_name} (ID: ${strategy.strategy_id}) ` +
          `实际使用值: ${actualUsage.toFixed(2)}`
        );

        // 对比数据库记录的使用量
        const recordedUsage = parseFloat(strategy.current_usage?.toString() || '0');
        const difference = Math.abs(actualUsage - recordedUsage);

        // 设置多级告警阈值
        // 警告阈值：差异超过 5%（或 $50）
        const warningThreshold = Math.max(expectedAllocation * 0.05, 50);
        // 错误阈值：差异超过 10%（或 $100）
        const errorThreshold = Math.max(expectedAllocation * 0.10, 100);
        // 基础阈值：差异超过 1%（或 $10），用于记录差异
        const baseThreshold = Math.max(expectedAllocation * 0.01, 10);

        logger.debug(
          `[账户余额同步] 策略 ${strategy.strategy_name} (ID: ${strategy.strategy_id}) ` +
          `资金使用对比:`
        );
        logger.debug(`  - 记录值: ${recordedUsage.toFixed(2)}`);
        logger.debug(`  - 实际值: ${actualUsage.toFixed(2)}`);
        logger.debug(`  - 差异: ${difference.toFixed(2)}`);
        logger.debug(`  - 警告阈值: ${warningThreshold.toFixed(2)}`);
        logger.debug(`  - 错误阈值: ${errorThreshold.toFixed(2)}`);

        if (difference > baseThreshold) {
          const differencePercent = expectedAllocation > 0 
            ? parseFloat(((difference / expectedAllocation) * 100).toFixed(2))
            : 0;
          
          // 确定严重程度
          let severity: 'ERROR' | 'WARNING' | 'INFO' = 'INFO';
          if (difference > errorThreshold) {
            severity = 'ERROR';
          } else if (difference > warningThreshold) {
            severity = 'WARNING';
          }
          
          discrepancies.push({
            strategyId: strategy.strategy_id,
            expected: recordedUsage,
            actual: actualUsage,
            difference,
            severity,
            differencePercent,
          });

          // 根据差异级别记录不同级别的日志
          if (difference > errorThreshold) {
            // 严重差异：记录错误日志并告警
            const differencePercent = expectedAllocation > 0 
              ? ((difference / expectedAllocation) * 100).toFixed(2) 
              : 'N/A';
            
            logger.error(
              `[资金差异告警] 🔴 严重差异 - 策略 ${strategy.strategy_name} (ID: ${strategy.strategy_id}) ` +
              `记录值 ${recordedUsage.toFixed(2)}, 实际值 ${actualUsage.toFixed(2)}, ` +
              `差异 ${difference.toFixed(2)} (${differencePercent}%)`
            );
            
            // TODO: 发送告警通知（邮件/短信/钉钉等）
            // await sendAlert('资金差异告警', { 
            //   strategyId: strategy.strategy_id,
            //   strategyName: strategy.strategy_name,
            //   recordedUsage,
            //   actualUsage,
            //   difference,
            //   differencePercent 
            // });
          } else if (difference > warningThreshold) {
            // 警告差异：记录警告日志
            const differencePercent = expectedAllocation > 0 
              ? ((difference / expectedAllocation) * 100).toFixed(2) 
              : 'N/A';
            
            logger.warn(
              `[资金差异警告] 🟠 资金差异 - 策略 ${strategy.strategy_name} (ID: ${strategy.strategy_id}) ` +
              `记录值 ${recordedUsage.toFixed(2)}, 实际值 ${actualUsage.toFixed(2)}, ` +
              `差异 ${difference.toFixed(2)} (${differencePercent}%)`
            );
          } else {
            // 基础差异：记录调试日志
            logger.debug(
              `策略 ${strategy.strategy_name} (ID: ${strategy.strategy_id}) 资金使用差异: ` +
              `记录值 ${recordedUsage.toFixed(2)}, 实际值 ${actualUsage.toFixed(2)}, ` +
              `差异 ${difference.toFixed(2)}`
            );
          }
          
          // 输出详细的诊断信息
          const holdingSymbols = strategyInstances.rows
            .filter((r: any) => r.current_state === 'HOLDING')
            .map((r: any) => r.symbol);
          logger.warn(
            `[诊断信息] ` +
            `HOLDING状态标的: ${holdingSymbols.join(', ') || '无'}, ` +
            `positionMap keys: ${Array.from(positionMap.keys()).slice(0, 10).join(', ') || '无'}`
          );
          
          // 自动修复：如果差异超过错误阈值，且实际值更可靠，则更新current_usage
          // 允许 actualUsage=0 的修复：当无 HOLDING 标的时，说明持仓已全部平仓，应释放资金
          const hasHoldingPositions = holdingSymbols.length > 0;
          if (difference > errorThreshold && (actualUsage > 0 || (!hasHoldingPositions && recordedUsage > 0))) {
            try {
              // 更新current_usage为实际使用值
              const updateResult = await pool.query(
                `UPDATE capital_allocations 
                 SET current_usage = $1, updated_at = NOW()
                 WHERE id = $2
                 RETURNING current_usage`,
                [actualUsage, strategy.allocation_id]
              );
              
              if (updateResult.rows.length > 0) {
                const updatedUsage = parseFloat(updateResult.rows[0].current_usage?.toString() || '0');
                logger.log(
                  `[账户余额同步] ✅ 自动修复完成 - 策略 ${strategy.strategy_name} (ID: ${strategy.strategy_id}) ` +
                  `已将current_usage从 ${recordedUsage.toFixed(2)} 更新为 ${updatedUsage.toFixed(2)} (实际值: ${actualUsage.toFixed(2)})`
                );
              }
            } catch (fixError: any) {
              logger.error(
                `[账户余额同步] ❌ 自动修复失败 - 策略 ${strategy.strategy_name} (ID: ${strategy.strategy_id}) ` +
                `更新current_usage失败: ${fixError.message}`
              );
            }
          }
        }
      }

      // 5. 更新根账户的总资金（可选，仅记录日志）
      logger.log(`账户余额同步完成: 总资金 ${totalCapital.toFixed(2)} USD`, { dbWrite: false });

      // 收集策略信息
      const strategies = strategiesQuery.rows.map((row: any) => ({
        id: row.strategy_id,
        name: row.strategy_name,
        expectedAllocation: parseFloat(row.allocation_type === 'PERCENTAGE' 
          ? (totalCapital * parseFloat(row.allocation_value.toString())).toFixed(2)
          : row.allocation_value.toString()),
      }));

      return {
        success: true,
        totalCapital,
        discrepancies: discrepancies.length > 0 ? discrepancies : undefined,
        lastSyncTime: new Date(),
        strategies,
      };
    } catch (error: any) {
      logger.error('账户余额同步失败:', error);
      return {
        success: false,
        totalCapital: 0,
        error: error.message || '未知错误',
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * 启动定时同步任务
   * @param intervalMinutes 同步间隔（分钟），默认 5 分钟
   */
  startPeriodicSync(intervalMinutes: number = 5): void {
    if (this.syncInterval) {
      logger.warn('账户余额同步任务已在运行');
      return;
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    
    // 立即执行一次同步
    this.syncAccountBalance().catch((err) => {
      logger.error('初始账户余额同步失败:', err);
    });

    // 设置定时任务
    this.syncInterval = setInterval(() => {
      this.syncAccountBalance().catch((err) => {
        logger.error('定时账户余额同步失败:', err);
      });
    }, intervalMs);

    logger.log(`账户余额定时同步已启动，间隔: ${intervalMinutes} 分钟`, { dbWrite: false });
  }

  /**
   * 停止定时同步任务
   */
  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      logger.log('账户余额定时同步已停止', { dbWrite: false });
    }
  }

  /**
   * 检测卖空持仓
   * @returns 卖空持仓列表
   */
  async detectShortPositions(): Promise<Array<{ symbol: string; quantity: number }>> {
    try {
      const tradeCtx = await getTradeContext();
      const positions = await tradeCtx.stockPositions();
      
      // 处理不同的数据结构
      let positionsArray: any[] = [];
      if (positions) {
        if (positions.positions && Array.isArray(positions.positions)) {
          positionsArray = positions.positions;
        } else if (positions.channels && Array.isArray(positions.channels)) {
          for (const channel of positions.channels) {
            if (channel.positions && Array.isArray(channel.positions)) {
              positionsArray.push(...channel.positions);
            }
          }
        }
      }
      
      // 筛选卖空持仓（数量为负数）
      const shortPositions = positionsArray
        .filter((p: any) => {
          const quantity = parseInt(p.quantity?.toString() || '0');
          return quantity < 0;
        })
        .map((p: any) => ({
          symbol: p.symbol,
          quantity: parseInt(p.quantity?.toString() || '0')
        }));
      
      if (shortPositions.length > 0) {
        logger.warn(`[卖空检测] 检测到 ${shortPositions.length} 个卖空持仓: ${shortPositions.map(p => `${p.symbol}(${p.quantity})`).join(', ')}`);
      }
      
      return shortPositions;
    } catch (error: any) {
      logger.error(`检测卖空持仓失败:`, error);
      return [];
    }
  }

  /**
   * 自动平仓卖空持仓
   * @param symbol 标的代码
   * @param quantity 卖空数量（负数）
   * @returns 平仓结果
   */
  async closeShortPosition(
    symbol: string,
    quantity: number
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    try {
      // 计算需要买入的数量（取绝对值）
      const buyQuantity = Math.abs(quantity);
      
      logger.warn(`[卖空平仓] 开始平仓卖空持仓: ${symbol}, 卖空数量=${quantity}, 需要买入=${buyQuantity}`);
      
      // 获取当前市场价格
      const { getQuoteContext } = await import('../config/longport');
      const quoteCtx = await getQuoteContext();
      const quotes = await quoteCtx.quote([symbol]);
      
      if (!quotes || quotes.length === 0) {
        return {
          success: false,
          error: `无法获取 ${symbol} 的市场价格`
        };
      }
      
      const quote = quotes[0];
      const currentPrice = parseFloat(quote.lastDone?.toString() || quote.last_done?.toString() || '0');
      
      if (currentPrice <= 0) {
        return {
          success: false,
          error: `无法获取 ${symbol} 的有效市场价格`
        };
      }
      
      // 创建买入平仓订单意图
      const buyIntent = {
        action: 'BUY' as const,
        symbol,
        entryPrice: currentPrice,
        quantity: buyQuantity,
        reason: `自动平仓卖空持仓: 卖空数量=${quantity}`
      };
      
      // 执行买入平仓（使用策略ID -1 表示系统自动平仓，避免与正常策略冲突）
      // 注意：这里需要传递一个有效的策略ID，但平仓订单不关联具体策略
      // 暂时使用 0，后续可以考虑创建专门的系统策略
      const executionResult = await basicExecutionService.executeBuyIntent(buyIntent, -1);
      
      if (executionResult.success && executionResult.orderId) {
        logger.log(`[卖空平仓] 平仓订单提交成功: ${symbol}, 订单ID=${executionResult.orderId}, 买入数量=${buyQuantity}`);
        return {
          success: true,
          orderId: executionResult.orderId
        };
      } else {
        logger.error(`[卖空平仓] 平仓订单提交失败: ${symbol}, 错误=${executionResult.error}`);
        return {
          success: false,
          error: executionResult.error || '平仓订单提交失败'
        };
      }
    } catch (error: any) {
      logger.error(`平仓卖空持仓失败 (${symbol}):`, error);
      return {
        success: false,
        error: error.message || '未知错误'
      };
    }
  }
}

// 导出单例
export default new AccountBalanceSyncService();

