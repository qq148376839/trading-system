import asyncio
from datetime import datetime, timedelta
from decimal import Decimal
from typing import List, Dict, Optional
from longport.openapi import TradeContext, OrderType, OrderSide, TimeInForceType

class AsyncTrader:
    def __init__(self, trading_system):
        self.ts = trading_system
        self.order_queue = asyncio.Queue()
        self.running = False
        self.lock = asyncio.Lock()
        
    async def start(self):
        """启动异步交易处理"""
        self.running = True
        await asyncio.gather(
            self.process_orders(),
            self.monitor_positions(),
            self.update_market_data()
        )
        
    async def stop(self):
        """停止异步交易处理"""
        self.running = False
        
    async def process_orders(self):
        """处理订单队列"""
        while self.running:
            try:
                order = await self.order_queue.get()
                await self.execute_order(order)
                self.order_queue.task_done()
            except Exception as e:
                self.ts.logger.error("TRADE", f"处理订单时发生错误: {str(e)}")
                await asyncio.sleep(1)
                
    async def execute_order(self, order):
        """执行交易订单"""
        async with self.lock:
            try:
                # 风险检查
                if not await self.check_risk(order):
                    return False
                    
                # 获取实时报价
                quote = await self.ts.quote_ctx.get_realtime_quote([order.symbol])
                if not quote or len(quote) == 0:
                    raise ValueError(f"无法获取 {order.symbol} 的实时报价")
                    
                current_price = quote[0].last_done
                
                # 执行交易
                if not self.ts.use_simulation:
                    trade_result = await self.ts.trade_ctx.submit_order(
                        symbol=order.symbol,
                        order_type=OrderType.MO,
                        side=OrderSide.Buy if order.direction == 'BUY' else OrderSide.Sell,
                        submitted_quantity=Decimal(str(order.quantity)),
                        time_in_force=TimeInForceType.Day,
                        remark="Async Trading Order"
                    )
                    
                # 记录交易
                await self.record_trade(order, current_price)
                
                # 发送通知
                await self.ts.notifier.send_trade_notification(
                    order.direction,
                    order.symbol,
                    order.quantity,
                    current_price
                )
                
                return True
                
            except Exception as e:
                self.ts.logger.error("TRADE", f"执行订单时发生错误: {str(e)}")
                return False
                
    async def monitor_positions(self):
        """监控持仓"""
        while self.running:
            try:
                positions = await self.get_positions()
                for position in positions:
                    await self.check_position_risk(position)
                await asyncio.sleep(60)  # 每分钟检查一次
            except Exception as e:
                self.ts.logger.error("TRADE", f"监控持仓时发生错误: {str(e)}")
                await asyncio.sleep(5)
                
    async def update_market_data(self):
        """更新市场数据"""
        while self.running:
            try:
                symbols = self.ts.config.get_all_symbols()
                await self.ts.data_collector.collect_market_data(symbols)
                await asyncio.sleep(300)  # 每5分钟更新一次
            except Exception as e:
                self.ts.logger.error("TRADE", f"更新市场数据时发生错误: {str(e)}")
                await asyncio.sleep(5) 