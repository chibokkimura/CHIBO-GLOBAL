import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChefHat,
  ClipboardList,
  Gauge,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  Target,
  Trash2,
  TrendingDown,
  Warehouse,
} from 'lucide-react';
import { Ingredient, Menu, Sale, SetMenu, Store } from './types';
import { supabase } from './supabaseClient';
import { buildTheoreticalCostAnalysis } from './theoreticalCost';

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
  openingUnitCost: number;
  wasteQuantity: number;
  adjustmentQuantity: number;
  closingQuantity: number;
  closingUnitCost: number;
  countComplete: boolean;
  notes: string;
};

type CostControl = {
  targetCostPercentage: number | null;
  netSalesOverride: number | null;
  notes: string;
};

type PreviousCostSummary = {
  actualCostPercentage: number | null;
  actualCost: number;
  netSales: number;
  inventoryComplete: boolean;
};

type Props = {
  store: Store;
  ingredients: Ingredient[];
  menus: Menu[];
  setMenus: SetMenu[];
  sales: Sale[];
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

function adjacentMonthKey(monthKey: string, offset: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
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
    openingUnitCost: Number(row.opening_unit_cost ?? 0),
    wasteQuantity: Number(row.waste_quantity ?? 0),
    adjustmentQuantity: Number(row.adjustment_quantity ?? 0),
    closingQuantity: Number(row.closing_quantity ?? 0),
    closingUnitCost: Number(row.closing_unit_cost ?? 0),
    countComplete: Boolean(row.count_complete),
    notes: row.notes ?? '',
  };
}

function emptyInventoryRow(
  storeId: string,
  ingredientId: string,
  monthStart: string,
  openingUnitCost = 0,
): InventoryRow {
  return {
    storeId,
    ingredientId,
    monthStart,
    openingQuantity: 0,
    openingUnitCost,
    wasteQuantity: 0,
    adjustmentQuantity: 0,
    closingQuantity: 0,
    closingUnitCost: openingUnitCost,
    countComplete: false,
    notes: '',
  };
}

const CostInventoryWorkspace: React.FC<Props> = ({
  store,
  ingredients,
  menus,
  setMenus,
  sales,
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
  const [costControl, setCostControl] = useState<CostControl>({
    targetCostPercentage: null,
    netSalesOverride: null,
    notes: '',
  });
  const [previousClosingCosts, setPreviousClosingCosts] = useState<Record<string, number>>({});
  const [previousCostSummary, setPreviousCostSummary] = useState<PreviousCostSummary | null>(null);
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
  const previousMonthKey = adjacentMonthKey(monthKey, -1);
  const previousMonthStart = `${previousMonthKey}-01`;
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

  const purchaseCostByIngredient = useMemo(() => {
    const totals = new Map<string, number>();
    purchases.forEach((purchase) => {
      totals.set(
        purchase.ingredientId,
        (totals.get(purchase.ingredientId) ?? 0) + purchase.totalCost,
      );
    });
    return totals;
  }, [purchases]);

  const purchaseTotal = useMemo(
    () => purchases.reduce((sum, purchase) => sum + purchase.totalCost, 0),
    [purchases],
  );
  const completedCounts = activeProfiles.filter((profile) => inventoryRows[profile.ingredientId]?.countComplete).length;
  const reportedSales = useMemo(
    () => sales
      .filter((sale) => sale.storeId === store.id && sale.date.startsWith(`${monthKey}-`))
      .reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0),
    [monthKey, sales, store.id],
  );
  const netSales = costControl.netSalesOverride ?? reportedSales;
  const costBreakdown = useMemo(() => activeProfiles.map((profile) => {
    const ingredient = ingredientById.get(profile.ingredientId);
    const row = inventoryRows[profile.ingredientId]
      ?? emptyInventoryRow(store.id, profile.ingredientId, monthStart);
    const purchasedQuantity = purchasedQuantityByIngredient.get(profile.ingredientId) ?? 0;
    const ingredientPurchaseCost = purchaseCostByIngredient.get(profile.ingredientId) ?? 0;
    const openingValue = row.openingQuantity * row.openingUnitCost;
    const availableQuantity = row.openingQuantity + purchasedQuantity;
    const availableValue = openingValue + ingredientPurchaseCost;
    const fallbackUnitCost = profile.contentQuantity > 0
      ? profile.currentPackPrice / profile.contentQuantity
      : 0;
    const closingUnitCost = availableQuantity > 0
      ? availableValue / availableQuantity
      : (row.openingUnitCost || fallbackUnitCost);
    const closingValue = row.closingQuantity * closingUnitCost;
    const actualCost = openingValue + ingredientPurchaseCost - closingValue;
    const actualUsage = row.openingQuantity + purchasedQuantity + row.adjustmentQuantity - row.closingQuantity;
    return {
      ingredientId: profile.ingredientId,
      ingredientName: ingredient?.name ?? profile.ingredientId,
      unit: ingredient?.unit ?? '',
      openingValue,
      purchaseCost: ingredientPurchaseCost,
      closingValue,
      actualCost,
      closingUnitCost,
      wasteValue: row.wasteQuantity * closingUnitCost,
      actualUsage,
      invalid: actualUsage < 0 || row.wasteQuantity > Math.max(0, actualUsage) || actualCost < 0,
    };
  }), [
    activeProfiles,
    ingredientById,
    inventoryRows,
    monthStart,
    purchaseCostByIngredient,
    purchasedQuantityByIngredient,
    store.id,
  ]);
  const openingInventoryValue = costBreakdown.reduce((sum, row) => sum + row.openingValue, 0);
  const closingInventoryValue = costBreakdown.reduce((sum, row) => sum + row.closingValue, 0);
  const actualCost = openingInventoryValue + purchaseTotal - closingInventoryValue;
  const actualCostPercentage = netSales > 0 ? (actualCost / netSales) * 100 : null;
  const targetVariance = actualCostPercentage !== null && costControl.targetCostPercentage !== null
    ? actualCostPercentage - costControl.targetCostPercentage
    : null;
  const inventoryComplete = activeProfiles.length > 0
    && completedCounts === activeProfiles.length
    && costBreakdown.every((row) => !row.invalid);
  const previousRateDelta = inventoryComplete
    && previousCostSummary?.inventoryComplete
    && actualCostPercentage !== null
    && previousCostSummary.actualCostPercentage != null
    ? actualCostPercentage - previousCostSummary.actualCostPercentage
    : null;
  const totalWasteValue = costBreakdown.reduce((sum, row) => sum + row.wasteValue, 0);
  const rateTone = actualCostPercentage === null || !inventoryComplete
    ? 'border-gray-200 bg-white text-gray-900'
    : targetVariance === null
      ? 'border-blue-200 bg-blue-50 text-blue-900'
      : targetVariance <= 0
        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
        : targetVariance <= 2
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-red-200 bg-red-50 text-red-900';
  const ingredientCostInputs = useMemo(() => new Map(costBreakdown.map((row) => [
    row.ingredientId,
    {
      unitCost: Number.isFinite(row.closingUnitCost) ? row.closingUnitCost : null,
      actualUsage: Number.isFinite(row.actualUsage) ? row.actualUsage : null,
      wasteQuantity: inventoryRows[row.ingredientId]?.wasteQuantity ?? 0,
    },
  ])), [costBreakdown, inventoryRows]);
  const theoreticalAnalysis = useMemo(() => buildTheoreticalCostAnalysis({
    storeId: store.id,
    monthKey,
    sales,
    menus,
    setMenus,
    ingredientCosts: ingredientCostInputs,
  }), [ingredientCostInputs, menus, monthKey, sales, setMenus, store.id]);
  const theoreticalCostPercentage = netSales > 0
    ? (theoreticalAnalysis.theoreticalCost / netSales) * 100
    : null;
  const actualVsTheoreticalGap = actualCost - theoreticalAnalysis.theoreticalCost;
  const varianceAnalysisReady = inventoryComplete && theoreticalAnalysis.analysisReady;
  const recipeBlockerCount = theoreticalAnalysis.soldMenuRowsMissingRecipe
    + theoreticalAnalysis.soldMenuRowsMissingCost
    + (theoreticalAnalysis.unknownDirectUnits > 0 ? 1 : 0)
    + (theoreticalAnalysis.unknownCourseSalesUnits > 0 ? 1 : 0)
    + (theoreticalAnalysis.setsWithoutComponentsUnits > 0 ? 1 : 0)
    + (theoreticalAnalysis.categoryBreakdownMismatchUnits > 0 ? 1 : 0);

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
        ...emptyInventoryRow(
          store.id,
          profile.ingredientId,
          monthStart,
          profile.contentQuantity > 0 ? profile.currentPackPrice / profile.contentQuantity : 0,
        ),
        openingQuantity: index === 0 ? 8000 : 2000,
        wasteQuantity: index === 0 ? 250 : 0,
        closingQuantity: index === 0 ? 4200 : 1500,
        countComplete: index === 0,
      },
    ]));
    setProfiles(nextProfiles);
    setPurchases(nextPurchases);
    setInventoryRows(nextInventory);
    setCostControl({
      targetCostPercentage: 30,
      netSalesOverride: null,
      notes: 'Preview target',
    });
    setPreviousClosingCosts(Object.fromEntries(nextProfiles.map((profile) => [
      profile.ingredientId,
      profile.contentQuantity > 0 ? profile.currentPackPrice / profile.contentQuantity : 0,
    ])));
    setPreviousCostSummary({
      actualCostPercentage: 31.8,
      actualCost: 28620,
      netSales: 90000,
      inventoryComplete: true,
    });
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
      const [
        profileResult,
        purchaseResult,
        inventoryResult,
        controlResult,
        previousInventoryResult,
        previousSummaryResult,
      ] = await Promise.all([
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
          .select('store_id,ingredient_id,month_start,opening_quantity,opening_unit_cost,waste_quantity,adjustment_quantity,closing_quantity,closing_unit_cost,count_complete,notes')
          .eq('store_id', store.id)
          .eq('month_start', monthStart),
        supabase
          .from('monthly_cost_controls')
          .select('target_cost_percentage,net_sales_override,notes')
          .eq('store_id', store.id)
          .eq('month_start', monthStart)
          .maybeSingle(),
        supabase
          .from('monthly_ingredient_inventory')
          .select('ingredient_id,closing_unit_cost')
          .eq('store_id', store.id)
          .eq('month_start', previousMonthStart),
        supabase
          .from('monthly_actual_cost_summary')
          .select('actual_cost_percentage,actual_cost,net_sales,inventory_complete')
          .eq('store_id', store.id)
          .eq('month_start', previousMonthStart)
          .maybeSingle(),
      ]);

      const firstError = profileResult.error
        || purchaseResult.error
        || inventoryResult.error
        || controlResult.error
        || previousInventoryResult.error
        || previousSummaryResult.error;
      if (firstError) throw firstError;

      const nextProfiles = (profileResult.data ?? []).map(mapProfile);
      const nextPreviousClosingCosts = Object.fromEntries(
        (previousInventoryResult.data ?? []).map((row: any) => [
          row.ingredient_id,
          Number(row.closing_unit_cost ?? 0),
        ]),
      );
      const nextInventoryRows = Object.fromEntries(
        (inventoryResult.data ?? []).map((row: any) => {
          const mapped = mapInventory(row);
          return [mapped.ingredientId, mapped];
        }),
      );
      nextProfiles.forEach((profile) => {
        if (!nextInventoryRows[profile.ingredientId]) {
          const currentUnitCost = profile.contentQuantity > 0
            ? profile.currentPackPrice / profile.contentQuantity
            : 0;
          nextInventoryRows[profile.ingredientId] = emptyInventoryRow(
            store.id,
            profile.ingredientId,
            monthStart,
            nextPreviousClosingCosts[profile.ingredientId] || currentUnitCost,
          );
        }
      });

      setProfiles(nextProfiles);
      setPurchases((purchaseResult.data ?? []).map(mapPurchase));
      setInventoryRows(nextInventoryRows);
      setPreviousClosingCosts(nextPreviousClosingCosts);
      setCostControl({
        targetCostPercentage: controlResult.data?.target_cost_percentage == null
          ? null
          : Number(controlResult.data.target_cost_percentage),
        netSalesOverride: controlResult.data?.net_sales_override == null
          ? null
          : Number(controlResult.data.net_sales_override),
        notes: controlResult.data?.notes ?? '',
      });
      setPreviousCostSummary(previousSummaryResult.data ? {
        actualCostPercentage: previousSummaryResult.data.actual_cost_percentage == null
          ? null
          : Number(previousSummaryResult.data.actual_cost_percentage),
        actualCost: Number(previousSummaryResult.data.actual_cost ?? 0),
        netSales: Number(previousSummaryResult.data.net_sales ?? 0),
        inventoryComplete: Boolean(previousSummaryResult.data.inventory_complete),
      } : null);
    } catch (loadError: any) {
      console.error('Failed to load cost and inventory data', loadError);
      const message = String(loadError?.message ?? '');
      setError(
        message.toLowerCase().includes('could not find the table')
          ? 'The cost-management database tables are not active yet. Apply the latest Phase 5 and 6 migrations, then reload.'
          : (message || 'Failed to load cost and inventory data.'),
      );
    } finally {
      setLoading(false);
    }
  }, [monthEnd, monthStart, preview, previousMonthStart, seedPreview, store.id]);

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

  const saveCostControl = async () => {
    if (
      costControl.targetCostPercentage !== null
      && (costControl.targetCostPercentage < 0 || costControl.targetCostPercentage > 100)
    ) {
      setError('Target cost percentage must be between 0 and 100.');
      return;
    }
    if (costControl.netSalesOverride !== null && costControl.netSalesOverride < 0) {
      setError('Net sales override cannot be negative.');
      return;
    }

    setSavingKey('cost-control');
    setError(null);
    setNotice(null);
    try {
      if (!preview) {
        const authUser = (await supabase.auth.getUser()).data.user?.id ?? null;
        const { error: saveError } = await supabase
          .from('monthly_cost_controls')
          .upsert({
            store_id: store.id,
            month_start: monthStart,
            target_cost_percentage: costControl.targetCostPercentage,
            net_sales_override: costControl.netSalesOverride,
            notes: costControl.notes.trim() || null,
            created_by: authUser,
            updated_by: authUser,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'store_id,month_start' });
        if (saveError) throw saveError;
      }
      setNotice('Monthly cost settings saved.');
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Failed to save monthly cost settings.');
    } finally {
      setSavingKey(null);
    }
  };

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

  const invalidateInventoryCount = async (ingredientId: string) => {
    setInventoryRows((current) => ({
      ...current,
      [ingredientId]: {
        ...(current[ingredientId]
          ?? emptyInventoryRow(store.id, ingredientId, monthStart)),
        countComplete: false,
      },
    }));
    if (!preview) {
      const { error: invalidateError } = await supabase
        .from('monthly_ingredient_inventory')
        .update({
          count_complete: false,
          updated_at: new Date().toISOString(),
        })
        .eq('store_id', store.id)
        .eq('ingredient_id', ingredientId)
        .eq('month_start', monthStart);
      if (invalidateError) throw invalidateError;
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

      await invalidateInventoryCount(next.ingredientId);
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
      await invalidateInventoryCount(purchase.ingredientId);
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
      || row.openingUnitCost < 0
      || row.wasteQuantity < 0
      || row.closingQuantity < 0
      || !Number.isFinite(row.adjustmentQuantity)
    ) {
      setError('Inventory quantities and unit costs must be valid and cannot be negative.');
      return;
    }
    if (row.openingQuantity > 0 && row.openingUnitCost <= 0) {
      setError('Enter the opening unit cost before completing this ingredient count.');
      return;
    }

    const costRow = costBreakdown.find((item) => item.ingredientId === ingredientId);
    if (!costRow || costRow.invalid) {
      setError('Check the quantities and valuation before saving this ingredient count.');
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
            opening_unit_cost: row.openingUnitCost,
            waste_quantity: row.wasteQuantity,
            adjustment_quantity: row.adjustmentQuantity,
            closing_quantity: row.closingQuantity,
            closing_unit_cost: costRow.closingUnitCost,
            count_complete: row.countComplete,
            notes: row.notes.trim() || null,
            created_by: authUser,
            updated_by: authUser,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'store_id,ingredient_id,month_start' })
          .select('store_id,ingredient_id,month_start,opening_quantity,opening_unit_cost,waste_quantity,adjustment_quantity,closing_quantity,closing_unit_cost,count_complete,notes')
          .single();
        if (saveError) throw saveError;
        const saved = mapInventory(data);
        setInventoryRows((current) => ({ ...current, [ingredientId]: saved }));
      }
      setInventoryRows((current) => ({
        ...current,
        [ingredientId]: {
          ...(current[ingredientId] ?? row),
          closingUnitCost: costRow.closingUnitCost,
        },
      }));
      setNotice('Monthly inventory count and valuation saved.');
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
          <h2 className="mt-1 text-2xl font-extrabold">Actual Cost, Purchases & Inventory</h2>
          <p className="mt-1 text-sm text-gray-500">
            {mode === 'hq'
              ? 'Review actual cost, targets, purchase setup, and completed stock counts for this store.'
              : 'Record purchases and physical stock counts to calculate the actual food cost rate.'}
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

      <section className={`rounded-2xl border p-5 ${rateTone}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] opacity-70">
              <Calculator className="h-4 w-4" /> Actual food cost
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1">
              <div className="text-3xl font-extrabold">
                {actualCostPercentage === null ? '—' : `${formatAmount(actualCostPercentage, 1)}%`}
              </div>
              <div className="pb-1 text-sm font-bold">
                {store.currency} {formatAmount(actualCost)}
              </div>
            </div>
            <div className="mt-2 text-sm">
              {!inventoryComplete
                ? `Draft calculation · ${completedCounts}/${activeProfiles.length} inventory counts complete`
                : targetVariance === null
                  ? 'Inventory is complete. Set a target cost percentage to evaluate performance.'
                  : targetVariance <= 0
                    ? `${formatAmount(Math.abs(targetVariance), 1)} percentage point(s) below target`
                    : `${formatAmount(targetVariance, 1)} percentage point(s) above target`}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {costControl.targetCostPercentage !== null && (
              <div className="rounded-xl border border-current/15 bg-white/70 px-3 py-2 text-xs font-bold">
                Target {formatAmount(costControl.targetCostPercentage, 1)}%
              </div>
            )}
            {previousRateDelta !== null && (
              <div className="inline-flex items-center gap-1 rounded-xl border border-current/15 bg-white/70 px-3 py-2 text-xs font-bold">
                {previousRateDelta <= 0
                  ? <ArrowDownRight className="h-4 w-4" />
                  : <ArrowUpRight className="h-4 w-4" />}
                {previousRateDelta > 0 ? '+' : ''}{formatAmount(previousRateDelta, 1)} pt vs prior month
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            ['Net sales', netSales, costControl.netSalesOverride !== null ? 'Manual override' : 'Daily reports'],
            ['Opening stock', openingInventoryValue, 'Quantity × opening unit cost'],
            ['Purchases', purchaseTotal, `${purchases.length} entries`],
            ['Closing stock', closingInventoryValue, 'Quantity × moving average'],
            ['Waste value', totalWasteValue, 'Recorded waste estimate'],
          ].map(([label, amount, description]) => (
            <div key={String(label)} className="rounded-xl border border-black/10 bg-white/80 p-3">
              <div className="text-[11px] font-bold uppercase text-gray-500">{label}</div>
              <div className="mt-1 text-base font-extrabold text-gray-900">
                {store.currency} {formatAmount(Number(amount))}
              </div>
              <div className="mt-1 text-[10px] text-gray-500">{description}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-black/10 bg-white/80 p-4 md:grid-cols-2 xl:grid-cols-[160px_220px_1fr_auto]">
          <label className="text-xs font-bold text-gray-600">
            Target cost %
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={costControl.targetCostPercentage ?? ''}
              onChange={(event) => setCostControl((current) => ({
                ...current,
                targetCostPercentage: event.target.value === '' ? null : Number(event.target.value),
              }))}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
              placeholder="e.g. 30"
            />
          </label>
          <label className="text-xs font-bold text-gray-600">
            Net sales override ({store.currency})
            <input
              type="number"
              min="0"
              step="0.01"
              value={costControl.netSalesOverride ?? ''}
              onChange={(event) => setCostControl((current) => ({
                ...current,
                netSalesOverride: event.target.value === '' ? null : Number(event.target.value),
              }))}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
              placeholder={`Reported: ${formatAmount(reportedSales)}`}
            />
          </label>
          <label className="text-xs font-bold text-gray-600">
            Monthly note
            <input
              value={costControl.notes}
              onChange={(event) => setCostControl((current) => ({ ...current, notes: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
              placeholder="Tax exclusion, unusual purchase, stock issue, etc."
            />
          </label>
          <button
            type="button"
            disabled={savingKey !== null}
            onClick={() => void saveCostControl()}
            className="self-end rounded-lg bg-black px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            Save settings
          </button>
        </div>
        <div className="mt-2 text-[11px] opacity-70">
          Formula: opening stock value + purchases − closing stock value. Blank net sales override uses reported daily sales.
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ChefHat className="h-5 w-5" />
              <h3 className="font-extrabold">Theoretical Recipe Cost & Usage Gap</h3>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Direct item sales and course components are expanded through each recipe. Course ingredients are counted once, not duplicated.
            </p>
          </div>
          <div className={`rounded-xl px-3 py-2 text-xs font-bold ${
            varianceAnalysisReady
              ? actualVsTheoreticalGap <= 0
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-red-50 text-red-700'
              : 'bg-amber-50 text-amber-800'
          }`}>
            {varianceAnalysisReady
              ? actualVsTheoreticalGap <= 0
                ? 'Actual usage is within the recipe plan'
                : `${store.currency} ${formatAmount(actualVsTheoreticalGap)} actual cost above theory`
              : `${recipeBlockerCount} recipe/cost issue(s) · inventory ${completedCounts}/${activeProfiles.length}`}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <div className="rounded-xl border border-gray-200 p-4">
            <div className="text-[11px] font-bold uppercase text-gray-500">Recipe sales coverage</div>
            <div className="mt-1 text-2xl font-extrabold">
              {theoreticalAnalysis.recipeCoveragePercentage === null
                ? '—'
                : `${formatAmount(theoreticalAnalysis.recipeCoveragePercentage, 1)}%`}
            </div>
            <div className="mt-1 text-[10px] text-gray-500">
              {formatAmount(theoreticalAnalysis.recipeCoveredUnits, 1)} / {formatAmount(theoreticalAnalysis.totalKnownMenuUnits + theoreticalAnalysis.categoryBreakdownMismatchUnits, 1)} sold item units
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4">
            <div className="text-[11px] font-bold uppercase text-gray-500">Costed sales coverage</div>
            <div className="mt-1 text-2xl font-extrabold">
              {theoreticalAnalysis.costCoveragePercentage === null
                ? '—'
                : `${formatAmount(theoreticalAnalysis.costCoveragePercentage, 1)}%`}
            </div>
            <div className="mt-1 text-[10px] text-gray-500">Recipe ingredients with a usable unit cost</div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4">
            <div className="text-[11px] font-bold uppercase text-gray-500">Theoretical food cost</div>
            <div className="mt-1 text-2xl font-extrabold">
              {store.currency} {formatAmount(theoreticalAnalysis.theoreticalCost)}
            </div>
            <div className="mt-1 text-[10px] text-gray-500">
              {theoreticalCostPercentage === null ? 'No net sales' : `${formatAmount(theoreticalCostPercentage, 1)}% of net sales`}
              {!theoreticalAnalysis.analysisReady ? ' · partial' : ''}
            </div>
          </div>
          <div className={`rounded-xl border p-4 ${
            varianceAnalysisReady && actualVsTheoreticalGap > 0
              ? 'border-red-200 bg-red-50'
              : varianceAnalysisReady
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-amber-200 bg-amber-50'
          }`}>
            <div className="text-[11px] font-bold uppercase text-gray-500">Actual − theoretical</div>
            <div className="mt-1 text-2xl font-extrabold">
              {varianceAnalysisReady
                ? `${actualVsTheoreticalGap > 0 ? '+' : ''}${store.currency} ${formatAmount(actualVsTheoreticalGap)}`
                : 'Draft'}
            </div>
            <div className="mt-1 text-[10px] text-gray-500">
              Complete recipes, costs, and stock counts before using this gap
            </div>
          </div>
        </div>

        {!theoreticalAnalysis.analysisReady && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-sm font-extrabold text-amber-900">
              <AlertTriangle className="h-4 w-4" /> Finish these items before treating theoretical cost as final
            </div>
            <div className="mt-2 grid gap-1 text-xs text-amber-800 md:grid-cols-2">
              {theoreticalAnalysis.totalKnownMenuUnits === 0 && <div>• No item or course quantities were reported for this month.</div>}
              {theoreticalAnalysis.soldMenuRowsMissingRecipe > 0 && <div>• {theoreticalAnalysis.soldMenuRowsMissingRecipe} sold menu item(s) have no complete recipe.</div>}
              {theoreticalAnalysis.soldMenuRowsMissingCost > 0 && <div>• {theoreticalAnalysis.soldMenuRowsMissingCost} sold menu item(s) use ingredients without unit cost.</div>}
              {theoreticalAnalysis.unknownDirectUnits > 0 && <div>• {formatAmount(theoreticalAnalysis.unknownDirectUnits, 1)} direct-sale unit(s) no longer match a menu.</div>}
              {theoreticalAnalysis.unknownCourseSalesUnits > 0 && <div>• {formatAmount(theoreticalAnalysis.unknownCourseSalesUnits, 1)} course/component unit(s) cannot be matched.</div>}
              {theoreticalAnalysis.setsWithoutComponentsUnits > 0 && <div>• {formatAmount(theoreticalAnalysis.setsWithoutComponentsUnits, 1)} sold course unit(s) have no components.</div>}
              {theoreticalAnalysis.categoryBreakdownMismatchUnits > 0 && <div>• {formatAmount(theoreticalAnalysis.categoryBreakdownMismatchUnits, 1)} direct unit(s) do not match the category-to-menu breakdown.</div>}
            </div>
          </div>
        )}

        <div className="mt-5">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-gray-500" />
            <h4 className="text-sm font-extrabold">Ingredient usage diagnosis</h4>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="border-b border-gray-200 text-[11px] uppercase text-gray-400">
                <tr>
                  <th className="px-3 py-2">Ingredient</th>
                  <th className="px-3 py-2 text-right">Recipe usage</th>
                  <th className="px-3 py-2 text-right">Actual usage</th>
                  <th className="px-3 py-2 text-right">Usage gap</th>
                  <th className="px-3 py-2 text-right">Gap value</th>
                  <th className="px-3 py-2">What to check</th>
                </tr>
              </thead>
              <tbody>
                {theoreticalAnalysis.ingredientRows.map((row) => {
                  const ingredient = ingredientById.get(row.ingredientId);
                  const gapHigh = row.variancePercentage !== null && row.variancePercentage > 10;
                  const gapLow = row.variancePercentage !== null && row.variancePercentage < -10;
                  const action = row.unitCost === null
                    ? 'Set purchase unit and price'
                    : !inventoryComplete || row.actualUsage === null
                      ? 'Complete monthly stock count'
                      : gapHigh && row.wasteQuantity > 0
                        ? 'Check recorded waste and over-portioning'
                        : gapHigh
                          ? 'Check waste, portions, theft, or recipe quantity'
                          : gapLow
                            ? 'Check recipe quantity or physical count'
                            : row.wasteQuantity > 0
                              ? 'Review recorded waste'
                              : 'Near recipe plan';
                  return (
                    <tr key={row.ingredientId} className={`border-b border-gray-100 ${gapHigh && inventoryComplete ? 'bg-red-50' : ''}`}>
                      <td className="px-3 py-3">
                        <div className="font-bold">{ingredient?.name ?? row.ingredientId}</div>
                        <div className="text-[10px] text-gray-400">{ingredient?.unit ?? 'unit'}</div>
                      </td>
                      <td className="px-3 py-3 text-right">{formatAmount(row.theoreticalUsage, 3)}</td>
                      <td className="px-3 py-3 text-right">{row.actualUsage === null ? '—' : formatAmount(row.actualUsage, 3)}</td>
                      <td className="px-3 py-3 text-right font-bold">
                        {row.usageVariance === null
                          ? '—'
                          : `${row.usageVariance > 0 ? '+' : ''}${formatAmount(row.usageVariance, 3)}`}
                        {row.variancePercentage !== null && (
                          <div className="text-[10px] text-gray-400">
                            {row.variancePercentage > 0 ? '+' : ''}{formatAmount(row.variancePercentage, 1)}%
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {row.varianceValue === null
                          ? '—'
                          : `${row.varianceValue > 0 ? '+' : ''}${formatAmount(row.varianceValue)}`}
                      </td>
                      <td className={`px-3 py-3 text-xs font-bold ${gapHigh && inventoryComplete ? 'text-red-700' : 'text-gray-600'}`}>
                        {action}
                      </td>
                    </tr>
                  );
                })}
                {theoreticalAnalysis.ingredientRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-400">
                      Enter sold-item quantities and menu recipes to calculate theoretical ingredient usage.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6">
          <h4 className="text-sm font-extrabold">Sold menu profitability</h4>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-gray-200 text-[11px] uppercase text-gray-400">
                <tr>
                  <th className="px-3 py-2">Menu</th>
                  <th className="px-3 py-2 text-right">Direct / course units</th>
                  <th className="px-3 py-2">Recipe status</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">Theoretical unit cost</th>
                  <th className="px-3 py-2 text-right">Food cost %</th>
                  <th className="px-3 py-2 text-right">Monthly cost</th>
                </tr>
              </thead>
              <tbody>
                {theoreticalAnalysis.menuRows.map((row) => (
                  <tr key={row.menuId} className={`border-b border-gray-100 ${!row.costReady ? 'bg-amber-50' : ''}`}>
                    <td className="px-3 py-3">
                      <div className="font-bold">{row.name}</div>
                      <div className="text-[10px] text-gray-400">{row.category}</div>
                    </td>
                    <td className="px-3 py-3 text-right">{formatAmount(row.directUnits, 1)} / {formatAmount(row.courseUnits, 1)}</td>
                    <td className="px-3 py-3 text-xs font-bold">
                      {!row.recipeReady
                        ? <span className="text-red-600">Recipe missing</span>
                        : !row.costReady
                          ? <span className="text-amber-700">Unit cost missing</span>
                          : <span className="text-emerald-700">Ready</span>}
                    </td>
                    <td className="px-3 py-3 text-right">{formatAmount(row.price)}</td>
                    <td className="px-3 py-3 text-right">{row.theoreticalUnitCost === null ? '—' : formatAmount(row.theoreticalUnitCost)}</td>
                    <td className="px-3 py-3 text-right">{row.theoreticalCostPercentage === null ? '—' : `${formatAmount(row.theoreticalCostPercentage, 1)}%`}</td>
                    <td className="px-3 py-3 text-right font-bold">{row.monthlyTheoreticalCost === null ? '—' : formatAmount(row.monthlyTheoreticalCost)}</td>
                  </tr>
                ))}
                {theoreticalAnalysis.menuRows.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">No sold menu quantities for this month.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {theoreticalAnalysis.courseRows.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-extrabold">Sold course & set profitability</h4>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-gray-200 text-[11px] uppercase text-gray-400">
                  <tr>
                    <th className="px-3 py-2">Course / set</th>
                    <th className="px-3 py-2 text-right">Sold</th>
                    <th className="px-3 py-2 text-right">Components</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Theoretical unit cost</th>
                    <th className="px-3 py-2 text-right">Food cost %</th>
                    <th className="px-3 py-2 text-right">Monthly cost</th>
                  </tr>
                </thead>
                <tbody>
                  {theoreticalAnalysis.courseRows.map((row) => (
                    <tr key={row.setMenuId} className={`border-b border-gray-100 ${!row.costReady ? 'bg-amber-50' : ''}`}>
                      <td className="px-3 py-3 font-bold">{row.name}</td>
                      <td className="px-3 py-3 text-right">{formatAmount(row.soldUnits, 1)}</td>
                      <td className="px-3 py-3 text-right">{row.componentCount}</td>
                      <td className="px-3 py-3 text-right">{formatAmount(row.price)}</td>
                      <td className="px-3 py-3 text-right">{row.theoreticalUnitCost === null ? '—' : formatAmount(row.theoreticalUnitCost)}</td>
                      <td className="px-3 py-3 text-right">{row.theoreticalCostPercentage === null ? '—' : `${formatAmount(row.theoreticalCostPercentage, 1)}%`}</td>
                      <td className="px-3 py-3 text-right font-bold">{row.monthlyTheoreticalCost === null ? '—' : formatAmount(row.monthlyTheoreticalCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

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
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              <h3 className="font-extrabold">Cost Diagnosis</h3>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              See which ingredients contribute most to actual food cost and what needs attention first.
            </p>
          </div>
          <div className={`rounded-xl px-3 py-2 text-xs font-bold ${
            !inventoryComplete
              ? 'bg-amber-50 text-amber-800'
              : targetVariance !== null && targetVariance > 0
                ? 'bg-red-50 text-red-700'
                : 'bg-emerald-50 text-emerald-700'
          }`}>
            {!inventoryComplete
              ? `Finish ${activeProfiles.length - completedCounts} inventory count(s)`
              : targetVariance === null
                ? 'Set the monthly target'
                : targetVariance > 0
                  ? `Reduce cost by ${store.currency} ${formatAmount((targetVariance / 100) * netSales)} to reach target`
                  : 'Actual cost is within target'}
          </div>
        </div>

        {previousRateDelta !== null && previousRateDelta > 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
            <TrendingDown className="h-4 w-4" />
            Actual cost rate increased {formatAmount(previousRateDelta, 1)} point(s) from {monthLabel(previousMonthKey)}.
            Check high-cost ingredients, waste, and purchase-price changes.
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-gray-200 text-[11px] uppercase text-gray-400">
              <tr>
                <th className="px-3 py-2">Ingredient</th>
                <th className="px-3 py-2 text-right">Opening value</th>
                <th className="px-3 py-2 text-right">Purchases</th>
                <th className="px-3 py-2 text-right">Closing value</th>
                <th className="px-3 py-2 text-right">Actual cost</th>
                <th className="px-3 py-2 text-right">Cost share</th>
                <th className="px-3 py-2 text-right">Waste value</th>
              </tr>
            </thead>
            <tbody>
              {[...costBreakdown]
                .sort((left, right) => right.actualCost - left.actualCost)
                .map((row) => (
                  <tr key={row.ingredientId} className={`border-b border-gray-100 ${row.invalid ? 'bg-red-50' : ''}`}>
                    <td className="px-3 py-3">
                      <div className="font-bold">{row.ingredientName}</div>
                      {row.invalid && <div className="text-[10px] font-bold text-red-600">Check quantity or valuation</div>}
                    </td>
                    <td className="px-3 py-3 text-right">{formatAmount(row.openingValue)}</td>
                    <td className="px-3 py-3 text-right">{formatAmount(row.purchaseCost)}</td>
                    <td className="px-3 py-3 text-right">{formatAmount(row.closingValue)}</td>
                    <td className="px-3 py-3 text-right font-extrabold">{formatAmount(row.actualCost)}</td>
                    <td className="px-3 py-3 text-right">
                      {actualCost > 0 ? `${formatAmount((row.actualCost / actualCost) * 100, 1)}%` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right">{formatAmount(row.wasteValue)}</td>
                  </tr>
                ))}
              {costBreakdown.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">
                    Configure ingredients to start the actual-cost breakdown.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

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
            const valuation = costBreakdown.find((item) => item.ingredientId === profile.ingredientId);
            const invalidUsage = valuation?.invalid ?? (actualUsage < 0 || row.wasteQuantity > Math.max(0, actualUsage));
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
                        onChange={(event) => updateInventoryDraft(profile.ingredientId, {
                          openingQuantity: Number(event.target.value),
                          countComplete: false,
                        })}
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
                        onChange={(event) => updateInventoryDraft(profile.ingredientId, {
                          wasteQuantity: Number(event.target.value),
                          countComplete: false,
                        })}
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
                        onChange={(event) => updateInventoryDraft(profile.ingredientId, {
                          adjustmentQuantity: Number(event.target.value),
                          countComplete: false,
                        })}
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
                        onChange={(event) => updateInventoryDraft(profile.ingredientId, {
                          closingQuantity: Number(event.target.value),
                          countComplete: false,
                        })}
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

                <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3 md:grid-cols-4">
                  <label className="text-xs font-bold text-gray-600">
                    Opening unit cost ({store.currency}/{ingredient?.unit ?? 'unit'})
                    <input
                      type="number"
                      min="0"
                      step="0.000001"
                      value={row.openingUnitCost}
                      disabled={!editable}
                      onChange={(event) => updateInventoryDraft(profile.ingredientId, {
                        openingUnitCost: Number(event.target.value),
                        countComplete: false,
                      })}
                      className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm disabled:bg-gray-100"
                    />
                    <span className="mt-1 block text-[10px] font-normal text-gray-400">
                      {previousClosingCosts[profile.ingredientId] > 0
                        ? `Prior close: ${formatAmount(previousClosingCosts[profile.ingredientId], 6)}`
                        : 'First month: verify supplier unit cost'}
                    </span>
                  </label>
                  <div className="text-xs font-bold text-gray-600">
                    Moving-average closing cost
                    <div className="mt-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900">
                      {formatAmount(valuation?.closingUnitCost ?? 0, 6)}
                    </div>
                    <div className="mt-1 text-[10px] font-normal text-gray-400">Calculated automatically</div>
                  </div>
                  <div className="text-xs font-bold text-gray-600">
                    Opening value
                    <div className="mt-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900">
                      {store.currency} {formatAmount(valuation?.openingValue ?? 0)}
                    </div>
                  </div>
                  <div className="text-xs font-bold text-gray-600">
                    Closing value
                    <div className="mt-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900">
                      {store.currency} {formatAmount(valuation?.closingValue ?? 0)}
                    </div>
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
        <div className="font-extrabold text-blue-900">Next: staff hours and labor cost</div>
        <p className="mt-1 text-sm text-blue-800">
          Recipe usage, course expansion, theoretical food cost, and actual-versus-theoretical variance are now connected.
          The next update will add work hours, overtime, payroll, and labor-cost percentage.
        </p>
      </div>

      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{notice}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
    </div>
  );
};

export default CostInventoryWorkspace;
