/**
 * حقن الأعطال للاختبار الذري (atomicity) — 8.A.
 * يُفعَّل عبر متغير البيئة ACCOUNTS_FAULT_INJECTION (نقطة واحدة في كل مرة)
 * أو برمجياً في الاختبارات عبر setFixedAssetFaultForTests.
 *
 * نقاط الأعطال المدعومة:
 *  asset_activate_after_journal, asset_activate_after_status,
 *  movement_after_location, movement_after_status,
 *  dep_after_journal, dep_after_first_asset, dep_after_all_assets, dep_after_run_status,
 *  disposal_after_voucher, disposal_after_journal,
 *  disposal_after_asset_status, disposal_after_disposal_status
 */
export type FixedAssetFaultPoint =
  | 'asset_activate_after_journal'
  | 'asset_activate_after_status'
  | 'movement_after_location'
  | 'movement_after_status'
  | 'dep_after_journal'
  | 'dep_after_first_asset'
  | 'dep_after_all_assets'
  | 'dep_after_run_status'
  | 'disposal_after_voucher'
  | 'disposal_after_journal'
  | 'disposal_after_asset_status'
  | 'disposal_after_disposal_status';

let __override: string | null = null;

/** للاختبارات: يضبط نقطة العطل يدوياً (يتجاوز متغير البيئة). مرّر null للإلغاء. */
export function setFixedAssetFaultForTests(point: FixedAssetFaultPoint | null): void {
  __override = point;
}

function activeFault(): string | null {
  if (__override != null) return __override;
  const env = process.env.ACCOUNTS_FAULT_INJECTION;
  return env && env.trim() ? env.trim() : null;
}

/** يرمي خطأً إن كانت نقطة العطل الحالية مطابقة. */
export function maybeFault(point: FixedAssetFaultPoint): void {
  if (activeFault() === point) {
    throw new Error(`FAULT_INJECTION:${point}`);
  }
}
