import React, { useLayoutEffect, useRef } from 'react';
import { translateJapaneseUiText } from './HQLanguageBoundary';

export type OwnerLocale = 'en' | 'ja' | 'zh-CN' | 'zh-TW' | 'vi' | 'ko';

export const OWNER_LANGUAGE_STORAGE_PREFIX = 'chibo:owner:language:';

export const OWNER_LOCALE_OPTIONS: Array<{ value: OwnerLocale; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'ko', label: '한국어' },
];

export function defaultOwnerLocaleForCountry(country: string): OwnerLocale {
  const value = country.trim().toLowerCase();
  if (['china', '中国', '中國', 'cn'].includes(value)) return 'zh-CN';
  if (['taiwan', '台湾', '台灣', 'tw'].includes(value)) return 'zh-TW';
  if (['vietnam', 'việt nam', 'ベトナム', '베트남', 'vn'].includes(value)) return 'vi';
  if (['south korea', 'korea', '한국', '韓国', '대한민국', 'kr'].includes(value)) return 'ko';
  if (['japan', '日本', '일본', 'jp'].includes(value)) return 'ja';
  return 'en';
}

type Localized = Record<Exclude<OwnerLocale, 'en' | 'ja'>, string>;

const P = (zhCN: string, zhTW: string, vi: string, ko: string): Localized => ({
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  vi,
  ko,
});

const OWNER_MONTH_NAMES: Record<Exclude<OwnerLocale, 'en'>, Record<string, string>> = {
  ja: { January: '1月', February: '2月', March: '3月', April: '4月', May: '5月', June: '6月', July: '7月', August: '8月', September: '9月', October: '10月', November: '11月', December: '12月' },
  'zh-CN': { January: '1月', February: '2月', March: '3月', April: '4月', May: '5月', June: '6月', July: '7月', August: '8月', September: '9月', October: '10月', November: '11月', December: '12月' },
  'zh-TW': { January: '1月', February: '2月', March: '3月', April: '4月', May: '5月', June: '6月', July: '7月', August: '8月', September: '9月', October: '10月', November: '11月', December: '12月' },
  vi: { January: 'Tháng 1', February: 'Tháng 2', March: 'Tháng 3', April: 'Tháng 4', May: 'Tháng 5', June: 'Tháng 6', July: 'Tháng 7', August: 'Tháng 8', September: 'Tháng 9', October: 'Tháng 10', November: 'Tháng 11', December: 'Tháng 12' },
  ko: { January: '1월', February: '2월', March: '3월', April: '4월', May: '5월', June: '6월', July: '7월', August: '8월', September: '9월', October: '10월', November: '11월', December: '12월' },
};

function ownerMonthLabel(locale: Exclude<OwnerLocale, 'en'>, month: string, year: string): string {
  const localizedMonth = OWNER_MONTH_NAMES[locale][month] ?? month;
  if (locale === 'vi') return `${localizedMonth} ${year}`;
  if (locale === 'ko') return `${year}년 ${localizedMonth}`;
  return `${year}年${localizedMonth}`;
}

const OWNER_JA: Record<string, string> = {
  'Display language': '表示言語',
  'Store Manager': '店舗責任者',
  'Store Overview': '店舗概要',
  'Core tasks': '主要業務',
  'due reports complete': '必要な報告が完了',
  recipes: 'レシピ',
  'single items ·': '単品・',
  'courses/sets': 'コース／セット',
  staff: 'スタッフ',
  Reports: '報告',
  days: '日',
  "Today's Sales Report": '本日の売上報告',
  'Staff & Labor': 'スタッフ・人件費',
  'Store Setup': '店舗設定',
  'Store setup': '店舗設定',
  'Ingredients · menus & recipes · staff': '食材・メニュー／レシピ・スタッフ',
  Setup: '設定',
  'Only when something changes': '変更がある場合のみ',
  'Ingredients and purchase units · menus and recipes · staff records': '食材・購入単位・メニュー・レシピ・スタッフ情報',
  'Daily sales and month-end totals are entered elsewhere. Open only the setup item you need to add or change.': '日次売上と月末合計は別画面で入力します。追加・変更が必要な設定だけを開いてください。',
  'First-time setup order': '初回設定の順序',
  'Ingredients & purchase units': '食材・購入単位',
  'Menus & recipes': 'メニュー・レシピ',
  'Staff records': 'スタッフ情報',
  'Ingredients & Purchase Units': '食材・購入単位',
  'Register pack, case or bottle size, price and supplier. Monthly purchases and inventory are available on the same screen.': 'パック・ケース・ボトルの内容量、価格、仕入先を登録します。同じ画面で月間仕入と棚卸も入力できます。',
  'Open ingredient setup': '食材設定を開く',
  'Check setup': '設定を確認',
  'Register selling prices and the ingredient quantity used in one serving.': '販売価格と1食分に使用する食材量を登録します。',
  'Maintain the active staff list. Monthly payroll and labor hours are entered in Month Close.': '在籍スタッフを管理します。月間給与と総労働時間は月次締めで入力します。',
  'Back to Month Close': '月次締めに戻る',
  'Back to Store Setup': '店舗設定に戻る',
  'Monthly purchases & inventory': '月間仕入・棚卸',
  'Menu & recipe setup': 'メニュー・レシピ設定',
  'Staff Records': 'スタッフ情報',
  Home: 'ホーム',
  Cost: '原価',
  'What to do next': '次に行うこと',
  'Daily work and month-end work are separated below.': '日次業務と月末業務を分けて表示しています。',
  'Daily task': '日次業務',
  'Month-end task': '月末業務',
  'Do today': '本日入力',
  'Review or edit report': '報告を確認・修正',
  'Enter sales and upload receipt': '売上を入力し、レシートをアップロード',
  'Open month close': '月次締めを開く',
  'Open cost workspace': '原価管理を開く',
  'Open staff records': 'スタッフ情報を開く',
  'Missing Daily Sales Reports': '日次売上報告の未提出',
  'Enter these dates to complete this month’s sales record.': '次の日付を入力して、今月の売上記録を完成してください。',
  'Total Sales (Month)': '月間売上',
  'Active Menu Items': '販売中メニュー',
  'Ready to serve': '販売可能',
  'Staff Count': 'スタッフ数',
  'Active employees': '在籍スタッフ',
  'Weekly Revenue Trend': '直近7日間の売上推移',
  'No prior-week baseline': '前週の比較データなし',
  'Category Sales (This Month vs Last Month)': 'カテゴリー別売上（今月・前月比較）',
  'This Month': '今月',
  'Last Month': '前月',
  'Recent Daily Reports': '最近の日次報告',
  'View calendar': 'カレンダーを表示',
  'Show latest 5 reports': '最新5件を表示',
  'Show latest 7 reports': '最新7件を表示',
  'No category sales data.': 'カテゴリ別売上データはありません。',
  'No reports in this month.': 'この月の報告はありません。',
  'Setup & maintenance': '設定・メンテナンス',
  'Open these only when ingredients, recipes or staff records need updating.': '食材・レシピ・スタッフ情報を更新する場合に開いてください。',
  'Manage costs, inventory and recipes': '原価・在庫・レシピを管理',
  'Keep the active staff list current.': '在籍スタッフ一覧を最新の状態に保ってください。',
  'Check monthly readiness': '月次締めの準備状況を確認',
  'Your Performance': '入力状況',
  'Operational Score (Auto)': '運用スコア（自動）',
  'Daily Sales Report': '日次売上報告',
  'Total Daily Revenue': '1日の売上合計',
  'Total Daily Revenue (': '1日の売上合計 (',
  'I confirm the store was open and actual sales were zero.': '営業日で、実際の売上が0であることを確認しました。',
  'Use this only when the POS total is really 0.': 'POSの売上合計が本当に0の場合のみ選択してください。',
  'Confirm that the store was open and the actual sales amount was zero.': '営業日で実際の売上が0であることを確認してください。',
  'Report Date': '報告日',
  'Comments': 'メモ',
  'Single Item Quantities': '単品販売数',
  'Single or course quantity required when revenue is above 0': '売上がある場合、単品またはコースの販売数が必要です',
  'Enter each directly sold menu once. Category totals are calculated automatically.': '単品で販売したメニュー数を入力してください。カテゴリー合計は自動計算されます。',
  'Category totals automatic': 'カテゴリー合計は自動',
  'Search direct menus': '単品メニューを検索',
  'Course & Set Quantities': 'コース・セット販売数',
  "Inventory usage is auto-calculated from each set menu's components.": '各セットの構成メニューから在庫使用量を自動計算します。',
  'Upload Receipt / Daily Report': 'レシート／日報をアップロード',
  'Submit Report': '報告を提出',
  'Store was closed (Rest Day)': '休業日',
  'Enter total sales amount': '売上合計を入力',
  'Click to browse (JPG, PNG)': '画像を選択（JPG・PNG）',
  'Add notes for this report (optional)': 'この報告のメモを追加（任意）',
  'Reason for closure (e.g. maintenance)': '休業理由（例：メンテナンス）',
  'Search menu or category': 'メニューまたはカテゴリーを検索',
  'Store monthly operations': '店舗月次業務',
  'Monthly Operations Check': '月次業務の確認',
  'Monthly operations month': '月次業務の対象月',
  'Reload monthly operations': '月次業務を再読込',
  'Reload monthly profit inputs': '月次収益入力を再読込',
  'Reload monthly profitability': '月次収益性を再読込',
  'REPORTED SALES': '報告済み売上',
  'Reported sales': '報告済み売上',
  'DAILY REPORTS': '日次報告',
  'Daily reports': '日次報告',
  'REVIEW STATUS': '確認状況',
  'Review status': '確認状況',
  'Through the latest completed day': '入力済みの最新日まで',
  'Attached to open-day reports': '営業日の報告に添付済み',
  Draft: '下書き',
  'Waiting for completion': '入力完了待ち',
  'These checks come directly from the daily reports already stored in the system.': '保存済みの日次報告をもとに自動確認しています。',
  'Action needed': '対応が必要',
  'Daily sales reports': '日次売上報告',
  'Labor, hours, fees, utilities and other operating totals': '人件費・勤務時間・手数料・水道光熱費・その他運営費の月間合計',
  'Input needed': '入力が必要',
  'Use the POS guest total when available.': 'POSの客数合計を取得できる場合に入力します。',
  'POS monthly total': 'POSの月間合計',
  'One total from the attendance system.': '勤怠システムの月間合計を入力します。',
  'Attendance monthly total': '勤怠の月間合計',
  'Entry rule': '入力ルール',
  'Blank means not entered': '空欄は未入力として扱います',
  'Enter 0 only when the confirmed monthly amount is actually zero. This keeps missing data separate from zero cost.': '確認した月間金額が実際に0の場合のみ0を入力してください。未入力と0円を区別して管理します。',
  'One monthly total from payroll': '給与データの月間合計',
  'Optional · HQ default': '任意・本部初期値',
  'Electricity, gas and water total': '電気・ガス・水道の合計',
  'Supplies, cleaning, repairs and marketing': '消耗品・清掃・修繕・販促費の合計',
  'Monthly note': '月次メモ',
  'Not entered': '未入力',
  'Open only when a CSV/XLS/XLSX file is available': 'CSV・XLS・XLSXファイルがある場合のみ開いてください',
  'Search ingredients': '食材を検索',
  'Show incomplete only': '未完了のみ表示',
  'No ingredients match this filter.': '条件に一致する食材がありません。',
  'Finish missing sales reports and receipts, confirm the total, then submit to HQ.': '未提出の売上報告とレシートを完成し、合計を確認してから本部へ提出します。',
  'Finish the month in 3 steps': '3ステップで月次締めを完了',
  'Complete reports and totals, close inventory, then review the result and submit.': '日次報告と月間合計を完成し、棚卸を締め、結果を確認して提出します。',
  'Complete reports & totals': '報告・月間合計を完成',
  'Close inventory': '棚卸を締める',
  'Review and submit': '結果確認・提出',
  Waiting: '未完了',
  'Enter purchases and finish the closing stock count': '仕入を入力し、月末棚卸を完了してください',
  'Available after totals and inventory are complete': '月間合計と棚卸の完了後に確認できます',
  'Complete these items before submission': '提出前に次の項目を完成してください',
  'Complete Daily Reports': '日次報告を完成',
  Enter: '入力',
  'Add receipt': 'レシートを追加',
  'Enter Monthly Totals': '月間合計を入力',
  'Manual entry': '手入力',
  'Enter one total for each item. If you do not have a file, complete the month here.': '各項目の月間合計を1つ入力します。ファイルがない場合は、この画面で入力してください。',
  'Optional: unusual payroll, fees, utilities, or missing source report': '任意：通常と異なる給与・手数料・光熱費・不足資料など',
  'Save Draft': '下書きを保存',
  'Next: monthly purchases and inventory': '次へ：月間仕入・棚卸',
  'You can save the current totals as a draft and continue with inventory at any time.': '現在の月間合計を下書き保存し、いつでも棚卸入力へ進めます。',
  'Continue to Step 2': 'ステップ2へ進む',
  'Back to Step 1': 'ステップ1に戻る',
  'Review Step 3': 'ステップ3を確認',
  'Optional: import a POS, attendance or cost file': '任意：POS・勤怠・原価ファイルを取り込む',
  'Finish purchases and closing stock count': '仕入入力と月末棚卸を完了',
  'STEP 2 · INVENTORY CLOSE': 'ステップ2・棚卸締め',
  'Step 2 · Inventory close': 'ステップ2・棚卸締め',
  'Open Purchases & Inventory': '仕入・棚卸入力を開く',
  'Review Monthly Result': '月次結果を確認',
  'Actual food cost cannot be finalized until opening stock, purchases and closing stock are complete.': '月初在庫・仕入・月末在庫が揃うまで実際原価は確定できません。',
  'Complete the missing inputs before using the final margin': '最終利益率を確認するには未入力項目を完成してください',
  'Missing: monthly labor and operating totals, completed opening and closing inventory.': '未完了：月間人件費・運営費、月初・月末在庫の確定',
  'Inventory close incomplete': '棚卸未完了',
  'No target': '目標未設定',
  'Shown after all inputs are ready': 'すべての入力完了後に表示',
  'Waiting for inputs': '入力待ち',
  'Final check before submission': '提出前の最終確認',
  'Confirm only after checking the monthly total against the store record.': '店舗資料と月間合計を照合してから確認してください。',
  'Submit the completed month to HQ': '完成した月次データを本部へ提出',
  'Explain corrected reports, unusual sales, or open issues.': '修正した報告、通常と異なる売上、未解決事項を入力してください。',
  'HQ only': '本部専用',
  'HQ comments appear here.': '本部のコメントがここに表示されます。',
  'Submit to HQ': '本部へ提出',
  'Single Items & Recipes': '単品・レシピ',
  'Courses & Sets': 'コース・セット',
  'Menus, Courses & Recipes': 'メニュー・コース・レシピ',
  'RECIPE SETUP': 'レシピ設定',
  'Register ingredient quantities for single items first, then build courses and sets.': '先に単品ごとの食材使用量を登録し、その後にコース・セットを構成してください。',
  'SINGLE ITEMS': '単品メニュー',
  'Individually sold menu items': '単品で販売するメニュー',
  'RECIPES READY': 'レシピ登録状況',
  'COURSES & SETS': 'コース・セット',
  'Components configured': '構成設定済み',
  'Register each individually sold menu item and the ingredients used in one serving.': '単品で販売する各メニューと、1食分に使用する食材を登録してください。',
  'Add Item': 'メニューを追加',
  'STORE COST INPUT': '店舗 原価入力',
  'Record purchases and month-end counts to calculate actual cost and improvement opportunities.': '仕入と月末棚卸を入力し、実際原価と改善点を確認します。',
  'Cost and inventory month': '原価・在庫の対象月',
  'Reload cost and inventory': '原価・在庫を再読込',
  'Cost management sections': '原価管理メニュー',
  'Example: POS July report checked by store manager': '例：店長確認済みの7月POSレポート',
  'Save & Confirm Source': '参照元を保存・確認',
  'Source note (required)': '参照資料メモ（必須）',
  'Source note (optional)': '参照資料メモ（任意）',
  'I checked every menu and course quantity against the monthly POS report.': 'すべてのメニュー・コース数量を月間POSレポートと照合しました。',
  'Required before saving monthly POS totals.': '月間POS合計を保存する前に確認が必要です。',
  'Ingredient Purchase Setup': '食材の購入単位設定',
  'Review each ingredient in one row and open the form only when changes are needed.': '食材ごとに1行で確認し、変更が必要な場合のみフォームを開いてください。',
  'Ingredient to configure': '設定する食材',
  'Select a registered ingredient': '登録済み食材を選択',
  'Add Purchase Setup': '購入単位設定を追加',
  Ingredient: '食材',
  Content: '内容量',
  'Base Unit Cost': '基本単価',
  'Base unit cost': '基本単価',
  'Pack price': '購入価格',
  'Monthly Purchases': '月間仕入',
  'Enter package count and invoice total; base-unit quantity is calculated automatically.': '購入数と請求金額を入力すると、基本単位の数量を自動計算します。',
  'Add Purchase': '仕入を追加',
  'MONTHLY PURCHASES': '月間仕入',
  'PURCHASE ENTRIES': '仕入件数',
  'CONFIGURED INGREDIENTS': '設定済み食材',
  Packages: '購入数',
  'Base Quantity': '基本単位数量',
  Total: '合計',
  'Supplier / Notes': '仕入先・メモ',
  'Month-End Inventory Close': '月末棚卸締め',
  'Opening + purchases + adjustment − closing = actual usage and actual cost. Enter quantities first and expand valuation details only when needed.': '月初在庫＋仕入＋調整－月末在庫＝実際使用量・実際原価です。まず数量を入力し、必要な場合のみ金額詳細を開いてください。',
  'Required:': '必須：',
  'Optional:': '任意：',
  'confirm opening quantity, closing quantity, and Count complete after physically counting the ingredient. Opening unit cost is also required when opening quantity is above 0.': '実地棚卸後に月初数量・月末数量を確認し、「棚卸完了」にチェックしてください。月初数量がある場合は月初単価も必須です。',
  'waste, adjustment, and notes may remain 0 or blank.': '廃棄・調整・メモは0または空欄でも構いません。',
  'Opening *': '月初在庫 *',
  Opening: '月初在庫',
  Purchased: '仕入数量',
  'Waste (opt.)': '廃棄（任意）',
  'Adjust (opt.)': '調整（任意）',
  'Closing *': '月末在庫 *',
  Closing: '月末在庫',
  'Adjustment (+/-)': '在庫調整（＋／－）',
  'Actual usage': '実際使用量',
  'Show valuation details': '金額詳細を表示',
  'Count complete *': '棚卸完了 *',
  'Valuation details': '金額詳細',
  'Close valuation details': '金額詳細を閉じる',
  Open: '未完了',
  'People records': 'スタッフ情報',
  'Keep the active staff list current. Monthly payroll, total labor hours, and labor-cost ratio are managed in Month Close.': '在籍スタッフ一覧を最新に保ってください。月間給与・総労働時間・人件費率は「月次締め」で管理します。',
  'Staff Management': 'スタッフ管理',
  'Add Staff': 'スタッフを追加',
  'Add Employee': 'スタッフを追加',
  Position: '役職',
  Email: 'メールアドレス',
  Phone: '電話番号',
  'DEMO PREVIEW · Sample numbers only · Never use this screen to verify operating data': 'デモ画面・数値はサンプルです・運用データの確認には使用しないでください',
  Main: '主要食材',
  Secondary: '副食材',
  'Ingredient name': '食材名',
  'Base unit': '基本単位',
  'Purchase unit': '購入単位',
  'Select ingredient': '食材を選択',
  'Purchase date': '仕入日',
  'Invoice total (': '請求合計 (',
  'Save Ingredient Setup': '食材設定を保存',
  'Save Purchase': '仕入を保存',
  'Invoice number, price change, delivery issue, etc.': '請求書番号、価格変更、納品上の問題など',
  'e.g. Cabbage': '例：キャベツ',
  'Item Image': 'メニュー画像',
  'Upload Menu Photo': 'メニュー写真をアップロード',
  'Supports JPG, PNG': 'JPG・PNG対応',
  'Change Image': '画像を変更',
  'Preview menu image': 'メニュー画像を表示',
  'Select Category': 'カテゴリーを選択',
  Price: '販売価格',
  'Recipe Configuration': 'レシピ設定',
  'At least 1 ingredient required': '食材を1つ以上登録してください',
  'Add New Ingredient': '新しい食材を追加',
  'Select Standard Ingredient (Optional)': '標準食材を選択（任意）',
  'Ingredient Name (e.g. Flour)': '食材名（例：小麦粉）',
  Qty: '数量',
  'Unit (g, ml)': '単位（g・ml）',
  'Add ingredient to recipe': 'レシピに食材を追加',
  '* Standard ingredients can be selected from the dropdown, and custom ingredients can be added/removed freely.': '標準食材は一覧から選択できます。独自の食材も自由に追加・削除できます。',
  'No ingredients configured for this item.': 'このメニューには食材が登録されていません。',
  'Save Item': 'メニューを保存',
  'New Item': '新しいメニュー',
  'Set Name': 'コース・セット名',
  'Set Price': '販売価格',
  'Set Components': '構成メニュー',
  'At least 1 required': '1件以上必須',
  'Add Component': '構成メニューを追加',
  'Select Menu Item': 'メニューを選択',
  'Close set menu editor': 'コース・セット編集を閉じる',
  'e.g. Family Set A': '例：ファミリーセットA',
  'Remove component': '構成メニューを削除',
  'No normal menu items found. Add menu items first, then create set menus.': '単品メニューがありません。先に単品を登録してからコース・セットを作成してください。',
  'Save Set Menu': 'コース・セットを保存',
  'New Set Menu': '新しいコース・セット',
  'Courses & Set Menus': 'コース・セット',
  'Build a course or set from registered single items and specify the quantity of each component.': '登録済みの単品からコース・セットを作り、各メニューの数量を指定します。',
  'Add Set Menu': 'コース・セットを追加',
  'Unknown Menu': '不明なメニュー',
  'No components configured.': '構成メニューが登録されていません。',
  'No set menus yet.': 'コース・セットはまだ登録されていません。',
  Okonomiyaki: 'お好み焼',
  Yakisoba: '焼そば',
  'Teppan Dishes': '鉄板料理',
  'Side Menu': 'サイドメニュー',
  Alcohol: 'アルコール',
  'Soft Drinks': 'ソフトドリンク',
  'Staff Details': 'スタッフ情報',
  'Upload staff photo': 'スタッフ写真をアップロード',
  'Photo · Optional': '写真・任意',
  'Full Name': '氏名',
  'e.g. John Doe': '例：山田 太郎',
  'Select Position': '役職を選択',
  'Save Staff': 'スタッフを保存',
  Manager: '店長',
  Chef: '調理担当',
  Server: 'ホール担当',
  'Part-time': 'アルバイト',
  Back: '戻る',
  Next: '次へ',
  Previous: '前へ',
};

// Owner-facing operational language only. Store names, menu names, ingredient
// names and saved notes remain the original data and are never rewritten in DB.
const OWNER_TEXT: Record<string, Localized> = {
  'Store Manager': P('门店负责人', '門店負責人', 'Quản lý cửa hàng', '점포 관리자'),
  'Display language': P('显示语言', '顯示語言', 'Ngôn ngữ hiển thị', '표시 언어'),
  'Store Overview': P('门店概览', '門店總覽', 'Tổng quan cửa hàng', '점포 현황'),
  'Core tasks': P('主要任务', '主要工作', 'Công việc chính', '주요 업무'),
  'due reports complete': P('应提交报告已完成', '應提交報告已完成', 'báo cáo bắt buộc đã hoàn tất', '필요 보고 완료'),
  recipes: P('配方', '配方', 'công thức', '레시피'),
  'single items ·': P('单品 ·', '單品 ·', 'món lẻ ·', '단품 ·'),
  'courses/sets': P('套餐', '套餐', 'set', '코스/세트'),
  staff: P('名员工', '名員工', 'nhân viên', '명 직원'),
  Reports: P('报告', '報告', 'Báo cáo', '보고'),
  days: P('天', '天', 'ngày', '일'),
  "Today's Sales Report": P('今日营业报告', '今日營業報告', 'Báo cáo doanh thu hôm nay', '오늘 매출 보고'),
  'Month Close': P('月度结算', '月結', 'Chốt tháng', '월 마감'),
  'Cost & Inventory': P('成本与库存', '成本與庫存', 'Giá vốn & tồn kho', '원가·재고'),
  'Staff & Labor': P('员工与人工', '員工與人力', 'Nhân sự & lao động', '직원·인건비'),
  'Store Setup': P('门店设置', '門店設定', 'Thiết lập cửa hàng', '점포 설정'),
  'Store setup': P('门店设置', '門店設定', 'Thiết lập cửa hàng', '점포 설정'),
  'Ingredients · menus & recipes · staff': P('食材・菜单与配方・员工', '食材・菜單與配方・員工', 'Nguyên liệu · món & công thức · nhân viên', '재료 · 메뉴·레시피 · 직원'),
  Setup: P('设置', '設定', 'Thiết lập', '설정'),
  'Only when something changes': P('仅在有变更时', '僅在有變更時', 'Chỉ khi có thay đổi', '변경할 때만'),
  'Ingredients and purchase units · menus and recipes · staff records': P('食材与采购单位 · 菜单与配方 · 员工资料', '食材與採購單位 · 菜單與配方 · 員工資料', 'Nguyên liệu & đơn vị mua · món & công thức · hồ sơ nhân viên', '재료·구매단위 · 메뉴·레시피 · 직원 정보'),
  'Daily sales and month-end totals are entered elsewhere. Open only the setup item you need to add or change.': P('每日销售和月末合计在其他页面输入。只打开需要新增或修改的设置。', '每日營業額和月底合計在其他頁面輸入。只開啟需要新增或修改的設定。', 'Doanh thu ngày và tổng cuối tháng được nhập ở màn hình khác. Chỉ mở mục cần thêm hoặc sửa.', '일매출과 월말 합계는 다른 화면에서 입력합니다. 추가·변경할 설정만 여세요.'),
  'First-time setup order': P('首次设置顺序', '首次設定順序', 'Thứ tự thiết lập lần đầu', '최초 설정 순서'),
  'Ingredients & purchase units': P('食材与采购单位', '食材與採購單位', 'Nguyên liệu & đơn vị mua', '재료·구매단위'),
  'Menus & recipes': P('菜单与配方', '菜單與配方', 'Món & công thức', '메뉴·레시피'),
  'Staff records': P('员工资料', '員工資料', 'Hồ sơ nhân viên', '직원 정보'),
  'Ingredients & Purchase Units': P('食材与采购单位', '食材與採購單位', 'Nguyên liệu & đơn vị mua', '재료·구매단위'),
  'Register pack, case or bottle size, price and supplier. Monthly purchases and inventory are available on the same screen.': P('登记包装、箱或瓶的容量、价格和供应商。同一画面也可输入月度采购和库存。', '登記包裝、箱或瓶的容量、價格和供應商。同一畫面也可輸入月間採購和庫存。', 'Khai báo quy cách gói/thùng/chai, giá và nhà cung cấp. Mua hàng tháng và tồn kho ở cùng màn hình.', '팩·박스·병의 용량, 가격, 공급처를 등록합니다. 같은 화면에서 월 매입과 재고도 입력합니다.'),
  'Open ingredient setup': P('打开食材设置', '開啟食材設定', 'Mở thiết lập nguyên liệu', '재료 설정 열기'),
  'Check setup': P('检查设置', '確認設定', 'Kiểm tra thiết lập', '설정 확인'),
  'Register selling prices and the ingredient quantity used in one serving.': P('登记售价和每份所用食材量。', '登記售價和每份所用食材量。', 'Khai báo giá bán và lượng nguyên liệu cho một phần.', '판매가와 1인분에 사용되는 재료량을 등록합니다.'),
  'Maintain the active staff list. Monthly payroll and labor hours are entered in Month Close.': P('维护在职员工名单。月度工资和工时在月结中输入。', '維護在職員工名單。月度薪資和工時在月結中輸入。', 'Cập nhật nhân viên đang làm việc. Lương và giờ công tháng được nhập trong Chốt tháng.', '재직 직원 목록을 관리합니다. 월 급여와 근무시간은 월 마감에서 입력합니다.'),
  'Back to Month Close': P('返回月结', '返回月結', 'Quay lại chốt tháng', '월 마감으로 돌아가기'),
  'Back to Store Setup': P('返回门店设置', '返回門店設定', 'Quay lại thiết lập cửa hàng', '점포 설정으로 돌아가기'),
  'Monthly purchases & inventory': P('月度采购与库存', '月間採購與庫存', 'Mua hàng & tồn kho tháng', '월 매입·재고'),
  'Menu & recipe setup': P('菜单与配方设置', '菜單與配方設定', 'Thiết lập món & công thức', '메뉴·레시피 설정'),
  'Staff Records': P('员工资料', '員工資料', 'Hồ sơ nhân viên', '직원 정보'),
  Home: P('首页', '首頁', 'Trang chủ', '홈'),
  Sales: P('营业报告', '營業報告', 'Doanh thu', '매출'),
  Month: P('月结', '月結', 'Tháng', '월마감'),
  Cost: P('成本', '成本', 'Giá vốn', '원가'),
  Staff: P('员工', '員工', 'Nhân sự', '직원'),
  'What to do next': P('下一步要做什么', '下一步要做什麼', 'Việc cần làm tiếp theo', '다음 할 일'),
  'Daily work and month-end work are separated below.': P('日常工作和月末工作已分开显示。', '日常工作和月底工作已分開顯示。', 'Công việc hằng ngày và cuối tháng được tách riêng bên dưới.', '일일 업무와 월말 업무를 나누어 표시합니다.'),
  'Daily task': P('每日任务', '每日工作', 'Việc hằng ngày', '일일 업무'),
  'Month-end task': P('月末任务', '月底工作', 'Việc cuối tháng', '월말 업무'),
  Submitted: P('已提交', '已提交', 'Đã nộp', '제출 완료'),
  'Do today': P('今天完成', '今天完成', 'Làm hôm nay', '오늘 입력'),
  'Review or edit report': P('查看或修改报告', '查看或修改報告', 'Xem hoặc sửa báo cáo', '보고서 확인·수정'),
  'Enter sales and upload receipt': P('录入销售额并上传收据', '輸入營業額並上傳收據', 'Nhập doanh thu và tải ảnh hóa đơn', '매출 입력 및 영수증 업로드'),
  'Open month close': P('打开月度结算', '開啟月結', 'Mở chốt tháng', '월 마감 열기'),
  'Open cost workspace': P('打开成本管理', '開啟成本管理', 'Mở quản lý giá vốn', '원가 관리 열기'),
  'Open staff records': P('打开员工资料', '開啟員工資料', 'Mở hồ sơ nhân sự', '직원 정보 열기'),
  'Setup & maintenance': P('设置与维护', '設定與維護', 'Thiết lập & bảo trì', '설정·관리'),
  'Open these only when ingredients, recipes or staff records need updating.': P('仅在需要更新食材、配方或员工资料时打开。', '僅在需要更新食材、配方或員工資料時開啟。', 'Chỉ mở khi cần cập nhật nguyên liệu, công thức hoặc nhân sự.', '재료·레시피·직원 정보를 수정할 때만 여세요.'),
  'Manage costs, inventory and recipes': P('管理成本、库存和配方', '管理成本、庫存與配方', 'Quản lý giá vốn, tồn kho và công thức', '원가·재고·레시피 관리'),
  'Keep the active staff list current.': P('请及时更新在职员工名单。', '請隨時更新在職員工名單。', 'Luôn cập nhật danh sách nhân viên đang làm việc.', '재직 직원 목록을 최신 상태로 유지하세요.'),
  'Check monthly readiness': P('检查月结准备情况', '檢查月結準備狀況', 'Kiểm tra mức độ sẵn sàng chốt tháng', '월 마감 준비 확인'),
  'Your Performance': P('录入情况', '輸入狀況', 'Tình trạng thực hiện', '입력 현황'),
  'Operational Score (Auto)': P('运营评分（自动）', '營運評分（自動）', 'Điểm vận hành (tự động)', '운영 점수(자동)'),
  'Missing Daily Sales Reports': P('缺少每日营业报告', '缺少每日營業報告', 'Thiếu báo cáo doanh thu ngày', '미제출 일일 매출 보고'),
  'Enter these dates to complete this month’s sales record.': P('请补录以下日期，完成本月销售记录。', '請補登以下日期，完成本月營業紀錄。', 'Nhập các ngày sau để hoàn tất dữ liệu doanh thu tháng.', '아래 날짜를 입력하여 이번 달 매출 기록을 완료하세요.'),
  'View Older Dates': P('查看更早日期', '查看更早日期', 'Xem ngày cũ hơn', '이전 날짜 보기'),
  'Total Sales (Month)': P('本月销售额', '本月營業額', 'Tổng doanh thu tháng', '월 매출 합계'),
  'Active Menu Items': P('在售单品', '販售中單品', 'Món đang bán', '판매 메뉴'),
  'Staff Count': P('员工人数', '員工人數', 'Số nhân viên', '직원 수'),
  'Weekly Revenue Trend': P('近7日销售趋势', '近7日營業趨勢', 'Xu hướng doanh thu 7 ngày', '최근 7일 매출 추이'),
  'No prior-week baseline': P('没有上周比较数据', '無前週比較資料', 'Không có dữ liệu tuần trước', '전주 비교 데이터 없음'),
  'Category Sales (This Month vs Last Month)': P('分类销售（本月与上月）', '分類營業額（本月與上月）', 'Doanh thu theo nhóm (tháng này và tháng trước)', '분류별 매출(이번 달·지난달)'),
  'This Month': P('本月', '本月', 'Tháng này', '이번 달'),
  'Last Month': P('上月', '上月', 'Tháng trước', '지난달'),
  'Recent Daily Reports': P('最近的每日报告', '最近的每日報告', 'Báo cáo ngày gần đây', '최근 일일 보고'),
  'View calendar': P('查看日历', '查看日曆', 'Xem lịch', '달력 보기'),
  'Show latest 5 reports': P('显示最新5条', '顯示最新5筆', 'Hiện 5 báo cáo mới nhất', '최근 5건 보기'),
  'Show latest 7 reports': P('显示最新7条', '顯示最新7筆', 'Hiện 7 báo cáo mới nhất', '최근 7건 보기'),
  'No category sales data.': P('暂无分类销售数据。', '暫無分類營業資料。', 'Không có dữ liệu doanh thu theo nhóm.', '카테고리별 매출 데이터가 없습니다.'),
  Edit: P('修改', '修改', 'Sửa', '수정'),
  Delete: P('删除', '刪除', 'Xóa', '삭제'),
  Save: P('保存', '儲存', 'Lưu', '저장'),
  'Saving...': P('正在保存…', '儲存中…', 'Đang lưu…', '저장 중…'),
  Cancel: P('取消', '取消', 'Hủy', '취소'),
  Close: P('关闭', '關閉', 'Đóng', '닫기'),
  Back: P('返回', '返回', 'Quay lại', '뒤로'),
  Next: P('下一步', '下一步', 'Tiếp theo', '다음'),
  Previous: P('上一步', '上一步', 'Trước', '이전'),
  Required: P('必填', '必填', 'Bắt buộc', '필수'),
  Optional: P('选填', '選填', 'Không bắt buộc', '선택'),
  Complete: P('完成', '完成', 'Hoàn tất', '완료'),
  Incomplete: P('未完成', '未完成', 'Chưa hoàn tất', '미완료'),
  Ready: P('已就绪', '已就緒', 'Sẵn sàng', '준비 완료'),
  Missing: P('缺失', '缺少', 'Thiếu', '누락'),
  'No data': P('无数据', '無資料', 'Không có dữ liệu', '데이터 없음'),
  'No reports in this month.': P('本月没有报告。', '本月沒有報告。', 'Tháng này chưa có báo cáo.', '이번 달 보고가 없습니다.'),
  'Daily Sales Report': P('每日营业报告', '每日營業報告', 'Báo cáo doanh thu ngày', '일일 매출 보고'),
  'Total Daily Revenue': P('每日销售总额', '每日營業額合計', 'Tổng doanh thu ngày', '일 매출 합계'),
  'Total Daily Revenue (': P('每日销售总额(', '每日營業額合計(', 'Tổng doanh thu ngày (', '일 매출 합계('),
  'I confirm the store was open and actual sales were zero.': P('确认门店当天营业且实际销售额为0。', '確認門店當天營業且實際營業額為0。', 'Tôi xác nhận cửa hàng có mở cửa và doanh thu thực tế bằng 0.', '영업일이며 실제 매출이 0임을 확인했습니다.'),
  'Use this only when the POS total is really 0.': P('仅在POS合计确实为0时勾选。', '僅在POS合計確實為0時勾選。', 'Chỉ chọn khi tổng POS thực sự bằng 0.', 'POS 합계가 실제로 0일 때만 선택하세요.'),
  'Confirm that the store was open and the actual sales amount was zero.': P('请确认门店当天营业且实际销售额为0。', '請確認門店當天營業且實際營業額為0。', 'Hãy xác nhận cửa hàng có mở cửa và doanh thu thực tế bằng 0.', '영업일이며 실제 매출이 0인지 확인하세요.'),
  'Report Date': P('报告日期', '報告日期', 'Ngày báo cáo', '보고일'),
  Comments: P('备注', '備註', 'Ghi chú', '메모'),
  'Single Item Quantities': P('单品销售数量', '單品銷售數量', 'Số lượng món lẻ', '단품 판매 수량'),
  'Single or course quantity required when revenue is above 0': P('有销售额时必须输入单品或套餐数量', '有營業額時必須輸入單品或套餐數量', 'Khi có doanh thu, phải nhập số lượng món lẻ hoặc set', '매출이 있으면 단품 또는 코스 수량을 입력해야 합니다'),
  'Enter each directly sold menu once. Category totals are calculated automatically.': P('输入各单卖菜品的数量，分类合计将自动计算。', '輸入各單賣菜品的數量，分類合計將自動計算。', 'Nhập số lượng từng món bán lẻ. Tổng theo nhóm được tự động tính.', '단품 판매 메뉴 수량을 입력하세요. 분류 합계는 자동 계산됩니다.'),
  'Category totals automatic': P('自动计算分类合计', '自動計算分類合計', 'Tự động tính tổng theo nhóm', '분류 합계 자동 계산'),
  'Search direct menus': P('搜索单品菜单', '搜尋單品菜單', 'Tìm món lẻ', '단품 메뉴 검색'),
  'Course & Set Quantities': P('套餐销售数量', '套餐銷售數量', 'Số lượng set', '코스·세트 판매 수량'),
  "Inventory usage is auto-calculated from each set menu's components.": P('根据套餐组成自动计算库存用量。', '依套餐組成自動計算庫存用量。', 'Lượng tồn kho sử dụng được tự động tính theo thành phần set.', '세트 구성 메뉴를 기준으로 재고 사용량을 자동 계산합니다.'),
  'Upload Receipt / Daily Report': P('上传收据／日报', '上傳收據／日報', 'Tải hóa đơn / báo cáo ngày', '영수증·일일보고 업로드'),
  'Submit Report': P('提交报告', '提交報告', 'Nộp báo cáo', '보고 제출'),
  'Store was closed (Rest Day)': P('当日休业', '當日休業', 'Cửa hàng nghỉ', '휴점일'),
  'Total Sales': P('销售总额', '營業額合計', 'Tổng doanh thu', '총매출'),
  'Enter total sales amount': P('输入销售总额', '輸入營業額合計', 'Nhập tổng doanh thu', '총매출을 입력하세요'),
  'Receipt images': P('收据照片', '收據照片', 'Ảnh hóa đơn', '영수증 사진'),
  'Click to browse (JPG, PNG)': P('点击选择图片（JPG、PNG）', '點擊選擇圖片（JPG、PNG）', 'Chọn ảnh (JPG, PNG)', '이미지 선택(JPG, PNG)'),
  'Add notes for this report (optional)': P('添加备注（选填）', '新增備註（選填）', 'Thêm ghi chú (không bắt buộc)', '보고 메모 추가(선택)'),
  'Reason for closure (e.g. maintenance)': P('休业原因（例如维修）', '休業原因（例如維修）', 'Lý do nghỉ (ví dụ: bảo trì)', '휴점 사유(예: 점검)'),
  'Search menu or category': P('搜索菜单或分类', '搜尋菜單或分類', 'Tìm món hoặc nhóm', '메뉴 또는 분류 검색'),
  'Single Items & Recipes': P('单品与配方', '單品與配方', 'Món lẻ & công thức', '단품·레시피'),
  'Courses & Sets': P('套餐与组合', '套餐與組合', 'Set & thực đơn theo khóa', '코스·세트'),
  'Menus, Courses & Recipes': P('菜单、套餐与配方', '菜單、套餐與配方', 'Món, set & công thức', '메뉴·코스·레시피'),
  'RECIPE SETUP': P('配方设置', '配方設定', 'THIẾT LẬP CÔNG THỨC', '레시피 설정'),
  'Register ingredient quantities for single items first, then build courses and sets.': P('先设置单品食材用量，再创建套餐。', '先設定單品食材用量，再建立套餐。', 'Khai báo lượng nguyên liệu cho món lẻ trước, sau đó tạo set.', '단품의 재료 사용량을 먼저 등록한 뒤 코스·세트를 구성하세요.'),
  'SINGLE ITEMS': P('单品', '單品', 'MÓN LẺ', '단품'),
  'Individually sold menu items': P('单独销售的菜品', '單獨銷售的菜品', 'Món bán riêng', '단품 판매 메뉴'),
  'RECIPES READY': P('配方完成度', '配方完成度', 'CÔNG THỨC HOÀN TẤT', '레시피 완료'),
  'COURSES & SETS': P('套餐', '套餐', 'SET / COMBO', '코스·세트'),
  'Components configured': P('组成已设置', '組成已設定', 'Đã khai báo thành phần', '구성 완료'),
  'Register each individually sold menu item and the ingredients used in one serving.': P('登记各单品及每份所用食材。', '登記各單品及每份所用食材。', 'Khai báo từng món bán lẻ và nguyên liệu dùng cho một phần.', '각 단품 메뉴와 1인분에 들어가는 재료를 등록하세요.'),
  'Add Item': P('添加单品', '新增單品', 'Thêm món', '메뉴 추가'),
  'STORE COST INPUT': P('门店成本输入', '門店成本輸入', 'NHẬP GIÁ VỐN CỬA HÀNG', '점포 원가 입력'),
  'Record purchases and month-end counts to calculate actual cost and improvement opportunities.': P('输入采购与月末盘点，计算实际成本并发现改善点。', '輸入採購與月底盤點，計算實際成本並找出改善點。', 'Nhập mua hàng và tồn cuối tháng để tính giá vốn thực tế và điểm cần cải thiện.', '매입과 월말 재고를 입력하여 실제 원가와 개선점을 계산합니다.'),
  Ingredient: P('食材', '食材', 'Nguyên liệu', '재료'),
  Content: P('内容量', '內容量', 'Quy cách', '내용량'),
  'Base Unit Cost': P('基础单位成本', '基本單位成本', 'Giá đơn vị cơ sở', '기준 단가'),
  'Base unit cost': P('基础单位成本', '基本單位成本', 'Giá đơn vị cơ sở', '기준 단가'),
  'Pack price': P('包装价格', '包裝價格', 'Giá mỗi gói', '포장 가격'),
  'Monthly Purchases': P('月度采购', '月間採購', 'Mua hàng trong tháng', '월 매입'),
  'Add Purchase': P('添加采购', '新增採購', 'Thêm mua hàng', '매입 추가'),
  'MONTHLY PURCHASES': P('月度采购', '月間採購', 'MUA HÀNG TRONG THÁNG', '월 매입'),
  'PURCHASE ENTRIES': P('采购记录数', '採購紀錄數', 'SỐ LẦN MUA', '매입 건수'),
  'CONFIGURED INGREDIENTS': P('已设置食材', '已設定食材', 'NGUYÊN LIỆU ĐÃ THIẾT LẬP', '설정된 재료'),
  Packages: P('采购包数', '採購包數', 'Số gói', '구매 수량'),
  'Base Quantity': P('基础单位数量', '基本單位數量', 'Số lượng quy đổi', '기준 단위 수량'),
  Total: P('合计', '合計', 'Tổng', '합계'),
  'Supplier / Notes': P('供应商／备注', '供應商／備註', 'Nhà cung cấp / ghi chú', '공급처·메모'),
  'Month-End Inventory Close': P('月末库存盘点', '月底盤點', 'Chốt tồn kho cuối tháng', '월말 재고 마감'),
  'Opening *': P('月初 *', '月初 *', 'Đầu tháng *', '월초 *'),
  Opening: P('月初库存', '月初庫存', 'Tồn đầu tháng', '월초 재고'),
  Purchased: P('已采购', '已採購', 'Đã mua', '매입'),
  'Waste (opt.)': P('损耗（选填）', '耗損（選填）', 'Hủy hao (không bắt buộc)', '폐기(선택)'),
  'Adjust (opt.)': P('调整（选填）', '調整（選填）', 'Điều chỉnh (không bắt buộc)', '조정(선택)'),
  'Closing *': P('月末 *', '月底 *', 'Cuối tháng *', '월말 *'),
  Closing: P('月末库存', '月底庫存', 'Tồn cuối tháng', '월말 재고'),
  'Adjustment (+/-)': P('库存调整（＋／－）', '庫存調整（＋／－）', 'Điều chỉnh (+/-)', '재고 조정(+/-)'),
  'Actual usage': P('实际用量', '實際用量', 'Lượng dùng thực tế', '실제 사용량'),
  'Show valuation details': P('显示金额明细', '顯示金額明細', 'Hiện chi tiết giá trị', '금액 상세 보기'),
  'Count complete *': P('盘点完成 *', '盤點完成 *', 'Đã kiểm kê *', '재고 조사 완료 *'),
  'Valuation details': P('金额明细', '金額明細', 'Chi tiết giá trị', '금액 상세'),
  Open: P('未完成', '未完成', 'Chưa hoàn tất', '미완료'),
  'Cost, Purchases & Inventory': P('成本、采购与库存', '成本、採購與庫存', 'Giá vốn, mua hàng & tồn kho', '원가·매입·재고'),
  'Ingredients & Purchases': P('食材与采购', '食材與採購', 'Nguyên liệu & mua hàng', '재료·매입'),
  'Inventory Close': P('库存盘点结算', '盤點結算', 'Chốt tồn kho', '재고 마감'),
  Overview: P('概览', '總覽', 'Tổng quan', '개요'),
  Ingredients: P('食材', '食材', 'Nguyên liệu', '재료'),
  Purchases: P('采购', '採購', 'Mua hàng', '매입'),
  Inventory: P('库存', '庫存', 'Tồn kho', '재고'),
  'Ingredient Setup': P('食材设置', '食材設定', 'Thiết lập nguyên liệu', '재료 설정'),
  'Purchase History': P('采购记录', '採購紀錄', 'Lịch sử mua hàng', '매입 내역'),
  'Opening Inventory': P('月初库存', '月初庫存', 'Tồn đầu tháng', '월초 재고'),
  'Closing Inventory': P('月末库存', '月底庫存', 'Tồn cuối tháng', '월말 재고'),
  'Purchase Unit': P('采购单位', '採購單位', 'Đơn vị mua', '구매 단위'),
  'Content Quantity': P('内容量', '內容量', 'Khối lượng quy đổi', '내용량'),
  'Pack Price': P('包装价格', '包裝價格', 'Giá mỗi gói', '포장 가격'),
  Supplier: P('供应商', '供應商', 'Nhà cung cấp', '공급처'),
  Category: P('分类', '分類', 'Nhóm', '분류'),
  Quantity: P('数量', '數量', 'Số lượng', '수량'),
  'Purchase Date': P('采购日期', '採購日期', 'Ngày mua', '매입일'),
  'Total Cost': P('总成本', '總成本', 'Tổng chi phí', '합계 금액'),
  Notes: P('备注', '備註', 'Ghi chú', '메모'),
  Waste: P('损耗', '耗損', 'Hủy hao', '폐기'),
  Adjustment: P('调整', '調整', 'Điều chỉnh', '조정'),
  'Count complete': P('盘点完成', '盤點完成', 'Đã kiểm kê', '재고 조사 완료'),
  'Actual Cost Rate': P('实际成本率', '實際成本率', 'Tỷ lệ giá vốn thực tế', '실제 원가율'),
  'ACTUAL COST RATE': P('实际成本率', '實際成本率', 'TỶ LỆ GIÁ VỐN THỰC TẾ', '실제 원가율'),
  'RECIPE COST RATE': P('配方成本率', '配方成本率', 'TỶ LỆ GIÁ VỐN CÔNG THỨC', '레시피 원가율'),
  'ACTUAL − RECIPE GAP': P('实际－配方差异', '實際－配方差異', 'CHÊNH LỆCH THỰC TẾ − CÔNG THỨC', '실제－레시피 차이'),
  'Monthly Cost Review': P('月度成本分析', '月度成本分析', 'Phân tích giá vốn tháng', '월 원가 분석'),
  'Why Cost Changed': P('成本变化原因', '成本變動原因', 'Nguyên nhân giá vốn thay đổi', '원가 변동 원인'),
  'Menu & Course Profitability': P('单品与套餐收益', '單品與套餐收益', 'Lợi nhuận món & set', '메뉴·코스 수익성'),
  'Selling Price': P('售价', '售價', 'Giá bán', '판매가'),
  'Recipe Cost': P('配方成本', '配方成本', 'Giá vốn công thức', '레시피 원가'),
  'Cost Rate': P('成本率', '成本率', 'Tỷ lệ giá vốn', '원가율'),
  'Sold Quantity': P('销售数量', '銷售數量', 'Số lượng bán', '판매 수량'),
  'Theoretical Usage': P('理论用量', '理論用量', 'Lượng dùng lý thuyết', '이론 사용량'),
  'Actual Usage': P('实际用量', '實際用量', 'Lượng dùng thực tế', '실제 사용량'),
  'Usage Variance': P('用量差异', '用量差異', 'Chênh lệch sử dụng', '사용량 차이'),
  'Cost and inventory month': P('成本与库存月份', '成本與庫存月份', 'Tháng giá vốn & tồn kho', '원가·재고 대상월'),
  'Reload cost and inventory': P('重新加载成本与库存', '重新載入成本與庫存', 'Tải lại giá vốn & tồn kho', '원가·재고 새로고침'),
  'Cost management sections': P('成本管理菜单', '成本管理選單', 'Các mục quản lý giá vốn', '원가 관리 메뉴'),
  'PRODUCT SALES QUANTITIES': P('商品销售数量', '商品銷售數量', 'SỐ LƯỢNG BÁN SẢN PHẨM', '상품 판매 수량'),
  'Choose the source used for recipe-cost analysis': P('选择配方成本分析使用的数量来源', '選擇配方成本分析使用的數量來源', 'Chọn nguồn số lượng dùng để phân tích giá vốn công thức', '레시피 원가 분석에 사용할 수량 출처 선택'),
  'This changes only menu and course quantities used for theoretical cost. It never changes the daily sales amount.': P('仅更改理论成本使用的菜单和套餐数量，不会更改每日销售金额。', '僅變更理論成本使用的菜單與套餐數量，不會變更每日營業額。', 'Chỉ thay đổi số lượng món/set dùng cho giá vốn lý thuyết, không thay đổi doanh thu ngày.', '이론 원가에 사용하는 메뉴·코스 수량만 변경하며 일매출 금액은 바뀌지 않습니다.'),
  'SOURCE CONFIRMED': P('来源已确认', '來源已確認', 'ĐÃ XÁC NHẬN NGUỒN', '출처 확인 완료'),
  'Use daily sales reports': P('使用每日销售报告', '使用每日營業報告', 'Dùng báo cáo doanh thu ngày', '일일 매출보고 사용'),
  'For stores that enter menu and course quantities with each daily report.': P('适用于每天报告菜单与套餐数量的门店。', '適用於每天報告菜單與套餐數量的門店。', 'Dành cho cửa hàng nhập số lượng món và set trong từng báo cáo ngày.', '매일 보고할 때 메뉴·코스 수량을 입력하는 점포용입니다.'),
  'Enter monthly POS totals': P('输入月度POS合计', '輸入月度POS合計', 'Nhập tổng POS tháng', '월간 POS 합계 입력'),
  'For stores that have one month-end POS product report instead of daily item quantities.': P('适用于月末取得一次POS商品报告、而非每天输入商品数量的门店。', '適用於月底取得一次POS商品報告、而非每天輸入商品數量的門店。', 'Dành cho cửa hàng có một báo cáo sản phẩm POS cuối tháng thay vì số lượng từng ngày.', '일별 상품 수량 대신 월말 POS 상품 보고서를 사용하는 점포용입니다.'),
  'Source note (optional)': P('来源资料备注（选填）', '來源資料備註（選填）', 'Ghi chú nguồn (không bắt buộc)', '출처 자료 메모(선택)'),
  'Source note (required)': P('来源资料备注（必填）', '來源資料備註（必填）', 'Ghi chú nguồn (bắt buộc)', '출처 자료 메모(필수)'),
  'I checked every menu and course quantity against the monthly POS report.': P('我已将全部菜单和套餐数量与月度POS报告核对。', '我已將全部菜單和套餐數量與月度POS報告核對。', 'Tôi đã đối chiếu toàn bộ số lượng món và set với báo cáo POS tháng.', '모든 메뉴·코스 수량을 월간 POS 보고서와 대조했습니다.'),
  'Required before saving monthly POS totals.': P('保存月度POS合计前必须确认。', '儲存月度POS合計前必須確認。', 'Bắt buộc trước khi lưu tổng POS tháng.', '월간 POS 합계를 저장하기 전에 필수입니다.'),
  'Save & Confirm Source': P('保存并确认来源', '儲存並確認來源', 'Lưu & xác nhận nguồn', '출처 저장·확인'),
  'MONTHLY COST RESULT': P('月度成本结果', '月度成本結果', 'KẾT QUẢ GIÁ VỐN THÁNG', '월 원가 결과'),
  'Formula: opening stock value + monthly purchases + inventory adjustments − closing stock value': P('公式：月初库存金额＋月度采购＋库存调整－月末库存金额', '公式：月初庫存金額＋月間採購＋庫存調整－月底庫存金額', 'Công thức: tồn đầu kỳ + mua trong tháng + điều chỉnh − tồn cuối kỳ', '계산식: 월초 재고금액 + 월 매입 + 재고조정 − 월말 재고금액'),
  'IN PROGRESS': P('输入中', '輸入中', 'ĐANG THỰC HIỆN', '입력 중'),
  'Monthly Settings': P('月度设置', '月度設定', 'Thiết lập tháng', '월 설정'),
  Pending: P('待完成', '待完成', 'Chưa hoàn tất', '미완료'),
  'NET SALES': P('净销售额', '淨營業額', 'DOANH THU THUẦN', '순매출'),
  'Same daily-sales basis used by HQ': P('与总部相同的每日销售口径', '與總部相同的每日營業額口徑', 'Cùng cơ sở doanh thu ngày như trụ sở', '본사와 동일한 일매출 기준'),
  'Complete recipes and ingredient costs': P('完成配方与食材成本', '完成配方與食材成本', 'Hoàn tất công thức và giá nguyên liệu', '레시피와 재료 원가를 완료하세요'),
  'Not ready': P('未就绪', '未就緒', 'Chưa sẵn sàng', '준비 안 됨'),
  'Complete recipes, costs, and inventory': P('完成配方、成本与库存', '完成配方、成本與庫存', 'Hoàn tất công thức, giá và tồn kho', '레시피·원가·재고를 완료하세요'),
  'Target rate': P('目标成本率', '目標成本率', 'Tỷ lệ mục tiêu', '목표 원가율'),
  'Opening stock': P('月初库存', '月初庫存', 'Tồn đầu tháng', '월초 재고'),
  Adjustments: P('库存调整', '庫存調整', 'Điều chỉnh', '재고 조정'),
  'Closing stock': P('月末库存', '月底庫存', 'Tồn cuối tháng', '월말 재고'),
  'Waste value': P('损耗金额', '耗損金額', 'Giá trị hao hụt', '폐기 금액'),
  'Cost Control Position': P('成本管理位置', '成本管理位置', 'Vị trí kiểm soát giá vốn', '원가 관리 위치'),
  'Final actual cost appears only after every inventory count is complete.': P('全部盘点完成后才显示最终实际成本。', '全部盤點完成後才顯示最終實際成本。', 'Chỉ hiển thị giá vốn thực tế cuối cùng sau khi kiểm kê đủ.', '모든 재고 조사가 완료된 후 최종 실제 원가를 표시합니다.'),
  Actual: P('实际', '實際', 'Thực tế', '실제'),
  Target: P('目标', '目標', 'Mục tiêu', '목표'),
  Recipe: P('配方', '配方', 'Công thức', '레시피'),
  'TO REACH TARGET': P('达到目标所需措施', '達到目標所需措施', 'ĐỂ ĐẠT MỤC TIÊU', '목표 달성 조치'),
  'Finish inventory first': P('请先完成盘点', '請先完成盤點', 'Hoàn tất tồn kho trước', '재고 마감을 먼저 완료하세요'),
  'ACTUAL VS RECIPE': P('实际与配方', '實際與配方', 'THỰC TẾ SO VỚI CÔNG THỨC', '실제와 레시피 비교'),
  'Separates supplier price changes, recorded waste, and the remaining usage difference from the recipe.': P('分别显示供应商价格变动、已登记损耗和相对配方的剩余用量差异。', '分別顯示供應商價格變動、已登記耗損和相對配方的剩餘用量差異。', 'Tách biến động giá mua, hao hụt đã ghi và chênh lệch sử dụng còn lại so với công thức.', '매입단가 변동, 등록된 폐기, 레시피 대비 나머지 사용량 차이를 구분합니다.'),
  'Complete inventory and recipe coverage to separate the causes.': P('完成盘点与配方覆盖后才能区分原因。', '完成盤點與配方覆蓋後才能區分原因。', 'Hoàn tất tồn kho và công thức để tách nguyên nhân.', '재고와 레시피 등록을 완료해야 원인을 구분할 수 있습니다.'),
  'Excess Cost Drivers': P('超额成本主要原因', '超額成本主要原因', 'Nguyên nhân chi phí vượt mức', '초과 원가 주요 원인'),
  'Ingredients with the largest actual cost above recipe cost.': P('实际成本高于配方成本最多的食材。', '實際成本高於配方成本最多的食材。', 'Nguyên liệu có giá vốn thực tế vượt công thức nhiều nhất.', '실제 원가가 레시피 원가를 가장 많이 초과한 재료입니다.'),
  'Complete inventory close': P('完成库存盘点', '完成庫存盤點', 'Hoàn tất chốt tồn kho', '재고 마감 완료'),
  'View All Ingredient Usage Gaps': P('查看全部食材用量差异', '查看全部食材用量差異', 'Xem mọi chênh lệch sử dụng nguyên liệu', '전체 재료 사용량 차이 보기'),
  'Compare recipe usage with actual usage calculated from inventory.': P('比较配方用量与根据库存计算的实际用量。', '比較配方用量與根據庫存計算的實際用量。', 'So sánh lượng theo công thức với lượng thực tế tính từ tồn kho.', '레시피 사용량과 재고로 계산한 실제 사용량을 비교합니다.'),
  'View Menu & Course Profitability': P('查看菜单与套餐收益性', '查看菜單與套餐收益性', 'Xem lợi nhuận món & set', '메뉴·코스 수익성 보기'),
  'Review recipe cost by menu using monthly sales quantities.': P('使用月度销售数量查看各菜单的配方成本。', '使用月度銷售數量查看各菜單的配方成本。', 'Xem giá vốn công thức từng món theo số lượng bán tháng.', '월 판매수량으로 메뉴별 레시피 원가를 확인합니다.'),
  'Recipe Usage': P('配方用量', '配方用量', 'Lượng theo công thức', '레시피 사용량'),
  'Usage Gap': P('用量差异', '用量差異', 'Chênh lệch sử dụng', '사용량 차이'),
  'Price Effect': P('价格影响', '價格影響', 'Ảnh hưởng giá', '가격 영향'),
  'Waste Effect': P('损耗影响', '耗損影響', 'Ảnh hưởng hao hụt', '폐기 영향'),
  'Other Usage': P('其他用量差异', '其他用量差異', 'Sử dụng khác', '기타 사용량'),
  'Total Gap': P('总差异', '總差異', 'Tổng chênh lệch', '총 차이'),
  'Share of Actual Cost': P('占实际成本比', '占實際成本比', 'Tỷ trọng giá vốn thực tế', '실제 원가 비중'),
  Check: P('确认', '確認', 'Kiểm tra', '확인'),
  Menu: P('菜单', '菜單', 'Món', '메뉴'),
  'Single / Course Sales': P('单品／套餐销量', '單品／套餐銷量', 'Bán lẻ / set', '단품·코스 판매'),
  'Recipe Status': P('配方状态', '配方狀態', 'Trạng thái công thức', '레시피 상태'),
  'Recipe Cost / Unit': P('每份配方成本', '每份配方成本', 'Giá vốn công thức / phần', '1개당 레시피 원가'),
  'Recipe Cost Rate': P('配方成本率', '配方成本率', 'Tỷ lệ giá vốn công thức', '레시피 원가율'),
  'Monthly Recipe Cost': P('月度配方成本', '月度配方成本', 'Giá vốn công thức tháng', '월 레시피 원가'),
  'Missing recipe': P('缺少配方', '缺少配方', 'Thiếu công thức', '레시피 없음'),
  'Missing ingredient cost': P('缺少食材成本', '缺少食材成本', 'Thiếu giá nguyên liệu', '재료 원가 없음'),
  'Course / Set': P('套餐', '套餐', 'Set', '코스·세트'),
  'Units Sold': P('销售数量', '銷售數量', 'Số lượng bán', '판매 수량'),
  Components: P('组成菜单', '組成菜單', 'Thành phần', '구성 메뉴'),
  'Ingredient Purchase Setup': P('食材采购单位设置', '食材採購單位設定', 'Thiết lập đơn vị mua nguyên liệu', '재료 구매단위 설정'),
  'Review each ingredient in one row and open the form only when changes are needed.': P('每种食材一行确认，仅在需要修改时打开表单。', '每種食材一列確認，僅在需要修改時開啟表單。', 'Xem mỗi nguyên liệu trên một dòng; chỉ mở biểu mẫu khi cần sửa.', '재료별로 한 줄에서 확인하고 변경할 때만 입력창을 여세요.'),
  'Ingredient to configure': P('要设置的食材', '要設定的食材', 'Nguyên liệu cần thiết lập', '설정할 재료'),
  'Select a registered ingredient': P('选择已登记食材', '選擇已登記食材', 'Chọn nguyên liệu đã đăng ký', '등록된 재료 선택'),
  'Add Purchase Setup': P('添加采购单位设置', '新增採購單位設定', 'Thêm thiết lập mua hàng', '구매단위 설정 추가'),
  'Enter package count and invoice total; base-unit quantity is calculated automatically.': P('输入包装数量和发票合计，系统自动计算基础单位数量。', '輸入包裝數量和發票合計，系統自動計算基本單位數量。', 'Nhập số gói và tổng hóa đơn; số lượng quy đổi được tính tự động.', '구매 수량과 청구 합계를 입력하면 기준 단위 수량이 자동 계산됩니다.'),
  'Opening + purchases + adjustment − closing = actual usage and actual cost. Enter quantities first and expand valuation details only when needed.': P('月初＋采购＋调整－月末＝实际用量和实际成本。先输入数量，仅在需要时展开金额明细。', '月初＋採購＋調整－月底＝實際用量和實際成本。先輸入數量，僅在需要時展開金額明細。', 'Tồn đầu + mua + điều chỉnh − tồn cuối = lượng dùng và giá vốn thực tế. Nhập số lượng trước, chỉ mở chi tiết giá trị khi cần.', '월초 + 매입 + 조정 − 월말 = 실제 사용량과 실제 원가입니다. 수량을 먼저 입력하고 필요할 때만 금액 상세를 여세요.'),
  'Required:': P('必填：', '必填：', 'Bắt buộc:', '필수:'),
  'Optional:': P('选填：', '選填：', 'Không bắt buộc:', '선택:'),
  'confirm opening quantity, closing quantity, and Count complete after physically counting the ingredient. Opening unit cost is also required when opening quantity is above 0.': P('实物盘点后确认月初数量、月末数量并勾选“盘点完成”。月初数量大于0时还必须输入月初单价。', '實物盤點後確認月初數量、月底數量並勾選「盤點完成」。月初數量大於0時還必須輸入月初單價。', 'Sau khi kiểm kê thực tế, xác nhận tồn đầu, tồn cuối và đánh dấu hoàn tất. Nếu tồn đầu lớn hơn 0 thì phải nhập đơn giá đầu kỳ.', '실물 재고 조사 후 월초·월말 수량을 확인하고 재고 조사 완료를 체크하세요. 월초 수량이 0보다 크면 월초 단가도 필수입니다.'),
  'waste, adjustment, and notes may remain 0 or blank.': P('损耗、调整和备注可保持为0或留空。', '耗損、調整和備註可保持為0或留空。', 'Hao hụt, điều chỉnh và ghi chú có thể để 0 hoặc trống.', '폐기·조정·메모는 0 또는 빈칸으로 둘 수 있습니다.'),
  'Close valuation details': P('关闭金额明细', '關閉金額明細', 'Đóng chi tiết giá trị', '금액 상세 닫기'),
  'Example: POS July report checked by store manager': P('例如：店长已确认的7月POS报告', '例如：店長已確認的7月POS報告', 'Ví dụ: Báo cáo POS tháng 7 đã được quản lý kiểm tra', '예: 점장이 확인한 7월 POS 보고서'),
  'Menu OK': P('菜单完成', '菜單完成', 'Món đã đủ', '메뉴 완료'),
  'Staff OK': P('员工完成', '員工完成', 'Nhân sự đã đủ', '직원 완료'),
  'Finish the month in 3 steps': P('分3步完成月度结算', '分3步完成月結', 'Hoàn tất tháng trong 3 bước', '3단계로 월 마감 완료'),
  'Store monthly operations': P('门店月度运营', '門店月度營運', 'Vận hành tháng của cửa hàng', '점포 월 운영'),
  'Monthly Operations Check': P('月度运营确认', '月度營運確認', 'Kiểm tra vận hành tháng', '월 운영 확인'),
  'Monthly operations month': P('月度运营月份', '月度營運月份', 'Tháng vận hành', '월 운영 대상월'),
  'Reload monthly operations': P('重新加载月度运营', '重新載入月度營運', 'Tải lại vận hành tháng', '월 운영 새로고침'),
  'Reload monthly profit inputs': P('重新加载月度收益输入', '重新載入月度收益輸入', 'Tải lại dữ liệu lợi nhuận tháng', '월 수익 입력 새로고침'),
  'Reload monthly profitability': P('重新加载月度收益分析', '重新載入月度收益分析', 'Tải lại phân tích lợi nhuận tháng', '월 수익성 새로고침'),
  'REPORTED SALES': P('已报告销售额', '已報告營業額', 'DOANH THU ĐÃ BÁO CÁO', '보고된 매출'),
  'Reported sales': P('已报告销售额', '已報告營業額', 'Doanh thu đã báo cáo', '보고된 매출'),
  'DAILY REPORTS': P('每日报告', '每日報告', 'BÁO CÁO NGÀY', '일일 보고'),
  'Daily reports': P('每日报告', '每日報告', 'Báo cáo ngày', '일일 보고'),
  'REVIEW STATUS': P('确认状态', '確認狀態', 'TRẠNG THÁI KIỂM TRA', '검토 상태'),
  'Review status': P('确认状态', '確認狀態', 'Trạng thái kiểm tra', '검토 상태'),
  'Through the latest completed day': P('截至最近完成日期', '截至最近完成日期', 'Đến ngày đã hoàn tất gần nhất', '최근 입력 완료일까지'),
  'Attached to open-day reports': P('已附在营业日报中', '已附於營業日報告', 'Đã đính kèm vào báo cáo ngày mở cửa', '영업일 보고에 첨부됨'),
  Draft: P('草稿', '草稿', 'Bản nháp', '임시 저장'),
  'Waiting for completion': P('等待完成', '等待完成', 'Đang chờ hoàn tất', '입력 완료 대기'),
  'These checks come directly from the daily reports already stored in the system.': P('以下检查直接基于系统中已保存的每日报告。', '以下檢查直接依據系統中已儲存的每日報告。', 'Các mục này được kiểm tra trực tiếp từ báo cáo ngày đã lưu.', '저장된 일일 보고를 기준으로 자동 확인합니다.'),
  'Action needed': P('需要处理', '需要處理', 'Cần xử lý', '조치 필요'),
  'Daily sales reports': P('每日销售报告', '每日營業報告', 'Báo cáo doanh thu ngày', '일일 매출 보고'),
  'Labor, hours, fees, utilities and other operating totals': P('人工费、工时、手续费、水电及其他运营费合计', '人事費、工時、手續費、水電及其他營運費合計', 'Tổng nhân công, giờ làm, phí, điện nước và chi phí khác', '인건비·근무시간·수수료·수도광열비·기타 운영비 합계'),
  'Input needed': P('需要输入', '需要輸入', 'Cần nhập', '입력 필요'),
  'Use the POS guest total when available.': P('如POS可提供客数合计，请输入该数字。', '如POS可提供來客數合計，請輸入該數字。', 'Nhập tổng số khách từ POS nếu có.', 'POS 고객 수 합계를 확인할 수 있으면 입력하세요.'),
  'POS monthly total': P('POS月度合计', 'POS月間合計', 'Tổng tháng từ POS', 'POS 월 합계'),
  'One total from the attendance system.': P('请输入考勤系统的月度合计。', '請輸入考勤系統的月間合計。', 'Nhập một tổng tháng từ hệ thống chấm công.', '근태 시스템의 월 합계를 입력하세요.'),
  'Attendance monthly total': P('考勤月度合计', '考勤月間合計', 'Tổng giờ công tháng', '근태 월 합계'),
  'Entry rule': P('输入规则', '輸入規則', 'Quy tắc nhập', '입력 규칙'),
  'Blank means not entered': P('空白表示尚未输入', '空白表示尚未輸入', 'Để trống nghĩa là chưa nhập', '빈칸은 미입력으로 처리됩니다'),
  'Enter 0 only when the confirmed monthly amount is actually zero. This keeps missing data separate from zero cost.': P('仅在确认月度金额确实为0时输入0，以区分未输入和0成本。', '僅在確認月間金額確實為0時輸入0，以區分未輸入和0成本。', 'Chỉ nhập 0 khi số tiền tháng thực sự bằng 0 để phân biệt với chưa nhập.', '확인한 월 금액이 실제 0일 때만 0을 입력하세요. 미입력과 0원을 구분합니다.'),
  'One monthly total from payroll': P('工资资料的月度合计', '薪資資料的月間合計', 'Một tổng tháng từ bảng lương', '급여 자료의 월 합계'),
  'Optional · HQ default': P('选填 · 总部默认值', '選填 · 本部預設值', 'Không bắt buộc · mặc định trụ sở', '선택 · 본사 기본값'),
  'Electricity, gas and water total': P('电费、燃气费和水费合计', '電費、瓦斯費和水費合計', 'Tổng điện, gas và nước', '전기·가스·수도 합계'),
  'Supplies, cleaning, repairs and marketing': P('耗材、清洁、维修和营销费合计', '耗材、清潔、維修和行銷費合計', 'Tổng vật tư, vệ sinh, sửa chữa và tiếp thị', '소모품·청소·수선·마케팅 합계'),
  'Monthly note': P('月度备注', '月度備註', 'Ghi chú tháng', '월 메모'),
  'Not entered': P('未输入', '未輸入', 'Chưa nhập', '미입력'),
  'Optional: import a POS, attendance or cost file': P('选填：导入POS、考勤或成本文件', '選填：匯入POS、考勤或成本檔案', 'Không bắt buộc: nhập tệp POS, chấm công hoặc chi phí', '선택: POS·근태·원가 파일 가져오기'),
  'Open only when a CSV/XLS/XLSX file is available': P('仅在有CSV/XLS/XLSX文件时打开', '僅在有CSV/XLS/XLSX檔案時開啟', 'Chỉ mở khi có tệp CSV/XLS/XLSX', 'CSV/XLS/XLSX 파일이 있을 때만 여세요'),
  'Search ingredients': P('搜索食材', '搜尋食材', 'Tìm nguyên liệu', '재료 검색'),
  'Show incomplete only': P('仅显示未完成', '僅顯示未完成', 'Chỉ hiện mục chưa hoàn tất', '미완료만 보기'),
  'No ingredients match this filter.': P('没有符合条件的食材。', '沒有符合條件的食材。', 'Không có nguyên liệu phù hợp bộ lọc.', '필터 조건에 맞는 재료가 없습니다.'),
  'Finish missing sales reports and receipts, confirm the total, then submit to HQ.': P('补齐营业报告和收据，确认合计后提交总部。', '補齊營業報告和收據，確認合計後提交總部。', 'Hoàn tất báo cáo, hóa đơn, xác nhận tổng rồi nộp về trụ sở.', '누락된 매출보고와 영수증을 완료하고 합계를 확인한 뒤 본사에 제출하세요.'),
  'Complete reports and totals, close inventory, then review the result and submit.': P('完成报告和月度合计、结算库存后，确认结果并提交。', '完成報告和月度合計、結算庫存後，確認結果並提交。', 'Hoàn tất báo cáo, tổng tháng, chốt tồn kho rồi xem kết quả và nộp.', '보고·월 합계·재고 마감을 완료한 뒤 결과를 확인하고 제출하세요.'),
  'Complete reports & totals': P('完成报告与月度合计', '完成報告與月度合計', 'Hoàn tất báo cáo & tổng tháng', '보고·월 합계 완료'),
  'Close inventory': P('结算库存', '完成盤點', 'Chốt tồn kho', '재고 마감'),
  'Review and submit': P('确认并提交', '確認並提交', 'Xem và nộp', '확인·제출'),
  Waiting: P('等待完成', '等待完成', 'Đang chờ', '대기 중'),
  'Enter purchases and finish the closing stock count': P('输入采购并完成月末盘点', '輸入採購並完成月底盤點', 'Nhập mua hàng và hoàn tất tồn cuối tháng', '매입을 입력하고 월말 재고를 완료하세요'),
  'Available after totals and inventory are complete': P('月度合计和库存完成后可用', '月度合計和庫存完成後可用', 'Có thể dùng sau khi hoàn tất tổng tháng và tồn kho', '월 합계와 재고 완료 후 사용할 수 있습니다'),
  'Complete these items before submission': P('提交前请完成以下项目', '提交前請完成以下項目', 'Hoàn tất các mục sau trước khi nộp', '제출 전 아래 항목을 완료하세요'),
  'Complete Daily Reports': P('完成每日报告', '完成每日報告', 'Hoàn tất báo cáo ngày', '일일 보고 완료'),
  Enter: P('输入', '輸入', 'Nhập', '입력'),
  'Add receipt': P('添加收据', '新增收據', 'Thêm hóa đơn', '영수증 추가'),
  'Enter Monthly Totals': P('输入月度合计', '輸入月度合計', 'Nhập tổng tháng', '월 합계 입력'),
  'Manual entry': P('手动输入', '手動輸入', 'Nhập thủ công', '수동 입력'),
  'Enter one total for each item. If you do not have a file, complete the month here.': P('每个项目输入一个月度合计；没有文件时请在此输入。', '每個項目輸入一個月度合計；沒有檔案時請在此輸入。', 'Nhập một tổng tháng cho mỗi mục. Nếu không có tệp, hãy nhập tại đây.', '각 항목의 월 합계를 하나씩 입력하세요. 파일이 없으면 여기서 입력하면 됩니다.'),
  'Save Draft': P('保存草稿', '儲存草稿', 'Lưu nháp', '임시 저장'),
  'Next: monthly purchases and inventory': P('下一步：月度采购与库存', '下一步：月間採購與庫存', 'Tiếp theo: mua hàng & tồn kho tháng', '다음: 월 매입·재고'),
  'You can save the current totals as a draft and continue with inventory at any time.': P('可以先保存当前月度合计草稿，之后随时继续库存盘点。', '可以先儲存目前月度合計草稿，之後隨時繼續盤點。', 'Có thể lưu nháp tổng tháng hiện tại và tiếp tục tồn kho bất cứ lúc nào.', '현재 월 합계를 임시 저장하고 언제든 재고 입력을 계속할 수 있습니다.'),
  'Continue to Step 2': P('继续第2步', '前往步驟2', 'Tiếp tục bước 2', '2단계로 계속'),
  'Back to Step 1': P('返回第1步', '返回步驟1', 'Quay lại bước 1', '1단계로 돌아가기'),
  'Review Step 3': P('查看第3步', '查看步驟3', 'Xem bước 3', '3단계 확인'),
  'Finish purchases and closing stock count': P('完成采购和月末盘点', '完成採購和月底盤點', 'Hoàn tất mua hàng và tồn cuối tháng', '매입·월말 재고 완료'),
  'STEP 2 · INVENTORY CLOSE': P('第2步 · 库存盘点', '步驟2 · 庫存盤點', 'BƯỚC 2 · CHỐT TỒN KHO', '2단계 · 재고 마감'),
  'Step 2 · Inventory close': P('第2步 · 库存盘点', '步驟2 · 庫存盤點', 'Bước 2 · Chốt tồn kho', '2단계 · 재고 마감'),
  'Open Purchases & Inventory': P('打开采购与库存', '開啟採購與庫存', 'Mở mua hàng & tồn kho', '매입·재고 입력 열기'),
  'Review Monthly Result': P('查看月度结果', '查看月度結果', 'Xem kết quả tháng', '월 결과 확인'),
  'Actual food cost cannot be finalized until opening stock, purchases and closing stock are complete.': P('月初库存、采购和月末库存完成前无法确定实际成本。', '月初庫存、採購和月底庫存完成前無法確定實際成本。', 'Chưa thể chốt giá vốn thực tế cho đến khi đủ tồn đầu, mua hàng và tồn cuối.', '월초 재고·매입·월말 재고가 완료되어야 실제 원가를 확정할 수 있습니다.'),
  'Final check before submission': P('提交前最终确认', '提交前最終確認', 'Kiểm tra cuối trước khi nộp', '제출 전 최종 확인'),
  'Submit the completed month to HQ': P('将完成的月度数据提交总部', '將完成的月度資料提交總部', 'Nộp tháng đã hoàn tất về trụ sở', '완료된 월 데이터를 본사에 제출'),
  'Submit to HQ': P('提交总部', '提交總部', 'Nộp về trụ sở', '본사 제출'),
  'Monthly Operating Inputs': P('月度运营数据', '月度營運資料', 'Dữ liệu vận hành tháng', '월 운영 데이터'),
  'Manual Entry': P('手动输入', '手動輸入', 'Nhập thủ công', '수동 입력'),
  'Import File': P('导入文件', '匯入檔案', 'Nhập tệp', '파일 가져오기'),
  'Upload CSV / XLS / XLSX': P('上传 CSV / XLS / XLSX', '上傳 CSV / XLS / XLSX', 'Tải CSV / XLS / XLSX', 'CSV / XLS / XLSX 업로드'),
  'Total labor cost': P('人工费总额', '人事費合計', 'Tổng chi phí lao động', '총인건비'),
  'Total labor hours': P('总工时', '總工時', 'Tổng giờ công', '총근무시간'),
  'Guest count': P('顾客人数', '來客數', 'Số khách', '고객 수'),
  Utilities: P('水电燃气费', '水電瓦斯費', 'Điện nước gas', '수도광열비'),
  'Other operating costs': P('其他运营费用', '其他營運費用', 'Chi phí vận hành khác', '기타 운영비'),
  'Sales-linked fees': P('销售联动手续费', '營業額連動手續費', 'Phí theo doanh thu', '매출연동 수수료'),
  'Store Confirmation': P('门店确认', '門店確認', 'Cửa hàng xác nhận', '점포 확인'),
  'Submit Month': P('提交本月', '提交本月', 'Nộp tháng', '월 마감 제출'),
  'Step 3. Review Monthly Result': P('第3步：确认月度结果', '步驟3：確認月度結果', 'Bước 3. Xem kết quả tháng', '3단계. 월 결과 확인'),
  'People records': P('员工资料', '員工資料', 'Hồ sơ nhân sự', '직원 정보'),
  'Keep the active staff list current. Monthly payroll, total labor hours, and labor-cost ratio are managed in Month Close.': P('请及时更新在职员工名单。月度工资、总工时和人工费率在月结中管理。', '請隨時更新在職員工名單。月度薪資、總工時和人事費率在月結中管理。', 'Luôn cập nhật danh sách nhân viên. Lương tháng, tổng giờ công và tỷ lệ nhân công được quản lý trong Chốt tháng.', '재직 직원 목록을 최신 상태로 유지하세요. 월 급여·총근무시간·인건비율은 월 마감에서 관리합니다.'),
  'Staff Management': P('员工管理', '員工管理', 'Quản lý nhân sự', '직원 관리'),
  'Add Staff': P('添加员工', '新增員工', 'Thêm nhân viên', '직원 추가'),
  'Add Employee': P('添加员工', '新增員工', 'Thêm nhân viên', '직원 추가'),
  Name: P('姓名', '姓名', 'Tên', '이름'),
  Position: P('职位', '職位', 'Vị trí', '직책'),
  Email: P('电子邮箱', '電子郵件', 'Email', '이메일'),
  Phone: P('电话', '電話', 'Điện thoại', '전화'),
  'DEMO PREVIEW · Sample numbers only · Never use this screen to verify operating data': P('演示画面 · 仅为示例数据 · 请勿用于核对运营数据', '示範畫面 · 僅為範例資料 · 請勿用於核對營運資料', 'MÀN HÌNH THỬ · Chỉ là số liệu mẫu · Không dùng để kiểm tra dữ liệu vận hành', '데모 화면 · 예시 데이터 · 운영 데이터 확인에 사용하지 마세요'),
  Main: P('主要食材', '主要食材', 'Nguyên liệu chính', '주재료'),
  Secondary: P('辅助食材', '副食材', 'Nguyên liệu phụ', '부재료'),
  'Ingredient name': P('食材名称', '食材名稱', 'Tên nguyên liệu', '재료명'),
  'Base unit': P('基础单位', '基本單位', 'Đơn vị cơ bản', '기준 단위'),
  'Purchase unit': P('采购单位', '採購單位', 'Đơn vị mua', '구매 단위'),
  'Select ingredient': P('选择食材', '選擇食材', 'Chọn nguyên liệu', '재료 선택'),
  'Purchase date': P('采购日期', '採購日期', 'Ngày mua', '매입일'),
  'Invoice total (': P('发票合计 (', '發票合計 (', 'Tổng hóa đơn (', '청구 합계 ('),
  'Save Ingredient Setup': P('保存食材设置', '儲存食材設定', 'Lưu thiết lập nguyên liệu', '재료 설정 저장'),
  'Save Purchase': P('保存采购', '儲存採購', 'Lưu mua hàng', '매입 저장'),
  'Invoice number, price change, delivery issue, etc.': P('发票号码、价格变动、交货问题等', '發票號碼、價格變動、交貨問題等', 'Số hóa đơn, thay đổi giá, vấn đề giao hàng...', '청구서 번호, 가격 변경, 납품 문제 등'),
  'e.g. Cabbage': P('例如：卷心菜', '例如：高麗菜', 'Ví dụ: Bắp cải', '예: 양배추'),
  'Item Image': P('菜单图片', '菜單圖片', 'Ảnh món', '메뉴 이미지'),
  'Upload Menu Photo': P('上传菜单照片', '上傳菜單照片', 'Tải ảnh món', '메뉴 사진 업로드'),
  'Supports JPG, PNG': P('支持 JPG、PNG', '支援 JPG、PNG', 'Hỗ trợ JPG, PNG', 'JPG, PNG 지원'),
  'Change Image': P('更换图片', '更換圖片', 'Đổi ảnh', '이미지 변경'),
  'Preview menu image': P('预览菜单图片', '預覽菜單圖片', 'Xem ảnh món', '메뉴 이미지 보기'),
  'Select Category': P('选择分类', '選擇分類', 'Chọn nhóm', '분류 선택'),
  Price: P('售价', '售價', 'Giá bán', '판매가'),
  'Recipe Configuration': P('配方设置', '配方設定', 'Thiết lập công thức', '레시피 설정'),
  'At least 1 ingredient required': P('至少需要1种食材', '至少需要1種食材', 'Cần ít nhất 1 nguyên liệu', '재료 1개 이상 필수'),
  'Add New Ingredient': P('添加新食材', '新增食材', 'Thêm nguyên liệu mới', '새 재료 추가'),
  'Select Standard Ingredient (Optional)': P('选择标准食材（选填）', '選擇標準食材（選填）', 'Chọn nguyên liệu chuẩn (không bắt buộc)', '표준 재료 선택(선택)'),
  'Ingredient Name (e.g. Flour)': P('食材名称（例如：面粉）', '食材名稱（例如：麵粉）', 'Tên nguyên liệu (vd: bột mì)', '재료명(예: 밀가루)'),
  Qty: P('数量', '數量', 'Số lượng', '수량'),
  'Unit (g, ml)': P('单位（g、ml）', '單位（g、ml）', 'Đơn vị (g, ml)', '단위(g, ml)'),
  'Add ingredient to recipe': P('将食材加入配方', '將食材加入配方', 'Thêm nguyên liệu vào công thức', '레시피에 재료 추가'),
  '* Standard ingredients can be selected from the dropdown, and custom ingredients can be added/removed freely.': P('可从列表选择标准食材，也可自由添加或删除自定义食材。', '可從清單選擇標準食材，也可自由新增或刪除自訂食材。', 'Có thể chọn nguyên liệu chuẩn trong danh sách hoặc tự do thêm/xóa nguyên liệu riêng.', '표준 재료는 목록에서 선택하고, 별도 재료도 자유롭게 추가·삭제할 수 있습니다.'),
  'No ingredients configured for this item.': P('此菜单尚未设置食材。', '此菜單尚未設定食材。', 'Món này chưa có nguyên liệu.', '이 메뉴에 등록된 재료가 없습니다.'),
  'Save Item': P('保存菜单', '儲存菜單', 'Lưu món', '메뉴 저장'),
  'New Item': P('新菜单', '新菜單', 'Món mới', '새 메뉴'),
  'Set Name': P('套餐名称', '套餐名稱', 'Tên set', '코스·세트명'),
  'Set Price': P('套餐售价', '套餐售價', 'Giá set', '코스·세트 판매가'),
  'Set Components': P('套餐组成', '套餐組成', 'Thành phần set', '구성 메뉴'),
  'At least 1 required': P('至少需要1项', '至少需要1項', 'Cần ít nhất 1 mục', '1개 이상 필수'),
  'Add Component': P('添加组成菜单', '新增組成菜單', 'Thêm món thành phần', '구성 메뉴 추가'),
  'Select Menu Item': P('选择菜单', '選擇菜單', 'Chọn món', '메뉴 선택'),
  'Close set menu editor': P('关闭套餐编辑', '關閉套餐編輯', 'Đóng chỉnh sửa set', '코스·세트 편집 닫기'),
  'e.g. Family Set A': P('例如：家庭套餐A', '例如：家庭套餐A', 'Ví dụ: Set gia đình A', '예: 패밀리 세트 A'),
  'Remove component': P('删除组成菜单', '刪除組成菜單', 'Xóa món thành phần', '구성 메뉴 삭제'),
  'No normal menu items found. Add menu items first, then create set menus.': P('未找到单品菜单。请先添加单品，再创建套餐。', '找不到單品菜單。請先新增單品，再建立套餐。', 'Chưa có món lẻ. Hãy thêm món trước rồi tạo set.', '단품 메뉴가 없습니다. 단품을 먼저 추가한 뒤 코스·세트를 만드세요.'),
  'Save Set Menu': P('保存套餐', '儲存套餐', 'Lưu set', '코스·세트 저장'),
  'New Set Menu': P('新套餐', '新套餐', 'Set mới', '새 코스·세트'),
  'Courses & Set Menus': P('套餐菜单', '套餐菜單', 'Set & thực đơn set', '코스·세트'),
  'Build a course or set from registered single items and specify the quantity of each component.': P('用已登记的单品组成套餐，并设置各组成菜单的数量。', '用已登記的單品組成套餐，並設定各組成菜單的數量。', 'Tạo set từ các món lẻ đã đăng ký và nhập số lượng từng món.', '등록된 단품으로 코스·세트를 만들고 각 구성 메뉴 수량을 지정합니다.'),
  'Add Set Menu': P('添加套餐', '新增套餐', 'Thêm set', '코스·세트 추가'),
  'Unknown Menu': P('未知菜单', '未知菜單', 'Món không xác định', '알 수 없는 메뉴'),
  'No components configured.': P('尚未设置组成菜单。', '尚未設定組成菜單。', 'Chưa có món thành phần.', '구성 메뉴가 없습니다.'),
  'No set menus yet.': P('尚未登记套餐。', '尚未登記套餐。', 'Chưa có set.', '등록된 코스·세트가 없습니다.'),
  Okonomiyaki: P('大阪烧', '大阪燒', 'Okonomiyaki', '오코노미야키'),
  Yakisoba: P('炒面', '炒麵', 'Yakisoba', '야키소바'),
  'Teppan Dishes': P('铁板料理', '鐵板料理', 'Món teppan', '철판요리'),
  'Side Menu': P('小菜', '附餐', 'Món phụ', '사이드 메뉴'),
  Alcohol: P('酒类', '酒類', 'Đồ uống có cồn', '주류'),
  'Soft Drinks': P('软饮料', '軟性飲料', 'Nước ngọt', '음료'),
  'Staff Details': P('员工信息', '員工資料', 'Thông tin nhân viên', '직원 정보'),
  'Upload staff photo': P('上传员工照片', '上傳員工照片', 'Tải ảnh nhân viên', '직원 사진 업로드'),
  'Photo · Optional': P('照片 · 选填', '照片 · 選填', 'Ảnh · Không bắt buộc', '사진 · 선택'),
  'Full Name': P('姓名', '姓名', 'Họ tên', '성명'),
  'e.g. John Doe': P('例如：张三', '例如：王小明', 'Ví dụ: Nguyễn Văn A', '예: 홍길동'),
  'Select Position': P('选择职位', '選擇職位', 'Chọn vị trí', '직책 선택'),
  'Save Staff': P('保存员工', '儲存員工', 'Lưu nhân viên', '직원 저장'),
  Manager: P('店长', '店長', 'Quản lý', '점장'),
  Chef: P('厨师', '廚師', 'Bếp', '조리 담당'),
  Server: P('服务员', '外場人員', 'Phục vụ', '홀 담당'),
  'Part-time': P('兼职', '兼職', 'Bán thời gian', '아르바이트'),
  'Sign out': P('退出登录', '登出', 'Đăng xuất', '로그아웃'),
};

const DYNAMIC: Record<Exclude<OwnerLocale, 'en' | 'ja'>, Array<[RegExp, (...m: string[]) => string]>> = {
  'zh-CN': [
    [/^Actual cost rate (.+); target (.+); recipe (.+)$/, (_a, actual, target, recipe) => `实际成本率 ${actual === 'not available' ? '不可用' : actual.replace(' percent', '%')}；目标 ${target === 'not set' ? '未设置' : target.replace(' percent', '%')}；配方 ${recipe === 'not available' ? '不可用' : recipe.replace(' percent', '%')}`],
    [/^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})$/, (_a, m, y) => ownerMonthLabel('zh-CN', m, y)],
    [/^Inventory Close (\d+)\/(\d+)$/, (_a, a, b) => `库存盘点 ${a}/${b}`],
    [/^Close (\d+)\/(\d+)$/, (_a, a, b) => `盘点 ${a}/${b}`],
    [/^(\d+) recorded units$/, (_a, n) => `已记录 ${n} 份`],
    [/^(\d+) entered units$/, (_a, n) => `已输入 ${n} 份`],
    [/^(\d+) inventory count\(s\) still open$/, (_a, n) => `还有 ${n} 项库存未盘点`],
    [/^Provisional ([\d.]+)% · finish (\d+) count\(s\)$/, (_a, rate, n) => `暂定 ${rate}% · 还需完成 ${n} 项盘点`],
    [/^(\d+) item\(s\) still block the variance analysis$/, (_a, n) => `还有 ${n} 项设置阻碍差异分析`],
    [/^Single Items & Recipes \((\d+)\)$/, (_a, n) => `单品与配方（${n}）`],
    [/^Courses & Sets \((\d+)\)$/, (_a, n) => `套餐（${n}）`],
    [/^(\d+) ingredients configured$/, (_a, n) => `已设置 ${n} 种食材`],
    [/^(\d+) component menu\(s\)$/, (_a, n) => `${n} 个组成菜单`],
    [/^Edit Item: (.+)$/, (_a, name) => `编辑菜单：${OWNER_TEXT[name]?.['zh-CN'] ?? name}`],
    [/^Edit Set Menu: (.+)$/, (_a, name) => `编辑套餐：${OWNER_TEXT[name]?.['zh-CN'] ?? name}`],
    [/^(\d+)\/(\d+) ingredient counts complete$/, (_a, a, b) => `食材盘点 ${a}/${b} 已完成`],
    [/^Delete (.+) purchase$/, (_a, value) => `删除采购：${value}`],
    [/^Preview photo: (.+)$/, (_a, name) => `查看照片：${name}`],
    [/^Preview image: (.+)$/, (_a, name) => `查看图片：${name}`],
    [/^Edit (.+)$/, (_a, name) => `编辑：${name}`],
    [/^Delete (.+)$/, (_a, name) => `删除：${name}`],
    [/^(.+) opening inventory$/, (_a, name) => `${name} 月初库存`],
    [/^(.+) waste quantity$/, (_a, name) => `${name} 损耗数量`],
    [/^(.+) inventory adjustment$/, (_a, name) => `${name} 库存调整`],
    [/^(.+) closing inventory$/, (_a, name) => `${name} 月末库存`],
    [/^(\d+) days missing$/, (_a, n) => `缺少 ${n} 天`],
    [/^(\d+) missing$/, (_a, n) => `缺少 ${n} 项`],
    [/^(\d+)\/(\d+) due reports complete$/, (_a, a, b) => `应提交报告 ${a}/${b} 已完成`],
    [/^(\d+)\/(\d+) recipes$/, (_a, a, b) => `配方 ${a}/${b}`],
    [/^(\d+) single items · (\d+) courses\/sets$/, (_a, a, b) => `单品 ${a} · 套餐 ${b}`],
    [/^(\d+) staff$/, (_a, n) => `${n} 名员工`],
    [/^(\d+) purchase units$/, (_a, n) => `采购单位 ${n} 项`],
    [/^Show all (\d+) reports$/, (_a, n) => `显示全部 ${n} 条报告`],
    [/^\+(\d+) more$/, (_a, n) => `另有 ${n} 天`],
    [/^(\d+) recipes ready$/, (_a, n) => `已完成 ${n} 个配方`],
    [/^(\d+) staff records$/, (_a, n) => `${n} 名员工资料`],
    [/^([\d.]+)% vs Last Month$/, (_a, n) => `较上月 ${n}%`],
    [/^Total Daily Revenue \((.+)\)$/, (_a, c) => `每日销售总额（${c}）`],
    [/^Decrease (.+)$/, (_a, name) => `减少 ${name}`],
    [/^Increase (.+)$/, (_a, name) => `增加 ${name}`],
    [/^Step (\d+[A-Z]?)\. (.+)$/, (_a, step, label) => `第${step}步：${OWNER_TEXT[label]?.['zh-CN'] ?? label}`],
    [/^(\d+)\. (.+)$/, (_a, step, label) => `${step}. ${OWNER_TEXT[label]?.['zh-CN'] ?? label}`],
    [/^(\d+) menu item\(s\)$/, (_a, n) => `${n} 个组成菜品`],
    [/^(.+) direct quantity$/, (_a, name) => `${name} 单品数量`],
    [/^(\d+)\/(\d+) counts complete$/, (_a, a, b) => `盘点完成 ${a}/${b}`],
    [/^(\d+) item\(s\) need ingredients$/, (_a, n) => `${n} 个单品需要设置食材`],
    [/^(\d+) need components$/, (_a, n) => `${n} 个套餐需要设置内容`],
  ],
  'zh-TW': [
    [/^Actual cost rate (.+); target (.+); recipe (.+)$/, (_a, actual, target, recipe) => `實際成本率 ${actual === 'not available' ? '不可用' : actual.replace(' percent', '%')}；目標 ${target === 'not set' ? '未設定' : target.replace(' percent', '%')}；配方 ${recipe === 'not available' ? '不可用' : recipe.replace(' percent', '%')}`],
    [/^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})$/, (_a, m, y) => ownerMonthLabel('zh-TW', m, y)],
    [/^Inventory Close (\d+)\/(\d+)$/, (_a, a, b) => `庫存盤點 ${a}/${b}`],
    [/^Close (\d+)\/(\d+)$/, (_a, a, b) => `盤點 ${a}/${b}`],
    [/^(\d+) recorded units$/, (_a, n) => `已記錄 ${n} 份`],
    [/^(\d+) entered units$/, (_a, n) => `已輸入 ${n} 份`],
    [/^(\d+) inventory count\(s\) still open$/, (_a, n) => `還有 ${n} 項庫存未盤點`],
    [/^Provisional ([\d.]+)% · finish (\d+) count\(s\)$/, (_a, rate, n) => `暫定 ${rate}% · 還需完成 ${n} 項盤點`],
    [/^(\d+) item\(s\) still block the variance analysis$/, (_a, n) => `還有 ${n} 項設定阻礙差異分析`],
    [/^Single Items & Recipes \((\d+)\)$/, (_a, n) => `單品與配方（${n}）`],
    [/^Courses & Sets \((\d+)\)$/, (_a, n) => `套餐（${n}）`],
    [/^(\d+) ingredients configured$/, (_a, n) => `已設定 ${n} 種食材`],
    [/^(\d+) component menu\(s\)$/, (_a, n) => `${n} 個組成菜單`],
    [/^Edit Item: (.+)$/, (_a, name) => `編輯菜單：${OWNER_TEXT[name]?.['zh-TW'] ?? name}`],
    [/^Edit Set Menu: (.+)$/, (_a, name) => `編輯套餐：${OWNER_TEXT[name]?.['zh-TW'] ?? name}`],
    [/^(\d+)\/(\d+) ingredient counts complete$/, (_a, a, b) => `食材盤點 ${a}/${b} 已完成`],
    [/^Delete (.+) purchase$/, (_a, value) => `刪除採購：${value}`],
    [/^Preview photo: (.+)$/, (_a, name) => `查看照片：${name}`],
    [/^Preview image: (.+)$/, (_a, name) => `查看圖片：${name}`],
    [/^Edit (.+)$/, (_a, name) => `編輯：${name}`],
    [/^Delete (.+)$/, (_a, name) => `刪除：${name}`],
    [/^(.+) opening inventory$/, (_a, name) => `${name} 月初庫存`],
    [/^(.+) waste quantity$/, (_a, name) => `${name} 耗損數量`],
    [/^(.+) inventory adjustment$/, (_a, name) => `${name} 庫存調整`],
    [/^(.+) closing inventory$/, (_a, name) => `${name} 月末庫存`],
    [/^(\d+) days missing$/, (_a, n) => `缺少 ${n} 天`],
    [/^(\d+) missing$/, (_a, n) => `缺少 ${n} 項`],
    [/^(\d+)\/(\d+) due reports complete$/, (_a, a, b) => `應提交報告 ${a}/${b} 已完成`],
    [/^(\d+)\/(\d+) recipes$/, (_a, a, b) => `配方 ${a}/${b}`],
    [/^(\d+) single items · (\d+) courses\/sets$/, (_a, a, b) => `單品 ${a} · 套餐 ${b}`],
    [/^(\d+) staff$/, (_a, n) => `${n} 名員工`],
    [/^(\d+) purchase units$/, (_a, n) => `採購單位 ${n} 項`],
    [/^Show all (\d+) reports$/, (_a, n) => `顯示全部 ${n} 筆報告`],
    [/^\+(\d+) more$/, (_a, n) => `另有 ${n} 天`],
    [/^(\d+) recipes ready$/, (_a, n) => `已完成 ${n} 個配方`],
    [/^(\d+) staff records$/, (_a, n) => `${n} 筆員工資料`],
    [/^([\d.]+)% vs Last Month$/, (_a, n) => `較上月 ${n}%`],
    [/^Total Daily Revenue \((.+)\)$/, (_a, c) => `每日營業額合計（${c}）`],
    [/^Decrease (.+)$/, (_a, name) => `減少 ${name}`],
    [/^Increase (.+)$/, (_a, name) => `增加 ${name}`],
    [/^Step (\d+[A-Z]?)\. (.+)$/, (_a, step, label) => `步驟${step}：${OWNER_TEXT[label]?.['zh-TW'] ?? label}`],
    [/^(\d+)\. (.+)$/, (_a, step, label) => `${step}. ${OWNER_TEXT[label]?.['zh-TW'] ?? label}`],
    [/^(\d+) menu item\(s\)$/, (_a, n) => `${n} 個組成菜品`],
    [/^(.+) direct quantity$/, (_a, name) => `${name} 單品數量`],
    [/^(\d+)\/(\d+) counts complete$/, (_a, a, b) => `盤點完成 ${a}/${b}`],
    [/^(\d+) item\(s\) need ingredients$/, (_a, n) => `${n} 個單品需要設定食材`],
    [/^(\d+) need components$/, (_a, n) => `${n} 個套餐需要設定內容`],
  ],
  vi: [
    [/^Actual cost rate (.+); target (.+); recipe (.+)$/, (_a, actual, target, recipe) => `Tỷ lệ thực tế ${actual === 'not available' ? 'chưa có' : actual.replace(' percent', '%')}; mục tiêu ${target === 'not set' ? 'chưa đặt' : target.replace(' percent', '%')}; công thức ${recipe === 'not available' ? 'chưa có' : recipe.replace(' percent', '%')}`],
    [/^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})$/, (_a, m, y) => ownerMonthLabel('vi', m, y)],
    [/^Inventory Close (\d+)\/(\d+)$/, (_a, a, b) => `Chốt tồn kho ${a}/${b}`],
    [/^Close (\d+)\/(\d+)$/, (_a, a, b) => `Chốt ${a}/${b}`],
    [/^(\d+) recorded units$/, (_a, n) => `${n} phần đã ghi`],
    [/^(\d+) entered units$/, (_a, n) => `${n} phần đã nhập`],
    [/^(\d+) inventory count\(s\) still open$/, (_a, n) => `Còn ${n} nguyên liệu chưa kiểm kê`],
    [/^Provisional ([\d.]+)% · finish (\d+) count\(s\)$/, (_a, rate, n) => `Tạm tính ${rate}% · hoàn tất ${n} kiểm kê`],
    [/^(\d+) item\(s\) still block the variance analysis$/, (_a, n) => `Còn ${n} mục cản trở phân tích chênh lệch`],
    [/^Single Items & Recipes \((\d+)\)$/, (_a, n) => `Món lẻ & công thức (${n})`],
    [/^Courses & Sets \((\d+)\)$/, (_a, n) => `Set (${n})`],
    [/^(\d+) ingredients configured$/, (_a, n) => `Đã thiết lập ${n} nguyên liệu`],
    [/^(\d+) component menu\(s\)$/, (_a, n) => `${n} món thành phần`],
    [/^Edit Item: (.+)$/, (_a, name) => `Sửa món: ${OWNER_TEXT[name]?.vi ?? name}`],
    [/^Edit Set Menu: (.+)$/, (_a, name) => `Sửa set: ${OWNER_TEXT[name]?.vi ?? name}`],
    [/^(\d+)\/(\d+) ingredient counts complete$/, (_a, a, b) => `Đã kiểm kê ${a}/${b} nguyên liệu`],
    [/^Delete (.+) purchase$/, (_a, value) => `Xóa lần mua: ${value}`],
    [/^Preview photo: (.+)$/, (_a, name) => `Xem ảnh: ${name}`],
    [/^Preview image: (.+)$/, (_a, name) => `Xem ảnh: ${name}`],
    [/^Edit (.+)$/, (_a, name) => `Sửa: ${name}`],
    [/^Delete (.+)$/, (_a, name) => `Xóa: ${name}`],
    [/^(.+) opening inventory$/, (_a, name) => `Tồn đầu tháng: ${name}`],
    [/^(.+) waste quantity$/, (_a, name) => `Hao hụt: ${name}`],
    [/^(.+) inventory adjustment$/, (_a, name) => `Điều chỉnh tồn: ${name}`],
    [/^(.+) closing inventory$/, (_a, name) => `Tồn cuối tháng: ${name}`],
    [/^(\d+) days missing$/, (_a, n) => `Thiếu ${n} ngày`],
    [/^(\d+) missing$/, (_a, n) => `Thiếu ${n} mục`],
    [/^(\d+)\/(\d+) due reports complete$/, (_a, a, b) => `Đã đủ ${a}/${b} báo cáo`],
    [/^(\d+)\/(\d+) recipes$/, (_a, a, b) => `Công thức ${a}/${b}`],
    [/^(\d+) single items · (\d+) courses\/sets$/, (_a, a, b) => `${a} món lẻ · ${b} set`],
    [/^(\d+) staff$/, (_a, n) => `${n} nhân viên`],
    [/^(\d+) purchase units$/, (_a, n) => `${n} đơn vị mua`],
    [/^Show all (\d+) reports$/, (_a, n) => `Hiện tất cả ${n} báo cáo`],
    [/^\+(\d+) more$/, (_a, n) => `Thêm ${n} ngày`],
    [/^(\d+) recipes ready$/, (_a, n) => `${n} công thức đã hoàn tất`],
    [/^(\d+) staff records$/, (_a, n) => `${n} hồ sơ nhân viên`],
    [/^([\d.]+)% vs Last Month$/, (_a, n) => `${n}% so với tháng trước`],
    [/^Total Daily Revenue \((.+)\)$/, (_a, c) => `Tổng doanh thu ngày (${c})`],
    [/^Decrease (.+)$/, (_a, name) => `Giảm ${name}`],
    [/^Increase (.+)$/, (_a, name) => `Tăng ${name}`],
    [/^Step (\d+[A-Z]?)\. (.+)$/, (_a, step, label) => `Bước ${step}: ${OWNER_TEXT[label]?.vi ?? label}`],
    [/^(\d+)\. (.+)$/, (_a, step, label) => `${step}. ${OWNER_TEXT[label]?.vi ?? label}`],
    [/^(\d+) menu item\(s\)$/, (_a, n) => `${n} món thành phần`],
    [/^(.+) direct quantity$/, (_a, name) => `Số lượng món lẻ ${name}`],
    [/^(\d+)\/(\d+) counts complete$/, (_a, a, b) => `Đã kiểm kê ${a}/${b}`],
    [/^(\d+) item\(s\) need ingredients$/, (_a, n) => `${n} món cần khai báo nguyên liệu`],
    [/^(\d+) need components$/, (_a, n) => `${n} set cần khai báo thành phần`],
  ],
  ko: [
    [/^Actual cost rate (.+); target (.+); recipe (.+)$/, (_a, actual, target, recipe) => `실제 원가율 ${actual === 'not available' ? '없음' : actual.replace(' percent', '%')}; 목표 ${target === 'not set' ? '미설정' : target.replace(' percent', '%')}; 레시피 ${recipe === 'not available' ? '없음' : recipe.replace(' percent', '%')}`],
    [/^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})$/, (_a, m, y) => ownerMonthLabel('ko', m, y)],
    [/^Inventory Close (\d+)\/(\d+)$/, (_a, a, b) => `재고 마감 ${a}/${b}`],
    [/^Close (\d+)\/(\d+)$/, (_a, a, b) => `마감 ${a}/${b}`],
    [/^(\d+) recorded units$/, (_a, n) => `보고 수량 ${n}개`],
    [/^(\d+) entered units$/, (_a, n) => `입력 수량 ${n}개`],
    [/^(\d+) inventory count\(s\) still open$/, (_a, n) => `재고 조사 ${n}개 미완료`],
    [/^Provisional ([\d.]+)% · finish (\d+) count\(s\)$/, (_a, rate, n) => `잠정 ${rate}% · 재고 조사 ${n}개 완료 필요`],
    [/^(\d+) item\(s\) still block the variance analysis$/, (_a, n) => `차이 분석에 필요한 설정 ${n}개 미완료`],
    [/^Single Items & Recipes \((\d+)\)$/, (_a, n) => `단품·레시피 (${n})`],
    [/^Courses & Sets \((\d+)\)$/, (_a, n) => `코스·세트 (${n})`],
    [/^(\d+) ingredients configured$/, (_a, n) => `재료 ${n}개 설정됨`],
    [/^(\d+) component menu\(s\)$/, (_a, n) => `구성 메뉴 ${n}개`],
    [/^Edit Item: (.+)$/, (_a, name) => `메뉴 수정: ${OWNER_TEXT[name]?.ko ?? name}`],
    [/^Edit Set Menu: (.+)$/, (_a, name) => `코스·세트 수정: ${OWNER_TEXT[name]?.ko ?? name}`],
    [/^(\d+)\/(\d+) ingredient counts complete$/, (_a, a, b) => `재료 재고 조사 ${a}/${b} 완료`],
    [/^Delete (.+) purchase$/, (_a, value) => `매입 삭제: ${value}`],
    [/^Preview photo: (.+)$/, (_a, name) => `사진 보기: ${name}`],
    [/^Preview image: (.+)$/, (_a, name) => `이미지 보기: ${name}`],
    [/^Edit (.+)$/, (_a, name) => `${name} 수정`],
    [/^Delete (.+)$/, (_a, name) => `${name} 삭제`],
    [/^(.+) opening inventory$/, (_a, name) => `${name} 월초 재고`],
    [/^(.+) waste quantity$/, (_a, name) => `${name} 폐기 수량`],
    [/^(.+) inventory adjustment$/, (_a, name) => `${name} 재고 조정`],
    [/^(.+) closing inventory$/, (_a, name) => `${name} 월말 재고`],
    [/^(\d+) days missing$/, (_a, n) => `${n}일 미제출`],
    [/^(\d+) missing$/, (_a, n) => `${n}개 누락`],
    [/^(\d+)\/(\d+) due reports complete$/, (_a, a, b) => `필요 보고 ${a}/${b} 완료`],
    [/^(\d+)\/(\d+) recipes$/, (_a, a, b) => `레시피 ${a}/${b}`],
    [/^(\d+) single items · (\d+) courses\/sets$/, (_a, a, b) => `단품 ${a} · 코스/세트 ${b}`],
    [/^(\d+) staff$/, (_a, n) => `직원 ${n}명`],
    [/^(\d+) purchase units$/, (_a, n) => `구매단위 ${n}개`],
    [/^Show all (\d+) reports$/, (_a, n) => `보고 ${n}건 모두 보기`],
    [/^\+(\d+) more$/, (_a, n) => `${n}일 더 보기`],
    [/^(\d+) recipes ready$/, (_a, n) => `레시피 ${n}개 완료`],
    [/^(\d+) staff records$/, (_a, n) => `직원 정보 ${n}명`],
    [/^([\d.]+)% vs Last Month$/, (_a, n) => `전월 대비 ${n}%`],
    [/^Total Daily Revenue \((.+)\)$/, (_a, c) => `일 매출 합계(${c})`],
    [/^Decrease (.+)$/, (_a, name) => `${name} 감소`],
    [/^Increase (.+)$/, (_a, name) => `${name} 증가`],
    [/^Step (\d+[A-Z]?)\. (.+)$/, (_a, step, label) => `${step}단계: ${OWNER_TEXT[label]?.ko ?? label}`],
    [/^(\d+)\. (.+)$/, (_a, step, label) => `${step}. ${OWNER_TEXT[label]?.ko ?? label}`],
    [/^(\d+) menu item\(s\)$/, (_a, n) => `구성 메뉴 ${n}개`],
    [/^(.+) direct quantity$/, (_a, name) => `${name} 단품 수량`],
    [/^(\d+)\/(\d+) counts complete$/, (_a, a, b) => `재고 조사 ${a}/${b} 완료`],
    [/^(\d+) item\(s\) need ingredients$/, (_a, n) => `${n}개 메뉴 재료 설정 필요`],
    [/^(\d+) need components$/, (_a, n) => `${n}개 코스 구성 필요`],
  ],
};

const DYNAMIC_JA: Array<[RegExp, (...m: string[]) => string]> = [
  [/^Actual cost rate (.+); target (.+); recipe (.+)$/, (_a, actual, target, recipe) => `実際原価率 ${actual === 'not available' ? '未確定' : actual.replace(' percent', '%')}、目標 ${target === 'not set' ? '未設定' : target.replace(' percent', '%')}、レシピ ${recipe === 'not available' ? '未確定' : recipe.replace(' percent', '%')}`],
  [/^Single Items & Recipes \((\d+)\)$/, (_a, n) => `単品・レシピ（${n}）`],
  [/^Courses & Sets \((\d+)\)$/, (_a, n) => `コース・セット（${n}）`],
  [/^(\d+) ingredients configured$/, (_a, n) => `食材 ${n}件登録済み`],
  [/^(\d+) component menu\(s\)$/, (_a, n) => `構成メニュー ${n}件`],
  [/^Edit Item: (.+)$/, (_a, name) => `メニューを編集：${OWNER_JA[name] ?? name}`],
  [/^Edit Set Menu: (.+)$/, (_a, name) => `コース・セットを編集：${OWNER_JA[name] ?? name}`],
  [/^(\d+)\/(\d+) ingredient counts complete$/, (_a, a, b) => `食材棚卸 ${a}/${b}完了`],
  [/^Delete (.+) purchase$/, (_a, value) => `仕入を削除：${value}`],
  [/^Preview photo: (.+)$/, (_a, name) => `${name}の写真を表示`],
  [/^(.+) opening inventory$/, (_a, name) => `${name}の月初在庫`],
  [/^(.+) waste quantity$/, (_a, name) => `${name}の廃棄数量`],
  [/^(.+) inventory adjustment$/, (_a, name) => `${name}の在庫調整`],
  [/^(.+) closing inventory$/, (_a, name) => `${name}の月末在庫`],
  [/^(\d+) missing$/, (_a, n) => `未完了 ${n}件`],
  [/^(\d+)\/(\d+) due reports complete$/, (_a, a, b) => `必要な報告 ${a}/${b} 完了`],
  [/^(\d+)\/(\d+) recipes$/, (_a, a, b) => `レシピ ${a}/${b}`],
  [/^(\d+) single items · (\d+) courses\/sets$/, (_a, a, b) => `単品 ${a}件・コース／セット ${b}件`],
  [/^(\d+) staff$/, (_a, n) => `スタッフ ${n}名`],
  [/^(\d+) purchase units$/, (_a, n) => `購入単位 ${n}件`],
  [/^Show all (\d+) reports$/, (_a, n) => `全${n}件を表示`],
  [/^\+(\d+) more$/, (_a, n) => `ほか${n}日`],
  [/^(\d+) recipes ready$/, (_a, n) => `レシピ ${n}件完了`],
  [/^(\d+) staff records$/, (_a, n) => `スタッフ ${n}名登録`],
  [/^([\d.]+)% vs Last Month$/, (_a, n) => `前月比 ${n}%`],
  [/^Total Daily Revenue \((.+)\)$/, (_a, currency) => `1日の売上合計（${currency}）`],
  [/^Decrease (.+)$/, (_a, name) => `${name}を減らす`],
  [/^Increase (.+)$/, (_a, name) => `${name}を増やす`],
  [/^(\d+) menu item\(s\)$/, (_a, n) => `構成メニュー ${n}件`],
  [/^(\d+) daily report\(s\) still missing$/, (_a, n) => `日次報告があと${n}日分未提出です`],
  [/^Step (\d+[A-Z]?)\. (.+)$/, (_a, step, label) => `ステップ${step}：${OWNER_JA[label] ?? translateJapaneseUiText(label)}`],
  [/^(\d+)\. (.+)$/, (_a, step, label) => `${step}．${OWNER_JA[label] ?? translateJapaneseUiText(label)}`],
  [/^Enter (\d{4}-\d{2}-\d{2})$/, (_a, date) => `${date}を入力`],
  [/^Add receipt (\d{4}-\d{2}-\d{2})$/, (_a, date) => `${date}のレシートを追加`],
  [/^(\d+) required total\(s\) still blank\. A partial draft can still be saved\.$/, (_a, n) => `必須の月間合計があと${n}項目未入力です。途中の下書きは保存できます。`],
  [/^(\d+) item\(s\) need ingredients$/, (_a, n) => `${n}件のメニューに食材登録が必要です`],
  [/^(\d+) ingredients configured$/, (_a, n) => `食材 ${n}件登録済み`],
  [/^Edit (.+)$/, (_a, name) => `${name}を修正`],
  [/^Delete (.+)$/, (_a, name) => `${name}を削除`],
  [/^Preview image: (.+)$/, (_a, name) => `${name}の画像を表示`],
  [/^(.+) direct quantity$/, (_a, name) => `${name}の単品数量`],
  [/^(\d+)\/(\d+) counts complete$/, (_a, a, b) => `棚卸 ${a}/${b}完了`],
];

function translateMonthlyDynamic(value: string, locale: Exclude<OwnerLocale, 'en'>): string | null {
  let match = value.match(/^(\d+) daily report\(s\) still missing$/);
  if (match) {
    const count = match[1];
    if (locale === 'ja') return `日次報告があと${count}日分未提出です`;
    if (locale === 'zh-CN') return `还有${count}天的每日报告未提交`;
    if (locale === 'zh-TW') return `還有${count}天的每日報告未提交`;
    if (locale === 'vi') return `Còn thiếu báo cáo của ${count} ngày`;
    return `일일 보고 ${count}일분이 미제출입니다`;
  }

  match = value.match(/^(\d+) business day\(s\) · (\d+) closed day\(s\)$/);
  if (match) {
    const [, businessDays, closedDays] = match;
    if (locale === 'ja') return `営業日 ${businessDays}日・休業日 ${closedDays}日`;
    if (locale === 'zh-CN') return `营业日 ${businessDays}天 · 休业日 ${closedDays}天`;
    if (locale === 'zh-TW') return `營業日 ${businessDays}天 · 休業日 ${closedDays}天`;
    if (locale === 'vi') return `${businessDays} ngày mở cửa · ${closedDays} ngày nghỉ`;
    return `영업일 ${businessDays}일 · 휴점일 ${closedDays}일`;
  }

  match = value.match(/^(\d+) date\(s\) still need a sales or closed-day report\.$/);
  if (match) {
    const count = match[1];
    if (locale === 'ja') return `${count}日分の売上または休業報告が必要です。`;
    if (locale === 'zh-CN') return `还有${count}天需要填写销售或休业报告。`;
    if (locale === 'zh-TW') return `還有${count}天需要填寫營業或休業報告。`;
    if (locale === 'vi') return `Còn ${count} ngày cần báo cáo doanh thu hoặc ngày nghỉ.`;
    return `${count}일분의 매출 또는 휴점 보고가 필요합니다.`;
  }

  match = value.match(/^(\d+) open-day report\(s\) need a receipt image\.$/);
  if (match) {
    const count = match[1];
    if (locale === 'ja') return `${count}件の営業日報告にレシート画像が必要です。`;
    if (locale === 'zh-CN') return `${count}份营业日报告需要上传收据图片。`;
    if (locale === 'zh-TW') return `${count}份營業日報告需要上傳收據圖片。`;
    if (locale === 'vi') return `${count} báo cáo ngày mở cửa cần ảnh hóa đơn.`;
    return `영업일 보고 ${count}건에 영수증 이미지가 필요합니다.`;
  }

  match = value.match(/^(\d+)\/(\d+) required$/);
  if (match) {
    const [, completed, total] = match;
    if (locale === 'ja') return `必須 ${completed}/${total}`;
    if (locale === 'zh-CN') return `必填 ${completed}/${total}`;
    if (locale === 'zh-TW') return `必填 ${completed}/${total}`;
    if (locale === 'vi') return `Bắt buộc ${completed}/${total}`;
    return `필수 ${completed}/${total}`;
  }

  match = value.match(/^(\d+) required total\(s\) still blank\. A partial draft can still be saved\.$/);
  if (match) {
    const count = match[1];
    if (locale === 'ja') return `必須の月間合計があと${count}項目未入力です。途中の下書きは保存できます。`;
    if (locale === 'zh-CN') return `还有${count}个必填月度合计未输入，可先保存草稿。`;
    if (locale === 'zh-TW') return `還有${count}個必填月度合計未輸入，可先儲存草稿。`;
    if (locale === 'vi') return `Còn ${count} tổng tháng bắt buộc chưa nhập. Vẫn có thể lưu nháp.`;
    return `필수 월 합계 ${count}개가 미입력입니다. 임시 저장은 가능합니다.`;
  }

  match = value.match(/^Optional: blank uses the HQ default rate \(([\d.]+)%\)$/);
  if (match) {
    const rate = match[1];
    if (locale === 'ja') return `任意：空欄の場合は本部初期値（${rate}%）を使用`;
    if (locale === 'zh-CN') return `选填：空白时使用总部默认值（${rate}%）`;
    if (locale === 'zh-TW') return `選填：空白時使用本部預設值（${rate}%）`;
    if (locale === 'vi') return `Không bắt buộc: để trống sẽ dùng mức mặc định của trụ sở (${rate}%)`;
    return `선택: 빈칸이면 본사 기본값(${rate}%)을 사용합니다`;
  }

  match = value.match(/^Showing (\d+) of (\d+)$/);
  if (match) {
    const [, shown, total] = match;
    if (locale === 'ja') return `${shown}/${total}件を表示`;
    if (locale === 'zh-CN') return `显示 ${shown}/${total}`;
    if (locale === 'zh-TW') return `顯示 ${shown}/${total}`;
    if (locale === 'vi') return `Hiện ${shown}/${total}`;
    return `${shown}/${total}개 표시`;
  }

  return null;
}

function translateCore(value: string, locale: OwnerLocale): string {
  if (locale === 'en') return value;
  if (locale === 'ja') {
    if (OWNER_JA[value]) return OWNER_JA[value];
    const monthlyDynamic = translateMonthlyDynamic(value, locale);
    if (monthlyDynamic) return monthlyDynamic;
    for (const [pattern, replacer] of DYNAMIC_JA) {
      const match = value.match(pattern);
      if (match) return replacer(...match);
    }
    return translateJapaneseUiText(value);
  }
  const exact = OWNER_TEXT[value]?.[locale];
  if (exact) return exact;
  const monthlyDynamic = translateMonthlyDynamic(value, locale);
  if (monthlyDynamic) return monthlyDynamic;
  for (const [pattern, replacer] of DYNAMIC[locale]) {
    const match = value.match(pattern);
    if (match) return replacer(...match);
  }
  return value;
}

type TranslationState = {
  originalText: WeakMap<Text, string>;
  translatedText: WeakMap<Text, string>;
  originalAttributes: WeakMap<HTMLElement, Map<string, string>>;
  translatedAttributes: WeakMap<HTMLElement, Map<string, string>>;
};

const ATTRIBUTES = ['placeholder', 'title', 'aria-label'] as const;

function shouldSkip(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as HTMLElement
    : node.parentElement;
  return Boolean(element?.closest('[data-owner-i18n-skip="true"], script, style'));
}

function walkTextNodes(root: Node, callback: (node: Text) => void): void {
  if (root.nodeType === Node.TEXT_NODE) {
    if (!shouldSkip(root)) callback(root as Text);
    return;
  }
  if (shouldSkip(root)) return;
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => shouldSkip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  if (!walker) return;
  let current = walker.nextNode();
  while (current) {
    callback(current as Text);
    current = walker.nextNode();
  }
}

function translatedTextValue(value: string, locale: OwnerLocale): string {
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  const core = value.trim();
  if (!core) return value;
  const translated = translateCore(core, locale);
  return translated === core ? value : `${leading}${translated}${trailing}`;
}

function translateText(node: Text, locale: OwnerLocale, state: TranslationState): void {
  const current = node.nodeValue ?? '';
  const lastTranslated = state.translatedText.get(node);
  if (!state.originalText.has(node) || current !== lastTranslated) state.originalText.set(node, current);
  const original = state.originalText.get(node) ?? current;
  const translated = translatedTextValue(original, locale);
  state.translatedText.set(node, translated);
  if (current !== translated) node.nodeValue = translated;
}

function translateElement(element: HTMLElement, locale: OwnerLocale, state: TranslationState): void {
  if (shouldSkip(element)) return;
  ATTRIBUTES.forEach((attribute) => {
    const current = element.getAttribute(attribute);
    if (current === null) return;
    const originals = state.originalAttributes.get(element) ?? new Map<string, string>();
    const translatedValues = state.translatedAttributes.get(element) ?? new Map<string, string>();
    const lastTranslated = translatedValues.get(attribute);
    if (!originals.has(attribute) || current !== lastTranslated) originals.set(attribute, current);
    const original = originals.get(attribute) ?? current;
    const translated = translateCore(original.trim(), locale);
    originals.set(attribute, original);
    translatedValues.set(attribute, translated);
    state.originalAttributes.set(element, originals);
    state.translatedAttributes.set(element, translatedValues);
    if (current !== translated) element.setAttribute(attribute, translated);
  });
}

function translateTree(root: Node, locale: OwnerLocale, state: TranslationState): void {
  if (shouldSkip(root)) return;
  walkTextNodes(root, (node) => translateText(node, locale, state));
  if (root instanceof HTMLElement) {
    translateElement(root, locale, state);
    root.querySelectorAll<HTMLElement>('[placeholder], [title], [aria-label]')
      .forEach((element) => translateElement(element, locale, state));
  }
}

function restoreTree(root: HTMLElement, state: TranslationState): void {
  walkTextNodes(root, (node) => {
    const original = state.originalText.get(node);
    if (original !== undefined && node.nodeValue !== original) node.nodeValue = original;
    state.translatedText.delete(node);
  });
  [root, ...Array.from(root.querySelectorAll<HTMLElement>('[placeholder], [title], [aria-label]'))]
    .forEach((element) => {
      const originals = state.originalAttributes.get(element);
      if (!originals) return;
      originals.forEach((value, attribute) => element.setAttribute(attribute, value));
      state.translatedAttributes.delete(element);
    });
}

export const OwnerLanguageBoundary: React.FC<React.PropsWithChildren<{ locale: OwnerLocale }>> = ({
  locale,
  children,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<TranslationState>({
    originalText: new WeakMap<Text, string>(),
    translatedText: new WeakMap<Text, string>(),
    originalAttributes: new WeakMap<HTMLElement, Map<string, string>>(),
    translatedAttributes: new WeakMap<HTMLElement, Map<string, string>>(),
  });

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const state = stateRef.current;
    restoreTree(root, state);
    if (locale === 'en') return undefined;
    translateTree(root, locale, state);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'characterData') {
          if (!shouldSkip(mutation.target)) translateText(mutation.target as Text, locale, state);
          return;
        }
        if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
          translateElement(mutation.target, locale, state);
          return;
        }
        mutation.addedNodes.forEach((node) => translateTree(node, locale, state));
      });
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTES],
    });
    return () => observer.disconnect();
  }, [locale]);

  return <div ref={rootRef} lang={locale} className="contents">{children}</div>;
};

export const OwnerLanguageSwitch: React.FC<{
  locale: OwnerLocale;
  onChange: (locale: OwnerLocale) => void;
}> = ({ locale, onChange }) => (
  <label className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-2 shadow-sm">
    <span className="sr-only">Display language</span>
    <select
      value={locale}
      onChange={(event) => onChange(event.target.value as OwnerLocale)}
      aria-label="Display language"
      className="min-h-11 max-w-[8.75rem] bg-transparent px-1 text-xs font-extrabold text-gray-800 outline-none sm:max-w-none"
    >
      {OWNER_LOCALE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  </label>
);
