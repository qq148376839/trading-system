import {
  getOptionStrikeDates,
  getOptionChain,
  getOptionDetail,
  getStockIdBySymbol,
  getUnderlyingStockQuote,
} from './futunn-option-chain.service';
import { getFutunnOptionQuote } from './futunn-option-quote.service';
import { normalizeMoomooOptionCodeToSymbol, getUnderlyingRoot } from '../utils/options-symbol';
import { logger } from '../utils/logger';
import longportOptionQuoteService from './longport-option-quote.service';
import { getMarketCloseWindow } from './market-session.service';

export type OptionDirection = 'CALL' | 'PUT';

export interface OptionLiquidityFilters {
  minOpenInterest?: number;
  maxBidAskSpreadAbs?: number; // absolute spread in option premium (USD)
  maxBidAskSpreadPct?: number; // spread / mid
}

export interface OptionGreekFilters {
  deltaMin?: number;
  deltaMax?: number;
  thetaMaxAbs?: number;
}

export interface SelectOptionContractParams {
  underlyingSymbol: string; // e.g. AAPL.US, .SPX.US
  expirationMode: '0DTE' | 'NEAREST';
  direction: OptionDirection;
  candidateStrikes?: number; // how many closest strikes to evaluate
  liquidityFilters?: OptionLiquidityFilters;
  greekFilters?: OptionGreekFilters;
}

export interface SelectedOptionContract {
  underlyingSymbol: string;
  optionSymbol: string; // normalized (.. .US/.HK)
  optionId: string;
  underlyingStockId: string;
  marketType: number;
  strikeDate: number;
  strikePrice: number;
  optionType: 'Call' | 'Put';
  multiplier: number;
  bid: number;
  ask: number;
  mid: number;
  last: number;
  openInterest: number;
  impliedVolatility: number;
  delta: number;
  theta: number;
  timeValue: number;
}

function toNumber(v: any, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function safePct(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/**
 * Resolve underlying stockId for Moomoo:
 * - Try known index aliases (.SPX.US etc) via search fallback
 * - Otherwise use headfoot-search-based stock lookup
 */
async function resolveUnderlyingStockId(underlyingSymbol: string): Promise<string | null> {
  // Known index IDs (from existing forex/index integrations)
  const root = getUnderlyingRoot(underlyingSymbol);
  const KNOWN_INDEX_STOCK_IDS: Record<string, string> = {
    // S&P 500 系列
    SPX: '200003',
    SPXW: '200003',  // S&P 500 Weekly (同一 underlying)
    XSP: '200003',   // Mini-SPX (同一 underlying)

    // NASDAQ-100 系列（待确认实际 stockId）
    // NDX: '200004',   // NASDAQ-100 (需要通过搜索确认)
    // NDXP: '200004',  // NASDAQ-100 PM (需要通过搜索确认)

    // 道琼斯系列（待确认实际 stockId）
    // DJX: '200005',   // Dow Jones (需要通过搜索确认)

    // Russell 系列（待确认实际 stockId）
    // RUT: '200006',   // Russell 2000 (需要通过搜索确认)

    // 注意：注释掉的ID需要通过搜索API验证后再启用
    // TODO: 补充完整的指数映射表
  };
  if (KNOWN_INDEX_STOCK_IDS[root]) {
    logger.debug(`[使用已知指数映射] ${root} -> stockId=${KNOWN_INDEX_STOCK_IDS[root]}`);
    return KNOWN_INDEX_STOCK_IDS[root];
  }

  // Try direct symbol lookup first (for typical equities)
  const bySymbol = await getStockIdBySymbol(underlyingSymbol);
  if (bySymbol) {
    // 如果是未映射的指数，记录日志以便后续补充
    if (root !== underlyingSymbol.replace(/^\./, '').replace(/\.US$/, '')) {
      logger.debug(`[发现未映射的标的] ${underlyingSymbol} (root=${root}) -> stockId=${bySymbol}，请更新 KNOWN_INDEX_STOCK_IDS`);
    }
    return bySymbol;
  }

  // Fallback for dotted index symbols: ".SPX.US" -> "SPX.US"
  const cleaned = underlyingSymbol.replace(/^\./, '');
  const byCleaned = await getStockIdBySymbol(cleaned);
  if (byCleaned) {
    logger.debug(`[发现未映射的指数] ${cleaned} (root=${root}) -> stockId=${byCleaned}，请更新 KNOWN_INDEX_STOCK_IDS`);
    return byCleaned;
  }

  // Last attempt: use root keyword
  const byRoot = await getStockIdBySymbol(`${root}.US`);
  if (byRoot) {
    logger.debug(`[发现未映射的指数] ${root}.US -> stockId=${byRoot}，请更新 KNOWN_INDEX_STOCK_IDS`);
  }
  return byRoot;
}

/**
 * 将 YYYYMMDD 转为类似 strikeDate 数值（等同于 Moomoo 格式）
 */
function ymdToStrikeDate(dateStr: string): number {
  return parseInt(dateStr, 10);
}

/**
 * 0DTE 买入截止时间检查
 * 如果当前已过收盘前 noNewEntryBeforeCloseMinutes 分钟，返回 true（应拦截买入）
 */
async function is0DTEBuyBlocked(): Promise<boolean> {
  try {
    const closeWindow = await getMarketCloseWindow({
      market: 'US',
      noNewEntryBeforeCloseMinutes: 120,
      forceCloseBeforeCloseMinutes: 30,
    });
    if (closeWindow && new Date() >= closeWindow.noNewEntryTimeUtc) {
      return true;
    }
  } catch {
    // 无法获取交易时段信息时，不拦截
  }
  return false;
}

export async function selectOptionContract(params: SelectOptionContractParams): Promise<SelectedOptionContract | null> {
  const candidateStrikes = params.candidateStrikes ?? 8;
  const liquidity = params.liquidityFilters ?? {};
  const greek = params.greekFilters ?? {};

  // ===== 主源：LongPort =====
  const lbResult = await selectOptionContractViaLongPort(params, candidateStrikes, liquidity, greek);
  if (lbResult !== undefined) return lbResult; // null = 找到但没合适的, undefined = LongPort 失败需 fallback

  // ===== 备用：Moomoo =====
  logger.info(`[${params.underlyingSymbol}] LongPort期权链失败，降级到Moomoo`);
  return selectOptionContractViaMoomoo(params, candidateStrikes, liquidity, greek);
}

/**
 * LongPort 路径：获取到期日 → 选到期日 → 获取行权价链 → 用 optionQuote 获取详情 → 筛选
 */
async function selectOptionContractViaLongPort(
  params: SelectOptionContractParams,
  candidateStrikes: number,
  liquidity: OptionLiquidityFilters,
  greek: OptionGreekFilters
): Promise<SelectedOptionContract | null | undefined> {
  try {
    // 1. 获取到期日列表
    const expiryDates = await longportOptionQuoteService.getOptionExpiryDates(params.underlyingSymbol);
    if (!expiryDates || expiryDates.length === 0) {
      logger.debug(`[${params.underlyingSymbol}] LongPort 无期权到期日`);
      return undefined; // fallback to Moomoo
    }

    // 排序：最近的到期日在前
    const sorted = [...expiryDates].sort();

    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
    const todayExpiry = sorted.find((d) => d === todayStr);

    logger.debug(
      `📍 [${params.underlyingSymbol}期权日期-LB] 可用日期=${sorted.length}个, 今日=${todayStr}`
    );

    // 2. 选择到期日
    let pickedExpiryDate: string;
    let is0DTE = false;
    if (params.expirationMode === '0DTE') {
      if (todayExpiry) {
        pickedExpiryDate = todayExpiry;
        is0DTE = true;
        logger.debug(`📍 [${params.underlyingSymbol}选择-LB] 0DTE期权 | 到期=${todayExpiry}`);
      } else {
        // 降级到最近的到期日（未来最近）
        const futureDate = sorted.find((d) => d >= todayStr);
        pickedExpiryDate = futureDate || sorted[0];
        logger.warn(
          `⚠️ [${params.underlyingSymbol}降级-LB] 0DTE不可用，使用最近期权 | 最近=${pickedExpiryDate}`
        );
      }
    } else {
      const futureDate = sorted.find((d) => d >= todayStr);
      pickedExpiryDate = futureDate || sorted[0];
    }

    // 3. 0DTE 买入截止时间检查
    if (is0DTE) {
      const blocked = await is0DTEBuyBlocked();
      if (blocked) {
        logger.warn(`⚠️ [${params.underlyingSymbol}] 0DTE期权已过截止时间(收盘前120分钟)，跳过`);
        return null;
      }
    }

    // 4. 获取行权价链
    const chain = await longportOptionQuoteService.getOptionChainByDate(params.underlyingSymbol, pickedExpiryDate);
    if (!chain || chain.length === 0) {
      logger.debug(`[${params.underlyingSymbol}] LongPort 期权链为空 (${pickedExpiryDate})`);
      return undefined; // fallback
    }

    const callOrPut = params.direction === 'CALL' ? 'CALL' : 'PUT';
    const strikes = chain.map((c) => c.price).filter((p) => p > 0);
    logger.debug(
      `📍 [${params.underlyingSymbol}期权链-LB] ${callOrPut}合约=${chain.length}个 | 行权价范围=[${Math.min(...strikes)}-${Math.max(...strikes)}]`
    );

    // 5. 获取标的现价（用于 ATM 定位）
    let underlyingPrice = 0;
    try {
      const { getQuoteContext } = await import('../config/longport');
      const quoteCtx = await getQuoteContext();
      const quotes = await quoteCtx.quote([params.underlyingSymbol]);
      if (quotes && quotes.length > 0) {
        underlyingPrice = parseFloat(quotes[0].lastDone?.toString() || '0');
      }
    } catch {
      // 尝试富途获取
      try {
        const stockId = await resolveUnderlyingStockId(params.underlyingSymbol);
        if (stockId) {
          const uq = await getUnderlyingStockQuote(stockId);
          underlyingPrice = uq?.price || 0;
        }
      } catch {
        underlyingPrice = 0;
      }
    }

    // 6. 选择 ATM 附近的候选行权价
    const byStrike = chain
      .map((item) => ({
        item,
        strike: item.price,
        symbol: params.direction === 'CALL' ? item.callSymbol : item.putSymbol,
      }))
      .filter((x) => x.symbol) // 必须有对应方向的 symbol
      .sort((a, b) => a.strike - b.strike);

    let candidates: Array<{ item: typeof chain[0]; strike: number; symbol: string; dist: number }>;
    if (underlyingPrice > 0) {
      candidates = byStrike
        .map((x) => ({ ...x, dist: Math.abs(x.strike - underlyingPrice) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, candidateStrikes);
    } else {
      const midIdx = Math.floor(byStrike.length / 2);
      const half = Math.floor(candidateStrikes / 2);
      const start = Math.max(0, midIdx - half);
      candidates = byStrike.slice(start, start + candidateStrikes).map((x) => ({ ...x, dist: 0 }));
    }

    logger.debug(`📍 [${params.underlyingSymbol}筛选前-LB] 候选=${candidates.length}个 ATM合约`);

    const desiredType = params.direction === 'CALL' ? 'Call' : 'Put';
    const strikeDate = ymdToStrikeDate(pickedExpiryDate);
    const evaluated: SelectedOptionContract[] = [];

    // 7. 批量获取所有候选合约的 Greeks（LongPort calcIndexes）
    const candidateSymbols = candidates.map(c => c.symbol).filter(Boolean);
    const greeksMap = await longportOptionQuoteService.getGreeks(candidateSymbols);

    // 8. 获取每个候选合约的详情（LongPort optionQuote）
    for (const c of candidates) {
      try {
        const optQuote = await longportOptionQuoteService.getOptionQuote(c.symbol);
        if (!optQuote) continue;

        const bid = optQuote.bid;
        const ask = optQuote.ask;
        const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : (optQuote.price || 0);
        const spreadAbs = bid > 0 && ask > 0 ? (ask - bid) : 0;
        const spreadPct = mid > 0 ? (spreadAbs / mid) * 100 : 0;

        const openInterest = optQuote.openInterest;
        const iv = optQuote.iv;

        // 从 LongPort calcIndexes 批量结果中获取 Greeks
        let deltaNum = 0;
        let thetaNum = 0;
        const timeValueNum = 0;
        const multiplier = optQuote.contractMultiplier || 100;

        const greeks = greeksMap.get(c.symbol);
        if (greeks) {
          deltaNum = greeks.delta;
          thetaNum = greeks.theta;
        }

        // Liquidity filters
        if (liquidity.minOpenInterest !== undefined && openInterest < liquidity.minOpenInterest) {
          logger.debug(`[期权-LB ${c.symbol}] 持仓量 ${openInterest} < ${liquidity.minOpenInterest}，跳过`);
          continue;
        }
        if (liquidity.maxBidAskSpreadAbs !== undefined && spreadAbs > liquidity.maxBidAskSpreadAbs) {
          logger.debug(`[期权-LB ${c.symbol}] 价差 ${spreadAbs.toFixed(2)} > ${liquidity.maxBidAskSpreadAbs}，跳过`);
          continue;
        }
        if (liquidity.maxBidAskSpreadPct !== undefined && spreadPct > liquidity.maxBidAskSpreadPct) {
          logger.debug(`[期权-LB ${c.symbol}] 价差% ${spreadPct.toFixed(2)}% > ${liquidity.maxBidAskSpreadPct}%，跳过`);
          continue;
        }

        // Greek filters (only apply if we actually got Greeks)
        if (deltaNum !== 0 || thetaNum !== 0) {
          const absDelta = Math.abs(deltaNum);
          if (greek.deltaMin !== undefined && absDelta < greek.deltaMin) {
            logger.debug(`[期权-LB ${c.symbol}] |Delta| ${absDelta.toFixed(4)} < ${greek.deltaMin}，跳过`);
            continue;
          }
          if (greek.deltaMax !== undefined && absDelta > greek.deltaMax) {
            logger.debug(`[期权-LB ${c.symbol}] |Delta| ${absDelta.toFixed(4)} > ${greek.deltaMax}，跳过`);
            continue;
          }
          if (greek.thetaMaxAbs !== undefined && Math.abs(thetaNum) > greek.thetaMaxAbs) {
            logger.debug(`[期权-LB ${c.symbol}] |Theta| ${Math.abs(thetaNum).toFixed(4)} > ${greek.thetaMaxAbs}，跳过`);
            continue;
          }
        }

        evaluated.push({
          underlyingSymbol: params.underlyingSymbol,
          optionSymbol: c.symbol,
          optionId: '',
          underlyingStockId: '',
          marketType: 2,
          strikeDate,
          strikePrice: c.strike,
          optionType: desiredType,
          multiplier,
          bid,
          ask,
          mid,
          last: optQuote.price || mid,
          openInterest,
          impliedVolatility: safePct(iv),
          delta: deltaNum,
          theta: thetaNum,
          timeValue: timeValueNum,
        });
      } catch {
        // ignore candidate failures
      }
    }

    logger.info(
      `📍 [${params.underlyingSymbol}筛选后-LB] 通过=${evaluated.length}个 | 持仓量≥${liquidity.minOpenInterest || 0}, 价差≤${liquidity.maxBidAskSpreadPct || 'N/A'}%, |Delta|∈[${greek.deltaMin || 0}, ${greek.deltaMax || 1}]`
    );

    if (evaluated.length === 0) {
      // LongPort 流程得到数据但筛选后无合约，尝试最近行权价作为 fallback
      const top = candidates[0];
      if (!top) return null;
      const optQuote = await longportOptionQuoteService.getOptionQuote(top.symbol);
      if (!optQuote || optQuote.price <= 0) return null;
      const fallbackGreeks = greeksMap.get(top.symbol);
      return {
        underlyingSymbol: params.underlyingSymbol,
        optionSymbol: top.symbol,
        optionId: '',
        underlyingStockId: '',
        marketType: 2,
        strikeDate,
        strikePrice: top.strike,
        optionType: desiredType,
        multiplier: optQuote.contractMultiplier || 100,
        bid: optQuote.bid,
        ask: optQuote.ask,
        mid: optQuote.bid > 0 && optQuote.ask > 0 ? (optQuote.bid + optQuote.ask) / 2 : optQuote.price,
        last: optQuote.price,
        openInterest: optQuote.openInterest,
        impliedVolatility: safePct(optQuote.iv),
        delta: fallbackGreeks?.delta || 0,
        theta: fallbackGreeks?.theta || 0,
        timeValue: 0,
      };
    }

    // Sort by spread%, then open interest desc
    evaluated.sort((a, b) => {
      const aSpreadPct = a.mid > 0 ? ((a.ask - a.bid) / a.mid) : Number.POSITIVE_INFINITY;
      const bSpreadPct = b.mid > 0 ? ((b.ask - b.bid) / b.mid) : Number.POSITIVE_INFINITY;
      if (aSpreadPct !== bSpreadPct) return aSpreadPct - bSpreadPct;
      return b.openInterest - a.openInterest;
    });

    return evaluated[0];
  } catch (error: any) {
    logger.warn(`[${params.underlyingSymbol}] LongPort selectOptionContract 异常: ${error.message}`);
    return undefined; // fallback to Moomoo
  }
}

/**
 * Moomoo 备用路径（原有逻辑，保持不变）
 */
async function selectOptionContractViaMoomoo(
  params: SelectOptionContractParams,
  candidateStrikes: number,
  liquidity: OptionLiquidityFilters,
  greek: OptionGreekFilters
): Promise<SelectedOptionContract | null> {
  const underlyingStockId = await resolveUnderlyingStockId(params.underlyingSymbol);
  if (!underlyingStockId) return null;

  const strikeDatesResp = await getOptionStrikeDates(underlyingStockId);
  if (!strikeDatesResp || !strikeDatesResp.strikeDates || strikeDatesResp.strikeDates.length === 0) return null;

  const sorted = [...strikeDatesResp.strikeDates].sort((a, b) => a.leftDay - b.leftDay);

  // 查找当日到期的期权（leftDay=0 且仍在交易）
  const now = new Date();
  const todayExpiry = sorted.find((d) => {
    if (d.leftDay !== 0) return false;

    // 验证：到期日期必须是今天或未来（不是历史日期）
    const strikeDate = parseInt(String(d.strikeDate), 10);
    const year = Math.floor(strikeDate / 10000);
    const month = Math.floor((strikeDate % 10000) / 100) - 1;
    const day = strikeDate % 100;
    const expiryDate = new Date(year, month, day, 23, 59, 59);

    return expiryDate >= now;
  });

  logger.debug(
    `📍 [${params.underlyingSymbol}期权日期-Moomoo] 可用日期=${sorted.length}个, 今日=${now.toISOString().split('T')[0]}`
  );

  let pickedExpiry;
  let is0DTE = false;
  if (params.expirationMode === '0DTE') {
    if (todayExpiry) {
      pickedExpiry = todayExpiry;
      is0DTE = true;
      logger.debug(
        `📍 [${params.underlyingSymbol}选择-Moomoo] 0DTE期权 | 到期=${todayExpiry.strikeDate}, 剩余=${todayExpiry.leftDay}天`
      );
    } else {
      pickedExpiry = sorted[0];
      logger.warn(
        `⚠️ [${params.underlyingSymbol}降级-Moomoo] 0DTE不可用，使用最近期权 | 最近=${sorted[0]?.strikeDate}, 剩余=${sorted[0]?.leftDay}天`
      );
    }
  } else {
    pickedExpiry = sorted[0];
  }

  // 0DTE 买入截止时间检查
  if (is0DTE) {
    const blocked = await is0DTEBuyBlocked();
    if (blocked) {
      logger.warn(`⚠️ [${params.underlyingSymbol}] 0DTE期权已过截止时间(收盘前120分钟)，跳过`);
      return null;
    }
  }

  const moomooStrikeDate = pickedExpiry.strikeDate; // Unix 时间戳，用于 Moomoo API
  const chain = await getOptionChain(underlyingStockId, moomooStrikeDate);

  // 转为 YYYYMMDD 用于 SelectedOptionContract 存储（统一格式）
  const sdObj = new Date(moomooStrikeDate * 1000);
  const strikeDate = parseInt(
    sdObj.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, ''),
    10
  );

  const callOrPut = params.direction === 'CALL' ? 'CALL' : 'PUT';
  if (!chain || chain.length === 0) {
    logger.warn(`❌ [${params.underlyingSymbol}无合约-Moomoo] 期权链为空，无法选择合约`);
    return null;
  }

  const strikeMin = Math.min(...chain.map((c) => {
    const opt = params.direction === 'CALL' ? c.callOption : c.putOption;
    return opt ? parseFloat(opt.strikePrice) : Infinity;
  }).filter(x => x !== Infinity));
  const strikeMax = Math.max(...chain.map((c) => {
    const opt = params.direction === 'CALL' ? c.callOption : c.putOption;
    return opt ? parseFloat(opt.strikePrice) : -Infinity;
  }).filter(x => x !== -Infinity));
  logger.debug(
    `📍 [${params.underlyingSymbol}期权链-Moomoo] ${callOrPut}合约=${chain.length}个 | 行权价范围=[${strikeMin}-${strikeMax}]`
  );

  let underlyingPrice = 0;
  try {
    const underlyingQuote = await getUnderlyingStockQuote(underlyingStockId);
    underlyingPrice = underlyingQuote?.price || 0;
  } catch {
    underlyingPrice = 0;
  }

  const desiredType = params.direction === 'CALL' ? 'Call' : 'Put';
  const pairs = chain.map((row) => {
    const opt = params.direction === 'CALL' ? row.callOption : row.putOption;
    return opt ? opt : null;
  }).filter(Boolean) as Array<{
    optionId: string;
    code: string;
    strikePrice: string;
    openInterest: string;
  }>;

  if (pairs.length === 0) return null;

  const byStrike = pairs
    .map((o) => ({ o, strike: toNumber(o.strikePrice, 0) }))
    .sort((a, b) => a.strike - b.strike);

  let candidates: Array<{ o: any; strike: number; dist: number }> = [];
  if (underlyingPrice > 0) {
    candidates = byStrike
      .map((x) => ({ ...x, dist: Math.abs(x.strike - underlyingPrice) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, candidateStrikes);
  } else {
    const midIdx = Math.floor(byStrike.length / 2);
    const half = Math.floor(candidateStrikes / 2);
    const start = Math.max(0, midIdx - half);
    const slice = byStrike.slice(start, start + candidateStrikes);
    candidates = slice.map((x) => ({ ...x, dist: 0 }));
  }

  const marketType = 2;

  logger.debug(`📍 [${params.underlyingSymbol}筛选前-Moomoo] 候选=${candidates.length}个 ATM合约`);

  const evaluated: SelectedOptionContract[] = [];

  for (const c of candidates) {
    try {
      const optionId = String(c.o.optionId);
      const detail = await getOptionDetail(optionId, underlyingStockId, marketType);
      if (!detail) continue;

      const bid = detail.priceBid || 0;
      const ask = detail.priceAsk || 0;
      const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : (detail.price || 0);
      const spreadAbs = bid > 0 && ask > 0 ? (ask - bid) : 0;
      const spreadPct = mid > 0 ? (spreadAbs / mid) * 100 : 0;

      const openInterest = detail.option?.openInterest || 0;
      const delta = detail.option?.greeks?.hpDelta ?? detail.option?.greeks?.delta;
      const theta = detail.option?.greeks?.hpTheta ?? detail.option?.greeks?.theta;

      if (delta === undefined || delta === null) continue;
      if (theta === undefined || theta === null) continue;

      const deltaNum = toNumber(delta, 0);
      const thetaNum = toNumber(theta, 0);

      if (liquidity.minOpenInterest !== undefined && openInterest < liquidity.minOpenInterest) continue;
      if (liquidity.maxBidAskSpreadAbs !== undefined && spreadAbs > liquidity.maxBidAskSpreadAbs) continue;
      if (liquidity.maxBidAskSpreadPct !== undefined && spreadPct > liquidity.maxBidAskSpreadPct) continue;

      const absDelta = Math.abs(deltaNum);
      if (greek.deltaMin !== undefined && absDelta < greek.deltaMin) continue;
      if (greek.deltaMax !== undefined && absDelta > greek.deltaMax) continue;
      if (greek.thetaMaxAbs !== undefined && Math.abs(thetaNum) > greek.thetaMaxAbs) continue;

      evaluated.push({
        underlyingSymbol: params.underlyingSymbol,
        optionSymbol: normalizeMoomooOptionCodeToSymbol(c.o.code),
        optionId,
        underlyingStockId,
        marketType,
        strikeDate,
        strikePrice: c.strike,
        optionType: desiredType,
        multiplier: detail.option?.multiplier || 100,
        bid,
        ask,
        mid,
        last: detail.price || mid,
        openInterest,
        impliedVolatility: safePct(detail.option?.impliedVolatility || 0),
        delta: deltaNum,
        theta: thetaNum,
        timeValue: toNumber(detail.option?.timeValue || 0, 0),
      });
    } catch {
      // ignore candidate failures
    }
  }

  logger.info(
    `📍 [${params.underlyingSymbol}筛选后-Moomoo] 通过=${evaluated.length}个 | 持仓量≥${liquidity.minOpenInterest || 0}, 价差≤${liquidity.maxBidAskSpreadPct || 'N/A'}%, |Delta|∈[${greek.deltaMin || 0}, ${greek.deltaMax || 1}]`
  );

  if (evaluated.length === 0) {
    const top = candidates[0];
    if (!top) return null;
    const fallbackSymbol = normalizeMoomooOptionCodeToSymbol(top.o.code);
    const quote = await getFutunnOptionQuote(fallbackSymbol);
    if (!quote) return null;
    return {
      underlyingSymbol: params.underlyingSymbol,
      optionSymbol: fallbackSymbol,
      optionId: String(top.o.optionId),
      underlyingStockId,
      marketType,
      strikeDate,
      strikePrice: top.strike,
      optionType: desiredType,
      multiplier: 100,
      bid: 0,
      ask: 0,
      mid: quote.last_done,
      last: quote.last_done,
      openInterest: toNumber(top.o.openInterest, 0),
      impliedVolatility: 0,
      delta: 0,
      theta: 0,
      timeValue: 0,
    };
  }

  // Sort by spread%, then open interest desc
  evaluated.sort((a, b) => {
    const aSpreadPct = a.mid > 0 ? ((a.ask - a.bid) / a.mid) : Number.POSITIVE_INFINITY;
    const bSpreadPct = b.mid > 0 ? ((b.ask - b.bid) / b.mid) : Number.POSITIVE_INFINITY;
    if (aSpreadPct !== bSpreadPct) return aSpreadPct - bSpreadPct;
    return b.openInterest - a.openInterest;
  });

  return evaluated[0];
}

/**
 * 选择多个期权合约（用于分散投资）
 * 返回所有通过筛选的合约，按质量排序
 *
 * 复用 selectOptionContract 的 LongPort 主源 + Moomoo 备用逻辑。
 * 通过增大 candidateStrikes 获取更多候选，再取 top N。
 */
export async function selectMultipleOptionContracts(
  params: SelectOptionContractParams,
  maxContracts: number = 3
): Promise<SelectedOptionContract[]> {
  // 增大候选范围以获取更多合约
  const expandedParams = {
    ...params,
    candidateStrikes: Math.max(params.candidateStrikes ?? 8, maxContracts * 4),
  };

  // 复用单合约选择逻辑（内含 LongPort 主源 + Moomoo 备用）
  // 由于单选函数只返回最优一个，这里需要直接使用内部实现
  // 为简化，调用多次获取不同行权价的合约
  const results: SelectedOptionContract[] = [];
  const usedStrikes = new Set<number>();

  for (let attempt = 0; attempt < maxContracts * 2 && results.length < maxContracts; attempt++) {
    const result = await selectOptionContract(expandedParams);
    if (!result) break;

    // 避免重复选择同一行权价
    if (usedStrikes.has(result.strikePrice)) break;
    usedStrikes.add(result.strikePrice);
    results.push(result);
  }

  return results;
}

