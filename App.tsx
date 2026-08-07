import React, { useState, useEffect, useMemo, useCallback, useDeferredValue, useRef } from 'react';
import { User, Store, Menu, SetMenu, Sale, Employee, UserRole, Ingredient, SaleItem, SaleSetItem, RecipeItem } from './types';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line, ComposedChart, Cell
} from 'recharts';
import {
  LayoutDashboard, ClipboardList, Users, UtensilsCrossed, LogOut,
  AlertTriangle, Plus, Trash2, ChevronRight, FileText, Camera, Save, ArrowLeft, BarChart3, Package, MapPin, CheckCircle2, XCircle, TrendingUp, TrendingDown, Minus, DollarSign, Clock, Image as ImageIcon, Layers, UploadCloud, Settings, X, Search, Info, Briefcase, User as UserIcon, AlertCircle, Mail, ArrowRight, UserPlus, AlertOctagon, ArrowUpRight, ArrowDownRight, CalendarX
} from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { signInWithEmailPassword, signInWithGoogle, signOut, signUpWithEmailPassword } from './auth';
import { MOCK_EMPLOYEES, MOCK_INGREDIENTS, MOCK_MENUS, MOCK_SALES, MOCK_STORES, MOCK_USERS } from './constants';
import MonthlyCloseWorkspace from './MonthlyCloseWorkspace';
import CostInventoryWorkspace from './CostInventoryWorkspace';
import HQProfitabilityAnalysis from './HQProfitabilityAnalysis';
import {
  HQLanguageBoundary,
  HQLanguageSwitch,
  HQ_LANGUAGE_STORAGE_KEY,
  type HQLocale,
} from './HQLanguageBoundary';
import {
  OwnerLanguageBoundary,
  OwnerLanguageSwitch,
  OWNER_LANGUAGE_STORAGE_PREFIX,
  defaultOwnerLocaleForCountry,
  type OwnerLocale,
} from './OwnerLanguageBoundary';


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
type RefreshScope = 'stores' | 'ingredients' | 'employees' | 'menus' | 'setMenus' | 'sales' | 'storeStocks' | 'globalConfig';

type ScopeMutationCounter = Record<RefreshScope, number>;

function createInitialScopeMutationCounter(): ScopeMutationCounter {
  return {
    stores: 0,
    ingredients: 0,
    employees: 0,
    menus: 0,
    setMenus: 0,
    sales: 0,
    storeStocks: 0,
    globalConfig: 0,
  };
}

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  storeNames: ['CHIBO', 'CHIBO Express', 'CHIBO Premium'],
  countries: ['South Korea', 'Vietnam', 'Philippines', 'China', 'Taiwan', 'Others'],
  cities: ['Seoul', 'Hanoi', 'Manila', 'Ningbo', 'Kaohsiung', 'Daejeon', 'Unknown', 'Osaka', 'Tokyo'],
  currencies: ['JPY', 'USD', 'KRW', 'VND', 'PHP', 'CNY', 'TWD', 'THB', 'MYR'],
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

const isLocalHqPreviewMode = () => {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  return isLocalHost && new URLSearchParams(window.location.search).get('preview') === 'hq';
};

const isLocalOwnerPreviewMode = () => {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  return isLocalHost && new URLSearchParams(window.location.search).get('preview') === 'owner';
};

const SALES_LOOKBACK_DEFAULT_DAYS = 90;
const SALES_LOOKBACK_STEP_DAYS = 90;
const RECEIPT_BUCKET = 'receipts';
const RECEIPT_SIGNED_URL_TTL_SEC = 60 * 60 * 24;
const SALES_FALLBACK_POLL_MS = 60000;
const OWNER_VIEW_STORAGE_PREFIX = 'chibo:owner:view:';
const HQ_SELECTED_STORE_STORAGE_KEY = 'chibo:hq:selectedStoreId';
let salesClosedReasonColumnSupported: boolean | null = null;
let salesIsClosedColumnSupported: boolean | null = null;
let salesCommentColumnSupported: boolean | null = null;
let setMenuTableSupported: boolean | null = null;
let saleSetItemsTableSupported: boolean | null = null;
let saleMenuItemsTableSupported: boolean | null = null;
const SALES_RECEIPT_IMAGE_RESIZE = { maxWidth: 1800, maxHeight: 1800, quality: 0.85 };
const MENU_IMAGE_RESIZE = { maxWidth: 1400, maxHeight: 1400, quality: 0.82 };
const STAFF_IMAGE_RESIZE = { maxWidth: 640, maxHeight: 640, quality: 0.82 };
const IMAGE_SIGNED_URL_CACHE_MS = 6 * 60 * 60 * 1000;
const LEGACY_MEDIA_MIGRATION_LIMIT = 80;
const signedImageUrlCache = new Map<string, { url: string; expiresAt: number }>();
const HQ_ADMIN_EMAIL = 'chibo.global.mgsystem@gmail.com';
const HQ_BOOTSTRAP_EMAILS = [HQ_ADMIN_EMAIL];

function isEditableNavigationTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return target.isContentEditable
    || tagName === 'INPUT'
    || tagName === 'TEXTAREA'
    || tagName === 'SELECT';
}

function isHqAdminEmail(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === HQ_ADMIN_EMAIL;
}

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
  return isMissingColumnError(error, 'closed_reason');
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as any).code ?? '').trim()
    : '';
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as any).message)
    : '';
  const details = typeof error === 'object' && error && 'details' in error
    ? String((error as any).details)
    : '';
  const hint = typeof error === 'object' && error && 'hint' in error
    ? String((error as any).hint)
    : '';
  const lower = `${message} ${details} ${hint}`.toLowerCase();
  const target = columnName.toLowerCase();
  return (
    code === '42703' ||
    lower.includes(`could not find the '${target}' column`) ||
    lower.includes(`column ${target} does not exist`) ||
    lower.includes(`column ${target} of relation`) ||
    lower.includes(`column ${target} of table`) ||
    lower.includes(`.${target}`) && lower.includes('does not exist') ||
    lower.includes(`column \"${target}\" does not exist`) ||
    lower.includes(`column '${target}' does not exist`)
  );
}

function toErrorMessage(error: unknown, fallback: string): string {
  const parseRecord = (record: Record<string, unknown>): string | null => {
    const directParts = [record.message, record.details, record.hint, record.code]
      .map((part) => String(part ?? '').trim())
      .filter(Boolean);
    if (directParts.length > 0) {
      return directParts.join(' | ');
    }
    if (record.error && typeof record.error === 'object') {
      return parseRecord(record.error as Record<string, unknown>);
    }
    return null;
  };

  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null) {
    const parsed = parseRecord(error as Record<string, unknown>);
    if (parsed) {
      return parsed;
    }
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return fallback;
}

function isMissingTableError(error: unknown, tableName: string): boolean {
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as any).message).toLowerCase()
    : '';
  const rel = `relation \"public.${tableName.toLowerCase()}\" does not exist`;
  const schemaCache = `could not find the table '${tableName.toLowerCase()}'`;
  return message.includes(rel) || message.includes(schemaCache) || message.includes(`relation \"${tableName.toLowerCase()}\" does not exist`);
}

function getPostgrestErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  if (!('code' in error)) return null;
  return String((error as any).code ?? '').trim() || null;
}

function isPermissionDeniedTableError(error: unknown, tableName: string): boolean {
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as any).message).toLowerCase()
    : '';
  const code = getPostgrestErrorCode(error);
  if (code === '42501') return true;
  return message.includes(`permission denied for table ${tableName.toLowerCase()}`);
}

function isSkippableSalesChildTableError(error: unknown, tableName: string): boolean {
  return isMissingTableError(error, tableName) || isPermissionDeniedTableError(error, tableName);
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

async function createMyPendingOwnerProfile(params: { name: string; email: string }) {
  const { data: authData } = await supabase.auth.getUser();
  const uid = authData.user?.id;
  if (!uid) throw new Error('No auth user');

  const { error } = await supabase.from('app_users').insert({
    user_id: uid,
    email: params.email,
    name: params.name,
    role: 'OWNER',
    store_id: null,
  });

  if (error) throw error;
}

async function upsertMyHqProfile(params: { name: string; email: string }) {
  if (!isHqAdminEmail(params.email)) {
    throw new Error('This email is not authorized for HQ access.');
  }

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
    .select('id,name,country,city,owner_email,currency,royalty_percentage,reporting_status,data_quality_note')
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
    reportingStatus: r.reporting_status ?? 'active',
    dataQualityNote: r.data_quality_note ?? undefined,
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
  if (error) throw error;
}

async function unlinkAccountFromStore(email: string, storeId: string) {
  const { error } = await supabase.rpc('unlink_account_from_store', { p_email: email, p_store_id: storeId });
  if (error) throw error;
}

type OwnerAccountAssignment = {
  email: string;
  name: string;
  userId: string;
  storeId: string | null;
  storeName: string | null;
  reportingStatus: Store['reportingStatus'] | null;
};

const UNLINKED_STORE_TARGET = '__UNLINKED__';

async function loadOwnerAccountAssignments(): Promise<OwnerAccountAssignment[]> {
  const { data, error } = await supabase.rpc('list_owner_account_assignments');
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    email: row.email,
    name: row.name,
    userId: row.user_id,
    storeId: row.store_id ?? null,
    storeName: row.store_name ?? null,
    reportingStatus: row.reporting_status ?? null,
  }));
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

async function loadSetMenus(): Promise<SetMenu[]> {
  if (setMenuTableSupported === false) return [];
  const { data: setData, error: setErr } = await supabase
    .from('set_menus')
    .select('id,store_id,name,price')
    .order('id');
  if (setErr) {
    if (isMissingTableError(setErr, 'set_menus') || isPermissionDeniedTableError(setErr, 'set_menus')) {
      setMenuTableSupported = false;
      console.warn('Skipping set_menus load due to table availability/permission issue', setErr);
      return [];
    }
    throw setErr;
  }
  setMenuTableSupported = true;

  const setIds = (setData ?? []).map((row: any) => row.id);
  let itemData: any[] = [];
  if (setIds.length > 0) {
    const { data, error } = await supabase
      .from('set_menu_items')
      .select('set_menu_id,menu_id,quantity')
      .in('set_menu_id', setIds);
    if (error) {
      if (isMissingTableError(error, 'set_menu_items') || isPermissionDeniedTableError(error, 'set_menu_items')) {
        setMenuTableSupported = false;
        console.warn('Skipping set_menu_items load due to table availability/permission issue', error);
        return [];
      }
      throw error;
    }
    itemData = data ?? [];
  }

  const itemsBySet: Record<string, { menuId: string; quantity: number }[]> = {};
  itemData.forEach((row: any) => {
    const arr = itemsBySet[row.set_menu_id] ?? [];
    arr.push({ menuId: row.menu_id, quantity: Number(row.quantity) });
    itemsBySet[row.set_menu_id] = arr;
  });

  return (setData ?? []).map((row: any) => ({
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    price: Number(row.price ?? 0),
    items: itemsBySet[row.id] ?? [],
  }));
}

async function loadSales(daysBack?: number): Promise<Sale[]> {
  const formatDateOnly = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const since = daysBack && daysBack > 0
    ? formatDateOnly(new Date(Date.now() - daysBack * 86400000))
    : null;

  const selectWithAll = 'id,store_id,date,total_amount,is_closed,closed_reason,comment';
  const selectWithClosedReason = 'id,store_id,date,total_amount,is_closed,closed_reason';
  const selectWithIsClosedAndComment = 'id,store_id,date,total_amount,is_closed,comment';
  const selectWithIsClosedOnly = 'id,store_id,date,total_amount,is_closed';
  const selectLegacyWithComment = 'id,store_id,date,total_amount,comment';
  const selectLegacy = 'id,store_id,date,total_amount';

  const runSalesQuery = async (selectClause: string) => {
    let query = supabase
      .from('sales')
      .select(selectClause)
      .order('date', { ascending: false });
    if (since) query = query.gte('date', since);
    return await query;
  };

  let salesData: any[] = [];
  let firstError: unknown = null;

  const preferClosedReason = salesClosedReasonColumnSupported !== false;
  const preferIsClosed = salesIsClosedColumnSupported !== false;
  const preferComment = salesCommentColumnSupported !== false;

  let queryOrder: string[] = [];
  if (preferClosedReason) {
    queryOrder = preferComment
      ? [selectWithAll, selectWithClosedReason, selectWithIsClosedAndComment, selectWithIsClosedOnly, selectLegacyWithComment, selectLegacy]
      : [selectWithClosedReason, selectWithIsClosedOnly, selectLegacy];
  } else if (preferIsClosed) {
    queryOrder = preferComment
      ? [selectWithIsClosedAndComment, selectWithIsClosedOnly, selectLegacyWithComment, selectLegacy]
      : [selectWithIsClosedOnly, selectLegacy];
  } else {
    queryOrder = preferComment ? [selectLegacyWithComment, selectLegacy] : [selectLegacy];
  }

  let usedSelect: string | null = null;
  for (const selectClause of queryOrder) {
    const result = await runSalesQuery(selectClause);
    if (!result.error) {
      salesData = result.data ?? [];
      usedSelect = selectClause;
      break;
    }
    if (!firstError) firstError = result.error;
    const missingClosedReason = isMissingClosedReasonColumnError(result.error);
    const missingIsClosed = isMissingColumnError(result.error, 'is_closed');
    if (missingClosedReason || missingIsClosed) {
      continue;
    }
    throw result.error;
  }

  if (!usedSelect) {
    throw (firstError ?? new Error('Failed to load sales.'));
  }
  salesClosedReasonColumnSupported = usedSelect.includes('closed_reason');
  salesIsClosedColumnSupported = usedSelect.includes('is_closed');
  salesCommentColumnSupported = usedSelect.includes('comment');

  const saleIds = (salesData ?? []).map((s: any) => s.id);
  let receiptIds = new Set<string>();
  if (saleIds.length > 0) {
    const { data: receiptRows, error: receiptErr } = await supabase
      .from('sales')
      .select('id')
      .in('id', saleIds)
      .not('receipt_image', 'is', null)
      .neq('receipt_image', '');
    if (receiptErr) {
      if (isMissingColumnError(receiptErr, 'receipt_image')) {
        console.warn('sales.receipt_image column is missing; receipt link indicator will be hidden.');
      } else {
        throw receiptErr;
      }
    } else {
      receiptIds = new Set((receiptRows ?? []).map((r: any) => r.id as string));
    }
  }

  let itemData: any[] = [];
  if (saleIds.length > 0) {
    const { data, error: itemErr } = await supabase
      .from('sale_items')
      .select('sale_id,menu_id,quantity')
      .in('sale_id', saleIds);
    if (itemErr) {
      if (isSkippableSalesChildTableError(itemErr, 'sale_items')) {
        console.warn('Skipping sale_items load due to table availability/permission issue', itemErr);
      } else {
        throw itemErr;
      }
    } else {
      itemData = data ?? [];
    }
  }

  let setItemData: any[] = [];
  if (saleIds.length > 0 && saleSetItemsTableSupported !== false) {
    const { data, error: setItemErr } = await supabase
      .from('sale_set_items')
      .select('sale_id,set_menu_id,quantity')
      .in('sale_id', saleIds);
    if (setItemErr) {
      if (isSkippableSalesChildTableError(setItemErr, 'sale_set_items')) {
        saleSetItemsTableSupported = false;
        console.warn('Skipping sale_set_items load due to table availability/permission issue', setItemErr);
      } else {
        throw setItemErr;
      }
    } else {
      saleSetItemsTableSupported = true;
      setItemData = data ?? [];
    }
  }

  let menuItemData: any[] = [];
  if (saleIds.length > 0 && saleMenuItemsTableSupported !== false) {
    const { data, error: menuItemErr } = await supabase
      .from('sale_menu_items')
      .select('sale_id,menu_id,quantity')
      .in('sale_id', saleIds);
    if (menuItemErr) {
      if (isSkippableSalesChildTableError(menuItemErr, 'sale_menu_items')) {
        saleMenuItemsTableSupported = false;
        console.warn('Skipping sale_menu_items load until the Phase 7 table is active.', menuItemErr);
      } else {
        throw menuItemErr;
      }
    } else {
      saleMenuItemsTableSupported = true;
      menuItemData = data ?? [];
    }
  }

  const itemsBySale: Record<string, SaleItem[]> = {};
  itemData.forEach((r: any) => {
    const arr = itemsBySale[r.sale_id] ?? [];
    arr.push({ menuId: r.menu_id, quantity: Number(r.quantity) });
    itemsBySale[r.sale_id] = arr;
  });

  const setItemsBySale: Record<string, SaleSetItem[]> = {};
  setItemData.forEach((r: any) => {
    const arr = setItemsBySale[r.sale_id] ?? [];
    arr.push({ setMenuId: r.set_menu_id, quantity: Number(r.quantity) });
    setItemsBySale[r.sale_id] = arr;
  });

  const menuItemsBySale: Record<string, SaleItem[]> = {};
  menuItemData.forEach((r: any) => {
    const arr = menuItemsBySale[r.sale_id] ?? [];
    arr.push({ menuId: r.menu_id, quantity: Number(r.quantity) });
    menuItemsBySale[r.sale_id] = arr;
  });

  const mappedSales = (salesData ?? []).map((s: any) => ({
    id: s.id,
    storeId: s.store_id,
    date: s.date,
    totalAmount: Number(s.total_amount),
    items: itemsBySale[s.id] ?? [],
    menuItems: menuItemsBySale[s.id] ?? [],
    setItems: setItemsBySale[s.id] ?? [],
    hasReceipt: receiptIds.has(s.id),
    isClosed: Boolean(s.is_closed),
    closedReason: s.closed_reason ?? undefined,
    comment: (() => {
      if (salesCommentColumnSupported !== true) return undefined;
      const raw = String(s.comment ?? '').trim();
      return raw ? raw : undefined;
    })(),
  }));

  return dedupeSalesByStoreDate(mappedSales);
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

async function saveSetMenu(setMenu: SetMenu) {
  const mergedItems = new Map<string, number>();
  for (const row of setMenu.items ?? []) {
    if (!row.menuId) continue;
    const qty = Number(row.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    mergedItems.set(row.menuId, (mergedItems.get(row.menuId) ?? 0) + qty);
  }

  const { error: menuErr } = await supabase.from('set_menus').upsert({
    id: setMenu.id,
    store_id: setMenu.storeId,
    name: setMenu.name,
    price: setMenu.price,
  });
  if (menuErr) {
    if (isMissingTableError(menuErr, 'set_menus')) {
      setMenuTableSupported = false;
      throw new Error('Set menu tables are not ready. Run set menu migration SQL first.');
    }
    throw new Error(`Failed to save set menu header: ${toErrorMessage(menuErr, 'Unknown set menu error')}`);
  }
  setMenuTableSupported = true;

  const nextRows = Array.from(mergedItems.entries()).map(([menuId, quantity]) => ({
    set_menu_id: setMenu.id,
    menu_id: menuId,
    quantity,
  }));

  if (nextRows.length > 0) {
    const { error: upsertErr } = await supabase
      .from('set_menu_items')
      .upsert(nextRows, { onConflict: 'set_menu_id,menu_id' });
    if (upsertErr) {
      if (isMissingTableError(upsertErr, 'set_menu_items')) {
        setMenuTableSupported = false;
        throw new Error('Set menu item table is missing. Run set menu migration SQL first.');
      }
      throw new Error(`Failed to save set menu components: ${toErrorMessage(upsertErr, 'Unknown set menu item error')}`);
    }
  }

  if (nextRows.length === 0) {
    const { error: clearErr } = await supabase
      .from('set_menu_items')
      .delete()
      .eq('set_menu_id', setMenu.id);
    if (clearErr) throw new Error(`Failed to clear set menu components: ${toErrorMessage(clearErr, 'Unknown clear error')}`);
    return;
  }

  const { data: currentRows, error: currentErr } = await supabase
    .from('set_menu_items')
    .select('menu_id')
    .eq('set_menu_id', setMenu.id);
  if (currentErr) throw new Error(`Failed to load previous set menu components: ${toErrorMessage(currentErr, 'Unknown load error')}`);

  const keepSet = new Set(nextRows.map((row) => row.menu_id));
  const toDelete = (currentRows ?? [])
    .map((row: any) => String(row.menu_id))
    .filter((menuId) => !keepSet.has(menuId));

  if (toDelete.length > 0) {
    const { error: pruneErr } = await supabase
      .from('set_menu_items')
      .delete()
      .eq('set_menu_id', setMenu.id)
      .in('menu_id', toDelete);
    if (pruneErr) throw new Error(`Failed to remove old set menu components: ${toErrorMessage(pruneErr, 'Unknown delete error')}`);
  }
}

async function deleteSetMenu(setMenuId: string) {
  const { error } = await supabase.from('set_menus').delete().eq('id', setMenuId);
  if (error) {
    if (isMissingTableError(error, 'set_menus')) {
      setMenuTableSupported = false;
      throw new Error('Set menu tables are not ready. Run set menu migration SQL first.');
    }
    throw error;
  }
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
  const { data: existingRows, error: existingErr } = await supabase
    .from('sales')
    .select('id,receipt_image')
    .eq('store_id', sale.storeId)
    .eq('date', sale.date)
    .order('id', { ascending: false })
    .limit(1);
  if (existingErr) throw existingErr;
  const existingSaleId = existingRows?.[0]?.id ? String(existingRows[0].id) : null;
  const existingReceiptPath = existingRows?.[0]?.receipt_image ? String(existingRows[0].receipt_image) : null;
  const targetSaleId = existingSaleId ?? sale.id;

  let receiptPath: string | null = sale.isClosed ? null : existingReceiptPath;
  if (!sale.isClosed && !sale.receiptImage && !existingReceiptPath) {
    throw new Error('Receipt image is required for open days.');
  }
  if (sale.receiptImage && !sale.isClosed) {
    try {
      receiptPath = await uploadReceiptImage(sale.storeId, targetSaleId, sale.receiptImage);
    } catch (e) {
      console.error('Receipt upload failed', e);
      throw new Error('Failed to upload receipt image. Please retry.');
    }
  }

  const insertBasePayload = {
    id: targetSaleId,
    store_id: sale.storeId,
    date: sale.date,
    total_amount: sale.totalAmount,
    receipt_image: receiptPath,
    comment: sale.comment ?? null,
  };
  const insertPayloadWithIsClosed = {
    ...insertBasePayload,
    is_closed: sale.isClosed ?? false,
  };
  const insertPayloadWithClosedReason = {
    ...insertPayloadWithIsClosed,
    closed_reason: sale.closedReason ?? null,
  };

  const updateBasePayload = {
    total_amount: sale.totalAmount,
    receipt_image: receiptPath,
    comment: sale.comment ?? null,
  };
  const updatePayloadWithIsClosed = {
    ...updateBasePayload,
    is_closed: sale.isClosed ?? false,
  };
  const updatePayloadWithClosedReason = {
    ...updatePayloadWithIsClosed,
    closed_reason: sale.closedReason ?? null,
  };

  const preferClosedReason = salesClosedReasonColumnSupported !== false;
  const preferIsClosed = salesIsClosedColumnSupported !== false;
  const payloadOrder = preferClosedReason
    ? (
      existingSaleId
        ? [updatePayloadWithClosedReason, updatePayloadWithIsClosed, updateBasePayload]
        : [insertPayloadWithClosedReason, insertPayloadWithIsClosed, insertBasePayload]
    )
    : (
      preferIsClosed
        ? (existingSaleId ? [updatePayloadWithIsClosed, updateBasePayload] : [insertPayloadWithIsClosed, insertBasePayload])
        : (existingSaleId ? [updateBasePayload] : [insertBasePayload])
    );

  let sErr: any = null;
  let writtenPayloadType: 'full' | 'isClosedOnly' | 'legacy' | null = null;
  for (const payload of payloadOrder) {
    let activePayload: Record<string, unknown> = { ...payload };
    while (true) {
      const result = existingSaleId
        ? await supabase.from('sales').update(activePayload).eq('id', targetSaleId)
        : await supabase.from('sales').insert(activePayload);
      if (!result.error) {
        if (payload === insertPayloadWithClosedReason || payload === updatePayloadWithClosedReason) {
          writtenPayloadType = 'full';
        } else if (payload === insertPayloadWithIsClosed || payload === updatePayloadWithIsClosed) {
          writtenPayloadType = 'isClosedOnly';
        } else {
          writtenPayloadType = 'legacy';
        }
        salesCommentColumnSupported = Object.prototype.hasOwnProperty.call(activePayload, 'comment');
        sErr = null;
        break;
      }
      sErr = result.error;
      if (isMissingColumnError(result.error, 'comment') && Object.prototype.hasOwnProperty.call(activePayload, 'comment')) {
        salesCommentColumnSupported = false;
        const { comment: _comment, ...withoutComment } = activePayload;
        activePayload = withoutComment;
        continue;
      }
      const missingClosedReason = isMissingClosedReasonColumnError(result.error);
      const missingIsClosed = isMissingColumnError(result.error, 'is_closed');
      if (missingClosedReason || missingIsClosed) {
        break;
      }
      break;
    }
    if (!sErr) {
      break;
    }
    const missingClosedReason = isMissingClosedReasonColumnError(sErr);
    const missingIsClosed = isMissingColumnError(sErr, 'is_closed');
    if (missingClosedReason || missingIsClosed) {
      continue;
    }
    break;
  }

  if (writtenPayloadType) {
    salesClosedReasonColumnSupported = writtenPayloadType === 'full';
    salesIsClosedColumnSupported = writtenPayloadType !== 'legacy';
  }

  if (sErr) {
    const message = sErr.message || 'Unknown insert error';
    throw new Error(`Failed to save sales report: ${message}`);
  }

  if (existingSaleId) {
    const { error: clearItemsErr } = await supabase
      .from('sale_items')
      .delete()
      .eq('sale_id', targetSaleId);
    if (clearItemsErr) {
      const message = clearItemsErr.message || 'Unknown clear sale items error';
      throw new Error(`Failed to refresh sale items: ${message}`);
    }
  }

  if (sale.items?.length) {
    const rows = sale.items.map(i => ({
      sale_id: targetSaleId,
      menu_id: i.menuId,
      quantity: i.quantity,
    }));
    const { error } = await supabase.from('sale_items').insert(rows);
    if (error) {
      const message = error.message || 'Unknown sale items error';
      throw new Error(`Failed to save sale items: ${message}`);
    }
  }

  if (existingSaleId && saleMenuItemsTableSupported !== false) {
    const { error: clearMenuItemsErr } = await supabase
      .from('sale_menu_items')
      .delete()
      .eq('sale_id', targetSaleId);
    if (clearMenuItemsErr) {
      if (isSkippableSalesChildTableError(clearMenuItemsErr, 'sale_menu_items')) {
        saleMenuItemsTableSupported = false;
        console.warn('Skipping sale_menu_items update until the Phase 7 table is active.', clearMenuItemsErr);
      } else {
        throw new Error(`Failed to refresh direct menu quantities: ${clearMenuItemsErr.message || 'Unknown error'}`);
      }
    }
  }

  if (sale.menuItems?.length && saleMenuItemsTableSupported !== false) {
    const menuRows = sale.menuItems
      .filter((item) => item.menuId && Number(item.quantity) > 0)
      .map((item) => ({
        sale_id: targetSaleId,
        menu_id: item.menuId,
        quantity: Number(item.quantity),
      }));
    if (menuRows.length > 0) {
      const { error: menuItemsError } = await supabase.from('sale_menu_items').insert(menuRows);
      if (menuItemsError) {
        if (isSkippableSalesChildTableError(menuItemsError, 'sale_menu_items')) {
          saleMenuItemsTableSupported = false;
          console.warn('Skipping sale_menu_items save until the Phase 7 table is active.', menuItemsError);
        } else {
          throw new Error(`Failed to save direct menu quantities: ${menuItemsError.message || 'Unknown error'}`);
        }
      } else {
        saleMenuItemsTableSupported = true;
      }
    }
  }

  if (existingSaleId && saleSetItemsTableSupported !== false) {
    const { error: clearSetItemsErr } = await supabase
      .from('sale_set_items')
      .delete()
      .eq('sale_id', targetSaleId);
    if (clearSetItemsErr) {
      if (isSkippableSalesChildTableError(clearSetItemsErr, 'sale_set_items')) {
        saleSetItemsTableSupported = false;
        console.warn('Skipping clear of sale_set_items due to table availability/permission issue', clearSetItemsErr);
      } else {
        const message = clearSetItemsErr.message || 'Unknown clear set menu items error';
        throw new Error(`Failed to refresh set menu items: ${message}`);
      }
    }
  }

  if (sale.setItems?.length && saleSetItemsTableSupported !== false) {
    const setRows = sale.setItems
      .filter((item) => Number(item.quantity) > 0 && item.setMenuId)
      .map((item) => ({
        sale_id: targetSaleId,
        set_menu_id: item.setMenuId,
        quantity: Number(item.quantity),
      }));
    if (setRows.length > 0) {
      const { error } = await supabase.from('sale_set_items').insert(setRows);
      if (error) {
        if (isSkippableSalesChildTableError(error, 'sale_set_items')) {
          saleSetItemsTableSupported = false;
          console.warn('Skipping save of sale_set_items due to table availability/permission issue', error);
        } else {
          const message = error.message || 'Unknown sale set items error';
          throw new Error(`Failed to save set menu items: ${message}`);
        }
      } else {
        saleSetItemsTableSupported = true;
      }
    }
  }
}




// --- Helper Functions ---
const formatDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const formatMonthKey = (date: Date) => formatDate(date).slice(0, 7);

const formatMonthKeyLabel = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map((v) => Number(v));
  if (!year || !month) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
  });
};

const extractMonthKey = (dateText: string) => {
  if (!dateText || dateText.length < 7) return '';
  return dateText.slice(0, 7);
};

const getReportingDatesForMonth = (monthKey: string, now = new Date()) => {
  const [year, month] = monthKey.split('-').map((value) => Number(value));
  if (!year || !month || month < 1 || month > 12) return [];

  const monthStart = new Date(year, month - 1, 1);
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  if (monthStart.getTime() > currentMonthStart.getTime()) return [];

  const monthEnd = new Date(year, month, 0);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const reportingEnd = monthStart.getTime() === currentMonthStart.getTime()
    ? yesterday
    : monthEnd;
  if (reportingEnd.getTime() < monthStart.getTime()) return [];

  const dates: string[] = [];
  const cursor = new Date(monthStart);
  while (cursor.getTime() <= reportingEnd.getTime()) {
    dates.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

const getStoreMonthReportStatus = (sales: Sale[], storeId: string, monthKey: string) => {
  const expectedDates = getReportingDatesForMonth(monthKey);
  const submittedDates = new Set(
    dedupeSalesByStoreDate(sales)
      .filter((sale) => sale.storeId === storeId && extractMonthKey(sale.date) === monthKey)
      .map((sale) => sale.date),
  );
  const missingDates = expectedDates.filter((date) => !submittedDates.has(date));
  return {
    expected: expectedDates.length,
    submitted: expectedDates.filter((date) => submittedDates.has(date)).length,
    missingDates,
  };
};

const scoreSaleCompleteness = (entry: Sale) => {
  let score = 0;
  if ((entry.items?.length ?? 0) > 0) score += 10;
  if ((entry.setItems?.length ?? 0) > 0) score += 6;
  if (entry.hasReceipt) score += 3;
  if (entry.totalAmount > 0) score += 1;
  return score;
};

const preferSaleEntry = (current: Sale, next: Sale): Sale => {
  const currentScore = scoreSaleCompleteness(current);
  const nextScore = scoreSaleCompleteness(next);
  if (nextScore > currentScore) return next;
  if (nextScore < currentScore) return current;
  return String(next.id) > String(current.id) ? next : current;
};

const dedupeSalesByStoreDate = (rows: Sale[]): Sale[] => {
  const dedupedByStoreDate = new Map<string, Sale>();
  for (const row of rows) {
    const key = `${row.storeId}::${row.date}`;
    const current = dedupedByStoreDate.get(key);
    if (!current) {
      dedupedByStoreDate.set(key, row);
      continue;
    }
    dedupedByStoreDate.set(key, preferSaleEntry(current, row));
  }
  return Array.from(dedupedByStoreDate.values()).sort(
    (a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id))
  );
};

const formatInvoiceMonthLabel = (monthKey: string) => {
  const [y, m] = monthKey.split('-').map((v) => Number(v));
  if (!y || !m) return monthKey;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

const formatInvoiceMonthCell = (monthKey: string) => {
  const [y, m] = monthKey.split('-').map((v) => Number(v));
  if (!y || !m) return monthKey;
  const month = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' });
  return `${month}-${String(y).slice(-2)}`;
};

const formatInvoiceDateDot = (date: Date) => {
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}.${day}.${year}`;
};

const escapeHtml = (raw: string) =>
  raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

type InvoiceHtmlParams = {
  invoiceNo: string;
  invoiceDateText: string;
  buyerText: string;
  showPaymentDueDate: boolean;
  paymentDueText: string;
  salesCurrencyLabel: string;
  locationText: string;
  salesMonthText: string;
  salesLocalText: string;
  fxSalesText: string;
  royaltyRateText: string;
  rowAmountText: string;
  royaltyAmountText: string;
  minimumText: string;
  bankChargeTitle: string;
  bankChargeText: string;
  showBankCharge: boolean;
  showWithholdingTax: boolean;
  withholdingTaxText: string;
  showChinaTaxBreakdown: boolean;
  taxBaseText: string;
  vatTaxText: string;
  incomeTaxText: string;
  taxTotalText: string;
  finalAmountLabelText: string;
  finalAmountText: string;
  invoiceCurrency: string;
  bankProfile: InvoiceBankProfile;
  fxSourceText: string;
  signatureUrl: string;
  specialNoteHtml: string;
  showMinimumLine: boolean;
  compactSummary: boolean;
};

type InvoiceBankProfile = {
  bankName: string;
  bankAddress: string;
  swiftCode: string;
  accountNumber: string;
};

type InvoicePrintProfile = {
  invoiceCurrency: 'JPY' | 'USD';
  summaryMode: 'royalty_only' | 'withholding' | 'china_tax';
  withholdingRate: string;
  minimumRoyalty: string;
  specialNote: string;
  bankCharge: string;
  bankChargeLabel: string;
  buyerText: string;
  locationText: string;
  showPaymentDueDate: boolean;
};

const INVOICE_ISSUER = {
  companyName: 'CHIBO HOLDINGS CO., LTD.',
  addressLine1: 'Ontex Namba Bldg. 7F 2-2-45 Minato Machi,',
  addressLine2: 'Naniwa-ku Osaka-shi, Osaka, 556-0017,Japan',
  phone: '+81-6-6633-1570',
  fax: '+81-6-6633-2191',
  beneficiaryName: 'CHIBO HOLDINGS CO., LTD.',
  beneficiaryAddress: '1-5-5 DOUTONNBORI, CHUO-KU, OSAKA, 542-0071 JAPAN',
  preparedByCompany: 'CHIBO HOLDINGS CO.,LTD.',
  preparedByName: 'Kasumi Hemmi',
} as const;

const INVOICE_BANKS: Record<'JPY' | 'USD', InvoiceBankProfile> = {
  JPY: {
    bankName: 'RESONA BANK  SENBA BRANCH',
    bankAddress: '3-6-1 KITAKYUHOJIMACHI, CYUO-KU, OSAKA-SHI,OSAKA 541-0057, JAPAN',
    swiftCode: 'DIWAJPJT',
    accountNumber: '0323028',
  },
  USD: {
    bankName: 'MITSUISUMITOMO BANK  NAMBA BRANCH',
    bankAddress: '5-1-60,NAMBA CHUO-KU, OSAKA-SHI,OSAKA 541-0076, JAPAN',
    swiftCode: 'SMBCJPJT',
    accountNumber: '0250776',
  },
};

type FxRatesPayload = {
  rates: Record<string, number>;
  fetchedAt: number;
  sourceText: string;
};

const FX_CURRENCIES = ['USD', 'JPY', 'KRW', 'PHP', 'CNY', 'VND', 'TWD', 'THB', 'SGD', 'HKD', 'MYR'] as const;
const MUFG_SUPPORTED_TO_JPY = new Set(['USD', 'EUR', 'CAD', 'GBP', 'CHF', 'DKK', 'NOK', 'SEK', 'AUD', 'NZD', 'HKD', 'MYR', 'SGD', 'SAR', 'AED', 'CNY', 'THB', 'INR', 'PKR', 'KWD', 'QAR', 'IDR', 'MXN', 'KRW', 'PHP', 'ZAR', 'CZK', 'RUB', 'HUF', 'PLN', 'TRY']);
const MUFG_100_UNIT_CURRENCIES = new Set(['KRW', 'IDR']);

function moneyPartsToNumber(value: any): number | null {
  if (!value) return null;
  const units = Number(value.units ?? 0);
  const nanos = Number(value.nanos ?? 0);
  if (!Number.isFinite(units) || !Number.isFinite(nanos)) return null;
  return units + nanos / 1_000_000_000;
}

function formatFxDate(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  const y = raw.year;
  const m = String(raw.month ?? '').padStart(2, '0');
  const d = String(raw.day ?? '').padStart(2, '0');
  return y && m && d ? `${y}-${m}-${d}` : null;
}

async function fetchMufgJpyPerCurrency(currency: string): Promise<{ rate: number; date: string | null } | null> {
  if (currency === 'JPY') return { rate: 1, date: null };
  if (!MUFG_SUPPORTED_TO_JPY.has(currency)) return null;
  try {
    const res = await fetch(`https://fx.ianlewis.org/v1/provider/MUFG/quote/${currency}/JPY/latest.json`);
    if (!res.ok) return null;
    const data = await res.json();
    const mid = moneyPartsToNumber(data?.mid);
    if (!mid || mid <= 0) return null;
    const unit = MUFG_100_UNIT_CURRENCIES.has(currency) ? 100 : 1;
    return { rate: mid / unit, date: formatFxDate(data?.date) };
  } catch {
    return null;
  }
}

async function fetchFrankfurterUsdRates(currencies: readonly string[]): Promise<{ rates: Record<string, number>; date: string | null }> {
  const quotes = currencies.filter(c => c !== 'USD').join(',');
  const res = await fetch(`https://api.frankfurter.dev/v2/rates?base=USD&quotes=${encodeURIComponent(quotes)}`);
  if (!res.ok) throw new Error('Frankfurter FX request failed');
  const data = await res.json();
  const rates: Record<string, number> = { USD: 1 };
  if (Array.isArray(data)) {
    data.forEach((row) => {
      if (row?.quote && Number.isFinite(Number(row.rate))) rates[row.quote] = Number(row.rate);
    });
    return { rates, date: data[0]?.date ?? null };
  }
  Object.entries(data?.rates ?? {}).forEach(([code, value]) => {
    if (Number.isFinite(Number(value))) rates[code] = Number(value);
  });
  return { rates, date: data?.date ?? null };
}

async function fetchFxRatesPayload(): Promise<FxRatesPayload> {
  const rates: Record<string, number> = { USD: 1 };
  const jpyPerCurrency: Record<string, number> = {};
  const mufgDates = new Set<string>();
  const fallbackCurrencies: string[] = [];

  for (const currency of FX_CURRENCIES) {
    const quote = await fetchMufgJpyPerCurrency(currency);
    if (quote?.rate) {
      jpyPerCurrency[currency] = quote.rate;
      if (quote.date) mufgDates.add(quote.date);
    } else if (currency !== 'JPY' && currency !== 'USD') {
      fallbackCurrencies.push(currency);
    }
  }

  if (jpyPerCurrency.USD && jpyPerCurrency.JPY) {
    rates.JPY = jpyPerCurrency.USD;
    Object.entries(jpyPerCurrency).forEach(([currency, jpyPerUnit]) => {
      if (currency === 'USD') return;
      rates[currency] = jpyPerCurrency.USD / jpyPerUnit;
    });
  }

  if (fallbackCurrencies.length > 0 || !rates.JPY) {
    const frankfurter = await fetchFrankfurterUsdRates(FX_CURRENCIES);
    Object.entries(frankfurter.rates).forEach(([currency, value]) => {
      if (!rates[currency]) rates[currency] = value;
    });
  }

  const mufgDateText = [...mufgDates].sort().pop();
  const sourceText = fallbackCurrencies.length > 0
    ? `MUFG mid${mufgDateText ? ` ${mufgDateText}` : ''}; ${fallbackCurrencies.join('/')} via Frankfurter`
    : `MUFG mid${mufgDateText ? ` ${mufgDateText}` : ''}`;

  return { rates: { ...FALLBACK_USD_RATES, ...rates }, fetchedAt: Date.now(), sourceText };
}

const normalizeInvoiceToken = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9가-힣一-龯ぁ-んァ-ヶ]/g, '');

function getInvoicePrintProfile(store: Store): InvoicePrintProfile {
  const country = normalizeInvoiceToken(store.country ?? '');
  const name = normalizeInvoiceToken(store.name ?? '');
  const isChina = country.includes('china') || country.includes('中国') || country.includes('중국')
    || name.includes('ningbo') || name.includes('宁波') || name.includes('寧波');
  const isPhilippines = country.includes('philippines') || name.includes('mitsukoshi') || name.includes('bgc');
  const isTaiwan = country.includes('taiwan') || country.includes('台湾') || country.includes('대만') || name.includes('hanshin');
  const isVietnam = country.includes('vietnam') || country.includes('베트남') || name.includes('hanoi') || name.includes('trunghoa');
  const isKorea = country.includes('southkorea') || country.includes('korea') || country.includes('한국') || country.includes('대한민국') || name.startsWith('kr');

  const base: InvoicePrintProfile = {
    invoiceCurrency: store.currency === 'USD' ? 'USD' : 'JPY',
    summaryMode: 'royalty_only',
    withholdingRate: '0',
    minimumRoyalty: '0',
    specialNote: '',
    bankCharge: '0',
    bankChargeLabel: 'Bank Charge',
    buyerText: store.name || '',
    locationText: `${store.country} / ${store.name}`,
    showPaymentDueDate: true,
  };

  if (isChina) {
    return {
      ...base,
      invoiceCurrency: 'JPY',
      summaryMode: 'china_tax',
      withholdingRate: '15.09',
      buyerText: 'NingBo YaoHua Business Management Limited\nDushigongyeyuan Jinzhou District,\nNingBo City, Zhejiang Province, China',
      locationText: 'NingBo',
    };
  }

  if (isPhilippines) {
    return {
      ...base,
      invoiceCurrency: 'JPY',
      minimumRoyalty: '70000',
      specialNote: 'smaller than 100 m2',
      buyerText: 'DINE LINK INC\n5th FLR Unit 504-508P, Pacific Drive EXT., FIVE E COM,BLDG,\nBLK18, Mall Of Asia Complex BRGY 076 Pasay City\nMETROMANILA, PHILIPPINES 1300\nTel: +63-917-300-3333',
      locationText: 'Chibo Mitsukoshi BGC',
    };
  }

  if (isTaiwan) {
    return {
      ...base,
      invoiceCurrency: 'USD',
      minimumRoyalty: '750',
      specialNote: '100 m2 or larger and smaller than 200 m2',
      buyerText: 'Taiwan Chibo Co., Ltd.\n6F.-1, No. 332, Mingcheng 2nd Rd., Zuoying Dist.,\nKaohsiung City 813307, Taiwan (R.O.C.)\n+886 966-029-557',
      locationText: 'Taiwan',
    };
  }

  if (isVietnam) {
    const isTrungHoa = name.includes('trunghoa') || name.includes('nhanchinh');
    return {
      ...base,
      invoiceCurrency: 'USD',
      minimumRoyalty: '750',
      specialNote: '100 m2 or larger and smaller than 200 m2',
      buyerText: 'SUMIBI VIETNAM JOINT STOCK COMPANY',
      locationText: isTrungHoa ? 'VTM / Trung Hòa Nhân Chính' : 'VTM / Ha Noi Kim Ma',
    };
  }

  if (isKorea) {
    const isGangnam = name.includes('gangnam') || name.includes('sinsa');
    const isYongsan = name.includes('yongsan') || name.includes('samgakji') || name.includes('三角地') || name.includes('용산');
    const isDaejeon = name.includes('daejeon') || name.includes('大田') || name.includes('대전');
    return {
      ...base,
      invoiceCurrency: 'JPY',
      minimumRoyalty: isDaejeon ? '0' : '150000',
      buyerText: isGangnam ? 'Kim Jongnam' : 'Goraewa co.',
      locationText: isGangnam
        ? 'KR / Gangnam Sinsa'
        : isYongsan
          ? 'KR / 龍山三角地店'
          : isDaejeon
            ? 'KR / 大田'
            : `KR / ${store.name}`,
    };
  }

  return base;
}

function buildInvoiceHtml(params: InvoiceHtmlParams): string {
  const {
    invoiceNo,
    invoiceDateText,
    buyerText,
    showPaymentDueDate,
    paymentDueText,
    salesCurrencyLabel,
    locationText,
    salesMonthText,
    salesLocalText,
    fxSalesText,
    royaltyRateText,
    rowAmountText,
    royaltyAmountText,
    minimumText,
    bankChargeTitle,
    bankChargeText,
    showBankCharge,
    showWithholdingTax,
    withholdingTaxText,
    showChinaTaxBreakdown,
    taxBaseText,
    vatTaxText,
    incomeTaxText,
    taxTotalText,
    finalAmountLabelText,
    finalAmountText,
    invoiceCurrency,
    bankProfile,
    fxSourceText,
    signatureUrl,
    specialNoteHtml,
    showMinimumLine,
    compactSummary,
  } = params;
  const buyerTextTrimmed = buyerText.trim();
  const buyerLines = buyerTextTrimmed ? buyerTextTrimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : ['-'];
  const buyerMetaHtml = buyerLines.map((line) => escapeHtml(line)).join('<br/>');
  const buyerFooterText = escapeHtml(buyerLines[0] ?? '-');
  const headerLine1 = escapeHtml(INVOICE_ISSUER.addressLine1);
  const headerLine2 = escapeHtml(INVOICE_ISSUER.addressLine2);
  const phone = escapeHtml(INVOICE_ISSUER.phone);
  const fax = escapeHtml(INVOICE_ISSUER.fax);
  const paymentLinesHtml = [
    `Beneficiary Name : ${escapeHtml(INVOICE_ISSUER.beneficiaryName)}`,
    `Beneficiary Address : ${escapeHtml(INVOICE_ISSUER.beneficiaryAddress)}`,
    `Beneficiary Bank Name : ${escapeHtml(bankProfile.bankName)}`,
    `Beneficiary Bank Address : ${escapeHtml(bankProfile.bankAddress)}`,
    `Swift Code : ${escapeHtml(bankProfile.swiftCode)}`,
    `Beneficiary Account Number : ${escapeHtml(bankProfile.accountNumber)}&nbsp;&nbsp;<span class="currency-red">${escapeHtml(invoiceCurrency)}</span>`,
  ]
    .map((line) => `<div>${line}</div>`)
    .join('');
  const showSeparateFinalLine = showWithholdingTax || showBankCharge || finalAmountLabelText !== 'Royalty Amount';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Invoice ${escapeHtml(invoiceNo)}</title>
  <style>
    @page { size: A4; margin: 0; }
    body { margin: 0; color: #111; font-family: Arial, sans-serif; background: #e5e7eb; }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.95);
      border-bottom: 1px solid #ddd;
    }
    .toolbar button {
      border: 1px solid #111;
      background: #fff;
      color: #111;
      padding: 7px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .toolbar button.primary {
      background: #111;
      color: #fff;
    }
    .sheet-wrap {
      width: min(94vw, 900px);
      margin: 14px auto 24px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      border: 1px solid #ddd;
      background: #f7f7f7;
    }
    .sheet {
      position: relative;
      width: 210mm;
      height: 297mm;
      margin: 0 auto;
      background: #f7f7f7;
      box-sizing: border-box;
      padding: 16mm 14mm 12mm 14mm;
    }
    .center { text-align: center; }
    .head-company {
      color: #c31717;
      font-weight: 700;
      font-size: 14pt;
      letter-spacing: 0.3px;
      margin-top: 0;
    }
    .head-address {
      font-size: 8.2pt;
      line-height: 1.35;
      margin-top: 4px;
    }
    .head-invoice {
      margin-top: 10px;
      font-size: 17pt;
      font-weight: 800;
      letter-spacing: 0.3px;
    }
    .meta-row {
      margin-top: 18mm;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      font-size: 9.4pt;
      font-weight: 700;
    }
    .due-row {
      margin-top: 6mm;
      text-align: right;
      font-size: 10.2pt;
      font-weight: 700;
    }
    .fx-note {
      margin-top: 3mm;
      text-align: right;
      font-size: 7.6pt;
      font-weight: 700;
      color: #555;
    }
    .meta-right div { margin-bottom: 2px; }
    table.main {
      width: 100%;
      margin-top: 18mm;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 8.2pt;
    }
    table.main th, table.main td {
      border: 1px solid #333;
      padding: 4px 5px;
      line-height: 1.15;
    }
    table.main th { text-align: center; font-weight: 700; }
    table.main td { text-align: right; font-weight: 700; }
    table.main td.left { text-align: left; }
    .summary-box {
      border: 1px solid #333;
      border-top: none;
      min-height: 58mm;
      padding: 10mm 12mm 8mm 12mm;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
    }
    .summary-minimum {
      display: grid;
      grid-template-columns: 1.05fr 1.8fr auto;
      column-gap: 8mm;
      align-items: end;
      margin-top: 1mm;
    }
    .summary-minimum .label {
      justify-self: center;
      font-size: 10.5pt;
      font-weight: 700;
    }
    .summary-minimum .note {
      font-size: 10.5pt;
      font-weight: 700;
      line-height: 1.35;
      color: #111;
      min-height: 14pt;
    }
    .summary-minimum .amount {
      justify-self: end;
      font-size: 10.5pt;
      font-weight: 700;
    }
    .summary-lines {
      margin-top: auto;
      display: flex;
      flex-direction: column;
      gap: 3.2mm;
    }
    .summary-lines.compact {
      margin-top: 11mm;
      margin-left: auto;
      width: 47%;
      gap: 4.4mm;
    }
    .summary-line {
      display: flex;
      justify-content: space-between;
      align-items: end;
      font-size: 10.5pt;
      font-weight: 700;
      margin-top: 0;
    }
    .summary-line.red { color: #d11a1a; }
    .summary-line.total {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: end;
      padding-left: 56%;
      margin-top: 2mm;
    }
    .summary-line.total .label {
      font-size: 11.5pt;
      font-weight: 700;
    }
    .summary-line.total .amount {
      font-size: 14pt;
      font-weight: 700;
    }
    .summary-line.compact-total {
      margin-top: 1.8mm;
      font-size: 12pt;
    }
    .paybox {
      border: 1px solid #333;
      margin-top: 0;
      padding: 10mm 10mm 8mm 10mm;
      font-size: 9pt;
      line-height: 1.55;
    }
    .pay-title {
      font-size: 12pt;
      font-weight: 700;
      margin-bottom: 7px;
    }
    .paybox .currency-red { color: #d11a1a; font-weight: 700; }
    .footer {
      margin-top: 15mm;
      display: flex;
      justify-content: space-between;
      font-size: 9.3pt;
      font-weight: 700;
    }
    .signature-wrap {
      margin-top: 6px;
      display: inline-block;
      width: 72mm;
    }
    .signature-wrap img {
      display: block;
      width: 100%;
      height: 24mm;
      object-fit: contain;
      object-position: left center;
      mix-blend-mode: multiply;
    }
    .sig-line {
      margin-top: 0;
      border-top: 1px solid #333;
      padding-top: 3px;
      font-size: 7.8pt;
    }
    @media print {
      body { background: #fff; }
      .toolbar { display: none; }
      .sheet-wrap {
        width: 210mm;
        margin: 0;
        box-shadow: none;
        border: none;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="primary" onclick="window.print()">Save as PDF</button>
    <button onclick="window.close()">Close</button>
  </div>
  <div class="sheet-wrap">
    <div class="sheet">
      <div class="center">
        <div class="head-company">${escapeHtml(INVOICE_ISSUER.companyName)}</div>
        <div class="head-address">
          ${headerLine1}<br/>
          ${headerLine2}<br/>
          Phone ${phone}<br/>
          FAX&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${fax}
        </div>
        <div class="head-invoice">INVOICE</div>
      </div>

      <div class="meta-row">
        <div><span style="margin-right:8px;">TO :</span> ${buyerMetaHtml}</div>
        <div class="meta-right">
          <div><span style="display:inline-block; width:82px;">INV Number:</span> ${escapeHtml(invoiceNo)}</div>
          <div><span style="display:inline-block; width:82px;">DATE:</span> ${escapeHtml(invoiceDateText)}</div>
        </div>
      </div>
      ${showPaymentDueDate ? `<div class="due-row">${escapeHtml(paymentDueText)}</div>` : ''}
      <div class="fx-note">${escapeHtml(fxSourceText)}</div>

      <table class="main">
        <colgroup>
          <col style="width:23.2%">
          <col style="width:14.2%">
          <col style="width:21.6%">
          <col style="width:14.6%">
          <col style="width:10.5%">
          <col style="width:15.9%">
        </colgroup>
        <thead>
          <tr>
            <th>Location</th>
            <th>Sales month</th>
            <th>Sales (Local Currency)</th>
            <th>${escapeHtml(salesCurrencyLabel)}</th>
            <th>Royalty %</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="left">${escapeHtml(locationText)}</td>
            <td style="text-align:center">${escapeHtml(salesMonthText)}</td>
            <td>${escapeHtml(salesLocalText)}</td>
            <td>${escapeHtml(fxSalesText)}</td>
            <td style="text-align:center">${escapeHtml(royaltyRateText)}</td>
            <td>${escapeHtml(rowAmountText)}</td>
          </tr>
        </tbody>
      </table>

      <div class="summary-box">
        ${showMinimumLine ? `
        <div class="summary-minimum">
          <span class="label">"Minimum Royalty"</span>
          <span class="note">${specialNoteHtml || '&nbsp;'}</span>
          <span class="amount">${escapeHtml(minimumText)}</span>
        </div>
        ` : ''}
        ${compactSummary ? `
        <div class="summary-lines compact">
          <div class="summary-line"><span>Royalty Amount</span><span>${escapeHtml(royaltyAmountText)}</span></div>
          ${showWithholdingTax ? `<div class="summary-line"><span>Withholding Tax</span><span>${escapeHtml(withholdingTaxText)}</span></div>` : ''}
          ${showBankCharge ? `<div class="summary-line red"><span>${escapeHtml(bankChargeTitle)}</span><span>${escapeHtml(bankChargeText)}</span></div>` : ''}
          <div class="summary-line compact-total"><span>${escapeHtml(finalAmountLabelText)}</span><span>${escapeHtml(finalAmountText)}</span></div>
        </div>
        ` : `
        <div class="summary-lines">
          <div class="summary-line"><span>Royalty Amount</span><span>${escapeHtml(royaltyAmountText)}</span></div>
          ${showChinaTaxBreakdown ? `<div class="summary-line"><span>Tax Base (Excl. VAT)</span><span>${escapeHtml(taxBaseText)}</span></div>` : ''}
          ${showChinaTaxBreakdown ? `<div class="summary-line"><span>VAT (6%)</span><span>${escapeHtml(vatTaxText)}</span></div>` : ''}
          ${showChinaTaxBreakdown ? `<div class="summary-line"><span>Income Tax (10%)</span><span>${escapeHtml(incomeTaxText)}</span></div>` : ''}
          ${showChinaTaxBreakdown ? `<div class="summary-line"><span>Tax Total</span><span>${escapeHtml(taxTotalText)}</span></div>` : ''}
          ${showWithholdingTax ? `<div class="summary-line"><span>Withholding Tax</span><span>${escapeHtml(withholdingTaxText)}</span></div>` : ''}
          ${showBankCharge ? `<div class="summary-line red"><span>${escapeHtml(bankChargeTitle)}</span><span>${escapeHtml(bankChargeText)}</span></div>` : ''}
          ${showSeparateFinalLine ? `<div class="summary-line total">
            <span class="label">${escapeHtml(finalAmountLabelText)}</span>
            <span class="amount">${escapeHtml(finalAmountText)}</span>
          </div>` : ''}
        </div>
        `}
      </div>

      <div class="paybox">
        <div class="pay-title">Please make payment payable to:</div>
        ${paymentLinesHtml}
      </div>

      <div class="footer">
        <div>
          <div>Buyer:</div>
          <div>${buyerFooterText}</div>
          <div style="width:66mm; border-top:1px solid #333; margin-top:36px;"></div>
        </div>
        <div style="text-align:left;">
          <div>Prepared by</div>
          <div>${escapeHtml(INVOICE_ISSUER.preparedByCompany)}</div>
          <div class="signature-wrap">
            <img src="${escapeHtml(signatureUrl)}" alt="Signature" />
            <div class="sig-line">${escapeHtml(INVOICE_ISSUER.preparedByName)}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

const parseMoneyInput = (raw: string): number => {
  const n = Number(raw.replace(/[^\d.-]/g, ''));
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
};

const parsePercentInput = (raw: string): number => {
  const n = Number(raw.replace(/[^\d.-]/g, ''));
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return Math.max(0, n);
};

const normalizeDecimalInput = (raw: string, maxDecimals = 2) => {
  const cleaned = raw.replace(/[^\d.]/g, '');
  if (!cleaned) return '';
  const parts = cleaned.split('.');
  const intPart = parts[0].replace(/^0+(?=\d)/, '') || '0';
  if (parts.length === 1) return intPart;
  const fracPart = parts.slice(1).join('').slice(0, maxDecimals);
  return fracPart.length > 0 ? `${intPart}.${fracPart}` : `${intPart}.`;
};

const formatDecimalForInput = (value: number) => {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

const formatMoneyDisplay = (value: number) => {
  if (!Number.isFinite(value)) return '0';
  const hasFraction = Math.abs(value - Math.trunc(value)) > 0.000001;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
};

const convertAmountByUsdRates = (
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: Record<string, number> | null
) => {
  if (fromCurrency === toCurrency) return amount;
  const table = rates ?? FALLBACK_USD_RATES;
  const fromRate = table[fromCurrency];
  const toRate = table[toCurrency];
  if (!fromRate || !toRate) return null;
  return (amount / fromRate) * toRate;
};

const applyManualFxRate = (
  rates: Record<string, number> | null,
  fromCurrency: string,
  toCurrency: string,
  manualRate: number | null
) => {
  const base = { ...(rates ?? FALLBACK_USD_RATES) };
  if (!manualRate || manualRate <= 0 || fromCurrency === toCurrency) return base;
  if (toCurrency === 'JPY') {
    base.JPY = base.USD === 1 ? base.JPY : base.JPY;
    base[fromCurrency] = (base.JPY || FALLBACK_USD_RATES.JPY) / manualRate;
    return base;
  }
  if (fromCurrency === 'JPY') {
    base[toCurrency] = (base.JPY || FALLBACK_USD_RATES.JPY) * manualRate;
    return base;
  }
  base[toCurrency] = base[fromCurrency] * manualRate;
  return base;
};

const parseManualFxRate = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
};

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

const FX_CACHE_KEY = 'chibo_fx_rates_usd_v2';
const FX_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const FALLBACK_FX_SOURCE_TEXT = 'Fallback fixed rates';

type FxRatesStatus = 'loading' | 'ok' | 'stale' | 'error';

const formatFxSourceLabel = (status: FxRatesStatus, sourceText: string) => {
  if (status === 'loading') return 'FX: Loading';
  if (status === 'ok') return `FX: ${sourceText}`;
  if (status === 'stale') return `FX: Cached ${sourceText}`;
  return `FX: Approx. ${sourceText}`;
};

const readFxCache = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(FX_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.rates || !parsed?.fetchedAt) return null;
    return parsed as FxRatesPayload;
  } catch {
    return null;
  }
};

const writeFxCache = (payload: FxRatesPayload) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FX_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore cache write errors
  }
};

const useFxRates = () => {
  const cached = readFxCache();
  const [rates, setRates] = useState<Record<string, number> | null>(cached?.rates ?? null);
  const [status, setStatus] = useState<FxRatesStatus>(cached ? 'stale' : 'loading');
  const [lastUpdated, setLastUpdated] = useState<number | null>(cached?.fetchedAt ?? null);
  const [sourceText, setSourceText] = useState<string>(cached?.sourceText ?? FALLBACK_FX_SOURCE_TEXT);

  const applyPayload = useCallback((payload: FxRatesPayload) => {
    setRates(payload.rates);
    setStatus('ok');
    setLastUpdated(payload.fetchedAt);
    setSourceText(payload.sourceText);
    writeFxCache(payload);
  }, []);

  const refreshNow = useCallback(async () => {
    const payload = await fetchFxRatesPayload();
    if (!payload.rates?.JPY) throw new Error('FX rates missing');
    applyPayload(payload);
    return payload;
  }, [applyPayload]);

  useEffect(() => {
    let cancelled = false;

    const fetchRates = async () => {
      try {
        const payload = await fetchFxRatesPayload();
        if (!payload.rates?.JPY) throw new Error('FX rates missing');
        if (cancelled) return;
        applyPayload(payload);
      } catch (e) {
        if (cancelled) return;
        setStatus(cached ? 'stale' : 'error');
        setSourceText(cached?.sourceText ?? FALLBACK_FX_SOURCE_TEXT);
        // keep cached rates if any
      }
    };

    fetchRates();
    const intervalId = window.setInterval(fetchRates, 1000 * 60 * 60); // hourly refresh
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [applyPayload]);

  return { rates, status, lastUpdated, sourceText, refreshNow };
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

const getFiscalStartYear = (date = new Date()) => {
  const monthIndex = date.getMonth();
  return monthIndex >= 3 ? date.getFullYear() : date.getFullYear() - 1;
};

const buildFiscalMonthKeys = (fiscalStartYear: number) =>
  Array.from({ length: 12 }, (_, index) => {
    const monthIndex = (3 + index) % 12;
    const year = monthIndex >= 3 ? fiscalStartYear : fiscalStartYear + 1;
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  });

const getLocalSalesLabelCurrency = (store: Store) => {
  const country = normalizeInvoiceToken(store.country ?? '');
  if (country.includes('taiwan') || country.includes('台湾') || country.includes('대만')) return 'NT$';
  return store.currency || 'LOCAL';
};

const getExportCountryLabel = (store: Store) => {
  const country = normalizeInvoiceToken(store.country ?? '');
  const settlement = getInvoicePrintProfile(store).invoiceCurrency;
  if (country.includes('vietnam') || country.includes('ベトナム') || country.includes('베트남')) return `ベトナム     ${settlement}`;
  if (country.includes('taiwan') || country.includes('台湾') || country.includes('대만')) return `台湾               ${settlement}`;
  if (country.includes('china') || country.includes('中国') || country.includes('중국')) return `中国                      ${settlement}`;
  if (country.includes('philippines') || country.includes('フィリピン')) return `フィリピン    ${settlement}`;
  if (country.includes('korea') || country.includes('韓国') || country.includes('한국')) return `韓国           ${settlement}`;
  return `${store.country || 'Other'}     ${settlement}`;
};

const makeFormula = (f: string) => ({ f });

const downloadWorkbook = (workbook: XLSX.WorkBook, filename: string) => {
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

type XlsxCellStyle = Record<string, any>;

const EXCEL_REPORT_FONT = 'ＭＳ Ｐゴシック';
const EXCEL_BLACK = { rgb: '000000' };
const EXCEL_GRAY_FILL = { rgb: '595959' };
const EXCEL_ROYALTY_FILL = { rgb: 'FCE4D6' };
const HD_SALES_TEMPLATE_PATH = '/templates/hd-sales-template.xlsx';
const HD_SALES_PROGRESS_COLUMN_WIDTHS = [
  15.90625,
  18.1796875,
  19.08984375,
  23.90625,
  23.90625,
  13,
  20.26953125,
  19.54296875,
  13,
  13,
  13,
  13,
  13,
  13,
  19.54296875,
  19.54296875,
];

const excelBorderSide = (style: 'thin' | 'medium' | 'hair' = 'thin') => ({ style, color: EXCEL_BLACK });
const excelBorder = (style: 'thin' | 'medium' | 'hair' = 'thin') => ({
  top: excelBorderSide(style),
  bottom: excelBorderSide(style),
  left: excelBorderSide(style),
  right: excelBorderSide(style),
});

const excelStyle = (overrides: XlsxCellStyle = {}): XlsxCellStyle => ({
  font: { name: EXCEL_REPORT_FONT, sz: 11, color: EXCEL_BLACK, ...(overrides.font ?? {}) },
  alignment: { vertical: 'center', wrapText: true, ...(overrides.alignment ?? {}) },
  border: overrides.border,
  fill: overrides.fill,
  numFmt: overrides.numFmt,
});

const applyExcelStyle = (worksheet: XLSX.WorkSheet, address: string, style: XlsxCellStyle, numFmt?: string) => {
  if (!worksheet[address]) worksheet[address] = { t: 's', v: '' } as XLSX.CellObject;
  (worksheet[address] as any).s = style;
  if (numFmt) {
    (worksheet[address] as any).z = numFmt;
    (worksheet[address] as any).s = { ...(worksheet[address] as any).s, numFmt };
  }
};

const cloneExcelCell = (cell: XLSX.CellObject | undefined): XLSX.CellObject => {
  if (!cell) return { t: 's', v: '' } as XLSX.CellObject;
  const clone: XLSX.CellObject = { ...cell };
  if ((cell as any).s) (clone as any).s = JSON.parse(JSON.stringify((cell as any).s));
  return clone;
};

const clearExcelCellValue = (worksheet: XLSX.WorkSheet, address: string) => {
  const existing = worksheet[address] as XLSX.CellObject | undefined;
  const blank = cloneExcelCell(existing);
  blank.t = 's';
  blank.v = '';
  delete (blank as any).f;
  delete (blank as any).w;
  delete (blank as any).h;
  delete (blank as any).r;
  worksheet[address] = blank;
};

const setExcelCellValue = (worksheet: XLSX.WorkSheet, address: string, value: string | number | Date | null | undefined) => {
  const existing = worksheet[address] as XLSX.CellObject | undefined;
  const next = cloneExcelCell(existing);
  delete (next as any).f;
  delete (next as any).w;
  delete (next as any).h;
  delete (next as any).r;
  if (value instanceof Date) {
    next.t = 'd';
    next.v = value as any;
  } else if (typeof value === 'number') {
    next.t = 'n';
    next.v = Number.isFinite(value) ? value : 0;
  } else {
    next.t = 's';
    next.v = value ?? '';
  }
  worksheet[address] = next;
};

const clearExcelRange = (worksheet: XLSX.WorkSheet | undefined, range: string) => {
  if (!worksheet) return;
  const decoded = XLSX.utils.decode_range(range);
  for (let r = decoded.s.r; r <= decoded.e.r; r += 1) {
    for (let c = decoded.s.c; c <= decoded.e.c; c += 1) {
      clearExcelCellValue(worksheet, XLSX.utils.encode_cell({ r, c }));
    }
  }
};

const copyExcelRowStyle = (worksheet: XLSX.WorkSheet, sourceRow: number, targetRow: number, startCol: number, endCol: number) => {
  for (let c = startCol; c <= endCol; c += 1) {
    const sourceAddress = XLSX.utils.encode_cell({ r: sourceRow - 1, c });
    const targetAddress = XLSX.utils.encode_cell({ r: targetRow - 1, c });
    const source = worksheet[sourceAddress] as XLSX.CellObject | undefined;
    const target = cloneExcelCell(source);
    target.t = 's';
    target.v = '';
    delete (target as any).f;
    delete (target as any).w;
    delete (target as any).h;
    delete (target as any).r;
    worksheet[targetAddress] = target;
  }
};

const formatExportInvoiceDate = (monthKey: string) => {
  const [yearText, monthText] = monthKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!year || !month) return '';
  const invoiceDate = new Date(year, month, 13);
  const monthLabel = invoiceDate.toLocaleDateString('en-US', { month: 'short' });
  return `${monthLabel}.${String(invoiceDate.getDate()).padStart(2, '0')}.${invoiceDate.getFullYear()}`;
};

const loadHdSalesTemplateWorkbook = async (): Promise<XLSX.WorkBook | null> => {
  if (typeof fetch === 'undefined') return null;
  try {
    const response = await fetch(HD_SALES_TEMPLATE_PATH, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Template request failed: ${response.status}`);
    const buffer = await response.arrayBuffer();
    return XLSX.read(buffer, { type: 'array', cellStyles: true, cellDates: true, cellFormula: true, cellNF: true });
  } catch (error) {
    console.warn('HD sales template could not be loaded. Falling back to generated single-sheet export.', error);
    return null;
  }
};

const copyExcelCellStyle = (target: XLSX.WorkSheet, targetAddress: string, source: XLSX.WorkSheet | undefined, sourceAddress: string) => {
  if (!source) return;
  const sourceCell = source[sourceAddress] as XLSX.CellObject | undefined;
  if (!target[targetAddress]) target[targetAddress] = { t: 's', v: '' } as XLSX.CellObject;
  if ((sourceCell as any)?.s) {
    (target[targetAddress] as any).s = JSON.parse(JSON.stringify((sourceCell as any).s));
  }
  if ((sourceCell as any)?.z) {
    (target[targetAddress] as any).z = (sourceCell as any).z;
  }
};

const applyHdSalesProgressTemplateStyle = (
  worksheet: XLSX.WorkSheet,
  templateWorksheet: XLSX.WorkSheet | undefined,
  storeBlocks: { start: number; end: number; settlement: 'JPY' | 'USD'; royaltyRow: number; usdRow?: number; jpyRow: number }[],
  summaryStartRow: number,
  maxRow: number,
) => {
  if (!templateWorksheet) return;

  worksheet['!cols'] = HD_SALES_PROGRESS_COLUMN_WIDTHS.map((width) => ({ width, customwidth: '1' }));

  const sourceRowForGeneratedRow = (rowNumber: number) => {
    if (rowNumber <= 4) return rowNumber;
    if (rowNumber >= summaryStartRow && rowNumber <= summaryStartRow + 3) {
      return 39 + (rowNumber - summaryStartRow);
    }
    const block = storeBlocks.find((item) => rowNumber >= item.start && rowNumber <= item.end);
    if (!block) return Math.min(rowNumber, 42);
    const offset = rowNumber - block.start;
    return block.settlement === 'USD' ? 5 + offset : 20 + offset;
  };

  for (let r = 1; r <= maxRow; r += 1) {
    const sourceRow = sourceRowForGeneratedRow(r);
    for (let c = 0; c <= 15; c += 1) {
      copyExcelCellStyle(
        worksheet,
        XLSX.utils.encode_cell({ r: r - 1, c }),
        templateWorksheet,
        XLSX.utils.encode_cell({ r: sourceRow - 1, c }),
      );
    }
  }

  if (templateWorksheet['!rows']) {
    worksheet['!rows'] = Array.from({ length: maxRow }, (_, index) => {
      const sourceRow = sourceRowForGeneratedRow(index + 1);
      const sourceRowMeta = templateWorksheet['!rows']?.[sourceRow - 1];
      return sourceRowMeta ? JSON.parse(JSON.stringify(sourceRowMeta)) : {};
    });
  }
};

const getUsdRateForExport = (currency: string, rates: Record<string, number>) => {
  if (currency === 'USD') return 1;
  return rates[currency] || FALLBACK_USD_RATES[currency] || 1;
};

const getJpyPerCurrencyForExport = (currency: string, rates: Record<string, number>) => {
  if (currency === 'JPY') return 1;
  const usdRate = getUsdRateForExport(currency, rates);
  const jpyPerUsd = rates.JPY || FALLBACK_USD_RATES.JPY || 150;
  return jpyPerUsd / usdRate;
};

const getExportLocalCurrencyCode = (store: Store) => {
  const country = normalizeInvoiceToken(store.country ?? '');
  if (country.includes('taiwan') || country.includes('台湾') || country.includes('대만')) return 'TWD';
  return store.currency || 'USD';
};

const getExportLocalCurrencyLabel = (store: Store) => {
  const code = getExportLocalCurrencyCode(store);
  if (code === 'TWD') return 'NT$';
  if (code === 'JPY') return '\\';
  if (code === 'USD') return '$';
  return code;
};

const getExportStoreName = (store: Store) => {
  const country = normalizeInvoiceToken(store.country ?? '');
  if (country.includes('taiwan') || country.includes('台湾') || country.includes('대만')) {
    return store.name.includes('台中') || store.city.toLowerCase().includes('taichung')
      ? `${store.name}`
      : `${store.name}`;
  }
  return store.name;
};

const populateHdTemplateCompanionSheets = (
  workbook: XLSX.WorkBook,
  stores: Store[],
  sales: Sale[],
  rates: Record<string, number>,
  fiscalStartYear: number,
  fiscalEndYear: number,
) => {
  const salesByStoreMonth = new Map<string, number>();
  dedupeSalesByStoreDate(sales).forEach((sale) => {
    const monthKey = extractMonthKey(sale.date);
    if (!monthKey) return;
    const key = `${sale.storeId}::${monthKey}`;
    salesByStoreMonth.set(key, (salesByStoreMonth.get(key) ?? 0) + Number(sale.totalAmount || 0));
  });

  const royaltySheet = workbook.Sheets['①海外ロイヤリテー請求一覧'];
  if (royaltySheet) {
    setExcelCellValue(royaltySheet, 'B1', `海外Royalty請求一覧（HD⇒海外FC）　　${fiscalStartYear}.4～${fiscalEndYear}.3`);
    clearExcelRange(royaltySheet, 'B4:K150');

    const generatedRows: {
      invoiceDate: string;
      storeName: string;
      country: string;
      royaltyAmount: number;
      settlement: 'JPY' | 'USD';
    }[] = [];

    const sortedStores = [...stores].sort((a, b) =>
      `${a.country} ${a.city} ${a.name}`.localeCompare(`${b.country} ${b.city} ${b.name}`),
    );
    const fiscalMonthKeys = buildFiscalMonthKeys(fiscalStartYear);

    fiscalMonthKeys.forEach((monthKey) => {
      sortedStores.forEach((store) => {
        const salesAmount = salesByStoreMonth.get(`${store.id}::${monthKey}`) ?? 0;
        if (!salesAmount) return;
        const royaltyRate = Number(store.royaltyPercentage || 0) / 100;
        if (!royaltyRate) return;

        const settlement = getInvoicePrintProfile(store).invoiceCurrency;
        const localCurrencyCode = getExportLocalCurrencyCode(store);
        const localRate = getUsdRateForExport(localCurrencyCode, rates);
        const jpyPerLocal = getJpyPerCurrencyForExport(localCurrencyCode, rates);
        const settlementSales = settlement === 'USD'
          ? (localCurrencyCode === 'USD' ? salesAmount : salesAmount / localRate)
          : (localCurrencyCode === 'JPY' ? salesAmount : salesAmount * jpyPerLocal);
        const royaltyAmount = settlementSales * royaltyRate;

        generatedRows.push({
          invoiceDate: formatExportInvoiceDate(monthKey),
          storeName: getExportStoreName(store),
          country: store.country,
          royaltyAmount: Math.round(royaltyAmount * 100) / 100,
          settlement,
        });
      });
    });

    generatedRows.slice(0, 147).forEach((row, index) => {
      const excelRow = index + 4;
      if (excelRow > 150) return;
      copyExcelRowStyle(royaltySheet, 4, excelRow, 1, 10);
      setExcelCellValue(royaltySheet, `B${excelRow}`, row.invoiceDate);
      setExcelCellValue(royaltySheet, `C${excelRow}`, '');
      setExcelCellValue(royaltySheet, `D${excelRow}`, row.storeName);
      setExcelCellValue(royaltySheet, `E${excelRow}`, row.country);
      setExcelCellValue(royaltySheet, `F${excelRow}`, row.royaltyAmount);
      setExcelCellValue(royaltySheet, `G${excelRow}`, '');
      setExcelCellValue(royaltySheet, `H${excelRow}`, '');
      setExcelCellValue(royaltySheet, `J${excelRow}`, '');
      setExcelCellValue(royaltySheet, `K${excelRow}`, '');
    });
  }

  const exportSheet = workbook.Sheets['③海外請求一覧輸出（食材・備品・その他）'];
  if (exportSheet) {
    setExcelCellValue(exportSheet, 'B1', `海外インボイス一覧（HD⇒海外FCお客様）　${fiscalStartYear}.4.1～`);
    clearExcelRange(exportSheet, 'B4:H50');
  }

  clearExcelRange(workbook.Sheets['KR Meet Up'], 'A2:G8');
  clearExcelRange(workbook.Sheets['TWC Royalty 相殺 '], 'B5:H17');
  clearExcelRange(workbook.Sheets['ベトナムRoyalty未入金'], 'C3:G40');

  const supportSheet = workbook.Sheets['②海外請求一覧（サポート費用）'];
  if (supportSheet) {
    setExcelCellValue(supportSheet, 'B1', `海外インボイス一覧（HD⇒海外FCお客様）　${fiscalStartYear}.4～${fiscalEndYear}.3`);
    clearExcelRange(supportSheet, 'B5:H12');
  }
};

const calculateHdRoyaltyListRows = (
  stores: Store[],
  sales: Sale[],
  rates: Record<string, number>,
  fiscalStartYear: number,
) => {
  const salesByStoreMonth = new Map<string, number>();
  dedupeSalesByStoreDate(sales).forEach((sale) => {
    const monthKey = extractMonthKey(sale.date);
    if (!monthKey) return;
    const key = `${sale.storeId}::${monthKey}`;
    salesByStoreMonth.set(key, (salesByStoreMonth.get(key) ?? 0) + Number(sale.totalAmount || 0));
  });

  const sortedStores = [...stores].sort((a, b) =>
    `${a.country} ${a.city} ${a.name}`.localeCompare(`${b.country} ${b.city} ${b.name}`),
  );
  const fiscalMonthKeys = buildFiscalMonthKeys(fiscalStartYear);

  const generatedRows: {
    invoiceDate: string;
    storeName: string;
    country: string;
    royaltyAmount: number;
  }[] = [];

  fiscalMonthKeys.forEach((monthKey) => {
    sortedStores.forEach((store) => {
      const salesAmount = salesByStoreMonth.get(`${store.id}::${monthKey}`) ?? 0;
      if (!salesAmount) return;
      const royaltyRate = Number(store.royaltyPercentage || 0) / 100;
      if (!royaltyRate) return;

      const settlement = getInvoicePrintProfile(store).invoiceCurrency;
      const localCurrencyCode = getExportLocalCurrencyCode(store);
      const localRate = getUsdRateForExport(localCurrencyCode, rates);
      const jpyPerLocal = getJpyPerCurrencyForExport(localCurrencyCode, rates);
      const settlementSales = settlement === 'USD'
        ? (localCurrencyCode === 'USD' ? salesAmount : salesAmount / localRate)
        : (localCurrencyCode === 'JPY' ? salesAmount : salesAmount * jpyPerLocal);

      generatedRows.push({
        invoiceDate: formatExportInvoiceDate(monthKey),
        storeName: getExportStoreName(store),
        country: store.country,
        royaltyAmount: Math.round(settlementSales * royaltyRate * 100) / 100,
      });
    });
  });

  return generatedRows;
};

const getXmlElements = (root: ParentNode, localName: string): Element[] =>
  Array.from(root.querySelectorAll('*')).filter((element) => element.localName === localName);

const getFirstXmlElement = (root: ParentNode, localName: string): Element | undefined =>
  getXmlElements(root, localName)[0];

const parseXmlDocument = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');

const serializeXmlDocument = (document: XMLDocument) => {
  const body = new XMLSerializer().serializeToString(document);
  return body.startsWith('<?xml') ? body : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`;
};

const columnNameToNumber = (columnName: string) =>
  columnName.split('').reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);

const numberToColumnName = (number: number) => {
  let value = number;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
};

const parseCellAddress = (address: string) => {
  const match = /^([A-Z]+)(\d+)$/i.exec(address);
  if (!match) throw new Error(`Invalid Excel cell address: ${address}`);
  return { col: columnNameToNumber(match[1].toUpperCase()), row: Number(match[2]) };
};

const getCellColumnNumber = (cell: Element) => {
  const address = cell.getAttribute('r');
  if (!address) return 0;
  return parseCellAddress(address).col;
};

const getSheetDataElement = (sheetDocument: XMLDocument) => {
  const sheetData = getFirstXmlElement(sheetDocument, 'sheetData');
  if (!sheetData) throw new Error('Invalid worksheet XML: sheetData not found');
  return sheetData;
};

const getXmlRow = (sheetDocument: XMLDocument, rowNumber: number) =>
  getXmlElements(getSheetDataElement(sheetDocument), 'row').find((row) => Number(row.getAttribute('r')) === rowNumber);

const getXmlCell = (row: Element | undefined, colNumber: number) =>
  row ? getXmlElements(row, 'c').find((cell) => getCellColumnNumber(cell) === colNumber) : undefined;

const clearXmlCell = (cell: Element) => {
  Array.from(cell.childNodes).forEach((child) => cell.removeChild(child));
  cell.removeAttribute('t');
};

const copyXmlAttributes = (target: Element, source: Element, keepCellRef: string) => {
  Array.from(target.attributes).forEach((attribute) => target.removeAttribute(attribute.name));
  Array.from(source.attributes).forEach((attribute) => {
    if (attribute.name !== 'r') target.setAttribute(attribute.name, attribute.value);
  });
  target.setAttribute('r', keepCellRef);
};

const cloneRowForXmlSheet = (sheetDocument: XMLDocument, rowNumber: number, sourceRowNumber?: number) => {
  const sheetData = getSheetDataElement(sheetDocument);
  const namespace = sheetDocument.documentElement.namespaceURI ?? undefined;
  const sourceRow = sourceRowNumber ? getXmlRow(sheetDocument, sourceRowNumber) : undefined;
  const row = sourceRow
    ? (sourceRow.cloneNode(true) as Element)
    : sheetDocument.createElementNS(namespace, 'row');

  row.setAttribute('r', String(rowNumber));
  getXmlElements(row, 'c').forEach((cell) => {
    const sourceAddress = cell.getAttribute('r') || 'A1';
    const sourceCol = /^[A-Z]+/i.exec(sourceAddress)?.[0]?.toUpperCase() ?? 'A';
    cell.setAttribute('r', `${sourceCol}${rowNumber}`);
    clearXmlCell(cell);
  });

  const rows = getXmlElements(sheetData, 'row');
  const nextRow = rows.find((item) => Number(item.getAttribute('r')) > rowNumber);
  if (nextRow) sheetData.insertBefore(row, nextRow);
  else sheetData.appendChild(row);
  return row;
};

const ensureXmlRow = (sheetDocument: XMLDocument, rowNumber: number, sourceRowNumber?: number) =>
  getXmlRow(sheetDocument, rowNumber) ?? cloneRowForXmlSheet(sheetDocument, rowNumber, sourceRowNumber);

const ensureXmlCell = (sheetDocument: XMLDocument, row: Element, colNumber: number, sourceRowNumber?: number) => {
  const existing = getXmlCell(row, colNumber);
  if (existing) return existing;

  const namespace = sheetDocument.documentElement.namespaceURI ?? undefined;
  const sourceCell = getXmlCell(sourceRowNumber ? getXmlRow(sheetDocument, sourceRowNumber) : undefined, colNumber);
  const cell = sourceCell
    ? (sourceCell.cloneNode(true) as Element)
    : sheetDocument.createElementNS(namespace, 'c');
  const address = `${numberToColumnName(colNumber)}${row.getAttribute('r') || '1'}`;
  if (sourceCell) copyXmlAttributes(cell, sourceCell, address);
  else cell.setAttribute('r', address);
  clearXmlCell(cell);

  const cells = getXmlElements(row, 'c');
  const nextCell = cells.find((item) => getCellColumnNumber(item) > colNumber);
  if (nextCell) row.insertBefore(cell, nextCell);
  else row.appendChild(cell);
  return cell;
};

const applyXmlRowTemplate = (sheetDocument: XMLDocument, rowNumber: number, sourceRowNumber: number, startCol: number, endCol: number) => {
  const sourceRow = getXmlRow(sheetDocument, sourceRowNumber);
  const sourceRowAttributes = sourceRow
    ? Array.from(sourceRow.attributes)
        .filter((attribute) => attribute.name !== 'r')
        .map((attribute) => ({ name: attribute.name, value: attribute.value }))
    : [];
  const sourceCellAttributes = new Map<number, { name: string; value: string }[]>();
  if (sourceRow) {
    getXmlElements(sourceRow, 'c').forEach((cell) => {
      const col = getCellColumnNumber(cell);
      sourceCellAttributes.set(
        col,
        Array.from(cell.attributes)
          .filter((attribute) => attribute.name !== 'r')
          .map((attribute) => ({ name: attribute.name, value: attribute.value })),
      );
    });
  }
  const targetRow = ensureXmlRow(sheetDocument, rowNumber, sourceRowNumber);
  if (sourceRow) {
    Array.from(targetRow.attributes).forEach((attribute) => targetRow.removeAttribute(attribute.name));
    sourceRowAttributes.forEach((attribute) => targetRow.setAttribute(attribute.name, attribute.value));
    targetRow.setAttribute('r', String(rowNumber));
  }

  for (let col = startCol; col <= endCol; col += 1) {
    const sourceAttributes = sourceCellAttributes.get(col);
    const existingTargetCell = getXmlCell(targetRow, col);
    if (!sourceAttributes && !existingTargetCell) continue;
    const targetCell = existingTargetCell ?? ensureXmlCell(sheetDocument, targetRow, col);
    Array.from(targetCell.attributes).forEach((attribute) => targetCell.removeAttribute(attribute.name));
    sourceAttributes?.forEach((attribute) => targetCell.setAttribute(attribute.name, attribute.value));
    targetCell.setAttribute('r', `${numberToColumnName(col)}${rowNumber}`);
    clearXmlCell(targetCell);
  }
};

const setXmlCellValue = (sheetDocument: XMLDocument, rowNumber: number, colNumber: number, value: any, sourceRowNumber?: number) => {
  if (value === '' || value === null || typeof value === 'undefined') {
    const existingCell = getXmlCell(getXmlRow(sheetDocument, rowNumber), colNumber);
    if (existingCell) clearXmlCell(existingCell);
    return;
  }

  const namespace = sheetDocument.documentElement.namespaceURI ?? undefined;
  const row = ensureXmlRow(sheetDocument, rowNumber, sourceRowNumber);
  const cell = ensureXmlCell(sheetDocument, row, colNumber, sourceRowNumber);
  clearXmlCell(cell);

  if (value && typeof value === 'object' && typeof value.f === 'string') {
    const formula = sheetDocument.createElementNS(namespace, 'f');
    formula.textContent = value.f;
    cell.appendChild(formula);
    return;
  }

  if (typeof value === 'number') {
    cell.removeAttribute('t');
    const numberValue = sheetDocument.createElementNS(namespace, 'v');
    numberValue.textContent = Number.isFinite(value) ? String(value) : '0';
    cell.appendChild(numberValue);
    return;
  }

  cell.setAttribute('t', 'inlineStr');
  const inlineString = sheetDocument.createElementNS(namespace, 'is');
  const text = sheetDocument.createElementNS(namespace, 't');
  text.textContent = String(value);
  if (/^\s|\s$|\s{2,}/.test(String(value))) text.setAttribute('xml:space', 'preserve');
  inlineString.appendChild(text);
  cell.appendChild(inlineString);
};

const clearXmlRange = (sheetDocument: XMLDocument, range: string) => {
  const [start, end] = range.split(':');
  const startCell = parseCellAddress(start);
  const endCell = parseCellAddress(end);
  for (let row = startCell.row; row <= endCell.row; row += 1) {
    const xmlRow = getXmlRow(sheetDocument, row);
    if (!xmlRow) continue;
    for (let col = startCell.col; col <= endCell.col; col += 1) {
      const cell = getXmlCell(xmlRow, col);
      if (cell) clearXmlCell(cell);
    }
  }
};

const replaceXmlMergeCells = (sheetDocument: XMLDocument, ranges: string[]) => {
  const namespace = sheetDocument.documentElement.namespaceURI ?? undefined;
  const existing = getFirstXmlElement(sheetDocument, 'mergeCells');
  const mergeCells = existing ?? sheetDocument.createElementNS(namespace, 'mergeCells');
  Array.from(mergeCells.childNodes).forEach((child) => mergeCells.removeChild(child));
  mergeCells.setAttribute('count', String(ranges.length));

  ranges.forEach((range) => {
    const mergeCell = sheetDocument.createElementNS(namespace, 'mergeCell');
    mergeCell.setAttribute('ref', range);
    mergeCells.appendChild(mergeCell);
  });

  if (!existing) {
    const sheetData = getSheetDataElement(sheetDocument);
    sheetData.parentNode?.insertBefore(mergeCells, sheetData.nextSibling);
  }
};

const setXmlDimension = (sheetDocument: XMLDocument, range: string) => {
  const dimension = getFirstXmlElement(sheetDocument, 'dimension');
  if (dimension) dimension.setAttribute('ref', range);
};

const resolveWorkbookSheetPaths = async (zip: any) => {
  const workbookFile = zip.file('xl/workbook.xml');
  const relsFile = zip.file('xl/_rels/workbook.xml.rels');
  if (!workbookFile || !relsFile) throw new Error('Invalid workbook template');

  const workbookDocument = parseXmlDocument(await workbookFile.async('text'));
  const relsDocument = parseXmlDocument(await relsFile.async('text'));
  const relationships = new Map<string, string>();

  getXmlElements(relsDocument, 'Relationship').forEach((relationship) => {
    const id = relationship.getAttribute('Id');
    const target = relationship.getAttribute('Target');
    if (!id || !target) return;
    const normalized = target.startsWith('/')
      ? target.replace(/^\/+/, '')
      : `xl/${target.replace(/^\.?\//, '')}`;
    relationships.set(id, normalized);
  });

  const sheets = getXmlElements(workbookDocument, 'sheet').map((sheet) => {
    const relationshipId = sheet.getAttribute('r:id') ?? sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    return {
      element: sheet,
      name: sheet.getAttribute('name') ?? '',
      path: relationshipId ? relationships.get(relationshipId) : undefined,
    };
  });

  return { workbookDocument, sheets };
};

const removeExcelCalcChain = async (zip: any) => {
  zip.remove('xl/calcChain.xml');

  const workbookRelsFile = zip.file('xl/_rels/workbook.xml.rels');
  if (workbookRelsFile) {
    const relsDocument = parseXmlDocument(await workbookRelsFile.async('text'));
    getXmlElements(relsDocument, 'Relationship')
      .filter((relationship) => relationship.getAttribute('Type')?.endsWith('/calcChain'))
      .forEach((relationship) => relationship.parentNode?.removeChild(relationship));
    zip.file('xl/_rels/workbook.xml.rels', serializeXmlDocument(relsDocument));
  }

  const contentTypesFile = zip.file('[Content_Types].xml');
  if (contentTypesFile) {
    const contentTypesDocument = parseXmlDocument(await contentTypesFile.async('text'));
    getXmlElements(contentTypesDocument, 'Override')
      .filter((override) => override.getAttribute('PartName') === '/xl/calcChain.xml')
      .forEach((override) => override.parentNode?.removeChild(override));
    zip.file('[Content_Types].xml', serializeXmlDocument(contentTypesDocument));
  }
};

const exportHdTemplateWorkbookPreservingDesign = async (params: {
  rows: any[][];
  storeBlocks: { start: number; end: number; settlement: 'JPY' | 'USD'; royaltyRow: number; usdRow?: number; jpyRow: number }[];
  countrySpans: { label: string; start: number; end: number }[];
  summaryStartRow: number;
  stores: Store[];
  sales: Sale[];
  rates: Record<string, number>;
  fiscalStartYear: number;
  fiscalEndYear: number;
  worksheetName: string;
  filename: string;
}) => {
  const response = await fetch(HD_SALES_TEMPLATE_PATH, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Template request failed: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const mod: any = await import('jszip');
  const JSZip = mod.default ?? mod;
  const zip = await JSZip.loadAsync(buffer);
  const { workbookDocument, sheets } = await resolveWorkbookSheetPaths(zip);
  const firstSheetInfo = sheets[0];
  if (!firstSheetInfo?.path) throw new Error('First worksheet not found in template');
  firstSheetInfo.element.setAttribute('name', params.worksheetName.slice(0, 31));

  const calcPr = getFirstXmlElement(workbookDocument, 'calcPr') ?? workbookDocument.createElementNS(workbookDocument.documentElement.namespaceURI, 'calcPr');
  calcPr.setAttribute('fullCalcOnLoad', '1');
  calcPr.setAttribute('forceFullCalc', '1');
  if (!calcPr.parentNode) workbookDocument.documentElement.appendChild(calcPr);

  const getSheetDocument = async (sheetNameOrIndex: string | number) => {
    const sheetInfo = typeof sheetNameOrIndex === 'number'
      ? sheets[sheetNameOrIndex]
      : sheets.find((sheet) => sheet.name === sheetNameOrIndex);
    if (!sheetInfo?.path) return null;
    const sheetFile = zip.file(sheetInfo.path);
    if (!sheetFile) return null;
    return { sheetInfo, document: parseXmlDocument(await sheetFile.async('text')) };
  };

  const sourceRowForGeneratedRow = (rowNumber: number) => {
    if (rowNumber <= 4) return rowNumber;
    if (rowNumber >= params.summaryStartRow && rowNumber <= params.summaryStartRow + 3) {
      return 39 + (rowNumber - params.summaryStartRow);
    }
    const block = params.storeBlocks.find((item) => rowNumber >= item.start && rowNumber <= item.end);
    if (!block) return Math.min(rowNumber, 42);
    const offset = rowNumber - block.start;
    return block.settlement === 'USD' ? 5 + offset : 20 + offset;
  };

  const firstSheet = await getSheetDocument(0);
  if (!firstSheet) throw new Error('First worksheet XML not found in template');
  const maxFirstSheetRow = Math.max(params.rows.length, 42);
  for (let row = 1; row <= maxFirstSheetRow; row += 1) {
    applyXmlRowTemplate(firstSheet.document, row, sourceRowForGeneratedRow(row), 1, 16);
  }
  for (let row = maxFirstSheetRow + 1; row <= 120; row += 1) {
    const xmlRow = getXmlRow(firstSheet.document, row);
    if (!xmlRow) continue;
    for (let col = 1; col <= 16; col += 1) {
      const cell = getXmlCell(xmlRow, col);
      if (cell) clearXmlCell(cell);
    }
  }
  params.rows.forEach((row, rowIndex) => {
    row.slice(0, 16).forEach((value, colIndex) => {
      setXmlCellValue(firstSheet.document, rowIndex + 1, colIndex + 1, value, sourceRowForGeneratedRow(rowIndex + 1));
    });
  });
  replaceXmlMergeCells(firstSheet.document, [
    'F3:O3',
    ...params.countrySpans.map((span) => `A${span.start}:A${span.end}`),
    ...params.storeBlocks.map((block) => `B${block.start}:B${block.end}`),
    `A${params.summaryStartRow + 3}:B${params.summaryStartRow + 3}`,
  ]);
  setXmlDimension(firstSheet.document, `A1:P${maxFirstSheetRow}`);
  zip.file(firstSheet.sheetInfo.path, serializeXmlDocument(firstSheet.document));

  const royaltySheet = await getSheetDocument('①海外ロイヤリテー請求一覧');
  if (royaltySheet) {
    setXmlCellValue(royaltySheet.document, 1, 2, `海外Royalty請求一覧（HD⇒海外FC）　　${params.fiscalStartYear}.4～${params.fiscalEndYear}.3`);
    clearXmlRange(royaltySheet.document, 'B4:K150');
    calculateHdRoyaltyListRows(params.stores, params.sales, params.rates, params.fiscalStartYear)
      .slice(0, 147)
      .forEach((row, index) => {
        const excelRow = index + 4;
        setXmlCellValue(royaltySheet.document, excelRow, 2, row.invoiceDate, 4);
        setXmlCellValue(royaltySheet.document, excelRow, 3, null, 4);
        setXmlCellValue(royaltySheet.document, excelRow, 4, row.storeName, 4);
        setXmlCellValue(royaltySheet.document, excelRow, 5, row.country, 4);
        setXmlCellValue(royaltySheet.document, excelRow, 6, row.royaltyAmount, 4);
        setXmlCellValue(royaltySheet.document, excelRow, 7, null, 4);
        setXmlCellValue(royaltySheet.document, excelRow, 8, null, 4);
        setXmlCellValue(royaltySheet.document, excelRow, 10, null, 4);
        setXmlCellValue(royaltySheet.document, excelRow, 11, null, 4);
      });
    zip.file(royaltySheet.sheetInfo.path, serializeXmlDocument(royaltySheet.document));
  }

  const exportSheet = await getSheetDocument('③海外請求一覧輸出（食材・備品・その他）');
  if (exportSheet) {
    setXmlCellValue(exportSheet.document, 1, 2, `海外インボイス一覧（HD⇒海外FCお客様）　${params.fiscalStartYear}.4.1～`);
    clearXmlRange(exportSheet.document, 'B4:H50');
    zip.file(exportSheet.sheetInfo.path, serializeXmlDocument(exportSheet.document));
  }

  const krMeetupSheet = await getSheetDocument('KR Meet Up');
  if (krMeetupSheet) {
    clearXmlRange(krMeetupSheet.document, 'A2:G8');
    zip.file(krMeetupSheet.sheetInfo.path, serializeXmlDocument(krMeetupSheet.document));
  }
  const twcSheet = await getSheetDocument('TWC Royalty 相殺 ');
  if (twcSheet) {
    clearXmlRange(twcSheet.document, 'B5:H17');
    zip.file(twcSheet.sheetInfo.path, serializeXmlDocument(twcSheet.document));
  }
  const vietnamSheet = await getSheetDocument('ベトナムRoyalty未入金');
  if (vietnamSheet) {
    clearXmlRange(vietnamSheet.document, 'C3:G40');
    zip.file(vietnamSheet.sheetInfo.path, serializeXmlDocument(vietnamSheet.document));
  }

  const supportSheet = await getSheetDocument('②海外請求一覧（サポート費用）');
  if (supportSheet) {
    setXmlCellValue(supportSheet.document, 1, 2, `海外インボイス一覧（HD⇒海外FCお客様）　${params.fiscalStartYear}.4～${params.fiscalEndYear}.3`);
    clearXmlRange(supportSheet.document, 'B5:H12');
    zip.file(supportSheet.sheetInfo.path, serializeXmlDocument(supportSheet.document));
  }

  zip.file('xl/workbook.xml', serializeXmlDocument(workbookDocument));
  await removeExcelCalcChain(zip);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  downloadBlob(blob, params.filename);
};

const exportGlobalSalesProgressWorkbook = async (
  stores: Store[],
  sales: Sale[],
  fxRates: Record<string, number> | null,
  fxStatus: FxRatesStatus,
  fxSourceText: string,
): Promise<void> => {
  const rates = fxRates ?? FALLBACK_USD_RATES;
  const jpyPerUsd = rates.JPY || FALLBACK_USD_RATES.JPY || 150;
  const fiscalStartYear = getFiscalStartYear();
  const fiscalEndYear = fiscalStartYear + 1;
  const fiscalTerm = fiscalStartYear - 2005;
  const monthKeys = buildFiscalMonthKeys(fiscalStartYear);
  const monthHeaders = ['4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月'];
  const worksheetName = `第${fiscalTerm}期売上推移表（ロイヤリテー管理）`;
  const rows: any[][] = [
    ['グローバル事業本部', ...Array(15).fill('')],
    [`${fiscalStartYear}年4月～${fiscalEndYear}年3月HDに計上  海外売上推移表（為替の相場により売上額は変動いたします。）`, ...Array(15).fill('')],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['国', '店舗名', 'Royalty％', ...monthHeaders, '各項目合計'],
  ];

  const salesByStoreMonth = new Map<string, number>();
  dedupeSalesByStoreDate(sales).forEach((sale) => {
    const monthKey = extractMonthKey(sale.date);
    if (!monthKey) return;
    const key = `${sale.storeId}::${monthKey}`;
    salesByStoreMonth.set(key, (salesByStoreMonth.get(key) ?? 0) + Number(sale.totalAmount || 0));
  });

  const sortedStores = [...stores].sort((a, b) =>
    `${a.country} ${a.city} ${a.name}`.localeCompare(`${b.country} ${b.city} ${b.name}`),
  );

  const storeBlocks: { start: number; end: number; settlement: 'JPY' | 'USD'; royaltyRow: number; usdRow?: number; jpyRow: number }[] = [];
  const countrySpans: { label: string; start: number; end: number }[] = [];
  let activeCountryLabel: string | null = null;
  let activeCountryStart = 0;

  sortedStores.forEach((store) => {
    const countryLabel = getExportCountryLabel(store);
    const blockStartRow = rows.length + 1;
    const settlement = getInvoicePrintProfile(store).invoiceCurrency;
    const localCurrencyCode = getExportLocalCurrencyCode(store);
    const localCurrencyLabel = getExportLocalCurrencyLabel(store);
    const royaltyRate = Number(store.royaltyPercentage || 0) / 100;
    const localRate = getUsdRateForExport(localCurrencyCode, rates);
    const jpyPerLocal = getJpyPerCurrencyForExport(localCurrencyCode, rates);
    const localSalesValues = monthKeys.map((monthKey) => {
      const value = salesByStoreMonth.get(`${store.id}::${monthKey}`);
      return value ? Math.round(value * 100) / 100 : '';
    });

    if (countryLabel !== activeCountryLabel) {
      if (activeCountryLabel && activeCountryStart > 0) {
        countrySpans.push({ label: activeCountryLabel, start: activeCountryStart, end: rows.length });
      }
      activeCountryLabel = countryLabel;
      activeCountryStart = blockStartRow;
    }

    const customerRow = blockStartRow;
    const localRow = blockStartRow + 1;
    const usdRow = settlement === 'USD' ? blockStartRow + 2 : undefined;
    const jpyRow = settlement === 'USD' ? blockStartRow + 3 : blockStartRow + 2;
    const royaltyRow = settlement === 'USD' ? blockStartRow + 4 : blockStartRow + 3;
    const blockEndRow = royaltyRow;
    const rowFormulaCells = (rowNumber: number, formulaBuilder: (col: string) => string) =>
      monthHeaders.map((_, index) => makeFormula(formulaBuilder(XLSX.utils.encode_col(3 + index))));

    rows.push([
      countryLabel,
      getExportStoreName(store),
      '客数',
      ...Array(12).fill(''),
      makeFormula(`SUM(D${customerRow}:O${customerRow})`),
    ]);
    rows.push([
      '',
      '',
      `売上（${localCurrencyLabel}）`,
      ...localSalesValues,
      makeFormula(`SUM(D${localRow}:O${localRow})`),
    ]);

    if (settlement === 'USD' && usdRow) {
      rows.push([
        '',
        '',
        '売上（$）',
        ...rowFormulaCells(usdRow, (col) =>
          localCurrencyCode === 'USD'
            ? `IF(${col}${localRow}="","",${col}${localRow})`
            : `IF(${col}${localRow}="","",${col}${localRow}/${localRate})`,
        ),
        makeFormula(`SUM(D${usdRow}:O${usdRow})`),
      ]);
    }

    rows.push([
      '',
      '',
      '売上（\\）',
      ...rowFormulaCells(jpyRow, (col) =>
        localCurrencyCode === 'JPY'
          ? `IF(${col}${localRow}="","",${col}${localRow})`
          : `IF(${col}${localRow}="","",${col}${localRow}*${jpyPerLocal})`,
      ),
      makeFormula(`SUM(D${jpyRow}:O${jpyRow})`),
    ]);

    const royaltyBaseRow = settlement === 'USD' && usdRow ? usdRow : jpyRow;
    rows.push([
      '',
      '',
      settlement === 'USD'
        ? `Royalty ${Math.round(royaltyRate * 10000) / 100}%`
        : `HD⇒HD Royalty (${Math.round(royaltyRate * 10000) / 100}%)`,
      ...rowFormulaCells(royaltyRow, (col) => `IF(${col}${royaltyBaseRow}="","",${col}${royaltyBaseRow}*${royaltyRate})`),
      makeFormula(`SUM(D${royaltyRow}:O${royaltyRow})`),
    ]);

    storeBlocks.push({ start: blockStartRow, end: blockEndRow, settlement, royaltyRow, usdRow, jpyRow });
  });

  if (activeCountryLabel && activeCountryStart > 0) {
    countrySpans.push({ label: activeCountryLabel, start: activeCountryStart, end: rows.length });
  }

  const summaryStartRow = rows.length + 1;
  const usdRoyaltyRows = storeBlocks.filter((block) => block.settlement === 'USD').map((block) => block.royaltyRow);
  const jpyRoyaltyRows = storeBlocks.filter((block) => block.settlement === 'JPY').map((block) => block.royaltyRow);
  const sumRefs = (rowNumbers: number[], col: string) =>
    rowNumbers.length > 0 ? `SUM(${rowNumbers.map((row) => `${col}${row}`).join(',')})` : '0';

  rows.push([
    '',
    '',
    'USD',
    ...monthHeaders.map((_, index) => makeFormula(sumRefs(usdRoyaltyRows, XLSX.utils.encode_col(3 + index)))),
    makeFormula(`SUM(D${summaryStartRow}:O${summaryStartRow})`),
  ]);
  rows.push([
    '',
    '',
    'USD→JPY換算',
    ...monthHeaders.map((_, index) => {
      const col = XLSX.utils.encode_col(3 + index);
      return makeFormula(`${col}${summaryStartRow}*${jpyPerUsd}`);
    }),
    makeFormula(`SUM(D${summaryStartRow + 1}:O${summaryStartRow + 1})`),
  ]);
  rows.push([
    '',
    '',
    'JPY',
    ...monthHeaders.map((_, index) => makeFormula(sumRefs(jpyRoyaltyRows, XLSX.utils.encode_col(3 + index)))),
    makeFormula(`SUM(D${summaryStartRow + 2}:O${summaryStartRow + 2})`),
  ]);
  rows.push([
    '合計(日本円)',
    '',
    '',
    ...monthHeaders.map((_, index) => {
      const col = XLSX.utils.encode_col(3 + index);
      return makeFormula(`SUM(${col}${summaryStartRow + 1},${col}${summaryStartRow + 2})`);
    }),
    makeFormula(`SUM(D${summaryStartRow + 3}:O${summaryStartRow + 3})`),
  ]);

  const filename = `HD 海外売上推移表(${fiscalStartYear}.4-${fiscalEndYear}.3).xlsx`;
  try {
    await exportHdTemplateWorkbookPreservingDesign({
      rows,
      storeBlocks,
      countrySpans,
      summaryStartRow,
      stores,
      sales,
      rates,
      fiscalStartYear,
      fiscalEndYear,
      worksheetName,
      filename,
    });
    return;
  } catch (error) {
    console.error('HD template-preserving export failed.', error);
    throw new Error(`Template-preserving export failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const sheetRange = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:P1');
  worksheet['!merges'] = [
    { s: { r: 2, c: 5 }, e: { r: 2, c: 14 } },
    ...countrySpans.map((span) => ({ s: { r: span.start - 1, c: 0 }, e: { r: span.end - 1, c: 0 } })),
    ...storeBlocks.map((block) => ({ s: { r: block.start - 1, c: 1 }, e: { r: block.end - 1, c: 1 } })),
    { s: { r: summaryStartRow + 2, c: 0 }, e: { r: summaryStartRow + 2, c: 1 } },
  ];
  worksheet['!cols'] = [
    { wch: 15.9 },
    { wch: 18.2 },
    { wch: 19.1 },
    ...Array(12).fill(null).map(() => ({ wch: 12.5 })),
    { wch: 19.5 },
  ];
  worksheet['!rows'] = rows.map((_, index) => {
    if (index === 0) return { hpt: 21 };
    if (index === 1 || index === 2) return { hpt: 22 };
    if (index === 3) return { hpt: 23.5 };
    return { hpt: 30 };
  });
  (worksheet as any)['!freeze'] = { xSplit: 3, ySplit: 33, topLeftCell: 'D34', activePane: 'bottomRight', state: 'frozen' };

  const titleStyle = excelStyle({ font: { bold: true, sz: 14 }, alignment: { vertical: 'center' } });
  const headerStyle = excelStyle({ font: { bold: true, sz: 12 }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: excelBorder('medium') });
  const countryStyle = excelStyle({ font: { bold: true, sz: 12 }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: excelBorder('medium') });
  const storeStyle = excelStyle({ font: { bold: true, sz: 11 }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: excelBorder('medium') });
  const labelStyle = excelStyle({ alignment: { horizontal: 'left', vertical: 'center', wrapText: true }, border: excelBorder('thin') });
  const valueStyle = excelStyle({ alignment: { horizontal: 'right', vertical: 'center', wrapText: true }, border: excelBorder('thin'), numFmt: '#,##0_);[Red](#,##0)' });
  const dollarStyle = excelStyle({ alignment: { horizontal: 'right', vertical: 'center', wrapText: true }, border: excelBorder('thin'), numFmt: '[$$-409]#,##0.00;[Red]([$$-409]#,##0.00)' });
  const yenStyle = excelStyle({ alignment: { horizontal: 'right', vertical: 'center', wrapText: true }, border: excelBorder('thin'), numFmt: '[$¥-411]#,##0;[Red]([$¥-411]#,##0)' });
  const royaltyLabelStyle = excelStyle({ fill: { patternType: 'solid', fgColor: EXCEL_ROYALTY_FILL }, alignment: { horizontal: 'left', vertical: 'center', wrapText: true }, border: excelBorder('medium') });
  const royaltyValueUsdStyle = excelStyle({ fill: { patternType: 'solid', fgColor: EXCEL_ROYALTY_FILL }, alignment: { horizontal: 'right', vertical: 'center', wrapText: true }, border: excelBorder('medium'), numFmt: '[$$-409]#,##0.00;[Red]([$$-409]#,##0.00)' });
  const royaltyValueJpyStyle = excelStyle({ fill: { patternType: 'solid', fgColor: EXCEL_ROYALTY_FILL }, alignment: { horizontal: 'right', vertical: 'center', wrapText: true }, border: excelBorder('medium'), numFmt: '[$¥-411]#,##0;[Red]([$¥-411]#,##0)' });
  const summaryTitleStyle = excelStyle({ font: { bold: true, sz: 20 }, alignment: { horizontal: 'center', vertical: 'center' }, border: excelBorder('medium') });

  ['A1', 'A2'].forEach((addr) => applyExcelStyle(worksheet, addr, titleStyle));
  for (let c = 0; c <= 15; c += 1) {
    applyExcelStyle(worksheet, XLSX.utils.encode_cell({ r: 3, c }), headerStyle);
  }

  storeBlocks.forEach((block) => {
    applyExcelStyle(worksheet, `A${block.start}`, countryStyle);
    applyExcelStyle(worksheet, `B${block.start}`, storeStyle);
    for (let r = block.start; r <= block.end; r += 1) {
      const label = String(rows[r - 1][2] ?? '');
      const isRoyalty = r === block.royaltyRow;
      applyExcelStyle(worksheet, `C${r}`, isRoyalty ? royaltyLabelStyle : labelStyle);
      for (let c = 3; c <= 15; c += 1) {
        const addr = XLSX.utils.encode_cell({ r: r - 1, c });
        const style = isRoyalty
          ? block.settlement === 'USD'
            ? royaltyValueUsdStyle
            : royaltyValueJpyStyle
          : label.includes('$')
            ? dollarStyle
            : label.includes('\\')
              ? yenStyle
              : valueStyle;
        applyExcelStyle(worksheet, addr, style, style.numFmt);
      }
    }
  });

  for (let r = summaryStartRow; r <= summaryStartRow + 3; r += 1) {
    for (let c = 0; c <= 15; c += 1) {
      const addr = XLSX.utils.encode_cell({ r: r - 1, c });
      const isFinal = r === summaryStartRow + 3;
      const style = c < 2 && isFinal
        ? summaryTitleStyle
        : c >= 3
          ? (r === summaryStartRow ? dollarStyle : yenStyle)
          : labelStyle;
      applyExcelStyle(worksheet, addr, style, style.numFmt);
    }
  }

  // Keep generated range fixed to the HD management-table footprint: A:P.
  worksheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sheetRange.e.r, c: 15 } });

  const sheetName = worksheetName.slice(0, 31);
  const templateWorkbook = await loadHdSalesTemplateWorkbook();
  const workbook = templateWorkbook ?? XLSX.utils.book_new();
  if (templateWorkbook) {
    const previousFirstSheetName = workbook.SheetNames[0];
    const templateFirstSheet = previousFirstSheetName ? templateWorkbook.Sheets[previousFirstSheetName] : undefined;
    applyHdSalesProgressTemplateStyle(worksheet, templateFirstSheet, storeBlocks, summaryStartRow, rows.length);
    if (previousFirstSheetName && previousFirstSheetName !== sheetName) {
      delete workbook.Sheets[previousFirstSheetName];
    }
    workbook.SheetNames[0] = sheetName;
    workbook.Sheets[sheetName] = worksheet;
    populateHdTemplateCompanionSheets(workbook, stores, sales, rates, fiscalStartYear, fiscalEndYear);
  } else {
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  }
  downloadWorkbook(workbook, filename);
};

// --- Components ---

const SalesAnalyticsModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    sales: Sale[];
    stores: Store[];
    fxRates: Record<string, number> | null;
    fxStatus: FxRatesStatus;
    fxSourceText: string;
}> = ({ isOpen, onClose, sales, stores, fxRates, fxStatus, fxSourceText }) => {
    const [activeTab, setActiveTab] = useState<'period' | 'country' | 'store'>('period');

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [isOpen]);

    const salesForAnalytics = useMemo(() => dedupeSalesByStoreDate(sales), [sales]);
    const storeById = useMemo(() => {
        const map = new Map<string, Store>();
        stores.forEach(store => map.set(store.id, store));
        return map;
    }, [stores]);

    const monthOptions = useMemo(() => {
        const keys = new Set<string>();
        salesForAnalytics.forEach((sale) => {
            const key = extractMonthKey(sale.date);
            if (key) keys.add(key);
        });
        return Array.from(keys).sort((a, b) => b.localeCompare(a));
    }, [salesForAnalytics]);

    const [selectedMonth, setSelectedMonth] = useState<string>('latest');

    useEffect(() => {
        if (!isOpen) return;
        if (selectedMonth !== 'all' && selectedMonth !== 'latest' && !monthOptions.includes(selectedMonth)) {
            setSelectedMonth('latest');
        }
    }, [isOpen, monthOptions, selectedMonth]);

    const activeMonthKey = selectedMonth === 'latest'
        ? (monthOptions[0] ?? '')
        : selectedMonth;

    const formatLocalTotals = (localTotals: Record<string, number>) => {
        const entries = Object.entries(localTotals)
            .filter(([, amount]) => Math.abs(amount) > 0)
            .sort(([a], [b]) => a.localeCompare(b));
        if (entries.length === 0) return '—';
        return entries
            .map(([currency, amount]) => `${currency} ${Math.round(amount).toLocaleString()}`)
            .join(' / ');
    };

    const filterSaleByMonth = (sale: Sale) => {
        if (activeTab === 'period') return true;
        if (activeMonthKey === 'all') return true;
        if (!activeMonthKey) return false;
        return extractMonthKey(sale.date) === activeMonthKey;
    };

    const aggregatedData = useMemo(() => {
        const data: Record<string, {
            name: string;
            value: number;
            localTotals: Record<string, number>;
            country?: string;
            city?: string;
            reportCount: number;
        }> = {};

        salesForAnalytics.forEach(sale => {
            if (!filterSaleByMonth(sale)) return;
            const store = storeById.get(sale.storeId);
            if (!store) return;

            const amountJPY = convertToJPY(sale.totalAmount, store.currency, fxRates) ?? 0;

            let key = '';
            let name = '';
            if (activeTab === 'period') {
                key = sale.date.substring(0, 7); // YYYY-MM
                name = key;
            } else if (activeTab === 'country') {
                key = store.country;
                name = store.country;
            } else if (activeTab === 'store') {
                key = store.id;
                name = store.name;
            }

            if (key) {
                if (!data[key]) {
                    data[key] = {
                        name,
                        value: 0,
                        localTotals: {},
                        country: store.country,
                        city: store.city,
                        reportCount: 0,
                    };
                }
                data[key].value += amountJPY;
                data[key].localTotals[store.currency] = (data[key].localTotals[store.currency] || 0) + (sale.totalAmount || 0);
                data[key].reportCount += 1;
            }
        });

        return Object.entries(data)
            .map(([, row]) => row)
            .sort((a, b) => activeTab === 'period' ? a.name.localeCompare(b.name) : b.value - a.value);
    }, [salesForAnalytics, storeById, activeTab, activeMonthKey, fxRates]);

    const selectedMonthLabel = activeTab === 'period'
        ? 'All months'
        : activeMonthKey === 'all'
            ? 'All months'
            : activeMonthKey
                ? formatMonthKeyLabel(activeMonthKey)
                : 'No sales month';

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
                            Local currency and JPY view ({selectedMonthLabel} • {formatFxSourceLabel(fxStatus, fxSourceText)})
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition"><X className="w-6 h-6"/></button>
                </div>

                <div className="p-4 border-b bg-white">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div className="flex flex-wrap gap-2">
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
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase text-gray-400">Month</span>
                            <select
                                value={selectedMonth}
                                onChange={(e) => setSelectedMonth(e.target.value)}
                                disabled={activeTab === 'period'}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold bg-white disabled:bg-gray-100 disabled:text-gray-400"
                            >
                                <option value="latest">Latest month</option>
                                <option value="all">All months</option>
                                {monthOptions.map(monthKey => (
                                    <option key={monthKey} value={monthKey}>{formatMonthKeyLabel(monthKey)}</option>
                                ))}
                            </select>
                        </div>
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
                                            formatter={(value: number) => [`JPY ${value.toLocaleString(undefined, {maximumFractionDigits: 0})}`, 'Revenue (JPY Est.)']}
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
                                            {activeTab === 'store' && <th className="p-4">Location</th>}
                                            <th className="p-4 text-right">Revenue (Local)</th>
                                            <th className="p-4 text-right">Revenue (JPY Est.)</th>
                                            <th className="p-4 text-right">Reports</th>
                                            <th className="p-4 text-right">Contribution</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {aggregatedData.map((item, idx) => {
                                            const total = aggregatedData.reduce((acc, curr) => acc + curr.value, 0);
                                            const percent = total > 0 ? (item.value / total) * 100 : 0;
                                            return (
                                                <tr key={idx} className="hover:bg-gray-50">
                                                    <td className="p-4 font-medium">
                                                        <div className="font-bold text-gray-900">{activeTab === 'period' ? formatMonthKeyLabel(item.name) : item.name}</div>
                                                        {activeTab === 'country' && (
                                                            <div className="text-xs text-gray-500">Country total</div>
                                                        )}
                                                    </td>
                                                    {activeTab === 'store' && (
                                                        <td className="p-4 text-gray-500 text-xs font-medium">
                                                            {item.city}, {item.country}
                                                        </td>
                                                    )}
                                                    <td className="p-4 text-right font-mono text-gray-700">{formatLocalTotals(item.localTotals)}</td>
                                                    <td className="p-4 text-right font-bold">JPY {item.value.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                                                    <td className="p-4 text-right text-gray-500">{item.reportCount}</td>
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

const FinancialsTable: React.FC<{
  stores: Store[];
  sales: Sale[];
  fxRates: Record<string, number> | null;
  fxStatus: FxRatesStatus;
  fxSourceText: string;
  monthKey?: string;
  onExportExcel: () => void;
}> = ({ stores, sales, fxRates, fxStatus, fxSourceText, monthKey, onExportExcel }) => {
  const currentMonthKey = useMemo(() => {
    if (monthKey) return monthKey;
    const monthKeys = dedupeSalesByStoreDate(sales)
      .map((sale) => extractMonthKey(sale.date))
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a));
    return monthKeys[0] ?? formatMonthKey(new Date());
  }, [sales, monthKey]);
  const currentMonthLabel = formatMonthKeyLabel(currentMonthKey);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b flex justify-between items-center bg-gray-50">
            <div>
              <h3 className="font-bold text-lg text-gray-800">Sales Reporting Progress</h3>
              <div className="text-xs text-gray-500 font-medium">
                Daily reported sales and estimated royalty only · {currentMonthLabel} · local currency and JPY
              </div>
            </div>
            <button
              type="button"
              onClick={onExportExcel}
              className="text-xs font-bold bg-white border border-gray-200 px-3 py-1 rounded-lg hover:bg-gray-50 text-gray-600"
            >
              Export Excel
            </button>
        </div>
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
                <thead className="bg-white text-gray-400 font-bold uppercase text-xs border-b">
                    <tr>
                        <th className="p-4 font-extrabold tracking-wider">Store</th>
                        <th className="p-4 text-right font-extrabold tracking-wider">Revenue (Local, {currentMonthLabel})</th>
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
                        const reportStatus = getStoreMonthReportStatus(sales, store.id, currentMonthKey);
                        const isComplete = reportStatus.expected > 0 && reportStatus.missingDates.length === 0;

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
                                    {reportStatus.expected === 0 ? (
                                        <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-wide">
                                            No due dates
                                        </span>
                                    ) : (
                                        <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-wide ${
                                            isComplete
                                                ? 'bg-emerald-100 text-emerald-700'
                                                : 'bg-red-100 text-red-700'
                                        }`}>
                                            {isComplete ? 'Complete' : `${reportStatus.missingDates.length} missing`}
                                        </span>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
        <div className="px-6 py-3 text-[10px] text-gray-400 border-t bg-white">
            {formatFxSourceLabel(fxStatus, fxSourceText)}
        </div>
    </div>
  );
};

const PB_REQUIRED_ITEMS = [
    { id: 'okonomiyaki_sauce', label: 'Okonomiyaki Sauce', keywords: ['okonomiyakisauce', 'okonomisauce'], defaultUnit: 'ml' },
    { id: 'okonomiyaki_mix_flour', label: 'Okonomiyaki Mix Flour', keywords: ['okonomiyakimixflour', 'okonomiyakiflour', 'mixflour'], defaultUnit: 'g' },
    { id: 'shio_dare', label: 'Shio Dare', keywords: ['shiodare', 'siodare', 'siosalt'], defaultUnit: 'ml' },
    { id: 'shoyu_dare', label: 'Shoyu Dare', keywords: ['shoyudare', 'soyudare', 'shoyusauce', 'soydare'], defaultUnit: 'ml' },
] as const;

function normalizeToken(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isPbItemMatch(ingredientName: string, keywords: readonly string[]): boolean {
    const normalized = normalizeToken(ingredientName);
    return keywords.some((k) => normalized.includes(k));
}

const SupplyChainIntelligence: React.FC<{
    stores: Store[];
    sales: Sale[];
    menus: Menu[];
    storeStocks: StoreIngredientStock[];
}> = ({ stores, sales, menus, storeStocks }) => {
    const insight = useMemo(() => {
        const storeNameMap = new Map(stores.map((s) => [s.id, s.name]));
        const menuNameMap = new Map(menus.map((m) => [m.id, m.name]));

        const pbRows = PB_REQUIRED_ITEMS.map((pb) => {
            const matched = storeStocks.filter((row) => isPbItemMatch(row.ingredientName, pb.keywords));
            const firstPerStore = new Map<string, StoreIngredientStock>();
            matched.forEach((row) => {
                if (!firstPerStore.has(row.storeId)) {
                    firstPerStore.set(row.storeId, row);
                }
            });
            const rows = [...firstPerStore.values()];
            const lowRows = rows.filter((row) => {
                const par = Number(row.par ?? 0);
                const reorder = Number(row.reorder ?? 0);
                return reorder > 0 ? par <= reorder : par <= 0;
            });
            const configuredStores = rows.length;
            const missingConfigStores = Math.max(0, stores.length - configuredStores);
            const totalOnHand = rows.reduce((sum, row) => sum + Number(row.par ?? 0), 0);
            const unit = rows[0]?.unit || pb.defaultUnit;
            return {
                id: pb.id,
                label: pb.label,
                configuredStores,
                missingConfigStores,
                lowCount: lowRows.length,
                lowStoreIds: lowRows.map((row) => row.storeId),
                lowStoreNames: lowRows.map((row) => storeNameMap.get(row.storeId) || row.storeId),
                totalOnHand,
                unit,
            };
        });

        const needContactStoreIds = new Set<string>();
        pbRows.forEach((pb) => {
            pb.lowStoreIds.forEach((storeId) => {
                needContactStoreIds.add(storeId);
            });
        });
        const totalAlerts = pbRows.reduce((sum, pb) => sum + pb.lowCount, 0);
        const matrixTotal = stores.length * PB_REQUIRED_ITEMS.length;
        const safeMatrixCount = pbRows.reduce((sum, pb) => sum + Math.max(0, pb.configuredStores - pb.lowCount), 0);
        const coverageScore = matrixTotal > 0 ? Math.round((safeMatrixCount / matrixTotal) * 100) : 100;

        const today = new Date();
        const fromDate = new Date(today);
        fromDate.setDate(today.getDate() - 30);
        const fromKey = formatDate(fromDate);
        const itemQtyMap = new Map<string, number>();
        sales.forEach((sale) => {
            if (sale.date < fromKey) return;
            sale.items.forEach((item) => {
                const label = menuNameMap.get(item.menuId) || item.menuId;
                itemQtyMap.set(label, (itemQtyMap.get(label) || 0) + item.quantity);
            });
        });
        const topSelling = [...itemQtyMap.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

        return {
            pbRows,
            totalAlerts,
            needContactStores: needContactStoreIds.size,
            coverageScore,
            topSelling,
        };
    }, [stores, sales, menus, storeStocks]);

    return (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                <Package className="w-5 h-5"/> Supply Chain Intelligence
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-5 bg-red-50 rounded-xl border border-red-100 relative overflow-hidden">
                    <div className="relative z-10">
                        <div className="text-red-800 font-bold text-xs uppercase tracking-wider mb-1">PB Reorder Alerts</div>
                        <div className="text-2xl font-extrabold text-red-900">{insight.totalAlerts}</div>
                        <div className="text-sm font-medium text-red-700 mt-2">
                            {insight.needContactStores} stores need contact
                        </div>
                    </div>
                    <AlertTriangle className="absolute -right-4 -bottom-4 w-24 h-24 text-red-200 opacity-50 rotate-12" />
                </div>
                <div className="p-5 bg-blue-50 rounded-xl border border-blue-100 relative overflow-hidden">
                    <div className="relative z-10">
                        <div className="text-blue-800 font-bold text-xs uppercase tracking-wider mb-1">Top Selling Item (30d)</div>
                        <div className="text-2xl font-extrabold text-blue-900">
                            {insight.topSelling ? insight.topSelling[0] : 'No data'}
                        </div>
                        <div className="text-sm font-medium text-blue-700 mt-2">
                            {insight.topSelling ? `${insight.topSelling[1].toLocaleString()} qty` : 'Waiting for sales reports'}
                        </div>
                    </div>
                    <TrendingUp className="absolute -right-4 -bottom-4 w-24 h-24 text-blue-200 opacity-50 rotate-12" />
                </div>
                <div className="p-5 bg-purple-50 rounded-xl border border-purple-100 relative overflow-hidden">
                    <div className="relative z-10">
                        <div className="text-purple-800 font-bold text-xs uppercase tracking-wider mb-1">PB Coverage Score</div>
                        <div className="text-2xl font-extrabold text-purple-900">{insight.coverageScore}%</div>
                        <div className="text-sm font-medium text-purple-700 mt-2">Network stock readiness</div>
                    </div>
                    <CheckCircle2 className="absolute -right-4 -bottom-4 w-24 h-24 text-purple-200 opacity-50 rotate-12" />
                </div>
            </div>

            <div className="mt-6 overflow-hidden rounded-xl border border-gray-100">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 uppercase text-xs font-bold">
                        <tr>
                            <th className="p-3 text-left">PB Item</th>
                            <th className="p-3 text-right">Configured Stores</th>
                            <th className="p-3 text-right">Low Stock</th>
                            <th className="p-3 text-right">On Hand (Total)</th>
                            <th className="p-3 text-left">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {insight.pbRows.map((row) => (
                            <tr key={row.id}>
                                <td className="p-3 font-semibold text-gray-900">{row.label}</td>
                                <td className="p-3 text-right font-mono text-gray-700">
                                    {row.configuredStores}/{stores.length}
                                </td>
                                <td className="p-3 text-right font-mono">
                                    <span className={row.lowCount > 0 ? 'text-red-600 font-bold' : 'text-emerald-600 font-bold'}>
                                        {row.lowCount}
                                    </span>
                                </td>
                                <td className="p-3 text-right font-mono text-gray-700">
                                    {row.totalOnHand.toLocaleString()} {row.unit}
                                </td>
                                <td className="p-3 text-xs text-gray-600">
                                    {row.lowCount > 0
                                        ? `Contact: ${row.lowStoreNames.slice(0, 3).join(', ')}${row.lowStoreNames.length > 3 ? '...' : ''}`
                                        : row.missingConfigStores > 0
                                            ? `Need stock setup in ${row.missingConfigStores} store(s)`
                                            : 'No action needed'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const SalesReporter: React.FC<{
  store: Store;
  sales: Sale[];
  menus: Menu[];
  setMenus: SetMenu[];
  categories: string[];
  initialDate: string | null;
  onSave: (sale: Sale) => Promise<void> | void;
  onCancel: () => void;
}> = ({ store, sales, menus, setMenus, categories, initialDate, onSave, onCancel }) => {
  type SalesReportField = 'date' | 'revenue' | 'items' | 'receipt' | 'closedReason';
  type SalesReportFieldErrors = Partial<Record<SalesReportField, string>>;

  const [date, setDate] = useState(initialDate || formatDate(new Date()));
  const [items, setItems] = useState<SaleItem[]>([]); // Legacy/unassigned direct category quantity; new reports derive category totals from menu quantities.
  const [directMenuItems, setDirectMenuItems] = useState<SaleItem[]>([]);
  const [setMenuItems, setSetMenuItems] = useState<SaleSetItem[]>([]);
  const [menuFilter, setMenuFilter] = useState('');
  const [isClosed, setIsClosed] = useState(false);
  const [receiptImage, setReceiptImage] = useState<string | null>(null);
  const [manualRevenue, setManualRevenue] = useState<string>('');
  const [comment, setComment] = useState<string>('');
  const [closedReason, setClosedReason] = useState<string>('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<SalesReportFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [closeStatus, setCloseStatus] = useState<'draft' | 'submitted' | 'approved' | 'reopened'>('draft');
  const [checkingMonthLock, setCheckingMonthLock] = useState(false);
  const monthLocked = closeStatus === 'submitted' || closeStatus === 'approved';

  useEffect(() => {
    if (initialDate) {
      setDate(initialDate);
    } else {
      setDate(formatDate(new Date()));
    }
    setSubmitError(null);
    setFieldErrors({});
  }, [initialDate]);

  const existingSaleForDate = useMemo(() => {
    const rows = sales
      .filter((row) => row.storeId === store.id && row.date === date)
      .sort((a, b) => String(b.id).localeCompare(String(a.id)));
    return rows[0] ?? null;
  }, [sales, store.id, date]);

  useEffect(() => {
    let active = true;
    if (!date || isLocalOwnerPreviewMode()) {
      setCloseStatus('draft');
      setCheckingMonthLock(false);
      return () => {
        active = false;
      };
    }

    setCheckingMonthLock(true);
    const monthStart = `${date.slice(0, 7)}-01`;
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('monthly_close_periods')
          .select('status')
          .eq('store_id', store.id)
          .eq('month_start', monthStart)
          .maybeSingle();
        if (!active) return;
        if (error) {
          console.error('Failed to check monthly close lock', error);
          setSubmitError('Could not verify whether this month is open. Please try again.');
          setCloseStatus('submitted');
          return;
        }
        setCloseStatus((data?.status as 'draft' | 'submitted' | 'approved' | 'reopened' | undefined) ?? 'draft');
      } finally {
        if (active) setCheckingMonthLock(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [date, store.id]);
  const menuByIdForReport = useMemo(
    () => new Map<string, Menu>(menus.map((menu) => [menu.id, menu])),
    [menus],
  );
  const setMenuByIdForReport = useMemo(
    () => new Map<string, SetMenu>(setMenus.map((setMenu) => [setMenu.id, setMenu])),
    [setMenus],
  );

  useEffect(() => {
    if (existingSaleForDate) {
      const existingSetItems = (existingSaleForDate.setItems ?? []).map((item) => ({ ...item }));
      const existingDirectMenuItems = (existingSaleForDate.menuItems ?? []).map((item) => ({ ...item }));
      const directCategoryTotals = new Map<string, number>(
        (existingSaleForDate.items ?? []).map((item) => [item.menuId, Number(item.quantity || 0)]),
      );
      existingSetItems.forEach((setEntry) => {
        const setMenu = setMenuByIdForReport.get(setEntry.setMenuId);
        setMenu?.items.forEach((component) => {
          const componentMenu = menuByIdForReport.get(component.menuId);
          if (!componentMenu) return;
          const includedUnits = Number(setEntry.quantity) * Number(component.quantity);
          const storedTotal = directCategoryTotals.get(componentMenu.category) ?? 0;
          directCategoryTotals.set(componentMenu.category, Math.max(0, storedTotal - includedUnits));
        });
      });
      existingDirectMenuItems.forEach((item) => {
        const menu = menuByIdForReport.get(item.menuId);
        if (!menu) return;
        const remaining = directCategoryTotals.get(menu.category) ?? 0;
        directCategoryTotals.set(menu.category, Math.max(0, remaining - Number(item.quantity || 0)));
      });
      setIsClosed(Boolean(existingSaleForDate.isClosed));
      setReceiptImage(null);
      setManualRevenue(existingSaleForDate.isClosed ? '' : formatDecimalForInput(existingSaleForDate.totalAmount || 0));
      setItems(Array.from(directCategoryTotals.entries())
        .filter(([, quantity]) => quantity > 0)
        .map(([menuId, quantity]) => ({ menuId, quantity })));
      setDirectMenuItems(existingDirectMenuItems);
      setSetMenuItems(existingSetItems);
      setClosedReason(existingSaleForDate.closedReason ?? '');
      setComment(existingSaleForDate.comment ?? '');
      return;
    }
    setIsClosed(false);
    setReceiptImage(null);
    setManualRevenue('');
    setItems([]);
    setDirectMenuItems([]);
    setSetMenuItems([]);
    setClosedReason('');
    setComment('');
  }, [existingSaleForDate, menuByIdForReport, setMenuByIdForReport]);

  useEffect(() => {
    if (isClosed) {
      setReceiptImage(null);
      setManualRevenue('');
      setItems([]);
      setDirectMenuItems([]);
      setSetMenuItems([]);
    }
    setFieldErrors({});
    setSubmitError(null);
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
    setFieldErrors((current) => ({ ...current, items: undefined }));
    setSubmitError(null);
  };

  const handleSetQuantityInput = (setMenuId: string, val: string) => {
    const clean = normalizeNumberInput(val);
    const newQty = clean === '' ? 0 : parseInt(clean, 10);
    if (newQty < 0) return;

    setSetMenuItems((prev) => {
      const existing = prev.find((item) => item.setMenuId === setMenuId);
      if (existing) {
        if (newQty === 0) return prev.filter((item) => item.setMenuId !== setMenuId);
        return prev.map((item) => item.setMenuId === setMenuId ? { ...item, quantity: newQty } : item);
      }
      if (newQty > 0) return [...prev, { setMenuId, quantity: newQty }];
      return prev;
    });
    setFieldErrors((current) => ({ ...current, items: undefined }));
    setSubmitError(null);
  };

  const handleDirectMenuQuantityInput = (menuId: string, val: string) => {
    const clean = normalizeNumberInput(val);
    const newQty = clean === '' ? 0 : parseInt(clean, 10);
    if (newQty < 0) return;
    const currentQty = directMenuItems.find((item) => item.menuId === menuId)?.quantity ?? 0;
    const menu = menuByIdForReport.get(menuId);
    const addedQty = Math.max(0, newQty - currentQty);
    if (menu && addedQty > 0) {
      setItems((current) => {
        const unassigned = current.find((item) => item.menuId === menu.category);
        if (!unassigned) return current;
        const nextQuantity = Math.max(0, Number(unassigned.quantity || 0) - addedQty);
        return nextQuantity > 0
          ? current.map((item) => item.menuId === menu.category ? { ...item, quantity: nextQuantity } : item)
          : current.filter((item) => item.menuId !== menu.category);
      });
    }
    setDirectMenuItems((current) => {
      const existing = current.find((item) => item.menuId === menuId);
      if (existing) {
        if (newQty === 0) return current.filter((item) => item.menuId !== menuId);
        return current.map((item) => item.menuId === menuId ? { ...item, quantity: newQty } : item);
      }
      return newQty > 0 ? [...current, { menuId, quantity: newQty }] : current;
    });
    setFieldErrors((current) => ({ ...current, items: undefined }));
    setSubmitError(null);
  };

  const handleDirectMenuQuantityChange = (menuId: string, delta: number) => {
    const current = directMenuItems.find((item) => item.menuId === menuId)?.quantity ?? 0;
    handleDirectMenuQuantityInput(menuId, String(Math.max(0, current + delta)));
  };

  const handleSetQuantityChange = (setMenuId: string, delta: number) => {
    setSetMenuItems((prev) => {
      const existing = prev.find((item) => item.setMenuId === setMenuId);
      if (existing) {
        const newQty = Math.max(0, existing.quantity + delta);
        if (newQty === 0) return prev.filter((item) => item.setMenuId !== setMenuId);
        return prev.map((item) => item.setMenuId === setMenuId ? { ...item, quantity: newQty } : item);
      }
      if (delta > 0) return [...prev, { setMenuId, quantity: delta }];
      return prev;
    });
    setFieldErrors((current) => ({ ...current, items: undefined }));
    setSubmitError(null);
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
      setFieldErrors((current) => ({ ...current, receipt: undefined }));
    } catch (error) {
      console.error('Failed to process receipt image', error);
      setReceiptImage(null);
      setSubmitError('Failed to process image. Please upload another receipt photo.');
    }
    e.currentTarget.value = '';
  };

  const handleSave = async () => {
    if (monthLocked || checkingMonthLock) {
      setSubmitError(
        monthLocked
          ? 'This month is locked. Ask HQ to reopen it before changing a sales report.'
          : 'Please wait while the month status is checked.',
      );
      return;
    }

    const hasAnyReceipt = Boolean(receiptImage || existingSaleForDate?.hasReceipt);
    const totalAmount = Number(manualRevenue);
    const soldItemQuantity = directMenuItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
      + setMenuItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
      + items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const hasConfiguredSalesItems = menus.length > 0 || setMenus.length > 0;
    const nextFieldErrors: SalesReportFieldErrors = {};

    if (!date) {
      nextFieldErrors.date = 'Select the report date.';
    }
    if (isClosed) {
      if (!closedReason.trim()) {
        nextFieldErrors.closedReason = 'Enter the reason for closure.';
      }
    } else {
      if (manualRevenue.trim() === '' || !Number.isFinite(totalAmount) || totalAmount < 0) {
        nextFieldErrors.revenue = 'Enter the confirmed daily revenue. Enter 0 only when sales were actually zero.';
      }
      if (totalAmount > 0 && hasConfiguredSalesItems && soldItemQuantity <= 0) {
        nextFieldErrors.items = 'Enter at least one single item or course/set quantity.';
      }
      if (!hasAnyReceipt) {
        nextFieldErrors.receipt = 'Upload the receipt or daily sales report image.';
      }
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setSubmitError('The report was not submitted. Complete the required fields marked below.');
      const firstField = (['date', 'closedReason', 'revenue', 'items', 'receipt'] as SalesReportField[])
        .find((field) => nextFieldErrors[field]);
      if (firstField) {
        document.getElementById(`sales-report-${firstField}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    const reason = closedReason.trim();
    const submittedTotalAmount = isClosed ? 0 : totalAmount;
    const normalizedSetItems = isClosed
      ? []
      : setMenuItems
          .filter((item) => item.setMenuId && Number(item.quantity) > 0)
          .map((item) => ({ setMenuId: item.setMenuId, quantity: Number(item.quantity) }));

    const categoryTotals = new Map<string, number>();
    if (!isClosed) {
      directMenuItems
        .filter((item) => item.menuId && Number(item.quantity) > 0)
        .forEach((item) => {
          const menu = menuByIdForReport.get(item.menuId);
          if (!menu) return;
          categoryTotals.set(menu.category, (categoryTotals.get(menu.category) ?? 0) + Number(item.quantity));
        });

      items
        .filter((item) => item.menuId && Number(item.quantity) > 0)
        .forEach((item) => {
          categoryTotals.set(item.menuId, (categoryTotals.get(item.menuId) ?? 0) + Number(item.quantity));
        });

      if (normalizedSetItems.length > 0) {
        const setMenuById = new Map<string, SetMenu>(setMenus.map((setMenu) => [setMenu.id, setMenu]));
        const menuById = new Map<string, Menu>(menus.map((menu) => [menu.id, menu]));
        normalizedSetItems.forEach((setEntry) => {
          const setMenu = setMenuById.get(setEntry.setMenuId);
          if (!setMenu) return;
          setMenu.items.forEach((component) => {
            const targetMenu = menuById.get(component.menuId);
            if (!targetMenu) return;
            const addQty = Number(component.quantity) * Number(setEntry.quantity);
            if (!Number.isFinite(addQty) || addQty <= 0) return;
            categoryTotals.set(targetMenu.category, (categoryTotals.get(targetMenu.category) ?? 0) + addQty);
          });
        });
      }
    }

    const expandedCategoryItems: SaleItem[] = Array.from(categoryTotals.entries()).map(([menuId, quantity]) => ({
      menuId,
      quantity,
    }));

    const newSale: Sale = {
      id: `SALE_${Date.now()}`,
      storeId: store.id,
      date,
      totalAmount: submittedTotalAmount,
      items: isClosed ? [] : expandedCategoryItems,
      menuItems: isClosed
        ? []
        : directMenuItems
          .filter((item) => item.menuId && Number(item.quantity) > 0)
          .map((item) => ({ menuId: item.menuId, quantity: Number(item.quantity) })),
      setItems: isClosed ? [] : normalizedSetItems,
      isClosed,
      receiptImage: isClosed ? undefined : receiptImage || undefined,
      hasReceipt: !isClosed && hasAnyReceipt,
      closedReason: isClosed ? reason : undefined,
      comment: comment.trim() || undefined,
    };
    setSubmitError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await Promise.resolve(onSave(newSale));
    } catch (e) {
      console.error('Failed to submit sales report', e);
      const message = toErrorMessage(e, 'Failed to submit report.');
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const directMenuTotalsByCategory = useMemo(() => {
    const totals = new Map<string, number>();
    directMenuItems.forEach((item) => {
      const menu = menuByIdForReport.get(item.menuId);
      if (!menu) return;
      totals.set(menu.category, (totals.get(menu.category) ?? 0) + Number(item.quantity || 0));
    });
    return totals;
  }, [directMenuItems, menuByIdForReport]);
  const directMenuQuantityById = useMemo(
    () => new Map(directMenuItems.map((item) => [item.menuId, item.quantity])),
    [directMenuItems],
  );
  const categoryBreakdownRows = useMemo(() => categories.map((category) => {
    const menuTotal = directMenuTotalsByCategory.get(category) ?? 0;
    const unassignedTotal = items.find((item) => item.menuId === category)?.quantity ?? 0;
    return {
      category,
      categoryTotal: menuTotal + unassignedTotal,
      menuTotal,
      unassignedTotal,
      matches: unassignedTotal === 0,
    };
  }), [categories, directMenuTotalsByCategory, items]);
  const categoryBreakdownReady = categoryBreakdownRows.every((row) => row.matches);
  const visibleMenus = useMemo(() => {
    const query = menuFilter.trim().toLowerCase();
    return menus
      .filter((menu) => !query
        || menu.name.toLowerCase().includes(query)
        || menu.category.toLowerCase().includes(query))
      .sort((left, right) => left.category.localeCompare(right.category) || left.name.localeCompare(right.name));
  }, [menuFilter, menus]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold">Daily Sales Report</h2>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
        {existingSaleForDate && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 font-semibold">
            Existing report found for {date}. Submitting will update this report.
          </div>
        )}
        <div id="sales-report-date" className="scroll-mt-24">
          <label className="mb-2 flex items-center gap-2 text-sm font-bold text-gray-700">
            Report Date
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-extrabold text-red-700">Required</span>
          </label>
          <input
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setFieldErrors((current) => ({ ...current, date: undefined }));
              setSubmitError(null);
            }}
            aria-invalid={Boolean(fieldErrors.date)}
            className={`w-full rounded-xl border p-3 font-medium outline-none ${
              fieldErrors.date ? 'border-red-400 bg-red-50' : 'border-transparent bg-gray-50'
            }`}
          />
          {fieldErrors.date && <div className="mt-2 text-xs font-bold text-red-600">{fieldErrors.date}</div>}
        </div>

        {monthLocked && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <div className="font-extrabold">
              {closeStatus === 'approved' ? 'Approved month — report editing is locked' : 'Submitted month — report editing is locked'}
            </div>
            <p className="mt-1 text-xs text-amber-800">Ask HQ to reopen this month before correcting the report.</p>
          </div>
        )}

        <fieldset
          disabled={monthLocked || checkingMonthLock}
          className="min-w-0 space-y-6 border-0 p-0 disabled:cursor-not-allowed disabled:opacity-60"
        >
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
            <div id="sales-report-closedReason" className="scroll-mt-24">
              <label className="mb-2 flex items-center gap-2 text-sm font-bold text-gray-700">
                Reason for closure
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-extrabold text-red-700">Required</span>
              </label>
              <textarea
                value={closedReason}
                onChange={(event) => {
                  setClosedReason(event.target.value);
                  setFieldErrors((current) => ({ ...current, closedReason: undefined }));
                  setSubmitError(null);
                }}
                placeholder="Reason for closure (e.g. maintenance)"
                rows={3}
                aria-invalid={Boolean(fieldErrors.closedReason)}
                className={`w-full resize-none rounded-xl border p-4 outline-none focus:border-black ${
                  fieldErrors.closedReason ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50'
                }`}
              />
              {fieldErrors.closedReason && <div className="mt-2 text-xs font-bold text-red-600">{fieldErrors.closedReason}</div>}
            </div>
        )}

        {!isClosed && (
            <div>
              <div id="sales-report-revenue" className="mb-8 scroll-mt-24">
                <label className="mb-2 flex items-center gap-2 text-sm font-bold text-gray-700">
                  Total Daily Revenue ({store.currency})
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-extrabold text-red-700">Required</span>
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.]?[0-9]*"
                  value={manualRevenue}
                  onChange={(event) => {
                    setManualRevenue(normalizeDecimalInput(event.target.value, 2));
                    setFieldErrors((current) => ({ ...current, revenue: undefined }));
                    setSubmitError(null);
                  }}
                  placeholder="Enter total sales amount"
                  aria-invalid={Boolean(fieldErrors.revenue)}
                  className={`w-full rounded-xl border p-4 text-2xl font-bold outline-none focus:border-black ${
                    fieldErrors.revenue ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50'
                  }`}
                />
                {fieldErrors.revenue && <div className="mt-2 text-xs font-bold text-red-600">{fieldErrors.revenue}</div>}
                {!receiptImage && existingSaleForDate?.hasReceipt && (
                  <div className="mt-2 text-xs text-gray-500">Current receipt image will be kept.</div>
                )}
              </div>

              <div className="mb-8">
                <label className="mb-2 flex items-center gap-2 text-sm font-bold text-gray-700">
                  Comments
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-extrabold text-gray-500">Optional</span>
                </label>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Add notes for this report (optional)"
                  rows={3}
                  className="w-full p-4 bg-gray-50 rounded-xl border border-gray-200 focus:border-black outline-none resize-none"
                />
              </div>

            <div
              id="sales-report-items"
              className={`scroll-mt-24 rounded-2xl border p-4 ${
                fieldErrors.items ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold">
                    1. Single Item Quantities
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                      menus.length > 0 || setMenus.length > 0
                        ? 'bg-red-50 text-red-700'
                        : 'bg-gray-200 text-gray-600'
                    }`}>
                      {menus.length > 0 || setMenus.length > 0
                        ? 'Single or course quantity required when revenue is above 0'
                        : 'Quantity entry starts after menus are registered'}
                    </span>
                  </h3>
                  <div className="mt-1 text-xs text-gray-500">
                    Enter each directly sold menu once. Category totals are calculated automatically.
                  </div>
                </div>
                <div className={`self-start rounded-full px-3 py-1 text-xs font-bold ${
                  categoryBreakdownReady
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {categoryBreakdownReady ? 'Category totals automatic' : 'Legacy quantities remain'}
                </div>
              </div>
              {fieldErrors.items && <div className="mt-3 text-xs font-bold text-red-600">{fieldErrors.items}</div>}

              <div className="mt-3 flex flex-wrap gap-2">
                {categoryBreakdownRows
                  .filter((row) => row.categoryTotal > 0 || row.menuTotal > 0)
                  .map((row) => (
                    <div
                      key={row.category}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${
                        row.matches
                          ? 'border-emerald-200 bg-white text-emerald-700'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                      }`}
                    >
                      {row.category}: {row.categoryTotal}
                    </div>
                  ))}
              </div>

              {!categoryBreakdownReady && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="text-xs font-bold text-amber-900">
                    This older report contains category quantities that are not assigned to a menu.
                  </div>
                  <div className="mt-1 text-[11px] text-amber-800">
                    Adding the matching menu quantity below automatically reduces the unassigned amount.
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {categoryBreakdownRows
                      .filter((row) => row.unassignedTotal > 0)
                      .map((row) => (
                        <label key={row.category} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs font-bold text-gray-700">
                          <span>{row.category} unassigned</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={String(row.unassignedTotal)}
                            onChange={(event) => handleQuantityInput(row.category, event.target.value)}
                            className="w-16 rounded-lg border border-amber-200 p-1.5 text-right font-bold outline-none focus:border-black"
                          />
                        </label>
                      ))}
                  </div>
                </div>
              )}

              <label className="relative mt-4 block">
                <span className="sr-only">Search direct menus</span>
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  type="search"
                  value={menuFilter}
                  onChange={(event) => setMenuFilter(event.target.value)}
                  placeholder="Search menu or category"
                  className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-black"
                />
              </label>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {visibleMenus.map((menu) => {
                  const quantity = directMenuQuantityById.get(menu.id) ?? 0;
                  return (
                    <div key={menu.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-3">
                      <div className="min-w-0">
                        <div className="text-xs font-bold leading-4 sm:text-sm">{menu.name}</div>
                        <div className="truncate text-[10px] text-gray-400">{menu.category}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Decrease ${menu.name}`}
                          onClick={() => handleDirectMenuQuantityChange(menu.id, -1)}
                          className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-lg font-bold hover:bg-gray-200"
                        >
                          -
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          aria-label={`${menu.name} direct quantity`}
                          value={String(quantity)}
                          onChange={(event) => handleDirectMenuQuantityInput(menu.id, event.target.value)}
                          className="h-11 w-14 rounded-lg border border-gray-200 px-2 text-center text-base font-bold outline-none focus:border-black"
                        />
                        <button
                          type="button"
                          aria-label={`Increase ${menu.name}`}
                          onClick={() => handleDirectMenuQuantityChange(menu.id, 1)}
                          className="flex h-11 w-11 items-center justify-center rounded-full bg-black text-lg font-bold text-white hover:bg-gray-800"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {visibleMenus.length === 0 && (
                <div className="py-6 text-center text-sm text-gray-400">No menus match this search.</div>
              )}
            </div>

            {setMenus.length > 0 && (
              <>
                <h3 className="font-bold text-lg mt-8 mb-2">2. Course & Set Quantities</h3>
                <div className="text-xs text-gray-500 mb-4">
                  Inventory usage is auto-calculated from each set menu's components.
                </div>
                <div className="space-y-3">
                  {setMenus.map((setMenu) => {
                    const qty = setMenuItems.find((item) => item.setMenuId === setMenu.id)?.quantity || 0;
                    return (
                      <div key={setMenu.id} className="flex flex-col gap-3 border p-3 rounded-xl transition hover:border-black sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-500">
                            <Layers className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="font-bold">{setMenu.name}</div>
                            <div className="text-xs text-gray-500">{setMenu.items.length} menu item(s)</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          <button type="button" aria-label={`Decrease ${setMenu.name}`} onClick={() => handleSetQuantityChange(setMenu.id, -1)} className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-lg font-bold hover:bg-gray-200">-</button>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            className="h-11 w-16 rounded-lg border border-gray-200 px-2 text-center text-lg font-bold outline-none focus:ring-2 focus:ring-black"
                            value={String(qty)}
                            onChange={(e) => handleSetQuantityInput(setMenu.id, e.target.value)}
                          />
                          <button type="button" aria-label={`Increase ${setMenu.name}`} onClick={() => handleSetQuantityChange(setMenu.id, 1)} className="flex h-11 w-11 items-center justify-center rounded-full bg-black text-lg font-bold text-white hover:bg-gray-800">+</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            </div>
        )}

        {!isClosed && (
          <div
            id="sales-report-receipt"
            className={`scroll-mt-24 rounded-xl border-2 border-dashed p-6 text-center ${
              fieldErrors.receipt ? 'border-red-400 bg-red-50' : 'border-gray-300'
            }`}
          >
              <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" id="receipt-upload" />
              <label htmlFor="receipt-upload" className="cursor-pointer flex flex-col items-center gap-2 hover:opacity-70 transition">
                  <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                      <Camera className="w-6 h-6 text-gray-500" />
                  </div>
                  <div>
                      <div className="flex flex-wrap items-center justify-center gap-2 text-sm font-bold text-gray-700">
                        Upload Receipt / Daily Report
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-extrabold text-red-700">Required</span>
                      </div>
                      <div className="text-xs text-gray-400">Click to browse (JPG, PNG)</div>
                  </div>
              </label>
              {receiptImage && (
                  <div className="mt-4 relative inline-block group">
                      <img src={receiptImage} alt="Receipt Preview" className="h-48 rounded-lg border shadow-sm object-contain bg-gray-50" />
                      <button onClick={() => setReceiptImage(null)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition"><X className="w-4 h-4" /></button>
                  </div>
              )}
              {fieldErrors.receipt && <div className="mt-3 text-xs font-bold text-red-600">{fieldErrors.receipt}</div>}
          </div>
        )}
        </fieldset>

        {submitError && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
            {submitError}
          </div>
        )}
        <div className="flex gap-4 pt-4">
            <button onClick={onCancel} className="flex-1 py-3 font-bold text-gray-500 hover:bg-gray-50 rounded-xl">Cancel</button>
            <button
              onClick={handleSave}
              disabled={submitting || checkingMonthLock || monthLocked}
              className="flex-1 rounded-xl bg-black py-3 font-bold text-white shadow-lg hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Report'}
            </button>
        </div>
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
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Single Items & Recipes</h2>
          <p className="text-sm text-gray-500 mt-1">Register each individually sold menu item and the ingredients used in one serving.</p>
        </div>
        <button
          type="button"
          onClick={() => onCreate({
            id: createLocalEntityId('M'),
            storeId: store.id,
            category: '',
            name: 'New Item',
            price: 0,
            recipe: []
          })}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 sm:w-auto"
        >
          <Plus className="w-4 h-4" /> Add Item
        </button>
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 2xl:grid-cols-3">
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
                <div className="absolute right-2 top-2 flex gap-2">
                    <button type="button" aria-label={`Edit ${menu.name}`} onClick={() => onEdit(menu)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm hover:bg-gray-100"><Settings className="w-4 h-4"/></button>
                    <button type="button" aria-label={`Delete ${menu.name}`} onClick={() => onDelete(menu.id)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-red-500 shadow-sm hover:bg-red-50"><Trash2 className="w-4 h-4"/></button>
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

const SetMenuEditor: React.FC<{
    setMenu: SetMenu;
    menus: Menu[];
    onSave: (setMenu: SetMenu) => Promise<void> | void;
    onBack: () => void;
}> = ({ setMenu, menus, onSave, onBack }) => {
    const [editedSet, setEditedSet] = useState<SetMenu>(() => ({
        ...setMenu,
        items: setMenu.items?.length > 0 ? setMenu.items : [{ menuId: '', quantity: 1 }],
    }));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const menuById = useMemo(() => new Map(menus.map((menu) => [menu.id, menu])), [menus]);

    const updateSetItem = (idx: number, next: Partial<{ menuId: string; quantity: number }>) => {
        setEditedSet((prev) => ({
            ...prev,
            items: prev.items.map((item, itemIdx) => itemIdx === idx ? { ...item, ...next } : item),
        }));
    };

    const addSetItemRow = () => {
        setEditedSet((prev) => ({ ...prev, items: [...prev.items, { menuId: '', quantity: 1 }] }));
    };

    const removeSetItemRow = (idx: number) => {
        setEditedSet((prev) => ({ ...prev, items: prev.items.filter((_, itemIdx) => itemIdx !== idx) }));
    };

    const normalizeSetItems = () => {
        const merged = new Map<string, number>();
        editedSet.items.forEach((item) => {
            const menuId = String(item.menuId ?? '').trim();
            const quantity = Number(item.quantity);
            if (!menuId || !Number.isFinite(quantity) || quantity <= 0) return;
            if (!menuById.has(menuId)) return;
            merged.set(menuId, (merged.get(menuId) ?? 0) + quantity);
        });
        return Array.from(merged.entries()).map(([menuId, quantity]) => ({ menuId, quantity }));
    };

    const handleSave = async () => {
        if (saving) return;
        const name = editedSet.name.trim();
        if (!name) {
            setError('Set menu name is required.');
            return;
        }
        const normalizedItems = normalizeSetItems();
        if (normalizedItems.length === 0) {
            setError('Add at least one component menu with quantity > 0.');
            return;
        }
        const price = Number(editedSet.price);
        if (!Number.isFinite(price) || price < 0) {
            setError('Price must be 0 or greater.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await Promise.resolve(onSave({
                ...editedSet,
                name,
                price,
                items: normalizedItems,
            }));
        } catch (e) {
            console.error('Failed to save set menu', e);
            const message = toErrorMessage(e, 'Failed to save set menu.');
            setError(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-3 border-b bg-gray-50 p-4 sm:p-6">
                    <h2 className="min-w-0 text-lg font-bold sm:text-2xl">Edit Set Menu: {setMenu.name || 'New Set Menu'}</h2>
                    <button type="button" aria-label="Close set menu editor" onClick={onBack} className="shrink-0 rounded-full p-2 transition hover:bg-gray-200"><X className="w-6 h-6" /></button>
                </div>
                <div className="p-6 overflow-y-auto space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="mb-1 flex items-center gap-2 text-xs font-bold uppercase text-gray-500">
                                Set Name
                                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] text-red-700">Required</span>
                            </label>
                            <input
                                value={editedSet.name}
                                onChange={(e) => setEditedSet({ ...editedSet, name: e.target.value })}
                                className="w-full p-3 bg-gray-50 rounded-xl font-bold border border-gray-200 focus:border-black outline-none"
                                placeholder="e.g. Family Set A"
                            />
                        </div>
                        <div>
                            <label className="mb-1 flex items-center gap-2 text-xs font-bold uppercase text-gray-500">
                                Set Price
                                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] text-red-700">Required</span>
                            </label>
                            <input
                                type="number"
                                value={Number.isFinite(editedSet.price) ? editedSet.price : 0}
                                onChange={(e) => setEditedSet({ ...editedSet, price: Number(e.target.value || 0) })}
                                className="w-full p-3 bg-gray-50 rounded-xl font-bold border border-gray-200 focus:border-black outline-none"
                            />
                        </div>
                    </div>

                    <div className="pt-2 border-t">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="flex items-center gap-2 text-lg font-bold">
                                Set Components
                                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-extrabold text-red-700">At least 1 required</span>
                            </h3>
                            <button
                                type="button"
                                onClick={addSetItemRow}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-black text-white text-xs font-bold hover:bg-gray-800"
                            >
                                <Plus className="w-3 h-3" />
                                Add Component
                            </button>
                        </div>
                        <div className="space-y-3">
                            {editedSet.items.map((item, idx) => (
                                <div key={`${item.menuId}-${idx}`} className="grid grid-cols-[minmax(0,1fr)_72px_40px] items-center gap-2">
                                    <div>
                                        <select
                                            value={item.menuId}
                                            onChange={(e) => updateSetItem(idx, { menuId: e.target.value })}
                                            className="w-full p-2 rounded-lg border border-gray-300 text-sm bg-white focus:border-black outline-none"
                                        >
                                            <option value="">Select Menu Item</option>
                                            {menus.map((menu) => (
                                                <option key={menu.id} value={menu.id}>
                                                    {menu.name} ({menu.category})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <input
                                            type="number"
                                            min={1}
                                            value={item.quantity}
                                            onChange={(e) => updateSetItem(idx, { quantity: Math.max(0, Number(e.target.value || 0)) })}
                                            className="w-full p-2 rounded-lg border border-gray-300 text-sm bg-white focus:border-black outline-none text-center font-semibold"
                                        />
                                    </div>
                                    <div>
                                        <button
                                            type="button"
                                            onClick={() => removeSetItemRow(idx)}
                                            className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition"
                                            aria-label="Remove component"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {menus.length === 0 && (
                            <div className="mt-3 text-sm text-red-600">
                                No normal menu items found. Add menu items first, then create set menus.
                            </div>
                        )}
                    </div>
                    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
                </div>
                <div className="flex gap-3 border-t bg-gray-50 p-4 sm:justify-end">
                    <button type="button" onClick={onBack} className="flex-1 rounded-xl px-4 py-3 font-bold text-gray-500 transition hover:bg-gray-100 sm:flex-none sm:px-6">Cancel</button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className={`flex-1 rounded-xl bg-black px-4 py-3 font-bold text-white transition sm:flex-none sm:px-6 ${saving ? 'opacity-60 cursor-not-allowed' : 'hover:bg-gray-800'}`}
                    >
                        {saving ? 'Saving...' : 'Save Set Menu'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const SetMenuManager: React.FC<{
    store: Store;
    menus: Menu[];
    setMenus: SetMenu[];
    onEdit: (setMenu: SetMenu) => void;
    onCreate: (setMenu: SetMenu) => void;
    onDelete: (id: string) => void;
}> = ({ store, menus, setMenus, onEdit, onCreate, onDelete }) => {
    const menuById = useMemo(() => new Map(menus.map((menu) => [menu.id, menu])), [menus]);

    return (
        <div>
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-2xl font-bold">Courses & Set Menus</h2>
                    <p className="text-sm text-gray-500 mt-1">Build a course or set from registered single items and specify the quantity of each component.</p>
                </div>
                <button
                    type="button"
                    onClick={() => onCreate({
                        id: createLocalEntityId('SM'),
                        storeId: store.id,
                        name: 'New Set Menu',
                        price: 0,
                        items: [],
                    })}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 sm:w-auto"
                >
                    <Plus className="w-4 h-4" /> Add Set Menu
                </button>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                {setMenus.map((setMenu) => (
                    <div key={setMenu.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition group">
                        <div className="flex justify-between items-start gap-3">
                            <div>
                                <h3 className="font-bold text-lg">{setMenu.name}</h3>
                                <div className="text-xs text-gray-500 mt-1">{setMenu.items.length} component menu(s)</div>
                            </div>
                            <div className="font-bold text-lg">{store.currency} {setMenu.price.toLocaleString()}</div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {setMenu.items.map((item) => {
                                const menu = menuById.get(item.menuId);
                                return (
                                    <span key={`${setMenu.id}-${item.menuId}`} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700 font-semibold">
                                        {menu?.name ?? 'Unknown Menu'} x {item.quantity}
                                    </span>
                                );
                            })}
                            {setMenu.items.length === 0 && (
                                <span className="text-xs text-gray-400">No components configured.</span>
                            )}
                        </div>
                        <div className="mt-4 flex justify-end gap-2 border-t pt-4">
                            <button type="button" onClick={() => onEdit(setMenu)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-bold hover:bg-gray-100"><Settings className="w-4 h-4" /> Edit</button>
                            <button type="button" onClick={() => onDelete(setMenu.id)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-red-100 bg-white px-4 py-2 text-xs font-bold text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /> Delete</button>
                        </div>
                    </div>
                ))}
            </div>
            {setMenus.length === 0 && (
                <div className="text-sm text-gray-400 italic">No set menus yet.</div>
            )}
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
        if (!name || !unit || !newIngQty) {
            setRecipeError('Enter the ingredient name, quantity, and unit before adding it.');
            return;
        }
        const qty = parseFloat(newIngQty);
        if (!Number.isFinite(qty) || qty <= 0) {
            setRecipeError('Ingredient quantity must be greater than 0.');
            return;
        }
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
                        <label className="mb-2 flex items-center gap-2 text-xs font-bold uppercase text-gray-500">
                            Item Image
                            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[9px] text-gray-500">Optional</span>
                        </label>
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
                            <label className="mb-1 flex items-center gap-2 text-xs font-bold uppercase text-gray-500">
                                Name
                                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] text-red-700">Required</span>
                            </label>
                            <input value={editedMenu.name} onChange={e => setEditedMenu({...editedMenu, name: e.target.value})} className="w-full p-3 bg-gray-50 rounded-xl font-bold border border-gray-200 focus:border-black outline-none" />
                        </div>
                        <div>
                            <label className="mb-1 flex items-center gap-2 text-xs font-bold uppercase text-gray-500">
                                Category
                                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] text-red-700">Required</span>
                            </label>
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
                            <label className="mb-1 flex items-center gap-2 text-xs font-bold uppercase text-gray-500">
                                Price
                                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] text-red-700">Required</span>
                            </label>
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
                            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-extrabold text-red-700">At least 1 ingredient required</span>
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
                                    className="bg-black text-white px-4 rounded-lg font-bold text-sm hover:bg-gray-800"
                                    aria-label="Add ingredient to recipe"
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
                                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{recipeError}</div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
                    <button onClick={onBack} className="px-6 py-3 font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition">Cancel</button>
                    <button
                        onClick={async () => {
                            if (savingItem) return;
                            const name = editedMenu.name.trim();
                            if (!name) {
                                setRecipeError('Item name is required.');
                                return;
                            }
                            if (!editedMenu.category.trim() || !categories.includes(editedMenu.category)) {
                                setRecipeError('Select a valid category.');
                                return;
                            }
                            if (!Number.isFinite(editedMenu.price) || editedMenu.price < 0) {
                                setRecipeError('Price must be 0 or greater.');
                                return;
                            }
                            if (editedMenu.recipe.length === 0) {
                                setRecipeError('Add at least one ingredient to the recipe.');
                                return;
                            }
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
                                await Promise.resolve(onSave({ ...editedMenu, name }));
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
    const [formError, setFormError] = useState<string | null>(null);

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
                    <div className="text-center text-[10px] font-extrabold uppercase text-gray-400">Photo · Optional</div>
                    {imageError && <div className="text-sm text-red-600 font-semibold text-center">{imageError}</div>}

                    <div>
                        <label className="mb-1 flex items-center gap-2 text-xs font-bold uppercase text-gray-500">
                            Full Name
                            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] text-red-700">Required</span>
                        </label>
                        <input
                            value={editedEmp.name}
                            onChange={(event) => {
                                setEditedEmp({...editedEmp, name: event.target.value});
                                setFormError(null);
                            }}
                            className="w-full p-3 bg-gray-50 rounded-xl font-bold border border-gray-200 focus:border-black outline-none"
                            placeholder="e.g. John Doe"
                        />
                    </div>

                    <div>
                         <label className="mb-1 flex items-center gap-2 text-xs font-bold uppercase text-gray-500">
                            Position
                            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] text-red-700">Required</span>
                         </label>
                         <select
                            value={editedEmp.position}
                            onChange={(event) => {
                                setEditedEmp({...editedEmp, position: event.target.value});
                                setFormError(null);
                            }}
                            className="w-full p-3 bg-gray-50 rounded-xl font-bold border border-gray-200 focus:border-black outline-none"
                         >
                            <option value="">Select Position</option>
                            {positions.map(p => (
                                <option key={p} value={p}>{p}</option>
                            ))}
                         </select>
                    </div>
                    {formError && (
                        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
                            {formError}
                        </div>
                    )}
                </div>
                <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
                    <button onClick={onBack} className="px-6 py-3 font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition">Cancel</button>
                    <button
                        onClick={() => {
                            const missing = [
                                ...(!editedEmp.name.trim() ? ['full name'] : []),
                                ...(!editedEmp.position.trim() ? ['position'] : []),
                            ];
                            if (missing.length > 0) {
                                setFormError(`Staff was not saved. Enter: ${missing.join(', ')}.`);
                                return;
                            }
                            setFormError(null);
                            onSave({ ...editedEmp, name: editedEmp.name.trim() });
                        }}
                        className="bg-black text-white px-8 py-3 rounded-xl font-bold hover:bg-gray-800 shadow-lg"
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
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-2xl font-bold">Staff Management</h2>
                <button
                    type="button"
                    onClick={() => setEditingEmp({
                        id: createLocalEntityId('E'),
                        storeId: store.id,
                        name: '',
                        position: positions[0] || '',
                        imageUrl: ''
                    })}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 sm:w-auto"
                >
                    <Plus className="w-4 h-4" /> Add Staff
                </button>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 2xl:grid-cols-3">
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
                        <div className="flex shrink-0 gap-2">
                             <button type="button" aria-label={`Edit ${emp.name}`} onClick={() => setEditingEmp(emp)} className="flex h-11 w-11 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"><Settings className="w-4 h-4"/></button>
                             <button type="button" aria-label={`Delete ${emp.name}`} onClick={() => handleDelete(emp.id)} className="flex h-11 w-11 items-center justify-center rounded-full text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4"/></button>
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
    initialMonthKey: string;
    sales: Sale[];
    menus: Menu[];
    setMenus: SetMenu[];
    employees: Employee[];
    ingredients: Ingredient[];
    storeStocks: StoreIngredientStock[];
    allStores: Store[];
    categories: string[];
    standardIngredients: { name: string; unit: string; par?: number; reorder?: number }[];
    currencies: string[];
    positions: string[];
    fxRates: Record<string, number> | null;
    fxStatus: FxRatesStatus;
    fxSourceText: string;
    onRefreshFx: () => Promise<FxRatesPayload>;
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
    onUpdateSetMenu: (setMenu: SetMenu) => void;
    onCreateSetMenu: (setMenu: SetMenu) => void;
    onDeleteSetMenu: (id: string) => void;
    onUpdateEmployees: (storeId: string, employees: Employee[]) => void;
    onAddIngredient: (ing: Ingredient) => Promise<void> | void;
    hqLocale: HQLocale;
    onHqLocaleChange: (locale: HQLocale) => void;
}> = ({ store, initialMonthKey, sales, menus, setMenus, employees, ingredients, storeStocks, allStores, categories, standardIngredients, currencies, positions, fxRates, fxStatus, fxSourceText, onRefreshFx, salesLookbackLabel, onLoadMoreSales, onBack, onUpdateStore, onSaveStoreStocks, onMergeStores, onDeleteStore, onUpdateMenu, onCreateMenu, onDeleteMenu, onUpdateSetMenu, onCreateSetMenu, onDeleteSetMenu, onUpdateEmployees, onAddIngredient, hqLocale, onHqLocaleChange }) => {
    const storeMenus = menus.filter(m => m.storeId === store.id);
    const storeSetMenus = setMenus.filter(sm => sm.storeId === store.id);
    const storeEmployees = employees.filter(e => e.storeId === store.id);
    const currencyOptions = useMemo(
        () => Array.from(new Set([store.currency, ...currencies].filter(Boolean))).sort(),
        [currencies, store.currency],
    );
    const storeSales = useMemo(() => sales.filter(s => s.storeId === store.id), [sales, store.id]);
    const canonicalStoreSales = useMemo(
        () => dedupeSalesByStoreDate(storeSales),
        [storeSales]
    );
    const sortedStoreSales = useMemo(
        () => [...canonicalStoreSales].sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id))),
        [canonicalStoreSales]
    );
    const isTestStore = store.country.trim().toUpperCase() === 'TEST' || store.id.startsWith('TEST_');
    const testDataMonthKey = isTestStore && sortedStoreSales.length > 0
        ? extractMonthKey(sortedStoreSales[0].date)
        : null;
    const defaultSalesMonthKey = testDataMonthKey || initialMonthKey || formatMonthKey(new Date());
    const salesMonthOptions = useMemo(() => {
        const keys = new Set<string>([defaultSalesMonthKey]);
        sortedStoreSales.forEach((sale) => {
            const key = extractMonthKey(sale.date);
            if (key) keys.add(key);
        });
        return Array.from(keys).sort((a, b) => b.localeCompare(a));
    }, [sortedStoreSales, defaultSalesMonthKey]);
    const [salesMonthFilter, setSalesMonthFilter] = useState<string>(defaultSalesMonthKey);
    const visibleStoreSales = useMemo(() => {
        if (salesMonthFilter === 'all') return sortedStoreSales;
        return sortedStoreSales.filter((sale) => extractMonthKey(sale.date) === salesMonthFilter);
    }, [sortedStoreSales, salesMonthFilter]);
    const testMonthSales = useMemo(
        () => isTestStore
            ? canonicalStoreSales.filter((sale) => extractMonthKey(sale.date) === defaultSalesMonthKey)
            : [],
        [canonicalStoreSales, defaultSalesMonthKey, isTestStore],
    );
    const testMonthSalesTotal = useMemo(
        () => testMonthSales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0),
        [testMonthSales],
    );
    const [editingMenu, setEditingMenu] = useState<Menu | null>(null);
    const [editingSetMenu, setEditingSetMenu] = useState<SetMenu | null>(null);
    const [viewingReceipt, setViewingReceipt] = useState<string | null>(null);
    const receiptCacheRef = useRef<Record<string, string>>({});
    const [receiptLoadingId, setReceiptLoadingId] = useState<string | null>(null);
    const [receiptError, setReceiptError] = useState<string | null>(null);
    const [editingSaleAmountId, setEditingSaleAmountId] = useState<string | null>(null);
    const [editingSaleAmountDraft, setEditingSaleAmountDraft] = useState<string>('');
    const [saleAmountSaving, setSaleAmountSaving] = useState(false);
    const [saleAmountError, setSaleAmountError] = useState<string | null>(null);
    const [saleAmountOverrides, setSaleAmountOverrides] = useState<Record<string, number>>({});
    const missingDates = useMemo(() => getMissingDates(sales, store.id), [sales, store.id]);
    const missingDatesAll = useMemo(() => getMissingDates(sales, store.id, 120), [sales, store.id]);
    const missingDateSet = useMemo(() => new Set(missingDatesAll), [missingDatesAll]);
    const submittedDateSet = useMemo(() => new Set(canonicalStoreSales.map(s => s.date)), [canonicalStoreSales]);
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
    const [showReminderComposer, setShowReminderComposer] = useState(false);
    const [reminderDate, setReminderDate] = useState<string | null>(null);
    const [selectedReminderEmails, setSelectedReminderEmails] = useState<string[]>([]);
    const [reminderError, setReminderError] = useState<string | null>(null);
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
    const [invoiceMonthKey, setInvoiceMonthKey] = useState<string>(() => formatMonthKey(new Date()));
    const invoicePrintProfile = useMemo(() => getInvoicePrintProfile(store), [store.id, store.name, store.country, store.currency]);
    const [invoiceCurrency, setInvoiceCurrency] = useState<'JPY' | 'USD'>(invoicePrintProfile.invoiceCurrency);
    const defaultInvoiceSummaryMode = useMemo<'royalty_only' | 'withholding' | 'china_tax'>(() => (
        invoicePrintProfile.summaryMode
    ), [invoicePrintProfile.summaryMode]);
    const [invoiceSummaryMode, setInvoiceSummaryMode] = useState<'royalty_only' | 'withholding' | 'china_tax'>(defaultInvoiceSummaryMode);
    const [invoiceNumber, setInvoiceNumber] = useState<string>('');
    const [invoiceNumberEdited, setInvoiceNumberEdited] = useState(false);
    const [invoiceMinimumDraft, setInvoiceMinimumDraft] = useState<string>(invoicePrintProfile.minimumRoyalty);
    const defaultWithholdingRateDraft = useMemo(() => (
        invoicePrintProfile.withholdingRate
    ), [invoicePrintProfile.withholdingRate]);
    const [invoiceWithholdingTaxRateDraft, setInvoiceWithholdingTaxRateDraft] = useState<string>(defaultWithholdingRateDraft);
    const [invoiceChinaVatRateDraft, setInvoiceChinaVatRateDraft] = useState<string>('6');
    const [invoiceChinaIncomeTaxRateDraft, setInvoiceChinaIncomeTaxRateDraft] = useState<string>('10');
    const [invoiceBankChargeDraft, setInvoiceBankChargeDraft] = useState<string>(invoicePrintProfile.bankCharge);
    const [invoiceBankChargeLabel, setInvoiceBankChargeLabel] = useState<string>(invoicePrintProfile.bankChargeLabel);
    const [invoiceToDraft, setInvoiceToDraft] = useState<string>(invoicePrintProfile.buyerText);
    const [invoiceSpecialNote, setInvoiceSpecialNote] = useState<string>(invoicePrintProfile.specialNote);
    const [invoiceError, setInvoiceError] = useState<string | null>(null);
    const [invoiceGenerating, setInvoiceGenerating] = useState(false);
    const [invoiceManualFxDraft, setInvoiceManualFxDraft] = useState<string>('');
    const [detailSection, setDetailSection] = useState<'sales' | 'close' | 'inventory' | 'invoice' | 'menu' | 'staff' | 'accounts'>('sales');
    const [menuSection, setMenuSection] = useState<'items' | 'sets'>('items');
    const hqNavReadyRef = useRef(false);
    const hqPopLockRef = useRef(false);

    useEffect(() => {
        setSalesMonthFilter(defaultSalesMonthKey);
    }, [store.id, defaultSalesMonthKey]);

    useEffect(() => {
        setInvoiceWithholdingTaxRateDraft(defaultWithholdingRateDraft);
    }, [defaultWithholdingRateDraft]);

    useEffect(() => {
        setInvoiceSummaryMode(defaultInvoiceSummaryMode);
    }, [defaultInvoiceSummaryMode]);

    useEffect(() => {
        setInvoiceCurrency(invoicePrintProfile.invoiceCurrency);
        setInvoiceMinimumDraft(invoicePrintProfile.minimumRoyalty);
        setInvoiceBankChargeDraft(invoicePrintProfile.bankCharge);
        setInvoiceBankChargeLabel(invoicePrintProfile.bankChargeLabel);
        setInvoiceToDraft(invoicePrintProfile.buyerText);
        setInvoiceSpecialNote(invoicePrintProfile.specialNote);
        setInvoiceChinaVatRateDraft('6');
        setInvoiceChinaIncomeTaxRateDraft('10');
    }, [store.id, invoicePrintProfile]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const url = new URL(window.location.href);
        const querySection = url.searchParams.get('hs');
        const queryMenuSection = url.searchParams.get('hm');
        const fromQuerySection = (
            querySection === 'sales' ||
            querySection === 'close' ||
            querySection === 'inventory' ||
            querySection === 'invoice' ||
            querySection === 'menu' ||
            querySection === 'staff' ||
            querySection === 'accounts'
        ) ? querySection : null;
        const fromQueryMenuSection = queryMenuSection === 'sets' ? 'sets' : (queryMenuSection === 'items' ? 'items' : null);

        const state = window.history.state as { screen?: string; storeId?: string; section?: string; menuSection?: string } | null;
        const fromState = state && state.screen === 'hq-detail' && state.storeId === store.id
            ? {
                section: (
                    state.section === 'sales' ||
                    state.section === 'close' ||
                    state.section === 'inventory' ||
                    state.section === 'invoice' ||
                    state.section === 'menu' ||
                    state.section === 'staff' ||
                    state.section === 'accounts'
                ) ? state.section : null,
                menuSection: state.menuSection === 'sets' ? 'sets' : (state.menuSection === 'items' ? 'items' : null),
            }
            : null;

        const restoredSection = fromQuerySection ?? fromState?.section ?? 'sales';
        const restoredMenuSection = fromQueryMenuSection ?? fromState?.menuSection ?? 'items';

        hqPopLockRef.current = true;
        setDetailSection(restoredSection);
        setMenuSection(restoredMenuSection);

        window.history.replaceState(
            { ...(window.history.state ?? {}), screen: 'hq-detail', storeId: store.id, section: restoredSection, menuSection: restoredMenuSection },
            '',
            `${url.pathname}${url.search}${url.hash}`
        );
        hqNavReadyRef.current = true;
    }, [store.id]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!hqNavReadyRef.current) return;
        if (hqPopLockRef.current) {
            hqPopLockRef.current = false;
            return;
        }
        window.history.replaceState(
            { ...(window.history.state ?? {}), screen: 'hq-detail', storeId: store.id, section: detailSection, menuSection },
            ''
        );
    }, [store.id, detailSection, menuSection]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!hqNavReadyRef.current) return;
        const url = new URL(window.location.href);
        url.searchParams.set('hs', detailSection);
        if (detailSection === 'menu') {
            url.searchParams.set('hm', menuSection);
        } else {
            url.searchParams.delete('hm');
        }
        window.history.replaceState(
            { ...(window.history.state ?? {}), screen: 'hq-detail', storeId: store.id, section: detailSection, menuSection },
            '',
            `${url.pathname}${url.search}${url.hash}`
        );
    }, [store.id, detailSection, menuSection]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onPopState = (e: PopStateEvent) => {
            const state = e.state as { screen?: string; storeId?: string; section?: string; menuSection?: string } | null;
            if (!state || state.screen !== 'hq-detail' || state.storeId !== store.id) {
                return;
            }
            hqPopLockRef.current = true;
            setDetailSection(
                state.section === 'sales' ||
                state.section === 'close' ||
                state.section === 'inventory' ||
                state.section === 'invoice' ||
                state.section === 'menu' ||
                state.section === 'staff' ||
                state.section === 'accounts'
                    ? state.section
                    : 'sales'
            );
            setMenuSection(state.menuSection === 'sets' ? 'sets' : 'items');
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [store.id]);

    const defaultInvoiceNumber = useMemo(() => {
        const monthToken = (invoiceMonthKey || formatMonthKey(new Date())).replace('-', '');
        const storeToken = (store.id || 'STORE').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(-4) || 'STORE';
        return `CHDR-${monthToken}-${storeToken}`;
    }, [invoiceMonthKey, store.id]);

    useEffect(() => {
        if (!invoiceNumberEdited) {
            setInvoiceNumber(defaultInvoiceNumber);
        }
    }, [defaultInvoiceNumber, invoiceNumberEdited]);

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

    const startEditSaleAmount = (sale: Sale) => {
        if (sale.isClosed) return;
        const current = saleAmountOverrides[sale.id] ?? sale.totalAmount;
        setEditingSaleAmountId(sale.id);
        setEditingSaleAmountDraft(formatDecimalForInput(current));
        setSaleAmountError(null);
    };

    const cancelEditSaleAmount = () => {
        setEditingSaleAmountId(null);
        setEditingSaleAmountDraft('');
        setSaleAmountError(null);
    };

    const saveSaleAmount = async (sale: Sale) => {
        const nextAmount = parseFloat(editingSaleAmountDraft);
        if (!Number.isFinite(nextAmount) || nextAmount < 0) {
            setSaleAmountError('Enter a valid amount (0 or more).');
            return;
        }
        setSaleAmountSaving(true);
        setSaleAmountError(null);
        try {
            const { error } = await supabase
                .from('sales')
                .update({ total_amount: nextAmount })
                .eq('id', sale.id);
            if (error) throw error;
            setSaleAmountOverrides((prev) => ({ ...prev, [sale.id]: nextAmount }));
            setEditingSaleAmountId(null);
            setEditingSaleAmountDraft('');
        } catch (e) {
            console.error('Failed to update sale amount', e);
            const msg = e instanceof Error ? e.message : 'Failed to update amount.';
            setSaleAmountError(msg);
        } finally {
            setSaleAmountSaving(false);
        }
    };

    useEffect(() => {
        setRoyaltyDraft(String(store.royaltyPercentage ?? 0));
    }, [store.royaltyPercentage]);

    useEffect(() => {
        setCurrencyDraft(store.currency || '');
    }, [store.currency]);

    useEffect(() => {
        setEditingSaleAmountId(null);
        setEditingSaleAmountDraft('');
        setSaleAmountError(null);
        setSaleAmountOverrides({});
    }, [store.id]);

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

    const reminderRecipients = useMemo(() => {
        const seen = new Set<string>();
        const rows: { email: string; name: string; label: string }[] = [];

        const pushRecipient = (email: string | null | undefined, name?: string | null, isPrimary?: boolean) => {
            const normalized = (email ?? '').trim();
            if (!normalized) return;
            const key = normalized.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            const displayName = (name ?? '').trim();
            const label = displayName
                ? `${displayName} (${normalized})${isPrimary ? ' - Primary' : ''}`
                : `${normalized}${isPrimary ? ' - Primary' : ''}`;
            rows.push({ email: normalized, name: displayName, label });
        };

        const primaryOwner = owners.find((owner) => owner.email.toLowerCase() === store.ownerEmail.toLowerCase());
        pushRecipient(store.ownerEmail, primaryOwner?.name ?? null, true);
        owners.forEach((owner) => pushRecipient(owner.email, owner.name, false));

        return rows;
    }, [owners, store.ownerEmail]);

    const buildReminderEmailPayload = (date: string) => {
        const subject = encodeURIComponent(`Missing Daily Report: ${store.name} (${date})`);
        const body = encodeURIComponent(
            `Hello,\n\nPlease submit the daily sales report for ${date}.\n\nStore: ${store.name}\nLocation: ${store.city}, ${store.country}\n\nThank you.`
        );
        return { subject, body };
    };

    const openEmailReminder = (date: string) => {
        const defaults = reminderRecipients.map((recipient) => recipient.email);
        if (defaults.length === 0) {
            setEmailInfo('No linked email addresses found for this store.');
            window.setTimeout(() => setEmailInfo(null), 3000);
            return;
        }
        setReminderDate(date);
        setSelectedReminderEmails(defaults);
        setReminderError(null);
        setShowReminderComposer(true);
    };

    const toggleReminderRecipient = (email: string) => {
        setSelectedReminderEmails((prev) => (
            prev.includes(email)
                ? prev.filter((item) => item !== email)
                : [...prev, email]
        ));
    };

    const closeReminderComposer = () => {
        setShowReminderComposer(false);
        setReminderDate(null);
        setSelectedReminderEmails([]);
        setReminderError(null);
    };

    const openReminderDraft = (mode: 'gmail' | 'mailto') => {
        if (!reminderDate) return;
        if (selectedReminderEmails.length === 0) {
            setReminderError('Select at least one email address.');
            return;
        }
        const recipients = selectedReminderEmails.join(',');
        const { subject, body } = buildReminderEmailPayload(reminderDate);
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipients)}&su=${subject}&body=${body}`;
        const mailtoUrl = `mailto:${recipients}?subject=${subject}&body=${body}`;
        const targetUrl = mode === 'gmail' ? gmailUrl : mailtoUrl;
        const win = window.open(targetUrl, '_blank', 'noopener,noreferrer');
        if (!win && mode === 'gmail') {
            window.location.href = mailtoUrl;
        }
        setEmailInfo(`Email draft opened for ${selectedReminderEmails.join(', ')} (${reminderDate}).`);
        window.setTimeout(() => setEmailInfo(null), 3000);
        closeReminderComposer();
    };

    const copyReminderEmails = async () => {
        if (selectedReminderEmails.length === 0) {
            setReminderError('Select at least one email address.');
            return;
        }
        try {
            await navigator.clipboard.writeText(selectedReminderEmails.join(', '));
            setEmailInfo(`Recipient list copied: ${selectedReminderEmails.join(', ')}`);
            window.setTimeout(() => setEmailInfo(null), 3000);
            setReminderError(null);
        } catch (e) {
            console.error('Failed to copy recipient list', e);
            setReminderError('Failed to copy recipient list.');
        }
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

    const invoiceMonthOptions = useMemo(() => {
        const keys = new Set<string>();
        keys.add(formatMonthKey(new Date()));
        storeSales.forEach(sale => {
            if (sale.date?.length >= 7) keys.add(sale.date.slice(0, 7));
        });
        return [...keys].sort((a, b) => b.localeCompare(a));
    }, [storeSales]);

    useEffect(() => {
        if (invoiceMonthOptions.length === 0) return;
        if (!invoiceMonthOptions.includes(invoiceMonthKey)) {
            setInvoiceMonthKey(invoiceMonthOptions[0]);
        }
    }, [invoiceMonthKey, invoiceMonthOptions]);

    const computeInvoiceSummary = useCallback((ratesForCalc: Record<string, number> | null) => {
        const monthSales = storeSales.filter(s => s.date.startsWith(invoiceMonthKey));
        const localSalesTotal = monthSales.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
        const convertedSales = convertAmountByUsdRates(localSalesTotal, store.currency, invoiceCurrency, ratesForCalc);
        const royaltyRate = store.royaltyPercentage || 0;
        const rawSalesRoyalty = convertedSales === null ? null : (convertedSales * royaltyRate) / 100;
        const salesRoyalty = rawSalesRoyalty === null
            ? null
            : invoiceCurrency === 'USD'
                ? Math.round(rawSalesRoyalty * 100) / 100
                : Math.round(rawSalesRoyalty);
        const minimumRoyalty = parseMoneyInput(invoiceMinimumDraft);
        const requestedWithholdingRate = parsePercentInput(invoiceWithholdingTaxRateDraft);
        const withholdingRate = invoiceSummaryMode === 'withholding' ? requestedWithholdingRate : 0;
        const chinaVatRate = invoiceSummaryMode === 'china_tax' ? parsePercentInput(invoiceChinaVatRateDraft) : 0;
        const chinaIncomeTaxRate = invoiceSummaryMode === 'china_tax' ? parsePercentInput(invoiceChinaIncomeTaxRateDraft) : 0;
        const bankCharge = parseMoneyInput(invoiceBankChargeDraft);
        const royaltyBase = salesRoyalty === null ? 0 : Math.max(salesRoyalty, minimumRoyalty);
        const chinaTaxBase = invoiceSummaryMode === 'china_tax'
            ? Math.max(0, Math.round(royaltyBase / Math.max(1, 1 + (chinaVatRate / 100))))
            : 0;
        const chinaVatTax = invoiceSummaryMode === 'china_tax'
            ? Math.max(0, royaltyBase - chinaTaxBase)
            : 0;
        const chinaIncomeTax = invoiceSummaryMode === 'china_tax'
            ? Math.max(0, Math.floor((chinaTaxBase * chinaIncomeTaxRate) / 100))
            : 0;
        const chinaTaxTotal = invoiceSummaryMode === 'china_tax'
            ? chinaVatTax + chinaIncomeTax
            : 0;
        const withholdingTax = invoiceSummaryMode === 'china_tax'
            ? chinaTaxTotal
            : Math.round((royaltyBase * withholdingRate) / 100);
        const totalDue = Math.max(0, royaltyBase - withholdingTax + bankCharge);
        return {
            monthSales,
            localSalesTotal,
            convertedSales,
            royaltyRate,
            salesRoyalty,
            minimumRoyalty,
            withholdingRate,
            withholdingTax,
            bankCharge,
            royaltyBase,
            chinaVatRate,
            chinaIncomeTaxRate,
            chinaTaxBase,
            chinaVatTax,
            chinaIncomeTax,
            chinaTaxTotal,
            totalDue,
        };
    }, [
        storeSales,
        invoiceMonthKey,
        store.currency,
        invoiceCurrency,
        store.royaltyPercentage,
        invoiceMinimumDraft,
        invoiceSummaryMode,
        invoiceWithholdingTaxRateDraft,
        invoiceChinaVatRateDraft,
        invoiceChinaIncomeTaxRateDraft,
        invoiceBankChargeDraft,
    ]);

    const invoiceSummary = useMemo(() => computeInvoiceSummary(
        applyManualFxRate(fxRates, store.currency, invoiceCurrency, parseManualFxRate(invoiceManualFxDraft))
    ), [computeInvoiceSummary, fxRates, store.currency, invoiceCurrency, invoiceManualFxDraft]);

    const handleGenerateInvoicePdf = async () => {
        setInvoiceError(null);
        setInvoiceGenerating(true);
        if (!invoiceMonthKey) {
            setInvoiceError('Select invoice month.');
            setInvoiceGenerating(false);
            return;
        }

        let ratesForInvoice = fxRates;
        let sourceForInvoice = fxSourceText;
        try {
            const refreshed = await onRefreshFx();
            ratesForInvoice = refreshed.rates;
            sourceForInvoice = refreshed.sourceText;
        } catch (e) {
            if (!ratesForInvoice) {
                setInvoiceError('Failed to refresh FX rates and no cached FX rates are available.');
                setInvoiceGenerating(false);
                return;
            }
            sourceForInvoice = `Cached ${sourceForInvoice}`;
        }

        const manualRate = parseManualFxRate(invoiceManualFxDraft);
        const effectiveRates = applyManualFxRate(ratesForInvoice, store.currency, invoiceCurrency, manualRate);
        const summaryForInvoice = computeInvoiceSummary(effectiveRates);
        const sourceLabel = manualRate
            ? `FX: Manual ${store.currency}/${invoiceCurrency} ${manualRate}`
            : formatFxSourceLabel('ok', sourceForInvoice);

        if (summaryForInvoice.convertedSales === null || summaryForInvoice.salesRoyalty === null) {
            setInvoiceError(`FX rate not available for ${store.currency} -> ${invoiceCurrency}.`);
            setInvoiceGenerating(false);
            return;
        }

        const issueDate = new Date();
        const invoiceNo = invoiceNumber.trim() || defaultInvoiceNumber;
        const monthLabel = formatInvoiceMonthCell(invoiceMonthKey);
        const locationText = invoicePrintProfile.locationText || `${store.country} / ${store.name}`;
        const amountSymbol = invoiceCurrency === 'JPY' ? '¥' : '$';
        const salesCurrencyLabel = invoiceCurrency === 'JPY' ? 'Sales JPY' : 'Sales USD';
        const formatAmount = (value: number) => `${amountSymbol}${value.toLocaleString(undefined, {
            minimumFractionDigits: invoiceCurrency === 'USD' ? 2 : 0,
            maximumFractionDigits: invoiceCurrency === 'USD' ? 2 : 0,
        })}`;
        const bankChargeTitle = invoiceBankChargeLabel.trim() || 'Bank Charge';
        const salesMonthText = monthLabel;
        const rowAmount = summaryForInvoice.salesRoyalty;
        const salesLocalText = `${store.currency} ${summaryForInvoice.localSalesTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
        const fxSalesText = formatAmount(summaryForInvoice.convertedSales);
        const royaltyRateText = invoiceCurrency === 'USD'
            ? `${summaryForInvoice.royaltyRate.toFixed(1)}%`
            : `${summaryForInvoice.royaltyRate}%`;
        const minimumText = formatAmount(summaryForInvoice.minimumRoyalty);
        const withholdingTaxText = formatAmount(summaryForInvoice.withholdingTax);
        const totalText = formatAmount(summaryForInvoice.totalDue);
        const bankChargeText = formatAmount(summaryForInvoice.bankCharge);
        const buyerText = invoiceToDraft.trim() || store.name;
        const useChinaCompactLayout = invoiceSummaryMode === 'china_tax';
        const showWithholdingTax = invoiceSummaryMode !== 'royalty_only';
        const showChinaTaxBreakdown = invoiceSummaryMode === 'china_tax' && !useChinaCompactLayout;
        const finalAmountLabelText = invoiceSummaryMode === 'royalty_only' ? 'Royalty Amount' : 'Remittance Amount';
        const invoiceDateText = formatInvoiceDateDot(issueDate);
        const signatureUrl = `${window.location.origin}/invoice-signature-kasumi.png`;
        const specialNoteHtml = escapeHtml(invoiceSpecialNote.trim()).replace(/\n/g, '<br/>');
        const invoiceHtml = buildInvoiceHtml({
            invoiceNo,
            invoiceDateText,
            buyerText,
            showPaymentDueDate: invoicePrintProfile.showPaymentDueDate,
            paymentDueText: 'PAYMENT DUE DATE:End of the following month',
            salesCurrencyLabel,
            locationText,
            salesMonthText,
            salesLocalText,
            fxSalesText,
            royaltyRateText,
            rowAmountText: formatAmount(rowAmount),
            royaltyAmountText: formatAmount(summaryForInvoice.royaltyBase),
            minimumText,
            bankChargeTitle,
            bankChargeText,
            showBankCharge: summaryForInvoice.bankCharge > 0,
            showWithholdingTax,
            withholdingTaxText,
            showChinaTaxBreakdown,
            taxBaseText: formatAmount(summaryForInvoice.chinaTaxBase),
            vatTaxText: formatAmount(summaryForInvoice.chinaVatTax),
            incomeTaxText: formatAmount(summaryForInvoice.chinaIncomeTax),
            taxTotalText: formatAmount(summaryForInvoice.chinaTaxTotal),
            finalAmountLabelText,
            finalAmountText: totalText,
            invoiceCurrency,
            bankProfile: INVOICE_BANKS[invoiceCurrency],
            fxSourceText: sourceLabel,
            signatureUrl,
            specialNoteHtml,
            showMinimumLine: !useChinaCompactLayout && summaryForInvoice.minimumRoyalty > 0,
            compactSummary: useChinaCompactLayout,
        });

        const popup = window.open('', '_blank');
        if (!popup) {
            setInvoiceError('Popup blocked. Allow popups and retry.');
            setInvoiceGenerating(false);
            return;
        }
        try {
            popup.document.open();
            popup.document.write(invoiceHtml);
            popup.document.close();
            popup.focus();
        } catch (e) {
            console.error('Failed to render invoice window', e);
            setInvoiceError('Failed to render invoice page. Please retry.');
        } finally {
            setInvoiceGenerating(false);
        }
    };

    const salesMetricsEnabled = detailSection === 'sales';
    const inventoryMetricsEnabled = detailSection === 'sales' || detailSection === 'inventory';

    const monthlyRevenueData = useMemo(() => {
        if (!salesMetricsEnabled) return [];
        const data: { name: string; value: number }[] = [];
        const latestSaleDate = canonicalStoreSales.find((sale) => Boolean(sale.date))?.date;
        const now = latestSaleDate
            ? new Date(`${latestSaleDate}T00:00:00`)
            : new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = formatDate(d).slice(0, 7);
            const total = canonicalStoreSales
                .filter(s => s.date.startsWith(key))
                .reduce((sum, s) => sum + s.totalAmount, 0);
            data.push({
                name: d.toLocaleString('en-US', { month: 'short' }),
                value: total,
            });
        }
        return data;
    }, [canonicalStoreSales, salesMetricsEnabled]);

    const performanceSummary = useMemo(() => {
        const formatMoney = (amount: number) => `${store.currency} ${Math.round(amount).toLocaleString()}`;
        const formatJPY = (amount: number) => {
            const converted = convertToJPY(amount, store.currency, fxRates);
            if (converted === null) return null;
            return `¥ ${Math.round(converted).toLocaleString()}`;
        };

        if (!salesMetricsEnabled) {
            return {
                monthly: { value: 0, baseline: 0, deltaPct: null as number | null, label: 'No sales data', baselineLabel: 'Last Month' },
                weekly: { value: 0, baseline: 0, deltaPct: null as number | null, label: 'No sales data', baselineLabel: 'Previous 7 Days' },
                yoy: { value: 0, baseline: 0, deltaPct: null as number | null, label: 'No sales data', baselineLabel: 'Same Month Last Year' },
                formatMoney,
                formatJPY,
            };
        }

        const latestSaleDate = canonicalStoreSales.find((sale) => Boolean(sale.date))?.date;
        const anchorDate = latestSaleDate
            ? new Date(`${latestSaleDate}T00:00:00`)
            : new Date();
        const todayKey = formatDate(anchorDate);
        const thisMonthKey = formatMonthKey(anchorDate);
        const lastMonthDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - 1, 1);
        const lastMonthKey = formatMonthKey(lastMonthDate);
        const sameMonthLastYearDate = new Date(anchorDate.getFullYear() - 1, anchorDate.getMonth(), 1);
        const sameMonthLastYearKey = formatMonthKey(sameMonthLastYearDate);

        const sevenDaysAgo = new Date(anchorDate);
        sevenDaysAgo.setDate(anchorDate.getDate() - 6);
        const sevenDaysAgoKey = formatDate(sevenDaysAgo);

        const prevWeekStart = new Date(anchorDate);
        prevWeekStart.setDate(anchorDate.getDate() - 13);
        const prevWeekEnd = new Date(anchorDate);
        prevWeekEnd.setDate(anchorDate.getDate() - 7);
        const prevWeekStartKey = formatDate(prevWeekStart);
        const prevWeekEndKey = formatDate(prevWeekEnd);

        const sumByMonthKey = (monthKey: string) =>
            canonicalStoreSales
                .filter((sale) => sale.date.startsWith(monthKey))
                .reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);

        const sumByDateRange = (fromKey: string, toKey: string) =>
            canonicalStoreSales
                .filter((sale) => sale.date >= fromKey && sale.date <= toKey)
                .reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);

        const thisMonthTotal = sumByMonthKey(thisMonthKey);
        const lastMonthTotal = sumByMonthKey(lastMonthKey);
        const sameMonthLastYearTotal = sumByMonthKey(sameMonthLastYearKey);
        const thisWeekTotal = sumByDateRange(sevenDaysAgoKey, todayKey);
        const previousWeekTotal = sumByDateRange(prevWeekStartKey, prevWeekEndKey);

        const calcDelta = (current: number, baseline: number) => {
            if (baseline <= 0) return null;
            return ((current - baseline) / baseline) * 100;
        };

        return {
            monthly: {
                value: thisMonthTotal,
                baseline: lastMonthTotal,
                deltaPct: calcDelta(thisMonthTotal, lastMonthTotal),
                label: formatMonthKeyLabel(thisMonthKey),
                baselineLabel: formatMonthKeyLabel(lastMonthKey),
            },
            weekly: {
                value: thisWeekTotal,
                baseline: previousWeekTotal,
                deltaPct: calcDelta(thisWeekTotal, previousWeekTotal),
                label: `${sevenDaysAgoKey} - ${todayKey}`,
                baselineLabel: `${prevWeekStartKey} - ${prevWeekEndKey}`,
            },
            yoy: {
                value: thisMonthTotal,
                baseline: sameMonthLastYearTotal,
                deltaPct: calcDelta(thisMonthTotal, sameMonthLastYearTotal),
                label: formatMonthKeyLabel(thisMonthKey),
                baselineLabel: formatMonthKeyLabel(sameMonthLastYearKey),
            },
            formatMoney,
            formatJPY,
        };
    }, [canonicalStoreSales, store.currency, fxRates, salesMetricsEnabled]);

    const formatDeltaText = (deltaPct: number | null) => {
        if (deltaPct === null) return 'No baseline data';
        const sign = deltaPct >= 0 ? '+' : '';
        return `${sign}${deltaPct.toFixed(1)}%`;
    };

    const deltaToneClass = (deltaPct: number | null) => {
        if (deltaPct === null) return 'text-gray-500';
        if (deltaPct > 0) return 'text-emerald-600';
        if (deltaPct < 0) return 'text-red-600';
        return 'text-gray-600';
    };

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
            if (isLocalHqPreviewMode()) {
                setOwnersError(null);
                setOwners(store.ownerEmail ? [{
                    email: store.ownerEmail,
                    name: 'Preview Owner',
                    userId: `PREVIEW_${store.id}`,
                    storeId: store.id,
                }] : []);
                return;
            }
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
    }, [store.id, store.ownerEmail]);

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
            setLinkError(toErrorMessage(e, 'Failed to link account.'));
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
            setMoveError(toErrorMessage(e, 'Failed to move account.'));
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
            setUnlinkError(toErrorMessage(e, 'Failed to unlink account.'));
        } finally {
            setUnlinkBusy(null);
        }
    };

    const handleDeleteStore = async () => {
        setDeleteError(null);
        if ((store.reportingStatus ?? 'active') === 'active') {
            setDeleteError('Active operating stores cannot be deleted. Change or repair the store instead.');
            return;
        }
        const confirmation = window.prompt(
            `This will archive and remove all data for this non-operating store.\n\nType the exact store name to continue:\n${store.name}`
        );
        if (confirmation === null) return;
        if (confirmation.trim() !== store.name) {
            setDeleteError('Store name did not match. Nothing was deleted.');
            return;
        }
        try {
            await onDeleteStore(store.id);
            onBack();
        } catch (e) {
            console.error('Failed to delete store', e);
            setDeleteError(toErrorMessage(e, 'Failed to delete store.'));
        }
    };

    // Average ingredient usage per category (based on menu recipes)
    const categoryUsageMap = useMemo(() => {
        if (!inventoryMetricsEnabled) return {} as Record<string, Record<string, number>>;
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
    }, [categories, storeMenus, ingredients, standardIngredients, inventoryMetricsEnabled]);

    // --- Real-time Inventory Calculation Logic ---
    const inventoryStats = useMemo(() => {
        if (!inventoryMetricsEnabled) return {} as Record<string, { used: number; unit: string; par: number; reorder: number; remaining: number | null; configured: boolean }>;
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
        canonicalStoreSales.forEach(sale => {
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
    }, [standardIngredients, categoryUsageMap, canonicalStoreSales, storeStockMap, inventoryMetricsEnabled]);

    return (
        <div className="relative mx-auto w-full min-w-0 max-w-7xl overflow-x-hidden p-3 sm:p-6 lg:p-8">
            {showReminderComposer && reminderDate && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl">
                        <div className="flex items-center justify-between px-6 pt-5">
                            <div>
                                <div className="font-extrabold text-lg">Send Reminder</div>
                                <div className="text-xs text-gray-500 mt-1">
                                    Select one or more linked email addresses for the missing report on {reminderDate}.
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={closeReminderComposer}
                                className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-gray-100"
                            >
                                <X className="w-5 h-5 text-gray-500" />
                            </button>
                        </div>
                        <div className="px-6 py-4">
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <div className="text-sm font-bold text-gray-900">
                                    Recipients ({selectedReminderEmails.length}/{reminderRecipients.length})
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedReminderEmails(reminderRecipients.map((recipient) => recipient.email));
                                            setReminderError(null);
                                        }}
                                        className="min-h-11 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50"
                                    >
                                        Select All
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedReminderEmails([])}
                                        className="min-h-11 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50"
                                    >
                                        Clear
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-2 max-h-[38vh] overflow-y-auto border border-gray-100 rounded-xl p-3">
                                {reminderRecipients.map((recipient) => (
                                    <label
                                        key={recipient.email}
                                        className="flex items-start gap-3 rounded-xl border border-gray-100 px-3 py-3 hover:bg-gray-50 cursor-pointer"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedReminderEmails.includes(recipient.email)}
                                            onChange={() => toggleReminderRecipient(recipient.email)}
                                            className="mt-1 h-4 w-4 rounded border-gray-300 text-black focus:ring-black"
                                        />
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-gray-900 break-all">
                                                {recipient.label}
                                            </div>
                                            <div className="text-xs text-gray-500 break-all">
                                                {recipient.email}
                                            </div>
                                        </div>
                                    </label>
                                ))}
                            </div>
                            <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                                The sender account is chosen by Gmail or your default mail app. This website can choose recipients, subject, and body only.
                            </div>
                            {reminderError && (
                                <div className="mt-3 text-sm text-red-600">{reminderError}</div>
                            )}
                        </div>
                        <div className="px-6 pb-6 flex flex-wrap justify-between gap-3">
                            <button
                                type="button"
                                onClick={copyReminderEmails}
                                className="min-h-11 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                            >
                                Copy Recipient List
                            </button>
                            <div className="flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    onClick={closeReminderComposer}
                                    className="min-h-11 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => openReminderDraft('mailto')}
                                    className="min-h-11 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                                >
                                    Open Mail App
                                </button>
                                <button
                                    type="button"
                                    onClick={() => openReminderDraft('gmail')}
                                    className="min-h-11 rounded-xl bg-black px-4 py-2 text-sm font-bold text-white hover:bg-gray-800"
                                >
                                    Open Gmail Draft
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {showMissingCalendar && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
                        <div className="flex items-center justify-between px-6 pt-5">
                            <div className="font-extrabold text-lg">Missing Reports Calendar</div>
                            <button
                                type="button"
                                onClick={() => setShowMissingCalendar(false)}
                                className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-gray-100"
                            >
                                <X className="w-5 h-5 text-gray-500" />
                            </button>
                        </div>
                        <div className="px-6 pb-6">
                            <div className="flex items-center justify-between mt-3 mb-4">
                                <button
                                    type="button"
                                    onClick={goPrevMonth}
                                    className="min-h-11 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold transition hover:bg-gray-50"
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
                                    className="min-h-11 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold transition hover:bg-gray-50 disabled:opacity-50"
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
                                            className={`h-11 rounded-lg border text-xs font-semibold transition ${
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
                                className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-gray-100"
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
                                    <div key={`${row.ingredientName}-${idx}`} className="grid grid-cols-1 items-center gap-2 rounded-xl border border-gray-100 p-3 sm:grid-cols-12 sm:border-0 sm:p-0">
                                        <div className="text-sm font-semibold text-gray-800 sm:col-span-5">{row.ingredientName}</div>
                                        <div className="text-xs text-gray-500 sm:col-span-2">{row.unit}</div>
                                        <input
                                            className="min-h-11 rounded-lg border border-gray-200 p-2 text-right text-sm sm:col-span-2"
                                            value={String(row.par ?? 0)}
                                            onChange={(e) => {
                                                const val = e.target.value.replace(/[^\d.]/g, '');
                                                setStockDrafts(prev => prev.map((r, i) => i === idx ? { ...r, par: val === '' ? 0 : Number(val) } : r));
                                            }}
                                            placeholder="Stock"
                                        />
                                        <input
                                            className="min-h-11 rounded-lg border border-gray-200 p-2 text-right text-sm sm:col-span-2"
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
                                className="min-h-11 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={saveStockSettings}
                                disabled={stockSaving}
                                className="min-h-11 rounded-xl bg-black px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
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
            {editingSetMenu && (
                <SetMenuEditor
                    setMenu={editingSetMenu}
                    menus={storeMenus}
                    onSave={async (nextSetMenu) => {
                        await Promise.resolve(onUpdateSetMenu(nextSetMenu));
                        setEditingSetMenu(null);
                    }}
                    onBack={() => setEditingSetMenu(null)}
                />
            )}

            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-5 sm:gap-3">
                <button onClick={onBack} className="flex min-h-11 items-center gap-2 rounded-xl px-1 font-bold text-gray-500 hover:text-black">
                    <ArrowLeft className="w-5 h-5"/> Back to Dashboard
                </button>
                <HQLanguageSwitch locale={hqLocale} onChange={onHqLocaleChange} />
            </div>

            <div className="mb-4 flex min-w-0 flex-col gap-3 sm:mb-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <h1 className="break-words text-xl font-extrabold sm:text-3xl">{store.name}</h1>
                    <div className="mt-1.5 flex min-w-0 items-start gap-2 text-sm text-gray-500 sm:mt-2 sm:text-base">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0"/> {store.city}, {store.country}
                        <span className="hidden sm:inline">• Owner: {store.ownerEmail}</span>
                    </div>
                    <details className="group mt-2 rounded-xl border border-gray-200 bg-white sm:hidden">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-bold text-gray-600 [&::-webkit-details-marker]:hidden">
                            <span>Account information</span>
                            <ChevronRight className="h-4 w-4 shrink-0 transition group-open:rotate-90" />
                        </summary>
                        <div className="space-y-2 border-t border-gray-100 px-3 py-3 text-xs text-gray-500">
                            <div className="break-all"><span className="font-bold text-gray-700">Owner:</span> {store.ownerEmail}</div>
                            <div className="break-all">
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
                    </details>
                    <div className="mt-2 hidden break-all text-xs text-gray-500 sm:block">
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
                <details className="group rounded-xl border border-gray-200 bg-white sm:hidden">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                        <div>
                            <div className="text-sm font-extrabold text-gray-900">Store settings</div>
                            <div className="mt-0.5 text-xs text-gray-500">{currencyDraft || '—'} · {royaltyDraft || '—'}%</div>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 transition group-open:rotate-90" />
                    </summary>
                    <div className="grid gap-3 border-t border-gray-100 p-3">
                        <div className="grid grid-cols-[88px_minmax(0,1fr)_64px] items-center gap-2">
                            <span className="text-xs font-bold text-gray-500">Currency</span>
                            <select
                                aria-label="Currency"
                                value={currencyDraft}
                                onChange={(e) => setCurrencyDraft(e.target.value)}
                                className="min-h-11 min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-2 text-right text-sm font-bold"
                            >
                                <option value="">Select</option>
                                {currencyOptions.map(cur => <option key={cur} value={cur}>{cur}</option>)}
                            </select>
                            <button
                                type="button"
                                onClick={saveCurrency}
                                disabled={currencySaving || !currencyDraft}
                                className="min-h-11 rounded-lg bg-black px-2 text-xs font-bold text-white disabled:opacity-50"
                            >
                                {currencySaving ? '...' : 'Save'}
                            </button>
                        </div>
                        <div className="grid grid-cols-[88px_minmax(0,1fr)_64px] items-center gap-2">
                            <span className="text-xs font-bold text-gray-500">Royalty (%)</span>
                            <input
                                aria-label="Royalty Rate (%)"
                                type="text"
                                inputMode="decimal"
                                value={royaltyDraft}
                                onChange={(e) => setRoyaltyDraft(normalizePercentInput(e.target.value))}
                                className="min-h-11 min-w-0 rounded-lg border border-gray-200 px-2 py-2 text-right text-sm font-bold"
                            />
                            <button
                                type="button"
                                onClick={saveRoyaltyRate}
                                disabled={royaltySaving || Number.isNaN(parseFloat(royaltyDraft))}
                                className="min-h-11 rounded-lg bg-black px-2 text-xs font-bold text-white disabled:opacity-50"
                            >
                                {royaltySaving ? '...' : 'Save'}
                            </button>
                        </div>
                        {(currencyError || royaltyError) && <div className="text-xs text-red-600">{currencyError || royaltyError}</div>}
                    </div>
                </details>
                <div className="hidden w-full shrink-0 grid-cols-2 gap-3 sm:grid lg:w-auto lg:min-w-[320px]">
                  <div className="rounded-xl border border-gray-200 bg-white p-3 text-left lg:text-right">
                    <div className="text-sm font-bold text-gray-500">Currency</div>
                    <div className="mt-2 flex min-w-0 items-center gap-2 lg:justify-end">
                        <select
                            value={currencyDraft}
                            onChange={(e) => setCurrencyDraft(e.target.value)}
                            className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-right font-bold"
                        >
                            <option value="">Select</option>
                            {currencyOptions.map(cur => (
                                <option key={cur} value={cur}>{cur}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={saveCurrency}
                            disabled={currencySaving || !currencyDraft}
                            className="min-h-11 shrink-0 rounded-lg bg-black px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                            {currencySaving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                    {currencyError && (
                        <div className="mt-2 text-xs text-red-600 lg:text-right">{currencyError}</div>
                    )}
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-3 text-left lg:text-right">
                    <div className="text-sm font-bold text-gray-500">Royalty Rate (%)</div>
                    <div className="mt-2 flex items-center gap-2 lg:justify-end">
                        <input
                            type="text"
                            inputMode="decimal"
                            value={royaltyDraft}
                            onChange={(e) => setRoyaltyDraft(normalizePercentInput(e.target.value))}
                            className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-right font-bold"
                        />
                        <button
                            type="button"
                            onClick={saveRoyaltyRate}
                            disabled={royaltySaving || Number.isNaN(parseFloat(royaltyDraft))}
                            className="min-h-11 shrink-0 rounded-lg bg-black px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                            {royaltySaving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                    {royaltyError && (
                        <div className="mt-2 text-xs text-red-600 lg:text-right">{royaltyError}</div>
                    )}
                  </div>
                </div>
            </div>

            {isTestStore && (
                <section
                    data-testid="test-cost-lab-banner"
                    className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm"
                >
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <div className="inline-flex items-center rounded-full bg-amber-200 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-amber-900">
                                Test workspace
                            </div>
                            <h2 className="mt-2 text-xl font-extrabold text-gray-950">
                                Cost-analysis sample data is ready
                            </h2>
                            <p className="mt-1 text-sm text-amber-950/75">
                                Open Cost &amp; Inventory to review actual cost, theoretical recipe cost, stock counts, and ingredient variances together.
                            </p>
                            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                <div className="rounded-xl border border-amber-200 bg-white/80 p-3">
                                    <div className="text-[10px] font-bold uppercase text-gray-500">Sample month</div>
                                    <div className="mt-1 font-extrabold">{formatMonthKeyLabel(defaultSalesMonthKey)}</div>
                                </div>
                                <div className="rounded-xl border border-amber-200 bg-white/80 p-3">
                                    <div className="text-[10px] font-bold uppercase text-gray-500">Sales</div>
                                    <div className="mt-1 font-extrabold">{store.currency} {Math.round(testMonthSalesTotal).toLocaleString()}</div>
                                </div>
                                <div className="rounded-xl border border-amber-200 bg-white/80 p-3">
                                    <div className="text-[10px] font-bold uppercase text-gray-500">Daily reports</div>
                                    <div className="mt-1 font-extrabold">{testMonthSales.length} days</div>
                                </div>
                                <div className="rounded-xl border border-amber-200 bg-white/80 p-3">
                                    <div className="text-[10px] font-bold uppercase text-gray-500">Menu setup</div>
                                    <div className="mt-1 font-extrabold">{storeMenus.length} items · {storeSetMenus.length} course</div>
                                </div>
                            </div>
                        </div>
                        <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
                            <button
                                type="button"
                                onClick={() => {
                                    setSalesMonthFilter(defaultSalesMonthKey);
                                    setDetailSection('inventory');
                                }}
                                className="rounded-xl bg-black px-5 py-3 text-sm font-extrabold text-white hover:bg-gray-800"
                            >
                                Open Cost &amp; Inventory
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setMenuSection('items');
                                    setDetailSection('menu');
                                }}
                                className="rounded-xl border border-amber-300 bg-white px-5 py-3 text-sm font-extrabold text-gray-900 hover:bg-amber-100"
                            >
                                Open Menu &amp; Recipes
                            </button>
                        </div>
                    </div>
                </section>
            )}

            <div className="sticky top-0 z-20 -mx-3 mb-4 border-y border-gray-200 bg-white/95 px-3 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-white/90 sm:mx-0 sm:mb-6 sm:rounded-2xl sm:border sm:bg-gray-50/95 sm:p-1">
                <div className="no-scrollbar flex w-full gap-1 overflow-x-auto sm:flex-wrap sm:items-center">
                    {[
                        { key: 'sales', label: 'Sales', shortLabel: 'Sales' },
                        { key: 'close', label: 'Month Close', shortLabel: 'Month Close' },
                        { key: 'inventory', label: 'Cost & Inventory', shortLabel: 'Cost & Inventory' },
                        { key: 'invoice', label: 'Invoice', shortLabel: 'Invoice' },
                        { key: 'menu', label: 'Menu', shortLabel: 'Menu' },
                        { key: 'staff', label: 'Staff', shortLabel: 'Staff' },
                        { key: 'accounts', label: 'Accounts', shortLabel: 'Accounts' },
                    ].map((tab) => (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setDetailSection(tab.key as 'sales' | 'close' | 'inventory' | 'invoice' | 'menu' | 'staff' | 'accounts')}
                            className={`min-h-10 shrink-0 rounded-lg px-4 py-2 text-xs font-bold transition sm:min-h-11 sm:rounded-xl sm:text-sm ${
                                detailSection === tab.key
                                    ? 'bg-black text-white'
                                    : 'text-gray-600 hover:bg-gray-100'
                            }`}
                        >
                            <span className="sm:hidden">{tab.shortLabel}</span>
                            <span className="hidden sm:inline">{tab.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {detailSection === 'close' && (
                <div className="mb-8">
                    <MonthlyCloseWorkspace
                        store={store}
                        sales={sales}
                        initialMonthKey={salesMonthFilter === 'all' ? defaultSalesMonthKey : salesMonthFilter}
                        mode="hq"
                    />
                </div>
            )}

            {detailSection === 'invoice' && (
            <div className="bg-white p-5 rounded-2xl shadow-sm border mb-8">
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <div className="text-lg font-extrabold">Invoice Generator</div>
                            <div className="text-xs text-gray-500">Auto-calculated from owner submitted monthly sales.</div>
                        </div>
                        <button
                            type="button"
                            onClick={handleGenerateInvoicePdf}
                            disabled={invoiceGenerating}
                            className="px-4 py-2 rounded-xl bg-black text-white text-sm font-bold hover:bg-gray-800 disabled:opacity-50"
                        >
                            {invoiceGenerating ? 'Refreshing FX...' : 'Generate Invoice PDF'}
                        </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-8 gap-3">
                        <div>
                            <div className="text-[11px] font-bold text-gray-500 mb-1">Invoice Month</div>
                            <select
                                value={invoiceMonthKey}
                                onChange={(e) => setInvoiceMonthKey(e.target.value)}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                            >
                                {invoiceMonthOptions.map((key) => (
                                    <option key={key} value={key}>
                                        {formatInvoiceMonthLabel(key)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <div className="text-[11px] font-bold text-gray-500 mb-1">Invoice Currency</div>
                            <select
                                value={invoiceCurrency}
                                onChange={(e) => setInvoiceCurrency(e.target.value as 'JPY' | 'USD')}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                            >
                                <option value="JPY">JPY</option>
                                <option value="USD">USD</option>
                            </select>
                        </div>
                        <div>
                            <div className="text-[11px] font-bold text-gray-500 mb-1">Manual FX Override</div>
                            <input
                                value={invoiceManualFxDraft}
                                onChange={(e) => setInvoiceManualFxDraft(normalizeDecimalInput(e.target.value, 6))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                placeholder={`1 ${store.currency} = ${invoiceCurrency}`}
                            />
                        </div>
                        <div>
                            <div className="text-[11px] font-bold text-gray-500 mb-1">Summary Format</div>
                            <select
                                value={invoiceSummaryMode}
                                onChange={(e) => setInvoiceSummaryMode(e.target.value as 'royalty_only' | 'withholding' | 'china_tax')}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                            >
                                <option value="royalty_only">Royalty Amount only</option>
                                <option value="withholding">Royalty + Withholding + Remittance</option>
                                <option value="china_tax">China (VAT 6% + Income Tax 10%)</option>
                            </select>
                        </div>
                        <div>
                            <div className="text-[11px] font-bold text-gray-500 mb-1">INV Number</div>
                            <input
                                value={invoiceNumber}
                                onChange={(e) => {
                                    setInvoiceNumberEdited(true);
                                    setInvoiceNumber(e.target.value.replace(/[^\dA-Za-z-]/g, ''));
                                }}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                placeholder={defaultInvoiceNumber}
                            />
                            {invoiceNumberEdited && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setInvoiceNumberEdited(false);
                                        setInvoiceNumber(defaultInvoiceNumber);
                                    }}
                                    className="mt-1 text-[11px] font-semibold text-gray-500 hover:text-black"
                                >
                                    Use auto INV number
                                </button>
                            )}
                        </div>
                        <div>
                            <div className="text-[11px] font-bold text-gray-500 mb-1">Minimum Royalty</div>
                            <input
                                value={invoiceMinimumDraft}
                                onChange={(e) => setInvoiceMinimumDraft(e.target.value.replace(/[^\d]/g, ''))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                placeholder="150000"
                            />
                        </div>
                        {invoiceSummaryMode === 'withholding' && (
                            <div>
                                <div className="text-[11px] font-bold text-gray-500 mb-1">Withholding Tax (%)</div>
                                <input
                                    value={invoiceWithholdingTaxRateDraft}
                                    onChange={(e) => setInvoiceWithholdingTaxRateDraft(normalizePercentInput(e.target.value))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                    placeholder="15.09"
                                />
                            </div>
                        )}
                        {invoiceSummaryMode === 'china_tax' && (
                            <div>
                                <div className="text-[11px] font-bold text-gray-500 mb-1">VAT Tax (%)</div>
                                <input
                                    value={invoiceChinaVatRateDraft}
                                    onChange={(e) => setInvoiceChinaVatRateDraft(normalizePercentInput(e.target.value))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                    placeholder="6"
                                />
                            </div>
                        )}
                        {invoiceSummaryMode === 'china_tax' && (
                            <div>
                                <div className="text-[11px] font-bold text-gray-500 mb-1">Income Tax (%)</div>
                                <input
                                    value={invoiceChinaIncomeTaxRateDraft}
                                    onChange={(e) => setInvoiceChinaIncomeTaxRateDraft(normalizePercentInput(e.target.value))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                    placeholder="10"
                                />
                            </div>
                        )}
                        <div>
                            <div className="text-[11px] font-bold text-gray-500 mb-1">Bank Charge</div>
                            <input
                                value={invoiceBankChargeDraft}
                                onChange={(e) => setInvoiceBankChargeDraft(e.target.value.replace(/[^\d]/g, ''))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                placeholder="4000"
                            />
                        </div>
                        <div>
                            <div className="text-[11px] font-bold text-gray-500 mb-1">Charge Label</div>
                            <input
                                value={invoiceBankChargeLabel}
                                onChange={(e) => setInvoiceBankChargeLabel(e.target.value)}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                placeholder="Bank Charge of Jan & Feb"
                            />
                        </div>
                    </div>
                    <div>
                        <div className="text-[11px] font-bold text-gray-500 mb-1">TO (Buyer)</div>
                        <textarea
                            value={invoiceToDraft}
                            onChange={(e) => setInvoiceToDraft(e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-[64px] resize-y"
                            placeholder={`Buyer company / recipient name\nAddress line 1\nAddress line 2`}
                        />
                    </div>
                    <div>
                        <div className="text-[11px] font-bold text-gray-500 mb-1">Special Note</div>
                        <textarea
                            value={invoiceSpecialNote}
                            onChange={(e) => setInvoiceSpecialNote(e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-[72px] resize-y"
                            placeholder={`Optional note for the invoice body.\nExample: smaller than 100 m2`}
                        />
                    </div>
                    <div className="text-xs text-gray-600 grid sm:grid-cols-4 gap-2">
                        <div>
                            Local Sales: <span className="font-bold">{store.currency} {invoiceSummary.localSalesTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                        <div>
                            Sales ({invoiceCurrency}): <span className="font-bold">{invoiceSummary.convertedSales === null ? 'N/A' : invoiceSummary.convertedSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                        <div>
                            Royalty Amount: <span className="font-bold">{invoiceCurrency} {invoiceSummary.royaltyBase.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                        {invoiceSummaryMode === 'withholding' && (
                            <div>
                                Withholding Tax: <span className="font-bold">{invoiceCurrency} {invoiceSummary.withholdingTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                            </div>
                        )}
                        {invoiceSummaryMode === 'china_tax' && (
                            <>
                                <div>
                                    Tax Base (Excl. VAT): <span className="font-bold">{invoiceCurrency} {invoiceSummary.chinaTaxBase.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                </div>
                                <div>
                                    VAT Tax: <span className="font-bold">{invoiceCurrency} {invoiceSummary.chinaVatTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                </div>
                                <div>
                                    Income Tax: <span className="font-bold">{invoiceCurrency} {invoiceSummary.chinaIncomeTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                </div>
                                <div>
                                    Withholding Tax: <span className="font-bold">{invoiceCurrency} {invoiceSummary.chinaTaxTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                </div>
                            </>
                        )}
                        <div>
                            {invoiceSummaryMode === 'royalty_only' ? 'Royalty Amount' : 'Remittance Amount'}:{' '}
                            <span className="font-bold">{invoiceCurrency} {invoiceSummary.totalDue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                    </div>
                    <div className="text-[11px] font-semibold text-gray-500">
                        {parseManualFxRate(invoiceManualFxDraft)
                            ? `FX: Manual ${store.currency}/${invoiceCurrency} ${parseManualFxRate(invoiceManualFxDraft)}`
                            : formatFxSourceLabel(fxStatus, fxSourceText)}
                    </div>
                    {invoiceError && <div className="text-xs text-red-600">{invoiceError}</div>}
                </div>
            </div>
            )}

            {detailSection === 'sales' && (
            <div className="mb-6 space-y-4 sm:mb-8 sm:space-y-8">
                    {/* Compliance Alert */}
                    <div className={`rounded-2xl border p-4 shadow-sm sm:p-6 ${missingDates.length > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                        <div className="flex items-start gap-3 sm:gap-4">
                            <div className={`rounded-full p-2 sm:p-3 ${missingDates.length > 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                {missingDates.length > 0 ? <AlertOctagon className="h-5 w-5 sm:h-6 sm:w-6"/> : <CheckCircle2 className="h-5 w-5 sm:h-6 sm:w-6"/>}
                            </div>
                            <div className="min-w-0 flex-1">
                                <h3 className={`text-base font-bold sm:text-lg ${missingDates.length > 0 ? 'text-red-900' : 'text-green-900'}`}>
                                    {missingDates.length > 0 ? 'Missing Daily Reports' : 'Reporting Compliance'}
                                </h3>
                                <div className={`text-sm mt-1 ${missingDates.length > 0 ? 'text-red-700' : 'text-green-700'}`}>
                                    {missingDates.length > 0 ? (
                                        <>
                                            <p className="mb-2 font-bold">The following dates are missing:</p>
                                            <div className="flex flex-wrap gap-1.5 sm:gap-2">
                                                {missingDates.map(d => (
                                                    <button
                                                        key={d}
                                                        type="button"
                                                        onClick={() => {
                                                            openEmailReminder(d);
                                                        }}
                                                        className="min-h-10 rounded-lg border border-red-200 bg-white px-2.5 py-2 text-xs font-bold text-red-600 shadow-sm transition hover:bg-red-50 sm:min-h-11 sm:px-3"
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
                                                    className="min-h-10 rounded-lg border border-red-200 bg-white px-2.5 py-2 text-xs font-bold text-red-700 shadow-sm transition hover:bg-red-50 sm:min-h-11 sm:px-3"
                                                >
                                                    View Older Dates
                                                </button>
                                            </div>
                                            <div className="mt-2 hidden text-xs text-red-500 sm:block">
                                                Tip: Click a date to choose recipients and open an email draft.
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

                    <div className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
                        <h2 className="mb-3 text-lg font-bold sm:mb-4 sm:text-xl">Store Performance</h2>
                        <div className="mb-3 grid grid-cols-3 gap-2 sm:mb-4 sm:gap-3">
                            <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-2 sm:p-3">
                                <div className="text-[10px] font-bold uppercase text-gray-500 sm:text-[11px]"><span className="sm:hidden">Month</span><span className="hidden sm:inline">Monthly Sales</span></div>
                                <div className="text-[11px] text-gray-500 mt-0.5">{performanceSummary.monthly.label}</div>
                                <div className="mt-1 break-words text-sm font-extrabold text-gray-900 sm:text-lg">{performanceSummary.formatMoney(performanceSummary.monthly.value)}</div>
                                {store.currency !== 'JPY' && (
                                    <div className="mt-1 text-[10px] text-gray-500 sm:text-xs">{performanceSummary.formatJPY(performanceSummary.monthly.value) ?? 'JPY N/A'}</div>
                                )}
                                <div className={`mt-1 text-[10px] font-bold sm:mt-2 sm:text-xs ${deltaToneClass(performanceSummary.monthly.deltaPct)}`}>
                                    <span className="sm:hidden">{formatDeltaText(performanceSummary.monthly.deltaPct)}</span>
                                    <span className="hidden sm:inline">vs {performanceSummary.monthly.baselineLabel} {formatDeltaText(performanceSummary.monthly.deltaPct)}</span>
                                </div>
                            </div>
                            <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-2 sm:p-3">
                                <div className="text-[10px] font-bold uppercase text-gray-500 sm:text-[11px]"><span className="sm:hidden">7 Days</span><span className="hidden sm:inline">Weekly Sales (Last 7 Days)</span></div>
                                <div className="text-[11px] text-gray-500 mt-0.5">{performanceSummary.weekly.label}</div>
                                <div className="mt-1 break-words text-sm font-extrabold text-gray-900 sm:text-lg">{performanceSummary.formatMoney(performanceSummary.weekly.value)}</div>
                                {store.currency !== 'JPY' && (
                                    <div className="mt-1 text-[10px] text-gray-500 sm:text-xs">{performanceSummary.formatJPY(performanceSummary.weekly.value) ?? 'JPY N/A'}</div>
                                )}
                                <div className={`mt-1 text-[10px] font-bold sm:mt-2 sm:text-xs ${deltaToneClass(performanceSummary.weekly.deltaPct)}`}>
                                    <span className="sm:hidden">{formatDeltaText(performanceSummary.weekly.deltaPct)}</span>
                                    <span className="hidden sm:inline">vs {performanceSummary.weekly.baselineLabel} {formatDeltaText(performanceSummary.weekly.deltaPct)}</span>
                                </div>
                            </div>
                            <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-2 sm:p-3">
                                <div className="text-[10px] font-bold uppercase text-gray-500 sm:text-[11px]"><span className="sm:hidden">YoY</span><span className="hidden sm:inline">YoY (This Month)</span></div>
                                <div className="text-[11px] text-gray-500 mt-0.5">{performanceSummary.yoy.label}</div>
                                <div className="mt-1 break-words text-sm font-extrabold text-gray-900 sm:text-lg">{performanceSummary.formatMoney(performanceSummary.yoy.value)}</div>
                                {store.currency !== 'JPY' && (
                                    <div className="mt-1 text-[10px] text-gray-500 sm:text-xs">{performanceSummary.formatJPY(performanceSummary.yoy.value) ?? 'JPY N/A'}</div>
                                )}
                                <div className={`mt-1 text-[10px] font-bold sm:mt-2 sm:text-xs ${deltaToneClass(performanceSummary.yoy.deltaPct)}`}>
                                    <span className="sm:hidden">{formatDeltaText(performanceSummary.yoy.deltaPct)}</span>
                                    <span className="hidden sm:inline">vs {performanceSummary.yoy.baselineLabel} {formatDeltaText(performanceSummary.yoy.deltaPct)}</span>
                                </div>
                            </div>
                        </div>
                        <div className="h-52 rounded-xl bg-gray-50 p-1 sm:h-64 sm:p-2">
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
            )}

            {detailSection === 'inventory' && (
                <div className="mb-8">
                    <CostInventoryWorkspace
                        store={store}
                        ingredients={ingredients}
                        menus={storeMenus}
                        setMenus={storeSetMenus}
                        sales={canonicalStoreSales}
                        initialMonthKey={salesMonthFilter === 'all' ? defaultSalesMonthKey : salesMonthFilter}
                        mode="hq"
                    />
                </div>
            )}

            {detailSection === 'sales' && (
            <div className="mb-6 rounded-2xl border bg-white p-4 shadow-sm sm:mb-8 sm:p-6">
                <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="flex items-center gap-2 text-lg font-bold sm:text-xl">
                        <ClipboardList className="w-5 h-5"/> Sales History
                    </h2>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:gap-3">
                        <select
                            value={salesMonthFilter}
                            onChange={(e) => setSalesMonthFilter(e.target.value)}
                            className="min-h-11 min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold"
                        >
                            <option value="all">All Months</option>
                            {salesMonthOptions.map((monthKey) => (
                                <option key={monthKey} value={monthKey}>
                                    {formatMonthKeyLabel(monthKey)}
                                </option>
                            ))}
                        </select>
                        <span className="order-3 col-span-2 text-[11px] text-gray-400 sm:order-none sm:col-span-1 sm:text-xs">Showing {salesLookbackLabel} data</span>
                        <button
                            type="button"
                            onClick={onLoadMoreSales}
                            className="min-h-11 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold transition hover:bg-gray-50"
                        >
                            Load more
                        </button>
                    </div>
                </div>
                <div className="md:overflow-x-auto">
                    <table className="block w-full text-left text-sm md:table">
                        <thead className="hidden bg-gray-50 text-xs font-bold uppercase text-gray-500 md:table-header-group">
                            <tr>
                                <th className="p-4 rounded-l-lg">Date</th>
                                <th className="p-4 text-right">Total Sales</th>
                                <th className="p-4 text-center">Status</th>
                                <th className="p-4 text-center">Items</th>
                                <th className="p-4 text-center rounded-r-lg">Receipt</th>
                            </tr>
                        </thead>
                        <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-gray-50">
                            {visibleStoreSales.map(sale => (
                                <React.Fragment key={sale.id}>
                                    <tr className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 rounded-xl border border-gray-200 p-4 shadow-sm transition hover:bg-gray-50 md:table-row md:rounded-none md:border-0 md:p-0 md:shadow-none">
                                        <td className="col-start-1 row-start-1 whitespace-nowrap p-0 font-bold md:table-cell md:p-4 md:font-medium">{sale.date}</td>
                                        <td className="col-start-2 row-start-1 p-0 text-right font-mono font-bold md:table-cell md:p-4">
                                            {sale.isClosed ? (
                                                '-'
                                            ) : editingSaleAmountId === sale.id ? (
                                                <div className="flex items-center justify-end gap-2">
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={editingSaleAmountDraft}
                                                        onChange={(e) => setEditingSaleAmountDraft(normalizeDecimalInput(e.target.value, 2))}
                                                        className="min-h-11 w-32 rounded-lg border border-gray-200 bg-white px-2 py-2 text-right text-sm"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => void saveSaleAmount(sale)}
                                                        disabled={saleAmountSaving}
                                                        className="min-h-11 rounded-md bg-black px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50"
                                                    >
                                                        Save
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={cancelEditSaleAmount}
                                                        disabled={saleAmountSaving}
                                                        className="min-h-11 rounded-md border border-gray-200 px-3 py-2 text-[11px] font-bold"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="space-y-1">
                                                    <div>{`${store.currency} ${formatMoneyDisplay(saleAmountOverrides[sale.id] ?? sale.totalAmount)}`}</div>
                                                    {store.currency !== 'JPY' && (() => {
                                                        const amount = saleAmountOverrides[sale.id] ?? sale.totalAmount;
                                                        const amountJPY = convertToJPY(amount, store.currency, fxRates);
                                                        if (amountJPY === null) return null;
                                                        return (
                                                            <div className="text-[11px] font-semibold text-gray-500">
                                                                {`¥ ${Math.round(amountJPY).toLocaleString()}`}
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            )}
                                        </td>
                                        <td className="col-start-1 row-start-2 p-0 text-left md:table-cell md:p-4 md:text-center">
                                            {sale.isClosed ? (
                                                <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold uppercase">Closed</span>
                                            ) : (
                                                <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-xs font-bold uppercase">Open</span>
                                            )}
                                        </td>
                                        <td className="col-start-2 row-start-2 p-0 text-right md:table-cell md:p-4 md:text-center">
                                            <div className="flex items-center justify-end gap-1.5 md:justify-center md:gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleSaleDetails(sale.id)}
                                                    className="min-h-10 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50 md:min-h-11 md:rounded-full"
                                                >
                                                    {expandedSales.has(sale.id) ? 'Hide' : 'View'}
                                                </button>
                                                {!sale.isClosed && editingSaleAmountId !== sale.id && (
                                                    <button
                                                        type="button"
                                                        onClick={() => startEditSaleAmount(sale)}
                                                        className="min-h-10 rounded-lg border border-blue-200 px-3 py-2 text-xs font-bold text-blue-700 transition hover:bg-blue-50 md:min-h-11 md:rounded-full"
                                                    >
                                                        Edit
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                        <td className="col-span-2 row-start-3 border-t border-gray-100 p-0 pt-2 text-left md:table-cell md:border-0 md:p-4 md:text-center">
                                            {sale.isClosed || !sale.hasReceipt ? (
                                                <span className="text-gray-300 text-xs italic">No Image</span>
                                            ) : (
                                                <button
                                                    onClick={() => openReceipt(sale.id)}
                                                    disabled={receiptLoadingId === sale.id}
                                                    className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-blue-600 transition hover:bg-blue-50 disabled:opacity-60 md:min-h-11 md:rounded-full md:px-3 md:py-2"
                                                >
                                                    <ImageIcon className="w-3 h-3"/> {receiptLoadingId === sale.id ? 'Loading...' : 'View Receipt'}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                    {expandedSales.has(sale.id) && (
                                        <tr className="block md:table-row">
                                            <td colSpan={5} className="block rounded-xl bg-gray-50 p-4 md:table-cell md:rounded-none">
                                                {sale.isClosed && sale.closedReason && (
                                                    <div className="mb-3 text-xs font-semibold text-gray-600">
                                                        Closure reason: {sale.closedReason}
                                                    </div>
                                                )}
                                                {sale.comment && (
                                                    <div className="mb-3 text-xs font-semibold text-gray-700">
                                                        Comment: <span className="font-medium text-gray-600">{sale.comment}</span>
                                                    </div>
                                                )}
                                                <div className="text-xs font-bold text-gray-500 uppercase mb-2">Direct Menu Quantities</div>
                                                {sale.menuItems?.length ? (
                                                    <div className="mb-4 flex flex-wrap gap-2">
                                                        {sale.menuItems.map((item, idx) => {
                                                            const menu = storeMenus.find((row) => row.id === item.menuId);
                                                            return (
                                                                <div key={`${item.menuId}-${idx}`} className="bg-white border border-gray-200 px-2 py-1 rounded text-xs font-bold text-gray-700">
                                                                    {menu?.name ?? 'Unknown Menu'} • {item.quantity}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                ) : (
                                                    <div className="text-xs text-amber-600 mb-4">No direct-menu breakdown for this report.</div>
                                                )}
                                                <div className="text-xs font-bold text-gray-500 uppercase mb-2">Set Menu Quantities</div>
                                                {sale.setItems?.length ? (
                                                    <div className="flex flex-wrap gap-2">
                                                        {sale.setItems.map((item, idx) => {
                                                            const setMenu = storeSetMenus.find((row) => row.id === item.setMenuId);
                                                            return (
                                                                <div key={`${item.setMenuId}-${idx}`} className="bg-white border border-gray-200 px-2 py-1 rounded text-xs font-bold text-gray-700">
                                                                    {setMenu?.name ?? 'Unknown Set'} • {item.quantity}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                ) : (
                                                    <div className="text-xs text-gray-400 mb-4">No set menu data for this report.</div>
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
                            {visibleStoreSales.length === 0 && (
                                <tr className="block md:table-row">
                                    <td colSpan={5} className="block p-8 text-center text-gray-400 md:table-cell">No sales reports found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {receiptError && (
                    <div className="mt-3 text-xs text-red-600">{receiptError}</div>
                )}
                {saleAmountError && (
                    <div className="mt-2 text-xs text-red-600">{saleAmountError}</div>
                )}
            </div>
            )}

            {detailSection === 'menu' && (
                <div className="space-y-4 mb-8">
                    <div className="flex items-center justify-end">
                        <div className="inline-flex items-center rounded-xl border border-gray-200 bg-white p-1">
                            <button
                                type="button"
                                onClick={() => setMenuSection('items')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                                    menuSection === 'items' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100'
                                }`}
                            >
                                Items ({storeMenus.length})
                            </button>
                            <button
                                type="button"
                                onClick={() => setMenuSection('sets')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                                    menuSection === 'sets' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100'
                                }`}
                            >
                                Set Menus ({storeSetMenus.length})
                            </button>
                        </div>
                    </div>

                    {menuSection === 'items' ? (
                        <MenuManager
                            store={store}
                            menus={storeMenus}
                            onEdit={setEditingMenu}
                            onCreate={(menu) => setEditingMenu(menu)}
                            onDelete={onDeleteMenu}
                        />
                    ) : (
                        <SetMenuManager
                            store={store}
                            menus={storeMenus}
                            setMenus={storeSetMenus}
                            onEdit={setEditingSetMenu}
                            onCreate={(setMenu) => setEditingSetMenu(setMenu)}
                            onDelete={onDeleteSetMenu}
                        />
                    )}
                </div>
            )}

            {detailSection === 'staff' && (
            <div className="mt-2 mb-8">
                <EmployeeManager
                    store={store}
                    employees={storeEmployees}
                    positions={positions}
                    onUpdate={(emps) => onUpdateEmployees(store.id, emps)}
                />
            </div>
            )}

            {detailSection === 'accounts' && (
                <div className="space-y-8 mb-8">
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
                        <h2 className="text-xl font-bold mb-2">Approve Account for This Store</h2>
                        <p className="text-xs text-gray-500 mb-4">
                            Enter the email after the owner signs in and submits an access request. Only HQ can connect an account to an approved store.
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
                                {linkBusy ? 'Approving...' : 'Approve Account'}
                            </button>
                        </div>
                        {linkError && <div className="mt-3 text-xs text-red-600">{linkError}</div>}
                        {linkSuccess && <div className="mt-3 text-xs text-emerald-600">{linkSuccess}</div>}
                        <div className="mt-3 text-[10px] text-gray-400">
                            The user must sign in once and submit an access request before approval.
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
                        <h2 className="text-xl font-bold mb-2 text-red-700">Remove Non-operating Store</h2>
                        <p className="text-xs text-red-600 mb-4">
                            Only test or held stores can be removed. A recovery snapshot is saved before all related data is deleted.
                        </p>
                        <button
                            type="button"
                            onClick={handleDeleteStore}
                            className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700"
                        >
                            Archive and Remove Store
                        </button>
                        {deleteError && <div className="mt-3 text-xs text-red-600">{deleteError}</div>}
                    </div>
                </div>
            )}

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
  setMenus: SetMenu[];
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
  onMergeStores: (sourceId: string, targetId: string) => Promise<void>;
  onDeleteStore: (storeId: string) => Promise<void>;
  onUpdateMenu: (menu: Menu) => void;
  onCreateMenu: (menu: Menu) => void;
  onDeleteMenu: (id: string) => void;
  onUpdateSetMenu: (setMenu: SetMenu) => void;
  onCreateSetMenu: (setMenu: SetMenu) => void;
  onDeleteSetMenu: (id: string) => void;
  onUpdateEmployees: (storeId: string, employees: Employee[]) => void;
    onAddIngredient: (ing: Ingredient) => Promise<void> | void;
}> = ({ user, onLogout, stores, sales, menus, setMenus, employees, ingredients, storeStocks, globalConfig, salesLookbackLabel, onLoadMoreSales, onUpdateGlobalConfig, onUpdateStore, onSaveStoreStocks, onMergeStores, onDeleteStore, onUpdateMenu, onCreateMenu, onDeleteMenu, onUpdateSetMenu, onCreateSetMenu, onDeleteSetMenu, onUpdateEmployees, onAddIngredient }) => {
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSalesAnalyticsOpen, setIsSalesAnalyticsOpen] = useState(false);
  const [hqLocale, setHqLocale] = useState<HQLocale>(() => {
    if (typeof window === 'undefined') return 'ja';
    return window.localStorage.getItem(HQ_LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'ja';
  });
  const reportingStores = useMemo(
    () => stores.filter((store) => (
      (store.reportingStatus ?? 'active') === 'active'
      && store.country.trim().toUpperCase() !== 'TEST'
      && !store.id.startsWith('TEST_')
    )),
    [stores],
  );
  const hqMonthOptions = useMemo(() => {
    const keys = new Set<string>([formatMonthKey(new Date())]);
    const reportingStoreIds = new Set(reportingStores.map((store) => store.id));
    dedupeSalesByStoreDate(sales).forEach((sale) => {
      if (!reportingStoreIds.has(sale.storeId)) return;
      const key = extractMonthKey(sale.date);
      if (key) keys.add(key);
    });
    return Array.from(keys).sort((a, b) => b.localeCompare(a));
  }, [reportingStores, sales]);
  const [selectedMonthKey, setSelectedMonthKey] = useState(() => formatMonthKey(new Date()));
  const hqCountries = useMemo<string[]>(
    () => Array.from(new Set<string>(reportingStores.map((store) => store.country))).sort((a, b) => a.localeCompare(b)),
    [reportingStores],
  );
  const [selectedCountry, setSelectedCountry] = useState<string>('all');
  const testStores = useMemo(
    () => stores.filter((store) => (
      store.reportingStatus === 'test'
      || store.country.trim().toUpperCase() === 'TEST'
      || store.id.startsWith('TEST_')
    )),
    [stores],
  );
  const quarantinedStores = useMemo(
    () => stores.filter((store) => store.reportingStatus === 'quarantined'),
    [stores],
  );
  const testStoreSummaries = useMemo(() => testStores.map((store) => {
    const storeSales = dedupeSalesByStoreDate(sales)
      .filter((sale) => sale.storeId === store.id)
      .sort((left, right) => right.date.localeCompare(left.date));
    const monthKey = storeSales.length > 0
      ? extractMonthKey(storeSales[0].date)
      : formatMonthKey(new Date());
    const monthSales = storeSales.filter((sale) => extractMonthKey(sale.date) === monthKey);
    return {
      store,
      monthKey,
      salesDays: monthSales.length,
      salesTotal: monthSales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0),
      menuCount: menus.filter((menu) => menu.storeId === store.id).length,
      courseCount: setMenus.filter((setMenu) => setMenu.storeId === store.id).length,
    };
  }), [menus, sales, setMenus, testStores]);
  const [ownerAccountAssignments, setOwnerAccountAssignments] = useState<OwnerAccountAssignment[]>([]);
  const [ownerAccountTargets, setOwnerAccountTargets] = useState<Record<string, string>>({});
  const [ownerAccountBusy, setOwnerAccountBusy] = useState<string | null>(null);
  const [ownerAccountError, setOwnerAccountError] = useState<string | null>(null);
  const [ownerAccountSuccess, setOwnerAccountSuccess] = useState<string | null>(null);
  const [ownerAccountSearch, setOwnerAccountSearch] = useState('');
  const deferredOwnerAccountSearch = useDeferredValue(ownerAccountSearch);
  const [maintenanceDeleteBusy, setMaintenanceDeleteBusy] = useState<string | null>(null);
  const [maintenanceDeleteError, setMaintenanceDeleteError] = useState<string | null>(null);
  const filteredStores = useMemo(
    () => selectedCountry === 'all'
      ? reportingStores
      : reportingStores.filter((store) => store.country === selectedCountry),
    [reportingStores, selectedCountry],
  );
  const navRestoreRef = useRef(false);
  const { rates: fxRates, status: fxStatus, sourceText: fxSourceText, refreshNow: refreshFxNow } = useFxRates();
  const convertHqAmountToJpy = useCallback(
    (amount: number, currency: string) => convertToJPY(amount, currency, fxRates),
    [fxRates],
  );

  // Tabs for Settings
  const [settingsTab, setSettingsTab] = useState<'general' | 'locations' | 'finance' | 'ops' | 'menu'>('general');

  const updateHqLocale = useCallback((locale: HQLocale) => {
    setHqLocale(locale);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(HQ_LANGUAGE_STORAGE_KEY, locale);
    }
  }, []);

  const accountAssignmentStores = useMemo(
    () => [...reportingStores, ...testStores].sort((left, right) => left.name.localeCompare(right.name)),
    [reportingStores, testStores],
  );
  const pendingOwnerCount = useMemo(
    () => ownerAccountAssignments.filter(account => !account.storeId).length,
    [ownerAccountAssignments],
  );
  const visibleOwnerAccountAssignments = useMemo(() => {
    const query = deferredOwnerAccountSearch.trim().toLowerCase();
    if (!query) return ownerAccountAssignments;
    return ownerAccountAssignments.filter(account => (
      account.email.toLowerCase().includes(query)
      || account.name.toLowerCase().includes(query)
      || (account.storeName ?? '').toLowerCase().includes(query)
    ));
  }, [deferredOwnerAccountSearch, ownerAccountAssignments]);

  const refreshOwnerAccountAssignments = useCallback(async () => {
    if (isLocalHqPreviewMode()) {
      setOwnerAccountAssignments([]);
      return;
    }
    try {
      const rows = await loadOwnerAccountAssignments();
      setOwnerAccountAssignments(rows);
      setOwnerAccountError(null);
    } catch (error) {
      console.error('Failed to load owner account assignments', error);
      setOwnerAccountError(toErrorMessage(error, 'Failed to load owner accounts.'));
    }
  }, []);

  useEffect(() => {
    void refreshOwnerAccountAssignments();
  }, [refreshOwnerAccountAssignments]);

  const applyOwnerAccountAssignment = useCallback(async (account: OwnerAccountAssignment) => {
    const currentTarget = account.storeId ?? UNLINKED_STORE_TARGET;
    const targetStoreId = ownerAccountTargets[account.email] ?? currentTarget;
    if (targetStoreId === currentTarget) return;
    try {
      setOwnerAccountBusy(account.email);
      setOwnerAccountError(null);
      setOwnerAccountSuccess(null);
      if (targetStoreId === UNLINKED_STORE_TARGET) {
        if (account.storeId) await unlinkAccountFromStore(account.email, account.storeId);
        setOwnerAccountSuccess(`${account.email} → Unlinked`);
      } else {
        await linkAccountToStore(account.email, targetStoreId);
        const targetStore = accountAssignmentStores.find(store => store.id === targetStoreId);
        setOwnerAccountSuccess(`${account.email} → ${targetStore?.name ?? targetStoreId}`);
      }
      setOwnerAccountTargets(prev => {
        const next = { ...prev };
        delete next[account.email];
        return next;
      });
      await refreshOwnerAccountAssignments();
    } catch (error) {
      console.error('Failed to update owner account assignment', error);
      setOwnerAccountError(toErrorMessage(error, 'Failed to update the account connection.'));
    } finally {
      setOwnerAccountBusy(null);
    }
  }, [accountAssignmentStores, ownerAccountTargets, refreshOwnerAccountAssignments]);

  const removeMaintenanceStore = useCallback(async (store: Store) => {
    const confirmation = window.prompt(
      `A recovery copy will be saved before this test/held store is removed.\n\nType the exact store name to continue:\n${store.name}`
    );
    if (confirmation === null) return;
    if (confirmation.trim() !== store.name) {
      setMaintenanceDeleteError('Store name did not match. Nothing was deleted.');
      return;
    }
    try {
      setMaintenanceDeleteBusy(store.id);
      setMaintenanceDeleteError(null);
      await onDeleteStore(store.id);
      await refreshOwnerAccountAssignments();
    } catch (error) {
      console.error('Failed to remove non-operating store', error);
      setMaintenanceDeleteError(toErrorMessage(error, 'Failed to remove the store.'));
    } finally {
      setMaintenanceDeleteBusy(null);
    }
  }, [onDeleteStore, refreshOwnerAccountAssignments]);

  useEffect(() => {
    if (!hqMonthOptions.includes(selectedMonthKey)) {
      setSelectedMonthKey(hqMonthOptions[0] ?? formatMonthKey(new Date()));
    }
  }, [hqMonthOptions, selectedMonthKey]);

  useEffect(() => {
    if (selectedCountry !== 'all' && !hqCountries.includes(selectedCountry)) {
      setSelectedCountry('all');
    }
  }, [hqCountries, selectedCountry]);

  const countryPerformance = useMemo(() => hqCountries.map((country) => {
    const countryStores = reportingStores.filter((store) => store.country === country);
    const storeIds = new Set(countryStores.map((store) => store.id));
    const localTotals: Record<string, number> = {};
    let totalJPY = 0;
    let missingReports = 0;

    dedupeSalesByStoreDate(sales).forEach((sale) => {
      if (!storeIds.has(sale.storeId) || extractMonthKey(sale.date) !== selectedMonthKey) return;
      const store = countryStores.find((row) => row.id === sale.storeId);
      if (!store) return;
      localTotals[store.currency] = (localTotals[store.currency] ?? 0) + Number(sale.totalAmount || 0);
      totalJPY += convertToJPY(sale.totalAmount, store.currency, fxRates) ?? 0;
    });
    countryStores.forEach((store) => {
      missingReports += getStoreMonthReportStatus(sales, store.id, selectedMonthKey).missingDates.length;
    });

    return {
      country,
      stores: countryStores.length,
      localTotals,
      totalJPY,
      missingReports,
    };
  }), [hqCountries, reportingStores, sales, selectedMonthKey, fxRates]);
  const selectedCountryPerformance = selectedCountry === 'all'
    ? null
    : countryPerformance.find((row) => row.country === selectedCountry) ?? null;

  const formatCountryLocalTotals = (totals: Record<string, number>) => {
    const entries = Object.entries(totals).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) return 'No sales reported';
    return entries
      .map(([currency, amount]) => `${currency} ${Math.round(amount).toLocaleString()}`)
      .join(' / ');
  };

  // --- Real-time Metrics Calculation ---
  const metrics = useMemo(() => {
      const [selectedYear, selectedMonth] = selectedMonthKey.split('-').map(Number);
      const prevDate = new Date(selectedYear, selectedMonth - 2, 1);
      const prevMonthKey = formatMonthKey(prevDate);
      const currentMonthName = formatMonthKeyLabel(selectedMonthKey);
      const selectedStoreIds = new Set(filteredStores.map((store) => store.id));

      let totalSalesCurrentMonth = 0;
      let totalRoyaltyCurrentMonth = 0;
      let totalSalesLastMonth = 0;

      sales.forEach(sale => {
          const store = stores.find(s => s.id === sale.storeId);
          if (!store || !selectedStoreIds.has(store.id)) return;

          const amountJPY = convertToJPY(sale.totalAmount, store.currency, fxRates) ?? 0;
          const monthKey = sale.date.slice(0, 7);

          if (monthKey === selectedMonthKey) {
              totalSalesCurrentMonth += amountJPY;
              totalRoyaltyCurrentMonth += amountJPY * (store.royaltyPercentage / 100);
          } else if (monthKey === prevMonthKey) {
              totalSalesLastMonth += amountJPY;
          }
      });

      const growthRate: number | null = totalSalesLastMonth > 0
          ? ((totalSalesCurrentMonth - totalSalesLastMonth) / totalSalesLastMonth) * 100
          : null;

      return {
          totalSalesCurrentMonth,
          totalRoyaltyCurrentMonth,
          growthRate,
          currentMonthName,
          activeStores: filteredStores.length,
          inventorySetupGaps: filteredStores.reduce((gapCount, store) => (
              gapCount + globalConfig.standardIngredients.filter((ingredient) => {
                  const stock = storeStocks.find((row) => (
                      row.storeId === store.id
                      && row.ingredientName.trim().toLowerCase() === ingredient.name.trim().toLowerCase()
                  ));
                  return !stock || stock.par <= 0 || stock.reorder <= 0;
              }).length
          ), 0)
      };
  }, [sales, stores, filteredStores, selectedMonthKey, fxRates, storeStocks, globalConfig.standardIngredients]);

  const handleExportSalesProgress = useCallback(async () => {
    try {
      await exportGlobalSalesProgressWorkbook(reportingStores, sales, fxRates, fxStatus, fxSourceText);
    } catch (error) {
      console.error('Failed to export HD sales workbook', error);
      alert(`Excel export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [reportingStores, sales, fxRates, fxStatus, fxSourceText]);

  const openHqDashboardOverlay = useCallback((overlay: 'settings' | 'sales-analytics') => {
    if (typeof window === 'undefined') return;
    setIsSettingsOpen(overlay === 'settings');
    setIsSalesAnalyticsOpen(overlay === 'sales-analytics');
    window.history.pushState(
      {
        screen: 'hq',
        selectedStoreId: null,
        overlay,
        settingsTab,
      },
      ''
    );
  }, [settingsTab]);

  const closeHqDashboardOverlay = useCallback((overlay: 'settings' | 'sales-analytics') => {
    if (typeof window !== 'undefined') {
      const state = window.history.state as { screen?: string; overlay?: string } | null;
      if (state?.screen === 'hq' && state.overlay === overlay) {
        window.history.back();
        return;
      }
    }
    if (overlay === 'settings') setIsSettingsOpen(false);
    if (overlay === 'sales-analytics') setIsSalesAnalyticsOpen(false);
  }, []);

  const selectSettingsTab = useCallback((tab: 'general' | 'locations' | 'finance' | 'ops' | 'menu') => {
    setSettingsTab(tab);
    if (typeof window === 'undefined') return;
    const state = window.history.state as { screen?: string; overlay?: string } | null;
    if (state?.screen === 'hq' && state.overlay === 'settings') {
      window.history.replaceState({ ...state, settingsTab: tab }, '');
    }
  }, []);

  const openHqStore = useCallback((
    store: Store,
    section: 'sales' | 'close' | 'inventory' | 'invoice' | 'menu' | 'staff' | 'accounts' = 'sales',
    monthKey: string = selectedMonthKey,
  ) => {
    setSelectedMonthKey(monthKey);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('hs', section);
      if (section !== 'menu') url.searchParams.delete('hm');
      window.history.pushState(
        {
          screen: 'hq-detail',
          storeId: store.id,
          section,
          menuSection: 'items',
        },
        '',
        `${url.pathname}${url.search}${url.hash}`
      );
    }
    setSelectedStore(store);
  }, [selectedMonthKey]);

  const replaceWithHqDashboard = useCallback(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('hs');
      url.searchParams.delete('hm');
      window.history.replaceState(
        {
          screen: 'hq',
          selectedStoreId: null,
          overlay: null,
          settingsTab,
        },
        '',
        `${url.pathname}${url.search}${url.hash}`
      );
    }
    setIsSettingsOpen(false);
    setIsSalesAnalyticsOpen(false);
    setSelectedStore(null);
  }, [settingsTab]);

  const closeHqStore = useCallback(() => {
    replaceWithHqDashboard();
    void refreshOwnerAccountAssignments();
  }, [refreshOwnerAccountAssignments, replaceWithHqDashboard]);

  useEffect(() => {
    if (typeof window === 'undefined' || navRestoreRef.current) return;
    const historyState = window.history.state as {
      screen?: string;
      selectedStoreId?: string | null;
      storeId?: string | null;
      section?: string;
      menuSection?: string;
      overlay?: string;
      settingsTab?: string;
    } | null;
    const hasAppHistory = historyState?.screen === 'hq' || historyState?.screen === 'hq-detail';
    const historyStoreId = historyState?.screen === 'hq-detail'
      ? historyState.storeId ?? null
      : historyState?.screen === 'hq'
        ? historyState.selectedStoreId ?? null
        : null;
    const persistedStoreId = isLocalHqPreviewMode()
      ? null
      : hasAppHistory
        ? historyStoreId
        : null;
    if (persistedStoreId && stores.length === 0) return;

    const restoredStore = persistedStoreId
      ? stores.find(s => s.id === persistedStoreId) ?? null
      : null;
    setSelectedStore(restoredStore);
    const restoredOverlay = !restoredStore && historyState?.screen === 'hq'
      ? historyState.overlay
      : null;
    setIsSettingsOpen(restoredOverlay === 'settings');
    setIsSalesAnalyticsOpen(restoredOverlay === 'sales-analytics');
    if (
      historyState?.settingsTab === 'general'
      || historyState?.settingsTab === 'locations'
      || historyState?.settingsTab === 'finance'
      || historyState?.settingsTab === 'ops'
      || historyState?.settingsTab === 'menu'
    ) {
      setSettingsTab(historyState.settingsTab);
    }
    window.history.replaceState(
      restoredStore
        ? {
            screen: 'hq-detail',
            storeId: restoredStore.id,
            section: historyState?.screen === 'hq-detail' ? historyState.section ?? 'sales' : 'sales',
            menuSection: historyState?.screen === 'hq-detail' ? historyState.menuSection ?? 'items' : 'items',
          }
        : {
            screen: 'hq',
            selectedStoreId: null,
            overlay: restoredOverlay ?? null,
            settingsTab: historyState?.settingsTab ?? 'general',
          },
      ''
    );
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
    const onPopState = (e: PopStateEvent) => {
      const state = e.state as {
        screen?: string;
        selectedStoreId?: string | null;
        storeId?: string | null;
        overlay?: string;
        settingsTab?: string;
      } | null;
      if (selectedStore && (!state || state.screen !== 'hq')) {
        replaceWithHqDashboard();
        return;
      }
      if (!state || (state.screen !== 'hq' && state.screen !== 'hq-detail')) {
        return;
      }
      setIsSettingsOpen(state.screen === 'hq' && state.overlay === 'settings');
      setIsSalesAnalyticsOpen(state.screen === 'hq' && state.overlay === 'sales-analytics');
      if (
        state.settingsTab === 'general'
        || state.settingsTab === 'locations'
        || state.settingsTab === 'finance'
        || state.settingsTab === 'ops'
        || state.settingsTab === 'menu'
      ) {
        setSettingsTab(state.settingsTab);
      }
      const storeId = state.screen === 'hq-detail'
        ? state.storeId
        : state.selectedStoreId;
      const store = storeId
        ? stores.find(s => s.id === storeId) ?? null
        : null;
      setSelectedStore(store);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [replaceWithHqDashboard, selectedStore, stores]);

  useEffect(() => {
    if (!selectedStore) return;
    const updated = stores.find(s => s.id === selectedStore.id);
    if (updated && (updated.royaltyPercentage !== selectedStore.royaltyPercentage || updated.currency !== selectedStore.currency || updated.name !== selectedStore.name)) {
      setSelectedStore(updated);
    }
  }, [stores, selectedStore]);

  if (selectedStore) {
    return (
      <HQLanguageBoundary locale={hqLocale}>
        <HQStoreDetail
          store={selectedStore}
          initialMonthKey={selectedMonthKey}
          sales={sales}
          menus={menus}
          setMenus={setMenus}
          employees={employees}
          ingredients={ingredients}
          storeStocks={storeStocks}
          allStores={stores}
          categories={globalConfig.categories}
          standardIngredients={globalConfig.standardIngredients}
          currencies={globalConfig.currencies}
          positions={globalConfig.positions}
          fxRates={fxRates}
          fxStatus={fxStatus}
          fxSourceText={fxSourceText}
          onRefreshFx={refreshFxNow}
          salesLookbackLabel={salesLookbackLabel}
          onLoadMoreSales={onLoadMoreSales}
          onBack={closeHqStore}
          onUpdateStore={onUpdateStore}
          onSaveStoreStocks={onSaveStoreStocks}
          onMergeStores={onMergeStores}
          onDeleteStore={onDeleteStore}
          onUpdateMenu={onUpdateMenu}
          onCreateMenu={onCreateMenu}
          onDeleteMenu={onDeleteMenu}
          onUpdateSetMenu={onUpdateSetMenu}
          onCreateSetMenu={onCreateSetMenu}
          onDeleteSetMenu={onDeleteSetMenu}
          onUpdateEmployees={onUpdateEmployees}
          onAddIngredient={onAddIngredient}
          hqLocale={hqLocale}
          onHqLocaleChange={updateHqLocale}
        />
      </HQLanguageBoundary>
    );
  }

  return (
    <HQLanguageBoundary locale={hqLocale}>
    <div className="min-h-screen bg-gray-50 flex flex-col">
       {/* Header */}
       <div className="sticky top-0 z-40 flex items-center justify-between border-b bg-white px-4 py-3 sm:px-8 sm:py-4">
          <div className="flex items-center gap-4">
             <div className="w-10 h-10 bg-black text-white rounded-full flex items-center justify-center text-lg font-bold">HQ</div>
             <div>
                <h1 className="text-xl font-extrabold tracking-tight">CHIBO HEADQUARTERS</h1>
                <div className="text-xs text-gray-500 font-medium">Global Admin Console</div>
             </div>
          </div>
          <div className="flex items-center gap-4">
             <button aria-label="Open global settings" onClick={() => openHqDashboardOverlay('settings')} className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full p-2 text-gray-600 transition hover:bg-gray-100">
                 <Settings className="w-5 h-5" />
                 <span className="text-sm font-bold hidden md:inline">Global Settings</span>
             </button>
             <div className="text-right hidden md:block">
                <div className="font-bold text-sm">{user.name}</div>
                <div className="text-xs text-gray-500">{user.email}</div>
             </div>
             <button aria-label="Sign out" onClick={onLogout} className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-gray-100"><LogOut className="w-5 h-5 text-gray-600" /></button>
          </div>
       </div>

       <div className="flex justify-end border-b bg-white px-4 py-2 sm:px-8">
         <HQLanguageSwitch locale={hqLocale} onChange={updateHqLocale} />
       </div>

       {isLocalHqPreviewMode() && (
         <>
           <div className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-xs font-black text-amber-950">
             DEMO PREVIEW · Sample numbers only · Never use this screen to verify operating data
           </div>
           <div className="pointer-events-none fixed bottom-4 left-1/2 z-[95] max-w-[calc(100%-2rem)] -translate-x-1/2 whitespace-nowrap rounded-full border-2 border-amber-400 bg-amber-100/95 px-4 py-2 text-center text-xs font-black text-amber-950 shadow-lg backdrop-blur">
             DEMO · 実データではありません
           </div>
         </>
       )}

       {isSettingsOpen && (
           <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
               <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                   <div className="p-6 border-b flex justify-between items-center bg-gray-50 rounded-t-2xl">
                       <h2 className="text-xl font-bold">Global Configuration</h2>
                       <button aria-label="Close global settings" onClick={() => closeHqDashboardOverlay('settings')} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-gray-200"><XCircle className="w-6 h-6 text-gray-400 hover:text-black"/></button>
                   </div>

                   <div className="flex overflow-x-auto border-b">
                       <button onClick={() => selectSettingsTab('general')} className={`min-h-12 min-w-[120px] flex-1 border-b-2 px-3 py-3 text-sm font-bold ${settingsTab === 'general' ? 'border-black text-black' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>Store Setup</button>
                       <button onClick={() => selectSettingsTab('locations')} className={`min-h-12 min-w-[120px] flex-1 border-b-2 px-3 py-3 text-sm font-bold ${settingsTab === 'locations' ? 'border-black text-black' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>Locations</button>
                       <button onClick={() => selectSettingsTab('finance')} className={`min-h-12 min-w-[120px] flex-1 border-b-2 px-3 py-3 text-sm font-bold ${settingsTab === 'finance' ? 'border-black text-black' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>Finance</button>
                       <button onClick={() => selectSettingsTab('ops')} className={`min-h-12 min-w-[120px] flex-1 border-b-2 px-3 py-3 text-sm font-bold ${settingsTab === 'ops' ? 'border-black text-black' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>Operations</button>
                       <button onClick={() => selectSettingsTab('menu')} className={`min-h-12 min-w-[120px] flex-1 border-b-2 px-3 py-3 text-sm font-bold ${settingsTab === 'menu' ? 'border-black text-black' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>Menu Config</button>
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
                       <button onClick={() => closeHqDashboardOverlay('settings')} className="bg-black text-white px-6 py-2 rounded-xl font-bold text-sm hover:bg-gray-800">Done</button>
                   </div>
               </div>
           </div>
       )}

       <SalesAnalyticsModal
            isOpen={isSalesAnalyticsOpen}
            onClose={() => closeHqDashboardOverlay('sales-analytics')}
            sales={sales}
            stores={reportingStores}
            fxRates={fxRates}
            fxStatus={fxStatus}
            fxSourceText={fxSourceText}
       />

       <div className="mx-auto w-full max-w-7xl flex-1 space-y-4 overflow-y-auto p-3 sm:space-y-6 sm:p-6 lg:space-y-8 lg:p-8">
           <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-3 sm:hidden">
                  <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">Store review</div>
                          <h2 className="mt-0.5 text-base font-extrabold">Choose month and country</h2>
                      </div>
                      <div className="shrink-0 text-xs font-bold text-gray-500">{filteredStores.length} stores</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                      <label className="block min-w-0">
                          <span className="mb-1 block text-[10px] font-black uppercase text-gray-500">Reporting month</span>
                          <select
                              value={selectedMonthKey}
                              onChange={(event) => setSelectedMonthKey(event.target.value)}
                              className="min-h-11 w-full rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-2 text-sm font-extrabold"
                          >
                              {hqMonthOptions.map((monthKey) => (
                                  <option key={monthKey} value={monthKey}>{formatMonthKeyLabel(monthKey)}</option>
                              ))}
                          </select>
                      </label>
                      <label className="block min-w-0">
                          <span className="mb-1 block text-[10px] font-black uppercase text-gray-500">Country</span>
                          <select
                              value={selectedCountry}
                              onChange={(event) => setSelectedCountry(event.target.value)}
                              className="min-h-11 w-full rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-2 text-sm font-extrabold"
                          >
                              <option value="all">All countries</option>
                              {countryPerformance.map((row) => (
                                  <option key={row.country} value={row.country}>{row.country}</option>
                              ))}
                          </select>
                      </label>
                  </div>
              </div>
              <div className="hidden border-b bg-gray-50 p-4 sm:block sm:p-6">
                  <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                      <div>
                          <div className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Store review</div>
                          <h2 className="mt-1 text-xl font-extrabold sm:text-2xl">Review stores by month</h2>
                          <p className="text-sm text-gray-500 mt-1">Select a month, then choose a country. The matching stores appear below.</p>
                      </div>
                      <label className="block min-w-[220px]">
                          <span className="text-xs font-bold uppercase text-gray-500">1. Select month</span>
                          <select
                              value={selectedMonthKey}
                              onChange={(event) => setSelectedMonthKey(event.target.value)}
                              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold"
                          >
                              {hqMonthOptions.map((monthKey) => (
                                  <option key={monthKey} value={monthKey}>{formatMonthKeyLabel(monthKey)}</option>
                              ))}
                          </select>
                      </label>
                  </div>
              </div>
              <div className="hidden p-4 sm:block sm:p-6">
                  <div className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-gray-500">2. Select country</div>
                  <div className="sm:hidden">
                      <select
                          value={selectedCountry}
                          onChange={(event) => setSelectedCountry(event.target.value)}
                          className="min-h-12 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-extrabold"
                      >
                          <option value="all">All countries · {reportingStores.length} stores</option>
                          {countryPerformance.map((row) => (
                              <option key={row.country} value={row.country}>{row.country} · {row.stores} store{row.stores === 1 ? '' : 's'}</option>
                          ))}
                      </select>
                      <div className={`mt-2 rounded-xl border p-3 ${selectedCountry === 'all' ? 'border-black bg-black text-white' : 'border-gray-200 bg-gray-50 text-gray-950'}`}>
                          <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                  <div className="text-xs font-bold opacity-60">{selectedCountry === 'all' ? 'All countries' : selectedCountryPerformance?.country}</div>
                                  <div className="mt-1 text-xl font-extrabold">{selectedCountry === 'all' ? reportingStores.length : selectedCountryPerformance?.stores ?? 0} stores</div>
                              </div>
                              {selectedCountryPerformance && (
                                  <span className={`rounded-full px-2 py-1 text-[9px] font-black ${selectedCountryPerformance.missingReports > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                      {selectedCountryPerformance.missingReports > 0 ? `${selectedCountryPerformance.missingReports} report days missing` : 'Reports complete'}
                                  </span>
                              )}
                          </div>
                          <div className="mt-2 text-xs font-bold">
                              {selectedCountryPerformance ? formatCountryLocalTotals(selectedCountryPerformance.localTotals) : `JPY ${Math.round(metrics.totalSalesCurrentMonth).toLocaleString()}`}
                          </div>
                          {selectedCountryPerformance && <div className="mt-0.5 text-[11px] opacity-60">JPY {Math.round(selectedCountryPerformance.totalJPY).toLocaleString()}</div>}
                      </div>
                  </div>
                  <div className="hidden gap-3 sm:grid sm:grid-cols-2 xl:grid-cols-4">
                      <button
                          type="button"
                          onClick={() => setSelectedCountry('all')}
                          className={`min-h-[108px] rounded-xl border p-3 text-left transition sm:min-h-[132px] sm:p-4 ${
                              selectedCountry === 'all'
                                  ? 'border-black bg-black text-white shadow-lg'
                                  : 'border-gray-200 bg-white hover:border-gray-400'
                          }`}
                      >
                          <div className="text-xs font-bold opacity-60 uppercase">All countries</div>
                          <div className="mt-1 text-xl font-extrabold sm:text-2xl">{reportingStores.length} stores</div>
                          <div className="mt-1.5 text-[11px] opacity-70 sm:mt-2 sm:text-xs">Network overview</div>
                      </button>
                      {countryPerformance.map((row) => (
                          <button
                              key={row.country}
                              type="button"
                              onClick={() => setSelectedCountry(row.country)}
                              className={`min-h-[108px] rounded-xl border p-3 text-left transition sm:min-h-[132px] sm:p-4 ${
                                  selectedCountry === row.country
                                      ? 'border-black bg-black text-white shadow-lg'
                                      : 'border-gray-200 bg-white hover:border-gray-400'
                              }`}
                          >
                              <div className="flex min-w-0 flex-col items-start gap-1.5 sm:flex-row sm:justify-between sm:gap-2">
                                  <div className="min-w-0">
                                      <div className="font-extrabold">{row.country}</div>
                                      <div className="text-xs mt-0.5 opacity-60">{row.stores} store{row.stores === 1 ? '' : 's'}</div>
                                  </div>
                                  <span className={`max-w-full shrink-0 rounded-full px-2 py-1 text-left text-[9px] font-black leading-tight sm:max-w-[112px] sm:text-right sm:text-[10px] ${
                                      selectedCountry === row.country
                                          ? 'bg-white/15 text-white'
                                          : row.missingReports > 0
                                              ? 'bg-red-100 text-red-700'
                                              : 'bg-emerald-100 text-emerald-700'
                                  }`}>
                                      {row.missingReports > 0 ? `${row.missingReports} report days missing` : 'Reports complete'}
                                  </span>
                              </div>
                              <div className="mt-2 text-xs font-bold sm:mt-3 sm:text-sm">{formatCountryLocalTotals(row.localTotals)}</div>
                              <div className="mt-0.5 text-[11px] opacity-60 sm:mt-1 sm:text-xs">JPY {Math.round(row.totalJPY).toLocaleString()}</div>
                          </button>
                      ))}
                  </div>
              </div>
           </section>

           <section>
             <div className="mb-2 flex items-end justify-between gap-3 px-1">
               <div>
                 <div className="text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">Select store</div>
                 <h3 className="mt-0.5 text-lg font-extrabold">
                   {selectedCountry === 'all' ? 'All Stores' : `${selectedCountry} Stores`}
                 </h3>
               </div>
               <div className="text-xs font-bold text-gray-500">{filteredStores.length} stores</div>
             </div>
             <div className="grid overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm md:grid-cols-2 md:gap-3 md:overflow-visible md:border-0 md:bg-transparent md:shadow-none xl:grid-cols-3">
               {filteredStores.map((store) => {
                 const monthSales = dedupeSalesByStoreDate(sales)
                   .filter((sale) => sale.storeId === store.id && extractMonthKey(sale.date) === selectedMonthKey);
                 const localSales = monthSales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0);
                 const salesJPY = convertToJPY(localSales, store.currency, fxRates);
                 const reportStatus = getStoreMonthReportStatus(sales, store.id, selectedMonthKey);
                 return (
                   <button
                     type="button"
                     key={store.id}
                     onClick={() => openHqStore(store)}
                     className="grid min-h-[82px] w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-gray-100 px-3 py-2.5 text-left last:border-b-0 active:bg-gray-50 md:rounded-xl md:border md:border-gray-200 md:bg-white md:shadow-sm md:last:border"
                   >
                     <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-xs font-black text-gray-600">
                       {store.country.substring(0, 2).toUpperCase()}
                     </span>
                     <span className="min-w-0">
                       <span className="block truncate text-sm font-extrabold text-gray-950">{store.name}</span>
                       <span className="mt-0.5 block truncate text-[11px] text-gray-500">{store.city}, {store.country}</span>
                       <span className="mt-1 block text-xs font-bold text-gray-900">
                         {store.currency} {Math.round(localSales).toLocaleString()}
                         {store.currency !== 'JPY' && salesJPY !== null && (
                           <span className="ml-1.5 font-medium text-gray-400">· JPY {Math.round(salesJPY).toLocaleString()}</span>
                         )}
                       </span>
                     </span>
                     <span className="flex min-w-[72px] flex-col items-end gap-1.5">
                       <span className={`rounded-full px-2 py-1 text-[9px] font-black leading-tight ${
                         reportStatus.missingDates.length > 0
                           ? 'bg-red-100 text-red-700'
                           : 'bg-emerald-100 text-emerald-700'
                       }`}>
                         {reportStatus.missingDates.length > 0 ? `${reportStatus.missingDates.length} days missing` : 'Complete'}
                       </span>
                       <ChevronRight className="h-4 w-4 text-gray-400" />
                     </span>
                   </button>
                 );
               })}
             </div>
           </section>

           <details className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
             <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
               <div className="min-w-0">
                 <div className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-400">Network summary</div>
                 <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                   <span className="text-lg font-extrabold text-gray-950">JPY {Math.round(metrics.totalSalesCurrentMonth).toLocaleString()}</span>
                   <span className="text-xs font-bold text-gray-500">{metrics.activeStores} stores · {formatMonthKeyLabel(selectedMonthKey)}</span>
                 </div>
                 <div className="mt-1 text-xs text-gray-500">Open only when you need sales, royalty and setup totals.</div>
               </div>
               <ChevronRight className="h-5 w-5 shrink-0 text-gray-400 transition group-open:rotate-90" />
             </summary>
             <div className="border-t border-gray-100 p-5">
           {/* KPI Cards */}
           <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              {/* Sales Card */}
              <button
                type="button"
                onClick={() => openHqDashboardOverlay('sales-analytics')}
                className="bg-black text-white p-6 rounded-2xl shadow-lg cursor-pointer hover:scale-105 active:scale-95 hover:shadow-2xl transition-all duration-300 group text-left relative overflow-hidden focus:ring-4 focus:ring-black/20 outline-none"
              >
                  <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                  <div className="flex justify-between items-start relative z-10">
                      <h3 className="text-sm font-bold opacity-70 flex items-center gap-2">
                          Selected Sales
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
                      <span className={`text-xs font-bold ${
                          metrics.growthRate === null
                              ? 'text-gray-400'
                              : metrics.growthRate >= 0
                                  ? 'text-emerald-400'
                                  : 'text-red-400'
                      }`}>
                          {metrics.growthRate === null
                              ? '—'
                              : `${metrics.growthRate >= 0 ? '↑' : '↓'} ${Math.abs(metrics.growthRate).toFixed(1)}%`}
                      </span>
                      <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">
                          {metrics.growthRate === null ? 'No prior-month baseline' : 'vs Last Month'}
                      </span>
                  </div>
                  <div className="mt-4 text-[10px] text-gray-400 font-bold border-t border-white/10 pt-2">
                      Basis: {metrics.currentMonthName} • {selectedCountry === 'all' ? 'All countries' : selectedCountry} • {formatFxSourceLabel(fxStatus, fxSourceText)}
                  </div>
              </button>

              {/* Active Franchises Card */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border relative group">
                  <div className="flex justify-between items-start">
                      <h3 className="text-sm font-bold text-gray-500">Stores in View</h3>
                      <div className="group/tooltip relative">
                          <Info className="w-4 h-4 text-gray-300 hover:text-gray-600 cursor-help"/>
                          <div className="absolute right-0 top-6 w-48 bg-black text-white text-xs p-2 rounded shadow-lg opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-50">
                              Count of currently operating stores registered in the HQ database.
                          </div>
                      </div>
                  </div>
                  <div className="text-3xl font-extrabold mt-2 text-gray-900">{metrics.activeStores}</div>
                  <div className="mt-8 text-[10px] text-gray-400 font-bold border-t border-gray-100 pt-2">
                      Basis: {selectedCountry === 'all' ? 'All countries' : selectedCountry}
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
                      Basis: Est. for {metrics.currentMonthName} • {formatFxSourceLabel(fxStatus, fxSourceText)}
                  </div>
              </div>

               {/* Inventory Card */}
               <div className="bg-white p-6 rounded-2xl shadow-sm border">
                  <div className="flex justify-between items-start">
                      <h3 className="text-sm font-bold text-gray-500">PB Stock Setup Gaps</h3>
                      <div className="group/tooltip relative">
                          <Info className="w-4 h-4 text-gray-300 hover:text-gray-600 cursor-help"/>
                          <div className="absolute right-0 top-6 w-48 bg-black text-white text-xs p-2 rounded shadow-lg opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-50">
                              Standard PB ingredients without both a stock level and reorder point. This is separate from monthly profitability readiness.
                          </div>
                      </div>
                  </div>
                  <div className={`text-3xl font-extrabold mt-2 ${metrics.inventorySetupGaps > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {metrics.inventorySetupGaps}
                  </div>
                  <div className="mt-8 text-[10px] text-gray-400 font-bold border-t border-gray-100 pt-2">
                      Basis: Required setup fields only
                  </div>
              </div>
           </div>
             </div>
           </details>

           <HQProfitabilityAnalysis
             stores={filteredStores}
             monthKey={selectedMonthKey}
             monthLabel={formatMonthKeyLabel(selectedMonthKey)}
             fxLabel={formatFxSourceLabel(fxStatus, fxSourceText)}
             preview={isLocalHqPreviewMode()}
             previewSales={sales}
             convertToJpy={convertHqAmountToJpy}
             onOpenStore={(store, section) => openHqStore(store, section, selectedMonthKey)}
           />

           <details className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
             <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 p-5 [&::-webkit-details-marker]:hidden">
               <div>
                 <div className="font-extrabold">Sales reporting detail & Excel</div>
                 <div className="mt-1 text-xs text-gray-500">Open the store-by-store local currency, JPY and royalty table when needed.</div>
               </div>
               <ChevronRight className="h-5 w-5 shrink-0 text-gray-400 transition group-open:rotate-90" />
             </summary>
             <div className="border-t border-gray-100">
               <FinancialsTable
                 stores={filteredStores}
                 sales={sales}
                 fxRates={fxRates}
                 fxStatus={fxStatus}
                 fxSourceText={fxSourceText}
                 monthKey={selectedMonthKey}
                 onExportExcel={handleExportSalesProgress}
               />
             </div>
           </details>

           {/* Store Grid (Clickable) */}
           <div className="hidden">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-4">
                  <div>
                      <div className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Next: choose a store</div>
                      <h3 className="font-bold text-xl mt-1">
                          {selectedCountry === 'all' ? 'All Stores' : `${selectedCountry} Stores`}
                      </h3>
                  </div>
                  <div className="text-sm text-gray-500">{formatMonthKeyLabel(selectedMonthKey)}</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {filteredStores.map(store => {
                      const monthSales = dedupeSalesByStoreDate(sales)
                          .filter((sale) => sale.storeId === store.id && extractMonthKey(sale.date) === selectedMonthKey);
                      const localSales = monthSales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0);
                      const salesJPY = convertToJPY(localSales, store.currency, fxRates);
                      const reportStatus = getStoreMonthReportStatus(sales, store.id, selectedMonthKey);
                      return (
                      <button
                        type="button"
                        key={store.id}
                        onClick={() => openHqStore(store)}
                        className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 hover:border-black cursor-pointer transition group text-left"
                      >
                          <div className="flex justify-between items-start mb-2">
                             <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-600 group-hover:bg-black group-hover:text-white transition-colors">
                                {store.country.substring(0, 2).toUpperCase()}
                             </div>
                             {reportStatus.missingDates.length > 0 ? (
                                 <span className="whitespace-nowrap rounded-full bg-red-100 px-2 py-1 text-[10px] font-black text-red-700">
                                     {reportStatus.missingDates.length} report days missing
                                 </span>
                             ) : (
                                 <span className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-700">
                                     Reports complete
                                 </span>
                             )}
                          </div>
                          <h4 className="font-bold text-lg">{store.name}</h4>
                          <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
                             <MapPin className="w-3 h-3" /> {store.city}, {store.country}
                          </div>
                          <div className="mt-4 rounded-xl bg-gray-50 px-3 py-2">
                              <div className="text-xs text-gray-500">{formatMonthKeyLabel(selectedMonthKey)} sales</div>
                              <div className="font-extrabold mt-0.5">{store.currency} {Math.round(localSales).toLocaleString()}</div>
                              {store.currency !== 'JPY' && (
                                  <div className="text-xs text-gray-500 mt-0.5">
                                      {salesJPY === null ? 'JPY rate unavailable' : `JPY ${Math.round(salesJPY).toLocaleString()}`}
                                  </div>
                              )}
                          </div>
                          <div className="mt-4 pt-4 border-t flex justify-between items-center text-sm font-medium">
                              <span>Open monthly detail</span>
                              <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-black" />
                          </div>
                      </button>
                      );
                  })}
              </div>
           </div>

           <details className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
             <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 p-5 [&::-webkit-details-marker]:hidden">
               <div>
                 <div className="font-extrabold">Supply chain setup</div>
                 <div className="mt-1 text-xs text-gray-500">Open PB item stock coverage and setup gaps.</div>
               </div>
               <ChevronRight className="h-5 w-5 shrink-0 text-gray-400 transition group-open:rotate-90" />
             </summary>
             <div className="border-t border-gray-100">
               <SupplyChainIntelligence stores={reportingStores} sales={sales} menus={menus} storeStocks={storeStocks} />
             </div>
           </details>

           <details className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
               <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
                 <div className="min-w-0">
                   <div className="font-extrabold">Data management</div>
                   <div className="mt-1 text-xs text-gray-500">
                     {`Test ${testStoreSummaries.length} · Held ${quarantinedStores.length} · Approval waiting ${pendingOwnerCount}`}
                   </div>
                 </div>
                 <ChevronRight className="h-5 w-5 shrink-0 text-gray-400 transition group-open:rotate-90" />
               </summary>
               <div className="space-y-5 border-t border-gray-100 bg-gray-50 p-5">
                 {testStoreSummaries.length > 0 && (
                   <section>
                     <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                       <div>
                         <div className="text-xs font-black uppercase tracking-[0.14em] text-amber-700">Test workspaces</div>
                         <div className="mt-1 text-xs text-gray-500">Excluded from operating results.</div>
                       </div>
                       <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">{testStoreSummaries.length}</span>
                     </div>
                     <div className="grid gap-3 lg:grid-cols-2">
                       {testStoreSummaries.map((summary) => (
                         <div key={summary.store.id} className="rounded-xl border border-amber-200 bg-white p-4">
                           <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                             <div>
                               <div className="font-extrabold">{summary.store.name}</div>
                               <div className="mt-1 text-xs text-gray-500">
                                 {formatMonthKeyLabel(summary.monthKey)} · {summary.salesDays} reports · {summary.menuCount} menus · {summary.courseCount} course
                               </div>
                               <div className="mt-2 font-extrabold">{summary.store.currency} {Math.round(summary.salesTotal).toLocaleString()}</div>
                             </div>
                             <div className="flex flex-col gap-2 sm:items-end">
                               <button
                                 type="button"
                                 onClick={() => openHqStore(summary.store, 'inventory', summary.monthKey)}
                                 className="min-h-11 rounded-xl bg-black px-4 py-2.5 text-sm font-extrabold text-white hover:bg-gray-800"
                               >
                                 Open test cost analysis
                               </button>
                               <button
                                 type="button"
                                 onClick={() => void removeMaintenanceStore(summary.store)}
                                 disabled={maintenanceDeleteBusy === summary.store.id}
                                 className="min-h-11 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-extrabold text-red-700 hover:bg-red-50 disabled:opacity-50"
                               >
                                 {maintenanceDeleteBusy === summary.store.id ? 'Removing…' : 'Archive and remove'}
                               </button>
                             </div>
                           </div>
                         </div>
                       ))}
                     </div>
                   </section>
                 )}

                 {quarantinedStores.length > 0 && (
                   <section>
                     <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                       <div>
                         <div className="text-xs font-black uppercase tracking-[0.14em] text-red-700">Held records</div>
                         <div className="mt-1 text-xs text-gray-500">Preserved for review but excluded from HQ totals.</div>
                       </div>
                       <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-black text-red-800">{quarantinedStores.length}</span>
                     </div>
                     <div className="grid gap-3 lg:grid-cols-2">
                       {quarantinedStores.map((store) => (
                         <div key={store.id} className="rounded-xl border border-red-200 bg-white p-4">
                           <div className="font-extrabold">{store.name}</div>
                           <div className="mt-1 text-xs text-gray-500">{store.city}, {store.country} · {store.currency}</div>
                           <div className="mt-2 text-sm text-red-800">{store.dataQualityNote ?? 'HQ review required.'}</div>
                           <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                             <button
                               type="button"
                               onClick={() => openHqStore(store)}
                               className="min-h-11 rounded-xl bg-black px-4 py-2.5 text-sm font-extrabold text-white"
                             >
                               Open record
                             </button>
                             <button
                               type="button"
                               onClick={() => void removeMaintenanceStore(store)}
                               disabled={maintenanceDeleteBusy === store.id}
                               className="min-h-11 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-extrabold text-red-700 hover:bg-red-50 disabled:opacity-50"
                             >
                               {maintenanceDeleteBusy === store.id ? 'Removing…' : 'Archive and remove'}
                             </button>
                           </div>
                         </div>
                       ))}
                     </div>
                   </section>
                 )}

                 <section>
                   <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                     <div>
                       <div className="text-xs font-black uppercase tracking-[0.14em] text-blue-700">Owner account connections</div>
                       <div className="mt-1 text-xs text-gray-500">
                         Connect, move, or unlink an owner account here. Unlinking never deletes the account or its data.
                       </div>
                     </div>
                     <input
                       type="search"
                       value={ownerAccountSearch}
                       onChange={(event) => setOwnerAccountSearch(event.target.value)}
                       placeholder="Search name, email, or store"
                       className="min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm sm:max-w-xs"
                     />
                   </div>
                   <div className="space-y-3">
                     {visibleOwnerAccountAssignments.map(account => {
                       const currentTarget = account.storeId ?? UNLINKED_STORE_TARGET;
                       const selectedTarget = ownerAccountTargets[account.email] ?? currentTarget;
                       const hasChange = selectedTarget !== currentTarget;
                       return (
                         <div key={account.userId} className="rounded-xl border border-blue-200 bg-white p-4">
                           <div className="flex flex-wrap items-start justify-between gap-2">
                             <div className="min-w-0">
                               <div className="font-extrabold">{account.name || 'Owner account'}</div>
                               <div className="mt-1 break-all text-sm text-gray-600">{account.email}</div>
                             </div>
                             <span className={`rounded-full px-2.5 py-1 text-xs font-black ${
                               account.storeId
                                 ? account.reportingStatus === 'test'
                                   ? 'bg-amber-100 text-amber-800'
                                   : 'bg-emerald-100 text-emerald-800'
                                 : 'bg-blue-100 text-blue-800'
                             }`}>
                               {account.storeId ? account.storeName ?? account.storeId : 'Approval waiting'}
                             </span>
                           </div>
                           <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                             <select
                               value={selectedTarget}
                               onChange={(event) => setOwnerAccountTargets(prev => ({ ...prev, [account.email]: event.target.value }))}
                               className="min-h-11 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold"
                               aria-label={`Store connection for ${account.email}`}
                             >
                               <option value={UNLINKED_STORE_TARGET}>Unlinked / approval waiting</option>
                               <optgroup label="Test workspaces">
                                 {testStores.map(store => (
                                   <option key={store.id} value={store.id}>{store.name} · TEST</option>
                                 ))}
                               </optgroup>
                               <optgroup label="Operating stores">
                                 {reportingStores.map(store => (
                                   <option key={store.id} value={store.id}>{store.name} · {store.city}, {store.country}</option>
                                 ))}
                               </optgroup>
                             </select>
                             <button
                               type="button"
                               onClick={() => void applyOwnerAccountAssignment(account)}
                               disabled={ownerAccountBusy === account.email || !hasChange}
                               className="min-h-11 rounded-xl bg-black px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-40"
                             >
                               {ownerAccountBusy === account.email ? 'Applying…' : 'Apply connection'}
                             </button>
                           </div>
                         </div>
                       );
                     })}
                     {ownerAccountAssignments.length === 0 && !ownerAccountError && (
                       <div className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">No owner accounts found.</div>
                     )}
                     {ownerAccountAssignments.length > 0 && visibleOwnerAccountAssignments.length === 0 && (
                       <div className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">No matching owner accounts.</div>
                     )}
                     {ownerAccountSuccess && <div className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">Updated: {ownerAccountSuccess}</div>}
                     {ownerAccountError && <div className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{ownerAccountError}</div>}
                   </div>
                 </section>
                 {maintenanceDeleteError && (
                   <div className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{maintenanceDeleteError}</div>
                 )}
               </div>
             </details>
       </div>
    </div>
    </HQLanguageBoundary>
  );
};

const StoreDashboard: React.FC<{
  user: User;
  store: Store;
  onLogout: () => void;
  sales: Sale[];
  menus: Menu[];
  setMenus: SetMenu[];
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
  onUpdateSetMenu: (setMenu: SetMenu) => void;
  onCreateSetMenu: (setMenu: SetMenu) => void;
  onDeleteSetMenu: (id: string) => void;
  onUpdateEmployees: (employees: Employee[]) => void;
  onAddIngredient: (ing: Ingredient) => Promise<void> | void;
}> = ({ user, store, onLogout, sales, menus, setMenus, employees, ingredients, globalConfig, onAddSale, onUpdateMenu, onCreateMenu, onDeleteMenu, onUpdateSetMenu, onCreateSetMenu, onDeleteSetMenu, onUpdateEmployees, onAddIngredient }) => {
    const [view, setView] = useState<'dashboard' | 'report' | 'month' | 'menu' | 'staff'>('dashboard');
    const [menuSection, setMenuSection] = useState<'items' | 'sets'>('items');
    const [ownerCostSection, setOwnerCostSection] = useState<'cost' | 'recipes'>('cost');
    const [reportDate, setReportDate] = useState<string | null>(null);
    const [editingMenu, setEditingMenu] = useState<Menu | null>(null);
    const [editingSetMenu, setEditingSetMenu] = useState<SetMenu | null>(null);
    const navReadyRef = useRef(false);
    const navRestoreRef = useRef(false);
    const popLockRef = useRef(false);
    const mainContentRef = useRef<HTMLDivElement>(null);
    const ownerViewStorageKey = `${OWNER_VIEW_STORAGE_PREFIX}${store.id}`;
    const ownerLanguageStorageKey = `${OWNER_LANGUAGE_STORAGE_PREFIX}${store.id}`;
    const [ownerLocale, setOwnerLocale] = useState<OwnerLocale>(() => {
        if (typeof window === 'undefined') return defaultOwnerLocaleForCountry(store.country);
        const saved = window.localStorage.getItem(`${OWNER_LANGUAGE_STORAGE_PREFIX}${store.id}`);
        return saved === 'en' || saved === 'ja' || saved === 'zh-CN' || saved === 'zh-TW' || saved === 'vi' || saved === 'ko'
            ? saved
            : defaultOwnerLocaleForCountry(store.country);
    });
    const storeMenus = menus.filter(m => m.storeId === store.id);
    const storeSetMenus = setMenus.filter(sm => sm.storeId === store.id);
    const storeEmployees = employees.filter(e => e.storeId === store.id);
    const storeSales = sales.filter(s => s.storeId === store.id);
    const canonicalStoreSales = useMemo(
        () => dedupeSalesByStoreDate(storeSales),
        [storeSales]
    );
    const dashboardMetricsEnabled = view === 'dashboard';
    const dashboardMonthKey = formatMonthKey(new Date());
    const sortedStoreSales = useMemo(
        () => [...canonicalStoreSales].sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id))),
        [canonicalStoreSales]
    );
    const recentMonthOptions = useMemo(() => {
        const keys = new Set<string>();
        sortedStoreSales.forEach((sale) => {
            const key = extractMonthKey(sale.date);
            if (key) keys.add(key);
        });
        return Array.from(keys).sort((a, b) => b.localeCompare(a));
    }, [sortedStoreSales]);
    const recentMonthSelectOptions = useMemo(() => {
        const keys = new Set<string>(recentMonthOptions);
        keys.add(dashboardMonthKey);
        return Array.from(keys).sort((a, b) => b.localeCompare(a));
    }, [recentMonthOptions, dashboardMonthKey]);
    const [recentReportMonth, setRecentReportMonth] = useState<string>(dashboardMonthKey);
    const recentMonthlyReports = useMemo(() => {
        if (!dashboardMetricsEnabled) return [];
        return sortedStoreSales.filter((sale) => extractMonthKey(sale.date) === recentReportMonth);
    }, [sortedStoreSales, recentReportMonth, dashboardMetricsEnabled]);
    useEffect(() => {
        setRecentReportMonth(dashboardMonthKey);
    }, [store.id, dashboardMonthKey]);

    useEffect(() => {
        setMenuSection('items');
    }, [store.id]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const saved = window.localStorage.getItem(ownerLanguageStorageKey);
        setOwnerLocale(
            saved === 'en' || saved === 'ja' || saved === 'zh-CN' || saved === 'zh-TW' || saved === 'vi' || saved === 'ko'
                ? saved
                : defaultOwnerLocaleForCountry(store.country),
        );
    }, [ownerLanguageStorageKey, store.country]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(ownerLanguageStorageKey, ownerLocale);
    }, [ownerLanguageStorageKey, ownerLocale]);

    useEffect(() => {
        mainContentRef.current?.scrollTo({ top: 0, behavior: 'auto' });
        if (typeof window !== 'undefined') {
            window.scrollTo({ top: 0, behavior: 'auto' });
        }
    }, [store.id, view]);
    const missingDates = useMemo(() => getMissingDates(sales, store.id, 7), [sales, store.id]);
    const missingDatesAll = useMemo(() => getMissingDates(sales, store.id, 120), [sales, store.id]);
    const missingDateSet = useMemo(() => new Set(missingDatesAll), [missingDatesAll]);
    const submittedDateSet = useMemo(() => new Set(canonicalStoreSales.map(s => s.date)), [canonicalStoreSales]);
    const performance = useMemo(() => {
        const lookbackDays = 7;
        const today = new Date();
        const recentDates: string[] = [];
        for (let i = 0; i < lookbackDays; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            recentDates.push(formatDate(d));
        }

        const submittedRecent = recentDates.filter((d) => submittedDateSet.has(d)).length;
        const reportScore = Math.round((submittedRecent / lookbackDays) * 70);
        const menuScore = storeMenus.length > 0 ? 15 : 0;
        const staffScore = storeEmployees.length > 0 ? 15 : 0;
        const score = Math.max(0, Math.min(100, reportScore + menuScore + staffScore));

        return {
            score,
            submittedRecent,
            lookbackDays,
            hasMenu: storeMenus.length > 0,
            hasStaff: storeEmployees.length > 0,
        };
    }, [submittedDateSet, storeMenus.length, storeEmployees.length]);
    const todayDate = formatDate(new Date());
    const todayReport = canonicalStoreSales.find((sale) => sale.date === todayDate) ?? null;
    const currentMonthReportStatus = useMemo(
        () => getStoreMonthReportStatus(sales, store.id, dashboardMonthKey),
        [sales, store.id, dashboardMonthKey],
    );
    const currentMonthSales = useMemo(
        () => canonicalStoreSales
            .filter((sale) => extractMonthKey(sale.date) === dashboardMonthKey)
            .reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0),
        [canonicalStoreSales, dashboardMonthKey],
    );
    const recipeReadyCount = storeMenus.filter((menu) => (menu.recipe?.length ?? 0) > 0).length;
    const menusMissingRecipes = storeMenus.filter((menu) => (menu.recipe?.length ?? 0) === 0);
    const menuIds = new Set(storeMenus.map((menu) => menu.id));
    const setsNeedingAttention = storeSetMenus.filter(
        (setMenu) => setMenu.items.length === 0 || setMenu.items.some((item) => !menuIds.has(item.menuId) || Number(item.quantity) <= 0),
    );
    const [showMissingCalendar, setShowMissingCalendar] = useState(false);
    const [calendarMonth, setCalendarMonth] = useState(() => {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), 1);
    });

    // Chart Data Preparation (deferred when dashboard is not visible)
    const salesData = useMemo(() => {
        if (!dashboardMetricsEnabled) return [];
        const totalsByDate = new Map<string, number>();
        canonicalStoreSales.forEach((sale) => {
            totalsByDate.set(sale.date, (totalsByDate.get(sale.date) ?? 0) + (sale.totalAmount || 0));
        });

        const data = [];
        const today = new Date();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const dateStr = formatDate(d);
            data.push({
                name: dateStr.slice(5),
                sales: totalsByDate.get(dateStr) ?? 0,
            });
        }
        return data;
    }, [canonicalStoreSales, dashboardMetricsEnabled]);

    const categoryMonthlyData = useMemo(() => {
        if (!dashboardMetricsEnabled) return [];
        const today = new Date();
        const currentMonthKey = formatMonthKey(today);
        const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const prevMonthKey = formatMonthKey(prevMonthDate);

        const currentCounts: Record<string, number> = {};
        const prevCounts: Record<string, number> = {};
        globalConfig.categories.forEach(c => {
            currentCounts[c] = 0;
            prevCounts[c] = 0;
        });

        canonicalStoreSales.forEach(sale => {
            const monthKey = extractMonthKey(sale.date);
            let target: Record<string, number> | null = null;
            if (monthKey === currentMonthKey) {
                target = currentCounts;
            } else if (monthKey === prevMonthKey) {
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
    }, [canonicalStoreSales, globalConfig.categories, dashboardMetricsEnabled]);

    // Comparison Logic (Current Month vs Previous Month)
    const metricComparison = useMemo(() => {
        if (!dashboardMetricsEnabled) {
            return { currentMonthSales: 0, growth: null as number | null, weeklyGrowth: null as number | null };
        }
        const today = new Date();
        const currentMonthKey = formatMonthKey(today);
        const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const prevMonthKey = formatMonthKey(prevMonthDate);

        const currentMonthSales = canonicalStoreSales
            .filter(s => extractMonthKey(s.date) === currentMonthKey)
            .reduce((acc, curr) => acc + curr.totalAmount, 0);

        const prevMonthSales = canonicalStoreSales
            .filter(s => extractMonthKey(s.date) === prevMonthKey)
            .reduce((acc, curr) => acc + curr.totalAmount, 0);

        const growth: number | null = prevMonthSales > 0
            ? ((currentMonthSales - prevMonthSales) / prevMonthSales) * 100
            : null;

        const currentWeekStart = new Date(today);
        currentWeekStart.setDate(today.getDate() - 6);
        const previousWeekStart = new Date(today);
        previousWeekStart.setDate(today.getDate() - 13);
        const previousWeekEnd = new Date(today);
        previousWeekEnd.setDate(today.getDate() - 7);
        const currentWeekStartKey = formatDate(currentWeekStart);
        const previousWeekStartKey = formatDate(previousWeekStart);
        const previousWeekEndKey = formatDate(previousWeekEnd);
        const currentWeekSales = canonicalStoreSales
            .filter((sale) => sale.date >= currentWeekStartKey && sale.date <= formatDate(today))
            .reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0);
        const previousWeekSales = canonicalStoreSales
            .filter((sale) => sale.date >= previousWeekStartKey && sale.date <= previousWeekEndKey)
            .reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0);
        const weeklyGrowth: number | null = previousWeekSales > 0
            ? ((currentWeekSales - previousWeekSales) / previousWeekSales) * 100
            : null;

        return { currentMonthSales, growth, weeklyGrowth };
    }, [canonicalStoreSales, dashboardMetricsEnabled]);

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

    const pushOwnerLayer = useCallback((
        layer: 'menu-editor' | 'set-menu-editor' | 'missing-calendar',
        entityId?: string
    ) => {
        if (typeof window === 'undefined') return;
        window.history.pushState(
            {
                screen: 'owner',
                view,
                reportDate,
                menuSection,
                layer,
                entityId: entityId ?? null,
            },
            ''
        );
    }, [view, reportDate, menuSection]);

    const openOwnerMenuEditor = useCallback((menu: Menu) => {
        setEditingMenu(menu);
        setEditingSetMenu(null);
        pushOwnerLayer('menu-editor', menu.id);
    }, [pushOwnerLayer]);

    const openOwnerSetMenuEditor = useCallback((setMenu: SetMenu) => {
        setEditingSetMenu(setMenu);
        setEditingMenu(null);
        pushOwnerLayer('set-menu-editor', setMenu.id);
    }, [pushOwnerLayer]);

    const openOwnerMissingCalendar = useCallback(() => {
        setCalendarMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
        setShowMissingCalendar(true);
        pushOwnerLayer('missing-calendar');
    }, [pushOwnerLayer]);

    const closeOwnerLayer = useCallback((
        layer: 'menu-editor' | 'set-menu-editor' | 'missing-calendar',
        fallback: () => void
    ) => {
        if (typeof window !== 'undefined') {
            const state = window.history.state as { screen?: string; layer?: string } | null;
            if (state?.screen === 'owner' && state.layer === layer) {
                window.history.back();
                return;
            }
        }
        fallback();
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined' || navRestoreRef.current) return;
        const url = new URL(window.location.href);
        const urlView = url.searchParams.get('ov');
        const urlReportDate = url.searchParams.get('od');
        const urlMenuSection = url.searchParams.get('om');
        const historyState = window.history.state as {
            screen?: string;
            view?: string;
            reportDate?: string | null;
            menuSection?: string;
            layer?: string;
            entityId?: string | null;
        } | null;
        const fromHistory = historyState?.screen === 'owner'
            ? {
                view: (historyState.view as 'dashboard' | 'report' | 'month' | 'menu' | 'staff' | undefined) ?? 'dashboard',
                reportDate: (historyState.reportDate as string | null | undefined) ?? null,
                menuSection: (historyState.menuSection as 'items' | 'sets' | undefined) ?? 'items',
            }
            : null;
        const fromStorage = safeParseJson<{ view?: 'dashboard' | 'report' | 'month' | 'menu' | 'staff'; reportDate?: string | null; menuSection?: 'items' | 'sets' }>(
            window.localStorage.getItem(ownerViewStorageKey)
        );

        const normalizedUrlView = urlView === 'dashboard' || urlView === 'report' || urlView === 'month' || urlView === 'menu' || urlView === 'staff'
            ? urlView
            : null;
        const normalizedUrlMenuSection = urlMenuSection === 'sets' ? 'sets' : (urlMenuSection === 'items' ? 'items' : null);

        const restoredView = normalizedUrlView ?? fromHistory?.view ?? fromStorage?.view ?? 'dashboard';
        const restoredReportDate = urlReportDate ?? fromHistory?.reportDate ?? fromStorage?.reportDate ?? null;
        const restoredMenuSection = normalizedUrlMenuSection ?? fromHistory?.menuSection ?? fromStorage?.menuSection ?? 'items';

        setView(restoredView);
        setReportDate(restoredReportDate);
        setMenuSection(restoredMenuSection);
        const restoredLayer = fromHistory ? historyState?.layer ?? null : null;
        setShowMissingCalendar(restoredLayer === 'missing-calendar');
        setEditingMenu(
            restoredLayer === 'menu-editor'
                ? storeMenus.find(menu => menu.id === historyState?.entityId) ?? null
                : null
        );
        setEditingSetMenu(
            restoredLayer === 'set-menu-editor'
                ? storeSetMenus.find(setMenu => setMenu.id === historyState?.entityId) ?? null
                : null
        );
        window.history.replaceState(
            {
                screen: 'owner',
                view: restoredView,
                reportDate: restoredReportDate,
                menuSection: restoredMenuSection,
                layer: restoredLayer,
                entityId: historyState?.entityId ?? null,
            },
            ''
        );
        navReadyRef.current = true;
        navRestoreRef.current = true;
    }, [ownerViewStorageKey, storeMenus, storeSetMenus]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(ownerViewStorageKey, JSON.stringify({ view, reportDate, menuSection }));
    }, [ownerViewStorageKey, view, reportDate, menuSection]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!navReadyRef.current) return;
        if (popLockRef.current) {
            popLockRef.current = false;
            return;
        }
        window.history.pushState({ screen: 'owner', view, reportDate, menuSection, layer: null, entityId: null }, '');
    }, [view, reportDate, menuSection]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const url = new URL(window.location.href);
        url.searchParams.set('ov', view);
        if (reportDate) {
            url.searchParams.set('od', reportDate);
        } else {
            url.searchParams.delete('od');
        }
        if (view === 'menu') {
            url.searchParams.set('om', menuSection);
        } else {
            url.searchParams.delete('om');
        }
        window.history.replaceState(
            { ...(window.history.state ?? {}), screen: 'owner', view, reportDate, menuSection },
            '',
            `${url.pathname}${url.search}${url.hash}`
        );
    }, [view, reportDate, menuSection]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onPopState = (e: PopStateEvent) => {
            const state = e.state as {
                screen?: string;
                view?: 'dashboard' | 'report' | 'month' | 'menu' | 'staff';
                reportDate?: string | null;
                menuSection?: 'items' | 'sets';
                layer?: string;
                entityId?: string | null;
            } | null;
            if (!state || state.screen !== 'owner') {
                return;
            }
            popLockRef.current = true;
            setReportDate(state.reportDate ?? null);
            setView(state.view ?? 'dashboard');
            setMenuSection(state.menuSection === 'sets' ? 'sets' : 'items');
            setShowMissingCalendar(state.layer === 'missing-calendar');
            setEditingMenu(
                state.layer === 'menu-editor'
                    ? storeMenus.find(menu => menu.id === state.entityId) ?? null
                    : null
            );
            setEditingSetMenu(
                state.layer === 'set-menu-editor'
                    ? storeSetMenus.find(setMenu => setMenu.id === state.entityId) ?? null
                    : null
            );
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [storeMenus, storeSetMenus]);

    return (
      <OwnerLanguageBoundary locale={ownerLocale}>
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
                        closeOwnerLayer('menu-editor', () => setEditingMenu(null));
                    }}
                    onBack={() => closeOwnerLayer('menu-editor', () => setEditingMenu(null))}
                />
            )}
            {editingSetMenu && (
                <SetMenuEditor
                    setMenu={editingSetMenu}
                    menus={storeMenus}
                    onSave={async (nextSetMenu) => {
                        await Promise.resolve(onUpdateSetMenu(nextSetMenu));
                        closeOwnerLayer('set-menu-editor', () => setEditingSetMenu(null));
                    }}
                    onBack={() => closeOwnerLayer('set-menu-editor', () => setEditingSetMenu(null))}
                />
            )}

            {showMissingCalendar && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
                        <div className="flex items-center justify-between px-6 pt-5">
                            <div className="font-extrabold text-lg">Missing Reports Calendar</div>
                            <button
                                type="button"
                                onClick={() => closeOwnerLayer('missing-calendar', () => setShowMissingCalendar(false))}
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
                <div className="flex min-w-0 items-center gap-3 sm:gap-4" data-owner-i18n-skip="true">
                    <div className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center font-bold text-lg shadow-lg shadow-indigo-200">
                        {store.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                        <h1 className="text-xl font-extrabold tracking-tight text-gray-900">{store.name}</h1>
                        <div className="text-xs text-gray-500 font-medium">{store.city}, {store.country}</div>
                    </div>
                </div>
                <div className="flex items-center gap-2 sm:gap-4">
                    <OwnerLanguageSwitch locale={ownerLocale} onChange={setOwnerLocale} />
                     <div className="text-right hidden md:block">
                        <div className="font-bold text-sm" data-owner-i18n-skip="true">{user.name}</div>
                        <div className="text-xs text-gray-500">Store Manager</div>
                     </div>
                    <button aria-label="Sign out" onClick={onLogout} className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-gray-100"><LogOut className="w-5 h-5 text-gray-600" /></button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <div className="hidden w-64 flex-col border-r bg-white p-4 xl:flex">
                    <button
                        type="button"
                        onClick={() => setView('dashboard')}
                        className={`mb-5 flex items-center gap-3 rounded-xl px-4 py-3 text-left transition ${
                            view === 'dashboard'
                                ? 'bg-gray-100 text-black'
                                : 'text-gray-500 hover:bg-gray-50 hover:text-black'
                        }`}
                    >
                        <LayoutDashboard className="w-5 h-5" />
                        <span className="font-bold text-sm">Store Overview</span>
                    </button>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400 px-4 mb-2">Core tasks</div>
                    <div className="space-y-1">
                        <NavButton active={view === 'report'} onClick={() => { setReportDate(todayDate); setView('report'); }} icon={FileText} label="Today's Sales Report" />
                        <NavButton active={view === 'month'} onClick={() => setView('month')} icon={ClipboardList} label="Month Close" />
                        <NavButton active={view === 'menu'} onClick={() => setView('menu')} icon={Package} label="Cost & Inventory" />
                        <NavButton active={view === 'staff'} onClick={() => setView('staff')} icon={Users} label="Staff & Labor" />
                    </div>
                    <div className="mt-auto p-4 bg-gray-50 rounded-xl">
                        <div className="text-xs font-bold text-gray-500 mb-2 uppercase">Your Performance</div>
                        <div className="text-2xl font-extrabold text-gray-900">{performance.score}%</div>
                        <div className="text-xs text-gray-500 mt-1">Operational Score (Auto)</div>
                        <div className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                            Reports {performance.submittedRecent}/{performance.lookbackDays} days
                            {' · '}
                            Menu {performance.hasMenu ? 'OK' : 'Missing'}
                            {' · '}
                            Staff {performance.hasStaff ? 'OK' : 'Missing'}
                        </div>
                    </div>
                </div>

                {/* Mobile Nav */}
                <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-around border-t bg-white px-1.5 py-1.5 xl:hidden">
                    {[
                        { key: 'dashboard', label: 'Home', aria: 'Store overview', icon: LayoutDashboard, action: () => setView('dashboard') },
                        { key: 'report', label: 'Sales', aria: "Today's sales report", icon: FileText, action: () => { setReportDate(todayDate); setView('report'); } },
                        { key: 'month', label: 'Month', aria: 'Month close', icon: ClipboardList, action: () => setView('month') },
                        { key: 'menu', label: 'Cost', aria: 'Cost and inventory', icon: Package, action: () => setView('menu') },
                        { key: 'staff', label: 'Staff', aria: 'Staff and labor', icon: Users, action: () => setView('staff') },
                    ].map((item) => {
                        const Icon = item.icon;
                        const active = view === item.key;
                        return (
                            <button
                                key={item.key}
                                type="button"
                                aria-label={item.aria}
                                onClick={item.action}
                                className={`flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 ${
                                    active ? 'bg-gray-100 text-black' : 'text-gray-400'
                                }`}
                            >
                                <Icon className="h-4 w-4" />
                                <span className="text-[9px] font-bold leading-none">{item.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Main Content */}
                <div ref={mainContentRef} className="min-w-0 flex-1 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24 xl:p-8 xl:pb-8">
                    {view === 'dashboard' && (
                        <div className="space-y-6">
                            <div>
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">What to do next</div>
                                <h2 className="text-2xl font-extrabold mt-1">Store Overview</h2>
                                <p className="text-sm text-gray-500 mt-1">Daily work and month-end work are separated below.</p>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <button
                                    type="button"
                                    onClick={() => { setReportDate(todayDate); setView('report'); }}
                                    className={`rounded-2xl border p-6 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
                                        todayReport ? 'bg-white border-emerald-200' : 'bg-red-50 border-red-200'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Daily task</div>
                                            <div className={`mt-3 inline-flex p-2 rounded-xl ${todayReport ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                                <FileText className="w-5 h-5" />
                                            </div>
                                        </div>
                                        <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${
                                            todayReport ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                                        }`}>
                                            {todayReport ? 'Submitted' : 'Do today'}
                                        </span>
                                    </div>
                                    <div className="font-extrabold mt-4">Today's Sales Report</div>
                                    <div className="text-xs text-gray-500 mt-1">{todayDate}</div>
                                    <div className="text-xs font-bold mt-4 flex items-center gap-1">
                                        {todayReport ? 'Review or edit report' : 'Enter sales and upload receipt'}
                                        <ChevronRight className="w-3 h-3" />
                                    </div>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setView('month')}
                                    className={`rounded-2xl border p-6 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
                                        currentMonthReportStatus.missingDates.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-emerald-200'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Month-end task</div>
                                            <div className="mt-3 inline-flex p-2 rounded-xl bg-amber-100 text-amber-700"><ClipboardList className="w-5 h-5" /></div>
                                        </div>
                                        <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${
                                            currentMonthReportStatus.missingDates.length > 0
                                                ? 'bg-amber-100 text-amber-700'
                                                : 'bg-emerald-100 text-emerald-700'
                                        }`}>
                                            {currentMonthReportStatus.missingDates.length > 0
                                                ? `${currentMonthReportStatus.missingDates.length} missing`
                                                : 'On track'}
                                        </span>
                                    </div>
                                    <div className="font-extrabold mt-4">Month Close</div>
                                    <div className="text-xs text-gray-500 mt-1">
                                        {currentMonthReportStatus.submitted}/{currentMonthReportStatus.expected} due reports complete
                                    </div>
                                    <div className="text-xs font-bold mt-4 flex items-center gap-1">Check monthly readiness <ChevronRight className="w-3 h-3" /></div>
                                </button>
                            </div>

                            <div>
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Setup & maintenance</div>
                                <p className="mt-1 text-sm text-gray-500">Open these only when ingredients, recipes or staff records need updating.</p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <button
                                    type="button"
                                    onClick={() => { setOwnerCostSection('cost'); setView('menu'); }}
                                    className={`rounded-2xl border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
                                        menusMissingRecipes.length > 0 || setsNeedingAttention.length > 0
                                            ? 'bg-amber-50 border-amber-200'
                                            : 'bg-white border-emerald-200'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="p-2 rounded-xl bg-indigo-100 text-indigo-700"><Package className="w-5 h-5" /></div>
                                        <span className="text-[10px] font-black uppercase px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                                            {recipeReadyCount}/{storeMenus.length} recipes
                                        </span>
                                    </div>
                                    <div className="font-extrabold mt-4">Cost & Inventory</div>
                                    <div className="text-xs text-gray-500 mt-1">{storeMenus.length} single items · {storeSetMenus.length} courses/sets</div>
                                    <div className="text-xs font-bold mt-4 flex items-center gap-1">Manage costs, inventory and recipes <ChevronRight className="w-3 h-3" /></div>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setView('staff')}
                                    className={`rounded-2xl border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
                                        storeEmployees.length > 0 ? 'bg-white border-emerald-200' : 'bg-amber-50 border-amber-200'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="p-2 rounded-xl bg-sky-100 text-sky-700"><Users className="w-5 h-5" /></div>
                                        <span className="text-[10px] font-black uppercase px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                                            {storeEmployees.length} staff
                                        </span>
                                    </div>
                                    <div className="font-extrabold mt-4">Staff & Labor</div>
                                    <div className="text-xs text-gray-500 mt-1">Keep the active staff list current.</div>
                                    <div className="text-xs font-bold mt-4 flex items-center gap-1">Open staff records <ChevronRight className="w-3 h-3" /></div>
                                </button>
                            </div>

                            {/* Missing Report Alert */}
                            {missingDates.length > 0 && (
                                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-xl flex items-start gap-3 shadow-sm">
                                    <div className="p-2 bg-white rounded-full text-red-500 shadow-sm">
                                        <CalendarX className="w-6 h-6"/>
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-red-800 text-lg">Missing Daily Sales Reports</h3>
                                        <p className="text-sm text-red-600 mb-2">Enter these dates to complete this month’s sales record.</p>
                                        <div className="flex flex-wrap gap-2">
                                          {missingDates.map(d => (
  <button
    key={d}
    type="button"
    onClick={() => { setReportDate(d); setView('report'); }}
    className="min-h-10 rounded-lg bg-red-200 px-3 py-2 text-xs font-bold text-red-800 transition hover:bg-red-300"
  >
    {d}
  </button>
))}

                                          <button
                                            type="button"
                                            onClick={openOwnerMissingCalendar}
                                            className="min-h-10 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-50"
                                          >
                                            View Older Dates
                                          </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="bg-white p-6 rounded-2xl shadow-sm border relative overflow-hidden group">
                                    <div className="text-sm font-bold text-gray-500 mb-1">Total Sales (Month)</div>
                                    <div className="text-3xl font-extrabold flex items-baseline gap-2">
                                        {store.currency} {metricComparison.currentMonthSales.toLocaleString()}
                                    </div>
                                    <div className={`flex items-center gap-1 text-xs font-bold mt-2 ${
                                        metricComparison.growth === null
                                            ? 'text-gray-400'
                                            : metricComparison.growth >= 0
                                                ? 'text-emerald-600'
                                                : 'text-red-500'
                                    }`}>
                                        {metricComparison.growth === null
                                            ? <Minus className="w-4 h-4"/>
                                            : metricComparison.growth >= 0
                                                ? <ArrowUpRight className="w-4 h-4"/>
                                                : <ArrowDownRight className="w-4 h-4"/>}
                                        {metricComparison.growth === null
                                            ? 'No prior-month baseline'
                                            : `${Math.abs(metricComparison.growth).toFixed(1)}% vs Last Month`}
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
                                         <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                                             metricComparison.weeklyGrowth === null
                                                 ? 'bg-gray-100 text-gray-500'
                                                 : metricComparison.weeklyGrowth >= 0
                                                     ? 'bg-emerald-100 text-emerald-700'
                                                     : 'bg-red-100 text-red-700'
                                         }`}>
                                             {metricComparison.weeklyGrowth === null
                                                 ? 'No prior-week baseline'
                                                 : `${metricComparison.weeklyGrowth >= 0 ? '+' : ''}${metricComparison.weeklyGrowth.toFixed(1)}% vs Last Week`}
                                         </span>
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
                                <div className="mb-4 flex items-center justify-between gap-3">
                                    <h3 className="font-bold text-lg">Recent Daily Reports</h3>
                                    <select
                                        value={recentReportMonth}
                                        onChange={(e) => setRecentReportMonth(e.target.value)}
                                        className="text-xs font-semibold border border-gray-200 rounded-lg px-2 py-1 bg-white"
                                    >
                                        {recentMonthSelectOptions.map((monthKey) => (
                                            <option key={monthKey} value={monthKey}>
                                                {formatMonthKeyLabel(monthKey)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    {recentMonthlyReports.map(sale => (
                                        <div key={sale.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                                            <div className="font-medium">{sale.date}</div>
                                            <div className="flex items-center gap-3">
                                                <div className="font-bold">{sale.isClosed ? 'Closed' : `${store.currency} ${formatMoneyDisplay(sale.totalAmount)}`}</div>
                                                <button
                                                    type="button"
                                                    onClick={() => { setReportDate(sale.date); setView('report'); }}
                                                    className="text-xs font-bold px-3 py-1 rounded-full border border-gray-200 hover:bg-white transition"
                                                >
                                                    Edit
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    {recentMonthlyReports.length === 0 && <div className="text-gray-400 text-sm">No reports in this month.</div>}
                                </div>
                             </div>
                        </div>
                    )}

                    {view === 'month' && (
                        <MonthlyCloseWorkspace
                            store={store}
                            sales={sales}
                            initialMonthKey={dashboardMonthKey}
                            mode="owner"
                            onOpenSalesReport={(date) => {
                                setReportDate(date);
                                setView('report');
                            }}
                            onOpenInventory={() => {
                                setOwnerCostSection('cost');
                                setView('menu');
                            }}
                        />
                    )}

                    {view === 'report' && (
                      <SalesReporter
  store={store}
  sales={sales}
  menus={storeMenus}
  setMenus={storeSetMenus}
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
                        <div className="space-y-6">
                            <div className="sticky top-2 z-20 grid grid-cols-2 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
                                <button
                                    type="button"
                                    aria-pressed={ownerCostSection === 'cost'}
                                    onClick={() => setOwnerCostSection('cost')}
                                    className={`rounded-xl px-4 py-3 text-sm font-extrabold transition ${
                                        ownerCostSection === 'cost' ? 'bg-black text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-black'
                                    }`}
                                >
                                    Cost, Purchases & Inventory
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={ownerCostSection === 'recipes'}
                                    onClick={() => setOwnerCostSection('recipes')}
                                    className={`rounded-xl px-4 py-3 text-sm font-extrabold transition ${
                                        ownerCostSection === 'recipes' ? 'bg-black text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-black'
                                    }`}
                                >
                                    Menus, Courses & Recipes
                                </button>
                            </div>

                            {ownerCostSection === 'cost' && (
                            <CostInventoryWorkspace
                                store={store}
                                ingredients={ingredients}
                                menus={storeMenus}
                                setMenus={storeSetMenus}
                                sales={canonicalStoreSales}
                                initialMonthKey={dashboardMonthKey}
                                mode="owner"
                                onAddIngredient={onAddIngredient}
                            />
                            )}

                            {ownerCostSection === 'recipes' && (
                            <div className="pt-2">
                            <div>
                                <div className="text-xs font-black tracking-[0.12em] text-gray-400">RECIPE SETUP</div>
                                <h2 className="text-2xl font-extrabold mt-1">Menus, Courses & Recipes</h2>
                                <p className="text-sm text-gray-500 mt-1">Register ingredient quantities for single items first, then build courses and sets.</p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                                    <div className="text-xs font-bold text-gray-500">SINGLE ITEMS</div>
                                    <div className="text-2xl font-extrabold mt-1">{storeMenus.length}</div>
                                    <div className="text-xs text-gray-500 mt-1">Individually sold menu items</div>
                                </div>
                                <div className={`rounded-2xl border p-4 ${
                                    menusMissingRecipes.length > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-white'
                                }`}>
                                    <div className="text-xs font-bold text-gray-500">RECIPES READY</div>
                                    <div className="text-2xl font-extrabold mt-1">{recipeReadyCount}/{storeMenus.length}</div>
                                    <div className="text-xs text-gray-500 mt-1">
                                        {menusMissingRecipes.length > 0 ? `${menusMissingRecipes.length} item(s) need ingredients` : 'All item recipes configured'}
                                    </div>
                                </div>
                                <div className={`rounded-2xl border p-4 ${
                                    setsNeedingAttention.length > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-white'
                                }`}>
                                    <div className="text-xs font-bold text-gray-500">COURSES & SETS</div>
                                    <div className="text-2xl font-extrabold mt-1">{storeSetMenus.length}</div>
                                    <div className="text-xs text-gray-500 mt-1">
                                        {setsNeedingAttention.length > 0 ? `${setsNeedingAttention.length} need components` : 'Components configured'}
                                    </div>
                                </div>
                            </div>

                            <div className="sticky top-2 z-10 bg-gray-50/95 backdrop-blur supports-[backdrop-filter]:bg-gray-50/80 py-1">
                                <div className="grid grid-cols-2 items-stretch rounded-2xl border border-gray-200 bg-white p-1">
                                    <button
                                        type="button"
                                        onClick={() => setMenuSection('items')}
                                        className={`px-3 py-3 rounded-xl text-sm font-bold transition ${
                                            menuSection === 'items' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100'
                                        }`}
                                    >
                                        Single Items & Recipes ({storeMenus.length})
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setMenuSection('sets')}
                                        className={`px-3 py-3 rounded-xl text-sm font-bold transition ${
                                            menuSection === 'sets' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100'
                                        }`}
                                    >
                                        Courses & Sets ({storeSetMenus.length})
                                    </button>
                                </div>
                            </div>

                            {menuSection === 'items' ? (
                                <MenuManager
                                    store={store}
                                    menus={storeMenus}
                                    onEdit={openOwnerMenuEditor}
                                    onCreate={openOwnerMenuEditor}
                                    onDelete={onDeleteMenu}
                                />
                            ) : (
                                <SetMenuManager
                                    store={store}
                                    menus={storeMenus}
                                    setMenus={storeSetMenus}
                                    onEdit={openOwnerSetMenuEditor}
                                    onCreate={openOwnerSetMenuEditor}
                                    onDelete={onDeleteSetMenu}
                                />
                            )}
                            </div>
                            )}
                        </div>
                    )}

                    {view === 'staff' && (
                        <div className="space-y-6">
                            <div>
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">People records</div>
                                <h2 className="text-2xl font-extrabold mt-1">Staff & Labor</h2>
                                <p className="text-sm text-gray-500 mt-1">
                                    Keep the active staff list current. Monthly payroll, total labor hours, and labor-cost ratio are managed in Month Close.
                                </p>
                            </div>
                            <EmployeeManager
                                store={store}
                                employees={storeEmployees}
                                positions={globalConfig.positions}
                                onUpdate={(emps) => onUpdateEmployees(emps)}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
      </OwnerLanguageBoundary>
    );
};

const LoginScreen: React.FC = () => {
    const [loginError, setLoginError] = useState<string | null>(null);
    const [loginInfo, setLoginInfo] = useState<string | null>(null);
    const [loginBusy, setLoginBusy] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
    const normalizedEmail = email.trim().toLowerCase();
    const isHqGoogleOnlyEmail = HQ_BOOTSTRAP_EMAILS.includes(normalizedEmail);
    const isEmbeddedBrowser = useMemo(() => {
        if (typeof navigator === 'undefined') return false;
        const ua = navigator.userAgent || '';
        const hasKnownInAppToken = /(Line|KAKAOTALK|FBAN|FBAV|Instagram|wv)/i.test(ua);
        const iOSWebView = /(iPhone|iPad|iPod)/i.test(ua) && /AppleWebKit/i.test(ua) && !/Safari/i.test(ua);
        return hasKnownInAppToken || iOSWebView;
    }, []);

    const toFriendlyAuthError = useCallback((message?: string, mode: 'signin' | 'signup' = 'signin') => {
        const raw = String(message ?? '').toLowerCase();
        if (raw.includes('invalid login credentials')) {
            return 'Email or password is incorrect. If you normally use Google, use Continue with Google.';
        }
        if (raw.includes('failed to fetch') || raw.includes('networkerror') || raw.includes('network request failed')) {
            return 'Cannot reach Supabase. Check VITE_SUPABASE_URL in .env.local, then restart the local server.';
        }
        if (raw.includes('signup') && (raw.includes('disabled') || raw.includes('not allowed'))) {
            return 'Email account creation is disabled in Supabase. Ask HQ admin to enable email sign-up or create this account manually.';
        }
        if (raw.includes('password') && (raw.includes('weak') || raw.includes('least') || raw.includes('characters'))) {
            return 'Password is too short or weak. Use at least 6 characters.';
        }
        if (raw.includes('invalid email')) {
            return 'Email format is invalid. For China stores, use an email-style ID such as store-name@chibo-cn.local.';
        }
        if (raw.includes('email not confirmed')) {
            return 'Email is not confirmed yet. Check your inbox or ask HQ admin.';
        }
        if (raw.includes('too many requests')) {
            return 'Too many attempts. Please wait a minute and try again.';
        }
        if (raw.includes('user already registered')) {
            return 'This email is already registered. Please sign in instead.';
        }
        if (raw.includes('database error') || raw.includes('unexpected')) {
            return mode === 'signup'
                ? 'Account creation failed because Supabase could not finish creating the user. Ask HQ admin to check Auth settings and database triggers.'
                : 'Sign-in failed because Supabase returned a database error. Please try again or ask HQ admin.';
        }
        return mode === 'signup' ? 'Account creation failed. Please check the email/password and try again.' : 'Sign-in failed. Please try again.';
    }, []);

    const toFriendlyOAuthError = useCallback((message?: string) => {
        const raw = String(message ?? '').toLowerCase();
        if (raw.includes('disallowed_useragent')) {
            return 'Google sign-in is blocked in this in-app browser. Open this page in Chrome or Safari.';
        }
        if (raw.includes('access_denied')) {
            return 'Google sign-in was canceled or denied.';
        }
        return 'Google sign-in failed. Please check OAuth settings and try again.';
    }, []);

    const CompanyLogo = () => (
        <div className="w-56 h-40 mb-6 flex items-center justify-center">
            <img
                src="/chibo-logo.png"
                alt="CHIBO logo"
                className="w-full h-full object-contain"
                loading="eager"
                decoding="async"
            />
        </div>
    );

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
            <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
                <div className="flex flex-col items-center text-center">
                    <CompanyLogo />
                    <h1 className="text-2xl font-extrabold text-gray-900 mb-2">CHIBO</h1>
                    <p className="text-gray-500 mb-6">Global Franchise Manager</p>

                    <div className="w-full text-left space-y-3">
                        {isEmbeddedBrowser && (
                            <div className="w-full rounded-xl border border-amber-200 bg-amber-50 p-3 text-left">
                                <div className="text-xs font-bold text-amber-900 mb-1">Unsupported in-app browser</div>
                                <div className="text-xs text-amber-800 leading-relaxed">
                                    Google login is blocked in embedded browsers (error 403: disallowed_useragent).
                                    Open this page in Safari/Chrome and sign in there.
                                </div>
                            </div>
                        )}

                        <button
                            onClick={async () => {
                                try {
                                    setLoginError(null);
                                    setLoginInfo(null);
                                    await signInWithGoogle();
                                } catch (e: any) {
                                    console.error('Login failed', e);
                                    setLoginError(toFriendlyOAuthError(e?.message));
                                }
                            }}
                            disabled={isEmbeddedBrowser}
                            className="w-full inline-flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-gray-200"
                        >
                            <span className="text-lg">G</span>
                            Continue with Google
                        </button>

                        {isEmbeddedBrowser && (
                            <button
                                type="button"
                                onClick={() => {
                                    window.open(window.location.href, '_blank', 'noopener,noreferrer');
                                }}
                                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-black text-white font-semibold"
                            >
                                Open in External Browser
                            </button>
                        )}
                    </div>

                    <div className="w-full my-4 flex items-center gap-3">
                        <div className="h-px bg-gray-200 flex-1" />
                        <span className="text-[11px] font-bold text-gray-400">OR</span>
                        <div className="h-px bg-gray-200 flex-1" />
                    </div>

                    <div className="w-full text-left space-y-2">
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoComplete="email"
                            placeholder="Email"
                            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
                        />
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                            placeholder="Password"
                            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
                        />
                        <button
                            type="button"
                            disabled={loginBusy || !email.trim() || !password || (authMode === 'signin' && isHqGoogleOnlyEmail)}
                            onClick={async () => {
                                try {
                                    setLoginBusy(true);
                                    setLoginError(null);
                                    setLoginInfo(null);
                                    if (authMode === 'signin' && isHqGoogleOnlyEmail) {
                                        setLoginInfo('This HQ account must sign in with Google.');
                                        return;
                                    }
                                    if (authMode === 'signin') {
                                        await signInWithEmailPassword(email, password);
                                    } else {
                                        await signUpWithEmailPassword(email, password);
                                        setLoginInfo('Account created. If email confirmation is enabled, verify email first, then sign in.');
                                        setAuthMode('signin');
                                    }
                                } catch (e: any) {
                                    console.error('Email auth failed', e);
                                    setLoginError(toFriendlyAuthError(e?.message, authMode));
                                } finally {
                                    setLoginBusy(false);
                                }
                            }}
                            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-black text-white font-semibold disabled:opacity-50"
                        >
                            {loginBusy ? 'Processing...' : authMode === 'signin' ? 'Sign in with Email' : 'Create New Account'}
                        </button>
                        {authMode === 'signin' && isHqGoogleOnlyEmail && (
                            <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-800">
                                This email is mapped to HQ Google sign-in and cannot use email/password.
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={() => {
                                setAuthMode((prev) => (prev === 'signin' ? 'signup' : 'signin'));
                                setLoginError(null);
                                setLoginInfo(null);
                            }}
                            className="w-full text-xs font-semibold text-gray-600 hover:text-black"
                        >
                            {authMode === 'signin' ? 'Need an account? Create new account' : 'Already have account? Sign in'}
                        </button>
                        <div className="text-[11px] text-gray-500 leading-relaxed">
                            Email/password accounts are for stores that cannot use Google login. Password reset is handled by HQ admin.
                        </div>
                    </div>

                    {loginInfo && (
                        <div className="mt-4 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-2 w-full text-left">{loginInfo}</div>
                    )}

                    {loginError && (
                        <div className="mt-4 text-xs text-red-600 w-full text-left">{loginError}</div>
                    )}

                    <p className="text-xs text-gray-400 mt-6 leading-relaxed">
                        Access is restricted after sign-in. For owner access, HQ must map your email to a store account.
                    </p>
                </div>
            </div>
        </div>
    );
};



const AccountAccessScreen: React.FC<{
  onDone: () => Promise<void>;
  profileExists?: boolean;
}> = ({ onDone, profileExists = false }) => {

  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      const { data: authData } = await withTimeout(
        supabase.auth.getUser(),
        8000,
        'Get session'
      );
      const email = authData.user?.email;
      if (!email) throw new Error('No email in session');
      await withTimeout(
        createMyPendingOwnerProfile({ name: name.trim() || email, email }),
        10000,
        'Register account request'
      );
      await withTimeout(onDone(), 12000, 'Sync data');
    } catch (e: any) {
      console.error('Account request failed', e);
      setError(e?.message ?? 'Failed to register the account request.');
    } finally {
      setLoading(false);
    }
  };

  const checkApproval = async () => {
    try {
      setLoading(true);
      setError(null);
      await withTimeout(onDone(), 12000, 'Check approval');
    } catch (e: any) {
      console.error('Approval check failed', e);
      setError(e?.message ?? 'Failed to check approval.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-xl">
        <div className="text-2xl font-extrabold mb-2">{profileExists ? 'Waiting for HQ Approval' : 'Request Store Access'}</div>
        <div className="text-gray-500 mb-6 leading-relaxed">
          {profileExists
            ? 'Your account request is registered. HQ must connect this email to an approved store before store data becomes available.'
            : 'Stores, countries and currencies are registered by HQ. Submit this account request, then ask HQ to connect your email to the approved store.'}
        </div>

        {!profileExists && (
        <>
        <label className="text-sm font-semibold text-gray-700">Your name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full px-3 py-3 rounded-xl border border-gray-200"
          placeholder="e.g. Store manager name"
        />
        </>
        )}

        {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

        <div className="mt-6 flex gap-3">
          <button onClick={profileExists ? checkApproval : submit} disabled={loading} className="px-4 py-3 rounded-xl bg-black text-white font-semibold disabled:opacity-50">
            {loading ? (profileExists ? 'Checking...' : 'Registering...') : profileExists ? 'Check Approval' : 'Request Access'}
          </button>
          <button onClick={() => signOut()} className="px-4 py-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition font-semibold">
            Sign Out
          </button>
        </div>

        <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 leading-relaxed">
          This account cannot create or join a store by itself. HQ approval is required before store data becomes available.
        </div>
      </div>
    </div>
  );
};


const App = () => {
  const localHqPreviewMode = isLocalHqPreviewMode();
  const localOwnerPreviewMode = isLocalOwnerPreviewMode();
  const [user, setUser] = useState<User | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = 'en';
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Backspace'
        || event.defaultPrevented
        || event.metaKey
        || event.ctrlKey
        || event.altKey
        || isEditableNavigationTarget(event.target)
      ) {
        return;
      }
      const state = window.history.state as { screen?: string } | null;
      if (!state?.screen) return;
      event.preventDefault();
      window.history.back();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || localHqPreviewMode) return;
    supabase.auth.getSession().then(({ data }) => {
      const email = data.session?.user?.email ?? null;
      setSessionEmail(email);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      const email = s?.user?.email ?? null;
      setSessionEmail(email);
    });
    return () => sub.subscription.unsubscribe();
  }, [localHqPreviewMode]);

  if (!isSupabaseConfigured && !localHqPreviewMode) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="text-xl font-extrabold text-gray-900">Local Supabase config missing</div>
          <p className="mt-2 text-sm text-gray-600 leading-relaxed">
            The app loaded, but local login/data cannot run until `.env.local` has your Supabase URL and anon key.
          </p>
          <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 p-3 text-xs font-mono text-gray-700 whitespace-pre-wrap">{`VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...`}</div>
          <p className="mt-4 text-xs text-gray-500">
            Invoice static preview is still available at `/invoice-china-preview.html`.
          </p>
        </div>
      </div>
    );
  }

  // Data State
  const [stores, setStores] = useState<Store[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [menus, setMenuRows] = useState<Menu[]>([]);
  const [setMenus, setSetMenus] = useState<SetMenu[]>([]);
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
      loadSetMenus(),
      loadSales(salesLookbackRef.current),
      loadStoreIngredientStocks(),
      loadGlobalConfig(),
    ]);

    const errors: string[] = [];

    const stRes = results[0];
    if (stRes.status === 'fulfilled') {
      if (canApplyScopeResult('stores', scopeSnapshot)) setStores(stRes.value);
    } else {
      errors.push(stRes.reason?.message ?? 'Failed to load stores');
    }

    const ingRes = results[1];
    if (ingRes.status === 'fulfilled') {
      if (canApplyScopeResult('ingredients', scopeSnapshot)) setIngredients(ingRes.value);
    } else {
      errors.push(ingRes.reason?.message ?? 'Failed to load ingredients');
    }

    const empRes = results[2];
    if (empRes.status === 'fulfilled') {
      if (canApplyScopeResult('employees', scopeSnapshot)) setEmployees(empRes.value);
    } else {
      errors.push(empRes.reason?.message ?? 'Failed to load employees');
    }

    const mnRes = results[3];
    if (mnRes.status === 'fulfilled') {
      if (canApplyScopeResult('menus', scopeSnapshot)) setMenuRows(mnRes.value);
    } else {
      errors.push(mnRes.reason?.message ?? 'Failed to load menus');
    }

    const smRes = results[4];
    if (smRes.status === 'fulfilled') {
      if (canApplyScopeResult('setMenus', scopeSnapshot)) setSetMenus(smRes.value);
    } else {
      errors.push(smRes.reason?.message ?? 'Failed to load set menus');
    }

    const slRes = results[5];
    if (slRes.status === 'fulfilled') {
      if (canApplyScopeResult('sales', scopeSnapshot)) setSales(slRes.value);
    } else {
      errors.push(slRes.reason?.message ?? 'Failed to load sales');
    }

    const ssRes = results[6];
    if (ssRes.status === 'fulfilled') {
      if (canApplyScopeResult('storeStocks', scopeSnapshot)) setStoreStocks(ssRes.value);
    } else {
      errors.push(ssRes.reason?.message ?? 'Failed to load store stock');
    }

    const gcRes = results[7];
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
      tasks.push(loadStores().then((rows) => { if (canApplyScopeResult('stores', scopeSnapshot)) setStores(rows); }).catch(e => { errors.push(e?.message ?? 'Failed to load stores'); }));
    }
    if (scopes.has('ingredients')) {
      tasks.push(loadIngredients().then((rows) => { if (canApplyScopeResult('ingredients', scopeSnapshot)) setIngredients(rows); }).catch(e => { errors.push(e?.message ?? 'Failed to load ingredients'); }));
    }
    if (scopes.has('employees')) {
      tasks.push(loadEmployees().then((rows) => { if (canApplyScopeResult('employees', scopeSnapshot)) setEmployees(rows); }).catch(e => { errors.push(e?.message ?? 'Failed to load employees'); }));
    }
    if (scopes.has('menus')) {
      tasks.push(loadMenus().then((rows) => { if (canApplyScopeResult('menus', scopeSnapshot)) setMenuRows(rows); }).catch(e => { errors.push(e?.message ?? 'Failed to load menus'); }));
    }
    if (scopes.has('setMenus')) {
      tasks.push(loadSetMenus().then((rows) => { if (canApplyScopeResult('setMenus', scopeSnapshot)) setSetMenus(rows); }).catch(e => { errors.push(e?.message ?? 'Failed to load set menus'); }));
    }
    if (scopes.has('sales')) {
      tasks.push(loadSales(salesLookbackRef.current).then((rows) => { if (canApplyScopeResult('sales', scopeSnapshot)) setSales(rows); }).catch(e => { errors.push(e?.message ?? 'Failed to load sales'); }));
    }
    if (scopes.has('storeStocks')) {
      tasks.push(loadStoreIngredientStocks().then((rows) => { if (canApplyScopeResult('storeStocks', scopeSnapshot)) setStoreStocks(rows); }).catch(e => { errors.push(e?.message ?? 'Failed to load store stock'); }));
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_menu_items' }, () => schedulePartialRefresh(['sales']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_set_items' }, () => schedulePartialRefresh(['sales']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menus' }, () => schedulePartialRefresh(['menus']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_recipe_items' }, () => schedulePartialRefresh(['menus']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'set_menus' }, () => schedulePartialRefresh(['setMenus']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'set_menu_items' }, () => schedulePartialRefresh(['setMenus']))
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
      schedulePartialRefresh(['sales', 'employees', 'menus', 'setMenus', 'storeStocks']);
    }, SALES_FALLBACK_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [sessionEmail, schedulePartialRefresh]);

  useEffect(() => {
    if (!sessionEmail) return;
    const onFocusOrVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      schedulePartialRefresh(['sales', 'employees', 'menus', 'setMenus', 'storeStocks']);
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

 // Map Supabase session email -> app user (DB + single HQ override)

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
  if (isHqAdminEmail(email)) {
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
        role: row.role === 'HQ' && isHqAdminEmail(row.email) ? UserRole.HQ : UserRole.OWNER,
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

if (localHqPreviewMode) {
  const previewUser = MOCK_USERS.find((mockUser) => mockUser.role === UserRole.HQ) ?? {
    name: 'HQ Preview',
    email: 'hq-preview@chibo.local',
    role: UserRole.HQ,
  };
  const previewStoreStocks = DEFAULT_GLOBAL_CONFIG.standardIngredients.flatMap((ingredient, ingredientIndex) =>
    MOCK_STORES.map((store, storeIndex) => ({
      storeId: store.id,
      ingredientName: ingredient.name,
      unit: ingredient.unit,
      par: Number(ingredient.par || 0) || 1000 + ingredientIndex * 250 + storeIndex * 50,
      reorder: Number(ingredient.reorder || 0) || 300,
    })),
  );

  return (
    <HQDashboard
      user={previewUser}
      onLogout={() => {
        window.location.href = window.location.pathname;
      }}
      stores={MOCK_STORES}
      sales={MOCK_SALES}
      menus={MOCK_MENUS}
      setMenus={[]}
      employees={MOCK_EMPLOYEES}
      ingredients={MOCK_INGREDIENTS}
      storeStocks={previewStoreStocks}
      globalConfig={DEFAULT_GLOBAL_CONFIG}
      salesLookbackLabel="sample"
      onLoadMoreSales={() => {}}
      onUpdateGlobalConfig={() => {}}
      onUpdateStore={() => {}}
      onSaveStoreStocks={() => {}}
      onMergeStores={async () => {}}
      onDeleteStore={async () => {}}
      onUpdateMenu={() => {}}
      onCreateMenu={() => {}}
      onDeleteMenu={() => {}}
      onUpdateSetMenu={() => {}}
      onCreateSetMenu={() => {}}
      onDeleteSetMenu={() => {}}
      onUpdateEmployees={() => {}}
      onAddIngredient={() => {}}
    />
  );
}

if (localOwnerPreviewMode) {
  const previewStore = MOCK_STORES[0];
  const previewUser = MOCK_USERS.find((mockUser) => mockUser.role === UserRole.OWNER) ?? {
    name: 'Store Owner Preview',
    email: 'owner-preview@chibo.local',
    role: UserRole.OWNER,
    storeId: previewStore.id,
  };
  const previewSetMenus: SetMenu[] = [
    {
      id: 'SM_PREVIEW_1',
      storeId: previewStore.id,
      name: 'CHIBO Course',
      price: 3200,
      items: [
        { menuId: 'M1', quantity: 1 },
        { menuId: 'M4', quantity: 1 },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-[80] border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-xs font-black text-amber-950">
        DEMO PREVIEW · Sample numbers only · Never use this screen to verify operating data
      </div>
      <StoreDashboard
        key={previewStore.id}
        user={previewUser}
        store={previewStore}
        onLogout={() => {
          window.location.href = window.location.pathname;
        }}
        sales={MOCK_SALES}
        menus={MOCK_MENUS}
        setMenus={previewSetMenus}
        employees={MOCK_EMPLOYEES}
        ingredients={MOCK_INGREDIENTS}
        globalConfig={DEFAULT_GLOBAL_CONFIG}
        onAddSale={() => {}}
        onUpdateMenu={() => {}}
        onCreateMenu={() => {}}
        onDeleteMenu={() => {}}
        onUpdateSetMenu={() => {}}
        onCreateSetMenu={() => {}}
        onDeleteSetMenu={() => {}}
        onUpdateEmployees={() => {}}
        onAddIngredient={() => {}}
      />
    </div>
  );
}

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
    <AccountAccessScreen
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
              setMenus={setMenus}
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
              onMergeStores={async (sourceId, targetId) => {
                const { error } = await supabase.rpc('merge_stores', {
                  p_source_id: sourceId,
                  p_target_id: targetId,
                });
                if (error) throw error;
                await refreshAll();
              }}
              onDeleteStore={async (storeId) => {
                const target = stores.find(store => store.id === storeId);
                if (!target) throw new Error('Store not found. Refresh and try again.');
                const { error } = await supabase.rpc('purge_non_operating_store', {
                  p_store_id: storeId,
                  p_confirmation: target.name,
                });
                if (error) {
                  throw error;
                }
                await refreshAll();
              }}
              onUpdateMenu={async (m) => {
                beginScopeMutation(['menus']);
                setMenuRows(prev => {
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
                setMenuRows(prev => {
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
                setMenuRows(prev => prev.filter(menu => menu.id !== id));
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
              onUpdateSetMenu={async (setMenu) => {
                beginScopeMutation(['setMenus']);
                setSetMenus((prev) => {
                  const exists = prev.some((row) => row.id === setMenu.id);
                  if (exists) return prev.map((row) => row.id === setMenu.id ? setMenu : row);
                  return [...prev, setMenu];
                });
                try {
                  await saveSetMenu(setMenu);
                } catch (e) {
                  await refreshAll();
                  throw e;
                } finally {
                  endScopeMutation(['setMenus']);
                  schedulePartialRefresh(['setMenus']);
                }
              }}
              onCreateSetMenu={async (setMenu) => {
                beginScopeMutation(['setMenus']);
                setSetMenus((prev) => {
                  const exists = prev.some((row) => row.id === setMenu.id);
                  if (exists) return prev.map((row) => row.id === setMenu.id ? setMenu : row);
                  return [...prev, setMenu];
                });
                try {
                  await saveSetMenu(setMenu);
                } catch (e) {
                  await refreshAll();
                  throw e;
                } finally {
                  endScopeMutation(['setMenus']);
                  schedulePartialRefresh(['setMenus']);
                }
              }}
              onDeleteSetMenu={async (id) => {
                beginScopeMutation(['setMenus']);
                setSetMenus((prev) => prev.filter((row) => row.id !== id));
                try {
                  await deleteSetMenu(id);
                } catch (e) {
                  await refreshAll();
                  throw e;
                } finally {
                  endScopeMutation(['setMenus']);
                  schedulePartialRefresh(['setMenus']);
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
    <AccountAccessScreen
      profileExists
      onDone={async () => {
        await refreshAll();
        await loadResolvedUser();
      }}
    />
  );
}

if (myStore.reportingStatus === 'quarantined') {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-7 shadow-sm">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-red-700">HQ review required</div>
        <h1 className="mt-2 text-2xl font-extrabold">Store access is temporarily paused</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          This account is connected to a store record with an invalid country or currency setup. Existing data is preserved, but new reports are blocked until HQ confirms the correct store.
        </p>
        {myStore.dataQualityNote && (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{myStore.dataQualityNote}</div>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="mt-6 rounded-xl bg-black px-5 py-3 text-sm font-bold text-white"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}


  return (
      <StoreDashboard
          key={myStore.id}
          user={user}
          store={myStore}
          onLogout={handleLogout}
          sales={sales}
          menus={menus}
          setMenus={setMenus}
          employees={employees}
          ingredients={ingredients}
          globalConfig={globalConfig}
          onAddSale={async (s) => {
            try {
              await addSale(s);
              try {
                const latestSales = await loadSales(salesLookbackRef.current);
                setSales(latestSales);
              } catch (reloadErr) {
                console.error('Failed to reload sales after save', reloadErr);
              }

              // Apply stock consumption to store_ingredient_stock
              if (s.items && s.items.length > 0) {
                const standardIngredients = globalConfig.standardIngredients ?? [];
                const standardSet = new Set(standardIngredients.map(si => si.name));
                const standardMap = new Map<string, GlobalConfig['standardIngredients'][number]>(
                  standardIngredients.map(si => [si.name, si]),
                );
                const storeMenus = menus.filter(m => m.storeId === s.storeId);

                if (storeMenus.length > 0 && standardIngredients.length > 0) {
                  const ingredientById = new Map<string, Ingredient>(ingredients.map(i => [i.id, i]));
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
              await refreshAll();
              throw e;
            } finally {
              schedulePartialRefresh(['sales', 'storeStocks']);
            }
          }}

          onUpdateMenu={async (m) => {
            beginScopeMutation(['menus']);
            setMenuRows(prev => {
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
            setMenuRows(prev => {
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
            setMenuRows(prev => prev.filter(menu => menu.id !== id));
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
          onUpdateSetMenu={async (setMenu) => {
            beginScopeMutation(['setMenus']);
            setSetMenus((prev) => {
              const exists = prev.some((row) => row.id === setMenu.id);
              if (exists) return prev.map((row) => row.id === setMenu.id ? setMenu : row);
              return [...prev, setMenu];
            });
            try {
              await saveSetMenu(setMenu);
            } catch (e) {
              await refreshAll();
              throw e;
            } finally {
              endScopeMutation(['setMenus']);
              schedulePartialRefresh(['setMenus']);
            }
          }}
          onCreateSetMenu={async (setMenu) => {
            beginScopeMutation(['setMenus']);
            setSetMenus((prev) => {
              const exists = prev.some((row) => row.id === setMenu.id);
              if (exists) return prev.map((row) => row.id === setMenu.id ? setMenu : row);
              return [...prev, setMenu];
            });
            try {
              await saveSetMenu(setMenu);
            } catch (e) {
              await refreshAll();
              throw e;
            } finally {
              endScopeMutation(['setMenus']);
              schedulePartialRefresh(['setMenus']);
            }
          }}
          onDeleteSetMenu={async (id) => {
            beginScopeMutation(['setMenus']);
            setSetMenus((prev) => prev.filter((row) => row.id !== id));
            try {
              await deleteSetMenu(id);
            } catch (e) {
              await refreshAll();
              throw e;
            } finally {
              endScopeMutation(['setMenus']);
              schedulePartialRefresh(['setMenus']);
            }
          }}
          onUpdateEmployees={async (emps) => { await updateEmployeesForStore(myStore.id, emps); }}
          onAddIngredient={async (i) => { await addIngredient(i); schedulePartialRefresh(['ingredients']); }}
      />
  );
}

export default App;
