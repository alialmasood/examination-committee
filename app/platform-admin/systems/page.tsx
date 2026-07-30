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

type CreatableSystem = {
  code: string;
  name_ar: string;
  base_path: string;
};

/**
 * إدارة حسابات الأنظمة من بوابة مركزية —
 * إنشاء، كلمات المرور، التعطيل، والحذف.
 */
export default function PlatformSystemsPasswordsPage() {
  const [systems, setSystems] = useState<SystemRow[]>([]);
  const [creatableSystems, setCreatableSystems] = useState<CreatableSystem[]>([]);
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

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createForm, setCreateForm] = useState({
    username: '',
    full_name: '',
    email: '',
    password: '',
    confirm_password: '',
    system_code: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [systemsRes, optionsRes] = await Promise.all([
        fetchWithAuth('/api/admin/systems'),
        fetchWithAuth('/api/admin/users'),
      ]);
      const systemsBody = await systemsRes.json().catch(() => ({}));
      const optionsBody = await optionsRes.json().catch(() => ({}));

      if (!systemsRes.ok || !systemsBody.success) {
        setError(systemsBody.message || 'تعذر تحميل الأنظمة');
        setSystems([]);
        return;
      }
      setSystems(Array.isArray(systemsBody.data?.systems) ? systemsBody.data.systems : []);

      if (optionsRes.ok && optionsBody.success) {
        setCreatableSystems(
          Array.isArray(optionsBody.data?.systems) ? optionsBody.data.systems : []
        );
      }
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

  function openCreateModal(preferredSystemCode?: string) {
    setCreateError('');
    setCreateForm({
      username:
        preferredSystemCode === 'DEAN'
          ? 'dean'
          : preferredSystemCode === 'GENERAL_SUPERVISION'
            ? 'rahmaan'
            : '',
      full_name:
        preferredSystemCode === 'DEAN'
          ? 'السيد عميد الكلية'
          : preferredSystemCode === 'GENERAL_SUPERVISION'
            ? 'لوحة إشراف عامة'
            : '',
      email: '',
      password: '',
      confirm_password: '',
      system_code: preferredSystemCode || creatableSystems[0]?.code || '',
    });
    setCreateOpen(true);
  }

  function closeCreateModal() {
    if (creating) return;
    setCreateOpen(false);
    setCreateError('');
  }

  async function submitCreate() {
    if (!createForm.system_code) {
      setCreateError('اختر صلاحية / وظيفة الحساب');
      return;
    }
    if (
      createForm.system_code !== 'DEAN' &&
      createForm.system_code !== 'GENERAL_SUPERVISION' &&
      createForm.username.trim().length < 3
    ) {
      setCreateError('اسم المستخدم يجب ألا يقل عن 3 أحرف');
      return;
    }
    if (
      createForm.system_code !== 'DEAN' &&
      createForm.system_code !== 'GENERAL_SUPERVISION' &&
      !createForm.full_name.trim()
    ) {
      setCreateError('الاسم الكامل مطلوب');
      return;
    }
    if (createForm.password.length < 6) {
      setCreateError('كلمة المرور يجب ألا تقل عن 6 أحرف');
      return;
    }
    if (createForm.password !== createForm.confirm_password) {
      setCreateError('تأكيد كلمة المرور غير مطابق');
      return;
    }

    setCreating(true);
    setCreateError('');
    try {
      const res = await fetchWithAuth('/api/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: createForm.username.trim(),
          full_name: createForm.full_name.trim(),
          email: createForm.email.trim() || undefined,
          password: createForm.password,
          confirm_password: createForm.confirm_password,
          system_code: createForm.system_code,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setCreateError(body.message || 'تعذر إنشاء الحساب');
        return;
      }
      setToast(body.message || 'تم إنشاء الحساب بنجاح');
      setCreateOpen(false);
      await load();
    } catch {
      setCreateError('تعذر الاتصال بالخادم');
    } finally {
      setCreating(false);
    }
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

  const selectedCreateSystem = creatableSystems.find(
    (s) => s.code === createForm.system_code
  );
  const isDeanCreate = createForm.system_code === 'DEAN';
  const isGeneralSupervisionCreate = createForm.system_code === 'GENERAL_SUPERVISION';
  const isFixedAccountCreate = isDeanCreate || isGeneralSupervisionCreate;

  return (
    <div className="p-6" dir="rtl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">إدارة حسابات الأنظمة</h2>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed max-w-3xl">
            إنشاء حسابات جديدة مع تحديد الصلاحية (شؤون الطلبة، الحسابات، مراقبة العميد…)،
            وتغيير كلمات المرور وتعطيل أو حذف الحسابات من مكان واحد.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openCreateModal()}
          className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
        >
          إنشاء حساب جديد
        </button>
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
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 space-y-3">
          <p>لا توجد أنظمة أو حسابات مسجّلة حالياً.</p>
          <button
            type="button"
            onClick={() => openCreateModal()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            إنشاء أول حساب
          </button>
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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openCreateModal(system.code)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    إضافة حساب لهذا النظام
                  </button>
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

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-900 mb-1">إنشاء حساب جديد</h3>
            <p className="text-sm text-slate-600 mb-4">
              حدّد وظيفة الحساب أولاً (النظام الذي سيدخل إليه)، ثم أدخل بيانات الدخول.
            </p>

            <label className="block text-sm text-slate-700 mb-1">
              صلاحية / وظيفة الحساب <span className="text-red-600">*</span>
            </label>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3 bg-white"
              value={createForm.system_code}
              disabled={creating}
              onChange={(e) => {
                const code = e.target.value;
                setCreateForm((prev) => ({
                  ...prev,
                  system_code: code,
                  username:
                    code === 'DEAN'
                      ? 'dean'
                      : code === 'GENERAL_SUPERVISION'
                        ? 'rahmaan'
                        : prev.username === 'dean' || prev.username === 'rahmaan'
                          ? ''
                          : prev.username,
                  full_name:
                    code === 'DEAN'
                      ? prev.full_name || 'السيد عميد الكلية'
                      : code === 'GENERAL_SUPERVISION'
                        ? prev.full_name || 'لوحة إشراف عامة'
                        : prev.full_name,
                }));
              }}
            >
              <option value="">— اختر النظام —</option>
              {creatableSystems.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name_ar} ({s.code})
                </option>
              ))}
            </select>
            {selectedCreateSystem && (
              <p className="text-xs text-slate-500 mb-3" dir="ltr">
                المسار: {selectedCreateSystem.base_path}
              </p>
            )}

            <label className="block text-sm text-slate-700 mb-1">اسم المستخدم</label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3 font-mono disabled:bg-slate-50"
              dir="ltr"
              value={
                isDeanCreate
                  ? 'dean'
                  : isGeneralSupervisionCreate
                    ? 'rahmaan'
                    : createForm.username
              }
              disabled={creating || isFixedAccountCreate}
              autoComplete="off"
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, username: e.target.value }))
              }
              placeholder="مثال: accounts أو user5"
            />
            {isDeanCreate && (
              <p className="text-xs text-amber-700 mb-3">
                حساب مراقبة العميد يستخدم اسم المستخدم الثابت <span className="font-mono">dean</span>
              </p>
            )}
            {isGeneralSupervisionCreate && (
              <p className="text-xs text-amber-700 mb-3">
                حساب لوحة إشراف عامة يستخدم اسم المستخدم الثابت{' '}
                <span className="font-mono">rahmaan</span>
              </p>
            )}

            <label className="block text-sm text-slate-700 mb-1">الاسم الكامل</label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
              value={createForm.full_name}
              disabled={creating}
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, full_name: e.target.value }))
              }
              placeholder="الاسم الظاهر في النظام"
            />

            <label className="block text-sm text-slate-700 mb-1">البريد (اختياري)</label>
            <input
              type="email"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
              dir="ltr"
              value={createForm.email}
              disabled={creating}
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, email: e.target.value }))
              }
            />

            <label className="block text-sm text-slate-700 mb-1">كلمة المرور</label>
            <input
              type="password"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
              value={createForm.password}
              disabled={creating}
              autoComplete="new-password"
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, password: e.target.value }))
              }
              placeholder="6 أحرف على الأقل"
            />

            <label className="block text-sm text-slate-700 mb-1">تأكيد كلمة المرور</label>
            <input
              type="password"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
              value={createForm.confirm_password}
              disabled={creating}
              autoComplete="new-password"
              onChange={(e) =>
                setCreateForm((prev) => ({
                  ...prev,
                  confirm_password: e.target.value,
                }))
              }
            />

            {createError && <p className="text-sm text-red-600 mb-3">{createError}</p>}

            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                className="border rounded-lg px-4 py-2 text-sm"
                disabled={creating}
                onClick={closeCreateModal}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50"
                disabled={creating}
                onClick={() => void submitCreate()}
              >
                {creating ? 'جارٍ الإنشاء…' : 'إنشاء الحساب'}
              </button>
            </div>
          </div>
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
