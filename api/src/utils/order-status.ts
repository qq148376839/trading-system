// 审计修复: H-12 — 统一 normalizeStatus
// 统一的订单状态标准化工具
// 覆盖 LongPort SDK 所有 OrderStatus 枚举值（数字和字符串形式）

/**
 * LongPort SDK OrderStatus 数字枚举 -> 完整字符串枚举值
 * 参考: https://open.longbridge.com/zh-CN/docs/trade/trade-definition#orderstatus
 *
 * 0  = Unknown
 * 1  = NotReported          (待提交)
 * 2  = ReplacedNotReported  (待提交 — 改单成功)
 * 3  = ProtectedNotReported (待提交 — 保价订单)
 * 4  = VariancesNotReported (待提交 — 条件单)
 * 5  = FilledStatus         (已成交)
 * 6  = WaitToNew            (已提待报)
 * 7  = NewStatus            (已委托)
 * 8  = WaitToReplace        (修改待报)
 * 9  = PendingReplaceStatus (待修改)
 * 10 = ReplacedStatus       (已修改)
 * 11 = PartialFilledStatus  (部分成交)
 * 12 = WaitToCancel         (撤销待报)
 * 13 = PendingCancelStatus  (待撤回)
 * 14 = RejectedStatus       (已拒绝)
 * 15 = CanceledStatus       (已撤单)
 * 16 = ExpiredStatus        (已过期)
 * 17 = PartialWithdrawal    (部分撤单)
 */

const NUMERIC_STATUS_MAP: Record<number, string> = {
  0:  'Unknown',
  1:  'NotReported',
  2:  'ReplacedNotReported',
  3:  'ProtectedNotReported',
  4:  'VariancesNotReported',
  5:  'FilledStatus',
  6:  'WaitToNew',
  7:  'NewStatus',
  8:  'WaitToReplace',
  9:  'PendingReplaceStatus',
  10: 'ReplacedStatus',
  11: 'PartialFilledStatus',
  12: 'WaitToCancel',
  13: 'PendingCancelStatus',
  14: 'RejectedStatus',
  15: 'CanceledStatus',
  16: 'ExpiredStatus',
  17: 'PartialWithdrawal',
};

/**
 * 完整字符串枚举值 -> 归一化显示名称
 * 将 SDK 返回的各种形式统一为简洁的显示名称
 */
const DISPLAY_NAME_MAP: Record<string, string> = {
  // 完整形式 (SDK 枚举名称)
  'Unknown':              'Unknown',
  'NotReported':          'NotReported',
  'ReplacedNotReported':  'ReplacedNotReported',
  'ProtectedNotReported': 'ProtectedNotReported',
  'VariancesNotReported': 'VariancesNotReported',
  'VarietiesNotReported': 'VariancesNotReported', // 兼容旧拼写
  'FilledStatus':         'Filled',
  'WaitToNew':            'WaitToNew',
  'NewStatus':            'New',
  'WaitToReplace':        'WaitToReplace',
  'PendingReplaceStatus': 'PendingReplace',
  'ReplacedStatus':       'Replaced',
  'PartialFilledStatus':  'PartialFilled',
  'WaitToCancel':         'WaitToCancel',
  'PendingCancelStatus':  'PendingCancel',
  'RejectedStatus':       'Rejected',
  'CanceledStatus':       'Cancelled',
  'CancelledStatus':      'Cancelled', // 兼容英式拼写
  'ExpiredStatus':        'Expired',
  'PartialWithdrawal':    'PartialWithdrawal',

  // 简写形式 (可能来自上层传参或简化输入)
  'Filled':               'Filled',
  'New':                  'New',
  'PartialFilled':        'PartialFilled',
  'Canceled':             'Cancelled',
  'Cancelled':            'Cancelled',
  'Rejected':             'Rejected',
  'Expired':              'Expired',
  'PendingCancel':        'PendingCancel',
  'PendingReplace':       'PendingReplace',
  'Replaced':             'Replaced',
};

/**
 * 简写 / 归一化显示名称 -> 完整 SDK 枚举名称（反向映射）
 * 用于将简写形式转回 SDK 完整形式
 */
const TO_SDK_NAME_MAP: Record<string, string> = {
  'Unknown':              'Unknown',
  'NotReported':          'NotReported',
  'ReplacedNotReported':  'ReplacedNotReported',
  'ProtectedNotReported': 'ProtectedNotReported',
  'VariancesNotReported': 'VariancesNotReported',
  'Filled':               'FilledStatus',
  'WaitToNew':            'WaitToNew',
  'New':                  'NewStatus',
  'WaitToReplace':        'WaitToReplace',
  'PendingReplace':       'PendingReplaceStatus',
  'Replaced':             'ReplacedStatus',
  'PartialFilled':        'PartialFilledStatus',
  'WaitToCancel':         'WaitToCancel',
  'PendingCancel':        'PendingCancelStatus',
  'Rejected':             'RejectedStatus',
  'Canceled':             'CanceledStatus',
  'Cancelled':            'CanceledStatus', // 统一为美式拼写（与现有代码库一致）
  'Expired':              'ExpiredStatus',
  'PartialWithdrawal':    'PartialWithdrawal',
};

/**
 * 统一标准化订单状态
 *
 * 将 LongPort SDK 返回的各种状态形式（数字枚举、完整字符串、简写字符串）
 * 统一转换为完整的 SDK 枚举名称（如 'FilledStatus', 'NewStatus' 等）。
 *
 * 注意: 取消状态统一返回 'CanceledStatus'（美式拼写），与现有代码库保持一致。
 *
 * @param status - 数字枚举值、字符串枚举名称或简写名称
 * @returns 完整的 SDK 枚举名称（如 'FilledStatus'）
 */
export function normalizeOrderStatus(status: string | number | null | undefined): string {
  if (status === null || status === undefined) return 'Unknown';

  // ---- 数字 ----
  if (typeof status === 'number') {
    return NUMERIC_STATUS_MAP[status] ?? 'Unknown';
  }

  // ---- 字符串 ----
  if (typeof status === 'string') {
    // 纯数字字符串（如 "5", "14"）
    const num = parseInt(status, 10);
    if (!isNaN(num) && status === num.toString()) {
      return NUMERIC_STATUS_MAP[num] ?? 'Unknown';
    }

    // 如果已经是完整的 SDK 枚举名称，直接返回
    // 包含 'Status', 'Reported', 'WaitTo', 'Withdrawal' 等关键词的即为完整形式
    if (
      status.includes('Status') ||
      status.includes('Reported') ||
      status.includes('WaitTo') ||
      status === 'PartialWithdrawal' ||
      status === 'Unknown'
    ) {
      // 统一英式拼写 CancelledStatus -> CanceledStatus（与现有代码库一致）
      if (status === 'CancelledStatus') return 'CanceledStatus';
      return status;
    }

    // 简写形式 -> 完整 SDK 枚举名称
    const sdkName = TO_SDK_NAME_MAP[status];
    if (sdkName) return sdkName;

    // 兼容不区分大小写的情况
    const lower = status.toLowerCase();
    if (lower === 'filled') return 'FilledStatus';
    if (lower === 'new') return 'NewStatus';
    if (lower === 'cancelled' || lower === 'canceled') return 'CanceledStatus';
    if (lower === 'rejected') return 'RejectedStatus';
    if (lower === 'expired') return 'ExpiredStatus';
    if (lower === 'partialfilled') return 'PartialFilledStatus';

    // 无法识别 — 返回原始值（不丢弃信息）
    return status;
  }

  return 'Unknown';
}

/**
 * 将订单状态转换为归一化显示名称
 *
 * 先通过 normalizeOrderStatus 统一为 SDK 枚举名称，
 * 再映射为简洁的显示名称（如 'Filled', 'New', 'Cancelled' 等）。
 *
 * @param status - 任意形式的订单状态
 * @returns 归一化显示名称
 */
export function normalizeOrderStatusDisplay(status: string | number | null | undefined): string {
  const sdkName = normalizeOrderStatus(status);
  return DISPLAY_NAME_MAP[sdkName] ?? sdkName;
}

// ---------------------------------------------------------------------------
// 状态分组 helpers
// ---------------------------------------------------------------------------

/** 终态状态集合（订单不会再变化） */
const TERMINAL_STATUSES = new Set([
  'Filled',
  'Cancelled',
  'Rejected',
  'Expired',
  // 也接受完整 SDK 名称
  'FilledStatus',
  'CanceledStatus',
  'CancelledStatus',
  'RejectedStatus',
  'ExpiredStatus',
]);

/** 活跃状态集合（订单仍可变化） */
const ACTIVE_STATUSES = new Set([
  'New',
  'PendingCancel',
  'PartialFilled',
  'WaitToNew',
  'WaitToCancel',
  'WaitToReplace',
  'PendingReplace',
  'Replaced',
  'NotReported',
  'ReplacedNotReported',
  'ProtectedNotReported',
  'VariancesNotReported',
  'PartialWithdrawal',
  // 也接受完整 SDK 名称
  'NewStatus',
  'PendingCancelStatus',
  'PartialFilledStatus',
  'PendingReplaceStatus',
  'ReplacedStatus',
]);

/**
 * 判断订单是否处于终态（Filled / Cancelled / Rejected / Expired）
 *
 * 接受归一化显示名称或完整 SDK 枚举名称。
 */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * 判断订单是否处于活跃状态（New / PendingCancel / PartialFilled 等）
 *
 * 接受归一化显示名称或完整 SDK 枚举名称。
 */
export function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}
