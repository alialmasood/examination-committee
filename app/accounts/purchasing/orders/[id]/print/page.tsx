'use client';

/** صفحة طباعة أمر شراء — placeholder 7.A */
export default function PrintPurchaseOrderPage() {
  return (
    <main className="p-8 print:p-4" dir="rtl">
      <div className="print:hidden mb-4">
        <button type="button" onClick={() => window.print()} className="rounded border px-3 py-1">
          طباعة
        </button>
      </div>
      <h1 className="text-xl font-bold">كلية الشرق — أمر شراء</h1>
      <p className="mt-4 text-sm text-gray-600">توقيع المحاسب · تدقيق</p>
    </main>
  );
}
