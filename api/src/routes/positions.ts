import { Router, Request, Response, NextFunction } from 'express';
import pool from '../config/database';
import { getTradeContext, getQuoteContext } from '../config/longport';
import { getFutunnOptionQuotes } from '../services/futunn-option-quote.service';
import { ErrorFactory, normalizeError } from '../utils/errors';

export const positionsRouter = Router();

/**
 * 判断是否为期权代码
 * 期权代码格式：TSLA251128P395000.US
 * 特征：包含日期（6位数字）+ P/C（Put/Call）+ 行权价
 */
function isOptionSymbol(symbol: string): boolean {
  const optionPattern = /^\w+\d{6}[PC]\d+\.US$/;
  return optionPattern.test(symbol);
}

/**
 * GET /api/positions
 * 获取持仓列表
 * 优先从LongPort API获取真实持仓，如果没有则从数据库获取
 */
positionsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 优先从LongPort API获取真实持仓
    try {
      const tradeCtx = await getTradeContext();
      const stockPositions = await tradeCtx.stockPositions(); // 不传参数获取所有持仓
      
      // 根据实际返回的数据结构：{ channels: [{ accountChannel: string, positions: [...] }] }
      const allPositions: any[] = [];
      
      // 打印返回的数据结构以便调试
      console.log('stockPositions返回数据结构:', JSON.stringify(stockPositions, null, 2));
      
      if (stockPositions && typeof stockPositions === 'object') {
        // 处理返回的数据结构
        // 实际结构：{ channels: [{ accountChannel: string, positions: [...] }] }
        if (stockPositions.channels && Array.isArray(stockPositions.channels)) {
          // 遍历所有通道
          for (const channel of stockPositions.channels) {
            // 优先查找positions字段（实际返回的数据结构）
            if (channel.positions && Array.isArray(channel.positions)) {
              allPositions.push(...channel.positions);
            }
            // 也支持stockInfo字段（向后兼容）
            else if (channel.stockInfo && Array.isArray(channel.stockInfo)) {
              allPositions.push(...channel.stockInfo);
            }
          }
        } else if (Array.isArray(stockPositions)) {
          // 如果直接是数组
          allPositions.push(...stockPositions);
        } else if (stockPositions.stockInfo && Array.isArray(stockPositions.stockInfo)) {
          // 如果顶层有stockInfo
          allPositions.push(...stockPositions.stockInfo);
        }
      }
      
      console.log('提取到的持仓数量:', allPositions.length);
      
      // 将LongPort持仓数据转换为标准格式
      // 注意：实际返回的数据可能没有lastPrice、marketValue等字段，需要后续通过行情API获取
      const positions = allPositions.map((pos: any) => {
        const quantity = parseFloat(pos.quantity?.toString() || '0');
        const costPrice = parseFloat(pos.costPrice?.toString() || pos.cost_price?.toString() || '0');
        const availableQuantity = parseFloat(pos.availableQuantity?.toString() || pos.available_quantity?.toString() || '0');
        
        // 如果没有当前价格，使用成本价作为占位符（后续会通过行情API更新）
        const currentPrice = parseFloat(pos.lastPrice?.toString() || pos.last_price?.toString() || costPrice);
        const marketValue = parseFloat(pos.marketValue?.toString() || pos.market_value?.toString() || (quantity * currentPrice));
        const unrealizedPl = parseFloat(pos.unrealizedPl?.toString() || pos.unrealized_pl?.toString() || '0');
        const unrealizedPlRatio = parseFloat(pos.unrealizedPlRatio?.toString() || pos.unrealized_pl_ratio?.toString() || '0');
        
        // 处理股票代码格式：港股代码可能不带前导零，需要标准化
        let symbol = pos.symbol;
        if (symbol && symbol.endsWith('.HK')) {
          // 确保港股代码格式一致（可能需要添加前导零）
          // 这里保持原样，因为LongPort返回的格式是标准格式
        }
        
        return {
          symbol: symbol,
          symbol_name: pos.symbolName || pos.symbol_name || '',
          quantity: quantity,
          available_quantity: availableQuantity,
          cost_price: costPrice,
          current_price: currentPrice,
          market_value: marketValue,
          unrealized_pl: unrealizedPl,
          unrealized_pl_ratio: unrealizedPlRatio,
          currency: pos.currency || 'USD',
          position_side: pos.positionSide || pos.position_side || 'Long',
        };
      }).filter((p: any) => p.quantity !== 0); // 返回所有非零持仓（包括负数/空头）
      
      console.log('转换后的持仓数量:', positions.length);
      
      // 分离期权和普通股票
      const stockSymbols: string[] = [];
      const optionSymbols: string[] = [];
      
      positions.forEach(pos => {
        if (isOptionSymbol(pos.symbol)) {
          optionSymbols.push(pos.symbol);
        } else {
          stockSymbols.push(pos.symbol);
        }
      });
      
      // 获取行情数据（分别获取普通股票和期权）
      const quoteCtx = await getQuoteContext();
      const quotesMap = new Map<string, any>();
      
      // 获取普通股票行情
      if (stockSymbols.length > 0) {
        try {
          const stockQuotes = await quoteCtx.quote(stockSymbols);
          stockQuotes.forEach(q => {
            quotesMap.set(q.symbol, {
              last_done: q.lastDone,
              prev_close: q.prevClose,
              open: q.open,
              high: q.high,
              low: q.low,
              volume: q.volume,
              turnover: q.turnover,
              timestamp: q.timestamp,
              trade_status: q.tradeStatus,
            });
          });
        } catch (error: any) {
          console.error('获取普通股票行情失败:', error);
        }
      }
      
      // 获取期权行情
      if (optionSymbols.length > 0) {
        console.log(`[期权行情] 准备获取 ${optionSymbols.length} 个期权行情:`, optionSymbols);
        let longportSuccess = false;
        let missingOptions: string[] = [];
        
        // 检查是否启用长桥期权查询（默认关闭，使用富途API）
        const configService = (await import('../services/config.service')).default;
        let enableLongportOptionQuote = false;
        try {
          const configValue = await configService.getConfig('longport_enable_option_quote');
          enableLongportOptionQuote = configValue === 'true';
        } catch (error: any) {
          // 如果读取配置失败，使用默认值 false
          console.warn('[期权行情] 无法读取配置 longport_enable_option_quote，使用默认值 false（使用富途API）');
        }
        
        if (!enableLongportOptionQuote) {
          console.log('[期权行情] 长桥期权查询已禁用（配置: longport_enable_option_quote=false），直接使用富途牛牛API');
          missingOptions = optionSymbols; // 所有期权都从富途牛牛获取
        } else {
          // 首先尝试使用长桥API获取期权行情
          try {
            const optionQuotes = await quoteCtx.optionQuote(optionSymbols);
            console.log(`[期权行情] 长桥API成功获取 ${optionQuotes.length} 个期权行情`);
            longportSuccess = true;
            
            optionQuotes.forEach(q => {
              quotesMap.set(q.symbol, {
                last_done: q.lastDone,
                prev_close: q.prevClose,
                open: q.open,
                high: q.high,
                low: q.low,
                volume: q.volume,
                turnover: q.turnover,
                timestamp: q.timestamp,
                trade_status: q.tradeStatus,
                option_extend: q.optionExtend ? {
                  implied_volatility: q.optionExtend.impliedVolatility,
                  open_interest: q.optionExtend.openInterest,
                  expiry_date: q.optionExtend.expiryDate,
                  strike_price: q.optionExtend.strikePrice,
                  contract_multiplier: q.optionExtend.contractMultiplier,
                  contract_type: q.optionExtend.contractType,
                  contract_size: q.optionExtend.contractSize,
                  direction: q.optionExtend.direction,
                  historical_volatility: q.optionExtend.historicalVolatility,
                  underlying_symbol: q.optionExtend.underlyingSymbol,
                } : undefined,
              });
              
              // 调试日志：每个期权的行情数据
              console.log(`[期权行情] ${q.symbol}:`, {
                lastDone: q.lastDone,
                contractMultiplier: q.optionExtend?.contractMultiplier || 'N/A',
                hasOptionExtend: !!q.optionExtend,
              });
            });
            
            // 检查是否有期权未获取到行情
            missingOptions = optionSymbols.filter(sym => !quotesMap.has(sym));
            if (missingOptions.length > 0) {
              console.warn(`[期权行情] 以下 ${missingOptions.length} 个期权未从长桥API获取到行情:`, missingOptions);
            }
          } catch (error: any) {
            console.error('获取期权行情失败（长桥API）:', error);
            // 如果是权限错误，尝试使用富途牛牛API作为备用
            const isPermissionError = error.message && (
              error.message.includes('301604') || 
              error.message.includes('no quote access')
            );
            
            if (isPermissionError) {
              console.warn('期权行情权限不足（301604），尝试使用富途牛牛API作为备用方案...');
              missingOptions = optionSymbols; // 所有期权都需要从富途牛牛获取
            } else {
              // 其他错误，记录但不影响其他持仓
              console.error('长桥API获取期权行情失败（非权限错误）:', error.message);
              missingOptions = optionSymbols.filter(sym => !quotesMap.has(sym));
            }
          }
        }
        
        // 如果有未获取到行情的期权，尝试使用富途牛牛API作为备用
        // 使用 Promise.race 确保不会阻塞太久
        if (missingOptions.length > 0) {
          try {
            console.log(`[期权行情] 尝试使用富途牛牛API获取 ${missingOptions.length} 个期权行情...`);
            // 设置超时，避免阻塞整个请求
            const futunnQuotesPromise = getFutunnOptionQuotes(missingOptions);
            const timeoutPromise = new Promise<any[]>((resolve) => {
              setTimeout(() => {
                console.warn(`[期权行情] 富途牛牛API查询超时（5秒），跳过`);
                resolve([]);
              }, 5000);
            });
            const futunnQuotes = await Promise.race([futunnQuotesPromise, timeoutPromise]);
            
            if (futunnQuotes.length > 0) {
              console.log(`✅ [期权行情] 富途牛牛API成功获取 ${futunnQuotes.length} 个期权行情`);
              
              futunnQuotes.forEach(q => {
                // 富途牛牛API返回的数据格式与长桥API兼容，但没有option_extend字段
                // 使用默认合约乘数100
                quotesMap.set(q.symbol, {
                  last_done: q.last_done,
                  prev_close: q.prev_close,
                  open: q.open,
                  high: q.high,
                  low: q.low,
                  volume: q.volume,
                  turnover: q.turnover,
                  timestamp: q.timestamp,
                  trade_status: q.trade_status || 'Normal',
                  option_extend: {
                    // 富途牛牛API没有这些字段，使用默认值
                    contract_multiplier: 100, // 美股期权默认合约乘数为100
                  },
                });
                
                console.log(`[期权行情] 富途牛牛 ${q.symbol}:`, {
                  lastDone: q.last_done,
                  contractMultiplier: 100,
                  source: '富途牛牛API',
                });
              });
              
              // 检查是否还有未获取到行情的期权
              const stillMissing = missingOptions.filter(sym => !quotesMap.has(sym));
              if (stillMissing.length > 0) {
                console.warn(`[期权行情] 以下 ${stillMissing.length} 个期权无法从任何API获取行情:`, stillMissing);
              }
            } else {
              console.warn(`[期权行情] 富途牛牛API未能获取到任何期权行情`);
            }
          } catch (futunnError: any) {
            console.error('富途牛牛API获取期权行情失败:', futunnError.message);
            // 不影响主流程，继续使用已有的数据
          }
        }
      }
      
      // 更新持仓数据（使用行情数据）
      const updatedPositions = positions.map(pos => {
        const quote = quotesMap.get(pos.symbol);
        const isOption = isOptionSymbol(pos.symbol);
        
        if (quote && quote.last_done) {
          const currentPrice = parseFloat(quote.last_done.toString());
          const quantity = pos.quantity;
          const costPrice = pos.cost_price;
          
          // 期权合约乘数（通常是100）
          // 优先使用行情数据中的合约乘数，如果没有则使用默认值100
          const contractMultiplier = isOption 
            ? (quote.option_extend?.contract_multiplier || 100)
            : 1;
          
          // 计算市值
          // 对于期权：市值 = quantity * currentPrice * contractMultiplier
          // 对于普通股票：市值 = quantity * currentPrice
          const marketValue = quantity * currentPrice * contractMultiplier;
          
          // 计算未实现盈亏
          // 对于卖空（quantity < 0）：盈亏 = (costPrice - currentPrice) * abs(quantity) * contractMultiplier
          // 对于做多（quantity > 0）：盈亏 = (currentPrice - costPrice) * quantity * contractMultiplier
          let unrealizedPl: number;
          if (quantity < 0) {
            // 卖空：价格下跌盈利，价格上涨亏损
            unrealizedPl = (costPrice - currentPrice) * Math.abs(quantity) * contractMultiplier;
          } else {
            // 做多：价格上涨盈利，价格下跌亏损
            unrealizedPl = (currentPrice - costPrice) * quantity * contractMultiplier;
          }
          
          // 计算盈亏比例
          // 盈亏比例 = 盈亏 / (abs(quantity) * costPrice * contractMultiplier) * 100
          const unrealizedPlRatio = costPrice > 0 && Math.abs(quantity) > 0
            ? (unrealizedPl / (Math.abs(quantity) * costPrice * contractMultiplier)) * 100
            : 0;
          
          // 调试日志：期权持仓计算
          if (isOption) {
            console.log(`[期权持仓计算] ${pos.symbol}:`, {
              quantity,
              costPrice,
              currentPrice,
              contractMultiplier,
              marketValue: marketValue.toFixed(2),
              unrealizedPl: unrealizedPl.toFixed(2),
              unrealizedPlRatio: unrealizedPlRatio.toFixed(2) + '%',
              hasOptionExtend: !!quote.option_extend,
              contractMultiplierSource: quote.option_extend?.contract_multiplier ? '行情数据' : '默认值100',
            });
          }
          
          return {
            ...pos,
            current_price: currentPrice,
            market_value: marketValue,
            unrealized_pl: unrealizedPl,
            unrealized_pl_ratio: unrealizedPlRatio,
            quote_data: quote, // 保存完整的行情数据
            contract_multiplier: contractMultiplier, // 保存合约乘数，供前端使用
          };
        } else {
          // 如果没有行情数据，但对于期权，尝试从普通股票行情API获取价格
          if (isOption) {
            // 尝试从期权代码提取标的股票代码（例如：TSLA251205P410000.US -> TSLA.US）
            const underlyingMatch = pos.symbol.match(/^([A-Z]+)\d+[CP]\d+\.US$/);
            if (underlyingMatch) {
              const underlyingSymbol = underlyingMatch[1] + '.US';
              const underlyingQuote = quotesMap.get(underlyingSymbol);
              
              if (underlyingQuote && underlyingQuote.last_done) {
                // 使用标的股票价格作为参考（但这不是准确的期权价格）
                const underlyingPrice = parseFloat(underlyingQuote.last_done.toString());
                console.warn(`[期权持仓] ${pos.symbol}: 无法获取期权行情，使用标的股票价格 ${underlyingSymbol} = ${underlyingPrice} 作为参考`);
              }
            }
            
            const quantity = pos.quantity;
            const costPrice = pos.cost_price;
            // 如果无法获取期权行情，且当前价格等于成本价，说明可能没有实时价格
            // 这种情况下，我们仍然需要重新计算，但会使用成本价（导致盈亏为0）
            const currentPrice = pos.current_price || costPrice;
            const contractMultiplier = 100; // 默认合约乘数
            
            const marketValue = quantity * currentPrice * contractMultiplier;
            let unrealizedPl: number;
            if (quantity < 0) {
              unrealizedPl = (costPrice - currentPrice) * Math.abs(quantity) * contractMultiplier;
            } else {
              unrealizedPl = (currentPrice - costPrice) * quantity * contractMultiplier;
            }
            const unrealizedPlRatio = costPrice > 0 && Math.abs(quantity) > 0
              ? (unrealizedPl / (Math.abs(quantity) * costPrice * contractMultiplier)) * 100
              : 0;
            
            console.warn(`[期权持仓] ${pos.symbol}: 无法获取期权行情数据，使用默认合约乘数100重新计算`, {
              quantity,
              costPrice,
              currentPrice,
              marketValue: marketValue.toFixed(2),
              unrealizedPl: unrealizedPl.toFixed(2),
              unrealizedPlRatio: unrealizedPlRatio.toFixed(2) + '%',
              note: currentPrice === costPrice ? '当前价格等于成本价，盈亏为0（可能需要检查期权行情权限）' : '使用初始价格',
            });
            
            return {
              ...pos,
              current_price: currentPrice,
              market_value: marketValue,
              unrealized_pl: unrealizedPl,
              unrealized_pl_ratio: unrealizedPlRatio,
              quote_data: null,
              contract_multiplier: contractMultiplier,
            };
          }
          
          // 普通股票：如果没有行情数据，保持原值
          return {
            ...pos,
            quote_data: null,
          };
        }
      });
      
      // 同步到数据库
      const apiSymbols = new Set(updatedPositions.map(pos => pos.symbol));
      
      for (const pos of updatedPositions) {
        try {
          await pool.query(
            `INSERT INTO positions (
              symbol, symbol_name, quantity, available_quantity, 
              cost_price, current_price, market_value, 
              unrealized_pl, unrealized_pl_ratio, currency, position_side,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
            ON CONFLICT (symbol) DO UPDATE SET
              symbol_name = EXCLUDED.symbol_name,
              quantity = EXCLUDED.quantity,
              available_quantity = EXCLUDED.available_quantity,
              cost_price = EXCLUDED.cost_price,
              current_price = EXCLUDED.current_price,
              market_value = EXCLUDED.market_value,
              unrealized_pl = EXCLUDED.unrealized_pl,
              unrealized_pl_ratio = EXCLUDED.unrealized_pl_ratio,
              currency = EXCLUDED.currency,
              position_side = EXCLUDED.position_side,
              updated_at = NOW()`,
            [
              pos.symbol,
              pos.symbol_name,
              pos.quantity,
              pos.available_quantity,
              pos.cost_price,
              pos.current_price,
              pos.market_value,
              pos.unrealized_pl,
              pos.unrealized_pl_ratio,
              pos.currency,
              pos.position_side,
            ]
          );
        } catch (dbError) {
          console.error(`同步持仓 ${pos.symbol} 到数据库失败:`, dbError);
        }
      }
      
      // 删除数据库中已不存在于API返回的持仓（清仓的股票）
      // 注意：只有当API返回了持仓时才执行删除操作
      if (apiSymbols.size > 0) {
        try {
          const placeholders = Array.from(apiSymbols).map((_, i) => `$${i + 1}`).join(', ');
          const deleteResult = await pool.query(
            `DELETE FROM positions 
             WHERE symbol NOT IN (${placeholders})
             AND quantity > 0`,
            Array.from(apiSymbols)
          );
          
          if (deleteResult.rowCount && deleteResult.rowCount > 0) {
            console.log(`已删除 ${deleteResult.rowCount} 个已清仓的持仓（不在API返回列表中）`);
          }
        } catch (deleteError) {
          console.error('删除已清仓持仓失败:', deleteError);
          // 不影响主流程，只记录错误
        }
      } else {
        // 如果API返回的持仓列表为空，说明所有持仓都已清仓
        // 可以选择删除所有持仓，或者保留（这里选择保留，因为可能是API调用失败）
        console.warn('API返回的持仓列表为空，跳过删除操作（可能是API调用失败）');
      }
      
      return res.json({
        success: true,
        data: {
          positions: updatedPositions,
          source: 'longport_api',
          quote_updated: true,
        },
      });
    } catch (apiError: any) {
      console.error('从LongPort API获取持仓失败，尝试从数据库获取:', apiError);
      // 如果API调用失败，从数据库获取
    }
    
    // 从数据库获取持仓（备用方案）
    const query = `
      SELECT * FROM positions 
      WHERE quantity > 0 
      ORDER BY symbol ASC
    `;
    
    const result = await pool.query(query);

    res.json({
      success: true,
      data: {
        positions: result.rows,
        source: 'database',
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/positions/:symbol
 * 获取单个持仓详情
 */
positionsRouter.get('/:symbol', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { symbol } = req.params;

    const result = await pool.query(
      'SELECT * FROM positions WHERE symbol = $1',
      [symbol]
    );

    if (result.rows.length === 0) {
      return next(ErrorFactory.notFound('持仓'));
    }

    res.json({
      success: true,
      data: {
        position: result.rows[0],
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * POST /api/positions
 * 创建或更新持仓
 */
positionsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      symbol,
      symbol_name,
      quantity,
      available_quantity,
      cost_price,
      current_price,
      currency = 'USD',
      position_side = 'Long',
    } = req.body;

    if (!symbol) {
      return next(ErrorFactory.missingParameter('symbol'));
    }

    // 计算市值和盈亏
    const market_value = quantity * current_price;
    const unrealized_pl = (current_price - cost_price) * quantity;
    const unrealized_pl_ratio = cost_price > 0 
      ? ((current_price - cost_price) / cost_price) * 100 
      : 0;

    // 使用UPSERT（INSERT ... ON CONFLICT UPDATE）
    const result = await pool.query(
      `INSERT INTO positions (
        symbol, symbol_name, quantity, available_quantity, 
        cost_price, current_price, market_value, 
        unrealized_pl, unrealized_pl_ratio, currency, position_side,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (symbol) DO UPDATE SET
        symbol_name = EXCLUDED.symbol_name,
        quantity = EXCLUDED.quantity,
        available_quantity = EXCLUDED.available_quantity,
        cost_price = EXCLUDED.cost_price,
        current_price = EXCLUDED.current_price,
        market_value = EXCLUDED.market_value,
        unrealized_pl = EXCLUDED.unrealized_pl,
        unrealized_pl_ratio = EXCLUDED.unrealized_pl_ratio,
        currency = EXCLUDED.currency,
        position_side = EXCLUDED.position_side,
        updated_at = NOW()
      RETURNING *`,
      [
        symbol,
        symbol_name,
        quantity || 0,
        available_quantity || quantity || 0,
        cost_price || 0,
        current_price || 0,
        market_value,
        unrealized_pl,
        unrealized_pl_ratio,
        currency,
        position_side,
      ]
    );

    res.status(201).json({
      success: true,
      data: {
        position: result.rows[0],
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * DELETE /api/positions/:symbol
 * 删除持仓（清仓）
 */
positionsRouter.delete('/:symbol', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { symbol } = req.params;

    const result = await pool.query(
      'DELETE FROM positions WHERE symbol = $1 RETURNING *',
      [symbol]
    );

    if (result.rows.length === 0) {
      return next(ErrorFactory.notFound('持仓'));
    }

    res.json({
      success: true,
      data: {
        message: '持仓已删除',
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

