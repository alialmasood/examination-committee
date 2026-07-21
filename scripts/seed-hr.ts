import { seedHR } from '../src/lib/seed-hr';

async function main() {
  try {
    console.log('بدء إنشاء نظام HR والمستخدم...');
    await seedHR();
    console.log('✅ تم بنجاح!');
    process.exit(0);
  } catch (error) {
    console.error('❌ خطأ:', error);
    process.exit(1);
  }
}

main();

