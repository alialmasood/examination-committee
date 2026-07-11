'use client';

import { ChartAccount, balanceLabel } from './types';

type Props = {
  nodes: ChartAccount[];
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  onEdit: (a: ChartAccount) => void;
  onAddChild: (a: ChartAccount) => void;
  onMove: (a: ChartAccount) => void;
  onToggleStatus: (a: ChartAccount) => void;
  onDelete: (a: ChartAccount) => void;
  onDetails: (a: ChartAccount) => void;
};

function Rows({
  nodes,
  expanded,
  onToggleExpand,
  ...actions
}: Props) {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = (node.children?.length || 0) > 0;
        const isOpen = expanded.has(node.id);
        return (
          <div key={node.id}>
            <div
              className={`grid grid-cols-12 gap-1 items-center border-b py-2 text-sm ${
                node.is_active ? '' : 'opacity-55 bg-gray-50'
              }`}
              style={{ paddingRight: `${(node.level - 1) * 14}px` }}
            >
              <div className="col-span-12 lg:col-span-4 flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  className="w-6 h-6 rounded border text-xs disabled:opacity-30"
                  disabled={!hasChildren}
                  onClick={() => onToggleExpand(node.id)}
                >
                  {hasChildren ? (isOpen ? '−' : '+') : '·'}
                </button>
                <span className="font-mono font-semibold text-red-950">{node.code}</span>
                <span className="truncate text-gray-900">{node.name_ar}</span>
              </div>
              <div className="hidden lg:block lg:col-span-1 truncate text-gray-500">
                {node.name_en || '—'}
              </div>
              <div className="hidden md:block lg:col-span-1">{node.account_type_name_ar}</div>
              <div className="hidden md:block lg:col-span-1">{balanceLabel(node.normal_balance)}</div>
              <div className="hidden md:block lg:col-span-1">م{node.level}</div>
              <div className="hidden md:block lg:col-span-1">
                {node.is_group ? 'تجميعي' : 'تفصيلي'}
              </div>
              <div className="hidden lg:block lg:col-span-1">
                {node.allow_posting ? 'نعم' : 'لا'}
              </div>
              <div className="col-span-12 lg:col-span-2 flex flex-wrap gap-2 justify-end text-xs">
                <span
                  className={`px-2 py-0.5 rounded ${
                    node.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'
                  }`}
                >
                  {node.is_active ? 'فعّال' : 'معطّل'}
                </span>
                <span
                  className={`px-2 py-0.5 rounded ${
                    node.source === 'SYSTEM'
                      ? 'bg-slate-100 text-slate-700'
                      : 'bg-sky-50 text-sky-800'
                  }`}
                  title="مصدر الحساب"
                >
                  {node.source === 'SYSTEM' ? 'نظام' : 'مستخدم'}
                </span>
                <button className="text-slate-700 hover:underline" onClick={() => actions.onDetails(node)}>
                  تفاصيل
                </button>
                <button className="text-blue-700 hover:underline" onClick={() => actions.onEdit(node)}>
                  تعديل
                </button>
                {node.is_group && (
                  <button className="text-indigo-700 hover:underline" onClick={() => actions.onAddChild(node)}>
                    فرعي
                  </button>
                )}
                <button className="text-amber-700 hover:underline" onClick={() => actions.onMove(node)}>
                  نقل
                </button>
                <button className="text-orange-700 hover:underline" onClick={() => actions.onToggleStatus(node)}>
                  {node.is_active ? 'تعطيل' : 'تفعيل'}
                </button>
                <button className="text-red-700 hover:underline" onClick={() => actions.onDelete(node)}>
                  حذف
                </button>
              </div>
            </div>
            {hasChildren && isOpen && (
              <Rows
                nodes={node.children || []}
                expanded={expanded}
                onToggleExpand={onToggleExpand}
                {...actions}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export default function ChartTreeView(props: Props) {
  if (props.nodes.length === 0) {
    return (
      <div className="text-center text-gray-500 py-16 border rounded-lg bg-gray-50">
        لا توجد حسابات مطابقة للبحث أو الفلاتر
      </div>
    );
  }

  return (
    <div className="border rounded-lg bg-white overflow-hidden">
      <div className="hidden lg:grid grid-cols-12 gap-1 bg-gray-100 text-xs font-semibold p-2 text-gray-600">
        <div className="col-span-4">الحساب</div>
        <div className="col-span-1">EN</div>
        <div className="col-span-1">النوع</div>
        <div className="col-span-1">الرصيد</div>
        <div className="col-span-1">المستوى</div>
        <div className="col-span-1">التصنيف</div>
        <div className="col-span-1">ترحيل</div>
        <div className="col-span-2 text-left">إجراءات</div>
      </div>
      <Rows {...props} />
    </div>
  );
}
