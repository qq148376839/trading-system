import logging
from typing import Dict, List
from longport.openapi import Period, AdjustType
from .base_strategy import BaseStrategy
import pandas as pd

logger = logging.getLogger(__name__)


class RSIStrategy(BaseStrategy):
    """RSI策略实现"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # 从配置中读取RSI参数
        self.rsi_period = self.config.get('rsi_period', 14)
        self.overbought = self.config.get('overbought', 70)
        self.oversold = self.config.get('oversold', 30)
        self.signals = {}  # 存储每个股票的当前信号

    def generate_signals(self, symbols: List[str]) -> Dict:
        """生成RSI交易信号

        Args:
            symbols: 股票代码列表

        Returns:
            交易信号字典 {symbol: signal}
        """
        signals = {}

        for symbol in symbols:
            try:
                # 获取历史K线数据
                klines = self.market_data.get_history_candlesticks(
                    symbol=symbol,
                    period=Period.Day,
                    count=100,
                    adjust_type=AdjustType.ForwardAdjust
                )

                # 将K线数据转换为DataFrame
                df = pd.DataFrame([{
                    'timestamp': k.timestamp,
                    'close': k.close,
                } for k in klines])

                # 计算RSI指标
                current_rsi = self._calculate_rsi(df['close'], self.rsi_period)

                # 生成交易信号
                if current_rsi < self.oversold and self.signals.get(symbol, 0) >= 0:
                    signals[symbol] = 1
                elif current_rsi > self.overbought and self.signals.get(symbol, 0) <= 0:
                    signals[symbol] = -1
                else:
                    signals[symbol] = 0

                # 更新信号状态
                self.signals[symbol] = signals[symbol]

            except Exception as e:
                logger.error(f"生成RSI信号失败 {symbol}: {str(e)}")
                signals[symbol] = 0

        return signals

    def _calculate_rsi(self, prices: pd.Series, period: int) -> float:
        """计算RSI指标

        Args:
            prices: 价格序列
            period: RSI周期

        Returns:
            当前RSI值
        """
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        return rsi.iloc[-1]

    def on_quote_update(self, symbol: str, quote: Dict):
        """实时行情更新回调

        Args:
            symbol: 股票代码
            quote: 行情数据
        """
        try:
            # 重新计算信号
            signal = self.generate_signals([symbol])[symbol]

            # 如果产生新的交易信号，执行交易
            if signal != 0:
                self.trading_executor.execute_trade(symbol=symbol,
                                                    signal=signal,
                                                    price=quote.get('last_done', 0))

        except Exception as e:
            logger.error(f"处理行情更新失败 {symbol}: {str(e)}")
