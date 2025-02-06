import os
import json

class Config:
    def __init__(self):
        self.BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self._load_configs()
        self.stock_pools = {
            "AI": ["NVDA.US", "MSFT.US", "GOOGL.US", "META.US", "9618.HK", "0700.HK"],
            "AutoDrive": ["TSLA.US", "XPEV.US", "NIO.US", "LI.US", "9868.HK", "2015.HK"],
            "Energy": ["PLUG.US", "ENPH.US", "0968.HK", "0384.HK", "0836.HK"],
            "Robot": ["ABBNY.US", "ISRG.US", "6969.HK", "0669.HK", "2382.HK"]
        }
        
    def _load_configs(self):
        """加载所有配置文件"""
        configs_dir = os.path.join(self.BASE_DIR, 'configs')
        
        # 加载数据库配置
        with open(os.path.join(configs_dir, 'database_config.json')) as f:
            self.DATABASE = json.load(f)
            
        # 加载邮件配置
        with open(os.path.join(configs_dir, 'email_config.json')) as f:
            self.EMAIL = json.load(f)
            
        # 加载交易配置
        with open(os.path.join(configs_dir, 'trading_config.json')) as f:
            self.TRADING = json.load(f)
            
        # 加载风险配置
        with open(os.path.join(configs_dir, 'risk_config.json')) as f:
            self.RISK = json.load(f) 

    def get(self, key, default=None):
        """获取配置项，如果不存在则返回默认值"""
        return getattr(self, key, default) 