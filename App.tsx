import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { User, Store, Menu, Sale, Employee, UserRole, Ingredient, SaleItem, RecipeItem } from './types';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line, ComposedChart, Cell
} from 'recharts';
import { 
  LayoutDashboard, ClipboardList, Users, UtensilsCrossed, LogOut, 
  AlertTriangle, Plus, Trash2, ChevronRight, FileText, Camera, Save, ArrowLeft, BarChart3, Package, MapPin, CheckCircle2, XCircle, TrendingUp, TrendingDown, Minus, DollarSign, Clock, Image as ImageIcon, Layers, UploadCloud, Settings, X, Search, Info, Grid, Briefcase, User as UserIcon, AlertCircle, Mail, ArrowRight, UserPlus, AlertOctagon, ArrowUpRight, ArrowDownRight, CalendarX
} from 'lucide-react';
import { supabase } from './supabaseClient';
import { signInWithGoogle, signOut } from './auth';


// --- Supabase Data Layer ---
type AppUserRow = {
  user_id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'HQ';
  store_id: string | null;
};

type StoreIngredientStock = {
  storeId: string;
  ingredientName: string;
  unit: string;
  par: number;
  reorder: number;
};

type GlobalConfig = {
  storeNames: string[];
  countries: string[];
  cities: string[];
  currencies: string[];
  positions: string[];
  categories: string[];
  standardIngredients: { name: string; unit: string; par?: number; reorder?: number }[];
};

type GlobalConfigLoadState = 'loading' | 'loaded' | 'error';
type RefreshScope = 'stores' | 'ingredients' | 'employees' | 'menus' | 'sales' | 'storeStocks' | 'globalConfig';

type ScopeMutationCounter = Record<RefreshScope, number>;

function createInitialScopeMutationCounter(): ScopeMutationCounter {
  return {
    stores: 0,
    ingredients: 0,
    employees: 0,
    menus: 0,
    sales: 0,
    storeStocks: 0,
    globalConfig: 0,
  };
}

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  storeNames: ['CHIBO', 'CHIBO Express', 'CHIBO Premium'],
  countries: ['South Korea', 'Vietnam', 'Philippines', 'China', 'Taiwan', 'Others'],
  cities: ['Seoul', 'Hanoi', 'Manila', 'Ningbo', 'Kaohsiung', 'Daejeon', 'Unknown', 'Osaka', 'Tokyo'],
  currencies: ['JPY', 'USD', 'KRW', 'VND', 'THB'],
  positions: ['Manager', 'Chef', 'Server', 'Part-time'],
  categories: ['Okonomiyaki', 'Yakisoba', 'Teppan Dishes', 'Side Menu', 'Alcohol', 'Soft Drinks'],
  standardIngredients: [
    { name: 'Cabbage', unit: 'g', par: 0, reorder: 0 },
    { name: 'Pork Belly', unit: 'g', par: 0, reorder: 0 },
    { name: 'Okonomiyaki Flour', unit: 'g', par: 0, reorder: 0 },
    { name: 'Egg', unit: 'pcs', par: 0, reorder: 0 },
    { name: 'Otafuku Sauce', unit: 'ml', par: 0, reorder: 0 },
    { name: 'Noodles', unit: 'g', par: 0, reorder: 0 }
  ]
};

const SALES_LOOKBACK_DEFAULT_DAYS = 90;
const SALES_LOOKBACK_STEP_DAYS = 90;
const RECEIPT_BUCKET = 'receipts';
const RECEIPT_SIGNED_URL_TTL_SEC = 60 * 60 * 24;
const SALES_FALLBACK_POLL_MS = 60000;
const OWNER_VIEW_STORAGE_PREFIX = 'chibo:owner:view:';
const HQ_SELECTED_STORE_STORAGE_KEY = 'chibo:hq:selectedStoreId';
let salesClosedReasonColumnSupported: boolean | null = null;
const SALES_RECEIPT_IMAGE_RESIZE = { maxWidth: 1800, maxHeight: 1800, quality: 0.85 };
const MENU_IMAGE_RESIZE = { maxWidth: 1400, maxHeight: 1400, quality: 0.82 };
const STAFF_IMAGE_RESIZE = { maxWidth: 640, maxHeight: 640, quality: 0.82 };
const IMAGE_SIGNED_URL_CACHE_MS = 6 * 60 * 60 * 1000;
const LEGACY_MEDIA_MIGRATION_LIMIT = 80;
const signedImageUrlCache = new Map<string, { url: string; expiresAt: number }>();

function createLocalEntityId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

function isDataUrl(value: string): boolean {
  return value.startsWith('data:');
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isStoragePath(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !isDataUrl(trimmed) && !isHttpUrl(trimmed);
}

function normalizePersistedImageRef(imageUrl?: string | null, imagePath?: string | null): string | null {
  const url = String(imageUrl ?? '').trim();
  const path = String(imagePath ?? '').trim();
  if (isDataUrl(url)) return url;
  if (path && isStoragePath(path) && (!url || isHttpUrl(url) || url === path)) {
    return path;
  }
  if (!url) return null;
  return url;
}

async function resolveStoredImage(value?: string | null): Promise<{ displayUrl?: string; imagePath?: string }> {
  const raw = String(value ?? '').trim();
  if (!raw) return {};
  if (isDataUrl(raw) || isHttpUrl(raw)) return { displayUrl: raw };
  if (!isStoragePath(raw)) return {};

  const cached = signedImageUrlCache.get(raw);
  if (cached && cached.expiresAt > Date.now()) {
    return { displayUrl: cached.url, imagePath: raw };
  }

  try {
    const { data, error } = await supabase.storage
      .from(RECEIPT_BUCKET)
      .createSignedUrl(raw, RECEIPT_SIGNED_URL_TTL_SEC);
    if (!error && data?.signedUrl) {
      signedImageUrlCache.set(raw, { url: data.signedUrl, expiresAt: Date.now() + IMAGE_SIGNED_URL_CACHE_MS });
      return { displayUrl: data.signedUrl, imagePath: raw };
    }
    const { data: publicData } = supabase.storage.from(RECEIPT_BUCKET).getPublicUrl(raw);
    if (publicData?.publicUrl) {
      signedImageUrlCache.set(raw, { url: publicData.publicUrl, expiresAt: Date.now() + IMAGE_SIGNED_URL_CACHE_MS });
      return { displayUrl: publicData.publicUrl, imagePath: raw };
    }
  } catch (e) {
    console.error('Failed to resolve storage image', e);
  }

  return { imagePath: raw };
}

async function uploadStoreEntityImage(
  storeId: string,
  entityType: 'menu' | 'staff',
  entityId: string,
  dataUrl: string
): Promise<string> {
  const blob = await dataUrlToBlob(dataUrl);
  const path = `${storeId}/${entityType}/${entityId}.jpg`;
  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
  if (error) throw error;
  signedImageUrlCache.delete(path);
  return path;
}

async function deleteStorageObjectByPath(path?: string | null): Promise<void> {
  const raw = String(path ?? '').trim();
  if (!raw || !isStoragePath(raw)) return;
  const { error } = await supabase.storage.from(RECEIPT_BUCKET).remove([raw]);
  if (error) {
    console.warn('Failed to remove storage object', raw, error);
  }
  signedImageUrlCache.delete(raw);
}

const formatLookbackLabel = (days: number) => {
  if (days >= 365 && days % 365 === 0) {
    const years = Math.max(1, Math.round(days / 365));
    return `Last ${years} year${years > 1 ? 's' : ''}`;
  }
  return `Last ${days} days`;
};

function isMissingClosedReasonColumnError(error: unknown): boolean {
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as any).message)
    : '';
  return message.toLowerCase().includes("could not find the 'closed_reason' column");
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function getMyAppUser(): Promise<AppUserRow | null> {
  const { data: authData } = await supabase.auth.getUser();
  const uid = authData.user?.id;
  if (!uid) return null;

  const { data, error } = await supabase
    .from('app_users')
    .select('user_id,email,name,role,store_id')
    .eq('user_id', uid)
    .maybeSingle();

  if (error) throw error;
  return (data as any) ?? null;
}

async function upsertMyOwnerProfile(params: { name: string; email: string; storeId: string }) {
  const { data: authData } = await supabase.auth.getUser();
  const uid = authData.user?.id;
  if (!uid) throw new Error('No auth user');

  const { error } = await supabase.from('app_users').upsert({
    user_id: uid,
    email: params.email,
    name: params.name,
    role: 'OWNER',
    store_id: params.storeId,
  });

  if (error) throw error;
}

async function upsertMyHqProfile(params: { name: string; email: string }) {
  const { data: authData } = await supabase.auth.getUser();
  const uid = authData.user?.id;
  if (!uid) throw new Error('No auth user');

  const { error } = await supabase.from('app_users').upsert({
    user_id: uid,
    email: params.email,
    name: params.name,
    role: 'HQ',
    store_id: null,
  });

  if (error) throw error;
}

async function loadGlobalConfig(): Promise<{ config: GlobalConfig; exists: boolean | null }> {
  try {
    const { data, error } = await supabase
      .from('global_config')
      .select('config')
      .eq('id', 'global')
      .maybeSingle();
    if (error) throw error;
    if (!data?.config) {
      return { config: DEFAULT_GLOBAL_CONFIG, exists: false };
    }
    const cfg = data.config as Partial<GlobalConfig>;
    return {
      config: {
        ...DEFAULT_GLOBAL_CONFIG,
        ...cfg,
        standardIngredients: (cfg.standardIngredients ?? DEFAULT_GLOBAL_CONFIG.standardIngredients).map((ing: any) => ({
          name: ing.name,
          unit: ing.unit,
          par: typeof ing.par === 'number' ? ing.par : 0,
          reorder: typeof ing.reorder === 'number' ? ing.reorder : 0,
        })),
      },
      exists: true,
    };
  } catch (e) {
    console.warn('Failed to load global_config, falling back to defaults.', e);
    return { config: DEFAULT_GLOBAL_CONFIG, exists: null };
  }
}

async function saveGlobalConfig(config: GlobalConfig) {
  const { error } = await supabase
    .from('global_config')
    .upsert({ id: 'global', config });
  if (error) throw error;
}

async function loadStores(): Promise<Store[]> {
  const { data, error } = await supabase
    .from('stores')
    .select('id,name,country,city,owner_email,currency,royalty_percentage')
    .order('id');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    country: r.country,
    city: r.city,
    ownerEmail: r.owner_email,
    currency: r.currency,
    royaltyPercentage: Number(r.royalty_percentage),
  }));
}

async function loadIngredients(): Promise<Ingredient[]> {
  const { data, error } = await supabase.from('ingredients').select('id,name,unit').order('id');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, unit: r.unit }));
}

async function loadStoreIngredientStocks(): Promise<StoreIngredientStock[]> {
  const { data, error } = await supabase.from('store_ingredient_stock').select('*');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    storeId: r.store_id,
    ingredientName: r.ingredient_name,
    unit: r.unit,
    par: Number(r.par ?? 0),
    reorder: Number(r.reorder ?? 0),
  }));
}

async function saveStoreIngredientStocks(storeId: string, rows: { ingredientName: string; unit: string; par: number; reorder: number }[]) {
  const payload = rows.map(r => ({
    store_id: storeId,
    ingredient_name: r.ingredientName,
    unit: r.unit,
    par: r.par,
    reorder: r.reorder,
  }));
  const { error } = await supabase.from('store_ingredient_stock').upsert(payload, { onConflict: 'store_id,ingredient_name,unit' });
  if (error) throw error;
}

async function loadStoreAccounts(storeId: string): Promise<{ email: string; name: string; userId: string; storeId: string | null }[]> {
  const { data, error } = await supabase.rpc('list_store_accounts', { p_store_id: storeId });
  if (!error) {
    return (data ?? []).map((r: any) => ({
      email: r.email,
      name: r.name,
      userId: r.user_id,
      storeId: r.store_id ?? null
    }));
  }
  const { data: rows, error: selectError } = await supabase
    .from('app_users')
    .select('user_id,email,name,store_id')
    .eq('store_id', storeId);
  if (selectError) throw selectError;
  return (rows ?? []).map((r: any) => ({
    email: r.email,
    name: r.name,
    userId: r.user_id,
    storeId: r.store_id ?? null
  }));
}

async function linkAccountToStore(email: string, storeId: string) {
  const { error } = await supabase.rpc('link_account_to_store', { p_email: email, p_store_id: storeId });
  if (!error) return;
  const { data, error: selectErr } = await supabase
    .from('app_users')
    .select('user_id,role')
    .eq('email', email)
    .maybeSingle();
  if (selectErr) throw selectErr;
  if (!data) throw new Error('Account not found.');
  if (data.role === 'HQ') throw new Error('HQ accounts cannot be linked to a store.');
  const { error: upErr } = await supabase
    .from('app_users')
    .update({ store_id: storeId, role: 'OWNER' })
    .eq('user_id', data.user_id);
  if (upErr) throw upErr;
}

async function unlinkAccountFromStore(email: string, storeId: string) {
  const { error } = await supabase.rpc('unlink_account_from_store', { p_email: email, p_store_id: storeId });
  if (!error) return;
  const { error: upErr } = await supabase
    .from('app_users')
    .update({ store_id: null })
    .eq('email', email)
    .eq('store_id', storeId);
  if (upErr) throw upErr;
}

async function loadEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase.from('employees').select('id,store_id,name,position,age,image_url').order('id');
  if (error) throw error;
  const rows = data ?? [];
  return await Promise.all(rows.map(async (r: any) => {
    const resolved = await resolveStoredImage(r.image_url ?? undefined);
    return {
      id: r.id,
      storeId: r.store_id,
      name: r.name,
      position: r.position,
      age: r.age ?? undefined,
      imageUrl: resolved.displayUrl,
      imagePath: resolved.imagePath,
    };
  }));
}

async function loadMenus(): Promise<Menu[]> {
  const { data: menusData, error: menusErr } = await supabase
    .from('menus')
    .select('id,store_id,category,name,price,image_url')
    .order('id');
  if (menusErr) throw menusErr;

  const menuIds = (menusData ?? []).map((m: any) => m.id);
  let recipeData: any[] = [];
  if (menuIds.length > 0) {
    const { data, error: recipeErr } = await supabase
      .from('menu_recipe_items')
      .select('menu_id,ingredient_id,quantity')
      .in('menu_id', menuIds);
    if (recipeErr) throw recipeErr;
    recipeData = data ?? [];
  }

  const recipeByMenu: Record<string, RecipeItem[]> = {};
  (recipeData ?? []).forEach((r: any) => {
    const arr = recipeByMenu[r.menu_id] ?? [];
    arr.push({ ingredientId: r.ingredient_id, quantity: Number(r.quantity) });
    recipeByMenu[r.menu_id] = arr;
  });

  return await Promise.all((menusData ?? []).map(async (m: any) => {
    const resolved = await resolveStoredImage(m.image_url ?? undefined);
    return {
      id: m.id,
      storeId: m.store_id,
      category: m.category,
      name: m.name,
      price: Number(m.price),
      imageUrl: resolved.displayUrl,
      imagePath: resolved.imagePath,
      recipe: recipeByMenu[m.id] ?? [],
    };
  }));
}

async function loadSales(daysBack?: number): Promise<Sale[]> {
  const formatDateOnly = (d: Date) => d.toISOString().split('T')[0];
  const since = daysBack && daysBack > 0
    ? formatDateOnly(new Date(Date.now() - daysBack * 86400000))
    : null;

  const selectWithClosedReason = 'id,store_id,date,total_amount,is_closed,closed_reason';
  const selectWithoutClosedReason = 'id,store_id,date,total_amount,is_closed';

  const runSalesQuery = async (includeClosedReason: boolean) => {
    let query = supabase
      .from('sales')
      .select(includeClosedReason ? selectWithClosedReason : selectWithoutClosedReason)
      .order('date', { ascending: false });
    if (since) query = query.gte('date', since);
    return await query;
  };

  let salesData: any[] = [];
  const preferClosedReason = salesClosedReasonColumnSupported !== false;
  const first = await runSalesQuery(preferClosedReason);
  if (first.error) {
    if (preferClosedReason && isMissingClosedReasonColumnError(first.error)) {
      salesClosedReasonColumnSupported = false;
      const fallback = await runSalesQuery(false);
      if (fallback.error) throw fallback.error;
      salesData = fallback.data ?? [];
    } else {
      throw first.error;
    }
  } else {
    if (preferClosedReason) salesClosedReasonColumnSupported = true;
    salesData = first.data ?? [];
  }

  const saleIds = (salesData ?? []).map((s: any) => s.id);
  let receiptIds = new Set<string>();
  if (saleIds.length > 0) {
    const { data: receiptRows, error: receiptErr } = await supabase
      .from('sales')
      .select('id')
      .in('id', saleIds)
      .not('receipt_image', 'is', null)
      .neq('receipt_image', '');
    if (receiptErr) throw receiptErr;
    receiptIds = new Set((receiptRows ?? []).map((r: any) => r.id as string));
  }

  let itemData: any[] = [];
  if (saleIds.length > 0) {
    const { data, error: itemErr } = await supabase
      .from('sale_items')
      .select('sale_id,menu_id,quantity')
      .in('sale_id', saleIds);
    if (itemErr) throw itemErr;
    itemData = data ?? [];
  }

  const itemsBySale: Record<string, SaleItem[]> = {};
  itemData.forEach((r: any) => {
    const arr = itemsBySale[r.sale_id] ?? [];
    arr.push({ menuId: r.menu_id, quantity: Number(r.quantity) });
    itemsBySale[r.sale_id] = arr;
  });

  return (salesData ?? []).map((s: any) => ({
    id: s.id,
    storeId: s.store_id,
    date: s.date,
    totalAmount: Number(s.total_amount),
    items: itemsBySale[s.id] ?? [],
    hasReceipt: receiptIds.has(s.id),
    isClosed: Boolean(s.is_closed),
    closedReason: s.closed_reason ?? undefined,
  }));
}

async function loadReceiptImage(saleId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('sales')
    .select('receipt_image')
    .eq('id', saleId)
    .single();
  if (error) throw error;
  const value = data?.receipt_image ?? null;
  if (!value) return null;
  const resolved = await resolveStoredImage(value);
  return resolved.displayUrl ?? null;
}

async function saveMenu(menu: Menu) {
  const normalizedImageRef = normalizePersistedImageRef(menu.imageUrl, menu.imagePath);
  let persistedImageRef: string | null = normalizedImageRef;
  if (normalizedImageRef && isDataUrl(normalizedImageRef)) {
    persistedImageRef = await uploadStoreEntityImage(menu.storeId, 'menu', menu.id, normalizedImageRef);
  }

  const { error: mErr } = await supabase.from('menus').upsert({
    id: menu.id,
    store_id: menu.storeId,
    category: menu.category,
    name: menu.name,
    price: menu.price,
    image_url: persistedImageRef ?? null,
  });
  if (mErr) throw mErr;

  const mergedRecipe = new Map<string, number>();
  for (const row of menu.recipe ?? []) {
    if (!row.ingredientId) continue;
    const qty = Number(row.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    mergedRecipe.set(row.ingredientId, (mergedRecipe.get(row.ingredientId) ?? 0) + qty);
  }

  const nextRows = Array.from(mergedRecipe.entries()).map(([ingredientId, quantity]) => ({
    menu_id: menu.id,
    ingredient_id: ingredientId,
    quantity,
  }));

  if (nextRows.length > 0) {
    const { error: upsertRecipeErr } = await supabase
      .from('menu_recipe_items')
      .upsert(nextRows, { onConflict: 'menu_id,ingredient_id' });
    if (upsertRecipeErr) throw upsertRecipeErr;
  }

  if (nextRows.length === 0) {
    const { error: clearErr } = await supabase
      .from('menu_recipe_items')
      .delete()
      .eq('menu_id', menu.id);
    if (clearErr) throw clearErr;
    return;
  }

  const { data: currentRows, error: currentErr } = await supabase
    .from('menu_recipe_items')
    .select('ingredient_id')
    .eq('menu_id', menu.id);
  if (currentErr) throw currentErr;

  const keepSet = new Set(nextRows.map((r) => r.ingredient_id));
  const toDelete = (currentRows ?? [])
    .map((r: any) => String(r.ingredient_id))
    .filter((ingredientId) => !keepSet.has(ingredientId));

  if (toDelete.length > 0) {
    const { error: pruneErr } = await supabase
      .from('menu_recipe_items')
      .delete()
      .eq('menu_id', menu.id)
      .in('ingredient_id', toDelete);
    if (pruneErr) throw pruneErr;
  }
}

async function deleteMenu(menuId: string) {
  const { data: existing, error: existingErr } = await supabase
    .from('menus')
    .select('image_url')
    .eq('id', menuId)
    .maybeSingle();
  if (existingErr) throw existingErr;

  const { error } = await supabase.from('menus').delete().eq('id', menuId);
  if (error) throw error;

  await deleteStorageObjectByPath(existing?.image_url ?? null);
}

async function saveEmployees(storeId: string, emps: Employee[], removedIds: string[] = []) {
  const sourceRows = emps
    .map((e) => ({
      id: String(e.id ?? '').trim(),
      name: String(e.name ?? '').trim(),
      position: String(e.position ?? '').trim(),
      age: e.age ?? null,
      imageUrl: e.imageUrl ?? null,
      imagePath: e.imagePath ?? null,
    }))
    .filter((r) => r.id && r.name && r.position);

  const rows = await Promise.all(sourceRows.map(async (r) => {
    const normalizedImageRef = normalizePersistedImageRef(r.imageUrl, r.imagePath);
    let persistedImageRef: string | null = normalizedImageRef;
    if (normalizedImageRef && isDataUrl(normalizedImageRef)) {
      persistedImageRef = await uploadStoreEntityImage(storeId, 'staff', r.id, normalizedImageRef);
    }
    return {
      id: r.id,
      store_id: storeId,
      name: r.name,
      position: r.position,
      age: r.age,
      image_url: persistedImageRef ?? null,
    };
  }));

  if (rows.length > 0) {
    const { error: upsertErr } = await supabase.from('employees').upsert(rows, { onConflict: 'id' });
    if (upsertErr) throw upsertErr;
  }

  const keepIds = new Set(rows.map((r) => r.id));
  const deleteIds = Array.from(new Set(removedIds.map((id) => String(id ?? '').trim()).filter(Boolean)))
    .filter((id) => !keepIds.has(id));

  if (deleteIds.length > 0) {
    const { data: removedRows, error: removedRowsErr } = await supabase
      .from('employees')
      .select('id,image_url')
      .eq('store_id', storeId)
      .in('id', deleteIds);
    if (removedRowsErr) throw removedRowsErr;

    const { error: deleteErr } = await supabase
      .from('employees')
      .delete()
      .eq('store_id', storeId)
      .in('id', deleteIds);
    if (deleteErr) throw deleteErr;

    const imagePathsToDelete = (removedRows ?? [])
      .map((row: any) => String(row.image_url ?? '').trim())
      .filter((path) => path && isStoragePath(path));
    if (imagePathsToDelete.length > 0) {
      await Promise.all(imagePathsToDelete.map((path) => deleteStorageObjectByPath(path)));
    }
  }
}

async function addIngredient(ing: Ingredient) {
  const { error } = await supabase.from('ingredients').upsert({
    id: ing.id,
    name: ing.name,
    unit: ing.unit,
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}

async function uploadReceiptImage(storeId: string, saleId: string, dataUrl: string): Promise<string> {
  const blob = await dataUrlToBlob(dataUrl);
  const mime = blob.type || 'image/jpeg';
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const path = `${storeId}/${saleId}.${ext}`;
  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, blob, { upsert: true, contentType: mime, cacheControl: '3600' });
  if (error) throw error;
  return path;
}

async function addSale(sale: Sale) {
  let receiptPath: string | null = null;
  if (!sale.isClosed && !sale.receiptImage) {
    throw new Error('Receipt image is required for open days.');
  }
  if (sale.receiptImage && !sale.isClosed) {
    try {
      receiptPath = await uploadReceiptImage(sale.storeId, sale.id, sale.receiptImage);
    } catch (e) {
      console.error('Receipt upload failed', e);
      throw new Error('Failed to upload receipt image. Please retry.');
    }
  }
  const basePayload = {
    id: sale.id,
    store_id: sale.storeId,
    date: sale.date,
    total_amount: sale.totalAmount,
    receipt_image: receiptPath,
    is_closed: sale.isClosed ?? false,
  };
  const payloadWithClosedReason = {
    ...basePayload,
    closed_reason: sale.closedReason ?? null,
  };
  const preferClosedReason = salesClosedReasonColumnSupported !== false;
  const firstInsert = await supabase
    .from('sales')
    .insert(preferClosedReason ? payloadWithClosedReason : basePayload);

  let sErr = firstInsert.error ?? null;
  if (sErr && preferClosedReason && isMissingClosedReasonColumnError(sErr)) {
    salesClosedReasonColumnSupported = false;
    const fallbackInsert = await supabase.from('sales').insert(basePayload);
    sErr = fallbackInsert.error ?? null;
  } else if (!sErr && preferClosedReason) {
    salesClosedReasonColumnSupported = true;
  }

  if (sErr) {
    const message = sErr.message || 'Unknown insert error';
    throw new Error(`Failed to save sales report: ${message}`);
  }

  if (sale.items?.length) {
    const rows = sale.items.map(i => ({
      sale_id: sale.id,
      menu_id: i.menuId,
      quantity: i.quantity,
    }));
    const { error } = await supabase.from('sale_items').insert(rows);
    if (error) {
      const message = error.message || 'Unknown sale items error';
      throw new Error(`Failed to save sale items: ${message}`);
    }
  }
}




// --- Helper Functions ---
const formatDate = (date: Date) => date.toISOString().split('T')[0];

type ImageResizeOptions = {
  maxWidth: number;
  maxHeight: number;
  quality?: number;
  mimeType?: string;
  fallbackToOriginal?: boolean;
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

async function resizeImageToDataUrl(file: File, opts: ImageResizeOptions): Promise<string> {
  const { maxWidth, maxHeight, quality = 0.82, mimeType = 'image/jpeg', fallbackToOriginal = true } = opts;
  try {
    const original = await readFileAsDataUrl(file);
    const img = await loadImage(original);
    const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
    const width = Math.round(img.width * scale);
    const height = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL(mimeType, quality);
  } catch (e) {
    console.error('Image resize failed', e);
    if (fallbackToOriginal) {
      return readFileAsDataUrl(file);
    }
    throw new Error('Image resize failed.');
  }
}

const getMissingDates = (sales: Sale[], storeId: string, daysBack = 7) => {
  const dates: string[] = [];
  const today = new Date();
  // Check last 7 days (excluding today as it might not be over)
  for (let i = 1; i <= daysBack; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = formatDate(d);
    const hasReport = sales.some(s => s.storeId === storeId && s.date === dateStr);
    if (!hasReport) dates.push(dateStr);
  }
  return dates;
};

const ImageLightbox: React.FC<{
  src: string | null;
  alt: string;
  onClose: () => void;
}> = ({ src, alt, onClose }) => {
  useEffect(() => {
    if (!src) return;
    const prevOverflow = document.body.style.overflow;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div className="relative max-w-6xl max-h-full" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={alt} className="max-w-full max-h-[90vh] rounded-lg shadow-2xl object-contain" />
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-4 -right-4 bg-white text-black rounded-full p-2 hover:bg-gray-200 transition shadow-lg"
          aria-label="Close image preview"
        >
          <X className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};

// FX rates (currency per USD). Live rates fetched in app; fallback used if unavailable.
const FALLBACK_USD_RATES: Record<string, number> = {
  USD: 1,
  JPY: 150,
  KRW: 1320,
  VND: 24500,
  THB: 36,
  CNY: 7.2,
  PHP: 56,
  TWD: 31,
};

const FX_API_URL = (import.meta as any)?.env?.VITE_FX_API_URL || 'https://open.er-api.com/v6/latest/USD';
const FX_CACHE_KEY = 'chibo_fx_rates_usd_v1';
const FX_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

type FxRatesStatus = 'loading' | 'ok' | 'stale' | 'error';

const readFxCache = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(FX_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.rates || !parsed?.fetchedAt) return null;
    return parsed as { rates: Record<string, number>; fetchedAt: number };
  } catch {
    return null;
  }
};

const writeFxCache = (rates: Record<string, number>) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ rates, fetchedAt: Date.now() }));
  } catch {
    // ignore cache write errors
  }
};

const useFxRates = () => {
  const cached = readFxCache();
  const [rates, setRates] = useState<Record<string, number> | null>(cached?.rates ?? null);
  const [status, setStatus] = useState<FxRatesStatus>(cached ? 'stale' : 'loading');
  const [lastUpdated, setLastUpdated] = useState<number | null>(cached?.fetchedAt ?? null);

  useEffect(() => {
    let cancelled = false;

    const fetchRates = async () => {
      try {
        const res = await fetch(FX_API_URL);
        if (!res.ok) throw new Error('FX rates request failed');
        const data = await res.json();
        const nextRates = data?.rates || data?.conversion_rates;
        if (!nextRates || !nextRates.JPY) throw new Error('FX rates missing');
        if (cancelled) return;
        setRates(nextRates);
        setStatus('ok');
        setLastUpdated(Date.now());
        writeFxCache(nextRates);
      } catch (e) {
        if (cancelled) return;
        setStatus(cached ? 'stale' : 'error');
        // keep cached rates if any
      }
    };

    fetchRates();
    const intervalId = window.setInterval(fetchRates, 1000 * 60 * 60); // hourly refresh
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  return { rates, status, lastUpdated };
};

const convertToJPY = (amount: number, currency: string, rates: Record<string, number> | null) => {
  if (currency === 'JPY') return amount;
  const table = rates ?? FALLBACK_USD_RATES;
  const rateLocal = table[currency];
  const rateJPY = table['JPY'];
  if (!rateLocal || !rateJPY) return null;
  // rates are "currency per USD": local -> USD -> JPY
  return (amount / rateLocal) * rateJPY;
};

// --- Components ---

const SalesAnalyticsModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    sales: Sale[];
    stores: Store[];
    fxRates: Record<string, number> | null;
    fxStatus: FxRatesStatus;
}> = ({ isOpen, onClose, sales, stores, fxRates, fxStatus }) => {
    const [activeTab, setActiveTab] = useState<'period' | 'country' | 'store'>('period');

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [isOpen]);

    // Aggregate Data Logic
    const aggregatedData = useMemo(() => {
        const data: Record<string, number> = {};
        
        sales.forEach(sale => {
            const store = stores.find(s => s.id === sale.storeId);
            if (!store) return;

            // Normalize amount to JPY
            const amountJPY = convertToJPY(sale.totalAmount, store.currency, fxRates) ?? 0;

            let key = '';
            if (activeTab === 'period') {
                key = sale.date.substring(0, 7); // YYYY-MM
            } else if (activeTab === 'country') {
                key = store.country;
            } else if (activeTab === 'store') {
                key = store.name;
            }

            if (key) {
                data[key] = (data[key] || 0) + amountJPY;
            }
        });

        return Object.entries(data)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => activeTab === 'period' ? a.name.localeCompare(b.name) : b.value - a.value);
    }, [sales, stores, activeTab, fxRates]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b flex justify-between items-center bg-gray-50">
                    <div>
                        <h2 className="text-2xl font-bold flex items-center gap-2">
                            <BarChart3 className="w-6 h-6"/> Sales Analytics
                        </h2>
                        <p className="text-sm text-gray-500">
                            Detailed breakdown of network performance (Normalized to JPY{fxStatus === 'ok' ? '' : ' • Approx.'})
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition"><X className="w-6 h-6"/></button>
                </div>

                <div className="p-4 border-b bg-white">
                    <div className="flex gap-2">
                        <button 
                            onClick={() => setActiveTab('period')} 
                            className={`px-4 py-2 rounded-lg font-bold text-sm transition ${activeTab === 'period' ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
                            Monthly Trend
                        </button>
                        <button 
                            onClick={() => setActiveTab('country')} 
                            className={`px-4 py-2 rounded-lg font-bold text-sm transition ${activeTab === 'country' ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
                            By Country
                        </button>
                        <button 
                            onClick={() => setActiveTab('store')} 
                            className={`px-4 py-2 rounded-lg font-bold text-sm transition ${activeTab === 'store' ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
                            By Store
                        </button>
                    </div>
                </div>

                <div className="p-6 overflow-y-auto flex-1 bg-white">
                    {aggregatedData.length > 0 ? (
                        <>
                            <div className="h-80 w-full mb-8">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={aggregatedData} layout={activeTab === 'store' ? 'vertical' : 'horizontal'} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb"/>
                                        {activeTab === 'store' ? (
                                            <>
                                                <XAxis type="number" tick={{fontSize: 12}} hide />
                                                <YAxis dataKey="name" type="category" width={150} tick={{fontSize: 11, fontWeight: 'bold'}} />
                                            </>
                                        ) : (
                                            <>
                                                <XAxis dataKey="name" tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                                                <YAxis tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                                            </>
                                        )}
                                        <Tooltip 
                                            cursor={{fill: '#f3f4f6'}}
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                            formatter={(value: number) => [`JPY ${value.toLocaleString(undefined, {maximumFractionDigits: 0})}`, 'Revenue']}
                                        />
                                        <Bar dataKey="value" fill="#111827" radius={[0, 4, 4, 0]} barSize={activeTab === 'store' ? 20 : 40}>
                                            {aggregatedData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#111827' : '#374151'} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            <div className="overflow-hidden rounded-xl border border-gray-100">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-xs">
                                        <tr>
                                            <th className="p-4">{activeTab === 'period' ? 'Month' : activeTab === 'country' ? 'Country' : 'Store Name'}</th>
                                            <th className="p-4 text-right">Total Revenue (JPY Est.)</th>
                                            <th className="p-4 text-right">Contribution</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {aggregatedData.map((item, idx) => {
                                            const total = aggregatedData.reduce((acc, curr) => acc + curr.value, 0);
                                            const percent = total > 0 ? (item.value / total) * 100 : 0;
                                            return (
                                                <tr key={idx} className="hover:bg-gray-50">
                                                    <td className="p-4 font-medium">{item.name}</td>
                                                    <td className="p-4 text-right font-bold">JPY {item.value.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                                                    <td className="p-4 text-right text-gray-500">{percent.toFixed(1)}%</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                            <AlertTriangle className="w-12 h-12 mb-4 opacity-50" />
                            <p className="text-lg font-medium">No sales data available for this view.</p>
                        </div>
                    )}
                </div>
                
                <div className="p-4 border-t bg-gray-50 flex justify-end">
                    <button onClick={onClose} className="bg-white border border-gray-300 text-black font-bold py-2 px-6 rounded-xl hover:bg-gray-100 transition">
                        Close Analytics
                    </button>
                </div>
            </div>
        </div>
    );
};

const NavButton: React.FC<{ active: boolean; onClick: () => void; icon: any; label: string }> = ({ active, onClick, icon: Icon, label }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all w-full mb-1
      ${active ? 'bg-black text-white shadow-lg' : 'text-gray-500 hover:bg-gray-100 hover:text-black'}
    `}
  >
    <Icon className={`w-5 h-5 ${active ? 'text-white' : 'text-gray-400'}`} />
    <span className="font-bold text-sm hidden md:inline">{label}</span>
  </button>
);

const FinancialsTable: React.FC<{ stores: Store[]; sales: Sale[]; fxRates: Record<string, number> | null; fxStatus: FxRatesStatus }> = ({ stores, sales, fxRates, fxStatus }) => {
  const currentMonthKey = new Date().toISOString().slice(0, 7);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b flex justify-between items-center bg-gray-50">
            <h3 className="font-bold text-lg text-gray-800">Financial Performance</h3>
            <button className="text-xs font-bold bg-white border border-gray-200 px-3 py-1 rounded-lg hover:bg-gray-50 text-gray-600">Export CSV</button>
        </div>
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
                <thead className="bg-white text-gray-400 font-bold uppercase text-xs border-b">
                    <tr>
                        <th className="p-4 font-extrabold tracking-wider">Store</th>
                        <th className="p-4 text-right font-extrabold tracking-wider">Revenue (Local, This Month)</th>
                        <th className="p-4 text-right font-extrabold tracking-wider">Revenue (JPY Est.)</th>
                        <th className="p-4 text-right font-extrabold tracking-wider">Royalty (JPY Est.)</th>
                        <th className="p-4 text-center font-extrabold tracking-wider">Health</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                    {stores.map(store => {
                        const storeSales = sales.filter(s => s.storeId === store.id && s.date.slice(0, 7) === currentMonthKey);
                        const totalRevenue = storeSales.reduce((sum, s) => sum + s.totalAmount, 0);
                        const totalJPY = convertToJPY(totalRevenue, store.currency, fxRates);
                        const royaltyJPY = totalJPY !== null ? totalJPY * (store.royaltyPercentage / 100) : null;

                        return (
                            <tr key={store.id} className="hover:bg-gray-50 transition-colors">
                                <td className="p-4">
                                    <div className="font-bold text-gray-900">{store.name}</div>
                                    <div className="text-xs text-gray-500 font-medium">{store.city}, {store.country}</div>
                                </td>
                                <td className="p-4 text-right font-mono text-gray-600">
                                    {store.currency} {totalRevenue.toLocaleString()}
                                </td>
                                <td className="p-4 text-right font-mono text-gray-900 font-bold">
                                    {totalJPY === null ? '—' : `JPY ${totalJPY.toLocaleString(undefined, {maximumFractionDigits: 0})}`}
                                </td>
                                <td className="p-4 text-right font-mono text-indigo-600 font-bold">
                                    {royaltyJPY === null ? '—' : `JPY ${royaltyJPY.toLocaleString(undefined, {maximumFractionDigits: 0})}`}
                                </td>
                                <td className="p-4 text-center">
                                    <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-wide">Good</span>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
        <div className="px-6 py-3 text-[10px] text-gray-400 border-t bg-white">
            {fxStatus === 'ok' ? 'FX: Live rates' : 'FX: Approx. (cached or fallback)'}
        </div>
    </div>
  );
};

const SupplyChainIntelligence: React.FC<{ stores: Store[]; sales: Sale[]; menus: Menu[]; ingredients: Ingredient[] }> = ({ stores, sales, menus, ingredients }) => {
    return (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                <Package className="w-5 h-5"/> Supply Chain Intelligence
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-5 bg-orange-50 rounded-xl border border-orange-100 relative overflow-hidden">
                    <div className="relative z-10">
                        <div className="text-orange-800 font-bold text-xs uppercase tracking-wider mb-1">Top Ingredient</div>
                        <div className="text-2xl font-extrabold text-orange-900">Cabbage</div>
                        <div className="text-sm font-medium text-orange-700 mt-2">Est. 5,000kg / month</div>
                    </div>
                    <UtensilsCrossed className="absolute -right-4 -bottom-4 w-24 h-24 text-orange-200 opacity-50 rotate-12" />
                </div>
                 <div className="p-5 bg-blue-50 rounded-xl border border-blue-100 relative overflow-hidden">
                    <div className="relative z-10">
                        <div className="text-blue-800 font-bold text-xs uppercase tracking-wider mb-1">Top Menu Item</div>
                        <div className="text-2xl font-extrabold text-blue-900">Okonomiyaki</div>
                        <div className="text-sm font-medium text-blue-700 mt-2">Global Bestseller</div>
                    </div>
                     <TrendingUp className="absolute -right-4 -bottom-4 w-24 h-24 text-blue-200 opacity-50 rotate-12" />
                </div>
                 <div className="p-5 bg-purple-50 rounded-xl border border-purple-100 relative overflow-hidden">
                    <div className="relative z-10">
                        <div className="text-purple-800 font-bold text-xs uppercase tracking-wider mb-1">Cost Efficiency</div>
                        <div className="text-2xl font-extrabold text-purple-900">92%</div>
                        <div className="text-sm font-medium text-purple-700 mt-2">Network Average</div>
                    </div>
                     <DollarSign className="absolute -right-4 -bottom-4 w-24 h-24 text-purple-200 opacity-50 rotate-12" />
                </div>
            </div>
        </div>
    );
};

const SalesReporter: React.FC<{
  store: Store;
  sales: Sale[];
  menus: Menu[];
  categories: string[];
  initialDate: string | null;
  onSave: (sale: Sale) => Promise<void> | void;
  onCancel: () => void;
}> = ({ store, sales, menus, categories, initialDate, onSave, onCancel }) => {
  const [date, setDate] = useState(initialDate || formatDate(new Date()));
  const [items, setItems] = useState<SaleItem[]>([]); // Store category name in menuId
  const [isClosed, setIsClosed] = useState(false);
  const [receiptImage, setReceiptImage] = useState<string | null>(null);
  const [manualRevenue, setManualRevenue] = useState<string>('');
  const [comment, setComment] = useState<string>('');
  const [closedReason, setClosedReason] = useState<string>('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (initialDate) {
      setDate(initialDate);
    } else {
      setDate(formatDate(new Date()));
    }
    setItems([]);
    setIsClosed(false);
    setReceiptImage(null);
    setManualRevenue('');
    setComment('');
    setClosedReason('');
  }, [initialDate]);

  useEffect(() => {
    if (isClosed) {
      setReceiptImage(null);
      setManualRevenue('');
      setItems([]);
    }
  }, [isClosed]);

  const normalizeNumberInput = (value: string) => {
    const digits = value.replace(/[^\d]/g, '');
    if (digits === '') return '';
    return digits.replace(/^0+(?=\d)/, '');
  };

  const handleQuantityInput = (categoryName: string, val: string) => {
    const clean = normalizeNumberInput(val);
    const newQty = clean === '' ? 0 : parseInt(clean, 10);
    if (newQty < 0) return;

    
    setItems(prev => {
        const existing = prev.find(i => i.menuId === categoryName);
        if (existing) {
            if (newQty === 0) return prev.filter(i => i.menuId !== categoryName);
            return prev.map(i => i.menuId === categoryName ? { ...i, quantity: newQty } : i);
        } else {
            if (newQty > 0) return [...prev, { menuId: categoryName, quantity: newQty }];
            return prev;
        }
    });
  };

  const handleQuantityChange = (categoryName: string, delta: number) => {
    setItems(prev => {
      const existing = prev.find(i => i.menuId === categoryName);
      if (existing) {
        const newQty = Math.max(0, existing.quantity + delta);
        if (newQty === 0) return prev.filter(i => i.menuId !== categoryName);
        return prev.map(i => i.menuId === categoryName ? { ...i, quantity: newQty } : i);
      } else {
        if (delta > 0) return [...prev, { menuId: categoryName, quantity: delta }];
        return prev;
      }
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubmitError(null);
    try {
      const resized = await resizeImageToDataUrl(file, {
        ...SALES_RECEIPT_IMAGE_RESIZE,
        fallbackToOriginal: false,
      });
      setReceiptImage(resized);
    } catch (error) {
      console.error('Failed to process receipt image', error);
      setReceiptImage(null);
      setSubmitError('Failed to process image. Please upload another receipt photo.');
    }
    e.currentTarget.value = '';
  };

  const handleSave = async () => {
    if (!isClosed && !receiptImage) return;
    const reason = closedReason.trim();
    if (isClosed && !reason) return;
    const totalAmount = isClosed ? 0 : (parseFloat(manualRevenue) || 0);
    const newSale: Sale = {
      id: `SALE_${Date.now()}`,
      storeId: store.id,
      date,
      totalAmount,
      items: isClosed ? [] : items,
      isClosed,
      receiptImage: isClosed ? undefined : receiptImage || undefined,
      hasReceipt: !isClosed && Boolean(receiptImage),
      closedReason: isClosed ? reason : undefined,
    };
    setSubmitError(null);
    setSubmitting(true);
    try {
      await Promise.resolve(onSave(newSale));
    } catch (e) {
      console.error('Failed to submit sales report', e);
      const message = e instanceof Error ? e.message : 'Failed to submit report.';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = isClosed ? closedReason.trim().length > 0 : Boolean(receiptImage);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold">Daily Sales Report</h2>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">Report Date</label>
          <input 
            type="date" 
            value={date} 
            onChange={e => setDate(e.target.value)}
            className="w-full p-3 bg-gray-50 rounded-xl border-none font-medium"
          />
        </div>

        <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl">
            <input 
                type="checkbox" 
                id="isClosed" 
                checked={isClosed} 
                onChange={e => setIsClosed(e.target.checked)}
                className="w-5 h-5 rounded text-black focus:ring-black" 
            />
            <label htmlFor="isClosed" className="font-bold text-gray-700 select-none cursor-pointer">Store was closed (Rest Day)</label>
        </div>

        {isClosed && (
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Reason for closure</label>
              <textarea
                value={closedReason}
                onChange={e => setClosedReason(e.target.value)}
                placeholder="Reason for closure (e.g. maintenance)"
                rows={3}
                className="w-full p-4 bg-gray-50 rounded-xl border border-gray-200 focus:border-black outline-none resize-none"
              />
              {closedReason.trim() === '' && (
                <div className="mt-2 text-xs text-red-600">Reason is required to submit.</div>
              )}
            </div>
        )}

        {!isClosed && (
            <div>
              <div className="mb-8">
                <label className="block text-sm font-bold text-gray-700 mb-2">Total Daily Revenue ({store.currency})</label>
                <input 
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={manualRevenue} 
                  onChange={e => setManualRevenue(normalizeNumberInput(e.target.value))}
                  placeholder="Enter total sales amount"
                  className="w-full p-4 bg-gray-50 rounded-xl font-bold text-2xl border border-gray-200 focus:border-black outline-none"
                />
              </div>

              <div className="mb-8">
                <label className="block text-sm font-bold text-gray-700 mb-2">Comments (Optional)</label>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Add notes for this report (optional)"
                  rows={3}
                  className="w-full p-4 bg-gray-50 rounded-xl border border-gray-200 focus:border-black outline-none resize-none"
                />
              </div>

            <h3 className="font-bold text-lg mb-4">Sales Quantity by Category</h3>
            <div className="space-y-3">
                {categories.map(category => {
                const qty = items.find(i => i.menuId === category)?.quantity || 0;
                return (
                    <div key={category} className="flex items-center justify-between p-3 border rounded-xl hover:border-black transition group">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-500">
                                <Grid className="w-5 h-5" />
                            </div>
                            <div>
                                <div className="font-bold">{category}</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => handleQuantityChange(category, -1)} className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-full hover:bg-gray-200 font-bold">-</button>
                            <input 
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              className="w-16 p-2 text-center border border-gray-200 rounded-lg font-bold text-lg focus:ring-2 focus:ring-black outline-none"
                              value={String(qty)}
                              onChange={(e) => handleQuantityInput(category, e.target.value)}
                            />

                            <button onClick={() => handleQuantityChange(category, 1)} className="w-8 h-8 flex items-center justify-center bg-black text-white rounded-full hover:bg-gray-800 font-bold">+</button>
                        </div>
                    </div>
                );
                })}
            </div>
            
            </div>
        )}

        {!isClosed && (
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center">
              <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" id="receipt-upload" />
              <label htmlFor="receipt-upload" className="cursor-pointer flex flex-col items-center gap-2 hover:opacity-70 transition">
                  <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                      <Camera className="w-6 h-6 text-gray-500" />
                  </div>
                  <div>
                      <div className="text-sm font-bold text-gray-700">Upload Receipt / Daily Report</div>
                      <div className="text-xs text-gray-400">Click to browse (JPG, PNG)</div>
                  </div>
              </label>
              {receiptImage && (
                  <div className="mt-4 relative inline-block group">
                      <img src={receiptImage} alt="Receipt Preview" className="h-48 rounded-lg border shadow-sm object-contain bg-gray-50" />
                      <button onClick={() => setReceiptImage(null)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition"><X className="w-4 h-4" /></button>
                  </div>
              )}
          </div>
        )}

        <div className="flex gap-4 pt-4">
            <button onClick={onCancel} className="flex-1 py-3 font-bold text-gray-500 hover:bg-gray-50 rounded-xl">Cancel</button>
            <button
              onClick={handleSave}
              disabled={!canSubmit || submitting}
              className={`flex-1 py-3 bg-black text-white font-bold rounded-xl shadow-lg ${(canSubmit && !submitting) ? 'hover:bg-gray-800' : 'opacity-50 cursor-not-allowed'}`}
            >
              {submitting ? 'Submitting...' : 'Submit Report'}
            </button>
        </div>
        {submitError && (
          <div className="text-sm text-red-600 font-semibold">{submitError}</div>
        )}
      </div>
    </div>
  );
};

const MenuManager: React.FC<{
  store: Store;
  menus: Menu[];
  onEdit: (menu: Menu) => void;
  onCreate: (menu: Menu) => void;
  onDelete: (id: string) => void;
}> = ({ store, menus, onEdit, onCreate, onDelete }) => {
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Menu Management</h2>
        <button 
          onClick={() => onCreate({
            id: createLocalEntityId('M'),
            storeId: store.id,
            category: 'Main', // Default will be overwritten by editor
            name: 'New Item',
            price: 0,
            recipe: []
          })}
          className="flex items-center gap-2 bg-black text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-gray-800"
        >
          <Plus className="w-4 h-4" /> Add Item
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {menus.map(menu => (
          <div key={menu.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition group">
             <div className="aspect-video bg-gray-100 rounded-lg mb-4 overflow-hidden relative">
                {menu.imageUrl ? (
                    <button
                      type="button"
                      onClick={() => setPreviewImage({ src: menu.imageUrl!, alt: menu.name })}
                      className="w-full h-full cursor-zoom-in"
                      aria-label={`Preview image: ${menu.name}`}
                    >
                      <img src={menu.imageUrl} className="w-full h-full object-cover" alt={menu.name} />
                    </button>
                ) : (
                    <div className="flex items-center justify-center h-full text-gray-300"><ImageIcon className="w-8 h-8"/></div>
                )}
                <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => onEdit(menu)} className="p-2 bg-white rounded-full shadow-sm hover:bg-gray-100"><Settings className="w-4 h-4"/></button>
                    <button onClick={() => onDelete(menu.id)} className="p-2 bg-white text-red-500 rounded-full shadow-sm hover:bg-red-50"><Trash2 className="w-4 h-4"/></button>
                </div>
             </div>
             <div className="flex justify-between items-start">
                <div>
                    <h3 className="font-bold text-lg">{menu.name}</h3>
                    <span className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-600 font-medium">{menu.category}</span>
                </div>
                <div className="font-bold text-lg">{store.currency} {menu.price.toLocaleString()}</div>
             </div>
             <div className="mt-4 pt-4 border-t text-xs text-gray-500 flex items-center gap-1">
                 <Layers className="w-3 h-3"/> {menu.recipe.length} ingredients configured
             </div>
          </div>
        ))}
      </div>
      <ImageLightbox
        src={previewImage?.src ?? null}
        alt={previewImage?.alt ?? 'Menu image'}
        onClose={() => setPreviewImage(null)}
      />
    </div>
  );
};

const RecipeEditor: React.FC<{
    menu: Menu;
    ingredients: Ingredient[];
    categories: string[];
    standardIngredients: { name: string; unit: string; par?: number; reorder?: number }[];
    onAddIngredient: (ing: Ingredient) => Promise<void> | void;
    onSave: (menu: Menu) => Promise<void> | void;
    onBack: () => void;
}> = ({ menu, ingredients, categories, standardIngredients, onAddIngredient, onSave, onBack }) => {
    const [editedMenu, setEditedMenu] = useState(menu);
    const [newIngName, setNewIngName] = useState('');
    const [newIngUnit, setNewIngUnit] = useState('');
    const [newIngQty, setNewIngQty] = useState('');
    const [localIngredients, setLocalIngredients] = useState<Ingredient[]>(ingredients);
    const [recipeError, setRecipeError] = useState<string | null>(null);
    const [savingItem, setSavingItem] = useState(false);
    const [previewMenuImage, setPreviewMenuImage] = useState<string | null>(null);
    const imageInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        setLocalIngredients(prev => {
            if (prev.length === 0) return ingredients;
            const map = new Map(prev.map(i => [i.id, i]));
            ingredients.forEach(i => map.set(i.id, i));
            return Array.from(map.values());
        });
    }, [ingredients]);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setRecipeError(null);
        try {
            const resized = await resizeImageToDataUrl(file, { ...MENU_IMAGE_RESIZE, fallbackToOriginal: false });
            setEditedMenu({ ...editedMenu, imageUrl: resized, imagePath: undefined });
        } catch (error) {
            console.error('Failed to process menu image', error);
            setRecipeError('Failed to process menu image. Please upload another photo.');
        }
        e.currentTarget.value = '';
    };

    const hashString = (value: string) => {
        let hash = 0;
        for (let i = 0; i < value.length; i += 1) {
            hash = ((hash << 5) - hash) + value.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    };

    const makeIngredientId = (name: string, unit: string) => {
        const key = `${name.toLowerCase()}::${unit.toLowerCase()}`;
        return `I_${hashString(key)}`;
    };

    const handleAddIngredientToRecipe = async () => {
        const name = newIngName.trim();
        const unit = newIngUnit.trim();
        if (!name || !unit || !newIngQty) return;
        const qty = parseFloat(newIngQty);
        if (qty <= 0) return;
        setRecipeError(null);

        const ingredientPool = [...localIngredients, ...ingredients];
        // Check if ingredient exists globally (by name and unit)
        let existingIng = ingredientPool.find(
            i => i.name.toLowerCase() === name.toLowerCase() && i.unit.toLowerCase() === unit.toLowerCase()
        );

        let ingredientId = existingIng?.id;

        if (!ingredientId) {
            // Create new ingredient globally
            const newIngredient: Ingredient = {
                id: makeIngredientId(name, unit),
                name,
                unit
            };
            try {
                await onAddIngredient(newIngredient);
                setLocalIngredients(prev => [...prev, newIngredient]);
            } catch (e) {
                console.error('Failed to add ingredient', e);
                const message = e instanceof Error ? e.message : 'Failed to add ingredient.';
                setRecipeError(`Failed to add ingredient: ${message}`);
                return;
            }
            ingredientId = newIngredient.id;
        }

        // Add to recipe
        const newRecipe = [...editedMenu.recipe];
        const existingIdx = newRecipe.findIndex(r => r.ingredientId === ingredientId);
        if (existingIdx >= 0) {
            newRecipe[existingIdx].quantity += qty;
        } else {
            newRecipe.push({ ingredientId, quantity: qty });
        }

        setEditedMenu({ ...editedMenu, recipe: newRecipe });
        setNewIngName('');
        setNewIngUnit('');
        setNewIngQty('');
    };

    const updateRecipeQuantity = (ingId: string, qty: number) => {
        if (!Number.isFinite(qty)) return;
        const newRecipe = editedMenu.recipe.map(r => {
            if (r.ingredientId === ingId) return { ...r, quantity: qty };
            return r;
        });
        setEditedMenu({ ...editedMenu, recipe: newRecipe });
    };

    const removeIngredient = (ingId: string) => {
        setEditedMenu({
            ...editedMenu,
            recipe: editedMenu.recipe.filter(r => r.ingredientId !== ingId)
        });
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b flex justify-between items-center bg-gray-50">
                    <h2 className="text-2xl font-bold">Edit Item: {menu.name}</h2>
                    <button onClick={onBack} className="p-2 hover:bg-gray-200 rounded-full transition"><X className="w-6 h-6"/></button>
                </div>
            
                <div className="p-6 overflow-y-auto space-y-6">
                    {/* Image Upload */}
                    <div className="mb-6">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Item Image</label>
                        <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center relative bg-gray-50 hover:bg-gray-100 transition group">
                            <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                            {editedMenu.imageUrl ? (
                                <div className="relative h-64 w-full">
                                    <button
                                        type="button"
                                        onClick={() => setPreviewMenuImage(editedMenu.imageUrl ?? null)}
                                        className="h-full w-full cursor-zoom-in"
                                        aria-label="Preview menu image"
                                    >
                                        <img src={editedMenu.imageUrl} alt="Menu Preview" className="h-full w-full object-contain rounded-lg" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => imageInputRef.current?.click()}
                                        className="absolute top-3 right-3 px-3 py-1.5 rounded-lg bg-black/80 text-white text-xs font-bold hover:bg-black"
                                    >
                                        Change Image
                                    </button>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => imageInputRef.current?.click()}
                                    className="w-full flex flex-col items-center py-8"
                                >
                                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mb-3">
                                        <Camera className="w-6 h-6 text-gray-400" />
                                    </div>
                                    <span className="text-sm font-bold text-gray-600">Upload Menu Photo</span>
                                    <span className="text-xs text-gray-400 mt-1">Supports JPG, PNG</span>
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Name</label>
                            <input value={editedMenu.name} onChange={e => setEditedMenu({...editedMenu, name: e.target.value})} className="w-full p-3 bg-gray-50 rounded-xl font-bold border border-gray-200 focus:border-black outline-none" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Category</label>
                            <select 
                                value={editedMenu.category} 
                                onChange={e => setEditedMenu({...editedMenu, category: e.target.value})} 
                                className="w-full p-3 bg-gray-50 rounded-xl font-bold border border-gray-200 focus:border-black outline-none appearance-none"
                            >
                                <option value="">Select Category</option>
                                {categories.map(c => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                        </div>
                        <div className="col-span-2">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Price</label>
                            <input 
                                type="number" 
                                value={editedMenu.price.toString()} 
                                onChange={e => {
                                    const val = e.target.value;
                                    setEditedMenu({...editedMenu, price: val === '' ? 0 : parseFloat(val)})
                                }}
                                onFocus={e => e.target.select()}
                                className="w-full p-3 bg-gray-50 rounded-xl font-bold border border-gray-200 focus:border-black outline-none" 
                            />
                        </div>
                    </div>

                    <div className="pt-6 border-t">
                        <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                            <UtensilsCrossed className="w-5 h-5"/> Recipe Configuration
                        </h3>
                        
                        {/* Add Ingredient Form */}
                        <div className="bg-gray-50 p-4 rounded-xl mb-4 border border-gray-200">
                            <div className="text-xs font-bold text-gray-500 uppercase mb-2">Add New Ingredient</div>
                            
                            {/* Standard Ingredient Selection */}
                            <div className="mb-3">
                                <select 
                                    className="w-full p-2 rounded-lg border border-gray-300 text-sm bg-white focus:border-black outline-none"
                                    onChange={(e) => {
                                        if (!e.target.value) return;
                                        const [name, unit] = e.target.value.split('::');
                                        setNewIngName(name);
                                        setNewIngUnit(unit);
                                    }}
                                    defaultValue=""
                                >
                                    <option value="" disabled>Select Standard Ingredient (Optional)</option>
                                    {standardIngredients.map(i => (
                                        <option key={i.name} value={`${i.name}::${i.unit}`}>{i.name} ({i.unit})</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex gap-2">
                                <input 
                                    placeholder="Ingredient Name (e.g. Flour)" 
                                    className="flex-[2] p-2 rounded-lg border border-gray-300 text-sm"
                                    value={newIngName}
                                    onChange={e => setNewIngName(e.target.value)}
                                />
                                <input 
                                    placeholder="Qty" 
                                    type="number"
                                    className="flex-1 p-2 rounded-lg border border-gray-300 text-sm"
                                    value={newIngQty}
                                    onChange={e => setNewIngQty(e.target.value)}
                                />
                                <input 
                                    placeholder="Unit (g, ml)" 
                                    className="flex-1 p-2 rounded-lg border border-gray-300 text-sm"
                                    value={newIngUnit}
                                    onChange={e => setNewIngUnit(e.target.value)}
                                />
                                <button 
                                    onClick={handleAddIngredientToRecipe}
                                    className="bg-black text-white px-4 rounded-lg font-bold text-sm hover:bg-gray-800 disabled:opacity-50"
                                    disabled={!newIngName || !newIngQty || !newIngUnit}
                                >
                                    <Plus className="w-4 h-4"/>
                                </button>
                            </div>
                            <p className="text-[10px] text-gray-400 mt-2">
                                * Standard ingredients can be selected from the dropdown, and custom ingredients can be added/removed freely.
                            </p>
                        </div>

                        <div className="space-y-2">
                            {editedMenu.recipe.map(item => {
                                const ing = localIngredients.find(i => i.id === item.ingredientId);
                                const ingName = ing ? ing.name : 'Unknown Ingredient';
                                const ingUnit = ing ? ing.unit : '';

                                return (
                                    <div key={item.ingredientId} className="flex justify-between items-center p-3 bg-white border border-gray-100 rounded-xl shadow-sm hover:border-black transition group">
                                        <span className="font-bold text-gray-700">{ingName}</span>
                                        <div className="flex items-center gap-2">
                                            <input 
                                                type="number" 
                                                value={item.quantity} 
                                                onChange={e => updateRecipeQuantity(item.ingredientId, Number(e.target.value))}
                                                className="w-24 p-2 text-right bg-gray-50 rounded-lg border border-transparent focus:bg-white focus:border-black outline-none font-medium" 
                                            />
                                            <span className="text-xs text-gray-500 w-8 font-medium">{ingUnit}</span>
                                            <button onClick={() => removeIngredient(item.ingredientId)} className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition">
                                                <Trash2 className="w-4 h-4"/>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                            {editedMenu.recipe.length === 0 && (
                                <div className="text-center py-8 text-gray-400 text-sm italic">No ingredients configured for this item.</div>
                            )}
                            {recipeError && (
                                <div className="text-sm text-red-600 font-semibold">{recipeError}</div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
                    <button onClick={onBack} className="px-6 py-3 font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition">Cancel</button>
                    <button
                        onClick={async () => {
                            if (savingItem) return;
                            const missing = editedMenu.recipe.filter(r => !localIngredients.find(i => i.id === r.ingredientId));
                            if (missing.length > 0) {
                                setRecipeError('Some ingredients are missing. Remove and re-add them.');
                                return;
                            }
                            const invalidQty = editedMenu.recipe.find(r => !Number.isFinite(r.quantity) || r.quantity <= 0);
                            if (invalidQty) {
                                setRecipeError('Quantity must be greater than 0. Use the trash icon to remove an ingredient.');
                                return;
                            }
                            setRecipeError(null);
                            setSavingItem(true);
                            try {
                                await Promise.resolve(onSave(editedMenu));
                            } catch (e) {
                                console.error('Failed to save menu item', e);
                                const message = e instanceof Error ? e.message : 'Failed to save item.';
                                setRecipeError(`Failed to save item: ${message}`);
                            } finally {
                                setSavingItem(false);
                            }
                        }}
                        disabled={savingItem}
                        className="bg-black text-white px-8 py-3 rounded-xl font-bold hover:bg-gray-800 shadow-lg flex items-center gap-2 disabled:opacity-60"
                    >
                        <Save className="w-4 h-4" /> {savingItem ? 'Saving...' : 'Save Item'}
                    </button>
                </div>
            </div>
            <ImageLightbox
                src={previewMenuImage}
                alt={`${editedMenu.name || 'Menu'} image`}
                onClose={() => setPreviewMenuImage(null)}
            />
        </div>
    );
};

const StaffEditor: React.FC<{
    employee: Employee;
    positions: string[];
    onSave: (emp: Employee) => void;
    onBack: () => void;
}> = ({ employee, positions, onSave, onBack }) => {
    const [editedEmp, setEditedEmp] = useState(employee);
    const [imageError, setImageError] = useState<string | null>(null);
    
    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImageError(null);
        try {
            const resized = await resizeImageToDataUrl(file, { ...STAFF_IMAGE_RESIZE, fallbackToOriginal: false });
            setEditedEmp({ ...editedEmp, imageUrl: resized, imagePath: undefined });
        } catch (error) {
            console.error('Failed to process staff image', error);
            setImageError('Failed to process image. Please upload another photo.');
        }
        e.currentTarget.value = '';
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
             <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b flex justify-between items-center bg-gray-50">
                    <h2 className="text-2xl font-bold">Staff Details</h2>
                    <button onClick={onBack} className="p-2 hover:bg-gray-200 rounded-full transition"><X className="w-6 h-6"/></button>
                </div>
                <div className="p-6 space-y-6">
                    {/* Image Upload */}
                    <div className="flex justify-center">
                        <div className="relative group cursor-pointer">
                            <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                            <div className="w-32 h-32 rounded-full bg-gray-100 border-4 border-white shadow-lg overflow-hidden flex items-center justify-center">
                                {editedEmp.imageUrl ? (
                                    <img src={editedEmp.imageUrl} alt="Staff" className="w-full h-full object-cover" />
                                ) : (
                                    <UserIcon className="w-12 h-12 text-gray-300" />
                                )}
                            </div>
                            <div className="absolute bottom-0 right-0 bg-black text-white p-2 rounded-full shadow-md z-20 pointer-events-none">
                                <Camera className="w-4 h-4" />
                            </div>
                        </div>
                    </div>
                    {imageError && <div className="text-sm text-red-600 font-semibold text-center">{imageError}</div>}

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Full Name</label>
                        <input 
                            value={editedEmp.name} 
                            onChange={e => setEditedEmp({...editedEmp, name: e.target.value})} 
                            className="w-full p-3 bg-gray-50 rounded-xl font-bold border border-gray-200 focus:border-black outline-none" 
                            placeholder="e.g. John Doe"
                        />
                    </div>

                    <div>
                         <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Position</label>
                         <select 
                            value={editedEmp.position} 
                            onChange={e => setEditedEmp({...editedEmp, position: e.target.value})} 
                            className="w-full p-3 bg-gray-50 rounded-xl font-bold border border-gray-200 focus:border-black outline-none"
                         >
                            <option value="">Select Position</option>
                            {positions.map(p => (
                                <option key={p} value={p}>{p}</option>
                            ))}
                         </select>
                    </div>
                </div>
                <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
                    <button onClick={onBack} className="px-6 py-3 font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition">Cancel</button>
                    <button 
                        onClick={() => onSave(editedEmp)} 
                        disabled={!editedEmp.name || !editedEmp.position}
                        className="bg-black text-white px-8 py-3 rounded-xl font-bold hover:bg-gray-800 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Save Staff
                    </button>
                </div>
             </div>
        </div>
    );
};

const EmployeeManager: React.FC<{
  store: Store;
  employees: Employee[];
  positions: string[];
  onUpdate: (employees: Employee[]) => void;
}> = ({ store, employees, positions, onUpdate }) => {
    const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
    const [empError, setEmpError] = useState<string | null>(null);
    const [empSaving, setEmpSaving] = useState(false);
    const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);

    const handleSave = async (emp: Employee) => {
        setEmpSaving(true);
        setEmpError(null);
        try {
            const exists = employees.find(e => e.id === emp.id);
            const next = exists
                ? employees.map(e => e.id === emp.id ? emp : e)
                : [...employees, emp];
            await Promise.resolve(onUpdate(next));
            setEditingEmp(null);
        } catch (e) {
            console.error('Failed to save staff', e);
            const message = e instanceof Error ? e.message : 'Please try again.';
            setEmpError(`Failed to save staff: ${message}`);
        } finally {
            setEmpSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if(confirm('Are you sure you want to remove this staff member?')) {
            setEmpSaving(true);
            setEmpError(null);
            try {
                await Promise.resolve(onUpdate(employees.filter(e => e.id !== id)));
            } catch (e) {
                console.error('Failed to delete staff', e);
                const message = e instanceof Error ? e.message : 'Please try again.';
                setEmpError(`Failed to delete staff: ${message}`);
            } finally {
                setEmpSaving(false);
            }
        }
    };

    return (
        <div>
            {editingEmp && (
                <StaffEditor 
                    employee={editingEmp}
                    positions={positions}
                    onSave={handleSave}
                    onBack={() => setEditingEmp(null)}
                />
            )}
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Staff Management</h2>
                <button 
                    onClick={() => setEditingEmp({
                        id: createLocalEntityId('E'),
                        storeId: store.id,
                        name: '',
                        position: positions[0] || '',
                        imageUrl: ''
                    })}
                    className="flex items-center gap-2 bg-black text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-gray-800"
                >
                    <Plus className="w-4 h-4" /> Add Staff
                </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {employees.map(emp => (
                    <div key={emp.id} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between group">
                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 bg-gray-200 rounded-full overflow-hidden">
                                {emp.imageUrl ? (
                                    <button
                                        type="button"
                                        onClick={() => setPreviewImage({ src: emp.imageUrl!, alt: `${emp.name} profile photo` })}
                                        className="w-full h-full cursor-zoom-in"
                                        aria-label={`Preview photo: ${emp.name}`}
                                    >
                                        <img src={emp.imageUrl} className="w-full h-full object-cover" alt={`${emp.name} profile`} />
                                    </button>
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gray-100 text-gray-400">
                                        <UserIcon className="w-8 h-8" />
                                    </div>
                                )}
                            </div>
                            <div>
                                <div className="font-bold text-lg">{emp.name}</div>
                                <div className="text-sm text-gray-500 flex items-center gap-1">
                                    <Briefcase className="w-3 h-3"/> {emp.position}
                                </div>
                            </div>
                        </div>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                             <button onClick={() => setEditingEmp(emp)} className="p-2 hover:bg-gray-100 rounded-full text-gray-500"><Settings className="w-4 h-4"/></button>
                             <button onClick={() => handleDelete(emp.id)} className="p-2 hover:bg-red-50 rounded-full text-red-500"><Trash2 className="w-4 h-4"/></button>
                        </div>
                    </div>
                ))}
            </div>
            {empError && <div className="mt-3 text-sm text-red-600">{empError}</div>}
            <ImageLightbox
                src={previewImage?.src ?? null}
                alt={previewImage?.alt ?? 'Staff image'}
                onClose={() => setPreviewImage(null)}
            />
        </div>
    );
};

const HQStoreDetail: React.FC<{
    store: Store;
    sales: Sale[];
    menus: Menu[];
    employees: Employee[];
    ingredients: Ingredient[];
    storeStocks: StoreIngredientStock[];
    allStores: Store[];
    categories: string[];
    standardIngredients: { name: string; unit: string; par?: number; reorder?: number }[];
    currencies: string[];
    positions: string[];
    salesLookbackLabel: string;
    onLoadMoreSales: () => void;
    onBack: () => void;
    onUpdateStore: (store: Store) => void;
    onSaveStoreStocks: (storeId: string, rows: { ingredientName: string; unit: string; par: number; reorder: number }[]) => void;
    onMergeStores: (sourceId: string, targetId: string) => Promise<void>;
    onDeleteStore: (storeId: string) => Promise<void>;
    onUpdateMenu: (menu: Menu) => void;
    onCreateMenu: (menu: Menu) => void;
    onDeleteMenu: (id: string) => void;
    onUpdateEmployees: (storeId: string, employees: Employee[]) => void;
    onAddIngredient: (ing: Ingredient) => Promise<void> | void;
}> = ({ store, sales, menus, employees, ingredients, storeStocks, allStores, categories, standardIngredients, currencies, positions, salesLookbackLabel, onLoadMoreSales, onBack, onUpdateStore, onSaveStoreStocks, onMergeStores, onDeleteStore, onUpdateMenu, onCreateMenu, onDeleteMenu, onUpdateEmployees, onAddIngredient }) => {
    const storeMenus = menus.filter(m => m.storeId === store.id);
    const storeEmployees = employees.filter(e => e.storeId === store.id);
    const storeSales = useMemo(() => sales.filter(s => s.storeId === store.id), [sales, store.id]);
    const sortedStoreSales = useMemo(
        () => [...storeSales].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        [storeSales]
    );
    const [editingMenu, setEditingMenu] = useState<Menu | null>(null);
    const [viewingReceipt, setViewingReceipt] = useState<string | null>(null);
    const receiptCacheRef = useRef<Record<string, string>>({});
    const [receiptLoadingId, setReceiptLoadingId] = useState<string | null>(null);
    const [receiptError, setReceiptError] = useState<string | null>(null);
    const missingDates = useMemo(() => getMissingDates(sales, store.id), [sales, store.id]);
    const missingDatesAll = useMemo(() => getMissingDates(sales, store.id, 120), [sales, store.id]);
    const missingDateSet = useMemo(() => new Set(missingDatesAll), [missingDatesAll]);
    const submittedDateSet = useMemo(() => new Set(storeSales.map(s => s.date)), [storeSales]);
    const [showMissingCalendar, setShowMissingCalendar] = useState(false);
    const [calendarMonth, setCalendarMonth] = useState(() => {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), 1);
    });
    const [royaltyDraft, setRoyaltyDraft] = useState<string>(String(store.royaltyPercentage ?? 0));
    const [royaltySaving, setRoyaltySaving] = useState(false);
    const [royaltyError, setRoyaltyError] = useState<string | null>(null);
    const [currencyDraft, setCurrencyDraft] = useState<string>(store.currency || '');
    const [currencySaving, setCurrencySaving] = useState(false);
    const [currencyError, setCurrencyError] = useState<string | null>(null);
    const [emailInfo, setEmailInfo] = useState<string | null>(null);
    const [expandedSales, setExpandedSales] = useState<Set<string>>(new Set());
    const [showStockEditor, setShowStockEditor] = useState(false);
    const [stockDrafts, setStockDrafts] = useState<{ ingredientName: string; unit: string; par: number; reorder: number }[]>([]);
    const [stockSaving, setStockSaving] = useState(false);
    const [stockError, setStockError] = useState<string | null>(null);
    const [owners, setOwners] = useState<{ email: string; name: string; userId: string; storeId: string | null }[]>([]);
    const [ownersError, setOwnersError] = useState<string | null>(null);
    const [mergeSourceId, setMergeSourceId] = useState<string>('');
    const [mergeBusy, setMergeBusy] = useState(false);
    const [mergeError, setMergeError] = useState<string | null>(null);
    const [linkEmail, setLinkEmail] = useState('');
    const [linkBusy, setLinkBusy] = useState(false);
    const [linkError, setLinkError] = useState<string | null>(null);
    const [linkSuccess, setLinkSuccess] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
    const [moveBusy, setMoveBusy] = useState<string | null>(null);
    const [moveError, setMoveError] = useState<string | null>(null);
    const [unlinkBusy, setUnlinkBusy] = useState<string | null>(null);
    const [unlinkError, setUnlinkError] = useState<string | null>(null);

    const openReceipt = async (saleId: string) => {
        setReceiptError(null);
        const cached = receiptCacheRef.current[saleId];
        if (cached) {
            setViewingReceipt(cached);
            return;
        }
        setReceiptLoadingId(saleId);
        try {
            const src = await loadReceiptImage(saleId);
            if (!src) {
                setReceiptError('Receipt image not found.');
                return;
            }
            receiptCacheRef.current[saleId] = src;
            setViewingReceipt(src);
        } catch (e) {
            console.error('Failed to load receipt', e);
            setReceiptError('Failed to load receipt image.');
        } finally {
            setReceiptLoadingId(null);
        }
    };

    useEffect(() => {
        setRoyaltyDraft(String(store.royaltyPercentage ?? 0));
    }, [store.royaltyPercentage]);

    useEffect(() => {
        setCurrencyDraft(store.currency || '');
    }, [store.currency]);

    const normalizePercentInput = (value: string) => {
        const cleaned = value.replace(/[^\d.]/g, '');
        const parts = cleaned.split('.');
        if (parts.length <= 1) return cleaned;
        return `${parts[0]}.${parts.slice(1).join('')}`;
    };

    const saveRoyaltyRate = async () => {
        const next = parseFloat(royaltyDraft);
        if (Number.isNaN(next)) {
            setRoyaltyError('Enter a valid number.');
            return;
        }
        if (next < 0 || next > 100) {
            setRoyaltyError('Royalty rate must be between 0 and 100.');
            return;
        }
        try {
            setRoyaltySaving(true);
            setRoyaltyError(null);
            await onUpdateStore({ ...store, royaltyPercentage: next });
        } catch (e) {
            console.error('Failed to update royalty rate', e);
            setRoyaltyError('Failed to update. Please try again.');
        } finally {
            setRoyaltySaving(false);
        }
    };

    const saveCurrency = async () => {
        if (!currencyDraft) {
            setCurrencyError('Select a currency.');
            return;
        }
        try {
            setCurrencySaving(true);
            setCurrencyError(null);
            await onUpdateStore({ ...store, currency: currencyDraft });
        } catch (e) {
            console.error('Failed to update currency', e);
            setCurrencyError('Failed to update. Please try again.');
        } finally {
            setCurrencySaving(false);
        }
    };

    const toggleSaleDetails = (id: string) => {
        setExpandedSales(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const getIngredientUsageForSale = (sale: Sale) => {
        const totals: Record<string, number> = {};
        sale.items.forEach(item => {
            const avgUsage = categoryUsageMap[item.menuId];
            if (!avgUsage) return;
            Object.keys(avgUsage).forEach(ingName => {
                totals[ingName] = (totals[ingName] || 0) + avgUsage[ingName] * item.quantity;
            });
        });
        return totals;
    };

    const saveStockSettings = async () => {
        try {
            setStockSaving(true);
            setStockError(null);
            await onSaveStoreStocks(store.id, stockDrafts);
            setShowStockEditor(false);
        } catch (e) {
            console.error('Failed to save stock settings', e);
            setStockError('Failed to save stock settings.');
        } finally {
            setStockSaving(false);
        }
    };

    const openEmailReminder = (date: string) => {
        const subject = encodeURIComponent(`Missing Daily Report: ${store.name} (${date})`);
        const body = encodeURIComponent(
            `Hello,\n\nPlease submit the daily sales report for ${date}.\n\nStore: ${store.name}\nLocation: ${store.city}, ${store.country}\n\nThank you.`
        );
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(store.ownerEmail)}&su=${subject}&body=${body}`;
        const mailtoUrl = `mailto:${store.ownerEmail}?subject=${subject}&body=${body}`;
        const win = window.open(gmailUrl, '_blank', 'noopener,noreferrer');
        if (!win) {
            window.location.href = mailtoUrl;
        }
        setEmailInfo(`Email draft opened for ${store.ownerEmail} (${date}).`);
        window.setTimeout(() => setEmailInfo(null), 3000);
    };

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const calendarCells = useMemo(() => {
        const year = calendarMonth.getFullYear();
        const month = calendarMonth.getMonth();
        const start = new Date(year, month, 1);
        const end = new Date(year, month + 1, 0);
        const startWeekday = start.getDay();
        const daysInMonth = end.getDate();
        const cells: Array<string | null> = [];

        for (let i = 0; i < startWeekday; i++) cells.push(null);
        for (let day = 1; day <= daysInMonth; day++) {
            const d = new Date(year, month, day);
            cells.push(formatDate(d));
        }
        return cells;
    }, [calendarMonth]);

    const today = new Date();
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const canGoNextMonth = calendarMonth.getTime() < currentMonthStart.getTime();

    const goPrevMonth = () => {
        setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    };

    const goNextMonth = () => {
        if (!canGoNextMonth) return;
        setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    };

    const monthlyRevenueData = useMemo(() => {
        const data: { name: string; value: number }[] = [];
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = formatDate(d).slice(0, 7);
            const total = storeSales
                .filter(s => s.date.startsWith(key))
                .reduce((sum, s) => sum + s.totalAmount, 0);
            data.push({
                name: d.toLocaleString('en-US', { month: 'short' }),
                value: total,
            });
        }
        return data;
    }, [storeSales]);

    const ingredientUnitMap = useMemo(() => {
        const map: Record<string, string> = {};
        standardIngredients.forEach(ing => {
            map[ing.name] = ing.unit;
        });
        return map;
    }, [standardIngredients]);

    const storeStockRows = useMemo(
        () => storeStocks.filter(s => s.storeId === store.id),
        [storeStocks, store.id]
    );

    const storeStockMap = useMemo(() => {
        const map: Record<string, StoreIngredientStock> = {};
        storeStockRows.forEach(row => {
            map[`${row.ingredientName}::${row.unit}`] = row;
        });
        return map;
    }, [storeStockRows]);

    useEffect(() => {
        if (showStockEditor) return;
        const next = standardIngredients.map(ing => {
            const key = `${ing.name}::${ing.unit}`;
            const row = storeStockMap[key];
            return {
                ingredientName: ing.name,
                unit: ing.unit,
                par: row?.par ?? ing.par ?? 0,
                reorder: row?.reorder ?? ing.reorder ?? 0,
            };
        });
        setStockDrafts(next);
    }, [standardIngredients, storeStockMap, showStockEditor]);

    useEffect(() => {
        let cancelled = false;
        const loadOwners = async () => {
            try {
                setOwnersError(null);
                const rows = await loadStoreAccounts(store.id);
                if (cancelled) return;
                setOwners(rows);
            } catch (e) {
                if (!cancelled) {
                    setOwnersError('Failed to load owners.');
                }
            }
        };
        loadOwners();
        return () => { cancelled = true; };
    }, [store.id]);

    const refreshOwners = async () => {
        try {
            const rows = await loadStoreAccounts(store.id);
            setOwners(rows);
        } catch {
            setOwnersError('Failed to load owners.');
        }
    };

    const mergeCandidates = useMemo(
        () => allStores.filter(s =>
            s.id !== store.id &&
            s.name === store.name &&
            s.country === store.country &&
            s.city === store.city
        ),
        [allStores, store]
    );

    const handleMerge = async () => {
        if (!mergeSourceId) return;
        try {
            setMergeBusy(true);
            setMergeError(null);
            const source = allStores.find(s => s.id === mergeSourceId);
            if (!source) throw new Error('Source store not found.');
            const sourceSales = sales.filter(s => s.storeId === source.id);
            const targetSales = sales.filter(s => s.storeId === store.id);
            if (source.currency !== store.currency && (sourceSales.length > 0 || targetSales.length > 0)) {
                setMergeError('Currency differs between stores. Merge is blocked because sales currency would be mixed.');
                setMergeBusy(false);
                return;
            }
            await onMergeStores(mergeSourceId, store.id);
            setMergeSourceId('');
        } catch (e) {
            console.error('Merge failed', e);
            setMergeError('Failed to merge stores.');
        } finally {
            setMergeBusy(false);
        }
    };

    const handleLinkAccount = async () => {
        const email = linkEmail.trim().toLowerCase();
        if (!email) {
            setLinkError('Enter an email to link.');
            return;
        }
        try {
            setLinkBusy(true);
            setLinkError(null);
            setLinkSuccess(null);
            await linkAccountToStore(email, store.id);
            setLinkSuccess(`${email} linked to this store.`);
            setLinkEmail('');
            await refreshOwners();
        } catch (e) {
            console.error('Failed to link account', e);
            setLinkError('Failed to link account.');
        } finally {
            setLinkBusy(false);
        }
    };

    const handleMoveAccount = async (email: string) => {
        const targetId = moveTargets[email];
        if (!targetId) {
            setMoveError('Select a target store.');
            return;
        }
        try {
            setMoveBusy(email);
            setMoveError(null);
            await linkAccountToStore(email, targetId);
            await refreshOwners();
        } catch (e) {
            console.error('Failed to move account', e);
            setMoveError('Failed to move account.');
        } finally {
            setMoveBusy(null);
        }
    };

    const handleUnlinkAccount = async (email: string) => {
        const ok = window.confirm(`Unlink ${email} from this store?`);
        if (!ok) return;
        try {
            setUnlinkBusy(email);
            setUnlinkError(null);
            await unlinkAccountFromStore(email, store.id);
            await refreshOwners();
        } catch (e) {
            console.error('Failed to unlink account', e);
            setUnlinkError('Failed to unlink account.');
        } finally {
            setUnlinkBusy(null);
        }
    };

    const handleDeleteStore = async () => {
        setDeleteError(null);
        if (storeSales.length > 0 || storeMenus.length > 0) {
            setDeleteError('Store has data. Delete is blocked to prevent data loss.');
            return;
        }
        const ok = window.confirm(`Delete store "${store.name}"? This cannot be undone.`);
        if (!ok) return;
        try {
            await onDeleteStore(store.id);
            onBack();
        } catch (e) {
            console.error('Failed to delete store', e);
            setDeleteError('Failed to delete store.');
        }
    };

    // Average ingredient usage per category (based on menu recipes)
    const categoryUsageMap = useMemo(() => {
        const map: Record<string, Record<string, number>> = {};
        categories.forEach(cat => {
            const catMenus = storeMenus.filter(m => m.category === cat);
            if (catMenus.length === 0) return;

            const ingTotals: Record<string, number> = {};
            catMenus.forEach(menu => {
                menu.recipe.forEach(r => {
                    const ingDef = ingredients.find(i => i.id === r.ingredientId);
                    if (ingDef && standardIngredients.some(si => si.name === ingDef.name)) {
                        ingTotals[ingDef.name] = (ingTotals[ingDef.name] || 0) + r.quantity;
                    }
                });
            });

            map[cat] = {};
            Object.keys(ingTotals).forEach(ingName => {
                map[cat][ingName] = ingTotals[ingName] / catMenus.length;
            });
        });
        return map;
    }, [categories, storeMenus, ingredients, standardIngredients]);

    // --- Real-time Inventory Calculation Logic ---
    const inventoryStats = useMemo(() => {
        const stats: Record<string, { used: number; unit: string; par: number; reorder: number; remaining: number | null; configured: boolean }> = {};
        standardIngredients.forEach(ing => {
            const key = `${ing.name}::${ing.unit}`;
            const row = storeStockMap[key];
            const par = row?.par ?? ing.par ?? 0;
            const reorder = row?.reorder ?? ing.reorder ?? 0;
            const configured = Boolean(row) || Number(ing.par ?? 0) > 0 || Number(ing.reorder ?? 0) > 0;
            stats[ing.name] = { used: 0, unit: ing.unit, par, reorder, remaining: null, configured };
        });

        // 2. Apply Sales Data to calculate total consumption
        storeSales.forEach(sale => {
            sale.items.forEach(saleItem => {
                // In SalesReporter, menuId IS the Category Name
                const categoryName = saleItem.menuId; 
                const quantitySold = saleItem.quantity;
                const avgUsage = categoryUsageMap[categoryName];

                if (avgUsage) {
                    Object.keys(avgUsage).forEach(ingName => {
                        if (stats[ingName]) {
                            stats[ingName].used += (avgUsage[ingName] * quantitySold);
                        }
                    });
                }
            });
        });

        Object.keys(stats).forEach(ingName => {
            if (stats[ingName].configured) {
                const par = stats[ingName].par;
                stats[ingName].remaining = Math.max(0, par - stats[ingName].used);
            }
        });

        return stats;
    }, [standardIngredients, categoryUsageMap, storeSales, storeStockMap]);

    return (
        <div className="p-8 max-w-7xl mx-auto w-full relative">
            {showMissingCalendar && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
                        <div className="flex items-center justify-between px-6 pt-5">
                            <div className="font-extrabold text-lg">Missing Reports Calendar</div>
                            <button
                                type="button"
                                onClick={() => setShowMissingCalendar(false)}
                                className="p-2 rounded-full hover:bg-gray-100 transition"
                            >
                                <X className="w-5 h-5 text-gray-500" />
                            </button>
                        </div>
                        <div className="px-6 pb-6">
                            <div className="flex items-center justify-between mt-3 mb-4">
                                <button
                                    type="button"
                                    onClick={goPrevMonth}
                                    className="px-3 py-1 rounded-lg border border-gray-200 text-sm font-semibold hover:bg-gray-50 transition"
                                >
                                    Prev
                                </button>
                                <div className="font-semibold text-sm">
                                    {monthNames[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}
                                </div>
                                <button
                                    type="button"
                                    onClick={goNextMonth}
                                    disabled={!canGoNextMonth}
                                    className="px-3 py-1 rounded-lg border border-gray-200 text-sm font-semibold disabled:opacity-50 hover:bg-gray-50 transition"
                                >
                                    Next
                                </button>
                            </div>

                            <div className="grid grid-cols-7 gap-2 text-xs text-gray-400 mb-2">
                                <div>Sun</div>
                                <div>Mon</div>
                                <div>Tue</div>
                                <div>Wed</div>
                                <div>Thu</div>
                                <div>Fri</div>
                                <div>Sat</div>
                            </div>

                            <div className="grid grid-cols-7 gap-2">
                                {calendarCells.map((dateStr, idx) => {
                                    if (!dateStr) {
                                        return <div key={`empty-${idx}`} />;
                                    }
                                    const isMissing = missingDateSet.has(dateStr);
                                    const isSubmitted = submittedDateSet.has(dateStr);
                                    const isFuture = new Date(dateStr) > today;
                                    return (
                                        <button
                                            key={dateStr}
                                            type="button"
                                            disabled={isFuture}
                                            onClick={() => {
                                                if (!isMissing) return;
                                                openEmailReminder(dateStr);
                                            }}
                                            className={`h-9 rounded-lg text-xs font-semibold border transition ${
                                                isMissing
                                                    ? 'bg-red-100 border-red-300 text-red-700 hover:bg-red-200'
                                                    : isSubmitted
                                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                                        : 'bg-white border-gray-200 text-gray-500'
                                            } ${isFuture ? 'opacity-40 cursor-not-allowed' : ''}`}
                                            title={isMissing ? 'Missing report' : (isSubmitted ? 'Submitted' : 'No report')}
                                        >
                                            {dateStr.slice(8)}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="mt-4 flex items-center gap-3 text-xs text-gray-500">
                                <div className="flex items-center gap-1">
                                    <span className="inline-block w-3 h-3 rounded bg-red-100 border border-red-300" />
                                    Missing
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="inline-block w-3 h-3 rounded bg-emerald-50 border border-emerald-200" />
                                    Submitted
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {showStockEditor && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl">
                        <div className="flex items-center justify-between px-6 pt-5">
                            <div className="font-extrabold text-lg">Store Stock Settings</div>
                            <button
                                type="button"
                                onClick={() => setShowStockEditor(false)}
                                className="p-2 rounded-full hover:bg-gray-100 transition"
                            >
                                <X className="w-5 h-5 text-gray-500" />
                            </button>
                        </div>
                        <div className="px-6 py-4">
                            <div className="text-xs text-gray-500 mb-3">
                                Set per-store stock and reorder thresholds for standard ingredients.
                            </div>
                            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                                {stockDrafts.map((row, idx) => (
                                    <div key={`${row.ingredientName}-${idx}`} className="grid grid-cols-12 gap-2 items-center">
                                        <div className="col-span-5 text-sm font-semibold text-gray-800">{row.ingredientName}</div>
                                        <div className="col-span-2 text-xs text-gray-500">{row.unit}</div>
                                        <input
                                            className="col-span-2 border border-gray-200 rounded-lg p-2 text-sm text-right"
                                            value={String(row.par ?? 0)}
                                            onChange={(e) => {
                                                const val = e.target.value.replace(/[^\d.]/g, '');
                                                setStockDrafts(prev => prev.map((r, i) => i === idx ? { ...r, par: val === '' ? 0 : Number(val) } : r));
                                            }}
                                            placeholder="Stock"
                                        />
                                        <input
                                            className="col-span-2 border border-gray-200 rounded-lg p-2 text-sm text-right"
                                            value={String(row.reorder ?? 0)}
                                            onChange={(e) => {
                                                const val = e.target.value.replace(/[^\d.]/g, '');
                                                setStockDrafts(prev => prev.map((r, i) => i === idx ? { ...r, reorder: val === '' ? 0 : Number(val) } : r));
                                            }}
                                            placeholder="Reorder"
                                        />
                                    </div>
                                ))}
                            </div>
                            {stockError && <div className="mt-3 text-sm text-red-600">{stockError}</div>}
                        </div>
                        <div className="px-6 pb-6 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setShowStockEditor(false)}
                                className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={saveStockSettings}
                                disabled={stockSaving}
                                className="px-4 py-2 rounded-xl bg-black text-white text-sm font-bold disabled:opacity-50"
                            >
                                {stockSaving ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {editingMenu && (
                 <RecipeEditor 
                  menu={editingMenu}
                  ingredients={ingredients}
                  categories={categories}
                  standardIngredients={standardIngredients}
                  onAddIngredient={onAddIngredient}
                  onSave={async (updatedMenu) => {
                    await Promise.resolve(onUpdateMenu(updatedMenu));
                    setEditingMenu(null);
                  }}
                  onBack={() => setEditingMenu(null)}
                />
            )}
            
            <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-black mb-6 font-bold">
                <ArrowLeft className="w-5 h-5"/> Back to Dashboard
            </button>
            
            <div className="flex items-start justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-extrabold">{store.name}</h1>
                    <div className="flex items-center gap-2 text-gray-500 mt-2">
                        <MapPin className="w-4 h-4"/> {store.city}, {store.country} • Owner: {store.ownerEmail}
                    </div>
                    <div className="mt-2 text-xs text-gray-500">
                        {owners.length > 0 ? (
                            <span>
                                Linked Accounts: {owners.map(o => {
                                    const label = o.name ? `${o.name} (${o.email})` : o.email;
                                    return o.storeId ? `${label} [${o.storeId}]` : label;
                                }).join(', ')}
                            </span>
                        ) : (
                            <span>{ownersError ? ownersError : 'Linked Accounts: —'}</span>
                        )}
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-sm font-bold text-gray-500">Currency</div>
                    <div className="mt-1 flex items-center gap-2 justify-end">
                        <select
                            value={currencyDraft}
                            onChange={(e) => setCurrencyDraft(e.target.value)}
                            className="px-2 py-1 rounded-lg border border-gray-200 text-right font-bold bg-white"
                        >
                            <option value="">Select</option>
                            {currencies.map(cur => (
                                <option key={cur} value={cur}>{cur}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={saveCurrency}
                            disabled={currencySaving || !currencyDraft}
                            className="px-3 py-1 rounded-lg bg-black text-white text-xs font-bold disabled:opacity-50"
                        >
                            {currencySaving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                    {currencyError && (
                        <div className="mt-2 text-xs text-red-600 text-right">{currencyError}</div>
                    )}
                    <div className="mt-4 text-sm font-bold text-gray-500">Royalty Rate (%)</div>
                    <div className="mt-1 flex items-center gap-2 justify-end">
                        <input
                            type="text"
                            inputMode="decimal"
                            value={royaltyDraft}
                            onChange={(e) => setRoyaltyDraft(normalizePercentInput(e.target.value))}
                            className="w-24 px-2 py-1 rounded-lg border border-gray-200 text-right font-bold"
                        />
                        <button
                            type="button"
                            onClick={saveRoyaltyRate}
                            disabled={royaltySaving || Number.isNaN(parseFloat(royaltyDraft))}
                            className="px-3 py-1 rounded-lg bg-black text-white text-xs font-bold disabled:opacity-50"
                        >
                            {royaltySaving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                    {royaltyError && (
                        <div className="mt-2 text-xs text-red-600 text-right">{royaltyError}</div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                <div className="space-y-8">
                    {/* Compliance Alert */}
                    <div className={`p-6 rounded-2xl shadow-sm border ${missingDates.length > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                        <div className="flex items-start gap-4">
                            <div className={`p-3 rounded-full ${missingDates.length > 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                {missingDates.length > 0 ? <AlertOctagon className="w-6 h-6"/> : <CheckCircle2 className="w-6 h-6"/>}
                            </div>
                            <div>
                                <h3 className={`font-bold text-lg ${missingDates.length > 0 ? 'text-red-900' : 'text-green-900'}`}>
                                    {missingDates.length > 0 ? 'Missing Daily Reports' : 'Reporting Compliance'}
                                </h3>
                                <div className={`text-sm mt-1 ${missingDates.length > 0 ? 'text-red-700' : 'text-green-700'}`}>
                                    {missingDates.length > 0 ? (
                                        <>
                                            <p className="font-bold mb-2">The following dates are missing:</p>
                                            <div className="flex flex-wrap gap-2">
                                                {missingDates.map(d => (
                                                    <button
                                                        key={d}
                                                        type="button"
                                                        onClick={() => {
                                                            openEmailReminder(d);
                                                        }}
                                                        className="bg-white border border-red-200 px-2 py-1 rounded text-xs font-bold text-red-600 shadow-sm hover:bg-red-50 transition"
                                                        title="Send email reminder"
                                                    >
                                                        {d}
                                                    </button>
                                                ))}
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setCalendarMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
                                                        setShowMissingCalendar(true);
                                                    }}
                                                    className="bg-white border border-red-200 px-2 py-1 rounded text-xs font-bold text-red-700 shadow-sm hover:bg-red-50 transition"
                                                >
                                                    View Older Dates
                                                </button>
                                            </div>
                                            <div className="mt-2 text-xs text-red-500">
                                                Tip: Click a date to open an email reminder to the owner.
                                            </div>
                                            {emailInfo && (
                                                <div className="mt-2 text-xs text-emerald-600">{emailInfo}</div>
                                            )}
                                        </>
                                    ) : (
                                        <p>All daily reports for the last 7 days have been submitted.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {mergeCandidates.length > 0 && (
                        <div className="bg-white p-6 rounded-2xl shadow-sm border">
                            <h2 className="text-xl font-bold mb-2">Merge Duplicate Store</h2>
                            <p className="text-xs text-gray-500 mb-4">
                                If multiple accounts created duplicate stores (same name/city/country), you can merge them into this store.
                            </p>
                            <div className="flex flex-col md:flex-row gap-3">
                                <select
                                    value={mergeSourceId}
                                    onChange={(e) => setMergeSourceId(e.target.value)}
                                    className="flex-1 border border-gray-200 rounded-xl p-2 text-sm"
                                >
                                    <option value="">Select store to merge into this one</option>
                                    {mergeCandidates.map(s => (
                                        <option key={s.id} value={s.id}>
                                            {s.name} • {s.city}, {s.country} • {s.currency}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    onClick={handleMerge}
                                    disabled={!mergeSourceId || mergeBusy}
                                    className="px-4 py-2 rounded-xl bg-black text-white text-sm font-bold disabled:opacity-50"
                                >
                                    {mergeBusy ? 'Merging...' : 'Merge'}
                                </button>
                            </div>
                            {mergeError && <div className="mt-3 text-xs text-red-600">{mergeError}</div>}
                            <div className="mt-3 text-[10px] text-gray-400">
                                Note: If currencies differ and sales exist, merge is blocked to avoid mixing currencies.
                            </div>
                        </div>
                    )}

                    <div className="bg-white p-6 rounded-2xl shadow-sm border">
                        <h2 className="text-xl font-bold mb-2">Link Account to This Store</h2>
                        <p className="text-xs text-gray-500 mb-4">
                            Use this when a manager created the wrong store. This links their account to this store without touching existing data.
                        </p>
                        <div className="flex flex-col md:flex-row gap-3">
                            <input
                                value={linkEmail}
                                onChange={(e) => setLinkEmail(e.target.value)}
                                placeholder="manager@email.com"
                                className="flex-1 border border-gray-200 rounded-xl p-2 text-sm"
                            />
                            <button
                                type="button"
                                onClick={handleLinkAccount}
                                disabled={linkBusy}
                                className="px-4 py-2 rounded-xl bg-black text-white text-sm font-bold disabled:opacity-50"
                            >
                                {linkBusy ? 'Linking...' : 'Link Account'}
                            </button>
                        </div>
                        {linkError && <div className="mt-3 text-xs text-red-600">{linkError}</div>}
                        {linkSuccess && <div className="mt-3 text-xs text-emerald-600">{linkSuccess}</div>}
                        <div className="mt-3 text-[10px] text-gray-400">
                            Note: The user must sign in at least once so their account exists.
                        </div>
                        {owners.length > 0 && (
                            <div className="mt-5 space-y-2">
                                <div className="text-sm font-bold text-gray-700">Linked Accounts</div>
                                {owners.map(owner => (
                                    <div key={owner.email} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                                        <div className="text-xs text-gray-700">
                                            <div className="font-semibold">
                                                {owner.name || '—'} <span className="text-gray-500">({owner.email})</span>
                                            </div>
                                            <div className="text-[11px] text-gray-500">store_id: {owner.storeId || '—'}</div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <select
                                                value={moveTargets[owner.email] || ''}
                                                onChange={(e) => setMoveTargets(prev => ({ ...prev, [owner.email]: e.target.value }))}
                                                className="px-2 py-1 rounded-lg border border-gray-200 text-xs"
                                            >
                                                <option value="">Move to store...</option>
                                                {allStores.filter(s => s.id !== store.id).map(s => (
                                                    <option key={s.id} value={s.id}>
                                                        {s.name} • {s.city}
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={() => handleMoveAccount(owner.email)}
                                                disabled={moveBusy === owner.email || !moveTargets[owner.email]}
                                                className="px-3 py-1 rounded-lg bg-black text-white text-xs font-bold disabled:opacity-50"
                                            >
                                                {moveBusy === owner.email ? 'Moving...' : 'Move'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleUnlinkAccount(owner.email)}
                                                disabled={unlinkBusy === owner.email}
                                                className="px-3 py-1 rounded-lg border border-red-200 text-red-600 text-xs font-bold disabled:opacity-50"
                                            >
                                                {unlinkBusy === owner.email ? 'Unlinking...' : 'Unlink'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {moveError && <div className="text-xs text-red-600">{moveError}</div>}
                                {unlinkError && <div className="text-xs text-red-600">{unlinkError}</div>}
                            </div>
                        )}
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-red-200">
                        <h2 className="text-xl font-bold mb-2 text-red-700">Delete Empty Store</h2>
                        <p className="text-xs text-red-600 mb-4">
                            Use this only for mistakenly created stores with no data.
                        </p>
                        <button
                            type="button"
                            onClick={handleDeleteStore}
                            className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700"
                        >
                            Delete Store
                        </button>
                        {deleteError && <div className="mt-3 text-xs text-red-600">{deleteError}</div>}
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-sm border">
                        <h2 className="text-xl font-bold mb-4">Store Performance</h2>
                        <div className="h-64 bg-gray-50 rounded-xl p-2">
                            {monthlyRevenueData.every(d => d.value === 0) ? (
                                <div className="h-full flex items-center justify-center text-gray-400">
                                    <BarChart3 className="w-8 h-8 mb-2" />
                                    <span className="ml-2 font-medium">No sales data for the last 12 months</span>
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={monthlyRevenueData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                                        <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                                        <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                                        <Tooltip
                                            cursor={{ fill: '#f9fafb' }}
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                            formatter={(value: number) => [`${store.currency} ${value.toLocaleString()}`, 'Monthly Sales']}
                                        />
                                        <Bar dataKey="value" fill="black" radius={[4, 4, 0, 0]} barSize={20} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </div>

                {/* Real-time Inventory Section */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-black/10">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <Package className="w-5 h-5"/> Real-time Inventory (Est.)
                        </h2>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold bg-gray-100 px-2 py-1 rounded text-gray-500">Auto-Calculated</span>
                            <button
                                type="button"
                                onClick={() => setShowStockEditor(true)}
                                className="text-xs font-bold bg-white border border-gray-200 px-2 py-1 rounded hover:bg-gray-50"
                            >
                                Edit Stock
                            </button>
                        </div>
                    </div>
                    <div className="space-y-4">
                        {Object.entries(inventoryStats).map(([name, data]) => {
                            const hasConfiguredStock = data.configured;
                            const remaining = data.remaining;
                            const percentUsed = hasConfiguredStock
                                ? (data.par > 0 ? Math.min(100, (data.used / data.par) * 100) : (data.used > 0 ? 100 : 0))
                                : 0;
                            const isLow = hasConfiguredStock
                                ? (data.reorder > 0 ? (remaining !== null && remaining <= data.reorder) : percentUsed > 80)
                                : false;

                            return (
                                <div key={name} className="p-4 border rounded-xl hover:border-black transition">
                                    <div className="flex justify-between items-end mb-2">
                                        <div>
                                            <div className="font-bold text-gray-800">{name}</div>
                                            <div className="text-xs text-gray-500">Standard Ingredient</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-lg font-extrabold">
                                                {data.used.toLocaleString()}
                                                <span className="text-xs font-medium text-gray-400"> {data.unit} used</span>
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                {hasConfiguredStock ? (
                                                    <>Remaining: {(remaining ?? 0).toLocaleString()} {data.unit}</>
                                                ) : (
                                                    <>Set stock in Store Settings</>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    {/* Simulated Stock Bar */}
                                    <div className="h-3 w-full bg-gray-100 rounded-full overflow-hidden relative">
                                        <div 
                                            className={`h-full rounded-full ${isLow ? 'bg-red-500' : 'bg-black'}`} 
                                            style={{ width: `${percentUsed}%` }}
                                        />
                                    </div>
                                    <div className="flex justify-between mt-2 text-[10px] font-bold text-gray-400 uppercase">
                                        <span>Current Consumption</span>
                                        {isLow && <span className="text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> Reorder Recommended</span>}
                                    </div>
                                </div>
                            );
                        })}
                        {Object.keys(inventoryStats).length === 0 && (
                            <div className="text-center py-8 text-gray-400 italic">No standard ingredients configured.</div>
                        )}
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border mb-8">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <ClipboardList className="w-5 h-5"/> Sales History
                    </h2>
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-400">Showing {salesLookbackLabel} data</span>
                        <button
                            type="button"
                            onClick={onLoadMoreSales}
                            className="text-xs font-bold px-3 py-1 rounded-full border border-gray-200 hover:bg-gray-50 transition"
                        >
                            Load more
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-xs">
                            <tr>
                                <th className="p-4 rounded-l-lg">Date</th>
                                <th className="p-4 text-right">Total Sales</th>
                                <th className="p-4 text-center">Status</th>
                                <th className="p-4 text-center">Items</th>
                                <th className="p-4 text-center rounded-r-lg">Receipt</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {sortedStoreSales.map(sale => (
                                <React.Fragment key={sale.id}>
                                    <tr className="hover:bg-gray-50 transition">
                                        <td className="p-4 font-medium">{sale.date}</td>
                                        <td className="p-4 text-right font-bold font-mono">
                                            {sale.isClosed ? '-' : `${store.currency} ${sale.totalAmount.toLocaleString()}`}
                                        </td>
                                        <td className="p-4 text-center">
                                            {sale.isClosed ? (
                                                <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold uppercase">Closed</span>
                                            ) : (
                                                <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-xs font-bold uppercase">Open</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-center">
                                            <button
                                                type="button"
                                                onClick={() => toggleSaleDetails(sale.id)}
                                                className="text-xs font-bold text-gray-700 px-3 py-1 rounded-full border border-gray-200 hover:bg-gray-50 transition"
                                            >
                                                {expandedSales.has(sale.id) ? 'Hide' : 'View'}
                                            </button>
                                        </td>
                                        <td className="p-4 text-center">
                                            {sale.isClosed || !sale.hasReceipt ? (
                                                <span className="text-gray-300 text-xs italic">No Image</span>
                                            ) : (
                                                <button 
                                                    onClick={() => openReceipt(sale.id)}
                                                    disabled={receiptLoadingId === sale.id}
                                                    className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:bg-blue-50 px-3 py-1 rounded-full transition disabled:opacity-60"
                                                >
                                                    <ImageIcon className="w-3 h-3"/> {receiptLoadingId === sale.id ? 'Loading...' : 'View Receipt'}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                    {expandedSales.has(sale.id) && (
                                        <tr>
                                            <td colSpan={5} className="p-4 bg-gray-50">
                                                {sale.isClosed && sale.closedReason && (
                                                    <div className="mb-3 text-xs font-semibold text-gray-600">
                                                        Closure reason: {sale.closedReason}
                                                    </div>
                                                )}
                                                <div className="text-xs font-bold text-gray-500 uppercase mb-2">Category Quantities</div>
                                                {sale.items?.length ? (
                                                    <div className="flex flex-wrap gap-2">
                                                        {sale.items.map((item, idx) => (
                                                            <div key={idx} className="bg-white border border-gray-200 px-2 py-1 rounded text-xs font-bold text-gray-700">
                                                                {item.menuId} • {item.quantity}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="text-xs text-gray-400">No item data for this report.</div>
                                                )}

                                                <div className="text-xs font-bold text-gray-500 uppercase mt-4 mb-2">Estimated Ingredient Usage</div>
                                                {sale.items?.length ? (
                                                    <div className="flex flex-wrap gap-2">
                                                        {Object.entries(getIngredientUsageForSale(sale)).map(([ingName, qty]) => (
                                                            <div key={ingName} className="bg-white border border-gray-200 px-2 py-1 rounded text-xs font-bold text-gray-700">
                                                                {ingName} • {qty.toFixed(1)} {ingredientUnitMap[ingName] || ''}
                                                            </div>
                                                        ))}
                                                        {Object.keys(getIngredientUsageForSale(sale)).length === 0 && (
                                                            <div className="text-xs text-gray-400">No ingredient mapping for this sale.</div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="text-xs text-gray-400">No item data for this report.</div>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                            {sortedStoreSales.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-gray-400">No sales reports found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {receiptError && (
                    <div className="mt-3 text-xs text-red-600">{receiptError}</div>
                )}
            </div>

            <MenuManager 
                store={store} 
                menus={storeMenus} 
                onEdit={setEditingMenu}
                onCreate={(menu) => setEditingMenu(menu)}
                onDelete={onDeleteMenu}
            />

            <div className="mt-10">
                <EmployeeManager
                    store={store}
                    employees={storeEmployees}
                    positions={positions}
                    onUpdate={(emps) => onUpdateEmployees(store.id, emps)}
                />
            </div>

            {viewingReceipt && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
                    <div className="relative max-w-4xl max-h-full">
                        <img src={viewingReceipt} alt="Receipt" className="max-w-full max-h-[90vh] rounded-lg shadow-2xl" />
                        <button onClick={() => setViewingReceipt(null)} className="absolute -top-4 -right-4 bg-white text-black rounded-full p-2 hover:bg-gray-200 transition shadow-lg">
                            <X className="w-6 h-6"/>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const ConfigList: React.FC<{
  title: string;
  description: string;
  items: string[];
  onAdd: (item: string) => void;
  onRemove: (item: string) => void;
  placeholder: string;
}> = ({ title, description, items, onAdd, onRemove, placeholder }) => {
  const [newItem, setNewItem] = useState('');
  return (
    <div className="mb-6">
       <h3 className="font-bold text-gray-700 mb-1">{title}</h3>
       <p className="text-xs text-gray-500 mb-3">{description}</p>
       <div className="flex gap-2 mb-3">
           <input 
                value={newItem}
                onChange={e => setNewItem(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-black bg-white text-black"
                placeholder={placeholder}
           />
           <button 
             onClick={() => { if(newItem) { onAdd(newItem); setNewItem(''); } }} 
             className="bg-black text-white px-4 rounded-lg font-bold text-sm hover:bg-gray-800"
           >
             Add
           </button>
       </div>
       <div className="flex flex-wrap gap-2">
           {items.map(item => (
               <div key={item} className="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-xs font-medium flex items-center gap-2 group border border-gray-200">
                   {item}
                   <button onClick={() => onRemove(item)} className="text-gray-400 hover:text-red-500"><XCircle className="w-3 h-3"/></button>
               </div>
           ))}
       </div>
    </div>
  );
};

const IngredientConfigList: React.FC<{
    items: { name: string; unit: string; par?: number; reorder?: number }[];
    onUpdate: (items: { name: string; unit: string; par?: number; reorder?: number }[]) => void;
}> = ({ items, onUpdate }) => {
    const [name, setName] = useState('');
    const [unit, setUnit] = useState('');
    const [par, setPar] = useState('');
    const [reorder, setReorder] = useState('');
    
    const handleAdd = () => {
        if (name && unit) {
            const nextPar = par === '' ? 0 : Number(par);
            const nextReorder = reorder === '' ? 0 : Number(reorder);
            onUpdate([...items, { name, unit, par: Number.isNaN(nextPar) ? 0 : nextPar, reorder: Number.isNaN(nextReorder) ? 0 : nextReorder }]);
            setName('');
            setUnit('');
            setPar('');
            setReorder('');
        }
    };

    return (
        <div className="mb-6">
            <h3 className="font-bold text-gray-700 mb-1">Standard Ingredients</h3>
            <p className="text-xs text-gray-500 mb-3">Manage standard ingredients (Name, Unit, Stock, Reorder threshold).</p>
            <div className="flex gap-2 mb-3">
                <input 
                    value={name} 
                    onChange={e => setName(e.target.value)} 
                    className="flex-[2] border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-black bg-white text-black" 
                    placeholder="Name (e.g. Flour)" 
                />
                <input 
                    value={unit} 
                    onChange={e => setUnit(e.target.value)} 
                    className="flex-1 border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-black bg-white text-black" 
                    placeholder="Unit (e.g. g)" 
                />
                <input
                    value={par}
                    onChange={e => setPar(e.target.value.replace(/[^\d.]/g, ''))}
                    className="w-24 border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-black bg-white text-black text-right"
                    placeholder="Stock"
                />
                <input
                    value={reorder}
                    onChange={e => setReorder(e.target.value.replace(/[^\d.]/g, ''))}
                    className="w-24 border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-black bg-white text-black text-right"
                    placeholder="Reorder"
                />
                <button onClick={handleAdd} className="bg-black text-white px-4 rounded-lg font-bold text-sm hover:bg-gray-800">Add</button>
            </div>
            <div className="flex flex-wrap gap-2">
                {items.map((item, idx) => (
                    <div key={idx} className="bg-gray-100 text-gray-800 px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2 group border border-gray-200">
                        <div className="font-bold">{item.name}</div>
                        <span className="text-gray-500">({item.unit})</span>
                        <input
                            value={String(item.par ?? 0)}
                            onChange={(e) => {
                                const val = e.target.value.replace(/[^\d.]/g, '');
                                const next = items.map((it, i) => i === idx ? { ...it, par: val === '' ? 0 : Number(val) } : it);
                                onUpdate(next);
                            }}
                            className="w-16 border border-gray-300 rounded-lg p-1 text-right text-xs bg-white"
                            placeholder="Stock"
                        />
                        <input
                            value={String(item.reorder ?? 0)}
                            onChange={(e) => {
                                const val = e.target.value.replace(/[^\d.]/g, '');
                                const next = items.map((it, i) => i === idx ? { ...it, reorder: val === '' ? 0 : Number(val) } : it);
                                onUpdate(next);
                            }}
                            className="w-16 border border-gray-300 rounded-lg p-1 text-right text-xs bg-white"
                            placeholder="Reorder"
                        />
                        <button onClick={() => onUpdate(items.filter((_, i) => i !== idx))} className="text-gray-400 hover:text-red-500"><XCircle className="w-3 h-3"/></button>
                    </div>
                ))}
            </div>
        </div>
    )
}

const HQDashboard: React.FC<{
  user: User;
  onLogout: () => void;
  stores: Store[];
  sales: Sale[];
  menus: Menu[];
  employees: Employee[];
  ingredients: Ingredient[];
  storeStocks: StoreIngredientStock[];
  globalConfig: {
      storeNames: string[];
      countries: string[];
      cities: string[];
      currencies: string[];
      positions: string[];
      categories: string[];
      standardIngredients: { name: string; unit: string; par?: number; reorder?: number }[];
  };
  salesLookbackLabel: string;
  onLoadMoreSales: () => void;
  onUpdateGlobalConfig: (key: string, values: any) => void;
  onUpdateStore: (store: Store) => void;
  onSaveStoreStocks: (storeId: string, rows: { ingredientName: string; unit: string; par: number; reorder: number }[]) => void;
  onDeleteStore: (storeId: string) => Promise<void>;
  onUpdateMenu: (menu: Menu) => void;
  onCreateMenu: (menu: Menu) => void;
  onDeleteMenu: (id: string) => void;
  onUpdateEmployees: (storeId: string, employees: Employee[]) => void;
  onAddIngredient: (ing: Ingredient) => Promise<void> | void;
}> = ({ user, onLogout, stores, sales, menus, employees, ingredients, storeStocks, globalConfig, salesLookbackLabel, onLoadMoreSales, onUpdateGlobalConfig, onUpdateStore, onSaveStoreStocks, onDeleteStore, onUpdateMenu, onCreateMenu, onDeleteMenu, onUpdateEmployees, onAddIngredient }) => {
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSalesAnalyticsOpen, setIsSalesAnalyticsOpen] = useState(false);
  const navReadyRef = useRef(false);
  const navRestoreRef = useRef(false);
  const popLockRef = useRef(false);
  const { rates: fxRates, status: fxStatus } = useFxRates();
  
  // Tabs for Settings
  const [settingsTab, setSettingsTab] = useState<'general' | 'locations' | 'finance' | 'ops' | 'menu'>('general');

  // --- Real-time Metrics Calculation ---
  const metrics = useMemo(() => {
      const today = new Date();
      const currentMonthKey = today.toISOString().slice(0, 7); // e.g. "2023-10"
      const currentMonthName = today.toLocaleString('default', { month: 'long' });
      
      const prevDate = new Date(today);
      prevDate.setMonth(today.getMonth() - 1);
      const prevMonthKey = prevDate.toISOString().slice(0, 7);

      let totalSalesCurrentMonth = 0;
      let totalRoyaltyCurrentMonth = 0;
      let totalSalesLastMonth = 0;

      sales.forEach(sale => {
          const store = stores.find(s => s.id === sale.storeId);
          if (!store) return;

          const amountJPY = convertToJPY(sale.totalAmount, store.currency, fxRates) ?? 0;
          const monthKey = sale.date.slice(0, 7);

          if (monthKey === currentMonthKey) {
              totalSalesCurrentMonth += amountJPY;
              totalRoyaltyCurrentMonth += amountJPY * (store.royaltyPercentage / 100);
          } else if (monthKey === prevMonthKey) {
              totalSalesLastMonth += amountJPY;
          }
      });

      const growthRate = totalSalesLastMonth > 0 
          ? ((totalSalesCurrentMonth - totalSalesLastMonth) / totalSalesLastMonth) * 100 
          : 0;

      return {
          totalSalesCurrentMonth,
          totalRoyaltyCurrentMonth,
          growthRate,
          currentMonthName,
          activeStores: stores.length,
          inventoryAlerts: storeStocks.filter(row => row.reorder > 0 && row.par <= row.reorder).length
      };
  }, [sales, stores, fxRates, storeStocks]);

  useEffect(() => {
    if (typeof window === 'undefined' || navRestoreRef.current) return;
    const historyState = window.history.state;
    const historyStoreId = historyState?.screen === 'hq'
      ? (historyState.selectedStoreId as string | null | undefined) ?? null
      : null;
    const persistedStoreId = historyStoreId ?? window.localStorage.getItem(HQ_SELECTED_STORE_STORAGE_KEY);
    if (persistedStoreId && stores.length === 0) return;

    const restoredStore = persistedStoreId
      ? stores.find(s => s.id === persistedStoreId) ?? null
      : null;
    setSelectedStore(restoredStore);
    window.history.replaceState({ screen: 'hq', selectedStoreId: restoredStore?.id ?? null }, '');
    navReadyRef.current = true;
    navRestoreRef.current = true;
  }, [stores]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (selectedStore?.id) {
      window.localStorage.setItem(HQ_SELECTED_STORE_STORAGE_KEY, selectedStore.id);
    } else {
      window.localStorage.removeItem(HQ_SELECTED_STORE_STORAGE_KEY);
    }
  }, [selectedStore]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!navReadyRef.current) return;
    if (popLockRef.current) {
      popLockRef.current = false;
      return;
    }
    window.history.pushState({ screen: 'hq', selectedStoreId: selectedStore?.id ?? null }, '');
  }, [selectedStore]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = (e: PopStateEvent) => {
      const state = e.state;
      if (!state || state.screen !== 'hq') {
        // keep user inside app while session is valid
        window.history.pushState({ screen: 'hq', selectedStoreId: selectedStore?.id ?? null }, '');
        return;
      }
      popLockRef.current = true;
      if (!state.selectedStoreId) {
        setSelectedStore(null);
        return;
      }
      const store = stores.find(s => s.id === state.selectedStoreId) ?? null;
      setSelectedStore(store);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [stores, selectedStore]);

  useEffect(() => {
    if (!selectedStore) return;
    const updated = stores.find(s => s.id === selectedStore.id);
    if (updated && (updated.royaltyPercentage !== selectedStore.royaltyPercentage || updated.currency !== selectedStore.currency || updated.name !== selectedStore.name)) {
      setSelectedStore(updated);
    }
  }, [stores, selectedStore]);

  if (selectedStore) {
    return (
      <HQStoreDetail 
        store={selectedStore}
        sales={sales}
        menus={menus}
        employees={employees}
        ingredients={ingredients}
        storeStocks={storeStocks}
        allStores={stores}
        categories={globalConfig.categories}
        standardIngredients={globalConfig.standardIngredients}
        currencies={globalConfig.currencies}
        positions={globalConfig.positions}
        salesLookbackLabel={salesLookbackLabel}
        onLoadMoreSales={onLoadMoreSales}
        onBack={() => setSelectedStore(null)}
        onUpdateStore={onUpdateStore}
        onSaveStoreStocks={onSaveStoreStocks}
        onMergeStores={async (sourceId, targetId) => { await supabase.rpc('merge_stores', { p_source_id: sourceId, p_target_id: targetId }); await refreshAll(); }}
        onDeleteStore={onDeleteStore}
        onUpdateMenu={onUpdateMenu}
        onCreateMenu={onCreateMenu}
        onDeleteMenu={onDeleteMenu}
        onUpdateEmployees={onUpdateEmployees}
        onAddIngredient={onAddIngredient}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
       {/* Header */}
       <div className="bg-white border-b px-8 py-4 flex justify-between items-center sticky top-0 z-40">
          <div className="flex items-center gap-4">
             <div className="w-10 h-10 bg-black text-white rounded-full flex items-center justify-center text-lg font-bold">HQ</div>
             <div>
                <h1 className="text-xl font-extrabold tracking-tight">CHIBO HEADQUARTERS</h1>
                <div className="text-xs text-gray-500 font-medium">Global Admin Console</div>
             </div>
          </div>
          <div className="flex items-center gap-4">
             <button onClick={() => setIsSettingsOpen(true)} className="p-2 hover:bg-gray-100 rounded-full transition text-gray-600 flex items-center gap-2">
                 <Settings className="w-5 h-5" />
                 <span className="text-sm font-bold hidden md:inline">Global Settings</span>
             </button>
             <div className="text-right hidden md:block">
                <div className="font-bold text-sm">{user.name}</div>
                <div className="text-xs text-gray-500">{user.email}</div>
             </div>
             <button onClick={onLogout} className="p-2 hover:bg-gray-100 rounded-full transition"><LogOut className="w-5 h-5 text-gray-600" /></button>
          </div>
       </div>

       {isSettingsOpen && (
           <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
               <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                   <div className="p-6 border-b flex justify-between items-center bg-gray-50 rounded-t-2xl">
                       <h2 className="text-xl font-bold">Global Configuration</h2>
                       <button onClick={() => setIsSettingsOpen(false)}><XCircle className="w-6 h-6 text-gray-400 hover:text-black"/></button>
                   </div>
                   
                   <div className="flex border-b">
                       <button onClick={() => setSettingsTab('general')} className={`flex-1 py-3 text-sm font-bold border-b-2 ${settingsTab === 'general' ? 'border-black text-black' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>Store Setup</button>
                       <button onClick={() => setSettingsTab('locations')} className={`flex-1 py-3 text-sm font-bold border-b-2 ${settingsTab === 'locations' ? 'border-black text-black' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>Locations</button>
                       <button onClick={() => setSettingsTab('finance')} className={`flex-1 py-3 text-sm font-bold border-b-2 ${settingsTab === 'finance' ? 'border-black text-black' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>Finance</button>
                       <button onClick={() => setSettingsTab('ops')} className={`flex-1 py-3 text-sm font-bold border-b-2 ${settingsTab === 'ops' ? 'border-black text-black' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>Operations</button>
                       <button onClick={() => setSettingsTab('menu')} className={`flex-1 py-3 text-sm font-bold border-b-2 ${settingsTab === 'menu' ? 'border-black text-black' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>Menu Config</button>
                   </div>

                   <div className="p-6 overflow-y-auto">
                       {settingsTab === 'general' && (
                           <ConfigList 
                             title="Pre-approved Store Names"
                             description="List of store names available for new franchise registrations."
                             items={globalConfig.storeNames}
                             placeholder="e.g. CHIBO Shinjuku"
                             onAdd={(item) => onUpdateGlobalConfig('storeNames', [...globalConfig.storeNames, item])}
                             onRemove={(item) => onUpdateGlobalConfig('storeNames', globalConfig.storeNames.filter(i => i !== item))}
                           />
                       )}
                       {settingsTab === 'locations' && (
                           <>
                            <ConfigList 
                                title="Allowed Countries"
                                description="Countries where franchise operation is authorized."
                                items={globalConfig.countries}
                                placeholder="e.g. Singapore"
                                onAdd={(item) => onUpdateGlobalConfig('countries', [...globalConfig.countries, item])}
                                onRemove={(item) => onUpdateGlobalConfig('countries', globalConfig.countries.filter(i => i !== item))}
                            />
                             <ConfigList 
                                title="Available Cities"
                                description="Cities available for selection during onboarding."
                                items={globalConfig.cities}
                                placeholder="e.g. Busan"
                                onAdd={(item) => onUpdateGlobalConfig('cities', [...globalConfig.cities, item])}
                                onRemove={(item) => onUpdateGlobalConfig('cities', globalConfig.cities.filter(i => i !== item))}
                            />
                           </>
                       )}
                       {settingsTab === 'finance' && (
                           <ConfigList 
                             title="Supported Currencies"
                             description="Currencies available for store financial reporting."
                             items={globalConfig.currencies}
                             placeholder="e.g. EUR"
                             onAdd={(item) => onUpdateGlobalConfig('currencies', [...globalConfig.currencies, item])}
                             onRemove={(item) => onUpdateGlobalConfig('currencies', globalConfig.currencies.filter(i => i !== item))}
                           />
                       )}
                       {settingsTab === 'ops' && (
                           <ConfigList 
                             title="Standard Staff Positions"
                             description="Job titles available for staff management."
                             items={globalConfig.positions}
                             placeholder="e.g. Area Manager"
                             onAdd={(item) => onUpdateGlobalConfig('positions', [...globalConfig.positions, item])}
                             onRemove={(item) => onUpdateGlobalConfig('positions', globalConfig.positions.filter(i => i !== item))}
                           />
                       )}
                       {settingsTab === 'menu' && (
                           <>
                               <ConfigList 
                                 title="Menu Categories"
                                 description="Standardized categories for menu items across all franchises."
                                 items={globalConfig.categories}
                                 placeholder="e.g. Dessert"
                                 onAdd={(item) => onUpdateGlobalConfig('categories', [...globalConfig.categories, item])}
                                 onRemove={(item) => onUpdateGlobalConfig('categories', globalConfig.categories.filter(i => i !== item))}
                               />
                               <IngredientConfigList 
                                 items={globalConfig.standardIngredients}
                                 onUpdate={(items) => onUpdateGlobalConfig('standardIngredients', items)}
                               />
                           </>
                       )}
                   </div>
                   
                   <div className="p-4 border-t bg-gray-50 rounded-b-2xl text-right">
                       <button onClick={() => setIsSettingsOpen(false)} className="bg-black text-white px-6 py-2 rounded-xl font-bold text-sm hover:bg-gray-800">Done</button>
                   </div>
               </div>
           </div>
       )}

       <SalesAnalyticsModal 
            isOpen={isSalesAnalyticsOpen} 
            onClose={() => setIsSalesAnalyticsOpen(false)} 
            sales={sales}
            stores={stores}
            fxRates={fxRates}
            fxStatus={fxStatus}
       />

       <div className="flex-1 p-8 overflow-y-auto space-y-8 max-w-7xl mx-auto w-full">
           {/* KPI Cards */}
           <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {/* Sales Card */}
              <button 
                type="button"
                onClick={() => setIsSalesAnalyticsOpen(true)}
                className="bg-black text-white p-6 rounded-2xl shadow-lg cursor-pointer hover:scale-105 active:scale-95 hover:shadow-2xl transition-all duration-300 group text-left relative overflow-hidden focus:ring-4 focus:ring-black/20 outline-none"
              >
                  <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                  <div className="flex justify-between items-start relative z-10">
                      <h3 className="text-sm font-bold opacity-70 flex items-center gap-2">
                          Total Network Sales 
                          <ChevronRight className="w-4 h-4 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                      </h3>
                      <div className="group/tooltip relative">
                          <Info className="w-4 h-4 opacity-50 hover:opacity-100 cursor-help"/>
                          <div className="absolute right-0 top-6 w-56 bg-gray-800 text-white text-xs p-2 rounded shadow-lg opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-50">
                              Sum of all daily sales reports submitted by stores this month (converted to JPY).
                          </div>
                      </div>
                  </div>
                  <div className="text-3xl font-extrabold mt-2 relative z-10">
                      JPY {metrics.totalSalesCurrentMonth.toLocaleString(undefined, {maximumFractionDigits: 0})}
                  </div>
                  <div className="flex items-center gap-2 mt-2 relative z-10">
                      <span className={`text-xs font-bold ${metrics.growthRate >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {metrics.growthRate >= 0 ? '↑' : '↓'} {Math.abs(metrics.growthRate).toFixed(1)}%
                      </span>
                      <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">
                          vs Last Month
                      </span>
                  </div>
                  <div className="mt-4 text-[10px] text-gray-400 font-bold border-t border-white/10 pt-2">
                      Basis: Current Month ({metrics.currentMonthName}) • FX: {fxStatus === 'ok' ? 'Live' : 'Approx.'}
                  </div>
              </button>
              
              {/* Active Franchises Card */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border relative group">
                  <div className="flex justify-between items-start">
                      <h3 className="text-sm font-bold text-gray-500">Active Franchises</h3>
                      <div className="group/tooltip relative">
                          <Info className="w-4 h-4 text-gray-300 hover:text-gray-600 cursor-help"/>
                          <div className="absolute right-0 top-6 w-48 bg-black text-white text-xs p-2 rounded shadow-lg opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-50">
                              Count of currently operating stores registered in the HQ database.
                          </div>
                      </div>
                  </div>
                  <div className="text-3xl font-extrabold mt-2 text-gray-900">{metrics.activeStores}</div>
                  <div className="mt-8 text-[10px] text-gray-400 font-bold border-t border-gray-100 pt-2">
                      Basis: Real-time Database
                  </div>
              </div>

               {/* Royalty Card */}
               <div className="bg-white p-6 rounded-2xl shadow-sm border">
                  <div className="flex justify-between items-start">
                      <h3 className="text-sm font-bold text-gray-500">Royalty Revenue</h3>
                      <div className="group/tooltip relative">
                          <Info className="w-4 h-4 text-gray-300 hover:text-gray-600 cursor-help"/>
                          <div className="absolute right-0 top-6 w-48 bg-black text-white text-xs p-2 rounded shadow-lg opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-50">
                              Estimated royalty fees based on store-specific rates applied to this month's sales.
                          </div>
                      </div>
                  </div>
                  <div className="text-3xl font-extrabold mt-2 text-indigo-600">
                      JPY {metrics.totalRoyaltyCurrentMonth.toLocaleString(undefined, {maximumFractionDigits: 0})}
                  </div>
                  <div className="mt-8 text-[10px] text-gray-400 font-bold border-t border-gray-100 pt-2">
                      Basis: Est. for {metrics.currentMonthName} • FX: {fxStatus === 'ok' ? 'Live' : 'Approx.'}
                  </div>
              </div>

               {/* Inventory Card */}
               <div className="bg-white p-6 rounded-2xl shadow-sm border">
                  <div className="flex justify-between items-start">
                      <h3 className="text-sm font-bold text-gray-500">Inventory Alerts</h3>
                      <div className="group/tooltip relative">
                          <Info className="w-4 h-4 text-gray-300 hover:text-gray-600 cursor-help"/>
                          <div className="absolute right-0 top-6 w-48 bg-black text-white text-xs p-2 rounded shadow-lg opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-50">
                              Number of ingredients across all stores predicted to run out within 3 days.
                          </div>
                      </div>
                  </div>
                  <div className="text-3xl font-extrabold mt-2 text-red-500">{metrics.inventoryAlerts}</div>
                  <div className="mt-8 text-[10px] text-gray-400 font-bold border-t border-gray-100 pt-2">
                      Basis: Global Stock Analysis
                  </div>
              </div>
           </div>

           {/* Financials Table */}
           <FinancialsTable stores={stores} sales={sales} fxRates={fxRates} fxStatus={fxStatus} />
           
           {/* Store Grid (Clickable) */}
           <div>
              <h3 className="font-bold text-xl mb-4">Franchise Network</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {stores.map(store => (
                      <div 
                        key={store.id} 
                        onClick={() => setSelectedStore(store)}
                        className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 hover:border-black cursor-pointer transition group"
                      >
                          <div className="flex justify-between items-start mb-2">
                             <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-600 group-hover:bg-black group-hover:text-white transition-colors">
                                {store.country.substring(0, 2).toUpperCase()}
                             </div>
                             {store.royaltyPercentage < 5 && <AlertTriangle className="w-4 h-4 text-orange-500" />}
                          </div>
                          <h4 className="font-bold text-lg">{store.name}</h4>
                          <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
                             <MapPin className="w-3 h-3" /> {store.city}, {store.country}
                          </div>
                          <div className="mt-4 pt-4 border-t flex justify-between items-center text-sm font-medium">
                              <span>View Details</span>
                              <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-black" />
                          </div>
                      </div>
                  ))}
              </div>
           </div>

           {/* Global Supply Chain Overview */}
           <SupplyChainIntelligence stores={stores} sales={sales} menus={menus} ingredients={ingredients} />
       </div>
    </div>
  );
};

const StoreDashboard: React.FC<{
  user: User;
  store: Store;
  onLogout: () => void;
  sales: Sale[];
  menus: Menu[];
  employees: Employee[];
  ingredients: Ingredient[];
  globalConfig: {
      categories: string[];
      standardIngredients: { name: string; unit: string; par?: number; reorder?: number }[];
      positions: string[];
  };
  onAddSale: (sale: Sale) => Promise<void> | void;
  onUpdateMenu: (menu: Menu) => void;
  onCreateMenu: (menu: Menu) => void;
  onDeleteMenu: (id: string) => void;
  onUpdateEmployees: (employees: Employee[]) => void;
  onAddIngredient: (ing: Ingredient) => Promise<void> | void;
}> = ({ user, store, onLogout, sales, menus, employees, ingredients, globalConfig, onAddSale, onUpdateMenu, onCreateMenu, onDeleteMenu, onUpdateEmployees, onAddIngredient }) => {
    const [view, setView] = useState<'dashboard' | 'report' | 'menu' | 'staff'>('dashboard');
    const [reportDate, setReportDate] = useState<string | null>(null);
    const [editingMenu, setEditingMenu] = useState<Menu | null>(null);
    const navReadyRef = useRef(false);
    const navRestoreRef = useRef(false);
    const popLockRef = useRef(false);
    const ownerViewStorageKey = `${OWNER_VIEW_STORAGE_PREFIX}${store.id}`;
    const storeMenus = menus.filter(m => m.storeId === store.id);
    const storeEmployees = employees.filter(e => e.storeId === store.id);
    const storeSales = sales.filter(s => s.storeId === store.id);
    const missingDates = useMemo(() => getMissingDates(sales, store.id, 7), [sales, store.id]);
    const missingDatesAll = useMemo(() => getMissingDates(sales, store.id, 120), [sales, store.id]);
    const missingDateSet = useMemo(() => new Set(missingDatesAll), [missingDatesAll]);
    const submittedDateSet = useMemo(() => new Set(storeSales.map(s => s.date)), [storeSales]);
    const [showMissingCalendar, setShowMissingCalendar] = useState(false);
    const [calendarMonth, setCalendarMonth] = useState(() => {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), 1);
    });

    // Chart Data Preparation
    const salesData = useMemo(() => {
        // Last 7 days
        const data = [];
        const today = new Date();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const dateStr = formatDate(d);
            const sale = storeSales.find(s => s.date === dateStr);
            data.push({
                name: dateStr.slice(5), // MM-DD
                sales: sale ? sale.totalAmount : 0
            });
        }
        return data;
    }, [storeSales]);

    const categoryMonthlyData = useMemo(() => {
        const today = new Date();
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();
        const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;

        const currentCounts: Record<string, number> = {};
        const prevCounts: Record<string, number> = {};
        globalConfig.categories.forEach(c => {
            currentCounts[c] = 0;
            prevCounts[c] = 0;
        });

        storeSales.forEach(sale => {
            const d = new Date(sale.date);
            const month = d.getMonth();
            const year = d.getFullYear();
            let target: Record<string, number> | null = null;
            if (month === currentMonth && year === currentYear) {
                target = currentCounts;
            } else if (month === prevMonth && year === prevYear) {
                target = prevCounts;
            }
            if (!target) return;
            sale.items.forEach(item => {
                const key = item.menuId;
                target[key] = (target[key] || 0) + item.quantity;
            });
        });

        return globalConfig.categories.map(name => ({
            name,
            current: currentCounts[name] || 0,
            previous: prevCounts[name] || 0
        }));
    }, [storeSales, globalConfig.categories]);

    // Comparison Logic (Current Month vs Previous Month)
    const metricComparison = useMemo(() => {
        const today = new Date();
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();
        const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const prevMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

        const currentMonthSales = storeSales
            .filter(s => {
                const d = new Date(s.date);
                return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
            })
            .reduce((acc, curr) => acc + curr.totalAmount, 0);

        const prevMonthSales = storeSales
            .filter(s => {
                const d = new Date(s.date);
                return d.getMonth() === prevMonth && d.getFullYear() === prevMonthYear;
            })
            .reduce((acc, curr) => acc + curr.totalAmount, 0);

        const growth = prevMonthSales > 0 
            ? ((currentMonthSales - prevMonthSales) / prevMonthSales) * 100 
            : 0;

        return { currentMonthSales, growth };
    }, [storeSales]);

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const calendarCells = useMemo(() => {
        const year = calendarMonth.getFullYear();
        const month = calendarMonth.getMonth();
        const start = new Date(year, month, 1);
        const end = new Date(year, month + 1, 0);
        const startWeekday = start.getDay();
        const daysInMonth = end.getDate();
        const cells: Array<string | null> = [];

        for (let i = 0; i < startWeekday; i++) cells.push(null);
        for (let day = 1; day <= daysInMonth; day++) {
            const d = new Date(year, month, day);
            cells.push(formatDate(d));
        }
        return cells;
    }, [calendarMonth]);

    const today = new Date();
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const canGoNextMonth = calendarMonth.getTime() < currentMonthStart.getTime();

    const goPrevMonth = () => {
        setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    };

    const goNextMonth = () => {
        if (!canGoNextMonth) return;
        setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    };

    useEffect(() => {
        if (typeof window === 'undefined' || navRestoreRef.current) return;
        const historyState = window.history.state;
        const fromHistory = historyState?.screen === 'owner'
            ? {
                view: (historyState.view as 'dashboard' | 'report' | 'menu' | 'staff' | undefined) ?? 'dashboard',
                reportDate: (historyState.reportDate as string | null | undefined) ?? null,
            }
            : null;
        const fromStorage = safeParseJson<{ view?: 'dashboard' | 'report' | 'menu' | 'staff'; reportDate?: string | null }>(
            window.localStorage.getItem(ownerViewStorageKey)
        );

        const restoredView = fromHistory?.view ?? fromStorage?.view ?? 'dashboard';
        const restoredReportDate = fromHistory?.reportDate ?? fromStorage?.reportDate ?? null;

        setView(restoredView);
        setReportDate(restoredReportDate);
        window.history.replaceState({ screen: 'owner', view: restoredView, reportDate: restoredReportDate }, '');
        navReadyRef.current = true;
        navRestoreRef.current = true;
    }, [ownerViewStorageKey]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(ownerViewStorageKey, JSON.stringify({ view, reportDate }));
    }, [ownerViewStorageKey, view, reportDate]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!navReadyRef.current) return;
        if (popLockRef.current) {
            popLockRef.current = false;
            return;
        }
        window.history.pushState({ screen: 'owner', view, reportDate }, '');
    }, [view, reportDate]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onPopState = (e: PopStateEvent) => {
            const state = e.state;
            if (!state || state.screen !== 'owner') {
                window.history.pushState({ screen: 'owner', view, reportDate }, '');
                return;
            }
            popLockRef.current = true;
            setReportDate(state.reportDate ?? null);
            setView(state.view ?? 'dashboard');
            setEditingMenu(null);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [view, reportDate]);

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {editingMenu && (
                <RecipeEditor 
                    menu={editingMenu}
                    ingredients={ingredients}
                    categories={globalConfig.categories}
                    standardIngredients={globalConfig.standardIngredients}
                    onAddIngredient={onAddIngredient}
                    onSave={async (updatedMenu) => {
                        await Promise.resolve(onUpdateMenu(updatedMenu));
                        setEditingMenu(null);
                    }}
                    onBack={() => setEditingMenu(null)}
                />
            )}

            {showMissingCalendar && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
                        <div className="flex items-center justify-between px-6 pt-5">
                            <div className="font-extrabold text-lg">Missing Reports Calendar</div>
                            <button
                                type="button"
                                onClick={() => setShowMissingCalendar(false)}
                                className="p-2 rounded-full hover:bg-gray-100 transition"
                            >
                                <X className="w-5 h-5 text-gray-500" />
                            </button>
                        </div>
                        <div className="px-6 pb-6">
                            <div className="flex items-center justify-between mt-3 mb-4">
                                <button
                                    type="button"
                                    onClick={goPrevMonth}
                                    className="px-3 py-1 rounded-lg border border-gray-200 text-sm font-semibold hover:bg-gray-50 transition"
                                >
                                    Prev
                                </button>
                                <div className="font-semibold text-sm">
                                    {monthNames[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}
                                </div>
                                <button
                                    type="button"
                                    onClick={goNextMonth}
                                    disabled={!canGoNextMonth}
                                    className="px-3 py-1 rounded-lg border border-gray-200 text-sm font-semibold disabled:opacity-50 hover:bg-gray-50 transition"
                                >
                                    Next
                                </button>
                            </div>

                            <div className="grid grid-cols-7 gap-2 text-xs text-gray-400 mb-2">
                                <div>Sun</div>
                                <div>Mon</div>
                                <div>Tue</div>
                                <div>Wed</div>
                                <div>Thu</div>
                                <div>Fri</div>
                                <div>Sat</div>
                            </div>

                            <div className="grid grid-cols-7 gap-2">
                                {calendarCells.map((dateStr, idx) => {
                                    if (!dateStr) {
                                        return <div key={`empty-${idx}`} />;
                                    }
                                    const isMissing = missingDateSet.has(dateStr);
                                    const isSubmitted = submittedDateSet.has(dateStr);
                                    const isFuture = new Date(dateStr) > today;
                                    return (
                                        <button
                                            key={dateStr}
                                            type="button"
                                            disabled={isFuture}
                                            onClick={() => {
                                                if (!isMissing) return;
                                                setReportDate(dateStr);
                                                setView('report');
                                                setShowMissingCalendar(false);
                                            }}
                                            className={`h-9 rounded-lg text-xs font-semibold border transition ${
                                                isMissing
                                                    ? 'bg-red-100 border-red-300 text-red-700 hover:bg-red-200'
                                                    : isSubmitted
                                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                                        : 'bg-white border-gray-200 text-gray-500'
                                            } ${isFuture ? 'opacity-40 cursor-not-allowed' : ''}`}
                                            title={isMissing ? 'Missing report' : (isSubmitted ? 'Submitted' : 'No report')}
                                        >
                                            {dateStr.slice(8)}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="mt-4 flex items-center gap-3 text-xs text-gray-500">
                                <div className="flex items-center gap-1">
                                    <span className="inline-block w-3 h-3 rounded bg-red-100 border border-red-300" />
                                    Missing
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="inline-block w-3 h-3 rounded bg-emerald-50 border border-emerald-200" />
                                    Submitted
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            
            <div className="bg-white border-b px-6 py-4 flex justify-between items-center sticky top-0 z-40">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center font-bold text-lg shadow-lg shadow-indigo-200">
                        {store.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                        <h1 className="text-xl font-extrabold tracking-tight text-gray-900">{store.name}</h1>
                        <div className="text-xs text-gray-500 font-medium">{store.city}, {store.country}</div>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                     <div className="text-right hidden md:block">
                        <div className="font-bold text-sm">{user.name}</div>
                        <div className="text-xs text-gray-500">Store Manager</div>
                     </div>
                    <button onClick={onLogout} className="p-2 hover:bg-gray-100 rounded-full transition"><LogOut className="w-5 h-5 text-gray-600" /></button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <div className="w-64 bg-white border-r hidden md:flex flex-col p-4">
                    <div className="space-y-1">
                        <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={LayoutDashboard} label="Overview" />
                        <NavButton active={view === 'report'} onClick={() => { setReportDate(null); setView('report'); }} icon={FileText} label="Daily Report" />
                        <NavButton active={view === 'menu'} onClick={() => setView('menu')} icon={UtensilsCrossed} label="Menu" />
                        <NavButton active={view === 'staff'} onClick={() => setView('staff')} icon={Users} label="Staff" />
                    </div>
                    <div className="mt-auto p-4 bg-gray-50 rounded-xl">
                        <div className="text-xs font-bold text-gray-500 mb-2 uppercase">Your Performance</div>
                        <div className="text-2xl font-extrabold text-gray-900">94%</div>
                        <div className="text-xs text-gray-400 mt-1">Operational Score</div>
                    </div>
                </div>

                {/* Mobile Nav */}
                <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t p-2 flex justify-around z-50">
                    <button onClick={() => setView('dashboard')} className={`p-3 rounded-xl ${view === 'dashboard' ? 'text-black bg-gray-100' : 'text-gray-400'}`}><LayoutDashboard className="w-6 h-6"/></button>
                    <button onClick={() => { setReportDate(null); setView('report'); }} className={`p-3 rounded-xl ${view === 'report' ? 'text-black bg-gray-100' : 'text-gray-400'}`}><FileText className="w-6 h-6"/></button>
                    <button onClick={() => setView('menu')} className={`p-3 rounded-xl ${view === 'menu' ? 'text-black bg-gray-100' : 'text-gray-400'}`}><UtensilsCrossed className="w-6 h-6"/></button>
                    <button onClick={() => setView('staff')} className={`p-3 rounded-xl ${view === 'staff' ? 'text-black bg-gray-100' : 'text-gray-400'}`}><Users className="w-6 h-6"/></button>
                </div>

                {/* Main Content */}
                <div className="flex-1 overflow-y-auto p-6 md:p-8 pb-24 md:pb-8">
                    {view === 'dashboard' && (
                        <div className="space-y-6">
                            {/* Missing Report Alert */}
                            {missingDates.length > 0 && (
                                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-xl flex items-start gap-3 shadow-sm animate-pulse">
                                    <div className="p-2 bg-white rounded-full text-red-500 shadow-sm">
                                        <CalendarX className="w-6 h-6"/>
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-red-800 text-lg">Action Required: Missing Sales Reports</h3>
                                        <p className="text-sm text-red-600 mb-2">You have not submitted daily reports for the following dates. Please submit them immediately to maintain compliance.</p>
                                        <div className="flex flex-wrap gap-2">
                                          {missingDates.map(d => (
  <button
    key={d}
    type="button"
    onClick={() => { setReportDate(d); setView('report'); }}
    className="px-2 py-1 bg-red-200 text-red-800 text-xs font-bold rounded hover:bg-red-300 transition"
  >
    {d}
  </button>
))}

                                          <button
                                            type="button"
                                            onClick={() => {
                                              setCalendarMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
                                              setShowMissingCalendar(true);
                                            }}
                                            className="px-2 py-1 bg-white text-red-700 text-xs font-bold rounded border border-red-200 hover:bg-red-50 transition"
                                          >
                                            View Older Dates
                                          </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <h2 className="text-2xl font-bold">Store Overview</h2>
                             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="bg-white p-6 rounded-2xl shadow-sm border relative overflow-hidden group">
                                    <div className="text-sm font-bold text-gray-500 mb-1">Total Sales (Month)</div>
                                    <div className="text-3xl font-extrabold flex items-baseline gap-2">
                                        {store.currency} {metricComparison.currentMonthSales.toLocaleString()}
                                    </div>
                                    <div className={`flex items-center gap-1 text-xs font-bold mt-2 ${metricComparison.growth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                        {metricComparison.growth >= 0 ? <ArrowUpRight className="w-4 h-4"/> : <ArrowDownRight className="w-4 h-4"/>}
                                        {Math.abs(metricComparison.growth).toFixed(1)}% vs Last Month
                                    </div>
                                    <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                        <TrendingUp className="w-24 h-24 text-black"/>
                                    </div>
                                </div>
                                <div className="bg-white p-6 rounded-2xl shadow-sm border">
                                    <div className="text-sm font-bold text-gray-500 mb-1">Active Menu Items</div>
                                    <div className="text-3xl font-extrabold">{storeMenus.length}</div>
                                    <div className="text-xs text-gray-400 font-medium mt-2">Ready to serve</div>
                                </div>
                                <div className="bg-white p-6 rounded-2xl shadow-sm border">
                                    <div className="text-sm font-bold text-gray-500 mb-1">Staff Count</div>
                                    <div className="text-3xl font-extrabold">{storeEmployees.length}</div>
                                    <div className="text-xs text-gray-400 font-medium mt-2">Active employees</div>
                                </div>
                             </div>

                             {/* Sales Charts */}
                             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                 <div className="bg-white p-6 rounded-2xl shadow-sm border h-80">
                                     <div className="flex justify-between items-center mb-4">
                                         <h3 className="font-bold text-lg">Weekly Revenue Trend</h3>
                                         <span className="text-xs font-bold bg-green-100 text-green-700 px-2 py-1 rounded-full">+12% vs Last Week</span>
                                     </div>
                                     <ResponsiveContainer width="100%" height="100%">
                                         <BarChart data={salesData} margin={{top:0, bottom: 30}}>
                                             <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                                             <XAxis dataKey="name" tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                                             <YAxis tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                                             <Tooltip 
                                                cursor={{fill: '#f9fafb'}}
                                                contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                                             />
                                             <Bar dataKey="sales" fill="black" radius={[4, 4, 0, 0]} barSize={30} />
                                         </BarChart>
                                     </ResponsiveContainer>
                                 </div>
                                 <div className="bg-white p-6 rounded-2xl shadow-sm border h-80">
                                     <h3 className="font-bold text-lg mb-4">Category Sales (This Month vs Last Month)</h3>
                                     <ResponsiveContainer width="100%" height="100%">
                                         <BarChart data={categoryMonthlyData} margin={{ top: 0, right: 10, left: 0, bottom: 30 }}>
                                             <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                                             <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                                             <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                                             <Tooltip 
                                                cursor={{ fill: '#f9fafb' }}
                                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                             />
                                             <Legend verticalAlign="bottom" height={36} />
                                             <Bar dataKey="current" name="This Month" fill="black" radius={[4, 4, 0, 0]} />
                                             <Bar dataKey="previous" name="Last Month" fill="#999999" radius={[4, 4, 0, 0]} />
                                         </BarChart>
                                     </ResponsiveContainer>
                                 </div>
                             </div>
                             
                             <div className="bg-white p-6 rounded-2xl shadow-sm border">
                                <h3 className="font-bold text-lg mb-4">Recent Daily Reports</h3>
                                <div className="space-y-2">
                                    {storeSales.slice(0, 5).map(sale => (
                                        <div key={sale.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                                            <div className="font-medium">{sale.date}</div>
                                            <div className="font-bold">{sale.isClosed ? 'Closed' : `${store.currency} ${sale.totalAmount.toLocaleString()}`}</div>
                                        </div>
                                    ))}
                                    {storeSales.length === 0 && <div className="text-gray-400 text-sm">No reports yet.</div>}
                                </div>
                             </div>
                        </div>
                    )}

                    {view === 'report' && (
                      <SalesReporter 
  store={store}
  sales={sales}
  menus={storeMenus}
  categories={globalConfig.categories}
  initialDate={reportDate}
  onSave={async (sale) => {
    await Promise.resolve(onAddSale(sale));
    setReportDate(null);
    setView('dashboard');
  }}
  onCancel={() => {
    setReportDate(null);
    setView('dashboard');
  }}
/>

                    )}

                    {view === 'menu' && (
                        <MenuManager 
                            store={store}
                            menus={storeMenus}
                            onEdit={setEditingMenu}
                            onCreate={(menu) => setEditingMenu(menu)}
                            onDelete={onDeleteMenu}
                        />
                    )}

                    {view === 'staff' && (
                        <EmployeeManager 
                            store={store}
                            employees={storeEmployees}
                            positions={globalConfig.positions}
                            onUpdate={(emps) => onUpdateEmployees(emps)}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

const LoginScreen: React.FC = () => {
    const [loginError, setLoginError] = useState<string | null>(null);

    const CompanyLogo = () => (
        <div
            className="relative w-52 h-36 bg-black rounded-xl mb-6 flex flex-col items-center justify-center select-none"
            aria-label="CHIBO logo"
        >
            <span className="text-white text-6xl font-black leading-none tracking-tight">千房</span>
            <div className="text-white text-2xl font-black leading-none mt-1 tracking-wider">CHIBO</div>
            <div className="text-white text-sm font-bold leading-none tracking-[0.22em] mt-1">OKONOMIYAKI</div>
        </div>
    );

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
            <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
                <div className="flex flex-col items-center text-center">
                    <CompanyLogo />
                    <h1 className="text-2xl font-extrabold text-gray-900 mb-2">CHIBO</h1>
                    <p className="text-gray-500 mb-8">Global Franchise Manager</p>

                    <button
                        onClick={async () => {
                            try {
                                setLoginError(null);
                                await signInWithGoogle();
                            } catch (e: any) {
                                console.error('Login failed', e);
                                setLoginError(e?.message ?? 'Login failed. Check OAuth settings.');
                            }
                        }}
                        className="w-full inline-flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition font-semibold"
                    >
                        <span className="text-lg">G</span>
                        Continue with Google
                    </button>

                    {loginError && (
                        <div className="mt-4 text-xs text-red-600">{loginError}</div>
                    )}

                    <p className="text-xs text-gray-400 mt-6 leading-relaxed">
                        Access is restricted for unauthorized accounts after login.
                    </p>
                </div>
            </div>
        </div>
    );
};



const OnboardingScreen: React.FC<{
  onDone: () => Promise<void>;
  globalConfig: {
    storeNames: string[];
    countries: string[];
    cities: string[];
    currencies: string[];
  };
  globalConfigStatus: GlobalConfigLoadState;
  globalConfigError: string | null;
  onReload: () => void;
}> = ({ onDone, globalConfig, globalConfigStatus, globalConfigError, onReload }) => {

  const [name, setName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [country, setCountry] = useState('South Korea');
  const [city, setCity] = useState('Seoul');
  const [currency, setCurrency] = useState('JPY');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configReady = globalConfigStatus === 'loaded';

  useEffect(() => {
    if (!configReady) return;
    if (globalConfig.countries.length > 0 && !globalConfig.countries.includes(country)) {
      setCountry(globalConfig.countries[0]);
    }
    if (globalConfig.cities.length > 0 && !globalConfig.cities.includes(city)) {
      setCity(globalConfig.cities[0]);
    }
    if (globalConfig.currencies.length > 0 && !globalConfig.currencies.includes(currency)) {
      setCurrency(globalConfig.currencies[0]);
    }
  }, [configReady, globalConfig, country, city, currency]);

  const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => {
        reject(new Error(`${label} timeout`));
      }, ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  };

  const submit = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!storeName || !country || !city || !currency) {
        setError('Please select store name, country, city, and currency.');
        setLoading(false);
        return;
      }

      const { data: authData } = await withTimeout(
        supabase.auth.getUser(),
        8000,
        'Get session'
      );
      const email = authData.user?.email;
      if (!email) throw new Error('No email in session');

      // 0) Check for existing store with same selections (RPC bypasses RLS)
      const { data: existingRows, error: existingErr } = await withTimeout(
        supabase.rpc('find_store_for_onboarding', {
          p_name: storeName,
          p_country: country,
          p_city: city,
          p_currency: currency,
        }),
        10000,
        'Find store'
      );
      if (existingErr) throw existingErr;
      const existingStoreId = Array.isArray(existingRows) ? existingRows[0]?.id : null;

      if (existingStoreId) {
        // Join existing store
        await withTimeout(
          upsertMyOwnerProfile({ name: name || email, email, storeId: existingStoreId }),
          10000,
          'Join existing store'
        );
        await withTimeout(onDone(), 12000, 'Sync data');
        return;
      }

      const storeId = `S_${crypto.randomUUID()}`;

      // 1) Create owner profile first so RLS allows store insert (current_store_id matches)
      await withTimeout(
        upsertMyOwnerProfile({ name: name || email, email, storeId }),
        10000,
        'Create owner profile'
      );

      // 2) Create store record
      const { error: storeErr } = await withTimeout(
        supabase.from('stores').insert({
          id: storeId,
          name: storeName,
          country,
          city,
          owner_email: email,
          currency,
        }),
        10000,
        'Create store'
      );

      if (storeErr) {
        // rollback store_id on failure to avoid dangling reference
        await supabase.from('app_users').update({ store_id: null }).eq('user_id', authData.user?.id);
        throw storeErr;
      }

      await withTimeout(onDone(), 12000, 'Sync data');
    } catch (e: any) {
      console.error('Onboarding failed', e);
      setError(e?.message ?? 'Failed to onboard');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-xl">
        <div className="text-2xl font-extrabold mb-2">Initial Setup</div>
        <div className="text-gray-500 mb-6">Create your OWNER profile and store.</div>

        {globalConfigStatus !== 'loaded' && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 flex items-center justify-between gap-3">
            <span>
              {globalConfigStatus === 'loading'
                ? 'Loading global settings...'
                : (globalConfigError ?? 'Failed to load global settings.')}
            </span>
            <button
              type="button"
              onClick={onReload}
              className="px-3 py-1 rounded-lg border border-amber-300 bg-white text-amber-700 font-semibold hover:bg-amber-100 transition"
            >
              Retry
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-semibold text-gray-700">Display Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200" placeholder="e.g. Keito Kimura" />
          </div>
          <div>
            <label className="text-sm font-semibold text-gray-700">Store Name</label>
          <select value={storeName} onChange={(e) => setStoreName(e.target.value)} disabled={!configReady} className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 disabled:opacity-50">
  <option value="">Select approved name...</option>
  {globalConfig.storeNames.map(name => (
    <option key={name} value={name}>{name}</option>
  ))}
</select>

<select value={country} onChange={(e) => setCountry(e.target.value)} disabled={!configReady} className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 disabled:opacity-50">
  <option value="">Select Country</option>
  {globalConfig.countries.map(c => (
    <option key={c} value={c}>{c}</option>
  ))}
</select>

<select value={city} onChange={(e) => setCity(e.target.value)} disabled={!configReady} className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 disabled:opacity-50">
  <option value="">Select City</option>
  {globalConfig.cities.map(c => (
    <option key={c} value={c}>{c}</option>
  ))}
</select>

<select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!configReady} className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 disabled:opacity-50">
  <option value="">Select Currency</option>
  {globalConfig.currencies.map(c => (
    <option key={c} value={c}>{c}</option>
  ))}
</select>

          </div>
          
        </div>

        {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

        <div className="mt-6 flex gap-3">
          <button onClick={submit} disabled={loading || !storeName || !configReady} className="px-4 py-2 rounded-xl bg-black text-white font-semibold disabled:opacity-50">
            {loading ? 'Creating...' : 'Create'}
          </button>
          <button onClick={() => signOut()} className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 transition font-semibold">
            Sign Out
          </button>
        </div>

        <div className="mt-6 text-xs text-gray-400 leading-relaxed">
          For HQ accounts, manually registering role=HQ in app_users is the most stable method.
        </div>
      </div>
    </div>
  );
};


const App = () => {
  const [user, setUser] = useState<User | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = 'en';
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const email = data.session?.user?.email ?? null;
      setSessionEmail(email);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      const email = s?.user?.email ?? null;
      setSessionEmail(email);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  
  // Data State
  const [stores, setStores] = useState<Store[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [storeStocks, setStoreStocks] = useState<StoreIngredientStock[]>([]);

  const [dataLoading, setDataLoading] = useState<boolean>(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [salesLookbackDays, setSalesLookbackDays] = useState<number>(SALES_LOOKBACK_DEFAULT_DAYS);
  const salesLookbackRef = useRef<number>(SALES_LOOKBACK_DEFAULT_DAYS);
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig>(DEFAULT_GLOBAL_CONFIG);
  const [globalConfigExists, setGlobalConfigExists] = useState<boolean>(false);
  const [globalConfigStatus, setGlobalConfigStatus] = useState<GlobalConfigLoadState>('loading');
  const [globalConfigError, setGlobalConfigError] = useState<string | null>(null);
  const [syncingIngredients, setSyncingIngredients] = useState(false);

  useEffect(() => {
    salesLookbackRef.current = salesLookbackDays;
  }, [salesLookbackDays]);


  const refreshTimerRef = useRef<number | null>(null);
  const refreshInFlightRef = useRef<boolean>(false);
  const refreshQueuedRef = useRef<boolean>(false);
  const partialTimerRef = useRef<number | null>(null);
  const partialQueueRef = useRef<Set<RefreshScope>>(new Set());
  const realtimeSubscribedRef = useRef<boolean>(false);
  const legacyMediaMigrationStartedRef = useRef<boolean>(false);
  const scopeMutationRef = useRef<ScopeMutationCounter>(createInitialScopeMutationCounter());

  const beginScopeMutation = useCallback((scopes: RefreshScope[]) => {
    scopes.forEach((scope) => {
      scopeMutationRef.current[scope] += 1;
    });
  }, []);

  const endScopeMutation = useCallback((scopes: RefreshScope[]) => {
    scopes.forEach((scope) => {
      scopeMutationRef.current[scope] = Math.max(0, scopeMutationRef.current[scope] - 1);
    });
  }, []);

  const takeScopeMutationSnapshot = useCallback((): ScopeMutationCounter => {
    return { ...scopeMutationRef.current };
  }, []);

  const canApplyScopeResult = useCallback((scope: RefreshScope, snapshot: ScopeMutationCounter): boolean => {
    return scopeMutationRef.current[scope] === snapshot[scope];
  }, []);

  const refreshAll = useCallback(async () => {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }
    refreshInFlightRef.current = true;
    setDataLoading(true);
    setDataError(null);
    setGlobalConfigError(null);
    setGlobalConfigStatus((prev) => (prev === 'loaded' ? prev : 'loading'));
    const scopeSnapshot = takeScopeMutationSnapshot();

    const results = await Promise.allSettled([
      loadStores(),
      loadIngredients(),
      loadEmployees(),
      loadMenus(),
      loadSales(salesLookbackRef.current),
      loadStoreIngredientStocks(),
      loadGlobalConfig(),
    ]);

    const errors: string[] = [];

    const stRes = results[0];
    if (stRes.status === 'fulfilled' && canApplyScopeResult('stores', scopeSnapshot)) {
      setStores(stRes.value);
    } else {
      errors.push(stRes.reason?.message ?? 'Failed to load stores');
    }

    const ingRes = results[1];
    if (ingRes.status === 'fulfilled' && canApplyScopeResult('ingredients', scopeSnapshot)) {
      setIngredients(ingRes.value);
    } else {
      errors.push(ingRes.reason?.message ?? 'Failed to load ingredients');
    }

    const empRes = results[2];
    if (empRes.status === 'fulfilled' && canApplyScopeResult('employees', scopeSnapshot)) {
      setEmployees(empRes.value);
    } else {
      errors.push(empRes.reason?.message ?? 'Failed to load employees');
    }

    const mnRes = results[3];
    if (mnRes.status === 'fulfilled' && canApplyScopeResult('menus', scopeSnapshot)) {
      setMenus(mnRes.value);
    } else {
      errors.push(mnRes.reason?.message ?? 'Failed to load menus');
    }

    const slRes = results[4];
    if (slRes.status === 'fulfilled' && canApplyScopeResult('sales', scopeSnapshot)) {
      setSales(slRes.value);
    } else {
      errors.push(slRes.reason?.message ?? 'Failed to load sales');
    }

    const ssRes = results[5];
    if (ssRes.status === 'fulfilled' && canApplyScopeResult('storeStocks', scopeSnapshot)) {
      setStoreStocks(ssRes.value);
    } else {
      errors.push(ssRes.reason?.message ?? 'Failed to load store stock');
    }

    const gcRes = results[6];
    if (gcRes.status === 'fulfilled' && canApplyScopeResult('globalConfig', scopeSnapshot)) {
      const gc = gcRes.value;
      if (gc.exists === null) {
        setGlobalConfigStatus('error');
        setGlobalConfigError('Failed to load global settings.');
      } else {
        setGlobalConfig(gc.config);
        setGlobalConfigExists(gc.exists);
        setGlobalConfigStatus('loaded');
      }
    } else if (gcRes.status !== 'fulfilled') {
      setGlobalConfigStatus('error');
      setGlobalConfigError(gcRes.reason?.message ?? 'Failed to load global settings.');
    }

    if (errors.length > 0) {
      setDataError(errors[0]);
    }

    setDataLoading(false);
    refreshInFlightRef.current = false;
    if (refreshQueuedRef.current) {
      refreshQueuedRef.current = false;
      window.setTimeout(() => {
        refreshAll();
      }, 50);
    }
  }, [canApplyScopeResult, takeScopeMutationSnapshot]);

  const refreshPartial = useCallback(async (scopes: Set<RefreshScope>) => {
    if (scopes.size === 0) return;
    const errors: string[] = [];
    setDataError(null);
    const scopeSnapshot = takeScopeMutationSnapshot();

    if (scopes.has('globalConfig')) {
      setGlobalConfigError(null);
      setGlobalConfigStatus((prev) => (prev === 'loaded' ? prev : 'loading'));
    }

    const tasks: Promise<void>[] = [];

    if (scopes.has('stores')) {
      tasks.push(loadStores().then((rows) => { if (canApplyScopeResult('stores', scopeSnapshot)) setStores(rows); }).catch(e => errors.push(e?.message ?? 'Failed to load stores')));
    }
    if (scopes.has('ingredients')) {
      tasks.push(loadIngredients().then((rows) => { if (canApplyScopeResult('ingredients', scopeSnapshot)) setIngredients(rows); }).catch(e => errors.push(e?.message ?? 'Failed to load ingredients')));
    }
    if (scopes.has('employees')) {
      tasks.push(loadEmployees().then((rows) => { if (canApplyScopeResult('employees', scopeSnapshot)) setEmployees(rows); }).catch(e => errors.push(e?.message ?? 'Failed to load employees')));
    }
    if (scopes.has('menus')) {
      tasks.push(loadMenus().then((rows) => { if (canApplyScopeResult('menus', scopeSnapshot)) setMenus(rows); }).catch(e => errors.push(e?.message ?? 'Failed to load menus')));
    }
    if (scopes.has('sales')) {
      tasks.push(loadSales(salesLookbackRef.current).then((rows) => { if (canApplyScopeResult('sales', scopeSnapshot)) setSales(rows); }).catch(e => errors.push(e?.message ?? 'Failed to load sales')));
    }
    if (scopes.has('storeStocks')) {
      tasks.push(loadStoreIngredientStocks().then((rows) => { if (canApplyScopeResult('storeStocks', scopeSnapshot)) setStoreStocks(rows); }).catch(e => errors.push(e?.message ?? 'Failed to load store stock')));
    }
    if (scopes.has('globalConfig')) {
      tasks.push(
        loadGlobalConfig()
          .then((gc) => {
            if (!canApplyScopeResult('globalConfig', scopeSnapshot)) return;
            if (gc.exists === null) {
              setGlobalConfigStatus('error');
              setGlobalConfigError('Failed to load global settings.');
            } else {
              setGlobalConfig(gc.config);
              setGlobalConfigExists(gc.exists);
              setGlobalConfigStatus('loaded');
            }
          })
          .catch((e) => {
            setGlobalConfigStatus('error');
            setGlobalConfigError(e?.message ?? 'Failed to load global settings.');
          })
      );
    }

    if (tasks.length > 0) {
      await Promise.allSettled(tasks);
    }

    if (errors.length > 0) {
      setDataError(errors[0]);
    }
  }, [canApplyScopeResult, takeScopeMutationSnapshot]);

  const drainPartialQueue = useCallback(() => {
    if (partialQueueRef.current.size === 0) return;
    if (refreshInFlightRef.current) {
      partialTimerRef.current = window.setTimeout(drainPartialQueue, 400);
      return;
    }
    const scopes = new Set(partialQueueRef.current);
    partialQueueRef.current.clear();
    refreshInFlightRef.current = true;
    refreshPartial(scopes).finally(() => {
      refreshInFlightRef.current = false;
      if (partialQueueRef.current.size > 0) {
        drainPartialQueue();
      }
    });
  }, [refreshPartial]);

  const schedulePartialRefresh = useCallback((scopes: RefreshScope[]) => {
    scopes.forEach(s => partialQueueRef.current.add(s));
    if (partialTimerRef.current !== null) return;
    partialTimerRef.current = window.setTimeout(() => {
      partialTimerRef.current = null;
      drainPartialQueue();
    }, 350);
  }, [drainPartialQueue]);

  const salesLookbackLabel = useMemo(() => formatLookbackLabel(salesLookbackDays), [salesLookbackDays]);
  const handleLoadMoreSales = useCallback(() => {
    setSalesLookbackDays(prev => prev + SALES_LOOKBACK_STEP_DAYS);
  }, []);

  const ensureStandardIngredients = useCallback(async () => {
    if (user?.role !== UserRole.HQ) return;
    if (globalConfigStatus !== 'loaded') return;
    if (syncingIngredients) return;
    const existingKeys = new Set(
      ingredients.map(i => `${i.name.toLowerCase()}::${i.unit.toLowerCase()}`)
    );
    const makeIngredientId = () => {
      if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `I_${crypto.randomUUID()}`;
      }
      return `I_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    };
    const toInsert = globalConfig.standardIngredients
      .filter(si => !existingKeys.has(`${si.name.toLowerCase()}::${si.unit.toLowerCase()}`))
      .map(si => ({
        id: makeIngredientId(),
        name: si.name,
        unit: si.unit,
      }));
    if (toInsert.length === 0) return;
    try {
      setSyncingIngredients(true);
      const { error } = await supabase.from('ingredients').insert(toInsert);
      if (error) throw error;
      await refreshAll();
    } catch (e) {
      console.error('Failed to sync standard ingredients', e);
    } finally {
      setSyncingIngredients(false);
    }
  }, [user, globalConfigStatus, globalConfig.standardIngredients, ingredients, syncingIngredients, refreshAll]);

  const migrateLegacyBase64MediaOnce = useCallback(async () => {
    if (legacyMediaMigrationStartedRef.current) return;
    legacyMediaMigrationStartedRef.current = true;

    const legacyMenus = menus
      .filter((m) => Boolean(m.imageUrl) && isDataUrl(String(m.imageUrl)))
      .slice(0, LEGACY_MEDIA_MIGRATION_LIMIT);
    const legacyEmployees = employees
      .filter((e) => Boolean(e.imageUrl) && isDataUrl(String(e.imageUrl)))
      .slice(0, LEGACY_MEDIA_MIGRATION_LIMIT);

    if (legacyMenus.length === 0 && legacyEmployees.length === 0) return;

    let migrated = 0;

    for (const menu of legacyMenus) {
      try {
        const imageRef = String(menu.imageUrl ?? '');
        const path = await uploadStoreEntityImage(menu.storeId, 'menu', menu.id, imageRef);
        const { error } = await supabase
          .from('menus')
          .update({ image_url: path })
          .eq('id', menu.id)
          .eq('store_id', menu.storeId);
        if (error) throw error;
        migrated += 1;
      } catch (e) {
        console.error('Failed to migrate legacy menu image', menu.id, e);
      }
    }

    for (const employee of legacyEmployees) {
      try {
        const imageRef = String(employee.imageUrl ?? '');
        const path = await uploadStoreEntityImage(employee.storeId, 'staff', employee.id, imageRef);
        const { error } = await supabase
          .from('employees')
          .update({ image_url: path })
          .eq('id', employee.id)
          .eq('store_id', employee.storeId);
        if (error) throw error;
        migrated += 1;
      } catch (e) {
        console.error('Failed to migrate legacy staff image', employee.id, e);
      }
    }

    if (migrated > 0) {
      schedulePartialRefresh(['menus', 'employees']);
    }
  }, [menus, employees, schedulePartialRefresh]);

  const scheduleRefreshAll = useCallback(() => {
    if (!sessionEmail) return;
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshAll();
    }, 800);
  }, [sessionEmail, refreshAll]);

  const updateEmployeesForStore = useCallback(async (storeId: string, emps: Employee[]) => {
    beginScopeMutation(['employees']);
    const normalized = emps.map(e => ({ ...e, storeId }));
    const previousForStore = employees.filter((e) => e.storeId === storeId);
    const removedIds = previousForStore
      .map((e) => e.id)
      .filter((id) => !normalized.some((n) => n.id === id));
    setEmployees(prev => [
      ...prev.filter(e => e.storeId !== storeId),
      ...normalized
    ]);
    try {
      await saveEmployees(storeId, normalized, removedIds);
    } catch (e) {
      console.error('Failed to save employees', e);
      await refreshAll();
      throw e;
    } finally {
      endScopeMutation(['employees']);
      schedulePartialRefresh(['employees']);
    }
  }, [beginScopeMutation, employees, endScopeMutation, refreshAll, schedulePartialRefresh]);

  useEffect(() => {
    if (sessionEmail) {
      refreshAll();
    }
  }, [sessionEmail, refreshAll]);

  useEffect(() => {
    if (!sessionEmail) {
      legacyMediaMigrationStartedRef.current = false;
      return;
    }
    if (dataLoading) return;
    if (menus.length === 0 && employees.length === 0) return;
    void migrateLegacyBase64MediaOnce();
  }, [sessionEmail, dataLoading, menus, employees, migrateLegacyBase64MediaOnce]);

  useEffect(() => {
    if (!sessionEmail) return;
    schedulePartialRefresh(['sales']);
  }, [salesLookbackDays, sessionEmail, schedulePartialRefresh]);

  useEffect(() => {
    if (!sessionEmail) return;
    const channel = supabase
      .channel('realtime-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores' }, () => schedulePartialRefresh(['stores']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => schedulePartialRefresh(['sales']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_items' }, () => schedulePartialRefresh(['sales']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menus' }, () => schedulePartialRefresh(['menus']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_recipe_items' }, () => schedulePartialRefresh(['menus']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => schedulePartialRefresh(['employees']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredients' }, () => schedulePartialRefresh(['ingredients']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_ingredient_stock' }, () => schedulePartialRefresh(['storeStocks']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_users' }, () => scheduleRefreshAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'global_config' }, () => schedulePartialRefresh(['globalConfig']));

    channel.subscribe((status) => {
      realtimeSubscribedRef.current = status === 'SUBSCRIBED';
    });

    return () => {
      realtimeSubscribedRef.current = false;
      supabase.removeChannel(channel);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [sessionEmail, schedulePartialRefresh, scheduleRefreshAll]);

  // Fallback polling keeps critical views fresh if realtime delivery is delayed.
  // Keep this lightweight to avoid continuous full reload pressure on the DB.
  useEffect(() => {
    if (!sessionEmail) return;
    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (realtimeSubscribedRef.current) return;
      schedulePartialRefresh(['sales', 'employees', 'menus', 'storeStocks']);
    }, SALES_FALLBACK_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [sessionEmail, schedulePartialRefresh]);

  useEffect(() => {
    if (!sessionEmail) return;
    const onFocusOrVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      schedulePartialRefresh(['sales', 'employees', 'menus', 'storeStocks']);
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    return () => {
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [sessionEmail, schedulePartialRefresh]);
  

  // Handlers

  
  
  const handleLogout = async () => {
    try {
      await signOut();
    } catch (e) {
      console.error('Sign out failed', e);
    } finally {
      try {
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('sb-')) {
            localStorage.removeItem(key);
          }
        });
      } catch {
        // ignore storage errors
      }
      setResolvedUser(null);
      setSessionEmail(null);
      setUser(null);
    }
  };

 // Map Supabase session email -> app user (DB + HQ override)
const HQ_EMAILS = [
  'chibo.k.kimura@gmail.com',
  'chibo.global.mgsystem@gmail.com',
  // Add HQ emails here
];

const [resolvedUser, setResolvedUser] = useState<User | null>(null);
const [authLoading, setAuthLoading] = useState<boolean>(true);
const [authError, setAuthError] = useState<string | null>(null);

const withTimeout = useCallback(async <T,>(task: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: number | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  try {
    const result = await Promise.race([task, timeoutPromise]);
    return result as T;
  } finally {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  }
}, []);

const loadResolvedUser = async () => {
  if (!sessionEmail) {
    setResolvedUser(null);
    setAuthLoading(false);
    setAuthError(null);
    return;
  }

  const email = sessionEmail.toLowerCase();
  const authTimeoutMs = 12000;

  // 1) If HQ email, auto-assign HQ
  if (HQ_EMAILS.includes(email)) {
    try {
      setAuthLoading(true);
      setAuthError(null);
      await withTimeout(upsertMyHqProfile({ name: 'HQ Admin', email }), authTimeoutMs, 'HQ profile upsert');
    } catch (e) {
      console.error('Failed to upsert HQ profile', e);
    }
    try {
      const row = await withTimeout(getMyAppUser(), authTimeoutMs, 'HQ profile lookup');
      if (!row || row.role !== 'HQ') {
        setResolvedUser(null);
        setAuthError('HQ profile is not active in database. Check app_users role for this account.');
      } else {
        setResolvedUser({
          email: row.email,
          name: row.name || 'HQ Admin',
          role: UserRole.HQ,
          storeId: undefined,
        });
      }
    } catch (e) {
      console.error('Failed to verify HQ profile', e);
      setResolvedUser(null);
      const message = e instanceof Error ? e.message : 'Failed to verify HQ profile.';
      setAuthError(message);
    } finally {
      setAuthLoading(false);
    }
    return;
  }

  try {
    setAuthLoading(true);
    setAuthError(null);
    const row = await withTimeout(getMyAppUser(), authTimeoutMs, 'User profile lookup');
    if (row) {
      setResolvedUser({
        email: row.email,
        name: row.name || row.email,
        role: row.role === 'HQ' ? UserRole.HQ : UserRole.OWNER,
        storeId: row.store_id ?? undefined,
      });
    } else {
      setResolvedUser(null);
    }
  } catch (e) {
    console.error('Failed to load app user', e);
    setResolvedUser(null);
    const message = e instanceof Error ? e.message : 'Failed to verify session.';
    setAuthError(message);
  } finally {
    setAuthLoading(false);
  }
};

useEffect(() => {
  loadResolvedUser();
}, [sessionEmail, withTimeout]);

useEffect(() => {
  setUser(resolvedUser);
}, [resolvedUser]);

useEffect(() => {
  ensureStandardIngredients();
}, [ensureStandardIngredients]);

useEffect(() => {
  if (user?.role !== UserRole.HQ) return;
  if (globalConfigStatus !== 'loaded') return;
  if (globalConfigExists !== false) return;
  saveGlobalConfig(DEFAULT_GLOBAL_CONFIG)
    .then(() => setGlobalConfigExists(true))
    .catch((e) => console.error('Failed to seed global config', e));
}, [user, globalConfigExists, globalConfigStatus]);

const handleUpdateGlobalConfig = async (key: string, values: any) => {
  const next = { ...globalConfig, [key]: values } as GlobalConfig;
  setGlobalConfig(next);
  setGlobalConfigExists(true);
  try {
    await saveGlobalConfig(next);
    if (key === 'standardIngredients') {
      await ensureStandardIngredients();
    }
  } catch (e) {
    console.error('Failed to save global config', e);
  }
};



if (!sessionEmail) return <LoginScreen />;

if (authLoading) {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="text-gray-500 text-sm">Checking session...</div>
        {authError && <div className="mt-2 text-xs text-red-600">{authError}</div>}
      </div>
    </div>
  );
}

if (!resolvedUser) {
  if (authError) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          <h2 className="text-xl font-bold text-gray-900">Database Connection Error</h2>
          <p className="mt-2 text-sm text-gray-600">
            Could not verify your account profile because the database request timed out.
          </p>
          <div className="mt-3 text-xs text-red-600 break-words">{authError}</div>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => {
                void refreshAll();
                void loadResolvedUser();
              }}
              className="px-4 py-2 rounded-xl bg-black text-white font-semibold"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="px-4 py-2 rounded-xl border border-gray-200 font-semibold"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <OnboardingScreen
      globalConfig={globalConfig}
      globalConfigStatus={globalConfigStatus}
      globalConfigError={globalConfigError}
      onReload={() => refreshAll()}
      onDone={async () => {
        await refreshAll();
        await loadResolvedUser();
      }}
    />
  );
}



  if (!user) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="text-gray-500 text-sm">Loading session...</div>
      </div>
    );
  }

  if (dataLoading) {
    // keep UI responsive; dashboards will render once data is loaded
  }

  if (user.role === UserRole.HQ) {
      return (
          <HQDashboard 
              user={user}
              onLogout={handleLogout}
              stores={stores}
              sales={sales}
              menus={menus}
              employees={employees}
              ingredients={ingredients}
              storeStocks={storeStocks}
              globalConfig={globalConfig}
              salesLookbackLabel={salesLookbackLabel}
              onLoadMoreSales={handleLoadMoreSales}
              onUpdateGlobalConfig={handleUpdateGlobalConfig}
              onUpdateStore={async (s) => {
                setStores(prev => prev.map(store => store.id === s.id ? s : store));
                const { error } = await supabase.from('stores').update({ name: s.name, country: s.country, city: s.city, owner_email: s.ownerEmail, currency: s.currency, royalty_percentage: s.royaltyPercentage }).eq('id', s.id);
                if (error) {
                  await refreshAll();
                  throw error;
                }
                schedulePartialRefresh(['stores']);
              }}
              onSaveStoreStocks={async (storeId, rows) => {
                beginScopeMutation(['storeStocks']);
                setStoreStocks(prev => [
                  ...prev.filter(r => r.storeId !== storeId),
                  ...rows.map(r => ({ storeId, ingredientName: r.ingredientName, unit: r.unit, par: r.par, reorder: r.reorder }))
                ]);
                try {
                  await saveStoreIngredientStocks(storeId, rows);
                } catch (e) {
                  await refreshAll();
                  throw e;
                } finally {
                  endScopeMutation(['storeStocks']);
                  schedulePartialRefresh(['storeStocks']);
                }
              }}
              onDeleteStore={async (storeId) => {
                setStores(prev => prev.filter(s => s.id !== storeId));
                const { error } = await supabase.from('stores').delete().eq('id', storeId);
                if (error) {
                  await refreshAll();
                  throw error;
                }
                schedulePartialRefresh(['stores']);
              }}
              onUpdateMenu={async (m) => {
                beginScopeMutation(['menus']);
                setMenus(prev => {
                  const exists = prev.some(menu => menu.id === m.id);
                  if (exists) return prev.map(menu => menu.id === m.id ? m : menu);
                  return [...prev, m];
                });
                try {
                  await saveMenu(m);
                } catch (e) {
                  await refreshAll();
                  throw e;
                } finally {
                  endScopeMutation(['menus']);
                  schedulePartialRefresh(['menus']);
                }
              }}
              onCreateMenu={async (m) => {
                beginScopeMutation(['menus']);
                setMenus(prev => {
                  const exists = prev.some(menu => menu.id === m.id);
                  if (exists) return prev.map(menu => menu.id === m.id ? m : menu);
                  return [...prev, m];
                });
                try {
                  await saveMenu(m);
                } catch (e) {
                  await refreshAll();
                  throw e;
                } finally {
                  endScopeMutation(['menus']);
                  schedulePartialRefresh(['menus']);
                }
              }}
              onDeleteMenu={async (id) => {
                beginScopeMutation(['menus']);
                setMenus(prev => prev.filter(menu => menu.id !== id));
                try {
                  await deleteMenu(id);
                } catch (e) {
                  await refreshAll();
                  throw e;
                } finally {
                  endScopeMutation(['menus']);
                  schedulePartialRefresh(['menus']);
                }
              }}
              onUpdateEmployees={async (storeId, emps) => { await updateEmployeesForStore(storeId, emps); }}
              onAddIngredient={async (i) => { await addIngredient(i); schedulePartialRefresh(['ingredients']); }}
          />
      );
  }

  // Owner View
 // Owner View
const myStore = stores.find(s => s.id === user.storeId);

if (!myStore) {
  return (
    <OnboardingScreen
      globalConfig={globalConfig}
      globalConfigStatus={globalConfigStatus}
      globalConfigError={globalConfigError}
      onReload={() => refreshAll()}
      onDone={async () => {
        await refreshAll();
        await loadResolvedUser();
      }}
    />
  );
}


  return (
      <StoreDashboard 
          user={user}
          store={myStore}
          onLogout={handleLogout}
          sales={sales}
          menus={menus}
          employees={employees}
          ingredients={ingredients}
          globalConfig={globalConfig}
          onAddSale={async (s) => {
            setSales(prev => [s, ...prev]);   // immediate UI update
            try {
              await addSale(s);

              // Apply stock consumption to store_ingredient_stock
              if (s.items && s.items.length > 0) {
                const standardIngredients = globalConfig.standardIngredients ?? [];
                const standardSet = new Set(standardIngredients.map(si => si.name));
                const standardMap = new Map(standardIngredients.map(si => [si.name, si]));
                const storeMenus = menus.filter(m => m.storeId === s.storeId);

                if (storeMenus.length > 0 && standardIngredients.length > 0) {
                  const ingredientById = new Map(ingredients.map(i => [i.id, i]));
                  const categories = globalConfig.categories ?? [];
                  const categoryUsageMap: Record<string, Record<string, number>> = {};

                  categories.forEach(cat => {
                    const catMenus = storeMenus.filter(m => m.category === cat);
                    if (catMenus.length === 0) return;

                    const totals: Record<string, number> = {};
                    catMenus.forEach(menu => {
                      menu.recipe.forEach(r => {
                        const ingDef = ingredientById.get(r.ingredientId);
                        if (!ingDef || !standardSet.has(ingDef.name)) return;
                        totals[ingDef.name] = (totals[ingDef.name] || 0) + r.quantity;
                      });
                    });

                    const avg: Record<string, number> = {};
                    Object.keys(totals).forEach(ingName => {
                      avg[ingName] = totals[ingName] / catMenus.length;
                    });
                    if (Object.keys(avg).length > 0) {
                      categoryUsageMap[cat] = avg;
                    }
                  });

                  const usageByIngredient: Record<string, number> = {};
                  s.items.forEach(item => {
                    const avgUsage = categoryUsageMap[item.menuId];
                    if (!avgUsage) return;
                    const qty = Number(item.quantity || 0);
                    if (qty <= 0) return;
                    Object.keys(avgUsage).forEach(ingName => {
                      usageByIngredient[ingName] = (usageByIngredient[ingName] || 0) + (avgUsage[ingName] * qty);
                    });
                  });

                  const usageIngredientNames = Object.keys(usageByIngredient);
                  let latestStockRows: Array<{ ingredient_name: string; unit: string; par: number; reorder: number }> = [];
                  if (usageIngredientNames.length > 0) {
                    try {
                      const { data, error } = await supabase
                        .from('store_ingredient_stock')
                        .select('ingredient_name,unit,par,reorder')
                        .eq('store_id', s.storeId)
                        .in('ingredient_name', usageIngredientNames);
                      if (error) throw error;
                      latestStockRows = (data ?? []).map((row: any) => ({
                        ingredient_name: row.ingredient_name,
                        unit: row.unit,
                        par: Number(row.par ?? 0),
                        reorder: Number(row.reorder ?? 0),
                      }));
                    } catch (stockFetchErr) {
                      console.error('Failed to fetch latest stock before consumption update', stockFetchErr);
                    }
                  }

                  const latestStockMap = new Map<string, { par: number; reorder: number }>();
                  latestStockRows.forEach(row => {
                    latestStockMap.set(`${row.ingredient_name}::${row.unit}`, { par: row.par, reorder: row.reorder });
                  });

                  const updates = Object.entries(usageByIngredient)
                    .filter(([, used]) => used > 0)
                    .map(([ingName, used]) => {
                      const standard = standardMap.get(ingName);
                      if (!standard) return null;
                      const unit = standard.unit;
                      const key = `${ingName}::${unit}`;
                      const row = latestStockMap.get(key);
                      // Do not auto-create/overwrite stock for ingredients not configured in store settings.
                      if (!row) return null;
                      const current = row.par;
                      const reorder = row.reorder;
                      const next = Math.max(0, current - used);
                      return {
                        store_id: s.storeId,
                        ingredient_name: ingName,
                        unit,
                        par: next,
                        reorder
                      };
                    })
                    .filter(Boolean) as { store_id: string; ingredient_name: string; unit: string; par: number; reorder: number }[];

                  if (updates.length > 0) {
                    try {
                      const { error } = await supabase
                        .from('store_ingredient_stock')
                        .upsert(updates, { onConflict: 'store_id,ingredient_name,unit' });
                      if (error) throw error;
                    } catch (stockErr) {
                      console.error('Failed to apply stock consumption', stockErr);
                    }
                  }
                }
              }
            } catch (e) {
              setSales(prev => prev.filter(row => row.id !== s.id));
              await refreshAll();
              throw e;
            } finally {
              schedulePartialRefresh(['sales', 'storeStocks']);
            }
          }}

          onUpdateMenu={async (m) => {
            beginScopeMutation(['menus']);
            setMenus(prev => {
              const exists = prev.some(menu => menu.id === m.id);
              if (exists) return prev.map(menu => menu.id === m.id ? m : menu);
              return [...prev, m];
            });
            try {
              await saveMenu(m);
            } catch (e) {
              await refreshAll();
              throw e;
            } finally {
              endScopeMutation(['menus']);
              schedulePartialRefresh(['menus']);
            }
          }}
          onCreateMenu={async (m) => {
            beginScopeMutation(['menus']);
            setMenus(prev => {
              const exists = prev.some(menu => menu.id === m.id);
              if (exists) return prev.map(menu => menu.id === m.id ? m : menu);
              return [...prev, m];
            });
            try {
              await saveMenu(m);
            } catch (e) {
              await refreshAll();
              throw e;
            } finally {
              endScopeMutation(['menus']);
              schedulePartialRefresh(['menus']);
            }
          }}
          onDeleteMenu={async (id) => {
            beginScopeMutation(['menus']);
            setMenus(prev => prev.filter(menu => menu.id !== id));
            try {
              await deleteMenu(id);
            } catch (e) {
              await refreshAll();
              throw e;
            } finally {
              endScopeMutation(['menus']);
              schedulePartialRefresh(['menus']);
            }
          }}
          onUpdateEmployees={async (emps) => { await updateEmployeesForStore(myStore.id, emps); }}
          onAddIngredient={async (i) => { await addIngredient(i); schedulePartialRefresh(['ingredients']); }}
      />
  );
}

export default App;
