'use client';

import { useState, useEffect } from 'react';
import { quantApi } from '@/lib/api';

interface Institution {
  id: string;
  name: string;
  pictureUrl?: string;
  topHoldings?: Array<{
    symbol: string;
    percentOfPortfolio: number;
    shareHoldingValue: number;
  }>;
}

interface InstitutionHolding {
  symbol: string;
  stockCode: string;
  stockName: string;
  percentOfPortfolio: number;
  shareHoldingPct: number;
  shareHoldingValue: string;
  shareHoldingValueNumeric: number;
  percentOfShareChange: number;
  shareChange: string;
  price: number;
  industryName: string;
}

interface Allocation {
  symbol: string;
  holdingRatio: number;
  allocationRatio: number;
  allocationAmount: number;
  currentPrice: number;
  quantity: number;
}

interface Holding {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  holdingValue: number;
  state: string;
  context: any;
}

interface InstitutionStockSelectorProps {
  capitalAllocationId: number | null;
  availableCapital: number;
  existingHoldings?: Holding[];
  onStocksSelected: (symbols: string[]) => void;
  onAllocationCalculated?: (allocations: Allocation[]) => void;
}

export default function InstitutionStockSelector({
  capitalAllocationId,
  availableCapital,
  existingHoldings = [],
  onStocksSelected,
  onAllocationCalculated,
}: InstitutionStockSelectorProps) {
  const [step, setStep] = useState<'institution' | 'stocks' | 'allocation'>('institution');
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [selectedInstitution, setSelectedInstitution] = useState<Institution | null>(null);
  const [holdings, setHoldings] = useState<InstitutionHolding[]>([]);
  const [selectedStocks, setSelectedStocks] = useState<InstitutionHolding[]>([]);
  const [minHoldingRatio, setMinHoldingRatio] = useState(1.0);
  const [maxStocks, setMaxStocks] = useState<number>(20); // 默认最大选股数量
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [institutionPage, setInstitutionPage] = useState(0);
  const [institutionPageSize] = useState(15);
  const [institutionTotal, setInstitutionTotal] = useState(0);
  const [institutionPageCount, setInstitutionPageCount] = useState(0);
  const [showMoreInstitutions, setShowMoreInstitutions] = useState(false);

  // 加载机构列表
  useEffect(() => {
    loadInstitutions();
  }, [institutionPage, showMoreInstitutions]);

  const loadInstitutions = async () => {
    setLoading(true);
    setError(null);
    try {
      if (showMoreInstitutions) {
        // 加载完整机构列表（支持分页）
        const res = await quantApi.getInstitutionList({
          page: institutionPage,
          pageSize: institutionPageSize,
        });
        if (res.success && res.data) {
          setInstitutions(res.data.institutions || []);
          setInstitutionTotal(res.data.pagination?.total || 0);
          setInstitutionPageCount(res.data.pagination?.pageCount || 0);
        } else {
          setError('获取机构列表失败');
        }
      } else {
        // 加载热门机构列表
        const res = await quantApi.getPopularInstitutions();
        if (res.success && res.data) {
          setInstitutions(res.data);
        } else {
          setError('获取机构列表失败');
        }
      }
    } catch (err: any) {
      setError(err.message || '获取机构列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 选择机构
  const handleSelectInstitution = async (institution: Institution) => {
    setSelectedInstitution(institution);
    setLoading(true);
    setError(null);
    try {
      // 智能选股
      const res = await quantApi.selectStocksByInstitution({
        institutionId: institution.id,
        minHoldingRatio,
        maxStocks,
      });
      if (res.success && res.data) {
        setHoldings(res.data.stocks || []);
        setStep('stocks');
      } else {
        setError('获取机构持仓失败');
      }
    } catch (err: any) {
      setError(err.message || '获取机构持仓失败');
    } finally {
      setLoading(false);
    }
  };

  // 选择/取消选择股票
  const handleToggleStock = (stock: InstitutionHolding) => {
    const index = selectedStocks.findIndex((s) => s.symbol === stock.symbol);
    if (index >= 0) {
      setSelectedStocks(selectedStocks.filter((s) => s.symbol !== stock.symbol));
    } else {
      setSelectedStocks([...selectedStocks, stock]);
    }
  };

  // 计算资金分配
  const handleCalculateAllocation = async () => {
    if (!capitalAllocationId || selectedStocks.length === 0) {
      setError('请先选择资金分配账户和股票');
      return;
    }

    // 如果没有可用资金，给出警告但不阻止操作（编辑策略时允许修改股票池）
    if (availableCapital <= 0) {
      setError('可用资金不足，无法计算资金分配。您可以先选择股票，保存配置后，待有可用资金时再买入。');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // 创建一个临时策略ID用于计算（实际创建策略时会使用真实的ID）
      // 这里我们直接使用可用资金进行计算，不调用API
      const totalHoldingRatio = selectedStocks.reduce(
        (sum, s) => sum + s.percentOfPortfolio,
        0
      );

      if (totalHoldingRatio === 0) {
        setError('持仓占比总和为0，无法计算资金分配');
        setLoading(false);
        return;
      }

      const calculatedAllocations: Allocation[] = selectedStocks.map((stock) => {
        const allocationRatio = (stock.percentOfPortfolio / totalHoldingRatio) * 100;
        const allocationAmount = (availableCapital * stock.percentOfPortfolio) / totalHoldingRatio;
        const quantity = Math.max(1, Math.floor(allocationAmount / stock.price));

        return {
          symbol: stock.symbol,
          holdingRatio: stock.percentOfPortfolio,
          allocationRatio,
          allocationAmount: Math.round(allocationAmount * 100) / 100,
          currentPrice: stock.price,
          quantity,
        };
      });

      setAllocations(calculatedAllocations);
      setStep('allocation');
      if (onAllocationCalculated) {
        onAllocationCalculated(calculatedAllocations);
      }

    } catch (err: any) {
      setError(err.message || '计算资金分配失败');
    } finally {
      setLoading(false);
    }
  };

  // 确认选择
  const handleConfirm = () => {
    const symbols = selectedStocks.map((s) => s.symbol);
    onStocksSelected(symbols);
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded">
          {error}
        </div>
      )}

      {/* 步骤1: 选择机构 */}
      {step === 'institution' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">选择机构</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setShowMoreInstitutions(false)}
                className={`px-3 py-1 text-sm rounded ${
                  !showMoreInstitutions
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                热门机构
              </button>
              <button
                onClick={() => setShowMoreInstitutions(true)}
                className={`px-3 py-1 text-sm rounded ${
                  showMoreInstitutions
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                全部机构
              </button>
            </div>
          </div>
          <div className="mb-4 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                最小持仓占比阈值: {minHoldingRatio}%
              </label>
              <input
                type="range"
                min="0.1"
                max="10"
                step="0.1"
                value={minHoldingRatio}
                onChange={(e) => setMinHoldingRatio(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                最大选股数量: {maxStocks} 只
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={maxStocks}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 20;
                  setMaxStocks(Math.max(1, Math.min(100, value)));
                }}
                className="w-full border rounded px-3 py-2"
              />
              <p className="text-xs text-gray-500 mt-1">
                系统会自动过滤非美股，并获取足够的数据直到达到指定数量
              </p>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-8">加载中...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {institutions.map((institution) => (
                <div
                  key={institution.id}
                  onClick={() => handleSelectInstitution(institution)}
                  className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3 mb-2">
                    {institution.pictureUrl && (
                      <img
                        src={institution.pictureUrl}
                        alt={institution.name}
                        className="w-12 h-12 rounded"
                      />
                    )}
                    <h4 className="font-semibold">{institution.name}</h4>
                  </div>
                  {institution.topHoldings && institution.topHoldings.length > 0 && (
                    <div className="text-sm text-gray-600">
                      <div>主要持仓:</div>
                      <div className="mt-1">
                        {institution.topHoldings.map((h, i) => (
                          <span key={i} className="mr-2">
                            {h.symbol} ({h.percentOfPortfolio.toFixed(2)}%)
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 步骤2: 选择股票 */}
      {step === 'stocks' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">
              选择股票 - {selectedInstitution?.name}
            </h3>
            <button
              onClick={() => setStep('institution')}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              返回选择机构
            </button>
          </div>

          {existingHoldings.length > 0 && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
              <div className="text-sm text-yellow-800 font-medium mb-1">
                ⚠️ 已有持仓提醒
              </div>
              <div className="text-xs text-yellow-700">
                以下股票已有持仓，已占用资金 ${existingHoldings.reduce((sum, h) => sum + h.holdingValue, 0).toFixed(2)}：
                {existingHoldings.map((h) => (
                  <span key={h.symbol} className="ml-2">
                    {h.symbol}({h.quantity}股)
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">
                已选择: {selectedStocks.length} 只股票
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleConfirm}
                  disabled={selectedStocks.length === 0 || loading}
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
                >
                  确认选择
                </button>
                <button
                  onClick={handleCalculateAllocation}
                  disabled={selectedStocks.length === 0 || loading}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                >
                  计算资金分配
                </button>
              </div>
            </div>
          </div>

          <div className="border rounded max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left w-12">
                    <input
                      type="checkbox"
                      checked={selectedStocks.length === holdings.length && holdings.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedStocks([...holdings]);
                        } else {
                          setSelectedStocks([]);
                        }
                      }}
                    />
                  </th>
                  <th className="px-4 py-2 text-left">代码</th>
                  <th className="px-4 py-2 text-left">名称</th>
                  <th className="px-4 py-2 text-right">持仓占比</th>
                  <th className="px-4 py-2 text-right">持仓市值</th>
                  <th className="px-4 py-2 text-right">变动</th>
                  <th className="px-4 py-2 text-right">价格</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((stock) => {
                  const isSelected = selectedStocks.some((s) => s.symbol === stock.symbol);
                  const existingHolding = existingHoldings.find((h) => h.symbol === stock.symbol);
                  return (
                    <tr
                      key={stock.symbol}
                      className={`hover:bg-gray-50 cursor-pointer ${
                        isSelected ? 'bg-blue-50' : ''
                      } ${existingHolding ? 'bg-yellow-50' : ''}`}
                      onClick={() => handleToggleStock(stock)}
                    >
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleStock(stock)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-4 py-2 font-mono">
                        {stock.symbol}
                        {existingHolding && (
                          <span
                            className="ml-2 text-xs text-yellow-600"
                            title={`已有持仓: ${existingHolding.quantity}股，价值 $${existingHolding.holdingValue.toFixed(2)}`}
                          >
                            ⚠️
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">{stock.stockName}</td>
                      <td className="px-4 py-2 text-right">
                        {stock.percentOfPortfolio.toFixed(2)}%
                      </td>
                      <td className="px-4 py-2 text-right">{stock.shareHoldingValue}</td>
                      <td
                        className={`px-4 py-2 text-right ${
                          stock.percentOfShareChange >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {stock.shareChange}
                      </td>
                      <td className="px-4 py-2 text-right">${stock.price.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 步骤3: 资金分配预览 */}
      {step === 'allocation' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">资金分配预览</h3>
            <button
              onClick={() => setStep('stocks')}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              返回选择股票
            </button>
          </div>

          <div className="mb-4 p-4 bg-gray-50 rounded">
            <div className="flex justify-between">
              <span>可用资金:</span>
              <span className="font-semibold">${availableCapital.toFixed(2)}</span>
            </div>
            <div className="flex justify-between mt-2">
              <span>总分配金额:</span>
              <span className="font-semibold">
                ${allocations.reduce((sum, a) => sum + a.allocationAmount, 0).toFixed(2)}
              </span>
            </div>
          </div>

          <div className="border rounded max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left">股票代码</th>
                  <th className="px-4 py-2 text-right">持仓占比</th>
                  <th className="px-4 py-2 text-right">分配比例</th>
                  <th className="px-4 py-2 text-right">分配金额</th>
                  <th className="px-4 py-2 text-right">当前价格</th>
                  <th className="px-4 py-2 text-right">购买数量</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((allocation) => (
                  <tr key={allocation.symbol} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono">{allocation.symbol}</td>
                    <td className="px-4 py-2 text-right">
                      {allocation.holdingRatio.toFixed(2)}%
                    </td>
                    <td className="px-4 py-2 text-right">
                      {allocation.allocationRatio.toFixed(2)}%
                    </td>
                    <td className="px-4 py-2 text-right">
                      ${allocation.allocationAmount.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      ${allocation.currentPrice.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-right">{allocation.quantity} 股</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setStep('stocks')}
              className="px-4 py-2 border rounded hover:bg-gray-50"
            >
              返回
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
            >
              确认选择
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

