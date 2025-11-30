/**
 * 选股器服务
 * 支持静态列表和动态筛选（Watchlist 导入）
 */

import pool from '../config/database';

export interface SymbolPoolConfig {
  mode: 'STATIC' | 'DYNAMIC';
  symbols?: string[]; // STATIC 模式
  source?: 'WATCHLIST' | 'MARKET_SCAN';
  groupId?: number; // Watchlist group ID
  filters?: {
    minVolume?: number;
    excludeSymbols?: string[];
  };
}

class StockSelector {
  /**
   * 获取股票池
   */
  async getSymbolPool(config: SymbolPoolConfig): Promise<string[]> {
    let symbols: string[] = [];

    if (config.mode === 'STATIC') {
      // STATIC 模式：直接返回配置的股票列表
      if (!config.symbols || config.symbols.length === 0) {
        throw new Error('STATIC 模式必须提供 symbols 数组');
      }
      symbols = config.symbols;
    } else if (config.mode === 'DYNAMIC') {
      // DYNAMIC 模式：从动态源获取
      if (config.source === 'WATCHLIST') {
        symbols = await this.getWatchlistSymbols(config.groupId);
      } else if (config.source === 'MARKET_SCAN') {
        // Phase 3 实现市场扫描
        throw new Error('MARKET_SCAN 模式将在 Phase 3 实现');
      } else {
        throw new Error(`未知的动态源: ${config.source}`);
      }
    } else {
      throw new Error(`未知的选股模式: ${config.mode}`);
    }

    // 应用过滤器
    symbols = await this.applyFilters(symbols, config.filters);

    return symbols;
  }

  /**
   * 从 Watchlist 获取股票列表
   */
  private async getWatchlistSymbols(groupId?: number): Promise<string[]> {
    let query = 'SELECT DISTINCT symbol FROM watchlist WHERE enabled = true';
    const params: any[] = [];

    if (groupId !== undefined) {
      // 如果 watchlist 表有 group_id 字段，可以按组筛选
      // 当前实现中，watchlist 表可能没有 group_id，这里先忽略
      // query += ' AND group_id = $1';
      // params.push(groupId);
    }

    const result = await pool.query(query, params);
    return result.rows.map((row) => row.symbol);
  }

  /**
   * 应用过滤器
   */
  private async applyFilters(
    symbols: string[],
    filters?: SymbolPoolConfig['filters']
  ): Promise<string[]> {
    if (!filters) {
      return symbols;
    }

    let filtered = [...symbols];

    // 1. 黑名单过滤
    filtered = await this.filterBlacklist(filtered);

    // 2. 排除指定股票
    if (filters.excludeSymbols && filters.excludeSymbols.length > 0) {
      filtered = filtered.filter((symbol) => !filters.excludeSymbols!.includes(symbol));
    }

    // 3. 成交量过滤（如果有 minVolume）
    if (filters.minVolume) {
      // Phase 3 实现：需要调用市场数据 API 获取成交量
      // 当前阶段先跳过成交量过滤
      console.warn('成交量过滤将在 Phase 3 实现');
    }

    return filtered;
  }

  /**
   * 过滤黑名单股票
   */
  private async filterBlacklist(symbols: string[]): Promise<string[]> {
    if (symbols.length === 0) {
      return symbols;
    }

    const blacklistResult = await pool.query(
      `SELECT symbol FROM stock_blacklist WHERE symbol = ANY($1)`,
      [symbols]
    );

    const blacklistedSymbols = new Set(blacklistResult.rows.map((row) => row.symbol));
    return symbols.filter((symbol) => !blacklistedSymbols.has(symbol));
  }

  /**
   * 验证股票是否在黑名单
   */
  async isBlacklisted(symbol: string): Promise<boolean> {
    const result = await pool.query('SELECT id FROM stock_blacklist WHERE symbol = $1', [symbol]);
    return result.rows.length > 0;
  }

  /**
   * 添加股票到黑名单
   */
  async addToBlacklist(symbol: string, reason: string, createdBy?: string): Promise<void> {
    await pool.query(
      `INSERT INTO stock_blacklist (symbol, reason, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (symbol) DO UPDATE SET reason = $2, created_at = NOW()`,
      [symbol, reason, createdBy || 'system']
    );
  }

  /**
   * 从黑名单移除股票
   */
  async removeFromBlacklist(symbol: string): Promise<void> {
    await pool.query('DELETE FROM stock_blacklist WHERE symbol = $1', [symbol]);
  }

  /**
   * 获取黑名单列表
   */
  async getBlacklist(): Promise<Array<{ symbol: string; reason: string; created_at: Date }>> {
    const result = await pool.query(
      'SELECT symbol, reason, created_at FROM stock_blacklist ORDER BY created_at DESC'
    );
    return result.rows;
  }

  /**
   * 验证股票代码格式
   */
  validateSymbolFormat(symbol: string): boolean {
    // 基本格式验证：必须包含 .US 或 .HK 后缀
    return /^[A-Z0-9]+\.[A-Z]{2}$/.test(symbol);
  }
}

// 导出单例
export default new StockSelector();

