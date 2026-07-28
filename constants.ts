import { Store, Menu, Ingredient, Sale, Employee, User, UserRole } from './types';

export const MOCK_USERS: User[] = [
  { email: 'owner@kr1.chibo.com', name: 'Kim Chibo', role: UserRole.OWNER, storeId: 'S1' },
  { email: 'owner@hanoi.chibo.com', name: 'Nguyen Van A', role: UserRole.OWNER, storeId: 'S2' },
  { email: 'hq@chibo.com', name: 'HQ Admin', role: UserRole.HQ },
];

// Stores based on the provided screenshot
export const MOCK_STORES: Store[] = [
  { id: 'S1', name: 'KR Goraewa co.', country: 'South Korea', city: 'Seoul', ownerEmail: 'owner@kr1.chibo.com', currency: 'JPY', royaltyPercentage: 5.0 },
  { id: 'S2', name: 'Ha Noi Kim Ma', country: 'Vietnam', city: 'Hanoi', ownerEmail: 'owner@hanoi.chibo.com', currency: 'USD', royaltyPercentage: 5.0 },
  { id: 'S3', name: 'Mitsukoshi BGC', country: 'Philippines', city: 'Manila', ownerEmail: 'owner@manila.chibo.com', currency: 'JPY', royaltyPercentage: 5.0 },
  { id: 'S4', name: '阪急寧波店 (Hankyu Ningbo)', country: 'China', city: 'Ningbo', ownerEmail: 'owner@ningbo.chibo.com', currency: 'JPY', royaltyPercentage: 5.0 },
  { id: 'S5', name: '漢神巨蛋購物廣場店 (Hanshin Arena)', country: 'Taiwan', city: 'Kaohsiung', ownerEmail: 'owner@kaohsiung.chibo.com', currency: 'USD', royaltyPercentage: 5.0 },
  { id: 'S6', name: 'Trung Hòa Nhân Chính', country: 'Vietnam', city: 'Hanoi', ownerEmail: 'owner@trung.chibo.com', currency: 'USD', royaltyPercentage: 5.0 },
  { id: 'S7', name: 'KR 1 Gangnam Sinsa', country: 'South Korea', city: 'Seoul', ownerEmail: 'owner@sinsa.chibo.com', currency: 'JPY', royaltyPercentage: 5.0 },
  { id: 'S8', name: 'KR 2 Seolleung', country: 'South Korea', city: 'Seoul', ownerEmail: 'owner@seolleung.chibo.com', currency: 'JPY', royaltyPercentage: 5.0 },
  { id: 'S9', name: 'KR Apgujeong', country: 'South Korea', city: 'Seoul', ownerEmail: 'owner@apgujeong.chibo.com', currency: 'JPY', royaltyPercentage: 5.0 },
  { id: 'S10', name: 'KR Daejeon', country: 'South Korea', city: 'Daejeon', ownerEmail: 'owner@daejeon.chibo.com', currency: 'JPY', royaltyPercentage: 5.0 },
  { id: 'S11', name: 'Otafuku', country: 'Others', city: 'Unknown', ownerEmail: 'owner@otafuku.chibo.com', currency: 'JPY', royaltyPercentage: 5.0 },
  { id: 'S12', name: 'KR 3 Yongsan Samgakji', country: 'South Korea', city: 'Seoul', ownerEmail: 'owner@yongsan.chibo.com', currency: 'JPY', royaltyPercentage: 5.0 },
];

export const MOCK_INGREDIENTS: Ingredient[] = [
  { id: 'I1', name: 'Cabbage', unit: 'g' },
  { id: 'I2', name: 'Pork Belly', unit: 'g' },
  { id: 'I3', name: 'Okonomiyaki Flour', unit: 'g' },
  { id: 'I4', name: 'Egg', unit: 'pcs' },
  { id: 'I5', name: 'Otafuku Sauce', unit: 'ml' },
  { id: 'I6', name: 'Noodles', unit: 'g' },
];

export const MOCK_MENUS: Menu[] = [
  { 
    id: 'M1', storeId: 'S1', category: 'Okonomiyaki', name: 'Chibo Okonomiyaki', price: 1500, 
    imageUrl: 'https://loremflickr.com/400/300/pancake,food?random=1',
    recipe: [{ ingredientId: 'I1', quantity: 150 }, { ingredientId: 'I2', quantity: 50 }, { ingredientId: 'I3', quantity: 100 }, { ingredientId: 'I5', quantity: 30 }] 
  },
  { 
    id: 'M2', storeId: 'S1', category: 'Yakisoba', name: 'Pork Yakisoba', price: 1200, 
    imageUrl: 'https://loremflickr.com/400/300/noodle,food?random=2',
    recipe: [{ ingredientId: 'I6', quantity: 200 }, { ingredientId: 'I2', quantity: 40 }, { ingredientId: 'I5', quantity: 40 }] 
  },
  { 
    id: 'M3', storeId: 'S2', category: 'Okonomiyaki', name: 'Kimchi Okonomiyaki', price: 18000, 
    imageUrl: 'https://loremflickr.com/400/300/kimchi,pancake?random=3',
    recipe: [{ ingredientId: 'I1', quantity: 150 }, { ingredientId: 'I3', quantity: 100 }, { ingredientId: 'I5', quantity: 30 }] 
  },
   { 
    id: 'M4', storeId: 'S1', category: 'Side Menu', name: 'Edamame', price: 500, 
    imageUrl: 'https://loremflickr.com/400/300/edamame?random=4',
    recipe: [] 
  },
  { 
    id: 'M5', storeId: 'S1', category: 'Teppan Dishes', name: 'Gyoza', price: 600, 
    imageUrl: 'https://loremflickr.com/400/300/gyoza,dumpling?random=5',
    recipe: [] 
  },
  { 
    id: 'M6', storeId: 'S1', category: 'Alcohol', name: 'Asahi Draft', price: 550, 
    imageUrl: 'https://loremflickr.com/400/300/beer?random=6',
    recipe: [] 
  },
  { 
    id: 'M7', storeId: 'S1', category: 'Soft Drinks', name: 'Cola', price: 300, 
    imageUrl: 'https://loremflickr.com/400/300/coke,drink?random=7',
    recipe: [] 
  }
];

export const MOCK_EMPLOYEES: Employee[] = [
  { id: 'E1', storeId: 'S1', name: 'Taro Yamada', position: 'Manager', imageUrl: 'https://i.pravatar.cc/150?u=E1' },
  { id: 'E2', storeId: 'S1', name: 'Hanako Tanaka', position: 'Chef', imageUrl: 'https://i.pravatar.cc/150?u=E2' },
  { id: 'E3', storeId: 'S2', name: 'Lee Ji-eun', position: 'Server', imageUrl: 'https://i.pravatar.cc/150?u=E3' },
];

// Generate sales data including past history for YoY analysis
const today = new Date();
const formatDate = (date: Date) => date.toISOString().split('T')[0];

const generateHistory = () => {
  const sales: Sale[] = [];
  
  // Recent Days (This Month) for S1
  sales.push({ 
    id: 'SALE1', storeId: 'S1', date: formatDate(new Date(today.getTime() - 86400000)), 
    totalAmount: 150000, 
    items: [{ menuId: 'Okonomiyaki', quantity: 52 }, { menuId: 'Yakisoba', quantity: 30 }, { menuId: 'Side Menu', quantity: 22 }],
    menuItems: [{ menuId: 'M1', quantity: 50 }, { menuId: 'M2', quantity: 30 }, { menuId: 'M4', quantity: 20 }],
    setItems: [{ setMenuId: 'SM_PREVIEW_1', quantity: 2 }],
  });
  sales.push({ 
    id: 'SALE2', storeId: 'S1', date: formatDate(new Date(today.getTime() - 172800000)), 
    totalAmount: 135000, 
    items: [{ menuId: 'Okonomiyaki', quantity: 40 }, { menuId: 'Yakisoba', quantity: 40 }],
    menuItems: [{ menuId: 'M1', quantity: 40 }, { menuId: 'M2', quantity: 40 }],
  });
  // Recent Days for S2
  sales.push({ 
    id: 'SALE3', storeId: 'S2', date: formatDate(new Date(today.getTime() - 172800000)), 
    totalAmount: 1800, // USD likely
    items: [{ menuId: 'Okonomiyaki', quantity: 80 }],
    menuItems: [{ menuId: 'M3', quantity: 80 }],
  });

  // Last Month Data (Mock)
  sales.push({
    id: 'SALE_LM1', storeId: 'S1', date: formatDate(new Date(today.getFullYear(), today.getMonth() - 1, 15)),
    totalAmount: 140000, items: [{ menuId: 'Okonomiyaki', quantity: 45 }], menuItems: [{ menuId: 'M1', quantity: 45 }]
  });
  sales.push({
    id: 'SALE_LM2', storeId: 'S2', date: formatDate(new Date(today.getFullYear(), today.getMonth() - 1, 15)),
    totalAmount: 1750, items: [{ menuId: 'Okonomiyaki', quantity: 70 }], menuItems: [{ menuId: 'M3', quantity: 70 }]
  });

  // Last Year Data (Same Month) for YoY
  sales.push({
    id: 'SALE_LY1', storeId: 'S1', date: formatDate(new Date(today.getFullYear() - 1, today.getMonth(), 15)),
    totalAmount: 120000, items: [{ menuId: 'Okonomiyaki', quantity: 40 }], menuItems: [{ menuId: 'M1', quantity: 40 }]
  });
  sales.push({
    id: 'SALE_LY2', storeId: 'S2', date: formatDate(new Date(today.getFullYear() - 1, today.getMonth(), 15)),
    totalAmount: 1500, items: [{ menuId: 'Okonomiyaki', quantity: 60 }], menuItems: [{ menuId: 'M3', quantity: 60 }]
  });

  return sales;
}

export const MOCK_SALES: Sale[] = generateHistory();
