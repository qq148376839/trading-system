from decimal import Decimal
from enum import Enum

class Market(Enum):
    HK = "HK"
    US = "US"

class CostCalculator:
    """交易成本计算器"""
    
    def __init__(self, monthly_order_count=0):
        self.monthly_order_count = monthly_order_count
        
        # 港股阶梯平台费率
        self.hk_platform_fees = {
            (1, 5): Decimal('30.0'),      # 1-5笔
            (6, 15): Decimal('15.0'),     # 6-15笔
            (16, 50): Decimal('10.0'),    # 16-50笔
            (51, 3000): Decimal('5.0'),   # 51-3000笔
            (3001, float('inf')): Decimal('3.0')  # 3001笔以上
        }
        
        # 美股阶梯平台费率（每股）
        self.us_platform_fees = {
            (1, 5000): Decimal('0.0070'),        # 1-5000股
            (5001, 10000): Decimal('0.0060'),    # 5001-10000股
            (10001, 100000): Decimal('0.0050'),  # 10001-100000股
            (100001, 1000000): Decimal('0.0040'),# 100001-1000000股
            (1000001, float('inf')): Decimal('0.0030')  # 1000001股以上
        }
    
    def calculate_hk_cost(self, price: Decimal, quantity: int, use_tiered_fee=False) -> dict:
        """
        计算港股交易成本
        
        参数:
            price: 股票价格（港币）
            quantity: 交易数量
            use_tiered_fee: 是否使用阶梯平台费
        """
        amount = price * quantity
        
        # 佣金：0.03%，最低3港元
        commission = max(amount * Decimal('0.0003'), Decimal('3.0'))
        
        # 平台费
        if use_tiered_fee:
            platform_fee = self._get_hk_tiered_platform_fee()
        else:
            platform_fee = Decimal('15.0')  # 固定平台费
            
        # 交收费：0.002%，最低2港元，最高100港元
        settlement_fee = min(max(amount * Decimal('0.00002'), Decimal('2.0')), Decimal('100.0'))
        
        # 印花税：0.1%，不足1港元作1港元计
        stamp_duty = max(amount * Decimal('0.001'), Decimal('1.0'))
        
        # 交易费：0.00565%，最低0.01港元
        trading_fee = max(amount * Decimal('0.0000565'), Decimal('0.01'))
        
        # 交易征费：0.0027%，最低0.01港元
        trading_levy = max(amount * Decimal('0.000027'), Decimal('0.01'))
        
        # 财务汇报局交易征费：0.00015%，最低0.01港元
        frc_levy = max(amount * Decimal('0.0000015'), Decimal('0.01'))
        
        total_cost = commission + platform_fee + settlement_fee + stamp_duty + trading_fee + trading_levy + frc_levy
        
        return {
            'commission': commission,
            'platform_fee': platform_fee,
            'settlement_fee': settlement_fee,
            'stamp_duty': stamp_duty,
            'trading_fee': trading_fee,
            'trading_levy': trading_levy,
            'frc_levy': frc_levy,
            'total_cost': total_cost,
            'total_amount': amount + total_cost
        }
    
    def calculate_us_cost(self, price: Decimal, quantity: int, is_sell=False, use_tiered_fee=False) -> dict:
        """
        计算美股交易成本
        
        参数:
            price: 股票价格（美元）
            quantity: 交易数量
            is_sell: 是否为卖出交易
            use_tiered_fee: 是否使用阶梯平台费
        """
        amount = price * quantity
        
        # 佣金：0.0049美元/股，最低0.99美元，最高为交易金额的0.5%
        commission = min(
            max(quantity * Decimal('0.0049'), Decimal('0.99')),
            amount * Decimal('0.005')
        )
        
        # 平台费
        if use_tiered_fee:
            platform_fee = self._get_us_tiered_platform_fee(quantity)
        else:
            platform_fee = max(quantity * Decimal('0.0050'), Decimal('1.0'))  # 固定平台费
            
        # 交收费：0.003美元/股，最高为交易金额的7%
        settlement_fee = min(
            quantity * Decimal('0.003'),
            amount * Decimal('0.07')
        )
        
        # 仅卖出时收取的费用
        sec_fee = Decimal('0')
        finra_fee = Decimal('0')
        if is_sell:
            # SEC规费：0.0000278 × 交易金额，最低0.01美元
            sec_fee = max(amount * Decimal('0.0000278'), Decimal('0.01'))
            
            # FINRA交易活动费：0.000166美元/股，最低0.01美元，最高8.30美元
            finra_fee = min(
                max(quantity * Decimal('0.000166'), Decimal('0.01')),
                Decimal('8.30')
            )
            
        total_cost = commission + platform_fee + settlement_fee + sec_fee + finra_fee
        
        return {
            'commission': commission,
            'platform_fee': platform_fee,
            'settlement_fee': settlement_fee,
            'sec_fee': sec_fee,
            'finra_fee': finra_fee,
            'total_cost': total_cost,
            'total_amount': amount + total_cost
        }
    
    def _get_hk_tiered_platform_fee(self) -> Decimal:
        """获取港股阶梯平台费"""
        for (min_count, max_count), fee in self.hk_platform_fees.items():
            if min_count <= self.monthly_order_count <= max_count:
                return fee
        return Decimal('3.0')  # 默认最低费率
        
    def _get_us_tiered_platform_fee(self, quantity: int) -> Decimal:
        """获取美股阶梯平台费"""
        fee = Decimal('0')
        remaining_quantity = quantity
        
        for (min_shares, max_shares), rate in self.us_platform_fees.items():
            if remaining_quantity <= 0:
                break
                
            shares_in_tier = min(remaining_quantity, max_shares - min_shares + 1)
            fee += shares_in_tier * rate
            remaining_quantity -= shares_in_tier
            
        return max(fee, Decimal('1.0'))  # 最低1美元 