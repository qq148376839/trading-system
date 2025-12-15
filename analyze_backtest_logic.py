#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
回测交易逻辑分析脚本
检查回测数据中的交易逻辑是否符合实际交易逻辑
"""

import json
from collections import defaultdict
from datetime import datetime

def analyze_backtest_logic(json_file):
    """分析回测交易逻辑"""
    with open(json_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    trades = data.get('trades', [])
    summary = data.get('summary', {})
    daily_returns = data.get('dailyReturns', [])
    
    print("=" * 80)
    print("回测交易逻辑分析报告")
    print("=" * 80)
    print(f"\n总交易数: {len(trades)}")
    print(f"总收益率: {summary.get('totalReturn', 0):.2f}%")
    print(f"胜率: {summary.get('winRate', 0):.2f}%")
    print(f"最大回撤: {summary.get('maxDrawdown', 0):.2f}%")
    
    # 1. 检查买入逻辑
    print("\n" + "=" * 80)
    print("1. 买入逻辑检查")
    print("=" * 80)
    
    buy_issues = []
    position_tracker = {}  # symbol -> {entryDate, entryPrice, quantity}
    
    for i, trade in enumerate(trades):
        symbol = trade.get('symbol', '')
        entry_date = trade.get('entryDate', '')
        entry_price = trade.get('entryPrice', 0)
        quantity = trade.get('quantity', 0)
        exit_date = trade.get('exitDate', '')
        
        # 检查1: 是否有重复买入（在未平仓的情况下再次买入）
        if symbol in position_tracker:
            prev_trade = position_tracker[symbol]
            if not prev_trade.get('exitDate'):
                buy_issues.append({
                    'type': '重复买入',
                    'symbol': symbol,
                    'trade_index': i,
                    'issue': f"在 {entry_date} 买入，但之前已有持仓（{prev_trade['entryDate']} 买入）",
                    'details': {
                        'current_entry': entry_date,
                        'previous_entry': prev_trade['entryDate'],
                        'previous_exit': prev_trade.get('exitDate', '未平仓')
                    }
                })
        
        # 更新持仓跟踪
        position_tracker[symbol] = {
            'entryDate': entry_date,
            'entryPrice': entry_price,
            'quantity': quantity,
            'exitDate': exit_date
        }
        
        # 检查2: 买入价格是否合理（不能为0或负数）
        if entry_price <= 0:
            buy_issues.append({
                'type': '买入价格异常',
                'symbol': symbol,
                'trade_index': i,
                'issue': f"买入价格为 {entry_price}，应该大于0",
                'details': {'entryPrice': entry_price}
            })
        
        # 检查3: 买入数量是否合理（应该大于0）
        if quantity <= 0:
            buy_issues.append({
                'type': '买入数量异常',
                'symbol': symbol,
                'trade_index': i,
                'issue': f"买入数量为 {quantity}，应该大于0",
                'details': {'quantity': quantity}
            })
    
    if buy_issues:
        print(f"\n⚠️  发现 {len(buy_issues)} 个买入逻辑问题:")
        for issue in buy_issues[:10]:  # 只显示前10个
            print(f"  - [{issue['type']}] {issue['symbol']}: {issue['issue']}")
        if len(buy_issues) > 10:
            print(f"  ... 还有 {len(buy_issues) - 10} 个问题未显示")
    else:
        print("\n✅ 买入逻辑检查通过：未发现重复买入、价格异常或数量异常")
    
    # 2. 检查卖出逻辑
    print("\n" + "=" * 80)
    print("2. 卖出逻辑检查")
    print("=" * 80)
    
    sell_issues = []
    position_tracker = {}  # 重新初始化
    
    for i, trade in enumerate(trades):
        symbol = trade.get('symbol', '')
        entry_date = trade.get('entryDate', '')
        exit_date = trade.get('exitDate', '')
        exit_price = trade.get('exitPrice', 0)
        exit_reason = trade.get('exitReason', '')
        stop_loss = trade.get('stopLoss', 0)
        take_profit = trade.get('takeProfit', 0)
        
        # 更新持仓跟踪
        if symbol not in position_tracker:
            position_tracker[symbol] = {
                'entryDate': entry_date,
                'entryPrice': trade.get('entryPrice', 0),
                'quantity': trade.get('quantity', 0),
                'exitDate': exit_date
            }
        else:
            # 如果之前有持仓，检查是否已平仓
            prev_trade = position_tracker[symbol]
            if prev_trade.get('exitDate') and exit_date < prev_trade['exitDate']:
                sell_issues.append({
                    'type': '卖出日期异常',
                    'symbol': symbol,
                    'trade_index': i,
                    'issue': f"卖出日期 {exit_date} 早于之前的卖出日期 {prev_trade['exitDate']}",
                    'details': {
                        'current_exit': exit_date,
                        'previous_exit': prev_trade['exitDate']
                    }
                })
            position_tracker[symbol]['exitDate'] = exit_date
        
        # 检查1: 卖出价格是否合理
        if exit_price <= 0:
            sell_issues.append({
                'type': '卖出价格异常',
                'symbol': symbol,
                'trade_index': i,
                'issue': f"卖出价格为 {exit_price}，应该大于0",
                'details': {'exitPrice': exit_price}
            })
        
        # 检查2: 止损止盈逻辑
        if exit_reason == 'STOP_LOSS':
            if stop_loss <= 0:
                sell_issues.append({
                    'type': '止损价格异常',
                    'symbol': symbol,
                    'trade_index': i,
                    'issue': f"止损卖出，但止损价格为 {stop_loss}",
                    'details': {'stopLoss': stop_loss, 'exitPrice': exit_price}
                })
            elif exit_price > stop_loss:
                sell_issues.append({
                    'type': '止损逻辑错误',
                    'symbol': symbol,
                    'trade_index': i,
                    'issue': f"止损卖出，但卖出价格 {exit_price} 高于止损价 {stop_loss}",
                    'details': {'stopLoss': stop_loss, 'exitPrice': exit_price}
                })
        
        if exit_reason == 'TAKE_PROFIT':
            if take_profit <= 0:
                sell_issues.append({
                    'type': '止盈价格异常',
                    'symbol': symbol,
                    'trade_index': i,
                    'issue': f"止盈卖出，但止盈价格为 {take_profit}",
                    'details': {'takeProfit': take_profit, 'exitPrice': exit_price}
                })
            elif exit_price < take_profit:
                sell_issues.append({
                    'type': '止盈逻辑错误',
                    'symbol': symbol,
                    'trade_index': i,
                    'issue': f"止盈卖出，但卖出价格 {exit_price} 低于止盈价 {take_profit}",
                    'details': {'takeProfit': take_profit, 'exitPrice': exit_price}
                })
        
        # 检查3: 卖出日期不能早于买入日期
        if exit_date and entry_date:
            try:
                exit_dt = datetime.strptime(exit_date, '%Y-%m-%d')
                entry_dt = datetime.strptime(entry_date, '%Y-%m-%d')
                if exit_dt < entry_dt:
                    sell_issues.append({
                        'type': '卖出日期早于买入日期',
                        'symbol': symbol,
                        'trade_index': i,
                        'issue': f"卖出日期 {exit_date} 早于买入日期 {entry_date}",
                        'details': {'entryDate': entry_date, 'exitDate': exit_date}
                    })
            except ValueError:
                pass
    
    if sell_issues:
        print(f"\n⚠️  发现 {len(sell_issues)} 个卖出逻辑问题:")
        for issue in sell_issues[:10]:  # 只显示前10个
            print(f"  - [{issue['type']}] {issue['symbol']}: {issue['issue']}")
        if len(sell_issues) > 10:
            print(f"  ... 还有 {len(sell_issues) - 10} 个问题未显示")
    else:
        print("\n✅ 卖出逻辑检查通过：未发现价格异常、止损止盈逻辑错误或日期异常")
    
    # 3. 检查资金管理逻辑
    print("\n" + "=" * 80)
    print("3. 资金管理逻辑检查")
    print("=" * 80)
    
    capital_issues = []
    initial_capital = 10000  # 假设初始资金为10000
    current_capital = initial_capital
    positions_value = 0  # 持仓市值
    
    # 按日期排序交易
    sorted_trades = sorted(trades, key=lambda x: (
        x.get('entryDate', ''),
        x.get('exitDate', '9999-99-99')  # 未平仓的排在后面
    ))
    
    for i, trade in enumerate(sorted_trades):
        symbol = trade.get('symbol', '')
        entry_date = trade.get('entryDate', '')
        exit_date = trade.get('exitDate', '')
        entry_price = trade.get('entryPrice', 0)
        exit_price = trade.get('exitPrice', 0)
        quantity = trade.get('quantity', 0)
        pnl = trade.get('pnl', 0)
        
        # 买入时扣除资金
        if entry_date:
            buy_cost = entry_price * quantity
            if buy_cost > current_capital:
                capital_issues.append({
                    'type': '资金不足',
                    'symbol': symbol,
                    'trade_index': i,
                    'issue': f"买入时资金不足：需要 {buy_cost:.2f}，但只有 {current_capital:.2f}",
                    'details': {
                        'buyCost': buy_cost,
                        'availableCapital': current_capital,
                        'entryDate': entry_date
                    }
                })
            else:
                current_capital -= buy_cost
                positions_value += buy_cost
        
        # 卖出时收回资金
        if exit_date:
            sell_amount = exit_price * quantity
            current_capital += sell_amount
            positions_value -= entry_price * quantity  # 减少持仓市值
            
            # 检查盈亏计算是否正确
            expected_pnl = (exit_price - entry_price) * quantity
            if abs(expected_pnl - pnl) > 0.01:  # 允许0.01的浮点误差
                capital_issues.append({
                    'type': '盈亏计算错误',
                    'symbol': symbol,
                    'trade_index': i,
                    'issue': f"盈亏计算不匹配：预期 {expected_pnl:.2f}，实际 {pnl:.2f}",
                    'details': {
                        'expectedPnl': expected_pnl,
                        'actualPnl': pnl,
                        'entryPrice': entry_price,
                        'exitPrice': exit_price,
                        'quantity': quantity
                    }
                })
    
    if capital_issues:
        print(f"\n⚠️  发现 {len(capital_issues)} 个资金管理问题:")
        for issue in capital_issues[:10]:  # 只显示前10个
            print(f"  - [{issue['type']}] {issue['symbol']}: {issue['issue']}")
        if len(capital_issues) > 10:
            print(f"  ... 还有 {len(capital_issues) - 10} 个问题未显示")
    else:
        print("\n✅ 资金管理逻辑检查通过：未发现资金不足或盈亏计算错误")
    
    # 4. 检查持仓管理逻辑
    print("\n" + "=" * 80)
    print("4. 持仓管理逻辑检查")
    print("=" * 80)
    
    position_issues = []
    positions = {}  # symbol -> trade info
    
    for i, trade in enumerate(sorted_trades):
        symbol = trade.get('symbol', '')
        entry_date = trade.get('entryDate', '')
        exit_date = trade.get('exitDate', '')
        
        if symbol in positions:
            prev_trade = positions[symbol]
            # 如果之前有持仓且未平仓，不应该再次买入
            if not prev_trade.get('exitDate') and entry_date:
                position_issues.append({
                    'type': '重复持仓',
                    'symbol': symbol,
                    'trade_index': i,
                    'issue': f"在已有持仓的情况下再次买入：{entry_date}",
                    'details': {
                        'previousEntry': prev_trade.get('entryDate'),
                        'currentEntry': entry_date
                    }
                })
        
        # 更新持仓
        if entry_date:
            positions[symbol] = trade
        if exit_date:
            positions[symbol] = {**positions.get(symbol, {}), 'exitDate': exit_date}
    
    if position_issues:
        print(f"\n⚠️  发现 {len(position_issues)} 个持仓管理问题:")
        for issue in position_issues[:10]:  # 只显示前10个
            print(f"  - [{issue['type']}] {issue['symbol']}: {issue['issue']}")
        if len(position_issues) > 10:
            print(f"  ... 还有 {len(position_issues) - 10} 个问题未显示")
    else:
        print("\n✅ 持仓管理逻辑检查通过：未发现重复持仓问题")
    
    # 5. 统计信息
    print("\n" + "=" * 80)
    print("5. 交易统计信息")
    print("=" * 80)
    
    # 按标的统计
    symbol_stats = defaultdict(lambda: {'count': 0, 'win': 0, 'loss': 0, 'total_pnl': 0})
    for trade in trades:
        symbol = trade.get('symbol', '')
        pnl = trade.get('pnl', 0)
        symbol_stats[symbol]['count'] += 1
        symbol_stats[symbol]['total_pnl'] += pnl
        if pnl > 0:
            symbol_stats[symbol]['win'] += 1
        elif pnl < 0:
            symbol_stats[symbol]['loss'] += 1
    
    print(f"\n交易标的数量: {len(symbol_stats)}")
    print(f"\n各标的交易统计（前10个）:")
    sorted_symbols = sorted(symbol_stats.items(), key=lambda x: x[1]['count'], reverse=True)
    for symbol, stats in sorted_symbols[:10]:
        win_rate = (stats['win'] / stats['count'] * 100) if stats['count'] > 0 else 0
        print(f"  {symbol}: {stats['count']}笔交易, 胜率{win_rate:.1f}%, 总盈亏{stats['total_pnl']:.2f}")
    
    # 按退出原因统计
    exit_reason_stats = defaultdict(int)
    for trade in trades:
        exit_reason = trade.get('exitReason', 'UNKNOWN')
        exit_reason_stats[exit_reason] += 1
    
    print(f"\n退出原因统计:")
    for reason, count in sorted(exit_reason_stats.items(), key=lambda x: x[1], reverse=True):
        print(f"  {reason}: {count}次")
    
    # 6. 总结
    print("\n" + "=" * 80)
    print("6. 总结")
    print("=" * 80)
    
    total_issues = len(buy_issues) + len(sell_issues) + len(capital_issues) + len(position_issues)
    
    if total_issues == 0:
        print("\n✅ 所有交易逻辑检查通过！回测数据符合实际交易逻辑。")
    else:
        print(f"\n⚠️  共发现 {total_issues} 个潜在问题:")
        print(f"  - 买入逻辑问题: {len(buy_issues)}")
        print(f"  - 卖出逻辑问题: {len(sell_issues)}")
        print(f"  - 资金管理问题: {len(capital_issues)}")
        print(f"  - 持仓管理问题: {len(position_issues)}")
        print("\n建议：")
        print("  1. 检查回测代码中的买入/卖出逻辑")
        print("  2. 确认资金管理是否正确扣除和收回")
        print("  3. 验证止损止盈逻辑是否正确执行")
        print("  4. 检查是否有重复持仓或重复买入的情况")

if __name__ == '__main__':
    import sys
    json_file = sys.argv[1] if len(sys.argv) > 1 else 'backtest_5_2024-01-01_2025-12-15_49.json'
    analyze_backtest_logic(json_file)

