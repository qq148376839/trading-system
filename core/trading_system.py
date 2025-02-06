from utils.logger import DBLogger
from utils.risk_manager import RiskManager
from utils.notifier import EmailNotifier
from longport.openapi import Config as LongPortConfig, QuoteContext, TradeContext, SubType
import mysql.connector
import os
import json
from datetime import datetime, timedelta
from core.token_manager import TokenManager
import time
import logging
from core.strategy import TradingStrategy
from core.data_collector import DataCollector
from core.config import ConfigManager
from decimal import Decimal
from typing import Dict, Optional, List

class TradingSystem:
    """
    交易系统核心类
    负责初始化和管理所有交易相关的组件，包括数据库连接、日志记录、风险管理、通知系统等
    
    属性:
        config: 全局配置对象
        db: 数据库连接
        logger: 日志记录器
        risk_manager: 风险管理器
        notifier: 通知管理器
        use_simulation: 是否使用模拟交易
        longport_config: 长桥接口配置
        quote_ctx: 行情上下文
        trade_ctx: 交易上下文
        stock_pools: 股票池列表
        stop_loss: 止损比例
        take_profit: 止盈比例
        symbols: 交易标的列表
        strategy: 交易策略对象
        positions: 持仓信息字典
    """
    
    def __init__(self, use_simulation=True):
        """
        初始化交易系统
        
        Args:
            use_simulation (bool): 是否使用模拟交易
        """
        try:
            self.use_simulation = use_simulation
            
            # 初始化配置管理器
            self.config_manager = ConfigManager()
            
            # 初始化数据库连接
            self.db = self._init_database()
            
            # 初始化日志系统
            self.logger = DBLogger(self.db)
            self.logger.info("INIT", "开始初始化交易系统...")
            
            # 初始化长桥API配置
            self.longport_config = self._init_trading_config()
            
            # 初始化交易上下文
            self.quote_ctx = QuoteContext(self.longport_config)
            self.trade_ctx = TradeContext(self.longport_config)
            
            # 初始化其他组件
            self.token_manager = TokenManager(self)
            self.risk_manager = RiskManager(self)
            self.notifier = EmailNotifier(self.config_manager.get('email'))
            
            # 初始化交易相关配置
            self._init_trading_params()
            
            self.logger.info("INIT", "交易系统初始化完成")
            
        except Exception as e:
            if hasattr(self, 'logger'):
                self.logger.error("INIT", f"初始化交易系统时发生错误: {str(e)}")
            raise
        
    def _init_database(self):
        """
        初始化数据库连接
        
        返回:
            mysql.connector.connection.MySQLConnection: 数据库连接对象
        """
        try:
            db_config = self.config_manager.get('database')
            return mysql.connector.connect(**db_config)
        except Exception as e:
            raise Exception(f"初始化数据库连接失败: {str(e)}")
        
    def _init_trading_config(self) -> LongPortConfig:
        """
        初始化交易配置
        从数据库获取并验证API配置信息
        
        返回:
            LongPortConfig: 长桥API配置对象
            
        异常:
            Exception: 当找不到有效的API配置时抛出
        """
        cursor = self.db.cursor(dictionary=True)
        try:
            account_type = 'SIMULATION' if self.use_simulation else 'REAL'
            self.logger.info("INIT", f"正在初始化 {account_type} 交易配置...")
            
            # 获取当前活跃的API配置
            query = """
            SELECT * FROM api_config 
            WHERE account_type = %s 
            AND is_active = TRUE 
            AND expire_time > NOW()
            LIMIT 1
            """
            
            cursor.execute(query, (account_type,))
            config_data = cursor.fetchone()
            
            # 添加调试日志
            if config_data:
                self.logger.info("INIT", f"找到有效的 {account_type} API 配置")
                self.logger.debug("INIT", f"API配置过期时间: {config_data['expire_time']}")
            else:
                # 获取所有相关配置用于调试
                debug_query = "SELECT account_type, is_active, expire_time FROM api_config WHERE account_type = %s"
                cursor.execute(debug_query, (account_type,))
                all_configs = cursor.fetchall()
                
                if all_configs:
                    self.logger.warning("INIT", f"找到 {len(all_configs)} 个 {account_type} 配置，但都不符合条件:")
                    for cfg in all_configs:
                        self.logger.warning("INIT", f"配置状态: active={cfg['is_active']}, expire_time={cfg['expire_time']}")
                else:
                    self.logger.error("INIT", f"数据库中不存在 {account_type} 的API配置")
                
                raise Exception(f"No valid {account_type} API configuration found!")
                
            # 检查token是否即将过期（比如15天内）
            query_expire_soon = """
            SELECT * FROM api_config 
            WHERE account_type = %s 
            AND expire_time <= DATE_ADD(NOW(), INTERVAL 15 DAY)
            AND is_active = TRUE
            """
            cursor.execute(query_expire_soon, (account_type,))
            if cursor.fetchone():
                self.logger.warning("API", f"{account_type} API Token 即将过期，请及时更新!")
                
            return LongPortConfig(
                app_key=config_data['app_key'],
                app_secret=config_data['app_secret'],
                access_token=config_data['access_token']
            )
            
        finally:
            cursor.close() 

    def _init_trading_params(self):
        """初始化交易参数"""
        trading_config = self.config_manager.get('trading')
        self.stock_pools = trading_config.get('stock_pools', {})
        self.trade_params = trading_config.get('trade_params', {})
        
        # 订阅行情
        symbols = [symbol for pool in self.stock_pools.values() for symbol in pool]
        if symbols:
            self.quote_ctx.subscribe(
                symbols=symbols,
                sub_types=[SubType.Quote],
                is_first_push=True
            )
            self.logger.info("MARKET", f"成功订阅 {len(symbols)} 个股票的行情")
            
    def update_trading_config(self):
        """更新交易系统配置"""
        try:
            # 重新初始化API配置
            self.longport_config = self._init_trading_config()
            
            # 重新初始化交易上下文
            self.quote_ctx = QuoteContext(self.longport_config)
            self.trade_ctx = TradeContext(self.longport_config)
            
            self.logger.info("CONFIG", "交易系统配置已更新")
            
        except Exception as e:
            self.logger.error("CONFIG", f"更新交易系统配置失败: {str(e)}")
            raise
            
    def switch_account_type(self, use_simulation=True):
        """切换账户类型（模拟/实盘）"""
        try:
            self.use_simulation = use_simulation
            self.update_trading_config()
            self.logger.info("ACCOUNT", f"已切换至{'模拟' if use_simulation else '实盘'}账户")
        except Exception as e:
            self.logger.error("ACCOUNT", f"切换账户类型失败: {str(e)}")
            raise

    def get_market_data(self, symbols):
        """获取市场数据"""
        try:
            self.logger.debug("MARKET", f"尝试获取行情数据，标的列表: {symbols}")
            
            # 确保 symbols 是字符串列表
            if isinstance(symbols, str):
                symbols = [symbols]
            
            # 使用 realtime_quote 获取实时行情
            market_data = self.quote_ctx.realtime_quote(symbols)
            
            if market_data:
                # 转换为字典格式，方便后续使用
                result = {}
                for quote in market_data:
                    symbol = quote.symbol
                    result[symbol] = {
                        'symbol': symbol,
                        'last_done': float(quote.last_done),
                        'open': float(quote.open),
                        'high': float(quote.high),
                        'low': float(quote.low),
                        'timestamp': quote.timestamp,
                        'volume': int(quote.volume),
                        'turnover': float(quote.turnover)
                    }
                self.logger.debug("MARKET", f"成功获取行情数据: {result}")
                return result
            else:
                self.logger.warning("MARKET", "获取到的行情数据为空")
                return {}
            
        except Exception as e:
            self.logger.error("MARKET", f"获取行情数据时发生错误: {str(e)}", exc_info=True)
            return {}
            
    def update_positions(self):
        """更新持仓信息"""
        try:
            if self.use_simulation:
                return
            
            # 使用长桥SDK获取持仓信息
            positions = self.trade_ctx.stock_positions()
            
            # 更新持仓字典
            self.positions = {}
            for pos in positions:
                self.positions[pos.symbol] = {
                    'symbol': pos.symbol,
                    'quantity': float(pos.quantity),
                    'cost_price': float(pos.avg_price),
                    'market_value': float(pos.market_value),
                    'unrealized_pl': float(pos.unrealized_pl)
                }
            
            self.logger.debug("POSITION", f"更新持仓信息: {self.positions}")
            
        except Exception as e:
            self.logger.error("POSITION", f"更新持仓信息时发生错误: {str(e)}")

    def get_position(self, symbol):
        """获取指定标的的持仓信息"""
        try:
            return self.positions.get(symbol, {
                'symbol': symbol,
                'quantity': 0,
                'cost_price': 0,
                'market_value': 0,
                'unrealized_pl': 0
            })
        except Exception as e:
            self.logger.error("POSITION", f"获取持仓信息时发生错误: {str(e)}")
            return None

    def get_order_count(self, since):
        """获取订单数量"""
        cursor = self.db.cursor()
        try:
            query = "SELECT COUNT(*) FROM orders WHERE created_at >= %s"
            cursor.execute(query, (since,))
            return cursor.fetchone()[0]
        finally:
            cursor.close()
            
    def cleanup(self):
        """清理系统资源"""
        try:
            if hasattr(self.quote_ctx, 'close'):
                self.logger.info("SYSTEM", "正在关闭行情连接...")
                self.quote_ctx.close()
            elif hasattr(self.quote_ctx, 'disconnect'):
                self.logger.info("SYSTEM", "正在关闭行情连接...")
                self.quote_ctx.disconnect()
            else:
                self.logger.warning("SYSTEM", "行情连接对象没有close或disconnect方法")
                
            if self.db:
                self.logger.info("SYSTEM", "正在关闭数据库连接...")
                self.db.close()
                
        except Exception as e:
            self.logger.error("SYSTEM", f"清理资源时发生错误: {str(e)}") 

    def run(self):
        """运行交易系统"""
        try:
            self.logger.info("SYSTEM", "开始运行交易系统...")
            
            # 检查交易标的列表
            if not self.symbols:
                self.logger.warning("SYSTEM", "交易标的列表为空，请检查配置")
                return
            
            self.logger.info("SYSTEM", f"准备交易以下标的: {self.symbols}")
            
            # 检查行情上下文对象的方法
            self.logger.debug("SYSTEM", f"行情上下文类型: {type(self.quote_ctx)}")
            self.logger.debug("SYSTEM", f"行情上下文可用方法: {[method for method in dir(self.quote_ctx) if not method.startswith('_')]}")
            
            while True:
                try:
                    current_time = time.time()
                    self.logger.debug("SYSTEM", f"开始新一轮行情获取，当前时间: {time.strftime('%Y-%m-%d %H:%M:%S')}")
                    
                    try:
                        # 使用批量查询替代单个查询
                        self.logger.debug("MARKET", f"尝试获取行情数据，标的列表: {self.symbols}")
                        market_data = self.quote_ctx.realtime_quote(symbols=self.symbols)
                        self.logger.debug("MARKET", f"成功获取行情数据: {market_data}")
                        
                        if not market_data:
                            self.logger.warning("MARKET", "获取到的行情数据为空")
                            time.sleep(5)
                            continue
                            
                        # 处理每个标的的行情数据
                        for quote_data in market_data:
                            try:
                                symbol = quote_data.symbol
                                self.logger.debug("MARKET", f"处理标的 {symbol} 的行情数据: {quote_data}")
                                
                                # 检查交易间隔
                                last_trade = self.last_trade_time.get(symbol, 0)
                                time_since_last_trade = current_time - last_trade
                                min_interval = self.trade_params.get('min_trade_interval', 300)
                                
                                if time_since_last_trade < min_interval:
                                    self.logger.debug("TRADE", f"{symbol} 距离上次交易时间不足{min_interval}秒，跳过")
                                    continue
                                    
                                # 执行风险检查
                                if self.check_risk_limits(symbol, quote_data):
                                    if hasattr(self, 'strategy') and self.strategy:
                                        if self.strategy.should_trade(quote_data):
                                            self.logger.info("TRADE", f"{symbol} 触发交易信号")
                                            self.execute_trade(symbol, quote_data)
                                            self.last_trade_time[symbol] = current_time
                                    else:
                                        self.logger.error("STRATEGY", "策略对象未初始化")
                                        
                            except Exception as e:
                                self.logger.error("MARKET", f"处理标的 {symbol} 时发生错误: {str(e)}", exc_info=True)
                                continue
                                
                    except Exception as e:
                        self.logger.error("MARKET", f"获取行情数据时发生错误: {str(e)}", exc_info=True)
                        time.sleep(5)
                        continue
                        
                    time.sleep(5)  # 轮询间隔
                    
                except Exception as e:
                    self.logger.error("SYSTEM", f"主循环中发生错误: {str(e)}", exc_info=True)
                    time.sleep(5)
                    
        except KeyboardInterrupt:
            self.logger.info("SYSTEM", "程序被用户中断")
            self.cleanup()

    def check_risk_limits(self, symbol, market_data):
        """检查风险控制限制"""
        try:
            self.logger.debug("RISK", f"开始检查 {symbol} 的风险控制限制")
            
            # 检查止损
            position_loss = self.calculate_position_loss(symbol, market_data)
            self.logger.debug("RISK", f"{symbol} 当前持仓亏损: {position_loss}")
            
            if position_loss <= self.risk_config.get('stop_loss', -0.1):
                self.logger.warning("RISK", f"{symbol} 触发止损限制")
                return False
                
            # 检查日内亏损
            daily_loss = self.calculate_daily_loss()
            self.logger.debug("RISK", f"当前日内总亏损: {daily_loss}")
            
            if daily_loss <= self.risk_config.get('max_daily_loss', -0.05):
                self.logger.warning("RISK", "触发日内最大亏损限制")
                return False
                
            # 检查波动率
            volatility = self.calculate_volatility(market_data)
            self.logger.debug("RISK", f"{symbol} 当前波动率: {volatility}")
            
            if volatility >= self.risk_config.get('volatility_threshold', 0.03):
                self.logger.warning("RISK", f"{symbol} 波动率超过阈值")
                return False
                
            return True
            
        except Exception as e:
            self.logger.error("RISK", f"风险检查出错: {str(e)}", exc_info=True)
            return False 

    def calculate_position_loss(self, symbol, market_data):
        """
        计算持仓亏损
        """
        try:
            self.logger.debug("CALC", f"计算 {symbol} 的持仓亏损")
            self.logger.debug("CALC", f"市场数据: {market_data}")
            
            # 获取当前持仓信息
            position = self.get_position(symbol)
            if not position:
                self.logger.debug("CALC", f"{symbol} 没有持仓")
                return 0
            
            # 从market_data中获取当前价格
            current_price = market_data.last_done
            if not current_price:
                self.logger.warning("CALC", f"无法获取 {symbol} 的当前价格")
                return 0
            
            # 计算损益
            avg_cost = position.get('average_cost', 0)
            if avg_cost == 0:
                self.logger.warning("CALC", f"{symbol} 的平均成本为0")
                return 0
            
            loss_rate = (current_price - avg_cost) / avg_cost
            self.logger.debug("CALC", f"{symbol} 当前亏损率: {loss_rate:.2%}")
            
            return loss_rate
            
        except Exception as e:
            self.logger.error("CALC", f"计算持仓亏损时出错: {str(e)}", exc_info=True)
            return 0

    def calculate_daily_loss(self):
        """
        计算日内总亏损
        """
        try:
            self.logger.debug("CALC", "计算日内总亏损")
            
            # 获取今日所有持仓的市值变化
            total_value = 0
            initial_value = 0
            
            for symbol in self.symbols:
                position = self.get_position(symbol)
                if not position:
                    continue
                
                quantity = position.get('quantity', 0)
                avg_cost = position.get('average_cost', 0)
                
                if quantity == 0 or avg_cost == 0:
                    continue
                
                # 获取当前价格
                try:
                    current_data = self.quote_ctx.realtime_quote([symbol])
                    if not current_data:
                        continue
                    current_price = current_data[0].last_done
                except Exception as e:
                    self.logger.error("CALC", f"获取 {symbol} 当前价格失败: {str(e)}")
                    continue
                
                # 计算市值变化
                current_value = quantity * current_price
                initial_value += quantity * avg_cost
                total_value += current_value
                
            if initial_value == 0:
                return 0
            
            daily_return = (total_value - initial_value) / initial_value
            self.logger.debug("CALC", f"日内收益率: {daily_return:.2%}")
            
            return daily_return
            
        except Exception as e:
            self.logger.error("CALC", f"计算日内亏损时出错: {str(e)}", exc_info=True)
            return 0

    def calculate_volatility(self, market_data):
        """
        计算波动率
        """
        try:
            self.logger.debug("CALC", "计算波动率")
            self.logger.debug("CALC", f"市场数据: {market_data}")
            
            # 从market_data中获取价格信息
            high_price = market_data.high
            low_price = market_data.low
            last_price = market_data.last_done
            
            if not all([high_price, low_price, last_price]):
                self.logger.warning("CALC", "价格数据不完整")
                return 0
            
            # 计算当日波动率
            volatility = (high_price - low_price) / last_price
            self.logger.debug("CALC", f"当前波动率: {volatility:.2%}")
            
            return volatility
            
        except Exception as e:
            self.logger.error("CALC", f"计算波动率时出错: {str(e)}", exc_info=True)
            return 0 

    def execute_strategy(self, market_data):
        """
        执行交易策略
        
        Args:
            market_data: 市场数据字典，格式为 {symbol: market_data_dict}
        
        Returns:
            list: 交易信号列表
        """
        try:
            self.logger.debug("STRATEGY", f"开始执行策略，市场数据: {market_data}")
            signals = []
            
            for symbol, data in market_data.items():
                try:
                    # 检查是否应该交易
                    if self.strategy.should_trade(data):
                        self.logger.info("STRATEGY", f"{symbol} 触发交易信号")
                        
                        # 创建交易信号
                        signal = {
                            'symbol': symbol,
                            'direction': 'BUY',  # 这里可以根据策略结果设置买入或卖出
                            'price': data['last_done'],
                            'quantity': self._calculate_position_size(symbol, data['last_done']),
                            'timestamp': data['timestamp']
                        }
                        
                        # 检查风险限制
                        if self.risk_manager.check_position_risk(
                            symbol, 
                            signal['quantity'], 
                            signal['price']
                        ):
                            signals.append(signal)
                            self.logger.info("STRATEGY", f"添加交易信号: {signal}")
                        else:
                            self.logger.warning("STRATEGY", f"{symbol} 未通过风险检查")
                            
                except Exception as e:
                    self.logger.error("STRATEGY", f"处理 {symbol} 的策略时出错: {str(e)}")
                    continue
                
            return signals
            
        except Exception as e:
            self.logger.error("STRATEGY", f"执行策略时发生错误: {str(e)}")
            return []

    def _calculate_position_size(self, symbol, price):
        """
        计算交易数量
        
        Args:
            symbol: 交易标的
            price: 当前价格
        
        Returns:
            int: 交易数量
        """
        try:
            # 获取账户余额
            balance = float(self.get_account_balance())
            
            # 获取每个标的的最大仓位比例
            max_position = self.config.get('trade_params', {}).get('max_position_per_stock', 0.2)
            
            # 计算最大可用资金
            max_amount = balance * max_position
            
            # 计算可买数量
            quantity = int(max_amount / price)
            
            self.logger.debug("TRADE", f"计算 {symbol} 交易数量: 价格={price}, 数量={quantity}")
            return quantity
            
        except Exception as e:
            self.logger.error("TRADE", f"计算交易数量时出错: {str(e)}")
            return 0

    def execute_trades(self, signals):
        """
        执行交易信号
        
        Args:
            signals: 交易信号列表
        """
        try:
            if not signals:
                self.logger.debug("TRADE", "没有交易信号需要执行")
                return
            
            self.logger.info("TRADE", f"开始执行交易信号: {signals}")
            
            for signal in signals:
                try:
                    # 执行交易
                    if signal['direction'] == 'BUY':
                        self.trader.submit_buy_order(
                            symbol=signal['symbol'],
                            quantity=signal['quantity']
                        )
                    else:
                        self.trader.submit_sell_order(
                            symbol=signal['symbol'],
                            quantity=signal['quantity']
                        )
                    
                except Exception as e:
                    self.logger.error("TRADE", f"执行交易信号时出错: {str(e)}")
                    continue
                
        except Exception as e:
            self.logger.error("TRADE", f"执行交易时发生错误: {str(e)}") 

    def _load_config(self, filename):
        """加载配置文件"""
        config_path = os.path.join(self.base_dir, 'configs', filename)
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                self.logger.error("CONFIG", f"加载配置文件 {filename} 失败: {str(e)}")
        return {}

    def _init_symbols(self):
        """初始化交易标的列表"""
        symbols = []
        for pool_stocks in self.stock_pools.values():
            if isinstance(pool_stocks, list):
                symbols.extend(pool_stocks)
        return list(set(symbols))  # 去重 