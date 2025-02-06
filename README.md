# 量化交易系统

基于 Python 的自动化量化交易系统，支持实盘和模拟交易。

## 项目结构 
trading_system/
├── configs/ # 配置文件目录
│ ├── database_config.json # 数据库配置
│ ├── email_config.json # 邮件通知配置
│ ├── trading_config.json # 交易参数配置
│ └── risk_config.json # 风险控制配置
├── core/ # 核心功能模块
│ ├── config.py # 配置加载类
│ ├── trading_system.py # 交易系统核心
│ ├── data_collector.py # 数据收集
│ ├── strategy.py # 交易策略
│ └── trader.py # 交易执行
├── utils/ # 工具类
│ ├── logger.py # 日志工具
│ ├── risk_manager.py # 风险管理
│ └── notifier.py # 通知系统
├── database/ # 数据库相关
│ └── models.py # 数据库模型
└── main.py # 主程序
bash
git clone [repository_url]
cd trading_system
bash
pip install -r requirements.txt
bash
python -c "from database.models import init_database; init_database()"
bash
python main.py
json
{
"host": "localhost",
"user": "trading_user",
"password": "your_password",
"database": "trading_db",
"port": 3306
}
json
{
"stock_pools": {
"AI": ["NVDA.US", "AI.US", "GOOGL.US"],
"AutoDrive": ["TSLA.US", "XPEV.US", "NIO.US"]
},
"trade_params": {
"max_position_per_stock": 0.2,
"max_daily_trades": 10
}
}
这个 README.md 文件提供了：
项目概述
目录结构说明
安装和配置步骤
使用说明
主要功能介绍
注意事项
开发指南
维护说明
建议根据实际情况补充：
具体的许可证信息
联系方式
更多的使用示例
常见问题解答
贡献指南