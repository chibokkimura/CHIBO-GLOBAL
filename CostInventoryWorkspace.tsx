import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChefHat,
  Gauge,
  Plus,
  RefreshCw,
  Save,
  Target,
  Trash2,
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

type WorkspaceSection = 'summary' | 'purchases' | 'inventory';

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
  const [activeSection, setActiveSection] = useState<WorkspaceSection>('summary');
  const [showMonthlySettings, setShowMonthlySettings] = useState(false);
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
  const [expandedInventoryId, setExpandedInventoryId] = useState<string | null>(null);
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
  const reportedMonthKeys = useMemo(() => new Set(
    sales
      .filter((sale) => sale.storeId === store.id)
      .map((sale) => sale.date.slice(0, 7))
      .filter((key) => /^\d{4}-\d{2}$/.test(key)),
  ), [sales, store.id]);
  const monthOptions = useMemo(() => Array.from(new Set([
    ...createMonthOptions(initialMonthKey),
    ...reportedMonthKeys,
    monthKey,
  ])).sort((left, right) => right.localeCompare(left)), [initialMonthKey, monthKey, reportedMonthKeys]);
  const isTestStore = store.country.trim().toUpperCase() === 'TEST' || store.id.startsWith('TEST_');
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
  const costBreakdownByIngredient = useMemo(
    () => new Map(costBreakdown.map((row) => [row.ingredientId, row])),
    [costBreakdown],
  );
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
  const targetReductionAmount = targetVariance !== null && targetVariance > 0
    ? (targetVariance / 100) * netSales
    : 0;
  const costRateSeries = [
    {
      id: 'actual',
      label: 'Actual',
      value: actualCostPercentage,
      color: targetVariance !== null && targetVariance > 0 ? 'bg-red-500' : 'bg-gray-950',
    },
    {
      id: 'target',
      label: 'Target',
      value: costControl.targetCostPercentage,
      color: 'bg-emerald-500',
    },
    {
      id: 'recipe',
      label: 'Recipe',
      value: theoreticalCostPercentage,
      color: 'bg-indigo-500',
    },
  ];
  const rateChartMaximum = Math.max(
    5,
    Math.ceil(
      Math.max(...costRateSeries.map((series) => series.value ?? 0)) / 5,
    ) * 5,
  );
  const excessCostDrivers = useMemo(
    () => theoreticalAnalysis.ingredientRows
      .filter((row) => row.varianceValue !== null && row.varianceValue > 0)
      .sort((left, right) => (right.varianceValue ?? 0) - (left.varianceValue ?? 0))
      .slice(0, 5),
    [theoreticalAnalysis.ingredientRows],
  );
  const largestDriverValue = Math.max(
    1,
    ...excessCostDrivers.map((row) => row.varianceValue ?? 0),
  );

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
          ? 'The cost-management database is not active yet. Please contact the administrator.'
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

    const costRow = costBreakdownByIngredient.get(ingredientId);
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
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-black tracking-[0.12em] text-gray-400">
            {mode === 'hq' ? 'HQ COST REVIEW' : 'STORE COST INPUT'}
          </div>
          <h2 className="mt-1 text-2xl font-extrabold">Cost, Purchases & Inventory</h2>
          <p className="mt-1 text-sm text-gray-500">
            {mode === 'hq'
              ? 'Review the monthly result first, then inspect the inputs behind it.'
              : 'Record purchases and month-end counts to calculate actual cost and improvement opportunities.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              aria-label="Cost and inventory month"
              value={monthKey}
              onChange={(event) => setMonthKey(event.target.value)}
              className="appearance-none rounded-xl border border-gray-200 bg-white py-2.5 pl-3 pr-9 text-sm font-bold"
            >
              {monthOptions.map((key) => (
                <option key={key} value={key}>
                  {monthLabel(key)}
                  {isTestStore && reportedMonthKeys.has(key) ? ' · TEST DATA' : ''}
                </option>
              ))}
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

      <nav className="flex overflow-x-auto rounded-2xl border border-gray-200 bg-white p-1.5" aria-label="Cost management sections">
        {([
          ['summary', 'Overview'],
          ['purchases', 'Ingredients & Purchases'],
          ['inventory', `Inventory Close ${completedCounts}/${activeProfiles.length}`],
        ] as Array<[WorkspaceSection, string]>).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={activeSection === key}
            onClick={() => setActiveSection(key)}
            className={`whitespace-nowrap rounded-xl px-5 py-2.5 text-sm font-extrabold transition ${
              activeSection === key ? 'bg-black text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-black'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{notice}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

      {activeSection === 'summary' && (
        <>
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-xs font-black tracking-[0.12em] text-gray-400">MONTHLY COST RESULT</div>
                <h3 className="mt-1 text-xl font-extrabold">
                  {inventoryComplete
                    ? targetVariance === null
                      ? 'Inventory is complete · Set a target cost rate'
                      : targetVariance <= 0
                        ? 'Cost is within target'
                        : `${formatAmount(targetVariance, 1)} points above target`
                    : `${activeProfiles.length - completedCounts} inventory count(s) still open`}
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Formula: opening stock value + monthly purchases − closing stock value
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full px-3 py-2 text-xs font-extrabold ${
                  !inventoryComplete
                    ? 'bg-amber-100 text-amber-800'
                    : targetVariance !== null && targetVariance > 0
                      ? 'bg-red-100 text-red-700'
                      : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {!inventoryComplete
                    ? 'IN PROGRESS'
                    : targetVariance !== null && targetVariance > 0
                      ? 'ACTION NEEDED'
                      : 'ON TRACK'}
                </span>
                <button
                  type="button"
                  aria-expanded={showMonthlySettings}
                  onClick={() => setShowMonthlySettings((current) => !current)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold hover:bg-gray-50"
                >
                  Monthly Settings {showMonthlySettings ? 'Close' : 'Open'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl bg-gray-950 p-5 text-white">
                <div className="text-xs font-bold text-gray-400">ACTUAL COST RATE</div>
                <div className="mt-2 text-3xl font-black">
                  {actualCostPercentage === null ? '—' : `${formatAmount(actualCostPercentage, 1)}%`}
                </div>
                <div className="mt-2 text-sm font-bold text-gray-300">
                  Actual cost {store.currency} {formatAmount(actualCost)}
                </div>
              </div>
              <div className="rounded-2xl border border-gray-200 p-5">
                <div className="text-xs font-bold text-gray-500">NET SALES</div>
                <div className="mt-2 text-2xl font-extrabold">{store.currency} {formatAmount(netSales)}</div>
                <div className="mt-2 text-xs text-gray-500">
                  {costControl.netSalesOverride !== null ? 'Manual override applied' : 'From daily sales reports'}
                </div>
              </div>
              <div className="rounded-2xl border border-gray-200 p-5">
                <div className="text-xs font-bold text-gray-500">RECIPE COST RATE</div>
                <div className="mt-2 text-2xl font-extrabold">
                  {theoreticalCostPercentage === null ? '—' : `${formatAmount(theoreticalCostPercentage, 1)}%`}
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Recipe cost {store.currency} {formatAmount(theoreticalAnalysis.theoreticalCost)}
                </div>
              </div>
              <div className={`rounded-2xl border p-5 ${
                varianceAnalysisReady && actualVsTheoreticalGap > 0
                  ? 'border-red-200'
                  : 'border-gray-200'
              }`}>
                <div className="text-xs font-bold text-gray-500">ACTUAL − RECIPE GAP</div>
                <div className={`mt-2 text-2xl font-extrabold ${
                  varianceAnalysisReady && actualVsTheoreticalGap > 0 ? 'text-red-600' : ''
                }`}>
                  {varianceAnalysisReady
                    ? `${actualVsTheoreticalGap > 0 ? '+' : ''}${store.currency} ${formatAmount(actualVsTheoreticalGap)}`
                    : 'Not ready'}
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  {varianceAnalysisReady ? 'Waste, overuse, and price gap' : 'Complete recipes, costs, and inventory'}
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
              {[
                ['Target rate', costControl.targetCostPercentage === null ? 'Not set' : `${formatAmount(costControl.targetCostPercentage, 1)}%`],
                ['Opening stock', `${store.currency} ${formatAmount(openingInventoryValue)}`],
                ['Purchases', `${store.currency} ${formatAmount(purchaseTotal)}`],
                ['Closing stock', `${store.currency} ${formatAmount(closingInventoryValue)}`],
                ['Waste value', `${store.currency} ${formatAmount(totalWasteValue)}`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-gray-50 p-3">
                  <div className="text-[11px] font-bold text-gray-500">{label}</div>
                  <div className="mt-1 text-sm font-extrabold">{value}</div>
                </div>
              ))}
            </div>

            {previousRateDelta !== null && (
              <div className={`mt-4 flex items-center gap-2 rounded-xl p-3 text-sm font-bold ${
                previousRateDelta > 0 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'
              }`}>
                {previousRateDelta <= 0
                  ? <ArrowDownRight className="h-4 w-4" />
                  : <ArrowUpRight className="h-4 w-4" />}
                {formatAmount(Math.abs(previousRateDelta), 1)} points {previousRateDelta > 0 ? 'higher' : 'better'} than last month.
              </div>
            )}

            {showMonthlySettings && (
              <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 md:grid-cols-2 xl:grid-cols-[160px_220px_1fr_auto]">
                <label className="text-xs font-bold text-gray-600">
                  Target cost rate (%)
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
                    className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
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
                    className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
                    placeholder={`Reported: ${formatAmount(reportedSales)}`}
                  />
                </label>
                <label className="text-xs font-bold text-gray-600">
                  Monthly note
                  <input
                    value={costControl.notes}
                    onChange={(event) => setCostControl((current) => ({ ...current, notes: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
                    placeholder="Unusual purchase, stock issue, sales correction, etc."
                  />
                </label>
                <button
                  type="button"
                  disabled={savingKey !== null}
                  onClick={() => void saveCostControl()}
                  className="self-end rounded-lg bg-black px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                >
                  Save Settings
                </button>
              </div>
            )}
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <Gauge className="h-5 w-5" />
                <h3 className="text-lg font-extrabold">Cost Rate Comparison</h3>
              </div>
              <p className="mt-1 text-sm text-gray-500">Actual, target, and recipe cost rates on one common scale.</p>
              <div className="mt-5 space-y-4">
                {costRateSeries.map((series) => (
                  <div key={series.id} className="grid grid-cols-[64px_1fr_58px] items-center gap-3">
                    <div className="text-xs font-extrabold text-gray-600">{series.label}</div>
                    <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                      {series.value !== null && (
                        <div
                          className={`h-full rounded-full ${series.color}`}
                          style={{ width: `${Math.min(100, Math.max(1, (series.value / rateChartMaximum) * 100))}%` }}
                        />
                      )}
                    </div>
                    <div className="text-right text-sm font-black">
                      {series.value === null ? '—' : `${formatAmount(series.value, 1)}%`}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-between border-t border-gray-100 pt-3 text-[10px] font-bold text-gray-400">
                <span>0%</span>
                <span>{formatAmount(rateChartMaximum, 0)}%</span>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Target className="h-5 w-5" />
                    <h3 className="text-lg font-extrabold">Excess Cost Drivers</h3>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">Ingredients with the largest actual cost above recipe cost.</p>
                </div>
                {targetReductionAmount > 0 && inventoryComplete && (
                  <div className="rounded-xl bg-red-50 px-3 py-2 text-right text-xs font-extrabold text-red-700">
                    Reduce {store.currency} {formatAmount(targetReductionAmount)}
                    <div className="mt-0.5 text-[10px] font-bold">to reach target</div>
                  </div>
                )}
              </div>

              {!inventoryComplete || recipeBlockerCount > 0 ? (
                <div className="mt-4 space-y-2">
                  {!inventoryComplete && (
                    <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50 p-4">
                      <div className="text-sm font-extrabold">Complete inventory close</div>
                      <div className="mt-1 text-xs text-amber-800">{completedCounts}/{activeProfiles.length} ingredient counts complete</div>
                    </div>
                  )}
                  {recipeBlockerCount > 0 && (
                    <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50 p-4">
                      <div className="text-sm font-extrabold">Complete recipes and ingredient costs</div>
                      <div className="mt-1 text-xs text-amber-800">{recipeBlockerCount} item(s) still block the variance analysis</div>
                    </div>
                  )}
                </div>
              ) : excessCostDrivers.length > 0 ? (
                <div className="mt-5 space-y-4">
                  {excessCostDrivers.map((row, index) => {
                    const ingredient = ingredientById.get(row.ingredientId);
                    return (
                      <div key={row.ingredientId}>
                        <div className="mb-1.5 flex items-end justify-between gap-3">
                          <div className="min-w-0">
                            <span className="mr-2 text-[10px] font-black text-gray-400">#{index + 1}</span>
                            <span className="truncate text-sm font-extrabold">{ingredient?.name ?? row.ingredientId}</span>
                          </div>
                          <div className="shrink-0 text-sm font-black text-red-600">
                            +{store.currency} {formatAmount(row.varianceValue ?? 0)}
                          </div>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-red-50">
                          <div
                            className="h-full rounded-full bg-red-500"
                            style={{ width: `${Math.max(3, ((row.varianceValue ?? 0) / largestDriverValue) * 100)}%` }}
                          />
                        </div>
                        <div className="mt-1 text-right text-[10px] text-gray-400">
                          Usage gap {row.usageVariance !== null && row.usageVariance > 0 ? '+' : ''}{formatAmount(row.usageVariance ?? 0, 3)} {ingredient?.unit ?? ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 rounded-xl bg-emerald-50 p-5 text-sm font-bold text-emerald-700">
                  No positive ingredient cost variance detected for this month.
                </div>
              )}
            </div>
          </section>

          <details className="group rounded-2xl border border-gray-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5">
              <div>
                <div className="flex items-center gap-2 font-extrabold">
                  <Gauge className="h-4 w-4" /> View All Ingredient Usage Gaps
                </div>
                <div className="mt-1 text-xs text-gray-500">Compare recipe usage with actual usage calculated from inventory.</div>
              </div>
              <ChevronDown className="h-5 w-5 text-gray-400 transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-gray-100 p-5 pt-3">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="border-b border-gray-200 text-[11px] text-gray-400">
                    <tr>
                      <th className="px-3 py-2">Ingredient</th>
                      <th className="px-3 py-2 text-right">Recipe Usage</th>
                      <th className="px-3 py-2 text-right">Actual Usage</th>
                      <th className="px-3 py-2 text-right">Usage Gap</th>
                      <th className="px-3 py-2 text-right">Cost Gap</th>
                      <th className="px-3 py-2 text-right">Share of Actual Cost</th>
                      <th className="px-3 py-2">Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {theoreticalAnalysis.ingredientRows.map((row) => {
                      const ingredient = ingredientById.get(row.ingredientId);
                      const costRow = costBreakdownByIngredient.get(row.ingredientId);
                      const gapHigh = row.variancePercentage !== null && row.variancePercentage > 10;
                      const gapLow = row.variancePercentage !== null && row.variancePercentage < -10;
                      const action = row.unitCost === null
                        ? 'Set purchase unit and price'
                        : !inventoryComplete || row.actualUsage === null
                          ? 'Complete inventory close'
                          : gapHigh && row.wasteQuantity > 0
                            ? 'Check waste and over-portioning'
                            : gapHigh
                              ? 'Check waste, portions, recipe, and stock'
                              : gapLow
                                ? 'Check recipe or physical count'
                                : row.wasteQuantity > 0
                                  ? 'Check waste record'
                                  : 'Within range';
                      return (
                        <tr key={row.ingredientId} className={`border-b border-gray-100 ${gapHigh && inventoryComplete ? 'bg-red-50/50' : ''}`}>
                          <td className="px-3 py-3">
                            <div className="font-bold">{ingredient?.name ?? row.ingredientId}</div>
                            <div className="text-[10px] text-gray-400">{ingredient?.unit ?? 'unit'}</div>
                          </td>
                          <td className="px-3 py-3 text-right">{formatAmount(row.theoreticalUsage, 3)}</td>
                          <td className="px-3 py-3 text-right">{row.actualUsage === null ? '—' : formatAmount(row.actualUsage, 3)}</td>
                          <td className="px-3 py-3 text-right font-bold">
                            {row.usageVariance === null ? '—' : `${row.usageVariance > 0 ? '+' : ''}${formatAmount(row.usageVariance, 3)}`}
                            {row.variancePercentage !== null && (
                              <div className="text-[10px] text-gray-400">
                                {row.variancePercentage > 0 ? '+' : ''}{formatAmount(row.variancePercentage, 1)}%
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right font-bold">
                            {row.varianceValue === null ? '—' : `${row.varianceValue > 0 ? '+' : ''}${store.currency} ${formatAmount(row.varianceValue)}`}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {actualCost > 0 && costRow ? `${formatAmount((costRow.actualCost / actualCost) * 100, 1)}%` : '—'}
                          </td>
                          <td className={`px-3 py-3 text-xs font-bold ${gapHigh && inventoryComplete ? 'text-red-700' : 'text-gray-600'}`}>{action}</td>
                        </tr>
                      );
                    })}
                    {theoreticalAnalysis.ingredientRows.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">Enter sales quantities and menu recipes to view this analysis.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </details>

          <details className="group rounded-2xl border border-gray-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5">
              <div>
                <div className="flex items-center gap-2 font-extrabold">
                  <ChefHat className="h-4 w-4" /> View Menu & Course Profitability
                </div>
                <div className="mt-1 text-xs text-gray-500">Review recipe cost by menu using monthly sales quantities.</div>
              </div>
              <ChevronDown className="h-5 w-5 text-gray-400 transition group-open:rotate-180" />
            </summary>
            <div className="space-y-6 border-t border-gray-100 p-5 pt-3">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  ['Recipe coverage', theoreticalAnalysis.recipeCoveragePercentage === null ? '—' : `${formatAmount(theoreticalAnalysis.recipeCoveragePercentage, 1)}%`],
                  ['Cost coverage', theoreticalAnalysis.costCoveragePercentage === null ? '—' : `${formatAmount(theoreticalAnalysis.costCoveragePercentage, 1)}%`],
                  ['Recipe cost', `${store.currency} ${formatAmount(theoreticalAnalysis.theoreticalCost)}`],
                  ['Incomplete items', `${recipeBlockerCount}`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-gray-50 p-4">
                    <div className="text-[11px] font-bold text-gray-500">{label}</div>
                    <div className="mt-1 text-xl font-extrabold">{value}</div>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="border-b border-gray-200 text-[11px] text-gray-400">
                    <tr>
                      <th className="px-3 py-2">Menu</th>
                      <th className="px-3 py-2 text-right">Single / Course Sales</th>
                      <th className="px-3 py-2">Recipe Status</th>
                      <th className="px-3 py-2 text-right">Selling Price</th>
                      <th className="px-3 py-2 text-right">Recipe Cost / Unit</th>
                      <th className="px-3 py-2 text-right">Recipe Cost Rate</th>
                      <th className="px-3 py-2 text-right">Monthly Recipe Cost</th>
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
                            ? <span className="text-red-600">Missing recipe</span>
                            : !row.costReady
                              ? <span className="text-amber-700">Missing ingredient cost</span>
                              : <span className="text-emerald-700">Ready</span>}
                        </td>
                        <td className="px-3 py-3 text-right">{formatAmount(row.price)}</td>
                        <td className="px-3 py-3 text-right">{row.theoreticalUnitCost === null ? '—' : formatAmount(row.theoreticalUnitCost)}</td>
                        <td className="px-3 py-3 text-right">{row.theoreticalCostPercentage === null ? '—' : `${formatAmount(row.theoreticalCostPercentage, 1)}%`}</td>
                        <td className="px-3 py-3 text-right font-bold">{row.monthlyTheoreticalCost === null ? '—' : formatAmount(row.monthlyTheoreticalCost)}</td>
                      </tr>
                    ))}
                    {theoreticalAnalysis.menuRows.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">No menu sales quantities were reported for this month.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {theoreticalAnalysis.courseRows.length > 0 && (
                <div className="overflow-x-auto">
                  <div className="mb-2 text-sm font-extrabold">Courses & Sets</div>
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-b border-gray-200 text-[11px] text-gray-400">
                      <tr>
                        <th className="px-3 py-2">Course / Set</th>
                        <th className="px-3 py-2 text-right">Units Sold</th>
                        <th className="px-3 py-2 text-right">Components</th>
                        <th className="px-3 py-2 text-right">Selling Price</th>
                        <th className="px-3 py-2 text-right">Recipe Cost / Unit</th>
                        <th className="px-3 py-2 text-right">Recipe Cost Rate</th>
                        <th className="px-3 py-2 text-right">Monthly Recipe Cost</th>
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
              )}
            </div>
          </details>
        </>
      )}

      {activeSection === 'purchases' && (
        <>
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-extrabold">1. Ingredient Purchase Setup</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Review each ingredient in one row and open the form only when changes are needed.
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
                    <option value="">Select a registered ingredient</option>
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
                    <Plus className="h-4 w-4" /> Add Purchase Setup
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewIngredient((current) => !current)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold"
                  >
                    Add New Ingredient
                  </button>
                </div>
              )}
            </div>

            {showNewIngredient && editable && (
              <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-[1fr_140px_auto]">
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

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-gray-200 text-[11px] text-gray-400">
                  <tr>
                    <th className="px-3 py-2">Ingredient</th>
                    <th className="px-3 py-2">Purchase Unit</th>
                    <th className="px-3 py-2 text-right">Content</th>
                    <th className="px-3 py-2 text-right">Pack Price</th>
                    <th className="px-3 py-2 text-right">Base Unit Cost</th>
                    <th className="px-3 py-2">Supplier</th>
                    {editable && <th className="px-3 py-2 text-right">Edit</th>}
                  </tr>
                </thead>
                <tbody>
                  {activeProfiles.map((profile) => {
                    const ingredient = ingredientById.get(profile.ingredientId);
                    const unitPrice = profile.contentQuantity > 0 ? profile.currentPackPrice / profile.contentQuantity : 0;
                    const expanded = expandedProfileId === profile.ingredientId;
                    return (
                      <React.Fragment key={profile.ingredientId}>
                        <tr className="border-b border-gray-100">
                          <td className="px-3 py-3">
                            <div className="font-extrabold">{ingredient?.name ?? profile.ingredientId}</div>
                            <div className="text-[10px] text-gray-400">{CATEGORY_LABELS[profile.category]} · {ingredient?.unit ?? 'unit'}</div>
                          </td>
                          <td className="px-3 py-3">{profile.purchaseUnit}</td>
                          <td className="px-3 py-3 text-right">{formatAmount(profile.contentQuantity, 3)} {ingredient?.unit ?? ''}</td>
                          <td className="px-3 py-3 text-right font-bold">{store.currency} {formatAmount(profile.currentPackPrice)}</td>
                          <td className="px-3 py-3 text-right">{store.currency} {formatAmount(unitPrice, 4)} / {ingredient?.unit ?? 'unit'}</td>
                          <td className="px-3 py-3 text-gray-500">{profile.supplier || '—'}</td>
                          {editable && (
                            <td className="px-3 py-3 text-right">
                              <button
                                type="button"
                                aria-expanded={expanded}
                                onClick={() => setExpandedProfileId(expanded ? null : profile.ingredientId)}
                                className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold hover:bg-gray-50"
                              >
                                {expanded ? 'Close' : 'Edit'}
                              </button>
                            </td>
                          )}
                        </tr>
                        {expanded && editable && (
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <td colSpan={7} className="p-4">
                              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                                <label className="text-xs font-bold text-gray-600">
                                  Category
                                  <select
                                    value={profile.category}
                                    onChange={(event) => setProfiles((current) => current.map((row) => row.ingredientId === profile.ingredientId ? { ...row, category: event.target.value as IngredientCategory } : row))}
                                    className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                                  >
                                    {(Object.keys(CATEGORY_LABELS) as IngredientCategory[]).map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}
                                  </select>
                                </label>
                                <label className="text-xs font-bold text-gray-600">
                                  Purchase unit
                                  <input
                                    value={profile.purchaseUnit}
                                    onChange={(event) => setProfiles((current) => current.map((row) => row.ingredientId === profile.ingredientId ? { ...row, purchaseUnit: event.target.value } : row))}
                                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
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
                                    onChange={(event) => setProfiles((current) => current.map((row) => row.ingredientId === profile.ingredientId ? { ...row, contentQuantity: Number(event.target.value) } : row))}
                                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                                  />
                                </label>
                                <label className="text-xs font-bold text-gray-600">
                                  Pack price ({store.currency})
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={profile.currentPackPrice}
                                    onChange={(event) => setProfiles((current) => current.map((row) => row.ingredientId === profile.ingredientId ? { ...row, currentPackPrice: Number(event.target.value) } : row))}
                                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                                  />
                                </label>
                                <label className="text-xs font-bold text-gray-600">
                                  Supplier
                                  <input
                                    value={profile.supplier}
                                    onChange={(event) => setProfiles((current) => current.map((row) => row.ingredientId === profile.ingredientId ? { ...row, supplier: event.target.value } : row))}
                                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                                    placeholder="Optional"
                                  />
                                </label>
                              </div>
                              <div className="mt-3 flex justify-end">
                                <button
                                  type="button"
                                  disabled={savingKey !== null}
                                  onClick={() => void saveProfile(profile)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-black px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
                                >
                                  <Save className="h-4 w-4" /> Save Ingredient Setup
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {activeProfiles.length === 0 && (
                    <tr><td colSpan={editable ? 7 : 6} className="px-3 py-8 text-center text-sm text-gray-400">No ingredient purchase setup has been registered.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-extrabold">2. Monthly Purchases</h3>
                <p className="mt-1 text-sm text-gray-500">Enter package count and invoice total; base-unit quantity is calculated automatically.</p>
              </div>
              {editable && (
                <button
                  type="button"
                  disabled={activeProfiles.length === 0}
                  onClick={() => setShowPurchaseForm((current) => !current)}
                  className="inline-flex items-center justify-center gap-1 rounded-xl bg-black px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" /> Add Purchase
                </button>
              )}
            </div>

            {showPurchaseForm && editable && (
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
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
                    Packages
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
                    Invoice total ({store.currency})
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
                  Notes
                  <input
                    value={purchaseDraft.notes}
                    onChange={(event) => setPurchaseDraft((current) => ({ ...current, notes: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    placeholder="Invoice number, price change, delivery issue, etc."
                  />
                </label>
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={() => setShowPurchaseForm(false)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold">Cancel</button>
                  <button type="button" disabled={savingKey !== null} onClick={() => void addPurchase()} className="rounded-lg bg-black px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Save Purchase</button>
                </div>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="text-xs font-bold text-gray-500">MONTHLY PURCHASES</div>
                <div className="mt-1 text-xl font-extrabold">{store.currency} {formatAmount(purchaseTotal)}</div>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="text-xs font-bold text-gray-500">PURCHASE ENTRIES</div>
                <div className="mt-1 text-xl font-extrabold">{purchases.length}</div>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="text-xs font-bold text-gray-500">CONFIGURED INGREDIENTS</div>
                <div className="mt-1 text-xl font-extrabold">{activeProfiles.length}</div>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-gray-200 text-[11px] text-gray-400">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Ingredient</th>
                    <th className="px-3 py-2 text-right">Packages</th>
                    <th className="px-3 py-2 text-right">Base Quantity</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2">Supplier / Notes</th>
                    {editable && <th className="px-3 py-2 text-right">Delete</th>}
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
                              aria-label={`Delete ${purchase.purchaseDate} ${ingredient?.name ?? purchase.ingredientId} purchase`}
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
                    <tr><td colSpan={editable ? 7 : 6} className="px-3 py-8 text-center text-sm text-gray-400">No purchase entries for this month.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {activeSection === 'inventory' && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-lg font-extrabold">Month-End Inventory Close</h3>
              <p className="mt-1 text-sm text-gray-500">
                Opening + purchases + adjustment − closing = actual usage. Enter quantities first and expand valuation details only when needed.
              </p>
            </div>
            <div className={`rounded-xl px-4 py-2 text-sm font-extrabold ${
              inventoryComplete ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
            }`}>
              {completedCounts}/{activeProfiles.length} counts complete
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-gray-50 p-4 text-xs leading-5 text-gray-600">
            Check <strong>Count complete</strong> only after physically counting the ingredient, then save.
            Only rows with invalid quantities are highlighted in red.
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="border-b border-gray-200 text-[11px] text-gray-400">
                <tr>
                  <th className="px-3 py-2">Ingredient</th>
                  <th className="px-2 py-2 text-right">Opening</th>
                  <th className="px-2 py-2 text-right">Purchased</th>
                  <th className="px-2 py-2 text-right">Waste</th>
                  <th className="px-2 py-2 text-right">Adjust (+/-)</th>
                  <th className="px-2 py-2 text-right">Closing</th>
                  <th className="px-3 py-2 text-right">Actual Usage</th>
                  <th className="px-3 py-2 text-center">Close</th>
                </tr>
              </thead>
              <tbody>
                {activeProfiles.map((profile) => {
                  const ingredient = ingredientById.get(profile.ingredientId);
                  const row = inventoryRows[profile.ingredientId] ?? emptyInventoryRow(store.id, profile.ingredientId, monthStart);
                  const purchasedQuantity = purchasedQuantityByIngredient.get(profile.ingredientId) ?? 0;
                  const actualUsage = row.openingQuantity + purchasedQuantity + row.adjustmentQuantity - row.closingQuantity;
                  const valuation = costBreakdownByIngredient.get(profile.ingredientId);
                  const invalidUsage = valuation?.invalid ?? (actualUsage < 0 || row.wasteQuantity > Math.max(0, actualUsage));
                  const expanded = expandedInventoryId === profile.ingredientId;
                  const inputClassName = 'w-16 rounded-lg border border-gray-200 px-1.5 py-2 text-right text-sm disabled:bg-gray-50';
                  return (
                    <React.Fragment key={profile.ingredientId}>
                      <tr className={`border-b border-gray-100 ${invalidUsage ? 'bg-red-50' : ''}`}>
                        <td className="px-3 py-3">
                          <div className="font-extrabold">{ingredient?.name ?? profile.ingredientId}</div>
                          <div className="mt-1 text-[10px] text-gray-400">{ingredient?.unit ?? 'unit'}</div>
                          {invalidUsage && <div className="mt-1 text-[10px] font-bold text-red-600">Check quantities</div>}
                          <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() => setExpandedInventoryId(expanded ? null : profile.ingredientId)}
                            className="mt-2 text-[10px] font-bold text-gray-500 underline underline-offset-2 hover:text-black"
                          >
                            {expanded ? 'Close valuation details' : 'Valuation details'}
                          </button>
                        </td>
                        <td className="px-2 py-3 text-right">
                          <input
                            aria-label={`${ingredient?.name ?? profile.ingredientId} opening inventory`}
                            type="number"
                            min="0"
                            step="0.001"
                            value={row.openingQuantity}
                            disabled={!editable}
                            onChange={(event) => updateInventoryDraft(profile.ingredientId, { openingQuantity: Number(event.target.value), countComplete: false })}
                            className={inputClassName}
                          />
                        </td>
                        <td className="px-2 py-3 text-right">
                          <div className="inline-block w-16 rounded-lg bg-gray-50 px-1.5 py-2 text-right">{formatAmount(purchasedQuantity, 3)}</div>
                        </td>
                        <td className="px-2 py-3 text-right">
                          <input
                            aria-label={`${ingredient?.name ?? profile.ingredientId} waste quantity`}
                            type="number"
                            min="0"
                            step="0.001"
                            value={row.wasteQuantity}
                            disabled={!editable}
                            onChange={(event) => updateInventoryDraft(profile.ingredientId, { wasteQuantity: Number(event.target.value), countComplete: false })}
                            className={inputClassName}
                          />
                        </td>
                        <td className="px-2 py-3 text-right">
                          <input
                            aria-label={`${ingredient?.name ?? profile.ingredientId} inventory adjustment`}
                            type="number"
                            step="0.001"
                            value={row.adjustmentQuantity}
                            disabled={!editable}
                            onChange={(event) => updateInventoryDraft(profile.ingredientId, { adjustmentQuantity: Number(event.target.value), countComplete: false })}
                            className={inputClassName}
                          />
                        </td>
                        <td className="px-2 py-3 text-right">
                          <input
                            aria-label={`${ingredient?.name ?? profile.ingredientId} closing inventory`}
                            type="number"
                            min="0"
                            step="0.001"
                            value={row.closingQuantity}
                            disabled={!editable}
                            onChange={(event) => updateInventoryDraft(profile.ingredientId, { closingQuantity: Number(event.target.value), countComplete: false })}
                            className={inputClassName}
                          />
                        </td>
                        <td className={`px-3 py-3 text-right font-extrabold ${invalidUsage ? 'text-red-700' : ''}`}>
                          {formatAmount(actualUsage, 3)} {ingredient?.unit ?? ''}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex flex-col items-center gap-2">
                            <label className={`inline-flex items-center gap-1.5 text-xs font-bold ${editable ? 'cursor-pointer' : ''}`}>
                              <input
                                type="checkbox"
                                checked={row.countComplete}
                                disabled={!editable || invalidUsage}
                                onChange={(event) => updateInventoryDraft(profile.ingredientId, { countComplete: event.target.checked })}
                                className="h-4 w-4 rounded border-gray-300"
                              />
                              {row.countComplete ? 'Complete' : 'Open'}
                            </label>
                            {editable && (
                              <button
                                type="button"
                                disabled={savingKey !== null || invalidUsage}
                                onClick={() => void saveInventoryRow(profile.ingredientId)}
                                className="inline-flex items-center gap-1 rounded-lg bg-black px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                              >
                                <Save className="h-4 w-4" /> Save
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-gray-200 bg-gray-50">
                          <td colSpan={8} className="p-4">
                            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                              <label className="text-xs font-bold text-gray-600">
                                Opening unit cost ({store.currency}/{ingredient?.unit ?? 'unit'})
                                <input
                                  type="number"
                                  min="0"
                                  step="0.000001"
                                  value={row.openingUnitCost}
                                  disabled={!editable}
                                  onChange={(event) => updateInventoryDraft(profile.ingredientId, { openingUnitCost: Number(event.target.value), countComplete: false })}
                                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm disabled:bg-gray-100"
                                />
                                <span className="mt-1 block text-[10px] font-normal text-gray-400">
                                  {previousClosingCosts[profile.ingredientId] > 0
                                    ? `Previous closing cost: ${formatAmount(previousClosingCosts[profile.ingredientId], 6)}`
                                    : 'For the first month, confirm the supplier unit cost'}
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
                                Opening stock value
                                <div className="mt-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900">
                                  {store.currency} {formatAmount(valuation?.openingValue ?? 0)}
                                </div>
                              </div>
                              <div className="text-xs font-bold text-gray-600">
                                Closing stock value
                                <div className="mt-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900">
                                  {store.currency} {formatAmount(valuation?.closingValue ?? 0)}
                                </div>
                              </div>
                              <label className="text-xs font-bold text-gray-600">
                                Notes
                                <input
                                  value={row.notes}
                                  disabled={!editable}
                                  onChange={(event) => updateInventoryDraft(profile.ingredientId, { notes: event.target.value })}
                                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm disabled:bg-gray-100"
                                  placeholder="Reason for count difference, etc."
                                />
                              </label>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {activeProfiles.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-gray-400">Register ingredient purchase setup first.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

export default CostInventoryWorkspace;
