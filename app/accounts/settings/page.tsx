'use client';

import { useState } from 'react';
import CashBoxesSettingsPanel from './components/CashBoxesSettingsPanel';
import CostCentersPanel from './components/CostCentersPanel';
import DocumentSequencesPanel from './components/DocumentSequencesPanel';
import FiscalPeriodsPanel from './components/FiscalPeriodsPanel';
import FiscalYearsPanel from './components/FiscalYearsPanel';
import type { SettingsTab } from './components/types';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'years', label: 'السنوات المالية' },
  { id: 'periods', label: 'الفترات المحاسبية' },
  { id: 'costCenters', label: 'مراكز الكلفة' },
  { id: 'sequences', label: 'تسلسل المستندات' },
  { id: 'cashboxes', label: 'إعدادات الصناديق' },
];

export default function AccountsSettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('years');

  return (
    <div className="p-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">إعدادات نظام الحسابات</h1>
        <p className="text-gray-600 mb-6 text-sm">
          إدارة السنوات المالية والفترات ومراكز الكلفة وترقيم المستندات وإعدادات الصناديق
        </p>

        <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3 mb-6">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                tab === item.id
                  ? 'bg-red-900 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'years' && <FiscalYearsPanel />}
        {tab === 'periods' && <FiscalPeriodsPanel />}
        {tab === 'costCenters' && <CostCentersPanel />}
        {tab === 'sequences' && <DocumentSequencesPanel />}
        {tab === 'cashboxes' && <CashBoxesSettingsPanel />}
      </div>
    </div>
  );
}
