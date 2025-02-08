from abc import ABC, abstractmethod
from typing import Dict, List
from data.market_data import MarketDataManager
from trading.trading_executor import TradingExecutor

class BaseStrategy(ABC):
    """策略基类"""
    
    def __init__(
        self,
        market_data: MarketDataManager,
        trading_executor: TradingExecutor,
        config: Dict
    ):
        self.market_data = market_data
        self.trading_executor = trading_executor
        self.config = config
        
    @abstractmethod
    def generate_signals(self, symbols: List[str]) -> Dict:
        """生成交易信号
        
        Args:
            symbols: 股票代码列表
            
        Returns:
            交易信号字典 {symbol: signal}
            signal为1代表买入,-1代表卖出,0代表持仓不变
        """
        pass
        
    @abstractmethod
    def on_quote_update(self, symbol: str, quote: Dict):
        """行情更新回调
        
        Args:
            symbol: 股票代码
            quote: 行情数据
        """
        pass 