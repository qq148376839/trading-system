import resend
from datetime import datetime

class EmailNotifier:
    def __init__(self, email_config):
        self.config = email_config
        resend.api_key = email_config['resend_api_key']
        self.sender = email_config['sender_email']
        self.receiver = email_config['receiver_email']
        
    def send_email(self, subject, message):
        """发送邮件"""
        try:
            html_message = f"<pre>{message}</pre>"  # 使用pre标签保持格式
            response = resend.Emails.send({
                "from": self.sender,
                "to": self.receiver,
                "subject": subject,
                "html": html_message
            })
            return response
            
        except Exception as e:
            print(f"邮件发送失败: {str(e)}")
            
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
        self.send_email(subject, html_message)
        
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
        self.send_email(subject, html_message) 