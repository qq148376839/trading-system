import logging
from typing import Dict, List
from longport.openapi import Period, CalcIndex, AdjustType
from .base_strategy import BaseStrategy

logger = logging.getLogger(__name__)

class MACDStrategy(BaseStrategy):
    """MACD策略实现"""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # 从配置中读取MACD参数
        self.fast_period = self.config.get('fast_period', 12)
        self.slow_period = self.config.get('slow_period', 26)
        self.signal_period = self.config.get('signal_period', 9)
        self.signals = {}  # 存储每个股票的当前信号
        
    def generate_signals(self, symbols: List[str]) -> Dict:
        """生成MACD交易信号
        
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
                    count=100,  # 获取足够的历史数据计算MACD
                    adjust_type=AdjustType.Forward
                )
                
                # 获取MACD指标数据
                indicators = self.market_data.get_technical_indicators(
                    symbol=symbol,
                    indicators=[
                        CalcIndex.MACD,
                        CalcIndex.MACD_SIGNAL,
                        CalcIndex.MACD_HIST
                    ]
                )
                
                # 解析MACD值
                macd = indicators.get('MACD', 0)
                signal = indicators.get('MACD_SIGNAL', 0)
                hist = indicators.get('MACD_HIST', 0)
                
                # 生成交易信号
                if hist > 0 and self.signals.get(symbol, 0) <= 0:
                    # MACD柱状图由负转正，产生买入信号
                    signals[symbol] = 1
                elif hist < 0 and self.signals.get(symbol, 0) >= 0:
                    # MACD柱状图由正转负，产生卖出信号
                    signals[symbol] = -1
                else:
                    # 保持当前持仓
                    signals[symbol] = 0
                    
                # 更新信号状态
                self.signals[symbol] = signals[symbol]
                
            except Exception as e:
                logger.error(f"生成MACD信号失败 {symbol}: {str(e)}")
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