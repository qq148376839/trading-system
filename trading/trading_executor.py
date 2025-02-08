import logging
from typing import Dict
from datetime import datetime
from longport.openapi import (
    TradeContext, 
    OrderSide,
    OrderType,
    TimeInForceType,  # 修改这里：TimeInForce -> TimeInForceType
)
from risk_management.risk_controller import RiskController
from notification.email_notifier import EmailNotifier

logger = logging.getLogger(__name__)

class TradingExecutor:
    """交易执行器"""
    
    def __init__(
        self,
        trade_ctx: TradeContext,
        risk_controller: RiskController,
        email_notifier: EmailNotifier,
        trade_config: Dict
    ):
        self.trade_ctx = trade_ctx
        self.risk_controller = risk_controller
        self.email_notifier = email_notifier
        self.trade_config = trade_config
        
        # 交易限制
        self.daily_trade_limit = trade_config.get('daily_trade_limit', 5)
        self.min_trade_interval = trade_config.get('min_trade_interval', 300)  # 秒
        
        # 交易记录
        self.daily_trades = 0
        self.last_trade_time = {}
        
    def execute_trade(self, symbol: str, signal: int, price: float = 0):
        """执行交易
        
        Args:
            symbol: 股票代码
            signal: 交易信号(1:买入, -1:卖出)
            price: 交易价格(0表示市价)
        """
        try:
            now = datetime.now()
            
            # 检查交易次数限制
            if self.daily_trades >= self.daily_trade_limit:
                logger.warning(f"达到每日交易次数限制: {self.daily_trade_limit}")
                return
                
            # 检查交易间隔
            if symbol in self.last_trade_time:
                time_diff = (now - self.last_trade_time[symbol]).total_seconds()
                if time_diff < self.min_trade_interval:
                    logger.warning(f"交易间隔太短: {time_diff}秒 < {self.min_trade_interval}秒")
                    return
                    
            # 检查是否在交易时段
            if not self.is_trading_time(symbol):
                logger.warning(f"不在交易时段: {symbol}")
                return
                    
            # 获取持仓信息
            position = self.trade_ctx.positions(symbol=symbol)
            
            # 计算交易数量
            if signal > 0:  # 买入
                cash = self.trade_ctx.account_balance()
                max_quantity = int(cash.cash / price) if price > 0 else 0
                quantity = min(max_quantity, self.trade_config.get('max_position', 100))
            else:  # 卖出
                if not position:
                    logger.warning(f"没有持仓: {symbol}")
                    return
                quantity = position.quantity
                
            # 提交订单
            order = self.trade_ctx.submit_order(
                symbol=symbol,
                order_type=OrderType.Market if price == 0 else OrderType.Limit,
                side=OrderSide.Buy if signal > 0 else OrderSide.Sell,
                quantity=quantity,
                price=price,
                time_in_force=TimeInForceType.Day  # 这里也需要修改：TimeInForce -> TimeInForceType
            )
            
            # 更新交易记录
            self.daily_trades += 1
            self.last_trade_time[symbol] = now
            
            # 发送邮件通知
            trade_type = "买入" if signal > 0 else "卖出"
            self.email_notifier.send_trade_notification(
                symbol=symbol,
                trade_type=trade_type,
                quantity=quantity,
                price=price
            )
            
            logger.info(f"订单提交成功: {symbol} {trade_type} OrderId={order.order_id}")
            
        except Exception as e:
            logger.error(f"交易执行失败 {symbol}: {str(e)}")
            self.email_notifier.send_alert("交易执行失败", f"{symbol}: {str(e)}")

    def is_trading_time(self, symbol: str) -> bool:
        """检查是否在交易时段
        
        Args:
            symbol: 股票代码
            
        Returns:
            bool: 是否在交易时段
        """
        try:
            # 获取当日交易时段
            sessions = self.trade_ctx.trading_session()
            
            # 获取当前时间
            now = datetime.now()
            
            # 根据股票代码判断市场
            market = symbol.split('.')[-1]  # 如 'HK', 'US'
            
            # 检查是否在交易时段
            for session in sessions:
                if session.market == market:
                    for trade_session in session.trade_sessions:
                        if trade_session.begin_time <= now.time() <= trade_session.end_time:
                            return True
            return False
            
        except Exception as e:
            logger.error(f"检查交易时段失败: {str(e)}")
            return False 