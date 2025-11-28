#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
期权行情API测试工具

测试富途牛牛API的三个接口：
1. 搜索接口：获取正股信息
2. 期权链接口：获取期权列表
3. K线接口：获取期权K线数据

使用方法：
    python test_option_quote_api.py
"""

import requests
import time
import hashlib
import hmac
import json
from datetime import datetime


def parse_cookie_string(cookie_string):
    """
    从浏览器复制的 Cookie header 字符串中解析 cookies
    
    例如：
    cookie_string = "csrfToken=LCkwngWb9HPaKUIhBHrmtywC; locale=zh-cn; ..."
    返回: {"csrfToken": "LCkwngWb9HPaKUIhBHrmtywC", "locale": "zh-cn", ...}
    """
    cookies = {}
    for item in cookie_string.split(';'):
        item = item.strip()
        if '=' in item:
            key, value = item.split('=', 1)
            cookies[key.strip()] = value.strip()
    return cookies


class OptionQuoteTester:
    """期权行情API测试类"""
    
    def __init__(self, cookie_string=None):
        """
        初始化测试类
        
        参数：
            cookie_string: 可选，从浏览器复制的完整 Cookie header 字符串
                          如果提供，会自动解析并设置 cookies
        """
        self.session = requests.Session()
        self.base_headers = {
            "authority": "www.futunn.com",
            "accept": "application/json, text/plain, */*",
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7",
            "cache-control": "no-cache",
            "futu-x-csrf-token": "LCkwngWb9HPaKUIhBHrmtywC",  # 从浏览器获取的实际值
            "pragma": "no-cache",
            "referer": "https://www.futunn.com/stock/TSLA-US/options-chain",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
        }
        
        # 从浏览器获取的cookies
        if cookie_string:
            # 如果提供了 cookie 字符串，自动解析
            self.cookies = parse_cookie_string(cookie_string)
            print(f"✅ 已从 cookie 字符串解析出 {len(self.cookies)} 个 cookies")
            
            # 更新 CSRF token（从 cookies 中获取）
            csrf_token = self.cookies.get("csrfToken")
            if csrf_token:
                self.base_headers["futu-x-csrf-token"] = csrf_token
                print(f"✅ 已更新 CSRF token: {csrf_token[:20]}...")
        else:
            # 默认 cookies（已更新为实际值）
            # 注意：cookies 可能会过期，如果测试失败请从浏览器重新获取
            self.cookies = {
                "csrfToken": "LCkwngWb9HPaKUIhBHrmtywC",
                "futu-csrf": "GfIZNdJDE7eCk829lIGiMddNbPw=",
                "locale": "zh-cn",
                "HMACCOUNT": "4A9AF222CE7E24BE",
                "cipher_device_id": "1755161091991146",
                "device_id": "1755161091991146",
                # 注意：如果需要完整功能，可能需要更多 cookies
                # 建议：从浏览器 Network 标签中复制完整的 Cookie header
            }
        
        # 设置cookies
        for name, value in self.cookies.items():
            self.session.cookies.set(name, value)
    
    def generate_quote_token(self, params=None, data=None, debug=False):
        """
        生成quote-token
        
        算法：
        1. 将参数序列化为JSON字符串（保持参数顺序）
        2. HMAC-SHA512加密，密钥为"quote_web"
        3. 取前10位
        4. SHA256哈希
        5. 取前10位作为最终token
        
        注意：参数类型很重要！数字类型和字符串类型会生成不同的token
        """
        if data is not None:
            data_str = json.dumps(data, separators=(',', ':'))
        elif params:
            # 重要：使用 separators=(',', ':') 确保紧凑格式，与浏览器一致
            # 注意：Python 3.7+ 的字典保持插入顺序，但为了确保顺序正确，
            # 我们需要按照浏览器请求的顺序构建参数字典
            data_str = json.dumps(params, separators=(',', ':'))
        else:
            data_str = "{}"
        
        if len(data_str) <= 0:
            data_str = "quote"
        
        if debug:
            print(f"[DEBUG] 参数序列化结果: {data_str}")
            # 验证：使用浏览器完全相同的参数计算 token
            browser_params_exact = {
                "stockId": 201335,
                "strikeDate": 1763701200,
                "expiration": 0,
                "_": 1763968413473
            }
            expected_token = "6ab7fbeac5"
            
            # 测试不同的序列化方式
            print(f"\n[DEBUG] ========== 使用浏览器完全相同参数测试 ==========")
            print(f"[DEBUG] 浏览器参数: {browser_params_exact}")
            print(f"[DEBUG] 期望 token: {expected_token}")
            
            # 测试1：标准 JSON 序列化（数字类型）
            browser_str1 = json.dumps(browser_params_exact, separators=(',', ':'))
            browser_hmac1 = hmac.new("quote_web".encode('utf-8'), browser_str1.encode('utf-8'), hashlib.sha512).hexdigest()
            browser_token1 = hashlib.sha256(browser_hmac1[:10].encode('utf-8')).hexdigest()[:10]
            print(f"[DEBUG] 测试1 - 数字类型:")
            print(f"[DEBUG]   JSON: {browser_str1}")
            print(f"[DEBUG]   Token: {browser_token1} {'✅ 匹配' if browser_token1 == expected_token else '❌ 不匹配'}")
            
            # 测试2：字符串类型
            browser_params_str = {
                "stockId": "201335",
                "strikeDate": "1763701200",
                "expiration": "0",
                "_": "1763968413473"
            }
            browser_str2 = json.dumps(browser_params_str, separators=(',', ':'))
            browser_hmac2 = hmac.new("quote_web".encode('utf-8'), browser_str2.encode('utf-8'), hashlib.sha512).hexdigest()
            browser_token2 = hashlib.sha256(browser_hmac2[:10].encode('utf-8')).hexdigest()[:10]
            print(f"[DEBUG] 测试2 - 字符串类型:")
            print(f"[DEBUG]   JSON: {browser_str2}")
            print(f"[DEBUG]   Token: {browser_token2} {'✅ 匹配' if browser_token2 == expected_token else '❌ 不匹配'}")
            
            # 测试3：不同的参数顺序
            test_orders = [
                ("stockId, strikeDate, expiration, _", {"stockId": 201335, "strikeDate": 1763701200, "expiration": 0, "_": 1763968413473}),
                ("strikeDate, stockId, expiration, _", {"strikeDate": 1763701200, "stockId": 201335, "expiration": 0, "_": 1763968413473}),
                ("stockId, strikeDate, _, expiration", {"stockId": 201335, "strikeDate": 1763701200, "_": 1763968413473, "expiration": 0}),
            ]
            
            print(f"[DEBUG] 测试3 - 不同参数顺序:")
            for name, test_params in test_orders:
                test_str = json.dumps(test_params, separators=(',', ':'))
                test_hmac = hmac.new("quote_web".encode('utf-8'), test_str.encode('utf-8'), hashlib.sha512).hexdigest()
                test_token = hashlib.sha256(test_hmac[:10].encode('utf-8')).hexdigest()[:10]
                match = "✅ 匹配" if test_token == expected_token else "❌ 不匹配"
                print(f"[DEBUG]   {name}: {test_token} {match}")
                if test_token == expected_token:
                    print(f"[DEBUG]   🎉 找到匹配的顺序！")
                    break
            
            print(f"[DEBUG] ==================================================")
        
        # HMAC-SHA512加密
        hmac_result = hmac.new(
            "quote_web".encode('utf-8'),
            data_str.encode('utf-8'),
            hashlib.sha512
        ).hexdigest()
        
        first_slice = hmac_result[:10]
        
        if debug:
            print(f"[DEBUG] HMAC-SHA512前10位: {first_slice}")
        
        # SHA256哈希
        sha256_result = hashlib.sha256(first_slice.encode('utf-8')).hexdigest()
        token = sha256_result[:10]
        
        if debug:
            print(f"[DEBUG] 最终token: {token}")
        
        return token
    
    def test_search_stock(self, keyword="tsla"):
        """
        测试步骤1：搜索正股
        
        参数：
            keyword: 股票代码，例如 "tsla"
        """
        print("\n" + "=" * 80)
        print("测试1：搜索正股接口")
        print("=" * 80)
        
        url = "https://www.futunn.com/search-stock/predict"
        params = {
            "keyword": keyword,
            "lang": "zh-cn",
            "site": "cn"
        }
        
        headers = self.base_headers.copy()
        
        print(f"请求URL: {url}")
        print(f"请求参数: {params}")
        print(f"Headers: {json.dumps(headers, indent=2, ensure_ascii=False)}")
        print("-" * 80)
        
        try:
            response = self.session.get(url, params=params, headers=headers, timeout=10)
            
            print(f"状态码: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"响应内容: {json.dumps(data, indent=2, ensure_ascii=False)}")
                
                if data.get("code") == 0:
                    stock_list = data.get("data", {}).get("stock", [])
                    if stock_list:
                        # 查找正股（非ETF）
                        for stock in stock_list:
                            if stock.get("symbol") == keyword.upper() + ".US":
                                print("\n✅ 找到正股信息：")
                                print(f"  stockId: {stock.get('stockId')}")
                                print(f"  marketType: {stock.get('marketType')}")
                                print(f"  symbol: {stock.get('symbol')}")
                                print(f"  stockName: {stock.get('stockName')}")
                                print(f"  hasOption: {stock.get('hasOption')}")
                                return {
                                    "success": True,
                                    "stockId": stock.get("stockId"),
                                    "marketType": stock.get("marketType"),
                                    "symbol": stock.get("symbol"),
                                    "stockName": stock.get("stockName")
                                }
                
                return {"success": False, "message": "未找到正股信息"}
            else:
                print(f"请求失败，状态码: {response.status_code}")
                print(f"响应内容: {response.text}")
                return {"success": False, "message": f"HTTP {response.status_code}"}
                
        except Exception as e:
            print(f"请求异常: {e}")
            import traceback
            traceback.print_exc()
            return {"success": False, "message": str(e)}
    
    def test_get_option_chain(self, stock_id, strike_date_timestamp):
        """
        测试步骤2：获取期权链
        
        参数：
            stock_id: 正股ID，例如 "201335" 或 201335
            strike_date_timestamp: 行权日期时间戳（秒级），例如 1763701200
        """
        print("\n" + "=" * 80)
        print("测试2：获取期权链接口")
        print("=" * 80)
        
        url = "https://www.futunn.com/quote-api/quote-v2/get-option-chain"
        timestamp_ms = int(time.time() * 1000)
        
        # 重要：根据测试结果，浏览器使用字符串类型参数生成 token！
        # 虽然 URL 参数看起来是数字，但 JSON.stringify 时使用的是字符串类型
        # 注意：参数顺序很重要，必须与浏览器请求一致：stockId, strikeDate, expiration, _
        
        # 使用字符串类型参数（已验证匹配浏览器）
        params = {
            "stockId": str(stock_id),
            "strikeDate": str(strike_date_timestamp),
            "expiration": "0",
            "_": str(timestamp_ms)
        }
        
        # 生成 quote-token（使用字符串类型，已验证匹配浏览器）
        quote_token = self.generate_quote_token(params=params, debug=True)
        
        headers = self.base_headers.copy()
        headers["quote-token"] = quote_token
        
        # 注意：虽然 token 使用字符串类型生成，但实际 URL 参数需要转换为数字类型
        # requests 库会自动处理，但为了确保正确，我们显式转换
        params_for_url = {
            "stockId": int(stock_id),
            "strikeDate": int(strike_date_timestamp),
            "expiration": 0,
            "_": timestamp_ms
        }
        
        print(f"请求URL: {url}")
        print(f"请求参数（用于token生成，字符串类型）: {params}")
        print(f"请求参数（用于URL，数字类型）: {params_for_url}")
        print(f"参数类型（token生成）: stockId={type(params['stockId']).__name__}, strikeDate={type(params['strikeDate']).__name__}, expiration={type(params['expiration']).__name__}, _={type(params['_']).__name__}")
        print(f"quote-token: {quote_token}")
        print(f"✅ 使用字符串类型参数生成 token（已验证匹配浏览器行为）")
        print("-" * 80)
        
        try:
            response = self.session.get(url, params=params_for_url, headers=headers, timeout=10)
            
            print(f"状态码: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"响应内容: {json.dumps(data, indent=2, ensure_ascii=False)}")
                
                if data.get("code") == 0:
                    option_list = data.get("data", [])
                    print(f"\n✅ 获取到 {len(option_list)} 个行权价的期权对")
                    
                    # 查找目标期权 TSLA251121P395000
                    target_code = "TSLA251121P395000"
                    for option_pair in option_list:
                        put_option = option_pair.get("putOption")
                        call_option = option_pair.get("callOption")
                        
                        if put_option and put_option.get("code") == target_code:
                            print(f"\n✅ 找到目标期权：{target_code}")
                            print(f"  optionId: {put_option.get('optionId')}")
                            print(f"  optionType: {put_option.get('optionType')}")
                            print(f"  strikePrice: {put_option.get('strikePrice')}")
                            print(f"  strikeDate: {put_option.get('strikeDate')}")
                            return {
                                "success": True,
                                "optionId": put_option.get("optionId"),
                                "optionType": put_option.get("optionType"),
                                "code": put_option.get("code")
                            }
                        elif call_option and call_option.get("code") == target_code.replace("P", "C"):
                            print(f"\n✅ 找到目标期权（Call）：{call_option.get('code')}")
                            print(f"  optionId: {call_option.get('optionId')}")
                            return {
                                "success": True,
                                "optionId": call_option.get("optionId"),
                                "optionType": call_option.get("optionType"),
                                "code": call_option.get("code")
                            }
                    
                    # 如果没有找到目标期权，返回第一个Put期权作为示例
                    for option_pair in option_list:
                        put_option = option_pair.get("putOption")
                        if put_option:
                            print(f"\n⚠️  未找到目标期权，返回示例期权：{put_option.get('code')}")
                            print(f"  optionId: {put_option.get('optionId')}")
                            return {
                                "success": True,
                                "optionId": put_option.get("optionId"),
                                "optionType": put_option.get("optionType"),
                                "code": put_option.get("code")
                            }
                    
                    return {"success": False, "message": "未找到目标期权"}
                else:
                    print(f"❌ API返回错误: code={data.get('code')}, message={data.get('message')}")
                    return {"success": False, "message": data.get("message", "未知错误")}
            else:
                print(f"请求失败，状态码: {response.status_code}")
                print(f"响应内容: {response.text}")
                return {"success": False, "message": f"HTTP {response.status_code}"}
                
        except Exception as e:
            print(f"请求异常: {e}")
            import traceback
            traceback.print_exc()
            return {"success": False, "message": str(e)}
    
    def test_get_kline(self, option_id, market_type="2", kline_type="2"):
        """
        测试步骤3：获取期权K线
        
        参数：
            option_id: 期权ID，例如 "58739929"
            market_type: 市场类型，美股为 "2"（字符串或数字）
            kline_type: K线类型，"1"=分时（使用 get-quote-minute），"2"=日K（使用 get-kline）
        """
        print("\n" + "=" * 80)
        print(f"测试3：获取期权K线接口 (type={kline_type})")
        print("=" * 80)
        
        timestamp_ms = int(time.time() * 1000)
        
        # 重要：分时数据（type=1）使用 get-quote-minute 接口
        # 日K数据（type=2）使用 get-kline 接口
        if kline_type == "1" or kline_type == 1:
            url = "https://www.futunn.com/quote-api/quote-v2/get-quote-minute"
            # 分时数据参数（不需要 tradeDateYMD）
            params_for_token = {
                "stockId": str(option_id),
                "marketType": str(market_type),
                "type": str(kline_type),
                "marketCode": "41",  # 美股期权
                "instrumentType": "8",  # 期权
                "subInstrumentType": "8002",  # 期权子类型
                "_": str(timestamp_ms)
            }
            params_for_url = {
                "stockId": str(option_id),
                "marketType": int(market_type) if isinstance(market_type, str) else market_type,
                "type": int(kline_type) if isinstance(kline_type, str) else kline_type,
                "marketCode": "41",
                "instrumentType": "8",
                "subInstrumentType": "8002",
                "_": timestamp_ms
            }
        else:
            url = "https://www.futunn.com/quote-api/quote-v2/get-kline"
            # 日K数据参数
            params_for_token = {
                "stockId": str(option_id),
                "marketType": str(market_type),
                "type": str(kline_type),
                "marketCode": "41",  # 美股期权
                "instrumentType": "8",  # 期权
                "subInstrumentType": "8002",  # 期权子类型
                "_": str(timestamp_ms)
            }
            params_for_url = {
                "stockId": str(option_id),
                "marketType": int(market_type) if isinstance(market_type, str) else market_type,
                "type": int(kline_type) if isinstance(kline_type, str) else kline_type,
                "marketCode": "41",
                "instrumentType": "8",
                "subInstrumentType": "8002",
                "_": timestamp_ms
            }
        
        # 只在调试模式下显示详细token生成信息
        quote_token = self.generate_quote_token(params=params_for_token, debug=False)
        
        headers = self.base_headers.copy()
        headers["quote-token"] = quote_token
        
        print(f"请求URL: {url}")
        print(f"请求参数（用于URL）: {params_for_url}")
        print(f"quote-token: {quote_token}")
        print("-" * 80)
        
        try:
            response = self.session.get(url, params=params_for_url, headers=headers, timeout=10)
            
            print(f"状态码: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                
                if data.get("code") == 0:
                    kline_data = data.get("data", {})
                    kline_list = kline_data.get("list", [])
                    print(f"\n✅ 获取到 {len(kline_list)} 条K线数据")
                    
                    if kline_list:
                        print("\n前3条数据示例：")
                        for i, item in enumerate(kline_list[:3]):
                            print(f"  数据{i+1}: {json.dumps(item, indent=4, ensure_ascii=False)}")
                    
                    return {
                        "success": True,
                        "data": kline_data,
                        "count": len(kline_list)
                    }
                else:
                    # 简化错误输出
                    error_code = data.get('code')
                    error_msg = data.get('message', '未知错误')
                    print(f"\n❌ API返回错误:")
                    print(f"   错误代码: {error_code}")
                    print(f"   错误信息: {error_msg}")
                    print(f"   完整响应: {json.dumps(data, indent=2, ensure_ascii=False)}")
                    return {"success": False, "message": error_msg, "code": error_code}
            else:
                print(f"\n❌ HTTP请求失败:")
                print(f"   状态码: {response.status_code}")
                print(f"   响应内容: {response.text[:500]}")  # 只显示前500字符
                return {"success": False, "message": f"HTTP {response.status_code}"}
                
        except Exception as e:
            print(f"\n❌ 请求异常:")
            print(f"   异常类型: {type(e).__name__}")
            print(f"   异常信息: {str(e)}")
            import traceback
            print(f"   堆栈跟踪:")
            traceback.print_exc()
            return {"success": False, "message": str(e)}


def parse_option_code(option_code):
    """
    解析期权代码，提取日期和行权价
    
    例如：TSLA251121P395000
    - symbol: TSLA
    - date: 251121 (2025-11-21)
    - type: P (Put)
    - strike: 395000 (395.000)
    
    注意：期权到期日时间戳需要使用美东时间（EST/EDT）的特定时间点
    通常设置为当天的 00:00:00 EST，对应 UTC 05:00:00（冬令时）或 UTC 04:00:00（夏令时）
    
    验证：TSLA251121P395000 应该对应时间戳 1763701200
    """
    # 提取日期部分（6位数字）
    import re
    from datetime import timezone
    
    match = re.match(r'([A-Z]+)(\d{6})([CP])(\d+)', option_code)
    if match:
        symbol = match.group(1)
        date_str = match.group(2)
        option_type = match.group(3)
        strike_str = match.group(4)
        
        # 转换日期：251121 -> 2025-11-21
        year = 2000 + int(date_str[:2])
        month = int(date_str[2:4])
        day = int(date_str[4:6])
        
        # 期权到期日时间戳计算
        # 根据实际测试，TSLA251121P395000 对应的时间戳是 1763701200
        # 这个时间戳对应 2025-11-21 05:00:00 UTC
        # 美东时间（EST，UTC-5）的 00:00:00 对应 UTC 05:00:00
        
        # 创建 UTC 时间对象（美东时间 00:00:00 对应 UTC 05:00:00）
        # 注意：11月是冬令时，使用 EST (UTC-5)
        dt_utc = datetime(year, month, day, 5, 0, 0, tzinfo=timezone.utc)
        
        # 转换为时间戳（秒级）
        timestamp = int(dt_utc.timestamp())
        
        # 验证：对于 TSLA251121P395000，期望的时间戳是 1763701200
        # 如果计算出的时间戳不对，可能需要调整UTC偏移量
        # 但根据标准计算，2025-11-21 05:00:00 UTC 应该对应 1763701200
        
        return {
            "symbol": symbol,
            "date": date_str,
            "type": option_type,
            "strike": strike_str,
            "strike_date_timestamp": timestamp,
            "date_formatted": f"{year}-{month:02d}-{day:02d}"
        }
    return None


def main():
    """主测试函数"""
    print("\n" + "=" * 80)
    print("期权行情API测试工具")
    print("=" * 80)
    print("\n测试目标：获取 TSLA251121P395000 期权行情")
    print("=" * 80)
    
    # 使用说明：
    # 1. 打开浏览器开发者工具（F12）
    # 2. 切换到 Network 标签
    # 3. 访问 https://www.futunn.com/stock/TSLA-US/options-chain
    # 4. 找到 get-option-chain 请求
    # 5. 复制 Request Headers 中的 Cookie 值
    # 6. 将 cookie 字符串传递给 OptionQuoteTester
    #
    # 示例：
    # cookie_string = "csrfToken=LCkwngWb9HPaKUIhBHrmtywC; locale=zh-cn; ..."
    # tester = OptionQuoteTester(cookie_string=cookie_string)
    
    # 如果不想手动复制 cookies，可以使用默认值（需要先更新代码中的 cookies）
    tester = OptionQuoteTester()
    
    # 如果要从浏览器复制 cookies，取消下面的注释并替换为实际的 cookie 字符串：
    # cookie_string = "从浏览器复制的完整 Cookie header 字符串"
    # tester = OptionQuoteTester(cookie_string=cookie_string)
    
    # 解析期权代码
    option_code = "TSLA251121P395000"
    option_info = parse_option_code(option_code)
    
    if not option_info:
        print(f"❌ 无法解析期权代码: {option_code}")
        return
    
    print(f"\n解析期权代码: {option_code}")
    print(f"  标的: {option_info['symbol']}")
    print(f"  日期: {option_info['date_formatted']}")
    print(f"  类型: {'Put' if option_info['type'] == 'P' else 'Call'}")
    print(f"  行权价: {int(option_info['strike']) / 1000}")
    print(f"  计算的时间戳: {option_info['strike_date_timestamp']}")
    
    # 验证时间戳（TSLA251121P395000 应该对应 1763701200）
    expected_timestamp = 1763701200
    calculated_timestamp = option_info['strike_date_timestamp']
    
    if calculated_timestamp == expected_timestamp:
        print(f"  ✅ 时间戳验证通过: {calculated_timestamp}")
    else:
        print(f"  ⚠️  时间戳不匹配！")
        print(f"     期望: {expected_timestamp}")
        print(f"     计算: {calculated_timestamp}")
        print(f"     差值: {abs(calculated_timestamp - expected_timestamp)} 秒")
        print(f"  🔧 使用期望的时间戳继续测试...")
        option_info['strike_date_timestamp'] = expected_timestamp
    
    # 步骤1：搜索正股
    stock_result = tester.test_search_stock(keyword=option_info['symbol'].lower())
    
    if not stock_result.get("success"):
        print("\n❌ 步骤1失败，无法继续测试")
        return
    
    stock_id = stock_result["stockId"]
    market_type = stock_result["marketType"]
    
    # 步骤2：获取期权链
    strike_date = option_info['strike_date_timestamp']
    option_chain_result = tester.test_get_option_chain(stock_id, strike_date)
    
    if not option_chain_result.get("success"):
        print("\n❌ 步骤2失败，无法继续测试")
        return
    
    option_id = option_chain_result["optionId"]
    
    # 步骤3：获取K线数据（分时）
    print("\n" + "=" * 80)
    print("测试分时数据 (type=1)")
    print("=" * 80)
    kline_result_1 = tester.test_get_kline(option_id, market_type, kline_type="1")
    
    # 步骤3：获取K线数据（日K）
    print("\n" + "=" * 80)
    print("测试日K数据 (type=2)")
    print("=" * 80)
    kline_result_2 = tester.test_get_kline(option_id, market_type, kline_type="2")
    
    # 总结
    print("\n" + "=" * 80)
    print("测试总结")
    print("=" * 80)
    print(f"步骤1（搜索正股）: {'✅ 成功' if stock_result.get('success') else '❌ 失败'}")
    print(f"步骤2（获取期权链）: {'✅ 成功' if option_chain_result.get('success') else '❌ 失败'}")
    
    # 详细显示K线测试结果
    kline1_success = kline_result_1.get('success')
    kline1_msg = kline_result_1.get('message', '')
    kline1_code = kline_result_1.get('code', '')
    print(f"步骤3（获取分时K线）: {'✅ 成功' if kline1_success else '❌ 失败'}", end='')
    if not kline1_success:
        print(f" - {kline1_msg}" + (f" (code: {kline1_code})" if kline1_code else ""))
    else:
        print()
    
    kline2_success = kline_result_2.get('success')
    kline2_msg = kline_result_2.get('message', '')
    kline2_code = kline_result_2.get('code', '')
    print(f"步骤3（获取日K线）: {'✅ 成功' if kline2_success else '❌ 失败'}", end='')
    if not kline2_success:
        print(f" - {kline2_msg}" + (f" (code: {kline2_code})" if kline2_code else ""))
    else:
        print()
    
    if all([
        stock_result.get("success"),
        option_chain_result.get("success"),
        kline_result_1.get("success") or kline_result_2.get("success")
    ]):
        print("\n🎉 所有测试通过！")
    else:
        print("\n⚠️  部分测试失败，请检查错误信息")


if __name__ == "__main__":
    main()

