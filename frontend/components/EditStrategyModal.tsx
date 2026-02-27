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

type PresetMode = 'CONSERVATIVE' | 'STANDARD' | 'AGGRESSIVE' | 'CUSTOM';

const RISK_PRESETS: Record<Exclude<PresetMode, 'CUSTOM'>, {
  label: string;
  description: string;
  riskPreference: string;
  entryThresholdOverride: { directionalScoreMin: number; spreadScoreMin: number };
  zdteEntryThreshold: number;
  exitRules: { takeProfitPercent: number; stopLossPercent: number };
  consecutiveConfirmCycles: number;
  rsiFilter: { oversoldThreshold: number; overboughtThreshold: number };
  latePeriod: { cooldownMinutes: number };
}> = {
  CONSERVATIVE: {
    label: '保守',
    description: '更高的入场门槛，更紧的止损，适合震荡市',
    riskPreference: 'CONSERVATIVE',
    entryThresholdOverride: { directionalScoreMin: 20, spreadScoreMin: 20 },
    zdteEntryThreshold: 15,
    exitRules: { takeProfitPercent: 50, stopLossPercent: 25 },
    consecutiveConfirmCycles: 2,
    rsiFilter: { oversoldThreshold: 10, overboughtThreshold: 90 },
    latePeriod: { cooldownMinutes: 5 },
  },
  STANDARD: {
    label: '标准',
    description: '平衡的入场阈值和风控参数（推荐）',
    riskPreference: 'AGGRESSIVE',
    entryThresholdOverride: { directionalScoreMin: 12, spreadScoreMin: 12 },
    zdteEntryThreshold: 12,
    exitRules: { takeProfitPercent: 40, stopLossPercent: 30 },
    consecutiveConfirmCycles: 1,
    rsiFilter: { oversoldThreshold: 5, overboughtThreshold: 95 },
    latePeriod: { cooldownMinutes: 3 },
  },
  AGGRESSIVE: {
    label: '激进',
    description: '低入场门槛，宽止损，适合强趋势市',
    riskPreference: 'AGGRESSIVE',
    entryThresholdOverride: { directionalScoreMin: 8, spreadScoreMin: 8 },
    zdteEntryThreshold: 10,
    exitRules: { takeProfitPercent: 30, stopLossPercent: 40 },
    consecutiveConfirmCycles: 1,
    rsiFilter: { oversoldThreshold: 3, overboughtThreshold: 97 },
    latePeriod: { cooldownMinutes: 1 },
  },
};

function detectPresetMode(config: Record<string, unknown>): PresetMode {
  for (const [mode, preset] of Object.entries(RISK_PRESETS) as [Exclude<PresetMode, 'CUSTOM'>, typeof RISK_PRESETS[keyof typeof RISK_PRESETS]][]) {
    const entryOverride = config.entryThresholdOverride as Record<string, unknown> | undefined;
    const exitRules = config.exitRules as Record<string, unknown> | undefined;
    const rsiFilter = config.rsiFilter as Record<string, unknown> | undefined;
    const latePeriod = config.latePeriod as Record<string, unknown> | undefined;
    if (
      config.riskPreference === preset.riskPreference &&
      entryOverride?.directionalScoreMin === preset.entryThresholdOverride.directionalScoreMin &&
      entryOverride?.spreadScoreMin === preset.entryThresholdOverride.spreadScoreMin &&
      config.zdteEntryThreshold === preset.zdteEntryThreshold &&
      exitRules?.takeProfitPercent === preset.exitRules.takeProfitPercent &&
      exitRules?.stopLossPercent === preset.exitRules.stopLossPercent &&
      config.consecutiveConfirmCycles === preset.consecutiveConfirmCycles &&
      ((rsiFilter?.oversoldThreshold as number | undefined) ?? 5) === preset.rsiFilter.oversoldThreshold &&
      ((rsiFilter?.overboughtThreshold as number | undefined) ?? 95) === preset.rsiFilter.overboughtThreshold &&
      ((latePeriod?.cooldownMinutes as number | undefined) ?? 3) === preset.latePeriod.cooldownMinutes
    ) {
      return mode;
    }
  }
  return 'CUSTOM';
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
  const [optionRankList, setOptionRankList] = useState<Array<{ symbol: string; name: string; optionVolume: string; optionPosition: string; price: string; changeRate: string }>>([]);
  const [optionRankLoading, setOptionRankLoading] = useState(false);
  const [optionRankType, setOptionRankType] = useState<'total-volume' | 'total-turnover'>('total-volume');
  const [optionRankOpen, setOptionRankOpen] = useState(false);
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

  // --- Risk Preset & Number Input UX ---
  const [presetMode, setPresetMode] = useState<PresetMode>(() =>
    formData.type === 'OPTION_INTRADAY_V1' ? detectPresetMode(formData.config) : 'STANDARD'
  );
  const [localNumbers, setLocalNumbers] = useState<Record<string, string>>({});
  const [showEntryParams, setShowEntryParams] = useState(false);

  const getNestedValue = (obj: Record<string, unknown>, path: string[]): unknown => {
    let current: unknown = obj;
    for (const key of path) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  };

  const setNestedValue = (obj: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> => {
    if (path.length === 0) return obj;
    if (path.length === 1) {
      return { ...obj, [path[0]]: value };
    }
    const [head, ...rest] = path;
    return {
      ...obj,
      [head]: setNestedValue((obj[head] as Record<string, unknown>) || {}, rest, value),
    };
  };

  const numberInputProps = (key: string, opts: {
    path: string[];
    defaultValue: number;
    min?: number;
    max?: number;
    step?: number;
    isFloat?: boolean;
  }) => {
    const currentConfigValue = getNestedValue(formData.config, opts.path);
    const displayValue = localNumbers[key] !== undefined
      ? localNumbers[key]
      : (currentConfigValue !== undefined && currentConfigValue !== null ? String(currentConfigValue) : String(opts.defaultValue));

    return {
      type: 'number' as const,
      value: displayValue,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalNumbers({ ...localNumbers, [key]: e.target.value });
      },
      onBlur: () => {
        const raw = localNumbers[key];
        if (raw === undefined) return;
        const parsed = opts.isFloat ? parseFloat(raw) : parseInt(raw, 10);
        let final: number;
        if (isNaN(parsed)) {
          final = opts.defaultValue;
        } else {
          final = parsed;
          if (opts.min !== undefined) final = Math.max(opts.min, final);
          if (opts.max !== undefined) final = Math.min(opts.max, final);
        }
        const newConfig = setNestedValue(formData.config, opts.path, final);
        setFormData({ ...formData, config: newConfig });
        const newLocal = { ...localNumbers };
        delete newLocal[key];
        setLocalNumbers(newLocal);
      },
      min: opts.min,
      max: opts.max,
      step: opts.step,
      className: 'border rounded px-3 py-2 w-full',
    };
  };

  const handlePresetChange = (mode: PresetMode) => {
    setPresetMode(mode);
    if (mode === 'CUSTOM') return;
    const preset = RISK_PRESETS[mode];
    setFormData({
      ...formData,
      config: {
        ...formData.config,
        riskPreference: preset.riskPreference,
        entryThresholdOverride: preset.entryThresholdOverride,
        zdteEntryThreshold: preset.zdteEntryThreshold,
        exitRules: {
          ...(formData.config.exitRules || {}),
          takeProfitPercent: preset.exitRules.takeProfitPercent,
          stopLossPercent: preset.exitRules.stopLossPercent,
        },
        consecutiveConfirmCycles: preset.consecutiveConfirmCycles,
        rsiFilter: {
          ...(formData.config.rsiFilter || {}),
          oversoldThreshold: preset.rsiFilter.oversoldThreshold,
          overboughtThreshold: preset.rsiFilter.overboughtThreshold,
        },
        latePeriod: {
          ...(formData.config.latePeriod || {}),
          cooldownMinutes: preset.latePeriod.cooldownMinutes,
        },
      },
    });
    setLocalNumbers({});
  };

  // Auto-detect CUSTOM when config changes away from current preset
  useEffect(() => {
    if (formData.type !== 'OPTION_INTRADAY_V1') return;
    if (presetMode === 'CUSTOM') return;
    const detected = detectPresetMode(formData.config);
    if (detected !== presetMode) {
      setPresetMode('CUSTOM');
    }
  }, [formData.config]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleLoadOptionRank = async (rankType: 'total-volume' | 'total-turnover') => {
    setOptionRankLoading(true);
    setOptionRankType(rankType);
    try {
      const res = await quantApi.getOptionRank({ rankType, count: 20 });
      if (res.success && res.data) {
        setOptionRankList(res.data);
        setOptionRankOpen(true);
      }
    } catch {
      // silently fail, user can retry
    } finally {
      setOptionRankLoading(false);
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 md:p-0">
      <div className="bg-white rounded-lg max-w-2xl w-full mx-2 md:mx-0 max-h-[90vh] flex flex-col">
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

                  {/* 期权热门股快速添加 */}
                  <div className="mb-2">
                    <div className="flex items-center gap-2 mb-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (optionRankOpen) {
                            setOptionRankOpen(false);
                          } else {
                            handleLoadOptionRank(optionRankType);
                          }
                        }}
                        disabled={optionRankLoading}
                        className="text-xs px-2 py-1 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded disabled:opacity-50"
                      >
                        {optionRankLoading ? '加载中...' : optionRankOpen ? '收起期权热门股' : '加载期权热门股'}
                      </button>
                      {optionRankOpen && (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => handleLoadOptionRank('total-volume')}
                            className={`text-xs px-2 py-0.5 rounded ${optionRankType === 'total-volume' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                          >
                            总成交量
                          </button>
                          <button
                            type="button"
                            onClick={() => handleLoadOptionRank('total-turnover')}
                            className={`text-xs px-2 py-0.5 rounded ${optionRankType === 'total-turnover' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                          >
                            成交额
                          </button>
                        </div>
                      )}
                    </div>
                    {optionRankOpen && optionRankList.length > 0 && (
                      <div className="border rounded max-h-[200px] overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-2 py-1">#</th>
                              <th className="text-left px-2 py-1">代码</th>
                              <th className="text-left px-2 py-1">名称</th>
                              <th className="text-right px-2 py-1">价格</th>
                              <th className="text-right px-2 py-1">期权成交量</th>
                              <th className="text-center px-2 py-1">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {optionRankList.map((item, idx) => {
                              const alreadyAdded = formData.symbolPoolConfig.symbols.includes(item.symbol);
                              return (
                                <tr key={item.symbol} className="border-t hover:bg-gray-50">
                                  <td className="px-2 py-1 text-gray-400">{idx + 1}</td>
                                  <td className="px-2 py-1 font-mono font-medium">{item.symbol}</td>
                                  <td className="px-2 py-1 text-gray-600 truncate max-w-[120px]">{item.name}</td>
                                  <td className="px-2 py-1 text-right text-gray-600">{item.price}</td>
                                  <td className="px-2 py-1 text-right text-gray-600">{item.optionVolume}</td>
                                  <td className="px-2 py-1 text-center">
                                    {alreadyAdded ? (
                                      <span className="text-gray-400">已添加</span>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => handleAddFromWatchlist(item.symbol)}
                                        className="text-purple-600 hover:text-purple-800 font-medium"
                                      >
                                        + 添加
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

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
                  {formData.type === 'OPTION_INTRADAY_V1' ? '' : '（用于计算止损止盈价格）'}
                </span>
              </label>
              {formData.type === 'OPTION_INTRADAY_V1' ? (
                <>
                  {/* 策略类型选择（多选） */}
                  <div className="mb-4 p-4 border rounded bg-gray-50">
                    <label className="block text-xs text-gray-700 mb-2 font-semibold">策略类型（可多选）</label>
                    <div className="space-y-2">
                      <div className="text-xs text-gray-500 mb-2">买方策略：</div>
                      <div className="flex flex-wrap gap-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.config.strategyTypes?.buyer?.includes('DIRECTIONAL_CALL') ?? true}
                            onChange={(e) => {
                              const buyer = formData.config.strategyTypes?.buyer || ['DIRECTIONAL_CALL', 'DIRECTIONAL_PUT', 'STRADDLE_BUY'];
                              const newBuyer = e.target.checked
                                ? [...buyer, 'DIRECTIONAL_CALL']
                                : buyer.filter((t: string) => t !== 'DIRECTIONAL_CALL');
                              setFormData({
                                ...formData,
                                config: {
                                  ...formData.config,
                                  strategyTypes: { ...formData.config.strategyTypes, buyer: newBuyer },
                                },
                              });
                            }}
                          />
                          <span className="text-sm">单边买Call</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.config.strategyTypes?.buyer?.includes('DIRECTIONAL_PUT') ?? true}
                            onChange={(e) => {
                              const buyer = formData.config.strategyTypes?.buyer || ['DIRECTIONAL_CALL', 'DIRECTIONAL_PUT', 'STRADDLE_BUY'];
                              const newBuyer = e.target.checked
                                ? [...buyer, 'DIRECTIONAL_PUT']
                                : buyer.filter((t: string) => t !== 'DIRECTIONAL_PUT');
                              setFormData({
                                ...formData,
                                config: {
                                  ...formData.config,
                                  strategyTypes: { ...formData.config.strategyTypes, buyer: newBuyer },
                                },
                              });
                            }}
                          />
                          <span className="text-sm">单边买Put</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.config.strategyTypes?.buyer?.includes('STRADDLE_BUY') ?? true}
                            onChange={(e) => {
                              const buyer = formData.config.strategyTypes?.buyer || ['DIRECTIONAL_CALL', 'DIRECTIONAL_PUT', 'STRADDLE_BUY'];
                              const newBuyer = e.target.checked
                                ? [...buyer, 'STRADDLE_BUY']
                                : buyer.filter((t: string) => t !== 'STRADDLE_BUY');
                              setFormData({
                                ...formData,
                                config: {
                                  ...formData.config,
                                  strategyTypes: { ...formData.config.strategyTypes, buyer: newBuyer },
                                },
                              });
                            }}
                          />
                          <span className="text-sm">跨式买入</span>
                        </label>
                      </div>
                      <div className="text-xs text-gray-500 mt-3 mb-2">价差策略：</div>
                      <div className="flex flex-wrap gap-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.config.strategyTypes?.directional?.includes('BULL_SPREAD') ?? false}
                            onChange={(e) => {
                              const directional = formData.config.strategyTypes?.directional || [];
                              const newDirectional = e.target.checked
                                ? [...directional, 'BULL_SPREAD']
                                : directional.filter((t: string) => t !== 'BULL_SPREAD');
                              setFormData({
                                ...formData,
                                config: {
                                  ...formData.config,
                                  strategyTypes: { ...formData.config.strategyTypes, directional: newDirectional },
                                },
                              });
                            }}
                          />
                          <span className="text-sm">牛市价差</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.config.strategyTypes?.directional?.includes('BEAR_SPREAD') ?? false}
                            onChange={(e) => {
                              const directional = formData.config.strategyTypes?.directional || [];
                              const newDirectional = e.target.checked
                                ? [...directional, 'BEAR_SPREAD']
                                : directional.filter((t: string) => t !== 'BEAR_SPREAD');
                              setFormData({
                                ...formData,
                                config: {
                                  ...formData.config,
                                  strategyTypes: { ...formData.config.strategyTypes, directional: newDirectional },
                                },
                              });
                            }}
                          />
                          <span className="text-sm">熊市价差</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Section 2: 风险模式 */}
                  <div className="mb-4 p-4 border rounded bg-gray-50">
                    <label className="block text-xs text-gray-700 mb-3 font-semibold">风险模式</label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {(['CONSERVATIVE', 'STANDARD', 'AGGRESSIVE', 'CUSTOM'] as PresetMode[]).map((mode) => {
                        const isCustom = mode === 'CUSTOM';
                        const preset = isCustom ? null : RISK_PRESETS[mode];
                        const label = isCustom ? '自定义' : preset!.label;
                        const desc = isCustom ? '手动调整所有参数' : preset!.description;
                        return (
                          <label
                            key={mode}
                            className={`relative flex flex-col p-3 border-2 rounded-lg cursor-pointer transition-all ${
                              presetMode === mode
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <input
                              type="radio"
                              name="presetMode"
                              value={mode}
                              checked={presetMode === mode}
                              onChange={() => handlePresetChange(mode)}
                              className="sr-only"
                            />
                            <span className="text-sm font-medium">
                              {label}
                              {mode === 'STANDARD' && <span className="text-xs text-blue-600 ml-1">(推荐)</span>}
                            </span>
                            <span className="text-xs text-gray-500 mt-1">{desc}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Section 3: 入场参数 */}
                  <div className="mb-4 p-4 border rounded bg-gray-50">
                    <div
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => setShowEntryParams(!showEntryParams)}
                    >
                      <label className="text-xs text-gray-700 font-semibold">入场参数</label>
                      <div className="flex items-center gap-2">
                        {presetMode !== 'CUSTOM' && !showEntryParams && (
                          <span className="text-xs text-gray-500">
                            阈值={formData.config.entryThresholdOverride?.directionalScoreMin ?? 12},
                            0DTE={formData.config.zdteEntryThreshold ?? 12},
                            确认={formData.config.consecutiveConfirmCycles ?? 1}次
                          </span>
                        )}
                        <svg
                          className={`w-4 h-4 text-gray-500 transition-transform ${showEntryParams ? 'rotate-180' : ''}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                    {(showEntryParams || presetMode === 'CUSTOM') && (
                      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">入场得分阈值</label>
                          <input {...numberInputProps('entryDirectionalScoreMin', { path: ['entryThresholdOverride', 'directionalScoreMin'], defaultValue: 12, min: 5, max: 50 })} />
                          <p className="text-xs text-gray-500 mt-1">信号绝对值需达到此阈值才入场</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">0DTE入场阈值</label>
                          <input {...numberInputProps('zdteEntryThreshold', { path: ['zdteEntryThreshold'], defaultValue: 12, min: 5, max: 30 })} />
                          <p className="text-xs text-gray-500 mt-1">0DTE比普通入场更严格的得分阈值</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">价格确认次数</label>
                          <input {...numberInputProps('consecutiveConfirmCycles', { path: ['consecutiveConfirmCycles'], defaultValue: 1, min: 1, max: 5 })} />
                          <p className="text-xs text-gray-500 mt-1">设为1跳过价格确认，2+启用确认等待</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">RSI超卖阈值</label>
                          <input {...numberInputProps('rsiOversold', { path: ['rsiFilter', 'oversoldThreshold'], defaultValue: 5, min: 1, max: 50 })} />
                          <p className="text-xs text-gray-500 mt-1">RSI低于此值时拒绝做空</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">RSI超买阈值</label>
                          <input {...numberInputProps('rsiOverbought', { path: ['rsiFilter', 'overboughtThreshold'], defaultValue: 95, min: 50, max: 99 })} />
                          <p className="text-xs text-gray-500 mt-1">RSI高于此值时拒绝做多</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">方向确认窗口（分钟）</label>
                          <input {...numberInputProps('directionConfirmMinutes', { path: ['tradeWindow', 'directionConfirmMinutes'], defaultValue: 30, min: 0, max: 120 })} />
                          <p className="text-xs text-gray-500 mt-1">开盘后N分钟仅允许顺势交易</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Section 4: 退出参数 */}
                  <div className="mb-4 p-4 border rounded bg-gray-50">
                    <label className="block text-xs text-gray-700 mb-3 font-semibold">退出参数</label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs text-gray-700 mb-1 font-medium">止盈 %</label>
                        <input {...numberInputProps('takeProfitPercent', { path: ['exitRules', 'takeProfitPercent'], defaultValue: 40, min: 10, max: 200 })} />
                        <p className="text-xs text-gray-500 mt-1">EARLY基准值，随时段自动递减</p>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-700 mb-1 font-medium">止损 %</label>
                        <input {...numberInputProps('stopLossPercent', { path: ['exitRules', 'stopLossPercent'], defaultValue: 30, min: 10, max: 100 })} />
                        <p className="text-xs text-gray-500 mt-1">EARLY基准值，随时段自动递减</p>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-700 mb-1 font-medium">平仓冷却期（分钟）</label>
                        <input {...numberInputProps('cooldownMinutes', { path: ['latePeriod', 'cooldownMinutes'], defaultValue: 3, min: 0, max: 30 })} />
                        <p className="text-xs text-gray-500 mt-1">非0DTE固定冷却；0DTE按交易次数动态调整</p>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-700 mb-1 font-medium">尾盘阈值提升比例</label>
                        <input {...numberInputProps('minProfitThreshold', { path: ['latePeriod', 'minProfitThreshold'], defaultValue: 0.10, min: 0, max: 1, step: 0.05, isFloat: true })} />
                        <p className="text-xs text-gray-500 mt-1">LATE时段入场门槛提升比例（0.10=10%）</p>
                      </div>
                    </div>
                    <div className="mt-3 p-3 bg-gray-100 border border-gray-200 rounded text-xs text-gray-600">
                      <p><strong>动态缩放：</strong>上方数值为EARLY阶段基准，MID约80%，LATE约60%，FINAL约40%。</p>
                      <p className="mt-1"><strong>强平规则：</strong>0DTE 收盘前120分钟（约2:00 PM ET）强制平仓；非0DTE 收盘前10分钟强制平仓。</p>
                    </div>
                  </div>

                  {/* Section 5: 交易窗口 */}
                  <div className="mb-4 p-4 border rounded bg-yellow-50 border-yellow-200">
                    <label className="block text-xs text-gray-700 mb-3 font-semibold">交易窗口</label>
                    <div className="mb-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.config.tradeWindow?.firstHourOnly ?? true}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              config: {
                                ...formData.config,
                                tradeWindow: {
                                  ...(formData.config.tradeWindow || {}),
                                  firstHourOnly: e.target.checked,
                                },
                              },
                            })
                          }
                        />
                        <span className="text-sm">只在开盘第一小时交易（9:30-10:30 ET）</span>
                      </label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-gray-700 mb-1 font-medium">开盘禁入时长（分钟）</label>
                        <input {...numberInputProps('zdteCooldownMinutes', { path: ['tradeWindow', 'zdteCooldownMinutes'], defaultValue: 0, min: 0, max: 60 })} />
                        <p className="text-xs text-gray-500 mt-1">开盘后N分钟内禁止0DTE，极端信号可豁免</p>
                      </div>
                      <div className={formData.config.tradeWindow?.firstHourOnly ? 'opacity-50' : ''}>
                        <label className="block text-xs text-gray-700 mb-1 font-medium">禁止开仓窗口（分钟）</label>
                        <input
                          {...numberInputProps('noNewEntryBeforeCloseMinutes', { path: ['tradeWindow', 'noNewEntryBeforeCloseMinutes'], defaultValue: 120, min: 0, max: 240 })}
                          disabled={formData.config.tradeWindow?.firstHourOnly ?? true}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          收盘前N分钟禁止新开仓
                          {(formData.config.tradeWindow?.firstHourOnly ?? true) && (
                            <span className="text-orange-600 block mt-0.5">已开启「第一小时限制」，此选项不生效</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 p-2 bg-yellow-100 rounded text-xs text-yellow-800">
                      <strong>强平规则（不可配置）：</strong>0DTE 收盘前120分钟强平 | 非0DTE 收盘前10分钟强平 | 绝对止损 -40%
                    </div>
                  </div>

                  {/* Section 6: 开仓设置 */}
                  <div className="mb-4 p-4 border rounded bg-gray-50">
                    <label className="block text-xs text-gray-700 mb-3 font-semibold">开仓设置</label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                      {formData.config.positionSizing?.mode === 'MAX_PREMIUM' ? (
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">最大权利金（USD）</label>
                          <input {...numberInputProps('maxPremiumUsd', { path: ['positionSizing', 'maxPremiumUsd'], defaultValue: 300, min: 0, max: 10000, isFloat: true })} />
                        </div>
                      ) : (
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">固定张数</label>
                          <input {...numberInputProps('fixedContracts', { path: ['positionSizing', 'fixedContracts'], defaultValue: 1, min: 1, max: 20 })} />
                        </div>
                      )}
                    </div>
                    <div className="mt-3 bg-blue-50 border border-blue-200 rounded p-3">
                      <p className="text-xs text-blue-800">
                        <strong>费用模型（默认）：</strong> 佣金 0.10 USD/张（每单最低0.99） + 平台费 0.30 USD/张
                      </p>
                    </div>
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
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
