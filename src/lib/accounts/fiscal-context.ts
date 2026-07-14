/**
 * إعادة تصدير `assertFiscalContextForEntry` من journal-entries.ts — Sprint A
 * (Architecture Hardening). التنفيذ الفعلي يبقى في journal-entries.ts (منطق مرتبط
 * بشكل وثيق بترحيل القيود وschema السنوات/الفترات المالية)؛ هذا الملف يوفّر نقطة
 * استيراد مستقرة تحت اسم "fiscal-context" لبقية موديولات accounts/ دون الحاجة لمعرفة
 * أن التنفيذ يعيش في journal-entries.ts، ودون خطر أي دائرة استيراد (journal-entries.ts
 * لا يستورد من هذا الملف).
 */
export { assertFiscalContextForEntry } from './journal-entries';
