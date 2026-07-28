import type { Menu, Sale, SetMenu } from './types';

export type IngredientCostInput = {
  unitCost: number | null;
  actualUsage: number | null;
  wasteQuantity: number;
};

export type MenuCostRow = {
  menuId: string;
  name: string;
  category: string;
  price: number;
  directUnits: number;
  courseUnits: number;
  soldUnits: number;
  recipeReady: boolean;
  costReady: boolean;
  theoreticalUnitCost: number | null;
  theoreticalCostPercentage: number | null;
  monthlyTheoreticalCost: number | null;
};

export type CourseCostRow = {
  setMenuId: string;
  name: string;
  price: number;
  soldUnits: number;
  componentCount: number;
  recipeReady: boolean;
  costReady: boolean;
  theoreticalUnitCost: number | null;
  theoreticalCostPercentage: number | null;
  monthlyTheoreticalCost: number | null;
};

export type IngredientUsageRow = {
  ingredientId: string;
  theoreticalUsage: number;
  actualUsage: number | null;
  usageVariance: number | null;
  variancePercentage: number | null;
  unitCost: number | null;
  theoreticalCost: number | null;
  varianceValue: number | null;
  wasteQuantity: number;
};

export type TheoreticalCostAnalysis = {
  menuRows: MenuCostRow[];
  courseRows: CourseCostRow[];
  ingredientRows: IngredientUsageRow[];
  theoreticalCost: number;
  recipeCoveragePercentage: number | null;
  costCoveragePercentage: number | null;
  recipeCoveredUnits: number;
  costCoveredUnits: number;
  totalKnownMenuUnits: number;
  unknownDirectUnits: number;
  unknownCourseSalesUnits: number;
  setsWithoutComponentsUnits: number;
  categoryBreakdownMismatchUnits: number;
  soldMenuRowsMissingRecipe: number;
  soldMenuRowsMissingCost: number;
  analysisReady: boolean;
};

type BuildInput = {
  storeId: string;
  monthKey: string;
  sales: Sale[];
  menus: Menu[];
  setMenus: SetMenu[];
  ingredientCosts: ReadonlyMap<string, IngredientCostInput>;
};

function addToMap(target: Map<string, number>, key: string, amount: number): void {
  if (!key || !Number.isFinite(amount) || amount <= 0) return;
  target.set(key, (target.get(key) ?? 0) + amount);
}

export function buildTheoreticalCostAnalysis({
  storeId,
  monthKey,
  sales,
  menus,
  setMenus,
  ingredientCosts,
}: BuildInput): TheoreticalCostAnalysis {
  const storeMenus = menus.filter((menu) => menu.storeId === storeId);
  const storeSets = setMenus.filter((setMenu) => setMenu.storeId === storeId);
  const menuById = new Map(storeMenus.map((menu) => [menu.id, menu]));
  const setById = new Map(storeSets.map((setMenu) => [setMenu.id, setMenu]));
  const knownCategories = new Set(storeMenus.map((menu) => menu.category).filter(Boolean));
  const directUnitsByMenu = new Map<string, number>();
  const courseUnitsByMenu = new Map<string, number>();
  const soldUnitsBySet = new Map<string, number>();
  let unknownDirectUnits = 0;
  let unknownCourseSalesUnits = 0;
  let setsWithoutComponentsUnits = 0;
  let categoryBreakdownMismatchUnits = 0;

  sales
    .filter((sale) => sale.storeId === storeId && sale.date.startsWith(`${monthKey}-`) && !sale.isClosed)
    .forEach((sale) => {
      const directUnitsByCategory = new Map<string, number>();
      const courseUnitsByCategory = new Map<string, number>();
      (sale.menuItems ?? []).forEach((item) => {
        const quantity = Number(item.quantity || 0);
        const menu = menuById.get(item.menuId);
        if (!menu) {
          unknownDirectUnits += Math.max(0, quantity);
          return;
        }
        addToMap(directUnitsByMenu, item.menuId, quantity);
        addToMap(directUnitsByCategory, menu.category, quantity);
      });

      (sale.setItems ?? []).forEach((setItem) => {
        const soldSets = Number(setItem.quantity || 0);
        const setMenu = setById.get(setItem.setMenuId);
        if (!setMenu) {
          unknownCourseSalesUnits += Math.max(0, soldSets);
          return;
        }
        addToMap(soldUnitsBySet, setMenu.id, soldSets);
        if (setMenu.items.length === 0) {
          setsWithoutComponentsUnits += Math.max(0, soldSets);
          return;
        }
        setMenu.items.forEach((component) => {
          const componentUnits = soldSets * Number(component.quantity || 0);
          if (!menuById.has(component.menuId)) {
            unknownCourseSalesUnits += Math.max(0, componentUnits);
            return;
          }
          const componentMenu = menuById.get(component.menuId);
          addToMap(courseUnitsByMenu, component.menuId, componentUnits);
          if (componentMenu) addToMap(courseUnitsByCategory, componentMenu.category, componentUnits);
        });
      });

      const reportedCategoryUnits = new Map<string, number>();
      sale.items.forEach((item) => {
        if (knownCategories.has(item.menuId)) addToMap(reportedCategoryUnits, item.menuId, Number(item.quantity || 0));
      });
      if (reportedCategoryUnits.size > 0) {
        knownCategories.forEach((category) => {
          const expectedDirectUnits = Math.max(
            0,
            (reportedCategoryUnits.get(category) ?? 0) - (courseUnitsByCategory.get(category) ?? 0),
          );
          const detailedDirectUnits = directUnitsByCategory.get(category) ?? 0;
          categoryBreakdownMismatchUnits += Math.abs(expectedDirectUnits - detailedDirectUnits);
        });
      }
    });

  const ingredientUsage = new Map<string, number>();
  const menuRows = storeMenus
    .map((menu): MenuCostRow => {
      const directUnits = directUnitsByMenu.get(menu.id) ?? 0;
      const courseUnits = courseUnitsByMenu.get(menu.id) ?? 0;
      const soldUnits = directUnits + courseUnits;
      const recipeReady = menu.recipe.length > 0
        && menu.recipe.every((item) => Number.isFinite(item.quantity) && item.quantity > 0);
      const costReady = recipeReady && menu.recipe.every((item) => {
        const input = ingredientCosts.get(item.ingredientId);
        return input?.unitCost != null && Number.isFinite(input.unitCost) && input.unitCost >= 0;
      });
      const theoreticalUnitCost = costReady
        ? menu.recipe.reduce(
          (sum, item) => sum + item.quantity * Number(ingredientCosts.get(item.ingredientId)?.unitCost ?? 0),
          0,
        )
        : null;

      if (recipeReady && soldUnits > 0) {
        menu.recipe.forEach((item) => addToMap(
          ingredientUsage,
          item.ingredientId,
          soldUnits * item.quantity,
        ));
      }

      return {
        menuId: menu.id,
        name: menu.name,
        category: menu.category,
        price: menu.price,
        directUnits,
        courseUnits,
        soldUnits,
        recipeReady,
        costReady,
        theoreticalUnitCost,
        theoreticalCostPercentage: theoreticalUnitCost !== null && menu.price > 0
          ? (theoreticalUnitCost / menu.price) * 100
          : null,
        monthlyTheoreticalCost: theoreticalUnitCost !== null
          ? theoreticalUnitCost * soldUnits
          : null,
      };
    })
    .filter((row) => row.soldUnits > 0)
    .sort((left, right) => right.soldUnits - left.soldUnits || left.name.localeCompare(right.name));

  const menuCostById = new Map(menuRows.map((row) => [row.menuId, row]));
  const courseRows = storeSets
    .map((setMenu): CourseCostRow => {
      const soldUnits = soldUnitsBySet.get(setMenu.id) ?? 0;
      const recipeReady = setMenu.items.length > 0 && setMenu.items.every((component) => {
        const menu = menuById.get(component.menuId);
        return Boolean(menu?.recipe.length) && Number(component.quantity) > 0;
      });
      const costReady = recipeReady && setMenu.items.every((component) => {
        const row = menuCostById.get(component.menuId)
          ?? (() => {
            const menu = menuById.get(component.menuId);
            if (!menu) return null;
            const ready = menu.recipe.length > 0 && menu.recipe.every((item) => {
              const input = ingredientCosts.get(item.ingredientId);
              return input?.unitCost != null && Number.isFinite(input.unitCost) && input.unitCost >= 0;
            });
            if (!ready) return null;
            return {
              theoreticalUnitCost: menu.recipe.reduce(
                (sum, item) => sum + item.quantity * Number(ingredientCosts.get(item.ingredientId)?.unitCost ?? 0),
                0,
              ),
            };
          })();
        return row?.theoreticalUnitCost != null;
      });
      const theoreticalUnitCost = costReady
        ? setMenu.items.reduce((sum, component) => {
          const menu = menuById.get(component.menuId);
          if (!menu) return sum;
          const componentCost = menu.recipe.reduce(
            (recipeSum, item) => recipeSum + item.quantity * Number(ingredientCosts.get(item.ingredientId)?.unitCost ?? 0),
            0,
          );
          return sum + componentCost * component.quantity;
        }, 0)
        : null;

      return {
        setMenuId: setMenu.id,
        name: setMenu.name,
        price: setMenu.price,
        soldUnits,
        componentCount: setMenu.items.length,
        recipeReady,
        costReady,
        theoreticalUnitCost,
        theoreticalCostPercentage: theoreticalUnitCost !== null && setMenu.price > 0
          ? (theoreticalUnitCost / setMenu.price) * 100
          : null,
        monthlyTheoreticalCost: theoreticalUnitCost !== null
          ? theoreticalUnitCost * soldUnits
          : null,
      };
    })
    .filter((row) => row.soldUnits > 0)
    .sort((left, right) => right.soldUnits - left.soldUnits || left.name.localeCompare(right.name));

  const ingredientRows = Array.from(ingredientUsage.entries())
    .map(([ingredientId, theoreticalUsage]): IngredientUsageRow => {
      const input = ingredientCosts.get(ingredientId);
      const actualUsage = input?.actualUsage ?? null;
      const unitCost = input?.unitCost ?? null;
      const usageVariance = actualUsage === null ? null : actualUsage - theoreticalUsage;
      return {
        ingredientId,
        theoreticalUsage,
        actualUsage,
        usageVariance,
        variancePercentage: usageVariance !== null && theoreticalUsage > 0
          ? (usageVariance / theoreticalUsage) * 100
          : null,
        unitCost,
        theoreticalCost: unitCost === null ? null : theoreticalUsage * unitCost,
        varianceValue: unitCost === null || usageVariance === null ? null : usageVariance * unitCost,
        wasteQuantity: input?.wasteQuantity ?? 0,
      };
    })
    .sort((left, right) => (right.varianceValue ?? -Infinity) - (left.varianceValue ?? -Infinity));

  const totalKnownMenuUnits = menuRows.reduce((sum, row) => sum + row.soldUnits, 0);
  const recipeCoveredUnits = menuRows.reduce(
    (sum, row) => sum + (row.recipeReady ? row.soldUnits : 0),
    0,
  );
  const costCoveredUnits = menuRows.reduce(
    (sum, row) => sum + (row.costReady ? row.soldUnits : 0),
    0,
  );
  const theoreticalCost = menuRows.reduce(
    (sum, row) => sum + (row.monthlyTheoreticalCost ?? 0),
    0,
  );
  const soldMenuRowsMissingRecipe = menuRows.filter((row) => !row.recipeReady).length;
  const soldMenuRowsMissingCost = menuRows.filter((row) => row.recipeReady && !row.costReady).length;
  const coverageDenominator = totalKnownMenuUnits + categoryBreakdownMismatchUnits;
  const recipeCoveragePercentage = coverageDenominator > 0
    ? (recipeCoveredUnits / coverageDenominator) * 100
    : null;
  const costCoveragePercentage = coverageDenominator > 0
    ? (costCoveredUnits / coverageDenominator) * 100
    : null;
  const analysisReady = coverageDenominator > 0
    && recipeCoveredUnits === coverageDenominator
    && costCoveredUnits === coverageDenominator
    && unknownDirectUnits === 0
    && unknownCourseSalesUnits === 0
    && setsWithoutComponentsUnits === 0
    && categoryBreakdownMismatchUnits === 0;

  return {
    menuRows,
    courseRows,
    ingredientRows,
    theoreticalCost,
    recipeCoveragePercentage,
    costCoveragePercentage,
    recipeCoveredUnits,
    costCoveredUnits,
    totalKnownMenuUnits,
    unknownDirectUnits,
    unknownCourseSalesUnits,
    setsWithoutComponentsUnits,
    categoryBreakdownMismatchUnits,
    soldMenuRowsMissingRecipe,
    soldMenuRowsMissingCost,
    analysisReady,
  };
}
