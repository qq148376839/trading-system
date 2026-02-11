import crypto from 'crypto';

/**
 * Moomoo quote-token 生成
 * 算法：HMAC-SHA512(JSON.stringify(params), 'quote_web') -> 前10字符 -> SHA256 -> 前10字符
 */
export function generateQuoteToken(params: Record<string, string>): string {
  const dataStr = JSON.stringify(params);
  if (dataStr.length <= 0) return 'quote';

  const hmacResult = crypto.createHmac('sha512', 'quote_web').update(dataStr).digest('hex');
  const firstSlice = hmacResult.substring(0, 10);
  const sha256Result = crypto.createHash('sha256').update(firstSlice).digest('hex');
  return sha256Result.substring(0, 10);
}
