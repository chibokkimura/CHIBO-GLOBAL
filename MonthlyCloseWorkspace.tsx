import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  FileCheck2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Sale, Store } from './types';
import { supabase } from './supabaseClient';

type CloseStatus = 'draft' | 'submitted' | 'approved' | 'reopened';
type TaskStatus = 'pending' | 'completed' | 'not_applicable';
type TaxStatus = 'pending' | 'completed' | 'not_applicable';
type SettlementStatus = 'pending' | 'settled' | 'not_applicable';

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

type TaxCalendarEvent = {
  id: string;
  storeId: string;
  country: string;
  title: string;
  category: 'tax' | 'payroll' | 'license' | 'other';
  dueDate: string;
  status: TaxStatus;
  notes: string;
};

type SalesVoucher = {
  id: string;
  storeId: string;
  saleId?: string;
  voucherDate: string;
  paymentMethod: PaymentMethod;
  grossAmount: number;
  taxAmount: number;
  settlementDueDate?: string;
  settlementStatus: SettlementStatus;
  referenceNumber: string;
  notes: string;
};

type PaymentMethod =
  | 'cash'
  | 'credit_card'
  | 'qr_wallet'
  | 'delivery_platform'
  | 'bank_transfer'
  | 'other';

type Props = {
  store: Store;
  sales: Sale[];
  initialMonthKey: string;
  mode: 'owner' | 'hq';
  onOpenSalesReport?: (date: string) => void;
};

const DEFAULT_TASKS = [
  { key: 'daily_reports', label: 'All daily sales reports are submitted', order: 10 },
  { key: 'voucher_reconciled', label: 'Sales vouchers match reported sales', order: 20 },
  { key: 'receipts_checked', label: 'Receipts and supporting images are checked', order: 30 },
  { key: 'tax_checked', label: 'Tax and compliance deadlines are checked', order: 40 },
] as const;

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  credit_card: 'Credit Card',
  qr_wallet: 'QR / E-Wallet',
  delivery_platform: 'Delivery Platform',
  bank_transfer: 'Bank Transfer',
  other: 'Other',
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

function mapTaxEvent(row: any): TaxCalendarEvent {
  return {
    id: row.id,
    storeId: row.store_id,
    country: row.country,
    title: row.title,
    category: row.category,
    dueDate: row.due_date,
    status: row.status,
    notes: row.notes ?? '',
  };
}

function mapVoucher(row: any): SalesVoucher {
  return {
    id: row.id,
    storeId: row.store_id,
    saleId: row.sale_id ?? undefined,
    voucherDate: row.voucher_date,
    paymentMethod: row.payment_method,
    grossAmount: Number(row.gross_amount ?? 0),
    taxAmount: Number(row.tax_amount ?? 0),
    settlementDueDate: row.settlement_due_date ?? undefined,
    settlementStatus: row.settlement_status,
    referenceNumber: row.reference_number ?? '',
    notes: row.notes ?? '',
  };
}

const MonthlyCloseWorkspace: React.FC<Props> = ({
  store,
  sales,
  initialMonthKey,
  mode,
  onOpenSalesReport,
}) => {
  const preview = isLocalPreview();
  const [monthKey, setMonthKey] = useState(initialMonthKey);
  const [period, setPeriod] = useState<MonthlyClosePeriod | null>(null);
  const [tasks, setTasks] = useState<MonthlyCloseTask[]>([]);
  const [taxEvents, setTaxEvents] = useState<TaxCalendarEvent[]>([]);
  const [vouchers, setVouchers] = useState<SalesVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showVoucherForm, setShowVoucherForm] = useState(false);
  const [showTaxForm, setShowTaxForm] = useState(false);
  const [ownerNote, setOwnerNote] = useState('');
  const [reviewNote, setReviewNote] = useState('');

  const [voucherDraft, setVoucherDraft] = useState({
    saleId: '',
    voucherDate: `${initialMonthKey}-01`,
    paymentMethod: 'cash' as PaymentMethod,
    grossAmount: '',
    taxAmount: '0',
    settlementDueDate: '',
    settlementStatus: 'pending' as SettlementStatus,
    referenceNumber: '',
    notes: '',
  });
  const [taxDraft, setTaxDraft] = useState({
    title: '',
    category: 'tax' as TaxCalendarEvent['category'],
    dueDate: `${initialMonthKey}-01`,
    notes: '',
  });

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
  const activeMonthSales = useMemo(() => monthSales.filter((sale) => !sale.isClosed), [monthSales]);
  const reportedSales = useMemo(
    () => activeMonthSales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0),
    [activeMonthSales],
  );
  const voucherTotal = useMemo(
    () => vouchers.reduce((sum, voucher) => sum + Number(voucher.grossAmount || 0), 0),
    [vouchers],
  );
  const voucherDifference = reportedSales - voucherTotal;
  const submittedDates = useMemo(() => new Set(monthSales.map((sale) => sale.date)), [monthSales]);
  const missingDates = useMemo(
    () => getExpectedDates(monthKey).filter((date) => !submittedDates.has(date)),
    [monthKey, submittedDates],
  );
  const today = formatLocalDate(new Date());

  const visibleTasks = useMemo(() => {
    const byKey = new Map(tasks.map((task) => [task.taskKey, task]));
    const defaults = DEFAULT_TASKS.map((task) => byKey.get(task.key) ?? ({
      storeId: store.id,
      monthStart,
      taskKey: task.key,
      label: task.label,
      status: 'pending' as TaskStatus,
      notes: '',
      sortOrder: task.order,
    }));
    const custom = tasks.filter((task) => !DEFAULT_TASKS.some((defaultTask) => defaultTask.key === task.taskKey));
    return [...defaults, ...custom].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [tasks, store.id, monthStart]);

  const pendingTasks = visibleTasks.filter((task) => task.status === 'pending');
  const overdueTaxEvents = taxEvents.filter((event) => event.status === 'pending' && event.dueDate < today);
  const warnings = [
    ...(missingDates.length > 0 ? [`${missingDates.length} daily report(s) missing`] : []),
    ...(Math.abs(voucherDifference) > 0.009 ? [`Voucher difference: ${store.currency} ${formatAmount(voucherDifference)}`] : []),
    ...(pendingTasks.length > 0 ? [`${pendingTasks.length} checklist item(s) pending`] : []),
    ...(overdueTaxEvents.length > 0 ? [`${overdueTaxEvents.length} overdue tax/compliance item(s)`] : []),
  ];
  const canSubmit = warnings.length === 0;
  const lockedForOwner = mode === 'owner' && (period?.status === 'submitted' || period?.status === 'approved');

  const monthOptions = useMemo(() => {
    const keys = new Set<string>([initialMonthKey, monthKey, formatLocalDate(new Date()).slice(0, 7)]);
    sales.filter((sale) => sale.storeId === store.id).forEach((sale) => keys.add(sale.date.slice(0, 7)));
    return Array.from(keys).filter(Boolean).sort((a, b) => b.localeCompare(a));
  }, [initialMonthKey, monthKey, sales, store.id]);

  const seedPreview = useCallback(() => {
    const sampleTasks: MonthlyCloseTask[] = DEFAULT_TASKS.map((task, index) => ({
      id: `preview-task-${task.key}`,
      storeId: store.id,
      monthStart,
      taskKey: task.key,
      label: task.label,
      status: index < 2 ? 'completed' : 'pending',
      notes: '',
      sortOrder: task.order,
    }));
    setPeriod({
      id: 'preview-period',
      storeId: store.id,
      monthStart,
      status: 'draft',
      ownerNote: '',
      reviewNote: '',
    });
    setTasks(sampleTasks);
    setTaxEvents([{
      id: 'preview-tax-1',
      storeId: store.id,
      country: store.country,
      title: 'Monthly VAT filing',
      category: 'tax',
      dueDate: monthEnd,
      status: 'pending',
      notes: 'Confirm the local filing deadline.',
    }]);
    const firstSale = activeMonthSales[0];
    setVouchers(firstSale ? [{
      id: 'preview-voucher-1',
      storeId: store.id,
      saleId: firstSale.id,
      voucherDate: firstSale.date,
      paymentMethod: 'credit_card',
      grossAmount: firstSale.totalAmount,
      taxAmount: 0,
      settlementDueDate: firstSale.date,
      settlementStatus: 'pending',
      referenceNumber: 'PREVIEW-001',
      notes: '',
    }] : []);
    setOwnerNote('');
    setReviewNote('');
  }, [activeMonthSales, monthEnd, monthStart, store.country, store.id]);

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
      const [periodResult, tasksResult, taxResult, vouchersResult] = await Promise.all([
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
          .order('sort_order'),
        supabase
          .from('tax_calendar_events')
          .select('id,store_id,country,title,category,due_date,status,notes')
          .eq('store_id', store.id)
          .gte('due_date', monthStart)
          .lte('due_date', monthEnd)
          .order('due_date'),
        supabase
          .from('sales_vouchers')
          .select('id,store_id,sale_id,voucher_date,payment_method,gross_amount,tax_amount,settlement_due_date,settlement_status,reference_number,notes')
          .eq('store_id', store.id)
          .gte('voucher_date', monthStart)
          .lte('voucher_date', monthEnd)
          .order('voucher_date'),
      ]);

      const firstError = periodResult.error || tasksResult.error || taxResult.error || vouchersResult.error;
      if (firstError) throw firstError;

      const nextPeriod = periodResult.data ? mapPeriod(periodResult.data) : null;
      setPeriod(nextPeriod);
      setTasks((tasksResult.data ?? []).map(mapTask));
      setTaxEvents((taxResult.data ?? []).map(mapTaxEvent));
      setVouchers((vouchersResult.data ?? []).map(mapVoucher));
      setOwnerNote(nextPeriod?.ownerNote ?? '');
      setReviewNote(nextPeriod?.reviewNote ?? '');
    } catch (loadError: any) {
      console.error('Failed to load monthly close data', loadError);
      const message = String(loadError?.message ?? '');
      setError(
        message.toLowerCase().includes('could not find the table')
          ? 'Update 4 database tables are not active yet. Apply the Phase 4 migration, then reload.'
          : (message || 'Failed to load monthly close data.'),
      );
    } finally {
      setLoading(false);
    }
  }, [monthEnd, monthStart, preview, seedPreview, store.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setVoucherDraft((current) => ({
      ...current,
      saleId: '',
      voucherDate: monthStart,
      grossAmount: '',
      taxAmount: '0',
      settlementDueDate: '',
      referenceNumber: '',
      notes: '',
    }));
    setTaxDraft((current) => ({ ...current, title: '', dueDate: monthStart, notes: '' }));
  }, [monthStart]);

  const updateTask = async (task: MonthlyCloseTask, status: TaskStatus, notes = task.notes) => {
    if (lockedForOwner) return;
    setSaving(true);
    setError(null);
    const nextTask: MonthlyCloseTask = { ...task, status, notes };
    try {
      if (preview) {
        setTasks((current) => [...current.filter((row) => row.taskKey !== task.taskKey), { ...nextTask, id: task.id ?? `preview-${task.taskKey}` }]);
        return;
      }
      const payload = {
        store_id: store.id,
        month_start: monthStart,
        task_key: task.taskKey,
        label: task.label,
        due_date: task.dueDate ?? null,
        status,
        notes: notes || null,
        sort_order: task.sortOrder,
        completed_at: status === 'completed' ? new Date().toISOString() : null,
        completed_by: status === 'completed' ? (await supabase.auth.getUser()).data.user?.id ?? null : null,
      };
      const { data, error: saveError } = await supabase
        .from('monthly_close_tasks')
        .upsert(payload, { onConflict: 'store_id,month_start,task_key' })
        .select('id,store_id,month_start,task_key,label,due_date,status,notes,sort_order')
        .single();
      if (saveError) throw saveError;
      setTasks((current) => [...current.filter((row) => row.taskKey !== task.taskKey), mapTask(data)]);
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Failed to update checklist.');
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
          submittedAt: nextStatus === 'submitted' || nextStatus === 'approved' ? new Date().toISOString() : current?.submittedAt,
          approvedAt: nextStatus === 'approved' ? new Date().toISOString() : undefined,
        }));
        setNotice(nextStatus === 'approved' ? 'Preview month close approved.' : 'Preview status updated.');
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
      setNotice(nextStatus === 'approved' ? 'Month close approved.' : 'Month close status saved.');
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Failed to save monthly close status.');
    } finally {
      setSaving(false);
    }
  };

  const saveNotes = async () => {
    await savePeriod(period?.status ?? 'draft');
  };

  const addVoucher = async () => {
    const grossAmount = Number(voucherDraft.grossAmount);
    const taxAmount = Number(voucherDraft.taxAmount || 0);
    if (!voucherDraft.voucherDate || !Number.isFinite(grossAmount) || grossAmount < 0) {
      setError('Enter a voucher date and a valid amount.');
      return;
    }
    if (!Number.isFinite(taxAmount) || taxAmount < 0 || taxAmount > grossAmount) {
      setError('Tax must be between 0 and the gross amount.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const next: SalesVoucher = {
        id: preview ? `preview-voucher-${Date.now()}` : '',
        storeId: store.id,
        saleId: voucherDraft.saleId || undefined,
        voucherDate: voucherDraft.voucherDate,
        paymentMethod: voucherDraft.paymentMethod,
        grossAmount,
        taxAmount,
        settlementDueDate: voucherDraft.settlementDueDate || undefined,
        settlementStatus: voucherDraft.settlementStatus,
        referenceNumber: voucherDraft.referenceNumber.trim(),
        notes: voucherDraft.notes.trim(),
      };
      if (preview) {
        setVouchers((current) => [...current, next]);
      } else {
        const { data, error: saveError } = await supabase
          .from('sales_vouchers')
          .insert({
            store_id: store.id,
            sale_id: next.saleId ?? null,
            voucher_date: next.voucherDate,
            payment_method: next.paymentMethod,
            gross_amount: next.grossAmount,
            tax_amount: next.taxAmount,
            settlement_due_date: next.settlementDueDate ?? null,
            settlement_status: next.settlementStatus,
            reference_number: next.referenceNumber || null,
            notes: next.notes || null,
            settled_at: next.settlementStatus === 'settled' ? new Date().toISOString() : null,
          })
          .select('id,store_id,sale_id,voucher_date,payment_method,gross_amount,tax_amount,settlement_due_date,settlement_status,reference_number,notes')
          .single();
        if (saveError) throw saveError;
        setVouchers((current) => [...current, mapVoucher(data)].sort((a, b) => a.voucherDate.localeCompare(b.voucherDate)));
      }
      setVoucherDraft((current) => ({
        ...current,
        saleId: '',
        voucherDate: monthStart,
        grossAmount: '',
        taxAmount: '0',
        settlementDueDate: '',
        referenceNumber: '',
        notes: '',
      }));
      setShowVoucherForm(false);
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Failed to add sales voucher.');
    } finally {
      setSaving(false);
    }
  };

  const toggleVoucherSettlement = async (voucher: SalesVoucher) => {
    if (lockedForOwner) return;
    const nextStatus: SettlementStatus = voucher.settlementStatus === 'settled' ? 'pending' : 'settled';
    setSaving(true);
    setError(null);
    try {
      if (!preview) {
        const { error: saveError } = await supabase
          .from('sales_vouchers')
          .update({
            settlement_status: nextStatus,
            settled_at: nextStatus === 'settled' ? new Date().toISOString() : null,
          })
          .eq('id', voucher.id);
        if (saveError) throw saveError;
      }
      setVouchers((current) => current.map((row) => row.id === voucher.id ? { ...row, settlementStatus: nextStatus } : row));
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Failed to update settlement.');
    } finally {
      setSaving(false);
    }
  };

  const deleteVoucher = async (voucher: SalesVoucher) => {
    if (lockedForOwner || !window.confirm('Delete this sales voucher?')) return;
    setSaving(true);
    setError(null);
    try {
      if (!preview) {
        const { error: deleteError } = await supabase.from('sales_vouchers').delete().eq('id', voucher.id);
        if (deleteError) throw deleteError;
      }
      setVouchers((current) => current.filter((row) => row.id !== voucher.id));
    } catch (deleteError: any) {
      setError(deleteError?.message ?? 'Failed to delete voucher.');
    } finally {
      setSaving(false);
    }
  };

  const addTaxEvent = async () => {
    if (!taxDraft.title.trim() || !taxDraft.dueDate) {
      setError('Enter a title and due date.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next: TaxCalendarEvent = {
        id: preview ? `preview-tax-${Date.now()}` : '',
        storeId: store.id,
        country: store.country,
        title: taxDraft.title.trim(),
        category: taxDraft.category,
        dueDate: taxDraft.dueDate,
        status: 'pending',
        notes: taxDraft.notes.trim(),
      };
      if (preview) {
        setTaxEvents((current) => [...current, next].sort((a, b) => a.dueDate.localeCompare(b.dueDate)));
      } else {
        const { data, error: saveError } = await supabase
          .from('tax_calendar_events')
          .insert({
            store_id: store.id,
            country: store.country,
            title: next.title,
            category: next.category,
            due_date: next.dueDate,
            status: next.status,
            notes: next.notes || null,
          })
          .select('id,store_id,country,title,category,due_date,status,notes')
          .single();
        if (saveError) throw saveError;
        setTaxEvents((current) => [...current, mapTaxEvent(data)].sort((a, b) => a.dueDate.localeCompare(b.dueDate)));
      }
      setTaxDraft((current) => ({ ...current, title: '', dueDate: monthStart, notes: '' }));
      setShowTaxForm(false);
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Failed to add tax schedule.');
    } finally {
      setSaving(false);
    }
  };

  const toggleTaxEvent = async (event: TaxCalendarEvent) => {
    if (lockedForOwner) return;
    const nextStatus: TaxStatus = event.status === 'completed' ? 'pending' : 'completed';
    setSaving(true);
    setError(null);
    try {
      if (!preview) {
        const authUser = nextStatus === 'completed' ? (await supabase.auth.getUser()).data.user?.id ?? null : null;
        const { error: saveError } = await supabase
          .from('tax_calendar_events')
          .update({
            status: nextStatus,
            completed_at: nextStatus === 'completed' ? new Date().toISOString() : null,
            completed_by: authUser,
          })
          .eq('id', event.id);
        if (saveError) throw saveError;
      }
      setTaxEvents((current) => current.map((row) => row.id === event.id ? { ...row, status: nextStatus } : row));
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Failed to update tax schedule.');
    } finally {
      setSaving(false);
    }
  };

  const deleteTaxEvent = async (event: TaxCalendarEvent) => {
    if (lockedForOwner || !window.confirm('Delete this schedule item?')) return;
    setSaving(true);
    setError(null);
    try {
      if (!preview) {
        const { error: deleteError } = await supabase.from('tax_calendar_events').delete().eq('id', event.id);
        if (deleteError) throw deleteError;
      }
      setTaxEvents((current) => current.filter((row) => row.id !== event.id));
    } catch (deleteError: any) {
      setError(deleteError?.message ?? 'Failed to delete schedule item.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        Loading monthly close…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">
            {mode === 'hq' ? 'HQ monthly review' : 'Monthly readiness'}
          </div>
          <h2 className="mt-1 text-2xl font-extrabold">Month Close</h2>
          <p className="mt-1 text-sm text-gray-500">
            Checklist, tax deadlines, payment details, and final approval in one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              aria-label="Month close month"
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
            onClick={() => void loadData()}
            className="rounded-xl border border-gray-200 bg-white p-2.5 text-gray-600 hover:bg-gray-50"
            title="Reload"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-gray-500">
            Reported sales <CircleDollarSign className="h-4 w-4" />
          </div>
          <div className="mt-2 text-2xl font-extrabold">{store.currency} {formatAmount(reportedSales)}</div>
          <div className="mt-1 text-xs text-gray-500">{activeMonthSales.length} open-day report(s)</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-gray-500">
            Voucher total <FileCheck2 className="h-4 w-4" />
          </div>
          <div className="mt-2 text-2xl font-extrabold">{store.currency} {formatAmount(voucherTotal)}</div>
          <div className={`mt-1 text-xs font-bold ${Math.abs(voucherDifference) > 0.009 ? 'text-red-600' : 'text-emerald-600'}`}>
            Difference {store.currency} {formatAmount(voucherDifference)}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-gray-500">
            Missing reports <AlertOctagon className="h-4 w-4" />
          </div>
          <div className={`mt-2 text-3xl font-extrabold ${missingDates.length ? 'text-red-600' : 'text-emerald-600'}`}>
            {missingDates.length}
          </div>
          <div className="mt-1 text-xs text-gray-500">Through the latest completed day</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-gray-500">
            Close status <ClipboardCheck className="h-4 w-4" />
          </div>
          <div className="mt-2 text-xl font-extrabold capitalize">{period?.status ?? 'draft'}</div>
          <div className="mt-1 text-xs text-gray-500">
            {period?.approvedAt ? `Approved ${period.approvedAt.slice(0, 10)}` : 'Not approved yet'}
          </div>
        </div>
      </div>

      <div className={`rounded-2xl border p-5 ${warnings.length ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <div className="flex items-start gap-3">
          {warnings.length
            ? <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />}
          <div>
            <div className={`font-extrabold ${warnings.length ? 'text-red-900' : 'text-emerald-900'}`}>
              {warnings.length ? 'Resolve these items before submission' : 'Ready to submit for HQ approval'}
            </div>
            {warnings.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-red-700">
                {warnings.map((warning) => <li key={warning}>• {warning}</li>)}
              </ul>
            )}
            {missingDates.length > 0 && onOpenSalesReport && (
              <div className="mt-3 flex flex-wrap gap-2">
                {missingDates.slice(0, 10).map((date) => (
                  <button
                    key={date}
                    type="button"
                    onClick={() => onOpenSalesReport(date)}
                    className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
                  >
                    {date}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-extrabold">1. Monthly Close Checklist</h3>
            <p className="mt-1 text-xs text-gray-500">Complete each confirmation after checking the underlying data.</p>
          </div>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">
            {visibleTasks.length - pendingTasks.length}/{visibleTasks.length}
          </span>
        </div>
        <div className="space-y-2">
          {visibleTasks.map((task) => (
            <div key={task.taskKey} className="rounded-xl border border-gray-200 p-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={task.status === 'completed'}
                  disabled={saving || lockedForOwner}
                  onChange={(event) => void updateTask(task, event.target.checked ? 'completed' : 'pending')}
                  className="mt-1 h-4 w-4 rounded border-gray-300"
                />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-bold ${task.status === 'completed' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                    {task.label}
                  </div>
                  <input
                    value={task.notes}
                    disabled={saving || lockedForOwner}
                    onChange={(event) => setTasks((current) => {
                      const without = current.filter((row) => row.taskKey !== task.taskKey);
                      return [...without, { ...task, notes: event.target.value }];
                    })}
                    onBlur={(event) => void updateTask(task, task.status, event.target.value)}
                    placeholder="Optional note"
                    className="mt-2 w-full border-0 bg-transparent p-0 text-xs text-gray-500 outline-none placeholder:text-gray-300"
                  />
                </div>
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-extrabold">2. Sales Vouchers & Payment Methods</h3>
            <p className="mt-1 text-xs text-gray-500">Split daily sales by payment method and track settlement dates.</p>
          </div>
          <button
            type="button"
            disabled={lockedForOwner}
            onClick={() => setShowVoucherForm((current) => !current)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-black px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Add Voucher
          </button>
        </div>

        {showVoucherForm && (
          <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs font-bold text-gray-600">
                Linked daily report
                <select
                  value={voucherDraft.saleId}
                  onChange={(event) => {
                    const sale = activeMonthSales.find((row) => row.id === event.target.value);
                    setVoucherDraft((current) => ({
                      ...current,
                      saleId: event.target.value,
                      voucherDate: sale?.date ?? current.voucherDate,
                      grossAmount: sale ? String(sale.totalAmount) : current.grossAmount,
                    }));
                  }}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium"
                >
                  <option value="">Manual / not linked</option>
                  {activeMonthSales.map((sale) => (
                    <option key={sale.id} value={sale.id}>{sale.date} · {store.currency} {formatAmount(sale.totalAmount)}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-gray-600">
                Voucher date
                <input type="date" min={monthStart} max={monthEnd} value={voucherDraft.voucherDate} onChange={(event) => setVoucherDraft({ ...voucherDraft, voucherDate: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-bold text-gray-600">
                Payment method
                <select value={voucherDraft.paymentMethod} onChange={(event) => setVoucherDraft({ ...voucherDraft, paymentMethod: event.target.value as PaymentMethod })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                  {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((method) => <option key={method} value={method}>{PAYMENT_METHOD_LABELS[method]}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-gray-600">
                Gross amount ({store.currency})
                <input type="number" min="0" step="0.01" value={voucherDraft.grossAmount} onChange={(event) => setVoucherDraft({ ...voucherDraft, grossAmount: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-bold text-gray-600">
                Tax amount ({store.currency})
                <input type="number" min="0" step="0.01" value={voucherDraft.taxAmount} onChange={(event) => setVoucherDraft({ ...voucherDraft, taxAmount: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-bold text-gray-600">
                Settlement due
                <input type="date" value={voucherDraft.settlementDueDate} onChange={(event) => setVoucherDraft({ ...voucherDraft, settlementDueDate: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-bold text-gray-600">
                Settlement
                <select value={voucherDraft.settlementStatus} onChange={(event) => setVoucherDraft({ ...voucherDraft, settlementStatus: event.target.value as SettlementStatus })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                  <option value="pending">Pending</option>
                  <option value="settled">Settled</option>
                  <option value="not_applicable">Not applicable</option>
                </select>
              </label>
              <label className="text-xs font-bold text-gray-600">
                Reference number
                <input value={voucherDraft.referenceNumber} onChange={(event) => setVoucherDraft({ ...voucherDraft, referenceNumber: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="Optional" />
              </label>
            </div>
            <label className="mt-3 block text-xs font-bold text-gray-600">
              Note
              <input value={voucherDraft.notes} onChange={(event) => setVoucherDraft({ ...voucherDraft, notes: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="Optional" />
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setShowVoucherForm(false)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold">Cancel</button>
              <button type="button" disabled={saving} onClick={() => void addVoucher()} className="rounded-lg bg-black px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Save Voucher</button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase text-gray-400">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2 text-right">Gross</th>
                <th className="px-3 py-2 text-right">Tax</th>
                <th className="px-3 py-2">Settlement</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {vouchers.map((voucher) => (
                <tr key={voucher.id} className="border-b border-gray-100">
                  <td className="px-3 py-3 font-bold">{voucher.voucherDate}</td>
                  <td className="px-3 py-3">{PAYMENT_METHOD_LABELS[voucher.paymentMethod]}</td>
                  <td className="px-3 py-3 text-right font-bold">{store.currency} {formatAmount(voucher.grossAmount)}</td>
                  <td className="px-3 py-3 text-right">{formatAmount(voucher.taxAmount)}</td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      disabled={lockedForOwner}
                      onClick={() => void toggleVoucherSettlement(voucher)}
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${voucher.settlementStatus === 'settled' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
                    >
                      {voucher.settlementStatus === 'settled' ? 'Settled' : 'Pending'}
                    </button>
                    {voucher.settlementDueDate && <div className="mt-1 text-[10px] text-gray-400">Due {voucher.settlementDueDate}</div>}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500">{voucher.referenceNumber || '—'}</td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      aria-label={`Delete voucher ${voucher.voucherDate} ${PAYMENT_METHOD_LABELS[voucher.paymentMethod]}`}
                      disabled={lockedForOwner}
                      onClick={() => void deleteVoucher(voucher)}
                      className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {vouchers.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">No vouchers entered for this month.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-extrabold">3. Tax & Compliance Calendar</h3>
            <p className="mt-1 text-xs text-gray-500">{store.country} · deadlines for the selected month</p>
          </div>
          <button
            type="button"
            disabled={lockedForOwner}
            onClick={() => setShowTaxForm((current) => !current)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Add Deadline
          </button>
        </div>

        {showTaxForm && (
          <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="text-xs font-bold text-gray-600">
                Title
                <input value={taxDraft.title} onChange={(event) => setTaxDraft({ ...taxDraft, title: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="e.g. VAT filing" />
              </label>
              <label className="text-xs font-bold text-gray-600">
                Category
                <select value={taxDraft.category} onChange={(event) => setTaxDraft({ ...taxDraft, category: event.target.value as TaxCalendarEvent['category'] })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                  <option value="tax">Tax</option>
                  <option value="payroll">Payroll</option>
                  <option value="license">License</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="text-xs font-bold text-gray-600">
                Due date
                <input type="date" min={monthStart} max={monthEnd} value={taxDraft.dueDate} onChange={(event) => setTaxDraft({ ...taxDraft, dueDate: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              </label>
            </div>
            <label className="mt-3 block text-xs font-bold text-gray-600">
              Note
              <input value={taxDraft.notes} onChange={(event) => setTaxDraft({ ...taxDraft, notes: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="Optional" />
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setShowTaxForm(false)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold">Cancel</button>
              <button type="button" disabled={saving} onClick={() => void addTaxEvent()} className="rounded-lg bg-black px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Save Deadline</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {taxEvents.map((event) => {
            const overdue = event.status === 'pending' && event.dueDate < today;
            return (
              <div key={event.id} className={`flex items-center gap-3 rounded-xl border p-3 ${overdue ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
                <button
                  type="button"
                  aria-label={`${event.status === 'completed' ? 'Mark pending' : 'Mark completed'}: ${event.title}`}
                  disabled={lockedForOwner}
                  onClick={() => void toggleTaxEvent(event)}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${event.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}
                >
                  {event.status === 'completed' ? <CheckCircle2 className="h-5 w-5" /> : <CalendarDays className="h-5 w-5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{event.title}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-500">{event.category}</span>
                    {overdue && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">Overdue</span>}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">Due {event.dueDate}{event.notes ? ` · ${event.notes}` : ''}</div>
                </div>
                <button
                  type="button"
                  aria-label={`Delete deadline: ${event.title}`}
                  disabled={lockedForOwner}
                  onClick={() => void deleteTaxEvent(event)}
                  className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
          {taxEvents.length === 0 && <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">No deadlines entered for this month.</div>}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="font-extrabold">4. Notes & Approval</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <label className="text-xs font-bold text-gray-600">
            Store note
            <textarea value={ownerNote} disabled={lockedForOwner} onChange={(event) => setOwnerNote(event.target.value)} rows={4} className="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm font-normal" placeholder="Explain variances or open items." />
          </label>
          <label className="text-xs font-bold text-gray-600">
            HQ review note
            <textarea value={reviewNote} disabled={mode !== 'hq'} onChange={(event) => setReviewNote(event.target.value)} rows={4} className="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm font-normal disabled:bg-gray-50" placeholder={mode === 'hq' ? 'Add review comments.' : 'HQ comments appear here.'} />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button type="button" disabled={saving || lockedForOwner} onClick={() => void saveNotes()} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold disabled:opacity-40">Save Notes</button>
          <div className="flex flex-wrap gap-2">
            {mode === 'owner' && period?.status !== 'approved' && (
              <>
                {(period?.status === 'submitted') && (
                  <button type="button" disabled={saving} onClick={() => void savePeriod('reopened')} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold">Reopen Draft</button>
                )}
                {period?.status !== 'submitted' && (
                  <button type="button" disabled={saving || !canSubmit} onClick={() => void savePeriod('submitted')} className="rounded-xl bg-black px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">Submit to HQ</button>
                )}
              </>
            )}
            {mode === 'hq' && (
              <>
                {period?.status === 'approved' && <button type="button" disabled={saving} onClick={() => void savePeriod('reopened')} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold">Reopen</button>}
                <button type="button" disabled={saving || !canSubmit || period?.status !== 'submitted'} onClick={() => void savePeriod('approved')} className="rounded-xl bg-black px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">Approve Month</button>
              </>
            )}
          </div>
        </div>
      </section>

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
