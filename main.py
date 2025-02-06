import json
from core.trading_system import TradingSystem
from core.strategy import TradingStrategy
from core.data_collector import DataCollector
from core.trader import AutoTrader
from utils.logger import DBLogger
import time
from core.models.signal import TradeSignal
from datetime import datetime
from utils.market_time import MarketTime
import logging
import os

def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    return logging.getLogger(__name__)

def load_config(config_dir='configs'):
    """加载所有配置文件"""
    config = {}
    
    # 加载数据库配置
    with open(f'{config_dir}/database_config.json', 'r', encoding='utf-8') as f:
        config['DATABASE'] = json.load(f)
    
    # 加载交易配置
    trading_config_path = os.path.join(config_dir, 'trading_config.json')
    if os.path.exists(trading_config_path):
        with open(trading_config_path, 'r') as f:
            trading_config = json.load(f)
            config.update(trading_config)
    
    # 加载风险配置
    with open(f'{config_dir}/risk_config.json', 'r', encoding='utf-8') as f:
        config['RISK'] = json.load(f)
    
    # 加载邮件配置
    with open(f'{config_dir}/email_config.json', 'r', encoding='utf-8') as f:
        config['EMAIL'] = json.load(f)
    
    return config

def main():
    logger = setup_logging()
    ts = TradingSystem()
    market_time = MarketTime()
    
    try:
        while True:
            try:
                # 获取市场数据
                if not ts.symbols:
                    logger.warning("交易标的列表为空，请检查配置")
                    time.sleep(60)
                    continue
                    
                logger.debug(f"准备获取以下标的的市场数据: {ts.symbols}")
                market_data = ts.get_market_data(ts.symbols)
                
                if not market_data:
                    logger.warning("未获取到市场数据，等待下次尝试...")
                    time.sleep(60)  # 等待1分钟后重试
                    continue
                
                # 执行策略
                signals = ts.execute_strategy(market_data)
                if signals:
                    # 执行交易
                    ts.execute_trades(signals)
                
                # 更新持仓信息
                ts.update_positions()
                
                # 风险检查
                ts.check_risk()
                
                # 等待下一个周期
                time.sleep(ts.config.get('interval', 60))
                
            except Exception as e:
                logger.error(f"循环中发生错误: {str(e)}")
                time.sleep(60)  # 发生错误时等待1分钟
                
    except KeyboardInterrupt:
        logger.info("程序被用户中断")
        ts.cleanup()

if __name__ == "__main__":
    main()
