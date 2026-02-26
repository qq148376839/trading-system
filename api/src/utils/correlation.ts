/**
 * 相关性计算工具模块
 *
 * 提供 Pearson 相关系数计算、自动分组算法、以及配置转换工具。
 * 被 strategy-scheduler / option-backtest / quant API 三方共享。
 */

/**
 * 计算两组数据的 Pearson 相关系数
 * @returns [-1, 1] 之间的相关系数；数据不足 (<10 个点) 返回 0
 */
export function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 10) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumX2 += xs[i] * xs[i];
    sumY2 += ys[i] * ys[i];
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
  );

  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Union-Find 数据结构（用于分组合并）
 */
class UnionFind {
  private parent: Map<string, string> = new Map();
  private rank: Map<string, number> = new Map();

  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // 路径压缩
    let curr = x;
    while (curr !== root) {
      const next = this.parent.get(curr)!;
      this.parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  union(x: string, y: string): void {
    const rootX = this.find(x);
    const rootY = this.find(y);
    if (rootX === rootY) return;

    const rankX = this.rank.get(rootX) || 0;
    const rankY = this.rank.get(rootY) || 0;
    if (rankX < rankY) {
      this.parent.set(rootX, rootY);
    } else if (rankX > rankY) {
      this.parent.set(rootY, rootX);
    } else {
      this.parent.set(rootY, rootX);
      this.rank.set(rootX, rankX + 1);
    }
  }

  getGroups(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      groups.get(root)!.push(key);
    }
    return groups;
  }
}

/**
 * 计算相关性分组
 * @param closePrices - Map<symbol, dailyCloses[]>，每个标的的日收盘价序列
 * @param threshold - 相关系数阈值（默认 0.75），超过此值的标的对归入同组
 * @returns groups（命名分组）+ matrix（两两相关系数）
 */
export function computeCorrelationGroups(
  closePrices: Map<string, number[]>,
  threshold: number = 0.75
): {
  groups: Record<string, string[]>;
  matrix: Record<string, number>;
} {
  const symbols = Array.from(closePrices.keys());
  const matrix: Record<string, number> = {};
  const uf = new UnionFind();

  // 初始化所有标的
  for (const sym of symbols) {
    uf.find(sym);
  }

  // 两两计算 Pearson 相关系数
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const xs = closePrices.get(symbols[i])!;
      const ys = closePrices.get(symbols[j])!;
      const corr = pearsonCorrelation(xs, ys);
      const key = `${symbols[i]}|${symbols[j]}`;
      matrix[key] = Math.round(corr * 10000) / 10000; // 保留4位小数

      if (Math.abs(corr) >= threshold) {
        uf.union(symbols[i], symbols[j]);
      }
    }
  }

  // 构建命名分组
  const rawGroups = uf.getGroups();
  const groups: Record<string, string[]> = {};
  let groupIndex = 0;

  for (const [, members] of rawGroups) {
    members.sort(); // 保证输出稳定
    if (members.length === 1) {
      // 单标的自成一组，使用标的名作为组名
      groups[members[0]] = members;
    } else {
      groups[`GROUP_${groupIndex}`] = members;
      groupIndex++;
    }
  }

  return { groups, matrix };
}

/**
 * 从配置的分组结构转换为 symbol → groupName 映射
 *
 * 输入: { GROUP_0: ['SPY.US', 'QQQ.US'], 'TSLA.US': ['TSLA.US'] }
 * 输出: { 'SPY.US': 'GROUP_0', 'QQQ.US': 'GROUP_0', 'TSLA.US': 'TSLA.US' }
 */
export function buildCorrelationMap(
  configGroups?: Record<string, string[]>
): Record<string, string> | undefined {
  if (!configGroups || Object.keys(configGroups).length === 0) {
    return undefined;
  }

  const map: Record<string, string> = {};
  for (const [groupName, members] of Object.entries(configGroups)) {
    if (!Array.isArray(members)) continue;
    for (const symbol of members) {
      map[symbol] = groupName;
    }
  }

  return Object.keys(map).length > 0 ? map : undefined;
}
