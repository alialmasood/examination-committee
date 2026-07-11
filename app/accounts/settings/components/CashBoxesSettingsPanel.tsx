'use client';

import { useEffect, useState } from 'react';
import VarianceAccountsPanel from '../../cashbox/components/VarianceAccountsPanel';
import type { CashBoxOptions } from '../../cashbox/components/types';
import { cashApi } from '../../cashbox/components/types';

export default function CashBoxesSettingsPanel() {
  const [options, setOptions] = useState<CashBoxOptions | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await cashApi<CashBoxOptions>('/api/accounts/cash-boxes/options');
      if (!res.success || !res.data) {
        setError(res.message || 'تعذر تحميل خيارات الصناديق');
        return;
      }
      setOptions(res.data);
    })();
  }, []);

  if (error) {
    return (
      <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
        {error}
      </div>
    );
  }

  return <VarianceAccountsPanel options={options} />;
}
