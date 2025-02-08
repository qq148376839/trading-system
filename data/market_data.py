import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import mysql.connector
from mysql.connector import pooling
from longport.openapi import QuoteContext, Period, AdjustType, CalcIndex

logger = logging.getLogger(__name__)

class MarketDataManager:
    """市场数据管理类"""
    
    def __init__(self, db_config: dict):
        """初始化市场数据管理器
        
        Args:
            db_config: 数据库配置信息
        """
        self.db_config = db_config
        self.pool = None
        self.quote_ctx = None
        
    def init_connection(self):
        """初始化数据库连接池"""
        try:
            pool_config = {
                'pool_name': 'mypool',
                'pool_size': 5,
                **self.db_config
            }
            self.pool = mysql.connector.pooling.MySQLConnectionPool(**pool_config)
            logger.info("数据库连接初始化成功")
        except Exception as e:
            logger.error(f"数据库连接初始化失败: {str(e)}")
            raise
            
    def get_api_config(self, account_type: str = 'SIMULATION') -> Dict:
        """获取API配置信息
        
        Args:
            account_type: 账户类型('SIMULATION'/'REAL')
            
        Returns:
            API配置信息
        """
        try:
            conn = self.pool.get_connection()
            cursor = conn.cursor(dictionary=True)
            
            cursor.execute('''
                SELECT app_key, app_secret, access_token, expire_time
                FROM api_config
                WHERE account_type = %s 
                AND is_active = TRUE
                AND expire_time > NOW()
                ORDER BY expire_time DESC
                LIMIT 1
            ''', (account_type,))
            
            config = cursor.fetchone()
            
            if not config:
                raise Exception(f"未找到有效的API配置信息: {account_type}")
                
            return config
            
        except Exception as e:
            logger.error(f"获取API配置信息失败: {str(e)}")
            raise
        finally:
            if 'cursor' in locals():
                cursor.close()
            if 'conn' in locals():
                conn.close()
                
    def update_access_token(
        self,
        account_type: str,
        access_token: str,
        expire_time: datetime
    ):
        """更新访问令牌
        
        Args:
            account_type: 账户类型
            access_token: 新的访问令牌
            expire_time: 过期时间
        """
        try:
            conn = self.pool.get_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
                UPDATE api_config
                SET access_token = %s,
                    expire_time = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE account_type = %s
                AND is_active = TRUE
            ''', (access_token, expire_time, account_type))
            
            conn.commit()
            
        except Exception as e:
            logger.error(f"更新访问令牌失败: {str(e)}")
            raise
        finally:
            if 'cursor' in locals():
                cursor.close()
            if 'conn' in locals():
                conn.close()
                
    def get_history_candlesticks(
        self, 
        symbol: str, 
        period: Period,
        count: int = 100,
        adjust_type: AdjustType = AdjustType.NoAdjust
    ) -> List[Dict]:
        """获取历史K线数据
        
        Args:
            symbol: 股票代码
            period: K线周期
            count: 获取数量
            adjust_type: 复权类型
            
        Returns:
            K线数据列表
        """
        try:
            conn = self.pool.get_connection()
            cursor = conn.cursor(dictionary=True)
            
            # 从数据库获取最新记录
            cursor.execute('''
                SELECT timestamp, open, close, high, low, volume, turnover
                FROM candlesticks 
                WHERE symbol = %s AND period = %s
                ORDER BY timestamp DESC
                LIMIT %s
            ''', (symbol, period.value, count))
            
            db_data = cursor.fetchall()
            
            # 如果数据库中数据不足,从API获取补充
            if len(db_data) < count:
                api_data = self.quote_ctx.history_candlesticks_by_offset(
                    symbol=symbol,
                    period=period,
                    adjust_type=adjust_type,
                    forward=True,
                    time=datetime.now(),
                    count=count
                )
                
                # 保存到数据库
                insert_sql = '''
                    INSERT INTO candlesticks 
                    (symbol, timestamp, open, close, high, low, volume, turnover, period)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                    open = VALUES(open),
                    close = VALUES(close),
                    high = VALUES(high),
                    low = VALUES(low),
                    volume = VALUES(volume),
                    turnover = VALUES(turnover)
                '''
                
                for candle in api_data:
                    cursor.execute(insert_sql, (
                        symbol,
                        int(candle.timestamp.timestamp()),
                        candle.open,
                        candle.close,
                        candle.high,
                        candle.low,
                        candle.volume,
                        candle.turnover,
                        period.value
                    ))
                
                conn.commit()
                return api_data
                
            return db_data
            
        except Exception as e:
            logger.error(f"获取历史K线数据失败: {str(e)}")
            raise
        finally:
            if 'cursor' in locals():
                cursor.close()
            if 'conn' in locals():
                conn.close()
                
    def save_technical_indicators(
        self,
        symbol: str,
        timestamp: int,
        indicators: Dict[str, float]
    ):
        """保存技术指标数据
        
        Args:
            symbol: 股票代码
            timestamp: 时间戳
            indicators: 指标数据
        """
        try:
            conn = self.pool.get_connection()
            cursor = conn.cursor()
            
            insert_sql = '''
                INSERT INTO technical_indicators 
                (symbol, timestamp, indicator_name, value)
                VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                value = VALUES(value)
            '''
            
            for name, value in indicators.items():
                cursor.execute(insert_sql, (symbol, timestamp, name, value))
                
            conn.commit()
            
        except Exception as e:
            logger.error(f"保存技术指标数据失败: {str(e)}")
            raise
        finally:
            if 'cursor' in locals():
                cursor.close()
            if 'conn' in locals():
                conn.close()
                
    def get_technical_indicators(
        self,
        symbol: str,
        indicators: List[CalcIndex]
    ) -> Dict:
        """获取技术指标数据
        
        Args:
            symbol: 股票代码
            indicators: 指标列表
            
        Returns:
            技术指标数据
        """
        try:
            # 从API获取最新指标数据
            data = self.quote_ctx.calc_indexes([symbol], indicators)[0]
            
            # 保存到数据库
            self.save_technical_indicators(
                symbol,
                int(datetime.now().timestamp()),
                data
            )
            
            return data
            
        except Exception as e:
            logger.error(f"获取技术指标数据失败: {str(e)}")
            raise
            
    def set_quote_context(self, quote_ctx: QuoteContext):
        """设置行情上下文"""
        self.quote_ctx = quote_ctx 