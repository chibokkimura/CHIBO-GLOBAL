import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Warehouse,
} from 'lucide-react';
import { Ingredient, Store } from './types';
import { supabase } from './supabaseClient';

type IngredientCategory = 'main' | 'secondary' | 'packaging' | 'other';

type IngredientProfile = {
  storeId: string;
  ingredientId: string;
  category: IngredientCategory;
  purchaseUnit: string;
  contentQuantity: number;
  currentPackPrice: number;
  currency: string;
  supplier: string;
  active: boolean;
};

type PurchaseEntry = {
  id: string;
  storeId: string;
  ingredientId: string;
  purchaseDate: string;
  packages: number;
  contentQuantity: number;
  baseQuantity: number;
  totalCost: number;
  currency: string;
  supplier: string;
  notes: string;
};

type InventoryRow = {
  storeId: string;
  ingredientId: string;
  monthStart: string;
  openingQuantity: number;
  wasteQuantity: number;
  adjustmentQuantity: number;
  closingQuantity: number;
  countComplete: boolean;
  notes: string;
};

type Props = {
  store: Store;
  ingredients: Ingredient[];
  initialMonthKey: string;
  mode: 'owner' | 'hq';
  onAddIngredient?: (ingredient: Ingredient) => Promise<void> | void;
};

const CATEGORY_LABELS: Record<IngredientCategory, string> = {
  main: 'Main',
  secondary: 'Secondary',
  packaging: 'Packaging',
  other: 'Other',
};

function isLocalPreview(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  return local && new URLSearchParams(window.location.search).has('preview');
}

function formatAmount(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(Number(value || 0));
}

function monthBounds(monthKey: string): { start: string; end: string } {
  const [year, month] = monthKey.split('-').map(Number);
  const endDay = new Date(year, month, 0).getDate();
  return {
    start: `${monthKey}-01`,
    end: `${monthKey}-${String(endDay).padStart(2, '0')}`,
  };
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

function createMonthOptions(initialMonthKey: string): string[] {
  const [initialYear, initialMonth] = initialMonthKey.split('-').map(Number);
  const base = initialYear && initialMonth ? new Date(initialYear, initialMonth - 1, 1) : new Date();
  return Array.from({ length: 15 }, (_, index) => {
    const date = new Date(base.getFullYear(), base.getMonth() - index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
}

function mapProfile(row: any): IngredientProfile {
  return {
    storeId: row.store_id,
    ingredientId: row.ingredient_id,
    category: row.category,
    purchaseUnit: row.purchase_unit,
    contentQuantity: Number(row.content_quantity ?? 0),
    currentPackPrice: Number(row.current_pack_price ?? 0),
    currency: row.currency,
    supplier: row.supplier ?? '',
    active: Boolean(row.active),
  };
}

function mapPurchase(row: any): PurchaseEntry {
  return {
    id: row.id,
    storeId: row.store_id,
    ingredientId: row.ingredient_id,
    purchaseDate: row.purchase_date,
    packages: Number(row.packages ?? 0),
    contentQuantity: Number(row.content_quantity ?? 0),
    baseQuantity: Number(row.base_quantity ?? 0),
    totalCost: Number(row.total_cost ?? 0),
    currency: row.currency,
    supplier: row.supplier ?? '',
    notes: row.notes ?? '',
  };
}

function mapInventory(row: any): InventoryRow {
  return {
    storeId: row.store_id,
    ingredientId: row.ingredient_id,
    monthStart: row.month_start,
    openingQuantity: Number(row.opening_quantity ?? 0),
    wasteQuantity: Number(row.waste_quantity ?? 0),
    adjustmentQuantity: Number(row.adjustment_quantity ?? 0),
    closingQuantity: Number(row.closing_quantity ?? 0),
    countComplete: Boolean(row.count_complete),
    notes: row.notes ?? '',
  };
}

function emptyInventoryRow(storeId: string, ingredientId: string, monthStart: string): InventoryRow {
  return {
    storeId,
    ingredientId,
    monthStart,
    openingQuantity: 0,
    wasteQuantity: 0,
    adjustmentQuantity: 0,
    closingQuantity: 0,
    countComplete: false,
    notes: '',
  };
}

const CostInventoryWorkspace: React.FC<Props> = ({
  store,
  ingredients,
  initialMonthKey,
  mode,
  onAddIngredient,
}) => {
  const preview = isLocalPreview();
  const editable = mode === 'owner';
  const [monthKey, setMonthKey] = useState(initialMonthKey);
  const [localIngredients, setLocalIngredients] = useState<Ingredient[]>(ingredients);
  const [profiles, setProfiles] = useState<IngredientProfile[]>([]);
  const [purchases, setPurchases] = useState<PurchaseEntry[]>([]);
  const [inventoryRows, setInventoryRows] = useState<Record<string, InventoryRow>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedIngredientId, setSelectedIngredientId] = useState('');
  const [showNewIngredient, setShowNewIngredient] = useState(false);
  const [newIngredient, setNewIngredient] = useState({ name: '', unit: 'g' });
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [purchaseDraft, setPurchaseDraft] = useState({
    ingredientId: '',
    purchaseDate: `${initialMonthKey}-01`,
    packages: '1',
    totalCost: '',
    supplier: '',
    notes: '',
  });

  useEffect(() => {
    setMonthKey(initialMonthKey);
  }, [initialMonthKey, store.id]);

  useEffect(() => {
    setLocalIngredients((current) => {
      const merged = new Map(current.map((ingredient) => [ingredient.id, ingredient]));
      ingredients.forEach((ingredient) => merged.set(ingredient.id, ingredient));
      return Array.from(merged.values());
    });
  }, [ingredients]);

  const monthStart = `${monthKey}-01`;
  const { end: monthEnd } = useMemo(() => monthBounds(monthKey), [monthKey]);
  const monthOptions = useMemo(() => createMonthOptions(initialMonthKey), [initialMonthKey]);
  const ingredientById = useMemo(
    () => new Map(localIngredients.map((ingredient) => [ingredient.id, ingredient])),
    [localIngredients],
  );
  const activeProfiles = useMemo(
    () => profiles
      .filter((profile) => profile.active)
      .sort((left, right) => {
        const leftName = ingredientById.get(left.ingredientId)?.name ?? left.ingredientId;
        const rightName = ingredientById.get(right.ingredientId)?.name ?? right.ingredientId;
        return leftName.localeCompare(rightName);
      }),
    [profiles, ingredientById],
  );
  const unconfiguredIngredients = useMemo(() => {
    const configuredIds = new Set(activeProfiles.map((profile) => profile.ingredientId));
    return localIngredients
      .filter((ingredient) => !configuredIds.has(ingredient.id))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [activeProfiles, localIngredients]);

  const purchasedQuantityByIngredient = useMemo(() => {
    const totals = new Map<string, number>();
    purchases.forEach((purchase) => {
      totals.set(
        purchase.ingredientId,
        (totals.get(purchase.ingredientId) ?? 0) + purchase.baseQuantity,
      );
    });
    return totals;
  }, [purchases]);

  const purchaseTotal = useMemo(
    () => purchases.reduce((sum, purchase) => sum + purchase.totalCost, 0),
    [purchases],
  );
  const completedCounts = activeProfiles.filter((profile) => inventoryRows[profile.ingredientId]?.countComplete).length;

  const seedPreview = useCallback(() => {
    const sampleIngredients = localIngredients.slice(0, 3);
    const nextProfiles = sampleIngredients.map((ingredient, index): IngredientProfile => ({
      storeId: store.id,
      ingredientId: ingredient.id,
      category: index === 0 ? 'main' : 'secondary',
      purchaseUnit: index === 0 ? 'case' : 'pack',
      contentQuantity: index === 0 ? 5000 : 1000,
      currentPackPrice: index === 0 ? 1850 : 480,
      currency: store.currency,
      supplier: index === 0 ? 'Sample Food Supplier' : 'Local Market',
      active: true,
    }));
    const first = nextProfiles[0];
    const second = nextProfiles[1];
    const nextPurchases: PurchaseEntry[] = [
      ...(first ? [{
        id: 'preview-purchase-1',
        storeId: store.id,
        ingredientId: first.ingredientId,
        purchaseDate: `${monthKey}-05`,
        packages: 3,
        contentQuantity: first.contentQuantity,
        baseQuantity: 3 * first.contentQuantity,
        totalCost: 3 * first.currentPackPrice,
        currency: store.currency,
        supplier: first.supplier,
        notes: '',
      }] : []),
      ...(second ? [{
        id: 'preview-purchase-2',
        storeId: store.id,
        ingredientId: second.ingredientId,
        purchaseDate: `${monthKey}-11`,
        packages: 5,
        contentQuantity: second.contentQuantity,
        baseQuantity: 5 * second.contentQuantity,
        totalCost: 5 * second.currentPackPrice,
        currency: store.currency,
        supplier: second.supplier,
        notes: '',
      }] : []),
    ];
    const nextInventory = Object.fromEntries(nextProfiles.map((profile, index) => [
      profile.ingredientId,
      {
        ...emptyInventoryRow(store.id, profile.ingredientId, monthStart),
        openingQuantity: index === 0 ? 8000 : 2000,
        wasteQuantity: index === 0 ? 250 : 0,
        closingQuantity: index === 0 ? 4200 : 1500,
        countComplete: index === 0,
      },
    ]));
    setProfiles(nextProfiles);
    setPurchases(nextPurchases);
    setInventoryRows(nextInventory);
  }, [localIngredients, monthKey, monthStart, store.currency, store.id]);

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
      const [profileResult, purchaseResult, inventoryResult] = await Promise.all([
        supabase
          .from('store_ingredient_profiles')
          .select('store_id,ingredient_id,category,purchase_unit,content_quantity,current_pack_price,currency,supplier,active')
          .eq('store_id', store.id)
          .order('ingredient_id'),
        supabase
          .from('ingredient_purchases')
          .select('id,store_id,ingredient_id,purchase_date,packages,content_quantity,base_quantity,total_cost,currency,supplier,notes')
          .eq('store_id', store.id)
          .gte('purchase_date', monthStart)
          .lte('purchase_date', monthEnd)
          .order('purchase_date', { ascending: false }),
        supabase
          .from('monthly_ingredient_inventory')
          .select('store_id,ingredient_id,month_start,opening_quantity,waste_quantity,adjustment_quantity,closing_quantity,count_complete,notes')
          .eq('store_id', store.id)
          .eq('month_start', monthStart),
      ]);

      const firstError = profileResult.error || purchaseResult.error || inventoryResult.error;
      if (firstError) throw firstError;

      const nextProfiles = (profileResult.data ?? []).map(mapProfile);
      const nextInventoryRows = Object.fromEntries(
        (inventoryResult.data ?? []).map((row: any) => {
          const mapped = mapInventory(row);
          return [mapped.ingredientId, mapped];
        }),
      );
      nextProfiles.forEach((profile) => {
        if (!nextInventoryRows[profile.ingredientId]) {
          nextInventoryRows[profile.ingredientId] = emptyInventoryRow(store.id, profile.ingredientId, monthStart);
        }
      });

      setProfiles(nextProfiles);
      setPurchases((purchaseResult.data ?? []).map(mapPurchase));
      setInventoryRows(nextInventoryRows);
    } catch (loadError: any) {
      console.error('Failed to load cost and inventory data', loadError);
      const message = String(loadError?.message ?? '');
      setError(
        message.toLowerCase().includes('could not find the table')
          ? 'The Update 5 database tables are not active yet. Apply the Phase 5 migration, then reload.'
          : (message || 'Failed to load cost and inventory data.'),
      );
    } finally {
      setLoading(false);
    }
  }, [monthEnd, monthStart, preview, seedPreview, store.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setPurchaseDraft((current) => ({
      ...current,
      ingredientId: activeProfiles.some((profile) => profile.ingredientId === current.ingredientId)
        ? current.ingredientId
        : (activeProfiles[0]?.ingredientId ?? ''),
      purchaseDate: monthStart,
      packages: '1',
      totalCost: '',
      supplier: '',
      notes: '',
    }));
  }, [activeProfiles, monthStart]);

  const saveProfile = async (profile: IngredientProfile) => {
    if (!editable) return;
    if (!profile.purchaseUnit.trim() || profile.contentQuantity <= 0 || profile.currentPackPrice < 0) {
      setError('Enter a purchase unit, content quantity above 0, and a valid pack price.');
      return;
    }

    setSavingKey(`profile-${profile.ingredientId}`);
    setError(null);
    setNotice(null);
    try {
      if (!preview) {
        const { data, error: saveError } = await supabase
          .from('store_ingredient_profiles')
          .upsert({
            store_id: store.id,
            ingredient_id: profile.ingredientId,
            category: profile.category,
            purchase_unit: profile.purchaseUnit.trim(),
            content_quantity: profile.contentQuantity,
            current_pack_price: profile.currentPackPrice,
            currency: store.currency,
            supplier: profile.supplier.trim() || null,
            active: profile.active,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'store_id,ingredient_id' })
          .select('store_id,ingredient_id,category,purchase_unit,content_quantity,current_pack_price,currency,supplier,active')
          .single();
        if (saveError) throw saveError;
        const saved = mapProfile(data);
        setProfiles((current) => [
          ...current.filter((row) => row.ingredientId !== saved.ingredientId),
          saved,
        ]);
      }
      setNotice('Ingredient purchase setup saved.');
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Failed to save ingredient setup.');
    } finally {
      setSavingKey(null);
    }
  };

  const addProfile = async (ingredientId: string) => {
    if (!editable || !ingredientId) return;
    const next: IngredientProfile = {
      storeId: store.id,
      ingredientId,
      category: 'other',
      purchaseUnit: 'pack',
      contentQuantity: 1,
      currentPackPrice: 0,
      currency: store.currency,
      supplier: '',
      active: true,
    };
    setProfiles((current) => [...current.filter((row) => row.ingredientId !== ingredientId), next]);
    setInventoryRows((current) => ({
      ...current,
      [ingredientId]: current[ingredientId] ?? emptyInventoryRow(store.id, ingredientId, monthStart),
    }));
    setSelectedIngredientId('');
    await saveProfile(next);
  };

  const createIngredient = async () => {
    if (!editable || !newIngredient.name.trim() || !newIngredient.unit.trim()) {
      setError('Enter the ingredient name and base unit.');
      return;
    }
    const ingredient: Ingredient = {
      id: `ing_${store.id}_${Date.now()}`,
      name: newIngredient.name.trim(),
      unit: newIngredient.unit.trim(),
    };
    setSavingKey('new-ingredient');
    setError(null);
    try {
      if (!preview) {
        await onAddIngredient?.(ingredient);
      }
      setLocalIngredients((current) => [...current.filter((row) => row.id !== ingredient.id), ingredient]);
      setNewIngredient({ name: '', unit: 'g' });
      setShowNewIngredient(false);
      await addProfile(ingredient.id);
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Failed to add ingredient.');
    } finally {
      setSavingKey(null);
    }
  };

  const addPurchase = async () => {
    if (!editable) return;
    const profile = activeProfiles.find((row) => row.ingredientId === purchaseDraft.ingredientId);
    const packages = Number(purchaseDraft.packages);
    const totalCost = Number(purchaseDraft.totalCost);
    if (!profile || !purchaseDraft.purchaseDate || packages <= 0 || !Number.isFinite(totalCost) || totalCost < 0) {
      setError('Choose an ingredient and enter valid packages, date, and total cost.');
      return;
    }

    setSavingKey('purchase');
    setError(null);
    setNotice(null);
    try {
      const next: PurchaseEntry = {
        id: preview ? `preview-purchase-${Date.now()}` : '',
        storeId: store.id,
        ingredientId: profile.ingredientId,
        purchaseDate: purchaseDraft.purchaseDate,
        packages,
        contentQuantity: profile.contentQuantity,
        baseQuantity: packages * profile.contentQuantity,
        totalCost,
        currency: store.currency,
        supplier: purchaseDraft.supplier.trim() || profile.supplier,
        notes: purchaseDraft.notes.trim(),
      };

      if (preview) {
        setPurchases((current) => [next, ...current]);
      } else {
        const authUser = (await supabase.auth.getUser()).data.user?.id ?? null;
        const { data, error: saveError } = await supabase
          .from('ingredient_purchases')
          .insert({
            store_id: store.id,
            ingredient_id: next.ingredientId,
            purchase_date: next.purchaseDate,
            packages: next.packages,
            content_quantity: next.contentQuantity,
            total_cost: next.totalCost,
            currency: next.currency,
            supplier: next.supplier || null,
            notes: next.notes || null,
            created_by: authUser,
          })
          .select('id,store_id,ingredient_id,purchase_date,packages,content_quantity,base_quantity,total_cost,currency,supplier,notes')
          .single();
        if (saveError) throw saveError;
        setPurchases((current) => [mapPurchase(data), ...current]);
      }

      setPurchaseDraft((current) => ({
        ...current,
        packages: '1',
        totalCost: '',
        supplier: '',
        notes: '',
      }));
      setShowPurchaseForm(false);
      setNotice('Purchase entry saved.');
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Failed to add purchase entry.');
    } finally {
      setSavingKey(null);
    }
  };

  const deletePurchase = async (purchase: PurchaseEntry) => {
    if (!editable || !window.confirm('Delete this purchase entry?')) return;
    setSavingKey(`purchase-${purchase.id}`);
    setError(null);
    try {
      if (!preview) {
        const { error: deleteError } = await supabase
          .from('ingredient_purchases')
          .delete()
          .eq('id', purchase.id)
          .eq('store_id', store.id);
        if (deleteError) throw deleteError;
      }
      setPurchases((current) => current.filter((row) => row.id !== purchase.id));
    } catch (deleteError: any) {
      setError(deleteError?.message ?? 'Failed to delete purchase entry.');
    } finally {
      setSavingKey(null);
    }
  };

  const updateInventoryDraft = (ingredientId: string, patch: Partial<InventoryRow>) => {
    setInventoryRows((current) => ({
      ...current,
      [ingredientId]: {
        ...(current[ingredientId] ?? emptyInventoryRow(store.id, ingredientId, monthStart)),
        ...patch,
      },
    }));
  };

  const saveInventoryRow = async (ingredientId: string) => {
    if (!editable) return;
    const row = inventoryRows[ingredientId] ?? emptyInventoryRow(store.id, ingredientId, monthStart);
    if (
      row.openingQuantity < 0
      || row.wasteQuantity < 0
      || row.closingQuantity < 0
      || !Number.isFinite(row.adjustmentQuantity)
    ) {
      setError('Inventory quantities must be valid. Opening, waste, and closing quantities cannot be negative.');
      return;
    }

    setSavingKey(`inventory-${ingredientId}`);
    setError(null);
    setNotice(null);
    try {
      if (!preview) {
        const authUser = (await supabase.auth.getUser()).data.user?.id ?? null;
        const { data, error: saveError } = await supabase
          .from('monthly_ingredient_inventory')
          .upsert({
            store_id: store.id,
            ingredient_id: ingredientId,
            month_start: monthStart,
            opening_quantity: row.openingQuantity,
            waste_quantity: row.wasteQuantity,
            adjustment_quantity: row.adjustmentQuantity,
            closing_quantity: row.closingQuantity,
            count_complete: row.countComplete,
            notes: row.notes.trim() || null,
            created_by: authUser,
            updated_by: authUser,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'store_id,ingredient_id,month_start' })
          .select('store_id,ingredient_id,month_start,opening_quantity,waste_quantity,adjustment_quantity,closing_quantity,count_complete,notes')
          .single();
        if (saveError) throw saveError;
        const saved = mapInventory(data);
        setInventoryRows((current) => ({ ...current, [ingredientId]: saved }));
      }
      setNotice('Monthly inventory count saved.');
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Failed to save monthly inventory count.');
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        Loading cost and inventory…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">
            {mode === 'hq' ? 'HQ inventory review' : 'Store cost input'}
          </div>
          <h2 className="mt-1 text-2xl font-extrabold">Purchases & Monthly Inventory</h2>
          <p className="mt-1 text-sm text-gray-500">
            {mode === 'hq'
              ? 'Review the store purchase setup, monthly purchases, and completed stock counts.'
              : 'Set each purchase pack once, record purchases, then count opening and closing stock.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              aria-label="Inventory month"
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
            aria-label="Reload cost and inventory"
            onClick={() => void loadData()}
            className="rounded-xl border border-gray-200 bg-white p-2.5 text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-gray-500">
            Ingredients configured <Warehouse className="h-4 w-4" />
          </div>
          <div className="mt-2 text-2xl font-extrabold">{activeProfiles.length}</div>
          <div className="mt-1 text-xs text-gray-500">Purchase pack, content, price, and supplier</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-gray-500">
            Purchases this month <PackagePlus className="h-4 w-4" />
          </div>
          <div className="mt-2 text-2xl font-extrabold">{store.currency} {formatAmount(purchaseTotal)}</div>
          <div className="mt-1 text-xs text-gray-500">{purchases.length} purchase entr{purchases.length === 1 ? 'y' : 'ies'}</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-gray-500">
            Inventory counts <ClipboardList className="h-4 w-4" />
          </div>
          <div className={`mt-2 text-2xl font-extrabold ${completedCounts === activeProfiles.length && activeProfiles.length > 0 ? 'text-emerald-700' : 'text-amber-600'}`}>
            {completedCounts}/{activeProfiles.length}
          </div>
          <div className="mt-1 text-xs text-gray-500">Marked complete for {monthLabel(monthKey)}</div>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-extrabold">1. Ingredient Purchase Setup</h3>
            <p className="mt-1 text-xs text-gray-500">
              Example: 1 case = 5,000 g, case price = {store.currency} 1,850.
            </p>
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Ingredient to configure"
                value={selectedIngredientId}
                onChange={(event) => setSelectedIngredientId(event.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold"
              >
                <option value="">Choose ingredient</option>
                {unconfiguredIngredients.map((ingredient) => (
                  <option key={ingredient.id} value={ingredient.id}>{ingredient.name} ({ingredient.unit})</option>
                ))}
              </select>
              <button
                type="button"
                disabled={!selectedIngredientId || savingKey !== null}
                onClick={() => void addProfile(selectedIngredientId)}
                className="inline-flex items-center gap-1 rounded-xl bg-black px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
              >
                <Plus className="h-4 w-4" /> Configure
              </button>
              <button
                type="button"
                onClick={() => setShowNewIngredient((current) => !current)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold"
              >
                New ingredient
              </button>
            </div>
          )}
        </div>

        {showNewIngredient && editable && (
          <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:grid-cols-[1fr_140px_auto]">
            <label className="text-xs font-bold text-gray-600">
              Ingredient name
              <input
                value={newIngredient.name}
                onChange={(event) => setNewIngredient((current) => ({ ...current, name: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="e.g. Cabbage"
              />
            </label>
            <label className="text-xs font-bold text-gray-600">
              Base unit
              <select
                value={newIngredient.unit}
                onChange={(event) => setNewIngredient((current) => ({ ...current, unit: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <option value="g">g</option>
                <option value="ml">ml</option>
                <option value="pcs">pcs</option>
                <option value="kg">kg</option>
                <option value="L">L</option>
              </select>
            </label>
            <button
              type="button"
              disabled={savingKey !== null}
              onClick={() => void createIngredient()}
              className="self-end rounded-lg bg-black px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              Add
            </button>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {activeProfiles.map((profile) => {
            const ingredient = ingredientById.get(profile.ingredientId);
            const unitPrice = profile.contentQuantity > 0 ? profile.currentPackPrice / profile.contentQuantity : 0;
            return (
              <div key={profile.ingredientId} className="rounded-xl border border-gray-200 p-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
                  <div className="xl:col-span-2">
                    <div className="text-sm font-extrabold">{ingredient?.name ?? profile.ingredientId}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      Base unit: {ingredient?.unit ?? 'unit'} · {store.currency} {formatAmount(unitPrice, 4)} per {ingredient?.unit ?? 'unit'}
                    </div>
                  </div>
                  <label className="text-xs font-bold text-gray-600">
                    Category
                    <select
                      value={profile.category}
                      disabled={!editable}
                      onChange={(event) => setProfiles((current) => current.map((row) => row.ingredientId === profile.ingredientId ? { ...row, category: event.target.value as IngredientCategory } : row))}
                      className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm disabled:bg-gray-50"
                    >
                      {(Object.keys(CATEGORY_LABELS) as IngredientCategory[]).map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-bold text-gray-600">
                    Purchase unit
                    <input
                      value={profile.purchaseUnit}
                      disabled={!editable}
                      onChange={(event) => setProfiles((current) => current.map((row) => row.ingredientId === profile.ingredientId ? { ...row, purchaseUnit: event.target.value } : row))}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50"
                      placeholder="case / pack / bottle"
                    />
                  </label>
                  <label className="text-xs font-bold text-gray-600">
                    Content ({ingredient?.unit ?? 'unit'})
                    <input
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={profile.contentQuantity}
                      disabled={!editable}
                      onChange={(event) => setProfiles((current) => current.map((row) => row.ingredientId === profile.ingredientId ? { ...row, contentQuantity: Number(event.target.value) } : row))}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50"
                    />
                  </label>
                  <label className="text-xs font-bold text-gray-600">
                    Pack price ({store.currency})
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={profile.currentPackPrice}
                      disabled={!editable}
                      onChange={(event) => setProfiles((current) => current.map((row) => row.ingredientId === profile.ingredientId ? { ...row, currentPackPrice: Number(event.target.value) } : row))}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50"
                    />
                  </label>
                  <label className="text-xs font-bold text-gray-600">
                    Supplier
                    <input
                      value={profile.supplier}
                      disabled={!editable}
                      onChange={(event) => setProfiles((current) => current.map((row) => row.ingredientId === profile.ingredientId ? { ...row, supplier: event.target.value } : row))}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50"
                      placeholder="Optional"
                    />
                  </label>
                </div>
                {editable && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      disabled={savingKey !== null}
                      onClick={() => void saveProfile(profile)}
                      className="inline-flex items-center gap-1 rounded-lg bg-black px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                    >
                      <Save className="h-4 w-4" /> Save setup
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {activeProfiles.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
              No ingredients configured for purchasing yet.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-extrabold">2. Purchases</h3>
            <p className="mt-1 text-xs text-gray-500">Enter packs and total invoice cost. Base quantity is calculated automatically.</p>
          </div>
          {editable && (
            <button
              type="button"
              disabled={activeProfiles.length === 0}
              onClick={() => setShowPurchaseForm((current) => !current)}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-black px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> Add purchase
            </button>
          )}
        </div>

        {showPurchaseForm && editable && (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
              <label className="text-xs font-bold text-gray-600 xl:col-span-2">
                Ingredient
                <select
                  value={purchaseDraft.ingredientId}
                  onChange={(event) => {
                    const profile = activeProfiles.find((row) => row.ingredientId === event.target.value);
                    setPurchaseDraft((current) => ({
                      ...current,
                      ingredientId: event.target.value,
                      supplier: profile?.supplier ?? '',
                      totalCost: profile ? String(profile.currentPackPrice * Number(current.packages || 0)) : '',
                    }));
                  }}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                >
                  {activeProfiles.map((profile) => {
                    const ingredient = ingredientById.get(profile.ingredientId);
                    return <option key={profile.ingredientId} value={profile.ingredientId}>{ingredient?.name ?? profile.ingredientId}</option>;
                  })}
                </select>
              </label>
              <label className="text-xs font-bold text-gray-600">
                Purchase date
                <input
                  type="date"
                  min={monthStart}
                  max={monthEnd}
                  value={purchaseDraft.purchaseDate}
                  onChange={(event) => setPurchaseDraft((current) => ({ ...current, purchaseDate: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-bold text-gray-600">
                Packs purchased
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={purchaseDraft.packages}
                  onChange={(event) => {
                    const packages = event.target.value;
                    const profile = activeProfiles.find((row) => row.ingredientId === purchaseDraft.ingredientId);
                    setPurchaseDraft((current) => ({
                      ...current,
                      packages,
                      totalCost: profile ? String(profile.currentPackPrice * Number(packages || 0)) : current.totalCost,
                    }));
                  }}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-bold text-gray-600">
                Total cost ({store.currency})
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={purchaseDraft.totalCost}
                  onChange={(event) => setPurchaseDraft((current) => ({ ...current, totalCost: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-bold text-gray-600">
                Supplier
                <input
                  value={purchaseDraft.supplier}
                  onChange={(event) => setPurchaseDraft((current) => ({ ...current, supplier: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="Optional"
                />
              </label>
            </div>
            <label className="mt-3 block text-xs font-bold text-gray-600">
              Note
              <input
                value={purchaseDraft.notes}
                onChange={(event) => setPurchaseDraft((current) => ({ ...current, notes: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Invoice number, price change, delivery issue, etc."
              />
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setShowPurchaseForm(false)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold">Cancel</button>
              <button type="button" disabled={savingKey !== null} onClick={() => void addPurchase()} className="rounded-lg bg-black px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Save purchase</button>
            </div>
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase text-gray-400">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Ingredient</th>
                <th className="px-3 py-2 text-right">Packs</th>
                <th className="px-3 py-2 text-right">Base quantity</th>
                <th className="px-3 py-2 text-right">Total cost</th>
                <th className="px-3 py-2">Supplier / note</th>
                {editable && <th className="px-3 py-2 text-right">Action</th>}
              </tr>
            </thead>
            <tbody>
              {purchases.map((purchase) => {
                const ingredient = ingredientById.get(purchase.ingredientId);
                const profile = activeProfiles.find((row) => row.ingredientId === purchase.ingredientId);
                return (
                  <tr key={purchase.id} className="border-b border-gray-100">
                    <td className="px-3 py-3 font-bold">{purchase.purchaseDate}</td>
                    <td className="px-3 py-3">{ingredient?.name ?? purchase.ingredientId}</td>
                    <td className="px-3 py-3 text-right">{formatAmount(purchase.packages, 3)} {profile?.purchaseUnit ?? 'pack'}</td>
                    <td className="px-3 py-3 text-right">{formatAmount(purchase.baseQuantity, 3)} {ingredient?.unit ?? ''}</td>
                    <td className="px-3 py-3 text-right font-bold">{purchase.currency} {formatAmount(purchase.totalCost)}</td>
                    <td className="px-3 py-3 text-xs text-gray-500">{[purchase.supplier, purchase.notes].filter(Boolean).join(' · ') || '—'}</td>
                    {editable && (
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          aria-label={`Delete purchase ${purchase.purchaseDate} ${ingredient?.name ?? purchase.ingredientId}`}
                          disabled={savingKey !== null}
                          onClick={() => void deletePurchase(purchase)}
                          className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {purchases.length === 0 && (
                <tr><td colSpan={editable ? 7 : 6} className="px-3 py-8 text-center text-sm text-gray-400">No purchases entered for this month.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div>
          <h3 className="font-extrabold">3. Monthly Inventory Count</h3>
          <p className="mt-1 text-xs text-gray-500">
            Opening + purchases + adjustment − closing = actual quantity used. Waste is recorded separately for diagnosis.
          </p>
        </div>

        <div className="mt-4 space-y-3">
          {activeProfiles.map((profile) => {
            const ingredient = ingredientById.get(profile.ingredientId);
            const row = inventoryRows[profile.ingredientId] ?? emptyInventoryRow(store.id, profile.ingredientId, monthStart);
            const purchasedQuantity = purchasedQuantityByIngredient.get(profile.ingredientId) ?? 0;
            const actualUsage = row.openingQuantity + purchasedQuantity + row.adjustmentQuantity - row.closingQuantity;
            const invalidUsage = actualUsage < 0 || row.wasteQuantity > Math.max(0, actualUsage);
            return (
              <div key={profile.ingredientId} className={`rounded-xl border p-4 ${invalidUsage ? 'border-red-200 bg-red-50' : row.countComplete ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200'}`}>
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
                  <div className="min-w-[180px] xl:w-48">
                    <div className="text-sm font-extrabold">{ingredient?.name ?? profile.ingredientId}</div>
                    <div className="mt-1 text-xs text-gray-500">Base unit: {ingredient?.unit ?? 'unit'}</div>
                    <div className={`mt-2 text-xs font-bold ${invalidUsage ? 'text-red-700' : 'text-gray-700'}`}>
                      Calculated use: {formatAmount(actualUsage, 3)} {ingredient?.unit ?? ''}
                    </div>
                  </div>
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <label className="text-xs font-bold text-gray-600">
                      Opening
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={row.openingQuantity}
                        disabled={!editable}
                        onChange={(event) => updateInventoryDraft(profile.ingredientId, { openingQuantity: Number(event.target.value) })}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50"
                      />
                    </label>
                    <label className="text-xs font-bold text-gray-600">
                      Purchased
                      <input
                        value={formatAmount(purchasedQuantity, 3)}
                        disabled
                        className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-xs font-bold text-gray-600">
                      Waste
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={row.wasteQuantity}
                        disabled={!editable}
                        onChange={(event) => updateInventoryDraft(profile.ingredientId, { wasteQuantity: Number(event.target.value) })}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50"
                      />
                    </label>
                    <label className="text-xs font-bold text-gray-600">
                      Adjustment (+/−)
                      <input
                        type="number"
                        step="0.001"
                        value={row.adjustmentQuantity}
                        disabled={!editable}
                        onChange={(event) => updateInventoryDraft(profile.ingredientId, { adjustmentQuantity: Number(event.target.value) })}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50"
                      />
                    </label>
                    <label className="text-xs font-bold text-gray-600">
                      Closing
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={row.closingQuantity}
                        disabled={!editable}
                        onChange={(event) => updateInventoryDraft(profile.ingredientId, { closingQuantity: Number(event.target.value) })}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50"
                      />
                    </label>
                    <label className="text-xs font-bold text-gray-600">
                      Note
                      <input
                        value={row.notes}
                        disabled={!editable}
                        onChange={(event) => updateInventoryDraft(profile.ingredientId, { notes: event.target.value })}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50"
                        placeholder="Optional"
                      />
                    </label>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-black/5 pt-3">
                  <div className="flex items-center gap-2">
                    {invalidUsage
                      ? <AlertTriangle className="h-4 w-4 text-red-600" />
                      : row.countComplete
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                        : <ClipboardList className="h-4 w-4 text-gray-400" />}
                    <label className={`flex items-center gap-2 text-xs font-bold ${editable ? 'cursor-pointer' : ''}`}>
                      <input
                        type="checkbox"
                        checked={row.countComplete}
                        disabled={!editable || invalidUsage}
                        onChange={(event) => updateInventoryDraft(profile.ingredientId, { countComplete: event.target.checked })}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      Physical count complete
                    </label>
                    {invalidUsage && <span className="text-xs font-bold text-red-700">Check closing stock or waste quantity.</span>}
                  </div>
                  {editable && (
                    <button
                      type="button"
                      disabled={savingKey !== null || invalidUsage}
                      onClick={() => void saveInventoryRow(profile.ingredientId)}
                      className="inline-flex items-center gap-1 rounded-lg bg-black px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                    >
                      <Save className="h-4 w-4" /> Save count
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {activeProfiles.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
              Configure ingredients first, then monthly count rows will appear here.
            </div>
          )}
        </div>
      </section>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <div className="font-extrabold text-blue-900">Next calculation after this data is complete</div>
        <p className="mt-1 text-sm text-blue-800">
          Update 6 will value opening stock, purchases, and closing stock to calculate actual food cost and actual cost percentage.
          It will not use the old estimated real-time stock figure.
        </p>
      </div>

      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{notice}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
    </div>
  );
};

export default CostInventoryWorkspace;
