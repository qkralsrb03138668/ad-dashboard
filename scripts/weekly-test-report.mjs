// 테스트 소재 리포트를 브라우저 없이 만들어 저장하고(test_report) 이어서 AI 태그·해석(test-insight.mjs)까지 — 금요일 아침 자동 실행용.
//   node scripts/weekly-test-report.mjs [일수=30]   → 대시보드 js를 그대로 불러(가짜 DOM) 같은 계산으로 리포트 생성 → shared_state test_report 저장 → test-insight 실행
//   바탕화면 테스트리포트-해석.command 도 이 파일을 부른다 (대시보드를 먼저 안 열어도 됨). 인증: config.js(DASH_KEY)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const days = Number(process.argv.find(a => /^\d+$/.test(a))) || 30;
const cfgSrc = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const cfg = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DASH_KEY'].map(k => [k, (cfgSrc.match(new RegExp(k + '\\s*:\\s*"([^"]*)"')) || [])[1] || '']));
if (!cfg.SUPABASE_URL || !cfg.DASH_KEY) { console.error('❌ config.js에 SUPABASE_URL·DASH_KEY가 필요합니다'); process.exit(1); }
const headers = { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, 'x-dash-key': cfg.DASH_KEY, 'Content-Type': 'application/json' };
async function api(fn, params, body) {
  const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/${fn}?` + new URLSearchParams(params), body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(`${fn}/${params.action}: ` + (j.error || ('HTTP ' + res.status)));
  return j;
}

/* ── 대시보드 js를 가짜 DOM 위에 로드 (test/run.mjs와 같은 방식) ── */
const el = () => ({ style: {}, dataset: {}, value: '', textContent: '', innerHTML: '', children: [], disabled: false,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, insertAdjacentHTML() {}, focus() {}, getContext: () => ({}), closest: () => null, getBoundingClientRect: () => ({}), click() {}, scrollIntoView() {} });
const els = {};
const document = { getElementById: id => els[id] || (els[id] = el()), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => el(), activeElement: null, body: el() };
const store = {};
const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const window = { addEventListener() {}, innerWidth: 1280, scrollY: 0, scrollTo() {}, DASH_CFG: {}, localStorage, location: { reload() {} } };
const ctx = { window, document, localStorage, console: { log() {}, warn() {}, error() {} }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  URLSearchParams, URL, Intl, FormData, fetch: async () => { throw new Error('headless: no network in page code'); }, confirm: () => true, prompt: () => null, alert() {}, Image: class {}, FileReader: class {}, Blob: class {}, navigator: {} };
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
const idx = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const files = [...idx.matchAll(/<script src="\.\/(js\/[^"?]+)/g)].map(m => m[1]);   // ?v= 캐시 스탬프 제외
vm.runInContext(files.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n'), ctx, { filename: 'dashboard.js' });
const g = name => vm.runInContext(name, ctx);

/* ── 데이터: 테스트 소재·판정·등록 기록·상품·썸네일(형식) ── */
process.stdout.write('📥 데이터 수집 중… ');
const [data, stRows, cre, prods] = await Promise.all([
  api('meta-ads', { action: 'testads' }), api('meta-ads', { action: 'state_list' }),
  api('meta-upload', { action: 'creatives_list', status: 'ad_created', limit: 500 }), api('cafe24-perf', { action: 'products' }),
]);
const setIds = [...new Set((data.ads || []).map(a => a.adset_id).filter(Boolean))];
const thumbs = {}, kinds = [];
for (let i = 0; i < setIds.length; i += 100) {
  const r = await api('meta-ads', { action: 'creatives', set_ids: setIds.slice(i, i + 100).join(',') });
  (r.ads || []).forEach(a => { thumbs[a.id] = a.image || a.thumb || ''; kinds.push([String(a.id), !!a.is_video]); });
}
console.log(`소재 ${(data.ads || []).length} · 판정 ${(stRows || []).length} · 등록 기록 ${(cre.rows || []).length} · 상품 ${(prods.rows || []).length} · 썸네일 ${Object.keys(thumbs).length}`);
const inject = { data, stRows: Array.isArray(stRows) ? stRows : [], cre: (cre.rows || []).filter(r => r.ad_id), prods: (prods.rows || []).filter(p => p.name && p.price > 0).map(p => ({ no: p.product_no, name: p.name, price: p.price, supply: p.supply_price || 0 })), kinds, thumbs };
ctx.__in = inject;
vm.runInContext(`
  admgr.test.data = __in.data; admgr.test.state = new Map(__in.stRows.map(r => [r.ad_id, r])); admgr.test.loaded = true; admgr.test.filter = 'all'; admgr.test.showHidden = false; admgr.q = '';
  admgr.test.creatives = new Map(__in.cre.map(r => [String(r.ad_id), r])); admgr.products = __in.prods; admgr.test.kinds = new Map(__in.kinds); admgr.test.thumbs = __in.thumbs;
`, ctx);
const [todoRes, aiRes] = await Promise.all([api('client-log', { action: 'state_get', key: 'test_todo' }).catch(() => ({})), api('client-log', { action: 'state_get', key: 'test_report_ai' }).catch(() => ({}))]);
ctx.__todo = todoRes.data && Array.isArray(todoRes.data.items) ? todoRes.data.items : [];
ctx.__ai = aiRes.data && aiRes.data.text ? aiRes.data : null;
ctx.__days = days;
const out = vm.runInContext(`(() => {
  const vis = admgrTestRowSets().vis, today = todayStr(0);
  const rep = admgrReportBuild(vis, __days, today, { ai: __ai, kinds: admgr.test.kinds });
  rep.todoSaved = __todo; const S = admgrReportSummary(rep); rep.todo = { items: S.todo, prev: S.prev };
  const ads = [...rep.cmp.off.items.map(x => ({ ...x, g: 'off' })), ...rep.cmp.good.items.map(x => ({ ...x, g: 'good' }))]
    .map(x => ({ id: x.a.id, name: x.a.adset_name, group: x.g, thumb: admgr.test.thumbs[x.a.id] || '', fmt: x.f.fmt, tag: x.f.tag, diag: x.f.diag.label, roas: +x.f.roas.toFixed(2), purchases: x.a.purchases || 0, spend: Math.round(x.a.spend || 0), ctr: x.f.ctr, ts: x.f.ts }));
  return { from: rep.from, to: rep.to, text: admgrReportText({ ...rep, ai: null }), summary: admgrReportText(rep, 'summary'), ads, todo: rep.todo.items.map(({ carried, ...x }) => x), off: rep.cmp.off.n, good: rep.cmp.good.n };
})()`, ctx);
console.log(`📋 리포트 ${out.from}~${out.to} (${days}일) — OFF ${out.off} · 우수 ${out.good} · 할 일 ${out.todo.length}`);
const cur = await api('client-log', { action: 'state_get', key: 'test_report' });
await api('client-log', { action: 'state_set' }, { key: 'test_report', base: cur.ver || null, data: { from: out.from, to: out.to, days, at: new Date().toISOString(), text: out.text, ads: out.ads } });
// 할 일 저장본 갱신 (addedAt 기록 → 다음 주 '지난주 할 일' 집계) — 대시보드 admgrTodoSave와 같은 규칙
{
  const t = await api('client-log', { action: 'state_get', key: 'test_todo' });
  const m = new Map(((t.data && t.data.items) || []).map(x => [x.key, x]));
  out.todo.forEach(x => { const o = m.get(x.key); m.set(x.key, { key: x.key, name: x.name, text: x.text, kind: x.kind, why: x.why || '', done: o ? !!o.done : false, doneAt: o ? (o.doneAt || null) : null, doneBy: o ? (o.doneBy || '') : '', addedAt: (o && o.addedAt) || x.addedAt }); });   // 완료 표시는 서버값 그대로 — 자동 실행이 사람 체크를 지우지 않게
  await api('client-log', { action: 'state_set' }, { key: 'test_todo', base: t.ver || null, data: { items: [...m.values()] } });
}
console.log('✅ 테스트 리포트 저장 → AI 태그·해석 시작');
const r = spawnSync(process.execPath, [path.join(root, 'scripts/test-insight.mjs')], { stdio: 'inherit', cwd: root });

/* ── 베스트 소재 리포트 (7일) — 같은 vm 위에서. 순이익(반품률 60일)·추세(스냅샷 8일)·테스트 리포트가 단 AI 태그 재사용 ── */
try {
  process.stdout.write('📥 베스트 데이터 수집 중… ');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const shift = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const bd = 7, from = shift(today, -(bd - 1)), prevFrom = shift(from, -bd);
  const bestRows = await api('meta-ads', { action: 'best_list' });
  const bestSets = [...new Set((Array.isArray(bestRows) ? bestRows : []).map(r => r.adset_id))];
  const bestAds = [];
  for (let i = 0; i < bestSets.length; i += 100) { const rr = await api('meta-ads', { action: 'creatives', set_ids: bestSets.slice(i, i + 100).join(',') }); bestAds.push(...(rr.ads || [])); }
  const [dayRes, trendRes, nr, tagRes, todoRes, aiRes] = await Promise.all([
    api('meta-ads', { action: 'daystats', d1: from, d0: prevFrom }), api('meta-ads', { action: 'daystats', since: shift(today, -8) }),
    api('cafe24-perf', { action: 'netreturns', start_date: shift(today, -60), end_date: today }).catch(e => (console.log('(반품률 없음: ' + e.message + ')'), null)),
    api('client-log', { action: 'state_get', key: 'test_report_ai' }).catch(() => ({})), api('client-log', { action: 'state_get', key: 'best_todo' }).catch(() => ({})), api('client-log', { action: 'state_get', key: 'best_report_ai' }).catch(() => ({})),
  ]);
  console.log(`베스트 세트 ${bestSets.length} · 소재 ${bestAds.length} · 반품률 ${nr ? (nr.rows || []).length : 0}개 상품`);
  ctx.__b = { rows: Array.isArray(bestRows) ? bestRows : [], ads: bestAds, day: dayRes.rows || [], trend: trendRes.rows || [], nr: nr ? (nr.rows || []) : null, nrTotal: nr && nr.totals ? nr.totals.net_return_rate : null,
    tags: tagRes.data && tagRes.data.tags || null, todo: todoRes.data && Array.isArray(todoRes.data.items) ? todoRes.data.items : [], ai: aiRes.data && aiRes.data.text ? aiRes.data : null, days: bd, today };
  const bo = vm.runInContext(`(() => {
    admgr.best.rows = __b.rows; admgr.best.ads = __b.ads; admgr.best.loaded = true;
    if (__b.nr) { admgr.best.nr = new Map(__b.nr.map(x => [x.product_no, x])); admgr.best.nrTotal = __b.nrTotal; admgr.best.nrDay = __b.today; }
    admgr.test.trend = new Map(); __b.trend.forEach(r => (admgr.test.trend.get(r.ad_id) || admgr.test.trend.set(r.ad_id, []).get(r.ad_id)).push(r)); admgr.test.trendDay = __b.today;
    const thumbs = {}; __b.ads.forEach(a => { thumbs[a.id] = a.image || a.thumb || ''; });
    const rep = admgrBestReportBuild({ tests: admgrTestRowSets().vis, best: __b.rows, bestAds: __b.ads, dayRows: __b.day, cre: admgr.test.creatives, products: admgr.products, judge: admgrTJudge, pf: admgrProfit, trend: a => admgrTrend(a), aiTags: __b.tags, thumbs }, __b.days, __b.today);
    rep.todoSaved = __b.todo; rep.todo = admgrTodoMerge(rep.todoRule, rep.todoSaved, rep.to);
    return { from: rep.from, to: rep.to, text: admgrBestReportText(rep, null), todo: rep.todo.items.map(({ carried, ...x }) => x), n: rep.S.best.n, profit: rep.profit.cur, tired: rep.alerts.tired.length };
  })()`, ctx);
  console.log(`📊 베스트 리포트 ${bo.from}~${bo.to} — 소재 ${bo.n} · 기간 순이익 ${Math.round(bo.profit).toLocaleString()}원 · 식음 ${bo.tired}`);
  const cur2 = await api('client-log', { action: 'state_get', key: 'best_report' });
  await api('client-log', { action: 'state_set' }, { key: 'best_report', base: cur2.ver || null, data: { from: bo.from, to: bo.to, days: bd, at: new Date().toISOString(), text: bo.text } });
  const t2 = await api('client-log', { action: 'state_get', key: 'best_todo' });
  const m2 = new Map(((t2.data && t2.data.items) || []).map(x => [x.key, x]));
  bo.todo.forEach(x => { const o = m2.get(x.key); m2.set(x.key, { key: x.key, name: x.name, text: x.text, kind: x.kind, why: x.why || '', done: o ? !!o.done : false, doneAt: o ? (o.doneAt || null) : null, doneBy: o ? (o.doneBy || '') : '', addedAt: (o && o.addedAt) || x.addedAt }); });
  await api('client-log', { action: 'state_set' }, { key: 'best_todo', base: t2.ver || null, data: { items: [...m2.values()] } });
  console.log('✅ 베스트 리포트 저장 → AI 해석 시작');
  const r2 = spawnSync(process.execPath, [path.join(root, 'scripts/weekly-insight.mjs')], { stdio: 'inherit', cwd: root });
  process.exit((r.status || 0) || (r2.status || 0));
} catch (e) { console.error('❌ 베스트 리포트 실패: ' + e.message); process.exit(r.status || 1); }
