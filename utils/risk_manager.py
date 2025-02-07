from decimal import Decimal
from datetime import datetime

class RiskManager:
    """风险管理器"""
    
    def __init__(self, trading_system):
        """
        初始化风险管理器
        
        参数:
            trading_system: 交易系统实例
        """
        self.trading_system = trading_system
        self.logger = trading_system.logger
        # 使用 config_manager 替代 config
        self.risk_config = self.trading_system.config_manager.get_risk_config()
        
        # 设置风险参数，如果配置中没有则使用默认值
        self.stop_loss = self.risk_config.get('stop_loss', -0.1)
        self.take_profit = self.risk_config.get('take_profit', 0.15)
        self.max_daily_loss = self.risk_config.get('max_daily_loss', 0.05)
        self.max_position_loss = self.risk_config.get('max_position_loss', -0.15)
        self.volatility_threshold = self.risk_config.get('volatility_threshold', 0.02)
        
    def check_position_risk(self, symbol, quantity, price):
        """
        检查持仓风险
        
        参数:
            symbol: 股票代码
            quantity: 交易数量
            price: 交易价格
            
        返回:
            bool: 是否通过风险检查
        """
        try:
            # 获取当前持仓
            position = self.trading_system.get_position(symbol)
            if position:
                current_quantity = position['quantity']
                avg_price = position['avg_price']
                
                # 计算持仓成本
                total_cost = (current_quantity * avg_price + quantity * price)
                
                # 检查是否超过最大持仓限制
                if total_cost > self.max_position_loss * self.trading_system.get_account_balance():
                    self.logger.warning("RISK", 
                        f"{symbol} 持仓成本 {total_cost} 超过最大限制")
                    return False
            
            return True
            
        except Exception as e:
            self.logger.error("RISK", f"检查持仓风险时发生错误: {str(e)}")
            return False
            
    def check_daily_loss(self):
        """
        检查日内亏损是否超过限制
        
        返回:
            bool: 是否通过风险检查
        """
        try:
            # 获取今日交易记录
            today = datetime.now().date()
            cursor = self.trading_system.db.cursor(dictionary=True)
            
            query = """
            SELECT SUM(
                CASE 
                    WHEN trade_type = 'SELL' THEN quantity * price
                    WHEN trade_type = 'BUY' THEN -quantity * price
                END
            ) as daily_pnl
            FROM trade_records
            WHERE DATE(trade_time) = %s
            """
            
            cursor.execute(query, (today,))
            result = cursor.fetchone()
            
            if result and result['daily_pnl']:
                daily_pnl = float(result['daily_pnl'])
                account_balance = float(self.trading_system.get_account_balance())
                
                # 检查日内亏损是否超过限制
                if daily_pnl < -self.max_daily_loss * account_balance:
                    self.logger.warning("RISK", 
                        f"日内亏损 {daily_pnl} 超过最大限制 " +
                        f"{-self.max_daily_loss * account_balance}")
                    return False
            
            return True
            
        except Exception as e:
            self.logger.error("RISK", f"检查日内亏损时发生错误: {str(e)}")
            return False
        finally:
            if 'cursor' in locals():
                cursor.close()
            
    def _record_risk_event(self, event_type, symbol, severity, description):
        """记录风险事件"""
        cursor = self.trading_system.db.cursor()
        try:
            query = """
            INSERT INTO risk_events 
            (event_type, symbol, severity, description)
            VALUES (%s, %s, %s, %s)
            """
            cursor.execute(query, (event_type, symbol, severity, description))
            self.trading_system.db.commit()
            
            # 发送通知
            self.trading_system.notifier.send_risk_alert(event_type, description)
            
        finally:
            cursor.close()

    def check_risk(self, symbol, market_data):
        """
        综合风险检查
        
        Args:
            symbol: 交易标的代码
            market_data: 市场数据
        
        Returns:
            bool: 是否通过风险检查
        """
        try:
            self.logger.debug("RISK", f"开始检查 {symbol} 的风险控制限制")
            
            # 检查持仓止损
            position_loss = self.trading_system.calculate_position_loss(symbol, market_data)
            self.logger.debug("RISK", f"{symbol} 当前持仓亏损: {position_loss}")
            
            if position_loss <= self.stop_loss:
                self.logger.warning("RISK", f"{symbol} 触发止损限制")
                self._record_risk_event("STOP_LOSS", symbol, "HIGH", 
                    f"持仓亏损 {position_loss:.2%} 超过止损限制 {self.stop_loss:.2%}")
                return False
            
            # 检查日内亏损
            if not self.check_daily_loss():
                self._record_risk_event("DAILY_LOSS", symbol, "HIGH", 
                    f"触发日内最大亏损限制 {self.max_daily_loss:.2%}")
                return False
            
            # 检查波动率
            volatility = self.trading_system.calculate_volatility(market_data)
            self.logger.debug("RISK", f"{symbol} 当前波动率: {volatility}")
            
            if volatility >= self.volatility_threshold:
                self.logger.warning("RISK", f"{symbol} 波动率超过阈值")
                self._record_risk_event("HIGH_VOLATILITY", symbol, "MEDIUM", 
                    f"波动率 {volatility:.2%} 超过阈值 {self.volatility_threshold:.2%}")
                return False
            
            return True
            
        except Exception as e:
            self.logger.error("RISK", f"风险检查失败: {str(e)}")
            return False 