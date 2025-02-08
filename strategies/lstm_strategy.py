import logging
import numpy as np
import pandas as pd
from typing import Dict, List
from pathlib import Path
import tensorflow as tf
from sklearn.preprocessing import MinMaxScaler
import joblib
from datetime import datetime, timedelta
from longport.openapi import Period, AdjustType

from .base_strategy import BaseStrategy

logger = logging.getLogger(__name__)

class LSTMStrategy(BaseStrategy):
    """基于LSTM的价格预测策略"""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        
        # 加载LSTM配置
        self.config = self.config.get('lstm_strategy', {})
        self.lookback_period = self.config.get('lookback_period', 20)
        self.prediction_period = self.config.get('prediction_period', 5)
        self.batch_size = self.config.get('batch_size', 32)
        self.lstm_units = self.config.get('lstm_units', [64, 32, 16])
        self.features = self.config.get('features', 
            ["open", "high", "low", "close", "volume"])
        
        # 创建模型保存路径
        self.model_path = Path(self.config.get('model_path', 'models/lstm_model'))
        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        
        self.scaler_path = Path(self.config.get('scaler_path', 
            'models/feature_scaler.pkl'))
        self.scaler_path.parent.mkdir(parents=True, exist_ok=True)
        
        # 初始化模型和缩放器
        self.model = None
        self.scaler = None
        self.load_model()
        
    def build_model(self):
        """构建LSTM模型"""
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
        
        return model
        
    def load_model(self):
        """加载模型和缩放器"""
        try:
            if self.model_path.exists():
                self.model = tf.keras.models.load_model(str(self.model_path))
                logger.info("成功加载LSTM模型")
            else:
                self.model = self.build_model()
                logger.info("创建新的LSTM模型")
                
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
        """准备训练数据
        
        Args:
            symbol: 股票代码
            
        Returns:
            (X, y): 特征数据和标签
        """
        try:
            # 获取历史K线数据
            klines = self.market_data.get_history_candlesticks(
                symbol=symbol,
                period=Period.Day,
                count=self.lookback_period + self.prediction_period + 100,  # 额外数据用于计算收益率
                adjust_type=AdjustType.Forward
            )
            
            # 转换为DataFrame
            df = pd.DataFrame([{
                'timestamp': k.timestamp,
                'open': k.open,
                'high': k.high,
                'low': k.low,
                'close': k.close,
                'volume': k.volume,
            } for k in klines])
            
            # 计算未来收益率
            df['future_return'] = df['close'].shift(-self.prediction_period) / df['close'] - 1
            df['label'] = (df['future_return'] > 0).astype(int)
            
            # 准备特征数据
            feature_data = df[self.features].values
            if self.scaler is None:
                self.scaler = MinMaxScaler()
                feature_data = self.scaler.fit_transform(feature_data)
            else:
                feature_data = self.scaler.transform(feature_data)
                
            # 创建时间窗口数据
            X, y = [], []
            for i in range(len(df) - self.lookback_period - self.prediction_period):
                X.append(feature_data[i:i+self.lookback_period])
                y.append(df['label'].iloc[i+self.lookback_period])
                
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
            # 获取最新数据
            klines = self.market_data.get_history_candlesticks(
                symbol=symbol,
                period=Period.Day,
                count=self.lookback_period,
                adjust_type=AdjustType.Forward
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