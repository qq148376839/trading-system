from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Optional

@dataclass
class TradeSignal:
    """交易信号类"""
    symbol: str
    direction: str  # 'BUY' or 'SELL'
    quantity: int
    price: Optional[Decimal] = None
    signal_time: datetime = None
    status: str = 'PENDING'
    
    def __post_init__(self):
        if self.signal_time is None:
            self.signal_time = datetime.now()
            
    def __str__(self):
        return f"TradeSignal({self.direction} {self.quantity} {self.symbol} @ {self.price or 'MARKET'})"
    
    def to_dict(self):
        """转换为数据库记录"""
        return {
            'symbol': self.symbol,
            'direction': self.direction,
            'quantity': self.quantity,
            'price': self.price,
            'signal_time': self.signal_time,
            'status': self.status
        }
    
    @classmethod
    def from_dict(cls, data):
        """从数据库记录创建信号对象"""
        return cls(
            symbol=data['symbol'],
            direction=data['direction'],
            quantity=data['quantity'],
            price=data.get('price'),
            signal_time=data.get('signal_time'),
            status=data.get('status', 'PENDING')
        ) 