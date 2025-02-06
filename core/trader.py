# trader.py
from core.strategy import TradingStrategy
from decimal import Decimal
from longport.openapi import TradeContext, OrderType, OrderSide, TimeInForceType
from datetime import datetime, timedelta
import time
from typing import Tuple, Optional

class AutoTrader:
    def __init__(self, trading_system):
        self.ts = trading_system
        self.strategy = TradingStrategy(trading_system)
        
    def submit_buy_order(self, symbol, quantity):
        """提交买入订单"""
        try:
            # 获取当前价格
            quote = self.ts.quote_ctx.get_realtime_quote([symbol])
            if not quote or len(quote) == 0:
                self.ts.logger.error("TRADE", f"获取 {symbol} 实时报价失败")
                return False
                
            current_price = quote[0].last_done  # 使用最新成交价
            
            # 风险检查
            if not self.ts.risk_manager.check_position_risk(symbol, quantity, current_price):
                self.ts.logger.warning("TRADE", f"风险检查未通过，取消买入 {symbol}")
                return False
            
            if not self.ts.risk_manager.check_daily_loss():
                self.ts.logger.warning("TRADE", "达到日亏损限制，取消交易")
                return False
            
            # 执行交易
            if not self.ts.use_simulation:
                order = self.ts.trade_ctx.submit_order(
                    symbol=symbol,
                    order_type=OrderType.MO,  # 市价单
                    side=OrderSide.Buy,      # 买入
                    submitted_quantity=Decimal(str(quantity)),
                    time_in_force=TimeInForceType.Day,  # 当日有效
                    remark="Auto Trading Buy Order"
                )
            
            # 记录交易
            query = """
            INSERT INTO trade_records 
            (symbol, trade_type, price, quantity, total_amount, trade_time, status)
            VALUES (%s, %s, %s, %s, %s, NOW(), %s)
            """
            total_amount = current_price * quantity
            cursor = self.ts.db.cursor()
            cursor.execute(query, (
                symbol, 'BUY', current_price, quantity, 
                total_amount, 'COMPLETED'
            ))
            
            # 更新账户余额
            self._update_account_balance(-total_amount)
            
            self.ts.db.commit()
            
            # 记录成功的交易
            self.ts.logger.info("TRADE", f"买入成功: {symbol}, 数量: {quantity}")
            self.ts.notifier.send_trade_notification("买入", symbol, quantity, current_price)
            
            return True
            
        except Exception as e:
            self.ts.db.rollback()
            self.ts.logger.error("TRADE", f"买入失败: {str(e)}")
            raise
        finally:
            cursor.close()
    
    def submit_sell_order(self, symbol, quantity):
        """提交卖出订单"""
        cursor = self.ts.db.cursor()
        try:
            # 获取当前价格
            quote = self.ts.quote_ctx.get_realtime_quote([symbol])
            if not quote or len(quote) == 0:
                self.ts.logger.error("TRADE", f"获取 {symbol} 实时报价失败")
                return False
                
            current_price = quote[0].last_done  # 使用最新成交价
            
            # 执行交易
            if not self.ts.use_simulation:
                order = self.ts.trade_ctx.submit_order(
                    symbol=symbol,
                    order_type=OrderType.MARKET,  # 市价单
                    side=OrderSide.SELL,         # 卖出
                    quantity=quantity,
                    time_in_force=TimeInForceType.Day  # 当日有效
                )
            
            # 记录交易
            query = """
            INSERT INTO trade_records 
            (symbol, trade_type, price, quantity, total_amount, trade_time, status)
            VALUES (%s, %s, %s, %s, %s, NOW(), %s)
            """
            total_amount = current_price * quantity
            cursor.execute(query, (
                symbol, 'SELL', current_price, quantity, 
                total_amount, 'COMPLETED'
            ))
            
            # 更新账户余额
            self._update_account_balance(total_amount)
            
            self.ts.db.commit()
            self.ts.logger.info("TRADE", f"卖出成功: {symbol}, 数量: {quantity}, 价格: {current_price}")
            
        except Exception as e:
            self.ts.db.rollback()
            self.ts.logger.error("TRADE", f"卖出失败: {str(e)}")
            raise
        finally:
            cursor.close()
    
    def check_positions(self):
        """检查持仓并执行止盈止损"""
        try:
            # 获取当前持仓
            positions = self.ts.trade_ctx.stock_positions()
            
            for position_info in positions:
                for stock in position_info.stock_info:
                    symbol = stock.symbol
                    quantity = int(stock.quantity)
                    if quantity <= 0:
                        continue
                        
                    # 获取当前价格
                    quote = self.ts.quote_ctx.get_realtime_quote([symbol])
                    if not quote or len(quote) == 0:
                        continue
                        
                    current_price = quote[0].last_done
                    cost_price = float(stock.cost_price) if stock.cost_price else 0
                    
                    if cost_price > 0:
                        profit_ratio = (current_price - cost_price) / cost_price
                        
                        # 检查止盈止损
                        if profit_ratio <= self.ts.stop_loss or profit_ratio >= self.ts.take_profit:
                            self.submit_sell_order(symbol, quantity)
                    
        except Exception as e:
            self.ts.logger.error("TRADE", f"检查持仓时发生错误: {str(e)}")

    def get_order_detail(self, order_id):
        """获取订单详情"""
        try:
            order = self.ts.trade_ctx.order_detail(order_id=order_id)
            return order
        except Exception as e:
            self.ts.logger.error("TRADE", f"获取订单详情失败: {str(e)}")
            return None

    def get_today_orders(self, symbol=None):
        """获取当日订单"""
        try:
            orders = self.ts.trade_ctx.today_orders(
                symbol=symbol,
                status=None,  # 可选择特定状态
                side=None,    # 可选择买入或卖出
                market=None   # 可选择特定市场
            )
            return orders
        except Exception as e:
            self.ts.logger.error("TRADE", f"获取当日订单失败: {str(e)}")
            return None

    def get_account_balance(self, currency=None):
        """获取账户资金"""
        try:
            balance = self.ts.trade_ctx.account_balance(
                currency=currency  # 可选择特定币种
            )
            return balance
        except Exception as e:
            self.ts.logger.error("TRADE", f"获取账户资金失败: {str(e)}")
            return None

    def _update_account_balance(self, amount_change):
        """更新账户余额"""
        try:
            # 获取最新账户余额
            balance = self.get_account_balance()
            if not balance or not balance.list:
                self.ts.logger.error("TRADE", "获取账户余额失败")
                return False
                
            # 记录余额变动
            cursor = self.ts.db.cursor()
            try:
                query = """
                INSERT INTO account_balance 
                (total_balance, available_balance, frozen_balance, currency)
                VALUES (%s, %s, %s, %s)
                """
                
                for account in balance.list:
                    for cash_info in account.cash_infos:
                        cursor.execute(query, (
                            account.total_cash,
                            cash_info.available_cash,
                            cash_info.frozen_cash,
                            cash_info.currency
                        ))
                
                self.ts.db.commit()
                return True
                
            except Exception as e:
                self.ts.db.rollback()
                self.ts.logger.error("TRADE", f"更新账户余额失败: {str(e)}")
                return False
            finally:
                cursor.close()
                
        except Exception as e:
            self.ts.logger.error("TRADE", f"更新账户余额失败: {str(e)}")
            return False

    def execute_trade(self, signal):
        """
        执行交易信号
        
        Args:
            signal: 交易信号对象，包含交易方向、数量等信息
        """
        try:
            if signal is None:
                self.ts.logger.info("TRADE", "没有交易信号，跳过执行")
                return
                
            self.ts.logger.info("TRADE", f"开始执行交易信号: {signal}")
            
            # 根据信号类型执行不同的交易操作
            if signal.direction == "BUY":
                # 执行买入操作
                self.place_order(
                    symbol=signal.symbol,
                    order_type="MARKET",
                    side="BUY",
                    quantity=signal.quantity
                )
            elif signal.direction == "SELL":
                # 执行卖出操作
                self.place_order(
                    symbol=signal.symbol,
                    order_type="MARKET", 
                    side="SELL",
                    quantity=signal.quantity
                )
                
            self.ts.logger.info("TRADE", f"交易信号执行完成: {signal}")
            
        except Exception as e:
            self.ts.logger.error("TRADE", f"执行交易时发生错误: {str(e)}")
            raise
            
    def place_order(self, symbol, order_type, side, quantity):
        """
        下单函数
        
        Args:
            symbol: 交易标的代码
            order_type: 订单类型(MARKET/LIMIT)
            side: 交易方向(BUY/SELL)
            quantity: 交易数量
        """
        try:
            self.ts.logger.info("TRADE", f"下单: {symbol} {side} {quantity}股")
            # TODO: 调用交易API执行实际下单
            # order = self.trade_api.place_order(...)
            
        except Exception as e:
            self.ts.logger.error("TRADE", f"下单失败: {str(e)}")
            raise

    def is_trading_time(self, market):
        """
        检查指定市场是否在交易时段
        """
        try:
            # 获取市场交易时段信息
            trading_sessions = self.ts.quote_ctx.trading_session()
            current_time = datetime.now().strftime('%H%M')
            
            for session in trading_sessions.market_trade_session:
                if session.market == market:
                    for period in session.trade_session:
                        if period.beg_time <= int(current_time) <= period.end_time:
                            return True
            return False
        except Exception as e:
            self.ts.logger.error("TRADE", f"检查交易时段失败: {str(e)}")
            return False

    def get_next_trading_time(self, market: str) -> Optional[Tuple[datetime, datetime]]:
        """
        获取下一个交易时段
        
        Args:
            market: 市场代码 (US/HK)
            
        Returns:
            Tuple[datetime, datetime]: (开始时间, 结束时间)
            如果当天没有更多交易时段则返回 None
        """
        try:
            trading_sessions = self.ts.quote_ctx.trading_session()
            now = datetime.now()
            today = now.date()
            
            for session in trading_sessions.market_trade_session:
                if session.market == market:
                    for period in session.trade_session:
                        # 转换时间格式 (HHMM -> datetime)
                        start_time = datetime.combine(
                            today,
                            datetime.strptime(str(period.beg_time), '%H%M').time()
                        )
                        end_time = datetime.combine(
                            today,
                            datetime.strptime(str(period.end_time), '%H%M').time()
                        )
                        
                        # 如果当前时间在交易时段内，返回当前时段
                        if start_time <= now <= end_time:
                            return (now, end_time)
                        
                        # 如果是未来的交易时段，返回该时段
                        if now < start_time:
                            return (start_time, end_time)
            
            return None
            
        except Exception as e:
            self.ts.logger.error("TRADE", f"获取交易时段失败: {str(e)}")
            return None

    def get_wait_time(self, market: str) -> int:
        """
        计算到下一个交易时段的等待时间（秒）
        
        Args:
            market: 市场代码 (US/HK)
            
        Returns:
            int: 需要等待的秒数，如果当天没有更多交易时段则返回到第二天开盘的等待时间
        """
        next_session = self.get_next_trading_time(market)
        now = datetime.now()
        
        if next_session:
            start_time, _ = next_session
            if start_time > now:
                return int((start_time - now).total_seconds())
            return 0
            
        # 如果当天没有更多交易时段，计算到下一个交易日的等待时间
        tomorrow = now + timedelta(days=1)
        tomorrow = tomorrow.replace(hour=0, minute=0, second=0, microsecond=0)
        return int((tomorrow - now).total_seconds())