from datetime import datetime, time, timedelta
import pytz
from typing import Optional, Dict, Union
import pandas as pd

class MarketTime:
    """市场交易时间管理器"""
    
    def __init__(self):
        # 设置时区
        self.hk_tz = pytz.timezone('Asia/Hong_Kong')
        self.us_tz = pytz.timezone('America/New_York')
        
        # 定义各市场交易时间
        self.market_hours = {
            'HK': {
                'morning': {
                    'start': time(9, 30),
                    'end': time(12, 0)
                },
                'afternoon': {
                    'start': time(13, 0),
                    'end': time(16, 0)
                }
            },
            'US': {
                'regular': {
                    'start': time(9, 30),
                    'end': time(16, 0)
                },
                'pre_market': {
                    'start': time(4, 0),
                    'end': time(9, 30)
                },
                'after_market': {
                    'start': time(16, 0),
                    'end': time(20, 0)
                }
            }
        }
        
        # 加载节假日数据
        self._load_holidays()
    
    def _load_holidays(self) -> None:
        """加载各市场节假日数据"""
        # 这里应该从数据库或配置文件加载节假日信息
        self.holidays = {
            'HK': set(),  # 港股节假日集合
            'US': set()   # 美股节假日集合
        }
    
    def _validate_symbol(self, symbol: str) -> str:
        """验证股票代码格式并返回市场代码"""
        try:
            market = symbol.split('.')[-1].upper()
            if market not in ['US', 'HK']:
                raise ValueError(f"不支持的市场: {market}")
            return market
        except Exception as e:
            raise ValueError(f"无效的股票代码格式: {symbol}") from e
    
    def _is_holiday(self, market: str, date: datetime) -> bool:
        """检查是否为节假日"""
        return date.date() in self.holidays[market]
    
    def is_market_open(self, symbol: str) -> bool:
        """
        检查指定市场是否在交易时间
        
        Args:
            symbol: 股票代码（带后缀，如 AAPL.US, 0700.HK）
            
        Returns:
            bool: 是否在交易时间
            
        Raises:
            ValueError: 当股票代码格式无效或市场不支持时
        """
        market = self._validate_symbol(symbol)
        
        # 获取市场当前时间
        tz = self.us_tz if market == 'US' else self.hk_tz
        current = datetime.now(tz)
        
        # 检查是否为节假日
        if self._is_holiday(market, current):
            return False
        
        # 检查是否为周末
        if current.weekday() in [5, 6]:
            return False
            
        current_time = current.time()
        
        if market == 'HK':
            morning = self.market_hours['HK']['morning']
            afternoon = self.market_hours['HK']['afternoon']
            return (
                (morning['start'] <= current_time <= morning['end']) or
                (afternoon['start'] <= current_time <= afternoon['end'])
            )
        else:  # US市场
            regular = self.market_hours['US']['regular']
            pre = self.market_hours['US']['pre_market']
            after = self.market_hours['US']['after_market']
            return (
                (pre['start'] <= current_time <= pre['end']) or
                (regular['start'] <= current_time <= regular['end']) or
                (after['start'] <= current_time <= after['end'])
            )
    
    def get_next_market_open(self, symbol: str) -> Optional[datetime]:
        """
        获取下一个交易时段的开始时间
        
        Args:
            symbol: 股票代码
            
        Returns:
            datetime: 下一个交易时段的开始时间
            
        Raises:
            ValueError: 当股票代码格式无效或市场不支持时
        """
        market = self._validate_symbol(symbol)
        tz = self.us_tz if market == 'US' else self.hk_tz
        current = datetime.now(tz)
        
        # 获取下一个交易时间
        next_open = self._calculate_next_open(market, current)
        
        # 确保不是节假日
        while self._is_holiday(market, next_open) or next_open.weekday() in [5, 6]:
            next_open += timedelta(days=1)
            next_open = self._calculate_next_open(market, next_open)
            
        return next_open
    
    def _calculate_next_open(self, market: str, current: datetime) -> datetime:
        """计算下一个开市时间"""
        if market == 'HK':
            if current.time() < self.market_hours['HK']['morning']['start']:
                return current.replace(
                    hour=self.market_hours['HK']['morning']['start'].hour,
                    minute=self.market_hours['HK']['morning']['start'].minute,
                    second=0,
                    microsecond=0
                )
            elif current.time() < self.market_hours['HK']['afternoon']['start']:
                return current.replace(
                    hour=self.market_hours['HK']['afternoon']['start'].hour,
                    minute=self.market_hours['HK']['afternoon']['start'].minute,
                    second=0,
                    microsecond=0
                )
            else:
                next_day = current + timedelta(days=1)
                return next_day.replace(
                    hour=self.market_hours['HK']['morning']['start'].hour,
                    minute=self.market_hours['HK']['morning']['start'].minute,
                    second=0,
                    microsecond=0
                )
        else:  # US市场
            if current.time() < self.market_hours['US']['pre_market']['start']:
                return current.replace(
                    hour=self.market_hours['US']['pre_market']['start'].hour,
                    minute=self.market_hours['US']['pre_market']['start'].minute,
                    second=0,
                    microsecond=0
                )
            else:
                next_day = current + timedelta(days=1)
                return next_day.replace(
                    hour=self.market_hours['US']['pre_market']['start'].hour,
                    minute=self.market_hours['US']['pre_market']['start'].minute,
                    second=0,
                    microsecond=0
                ) 