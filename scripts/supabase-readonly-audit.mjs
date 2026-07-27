import fs from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTHORIZED_HQ_EMAIL = 'chibo.global.mgsystem@gmail.com';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const tableContracts = {
  app_users: 'user_id,email,name,role,store_id',
  stores: 'id,name,country,city,owner_email,currency,royalty_percentage',
  ingredients: 'id,name,unit',
  employees: 'id,store_id,name,position,age,image_url',
  menus: 'id,store_id,category,name,price,image_url',
  menu_recipe_items: 'menu_id,ingredient_id,quantity',
  set_menus: 'id,store_id,name,price',
  set_menu_items: 'set_menu_id,menu_id,quantity',
  sales: 'id,store_id,date,total_amount,receipt_image,is_closed,closed_reason,comment',
  sale_items: 'sale_id,menu_id,quantity',
  sale_set_items: 'sale_id,set_menu_id,quantity',
  store_ingredient_stock: 'store_id,ingredient_name,unit,par,reorder',
  global_config: 'id,config',
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function countAndValidateTable(table, columns) {
  const { count, error } = await supabase
    .from(table)
    .select(columns, { count: 'exact', head: true });
  if (error) throw new Error(`${table} contract failed: ${error.message}`);
  return Number(count ?? 0);
}

async function fetchAll(table, columns, pageSize = 1000) {
  const rows = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(start, start + pageSize - 1);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function findDuplicateSales(sales) {
  const seen = new Set();
  const duplicates = [];
  for (const sale of sales) {
    const key = `${sale.store_id}::${sale.date}`;
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  return duplicates;
}

function findOrphans(rows, foreignKey, validIds) {
  return rows.filter((row) => !validIds.has(row[foreignKey]));
}

async function loadBaseline(path) {
  if (!path) return null;
  return JSON.parse(await fs.readFile(path, 'utf8'));
}

function compareBaseline(current, baseline) {
  if (!baseline?.counts) return [];
  return Object.entries(baseline.counts)
    .filter(([table, previous]) =>
      Object.prototype.hasOwnProperty.call(current.counts, table)
      && current.counts[table] < Number(previous),
    )
    .map(([table, previous]) => ({
      table,
      baseline: Number(previous),
      current: current.counts[table],
    }));
}

async function run() {
  const counts = {};
  for (const [table, columns] of Object.entries(tableContracts)) {
    counts[table] = await countAndValidateTable(table, columns);
  }

  const [users, sales, saleItems, saleSetItems] = await Promise.all([
    fetchAll('app_users', 'user_id,email,role,store_id'),
    fetchAll('sales', 'id,store_id,date,total_amount,is_closed'),
    fetchAll('sale_items', 'sale_id,menu_id,quantity'),
    fetchAll('sale_set_items', 'sale_id,set_menu_id,quantity'),
  ]);

  const saleIds = new Set(sales.map((sale) => sale.id));
  const duplicateStoreDates = findDuplicateSales(sales);
  const orphanSaleItems = findOrphans(saleItems, 'sale_id', saleIds);
  const orphanSaleSetItems = findOrphans(saleSetItems, 'sale_id', saleIds);
  const hqRows = users.filter((user) => user.role === 'HQ');
  const unauthorizedHqRows = hqRows.filter(
    (user) => String(user.email ?? '').trim().toLowerCase() !== AUTHORIZED_HQ_EMAIL,
  );

  const result = {
    checkedAt: new Date().toISOString(),
    mode: 'read-only',
    counts,
    invariants: {
      duplicateStoreDates: duplicateStoreDates.length,
      orphanSaleItems: orphanSaleItems.length,
      orphanSaleSetItems: orphanSaleSetItems.length,
      unauthorizedHqAccounts: unauthorizedHqRows.length,
      hqAccountRows: hqRows.length,
    },
  };

  assert(duplicateStoreDates.length === 0, `Duplicate sales found: ${duplicateStoreDates.join(', ')}`);
  assert(orphanSaleItems.length === 0, `Orphan sale_items found: ${orphanSaleItems.length}`);
  assert(orphanSaleSetItems.length === 0, `Orphan sale_set_items found: ${orphanSaleSetItems.length}`);
  assert(unauthorizedHqRows.length === 0, 'Unauthorized HQ account row found');
  assert(hqRows.length === 1, `Expected exactly one HQ account row, found ${hqRows.length}`);

  const baselinePath = process.argv[2];
  const baseline = await loadBaseline(baselinePath);
  const decreasedCounts = compareBaseline(result, baseline);
  assert(
    decreasedCounts.length === 0,
    `Production row counts decreased: ${decreasedCounts
      .map((item) => `${item.table} ${item.baseline} -> ${item.current}`)
      .join(', ')}`,
  );

  console.log(JSON.stringify(result, null, 2));
  console.log('[readonly-audit] PASS: no database writes were performed');
}

run().catch((error) => {
  console.error('[readonly-audit] FAIL:', error?.message || error);
  process.exit(1);
});
