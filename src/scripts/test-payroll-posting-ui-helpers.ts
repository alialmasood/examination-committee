/**
 * اختبارات وحدات لمساعدات واجهة ترحيل الرواتب 9.C.2 — بلا RTL.
 * npm run test:payroll-posting-ui-helpers
 *
 * يغطي: postingErrorMsg و CAP.POST و shortApprovalHashDisplay و runPostUrl و postingButtonVisibility و can().
 * لا يُعتبر بديلاً عن React Testing Library / فحص متصفح بصري.
 */
import {
  CAP,
  can,
  postingButtonVisibility,
  postingErrorMsg,
  runPostUrl,
  shortApprovalHashDisplay,
} from '../../app/accounts/payroll/_lib';

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function it(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed += 1;
    process.exitCode = 1;
    console.error(`✗ ${name}`, e instanceof Error ? e.message : e);
  }
}

console.log('===== اختبارات مساعدات واجهة الترحيل 9.C.2 (وحدات) =====');

it('1) CAP.POST = payroll_post', () => {
  assert(CAP.POST === 'payroll_post', CAP.POST);
});

it('2) can() يتحقق من وجود الصلاحية', () => {
  assert(can([CAP.POST, CAP.VIEW], CAP.POST), 'has post');
  assert(!can([CAP.APPROVE], CAP.POST), 'no post');
  assert(!can(null, CAP.POST), 'null caps');
});

it('3) runPostUrl', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert(runPostUrl(id) === `/api/accounts/payroll/runs/${id}/post`, 'url');
});

it('4) shortApprovalHashDisplay يختصر الهاش الطويل', () => {
  const h = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const s = shortApprovalHashDisplay(h);
  assert(s.includes('…'), s);
  assert(s.startsWith('01234567'), s);
  assert(s.endsWith('9abcdef') || s.endsWith('abcdef'), s);
});

it('5) shortApprovalHashDisplay للقيم الفارغة/المختصرة', () => {
  assert(shortApprovalHashDisplay(null) === '—', 'null');
  assert(shortApprovalHashDisplay('abcd…xyz') === 'abcd…xyz', 'pre');
});

it('6) postingErrorMsg — 403', () => {
  assert(postingErrorMsg({ __status: 403 }).includes('صلاحية'), '403');
});

it('7) postingErrorMsg — ALREADY_POSTED', () => {
  assert(
    postingErrorMsg({ error: { code: 'PAYROLL_ALREADY_POSTED' } }).length > 0,
    'posted'
  );
});

it('8) postingErrorMsg — mapping / rounding / technical', () => {
  assert(
    postingErrorMsg({ error: { code: 'PAYROLL_GL_MAPPING_MISSING' } }).length > 0,
    'map'
  );
  assert(
    postingErrorMsg({ error: { code: 'PAYROLL_ROUNDING_EXCEEDED' } }).length > 0,
    'round'
  );
  assert(
    postingErrorMsg({ __status: 500, error: { code: 'TECHNICAL_FAILURE' } }).length > 0,
    '500'
  );
});

it('9) postingButtonVisibility — مفعّل عند APPROVED + cap + readiness', () => {
  const v = postingButtonVisibility({
    canPostCap: true,
    isApproved: true,
    isPosted: false,
    can_post: true,
    readiness: true,
  });
  assert(v.showEnabled && !v.showDisabled && !v.hidden, JSON.stringify(v));
});

it('10) postingButtonVisibility — معطّل عند blockers', () => {
  const v = postingButtonVisibility({
    canPostCap: true,
    isApproved: true,
    isPosted: false,
    can_post: false,
    readiness: false,
  });
  assert(!v.showEnabled && v.showDisabled, JSON.stringify(v));
});

it('11) postingButtonVisibility — مخفي عند غياب صلاحية أو بعد POSTED', () => {
  const noCap = postingButtonVisibility({
    canPostCap: false,
    isApproved: true,
    isPosted: false,
  });
  assert(noCap.hidden, 'no cap');
  const posted = postingButtonVisibility({
    canPostCap: true,
    isApproved: false,
    isPosted: true,
  });
  assert(posted.hidden, 'posted');
});

it('12) postingButtonVisibility — يخفي التفعيل أثناء posting', () => {
  const v = postingButtonVisibility({
    canPostCap: true,
    isApproved: true,
    isPosted: false,
    can_post: true,
    readiness: true,
    postingBusy: true,
  });
  assert(!v.showEnabled, 'busy');
});

console.log(`===== النتيجة: ${passed} نجح / ${failed} فشل =====`);
console.log(
  'ملاحظة: لا ادّعاء RTL — فحص مساعدات نقية فقط. التغطية HTTP في test:payroll-posting-integration.'
);