/** بيانات استمارة التقديم للطباعة والعرض العام */

export type ApplicationSnapshot = {
  personalData: {
    fullName: string;
    nickname: string;
    motherName: string;
    nationalId: string;
    birthDate: string;
    birthPlace: string;
    area: string;
    gender: string;
    religion: string;
    maritalStatus: string;
    phone: string;
    email: string;
  };
  secondaryEducation: {
    schoolName: string;
    schoolType: string;
    graduationYear: string;
    gpa: string;
    totalScore: string;
    examAttempt: string;
    examNumber: string;
    examPassword: string;
    branch: string;
  };
  universityAdmission: {
    admissionType: string;
    admissionChannel: string;
    department: string;
    studyType: string;
    level: string;
    semester: string;
    academicYear: string;
  };
  documents: Record<string, boolean | string>;
  departmentPreferences?: {
    first: string;
    second: string;
    third: string;
  };
  createdAt?: string;
};

export function labelGender(v: string) {
  return v === 'male' ? 'ذكر' : v === 'female' ? 'أنثى' : v || '—';
}

export function labelMarital(v: string) {
  const map: Record<string, string> = {
    single: 'أعزب',
    married: 'متزوج',
    divorced: 'مطلق',
    widowed: 'أرمل',
  };
  return map[v] || v || '—';
}

export function labelSchoolType(v: string) {
  const map: Record<string, string> = {
    public: 'حكومية',
    private: 'أهلية',
    international: 'دولية',
  };
  return map[v] || v || '—';
}

export function labelExamAttempt(v: string) {
  const map: Record<string, string> = {
    first: 'الأول',
    second: 'الثاني',
    third: 'الثالث',
  };
  return map[v] || v || '—';
}

export function labelAdmissionType(v: string) {
  const map: Record<string, string> = {
    first: 'الأولى',
    second: 'الثانية',
    third: 'الثالثة',
    fourth: 'الرابعة',
  };
  return map[v] || v || '—';
}

export function labelAdmissionChannel(v: string) {
  const map: Record<string, string> = {
    general: 'القناة العامة',
    martyrs: 'ذوي الشهداء',
    social_care: 'الرعاية الاجتماعية',
    special_needs: 'ذوي الهمم',
    political_prisoners: 'السجناء السياسيين',
    siblings_married: 'تخفيض الاخوة والمتزوجين',
    minister_directive: 'توجيهات الوزير',
    dean_approval: 'موافقة العميد',
    faculty_children: 'ابناء الهيئة التدريسية',
    top_students: 'الاوائل',
    health_ministry: 'موظفي وزارة الصحة',
  };
  return map[v] || v || '—';
}

export function labelStudyType(v: string) {
  return v === 'morning' ? 'صباحي' : v === 'evening' ? 'مسائي' : v || '—';
}

export function labelLevel(v: string) {
  const map: Record<string, string> = {
    bachelor: 'بكالوريوس',
    master: 'ماجستير',
    phd: 'دكتوراه',
    diploma: 'دبلوم',
  };
  return map[v] || v || '—';
}

export function labelSemester(v: string) {
  return v === 'first' ? 'الأول' : v === 'second' ? 'الثاني' : v || '—';
}

const DOC_LABELS: Record<string, string> = {
  nationalIdFront: 'البطاقة الوطنية (وجه 1)',
  nationalIdBack: 'البطاقة الوطنية (وجه 2)',
  residenceCardFront: 'بطاقة السكن (وجه 1)',
  residenceCardBack: 'بطاقة السكن (وجه 2)',
  secondaryCertificate: 'وثيقة الإعدادية',
  personalPhoto: 'الصورة الشخصية',
  medicalExamination: 'الفحص الطبي',
};

function row(label: string, value: string) {
  return `<div class="field"><span class="lbl">${label}</span><span class="val">${value || '—'}</span></div>`;
}

function section(title: string, fieldsHtml: string) {
  return `<section class="sec"><h2>${title}</h2><div class="grid">${fieldsHtml}</div></section>`;
}

export type PrintMode = 'full' | 'codes';

export function buildApplicationPrintHtml(opts: {
  snapshot: ApplicationSnapshot;
  code: string;
  publicUrl: string;
  mode: PrintMode;
  autoPrint?: boolean;
  logoUrl?: string;
}): string {
  const { snapshot: s, code, publicUrl: publicUrlRaw, mode, autoPrint = true } = opts;
  const p = s.personalData;
  const se = s.secondaryEducation;
  const u = s.universityAdmission;

  const normalizedCode = String(code || '').trim().toUpperCase();
  // عند الطباعة من المتصفح استخدم نطاق الصفحة الحالية دائماً (يتجنب أخطاء SITE_URL)
  let publicUrl = String(publicUrlRaw || '').trim();
  if (typeof window !== 'undefined') {
    publicUrl = `${window.location.origin}/public/application/${normalizedCode}`;
  } else if (
    !publicUrl ||
    publicUrl.startsWith('/') ||
    /localhost|127\.0\.0\.1/i.test(publicUrl) ||
    !/^https?:\/\//i.test(publicUrl)
  ) {
    publicUrl = `/public/application/${normalizedCode}`;
  }

  const barcodeImg = `https://barcode.tec-it.com/barcode.ashx?data=${encodeURIComponent(normalizedCode)}&code=Code128&dpi=150&translate-esc=off`;
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&ecc=M&data=${encodeURIComponent(publicUrl)}`;
  const logoUrl =
    opts.logoUrl ||
    (typeof window !== 'undefined'
      ? `${window.location.origin}/logos/college-logo.png`
      : '/logos/college-logo.png');

  const formHeader = `
      <header class="hdr">
        <div class="hdr-top">
          <div class="hdr-side hdr-right">
            <div class="college-name">كلية الشرق التقنية التخصصية</div>
            <div class="college-unit">شؤون الطلبة والتسجيل</div>
          </div>
          <div class="hdr-logo">
            <img src="${logoUrl}" alt="شعار الكلية" />
          </div>
          <div class="hdr-side hdr-left">
            <div class="meta-line">رمز الاستمارة: <strong dir="ltr">${normalizedCode}</strong></div>
            <div class="meta-line">السنة: <strong>${u.academicYear || '—'}</strong></div>
          </div>
        </div>
        <h1 class="form-title">استمارة تسجيل الطالب</h1>
      </header>
  `;

  const codesHeader = `
      <header class="hdr">
        <div class="hdr-top">
          <div class="hdr-side hdr-right">
            <div class="college-name">كلية الشرق التقنية التخصصية</div>
            <div class="college-unit">شؤون الطلبة والتسجيل</div>
          </div>
          <div class="hdr-logo">
            <img src="${logoUrl}" alt="شعار الكلية" />
          </div>
          <div class="hdr-side hdr-left">
            <div class="meta-line">رمز الاستمارة: <strong dir="ltr">${normalizedCode}</strong></div>
            <div class="meta-line">السنة: <strong>${u.academicYear || '—'}</strong></div>
          </div>
        </div>
        <h1 class="form-title">باركود ورمز QR للاستمارة</h1>
      </header>
  `;

  const collegeFooter = `
      <footer class="college-ftr">
        <div class="college-ftr-accent"></div>
        <div class="college-ftr-grid">
          <div class="college-ftr-col">
            <div class="college-ftr-label">العنوان</div>
            <div class="college-ftr-value">البصرة — حي الزيتون — طريق صناعية حمدان</div>
            <div class="college-ftr-value">مقابل دائرة الكهرباء</div>
          </div>
          <div class="college-ftr-col college-ftr-center">
            <div class="college-ftr-label">الهواتف</div>
            <div class="college-ftr-value" dir="ltr">07744445669</div>
            <div class="college-ftr-value" dir="ltr">07870703000</div>
          </div>
          <div class="college-ftr-col college-ftr-end">
            <div class="college-ftr-label">التواصل الإلكتروني</div>
            <div class="college-ftr-value" dir="ltr">info@shau.edu.iq</div>
            <div class="college-ftr-value" dir="ltr">shau.edu.iq</div>
          </div>
        </div>
        <div class="college-ftr-bottom">
          <span>تاريخ الطباعة: ${new Date().toLocaleDateString('ar-IQ')}</span>
          <span>كلية الشرق التقنية التخصصية · نظام SHAU</span>
        </div>
      </footer>
  `;

  const detailsHtml = `
    <div class="page details-page">
      ${formHeader}

      ${section(
        'البيانات الشخصية',
        [
          row('الاسم الرباعي', p.fullName),
          row('اللقب', p.nickname),
          row('اسم الأم', p.motherName),
          row('الهوية الوطنية', p.nationalId),
          row('تاريخ الميلاد', p.birthDate),
          row('المحافظة', p.birthPlace),
          row('المنطقة', p.area),
          row('الجنس', labelGender(p.gender)),
          row('الديانة', p.religion),
          row('الحالة الاجتماعية', labelMarital(p.maritalStatus)),
          row('الهاتف', p.phone),
          row('البريد الإلكتروني', p.email),
        ].join('')
      )}

      ${section(
        'الدراسة الإعدادية',
        [
          row('اسم المدرسة', se.schoolName),
          row('نوع المدرسة', labelSchoolType(se.schoolType)),
          row('سنة التخرج', se.graduationYear),
          row('المعدل', se.gpa),
          row('إجمالي الدرجات', se.totalScore),
          row('الدور', labelExamAttempt(se.examAttempt)),
          row('الرقم الامتحاني', se.examNumber),
          row('الرقم السري', se.examPassword),
          row('الفرع', se.branch),
        ].join('')
      )}

      ${section(
        'القبول الجامعي',
        [
          row('المرحلة', labelAdmissionType(u.admissionType)),
          row('قناة القبول', labelAdmissionChannel(u.admissionChannel)),
          ...(s.departmentPreferences
            ? [
                row('الرغبة الأولى', s.departmentPreferences.first),
                row('الرغبة الثانية', s.departmentPreferences.second),
                row('الرغبة الثالثة', s.departmentPreferences.third),
              ]
            : [row('القسم', u.department)]),
          row('نوع الدراسة', labelStudyType(u.studyType)),
          row('المرحلة الدراسية', labelLevel(u.level)),
          row('الفصل', labelSemester(u.semester)),
          row('السنة الأكاديمية', u.academicYear),
        ].join('')
      )}

      ${section(
        'المستمسكات',
        Object.entries(s.documents || {})
          .map(([k, ok]) => row(DOC_LABELS[k] || k, ok ? 'مرفق' : 'غير مرفق'))
          .join('')
      )}

      ${collegeFooter}
    </div>
  `;

  const printDepartments = [
    'تقنيات التخدير',
    'تقنيات الاشعة',
    'تقنيات صناعة الاسنان',
    'هندسة تقنيات البناء والانشاءات',
    'تقنيات هندسة النفط والغاز',
    'تقنيات الفيزياء الصحية',
    'تقنيات البصريات',
    'تقنيات طب الطوارئ',
    'تقنيات العلاج الطبيعي',
    'هندسة تقنيات الامن السيبراني والحوسبة السحابية',
  ];

  const preferenceChoices = [
    {
      key: 'first',
      label: 'الرغبة الأولى',
      value: String(s.departmentPreferences?.first || u.department || '').trim(),
    },
    {
      key: 'second',
      label: 'الرغبة الثانية',
      value: String(s.departmentPreferences?.second || '').trim(),
    },
    {
      key: 'third',
      label: 'الرغبة الثالثة',
      value: String(s.departmentPreferences?.third || '').trim(),
    },
  ];

  const preferencesHtml = `
    <section class="prefs-panel">
      <div class="prefs-panel-head">
        <h2>اختيارات الطالب للأقسام</h2>
        <p>${p.fullName ? `الطالب: <strong>${p.fullName}</strong>` : 'رغبات القبول حسب ترتيب الأولوية'}</p>
      </div>
      <div class="prefs-grid">
        ${preferenceChoices
          .map(
            (choice, idx) => `
          <div class="pref-card pref-${idx + 1}">
            <div class="pref-rank" dir="ltr">${idx + 1}</div>
            <div class="pref-body">
              <span class="pref-label">${choice.label}</span>
              <span class="pref-value">${choice.value ? `قسم ${choice.value}` : '—'}</span>
            </div>
          </div>`
          )
          .join('')}
      </div>
    </section>
  `;

  const departmentsTableRows = printDepartments
    .map((name, index) => {
      const num = String(index + 1).padStart(2, '0');
      return `<tr>
        <td class="dept-num" dir="ltr">${num}</td>
        <td class="dept-name">قسم ${name}</td>
      </tr>`;
    })
    .join('');

  const codesHtml = `
    <div class="page codes-page">
      <div class="codes-page-body">
        ${codesHeader}

        <div class="codes-row">
          <div class="code-block codes-right">
            <h2>رمز الاستمارة</h2>
            <div class="code-id" dir="ltr">${normalizedCode}</div>
            <h2 class="mt">الباركود</h2>
            <img class="barcode" src="${barcodeImg}" alt="باركود الاستمارة" />
          </div>
          <div class="code-block codes-left">
            <h2>رمز QR</h2>
            <img class="qr" src="${qrImg}" alt="QR للاستمارة" />
            <p class="url" dir="ltr">${publicUrl}</p>
          </div>
        </div>

        ${preferencesHtml}

        <section class="depts-panel">
          <div class="depts-panel-head">
            <h2>أقسام الكلية التقنية التخصصية</h2>
            <p>الأقسام المتاحة للتسجيل ضمن استمارة القبول</p>
          </div>
          <table class="depts-table" aria-label="أقسام الكلية">
            <thead>
              <tr>
                <th class="dept-num-h">ت</th>
                <th>اسم القسم</th>
              </tr>
            </thead>
            <tbody>
              ${departmentsTableRows}
            </tbody>
          </table>
        </section>
      </div>
      ${collegeFooter}
    </div>
  `;

  const body =
    mode === 'codes' ? codesHtml : `${detailsHtml}${codesHtml}`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>استمارة تسجيل · ${normalizedCode}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, Arial, sans-serif;
      color: #1e293b;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page { width: 100%; }
    .codes-page {
      min-height: calc(297mm - 24mm);
      height: calc(297mm - 24mm);
      display: flex;
      flex-direction: column;
    }
    .codes-page-body {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .codes-page .college-ftr {
      margin-top: auto;
      flex-shrink: 0;
    }
    .details-page + .codes-page {
      page-break-before: always;
      break-before: page;
    }
    .hdr {
      border-bottom: 3px solid #072147;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .codes-page .hdr {
      margin-bottom: 8px;
      padding-bottom: 6px;
    }
    .codes-page .hdr-logo img {
      width: 58px;
      height: 58px;
    }
    .codes-page .form-title {
      font-size: 16px;
      margin-top: 4px;
    }
    .hdr::before {
      content: "";
      display: block;
      height: 5px;
      background: linear-gradient(90deg, #072147 0%, #1F4A7A 50%, #072147 100%);
      margin: 0 0 10px;
      border-radius: 2px;
    }
    .hdr-top {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .hdr-logo {
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .hdr-logo img {
      width: 72px;
      height: 72px;
      object-fit: contain;
    }
    .hdr-side {
      font-size: 12px;
      color: #0f172a;
      line-height: 1.45;
    }
    .hdr-right {
      text-align: right;
    }
    .hdr-left {
      text-align: left;
    }
    .college-name {
      color: #072147;
      font-weight: 800;
      font-size: 13px;
    }
    .college-unit {
      color: #1F4A7A;
      font-weight: 700;
      font-size: 12px;
      margin-top: 2px;
    }
    .meta-line {
      color: #334155;
      font-size: 11.5px;
    }
    .meta-line strong {
      color: #072147;
    }
    .form-title {
      margin: 8px 0 0;
      text-align: center;
      font-size: 18px;
      color: #1F4A7A;
      font-weight: 800;
    }
    .brand {
      color: #072147;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.02em;
    }
    h1 {
      margin: 6px 0 2px;
      font-size: 20px;
      color: #0f172a;
    }
    .sub { margin: 0; color: #64748b; font-size: 12px; }
    .meta {
      margin-top: 8px;
      display: flex;
      justify-content: center;
      gap: 18px;
      flex-wrap: wrap;
      font-size: 12px;
      color: #334155;
    }
    .sec {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      margin-bottom: 10px;
      overflow: hidden;
    }
    .sec h2 {
      margin: 0;
      padding: 7px 10px;
      background: #072147;
      color: #fff;
      font-size: 13px;
      border-bottom: 3px solid #1F4A7A;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
    }
    .field {
      display: grid;
      grid-template-columns: 9.2rem minmax(0, 1fr);
      column-gap: 10px;
      align-items: center;
      padding: 6px 10px;
      border-bottom: 1px solid #e2e8f0;
      border-left: 1px solid #e2e8f0;
      font-size: 11.5px;
      min-height: 28px;
    }
    .field:nth-child(2n) { border-left: none; }
    .lbl {
      color: #072147;
      font-weight: 700;
      width: 9.2rem;
      min-width: 9.2rem;
      max-width: 9.2rem;
      white-space: nowrap;
    }
    .lbl::after { content: ":"; margin-inline-start: 2px; }
    .val {
      color: #0f172a;
      font-weight: 600;
      min-width: 0;
      text-align: start;
      word-break: break-word;
    }
    .ftr {
      margin-top: 14px;
      padding-top: 8px;
      border-top: 2px solid #072147;
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #475569;
    }
    .college-ftr {
      margin-top: 18px;
      background: #072147;
      color: #fff;
      border-radius: 6px;
      overflow: hidden;
    }
    .college-ftr-accent {
      height: 4px;
      background: #1F4A7A;
    }
    .college-ftr-grid {
      display: grid;
      grid-template-columns: 1.4fr 1fr 1fr;
      gap: 12px;
      padding: 12px 14px 10px;
    }
    .college-ftr-col {
      min-width: 0;
    }
    .college-ftr-center {
      text-align: center;
      border-right: 1px solid rgba(232, 145, 58, 0.45);
      border-left: 1px solid rgba(232, 145, 58, 0.45);
      padding: 0 8px;
    }
    .college-ftr-end {
      text-align: left;
    }
    .college-ftr-label {
      color: #1F4A7A;
      font-size: 11px;
      font-weight: 800;
      margin-bottom: 4px;
      letter-spacing: 0.02em;
    }
    .college-ftr-value {
      font-size: 11px;
      line-height: 1.45;
      color: #f8fafc;
      font-weight: 500;
    }
    .college-ftr-bottom {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      padding: 7px 14px;
      background: rgba(0, 0, 0, 0.18);
      border-top: 1px solid rgba(31, 74, 122, 0.45);
      font-size: 10px;
      color: #dbe7e3;
    }
    .codes-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 12px 0;
    }
    .codes-row {
      flex: 0 0 auto;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      align-items: center;
      justify-items: center;
      padding: 6px 4px 4px;
      min-height: 0;
    }
    .code-block { text-align: center; width: 100%; }
    .codes-right {
      border-left: 1px solid #c9d4e8;
      padding-left: 14px;
    }
    .codes-left {
      padding-right: 14px;
    }
    .code-block h2 {
      margin: 0 0 8px;
      color: #072147;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .code-block h2.mt {
      margin-top: 14px;
    }
    .code-id {
      display: inline-block;
      padding: 6px 14px;
      border: 2px solid #1F4A7A;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 800;
      letter-spacing: 0.06em;
      color: #072147;
      background: #eef2f9;
    }
    .barcode { height: 48px; max-width: 95%; }
    .qr { width: 128px; height: 128px; border: 1px solid #cbd5e1; padding: 5px; background: #fff; }
    .url { margin: 5px auto 0; font-size: 8.5px; color: #64748b; word-break: break-all; max-width: 220px; }

    .prefs-panel {
      margin: 6px 0 8px;
      border: 1px solid #c9d4e8;
      border-radius: 8px;
      overflow: hidden;
      background: #fff;
      flex: 0 0 auto;
    }
    .prefs-panel-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      padding: 7px 12px;
      background: #eef2f9;
      border-bottom: 1px solid #c9d4e8;
    }
    .prefs-panel-head h2 {
      margin: 0;
      font-size: 12.5px;
      font-weight: 800;
      color: #072147;
    }
    .prefs-panel-head p {
      margin: 0;
      font-size: 11px;
      color: #475569;
    }
    .prefs-panel-head strong {
      color: #072147;
    }
    .prefs-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0;
    }
    .pref-card {
      display: flex;
      align-items: stretch;
      gap: 0;
      min-height: 54px;
      border-left: 1px solid #d7e0ec;
      background: #fff;
    }
    .pref-card:last-child {
      border-left: none;
    }
    .pref-rank {
      flex: 0 0 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      font-weight: 800;
      color: #fff;
      background: #072147;
    }
    .pref-2 .pref-rank { background: #12345F; }
    .pref-3 .pref-rank { background: #1F4A7A; }
    .pref-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 2px;
      padding: 7px 10px;
      text-align: right;
    }
    .pref-label {
      font-size: 10px;
      font-weight: 700;
      color: #1F4A7A;
      letter-spacing: 0.02em;
    }
    .pref-value {
      font-size: 11.5px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.35;
    }

    .depts-panel {
      flex: 1 1 auto;
      margin-top: 0;
      border: 1px solid #c9d4e8;
      border-radius: 8px;
      overflow: hidden;
      background: #fff;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .depts-panel-head {
      background: linear-gradient(90deg, #072147 0%, #1F4A7A 100%);
      color: #fff;
      padding: 9px 14px;
      text-align: center;
    }
    .depts-panel-head h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .depts-panel-head p {
      margin: 3px 0 0;
      font-size: 10.5px;
      opacity: 0.92;
    }
    .depts-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .depts-table thead th {
      background: #e8eef8;
      color: #072147;
      font-weight: 800;
      font-size: 11.5px;
      padding: 7px 10px;
      border-bottom: 2px solid #072147;
      text-align: right;
    }
    .depts-table th.dept-num-h,
    .depts-table td.dept-num {
      width: 42px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .depts-table tbody td {
      padding: 5.5px 10px;
      border-bottom: 1px solid #e2e8f0;
      color: #1e293b;
      vertical-align: middle;
    }
    .depts-table tbody tr:nth-child(even) {
      background: #f7f9fc;
    }
    .depts-table tbody tr:last-child td {
      border-bottom: none;
    }
    .depts-table td.dept-num {
      font-weight: 800;
      color: #072147;
      background: #eef2f9;
      border-left: 1px solid #d7e0ec;
    }
    .depts-table td.dept-name {
      font-weight: 600;
      letter-spacing: 0.01em;
    }
    @media print {
      body { background: #fff; }
      .no-print { display: none !important; }
      .codes-page {
        min-height: calc(297mm - 24mm);
        height: calc(297mm - 24mm);
      }
      .codes-page .college-ftr {
        margin-top: auto;
      }
      .depts-panel {
        break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  ${body}
  ${autoPrint ? `<script>window.onload=function(){setTimeout(function(){window.print();},350);}</script>` : ''}
</body>
</html>`;
}

export function buildSnapshotFromFormData(formData: {
  personalData: Record<string, any>;
  secondaryEducation: Record<string, any>;
  universityAdmission: Record<string, any>;
  documents: Record<string, any>;
}, options?: {
  departmentPreferences?: { first: string; second: string; third: string };
  documentNames?: Record<string, string | boolean>;
}): ApplicationSnapshot {
  const pd = formData.personalData || {};
  const se = formData.secondaryEducation || {};
  const ua = formData.universityAdmission || {};
  const docs = formData.documents || {};

  const docFlags: Record<string, boolean | string> = {};
  for (const key of Object.keys(DOC_LABELS)) {
    const override = options?.documentNames?.[key];
    if (typeof override === 'string' && override.trim()) {
      docFlags[key] = override.trim();
    } else if (typeof override === 'boolean') {
      docFlags[key] = override;
    } else {
      const file = docs[key];
      if (file && typeof file === 'object' && typeof file.name === 'string' && file.name && Number(file.size) === 0 && file.name !== 'مرفق') {
        docFlags[key] = file.name;
      } else {
        docFlags[key] = Boolean(file);
      }
    }
  }

  return {
    personalData: {
      fullName: String(pd.fullName || ''),
      nickname: String(pd.nickname || ''),
      motherName: String(pd.motherName || ''),
      nationalId: String(pd.nationalId || ''),
      birthDate: String(pd.birthDate || ''),
      birthPlace: String(pd.birthPlace || ''),
      area: String(pd.area || ''),
      gender: String(pd.gender || ''),
      religion: String(pd.religion || ''),
      maritalStatus: String(pd.maritalStatus || ''),
      phone: String(pd.phone || ''),
      email: String(pd.email || ''),
    },
    secondaryEducation: {
      schoolName: String(se.schoolName || ''),
      schoolType: String(se.schoolType || ''),
      graduationYear: String(se.graduationYear || ''),
      gpa: String(se.gpa || ''),
      totalScore: String(se.totalScore || ''),
      examAttempt: String(se.examAttempt || ''),
      examNumber: String(se.examNumber || ''),
      examPassword: String(se.examPassword || ''),
      branch: String(se.branch || ''),
    },
    universityAdmission: {
      admissionType: String(ua.admissionType || ''),
      admissionChannel: String(ua.admissionChannel || ''),
      department: String(ua.department || ''),
      studyType: String(ua.studyType || ''),
      level: String(ua.level || ''),
      semester: String(ua.semester || ''),
      academicYear: String(ua.academicYear || ''),
    },
    documents: docFlags,
    departmentPreferences: options?.departmentPreferences,
    createdAt: new Date().toISOString(),
  };
}
