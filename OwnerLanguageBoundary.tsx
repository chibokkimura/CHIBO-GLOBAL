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
  'Optional: import a POS, attendance or cost file': '任意：POS・勤怠・原価ファイルを取り込む',
  'Finish purchases and closing stock count': '仕入入力と月末棚卸を完了',
  'STEP 2 · INVENTORY CLOSE': 'ステップ2・棚卸締め',
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
  'Ingredient Purchase Setup': '食材の購入単位設定',
  'Review each ingredient in one row and open the form only when changes are needed.': '食材ごとに1行で確認し、変更が必要な場合のみフォームを開いてください。',
  'Ingredient to configure': '設定する食材',
  'Select a registered ingredient': '登録済み食材を選択',
  'Add Purchase Setup': '購入単位設定を追加',
  'Add New Ingredient': '新しい食材を追加',
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
  'COURSES & SETS': P('套餐', '套餐', 'SET / THỰC ĐƠN KHÓA', '코스·세트'),
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
  'Finish the month in 3 steps': P('分3步完成月度结算', '分3步完成月結', 'Hoàn tất tháng trong 3 bước', '3단계로 월 마감 완료'),
  'Store monthly operations': P('门店月度运营', '門店月度營運', 'Vận hành tháng của cửa hàng', '점포 월 운영'),
  'Monthly Operations Check': P('月度运营确认', '月度營運確認', 'Kiểm tra vận hành tháng', '월 운영 확인'),
  'Monthly operations month': P('月度运营月份', '月度營運月份', 'Tháng vận hành', '월 운영 대상월'),
  'Reload monthly operations': P('重新加载月度运营', '重新載入月度營運', 'Tải lại vận hành tháng', '월 운영 새로고침'),
  'Reload monthly profit inputs': P('重新加载月度收益输入', '重新載入月度收益輸入', 'Tải lại dữ liệu lợi nhuận tháng', '월 수익 입력 새로고침'),
  'Reload monthly profitability': P('重新加载月度收益分析', '重新載入月度收益分析', 'Tải lại phân tích lợi nhuận tháng', '월 수익성 새로고침'),
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
  'Finish purchases and closing stock count': P('完成采购和月末盘点', '完成採購和月底盤點', 'Hoàn tất mua hàng và tồn cuối tháng', '매입·월말 재고 완료'),
  'STEP 2 · INVENTORY CLOSE': P('第2步 · 库存盘点', '步驟2 · 庫存盤點', 'BƯỚC 2 · CHỐT TỒN KHO', '2단계 · 재고 마감'),
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
  'Sign out': P('退出登录', '登出', 'Đăng xuất', '로그아웃'),
};

const DYNAMIC: Record<Exclude<OwnerLocale, 'en' | 'ja'>, Array<[RegExp, (...m: string[]) => string]>> = {
  'zh-CN': [
    [/^(\d+) days missing$/, (_a, n) => `缺少 ${n} 天`],
    [/^(\d+) missing$/, (_a, n) => `缺少 ${n} 项`],
    [/^(\d+)\/(\d+) due reports complete$/, (_a, a, b) => `应提交报告 ${a}/${b} 已完成`],
    [/^(\d+)\/(\d+) recipes$/, (_a, a, b) => `配方 ${a}/${b}`],
    [/^(\d+) single items · (\d+) courses\/sets$/, (_a, a, b) => `单品 ${a} · 套餐 ${b}`],
    [/^(\d+) staff$/, (_a, n) => `${n} 名员工`],
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
    [/^(\d+) days missing$/, (_a, n) => `缺少 ${n} 天`],
    [/^(\d+) missing$/, (_a, n) => `缺少 ${n} 項`],
    [/^(\d+)\/(\d+) due reports complete$/, (_a, a, b) => `應提交報告 ${a}/${b} 已完成`],
    [/^(\d+)\/(\d+) recipes$/, (_a, a, b) => `配方 ${a}/${b}`],
    [/^(\d+) single items · (\d+) courses\/sets$/, (_a, a, b) => `單品 ${a} · 套餐 ${b}`],
    [/^(\d+) staff$/, (_a, n) => `${n} 名員工`],
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
    [/^(\d+) days missing$/, (_a, n) => `Thiếu ${n} ngày`],
    [/^(\d+) missing$/, (_a, n) => `Thiếu ${n} mục`],
    [/^(\d+)\/(\d+) due reports complete$/, (_a, a, b) => `Đã đủ ${a}/${b} báo cáo`],
    [/^(\d+)\/(\d+) recipes$/, (_a, a, b) => `Công thức ${a}/${b}`],
    [/^(\d+) single items · (\d+) courses\/sets$/, (_a, a, b) => `${a} món lẻ · ${b} set`],
    [/^(\d+) staff$/, (_a, n) => `${n} nhân viên`],
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
    [/^(\d+) days missing$/, (_a, n) => `${n}일 미제출`],
    [/^(\d+) missing$/, (_a, n) => `${n}개 누락`],
    [/^(\d+)\/(\d+) due reports complete$/, (_a, a, b) => `필요 보고 ${a}/${b} 완료`],
    [/^(\d+)\/(\d+) recipes$/, (_a, a, b) => `레시피 ${a}/${b}`],
    [/^(\d+) single items · (\d+) courses\/sets$/, (_a, a, b) => `단품 ${a} · 코스/세트 ${b}`],
    [/^(\d+) staff$/, (_a, n) => `직원 ${n}명`],
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
  [/^(\d+) missing$/, (_a, n) => `未完了 ${n}件`],
  [/^(\d+)\/(\d+) due reports complete$/, (_a, a, b) => `必要な報告 ${a}/${b} 完了`],
  [/^(\d+)\/(\d+) recipes$/, (_a, a, b) => `レシピ ${a}/${b}`],
  [/^(\d+) single items · (\d+) courses\/sets$/, (_a, a, b) => `単品 ${a}件・コース／セット ${b}件`],
  [/^(\d+) staff$/, (_a, n) => `スタッフ ${n}名`],
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

function translateCore(value: string, locale: OwnerLocale): string {
  if (locale === 'en') return value;
  if (locale === 'ja') {
    if (OWNER_JA[value]) return OWNER_JA[value];
    for (const [pattern, replacer] of DYNAMIC_JA) {
      const match = value.match(pattern);
      if (match) return replacer(...match);
    }
    return translateJapaneseUiText(value);
  }
  const exact = OWNER_TEXT[value]?.[locale];
  if (exact) return exact;
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
