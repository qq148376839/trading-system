import json
from core.trading_system import TradingSystem
import time
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
    required_configs = {
        'database_config.json': 'DATABASE',
        'trading_config.json': None,
        'risk_config.json': 'RISK',
        'email_config.json': 'EMAIL'
    }
    
    for config_file, config_key in required_configs.items():
        file_path = os.path.join(config_dir, config_file)
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if config_key:
                    config[config_key] = data
                else:
                    config.update(data)
        except FileNotFoundError:
            raise FileNotFoundError(f"配置文件未找到: {file_path}")
        except json.JSONDecodeError:
            raise ValueError(f"配置文件格式错误: {file_path}")
    
    return config

def main():
    logger = setup_logging()
    
    try:
        # 初始化配置
        config = load_config()
        ts = TradingSystem(config)
        market_time = MarketTime()
        
        while True:
            try:
                # 检查是否在交易时间
                if not market_time.is_trading_time():
                    logger.info("当前不在交易时间，等待下一个交易时段")
                    time.sleep(300)  # 5分钟检查一次
                    continue
                
                # 检查交易标的
                if not ts.symbols:
                    logger.error("交易标的列表为空，请检查配置")
                    time.sleep(300)
                    continue
                
                # 获取市场数据
                logger.debug(f"准备获取以下标的的市场数据: {ts.symbols}")
                market_data = ts.get_market_data(ts.symbols)
                
                if not market_data:
                    logger.warning("未获取到市场数据，等待下次尝试...")
                    time.sleep(60)
                    continue
                
                # 执行策略和交易
                signals = ts.execute_strategy(market_data)
                if signals:
                    ts.execute_trades(signals)
                
                # 更新持仓和风险检查
                ts.update_positions()
                risk_results = ts.check_risk_limits(ts.symbols, market_data)
                
                # 处理风险警告
                if risk_results:
                    ts.handle_risk_warnings(risk_results)
                
                time.sleep(ts.config.get('interval', 60))
                
            except Exception as e:
                logger.error(f"循环中发生错误: {str(e)}", exc_info=True)
                time.sleep(60)
                
    except (KeyboardInterrupt, SystemExit):
        logger.info("正在关闭交易系统...")
        ts.cleanup()
        logger.info("交易系统已安全关闭")

if __name__ == "__main__":
    main()
