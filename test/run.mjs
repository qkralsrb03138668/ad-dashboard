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
  URLSearchParams, URL, Intl, FormData, AbortSignal, fetch: async () => { throw new Error('테스트에선 네트워크 없음'); },   // AbortSignal: sbCall 2분 타임아웃(2026-10-26)
  confirm: () => true, prompt: () => null, alert() {}, Image: class {}, FileReader: class {}, Blob: class {}, navigator: {} };
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'index.html' });
const g = name => vm.runInContext(name, ctx);   // 최상위 const/let/function 꺼내기

let n = 0;
const test = (name, fn) => { try { fn(); n++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name); throw e; } };

console.log('유틸');
test('whoName: 이름 우선, 없으면 접근키→관리자 / 이메일 앞 / dnrb: 제거', () => {
  const f = g('whoName'); assert.equal(f('박민규', 'dnrb:pmk'), '박민규'); assert.equal(f(null, 'dash-key'), '관리자');
  assert.equal(f('', 'kim@x.com'), 'kim'); assert.equal(f(undefined, 'dnrb:5637ehgml'), '5637ehgml'); assert.equal(f(null, null), '');
});
test('dnrbCan: SSO 아니면 전부 허용, perms 있으면 actions만', () => {
  const f = g('dnrbCan'); localStorage.removeItem('dnrb_sso'); assert.equal(f('budget'), true);
  localStorage.setItem('dnrb_sso', JSON.stringify({ token: 't', exp: Date.now() + 60000, perms: { menus: ['home'], actions: ['creative'] } }));
  assert.equal(f('creative'), true); assert.equal(f('budget'), false); localStorage.removeItem('dnrb_sso');
});
test('dnrbSession: 만료 토큰 거부, 유효 토큰 통과', () => {
  const f = g('dnrbSession'); localStorage.setItem('dnrb_sso', JSON.stringify({ token: 't', exp: Date.now() - 1 })); assert.equal(f(), null);
  localStorage.setItem('dnrb_sso', JSON.stringify({ token: 't', id: 'u', role: 'staff', exp: Date.now() + 60000 })); assert.equal(f().id, 'u'); localStorage.removeItem('dnrb_sso');
});
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
  await (async () => {   // 워크스페이스(SSO) 세션 — 우리 서버 응답과 워크스페이스 verify 응답을 따로 흉내
    const sso = () => localStorage.setItem('dnrb_sso', JSON.stringify({ token: 't', id: 'u', role: 'staff', exp: Date.now() + 60000 }));
    const two = (ours, ws) => { ctx.fetch = async (url) => { const [st, tx] = String(url).includes('/functions/v1/auth') ? ws : ours; return { ok: st < 300, status: st, text: async () => tx, json: async () => JSON.parse(tx) }; }; };
    sso(); two([403, '{"error":"이 화면을 볼 권한이 없습니다"}'], [200, '{}']);
    await rejects(() => sbCall('meta-ads', {}), /권한이 없습니다/); assert.ok(localStorage.getItem('dnrb_sso'));          // 403 = 그 동작만 거절, 로그인은 그대로 (9/22 사고)
    two([401, '{"error":"로그인이 필요합니다"}'], [200, '{"id":"u"}']);
    await rejects(() => sbCall('meta-ads', {}), /잠시 안 됐어요/); assert.ok(localStorage.getItem('dnrb_sso'));           // 워크스페이스는 유효하다고 함 → 세션 유지
    two([401, '{"error":"로그인이 필요합니다"}'], [503, '']);
    await rejects(() => sbCall('meta-ads', {}), /잠시 안 됐어요/); assert.ok(localStorage.getItem('dnrb_sso'));           // 워크스페이스 장애 → 세션 유지
    two([401, '{"error":"로그인이 필요합니다"}'], [401, '{"error":"유효하지 않은 토큰"}']);
    await rejects(() => sbCall('meta-ads', {}), /워크스페이스 로그인이 만료/); assert.equal(localStorage.getItem('dnrb_sso'), null);   // 진짜 거절일 때만 폐기 + 다시 들어오는 길 안내
    localStorage.setItem('dnrb_sso', JSON.stringify({ token: 't', exp: Date.now() - 1 }));
    await rejects(() => sbCall('meta-ads', {}), /워크스페이스에서 광고 대시보드 메뉴/);                                     // 화면 켜둔 채 7일 만료
    // 경합(2026-10-27): 요청 보낼 땐 세션 없음 → 응답 401이 올 때 유효한 새 세션이 저장돼 있음 → 지우지 말고 그 토큰으로 한 번 더
    localStorage.removeItem('dnrb_sso'); let raceCalls = 0;
    ctx.fetch = async (url, init) => { raceCalls++; if (raceCalls === 1) { localStorage.setItem('dnrb_sso', JSON.stringify({ token: 'fresh', id: 'u', role: 'staff', exp: Date.now() + 60000 })); return { ok: false, status: 401, text: async () => '{"error":"로그인이 필요합니다"}' }; }
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, tok: init.headers['x-dnrb-token'] }) }; };
    const r = await sbCall('meta-ads', {}); assert.equal(r.tok + ':' + raceCalls, 'fresh:2'); assert.ok(localStorage.getItem('dnrb_sso'));
    // 구조적 방지: 로그인 확인 중(AUTH.initializing)엔 요청을 보내지 않고 기다렸다가, 끝난 뒤 그때 저장된 세션 토큰으로 보낸다
    localStorage.removeItem('dnrb_sso'); vm.runInContext("AUTH.initializing = true;", ctx); let sentWith = null;
    ctx.fetch = async (url, init) => { sentWith = init.headers['x-dnrb-token'] || null; return { ok: true, status: 200, text: async () => '{"ok":true}' }; };
    setTimeout(() => { localStorage.setItem('dnrb_sso', JSON.stringify({ token: 'late', id: 'u', role: 'staff', exp: Date.now() + 60000 })); vm.runInContext("AUTH.initializing = false;", ctx); }, 250);
    await sbCall('meta-ads', {}); assert.equal(sentWith, 'late');
    localStorage.removeItem('dnrb_sso');
    localStorage.removeItem('dnrb_sso');
    n++; console.log('  ✓ sbCall(SSO): 403은 세션 유지 · 401은 워크스페이스에 다시 확인 후에만 폐기 · 만료 안내');
    // 직접 로그인 세션 만료(2026-10-06): 세션 비우고 로그인 화면 — 로그인 화면의 status(auth-admin) 호출은 다시 로그인 화면을 부르지 않는다
    const AUTH = g('AUTH'); let signedOut = 0, scope = null, refreshOk = false;
    AUTH.sb = { auth: { signOut: async (o) => { signedOut++; scope = o && o.scope; }, refreshSession: async () => ({ data: { session: refreshOk ? { access_token: 'new' } : null } }) } };
    AUTH.session = { access_token: 'old' };
    two([401, '{"error":"로그인이 필요합니다"}'], [401, '{"error":"로그인이 필요합니다"}']);   // (two의 URL 분기가 auth-admin도 '워크스페이스'로 잡으므로 같은 401로)
    await rejects(() => sbCall('meta-ads', {}), /로그인이 만료됐어요/); assert.equal(AUTH.session, null); assert.equal(signedOut, 1); assert.equal(scope, 'local');   // 갱신 실패 → 이 기기만 로그아웃
    refreshOk = true; AUTH.session = { access_token: 'old' }; let calls = 0;
    ctx.fetch = async (url, init) => { calls++; const ok = init.headers.Authorization === 'Bearer new'; return { ok, status: ok ? 200 : 401, text: async () => ok ? '{"fine":1}' : '{"error":"로그인이 필요합니다"}', json: async () => ({}) }; };
    assert.equal((await sbCall('meta-ads', {})).fine, 1); assert.equal(calls, 2); assert.equal(signedOut, 1);   // 갱신 성공 → 새 토큰으로 1회 재시도, 로그아웃 없음
    two([401, '{"error":"로그인이 필요합니다"}'], [401, '{"error":"로그인이 필요합니다"}']); AUTH.session = { access_token: 'old' }; refreshOk = false;
    await rejects(() => sbCall('auth-admin', { action: 'status' }), /로그인이 필요합니다/); assert.equal(signedOut, 1); AUTH.session = null;   // 되돌이 없음(세션 처리 안 함, 문장만)
    AUTH.sb = null;
    n++; console.log('  ✓ sbCall(직접 로그인 만료): 세션 비움·로그아웃 1회·auth-admin은 제외');
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
  test('상품 고정 문구: 저장본 있으면 채우고, 이미 문구 있거나 상품 없으면 건너뜀', () => {
    const apply = g('regApplySavedCopies');
    const rows = [
      { product: { product_no: 1 }, url: 'https://x/1', text: null },
      { product: { product_no: 2 }, url: 'https://x/2', text: null },
      { product: { product_no: 1 }, url: 'https://x/1', text: { message: '이미 있음' } },
      { product: null, text: null },
    ];
    const copies = new Map([[1, { text: { message: '저장 본문', cta: 'SHOP_NOW' } }]]);
    assert.equal(apply(rows, copies), 1);
    assert.equal(rows[0].text.message, '저장 본문'); assert.equal(rows[0].text.link, 'https://x/1'); assert.equal(rows[0].text.cta, 'SHOP_NOW'); assert.equal(rows[0].textFrom, 'saved');
    assert.equal(rows[1].text, null); assert.equal(rows[2].text.message, '이미 있음'); assert.equal(rows[3].text, null);
  });
  test('상품 먼저 고르기 파일명: 상품명_R1|P1_마진(천원 내림)_YYMMDD_test.확장자', () => {
    const fn = g('regPresetFileName'); const pr = { core: '레이스 클레르 블라우스', price: 56000, supply_price: 28000 };
    assert.equal(fn(pr, 'video', 1, 'mp4', '2026-09-11'), '레이스 클레르 블라우스_R1_28_260911_test.mp4');
    assert.equal(fn({ ...pr, price: 58000, supply_price: 29500 }, 'image', 3, 'JPG', '2026-09-11'), '레이스 클레르 블라우스_P3_28_260911_test.jpg');
    assert.equal(fn(pr, 'video', 3, 'mov', '2026-09-11', '착용컷'), '레이스 클레르 블라우스_R3_착용컷_28_260911_test.mov');
    assert.equal(fn(pr, 'video', 4, 'mp4', '2026-09-11', ' 다나 대표/인스타 '), '레이스 클레르 블라우스_R4_다나 대표 인스타_28_260911_test.mp4');
    const ver = g('regVerTag');
    assert.equal(ver('(2사이즈,여름ver.) 썸머 클레르 블라우스 (4 colors)'), '여름ver');
    assert.equal(ver('[자체제작] (봄.가을VER.) 뉴 내티 원피스 (2 colors)'), '봄.가을ver');
    assert.equal(ver('(1114 기모ver) 클레르 블라우스'), '기모ver');
    assert.equal(ver('(made,high quality) 안스 후드 집업 (3 colors)'), '');
    assert.equal(ver('포춘 오픈링 (silver)'), '');
    assert.equal(ver('(봄/가을VER.) 클래식 스탠다드 JK (3 colors)'), '봄.가을ver');
    assert.equal(ver('(가볍고시원,투포켓ver2) 스티치 원피스 (3 colors)'), '투포켓ver2');
    assert.equal(fn({ core: '썸머 클레르 블라우스', name: '(2사이즈,여름ver.) 썸머 클레르 블라우스 (4 colors)', price: 50000, supply_price: 20000 }, 'image', 1, 'jpg', '2026-09-11'), '여름ver 썸머 클레르 블라우스_P1_30_260911_test.jpg');
  });
  test('맥 파일명(NFD 자모 분리)도 자동 매칭', () => { const m = regMatch('클레르 블라우스_릴스.mp4'.normalize('NFD')); assert.equal(m.pick && m.pick.product_no, 1); assert.equal(m.why, 'auto'); });
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

console.log('④ 체크보드 계정 공유');
{
  const window_ = window; window_.DASH_CFG = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' };
  vm.runInContext("AUTH.me = { email: 'm@x', name: '마케터', role: 'marketer' };", ctx);
  const calls = [];
  const serve = (res) => { ctx.fetch = async (url, init) => { calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null }); return { ok: true, status: 200, text: async () => JSON.stringify(res) }; }; };
  await (async () => {
    serve({ data: { types: ['릴스'], products: [{ id: 'p1', name: '서버 상품', cells: {} }] }, ver: 'v1', updated_by: '대표' });
    const changed = await g('ptPull')(true);
    assert.equal(changed, true); assert.equal(g('pt').products[0].name, '서버 상품'); assert.equal(g('ptSrv').ver, 'v1');
    assert.match(calls[0].url, /state_get&key=pt/);
    serve({ ok: true, ver: 'v2' });
    await g('ptPush')();
    assert.equal(calls[1].body.base, 'v1'); assert.equal(calls[1].body.key, 'pt'); assert.equal(g('ptSrv').ver, 'v2');
    serve({ conflict: true, data: { types: ['릴스'], products: [] }, ver: 'v3', updated_by: '대표' });
    await g('ptPush')();
    assert.equal(g('pt').products.length, 0); assert.equal(g('ptSrv').ver, 'v3');   // 충돌 → 서버 최신본으로 교체, 덮어쓰지 않음
    n++; console.log('  ✓ ptPull/ptPush: 서버 우선 · 저장 시 base 전송 · 충돌이면 최신본 교체');
  })();
  await (async () => {
    vm.runInContext("pt = ptSampleData();", ctx); calls.length = 0; serve({ ok: true, ver: 'vx' });
    await g('ptPush')(); assert.equal(calls.length, 0);   // 예시 보드는 서버로 안 감
    n++; console.log('  ✓ ptPush: 예시 보드(sample)는 전송하지 않음');
  })();
  test('ptSave: 예시 표시(sample) 제거 + 서버 전송 예약', () => {
    vm.runInContext("pt = ptSampleData();", ctx); assert.equal(g('pt').sample, true);
    g('ptSave')(); assert.equal(g('pt').sample, undefined); assert.ok(g('ptSrv').timer);
  });
  ctx.fetch = async () => { throw new Error('테스트에선 네트워크 없음'); };
}

test('admgrRepostPlan: 사본 세트만 상품명 읽어 업로드 규칙 이름으로 (순번 이어서·마진 지금 가격·옛 이름은 상품 검색)', () => {
  vm.runInContext("admgr.products = [{ no: 1, name: '(자체제작) 루즈핏 니트 (3 colors)', price: 50000, supply: 20000 }, { no: 2, name: '밍크 트임 pt (2 colors)', price: 39000, supply: 15500 }, { no: 3, name: '모튼 가디건 니트 (4 colors)', price: 42000, supply: 18000 }, { no: 4, name: '라이트 모튼 가디건 니트 (3 colors)', price: 39000, supply: 15000 }]; admgrPI = null;", ctx);
  const f = g('admgrRepostPlan');
  const all = [{ id: '1', name: '루즈핏 니트_R3_착용컷_28_250915_test' }, { id: '2', name: '루즈핏 니트_P1_인스타_28_250915_test' }, { id: '9', name: '다른 상품_R7_10_260101_test' }];
  const sets = [
    { id: '11', name: '루즈핏 니트_R2_인스타_25_251003_test - 사본', ads: [{ id: '11a', name: '루즈핏 니트_R2_인스타_25_251003_test' }, { id: '11b', name: '루즈핏 니트_R2_인스타_25_251003_test – 사본' }] },
    { id: '12', name: '루즈핏 니트_R1_25_251001_test – 사본 2', ads: [] },                                  // 소구점 없던 옛 규칙 → '끌올'
    { id: '13', name: '전환_(160이상 추천)밍크 트임 pt (2 colors)_231219 - 사본', is_video: true, ads: [{ id: '13a', name: '밍크 광고' }] },   // 옛 이름 → 상품 목록에서 찾고 R은 영상이라서
    { id: '14', name: '없는 상품_P2_9_250101_test [→CBO4] - 사본', ads: [] },
    { id: '15', name: '전환_(양기모)블린 mtm (2 colors)_231214 - 사본', ads: [] },                                // 옛 이름 + 지금 없는 상품 → 가장 긴 토막
    { id: '16', name: '1113_릴스_모카 니트 22_40,000 - 사본', ads: [] },                                           // 날짜·가격·꼬리 숫자 제거 · '릴스' → R
    { id: '17', name: '0226 모카 가디건 - 그레이 24000 - 사본', ads: [] },                                          // 앞 날짜 · ' - 색상' · 가격 제거
    { id: '18', name: '영상_라이트 모튼 가디건 니트 - 사본', ads: [{ id: '18a', name: '모튼 광고' }] },                   // 상품 2개가 걸림 → 후보 목록, 기본은 긴 이름
  ];
  const plan = f(sets, all, '2026-10-15');
  const by = Object.fromEntries(plan.map(p => [p.id, p]));
  assert.equal(by['11'].to, '루즈핏 니트_R4_인스타_30_261015_test');     // 순번: 계정 최대 R3 다음 · 마진 (50000−20000)/1000
  assert.equal(by['11a'].to + '|' + by['11b'].to, by['11'].to + '|' + by['11'].to);   // 세트 안 광고 전부 세트와 같은 이름
  assert.equal(by['12'].to, '루즈핏 니트_R5_끌올_30_261015_test');       // 같은 상품 두 번째 사본은 R5
  assert.equal(by['13'].to, '밍크 트임 pt_R1_끌올_23_261015_test');       // 전환_… 옛 이름: 상품 검색 · 영상 → R1 · 마진 (39000−15500)/1000=23
  assert.equal(by['13a'].to, by['13'].to);
  assert.equal(by['14'].to, '없는 상품_P3_끌올_9_261015_test');           // 상품 못 찾음 → 예전 마진 유지, 순번은 자기 P2 다음
  assert.equal(by['14'].name, '없는 상품_P3_끌올_9_261015_test [→CBO4]');  // 캠페인 표시는 세트명에만 유지
  assert.ok(by['14'].note.includes('상품 못 찾음'));
  assert.equal(by['15'].to, '블린 mtm_P1_끌올_0_261015_test'); assert.ok(by['15'].note.includes('상품 못 찾음'));
  // 이름이 상품명보다 짧은 옛 세트 (2026-10-27): 약어 풀기(cd→가디건) · 토막이 상품명 안에 → 후보로, 확인 안내
  vm.runInContext("admgr.products.push({ no: 7, name: '(털빠짐X) 리얼 소프트 퍼 가디건 (3 colors)', price: 48000, supply: 23000 }, { no: 8, name: '플랫 루즈핏 블루종 점퍼 (3 colors)', price: 56000, supply: 27000 }); admgrPI = null;", ctx);
  const L2 = Object.fromEntries(f([{ id: '21', name: '[1125]- 리얼 소프트 퍼cd - 사본', ads: [] }, { id: '22', name: '플랫 루즈핏 블루종 2_29_260910 - 사본', ads: [] }], all, '2026-10-27').map(p => [p.id, p]));
  assert.equal(L2['21'].to + '|' + L2['22'].to, '리얼 소프트 퍼 가디건_P1_끌올_25_261027_test|플랫 루즈핏 블루종 점퍼_P1_끌올_29_261027_test');
  assert.ok(L2['21'].note.includes('비슷한 상품') && L2['22'].note.includes('비슷한 상품'));
  assert.equal(by['16'].to, '모카 니트_R1_끌올_0_261015_test');
  assert.equal(by['17'].to, '모카 가디건_P1_끌올_0_261015_test');
  assert.equal(by['18'].to, '라이트 모튼 가디건 니트_R1_끌올_24_261015_test');       // 기본: 긴 이름(라이트 모튼) · 마진 (39000−15000)/1000
  assert.equal(by['18'].cands.map(c => c.no).join(), '4,3');
  const picked = Object.fromEntries(f(sets, all, '2026-10-15', { '18': 3 }).map(p => [p.id, p]));   // 사용자가 '모튼 가디건 니트'를 고르면
  assert.equal(picked['18'].to + '|' + picked['18a'].to, '모튼 가디건 니트_R1_끌올_24_261015_test|모튼 가디건 니트_R1_끌올_24_261015_test');
  assert.equal(plan.length, 12);
});

test('admgrCmp: 꺼진 세트는 정렬과 무관하게 맨 아래', () => {
  const f = g('admgrCmp');
  vm.runInContext("admgr.sort = [{ key: 'spend', dir: -1 }];", ctx);
  const rows = [{ id: '1', status: 'PAUSED', spend: 900, created: '2026-10-01' }, { id: '2', status: 'ACTIVE', spend: 10, created: '2026-10-02' }, { id: '3', spend: 500, created: '2026-10-03' }, { id: '4', status: 'ACTIVE', spend: 300, created: '2026-10-04' }];
  assert.equal(rows.slice().sort(f).map(r => r.id).join(), '4,2,1,3');   // 켜진 것 지출 큰 순 → 꺼진 것(PAUSED·기간 중 게재) 지출 큰 순
  vm.runInContext("admgr.sort = [];", ctx);
  assert.equal(rows.slice().sort(f).map(r => r.id).join(), '4,2,3,1');   // 기본 정렬(최근 생성)도 켜진 것 먼저
});

test('admgrBudgetTotal·알림판: 켜진 세트+CBO 예산 합, 임시 저장 반영, 상한 초과 표시', () => {
  vm.runInContext(`admgr.demo = false; admgr.data = { campaigns: [
    { id: 'c1', name: 'CBO4', status: 'ACTIVE', budget: 130000, adsets: [{ id: 's0', status: 'ACTIVE', budget: 0 }] },
    { id: 'c2', name: '테스트', status: 'ACTIVE', budget: 0, adsets: [{ id: 's1', name: 'a', status: 'ACTIVE', budget: 50000 }, { id: 's2', name: 'b', status: 'PAUSED', budget: 90000 }, { id: 's3', name: 'c', status: 'ACTIVE', budget: 20000 }] },
    { id: 'c3', name: '꺼진CBO', status: 'PAUSED', budget: 500000, adsets: [] } ] };
    for (const k of Object.keys(admgrDraft)) delete admgrDraft[k]; Object.assign(admgrDraft, { s1: 80000, s2: 10000 }); admgrAlert.cfg = { cap: 150000 };`, ctx);
  const B = g('admgrBudgetTotal')(true);
  assert.equal([B.sets, B.cbo, B.total, B.after].join(), '70000,130000,200000,230000');   // 꺼진 세트·캠페인 제외 · 임시 저장은 켜진 s1만(+30000)
  const html = g('admgrAlertPanel')();
  assert.ok(html.includes('켜진 일예산 20만원') && html.includes('상한 초과 +5만'), html);
  vm.runInContext("admgrAlert.cfg = { cap: 0 }; for (const k of Object.keys(admgrDraft)) delete admgrDraft[k];", ctx);
  const h0 = g('admgrAlertPanel')(); assert.ok(!h0.includes('상한 초과') && !h0.includes('· 상한'), h0);   // 상한 0 = 표시도 경고도 없음 ([기준] 버튼 툴팁의 '상한'은 제외)
});

test('admgrPromoCands: 10/28부터 꺼짐(ABO만) → 빈 값 · 켜면 2026-10-26 기준 — 상품 = 7일 100건↑·구매당≤마진35%·3일 추세 OK·우수 2개↑ / 종합 = 세트 30건↑·≤30%', () => {
  assert.equal(g('admgrPromoCands')().ads.length + g('admgrPromoCands')().prods.length, 0); assert.equal(g('admgrCheckPromo')().length, 0);
  vm.runInContext("ADMGR_PROMO.on = true;", ctx);
  vm.runInContext(`admgr.products = [{ no: 1, name: '루즈핏 니트 (3 colors)', price: 50000, supply: 20000 }]; admgrPI = null; admgr.margins = {}; admgr.demo = false; admgr.data = { campaigns: [] };
    // 마진 28,000 · 손익분기 1.79 · 우수 ROAS 4.5↑ · 상품 35% = 구매당 9,800 · 종합 30% = 8,400
    admgrAlert.h7 = { range: { start: '2026-10-16', end: '2026-10-22' }, campaigns: [
      { id: 'c1', name: '테스트2_260914', status: 'ACTIVE', adsets: [
        { id: 's1', name: '루즈핏 니트_R1_28_261001', status: 'ACTIVE', spend: 560000, purchases: 70, value: 2800000, ads: [{ id: 'a1' }] },   // 구매당 8,000 (28.6%) · ROAS 5
        { id: 's2', name: '루즈핏 니트_R2_28_261001_test', status: 'ACTIVE', spend: 300000, purchases: 40, value: 1500000, ads: [{ id: 'a2' }] },   // 7,500 (26.8%) · ROAS 5
        { id: 's3', name: '스커트_P1_20_261001 [→CBO4]', status: 'ACTIVE', spend: 400000, purchases: 50, value: 2400000, ads: [{ id: 'a3' }] },
        { id: 's4', name: '블라우스_R1_20_261001', status: 'ACTIVE', spend: 400000, purchases: 50, value: 1200000, ads: [{ id: 'a4' }] },
        { id: 's5', name: '가디건_R1_20_261001', status: 'PAUSED', spend: 400000, purchases: 50, value: 2400000, ads: [] },
        { id: 's6', name: '베리쉬 세트_P1_27_261016', status: 'ACTIVE', spend: 300000, purchases: 60, value: 3000000, ads: [] } ] },
      { id: 'c2', name: 'CBO4', status: 'ACTIVE', budget: 100000, adsets: [{ id: 's9', name: '니트_R9', status: 'ACTIVE', spend: 900000, purchases: 90, value: 9000000, ads: [] }] },
      { id: 'c3', name: '상품CBO_베리쉬 세트_261019', status: 'ACTIVE', budget: 300000, adsets: [] } ] };
    admgrAlert.h3 = { campaigns: [{ id: 'c1', name: '테스트2_260914', adsets: [
        { id: 's1', spend: 240000, ads: [{ id: 'a1', purchases_7d: 30 }] }, { id: 's2', spend: 120000, ads: [{ id: 'a2', purchases_7d: 16 }] } ] }] };`, ctx);   // 3일 구매당 8,000·7,500 = 7일과 같음 → 추세 OK
  localStorage.removeItem('adc_promo_toall');
  let c = g('admgrPromoCands')();
  assert.equal(c.prods.map(p => p.name + ':' + p.goods.length + ':' + p.pct7 + ':' + p.trendOk).join(), '루즈핏 니트:2:28:true');   // 상품 110건 · 27.9% · 우수 2개
  assert.equal(c.ads.map(r => r.s.id).join(), '');                            // s1·s2는 상품 후보 상품이라 종합엔 안 올라감 · s3 CBO 표시 · s4 상품 미매칭 · s5 꺼짐 · s6 상품CBO 켜짐
  let items = g('admgrCheckPromo')(); assert.ok(items[0].text.includes('종합 CBO 0개 · 상품 CBO 1개'), JSON.stringify(items));
  localStorage.setItem('adc_promo_toall', JSON.stringify(['루즈핏 니트']));            // 사용자가 '종합 CBO로' → 우수 세트 전부가 종합 후보로 (구매당 비용 낮은 순)
  c = g('admgrPromoCands')();
  assert.equal(c.ads.map(r => r.s.id + (r.fromProd ? '*' : '')).join(), 's2*,s1*'); assert.ok(c.prods[0].toAll);
  localStorage.removeItem('adc_promo_toall');
  vm.runInContext("admgrAlert.h7 = null; admgrAlert.h3 = null; ADMGR_PROMO.on = false;", ctx);
});

test('admgrFatigueCalc: 상품 단위 ROAS 전주 대비 20%↓ & 지난주 구매 20↑만 (10/28 ROAS 기준)', () => {
  const f = g('admgrFatigueCalc'), cfg = { fatigueRoas: 20, fatigueMinPur: 20 };
  const H = (rows) => ({ campaigns: [{ adsets: rows.map(([name, spend, pur, value]) => ({ name, spend, purchases: pur, value })) }] });
  const now = H([['니트_R1_28_261001', 300000, 20, 1200000], ['니트_R2_28_261001', 200000, 10, 800000], ['스커트_P1_20_261001', 100000, 10, 600000], ['신상_P1_20_261020', 100000, 10, 100000]]);   // 니트 ROAS 400% · 스커트 600%
  const prev = H([['니트_R1_28_261001', 250000, 25, 1500000], ['스커트_P1_20_261001', 100000, 11, 650000], ['가디건_R1_20_261001', 100000, 10, 500000]]);                                       // 니트 600% · 스커트 650% · 가디건(이번 주 없음)
  const r = f(now, prev, cfg);
  assert.equal(r.map(x => x.prod + ':' + Math.round(x.drop * 100)).join(), '니트:33');   // 스커트 −8%는 미달 · 신상은 지난주 없음 · 가디건 이번 주 없음
  assert.equal(f(now, prev, { fatigueRoas: 40, fatigueMinPur: 20 }).length, 0);
  assert.equal(f(now, prev, { fatigueRoas: 20, fatigueMinPur: 30 }).length, 0);           // 지난주 구매 25 < 30
});

test('admgrSeasonCalc·admgrHygieneCalc: 작년 기간 구매순 + 끌올됨 표시 · 사본/이름 규칙/페이지 위생', () => {
  const S = g('admgrSeasonCalc');
  vm.runInContext("admgr.products = [{ no: 1, name: '(기모ver.) 클레르 블라우스 (3 colors)', price: 24000, supply: 9000 }]; admgrPI = null;", ctx);
  const h = { campaigns: [{ name: '다나로브 릴스', adsets: [{ name: '영상_(기모ver.) 클레르 블라우스_24.000', spend: 100000, purchases: 50, value: 800000 }, { name: '베일리 니트 원피스_R1_22_251110_test', spend: 50000, purchases: 10, value: 400000 }, { name: '싸구려_P1', spend: 90000, purchases: 30, value: 150000 }] }] };
  const L = S(h, [{ status: 'ACTIVE', name: '클레르 블라우스_R9_25_261020_test' }], '2026-10-23');
  assert.equal(L.map(x => x.prod + ':' + x.pur + ':' + x.now).join(), '클레르 블라우스:50:true');   // 옛 이름도 상품 목록으로 '클레르 블라우스' · 지금 켜진 세트에 같은 상품 → 끌올됨 · 구매 10 미달·ROAS 1.7 미달은 제외
  assert.equal(g('admgrGuessProduct')('1111_영상(범준)_하울브이원피스 블랙먼저'), '하울브이원피스 블랙먼저');   // 상품 목록에 없으면 가장 긴 토막
  const r = g('admgrSeasonRange')('2026-10-23'); assert.equal(r.since + '~' + r.until, '2025-11-13~2025-12-10');
  const H = g('admgrHygieneCalc');
  const sets = [{ name: '니트_R1_28_261022_test - 사본', _campName: '테스트2', created: '2026-10-22' }, { name: '막이름 세트', _campName: '테스트2', created: '2026-10-22' }, { name: '막이름 옛세트', _campName: '테스트2', created: '2026-09-01' }, { name: 'CBO 세트', _campName: 'CBO4', created: '2026-10-22' },
    { name: '오르노 라인 케이블 가디건_인스타게시물_26_261021', _campName: '테스트2', created: '2026-10-21' }, { name: '양가죽 플랫슈즈_P4_인스타_30_261020', _campName: '테스트2', created: '2026-10-21' }];   // 인스타게시물·_test 뗀 이름은 규칙 통과
  const pages = [{ page_id: 'A', name: 'ad1' }, { page_id: 'A', name: 'ad2' }, { page_id: 'B', name: '엉뚱', page: 'Kustom' }];
  const out = H(sets, pages, '2026-10-23');
  assert.equal(out.map(x => x.key.split(':')[0] + ':' + x.lvl).join(), 'hy-copy:yellow,hy-name:yellow,hy-page:red');
  assert.ok(out[1].text.includes('1개') && out[1].text.includes('막이름 세트') && out[2].text.includes('엉뚱') && out[2].text.includes('Kustom'));
  assert.equal(H([], [{ page_id: 'A', name: 'x' }], '2026-10-23').length, 0);
});

test('admgrWeekendTargets: 테스트 캠페인 켜진 세트 중 7일 ROAS 550~900%만 −25% (천원 반올림, 10/28 ROAS 기준)', () => {
  vm.runInContext(`admgr.products = []; admgrPI = null; admgr.margins = {}; admgr.demo = false;
    admgr.data = { campaigns: [{ id: 'c1', name: '테스트2', status: 'ACTIVE', adsets: [
      { id: 's1', name: '루즈핏 니트_R1_28_261001', status: 'ACTIVE', budget: 50000 }, { id: 's2', name: '루즈핏 니트_R2_28_261001', status: 'ACTIVE', budget: 30000 }, { id: 's3', name: '루즈핏 니트_R3_28_261001', status: 'ACTIVE', budget: 30000 }, { id: 's4', name: '루즈핏 니트_R4_28_261001', status: 'PAUSED', budget: 30000 }, { id: 's5', name: '루즈핏 니트_R5_28_261001', status: 'ACTIVE', budget: 30000 } ] },
      { id: 'c2', name: 'CBO4', status: 'ACTIVE', budget: 100000, adsets: [{ id: 's9', name: '루즈핏 니트_R9', status: 'ACTIVE', budget: 0 }] }] };
    admgrAlert.h7 = { campaigns: [{ name: '테스트2', adsets: [
      { id: 's1', spend: 280000, purchases: 25, value: 1680000 },   // 600% → 대상
      { id: 's2', spend: 100000, purchases: 12, value: 850000 },    // 850% → 대상
      { id: 's3', spend: 80000, purchases: 10, value: 800000 },     // 1000% → 좋은 세트, 제외
      { id: 's4', spend: 100000, purchases: 10, value: 600000 },    // 꺼짐 → 제외
      { id: 's5', spend: 100000, purchases: 10, value: 500000 } ] }] };`, ctx);   // 500% → 예산 조정 후보 몫, 제외
  const T = g('admgrWeekendTargets')({ wkRoasLo: 550, wkRoasHi: 900, weekendPct: 25 });
  assert.equal(T.map(x => x.id + ':' + x.from + '→' + x.to + ':' + x.roas).join(), 's1:50000→38000:600,s2:30000→23000:850');   // 50,000×0.75=37,500→38,000 · 30,000×0.75=22,500→23,000
  assert.equal(g('admgrWeekendFri')('2026-10-26') + ',' + g('admgrWeekendFri')('2026-10-30') + ',' + g('admgrWeekendFri')('2026-11-01'), '2026-10-30,2026-10-30,2026-10-30');   // 월·금·일 → 같은 주말의 금요일
  vm.runInContext("admgrAlert.h7 = null; admgr.data = null;", ctx);
});

test('주말 모드 시각 (10/29): 금 17시 감액 · 일 15시 원복, 결과는 그 주 세트의 시각 예약만 센다', () => {
  const W = g('admgrWeekendTimes')('2026-10-30', { wkCutHour: 17, wkBackHour: 15 });
  assert.equal(W.cut + ',' + W.back, '2026-10-30T17:00,2026-11-01T15:00');
  vm.runInContext(`admgr.write.lastPending = { pending: [
      { mode: 'timed', status: 'pending', object_id: 's1', apply_at: '2026-11-01T06:00:00+00:00' },
      { mode: 'midnight', status: 'pending', object_id: 's1', apply_at: null } ],
    timed: [
      { status: 'applied', object_id: 's1', apply_at: '2026-10-30T08:00:00+00:00' },
      { status: 'canceled', object_id: 's2', apply_at: '2026-10-30T08:03:00+00:00' },
      { status: 'applied', object_id: 'zz', apply_at: '2026-10-30T08:00:00+00:00' } ] };`, ctx);   // zz = 주말 모드 세트 아님
  const L = { cut: [{ id: 's1' }, { id: 's2' }] }, ms = g('admgrKstMs'), run = g('admgrWeekendRun');
  const c = run(L, ms(W.cut), ms(W.back)), b = run(L, ms(W.back), ms(W.back) + 2 * 86400e3);
  assert.equal([c.ok, c.skip, c.fail, c.wait, b.ok, b.wait].join(), '1,1,0,0,0,1');
  vm.runInContext('admgr.write.lastPending = null;', ctx);
});

test('admgrAdjCalc: ROAS 550% 기준 — 450% 미만 OFF · 450~550% 절반 · 550~900% 유지 · 900%↑ 증액 · 대기 (기본값 창 · 오늘 10/28 수)', () => {
  const f = g('admgrAdjCalc');
  const S = (id, budget, extra) => ({ id, name: 'x' + id, status: 'ACTIVE', budget, created: '2026-10-01T00:00:00+0900', ...extra });
  const W = (spend, purchases, roas) => ({ spend, purchases, value: spend * roas, purchases_7d: 0, value_7d: 0 });   // 클릭 7일 값이 0이어도 기본값 창으로 판정해야 함
  const ids = 'abcdefghijk'.split(''), sets = ids.map(id => S(id, 40000, id === 'h' ? { _cbo: true } : id === 'i' ? { created: '2026-10-27T10:00:00+0900' } : {}));
  const s7 = new Map([['a', W(200000, 10, 3)], ['b', W(140000, 10, 5)], ['c', W(60000, 10, 12)], ['d', W(130000, 10, 5.2)], ['e', W(70000, 10, 9.5)], ['f', W(110000, 10, 7)], ['g', W(140000, 10, 5)], ['h', W(140000, 1, 1)], ['i', W(140000, 1, 1)], ['j', W(30000, 1, 2)], ['k', W(90000, 10, 6)]]);
  const s3 = new Map(ids.map(id => [id, W(30000, 1, 1)]));   // 3일은 참고만 — 결과에 영향 없어야 함
  const hist = [{ level: 'adset', object_id: 'd', time: '2026-10-25T03:00:00Z', old_value: 80000, new_value: 40000 }, { level: 'adset', object_id: 'g', time: '2026-10-27T03:00:00Z', old_value: 80000, new_value: 40000 }];
  const by = Object.fromEntries(f(sets, s7, s3, hist, '2026-10-28', 3).map(x => [x.s.id, x.act + (x.act === 'half' || x.act === 'up' ? ':' + x.to : '')]));
  // a 300% OFF / b 500% 절반 / c 1200% +30% / d 10/25 감액 뒤 520%(550% 미만) OFF / e 950% +20% / f 700%·k 600% 유지 / g 10/27 감액 · 500% 대기 / h CBO·i 신규·j 표본 부족 제외
  assert.equal(JSON.stringify(by), JSON.stringify({ a: 'off', b: 'half:20000', c: 'up:52000', d: 'off', e: 'up:48000', f: 'watch', g: 'cool', k: 'watch' }));
  assert.equal(f([S('g', 40000)], new Map([['g', W(170000, 10, 4)]]), new Map(), hist, '2026-10-28', 3)[0].act, 'off');   // 대기 중이어도 450% 미만이면 OFF
  assert.equal(f([S('u', 40000)], new Map([['u', W(55000, 10, 12)]]), new Map(), [], '2026-10-30', 5).length, 0);   // 금요일엔 증액 없음
  assert.equal(f([S('u', 40000)], new Map([['u', W(55000, 9, 12)]]), new Map(), [], '2026-10-28', 3).length, 0);    // 구매 10건 미만은 증액 없음
  assert.equal(f([S('z', 40000)], new Map([['z', W(50000, 0, 0)]]), new Map(), [], '2026-10-28', 3)[0].act, 'off');   // 구매 0이어도 지출 5만이면 판단 → ROAS 0 OFF
  assert.equal(f([S('z', 40000)], new Map([['z', W(49000, 4, 2)]]), new Map(), [], '2026-10-28', 3).length, 0);      // 구매 4건·지출 4.9만 — 표본 부족
  const ev = (t, o, n) => ({ level: 'adset', object_id: 'r', time: t, old_value: o, new_value: n });
  const R1 = h => f([S('r', 40000)], new Map([['r', W(130000, 10, 5)]]), new Map(), h, '2026-10-28', 3)[0].act;   // 7일 500%
  assert.equal(R1([ev('2026-10-24T14:45:00Z', 40000, 30000), ev('2026-10-26T14:45:00Z', 30000, 40000)]), 'half');   // 주말 −25% 뒤 원복 → 감액 이력 아님 → 절반
  assert.equal(R1([ev('2026-10-23T03:00:00Z', 40000, 4000), ev('2026-10-23T14:45:00Z', 4000, 40000)]), 'half');     // 낮 ÷10 뒤 23:45 원복 → 절반
  assert.equal(R1([ev('2026-10-23T03:00:00Z', 80000, 40000)]), 'off');                                                // 진짜 절반 감액 뒤에도 550% 미만 → OFF
});

test('admgrFastOf·admgrFastRevertOf: 3일 ROAS 1000%↑ → 2배 후보 · 올린 뒤 이틀 ROAS 550% 미만 → 되돌리기 (10/28 ROAS 기준)', () => {
  const D = (sp, p, v) => new Map([['r', { sp, p, v }]]);
  vm.runInContext("admgr.fast.boost = { items: {} };", ctx);
  const setDays = (a, b, c) => { ctx.__d = [a, b, c]; vm.runInContext("admgr.fast.days = __d;", ctx); };
  const r = { id: 'r', name: '니트_R1_28_261001', status: 'ACTIVE', budget: 20000 };   // 3만 미만 → 3일 4건부터
  setDays(D(10000, 1, 100000), D(10000, 2, 100000), D(10000, 1, 100000));   // 3일 4건 · ROAS 1000%
  assert.equal(Math.round(g('admgrFastOf')(r).roas * 100), 1000);
  setDays(D(10000, 1, 90000), D(10000, 2, 90000), D(10000, 1, 90000));      // 900% → 아님
  assert.equal(g('admgrFastOf')(r), null);
  assert.equal(g('admgrFastOf')({ ...r, budget: 40000 }), null);              // 3만↑은 6건부터
  vm.runInContext(`admgr.fast.boost = { items: { r: { from: 10000, to: 20000, day: todayStr(-4) } } };`, ctx);
  setDays(D(0, 0, 0), D(20000, 2, 100000), D(20000, 1, 100000));            // 이틀 ROAS 500% → 되돌리기
  assert.equal(g('admgrFastRevertOf')(r).from, 10000);
  setDays(D(0, 0, 0), D(20000, 2, 120000), D(20000, 1, 120000));            // 600% → 그대로
  assert.equal(g('admgrFastRevertOf')(r), null);
  setDays(D(0, 0, 0), D(0, 0, 0), D(0, 0, 0));                              // 이틀 지출 없음 → 판단 안 함
  assert.equal(g('admgrFastRevertOf')(r), null);
  vm.runInContext("admgr.fast.days = null; admgr.fast.boost = null;", ctx);
});

console.log('주간 리포트');
test('admgrReportBuild: 기간 내 판정·추가소재·새 테스트·종료를 상품별로 묶는다', () => {
  const st = (id, m) => ({ id, adset_id: 's' + id, adset_name: `${m.p || '니트'}_R1_28_260901_test`, name: 'ad' + id, reg_date: m.reg || '2026-09-09',
    effective_status: m.es || 'ACTIVE', status: m.es || 'ACTIVE', gone: !!m.gone, spend: m.spend ?? 1000, purchases: m.pur ?? 1, value: m.val ?? 5000, meta: m.meta || {} });
  const rows = [
    st('1', { meta: { verdict: 'good', verdict_at: '2026-09-10T01:00:00Z', asset_req_at: '2026-09-10T02:00:00Z' }, spend: 5000 }),
    st('2', { meta: { verdict: 'good', verdict_at: '2026-08-01T00:00:00Z' } }),                       // 기간 밖 우수 → 제외
    st('3', { meta: { verdict: 'good', updated_at: '2026-09-11T00:00:00Z' } }),                       // verdict_at 없는 옛 판정 → updated_at
    st('4', { p: '블라우스', meta: { verdict: 'meh', verdict_at: '2026-09-08T00:00:00Z' } }),
    st('5', { p: '블라우스', reg: '2026-09-10' }),                                                    // 새 테스트
    st('6', { reg: '2026-09-10', es: 'PAUSED' }),                                                     // 종료
    st('7', { reg: '2026-08-20', es: 'PAUSED' }),                                                     // 기간 밖 등록 → 제외
    st('8', { reg: '2026-08-01', meta: { asset_req_at: '2026-07-01T00:00:00Z', asset_done_at: '2026-09-11T00:00:00Z' } }), // 제작완료
  ].map(a => ({ ...a, st: g('admgrTestStatusOf')(a, a.meta) }));
  const rep = g('admgrReportBuild')(rows, 7, '2026-09-11');
  assert.equal(rep.from, '2026-09-05');
  const by = Object.fromEntries(rep.secs.map(s => [s.key, s]));
  assert.equal([by.good.n, by.pending.n, by.done.n, by.meh.n, by.fresh.n, by.ended.n].join(), '2,1,1,1,1,1');
  assert.equal(JSON.stringify(by.good.groups.map(x => [x.name, x.ads.map(a => a.id)])), JSON.stringify([['니트', ['1', '3']]]));   // 지출 큰 순 (vm 렐름 차이로 JSON 비교)
  assert.equal(by.meh.groups[0].name, '블라우스');
  assert.equal(rep.all.length, 6);   // 1·3·8·4·5·6 (1은 우수+진행 중 중복 제거)
  const txt = g('admgrReportText')(rep);
  assert.ok(txt.includes('■ 우수 → 추가소재 제작 요청 (2)') && txt.includes('[니트]') && txt.includes('ROAS 1.0') && txt.includes('요청 09/10'), txt);
  const html = g('admgrReportHtml')(rep, { '1': 'https://x/y.jpg' });
  assert.ok(html.includes('src="https://x/y.jpg"') && html.includes('종료·OFF'));
});

test('admgrRecommend: D+2부터, 우수 = 구매 3↑ & ROAS 550%↑, OFF = ROAS 450% 미만 · 구매 0은 3만↑ (10/28 ROAS 기준)', () => {
  vm.runInContext("admgr.products = [{ name: '루즈핏 니트 (자체제작)', price: 50000, supply: 20000 }]; admgrPI = null; admgrTJudge = { ...ADMGR_TJUDGE_DEFAULT };", ctx);
  const ad = (m) => ({ id: 'x', adset_id: 'sx', adset_name: m.set || '루즈핏 니트_R1_28_260901_test', name: 'ad', reg_date: m.reg || '2026-01-01', st: 'eval', meta: m.meta || {}, spend: m.sp ?? 50000, purchases: m.pur, value: m.val ?? m.pur * 50000 });
  const k = m => g('admgrRecommend')(ad(m)).k;
  assert.equal(k({ pur: 1 }), 'off');                         // ROAS 100%
  assert.equal(k({ pur: 0 }), 'off');                         // 구매 0 · 5만 씀 (3만↑)
  assert.equal(k({ pur: 0, sp: 20000 }), 'wait');             // 구매 0 · 2만 — 아직
  assert.equal(k({ pur: 6 }), 'good');                        // ROAS 600%
  assert.equal(k({ pur: 5 }), 'wait');                        // ROAS 500% — 450~550%
  const s = g('admgrRecommend')(ad({ pur: 2, val: 300000 })); assert.equal(s.k + ':' + !!s.sample, 'wait:true');   // 600%로 좋지만 2건
  assert.equal(k({ pur: 3, sp: 20000, val: 120000 }), 'good');   // 금액 조건 없음 — 2만원에 3장, ROAS 600%
  assert.equal(k({ pur: 3, reg: g('todayStr')(-1) }), 'watch');   // D+1
  assert.equal(g('admgrRecommend')(ad({ pur: 6, meta: { verdict: 'off' } })), null);   // 확정한 건 추천 안 함
  assert.equal(k({ set: '없는상품_R1_test', pur: 6 }), 'good');   // 상품을 못 찾아도 같은 ROAS 기준
});

test('admgrTestStage: 테스트 중 → 판정할 차례 → 판정 끝, OFF 판정은 상태만 (광고 상태 무관)', () => {
  const f = g('admgrTestStage'), st = g('admgrTestStatusOf');
  const mk = (o) => { const a = { id: '1', reg_date: '2026-01-01', spend: 40000, purchases: 1, effective_status: 'ACTIVE', ...o }; a.meta = o.meta || {}; a.st = st(a, a.meta); return a; };
  assert.equal(f(mk({ reg_date: g('todayStr')(0) })), 'run');
  assert.equal(f(mk({ spend: 10000 })), 'judge');          // 소액이어도 D+2면 판정할 차례
  assert.equal(f(mk({})), 'judge');
  assert.equal(f(mk({ spend: 10000, effective_status: 'PAUSED' })), 'judge');   // 기준 전에 직접 끈 것도 판정 대상
  const off = mk({ meta: { verdict: 'off' } });
  assert.equal(f(off) + ':' + off.st + ':' + off.effective_status, 'done:off:ACTIVE');
  assert.equal(f(mk({ gone: true, meta: { verdict: 'good' } })), 'gone');
  assert.equal(f(mk({ meta: { hidden: true } })), 'hidden');
});

test('admgrFmtOf: 세트명에서 형식·릴스/이미지', () => {
  const f = n => { const r = g('admgrFmtOf')(n); return r.fmt + ':' + r.kind; };
  assert.equal(f('피넛 프릴 블라우스_P2_다나대표_26_261012_test'), '다나대표:이미지');
  assert.equal(f('헤이 나그랑 맨투맨 원피스_R3_착용컷_22_260929_test'), '착용컷:릴스');
  assert.equal(f('로렌 루즈핏 케이블 가디건_인스타게시물_26_261012_test'), '인스타게시물:');
  assert.equal(f('상품명_260901_test'), '기타:');
});

test('admgrFunnelDiag: 중앙값 기준 후크·클릭·랜딩·장바구니·상세 진단', () => {
  const base = g('admgrFunnelBase')([
    { imp: 10000, clicks: 100, v3: 3000, lpv: 80, atc: 10, purchases: 5 }, { imp: 20000, clicks: 240, v3: 5000, lpv: 200, atc: 20, purchases: 8 }, { imp: 500, clicks: 50, v3: 400, lpv: 40, purchases: 1 },   // 노출 500은 기준선에서 제외
  ]);
  assert.equal(base.n, 2); assert.ok(Math.abs(base.ctr - 0.011) < 0.001);
  const d = a => g('admgrFunnelDiag')({ spend: 50000, ...a }, base).k;
  assert.equal(d({ imp: 800, clicks: 10 }), 'nodata');
  assert.equal(d({ imp: 10000, clicks: 110, v3: 1500, lpv: 90, purchases: 3 }), 'hook');            // 3초 15% < 중앙값 27.5%×0.7
  assert.equal(d({ imp: 10000, clicks: 50, v3: 3000, lpv: 40, purchases: 3 }), 'click');           // CTR 0.5% < 1.1%×0.7
  assert.equal(d({ imp: 10000, clicks: 120, v3: 3000, lpv: 50, purchases: 3 }), 'landing');        // 도착 42% < 60%
  assert.equal(d({ imp: 10000, clicks: 120, v3: 3000, lpv: 100, atc: 10, purchases: 1 }), 'cart'); // 장바구니→구매 10% < 중앙값 45%의 절반
  assert.equal(d({ imp: 10000, clicks: 120, v3: 3000, lpv: 100, atc: 1, purchases: 0 }), 'detail');// 클릭 평균 이상, 구매 0, 지출 5만
  assert.equal(d({ imp: 10000, clicks: 120, v3: 3000, lpv: 100, atc: 2, purchases: 8, value: 400000 }), 'good');
  assert.equal(d({ imp: 10000, clicks: 120, v3: 3000, lpv: 100, atc: 2, purchases: 8, value: 30000 }), 'loss');   // 구매는 있는데 ROAS 0.6 < 손익분기
  assert.ok(g('admgrFunnelCell')({ imp: 10000, clicks: 120, v3: 3000, lpv: 100, freq: 3.4, purchases: 8, value: 400000, spend: 50000 }, base).includes('빈도 3.4'));
});

test('admgrTrend: 스냅샷 기준 최근 7일·일별 증분·식음 판정', () => {
  const rows = [['2026-09-04', 100000, 10, 500000], ['2026-09-05', 110000, 11, 550000], ['2026-09-10', 150000, 12, 580000], ['2026-09-11', 170000, 12, 590000]]
    .map(([day, spend, purchases, value]) => ({ ad_id: '1', day, spend, purchases, value }));
  const map = new Map([['1', rows]]);
  const f = g('admgrTrend');
  const tr = f({ id: '1', reg_date: '2026-08-01', spend: 200000, purchases: 13, value: 620000 }, map, '2026-09-12');
  assert.equal(tr.days, 4);
  assert.equal([tr.recent.spend, tr.recent.purchases, tr.recent.value].join(), '90000,2,70000');     // 누적 − 09/05 행(7일 전 이하 최신)
  assert.equal(tr.daily.map(d => d.day + ':' + d.spend).join(), '2026-09-10:40000,2026-09-11:20000,2026-09-12:30000');
  assert.ok(tr.tired);   // 최근 ROAS 0.78 < 누적 3.1의 절반, 지출 9만 ≥ 3만, 구매 13 ≥ 5
  const ok = f({ id: '1', reg_date: '2026-08-01', spend: 200000, purchases: 20, value: 1000000 }, map, '2026-09-12');
  assert.ok(!ok.tired);
  assert.equal(f({ id: '2', spend: 1000 }, map, '2026-09-12'), null);
  const html = g('admgrSparkHtml')(tr, 2);
  assert.ok(html.includes('<svg') && html.includes('식음') && html.includes('7일 0.8'));
  const young = f({ id: '1', reg_date: '2026-08-01', spend: 200000, purchases: 13, value: 620000 }, new Map([['1', rows.slice(3)]]), '2026-09-12');
  assert.ok(g('admgrSparkHtml')(young, 2).includes('추세 1일'));
});

test('admgrProfit: 마진율 × (1−순반품률) 순이익과 S/A/B/C 등급', () => {
  vm.runInContext("admgr.products = [{ no: 10, name: '루즈핏 니트 (자체제작)', price: 50000, supply: 20000 }]; admgrPI = null; admgr.best.nrDay = '2026-09-12'; admgr.best.nrTotal = 12; admgr.best.nr = new Map([[10, { product_no: 10, total_qty: 40, return_qty: 8, net_return_rate: 20 }]]);", ctx);
  const f = g('admgrProfit');
  const pf = f('루즈핏 니트_R1_28_260901_test', { spend: 100000, purchases: 10, value: 500000 });   // 마진율 56% · 반품 20% → 500000×.56×.8 − 100000 = 124,000
  assert.equal(Math.round(pf.net), 124000); assert.equal(pf.grade, 'S'); assert.ok(pf.rrSrc.startsWith('상품'));
  assert.equal(f('루즈핏 니트_R1', { spend: 100000, purchases: 3, value: 150000 }).grade, 'C');     // 67,200 − 100,000 < 0
  assert.equal(f('루즈핏 니트_R1', { spend: 100000, purchases: 5, value: 300000 }).grade, 'B');     // 134,400 − 100,000 = 34,400 → ROI 0.34
  assert.equal(f('없는 상품_R1', { spend: 1, value: 1 }), null);
  vm.runInContext("admgr.best.nr = new Map();", ctx);
  assert.equal(f('루즈핏 니트_R1', { spend: 100000, purchases: 10, value: 500000 }).rrSrc.slice(0, 2), '몰 ');   // 상품 행 없음 → 몰 평균 12%
  assert.ok(g('admgrGradeBadge')(pf).includes('>S<'));
});

test('admgrReportBuild(cmp·dirs): OFF·우수 공통점 비교, 실패 이유 분포, 추가소재 방향', () => {
  vm.runInContext("admgr.products = [{ no: 1, name: '루즈핏 니트 (자체제작)', price: 50000, supply: 20000 }]; admgrPI = null;", ctx);
  const ad = (id, m) => ({ id, adset_id: 's' + id, adset_name: m.set, name: 'ad' + id, reg_date: m.reg || '2026-09-10', gone: false, effective_status: m.es || 'ACTIVE', status: m.es || 'ACTIVE',
    spend: m.spend ?? 50000, purchases: m.pur ?? 0, value: m.val ?? 0, imp: m.imp ?? 10000, clicks: m.clicks ?? 100, v3: m.v3 ?? 0, lpv: m.lpv ?? 90, atc: m.atc ?? 2, meta: m.meta || {} });
  const good = { verdict: 'good', verdict_at: '2026-09-11T00:00:00Z' };
  const rows = [
    ad('1', { set: '루즈핏 니트_R1_사이즈_28_260910_test', pur: 8, val: 400000, v3: 3500, clicks: 300, lpv: 280, meta: good }),
    ad('2', { set: '루즈핏 니트_R2_사이즈_28_260910_test', pur: 7, val: 350000, v3: 3200, clicks: 280, lpv: 260, meta: good }),
    ad('3', { set: '루즈핏 니트_R3_핏_28_260910_test', pur: 6, val: 300000, v3: 3000, clicks: 250, lpv: 240, meta: good }),
    ad('4', { set: '스커트_P1_20_260910_test', es: 'PAUSED', clicks: 40 }),                       // OFF · 클릭 약함
    ad('5', { set: '스커트_P2_20_260910_test', es: 'PAUSED', clicks: 45 }),                       // OFF · 클릭 약함
    ad('6', { set: '블라우스_R1_15_260910_test', es: 'PAUSED', v3: 800, clicks: 250, lpv: 240 }),   // OFF · 후크 약함
    ad('7', { set: '바지_R1_10_260901_test', es: 'PAUSED', reg: '2026-08-01' }),                  // 기간 밖 등록 → 비교 제외
  ].map(a => ({ ...a, st: g('admgrTestStatusOf')(a, a.meta) }));
  const cre = new Map([['1', { kind: 'video', file_name: '루즈핏 니트_R1_사이즈_28_260910_test.mov', created_by_name: '김도희', text: { message: '77사이즈도 편해요' } }],
    ['2', { kind: 'video', file_name: '루즈핏 니트_R2_사이즈_28_260910_test.mov', created_by_name: '김도희', text: { message: '허리 편함' } }],
    ['3', { kind: 'video', file_name: '루즈핏 니트_R3_핏_28_260910_test.mov', created_by_name: '박민규', text: { message: '체형커버 굿' } }]]);
  const ai = { at: '2026-09-12T00:00:00Z', text: 'AI 해석 본문', tags: { '1': { cut: '시연', text: true, size: true }, '2': { cut: '시연', text: true, size: false }, '3': { cut: '시연', text: false, size: false }, '4': { cut: '정면', text: false, size: false } } };
  const rep = g('admgrReportBuild')(rows, 7, '2026-09-12', { cre, ai });
  const c = rep.cmp;
  assert.equal(c.off.n + ',' + c.good.n, '3,3');
  const ax = Object.fromEntries(c.axes.map(x => [x.k, x]));
  assert.equal(JSON.stringify(ax.fmt.good), JSON.stringify([['릴스', 3]]));
  assert.equal(JSON.stringify(ax.fmt.off), JSON.stringify([['이미지', 2], ['릴스', 1]]));
  assert.equal(JSON.stringify(ax.price.good), JSON.stringify([['5~8만', 3]]));
  assert.equal(JSON.stringify(ax.cut.off), JSON.stringify([['정면', 1]]));
  // 영상 태그(프레임 전체 분석)가 있으면 썸네일 태그보다 우선 — 1번 소재는 착용이 아니라 시연으로 잡힌다
  const rep2 = g('admgrReportBuild')(rows, 7, '2026-09-12', { cre, ai, vtags: { '1': { hook: '손 시연', cuts: 9, scenes: [{ t: 0, kind: '시연' }, { t: 2, kind: '시연' }, { t: 5, kind: '착용' }], subtitles: [{ t: 0, text: '77사이즈' }], size_number: { shown: true, t: 1 } } } });
  const ax2 = Object.fromEntries(rep2.cmp.axes.map(x => [x.k, x]));
  assert.equal(JSON.stringify(ax2.vhook.good), JSON.stringify([['손 시연', 1]]));
  assert.equal(JSON.stringify(ax2.cutsB.good), JSON.stringify([['컷 8+', 1]]));
  assert.equal(ax2.cut.goodN, 3);   // 영상 1 + 썸네일 2·3
  assert.equal(JSON.stringify(ax2.size.good), JSON.stringify([['없음', 2], ['사이즈 숫자 노출', 1]]));
  assert.equal(c.reasons.map(r => r.label + r.n).join(), '클릭 약함2,후크 약함1');
  assert.ok(c.commonGood.includes('형식 릴스 100% (OFF 33%)') && c.commonGood.includes('가격대 5~8만 100% (OFF 0%)') && c.commonGood.includes('AI 장면 유형 시연 100% (OFF 0%)'), c.commonGood.join('|'));
  assert.ok(c.commonOff.includes('형식 이미지 67% (우수 0%)'), c.commonOff.join('|'));
  assert.ok(c.thin);
  const D = Object.fromEntries(rep.dirs.map(d => [d.name, d]));
  assert.equal(D['루즈핏 니트'].kind, 'good');
  assert.ok(D['루즈핏 니트'].asks[0].includes('사이즈·핏') && D['루즈핏 니트'].asks.includes('이미지 변형 1개') && D['루즈핏 니트'].asks.includes('문구에 사이즈 숫자·체형커버 훅'));
  assert.ok(D['스커트'].asks[0].startsWith('소구점 바꿔서') && D['블라우스'].asks[0].startsWith('첫 1초'));
  assert.equal(rep.all.length, 6);
  const txt = g('admgrReportText')(rep);
  assert.ok(txt.includes('■ 비교표 (OFF 3 vs 우수 3)') && txt.includes('실패 이유 클릭 약함 2') && txt.includes('■ 이번 주 할 일') && txt.includes('☐ 루즈핏 니트 —') && txt.includes('■ AI 해석 원문') && txt.includes('AI 해석 본문'), txt.slice(0, 600));
  const sum = g('admgrReportText')(rep, 'summary');
  assert.ok(sum.includes('■ 결론') && sum.includes('통한 것:') && sum.includes('☐ 스커트 —') && !sum.includes('비교표'), sum);
  const S = g('admgrReportSummary')(rep);
  assert.equal(S.kpi.good + ',' + S.kpi.off + ',' + S.kpi.rate, '3,3,50');
  assert.ok(S.todo[0].name === '루즈핏 니트' && S.todo.some(t => t.kind === 'off'));
  const html = g('admgrReportHtml')(rep, {});
  assert.ok(html.includes('이번 주 할 일') && html.includes('왜 안 터졌나') && html.includes('<details') && html.includes('AI 해석 본문') && html.includes('OFF·우수 공통점과 비교표 전체'));
});

test('admgrReportBuild(pro): 태그 기여도·예산 누수·팀 속도·회고·식음·패턴', () => {
  vm.runInContext("admgr.products = [{ no: 1, name: '루즈핏 니트 (자체제작)', price: 50000, supply: 20000 }]; admgrPI = null;", ctx);
  const ad = (id, m) => ({ id, adset_id: 's' + id, adset_name: m.set, name: 'ad' + id, reg_date: m.reg || '2026-09-10', gone: false, effective_status: m.es || 'ACTIVE', status: m.es || 'ACTIVE',
    spend: m.spend ?? 50000, purchases: m.pur ?? 0, value: m.val ?? 0, imp: m.imp ?? 10000, clicks: m.clicks ?? 100, v3: m.v3 ?? 0, lpv: m.lpv ?? 90, atc: m.atc ?? 2, meta: m.meta || {} });
  const good = { verdict: 'good', verdict_at: '2026-09-11T00:00:00Z' };
  const rows = [
    ad('1', { set: '루즈핏 니트_R1_사이즈_28_260910_test', pur: 8, val: 400000, v3: 3500, clicks: 300, lpv: 280, meta: good }),
    ad('2', { set: '루즈핏 니트_R2_사이즈_28_260910_test', pur: 7, val: 350000, v3: 3200, clicks: 280, lpv: 260, meta: good }),
    ad('3', { set: '루즈핏 니트_R3_핏_28_260910_test', pur: 6, val: 300000, v3: 3000, clicks: 250, lpv: 240, meta: good }),
    ad('4', { set: '스커트_P1_20_260910_test', es: 'PAUSED', clicks: 40 }),
    ad('5', { set: '스커트_P2_20_260910_test', es: 'PAUSED', clicks: 45 }),
    ad('6', { set: '블라우스_R1_15_260910_test', es: 'PAUSED', v3: 800, clicks: 250, lpv: 240 }),
    ad('8', { set: '루즈핏 니트_R0_28_260820_test', reg: '2026-08-20', meta: { verdict: 'good', verdict_at: '2026-09-02T00:00:00Z' } }),   // 직전 기간 우수 → 회고 대상 (기간 밖이라 기여도엔 안 들어감)
  ].map(a => ({ ...a, st: g('admgrTestStatusOf')(a, a.meta) }));
  const cre = new Map([['1', { kind: 'video', file_name: '루즈핏 니트_R1_사이즈_28_260910_test.mov', created_by_name: '김도희', text: { message: '77사이즈도 편해요' } }],
    ['2', { kind: 'video', file_name: '루즈핏 니트_R2_사이즈_28_260910_test.mov', created_by_name: '김도희', text: { message: '허리 편함' } }],
    ['3', { kind: 'video', file_name: '루즈핏 니트_R3_핏_28_260910_test.mov', created_by_name: '박민규', text: { message: '체형커버 굿' } }]]);
  const trend = new Map([['1', [{ day: '2026-09-03', spend: 10000, purchases: 6, value: 370000 }, { day: '2026-09-04', spend: 15000, purchases: 7, value: 380000 }, { day: '2026-09-10', spend: 30000, purchases: 7, value: 385000 }]]]);
  const rep = g('admgrReportBuild')(rows, 7, '2026-09-12', { cre, trend });
  const p = rep.pro;
  assert.equal(p.attr.n + ',' + p.attr.roasAll, '6,3.5');                      // 기간 안 소재 6개 · 지출 30만 대비 매출 105만
  const A = Object.fromEntries(p.attr.all.map(x => [x.k + ':' + x.v, x]));
  assert.equal(A['fmt:릴스'].n + ',' + A['fmt:릴스'].roas.toFixed(2), '4,5.25');
  assert.equal(A['fmt:이미지'].roas, 0);
  assert.ok(p.attr.up.some(x => x.v === '릴스') && p.attr.down.some(x => x.v === '이미지'));
  assert.ok(!p.attr.all.some(x => /미기입|미상|외부 등록/.test(String(x.v))), JSON.stringify(p.attr.all.map(x => x.v)));   // 태그 없는 값은 기여도에서 제외
  assert.equal(p.leak.n + ',' + p.leak.pct, '3,50');                           // 구매 0 소재 3개에 지출 절반
  assert.equal([p.pipe.perWeek, p.pipe.rate, p.pipe.costPerWin].join(), '3,50,50000');
  assert.equal([p.dec.n, p.dec.good, p.dec.prev.n, p.dec.prev.alive, p.dec.prev.held].join(), '3,3,1,1,0');
  assert.equal(p.fatigue.n, 1);                                                // 최근 7일 ROAS 0.6 < 누적 8.0의 절반
  assert.ok(p.play.verified.some(x => x.v === '릴스'), JSON.stringify(p.play.verified));
  assert.equal(p.conf.length, 0);                                              // 평가중(판정 후보) 소재 없음
  const txt = g('admgrReportText')(rep);
  assert.ok(txt.includes('■ 지금 손 쓸 것') && txt.includes('■ 성과를 만든 것') && txt.includes('■ 다음 소재 규칙') && txt.includes('식음 1개'), txt.slice(0, 900));
  assert.ok(g('admgrReportText')(rep, 'summary').includes('■ 지금 손 쓸 것'));       // 경보는 요약 복사에도
  const html = g('admgrReportHtml')(rep, {});
  assert.ok(html.includes('지금 손 쓸 것') && html.includes('성과를 만든 것') && html.includes('판정 신뢰도') && html.includes('팀 속도와 결정') && html.includes('다음 소재 규칙') && html.includes('부록 — 지표 정의와 한계'));
  assert.ok(html.split('산점도').length === 2 && html.includes('내용이 겹쳐 뺐어요'));    // 시안에서 덜어낸 것 — 부록의 '안 넣은 것' 한 줄로만 남는다
});

test('admgrReportConf: 구매 표본으로 ROAS 범위, 기준선 넘으면 뒤집힐 수 있음', () => {
  vm.runInContext("admgr.products = [{ name: '루즈핏 니트 (자체제작)', price: 50000, supply: 20000 }]; admgrPI = null;", ctx);   // 기준선 = ADMGR_ROAS (우수 5.5 · OFF 4.5, 10/28)
  const ad = (id, m) => ({ id, adset_id: 's' + id, adset_name: '루즈핏 니트_R' + id + '_28_260910_test', name: 'ad' + id, reg_date: '2026-09-01', st: 'eval', gone: false,
    effective_status: 'ACTIVE', spend: 50000, purchases: m.pur, value: m.val, meta: {} });
  const C = g('admgrReportConf')([ad('1', { pur: 6, val: 300000 }), ad('2', { pur: 30, val: 400000 }), ad('3', { pur: 0, val: 0 })]);
  const m = Object.fromEntries(C.map(x => [x.a.id, x]));
  assert.equal(m['1'].lvl + ',' + m['1'].risky, '참고 가능,true');     // ROAS 6.0인데 범위 3.6~8.4 → 우수 기준 5.5 아래까지 걸친다
  assert.equal(m['2'].lvl + ',' + m['2'].risky, '판정 가능,false');    // 구매 30 → 범위 6.5~9.5, 기준선 위
  assert.equal(m['3'].lvl + ',' + m['3'].r.k, '구매 없음,off');
  assert.ok(Math.abs(m['1'].lo - 3.551) < 0.01 && Math.abs(m['1'].hi - 8.449) < 0.01);
});

test('admgrTodoMerge: 저장본 done 유지 · 지난주 미완료 이어받기 · 지난주 완료율', () => {
  const cur = [{ name: '루즈핏 니트', text: '릴스 2개', kind: 'good', why: '우수 3' }, { name: '스커트', text: '점검', kind: 'off', why: 'OFF 2' }];
  const saved = [{ key: '루즈핏니트|good', name: '루즈핏 니트', text: '옛 문장', kind: 'good', done: true, doneAt: '2026-09-10T00:00:00Z', doneBy: '김도희', addedAt: '2026-09-10T00:00:00Z' },
    { key: '블라우스|good', name: '블라우스', text: '이미지 1개', kind: 'good', done: false, addedAt: '2026-09-10T00:00:00Z' },
    { key: '오래된|off', name: '오래된', text: 'x', kind: 'off', done: false, addedAt: '2026-06-01T00:00:00Z' }];
  const m = g('admgrTodoMerge')(cur, saved, '2026-09-17');
  assert.equal(m.items.map(x => `${x.name}:${x.done ? 1 : 0}:${x.carried ? 1 : 0}`).join(), '루즈핏 니트:1:0,스커트:0:0,블라우스:0:1');   // 완료 유지 · 새 항목 · 지난주 미완료 이어받기(30일 지난 건 제외)
  assert.equal(m.items[0].text, '릴스 2개');   // 문장은 이번 리포트 것
  assert.equal(m.prev.n + '/' + m.prev.done, '3/1');
});

test('admgrBestReportBuild: 스냅샷 기준 기간 증분·전주 대비·패턴·상품 판단·테스트 효율', () => {
  const ad = (id, m) => ({ id, adset_id: 's' + id, adset_name: m.set, name: 'ad' + id, reg_date: m.reg || '2026-08-01', gone: false,
    effective_status: m.es || 'ACTIVE', status: m.es || 'ACTIVE', spend: m.spend, purchases: m.pur, value: m.val, meta: m.meta || {} });
  const tests = [
    ad('1', { set: '루즈핏 니트_R1_28_260801_test', spend: 100000, pur: 10, val: 500000, meta: { verdict: 'good', verdict_at: '2026-09-10T00:00:00Z' } }),
    ad('2', { set: '루즈핏 니트_R2_28_260801_test', spend: 50000, pur: 2, val: 60000 }),
    ad('3', { set: '스커트_P1_20_260908_test', reg: '2026-09-08', spend: 40000, pur: 4, val: 200000, meta: { verdict: 'good', verdict_at: '2026-09-11T00:00:00Z' } }),
    ad('4', { set: '블라우스_R1_15_260810_test', spend: 90000, pur: 1, val: 30000, es: 'PAUSED', meta: { verdict: 'meh', verdict_at: '2026-09-09T00:00:00Z' } }),
    ad('5', { set: '바지_R1_10_260909_test', reg: '2026-09-09', spend: 3000, pur: 0, val: 0, es: 'PAUSED' }),
  ].map(a => ({ ...a, st: g('admgrTestStatusOf')(a, a.meta) }));
  const best = [{ adset_id: 's1', adset_name: '루즈핏 니트_R1_28_260801_test', created_at: '2026-08-20T00:00:00Z' }, { adset_id: 's2', adset_name: '루즈핏 니트_R2_28_260801_test', created_at: '2026-09-06T00:00:00Z' },
    { adset_id: 's3', adset_name: '스커트_P1_20_260908_test', created_at: '2026-09-11T00:00:00Z' }, { adset_id: 's4', adset_name: '블라우스_R1_15_260810_test', created_at: '2026-08-15T00:00:00Z' }];
  const bestAds = [{ id: '1', adset_id: 's1', effective_status: 'ACTIVE', is_video: true }, { id: '2', adset_id: 's2', effective_status: 'ACTIVE', is_video: true },
    { id: '3', adset_id: 's3', effective_status: 'ACTIVE', is_video: false }, { id: '4', adset_id: 's4', effective_status: 'PAUSED', is_video: true }];
  // 1: 기준선 둘 다 있음(증분 = 20,000/3/100,000 · 이전 = 30,000) · 2: 이번 기준선만(옛 소재 → 이전 미상) · 4: 스냅샷 없음(누적, approx) · 3·5: 기간 안 등록(누적 = 증분)
  const dayRows = [{ ad_id: '1', day: '2026-08-29', spend: 50000, purchases: 5, value: 250000 }, { ad_id: '1', day: '2026-09-05', spend: 80000, purchases: 7, value: 400000 },
    { ad_id: '2', day: '2026-09-04', spend: 45000, purchases: 2, value: 60000 }];
  const cre = new Map([['1', { file_name: '니트_R1_사이즈_28_260801_test.mov', created_by_email: 'kim@x.com', text: { message: '77사이즈도 편해요' } }], ['3', { file_name: '스커트_P1_핏_20_260908_test.jpg', created_by_email: 'kim@x.com', text: { message: '가을에 딱' } }],
    ['5', { file_name: '바지_R1_10_260909_test.mov', created_by_email: 'lee@x.com' }]]);
  const products = [{ name: '루즈핏 니트 (자체제작)', price: 39000, supply: 15000 }, { name: '스커트', price: 89000, supply: 30000 }];
  const rep = g('admgrBestReportBuild')({ tests, best, bestAds, dayRows, cre, products }, 7, '2026-09-11');
  assert.equal(rep.from + ' ' + rep.prevFrom, '2026-09-05 2026-08-29');
  assert.equal(rep.approx, 1);
  assert.equal([rep.S.best.n, rep.S.best.active, rep.S.best.cur.spend, rep.S.best.cur.purchases, rep.S.best.prev.spend].join(), '4,3,155000,8,30000');   // 1:20000+2:5000+3:40000+4:90000 / 구매 3+0+4+1
  assert.equal(rep.newBest.join('|'), '루즈핏 니트_R2_28_260801_test|스커트_P1_20_260908_test');
  assert.equal(rep.offBest.join('|'), '블라우스_R1_15_260810_test');
  assert.equal(rep.top[0].name, '스커트_P1_20_260908_test');   // ROAS 5.0 동률(니트1 20,000·스커트 40,000) → 지출 큰 순
  assert.equal(rep.fmt.map(b => b.k + b.n).join(), '이미지1,릴스3');
  assert.equal(rep.tags.map(b => b.k).join(), '사이즈,핏,미기입');
  assert.equal(rep.price.map(b => b.k + ':' + b.n).join(), '8만 이상:1,3~5만:2,가격 미상:1');
  assert.equal(rep.formula.hit + '/' + rep.formula.n, '1/2');
  assert.equal(rep.prods.map(p => p.name + ':' + p.v).join(), '루즈핏 니트:expand,스커트:more,블라우스:replace');
  assert.equal([rep.eff.reg, rep.eff.good, rep.eff.meh, rep.eff.off].join(), '2,2,1,1');
  assert.equal(JSON.stringify(rep.eff.by), JSON.stringify([{ who: 'kim', n: 1, good: 1 }, { who: 'lee', n: 1, good: 0 }]));
  assert.ok(rep.actions.md[0].includes('니트') && rep.actions.ct.some(x => x.includes("'사이즈'")));
  assert.equal(rep.top5.map(a => a.id).join(), '1,3,4,2');   // 순이익 없음(pf 미주입) → 기간 ROAS순 (1·3 동률 5.0, 4는 0.3, 2는 0)
  assert.ok(rep.lines.hero.includes('루즈핏 니트') && rep.lines.next.includes('확장 1개'), JSON.stringify(rep.lines));
  assert.equal(rep.todoRule.filter(t => t.kind === 'md').length, 3);
  assert.equal(rep.todoRule.filter(t => t.kind === 'ct').map(t => t.name).join(), '루즈핏 니트,스커트');   // 교체 검토(블라우스)는 변형 요청 없음
  const txt = g('admgrBestReportText')(rep, { text: '■ 이번 주 한 줄 평\nAI 한 줄 평\n■ 왜 터졌나\nAI 이유', at: '2026-09-11T09:00:00Z' });
  assert.ok(txt.includes('■ 결론') && txt.includes('주인공: AI 한 줄 평') && txt.includes('[확장] 루즈핏 니트') && txt.includes('[MD팀]') && txt.includes('■ AI 해석 원문'), txt.slice(0, 500));
  const sum = g('admgrBestReportText')(rep, null, 'summary');
  assert.ok(sum.includes('주인공: 루즈핏 니트') && sum.includes('☐ 루즈핏 니트 — 재고 확인') && !sum.includes('상품 판단'), sum);
  const html = g('admgrBestReportHtml')(rep, null);
  assert.ok(html.includes('베스트 소재 리포트') && html.includes('교체 검토') && html.includes('rp-cards') && html.includes('경보') && html.includes('<details'));
});

console.log('⑤ 소재 메뉴 단독 화면 (테스트 소재·베스트소재)');
test('showMenu(atest): 광고관리자 섹션을 test 탭만으로, admgr 복귀 시 이전 탭 복원', () => {
  vm.runInContext("admgr.view = 'camp';", ctx);
  g('showMenu')('atest'); assert.equal(g('admgr').solo, 'test'); assert.equal(g('admgr').view, 'test'); assert.equal(els['sec-admgr'].style.display, 'block');
  assert.ok(!els['admgr-body'].innerHTML.includes('class="mtabs"')); assert.ok(els['admgr-title'].innerHTML.includes('테스트 소재'));
  g('showMenu')('abest'); assert.equal(g('admgr').view, 'best');
  g('showMenu')('admgr'); assert.equal(g('admgr').solo, null); assert.equal(g('admgr').view, 'camp'); assert.ok(els['admgr-body'].innerHTML.includes('class="mtabs"'));
});

console.log('⑥ 로컬 Claude 실행기 (문구생성·주간 해석)');
{
  const C = await import(new URL('scripts/claude.mjs', root));
  test('claudeError: 한도·로그인·미설치·기타를 한국어 한 문장으로', () => {
    assert.ok(C.claudeError("You've reached your Fable limit. Switch to another model").startsWith('Claude 사용량 한도 초과'));
    assert.ok(C.claudeError('Not logged in · Please run /login').startsWith('로그인이 필요'));
    assert.ok(C.claudeError('', { code: 'ENOENT', message: 'spawn claude ENOENT' }).startsWith('claude 명령을 찾을 수 없'));
    assert.equal(C.claudeError('\n  Something broke\nmore', null), 'Claude Code 실행 실패: Something broke');
  });
  const calls = [];
  const fail = (stdout, status = 1) => Object.assign(new Error('Command failed: claude'), { stdout, stderr: '', status });
  const fake = (_c, args) => { const m = args[args.indexOf('--model') + 1]; calls.push(m); if (m === 'claude-fable-5-1') throw fail("You've reached your Fable limit."); return '카피 본문'; };
  const log = process.stdout.write; process.stdout.write = () => true;
  let out; try { out = await C.runClaude('p', ['--x'], { exec: fake }); out += '|' + await C.runClaude('p2', [], { exec: fake }); } finally { process.stdout.write = log; }
  test('runClaude: Fable 한도면 Opus 5로 넘어가고 이후 호출도 Opus 5', () => {
    assert.equal(out, '카피 본문|카피 본문');
    assert.equal(calls.join(), 'claude-fable-5-1,claude-opus-5,claude-opus-5');
    assert.equal(C.claudeModel(), 'Opus 5 · 중간');
  });
  const allLimitErr = await C.runClaude('p', [], { exec: () => { throw fail("You've reached your Opus limit."); } }).then(() => null, e => e.message);
  const killedErr = await C.runClaude('p', [], { exec: async () => { throw Object.assign(new Error('killed'), { killed: true, stdout: '', stderr: '' }); }, timeoutMs: 12 * 60000 }).then(() => null, e => e.message);
  const ticks = []; const slow = await C.runClaude('p', [], { exec: () => new Promise(r => setTimeout(() => r('느린 응답'), 2300)), onTick: s => ticks.push(s) });
  test('runClaude: 마지막 모델도 한도면 한국어 오류, 시간 초과는 전환 없이 중단, 기다리는 동안 onTick', () => {
    assert.ok(/사용량 한도 초과/.test(allLimitErr), allLimitErr);
    assert.ok(/^시간 초과 — 12분/.test(killedErr), killedErr);
    assert.equal(slow, '느린 응답'); assert.ok(ticks.length >= 2 && ticks[ticks.length - 1] >= 1, ticks.join());   // 초 계산은 내림이라 첫 틱이 0일 수 있다
  });
  const seen = [];
    const fake2 = (_c, args) => { const m = args[args.indexOf('--model') + 1], e = args[args.indexOf('--effort') + 1]; seen.push(m + ':' + e); if (seen.length === 1) throw fail("You've reached your Opus limit."); return '문구'; };
    const log2 = process.stdout.write; process.stdout.write = () => true;
    let o; try { o = await C.runCopy('p', ['--y'], { exec: fake2 }) + '|' + await C.runCopy('p', [], { exec: fake2 }); } finally { process.stdout.write = log2; }
  test('runCopy: 광고 문구는 Opus 5 · 높음, 한도면 Fable 5.1 · 높음 (리포트 목록과 따로 기억)', () => {
    assert.equal(o, '문구|문구');
    assert.equal(seen.join(), 'claude-opus-5:high,claude-fable-5-1:high,claude-fable-5-1:high');
    assert.equal(C.claudeModel(C.COPY_MODELS), 'Fable 5.1 · 높음');
    assert.equal(C.claudeModel(), 'Opus 5 · 중간');   // 리포트용 목록 위치는 그대로
  });
}

console.log(`\n모두 통과 (${n}개)`);

function loadSource() {
  // 분리 전(단일 index.html) / 분리 후(js/*.js) 둘 다 지원
  const idx = fs.readFileSync(new URL('index.html', root), 'utf8');
  const files = [...idx.matchAll(/<script src="\.\/(js\/[^"]+)"><\/script>/g)].map(m => m[1]);
  if (files.length) return files.map(f => fs.readFileSync(new URL(f, root), 'utf8')).join('\n');
  return idx.slice(idx.lastIndexOf('<script>') + 8, idx.lastIndexOf('</script>'));
}
