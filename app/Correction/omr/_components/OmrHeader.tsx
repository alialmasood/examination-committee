export function OmrHeader() {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <h1 className="text-xl font-bold text-slate-900">التصحيح الإلكتروني (PDF متعدد الصفحات)</h1>
      <p className="mt-1 text-sm text-slate-600">
        ارفع ملف PDF واحد يحتوي شيتات الطلاب، وسيتم تحليل كل صفحة على حدة واستخراج رمز الطالب والإجابات ثم
        مقارنتها مع مفتاح الإجابة الهيكلي المرتبط بالامتحان.
      </p>
      <p className="mt-2 text-xs text-slate-500">
        لا توجد أي مقارنة بصرية مباشرة بين صورة مفتاح وصورة طالب؛ المقارنة تتم فقط بعد تحويل كل طرف إلى بيانات
        structured answers.
      </p>
    </section>
  );
}
