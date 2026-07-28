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
  main: '주재료',
  secondary: '부재료',
  packaging: '포장재',
  other: '기타',
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
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
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
  const priorityActions = useMemo(() => {
    const actions: Array<{
      id: string;
      title: string;
      value: string;
      description: string;
      tone: 'danger' | 'warning' | 'neutral' | 'success';
    }> = [];

    if (!inventoryComplete) {
      actions.push({
        id: 'inventory',
        title: '월말 재고 마감을 완료해 주세요',
        value: `${completedCounts}/${activeProfiles.length}개 완료`,
        description: '재고가 모두 마감되어야 실제 원가율과 사용량 차이가 확정됩니다.',
        tone: 'warning',
      });
    }

    if (recipeBlockerCount > 0) {
      actions.push({
        id: 'recipe',
        title: '레시피 또는 재료 단가를 확인해 주세요',
        value: `${recipeBlockerCount}건 미완료`,
        description: '미완료 항목이 있으면 이론 원가와 실제 원가의 차이를 정확히 비교할 수 없습니다.',
        tone: 'warning',
      });
    }

    if (varianceAnalysisReady) {
      theoreticalAnalysis.ingredientRows
        .filter((row) => row.varianceValue !== null && row.varianceValue > 0)
        .sort((left, right) => (right.varianceValue ?? 0) - (left.varianceValue ?? 0))
        .slice(0, 3)
        .forEach((row) => {
          const ingredient = ingredientById.get(row.ingredientId);
          const unit = ingredient?.unit ?? '';
          const highVariance = row.variancePercentage !== null && row.variancePercentage > 10;
          actions.push({
            id: `ingredient-${row.ingredientId}`,
            title: `${ingredient?.name ?? row.ingredientId} 사용량을 확인해 주세요`,
            value: `+${formatAmount(row.usageVariance ?? 0, 3)}${unit} / +${store.currency} ${formatAmount(row.varianceValue ?? 0)}`,
            description: highVariance
              ? (row.wasteQuantity > 0
                ? '폐기 기록과 실제 제공량이 맞는지 확인해 주세요.'
                : '폐기, 과다 제공, 레시피 등록량 또는 재고 수량을 확인해 주세요.')
              : '기록된 폐기와 실제 사용량 차이를 확인해 주세요.',
            tone: highVariance ? 'danger' : 'neutral',
          });
        });
    }

    if (actions.length === 0 && targetVariance !== null && targetVariance > 0) {
      actions.push({
        id: 'target',
        title: '목표 원가율까지 원가 절감이 필요합니다',
        value: `${store.currency} ${formatAmount(targetReductionAmount)} 절감 필요`,
        description: '원가 비중이 높은 재료와 단가 상승 항목부터 확인해 주세요.',
        tone: 'danger',
      });
    }

    if (actions.length === 0) {
      actions.push({
        id: 'complete',
        title: '이번 달 원가가 정상 범위입니다',
        value: '추가 경고 없음',
        description: '현재 입력 기준으로 목표와 레시피 사용량 범위 안에 있습니다.',
        tone: 'success',
      });
    }

    return actions.slice(0, 3);
  }, [
    activeProfiles.length,
    completedCounts,
    ingredientById,
    inventoryComplete,
    recipeBlockerCount,
    store.currency,
    targetReductionAmount,
    targetVariance,
    theoreticalAnalysis.ingredientRows,
    varianceAnalysisReady,
  ]);

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
          ? '원가관리 데이터베이스가 아직 활성화되지 않았습니다. 관리자에게 확인해 주세요.'
          : (message || '원가·재고 데이터를 불러오지 못했습니다.'),
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
      setError('목표 원가율은 0~100 사이로 입력해 주세요.');
      return;
    }
    if (costControl.netSalesOverride !== null && costControl.netSalesOverride < 0) {
      setError('매출 수정값에는 음수를 입력할 수 없습니다.');
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
      setNotice('이번 달 원가 설정을 저장했습니다.');
    } catch (saveError: any) {
      setError(saveError?.message ?? '이번 달 원가 설정을 저장하지 못했습니다.');
    } finally {
      setSavingKey(null);
    }
  };

  const saveProfile = async (profile: IngredientProfile) => {
    if (!editable) return;
    if (!profile.purchaseUnit.trim() || profile.contentQuantity <= 0 || profile.currentPackPrice < 0) {
      setError('구매단위, 0보다 큰 내용량과 올바른 팩 가격을 입력해 주세요.');
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
      setNotice('재료 구매정보를 저장했습니다.');
    } catch (saveError: any) {
      setError(saveError?.message ?? '재료 구매정보를 저장하지 못했습니다.');
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
      setError('재료명과 기본 단위를 입력해 주세요.');
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
      setError(saveError?.message ?? '새 재료를 추가하지 못했습니다.');
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
      setError('재료를 선택하고 구매일, 팩 수와 전표 총액을 올바르게 입력해 주세요.');
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
      setNotice('매입 내역을 저장했습니다.');
    } catch (saveError: any) {
      setError(saveError?.message ?? '매입 내역을 저장하지 못했습니다.');
    } finally {
      setSavingKey(null);
    }
  };

  const deletePurchase = async (purchase: PurchaseEntry) => {
    if (!editable || !window.confirm('이 매입 내역을 삭제하시겠습니까?')) return;
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
      setError(deleteError?.message ?? '매입 내역을 삭제하지 못했습니다.');
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
      setError('재고수량과 단가는 올바른 숫자로 입력해야 하며 음수일 수 없습니다.');
      return;
    }
    if (row.openingQuantity > 0 && row.openingUnitCost <= 0) {
      setError('이 재료의 월초 단가를 입력한 뒤 재고 마감을 완료해 주세요.');
      return;
    }

    const costRow = costBreakdownByIngredient.get(ingredientId);
    if (!costRow || costRow.invalid) {
      setError('재고수량과 계산금액을 확인한 뒤 저장해 주세요.');
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
      setNotice('월말 재고수량과 계산금액을 저장했습니다.');
    } catch (saveError: any) {
      setError(saveError?.message ?? '월말 재고를 저장하지 못했습니다.');
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        원가·재고 데이터를 불러오는 중입니다…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-black tracking-[0.12em] text-gray-400">
            {mode === 'hq' ? '관리자 원가 검토' : '점포 원가 입력'}
          </div>
          <h2 className="mt-1 text-2xl font-extrabold">원가·매입·재고 관리</h2>
          <p className="mt-1 text-sm text-gray-500">
            {mode === 'hq'
              ? '이번 달 결과와 원인을 먼저 확인하고, 필요한 입력 자료를 검토합니다.'
              : '매입과 월말 재고를 입력하면 실제 원가율과 개선 항목을 자동으로 계산합니다.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              aria-label="원가·재고 기준월"
              value={monthKey}
              onChange={(event) => setMonthKey(event.target.value)}
              className="appearance-none rounded-xl border border-gray-200 bg-white py-2.5 pl-3 pr-9 text-sm font-bold"
            >
              {monthOptions.map((key) => (
                <option key={key} value={key}>
                  {monthLabel(key)}
                  {isTestStore && reportedMonthKeys.has(key) ? ' · 테스트 자료' : ''}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-gray-400" />
          </div>
          <button
            type="button"
            aria-label="원가·재고 다시 불러오기"
            onClick={() => void loadData()}
            className="rounded-xl border border-gray-200 bg-white p-2.5 text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav className="flex overflow-x-auto rounded-2xl border border-gray-200 bg-white p-1.5" aria-label="원가 관리 화면">
        {([
          ['summary', '요약·분석'],
          ['purchases', '재료·매입'],
          ['inventory', `재고 마감 ${completedCounts}/${activeProfiles.length}`],
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
                <div className="text-xs font-black tracking-[0.12em] text-gray-400">이번 달 원가 결론</div>
                <h3 className="mt-1 text-xl font-extrabold">
                  {inventoryComplete
                    ? targetVariance === null
                      ? '재고 마감 완료 · 목표 원가율을 설정해 주세요'
                      : targetVariance <= 0
                        ? '목표 원가율 안에서 관리되고 있습니다'
                        : `목표보다 ${formatAmount(targetVariance, 1)}%p 높습니다`
                    : `재고 마감 ${activeProfiles.length - completedCounts}개가 남았습니다`}
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  원가율 계산식: 월초 재고금액 + 당월 매입금액 - 월말 재고금액
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
                    ? '계산 중'
                    : targetVariance !== null && targetVariance > 0
                      ? '개선 필요'
                      : '정상'}
                </span>
                <button
                  type="button"
                  aria-expanded={showMonthlySettings}
                  onClick={() => setShowMonthlySettings((current) => !current)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold hover:bg-gray-50"
                >
                  목표·월 설정 {showMonthlySettings ? '닫기' : '열기'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl bg-gray-950 p-5 text-white">
                <div className="text-xs font-bold text-gray-400">실제 원가율</div>
                <div className="mt-2 text-3xl font-black">
                  {actualCostPercentage === null ? '—' : `${formatAmount(actualCostPercentage, 1)}%`}
                </div>
                <div className="mt-2 text-sm font-bold text-gray-300">
                  실제 원가 {store.currency} {formatAmount(actualCost)}
                </div>
              </div>
              <div className="rounded-2xl border border-gray-200 p-5">
                <div className="text-xs font-bold text-gray-500">매출액</div>
                <div className="mt-2 text-2xl font-extrabold">{store.currency} {formatAmount(netSales)}</div>
                <div className="mt-2 text-xs text-gray-500">
                  {costControl.netSalesOverride !== null ? '수동 입력값 적용' : '일일 매출보고 자동 집계'}
                </div>
              </div>
              <div className="rounded-2xl border border-gray-200 p-5">
                <div className="text-xs font-bold text-gray-500">이론 원가율</div>
                <div className="mt-2 text-2xl font-extrabold">
                  {theoreticalCostPercentage === null ? '—' : `${formatAmount(theoreticalCostPercentage, 1)}%`}
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  레시피 기준 {store.currency} {formatAmount(theoreticalAnalysis.theoreticalCost)}
                </div>
              </div>
              <div className={`rounded-2xl border p-5 ${
                varianceAnalysisReady && actualVsTheoreticalGap > 0
                  ? 'border-red-200'
                  : 'border-gray-200'
              }`}>
                <div className="text-xs font-bold text-gray-500">실제 - 이론 차이</div>
                <div className={`mt-2 text-2xl font-extrabold ${
                  varianceAnalysisReady && actualVsTheoreticalGap > 0 ? 'text-red-600' : ''
                }`}>
                  {varianceAnalysisReady
                    ? `${actualVsTheoreticalGap > 0 ? '+' : ''}${store.currency} ${formatAmount(actualVsTheoreticalGap)}`
                    : '확정 전'}
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  {varianceAnalysisReady ? '폐기·과다 사용·단가 차이 확인' : '레시피·단가·재고 마감 필요'}
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
              {[
                ['목표 원가율', costControl.targetCostPercentage === null ? '미설정' : `${formatAmount(costControl.targetCostPercentage, 1)}%`],
                ['월초 재고', `${store.currency} ${formatAmount(openingInventoryValue)}`],
                ['당월 매입', `${store.currency} ${formatAmount(purchaseTotal)}`],
                ['월말 재고', `${store.currency} ${formatAmount(closingInventoryValue)}`],
                ['폐기 금액', `${store.currency} ${formatAmount(totalWasteValue)}`],
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
                전월보다 {formatAmount(Math.abs(previousRateDelta), 1)}%p {previousRateDelta > 0 ? '상승했습니다' : '개선되었습니다'}.
              </div>
            )}

            {showMonthlySettings && (
              <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 md:grid-cols-2 xl:grid-cols-[160px_220px_1fr_auto]">
                <label className="text-xs font-bold text-gray-600">
                  목표 원가율(%)
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
                    placeholder="예: 30"
                  />
                </label>
                <label className="text-xs font-bold text-gray-600">
                  매출 수정값({store.currency})
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
                    placeholder={`보고 매출: ${formatAmount(reportedSales)}`}
                  />
                </label>
                <label className="text-xs font-bold text-gray-600">
                  월 메모
                  <input
                    value={costControl.notes}
                    onChange={(event) => setCostControl((current) => ({ ...current, notes: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
                    placeholder="특이 매입, 재고 문제, 매출 수정 사유 등"
                  />
                </label>
                <button
                  type="button"
                  disabled={savingKey !== null}
                  onClick={() => void saveCostControl()}
                  className="self-end rounded-lg bg-black px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                >
                  설정 저장
                </button>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  <h3 className="text-lg font-extrabold">이번 달 먼저 확인할 사항</h3>
                </div>
                <p className="mt-1 text-sm text-gray-500">금액 영향이 큰 항목부터 최대 3개만 표시합니다.</p>
              </div>
              {targetReductionAmount > 0 && inventoryComplete && (
                <div className="rounded-xl bg-red-50 px-3 py-2 text-xs font-extrabold text-red-700">
                  목표까지 {store.currency} {formatAmount(targetReductionAmount)} 절감 필요
                </div>
              )}
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {priorityActions.map((action, index) => (
                <div
                  key={action.id}
                  className={`rounded-xl border-l-4 bg-gray-50 p-4 ${
                    action.tone === 'danger'
                      ? 'border-red-500'
                      : action.tone === 'warning'
                        ? 'border-amber-500'
                        : action.tone === 'success'
                          ? 'border-emerald-500'
                          : 'border-gray-300'
                  }`}
                >
                  <div className="text-[11px] font-black text-gray-400">우선순위 {index + 1}</div>
                  <div className="mt-1 text-sm font-extrabold">{action.title}</div>
                  <div className="mt-2 text-base font-black">{action.value}</div>
                  <p className="mt-2 text-xs leading-5 text-gray-600">{action.description}</p>
                </div>
              ))}
            </div>
          </section>

          <details className="group rounded-2xl border border-gray-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5">
              <div>
                <div className="flex items-center gap-2 font-extrabold">
                  <Gauge className="h-4 w-4" /> 재료별 사용량 차이 전체 보기
                </div>
                <div className="mt-1 text-xs text-gray-500">레시피 사용량과 실제 재고 사용량을 비교합니다.</div>
              </div>
              <ChevronDown className="h-5 w-5 text-gray-400 transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-gray-100 p-5 pt-3">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="border-b border-gray-200 text-[11px] text-gray-400">
                    <tr>
                      <th className="px-3 py-2">재료</th>
                      <th className="px-3 py-2 text-right">이론 사용량</th>
                      <th className="px-3 py-2 text-right">실제 사용량</th>
                      <th className="px-3 py-2 text-right">사용량 차이</th>
                      <th className="px-3 py-2 text-right">차이 금액</th>
                      <th className="px-3 py-2 text-right">실제 원가 비중</th>
                      <th className="px-3 py-2">확인 사항</th>
                    </tr>
                  </thead>
                  <tbody>
                    {theoreticalAnalysis.ingredientRows.map((row) => {
                      const ingredient = ingredientById.get(row.ingredientId);
                      const costRow = costBreakdownByIngredient.get(row.ingredientId);
                      const gapHigh = row.variancePercentage !== null && row.variancePercentage > 10;
                      const gapLow = row.variancePercentage !== null && row.variancePercentage < -10;
                      const action = row.unitCost === null
                        ? '구매단위와 가격 등록'
                        : !inventoryComplete || row.actualUsage === null
                          ? '월말 재고 마감'
                          : gapHigh && row.wasteQuantity > 0
                            ? '폐기와 과다 제공 확인'
                            : gapHigh
                              ? '폐기·제공량·레시피·재고 확인'
                              : gapLow
                                ? '레시피 또는 실사 수량 확인'
                                : row.wasteQuantity > 0
                                  ? '폐기 기록 확인'
                                  : '정상 범위';
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
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">판매수량과 메뉴 레시피를 입력하면 분석이 표시됩니다.</td></tr>
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
                  <ChefHat className="h-4 w-4" /> 메뉴·코스 수익성 상세 보기
                </div>
                <div className="mt-1 text-xs text-gray-500">판매수량과 레시피를 기준으로 메뉴별 이론 원가를 확인합니다.</div>
              </div>
              <ChevronDown className="h-5 w-5 text-gray-400 transition group-open:rotate-180" />
            </summary>
            <div className="space-y-6 border-t border-gray-100 p-5 pt-3">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  ['레시피 연결률', theoreticalAnalysis.recipeCoveragePercentage === null ? '—' : `${formatAmount(theoreticalAnalysis.recipeCoveragePercentage, 1)}%`],
                  ['단가 계산 가능률', theoreticalAnalysis.costCoveragePercentage === null ? '—' : `${formatAmount(theoreticalAnalysis.costCoveragePercentage, 1)}%`],
                  ['이론 원가', `${store.currency} ${formatAmount(theoreticalAnalysis.theoreticalCost)}`],
                  ['미완료 항목', `${recipeBlockerCount}건`],
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
                      <th className="px-3 py-2">메뉴</th>
                      <th className="px-3 py-2 text-right">단품 / 코스 판매</th>
                      <th className="px-3 py-2">레시피 상태</th>
                      <th className="px-3 py-2 text-right">판매가</th>
                      <th className="px-3 py-2 text-right">1개 이론 원가</th>
                      <th className="px-3 py-2 text-right">이론 원가율</th>
                      <th className="px-3 py-2 text-right">월 이론 원가</th>
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
                            ? <span className="text-red-600">레시피 없음</span>
                            : !row.costReady
                              ? <span className="text-amber-700">재료 단가 없음</span>
                              : <span className="text-emerald-700">완료</span>}
                        </td>
                        <td className="px-3 py-3 text-right">{formatAmount(row.price)}</td>
                        <td className="px-3 py-3 text-right">{row.theoreticalUnitCost === null ? '—' : formatAmount(row.theoreticalUnitCost)}</td>
                        <td className="px-3 py-3 text-right">{row.theoreticalCostPercentage === null ? '—' : `${formatAmount(row.theoreticalCostPercentage, 1)}%`}</td>
                        <td className="px-3 py-3 text-right font-bold">{row.monthlyTheoreticalCost === null ? '—' : formatAmount(row.monthlyTheoreticalCost)}</td>
                      </tr>
                    ))}
                    {theoreticalAnalysis.menuRows.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">이번 달 판매수량이 입력된 메뉴가 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {theoreticalAnalysis.courseRows.length > 0 && (
                <div className="overflow-x-auto">
                  <div className="mb-2 text-sm font-extrabold">코스·세트</div>
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-b border-gray-200 text-[11px] text-gray-400">
                      <tr>
                        <th className="px-3 py-2">코스·세트</th>
                        <th className="px-3 py-2 text-right">판매수량</th>
                        <th className="px-3 py-2 text-right">구성 메뉴</th>
                        <th className="px-3 py-2 text-right">판매가</th>
                        <th className="px-3 py-2 text-right">1개 이론 원가</th>
                        <th className="px-3 py-2 text-right">이론 원가율</th>
                        <th className="px-3 py-2 text-right">월 이론 원가</th>
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
                <h3 className="text-lg font-extrabold">1. 재료 구매단위·가격 설정</h3>
                <p className="mt-1 text-sm text-gray-500">
                  재료는 한 줄로 확인하고, 수정할 때만 상세 입력칸을 엽니다.
                </p>
              </div>
              {editable && (
                <div className="flex flex-wrap gap-2">
                  <select
                    aria-label="설정할 재료"
                    value={selectedIngredientId}
                    onChange={(event) => setSelectedIngredientId(event.target.value)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold"
                  >
                    <option value="">등록된 재료 선택</option>
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
                    <Plus className="h-4 w-4" /> 구매정보 등록
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewIngredient((current) => !current)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold"
                  >
                    새 재료 추가
                  </button>
                </div>
              )}
            </div>

            {showNewIngredient && editable && (
              <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-[1fr_140px_auto]">
                <label className="text-xs font-bold text-gray-600">
                  재료명
                  <input
                    value={newIngredient.name}
                    onChange={(event) => setNewIngredient((current) => ({ ...current, name: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    placeholder="예: 양배추"
                  />
                </label>
                <label className="text-xs font-bold text-gray-600">
                  기본 단위
                  <select
                    value={newIngredient.unit}
                    onChange={(event) => setNewIngredient((current) => ({ ...current, unit: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="g">g</option>
                    <option value="ml">ml</option>
                    <option value="pcs">개</option>
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
                  추가
                </button>
              </div>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-gray-200 text-[11px] text-gray-400">
                  <tr>
                    <th className="px-3 py-2">재료</th>
                    <th className="px-3 py-2">구매단위</th>
                    <th className="px-3 py-2 text-right">내용량</th>
                    <th className="px-3 py-2 text-right">1팩 가격</th>
                    <th className="px-3 py-2 text-right">기본단위 원가</th>
                    <th className="px-3 py-2">공급처</th>
                    {editable && <th className="px-3 py-2 text-right">수정</th>}
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
                                {expanded ? '닫기' : '수정'}
                              </button>
                            </td>
                          )}
                        </tr>
                        {expanded && editable && (
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <td colSpan={7} className="p-4">
                              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                                <label className="text-xs font-bold text-gray-600">
                                  분류
                                  <select
                                    value={profile.category}
                                    onChange={(event) => setProfiles((current) => current.map((row) => row.ingredientId === profile.ingredientId ? { ...row, category: event.target.value as IngredientCategory } : row))}
                                    className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                                  >
                                    {(Object.keys(CATEGORY_LABELS) as IngredientCategory[]).map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}
                                  </select>
                                </label>
                                <label className="text-xs font-bold text-gray-600">
                                  구매단위
                                  <input
                                    value={profile.purchaseUnit}
                                    onChange={(event) => setProfiles((current) => current.map((row) => row.ingredientId === profile.ingredientId ? { ...row, purchaseUnit: event.target.value } : row))}
                                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                                    placeholder="박스 / 팩 / 병"
                                  />
                                </label>
                                <label className="text-xs font-bold text-gray-600">
                                  내용량({ingredient?.unit ?? 'unit'})
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
                                  1팩 가격({store.currency})
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
                                  공급처
                                  <input
                                    value={profile.supplier}
                                    onChange={(event) => setProfiles((current) => current.map((row) => row.ingredientId === profile.ingredientId ? { ...row, supplier: event.target.value } : row))}
                                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                                    placeholder="선택 입력"
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
                                  <Save className="h-4 w-4" /> 재료 설정 저장
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {activeProfiles.length === 0 && (
                    <tr><td colSpan={editable ? 7 : 6} className="px-3 py-8 text-center text-sm text-gray-400">구매정보가 등록된 재료가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-extrabold">2. 당월 매입 입력</h3>
                <p className="mt-1 text-sm text-gray-500">구매한 팩 수와 전표 총액만 입력하면 기본단위 수량이 자동 계산됩니다.</p>
              </div>
              {editable && (
                <button
                  type="button"
                  disabled={activeProfiles.length === 0}
                  onClick={() => setShowPurchaseForm((current) => !current)}
                  className="inline-flex items-center justify-center gap-1 rounded-xl bg-black px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" /> 매입 추가
                </button>
              )}
            </div>

            {showPurchaseForm && editable && (
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <label className="text-xs font-bold text-gray-600 xl:col-span-2">
                    재료
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
                    구매일
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
                    구매 팩 수
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
                    전표 총액({store.currency})
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
                    공급처
                    <input
                      value={purchaseDraft.supplier}
                      onChange={(event) => setPurchaseDraft((current) => ({ ...current, supplier: event.target.value }))}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      placeholder="선택 입력"
                    />
                  </label>
                </div>
                <label className="mt-3 block text-xs font-bold text-gray-600">
                  메모
                  <input
                    value={purchaseDraft.notes}
                    onChange={(event) => setPurchaseDraft((current) => ({ ...current, notes: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    placeholder="전표번호, 가격변동, 납품 문제 등"
                  />
                </label>
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={() => setShowPurchaseForm(false)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold">취소</button>
                  <button type="button" disabled={savingKey !== null} onClick={() => void addPurchase()} className="rounded-lg bg-black px-4 py-2 text-xs font-bold text-white disabled:opacity-40">매입 저장</button>
                </div>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="text-xs font-bold text-gray-500">이번 달 매입 총액</div>
                <div className="mt-1 text-xl font-extrabold">{store.currency} {formatAmount(purchaseTotal)}</div>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="text-xs font-bold text-gray-500">매입 건수</div>
                <div className="mt-1 text-xl font-extrabold">{purchases.length}건</div>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="text-xs font-bold text-gray-500">등록 재료</div>
                <div className="mt-1 text-xl font-extrabold">{activeProfiles.length}개</div>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-gray-200 text-[11px] text-gray-400">
                  <tr>
                    <th className="px-3 py-2">구매일</th>
                    <th className="px-3 py-2">재료</th>
                    <th className="px-3 py-2 text-right">팩 수</th>
                    <th className="px-3 py-2 text-right">기본 수량</th>
                    <th className="px-3 py-2 text-right">총액</th>
                    <th className="px-3 py-2">공급처·메모</th>
                    {editable && <th className="px-3 py-2 text-right">삭제</th>}
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
                        <td className="px-3 py-3 text-right">{formatAmount(purchase.packages, 3)} {profile?.purchaseUnit ?? '팩'}</td>
                        <td className="px-3 py-3 text-right">{formatAmount(purchase.baseQuantity, 3)} {ingredient?.unit ?? ''}</td>
                        <td className="px-3 py-3 text-right font-bold">{purchase.currency} {formatAmount(purchase.totalCost)}</td>
                        <td className="px-3 py-3 text-xs text-gray-500">{[purchase.supplier, purchase.notes].filter(Boolean).join(' · ') || '—'}</td>
                        {editable && (
                          <td className="px-3 py-3 text-right">
                            <button
                              type="button"
                              aria-label={`${purchase.purchaseDate} ${ingredient?.name ?? purchase.ingredientId} 매입 삭제`}
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
                    <tr><td colSpan={editable ? 7 : 6} className="px-3 py-8 text-center text-sm text-gray-400">이번 달 매입 내역이 없습니다.</td></tr>
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
              <h3 className="text-lg font-extrabold">월말 재고 마감</h3>
              <p className="mt-1 text-sm text-gray-500">
                월초 + 매입 + 조정 - 월말 = 실제 사용량입니다. 기본 수량만 입력하고 상세 단가는 필요할 때 펼쳐 보세요.
              </p>
            </div>
            <div className={`rounded-xl px-4 py-2 text-sm font-extrabold ${
              inventoryComplete ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
            }`}>
              {completedCounts}/{activeProfiles.length}개 마감 완료
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-gray-50 p-4 text-xs leading-5 text-gray-600">
            실제로 수량을 센 재료는 <strong>실사 완료</strong>를 체크한 뒤 저장해 주세요.
            수량이 맞지 않는 행만 빨간색으로 표시됩니다.
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="border-b border-gray-200 text-[11px] text-gray-400">
                <tr>
                  <th className="px-3 py-2">재료</th>
                  <th className="px-2 py-2 text-right">월초</th>
                  <th className="px-2 py-2 text-right">매입</th>
                  <th className="px-2 py-2 text-right">폐기</th>
                  <th className="px-2 py-2 text-right">조정(+/-)</th>
                  <th className="px-2 py-2 text-right">월말</th>
                  <th className="px-3 py-2 text-right">실제 사용량</th>
                  <th className="px-3 py-2 text-center">마감</th>
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
                          {invalidUsage && <div className="mt-1 text-[10px] font-bold text-red-600">수량 확인 필요</div>}
                          <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() => setExpandedInventoryId(expanded ? null : profile.ingredientId)}
                            className="mt-2 text-[10px] font-bold text-gray-500 underline underline-offset-2 hover:text-black"
                          >
                            {expanded ? '단가·메모 닫기' : '단가·메모'}
                          </button>
                        </td>
                        <td className="px-2 py-3 text-right">
                          <input
                            aria-label={`${ingredient?.name ?? profile.ingredientId} 월초 재고`}
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
                            aria-label={`${ingredient?.name ?? profile.ingredientId} 폐기 수량`}
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
                            aria-label={`${ingredient?.name ?? profile.ingredientId} 재고 조정`}
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
                            aria-label={`${ingredient?.name ?? profile.ingredientId} 월말 재고`}
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
                              {row.countComplete ? '완료' : '미완료'}
                            </label>
                            {editable && (
                              <button
                                type="button"
                                disabled={savingKey !== null || invalidUsage}
                                onClick={() => void saveInventoryRow(profile.ingredientId)}
                                className="inline-flex items-center gap-1 rounded-lg bg-black px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                              >
                                <Save className="h-4 w-4" /> 저장
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
                                월초 단가({store.currency}/{ingredient?.unit ?? 'unit'})
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
                                    ? `전월 말 단가: ${formatAmount(previousClosingCosts[profile.ingredientId], 6)}`
                                    : '첫 달은 공급처 단가를 확인해 주세요'}
                                </span>
                              </label>
                              <div className="text-xs font-bold text-gray-600">
                                이동평균 월말 단가
                                <div className="mt-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900">
                                  {formatAmount(valuation?.closingUnitCost ?? 0, 6)}
                                </div>
                                <div className="mt-1 text-[10px] font-normal text-gray-400">자동 계산</div>
                              </div>
                              <div className="text-xs font-bold text-gray-600">
                                월초 재고금액
                                <div className="mt-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900">
                                  {store.currency} {formatAmount(valuation?.openingValue ?? 0)}
                                </div>
                              </div>
                              <div className="text-xs font-bold text-gray-600">
                                월말 재고금액
                                <div className="mt-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900">
                                  {store.currency} {formatAmount(valuation?.closingValue ?? 0)}
                                </div>
                              </div>
                              <label className="text-xs font-bold text-gray-600">
                                메모
                                <input
                                  value={row.notes}
                                  disabled={!editable}
                                  onChange={(event) => updateInventoryDraft(profile.ingredientId, { notes: event.target.value })}
                                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm disabled:bg-gray-100"
                                  placeholder="수량 차이 사유 등"
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
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-gray-400">먼저 재료 구매정보를 등록해 주세요.</td></tr>
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
