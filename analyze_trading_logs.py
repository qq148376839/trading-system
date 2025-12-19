#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
分析交易日志，查找问题根源
"""
import json
import re
from collections import Counter, defaultdict
from datetime import datetime

def load_logs(filepath):
    """加载JSON日志文件"""
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data.get('data', {}).get('logs', [])

def analyze_logs():
    """分析日志"""
    print("=" * 80)
    print("交易日志分析报告")
    print("=" * 80)
    
    # 加载日志
    print("\n正在加载日志文件...")
    warning_logs = load_logs('logs-2025-12-17 warning.json')
    info_logs = load_logs('logs-2025-12-17 info.json')
    
    print(f"警告日志数量: {len(warning_logs)}")
    print(f"信息日志数量: {len(info_logs)}")
    
    # 1. 分析买入/卖出订单
    print("\n" + "=" * 80)
    print("1. 买入/卖出订单分析")
    print("=" * 80)
    
    buy_patterns = [r'BUY', r'买入', r'side.*BUY', r'order.*buy']
    sell_patterns = [r'SELL', r'卖出', r'side.*SELL', r'order.*sell']
    
    buy_count = 0
    sell_count = 0
    buy_details = []
    sell_details = []
    
    for log in info_logs:
        msg = log.get('message', '').upper()
        if any(re.search(p, msg, re.IGNORECASE) for p in buy_patterns):
            buy_count += 1
            buy_details.append({
                'time': log.get('timestamp'),
                'message': log.get('message'),
                'module': log.get('module')
            })
        if any(re.search(p, msg, re.IGNORECASE) for p in sell_patterns):
            sell_count += 1
            sell_details.append({
                'time': log.get('timestamp'),
                'message': log.get('message'),
                'module': log.get('module')
            })
    
    print(f"买入订单相关日志: {buy_count}")
    print(f"卖出订单相关日志: {sell_count}")
    
    if buy_count == 0:
        print("\n⚠️  警告: 没有发现买入订单相关日志！")
    
    # 2. 分析市场环境获取失败
    print("\n" + "=" * 80)
    print("2. 市场环境获取失败分析")
    print("=" * 80)
    
    market_env_patterns = [
        r'市场环境',
        r'market.*environment',
        r'获取.*失败',
        r'fetch.*fail',
        r'获取市场环境',
        r'获取失败',
        r'environment.*fail',
        r'市场.*获取'
    ]
    
    market_env_errors = []
    for log in warning_logs:
        msg = log.get('message', '')
        if any(re.search(p, msg, re.IGNORECASE) for p in market_env_patterns):
            market_env_errors.append(log)
    
    print(f"市场环境获取失败次数: {len(market_env_errors)}")
    if market_env_errors:
        print("\n前10条错误详情:")
        for i, log in enumerate(market_env_errors[:10], 1):
            print(f"\n{i}. 时间: {log.get('timestamp')}")
            print(f"   模块: {log.get('module')}")
            print(f"   消息: {log.get('message')}")
            print(f"   追踪ID: {log.get('traceId')}")
    
    # 3. 分析未找到订单
    print("\n" + "=" * 80)
    print("3. 未找到订单分析")
    print("=" * 80)
    
    order_not_found_patterns = [
        r'未找到订单',
        r'order.*not.*found',
        r'找不到订单',
        r'订单.*不存在',
        r'未找到.*订单'
    ]
    
    order_not_found_errors = []
    order_ids = Counter()
    
    for log in warning_logs:
        msg = log.get('message', '')
        if any(re.search(p, msg, re.IGNORECASE) for p in order_not_found_patterns):
            order_not_found_errors.append(log)
            # 提取订单ID
            order_id_match = re.search(r'(\d{16,})', msg)
            if order_id_match:
                order_ids[order_id_match.group(1)] += 1
    
    print(f"未找到订单错误次数: {len(order_not_found_errors)}")
    print(f"涉及的订单ID数量: {len(order_ids)}")
    
    if order_ids:
        print("\n最频繁出现的订单ID (前10个):")
        for order_id, count in order_ids.most_common(10):
            print(f"  订单ID: {order_id}, 出现次数: {count}")
    
    if order_not_found_errors:
        print("\n前10条错误详情:")
        for i, log in enumerate(order_not_found_errors[:10], 1):
            print(f"\n{i}. 时间: {log.get('timestamp')}")
            print(f"   模块: {log.get('module')}")
            print(f"   消息: {log.get('message')}")
    
    # 4. 分析接口调用频繁/限流
    print("\n" + "=" * 80)
    print("4. 接口调用频繁/限流分析")
    print("=" * 80)
    
    rate_limit_patterns = [
        r'频繁',
        r'rate.*limit',
        r'429',
        r'throttle',
        r'too.*many',
        r'请求.*频繁',
        r'调用.*频繁',
        r'限流',
        r'频率.*限制'
    ]
    
    rate_limit_errors = []
    for log in warning_logs:
        msg = log.get('message', '')
        if any(re.search(p, msg, re.IGNORECASE) for p in rate_limit_patterns):
            rate_limit_errors.append(log)
    
    print(f"接口调用频繁/限流错误次数: {len(rate_limit_errors)}")
    if rate_limit_errors:
        print("\n前10条错误详情:")
        for i, log in enumerate(rate_limit_errors[:10], 1):
            print(f"\n{i}. 时间: {log.get('timestamp')}")
            print(f"   模块: {log.get('module')}")
            print(f"   消息: {log.get('message')}")
    
    # 5. 按模块统计错误
    print("\n" + "=" * 80)
    print("5. 按模块统计错误")
    print("=" * 80)
    
    module_errors = Counter()
    for log in warning_logs:
        module = log.get('module', 'Unknown')
        module_errors[module] += 1
    
    print("各模块错误统计:")
    for module, count in module_errors.most_common(10):
        print(f"  {module}: {count} 条")
    
    # 6. 按时间分布分析
    print("\n" + "=" * 80)
    print("6. 错误时间分布分析")
    print("=" * 80)
    
    hour_errors = Counter()
    for log in warning_logs:
        timestamp = log.get('timestamp', '')
        if timestamp:
            try:
                dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                hour_errors[dt.hour] += 1
            except:
                pass
    
    print("各小时错误分布:")
    for hour in sorted(hour_errors.keys()):
        print(f"  {hour:02d}:00 - {hour_errors[hour]} 条错误")
    
    # 7. 总结和建议
    print("\n" + "=" * 80)
    print("7. 问题总结和建议")
    print("=" * 80)
    
    issues = []
    
    if buy_count == 0:
        issues.append({
            'severity': 'HIGH',
            'issue': '没有买入订单',
            'description': '日志中只发现卖出订单，没有买入订单。这可能表示：1) 策略只执行卖出操作；2) 买入订单创建失败但未记录错误；3) 买入订单被过滤或拒绝',
            'suggestion': '检查策略逻辑、订单创建流程、以及买入订单的过滤条件'
        })
    
    if len(market_env_errors) > 10:
        issues.append({
            'severity': 'MEDIUM',
            'issue': '市场环境获取频繁失败',
            'description': f'发现 {len(market_env_errors)} 次市场环境获取失败',
            'suggestion': '检查市场环境API的稳定性、网络连接、以及重试机制'
        })
    
    if len(order_not_found_errors) > 10:
        issues.append({
            'severity': 'MEDIUM',
            'issue': '频繁出现未找到订单错误',
            'description': f'发现 {len(order_not_found_errors)} 次未找到订单错误，涉及 {len(order_ids)} 个订单ID',
            'suggestion': '检查订单创建和查询的时序问题、订单ID的生成和存储逻辑'
        })
    
    if len(rate_limit_errors) > 0:
        issues.append({
            'severity': 'HIGH',
            'issue': '接口调用频繁/限流',
            'description': f'发现 {len(rate_limit_errors)} 次接口调用频繁或限流错误',
            'suggestion': '实现请求限流、增加重试间隔、优化API调用频率'
        })
    
    for i, issue in enumerate(issues, 1):
        print(f"\n问题 {i}: {issue['issue']} [{issue['severity']}]")
        print(f"  描述: {issue['description']}")
        print(f"  建议: {issue['suggestion']}")
    
    if not issues:
        print("\n✅ 未发现明显问题")

if __name__ == '__main__':
    analyze_logs()

