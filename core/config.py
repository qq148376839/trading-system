from typing import Dict, Any
import os
import json
import time
from datetime import datetime
try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
except ImportError:
    raise ImportError(
        "缺少必要的依赖包 'watchdog'。\n"
        "请运行以下命令安装：\n"
        "pip install watchdog"
    )

try:
    from jsonschema import validate, ValidationError
except ImportError:
    raise ImportError(
        "缺少必要的依赖包 'jsonschema'。\n"
        "请运行以下命令安装：\n"
        "pip install jsonschema"
    )

class ConfigManager:
    """统一的配置管理类"""
    
    # 配置验证Schema
    CONFIG_SCHEMA = {
        "type": "object",
        "properties": {
            "database": {
                "type": "object",
                "properties": {
                    "host": {"type": "string"},
                    "user": {"type": "string"},
                    "password": {"type": "string"},
                    "database": {"type": "string"},
                    "port": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 65535
                    }
                },
                "required": ["host", "user", "password", "database", "port"]
            },
            "trading": {
                "type": "object",
                "properties": {
                    "stock_pools": {
                        "type": "object",
                        "patternProperties": {
                            "^[A-Za-z]+$": {
                                "type": "array",
                                "items": {"type": "string"}
                            }
                        }
                    },
                    "trade_params": {
                        "type": "object",
                        "properties": {
                            "max_position_per_stock": {
                                "type": "number",
                                "minimum": 0,
                                "maximum": 1
                            },
                            "max_daily_trades": {
                                "type": "integer",
                                "minimum": 1
                            },
                            "min_trade_interval": {
                                "type": "integer",
                                "minimum": 1
                            }
                        },
                        "required": ["max_position_per_stock", "max_daily_trades", "min_trade_interval"]
                    }
                }
            },
            "risk": {
                "type": "object",
                "properties": {
                    "stop_loss": {
                        "type": "number",
                        "maximum": 0
                    },
                    "take_profit": {
                        "type": "number",
                        "minimum": 0
                    },
                    "max_daily_loss": {
                        "type": "number",
                        "minimum": 0
                    },
                    "max_position_loss": {
                        "type": "number",
                        "maximum": 0
                    },
                    "volatility_threshold": {
                        "type": "number",
                        "minimum": 0
                    }
                },
                "required": ["stop_loss", "take_profit", "max_daily_loss", "max_position_loss", "volatility_threshold"]
            },
            "email": {
                "type": "object",
                "properties": {
                    "enabled": {"type": "boolean"},
                    "resend_api_key": {"type": "string"},
                    "sender_email": {"type": "string"},
                    "recipient_email": {"type": "string"}
                },
                "required": ["enabled", "resend_api_key", "sender_email", "recipient_email"]
            }
        }
    }

    def __init__(self, base_dir=None, logger=None):
        """
        初始化配置管理器
        
        Args:
            base_dir: 基础目录路径
            logger: 日志记录器实例
        """
        self.base_dir = base_dir or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.config_dir = os.path.join(self.base_dir, 'configs')
        self.logger = logger
        self.configs = {}
        self.last_modified_times = {}
        self.observers = {}
        
        # 加载所有配置
        self.load_configs()
        
        # 设置文件监控
        self.setup_file_watchers()
        
    def load_configs(self):
        """加载所有配置文件"""
        config_files = {
            'database': 'database_config.json',
            'email': 'email_config.json',
            'trading': 'trading_config.json',
            'risk': 'risk_config.json',
            'stock_names': 'stock_names.json'
        }
        
        for key, filename in config_files.items():
            self.load_config_file(filename)
            
    def load_config_file(self, filename: str) -> None:
        """加载单个配置文件"""
        file_path = os.path.join(self.config_dir, filename)
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                config_data = json.load(f)
                
            # 验证配置
            self.validate_config(config_data)
            
            # 更新配置
            config_type = filename.replace('_config.json', '')
            self.configs[config_type] = config_data
            self.last_modified_times[file_path] = os.path.getmtime(file_path)
            
            if self.logger:
                self.logger.info("CONFIG", f"成功加载配置文件: {filename}")
                
        except Exception as e:
            error_msg = f"加载配置文件 {filename} 失败: {str(e)}"
            if self.logger:
                self.logger.error("CONFIG", error_msg)
            raise ValueError(error_msg)
            
    def validate_config(self, config_data: Dict) -> None:
        """验证配置数据"""
        try:
            validate(instance=config_data, schema=self.CONFIG_SCHEMA)
        except ValidationError as e:
            raise ValueError(f"配置验证失败: {str(e)}")
            
    def setup_file_watchers(self) -> None:
        """设置文件监控"""
        class ConfigFileHandler(FileSystemEventHandler):
            def __init__(self, config_manager):
                self.config_manager = config_manager
                
            def on_modified(self, event):
                if not event.is_directory and event.src_path.endswith('.json'):
                    self.config_manager.handle_config_change(event.src_path)
                    
        event_handler = ConfigFileHandler(self)
        observer = Observer()
        observer.schedule(event_handler, self.config_dir, recursive=False)
        observer.start()
        self.observers['main'] = observer
        
    def handle_config_change(self, file_path: str) -> None:
        """处理配置文件变更"""
        try:
            current_mtime = os.path.getmtime(file_path)
            last_mtime = self.last_modified_times.get(file_path)
            
            # 防止重复触发
            if current_mtime != last_mtime:
                filename = os.path.basename(file_path)
                self.load_config_file(filename)
                if self.logger:
                    self.logger.info("CONFIG", f"配置文件已更新: {filename}")
                    
        except Exception as e:
            if self.logger:
                self.logger.error("CONFIG", f"处理配置文件变更时发生错误: {str(e)}")
                
    def get(self, key: str, default: Any = None) -> Any:
        """获取配置项，支持使用点号访问嵌套配置"""
        try:
            if '.' in key:
                main_key, sub_key = key.split('.', 1)
                return self.configs.get(main_key, {}).get(sub_key, default)
            return self.configs.get(key, default)
        except Exception:
            return default
            
    def cleanup(self) -> None:
        """清理资源"""
        for observer in self.observers.values():
            observer.stop()
        for observer in self.observers.values():
            observer.join()

    def get_stock_pools(self) -> Dict:
        """获取股票池配置"""
        return self.get('trading', {}).get('stock_pools', {})
        
    def get_database_config(self) -> Dict:
        """获取数据库配置"""
        return self.get('database', {})
        
    def get_email_config(self) -> Dict:
        """获取邮件配置"""
        return self.get('email', {})
        
    def get_risk_config(self) -> Dict:
        """获取风险配置"""
        return self.get('risk', {}) 