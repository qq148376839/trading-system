#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
详细分析交易日志
"""
import json
import re
from collections import Counter, defaultdict
from datetime import datetime

def analyze_logs():
    """分析日志"""
    print("=" * 100)
    print("交易日志详细分析报告 - 2025-12-17")
    print("=" * 100)
    
    # 加载日志
    print("\n[1/6] 正在加载日志文件...")
    try:
        with open('logs-2025-12-17 warning.json', 'r', encoding='utf-8') as f:
            warning_data = json.load(f)
        warning_logs = warning_data.get('data', {}).get('logs', [])
        print(f"✓ 警告日志数量: {len(warning_logs)}")
    except Exception as e:
        print(f"✗ 加载警告日志失败: {e}")
        warning_logs = []
    
    try:
        with open('logs-2025-12-17 info.json', 'r', encoding='utf-8') as f:
            info_data = json.load(f)
        info_logs = info_data.get('data', {}).get('logs', [])
        print(f"✓ 信息日志数量: {len(info_logs)}")
    except Exception as e:
        print(f"✗ 加载信息日志失败: {e}")
        info_logs = []
    
    # ========== 1. 买入/卖出订单分析 ==========
    print("\n" + "=" * 100)
    print("[2/6] 买入/卖出订单分析")
    print("=" * 100)
    
    buy_keywords = ['BUY', '买入', 'buy']
    sell_keywords = ['SELL', '卖出', 'sell']
    
    buy_logs = []
    sell_logs = []
    
    for log in info_logs:
        msg = log.get('message', '').upper()
        module = log.get('module', '')
        
        # 检查买入
        if any(kw in msg for kw in buy_keywords):
            buy_logs.append({
                'time': log.get('timestamp'),
                'message': log.get('message'),
                'module': module
            })
        
        # 检查卖出
        if any(kw in msg for kw in sell_keywords):
            sell_logs.append({
                'time': log.get('timestamp'),
                'message': log.get('message'),
                'module': module
            })
    
    print(f"\n买入订单相关日志: {len(buy_logs)} 条")
    print(f"卖出订单相关日志: {len(sell_logs)} 条")
    
    if len(buy_logs) == 0:
        print("\n⚠️  严重警告: 没有发现买入订单相关日志！")
        print("可能原因:")
        print("  1. 策略逻辑只执行卖出操作（平仓）")
        print("  2. 买入订单创建失败但未记录错误")
        print("  3. 买入订单被过滤或拒绝（资金不足、风险控制等）")
        print("  4. 买入信号未生成或未触发")
    else:
        print("\n买入订单示例（前5条）:")
        for i, log in enumerate(buy_logs[:5], 1):
            print(f"  {i}. [{log['time']}] {log['module']}: {log['message'][:100]}")
    
    if len(sell_logs) > 0:
        print("\n卖出订单示例（前5条）:")
        for i, log in enumerate(sell_logs[:5], 1):
            print(f"  {i}. [{log['time']}] {log['module']}: {log['message'][:100]}")
    
    # ========== 2. 市场环境获取失败分析 ==========
    print("\n" + "=" * 100)
    print("[3/6] 市场环境获取失败分析")
    print("=" * 100)
    
    market_env_patterns = [
        r'获取市场环境失败',
        r'获取.*失败',
        r'market.*environment.*fail',
        r'calculateRecommendation.*fail'
    ]
    
    market_env_errors = []
    for log in warning_logs:
        msg = log.get('message', '')
        if any(re.search(p, msg, re.IGNORECASE) for p in market_env_patterns):
            market_env_errors.append(log)
    
    print(f"\n市场环境获取失败次数: {len(market_env_errors)}")
    
    if market_env_errors:
        print("\n错误详情（前10条）:")
        for i, log in enumerate(market_env_errors[:10], 1):
            print(f"\n  {i}. 时间: {log.get('timestamp')}")
            print(f"     模块: {log.get('module')}")
            print(f"     消息: {log.get('message')}")
            if log.get('extraData'):
                print(f"     额外数据: {log.get('extraData')}")
        
        # 按模块统计
        module_stats = Counter(log.get('module') for log in market_env_errors)
        print("\n按模块统计:")
        for module, count in module_stats.most_common():
            print(f"  {module}: {count} 次")
        
        # 按时间分布
        hour_stats = Counter()
        for log in market_env_errors:
            timestamp = log.get('timestamp', '')
            if timestamp:
                try:
                    dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                    hour_stats[dt.hour] += 1
                except:
                    pass
        
        if hour_stats:
            print("\n按小时分布:")
            for hour in sorted(hour_stats.keys()):
                print(f"  {hour:02d}:00 - {hour_stats[hour]} 次")
    else:
        print("\n✓ 未发现市场环境获取失败的错误")
    
    # ========== 3. 未找到订单分析 ==========
    print("\n" + "=" * 100)
    print("[4/6] 未找到订单分析")
    print("=" * 100)
    
    order_not_found_patterns = [
        r'未找到订单.*关联的信号',
        r'order.*not.*found',
        r'找不到订单'
    ]
    
    order_not_found_errors = []
    order_ids = Counter()
    symbols = Counter()
    
    for log in warning_logs:
        msg = log.get('message', '')
        if any(re.search(p, msg, re.IGNORECASE) for p in order_not_found_patterns):
            order_not_found_errors.append(log)
            
            # 提取订单ID
            order_id_match = re.search(r'(\d{16,})', msg)
            if order_id_match:
                order_ids[order_id_match.group(1)] += 1
            
            # 提取标的代码
            symbol_match = re.search(r'symbol=([A-Z0-9.]+)', msg)
            if symbol_match:
                symbols[symbol_match.group(1)] += 1
    
    print(f"\n未找到订单错误次数: {len(order_not_found_errors)}")
    print(f"涉及的订单ID数量: {len(order_ids)}")
    print(f"涉及的标的数量: {len(symbols)}")
    
    if order_not_found_errors:
        print("\n最频繁出现的订单ID（前10个）:")
        for order_id, count in order_ids.most_common(10):
            print(f"  订单ID: {order_id}, 出现次数: {count}")
        
        print("\n最频繁出现的标的（前10个）:")
        for symbol, count in symbols.most_common(10):
            print(f"  {symbol}: {count} 次")
        
        print("\n错误详情（前10条）:")
        for i, log in enumerate(order_not_found_errors[:10], 1):
            print(f"\n  {i}. 时间: {log.get('timestamp')}")
            print(f"     模块: {log.get('module')}")
            print(f"     消息: {log.get('message')}")
        
        # 分析原因
        print("\n可能原因分析:")
        print("  1. 订单创建时未创建对应的信号记录")
        print("  2. 信号和订单的时间窗口匹配失败（时间差过大）")
        print("  3. 订单的strategy_id、symbol、side与信号不匹配")
        print("  4. 信号记录被删除或未正确保存")
    else:
        print("\n✓ 未发现未找到订单的错误")
    
    # ========== 4. 接口调用频繁/限流分析 ==========
    print("\n" + "=" * 100)
    print("[5/6] 接口调用频繁/限流分析")
    print("=" * 100)
    
    rate_limit_patterns = [
        r'429',
        r'rate.*limit',
        r'频繁',
        r'throttle',
        r'too.*many.*request',
        r'请求.*频繁',
        r'调用.*频繁',
        r'限流'
    ]
    
    rate_limit_errors = []
    for log in warning_logs:
        msg = log.get('message', '')
        if any(re.search(p, msg, re.IGNORECASE) for p in rate_limit_patterns):
            rate_limit_errors.append(log)
    
    print(f"\n接口调用频繁/限流错误次数: {len(rate_limit_errors)}")
    
    if rate_limit_errors:
        print("\n错误详情（前10条）:")
        for i, log in enumerate(rate_limit_errors[:10], 1):
            print(f"\n  {i}. 时间: {log.get('timestamp')}")
            print(f"     模块: {log.get('module')}")
            print(f"     消息: {log.get('message')}")
        
        # 按模块统计
        module_stats = Counter(log.get('module') for log in rate_limit_errors)
        print("\n按模块统计:")
        for module, count in module_stats.most_common():
            print(f"  {module}: {count} 次")
    else:
        print("\n✓ 未发现接口调用频繁或限流的错误")
    
    # ========== 5. 按模块统计所有错误 ==========
    print("\n" + "=" * 100)
    print("[6/6] 按模块统计所有警告")
    print("=" * 100)
    
    module_errors = Counter()
    for log in warning_logs:
        module = log.get('module', 'Unknown')
        module_errors[module] += 1
    
    print("\n各模块警告统计（前15个）:")
    for module, count in module_errors.most_common(15):
        print(f"  {module}: {count} 条")
    
    # ========== 6. 总结和建议 ==========
    print("\n" + "=" * 100)
    print("问题总结和建议")
    print("=" * 100)
    
    issues = []
    
    if len(buy_logs) == 0:
        issues.append({
            'severity': 'HIGH',
            'issue': '没有买入订单',
            'description': '日志中只发现卖出订单，没有买入订单',
            'suggestions': [
                '检查策略逻辑，确认是否只执行卖出操作（平仓）',
                '检查买入订单创建流程，确认是否有错误但未记录',
                '检查资金管理，确认是否有可用资金',
                '检查风险控制，确认买入订单是否被过滤',
                '检查买入信号生成逻辑，确认是否生成了买入信号'
            ]
        })
    
    if len(market_env_errors) > 10:
        issues.append({
            'severity': 'MEDIUM',
            'issue': '市场环境获取频繁失败',
            'description': f'发现 {len(market_env_errors)} 次市场环境获取失败',
            'suggestions': [
                '检查 tradingRecommendationService.calculateRecommendation() 的稳定性',
                '检查市场数据API的可用性（SPX、USD Index、BTC等）',
                '检查网络连接和API响应时间',
                '增加重试机制和错误处理',
                '检查API调用频率是否过高'
            ]
        })
    
    if len(order_not_found_errors) > 10:
        issues.append({
            'severity': 'MEDIUM',
            'issue': '频繁出现未找到订单关联的信号',
            'description': f'发现 {len(order_not_found_errors)} 次未找到订单关联的信号错误',
            'suggestions': [
                '检查订单创建时是否同时创建了信号记录',
                '检查信号和订单的时间窗口匹配逻辑（时间差是否过大）',
                '检查订单的strategy_id、symbol、side是否与信号匹配',
                '检查信号记录是否正确保存到数据库',
                '考虑放宽时间窗口匹配条件'
            ]
        })
    
    if len(rate_limit_errors) > 0:
        issues.append({
            'severity': 'HIGH',
            'issue': '接口调用频繁/限流',
            'description': f'发现 {len(rate_limit_errors)} 次接口调用频繁或限流错误',
            'suggestions': [
                '检查API调用频率，确保不超过限制',
                '使用ApiRateLimiterService进行请求限流',
                '增加请求间隔时间',
                '优化批量查询逻辑，减少API调用次数',
                '实现请求队列和重试机制'
            ]
        })
    
    if issues:
        for i, issue in enumerate(issues, 1):
            print(f"\n问题 {i}: {issue['issue']} [{issue['severity']}]")
            print(f"  描述: {issue['description']}")
            print(f"  建议:")
            for j, suggestion in enumerate(issue['suggestions'], 1):
                print(f"    {j}. {suggestion}")
    else:
        print("\n✓ 未发现明显问题")
    
    print("\n" + "=" * 100)
    print("分析完成")
    print("=" * 100)

if __name__ == '__main__':
    analyze_logs()

