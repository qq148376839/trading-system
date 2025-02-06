# config.py
from longport.openapi import Config, QuoteContext, TradeContext
from decimal import Decimal
import mysql.connector
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
import numpy as np
from utils.logger import DBLogger
from utils.risk_manager import RiskManager
from utils.notifier import EmailNotifier
from core.token_manager import TokenManager
import json
import os

class TradingSystem:
    def __init__(self, use_simulation=True):
        self.use_simulation = use_simulation
        
        # 设置基础路径 - 使用绝对路径
        current_file = os.path.abspath(__file__)
        if os.path.basename(os.path.dirname(current_file)) == 'core':
            # 如果在 core 目录下
            self.base_dir = os.path.dirname(os.path.dirname(current_file))
        else:
            # 如果直接在项目根目录下
            self.base_dir = os.path.dirname(current_file)
            
        self.config_dir = os.path.join(self.base_dir, 'configs')
        
        print("\n=== TradingSystem 路径信息 ===")
        print(f"当前文件路径: {current_file}")
        print(f"基础目录: {self.base_dir}")
        print(f"配置目录: {self.config_dir}")
        
        # 验证配置目录是否存在
        if not os.path.exists(self.config_dir):
            raise Exception(f"配置目录不存在: {self.config_dir}")
        
        # 初始化数据库连接
        self.db = self._init_database()
        self.logger = DBLogger(self.db)
        
        # 加载所有配置文件
        self.load_config_files()
        
        # 初始化API配置
        self.config = self._init_trading_config()
        
        # 初始化其他依赖配置的组件
        self.token_manager = TokenManager(self)
        self.risk_manager = RiskManager(self)
        self.notifier = EmailNotifier(self.email_config)
        
        # 初始化交易上下文（使用longport_config）
        self.quote_ctx = QuoteContext(self.longport_config)
        self.trade_ctx = TradeContext(self.longport_config)
        
        # 检查并刷新Token
        self.token_manager.check_and_refresh_token()
        
        # 股票池设置
        self.stock_pools = {
            'AI': ['NVDA.US', 'AI.US', 'GOOGL.US'],
            'AutoDrive': ['TSLA.US', 'XPEV.US', 'NIO.US'],
            'Energy': ['CATL.HK', '772.HK'],
            'Robot': ['ABB.US', 'ISRG.US']
        }
        
        # 止盈止损设置
        self.stop_loss = -0.1  # 10%止损
        self.take_profit = 0.15  # 15%止盈

    def load_config_files(self):
        """加载所有配置文件"""
        # 加载邮件配置
        with open(os.path.join(self.config_dir, 'email_config.json'), 'r', encoding='utf-8') as f:
            self.email_config = json.load(f)
            
        # 加载风险配置
        with open(os.path.join(self.config_dir, 'risk_config.json'), 'r', encoding='utf-8') as f:
            self.risk_config = json.load(f)
            
        # 加载交易配置
        with open(os.path.join(self.config_dir, 'trading_config.json'), 'r', encoding='utf-8') as f:
            trading_config = json.load(f)
            self.stock_pools = trading_config.get('stock_pools', {})
            self.trade_params = trading_config.get('trade_params', {})
            
    def _init_database(self):
        """初始化数据库连接"""
        try:
            # 1. 检查配置文件路径
            db_config_path = os.path.join(self.config_dir, 'database_config.json')
            print(f"\n=== 数据库初始化信息 ===")
            print(f"当前工作目录: {os.getcwd()}")
            print(f"配置目录: {self.config_dir}")
            print(f"尝试加载数据库配置: {db_config_path}")
            
            if not os.path.exists(db_config_path):
                # 尝试从当前目录加载
                current_dir = os.path.dirname(os.path.abspath(__file__))
                alt_config_path = os.path.join(current_dir, 'configs', 'database_config.json')
                print(f"主配置路径不存在，尝试备用路径: {alt_config_path}")
                
                if os.path.exists(alt_config_path):
                    db_config_path = alt_config_path
                    print("使用备用配置路径")
                else:
                    raise FileNotFoundError(f"数据库配置文件不存在，已尝试路径:\n1. {db_config_path}\n2. {alt_config_path}")
            
            # 2. 读取配置文件
            print(f"\n正在读取配置文件: {db_config_path}")
            with open(db_config_path, 'r', encoding='utf-8') as f:
                db_config = json.load(f)
                
            # 3. 检查配置内容
            required_fields = ['host', 'user', 'password', 'database']
            missing_fields = [field for field in required_fields if field not in db_config]
            if missing_fields:
                raise ValueError(f"配置文件缺少必要字段: {', '.join(missing_fields)}")
                
            # 4. 打印配置信息（隐藏敏感信息）
            safe_config = db_config.copy()
            if 'password' in safe_config:
                safe_config['password'] = '******'
            print(f"数据库配置信息: {safe_config}")
            
            # 5. 尝试连接
            print("\n正在尝试连接数据库...")
            try:
                conn = mysql.connector.connect(**db_config)
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
                raise Exception(f"数据库连接失败 (错误代码: {error_code}): {error_msg}")
                
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
        cursor = self.db.cursor(dictionary=True)
        try:
            # 获取当前活跃的API配置
            query = """
            SELECT * FROM api_config 
            WHERE account_type = %s 
            AND is_active = TRUE 
            AND expire_time > NOW()
            LIMIT 1
            """
            
            account_type = 'SIMULATION' if self.use_simulation else 'REAL'
            cursor.execute(query, (account_type,))
            config_data = cursor.fetchone()
            
            if not config_data:
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
            
            # 创建一个字典来存储所有配置
            config = {
                'API': {
                    'app_key': config_data['app_key'],
                    'app_secret': config_data['app_secret'],
                    'access_token': config_data['access_token']
                },
                'RISK': self.risk_config
            }
            
            # 同时创建长桥API所需的Config对象
            self.longport_config = Config(
                app_key=config_data['app_key'],
                app_secret=config_data['app_secret'],
                access_token=config_data['access_token']
            )
            
            return config
            
        finally:
            cursor.close()
    
    def update_trading_config(self):
        """更新交易系统配置"""
        try:
            # 重新初始化API配置
            self.config = self._init_trading_config()
            
            # 重新初始化交易上下文
            self.quote_ctx = QuoteContext(self.longport_config)
            self.trade_ctx = TradeContext(self.longport_config)
            
            self.logger.info("CONFIG", "交易系统配置已更新")
            
        except Exception as e:
            self.logger.error("CONFIG", f"更新交易系统配置失败: {str(e)}")
            raise e
            
    def update_access_token(self, new_token, account_type, expire_time):
        """更新访问令牌（已弃用，请使用 TokenManager）"""
        self.logger.warning(
            "CONFIG", 
            "update_access_token 方法已弃用，请使用 TokenManager 进行 Token 管理"
        )
        self.token_manager.check_and_refresh_token()
    
    def switch_account_type(self, use_simulation=True):
        """切换账户类型（模拟/实盘）"""
        self.use_simulation = use_simulation
        self.config = self._init_trading_config()
        self.quote_ctx = QuoteContext(self.longport_config)
        self.trade_ctx = TradeContext(self.longport_config)
        print(f"已切换至{'模拟' if use_simulation else '实盘'}账户")