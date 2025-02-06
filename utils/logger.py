import logging
from datetime import datetime

class DBLogger:
    """数据库日志记录器"""
    
    def __init__(self, db_connection):
        """
        初始化日志记录器
        
        参数:
            db_connection: 数据库连接对象
        """
        self.db = db_connection
        
        # 设置控制台日志
        self.console_logger = logging.getLogger('trading_system')
        if not self.console_logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s [%(levelname)s] %(message)s',
                datefmt='%Y-%m-%d %H:%M:%S'
            )
            handler.setFormatter(formatter)
            self.console_logger.addHandler(handler)
            self.console_logger.setLevel(logging.DEBUG)
        
    def _log(self, level, module, message):
        """记录日志到数据库和控制台"""
        # 控制台输出
        log_message = f"[{module}] {message}"
        if level == "DEBUG":
            self.console_logger.debug(log_message)
        elif level == "INFO":
            self.console_logger.info(log_message)
        elif level == "WARNING":
            self.console_logger.warning(log_message)
        elif level == "ERROR":
            self.console_logger.error(log_message)
            
        # 数据库记录
        try:
            if self.db and self.db.is_connected():
                cursor = self.db.cursor()
                try:
                    query = """
                    INSERT INTO system_logs 
                    (level, module, message, created_at)
                    VALUES (%s, %s, %s, NOW())
                    """
                    cursor.execute(query, (level, module, message))
                    self.db.commit()
                except Exception as e:
                    print(f"记录日志到数据库失败: {str(e)}")
                    self.db.rollback()
                finally:
                    cursor.close()
            else:
                print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [{level}] {log_message}")
        except Exception as e:
            print(f"日志记录失败: {str(e)}")
    
    def debug(self, module, message):
        """记录调试级别日志"""
        self._log("DEBUG", module, message)
    
    def info(self, module, message):
        """记录信息级别日志"""
        self._log("INFO", module, message)
    
    def warning(self, module, message):
        """记录警告级别日志"""
        self._log("WARNING", module, message)
    
    def error(self, module, message):
        """记录错误级别日志"""
        self._log("ERROR", module, message) 