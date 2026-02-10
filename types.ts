export enum UserRole {
  OWNER = 'OWNER',
  HQ = 'HQ'
}

export interface User {
  email: string;
  name: string;
  photoUrl?: string;
  role: UserRole;
  storeId?: string; // Optional because HQ doesn't have a specific store
}

export interface Store {
  id: string;
  name: string;
  country: string;
  city: string; // Added City
  ownerEmail: string;
  currency: string;
  royaltyPercentage: number; // New: Royalty Rate (e.g., 5 for 5%)
}

export interface Employee {
  id: string;
  storeId: string;
  name: string;
  position: string;
  age?: number; // Added Age field
  imageUrl?: string; // Added imageUrl for Staff photos
}

export interface Ingredient {
  id: string;
  name: string;
  unit: string;
}

export interface RecipeItem {
  ingredientId: string;
  quantity: number;
}

export interface Menu {
  id: string;
  storeId: string;
  category: string;
  name: string;
  price: number;
  imageUrl?: string;
  recipe: RecipeItem[];
}

export interface SaleItem {
  menuId: string;
  quantity: number;
}

export interface Sale {
  id: string;
  storeId: string;
  date: string; // ISO Date string YYYY-MM-DD
  totalAmount: number;
  items: SaleItem[];
  receiptImage?: string;
  isClosed?: boolean; // New: Flag for Closed/Rest days
  closedReason?: string; // Optional reason when closed
}

export interface InventoryLog {
  storeId: string;
  ingredientId: string;
  totalConsumed: number;
  threshold: number;
}

export enum ABCGrade {
  A = 'A', // Top 70% revenue
  B = 'B', // Next 20%
  C = 'C'  // Bottom 10%
}
