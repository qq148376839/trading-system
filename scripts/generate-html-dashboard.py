#!/usr/bin/env python3
"""
生成HTML版本的日志分析看板
"""

import json
from pathlib import Path

def generate_html_dashboard(analysis_file, output_file):
    """生成HTML看板"""

    # 读取分析数据
    with open(analysis_file, 'r', encoding='utf-8') as f:
        analysis = json.load(f)

    html = """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>日志分析看板 - 2026-01-27</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
            line-height: 1.6;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }

        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            text-align: center;
        }

        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
        }

        .header p {
            font-size: 1.1em;
            opacity: 0.9;
        }

        .content {
            padding: 40px;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }

        .stat-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 25px;
            border-radius: 12px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }

        .stat-card h3 {
            font-size: 0.9em;
            opacity: 0.9;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .stat-card .value {
            font-size: 2.5em;
            font-weight: bold;
            margin-bottom: 5px;
        }

        .stat-card .label {
            font-size: 0.85em;
            opacity: 0.8;
        }

        .section {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 30px;
            margin-bottom: 30px;
        }

        .section h2 {
            font-size: 1.8em;
            margin-bottom: 20px;
            color: #2d3748;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .section h3 {
            font-size: 1.3em;
            margin: 25px 0 15px 0;
            color: #4a5568;
        }

        .level-bar {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
            padding: 12px;
            background: white;
            border-radius: 8px;
        }

        .level-icon {
            font-size: 1.5em;
            margin-right: 15px;
            width: 30px;
            text-align: center;
        }

        .level-name {
            min-width: 100px;
            font-weight: 600;
            color: #2d3748;
        }

        .level-progress {
            flex: 1;
            height: 24px;
            background: #e2e8f0;
            border-radius: 12px;
            overflow: hidden;
            margin: 0 15px;
            position: relative;
        }

        .level-progress-bar {
            height: 100%;
            border-radius: 12px;
            transition: width 0.3s ease;
        }

        .level-progress-bar.error { background: linear-gradient(90deg, #f56565, #e53e3e); }
        .level-progress-bar.warning { background: linear-gradient(90deg, #ed8936, #dd6b20); }
        .level-progress-bar.info { background: linear-gradient(90deg, #4299e1, #3182ce); }
        .level-progress-bar.debug { background: linear-gradient(90deg, #9f7aea, #805ad5); }

        .level-count {
            min-width: 120px;
            text-align: right;
            font-weight: 600;
            color: #4a5568;
        }

        .issue-card {
            background: white;
            border-left: 4px solid #e53e3e;
            padding: 20px;
            margin-bottom: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }

        .issue-card.warning {
            border-left-color: #ed8936;
        }

        .issue-card h4 {
            color: #2d3748;
            margin-bottom: 10px;
            font-size: 1.1em;
        }

        .issue-card .issue-count {
            color: #718096;
            font-size: 0.95em;
            margin-bottom: 10px;
        }

        .issue-card .issue-description {
            color: #4a5568;
            line-height: 1.6;
        }

        .module-list {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 15px;
        }

        .module-item {
            background: white;
            padding: 15px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .module-rank {
            font-size: 1.5em;
            font-weight: bold;
            color: #a0aec0;
            min-width: 35px;
        }

        .module-info {
            flex: 1;
        }

        .module-name {
            font-weight: 600;
            color: #2d3748;
            margin-bottom: 5px;
        }

        .module-count {
            color: #718096;
            font-size: 0.9em;
        }

        .recommendations {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 12px;
            padding: 30px;
        }

        .recommendations h2 {
            color: white;
            margin-bottom: 20px;
        }

        .recommendation-item {
            background: rgba(255,255,255,0.1);
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 15px;
            border-left: 4px solid rgba(255,255,255,0.5);
        }

        .recommendation-item:last-child {
            margin-bottom: 0;
        }

        .top-errors-list, .top-warnings-list {
            display: grid;
            gap: 15px;
        }

        .error-item, .warning-item {
            background: white;
            padding: 20px;
            border-radius: 8px;
            border-left: 4px solid #e53e3e;
        }

        .warning-item {
            border-left-color: #ed8936;
        }

        .error-header, .warning-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }

        .error-rank, .warning-rank {
            font-size: 1.2em;
            font-weight: bold;
            color: #a0aec0;
        }

        .error-count-badge, .warning-count-badge {
            background: #e53e3e;
            color: white;
            padding: 5px 12px;
            border-radius: 20px;
            font-size: 0.9em;
            font-weight: 600;
        }

        .warning-count-badge {
            background: #ed8936;
        }

        .error-message, .warning-message {
            color: #4a5568;
            word-break: break-word;
        }

        .strategy-card {
            background: white;
            padding: 25px;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }

        .strategy-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid #e2e8f0;
        }

        .strategy-title {
            font-size: 1.5em;
            color: #2d3748;
            font-weight: bold;
        }

        .strategy-executions {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 0.9em;
        }

        .strategy-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }

        .strategy-stat {
            background: #f7fafc;
            padding: 15px;
            border-radius: 8px;
        }

        .strategy-stat-label {
            color: #718096;
            font-size: 0.85em;
            margin-bottom: 5px;
        }

        .strategy-stat-value {
            color: #2d3748;
            font-size: 1.2em;
            font-weight: 600;
        }

        .strategy-signals {
            background: #f7fafc;
            padding: 15px;
            border-radius: 8px;
        }

        .signal-tag {
            display: inline-block;
            background: white;
            padding: 5px 12px;
            border-radius: 6px;
            margin: 5px 5px 5px 0;
            font-size: 0.9em;
            color: #4a5568;
            border: 1px solid #e2e8f0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 日志分析看板</h1>
            <p>2026-01-27 系统日志分析报告</p>
        </div>

        <div class="content">
"""

    # 概览统计卡片
    total_logs = analysis['total_logs']
    level_counts = analysis['level_counts']
    error_count = level_counts.get('ERROR', 0)
    warning_count = level_counts.get('WARNING', 0)
    info_count = level_counts.get('INFO', 0)

    html += f"""
            <div class="stats-grid">
                <div class="stat-card">
                    <h3>总日志数</h3>
                    <div class="value">{total_logs:,}</div>
                    <div class="label">条日志记录</div>
                </div>
                <div class="stat-card">
                    <h3>错误数</h3>
                    <div class="value">{error_count:,}</div>
                    <div class="label">{(error_count/total_logs*100):.1f}% 错误率</div>
                </div>
                <div class="stat-card">
                    <h3>警告数</h3>
                    <div class="value">{warning_count:,}</div>
                    <div class="label">{(warning_count/total_logs*100):.1f}% 警告率</div>
                </div>
                <div class="stat-card">
                    <h3>信息日志</h3>
                    <div class="value">{info_count:,}</div>
                    <div class="label">{(info_count/total_logs*100):.1f}% 信息日志</div>
                </div>
            </div>
"""

    # 日志级别分布
    html += """
            <div class="section">
                <h2>📊 日志级别分布</h2>
"""

    level_icons = {
        'ERROR': '🔴',
        'WARNING': '⚠️',
        'INFO': '🔵',
        'DEBUG': '🔍'
    }

    level_classes = {
        'ERROR': 'error',
        'WARNING': 'warning',
        'INFO': 'info',
        'DEBUG': 'debug'
    }

    for level, count in sorted(level_counts.items(), key=lambda x: x[1], reverse=True):
        percentage = (count / total_logs * 100)
        icon = level_icons.get(level, '⚪')
        css_class = level_classes.get(level, 'info')

        html += f"""
                <div class="level-bar">
                    <div class="level-icon">{icon}</div>
                    <div class="level-name">{level}</div>
                    <div class="level-progress">
                        <div class="level-progress-bar {css_class}" style="width: {percentage}%"></div>
                    </div>
                    <div class="level-count">{count:,} ({percentage:.2f}%)</div>
                </div>
"""

    html += """
            </div>
"""

    # 关键问题
    html += """
            <div class="section">
                <h2>🚨 关键问题</h2>
"""

    # 数据库错误
    db_errors = analysis.get('db_errors', [])
    if db_errors:
        html += f"""
                <div class="issue-card">
                    <h4>❌ 数据库表缺失错误</h4>
                    <div class="issue-count">出现次数: {len(db_errors):,}</div>
                    <div class="issue-description">
                        <strong>问题:</strong> 验证失败日志表不存在 (错误码: 42P01)<br>
                        <strong>首次出现:</strong> {db_errors[0]['timestamp']}<br>
                        <strong>最后出现:</strong> {db_errors[-1]['timestamp']}<br>
                        <strong>建议:</strong> 检查数据库迁移，确保所有表已正确创建
                    </div>
                </div>
"""

    # API限流问题
    rate_limit_issues = analysis.get('rate_limit_issues', [])
    if rate_limit_issues:
        from collections import defaultdict
        rate_limit_by_module = defaultdict(int)
        for issue in rate_limit_issues:
            rate_limit_by_module[issue['module']] += 1

        module_stats = "<br>".join([f"&nbsp;&nbsp;• {module}: {count:,} 次" for module, count in sorted(rate_limit_by_module.items(), key=lambda x: x[1], reverse=True)])

        html += f"""
                <div class="issue-card warning">
                    <h4>⏱️ API请求限流</h4>
                    <div class="issue-count">出现次数: {len(rate_limit_issues):,}</div>
                    <div class="issue-description">
                        <strong>错误:</strong> openapi error: code=429002 (API请求频率限制)<br>
                        <strong>按模块统计:</strong><br>{module_stats}<br>
                        <strong>建议:</strong> 实现请求速率控制，添加重试机制
                    </div>
                </div>
"""

    # 订单问题
    order_issues = analysis.get('order_issues', [])
    if order_issues:
        from collections import Counter
        order_issue_types = Counter()
        for issue in order_issues:
            msg = issue['message']
            if '未找到订单' in msg and '关联的信号' in msg:
                order_issue_types['信号关联失败'] += 1
            elif '订单价格更新失败' in msg:
                order_issue_types['价格更新失败'] += 1
            elif 'Decimal' in msg:
                order_issue_types['数据类型错误'] += 1
            else:
                order_issue_types['其他'] += 1

        issue_type_stats = "<br>".join([f"&nbsp;&nbsp;• {issue_type}: {count:,} 次" for issue_type, count in order_issue_types.most_common()])

        html += f"""
                <div class="issue-card warning">
                    <h4>📦 订单相关问题</h4>
                    <div class="issue-count">出现次数: {len(order_issues):,}</div>
                    <div class="issue-description">
                        <strong>问题类型:</strong><br>{issue_type_stats}<br>
                        <strong>建议:</strong> 优化订单-信号关联逻辑，修复Decimal类型转换问题
                    </div>
                </div>
"""

    html += """
            </div>
"""

    # 模块活动
    html += """
            <div class="section">
                <h2>🏗️ 模块活动统计 (Top 10)</h2>
                <div class="module-list">
"""

    for i, (module, count) in enumerate(list(analysis['module_counts'].items())[:10], 1):
        percentage = (count / total_logs * 100)
        html += f"""
                    <div class="module-item">
                        <div class="module-rank">#{i}</div>
                        <div class="module-info">
                            <div class="module-name">{module}</div>
                            <div class="module-count">{count:,} 次 ({percentage:.2f}%)</div>
                        </div>
                    </div>
"""

    html += """
                </div>
            </div>
"""

    # 策略执行统计
    strategy_stats = analysis.get('strategy_stats', {})
    if strategy_stats:
        html += """
            <div class="section">
                <h2>📈 策略执行统计</h2>
"""

        for strategy_id, stats in sorted(strategy_stats.items()):
            html += f"""
                <div class="strategy-card">
                    <div class="strategy-header">
                        <div class="strategy-title">策略 {strategy_id}</div>
                        <div class="strategy-executions">执行 {stats['executions']:,} 次</div>
                    </div>
"""

            if 'last_execution' in stats:
                last_exec = stats['last_execution']
                duration = last_exec.get('duration', 'N/A')
                counts = last_exec.get('counts', {})

                html += f"""
                    <div class="strategy-stats">
                        <div class="strategy-stat">
                            <div class="strategy-stat-label">最后执行</div>
                            <div class="strategy-stat-value">{last_exec['timestamp'][:19]}</div>
                        </div>
                        <div class="strategy-stat">
                            <div class="strategy-stat-label">执行耗时</div>
                            <div class="strategy-stat-value">{duration} ms</div>
                        </div>
                        <div class="strategy-stat">
                            <div class="strategy-stat-label">IDLE标的</div>
                            <div class="strategy-stat-value">{counts.get('idle', 0)}</div>
                        </div>
                        <div class="strategy-stat">
                            <div class="strategy-stat-label">持仓标的</div>
                            <div class="strategy-stat-value">{counts.get('holding', 0)}</div>
                        </div>
                        <div class="strategy-stat">
                            <div class="strategy-stat-label">错误次数</div>
                            <div class="strategy-stat-value">{len(stats.get('errors', []))}</div>
                        </div>
                        <div class="strategy-stat">
                            <div class="strategy-stat-label">警告次数</div>
                            <div class="strategy-stat-value">{len(stats.get('warnings', []))}</div>
                        </div>
                    </div>
"""

                signals = last_exec.get('signals', [])
                if signals:
                    signal_tags = "".join([f'<span class="signal-tag">{signal}</span>' for signal in signals[:15]])
                    html += f"""
                    <div class="strategy-signals">
                        <div class="strategy-stat-label" style="margin-bottom: 10px;">信号标的 ({len(signals)})</div>
                        {signal_tags}
                    </div>
"""

            html += """
                </div>
"""

        html += """
            </div>
"""

    # Top 错误
    html += """
            <div class="section">
                <h2>🔴 Top 10 错误类型</h2>
                <div class="top-errors-list">
"""

    error_counts = [(key, len(occurrences)) for key, occurrences in analysis['errors'].items()]
    error_counts.sort(key=lambda x: x[1], reverse=True)

    for i, (error_key, count) in enumerate(error_counts[:10], 1):
        html += f"""
                    <div class="error-item">
                        <div class="error-header">
                            <div class="error-rank">#{i}</div>
                            <div class="error-count-badge">{count:,} 次</div>
                        </div>
                        <div class="error-message">{error_key}</div>
                    </div>
"""

    html += """
                </div>
            </div>
"""

    # Top 警告
    html += """
            <div class="section">
                <h2>⚠️ Top 10 警告类型</h2>
                <div class="top-warnings-list">
"""

    warning_counts = [(key, len(occurrences)) for key, occurrences in analysis['warnings'].items()]
    warning_counts.sort(key=lambda x: x[1], reverse=True)

    for i, (warning_key, count) in enumerate(warning_counts[:10], 1):
        html += f"""
                    <div class="warning-item">
                        <div class="warning-header">
                            <div class="warning-rank">#{i}</div>
                            <div class="warning-count-badge">{count:,} 次</div>
                        </div>
                        <div class="warning-message">{warning_key}</div>
                    </div>
"""

    html += """
                </div>
            </div>
"""

    # 优化建议
    html += """
            <div class="recommendations">
                <h2>💡 优化建议</h2>
"""

    recommendations = [
        "修复数据库表缺失问题 - 检查并创建缺失的验证失败日志表",
        "实现API请求速率限制 - 添加请求队列和延迟机制",
        "增加API调用重试逻辑 - 使用指数退避策略",
        "修复Decimal类型转换问题 - 检查订单数量的数据类型处理",
        "优化订单-信号关联逻辑 - 检查时间窗口匹配算法",
    ]

    if total_logs > 0:
        error_rate = error_count / total_logs
        warning_rate = warning_count / total_logs

        if error_rate > 0.05:
            recommendations.append(f"错误率较高 ({error_rate:.1%}) - 需要优先处理关键错误")

        if warning_rate > 0.10:
            recommendations.append(f"警告率较高 ({warning_rate:.1%}) - 建议检查并处理警告信息")

    for i, rec in enumerate(recommendations, 1):
        html += f"""
                <div class="recommendation-item">
                    <strong>{i}.</strong> {rec}
                </div>
"""

    html += """
            </div>
        </div>
    </div>
</body>
</html>
"""

    # 写入文件
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html)

if __name__ == "__main__":
    import sys
    import codecs
    if sys.platform == 'win32':
        sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

    analysis_file = Path("logs-analysis-detailed.json")
    output_file = Path("logs-analysis-dashboard.html")

    print(f"正在生成HTML看板...")
    generate_html_dashboard(analysis_file, output_file)
    print(f"HTML看板已生成: {output_file}")
    print(f"\n请在浏览器中打开该文件查看交互式看板")
