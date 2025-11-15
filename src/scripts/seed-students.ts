#!/usr/bin/env tsx

import { query } from '../lib/db';
import { closePool } from '../lib/db';

async function main() {
  try {
    console.log('🚀 بدء إضافة بيانات الطلاب التجريبية...\n');
    
    // بيانات الطلاب التجريبية
    const students = [
      {
        first_name: 'أحمد',
        last_name: 'محمد',
        middle_name: 'علي',
        national_id: '1234567890',
        birth_date: '2000-05-15',
        birth_place: 'الرياض',
        gender: 'male',
        nationality: 'سعودي',
        religion: 'مسلم',
        marital_status: 'single',
        phone: '0501234567',
        email: 'ahmed.mohammed@student.edu',
        address: 'شارع الملك فهد، الرياض',
        city: 'الرياض',
        postal_code: '12345',
        emergency_contact_name: 'محمد علي',
        emergency_contact_relationship: 'أب',
        emergency_contact_phone: '0507654321',
        secondary_school_name: 'ثانوية الملك عبدالعزيز',
        secondary_school_type: 'public',
        secondary_graduation_year: '2018',
        secondary_gpa: 3.8,
        secondary_total_score: 95.5,
        admission_type: 'regular',
        department_id: null, // سيتم ربطه بقسم لاحقاً
        major: 'هندسة البرمجيات',
        level: 'bachelor',
        semester: 'الأول',
        academic_year: '2024-2025',
        admission_score: 85.5,
        status: 'active'
      },
      {
        first_name: 'فاطمة',
        last_name: 'أحمد',
        middle_name: 'حسن',
        national_id: '1234567891',
        birth_date: '2001-03-22',
        birth_place: 'جدة',
        gender: 'female',
        nationality: 'سعودي',
        religion: 'مسلم',
        marital_status: 'single',
        phone: '0501234568',
        email: 'fatima.ahmed@student.edu',
        address: 'شارع التحلية، جدة',
        city: 'جدة',
        postal_code: '21432',
        emergency_contact_name: 'أحمد حسن',
        emergency_contact_relationship: 'أب',
        emergency_contact_phone: '0507654322',
        secondary_school_name: 'ثانوية البنات الأولى',
        secondary_school_type: 'public',
        secondary_graduation_year: '2019',
        secondary_gpa: 3.9,
        secondary_total_score: 97.2,
        admission_type: 'regular',
        department_id: null,
        major: 'هندسة الكهرباء',
        level: 'bachelor',
        semester: 'الأول',
        academic_year: '2024-2025',
        admission_score: 88.3,
        status: 'active'
      },
      {
        first_name: 'محمد',
        last_name: 'عبدالله',
        middle_name: 'السعد',
        national_id: '1234567892',
        birth_date: '1999-12-10',
        birth_place: 'الدمام',
        gender: 'male',
        nationality: 'سعودي',
        religion: 'مسلم',
        marital_status: 'single',
        phone: '0501234569',
        email: 'mohammed.abdullah@student.edu',
        address: 'حي الفيصلية، الدمام',
        city: 'الدمام',
        postal_code: '31421',
        emergency_contact_name: 'عبدالله السعد',
        emergency_contact_relationship: 'أب',
        emergency_contact_phone: '0507654323',
        secondary_school_name: 'ثانوية الملك سعود',
        secondary_school_type: 'public',
        secondary_graduation_year: '2017',
        secondary_gpa: 3.7,
        secondary_total_score: 92.8,
        admission_type: 'conditional',
        department_id: null,
        major: 'الطب العام',
        level: 'bachelor',
        semester: 'الثاني',
        academic_year: '2024-2025',
        admission_score: 91.5,
        status: 'active'
      },
      {
        first_name: 'نورا',
        last_name: 'خالد',
        middle_name: 'المطيري',
        national_id: '1234567893',
        birth_date: '1998-08-05',
        birth_place: 'الرياض',
        gender: 'female',
        nationality: 'سعودي',
        religion: 'مسلم',
        marital_status: 'married',
        phone: '0501234570',
        email: 'nora.khalid@student.edu',
        address: 'حي النرجس، الرياض',
        city: 'الرياض',
        postal_code: '12346',
        emergency_contact_name: 'خالد المطيري',
        emergency_contact_relationship: 'أب',
        emergency_contact_phone: '0507654324',
        secondary_school_name: 'ثانوية البنات الثانية',
        secondary_school_type: 'private',
        secondary_graduation_year: '2016',
        secondary_gpa: 3.95,
        secondary_total_score: 98.1,
        admission_type: 'regular',
        department_id: null,
        major: 'إدارة الأعمال',
        level: 'master',
        semester: 'الأول',
        academic_year: '2024-2025',
        admission_score: 89.7,
        status: 'active'
      },
      {
        first_name: 'عبدالرحمن',
        last_name: 'سعد',
        middle_name: 'العتيبي',
        national_id: '1234567894',
        birth_date: '2002-01-18',
        birth_place: 'الطائف',
        gender: 'male',
        nationality: 'سعودي',
        religion: 'مسلم',
        marital_status: 'single',
        phone: '0501234571',
        email: 'abdulrahman.saad@student.edu',
        address: 'حي الشهداء، الطائف',
        city: 'الطائف',
        postal_code: '26521',
        emergency_contact_name: 'سعد العتيبي',
        emergency_contact_relationship: 'أب',
        emergency_contact_phone: '0507654325',
        secondary_school_name: 'ثانوية الطائف',
        secondary_school_type: 'public',
        secondary_graduation_year: '2020',
        secondary_gpa: 3.6,
        secondary_total_score: 89.3,
        admission_type: 'regular',
        department_id: null,
        major: 'علوم الحاسوب',
        level: 'bachelor',
        semester: 'الأول',
        academic_year: '2024-2025',
        admission_score: 82.1,
        status: 'suspended'
      }
    ];
    
    console.log(`📝 إضافة ${students.length} طالب...`);
    
    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      
      // توليد الرقم الجامعي
      const universityIdResult = await query('SELECT student_affairs.generate_university_id() as university_id');
      const university_id = universityIdResult.rows[0].university_id;
      
    // إدراج الطالب
    const insertQuery = `
      INSERT INTO student_affairs.students (
        university_id, student_number, first_name, last_name, middle_name, national_id, birth_date, birth_place,
        gender, nationality, religion, marital_status, phone, email, address, city, postal_code,
        emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
        secondary_school_name, secondary_school_type, secondary_graduation_year, secondary_gpa,
        secondary_total_score, admission_type, department_id, major, level, semester, academic_year,
        admission_score, status, registration_date
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36
      ) RETURNING id, university_id
    `;
      
      const result = await query(insertQuery, [
        university_id,
        university_id, // student_number
        student.first_name,
        student.last_name,
        student.middle_name,
        student.national_id,
        student.birth_date,
        student.birth_place,
        student.gender,
        student.nationality,
        student.religion,
        student.marital_status,
        student.phone,
        student.email,
        student.address,
        student.city,
        student.postal_code,
        student.emergency_contact_name,
        student.emergency_contact_relationship,
        student.emergency_contact_phone,
        student.secondary_school_name,
        student.secondary_school_type,
        student.secondary_graduation_year,
        student.secondary_gpa,
        student.secondary_total_score,
        student.admission_type,
        student.department_id,
        student.major,
        student.level,
        student.semester,
        student.academic_year,
        student.admission_score,
        student.status,
        new Date().toISOString().split('T')[0]
      ]);
      
      const newStudent = result.rows[0];
      console.log(`✅ تم إضافة الطالب: ${student.first_name} ${student.last_name} (${newStudent.university_id})`);
    }
    
    console.log('\n🎉 تم إضافة جميع الطلاب بنجاح!');
    console.log('\n📊 ملخص البيانات:');
    console.log(`   - إجمالي الطلاب: ${students.length}`);
    console.log('   - الأقسام: علوم الحاسوب، الهندسة، الطب، إدارة الأعمال');
    console.log('   - المراحل: البكالوريوس، الماجستير');
    console.log('   - الحالات: نشط، معلق');
    
  } catch (error) {
    console.error('\n❌ خطأ في إضافة الطلاب:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
