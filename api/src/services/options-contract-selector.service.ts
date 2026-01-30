import {
  getOptionStrikeDates,
  getOptionChain,
  getOptionDetail,
  getStockIdBySymbol,
  getUnderlyingStockQuote,
} from './futunn-option-chain.service';
import { getFutunnOptionQuote } from './futunn-option-quote.service';
import { normalizeMoomooOptionCodeToSymbol, getUnderlyingRoot } from '../utils/options-symbol';

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
    console.log(`[使用已知指数映射] ${root} -> stockId=${KNOWN_INDEX_STOCK_IDS[root]}`);
    return KNOWN_INDEX_STOCK_IDS[root];
  }

  // Try direct symbol lookup first (for typical equities)
  const bySymbol = await getStockIdBySymbol(underlyingSymbol);
  if (bySymbol) {
    // 如果是未映射的指数，记录日志以便后续补充
    if (root !== underlyingSymbol.replace(/^\./, '').replace(/\.US$/, '')) {
      console.log(`[发现未映射的标的] ${underlyingSymbol} (root=${root}) -> stockId=${bySymbol}，请更新 KNOWN_INDEX_STOCK_IDS`);
    }
    return bySymbol;
  }

  // Fallback for dotted index symbols: ".SPX.US" -> "SPX.US"
  const cleaned = underlyingSymbol.replace(/^\./, '');
  const byCleaned = await getStockIdBySymbol(cleaned);
  if (byCleaned) {
    console.log(`[发现未映射的指数] ${cleaned} (root=${root}) -> stockId=${byCleaned}，请更新 KNOWN_INDEX_STOCK_IDS`);
    return byCleaned;
  }

  // Last attempt: use root keyword
  const byRoot = await getStockIdBySymbol(`${root}.US`);
  if (byRoot) {
    console.log(`[发现未映射的指数] ${root}.US -> stockId=${byRoot}，请更新 KNOWN_INDEX_STOCK_IDS`);
  }
  return byRoot;
}

export async function selectOptionContract(params: SelectOptionContractParams): Promise<SelectedOptionContract | null> {
  const candidateStrikes = params.candidateStrikes ?? 8;
  const liquidity = params.liquidityFilters ?? {};
  const greek = params.greekFilters ?? {};

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
    const expiryDate = new Date(year, month, day, 23, 59, 59); // 假设到期日为当天收盘

    return expiryDate >= now;
  });

  // 选择到期日期
  let pickedExpiry;
  if (params.expirationMode === '0DTE') {
    if (todayExpiry) {
      pickedExpiry = todayExpiry;
      console.log(`[选择0DTE期权] strikeDate=${todayExpiry.strikeDate}, leftDay=${todayExpiry.leftDay}`);
    } else {
      // 降级到最近的期权
      pickedExpiry = sorted[0];
      console.warn(
        `[0DTE期权不可用] 降级到最近期权: strikeDate=${sorted[0].strikeDate}, leftDay=${sorted[0].leftDay}`
      );
    }
  } else {
    pickedExpiry = sorted[0];
  }

  const strikeDate = pickedExpiry.strikeDate;
  const chain = await getOptionChain(underlyingStockId, strikeDate);
  if (!chain || chain.length === 0) return null;

  // Underlying quote for ATM targeting (may fail for some index underlyings)
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

  // Choose strikes:
  // - If we have underlying price: closest strikes around ATM
  // - Else: pick around the median strike of the chain
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

  // For US options, marketType is 2 in Moomoo APIs.
  // (If later you add HK options, make this configurable.)
  const marketType = 2;

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

      // 区分"数据不可用"和"值为0"
      if (delta === undefined || delta === null) {
        console.warn(`[期权 ${optionId}] Delta 数据不可用，跳过`);
        continue;
      }
      if (theta === undefined || theta === null) {
        console.warn(`[期权 ${optionId}] Theta 数据不可用，跳过`);
        continue;
      }

      // 转换为数字
      const deltaNum = toNumber(delta, 0);
      const thetaNum = toNumber(theta, 0);

      // Liquidity filters
      if (liquidity.minOpenInterest !== undefined && openInterest < liquidity.minOpenInterest) {
        console.log(`[期权 ${optionId}] 持仓量 ${openInterest} < ${liquidity.minOpenInterest}，跳过`);
        continue;
      }
      if (liquidity.maxBidAskSpreadAbs !== undefined && spreadAbs > liquidity.maxBidAskSpreadAbs) {
        console.log(`[期权 ${optionId}] 价差 ${spreadAbs.toFixed(2)} > ${liquidity.maxBidAskSpreadAbs}，跳过`);
        continue;
      }
      if (liquidity.maxBidAskSpreadPct !== undefined && spreadPct > liquidity.maxBidAskSpreadPct) {
        console.log(`[期权 ${optionId}] 价差% ${spreadPct.toFixed(2)}% > ${liquidity.maxBidAskSpreadPct}%，跳过`);
        continue;
      }

      // Greek filters
      if (greek.deltaMin !== undefined && deltaNum < greek.deltaMin) {
        console.log(`[期权 ${optionId}] Delta ${deltaNum.toFixed(4)} < ${greek.deltaMin}，跳过`);
        continue;
      }
      if (greek.deltaMax !== undefined && deltaNum > greek.deltaMax) {
        console.log(`[期权 ${optionId}] Delta ${deltaNum.toFixed(4)} > ${greek.deltaMax}，跳过`);
        continue;
      }
      if (greek.thetaMaxAbs !== undefined && Math.abs(thetaNum) > greek.thetaMaxAbs) {
        console.log(`[期权 ${optionId}] |Theta| ${Math.abs(thetaNum).toFixed(4)} > ${greek.thetaMaxAbs}，跳过`);
        continue;
      }

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

  if (evaluated.length === 0) {
    // As a fallback, pick the closest strike without filters, using best-effort quote (daily kline)
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

