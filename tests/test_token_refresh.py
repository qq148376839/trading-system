import os
import sys
from datetime import datetime, timedelta

def test_token_refresh():
    """测试 Token 刷新功能"""
    try:
        # 获取项目根目录的绝对路径
        current_file = os.path.abspath(__file__)
        project_root = os.path.dirname(os.path.dirname(current_file))
        
        print("\n=== 路径信息 ===")
        print(f"当前文件路径: {current_file}")
        print(f"项目根目录: {project_root}")
        print(f"配置文件目录: {os.path.join(project_root, 'configs')}")
        
        # 确保当前工作目录是项目根目录
        os.chdir(project_root)
        print(f"当前工作目录: {os.getcwd()}")
        
        # 验证配置文件是否存在
        config_files = [
            'database_config.json',
            'email_config.json',
            'trading_config.json',
            'risk_config.json'
        ]
        
        print("\n=== 配置文件检查 ===")
        for config_file in config_files:
            config_path = os.path.join(project_root, 'configs', config_file)
            exists = os.path.exists(config_path)
            print(f"{config_file}: {'✅ 存在' if exists else '❌ 不存在'}")
            if not exists:
                print(f"尝试查找的路径: {config_path}")
        
        # 1. 初始化交易系统
        from config import TradingSystem
        ts = TradingSystem(use_simulation=True)
        
        try:
            # 2. 获取当前 Token 信息
            cursor = ts.db.cursor(dictionary=True)
            cursor.execute("""
                SELECT id, access_token, expire_time, issued_at 
                FROM api_config 
                WHERE account_type = 'SIMULATION' 
                AND is_active = TRUE 
                LIMIT 1
            """)
            old_token_data = cursor.fetchone()
            
            if not old_token_data:
                print("错误: 未找到有效的 Token 配置")
                return
                
            print("\n=== 当前 Token 信息 ===")
            print(f"Token ID: {old_token_data['id']}")
            print(f"过期时间: {old_token_data['expire_time']}")
            print(f"发行时间: {old_token_data['issued_at']}")
            
            # 3. 修改过期时间为即将过期（7天内）
            new_expire_time = datetime.now() + timedelta(days=5)
            cursor.execute("""
                UPDATE api_config 
                SET expire_time = %s 
                WHERE id = %s
            """, (new_expire_time, old_token_data['id']))
            ts.db.commit()
            
            print("\n=== 模拟 Token 即将过期 ===")
            print(f"新的过期时间: {new_expire_time}")
            
            # 4. 执行 Token 刷新
            print("\n=== 开始刷新 Token ===")
            ts.token_manager.check_and_refresh_token()
            
            # 5. 验证 Token 是否已更新
            cursor.execute("""
                SELECT access_token, expire_time, issued_at 
                FROM api_config 
                WHERE id = %s
            """, (old_token_data['id'],))
            new_token_data = cursor.fetchone()
            
            print("\n=== 刷新后的 Token 信息 ===")
            print(f"新的过期时间: {new_token_data['expire_time']}")
            print(f"新的发行时间: {new_token_data['issued_at']}")
            
            # 6. 验证 Token 是否确实更新
            if new_token_data['access_token'] != old_token_data['access_token']:
                print("\n✅ Token 已成功更新!")
            else:
                print("\n❌ Token 未更新，请检查刷新逻辑")
                
            # 7. 验证交易系统配置是否更新
            if ts.config['API']['access_token'] == new_token_data['access_token']:
                print("✅ 交易系统配置已更新!")
            else:
                print("❌ 交易系统配置未更新，请检查配置更新逻辑")
                
        except Exception as e:
            print(f"\n❌ 测试过程中发生错误: {str(e)}")
            raise e
            
        finally:
            cursor.close()
            ts.db.close()
            
    except Exception as e:
        print(f"\n❌ 初始化过程中发生错误: {str(e)}")
        raise e

if __name__ == "__main__":
    test_token_refresh() 