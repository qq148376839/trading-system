# strategy.py
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split, GridSearchCV, TimeSeriesSplit
from sklearn.metrics import make_scorer, accuracy_score, precision_score
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import talib
from decimal import Decimal
from .cost_calculator import CostCalculator, Market
from .models.signal import TradeSignal
import traceback
import logging
import os
import json
from utils.logger import DBLogger

class TradingStrategy:
    """交易策略类"""
    
    def __init__(self, config):
        """
        初始化交易策略
        
        参数:
            config: 配置对象
        """
        self.config = config
        self.logger = DBLogger(config.get('db_connection'))
        self.ts = None  # Assuming a trading_system instance is set up elsewhere
        self.stock_pools = config.get('TRADING', {}).get('stock_pools', {})
        self.stock_names = {}
        
        # 加载股票名称
        stock_names_path = os.path.join(os.getcwd(), 'configs', 'stock_names.json')
        if os.path.exists(stock_names_path):
            with open(stock_names_path, 'r', encoding='utf-8') as f:
                self.stock_names = json.load(f)
        
        # 初始化时添加更多参数
        self.model_params = {
            'n_estimators': 100,
            'max_depth': 10,
            'min_samples_split': 5,
            'random_state': 42
        }
        self.model = RandomForestRegressor(**self.model_params)
        self.scaler = StandardScaler()
        self.cost_calculator = CostCalculator()
        self.last_optimization = None
        self.optimization_interval = timedelta(days=7)  # 每周优化一次
        
    def get_historical_data(self, symbol, days=30):
        """获取历史数据"""
        try:
            cursor = self.ts.db.cursor(dictionary=True)
            query = """
            SELECT *
            FROM market_data
            WHERE symbol = %s
            AND trade_time >= DATE_SUB(CURDATE(), INTERVAL %s DAY)
            ORDER BY trade_time DESC
            """
            
            cursor.execute(query, (symbol, days))
            data = cursor.fetchall()
            cursor.close()
            return data
            
        except Exception as e:
            self.logger.error("STRATEGY", f"获取 {symbol} 历史数据时发生错误: {str(e)}")
            return []
        
    def calculate_technical_indicators(self, data):
        """增强版技术指标计算"""
        df = data.copy()
        
        # 基础趋势指标
        df['MA5'] = talib.MA(df['close_price'], timeperiod=5)
        df['MA20'] = talib.MA(df['close_price'], timeperiod=20)
        df['MA60'] = talib.MA(df['close_price'], timeperiod=60)
        
        # 动量指标
        df['RSI'] = talib.RSI(df['close_price'], timeperiod=14)
        df['MACD'], df['MACD_SIGNAL'], df['MACD_HIST'] = talib.MACD(df['close_price'])
        
        # 波动性指标
        df['ATR'] = talib.ATR(df['high_price'], df['low_price'], df['close_price'], timeperiod=14)
        df['BBANDS_UPPER'], df['BBANDS_MIDDLE'], df['BBANDS_LOWER'] = talib.BBANDS(
            df['close_price'], 
            timeperiod=20
        )
        
        # 成交量指标
        df['OBV'] = talib.OBV(df['close_price'], df['volume'])
        df['AD'] = talib.AD(
            df['high_price'], 
            df['low_price'], 
            df['close_price'], 
            df['volume']
        )
        
        # 自定义指标
        df['VOL_MA5'] = talib.MA(df['volume'], timeperiod=5)
        df['PRICE_CHANGE'] = df['close_price'].pct_change()
        df['VOL_CHANGE'] = df['volume'].pct_change()
        
        return df
        
    def analyze_stock(self, symbol):
        """分析股票并生成交易信号"""
        cursor = self.ts.db.cursor(dictionary=True)
        try:
            # 获取最近的市场数据
            query = """
            SELECT * FROM market_data 
            WHERE symbol = %s 
            ORDER BY date DESC 
            LIMIT 30
            """
            cursor.execute(query, (symbol,))
            data = cursor.fetchall()
            
            if not data:
                self.logger.warning("STRATEGY", f"没有找到 {symbol} 的市场数据")
                return {'action': 'HOLD', 'quantity': 0, 'price': 0}
            
            # 这里实现你的交易策略逻辑
            # 示例：简单的均线策略
            ma5 = sum(row['close_price'] for row in data[:5]) / 5
            ma20 = sum(row['close_price'] for row in data[:20]) / 20
            
            current_price = data[0]['close_price']
            
            if ma5 > ma20:  # 金叉
                return {
                    'action': 'BUY',
                    'quantity': 100,  # 示例固定数量
                    'price': current_price
                }
            elif ma5 < ma20:  # 死叉
                return {
                    'action': 'SELL',
                    'quantity': 100,
                    'price': current_price
                }
            
            return {'action': 'HOLD', 'quantity': 0, 'price': current_price}
            
        finally:
            cursor.close()
            
    def train_model(self, symbols=None):
        """
        训练机器学习模型
        
        参数:
            symbols (list): 要训练的股票代码列表，如果为None则使用所有股票池
        """
        if symbols is None:
            symbols = self.ts.stock_pools
            
        try:
            # 收集训练数据
            all_features = []
            all_targets = []
            
            for symbol in symbols:
                # 获取历史数据
                data = self._get_training_data(symbol)
                if data.empty:
                    continue
                    
                # 计算技术指标作为特征
                features = self._calculate_features(data)
                
                # 计算未来收益率作为目标变量（这里用5天后的收益率）
                future_returns = data['close_price'].shift(-5) / data['close_price'] - 1
                future_returns = future_returns[:-5]  # 去掉最后5天的NaN值
                
                # 去掉包含NaN的行
                valid_indices = ~(features.isna().any(axis=1) | future_returns.isna())
                features = features[valid_indices]
                future_returns = future_returns[valid_indices]
                
                all_features.append(features)
                all_targets.append(future_returns)
            
            if not all_features:
                self.logger.warning("MODEL", "没有足够的训练数据")
                return False
                
            # 合并所有股票的数据
            X = np.vstack(all_features)
            y = np.concatenate(all_targets)
            
            # 数据标准化
            X = self.scaler.fit_transform(X)
            
            # 分割训练集和测试集
            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=0.2, random_state=42
            )
            
            # 训练模型
            self.model.fit(X_train, y_train)
            
            # 评估模型
            train_score = self.model.score(X_train, y_train)
            test_score = self.model.score(X_test, y_test)
            
            self.logger.info("MODEL", f"模型训练完成，训练集 R2: {train_score:.4f}, 测试集 R2: {test_score:.4f}")
            
            return True
            
        except Exception as e:
            self.logger.error("MODEL", f"模型训练失败: {str(e)}")
            return False
            
    def _get_training_data(self, symbol):
        """获取训练数据"""
        cursor = self.ts.db.cursor(dictionary=True)
        try:
            query = """
            SELECT 
                date,
                open_price,
                high_price,
                low_price,
                close_price,
                volume,
                turnover
            FROM market_data
            WHERE symbol = %s
            ORDER BY date ASC
            LIMIT 500  # 使用最近500天的数据
            """
            cursor.execute(query, (symbol,))
            data = cursor.fetchall()
            return pd.DataFrame(data)
        finally:
            cursor.close()
            
    def _calculate_features(self, data):
        """计算技术指标特征"""
        df = data.copy()
        
        # 价格特征
        df['returns'] = df['close_price'].pct_change()
        df['price_range'] = (df['high_price'] - df['low_price']) / df['close_price']
        
        # 移动平均
        for window in [5, 10, 20, 60]:
            df[f'ma_{window}'] = df['close_price'].rolling(window=window).mean()
            df[f'ma_vol_{window}'] = df['volume'].rolling(window=window).mean()
        
        # 动量指标
        df['momentum'] = df['close_price'].pct_change(periods=10)
        
        # 波动率
        df['volatility'] = df['returns'].rolling(window=20).std()
        
        # RSI
        delta = df['close_price'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        df['rsi'] = 100 - (100 / (1 + rs))
        
        # 成交量特征
        df['volume_price_corr'] = df['volume'].rolling(window=20).corr(df['close_price'])
        
        # 选择要使用的特征
        features = df[[
            'returns', 'price_range', 
            'ma_5', 'ma_10', 'ma_20', 'ma_60',
            'ma_vol_5', 'ma_vol_10', 'ma_vol_20', 'ma_vol_60',
            'momentum', 'volatility', 'rsi', 'volume_price_corr'
        ]].values
        
        return features
        
    def predict_return(self, symbol):
        """预测股票未来收益率"""
        try:
            # 获取最新数据
            data = self._get_training_data(symbol).tail(60)  # 获取最近60天数据
            if data.empty:
                return None
                
            # 计算特征
            features = self._calculate_features(data)
            latest_features = features[-1:]  # 使用最新一天的特征
            
            # 数据标准化
            latest_features = self.scaler.transform(latest_features)
            
            # 预测
            predicted_return = self.model.predict(latest_features)[0]
            
            return predicted_return
            
        except Exception as e:
            self.logger.error("MODEL", f"预测失败: {str(e)}")
            return None

    def analyze_market(self, symbols, market_data, account_balance):
        """
        分析市场数据并生成交易信号
        """
        signals = []
        
        # 计算可用资金的合理分配
        available_cash = account_balance.available_cash
        max_position_size = available_cash * 0.1  # 单个持仓最大使用10%可用资金
        
        for symbol in symbols:
            if symbol not in market_data:
                continue
            
            data = market_data[symbol]
            
            # 获取当前持仓
            current_position = self.ts.get_position(symbol)
            
            # 计算建议交易数量
            price = data['latest_price']
            suggested_quantity = min(
                int(max_position_size / price),  # 基于资金限制
                int(data['average_volume'] * 0.01)  # 基于成交量限制
            )
            
            # 生成交易信号
            if self._should_buy(data):
                signals.append(TradeSignal(
                    action='BUY',
                    symbol=symbol,
                    quantity=suggested_quantity,
                    price=price
                ))
                
        return signals

    def calculate_ma(self, prices, days):
        """计算移动平均线"""
        if len(prices) < days:
            return None
        return sum(prices[-days:]) / days

    def determine_trend(self, latest_price, ma5, ma10, ma20):
        """确定趋势"""
        if ma5 > ma10 and ma10 > ma20:
            return '上升趋势'
        elif ma5 < ma10 and ma10 < ma20:
            return '下降趋势'
        else:
            return '横盘趋势'

    def update_monthly_order_count(self):
        """更新月度订单数量"""
        # 获取本月订单数量
        month_start = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        order_count = self.ts.db.get_order_count(since=month_start)
        
        # 更新成本计算器
        self.cost_calculator.monthly_order_count = order_count

    def generate_signals(self, market_data):
        """生成交易信号"""
        signals = []
        
        # 这里是你的策略逻辑
        for symbol in market_data:
            # 示例：简单的均线策略
            if self._should_buy(market_data[symbol]):
                signal = TradeSignal(
                    symbol=symbol,
                    direction='BUY',
                    quantity=100  # 示例固定数量
                )
                signals.append(signal)
                
            elif self._should_sell(market_data[symbol]):
                signal = TradeSignal(
                    symbol=symbol,
                    direction='SELL',
                    quantity=100  # 示例固定数量
                )
                signals.append(signal)
        
        return signals

    def optimize_model_parameters(self, X, y):
        """优化随机森林参数"""
        try:
            # 检查是否需要优化
            now = datetime.now()
            if (self.last_optimization and 
                now - self.last_optimization < self.optimization_interval):
                return

            self.logger.info("STRATEGY", "开始优化模型参数...")
            
            # 定义参数网格
            param_grid = {
                'n_estimators': [50, 100, 200],
                'max_depth': [5, 10, 15],
                'min_samples_split': [2, 5, 10],
                'min_samples_leaf': [1, 2, 4]
            }
            
            # 使用时间序列交叉验证
            tscv = TimeSeriesSplit(n_splits=5)
            
            # 定义评分标准
            scoring = {
                'accuracy': make_scorer(accuracy_score),
                'precision': make_scorer(precision_score)
            }
            
            # 网格搜索
            grid_search = GridSearchCV(
                estimator=RandomForestRegressor(),
                param_grid=param_grid,
                cv=tscv,
                scoring=scoring,
                refit='precision',
                n_jobs=-1
            )
            
            grid_search.fit(X, y)
            
            # 更新最优参数
            self.model_params = grid_search.best_params_
            self.model = RandomForestRegressor(**self.model_params)
            self.last_optimization = now
            
            # 记录优化结果
            self.logger.info(
                "STRATEGY", 
                f"模型参数优化完成，最优参数: {self.model_params}"
            )
            
        except Exception as e:
            self.logger.error(
                "STRATEGY", 
                f"模型参数优化失败: {str(e)}"
            )

    def feature_engineering(self, data):
        """特征工程"""
        df = data.copy()
        
        # 计算价格趋势特征
        df['TREND_5'] = (df['close_price'] - df['MA5']) / df['MA5']
        df['TREND_20'] = (df['close_price'] - df['MA20']) / df['MA20']
        
        # 计算波动性特征
        df['VOLATILITY'] = df['ATR'] / df['close_price']
        df['BB_POSITION'] = (df['close_price'] - df['BBANDS_LOWER']) / (df['BBANDS_UPPER'] - df['BBANDS_LOWER'])
        
        # 计算成交量特征
        df['VOLUME_TREND'] = df['volume'] / df['VOL_MA5']
        
        # 添加时间特征
        df['DAY_OF_WEEK'] = pd.to_datetime(df.index).dayofweek
        df['MONTH'] = pd.to_datetime(df.index).month
        
        return df

    def should_trade(self, market_data):
        """
        交易策略判断
        :param market_data: 市场数据
        :return: (bool, str) 是否交易及交易方向 ('buy'/'sell')
        """
        try:
            # 这里实现您的交易逻辑
            current_price = market_data.get('last_done', 0)
            if current_price > 0:
                self.logger.info("STRATEGY", f"检测到交易信号: {market_data}")
                return True
            return False
            
        except Exception as e:
            self.logger.error("STRATEGY", f"策略执行出错: {str(e)}")
            return False
            
    def _ai_sector_strategy(self, market_data):
        # AI板块策略实现
        pass
        
    def _auto_drive_strategy(self, market_data):
        # 自动驾驶板块策略实现
        pass
        
    def _energy_sector_strategy(self, market_data):
        # 能源板块策略实现
        pass
        
    def _robot_sector_strategy(self, market_data):
        # 机器人板块策略实现
        pass