import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  FileSpreadsheet,
  History,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { Store } from './types';
import { supabase } from './supabaseClient';
import {
  AggregationMode,
  buildHeaders,
  calculateImport,
  getSheetRows,
  guessHeaderRow,
  guessMapping,
  ImportMapping,
  ImportSourceType,
  ImportTargetKey,
  readSpreadsheet,
  safeFileName,
  sha256Hex,
  SOURCE_OPTIONS,
  SOURCE_TARGETS,
  TARGET_CONFIG,
} from './profitabilityImport';

type ImportProfile = {
  sourceType: ImportSourceType;
  sheetName: string | null;
  headerRow: number;
  mapping: ImportMapping;
};

type ImportRun = {
  id: string;
  sourceType: ImportSourceType;
  originalFileName: string;
  storagePath: string;
  sheetName: string | null;
  rowCount: number;
  totals: Partial<Record<ImportTargetKey, number>>;
  appliedAt: string;
};

type Props = {
  store: Store;
  monthStart: string;
  mode: 'owner' | 'hq';
  lockedForOwner: boolean;
  preview: boolean;
  sectionNumber: number;
  onApplied?: () => void;
};

const IMPORT_BUCKET = 'profitability-imports';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_FILE_PATTERN = /\.(csv|xlsx|xls)$/i;

function mapProfile(row: any): ImportProfile {
  return {
    sourceType: row.source_type,
    sheetName: row.sheet_name ?? null,
    headerRow: Number(row.header_row ?? 1),
    mapping: (row.column_mapping ?? {}) as ImportMapping,
  };
}

function mapRun(row: any): ImportRun {
  return {
    id: row.id,
    sourceType: row.source_type,
    originalFileName: row.original_file_name,
    storagePath: row.storage_path,
    sheetName: row.sheet_name ?? null,
    rowCount: Number(row.row_count ?? 0),
    totals: (row.imported_totals ?? {}) as ImportRun['totals'],
    appliedAt: row.applied_at,
  };
}

function sourceLabel(sourceType: ImportSourceType): string {
  return SOURCE_OPTIONS.find((option) => option.value === sourceType)?.label ?? sourceType;
}

function formatAmount(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value);
}

function normalizeMapping(
  mapping: ImportMapping,
  targets: ImportTargetKey[],
  columnCount: number,
): ImportMapping {
  const normalized: ImportMapping = {
    excludeTotalRows: mapping.excludeTotalRows !== false,
  };
  targets.forEach((target) => {
    const rule = mapping[target];
    normalized[target] = {
      columnIndex: rule?.columnIndex !== null
        && rule?.columnIndex !== undefined
        && rule.columnIndex >= 0
        && rule.columnIndex < columnCount
        ? rule.columnIndex
        : null,
      aggregation: ['sum', 'last', 'max'].includes(rule?.aggregation ?? '')
        ? rule!.aggregation
        : 'sum',
    };
  });
  return normalized;
}

const ProfitabilityImportPanel: React.FC<Props> = ({
  store,
  monthStart,
  mode,
  lockedForOwner,
  preview,
  sectionNumber,
  onApplied,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [sourceType, setSourceType] = useState<ImportSourceType>('attendance');
  const [profiles, setProfiles] = useState<Partial<Record<ImportSourceType, ImportProfile>>>({});
  const [history, setHistory] = useState<ImportRun[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<Awaited<ReturnType<typeof readSpreadsheet>> | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [mapping, setMapping] = useState<ImportMapping>({ excludeTotalRows: true });
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(mode === 'hq');

  const editable = mode === 'owner' && !lockedForOwner;
  const targets = SOURCE_TARGETS[sourceType];
  const rows = useMemo(
    () => workbook && sheetName ? getSheetRows(workbook, sheetName) : [],
    [sheetName, workbook],
  );
  const headers = useMemo(() => buildHeaders(rows, headerRow), [headerRow, rows]);
  const calculation = useMemo(
    () => calculateImport(rows, headerRow, targets, mapping),
    [headerRow, mapping, rows, targets],
  );
  const mappedTargets = targets.filter((target) => mapping[target]?.columnIndex !== null);
  const calculationValid = mappedTargets.length > 0
    && mappedTargets.every((target) => calculation.results[target]?.numericCount)
    && (Object.values(calculation.totals) as Array<number | undefined>)
      .every((value) => value !== undefined && value >= 0)
    && (
      calculation.totals.guest_count === undefined
      || Number.isInteger(calculation.totals.guest_count)
    );

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);

    if (preview) {
      setProfiles({
        attendance: {
          sourceType: 'attendance',
          sheetName: 'Attendance',
          headerRow: 1,
          mapping: {
            excludeTotalRows: true,
            labor_hours: { columnIndex: 2, aggregation: 'sum' },
          },
        },
      });
      setHistory([
        {
          id: 'preview-import',
          sourceType: 'payroll',
          originalFileName: 'payroll_2099-01.xlsx',
          storagePath: '',
          sheetName: 'Payroll',
          rowCount: 12,
          totals: { labor_cost: 300000 },
          appliedAt: '2099-02-01T09:00:00.000Z',
        },
      ]);
      setLoading(false);
      return;
    }

    try {
      const [profileResult, historyResult] = await Promise.all([
        supabase
          .from('profitability_import_profiles')
          .select('source_type,sheet_name,header_row,column_mapping')
          .eq('store_id', store.id),
        supabase
          .from('profitability_import_runs')
          .select('id,source_type,original_file_name,storage_path,sheet_name,row_count,imported_totals,applied_at')
          .eq('store_id', store.id)
          .eq('month_start', monthStart)
          .order('applied_at', { ascending: false })
          .limit(8),
      ]);
      const loadError = profileResult.error || historyResult.error;
      if (loadError) throw loadError;

      const nextProfiles: Partial<Record<ImportSourceType, ImportProfile>> = {};
      (profileResult.data ?? []).map(mapProfile).forEach((profile) => {
        nextProfiles[profile.sourceType] = profile;
      });
      setProfiles(nextProfiles);
      setHistory((historyResult.data ?? []).map(mapRun));
    } catch (loadError: any) {
      setError(loadError?.message ?? 'Failed to load file import settings.');
    } finally {
      setLoading(false);
    }
  }, [monthStart, preview, store.id]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const configureWorkbook = (
    nextWorkbook: Awaited<ReturnType<typeof readSpreadsheet>>,
    nextSourceType: ImportSourceType,
  ) => {
    const profile = profiles[nextSourceType];
    const savedSheetAvailable = Boolean(
      profile?.sheetName && nextWorkbook.SheetNames.includes(profile.sheetName),
    );
    const nextSheetName = savedSheetAvailable && profile?.sheetName
      ? profile.sheetName
      : nextWorkbook.SheetNames[0] ?? '';
    const nextRows = getSheetRows(nextWorkbook, nextSheetName);
    const nextTargets = SOURCE_TARGETS[nextSourceType];
    const nextHeaderRow = savedSheetAvailable && profile?.headerRow
      && profile.headerRow <= Math.max(nextRows.length, 1)
      ? profile.headerRow
      : guessHeaderRow(nextRows, nextTargets);
    const nextHeaders = buildHeaders(nextRows, nextHeaderRow);
    const nextMapping = savedSheetAvailable && profile
      ? normalizeMapping(profile.mapping, nextTargets, nextHeaders.length)
      : guessMapping(nextHeaders, nextTargets);

    setSheetName(nextSheetName);
    setHeaderRow(nextHeaderRow);
    setMapping(nextMapping);
    setConfirmed(false);
  };

  const handleFile = async (nextFile: File | null) => {
    if (!nextFile) return;
    setError(null);
    setNotice(null);
    setConfirmed(false);

    if (!ACCEPTED_FILE_PATTERN.test(nextFile.name)) {
      setError('Choose a CSV, XLSX or XLS file.');
      return;
    }
    if (nextFile.size <= 0 || nextFile.size > MAX_FILE_SIZE) {
      setError('The import file must be larger than 0 bytes and no more than 10 MB.');
      return;
    }

    setReading(true);
    try {
      const nextWorkbook = await readSpreadsheet(nextFile);
      if (nextWorkbook.SheetNames.length === 0) throw new Error('The file has no readable worksheets.');
      setFile(nextFile);
      setWorkbook(nextWorkbook);
      configureWorkbook(nextWorkbook, sourceType);
    } catch (readError: any) {
      setFile(null);
      setWorkbook(null);
      setError(readError?.message ?? 'Failed to read the spreadsheet.');
    } finally {
      setReading(false);
    }
  };

  const changeSource = (nextSourceType: ImportSourceType) => {
    setSourceType(nextSourceType);
    setError(null);
    setNotice(null);
    if (workbook) configureWorkbook(workbook, nextSourceType);
  };

  const changeSheet = (nextSheetName: string) => {
    if (!workbook) return;
    const nextRows = getSheetRows(workbook, nextSheetName);
    const profile = profiles[sourceType];
    const nextHeaderRow = profile?.sheetName === nextSheetName
      ? profile.headerRow
      : guessHeaderRow(nextRows, targets);
    const nextHeaders = buildHeaders(nextRows, nextHeaderRow);
    const nextMapping = profile?.sheetName === nextSheetName
      ? normalizeMapping(profile.mapping, targets, nextHeaders.length)
      : guessMapping(nextHeaders, targets);
    setSheetName(nextSheetName);
    setHeaderRow(nextHeaderRow);
    setMapping(nextMapping);
    setConfirmed(false);
  };

  const changeHeaderRow = (nextHeaderRow: number) => {
    const boundedRow = Math.min(Math.max(nextHeaderRow, 1), Math.max(rows.length, 1));
    const nextHeaders = buildHeaders(rows, boundedRow);
    setHeaderRow(boundedRow);
    setMapping(guessMapping(nextHeaders, targets));
    setConfirmed(false);
  };

  const updateRule = (
    target: ImportTargetKey,
    patch: Partial<{ columnIndex: number | null; aggregation: AggregationMode }>,
  ) => {
    setMapping((current) => ({
      ...current,
      [target]: {
        columnIndex: current[target]?.columnIndex ?? null,
        aggregation: current[target]?.aggregation ?? 'sum',
        ...patch,
      },
    }));
    setConfirmed(false);
    setError(null);
    setNotice(null);
  };

  const applyImport = async () => {
    if (!editable || !file || !workbook || !calculationValid || !confirmed) return;
    setApplying(true);
    setError(null);
    setNotice(null);

    const mappingSnapshot: ImportMapping = { excludeTotalRows: mapping.excludeTotalRows !== false };
    targets.forEach((target) => {
      const rule = mapping[target];
      if (rule?.columnIndex !== null && rule?.columnIndex !== undefined) {
        mappingSnapshot[target] = rule;
      }
    });

    if (preview) {
      setHistory((current) => [{
        id: `preview-${Date.now()}`,
        sourceType,
        originalFileName: file.name,
        storagePath: '',
        sheetName,
        rowCount: calculation.includedRows,
        totals: calculation.totals,
        appliedAt: new Date().toISOString(),
      }, ...current]);
      setNotice('Preview import applied. The monthly input and profitability summary were refreshed.');
      setConfirmed(false);
      onApplied?.();
      setApplying(false);
      return;
    }

    const runId = crypto.randomUUID();
    const storagePath = `${store.id}/${monthStart.slice(0, 7)}/${runId}/${safeFileName(file.name)}`;
    let uploaded = false;
    try {
      const hash = await sha256Hex(file);
      const { error: uploadError } = await supabase.storage
        .from(IMPORT_BUCKET)
        .upload(storagePath, file, {
          upsert: false,
          contentType: file.type || 'application/octet-stream',
          cacheControl: '3600',
        });
      if (uploadError) throw uploadError;
      uploaded = true;

      const { error: applyError } = await supabase.rpc('apply_profitability_import', {
        p_store_id: store.id,
        p_month_start: monthStart,
        p_source_type: sourceType,
        p_run_id: runId,
        p_original_file_name: file.name,
        p_storage_path: storagePath,
        p_file_sha256: hash,
        p_file_size: file.size,
        p_sheet_name: sheetName,
        p_header_row: headerRow,
        p_row_count: calculation.includedRows,
        p_mapping: mappingSnapshot,
        p_totals: calculation.totals,
      });
      if (applyError) throw applyError;

      setConfirmed(false);
      onApplied?.();
      await loadRecords();
      setNotice('Confirmed totals were applied. The original file and mapping were saved separately.');
    } catch (applyError: any) {
      if (uploaded) {
        await supabase.storage.from(IMPORT_BUCKET).remove([storagePath]);
      }
      setError(applyError?.message ?? 'Failed to apply the import.');
    } finally {
      setApplying(false);
    }
  };

  const downloadOriginal = async (run: ImportRun) => {
    if (preview || !run.storagePath) return;
    setDownloadingId(run.id);
    setError(null);
    try {
      const { data, error: signedUrlError } = await supabase.storage
        .from(IMPORT_BUCKET)
        .createSignedUrl(run.storagePath, 60);
      if (signedUrlError) throw signedUrlError;
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (downloadError: any) {
      setError(downloadError?.message ?? 'Failed to open the original file.');
    } finally {
      setDownloadingId(null);
    }
  };

  const previewRows = rows.slice(headerRow, headerRow + 5);

  return (
    <section className="rounded-2xl border border-gray-300 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-gray-500" />
            <h3 className="font-extrabold">
              {mode === 'owner' ? 'Optional: Import Monthly Totals from a File' : `${sectionNumber}. File Import`}
            </h3>
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-extrabold text-gray-600">
              {mode === 'owner' ? 'Advanced' : 'CSV / XLSX'}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {mode === 'owner'
              ? 'Skip this section when entering the monthly totals manually above.'
              : 'Review mapped columns, applied totals and retained original files.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mode === 'owner' ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-extrabold text-gray-700 hover:bg-gray-50"
            >
              {expanded ? 'Close File Import' : 'Open File Import'}
              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          ) : null}
          {(mode === 'hq' || expanded) ? (
            <button
              type="button"
              aria-label="Reload import history"
              onClick={() => void loadRecords()}
              disabled={loading || applying}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              title="Reload"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          ) : null}
        </div>
      </div>

      {mode === 'owner' && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-4 flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-left hover:border-gray-400 hover:bg-gray-100"
        >
          <span>
            <span className="block text-sm font-extrabold text-gray-900">Have a POS, attendance or payroll file?</span>
            <span className="mt-1 block text-xs text-gray-500">Open this only to replace manual typing with CSV/XLS/XLSX totals.</span>
          </span>
          <ChevronDown className="h-5 w-5 shrink-0 text-gray-400" />
        </button>
      ) : null}

      <div className={mode === 'owner' && !expanded ? 'hidden' : ''}>
      {mode === 'owner' ? (
        <div className="mt-5">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {SOURCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => changeSource(option.value)}
                disabled={!editable || applying}
                className={`rounded-xl border p-3 text-left transition ${
                  sourceType === option.value
                    ? 'border-gray-950 bg-gray-950 text-white'
                    : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
                } disabled:opacity-50`}
              >
                <div className="text-xs font-extrabold">{option.label}</div>
                <div className={`mt-1 text-[10px] ${
                  sourceType === option.value ? 'text-gray-300' : 'text-gray-500'
                }`}>
                  {option.description}
                </div>
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5 text-center">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              disabled={!editable || reading || applying}
              onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={!editable || reading || applying}
              className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-40"
            >
              <Upload className="h-4 w-4" />
              {reading ? 'Reading file…' : file ? 'Choose another file' : 'Choose CSV or Excel'}
            </button>
            <div className="mt-2 text-xs text-gray-500">
              {file ? `${file.name} · ${formatAmount(file.size / 1024, 1)} KB` : 'Maximum 10 MB · nothing is saved before confirmation'}
            </div>
          </div>

          {workbook && file ? (
            <>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="rounded-xl border border-gray-200 p-4 text-xs font-extrabold text-gray-700">
                  Worksheet
                  <select
                    value={sheetName}
                    onChange={(event) => changeSheet(event.target.value)}
                    disabled={applying}
                    className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold"
                  >
                    {workbook.SheetNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
                <label className="rounded-xl border border-gray-200 p-4 text-xs font-extrabold text-gray-700">
                  Header row
                  <input
                    type="number"
                    min="1"
                    max={Math.max(rows.length, 1)}
                    value={headerRow}
                    onChange={(event) => changeHeaderRow(Number(event.target.value || 1))}
                    disabled={applying}
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-right text-sm font-bold"
                  />
                </label>
              </div>

              <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
                <div className="bg-gray-50 px-4 py-3 text-sm font-extrabold">Column mapping</div>
                <div className="divide-y divide-gray-100">
                  {targets.map((target) => {
                    const rule = mapping[target] ?? { columnIndex: null, aggregation: 'sum' as AggregationMode };
                    const result = calculation.results[target];
                    return (
                      <div key={target} className="grid grid-cols-1 gap-3 px-4 py-4 lg:grid-cols-[1fr_1.4fr_0.8fr_1fr] lg:items-center">
                        <div>
                          <div className="text-sm font-extrabold text-gray-900">{TARGET_CONFIG[target].label}</div>
                          <div className="text-[10px] text-gray-400">{TARGET_CONFIG[target].unit}</div>
                        </div>
                        <select
                          aria-label={`${TARGET_CONFIG[target].label} column`}
                          value={rule.columnIndex ?? ''}
                          onChange={(event) => updateRule(target, {
                            columnIndex: event.target.value === '' ? null : Number(event.target.value),
                          })}
                          disabled={applying}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm"
                        >
                          <option value="">Do not import</option>
                          {headers.map((header) => (
                            <option key={header.index} value={header.index}>
                              {header.label} ({header.index + 1})
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label={`${TARGET_CONFIG[target].label} aggregation`}
                          value={rule.aggregation}
                          onChange={(event) => updateRule(target, {
                            aggregation: event.target.value as AggregationMode,
                          })}
                          disabled={applying || rule.columnIndex === null}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm disabled:bg-gray-50"
                        >
                          <option value="sum">Sum rows</option>
                          <option value="last">Last value</option>
                          <option value="max">Highest value</option>
                        </select>
                        <div className="text-right">
                          <div className="text-lg font-black text-gray-950">
                            {result
                              ? `${TARGET_CONFIG[target].unit === 'currency' ? `${store.currency} ` : ''}${formatAmount(result.total)}`
                              : '—'}
                          </div>
                          <div className="text-[10px] text-gray-400">
                            {result
                              ? `${result.numericCount} numeric · ${result.invalidCount} ignored`
                              : 'Map a numeric column'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <label className="mt-3 flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <input
                  type="checkbox"
                  checked={mapping.excludeTotalRows !== false}
                  onChange={(event) => {
                    setMapping((current) => ({ ...current, excludeTotalRows: event.target.checked }));
                    setConfirmed(false);
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                />
                <span>
                  <span className="block text-xs font-extrabold text-gray-800">Exclude rows labelled Total / Subtotal</span>
                  <span className="mt-1 block text-[10px] text-gray-500">
                    Prevents detail rows and a final total row from being counted twice. {calculation.excludedTotalRows} row(s) excluded.
                  </span>
                </span>
              </label>

              <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      {headers.slice(0, 8).map((header) => (
                        <th key={header.index} className="whitespace-nowrap px-3 py-2 font-extrabold">
                          {header.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {previewRows.map((row, rowIndex) => (
                      <tr key={`${headerRow}-${rowIndex}`}>
                        {headers.slice(0, 8).map((header) => (
                          <td key={header.index} className="max-w-48 truncate whitespace-nowrap px-3 py-2 text-gray-700">
                            {row[header.index] instanceof Date
                              ? (row[header.index] as Date).toISOString().slice(0, 10)
                              : String(row[header.index] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!calculationValid ? (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Map at least one column with numeric values. Negative totals and decimal guest counts cannot be applied.
                </div>
              ) : null}

              <div className="mt-4 flex flex-col gap-3 rounded-xl border border-gray-300 p-4 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    disabled={!calculationValid || applying}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300"
                  />
                  <span>
                    <span className="block text-xs font-extrabold text-gray-900">I checked the displayed monthly totals</span>
                    <span className="mt-1 block text-[10px] text-gray-500">
                      Applying updates only the mapped monthly fields. Unmapped manual values remain unchanged.
                    </span>
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => void applyImport()}
                  disabled={!editable || !confirmed || !calculationValid || applying}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-40"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {applying ? 'Applying…' : `Apply ${mappedTargets.length} total(s)`}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
          Stores map and confirm their files. HQ can review the applied totals and open the retained original file below.
        </div>
      )}

      <div className="mt-5 overflow-hidden rounded-xl border border-gray-200">
        <div className="flex items-center gap-2 bg-gray-50 px-4 py-3 text-sm font-extrabold">
          <History className="h-4 w-4" /> Applied files for this month
        </div>
        {history.length === 0 ? (
          <div className="p-5 text-center text-xs text-gray-500">No files have been applied to this month.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {history.map((run) => (
              <div key={run.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-extrabold text-white">
                      {sourceLabel(run.sourceType)}
                    </span>
                    <span className="truncate text-sm font-bold text-gray-900">{run.originalFileName}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-gray-500">
                    {run.rowCount} row(s) · {run.sheetName || 'CSV'} · {new Date(run.appliedAt).toLocaleString()}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(run.totals).map(([key, value]) => (
                      <span key={key} className="rounded-lg bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-700">
                        {TARGET_CONFIG[key as ImportTargetKey]?.label ?? key}: {formatAmount(Number(value))}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void downloadOriginal(run)}
                  disabled={preview || downloadingId === run.id}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold disabled:opacity-40"
                >
                  <Download className="h-3.5 w-3.5" />
                  {downloadingId === run.id ? 'Opening…' : 'Original file'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {lockedForOwner ? (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs font-bold text-blue-800">
          Reopen the submitted or approved month before applying a file.
        </div>
      ) : null}
      {notice ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{notice}</div> : null}
      {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}
      </div>
    </section>
  );
};

export default ProfitabilityImportPanel;
