from datetime import datetime, timedelta
import pandas as pd
import numpy as np

class PerformanceMonitor:
    def __init__(self, trading_system):
        self.ts = trading_system
        self.metrics_cache = {}
        self.cache_duration = timedelta(minutes=5)
        
    def calculate_daily_returns(self):
        """计算每日收益率"""
        try:
            cursor = self.ts.db.cursor(dictionary=True)
            query = """
            SELECT 
                DATE(trade_time) as date,
                SUM(CASE 
                    WHEN trade_type = 'SELL' THEN quantity * price
                    WHEN trade_type = 'BUY' THEN -quantity * price
                END) as daily_pnl
            FROM trade_records
            WHERE trade_time >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY DATE(trade_time)
            ORDER BY date
            """
            cursor.execute(query)
            results = cursor.fetchall()
            
            returns = pd.DataFrame(results)
            returns['return_rate'] = returns['daily_pnl'] / self.get_account_value()
            
            return returns
            
        finally:
            cursor.close()
            
    def calculate_sharpe_ratio(self, returns):
        """计算夏普比率"""
        if returns.empty:
            return 0
            
        risk_free_rate = 0.02  # 假设无风险利率为2%
        excess_returns = returns['return_rate'] - risk_free_rate/252
        
        if len(excess_returns) < 2:
            return 0
            
        return np.sqrt(252) * excess_returns.mean() / excess_returns.std()
        
    def calculate_max_drawdown(self, returns):
        """计算最大回撤"""
        if returns.empty:
            return 0
            
        cumulative = (1 + returns['return_rate']).cumprod()
        running_max = cumulative.expanding().max()
        drawdown = (cumulative - running_max) / running_max
        
        return drawdown.min()
        
    def generate_performance_report(self):
        """生成绩效报告"""
        # 检查缓存
        cache_key = 'performance_report'
        if cache_key in self.metrics_cache:
            cache_time, cache_data = self.metrics_cache[cache_key]
            if datetime.now() - cache_time < self.cache_duration:
                return cache_data
                
        returns = self.calculate_daily_returns()
        
        report = {
            'total_return': returns['daily_pnl'].sum(),
            'sharpe_ratio': self.calculate_sharpe_ratio(returns),
            'max_drawdown': self.calculate_max_drawdown(returns),
            'win_rate': self.calculate_win_rate(),
            'positions': self.get_current_positions(),
            'timestamp': datetime.now()
        }
        
        # 更新缓存
        self.metrics_cache[cache_key] = (datetime.now(), report)
        
        return report 