import logging
from typing import Dict, List
from longport.openapi import Period, CalcIndex, AdjustType
from .base_strategy import BaseStrategy

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
                    adjust_type=AdjustType.Forward
                )
                
                # 获取RSI指标数据
                indicators = self.market_data.get_technical_indicators(
                    symbol=symbol,
                    indicators=[CalcIndex.RSI]
                )
                
                rsi = indicators.get('RSI', 50)
                
                # 生成交易信号
                if rsi < self.oversold and self.signals.get(symbol, 0) >= 0:
                    # RSI进入超卖区间，产生买入信号
                    signals[symbol] = 1
                elif rsi > self.overbought and self.signals.get(symbol, 0) <= 0:
                    # RSI进入超买区间，产生卖出信号
                    signals[symbol] = -1
                else:
                    # 保持当前持仓
                    signals[symbol] = 0
                    
                # 更新信号状态
                self.signals[symbol] = signals[symbol]
                
            except Exception as e:
                logger.error(f"生成RSI信号失败 {symbol}: {str(e)}")
                signals[symbol] = 0
                
        return signals
        
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
                self.trading_executor.execute_signal(symbol, signal, quote)
                
        except Exception as e:
            logger.error(f"处理行情更新失败 {symbol}: {str(e)}") 