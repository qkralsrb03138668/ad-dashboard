// 데일리 광고 브리핑 재료 — 어제 Meta 성과(그제·지난 7일 평균 대비) + 카페24 판매를 짧은 JSON으로 출력.
//   매일 오전 Claude 예약 작업(daily-ad-brief)이 이 출력을 읽고 브리핑을 써서 브리핑 페이지에 저장한다.
//   node scripts/daily-brief-data.mjs [--date YYYY-MM-DD]   (기본: 서울 기준 어제)
// 인증: 이 폴더의 config.js(SUPABASE_URL·anon key·DASH_KEY) — weekly-insight.mjs와 같은 방식
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfgSrc = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const cfg = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DASH_KEY'].map(k => [k, (cfgSrc.match(new RegExp(k + '\\s*:\\s*"([^"]*)"')) || [])[1] || '']));
if (!cfg.SUPABASE_URL || !cfg.DASH_KEY) { console.log(JSON.stringify({ error: 'config.js에 SUPABASE_URL·DASH_KEY가 없음' })); process.exit(1); }
const headers = { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, 'x-dash-key': cfg.DASH_KEY };
async function api(fn, params) {
  const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/${fn}?` + new URLSearchParams(params), { headers });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.message || j.error || ('HTTP ' + res.status));
  return j;
}

const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const seoulToday = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const di = process.argv.indexOf('--date');
const Y = di > 0 ? process.argv[di + 1] : addDays(seoulToday, -1), Y2 = addDays(Y, -1);
const r1 = (n) => Math.round(n * 100) / 100;
const kpi = (x) => ({ spend: Math.round(x.spend), purchases: x.purchases, value: Math.round(x.value), clicks: x.clicks,
  roas: x.spend ? r1(x.value / x.spend) : 0, cpc: x.clicks ? Math.round(x.spend / x.clicks) : 0, cpa: x.purchases ? Math.round(x.spend / x.purchases) : 0 });
const sum = (rows) => rows.reduce((a, r) => ({ spend: a.spend + r.spend, purchases: a.purchases + r.purchases, value: a.value + r.value, clicks: a.clicks + r.clicks }), { spend: 0, purchases: 0, value: 0, clicks: 0 });
const day = (since, until) => api('meta-ads', { action: 'hierarchy', preset: 'custom', since, until });
const adsOf = (h) => h.campaigns.flatMap(c => c.adsets.flatMap(s => s.ads.map(a => ({ ...a, campaign: c.name, adset: s.name }))));

const out = { date: Y, compare_date: Y2, weekly_avg_range: [addDays(Y, -7), Y2] };
try {
  const [hy, hy2, hw] = await Promise.all([day(Y, Y), day(Y2, Y2), day(addDays(Y, -7), Y2)]);
  const w = sum(hw.campaigns);
  out.account = { yesterday: kpi(sum(hy.campaigns)), day_before: kpi(sum(hy2.campaigns)),
    avg_7d: kpi({ spend: w.spend / 7, purchases: r1(w.purchases / 7), value: w.value / 7, clicks: Math.round(w.clicks / 7) }) };
  const c2 = new Map(hy2.campaigns.map(c => [c.id, c]));
  out.campaigns = hy.campaigns.filter(c => c.spend > 0).sort((a, b) => b.spend - a.spend)
    .map(c => ({ name: c.name, status: c.status, daily_budget: c.budget, yesterday: kpi(c), day_before: c2.has(c.id) ? kpi(c2.get(c.id)) : null }));
  const a2 = new Map(adsOf(hy2).map(a => [a.id, a]));
  const ads = adsOf(hy).filter(a => a.spend > 0);
  const row = (a) => ({ name: a.name, campaign: a.campaign, adset: a.adset, status: a.status, created: String(a.created).slice(0, 10),
    yesterday: kpi(a), day_before: a2.has(a.id) ? kpi(a2.get(a.id)) : null });
  // ponytail: 지출 상위 25개 + 지출 1만원↑ 구매 0건 소재만 — 소재가 수백 개라 전부 넣으면 해석이 흐려진다
  out.top_ads_by_spend = [...ads].sort((a, b) => b.spend - a.spend).slice(0, 25).map(row);
  out.zero_purchase_ads = ads.filter(a => a.spend >= 10000 && !a.purchases).sort((a, b) => b.spend - a.spend).slice(0, 10).map(row);
  out.ads_with_spend = ads.length;
  out.test_ads = { count: ads.filter(a => /test/i.test(a.adset + a.name)).length, ...kpi(sum(ads.filter(a => /test/i.test(a.adset + a.name)))) };
} catch (e) { out.meta_error = String(e.message || e); }

// 오늘 판정할 테스트 소재 수 — 대시보드 테스트 소재 탭 '판정할 차례'와 같은 규칙(D+2, 금액 조건 없음, 판정 안 함, 숨김·종료 제외, 기준 전에 직접 끈 것 포함)
try {
  const [ta, st] = await Promise.all([api('meta-ads', { action: 'testads' }), api('meta-ads', { action: 'state_list' })]);
  const S = new Map((Array.isArray(st) ? st : []).map(r => [r.ad_id, r]));
  const days = d => Math.round((new Date(seoulToday + 'T00:00:00Z') - new Date(d + 'T00:00:00Z')) / 86400000);
  const pend = (ta.ads || []).filter(a => { const m = S.get(a.id) || {}; if (m.hidden || m.verdict || a.gone) return false;
    const es = String(a.effective_status || ''), sp = +a.spend || 0;
    return (a.reg_date && days(a.reg_date) >= 2) || (es !== 'ACTIVE' && !/REVIEW|PROCESS|DISAPPROVED|ISSUES|BILLING/.test(es) && sp > 0); });
  out.test_judge_pending = { count: pend.length, products: [...new Set(pend.map(a => String(a.adset_name || '').split('_')[0].trim()))].slice(0, 8) };
} catch (e) { out.test_judge_error = String(e.message || e).slice(0, 200); }

// 카페24 애널리틱스는 어제치가 늦게 열린다 → 어제부터 하루씩 뒤로 3일까지 시도, 실제 쓴 날짜를 남긴다
for (let i = 0; i < 3 && !out.cafe24; i++) {
  const d = addDays(Y, -i);
  try {
    const p = await api('cafe24-perf', { action: 'performance', start_date: d, end_date: d });
    out.cafe24 = { date: d, note: d === Y ? '' : `카페24 집계는 ${d}까지만 열려 있음 (어제치 미반영)`,
      paid_qty: p.rows.reduce((a, r) => a + r.paid_qty, 0), order_amount: p.rows.reduce((a, r) => a + r.order_amount, 0),
      cancel_qty: p.rows.reduce((a, r) => a + r.cancel_qty, 0),
      top_products: p.rows.slice(0, 10).map(r => ({ name: r.product_name, qty: r.paid_qty, amount: r.order_amount })) };
  } catch (e) { out.cafe24_error = String(e.message || e).slice(0, 200); }
}
if (out.cafe24) delete out.cafe24_error;

console.log(JSON.stringify(out));
