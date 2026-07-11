'use client';

import { useEffect, useMemo, useState } from 'react';
import { CostCenter, accountsFetch } from './types';

type TreeNode = CostCenter & { children: TreeNode[] };

function buildTree(items: CostCenter[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  items.forEach((item) => map.set(item.id, { ...item, children: [] }));
  const roots: TreeNode[] = [];
  map.forEach((node) => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function TreeRows({
  nodes,
  onEdit,
  onToggle,
  onAddChild,
}: {
  nodes: TreeNode[];
  onEdit: (n: CostCenter) => void;
  onToggle: (id: string) => void;
  onAddChild: (parentId: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.id}>
          <div
            className={`flex flex-wrap items-center justify-between gap-2 border-b py-2 ${
              node.is_active ? '' : 'opacity-60'
            }`}
            style={{ paddingRight: `${(node.level - 1) * 16}px` }}
          >
            <div>
              <span className="font-medium">{node.code}</span>
              <span className="mx-2 text-gray-700">{node.name_ar}</span>
              <span className="text-xs text-gray-500">مستوى {node.level}</span>
              {node.is_group && (
                <span className="mr-2 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">تجميعي</span>
              )}
              {!node.is_active && (
                <span className="mr-2 text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded">معطّل</span>
              )}
            </div>
            <div className="flex gap-2 text-sm">
              <button className="text-blue-700 hover:underline" onClick={() => onEdit(node)}>
                تعديل
              </button>
              <button className="text-indigo-700 hover:underline" onClick={() => onAddChild(node.id)}>
                فرعي
              </button>
              <button className="text-orange-700 hover:underline" onClick={() => onToggle(node.id)}>
                {node.is_active ? 'تعطيل' : 'تفعيل'}
              </button>
            </div>
          </div>
          {node.children.length > 0 && (
            <TreeRows nodes={node.children} onEdit={onEdit} onToggle={onToggle} onAddChild={onAddChild} />
          )}
        </div>
      ))}
    </>
  );
}

export default function CostCentersPanel() {
  const [items, setItems] = useState<CostCenter[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name_ar: string }[]>([]);
  const [q, setQ] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: '',
    name_ar: '',
    parent_id: '',
    is_group: false,
    department_id: '',
    description: '',
  });

  const tree = useMemo(() => buildTree(items), [items]);

  const load = async (search = q) => {
    const res = await accountsFetch<CostCenter[]>(
      `/api/accounts/cost-centers${search ? `?q=${encodeURIComponent(search)}` : ''}`
    );
    if (res.success && res.data) {
      setItems(res.data);
      if (Array.isArray(res.departments)) {
        setDepartments(res.departments as { id: string; name_ar: string }[]);
      }
    } else setError(res.message || 'تعذر جلب مراكز الكلفة');
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notify = (ok: boolean, text?: string) => {
    setError(ok ? null : text || 'فشلت العملية');
    setMessage(ok ? text || 'تمت العملية بنجاح' : null);
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({
      code: '',
      name_ar: '',
      parent_id: '',
      is_group: false,
      department_id: '',
      description: '',
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      code: form.code,
      name_ar: form.name_ar,
      parent_id: form.parent_id || null,
      is_group: form.is_group,
      department_id: form.department_id || null,
      description: form.description || null,
    };

    const res = editingId
      ? await accountsFetch(`/api/accounts/cost-centers/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      : await accountsFetch('/api/accounts/cost-centers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

    notify(Boolean(res.success), res.message);
    if (res.success) {
      resetForm();
      await load();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <input
          className="border rounded-md px-3 py-2 flex-1 text-right"
          placeholder="بحث بالرمز أو الاسم..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="button"
          className="bg-gray-800 text-white px-4 py-2 rounded-md"
          onClick={() => load(q)}
        >
          بحث
        </button>
      </div>

      <form onSubmit={submit} className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
        <h2 className="font-semibold text-gray-900">
          {editingId ? 'تعديل مركز كلفة' : form.parent_id ? 'إضافة مركز فرعي' : 'إضافة مركز رئيسي'}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            className="border rounded-md px-3 py-2"
            placeholder="الرمز"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
          />
          <input
            className="border rounded-md px-3 py-2"
            placeholder="الاسم بالعربية"
            value={form.name_ar}
            onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
            required
          />
          <select
            className="border rounded-md px-3 py-2"
            value={form.parent_id}
            onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
          >
            <option value="">بدون أب (رئيسي)</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} — {item.name_ar}
              </option>
            ))}
          </select>
          <select
            className="border rounded-md px-3 py-2"
            value={form.department_id}
            onChange={(e) => setForm({ ...form, department_id: e.target.value })}
          >
            <option value="">بدون ربط بقسم</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name_ar}
              </option>
            ))}
          </select>
          <input
            className="border rounded-md px-3 py-2 md:col-span-2"
            placeholder="الوصف"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.is_group}
            onChange={(e) => setForm({ ...form, is_group: e.target.checked })}
          />
          مركز تجميعي
        </label>
        <div className="flex gap-2">
          <button type="submit" className="bg-red-900 text-white px-4 py-2 rounded-md hover:bg-red-800">
            حفظ
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="bg-gray-200 px-4 py-2 rounded-md">
              إلغاء
            </button>
          )}
        </div>
      </form>

      {message && <p className="text-green-700 text-sm">{message}</p>}
      {error && <p className="text-red-700 text-sm">{error}</p>}

      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <TreeRows
          nodes={tree}
          onEdit={(node) => {
            setEditingId(node.id);
            setForm({
              code: node.code,
              name_ar: node.name_ar,
              parent_id: node.parent_id || '',
              is_group: node.is_group,
              department_id: node.department_id || '',
              description: node.description || '',
            });
          }}
          onToggle={async (id) => {
            const res = await accountsFetch(`/api/accounts/cost-centers/${id}/toggle-status`, {
              method: 'POST',
            });
            notify(Boolean(res.success), res.message);
            if (res.success) await load();
          }}
          onAddChild={(parentId) => {
            setEditingId(null);
            setForm({
              code: '',
              name_ar: '',
              parent_id: parentId,
              is_group: false,
              department_id: '',
              description: '',
            });
          }}
        />
        {items.length === 0 && (
          <p className="text-center text-gray-500 py-6">لا توجد مراكز كلفة بعد</p>
        )}
      </div>
    </div>
  );
}
