// 핵심 흐름 자동 검사 — `node test/run.mjs` (2026-09-08 1단계)
//   ① CSV 업로드(Meta 내보내기 파싱·소재 자동 생성·같은 날짜 덮어쓰기)
//   ② 소재 등록(파일명 → 카페24 상품 매칭: 자동/중복/실패/기억한 선택)
//   ③ 판매 성과(행 계산·반품 사유 분류·동반 반품 귀속)
//   + 유틸(집계·이스케이프·URL 가드)
// 브라우저 없이 돌린다: index.html의 <script>를 가짜 document/localStorage 위에서 로드.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const src = loadSource();

/* ── 가짜 DOM: 렌더 함수가 innerHTML을 써도 죽지 않을 만큼만 ── */
const els = {};
const el = () => ({ style: {}, dataset: {}, value: '', textContent: '', innerHTML: '', children: [], disabled: false,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, insertAdjacentHTML() {}, focus() {},
  getContext: () => ({}), setSelectionRange() {}, closest: () => null, getBoundingClientRect: () => ({}), click() {} });
const document = { getElementById: id => els[id] || (els[id] = el()), querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, createElement: () => el(), activeElement: null, body: el() };
const store = {};
const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const window = { addEventListener() {}, innerWidth: 1200, scrollY: 0, scrollTo() {}, DASH_CFG: {}, localStorage, location: { reload() {} } };
const ctx = { window, document, localStorage, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
  URLSearchParams, URL, Intl, FormData, fetch: async () => { throw new Error('테스트에선 네트워크 없음'); },
  confirm: () => true, prompt: () => null, alert() {}, Image: class {}, FileReader: class {}, Blob: class {}, navigator: {} };
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'index.html' });
const g = name => vm.runInContext(name, ctx);   // 최상위 const/let/function 꺼내기

let n = 0;
const test = (name, fn) => { try { fn(); n++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name); throw e; } };

console.log('유틸');
test('esc: HTML 특수문자 5종', () => assert.equal(g('esc')(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;'));
test('safeUrl: http(s)만 통과', () => { const f = g('safeUrl'); assert.equal(f('https://a.b/c'), 'https://a.b/c'); assert.equal(f('javascript:alert(1)'), ''); assert.equal(f(''), ''); });
test('aggRows/derive: CTR·CPC·CPA·ROAS', () => {
  const a = g('aggRows')([{ spend: 1000, imp: 200, clicks: 10, purch: 2, value: 5000 }, { spend: 1000, imp: 0, clicks: 0, purch: 0, value: 0 }]);
  assert.equal(a.spend, 2000); assert.equal(a.ctr, 5); assert.equal(a.cpc, 200); assert.equal(a.cpa, 1000); assert.equal(a.roas, 2.5);
});

console.log('서버 호출 (sbCall) — 오류가 항상 사람이 읽는 문장으로');
{
  const sbCall = g('sbCall');
  window.DASH_CFG = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' };
  const respond = (status, text) => { ctx.fetch = async () => ({ ok: status < 300, status, text: async () => text }); };
  const rejects = async (fn, re) => { let m = ''; try { await fn(); } catch (e) { m = e.message; } assert.match(m, re); };
  await (async () => {
    respond(200, '{"rows":[1]}'); assert.equal(JSON.stringify(await sbCall('f', { a: 1 })), '{"rows":[1]}');
    respond(200, '<html>maintenance</html>'); await rejects(() => sbCall('f', {}), /읽을 수 없어요/);          // 2xx인데 JSON 아님 = 오류
    respond(200, '{"error":"PIN이 틀렸어요"}'); await rejects(() => sbCall('f', {}), /PIN이 틀렸어요/);         // 우리 함수 오류 우선
    respond(404, '{"code":"NOT_FOUND","message":"Requested function was not found"}'); await rejects(() => sbCall('meta-x', {}), /'meta-x'가 아직 배포되지/);
    respond(401, '{"message":"Invalid JWT"}'); await rejects(() => sbCall('f', {}), /로그인이 필요해요/);
    respond(502, ''); await rejects(() => sbCall('f', {}), /서버 오류 \(HTTP 502\)/);
    ctx.fetch = async () => { throw new TypeError('Failed to fetch'); }; await rejects(() => sbCall('f', {}), /연결할 수 없어요 \(Failed to fetch\)/);
    n++; console.log('  ✓ sbCall: 정상 JSON·HTML 응답·함수 오류·미배포 404·401·5xx·네트워크 끊김');
  })();
  ctx.fetch = async () => { throw new Error('테스트에선 네트워크 없음'); };
}

console.log('① CSV 업로드');
test('Meta CSV: 따옴표·쉼표·BOM, 같은 소재·같은 날 합산, 소재 자동 생성', () => {
  vm.runInContext("creatives = []; records = [];", ctx);
  const csv = '﻿광고 이름,일,지출 금액 (KRW),노출,링크 클릭,구매,구매 전환값\n'
    + '"클레르, 블라우스 A",2026-09-01,"1,000",100,10,1,50000\n'
    + '내티 원피스 B,2026-09-01,500,50,5,0,0\n'
    + '"클레르, 블라우스 A",2026-09-01,200,20,2,0,0\n';
  const res = g('parseMetaCSV')(csv);
  assert.equal(res.newCre, 2); assert.equal(res.rows, 2);
  const recs = g('records'), cres = g('creatives');
  const a = cres.find(c => c.name === '클레르, 블라우스 A');
  assert.ok(a); assert.equal(a.reg_date, '2026-09-01');
  const r = recs.find(x => x.cid === a.id);
  assert.equal(r.spend, 1200); assert.equal(r.imp, 120); assert.equal(r.clicks, 12); assert.equal(r.purch, 1); assert.equal(r.value, 50000);
});
test('Meta CSV: 다시 올리면 덮어쓰기 (중복 없음)', () => {
  const csv = '광고 이름,일,지출 금액,노출,링크 클릭,구매,구매 전환값\n내티 원피스 B,2026-09-01,900,90,9,1,10000\n';
  const res = g('parseMetaCSV')(csv);
  assert.equal(res.newCre, 0);
  const recs = g('records');
  assert.equal(recs.length, 2);
  const b = g('creatives').find(c => c.name === '내티 원피스 B');
  assert.equal(recs.find(x => x.cid === b.id).spend, 900);
});
test('CSV: 영문 헤더 + 탭 구분(TSV) 자동 감지', () => {
  const tsv = 'Ad name\tDay\tAmount spent\tImpressions\tLink clicks\tPurchases\tPurchases conversion value\nEN Ad\t2026-09-02\t300\t30\t3\t0\t0\n';
  const res = g('parseMetaCSV')(tsv);
  assert.equal(res.newCre, 1);
});
test("CSV: '광고 이름' 열 없으면 명확한 오류", () => {
  assert.throws(() => g('parseMetaCSV')('a,b\n1,2\n'), /광고 이름/);
});

console.log('② 소재 등록 — 파일명 → 상품 매칭');
{
  const reg = g('reg'); const coreName = g('coreName'), normKey = g('normKey');
  reg.products = [
    { product_no: 1, name: '(자체제작,2사이즈) 클레르 블라우스 (3 colors)' },
    { product_no: 2, name: '내티 원피스' }, { product_no: 3, name: '[리오더] 내티 원피스' },
    { product_no: 4, name: '모튼 가디건' },
  ].map(p => ({ ...p, core: coreName(p.name), key: normKey(p.name) }));
  reg.aliases = [{ core_name: '내티 원피스', product_no: 3 }];
  const regMatch = g('regMatch');
  test('fileCore: 괄호·언더바 뒤·날짜 제거', () => assert.equal(g('fileCore')('클레르 블라우스_스토리 260901 v2.mp4'), '클레르 블라우스'));
  test('정확히 1개 → 자동 선택', () => { const m = regMatch('클레르 블라우스_릴스.mp4'); assert.equal(m.pick.product_no, 1); assert.equal(m.why, 'auto'); assert.equal(m.multi, false); });
  test('같은 이름 2개 → 선택 필요, 지난번 선택(alias)을 기본으로', () => { const m = regMatch('내티 원피스_스토리.jpg'); assert.equal(m.multi, true); assert.equal(m.why, 'alias'); assert.equal(m.pick.product_no, 3); assert.equal(m.cands.length, 2); });
  test('매칭 실패 → 후보 없음·pick null', () => { const m = regMatch('없는상품.jpg'); assert.equal(m.pick, null); assert.equal(m.why, 'none'); });
  test('부분 일치 → 후보 제시', () => { const m = regMatch('모튼 가디건 착용컷.jpg'); assert.equal(m.pick, null); assert.ok(m.cands.some(p => p.product_no === 4)); });
}

console.log('③ 판매 성과');
test('perfRowsFrom: 순판매량·안분 금액·반품률·원가 맵', () => {
  const r = g('perfRowsFrom')([
    { product_no: 1, product_name: ' 클레르 블라우스 ', price: 10000, supply_price: 4000, paid_qty: 10, cancel_qty: 2, order_amount: 100000 },
    { product_no: 2, product_name: '공급가 없음', price: 5000, supply_price: 0, paid_qty: 0, cancel_qty: 0, order_amount: 0 },
  ]);
  const a = r.salesData[0];
  assert.equal(a.productName, '클레르 블라우스'); assert.equal(a.salesQty, 8); assert.equal(a.salesTotal, 80000); assert.equal(a.returnRate, 20); assert.equal(a.rank, 1);
  assert.equal(r.salesData[1].salesTotal, 0); assert.equal(r.salesData[1].returnRate, 0);
  assert.equal(JSON.stringify(r.costMap['클레르 블라우스']), JSON.stringify({ supplyCost: 4000, salePrice: 10000 }));   // vm 경계 넘으면 deepEqual이 프로토타입 차이로 실패
  assert.equal(r.mappedCost, 1);
});
test('rrCat: 반품 사유 분류 (불량 > 사이즈 > 변심 순 우선)', () => {
  const rrCat = g('rrCat'), rrNorm = g('rrNorm');
  assert.equal(rrCat(rrNorm('싸이즈가 작아요 ㅠㅠ')), '사이즈·핏');
  assert.equal(rrCat(rrNorm('실밥이 튿어져서 사이즈도 안맞음')), '불량·하자');
  assert.equal(rrCat(rrNorm('그냥 마음에 안들어요')), '단순 변심');
  assert.equal(rrCat(rrNorm('')), '사유 미기재');
});
test('rrAssignShares: 단독 반품=sole, 동반 반품은 상품명 언급으로 귀속', () => {
  const items = [
    { claim: 'c1', product_no: 1, product_name: '내티 원피스', request: '길어요' },
    { claim: 'c2', product_no: 1, product_name: '내티 원피스', request: '내티 원피스는 색이 달라요' },
    { claim: 'c2', product_no: 2, product_name: '클레르 블라우스', request: '내티 원피스는 색이 달라요' },
    { claim: 'c3', product_no: 1, product_name: '내티 원피스', request: '별로예요' },
    { claim: 'c3', product_no: 2, product_name: '클레르 블라우스', request: '별로예요' },
  ];
  g('rrAssignShares')(items);
  assert.equal(items[0].share, 'sole');
  assert.equal(items[1].share, 'sole'); assert.equal(items[2].share, 'other');
  assert.equal(items[3].share, 'shared'); assert.equal(items[4].share, 'shared');
});
test('renderPerfResult: 합계 표가 그려진다', () => {
  const st = g('store'); const built = g('perfRowsFrom')([{ product_no: 1, product_name: 'A', price: 10000, supply_price: 4000, paid_qty: 10, cancel_qty: 2, order_amount: 100000 }]);
  st.salesData = built.salesData; st.costMap = built.costMap; st.netReturns = new Map(); st.netTotals = null; st.prevRanks = null;
  els.perfDateStart = { ...el(), value: '2026-09-01' }; els.perfDateEnd = { ...el(), value: '2026-09-07' };
  g('renderPerfResult')();
  const html = els['perf-result'].innerHTML;
  assert.ok(html.includes('80,000원'), '순매출'); assert.ok(html.includes('20.0%'), '취소반품률'); assert.ok(html.includes('A'));
});

console.log(`\n모두 통과 (${n}개)`);

function loadSource() {
  // 분리 전(단일 index.html) / 분리 후(js/*.js) 둘 다 지원
  const idx = fs.readFileSync(new URL('index.html', root), 'utf8');
  const files = [...idx.matchAll(/<script src="\.\/(js\/[^"]+)"><\/script>/g)].map(m => m[1]);
  if (files.length) return files.map(f => fs.readFileSync(new URL(f, root), 'utf8')).join('\n');
  return idx.slice(idx.lastIndexOf('<script>') + 8, idx.lastIndexOf('</script>'));
}
