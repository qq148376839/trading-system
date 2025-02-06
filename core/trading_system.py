from core.config import Config
from utils.logger import DBLogger
from utils.risk_manager import RiskManager
from utils.notifier import EmailNotifier
from longport.openapi import Config as LongPortConfig, QuoteContext, TradeContext
import mysql.connector
import os
import json
from datetime import datetime, timedelta
from core.token_manager import TokenManager

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
    """
    
    def __init__(self, use_simulation=True, config=None):
        """
        初始化交易系统
        
        参数:
            use_simulation (bool): 是否使用模拟交易，默认为True
            config (dict): 交易配置信息
        """
        # 加载配置
        self.config = config or {}
        
        # 设置基础路径
        self.base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        
        # 初始化数据库连接
        self.db = self._init_database()
        
        # 初始化工具类
        self.logger = DBLogger(self.db)  # 数据库日志记录器
        self.risk_manager = RiskManager(self)  # 风险管理器
        self.notifier = EmailNotifier(self.config.get('EMAIL', {}))  # 邮件通知器
        
        # 交易相关初始化
        self.use_simulation = use_simulation  # 是否使用模拟交易
        self.longport_config = self._init_trading_config()  # 初始化长桥API配置
        self.quote_ctx = QuoteContext(self.longport_config)  # 行情上下文
        self.trade_ctx = TradeContext(self.longport_config)  # 交易上下文
        
        # 从配置加载交易参数
        self.stock_pools = self.config.get('stock_pools', {})  # 股票池
        self.stop_loss = self.config.get('RISK', {}).get('stop_loss', -0.1)  # 止损比例
        self.take_profit = self.config.get('RISK', {}).get('take_profit', 0.2)  # 止盈比例
        
    def _init_database(self):
        """
        初始化数据库连接
        
        返回:
            mysql.connector.connection.MySQLConnection: 数据库连接对象
        """
        try:
            # 1. 检查配置文件路径
            db_config_path = os.path.join(self.base_dir, 'configs', 'database_config.json')
            print(f"\n=== 数据库初始化信息 ===")
            print(f"当前工作目录: {os.getcwd()}")
            print(f"基础目录: {self.base_dir}")
            print(f"尝试加载数据库配置: {db_config_path}")
            
            if not os.path.exists(db_config_path):
                # 尝试从当前目录加载
                current_dir = os.path.dirname(os.path.abspath(__file__))
                alt_config_path = os.path.join(current_dir, '..', 'configs', 'database_config.json')
                print(f"主配置路径不存在，尝试备用路径: {alt_config_path}")
                
                if os.path.exists(alt_config_path):
                    db_config_path = alt_config_path
                    print("使用备用配置路径")
                else:
                    raise FileNotFoundError(f"数据库配置文件不存在，已尝试路径:\n1. {db_config_path}\n2. {alt_config_path}")
            
            # 2. 读取配置文件
            print(f"\n正在读取配置文件: {db_config_path}")
            with open(db_config_path, 'r', encoding='utf-8') as f:
                file_content = f.read()
                print(f"文件原始内容: {file_content}")
                self.db_config = json.loads(file_content)
                
            # 3. 检查配置内容
            required_fields = ['host', 'user', 'password', 'database']
            missing_fields = [field for field in required_fields if field not in self.db_config]
            if missing_fields:
                raise ValueError(f"配置文件缺少必要字段: {', '.join(missing_fields)}")
                
            # 4. 打印配置信息（隐藏敏感信息）
            safe_config = self.db_config.copy()
            if 'password' in safe_config:
                safe_config['password'] = '******'
            print(f"解析后的配置信息: {safe_config}")
            print(f"配置类型: {type(self.db_config)}")
            print(f"配置字段: {list(self.db_config.keys())}")
            
            # 5. 尝试连接
            print("\n正在尝试连接数据库...")
            try:
                # 打印每个参数的类型
                for key, value in self.db_config.items():
                    print(f"{key}: {type(value)}")
                    
                conn = mysql.connector.connect(**self.db_config)
                print("数据库连接成功!")
                return conn
            except mysql.connector.Error as e:
                error_messages = {
                    1045: "用户名或密码错误",
                    1049: "数据库不存在",
                    2003: "无法连接到数据库服务器",
                    2005: "未知主机",
                }
                error_code = e.errno if hasattr(e, 'errno') else None
                error_msg = error_messages.get(error_code, str(e))
                raise Exception(f"数据库连接失败 (错误代码: {error_code}): {error_msg}\n原始错误: {str(e)}")
                
        except FileNotFoundError as e:
            print(f"\n❌ 配置文件错误: {str(e)}")
            raise
        except json.JSONDecodeError as e:
            print(f"\n❌ 配置文件格式错误: {str(e)}")
            raise
        except Exception as e:
            print(f"\n❌ 其他错误: {str(e)}")
            raise
        
    def _init_trading_config(self):
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

    def get_market_data(self, symbol):
        """获取市场数据"""
        cursor = self.db.cursor(dictionary=True)
        try:
            query = """
            SELECT * FROM market_data 
            WHERE symbol = %s 
            ORDER BY date DESC 
            LIMIT 10
            """
            cursor.execute(query, (symbol,))
            return cursor.fetchall()
        finally:
            cursor.close()
            
    def get_position(self, symbol):
        """获取持仓信息"""
        cursor = self.db.cursor(dictionary=True)
        try:
            query = "SELECT * FROM positions WHERE symbol = %s"
            cursor.execute(query, (symbol,))
            return cursor.fetchone()
        finally:
            cursor.close()
            
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