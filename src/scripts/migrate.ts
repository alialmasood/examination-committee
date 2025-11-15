#!/usr/bin/env tsx

import { runMigrations } from '../lib/migrations';
import { closePool } from '../lib/db';

async function main() {
  try {
    console.log('🚀 بدء تشغيل migrations...\n');
    
    await runMigrations();
    
    console.log('\n✅ تم تشغيل جميع migrations بنجاح!');
    
  } catch (error) {
    console.error('\n❌ خطأ في تشغيل migrations:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
