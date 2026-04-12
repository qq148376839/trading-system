'use client';

import { useState, useEffect, useRef } from 'react';
import { quantApi, watchlistApi } from '@/lib/api';
import { message } from 'antd';
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

interface StrategyFormModalProps {
  strategy?: Strategy;  // undefined = create mode
  onClose: () => void;
  onSuccess: () => void;
}

type PresetMode = 'CONSERVATIVE' | 'STANDARD' | 'AGGRESSIVE' | 'CUSTOM';

const RISK_PRESETS: Record<Exclude<PresetMode, 'CUSTOM'>, {
  label: string;
  description: string;
  riskPreference: string;
  entryThresholdOverride: { directionalScoreMin: number; spreadScoreMin: number };
  exitRules: { takeProfitPercent: number; stopLossPercent: number };
}> = {
  CONSERVATIVE: {
    label: '保守',
    description: '较高入场门槛，紧止损，适合震荡市',
    riskPreference: 'CONSERVATIVE',
    entryThresholdOverride: { directionalScoreMin: 12, spreadScoreMin: 12 },
    exitRules: { takeProfitPercent: 50, stopLossPercent: 25 },
  },
  STANDARD: {
    label: '标准',
    description: '平衡的入场和风控参数（推荐）',
    riskPreference: 'AGGRESSIVE',
    entryThresholdOverride: { directionalScoreMin: 8, spreadScoreMin: 8 },
    exitRules: { takeProfitPercent: 40, stopLossPercent: 30 },
  },
  AGGRESSIVE: {
    label: '激进',
    description: '低入场门槛，宽止损，适合强趋势市',
    riskPreference: 'AGGRESSIVE',
    entryThresholdOverride: { directionalScoreMin: 5, spreadScoreMin: 5 },
    exitRules: { takeProfitPercent: 40, stopLossPercent: 35 },
  },
};

const DEFAULT_CONFIGS: Record<string, any> = {
  RECOMMENDATION_V1: { atrPeriod: 14, atrMultiplier: 2.0, riskRewardRatio: 1.5 },
  OPTION_INTRADAY_V1: {
    assetClass: 'OPTION',
    expirationMode: '0DTE',
    directionMode: 'FOLLOW_SIGNAL',
    entryPriceMode: 'ASK',
    positionSizing: { mode: 'FIXED_CONTRACTS', fixedContracts: 1 },
    liquidityFilters: { minOpenInterest: 500, maxBidAskSpreadAbs: 0.3, maxBidAskSpreadPct: 25 },
    greekFilters: { deltaMin: 0.25, deltaMax: 0.6 },
    tradeWindow: { noNewEntryBeforeCloseMinutes: 60, forceCloseBeforeCloseMinutes: 30 },
    feeModel: { commissionPerContract: 0.1, minCommissionPerOrder: 0.99, platformFeePerContract: 0.3 },
    // STANDARD preset defaults
    riskPreference: 'AGGRESSIVE',
    entryThresholdOverride: { directionalScoreMin: 8, spreadScoreMin: 8 },
    exitRules: { takeProfitPercent: 40, stopLossPercent: 30 },
    accelerationBonus: { enabled: true, accelRatioThreshold: 1.15, bonusMultiplier: 5.0, bonusCap: 8.0 },
  },
  OPTION_SCHWARTZ_V1: {
    assetClass: 'OPTION',
    expirationMode: '0DTE',
    directionMode: 'FOLLOW_SIGNAL',
    entryPriceMode: 'ASK',
    positionSizing: { mode: 'FIXED_CONTRACTS', fixedContracts: 1 },
    liquidityFilters: { minOpenInterest: 500, maxBidAskSpreadAbs: 0.3, maxBidAskSpreadPct: 25 },
    greekFilters: { deltaMin: 0.25, deltaMax: 0.6 },
    tradeWindow: { noNewEntryBeforeCloseMinutes: 120, forceCloseBeforeCloseMinutes: 30 },
    feeModel: { commissionPerContract: 0.1, minCommissionPerOrder: 0.99, platformFeePerContract: 0.3 },
    // STANDARD preset defaults
    riskPreference: 'AGGRESSIVE',
    entryThresholdOverride: { directionalScoreMin: 8, spreadScoreMin: 8 },
    exitRules: { takeProfitPercent: 40, stopLossPercent: 30 },
    schwartz: {
      emaPeriod: 10,
      chopThreshold: 0.5,
      emaWrapThreshold: 0.3,
      ivRankRejectThreshold: 60,
      ivFallbackRejectIV: 0.8,
      positionShrinkAfterBigWin: true,
      bigWinThreshold: 30,
    },
    accelerationBonus: { enabled: true, accelRatioThreshold: 1.15, bonusMultiplier: 5.0, bonusCap: 8.0 },
  },
  TREND_FOLLOWING_V1: {
    maFastPeriod: 50,
    maSlowPeriod: 200,
    weekHigh52Threshold: 85,
    rsLookbackDays: 20,
    volumeConfirmMultiple: 1.5,
    atrPeriod: 14,
    atrTrailingMultiple: 2.0,
    atrTightenMultiple: 1.0,
    maxConcurrentPositions: 5,
    maxConcentration: 0.15,
    leveragedEtfMaxConcentration: 0.10,
    leveragedEtfMaxDays: 5,
    dailyLossLimitPct: 2,
    entryScoreThreshold: 65,
    absoluteScoreFloor: 45,
    maxGapUpPct: 2,
    chopThreshold: 0.5,
  },
};

function detectPresetMode(config: Record<string, unknown>): PresetMode {
  for (const [mode, preset] of Object.entries(RISK_PRESETS) as [Exclude<PresetMode, 'CUSTOM'>, typeof RISK_PRESETS[keyof typeof RISK_PRESETS]][]) {
    const entryOverride = config.entryThresholdOverride as Record<string, unknown> | undefined;
    const exitRules = config.exitRules as Record<string, unknown> | undefined;
    if (
      entryOverride?.directionalScoreMin === preset.entryThresholdOverride.directionalScoreMin &&
      entryOverride?.spreadScoreMin === preset.entryThresholdOverride.spreadScoreMin &&
      exitRules?.takeProfitPercent === preset.exitRules.takeProfitPercent &&
      exitRules?.stopLossPercent === preset.exitRules.stopLossPercent
    ) {
      return mode as Exclude<PresetMode, 'CUSTOM'>;
    }
  }
  return 'CUSTOM';
}

export default function StrategyFormModal({
  strategy,
  onClose,
  onSuccess,
}: StrategyFormModalProps) {
  const isEditMode = !!strategy;

  const [formData, setFormData] = useState(() => {
    if (strategy) {
      return {
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
      };
    }
    return {
      name: '',
      type: 'RECOMMENDATION_V1',
      capitalAllocationId: null as number | null,
      symbolPoolConfig: { mode: 'STATIC', symbols: [] as string[] },
      config: DEFAULT_CONFIGS.RECOMMENDATION_V1,
    };
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
    strategy?.symbolPoolConfig?.mode === 'INSTITUTION' ? 'INSTITUTION' : 'STATIC'
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
  const originalSymbolsRef = useRef<string[]>(
    strategy
      ? [...(Array.isArray(strategy.symbolPoolConfig?.symbols) ? strategy.symbolPoolConfig.symbols : [])].sort()
      : []
  );

  useEffect(() => {
    const promises: Promise<any>[] = [
      quantApi.getCapitalAllocations(),
      watchlistApi.getWatchlist(true),
      quantApi.getCapitalUsage(),
    ];
    if (strategy) {
      promises.push(quantApi.getStrategyHoldings(strategy.id));
    }
    Promise.all(promises).then((results) => {
      const [allocRes, watchRes, usageRes] = results;
      const holdingsRes = strategy ? results[3] : null;
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
                actualAllocated: (usageRes.data.totalCapital || 0) * alloc.allocationValue,
              };
            }
            return alloc;
          });
          setAllocations(updatedAllocations);
        }
      }
      if (holdingsRes?.success) {
        setExistingHoldings(holdingsRes.data || []);
      }
    });
  }, [strategy?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const [presetMode, setPresetMode] = useState<PresetMode>(() => {
    if (!strategy) return 'STANDARD';
    return (strategy.type === 'OPTION_INTRADAY_V1' || strategy.type === 'OPTION_SCHWARTZ_V1')
      ? detectPresetMode(strategy.config)
      : 'STANDARD';
  });
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
        exitRules: {
          ...(formData.config.exitRules || {}),
          takeProfitPercent: preset.exitRules.takeProfitPercent,
          stopLossPercent: preset.exitRules.stopLossPercent,
        },
      },
    });
    setLocalNumbers({});
  };

  // Auto-detect CUSTOM when config changes away from current preset
  useEffect(() => {
    if (formData.type !== 'OPTION_INTRADAY_V1' && formData.type !== 'OPTION_SCHWARTZ_V1') return;
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
      message.warning('请至少添加一个股票到股票池');
      return;
    }
    setLoading(true);
    try {
      if (isEditMode && strategy) {
        // --- EDIT MODE ---
        await quantApi.updateStrategy(strategy.id, formData);
        message.success('策略已更新');
        onSuccess();

        // 期权类型 + 标的变动 -> fire-and-forget 重算相关性分组
        if (
          formData.type === 'OPTION_INTRADAY_V1' ||
          formData.type === 'OPTION_SCHWARTZ_V1'
        ) {
          const newSymbols = [...formData.symbolPoolConfig.symbols].sort();
          const oldSymbols = originalSymbolsRef.current;
          const symbolsChanged =
            newSymbols.length !== oldSymbols.length ||
            newSymbols.some((s, i) => s !== oldSymbols[i]);

          if (symbolsChanged) {
            const cg = strategy.config?.correlationGroups;
            if (cg?.manualOverride) {
              message.info('当前分组为手动设置，跳过自动重算');
            } else {
              const threshold = cg?.threshold ?? 0.75;
              const days = cg?.days ?? 120;
              message.info('标的变动，正在后台重算相关性分组...');
              quantApi.computeCorrelationGroups(strategy.id, { threshold, days })
                .then((r) => {
                  if (r.success) {
                    message.success('相关性分组重算完成');
                  }
                })
                .catch(() => {
                  // 非阻塞，静默失败
                });
            }
          }
        }
      } else {
        // --- CREATE MODE ---
        const res = await quantApi.createStrategy(formData);
        message.success('策略创建成功');
        onSuccess();

        // 期权类型策略：fire-and-forget 计算相关性分组
        const createdId = res?.data?.id;
        if (
          createdId &&
          (formData.type === 'OPTION_INTRADAY_V1' || formData.type === 'OPTION_SCHWARTZ_V1')
        ) {
          message.info('正在后台计算相关性分组...');
          quantApi.computeCorrelationGroups(createdId, { threshold: 0.75, days: 120 })
            .then((r) => {
              if (r.success) {
                message.success('相关性分组计算完成');
              }
            })
            .catch(() => {
              // 非阻塞，静默失败
            });
        }
      }
    } catch (err: any) {
      message.error(err.message || (isEditMode ? '更新策略失败' : '创建策略失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 md:p-0">
      <div className="bg-white rounded-lg max-w-2xl w-full mx-2 md:mx-0 max-h-[90vh] flex flex-col">
        <div className="p-6 border-b">
          <h2 className="text-2xl font-bold">{isEditMode ? '编辑策略' : '创建策略'}</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <form onSubmit={handleSubmit} id="strategy-form">
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

            {/* 策略类型选择 - 仅创建模式 */}
            {!isEditMode && (
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">策略类型</label>
                <select
                  value={formData.type}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    setStockPoolMode('STATIC');
                    setPresetMode('STANDARD');
                    setLocalNumbers({});
                    setFormData({
                      ...formData,
                      type: nextType,
                      symbolPoolConfig: { mode: 'STATIC', symbols: [] },
                      config: DEFAULT_CONFIGS[nextType] || {},
                    });
                  }}
                  className="border rounded px-3 py-2 w-full"
                >
                  <option value="RECOMMENDATION_V1">推荐策略 V1（股票）</option>
                  <option value="OPTION_INTRADAY_V1">期权日内策略 V1（买方）</option>
                  <option value="OPTION_SCHWARTZ_V1">期权-舒华兹趋势 V1</option>
                  <option value="TREND_FOLLOWING_V1">正股趋势跟踪 V1</option>
                </select>
              </div>
            )}

            {/* 策略类型说明卡片 */}
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
                    </>
                  ) : formData.type === 'OPTION_SCHWARTZ_V1' ? (
                    <>
                      <h3 className="text-sm font-semibold text-gray-900 mb-1">期权-舒华兹趋势 V1</h3>
                      <p className="text-xs text-gray-600 leading-relaxed mb-2">
                        基于马丁·舒华兹 Pit Bull 交易哲学的期权策略。使用 10 日 EMA 硬过滤（逆趋势无例外拒绝）
                        + IV Rank 过滤（高IV拒绝买方）+ 震荡区间检测（MA缠绕时提高门槛2x）+ 大赚后仓位缩减。
                        入场门槛更高，适合趋势明确的市场。
                      </p>
                    </>
                  ) : formData.type === 'TREND_FOLLOWING_V1' ? (
                    <>
                      <h3 className="text-sm font-semibold text-gray-900 mb-1">正股趋势跟踪 V1</h3>
                      <p className="text-xs text-gray-600 leading-relaxed mb-2">
                        Robin 交易直觉系统化：MA50/MA200 双均线 + 52 周高点 + 相对强度排名 + ATR 追踪止损。
                        环境信号复用期权策略已验证的 VIX/BTC/USD/市场温度。评分百分制，动态阈值随 VIX 调整。
                      </p>
                    </>
                  ) : (
                    <>
                      <h3 className="text-sm font-semibold text-gray-900 mb-1">推荐策略 V1</h3>
                      <p className="text-xs text-gray-600 leading-relaxed mb-2">
                        基于市场趋势和ATR（平均真实波幅）的智能推荐策略。系统会分析SPX、USD指数、BTC等市场指标，
                        结合ATR计算止损止盈价格，智能生成买卖信号。适合趋势跟踪和风险控制的量化交易场景。
                      </p>
                    </>
                  )}
                  {isEditMode && (
                    <p className="text-xs text-gray-500 italic">
                      策略类型创建后不可修改。如需使用其他策略类型，请创建新策略。
                    </p>
                  )}
                </div>
              </div>
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
                      onChange={() => {
                        setStockPoolMode('STATIC');
                        setFormData({
                          ...formData,
                          symbolPoolConfig: {
                            mode: 'STATIC',
                            symbols: isEditMode ? formData.symbolPoolConfig.symbols : [],
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
                      onChange={() => {
                        setStockPoolMode('INSTITUTION');
                        setFormData({
                          ...formData,
                          symbolPoolConfig: {
                            mode: 'INSTITUTION',
                            symbols: isEditMode ? formData.symbolPoolConfig.symbols : [],
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
                            <strong>提示：</strong>当前可用资金不足（已有持仓占用了资金），但您仍可以修改股票池配置。
                            如需买入新股票，请先平仓部分持仓或增加资金分配。
                          </div>
                        </div>
                      )}
                      {availableCapital <= 0 && existingHoldings.length === 0 && (
                        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                          <div className="text-sm text-yellow-800">
                            <strong>提示：</strong>当前可用资金不足，但您仍可以修改股票池配置。
                            如需买入新股票，请先增加资金分配或选择其他账户。
                          </div>
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
                        placeholder={
                          (formData.type === 'OPTION_INTRADAY_V1' || formData.type === 'OPTION_SCHWARTZ_V1')
                            ? '输入标的代码（正股/指数），例如：QQQ.US 或 .SPX.US'
                            : '输入股票代码，例如：AAPL.US'
                        }
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
                              x
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
              <label className="block text-sm font-medium mb-2">
                {(formData.type === 'OPTION_INTRADAY_V1' || formData.type === 'OPTION_SCHWARTZ_V1') ? '期权策略参数'
                  : formData.type === 'TREND_FOLLOWING_V1' ? '趋势跟踪参数' : '策略参数配置'}
                <span className="text-xs text-gray-500 ml-2">
                  {(formData.type === 'OPTION_INTRADAY_V1' || formData.type === 'OPTION_SCHWARTZ_V1') ? ''
                    : formData.type === 'TREND_FOLLOWING_V1' ? '（均线/ATR/入场条件）' : '（用于计算止损止盈价格）'}
                </span>
              </label>
              {(formData.type === 'OPTION_INTRADAY_V1' || formData.type === 'OPTION_SCHWARTZ_V1') ? (
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
                              const directional = (formData.config.strategyTypes?.directional || []).filter(
                                (t: string) => t !== 'REVERSE_BULL_SPREAD' && t !== 'REVERSE_BEAR_SPREAD'
                              );
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
                              const directional = (formData.config.strategyTypes?.directional || []).filter(
                                (t: string) => t !== 'REVERSE_BULL_SPREAD' && t !== 'REVERSE_BEAR_SPREAD'
                              );
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

                  {/* 智能反向配置（替代 REVERSE_BEAR/BULL_SPREAD） */}
                  <div className="mb-4 p-4 border rounded bg-amber-50 border-amber-200">
                    <label className="flex items-center gap-2 mb-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.config.smartReverse?.enabled ?? false}
                        onChange={(e) => {
                          const prev = formData.config.smartReverse || {};
                          setFormData({
                            ...formData,
                            config: {
                              ...formData.config,
                              smartReverse: {
                                enabled: e.target.checked,
                                thresholds: {
                                  marketScoreExtreme: 35,
                                  intradayScoreExtremeNeg: 14,
                                  intradayScoreExtremePos: 15,
                                  divergenceMin: 0.3,
                                  maxIntradayScoreForEntry: 0,
                                  ...prev.thresholds,
                                },
                                positionMultiplier: {
                                  reversed: 1.0,
                                  uncertain: 0.5,
                                  ...prev.positionMultiplier,
                                },
                              },
                            },
                          });
                        }}
                      />
                      <span className="text-sm font-semibold text-amber-800">
                        智能反向 (Smart Regime Reversal)
                      </span>
                    </label>
                    <p className="text-xs text-amber-600 mb-3">
                      基于分数极端度和分量分歧度自动判别市场状态，在均值回归概率高时翻转交易方向。替代原有的反向价差策略。
                    </p>

                    {formData.config.smartReverse?.enabled && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-600">大盘极端阈值 (|marketScore|)</label>
                          <input
                            type="number"
                            value={formData.config.smartReverse?.thresholds?.marketScoreExtreme ?? 35}
                            className="w-full border rounded px-2 py-1 text-sm"
                            min={20}
                            max={60}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setFormData({
                                ...formData,
                                config: {
                                  ...formData.config,
                                  smartReverse: {
                                    ...formData.config.smartReverse,
                                    thresholds: {
                                      ...formData.config.smartReverse.thresholds,
                                      marketScoreExtreme: val,
                                    },
                                  },
                                },
                              });
                            }}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-600">分歧度阈值</label>
                          <input
                            type="number"
                            step={0.05}
                            value={formData.config.smartReverse?.thresholds?.divergenceMin ?? 0.3}
                            className="w-full border rounded px-2 py-1 text-sm"
                            min={0.1}
                            max={1.0}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setFormData({
                                ...formData,
                                config: {
                                  ...formData.config,
                                  smartReverse: {
                                    ...formData.config.smartReverse,
                                    thresholds: {
                                      ...formData.config.smartReverse.thresholds,
                                      divergenceMin: val,
                                    },
                                  },
                                },
                              });
                            }}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-600">日内极端阈值 (neg / pos)</label>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              value={formData.config.smartReverse?.thresholds?.intradayScoreExtremeNeg ?? 14}
                              className="w-full border rounded px-2 py-1 text-sm"
                              min={5}
                              max={40}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setFormData({
                                  ...formData,
                                  config: {
                                    ...formData.config,
                                    smartReverse: {
                                      ...formData.config.smartReverse,
                                      thresholds: {
                                        ...formData.config.smartReverse.thresholds,
                                        intradayScoreExtremeNeg: val,
                                      },
                                    },
                                  },
                                });
                              }}
                            />
                            <input
                              type="number"
                              value={formData.config.smartReverse?.thresholds?.intradayScoreExtremePos ?? 15}
                              className="w-full border rounded px-2 py-1 text-sm"
                              min={5}
                              max={40}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setFormData({
                                  ...formData,
                                  config: {
                                    ...formData.config,
                                    smartReverse: {
                                      ...formData.config.smartReverse,
                                      thresholds: {
                                        ...formData.config.smartReverse.thresholds,
                                        intradayScoreExtremePos: val,
                                      },
                                    },
                                  },
                                });
                              }}
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-gray-600">UNCERTAIN 仓位系数</label>
                          <input
                            type="number"
                            step={0.1}
                            min={0.1}
                            max={1.0}
                            value={formData.config.smartReverse?.positionMultiplier?.uncertain ?? 0.5}
                            className="w-full border rounded px-2 py-1 text-sm"
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setFormData({
                                ...formData,
                                config: {
                                  ...formData.config,
                                  smartReverse: {
                                    ...formData.config.smartReverse,
                                    positionMultiplier: {
                                      ...formData.config.smartReverse.positionMultiplier,
                                      uncertain: val,
                                    },
                                  },
                                },
                              });
                            }}
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="text-xs text-gray-600">反向入场日内得分上限</label>
                          <input
                            type="number"
                            step={1}
                            min={-10}
                            max={20}
                            value={formData.config.smartReverse?.thresholds?.maxIntradayScoreForEntry ?? 0}
                            className="w-full border rounded px-2 py-1 text-sm"
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setFormData({
                                ...formData,
                                config: {
                                  ...formData.config,
                                  smartReverse: {
                                    ...formData.config.smartReverse,
                                    thresholds: {
                                      ...formData.config.smartReverse.thresholds,
                                      maxIntradayScoreForEntry: val,
                                    },
                                  },
                                },
                              });
                            }}
                          />
                          <p className="text-xs text-amber-600 mt-1">
                            intraScore 超过此值时禁止反向入场（均值回归窗口已过）。0 = 日内转正即禁止，负值更激进。
                          </p>
                        </div>
                      </div>
                    )}
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
                            入场阈值={formData.config.entryThresholdOverride?.directionalScoreMin ?? 8}
                            {(formData.config.entryThresholdOverride?.absoluteScoreFloor ?? 0) > 0 && `,地板=${formData.config.entryThresholdOverride.absoluteScoreFloor}`},
                            止盈={formData.config.exitRules?.takeProfitPercent ?? 40}%,
                            止损={formData.config.exitRules?.stopLossPercent ?? 30}%
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
                          <input {...numberInputProps('entryDirectionalScoreMin', { path: ['entryThresholdOverride', 'directionalScoreMin'], defaultValue: 8, min: 3, max: 50 })} />
                          <p className="text-xs text-gray-500 mt-1">信号绝对值需达到此阈值才入场</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">绝对最低分数</label>
                          <input {...numberInputProps('absoluteScoreFloor', { path: ['entryThresholdOverride', 'absoluteScoreFloor'], defaultValue: 0, min: 0, max: 30 })} />
                          <p className="text-xs text-gray-500 mt-1">动态阈值的硬下限，0=不限制</p>
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    </div>
                    {/* 追踪止损参数 */}
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-gray-700 mb-1 font-medium">追踪止损触发 %</label>
                        <input {...numberInputProps('trailingStopTrigger', { path: ['exitRules', 'trailingStopTrigger'], defaultValue: 0, min: 0, max: 50 })} />
                        <p className="text-xs text-gray-500 mt-1">盈利达此值后启用追踪止损（0=使用系统默认：按时段8-30%）</p>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-700 mb-1 font-medium">追踪回撤幅度 %</label>
                        <input {...numberInputProps('trailingStopPercent', { path: ['exitRules', 'trailingStopPercent'], defaultValue: 0, min: 0, max: 30 })} />
                        <p className="text-xs text-gray-500 mt-1">从盈利峰值回撤此幅度触发止损（0=使用系统默认：按时段8-15%）</p>
                      </div>
                    </div>
                    {/* 阶梯锁利配置 */}
                    <div className="mt-3 p-3 border rounded bg-blue-50 border-blue-200">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs text-gray-700 font-semibold">阶梯锁利</label>
                        <span className="text-xs text-gray-500">盈利踩上台阶后锁定最低利润底线</span>
                      </div>
                      <div className="space-y-1.5">
                        {(formData.config.exitRules?.profitLockSteps ?? [
                          { threshold: 8, floor: 2 },
                          { threshold: 12, floor: 6 },
                          { threshold: 18, floor: 12 },
                          { threshold: 30, floor: 22 },
                          { threshold: 50, floor: 38 },
                        ]).map((step: { threshold: number; floor: number }, idx: number) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-10 shrink-0">台阶{idx + 1}</span>
                            <span className="text-xs text-gray-500 shrink-0">盈利&ge;</span>
                            <input
                              type="number"
                              value={step.threshold}
                              min={1}
                              max={100}
                              className="w-14 border rounded px-1.5 py-1 text-xs text-center"
                              onChange={(e) => {
                                const steps = [...(formData.config.exitRules?.profitLockSteps ?? [
                                  { threshold: 8, floor: 2 },
                                  { threshold: 12, floor: 6 },
                                  { threshold: 18, floor: 12 },
                                  { threshold: 30, floor: 22 },
                                  { threshold: 50, floor: 38 },
                                ])];
                                steps[idx] = { ...steps[idx], threshold: Number(e.target.value) };
                                setFormData({
                                  ...formData,
                                  config: {
                                    ...formData.config,
                                    exitRules: { ...formData.config.exitRules, profitLockSteps: steps },
                                  },
                                });
                              }}
                            />
                            <span className="text-xs text-gray-400">% &rarr; 锁定</span>
                            <input
                              type="number"
                              value={step.floor}
                              min={0}
                              max={100}
                              className="w-14 border rounded px-1.5 py-1 text-xs text-center"
                              onChange={(e) => {
                                const steps = [...(formData.config.exitRules?.profitLockSteps ?? [
                                  { threshold: 8, floor: 2 },
                                  { threshold: 12, floor: 6 },
                                  { threshold: 18, floor: 12 },
                                  { threshold: 30, floor: 22 },
                                  { threshold: 50, floor: 38 },
                                ])];
                                steps[idx] = { ...steps[idx], floor: Number(e.target.value) };
                                setFormData({
                                  ...formData,
                                  config: {
                                    ...formData.config,
                                    exitRules: { ...formData.config.exitRules, profitLockSteps: steps },
                                  },
                                });
                              }}
                            />
                            <span className="text-xs text-gray-400">%</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">峰值盈利达到左侧阈值后，利润跌回右侧底线即触发止盈退出。如 8%&rarr;2% 表示盈利曾达8%后回落到2%就退出。</p>
                    </div>
                    <div className="mt-3 p-3 bg-gray-100 border border-gray-200 rounded text-xs text-gray-600">
                      <p><strong>动态缩放：</strong>上方止盈/止损为EARLY阶段基准，MID约80%，LATE约60%，FINAL约40%。</p>
                      <p className="mt-1"><strong>强平规则：</strong>0DTE 收盘前180分钟（约1:00 PM ET）强制平仓；非0DTE 收盘前10分钟强制平仓。</p>
                      <p className="mt-1"><strong>自动退出层次：</strong>阶梯锁利 → 追踪止损 → 0DTE兜底止损(-25%) → 安全阀(-40%)，始终生效。</p>
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
                        <p className="text-xs text-gray-500 mt-1">开盘后N分钟内禁止所有入场（不降级、不豁免）</p>
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                      <div>
                        <label className="block text-xs text-gray-700 mb-1 font-medium">非0DTE冷静期（分钟）</label>
                        <input {...numberInputProps('nonZdteCooldownMinutes', { path: ['tradeWindow', 'nonZdteCooldownMinutes'], defaultValue: 0, min: 0, max: 60 })} />
                        <p className="text-xs text-gray-500 mt-1">非0DTE开盘后N分钟禁止入场（0=不限制）</p>
                      </div>
                    </div>
                    {/* 开盘冲量守卫 */}
                    <div className="mt-4 p-3 border rounded bg-white">
                      <div className="flex items-center gap-2 mb-3">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.config.tradeWindow?.openImpulseGuard?.enabled ?? false}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                config: {
                                  ...formData.config,
                                  tradeWindow: {
                                    ...(formData.config.tradeWindow || {}),
                                    openImpulseGuard: {
                                      ...(formData.config.tradeWindow?.openImpulseGuard || { maxOpenMoveATR: 1.5, filterActiveMinutes: 30, scoreOverrideMultiplier: 2.0 }),
                                      enabled: e.target.checked,
                                    },
                                  },
                                },
                              })
                            }
                          />
                          <span className="text-xs font-semibold text-gray-700">开盘冲量守卫</span>
                        </label>
                        <span className="text-xs text-gray-500">开盘窗口内价格朝信号方向冲量过大时拦截入场</span>
                      </div>
                      <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 ${!(formData.config.tradeWindow?.openImpulseGuard?.enabled) ? 'opacity-50' : ''}`}>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">ATR阈值</label>
                          <input {...numberInputProps('maxOpenMoveATR', { path: ['tradeWindow', 'openImpulseGuard', 'maxOpenMoveATR'], defaultValue: 1.5, min: 0.5, max: 5, step: 0.1, isFloat: true })}
                            disabled={!(formData.config.tradeWindow?.openImpulseGuard?.enabled)}
                          />
                          <p className="text-xs text-gray-500 mt-1">开盘移动超过N倍ATR则拦截</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">生效窗口（分钟）</label>
                          <input {...numberInputProps('filterActiveMinutes', { path: ['tradeWindow', 'openImpulseGuard', 'filterActiveMinutes'], defaultValue: 30, min: 5, max: 120 })}
                            disabled={!(formData.config.tradeWindow?.openImpulseGuard?.enabled)}
                          />
                          <p className="text-xs text-gray-500 mt-1">开盘后N分钟内检查冲量</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">覆盖倍数</label>
                          <input {...numberInputProps('scoreOverrideMultiplier', { path: ['tradeWindow', 'openImpulseGuard', 'scoreOverrideMultiplier'], defaultValue: 2.0, min: 1.0, max: 5, step: 0.1, isFloat: true })}
                            disabled={!(formData.config.tradeWindow?.openImpulseGuard?.enabled)}
                          />
                          <p className="text-xs text-gray-500 mt-1">超强信号(score&ge;阈值&times;N)可覆盖拦截</p>
                        </div>
                      </div>
                    </div>
                    {/* 动量加速度 bonus */}
                    <div className="mt-4 p-3 border rounded bg-white">
                      <div className="flex items-center gap-2 mb-3">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.config.accelerationBonus?.enabled ?? true}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                config: {
                                  ...formData.config,
                                  accelerationBonus: {
                                    ...(formData.config.accelerationBonus || { accelRatioThreshold: 1.15, bonusMultiplier: 5.0, bonusCap: 8.0 }),
                                    enabled: e.target.checked,
                                  },
                                },
                              })
                            }
                          />
                          <span className="text-xs font-semibold text-gray-700">动量加速度 Bonus</span>
                        </label>
                        <span className="text-xs text-gray-500">检测价格加速构建阶段，提前触发入场信号（基于 FastMo 实时数据）</span>
                      </div>
                      <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 ${!(formData.config.accelerationBonus?.enabled ?? true) ? 'opacity-50' : ''}`}>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">加速阈值</label>
                          <input {...numberInputProps('accelRatioThreshold', { path: ['accelerationBonus', 'accelRatioThreshold'], defaultValue: 1.15, min: 1.05, max: 2.0, step: 0.05, isFloat: true })}
                            disabled={!(formData.config.accelerationBonus?.enabled ?? true)}
                          />
                          <p className="text-xs text-gray-500 mt-1">decelRatio 超过此值视为加速（低=灵敏，高=保守）</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">Bonus 系数</label>
                          <input {...numberInputProps('bonusMultiplier', { path: ['accelerationBonus', 'bonusMultiplier'], defaultValue: 5.0, min: 1.0, max: 15.0, step: 0.5, isFloat: true })}
                            disabled={!(formData.config.accelerationBonus?.enabled ?? true)}
                          />
                          <p className="text-xs text-gray-500 mt-1">加速度幅度到分数的映射倍数（越大 bonus 越强）</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">Bonus 上限</label>
                          <input {...numberInputProps('bonusCap', { path: ['accelerationBonus', 'bonusCap'], defaultValue: 8.0, min: 2.0, max: 15.0, step: 0.5, isFloat: true })}
                            disabled={!(formData.config.accelerationBonus?.enabled ?? true)}
                          />
                          <p className="text-xs text-gray-500 mt-1">finalScore 最大 bonus（安全阀，防止单靠加速度过阈值）</p>
                        </div>
                      </div>
                    </div>
                    {/* Schwartz 过滤器开关（合并自 OPTION_SCHWARTZ_V1） */}
                    {formData.type === 'OPTION_INTRADAY_V1' && (
                    <div className="mt-4 p-3 border rounded bg-green-50 border-green-200">
                      <div className="mb-2">
                        <span className="text-xs font-semibold text-gray-700">Schwartz 过滤器</span>
                        <span className="text-xs text-gray-500 ml-2">合并自舒华兹策略，全部默认关闭，生产环境行为不变</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.config.schwartzFilters?.emaHardFilter ?? false}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                config: {
                                  ...formData.config,
                                  schwartzFilters: {
                                    ...(formData.config.schwartzFilters || {}),
                                    emaHardFilter: e.target.checked,
                                  },
                                },
                              })
                            }
                            className="w-4 h-4"
                          />
                          <div>
                            <span className="text-xs text-gray-700 font-medium">EMA 硬过滤</span>
                            <p className="text-xs text-gray-400">10 EMA 逆趋势一刀切拒绝</p>
                          </div>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.config.schwartzFilters?.chopDetection ?? false}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                config: {
                                  ...formData.config,
                                  schwartzFilters: {
                                    ...(formData.config.schwartzFilters || {}),
                                    chopDetection: e.target.checked,
                                  },
                                },
                              })
                            }
                            className="w-4 h-4"
                          />
                          <div>
                            <span className="text-xs text-gray-700 font-medium">CHOP 震荡检测</span>
                            <p className="text-xs text-gray-400">震荡期入场阈值翻倍</p>
                          </div>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.config.schwartzFilters?.ivRankFilter ?? false}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                config: {
                                  ...formData.config,
                                  schwartzFilters: {
                                    ...(formData.config.schwartzFilters || {}),
                                    ivRankFilter: e.target.checked,
                                  },
                                },
                              })
                            }
                            className="w-4 h-4"
                          />
                          <div>
                            <span className="text-xs text-gray-700 font-medium">IV Rank 过滤</span>
                            <p className="text-xs text-gray-400">高隐含波动率时拒绝买方</p>
                          </div>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.config.schwartzFilters?.positionReduction ?? false}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                config: {
                                  ...formData.config,
                                  schwartzFilters: {
                                    ...(formData.config.schwartzFilters || {}),
                                    positionReduction: e.target.checked,
                                  },
                                },
                              })
                            }
                            className="w-4 h-4"
                          />
                          <div>
                            <span className="text-xs text-gray-700 font-medium">仓位缩减</span>
                            <p className="text-xs text-gray-400">大赚/连胜后自动缩减仓位</p>
                          </div>
                        </label>
                      </div>
                    </div>
                    )}
                    <div className="mt-3 p-2 bg-yellow-100 rounded text-xs text-yellow-800">
                      <strong>强平规则（不可配置）：</strong>0DTE 收盘前180分钟（1:00 PM ET）强平 | 非0DTE 收盘前10分钟强平 | 绝对止损 -40%
                    </div>
                  </div>

                  {/* Section: 风控限制 */}
                  <div className="mb-4 p-4 border rounded bg-red-50 border-red-200">
                    <label className="block text-xs text-gray-700 mb-3 font-semibold">风控限制</label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-gray-700 mb-1 font-medium">每标的每日交易次数上限</label>
                        <input {...numberInputProps('maxDailyTradesPerUnderlying', { path: ['riskLimits', 'maxDailyTradesPerUnderlying'], defaultValue: 0, min: 0, max: 20 })} />
                        <p className="text-xs text-gray-500 mt-1">同一标的当日最多入场次数（0=不限制）</p>
                      </div>
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
                          onChange={(e) => {
                            const newMode = e.target.value;
                            const newSizing: Record<string, unknown> = { ...(formData.config.positionSizing || {}), mode: newMode };
                            // 切到资金池动态模式时，清除手动金额，确保后端使用 capitalManager
                            if (newMode === 'MAX_PREMIUM') {
                              delete newSizing.maxPremiumUsd;
                            }
                            setFormData({
                              ...formData,
                              config: { ...formData.config, positionSizing: newSizing },
                            });
                          }}
                          className="border rounded px-3 py-2 w-full"
                        >
                          <option value="FIXED_CONTRACTS">固定张数</option>
                          <option value="MAX_PREMIUM">资金池动态（按分配资金自动计算）</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                      {formData.config.positionSizing?.mode === 'MAX_PREMIUM' ? (
                        <div className="col-span-full">
                          <p className="text-xs text-gray-500">
                            根据策略关联的资金分组，自动计算可用预算（可用资金 与 单标的上限 取较小值），按当前权利金动态决定合约数量。无需手动设定金额。
                          </p>
                        </div>
                      ) : (
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">固定张数</label>
                          <input {...numberInputProps('fixedContracts', { path: ['positionSizing', 'fixedContracts'], defaultValue: 1, min: 1, max: 20 })} />
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                      <div>
                        <label className="block text-xs text-gray-700 mb-1 font-medium">最低入场价($)</label>
                        <input {...numberInputProps('minEntryPrice', { path: ['liquidityFilters', 'minEntryPrice'], defaultValue: 0, min: 0, max: 20, step: 0.1, isFloat: true })} />
                        <p className="text-xs text-gray-500 mt-1">过滤低价OTM期权（0=不过滤）</p>
                      </div>
                    </div>
                    <div className="mt-3 bg-blue-50 border border-blue-200 rounded p-3">
                      <p className="text-xs text-blue-800">
                        <strong>费用模型（默认）：</strong> 佣金 0.10 USD/张（每单最低0.99） + 平台费 0.30 USD/张
                      </p>
                    </div>
                  </div>

                  {/* Schwartz 专属配置区（仅 OPTION_SCHWARTZ_V1 显示） */}
                  {formData.type === 'OPTION_SCHWARTZ_V1' && (
                    <div className="mb-4 p-4 border rounded bg-green-50 border-green-200">
                      <label className="block text-xs text-gray-700 mb-3 font-semibold">舒华兹策略参数</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">EMA 周期</label>
                          <input {...numberInputProps('schwartz_emaPeriod', { path: ['schwartz', 'emaPeriod'], defaultValue: 10, min: 5, max: 50 })} />
                          <p className="text-xs text-gray-400 mt-1">趋势过滤周期，默认10</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">EMA 缠绕阈值(%)</label>
                          <input {...numberInputProps('schwartz_emaWrap', { path: ['schwartz', 'emaWrapThreshold'], defaultValue: 0.3, min: 0.1, max: 2, step: 0.1, isFloat: true })} />
                          <p className="text-xs text-gray-400 mt-1">价格偏离EMA小于此值拒绝</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">震荡阈值(%)</label>
                          <input {...numberInputProps('schwartz_chop', { path: ['schwartz', 'chopThreshold'], defaultValue: 0.5, min: 0.1, max: 3, step: 0.1, isFloat: true })} />
                          <p className="text-xs text-gray-400 mt-1">MA10/20偏离低于此值为震荡</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">IV Rank 拒绝阈值</label>
                          <input {...numberInputProps('schwartz_ivRank', { path: ['schwartz', 'ivRankRejectThreshold'], defaultValue: 60, min: 30, max: 90 })} />
                          <p className="text-xs text-gray-400 mt-1">IV Rank高于此值拒绝买方</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">降级IV阈值</label>
                          <input {...numberInputProps('schwartz_ivFallback', { path: ['schwartz', 'ivFallbackRejectIV'], defaultValue: 0.8, min: 0.3, max: 1.5, step: 0.05, isFloat: true })} />
                          <p className="text-xs text-gray-400 mt-1">数据不足时的IV拒绝阈值</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1 font-medium">大赚阈值(%)</label>
                          <input {...numberInputProps('schwartz_bigWin', { path: ['schwartz', 'bigWinThreshold'], defaultValue: 30, min: 10, max: 100 })} />
                          <p className="text-xs text-gray-400 mt-1">盈利超此值后缩减仓位</p>
                        </div>
                      </div>
                      <div className="mt-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.config?.schwartz?.positionShrinkAfterBigWin !== false}
                            onChange={(e) => {
                              setFormData({
                                ...formData,
                                config: {
                                  ...formData.config,
                                  schwartz: {
                                    ...(formData.config?.schwartz || {}),
                                    positionShrinkAfterBigWin: e.target.checked,
                                  },
                                },
                              });
                            }}
                            className="w-4 h-4"
                          />
                          <span className="text-xs text-gray-700 font-medium">大赚后缩减仓位</span>
                        </label>
                        <p className="text-xs text-gray-400 mt-1 ml-6">上笔盈利超阈值时缩减50%仓位，连胜2笔缩至1张</p>
                      </div>
                    </div>
                  )}
                </>
              ) : formData.type === 'TREND_FOLLOWING_V1' ? (
                <>
                  <div className="bg-green-50 border border-green-200 rounded p-3 mb-3">
                    <p className="text-xs text-green-800 mb-2"><strong>评分模型：</strong>趋势分(40%) + 动量分(30%) + 环境分(30%) = 百分制</p>
                    <p className="text-xs text-green-700">
                      趋势分: MA系统(20) + 52W高点(10) + SPX一致性(10) |
                      动量分: RS排名(15) + 成交量(10) + Gap(5) |
                      环境分: VIX(10) + BTC(5) + USD(5) + 温度(10)
                    </p>
                    <p className="text-xs text-green-600 mt-1"><strong>退出：</strong>ATR trailing stop + MA200跌破清仓 + MA50跌破收紧stop</p>
                  </div>
                  {/* 均线参数 */}
                  <p className="text-xs font-semibold text-gray-600 mb-2">均线参数</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">MA快线周期</label>
                      <input type="number" value={formData.config.maFastPeriod ?? 50}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, maFastPeriod: parseInt(e.target.value) || 50 } })}
                        className="border rounded px-3 py-2 w-full" min="5" max="100" />
                      <p className="text-xs text-gray-500 mt-1">默认 50</p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">MA慢线周期</label>
                      <input type="number" value={formData.config.maSlowPeriod ?? 200}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, maSlowPeriod: parseInt(e.target.value) || 200 } })}
                        className="border rounded px-3 py-2 w-full" min="50" max="500" />
                      <p className="text-xs text-gray-500 mt-1">默认 200</p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">52W高点阈值%</label>
                      <input type="number" value={formData.config.weekHigh52Threshold ?? 85}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, weekHigh52Threshold: parseInt(e.target.value) || 85 } })}
                        className="border rounded px-3 py-2 w-full" min="50" max="100" />
                      <p className="text-xs text-gray-500 mt-1">默认 85%</p>
                    </div>
                  </div>
                  {/* 风控参数 */}
                  <p className="text-xs font-semibold text-gray-600 mb-2">风控参数</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">ATR周期</label>
                      <input type="number" value={formData.config.atrPeriod ?? 14}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, atrPeriod: parseInt(e.target.value) || 14 } })}
                        className="border rounded px-3 py-2 w-full" min="5" max="50" />
                      <p className="text-xs text-gray-500 mt-1">默认 14</p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">ATR止损倍数</label>
                      <input type="number" step="0.1" value={formData.config.atrTrailingMultiple ?? 2.0}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, atrTrailingMultiple: parseFloat(e.target.value) || 2.0 } })}
                        className="border rounded px-3 py-2 w-full" min="0.5" max="5" />
                      <p className="text-xs text-gray-500 mt-1">默认 2.0</p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">MA50收紧倍数</label>
                      <input type="number" step="0.1" value={formData.config.atrTightenMultiple ?? 1.0}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, atrTightenMultiple: parseFloat(e.target.value) || 1.0 } })}
                        className="border rounded px-3 py-2 w-full" min="0.5" max="3" />
                      <p className="text-xs text-gray-500 mt-1">默认 1.0</p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">最大持仓数</label>
                      <input type="number" value={formData.config.maxConcurrentPositions ?? 5}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, maxConcurrentPositions: parseInt(e.target.value) || 5 } })}
                        className="border rounded px-3 py-2 w-full" min="1" max="20" />
                      <p className="text-xs text-gray-500 mt-1">默认 5</p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">单标的占比%</label>
                      <input type="number" step="1" value={Math.round((formData.config.maxConcentration ?? 0.15) * 100)}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, maxConcentration: (parseInt(e.target.value) || 15) / 100 } })}
                        className="border rounded px-3 py-2 w-full" min="5" max="50" />
                      <p className="text-xs text-gray-500 mt-1">默认 15%</p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">日亏损熔断%</label>
                      <input type="number" step="0.5" value={formData.config.dailyLossLimitPct ?? 2}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, dailyLossLimitPct: parseFloat(e.target.value) || 2 } })}
                        className="border rounded px-3 py-2 w-full" min="0.5" max="10" />
                      <p className="text-xs text-gray-500 mt-1">默认 2%</p>
                    </div>
                  </div>
                  {/* 入场参数 */}
                  <p className="text-xs font-semibold text-gray-600 mb-2">入场参数</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">入场阈值(百分制)</label>
                      <input type="number" value={formData.config.entryScoreThreshold ?? 65}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, entryScoreThreshold: parseInt(e.target.value) || 65 } })}
                        className="border rounded px-3 py-2 w-full" min="30" max="90" />
                      <p className="text-xs text-gray-500 mt-1">默认 65</p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">绝对地板分</label>
                      <input type="number" value={formData.config.absoluteScoreFloor ?? 45}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, absoluteScoreFloor: parseInt(e.target.value) || 45 } })}
                        className="border rounded px-3 py-2 w-full" min="20" max="80" />
                      <p className="text-xs text-gray-500 mt-1">默认 45</p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">最大追涨Gap%</label>
                      <input type="number" step="0.5" value={formData.config.maxGapUpPct ?? 2}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, maxGapUpPct: parseFloat(e.target.value) || 2 } })}
                        className="border rounded px-3 py-2 w-full" min="0.5" max="10" />
                      <p className="text-xs text-gray-500 mt-1">默认 2%</p>
                    </div>
                  </div>
                  {/* 杠杆ETF */}
                  <p className="text-xs font-semibold text-gray-600 mb-2">杠杆ETF限制</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">杠杆ETF占比%</label>
                      <input type="number" step="1" value={Math.round((formData.config.leveragedEtfMaxConcentration ?? 0.10) * 100)}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, leveragedEtfMaxConcentration: (parseInt(e.target.value) || 10) / 100 } })}
                        className="border rounded px-3 py-2 w-full" min="5" max="30" />
                      <p className="text-xs text-gray-500 mt-1">默认 10%</p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">杠杆ETF最长天数</label>
                      <input type="number" value={formData.config.leveragedEtfMaxDays ?? 5}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, leveragedEtfMaxDays: parseInt(e.target.value) || 5 } })}
                        className="border rounded px-3 py-2 w-full" min="1" max="30" />
                      <p className="text-xs text-gray-500 mt-1">默认 5 天</p>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1 font-medium">震荡检测阈值</label>
                      <input type="number" step="0.1" value={formData.config.chopThreshold ?? 0.5}
                        onChange={(e) => setFormData({ ...formData, config: { ...formData.config, chopThreshold: parseFloat(e.target.value) || 0.5 } })}
                        className="border rounded px-3 py-2 w-full" min="0.1" max="3" />
                      <p className="text-xs text-gray-500 mt-1">默认 0.5</p>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-3">
                    <p className="text-xs text-blue-800 mb-2">
                      <strong>参数说明：</strong>
                    </p>
                    <ul className="text-xs text-blue-700 space-y-1 ml-4 list-disc">
                      <li><strong>ATR周期</strong>：计算平均真实波幅的周期，默认14天。周期越长，ATR值越平滑但反应越慢。</li>
                      <li><strong>ATR倍数</strong>：用于计算止损距离的倍数，默认2.0。倍数越大，止损距离越远，风险越小但可能错过更多机会。</li>
                      <li><strong>风险收益比</strong>：止盈价格与止损价格的比例，默认1.5。比例越大，潜在收益越高，但需要更强的趋势支持。</li>
                    </ul>
                    <p className="text-xs text-blue-600 mt-2">
                      <strong>计算公式：</strong>止损价 = 入场价 - (ATR x ATR倍数)，止盈价 = 入场价 + (止损距离 x 风险收益比)
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
            form="strategy-form"
            disabled={loading}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? (isEditMode ? '保存中...' : '创建中...') : (isEditMode ? '保存' : '创建')}
          </button>
        </div>
      </div>
    </div>
  );
}
