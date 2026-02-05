import React, { useState, useEffect, useMemo } from 'react';
import { User, Store, Menu, Sale, Employee, UserRole, Ingredient, SaleItem, RecipeItem } from './types';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line, ComposedChart, Cell, PieChart, Pie
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

async function loadStores(): Promise<Store[]> {
  const { data, error } = await supabase.from('stores').select('*').order('id');
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
  const { data, error } = await supabase.from('ingredients').select('*').order('id');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, unit: r.unit }));
}

async function loadEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase.from('employees').select('*').order('id');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    storeId: r.store_id,
    name: r.name,
    position: r.position,
    age: r.age ?? undefined,
    imageUrl: r.image_url ?? undefined,
  }));
}

async function loadMenus(): Promise<Menu[]> {
  const { data: menusData, error: menusErr } = await supabase.from('menus').select('*').order('id');
  if (menusErr) throw menusErr;

  const { data: recipeData, error: recipeErr } = await supabase.from('menu_recipe_items').select('*');
  if (recipeErr) throw recipeErr;

  const recipeByMenu: Record<string, RecipeItem[]> = {};
  (recipeData ?? []).forEach((r: any) => {
    const arr = recipeByMenu[r.menu_id] ?? [];
    arr.push({ ingredientId: r.ingredient_id, quantity: Number(r.quantity) });
    recipeByMenu[r.menu_id] = arr;
  });

  return (menusData ?? []).map((m: any) => ({
    id: m.id,
    storeId: m.store_id,
    category: m.category,
    name: m.name,
    price: Number(m.price),
    imageUrl: m.image_url ?? undefined,
    recipe: recipeByMenu[m.id] ?? [],
  }));
}

async function loadSales(): Promise<Sale[]> {
  const { data: salesData, error: salesErr } = await supabase.from('sales').select('*').order('date', { ascending: false });
  if (salesErr) throw salesErr;

  const { data: itemData, error: itemErr } = await supabase.from('sale_items').select('*');
  if (itemErr) throw itemErr;

  const itemsBySale: Record<string, SaleItem[]> = {};
  (itemData ?? []).forEach((r: any) => {
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
    receiptImage: s.receipt_image ?? undefined,
    isClosed: Boolean(s.is_closed),
  }));
}

async function saveMenu(menu: Menu) {
  const { error: mErr } = await supabase.from('menus').upsert({
    id: menu.id,
    store_id: menu.storeId,
    category: menu.category,
    name: menu.name,
    price: menu.price,
    image_url: menu.imageUrl ?? null,
  });
  if (mErr) throw mErr;

  await supabase.from('menu_recipe_items').delete().eq('menu_id', menu.id);
  if (menu.recipe?.length) {
    const rows = menu.recipe.map(r => ({
      menu_id: menu.id,
      ingredient_id: r.ingredientId,
      quantity: r.quantity,
    }));
    const { error } = await supabase.from('menu_recipe_items').insert(rows);
    if (error) throw error;
  }
}

async function deleteMenu(menuId: string) {
  const { error } = await supabase.from('menus').delete().eq('id', menuId);
  if (error) throw error;
}

async function saveEmployees(storeId: string, emps: Employee[]) {
  await supabase.from('employees').delete().eq('store_id', storeId);
  if (emps.length) {
    const rows = emps.map(e => ({
      id: e.id,
      store_id: storeId,
      name: e.name,
      position: e.position,
      age: e.age ?? null,
      image_url: e.imageUrl ?? null,
    }));
    const { error } = await supabase.from('employees').insert(rows);
    if (error) throw error;
  }
}

async function addIngredient(ing: Ingredient) {
  const { error } = await supabase.from('ingredients').insert({
    id: ing.id,
    name: ing.name,
    unit: ing.unit,
  });
  if (error) throw error;
}

async function addSale(sale: Sale) {
  const { error: sErr } = await supabase.from('sales').insert({
    id: sale.id,
    store_id: sale.storeId,
    date: sale.date,
    total_amount: sale.totalAmount,
    receipt_image: sale.receiptImage ?? null,
    is_closed: sale.isClosed ?? false,
  });
  if (sErr) throw sErr;

  if (sale.items?.length) {
    const rows = sale.items.map(i => ({
      sale_id: sale.id,
      menu_id: i.menuId,
      quantity: i.quantity,
    }));
    const { error } = await supabase.from('sale_items').insert(rows);
    if (error) throw error;
  }
}




// --- Helper Functions ---
const formatDate = (date: Date) => date.toISOString().split('T')[0];

const getMissingDates = (sales: Sale[], storeId: string) => {
  const dates: string[] = [];
  const today = new Date();
  // Check last 7 days (excluding today as it might not be over)
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = formatDate(d);
    const hasReport = sales.some(s => s.storeId === storeId && s.date === dateStr);
    if (!hasReport) dates.push(dateStr);
  }
  return dates;
};

// Mock Exchange Rates for HQ View (Normalize to USD)
const EXCHANGE_RATES: Record<string, number> = {
  'JPY': 0.0067,
  'KRW': 0.00075,
  'USD': 1.0,
  'VND': 0.000041,
  'THB': 0.028
};

// --- Components ---

const SalesAnalyticsModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    sales: Sale[];
    stores: Store[];
}> = ({ isOpen, onClose, sales, stores }) => {
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

            // Normalize amount to USD
            const rate = EXCHANGE_RATES[store.currency] || 1;
            const amountUSD = sale.totalAmount * rate;

            let key = '';
            if (activeTab === 'period') {
                key = sale.date.substring(0, 7); // YYYY-MM
            } else if (activeTab === 'country') {
                key = store.country;
            } else if (activeTab === 'store') {
                key = store.name;
            }

            if (key) {
                data[key] = (data[key] || 0) + amountUSD;
            }
        });

        return Object.entries(data)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => activeTab === 'period' ? a.name.localeCompare(b.name) : b.value - a.value);
    }, [sales, stores, activeTab]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b flex justify-between items-center bg-gray-50">
                    <div>
                        <h2 className="text-2xl font-bold flex items-center gap-2">
                            <BarChart3 className="w-6 h-6"/> Sales Analytics
                        </h2>
                        <p className="text-sm text-gray-500">Detailed breakdown of network performance (Normalized to USD)</p>
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
                                            formatter={(value: number) => [`$${value.toLocaleString(undefined, {maximumFractionDigits: 0})}`, 'Revenue']}
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
                                            <th className="p-4 text-right">Total Revenue (USD Est.)</th>
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
                                                    <td className="p-4 text-right font-bold">${item.value.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
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

const FinancialsTable: React.FC<{ stores: Store[]; sales: Sale[] }> = ({ stores, sales }) => {
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
                        <th className="p-4 text-right font-extrabold tracking-wider">Revenue (Local)</th>
                        <th className="p-4 text-right font-extrabold tracking-wider">Revenue (USD Est.)</th>
                        <th className="p-4 text-right font-extrabold tracking-wider">Royalty (Est.)</th>
                        <th className="p-4 text-center font-extrabold tracking-wider">Health</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                    {stores.map(store => {
                        const storeSales = sales.filter(s => s.storeId === store.id);
                        const totalRevenue = storeSales.reduce((sum, s) => sum + s.totalAmount, 0);
                        const rate = EXCHANGE_RATES[store.currency] || 1;
                        const totalUSD = totalRevenue * rate;
                        const royalty = totalUSD * (store.royaltyPercentage / 100);

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
                                    ${totalUSD.toLocaleString(undefined, {maximumFractionDigits: 0})}
                                </td>
                                <td className="p-4 text-right font-mono text-indigo-600 font-bold">
                                    ${royalty.toLocaleString(undefined, {maximumFractionDigits: 0})}
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
  onSave: (sale: Sale) => void;
  onCancel: () => void;
}> = ({ store, sales, menus, categories, initialDate, onSave, onCancel }) => {
  const [date, setDate] = useState(initialDate || formatDate(new Date()));
  const [items, setItems] = useState<SaleItem[]>([]); // Store category name in menuId
  const [isClosed, setIsClosed] = useState(false);
  const [receiptImage, setReceiptImage] = useState<string | null>(null);
  const [manualRevenue, setManualRevenue] = useState<string>('');

  useEffect(() => {
      // Pre-fill if editing existing? For now just new
  }, []);

  const handleQuantityInput = (categoryName: string, val: string) => {
    const newQty = parseInt(val) || 0;
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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
            setReceiptImage(reader.result as string);
        };
        reader.readAsDataURL(file);
    }
  };

  const handleSave = () => {
    const totalAmount = isClosed ? 0 : (parseFloat(manualRevenue) || 0);
    const newSale: Sale = {
      id: `SALE_${Date.now()}`,
      storeId: store.id,
      date,
      totalAmount,
      items: isClosed ? [] : items,
      isClosed,
      receiptImage: receiptImage || undefined
    };
    onSave(newSale);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={onCancel} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft className="w-5 h-5"/></button>
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

        {!isClosed && (
            <div>
              <div className="mb-8">
                  <label className="block text-sm font-bold text-gray-700 mb-2">Total Daily Revenue ({store.currency})</label>
                  <input 
                    type="number" 
                    value={manualRevenue} 
                    onChange={e => setManualRevenue(e.target.value)}
                    placeholder="Enter total sales amount"
                    className="w-full p-4 bg-gray-50 rounded-xl font-bold text-2xl border border-gray-200 focus:border-black outline-none"
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
                                type="number" 
                                min="0"
                                className="w-16 p-2 text-center border border-gray-200 rounded-lg font-bold text-lg focus:ring-2 focus:ring-black outline-none"
                                value={qty}
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

        <div className="flex gap-4 pt-4">
            <button onClick={onCancel} className="flex-1 py-3 font-bold text-gray-500 hover:bg-gray-50 rounded-xl">Cancel</button>
            <button onClick={handleSave} className="flex-1 py-3 bg-black text-white font-bold rounded-xl hover:bg-gray-800 shadow-lg">Submit Report</button>
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
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Menu Management</h2>
        <button 
          onClick={() => onCreate({
            id: `M_${Date.now()}`,
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
                    <img src={menu.imageUrl} className="w-full h-full object-cover" alt={menu.name} />
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
    </div>
  );
};

const RecipeEditor: React.FC<{
    menu: Menu;
    ingredients: Ingredient[];
    categories: string[];
    standardIngredients: { name: string; unit: string }[];
    onAddIngredient: (ing: Ingredient) => void;
    onSave: (menu: Menu) => void;
    onBack: () => void;
}> = ({ menu, ingredients, categories, standardIngredients, onAddIngredient, onSave, onBack }) => {
    const [editedMenu, setEditedMenu] = useState(menu);
    const [newIngName, setNewIngName] = useState('');
    const [newIngUnit, setNewIngUnit] = useState('');
    const [newIngQty, setNewIngQty] = useState('');

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setEditedMenu({ ...editedMenu, imageUrl: reader.result as string });
            };
            reader.readAsDataURL(file);
        }
    };

    const handleAddIngredientToRecipe = () => {
        if (!newIngName || !newIngUnit || !newIngQty) return;
        const qty = parseFloat(newIngQty);
        if (qty <= 0) return;

        // Check if ingredient exists globally (by name and unit)
        let existingIng = ingredients.find(
            i => i.name.toLowerCase() === newIngName.toLowerCase() && i.unit.toLowerCase() === newIngUnit.toLowerCase()
        );

        let ingredientId = existingIng?.id;

        if (!ingredientId) {
            // Create new ingredient globally
            const newIngredient: Ingredient = {
                id: `I_${Date.now()}`,
                name: newIngName,
                unit: newIngUnit
            };
            onAddIngredient(newIngredient);
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
        const newRecipe = editedMenu.recipe.map(r => {
            if (r.ingredientId === ingId) return { ...r, quantity: qty };
            return r;
        }).filter(r => r.quantity > 0);
        setEditedMenu({ ...editedMenu, recipe: newRecipe });
    };

    const removeIngredient = (ingId: string) => {
        setEditedMenu({
            ...editedMenu,
            recipe: editedMenu.recipe.filter(r => r.ingredientId !== ingId)
        });
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={onBack}>
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
                            <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                            {editedMenu.imageUrl ? (
                                <div className="relative h-64 w-full">
                                    <img src={editedMenu.imageUrl} alt="Menu Preview" className="h-full w-full object-contain rounded-lg" />
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition text-white font-bold">
                                        Click to Change Image
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center py-8">
                                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mb-3">
                                        <Camera className="w-6 h-6 text-gray-400" />
                                    </div>
                                    <span className="text-sm font-bold text-gray-600">Upload Menu Photo</span>
                                    <span className="text-xs text-gray-400 mt-1">Supports JPG, PNG</span>
                                </div>
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
                                * Entering a new ingredient name will automatically add it to the global ingredient list.
                            </p>
                        </div>

                        <div className="space-y-2">
                            {editedMenu.recipe.map(item => {
                                const ing = ingredients.find(i => i.id === item.ingredientId);
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
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
                    <button onClick={onBack} className="px-6 py-3 font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition">Cancel</button>
                    <button onClick={() => onSave(editedMenu)} className="bg-black text-white px-8 py-3 rounded-xl font-bold hover:bg-gray-800 shadow-lg flex items-center gap-2">
                        <Save className="w-4 h-4" /> Save Item
                    </button>
                </div>
            </div>
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
    
    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setEditedEmp({ ...editedEmp, imageUrl: reader.result as string });
            };
            reader.readAsDataURL(file);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={onBack}>
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

    const handleSave = (emp: Employee) => {
        const exists = employees.find(e => e.id === emp.id);
        if (exists) {
            onUpdate(employees.map(e => e.id === emp.id ? emp : e));
        } else {
            onUpdate([...employees, emp]);
        }
        setEditingEmp(null);
    };

    const handleDelete = (id: string) => {
        if(confirm('Are you sure you want to remove this staff member?')) {
            onUpdate(employees.filter(e => e.id !== id));
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
                        id: `E_${Date.now()}`,
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
                                    <img src={emp.imageUrl} className="w-full h-full object-cover" alt="" />
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
        </div>
    );
};

const HQStoreDetail: React.FC<{
    store: Store;
    sales: Sale[];
    menus: Menu[];
    ingredients: Ingredient[];
    categories: string[];
    standardIngredients: { name: string; unit: string }[];
    onBack: () => void;
    onUpdateMenu: (menu: Menu) => void;
    onCreateMenu: (menu: Menu) => void;
    onDeleteMenu: (id: string) => void;
    onAddIngredient: (ing: Ingredient) => void;
}> = ({ store, sales, menus, ingredients, categories, standardIngredients, onBack, onUpdateMenu, onCreateMenu, onDeleteMenu, onAddIngredient }) => {
    const storeMenus = menus.filter(m => m.storeId === store.id);
    const [editingMenu, setEditingMenu] = useState<Menu | null>(null);
    const [viewingReceipt, setViewingReceipt] = useState<string | null>(null);
    const missingDates = useMemo(() => getMissingDates(sales, store.id), [sales, store.id]);

    // --- Real-time Inventory Calculation Logic ---
    const inventoryStats = useMemo(() => {
        const stats: Record<string, { used: number; unit: string }> = {};
        standardIngredients.forEach(ing => {
            stats[ing.name] = { used: 0, unit: ing.unit };
        });

        // 1. Calculate Average Ingredient Usage per Category for this Store
        const categoryUsageMap: Record<string, Record<string, number>> = {}; // { "Okonomiyaki": { "Flour": 120, "Sauce": 30 } }

        categories.forEach(cat => {
            const catMenus = storeMenus.filter(m => m.category === cat);
            if (catMenus.length === 0) return;

            const ingTotals: Record<string, number> = {};
            
            catMenus.forEach(menu => {
                menu.recipe.forEach(r => {
                    // Match recipe ingredient ID to global ingredient definition
                    const ingDef = ingredients.find(i => i.id === r.ingredientId);
                    if (ingDef && standardIngredients.some(si => si.name === ingDef.name)) {
                        ingTotals[ingDef.name] = (ingTotals[ingDef.name] || 0) + r.quantity;
                    }
                });
            });

            // Average it out
            categoryUsageMap[cat] = {};
            Object.keys(ingTotals).forEach(ingName => {
                categoryUsageMap[cat][ingName] = ingTotals[ingName] / catMenus.length;
            });
        });

        // 2. Apply Sales Data to calculate total consumption
        const storeSales = sales.filter(s => s.storeId === store.id);
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

        return stats;
    }, [store, sales, storeMenus, ingredients, categories, standardIngredients]);

    return (
        <div className="p-8 max-w-7xl mx-auto w-full relative">
            {editingMenu && (
                 <RecipeEditor 
                  menu={editingMenu}
                  ingredients={ingredients}
                  categories={categories}
                  standardIngredients={standardIngredients}
                  onAddIngredient={onAddIngredient}
                  onSave={(updatedMenu) => {
                    onUpdateMenu(updatedMenu);
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
                </div>
                <div className="text-right">
                    <div className="text-sm font-bold text-gray-500">Currency</div>
                    <div className="text-xl font-bold">{store.currency}</div>
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
                                                    <span key={d} className="bg-white border border-red-200 px-2 py-1 rounded text-xs font-bold text-red-600 shadow-sm">{d}</span>
                                                ))}
                                            </div>
                                        </>
                                    ) : (
                                        <p>All daily reports for the last 7 days have been submitted.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-sm border">
                        <h2 className="text-xl font-bold mb-4">Store Performance</h2>
                        {/* Reusing charts logic conceptually, but simplified here for space */}
                        <div className="h-64 flex items-center justify-center bg-gray-50 rounded-xl text-gray-400">
                            <BarChart3 className="w-8 h-8 mb-2" />
                            <span className="ml-2 font-medium">Store-specific analytics would appear here</span>
                        </div>
                    </div>
                </div>

                {/* Real-time Inventory Section */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-black/10">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <Package className="w-5 h-5"/> Real-time Inventory (Est.)
                        </h2>
                        <span className="text-xs font-bold bg-gray-100 px-2 py-1 rounded text-gray-500">Auto-Calculated</span>
                    </div>
                    <div className="space-y-4">
                        {Object.entries(inventoryStats).map(([name, data]) => {
                            // Mocking a "Starting Stock" to show a progress bar visual (e.g., 50,000 units base)
                            const mockMax = 50000; 
                            const percentUsed = Math.min(100, (data.used / mockMax) * 100);
                            const isLow = percentUsed > 80;

                            return (
                                <div key={name} className="p-4 border rounded-xl hover:border-black transition">
                                    <div className="flex justify-between items-end mb-2">
                                        <div>
                                            <div className="font-bold text-gray-800">{name}</div>
                                            <div className="text-xs text-gray-500">Standard Ingredient</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-lg font-extrabold">{data.used.toLocaleString()} <span className="text-xs font-medium text-gray-400">{data.unit} used</span></div>
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
                                        {isLow && <span className="text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> High Usage</span>}
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
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <ClipboardList className="w-5 h-5"/> Sales History
                </h2>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-xs">
                            <tr>
                                <th className="p-4 rounded-l-lg">Date</th>
                                <th className="p-4 text-right">Total Sales</th>
                                <th className="p-4 text-center">Status</th>
                                <th className="p-4 text-center rounded-r-lg">Receipt</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {sales.filter(s => s.storeId === store.id).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(sale => (
                                <tr key={sale.id} className="hover:bg-gray-50 transition">
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
                                        {sale.receiptImage ? (
                                            <button 
                                                onClick={() => setViewingReceipt(sale.receiptImage!)}
                                                className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:bg-blue-50 px-3 py-1 rounded-full transition"
                                            >
                                                <ImageIcon className="w-3 h-3"/> View Receipt
                                            </button>
                                        ) : (
                                            <span className="text-gray-300 text-xs italic">No Image</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {sales.filter(s => s.storeId === store.id).length === 0 && (
                                <tr>
                                    <td colSpan={4} className="p-8 text-center text-gray-400">No sales reports found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <MenuManager 
                store={store} 
                menus={storeMenus} 
                onEdit={setEditingMenu}
                onCreate={onCreateMenu}
                onDelete={onDeleteMenu}
            />

            {viewingReceipt && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4" onClick={() => setViewingReceipt(null)}>
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
    items: { name: string; unit: string }[];
    onUpdate: (items: { name: string; unit: string }[]) => void;
}> = ({ items, onUpdate }) => {
    const [name, setName] = useState('');
    const [unit, setUnit] = useState('');
    
    const handleAdd = () => {
        if (name && unit) {
            onUpdate([...items, { name, unit }]);
            setName('');
            setUnit('');
        }
    };

    return (
        <div className="mb-6">
            <h3 className="font-bold text-gray-700 mb-1">Standard Ingredients</h3>
            <p className="text-xs text-gray-500 mb-3">Manage standard ingredients available for recipes (Name & Unit).</p>
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
                <button onClick={handleAdd} className="bg-black text-white px-4 rounded-lg font-bold text-sm hover:bg-gray-800">Add</button>
            </div>
            <div className="flex flex-wrap gap-2">
                {items.map((item, idx) => (
                    <div key={idx} className="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-xs font-medium flex items-center gap-2 group border border-gray-200">
                        {item.name} <span className="text-gray-500">({item.unit})</span>
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
  ingredients: Ingredient[];
  globalConfig: {
      storeNames: string[];
      countries: string[];
      cities: string[];
      currencies: string[];
      positions: string[];
      categories: string[];
      standardIngredients: { name: string; unit: string }[];
  };
  onUpdateGlobalConfig: (key: string, values: any) => void;
  onUpdateStore: (store: Store) => void;
  onUpdateMenu: (menu: Menu) => void;
  onCreateMenu: (menu: Menu) => void;
  onDeleteMenu: (id: string) => void;
  onAddIngredient: (ing: Ingredient) => void;
}> = ({ user, onLogout, stores, sales, menus, ingredients, globalConfig, onUpdateGlobalConfig, onUpdateStore, onUpdateMenu, onCreateMenu, onDeleteMenu, onAddIngredient }) => {
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSalesAnalyticsOpen, setIsSalesAnalyticsOpen] = useState(false);
  
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

          const rate = EXCHANGE_RATES[store.currency] || 1;
          const amountUSD = sale.totalAmount * rate;
          const monthKey = sale.date.slice(0, 7);

          if (monthKey === currentMonthKey) {
              totalSalesCurrentMonth += amountUSD;
              totalRoyaltyCurrentMonth += amountUSD * (store.royaltyPercentage / 100);
          } else if (monthKey === prevMonthKey) {
              totalSalesLastMonth += amountUSD;
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
          inventoryAlerts: 3 // Mocked for now, as global inventory check is heavy
      };
  }, [sales, stores]);

  if (selectedStore) {
    return (
      <HQStoreDetail 
        store={selectedStore}
        sales={sales}
        menus={menus}
        ingredients={ingredients}
        categories={globalConfig.categories}
        standardIngredients={globalConfig.standardIngredients}
        onBack={() => setSelectedStore(null)}
        onUpdateMenu={onUpdateMenu}
        onCreateMenu={onCreateMenu}
        onDeleteMenu={onDeleteMenu}
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
           <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setIsSettingsOpen(false)}>
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
                          <div className="absolute right-0 top-6 w-48 bg-gray-800 text-white text-xs p-2 rounded shadow-lg opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-50">
                              Sum of all daily sales reports submitted by stores this month (converted to USD).
                          </div>
                      </div>
                  </div>
                  <div className="text-3xl font-extrabold mt-2 relative z-10">
                      ${metrics.totalSalesCurrentMonth.toLocaleString(undefined, {maximumFractionDigits: 0})}
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
                      Basis: Current Month ({metrics.currentMonthName})
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
                      ${metrics.totalRoyaltyCurrentMonth.toLocaleString(undefined, {maximumFractionDigits: 0})}
                  </div>
                  <div className="mt-8 text-[10px] text-gray-400 font-bold border-t border-gray-100 pt-2">
                      Basis: Est. for {metrics.currentMonthName}
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
           <FinancialsTable stores={stores} sales={sales} />
           
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
      standardIngredients: { name: string; unit: string }[];
      positions: string[];
  };
  onAddSale: (sale: Sale) => void;
  onUpdateMenu: (menu: Menu) => void;
  onCreateMenu: (menu: Menu) => void;
  onDeleteMenu: (id: string) => void;
  onUpdateEmployees: (employees: Employee[]) => void;
  onAddIngredient: (ing: Ingredient) => void;
}> = ({ user, store, onLogout, sales, menus, employees, ingredients, globalConfig, onAddSale, onUpdateMenu, onCreateMenu, onDeleteMenu, onUpdateEmployees, onAddIngredient }) => {
    const [view, setView] = useState<'dashboard' | 'report' | 'menu' | 'staff'>('dashboard');
    const [editingMenu, setEditingMenu] = useState<Menu | null>(null);
    const storeMenus = menus.filter(m => m.storeId === store.id);
    const storeEmployees = employees.filter(e => e.storeId === store.id);
    const storeSales = sales.filter(s => s.storeId === store.id);
    const missingDates = useMemo(() => getMissingDates(sales, store.id), [sales, store.id]);

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

    const categoryData = useMemo(() => {
        const counts: Record<string, number> = {};
        storeSales.forEach(sale => {
            sale.items.forEach(item => {
                counts[item.menuId] = (counts[item.menuId] || 0) + item.quantity;
            });
        });
        return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }, [storeSales]);

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

    const COLORS = ['#000000', '#333333', '#666666', '#999999', '#CCCCCC'];

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {editingMenu && (
                <RecipeEditor 
                    menu={editingMenu}
                    ingredients={ingredients}
                    categories={globalConfig.categories}
                    standardIngredients={globalConfig.standardIngredients}
                    onAddIngredient={onAddIngredient}
                    onSave={(updatedMenu) => {
                        onUpdateMenu(updatedMenu);
                        setEditingMenu(null);
                    }}
                    onBack={() => setEditingMenu(null)}
                />
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
                        <NavButton active={view === 'report'} onClick={() => setView('report')} icon={FileText} label="Daily Report" />
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
                    <button onClick={() => setView('report')} className={`p-3 rounded-xl ${view === 'report' ? 'text-black bg-gray-100' : 'text-gray-400'}`}><FileText className="w-6 h-6"/></button>
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
                                                <span key={d} className="px-2 py-1 bg-red-200 text-red-800 text-xs font-bold rounded">{d}</span>
                                            ))}
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
                                     <h3 className="font-bold text-lg mb-4">Category Sales Distribution</h3>
                                     <ResponsiveContainer width="100%" height="100%">
                                         <PieChart>
                                             <Pie
                                                data={categoryData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={60}
                                                outerRadius={80}
                                                paddingAngle={5}
                                                dataKey="value"
                                             >
                                                 {categoryData.map((entry, index) => (
                                                     <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                 ))}
                                             </Pie>
                                             <Tooltip />
                                             <Legend verticalAlign="bottom" height={36} />
                                         </PieChart>
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
                            initialDate={null}
                            onSave={(sale) => {
                                onAddSale(sale);
                                setView('dashboard');
                            }}
                            onCancel={() => setView('dashboard')}
                        />
                    )}

                    {view === 'menu' && (
                        <MenuManager 
                            store={store}
                            menus={storeMenus}
                            onEdit={setEditingMenu}
                            onCreate={onCreateMenu}
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
    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
            <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
                <div className="flex flex-col items-center text-center">
                    <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center mb-6">
                        <span className="text-white font-black text-2xl">CH</span>
                    </div>
                    <h1 className="text-2xl font-extrabold text-gray-900 mb-2">CHIBO</h1>
                    <p className="text-gray-500 mb-8">Global Franchise Manager</p>

                    <button
                        onClick={() => signInWithGoogle()}
                        className="w-full inline-flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition font-semibold"
                    >
                        <span className="text-lg">G</span>
                        Continue with Google
                    </button>

                    <p className="text-xs text-gray-400 mt-6 leading-relaxed">
                        로그인 후 권한이 없는 계정은 접근이 제한됩니다.
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
}> = ({ onDone, globalConfig }) => {

  const [name, setName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [country, setCountry] = useState('South Korea');
  const [city, setCity] = useState('Seoul');
  const [currency, setCurrency] = useState('JPY');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: authData } = await supabase.auth.getUser();
      const email = authData.user?.email;
      if (!email) throw new Error('No email in session');

      const storeId = `S_${crypto.randomUUID()}`;

     const { error: storeErr } = await supabase.from('stores').insert({
  id: storeId,
  name: storeName,
  country,
  city,
  owner_email: email,
  currency,
});

      if (storeErr) throw storeErr;

      await upsertMyOwnerProfile({ name: name || email, email, storeId });

      await onDone();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to onboard');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-xl">
        <div className="text-2xl font-extrabold mb-2">최초 설정</div>
        <div className="text-gray-500 mb-6">OWNER 계정 프로필과 점포를 생성합니다.</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-semibold text-gray-700">이름(표시용)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200" placeholder="예: Keito Kimura" />
          </div>
          <div>
            <label className="text-sm font-semibold text-gray-700">점포명</label>
          <select value={storeName} onChange={(e) => setStoreName(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200">
  <option value="">Select approved name...</option>
  {globalConfig.storeNames.map(name => (
    <option key={name} value={name}>{name}</option>
  ))}
</select>

<select value={country} onChange={(e) => setCountry(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200">
  <option value="">Select Country</option>
  {globalConfig.countries.map(c => (
    <option key={c} value={c}>{c}</option>
  ))}
</select>

<select value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200">
  <option value="">Select City</option>
  {globalConfig.cities.map(c => (
    <option key={c} value={c}>{c}</option>
  ))}
</select>

<select value={currency} onChange={(e) => setCurrency(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200">
  <option value="">Select Currency</option>
  {globalConfig.currencies.map(c => (
    <option key={c} value={c}>{c}</option>
  ))}
</select>

          </div>
          
        </div>

        {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

        <div className="mt-6 flex gap-3">
          <button onClick={submit} disabled={loading || !storeName} className="px-4 py-2 rounded-xl bg-black text-white font-semibold disabled:opacity-50">
            {loading ? '생성 중...' : '생성'}
          </button>
          <button onClick={() => signOut()} className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 transition font-semibold">
            로그아웃
          </button>
        </div>

        <div className="mt-6 text-xs text-gray-400 leading-relaxed">
          HQ 계정은 app_users 테이블에 role=HQ로 수동 등록하는 방식이 가장 안정적입니다.
        </div>
      </div>
    </div>
  );
};


const App = () => {
  const [user, setUser] = useState<User | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

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

  const [dataLoading, setDataLoading] = useState<boolean>(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const refreshAll = async () => {
    try {
      setDataLoading(true);
      setDataError(null);
      const [st, ing, emp, mn, sl] = await Promise.all([
        loadStores(),
        loadIngredients(),
        loadEmployees(),
        loadMenus(),
        loadSales(),
      ]);
      setStores(st);
      setIngredients(ing);
      setEmployees(emp);
      setMenus(mn);
      setSales(sl);
    } catch (e: any) {
      setDataError(e?.message ?? 'Failed to load data');
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    if (sessionEmail) {
      refreshAll();
    }
  }, [sessionEmail]);
  

 const [globalConfig, setGlobalConfig] = useState(() => {
  const saved = localStorage.getItem('globalConfig');
  if (saved) return JSON.parse(saved);
  return {
    storeNames: ['CHIBO', 'CHIBO Express', 'CHIBO Premium'],
    countries: ['South Korea', 'Vietnam', 'Philippines', 'China', 'Taiwan', 'Others'],
    cities: ['Seoul', 'Hanoi', 'Manila', 'Ningbo', 'Kaohsiung', 'Daejeon', 'Unknown', 'Osaka', 'Tokyo'],
    currencies: ['JPY', 'USD', 'KRW', 'VND', 'THB'],
    positions: ['Manager', 'Chef', 'Server', 'Part-time'],
    categories: ['Okonomiyaki', 'Yakisoba', 'Teppan Dishes', 'Side Menu', 'Alcohol', 'Soft Drinks'],
    standardIngredients: [
      { name: 'Cabbage', unit: 'g' },
      { name: 'Pork Belly', unit: 'g' },
      { name: 'Okonomiyaki Flour', unit: 'g' },
      { name: 'Egg', unit: 'pcs' },
      { name: 'Otafuku Sauce', unit: 'ml' },
      { name: 'Noodles', unit: 'g' }
    ]
  };
});
useEffect(() => {
  localStorage.setItem('globalConfig', JSON.stringify(globalConfig));
}, [globalConfig]);

  // Handlers

  
  
  const handleLogout = async () => {
    await signOut();
    setUser(null);
  };

 // Map Supabase session email -> app user (DB + HQ override)
const HQ_EMAILS = [
  'chibo.k.kimura@gmail.com',
  // 여기에 HQ로 지정할 이메일 추가
];

const [resolvedUser, setResolvedUser] = useState<User | null>(null);
const [authLoading, setAuthLoading] = useState<boolean>(true);

const loadResolvedUser = async () => {
  if (!sessionEmail) {
    setResolvedUser(null);
    setAuthLoading(false);
    return;
  }

  const email = sessionEmail.toLowerCase();

  // 1) HQ 이메일이면 HQ 자동 지정
  if (HQ_EMAILS.includes(email)) {
    setResolvedUser({
      email,
      name: 'HQ Admin',
      role: UserRole.HQ,
      storeId: undefined,
    });
    setAuthLoading(false);
    return;
  }

  try {
    setAuthLoading(true);
    const row = await getMyAppUser();
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
  } finally {
    setAuthLoading(false);
  }
};

useEffect(() => {
  loadResolvedUser();
}, [sessionEmail]);

useEffect(() => {
  setUser(resolvedUser);
}, [resolvedUser]);



useEffect(() => {
  setUser(resolvedUser);
}, [resolvedUser]);

if (!sessionEmail) return <LoginScreen />;

if (authLoading) {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="text-gray-500 text-sm">세션을 확인하는 중입니다...</div>
    </div>
  );
}

if (!resolvedUser) {
  return (
    <OnboardingScreen
      globalConfig={globalConfig}
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
        <div className="text-gray-500 text-sm">세션을 불러오는 중입니다...</div>
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
              ingredients={ingredients}
              globalConfig={globalConfig}
              onUpdateGlobalConfig={(k, v) => setGlobalConfig({...globalConfig, [k]: v})}
              onUpdateStore={async (s) => { const { error } = await supabase.from('stores').update({ name: s.name, country: s.country, city: s.city, owner_email: s.ownerEmail, currency: s.currency, royalty_percentage: s.royaltyPercentage }).eq('id', s.id); if (error) throw error; await refreshAll(); }}
              onUpdateMenu={async (m) => { await saveMenu(m); await refreshAll(); }}
              onCreateMenu={async (m) => { await saveMenu(m); await refreshAll(); }}
              onDeleteMenu={async (id) => { await deleteMenu(id); await refreshAll(); }}
              onAddIngredient={async (i) => { await addIngredient(i); await refreshAll(); }}
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
          onAddSale={async (s) => { await addSale(s); await refreshAll(); }}
          onUpdateMenu={async (m) => { await saveMenu(m); await refreshAll(); }}
          onCreateMenu={async (m) => { await saveMenu(m); await refreshAll(); }}
          onDeleteMenu={async (id) => { await deleteMenu(id); await refreshAll(); }}
          onUpdateEmployees={async (emps) => { await saveEmployees(myStore.id, emps); await refreshAll(); }}
          onAddIngredient={async (i) => { await addIngredient(i); await refreshAll(); }}
      />
  );
}

export default App;
