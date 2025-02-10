import json
import logging
from pathlib import Path
from longport.openapi import Config, QuoteContext, TradeContext, SubType
from data.market_data import MarketDataManager
from strategies.strategy_manager import StrategyManager
from trading.trading_executor import TradingExecutor
from risk_management.risk_controller import RiskController
from notification.email_notifier import EmailNotifier
from datetime import datetime
import time

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class TradingSystem:
    def __init__(self):
        self.config = self._load_configs()
        logger.info(f"加载的交易配置: {self.config.get('trading', {})}")  # 添加配置日志
        self.market_data = MarketDataManager(self.config['database'])
        self.market_data.init_connection()
        
        # 从数据库获取API配置
        api_config = self.market_data.get_api_config()
        self.longport_config = Config(
            app_key=api_config['app_key'],
            app_secret=api_config['app_secret'],
            access_token=api_config['access_token']
        )
        
        # 初始化其他组件
        self.quote_ctx = QuoteContext(self.longport_config)
        self.trade_ctx = TradeContext(self.longport_config)
        self.market_data.set_quote_context(self.quote_ctx)
        self.risk_controller = RiskController(self.config['risk'])
        self.email_notifier = EmailNotifier(self.config['email'])
        self.trading_executor = TradingExecutor(
            self.trade_ctx,
            self.quote_ctx,  # 添加这行
            self.risk_controller,
            self.email_notifier,
            self.config['trading']
        )
        self.strategy_manager = StrategyManager(
            self.market_data,
            self.trading_executor
        )

    def _load_configs(self):
        """加载所有配置文件"""
        config_dir = Path("configs")
        configs = {}
        
        config_files = {
            'database': 'database_config.json',
            'email': 'email_config.json',
            'trading': 'trading_config.json',
            'risk': 'risk_config.json'
        }
        
        for key, filename in config_files.items():
            with open(config_dir / filename, 'r') as f:
                configs[key] = json.load(f)
        
        return configs

    def start(self):
        """启动交易系统"""
        logger.info("启动交易系统...")
        try:
            # 订阅行情
            symbols = []
            for pool in self.config['trading']['stock_pools'].values():
                symbols.extend(pool)
            
            logger.info(f"正在订阅股票: {symbols}")
            
            # 设置行情回调
            self.quote_ctx.set_on_quote(self._on_quote_callback)
            
            # 订阅股票的实时行情
            self.quote_ctx.subscribe(symbols, [SubType.Quote])
            
            # 启动策略管理器
            self.strategy_manager.start()
            
            logger.info("交易系统启动成功")
            
            # 保持程序运行，添加优雅退出机制
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                logger.info("接收到退出信号，正在关闭交易系统...")
                # 清理订阅
                self.quote_ctx.unsubscribe(symbols, [SubType.Quote])
                logger.info("交易系统已安全退出")
            
        except Exception as e:
            logger.error(f"系统启动失败: {str(e)}")
            self.email_notifier.send_alert("交易系统启动失败", str(e))
            raise

    def _on_quote_callback(self, symbol: str, quote: dict):
        """行情数据回调处理"""
        try:
            # 创建quote的副本，避免在迭代过程中修改原字典
            quote_copy = {
                'symbol': symbol,
                'last_done': quote.last_done,
                'open': quote.open,
                'high': quote.high,
                'low': quote.low,
                'timestamp': quote.timestamp,
                'volume': quote.volume,
                'turnover': quote.turnover,
                'trade_status': quote.trade_status
            }
            
            # 转发行情数据给策略管理器
            self.strategy_manager.on_quote_update(symbol, quote_copy)
            
        except Exception as e:
            logger.error(f"处理行情数据失败 {symbol}: {str(e)}")

    def refresh_token(self):
        """刷新访问令牌"""
        try:
            # 调用长桥SDK的刷新token接口
            new_token = self.longport_config.refresh_token()
            
            # 更新数据库中的token信息
            self.market_data.update_access_token(
                account_type='SIMULATION',  # 或 'REAL'
                access_token=new_token['access_token'],
                expire_time=datetime.fromtimestamp(new_token['expire_time'])
            )
            
            logger.info("访问令牌刷新成功")
            
        except Exception as e:
            logger.error(f"刷新访问令牌失败: {str(e)}")
            self.email_notifier.send_alert("Token刷新失败", str(e))

if __name__ == "__main__":
    system = TradingSystem()
    system.start()