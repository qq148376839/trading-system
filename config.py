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

class TradingSystem:
    def __init__(self, use_simulation=True):
        self.use_simulation = use_simulation
        self.db = self._init_database()
        self.logger = DBLogger(self.db)
        self.risk_manager = RiskManager(self)
        self.notifier = EmailNotifier()
        self.config = self._init_trading_config()
        self.quote_ctx = QuoteContext(self.config)
        self.trade_ctx = TradeContext(self.config)
        
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

    def _init_database(self):
        return mysql.connector.connect(
            host="localhost",
            user="trading_user",
            password="qwer1234!",
            database="trading_db"
        )

    def _init_trading_config(self):
        cursor = self.db.cursor(dictionary=True)
        
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
            print(f"警告: {account_type} API Token 即将过期，请及时更新!")
            
        cursor.close()
        
        return Config(
            app_key=config_data['app_key'],
            app_secret=config_data['app_secret'],
            access_token=config_data['access_token']
        )
    
    def update_access_token(self, new_token, account_type, expire_time):
        """更新访问令牌"""
        cursor = self.db.cursor()
        try:
            # 更新token
            query = """
            UPDATE api_config 
            SET access_token = %s, 
                expire_time = %s,
                updated_at = NOW()
            WHERE account_type = %s AND is_active = TRUE
            """
            cursor.execute(query, (new_token, expire_time, account_type))
            self.db.commit()
            
            # 重新初始化trading config
            self.config = self._init_trading_config()
            self.quote_ctx = QuoteContext(self.config)
            self.trade_ctx = TradeContext(self.config)
            
            print(f"{account_type} Token更新成功!")
        except Exception as e:
            self.db.rollback()
            print(f"Token更新失败: {str(e)}")
        finally:
            cursor.close()
    
    def switch_account_type(self, use_simulation=True):
        """切换账户类型（模拟/实盘）"""
        self.use_simulation = use_simulation
        self.config = self._init_trading_config()
        self.quote_ctx = QuoteContext(self.config)
        self.trade_ctx = TradeContext(self.config)
        print(f"已切换至{'模拟' if use_simulation else '实盘'}账户")