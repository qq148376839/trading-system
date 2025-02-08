import pytest
import json
from pathlib import Path
from datetime import datetime, timedelta, date
from longport.openapi import Period, CalcIndex, AdjustType, QuoteContext, TradeContext, OrderSide, OrderType, TimeInForceType, Config, SubType
from decimal import Decimal
from unittest.mock import Mock, patch

from data.market_data import MarketDataManager
from strategies.macd_strategy import MACDStrategy
from strategies.rsi_strategy import RSIStrategy
from trading.trading_executor import TradingExecutor
from risk_management.risk_controller import RiskController
from notification.email_notifier import EmailNotifier
from main import TradingSystem
from strategies.lstm_strategy import LSTMStrategy

@pytest.fixture
def db_config():
    """加载数据库配置"""
    config_path = Path(__file__).parent.parent / "configs" / "database_config.json"
    with open(config_path, 'r') as f:
        return json.load(f)

@pytest.fixture
def market_data(db_config):
    """初始化市场数据管理器"""
    manager = MarketDataManager(db_config)
    manager.init_connection()
    return manager

@pytest.fixture
def trading_config():
    """加载交易配置"""
    config_path = Path(__file__).parent.parent / "configs" / "trading_config.json"
    with open(config_path, 'r') as f:
        return json.load(f)

@pytest.fixture
def risk_config():
    """加载风险配置"""
    config_path = Path(__file__).parent.parent / "configs" / "risk_config.json"
    with open(config_path, 'r') as f:
        return json.load(f)

@pytest.fixture
def mock_configs():
    """模拟配置数据"""
    return {
        'database': {
            'host': 'localhost',
            'port': 3306,
            'user': 'test_user',
            'password': 'test_pass',
            'database': 'test_db'
        },
        'risk': {
            'stop_loss': -0.1,
            'take_profit': 0.15,
            'max_daily_loss': -10000,
            'max_position_loss': -5000,
            'volatility_threshold': 0.02
        },
        'email': {
            'enabled': False,
            'resend_api_key': 'test_key',
            'sender_email': 'test@example.com',
            'recipient_email': 'test@example.com'
        },
        'trading': {
            'daily_trade_limit': 5,
            'min_trade_interval': 300,
            'stock_pools': {
                'AI': ['NVDA.US', 'MSFT.US']
            }
        }
    }

@pytest.fixture
def mock_market_data(mock_configs):
    """模拟市场数据管理器"""
    market_data = MarketDataManager(mock_configs['database'])
    market_data.get_api_config = Mock(return_value={
        'app_key': 'test_key',
        'app_secret': 'test_secret',
        'access_token': 'test_token'
    })
    return market_data

@pytest.fixture
def mock_trade_context():
    """模拟交易上下文"""
    trade_ctx = Mock(spec=TradeContext)
    trade_ctx.submit_order = Mock(return_value={'order_id': '12345'})
    trade_ctx.stock_positions = Mock(return_value=[])
    return trade_ctx

@pytest.fixture
def mock_quote_context():
    """模拟行情上下文"""
    quote_ctx = Mock(spec=QuoteContext)
    quote_ctx.subscribe = Mock(return_value=None)
    return quote_ctx

def test_database_connection(market_data):
    """测试数据库连接"""
    assert market_data.pool is not None

def test_get_api_config(market_data):
    """测试获取API配置"""
    config = market_data.get_api_config('SIMULATION')
    assert config is not None
    assert 'app_key' in config
    assert 'app_secret' in config
    assert 'access_token' in config
    assert 'expire_time' in config

def test_macd_strategy_signal_generation(mock_configs, mock_trade_context, mock_market_data):
    """测试MACD策略信号生成"""
    trading_executor = TradingExecutor(
        mock_trade_context,
        RiskController(mock_configs['risk']),
        EmailNotifier(mock_configs['email']),
        mock_configs['trading']
    )
    
    strategy = MACDStrategy(
        mock_market_data,
        trading_executor,
        {'fast_period': 12, 'slow_period': 26, 'signal_period': 9}
    )
    
    # 模拟行情数据
    mock_market_data.get_history_candlesticks = Mock(return_value=[])
    mock_market_data.get_technical_indicators = Mock(return_value={
        'MACD': 0.5,
        'MACD_SIGNAL': 0.3,
        'MACD_HIST': 0.2
    })
    
    signals = strategy.generate_signals(['AAPL.US'])
    assert isinstance(signals, dict)
    assert 'AAPL.US' in signals
    assert signals['AAPL.US'] in [-1, 0, 1]

def test_rsi_strategy_signal_generation(mock_configs, mock_trade_context, mock_market_data):
    """测试RSI策略信号生成"""
    trading_executor = TradingExecutor(
        mock_trade_context,
        RiskController(mock_configs['risk']),
        EmailNotifier(mock_configs['email']),
        mock_configs['trading']
    )
    
    strategy = RSIStrategy(
        mock_market_data,
        trading_executor,
        {'rsi_period': 14, 'overbought': 70, 'oversold': 30}
    )
    
    # 模拟行情数据
    mock_market_data.get_history_candlesticks = Mock(return_value=[])
    mock_market_data.get_technical_indicators = Mock(return_value={
        'RSI': 65
    })
    
    signals = strategy.generate_signals(['AAPL.US'])
    assert isinstance(signals, dict)
    assert 'AAPL.US' in signals
    assert signals['AAPL.US'] in [-1, 0, 1]

def test_market_data_initialization(mock_market_data):
    """测试市场数据管理器初始化"""
    assert mock_market_data is not None
    api_config = mock_market_data.get_api_config()
    assert 'app_key' in api_config
    assert 'app_secret' in api_config
    assert 'access_token' in api_config

def test_risk_controller(mock_configs):
    """测试风险控制器"""
    risk_controller = RiskController(mock_configs['risk'])
    
    # 测试波动率检查
    quote = {'high': 110, 'low': 100}
    assert risk_controller._check_volatility(quote) == 0.1

def test_email_notifier(mock_configs):
    """测试邮件通知系统"""
    notifier = EmailNotifier(mock_configs['email'])
    
    # 测试交易通知
    notifier.send_trade_notification(
        symbol='AAPL.US',
        trade_type='买入',
        quantity=100,
        price=150.0
    )

@pytest.mark.parametrize("strategy_class", [MACDStrategy, RSIStrategy])
def test_strategy_signal_generation(mock_market_data, mock_trade_context, strategy_class, mock_configs):
    """测试策略信号生成"""
    trading_executor = TradingExecutor(
        mock_trade_context,
        RiskController(mock_configs['risk']),
        EmailNotifier(mock_configs['email']),
        mock_configs['trading']
    )
    
    strategy = strategy_class(
        mock_market_data,
        trading_executor,
        {'fast_period': 12, 'slow_period': 26, 'signal_period': 9}
        if strategy_class == MACDStrategy
        else {'rsi_period': 14, 'overbought': 70, 'oversold': 30}
    )
    
    # 模拟行情数据
    mock_market_data.get_history_candlesticks = Mock(return_value=[])
    mock_market_data.get_technical_indicators = Mock(return_value={
        'MACD': 0.5,
        'MACD_SIGNAL': 0.3,
        'MACD_HIST': 0.2,
        'RSI': 65
    })
    
    signals = strategy.generate_signals(['AAPL.US'])
    assert isinstance(signals, dict)
    assert 'AAPL.US' in signals
    assert signals['AAPL.US'] in [-1, 0, 1]

def test_trading_executor(mock_trade_context, mock_configs):
    """测试交易执行器"""
    trading_executor = TradingExecutor(
        mock_trade_context,
        RiskController(mock_configs['risk']),
        EmailNotifier(mock_configs['email']),
        mock_configs['trading']
    )
    
    # 测试执行交易
    trading_executor.execute_trade('AAPL.US', 1, 150.0)
    mock_trade_context.submit_order.assert_called_once()

def test_lstm_strategy(mock_market_data, mock_trade_context, mock_configs):
    """测试LSTM策略"""
    trading_executor = TradingExecutor(
        mock_trade_context,
        RiskController(mock_configs['risk']),
        EmailNotifier(mock_configs['email']),
        mock_configs['trading']
    )
    
    strategy = LSTMStrategy(
        mock_market_data,
        trading_executor,
        {
            'lstm_strategy': {
                'lookback_period': 20,
                'prediction_period': 5,
                'batch_size': 32,
                'epochs': 2,  # 测试时使用较小的轮数
                'lstm_units': [64, 32, 16]
            }
        }
    )
    
    # 模拟历史数据
    mock_data = []
    for i in range(100):
        mock_data.append({
            'timestamp': datetime.now() + timedelta(days=i),
            'open': 100 + i,
            'high': 105 + i,
            'low': 95 + i,
            'close': 102 + i,
            'volume': 1000000
        })
    
    mock_market_data.get_history_candlesticks = Mock(return_value=mock_data)
    
    # 测试模型训练
    strategy.train_model('AAPL.US')
    assert strategy.model is not None
    
    # 测试信号生成
    signals = strategy.generate_signals(['AAPL.US'])
    assert isinstance(signals, dict)
    assert 'AAPL.US' in signals
    assert signals['AAPL.US'] in [-1, 0, 1] 