import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  FileImage,
  RefreshCw,
} from 'lucide-react';
import { Sale, Store } from './types';
import { supabase } from './supabaseClient';
import MonthlyProfitabilityInputPanel from './MonthlyProfitabilityInputPanel';
import MonthlyProfitabilitySummaryPanel from './MonthlyProfitabilitySummaryPanel';
import ProfitabilityImportPanel from './ProfitabilityImportPanel';
import StoreProfitabilitySettingsPanel from './StoreProfitabilitySettingsPanel';

type CloseStatus = 'draft' | 'submitted' | 'approved' | 'reopened';
type TaskStatus = 'pending' | 'completed' | 'not_applicable';

type MonthlyClosePeriod = {
  id: string;
  storeId: string;
  monthStart: string;
  status: CloseStatus;
  ownerNote: string;
  reviewNote: string;
  submittedAt?: string;
  approvedAt?: string;
};

type MonthlyCloseTask = {
  id?: string;
  storeId: string;
  monthStart: string;
  taskKey: string;
  label: string;
  dueDate?: string;
  status: TaskStatus;
  notes: string;
  sortOrder: number;
};

type ProfitabilityProgress = {
  settingsComplete: boolean;
  monthlyInputExists: boolean;
  operatingInputsComplete: boolean;
  inventoryComplete: boolean;
  profitabilityReady: boolean;
};

type Props = {
  store: Store;
  sales: Sale[];
  initialMonthKey: string;
  mode: 'owner' | 'hq';
  onOpenSalesReport?: (date: string) => void;
  onOpenInventory?: () => void;
};

const DEFAULT_TASKS = [
  {
    key: 'monthly_sales_confirmed',
    label: 'I checked the monthly sales total and confirmed it is correct',
    order: 10,
  },
] as const;

const EMPTY_PROFITABILITY_PROGRESS: ProfitabilityProgress = {
  settingsComplete: false,
  monthlyInputExists: false,
  operatingInputsComplete: false,
  inventoryComplete: false,
  profitabilityReady: false,
};

function formatAmount(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) return monthKey;
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

function monthBounds(monthKey: string): { start: string; end: string } {
  const [year, month] = monthKey.split('-').map(Number);
  const endDay = new Date(year, month, 0).getDate();
  return {
    start: `${monthKey}-01`,
    end: `${monthKey}-${String(endDay).padStart(2, '0')}`,
  };
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getExpectedDates(monthKey: string): string[] {
  const { start, end } = monthBounds(monthKey);
  const today = formatLocalDate(new Date());
  if (start > today) return [];

  const effectiveEnd = monthKey === today.slice(0, 7)
    ? formatLocalDate(new Date(Date.now() - 86400000))
    : end;
  if (effectiveEnd < start) return [];

  const dates: string[] = [];
  const cursor = new Date(`${start}T12:00:00`);
  const final = new Date(`${effectiveEnd}T12:00:00`);
  while (cursor <= final) {
    dates.push(formatLocalDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function isLocalPreview(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  return local && new URLSearchParams(window.location.search).has('preview');
}

function mapPeriod(row: any): MonthlyClosePeriod {
  return {
    id: row.id,
    storeId: row.store_id,
    monthStart: row.month_start,
    status: row.status,
    ownerNote: row.owner_note ?? '',
    reviewNote: row.review_note ?? '',
    submittedAt: row.submitted_at ?? undefined,
    approvedAt: row.approved_at ?? undefined,
  };
}

function mapTask(row: any): MonthlyCloseTask {
  return {
    id: row.id,
    storeId: row.store_id,
    monthStart: row.month_start,
    taskKey: row.task_key,
    label: row.label,
    dueDate: row.due_date ?? undefined,
    status: row.status,
    notes: row.notes ?? '',
    sortOrder: Number(row.sort_order ?? 0),
  };
}

function mapProfitabilityProgress(row: any): ProfitabilityProgress {
  if (!row) return EMPTY_PROFITABILITY_PROGRESS;
  return {
    settingsComplete: Boolean(row.settings_complete),
    monthlyInputExists: Boolean(row.monthly_input_exists),
    operatingInputsComplete: Boolean(row.operating_inputs_complete),
    inventoryComplete: Boolean(row.inventory_complete),
    profitabilityReady: Boolean(row.profitability_ready),
  };
}

function statusLabel(status?: CloseStatus): string {
  if (status === 'submitted') return 'Submitted';
  if (status === 'approved') return 'Approved';
  if (status === 'reopened') return 'Reopened';
  return 'Draft';
}

const MonthlyCloseWorkspace: React.FC<Props> = ({
  store,
  sales,
  initialMonthKey,
  mode,
  onOpenSalesReport,
  onOpenInventory,
}) => {
  const preview = isLocalPreview();
  const [monthKey, setMonthKey] = useState(initialMonthKey);
  const [period, setPeriod] = useState<MonthlyClosePeriod | null>(null);
  const [tasks, setTasks] = useState<MonthlyCloseTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ownerNote, setOwnerNote] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [profitabilityRefreshKey, setProfitabilityRefreshKey] = useState(0);
  const [profitabilityProgress, setProfitabilityProgress] = useState<ProfitabilityProgress>(
    EMPTY_PROFITABILITY_PROGRESS,
  );

  useEffect(() => {
    setMonthKey(initialMonthKey);
  }, [initialMonthKey, store.id]);

  const { start: monthStart, end: monthEnd } = useMemo(() => monthBounds(monthKey), [monthKey]);
  const monthSales = useMemo(
    () => sales
      .filter((sale) => sale.storeId === store.id && sale.date >= monthStart && sale.date <= monthEnd)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [sales, store.id, monthStart, monthEnd],
  );
  const openDaySales = useMemo(() => monthSales.filter((sale) => !sale.isClosed), [monthSales]);
  const closedDaySales = useMemo(() => monthSales.filter((sale) => sale.isClosed), [monthSales]);
  const reportedSales = useMemo(
    () => openDaySales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0),
    [openDaySales],
  );
  const expectedDates = useMemo(() => getExpectedDates(monthKey), [monthKey]);
  const submittedDates = useMemo(() => new Set(monthSales.map((sale) => sale.date)), [monthSales]);
  const missingDates = useMemo(
    () => expectedDates.filter((date) => !submittedDates.has(date)),
    [expectedDates, submittedDates],
  );
  const missingReceiptSales = useMemo(
    () => openDaySales.filter((sale) => !sale.hasReceipt),
    [openDaySales],
  );

  const visibleTasks = useMemo(() => {
    const byKey = new Map(tasks.map((task) => [task.taskKey, task]));
    return DEFAULT_TASKS.map((task) => byKey.get(task.key) ?? ({
      storeId: store.id,
      monthStart,
      taskKey: task.key,
      label: task.label,
      status: 'pending' as TaskStatus,
      notes: '',
      sortOrder: task.order,
    }));
  }, [tasks, store.id, monthStart]);

  const pendingTasks = visibleTasks.filter((task) => task.status === 'pending');
  const warnings = [
    ...(missingDates.length > 0 ? [`${missingDates.length} daily sales report(s) are missing`] : []),
    ...(missingReceiptSales.length > 0 ? [`${missingReceiptSales.length} open-day report(s) have no receipt image`] : []),
    ...(pendingTasks.length > 0 ? ['Monthly sales total has not been confirmed'] : []),
  ];
  const canSubmit = warnings.length === 0;
  const lockedForOwner = mode === 'owner' && (period?.status === 'submitted' || period?.status === 'approved');

  const monthOptions = useMemo(() => {
    const keys = new Set<string>([initialMonthKey, monthKey, formatLocalDate(new Date()).slice(0, 7)]);
    sales.filter((sale) => sale.storeId === store.id).forEach((sale) => keys.add(sale.date.slice(0, 7)));
    return Array.from(keys).filter(Boolean).sort((a, b) => b.localeCompare(a));
  }, [initialMonthKey, monthKey, sales, store.id]);

  const seedPreview = useCallback(() => {
    setPeriod({
      id: 'preview-period',
      storeId: store.id,
      monthStart,
      status: 'draft',
      ownerNote: '',
      reviewNote: '',
    });
    setTasks(DEFAULT_TASKS.map((task) => ({
      id: `preview-task-${task.key}`,
      storeId: store.id,
      monthStart,
      taskKey: task.key,
      label: task.label,
      status: 'pending',
      notes: '',
      sortOrder: task.order,
    })));
    setOwnerNote('');
    setReviewNote('');
    setProfitabilityProgress({
      settingsComplete: true,
      monthlyInputExists: false,
      operatingInputsComplete: false,
      inventoryComplete: false,
      profitabilityReady: false,
    });
  }, [monthStart, store.id]);

  const loadProfitabilityProgress = useCallback(async () => {
    if (preview) return;
    const { data, error: progressError } = await supabase
      .from('monthly_store_profitability_summary')
      .select('settings_complete,monthly_input_exists,operating_inputs_complete,inventory_complete,profitability_ready')
      .eq('store_id', store.id)
      .eq('month_start', monthStart)
      .maybeSingle();
    if (progressError) throw progressError;
    setProfitabilityProgress(mapProfitabilityProgress(data));
  }, [monthStart, preview, store.id]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    if (preview) {
      seedPreview();
      setLoading(false);
      return;
    }

    try {
      const [periodResult, tasksResult, progressResult] = await Promise.all([
        supabase
          .from('monthly_close_periods')
          .select('id,store_id,month_start,status,owner_note,review_note,submitted_at,approved_at')
          .eq('store_id', store.id)
          .eq('month_start', monthStart)
          .maybeSingle(),
        supabase
          .from('monthly_close_tasks')
          .select('id,store_id,month_start,task_key,label,due_date,status,notes,sort_order')
          .eq('store_id', store.id)
          .eq('month_start', monthStart)
          .in('task_key', DEFAULT_TASKS.map((task) => task.key))
          .order('sort_order'),
        supabase
          .from('monthly_store_profitability_summary')
          .select('settings_complete,monthly_input_exists,operating_inputs_complete,inventory_complete,profitability_ready')
          .eq('store_id', store.id)
          .eq('month_start', monthStart)
          .maybeSingle(),
      ]);

      const firstError = periodResult.error || tasksResult.error || progressResult.error;
      if (firstError) throw firstError;

      const nextPeriod = periodResult.data ? mapPeriod(periodResult.data) : null;
      setPeriod(nextPeriod);
      setTasks((tasksResult.data ?? []).map(mapTask));
      setOwnerNote(nextPeriod?.ownerNote ?? '');
      setReviewNote(nextPeriod?.reviewNote ?? '');
      setProfitabilityProgress(mapProfitabilityProgress(progressResult.data));
    } catch (loadError: any) {
      console.error('Failed to load monthly operations data', loadError);
      const message = String(loadError?.message ?? '');
      setError(
        message.toLowerCase().includes('could not find the table')
          ? 'The monthly operations database tables are not active yet. Apply the Phase 4 migration, then reload.'
          : (message || 'Failed to load monthly operations data.'),
      );
    } finally {
      setLoading(false);
    }
  }, [monthStart, preview, seedPreview, store.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const updateTask = async (task: MonthlyCloseTask, status: TaskStatus, notes = task.notes) => {
    if (lockedForOwner || mode === 'hq') return;
    setSaving(true);
    setError(null);
    const nextTask: MonthlyCloseTask = { ...task, status, notes };

    try {
      if (preview) {
        setTasks((current) => [
          ...current.filter((row) => row.taskKey !== task.taskKey),
          { ...nextTask, id: task.id ?? `preview-${task.taskKey}` },
        ]);
        return;
      }

      const completedBy = status === 'completed'
        ? (await supabase.auth.getUser()).data.user?.id ?? null
        : null;
      const { data, error: saveError } = await supabase
        .from('monthly_close_tasks')
        .upsert({
          store_id: store.id,
          month_start: monthStart,
          task_key: task.taskKey,
          label: task.label,
          due_date: null,
          status,
          notes: notes || null,
          sort_order: task.sortOrder,
          completed_at: status === 'completed' ? new Date().toISOString() : null,
          completed_by: completedBy,
        }, { onConflict: 'store_id,month_start,task_key' })
        .select('id,store_id,month_start,task_key,label,due_date,status,notes,sort_order')
        .single();

      if (saveError) throw saveError;
      setTasks((current) => [
        ...current.filter((row) => row.taskKey !== task.taskKey),
        mapTask(data),
      ]);
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Failed to update the monthly confirmation.');
    } finally {
      setSaving(false);
    }
  };

  const savePeriod = async (nextStatus: CloseStatus) => {
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      if (preview) {
        setPeriod((current) => ({
          id: current?.id ?? 'preview-period',
          storeId: store.id,
          monthStart,
          status: nextStatus,
          ownerNote,
          reviewNote,
          submittedAt: nextStatus === 'submitted' || nextStatus === 'approved'
            ? new Date().toISOString()
            : current?.submittedAt,
          approvedAt: nextStatus === 'approved' ? new Date().toISOString() : undefined,
        }));
        setNotice(nextStatus === 'approved' ? 'Preview month approved.' : 'Preview status updated.');
        return;
      }

      const { data, error: saveError } = await supabase
        .from('monthly_close_periods')
        .upsert({
          store_id: store.id,
          month_start: monthStart,
          status: nextStatus,
          owner_note: ownerNote || null,
          review_note: reviewNote || null,
        }, { onConflict: 'store_id,month_start' })
        .select('id,store_id,month_start,status,owner_note,review_note,submitted_at,approved_at')
        .single();

      if (saveError) throw saveError;
      setPeriod(mapPeriod(data));
      setNotice(nextStatus === 'approved' ? 'Monthly operations approved.' : 'Monthly operations status saved.');
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Failed to save the monthly operations status.');
    } finally {
      setSaving(false);
    }
  };

  const saveNotes = async () => {
    await savePeriod(period?.status ?? 'draft');
  };

  const reportingComplete = missingDates.length === 0;
  const receiptsComplete = missingReceiptSales.length === 0;
  const confirmationComplete = pendingTasks.length === 0;
  const submittedCount = expectedDates.length - missingDates.length;
  const stepOneComplete = reportingComplete
    && receiptsComplete
    && profitabilityProgress.operatingInputsComplete;
  const stepTwoComplete = profitabilityProgress.inventoryComplete;
  const stepThreeComplete = profitabilityProgress.profitabilityReady && confirmationComplete;

  const refreshProfitability = useCallback((monthlyInputsComplete?: boolean) => {
    if (preview) {
      if (monthlyInputsComplete !== undefined) {
        setProfitabilityProgress((current) => ({
          ...current,
          monthlyInputExists: true,
          operatingInputsComplete: monthlyInputsComplete,
          profitabilityReady: monthlyInputsComplete
            && current.inventoryComplete
            && current.settingsComplete,
        }));
      }
      return;
    }
    setProfitabilityRefreshKey((current) => current + 1);
    void loadProfitabilityProgress().catch((progressError) => {
      console.error('Failed to refresh monthly profitability progress', progressError);
    });
  }, [loadProfitabilityProgress, preview]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        Loading monthly operations…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">
            {mode === 'hq' ? 'HQ store review' : 'Store monthly operations'}
          </div>
          <h2 className="mt-1 text-2xl font-extrabold">
            {mode === 'hq' ? 'Monthly Performance Review' : 'Monthly Operations Check'}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {mode === 'hq'
              ? 'Review sales reporting completeness and the store submission before approval.'
              : 'Finish missing sales reports and receipts, confirm the total, then submit to HQ.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              aria-label="Monthly operations month"
              value={monthKey}
              onChange={(event) => setMonthKey(event.target.value)}
              className="appearance-none rounded-xl border border-gray-200 bg-white py-2.5 pl-3 pr-9 text-sm font-bold"
            >
              {monthOptions.map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-gray-400" />
          </div>
          <button
            type="button"
            aria-label="Reload monthly operations"
            onClick={() => {
              void loadData();
              setProfitabilityRefreshKey((current) => current + 1);
            }}
            className="rounded-xl border border-gray-200 bg-white p-2.5 text-gray-600 hover:bg-gray-50"
            title="Reload"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {mode === 'owner' ? (
        <section className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-950 p-5 text-white">
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Month-end task</div>
            <h3 className="mt-1 text-xl font-black">Finish the month in 3 steps</h3>
            <p className="mt-1 text-xs text-slate-300">
              Enter totals, close inventory, then review the result and submit.
            </p>
          </div>
          <div className="grid gap-0 lg:grid-cols-3">
            {[
              {
                number: 1,
                title: 'Enter monthly totals',
                detail: !reportingComplete
                  ? `${missingDates.length} daily report(s) still missing`
                  : !receiptsComplete
                    ? `${missingReceiptSales.length} receipt image(s) still missing`
                    : profitabilityProgress.operatingInputsComplete
                      ? 'Sales, labor and operating totals are ready'
                      : 'Enter labor, fees, utilities and other monthly totals',
                complete: stepOneComplete,
                active: !stepOneComplete,
                action: () => {
                  if (!reportingComplete && missingDates[0] && onOpenSalesReport) {
                    onOpenSalesReport(missingDates[0]);
                    return;
                  }
                  document.getElementById('monthly-totals')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                },
              },
              {
                number: 2,
                title: 'Close inventory',
                detail: stepTwoComplete
                  ? 'Opening and closing inventory counts are complete'
                  : 'Enter purchases and finish the closing stock count',
                complete: stepTwoComplete,
                active: stepOneComplete && !stepTwoComplete,
                action: () => onOpenInventory?.(),
              },
              {
                number: 3,
                title: 'Review and submit',
                detail: stepThreeComplete
                  ? 'Result checked and store confirmation complete'
                  : profitabilityProgress.profitabilityReady
                    ? 'Check the calculated result, confirm the total and submit'
                    : !profitabilityProgress.settingsComplete
                      ? 'Waiting for HQ store settings before final profit'
                      : 'Available after totals and inventory are complete',
                complete: stepThreeComplete,
                active: stepOneComplete && stepTwoComplete && !stepThreeComplete,
                action: () => document.getElementById('monthly-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
              },
            ].map((step) => (
              <button
                key={step.number}
                type="button"
                onClick={step.action}
                disabled={step.number === 2 && !onOpenInventory}
                className={`flex items-start gap-3 border-b border-slate-200 p-5 text-left transition last:border-b-0 hover:bg-slate-50 disabled:cursor-default lg:border-b-0 lg:border-r lg:last:border-r-0 ${
                  step.active ? 'bg-amber-50' : 'bg-white'
                }`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${
                  step.complete
                    ? 'bg-emerald-700 text-white'
                    : step.active
                      ? 'bg-slate-950 text-white'
                      : 'bg-slate-100 text-slate-500'
                }`}>
                  {step.complete ? '✓' : step.number}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black text-slate-950">{step.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${
                      step.complete
                        ? 'bg-emerald-100 text-emerald-800'
                        : step.active
                          ? 'bg-amber-200 text-amber-950'
                          : 'bg-slate-100 text-slate-500'
                    }`}>
                      {step.complete ? 'Done' : step.active ? 'Next' : 'Waiting'}
                    </span>
                  </span>
                  <span className="mt-1 block text-[11px] leading-4 text-slate-500">{step.detail}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase text-gray-500 sm:text-xs">
            Reported sales <CircleDollarSign className="h-4 w-4" />
          </div>
          <div className="mt-2 text-xl font-extrabold sm:text-2xl">{store.currency} {formatAmount(reportedSales)}</div>
          <div className="mt-1 text-xs text-gray-500">
            {openDaySales.length} business day(s) · {closedDaySales.length} closed day(s)
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase text-gray-500 sm:text-xs">
            Daily reports <ClipboardCheck className="h-4 w-4" />
          </div>
          <div className={`mt-2 text-xl font-extrabold sm:text-2xl ${reportingComplete ? 'text-emerald-700' : 'text-red-600'}`}>
            {submittedCount}/{expectedDates.length}
          </div>
          <div className="mt-1 text-xs text-gray-500">Through the latest completed day</div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase text-gray-500 sm:text-xs">
            Receipt images <FileImage className="h-4 w-4" />
          </div>
          <div className={`mt-2 text-xl font-extrabold sm:text-2xl ${receiptsComplete ? 'text-emerald-700' : 'text-red-600'}`}>
            {openDaySales.length - missingReceiptSales.length}/{openDaySales.length}
          </div>
          <div className="mt-1 text-xs text-gray-500">Attached to open-day reports</div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase text-gray-500 sm:text-xs">
            Review status <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="mt-2 text-lg font-extrabold sm:text-xl">{statusLabel(period?.status)}</div>
          <div className="mt-1 text-xs text-gray-500">
            {period?.approvedAt ? `Approved ${period.approvedAt.slice(0, 10)}` : 'Waiting for completion'}
          </div>
        </div>
      </div>

      <div className={`rounded-2xl border p-5 ${warnings.length ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <div className="flex items-start gap-3">
          {warnings.length
            ? <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />}
          <div className="min-w-0 flex-1">
            <div className={`font-extrabold ${warnings.length ? 'text-red-900' : 'text-emerald-900'}`}>
              {warnings.length
                ? (mode === 'hq' ? 'This store is not ready for approval' : 'Complete these items before submission')
                : (mode === 'hq' ? 'Store submission is complete' : 'Ready to submit to HQ')}
            </div>
            {warnings.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-red-700">
                {warnings.map((warning) => <li key={warning}>• {warning}</li>)}
              </ul>
            )}
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-4">
          <h3 className="font-extrabold">
            {mode === 'hq' ? '1. Sales Reporting Completeness' : 'Daily reports included in Step 1'}
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            These checks come directly from the daily reports already stored in the system.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className={`rounded-xl border p-4 ${reportingComplete ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
            <div className="flex items-start gap-3">
              {reportingComplete
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                : <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />}
              <div className="min-w-0 flex-1">
                <div className="font-bold">Daily sales reports</div>
                <div className="mt-1 text-xs text-gray-600">
                  {reportingComplete
                    ? 'No missing reporting dates.'
                    : `${missingDates.length} date(s) still need a sales or closed-day report.`}
                </div>
                {!reportingComplete && mode === 'owner' && onOpenSalesReport && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {missingDates.slice(0, 12).map((date) => (
                      <button
                        key={date}
                        type="button"
                        onClick={() => onOpenSalesReport(date)}
                        className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
                      >
                        Enter {date}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={`rounded-xl border p-4 ${receiptsComplete ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
            <div className="flex items-start gap-3">
              {receiptsComplete
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                : <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />}
              <div className="min-w-0 flex-1">
                <div className="font-bold">Receipt images</div>
                <div className="mt-1 text-xs text-gray-600">
                  {receiptsComplete
                    ? 'Every open-day report has a receipt image.'
                    : `${missingReceiptSales.length} open-day report(s) need a receipt image.`}
                </div>
                {!receiptsComplete && mode === 'owner' && onOpenSalesReport && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {missingReceiptSales.slice(0, 12).map((sale) => (
                      <button
                        key={sale.id}
                        type="button"
                        onClick={() => onOpenSalesReport(sale.date)}
                        className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
                      >
                        Add receipt {sale.date}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {mode === 'hq' ? (
        <StoreProfitabilitySettingsPanel
          store={store}
          preview={preview}
          onSaved={() => setProfitabilityRefreshKey((current) => current + 1)}
        />
      ) : null}

      <div id="monthly-totals" className="scroll-mt-24">
        <MonthlyProfitabilityInputPanel
          store={store}
          monthStart={monthStart}
          mode={mode}
          lockedForOwner={lockedForOwner}
          preview={preview}
          sectionNumber={mode === 'hq' ? 3 : 2}
          refreshKey={profitabilityRefreshKey}
          onSaved={(complete) => refreshProfitability(complete)}
        />
      </div>

      <ProfitabilityImportPanel
        store={store}
        monthStart={monthStart}
        mode={mode}
        lockedForOwner={lockedForOwner}
        preview={preview}
        sectionNumber={mode === 'hq' ? 4 : 3}
        onApplied={() => refreshProfitability()}
      />

      {mode === 'owner' ? (
        <section className="rounded-2xl border border-slate-300 bg-white p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Step 2 · Inventory close</div>
              <h3 className="mt-1 text-lg font-black text-slate-950">
                {stepTwoComplete ? 'Inventory close is complete' : 'Finish purchases and closing stock count'}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Actual food cost cannot be finalized until opening stock, purchases and closing stock are complete.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenInventory}
              disabled={!onOpenInventory}
              className="shrink-0 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {stepTwoComplete ? 'Review Inventory' : 'Open Cost & Inventory'}
            </button>
          </div>
        </section>
      ) : null}

      <div id="monthly-result" className="scroll-mt-24">
        <MonthlyProfitabilitySummaryPanel
          store={store}
          monthStart={monthStart}
          mode={mode}
          preview={preview}
          refreshKey={profitabilityRefreshKey}
          sectionNumber={mode === 'hq' ? 5 : 3}
        />
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-extrabold">{mode === 'hq' ? '6. Store Confirmation' : 'Final check before submission'}</h3>
            <p className="mt-1 text-xs text-gray-500">
              {mode === 'hq'
                ? 'This is confirmed by the store before submission. HQ reviews it without changing it.'
                : 'Confirm only after checking the monthly total against the store record.'}
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${confirmationComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
            {confirmationComplete ? 'Confirmed' : 'Pending'}
          </span>
        </div>

        {visibleTasks.map((task) => (
          <div key={task.taskKey} className="rounded-xl border border-gray-200 p-4">
            <label className={`flex items-start gap-3 ${mode === 'owner' && !lockedForOwner ? 'cursor-pointer' : ''}`}>
              <input
                type="checkbox"
                checked={task.status === 'completed'}
                disabled={saving || lockedForOwner || mode === 'hq'}
                onChange={(event) => void updateTask(task, event.target.checked ? 'completed' : 'pending')}
                className="mt-1 h-4 w-4 rounded border-gray-300"
              />
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-bold ${task.status === 'completed' ? 'text-emerald-700' : 'text-gray-800'}`}>
                  {task.label}
                </div>
                <input
                  value={task.notes}
                  disabled={saving || lockedForOwner || mode === 'hq'}
                  onChange={(event) => setTasks((current) => [
                    ...current.filter((row) => row.taskKey !== task.taskKey),
                    { ...task, notes: event.target.value },
                  ])}
                  onBlur={(event) => void updateTask(task, task.status, event.target.value)}
                  placeholder={mode === 'hq' ? 'No store note' : 'Optional: explain any variance or correction'}
                  className="mt-2 w-full border-0 bg-transparent p-0 text-xs text-gray-500 outline-none placeholder:text-gray-300 disabled:text-gray-400"
                />
              </div>
            </label>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="font-extrabold">
          {mode === 'hq' ? '7. Notes & Approval' : 'Submit the completed month to HQ'}
        </h3>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <label className="text-xs font-bold text-gray-600">
            Store note
            <textarea
              value={ownerNote}
              disabled={lockedForOwner || mode === 'hq'}
              onChange={(event) => setOwnerNote(event.target.value)}
              rows={4}
              className="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm font-normal disabled:bg-gray-50"
              placeholder={mode === 'hq' ? 'No store note' : 'Explain corrected reports, unusual sales, or open issues.'}
            />
          </label>
          <label className="text-xs font-bold text-gray-600">
            HQ review note
            <textarea
              value={reviewNote}
              disabled={mode !== 'hq'}
              onChange={(event) => setReviewNote(event.target.value)}
              rows={4}
              className="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm font-normal disabled:bg-gray-50"
              placeholder={mode === 'hq' ? 'Record the review result or requested correction.' : 'HQ comments appear here.'}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            disabled={saving || lockedForOwner}
            onClick={() => void saveNotes()}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold disabled:opacity-40"
          >
            Save Notes
          </button>
          <div className="flex flex-wrap gap-2">
            {mode === 'owner' && period?.status !== 'approved' && (
              <>
                {period?.status === 'submitted' && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void savePeriod('reopened')}
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold"
                  >
                    Reopen Draft
                  </button>
                )}
                {period?.status !== 'submitted' && (
                  <button
                    type="button"
                    disabled={saving || !canSubmit}
                    onClick={() => void savePeriod('submitted')}
                    className="rounded-xl bg-black px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Submit to HQ
                  </button>
                )}
              </>
            )}
            {mode === 'hq' && (
              <>
                {period?.status === 'approved' && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void savePeriod('reopened')}
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold"
                  >
                    Reopen
                  </button>
                )}
                <button
                  type="button"
                  disabled={saving || !canSubmit || period?.status !== 'submitted'}
                  onClick={() => void savePeriod('approved')}
                  className="rounded-xl bg-black px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Approve Month
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <div className="font-extrabold text-blue-900">Continue in Cost & Inventory</div>
        <p className="mt-1 text-sm text-blue-800">
          Enter ingredient purchase packs, monthly purchases, waste/adjustments, and opening and closing stock in Cost & Inventory.
          Once those counts are complete, the system calculates actual food cost and compares it with menu and course recipes,
          theoretical usage, and the ingredients that need investigation.
        </p>
      </div>

      {lockedForOwner && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-blue-800">
          {period?.status === 'approved'
            ? 'This month is approved and locked. Ask HQ to reopen it before editing.'
            : 'This month was submitted to HQ. Reopen the draft before making changes.'}
        </div>
      )}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{notice}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
    </div>
  );
};

export default MonthlyCloseWorkspace;
