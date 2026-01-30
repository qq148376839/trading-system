#!/usr/bin/env python3
"""
日志分析和清洗脚本
分析 logs-2026-01-27.json 文件，生成清晰的看板报告
"""

import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

def load_logs(file_path):
    """加载日志文件"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # 处理不同的JSON格式
            if isinstance(data, dict):
                # 格式1: {success, data: {logs: []}}
                if 'data' in data and isinstance(data['data'], dict) and 'logs' in data['data']:
                    return data['data']['logs']
                # 格式2: {logs: []}
                elif 'logs' in data:
                    return data['logs']
            elif isinstance(data, list):
                return data

            print(f"警告: 未识别的日志格式，尝试查找logs数组")
            print(f"数据结构: {list(data.keys()) if isinstance(data, dict) else type(data)}")
            return []
    except json.JSONDecodeError as e:
        print(f"JSON解析错误: {e}")
        # 尝试逐行解析
        logs = []
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        logs.append(json.loads(line))
                    except:
                        pass
        return logs
    except Exception as e:
        print(f"加载日志文件时出错: {e}")
        return []

def analyze_logs(logs):
    """分析日志数据"""
    # 按级别统计
    level_counts = Counter()
    # 按模块统计
    module_counts = Counter()
    # 错误信息分类
    errors = defaultdict(list)
    warnings = defaultdict(list)
    # 策略执行统计
    strategy_stats = defaultdict(lambda: {
        'executions': 0,
        'errors': [],
        'warnings': [],
        'signals': [],
        'orders': []
    })
    # 订单相关问题
    order_issues = []
    # API限流问题
    rate_limit_issues = []
    # 数据库错误
    db_errors = []
    # 期权相关问题
    option_issues = {
        'price_fetch_failures': [],  # 价格获取失败
        'option_chain_errors': [],   # 期权链错误
        'contract_selection_errors': [],  # 合约选择错误
        'other_option_errors': []    # 其他期权错误
    }

    for log in logs:
        level = log.get('level', 'UNKNOWN')
        module = log.get('module', 'UNKNOWN')
        message = log.get('message', '')
        timestamp = log.get('timestamp', '')

        level_counts[level] += 1
        module_counts[module] += 1

        # 错误分类
        if level == 'ERROR':
            error_key = f"{module}: {message[:100]}"
            errors[error_key].append({
                'timestamp': timestamp,
                'message': message,
                'extraData': log.get('extraData')
            })

            # 数据库错误
            if 'extraData' in log and isinstance(log['extraData'], dict):
                if log['extraData'].get('code') == '42P01':
                    db_errors.append({
                        'timestamp': timestamp,
                        'message': message,
                        'table': '验证失败日志表不存在'
                    })

        # 警告分类
        if level == 'WARNING':
            warning_key = f"{module}: {message[:100]}"
            warnings[warning_key].append({
                'timestamp': timestamp,
                'message': message
            })

            # 订单问题
            if '订单' in message or 'order' in message.lower():
                order_issues.append({
                    'timestamp': timestamp,
                    'message': message
                })

        # API限流问题
        if '429002' in str(log) or 'api request is limited' in message.lower():
            rate_limit_issues.append({
                'timestamp': timestamp,
                'module': module,
                'message': message
            })

        # 期权相关问题检测
        message_lower = message.lower()
        # 检测期权代码模式（例如：QQQ260128C634000）
        import re
        option_symbol_pattern = r'[A-Z]{1,5}\d{6}[CP]\d+'

        if re.search(option_symbol_pattern, message):
            # 这是期权相关的日志
            if level == 'WARNING':
                if '无法获取' in message and '市场价格' in message:
                    option_issues['price_fetch_failures'].append({
                        'timestamp': timestamp,
                        'message': message,
                        'module': module
                    })
                elif '价格偏离验证' in message:
                    option_issues['price_fetch_failures'].append({
                        'timestamp': timestamp,
                        'message': message,
                        'module': module
                    })
            elif level == 'ERROR':
                if '期权链' in message or 'option chain' in message_lower:
                    option_issues['option_chain_errors'].append({
                        'timestamp': timestamp,
                        'message': message,
                        'module': module
                    })
                elif '合约选择' in message or 'contract selection' in message_lower:
                    option_issues['contract_selection_errors'].append({
                        'timestamp': timestamp,
                        'message': message,
                        'module': module
                    })
                else:
                    option_issues['other_option_errors'].append({
                        'timestamp': timestamp,
                        'message': message,
                        'module': module
                    })

        # 策略执行统计
        if 'Strategy.Scheduler' in module:
            # 提取策略ID
            strategy_match = re.search(r'策略\s*(\d+)', message)
            if strategy_match:
                strategy_id = strategy_match.group(1)

                if '执行完成' in message:
                    strategy_stats[strategy_id]['executions'] += 1
                    # 提取执行信息
                    if 'extraData' in log and 'metadata' in log.get('extraData', {}):
                        metadata = log['extraData']['metadata']
                        strategy_stats[strategy_id]['last_execution'] = {
                            'timestamp': timestamp,
                            'duration': metadata.get('duration'),
                            'counts': metadata.get('counts'),
                            'errors': metadata.get('errors', []),
                            'signals': metadata.get('signals', []),
                        }

                if level == 'ERROR':
                    strategy_stats[strategy_id]['errors'].append(message)
                elif level == 'WARNING':
                    strategy_stats[strategy_id]['warnings'].append(message)

    return {
        'total_logs': len(logs),
        'level_counts': dict(level_counts),
        'module_counts': dict(sorted(module_counts.items(), key=lambda x: x[1], reverse=True)),
        'errors': dict(errors),
        'warnings': dict(warnings),
        'strategy_stats': dict(strategy_stats),
        'order_issues': order_issues,
        'rate_limit_issues': rate_limit_issues,
        'db_errors': db_errors,
        'option_issues': option_issues
    }

def generate_dashboard(analysis):
    """生成看板报告"""
    report_lines = []

    report_lines.append("=" * 80)
    report_lines.append("📊 日志分析看板")
    report_lines.append("=" * 80)
    report_lines.append("")

    # 概览
    report_lines.append("## 📈 概览")
    report_lines.append(f"总日志数: {analysis['total_logs']:,}")
    report_lines.append("")

    # 日志级别分布
    report_lines.append("### 日志级别分布")
    for level, count in sorted(analysis['level_counts'].items(), key=lambda x: x[1], reverse=True):
        emoji = {
            'ERROR': '🔴',
            'WARNING': '⚠️',
            'INFO': '🔵',
            'DEBUG': '🔍'
        }.get(level, '⚪')
        percentage = (count / analysis['total_logs'] * 100)
        report_lines.append(f"  {emoji} {level:10s}: {count:6,} ({percentage:5.2f}%)")
    report_lines.append("")

    # 模块活动 (Top 10)
    report_lines.append("### 🏗️ 模块活动 (Top 10)")
    for i, (module, count) in enumerate(list(analysis['module_counts'].items())[:10], 1):
        percentage = (count / analysis['total_logs'] * 100)
        report_lines.append(f"  {i:2d}. {module:40s}: {count:6,} ({percentage:5.2f}%)")
    report_lines.append("")

    # 关键问题
    report_lines.append("## 🚨 关键问题")
    report_lines.append("")

    # 数据库错误
    if analysis['db_errors']:
        report_lines.append(f"### ❌ 数据库错误 ({len(analysis['db_errors'])})")
        report_lines.append("问题: 验证失败日志表不存在 (错误码: 42P01)")
        db_error_count = len(analysis['db_errors'])
        report_lines.append(f"出现次数: {db_error_count:,}")
        if db_error_count > 0:
            report_lines.append(f"首次出现: {analysis['db_errors'][0]['timestamp']}")
            report_lines.append(f"最后出现: {analysis['db_errors'][-1]['timestamp']}")
        report_lines.append("建议: 检查数据库迁移，确保所有表已正确创建")
        report_lines.append("")

    # API限流问题
    if analysis['rate_limit_issues']:
        report_lines.append(f"### ⏱️ API限流问题 ({len(analysis['rate_limit_issues'])})")
        report_lines.append("错误: openapi error: code=429002 (API请求频率限制)")

        # 按模块分组
        rate_limit_by_module = defaultdict(int)
        for issue in analysis['rate_limit_issues']:
            rate_limit_by_module[issue['module']] += 1

        report_lines.append("按模块统计:")
        for module, count in sorted(rate_limit_by_module.items(), key=lambda x: x[1], reverse=True):
            report_lines.append(f"  - {module}: {count:,} 次")

        report_lines.append("建议: 实现请求速率控制，添加重试机制")
        report_lines.append("")

    # 期权相关问题
    if analysis.get('option_issues'):
        option_issues = analysis['option_issues']
        total_option_issues = sum(len(issues) for issues in option_issues.values())

        if total_option_issues > 0:
            report_lines.append(f"### 📊 期权交易问题 ({total_option_issues})")
            report_lines.append("")

            # 价格获取失败
            if option_issues['price_fetch_failures']:
                count = len(option_issues['price_fetch_failures'])
                report_lines.append(f"#### 期权价格获取失败 ({count} 次)")

                # 分析涉及的期权合约
                import re
                option_symbols = set()
                for issue in option_issues['price_fetch_failures']:
                    matches = re.findall(r'[A-Z]{1,5}\d{6}[CP]\d+', issue['message'])
                    option_symbols.update(matches)

                report_lines.append(f"涉及 {len(option_symbols)} 个不同的期权合约")
                if option_symbols:
                    report_lines.append("合约示例:")
                    for symbol in sorted(list(option_symbols)[:5]):
                        report_lines.append(f"  - {symbol}")

                # 显示时间范围
                if count > 0:
                    first_time = option_issues['price_fetch_failures'][0]['timestamp']
                    last_time = option_issues['price_fetch_failures'][-1]['timestamp']
                    report_lines.append(f"时间范围: {first_time} 至 {last_time}")

                report_lines.append("影响: 无法进行价格偏离验证，可能影响订单提交")
                report_lines.append("")

            # 期权链错误
            if option_issues['option_chain_errors']:
                count = len(option_issues['option_chain_errors'])
                report_lines.append(f"#### 期权链获取错误 ({count} 次)")
                report_lines.append("问题: 无法获取期权链数据")
                report_lines.append("影响: 无法进行期权合约选择和交易")
                report_lines.append("")

            # 合约选择错误
            if option_issues['contract_selection_errors']:
                count = len(option_issues['contract_selection_errors'])
                report_lines.append(f"#### 合约选择错误 ({count} 次)")
                report_lines.append("问题: 期权合约选择逻辑出现错误")
                report_lines.append("影响: 无法找到合适的期权合约进行交易")
                report_lines.append("")

            # 其他期权错误
            if option_issues['other_option_errors']:
                count = len(option_issues['other_option_errors'])
                report_lines.append(f"#### 其他期权相关错误 ({count} 次)")
                # 显示示例
                if count > 0:
                    report_lines.append("错误示例:")
                    for issue in option_issues['other_option_errors'][:3]:
                        report_lines.append(f"  [{issue['module']}] {issue['message'][:100]}")
                report_lines.append("")

    # 订单问题
    if analysis['order_issues']:
        report_lines.append(f"### 📦 订单相关问题 ({len(analysis['order_issues'])})")

        # 统计不同类型的订单问题
        order_issue_types = Counter()
        for issue in analysis['order_issues']:
            msg = issue['message']
            if '未找到订单' in msg and '关联的信号' in msg:
                order_issue_types['信号关联失败'] += 1
            elif '订单价格更新失败' in msg:
                order_issue_types['价格更新失败'] += 1
            elif 'Decimal' in msg:
                order_issue_types['数据类型错误'] += 1
            else:
                order_issue_types['其他'] += 1

        report_lines.append("问题类型:")
        for issue_type, count in order_issue_types.most_common():
            report_lines.append(f"  - {issue_type}: {count:,} 次")

        # 显示具体问题示例
        if order_issue_types['信号关联失败'] > 0:
            report_lines.append("")
            report_lines.append("典型问题示例:")
            for issue in analysis['order_issues'][:3]:
                if '未找到订单' in issue['message']:
                    report_lines.append(f"  - {issue['message'][:120]}...")
                    break

        report_lines.append("")

    # 策略执行统计
    if analysis['strategy_stats']:
        report_lines.append("## 📊 策略执行统计")
        report_lines.append("")

        for strategy_id, stats in sorted(analysis['strategy_stats'].items()):
            report_lines.append(f"### 策略 {strategy_id}")
            report_lines.append(f"执行次数: {stats['executions']:,}")

            if 'last_execution' in stats:
                last_exec = stats['last_execution']
                report_lines.append(f"最后执行: {last_exec['timestamp']}")
                report_lines.append(f"执行耗时: {last_exec.get('duration', 'N/A')} ms")

                if 'counts' in last_exec:
                    counts = last_exec['counts']
                    report_lines.append(f"标的状态: IDLE={counts.get('idle', 0)}, HOLDING={counts.get('holding', 0)}, OTHER={counts.get('other', 0)}")

                if last_exec.get('errors'):
                    report_lines.append(f"错误数: {len(last_exec['errors'])}")
                    report_lines.append("错误类型:")
                    for error in last_exec['errors'][:5]:  # 只显示前5个
                        report_lines.append(f"  - {error[:100]}")

                if last_exec.get('signals'):
                    report_lines.append(f"信号数: {len(last_exec['signals'])}")
                    report_lines.append(f"信号标的: {', '.join(last_exec['signals'][:10])}")

            if stats['errors']:
                report_lines.append(f"错误次数: {len(stats['errors'])}")

            if stats['warnings']:
                report_lines.append(f"警告次数: {len(stats['warnings'])}")

            report_lines.append("")

    # Top错误 (按出现次数)
    report_lines.append("## 🔴 Top 错误类型 (按出现次数)")
    report_lines.append("")

    error_counts = [(key, len(occurrences)) for key, occurrences in analysis['errors'].items()]
    error_counts.sort(key=lambda x: x[1], reverse=True)

    for i, (error_key, count) in enumerate(error_counts[:10], 1):
        report_lines.append(f"{i:2d}. {error_key[:100]}")
        report_lines.append(f"    出现次数: {count:,}")
        report_lines.append("")

    # Top警告 (按出现次数)
    report_lines.append("## ⚠️ Top 警告类型 (按出现次数)")
    report_lines.append("")

    warning_counts = [(key, len(occurrences)) for key, occurrences in analysis['warnings'].items()]
    warning_counts.sort(key=lambda x: x[1], reverse=True)

    for i, (warning_key, count) in enumerate(warning_counts[:10], 1):
        report_lines.append(f"{i:2d}. {warning_key[:100]}")
        report_lines.append(f"    出现次数: {count:,}")
        report_lines.append("")

    # 建议
    report_lines.append("## 💡 优化建议")
    report_lines.append("")

    recommendations = []
    rec_num = 1

    if analysis['db_errors']:
        recommendations.append(f"{rec_num}. 修复数据库表缺失问题 - 检查并创建缺失的验证失败日志表")
        rec_num += 1

    # 期权相关建议
    if analysis.get('option_issues'):
        option_issues = analysis['option_issues']

        if option_issues['price_fetch_failures']:
            count = len(option_issues['price_fetch_failures'])
            recommendations.append(f"{rec_num}. 期权价格获取失败问题 ({count}次) - 检查期权行情API调用和缓存机制")
            rec_num += 1
            recommendations.append(f"{rec_num}. 实现期权价格缓存 - 减少重复的价格查询请求，提高性能")
            rec_num += 1

        if option_issues['option_chain_errors']:
            recommendations.append(f"{rec_num}. 期权链获取错误 - 检查期权链API的错误处理和重试逻辑")
            rec_num += 1

        if option_issues['contract_selection_errors']:
            recommendations.append(f"{rec_num}. 合约选择逻辑优化 - 审查期权合约选择算法，确保正确处理各种市场条件")
            rec_num += 1

    if analysis['rate_limit_issues']:
        recommendations.append(f"{rec_num}. 实现API请求速率限制 - 添加请求队列和延迟机制")
        rec_num += 1
        recommendations.append(f"{rec_num}. 增加API调用重试逻辑 - 使用指数退避策略")
        rec_num += 1

    if analysis['order_issues']:
        decimal_issues = sum(1 for issue in analysis['order_issues'] if 'Decimal' in issue['message'])
        if decimal_issues > 0:
            recommendations.append(f"{rec_num}. 修复Decimal类型转换问题 - 检查订单数量的数据类型处理")
            rec_num += 1

        signal_issues = sum(1 for issue in analysis['order_issues'] if '未找到订单' in issue['message'] and '关联的信号' in issue['message'])
        if signal_issues > 0:
            recommendations.append(f"{rec_num}. 优化订单-信号关联逻辑 - 检查时间窗口匹配算法")
            rec_num += 1

    # 根据日志级别比例给出建议
    if analysis['total_logs'] > 0:
        error_rate = analysis['level_counts'].get('ERROR', 0) / analysis['total_logs']
        warning_rate = analysis['level_counts'].get('WARNING', 0) / analysis['total_logs']

        if error_rate > 0.05:
            recommendations.append(f"6. 错误率较高 ({error_rate:.1%}) - 需要优先处理关键错误")

        if warning_rate > 0.10:
            recommendations.append(f"7. 警告率较高 ({warning_rate:.1%}) - 建议检查并处理警告信息")

    for rec in recommendations:
        report_lines.append(rec)

    report_lines.append("")
    report_lines.append("=" * 80)

    return "\n".join(report_lines)

def main():
    """主函数"""
    # 设置输出编码
    if sys.platform == 'win32':
        import codecs
        sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

    # 支持命令行参数
    if len(sys.argv) > 1:
        log_file = Path(sys.argv[1])
    else:
        log_file = Path("logs-2026-01-27.json")

    if not log_file.exists():
        print(f"错误: 找不到日志文件 {log_file}")
        sys.exit(1)

    print(f"正在加载日志文件: {log_file}")
    logs = load_logs(log_file)
    print(f"已加载 {len(logs):,} 条日志")

    print("正在分析日志...")
    analysis = analyze_logs(logs)

    print("正在生成看板报告...")
    dashboard = generate_dashboard(analysis)

    # 保存到文件
    output_file = Path("logs-analysis-dashboard.txt")
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(dashboard)
    print(f"\n看板报告已保存到: {output_file}")

    # 生成详细的JSON报告
    json_output_file = Path("logs-analysis-detailed.json")
    with open(json_output_file, 'w', encoding='utf-8') as f:
        json.dump(analysis, f, ensure_ascii=False, indent=2)
    print(f"详细分析已保存到: {json_output_file}")

    # 输出到控制台
    print("\n" + "=" * 80)
    print("看板摘要已生成，完整报告请查看: logs-analysis-dashboard.txt")
    print("=" * 80)

if __name__ == "__main__":
    main()
