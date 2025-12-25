#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
交易策略问题分析脚本
分析日志文件和订单数据，找出交易策略的问题和错误
"""

import json
import sys
from datetime import datetime
from collections import defaultdict, Counter
from typing import Dict, List, Any

def load_json_file(filepath: str) -> Any:
    """加载JSON文件"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"❌ 加载文件失败 {filepath}: {e}")
        return None

def analyze_logs(logs_data: Any) -> Dict[str, Any]:
    """分析日志数据"""
    analysis = {
        'total_logs': 0,
        'log_levels': Counter(),
        'modules': Counter(),
        'errors': [],
        'warnings': [],
        'trading_signals': [],
        'order_executions': [],
        'validation_failures': [],
        'strategy_executions': defaultdict(list),
    }
    
    if not logs_data:
        return analysis
    
    # 如果logs_data是列表
    if isinstance(logs_data, list):
        logs = logs_data
    # 如果logs_data是字典，尝试找到日志数组
    elif isinstance(logs_data, dict):
        # 尝试常见的键名
        for key in ['logs', 'data', 'items', 'entries']:
            if key in logs_data and isinstance(logs_data[key], list):
                logs = logs_data[key]
                break
        else:
            # 如果找不到，假设整个字典就是一条日志
            logs = [logs_data]
    else:
        logs = []
    
    analysis['total_logs'] = len(logs)
    
    for log_entry in logs:
        # 提取日志级别
        level = log_entry.get('level', '').upper()
        if level:
            analysis['log_levels'][level] += 1
        
        # 提取模块
        module = log_entry.get('module', 'Unknown')
        analysis['modules'][module] += 1
        
        # 提取消息
        message = log_entry.get('message', '')
        
        # 查找错误
        if level == 'ERROR' or 'error' in message.lower() or 'exception' in message.lower():
            analysis['errors'].append({
                'timestamp': log_entry.get('timestamp'),
                'module': module,
                'message': message,
                'extra_data': log_entry.get('extraData')
            })
        
        # 查找警告
        if level == 'WARNING' or 'warn' in message.lower():
            analysis['warnings'].append({
                'timestamp': log_entry.get('timestamp'),
                'module': module,
                'message': message,
                'extra_data': log_entry.get('extraData')
            })
        
        # 查找交易信号
        if '信号' in message or 'signal' in message.lower() or 'BUY' in message or 'SELL' in message:
            analysis['trading_signals'].append({
                'timestamp': log_entry.get('timestamp'),
                'module': module,
                'message': message,
                'extra_data': log_entry.get('extraData')
            })
        
        # 查找订单执行
        if '订单' in message or 'order' in message.lower() or '下单' in message:
            analysis['order_executions'].append({
                'timestamp': log_entry.get('timestamp'),
                'module': module,
                'message': message,
                'extra_data': log_entry.get('extraData')
            })
        
        # 查找验证失败
        if '验证' in message or 'validation' in message.lower() or '阻止' in message:
            analysis['validation_failures'].append({
                'timestamp': log_entry.get('timestamp'),
                'module': module,
                'message': message,
                'extra_data': log_entry.get('extraData')
            })
        
        # 按策略ID分组
        if 'strategy_id' in str(log_entry.get('extraData', {})):
            strategy_id = log_entry.get('extraData', {}).get('strategy_id')
            if strategy_id:
                analysis['strategy_executions'][strategy_id].append(log_entry)
    
    return analysis

def analyze_orders(today_orders: Dict, history_orders: Dict) -> Dict[str, Any]:
    """分析订单数据"""
    analysis = {
        'today_orders': {
            'total': 0,
            'filled': 0,
            'symbols': Counter(),
            'sides': Counter(),
            'total_value': 0.0,
            'orders': []
        },
        'history_orders': {
            'total': 0,
            'filled': 0,
            'symbols': Counter(),
            'sides': Counter(),
            'total_value': 0.0,
        }
    }
    
    # 分析今日订单
    if today_orders and 'data' in today_orders and 'orders' in today_orders['data']:
        orders = today_orders['data']['orders']
        analysis['today_orders']['total'] = len(orders)
        
        for order in orders:
            symbol = order.get('symbol', '')
            side = order.get('side', '')
            status = order.get('status', '')
            quantity = float(order.get('executed_quantity', 0) or 0)
            price = float(order.get('executed_price', 0) or 0)
            
            analysis['today_orders']['symbols'][symbol] += 1
            analysis['today_orders']['sides'][side] += 1
            
            if status == 'FilledStatus':
                analysis['today_orders']['filled'] += 1
                value = quantity * price
                analysis['today_orders']['total_value'] += value
            
            analysis['today_orders']['orders'].append({
                'order_id': order.get('order_id'),
                'symbol': symbol,
                'side': side,
                'status': status,
                'quantity': quantity,
                'price': price,
                'executed_price': order.get('executed_price'),
                'submitted_at': order.get('submitted_at'),
                'updated_at': order.get('updated_at'),
            })
    
    # 分析历史订单（采样分析）
    if history_orders and 'data' in history_orders and 'orders' in history_orders['data']:
        orders = history_orders['data']['orders']
        # 只分析前1000条，避免内存问题
        sample_size = min(1000, len(orders))
        analysis['history_orders']['total'] = len(orders)
        
        for order in orders[:sample_size]:
            symbol = order.get('symbol', '')
            side = order.get('side', '')
            status = order.get('status', '')
            quantity = float(order.get('executed_quantity', 0) or 0)
            price = float(order.get('executed_price', 0) or 0)
            
            analysis['history_orders']['symbols'][symbol] += 1
            analysis['history_orders']['sides'][side] += 1
            
            if status == 'FilledStatus':
                analysis['history_orders']['filled'] += 1
                value = quantity * price
                analysis['history_orders']['total_value'] += value
    
    return analysis

def identify_issues(logs_analysis: Dict, orders_analysis: Dict) -> List[Dict[str, Any]]:
    """识别问题和错误"""
    issues = []
    
    # 1. 错误日志分析
    if logs_analysis['errors']:
        error_count = len(logs_analysis['errors'])
        issues.append({
            'severity': 'HIGH',
            'category': '错误日志',
            'title': f'发现 {error_count} 条错误日志',
            'description': '系统在执行过程中产生了错误',
            'details': logs_analysis['errors'][:10],  # 只显示前10条
            'recommendation': '检查错误日志，修复根本原因'
        })
    
    # 2. 警告日志分析
    if logs_analysis['warnings']:
        warning_count = len(logs_analysis['warnings'])
        issues.append({
            'severity': 'MEDIUM',
            'category': '警告日志',
            'title': f'发现 {warning_count} 条警告日志',
            'description': '系统在执行过程中产生了警告',
            'details': logs_analysis['warnings'][:10],
            'recommendation': '检查警告日志，优化策略逻辑'
        })
    
    # 3. 验证失败分析
    if logs_analysis['validation_failures']:
        validation_failures = logs_analysis['validation_failures']
        issues.append({
            'severity': 'MEDIUM',
            'category': '策略验证失败',
            'title': f'发现 {len(validation_failures)} 次策略执行验证失败',
            'description': '策略生成的信号被验证逻辑阻止执行',
            'details': validation_failures[:10],
            'recommendation': '检查验证逻辑是否过于严格，或策略信号是否合理'
        })
    
    # 4. 订单分析 - 全部是卖出订单
    today_orders = orders_analysis['today_orders']
    if today_orders['total'] > 0:
        sell_count = today_orders['sides'].get('Sell', 0)
        buy_count = today_orders['sides'].get('Buy', 0)
        
        if sell_count > 0 and buy_count == 0:
            issues.append({
                'severity': 'MEDIUM',
                'category': '交易方向',
                'title': '昨日全部为卖出订单，无买入订单',
                'description': f'共 {sell_count} 笔卖出订单，0 笔买入订单',
                'details': {
                    'sell_orders': sell_count,
                    'buy_orders': buy_count,
                    'symbols': dict(today_orders['symbols'])
                },
                'recommendation': '检查策略是否只生成卖出信号，或买入逻辑是否存在问题'
            })
    
    # 5. 价格执行差异分析
    if today_orders['orders']:
        price_differences = []
        for order in today_orders['orders']:
            if order['price'] > 0 and order['executed_price']:
                price = float(order['price'])
                executed_price = float(order['executed_price'])
                diff = abs(price - executed_price)
                diff_pct = (diff / price * 100) if price > 0 else 0
                
                if diff_pct > 0.1:  # 价格差异超过0.1%
                    price_differences.append({
                        'symbol': order['symbol'],
                        'order_id': order['order_id'],
                        'expected_price': price,
                        'executed_price': executed_price,
                        'difference': diff,
                        'difference_pct': diff_pct
                    })
        
        if price_differences:
            issues.append({
                'severity': 'LOW',
                'category': '价格执行差异',
                'title': f'发现 {len(price_differences)} 笔订单存在价格执行差异',
                'description': '订单执行价格与预期价格存在差异',
                'details': price_differences[:5],
                'recommendation': '检查限价单设置是否合理，或考虑使用市价单'
            })
    
    # 6. 交易信号与订单执行对比
    signal_count = len(logs_analysis['trading_signals'])
    order_count = today_orders['total']
    
    if signal_count > 0 and order_count > 0:
        signal_to_order_ratio = order_count / signal_count if signal_count > 0 else 0
        if signal_to_order_ratio < 0.5:
            issues.append({
                'severity': 'MEDIUM',
                'category': '信号执行率',
                'title': f'交易信号执行率较低: {signal_to_order_ratio:.2%}',
                'description': f'生成了 {signal_count} 个交易信号，但只执行了 {order_count} 笔订单',
                'details': {
                    'signals': signal_count,
                    'orders': order_count,
                    'ratio': signal_to_order_ratio
                },
                'recommendation': '检查信号生成逻辑和订单执行逻辑，找出信号未执行的原因'
            })
    
    return issues

def print_analysis_report(logs_analysis: Dict, orders_analysis: Dict, issues: List[Dict]):
    """打印分析报告"""
    print("=" * 80)
    print("📊 交易策略问题分析报告")
    print("=" * 80)
    print()
    
    # 日志分析摘要
    print("📋 日志分析摘要")
    print("-" * 80)
    print(f"总日志条数: {logs_analysis['total_logs']}")
    print(f"日志级别分布: {dict(logs_analysis['log_levels'])}")
    print(f"错误日志: {len(logs_analysis['errors'])} 条")
    print(f"警告日志: {len(logs_analysis['warnings'])} 条")
    print(f"交易信号: {len(logs_analysis['trading_signals'])} 条")
    print(f"订单执行: {len(logs_analysis['order_executions'])} 条")
    print(f"验证失败: {len(logs_analysis['validation_failures'])} 次")
    print()
    
    # 订单分析摘要
    print("📋 订单分析摘要")
    print("-" * 80)
    today = orders_analysis['today_orders']
    print(f"今日订单总数: {today['total']}")
    print(f"已成交订单: {today['filled']}")
    print(f"交易方向分布: {dict(today['sides'])}")
    print(f"交易标的分布: {dict(today['symbols'])}")
    print(f"总交易金额: ${today['total_value']:,.2f}")
    print()
    
    # 问题列表
    print("🚨 发现的问题和错误")
    print("=" * 80)
    
    if not issues:
        print("✅ 未发现明显问题")
    else:
        for i, issue in enumerate(issues, 1):
            severity_icon = {
                'HIGH': '🔴',
                'MEDIUM': '🟡',
                'LOW': '🟢'
            }.get(issue['severity'], '⚪')
            
            print(f"\n{i}. {severity_icon} [{issue['severity']}] {issue['category']}")
            print(f"   标题: {issue['title']}")
            print(f"   描述: {issue['description']}")
            print(f"   建议: {issue['recommendation']}")
            
            if issue.get('details'):
                print(f"   详情:")
                if isinstance(issue['details'], list):
                    for detail in issue['details'][:3]:
                        if isinstance(detail, dict):
                            print(f"     - {detail}")
                        else:
                            print(f"     - {detail}")
                elif isinstance(issue['details'], dict):
                    for key, value in list(issue['details'].items())[:5]:
                        print(f"     - {key}: {value}")
    
    print()
    print("=" * 80)

def main():
    """主函数"""
    print("🔍 开始分析交易策略...")
    print()
    
    # 加载数据
    print("📂 加载数据文件...")
    logs_data = load_json_file('logs-2025-12-16.json')
    today_orders = load_json_file('today.js')
    history_orders = load_json_file('history.js')
    
    if not logs_data:
        print("⚠️  警告: 无法加载日志文件，将跳过日志分析")
    
    if not today_orders:
        print("⚠️  警告: 无法加载今日订单文件")
        sys.exit(1)
    
    # 分析数据
    print("🔬 分析数据...")
    logs_analysis = analyze_logs(logs_data)
    orders_analysis = analyze_orders(today_orders, history_orders)
    
    # 识别问题
    print("🔍 识别问题...")
    issues = identify_issues(logs_analysis, orders_analysis)
    
    # 打印报告
    print_analysis_report(logs_analysis, orders_analysis, issues)
    
    # 保存详细报告到文件
    report = {
        'analysis_date': datetime.now().isoformat(),
        'logs_analysis': {
            'total_logs': logs_analysis['total_logs'],
            'log_levels': dict(logs_analysis['log_levels']),
            'error_count': len(logs_analysis['errors']),
            'warning_count': len(logs_analysis['warnings']),
            'signal_count': len(logs_analysis['trading_signals']),
            'validation_failure_count': len(logs_analysis['validation_failures']),
        },
        'orders_analysis': {
            'today_orders': {
                'total': orders_analysis['today_orders']['total'],
                'filled': orders_analysis['today_orders']['filled'],
                'sides': dict(orders_analysis['today_orders']['sides']),
                'symbols': dict(orders_analysis['today_orders']['symbols']),
                'total_value': orders_analysis['today_orders']['total_value'],
            }
        },
        'issues': issues
    }
    
    output_file = 'trading_strategy_analysis_report.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    
    print(f"💾 详细报告已保存到: {output_file}")

if __name__ == '__main__':
    main()




