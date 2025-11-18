import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import * as XLSX from 'xlsx';

// POST /api/students/bulk-import-excel - استيراد طلاب من ملف Excel/CSV
export async function POST(request: NextRequest) {
  try {
    // التحقق من وجود عمود username وإنشاؤه إذا لم يكن موجوداً
    try {
      await query(`
        ALTER TABLE student_affairs.students
        ADD COLUMN IF NOT EXISTS username VARCHAR(100)
      `);
    } catch (error) {
      console.log('عمود username موجود بالفعل أو حدث خطأ في التحقق:', error);
    }
    
    // التحقق من وجود عمود password وإنشاؤه إذا لم يكن موجوداً
    try {
      await query(`
        ALTER TABLE student_affairs.students
        ADD COLUMN IF NOT EXISTS password VARCHAR(255)
      `);
    } catch (error) {
      console.log('عمود password موجود بالفعل أو حدث خطأ في التحقق:', error);
    }
    
    // التحقق من وجود عمود province وإنشاؤه إذا لم يكن موجوداً
    try {
      await query(`
        ALTER TABLE student_affairs.students
        ADD COLUMN IF NOT EXISTS province VARCHAR(100)
      `);
    } catch (error) {
      console.log('عمود province موجود بالفعل أو حدث خطأ في التحقق:', error);
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'لم يتم اختيار ملف' },
        { status: 400 }
      );
    }

    // قراءة الملف
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: false, cellNF: false, cellText: false });
    
    // الحصول على أول ورقة عمل
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // تحويل إلى JSON مع الحفاظ على جميع الصفوف
    const data = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1, 
      defval: '',
      raw: false,
      blankrows: true
    }) as any[][];

    console.log(`📄 تم قراءة الملف: ${data.length} صف`);

    if (data.length === 0) {
      return NextResponse.json(
        { success: false, error: 'الملف فارغ' },
        { status: 400 }
      );
    }

    // تخطي الصف الأول إذا كان يحتوي على رؤوس الأعمدة
    const firstRow = data[0] || [];
    const hasHeader = firstRow.some((cell: any) => {
      const cellStr = String(cell || '').toLowerCase();
      return cellStr.includes('اسم') || cellStr.includes('name') || cellStr.includes('الاسم');
    });
    
    const startRow = hasHeader ? 1 : 0;
    
    console.log(`📋 الصف الأول يحتوي على رؤوس: ${hasHeader ? 'نعم' : 'لا'}، سيبدأ من الصف ${startRow + 1}`);

    let added = 0;
    let failed = 0;
    const errors: string[] = [];

    console.log(`📊 بدء الاستيراد: ${data.length} صف، بدء من الصف ${startRow}`);
    
    // معالجة كل صف
    for (let i = startRow; i < data.length; i++) {
      const row = data[i];
      let fullName = '';
      
      try {
        if (!row || row.length === 0) {
          console.log(`⚠️ الصف ${i + 1}: فارغ - تم التخطي`);
          continue;
        }

        // ترتيب الأعمدة المتوقع (من اليمين إلى اليسار):
        // 0: الاسم الرباعي (مطلوب)
        // 1: اللقب
        // 2: اسم الأم الثلاثي
        // 3: تاريخ الميلاد
        // 4: رقم الهوية الوطنية
        // 5: رقم هاتف الطالب
        // 6: اسم المدرسة
        // 7: المعدل التراكمي
        // 8: سنة التخرج
        // 9: الرقم الامتحاني
        // 10: الرقم السري
        // 11: القسم
        // 12: الاسم المستخدم
        // 13: كلمة المرور
        // 14: المرحلة (first/second/third/fourth) - يظهر كـ "الأولى" أو "الثانية" في Excel
        // 15: نوع الدراسة (morning/evening)
        // 16: المرحلة الدراسية (bachelor/master/phd/diploma)
        // 17: السنة الأكاديمية (مثل: 2025-2026)
        // 18: الفصل الدراسي (first/second)
        // 19: المحافظة
        // 20: المنطقة
        // 21: نوع المدرسة (public/private/international)
        // 22: إجمالي الدرجات
        // 23: الدور (first/second/third)
        // 24: الفرع (علمي/أدبي/مهني)
        // 25: قناة القبول (general/martyrs/social_care/etc)

        fullName = String(row[0] || '').trim();
        
        if (!fullName) {
          console.log(`⚠️ الصف ${i + 1}: لا يوجد اسم - تم التخطي`);
          failed++;
          continue;
        }

        console.log(`🔄 معالجة الصف ${i + 1}: ${fullName}`);

        // التحقق من عدم وجود طالب بنفس الاسم
        const existingStudent = await query(
          `SELECT id FROM student_affairs.students WHERE TRIM(full_name) = TRIM($1) OR TRIM(full_name_ar) = TRIM($1)`,
          [fullName]
        );

        if (existingStudent.rows.length > 0) {
          console.log(`⚠️ الطالب "${fullName}" موجود مسبقاً - تم التخطي`);
          failed++;
          errors.push(`الطالب "${fullName}" موجود مسبقاً`);
          continue;
        }

        // التحقق من عدم وجود طالب بنفس رقم الهوية (إذا كان موجوداً)
        const nationalId = String(row[4] || '').trim();
        console.log(`  🆔 رقم الهوية للطالب "${fullName}": "${nationalId || '(فارغ)'}"`);
        
        if (nationalId) {
          const existingByNationalId = await query(
            `SELECT id FROM student_affairs.students WHERE national_id = $1 AND national_id IS NOT NULL AND national_id != ''`,
            [nationalId]
          );

          if (existingByNationalId.rows.length > 0) {
            console.log(`⚠️ رقم الهوية "${nationalId}" موجود مسبقاً للطالب "${fullName}" - تم التخطي`);
            failed++;
            errors.push(`رقم الهوية "${nationalId}" موجود مسبقاً للطالب "${fullName}"`);
            continue;
          }
        }

        // توليد الرقم الجامعي
        console.log(`  📝 توليد الرقم الجامعي للطالب "${fullName}"...`);
        const universityIdResult = await query('SELECT student_affairs.generate_university_id() as university_id');
        const university_id = universityIdResult.rows[0].university_id;
        console.log(`  ✅ الرقم الجامعي: ${university_id}`);

        // تقسيم الاسم إلى أجزاء
        const nameParts = fullName.split(' ').filter(part => part.trim().length > 0);
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || firstName;
        console.log(`  📝 الاسم الأول: "${firstName}"، اللقب: "${lastName}"`);

        // دالة لتحويل رقم Excel التسلسلي إلى تاريخ
        const excelDateToDateString = (value: any): string | null => {
          if (!value) return null;
          
          const strValue = String(value).trim();
          if (!strValue) return null;
          
          // إذا كان النص بصيغة تاريخ (YYYY-MM-DD)
          if (/^\d{4}-\d{2}-\d{2}$/.test(strValue)) {
            return strValue;
          }
          
          // إذا كان رقم Excel التسلسلي
          const numValue = parseFloat(strValue);
          if (!isNaN(numValue) && numValue > 0) {
            // Excel date epoch: January 1, 1900 = 1
            // JavaScript date epoch: January 1, 1970 = 25569 (in Excel serial)
            const excelEpoch = 25569; // Days from 1900-01-01 to 1970-01-01
            const jsDate = new Date((numValue - excelEpoch) * 86400 * 1000);
            
            // التحقق من أن التاريخ صحيح
            if (!isNaN(jsDate.getTime())) {
              const year = jsDate.getFullYear();
              const month = String(jsDate.getMonth() + 1).padStart(2, '0');
              const day = String(jsDate.getDate()).padStart(2, '0');
              return `${year}-${month}-${day}`;
            }
          }
          
          return null;
        };

        // طباعة محتوى الصف بالكامل للتحقق
        console.log(`  📊 محتوى الصف ${i + 1} بالكامل:`, row);
        console.log(`  📊 عدد الأعمدة في الصف:`, row.length);
        console.log(`  📊 الأعمدة 19-25 (المحافظة والمنطقة وغيرها):`, {
          col19: row[19],
          col19Type: typeof row[19],
          col19String: String(row[19] || ''),
          col20: row[20],
          col20Type: typeof row[20],
          col20String: String(row[20] || ''),
          col21: row[21],
          col21String: String(row[21] || ''),
          col22: row[22],
          col22String: String(row[22] || ''),
          col23: row[23],
          col23String: String(row[23] || ''),
          col24: row[24],
          col24String: String(row[24] || ''),
          col25: row[25],
          col25String: String(row[25] || '')
        });
        
        // طباعة جميع الأعمدة للتحقق من موقع المحافظة
        if (i === startRow || i === startRow + 1) {
          console.log(`  🔍 جميع الأعمدة في الصف ${i + 1} (للتحقق من موقع المحافظة):`);
          row.forEach((cell, index) => {
            const cellValue = cell ? String(cell).trim() : '';
            if (cellValue) {
              console.log(`    JavaScript index ${index} (العمود ${index + 1} في Excel): "${cellValue}"`);
            }
          });
          // طباعة خاصة للأعمدة 18-22 (الأعمدة 19-23 في Excel)
          console.log(`  🔍 الأعمدة 18-22 (للتحقق من موقع المحافظة):`);
          for (let idx = 18; idx <= 22; idx++) {
            const cellValue = row[idx] ? String(row[idx]).trim() : '';
            console.log(`    row[${idx}] (العمود ${idx + 1} في Excel): "${cellValue}"`);
          }
        }

        // استخراج البيانات من الصف
        const nickname = String(row[1] || '').trim() || null;
        const motherName = String(row[2] || '').trim() || null;
        const birthDateRaw = row[3];
        const birthDate = excelDateToDateString(birthDateRaw);
        const nationalIdValue = nationalId || null;
        const phoneRaw = String(row[5] || '').trim();
        const phone = phoneRaw ? `+964${phoneRaw.replace(/^\+964/, '')}` : null;
        const schoolName = String(row[6] || '').trim() || null;
        const gpaRaw = String(row[7] || '').trim();
        let secondaryGpa: number | null = null;
        if (gpaRaw) {
          const gpaValue = parseFloat(gpaRaw);
          if (!isNaN(gpaValue) && gpaValue > 0) {
            secondaryGpa = Math.min(gpaValue, 100);
          }
        }
        const graduationYear = String(row[8] || '').trim() || null;
        const examNumber = String(row[9] || '').trim() || null;
        const examPassword = String(row[10] || '').trim() || null;
        const department = String(row[11] || '').trim() || null;
        const username = String(row[12] || '').trim() || null;
        // كلمة المرور في العمود 13
        const password = String(row[13] || '').trim() || null;
        
        // الحقول الجديدة - بناءً على البيانات الفعلية في Excel
        // المرحلة في العمود 14 (بعد كلمة المرور)
        const stageRaw = String(row[14] || '').trim().replace(/\s+/g, ' ').trim();
        console.log(`  🔍 قراءة المرحلة من العمود 14:`, {
          raw: row[14],
          stringified: String(row[14] || ''),
          trimmed: stageRaw,
          length: stageRaw.length,
          charCodes: Array.from(stageRaw).map(c => `${c}(${c.charCodeAt(0)})`).join(', '),
          includesFirst: stageRaw.includes('الأولى') || stageRaw.includes('الاولى'),
          includesSecond: stageRaw.includes('الثانية'),
          includesThird: stageRaw.includes('الثالثة'),
          includesFourth: stageRaw.includes('الرابعة')
        });
        let stage: string | null = null;
        // تحويل النص العربي إلى إنجليزي
        if (stageRaw) {
          const stageLower = stageRaw.toLowerCase();
          const stageNormalized = stageRaw.replace(/\s+/g, '').trim();
          
          // التحقق من جميع الاحتمالات مع تنظيف إضافي
          if (stageNormalized.includes('الأولى') || stageNormalized.includes('الاولى') || 
              stageRaw.includes('الأولى') || stageRaw.includes('الاولى') || 
              stageRaw === 'الأولى' || stageRaw === 'الاولى' || 
              stageLower === 'first' || stageLower.includes('first')) {
            stage = 'first';
            console.log(`  ✅ تم تحويل "${stageRaw}" إلى "first"`);
          } else if (stageNormalized.includes('الثانية') || 
                     stageRaw.includes('الثانية') || 
                     stageRaw === 'الثانية' || 
                     stageLower === 'second' || stageLower.includes('second')) {
            stage = 'second';
            console.log(`  ✅ تم تحويل "${stageRaw}" إلى "second"`);
          } else if (stageNormalized.includes('الثالثة') || 
                     stageRaw.includes('الثالثة') || 
                     stageRaw === 'الثالثة' || 
                     stageLower === 'third' || stageLower.includes('third')) {
            stage = 'third';
            console.log(`  ✅ تم تحويل "${stageRaw}" إلى "third"`);
          } else if (stageNormalized.includes('الرابعة') || 
                     stageRaw.includes('الرابعة') || 
                     stageRaw === 'الرابعة' || 
                     stageLower === 'fourth' || stageLower.includes('fourth')) {
            stage = 'fourth';
            console.log(`  ✅ تم تحويل "${stageRaw}" إلى "fourth"`);
          } else {
            console.log(`  ⚠️ لم يتم التعرف على المرحلة: "${stageRaw}" (الطول: ${stageRaw.length}, الحروف: ${Array.from(stageRaw).map(c => `${c}(${c.charCodeAt(0)})`).join(', ')})`);
          }
        } else {
          console.log(`  ⚠️ المرحلة فارغة في العمود 14`);
        }
        
        // نوع الدراسة (row[15])
        const studyTypeRaw = String(row[15] || '').trim();
        console.log(`  🔍 قراءة نوع الدراسة من العمود 15:`, {
          raw: row[15],
          stringified: String(row[15] || ''),
          trimmed: studyTypeRaw
        });
        let studyType: string | null = null;
        if (studyTypeRaw) {
          const studyTypeLower = studyTypeRaw.toLowerCase();
          if (studyTypeLower === 'morning') {
            studyType = 'morning';
          } else if (studyTypeLower === 'evening') {
            studyType = 'evening';
          } else if (studyTypeRaw.includes('صباحي') || studyTypeRaw.includes('صباح') || studyTypeRaw === 'صباحي') {
            studyType = 'morning';
          } else if (studyTypeRaw.includes('مسائي') || studyTypeRaw.includes('مساء') || studyTypeRaw === 'مسائي') {
            studyType = 'evening';
          }
          if (studyType) {
            console.log(`  ✅ تم تحويل "${studyTypeRaw}" إلى "${studyType}"`);
          } else {
            console.log(`  ⚠️ لم يتم التعرف على نوع الدراسة: "${studyTypeRaw}"`);
          }
        } else {
          console.log(`  ⚠️ نوع الدراسة فارغ في العمود 15`);
        }
        
        // المرحلة الدراسية (row[16])
        const levelRaw = String(row[16] || '').trim();
        console.log(`  🔍 قراءة المرحلة الدراسية من العمود 16:`, {
          raw: row[16],
          stringified: String(row[16] || ''),
          trimmed: levelRaw
        });
        let level: string | null = null;
        if (levelRaw) {
          const levelLower = levelRaw.toLowerCase();
          if (levelLower === 'bachelor' || levelLower === 'master' || levelLower === 'phd' || levelLower === 'diploma') {
            level = levelLower;
          } else if (levelRaw.includes('بكالوريوس') || levelRaw.includes('بكالوريوس') || levelRaw === 'بكالوريوس') {
            level = 'bachelor';
          } else if (levelRaw.includes('ماجستير') || levelRaw === 'ماجستير') {
            level = 'master';
          } else if (levelRaw.includes('دكتوراه') || levelRaw === 'دكتوراه') {
            level = 'phd';
          } else if (levelRaw.includes('دبلوم') || levelRaw === 'دبلوم') {
            level = 'diploma';
          }
          if (level) {
            console.log(`  ✅ تم تحويل "${levelRaw}" إلى "${level}"`);
          } else {
            console.log(`  ⚠️ لم يتم التعرف على المرحلة الدراسية: "${levelRaw}"`);
          }
        } else {
          console.log(`  ⚠️ المرحلة الدراسية فارغة في العمود 16`);
        }
        
        // السنة الأكاديمية (row[17])
        const academicYear = String(row[17] || '').trim() || null;
        console.log(`  🔍 قراءة السنة الأكاديمية من العمود 17:`, {
          raw: row[17],
          stringified: String(row[17] || ''),
          trimmed: academicYear
        });
        
        // الفصل الدراسي (row[18])
        const semesterRaw = String(row[18] || '').trim();
        console.log(`  🔍 قراءة الفصل الدراسي من العمود 18:`, {
          raw: row[18],
          stringified: String(row[18] || ''),
          trimmed: semesterRaw
        });
        let semester: string | null = null;
        if (semesterRaw) {
          const semesterLower = semesterRaw.toLowerCase();
          if (semesterLower === 'first' || semesterLower === 'second') {
            semester = semesterLower;
          } else if (semesterRaw.includes('الأول') || semesterRaw.includes('الاول') || semesterRaw === 'الأول' || semesterRaw === 'الاول') {
            semester = 'first';
          } else if (semesterRaw.includes('الثاني') || semesterRaw === 'الثاني') {
            semester = 'second';
          }
          if (semester) {
            console.log(`  ✅ تم تحويل "${semesterRaw}" إلى "${semester}"`);
          } else {
            console.log(`  ⚠️ لم يتم التعرف على الفصل الدراسي: "${semesterRaw}"`);
          }
        } else {
          console.log(`  ⚠️ الفصل الدراسي فارغ في العمود 18`);
        }
        
        // المحافظة (row[19] = العمود 20 في Excel = العمود T)
        // ملاحظة: في JavaScript arrays، الفهرس يبدأ من 0
        // لذا العمود 20 في Excel = index 19 في JavaScript
        // المستخدم يؤكد أن المحافظة في العمود 20 (T) في Excel
        const provinceRaw = row[19]; // العمود 20 في Excel = العمود T
        const province = provinceRaw ? String(provinceRaw).trim() : null;
        
        console.log(`  🔍 قراءة المحافظة من row[19] (العمود 20 في Excel = العمود T):`, {
          row19: row[19],
          row19Type: typeof row[19],
          row19String: String(row[19] || ''),
          provinceRaw: provinceRaw,
          provinceRawType: typeof provinceRaw,
          stringified: String(provinceRaw || ''),
          trimmed: province,
          isNull: province === null,
          isEmpty: province === '',
          length: province ? province.length : 0,
          rowLength: row.length
        });
        
        // المنطقة (row[20])
        const area = String(row[20] || '').trim() || null;
        console.log(`  🔍 قراءة المنطقة من العمود 20:`, {
          raw: row[20],
          stringified: String(row[20] || ''),
          trimmed: area
        });
        
        // نوع المدرسة (row[21])
        const schoolTypeRaw = String(row[21] || '').trim();
        console.log(`  🔍 قراءة نوع المدرسة من العمود 21:`, {
          raw: row[21],
          stringified: String(row[21] || ''),
          trimmed: schoolTypeRaw
        });
        let schoolType: string | null = null;
        if (schoolTypeRaw) {
          const schoolTypeLower = schoolTypeRaw.toLowerCase();
          if (schoolTypeLower === 'public' || schoolTypeLower === 'private' || schoolTypeLower === 'international') {
            schoolType = schoolTypeLower;
          } else if (schoolTypeRaw.includes('حكومي') || schoolTypeRaw.includes('حكومية') || schoolTypeRaw === 'حكومي') {
            schoolType = 'public';
          } else if (schoolTypeRaw.includes('أهلي') || schoolTypeRaw.includes('أهلية') || schoolTypeRaw === 'أهلي') {
            schoolType = 'private';
          } else if (schoolTypeRaw.includes('دولي') || schoolTypeRaw.includes('دولية') || schoolTypeRaw === 'دولي') {
            schoolType = 'international';
          }
          if (schoolType) {
            console.log(`  ✅ تم تحويل "${schoolTypeRaw}" إلى "${schoolType}"`);
          } else {
            console.log(`  ⚠️ لم يتم التعرف على نوع المدرسة: "${schoolTypeRaw}"`);
          }
        } else {
          console.log(`  ⚠️ نوع المدرسة فارغ في العمود 21`);
        }
        
        // إجمالي الدرجات (row[22])
        const totalScore = String(row[22] || '').trim() || null;
        console.log(`  🔍 قراءة إجمالي الدرجات من العمود 22:`, {
          raw: row[22],
          stringified: String(row[22] || ''),
          trimmed: totalScore
        });
        
        // الدور (row[23])
        const examAttemptRaw = String(row[23] || '').trim();
        console.log(`  🔍 قراءة الدور من العمود 23:`, {
          raw: row[23],
          stringified: String(row[23] || ''),
          trimmed: examAttemptRaw
        });
        let examAttempt: string | null = null;
        if (examAttemptRaw) {
          const examAttemptLower = examAttemptRaw.toLowerCase();
          if (examAttemptLower === 'first' || examAttemptLower === 'second' || examAttemptLower === 'third') {
            examAttempt = examAttemptLower;
          } else if (examAttemptRaw.includes('الأول') || examAttemptRaw.includes('الاول') || examAttemptRaw === 'الأول' || examAttemptRaw === 'الاول') {
            examAttempt = 'first';
          } else if (examAttemptRaw.includes('الثاني') || examAttemptRaw === 'الثاني') {
            examAttempt = 'second';
          } else if (examAttemptRaw.includes('الثالث') || examAttemptRaw === 'الثالث') {
            examAttempt = 'third';
          }
          if (examAttempt) {
            console.log(`  ✅ تم تحويل "${examAttemptRaw}" إلى "${examAttempt}"`);
          } else {
            console.log(`  ⚠️ لم يتم التعرف على الدور: "${examAttemptRaw}"`);
          }
        } else {
          console.log(`  ⚠️ الدور فارغ في العمود 23`);
        }
        
        // الفرع (row[24])
        const branch = String(row[24] || '').trim() || null;
        console.log(`  🔍 قراءة الفرع من العمود 24:`, {
          raw: row[24],
          stringified: String(row[24] || ''),
          trimmed: branch
        });
        
        // قناة القبول (row[25])
        const admissionChannelRaw = String(row[25] || '').trim();
        console.log(`  🔍 قراءة قناة القبول من العمود 25:`, {
          raw: row[25],
          stringified: String(row[25] || ''),
          trimmed: admissionChannelRaw
        });
        let admissionChannel: string | null = null;
        if (admissionChannelRaw) {
          const admissionChannelLower = admissionChannelRaw.toLowerCase();
          // التحقق من القيم الإنجليزية
          if (admissionChannelLower === 'general' || admissionChannelLower === 'martyrs' || 
              admissionChannelLower === 'social_care' || admissionChannelLower === 'special_needs' ||
              admissionChannelLower === 'political_prisoners' || admissionChannelLower === 'siblings_married' ||
              admissionChannelLower === 'minister_directive' || admissionChannelLower === 'dean_approval' ||
              admissionChannelLower === 'faculty_children' || admissionChannelLower === 'top_students' ||
              admissionChannelLower === 'health_ministry') {
            admissionChannel = admissionChannelLower;
          } else if (admissionChannelRaw.includes('عام') || admissionChannelRaw.includes('القناة العامة') || admissionChannelRaw === 'القناة العامة') {
            admissionChannel = 'general';
          } else if (admissionChannelRaw.includes('شهداء') || admissionChannelRaw.includes('ذوي الشهداء') || admissionChannelRaw === 'قناة ذوي الشهداء') {
            admissionChannel = 'martyrs';
          } else if (admissionChannelRaw.includes('رعاية') || admissionChannelRaw.includes('الرعاية الاجتماعية') || admissionChannelRaw === 'قناة الرعاية الاجتماعية') {
            admissionChannel = 'social_care';
          } else if (admissionChannelRaw.includes('همم') || admissionChannelRaw.includes('ذوي الهمم') || admissionChannelRaw === 'قناة ذوي الهمم') {
            admissionChannel = 'special_needs';
          } else if (admissionChannelRaw.includes('سجناء') || admissionChannelRaw.includes('السجناء السياسيين') || admissionChannelRaw === 'قناة السجناء السياسيين') {
            admissionChannel = 'political_prisoners';
          } else if (admissionChannelRaw.includes('إخوة') || admissionChannelRaw.includes('متزوجين') || admissionChannelRaw === 'تخفيض الاخوة والمتزوجين') {
            admissionChannel = 'siblings_married';
          } else if (admissionChannelRaw.includes('وزير') || admissionChannelRaw.includes('توجيهات معالي الوزير') || admissionChannelRaw === 'تخفيض توجيهات معالي الوزير') {
            admissionChannel = 'minister_directive';
          } else if (admissionChannelRaw.includes('عميد') || admissionChannelRaw.includes('موافقة السيد العميد') || admissionChannelRaw === 'تخفيض موافقة السيد العميد') {
            admissionChannel = 'dean_approval';
          } else if (admissionChannelRaw.includes('هيئة') || admissionChannelRaw.includes('ابناء الهيئة التدريسية') || admissionChannelRaw === 'تخفيض ابناء الهيئة التدريسية') {
            admissionChannel = 'faculty_children';
          } else if (admissionChannelRaw.includes('أوائل') || admissionChannelRaw === 'تخفيض الاوائل') {
            admissionChannel = 'top_students';
          } else if (admissionChannelRaw.includes('صحة') || admissionChannelRaw.includes('موظفي وزارة الصحة') || admissionChannelRaw === 'تخفيض موظفي وزارة الصحة') {
            admissionChannel = 'health_ministry';
          } else {
            // إذا لم يتم التعرف على القيمة، نستخدم القيمة الأصلية
            admissionChannel = admissionChannelRaw;
          }
          if (admissionChannel) {
            console.log(`  ✅ تم تحويل "${admissionChannelRaw}" إلى "${admissionChannel}"`);
          } else {
            console.log(`  ⚠️ لم يتم التعرف على قناة القبول: "${admissionChannelRaw}"`);
          }
        } else {
          console.log(`  ⚠️ قناة القبول فارغة في العمود 25`);
        }

        console.log(`  📋 بيانات الطالب:`, {
          fullName,
          nickname,
          birthDate,
          nationalId: nationalIdValue,
          phone,
          province,
          area,
          schoolName,
          schoolType,
          secondaryGpa,
          totalScore,
          examAttempt,
          branch,
          department,
          stage,
          studyType,
          level,
          academicYear,
          semester,
          admissionChannel
        });

        // إدراج الطالب
        console.log(`  💾 محاولة إدراج الطالب "${fullName}" في قاعدة البيانات...`);
        const insertQuery = `
          INSERT INTO student_affairs.students (
            university_id, student_number, first_name, last_name, full_name_ar, full_name, nickname,
            mother_name, national_id, birth_date, phone, province, area, secondary_school_name, secondary_school_type, secondary_gpa,
            secondary_graduation_year, secondary_total_score, exam_attempt, exam_number, exam_password, branch, major, username, password,
            admission_type, admission_channel, study_type, level, academic_year, semester,
            gender, status, payment_status
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34
          ) RETURNING id, university_id
        `;

        const insertParams = [
          university_id,
          university_id,
          firstName,
          lastName,
          fullName,
          fullName,
          nickname,
          motherName,
          nationalIdValue,
          birthDate,
          phone,
          province, // المحافظة
          area, // المنطقة
          schoolName,
          schoolType,
          secondaryGpa,
          graduationYear,
          totalScore,
          examAttempt,
          examNumber,
          examPassword,
          branch,
          department,
          username,
          password,
          stage, // stage يحتوي على القيمة (first/second/third/fourth) ويتم إدراجها في admission_type
          admissionChannel,
          studyType,
          level,
          academicYear,
          semester,
          'male', // افتراضي
          'active',
          'registration_pending' // قيد التسجيل
        ];

        console.log(`  🔍 القيم المراد إدراجها:`, {
          province: province || '(null)',
          area: area || '(null)',
          schoolType: schoolType || '(null)',
          totalScore: totalScore || '(null)',
          examAttempt: examAttempt || '(null)',
          branch: branch || '(null)',
          admissionChannel: admissionChannel || '(null)',
          stage: stage || '(null)',
          studyType: studyType || '(null)',
          level: level || '(null)',
          academicYear: academicYear || '(null)',
          semester: semester || '(null)'
        });
        console.log(`  🔍 قيمة stage قبل الإدراج:`, {
          stageRaw: stageRaw,
          stage: stage,
          stageType: typeof stage,
          stageLength: stage ? stage.length : 0,
          stageIsNull: stage === null,
          stageIsUndefined: stage === undefined
        });
        
        // التحقق من جميع القيم في insertParams
        console.log(`  🔍 التحقق من insertParams للقيم الجديدة:`, {
          province_index11: { 
            value: insertParams[11], 
            type: typeof insertParams[11], 
            isNull: insertParams[11] === null,
            isEmpty: insertParams[11] === '',
            length: insertParams[11] ? String(insertParams[11]).length : 0,
            raw: insertParams[11]
          },
          area_index12: { value: insertParams[12], type: typeof insertParams[12], isNull: insertParams[12] === null },
          schoolType_index14: { value: insertParams[14], type: typeof insertParams[14], isNull: insertParams[14] === null },
          totalScore_index17: { value: insertParams[17], type: typeof insertParams[17], isNull: insertParams[17] === null },
          examAttempt_index18: { value: insertParams[18], type: typeof insertParams[18], isNull: insertParams[18] === null },
          branch_index21: { value: insertParams[21], type: typeof insertParams[21], isNull: insertParams[21] === null },
          stage_index25: { value: insertParams[25], type: typeof insertParams[25], isNull: insertParams[25] === null },
          admissionChannel_index26: { value: insertParams[26], type: typeof insertParams[26], isNull: insertParams[26] === null },
          studyType_index27: { value: insertParams[27], type: typeof insertParams[27], isNull: insertParams[27] === null },
          level_index28: { value: insertParams[28], type: typeof insertParams[28], isNull: insertParams[28] === null },
          academicYear_index29: { value: insertParams[29], type: typeof insertParams[29], isNull: insertParams[29] === null },
          semester_index30: { value: insertParams[30], type: typeof insertParams[30], isNull: insertParams[30] === null }
        });

        // التحقق من قيمة province قبل الإدراج
        console.log(`  🔍 قيمة province قبل الإدراج:`, {
          province: province,
          provinceType: typeof province,
          isNull: province === null,
          isEmpty: province === '',
          inInsertParams: insertParams[11],
          insertParams11Type: typeof insertParams[11]
        });
        
        try {
          await query(insertQuery, insertParams);
          added++;
          console.log(`✅ تم إضافة الطالب "${fullName}" بنجاح`);
        } catch (dbError) {
          const dbErrorMessage = dbError instanceof Error ? dbError.message : 'خطأ غير معروف في قاعدة البيانات';
          console.error(`❌ خطأ في قاعدة البيانات عند إضافة الطالب "${fullName}":`, dbErrorMessage);
          console.error(`📋 تفاصيل الخطأ الكاملة:`, dbError);
          console.error(`📋 insertParams length:`, insertParams.length);
          console.error(`📋 insertParams[11] (province):`, insertParams[11]);
          console.error(`📋 insertParams:`, insertParams);
          throw dbError; // إعادة رمي الخطأ للتعامل معه في catch الخارجي
        }
        
        // التحقق من القيم المحفوظة
        const verifyQuery = await query(
          `SELECT province, area, secondary_school_type, secondary_total_score, exam_attempt, branch, admission_channel, admission_type, study_type, level, academic_year, semester 
           FROM student_affairs.students WHERE university_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [university_id]
        );
        if (verifyQuery.rows.length > 0) {
          console.log(`  ✅ القيم المحفوظة في قاعدة البيانات:`, verifyQuery.rows[0]);
          console.log(`  🔍 تفاصيل المحافظة المحفوظة:`, {
            province: verifyQuery.rows[0].province,
            provinceType: typeof verifyQuery.rows[0].province,
            isNull: verifyQuery.rows[0].province === null,
            isEmpty: verifyQuery.rows[0].province === '',
            length: verifyQuery.rows[0].province ? String(verifyQuery.rows[0].province).length : 0,
            expected: province,
            matches: verifyQuery.rows[0].province === province
          });
          
          // إذا كانت المحافظة null في قاعدة البيانات لكنها موجودة في insertParams
          if (!verifyQuery.rows[0].province && province) {
            console.error(`  ⚠️ تحذير: المحافظة كانت "${province}" في insertParams لكنها null في قاعدة البيانات!`);
            console.error(`  ⚠️ محاولة تحديث المحافظة يدوياً...`);
            console.error(`  ⚠️ university_id:`, university_id);
            console.error(`  ⚠️ province value:`, province);
            try {
              const updateResult = await query(
                `UPDATE student_affairs.students SET province = $1 WHERE university_id = $2 RETURNING province`,
                [province, university_id]
              );
              if (updateResult.rows.length > 0) {
                console.log(`  ✅ تم تحديث المحافظة بنجاح إلى "${province}"`);
                console.log(`  ✅ القيمة المحدثة:`, updateResult.rows[0].province);
              } else {
                console.error(`  ❌ لم يتم العثور على الطالب لتحديث المحافظة`);
              }
            } catch (updateError) {
              console.error(`  ❌ خطأ في تحديث المحافظة:`, updateError);
              const errorMessage = updateError instanceof Error ? updateError.message : 'خطأ غير معروف';
              console.error(`  ❌ تفاصيل الخطأ:`, errorMessage);
            }
          } else if (verifyQuery.rows[0].province) {
            console.log(`  ✅ المحافظة محفوظة بشكل صحيح: "${verifyQuery.rows[0].province}"`);
          } else {
            console.log(`  ⚠️ المحافظة null في قاعدة البيانات و insertParams`);
          }
        }
      } catch (error) {
        const studentName = fullName || (row && row[0] ? String(row[0]).trim() : `الصف ${i + 1}`);
        const errorMessage = error instanceof Error ? error.message : 'خطأ غير معروف';
        const errorStack = error instanceof Error ? error.stack : '';
        console.error(`❌ خطأ في إضافة الطالب "${studentName}" (الصف ${i + 1}):`, errorMessage);
        console.error(`📋 تفاصيل الخطأ:`, error);
        if (errorStack) {
          console.error(`📚 Stack trace:`, errorStack);
        }
        failed++;
        errors.push(`خطأ في إضافة "${studentName}" (الصف ${i + 1}): ${errorMessage}`);
      }
    }

    console.log(`📊 انتهى الاستيراد: ${added} نجح، ${failed} فشل من أصل ${data.length - startRow}`);

    return NextResponse.json({
      success: true,
      data: {
        added,
        failed,
        total: data.length - startRow,
        errors: errors.length > 0 ? errors.slice(0, 10) : [] // أول 10 أخطاء فقط
      },
      message: `تم إضافة ${added} طالب من أصل ${data.length - startRow}`
    });
  } catch (error) {
    console.error('خطأ في الاستيراد من Excel:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء الاستيراد من الملف' },
      { status: 500 }
    );
  }
}

