import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleGauge,
  RefreshCw,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Store } from './types';
import { supabase } from './supabaseClient';

type ProfitabilitySummaryRow = {
  store_id: string;
  currency: string;
  net_sales: number | string | null;
  actual_cost: number | string | null;
  labor_cost: number | string | null;
  sales_linked_fees: number | string | null;
  utilities_cost: number | string | null;
  other_operating_cost: number | string | null;
  occupancy_cost: number | string | null;
  royalty_cost: number | string | null;
  guest_count: number | string | null;
  labor_hours: number | string | null;
  food_cost_percentage: number | string | null;
  labor_cost_percentage: number | string | null;
  prime_cost_percentage: number | string | null;
  sales_per_guest: number | string | null;
  sales_per_labor_hour: number | string | null;
  store_management_profit: number | string | null;
  store_management_margin_percentage: number | string | null;
  target_labor_cost_percentage: number | string | null;
  target_prime_cost_percentage: number | string | null;
  target_store_margin_percentage: number | string | null;
  labor_target_variance_percentage: number | string | null;
  prime_target_variance_percentage: number | string | null;
  margin_target_variance_percentage: number | string | null;
  inventory_complete: boolean;
  settings_complete: boolean;
  monthly_input_exists: boolean;
  operating_inputs_complete: boolean;
  profitability_ready: boolean;
};

type CostControlRow = {
  store_id: string;
  target_cost_percentage: number | string | null;
};

type NormalizedSummary = {
  netSales: number | null;
  actualCost: number | null;
  laborCost: number | null;
  salesLinkedFees: number | null;
  utilitiesCost: number | null;
  otherOperatingCost: number | null;
  occupancyCost: number | null;
  royaltyCost: number | null;
  guestCount: number | null;
  laborHours: number | null;
  foodCostPercentage: number | null;
  laborCostPercentage: number | null;
  primeCostPercentage: number | null;
  salesPerGuest: number | null;
  salesPerLaborHour: number | null;
  managementProfit: number | null;
  managementMarginPercentage: number | null;
  targetLaborCostPercentage: number | null;
  targetPrimeCostPercentage: number | null;
  targetManagementMarginPercentage: number | null;
  laborVariancePercentage: number | null;
  primeVariancePercentage: number | null;
  marginVariancePercentage: number | null;
  inventoryComplete: boolean;
  settingsComplete: boolean;
  monthlyInputExists: boolean;
  operatingInputsComplete: boolean;
  profitabilityReady: boolean;
};

type ReviewSection = 'close' | 'inventory';

type Priority = {
  title: string;
  detail: string;
  tone: 'good' | 'watch' | 'urgent' | 'missing';
  severity: number;
  section: ReviewSection;
};

type AnalysisRow = {
  store: Store;
  summary: NormalizedSummary | null;
  targetFoodCostPercentage: number | null;
  priority: Priority;
  blockers: string[];
  netSalesJpy: number | null;
  profitJpy: number | null;
};

type Props = {
  stores: Store[];
  monthKey: string;
  monthLabel: string;
  fxLabel: string;
  preview: boolean;
  convertToJpy: (amount: number, currency: string) => number | null;
  onOpenStore: (store: Store, section: ReviewSection) => void;
};

const SUMMARY_COLUMNS = [
  'store_id',
  'currency',
  'net_sales',
  'actual_cost',
  'labor_cost',
  'sales_linked_fees',
  'utilities_cost',
  'other_operating_cost',
  'occupancy_cost',
  'royalty_cost',
  'guest_count',
  'labor_hours',
  'food_cost_percentage',
  'labor_cost_percentage',
  'prime_cost_percentage',
  'sales_per_guest',
  'sales_per_labor_hour',
  'store_management_profit',
  'store_management_margin_percentage',
  'target_labor_cost_percentage',
  'target_prime_cost_percentage',
  'target_store_margin_percentage',
  'labor_target_variance_percentage',
  'prime_target_variance_percentage',
  'margin_target_variance_percentage',
  'inventory_complete',
  'settings_complete',
  'monthly_input_exists',
  'operating_inputs_complete',
  'profitability_ready',
].join(',');

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSummary(row: ProfitabilitySummaryRow): NormalizedSummary {
  return {
    netSales: numberOrNull(row.net_sales),
    actualCost: numberOrNull(row.actual_cost),
    laborCost: numberOrNull(row.labor_cost),
    salesLinkedFees: numberOrNull(row.sales_linked_fees),
    utilitiesCost: numberOrNull(row.utilities_cost),
    otherOperatingCost: numberOrNull(row.other_operating_cost),
    occupancyCost: numberOrNull(row.occupancy_cost),
    royaltyCost: numberOrNull(row.royalty_cost),
    guestCount: numberOrNull(row.guest_count),
    laborHours: numberOrNull(row.labor_hours),
    foodCostPercentage: numberOrNull(row.food_cost_percentage),
    laborCostPercentage: numberOrNull(row.labor_cost_percentage),
    primeCostPercentage: numberOrNull(row.prime_cost_percentage),
    salesPerGuest: numberOrNull(row.sales_per_guest),
    salesPerLaborHour: numberOrNull(row.sales_per_labor_hour),
    managementProfit: numberOrNull(row.store_management_profit),
    managementMarginPercentage: numberOrNull(row.store_management_margin_percentage),
    targetLaborCostPercentage: numberOrNull(row.target_labor_cost_percentage),
    targetPrimeCostPercentage: numberOrNull(row.target_prime_cost_percentage),
    targetManagementMarginPercentage: numberOrNull(row.target_store_margin_percentage),
    laborVariancePercentage: numberOrNull(row.labor_target_variance_percentage),
    primeVariancePercentage: numberOrNull(row.prime_target_variance_percentage),
    marginVariancePercentage: numberOrNull(row.margin_target_variance_percentage),
    inventoryComplete: Boolean(row.inventory_complete),
    settingsComplete: Boolean(row.settings_complete),
    monthlyInputExists: Boolean(row.monthly_input_exists),
    operatingInputsComplete: Boolean(row.operating_inputs_complete),
    profitabilityReady: Boolean(row.profitability_ready),
  };
}

function getBlockers(summary: NormalizedSummary | null): string[] {
  if (!summary) return ['Sales', 'HQ settings', 'Monthly totals', 'Inventory close'];
  return [
    ...(!summary.netSales || summary.netSales <= 0 ? ['Sales'] : []),
    ...(!summary.settingsComplete ? ['HQ settings'] : []),
    ...(!summary.monthlyInputExists || !summary.operatingInputsComplete ? ['Monthly totals'] : []),
    ...(!summary.inventoryComplete ? ['Inventory close'] : []),
  ];
}

function buildPriority(
  summary: NormalizedSummary | null,
  targetFoodCostPercentage: number | null,
  blockers: string[],
): Priority {
  if (!summary || !summary.profitabilityReady) {
    return {
      title: 'Complete monthly data',
      detail: blockers.length > 0 ? `Missing: ${blockers.join(', ')}` : 'Final margin is not ready.',
      tone: 'missing',
      severity: 80 + blockers.length,
      section: blockers.includes('Inventory close') ? 'inventory' : 'close',
    };
  }

  if ((summary.managementProfit ?? 0) < 0) {
    return {
      title: 'Stop the monthly loss',
      detail: 'Review food, labor and operating-cost drivers before approving the month.',
      tone: 'urgent',
      severity: 120 + Math.min(20, Math.abs(summary.managementMarginPercentage ?? 0)),
      section: 'close',
    };
  }

  const foodVariance = targetFoodCostPercentage === null || summary.foodCostPercentage === null
    ? null
    : summary.foodCostPercentage - targetFoodCostPercentage;
  const laborVariance = summary.laborVariancePercentage;

  if (foodVariance !== null && foodVariance > 0 && (laborVariance === null || foodVariance >= laborVariance)) {
    return {
      title: 'Reduce food-cost variance',
      detail: `${foodVariance.toFixed(1)} pt above target. Check purchasing price, stock count, waste and recipe usage.`,
      tone: foodVariance >= 3 ? 'urgent' : 'watch',
      severity: 100 + foodVariance,
      section: 'inventory',
    };
  }

  if (laborVariance !== null && laborVariance > 0) {
    return {
      title: 'Improve labor scheduling',
      detail: `${laborVariance.toFixed(1)} pt above target. Compare staffing hours with sales by day and shift.`,
      tone: laborVariance >= 3 ? 'urgent' : 'watch',
      severity: 95 + laborVariance,
      section: 'close',
    };
  }

  if (summary.marginVariancePercentage !== null && summary.marginVariancePercentage < 0) {
    return {
      title: 'Recover management margin',
      detail: `${Math.abs(summary.marginVariancePercentage).toFixed(1)} pt below target. Review fees, occupancy and other operating costs.`,
      tone: Math.abs(summary.marginVariancePercentage) >= 3 ? 'urgent' : 'watch',
      severity: 90 + Math.abs(summary.marginVariancePercentage),
      section: 'close',
    };
  }

  return {
    title: 'Maintain current controls',
    detail: 'No target breach is visible in the completed monthly inputs.',
    tone: 'good',
    severity: 0,
    section: 'close',
  };
}

function formatAmount(value: number | null, maximumFractionDigits = 0): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}

function formatLocal(currency: string, value: number | null): string {
  return value === null ? '—' : `${currency} ${formatAmount(value)}`;
}

function previewSummary(index: number): NormalizedSummary | null {
  if (index === 3) return null;
  const margin = [12.4, 4.2, -2.8, 0, 9.6][index % 5];
  const netSales = [8200000, 4600000, 6900000, 0, 5300000][index % 5];
  const food = [29.2, 34.8, 36.1, 0, 30.5][index % 5];
  const labor = [24.1, 29.4, 31.2, 0, 25.2][index % 5];
  const ready = index !== 4;
  return {
    netSales,
    actualCost: netSales * food / 100,
    laborCost: netSales * labor / 100,
    salesLinkedFees: netSales * 0.035,
    utilitiesCost: netSales * 0.022,
    otherOperatingCost: netSales * 0.018,
    occupancyCost: netSales * 0.08,
    royaltyCost: netSales * 0.05,
    guestCount: Math.max(1, Math.round(netSales / 1600)),
    laborHours: Math.max(1, Math.round(netSales / 5500)),
    foodCostPercentage: food,
    laborCostPercentage: labor,
    primeCostPercentage: food + labor,
    salesPerGuest: 1600,
    salesPerLaborHour: 5500,
    managementProfit: ready ? netSales * margin / 100 : null,
    managementMarginPercentage: ready ? margin : null,
    targetLaborCostPercentage: 25,
    targetPrimeCostPercentage: 55,
    targetManagementMarginPercentage: 10,
    laborVariancePercentage: labor - 25,
    primeVariancePercentage: food + labor - 55,
    marginVariancePercentage: ready ? margin - 10 : null,
    inventoryComplete: ready,
    settingsComplete: true,
    monthlyInputExists: true,
    operatingInputsComplete: true,
    profitabilityReady: ready,
  };
}

const PriorityBadge: React.FC<{ priority: Priority }> = ({ priority }) => {
  const toneClass = priority.tone === 'urgent'
    ? 'border-red-200 bg-red-50 text-red-800'
    : priority.tone === 'watch'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : priority.tone === 'good'
        ? 'border-teal-200 bg-teal-50 text-teal-900'
        : 'border-slate-200 bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${toneClass}`}>
      {priority.tone === 'good' ? 'On target' : priority.tone === 'missing' ? 'Not ready' : 'Action needed'}
    </span>
  );
};

const HQProfitabilityAnalysis: React.FC<Props> = ({
  stores,
  monthKey,
  monthLabel,
  fxLabel,
  preview,
  convertToJpy,
  onOpenStore,
}) => {
  const [summaries, setSummaries] = useState<Map<string, NormalizedSummary>>(new Map());
  const [foodTargets, setFoodTargets] = useState<Map<string, number | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (preview) {
      const previewSummaries = new Map<string, NormalizedSummary>();
      const previewTargets = new Map<string, number | null>();
      stores.forEach((store, index) => {
        const summary = previewSummary(index);
        if (summary) previewSummaries.set(store.id, summary);
        previewTargets.set(store.id, index % 3 === 2 ? 31 : 30);
      });
      setSummaries(previewSummaries);
      setFoodTargets(previewTargets);
      setLoading(false);
      return;
    }

    if (stores.length === 0) {
      setSummaries(new Map());
      setFoodTargets(new Map());
      setLoading(false);
      return;
    }

    try {
      const storeIds = stores.map((store) => store.id);
      const monthStart = `${monthKey}-01`;
      const [summaryResult, controlResult] = await Promise.all([
        supabase
          .from('monthly_store_profitability_summary')
          .select(SUMMARY_COLUMNS)
          .eq('month_start', monthStart)
          .in('store_id', storeIds),
        supabase
          .from('monthly_cost_controls')
          .select('store_id,target_cost_percentage')
          .eq('month_start', monthStart)
          .in('store_id', storeIds),
      ]);

      if (summaryResult.error) throw summaryResult.error;
      if (controlResult.error) throw controlResult.error;

      setSummaries(new Map(
        ((summaryResult.data ?? []) as unknown as ProfitabilitySummaryRow[])
          .map((row) => [row.store_id, normalizeSummary(row)]),
      ));
      setFoodTargets(new Map(
        ((controlResult.data ?? []) as CostControlRow[])
          .map((row) => [row.store_id, numberOrNull(row.target_cost_percentage)]),
      ));
    } catch (loadError: any) {
      setError(loadError?.message ?? 'Failed to load the HQ profitability review.');
      setSummaries(new Map());
      setFoodTargets(new Map());
    } finally {
      setLoading(false);
    }
  }, [monthKey, preview, stores]);

  useEffect(() => {
    void loadAnalysis();
  }, [loadAnalysis]);

  const rows = useMemo<AnalysisRow[]>(() => stores.map((store) => {
    const summary = summaries.get(store.id) ?? null;
    const targetFoodCostPercentage = foodTargets.get(store.id) ?? null;
    const blockers = getBlockers(summary);
    const priority = buildPriority(summary, targetFoodCostPercentage, blockers);
    return {
      store,
      summary,
      targetFoodCostPercentage,
      priority,
      blockers,
      netSalesJpy: summary?.netSales === null || summary?.netSales === undefined
        ? null
        : convertToJpy(summary.netSales, store.currency),
      profitJpy: summary?.managementProfit === null || summary?.managementProfit === undefined
        ? null
        : convertToJpy(summary.managementProfit, store.currency),
    };
  }).sort((left, right) => (
    right.priority.severity - left.priority.severity
    || left.store.name.localeCompare(right.store.name)
  )), [convertToJpy, foodTargets, stores, summaries]);

  const metrics = useMemo(() => {
    let netSalesJpy = 0;
    let managementProfitJpy = 0;
    let fxMissing = 0;
    let ready = 0;
    let actionNeeded = 0;

    rows.forEach((row) => {
      if (row.summary?.netSales !== null && row.summary?.netSales !== undefined) {
        if (row.netSalesJpy === null) fxMissing += 1;
        else netSalesJpy += row.netSalesJpy;
      }
      if (row.summary?.profitabilityReady) {
        ready += 1;
        if (row.profitJpy !== null) managementProfitJpy += row.profitJpy;
      }
      if (row.priority.tone === 'urgent' || row.priority.tone === 'watch') actionNeeded += 1;
    });

    return { netSalesJpy, managementProfitJpy, fxMissing, ready, actionNeeded };
  }, [rows]);

  const chartData = useMemo(() => rows
    .filter((row) => row.summary?.profitabilityReady)
    .slice(0, 10)
    .map((row) => ({
      name: row.store.name.length > 18 ? `${row.store.name.slice(0, 18)}…` : row.store.name,
      actual: row.summary?.managementMarginPercentage ?? 0,
      target: row.summary?.targetManagementMarginPercentage ?? 0,
    })), [rows]);

  const topActions = rows.filter((row) => row.priority.tone !== 'good').slice(0, 3);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-950 p-5 text-white sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
              <CircleGauge className="h-4 w-4" /> HQ profitability review
            </div>
            <h2 className="mt-2 text-2xl font-black">What should each store improve?</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">
              {monthLabel} · local currency for store action, JPY estimate for network comparison
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAnalysis()}
            disabled={loading}
            className="inline-flex self-start items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="m-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
          {error}
        </div>
      ) : null}

      <div className="p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Analysis ready</div>
            <div className="mt-2 text-2xl font-black text-slate-950">{metrics.ready} / {rows.length}</div>
            <div className="mt-1 text-xs text-slate-500">Only completed months receive a final margin</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Net sales</div>
            <div className="mt-2 text-2xl font-black text-slate-950">JPY {formatAmount(metrics.netSalesJpy)}</div>
            <div className="mt-1 text-xs text-slate-500">Selected stores with available FX</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Management profit</div>
            <div className={`mt-2 text-2xl font-black ${metrics.managementProfitJpy < 0 ? 'text-red-700' : 'text-slate-950'}`}>
              JPY {formatAmount(metrics.managementProfitJpy)}
            </div>
            <div className="mt-1 text-xs text-slate-500">Ready stores only; not statutory profit</div>
          </div>
          <div className={`rounded-xl border p-4 ${
            metrics.actionNeeded > 0 ? 'border-amber-200 bg-amber-50' : 'border-teal-200 bg-teal-50'
          }`}>
            <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Target breaches</div>
            <div className={`mt-2 text-2xl font-black ${metrics.actionNeeded > 0 ? 'text-amber-950' : 'text-teal-950'}`}>
              {metrics.actionNeeded}
            </div>
            <div className="mt-1 text-xs text-slate-600">Completed stores needing action</div>
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm font-bold text-slate-500">Loading profitability analysis…</div>
        ) : (
          <>
            <div className="mt-6 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-slate-500" />
                  <h3 className="text-sm font-black text-slate-950">Management margin vs store target</h3>
                </div>
                <p className="mt-1 text-xs text-slate-500">Percentages make stores comparable without mixing local currencies.</p>
                {chartData.length > 0 ? (
                  <div className="mt-4 h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                        <XAxis type="number" tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" width={118} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(value: number) => `${Number(value).toFixed(1)}%`} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="actual" name="Actual margin" fill="#0f172a" radius={[0, 4, 4, 0]} />
                        <Bar dataKey="target" name="Store target" fill="#94a3b8" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="mt-4 flex h-[280px] items-center justify-center rounded-lg bg-slate-50 text-center text-sm text-slate-500">
                    Complete sales, settings, monthly totals and inventory to compare margins.
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-black text-slate-950">First actions for HQ</h3>
                <p className="mt-1 text-xs text-slate-500">Highest-impact exception or missing step first.</p>
                <div className="mt-4 space-y-3">
                  {topActions.length > 0 ? topActions.map((row, index) => (
                    <button
                      key={row.store.id}
                      type="button"
                      onClick={() => onOpenStore(row.store, row.priority.section)}
                      className="flex w-full items-start gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-slate-400 hover:bg-slate-50"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-black text-slate-950">{row.store.name}</span>
                        <span className="mt-0.5 block text-xs font-bold text-slate-700">{row.priority.title}</span>
                        <span className="mt-1 block text-[11px] leading-4 text-slate-500">{row.priority.detail}</span>
                      </span>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                    </button>
                  )) : (
                    <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
                      <div className="flex items-center gap-2 font-black">
                        <CheckCircle2 className="h-4 w-4" /> No target breach detected
                      </div>
                      <p className="mt-1 text-xs">Continue monthly monitoring and verify data completeness.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-3 lg:hidden">
              {rows.map((row) => {
                const summary = row.summary;
                return (
                  <article key={row.store.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-black text-slate-950">{row.store.name}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{row.store.country} · {row.store.currency}</div>
                      </div>
                      <PriorityBadge priority={row.priority} />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <div className="text-slate-500">Net sales</div>
                        <div className="mt-0.5 font-black">{formatLocal(row.store.currency, summary?.netSales ?? null)}</div>
                        <div className="text-[10px] text-slate-400">JPY {formatAmount(row.netSalesJpy)}</div>
                      </div>
                      <div>
                        <div className="text-slate-500">Management profit</div>
                        <div className="mt-0.5 font-black">{formatLocal(row.store.currency, summary?.managementProfit ?? null)}</div>
                        <div className="text-[10px] text-slate-400">{formatPercent(summary?.managementMarginPercentage ?? null)}</div>
                      </div>
                      <div>
                        <div className="text-slate-500">Food / Labor</div>
                        <div className="mt-0.5 font-black">
                          {formatPercent(summary?.foodCostPercentage ?? null)} / {formatPercent(summary?.laborCostPercentage ?? null)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Productivity</div>
                        <div className="mt-0.5 font-black">{formatLocal(row.store.currency, summary?.salesPerLaborHour ?? null)} / hr</div>
                      </div>
                    </div>
                    <div className="mt-4 rounded-lg bg-slate-50 p-3">
                      <div className="text-xs font-black text-slate-900">{row.priority.title}</div>
                      <div className="mt-1 text-[11px] leading-4 text-slate-600">{row.priority.detail}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenStore(row.store, row.priority.section)}
                      className="mt-3 inline-flex items-center gap-2 text-xs font-black text-slate-800"
                    >
                      Review store month <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </article>
                );
              })}
            </div>

            <div className="mt-6 hidden overflow-x-auto rounded-xl border border-slate-200 lg:block">
              <table className="w-full min-w-[1280px] text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="p-3">Store</th>
                    <th className="p-3 text-right">Net sales</th>
                    <th className="p-3 text-right">Food cost</th>
                    <th className="p-3 text-right">Labor cost</th>
                    <th className="p-3 text-right">Fees / occupancy</th>
                    <th className="p-3 text-right">Management profit</th>
                    <th className="p-3 text-right">Productivity</th>
                    <th className="p-3">Priority</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => {
                    const summary = row.summary;
                    const feeTotal = summary
                      ? (summary.salesLinkedFees ?? 0) + (summary.occupancyCost ?? 0)
                      : null;
                    return (
                      <tr key={row.store.id} className="align-top hover:bg-slate-50">
                        <td className="p-3">
                          <div className="font-black text-slate-950">{row.store.name}</div>
                          <div className="mt-0.5 text-[10px] text-slate-500">{row.store.city}, {row.store.country}</div>
                          <div className="mt-2"><PriorityBadge priority={row.priority} /></div>
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          <div className="font-black text-slate-950">{formatLocal(row.store.currency, summary?.netSales ?? null)}</div>
                          <div className="mt-0.5 text-[10px] text-slate-400">JPY {formatAmount(row.netSalesJpy)}</div>
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          <div className="font-black">{formatPercent(summary?.foodCostPercentage ?? null)}</div>
                          <div className="mt-0.5 text-[10px] text-slate-400">{formatLocal(row.store.currency, summary?.actualCost ?? null)}</div>
                          <div className="text-[10px] text-slate-400">Target {formatPercent(row.targetFoodCostPercentage)}</div>
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          <div className="font-black">{formatPercent(summary?.laborCostPercentage ?? null)}</div>
                          <div className="mt-0.5 text-[10px] text-slate-400">{formatLocal(row.store.currency, summary?.laborCost ?? null)}</div>
                          <div className="text-[10px] text-slate-400">Target {formatPercent(summary?.targetLaborCostPercentage ?? null)}</div>
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          <div className="font-black">{formatLocal(row.store.currency, feeTotal)}</div>
                          <div className="mt-0.5 text-[10px] text-slate-400">
                            Fee {formatAmount(summary?.salesLinkedFees ?? null)} / Rent {formatAmount(summary?.occupancyCost ?? null)}
                          </div>
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          <div className={`font-black ${(summary?.managementProfit ?? 0) < 0 ? 'text-red-700' : 'text-slate-950'}`}>
                            {formatLocal(row.store.currency, summary?.managementProfit ?? null)}
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-400">JPY {formatAmount(row.profitJpy)}</div>
                          <div className="text-[10px] font-bold text-slate-600">
                            {formatPercent(summary?.managementMarginPercentage ?? null)} / target {formatPercent(summary?.targetManagementMarginPercentage ?? null)}
                          </div>
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          <div className="font-black">{formatLocal(row.store.currency, summary?.salesPerGuest ?? null)} / guest</div>
                          <div className="mt-0.5 text-[10px] text-slate-400">
                            {formatLocal(row.store.currency, summary?.salesPerLaborHour ?? null)} / hour
                          </div>
                        </td>
                        <td className="max-w-[240px] p-3">
                          <div className="font-black text-slate-900">{row.priority.title}</div>
                          <div className="mt-1 text-[10px] leading-4 text-slate-500">{row.priority.detail}</div>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => onOpenStore(row.store, row.priority.section)}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-300 px-2.5 py-2 text-[10px] font-black text-slate-800 hover:border-slate-500 hover:bg-white"
                          >
                            Review <ArrowRight className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="mt-4 flex flex-col gap-1 border-t border-slate-100 pt-3 text-[10px] text-slate-400 sm:flex-row sm:justify-between">
          <span>{fxLabel}{metrics.fxMissing > 0 ? ` · ${metrics.fxMissing} store(s) missing FX conversion` : ''}</span>
          <span>Management view only · incomplete months are never treated as zero profit</span>
        </div>
      </div>
    </section>
  );
};

export default HQProfitabilityAnalysis;
