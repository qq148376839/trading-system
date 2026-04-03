# FutuOpenD 行情 API 调用手册

> 基于 FutuOpenD v10.1.6108，Python futu-api SDK。
> 当前部署：NAS `futu-opend` 容器（host 网络），API 端口 `127.0.0.1:11111`，socat 转发 `0.0.0.0:11112`。

---

## 1. 基础连接

### 1.1 初始化与连接

```python
from futu import *

# 可选：设置客户端标识
SysConfig.set_client_info("TradingSystem", 1)

# 创建行情上下文（同步连接）
quote_ctx = OpenQuoteContext(host='127.0.0.1', port=11111)

# 获取连接 ID
conn_id = quote_ctx.get_sync_conn_id()

# 使用完毕必须关闭
quote_ctx.close()
```

**连接地址：**

| 场景 | 地址 |
|------|------|
| NAS 本机 / host 网络容器 | `127.0.0.1:11111` |
| bridge 网络容器 / 局域网设备 | `192.168.31.18:11112`（socat 转发） |

### 1.2 获取全局状态

```python
ret, data = quote_ctx.get_global_state()
# data 是 dict，包含：
#   market_hk / market_us / market_sh / market_sz — 各市场状态
#   qot_logined — 行情是否已登录
#   trd_logined — 交易是否已登录
#   program_status_type — READY / LOADING / NEED_PIC_VERIFY_CODE 等
```

### 1.3 协议配置

| 方法 | 说明 |
|------|------|
| `SysConfig.set_proto_fmt(ProtoFmt.Protobuf)` | 设置通讯格式（默认 Protobuf） |
| `SysConfig.enable_proto_encrypt(True)` | 启用协议加密 |
| `SysConfig.set_init_rsa_file(path)` | 设置 RSA 私钥路径 |
| `SysConfig.set_all_thread_daemon(True)` | 所有内部线程设为 daemon |

### 1.4 事件通知

OpenD 会推送以下通知类型（`NotifyType`）：

| 类型 | 说明 |
|------|------|
| `GtwEvent` | 网关事件（登录失败、密码变更、设备锁等） |
| `ProgramStatus` | 程序状态变更 |
| `ConnStatus` | 连接状态变更 |
| `QotRight` | 行情权限变更 |
| `APILevel` | API 额度变更 |

---

## 2. 实时行情

### 2.1 订阅管理

**订阅是获取实时推送数据的前提。** 部分拉取接口（如 `get_stock_quote`、`get_order_book`）也要求先订阅。

```python
# 订阅
ret, err = quote_ctx.subscribe(
    code_list=['US.AAPL', 'HK.00700'],
    subtype_list=[SubType.QUOTE, SubType.ORDER_BOOK, SubType.K_1M],
    subscribe_push=True  # 是否接收推送
)

# 查询当前订阅
ret, data = quote_ctx.query_subscription(is_all_conn=False)

# 取消单个订阅（订阅后至少 1 分钟才能取消）
ret, err = quote_ctx.unsubscribe(
    code_list=['US.AAPL'],
    subtype_list=[SubType.QUOTE]
)

# 取消所有订阅（同样需满足 1 分钟最低订阅时长）
ret, err = quote_ctx.unsubscribe_all()
```

**SubType 订阅类型：**

| 枚举值 | 说明 | 推送 Handler |
|--------|------|-------------|
| `SubType.QUOTE` | 报价 | `StockQuoteHandlerBase` |
| `SubType.ORDER_BOOK` | 买卖盘（摆盘） | `OrderBookHandlerBase` |
| `SubType.TICKER` | 逐笔成交 | `TickerHandlerBase` |
| `SubType.K_1M` | 1 分钟 K 线 | `CurKlineHandlerBase` |
| `SubType.K_5M` | 5 分钟 K 线 | `CurKlineHandlerBase` |
| `SubType.K_15M` | 15 分钟 K 线 | `CurKlineHandlerBase` |
| `SubType.K_30M` | 30 分钟 K 线 | `CurKlineHandlerBase` |
| `SubType.K_60M` | 60 分钟 K 线 | `CurKlineHandlerBase` |
| `SubType.K_DAY` | 日 K 线 | `CurKlineHandlerBase` |
| `SubType.K_WEEK` | 周 K 线 | `CurKlineHandlerBase` |
| `SubType.K_MON` | 月 K 线 | `CurKlineHandlerBase` |
| `SubType.RT_DATA` | 分时数据 | `RTDataHandlerBase` |
| `SubType.BROKER` | 经纪队列 | `BrokerHandlerBase` |

**订阅额度限制：** 取决于账户级别和 OpenD 连接数，通过 `query_subscription` 可查看剩余额度。

### 2.2 实时推送回调

```python
class MyQuoteHandler(StockQuoteHandlerBase):
    def on_recv_rsp(self, rsp_pb):
        ret, data = super().on_recv_rsp(rsp_pb)
        if ret == RET_OK:
            print(data)  # DataFrame: code, last_price, volume, turnover ...
        return RET_OK, data

class MyOrderBookHandler(OrderBookHandlerBase):
    def on_recv_rsp(self, rsp_pb):
        ret, data = super().on_recv_rsp(rsp_pb)
        if ret == RET_OK:
            print(data)  # dict: code, Bid/Ask (price, volume, order_num)
        return RET_OK, data

class MyKlineHandler(CurKlineHandlerBase):
    def on_recv_rsp(self, rsp_pb):
        ret, data = super().on_recv_rsp(rsp_pb)
        if ret == RET_OK:
            print(data)  # DataFrame: code, time_key, open, high, low, close, volume
        return RET_OK, data

# 注册 handler（必须在 subscribe 之前）
quote_ctx.set_handler(MyQuoteHandler())
quote_ctx.set_handler(MyOrderBookHandler())
quote_ctx.set_handler(MyKlineHandler())
```

### 2.3 市场快照（无需订阅）

```python
ret, data = quote_ctx.get_market_snapshot(['US.AAPL', 'HK.00700'])
```

**关键返回字段：**

| 字段 | 说明 |
|------|------|
| `code` / `name` | 代码 / 名称 |
| `last_price` | 最新价 |
| `open_price` / `high_price` / `low_price` | 开高低 |
| `prev_close_price` | 昨收 |
| `volume` / `turnover` | 成交量 / 成交额 |
| `turnover_rate` | 换手率 |
| `pe_ratio` / `pb_ratio` / `pe_ttm_ratio` | PE / PB / PE(TTM) |
| `total_market_val` / `circular_market_val` | 总市值 / 流通市值 |
| `dividend_ttm` / `dividend_ratio_ttm` | TTM 股息 / 股息率 |
| `amplitude` / `avg_price` / `volume_ratio` | 振幅 / 均价 / 量比 |
| `highest52weeks_price` / `lowest52weeks_price` | 52 周高低 |
| `ask_price` / `bid_price` / `ask_vol` / `bid_vol` | 买卖盘口 |

**限制：** 每 30 秒最多 60 次，单次最多 400 只。港股 BMP 权限单次最多 20 只。

### 2.4 拉取实时数据（需先订阅）

```python
# 实时报价
ret, data = quote_ctx.get_stock_quote(['US.AAPL'])

# 实时摆盘（买卖盘）
ret, data = quote_ctx.get_order_book('US.AAPL', num=10)

# 实时K线（最近 num 根）
ret, data = quote_ctx.get_cur_kline('US.AAPL', num=100, ktype=SubType.K_1M)

# 分时数据
ret, data = quote_ctx.get_rt_data('US.AAPL')

# 逐笔成交
ret, data = quote_ctx.get_rt_ticker('US.AAPL', num=100)

# 经纪队列（仅港股，返回 3 个值）
ret, bid_broker, ask_broker = quote_ctx.get_broker_queue('HK.00700')
# bid_broker / ask_broker 均为 DataFrame，包含 bid/ask 经纪商信息
```

---

## 3. 基本数据

### 3.1 历史 K 线

```python
ret, data, next_page = quote_ctx.request_history_kline(
    code='US.AAPL',
    start='2026-03-01',
    end='2026-04-03',
    ktype=KLType.K_DAY,        # K 线类型
    autype=AuType.QFQ,         # 复权类型
    max_count=1000,             # 单次最多条数
    extended_time=False         # 是否包含盘前盘后（仅美股分钟级有效）
)
# next_page 用于分页：若非 None，传入下一次调用的 page_req_key 参数
```

**KLType K 线类型：**

| 枚举值 | 说明 |
|--------|------|
| `KLType.K_1M` / `K_3M` / `K_5M` / `K_15M` / `K_30M` / `K_60M` | 分钟级 |
| `KLType.K_DAY` | 日 K |
| `KLType.K_WEEK` | 周 K |
| `KLType.K_MON` | 月 K |
| `KLType.K_QUARTER` | 季 K |
| `KLType.K_YEAR` | 年 K |

**AuType 复权类型：**

| 枚举值 | 说明 |
|--------|------|
| `AuType.QFQ` | 前复权 |
| `AuType.HFQ` | 后复权 |
| `AuType.NONE` | 不复权 |

**限制：**
- 每 30 秒最多 60 次
- 分钟级数据约 8 年，日线约 20 年
- 换手率仅日线及以上周期提供
- 美股盘前/盘后/夜盘数据仅 60 分钟及以下周期

**返回字段：** `code`, `time_key`, `open`, `high`, `low`, `close`, `volume`, `turnover`, `pe_ratio`, `turnover_rate`, `change_rate`

### 3.2 市场状态

```python
ret, data = quote_ctx.get_market_state(['US.AAPL', 'HK.00700'])
# 返回：code, stock_name, market_state (MORNING/AFTERNOON/REST/CLOSED 等)
```

### 3.3 资金流向

```python
# 日内分时资金流
ret, data = quote_ctx.get_capital_flow('US.AAPL', period_type=PeriodType.INTRADAY)

# 历史日级资金流
ret, data = quote_ctx.get_capital_flow(
    'US.AAPL',
    period_type=PeriodType.DAY,
    start='2026-03-01',
    end='2026-04-03'
)
```

**返回字段：**

| 字段 | 说明 |
|------|------|
| `in_flow` | 整体净流入 |
| `super_in_flow` | 特大单净流入 |
| `big_in_flow` | 大单净流入 |
| `mid_in_flow` | 中单净流入 |
| `sml_in_flow` | 小单净流入 |

**PeriodType：** `INTRADAY`（日内）/ `DAY` / `WEEK` / `MONTH`

**限制：** 每 30 秒最多 30 次，仅支持正股/窝轮/基金，历史数据最多 1 年，日内仅当日。

### 3.4 资金分布

```python
ret, data = quote_ctx.get_capital_distribution('US.AAPL')
# 返回：超大单/大单/中单/小单 的买入卖出金额
```

### 3.5 复权因子

```python
ret, data = quote_ctx.get_rehab('US.AAPL')
# 返回：ex_div_date, split_ratio, per_cash_div, per_share_div, ...
```

### 3.6 交易日历

```python
ret, data = quote_ctx.request_trading_days(
    market=TradeDateMarket.US,
    start='2026-04-01',
    end='2026-04-30'
)
# 返回交易日列表
```

### 3.7 股票基本信息

```python
ret, data = quote_ctx.get_stock_basicinfo(
    market=Market.US,
    stock_type=SecurityType.STOCK
)
# 返回：code, name, lot_size, stock_type, listing_date, ...
```

### 3.8 所属板块

```python
ret, data = quote_ctx.get_owner_plate(['US.AAPL'])
# 返回：code, plate_code, plate_name, plate_type (INDUSTRY/REGION/CONCEPT)
```

---

## 4. 衍生品

### 4.1 期权到期日

```python
ret, data = quote_ctx.get_option_expiration_date(code='US.AAPL')
# 返回：strike_time (到期日), option_expiry_date_distance (距今天数)
```

### 4.2 期权链

```python
# 基础查询
ret, data = quote_ctx.get_option_chain(
    code='US.AAPL',
    start='2026-04-04',
    end='2026-04-11',
    option_type=OptionType.ALL,          # ALL / CALL / PUT
    option_cond_type=OptionCondType.ALL   # ALL / WITHIN / OUTSIDE
)

# 带希腊字母筛选
data_filter = OptionDataFilter()
data_filter.delta_min = 0.3
data_filter.delta_max = 0.7
data_filter.implied_volatility_min = 20
data_filter.implied_volatility_max = 80

ret, data = quote_ctx.get_option_chain(
    code='US.AAPL',
    start='2026-04-04',
    end='2026-04-11',
    data_filter=data_filter
)
```

**返回字段：** `code`, `name`, `lot_size`, `option_type` (CALL/PUT), `strike_time`, `strike_price`, `suspension`

**OptionDataFilter 可筛选字段：**

| 字段 | 说明 | 精度 |
|------|------|------|
| `implied_volatility_min/max` | 隐含波动率 | 小数点 0 位 |
| `delta_min/max` | Delta | 小数点 3 位 |
| `gamma_min/max` | Gamma | 小数点 3 位 |
| `vega_min/max` | Vega | 小数点 3 位 |
| `theta_min/max` | Theta | 小数点 3 位 |
| `rho_min/max` | Rho | 小数点 3 位 |
| `net_open_interest_min/max` | 净未平仓合约数 | 小数点 0 位 |
| `open_interest_min/max` | 未平仓合约数 | 小数点 0 位 |
| `vol_min/max` | 成交量 | 小数点 0 位 |

**限制：** 每 30 秒最多 10 次，时间跨度最多 30 天，不支持已过期期权。

### 4.3 关联证券

```python
# 查正股关联的窝轮
ret, data = quote_ctx.get_referencestock_list('HK.00700', SecurityReferenceType.WARRANT)

# 查期货主连的关联合约
ret, data = quote_ctx.get_referencestock_list('US.GCmain', SecurityReferenceType.FUTURE)
```

**SecurityReferenceType：**

| 枚举值 | 说明 |
|--------|------|
| `WARRANT` | 正股关联的窝轮 |
| `FUTURE` | 期货主连的关联合约 |

**返回字段：** `code`, `lot_size`, `stock_type`, `stock_name`, `list_time`, `wrt_valid`, `wrt_type` (PUT/CALL/BULL/BEAR), `future_valid`, `future_main_contract`, `future_last_trade_time`

**限制：** 每 30 秒最多 10 次（窝轮查询无限制）。

### 4.4 期货合约资料

```python
ret, data = quote_ctx.get_future_info(['US.GCmain'])
# 返回：合约名称、合约大小、最小变动单位、交易时间等
# ⚠️ 需要期货行情权限卡，当前账户未开通，调用会返回"行情权限不足"
```

### 4.5 窝轮数据

```python
ret, data = quote_ctx.get_warrant(
    stock='HK.00700',
    sort_field=SortField.TURNOVER,
    ascend=False
)
# 返回：窝轮代码、类型(CALL/PUT/BULL/BEAR)、行权价、到期日、换股比率等
```

---

## 5. 全市场筛选

### 5.1 条件选股

```python
# 简单属性筛选：市值 > 100亿，换手率 > 5%
simple_filter = SimpleFilter()
simple_filter.stock_field = StockField.MARKET_VAL
simple_filter.filter_min = 10000000000
simple_filter.sort = SortDir.DESCEND

simple_filter2 = SimpleFilter()
simple_filter2.stock_field = StockField.TURNOVER_RATE
simple_filter2.filter_min = 5

ret, ls = quote_ctx.get_stock_filter(
    market=Market.US,
    filter_list=[simple_filter, simple_filter2],
    begin=0,
    num=50
)
```

**四种筛选条件类型：**

#### SimpleFilter（简单属性）

| 字段 | 说明 |
|------|------|
| `stock_field` | StockField 枚举（见下表） |
| `filter_min` / `filter_max` | 范围筛选 |
| `is_no_filter` | 不筛选（仅排序） |
| `sort` | SortDir.ASCEND / DESCEND |

**StockField 常用值：** `CUR_PRICE`（现价）、`CHANGE_RATE`（涨跌幅）、`TURNOVER`（成交额）、`TURNOVER_RATE`（换手率）、`MARKET_VAL`（总市值）、`PE_ANNUAL`/`PE_TTM`（市盈率）、`PB_RATE`（市净率）、`VOLUME_RATIO`（量比）、`BID_ASK_RATIO`（委比）、`AMPLITUDE`（振幅）

#### AccumulateFilter（累积属性）

```python
acc_filter = AccumulateFilter()
acc_filter.stock_field = AccumulateField.CHANGE_RATE  # 累积涨跌幅
acc_filter.filter_min = 10   # 至少涨 10%
acc_filter.days = 5          # 最近 5 天
acc_filter.sort = SortDir.DESCEND
```

**AccumulateField 常用值：** `CHANGE_RATE`、`AMPLITUDE`、`VOLUME`、`TURNOVER`、`TURNOVER_RATE`

#### FinancialFilter（财务属性）

```python
fin_filter = FinancialFilter()
fin_filter.stock_field = FinancialField.NET_PROFIT_GROWTH
fin_filter.filter_min = 20   # 净利润增长 > 20%
fin_filter.quarter = FinancialQuarter.ANNUAL  # 年报
```

**FinancialField 常用值：** `NET_PROFIT`、`NET_PROFIT_GROWTH`、`REVENUE`、`REVENUE_GROWTH`、`ROE`、`ROA`、`GROSS_MARGIN`、`NET_MARGIN`、`DEBT_ASSET_RATIO`、`EPS`

#### PatternFilter（形态技术指标）

```python
pattern_filter = PatternFilter()
pattern_filter.stock_field = PatternField.MA_ALIGNMENT_LONG  # 均线多头排列
pattern_filter.ktype = KLType.K_DAY
```

支持的技术形态：MA/EMA/RSI/MACD/BOLL/KDJ 等指标形态。仅支持 `K_60M`、`K_DAY`、`K_WEEK`、`K_MON` 四种周期。

**限制：** 每 30 秒最多 10 次，单次最多 200 条，累积筛选条件上限 10 个，建议总筛选条件不超过 250 个。

### 5.2 板块相关

```python
# 获取板块集合下的子板块
ret, data = quote_ctx.get_plate_list(Market.US, Plate.INDUSTRY)
# Plate: ALL / INDUSTRY / REGION / CONCEPT / OTHER

# 获取板块内股票
ret, data = quote_ctx.get_plate_stock('US.BK2994')  # 板块代码
```

### 5.3 IPO 列表

```python
ret, data = quote_ctx.get_ipo_list(Market.US)
# 返回：code, name, list_time, ipo_price, ...
```

---

## 6. 个性化功能

### 6.1 到价提醒

```python
# 设置提醒
ret, data = quote_ctx.set_price_reminder(
    code='US.AAPL',
    op=SetPriceReminderOp.ADD,
    reminder_type=PriceReminderType.PRICE_UP,
    reminder_freq=PriceReminderFreq.ALWAYS,
    value=260.0
)

# 获取提醒列表
ret, data = quote_ctx.get_price_reminder(code='US.AAPL')
```

### 6.2 自选股管理

```python
# 获取分组
ret, data = quote_ctx.get_user_security_group(group_type=UserSecurityGroupType.ALL)

# 获取分组内股票
ret, data = quote_ctx.get_user_security(group_name='MyGroup')

# 修改自选股
ret, data = quote_ctx.modify_user_security(
    group_name='MyGroup',
    op=ModifyUserSecurityOp.ADD,
    code_list=['US.AAPL']
)
```

---

## 7. 频率限制速查表

| 接口 | 限制 |
|------|------|
| `get_market_snapshot` | 60 次 / 30 秒，单次 ≤ 400 只 |
| `request_history_kline` | 60 次 / 30 秒 |
| `get_option_chain` | 10 次 / 30 秒 |
| `get_stock_filter` | 10 次 / 30 秒 |
| `get_capital_flow` | 30 次 / 30 秒 |
| `get_referencestock_list` | 10 次 / 30 秒（窝轮无限制） |
| 订阅推送 | 无频率限制，受订阅额度限制 |

---

## 8. 通用枚举参考

### Market（市场）

| 枚举值 | 说明 |
|--------|------|
| `Market.HK` | 港股 |
| `Market.US` | 美股 |
| `Market.SH` | 沪市 |
| `Market.SZ` | 深市 |

### SecurityType（证券类型）

| 枚举值 | 说明 |
|--------|------|
| `SecurityType.STOCK` | 股票 |
| `SecurityType.IDX` | 指数 |
| `SecurityType.ETF` | ETF |
| `SecurityType.WARRANT` | 窝轮 |
| `SecurityType.BOND` | 债券 |
| `SecurityType.DRVT` | 期权 |
| `SecurityType.FUTURE` | 期货 |

### RetType（返回码）

| 枚举值 | 值 | 说明 |
|--------|----|------|
| `RET_OK` | 0 | 成功 |
| `RET_ERROR` | -1 | 失败 |
| `RET_TIMEOUT` | -100 | 超时 |

### ProgramStatusType（程序状态）

| 值 | 说明 |
|----|------|
| `READY` | 就绪，可正常使用 |
| `LOADING` | 正在初始化 |
| `NEED_PIC_VERIFY_CODE` | 需要图形验证码 |
| `NEED_PHONE_VERIFY_CODE` | 需要手机验证码 |
| `LOGIN_FAILED` | 登录失败 |

---

## 9. 典型用法示例

### 9.1 获取美股期权链 + 快照

```python
from futu import *

quote_ctx = OpenQuoteContext(host='127.0.0.1', port=11111)

# 1. 获取期权到期日
ret, exp_dates = quote_ctx.get_option_expiration_date('US.AAPL')
print("到期日列表:", exp_dates['strike_time'].tolist())

# 2. 获取最近一期期权链
nearest = exp_dates['strike_time'].values[0]
ret, chain = quote_ctx.get_option_chain(
    code='US.AAPL',
    start=nearest,
    end=nearest
)
print("期权数量:", len(chain))

# 3. 取前10个期权的快照
codes = chain['code'].tolist()[:10]
ret, snap = quote_ctx.get_market_snapshot(codes)
print(snap[['code', 'last_price', 'volume', 'turnover']])

quote_ctx.close()
```

### 9.2 实时行情订阅 + 推送

```python
from futu import *

class QuoteHandler(StockQuoteHandlerBase):
    def on_recv_rsp(self, rsp_pb):
        ret, data = super().on_recv_rsp(rsp_pb)
        if ret == RET_OK:
            print(data[['code', 'last_price', 'volume']])
        return RET_OK, data

quote_ctx = OpenQuoteContext(host='127.0.0.1', port=11111)
quote_ctx.set_handler(QuoteHandler())
quote_ctx.subscribe(['US.AAPL'], [SubType.QUOTE], subscribe_push=True)

# 保持运行接收推送
import time
time.sleep(60)
quote_ctx.close()
```

### 9.3 条件选股：美股大市值高换手

```python
from futu import *

quote_ctx = OpenQuoteContext(host='127.0.0.1', port=11111)

f1 = SimpleFilter()
f1.stock_field = StockField.MARKET_VAL
f1.filter_min = 50000000000  # 500亿美元以上
f1.sort = SortDir.DESCEND

f2 = SimpleFilter()
f2.stock_field = StockField.TURNOVER_RATE
f2.filter_min = 3  # 换手率 > 3%

ret, data = quote_ctx.get_stock_filter(
    market=Market.US,
    filter_list=[f1, f2],
    num=20
)
if ret == RET_OK:
    print(data[['stock_code', 'stock_name', 'cur_price', 'change_rate', 'market_val', 'turnover_rate']])

quote_ctx.close()
```
