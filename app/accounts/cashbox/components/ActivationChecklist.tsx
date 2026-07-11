'use client';

type Item = { label: string; pass: boolean };

type Props = {
  open: boolean;
  items: Item[];
  canSubmit: boolean;
  busy: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

export default function ActivationChecklist({
  open,
  items,
  canSubmit,
  busy,
  error,
  onConfirm,
  onClose,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="px-4 py-3 border-b font-semibold text-gray-900">
          تأكيد تفعيل الصندوق
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-gray-600">
            تحقق من استيفاء الشروط قبل التفعيل. لا يمكن التراجع بسهولة بعد التشغيل.
          </p>
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.label}
                className={`text-sm flex items-start gap-2 ${
                  item.pass ? 'text-green-800' : 'text-red-800'
                }`}
              >
                <span>{item.pass ? '✓' : '✗'}</span>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
          {error && (
            <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}
          {!canSubmit && (
            <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              أكمل الشروط الناقصة قبل إرسال طلب التفعيل.
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t flex justify-end gap-2">
          <button
            type="button"
            className="px-4 py-2 rounded-md border text-sm"
            onClick={onClose}
            disabled={busy}
          >
            إلغاء
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-md bg-red-900 text-white text-sm disabled:opacity-50"
            disabled={!canSubmit || busy}
            onClick={onConfirm}
          >
            {busy ? 'جاري التفعيل…' : 'تأكيد التفعيل'}
          </button>
        </div>
      </div>
    </div>
  );
}
