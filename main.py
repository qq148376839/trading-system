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

def load_config(config_dir='configs'):
    """加载所有配置文件"""
    config = {}
    
    # 加载数据库配置
    with open(f'{config_dir}/database_config.json', 'r', encoding='utf-8') as f:
        config['DATABASE'] = json.load(f)
    
    # 加载交易配置
    with open(f'{config_dir}/trading_config.json', 'r', encoding='utf-8') as f:
        config.update(json.load(f))
    
    # 加载风险配置
    with open(f'{config_dir}/risk_config.json', 'r', encoding='utf-8') as f:
        config['RISK'] = json.load(f)
    
    # 加载邮件配置
    with open(f'{config_dir}/email_config.json', 'r', encoding='utf-8') as f:
        config['EMAIL'] = json.load(f)
    
    return config

def main():
    ts = TradingSystem()
    market_time = MarketTime()
    
    while True:
        try:
            # 按市场分组处理股票
            us_stocks = [s for s in ts.stock_pools if s.endswith('.US')]
            hk_stocks = [s for s in ts.stock_pools if s.endswith('.HK')]
            
            # 处理美股
            if any(market_time.is_market_open(s) for s in us_stocks):
                for stock in us_stocks:
                    if market_time.is_market_open(stock):
                        # 处理美股交易逻辑
                        process_stock(ts, stock)
            
            # 处理港股
            if any(market_time.is_market_open(s) for s in hk_stocks):
                for stock in hk_stocks:
                    if market_time.is_market_open(stock):
                        # 处理港股交易逻辑
                        process_stock(ts, stock)
            
            # 如果所有市场都休市，等待最近的开市时间
            if not any(market_time.is_market_open(s) for s in ts.stock_pools):
                next_opens = [
                    market_time.get_next_market_open(s) 
                    for s in ts.stock_pools
                ]
                next_open = min(t for t in next_opens if t is not None)
                wait_time = (next_open - datetime.now(next_open.tzinfo)).seconds
                print(f"所有市场休市中，等待下一个交易时段: {next_open}")
                time.sleep(min(wait_time, 300))  # 最多等待5分钟
            
            time.sleep(10)  # 基础轮询间隔
            
        except Exception as e:
            ts.logger.error("MAIN", f"主循环发生错误: {str(e)}")
            time.sleep(60)

if __name__ == "__main__":
    main()
