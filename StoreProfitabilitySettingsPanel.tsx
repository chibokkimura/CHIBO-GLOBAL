import React, { useCallback, useEffect, useState } from 'react';
import { Building2, CheckCircle2, RefreshCw, Save, SlidersHorizontal } from 'lucide-react';
import { Store } from './types';
import { supabase } from './supabaseClient';

type SettingsDraft = {
  salesTaxMode: 'excluded' | 'included' | 'not_applicable';
  salesTaxRate: string;
  monthlyRent: string;
  commonAreaFee: string;
  salesCommissionRate: string;
  targetLaborRate: string;
  targetPrimeRate: string;
  targetMarginRate: string;
  notes: string;
};

type Props = {
  store: Store;
  preview: boolean;
  onSaved?: () => void;
};

const EMPTY_SETTINGS: SettingsDraft = {
  salesTaxMode: 'excluded',
  salesTaxRate: '0',
  monthlyRent: '',
  commonAreaFee: '',
  salesCommissionRate: '',
  targetLaborRate: '',
  targetPrimeRate: '',
  targetMarginRate: '',
  notes: '',
};

function valueOrBlank(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function mapSettings(row: any): SettingsDraft {
  return {
    salesTaxMode: row.sales_tax_mode,
    salesTaxRate: valueOrBlank(row.sales_tax_rate),
    monthlyRent: valueOrBlank(row.default_monthly_rent),
    commonAreaFee: valueOrBlank(row.default_monthly_common_area_fee),
    salesCommissionRate: valueOrBlank(row.default_sales_commission_rate),
    targetLaborRate: valueOrBlank(row.target_labor_cost_percentage),
    targetPrimeRate: valueOrBlank(row.target_prime_cost_percentage),
    targetMarginRate: valueOrBlank(row.target_store_margin_percentage),
    notes: row.notes ?? '',
  };
}

function requiredNumber(value: string): number {
  return value.trim() === '' ? 0 : Number(value);
}

function optionalNumber(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}

const StoreProfitabilitySettingsPanel: React.FC<Props> = ({ store, preview, onSaved }) => {
  const [draft, setDraft] = useState<SettingsDraft>(EMPTY_SETTINGS);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);

    if (preview) {
      setDraft({
        salesTaxMode: 'included',
        salesTaxRate: '5',
        monthlyRent: '100000',
        commonAreaFee: '20000',
        salesCommissionRate: '5',
        targetLaborRate: '25',
        targetPrimeRate: '55',
        targetMarginRate: '10',
        notes: 'Preview store targets',
      });
      setConfigured(true);
      setLoading(false);
      return;
    }

    try {
      const { data, error: loadError } = await supabase
        .from('store_profitability_settings')
        .select('sales_tax_mode,sales_tax_rate,default_monthly_rent,default_monthly_common_area_fee,default_sales_commission_rate,target_labor_cost_percentage,target_prime_cost_percentage,target_store_margin_percentage,notes')
        .eq('store_id', store.id)
        .maybeSingle();

      if (loadError) throw loadError;
      setConfigured(Boolean(data));
      setDraft(data ? mapSettings(data) : EMPTY_SETTINGS);
    } catch (loadError: any) {
      setError(loadError?.message ?? 'Failed to load HQ profit settings.');
    } finally {
      setLoading(false);
    }
  }, [preview, store.id]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const updateDraft = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
    setNotice(null);
  };

  const saveSettings = async () => {
    const fields = [
      ['Sales tax rate', draft.salesTaxRate, 0, 100],
      ['Monthly rent', draft.monthlyRent, 0, Number.MAX_SAFE_INTEGER],
      ['Common area fee', draft.commonAreaFee, 0, Number.MAX_SAFE_INTEGER],
      ['Default sales commission rate', draft.salesCommissionRate, 0, 100],
      ['Target labor rate', draft.targetLaborRate, 0, 100],
      ['Target prime cost rate', draft.targetPrimeRate, 0, 100],
      ['Target store margin', draft.targetMarginRate, -100, 100],
    ] as const;
    const invalid = fields.find(([, value, minimum, maximum]) => {
      if (value.trim() === '') return false;
      const numeric = Number(value);
      return !Number.isFinite(numeric) || numeric < minimum || numeric > maximum;
    });
    if (invalid) {
      setError(`${invalid[0]} must be between ${invalid[2]} and ${invalid[3]}.`);
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (preview) {
        setConfigured(true);
        setNotice('Preview HQ defaults saved.');
        onSaved?.();
        return;
      }

      const { data, error: saveError } = await supabase
        .from('store_profitability_settings')
        .upsert({
          store_id: store.id,
          sales_tax_mode: draft.salesTaxMode,
          sales_tax_rate: requiredNumber(draft.salesTaxRate),
          default_monthly_rent: requiredNumber(draft.monthlyRent),
          default_monthly_common_area_fee: requiredNumber(draft.commonAreaFee),
          default_sales_commission_rate: requiredNumber(draft.salesCommissionRate),
          target_labor_cost_percentage: optionalNumber(draft.targetLaborRate),
          target_prime_cost_percentage: optionalNumber(draft.targetPrimeRate),
          target_store_margin_percentage: optionalNumber(draft.targetMarginRate),
          notes: draft.notes.trim() || null,
        }, { onConflict: 'store_id' })
        .select('sales_tax_mode,sales_tax_rate,default_monthly_rent,default_monthly_common_area_fee,default_sales_commission_rate,target_labor_cost_percentage,target_prime_cost_percentage,target_store_margin_percentage,notes')
        .single();

      if (saveError) throw saveError;
      setDraft(mapSettings(data));
      setConfigured(true);
      setNotice('HQ store defaults saved. They will be reused for every month.');
      onSaved?.();
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Failed to save HQ profit settings.');
    } finally {
      setSaving(false);
    }
  };

  const amountFields = [
    { key: 'monthlyRent' as const, label: 'Monthly rent', hint: 'Fixed monthly rent in local currency' },
    { key: 'commonAreaFee' as const, label: 'Common area fee', hint: 'Mall or building management fee' },
  ];
  const targetFields = [
    { key: 'targetLaborRate' as const, label: 'Labor cost target', hint: 'Labor cost ÷ net sales' },
    { key: 'targetPrimeRate' as const, label: 'Prime cost target', hint: 'Food cost + labor cost ÷ net sales' },
    { key: 'targetMarginRate' as const, label: 'Management margin target', hint: 'Store management profit ÷ net sales' },
  ];

  return (
    <section className="rounded-2xl border border-gray-300 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-gray-500" />
            <h3 className="font-extrabold">2. HQ Store Profit Settings</h3>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
              configured ? 'bg-gray-900 text-white' : 'bg-amber-100 text-amber-800'
            }`}>
              {configured ? 'Configured' : 'Setup required'}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Set these once per store. Fixed values are reused automatically in every monthly calculation.
          </p>
        </div>
        <button
          type="button"
          aria-label="Reload HQ profit settings"
          onClick={() => void loadSettings()}
          disabled={loading || saving}
          className="self-start rounded-xl border border-gray-200 bg-white p-2.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          title="Reload"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="mt-5 rounded-xl bg-gray-50 p-5 text-center text-sm text-gray-500">
          Loading HQ defaults…
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <label className="rounded-xl border border-gray-200 p-4">
              <span className="text-xs font-extrabold text-gray-700">Sales tax treatment</span>
              <select
                value={draft.salesTaxMode}
                onChange={(event) => updateDraft('salesTaxMode', event.target.value as SettingsDraft['salesTaxMode'])}
                disabled={saving}
                className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold"
              >
                <option value="excluded">Sales entered before tax</option>
                <option value="included">Sales entered including tax</option>
                <option value="not_applicable">No sales tax adjustment</option>
              </select>
            </label>

            <label className="rounded-xl border border-gray-200 p-4">
              <span className="text-xs font-extrabold text-gray-700">Sales tax rate</span>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  inputMode="decimal"
                  value={draft.salesTaxRate}
                  onChange={(event) => updateDraft('salesTaxRate', event.target.value)}
                  disabled={saving || draft.salesTaxMode !== 'included'}
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2.5 text-right text-sm font-bold disabled:bg-gray-50"
                />
                <span className="text-sm font-bold text-gray-500">%</span>
              </div>
              <span className="mt-2 block text-[11px] text-gray-500">Used only when reported sales include tax.</span>
            </label>

            <label className="rounded-xl border border-gray-200 p-4">
              <span className="text-xs font-extrabold text-gray-700">Default sales-linked fee rate</span>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  inputMode="decimal"
                  value={draft.salesCommissionRate}
                  onChange={(event) => updateDraft('salesCommissionRate', event.target.value)}
                  disabled={saving}
                  placeholder="0"
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2.5 text-right text-sm font-bold"
                />
                <span className="text-sm font-bold text-gray-500">%</span>
              </div>
              <span className="mt-2 block text-[11px] text-gray-500">Used when the store leaves the monthly fee total blank.</span>
            </label>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {amountFields.map((field) => (
              <label key={field.key} className="rounded-xl border border-gray-200 p-4">
                <span className="flex items-center gap-2 text-xs font-extrabold text-gray-700">
                  <Building2 className="h-4 w-4" /> {field.label}
                </span>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-500">{store.currency}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={draft[field.key]}
                    onChange={(event) => updateDraft(field.key, event.target.value)}
                    disabled={saving}
                    placeholder="0"
                    className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2.5 text-right text-sm font-bold"
                  />
                </div>
                <span className="mt-2 block text-[11px] text-gray-500">{field.hint}</span>
              </label>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {targetFields.map((field) => (
              <label key={field.key} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <span className="text-xs font-extrabold text-gray-700">{field.label}</span>
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="number"
                    min={field.key === 'targetMarginRate' ? -100 : 0}
                    max="100"
                    step="0.1"
                    inputMode="decimal"
                    value={draft[field.key]}
                    onChange={(event) => updateDraft(field.key, event.target.value)}
                    disabled={saving}
                    placeholder="Optional"
                    className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-right text-sm font-bold"
                  />
                  <span className="text-sm font-bold text-gray-500">%</span>
                </div>
                <span className="mt-2 block text-[11px] text-gray-500">{field.hint}</span>
              </label>
            ))}
          </div>

          <label className="mt-4 block text-xs font-bold text-gray-600">
            HQ setting note
            <textarea
              value={draft.notes}
              onChange={(event) => updateDraft('notes', event.target.value)}
              disabled={saving}
              rows={2}
              className="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm font-normal"
              placeholder="Optional: contract basis, effective month, or review note"
            />
          </label>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-gray-500">
              Saving zero confirms that the store has no cost for that item. Targets may be left blank.
            </div>
            <button
              type="button"
              onClick={() => void saveSettings()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-40"
            >
              {configured ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving…' : configured ? 'Update Store Settings' : 'Save Store Settings'}
            </button>
          </div>
        </>
      )}

      {notice ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{notice}</div> : null}
      {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}
    </section>
  );
};

export default StoreProfitabilitySettingsPanel;
