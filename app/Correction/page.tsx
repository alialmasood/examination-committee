export default function CorrectionPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-blue-50 to-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <section className="w-full max-w-3xl rounded-2xl border border-slate-200/80 bg-white/95 p-8 shadow-2xl shadow-slate-300/40 backdrop-blur-sm sm:p-10 lg:p-12">
          <div className="mb-8 flex items-center justify-center">
            <span className="h-1.5 w-24 rounded-full bg-blue-900" />
          </div>

          <div className="space-y-4 text-center">
            <p className="text-sm font-semibold tracking-[0.2em] text-blue-900 sm:text-base">
              نظام التصحيح الالكتروني
            </p>

            <h1 className="text-2xl font-bold leading-relaxed text-slate-900 sm:text-3xl lg:text-4xl">
              كلية الشرق التقنية التخصصية
            </h1>
          </div>

          <div className="mt-8 border-t border-slate-200 pt-6 text-center">
            <p className="text-sm text-slate-600 sm:text-base">
              واجهة الدخول الرسمية
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
