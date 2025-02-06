from datetime import datetime, timedelta
import requests
from typing import Dict, Optional
import json
from longport.openapi import Config  # 修正导入路径

class TokenManager:
    """API Token管理器"""
    
    def __init__(self, trading_system):
        self.ts = trading_system
        self.refresh_threshold = timedelta(days=7)  # 提前7天刷新Token
        
    def check_and_refresh_token(self) -> None:
        """检查并刷新Token"""
        cursor = self.ts.db.cursor(dictionary=True)
        try:
            # 获取即将过期的Token
            query = """
            SELECT id, account_type, app_key, app_secret, access_token, expire_time
            FROM api_config 
            WHERE is_active = TRUE 
            AND expire_time <= DATE_ADD(NOW(), INTERVAL 7 DAY)
            """
            cursor.execute(query)
            tokens = cursor.fetchall()
            
            for token in tokens:
                try:
                    new_token_data = self._refresh_token(
                        token['access_token'],
                        token['expire_time']
                    )
                    
                    if new_token_data:
                        # 更新数据库中的Token
                        update_query = """
                        UPDATE api_config 
                        SET access_token = %s,
                            expire_time = %s,
                            issued_at = %s,
                            updated_at = NOW()
                        WHERE id = %s
                        """
                        cursor.execute(update_query, (
                            new_token_data['token'],
                            new_token_data['expired_at'],
                            new_token_data['issued_at'],
                            token['id']
                        ))
                        self.ts.db.commit()
                        
                        self.ts.logger.info(
                            "TOKEN", 
                            f"成功刷新 {token['account_type']} Token"
                        )
                        
                        # 如果是当前使用的账户类型，更新交易系统配置
                        if (token['account_type'] == 'SIMULATION' and self.ts.use_simulation) or \
                           (token['account_type'] == 'REAL' and not self.ts.use_simulation):
                            self.ts.update_trading_config()
                            
                except Exception as e:
                    self.ts.logger.error(
                        "TOKEN", 
                        f"刷新Token失败 ({token['account_type']}): {str(e)}"
                    )
                    
        finally:
            cursor.close()
            
    def _refresh_token(self, current_token: str, expire_time: datetime) -> Optional[Dict]:
        """
        使用长桥SDK刷新Token
        
        Args:
            current_token: 当前的access_token
            expire_time: 当前token的过期时间
            
        Returns:
            Dict: 包含新token信息的字典，如果刷新失败返回None
        """
        try:
            # 使用当前配置创建新的Config对象
            config = Config(
                app_key=self.ts.config['API']['app_key'],
                app_secret=self.ts.config['API']['app_secret'],
                access_token=current_token
            )
            
            # 使用SDK的refresh_access_token方法
            new_token = config.refresh_access_token(expire_time)
            
            # 设置新的过期时间（90天后）
            new_expire_time = datetime.now() + timedelta(days=90)
            
            return {
                'token': new_token,
                'expired_at': new_expire_time,
                'issued_at': datetime.now()
            }
                
        except Exception as e:
            raise Exception(f"刷新Token时发生错误: {str(e)}") 