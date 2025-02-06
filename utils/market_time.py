from datetime import datetime, time
import pytz

class MarketTime:
    """市场交易时间管理器"""
    
    def __init__(self):
        # 设置时区
        self.hk_tz = pytz.timezone('Asia/Hong_Kong')
        self.us_tz = pytz.timezone('America/New_York')
        self.cn_tz = pytz.timezone('Asia/Shanghai')
        
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
    
    def is_market_open(self, symbol: str) -> bool:
        """
        检查指定市场是否在交易时间
        
        Args:
            symbol: 股票代码（带后缀，如 AAPL.US, 0700.HK）
            
        Returns:
            bool: 是否在交易时间
        """
        market = symbol.split('.')[-1]
        if market not in ['US', 'HK']:
            return False
            
        # 获取市场当前时间
        current_time = datetime.now(
            self.us_tz if market == 'US' else self.hk_tz
        ).time()
        
        if market == 'HK':
            # 检查港股市场时间
            morning = self.market_hours['HK']['morning']
            afternoon = self.market_hours['HK']['afternoon']
            return (
                (morning['start'] <= current_time <= morning['end']) or
                (afternoon['start'] <= current_time <= afternoon['end'])
            )
        else:  # US市场
            # 检查美股市场时间（包括盘前盘后）
            regular = self.market_hours['US']['regular']
            pre = self.market_hours['US']['pre_market']
            after = self.market_hours['US']['after_market']
            return (
                (pre['start'] <= current_time <= pre['end']) or
                (regular['start'] <= current_time <= regular['end']) or
                (after['start'] <= current_time <= after['end'])
            )
    
    def get_next_market_open(self, symbol: str) -> datetime:
        """
        获取下一个交易时段的开始时间
        
        Args:
            symbol: 股票代码
            
        Returns:
            datetime: 下一个交易时段的开始时间
        """
        market = symbol.split('.')[-1]
        if market not in ['US', 'HK']:
            return None
            
        tz = self.us_tz if market == 'US' else self.hk_tz
        current = datetime.now(tz)
        
        if market == 'HK':
            if current.time() < self.market_hours['HK']['morning']['start']:
                # 当天早市开始
                next_open = current.replace(
                    hour=self.market_hours['HK']['morning']['start'].hour,
                    minute=self.market_hours['HK']['morning']['start'].minute,
                    second=0
                )
            elif current.time() < self.market_hours['HK']['afternoon']['start']:
                # 当天下午开市
                next_open = current.replace(
                    hour=self.market_hours['HK']['afternoon']['start'].hour,
                    minute=self.market_hours['HK']['afternoon']['start'].minute,
                    second=0
                )
            else:
                # 下一个交易日早市
                next_open = (current + timedelta(days=1)).replace(
                    hour=self.market_hours['HK']['morning']['start'].hour,
                    minute=self.market_hours['HK']['morning']['start'].minute,
                    second=0
                )
        else:  # US市场
            if current.time() < self.market_hours['US']['pre_market']['start']:
                # 当天盘前开始
                next_open = current.replace(
                    hour=self.market_hours['US']['pre_market']['start'].hour,
                    minute=self.market_hours['US']['pre_market']['start'].minute,
                    second=0
                )
            elif current.time() < self.market_hours['US']['regular']['start']:
                # 当天常规交易时段开始
                next_open = current.replace(
                    hour=self.market_hours['US']['regular']['start'].hour,
                    minute=self.market_hours['US']['regular']['start'].minute,
                    second=0
                )
            else:
                # 下一个交易日盘前
                next_open = (current + timedelta(days=1)).replace(
                    hour=self.market_hours['US']['pre_market']['start'].hour,
                    minute=self.market_hours['US']['pre_market']['start'].minute,
                    second=0
                )
                
        return next_open 