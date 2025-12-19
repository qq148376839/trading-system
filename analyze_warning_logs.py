#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
分析Warning日志文件
提取关键信息和问题
"""

import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from typing import Dict, List, Any

def load_json_file(filepath: str) -> Any:
    """加载JSON文件"""
    try:
        print(f"📂 正在加载文件: {filepath}")
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        print(f"✅ 文件加载成功")
        return data
    except Exception as e:
        print(f"❌ 加载文件失败: {e}")
        return None

def analyze_warning_logs(logs_data: Any) -> Dict[str, Any]:
    """分析Warning日志"""
    analysis = {
        'total_warnings': 0,
        'modules': Counter(),
        'warning_types': Counter(),
        'warning_messages': [],
        'strategy_warnings': defaultdict(list),
        'symbol_warnings': defaultdict(list),
        'common_warnings': Counter(),
        'timeline': [],
    }
    
    if not logs_data:
        return analysis
    
    # 确定日志数组
    if isinstance(logs_data, list):
        logs = logs_data
    elif isinstance(logs_data, dict):
        # 尝试找到日志数组
        if 'data' in logs_data and isinstance(logs_data['data'], dict):
            # 处理嵌套的data结构
            data = logs_data['data']
            if 'logs' in data and isinstance(data['logs'], list):
                logs = data['logs']
            elif isinstance(data, list):
                logs = data
            else:
                logs = []
        elif 'logs' in logs_data and isinstance(logs_data['logs'], list):
            logs = logs_data['logs']
        elif 'data' in logs_data and isinstance(logs_data['data'], list):
            logs = logs_data['data']
        else:
            # 如果找不到，假设整个字典就是一条日志
            logs = [logs_data]
    else:
        logs = []
    
    analysis['total_warnings'] = len(logs)
    print(f"📊 找到 {len(logs)} 条Warning日志")
    
    # 分析每条日志
    for i, log_entry in enumerate(logs):
        if i % 1000 == 0:
            print(f"   处理进度: {i}/{len(logs)}")
        
        # 提取基本信息
        module = log_entry.get('module', 'Unknown')
        message = log_entry.get('message', '')
        timestamp = log_entry.get('timestamp')
        extra_data = log_entry.get('extraData') or {}
        if not isinstance(extra_data, dict):
            extra_data = {}
        
        analysis['modules'][module] += 1
        
        # 提取关键信息（从消息中提取symbol）
        strategy_id = extra_data.get('strategy_id') or extra_data.get('strategyId')
        symbol = extra_data.get('symbol')
        
        # 从消息中提取symbol（如果消息中包含标的代码）
        if not symbol:
            if '标的' in message:
                parts = message.split('标的')
                if len(parts) > 1:
                    symbol = parts[1].split(':')[0].split(')')[0].split('(')[0].strip()
            elif '.US' in message or '.HK' in message:
                # 尝试从消息中提取股票代码
                import re
                match = re.search(r'([A-Z]+\.(US|HK))', message)
                if match:
                    symbol = match.group(1)
        
        # 分类警告类型
        warning_type = classify_warning(message)
        analysis['warning_types'][warning_type] += 1
        
        # 记录警告详情
        warning_detail = {
            'timestamp': timestamp,
            'module': module,
            'message': message[:200],  # 限制长度
            'strategy_id': strategy_id,
            'symbol': symbol,
            'type': warning_type,
            'extra_data': extra_data
        }
        analysis['warning_messages'].append(warning_detail)
        
        # 按策略分组
        if strategy_id:
            analysis['strategy_warnings'][strategy_id].append(warning_detail)
        
        # 按标的分组
        if symbol:
            analysis['symbol_warnings'][symbol].append(warning_detail)
        
        # 统计常见警告
        analysis['common_warnings'][message[:100]] += 1
        
        # 时间线
        if timestamp:
            try:
                if isinstance(timestamp, str):
                    dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                else:
                    dt = datetime.fromtimestamp(timestamp)
                analysis['timeline'].append({
                    'time': dt,
                    'message': message[:100],
                    'module': module,
                    'symbol': symbol
                })
            except:
                pass
    
    # 排序时间线
    analysis['timeline'].sort(key=lambda x: x['time'])
    
    return analysis

def classify_warning(message: str) -> str:
    """分类警告类型"""
    message_lower = message.lower()
    
    if '验证' in message or 'validation' in message_lower or '阻止' in message:
        return '验证失败'
    elif '资金' in message or 'capital' in message_lower or '余额' in message:
        return '资金问题'
    elif '订单' in message or 'order' in message_lower:
        return '订单问题'
    elif '持仓' in message or 'position' in message_lower:
        return '持仓问题'
    elif '价格' in message or 'price' in message_lower:
        return '价格问题'
    elif '信号' in message or 'signal' in message_lower:
        return '信号问题'
    elif '状态' in message or 'state' in message_lower or 'status' in message_lower:
        return '状态问题'
    elif 'api' in message_lower or '请求' in message or 'timeout' in message_lower:
        return 'API问题'
    elif '错误' in message or 'error' in message_lower or '失败' in message:
        return '执行错误'
    elif '跳过' in message or 'skip' in message_lower:
        return '跳过执行'
    else:
        return '其他'

def print_analysis_report(analysis: Dict[str, Any]):
    """打印分析报告"""
    print("\n" + "=" * 80)
    print("📊 Warning日志分析报告")
    print("=" * 80)
    print()
    
    # 基本统计
    print("📋 基本统计")
    print("-" * 80)
    print(f"总Warning数量: {analysis['total_warnings']}")
    print(f"涉及模块数: {len(analysis['modules'])}")
    print(f"涉及策略数: {len(analysis['strategy_warnings'])}")
    print(f"涉及标的数: {len(analysis['symbol_warnings'])}")
    print()
    
    # 模块分布
    print("📋 模块分布（Top 10）")
    print("-" * 80)
    for module, count in analysis['modules'].most_common(10):
        print(f"  {module}: {count}")
    print()
    
    # 警告类型分布
    print("📋 警告类型分布")
    print("-" * 80)
    for warning_type, count in analysis['warning_types'].most_common():
        print(f"  {warning_type}: {count}")
    print()
    
    # 常见警告（Top 10）
    print("📋 最常见警告（Top 10）")
    print("-" * 80)
    for i, (message, count) in enumerate(analysis['common_warnings'].most_common(10), 1):
        print(f"{i}. [{count}次] {message[:80]}...")
    print()
    
    # 按策略统计
    if analysis['strategy_warnings']:
        print("📋 按策略统计（Top 5）")
        print("-" * 80)
        strategy_counts = [(sid, len(warnings)) for sid, warnings in analysis['strategy_warnings'].items()]
        strategy_counts.sort(key=lambda x: x[1], reverse=True)
        for strategy_id, count in strategy_counts[:5]:
            print(f"  策略 {strategy_id}: {count} 条警告")
        print()
    
    # 按标的统计
    if analysis['symbol_warnings']:
        print("📋 按标的统计（Top 10）")
        print("-" * 80)
        symbol_counts = [(symbol, len(warnings)) for symbol, warnings in analysis['symbol_warnings'].items()]
        symbol_counts.sort(key=lambda x: x[1], reverse=True)
        for symbol, count in symbol_counts[:10]:
            print(f"  {symbol}: {count} 条警告")
        print()
    
    # 时间分布
    if analysis['timeline']:
        print("📋 时间分布")
        print("-" * 80)
        if len(analysis['timeline']) > 0:
            first_time = analysis['timeline'][0]['time']
            last_time = analysis['timeline'][-1]['time']
            print(f"  最早警告: {first_time}")
            print(f"  最晚警告: {last_time}")
            print(f"  时间跨度: {last_time - first_time}")
        print()
    
    # 关键问题识别
    print("🚨 关键问题识别")
    print("=" * 80)
    
    issues = []
    
    # 1. 验证失败
    validation_failures = [w for w in analysis['warning_messages'] if w['type'] == '验证失败']
    if validation_failures:
        issues.append({
            'severity': 'HIGH',
            'title': f'策略执行验证失败: {len(validation_failures)} 次',
            'description': '策略生成的信号被验证逻辑阻止执行',
            'examples': validation_failures[:5]
        })
    
    # 2. 资金问题
    capital_issues = [w for w in analysis['warning_messages'] if w['type'] == '资金问题']
    if capital_issues:
        issues.append({
            'severity': 'HIGH',
            'title': f'资金相关问题: {len(capital_issues)} 次',
            'description': '可能存在资金不足、资金分配等问题',
            'examples': capital_issues[:5]
        })
    
    # 3. 订单问题
    order_issues = [w for w in analysis['warning_messages'] if w['type'] == '订单问题']
    if order_issues:
        issues.append({
            'severity': 'MEDIUM',
            'title': f'订单相关问题: {len(order_issues)} 次',
            'description': '订单执行、状态更新等问题',
            'examples': order_issues[:5]
        })
    
    # 4. 持仓问题
    position_issues = [w for w in analysis['warning_messages'] if w['type'] == '持仓问题']
    if position_issues:
        issues.append({
            'severity': 'MEDIUM',
            'title': f'持仓相关问题: {len(position_issues)} 次',
            'description': '持仓检查、持仓状态等问题',
            'examples': position_issues[:5]
        })
    
    # 5. 信号问题
    signal_issues = [w for w in analysis['warning_messages'] if w['type'] == '信号问题']
    if signal_issues:
        issues.append({
            'severity': 'MEDIUM',
            'title': f'信号相关问题: {len(signal_issues)} 次',
            'description': '信号生成、信号执行等问题',
            'examples': signal_issues[:5]
        })
    
    if not issues:
        print("✅ 未发现明显问题")
    else:
        for i, issue in enumerate(issues, 1):
            severity_icon = {'HIGH': '🔴', 'MEDIUM': '🟡', 'LOW': '🟢'}.get(issue['severity'], '⚪')
            print(f"\n{i}. {severity_icon} [{issue['severity']}] {issue['title']}")
            print(f"   描述: {issue['description']}")
            print(f"   示例:")
            for example in issue['examples']:
                print(f"     - [{example['timestamp']}] {example['symbol'] or 'N/A'}: {example['message'][:100]}")
    
    print()
    print("=" * 80)

def save_detailed_report(analysis: Dict[str, Any], output_file: str):
    """保存详细报告到JSON文件"""
    report = {
        'analysis_date': datetime.now().isoformat(),
        'summary': {
            'total_warnings': analysis['total_warnings'],
            'modules_count': len(analysis['modules']),
            'strategies_count': len(analysis['strategy_warnings']),
            'symbols_count': len(analysis['symbol_warnings']),
        },
        'modules': dict(analysis['modules']),
        'warning_types': dict(analysis['warning_types']),
        'top_warnings': [
            {
                'message': msg,
                'count': count
            }
            for msg, count in analysis['common_warnings'].most_common(20)
        ],
        'strategy_summary': {
            str(sid): len(warnings)
            for sid, warnings in analysis['strategy_warnings'].items()
        },
        'symbol_summary': {
            symbol: len(warnings)
            for symbol, warnings in analysis['symbol_warnings'].items()
        },
        'key_issues': [
            {
                'type': w['type'],
                'message': w['message'],
                'symbol': w['symbol'],
                'strategy_id': w['strategy_id'],
                'timestamp': w['timestamp']
            }
            for w in analysis['warning_messages']
            if w['type'] in ['验证失败', '资金问题', '订单问题']
        ][:50]  # 只保存前50条关键问题
    }
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    
    print(f"\n💾 详细报告已保存到: {output_file}")

def main():
    """主函数"""
    print("🔍 开始分析Warning日志...")
    print()
    
    # 加载数据
    logs_data = load_json_file('logs-2025-12-16 (1).json')
    
    if not logs_data:
        print("❌ 无法加载日志文件")
        sys.exit(1)
    
    # 分析数据
    print("\n🔬 分析数据...")
    analysis = analyze_warning_logs(logs_data)
    
    # 打印报告
    print_analysis_report(analysis)
    
    # 保存详细报告
    save_detailed_report(analysis, 'warning_logs_analysis_report.json')
    
    print("\n✅ 分析完成！")

if __name__ == '__main__':
    main()

