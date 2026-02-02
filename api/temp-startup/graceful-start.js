const fs = require('fs');
const path = require('path');

// 首先尝试检查 longport 模块是否可以加载
let longportAvailable = false;

try {
  // 检查 longport 模块是否存在
  require.resolve('longport');
  console.log('检测到 longport 模块，尝试加载...');
  
  // 尝试加载 longport
  const { AccountType, Channel, Decimal, SubType, TimeInForceType, TriggerType, OrderSide, OrderType, OrderStatus, PushCandlestickMode, Period, AdjustType, Market, SecurityBoard, calcPosition, calculatePosition, calculateProfitAndLoss, formatDecimal, parseDecimal, isMarketOpen, isTodayHoliday, nextTradeDay, prevTradeDay, nextTradeTime, prevTradeTime, TradeDirection, TradeSession, TradingDateType, TradingSession, WarrantType, SecurityStaticInfo, PriceLevel, SecurityDepth, TradingSessionInfo, Candlestick, Subscription, Trade, PushQuote, PushDepth, PushTrades, PushCandlestick, CompanyAct, CompanyAction, OptionDirection, OptionType, SecurityBoardEx, WarrantStatus, WarrantCategory, Greek, OptionChainQuote, OptionQuote, WarrantQuote, FundPositionChannel, FundPosition, StockPositionChannel, StockPosition, BalanceType, CashFlowType, CashFlow, FundPositionInfo, StockPositionInfo, AccountBalance, MarginRatio, MarginState, Order, ReplaceOrder, SubmitOrder, symbol, quote, trade, openapi, Condition, LongPortError, ErrorCode, initLogger, setLogLevel, setLogFile } = require('longport');

  // 如果能成功访问模块，则说明可以正常使用
  console.log('longport 模块加载成功');
  longportAvailable = true;
} catch (error) {
  console.warn('longport 模块加载失败，将以无券商模式启动:', error.message);
  console.log('这通常是由于系统库版本不兼容导致的，服务将继续启动但无法连接券商接口');
}

// 设置一个环境变量标记 longport 是否可用
process.env.LONGPORT_AVAILABLE = longportAvailable.toString();

// 现在启动主要的应用程序
require('../dist/server.js');
