/**
 * 机构选股服务
 * 提供机构列表查询、持仓查询、智能选股等功能
 */

import { moomooProxy } from '../utils/moomoo-proxy';
import institutionCache from './institution-cache.service';
import { parseChineseNumber } from '../utils/chinese-number-parser';
import { logger } from '../utils/logger';
import { getFutunnConfig } from '../config/futunn';

// 获取默认的cookies和CSRF token（从futunn配置获取）
function getDefaultCookies(): string {
  const config = getFutunnConfig();
  return config.cookies || 'cipher_device_id=1763971814778021; ftreport-jssdk%40new_user=1; futu-csrf=niasJM1N1jtj3pyQh6JO4Nknn7c=; device_id=1763971814778021; csrfToken=f51O2KPxQvir0tU5zDCVQpMm; locale=zh-cn';
}

function getDefaultCsrfToken(): string {
  const config = getFutunnConfig();
  return config.csrfToken || 'f51O2KPxQvir0tU5zDCVQpMm';
}

/**
 * 机构信息接口
 */
export interface Institution {
  id: string;
  name: string;
  pictureUrl?: string;
  topHoldings?: Array<{
    symbol: string;
    percentOfPortfolio: number;
    shareHoldingValue: number;
  }>;
  topIncreases?: Array<{
    symbol: string;
    percentOfPortfolio: number;
    percentOfShareChange: number;
  }>;
}

/**
 * 机构持仓接口
 */
export interface InstitutionHolding {
  symbol: string;
  stockCode: string;
  stockName: string;
  percentOfPortfolio: number; // 持仓占比（%），用于选股排序
  shareHoldingPct: number; // 持股比例（%）
  shareHoldingValue: string; // 持仓市值（中文格式）
  shareHoldingValueNumeric: number; // 持仓市值（数字格式）
  percentOfShareChange: number; // 持仓变动比例（%）
  shareChange: string; // 持仓变动（中文格式）
  shareChangeValue: number; // 持仓变动（数字格式）
  price: number; // 当前价格
  industryName: string; // 行业名称
  holdingDate: number; // 持仓日期（时间戳）
  sourceGroupName: string; // 数据来源
}

/**
 * 获取机构列表（支持分页和搜索）
 * @param page 页码，从0开始
 * @param pageSize 每页数量
 */
export async function getInstitutionList(
  page: number = 0,
  pageSize: number = 15
): Promise<{
  institutions: Institution[];
  pagination: {
    page: number;
    pageSize: number;
    pageCount: number;
    total: number;
  };
}> {
  const cacheKey = `institutions:list:${page}:${pageSize}`;
  
  // 尝试从缓存获取
  const cached = institutionCache.get<{
    institutions: Institution[];
    pagination: any;
  }>(cacheKey);
  if (cached) {
    logger.log(`[机构选股] 从缓存获取机构列表: page=${page}`);
    return cached;
  }

  try {
    logger.log(`[机构选股] 调用API获取机构列表: page=${page}, pageSize=${pageSize}`);
    
    const response = await moomooProxy({
      path: '/quote-api/quote-v2/get-owner-position-list',
      params: {
        page,
        pageSize,
      },
      cookies: getDefaultCookies(),
      csrfToken: getDefaultCsrfToken(),
      referer: 'https://www.moomoo.com/hans/quote/institution-tracking',
      timeout: 10000,
    });

    if (response.code !== 0) {
      throw new Error(response.message || '获取机构列表失败');
    }

    const data = response.data || {};
    const institutionList = data.institutionList || [];
    const pagination = data.pagination || {};

    const institutions: Institution[] = institutionList.map((item: any) => ({
      id: String(item.ownerObjectId),
      name: item.ownerObjectName || '',
      pictureUrl: undefined, // 这个接口不返回图片
      topHoldings: undefined, // 这个接口不返回主要持仓
    }));

    const result = {
      institutions,
      pagination: {
        page: pagination.page || 0,
        pageSize: pagination.pageSize || pageSize,
        pageCount: pagination.pageCount || 0,
        total: pagination.total || 0,
      },
    };

    // 缓存结果（5分钟）
    institutionCache.set(cacheKey, result);

    logger.log(`[机构选股] 成功获取机构列表: 第${page + 1}页，共${institutions.length}个机构`);
    return result;
  } catch (error: any) {
    logger.error(`[机构选股] 获取机构列表失败: ${error.message}`);
    throw error;
  }
}

/**
 * 获取热门机构列表
 */
export async function getPopularInstitutions(): Promise<Institution[]> {
  const cacheKey = 'institutions:popular';
  
  // 尝试从缓存获取
  const cached = institutionCache.get<Institution[]>(cacheKey);
  if (cached) {
    logger.log(`[机构选股] 从缓存获取热门机构列表`);
    return cached;
  }

  try {
    logger.log(`[机构选股] 调用API获取热门机构列表`);
    
    const response = await moomooProxy({
      path: '/quote-api/quote-v2/get-popular-position',
      params: {},
      cookies: getDefaultCookies(),
      csrfToken: getDefaultCsrfToken(),
      referer: 'https://www.moomoo.com/hans/quote/institution-tracking',
      timeout: 10000,
    });

    // 调试日志：打印响应结构
    logger.log(`[机构选股] API响应类型: ${typeof response}, 是否有code字段: ${'code' in response}`);
    if (typeof response === 'object' && response !== null) {
      logger.log(`[机构选股] API响应keys: ${Object.keys(response).join(', ')}`);
    }

    // 检查响应格式
    if (!response || typeof response !== 'object') {
      throw new Error(`API响应格式错误: ${typeof response}`);
    }

    // 如果响应包含code字段（Moomoo API格式）
    if ('code' in response) {
      if (response.code !== 0) {
        throw new Error(response.message || '获取机构列表失败');
      }
    } else {
      // 如果响应不包含code字段，可能是直接返回的数据数组
      logger.warn(`[机构选股] API响应不包含code字段，尝试直接使用数据`);
    }

    // 获取数据数组（可能是response.data或response本身）
    const dataArray = ('data' in response && Array.isArray(response.data)) 
      ? response.data 
      : (Array.isArray(response) ? response : []);

    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      logger.warn(`[机构选股] 机构数据为空或格式错误`);
      throw new Error('机构数据格式错误或为空');
    }

    const institutions: Institution[] = dataArray.map((item: any) => {
      // 提取主要持仓（用于展示）
      const topHoldings = (item.shareHolding || []).slice(0, 3).map((holding: any) => ({
        symbol: holding.symbol,
        percentOfPortfolio: parseFloat(holding.percentOfPortfolio) || 0,
        shareHoldingValue: parseChineseNumber(holding.shareHoldingValue || '0'),
      }));

      // 提取增持股票（用于展示）
      const topIncreases = (item.increaseHolding || []).slice(0, 3).map((holding: any) => ({
        symbol: holding.symbol,
        percentOfPortfolio: parseFloat(holding.percentOfPortfolio) || 0,
        percentOfShareChange: parseFloat(holding.percentOfShareChange) || 0,
      }));

      return {
        id: String(item.ownerObjectId),
        name: item.ownerObjectName || '',
        pictureUrl: item.pictureUrl,
        topHoldings,
        topIncreases,
      };
    });

    // 缓存结果
    institutionCache.set(cacheKey, institutions);

    logger.log(`[机构选股] 成功获取 ${institutions.length} 个机构`);
    return institutions;
  } catch (error: any) {
    logger.error(`[机构选股] 获取热门机构列表失败: ${error.message}`);
    logger.error(`[机构选股] 错误详情: ${error.stack || JSON.stringify(error)}`);
    throw error;
  }
}

/**
 * 获取机构持仓列表
 * @param institutionId 机构ID
 * @param periodId 周期ID，默认88（最新季度）
 * @param page 页码，默认0
 * @param pageSize 每页数量，默认50
 */
export async function getInstitutionHoldings(
  institutionId: string,
  periodId: number = 88,
  page: number = 0,
  pageSize: number = 50
): Promise<{
  institutionId: string;
  institutionName: string;
  holdings: InstitutionHolding[];
  pagination: {
    page: number;
    pageSize: number;
    pageCount: number;
    total: number;
  };
}> {
  const cacheKey = `institutions:${institutionId}:holdings:${periodId}:${page}:${pageSize}`;
  
  // 尝试从缓存获取
  const cached = institutionCache.get<{
    institutionId: string;
    institutionName: string;
    holdings: InstitutionHolding[];
    pagination: any;
  }>(cacheKey);
  if (cached) {
    logger.log(`[机构选股] 从缓存获取机构持仓: ${institutionId}`);
    return cached;
  }

  try {
    logger.log(`[机构选股] 调用API获取机构持仓: ${institutionId}, periodId=${periodId}`);
    
    const response = await moomooProxy({
      path: '/quote-api/quote-v2/get-share-holding-list',
      params: {
        ownerObjectId: institutionId,
        periodId,
        page,
        pageSize,
      },
      cookies: getDefaultCookies(),
      csrfToken: getDefaultCsrfToken(),
      referer: 'https://www.moomoo.com/hans/quote/institution-tracking',
      timeout: 10000,
    });

    if (response.code !== 0) {
      throw new Error(response.message || '获取机构持仓失败');
    }

    // 处理响应数据格式
    let data: any;
    if ('data' in response && typeof response.data === 'object') {
      data = response.data;
    } else if (typeof response === 'object' && 'shareHoldingList' in response) {
      data = response;
    } else {
      logger.error(`[机构选股] 机构持仓响应格式错误: ${JSON.stringify(response).substring(0, 200)}`);
      throw new Error('机构持仓数据格式错误');
    }

    const shareHoldingList = data.shareHoldingList || [];
    const pagination = data.pagination || {};

    const holdings: InstitutionHolding[] = shareHoldingList.map((item: any) => {
      const shareHoldingValueStr = item.shareHoldingValue || '0';
      const shareChangeStr = item.shareChange || '0';
      const percentOfShareChangeStr = item.percentOfShareChange || '0';

      return {
        symbol: item.symbol || '',
        stockCode: item.stockCode || '',
        stockName: item.stockName || '',
        percentOfPortfolio: parseFloat(item.percentOfPortfolio) || 0,
        shareHoldingPct: parseFloat(item.shareHoldingPct) || 0,
        shareHoldingValue: shareHoldingValueStr,
        shareHoldingValueNumeric: parseChineseNumber(shareHoldingValueStr),
        percentOfShareChange: parseFloat(percentOfShareChangeStr.replace(/[+-]/g, '')) || 0,
        shareChange: shareChangeStr,
        shareChangeValue: parseChineseNumber(shareChangeStr),
        price: parseFloat(item.price) || 0,
        industryName: item.industryName || '',
        holdingDate: parseInt(item.holdingDate) || 0,
        sourceGroupName: item.sourceGroupName || '',
      };
    });

    const result = {
      institutionId,
      institutionName: shareHoldingList[0]?.ownerObjectName || '',
      holdings,
      pagination: {
        page: pagination.page || 0,
        pageSize: pagination.pageSize || 50,
        pageCount: pagination.pageCount || 0,
        total: pagination.total || 0,
      },
    };

    // 缓存结果
    institutionCache.set(cacheKey, result);

    logger.log(`[机构选股] 成功获取机构持仓: ${institutionId}, 共 ${holdings.length} 只股票`);
    return result;
  } catch (error: any) {
    logger.error(`[机构选股] 获取机构持仓失败: ${error.message}`);
    throw error;
  }
}

/**
 * 智能选股：根据持仓占比排序并筛选
 * @param institutionId 机构ID
 * @param minHoldingRatio 最小持仓占比阈值（%），默认1%
 * @param maxStocks 最大选股数量，默认不限制
 */
export async function selectStocksByInstitution(
  institutionId: string,
  minHoldingRatio: number = 1.0,
  maxStocks?: number
): Promise<InstitutionHolding[]> {
  try {
    // 获取机构持仓（获取所有页，直到达到指定数量或没有更多数据）
    const allHoldings: InstitutionHolding[] = [];
    let page = 0;
    const pageSize = 50;
    let hasMore = true;
    let totalFetched = 0;
    let totalFiltered = 0;

    logger.log(
      `[机构选股] 开始智能选股: 机构=${institutionId}, 最小占比=${minHoldingRatio}%, 目标数量=${maxStocks || '不限制'}`
    );

    while (hasMore && (maxStocks === undefined || allHoldings.length < maxStocks)) {
      const result = await getInstitutionHoldings(institutionId, 88, page, pageSize);
      totalFetched += result.holdings.length;
      
      // 过滤并排序
      const filtered = result.holdings
        .filter((h) => {
          // 只保留美股（.US结尾）
          const isUSStock = h.symbol && h.symbol.endsWith('.US');
          if (!isUSStock) {
            totalFiltered++;
          }
          return isUSStock && h.percentOfPortfolio >= minHoldingRatio;
        })
        .sort((a, b) => {
          // 主要按持仓占比排序
          if (b.percentOfPortfolio !== a.percentOfPortfolio) {
            return b.percentOfPortfolio - a.percentOfPortfolio;
          }
          // 次要按持仓市值排序
          return b.shareHoldingValueNumeric - a.shareHoldingValueNumeric;
        });

      allHoldings.push(...filtered);

      logger.log(
        `[机构选股] 第${page + 1}页: 获取${result.holdings.length}只, 过滤后${filtered.length}只美股, 累计${allHoldings.length}只, 目标=${maxStocks || '不限制'}`
      );

      // 如果已经达到最大数量，停止
      if (maxStocks && allHoldings.length >= maxStocks) {
        logger.log(`[机构选股] 已达到目标数量${maxStocks}只，停止获取`);
        break;
      }

      // 检查是否还有更多数据
      const currentPageCount = result.pagination.pageCount || 0;
      const totalCount = result.pagination.total || 0;
      const isLastPageByCount = currentPageCount > 0 && page + 1 >= currentPageCount;
      const isLastPageByData = result.holdings.length < pageSize;
      
      // 如果明确表示没有更多页，且已经获取了所有数据，停止
      if (isLastPageByCount) {
        // 如果设置了目标数量但还没达到，且总数据量可能还有更多，继续尝试
        if (maxStocks && allHoldings.length < maxStocks && totalCount > totalFetched) {
          logger.log(`[机构选股] pageCount显示只有${currentPageCount}页，但总数据量(${totalCount}) > 已获取(${totalFetched})，尝试获取下一页`);
          hasMore = true;
        } else {
          logger.log(`[机构选股] 已获取所有数据（共${currentPageCount}页，总计${totalCount}只），当前有${allHoldings.length}只美股`);
          break;
        }
      } else if (isLastPageByData) {
        // 当前页数据少于pageSize，可能已经到最后一页了
        // 但如果还没达到目标数量，继续尝试获取下一页
        if (maxStocks && allHoldings.length < maxStocks) {
          logger.log(`[机构选股] 当前页数据不足pageSize(${result.holdings.length}/${pageSize})，但未达到目标数量(${allHoldings.length}/${maxStocks})，尝试获取下一页`);
          hasMore = true; // 继续尝试获取下一页
        } else {
          hasMore = false; // 已达到目标或不需要更多数据
        }
      } else {
        // 当前页数据等于pageSize，肯定还有更多数据
        hasMore = true;
      }
      
      page++;

      // 如果没有更多数据，停止
      if (!hasMore) {
        logger.log(`[机构选股] 没有更多数据，停止获取。当前有${allHoldings.length}只美股`);
        break;
      }
      
      // 防止无限循环：如果已经获取了很多页但还没达到目标，停止
      if (page > 10) {
        logger.warn(`[机构选股] 已获取${page}页数据，为防止无限循环，停止获取。当前有${allHoldings.length}只美股`);
        break;
      }
    }

    // 限制返回数量
    const selectedStocks = maxStocks 
      ? allHoldings.slice(0, maxStocks)
      : allHoldings;

    logger.log(
      `[机构选股] 智能选股完成: 机构=${institutionId}, 最小占比=${minHoldingRatio}%, ` +
      `获取${totalFetched}只股票, 过滤掉${totalFiltered}只非美股, 最终选中${selectedStocks.length}只美股`
    );

    return selectedStocks;
  } catch (error: any) {
    logger.error(`[机构选股] 智能选股失败: ${error.message}`);
    throw error;
  }
}

