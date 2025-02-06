import json
from core.trading_system import TradingSystem
from core.strategy import TradingStrategy
from core.data_collector import DataCollector
from core.trader import AutoTrader
from utils.logger import DBLogger
import time
from core.models.signal import TradeSignal

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
    # 加载所有配置
    config = load_config()
    
    # 初始化交易系统，传入配置
    trading_system = TradingSystem(config=config)
    
    # 初始化数据收集器
    collector = DataCollector(trading_system)
    
    # 初始化策略
    strategy = TradingStrategy(trading_system)
    
    # 初始化自动交易器
    trader = AutoTrader(trading_system)
    
    try:
        while True:  # 添加循环来持续监控市场
            # 收集所有股票池中的数据
            stock_pools = config['stock_pools']
            all_symbols = []
            for pool_name, symbols in stock_pools.items():
                all_symbols.extend(symbols)
            
            # 检查当前是否是交易时段
            for symbol in all_symbols:
                market = symbol.split('.')[-1]  # 获取市场标识 (US/HK)
                if not trader.is_trading_time(market):
                    trading_system.logger.info("MAIN", f"{market}市场当前不在交易时段，跳过{symbol}的交易")
                    continue
                
                # 收集单个股票的市场数据
                collector.collect_market_data([symbol])
                market_data = collector.get_market_data([symbol])
                
                # 获取账户资金情况
                account_balance = trader.get_account_balance()
                
                # 分析市场并获取交易信号
                signals = strategy.analyze_market([symbol], 
                                               market_data=market_data,
                                               account_balance=account_balance)
                
                # 执行交易
                for signal in signals:
                    trading_system.logger.debug("MAIN", f"准备执行交易信号，类型: {type(signal)}，内容: {signal}")
                    trade_result = trader.execute_trade(signal)
                    
                    if not trade_result.success:
                        trading_system.logger.warning("TRADE", 
                            f"交易执行失败: {signal}, 原因: {trade_result.message}")
            
            # 休眠一段时间再进行下一轮检查
            time.sleep(config.get('check_interval', 60))  # 默认60秒检查一次
                
    except Exception as e:
        trading_system.logger.error("MAIN", f"运行时发生错误: {str(e)}")
        import traceback
        trading_system.logger.error("MAIN", f"错误详情:\n{traceback.format_exc()}")
    finally:
        trading_system.cleanup()

if __name__ == "__main__":
    main()
