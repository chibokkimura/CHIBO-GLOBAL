import * as XLSX from 'xlsx-js-style';

export type ImportSourceType = 'pos' | 'attendance' | 'payroll' | 'operating_expenses';
export type ImportTargetKey =
  | 'guest_count'
  | 'labor_cost'
  | 'labor_hours'
  | 'sales_linked_fees'
  | 'utilities_cost'
  | 'other_operating_cost';
export type AggregationMode = 'sum' | 'last' | 'max';
export type SheetCell = string | number | boolean | Date | null;

export type ColumnRule = {
  columnIndex: number | null;
  aggregation: AggregationMode;
};

export type ImportMapping = Partial<Record<ImportTargetKey, ColumnRule>> & {
  excludeTotalRows?: boolean;
};

export type TargetResult = {
  total: number;
  numericCount: number;
  invalidCount: number;
};

export type ImportCalculation = {
  totals: Partial<Record<ImportTargetKey, number>>;
  results: Partial<Record<ImportTargetKey, TargetResult>>;
  includedRows: number;
  excludedTotalRows: number;
};

export const SOURCE_OPTIONS: Array<{
  value: ImportSourceType;
  label: string;
  description: string;
}> = [
  { value: 'pos', label: 'POS', description: 'Guest count and sales-linked fees' },
  { value: 'attendance', label: 'Attendance', description: 'Total labor hours' },
  { value: 'payroll', label: 'Payroll', description: 'Total labor cost' },
  { value: 'operating_expenses', label: 'Operating Expenses', description: 'Fees, utilities and other costs' },
];

export const TARGET_CONFIG: Record<ImportTargetKey, {
  label: string;
  unit: 'count' | 'hours' | 'currency';
  keywords: string[];
}> = {
  guest_count: {
    label: 'Guest count',
    unit: 'count',
    keywords: ['guest', 'guests', 'covers', 'customers', '客数', '来客数', '顧客数', '고객수', '客人', '人數', '人数', 'khach'],
  },
  labor_cost: {
    label: 'Labor cost',
    unit: 'currency',
    keywords: ['payroll', 'salary', 'salaries', 'wage', 'wages', 'laborcost', 'labourcost', '人件費', '給与', '급여', '인건비', '薪資', '工资', '工資', 'luong'],
  },
  labor_hours: {
    label: 'Labor hours',
    unit: 'hours',
    keywords: ['laborhours', 'labourhours', 'workhours', 'totalhours', '勤務時間', '労働時間', '근무시간', '工时', '工時', 'giờ', 'gio'],
  },
  sales_linked_fees: {
    label: 'Sales-linked fees',
    unit: 'currency',
    keywords: ['commission', 'commissions', 'fee', 'fees', 'cardfee', 'deliveryfee', '手数料', '수수료', '佣金', '傭金', 'phí', 'phi'],
  },
  utilities_cost: {
    label: 'Utilities',
    unit: 'currency',
    keywords: ['utilities', 'electricity', 'electric', 'gas', 'water', '水道光熱', '光熱費', '공과금', '수도광열', '水电', '水電', 'điện', 'dien'],
  },
  other_operating_cost: {
    label: 'Other operating costs',
    unit: 'currency',
    keywords: ['othercost', 'operatingcost', 'supplies', 'cleaning', 'repairs', 'marketing', 'その他', '雑費', '기타', '운영비', '其他', 'khác', 'khac'],
  },
};

export const SOURCE_TARGETS: Record<ImportSourceType, ImportTargetKey[]> = {
  pos: ['guest_count', 'sales_linked_fees'],
  attendance: ['labor_hours'],
  payroll: ['labor_cost'],
  operating_expenses: ['sales_linked_fees', 'utilities_cost', 'other_operating_cost'],
};

const TOTAL_LABEL_PATTERN = /^(grandtotal|subtotal|total|合計|総計|小計|총계|합계|소계|总计|總計|小计|小計|tổngcộng|tongcong)$/i;

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_\-–—:：/\\()[\]{}.,，。]+/g, '');
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

export function parseLocalizedNumber(value: SheetCell): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  let text = value.normalize('NFKC').trim();
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text);
  text = text
    .replace(/[()]/g, '')
    .replace(/[^\d.,+\-]/g, '');
  if (!text || !/\d/.test(text)) return null;

  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimalSeparator = comma > dot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    text = text.split(thousandsSeparator).join('');
    if (decimalSeparator === ',') text = text.replace(',', '.');
  } else if (comma >= 0) {
    const commaParts = text.split(',');
    const looksLikeThousands = commaParts.length > 1
      && commaParts.slice(1).every((part) => part.length === 3);
    text = looksLikeThousands ? commaParts.join('') : text.replace(',', '.');
  } else if (dot >= 0) {
    const dotParts = text.split('.');
    if (dotParts.length > 2 && dotParts.slice(1).every((part) => part.length === 3)) {
      text = dotParts.join('');
    }
  }

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

export async function readSpreadsheet(file: File): Promise<XLSX.WorkBook> {
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    cellFormula: true,
    raw: true,
  });
}

export function getSheetRows(workbook: XLSX.WorkBook, sheetName: string): SheetCell[][] {
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) return [];
  return XLSX.utils.sheet_to_json<SheetCell[]>(worksheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: false,
  });
}

export function guessHeaderRow(rows: SheetCell[][], targets: ImportTargetKey[]): number {
  let bestIndex = 0;
  let bestScore = -1;
  rows.slice(0, 20).forEach((row, index) => {
    const nonBlank = row.filter((cell) => !isBlank(cell));
    const stringCells = nonBlank.filter((cell) => typeof cell === 'string');
    const keywordMatches = stringCells.reduce((sum, cell) => {
      const normalized = normalizeText(cell);
      return sum + targets.reduce(
        (targetSum, target) => targetSum + (TARGET_CONFIG[target].keywords.some(
          (keyword) => normalized.includes(normalizeText(keyword)),
        ) ? 1 : 0),
        0,
      );
    }, 0);
    const score = stringCells.length + keywordMatches * 5 - Math.max(0, nonBlank.length - stringCells.length);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex + 1;
}

export function buildHeaders(rows: SheetCell[][], headerRow: number): Array<{ index: number; label: string }> {
  const header = rows[headerRow - 1] ?? [];
  return header.map((cell, index) => ({
    index,
    label: isBlank(cell) ? `Column ${index + 1}` : String(cell),
  }));
}

export function guessMapping(
  headers: Array<{ index: number; label: string }>,
  targets: ImportTargetKey[],
): ImportMapping {
  const mapping: ImportMapping = { excludeTotalRows: true };
  targets.forEach((target) => {
    const match = headers.find((header) => {
      const normalized = normalizeText(header.label);
      return TARGET_CONFIG[target].keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
    });
    mapping[target] = {
      columnIndex: match?.index ?? null,
      aggregation: 'sum',
    };
  });
  return mapping;
}

function isTotalRow(row: SheetCell[]): boolean {
  return row.slice(0, 4).some((cell) => {
    if (typeof cell !== 'string') return false;
    return TOTAL_LABEL_PATTERN.test(normalizeText(cell));
  });
}

export function calculateImport(
  rows: SheetCell[][],
  headerRow: number,
  targets: ImportTargetKey[],
  mapping: ImportMapping,
): ImportCalculation {
  const values: Partial<Record<ImportTargetKey, number[]>> = {};
  const invalidCounts: Partial<Record<ImportTargetKey, number>> = {};
  targets.forEach((target) => {
    values[target] = [];
    invalidCounts[target] = 0;
  });

  let includedRows = 0;
  let excludedTotalRows = 0;
  rows.slice(headerRow).forEach((row) => {
    if (row.every(isBlank)) return;
    if (mapping.excludeTotalRows !== false && isTotalRow(row)) {
      excludedTotalRows += 1;
      return;
    }

    let rowIncluded = false;
    targets.forEach((target) => {
      const rule = mapping[target];
      if (!rule || rule.columnIndex === null) return;
      const raw = row[rule.columnIndex];
      if (isBlank(raw)) return;
      const numeric = parseLocalizedNumber(raw);
      if (numeric === null) {
        invalidCounts[target] = (invalidCounts[target] ?? 0) + 1;
        return;
      }
      values[target]?.push(numeric);
      rowIncluded = true;
    });
    if (rowIncluded) includedRows += 1;
  });

  const totals: ImportCalculation['totals'] = {};
  const results: ImportCalculation['results'] = {};
  targets.forEach((target) => {
    const rule = mapping[target];
    const targetValues = values[target] ?? [];
    if (!rule || rule.columnIndex === null || targetValues.length === 0) return;
    let total = 0;
    if (rule.aggregation === 'last') total = targetValues[targetValues.length - 1];
    else if (rule.aggregation === 'max') total = Math.max(...targetValues);
    else total = targetValues.reduce((sum, value) => sum + value, 0);
    total = Math.round(total * 100) / 100;
    totals[target] = total;
    results[target] = {
      total,
      numericCount: targetValues.length,
      invalidCount: invalidCounts[target] ?? 0,
    };
  });

  return { totals, results, includedRows, excludedTotalRows };
}

export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'import-file';
}
