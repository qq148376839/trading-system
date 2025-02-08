import logging
from typing import Dict
from datetime import datetime, date
from longport.openapi import TradeContext

logger = logging.getLogger(__name__)

class RiskController:
    """风险控制器"""
    
    def __init__(self, risk_config: Dict):
        self.risk_config = risk_config
        self.daily_pnl = 0  # 当日盈亏
        self.position_pnl = {}  # 每个持仓的盈亏
        self.trade_ctx = None
        
    def set_trade_context(self, trade_ctx: TradeContext):
        """设置交易上下文"""
        self.trade_ctx = trade_ctx
        
    def check_trade_risk(self, symbol: str, signal: int, quote: Dict) -> bool:
        """检查交易风险
        
        Args:
            symbol: 股票代码
            signal: 交易信号
            quote: 行情数据
            
        Returns:
            是否通过风险检查
        """
        try:
            # 检查波动率
            if self._check_volatility(quote) > self.risk_config['volatility_threshold']:
                logger.warning(f"波动率超过阈值: {symbol}")
                return False
                
            # 检查当日止损
            if self.daily_pnl < self.risk_config['max_daily_loss']:
                logger.warning(f"达到每日最大亏损限制")
                return False
                
            # 检查持仓止损
            if signal < 0:  # 卖出时检查
                if symbol in self.position_pnl:
                    pnl = self.position_pnl[symbol]
                    if pnl < self.risk_config['max_position_loss']:
                        logger.warning(f"达到持仓止损限制: {symbol}")
                        return False
                        
            return True
            
        except Exception as e:
            logger.error(f"风险检查失败: {str(e)}")
            return False
            
    def _check_volatility(self, quote: Dict) -> float:
        """计算波动率
        
        Args:
            quote: 行情数据
            
        Returns:
            波动率
        """
        try:
            high = quote['high']
            low = quote['low']
            return (high - low) / low
        except Exception as e:
            logger.error(f"波动率计算失败: {str(e)}")
            return 0
            
    def update_pnl(self):
        """更新盈亏数据"""
        try:
            if not self.trade_ctx:
                return
                
            # 获取当日盈亏
            today = date.today()
            executions = self.trade_ctx.today_executions()
            
            daily_pnl = 0
            position_pnl = {}
            
            for exec in executions:
                if exec.trade_done_at.date() == today:
                    pnl = exec.price * exec.quantity
                    if exec.side == 'SELL':
                        pnl = -pnl
                    daily_pnl += pnl
                    
                    if exec.symbol not in position_pnl:
                        position_pnl[exec.symbol] = 0
                    position_pnl[exec.symbol] += pnl
            
            self.daily_pnl = daily_pnl
            self.position_pnl = position_pnl
            
        except Exception as e:
            logger.error(f"更新盈亏数据失败: {str(e)}") 