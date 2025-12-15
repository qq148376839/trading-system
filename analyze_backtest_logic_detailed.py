#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
回测交易逻辑详细分析脚本
深入检查交易逻辑是否符合实际交易规则
"""

import json
from collections import defaultdict
from datetime import datetime, timedelta

def analyze_detailed_logic(json_file):
    """详细分析回测交易逻辑"""
    with open(json_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    trades = data.get('trades', [])
    
    print("=" * 80)
    print("回测交易逻辑详细分析报告")
    print("=" * 80)
    
    # 1. 检查同一天买卖问题
    print("\n" + "=" * 80)
    print("1. 同一天买卖检查（实际交易中，买入和卖出不能在同一天）")
    print("=" * 80)
    
    same_day_issues = []
    for trade in trades:
        entry_date = trade.get('entryDate', '')
        exit_date = trade.get('exitDate', '')
        
        if entry_date and exit_date and entry_date == exit_date:
            same_day_issues.append({
                'symbol': trade.get('symbol', ''),
                'entryDate': entry_date,
                'exitDate': exit_date,
                'entryPrice': trade.get('entryPrice', 0),
                'exitPrice': trade.get('exitPrice', 0),
                'pnl': trade.get('pnl', 0)
            })
    
    if same_day_issues:
        print(f"\n⚠️  发现 {len(same_day_issues)} 笔同一天买卖的交易:")
        for issue in same_day_issues[:10]:
            print(f"  - {issue['symbol']}: {issue['entryDate']} 买入({issue['entryPrice']:.2f}) -> 卖出({issue['exitPrice']:.2f}), 盈亏{issue['pnl']:.2f}")
        if len(same_day_issues) > 10:
            print(f"  ... 还有 {len(same_day_issues) - 10} 笔未显示")
        print("\n⚠️  问题说明：实际交易中，买入和卖出不能在同一天执行（T+0限制）")
    else:
        print("\n✅ 未发现同一天买卖的交易")
    
    # 2. 检查止损止盈执行价格
    print("\n" + "=" * 80)
    print("2. 止损止盈执行价格检查")
    print("=" * 80)
    
    stop_take_issues = []
    for trade in trades:
        exit_reason = trade.get('exitReason', '')
        exit_price = trade.get('exitPrice', 0)
        stop_loss = trade.get('stopLoss', 0)
        take_profit = trade.get('takeProfit', 0)
        
        if exit_reason == 'STOP_LOSS':
            # 止损应该以止损价或更低的价格执行
            # 但回测中使用收盘价，如果收盘价刚好等于止损价是可以的
            # 如果收盘价低于止损价，说明盘中已经触发止损
            if exit_price > stop_loss * 1.001:  # 允许0.1%的误差
                stop_take_issues.append({
                    'type': '止损价格异常',
                    'symbol': trade.get('symbol', ''),
                    'exitDate': trade.get('exitDate', ''),
                    'issue': f"止损卖出，但卖出价格({exit_price:.2f})明显高于止损价({stop_loss:.2f})",
                    'details': {
                        'exitPrice': exit_price,
                        'stopLoss': stop_loss,
                        'difference': exit_price - stop_loss
                    }
                })
        
        if exit_reason == 'TAKE_PROFIT':
            # 止盈应该以止盈价或更高的价格执行
            if exit_price < take_profit * 0.999:  # 允许0.1%的误差
                stop_take_issues.append({
                    'type': '止盈价格异常',
                    'symbol': trade.get('symbol', ''),
                    'exitDate': trade.get('exitDate', ''),
                    'issue': f"止盈卖出，但卖出价格({exit_price:.2f})明显低于止盈价({take_profit:.2f})",
                    'details': {
                        'exitPrice': exit_price,
                        'takeProfit': take_profit,
                        'difference': take_profit - exit_price
                    }
                })
    
    if stop_take_issues:
        print(f"\n⚠️  发现 {len(stop_take_issues)} 个止损止盈价格问题:")
        for issue in stop_take_issues[:10]:
            print(f"  - [{issue['type']}] {issue['symbol']} ({issue['exitDate']}): {issue['issue']}")
        if len(stop_take_issues) > 10:
            print(f"  ... 还有 {len(stop_take_issues) - 10} 个问题未显示")
        print("\n⚠️  问题说明：回测中使用收盘价执行止损止盈，可能不够精确")
        print("  实际交易中，止损止盈应该在盘中价格触及时立即执行")
    else:
        print("\n✅ 止损止盈价格检查通过")
    
    # 3. 检查持仓时间
    print("\n" + "=" * 80)
    print("3. 持仓时间检查")
    print("=" * 80)
    
    holding_periods = []
    for trade in trades:
        entry_date = trade.get('entryDate', '')
        exit_date = trade.get('exitDate', '')
        
        if entry_date and exit_date:
            try:
                entry_dt = datetime.strptime(entry_date, '%Y-%m-%d')
                exit_dt = datetime.strptime(exit_date, '%Y-%m-%d')
                holding_days = (exit_dt - entry_dt).days
                holding_periods.append({
                    'symbol': trade.get('symbol', ''),
                    'holdingDays': holding_days,
                    'pnl': trade.get('pnl', 0),
                    'pnlPercent': trade.get('pnlPercent', 0)
                })
            except ValueError:
                pass
    
    if holding_periods:
        avg_holding = sum(p['holdingDays'] for p in holding_periods) / len(holding_periods)
        min_holding = min(p['holdingDays'] for p in holding_periods)
        max_holding = max(p['holdingDays'] for p in holding_periods)
        
        print(f"\n持仓时间统计:")
        print(f"  平均持仓天数: {avg_holding:.1f}天")
        print(f"  最短持仓: {min_holding}天")
        print(f"  最长持仓: {max_holding}天")
        
        # 检查是否有持仓时间过短的情况（可能是数据问题）
        very_short = [p for p in holding_periods if p['holdingDays'] < 0]
        if very_short:
            print(f"\n⚠️  发现 {len(very_short)} 笔持仓时间为负的交易（数据异常）")
    
    # 4. 检查价格合理性
    print("\n" + "=" * 80)
    print("4. 价格合理性检查")
    print("=" * 80)
    
    price_issues = []
    for trade in trades:
        symbol = trade.get('symbol', '')
        entry_price = trade.get('entryPrice', 0)
        exit_price = trade.get('exitPrice', 0)
        
        # 检查价格是否在合理范围内（美股价格通常在1-1000之间）
        if entry_price > 0:
            if entry_price < 0.01:
                price_issues.append({
                    'type': '买入价格过低',
                    'symbol': symbol,
                    'price': entry_price,
                    'issue': f"买入价格 {entry_price:.4f} 过低，可能是数据错误"
                })
            elif entry_price > 10000:
                price_issues.append({
                    'type': '买入价格过高',
                    'symbol': symbol,
                    'price': entry_price,
                    'issue': f"买入价格 {entry_price:.2f} 过高，可能是数据错误"
                })
        
        if exit_price > 0:
            if exit_price < 0.01:
                price_issues.append({
                    'type': '卖出价格过低',
                    'symbol': symbol,
                    'price': exit_price,
                    'issue': f"卖出价格 {exit_price:.4f} 过低，可能是数据错误"
                })
            elif exit_price > 10000:
                price_issues.append({
                    'type': '卖出价格过高',
                    'symbol': symbol,
                    'price': exit_price,
                    'issue': f"卖出价格 {exit_price:.2f} 过高，可能是数据错误"
                })
        
        # 检查价格变动是否合理（单日涨跌幅超过50%可能是数据错误）
        if entry_price > 0 and exit_price > 0:
            price_change = abs(exit_price - entry_price) / entry_price
            if price_change > 0.5:  # 50%的变动
                holding_days = 0
                try:
                    entry_dt = datetime.strptime(trade.get('entryDate', ''), '%Y-%m-%d')
                    exit_dt = datetime.strptime(trade.get('exitDate', ''), '%Y-%m-%d')
                    holding_days = (exit_dt - entry_dt).days
                except:
                    pass
                
                if holding_days <= 5:  # 5天内价格变动超过50%
                    price_issues.append({
                        'type': '价格变动异常',
                        'symbol': symbol,
                        'entryPrice': entry_price,
                        'exitPrice': exit_price,
                        'change': price_change * 100,
                        'holdingDays': holding_days,
                        'issue': f"持仓{holding_days}天，价格变动{price_change*100:.1f}%，可能异常"
                    })
    
    if price_issues:
        print(f"\n⚠️  发现 {len(price_issues)} 个价格合理性问题:")
        for issue in price_issues[:10]:
            print(f"  - [{issue['type']}] {issue.get('symbol', '')}: {issue['issue']}")
        if len(price_issues) > 10:
            print(f"  ... 还有 {len(price_issues) - 10} 个问题未显示")
    else:
        print("\n✅ 价格合理性检查通过")
    
    # 5. 检查交易顺序
    print("\n" + "=" * 80)
    print("5. 交易顺序检查")
    print("=" * 80)
    
    # 按标的分组，检查每只股票的交易顺序
    symbol_trades = defaultdict(list)
    for i, trade in enumerate(trades):
        symbol = trade.get('symbol', '')
        symbol_trades[symbol].append((i, trade))
    
    order_issues = []
    for symbol, trade_list in symbol_trades.items():
        # 按日期排序
        sorted_trades = sorted(trade_list, key=lambda x: (
            x[1].get('entryDate', ''),
            x[1].get('exitDate', '9999-99-99')
        ))
        
        # 检查是否有重叠的持仓
        active_positions = []
        for idx, trade in sorted_trades:
            entry_date = trade.get('entryDate', '')
            exit_date = trade.get('exitDate', '')
            
            if entry_date:
                # 检查是否与已有持仓重叠
                for pos in active_positions:
                    if not pos.get('exitDate'):
                        order_issues.append({
                            'type': '持仓重叠',
                            'symbol': symbol,
                            'issue': f"在 {entry_date} 买入，但已有未平仓的持仓（{pos['entryDate']} 买入）",
                            'details': {
                                'newEntry': entry_date,
                                'existingEntry': pos['entryDate']
                            }
                        })
                
                # 添加到活跃持仓
                active_positions.append({
                    'entryDate': entry_date,
                    'exitDate': exit_date
                })
            
            # 移除已平仓的持仓
            active_positions = [p for p in active_positions if not p.get('exitDate') or p['exitDate'] != exit_date]
    
    if order_issues:
        print(f"\n⚠️  发现 {len(order_issues)} 个交易顺序问题:")
        for issue in order_issues[:10]:
            print(f"  - [{issue['type']}] {issue['symbol']}: {issue['issue']}")
        if len(order_issues) > 10:
            print(f"  ... 还有 {len(order_issues) - 10} 个问题未显示")
    else:
        print("\n✅ 交易顺序检查通过：未发现持仓重叠")
    
    # 6. 总结和建议
    print("\n" + "=" * 80)
    print("6. 总结和建议")
    print("=" * 80)
    
    total_issues = len(same_day_issues) + len(stop_take_issues) + len(price_issues) + len(order_issues)
    
    print(f"\n总问题数: {total_issues}")
    print(f"  - 同一天买卖: {len(same_day_issues)}")
    print(f"  - 止损止盈价格: {len(stop_take_issues)}")
    print(f"  - 价格合理性: {len(price_issues)}")
    print(f"  - 交易顺序: {len(order_issues)}")
    
    print("\n关键发现和建议:")
    
    if len(same_day_issues) > 0:
        print("\n⚠️  同一天买卖问题:")
        print("  - 实际交易中，买入和卖出不能在同一天（T+0限制）")
        print("  - 建议：在回测代码中添加检查，确保卖出日期晚于买入日期")
    
    if len(stop_take_issues) > 0:
        print("\n⚠️  止损止盈执行问题:")
        print("  - 回测中使用收盘价执行止损止盈，可能不够精确")
        print("  - 实际交易中，止损止盈应该在盘中价格触及时立即执行")
        print("  - 建议：使用日K线的最高价/最低价来判断是否触发止损止盈")
        print("  - 如果当日最高价 >= 止盈价，则按止盈价执行")
        print("  - 如果当日最低价 <= 止损价，则按止损价执行")
    
    if len(price_issues) > 0:
        print("\n⚠️  价格合理性问题:")
        print("  - 部分交易的价格变动异常，可能是数据问题")
        print("  - 建议：检查历史K线数据的质量")
    
    if len(order_issues) > 0:
        print("\n⚠️  交易顺序问题:")
        print("  - 发现持仓重叠的情况，说明买入逻辑可能有问题")
        print("  - 建议：检查回测代码中的持仓检查逻辑")
    
    if total_issues == 0:
        print("\n✅ 所有详细检查通过！")
        print("\n但需要注意以下几点：")
        print("  1. 回测使用收盘价执行交易，实际交易中可能使用盘中价格")
        print("  2. 回测没有考虑滑点和手续费")
        print("  3. 回测没有考虑市场深度和流动性")
        print("  4. 止损止盈使用收盘价判断，可能不够精确")

if __name__ == '__main__':
    import sys
    json_file = sys.argv[1] if len(sys.argv) > 1 else 'backtest_5_2024-01-01_2025-12-15_49.json'
    analyze_detailed_logic(json_file)

