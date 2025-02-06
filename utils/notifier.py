import resend
from datetime import datetime
from utils.logger import DBLogger

class EmailNotifier:
    def __init__(self, email_config):
        self.enabled = email_config.get('enabled', False)
        self.logger = DBLogger(email_config.get('db_connection'))
        
        try:
            if not self.enabled:
                self.logger.info("NOTIFY", "邮件通知功能未启用")
                return
            
            resend.api_key = email_config.get('resend_api_key')
            self.sender = email_config.get('sender_email')
            self.recipient = email_config.get('recipient_email')
            
            if not all([resend.api_key, self.sender, self.recipient]):
                self.logger.warning("NOTIFY", "警告: 邮件配置不完整，邮件通知功能将被禁用")
                self.enabled = False
                
        except Exception as e:
            self.logger.error("NOTIFY", f"初始化邮件通知器时出错: {str(e)}")
            self.enabled = False
            
    def send_notification(self, subject, message):
        if not self.enabled:
            self.logger.info("NOTIFY", "邮件通知功能未启用或配置不正确")
            return
            
        try:
            # 发送邮件的逻辑
            params = {
                "from": self.sender,
                "to": self.recipient,
                "subject": subject,
                "text": message
            }
            resend.Emails.send(params)
        except Exception as e:
            self.logger.error("NOTIFY", f"发送邮件时出错: {str(e)}")
            
    def send_risk_alert(self, event_type, description):
        """发送风险警告"""
        subject = f"交易系统风险警告 - {event_type}"
        html_message = f"""
        <h2>风险警告</h2>
        <table>
            <tr>
                <td><strong>风险事件类型:</strong></td>
                <td>{event_type}</td>
            </tr>
            <tr>
                <td><strong>描述:</strong></td>
                <td>{description}</td>
            </tr>
            <tr>
                <td><strong>时间:</strong></td>
                <td>{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</td>
            </tr>
        </table>
        """
        self.send_notification(subject, html_message)
        
    def send_trade_notification(self, trade_type, symbol, quantity, price):
        """发送交易通知"""
        subject = f"交易执行通知 - {trade_type}"
        html_message = f"""
        <h2>交易通知</h2>
        <table>
            <tr>
                <td><strong>交易类型:</strong></td>
                <td>{trade_type}</td>
            </tr>
            <tr>
                <td><strong>股票代码:</strong></td>
                <td>{symbol}</td>
            </tr>
            <tr>
                <td><strong>数量:</strong></td>
                <td>{quantity}</td>
            </tr>
            <tr>
                <td><strong>价格:</strong></td>
                <td>{price}</td>
            </tr>
            <tr>
                <td><strong>时间:</strong></td>
                <td>{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</td>
            </tr>
        </table>
        """
        self.send_notification(subject, html_message) 