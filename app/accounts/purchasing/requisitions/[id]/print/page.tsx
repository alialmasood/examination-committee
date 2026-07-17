'use client';

/** صفحة طباعة طلب شراء — placeholder 7.A */
export default function PrintPurchaseRequisitionPage() {
  return (
    <main className="p-8 print:p-4" dir="rtl">
      <div className="print:hidden mb-4">
        <button type="button" onClick={() => window.print()} className="rounded border px-3 py-1">
          طباعة
        </button>
      </div>
      <h1 className="text-xl font-bold">كلية الشرق — طلب شراء</h1>
      <p className="mt-4 text-sm text-gray-600">توقيع المحاسب · تدقيق</p>
    </main>
  );
}
