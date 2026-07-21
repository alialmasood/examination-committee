/**
 * اختبارات تكامل API سجل اعتماد الرواتب 9.B.4 — بلا RTL.
 * npm run test:payroll-approval-history-integration
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { GET as historyGet } from '../../app/api/accounts/payroll/runs/[id]/approval-history/route';
import {
  CAP,
  approvalHistoryActionBadge,
  approvalStatusTransitionLabel,
  runApprovalHistoryUrl,
  shortApprovalHashDisplay,
} from '../../app/accounts/payroll/_lib';
import { generateAccessToken } from '../lib/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import { createPayrollCalendar } from '../lib/accounts/payroll-calendars';
import { createPayrollPeriod } from '../lib/accounts/payroll-periods';
import { createPayrollRun } from '../lib/accounts/payroll-runs';
import {
  PAYROLL_CAPABILITIES,
  __clearPayrollCapabilitiesOverrideForTests,
  __setPayrollCapabilitiesOverrideForTests,
} from '../lib/accounts/payroll-access';
import { withTransaction } from '../lib/accounts/with-transaction';
import { closePool, query } from '../lib/db';

let passed = 0;
let failed = 0;
const owned = { calendars: [] as string[], periods: [] as string[], runs: [] as string[] };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const snapshot = hash('history-snapshot');
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function it(name: string, fn: () => Promise<void>) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); }
  catch (error) { failed += 1; process.exitCode = 1; console.error(`❌ ${name}`, error); }
  finally { __clearPayrollCapabilitiesOverrideForTests(); }
}
function request(runId: string, userId: string, username: string, queryString = '') {
  const token = generateAccessToken(userId, username);
  return historyGet(
    new NextRequest(`http://localhost/api/accounts/payroll/runs/${runId}/approval-history${queryString}`, {
      headers: { cookie: `access_token=${token}` },
    }),
    { params: Promise.resolve({ id: runId }) }
  );
}
async function user(username: string) {
  const password_hash = await bcrypt.hash('history-integration-password', 10);
  const result = await query(
    `INSERT INTO student_affairs.users(username,email,full_name,password_hash,is_active)
     VALUES($1,$2,$3,$4,TRUE)
     ON CONFLICT(username) DO UPDATE SET full_name=EXCLUDED.full_name,is_active=TRUE
     RETURNING id::text`,
    [username, `${username}@test.local`, `مستخدم ${username}`, password_hash]
  );
  const id = result.rows[0].id as string;
  await query(
    `INSERT INTO student_affairs.user_systems(user_id,system_id)
     SELECT $1::uuid,id FROM student_affairs.systems WHERE code='ACCOUNTS'
     ON CONFLICT DO NOTHING`, [id]
  );
  return id;
}
async function action(runId: string, periodId: string, actorId: string | null, n: number, over: Record<string, unknown> = {}) {
  const actionName = String(over.action ?? (n % 3 === 0 ? 'REJECTED' : n % 3 === 1 ? 'SUBMITTED_FOR_REVIEW' : 'APPROVED'));
  const createdAt = String(over.created_at ?? `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`);
  await query(
    `INSERT INTO accounts.payroll_run_approval_actions
      (payroll_run_id,payroll_period_id,approval_cycle,action,from_status,to_status,actor_id,
       actor_display_name_snapshot,comment,reason,snapshot_hash,version_before,version_after,
       request_key_hash,request_payload_hash,request_key_masked,created_at)
     VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8,$9,$10,$11,$12,$13,$14,$15,'test…key',$16::timestamptz)`,
    [runId, periodId, Number(over.approval_cycle ?? 1), actionName,
      over.from_status ?? 'CALCULATED', over.to_status ?? 'UNDER_REVIEW', actorId,
      over.actor_display_name_snapshot ?? `لقطة ${n}`, over.comment ?? null, over.reason ?? null,
      over.snapshot_hash ?? snapshot, n, n + 1, hash(`key-${runId}-${n}`), hash(`payload-${runId}-${n}`), createdAt]
  );
}
async function cleanup() {
  if (owned.runs.length) {
    await query(`DELETE FROM accounts.payroll_run_approval_actions WHERE payroll_run_id=ANY($1::uuid[])`, [owned.runs]);
    await query(`DELETE FROM accounts.financial_audit_log WHERE entity_type='payroll_run' AND entity_id=ANY($1::uuid[])`, [owned.runs]);
    await query(`DELETE FROM accounts.payroll_runs WHERE id=ANY($1::uuid[])`, [owned.runs]);
  }
  if (owned.periods.length) await query(`DELETE FROM accounts.payroll_periods WHERE id=ANY($1::uuid[])`, [owned.periods]);
  if (owned.calendars.length) await query(`DELETE FROM accounts.payroll_calendars WHERE id=ANY($1::uuid[])`, [owned.calendars]);
}

async function main() {
  const suffix = Date.now().toString(36);
  const adminName = `test-history-admin-${suffix}`;
  const clerkName = `test-history-clerk-${suffix}`;
  const adminId = await user(adminName);
  const clerkId = await user(clerkName);
  await grantAccountsAdminRole(adminId);
  const fy = await query(`SELECT id::text FROM accounts.fiscal_years WHERE status='ACTIVE' ORDER BY is_default DESC LIMIT 1`);
  assert(fy.rows[0], 'لا توجد سنة مالية نشطة');
  const cal = await withTransaction((c) => createPayrollCalendar(c, {
    code: `HIST-${suffix}`, name_ar: 'تقويم اختبار التاريخ', calendar_type: 'MONTHLY',
    currency_code: 'IQD', effective_from: '2026-01-01', created_by: adminId,
  }));
  owned.calendars.push(cal.id);
  const period = await withTransaction((c) => createPayrollPeriod(c, {
    payroll_calendar_id: cal.id, name_ar: 'فترة اختبار التاريخ', start_date: '2026-01-01',
    end_date: '2026-01-31', fiscal_year_id: fy.rows[0].id, created_by: adminId,
  }));
  owned.periods.push(period.id);
  const run = await withTransaction((c) => createPayrollRun(c, {
    payroll_period_id: period.id, run_type: 'REGULAR', scope_type: 'PERSON_LIST', created_by: adminId,
  }));
  owned.runs.push(run.id);

  try {
    await it('1) UI: capability history مطابقة', async () => assert(CAP.VIEW_APPROVAL_HISTORY === PAYROLL_CAPABILITIES.VIEW_APPROVAL_HISTORY, 'CAP'));
    await it('2) UI: مسار history صحيح', async () => assert(runApprovalHistoryUrl(run.id).endsWith(`/runs/${run.id}/approval-history`), 'path'));
    await it('3) UI: badge الإجراء عربي', async () => assert(approvalHistoryActionBadge('APPROVED').includes('معتمد'), 'badge'));
    await it('4) UI: انتقال الحالة عربي', async () => assert(approvalStatusTransitionLabel('CALCULATED', 'UNDER_REVIEW').includes('→'), 'transition'));
    await it('5) UI: hash مختصر', async () => assert(shortApprovalHashDisplay(snapshot).length < snapshot.length, 'short hash'));
    await it('6) نجاح authorized وحالة 200', async () => assert((await request(run.id, adminId, adminName)).status === 200, '200'));
    await it('7) سجل فارغ', async () => { const b = await (await request(run.id, adminId, adminName)).json(); assert(b.history.total === 0, 'empty'); });
    await action(run.id, period.id, adminId, 1, { action: 'SUBMITTED_FOR_REVIEW', comment: 'إرسال <b>نصي</b>' });
    await it('8) submit فقط', async () => { const b = await (await request(run.id, adminId, adminName)).json(); assert(b.history.items[0].action === 'SUBMITTED_FOR_REVIEW', 'submit'); });
    await it('9) التعليق يظهر كنص JSON', async () => { const r = await request(run.id, adminId, adminName); assert(r.headers.get('content-type')?.includes('application/json'), 'json'); assert(JSON.stringify(await r.json()).includes('<b>نصي</b>'), 'plain'); });
    await action(run.id, period.id, clerkId, 2, { action: 'REJECTED', from_status: 'UNDER_REVIEW', to_status: 'CALCULATED', reason: 'سبب رفض واضح يظهر للمراجع' });
    await it('10) submit ثم reject', async () => { const b = await (await request(run.id, adminId, adminName)).json(); assert(b.history.total === 2 && b.history.items.some((x: any) => x.action === 'REJECTED'), 'reject'); });
    await action(run.id, period.id, adminId, 3, { action: 'SUBMITTED_FOR_REVIEW', approval_cycle: 2 });
    await action(run.id, period.id, clerkId, 4, { action: 'APPROVED', approval_cycle: 2, from_status: 'UNDER_REVIEW', to_status: 'APPROVED', comment: 'اعتماد نهائي' });
    await it('11) دورتان ظاهرتان', async () => { const b = await (await request(run.id, adminId, adminName)).json(); assert(new Set(b.history.items.map((x: any) => x.approval_cycle)).size === 2, 'cycles'); });
    await it('12) الاعتماد النهائي ظاهر', async () => { const b = await (await request(run.id, adminId, adminName)).json(); assert(b.history.items[0].action === 'APPROVED', 'approved'); });
    await it('13) ترتيب DESC', async () => { const b = await (await request(run.id, adminId, adminName)).json(); assert(b.history.items[0].created_at >= b.history.items[1].created_at, 'desc'); });
    await action(run.id, period.id, adminId, 5, {
      action: 'SUBMITTED_FOR_REVIEW', approval_cycle: 3, created_at: '2026-01-02T00:00:00Z',
    });
    await action(run.id, period.id, adminId, 6, {
      action: 'REJECTED', approval_cycle: 3, from_status: 'UNDER_REVIEW', to_status: 'CALCULATED',
      reason: 'رفض الدورة الثالثة لاختبار الترتيب', created_at: '2026-01-02T00:00:00Z',
    });
    await it('14) ترتيب timestamp متساوٍ محدد بالـ id', async () => { const b = await (await request(run.id, adminId, adminName)).json(); const same = b.history.items.filter((x: any) => x.created_at === b.history.items[0].created_at); assert(same.length >= 2 && same[0].id > same[1].id, 'id desc'); });
    await it('15) pagination page/page_size', async () => { const b = await (await request(run.id, adminId, adminName, '?page=2&page_size=2')).json(); assert(b.history.page === 2 && b.history.items.length === 2, 'page'); });
    await it('16) page غير صالح 400', async () => assert((await request(run.id, adminId, adminName, '?page=0')).status === 400, 'page'));
    await it('17) page_size غير صالح 400', async () => assert((await request(run.id, adminId, adminName, '?page_size=bad')).status === 400, 'size'));
    await it('18) page_size الأقصى 100', async () => { const b = await (await request(run.id, adminId, adminName, '?page_size=999')).json(); assert(b.history.page_size === 100, 'max'); });
    await it('19) بلا capability → 403', async () => { __setPayrollCapabilitiesOverrideForTests(clerkId, [PAYROLL_CAPABILITIES.VIEW]); assert((await request(run.id, clerkId, clerkName)).status === 403, '403'); });
    await it('20) IDOR عشوائي → 404', async () => assert((await request(randomUUID(), adminId, adminName)).status === 404, '404'));
    await it('21) تشغيل مفقود → 404', async () => assert((await request(randomUUID(), adminId, adminName)).status === 404, '404'));
    await it('22) actor fallback إلى اللقطة', async () => { await action(run.id, period.id, null, 7, { approval_cycle: 4, actor_display_name_snapshot: 'فاعل سابق' }); const b = await (await request(run.id, adminId, adminName)).json(); assert(b.history.items.some((x: any) => x.actor.display_name === 'فاعل سابق'), 'fallback'); });
    await it('23) reason/comment ظاهران', async () => { const b = await (await request(run.id, adminId, adminName)).json(); assert(JSON.stringify(b).includes('سبب رفض واضح') && JSON.stringify(b).includes('اعتماد نهائي'), 'text'); });
    await it('24) البصمة مختصرة فقط', async () => { const b = await (await request(run.id, adminId, adminName)).json(); assert(b.history.items[0].snapshot_hash_short.includes('…') && !JSON.stringify(b).includes(`"snapshot_hash":"${snapshot}"`), 'hash'); });
    await it('25) hashes/metadata/snapshot_json غائبة', async () => { const text = JSON.stringify(await (await request(run.id, adminId, adminName)).json()); for (const key of ['request_key_hash','request_payload_hash','metadata_json','snapshot_json']) assert(!text.includes(key), key); });
    await it('26) blocked/failed audit غير مدرج', async () => { await query(`INSERT INTO accounts.financial_audit_log(user_id,action,entity_type,entity_id,description) VALUES($1::uuid,'payroll_run.approval_blocked','payroll_run',$2::uuid,'blocked')`, [adminId, run.id]); const b = await (await request(run.id, adminId, adminName)).json(); assert(!JSON.stringify(b).includes('approval_blocked'), 'excluded'); });
    await it('27) حقول حساسة غائبة', async () => { const item = (await (await request(run.id, adminId, adminName)).json()).history.items[0]; assert(!('request_key_masked' in item) && !('metadata_json' in item), 'sensitive'); });
  } finally {
    await cleanup();
    const left = await query(`SELECT COUNT(*)::int n FROM accounts.payroll_runs WHERE id=ANY($1::uuid[])`, [owned.runs]);
    await it('28) cleanup صفر', async () => assert(Number(left.rows[0]?.n) === 0, 'leftovers'));
    console.log(`===== النتيجة: ${passed} ناجح / ${failed} فاشل =====`);
    await closePool();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
