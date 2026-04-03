"""
futu-bridge: FutuOpenD HTTP 桥接服务
将 FutuOpenD TCP+Protobuf 协议翻译为标准 JSON REST，供 Node.js trading-app 调用。
"""

import os
import time
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import JSONResponse
from futu import (
    OpenQuoteContext, RET_OK, KLType, AuType, SubType,
    StockQuoteHandlerBase, TradeDateMarket
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("futu-bridge")

FUTU_HOST = os.getenv("FUTU_HOST", "127.0.0.1")
FUTU_PORT = int(os.getenv("FUTU_PORT", "11111"))

# 全局行情上下文
quote_ctx: OpenQuoteContext | None = None


def get_ctx() -> OpenQuoteContext:
    global quote_ctx
    if quote_ctx is None:
        log.info(f"连接 FutuOpenD {FUTU_HOST}:{FUTU_PORT}")
        quote_ctx = OpenQuoteContext(host=FUTU_HOST, port=FUTU_PORT)
    return quote_ctx


# ---------- Symbol 格式转换 ----------

KTYPE_MAP = {
    "K_DAY": KLType.K_DAY,
    "K_1M": KLType.K_1M,
    "K_3M": KLType.K_3M,
    "K_5M": KLType.K_5M,
    "K_15M": KLType.K_15M,
    "K_30M": KLType.K_30M,
    "K_60M": KLType.K_60M,
    "K_WEEK": KLType.K_WEEK,
}


def to_futu_symbol(symbol: str) -> str:
    """LongPort 格式 → FutuOpenD 格式: SPY.US → US.SPY"""
    if "." not in symbol:
        return f"US.{symbol}"
    parts = symbol.split(".")
    if len(parts) == 2:
        code, market = parts[0], parts[1]
        return f"{market}.{code}"
    return symbol


def to_longport_symbol(symbol: str) -> str:
    """FutuOpenD 格式 → LongPort 格式: US.SPY → SPY.US"""
    if "." not in symbol:
        return f"{symbol}.US"
    parts = symbol.split(".")
    if len(parts) == 2:
        market, code = parts[0], parts[1]
        return f"{code}.{market}"
    return symbol


def format_kline_row(row: dict) -> dict:
    """将 FutuOpenD K 线 DataFrame 行转为标准 JSON"""
    time_key = row.get("time_key", "")
    if isinstance(time_key, str) and time_key:
        try:
            ts = int(datetime.strptime(time_key, "%Y-%m-%d %H:%M:%S").timestamp() * 1000)
        except ValueError:
            try:
                ts = int(datetime.strptime(time_key, "%Y-%m-%d").timestamp() * 1000)
            except ValueError:
                ts = 0
    else:
        ts = 0

    return {
        "timestamp": ts,
        "open": float(row.get("open", 0)),
        "high": float(row.get("high", 0)),
        "low": float(row.get("low", 0)),
        "close": float(row.get("close", 0)),
        "volume": int(row.get("volume", 0)),
        "turnover": float(row.get("turnover", 0)),
    }


# ---------- Lifespan ----------

@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info(f"futu-bridge 启动，目标 FutuOpenD: {FUTU_HOST}:{FUTU_PORT}")
    try:
        ctx = get_ctx()
        ret, state = ctx.get_global_state()
        if ret == RET_OK:
            log.info(f"FutuOpenD 连接成功: {state}")
        else:
            log.warning(f"FutuOpenD 全局状态获取失败: {state}")
    except Exception as e:
        log.error(f"FutuOpenD 初始连接失败: {e}")
    yield
    if quote_ctx is not None:
        quote_ctx.close()
        log.info("FutuOpenD 连接已关闭")


app = FastAPI(title="futu-bridge", version="1.0.0", lifespan=lifespan)


# ---------- 路由 ----------

@app.get("/health")
async def health():
    try:
        ctx = get_ctx()
        ret, state = ctx.get_global_state()
        if ret == RET_OK:
            return {"status": "ok", "futu_host": FUTU_HOST, "futu_port": FUTU_PORT}
        return JSONResponse(status_code=503, content={"status": "degraded", "error": str(state)})
    except Exception as e:
        return JSONResponse(status_code=503, content={"status": "error", "error": str(e)})


@app.get("/kline")
async def get_kline(
    symbol: str = Query(..., description="FutuOpenD 或 LongPort 格式，如 US.SPY 或 SPY.US"),
    ktype: str = Query("K_DAY", description="K 线类型: K_DAY, K_1M, K_5M 等"),
    count: int = Query(100, ge=1, le=1000, description="请求 K 线数量"),
):
    """获取历史 K 线数据"""
    futu_sym = to_futu_symbol(symbol) if "." in symbol and not symbol.startswith("US.") and not symbol.startswith("HK.") else symbol
    # 如果已经是 FutuOpenD 格式就直接用
    if not futu_sym.startswith(("US.", "HK.", "SH.", "SZ.")):
        futu_sym = to_futu_symbol(symbol)

    kl_type = KTYPE_MAP.get(ktype.upper())
    if kl_type is None:
        raise HTTPException(status_code=400, detail=f"不支持的 ktype: {ktype}，支持: {list(KTYPE_MAP.keys())}")

    try:
        ctx = get_ctx()

        # 计算 start/end 日期
        end_date = datetime.now().strftime("%Y-%m-%d")
        if kl_type in (KLType.K_DAY, KLType.K_WEEK):
            start_date = (datetime.now() - timedelta(days=max(count * 2, 200))).strftime("%Y-%m-%d")
        else:
            # 分钟级数据只需几天
            start_date = (datetime.now() - timedelta(days=max(count // 78 + 2, 5))).strftime("%Y-%m-%d")

        ret, data, _ = ctx.request_history_kline(
            code=futu_sym,
            start=start_date,
            end=end_date,
            ktype=kl_type,
            autype=AuType.QFQ,
        )

        if ret != RET_OK:
            raise HTTPException(status_code=502, detail=f"FutuOpenD 返回错误: {data}")

        rows = data.to_dict("records")
        # 只取最后 count 条
        rows = rows[-count:] if len(rows) > count else rows
        klines = [format_kline_row(r) for r in rows]

        return {
            "source": "futu",
            "symbol": to_longport_symbol(futu_sym),
            "ktype": ktype,
            "count": len(klines),
            "data": klines,
        }

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"获取 K 线失败: symbol={futu_sym}, ktype={ktype}, error={e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/snapshot")
async def get_snapshot(
    symbols: str = Query(..., description="逗号分隔的 symbol 列表，如 US.SPY,US.UUP,US.IBIT"),
):
    """获取市场快照（无需订阅）"""
    symbol_list = [s.strip() for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        raise HTTPException(status_code=400, detail="symbols 参数不能为空")

    # 统一转为 FutuOpenD 格式
    futu_symbols = []
    for s in symbol_list:
        if s.startswith(("US.", "HK.", "SH.", "SZ.")):
            futu_symbols.append(s)
        else:
            futu_symbols.append(to_futu_symbol(s))

    try:
        ctx = get_ctx()
        ret, data = ctx.get_market_snapshot(futu_symbols)
        if ret != RET_OK:
            raise HTTPException(status_code=502, detail=f"FutuOpenD 返回错误: {data}")

        rows = data.to_dict("records")
        results = []
        for r in rows:
            results.append({
                "symbol": to_longport_symbol(r.get("code", "")),
                "last_price": float(r.get("last_price", 0)),
                "open": float(r.get("open_price", 0)),
                "high": float(r.get("high_price", 0)),
                "low": float(r.get("low_price", 0)),
                "prev_close": float(r.get("prev_close_price", 0)),
                "volume": int(r.get("volume", 0)),
                "turnover": float(r.get("turnover", 0)),
                "change_rate": float(r.get("change_rate", 0)),
            })

        return {"source": "futu", "data": results}

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"获取快照失败: symbols={futu_symbols}, error={e}")
        raise HTTPException(status_code=500, detail=str(e))


MARKET_MAP = {
    "US": TradeDateMarket.US,
    "HK": TradeDateMarket.HK,
}


@app.get("/trading-days")
async def get_trading_days(
    market: str = Query("US", description="市场: US, HK"),
    start: str = Query(..., description="开始日期 YYYY-MM-DD"),
    end: str = Query(..., description="结束日期 YYYY-MM-DD"),
):
    """获取交易日列表"""
    futu_market = MARKET_MAP.get(market.upper())
    if futu_market is None:
        raise HTTPException(status_code=400, detail=f"不支持的市场: {market}，支持: {list(MARKET_MAP.keys())}")

    try:
        ctx = get_ctx()
        ret, data = ctx.request_trading_days(futu_market, start, end)
        if ret != RET_OK:
            raise HTTPException(status_code=502, detail=f"FutuOpenD 返回错误: {data}")

        # request_trading_days 返回 list[dict]，每个元素形如 {'time': '2026-04-01', 'trade_date_type': 'WHOLE'}
        trading_days = [d["time"] for d in data]
        return {
            "source": "futu",
            "market": market.upper(),
            "start": start,
            "end": end,
            "count": len(trading_days),
            "trading_days": trading_days,
        }

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"获取交易日失败: market={market}, error={e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("BRIDGE_PORT", "8765"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
