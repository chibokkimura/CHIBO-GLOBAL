import React, { useLayoutEffect, useRef } from 'react';

export type HQLocale = 'ja' | 'en';

export const HQ_LANGUAGE_STORAGE_KEY = 'chibo:hq:language';

const EXACT_JA: Record<string, string> = {
  'CHIBO HEADQUARTERS': '千房 本部',
  'Global Admin Console': '海外店舗 管理システム',
  'Global Settings': '全体設定',
  'Global Configuration': '全体設定',
  'Store Setup': '店舗設定',
  Locations: '国・都市',
  Finance: '財務設定',
  Operations: '運営設定',
  'Menu Config': 'メニュー設定',
  'Pre-approved Store Names': '登録可能な店舗名',
  'List of store names available for new franchise registrations.': '新規登録時に選択できる店舗名を管理します。',
  'Allowed Countries': '登録可能な国',
  'Countries where franchise operation is authorized.': 'フランチャイズ運営を許可する国を管理します。',
  'Available Cities': '登録可能な都市',
  'Cities available for selection during onboarding.': '店舗登録時に選択できる都市を管理します。',
  'Supported Currencies': '対応通貨',
  'Currencies available for store reporting and invoices.': '店舗報告と請求書で使用できる通貨を管理します。',
  'Staff Positions': '役職',
  'Positions available in staff management.': 'スタッフ管理で選択できる役職を管理します。',
  'Menu Categories': 'メニューカテゴリー',
  'Categories available for menu registration.': 'メニュー登録で選択できるカテゴリーを管理します。',
  'Standard Ingredients': '標準食材',
  'Manage standard ingredients (Name, Unit, Stock, Reorder threshold).': '標準食材の名称・単位・基準在庫・発注点を管理します。',
  Name: '名称',
  Unit: '単位',
  Stock: '基準在庫',
  Reorder: '発注点',
  Add: '追加',
  Remove: '削除',
  Save: '保存',
  'Saving...': '保存中…',
  Cancel: 'キャンセル',
  Close: '閉じる',
  Done: '完了',
  Select: '選択',
  Search: '検索',
  Refresh: '更新',
  'Refreshing...': '更新中…',
  'Load more': 'さらに読み込む',
  'Sign out': 'ログアウト',
  'Open global settings': '全体設定を開く',
  'Close global settings': '全体設定を閉じる',
  'Network summary': '全体サマリー',
  'DEMO PREVIEW · Sample numbers only · Never use this screen to verify operating data': 'デモ画面・数値はサンプルです・運用データの確認には使用しないでください',
  'MANAGEMENT PATH': '確認手順',
  'Management path': '確認手順',
  'Country → Store → Month': '国 → 店舗 → 月',
  'Choose a country and reporting month before opening a store.': '国と対象月を選択してから店舗を開いてください。',
  'Scroll sideways to view every country →': '横にスクロールするとすべての国を確認できます →',
  'Store review': '店舗確認',
  'Choose month and country': '対象月と国を選択',
  'Review stores by month': '対象月の店舗状況を確認',
  'Select a month, then choose a country. The matching stores appear below.': '対象月を選び、次に国を選択してください。該当する店舗が下に表示されます。',
  '1. Select month': '1. 対象月を選択',
  '2. Select country': '2. 国を選択',
  'Network overview': '全体を見る',
  s: '',
  sales: 'の売上',
  'Open only when you need sales, royalty and setup totals.': '売上・ロイヤルティ・設定状況の合計が必要な場合に開いてください。',
  'Total Network Sales': '全店舗売上',
  'Active Franchises': '対象店舗数',
  'Royalty Revenue': 'ロイヤルティ収入',
  'Inventory Alerts': '在庫アラート',
  'Reporting month': '対象月',
  'All countries': 'すべての国',
  'Selected month': '対象月',
  'Stores in view': '表示店舗数',
  'No sales reported': '売上報告なし',
  China: '中国',
  Others: 'その他',
  Philippines: 'フィリピン',
  'South Korea': '韓国',
  Taiwan: '台湾',
  Vietnam: 'ベトナム',
  'Country performance': '国別実績',
  'Country Performance': '国別実績',
  'Financial Performance': '店舗別売上実績',
  Store: '店舗',
  Country: '国',
  City: '都市',
  Currency: '通貨',
  Revenue: '売上',
  'Revenue (Local)': '売上（現地通貨）',
  'Revenue (JPY Est.)': '売上（円換算・推定）',
  'Royalty (JPY Est.)': 'ロイヤルティ（円換算・推定）',
  Health: '状態',
  Good: '良好',
  GOOD: '良好',
  Warning: '要確認',
  Urgent: '至急確認',
  Missing: '未入力',
  Complete: '完了',
  Incomplete: '未完了',
  Ready: '準備完了',
  'Not ready': '未準備',
  'Reports complete': '報告完了',
  'Export Excel': 'Excel出力',
  'Sales reporting detail & Excel': '売上報告の詳細・Excel出力',
  'Supply chain setup': '在庫基準設定',
  'Data management': 'データ管理',
  Test: 'テスト',
  Held: '保留',
  'Approval waiting': '承認待ち',
  'Test workspaces': 'テスト環境',
  'Held records': '保留データ',
  'Accounts waiting for HQ approval': '本部承認待ちのアカウント',
  'An unlinked owner cannot choose a store themselves. Select the correct operating store here and approve it.': '未連携のオーナーは自分で店舗を選択できません。ここで正しい運営店舗を選び、承認してください。',
  'Owner account connections': 'オーナーアカウント連携',
  'Connect, move, or unlink an owner account here. Unlinking never deletes the account or its data.': 'ここでオーナーアカウントの連携・店舗変更・連携解除ができます。解除してもアカウントやデータは削除されません。',
  'Search name, email, or store': '氏名・メール・店舗を検索',
  'Unlinked / approval waiting': '未連携・承認待ち',
  'Operating stores': '運営店舗',
  'Apply connection': '連携を反映',
  'Applying…': '反映中…',
  'No owner accounts found.': 'オーナーアカウントはありません。',
  'No matching owner accounts.': '該当するオーナーアカウントはありません。',
  'Updated:': '更新完了：',
  'Select operating store': '運営店舗を選択',
  'Approve and link': '承認して連携',
  'Approving…': '承認中…',
  'Open record': 'データを開く',
  'Archive and remove': '保管して削除',
  'Removing…': '削除中…',
  'Remove Non-operating Store': '非運営店舗を削除',
  'Only test or held stores can be removed. A recovery snapshot is saved before all related data is deleted.': 'テスト店舗または保留データのみ削除できます。関連データを削除する前に復旧用スナップショットを保存します。',
  'Archive and Remove Store': '保管して店舗を削除',
  'Linked:': '連携完了：',
  'Excluded from operating results.': '運用実績の集計対象外です。',
  'Preserved for review but excluded from HQ totals.': '確認用に保存されていますが、本部集計から除外されています。',
  'Open test cost analysis': 'テスト原価分析を開く',
  'PB Stock Setup Gaps': '在庫基準の未設定',
  'Separate from profitability readiness': '収益分析の準備状況とは別項目です',
  'Franchise Network': '店舗一覧',
  'View Details': '詳細を見る',
  'First actions for HQ': '本部が最初に確認する項目',
  'HQ PROFITABILITY REVIEW': '本部 収益性確認',
  'HQ profitability review': '本部 収益性確認',
  'What should each store improve?': '各店舗が改善すべき点',
  'local currency for store action, JPY estimate for network comparison': '店舗改善は現地通貨、全体比較は円換算（推定）で表示',
  '· local currency for store action, JPY estimate for network comparison': '・店舗改善は現地通貨、全体比較は円換算（推定）で表示',
  'ANALYSIS READY': '分析可能',
  'Analysis ready': '分析可能',
  'Only completed months receive a final margin': '完了した月のみ最終利益率を表示します',
  'Selected stores with available FX': '為替換算可能な選択店舗',
  'MANAGEMENT PROFIT': '管理利益',
  'Management profit': '管理利益',
  'Ready stores only; not statutory profit': '分析可能な店舗のみ・法定会計上の利益ではありません',
  'TARGET BREACHES': '目標未達',
  'Target breaches': '目標未達',
  'Completed stores needing action': '改善対応が必要な完了店舗',
  'Highest-impact exception or missing step first.': '影響の大きい問題または未完了手順から表示します。',
  'Reduce food-cost variance': '原価差異を改善',
  '4.8 pt above target. Check purchasing price, stock count, waste and recipe usage.': '目標を4.8ポイント上回っています。仕入単価、棚卸、廃棄、レシピ使用量を確認してください。',
  'Complete monthly data': '月次データを完成',
  'Missing: Sales, HQ settings, Monthly totals, Inventory close': '未完了：売上、本部設定、月次合計、棚卸締め',
  'Management margin vs store target': '管理利益率と店舗目標の比較',
  'Open the graph for': 'グラフを開く：',
  'analysis-ready stores.': '分析可能店舗',
  'analysis-ready store.': '分析可能店舗',
  'analysis-ready store': '分析可能店舗',
  'Open the full store-by-store figures only when needed.': '必要な場合のみ全店舗の詳細数値を開いてください。',
  'Management view only · incomplete months are never treated as zero profit': '経営管理用・未完了の月を利益ゼロとして扱いません',
  'Open the store-by-store local currency, JPY and royalty table when needed.': '必要な場合に店舗別の現地通貨・円換算・ロイヤルティ表を開いてください。',
  'Next: choose a store': '次に店舗を選択',
  'Select store': '店舗を選択',
  'NEXT: CHOOSE A STORE': '次に店舗を選択',
  'All Stores': 'すべての店舗',
  'Open monthly detail': '月次詳細を開く',
  'Open PB item stock coverage and setup gaps.': 'PB商品の在庫基準と未設定項目を確認します。',
  'Open monthly close': '月次締めを開く',
  'Open cost & inventory': '原価・在庫を開く',
  'Open Month Close': '月次締めを開く',
  'Open Cost & Inventory': '原価・在庫を開く',
  'Open Menu & Recipes': 'メニュー・レシピを開く',
  'All store results': '全店舗の結果',
  'Monthly comparison chart': '月次比較グラフ',
  'Profitability Review': '収益性分析',
  'Monthly Profitability': '月次収益性',
  'Management Profit': '管理利益',
  'Management Margin': '管理利益率',
  'Net Sales': '純売上',
  'Actual Cost': '実際原価',
  'Actual Food Cost': '実際原価',
  'Actual Food Cost %': '実際原価率',
  'Theoretical Cost': '理論原価',
  'Theoretical Food Cost': '理論原価',
  'Theoretical Food Cost %': '理論原価率',
  'Cost Variance': '原価差異',
  'Food Cost %': '原価率',
  'Labor Cost': '人件費',
  'Labor Cost %': '人件費率',
  'Prime Cost': '主要コスト',
  'Prime Cost %': '主要コスト率',
  'Guest Count': '客数',
  'Labor Hours': '総労働時間',
  'Sales per Guest': '客単価',
  'Sales per Labor Hour': '労働1時間当たり売上',
  'Sales-linked Fees': '売上連動手数料',
  Utilities: '水道光熱費',
  'Other Operating Cost': 'その他運営費',
  'Occupancy Cost': '賃料・共益費',
  Royalty: 'ロイヤルティ',
  Target: '目標',
  Variance: '差異',
  'Setup incomplete': '初期設定未完了',
  'Monthly input missing': '月次入力なし',
  'Inventory incomplete': '棚卸未完了',
  'Profitability ready': '収益分析可能',
  'Back to Dashboard': 'ダッシュボードに戻る',
  store: '店舗',
  stores: '店舗',
  'report days missing': '日分の日次報告が未提出',
  'Owner:': 'オーナー：',
  '• Owner:': '・オーナー：',
  'Linked Accounts:': '連携アカウント：',
  Owner: 'オーナー',
  'Linked Accounts': '連携アカウント',
  'Account information': 'アカウント情報',
  'Store settings': '店舗設定',
  'Royalty (%)': 'ロイヤルティ率',
  'Linked Accounts: —': '連携アカウント：なし',
  'Royalty Rate (%)': 'ロイヤルティ率（%）',
  'Test workspace': 'テスト環境',
  'Cost-analysis sample data is ready': '原価分析のサンプルデータを確認できます',
  'Open Cost & Inventory to review actual cost, theoretical recipe cost, stock counts, and ingredient variances together.': '「原価・在庫」で実際原価、理論原価、棚卸、食材差異をまとめて確認できます。',
  'Sample month': 'サンプル対象月',
  Sales: '売上',
  'Daily reports': '日次報告',
  'Menu setup': 'メニュー設定',
  'Month Close': '月次締め',
  'Cost & Inventory': '原価・在庫',
  Invoice: '請求書',
  Menu: 'メニュー',
  Staff: 'スタッフ',
  Accounts: 'アカウント',
  'Invoice Generator': '請求書作成',
  'Auto-calculated from owner submitted monthly sales.': 'オーナーが提出した月間売上から自動計算します。',
  'Generate Invoice PDF': '請求書PDFを作成',
  'Refreshing FX...': '為替を更新中…',
  'Royalty Amount': 'ロイヤルティ金額',
  'Remittance Amount': '送金額',
  'Taxable Amount': '課税対象額',
  'Income Tax': '所得税',
  'Withholding Tax': '源泉税',
  'Missing Daily Reports': '日次報告の未提出',
  'Reporting Compliance': '日次報告の提出状況',
  'The following dates are missing:': '次の日付が未提出です：',
  'View Older Dates': '過去の日付を見る',
  'Tip: Click a date to choose recipients and open an email draft.': '日付を押すと宛先を選択して督促メールを作成できます。',
  'All daily reports for the last 7 days have been submitted.': '直近7日分の日次報告はすべて提出済みです。',
  'Send email reminder': '督促メールを作成',
  'Store Performance': '店舗実績',
  'Monthly Sales': '月間売上',
  Month: '月間',
  '7 Days': '7日間',
  YoY: '前年比',
  'Weekly Sales (Last 7 Days)': '直近7日間の売上',
  'YoY (This Month)': '前年同月比',
  'No sales data for the last 12 months': '直近12か月の売上データがありません',
  'No baseline data': '比較データなし',
  vs: '比較',
  Showing: '表示中：',
  data: 'データ',
  Jan: '1月',
  Feb: '2月',
  Mar: '3月',
  Apr: '4月',
  May: '5月',
  Jun: '6月',
  Jul: '7月',
  Aug: '8月',
  Sep: '9月',
  Oct: '10月',
  Nov: '11月',
  Dec: '12月',
  'Sales History': '売上履歴',
  'All Months': 'すべての月',
  Date: '日付',
  'Total Sales': '売上合計',
  Status: '状態',
  Items: '明細',
  Receipt: 'レシート',
  Closed: '休業',
  Open: '営業',
  Hide: '閉じる',
  View: '表示',
  Edit: '修正',
  Delete: '削除',
  'No receipt': 'レシートなし',
  'View receipt': 'レシートを見る',
  'No Image': '画像なし',
  'View Receipt': 'レシートを見る',
  'Loading...': '読込中…',
  'Sales Reporting Completeness': '売上報告の完了状況',
  'HQ STORE REVIEW': '本部 店舗月次確認',
  'HQ store review': '本部 店舗月次確認',
  'Monthly Performance Review': '月次実績確認',
  'Review sales reporting completeness and the store submission before approval.': '承認前に売上報告の完了状況と店舗提出内容を確認します。',
  'REPORTED SALES': '報告売上',
  'Reported sales': '報告済み売上',
  'Through the latest completed day': '直近の完了日まで',
  'RECEIPT IMAGES': 'レシート画像',
  'Attached to open-day reports': '営業日の報告に添付',
  'REVIEW STATUS': '確認状態',
  'Review status': '確認状態',
  'Waiting for completion': '入力完了待ち',
  'This store is not ready for approval': 'この店舗はまだ承認できません',
  'Monthly labor and operating totals are incomplete': '月間人件費・運営費が未入力です',
  'Month-end inventory close is incomplete': '月末棚卸が未完了です',
  'Monthly sales total has not been confirmed': '月間売上合計が未確認です',
  'These checks come directly from the daily reports already stored in the system.': 'システムに保存済みの日次報告から直接確認しています。',
  'Action needed': '対応が必要',
  'Receipt images': 'レシート画像',
  'HQ Store Profit Settings': '本部 店舗収益設定',
  'Fixed tax, rent, fee and target settings': '税・賃料・手数料・目標の固定設定',
  Configured: '設定済み',
  'Monthly Profit Inputs': '月次収益入力',
  'Labor, hours, fees, utilities and other operating totals': '人件費・労働時間・手数料・水道光熱費・その他運営費',
  'Input needed': '入力が必要',
  'Monthly totals entered by the store. HQ reviews without changing them here.': '店舗が入力した月間合計です。本部はこの画面では変更せず確認します。',
  'Guest count': '客数',
  Optional: '任意',
  Required: '必須',
  'Use the POS guest total when available.': 'POSの客数合計を取得できる場合に入力します。',
  'Total labor hours': '総労働時間',
  'One total from the attendance system.': '勤怠システムの月間合計を入力します。',
  'Entry rule': '入力ルール',
  'Blank means not entered': '空欄は未入力として扱います',
  'Enter 0 only when the confirmed monthly amount is actually zero. This keeps missing data separate from zero cost.': '確認済みの月間金額が実際にゼロの場合のみ0を入力してください。未入力とゼロを区別します。',
  'Total labor cost': '総人件費',
  'One monthly total from payroll': '給与データの月間合計',
  'Optional · HQ default': '任意・本部初期値',
  'Optional: blank uses the HQ default rate (5%)': '任意：空欄の場合は本部初期値（5%）を使用',
  'Electricity, gas and water total': '電気・ガス・水道の合計',
  'Other operating costs': 'その他運営費',
  'Supplies, cleaning, repairs and marketing': '消耗品・清掃・修繕・販促費',
  'Monthly note': '月次メモ',
  'HQ reviews the totals entered by the store.': '本部が店舗入力の合計を確認します。',
  'File Import History': 'ファイル取込履歴',
  'File Import': 'ファイル取込',
  'Original file': '元ファイル',
  'Open only when a CSV/XLS/XLSX file is available': 'CSV・XLS・XLSXがある場合のみ開いてください',
  'Management view for improving store operations. This is not a statutory accounting statement.': '店舗運営改善のための管理資料です。法定会計書類ではありません。',
  'Monthly management profit is ready': '月次管理利益を確認できます',
  'Sales, actual food cost, labor, operating costs, fixed costs and royalty are included.': '売上・実際原価・人件費・運営費・固定費・ロイヤルティを含みます。',
  'Sales tax removed': '売上税を除外',
  'Actual inventory method': '実地棚卸方式',
  'Monthly amount breakdown': '月間金額内訳',
  'Food cost': '原価率',
  'Labor cost': '人件費率',
  'Management margin': '管理利益率',
  'Sales-linked fees': '売上連動手数料',
  'Monthly entered total': '店舗入力の月間合計',
  'Guest count not entered': '客数未入力',
  'Actual food cost': '実際原価',
  'HQ default rate': '本部初期値',
  'Rent + common area fee': '賃料・共益費',
  'Store management profit': '店舗管理利益',
  'Store productivity': '店舗生産性',
  'SALES / GUEST': '客単価',
  'SALES / LABOR HOUR': '労働1時間当たり売上',
  'Sales / guest': '客単価',
  'Sales / labor hour': '労働1時間当たり売上',
  'Target reading': '目標比較',
  Labor: '人件費',
  'Prime cost': '主要コスト',
  'Store Confirmation': '店舗確認',
  'This is confirmed by the store before submission. HQ reviews it without changing it.': '店舗が提出前に確認する項目です。本部は変更せず確認します。',
  Pending: '未完了',
  'Notes & Approval': 'メモ・承認',
  'Store note': '店舗メモ',
  'Enter ingredient purchase packs, monthly purchases, waste/adjustments, and opening and closing stock in Cost & Inventory. Once those counts are complete, the system calculates actual food cost and compares it with menu and course recipes, theoretical usage, and the ingredients that need investigation.': '「原価・在庫」で食材の購入単位、月間仕入、廃棄・調整、月初・月末在庫を入力します。棚卸完了後、実際原価を計算し、メニュー・コースのレシピ、理論使用量、確認が必要な食材と比較します。',
  'Monthly Close': '月次締め',
  Draft: '下書き',
  Submitted: '提出済み',
  Approved: '承認済み',
  Reopened: '再開',
  'Approve Month': '月次を承認',
  'Reopen Month': '月次を再開',
  'Submit Month': '月次を提出',
  'Save Notes': 'メモを保存',
  'Owner note': 'オーナーメモ',
  'HQ review note': '本部確認メモ',
  'Monthly sales confirmed': '月間売上確認済み',
  'I checked the monthly sales total and confirmed it is correct': '月間売上合計を確認し、正しいことを確認しました',
  'Review Inventory': '在庫を確認',
  'Continue in Cost & Inventory': '「原価・在庫」で続ける',
  'Enter ingredient purchase packs, monthly purchases, waste/adjustments, and opening and closing stock in Cost & Inventory.': '「原価・在庫」で食材の購入単位、月間仕入、廃棄・調整、月初・月末在庫を入力してください。',
  'Store Profitability Settings': '店舗収益設定',
  'Monthly Operating Inputs': '月次運営データ',
  'Import File': 'ファイル取込',
  'Upload CSV / XLS / XLSX': 'CSV・XLS・XLSXをアップロード',
  'Manual Entry': '手入力',
  'Apply Import': '取込を反映',
  'Step 3. Review Monthly Result': 'ステップ3：月次結果を確認',
  'Ingredient Cost Control': '食材原価管理',
  'HQ COST REVIEW': '本部 原価確認',
  'Cost, Purchases & Inventory': '原価・仕入・在庫',
  'Review the monthly result first, then inspect the inputs behind it.': '最初に月次結果を確認し、その後に計算元の入力を確認します。',
  Overview: '概要',
  'Ingredients & Purchases': '食材・仕入',
  'Inventory Close': '棚卸締め',
  'recorded units': '登録数量',
  'entered units': '入力数量',
  'PRODUCT SALES QUANTITIES': '商品販売数量',
  'Choose the source used for recipe-cost analysis': 'レシピ原価分析に使用する数量の参照元を選択',
  'This changes only menu and course quantities used for theoretical cost. It never changes the daily sales amount.': '理論原価に使用するメニュー・コース数量のみ変更します。日次売上金額は変更しません。',
  'SOURCE CONFIRMED': '参照元確認済み',
  'Use daily sales reports': '日次売上報告を使用',
  'For stores that enter menu and course quantities with each daily report.': '日次報告ごとにメニュー・コース数量を入力する店舗向けです。',
  'Enter monthly POS totals': '月間POS集計を入力',
  'For stores that have one month-end POS product report instead of daily item quantities.': '日次商品数量ではなく月末にPOS商品集計を取得する店舗向けです。',
  'Source note (optional)': '参照資料メモ（任意）',
  'Source note': '参照資料メモ',
  '(optional)': '（任意）',
  'NET SALES': '純売上',
  'Net sales': '純売上',
  'MONTHLY COST RESULT': '月次原価結果',
  'Formula: opening stock value + monthly purchases + inventory adjustments − closing stock value': '計算式：月初在庫金額＋月間仕入＋在庫調整－月末在庫金額',
  'IN PROGRESS': '入力途中',
  'Monthly Settings': '月次設定',
  'ACTUAL COST RATE': '実際原価率',
  'Provisional': '暫定',
  'Same daily-sales basis used by HQ': '本部と同じ日次売上基準',
  'RECIPE COST RATE': 'レシピ原価率',
  'Complete recipes and ingredient costs': 'レシピと食材原価を完成してください',
  'ACTUAL − RECIPE GAP': '実際原価－レシピ原価差',
  'Complete recipes, costs, and inventory': 'レシピ・原価・棚卸を完成してください',
  'Target rate': '目標原価率',
  'Opening stock': '月初在庫',
  Adjustments: '在庫調整',
  'Closing stock': '月末在庫',
  'Waste value': '廃棄金額',
  'Cost Control Position': '原価管理位置',
  'Final actual cost appears only after every inventory count is complete.': 'すべての棚卸が完了した後に最終実際原価を表示します。',
  Actual: '実際',
  Recipe: 'レシピ',
  'TO REACH TARGET': '目標達成に必要な対応',
  'Finish inventory first': '先に棚卸を完了してください',
  'ACTUAL VS RECIPE': '実際原価とレシピ原価',
  'Why Cost Changed': '原価変動の要因',
  'Separates supplier price changes, recorded waste, and the remaining usage difference from the recipe.': '仕入単価の変化、登録済み廃棄、レシピとの差となる使用量差異を分けて表示します。',
  'Complete inventory and recipe coverage to separate the causes.': '原因を分けるには棚卸とレシピ登録を完了してください。',
  'Excess Cost Drivers': '超過原価の主因',
  'Ingredients with the largest actual cost above recipe cost.': '実際原価がレシピ原価を最も上回る食材です。',
  'Complete inventory close': '棚卸締めを完了',
  'ingredient counts complete': '食材棚卸完了',
  'item(s) still block the variance analysis': '件の設定が差異分析に必要です',
  'View All Ingredient Usage Gaps': '全食材の使用量差異を見る',
  'Compare recipe usage with actual usage calculated from inventory.': 'レシピ使用量と棚卸から計算した実際使用量を比較します。',
  'Review recipe cost by menu using monthly sales quantities.': '月間販売数量を使用してメニュー別レシピ原価を確認します。',
  'Monthly Cost Review': '月次原価確認',
  Summary: 'サマリー',
  Purchases: '仕入',
  Inventory: '在庫',
  Ingredients: '食材',
  'Ingredient Setup': '食材設定',
  'Purchase History': '仕入履歴',
  'Opening Inventory': '月初在庫',
  'Closing Inventory': '月末在庫',
  'Opening Stock': '月初在庫',
  'Closing Stock': '月末在庫',
  'Purchase Unit': '購入単位',
  'Content Quantity': '内容量',
  'Pack Price': '購入価格',
  Supplier: '仕入先',
  Category: '分類',
  Quantity: '数量',
  'Purchase Date': '仕入日',
  'Total Cost': '合計金額',
  Notes: 'メモ',
  Waste: '廃棄',
  Adjustment: '調整',
  'Count complete': '棚卸完了',
  'Target food cost (%)': '目標原価率（%）',
  'Product sales quantity source': '商品販売数量の参照元',
  'Daily sales reports': '日次売上報告',
  'Monthly POS totals': '月間POS集計',
  'Confirmed against actual POS': '実際のPOS集計と照合済み',
  'POS source / checker note': 'POS資料名・確認者',
  'Menu & Course Profitability': 'メニュー・コース別収益性',
  'View Menu & Course Profitability': 'メニュー・コース別収益性を見る',
  'Menu Item': 'メニュー',
  Course: 'コース',
  'Selling Price': '販売価格',
  'Recipe Cost': 'レシピ原価',
  'Cost Rate': '原価率',
  'Sold Quantity': '販売数',
  'Theoretical Usage': '理論使用量',
  'Actual Usage': '実際使用量',
  'Usage Variance': '使用量差異',
  'Price Variance': '価格差異',
  'Ingredient Variance': '食材差異',
  'No data': 'データなし',
  'No data available': 'データがありません',
  'Not available': '利用できません',
  'English': 'English',
};

const DYNAMIC_JA: Array<[RegExp, (...matches: string[]) => string]> = [
  [/^Test (\d+) · Held (\d+) · Approval waiting (\d+)$/, (_all, test, held, pending) => `テスト ${test}件・保留 ${held}件・承認待ち ${pending}件`],
  [/^Linked: (.+)$/, (_all, value) => `連携完了：${value}`],
  [/^Test data (\d+) · Held records (\d+)\. Open only when maintenance is required\.$/, (_all, tests, held) => `テストデータ ${tests}件・保留データ ${held}件。メンテナンス時のみ開いてください。`],
  [/^(.+) ·$/, (_all, value) => `${translateCore(value)}・`],
  [/^All countries · (\d+) stores$/, (_all, count) => `すべての国・${count}店舗`],
  [/^(.+) · (\d+) stores?$/, (_all, country, count) => `${translateCore(country)}・${count}店舗`],
  [/^(\d+) report days missing$/, (_all, count) => `日次報告 未提出 ${count}日`],
  [/^(\d+) days missing$/, (_all, count) => `未提出 ${count}日`],
  [/^(.+) Stores$/, (_all, country) => `${translateCore(country)}の店舗`],
  [/^(\d+) daily report\(s\) missing$/, (_all, count) => `日次報告 未提出 ${count}日`],
  [/^(\d+) stores?$/, (_all, count) => `${count}店舗`],
  [/^(\d+) stores? · (.+)$/, (_all, count, value) => `${count}店舗・${translateCore(value)}`],
  [/^(\d+) stores? ·$/, (_all, count) => `${count}店舗・`],
  [/^(\d+) days$/, (_all, count) => `${count}日`],
  [/^(\d+) items?$/, (_all, count) => `${count}件`],
  [/^(\d+) course$/, (_all, count) => `${count}コース`],
  [/^(\d+) business day\(s\) · (\d+) closed day\(s\)$/, (_all, open, closed) => `営業日 ${open}日・休業日 ${closed}日`],
  [/^(\d+) date\(s\) still need a sales or closed-day report\.$/, (_all, count) => `売上または休業報告が必要な日が${count}日あります。`],
  [/^(\d+) open-day report\(s\) need a receipt image\.$/, (_all, count) => `営業日報告${count}件にレシート画像が必要です。`],
  [/^(\d+) open-day report\(s\) have no receipt image$/, (_all, count) => `営業日報告${count}件にレシート画像がありません`],
  [/^(\d+) daily sales report\(s\) are missing$/, (_all, count) => `日次売上報告が${count}日分未提出です`],
  [/^(\d+)\/(\d+) required$/, (_all, complete, total) => `必須入力 ${complete}/${total}`],
  [/^(\d+) recorded units$/, (_all, count) => `登録数量 ${count}`],
  [/^(\d+) entered units$/, (_all, count) => `入力数量 ${count}`],
  [/^(\d+) inventory count\(s\) still open$/, (_all, count) => `棚卸があと${count}件未完了です`],
  [/^Provisional (.+) · finish (\d+) count\(s\)$/, (_all, rate, count) => `暫定 ${rate}・棚卸あと${count}件`],
  [/^(\d+)\/(\d+) ingredient counts complete$/, (_all, complete, total) => `食材棚卸 ${complete}/${total}完了`],
  [/^(\d+) item\(s\) still block the variance analysis$/, (_all, count) => `差異分析にはあと${count}件の設定が必要です`],
  [/^Inventory Close (.+)$/, (_all, value) => `棚卸締め ${value}`],
  [/^Close (\d+\/\d+)$/, (_all, value) => `棚卸 ${value}`],
  [/^([\d,]+) guests$/, (_all, count) => `${count}名`],
  [/^Royalty \((.+)\)$/, (_all, rate) => `ロイヤルティ（${rate}）`],
  [/^(\d+) hours$/, (_all, count) => `${count}時間`],
  [/^(.+) pt above target$/, (_all, value) => `目標を${value}ポイント上回っています`],
  [/^Open the graph for (\d+) analysis-ready stores\.$/, (_all, count) => `分析可能な${count}店舗のグラフを開きます。`],
  [/^(.+) sales$/, (_all, value) => `${translateCore(value)}の売上`],
  [/^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})$/, (_all, month, year) => `${year}年${MONTH_NUMBER[month]}月`],
  [/^Showing (.+) data$/, (_all, value) => `${value}分のデータを表示`],
  [/^Owner: (.+)$/, (_all, value) => `オーナー：${value}`],
  [/^Linked Accounts: (.+)$/, (_all, value) => `連携アカウント：${value}`],
  [/^vs (.+)$/, (_all, value) => `比較：${value}`],
  [/^Step (\d+)\. (.+)$/, (_all, step, label) => `ステップ${step}：${EXACT_JA[label] ?? label}`],
  [/^(\d+)\. (.+)$/, (_all, step, label) => `${step}．${EXACT_JA[label] ?? label}`],
];

const MONTH_NUMBER: Record<string, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
};

function translateCore(value: string): string {
  if (Object.prototype.hasOwnProperty.call(EXACT_JA, value)) return EXACT_JA[value];
  for (const [pattern, replacer] of DYNAMIC_JA) {
    const match = value.match(pattern);
    if (match) return replacer(...match);
  }
  return value;
}

// The owner workspace uses the same Japanese business terminology as HQ.
// Exporting this small adapter keeps both surfaces consistent without exposing
// the translation tables or coupling the owner UI to HQ markup.
export function translateJapaneseUiText(value: string): string {
  return translateCore(value);
}

function translateTextNode(value: string): string {
  const start = value.match(/^\s*/)?.[0] ?? '';
  const end = value.match(/\s*$/)?.[0] ?? '';
  const core = value.trim();
  if (!core) return value;
  const translated = translateCore(core);
  return translated === core ? value : `${start}${translated}${end}`;
}

type TranslationState = {
  originalText: WeakMap<Text, string>;
  translatedText: WeakMap<Text, string>;
  originalAttributes: WeakMap<HTMLElement, Map<string, string>>;
  translatedAttributes: WeakMap<HTMLElement, Map<string, string>>;
};

const TRANSLATED_ATTRIBUTES = ['placeholder', 'title', 'aria-label'] as const;

function walkTextNodes(root: Node, callback: (node: Text) => void): void {
  if (root.nodeType === Node.TEXT_NODE) {
    callback(root as Text);
    return;
  }
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  if (!walker) return;
  let current = walker.nextNode();
  while (current) {
    callback(current as Text);
    current = walker.nextNode();
  }
}

function translateText(node: Text, state: TranslationState): void {
  const current = node.nodeValue ?? '';
  const lastTranslated = state.translatedText.get(node);
  if (!state.originalText.has(node) || current !== lastTranslated) {
    state.originalText.set(node, current);
  }
  const original = state.originalText.get(node) ?? current;
  const translated = translateTextNode(original);
  state.translatedText.set(node, translated);
  if (current !== translated) node.nodeValue = translated;
}

function translateAttribute(
  element: HTMLElement,
  attribute: (typeof TRANSLATED_ATTRIBUTES)[number],
  state: TranslationState,
): void {
  const current = element.getAttribute(attribute);
  if (current === null) return;
  const originals = state.originalAttributes.get(element) ?? new Map<string, string>();
  const translatedValues = state.translatedAttributes.get(element) ?? new Map<string, string>();
  const lastTranslated = translatedValues.get(attribute);
  if (!originals.has(attribute) || current !== lastTranslated) originals.set(attribute, current);
  const original = originals.get(attribute) ?? current;
  const translated = translateCore(original.trim());
  originals.set(attribute, original);
  translatedValues.set(attribute, translated);
  state.originalAttributes.set(element, originals);
  state.translatedAttributes.set(element, translatedValues);
  if (current !== translated) element.setAttribute(attribute, translated);
}

function translateElement(element: HTMLElement, state: TranslationState): void {
  TRANSLATED_ATTRIBUTES.forEach((attribute) => translateAttribute(element, attribute, state));
}

function translateTree(root: Node, state: TranslationState): void {
  walkTextNodes(root, (node) => translateText(node, state));
  if (root instanceof HTMLElement) {
    translateElement(root, state);
    root.querySelectorAll<HTMLElement>('[placeholder], [title], [aria-label]')
      .forEach((element) => translateElement(element, state));
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

export const HQLanguageBoundary: React.FC<React.PropsWithChildren<{ locale: HQLocale }>> = ({
  locale,
  children,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const translationStateRef = useRef<TranslationState>({
    originalText: new WeakMap<Text, string>(),
    translatedText: new WeakMap<Text, string>(),
    originalAttributes: new WeakMap<HTMLElement, Map<string, string>>(),
    translatedAttributes: new WeakMap<HTMLElement, Map<string, string>>(),
  });

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const state = translationStateRef.current;
    if (locale !== 'ja') {
      restoreTree(root, state);
      return undefined;
    }

    translateTree(root, state);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'characterData') {
          translateText(mutation.target as Text, state);
          return;
        }
        if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
          translateElement(mutation.target, state);
          return;
        }
        mutation.addedNodes.forEach((node) => translateTree(node, state));
      });
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label'],
    });
    return () => observer.disconnect();
  }, [locale]);

  return (
    <div ref={rootRef} lang={locale} className="contents">
      {children}
    </div>
  );
};

export const HQLanguageSwitch: React.FC<{
  locale: HQLocale;
  onChange: (locale: HQLocale) => void;
}> = ({ locale, onChange }) => (
  <div
    className="inline-flex min-h-11 items-center rounded-full border border-gray-200 bg-white p-1 shadow-sm"
    role="group"
    aria-label="管理画面の表示言語"
  >
    <button
      type="button"
      onClick={() => onChange('ja')}
      aria-pressed={locale === 'ja'}
      className={`min-h-11 rounded-full px-3 text-xs font-extrabold transition ${
        locale === 'ja' ? 'bg-black text-white' : 'text-gray-500 hover:bg-gray-100'
      }`}
    >
      日本語
    </button>
    <button
      type="button"
      onClick={() => onChange('en')}
      aria-pressed={locale === 'en'}
      className={`min-h-11 rounded-full px-3 text-xs font-extrabold transition ${
        locale === 'en' ? 'bg-black text-white' : 'text-gray-500 hover:bg-gray-100'
      }`}
    >
      English
    </button>
  </div>
);
