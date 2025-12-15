Title: Longbridge OpenAPI：灵活支持程序化交易

URL Source: https://open.longbridge.com/zh-CN/docs/quote/pull/history-candlestick

Markdown Content:
获取标的历史 K 线
----------

该接口用于获取标的的历史 K 线数据。

ℹ️Info

Request [​](https://open.longbridge.com/zh-CN/docs/quote/pull/history-candlestick#request)
------------------------------------------------------------------------------------------

### Parameters [​](https://open.longbridge.com/zh-CN/docs/quote/pull/history-candlestick#parameters)

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| symbol | string | 是 | 标的代码，使用 `ticker.region` 格式，例如：`700.HK` |
| period | int32 | 是 | k 线周期，例如：`1000`，详见 [Period](https://open.longbridge.com/zh-CN/docs/quote/objects#period-k-%E7%BA%BF%E5%91%A8%E6%9C%9F) |
| adjust_type | int32 | 是 | 复权类型，例如：`0`，详见 [AdjustType](https://open.longbridge.com/zh-CN/docs/quote/objects#adjusttype-k-%E7%BA%BF%E5%A4%8D%E6%9D%83%E7%B1%BB%E5%9E%8B) |
| query_type | int32 | 是 | 查询方式 **可选值：** `1` - 按偏移查询 `2` - 按日期区间查询 |
| date_request | object | 否 | 按日期查询时必填 |
| ∟ start_date | string | 否 | 开始日期，格式为 `YYYYMMDD`，例如：20231016 **参数说明：** 1. start_date 和 end_date 均不填：返回最新的 1000 根 K 线； 2. 仅填 start_date：返回 start_date 与最新交易日区间内的 K 线。若此区间内 K 线超过 1000 根，则优先返回靠近 start_date 的 1000 根 K 线； 3. 仅填 end_date：返回 end_date 及以前的 1000 根 K 线； 4. start_date 和 end_date 均填：返回此区间内的 K 线数据。若此区间内 K 线超过 1000 根，则优先返回靠近 end_date 的 1000 根 K 线 |
| ∟ end_date | string | 否 | 结束日期，格式为 `YYYYMMDD`，例如：20231016 |
| offset_request | object | 否 | 按偏移查询时必填 |
| ∟ direction | int32 | 是 | 查询方向 **可选值：** `0` - 向历史数据方向查找 `1` - 向最新数据方向查找 |
| ∟ date | string | 否 | 查询日期，格式为 `YYYYMMDD`，例如：20231016，为空时使用标的所在市场的最新交易日 |
| ∟ minute | string | 否 | 查询时间，格式为 `HHMM`，例如：09:35，仅在查询分钟级别 K 线时有效 |
| ∟ count | int32 | 否 | 查询数量，填写范围 `[1,1000]`，为空时默认查询 `10` 条 |
| trade_session | int32 | 否 | 交易時段，0: 盤中，100: 所有延長時段（盤前，盤中，盤後，夜盤） |

### Protobuf [​](https://open.longbridge.com/zh-CN/docs/quote/pull/history-candlestick#protobuf)

protobuf

```
message SecurityHistoryCandlestickRequest {

  message OffsetQuery {
    Direction direction = 1;
    string date = 2;
    string minute = 3;
    int32 count = 4;
  }

  message DateQuery {
    string start_date = 1;
    string end_date = 2;
  }

  string symbol = 1;
  Period period = 2;
  AdjustType adjust_type = 3;
  HistoryCandlestickQueryType query_type = 4;
  OffsetQuery offset_request = 5;
  DateQuery date_request = 6;
}
```

### Request Example [​](https://open.longbridge.com/zh-CN/docs/quote/pull/history-candlestick#request-example)

python

```
# 获取标的历史 K 线
#
# 运行前请访问“开发者中心”确保账户有正确的行情权限。
# 如没有开通行情权限，可以通过“Longbridge”手机客户端，并进入“我的 - 我的行情 - 行情商城”购买开通行情权限。
from datetime import datetime, date
from longport.openapi import QuoteContext, Config, Period, AdjustType

config = Config.from_env()
ctx = QuoteContext(config)

# Query after 2023-01-01
resp = ctx.history_candlesticks_by_offset("700.HK", Period.Day, AdjustType.NoAdjust, True, 10, datetime(2023, 1, 1))
print(resp)

# Query before 2023-01-01
resp = ctx.history_candlesticks_by_offset("700.HK", Period.Day, AdjustType.NoAdjust, False, 10, datetime(2023, 1, 1))
print(resp)

# Query 2023-01-01 to 2023-02-01
resp = ctx.history_candlesticks_by_date("700.HK", Period.Day, AdjustType.NoAdjust, date(2023, 1, 1), date(2023, 2, 1))
print(resp)
```

Response [​](https://open.longbridge.com/zh-CN/docs/quote/pull/history-candlestick#response)
--------------------------------------------------------------------------------------------

### Response Properties [​](https://open.longbridge.com/zh-CN/docs/quote/pull/history-candlestick#response-properties)

| Name | Type | Description |
| --- | --- | --- |
| symbol | string | 标的代码，例如：`AAPL.US` |
| candlesticks | object[] | K 线数据 |
| ∟ close | string | 当前周期收盘价 |
| ∟ open | string | 当前周期开盘价 |
| ∟ low | string | 当前周期最低价 |
| ∟ high | string | 当前周期最高价 |
| ∟ volume | int64 | 当前周期成交量 |
| ∟ turnover | string | 当前周期成交额 |
| ∟ timestamp | int64 | 当前周期的时间戳 |
| ∟ trade_session | int32 | 交易時段，详见 [TradeSession](https://open.longbridge.com/zh-CN/docs/quote/objects#tradesession-%E4%BA%A4%E6%98%93%E6%97%B6%E6%AE%B5) |

### Protobuf [​](https://open.longbridge.com/zh-CN/docs/quote/pull/history-candlestick#protobuf-1)

protobuf

```
message SecurityCandlestickResponse {
  string symbol = 1;
  repeated Candlestick candlesticks = 2;
}

message Candlestick {
  string close = 1;
  string open = 2;
  string low = 3;
  string high = 4;
  int64 volume = 5;
  string turnover = 6;
  int64 timestamp = 7;
}
```

### Response JSON Example [​](https://open.longbridge.com/zh-CN/docs/quote/pull/history-candlestick#response-json-example)

json

```
{
  "symbol": "700.HK",
  "candlesticks": [
    {
      "close": "362.000",
      "open": "364.600",
      "low": "361.600",
      "high": "368.800",
      "volume": 10853604,
      "turnover": "3954556819.000",
      "timestamp": 1650384000
    },
    {
      "close": "348.000",
      "open": "352.000",
      "low": "343.000",
      "high": "356.200",
      "volume": 25738562,
      "turnover": "8981529950.000",
      "timestamp": 1650470400
    },
    {
      "close": "340.600",
      "open": "334.800",
      "low": "334.200",
      "high": "343.000",
      "volume": 28031299,
      "turnover": "9492674293.000",
      "timestamp": 1650556800
    },
    {
      "close": "327.400",
      "open": "332.200",
      "low": "325.200",
      "high": "338.600",
      "volume": 25788422,
      "turnover": "8541441823.000",
      "timestamp": 1650816000
    },
    {
      "close": "335.800",
      "open": "332.200",
      "low": "330.600",
      "high": "341.600",
      "volume": 27288328,
      "turnover": "9166022626.000",
      "timestamp": 1650902400
    }
  ]
}
```

权限说明 [​](https://open.longbridge.com/zh-CN/docs/quote/pull/history-candlestick#%E6%9D%83%E9%99%90%E8%AF%B4%E6%98%8E)
--------------------------------------------------------------------------------------------------------------------

依据用户的资产和交易情况，不同类型的用户每月可查询历史数据的标的数量如下表：

*   额度按照自然月计算，每月初额度加满，上月剩余额度不累计到本月。一个自然月内重复请求同一只标的的历史 K 线，仅统计一次。
*   新入金的账户，额度会在下个交易日自动生效；当账户的总资产或交易笔数增加、且达到更高等级时，额度会在下一个交易日生效。
*   总资产：用户的港股、美股、A 股等证券账户的总资产，按照汇率换算成港元。取用户上个自然月最后一个交易日的总资产与最近一个完整交易日的总资产的较大值。
*   月交易笔数：用户有成交的订单数量，一个订单部分成交、或多次全部成交、或一次全部成交均算 1 笔。取用户上个自然月的成交笔数与当前自然月的成交笔数的较大值。

| 用户类型 | 每月可查询的标的数量上限（只） |
| --- | --- |
| 用户开户 | 100 |
| 总资产达 1 万 HKD | 400 |
| 总资产达 8 万 HKD | 600 |
| 总资产达 40 万 HKD 或 月交易笔数大于 160 笔 | 1000 |
| 总资产达 400 万 HKD 或 月交易笔数大于 1600 笔 | 2000 |
| 总资产达 600 万 HKD 或 月交易笔数大于 2500 笔 | 3000 |

历史 K 线区间说明 [​](https://open.longbridge.com/zh-CN/docs/quote/pull/history-candlestick#%E5%8E%86%E5%8F%B2-k-%E7%BA%BF%E5%8C%BA%E9%97%B4%E8%AF%B4%E6%98%8E)
--------------------------------------------------------------------------------------------------------------------------------------------------------

| 市场 | 日/周/月/年 K 线 | 分钟 K 线 | 说明 |
| --- | --- | --- | --- |
| 港股 | 2004-6-1 至今 | 2022-09-28 至今 |  |
| 美股 | 2010-6-1 至今 | 2023-12-4 至今 |  |
| 美股期权 | - | - | 美股期权历史数据目前暂不支持，待后续开放更长时段的数据 |
| A 股 | 1999-11-1 至今 | 2022-08-25 至今 |  |

频次限制 [​](https://open.longbridge.com/zh-CN/docs/quote/pull/history-candlestick#%E9%A2%91%E6%AC%A1%E9%99%90%E5%88%B6)
--------------------------------------------------------------------------------------------------------------------

⚠️Caution

*   每 30 秒内最多请求 60 次历史 K 线接口。

错误码 [​](https://open.longbridge.com/zh-CN/docs/quote/pull/history-candlestick#%E9%94%99%E8%AF%AF%E7%A0%81)
----------------------------------------------------------------------------------------------------------

| 协议错误码 | 业务错误码 | 描述 | 排查建议 |
| --- | --- | --- | --- |
| 3 | 301600 | 无效的请求 | 请求参数有误或解包失败 |
| 3 | 301606 | 限流 | 降低请求频次 |
| 7 | 301602 | 服务端内部错误 | 请重试或联系技术人员处理 |
| 7 | 301600 | 请求数据非法 | 检查请求的 `symbol`，`count`，`adjust_type`, `period` 数据是否在正确范围 |
| 7 | 301603 | 标的无行情 | 标的没有请求的行情数据 |
| 7 | 301604 | 无权限 | 没有获取标的行情的权限 |
| 7 | 301607 | 接口限制 | 超过当月能够查询的标的数量上限 |
