'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth } from '@/src/lib/fetch-with-auth';

type SystemUser = {
  id: string;
  username: string;
  full_name: string | null;
  email: string | null;
  is_active: boolean;
  role: string;
};

type SystemRow = {
  id: string;
  code: string;
  name_ar: string;
  base_path: string;
  is_active: boolean;
  users: SystemUser[];
};

/**
 * إدارة كلمات مرور مستخدمي الأنظمة من بوابة مركزية —
 * دون الحاجة للدخول إلى كل نظام على حدة.
 */
export default function PlatformSystemsPasswordsPage() {
  const [systems, setSystems] = useState<SystemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<SystemUser | null>(null);
  const [selectedSystemName, setSelectedSystemName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchWithAuth('/api/admin/systems');
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setError(body.message || 'تعذر تحميل الأنظمة');
        setSystems([]);
        return;
      }
      setSystems(Array.isArray(body.data?.systems) ? body.data.systems : []);
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  function openPasswordModal(system: SystemRow, user: SystemUser) {
    setSelectedSystemName(system.name_ar || system.code);
    setSelectedUser(user);
    setPassword('');
    setConfirmPassword('');
    setFormError('');
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setSelectedUser(null);
    setFormError('');
  }

  async function submitPassword() {
    if (!selectedUser) return;
    if (password.length < 6) {
      setFormError('كلمة المرور يجب ألا تقل عن 6 أحرف');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('تأكيد كلمة المرور غير مطابق');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const res = await fetchWithAuth(`/api/admin/users/${selectedUser.id}/password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          password,
          confirm_password: confirmPassword,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setFormError(body.message || 'تعذر تحديث كلمة المرور');
        return;
      }
      setToast(body.message || 'تم تحديث كلمة المرور بنجاح');
      setModalOpen(false);
      setSelectedUser(null);
      setPassword('');
      setConfirmPassword('');
    } catch {
      setFormError('تعذر الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  }

  async function toggleUserStatus(user: SystemUser) {
    const nextActive = !user.is_active;
    setStatusBusyId(user.id);
    try {
      const res = await fetchWithAuth(`/api/admin/users/${user.id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ is_active: nextActive }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setToast(body.message || 'تعذر تحديث حالة الحساب');
        return;
      }
      setSystems((prev) =>
        prev.map((system) => ({
          ...system,
          users: system.users.map((u) =>
            u.id === user.id ? { ...u, is_active: nextActive } : u
          ),
        }))
      );
      setToast(body.message || (nextActive ? 'تم تنشيط الحساب' : 'تم تعطيل الحساب'));
    } catch {
      setToast('تعذر الاتصال بالخادم');
    } finally {
      setStatusBusyId(null);
    }
  }

  async function deleteUser(user: SystemUser) {
    const ok = window.confirm(
      `هل تريد حذف حساب «${user.username}» نهائياً؟\nلا يمكن التراجع عن هذا الإجراء.`
    );
    if (!ok) return;

    setDeleteBusyId(user.id);
    try {
      const res = await fetchWithAuth(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setToast(body.message || 'تعذر حذف الحساب');
        return;
      }
      setSystems((prev) =>
        prev.map((system) => ({
          ...system,
          users: system.users.filter((u) => u.id !== user.id),
        }))
      );
      setToast(body.message || 'تم حذف الحساب');
    } catch {
      setToast('تعذر الاتصال بالخادم');
    } finally {
      setDeleteBusyId(null);
    }
  }

  return (
    <div className="p-6" dir="rtl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">كلمات مرور الأنظمة</h2>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed max-w-3xl">
          من هنا تغيّر كلمة مرور مستخدم أي نظام مباشرة — دون الدخول إلى ذلك النظام.
          مفيد للتدوير الدوري لكلمات المرور حفاظاً على أمان العمل.
        </p>
      </div>

      {toast && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {toast}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex flex-wrap items-center justify-between gap-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="text-red-800 underline text-xs"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">جارٍ التحميل…</p>
      ) : systems.length === 0 && !error ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          لا توجد أنظمة مسجّلة حالياً.
        </div>
      ) : (
        <div className="space-y-4">
          {systems.map((system) => (
            <section
              key={system.id}
              className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 bg-slate-50">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{system.name_ar}</h3>
                  <p className="text-xs text-slate-500 mt-0.5" dir="ltr">
                    {system.code} · {system.base_path}
                  </p>
                </div>
                <span
                  className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    system.is_active
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {system.is_active ? 'نشط' : 'غير نشط'}
                </span>
              </div>

              <div className="px-5 py-4">
                {system.users.length === 0 ? (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    لا يوجد مستخدم مرتبط بهذا النظام بعد.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-right">
                      <thead>
                        <tr className="text-slate-500 border-b">
                          <th className="py-2 font-medium">اسم المستخدم</th>
                          <th className="py-2 font-medium">الاسم الكامل</th>
                          <th className="py-2 font-medium">الدور</th>
                          <th className="py-2 font-medium">الحالة</th>
                          <th className="py-2 font-medium">إجراء</th>
                        </tr>
                      </thead>
                      <tbody>
                        {system.users.map((u) => (
                          <tr key={`${system.id}-${u.id}`} className="border-b border-slate-50 last:border-0">
                            <td className="py-3 font-mono" dir="ltr">
                              {u.username}
                            </td>
                            <td className="py-3">{u.full_name || '—'}</td>
                            <td className="py-3">{u.role || '—'}</td>
                            <td className="py-3">
                              {u.is_active ? (
                                <span className="text-emerald-700">نشط</span>
                              ) : (
                                <span className="text-red-600">موقوف</span>
                              )}
                            </td>
                            <td className="py-3">
                              <div className="flex flex-wrap items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => openPasswordModal(system, u)}
                                  className="text-slate-800 hover:text-slate-950 font-medium underline-offset-2 hover:underline"
                                >
                                  تغيير كلمة المرور
                                </button>
                                <button
                                  type="button"
                                  disabled={statusBusyId === u.id || deleteBusyId === u.id}
                                  onClick={() => void toggleUserStatus(u)}
                                  className={`font-medium underline-offset-2 hover:underline disabled:opacity-50 ${
                                    u.is_active
                                      ? 'text-amber-700 hover:text-amber-900'
                                      : 'text-emerald-700 hover:text-emerald-900'
                                  }`}
                                >
                                  {statusBusyId === u.id
                                    ? 'جارٍ التحديث…'
                                    : u.is_active
                                      ? 'تعطيل الحساب'
                                      : 'تنشيط الحساب'}
                                </button>
                                <button
                                  type="button"
                                  disabled={deleteBusyId === u.id || statusBusyId === u.id}
                                  onClick={() => void deleteUser(u)}
                                  className="text-red-700 hover:text-red-900 font-medium underline-offset-2 hover:underline disabled:opacity-50"
                                >
                                  {deleteBusyId === u.id ? 'جارٍ الحذف…' : 'حذف الحساب'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {modalOpen && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5">
            <h3 className="text-lg font-semibold text-slate-900 mb-1">تغيير كلمة المرور</h3>
            <p className="text-sm text-slate-600 mb-4">
              سيتم تحديث كلمة مرور الدخول للمنصة لهذا المستخدم فوراً — دون فتح نظامه.
              <br />
              <span className="mt-2 inline-block">
                النظام: <strong>{selectedSystemName}</strong>
              </span>
              <br />
              المستخدم:{' '}
              <span className="font-mono" dir="ltr">
                {selectedUser.username}
              </span>
            </p>

            <label className="block text-sm text-slate-700 mb-1">كلمة المرور الجديدة</label>
            <input
              type="password"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
              value={password}
              disabled={saving}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="6 أحرف على الأقل"
            />

            <label className="block text-sm text-slate-700 mb-1">تأكيد كلمة المرور</label>
            <input
              type="password"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
              value={confirmPassword}
              disabled={saving}
              autoComplete="new-password"
              onChange={(e) => setConfirmPassword(e.target.value)}
            />

            {formError && <p className="text-sm text-red-600 mb-3">{formError}</p>}

            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                className="border rounded-lg px-4 py-2 text-sm"
                disabled={saving}
                onClick={closeModal}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50"
                disabled={saving}
                onClick={() => void submitPassword()}
              >
                {saving ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
