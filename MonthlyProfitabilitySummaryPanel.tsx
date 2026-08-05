import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleGauge,
  RefreshCw,
  Scale,
  TrendingDown,
  TrendingUp,
  UsersRound,
} from 'lucide-react';
import { Store } from './types';
import { supabase } from './supabaseClient';
import AIProfitabilityAdvisor from './AIProfitabilityAdvisor';

type ProfitabilitySummary = {
  currency: string;
  reportedSales: number | null;
  netSales: number | null;
  salesTaxMode: string | null;
  guestCount: number | null;
  laborCost: number | null;
  laborHours: number | null;
  salesLinkedFees: number | null;
  salesLinkedFeeSource: string;
  utilitiesCost: number | null;
  otherOperatingCost: number | null;
  monthlyRent: number | null;
  commonAreaFee: number | null;
  occupancyCost: number | null;
  royaltyCost: number | null;
  actualCost: number | null;
  inventoryComplete: boolean;
  settingsComplete: boolean;
  monthlyInputExists: boolean;
  operatingInputsComplete: boolean;
  profitabilityReady: boolean;
  foodCostPercentage: number | null;
  laborCostPercentage: number | null;
  primeCostPercentage: number | null;
  salesPerGuest: number | null;
  salesPerLaborHour: number | null;
  storeManagementProfit: number | null;
  storeManagementMarginPercentage: number | null;
  targetLaborCostPercentage: number | null;
  targetPrimeCostPercentage: number | null;
  targetStoreMarginPercentage: number | null;
  laborTargetVariancePercentage: number | null;
  primeTargetVariancePercentage: number | null;
  marginTargetVariancePercentage: number | null;
};

type Props = {
  store: Store;
  monthStart: string;
  mode: 'owner' | 'hq';
  preview: boolean;
  refreshKey: number;
  sectionNumber: number;
};

type MetricCardProps = {
  label: string;
  value: string;
  detail: string;
  tone?: 'neutral' | 'good' | 'bad';
};

type SnapshotMeta = {
  status: 'submitted' | 'approved';
  revision: number;
  capturedAt: string;
};

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function mapSummary(row: any): ProfitabilitySummary {
  return {
    currency: row.currency,
    reportedSales: numberOrNull(row.reported_sales),
    netSales: numberOrNull(row.net_sales),
    salesTaxMode: row.sales_tax_mode,
    guestCount: numberOrNull(row.guest_count),
    laborCost: numberOrNull(row.labor_cost),
    laborHours: numberOrNull(row.labor_hours),
    salesLinkedFees: numberOrNull(row.sales_linked_fees),
    salesLinkedFeeSource: row.sales_linked_fee_source,
    utilitiesCost: numberOrNull(row.utilities_cost),
    otherOperatingCost: numberOrNull(row.other_operating_cost),
    monthlyRent: numberOrNull(row.default_monthly_rent),
    commonAreaFee: numberOrNull(row.default_monthly_common_area_fee),
    occupancyCost: numberOrNull(row.occupancy_cost),
    royaltyCost: numberOrNull(row.royalty_cost),
    actualCost: numberOrNull(row.actual_cost),
    inventoryComplete: Boolean(row.inventory_complete),
    settingsComplete: Boolean(row.settings_complete),
    monthlyInputExists: Boolean(row.monthly_input_exists),
    operatingInputsComplete: Boolean(row.operating_inputs_complete),
    profitabilityReady: Boolean(row.profitability_ready),
    foodCostPercentage: numberOrNull(row.food_cost_percentage),
    laborCostPercentage: numberOrNull(row.labor_cost_percentage),
    primeCostPercentage: numberOrNull(row.prime_cost_percentage),
    salesPerGuest: numberOrNull(row.sales_per_guest),
    salesPerLaborHour: numberOrNull(row.sales_per_labor_hour),
    storeManagementProfit: numberOrNull(row.store_management_profit),
    storeManagementMarginPercentage: numberOrNull(row.store_management_margin_percentage),
    targetLaborCostPercentage: numberOrNull(row.target_labor_cost_percentage),
    targetPrimeCostPercentage: numberOrNull(row.target_prime_cost_percentage),
    targetStoreMarginPercentage: numberOrNull(row.target_store_margin_percentage),
    laborTargetVariancePercentage: numberOrNull(row.labor_target_variance_percentage),
    primeTargetVariancePercentage: numberOrNull(row.prime_target_variance_percentage),
    marginTargetVariancePercentage: numberOrNull(row.margin_target_variance_percentage),
  };
}

function formatAmount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatVariance(value: number | null, higherIsBetter = false): string {
  if (value === null) return 'No target';
  if (value === 0) return 'On target';
  const direction = value > 0 ? 'above' : 'below';
  const good = higherIsBetter ? value > 0 : value < 0;
  return `${Math.abs(value).toFixed(1)} pt ${direction} target${good ? '' : ''}`;
}

function varianceTone(value: number | null, higherIsBetter = false): MetricCardProps['tone'] {
  if (value === null || value === 0) return 'neutral';
  const good = higherIsBetter ? value > 0 : value < 0;
  return good ? 'good' : 'bad';
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, detail, tone = 'neutral' }) => (
  <div className={`rounded-xl border p-4 ${
    tone === 'bad'
      ? 'border-red-200 bg-red-50'
      : tone === 'good'
        ? 'border-emerald-200 bg-emerald-50'
        : 'border-gray-200 bg-white'
  }`}>
    <div className="text-[11px] font-black uppercase tracking-wide text-gray-500">{label}</div>
    <div className={`mt-2 text-2xl font-black ${
      tone === 'bad' ? 'text-red-700' : tone === 'good' ? 'text-emerald-800' : 'text-gray-950'
    }`}>
      {value}
    </div>
    <div className="mt-1 text-[11px] text-gray-500">{detail}</div>
  </div>
);

const MonthlyProfitabilitySummaryPanel: React.FC<Props> = ({
  store,
  monthStart,
  mode,
  preview,
  refreshKey,
  sectionNumber,
}) => {
  const [summary, setSummary] = useState<ProfitabilitySummary | null>(null);
  const [snapshotMeta, setSnapshotMeta] = useState<SnapshotMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSnapshotMeta(null);

    if (preview) {
      const previewReady = mode === 'hq';
      setSummary({
        currency: store.currency,
        reportedSales: 1200000,
        netSales: 1142857.14,
        salesTaxMode: 'included',
        guestCount: 1000,
        laborCost: 300000,
        laborHours: 400,
        salesLinkedFees: 57142.86,
        salesLinkedFeeSource: 'default_rate',
        utilitiesCost: 80000,
        otherOperatingCost: 40000,
        monthlyRent: 100000,
        commonAreaFee: 20000,
        occupancyCost: 120000,
        royaltyCost: 57142.86,
        actualCost: 350000,
        inventoryComplete: previewReady,
        settingsComplete: true,
        monthlyInputExists: previewReady,
        operatingInputsComplete: previewReady,
        profitabilityReady: previewReady,
        foodCostPercentage: previewReady ? 30.625 : null,
        laborCostPercentage: previewReady ? 26.25 : null,
        primeCostPercentage: previewReady ? 56.875 : null,
        salesPerGuest: previewReady ? 1142.86 : null,
        salesPerLaborHour: previewReady ? 2857.14 : null,
        storeManagementProfit: previewReady ? 138571.42 : null,
        storeManagementMarginPercentage: previewReady ? 12.125 : null,
        targetLaborCostPercentage: 25,
        targetPrimeCostPercentage: 55,
        targetStoreMarginPercentage: 10,
        laborTargetVariancePercentage: previewReady ? 1.25 : null,
        primeTargetVariancePercentage: previewReady ? 1.875 : null,
        marginTargetVariancePercentage: previewReady ? 2.125 : null,
      });
      setLoading(false);
      return;
    }

    try {
      const [summaryResult, periodResult, snapshotResult] = await Promise.all([
        supabase
          .from('monthly_store_profitability_summary')
          .select('currency,reported_sales,net_sales,sales_tax_mode,guest_count,labor_cost,labor_hours,sales_linked_fees,sales_linked_fee_source,utilities_cost,other_operating_cost,default_monthly_rent,default_monthly_common_area_fee,occupancy_cost,royalty_cost,actual_cost,inventory_complete,settings_complete,monthly_input_exists,operating_inputs_complete,profitability_ready,food_cost_percentage,labor_cost_percentage,prime_cost_percentage,sales_per_guest,sales_per_labor_hour,store_management_profit,store_management_margin_percentage,target_labor_cost_percentage,target_prime_cost_percentage,target_store_margin_percentage,labor_target_variance_percentage,prime_target_variance_percentage,margin_target_variance_percentage')
          .eq('store_id', store.id)
          .eq('month_start', monthStart)
          .maybeSingle(),
        supabase
          .from('monthly_close_periods')
          .select('status')
          .eq('store_id', store.id)
          .eq('month_start', monthStart)
          .maybeSingle(),
        supabase
          .from('monthly_close_snapshots')
          .select('close_status,revision,payload,captured_at')
          .eq('store_id', store.id)
          .eq('month_start', monthStart)
          .order('revision', { ascending: false }),
      ]);

      const loadError = summaryResult.error || periodResult.error || snapshotResult.error;
      if (loadError) throw loadError;

      const closeStatus = periodResult.data?.status;
      const locked = closeStatus === 'submitted' || closeStatus === 'approved';
      const matchingSnapshot = locked
        ? (snapshotResult.data ?? []).find((row: any) => row.close_status === closeStatus)
        : null;
      const snapshotSummary = matchingSnapshot?.payload?.profitabilitySummary;

      setSummary(snapshotSummary
        ? mapSummary(snapshotSummary)
        : summaryResult.data
          ? mapSummary(summaryResult.data)
          : null);
      setSnapshotMeta(matchingSnapshot ? {
        status: matchingSnapshot.close_status,
        revision: Number(matchingSnapshot.revision),
        capturedAt: matchingSnapshot.captured_at,
      } : null);
    } catch (loadError: any) {
      setError(loadError?.message ?? 'Failed to load the monthly profit summary.');
      setSnapshotMeta(null);
    } finally {
      setLoading(false);
    }
  }, [mode, monthStart, preview, refreshKey, store.currency, store.id]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const blockers = summary ? [
    ...(!summary.settingsComplete ? ['HQ store defaults'] : []),
    ...(!summary.monthlyInputExists || !summary.operatingInputsComplete ? ['monthly labor and operating totals'] : []),
    ...(!summary.inventoryComplete ? ['completed opening and closing inventory'] : []),
    ...(!(summary.netSales && summary.netSales > 0) ? ['reported sales'] : []),
  ] : ['reported sales or monthly operating totals'];

  const breakdown = summary ? [
    { label: 'Net sales', value: summary.netSales, strong: true },
    { label: 'Actual food cost', value: summary.actualCost },
    { label: 'Labor cost', value: summary.laborCost },
    {
      label: 'Sales-linked fees',
      value: summary.salesLinkedFees,
      note: summary.salesLinkedFeeSource === 'default_rate' ? 'HQ default rate' : 'Monthly entered total',
    },
    { label: 'Utilities', value: summary.utilitiesCost },
    { label: 'Other operating costs', value: summary.otherOperatingCost },
    { label: 'Rent + common area fee', value: summary.occupancyCost },
    { label: `Royalty (${store.royaltyPercentage}%)`, value: summary.royaltyCost },
    { label: 'Store management profit', value: summary.storeManagementProfit, strong: true },
  ] : [];

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-300 bg-white">
      <div className="border-b border-gray-200 bg-gray-950 p-5 text-white">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CircleGauge className="h-5 w-5" />
              <h3 className="font-extrabold">
                {mode === 'owner' ? 'Step 3. Review Monthly Result' : `${sectionNumber}. Monthly Profitability`}
              </h3>
            </div>
            <p className="mt-1 text-xs text-gray-300">
              Management view for improving store operations. This is not a statutory accounting statement.
            </p>
          </div>
          <button
            type="button"
            aria-label="Reload monthly profitability"
            onClick={() => void loadSummary()}
            disabled={loading}
            className="self-start rounded-xl border border-gray-700 bg-gray-900 p-2.5 text-gray-200 hover:bg-gray-800 disabled:opacity-40"
            title="Reload"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-gray-500">Calculating monthly profitability…</div>
      ) : (
        <div className="p-5">
          {snapshotMeta && (
            <div className="mb-4 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-xs text-slate-700">
              <span className="font-extrabold text-slate-950">
                Locked audit snapshot · {snapshotMeta.status} revision {snapshotMeta.revision}
              </span>
              <span className="ml-2">
                Captured {new Date(snapshotMeta.capturedAt).toLocaleString()}
              </span>
            </div>
          )}
          <div className={`rounded-xl border p-4 ${
            summary?.profitabilityReady
              ? 'border-emerald-200 bg-emerald-50'
              : 'border-amber-200 bg-amber-50'
          }`}>
            <div className="flex items-start gap-3">
              {summary?.profitabilityReady
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />}
              <div>
                <div className={`font-extrabold ${
                  summary?.profitabilityReady ? 'text-emerald-900' : 'text-amber-900'
                }`}>
                  {summary?.profitabilityReady
                    ? 'Monthly management profit is ready'
                    : 'Complete the missing inputs before using the final margin'}
                </div>
                <div className={`mt-1 text-xs ${
                  summary?.profitabilityReady ? 'text-emerald-800' : 'text-amber-800'
                }`}>
                  {summary?.profitabilityReady
                    ? 'Sales, actual food cost, labor, operating costs, fixed costs and royalty are included.'
                    : `Missing: ${blockers.join(', ')}.`}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label="Net sales"
              value={`${store.currency} ${formatAmount(summary?.netSales ?? null)}`}
              detail={summary?.salesTaxMode === 'included' ? 'Sales tax removed' : 'Reported sales basis'}
            />
            <MetricCard
              label="Food cost"
              value={formatPercent(summary?.foodCostPercentage ?? null)}
              detail={summary?.inventoryComplete ? 'Actual inventory method' : 'Inventory close incomplete'}
            />
            <MetricCard
              label="Labor cost"
              value={formatPercent(summary?.laborCostPercentage ?? null)}
              detail={formatVariance(summary?.laborTargetVariancePercentage ?? null)}
              tone={varianceTone(summary?.laborTargetVariancePercentage ?? null)}
            />
            <MetricCard
              label="Prime cost"
              value={formatPercent(summary?.primeCostPercentage ?? null)}
              detail={formatVariance(summary?.primeTargetVariancePercentage ?? null)}
              tone={varianceTone(summary?.primeTargetVariancePercentage ?? null)}
            />
            <MetricCard
              label="Management margin"
              value={formatPercent(summary?.storeManagementMarginPercentage ?? null)}
              detail={summary?.profitabilityReady
                ? formatVariance(summary.marginTargetVariancePercentage, true)
                : 'Shown after all inputs are ready'}
              tone={summary?.profitabilityReady
                ? varianceTone(summary.marginTargetVariancePercentage, true)
                : 'neutral'}
            />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <div className="flex items-center justify-between bg-gray-50 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-extrabold text-gray-900">
                  <Scale className="h-4 w-4" /> Monthly amount breakdown
                </div>
                <span className="text-xs font-bold text-gray-500">{store.currency}</span>
              </div>
              <div className="divide-y divide-gray-100">
                {breakdown.map((item) => (
                  <div
                    key={item.label}
                    className={`flex items-center justify-between gap-4 px-4 py-3 text-sm ${
                      item.strong ? 'bg-gray-50 font-extrabold text-gray-950' : 'text-gray-700'
                    }`}
                  >
                    <div>
                      {item.label}
                      {item.note ? <div className="text-[10px] font-normal text-gray-400">{item.note}</div> : null}
                    </div>
                    <span className="shrink-0 tabular-nums">
                      {item.label === 'Store management profit' && !summary?.profitabilityReady
                        ? 'Waiting for inputs'
                        : formatAmount(item.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 text-sm font-extrabold text-gray-900">
                  <UsersRound className="h-4 w-4" /> Store productivity
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-gray-50 p-3">
                    <div className="text-[10px] font-bold uppercase text-gray-500">Sales / guest</div>
                    <div className="mt-1 text-lg font-black">{store.currency} {formatAmount(summary?.salesPerGuest ?? null)}</div>
                    <div className="mt-1 text-[10px] text-gray-400">
                      {summary?.guestCount === null || summary?.guestCount === undefined ? 'Guest count not entered' : `${formatAmount(summary.guestCount)} guests`}
                    </div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-3">
                    <div className="text-[10px] font-bold uppercase text-gray-500">Sales / labor hour</div>
                    <div className="mt-1 text-lg font-black">{store.currency} {formatAmount(summary?.salesPerLaborHour ?? null)}</div>
                    <div className="mt-1 text-[10px] text-gray-400">
                      {summary?.laborHours === null || summary?.laborHours === undefined ? 'Labor hours not entered' : `${formatAmount(summary.laborHours)} hours`}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 p-4">
                <div className="text-sm font-extrabold text-gray-900">Target reading</div>
                <div className="mt-3 space-y-2 text-xs">
                  {[
                    {
                      label: 'Labor',
                      value: summary?.laborTargetVariancePercentage ?? null,
                      higherIsBetter: false,
                    },
                    {
                      label: 'Prime cost',
                      value: summary?.primeTargetVariancePercentage ?? null,
                      higherIsBetter: false,
                    },
                    {
                      label: 'Management margin',
                      value: summary?.marginTargetVariancePercentage ?? null,
                      higherIsBetter: true,
                    },
                  ].map((item) => {
                    const tone = varianceTone(item.value, item.higherIsBetter);
                    return (
                      <div key={item.label} className="flex items-center justify-between gap-3">
                        <span className="font-bold text-gray-600">{item.label}</span>
                        <span className={`inline-flex items-center gap-1 font-extrabold ${
                          tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : 'text-gray-500'
                        }`}>
                          {tone === 'good'
                            ? <TrendingUp className="h-3.5 w-3.5" />
                            : tone === 'bad'
                              ? <TrendingDown className="h-3.5 w-3.5" />
                              : null}
                          {formatVariance(item.value, item.higherIsBetter)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {mode === 'hq' && summary ? (
            <AIProfitabilityAdvisor
              store={store}
              monthStart={monthStart}
              summary={summary}
              preview={preview}
            />
          ) : null}
        </div>
      )}

      {error ? <div className="m-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}
    </section>
  );
};

export default MonthlyProfitabilitySummaryPanel;
