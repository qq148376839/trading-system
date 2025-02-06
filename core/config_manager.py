import json
import os
import time
from typing import Dict, Any
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from jsonschema import validate, ValidationError

class ConfigManager:
    # 优化后的 Schema，添加了数值范围验证
    CONFIG_SCHEMA = {
        "type": "object",
        "properties": {
            "database_config": {
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
            "trading_config": {
                "type": "object",
                "properties": {
                    "stock_pools": {
                        "type": "object",
                        "properties": {
                            "AI": {"type": "array", "items": {"type": "string"}},
                            "AutoDrive": {"type": "array", "items": {"type": "string"}},
                            "Energy": {"type": "array", "items": {"type": "string"}},
                            "Robot": {"type": "array", "items": {"type": "string"}}
                        }
                    },
                    "trade_params": {
                        "type": "object",
                        "properties": {
                            "max_position_per_stock": {
                                "type": "number",
                                "minimum": 0,
                                "maximum": 1,
                                "description": "单个股票最大持仓比例，范围0-1"
                            },
                            "max_daily_trades": {
                                "type": "integer",
                                "minimum": 1,
                                "maximum": 1000,
                                "description": "每日最大交易次数"
                            },
                            "min_trade_interval": {
                                "type": "integer",
                                "minimum": 1,
                                "maximum": 3600,
                                "description": "最小交易间隔（秒）"
                            }
                        },
                        "required": ["max_position_per_stock", "max_daily_trades", "min_trade_interval"]
                    }
                }
            },
            "risk_config": {
                "type": "object",
                "properties": {
                    "stop_loss": {
                        "type": "number",
                        "maximum": 0,
                        "minimum": -1,
                        "description": "止损比例，必须为负数，范围-1到0"
                    },
                    "take_profit": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 1,
                        "description": "止盈比例，必须为正数，范围0到1"
                    },
                    "max_daily_loss": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 0.2,
                        "description": "最大日亏损比例，范围0到0.2"
                    },
                    "max_position_loss": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 0.5,
                        "description": "最大持仓亏损比例，范围0到0.5"
                    },
                    "volatility_threshold": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 0.1,
                        "description": "波动率阈值，范围0到0.1"
                    }
                },
                "required": ["stop_loss", "take_profit", "max_daily_loss", "max_position_loss", "volatility_threshold"]
            },
            "email_config": {
                "type": "object",
                "properties": {
                    "resend_api_key": {
                        "type": "string",
                        "pattern": "^re_[A-Za-z0-9_]+$",
                        "description": "Resend API密钥格式验证"
                    },
                    "sender_email": {
                        "type": "string",
                        "format": "email",
                        "description": "发件人邮箱"
                    },
                    "receiver_email": {
                        "type": "string",
                        "format": "email",
                        "description": "收件人邮箱"
                    }
                },
                "required": ["resend_api_key", "sender_email", "receiver_email"]
            },
            "stock_names": {
                "type": "object",
                "patternProperties": {
                    "^[A-Z0-9]+\\.(US|HK)$": {
                        "type": "string",
                        "description": "股票代码必须以.US或.HK结尾"
                    }
                },
                "additionalProperties": False
            }
        },
        "required": ["database_config", "trading_config", "risk_config", "email_config", "stock_names"]
    }
    
    def __init__(self, config_dir: str):
        self.config_dir = config_dir
        self.config: Dict[str, Any] = {}
        self.last_modified_times: Dict[str, float] = {}
        self.observers: Dict[str, Observer] = {}
        self.load_all_configs()
        self.setup_file_watchers()
        
    def load_all_configs(self):
        """加载所有配置文件"""
        config_files = [
            'database_config.json',
            'trading_config.json',
            'risk_config.json',
            'email_config.json',
            'stock_names.json'
        ]
        
        for file_name in config_files:
            self.load_config_file(file_name)
            
    def load_config_file(self, file_name: str) -> None:
        """加载单个配置文件"""
        file_path = os.path.join(self.config_dir, file_name)
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                config_data = json.load(f)
                
            # 验证配置
            self.validate_config(config_data)
            
            # 更新配置
            config_type = file_name.replace('_config.json', '').upper()
            self.config[config_type] = config_data
            self.last_modified_times[file_path] = os.path.getmtime(file_path)
            
        except Exception as e:
            raise ValueError(f"加载配置文件 {file_name} 失败: {str(e)}")
            
    def validate_config(self, config_data: Dict) -> None:
        """验证配置数据"""
        try:
            validate(instance=config_data, schema=self.CONFIG_SCHEMA)
        except ValidationError as e:
            raise ValueError(f"配置验证失败: {str(e)}")
            
    def setup_file_watchers(self) -> None:
        """设置文件监视器"""
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
            if current_mtime != self.last_modified_times.get(file_path):
                self.load_config_file(os.path.basename(file_path))
                print(f"配置文件已更新: {file_path}")
        except Exception as e:
            print(f"处理配置文件变更时发生错误: {str(e)}")
            
    def get(self, key: str, default: Any = None) -> Any:
        """获取配置项"""
        return self.config.get(key, default)
        
    def cleanup(self) -> None:
        """清理资源"""
        for observer in self.observers.values():
            observer.stop()
        for observer in self.observers.values():
            observer.join()

    def validate_config_values(self, config_type: str, config_data: dict) -> None:
        """额外的配置值验证"""
        if config_type == "risk_config":
            # 验证止损和止盈的配置关系
            if abs(config_data["stop_loss"]) >= config_data["take_profit"]:
                raise ValueError("止损比例的绝对值不应大于止盈比例")
            
            # 验证最大日亏损和最大持仓亏损的关系
            if config_data["max_daily_loss"] >= config_data["max_position_loss"]:
                raise ValueError("最大日亏损不应大于最大持仓亏损")

        elif config_type == "trading_config":
            # 验证交易参数的合理性
            trade_params = config_data.get("trade_params", {})
            if trade_params:
                # 验证最大持仓比例
                if trade_params["max_position_per_stock"] > 0.5:
                    self.ts.logger.warning(
                        "CONFIG", 
                        "警告：单个股票最大持仓比例超过50%，可能风险较大"
                    )
                
                # 验证交易间隔
                if trade_params["min_trade_interval"] < 60:
                    self.ts.logger.warning(
                        "CONFIG", 
                        "警告：交易间隔小于60秒，可能导致频繁交易"
                    ) 