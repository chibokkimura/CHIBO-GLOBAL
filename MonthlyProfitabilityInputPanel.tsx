import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  RefreshCw,
  Save,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { Store } from './types';
import { supabase } from './supabaseClient';

type MonthlyProfitabilityInput = {
  guestCount: string;
  laborCost: string;
  laborHours: string;
  salesLinkedFees: string;
  utilitiesCost: string;
  otherOperatingCost: string;
  notes: string;
};

type EditableInputKey = keyof MonthlyProfitabilityInput;

type Props = {
  store: Store;
  monthStart: string;
  mode: 'owner' | 'hq';
  lockedForOwner: boolean;
  preview: boolean;
  sectionNumber: number;
  onSaved?: () => void;
};

const EMPTY_INPUT: MonthlyProfitabilityInput = {
  guestCount: '',
  laborCost: '',
  laborHours: '',
  salesLinkedFees: '',
  utilitiesCost: '',
  otherOperatingCost: '',
  notes: '',
};

const BASE_REQUIRED_KEYS = [
  'laborCost',
  'laborHours',
  'utilitiesCost',
  'otherOperatingCost',
] as const;

function valueOrBlank(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function mapInput(row: any): MonthlyProfitabilityInput {
  return {
    guestCount: valueOrBlank(row.guest_count),
    laborCost: valueOrBlank(row.labor_cost),
    laborHours: valueOrBlank(row.labor_hours),
    salesLinkedFees: valueOrBlank(row.sales_linked_fees),
    utilitiesCost: valueOrBlank(row.utilities_cost),
    otherOperatingCost: valueOrBlank(row.other_operating_cost),
    notes: row.notes ?? '',
  };
}

function nullableNumber(value: string): number | null {
  if (value.trim() === '') return null;
  return Number(value);
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

const MonthlyProfitabilityInputPanel: React.FC<Props> = ({
  store,
  monthStart,
  mode,
  lockedForOwner,
  preview,
  sectionNumber,
  onSaved,
}) => {
  const [draft, setDraft] = useState<MonthlyProfitabilityInput>(EMPTY_INPUT);
  const [defaultCommissionRate, setDefaultCommissionRate] = useState<number | null>(null);
  const [settingsConfigured, setSettingsConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const editable = mode === 'owner' && !lockedForOwner;
  const commissionCovered = draft.salesLinkedFees.trim() !== '' || settingsConfigured;
  const completedRequiredCount = BASE_REQUIRED_KEYS.filter((key) => draft[key].trim() !== '').length
    + (commissionCovered ? 1 : 0);
  const requiredComplete = completedRequiredCount === BASE_REQUIRED_KEYS.length + 1;

  const loadInput = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);

    if (preview) {
      setDraft(EMPTY_INPUT);
      setDefaultCommissionRate(5);
      setSettingsConfigured(true);
      setLoading(false);
      return;
    }

    try {
      const [inputResult, settingsResult] = await Promise.all([
        supabase
          .from('monthly_profitability_inputs')
          .select('guest_count,labor_cost,labor_hours,sales_linked_fees,utilities_cost,other_operating_cost,notes')
          .eq('store_id', store.id)
          .eq('month_start', monthStart)
          .maybeSingle(),
        supabase
          .from('store_profitability_settings')
          .select('default_sales_commission_rate')
          .eq('store_id', store.id)
          .maybeSingle(),
      ]);

      const loadError = inputResult.error || settingsResult.error;
      if (loadError) throw loadError;
      setDraft(inputResult.data ? mapInput(inputResult.data) : EMPTY_INPUT);
      setSettingsConfigured(Boolean(settingsResult.data));
      setDefaultCommissionRate(numberOrNull(settingsResult.data?.default_sales_commission_rate));
    } catch (loadError: any) {
      console.error('Failed to load monthly profitability inputs', loadError);
      const message = String(loadError?.message ?? '');
      setError(
        message.toLowerCase().includes('could not find the table')
          ? 'Monthly profit input is not active yet. Apply the Phase 7B foundation migration, then reload.'
          : (message || 'Failed to load monthly profit inputs.'),
      );
    } finally {
      setLoading(false);
    }
  }, [monthStart, preview, store.id]);

  useEffect(() => {
    void loadInput();
  }, [loadInput]);

  const updateDraft = (key: EditableInputKey, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
    setNotice(null);
  };

  const saveInput = async () => {
    if (!editable) return;

    const numericFields = [
      ['Guest count', draft.guestCount],
      ['Total labor cost', draft.laborCost],
      ['Total labor hours', draft.laborHours],
      ['Sales-linked fees', draft.salesLinkedFees],
      ['Utilities', draft.utilitiesCost],
      ['Other operating costs', draft.otherOperatingCost],
    ] as const;

    const invalidField = numericFields.find(([, value]) => {
      if (value.trim() === '') return false;
      const number = Number(value);
      return !Number.isFinite(number) || number < 0;
    });
    if (invalidField) {
      setError(`${invalidField[0]} must be zero or more.`);
      return;
    }
    if (draft.guestCount.trim() !== '' && !Number.isInteger(Number(draft.guestCount))) {
      setError('Guest count must be a whole number.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    const nextComplete = BASE_REQUIRED_KEYS.every((key) => draft[key].trim() !== '')
      && (draft.salesLinkedFees.trim() !== '' || settingsConfigured);

    try {
      if (preview) {
        setNotice(nextComplete ? 'Preview monthly totals saved as complete.' : 'Preview draft saved.');
        onSaved?.();
        return;
      }

      const { data, error: saveError } = await supabase
        .from('monthly_profitability_inputs')
        .upsert({
          store_id: store.id,
          month_start: monthStart,
          guest_count: nullableNumber(draft.guestCount),
          labor_cost: nullableNumber(draft.laborCost),
          labor_hours: nullableNumber(draft.laborHours),
          sales_linked_fees: nullableNumber(draft.salesLinkedFees),
          utilities_cost: nullableNumber(draft.utilitiesCost),
          other_operating_cost: nullableNumber(draft.otherOperatingCost),
          input_complete: nextComplete,
          notes: draft.notes.trim() || null,
        }, { onConflict: 'store_id,month_start' })
        .select('guest_count,labor_cost,labor_hours,sales_linked_fees,utilities_cost,other_operating_cost,notes')
        .single();

      if (saveError) throw saveError;
      setDraft(mapInput(data));
      setNotice(nextComplete ? 'Monthly operating totals saved.' : 'Draft saved. Complete the remaining totals later.');
      onSaved?.();
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Failed to save monthly operating totals.');
    } finally {
      setSaving(false);
    }
  };

  const amountFields = [
    {
      key: 'laborCost' as const,
      label: 'Total labor cost',
      hint: 'One monthly total from payroll',
    },
    {
      key: 'salesLinkedFees' as const,
      label: 'Sales-linked fees',
      hint: settingsConfigured
        ? `Optional: blank uses the HQ default rate (${defaultCommissionRate ?? 0}%)`
        : 'Mall, delivery, card and channel fees',
    },
    {
      key: 'utilitiesCost' as const,
      label: 'Utilities',
      hint: 'Electricity, gas and water total',
    },
    {
      key: 'otherOperatingCost' as const,
      label: 'Other operating costs',
      hint: 'Supplies, cleaning, repairs and marketing',
    },
  ];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-extrabold">{sectionNumber}. Monthly Profit Inputs</h3>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
              requiredComplete
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {completedRequiredCount}/{BASE_REQUIRED_KEYS.length + 1} required
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Enter monthly totals only. Do not calculate employee-by-employee payroll or receipt-by-receipt expenses here.
          </p>
        </div>
        <button
          type="button"
          aria-label="Reload monthly profit inputs"
          onClick={() => void loadInput()}
          disabled={loading || saving}
          className="self-start rounded-xl border border-gray-200 bg-white p-2.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          title="Reload"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="mt-5 rounded-xl bg-gray-50 p-5 text-center text-sm text-gray-500">
          Loading monthly totals…
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <label className="rounded-xl border border-gray-200 p-4">
              <span className="flex items-center gap-2 text-xs font-extrabold text-gray-700">
                <UsersRound className="h-4 w-4" /> Guest count
                <span className="font-medium text-gray-400">Optional</span>
              </span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={draft.guestCount}
                disabled={!editable || saving}
                onChange={(event) => updateDraft('guestCount', event.target.value)}
                placeholder="POS monthly total"
                className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-right text-sm font-bold disabled:bg-gray-50"
              />
              <span className="mt-2 block text-[11px] text-gray-500">Use the POS guest total when available.</span>
            </label>

            <label className="rounded-xl border border-gray-200 p-4">
              <span className="flex items-center gap-2 text-xs font-extrabold text-gray-700">
                <Clock3 className="h-4 w-4" /> Total labor hours
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={draft.laborHours}
                disabled={!editable || saving}
                onChange={(event) => updateDraft('laborHours', event.target.value)}
                placeholder="Attendance monthly total"
                className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-right text-sm font-bold disabled:bg-gray-50"
              />
              <span className="mt-2 block text-[11px] text-gray-500">One total from the attendance system.</span>
            </label>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center gap-2 text-xs font-extrabold text-gray-700">
                <WalletCards className="h-4 w-4" /> Entry rule
              </div>
              <div className="mt-3 text-sm font-bold text-gray-900">Blank means not entered</div>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                Enter 0 only when the confirmed monthly amount is actually zero. This keeps missing data separate from zero cost.
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {amountFields.map((field) => (
              <label key={field.key} className="rounded-xl border border-gray-200 p-4">
                <span className="text-xs font-extrabold text-gray-700">{field.label}</span>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-500">{store.currency}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={draft[field.key]}
                    disabled={!editable || saving}
                    onChange={(event) => updateDraft(field.key, event.target.value)}
                    placeholder="Not entered"
                    className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2.5 text-right text-sm font-bold disabled:bg-gray-50"
                  />
                </div>
                <span className="mt-2 block text-[11px] text-gray-500">{field.hint}</span>
              </label>
            ))}
          </div>

          <label className="mt-4 block text-xs font-bold text-gray-600">
            Monthly note
            <textarea
              value={draft.notes}
              disabled={!editable || saving}
              onChange={(event) => updateDraft('notes', event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm font-normal disabled:bg-gray-50"
              placeholder={mode === 'hq' ? 'No store note' : 'Optional: unusual payroll, fees, utilities, or missing source report'}
            />
          </label>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-gray-500">
              {mode === 'hq'
                ? 'HQ reviews the totals entered by the store.'
                : requiredComplete
                  ? 'All required monthly totals are entered.'
                  : `${BASE_REQUIRED_KEYS.length + 1 - completedRequiredCount} required total(s) still blank. A partial draft can still be saved.`}
            </div>
            {mode === 'owner' ? (
              <button
                type="button"
                onClick={() => void saveInput()}
                disabled={saving || lockedForOwner}
                className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {requiredComplete ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving…' : requiredComplete ? 'Save Monthly Totals' : 'Save Draft'}
              </button>
            ) : null}
          </div>
        </>
      )}

      {lockedForOwner ? (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs font-bold text-blue-800">
          Reopen the submitted or approved month before changing these totals.
        </div>
      ) : null}
      {notice ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{notice}</div> : null}
      {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}
    </section>
  );
};

export default MonthlyProfitabilityInputPanel;
