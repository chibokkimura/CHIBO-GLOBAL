import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { Store } from './types';
import { supabase } from './supabaseClient';

export type AdvisorSummary = {
  currency: string;
  netSales: number | null;
  foodCostPercentage: number | null;
  laborCostPercentage: number | null;
  primeCostPercentage: number | null;
  storeManagementMarginPercentage: number | null;
  targetLaborCostPercentage: number | null;
  targetPrimeCostPercentage: number | null;
  targetStoreMarginPercentage: number | null;
  laborTargetVariancePercentage: number | null;
  primeTargetVariancePercentage: number | null;
  marginTargetVariancePercentage: number | null;
  profitabilityReady: boolean;
};

type AdvicePriority = {
  title: string;
  evidence: string;
  action: string;
  expected_effect: string;
  caveat: string;
};

type Advice = {
  headline: string;
  assessment: string;
  priorities: AdvicePriority[];
  next_review_checks: string[];
  data_quality_note: string;
};

type AdvisorResponse = {
  advice: Advice;
  model: string;
  generated_at: string;
  cached: boolean;
};

type Language = 'ja' | 'en' | 'zh-TW';

type Props = {
  store: Store;
  monthStart: string;
  summary: AdvisorSummary;
  preview: boolean;
};

const LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
  { value: 'zh-TW', label: '繁體中文' },
];

function percent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;
}

function previewAdvice(summary: AdvisorSummary, language: Language): Advice {
  if (language === 'en') {
    return {
      headline: 'Protect the margin by checking labor and prime cost first',
      assessment: `Management margin is ${percent(summary.storeManagementMarginPercentage)}. Labor and prime cost are the first controllable gaps to review.`,
      priorities: [
        {
          title: 'Review total labor cost and hours',
          evidence: `Labor cost is ${percent(summary.laborCostPercentage)} versus a ${percent(summary.targetLaborCostPercentage)} target.`,
          action: 'Confirm the monthly payroll total and labor hours, then compare sales per labor hour with the prior month.',
          expected_effect: 'Reduce labor-cost variance without assuming shift-level causes that are not in the data.',
          caveat: 'Daily and shift staffing cannot be diagnosed from monthly totals alone.',
        },
        {
          title: 'Verify food-cost and inventory inputs',
          evidence: `Prime cost is ${percent(summary.primeCostPercentage)} versus a ${percent(summary.targetPrimeCostPercentage)} target.`,
          action: 'Recheck purchase prices, opening and closing counts, waste entries and recipe coverage.',
          expected_effect: 'Identify whether the variance is driven by price, recorded waste or usage.',
          caveat: 'Supplier or recipe causes require ingredient-level evidence.',
        },
      ],
      next_review_checks: ['Confirm payroll and labor hours', 'Confirm every inventory count', 'Compare the same KPIs next month'],
      data_quality_note: 'This is a preview generated from sample numbers and is not an operating-data result.',
    };
  }

  if (language === 'zh-TW') {
    return {
      headline: '先確認人事費與主要成本，守住管理利潤率',
      assessment: `目前管理利潤率為 ${percent(summary.storeManagementMarginPercentage)}，應優先檢查可控制的人事費與主要成本差異。`,
      priorities: [
        {
          title: '確認每月人事費與總工時',
          evidence: `人事費率為 ${percent(summary.laborCostPercentage)}，目標為 ${percent(summary.targetLaborCostPercentage)}。`,
          action: '核對薪資總額與總工時，並與上月每工時營業額比較。',
          expected_effect: '在不臆測班別原因的情況下縮小人事費差異。',
          caveat: '只有月合計資料時，無法判斷每日或班別配置。',
        },
        {
          title: '重新確認原價與盤點資料',
          evidence: `主要成本率為 ${percent(summary.primeCostPercentage)}，目標為 ${percent(summary.targetPrimeCostPercentage)}。`,
          action: '確認採購單價、期初期末盤點、耗損與配方登錄。',
          expected_effect: '區分單價、耗損與使用量造成的差異。',
          caveat: '判斷供應商或配方原因需要材料別資料。',
        },
      ],
      next_review_checks: ['核對薪資與工時', '完成全部材料盤點', '下月用同一指標比較'],
      data_quality_note: '此為測試畫面的範例建議，不是實際營運資料分析。',
    };
  }

  return {
    headline: '人件費とプライムコストを先に確認し、管理利益率を守る',
    assessment: `管理利益率は ${percent(summary.storeManagementMarginPercentage)} です。まず、店舗で改善可能な人件費とプライムコストの差異を確認してください。`,
    priorities: [
      {
        title: '月間人件費と総労働時間を再確認する',
        evidence: `人件費率は ${percent(summary.laborCostPercentage)}、目標は ${percent(summary.targetLaborCostPercentage)} です。`,
        action: '給与総額と総労働時間を照合し、前月の労働時間当たり売上と比較してください。',
        expected_effect: '時間帯別の原因を推測せず、人件費差異を縮小する確認ができます。',
        caveat: '月次合計だけでは、曜日別・時間帯別の人員配置は判断できません。',
      },
      {
        title: '原価と棚卸入力を再確認する',
        evidence: `プライムコスト率は ${percent(summary.primeCostPercentage)}、目標は ${percent(summary.targetPrimeCostPercentage)} です。`,
        action: '仕入単価、月初・月末棚卸、廃棄、レシピ登録率を確認してください。',
        expected_effect: '単価・廃棄・使用量のどこに差異があるかを切り分けやすくなります。',
        caveat: '仕入先やレシピを原因と判断するには、材料別データが必要です。',
      },
    ],
    next_review_checks: ['給与総額と総労働時間を照合', '全材料の棚卸完了を確認', '翌月も同じ指標で比較'],
    data_quality_note: 'これは検討画面用のサンプル提案であり、実運用データの分析結果ではありません。',
  };
}

const AIProfitabilityAdvisor: React.FC<Props> = ({ store, monthStart, summary, preview }) => {
  const [language, setLanguage] = useState<Language>('ja');
  const [result, setResult] = useState<AdvisorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!summary.profitabilityReady) return;
    setLoading(true);
    setError(null);

    if (preview) {
      setResult({
        advice: previewAdvice(summary, language),
        model: 'preview-rules',
        generated_at: new Date().toISOString(),
        cached: true,
      });
      setLoading(false);
      return;
    }

    try {
      const { data, error: invokeError } = await supabase.functions.invoke<AdvisorResponse>('profitability-advisor', {
        body: { store_id: store.id, month_start: monthStart, language },
      });
      if (invokeError) throw invokeError;
      if (!data?.advice) throw new Error('The AI advice response was empty.');
      setResult(data);
    } catch (generateError: any) {
      setError(generateError?.message ?? 'Failed to generate AI advice.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-slate-300 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-slate-800" />
              <h4 className="font-black text-slate-950">AI Management Brief</h4>
              {preview ? <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-800">DEMO</span> : null}
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Generates evidence-based priorities from this month’s completed sales, cost, labor and margin data.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <select
              aria-label="AI advice language"
              value={language}
              onChange={(event) => {
                setLanguage(event.target.value as Language);
                setResult(null);
                setError(null);
              }}
              className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold"
            >
              {LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={loading || !summary.profitabilityReady}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {result ? 'Check Updated Data' : 'Generate Advice'}
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 text-[11px] text-slate-500">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>HQ only · no automatic charge · unchanged data reuses the saved result · maximum 20 new generations per month</span>
        </div>
      </div>

      {!summary.profitabilityReady ? (
        <div className="flex items-start gap-3 p-5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          Complete the monthly inputs and inventory close before generating advice.
        </div>
      ) : result ? (
        <div className="p-5">
          <div className="flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-lg font-black text-slate-950">{result.advice.headline}</div>
              <p className="mt-2 text-sm leading-6 text-slate-700">{result.advice.assessment}</p>
            </div>
            <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black text-slate-600">
              {result.cached ? 'SAVED RESULT' : 'NEW ANALYSIS'}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
            {result.advice.priorities.map((priority, index) => (
              <article key={`${priority.title}-${index}`} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-2 text-xs font-black text-slate-500">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-white">{index + 1}</span>
                  PRIORITY
                </div>
                <h5 className="mt-3 font-black text-slate-950">{priority.title}</h5>
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                  <span className="font-black">Evidence:</span> {priority.evidence}
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-800">{priority.action}</p>
                <p className="mt-3 text-xs leading-5 text-emerald-800"><span className="font-black">Expected:</span> {priority.expected_effect}</p>
                <p className="mt-2 text-[11px] leading-5 text-slate-500"><span className="font-bold">Limit:</span> {priority.caveat}</p>
              </article>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.2fr]">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-black uppercase tracking-wide text-slate-500">Next review checks</div>
              <ul className="mt-3 space-y-2">
                {result.advice.next_review_checks.map((check) => (
                  <li key={check} className="flex items-start gap-2 text-sm text-slate-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /> {check}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-600">
              <span className="font-black text-slate-800">Data quality:</span> {result.advice.data_quality_note}
              <div className="mt-2 text-[10px] text-slate-400">
                Operational decision support only. Verify source data before acting; this is not statutory accounting or tax advice.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-5 text-sm text-slate-600">
          Nothing is sent automatically. Press Generate Advice only when HQ wants a monthly review brief.
        </div>
      )}

      {error ? <div className="m-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}
    </section>
  );
};

export default AIProfitabilityAdvisor;
