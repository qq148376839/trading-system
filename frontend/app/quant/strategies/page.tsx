'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { quantApi, watchlistApi } from '@/lib/api';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import InstitutionStockSelector from '@/components/InstitutionStockSelector';
import EditStrategyModal from '@/components/EditStrategyModal';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Button, Input, Table, Tag, Card, Space, Modal, message, Alert, Radio, Spin, Select } from 'antd';

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

export default function StrategiesPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadStrategies();
  }, []);

  const loadStrategies = async () => {
    try {
      setLoading(true);
      const response = await quantApi.getStrategies();
      if (response.success) {
        setStrategies(response.data || []);
      } else {
        setError('加载策略列表失败');
      }
    } catch (err: any) {
      setError(err.message || '加载策略列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async (id: number) => {
    try {
      await quantApi.startStrategy(id);
      message.success('策略启动成功');
      await loadStrategies();
    } catch (err: any) {
      message.error(err.message || '启动策略失败');
    }
  };

  const handleStop = async (id: number) => {
    Modal.confirm({
      title: '确认停止策略',
      content: '确定要停止该策略吗？',
      onOk: async () => {
        try {
          await quantApi.stopStrategy(id);
          message.success('策略已停止');
          await loadStrategies();
        } catch (err: any) {
          message.error(err.message || '停止策略失败');
        }
      },
    });
  };

  const handleEdit = (strategy: Strategy) => {
    setEditingStrategy(strategy);
    setShowEditModal(true);
  };

  const handleDelete = async (id: number) => {
    Modal.confirm({
      title: '确认删除策略',
      content: '确定要删除该策略吗？此操作不可恢复！',
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        try {
          await quantApi.deleteStrategy(id);
          message.success('策略已删除');
          await loadStrategies();
        } catch (err: any) {
          message.error(err.message || '删除策略失败');
        }
      },
    });
  };

  const filteredStrategies = strategies.filter((s) =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      RUNNING: { color: 'success', text: '运行中' },
      ERROR: { color: 'error', text: '错误' },
      PAUSED: { color: 'warning', text: '暂停' },
      STOPPED: { color: 'default', text: '已停止' },
    };
    const config = statusMap[status] || { color: 'default', text: status };
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  const columns = [
    {
      title: '名称',
      key: 'name',
      dataIndex: 'name',
      render: (_: any, record: Strategy) => (
        <Link href={`/quant/strategies/${record.id}`} style={{ color: '#1890ff' }}>
          {record.name}
        </Link>
      ),
    },
    ...(isMobile ? [] : [{
      title: '类型',
      key: 'type',
      dataIndex: 'type',
    }]),
    {
      title: '状态',
      key: 'status',
      dataIndex: 'status',
      render: (_: any, record: Strategy) => getStatusTag(record.status),
    },
    ...(isMobile ? [] : [{
      title: '资金分配',
      key: 'allocationName',
      dataIndex: 'allocationName',
      render: (text: string) => text || '-',
    }]),
    {
      title: '操作',
      key: 'actions',
      width: isMobile ? 100 : undefined,
      render: (_: any, record: Strategy) => (
        <Space>
          {record.status === 'STOPPED' && (
            <Button type="link" onClick={() => handleStart(record.id)} style={{ color: '#52c41a' }}>
              启动
            </Button>
          )}
          {record.status === 'RUNNING' && (
            <Button type="link" danger onClick={() => handleStop(record.id)}>
              停止
            </Button>
          )}
          {record.status === 'STOPPED' && (
            <Button type="link" onClick={() => handleEdit(record)}>
              编辑
            </Button>
          )}
          {record.status === 'STOPPED' && (
            <Button type="link" danger onClick={() => handleDelete(record.id)}>
              删除
            </Button>
          )}
          <Link href={`/quant/strategies/${record.id}`} style={{ color: '#1890ff' }}>
            详情
          </Link>
        </Space>
      ),
    },
  ];

  return (
    <AppLayout>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>策略管理</h1>
          <Button type="primary" onClick={() => setShowCreateModal(true)}>
            创建策略
          </Button>
        </div>

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            closable
            onClose={() => setError(null)}
            style={{ marginBottom: 16 }}
          />
        )}

        <div style={{ marginBottom: 16 }}>
          <Input
            placeholder="搜索策略..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ maxWidth: 400 }}
            allowClear
          />
        </div>

        <Table
          dataSource={filteredStrategies}
          columns={columns}
          rowKey="id"
          loading={loading}
          size={isMobile ? 'small' : 'middle'}
          scroll={isMobile ? { x: 400 } : { x: 'max-content' }}
          locale={{
            emptyText: filteredStrategies.length === 0 && !loading ? '暂无策略' : undefined,
          }}
        />

      {showCreateModal && (
        <CreateStrategyModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            loadStrategies();
          }}
        />
      )}

      {showEditModal && editingStrategy && (
        <EditStrategyModal
          strategy={editingStrategy}
          onClose={() => {
            setShowEditModal(false);
            setEditingStrategy(null);
          }}
          onSuccess={() => {
            setShowEditModal(false);
            setEditingStrategy(null);
            loadStrategies();
          }}
        />
      )}
      </Card>
    </AppLayout>
  );
}

function CreateStrategyModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
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
      entryThresholdOverride: { directionalScoreMin: 12 },
      schwartz: {
        emaPeriod: 10,
        chopThreshold: 0.5,
        emaWrapThreshold: 0.3,
        ivRankRejectThreshold: 60,
        ivFallbackRejectIV: 0.8,
        positionShrinkAfterBigWin: true,
        bigWinThreshold: 30,
      },
    },
  };

  const [formData, setFormData] = useState({
    name: '',
    type: 'RECOMMENDATION_V1',
    capitalAllocationId: null as number | null,
    symbolPoolConfig: { mode: 'STATIC', symbols: [] as string[] },
    config: DEFAULT_CONFIGS.RECOMMENDATION_V1,
  });
  const [allocations, setAllocations] = useState<any[]>([]);
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [newSymbol, setNewSymbol] = useState('');
  const [symbolError, setSymbolError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [availableCapital, setAvailableCapital] = useState(0);
  const [stockPoolMode, setStockPoolMode] = useState<'STATIC' | 'INSTITUTION'>('STATIC');
  const [totalCapital, setTotalCapital] = useState(0);
  const [optionRankList, setOptionRankList] = useState<Array<{ symbol: string; name: string; optionVolume: string; optionPosition: string; price: string; changeRate: string }>>([]);
  const [optionRankLoading, setOptionRankLoading] = useState(false);
  const [optionRankType, setOptionRankType] = useState<'total-volume' | 'total-turnover'>('total-volume');
  const [optionRankOpen, setOptionRankOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      quantApi.getCapitalAllocations(),
      watchlistApi.getWatchlist(true), // 只获取启用的关注股票
      quantApi.getCapitalUsage(), // 获取总资金和资金使用情况
    ]).then(([allocRes, watchRes, usageRes]) => {
      if (allocRes.success) {
        setAllocations(allocRes.data || []);
      }
      if (watchRes.success && watchRes.data?.watchlist) {
        setWatchlist(watchRes.data.watchlist);
      }
      if (usageRes.success && usageRes.data) {
        setTotalCapital(usageRes.data.totalCapital || 0);
        // 更新 allocations 中的实际分配金额（如果是百分比类型）
        if (usageRes.data.allocations && Array.isArray(usageRes.data.allocations)) {
          const updatedAllocations = (allocRes.data || []).map((alloc: any) => {
            const usageAlloc = usageRes.data.allocations.find((u: any) => u.id === alloc.id);
            if (usageAlloc && alloc.allocationType === 'PERCENTAGE') {
              // 百分比类型：使用总资金计算实际金额
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
    });
  }, []);

  // 当资金分配账户变化时，更新可用资金
  useEffect(() => {
    if (formData.capitalAllocationId && allocations.length > 0) {
      // 从 allocations 数组中找到对应的账户
      const allocation = allocations.find(
        (a) => a.id === formData.capitalAllocationId
      );
      if (allocation) {
        // 计算可用资金
        let allocated: number;
        
        if (allocation.allocationType === 'PERCENTAGE') {
          // 百分比类型：需要乘以总资金
          allocated = totalCapital * parseFloat(allocation.allocationValue || '0');
        } else {
          // 固定金额类型：直接使用 allocationValue
          allocated = parseFloat(allocation.allocationValue || '0');
        }
        
        const used = parseFloat(allocation.currentUsage || '0');
        const available = Math.max(0, allocated - used);
        
        console.log('[策略创建] 计算可用资金:', {
          allocationId: allocation.id,
          allocationName: allocation.name,
          allocationType: allocation.allocationType,
          allocationValue: allocation.allocationValue,
          totalCapital,
          allocated,
          used,
          available,
        });
        
        setAvailableCapital(available);
      } else {
        console.warn('[策略创建] 未找到对应的资金分配账户:', formData.capitalAllocationId);
        setAvailableCapital(0);
      }
    } else {
      setAvailableCapital(0);
    }
  }, [formData.capitalAllocationId, allocations, totalCapital]);

  // 验证股票代码格式
  const validateSymbol = (symbol: string): string | null => {
    const trimmed = symbol.trim().toUpperCase();
    if (!trimmed) {
      return '请输入股票代码';
    }
    
    // 自动修正常见错误：APPL -> AAPL
    let corrected = trimmed;
    if (corrected === 'APPL.US') {
      corrected = 'AAPL.US';
    }
    
    // 验证格式：ticker.region 或 .ticker.region
    const symbolPattern = /^\.?[A-Z0-9]+\.[A-Z]{2}$/;
    if (!symbolPattern.test(corrected)) {
      return '无效的标的代码格式。请使用 ticker.region 格式，例如：AAPL.US 或 700.HK';
    }
    
    return corrected;
  };

  // 添加股票
  const handleAddSymbol = () => {
    setSymbolError(null);
    const validation = validateSymbol(newSymbol);
    
    if (typeof validation === 'string' && validation.startsWith('无效')) {
      setSymbolError(validation);
      return;
    }
    
    if (typeof validation === 'string') {
      const symbol = validation;
      
      // 检查是否已存在
      if (formData.symbolPoolConfig.symbols.includes(symbol)) {
        setSymbolError('该股票已在股票池中');
        return;
      }
      
      // 添加到股票池
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

  // 从关注列表添加
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

  // 移除股票
  const handleRemoveSymbol = (symbol: string) => {
    setFormData({
      ...formData,
      symbolPoolConfig: {
        ...formData.symbolPoolConfig,
        symbols: formData.symbolPoolConfig.symbols.filter((s) => s !== symbol),
      },
    });
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 验证至少有一个股票
    if (formData.symbolPoolConfig.symbols.length === 0) {
      message.warning('请至少添加一个股票到股票池');
      return;
    }
    
    setLoading(true);
    try {
      await quantApi.createStrategy(formData);
      message.success('策略创建成功');
      onSuccess();
    } catch (err: any) {
      message.error(err.message || '创建策略失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="创建策略"
      open={true}
      onCancel={onClose}
      width={800}
      footer={null}
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
    >
      <form onSubmit={handleSubmit} id="create-strategy-form">
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>策略名称</label>
          <Input
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="请输入策略名称"
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>策略类型</label>
          <Select
            value={formData.type}
            onChange={(value) => {
              const nextType = value as string;
              setStockPoolMode('STATIC');
              setFormData({
                ...formData,
                type: nextType,
                symbolPoolConfig: { mode: 'STATIC', symbols: [] },
                config: DEFAULT_CONFIGS[nextType] || {},
              });
            }}
            style={{ width: '100%' }}
          >
            <Select.Option value="RECOMMENDATION_V1">推荐策略 V1（股票）</Select.Option>
            <Select.Option value="OPTION_INTRADAY_V1">期权日内策略 V1（买方）</Select.Option>
            <Select.Option value="OPTION_SCHWARTZ_V1">期权-舒华兹趋势 V1</Select.Option>
          </Select>
        </div>
        
        {/* 策略类型说明卡片（放在资金分配账户之前） */}
        {formData.type === 'RECOMMENDATION_V1' ? (
          <Alert
            message="推荐策略 V1"
            description="基于市场趋势和ATR（平均真实波幅）的智能推荐策略。系统会分析SPX、USD指数、BTC等市场指标，结合ATR计算止损止盈价格，智能生成买卖信号。适合趋势跟踪和风险控制的量化交易场景。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        ) : formData.type === 'OPTION_SCHWARTZ_V1' ? (
          <Alert
            message="期权-舒华兹趋势 V1"
            description="基于马丁·舒华兹 Pit Bull 交易哲学的期权策略。使用 10 日 EMA 硬过滤（逆趋势无例外拒绝）+ IV Rank 过滤（高IV拒绝买方）+ 震荡区间检测（MA缠绕时提高门槛2x）+ 大赚后仓位缩减。入场门槛更高（得分>=30），适合趋势明确的市场。"
            type="success"
            showIcon
            style={{ marginBottom: 16 }}
          />
        ) : (
          <Alert
            message="期权日内策略 V1（买方）"
            description="对股票/指数标的先生成方向信号，再自动选择流动性更好的期权合约开仓；收盘前30分钟强制平仓（不论盈亏），并将期权佣金/平台费计入资金占用与回测。"
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>资金分配账户</label>
          <Select
            value={formData.capitalAllocationId || undefined}
            onChange={(value) =>
              setFormData({
                ...formData,
                capitalAllocationId: value || null,
              })
            }
            style={{ width: '100%' }}
            placeholder="请选择资金分配账户"
            allowClear
          >
            {allocations.map((alloc) => (
              <Select.Option key={alloc.id} value={alloc.id}>
                {alloc.name}
              </Select.Option>
            ))}
          </Select>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>股票池</label>
          
          {/* 股票池模式选择 */}
          <div style={{ marginBottom: 12 }}>
            <Radio.Group
              value={stockPoolMode}
              onChange={(e) => {
                setStockPoolMode(e.target.value);
                setFormData({
                  ...formData,
                  symbolPoolConfig: { mode: e.target.value, symbols: [] },
                });
              }}
            >
              <Radio value="STATIC">手动输入</Radio>
              <Radio value="INSTITUTION">机构选股</Radio>
            </Radio.Group>
          </div>

          {/* 机构选股模式 */}
          {stockPoolMode === 'INSTITUTION' ? (
            <Card style={{ marginBottom: 16 }}>
              {formData.capitalAllocationId ? (
                availableCapital > 0 ? (
                  <InstitutionStockSelector
                    capitalAllocationId={formData.capitalAllocationId}
                    availableCapital={availableCapital}
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
                ) : (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: '#999' }}>
                    该资金分配账户可用资金不足，请选择其他账户
                  </div>
                )
              ) : (
                <div style={{ textAlign: 'center', padding: '32px 0', color: '#999' }}>
                  请先选择资金分配账户
                </div>
              )}
            </Card>
          ) : (
            <>
          {/* 手动输入模式 - 添加股票输入框 */}
          <div style={{ marginBottom: 8 }}>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                value={newSymbol}
                onChange={(e) => {
                  setNewSymbol(e.target.value);
                  setSymbolError(null);
                }}
                onPressEnter={handleAddSymbol}
                placeholder={
                  formData.type === 'OPTION_INTRADAY_V1'
                    ? '输入标的代码（正股/指数），例如：QQQ.US 或 .SPX.US'
                    : '输入股票代码，例如：AAPL.US'
                }
                style={{ flex: 1 }}
              />
              <Button type="primary" onClick={handleAddSymbol}>
                添加
              </Button>
            </Space.Compact>
            {symbolError && (
              <Alert message={symbolError} type="error" showIcon style={{ marginTop: 8 }} />
            )}
            <p style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
              格式：ticker.region，例如：AAPL.US（美股）、700.HK（港股）
            </p>
          </div>

          {/* 从关注列表快速添加 */}
          {watchlist.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#999', marginBottom: 4 }}>
                从关注列表快速添加：
              </label>
              <Space wrap>
                {watchlist
                  .filter((item) => !formData.symbolPoolConfig.symbols.includes(item.symbol))
                  .slice(0, 10)
                  .map((item) => (
                    <Button
                      key={item.symbol}
                      size="small"
                      onClick={() => handleAddFromWatchlist(item.symbol)}
                    >
                      + {item.symbol}
                    </Button>
                  ))}
              </Space>
            </div>
          )}

          {/* 期权热门股快速添加 */}
          <div style={{ marginBottom: 8 }}>
            <Space size="small">
              <Button
                size="small"
                onClick={() => {
                  if (optionRankOpen) {
                    setOptionRankOpen(false);
                  } else {
                    handleLoadOptionRank(optionRankType);
                  }
                }}
                loading={optionRankLoading}
                style={{ background: '#f3e8ff', color: '#7c3aed', borderColor: '#d8b4fe' }}
              >
                {optionRankOpen ? '收起期权热门股' : '加载期权热门股'}
              </Button>
              {optionRankOpen && (
                <>
                  <Button
                    size="small"
                    type={optionRankType === 'total-volume' ? 'primary' : 'default'}
                    onClick={() => handleLoadOptionRank('total-volume')}
                    style={optionRankType === 'total-volume' ? { background: '#7c3aed', borderColor: '#7c3aed' } : {}}
                  >
                    总成交量
                  </Button>
                  <Button
                    size="small"
                    type={optionRankType === 'total-turnover' ? 'primary' : 'default'}
                    onClick={() => handleLoadOptionRank('total-turnover')}
                    style={optionRankType === 'total-turnover' ? { background: '#7c3aed', borderColor: '#7c3aed' } : {}}
                  >
                    成交额
                  </Button>
                </>
              )}
            </Space>
            {optionRankOpen && optionRankList.length > 0 && (
              <div style={{ marginTop: 8, maxHeight: 200, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead style={{ background: '#fafafa', position: 'sticky', top: 0 }}>
                    <tr>
                      <th style={{ padding: '4px 8px', textAlign: 'left' }}>#</th>
                      <th style={{ padding: '4px 8px', textAlign: 'left' }}>代码</th>
                      <th style={{ padding: '4px 8px', textAlign: 'left' }}>名称</th>
                      <th style={{ padding: '4px 8px', textAlign: 'right' }}>价格</th>
                      <th style={{ padding: '4px 8px', textAlign: 'right' }}>期权成交量</th>
                      <th style={{ padding: '4px 8px', textAlign: 'center' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optionRankList.map((item, idx) => {
                      const alreadyAdded = formData.symbolPoolConfig.symbols.includes(item.symbol);
                      return (
                        <tr key={item.symbol} style={{ borderTop: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '4px 8px', color: '#999' }}>{idx + 1}</td>
                          <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontWeight: 500 }}>{item.symbol}</td>
                          <td style={{ padding: '4px 8px', color: '#666', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', color: '#666' }}>{item.price}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', color: '#666' }}>{item.optionVolume}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                            {alreadyAdded ? (
                              <span style={{ color: '#999' }}>已添加</span>
                            ) : (
                              <a onClick={() => handleAddFromWatchlist(item.symbol)} style={{ color: '#7c3aed', cursor: 'pointer', fontWeight: 500 }}>
                                + 添加
                              </a>
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

          {/* 已添加的股票列表 */}
          <Card style={{ minHeight: 60, maxHeight: 200, overflowY: 'auto' }}>
            {formData.symbolPoolConfig.symbols.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 12, color: '#999' }}>
                暂无股票，请添加
              </div>
            ) : (
              <Space wrap>
                {formData.symbolPoolConfig.symbols.map((symbol) => (
                  <Tag
                    key={symbol}
                    closable
                    onClose={() => handleRemoveSymbol(symbol)}
                    color="blue"
                  >
                    {symbol}
                  </Tag>
                ))}
              </Space>
            )}
          </Card>
          </>
          )}
        </div>
        
        {/* 策略参数配置 */}
        {formData.type === 'RECOMMENDATION_V1' ? (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
              策略参数配置
              <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>（用于计算止损止盈价格）</span>
            </label>
            <Alert
              message="参数说明"
              description={
                <div>
                  <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
                    <li><strong>ATR周期</strong>：计算平均真实波幅的周期，默认14天。周期越长，ATR值越平滑但反应越慢。</li>
                    <li><strong>ATR倍数</strong>：用于计算止损距离的倍数，默认2.0。倍数越大，止损距离越远，风险越小但可能错过更多机会。</li>
                    <li><strong>风险收益比</strong>：止盈价格与止损价格的比例，默认1.5。比例越大，潜在收益越高，但需要更强的趋势支持。</li>
                  </ul>
                  <p style={{ marginTop: 8 }}>
                    <strong>计算公式：</strong>止损价 = 入场价 - (ATR × ATR倍数)，止盈价 = 入场价 + (止损距离 × 风险收益比)
                  </p>
                </div>
              }
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
            />
            <Space style={{ width: '100%' }} size="large">
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>
                  ATR周期 <span style={{ color: '#999' }}>(1-100)</span>
                </label>
                <Input
                  type="number"
                  value={formData.config.atrPeriod || 14}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      config: { ...formData.config, atrPeriod: parseInt(e.target.value) || 14 },
                    })
                  }
                  min={1}
                  max={100}
                />
                <p style={{ fontSize: 12, color: '#999', marginTop: 4 }}>推荐值：14-21</p>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>
                  ATR倍数 <span style={{ color: '#999' }}>(0.1-10)</span>
                </label>
                <Input
                  type="number"
                  step="0.1"
                  value={formData.config.atrMultiplier || 2.0}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      config: { ...formData.config, atrMultiplier: parseFloat(e.target.value) || 2.0 },
                    })
                  }
                  min={0.1}
                  max={10}
                />
                <p style={{ fontSize: 12, color: '#999', marginTop: 4 }}>推荐值：1.5-3.0</p>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>
                  风险收益比 <span style={{ color: '#999' }}>(0.1-10)</span>
                </label>
                <Input
                  type="number"
                  step="0.1"
                  value={formData.config.riskRewardRatio || 1.5}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      config: { ...formData.config, riskRewardRatio: parseFloat(e.target.value) || 1.5 },
                    })
                  }
                  min={0.1}
                  max={10}
                />
                <p style={{ fontSize: 12, color: '#999', marginTop: 4 }}>推荐值：1.5-3.0</p>
              </div>
            </Space>
          </div>
        ) : (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
              期权策略参数
              <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>（强平固定：收盘前30分钟）</span>
            </label>

            <Space style={{ width: '100%' }} size="large" wrap>
              <div style={{ width: 240 }}>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>到期选择</label>
                <Select
                  value={formData.config.expirationMode || '0DTE'}
                  onChange={(v) => setFormData({ ...formData, config: { ...formData.config, expirationMode: v } })}
                  style={{ width: '100%' }}
                >
                  <Select.Option value="0DTE">0DTE优先</Select.Option>
                  <Select.Option value="NEAREST">最近到期</Select.Option>
                </Select>
              </div>

              <div style={{ width: 240 }}>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>方向</label>
                <Select
                  value={formData.config.directionMode || 'FOLLOW_SIGNAL'}
                  onChange={(v) => setFormData({ ...formData, config: { ...formData.config, directionMode: v } })}
                  style={{ width: '100%' }}
                >
                  <Select.Option value="FOLLOW_SIGNAL">跟随信号（BUY=Call，SELL=Put）</Select.Option>
                  <Select.Option value="CALL_ONLY">只买Call</Select.Option>
                  <Select.Option value="PUT_ONLY">只买Put</Select.Option>
                </Select>
              </div>

              <div style={{ width: 240 }}>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>开仓价格</label>
                <Select
                  value={formData.config.entryPriceMode || 'ASK'}
                  onChange={(v) => setFormData({ ...formData, config: { ...formData.config, entryPriceMode: v } })}
                  style={{ width: '100%' }}
                >
                  <Select.Option value="ASK">优先用Ask（更容易成交）</Select.Option>
                  <Select.Option value="MID">用Mid（更省滑点）</Select.Option>
                </Select>
              </div>

              <div style={{ width: 240 }}>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>禁止开仓窗口（分钟）</label>
                <Input
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
                  min={0}
                  max={240}
                />
              </div>

              <div style={{ width: 240 }}>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>开仓张数模式</label>
                <Select
                  value={formData.config.positionSizing?.mode || 'FIXED_CONTRACTS'}
                  onChange={(v) =>
                    setFormData({
                      ...formData,
                      config: {
                        ...formData.config,
                        positionSizing: { ...(formData.config.positionSizing || {}), mode: v },
                      },
                    })
                  }
                  style={{ width: '100%' }}
                >
                  <Select.Option value="FIXED_CONTRACTS">固定张数</Select.Option>
                  <Select.Option value="MAX_PREMIUM">最大权利金（USD）</Select.Option>
                </Select>
              </div>

              {formData.config.positionSizing?.mode === 'MAX_PREMIUM' ? (
                <div style={{ width: 240 }}>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>最大权利金（USD）</label>
                  <Input
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
                    min={0}
                  />
                </div>
              ) : (
                <div style={{ width: 240 }}>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>固定张数</label>
                  <Input
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
                    min={1}
                    max={20}
                  />
                </div>
              )}
            </Space>

            <div style={{ marginTop: 12 }}>
              <Alert
                message="费用模型（默认）"
                description="佣金 0.10 USD/张（每单最低0.99） + 平台费 0.30 USD/张。策略会把费用计入资金占用，并在收盘前30分钟强制平仓。"
                type="info"
                showIcon
              />
            </div>
          </div>
        )}
      </form>
      <div style={{ marginTop: 16, textAlign: 'right', borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            form="create-strategy-form"
            htmlType="submit"
            loading={loading}
          >
            创建
          </Button>
        </Space>
      </div>
    </Modal>
  );
}

