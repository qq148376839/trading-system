import logging
from typing import Dict, List
from data.market_data import MarketDataManager
from trading.trading_executor import TradingExecutor
from .macd_strategy import MACDStrategy
from .rsi_strategy import RSIStrategy
from .lstm_strategy import LSTMStrategy

logger = logging.getLogger(__name__)

class StrategyManager:
    """策略管理器"""
    
    def __init__(
        self,
        market_data: MarketDataManager,
        trading_executor: TradingExecutor
    ):
        self.market_data = market_data
        self.trading_executor = trading_executor
        self.strategies = {}
        
    def add_strategy(self, name: str, strategy_class, config: Dict):
        """添加策略
        
        Args:
            name: 策略名称
            strategy_class: 策略类
            config: 策略配置
        """
        try:
            strategy = strategy_class(
                self.market_data,
                self.trading_executor,
                config
            )
            self.strategies[name] = strategy
            logger.info(f"添加策略成功: {name}")
        except Exception as e:
            logger.error(f"添加策略失败 {name}: {str(e)}")
            
    def remove_strategy(self, name: str):
        """移除策略"""
        if name in self.strategies:
            del self.strategies[name]
            logger.info(f"移除策略: {name}")
            
    def start(self):
        """启动所有策略"""
        logger.info("启动策略管理器...")
        
        try:
            # 获取交易配置中的股票池
            trading_config = self.trading_executor.trade_config
            stock_pools = trading_config.get('stock_pools', {})
            
            logger.info(f"加载的股票池配置: {stock_pools}")  # 添加日志
            
            if not stock_pools:
                logger.warning("未找到有效的股票池配置")
                return
            
            # 添加默认策略
            self.add_strategy("MACD", MACDStrategy, {
                "fast_period": 12,
                "slow_period": 26,
                "signal_period": 9,
                "stock_pools": stock_pools
            })
            
            self.add_strategy("RSI", RSIStrategy, {
                "rsi_period": 14,
                "overbought": 70,
                "oversold": 30,
                "stock_pools": stock_pools
            })
            
            # 添加LSTM策略
            lstm_config = {
                "lstm_strategy": {
                    "lookback_period": 20,
                    "prediction_period": 5,
                    "batch_size": 32,
                    "epochs": 100,
                    "lstm_units": [64, 32, 16],
                    "dropout_rate": 0.2,
                    "learning_rate": 0.001,
                    "model_path": "models/lstm_model",
                    "scaler_path": "models/feature_scaler.pkl",
                    "stock_pools": stock_pools
                },
                "stock_pools": stock_pools
            }
            
            logger.info(f"LSTM策略配置: {lstm_config}")  # 添加日志
            self.add_strategy("LSTM", LSTMStrategy, lstm_config)
            
        except Exception as e:
            logger.error(f"启动策略管理器失败: {str(e)}")
            raise
        
    def on_quote_update(self, symbol: str, quote: Dict):
        """处理行情更新"""
        for strategy in self.strategies.values():
            strategy.on_quote_update(symbol, quote) 