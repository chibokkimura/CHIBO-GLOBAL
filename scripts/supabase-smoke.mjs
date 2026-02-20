import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RECEIPT_BUCKET = process.env.SUPABASE_RECEIPT_BUCKET || 'receipts';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function hasMissingClosedReasonColumnError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes("could not find the 'closed_reason' column");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function ensureReceiptBucket(bucketId) {
  const { data, error } = await supabase.storage.getBucket(bucketId);
  if (!error && data?.id === bucketId) return;
  const message = String(error?.message || '').toLowerCase();
  const notFound = message.includes('not found') || message.includes('does not exist');
  if (!notFound && error) throw error;

  const { error: createError } = await supabase.storage.createBucket(bucketId, { public: false });
  if (createError) {
    const createMessage = String(createError.message || '').toLowerCase();
    if (!createMessage.includes('already exists')) throw createError;
  }
}

async function bestEffort(label, fn) {
  try {
    await fn();
  } catch (error) {
    console.warn(`[cleanup] ${label} failed:`, error?.message || error);
  }
}

async function run() {
  const now = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const suffix = `${now}_${rand}`;

  const storeId = `CI_STORE_${suffix}`;
  const ingredientId = `CI_ING_${suffix}`;
  const menuId = `CI_MENU_${suffix}`;
  const saleId = `CI_SALE_${suffix}`;
  const receiptPath = `${storeId}/${saleId}.txt`;
  const ingredientName = `CI Ingredient ${suffix}`;

  console.log('[smoke] start');

  await ensureReceiptBucket(RECEIPT_BUCKET);
  console.log('[smoke] bucket ready:', RECEIPT_BUCKET);

  const { error: storeError } = await supabase.from('stores').insert({
    id: storeId,
    name: `CI Store ${suffix}`,
    country: 'South Korea',
    city: 'Seoul',
    owner_email: `ci_${suffix}@example.com`,
    currency: 'KRW',
    royalty_percentage: 5,
  });
  if (storeError) throw storeError;
  console.log('[smoke] store insert ok');

  const { error: ingredientError } = await supabase.from('ingredients').insert({
    id: ingredientId,
    name: ingredientName,
    unit: 'g',
  });
  if (ingredientError) throw ingredientError;
  console.log('[smoke] ingredient insert ok');

  const { error: stockError } = await supabase.from('store_ingredient_stock').upsert(
    {
      store_id: storeId,
      ingredient_name: ingredientName,
      unit: 'g',
      par: 1000,
      reorder: 300,
    },
    { onConflict: 'store_id,ingredient_name,unit' }
  );
  if (stockError) throw stockError;
  console.log('[smoke] stock upsert ok');

  const { error: menuError } = await supabase.from('menus').insert({
    id: menuId,
    store_id: storeId,
    category: 'Soft Drinks',
    name: `CI Menu ${suffix}`,
    price: 10000,
    image_url: null,
  });
  if (menuError) throw menuError;
  console.log('[smoke] menu insert ok');

  const { error: recipeError } = await supabase.from('menu_recipe_items').insert({
    menu_id: menuId,
    ingredient_id: ingredientId,
    quantity: 25,
  });
  if (recipeError) throw recipeError;
  console.log('[smoke] recipe insert ok');

  const salePayloadBase = {
    id: saleId,
    store_id: storeId,
    date: '2026-02-19',
    total_amount: 123456,
    receipt_image: null,
    is_closed: false,
  };
  let { error: saleError } = await supabase.from('sales').insert({
    ...salePayloadBase,
    closed_reason: null,
  });
  if (saleError && hasMissingClosedReasonColumnError(saleError)) {
    ({ error: saleError } = await supabase.from('sales').insert(salePayloadBase));
  }
  if (saleError) throw saleError;
  console.log('[smoke] sales insert ok');

  const { error: saleItemError } = await supabase.from('sale_items').insert({
    sale_id: saleId,
    menu_id: 'Soft Drinks',
    quantity: 12,
  });
  if (saleItemError) throw saleItemError;
  console.log('[smoke] sale_items insert ok');

  const { error: uploadError } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(receiptPath, new Blob(['ci smoke receipt']), {
      contentType: 'text/plain',
      upsert: true,
      cacheControl: '60',
    });
  if (uploadError) throw uploadError;
  console.log('[smoke] receipt upload ok');

  const { error: updateReceiptError } = await supabase
    .from('sales')
    .update({ receipt_image: receiptPath })
    .eq('id', saleId);
  if (updateReceiptError) throw updateReceiptError;

  const { data: signed, error: signError } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(receiptPath, 120);
  if (signError) throw signError;
  assert(Boolean(signed?.signedUrl), 'signed URL was not created');
  console.log('[smoke] signed URL ok');

  let saleSelect = await supabase
    .from('sales')
    .select('id,store_id,total_amount,receipt_image,is_closed,closed_reason')
    .eq('id', saleId)
    .single();
  if (saleSelect.error && hasMissingClosedReasonColumnError(saleSelect.error)) {
    saleSelect = await supabase
      .from('sales')
      .select('id,store_id,total_amount,receipt_image,is_closed')
      .eq('id', saleId)
      .single();
  }
  if (saleSelect.error) throw saleSelect.error;

  assert(saleSelect.data?.id === saleId, 'sale row missing');
  assert(saleSelect.data?.store_id === storeId, 'store_id mismatch');
  assert(Number(saleSelect.data?.total_amount) === 123456, 'total_amount mismatch');
  assert(saleSelect.data?.receipt_image === receiptPath, 'receipt_image mismatch');
  console.log('[smoke] sales readback ok');

  console.log('[smoke] success');

  await bestEffort('delete storage object', async () => {
    await supabase.storage.from(RECEIPT_BUCKET).remove([receiptPath]);
  });
  await bestEffort('delete sale_items', async () => {
    await supabase.from('sale_items').delete().eq('sale_id', saleId);
  });
  await bestEffort('delete sales', async () => {
    await supabase.from('sales').delete().eq('id', saleId);
  });
  await bestEffort('delete menu_recipe_items', async () => {
    await supabase.from('menu_recipe_items').delete().eq('menu_id', menuId);
  });
  await bestEffort('delete menus', async () => {
    await supabase.from('menus').delete().eq('id', menuId);
  });
  await bestEffort('delete store_ingredient_stock', async () => {
    await supabase.from('store_ingredient_stock').delete().eq('store_id', storeId);
  });
  await bestEffort('delete ingredients', async () => {
    await supabase.from('ingredients').delete().eq('id', ingredientId);
  });
  await bestEffort('delete stores', async () => {
    await supabase.from('stores').delete().eq('id', storeId);
  });
}

run().catch(async (error) => {
  console.error('[smoke] failed:', error?.message || error);
  process.exit(1);
});

