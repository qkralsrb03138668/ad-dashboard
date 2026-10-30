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
  // 판정 창 2주 시험(2026-10-29~11-11) 기록 — 어제 메타 매출을 기본값(클릭7일+조회1일)과 클릭 7일로 같이. 카페24 결제금액(cafe24.order_amount)과 비교해 어느 창이 실제에 가까운지 본다
  const P7 = a => a.purchases_7d != null ? a.purchases_7d : Math.max(0, (a.purchases || 0) - (a.purchases_1dv || 0)), V7 = a => a.value_7d != null ? a.value_7d : (a.purchases > 0 ? (a.value || 0) * P7(a) / a.purchases : (a.value || 0));
  const ys = sum(hy.campaigns);
  out.attr_trial = { date: Y, spend: Math.round(ys.spend), meta_default_value: Math.round(ys.value), meta_default_purchases: ys.purchases,
    meta_click7_value: Math.round(hy.campaigns.reduce((t, c) => t + V7(c), 0)), meta_click7_purchases: hy.campaigns.reduce((t, c) => t + P7(c), 0) };
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

// 승격 후보 (2026-10-23 ⑦) — 월요일 브리핑에만 (또는 --promo). 직전 7일 Meta 성과로: 종합 CBO 후보 = 테스트 세트 광고 중 구매 30↑·ROAS 5↑·아직 [→CBO] 표시 없음
//   상품 CBO 후보 = 한 상품에 우수(구매 10↑·ROAS 5↑) 소재 2개↑ 이고 상품 구매 60↑·상품CBO 표시 없음. 대시보드 승격 후보(admgr-alerts.js)와 같은 기준(손익분기 대신 고정 5)
const isMonday = new Date(seoulToday + 'T00:00:00+09:00').getDay() === 1;
// 2026-10-28 사용자: CBO 승격 없이 ABO로만 운영해 보기 → 승격 후보는 안 냄 (대시보드 ADMGR_PROMO.on과 같이). 다시 켜려면 --promo
if (process.argv.includes('--promo')) try {
  const h7 = await day(addDays(seoulToday, -7), addDays(seoulToday, -1));
  // 테스트 세트는 세트당 광고 1개라 세트 단위로 본다 — hierarchy의 광고 목록은 500행에서 잘려 큰 기간엔 테스트 광고가 빠진다 (2026-10-23 확인)
  const tests = h7.campaigns.filter(c => /테스트/.test(c.name)).flatMap(c => (c.adsets || []).map(s => ({ ...s, adset: s.name }))).filter(s => s.status === 'ACTIVE' && s.spend > 0);   // 테스트 캠페인 안 세트 전부 (이름에 _test가 없는 옛 세트 포함)
  // 클릭 후 7일 기준 (2026-10-25): 서버 purchases_7d·value_7d, 없으면 기본 − 조회1일 (메타 기본 창 = 클릭7일 + 조회1일)
  const P7 = a => a.purchases_7d != null ? a.purchases_7d : Math.max(0, (a.purchases || 0) - (a.purchases_1dv || 0)), V7 = a => a.value_7d != null ? a.value_7d : (a.purchases > 0 ? (a.value || 0) * P7(a) / a.purchases : (a.value || 0));
  const roas = a => a.spend ? V7(a) / a.spend : 0, prod = n => String(n).split('_')[0].replace(/\s+\d{6}\b.*$/, '').replace(/\s+\d{2,}\s*$/, '').trim();
  const norm = s => String(s || '').normalize('NFC').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
  const prodCbo = new Set(h7.campaigns.filter(c => /^상품CBO_/.test(c.name) && c.status === 'ACTIVE').map(c => norm(c.name.replace(/^상품CBO_/, '').replace(/_\d{6}$/, ''))));   // 이미 상품 CBO가 도는 상품은 후보에서 제외 (이름 표시가 지워졌어도)
  const hasProdCbo = a => prodCbo.has(norm(prod(a.adset)));
  const all = tests.filter(a => !/\[→/.test(a.adset) && !hasProdCbo(a) && P7(a) >= 30 && roas(a) >= 5).sort((a, b) => roas(b) - roas(a))
    .map(a => ({ adset: a.adset, purchases: P7(a), roas: r1(roas(a)), spend: Math.round(a.spend), cpa: Math.round(a.spend / P7(a)) }));
  const byP = new Map(); tests.forEach(a => { const k = prod(a.adset); (byP.get(k) || byP.set(k, []).get(k)).push(a); });
  const prods = [...byP.entries()].map(([name, L]) => ({ name, purchases: L.reduce((s, a) => s + P7(a), 0), creatives: L.length, good: L.filter(a => P7(a) >= 10 && roas(a) >= 5).map(a => ({ adset: a.adset, purchases: P7(a), roas: r1(roas(a)) })), has_product_cbo: L.some(a => /\[→상품CBO_/.test(a.adset) || hasProdCbo(a)) }))
    .filter(x => !x.has_product_cbo && x.purchases >= 60 && x.good.length >= 2).sort((a, b) => b.purchases - a.purchases);
  const prodNames = new Set(prods.map(p => norm(p.name)));   // 상품 CBO 후보 상품의 세트는 종합 후보에 안 넣는다 (대시보드와 같은 규칙)
  out.promotion = { range: [addDays(seoulToday, -7), addDays(seoulToday, -1)], general_cbo: all.filter(a => !prodNames.has(norm(prod(a.adset)))).slice(0, 12), product_cbo: prods.slice(0, 6) };
} catch (e) { out.promotion_error = String(e.message || e).slice(0, 200); }

// 소재 피로 (2026-10-23 ⑧, 10/28 구매당 비용 → ROAS) — 상품 단위 ROAS: 최근 7일 vs 그 전 7일. 지난주 구매 20↑ · 이번 주 5↑ · 20% 이상 하락. 대시보드 알림판과 같은 기준(기본값 창)
try {
  const [hn, hp] = await Promise.all([day(addDays(seoulToday, -7), addDays(seoulToday, -1)), day(addDays(seoulToday, -14), addDays(seoulToday, -8))]);
  const prod = n => String(n).split('_')[0].replace(/\s+\d{6}\b.*$/, '').replace(/\s+\d{2,}\s*$/, '').trim();
  const agg = h => { const m = new Map(); for (const c of h.campaigns) for (const s of c.adsets || []) { if (!(s.spend > 0)) continue; const k = prod(s.name); const o = m.get(k) || { spend: 0, pur: 0, val: 0 }; o.spend += s.spend; o.pur += s.purchases || 0; o.val += s.value || 0; m.set(k, o); } return m; };
  const now = agg(hn), prev = agg(hp), hits = [];
  for (const [k, a] of now) { const bb = prev.get(k); if (!bb || bb.pur < 20 || a.pur < 5 || !(bb.val > 0)) continue; const r1_ = a.val / a.spend, r0 = bb.val / bb.spend, d = 1 - r1_ / r0; if (d >= 0.20) hits.push({ product: k, roas_prev: Math.round(r0 * 100), roas_now: Math.round(r1_ * 100), drop_pct: Math.round(d * 100), purchases_prev: bb.pur, purchases_now: a.pur }); }
  out.fatigue = { range_now: [addDays(seoulToday, -7), addDays(seoulToday, -1)], range_prev: [addDays(seoulToday, -14), addDays(seoulToday, -8)], products: hits.sort((x, y) => y.drop_pct - x.drop_pct).slice(0, 8) };
} catch (e) { out.fatigue_error = String(e.message || e).slice(0, 200); }

// 작년 이맘때 베스트 (2026-10-23 ⑨, 월요일) — 작년 3~7주 뒤 기간 세트 구매순 (Meta 37개월 조회). 지금 켜진 세트에 같은 상품이 있으면 already_on
if (isMonday || process.argv.includes('--promo')) try {
  const base = addDays(seoulToday, -365), since = addDays(base, 21), until = addDays(base, 48);
  const [hs, hn] = await Promise.all([day(since, until), day(seoulToday, seoulToday)]);
  const norm = s => String(s || '').normalize('NFC').toLowerCase().replace(/[^0-9a-z가-힣]/g, ''), core = n => String(n || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  const pr = (await api('cafe24-perf', { action: 'products' })).rows || [], idx = pr.filter(p => p.price > 0).map(p => ({ name: core(p.name), n: norm(core(p.name)) })).filter(p => p.n.length >= 3).sort((a, b) => b.n.length - a.n.length);
  const prod = name => { const bn = String(name).replace(/\s*\[→[^\]]+\]/g, ''), n = norm(bn), p = idx.find(x => n.includes(x.n)); if (p) return p.name;   // 옛 이름('영상_(기모ver.) 클레르 블라우스_24.000')도 상품 목록에서 찾기
    return bn.split('_').map(x => core(x).replace(/^\d{3,4}\s+/, '').replace(/\d{1,3}([.,]\d{3})+|\d{4,6}/g, '').replace(/\s*-\s*[가-힣]+\s*$/, '').replace(/\s+\d{1,3}$/, '').trim()).filter(x => x && !/^\d+$/.test(x) && !/^(영상|이미지|릴스|스토리|인스타|메인|히어로|전환|테스트|사본)\d*$/.test(x)).sort((a, b) => b.length - a.length)[0] || bn.split('_')[0]; };
  const live = new Set(hn.campaigns.flatMap(c => (c.adsets || []).filter(s => s.status === 'ACTIVE').map(s => norm(prod(s.name)))));
  out.season = { range: [since, until], sets: hs.campaigns.flatMap(c => (c.adsets || []).map(s => ({ ...s, camp: c.name }))).filter(s => s.spend > 0 && s.purchases >= 20 && s.value / s.spend >= 3)
    .sort((a, b) => b.purchases - a.purchases).slice(0, 12).map(s => ({ adset: s.name, campaign: s.camp, product: prod(s.name), purchases: s.purchases, roas: r1(s.value / s.spend), spend: Math.round(s.spend), already_on: live.has(norm(prod(s.name))) })) };
} catch (e) { out.season_error = String(e.message || e).slice(0, 200); }

// 이름·페이지 위생 (2026-10-23 ⑩) — 사본 미정리 · 최근 3일 테스트 세트 중 이름 규칙 밖 · 다른 페이스북 페이지로 나가는 켜진 광고
try {
  const hn = await day(seoulToday, seoulToday), RULE = /^[^_]+_.*_\d+_\d{6}(_test)?$/, COPY = /\s*[-–—]?\s*(사본|copy)\s*\d*\s*$/i, since3 = addDays(seoulToday, -3);   // 느슨한 규칙(대시보드 AG_NAME_OK와 동일)
  const sets = hn.campaigns.flatMap(c => (c.adsets || []).map(s => ({ ...s, camp: c.name })));
  const baseName = n => String(n).replace(/\s*\[→[^\]]+\]/g, '').trim();
  const copies = sets.filter(s => COPY.test(baseName(s.name))).map(s => s.name);
  const odd = sets.filter(s => /테스트/.test(s.camp) && String(s.created || '').slice(0, 10) >= since3 && !RULE.test(baseName(s.name)) && !COPY.test(baseName(s.name))).map(s => s.name);
  const ap = await api('meta-ads', { action: 'adpages' }); const cnt = {}; (ap.ads || []).forEach(a => { cnt[a.page_id] = (cnt[a.page_id] || 0) + 1; });
  const main = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; const off = (ap.ads || []).filter(a => main && a.page_id !== main[0]).map(a => ({ ad: a.name, campaign: a.campaign, page: a.page || a.page_id }));
  out.hygiene = { copies, odd_names: odd.slice(0, 10), wrong_page: off.slice(0, 10), main_page: main ? (ap.ads.find(a => a.page_id === main[0]) || {}).page || main[0] : null };
} catch (e) { out.hygiene_error = String(e.message || e).slice(0, 200); }

// 예산 조정 후보 (2026-10-28) — 대시보드 알림판 '예산 조정 후보'와 같은 함수(js/admgr-alerts.js admgrAdjCalc)·같은 선(js/admgr.js ADMGR_ROAS)을 그대로 불러 같은 기준으로 센다
//   7일(어제까지) ROAS(메타 기본값 창, 2주 시험): 450% 미만 OFF · 450~550% 절반 · 550~900% 유지 · 900%↑ 증액. 상품 마진은 안 씀
try {
  const vm = await import('node:vm'), src = fs.readFileSync(path.join(root, 'js/admgr-alerts.js'), 'utf8'), base = fs.readFileSync(path.join(root, 'js/admgr.js'), 'utf8'), tabs = fs.readFileSync(path.join(root, 'js/admgr-tabs.js'), 'utf8');
  const grab = (re, t = src) => (t.match(re) || [])[0] || '';
  const code = [...['admgrP7', 'admgrV7', 'ADMGR_ROAS', 'admgrPJ', 'admgrVJ'].map(k => grab(new RegExp(`const ${k} = [^\\n]+`), base)), grab(/const ADMGR_ADJ = [^\n]+/), grab(/const admgrKstDay = [^\n]+/), grab(/const admgrProductOf = [^\n]+/, tabs), grab(/function admgrAdjCalc\([\s\S]*?\n}\n/)].join('\n');
  if (!/function admgrAdjCalc/.test(code) || !/const ADMGR_ROAS/.test(code) || !/const admgrProductOf/.test(code)) throw new Error('admgrAdjCalc·ADMGR_ROAS·admgrProductOf를 못 찾음');
  const ctx = { admgrShiftDay: addDays };
  vm.createContext(ctx); vm.runInContext(code + '\nthis.calc = admgrAdjCalc;', ctx);
  const [h7, h3, hn, bh, dl] = await Promise.all([day(addDays(seoulToday, -7), addDays(seoulToday, -1)), day(addDays(seoulToday, -3), addDays(seoulToday, -1)), day(seoulToday, seoulToday),
    api('meta-ads', { action: 'budgethistory', start_date: addDays(seoulToday, -10), end_date: seoulToday }), api('client-log', { action: 'state_get', key: 'prod_drop_log' }).catch(() => ({}))]);
  const dropLog = Object.fromEntries(Object.entries(((dl || {}).data || {}).items || {}).filter(([, v]) => v.day >= addDays(seoulToday, -14)));
  const M = h => new Map(h.campaigns.flatMap(c => (c.adsets || []).map(s => [s.id, s])));
  const sets = hn.campaigns.flatMap(c => (c.adsets || []).map(s => ({ ...s, _cbo: c.budget > 0 || c.budget_life > 0 })));
  const dow = new Date(seoulToday + 'T00:00:00Z').getUTCDay(), R = ctx.calc(sets, M(h7), M(h3), bh.events || [], seoulToday, dow, undefined, dropLog);
  const pick = k => R.filter(x => x.act === k), nm = x => String(x.s.name).replace(/\s*\[→[^\]]+\]/g, '').trim(), pct = r => 'ROAS ' + Math.round(r * 100) + '%';
  const act = R.filter(x => ['off', 'half', 'back', 'up'].includes(x.act)), before = act.reduce((a, x) => a + x.from, 0), after = act.reduce((a, x) => a + x.to, 0);
  out.budget_adjust = { off: pick('off').length, half: pick('half').length, half_prod_drop: R.filter(x => x.prodDrop).length, back: pick('back').length, up: pick('up').length, up_prod: R.filter(x => x.prodUp).length, hold: pick('watch').length, cool: pick('cool').length, budget_before: before, budget_after: after,
    top_off: pick('off').sort((a, b) => b.from - a.from).slice(0, 5).map(x => `${nm(x)} (7일 ${pct(x.r7)}, 일예산 ${x.from})`), top_up: pick('up').slice(0, 5).map(x => `${nm(x)} (7일 ${pct(x.r7)}, ${x.from}→${x.to})`) };
} catch (e) { out.budget_adjust_error = String(e.message || e).slice(0, 200); }

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

// 상품 보드 판정 변화 (2026-10-30) — 대시보드 광고관리자 '상품 보드' 탭과 같은 함수(js/admgr-board.js admgrBoardCalc)로
//   카페24가 열린 마지막 날 D 기준 판정 vs D−1 기준 판정을 비교해, 할 일이 있는 판정(증액 후보·소재 피로·노출 부족·식는 중)으로 바뀐 상품을 광고 지출순 3개.
if (out.cafe24) try {
  const vm = await import('node:vm'), rd = f => fs.readFileSync(path.join(root, f), 'utf8'), base = rd('js/admgr.js'), tabs = rd('js/admgr-tabs.js'), board = rd('js/admgr-board.js');
  const grab = (re, t) => (t.match(re) || [])[0] || '';
  const code = [...['admgrP7', 'admgrV7', 'ADMGR_ROAS', 'admgrPJ', 'admgrVJ', 'admgrNorm', 'admgrProdKey'].map(k => grab(new RegExp(`const ${k} = [^\\n]+`), base)),
    grab(/const admgrProductOf = [^\n]+/, tabs), grab(/const BOARD_V = \{[\s\S]*?\n\};/, board), grab(/function admgrBoardCalc[\s\S]*?\n}\n/, board)].join('\n');
  if (!/function admgrBoardCalc/.test(code) || !/const admgrProdKey/.test(code)) throw new Error('admgrBoardCalc·admgrProdKey를 못 찾음');
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(code + '\nthis.calc = admgrBoardCalc; this.V = BOARD_V; this.d = { prodOf: admgrProductOf, norm: admgrNorm, PJ: admgrPJ, VJ: admgrVJ, keep: ADMGR_ROAS.keep }; this.key = admgrProdKey;', ctx);
  const D = out.cafe24.date, perf = (s, e) => api('cafe24-perf', { action: 'performance', start_date: s, end_date: e }).then(p => p.rows || []);
  const pr = (await api('cafe24-perf', { action: 'products' })).rows || [];
  const idx = pr.filter(p => p.name && p.price > 0).map(p => ({ no: p.product_no, name: p.name, n: ctx.key(p.name) })).filter(p => p.n.length >= 3).sort((a, b) => b.n.length - a.n.length);
  const at = async E => { const [cur, prev, h7, h3] = await Promise.all([perf(addDays(E, -6), E), perf(addDays(E, -13), addDays(E, -7)), day(addDays(E, -6), E), day(addDays(E, -2), E)]);
    return ctx.calc(cur, prev, h7, h3, idx, ctx.d).rows; };
  const now = await at(D), before = new Map((await at(addDays(D, -1))).map(r => [r.no, r.v]));
  const name = n => String(n).replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim(), pc = v => v == null ? null : Math.round(v * 100);
  const changed = now.filter(r => ['up', 'fatigue', 'reach', 'cool'].includes(r.v) && before.has(r.no) && before.get(r.no) !== r.v).sort((a, b) => b.sp7 - a.sp7);
  out.product_board = { date: D, range_now: [addDays(D, -6), D], range_prev: [addDays(D, -13), addDays(D, -7)], changed_count: changed.length,
    counts: Object.fromEntries(['up', 'fatigue', 'reach', 'cool'].map(k => [ctx.V[k][0], now.filter(r => r.v === k).length])),
    changes: changed.slice(0, 3).map(r => ({ product: name(r.name), from: ctx.V[before.get(r.no)][0], to: ctx.V[r.v][0], meaning: ctx.V[r.v][3],
      rank: r.rank, prev_rank: r.prevRank, qty: r.qty, prev_qty: r.prevQty, qty_pct: r.prevQty ? Math.round((r.qty / r.prevQty - 1) * 100) : null,
      roas_7d: pc(r.r7), roas_3d: pc(r.r3), spend_7d: Math.round(r.sp7) })) };
} catch (e) { out.product_board_error = String(e.message || e).slice(0, 200); }

console.log(JSON.stringify(out));
