'use client';

import { useState, useEffect } from 'react';
import { quantApi, watchlistApi } from '@/lib/api';
import InstitutionStockSelector from '@/components/InstitutionStockSelector';

interface Strategy {
  id: number;
  name: string;
  type: string;
  capitalAllocationId: number | null;
  allocationName: string | null;
  symbolPoolConfig: any;
  config: any;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface EditStrategyModalProps {
  strategy: Strategy;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditStrategyModal({
  strategy,
  onClose,
  onSuccess,
}: EditStrategyModalProps) {
  const [formData, setFormData] = useState({
    name: strategy.name,
    type: strategy.type,
    capitalAllocationId: strategy.capitalAllocationId,
    symbolPoolConfig: {
      mode: strategy.symbolPoolConfig?.mode || 'STATIC',
      symbols: Array.isArray(strategy.symbolPoolConfig?.symbols) 
        ? strategy.symbolPoolConfig.symbols 
        : [],
    },
    config: strategy.config,
  });
  const [allocations, setAllocations] = useState<any[]>([]);
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [newSymbol, setNewSymbol] = useState('');
  const [symbolError, setSymbolError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [availableCapital, setAvailableCapital] = useState(0);
  const [stockPoolMode, setStockPoolMode] = useState<'STATIC' | 'INSTITUTION'>(
    strategy.symbolPoolConfig?.mode === 'INSTITUTION' ? 'INSTITUTION' : 'STATIC'
  );
  const [totalCapital, setTotalCapital] = useState(0);
  const [existingHoldings, setExistingHoldings] = useState<Array<{
    symbol: string;
    quantity: number;
    entryPrice: number;
    currentPrice: number;
    holdingValue: number;
    state: string;
    context: any;
  }>>([]);

  useEffect(() => {
    Promise.all([
      quantApi.getCapitalAllocations(),
      watchlistApi.getWatchlist(true),
      quantApi.getCapitalUsage(),
      quantApi.getStrategyHoldings(strategy.id),
    ]).then(([allocRes, watchRes, usageRes, holdingsRes]) => {
      if (allocRes.success) {
        setAllocations(allocRes.data || []);
      }
      if (watchRes.success && watchRes.data?.watchlist) {
        setWatchlist(watchRes.data.watchlist);
      }
      if (usageRes.success && usageRes.data) {
        setTotalCapital(usageRes.data.totalCapital || 0);
        if (usageRes.data.allocations && Array.isArray(usageRes.data.allocations)) {
          const updatedAllocations = (allocRes.data || []).map((alloc: any) => {
            const usageAlloc = usageRes.data.allocations.find((u: any) => u.id === alloc.id);
            if (usageAlloc && alloc.allocationType === 'PERCENTAGE') {
              return {
                ...alloc,
                actualAllocated: totalCapital * alloc.allocationValue,
              };
            }
            return alloc;
          });
          setAllocations(updatedAllocations);
        }
      }
      if (holdingsRes.success) {
        setExistingHoldings(holdingsRes.data || []);
      }
    });
  }, [strategy.id]);

  useEffect(() => {
    if (formData.capitalAllocationId && allocations.length > 0) {
      const allocation = allocations.find(
        (a) => a.id === formData.capitalAllocationId
      );
      if (allocation) {
        let allocated: number;
        if (allocation.allocationType === 'PERCENTAGE') {
          allocated = totalCapital * parseFloat(allocation.allocationValue || '0');
        } else {
          allocated = parseFloat(allocation.allocationValue || '0');
        }
        
        // 计算已有持仓占用的资金
        const holdingValue = existingHoldings.reduce((sum, h) => {
          return sum + (h.quantity * h.currentPrice);
        }, 0);
        
        const used = parseFloat(allocation.currentUsage || '0');
        // 可用资金 = 分配资金 - 已使用资金 - 已有持仓占用资金
        const available = Math.max(0, allocated - used - holdingValue);
        setAvailableCapital(available);
      } else {
        setAvailableCapital(0);
      }
    } else {
      setAvailableCapital(0);
    }
  }, [formData.capitalAllocationId, allocations, totalCapital, existingHoldings]);

  const validateSymbol = (symbol: string): string | null => {
    const trimmed = symbol.trim().toUpperCase();
    if (!trimmed) {
      return '请输入股票代码';
    }
    let corrected = trimmed;
    if (corrected === 'APPL.US') {
      corrected = 'AAPL.US';
    }
    const symbolPattern = /^\.?[A-Z0-9]+\.[A-Z]{2}$/;
    if (!symbolPattern.test(corrected)) {
      return '无效的标的代码格式。请使用 ticker.region 格式，例如：AAPL.US 或 700.HK';
    }
    return corrected;
  };

  const handleAddSymbol = () => {
    setSymbolError(null);
    const validation = validateSymbol(newSymbol);
    if (typeof validation === 'string' && validation.startsWith('无效')) {
      setSymbolError(validation);
      return;
    }
    if (typeof validation === 'string') {
      const symbol = validation;
      if (formData.symbolPoolConfig.symbols.includes(symbol)) {
        setSymbolError('该股票已在股票池中');
        return;
      }
      setFormData({
        ...formData,
        symbolPoolConfig: {
          ...formData.symbolPoolConfig,
          symbols: [...formData.symbolPoolConfig.symbols, symbol],
        },
      });
      setNewSymbol('');
    }
  };

  const handleAddFromWatchlist = (symbol: string) => {
    if (!formData.symbolPoolConfig.symbols.includes(symbol)) {
      setFormData({
        ...formData,
        symbolPoolConfig: {
          ...formData.symbolPoolConfig,
          symbols: [...formData.symbolPoolConfig.symbols, symbol],
        },
      });
    }
  };

  const handleRemoveSymbol = (symbol: string) => {
    setFormData({
      ...formData,
      symbolPoolConfig: {
        ...formData.symbolPoolConfig,
        symbols: formData.symbolPoolConfig.symbols.filter((s: string) => s !== symbol),
      },
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.symbolPoolConfig.symbols.length === 0) {
      alert('请至少添加一个股票到股票池');
      return;
    }
    setLoading(true);
    try {
      await quantApi.updateStrategy(strategy.id, formData);
      alert('策略已更新');
      onSuccess();
    } catch (err: any) {
      alert(err.message || '更新策略失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col">
        <div className="p-6 border-b">
          <h2 className="text-2xl font-bold">编辑策略</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <form onSubmit={handleSubmit} id="edit-strategy-form">
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">策略名称</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="border rounded px-3 py-2 w-full"
                required
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">资金分配账户</label>
              <select
                value={formData.capitalAllocationId || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    capitalAllocationId: e.target.value ? parseInt(e.target.value) : null,
                  })
                }
                className="border rounded px-3 py-2 w-full"
              >
                <option value="">无</option>
                {allocations.map((alloc) => (
                  <option key={alloc.id} value={alloc.id}>
                    {alloc.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">股票池</label>
              
              {/* 股票池模式选择 */}
              <div className="mb-3">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="stockPoolMode"
                      value="STATIC"
                      checked={stockPoolMode === 'STATIC'}
                      onChange={(e) => {
                        setStockPoolMode('STATIC');
                        setFormData({
                          ...formData,
                          symbolPoolConfig: { 
                            mode: 'STATIC', 
                            symbols: formData.symbolPoolConfig.symbols 
                          },
                        });
                      }}
                    />
                    <span>手动输入</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="stockPoolMode"
                      value="INSTITUTION"
                      checked={stockPoolMode === 'INSTITUTION'}
                      onChange={(e) => {
                        setStockPoolMode('INSTITUTION');
                        setFormData({
                          ...formData,
                          symbolPoolConfig: { 
                            mode: 'INSTITUTION', 
                            symbols: formData.symbolPoolConfig.symbols 
                          },
                        });
                      }}
                    />
                    <span>机构选股</span>
                  </label>
                </div>
              </div>

              {/* 机构选股模式 */}
              {stockPoolMode === 'INSTITUTION' ? (
                <div className="border rounded p-4">
                  {formData.capitalAllocationId ? (
                    <>
                      {availableCapital <= 0 && existingHoldings.length > 0 && (
                        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                          <div className="text-sm text-yellow-800">
                            ⚠️ <strong>提示：</strong>当前可用资金不足（已有持仓占用了资金），但您仍可以修改股票池配置。
                            如需买入新股票，请先平仓部分持仓或增加资金分配。                          </div>
                        </div>
                      )}
                      {availableCapital <= 0 && existingHoldings.length === 0 && (
                        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                          <div className="text-sm text-yellow-800">
                            ⚠️ <strong>提示：</strong>当前可用资金不足，但您仍可以修改股票池配置。
                            如需买入新股票，请先增加资金分配或选择其他账户。                          </div>
                        </div>
                      )}
                      <InstitutionStockSelector
                        capitalAllocationId={formData.capitalAllocationId}
                        availableCapital={Math.max(0, availableCapital)}
                        existingHoldings={existingHoldings}
                        onStocksSelected={(symbols) => {
                          setFormData({
                            ...formData,
                            symbolPoolConfig: {
                              mode: 'INSTITUTION',
                              symbols,
                            },
                          });
                        }}
                      />
                    </>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      请先选择资金分配账户
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* 手动输入模式 */}
                  <div className="mb-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newSymbol}
                        onChange={(e) => {
                          setNewSymbol(e.target.value);
                          setSymbolError(null);
                        }}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddSymbol();
                          }
                        }}
                        placeholder="输入股票代码，例如：AAPL.US"
                        className="flex-1 border rounded px-3 py-2"
                      />
                      <button
                        type="button"
                        onClick={handleAddSymbol}
                        className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                      >
                        添加
                      </button>
                    </div>
                    {symbolError && (
                      <div className="mt-1 text-sm text-red-600">{symbolError}</div>
                    )}
                    <p className="mt-1 text-xs text-gray-500">
                      格式：ticker.region，例如：AAPL.US（美股）、700.HK（港股）
                    </p>
                  </div>

                  {watchlist.length > 0 && (
                    <div className="mb-2">
                      <label className="block text-xs text-gray-500 mb-1">从关注列表快速添加：</label>
                      <div className="flex flex-wrap gap-2">
                        {watchlist
                          .filter((item) => !formData.symbolPoolConfig.symbols.includes(item.symbol))
                          .slice(0, 10)
                          .map((item) => (
                            <button
                              key={item.symbol}
                              type="button"
                              onClick={() => handleAddFromWatchlist(item.symbol)}
                              className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                            >
                              + {item.symbol}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  <div className="border rounded p-2 min-h-[60px] max-h-[200px] overflow-y-auto">
                    {formData.symbolPoolConfig.symbols.length === 0 ? (
                      <div className="text-sm text-gray-400 text-center py-2">暂无股票，请添加</div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {formData.symbolPoolConfig.symbols.map((symbol: string) => (
                          <span
                            key={symbol}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm"
                          >
                            {symbol}
                            <button
                              type="button"
                              onClick={() => handleRemoveSymbol(symbol)}
                              className="text-blue-600 hover:text-blue-800"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* 策略参数配置 */}
            <div className="mb-4">
              {/* 策略类型说明卡片（放在策略参数配置上方） */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-1">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    {formData.type === 'OPTION_INTRADAY_V1' ? (
                      <>
                        <h3 className="text-sm font-semibold text-gray-900 mb-1">期权日内策略 V1（买方）</h3>
                        <p className="text-xs text-gray-600 leading-relaxed mb-2">
                          对正股/指数标的先生成方向信号，再自动选择流动性更好的期权合约开仓；
                          收盘前30分钟强制平仓（不论盈亏），并将期权佣金/平台费计入资金占用与回测。
                        </p>
                        <p className="text-xs text-gray-500 italic">
                          ⚠️ 策略类型创建后不可修改。如需使用其他策略类型，请创建新策略。
                        </p>
                      </>
                    ) : (
                      <>
                        <h3 className="text-sm font-semibold text-gray-900 mb-1">推荐策略 V1</h3>
                        <p className="text-xs text-gray-600 leading-relaxed mb-2">
                          基于市场趋势和ATR（平均真实波幅）的智能推荐策略。系统会分析SPX、USD指数、BTC等市场指标，
                          结合ATR计算止损止盈价格，智能生成买卖信号。适合趋势跟踪和风险控制的量化交易场景。
                        </p>
                        <p className="text-xs text-gray-500 italic">
                          ⚠️ 策略类型创建后不可修改。如需使用其他策略类型，请创建新策略。
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
              
              <label className="block text-sm font-medium mb-2">
                {formData.type === 'OPTION_INTRADAY_V1' ? '期权策略参数' : '策略参数配置'}
                <span className="text-xs text-gray-500 ml-2">
                  {formData.type === 'OPTION_INTRADAY_V1' ? '（强平固定：收盘前30分钟）' : '（用于计算止损止盈价格）'}
                </span>
              </label>
              {formData.type === 'OPTION_INTRADAY_V1' ? (
                <>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">到期选择</label>
                      <select
                        value={formData.config.expirationMode || '0DTE'}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, expirationMode: e.target.value } })}
                        className="border rounded px-3 py-2 w-full"
                      >
                        <option value="0DTE">0DTE优先</option>
                        <option value="NEAREST">最近到期</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">方向</label>
                      <select
                        value={formData.config.directionMode || 'FOLLOW_SIGNAL'}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, directionMode: e.target.value } })}
                        className="border rounded px-3 py-2 w-full"
                      >
                        <option value="FOLLOW_SIGNAL">跟随信号（BUY=Call，SELL=Put）</option>
                        <option value="CALL_ONLY">只买Call</option>
                        <option value="PUT_ONLY">只买Put</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">开仓价格</label>
                      <select
                        value={formData.config.entryPriceMode || 'ASK'}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, entryPriceMode: e.target.value } })}
                        className="border rounded px-3 py-2 w-full"
                      >
                        <option value="ASK">优先用Ask</option>
                        <option value="MID">用Mid</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mt-4">
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">禁止开仓窗口（分钟）</label>
                      <input
                        type="number"
                        value={formData.config.tradeWindow?.noNewEntryBeforeCloseMinutes ?? 60}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            config: {
                              ...formData.config,
                              tradeWindow: {
                                ...(formData.config.tradeWindow || {}),
                                noNewEntryBeforeCloseMinutes: parseInt(e.target.value) || 60,
                                forceCloseBeforeCloseMinutes: 30,
                              },
                            },
                          })
                        }
                        className="border rounded px-3 py-2 w-full"
                        min="0"
                        max="240"
                      />
                      <p className="text-xs text-gray-500 mt-1">强平固定：30分钟</p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">开仓张数模式</label>
                      <select
                        value={formData.config.positionSizing?.mode || 'FIXED_CONTRACTS'}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            config: {
                              ...formData.config,
                              positionSizing: { ...(formData.config.positionSizing || {}), mode: e.target.value },
                            },
                          })
                        }
                        className="border rounded px-3 py-2 w-full"
                      >
                        <option value="FIXED_CONTRACTS">固定张数</option>
                        <option value="MAX_PREMIUM">最大权利金（USD）</option>
                      </select>
                    </div>
                    {formData.config.positionSizing?.mode === 'MAX_PREMIUM' ? (
                      <div>
                        <label className="block text-xs text-gray-700 mb-1 font-medium">最大权利金（USD）</label>
                        <input
                          type="number"
                          value={formData.config.positionSizing?.maxPremiumUsd ?? 300}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              config: {
                                ...formData.config,
                                positionSizing: { ...(formData.config.positionSizing || {}), maxPremiumUsd: parseFloat(e.target.value) || 0 },
                              },
                            })
                          }
                          className="border rounded px-3 py-2 w-full"
                          min="0"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs text-gray-700 mb-1 font-medium">固定张数</label>
                        <input
                          type="number"
                          value={formData.config.positionSizing?.fixedContracts ?? 1}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              config: {
                                ...formData.config,
                                positionSizing: { ...(formData.config.positionSizing || {}), fixedContracts: parseInt(e.target.value) || 1 },
                              },
                            })
                          }
                          className="border rounded px-3 py-2 w-full"
                          min="1"
                          max="20"
                        />
                      </div>
                    )}
                  </div>

                  <div className="mt-3 bg-blue-50 border border-blue-200 rounded p-3">
                    <p className="text-xs text-blue-800">
                      <strong>费用模型（默认）：</strong> 佣金 0.10 USD/张（每单最低0.99） + 平台费 0.30 USD/张
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-3">
                    <p className="text-xs text-blue-800 mb-2">
                      <strong>💡 参数说明：</strong>
                    </p>
                    <ul className="text-xs text-blue-700 space-y-1 ml-4 list-disc">
                      <li><strong>ATR周期</strong>：计算平均真实波幅的周期，默认14天。周期越长，ATR值越平滑但反应越慢。</li>
                      <li><strong>ATR倍数</strong>：用于计算止损距离的倍数，默认2.0。倍数越大，止损距离越远，风险越小但可能错过更多机会。</li>
                      <li><strong>风险收益比</strong>：止盈价格与止损价格的比例，默认1.5。比例越大，潜在收益越高，但需要更强的趋势支持。</li>
                    </ul>
                    <p className="text-xs text-blue-600 mt-2">
                      <strong>计算公式：</strong>止损价 = 入场价 - (ATR × ATR倍数)，止盈价 = 入场价 + (止损距离 × 风险收益比)
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">
                        ATR周期
                        <span className="text-gray-500 ml-1">(1-100)</span>
                      </label>
                      <input
                        type="number"
                        value={formData.config.atrPeriod || 14}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            config: { ...formData.config, atrPeriod: parseInt(e.target.value) || 14 },
                          })
                        }
                        className="border rounded px-3 py-2 w-full"
                        min="1"
                        max="100"
                      />
                      <p className="text-xs text-gray-500 mt-1">推荐值：14-21</p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">
                        ATR倍数
                        <span className="text-gray-500 ml-1">(0.1-10)</span>
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={formData.config.atrMultiplier || 2.0}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            config: { ...formData.config, atrMultiplier: parseFloat(e.target.value) || 2.0 },
                          })
                        }
                        className="border rounded px-3 py-2 w-full"
                        min="0.1"
                        max="10"
                      />
                      <p className="text-xs text-gray-500 mt-1">推荐值：1.5-3.0</p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">
                        风险收益比
                        <span className="text-gray-500 ml-1">(0.1-10)</span>
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={formData.config.riskRewardRatio || 1.5}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            config: { ...formData.config, riskRewardRatio: parseFloat(e.target.value) || 1.5 },
                          })
                        }
                        className="border rounded px-3 py-2 w-full"
                        min="0.1"
                        max="10"
                      />
                      <p className="text-xs text-gray-500 mt-1">推荐值：1.5-3.0</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </form>
        </div>
        <div className="p-6 border-t bg-gray-50 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
          >
            取消
          </button>
          <button
            type="submit"
            form="edit-strategy-form"
            disabled={loading}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
