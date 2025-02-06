# data_collector.py
from datetime import datetime, date, timedelta
from longport.openapi import Period, AdjustType, Market, TradeStatus
import time
from typing import Dict, Set

class DataCollector:
    """市场数据收集器"""
    
    def __init__(self, trading_system):
        """
        初始化数据收集器
        
        参数:
            trading_system: 交易系统实例
        """
        self.ts = trading_system
        self.collected_symbols: Set[str] = set()  # 记录已成功收集的股票
        self.error_symbols: Dict[str, dict] = {}  # 记录错误的股票及其信息
        self.retry_interval = 60  # 重试间隔（秒）
        self.max_retries = 3     # 最大重试次数
        
    def format_symbol(self, symbol):
        """
        格式化股票代码
        
        根据长桥文档规范格式化股票代码：
        - 美股市场：region 为 US，例如：AAPL.US
        - 港股市场：region 为 HK，例如：700.HK
        - A 股市场：region 上交所为 SH，深交所为 SZ，例如：399001.SZ，600519.SH
        """
        if '.' not in symbol:
            if symbol.isdigit():
                if len(symbol) == 6:
                    if symbol.startswith('6'):
                        return f"{symbol}.SH"
                    elif symbol.startswith('0') or symbol.startswith('3'):
                        return f"{symbol}.SZ"
                elif len(symbol) <= 5:
                    return f"{symbol}.HK"
            else:
                return f"{symbol}.US"
        return symbol
        
    def collect_market_data(self, symbols, days=30):
        """收集市场数据"""
        for symbol in symbols:
            try:
                # 收集历史数据
                end_date = datetime.now()
                start_date = end_date - timedelta(days=days)
                
                self.ts.logger.info("DATA", f"开始获取 {symbol} 的历史数据")
                
                # 获取历史K线数据
                candlesticks = self.ts.quote_ctx.history_candlesticks_by_date(
                    symbol,
                    Period.Day,
                    AdjustType.NoAdjust,
                    start_date.date(),
                    end_date.date()
                )
                
                # 打印API返回的数据结构
                # self.ts.logger.debug("DATA", f"API返回数据类型: {type(candlesticks)}")
                # if candlesticks:
                #     self.ts.logger.debug("DATA", f"第一条数据: {candlesticks[0].__dict__ if hasattr(candlesticks[0], '__dict__') else candlesticks[0]}")
                
                if not candlesticks:
                    self.ts.logger.warning("DATA", f"获取 {symbol} 的历史数据失败")
                    continue
                    
                # 保存历史数据
                cursor = self.ts.db.cursor()
                try:
                    for candle in candlesticks:
                        # 打印每条数据的详细信息
                        # self.ts.logger.debug("DATA", f"处理数据: {candle.__dict__ if hasattr(candle, '__dict__') else candle}")
                        
                        query = """
                        INSERT INTO market_data 
                        (symbol, date, open_price, high_price, low_price, close_price, 
                         volume, turnover)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON DUPLICATE KEY UPDATE
                        open_price = VALUES(open_price),
                        high_price = VALUES(high_price),
                        low_price = VALUES(low_price),
                        close_price = VALUES(close_price),
                        volume = VALUES(volume),
                        turnover = VALUES(turnover)
                        """
                        
                        # 打印SQL参数
                        params = (
                            symbol,
                            candle.timestamp,
                            float(candle.open),
                            float(candle.high),
                            float(candle.low),
                            float(candle.close),
                            int(candle.volume),
                            float(candle.turnover)
                        )
                        # self.ts.logger.debug("DATA", f"SQL参数: {params}")
                        
                        cursor.execute(query, params)
                        
                    self.ts.db.commit()
                    self.ts.logger.info("DATA", f"成功保存 {symbol} 的历史市场数据")
                    
                except Exception as e:
                    self.ts.db.rollback()
                    self.ts.logger.error("DATA", f"保存 {symbol} 的历史数据时发生错误: {str(e)}")
                    # 打印详细的错误信息
                    import traceback
                    self.ts.logger.error("DATA", f"错误详情:\n{traceback.format_exc()}")
                finally:
                    cursor.close()
                    
            except Exception as e:
                self.ts.logger.error("DATA", f"收集 {symbol} 的数据时发生错误: {str(e)}")
                import traceback
                self.ts.logger.error("DATA", f"错误详情:\n{traceback.format_exc()}")
                
    def _collect_single_stock_data(self, symbol):
        """收集单个股票的数据"""
        cursor = self.ts.db.cursor()
        try:
            formatted_symbol = self.format_symbol(symbol)
            self.ts.logger.debug("DATA", f"开始收集 {formatted_symbol} 的数据")
            
            try:
                quote = self.ts.quote_ctx.quote([formatted_symbol])
                self.ts.logger.debug("DATA", f"获取到 {formatted_symbol} 的原始数据: {quote}")
            except Exception as e:
                self.ts.logger.error("DATA", f"获取 {formatted_symbol} 行情失败: {str(e)}")
                raise
            
            if not quote:
                raise ValueError(f"无法获取 {formatted_symbol} 的实时行情")
            
            quote_data = quote[0]
            
            # 格式化日期为MySQL datetime格式
            current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            
            # 记录数据处理过程
            self.ts.logger.debug("DATA", f"处理 {formatted_symbol} 数据:")
            self.ts.logger.debug("DATA", f"时间: {current_time}")
            self.ts.logger.debug("DATA", f"开盘: {quote_data.open}")
            self.ts.logger.debug("DATA", f"最高: {quote_data.high}")
            self.ts.logger.debug("DATA", f"最低: {quote_data.low}")
            self.ts.logger.debug("DATA", f"收盘: {quote_data.last_done}")
            
            try:
                cursor.execute("""
                    INSERT INTO market_data 
                    (symbol, date, open_price, high_price, low_price, close_price, volume, turnover)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                    open_price = VALUES(open_price),
                    high_price = VALUES(high_price),
                    low_price = VALUES(low_price),
                    close_price = VALUES(close_price),
                    volume = VALUES(volume),
                    turnover = VALUES(turnover)
                """, (
                    formatted_symbol,
                    current_time,  # 使用格式化的时间字符串
                    float(quote_data.open),
                    float(quote_data.high),
                    float(quote_data.low),
                    float(quote_data.last_done),
                    int(quote_data.volume),
                    float(quote_data.turnover)
                ))
                
                self.ts.db.commit()
                self.ts.logger.info("DATA", f"成功保存 {formatted_symbol} 的市场数据")
                
            except Exception as e:
                self.ts.logger.error("DATA", f"保存 {formatted_symbol} 数据时出错: {str(e)}")
                self.ts.db.rollback()
                raise
            
        except Exception as e:
            self.ts.logger.error("DATA", f"处理 {formatted_symbol} 时发生错误: {str(e)}")
            raise
        finally:
            cursor.close()
            
    def _handle_collection_error(self, symbol, error):
        """处理数据收集错误"""
        if symbol not in self.error_symbols:
            self.error_symbols[symbol] = {
                'retries': 0,
                'last_try': time.time(),
                'error': str(error)
            }
        else:
            self.error_symbols[symbol]['retries'] += 1
            self.error_symbols[symbol]['last_try'] = time.time()
            self.error_symbols[symbol]['error'] = str(error)
            
        self.ts.logger.error(
            "DATA", 
            f"收集 {symbol} 数据失败 (重试 {self.error_symbols[symbol]['retries']}/{self.max_retries}): {str(error)}"
        )
        
    def clear_collection_status(self):
        """清除收集状态"""
        self.collected_symbols.clear()
        self.error_symbols.clear()
        
    def collect_historical_data(self, symbol, start_date=None, end_date=None):
        """
        收集指定股票的历史数据
        
        参数:
            symbol (str): 股票代码
            start_date (date, optional): 开始日期
            end_date (date, optional): 结束日期
        """
        cursor = self.ts.db.cursor()
        try:
            # 格式化股票代码
            formatted_symbol = self.format_symbol(symbol)
            self.ts.logger.debug("DATA", f"收集历史数据: {formatted_symbol}")
            
            # 获取历史K线数据
            candlesticks = self.ts.quote_ctx.history_candlesticks_by_date(
                symbol=formatted_symbol,
                period=Period.Day,
                adjust_type=AdjustType.NoAdjust,
                start_date=start_date,
                end_date=end_date
            )
            
            if candlesticks and len(candlesticks) > 0:  # 直接使用返回的列表
                # 保存K线数据
                query = """
                INSERT INTO market_data 
                (symbol, date, open_price, high_price, low_price, close_price, volume, turnover)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                open_price = VALUES(open_price),
                high_price = VALUES(high_price),
                low_price = VALUES(low_price),
                close_price = VALUES(close_price),
                volume = VALUES(volume),
                turnover = VALUES(turnover)
                """
                
                for candle in candlesticks:  # 直接遍历返回的列表
                    # 时间戳已经是 datetime 对象，直接使用
                    cursor.execute(query, (
                        formatted_symbol,
                        candle.timestamp,  # 直接使用时间戳
                        float(candle.open),
                        float(candle.high),
                        float(candle.low),
                        float(candle.close),
                        candle.volume,
                        float(candle.turnover)
                    ))
                
                self.ts.db.commit()
                self.ts.logger.info("DATA", f"成功收集 {formatted_symbol} 的历史数据")
            
        except Exception as e:
            self.ts.db.rollback()
            self.ts.logger.error("DATA", f"收集历史数据时发生错误: {str(e)}")
            raise
        finally:
            cursor.close()

    def get_market_data(self, symbols, days=30):
        """从数据库获取市场数据"""
        market_data = {}
        cursor = self.ts.db.cursor(dictionary=True)
        
        try:
            for symbol in symbols:
                query = """
                SELECT * FROM market_data 
                WHERE symbol = %s 
                AND date >= DATE_SUB(NOW(), INTERVAL %s DAY)
                ORDER BY date DESC
                """
                cursor.execute(query, (symbol, days))
                market_data[symbol] = cursor.fetchall()
                
            return market_data
            
        except Exception as e:
            self.ts.logger.error("DATA", f"获取市场数据时发生错误: {str(e)}")
            raise
        finally:
            cursor.close()