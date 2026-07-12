'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';
import SessionStatusBadge from '../components/SessionStatusBadge';
import {
  AccountLabel,
  ADJUSTMENT_DIRECTION_LABEL,
  ADJUSTMENT_STATUS_LABEL,
  accountLabel,
  cashApi,
  CashCountAdjustmentView,
  CashSessionDetail,
  CashVarianceSettingsView,
  closeChecklist,
  computeVariance,
  formatDateOnly,
  formatDateTime,
  formatIqd,
  isZeroMoney,
  mapAdjustVarianceError,
  moneyNum,
  shortId,
} from '../components/session-types';

export default function CashSessionDetailPage() {
  const params = useParams();
  const id = String(params.id || '');
  const [session, setSession] = useState<CashSessionDetail | null>(null);
  const [adjustments, setAdjustments] = useState<CashCountAdjustmentView[]>([]);
  const [varianceSettings, setVarianceSettings] =
    useState<CashVarianceSettingsView | null>(null);
  const [accounts, setAccounts] = useState<AccountLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [countedAmount, setCountedAmount] = useState('');
  const [countNotes, setCountNotes] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [lastPostedEntry, setLastPostedEntry] = useState<{
    id: string;
    number: string | null;
  } | null>(null);

  const [confirmStart, setConfirmStart] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmAdjust, setConfirmAdjust] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadAdjustments = useCallback(async () => {
    if (!id) return;
    const res = await cashApi<CashCountAdjustmentView[]>(
      `/api/accounts/cash-box-sessions/${id}/adjustments`
    );
    if (res.success && res.data) setAdjustments(res.data);
    else setAdjustments([]);
  }, [id]);

  const load = useCallback(
    async (showSpinner = false) => {
      if (!id) return;
      if (showSpinner) setLoading(true);
      const res = await cashApi<CashSessionDetail>(
        `/api/accounts/cash-box-sessions/${id}`
      );
      if (!res.success || !res.data) {
        setError(res.message || 'تعذر تحميل الجلسة');
        setSession(null);
      } else {
        setSession(res.data);
        setError(null);
        if (res.data.current_count) {
          setCountedAmount(res.data.current_count.counted_amount);
        } else if (res.data.current_book_balance != null) {
          setCountedAmount(res.data.current_book_balance);
        }
      }
      await loadAdjustments();
      setLoading(false);
    },
    [id, loadAdjustments]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load(true);
  }, [load]);

  useEffect(() => {
    void (async () => {
      const [vr, opt] = await Promise.all([
        cashApi<CashVarianceSettingsView>(
          '/api/accounts/cash-boxes/settings/variance-accounts'
        ),
        cashApi<{
          posting_accounts?: AccountLabel[];
          eligible_accounts?: AccountLabel[];
        }>('/api/accounts/cash-boxes/options'),
      ]);
      if (vr.success && vr.data) setVarianceSettings(vr.data);
      if (opt.success && opt.data) {
        setAccounts(
          opt.data.posting_accounts || opt.data.eligible_accounts || []
        );
      }
    })();
  }, []);

  const liveVariance = useMemo(() => {
    const book = session?.current_book_balance ?? '0';
    return computeVariance(countedAmount || '0', book);
  }, [countedAmount, session?.current_book_balance]);

  const currentPostedAdj = useMemo(() => {
    const countId = session?.current_count?.id;
    if (!countId) return null;
    return (
      adjustments.find(
        (a) => a.cash_count_id === countId && a.status === 'POSTED'
      ) ?? null
    );
  }, [adjustments, session?.current_count?.id]);

  const checklist = session
    ? closeChecklist(session, currentPostedAdj)
    : { ok: false, items: [] };
  const readOnly = session?.status === 'CLOSED';

  const count = session?.current_count ?? null;
  const hasNonZeroVariance = Boolean(count && !isZeroMoney(count.variance_amount));
  const countDirection = count
    ? computeVariance(count.counted_amount, count.book_balance_at_count)
    : null;
  const varianceSettingsOk = Boolean(
    varianceSettings?.cash_variance_gain_account_id &&
      varianceSettings?.cash_variance_loss_account_id
  );
  const plannedVarianceAccountId =
    countDirection?.isGain
      ? varianceSettings?.cash_variance_gain_account_id
      : countDirection?.isLoss
        ? varianceSettings?.cash_variance_loss_account_id
        : null;

  const canCreateAdjustment =
    session?.status === 'CLOSING' &&
    hasNonZeroVariance &&
    !currentPostedAdj &&
    varianceSettingsOk;

  const cashAccountDisplay = currentPostedAdj
    ? `${currentPostedAdj.cash_account_code || ''} — ${currentPostedAdj.cash_account_name_ar || ''}`.trim()
    : accountLabel(accounts, session?.account_id);
  const varianceAccountDisplay = currentPostedAdj
    ? `${currentPostedAdj.variance_account_code || ''} — ${currentPostedAdj.variance_account_name_ar || ''}`.trim()
    : accountLabel(accounts, plannedVarianceAccountId);

  const postAction = async (
    path: string,
    body: Record<string, unknown>,
    okMessage: string
  ) => {
    if (!session) return false;
    setBusy(true);
    setActionError(null);
    const res = await cashApi(path, {
      method: 'POST',
      body: JSON.stringify({
        ...body,
        version: session.version,
        updated_at: session.updated_at,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذرت العملية');
      return false;
    }
    setSuccess(okMessage);
    await load(false);
    return true;
  };

  const doStartClosing = async () => {
    const ok = await postAction(
      `/api/accounts/cash-box-sessions/${id}/start-closing`,
      {},
      'بدأت عملية الإغلاق — الجلسة الآن قيد الإغلاق'
    );
    if (ok) setConfirmStart(false);
  };

  const doRecordCount = async () => {
    if (!session || busy) return;
    setBusy(true);
    setActionError(null);
    setError(null);
    const res = await cashApi(`/api/accounts/cash-box-sessions/${id}/count`, {
      method: 'POST',
      body: JSON.stringify({
        counted_amount: countedAmount,
        notes: countNotes || undefined,
        version: session.version,
        updated_at: session.updated_at,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر حفظ الجرد');
      return;
    }
    setSuccess(
      liveVariance.isZero
        ? 'تم حفظ الجرد بفرق صفر — يمكن الإغلاق مباشرة'
        : 'تم حفظ الجرد مع فرق — أنشئ قيد التسوية قبل الإغلاق النهائي'
    );
    setCountNotes('');
    await load(false);
  };

  const doAdjustVariance = async () => {
    if (!session || busy) return;
    setBusy(true);
    setActionError(null);
    const res = await cashApi<{
      adjustment: CashCountAdjustmentView;
      created: boolean;
    }>(`/api/accounts/cash-box-sessions/${id}/adjust-variance`, {
      method: 'POST',
      body: JSON.stringify({
        notes: adjustNotes || undefined,
        version: session.version,
        updated_at: session.updated_at,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(mapAdjustVarianceError(res.message));
      return;
    }
    const adj = res.data?.adjustment;
    setConfirmAdjust(false);
    setAdjustNotes('');
    await load(false);
    // رقم القيد من قائمة التسويات بعد التحديث
    const list = await cashApi<CashCountAdjustmentView[]>(
      `/api/accounts/cash-box-sessions/${id}/adjustments`
    );
    const posted =
      list.data?.find((a) => a.id === adj?.id) ||
      list.data?.find((a) => a.cash_count_id === adj?.cash_count_id);
    setLastPostedEntry({
      id: posted?.journal_entry_id || adj?.journal_entry_id || '',
      number: posted?.journal_entry_number || null,
    });
    setSuccess(
      posted?.journal_entry_number
        ? `تم إنشاء وترحيل قيد التسوية بنجاح — رقم القيد ${posted.journal_entry_number}`
        : 'تم إنشاء وترحيل قيد التسوية بنجاح'
    );
  };

  const doClose = async () => {
    const ok = await postAction(
      `/api/accounts/cash-box-sessions/${id}/close`,
      {},
      currentPostedAdj
        ? 'تم إغلاق الجلسة بعد تسوية فرق الجرد'
        : 'تم إغلاق الجلسة بنجاح'
    );
    if (ok) setConfirmClose(false);
  };

  const doCancelClosing = async () => {
    if (!cancelReason.trim()) {
      setActionError('سبب إلغاء الإغلاق مطلوب');
      return;
    }
    const ok = await postAction(
      `/api/accounts/cash-box-sessions/${id}/cancel-closing`,
      { reason: cancelReason.trim() },
      'تم إلغاء الإغلاق وعادت الجلسة إلى مفتوحة'
    );
    if (ok) {
      setConfirmCancel(false);
      setCancelReason('');
    }
  };

  if (loading && !session) {
    return (
      <div className="p-4 md:p-6 space-y-3" dir="rtl">
        <div className="h-8 w-48 bg-gray-200 animate-pulse rounded" />
        <div className="h-40 bg-gray-100 animate-pulse rounded-lg" />
        <div className="h-40 bg-gray-100 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-4 md:p-6" dir="rtl">
        <div className="bg-white border rounded-lg p-6 text-center space-y-3">
          <p className="text-red-800">{error || 'الجلسة غير موجودة'}</p>
          <Link href="/accounts/cashbox/sessions" className="text-red-900 underline text-sm">
            العودة لقائمة الجلسات
          </Link>
        </div>
      </div>
    );
  }

  const anyDialogOpen =
    confirmStart || confirmClose || confirmCancel || confirmAdjust;

  return (
    <div className="p-4 md:p-6 space-y-4" dir="rtl">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 mb-1">
              <Link href="/accounts/cashbox" className="hover:text-red-900">
                الصناديق
              </Link>
              <span>/</span>
              <Link href="/accounts/cashbox/sessions" className="hover:text-red-900">
                الجلسات
              </Link>
              <span>/</span>
              <span className="text-gray-700 font-mono">{shortId(session.id)}</span>
            </div>
            <h1 className="text-xl font-semibold text-gray-900 flex flex-wrap items-center gap-2">
              تفاصيل الجلسة
              <SessionStatusBadge status={session.status} />
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              {session.cash_box_code} — {session.cash_box_name_ar}
            </p>
          </div>
          <button
            type="button"
            className="px-3 py-2 rounded-md border text-sm hover:bg-gray-50"
            disabled={busy}
            onClick={() => void load(true)}
          >
            تحديث
          </button>
        </div>

        {error && (
          <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}
        {success && (
          <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2 space-y-1">
            <div>{success}</div>
            {lastPostedEntry?.id && (
              <div>
                {lastPostedEntry.number && (
                  <span className="font-mono ml-2">{lastPostedEntry.number}</span>
                )}
                <Link
                  href={`/accounts/entries?q=${encodeURIComponent(lastPostedEntry.number || lastPostedEntry.id)}`}
                  className="underline text-green-900"
                >
                  عرض القيد في دفتر القيود
                </Link>
              </div>
            )}
          </div>
        )}
        {actionError && !anyDialogOpen && (
          <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
            {actionError}
          </div>
        )}

        <section className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
          <Info label="رقم الجلسة" value={shortId(session.id)} mono />
          <Info
            label="الأمين"
            value={
              session.primary_custodian_name ||
              session.primary_custodian_username ||
              '—'
            }
          />
          <Info label="السنة" value={session.fiscal_year_code || '—'} />
          <Info label="الفترة" value={session.fiscal_period_code || '—'} />
          <Info label="تاريخ الجلسة" value={formatDateOnly(session.session_date)} />
          <Info label="وقت الفتح" value={formatDateTime(session.opened_at)} />
          <Info label="وقت الإغلاق" value={formatDateTime(session.closed_at)} />
          <Info
            label="الرصيد الافتتاحي"
            value={formatIqd(session.opening_book_balance)}
          />
          <Info
            label="الرصيد الدفتري الحالي"
            value={formatIqd(session.current_book_balance)}
          />
          {session.final_counted_amount != null && (
            <Info
              label="المبلغ المعدود النهائي"
              value={formatIqd(session.final_counted_amount)}
            />
          )}
          {session.final_variance_amount != null && (
            <Info
              label="الفرق النهائي"
              value={formatIqd(session.final_variance_amount)}
            />
          )}
        </section>

        <section className="border border-gray-200 rounded-lg p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">مسار الجلسة</h2>
          <ol className="space-y-2 text-sm">
            <TimelineStep
              done
              title="فتح الجلسة"
              detail={`${formatDateTime(session.opened_at)} · رصيد ${formatIqd(session.opening_book_balance)}`}
            />
            <TimelineStep
              done={Boolean(session.closing_started_at) || session.status !== 'OPEN'}
              title="بدء الإغلاق"
              detail={
                session.closing_started_at
                  ? formatDateTime(session.closing_started_at)
                  : session.status === 'CLOSED'
                    ? 'مكتمل'
                    : 'لم يبدأ'
              }
            />
            <TimelineStep
              done={Boolean(session.current_count) || Boolean(session.final_counted_amount)}
              title="الجرد"
              detail={
                session.current_count
                  ? `معدود ${formatIqd(session.current_count.counted_amount)} · فرق ${formatIqd(session.current_count.variance_amount)}`
                  : session.final_counted_amount
                    ? `نهائي ${formatIqd(session.final_counted_amount)}`
                    : 'لا يوجد جرد حالي'
              }
            />
            <TimelineStep
              done={Boolean(currentPostedAdj)}
              title="تسوية فرق الجرد"
              detail={
                currentPostedAdj
                  ? `${ADJUSTMENT_DIRECTION_LABEL[currentPostedAdj.direction]} · ${formatIqd(currentPostedAdj.variance_amount)}${currentPostedAdj.journal_entry_number ? ` · ${currentPostedAdj.journal_entry_number}` : ''}`
                  : hasNonZeroVariance
                    ? 'مطلوبة قبل الإغلاق'
                    : 'غير مطلوبة (فرق صفر)'
              }
            />
            <TimelineStep
              done={session.status === 'CLOSED'}
              title="الإغلاق النهائي"
              detail={
                session.status === 'CLOSED'
                  ? formatDateTime(session.closed_at)
                  : 'لم يُغلق'
              }
            />
            {session.cancel_closing_reason && session.status === 'OPEN' && (
              <li className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                آخر إلغاء إغلاق: {session.cancel_closing_reason}
              </li>
            )}
          </ol>
        </section>

        {session.current_count && (
          <section className="border border-gray-200 rounded-lg p-4 text-sm space-y-2">
            <h2 className="font-semibold text-gray-900">آخر جرد</h2>
            <div className="grid md:grid-cols-3 gap-2">
              <Info
                label="المبلغ المعدود"
                value={formatIqd(session.current_count.counted_amount)}
              />
              <Info
                label="الرصيد عند الجرد"
                value={formatIqd(session.current_count.book_balance_at_count)}
              />
              <Info
                label="الفرق"
                value={formatIqd(session.current_count.variance_amount)}
              />
              <Info
                label="وقت الجرد"
                value={formatDateTime(session.current_count.counted_at)}
              />
              <Info
                label="التسلسل"
                value={`#${session.current_count.sequence_no}`}
              />
            </div>
            {hasNonZeroVariance && !currentPostedAdj && (
              <div className="text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                يوجد فرق جرد. أنشئ قيد التسوية من القسم أدناه قبل الإغلاق النهائي.
              </div>
            )}
            {currentPostedAdj && (
              <div className="text-green-900 bg-green-50 border border-green-200 rounded px-3 py-2">
                تمت تسوية الفرق — يمكن الإغلاق إذا تطابق الرصيد الدفتري مع المعدود.
              </div>
            )}
          </section>
        )}

        {/* تسوية فرق الجرد */}
        {hasNonZeroVariance && (
          <section className="border border-red-100 bg-red-50/30 rounded-lg p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">تسوية فرق الجرد</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
              <Info
                label="نوع الفرق"
                value={
                  countDirection?.isGain
                    ? 'زيادة'
                    : countDirection?.isLoss
                      ? 'عجز'
                      : '—'
                }
              />
              <Info
                label="المبلغ المعدود"
                value={formatIqd(count!.counted_amount)}
              />
              <Info
                label="الرصيد الدفتري وقت الجرد"
                value={formatIqd(count!.book_balance_at_count)}
              />
              <Info
                label="قيمة الفرق"
                value={formatIqd(
                  currentPostedAdj?.variance_amount ||
                    Math.abs(moneyNum(count!.variance_amount)).toFixed(3)
                )}
              />
              <Info label="حساب الصندوق" value={cashAccountDisplay || '—'} />
              <Info
                label="حساب فرق الجرد"
                value={varianceAccountDisplay || '—'}
              />
              <Info
                label="حالة التسوية"
                value={
                  currentPostedAdj
                    ? ADJUSTMENT_STATUS_LABEL[currentPostedAdj.status]
                    : 'لم تُنشأ'
                }
              />
              {currentPostedAdj?.journal_entry_number && (
                <Info
                  label="رقم قيد التسوية"
                  value={currentPostedAdj.journal_entry_number}
                  mono
                />
              )}
            </div>

            {!varianceSettingsOk && (
              <div className="text-sm text-red-900 bg-red-50 border border-red-200 rounded px-3 py-2">
                إعدادات حسابات فروقات الجرد غير مكتملة.{' '}
                <Link href="/accounts/cashbox" className="underline">
                  راجع إعدادات الصناديق
                </Link>
              </div>
            )}

            {currentPostedAdj?.journal_entry_id && (
              <Link
                href={`/accounts/entries?q=${encodeURIComponent(currentPostedAdj.journal_entry_number || currentPostedAdj.journal_entry_id)}`}
                className="inline-block text-sm text-red-900 underline"
              >
                فتح قيد التسوية في دفتر القيود
              </Link>
            )}

            {canCreateAdjustment && (
              <>
                <label className="block text-sm">
                  <span className="text-gray-700">ملاحظات (اختياري)</span>
                  <textarea
                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-white"
                    rows={2}
                    value={adjustNotes}
                    onChange={(e) => setAdjustNotes(e.target.value)}
                    disabled={busy}
                    placeholder="سبب فرق الجرد إن وُجد"
                  />
                </label>
                <button
                  type="button"
                  className="px-4 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800 disabled:opacity-40"
                  disabled={busy}
                  onClick={() => {
                    setActionError(null);
                    setConfirmAdjust(true);
                  }}
                >
                  إنشاء وترحيل قيد التسوية
                </button>
              </>
            )}
          </section>
        )}

        {session.status === 'OPEN' && (
          <section className="border border-red-100 bg-red-50/40 rounded-lg p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">بدء الإغلاق</h2>
            <p className="text-sm text-gray-700">
              الرصيد الدفتري الحالي:{' '}
              <strong>{formatIqd(session.current_book_balance)}</strong>
            </p>
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800 disabled:opacity-40"
              disabled={busy}
              onClick={() => {
                setActionError(null);
                setConfirmStart(true);
              }}
            >
              بدء الإغلاق
            </button>
          </section>
        )}

        {session.status === 'CLOSING' && (
          <section className="border border-gray-200 rounded-lg p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">تسجيل الجرد</h2>
            <p className="text-sm text-gray-600">
              الرصيد الدفتري:{' '}
              <strong>{formatIqd(session.current_book_balance)}</strong>
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="text-gray-700">مبلغ الجرد</span>
                <input
                  className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                  value={countedAmount}
                  onChange={(e) => setCountedAmount(e.target.value)}
                  inputMode="decimal"
                  disabled={busy}
                />
              </label>
              <div className="text-sm">
                <span className="text-gray-700">الفرق (معدود − دفتري)</span>
                <div
                  className={`mt-1 px-3 py-2 rounded-md border font-medium ${
                    liveVariance.isZero
                      ? 'bg-green-50 border-green-200 text-green-900'
                      : 'bg-amber-50 border-amber-200 text-amber-950'
                  }`}
                >
                  {formatIqd(liveVariance.variance)}
                  {!liveVariance.isZero && (
                    <span className="text-xs font-normal mr-2">
                      ({liveVariance.isGain ? 'زيادة' : 'عجز'})
                    </span>
                  )}
                </div>
              </div>
            </div>
            {!liveVariance.isZero && (
              <div className="text-sm text-amber-950 bg-amber-50 border border-amber-300 rounded px-3 py-2">
                الفرق غير صفري. بعد حفظ الجرد ستحتاج لإنشاء قيد التسوية قبل
                الإغلاق.
              </div>
            )}
            <label className="block text-sm">
              <span className="text-gray-700">ملاحظات</span>
              <textarea
                className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                rows={2}
                value={countNotes}
                onChange={(e) => setCountNotes(e.target.value)}
                disabled={busy}
              />
            </label>
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800 disabled:opacity-40"
              disabled={busy || countedAmount === ''}
              onClick={() => void doRecordCount()}
            >
              {busy ? 'جارٍ الحفظ…' : 'حفظ الجرد'}
            </button>
          </section>
        )}

        {session.status === 'CLOSING' && (
          <section className="border border-gray-200 rounded-lg p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">الإغلاق النهائي</h2>
            <ul className="space-y-2 text-sm">
              {checklist.items.map((item) => (
                <li key={item.label} className="flex items-start gap-2">
                  <span className={item.pass ? 'text-green-700' : 'text-gray-400'}>
                    {item.pass ? '✓' : '○'}
                  </span>
                  <span className={item.pass ? 'text-gray-800' : 'text-gray-500'}>
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
            {!checklist.ok && (
              <p className="text-sm text-gray-600">
                أكمل الشروط أعلاه قبل إغلاق الجلسة.
                {hasNonZeroVariance && !currentPostedAdj
                  ? ' عند وجود فرق غير صفري أنشئ قيد التسوية أولاً.'
                  : ''}
              </p>
            )}
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800 disabled:opacity-40"
              disabled={busy || !checklist.ok}
              onClick={() => {
                setActionError(null);
                setConfirmClose(true);
              }}
            >
              إغلاق الجلسة
            </button>
          </section>
        )}

        {session.status === 'CLOSING' && (
          <section className="border border-amber-200 bg-amber-50/50 rounded-lg p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">إلغاء الإغلاق</h2>
            <p className="text-sm text-gray-600">
              يعيد الجلسة إلى حالة مفتوحة ويتطلب سبباً موثّقاً.
            </p>
            <label className="block text-sm">
              <span className="text-gray-700">سبب الإلغاء</span>
              <textarea
                className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-white"
                rows={2}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                disabled={busy}
                placeholder="مثال: خطأ في العد — إعادة الجرد"
              />
            </label>
            <button
              type="button"
              className="px-4 py-2 rounded-md border border-amber-700 text-amber-950 text-sm hover:bg-amber-100 disabled:opacity-40"
              disabled={busy || !cancelReason.trim()}
              onClick={() => {
                setActionError(null);
                setConfirmCancel(true);
              }}
            >
              إلغاء الإغلاق
            </button>
          </section>
        )}

        {readOnly && (
          <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2">
            الجلسة مغلقة — للعرض فقط.
          </div>
        )}

        {adjustments.length > 0 && (
          <section className="border border-gray-200 rounded-lg p-4 space-y-2">
            <h2 className="text-sm font-semibold text-gray-900">سجل التسويات</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-right px-2 py-1">الاتجاه</th>
                    <th className="text-right px-2 py-1">قيمة الفرق</th>
                    <th className="text-right px-2 py-1">رقم القيد</th>
                    <th className="text-right px-2 py-1">الحالة</th>
                    <th className="text-right px-2 py-1">المنفذ</th>
                    <th className="text-right px-2 py-1">تاريخ التنفيذ</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="px-2 py-1">
                        {ADJUSTMENT_DIRECTION_LABEL[a.direction]}
                      </td>
                      <td className="px-2 py-1">{formatIqd(a.variance_amount)}</td>
                      <td className="px-2 py-1 font-mono text-xs">
                        {a.journal_entry_id ? (
                          <Link
                            href={`/accounts/entries?q=${encodeURIComponent(a.journal_entry_number || a.journal_entry_id)}`}
                            className="text-red-900 underline"
                          >
                            {a.journal_entry_number || shortId(a.journal_entry_id)}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {ADJUSTMENT_STATUS_LABEL[a.status]}
                      </td>
                      <td className="px-2 py-1">
                        {a.posted_by_name || a.created_by_name || '—'}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {formatDateTime(a.posted_at || a.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {(session.counts?.length ?? 0) > 0 && (
          <section className="border border-gray-200 rounded-lg p-4 space-y-2">
            <h2 className="text-sm font-semibold text-gray-900">سجل محاولات الجرد</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-right px-2 py-1">#</th>
                    <th className="text-right px-2 py-1">معدود</th>
                    <th className="text-right px-2 py-1">دفتري</th>
                    <th className="text-right px-2 py-1">فرق</th>
                    <th className="text-right px-2 py-1">الوقت</th>
                    <th className="text-right px-2 py-1">حالي</th>
                  </tr>
                </thead>
                <tbody>
                  {session.counts!.map((c) => (
                    <tr key={c.id} className="border-t">
                      <td className="px-2 py-1">{c.sequence_no}</td>
                      <td className="px-2 py-1">{formatIqd(c.counted_amount)}</td>
                      <td className="px-2 py-1">{formatIqd(c.book_balance_at_count)}</td>
                      <td className="px-2 py-1">{formatIqd(c.variance_amount)}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {formatDateTime(c.counted_at)}
                      </td>
                      <td className="px-2 py-1">{c.is_current ? 'نعم' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirmStart}
        title="تأكيد بدء الإغلاق"
        message="ستنتقل الجلسة إلى حالة قيد الإغلاق. لن يمكن فتح جلسة جديدة لهذا الصندوق حتى تُغلق أو يُلغى الإغلاق."
        confirmLabel="بدء الإغلاق"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmStart(false)}
        onConfirm={() => void doStartClosing()}
      />
      <ConfirmDialog
        open={confirmClose}
        title="تأكيد إغلاق الجلسة"
        message={
          currentPostedAdj
            ? 'سيتم إغلاق الجلسة بعد التحقق من تطابق الرصيد مع المعدود وعدم وجود حركة بعد قيد التسوية.'
            : 'سيتم إغلاق الجلسة نهائياً بعد التحقق من فرق صفر وعدم وجود حركة دفترية بعد الجرد.'
        }
        confirmLabel="إغلاق الجلسة"
        busy={busy}
        error={actionError}
        danger
        onClose={() => setConfirmClose(false)}
        onConfirm={() => void doClose()}
      />
      <ConfirmDialog
        open={confirmCancel}
        title="تأكيد إلغاء الإغلاق"
        message={`سبب الإلغاء: ${cancelReason.trim()}`}
        confirmLabel="إلغاء الإغلاق"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => void doCancelClosing()}
      />
      <ConfirmDialog
        open={confirmAdjust}
        title="تأكيد قيد التسوية"
        message={
          <div className="space-y-2">
            <p>سيتم إنشاء قيد التسوية وترحيله مباشرة.</p>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-gray-800">
              {countDirection?.isGain ? (
                <>
                  <div>
                    من حـ/ حساب الصندوق
                    <div className="text-xs text-gray-500 mt-0.5">
                      {cashAccountDisplay}
                    </div>
                  </div>
                  <div className="mt-2">
                    إلى حـ/ حساب زيادة الجرد
                    <div className="text-xs text-gray-500 mt-0.5">
                      {varianceAccountDisplay}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    من حـ/ حساب عجز الجرد
                    <div className="text-xs text-gray-500 mt-0.5">
                      {varianceAccountDisplay}
                    </div>
                  </div>
                  <div className="mt-2">
                    إلى حـ/ حساب الصندوق
                    <div className="text-xs text-gray-500 mt-0.5">
                      {cashAccountDisplay}
                    </div>
                  </div>
                </>
              )}
              <div className="mt-2 font-medium">
                المبلغ: {formatIqd(Math.abs(moneyNum(count?.variance_amount)).toFixed(3))}
              </div>
            </div>
          </div>
        }
        confirmLabel="إنشاء وترحيل"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmAdjust(false)}
        onConfirm={() => void doAdjustVariance()}
      />
    </div>
  );
}

function Info({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-0.5 text-gray-900 ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function TimelineStep({
  done,
  title,
  detail,
}: {
  done: boolean;
  title: string;
  detail: string;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-xs ${
          done ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-500'
        }`}
      >
        {done ? '✓' : ''}
      </span>
      <div>
        <div className="font-medium text-gray-900">{title}</div>
        <div className="text-xs text-gray-500">{detail}</div>
      </div>
    </li>
  );
}
