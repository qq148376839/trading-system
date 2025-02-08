import mysql.connector
import json
import logging
import os
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def init_database():
    """初始化数据库表结构"""
    try:
        # 获取项目根目录路径
        root_dir = Path(__file__).parent.parent
        config_path = root_dir / "configs" / "database_config.json"
        
        logger.info(f"正在读取配置文件: {config_path}")
        
        # 检查配置文件是否存在
        if not config_path.exists():
            raise FileNotFoundError(f"配置文件不存在: {config_path}")
            
        # 读取数据库配置
        with open(config_path, 'r', encoding='utf-8') as f:
            db_config = json.load(f)
            
        logger.info("成功读取数据库配置")
        
        # 连接数据库
        conn = mysql.connector.connect(**db_config)
        cursor = conn.cursor()
        
        logger.info("成功连接到数据库")
        
        # 定义所有表的创建语句
        tables = [
            # API配置表
            """
            CREATE TABLE IF NOT EXISTS api_config (
                id INT AUTO_INCREMENT PRIMARY KEY,
                account_type ENUM('SIMULATION', 'REAL') NOT NULL,
                app_key VARCHAR(100) NOT NULL,
                app_secret VARCHAR(100) NOT NULL,
                access_token TEXT NOT NULL,
                expire_time DATETIME NOT NULL,
                issued_at DATETIME NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_account_type (account_type),
                INDEX idx_expire_time (expire_time)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """,
            
            # K线数据表
            """
            CREATE TABLE IF NOT EXISTS candlesticks (
                symbol VARCHAR(20),
                timestamp BIGINT,
                open DECIMAL(20,4),
                close DECIMAL(20,4),
                high DECIMAL(20,4),
                low DECIMAL(20,4),
                volume BIGINT,
                turnover DECIMAL(20,4),
                period VARCHAR(10),
                PRIMARY KEY (symbol, timestamp, period)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """,
            
            # 技术指标数据表
            """
            CREATE TABLE IF NOT EXISTS technical_indicators (
                symbol VARCHAR(20),
                timestamp BIGINT,
                indicator_name VARCHAR(50),
                value DECIMAL(20,4),
                PRIMARY KEY (symbol, timestamp, indicator_name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """
        ]
        
        # 执行建表语句
        for i, table in enumerate(tables, 1):
            logger.info(f"正在创建第 {i} 个表...")
            cursor.execute(table)
            
        conn.commit()
        logger.info("数据库表初始化成功")
        
    except Exception as e:
        logger.error(f"数据库表初始化失败: {str(e)}")
        raise
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    init_database() 