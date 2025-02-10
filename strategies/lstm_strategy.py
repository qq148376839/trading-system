import logging
import numpy as np
import pandas as pd
from typing import Dict, List
from pathlib import Path
import tensorflow as tf
from sklearn.preprocessing import MinMaxScaler
import joblib
from longport.openapi import Period, AdjustType
import time

from .base_strategy import BaseStrategy

logger = logging.getLogger(__name__)

class LSTMStrategy(BaseStrategy):
    """基于LSTM的价格预测策略"""
    
    def __init__(self, market_data, trading_executor, config):
        try:
            logger.info("开始初始化LSTM策略...")
            logger.info(f"接收到的完整配置: {config}")  # 添加此行以检查配置
            
            super().__init__(market_data, trading_executor, config)
            
            self.config = config.get('lstm_strategy', {})
            self.lookback_period = self.config.get('lookback_period', 20)
            self.prediction_period = self.config.get('prediction_period', 5)
            self.batch_size = self.config.get('batch_size', 32)
            self.lstm_units = self.config.get('lstm_units', [64, 32, 16])
            self.features = self.config.get('features', 
                ["open", "high", "low", "close", "volume"])
            
            logger.info("LSTM参数加载完成")
            
            # 创建模型保存路径
            self.model_path = Path.cwd() / self.config.get('model_path', 'models/lstm_model')
            self.model_path.parent.mkdir(parents=True, exist_ok=True)
            
            self.scaler_path = Path(self.config.get('scaler_path', 
                'models/feature_scaler.pkl'))
            self.scaler_path.parent.mkdir(parents=True, exist_ok=True)
            
            logger.info("模型路径创建完成")
            
            # 初始化模型和缩放器
            self.model = None
            self.scaler = None
            
            # 延迟加载模型
            logger.info("初始化TensorFlow会话...")
            try:
                # 设置TensorFlow日志级别
                tf.get_logger().setLevel('ERROR')
                
                # 配置GPU内存增长
                gpus = tf.config.experimental.list_physical_devices('GPU')
                if gpus:
                    for gpu in gpus:
                        tf.config.experimental.set_memory_growth(gpu, True)
                logger.info("TensorFlow环境配置完成")
                
                # 延迟加载模型
                self.load_model()
                logger.info("模型加载完成")
                
            except Exception as e:
                logger.error(f"TensorFlow初始化失败: {str(e)}")
                raise
            
            # 添加：初始化时训练模型和拟合scaler
            try:
                # 从配置中正确获取stock_pools
                stock_pools = self.config.get('stock_pools', {})
                logger.info(f"获取到的股票池配置: {stock_pools}")
                
                if stock_pools:
                    # 使用第一个股票进行初始训练
                    first_symbol = list(stock_pools.values())[0][0]
                    logger.info(f"使用 {first_symbol} 进行初始训练")
                    self.train_model(first_symbol)
                else:
                    logger.warning("未找到有效的股票池配置，跳过初始训练")
                    
            except Exception as e:
                logger.error(f"初始化训练失败: {str(e)}")
                
            logger.info("LSTM策略初始化完成")
            
        except Exception as e:
            logger.error(f"LSTM策略初始化过程出错: {str(e)}")
            raise
        
    def build_model(self):
        """构建LSTM模型"""
        logger.info("开始构建LSTM模型...")
        try:
            model = tf.keras.Sequential([
                tf.keras.layers.LSTM(
                    units=self.lstm_units[0],
                    return_sequences=True,
                    input_shape=(self.lookback_period, len(self.features))
                ),
                tf.keras.layers.Dropout(self.config.get('dropout_rate', 0.2)),
                
                tf.keras.layers.LSTM(
                    units=self.lstm_units[1],
                    return_sequences=True
                ),
                tf.keras.layers.Dropout(self.config.get('dropout_rate', 0.2)),
                
                tf.keras.layers.LSTM(
                    units=self.lstm_units[2],
                    return_sequences=False
                ),
                tf.keras.layers.Dropout(self.config.get('dropout_rate', 0.2)),
                
                tf.keras.layers.Dense(1, activation='sigmoid')
            ])
            
            model.compile(
                optimizer=tf.keras.optimizers.Adam(
                    learning_rate=self.config.get('learning_rate', 0.001)
                ),
                loss='binary_crossentropy',
                metrics=['accuracy']
            )
            
            logger.info("LSTM模型构建完成")
            return model
            
        except Exception as e:
            logger.error(f"构建LSTM模型失败: {str(e)}")
            raise
        
    def load_model(self):
        """加载模型和缩放器"""
        try:
            if self.model_path.exists():
                logger.info("正在加载已有LSTM模型...")
                self.model = tf.keras.models.load_model(str(self.model_path))
                logger.info("成功加载LSTM模型")
            else:
                logger.info("正在创建新的LSTM模型...")
                self.model = self.build_model()
                logger.info("创建新的LSTM模型完成")
                
            if self.scaler_path.exists():
                self.scaler = joblib.load(self.scaler_path)
                logger.info("成功加载特征缩放器")
            else:
                self.scaler = MinMaxScaler()
                logger.info("创建新的特征缩放器")
                
        except Exception as e:
            logger.error(f"加载模型失败: {str(e)}")
            raise
            
    def prepare_data(self, symbol: str) -> tuple:
        """准备训练数据"""
        try:
            logger.info(f"开始准备 {symbol} 的训练数据")
            max_retries = 3
            required_data = self.lookback_period + self.prediction_period + 100  # 确保有足够的数据
            
            while max_retries > 0:
                # 获取历史K线数据
                klines = self.market_data.get_history_candlesticks(
                    symbol=symbol,
                    period=Period.Day,
                    count=required_data,
                    adjust_type=AdjustType.ForwardAdjust
                )
                
                logger.info(f"获取到 {len(klines)} 条K线数据")
                
                if len(klines) >= 25:  # 最小数据要求
                    break
                
                max_retries -= 1
                time.sleep(1)  # 添加重试延迟
                
            if len(klines) < 25:
                raise ValueError(f"历史数据不足: 需要至少 25 条数据，但只获取到 {len(klines)} 条")
            
            # 转换数据格式
            df = pd.DataFrame([{
                'open': k.open,
                'high': k.high,
                'low': k.low,
                'close': k.close,
                'volume': k.volume,
                'timestamp': k.timestamp
            } for k in klines])
            
            logger.info("K线数据转换完成")
            
            # 计算未来收益率
            df['future_return'] = df['close'].shift(-self.prediction_period) / df['close'] - 1
            df['label'] = (df['future_return'] > 0).astype(int)
            
            # 准备特征数据
            feature_data = df[self.features].values
            if not hasattr(self.scaler, 'n_features_in_'):  # 检查scaler是否已拟合
                logger.info("创建并拟合新的特征缩放器")
                self.scaler = MinMaxScaler()
                feature_data = self.scaler.fit_transform(feature_data)
                # 保存scaler
                joblib.dump(self.scaler, self.scaler_path)
                logger.info("特征缩放器已保存")
            else:
                logger.info("使用现有特征缩放器")
                feature_data = self.scaler.transform(feature_data)
                
            # 创建时间窗口数据
            X, y = [], []
            for i in range(len(df) - self.lookback_period - self.prediction_period):
                X.append(feature_data[i:i+self.lookback_period])
                y.append(df['label'].iloc[i+self.lookback_period])
                
            logger.info(f"获取到原始K线数据: {len(klines)} 条")
            logger.info(f"特征数据shape: {feature_data.shape}")
            
            if not hasattr(self.scaler, 'n_features_in_'):
                logger.info("首次拟合特征缩放器")
            else:
                logger.info("使用已拟合的特征缩放器")
            
            logger.info(f"准备完成，特征数据shape: {np.array(X).shape}, 标签数据shape: {np.array(y).shape}")
            
            return np.array(X), np.array(y)
            
        except Exception as e:
            logger.error(f"准备训练数据失败: {str(e)}")
            raise
            
    def train_model(self, symbol: str):
        """训练模型
        
        Args:
            symbol: 股票代码
        """
        try:
            # 准备训练数据
            X, y = self.prepare_data(symbol)
            
            # 划分训练集和测试集
            split_idx = int(len(X) * self.config.get('train_test_split', 0.8))
            X_train, X_test = X[:split_idx], X[split_idx:]
            y_train, y_test = y[:split_idx], y[split_idx:]
            
            # 训练模型
            self.model.fit(
                X_train, y_train,
                batch_size=self.batch_size,
                epochs=self.config.get('epochs', 100),
                validation_data=(X_test, y_test),
                callbacks=[
                    tf.keras.callbacks.EarlyStopping(
                        monitor='val_loss',
                        patience=10,
                        restore_best_weights=True
                    )
                ]
            )
            
            # 保存模型和缩放器
            self.model.save(str(self.model_path))
            joblib.dump(self.scaler, self.scaler_path)
            
            logger.info(f"模型训练完成: {symbol}")
            
        except Exception as e:
            logger.error(f"模型训练失败: {str(e)}")
            raise
            
    def predict(self, symbol: str) -> float:
        """预测未来价格走势
        
        Args:
            symbol: 股票代码
            
        Returns:
            预测上涨概率
        """
        try:
            # 检查scaler是否已拟合
            if not hasattr(self.scaler, 'n_features_in_'):
                logger.warning(f"Scaler未拟合，正在训练模型: {symbol}")
                self.train_model(symbol)
            
            # 获取最新数据
            klines = self.market_data.get_history_candlesticks(
                symbol=symbol,
                period=Period.Day,
                count=self.lookback_period,
                adjust_type=AdjustType.ForwardAdjust
            )
            
            # 准备特征数据
            feature_data = np.array([[
                k.open, k.high, k.low, k.close, k.volume
            ] for k in klines])
            
            # 特征缩放
            feature_data = self.scaler.transform(feature_data)
            
            # 预测
            X = feature_data.reshape(1, self.lookback_period, len(self.features))
            prob = self.model.predict(X)[0][0]
            
            return float(prob)
            
        except Exception as e:
            logger.error(f"预测失败: {str(e)}")
            raise
            
    def generate_signals(self, symbols: List[str]) -> Dict:
        """生成交易信号
        
        Args:
            symbols: 股票代码列表
            
        Returns:
            交易信号字典 {symbol: signal}
        """
        signals = {}
        
        for symbol in symbols:
            try:
                # 获取预测概率
                prob = self.predict(symbol)
                
                # 生成交易信号
                if prob > 0.7:  # 高概率上涨
                    signals[symbol] = 1
                elif prob < 0.3:  # 高概率下跌
                    signals[symbol] = -1
                else:
                    signals[symbol] = 0
                    
            except Exception as e:
                logger.error(f"生成信号失败 {symbol}: {str(e)}")
                signals[symbol] = 0
                
        return signals
        
    def on_quote_update(self, symbol: str, quote: Dict):
        """实时行情更新回调
        
        Args:
            symbol: 股票代码
            quote: 行情数据
        """
        try:
            # 重新计算信号
            signal = self.generate_signals([symbol])[symbol]
            
            # 如果产生新的交易信号，执行交易
            if signal != 0:
                self.trading_executor.execute_trade(
                    symbol=symbol,
                    signal=signal,
                    price=quote.get('last_done', 0)
                )
                
        except Exception as e:
            logger.error(f"处理行情更新失败 {symbol}: {str(e)}") 