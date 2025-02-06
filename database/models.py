"""数据库模型和初始化脚本"""

def init_database():
    """初始化数据库表结构"""
    CREATE_TABLES_SQL = [
        # 系统日志表
        """
        CREATE TABLE IF NOT EXISTS system_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            level VARCHAR(10) NOT NULL,
            module VARCHAR(50) NOT NULL,
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """,
        
        # 市场数据表
        """
        CREATE TABLE IF NOT EXISTS market_data (
            id INT AUTO_INCREMENT PRIMARY KEY,
            symbol VARCHAR(20) NOT NULL,
            date DATETIME NOT NULL,
            open_price DECIMAL(10,2),
            high_price DECIMAL(10,2),
            low_price DECIMAL(10,2),
            close_price DECIMAL(10,2),
            volume INT,
            turnover DECIMAL(20,2),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_symbol_date (symbol, date)
        );
        """,
        
        # API配置表
        """
        CREATE TABLE IF NOT EXISTS api_config (
            id INT AUTO_INCREMENT PRIMARY KEY,
            app_key VARCHAR(100) NOT NULL,
            app_secret VARCHAR(100) NOT NULL,
            access_token TEXT NOT NULL,
            account_type ENUM('SIMULATION', 'REAL') NOT NULL,
            is_active BOOLEAN DEFAULT FALSE,
            expire_time DATETIME NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );
        """,
        
        # 交易记录表
        """
        CREATE TABLE IF NOT EXISTS trade_records (
            id INT AUTO_INCREMENT PRIMARY KEY,
            symbol VARCHAR(20) NOT NULL,
            trade_type ENUM('BUY', 'SELL') NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            quantity INT NOT NULL,
            total_amount DECIMAL(15,2) NOT NULL,
            trade_time DATETIME NOT NULL,
            status ENUM('PENDING', 'COMPLETED', 'CANCELLED') NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """,
        
        # 持仓表
        """
        CREATE TABLE IF NOT EXISTS positions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            symbol VARCHAR(20) NOT NULL,
            quantity INT NOT NULL,
            average_cost DECIMAL(10,2) NOT NULL,
            current_price DECIMAL(10,2),
            market_value DECIMAL(15,2),
            profit_loss DECIMAL(15,2),
            last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_symbol (symbol)
        );
        """,
        
        # 账户余额表
        """
        CREATE TABLE IF NOT EXISTS account_balance (
            id INT AUTO_INCREMENT PRIMARY KEY,
            total_balance DECIMAL(15,2) NOT NULL,
            available_balance DECIMAL(15,2) NOT NULL,
            frozen_balance DECIMAL(15,2) NOT NULL,
            update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );
        """,
        
        # 风险事件表
        """
        CREATE TABLE IF NOT EXISTS risk_events (
            id INT AUTO_INCREMENT PRIMARY KEY,
            event_type VARCHAR(50) NOT NULL,
            symbol VARCHAR(20),
            severity VARCHAR(10) NOT NULL,
            description TEXT NOT NULL,
            handled BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """,
        
        # 交易信号表
        """
        CREATE TABLE IF NOT EXISTS trade_signals (
            id INT AUTO_INCREMENT PRIMARY KEY,
            symbol VARCHAR(20) NOT NULL,
            direction ENUM('BUY', 'SELL') NOT NULL,
            quantity INT NOT NULL,
            price DECIMAL(10,2),
            signal_time DATETIME NOT NULL,
            status ENUM('PENDING', 'EXECUTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_symbol_time (symbol, signal_time)
        );
        """
    ]
    
    return CREATE_TABLES_SQL 