import logging
import json
from typing import Dict
from datetime import datetime
import requests
from pathlib import Path

logger = logging.getLogger(__name__)

class EmailNotifier:
    """邮件通知模块"""
    
    def __init__(self, email_config: Dict):
        """初始化邮件通知模块
        
        Args:
            email_config: 邮件配置信息
        """
        self.enabled = email_config['enabled']
        self.api_key = email_config['resend_api_key']
        self.sender = email_config['sender_email']
        self.recipient = email_config['recipient_email']
        
        # 加载股票名称映射
        self.stock_names = self._load_stock_names()
        
    def _load_stock_names(self) -> Dict:
        """加载股票名称映射"""
        try:
            with open(Path("configs/stock_names.json"), 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"加载股票名称映射失败: {str(e)}")
            return {}
            
    def send_email(self, subject: str, content: str):
        """发送邮件
        
        Args:
            subject: 邮件主题
            content: 邮件内容
        """
        if not self.enabled:
            return
            
        try:
            headers = {
                'Authorization': f'Bearer {self.api_key}',
                'Content-Type': 'application/json'
            }
            
            data = {
                'from': self.sender,
                'to': self.recipient,
                'subject': subject,
                'html': content
            }
            
            response = requests.post(
                'https://api.resend.com/emails',
                headers=headers,
                json=data
            )
            
            if response.status_code != 200:
                logger.error(f"发送邮件失败: {response.text}")
            else:
                logger.info(f"发送邮件成功: {subject}")
                
        except Exception as e:
            logger.error(f"发送邮件失败: {str(e)}")
            
    def send_trade_notification(
        self,
        symbol: str,
        trade_type: str,
        quantity: int,
        price: float
    ):
        """发送交易通知
        
        Args:
            symbol: 股票代码
            trade_type: 交易类型(买入/卖出)
            quantity: 交易数量
            price: 交易价格
        """
        stock_name = self.stock_names.get(symbol, symbol)
        subject = f"交易通知 - {stock_name} ({symbol})"
        
        content = f"""
        <h2>交易执行通知</h2>
        <p>时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
        <p>股票: {stock_name} ({symbol})</p>
        <p>操作: {trade_type}</p>
        <p>数量: {quantity}</p>
        <p>价格: {price:.2f}</p>
        <p>金额: {price * quantity:.2f}</p>
        """
        
        self.send_email(subject, content)
        
    def send_alert(self, title: str, message: str):
        """发送警报通知
        
        Args:
            title: 警报标题
            message: 警报内容
        """
        subject = f"系统警报 - {title}"
        
        content = f"""
        <h2>系统警报</h2>
        <p>时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
        <p>类型: {title}</p>
        <p>详情: {message}</p>
        """
        
        self.send_email(subject, content)
        
    def send_daily_report(
        self,
        daily_pnl: float,
        positions: Dict,
        trades: Dict
    ):
        """发送每日报告
        
        Args:
            daily_pnl: 当日盈亏
            positions: 持仓信息
            trades: 交易记录
        """
        subject = f"每日交易报告 - {datetime.now().strftime('%Y-%m-%d')}"
        
        # 构建持仓信息HTML
        positions_html = "<h3>当前持仓</h3><ul>"
        for symbol, pos in positions.items():
            stock_name = self.stock_names.get(symbol, symbol)
            positions_html += f"""
            <li>{stock_name} ({symbol}):
                <ul>
                    <li>数量: {pos['quantity']}</li>
                    <li>成本: {pos['cost']:.2f}</li>
                    <li>市值: {pos['market_value']:.2f}</li>
                    <li>盈亏: {pos['pnl']:.2f}</li>
                </ul>
            </li>
            """
        positions_html += "</ul>"
        
        # 构建交易记录HTML
        trades_html = "<h3>今日交易</h3><ul>"
        for trade in trades:
            stock_name = self.stock_names.get(trade['symbol'], trade['symbol'])
            trades_html += f"""
            <li>{stock_name} ({trade['symbol']}):
                <ul>
                    <li>方向: {trade['side']}</li>
                    <li>数量: {trade['quantity']}</li>
                    <li>价格: {trade['price']:.2f}</li>
                    <li>时间: {trade['time']}</li>
                </ul>
            </li>
            """
        trades_html += "</ul>"
        
        content = f"""
        <h2>每日交易报告</h2>
        <p>日期: {datetime.now().strftime('%Y-%m-%d')}</p>
        <h3>当日盈亏: {daily_pnl:.2f}</h3>
        {positions_html}
        {trades_html}
        """
        
        self.send_email(subject, content) 