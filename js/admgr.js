/* ④-3 광고관리자 (Meta): 상태·서버 호출·정렬·계층 3탭 렌더·오늘의 판정
   (index.html에서 분리 — 2026-09-08 2단계. 파일 순서는 index.html의 <script> 순서, 전역 함수·변수를 그대로 공유) */
'use strict';

/* ═══════════ ④-3 광고관리자 (Meta) — DNRB 이식 1단계: 읽기 전용 계층 뷰 ═══════════
   원본: danarobe/dnrb-dashboard #admgr (docs/광고관리자-이식-가이드.md 기준)
   지킨 것: 토큰은 서버에만(metaGet은 Edge Function만 호출) · 17자리 ID 문자열 비교 ·
            기본 정렬 최근 생성 순 · '기간 중 게재' 합집합 · 재렌더 시 표 스크롤 유지        */
const admgr = {
  view: 'camp',              // camp | set | ad | test | offad | best
  preset: 'today',
  activeOnly: true,          // 켜짐 또는 기간 중 지출>0 (원본 기본값)
  q: '',
  selCamps: new Set(), selSets: new Set(),
  mSelect: false,             // 폰 롱프레스 선택 모드 (2026-09-18)
  sort: [],                  // [{key, dir}] — 먼저 누른 열이 1순위
  data: null, demo: false, loading: false,
  /* 이식 2·3단계 탭 상태 (원본 admgrState.test/offad/best 그대로) */
  test:  { data: null, state: new Map(), filter: 'all', showHidden: false, sel: new Set(), loaded: false, loading: false },
  offad: { data: null, loading: false, loaded: false, start: null, end: null },   // 기간은 첫 조회 때 최근 7일로
  best:  { rows: null, ads: null, loading: false, loaded: false },                 // rows=best_ads 테이블, ads=creatives 응답
  /* '최근 변경' 열 — Meta 활동 로그의 오늘 예산 변경 이벤트 (byObj = Map(캠페인·세트 id → 이벤트[] 최신순)), seven = 최근 7일(모달) */
  budget: { byObj: null, loading: false, error: false, seven: null, sevenLoading: false },
  chgFilter: 'all',          // 오늘 예산 변경 필터: all / changed / up / down
  /* 예산 쓰기(4단계): st = meta-budget status 응답, pin = 인증된 PIN(메모리만 — 저장 금지), pendingByObj = Map(대상 id → 자정 예약 행), midMode = idle/setting/done */
  write: { st: null, pin: pinGet(), pendingByObj: null, midMode: 'idle' },   // pin: 잠그기 전까지 유지 (2026-09-04 사용자 요청 — 이 브라우저에만 저장, 서버는 매 요청 검증)
  /* 오늘의 판정(광고세트 탭, 오늘 칩): round r1(11시경)/r2(14시경) 수동 전환, judgeFilter = all/cut/warn/up/manual/reup,
     margins = 세트별 마진 수동 입력(id → 원), products = 카페24 상품(판매가·공급가) 캐시 */
  selAds: new Set(),
  customRange: lsGet('adc_admgr_range', null),   // 직접 지정 기간 {since, until} (2026-09-16)   // 광고 탭 선택 (복사용 — 2026-09-16)
  judgeFilter: 'all', role: 'ops', margins: lsGet('adc_admgr_margin', {}), products: lsGet('adc_admgr_products2', null), productsLoading: false,   // products2: product_no 포함 (2026-09-12 순이익 등급용)
};
const ADMGR_PRESETS = { today:'오늘', yesterday:'어제', last_7d:'최근 7일', last_30d:'최근 30일' };
const ADMGR_OWN = ['test', 'offad', 'best'];   // 자체 컨트롤을 쓰는 탭 (기간 칩·'활성만' 숨김)
const ADMGR_USER = '대시보드';                  // 판정·담기 기록자 이름 (원본은 로그인 이름 — 이 대시보드는 로그인 없음)

/* 판정 칩·오늘 예산 칩·최근 변경 열을 보여주는 기간 — 오늘 + 직접 지정 (2026-09-17 사용자 요청: 날짜를 직접 골라도 같은 화면). 판정은 그 기간의 지출·구매로, 예산 변경 칩은 오늘 이력 */
const admgrJudgeView = () => admgr.preset === 'today' || admgr.preset === 'custom';
/* 클릭 후 7일 구매·전환값 (2026-10-25 사용자: '구매(클릭7일)'·'ROAS(클릭7일)' 열과 판정을 클릭 후 1일 → 클릭 후 7일로, 조회 기여 제외).
   서버 캐시가 아직 옛 응답이면 purchases_7d가 없다 → 기본 창 − 조회 후 1일 (메타 실측: 기본 = 클릭7일 + 조회1일, 겹침 없음)로 계산 */
const admgrP7 = r => r.purchases_7d != null ? r.purchases_7d : Math.max(0, (r.purchases || 0) - (r.purchases_1dv || 0));
const admgrV7 = r => r.value_7d != null ? r.value_7d : (r.purchases > 0 ? (r.value || 0) * admgrP7(r) / r.purchases : (r.value || 0));   // 캐시 전 응답: 전환값을 구매 비율로 나눠 근사
/* PIN은 이 탭에서만(sessionStorage) — 2026-10-26 보안 점검: localStorage 평문은 같은 주소의 다른 페이지 구멍으로 새나갈 수 있어서. 예전 localStorage 값은 지운다 */
function pinGet() { try { localStorage.removeItem('adc_admgr_pin'); return sessionStorage.getItem('adc_admgr_pin') || null; } catch { return null; } }
function pinSet(pin) { try { if (pin) sessionStorage.setItem('adc_admgr_pin', pin); else sessionStorage.removeItem('adc_admgr_pin'); } catch { /* 무시 */ } }
function admgrCfg() {
  const c = window.DASH_CFG || {};
  return (c.SUPABASE_URL && c.SUPABASE_ANON_KEY) ? c : null;
}
function metaHeaders(cfg) {
  const tok = (AUTH.session && AUTH.session.access_token) || cfg.SUPABASE_ANON_KEY;   // 로그인 세션이 있으면 사용자 토큰, 아니면 anon(+로컬 DASH_KEY)
  return { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + tok,
    ...(cfg.DASH_KEY ? { 'x-dash-key': cfg.DASH_KEY } : {}) };
}
/* 서버 함수 공통 호출 (2026-09-08 1단계) — 모든 API 오류가 사람이 읽는 한 문장으로 나오는 유일한 자리.
   payload 없음 = GET, FormData = 그대로 POST, 그 외 = JSON POST. 게이트웨이 HTML 응답·네트워크 끊김도 여기서 문장으로 바꾼다. */
async function sbCall(fn, params, payload, _retried) {
  const cfg = admgrCfg();
  if (!cfg) throw new Error('config.js에 Supabase 연동 정보를 먼저 채워주세요 (SETUP 문서 참고)');
  // 로그인 확인(authInit)이 진행 중이면 끝날 때까지 기다린다(최대 8초) — 어떤 화면이 먼저 요청을 보내든 로그인 전 401이 안 생기게 (2026-10-27 구조적 방지)
  if (fn !== 'auth-admin' && typeof AUTH === 'object' && AUTH.initializing) { for (let i = 0; i < 80 && AUTH.initializing; i++) await new Promise(r => setTimeout(r, 100)); }
  const url = cfg.SUPABASE_URL + '/functions/v1/' + fn + '?' + new URLSearchParams(params);
  const headers = metaHeaders(cfg);
  const ds = typeof dnrbSession === 'function' ? dnrbSession() : null;
  if (ds) headers['x-dnrb-token'] = ds.token;   // 워크스페이스 SSO 세션 — 서버 getAuth가 워크스페이스 verify로 확인
  const init = payload === undefined ? { headers }
    : payload instanceof FormData ? { method: 'POST', headers, body: payload }
    : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
  let res;
  init.signal = AbortSignal.timeout(120_000);   // 2026-10-26 점검: 응답이 영영 안 오면 loading 플래그가 영구히 남던 것 — 2분이면 끊는다 (영상 4MB 조각 업로드도 충분)
  try { res = await fetch(url, init); }
  catch (e) { throw new Error(e && e.name === 'TimeoutError' ? '서버 응답이 2분 넘게 없어요 — 잠시 후 다시 시도하세요' : `서버에 연결할 수 없어요 (${e.message}) — 인터넷 연결 또는 서버 상태를 확인하세요`); }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : {}; } catch { /* JSON 아님 — 아래에서 처리 */ }
  if (body && !body.error && res.ok) return body;
  /* 워크스페이스(SSO) 세션과 401 (2026-09-21):
     · 우리 서버가 401을 줘도 바로 세션을 지우지 않는다 — 워크스페이스에 직접 다시 물어 진짜 거절(401 만료·403 권한 해제)일 때만 지운다. 인증 서버가 잠깐 느려도 로그아웃되지 않게.
     · 7일 토큰이 화면을 켜둔 채 만료되면 ds가 null이라 토큰 없이 나가 401 → "새로고침 후 로그인"이라고 하면 워크스페이스 계정은 자체 로그인 화면에서 막힌다. 다시 들어오는 길을 알려준다.
     ⚠ 403은 세션과 무관 — 2026-09-22 실사고: 서버에 '메뉴 권한 없으면 403'을 넣었더니 마케터의 소재 미리보기(adstats) 403에 세션이 통째로 지워져 그 뒤 화면이 전부 안 보였다. 403 = 그 동작만 권한 없음 */
  if (res.status === 401 && fn !== 'auth-admin' && typeof dnrbSession === 'function') {   // auth-admin(로그인 화면의 status 호출)은 제외 — 로그인 화면이 다시 로그인 화면을 부르는 되돌이 방지
    if (ds) {
      let dead = false;
      try { await dnrbApi({ action: 'verify', token: ds.token }); } catch (e) { dead = e.status === 401 || e.status === 403; }
      if (dead) { localStorage.removeItem(DNRB_KEY); authGate(DNRB_RELOGIN); }   // 만료 확정 → 바로 로그인 화면 + 다시 들어오는 길 안내 (2026-10-06)
      throw new Error(dead ? DNRB_RELOGIN : '로그인 확인이 잠시 안 됐어요 — 잠시 후 다시 시도하세요');
    }
    if (localStorage.getItem(DNRB_KEY)) {
      // 요청을 보낼 땐 세션이 없었는데 응답이 올 때쯤 생겼다 = 워크스페이스 자동 로그인(sso_redeem)과 첫 화면 요청의 경합 (2026-10-27 친구 제보: 들어오자마자 '만료' 화면).
      // 방금 받은 새 세션을 지우면 안 된다 → 그 토큰으로 같은 요청을 한 번 다시 보낸다. 진짜 기한(7일)이 지난 저장본일 때만 지운다
      if (!_retried && dnrbSession()) return sbCall(fn, params, payload, true);
      localStorage.removeItem(DNRB_KEY); authGate(DNRB_RELOGIN); throw new Error(DNRB_RELOGIN);
    }
    if (AUTH.session) {
      /* 직접 로그인 토큰이 서버에서 거부됨. 폰 탭이 뒤에 오래 있으면 자동 갱신 타이머가 멈춰 1시간짜리 토큰이 만료된 채 나간다(iOS) —
         먼저 한 번 갱신해 같은 요청을 다시 보내고, 갱신도 안 될 때만 로그인 화면으로. (2026-10-06)
         ⚠ signOut은 반드시 scope:'local' — 기본값(global)은 이 계정의 모든 기기 세션을 지워 다른 기기·탭이 새로고침마다 풀리던 실사고 */
      if (!_retried && AUTH.sb) {
        const { data } = await AUTH.sb.auth.refreshSession().catch(() => ({ data: {} }));
        if (data && data.session) { AUTH.session = data.session; return sbCall(fn, params, payload, true); }
      }
      const m = '로그인이 만료됐어요 — 다시 로그인하세요';
      AUTH.session = null; if (AUTH.sb) AUTH.sb.auth.signOut({ scope: 'local' }).catch(() => {}); authGate(m); throw new Error(m);
    }
  }
  if (!body) body = {};   // HTML·빈 응답: 상태 코드로 문장을 만든다 (성공(2xx)인데 JSON이 아니면 그것도 오류)
  const msg = body.error ? (body.message || body.error)              // 우리 서버 함수가 준 오류 (한국어)
    : SB_HTTP_MSG[res.status] || (res.status === 404 ? `서버 함수 '${fn}'가 아직 배포되지 않았어요` : res.status >= 500 ? `서버 오류 (HTTP ${res.status}) — 잠시 후 다시 시도`
    : res.ok ? `서버 응답을 읽을 수 없어요 (HTTP ${res.status}, JSON 아님)` : body.message || ('HTTP ' + res.status));   // 게이트웨이 오류
  throw new Error(msg);
}
const SB_HTTP_MSG = { 401: '로그인이 필요해요 (세션 만료 — 새로고침 후 다시 로그인)', 403: '권한이 없어요 (관리자만)', 413: '보내는 데이터가 너무 커요 (서버 한도 초과)', 429: '요청이 너무 잦아요 — 잠시 후 다시 시도' };
function metaGet(params) { return sbCall('meta-ads', params); }
function metaPost(params, payload) { return sbCall('meta-ads', params, payload); }
/* meta-budget 함수 (예산 쓰기) — 읽기 함수와 분리된 별도 엔드포인트 */
function metaBudgetCall(params, payload) { return sbCall('meta-budget', params, payload); }

async function admgrFetch() {
  if (!admgrCfg()) { toast('config.js에 Supabase 연동 정보를 먼저 채워주세요 (SETUP 문서 참고)'); return; }
  admgr.loading = true; admgr.demo = false; renderAdmgr();
  try {
    const cr = admgr.preset === 'custom' && admgr.customRange ? admgr.customRange : null;
    admgr.data = await metaGet({ action: 'hierarchy', preset: admgr.preset, ...(cr ? { since: cr.since, until: cr.until } : {}) });
    lsSet('adc_admgr_last', { preset: admgr.preset, range: admgr.customRange, data: admgr.data });   // 새로고침해도 마지막 데이터 유지 (2026-09-05 사용자 요청)
    admgr.budget = { byObj: null, loading: false, error: false, seven: null, sevenLoading: false };
    if (admgrJudgeView()) admgrBudgetFetch();   // '최근 변경' 열은 오늘·직접 지정 기간에서 (예산 변경 이력은 오늘 것)
    admgrWriteInit();                                     // 예산 쓰기 가능 여부(토큰·PIN 설정) 확인
    metaGet({ action: 'usage' }).then(u => { admgr.usage = u; renderAdmgr(true); }).catch(() => {});
    if (typeof admgrPromoEnsure === 'function' && typeof admgrAlert === 'object') { admgrAlert.h7At = 0; admgrPromoEnsure(); }   // 새로고침마다 승격 후보(7일)도 새로 (2026-10-26 사용자 요청)
    admgrMarkerSync();   // 소재가 들어간 캠페인 표시 정리 (우리 서버 → Meta 이름만, 10분에 한 번)   // Meta 사용량·쿨다운 표시 (우리 서버만 조회)
  } catch (e) {
    toast('Meta 불러오기 실패: ' + e.message);   // 실패해도 보고 있던 데이터는 유지
  }
  admgr.loading = false; renderAdmgr();
}
/* 메뉴 진입: 마지막으로 받아둔 데이터만 보여준다. Meta 조회는 사용자가 'Meta 불러오기'를 누를 때만 (2026-09-05 사용자 지정 — 자동 갱신 안 함) */
/* 단독 화면(소재 메뉴의 테스트 소재·베스트소재): 같은 섹션·같은 코드, 탭 스트립만 숨기고 제목을 바꾼다. 광고관리자로 돌아오면 이전 탭 복원 */
function admgrSolo(view) {
  if (!admgr.solo) admgr.prevView = admgr.view;
  admgr.solo = view;
  $('admgr-title').innerHTML = view === 'test' ? '<i class="fa-solid fa-flask" style="color:#4f46e5;font-size:.9em;"></i> 테스트 소재' : '<i class="fa-solid fa-star" style="color:#4f46e5;font-size:.9em;"></i> 베스트소재';
  $('admgr-note').style.display = 'none';
  admgrSetView(view);
}
function admgrOpen() {
  admgr.role = 'ops'; admgr.judgeFilter = 'all';   // 메뉴로 들어오면 늘 운영 역할부터 (2026-10-01 '항상 운영중으로 열리게')
  if (admgr.solo) { admgr.view = admgr.prevView || 'camp'; admgr.solo = null; $('admgr-note').style.display = ''; $('admgr-title').innerHTML = '<i class="fa-brands fa-meta" style="color:#4f46e5;font-size:.9em;"></i> 광고관리자 (Meta)'; }
  if (!admgr.data && !admgr.demo && admgrCfg()) {
    const c = lsGet('adc_admgr_last', null);
    if (c && c.data) { admgr.data = c.data; admgr.preset = c.preset || admgr.preset; if (c.range) admgr.customRange = c.range; admgrWriteInit(); }   // 예산 편집 버튼용 상태만 (우리 서버, Meta 호출 아님)
  }
  renderAdmgr();
}
function admgrSetPreset(p) {
  admgr.preset = p; admgr.chgFilter = 'all';
  if (admgr.demo) { admgr.data = admgrDemoData(); renderAdmgr(); }
  else if (admgr.data) admgrFetch();
  else renderAdmgr();
}
/* 탭 전환 — 자체 데이터 탭은 첫 진입 때 자동 조회 */
function admgrSetView(v) {
  admgr.view = v;
  admgr.mSelect = false;   // 탭·뷰 전환 시 선택 모드는 나가되, selCamps/selSets는 그대로 둔다 (다음 탭의 필터로 씀 — D)
  const t = admgr.test, o = admgr.offad, b = admgr.best;
  /* 첫 진입: 마지막에 받아둔 데이터만 보여준다. 새로 받는 건 '새로고침'을 누를 때만 (자동 조회 없음 — 2026-09-05 사용자 지정) */
  if (v === 'test' && !t.loaded) {
    const c = lsGet('adc_admgr_test', null);
    if (c && c.data) { t.data = c.data; t.state = new Map(c.state || []); t.loaded = true; }
  }
  if (v === 'offad' && !o.loaded) {
    const c = lsGet('adc_admgr_off', null);
    if (c && c.data) { o.data = c.data; o.start = c.start; o.end = c.end; o.loaded = true; }
  }
  if (v === 'best' && !b.loaded) {
    const c = lsGet('adc_admgr_best', null);
    if (c && c.rows) { b.rows = c.rows; b.ads = c.ads || []; b.loaded = true; }
  }
  renderAdmgr();
}
function admgrRefresh() {
  admgr.test.creatives = null; admgrMakerLoad();   // 만든 사람 기록도 같이 최신으로
  if (admgr.view === 'test') admgrTestFetch();
  else if (admgr.view === 'offad') admgrOffFetch();
  else if (admgr.view === 'best') admgrBestFetch();
  else admgrFetch();
}
function admgrBusy() {
  return admgr.view === 'test' ? admgr.test.loading : admgr.view === 'offad' ? admgr.offad.loading
    : admgr.view === 'best' ? admgr.best.loading : admgr.loading;
}
function admgrToggleActive() { admgr.activeOnly = !admgr.activeOnly; renderAdmgr(); }
let admgrQTimer = null;
function admgrSearchToggle() {   // 폰 검색 아이콘 — 열면 입력칸 표시·포커스, 닫으면 검색어도 지움 (2026-09-18)
  admgr.mSearch = !(admgr.mSearch || admgr.q);
  if (!admgr.mSearch) admgr.q = '';
  if (document.activeElement && document.activeElement.id === 'admgr-q') document.activeElement.blur();   // 포커스가 있으면 부분 렌더로 검색줄이 안 닫힘
  renderAdmgr(true);
  if (admgr.mSearch) setTimeout(() => { const i = $('admgr-q'); if (i) i.focus(); }, 0);
}
function admgrPeriodMenu(ev) {   // 폰 기간 드롭다운 — 오늘·어제·7일·30일·직접 지정
  admgrPopAt(ev, `<div class="ag-menu">${Object.entries(ADMGR_PRESETS).map(([k, t]) =>
    agItem(admgr.preset === k ? 'fa-check' : 'fa-calendar-day', t, `admgrSetPreset('${k}')`)).join('')}${agItem(admgr.preset === 'custom' ? 'fa-check' : 'fa-calendar', '기간 직접 지정', 'admgrRangeModal()')}</div>`, 220);
}
function admgrSearch(v) { clearTimeout(admgrQTimer); admgrQTimer = setTimeout(() => { admgr.q = v.trim().toLowerCase(); renderAdmgr(true); }, 200); }

/* 정렬: 클릭 = 오름 → 내림 → 해제, 먼저 누른 열이 1순위 (원본 다중 정렬) */
/* 폰 정렬 — 한 번에 한 기준만: 큰 순 → 작은 순 → 해제 (PC 머리글은 다중 정렬·오름차순부터) */
function admgrSortM(key) {
  const cur = admgr.sort.length === 1 && admgr.sort[0].key === key ? admgr.sort[0].dir : 0;
  admgr.sort = cur === 0 ? [{ key, dir: -1 }] : cur === -1 ? [{ key, dir: 1 }] : [];
  renderAdmgr();
}
function admgrSortClick(key) {
  const i = admgr.sort.findIndex(s => s.key === key);
  if (i < 0) admgr.sort.push({ key, dir: 1 });
  else if (admgr.sort[i].dir === 1) admgr.sort[i].dir = -1;
  else admgr.sort.splice(i, 1);
  renderAdmgr(true);
}
/* ⚠ Meta id는 17자리 — Number() 비교는 2^53 초과로 정밀도가 깨진다 → 자릿수→사전순 문자열 비교 (가이드 §7-3) */
function admgrIdCmp(a, b) {
  a = String(a || ''); b = String(b || '');
  return a.length !== b.length ? a.length - b.length : (a < b ? -1 : a > b ? 1 : 0);
}
function admgrVal(r, key) {
  switch (key) {
    case 'name':  return r.name || '';
    case 'aname': return r.adset_name || '';          // 테스트 소재 탭 대표명 = 광고세트명
    case 'reg':   return r.reg_date || '';             // 등록일 (문자열 비교로 충분 — YYYY-MM-DD)
    case 'offd':  return r.off_time || '';             // OFF 시각
    case 'budget':return (r.budget || 0) + (r.budget_life || 0);
    case 'spend': return r.spend || 0;
    case 'clicks':return r.clicks || 0;
    case 'purch': case 'purchases': return r.purchases || 0;
    case 'cpa':   return r.purchases ? r.spend / r.purchases : -1;   // 구매 0은 최하위
    case 'cpc':   return r.clicks ? r.spend / r.clicks : -1;
    case 'value': return r.value || 0;
    case 'roas':  return r.spend ? r.value / r.spend : -1;
    case 'purch1': return admgrP7(r);
    case 'roas1': return r.spend ? admgrV7(r) / r.spend : -1;
    case 'proj':  { const p = admgrProj(r); return p == null || admgrP7(r) > 0 ? -1 : p; }   // 예상 마감 % — 구매 있는 세트는 맨 아래
    default: return 0;
  }
}
const ADMGR_STR_KEYS = ['name', 'aname', 'reg', 'offd'];
function admgrCmp(x, y) {
  const ox = x.status === 'ACTIVE' ? 0 : 1, oy = y.status === 'ACTIVE' ? 0 : 1;   // 꺼진 것(기간 중 게재 포함)은 어떤 정렬이든 맨 아래 (2026-10-22 사용자 요청)
  if (ox !== oy) return ox - oy;
  for (const s of admgr.sort) {
    if (ADMGR_STR_KEYS.includes(s.key)) {
      const c = String(admgrVal(x, s.key)).localeCompare(String(admgrVal(y, s.key)), 'ko');
      if (c) return c * s.dir; continue;
    }
    const vx = admgrVal(x, s.key), vy = admgrVal(y, s.key);
    if (vx !== vy) return (vx - vy) * s.dir;
  }
  /* 운영 역할 + 광고세트 탭 + 오늘: 열 정렬이 없으면 예상 마감 높은 순(구매 0 먼저) — 2026-10-26 사용자 승인 기본값 */
  if (!admgr.sort.length && admgr.role === 'ops' && admgr.view === 'set' && admgrJudgeView()) { const px = admgrVal(x, 'proj'), py = admgrVal(y, 'proj'); if (px !== py) return py - px; }
  /* 기본 = 메타 광고관리자와 같은 '최근 생성 순' (created 내림차순, 없으면 id — id도 시간순) */
  const cx = x.created || x.created_time || '', cy = y.created || y.created_time || '';
  if (cx && cy && cx !== cy) return cx < cy ? 1 : -1;
  return -admgrIdCmp(x.id, y.id);
}

/* 계층 평탄화 — 부모 참조를 붙여 선택 연동에 쓴다 */
function admgrRows() {
  const d = admgr.data;
  if (!d || !d.campaigns) return { camps: [], sets: [], ads: [] };
  const camps = [], sets = [], ads = [];
  for (const c of d.campaigns) {
    camps.push(c);
    for (const s of (c.adsets || [])) {
      s._campId = c.id; s._campName = c.name; s._cbo = c.budget > 0 || c.budget_life > 0; sets.push(s);   // 역할 보기 (2026-10-26): 캠페인 예산 = CBO
      for (const a of (s.ads || [])) {
        a._setId = s.id; a._setName = s.name; a._campId = c.id; a._cbo = s._cbo; a._test = admgrIsTest(s); ads.push(a);
      }
    }
  }
  return { camps, sets, ads };
}
function admgrVisible(rows) {
  let r = rows;
  if (admgr.activeOnly) r = r.filter(x => x.status === 'ACTIVE' || (x.spend || 0) > 0);
  if (admgr.q) r = r.filter(x => String(x.name || '').normalize('NFC').toLowerCase().includes(admgr.q.normalize('NFC')));   // NFD 세트명도 검색되게
  return r.slice().sort(admgrCmp);
}

/* 선택 연동: 캠페인 선택 해제 시 그 밖의 세트 선택 자동 정리 (원본 admgrPruneSel — 몰래 필터 남는 사고 방지) */
function admgrPruneSel() {
  if (!admgr.selCamps.size) return;
  const { sets } = admgrRows();
  const ok = new Set(sets.filter(s => admgr.selCamps.has(s._campId)).map(s => s.id));
  for (const id of [...admgr.selSets]) if (!ok.has(id)) admgr.selSets.delete(id);
}
function admgrToggleCamp(id) {
  if (admgr.selCamps.has(id)) admgr.selCamps.delete(id); else admgr.selCamps.add(id);
  admgrPruneSel(); renderAdmgr(true);
}
function admgrToggleSet(id) {
  if (admgr.selSets.has(id)) admgr.selSets.delete(id); else admgr.selSets.add(id);
  renderAdmgr(true);
}
function admgrDrill(kind, id) {
  if (kind === 'camp') { admgr.selCamps = new Set([id]); admgrPruneSel(); admgr.view = 'set'; }
  else { admgr.selSets = new Set([id]); admgr.view = 'ad'; }
  renderAdmgr();
}
function admgrToggleAd(id) {
  if (admgr.selAds.has(id)) admgr.selAds.delete(id); else admgr.selAds.add(id);
  renderAdmgr(true);
}
function admgrClearSel() { admgr.selCamps.clear(); admgr.selSets.clear(); admgr.selAds.clear(); renderAdmgr(true); }
/* 헤더 체크박스 — 지금 표에 보이는 행(검색·활성만·필터 반영) 전체 선택/해제 */
function admgrSelAllDisp() {
  const isCamp = admgr.view === 'camp';
  const set = isCamp ? admgr.selCamps : admgr.view === 'ad' ? admgr.selAds : admgr.selSets;
  const ids = admgr._dispIds || [];
  const all = ids.length && ids.every(id => set.has(id));
  ids.forEach(id => all ? set.delete(id) : set.add(id));
  if (isCamp) admgrPruneSel();
  renderAdmgr(true);
}

/* 게재 열 — Meta식 점 + 글자 */
function admgrStBadge(st) {
  if (st === 'ACTIVE') return '<span class="mdot"></span>활성';
  if (!st) return '<span class="mdot off"></span><span style="color:#65676b;" title="현재 목록엔 없지만 기간 중 지출이 있던 광고">기간 중 게재</span>';
  if (/PAUSED/.test(st)) return '<span class="mdot off"></span>꺼짐';
  if (st === 'IN_PROCESS' || st === 'PENDING_REVIEW') return '<span class="mdot warn"></span>검토 중';
  if (st === 'DISAPPROVED' || st === 'WITH_ISSUES') return '<span class="mdot bad"></span>문제 있음';
  return '<span class="mdot off"></span>' + esc(st);
}
/* 켜기/끄기 토글 (2026-09-07) — 쓰기 가능(토큰·PIN)하면 클릭으로 status 변경, 아니면 보기용 */
/* 토글은 즉시 반영이 아니라 '임시 저장'(id → {level,name,status}) — '임시 저장 전체 게시'에서 예산과 함께 반영 (2026-09-07 사용자 요청) */
const admgrSDraft = lsGet('adc_admgr_sdraft', {});
function admgrOnOff(r, level) {
  if (!r.status) return '<span style="color:#ccd0d5;">—</span>';
  const d = admgrSDraft[r.id];
  const on = d ? d.status === 'ACTIVE' : r.status === 'ACTIVE';
  const can = admgr.write.st && admgr.write.st.allowed && !admgr.demo && dnrbCan('toggle');
  const tip = d ? `임시 저장됨 (${on ? '켜기' : '끄기'} 예정) — 클릭하면 취소, 게시는 위의 '임시 저장 전체 게시'` : `${on ? '켜짐' : '꺼짐'}${can ? ' — 클릭하면 ' + (on ? '끄기' : '켜기') + ' 임시 저장' : ''}`;
  return `<span class="mtg ${on ? '' : 'off'} ${d ? 'pend' : ''} ${can ? '' : 'ro'}" title="${tip}" ${can ? `onclick="event.stopPropagation();admgrToggleStatus('${r.id}','${level}')"` : ''}></span>${d ? '<div style="font-size:.6rem;color:#b45309;">임시</div>' : ''}`;
}
function admgrToggleStatus(id, level) {
  const R = admgrRows();
  const node = (level === 'campaign' ? R.camps : level === 'adset' ? R.sets : R.ads).find(x => x.id === id); if (!node) return;
  if (admgrSDraft[id]) { delete admgrSDraft[id]; toast('켜기/끄기 임시 저장을 취소했어요'); }
  else {
    const next = node.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    admgrSDraft[id] = { level, name: node.name, status: next };
    toast(`${next === 'ACTIVE' ? '켜기' : '끄기'} 임시 저장 — '임시 저장 전체 게시'에서 반영돼요`);
  }
  lsSet('adc_admgr_sdraft', admgrSDraft); renderAdmgr(true);
}
function admgrBudget(r) {
  if (r.budget) return '일 ' + won(r.budget);
  if (r.budget_life) return '총 ' + won(r.budget_life);
  return '<span style="color:#d1d5db;">—</span>';
}
function admgrAgo(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? s + '초 전' : Math.round(s / 60) + '분 전';
}
/* 조회 의존 (2026-10-22, 10-25 클릭7일 기준으로): 클릭 후 7일 구매와 조회 후 1일 구매를 나란히 놓고, 조회 쪽이 클릭 쪽 이상이면(=전체의 절반↑) '조회 의존'. 합이 3건↑일 때만.
   (메타 기본 창 = 클릭7일 + 조회1일, 겹침 없음 — 10/25 실측) */
const admgrViewDep = r => { const c = admgrP7(r), v = r.purchases_1dv || 0; return c + v >= 3 && v >= c; };
const admgrViewBadge = r => admgrViewDep(r) ? ` <span class="status-badge badge-yellow" style="font-size:.6rem;padding:1px 5px;" title="클릭 후 7일 구매 ${comma(admgrP7(r))}건 · 조회 후 1일 구매 ${comma(r.purchases_1dv || 0)}건 — 광고를 누르지 않고 산 사람이 누른 사람보다 많아요. 판단은 ROAS(클릭7일)·구매(클릭7일) 열로">조회 의존</span>` : '';
const admgrRoas1Td = r => r.spend ? (admgrV7(r) / r.spend < 1 ? `<b style="color:#dc2626;">${(admgrV7(r) / r.spend).toFixed(2)}</b>` : (admgrV7(r) / r.spend).toFixed(2)) : '—';   // 클릭 1일 ROAS (2026-10-22) — 조회 의존 배지는 세트명 옆 (사용자 요청)
const admgrRoasTd = r => r.spend ? (r.value / r.spend < 1 ? `<b style="color:#dc2626;">${(r.value / r.spend).toFixed(2)}</b>` : (r.value / r.spend).toFixed(2)) : '—';   // 1 미만만 강조 (전부 색칠하면 소음)
const admgrMoney = v => v ? won(v) : '—';
const admgrCpa = r => r.purchases ? won(r.spend / r.purchases) : '—';
/* 정렬 표시 머리글 */
function admgrTh(key, label, cls, title) {
  const i = admgr.sort.findIndex(s => s.key === key);
  const ar = i < 0 ? '' : (admgr.sort[i].dir === 1 ? ' ▲' : ' ▼') + (admgr.sort.length > 1 ? '<sup>' + (i + 1) + '</sup>' : '');
  return `<th class="sortable ${cls || ''}" onclick="admgrSortClick('${key}')" title="${esc(title || '클릭: 오름차순 → 내림차순 → 해제')}">${label}${ar}</th>`;
}
const admgrTile = (label, val) => `<div class="kpi-tile"><div class="kt-label">${label}</div><div class="kt-value" style="font-size:1.15rem;">${val}</div></div>`;

/* ═══ 메인 렌더 — 공통(배너·컨트롤·탭) + 탭별 본문 ═══ */
function renderAdmgr(keepScroll) {
  const body = $('admgr-body');
  const cfg = admgrCfg();
  if (!admgr.mk.tried) { admgr.mk.tried = true; admgrMakerLoad(); }   // 세트별 수동 지정분 — 첫 렌더에 한 번만
  /* 재렌더 시 표 스크롤 유지 (가이드 §7-10) + 검색창 포커스 유지 */
  const wrap = body.querySelector('.table-wrap');
  const sc = keepScroll && wrap ? { t: wrap.scrollTop, l: wrap.scrollLeft } : null;
  const pageY = window.scrollY;   // innerHTML 교체 순간 페이지가 줄었다 늘어나며 스크롤이 튀는 것 방지 (2026-09-06 사용자 지적)
  const hadFocus = document.activeElement && document.activeElement.id === 'admgr-q';

  /* ── 상단 도구 바 (2026-09-14 리디자인 A+B): 상태 알약 + 주 동작 1개(새로고침) + 23:45 세팅 + ⋯ 메뉴. 설명문은 툴팁으로 ── */
  const own = ADMGR_OWN.includes(admgr.view);
  const busy = admgrBusy();
  const w = admgr.write;
  let status = '';
  if (!cfg && !admgr.demo) status = `<span class="ag-pill warn" title="SETUP-광고관리자.md 순서대로 Supabase·Meta 토큰을 준비하고 config.js를 채우면 실데이터가 나와요">연동 전</span>`;
  else if (admgr.demo) status = `<span class="ag-pill" title="실제 연동 후에는 이 자리에 내 광고계정이 나와요">데모 데이터</span>`;
  else if (!own && admgr.data) {
    const m = admgr.data._meta || {}, u = admgr.usage || {};
    const until = m.cooldown_until || u.cooldown_until;
    const pct = u.usage_pct != null ? u.usage_pct : m.usage_pct;
    const range = admgr.data.range ? admgr.data.range.start + ' ~ ' + admgr.data.range.end : '';
    status = until
      ? `<span class="ag-pill warn" title="Meta 조회 한도 대기 중 — ${admgrKstLabel(until)} 이후 자동 재시도 · 마지막으로 받은 데이터를 보여주고 있어요${u.cooldown_error ? '\n원인: ' + esc(u.cooldown_error) : ''}"><span class="dot"></span>한도 대기 · ${admgrKstLabel(until)}까지</span>`
      : `<span class="ag-pill ok" title="${esc(range)} 기준 · ${m.sync_at ? '서버가 5분마다 Meta에서 받아 저장해 두고, 화면은 저장된 것만 읽어요 (새로고침해도 Meta 호출이 늘지 않아요)' : '서버 5분 캐시'}${pct != null ? ' · Meta 사용량 ' + Math.round(pct) + '%' : ''}"><span class="dot"></span><span class="ag-hide-m">${m.sync_at ? '자동 수집' : '캐시'} · </span>${admgrAgo(admgr.data.fetched_at)}</span>`;
    if (admgr.data.truncated) status += `<span class="ag-pill warn" title="500개 한도로 일부가 잘렸어요">일부 잘림</span>`;
  }
  const canWrite = !own && !admgr.demo && !!w.st && dnrbCan('budget');
  const nd = canWrite ? admgrDraftTargets().length : 0;
  const npend = w.pendingByObj ? w.pendingByObj.size : 0;
  /* 폰 전용 상태를 body 클래스로 — .mnav는 #sec-admgr 밖이라 CSS로 여기서만 훅을 걸 수 있다 (2026-09-18) */
  document.body.classList.toggle('admgr-selecting', admgr.mSelect && admgrMobile());
  document.body.classList.toggle('admgr-pending', admgrMobile() && !admgr.mSelect && nd > 0);
  const midState = w.midMode === 'setting' ? `<span class="ag-tag amber">세팅중${npend ? ' · ' + npend : ''}</span>`
    : w.resetRow ? '<span class="ag-tag green">원복 승인됨</span>' : (npend ? `<span class="ag-tag">예약 ${npend}</span>` : '');
  const toolbar = `<div class="ag-bar">
      <b class="ag-mtitle">${admgr.solo === 'test' ? '테스트 소재' : admgr.solo === 'best' ? '베스트소재' : '광고관리자'}</b>
      ${status}
      <span style="flex:1;"></span>
      ${canWrite ? `<button class="btn-ghost ag-btn ag-hide-m" onclick="admgrMidMenu(event)" title="23:45 세팅 — 반영 세팅 시작/완료 · 원복 승인 · 예약 목록"><i class="fa-regular fa-clock"></i> 23:45 세팅${midState}</button>` : ''}
      ${nd ? `<button class="btn-analyze ag-btn ag-btn-publish" style="background:#0a7c3f;" onclick="admgrPublishDrafts()" title="임시 저장해둔 예산·켜기/끄기를 한 번에 Meta에 게시"><i class="fa-solid fa-paper-plane"></i> 게시 ${nd}</button>` : ''}
      ${cfg && !admgr.demo ? `<button class="btn-analyze ag-btn" onclick="admgrRefresh()" ${busy ? 'disabled' : ''} title="${own ? '서버에서 다시 불러오기' : 'Meta에서 다시 불러오기'}"><i class="fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-rotate'}"></i><span class="ag-hide-m"> ${busy ? '불러오는 중' : '새로고침'}</span></button>` : ''}
      ${!cfg || admgr.demo ? `<button class="btn-sample ag-btn" onclick="admgrDemo()"><i class="fa-solid fa-wand-magic-sparkles"></i> 데모 데이터로 보기</button>` : ''}
      <button class="btn-ghost ag-btn ag-icon-m ${admgr.mSearch || admgr.q ? 'on' : ''}" onclick="admgrSearchToggle()" aria-label="검색"><i class="fa-solid fa-magnifying-glass"></i></button>
      <button class="btn-ghost ag-btn ag-more" onclick="admgrMoreMenu(event)" title="더 보기 — PIN · 열 · 임시 저장 · 예약 목록"><i class="fa-solid fa-ellipsis"></i></button>
    </div>`;
  const filters = `<div class="ag-filters ${admgr.mSearch || admgr.q ? 'm-open' : ''}">
      ${own ? '' : `<span class="ag-seg">${Object.entries(ADMGR_PRESETS).map(([k, t]) => `<button class="${admgr.preset === k ? 'on' : ''}" onclick="admgrSetPreset('${k}')">${t.replace('최근 ', '')}</button>`).join('')}<button class="${admgr.preset === 'custom' ? 'on' : ''}" onclick="admgrRangeModal()" title="기간 직접 지정"><i class="fa-regular fa-calendar"></i>${admgr.preset === 'custom' && admgr.customRange ? ` ${esc(admgr.customRange.since.slice(5))}~${esc(admgr.customRange.until.slice(5))}` : ' 직접'}</button></span>
      <label class="ag-check" title="켜져 있는 것만 표시"><input type="checkbox" ${admgr.activeOnly ? 'checked' : ''} onchange="admgrToggleActive()" /> 활성만</label>${admgr.view === 'set' ? admgrMakerBtn('ag-hide-m') : ''}`}
      <span class="ag-search"><i class="fa-solid fa-magnifying-glass"></i><input class="inp" id="admgr-q" placeholder="${own ? '세트명·소재명 검색' : '이름 검색'}" value="${esc(admgr.q)}" oninput="admgrSearch(this.value)" /></span>
      <span style="flex:1;"></span>
      ${!own ? `<button class="btn-ghost ag-btn ag-hide-m" onclick="admgrColsMenu(event)" title="표시할 열 선택 · 드래그로 순서 변경 (기본은 핵심 열만, 나머지는 행 끝 ∨로 펼치기)"><i class="fa-solid fa-table-columns"></i> 열</button>` : ''}
    </div>`;
  const controls = toolbar + filters;
  const banner = typeof admgrAlertPanel === 'function' ? admgrAlertPanel() : '';   // 알림판 (admgr-alerts.js) — 켜진 일예산 합계·상한·검사 항목
  if (admgr.data && !admgr.demo && typeof admgrAlertCfgEnsure === 'function') setTimeout(() => admgrAlertCfgEnsure(), 0);

  /* 탭 (건수 포함 — 조회 전이면 숫자 생략) */
  const R = admgrRows();
  const setsInSel = admgr.selCamps.size ? R.sets.filter(s => admgr.selCamps.has(s._campId)) : R.sets;
  const adsInSel = admgr.selSets.size ? R.ads.filter(a => admgr.selSets.has(a._setId))
    : admgr.selCamps.size ? R.ads.filter(a => admgr.selCamps.has(a._campId)) : R.ads;
  const t = admgr.test;
  const testCount = t.loaded ? ((t.data || {}).ads || []).filter(a => !(t.state.get(a.id) || {}).hidden).length : null;
  const tabDefs = [
    ['camp', '캠페인', admgr.data ? admgrVisible(R.camps).length : null],
    ['set', '광고세트', admgr.data ? admgrVisible(setsInSel).length : null],
    ['ad', '광고', admgr.data ? admgrVisible(adsInSel).length : null],
    ['test', '테스트 소재', testCount],
    ['offad', 'OFF 광고', admgr.offad.loaded ? admgr.offad.data.count : null],
    ['best', '베스트', admgr.best.loaded ? (admgr.best.rows || []).length : null],
  ];
  /* 밑줄형 탭 스트립 (캠페인 / 광고세트 / 광고 | 테스트 소재 / OFF / 베스트) — 선택 표시줄은 하단 동작 바로 이동 (2026-09-14) */
  const perLabel = admgr.preset === 'custom' && admgr.customRange ? `${admgr.customRange.since.slice(5)}~${admgr.customRange.until.slice(5)}` : (ADMGR_PRESETS[admgr.preset] || '오늘');
  const periodBtn = own ? '' : `<button class="ag-period" onclick="admgrPeriodMenu(event)" aria-label="기간"><span>${esc(perLabel)}</span><i class="fa-solid fa-chevron-down"></i></button>`;
  const tabs = `<div class="ag-tabrow">${periodBtn}<div class="mtabs">${tabDefs.map(([k, label, n], i) =>
    `${i === 3 ? '<span class="mtab-sep"></span>' : ''}<button class="mtab ${admgr.view === k ? 'on' : ''} ${i >= 3 ? 'mtab-x' : ''}" onclick="admgrSetView('${k}')">${label}${n == null ? '' : ` <span class="n">${n}</span>`}</button>`).join('')}</div></div>`;

  let main;
  if (admgr.view === 'test') main = renderAdmgrTest();
  else if (admgr.view === 'offad') main = renderAdmgrOff();
  else if (admgr.view === 'best') main = renderAdmgrBest();
  else main = renderAdmgrHier(R, setsInSel, adsInSel, cfg);

  /* 검색창에 커서가 있을 때(타이핑 중)는 컨트롤 바를 그대로 두고 그 아래만 다시 그린다 — 입력칸까지 새로 만들면 폰에서 키보드가
     닫혔다 열리며 화면이 깜빡이고 한글 조합이 끊겼다 (2026-09-13 사용자 제보) */
  /* 임시 저장 게시 대기 바 (C, 폰 전용) — 선택 모드 중엔 하단이 선택 패널 차지라 숨김 */
  const pubBar = (admgrMobile() && !admgr.mSelect && nd > 0)
    ? `<div class="ag-pubbar"><div><b>임시 저장 ${nd}개</b><small>Meta엔 아직 반영 전</small></div><button onclick="admgrPublishDrafts()">게시</button></div>` : '';
  const rest = (admgr.solo ? '' : tabs) + main + pubBar;
  if (hadFocus && $('admgr-rest') && $('admgr-banner')) { $('admgr-banner').innerHTML = banner; $('admgr-rest').innerHTML = rest; }
  else body.innerHTML = `<div id="admgr-banner">${banner}</div>${controls}<div id="admgr-rest">${rest}</div>`;
  window.scrollTo(0, pageY);
  if (sc) { const w = body.querySelector('.table-wrap'); if (w) { w.scrollTop = sc.t; w.scrollLeft = sc.l; } }
  if (['camp', 'set', 'ad'].includes(admgr.view)) admgrColsApply();   // 열 표시/순서 (Meta의 '열' 메뉴) — 너비 적용보다 먼저
  admgrColResize();   // 표를 새로 그릴 때마다 핸들 재부착 + 저장된 너비 재적용 (원본 규칙)
}

/* ═══ 계층 3탭 (1단계) ═══ */
function renderAdmgrHier(R, setsInSel, adsInSel, cfg) {
  if (!admgr.data) {
    return `<div class="empty-state"><div class="es-icon"><i class="fa-brands fa-meta"></i></div>
      <p>${admgr.loading ? '불러오는 중…' : cfg
        ? '<b>새로고침</b>을 누르면 캠페인 → 광고세트 → 광고 현황이 나옵니다.'
        : '연동 전이라면 <b>데모 데이터로 보기</b>로 화면을 먼저 구경해 보세요.'}</p></div>`;
  }
  const isCamp = admgr.view === 'camp', isSet = admgr.view === 'set';
  const VIEW_LABEL = isCamp ? '캠페인' : isSet ? '광고세트' : '광고';
  let vis = isCamp ? admgrVisible(R.camps) : isSet ? admgrVisible(setsInSel) : admgrVisible(adsInSel);
  /* 만든 사람 거르기 (2026-09-20): 광고세트 탭 — 평소엔 아무 표시 없고, '만든 사람 ▾'로 골랐을 때만 그 사람 세트 + 알림 한 줄 */
  let mkBan = '';
  if (isSet && admgr.mk.filter !== 'all') { vis = vis.filter(r => admgrMakerPass(null, r.id, r.name)); mkBan = admgrMakerBanner(vis, true); }
  /* 역할 보기 (2026-10-26 사용자 승인): 전체 · 테스트 · 운영 · CBO — 세 탭 공통 필터, 버튼에 그 역할의 개수·지출·구매. 캠페인 탭은 CBO/세트 예산 둘만 */
  const roleSum = L => { let sp = 0, pu = 0; for (const r of L) { sp += r.spend || 0; pu += r.purchases || 0; } return `${sp >= 1e4 ? (Math.round(sp / 1000) / 10).toLocaleString() + '만' : comma(sp)} · ${comma(pu)}건`; };
  const ROLES = isCamp ? [['all', '전체'], ['ops', '세트 예산'], ['cbo', 'CBO']] : [['all', '전체'], ['test', '테스트'], ['ops', '운영'], ['cbo', 'CBO']];
  const roleCur = isCamp && admgr.role === 'test' ? 'ops' : admgr.role;
  const roleRow = `<div class="filter-tabs ag-role" style="margin-bottom:10px;"><span class="ag-lbl">역할</span>${ROLES.map(([k, l]) => { const L = vis.filter(r => admgrRolePass(r, k)); return `<button class="filter-tab ${roleCur === k ? 'active' : ''}" onclick="admgrRoleSet('${k}')" title="${k === 'test' ? '테스트 캠페인 안 _test 세트' : k === 'ops' ? (isCamp ? '캠페인 예산이 없는 캠페인' : '테스트 캠페인 안 test 없는 세트') : k === 'cbo' ? '캠페인 예산이 있는 캠페인 (리타겟팅 포함)' : '모든 역할'}">${l} <small class="ag-muted">${L.length} · ${roleSum(L)}</small></button>`; }).join('')}</div>`;
  if (admgr.role !== 'all') vis = vis.filter(r => admgrRolePass(r, admgr.role));

  /* '최근 변경' 열(오늘·캠페인/세트 탭) · '자정세팅' 열 · '판정' 열 표시 여부 (원본 규칙) */
  const bb = admgr.budget;
  const showChg = admgrJudgeView() && (isCamp || isSet) && !admgr.demo;
  const showMid = !!(admgr.write.st && admgr.write.st.allowed) && isSet && !admgr.demo && dnrbCan('budget');   // '자정세팅' 열 — 광고세트 탭만 (캠페인 예산은 수동 — 2026-09-04 사용자 지정)
  const showJudge = isSet && admgrJudgeView() && !admgr.demo;   // '판정' 열 — 광고세트 탭 + 오늘
  /* 오늘 할 일 줄 (2026-10-26 사용자 승인: 역할·오늘 예산·판정 세 줄 → 역할 + 할 일 두 줄). 역할마다 칩이 다르다.
     운영: 마감 100%↑·구매 0 / 곧 도달 1~2 / 증액 검토 3+ / 감액 후 반등 / 오늘 예산 바뀜 · 테스트: 승격 후보 / 마감 100%↑·구매 0 · CBO: 광고 탭으로 넘겨 독식·지출 0 · 전체·캠페인 탭: 오늘 예산 바뀜
     없앤 칩: 운영중(=역할 운영) · 테스트중(=역할 테스트) · 감액 ÷10 구매 0(옛 기준 — 마감 100%↑로 대체) · 마감 50%↑(예상 마감 열의 노랑으로) · 오늘 예산 줄 4개와 미변경(→ 오늘 예산 바뀜 하나) */
  const campSp = new Map(); for (const x of R.ads) campSp.set(x._campId, (campSp.get(x._campId) || 0) + (x.spend || 0));   // CBO 광고의 캠페인 내 지출 비중용
  const adShare = x => x._cbo && x.spend > 0 ? Math.round(x.spend / campSp.get(x._campId) * 100) : 0;
  const changedOf = r => !!bb.byObj && (bb.byObj.get(r.id) || []).length > 0;
  const todo = [];   // [key, label, predicate, onclick(선택)]
  if (showJudge) {
    if (!admgr.products && !admgr.productsLoading && admgrCfg()) admgrLoadProducts();
    const jm = new Map(vis.map(r => [r.id, admgrJudge(r)]));
    const jk = k => r => (jm.get(r.id) || {}).key === k;
    const overOf = r => admgrP7(r) === 0 && (admgrProj(r) || 0) >= 100;
    const promo = typeof admgrPromoCands === 'function' ? new Set(admgrPromoCands().ads.map(x => x.s.id)) : new Set();   // 승격 후보(7일 구매 30↑ 등) — 테스트 캠페인 세트라 운영·테스트 둘 다
    if (admgr.role === 'test') {
      todo.push(['promo', '<span class="ag-dot green"></span>승격 후보', r => promo.has(r.id)], ['over', '<span class="ag-dot red"></span>마감 100%↑ <small class="ag-muted">구매 0</small>', overOf]);
    } else if (admgr.role === 'all') { /* 전체는 표 그대로 — 아래 '오늘 예산 바뀜'만 */ }
    else if (admgr.role === 'cbo') {
      const cboAds = R.ads.filter(x => x._cbo && x.status === 'ACTIVE');
      const hog = new Set(cboAds.filter(x => adShare(x) >= 60).map(x => x._campId)).size, zero = cboAds.filter(x => !(x.spend > 0)).length;
      todo.push(['hog', `<span class="ag-dot amber"></span>광고 하나가 60%↑ ${hog} <small class="ag-muted">광고 탭 →</small>`, null, "admgrAdFilter('hog')"], ['zero', `지출 0 광고 ${zero} <small class="ag-muted">광고 탭 →</small>`, null, "admgrAdFilter('zero')"]);
    } else {
      todo.push(['over', '<span class="ag-dot red"></span>마감 100%↑ <small class="ag-muted">구매 0</small>', overOf], ['warn', '<span class="ag-dot amber"></span>곧 도달 <small class="ag-muted">구매 1~2</small>', jk('warn')], ['up', '<span class="ag-dot green"></span>증액 검토 <small class="ag-muted">구매 3+</small>', jk('up')]);
      admgrFastEnsure();
      if (admgr.fast.days) {
        todo.push(['fast', '<span class="ag-dot green"></span>빠른 증액 <small class="ag-muted">5만↓ · 3일 6건↑(3만↓ 4건↑) · 30%↓</small>', r => !!admgrFastOf(r)]);
        if (vis.some(r => admgrFastRevertOf(r))) todo.push(['fastback', '<span class="ag-dot amber"></span>빠른 증액 되돌리기 <small class="ag-muted">이틀 40%↑</small>', r => !!admgrFastRevertOf(r)]);
      }
      if (vis.some(jk('rebound'))) todo.push(['rebound', '<span class="ag-dot blue"></span>감액 후 반등 <small class="ag-muted">구매 2+ · ROAS 5+</small>', jk('rebound')]);
      if (promo.size) todo.push(['promo', '<span class="ag-dot green"></span>승격 후보 <small class="ag-muted">CBO로</small>', r => promo.has(r.id)]);
    }
  }
  if (admgr.view === 'ad' && admgr.role === 'cbo') todo.push(['hog', '<span class="ag-dot amber"></span>광고 하나가 60%↑', x => adShare(x) >= 60], ['zero', '지출 0 광고', x => x.status === 'ACTIVE' && !(x.spend > 0)]);
  if (showChg && bb.byObj && admgr.role !== 'cbo') todo.push(['chg', '<i class="fa-solid fa-pen" style="font-size:.7em;margin-right:5px;"></i>오늘 예산 바뀜', changedOf]);
  if (admgr.judgeFilter !== 'all' && !todo.some(t => t[0] === admgr.judgeFilter)) admgr.judgeFilter = 'all';   // 역할·탭을 바꿔 그 칩이 없으면 전체로
  let judgeChips = '';
  if (todo.length) {
    const chip = (k, label, n, fn) => `<button class="filter-tab ${admgr.judgeFilter === k ? 'active' : ''}" onclick="${fn || `admgrJudgeSet('${k}')`}">${label}${n == null ? '' : ' ' + n}</button>`;
    judgeChips = `<div class="filter-tabs ag-judge" style="margin-bottom:12px;">
      <span class="ag-lbl">오늘 할 일</span>
      ${chip('all', '전체', vis.length)}${todo.map(([k, l, p, fn]) => chip(k, l, p ? vis.filter(p).length : null, fn)).join('')}
      <span style="flex:1;"></span>
      ${admgr.judgeFilter === 'fast' && admgr.write.st && dnrbCan('budget') ? `<button class="filter-tab" style="color:#fff;background:#16a34a;border-color:transparent;" onclick="admgrFastBoostDisp()" title="표시된 빠른 증액 후보의 일예산을 2배로 임시 저장 — 상단 '게시'를 눌러야 Meta에 반영돼요">표시된 세트 2배 임시 저장</button>` : ''}
      ${admgr.judgeFilter === 'fastback' && admgr.write.st && dnrbCan('budget') ? `<button class="filter-tab" style="color:#fff;background:#d97706;border-color:transparent;" onclick="admgrFastRevertDisp()" title="2배로 올리기 전 예산으로 임시 저장 — 상단 '게시'로 반영">올리기 전 예산으로 임시 저장</button>` : ''}
      ${admgr.judgeFilter === 'over' && admgr.write.st && dnrbCan('budget') ? `<button class="filter-tab" style="color:#fff;background:#dc2626;border-color:transparent;" onclick="admgrCutDisp()" title="지금 표시된 세트 중 오늘 아직 안 깎은 것(구매 0 · 예산 있음)을 ÷10으로 임시 저장 — 상단 '게시'를 눌러야 Meta에 반영돼요">표시된 세트 ÷10 임시 저장</button>` : ''}
      ${showJudge && admgr.productsLoading ? '<span style="font-size:.72rem;color:#9ca3af;">카페24 상품 가격 불러오는 중…</span>' : ''}
    </div>`;
    const t = todo.find(x => x[0] === admgr.judgeFilter);
    if (t && t[2]) vis = vis.filter(t[2]);
  }
  admgr._dispIds = vis.map(r => r.id);   // 헤더 전체선택용 (검색·활성만·판정 필터 반영된 표시 행)
  /* 요약 타일 (표시분 기준) */
  const tot = { spend: 0, purchases: 0, value: 0, clicks: 0, purchases_7d: 0, value_7d: 0 };   // 합계 줄의 클릭7일 열은 직접 누적 (admgrP7/V7 폴백이 tot엔 안 맞음)
  for (const r of vis) { tot.spend += r.spend || 0; tot.purchases += r.purchases || 0; tot.value += r.value || 0; tot.clicks += r.clicks || 0; tot.purchases_7d += admgrP7(r); tot.value_7d += admgrV7(r) || 0; }
  const sumRoas = tot.spend ? tot.value / tot.spend : 0;
  /* 폰 요약줄 = 정렬 머리글 (2026-09-20 사용자 요청): 지출·구매·ROAS를 누르면 큰 순 ▼ → 작은 순 ▲ → 해제. 카드의 숫자 3개와 같은 순서라 표 머리글처럼 읽힌다. 펼치기는 오른쪽 ∨ */
  const sortBtn = (key, label, val, color) => { const so = admgr.sort.length === 1 && admgr.sort[0].key === key ? admgr.sort[0].dir : 0;
    return `<button class="ag-sumk ${so ? 'on' : ''}" onclick="admgrSortM('${key}')" aria-label="${label} 순 정렬">${label}<em>${so === -1 ? '▼' : so === 1 ? '▲' : '<i class="fa-solid fa-sort"></i>'}</em> <b${color ? ` style="color:${color};"` : ''}>${val}</b></button>`; };
  const sumLine = !admgrMobile() ? '' : `<div class="ag-sum">
    ${sortBtn('spend', '지출', tot.spend >= 1e6 ? (tot.spend / 1e4).toFixed(1) + '만원' : won(tot.spend))}${sortBtn('purch', '구매', comma(tot.purchases))}${sortBtn('roas', 'ROAS', tot.spend ? sumRoas.toFixed(2) : '—', !tot.spend ? '#9ca3af' : sumRoas < 1 ? '#dc2626' : sumRoas >= 3 ? '#15803d' : '')}
    <button class="ag-sumx" onclick="admgr.sumOpen=!admgr.sumOpen;renderAdmgr(true)" aria-expanded="${admgr.sumOpen ? 'true' : 'false'}" aria-label="요약 펼치기"><i class="fa-solid fa-chevron-${admgr.sumOpen ? 'up' : 'down'}"></i></button></div>`;   // 폰 상단 압축 (2026-09-18) — 6칸은 펼쳤을 때만
  const tiles = !admgrMobile() ? '' : sumLine + (!admgr.sumOpen ? '' : `<div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:14px;">
    ${admgrTile('지출 (표시분)', won(tot.spend))}${admgrTile('구매', comma(tot.purchases))}
    ${admgrTile('구매당 비용', admgrCpa(tot))}${admgrTile('구매 전환값', won(tot.value))}
    ${admgrTile('ROAS', tot.spend ? (tot.value / tot.spend).toFixed(2) : '—')}${admgrTile('표시 중 ' + VIEW_LABEL, vis.length + '개')}
  </div>`);
  const cpcTd = r => r.clicks ? won(r.spend / r.clicks) : '—';
  const shareTd = r => { if (!r._cbo || !(r.spend > 0)) return ''; const p = Math.round(r.spend / campSp.get(r._campId) * 100); return ` · <span title="이 캠페인 지출 중 이 광고 비중 — 60%↑면 한 광고 독식" style="${p >= 60 ? 'color:#b45309;font-weight:700;' : ''}">지출 ${p}%</span>`; };
  const totalRow = (lead, extraCols) => `<tfoot><tr>
    <td colspan="${lead}" style="text-align:left;">${vis.length}개 ${VIEW_LABEL}의 결과</td>
    ${extraCols}
    <td>${won(tot.spend)}</td>${isCamp || isSet ? '' : `<td class="m-hide">${comma(tot.clicks)}</td>`}<td>${comma(tot.purchases)}</td>
    <td class="m-hide">${admgrCpa(tot)}</td><td class="m-hide">${won(tot.value)}</td><td>${admgrRoasTd(tot)}</td><td>${comma(tot.purchases_7d)}</td><td>${admgrRoas1Td(tot)}</td><td class="m-hide">${cpcTd(tot)}</td><td class="xp"></td>
  </tr></tfoot>`;
  /* 행 끝 ∨ — 기본 숨김 열(구매당 비용·전환값·클릭·CPC·최근 변경·게재)을 상세 행으로 (2026-09-14 리디자인: 기본 열 6개) */
  const chev = `<button class="ag-chev" onclick="event.stopPropagation();admgrRowToggle(this)" title="자세히"><i class="fa-solid fa-chevron-down"></i></button>`;
  const detail = r => `<tr class="ag-detail"><td colspan="99"><div class="ag-detail-grid">
      <span><i>구매당 비용</i>${admgrCpa(r)}</span><span><i>전환값</i>${admgrMoney(r.value)}</span><span><i>클릭</i>${comma(r.clicks || 0)}</span><span><i>CPC</i>${cpcTd(r)}</span>
      ${showChg ? `<span><i>최근 변경</i>${admgrChgCell(r)}</span>` : ''}${r.budget_life ? `<span><i>총예산</i>${won(r.budget_life)}</span>` : ''}</div></td></tr>`;

  let table;
  if (!vis.length) {
    table = `<div class="empty-state" style="padding:36px;"><p>조건에 맞는 행이 없어요.</p></div>`;
  } else if (admgrMobile()) {
    table = '';   // 폰은 카드만 보인다(CSS로 표 숨김) — 보이지 않는 표까지 만들어 파싱하던 것 (2026-10-26 점검). 창 크기 바뀌면 resize가 다시 그린다
  } else if (isCamp || isSet) {
    table = `<div class="table-wrap"><table>
      <thead><tr><th class="cb"><input type="checkbox" ${vis.length && vis.every(r => (isCamp ? admgr.selCamps : admgr.selSets).has(r.id)) ? 'checked' : ''} onclick="admgrSelAllDisp()" title="표시된 ${VIEW_LABEL} 전체 선택/해제" /></th><th class="l tg" title="켜기/끄기 — 클릭하면 임시 저장, 상단 '게시'로 반영">켜짐</th>${admgrTh('name', VIEW_LABEL, 'l')}${showJudge ? '<th class="l" title="오늘 구매(클릭 후 7일) 기준 — 0건(지출 있음)=감액 ÷10 · 1~2건=곧 도달 · 3건+=증액 검토. 아래 줄의 마진·지출%는 참고">판정</th>' + admgrTh('proj', '예상 마감', '', '지금 속도면 마감 때 마진의 몇 % — 오늘 지출 × 24 ÷ 지난 시간 ÷ 마진(판매가 − 공급가×1.1) · 구매 0인 세트만 · 100%↑ 빨강 = ÷10 후보, 50%↑ 노랑 = 지켜보기') : ''}${showMid ? '<th class="l m-hide" title="시작 = 오늘 하루 시작 예산(00:10 기록). 23:45 원복 승인 시 이 값으로 되돌아가요. 아래 칸은 23:45에 따로 걸 금액(선택) — 예약한 세트는 원복 대신 그 금액으로">23:45 세팅</th>' : ''}${admgrTh('budget', '예산', 'm-hide')}${showChg ? '<th class="l m-hide" title="오늘 예산 변경 (Meta 활동 로그)">최근 변경</th>' : ''}
        ${admgrTh('spend', '지출')}${admgrTh('purch', '구매')}${admgrTh('cpa', '구매당 비용', 'm-hide')}${admgrTh('value', '전환값', 'm-hide')}${admgrTh('roas', 'ROAS')}${admgrTh('purch1', '구매(클릭7일)')}${admgrTh('roas1', 'ROAS(클릭7일)')}${admgrTh('cpc', 'CPC', 'm-hide')}<th class="xp"></th></tr></thead>
      <tbody>${vis.map(r => `
        <tr class="ag-row ${(isCamp ? admgr.selCamps : admgr.selSets).has(r.id) ? 'sel' : ''}" onclick="admgrRowClick(event,'${isCamp ? 'camp' : 'set'}','${r.id}')" title="행을 클릭하면 선택/해제">
          <td class="cb"><input type="checkbox" ${(isCamp ? admgr.selCamps : admgr.selSets).has(r.id) ? 'checked' : ''}
               onclick="event.stopPropagation();${isCamp ? 'admgrToggleCamp' : 'admgrToggleSet'}('${r.id}')" /></td>
          <td class="l tg">${admgrOnOff(r, isCamp ? 'campaign' : 'adset')}</td>
          <td class="name-cell" title="${esc(r.name || '')}${!isCamp ? ' · ' + esc(r._campName || '') : ''}">
            <b>${esc(admgrBase(r.name))}</b>${admgrViewBadge(r)}${admgrFastBadge(r)}${admgrMarkBadges(r.name)}<button class="btn-ghost row-act"
              onclick="admgrDrill('${isCamp ? 'camp' : 'set'}','${r.id}')">${isCamp ? '세트 보기' : '광고 보기'} →</button>
            <div class="ag-sub">${admgrStBadge(r.status)}${!isCamp && r._campName ? ` · ${esc(r._campName)}` : ''}</div></td>
          ${showJudge ? `<td class="l">${admgrJudgeCell(r)}</td><td>${admgrProjCell(r)}</td>` : ''}
          ${showMid ? `<td class="l m-hide">${admgrMidCell(r, isCamp ? 'campaign' : 'adset')}</td>` : ''}
          <td class="m-hide">${admgrBudgetCell(r, isCamp ? 'campaign' : 'adset')}</td>
          ${showChg ? `<td class="l m-hide">${admgrChgCell(r)}</td>` : ''}
          <td>${admgrMoney(r.spend)}</td>
          <td>${comma(r.purchases || 0)}</td>
          <td class="m-hide">${admgrCpa(r)}</td>
          <td class="m-hide">${admgrMoney(r.value)}</td>
          <td>${admgrRoasTd(r)}</td>
          <td>${comma(admgrP7(r))}</td>
          <td>${admgrRoas1Td(r)}</td>
          <td class="m-hide">${cpcTd(r)}</td>
          <td class="xp">${chev}</td>
        </tr>${detail(r)}`).join('')}</tbody>
      ${totalRow(3 + (showJudge ? 2 : 0), `${showMid ? '<td class="m-hide">—</td>' : ''}<td class="m-hide">—</td>${showChg ? '<td class="m-hide">—</td>' : ''}`)}
    </table></div>`;
  } else {
    table = `<div class="table-wrap"><table>
      <thead><tr><th class="cb"><input type="checkbox" ${vis.length && vis.every(r => admgr.selAds.has(r.id)) ? 'checked' : ''} onclick="event.stopPropagation();admgrSelAllDisp()" title="표시된 광고 전체 선택/해제" /></th><th class="l tg" title="켜기/끄기 — 클릭하면 임시 저장, 상단 '게시'로 반영">켜짐</th>${admgrTh('name', '광고', 'l')}${admgrTh('spend', '지출')}${admgrTh('clicks', '클릭', 'm-hide')}
        ${admgrTh('purch', '구매')}${admgrTh('cpa', '구매당 비용', 'm-hide')}${admgrTh('value', '전환값', 'm-hide')}${admgrTh('roas', 'ROAS')}${admgrTh('purch1', '구매(클릭7일)')}${admgrTh('roas1', 'ROAS(클릭7일)')}${admgrTh('cpc', 'CPC', 'm-hide')}<th class="xp"></th></tr></thead>
      <tbody>${vis.map(r => `
        <tr onclick="showMetaPreview('${r.id}')" style="cursor:pointer;" title="클릭 → 소재 미리보기" class="${admgr.selAds.has(r.id) ? 'sel' : ''}">
          <td class="cb" onclick="event.stopPropagation()"><input type="checkbox" ${admgr.selAds.has(r.id) ? 'checked' : ''} onclick="admgrToggleAd('${r.id}')" title="복사할 광고 선택" /></td>
          <td class="l tg" onclick="event.stopPropagation()">${admgrOnOff(r, 'ad')}</td>
          <td class="name-cell" title="${esc(r.name || '')} · ${esc(r._setName || '')}">
            <b>${esc(r.name || '(이름 없음)')}</b>${admgrViewBadge(r)}<div class="ag-sub">${admgrStBadge(r.status)}${r._setName ? ` · ${esc(admgrBase(r._setName))}` : ''}${shareTd(r)}${admgrMarkBadges(r._setName)}</div></td>
          <td>${admgrMoney(r.spend)}</td>
          <td class="m-hide">${comma(r.clicks || 0)}</td>
          <td>${comma(r.purchases || 0)}</td>
          <td class="m-hide">${admgrCpa(r)}</td>
          <td class="m-hide">${admgrMoney(r.value)}</td>
          <td>${admgrRoasTd(r)}</td>
          <td>${comma(admgrP7(r))}</td>
          <td>${admgrRoas1Td(r)}</td>
          <td class="m-hide">${cpcTd(r)}</td>
          <td class="xp" onclick="event.stopPropagation()">${chev}</td>
        </tr>${detail(r)}`).join('')}</tbody>
      ${totalRow(3, '')}
    </table></div>`;
  }
  /* 폰(≤768px): 표 대신 카드 (같은 vis 행·같은 셀 렌더러 재사용 — 표는 CSS로 숨김) */
  let cards = '';
  if (admgrMobile() && vis.length && (isCamp || isSet || admgr.view === 'ad')) {
    const level = isCamp ? 'campaign' : isSet ? 'adset' : 'ad';
    const roas = r => r.spend ? (r.value / r.spend).toFixed(2) : '—';
    const roasColor = r => !r.spend ? '#9ca3af' : r.value / r.spend < 1 ? '#dc2626' : '#1c1e21';
    const sel = isCamp ? admgr.selCamps : isSet ? admgr.selSets : admgr.selAds;
    const kind = isCamp ? 'camp' : isSet ? 'set' : 'ad';
    const canBudget = !!(admgr.write.st && admgr.write.st.allowed) && !admgr.demo && dnrbCan('budget');
    /* 폰 카드 2단계 (2026-09-18): 1줄 상품명+토글 / 2줄 세트명 뒷부분·캠페인 표시 / 3줄 판정+지출·구매·ROAS / 4줄 예산+÷10·수정·펼치기. 나머지는 펼치기 안 */
    const JB = { cut: ['red', '감액 ÷10'], warn: ['amber', '곧 도달'], up: ['green', '증액 검토'], done: ['gray', '오늘 감액됨'], rebound: ['blue', '감액 후 반등'], testing: ['gray', '테스트중'] };
    cards = `<div class="mcards ${admgr.mSelect ? 'msel' : ''}">${vis.map(r => {
      const base = admgrBase(r.name);
      const prod = isCamp ? base : admgrProductOf({ adset_name: base });
      const tail = !isCamp && base.startsWith(prod) ? base.slice(prod.length).replace(/^[\s_\-·]+/, '') : '';
      const parent = isCamp ? '' : isSet ? (r._campName || '') : (r._setName || '');
      const j = showJudge ? admgrJudge(r) : null, jb = j && JB[j.key];
      const open = !!(admgr.mOpen && admgr.mOpen.has(r.id));
      const d = admgrDraft[r.id], dirty = d && d !== r.budget;
      const pend = admgr.write.pendingByObj && admgr.write.pendingByObj.get(r.id);
      const budget = r.budget > 0
        ? (dirty ? `<s>₩${comma(r.budget)}</s><b class="mc-bnum draft">₩${comma(d)}</b><span class="mc-dpill">임시 저장</span>` : `<b class="mc-bnum">₩${comma(r.budget)}</b><small>/일</small>`)
        : r.budget_life ? `<b class="mc-bnum">총 ₩${comma(r.budget_life)}</b>` : `<small>${isSet ? '캠페인 예산' : isCamp ? '세트별 예산' : ''}</small>`;
      const pen = `<button class="mc-ibtn" onclick="event.stopPropagation();admgrMarginEdit('${r.id}')" aria-label="마진 직접 입력"><i class="fa-solid fa-pen"></i></button>`;
      const more = `
        ${j ? `<div class="row"><span>마진</span><span>${j.m > 0 ? `${won(j.m)} · 지출 ${Math.round((j.ratio || 0) * 100)}%${admgrP7(r) === 0 && admgrProj(r) != null ? ` · 예상 마감 ${admgrProj(r)}%` : ''}` : esc(j.src ? j.src.slice(0, 18) : '정보 없음')}${pen}</span></div>` : ''}
        ${admgr.view === 'ad' ? `<div class="row"><span>클릭</span><span>${comma(r.clicks || 0)}</span></div>` : ''}
        <div class="row"><span>구매당 비용</span><span>${admgrCpa(r)}</span></div>
        <div class="row"><span>전환값</span><span>${admgrMoney(r.value)}</span></div>
        <div class="row"><span>CPC</span><span>${cpcTd(r)}</span></div>
        ${showChg ? `<div class="row"><span>최근 변경</span><span>${admgrChgCell(r)}</span></div>` : ''}
        ${parent ? `<div class="row"><span>${isSet ? '캠페인' : '광고세트'}</span><span class="mc-par">${esc(admgrBase(parent))}</span></div>` : ''}
        ${pend ? `<div class="row"><span>23:45 예약</span><span style="color:#b45309;font-weight:700;">₩${comma(pend.new_budget)}</span></div>` : ''}
        ${showMid ? `<div class="mc-mid"><div class="mc-midt">23:45 세팅</div>${admgrMidCell(r, level)}</div>` : ''}
        <div class="mc-links">
          ${admgr.view !== 'ad' ? `<button onclick="event.stopPropagation();admgrDrill('${isCamp ? 'camp' : 'set'}','${r.id}')">${isCamp ? '세트 보기' : '광고 보기'}<i class="fa-solid fa-chevron-right"></i></button>` : ''}
          <button onclick="event.stopPropagation();admgrSelectEnter('${kind}','${r.id}')">선택 모드<i class="fa-regular fa-square-check"></i></button>
        </div>`;
      return `<div class="mcard ${sel.has(r.id) ? 'sel' : ''} ${open ? 'open' : ''}" data-id="${r.id}" onclick="admgrCardClick(event,'${kind}','${r.id}')" ontouchstart="admgrCardDown(event,'${kind}','${r.id}')" ontouchmove="admgrCardMove(event)" ontouchend="admgrCardCancel()" ontouchcancel="admgrCardCancel()">
        <div class="mc-top"><span class="mc-check">${sel.has(r.id) ? '<i class="fa-solid fa-check"></i>' : ''}</span><div class="mc-name"><b>${esc(prod)}</b></div>
          <div class="mc-tg" onclick="event.stopPropagation()">${admgrOnOff(r, level)}</div></div>
        ${jb || tail || r.status !== 'ACTIVE' || admgrMarkBadges(r.name) || admgrViewDep(r) || admgrFastBadge(r) ? `<div class="mc-r2">${jb ? `<span class="mc-jb ${jb[0]}"><i></i>${jb[1]}</span>` : ''}${admgrViewBadge(r)}${admgrFastBadge(r)}${r.status !== 'ACTIVE' ? `<span class="mc-st">${admgrStBadge(r.status)}</span>` : ''}${tail ? `<span class="mc-tail">${esc(tail)}</span>` : ''}${admgrMarkBadges(r.name)}</div>` : ''}
        <div class="mc-r3"><span class="mc-kv"><i>지출</i><b>${admgrMoney(r.spend)}</b></span><span class="mc-kv"><i>구매</i><b>${comma(r.purchases || 0)}</b></span><span class="mc-kv"><i>ROAS</i><b style="color:${!r.spend ? '#9ca3af' : r.value / r.spend < 1 ? '#dc2626' : r.value / r.spend >= 3 ? '#15803d' : '#1c1e21'};">${roas(r)}</b></span><span class="mc-kv"><i>클릭7일</i><b style="color:${!r.spend ? '#9ca3af' : admgrV7(r) / r.spend < 1 ? '#dc2626' : admgrV7(r) / r.spend >= 3 ? '#15803d' : '#1c1e21'};">${r.spend ? (admgrV7(r) / r.spend).toFixed(2) : '—'}</b></span></div>
        <div class="mc-foot">
          ${admgr.view === 'ad' ? '<div class="mc-budget"><small>탭하면 소재 미리보기</small></div>'
            : canBudget && r.budget > 0 ? `<button class="mc-budget" onclick="event.stopPropagation();admgrBudgetPop(event,'${r.id}','${level}')">${budget}</button>` : `<div class="mc-budget">${budget}</div>`}
          <div class="mc-btns">
            ${isSet && canBudget && r.budget > 0 && j && j.key === 'cut' ? `<button class="mc-cut" onclick="event.stopPropagation();admgrCut10('${r.id}')" aria-label="÷10 임시 저장">÷10</button>` : ''}
            ${admgr.view !== 'ad' && canBudget && r.budget > 0 ? `<button class="mc-edit" onclick="event.stopPropagation();admgrBudgetPop(event,'${r.id}','${level}')"><i class="fa-solid fa-pen"></i>수정</button>` : ''}
            <button class="mc-exp ${open ? 'on' : ''}" onclick="event.stopPropagation();admgrCardOpen('${r.id}')" aria-label="자세히"><i class="fa-solid fa-chevron-${open ? 'up' : 'down'}"></i></button>
          </div>
        </div>
        <div class="mc-more" onclick="event.stopPropagation()">${more}</div>
      </div>`; }).join('')}</div>`;
  }
  /* 체크 선택 시 하단 동작 바 (상단 '선택: …' 표시줄 대체) */
  const nc = admgr.selCamps.size, ns = admgr.selSets.size, na = admgr.view === 'ad' ? admgr.selAds.size : 0;
  const actbar = (nc || ns || na) ? `<div class="ag-actbar">
      <b>${nc ? `캠페인 ${nc}` : ''}${nc && ns ? ' · ' : ''}${ns ? `세트 ${ns}` : ''}${na ? `광고 ${na}` : ''} 선택</b><span class="sep"></span>
      ${na && cfg && !admgr.demo ? `<button onclick="admgrCopyModal()" title="고른 광고의 소재를 다른 캠페인·광고세트에 복사 (꺼진 상태로 만들어요)"><i class="fa-regular fa-copy"></i> 광고 복사</button>` : ''}
      ${isCamp && nc ? `<button onclick="admgrSetView('set')">선택한 캠페인의 세트 보기 →</button>` : ''}
      ${isSet && ns ? `<button onclick="admgrSetView('ad')">선택한 세트의 광고 보기 →</button>` : ''}
      ${isSet && ns && cfg && !admgr.demo && admgrRows().sets.some(r => admgr.selSets.has(r.id) && admgrIsTest(r)) ? `<button onclick="admgrTestEndModal()" title="체크한 테스트중 세트의 이름 맨 뒤 _test를 세트·광고에서 지워 Meta에 저장 — 그다음부터 일반 판정에 들어가요"><i class="fa-solid fa-flag-checkered"></i> 테스트 종료</button>` : ''}
      ${isSet && ns && admgr.write.st && dnrbCan('budget') && !admgr.demo && admgr.write.daystart && admgr.write.daystart.size ? `<button onclick="admgrRestoreSel()" title="체크한 세트를 오늘 시작 예산(00:10 기록)으로 임시 저장 — 상단 '게시'를 눌러야 Meta에 반영돼요"><i class="fa-solid fa-rotate-left"></i> 시작 예산 복구</button>` : ''}
      ${isSet && ns && admgr.write.st && dnrbCan('budget') && !admgr.demo ? `<button class="cut" onclick="admgrCutSel()" title="체크한 광고세트 일예산 ÷10을 임시 저장 — 상단 \'게시\'를 눌러야 Meta에 반영돼요"><i class="fa-solid fa-arrow-down"></i> ÷10 임시 저장</button>` : ''}
      ${isSet && ns && cfg && !admgr.demo ? `<button onclick="admgrMakerAssign(event)" title="대시보드 밖에서 올려 기록이 없는 세트에 만든 사람을 붙여요 — 화면에는 표시되지 않고 '만든 사람 ▾'로 거를 때만 쓰여요"><i class="fa-solid fa-user-pen"></i> 만든 사람 지정</button>` : ''}
      ${isSet && ns && cfg && !admgr.demo ? `<button onclick="admgrBestAdd()" title="체크한 광고세트의 소재를 베스트소재에 담기"><i class="fa-solid fa-star"></i> 베스트 담기</button>` : ''}
      <span style="flex:1;"></span><button class="ghost" onclick="admgrClearSel()">선택 해제 ✕</button></div>` : '';
  /* 폰 (2026-09-18): 검은 동작바 대신 — 선택 모드면 상단 선택바 + 하단 동작판, 아니면 상위 선택이 필터로 남았을 때 알림줄 */
  if (admgrMobile()) {
    let fnotice = '';
    if (!admgr.mSelect) {
      const nm = (list, set) => admgrBase((list.find(x => set.has(x.id)) || {}).name || '');
      if (isSet && admgr.selCamps.size) fnotice = admgrFNoticeHtml(nm(R.camps, admgr.selCamps), admgr.selCamps.size);
      else if (admgr.view === 'ad' && admgr.selSets.size) fnotice = admgrFNoticeHtml(nm(R.sets, admgr.selSets), admgr.selSets.size);
      else if (admgr.view === 'ad' && admgr.selCamps.size) fnotice = admgrFNoticeHtml(nm(R.camps, admgr.selCamps), admgr.selCamps.size);
    }
    const selTop = admgr.mSelect ? admgrSelBarHtml() : '', selPanel = admgr.mSelect ? admgrSelPanelHtml() : '';
    return selTop + roleRow + judgeChips + mkBan + fnotice + tiles + table + cards + selPanel;
  }
  return roleRow + judgeChips + mkBan + tiles + table + cards + actbar;
}
/* 행 여백 클릭 = 체크박스 토글 (2026-09-15 사용자 요청). 버튼·링크·입력칸·토글·연필 등 조작 요소 위 클릭은 제외 */
/* ═══ 광고 복사 (2026-09-16 사용자 요청) — 고른 광고를 다른 캠페인·광고세트에 꺼진 상태로 복사하고,
   원본 광고가 있는 세트 이름 뒤에 " [→캠페인명]" 표시를 붙인다. 표시는 marker_sync가 자동으로 정리 ═══ */
/* 기간 직접 지정 (2026-09-16 사용자 요청) — 메타 광고관리자처럼 시작·종료 날짜를 골라서 조회 */
function admgrRangeModal() {
  const r = admgr.customRange || { since: todayStr(-7), until: todayStr(0) };
  $('abm-title').textContent = '기간 직접 지정';
  $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
      <label style="font-size:.76rem;font-weight:700;color:#4b5563;">시작<br/><input type="date" class="inp" id="ag-range-since" value="${esc(r.since)}" max="${todayStr(0)}" style="margin-top:4px;" /></label>
      <label style="font-size:.76rem;font-weight:700;color:#4b5563;">종료<br/><input type="date" class="inp" id="ag-range-until" value="${esc(r.until)}" max="${todayStr(0)}" style="margin-top:4px;" /></label>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
      ${[['이번 주', -6], ['2주', -13], ['이번 달', 'month'], ['지난달', 'lastmonth'], ['90일', -89]].map(([t, v]) =>
        `<button class="filter-tab" style="font-size:.72rem;" onclick="admgrRangeQuick('${v}')">${t}</button>`).join('')}
    </div>
    <div id="ag-range-err" style="display:none;font-size:.72rem;color:#dc2626;margin-top:8px;"></div>
    <div style="font-size:.7rem;color:#9ca3af;margin-top:10px;">최대 400일 · 판정·23:45 세팅·최근 변경 열은 '오늘'에서만 보여요</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button class="btn-ghost" onclick="closeModal('admgr-budget-modal')">취소</button>
      <button class="btn-analyze" onclick="admgrRangeApply()">조회</button></div>`;
  $('admgr-budget-modal').classList.add('show');
}
function admgrRangeQuick(v) {
  const t = new Date(todayStr(0) + 'T00:00:00Z');
  let since, until = todayStr(0);
  if (v === 'month') since = todayStr(0).slice(0, 8) + '01';
  else if (v === 'lastmonth') {
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
    since = d.toISOString().slice(0, 10);
    until = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0)).toISOString().slice(0, 10);
  } else since = todayStr(Number(v));
  $('ag-range-since').value = since; $('ag-range-until').value = until;
}
function admgrRangeApply() {
  const since = ($('ag-range-since') || {}).value || '', until = ($('ag-range-until') || {}).value || '';
  const err = m => { const el = $('ag-range-err'); el.textContent = m; el.style.display = 'block'; };
  if (!since || !until) return err('시작·종료 날짜를 모두 고르세요');
  if (since > until) return err('시작이 종료보다 뒤예요');
  if ((new Date(until) - new Date(since)) / 86400000 > 400) return err('최대 400일까지 조회할 수 있어요');
  if (until > todayStr(0)) return err('오늘 이후는 조회할 수 없어요');
  admgr.customRange = { since, until }; lsSet('adc_admgr_range', admgr.customRange);
  closeModal('admgr-budget-modal');
  admgr.preset = 'custom'; admgr.chgFilter = 'all';
  if (admgr.demo) { admgr.data = admgrDemoData(); renderAdmgr(); } else admgrFetch();
}
/* ═══ 테스트 종료 (2026-09-17 사용자 요청) — 체크한 테스트중 세트의 이름 맨 뒤 _test를 세트·광고 이름에서 지워 Meta에 저장.
   이름에서 test가 빠지면 다음 새로고침부터 일반 판정(감액·곧 도달·증액 검토)에 들어간다. [→캠페인] 표시는 유지 ═══ */
const AG_TEST_TAIL = /[_\s-]*test\s*$/i;   // 맨 뒤 _test / test / -test (앞 구분자 포함)
function admgrTestEndName(name) {
  const { base, camps } = admgrMarkParse(name);
  const stripped = base.replace(AG_TEST_TAIL, '').trim();
  return { next: admgrMarkName(stripped, camps), changed: stripped !== base, stillTest: /test/i.test(stripped) };
}
function admgrTestEndModal(fromTest) {   // fromTest = 테스트 소재 탭에서 고른 세트 [{id, name, ads:[{id,name}]}] (2026-10-12)
  const sets = (fromTest || admgrRows().sets.filter(r => admgr.selSets.has(r.id))).filter(admgrIsTest);
  admgr.testEndFrom = fromTest ? 'test' : 'set';
  if (!sets.length) { toast('테스트중 세트를 체크하세요'); return; }
  const plan = [];   // {id, from, to, level}
  const stuck = [];  // 맨 뒤가 아니라 못 지우는 것
  for (const s of sets) {
    const n = admgrTestEndName(s.name);
    if (n.changed) plan.push({ id: s.id, from: admgrBase(s.name), to: admgrBase(n.next), name: n.next, level: 'adset', still: n.stillTest });
    else stuck.push({ name: admgrBase(s.name), level: 'adset' });
    for (const a of (s.ads || [])) {
      const m = admgrTestEndName(a.name);
      if (m.changed) plan.push({ id: a.id, from: a.name, to: m.next, name: m.next, level: 'ad', still: m.stillTest });
      else if (/test/i.test(a.name)) stuck.push({ name: a.name, level: 'ad' });
    }
  }
  admgr.testEndPlan = plan;
  const row = p => `<div style="padding:4px 0;border-bottom:1px solid #f3f4f6;font-size:.76rem;"><span class="ag-muted" style="margin-right:6px;">${p.level === 'adset' ? '세트' : '광고'}</span>${esc(p.from)} <span style="color:#9ca3af;">→</span> <b>${esc(p.to)}</b>${p.still ? ' <span style="color:#b45309;">(아직 test가 남아요)</span>' : ''}</div>`;
  $('abm-title').textContent = `테스트 종료 — 세트 ${sets.length}개`;
  $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = `
    <div style="font-size:.78rem;color:#374151;margin-bottom:8px;">이름 맨 뒤 <b>_test</b>를 지워 Meta에 저장해요 · 세트 ${plan.filter(p => p.level === 'adset').length}개 · 광고 ${plan.filter(p => p.level === 'ad').length}개</div>
    <div style="max-height:40vh;overflow:auto;">${plan.map(row).join('') || '<div style="font-size:.76rem;color:#9ca3af;padding:8px 0;">바꿀 이름이 없어요</div>'}</div>
    ${stuck.length ? `<div style="margin-top:10px;font-size:.74rem;color:#b45309;"><b>못 지우는 것 ${stuck.length}개</b> — test가 맨 뒤가 아니라서 직접 고쳐주세요<div style="color:#6b7280;margin-top:4px;">${stuck.slice(0, 8).map(x => `· ${esc(x.name)}`).join('<br/>')}${stuck.length > 8 ? '<br/>…' : ''}</div></div>` : ''}
    <div style="font-size:.7rem;color:#9ca3af;margin-top:10px;">이름만 바뀌고 성과·학습에는 영향 없어요 · 이름에서 test가 빠지면 다음 새로고침부터 일반 판정에 들어가요</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button class="btn-ghost" onclick="closeModal('admgr-budget-modal')">취소</button>
      <button class="btn-analyze" id="ag-testend-go" onclick="admgrTestEndRun()" ${plan.length ? '' : 'disabled'}>테스트 종료</button></div>`;
  $('admgr-budget-modal').classList.add('show');
}
async function admgrTestEndRun() {
  const plan = admgr.testEndPlan || [];
  if (!plan.length) return;
  const btn = $('ag-testend-go'); btn.disabled = true; btn.textContent = '저장 중…';
  try {
    /* 서버는 한 번에 100개까지 — 세트+광고가 100개를 넘으면 "items 1~100개"로 통째로 거절되던 문제 (2026-09-20 실사례) → 40개씩 나눠 차례로 (서버가 하나씩 Meta에 저장해 개당 1초쯤 — 9/12 예산 116개가 150초 제한에 잘린 전례가 있어 한도 100보다 작게).
       중간 묶음이 실패해도 앞 묶음은 이미 Meta에 반영됐으므로 멈추지 않고, 실패한 묶음만 실패 목록에 넣는다 */
    const r = { failed: await admgrRenameBatch(plan, btn) };
    const failedIds = new Set((r.failed || []).map(f => String(f.id)));
    const ok = plan.filter(p => !failedIds.has(String(p.id)));
    admgr.selSets.clear(); admgr.mSelect = false;   // 폰 선택모드였다면 동작 완료로 나감 (B)
    if (admgr.testEndFrom === 'test') admgr.test.sel.clear();
    const endSets = ok.filter(p => p.level === 'adset').map(p => ({ id: p.id, name: p.to }));   // 완료 리포트 대상 (2026-10-12)
    $('abm-title').textContent = '테스트 종료 결과';
    $('abm-body').innerHTML = `
      <div style="font-size:.8rem;color:#374151;margin-bottom:8px;">세트 <b style="color:#15803d;">${ok.filter(p => p.level === 'adset').length}</b>개 · 광고 <b style="color:#15803d;">${ok.filter(p => p.level === 'ad').length}</b>개 이름을 바꿨어요${failedIds.size ? ` · 실패 <b style="color:#dc2626;">${failedIds.size}</b>개` : ''}</div>
      ${(r.failed || []).map(f => `<div style="font-size:.74rem;color:#dc2626;">✗ ${esc(String(f.id))} — ${esc(String(f.error || ''))}</div>`).join('')}
      <div style="font-size:.7rem;color:#9ca3af;margin-top:10px;">화면을 새로 받아오고 있어요 — 잠시 후 일반 판정에 나타나요</div>
      <div id="ag-testend-rep" style="font-size:.76rem;color:#4f46e5;margin-top:10px;">${endSets.length ? '<i class="fa-solid fa-spinner fa-spin"></i> 완료 리포트 만드는 중…' : ''}</div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn-analyze" onclick="closeModal('admgr-budget-modal')">확인</button></div>`;
    if (endSets.length) admgrEndReportMake(endSets).then(rec => { const el = $('ag-testend-rep'); if (el) el.innerHTML = rec ? `<button class="btn-analyze" onclick="closeModal('admgr-budget-modal');admgrEndReportShow('${rec.id}')"><i class="fa-solid fa-clipboard-check"></i> 완료 리포트 보기 (소재 ${rec.rows.length}개)</button>` : '<span style="color:#dc2626;">완료 리포트를 만들지 못했어요 — 테스트 소재 탭의 [완료 리포트]에서 다시 확인하세요</span>'; });
    if (admgr.testEndFrom === 'test') admgrTestFetch(); else admgrFetch();
  } catch (e) { btn.disabled = false; btn.textContent = '테스트 종료'; toast('실패: ' + e.message); }
}
async function admgrRenameBatch(plan, btn) {   // [{id, name}] → 실패 목록. 40개씩 (서버 한도 100 · 개당 1초쯤) — 중간 묶음이 실패해도 멈추지 않는다
  const failed = [], N = 40;
  for (let i = 0; i < plan.length; i += N) {
    const part = plan.slice(i, i + N);
    if (btn) btn.textContent = plan.length > N ? `저장 중… ${Math.min(i + N, plan.length)}/${plan.length}` : '저장 중…';
    try { const x = await sbCall('meta-upload', { action: 'adset_rename' }, { items: part.map(p => ({ id: p.id, name: p.name })) }); failed.push(...(x.failed || [])); }   // 광고도 같은 방식(POST /{id} name)
    catch (e) { failed.push(...part.map(p => ({ id: p.id, error: e.message }))); }
  }
  return failed;
}
/* ═══ 끌올 사본 정리 (2026-10-15) — 작년 시즌 소재를 Meta 광고관리자에서 복사하면 세트명 뒤에 ' - 사본'이 붙는다. 그 세트들만 골라 상품명을 읽어
   소재 업로드와 같은 규칙(상품명_R1_소구점_마진_YYMMDD_test)으로 세트·광고 이름을 다시 짓는다. 순번은 계정 안 그 상품의 기존 세트 다음 번호, 마진은 지금 상품 가격으로, 날짜는 오늘.
   규칙 이름이 아닌 옛 세트(전환_… 식)는 세트명 전체에서 상품을 찾고 R/P는 소재 종류(영상/이미지)로 정한다. 세트 안 광고 전부 세트와 같은 이름 (업로드 때와 같음) */
const AG_COPY_TAIL = /\s*[-–—]?\s*(사본|copy)\s*\d*\s*$/i;
const AG_RULE = /^(.+?)_(R|P)(\d+)((?:_[^_]+)?)_(\d+)_(\d{6})_test\b/;
function admgrRepostPlan(sets, allSets, today, picks) {   // picks: {세트 id → 상품 no} 사용자가 고른 상품 (비슷한 이름이 여럿일 때)   // sets: 사본 세트 [{id,name,ads,is_video}] · allSets: 계정 세트 전체(순번용) → [{id, from, to, name, level, note}]
  const d = today.replace(/-/g, '').slice(2), seqMax = new Map();
  const seqKey = (pname, rp) => admgrNorm(pname) + '|' + rp;
  [...allSets, ...sets].forEach(x => { const m = admgrBase(x.name).match(AG_RULE); if (m) { const k = seqKey(m[1], m[2]); seqMax.set(k, Math.max(seqMax.get(k) || 0, +m[3])); } });   // 사본 자신(원본 이름 그대로)의 순번도 포함
  const idx = admgrProdIdx(), plan = [];
  for (const s of sets) {
    const { base, camps } = admgrMarkParse(s.name);
    const old = base.replace(AG_COPY_TAIL, '').trim(), m = old.match(AG_RULE);
    let pname = m ? m[1] : '', note = '';
    const n = admgrNorm(pname || old);
    let cands = idx.filter(x => n.includes(x.n)), loose = false;   // 이름에 들어 있는 상품 전부 (긴 이름 먼저) — '모튼 가디건 니트'에 '라이트 모튼 가디건 니트'도 걸리면 고르게
    if (!cands.length) {   // 옛 이름이 상품명보다 짧은 경우 (2026-10-27: '리얼 소프트 퍼cd' = '리얼 소프트 퍼 가디건', '플랫 루즈핏 블루종' = '…블루종 점퍼') — 약어를 풀고, 이름 토막이 상품명 안에 들어 있는 상품을 후보로
      const ABBR = [[/cd$/i, '가디건'], [/ops$/i, '원피스'], [/mtm$/i, '맨투맨'], [/pt$/i, '팬츠'], [/jk$/i, '자켓'], [/sk$/i, '스커트'], [/bl$/i, '블라우스']];
      const toks = old.split('_').map(x => coreName(x).replace(/^[\s\-–—·.@#]+/, '').replace(/^\d{3,4}\s+/, '').replace(/\d{1,3}([.,]\d{3})+|\d{4,6}/g, '').replace(/\s+\d{1,3}$/, '').trim()).filter(x => admgrNorm(x).length >= 4);
      for (const tk of toks) { let k = admgrNorm(tk); for (const [re, full] of ABBR) if (re.test(k)) k = k.replace(re, admgrNorm(full));
        const hit = idx.filter(x => x.n.includes(k) || x.n.includes(admgrNorm(tk))); if (hit.length) { cands = hit; loose = true; break; } }
    }
    const vt = x => typeof regVerTag === 'function' ? regVerTag(x.name) : '', tagHit = x => { const t = vt(x); return t && n.includes(admgrNorm(t.replace(/ver\d*$/i, ''))) ? 1 : 0; };
    cands.sort((a, b) => tagHit(b) - tagHit(a) || b.n.length - a.n.length || (vt(a) ? 1 : 0) - (vt(b) ? 1 : 0));   // 기본 후보 (2026-10-27): 이름에 '기모' 같은 버전 단어가 있으면 그 버전 → 더 구체적인 상품 → 버전 없는 일반 상품 ('클레르 블라우스 25000'에 기모ver가 먼저 잡히던 것)
    const pick = picks && picks[s.id], p = (pick != null && cands.find(x => x.no === pick)) || cands[0] || null;
    if (!pname) pname = p ? (typeof regVerTag === 'function' && regVerTag(p.name) ? regVerTag(p.name) + ' ' : '') + coreName(p.name)
      : (old.split('_').map(x => coreName(x).replace(/^[\s\-–—·.@#]+/, '').replace(/^\d{3,4}\s+/, '').replace(/\d{1,3}(,\d{3})+|\d{4,6}/g, '').replace(/\s*-\s*[가-힣]+\s*$/, '').replace(/\s+\d{1,3}$/, '').replace(/\s+/g, ' ').trim())   // 날짜·가격·' - 색상'·꼬리 숫자 제거
          .filter(x => x && !/^\d+$/.test(x)).sort((a, b) => b.length - a.length)[0] || old);   // 옛 이름('전환_(160이상 추천)밍크 트임 pt (2 colors)_231219'): 상품 목록에서 찾기 → 지금 없는 상품이면 가장 긴 토막(괄호 뺀 것)
    if (!p) note = '상품 못 찾음 — 마진은 ' + (m ? '예전 값' : '0'); else if (loose && pick == null) note = '이름이 짧아 비슷한 상품으로 잡았어요 — 맞는지 확인';
    const rp = m ? m[2] : (s.is_video || /릴스|영상/.test(old)) ? 'R' : 'P', tag = m && m[4] ? m[4].slice(1) : '끌올';   // 옛 이름: 소재 종류 → 없으면 이름의 릴스·영상 힌트
    const margin = p ? Math.floor(Math.max(0, (p.price || 0) - (p.supply || 0)) / 1000) : (m ? +m[5] : 0);
    const k = seqKey(pname, rp), seq = (seqMax.get(k) || 0) + 1; seqMax.set(k, seq);
    const name = `${pname}_${rp}${seq}_${tag}_${margin}_${d}_test`;
    plan.push({ id: s.id, from: base, to: name, name: admgrMarkName(name, camps), level: 'adset', note, product: p ? p.name : '', cands: cands.map(x => ({ no: x.no, name: x.name })), pick: p ? p.no : null });
    for (const a of (s.ads || [])) plan.push({ id: a.id, from: a.name, to: name, name, level: 'ad', note: '' });
  }
  return plan;
}
const admgrCopySets = () => admgrRows().sets.filter(s => AG_COPY_TAIL.test(admgrBase(s.name)));
async function admgrRepostModal() {
  const sets = admgrCopySets();
  if (!sets.length) { toast('이름 뒤에 "사본"이 붙은 세트가 없어요 — Meta에서 복사한 뒤 새로고침하세요'); return; }
  if (!admgr.products && !admgr.productsLoading) await admgrLoadProducts();
  while (admgr.productsLoading) await new Promise(r => setTimeout(r, 200));   // 화면 그리기가 먼저 시작한 상품 조회가 끝날 때까지 — 안 기다리면 전부 '상품 못 찾음' (2026-10-15 실사례)
  $('abm-title').textContent = `끌올 사본 정리 — 세트 ${sets.length}개`; $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = '<div style="padding:16px;color:#6b7280;font-size:.8rem;">소재 종류(영상·이미지)를 확인하는 중…</div>';
  $('admgr-budget-modal').classList.add('show');
  try {   // 규칙 이름이 아닌 옛 세트의 R/P는 소재 종류로 — creatives 조회(썸네일 응답의 is_video)
    const ids = sets.map(s => s.id), kind = new Map(), adsOf = new Map();
    for (let i = 0; i < ids.length; i += 100) { const r = await metaGet({ action: 'creatives', set_ids: ids.slice(i, i + 100).join(',') }); (r.ads || []).forEach(a => { const k = String(a.adset_id); if (a.is_video) kind.set(k, true); else if (!kind.has(k)) kind.set(k, false); (adsOf.get(k) || adsOf.set(k, []).get(k)).push({ id: a.id, name: a.name }); }); }
    sets.forEach(s => { s.is_video = !!kind.get(String(s.id)); if (!(s.ads || []).length) s.ads = adsOf.get(String(s.id)) || []; });   // 방금 복사한 세트는 성과가 없어 계층 데이터에 광고가 안 실려 온다 → 썸네일 조회의 광고 목록으로
  } catch (e) { toast('소재 종류 확인 실패 — 영상/이미지는 이름 규칙으로만: ' + e.message); }
  admgr.repostSets = sets; admgr.repostPick = {};
  admgrRepostRender();
}
function admgrRepostPick(setId, no) { admgr.repostPick[setId] = Number(no); admgrRepostRender(); }   // 비슷한 상품이 여럿일 때 고르면 이름·마진·순번을 다시 계산
function admgrRepostRender() {
  const plan = admgrRepostPlan(admgr.repostSets, admgrRows().sets, todayStr(0), admgr.repostPick);
  admgr.repostPlan = plan;
  const sel = p => p.cands && p.cands.length > 1 ? `<div style="margin:3px 0 2px 44px;font-size:.74rem;color:#b45309;">비슷한 상품이 ${p.cands.length}개 — <select onchange="admgrRepostPick('${p.id}', this.value)" style="font-size:.74rem;padding:2px 6px;border:1px solid #fbbf24;border-radius:6px;max-width:100%;">${p.cands.map(c => `<option value="${c.no}" ${c.no === p.pick ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>`
    : p.level === 'adset' && p.product ? `<div style="margin:0 0 2px 44px;font-size:.7rem;color:#9ca3af;">상품: ${esc(p.product)}</div>` : '';
  const row = p => `<div style="padding:4px 0;border-bottom:1px solid #f3f4f6;font-size:.76rem;"><span class="ag-muted" style="margin-right:6px;">${p.level === 'adset' ? '세트' : '광고'}</span>${esc(p.from)} <span style="color:#9ca3af;">→</span> <b>${esc(p.to)}</b>${p.note ? ` <span style="color:#b45309;">· ${esc(p.note)}</span>` : ''}${sel(p)}</div>`;
  const amb = plan.filter(p => p.cands && p.cands.length > 1).length;
  $('abm-body').innerHTML = `
    <div style="font-size:.78rem;color:#4b5563;margin-bottom:8px;">소재 업로드와 같은 규칙으로 이름을 다시 지어요 — <b>상품명_R순번_소구점_마진_오늘날짜_test</b>. 순번은 그 상품의 기존 세트 다음 번호, 마진은 지금 상품 가격 기준이에요.${amb ? `<div style="color:#b45309;margin-top:4px;">비슷한 이름의 상품이 여럿인 세트 ${amb}개 — 아래에서 맞는 상품을 골라주세요 (고르면 이름·마진이 바로 바뀌어요)</div>` : ''}</div>
    <div style="max-height:45vh;overflow:auto;">${plan.map(row).join('')}</div>
    <div style="font-size:.7rem;color:#9ca3af;margin-top:10px;">이름만 바뀌고 성과·학습에는 영향 없어요 · 이름에 test가 들어가 테스트 소재 탭에서 판정돼요 · 소구점이 없던 옛 이름은 '끌올'로 넣었으니 필요하면 Meta에서 고치세요</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button class="btn-ghost" onclick="closeModal('admgr-budget-modal')">취소</button>
      <button class="btn-analyze" id="ag-repost-go" onclick="admgrRepostRun()">이름 바꾸기</button></div>`;
}
async function admgrRepostRun() {
  const plan = admgr.repostPlan || []; if (!plan.length) return;
  const btn = $('ag-repost-go'); btn.disabled = true;
  const failed = await admgrRenameBatch(plan, btn), bad = new Set(failed.map(f => String(f.id)));
  const ok = plan.filter(p => !bad.has(String(p.id)));
  $('abm-title').textContent = '끌올 사본 정리 결과';
  $('abm-body').innerHTML = `<div style="font-size:.8rem;color:#374151;">세트 <b style="color:#15803d;">${ok.filter(p => p.level === 'adset').length}</b>개 · 광고 <b style="color:#15803d;">${ok.filter(p => p.level === 'ad').length}</b>개 이름을 바꿨어요</div>
    ${failed.map(f => `<div style="font-size:.74rem;color:#dc2626;">✗ ${esc(String(f.id))} — ${esc(String(f.error || ''))}</div>`).join('')}
    <div style="font-size:.7rem;color:#9ca3af;margin-top:10px;">화면을 새로 받아오고 있어요 — 테스트 소재 탭에도 새 이름으로 올라와요</div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn-analyze" onclick="closeModal('admgr-budget-modal')">확인</button></div>`;
  admgrFetch();
}
/* ═══ 지난 소재 찾기 (2026-10-27 사용자 요청) — 끌올할 상품명으로 작년 1월부터 돌았던 광고를 같은 소재끼리 묶어 클릭 7일 구매당 비용 ÷ 마진 낮은 순으로.
   고르면 소재마다 새 세트 1개(타겟은 그 소재가 가장 잘 됐던 세트, 입찰·최적화는 넣을 캠페인의 지금 세트) + 광고 1개를 고른 캠페인에 켜진 상태로 만든다(PIN). 이름은 끌올 사본 정리와 같은 규칙 */
admgr.past = { q: '', since: '', data: null, loading: false, sel: new Set(), camp: '', budget: '15000', picks: {} };
function admgrPastRows() {
  const d = admgr.past.data; if (!d) return [];
  return d.groups.map(g => {
    const best = g.ads.filter(a => a.p >= 3).sort((x, y) => x.sp / x.p - y.sp / y.p)[0] || [...g.ads].sort((x, y) => y.p - x.p)[0];
    const m = admgrMarginOf({ id: '', name: best.ad }).m || admgrMarginOf({ id: '', name: best.set }).m;
    return { ...g, best, m, pct: g.p && m ? Math.round(g.sp / g.p / m * 100) : null, roas: g.sp ? g.v / g.sp : 0, nSets: new Set(g.ads.map(a => a.set_id)).size };
  }).filter(g => g.p >= 5).sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999) || b.p - a.p);
}
function admgrPastPlan(rows) {   // 고른 소재 → 끌올 규칙 이름 (같은 상품이 여럿이면 순번이 이어진다)
  const input = rows.map(g => ({ id: g.key, name: AG_RULE.test(admgrBase(g.best.set)) ? g.best.set : g.best.ad, ads: [], is_video: g.is_video }));
  return new Map(admgrRepostPlan(input, admgrRows().sets, todayStr(0), admgr.past.picks).filter(p => p.level === 'adset').map(p => [p.id, p]));
}
async function admgrPastModal() {
  const P = admgr.past;
  if (!P.since) P.since = (Number(todayStr(0).slice(0, 4)) - 1) + '-01-01';
  if (!P.camp) { const n = new Map(); for (const r of admgrRows().sets) if (admgrIsTest(r) && r.status === 'ACTIVE') n.set(r._campId, (n.get(r._campId) || 0) + 1); P.camp = [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''; }   // 테스트 세트가 가장 많은 캠페인
  if (!admgr.products && !admgr.productsLoading) admgrLoadProducts();
  $('abm-title').textContent = '지난 소재 찾기'; $('abm-sub').style.display = 'none';
  $('admgr-budget-modal').classList.add('show');
  admgrPastRender();
}
async function admgrPastSearch() {
  const P = admgr.past; P.q = (($('ag-past-q') || {}).value || '').trim(); P.since = ($('ag-past-since') || {}).value || P.since;
  if (P.q.length < 2) { toast('상품명을 2글자 이상 입력하세요'); return; }
  P.loading = true; P.data = null; P.sel.clear(); P.picks = {}; admgrPastRender();
  try {
    while (admgr.productsLoading) await new Promise(r => setTimeout(r, 200));   // 마진 계산에 상품 가격이 필요
    P.data = await metaGet({ action: 'pastcre', q: P.q, since: P.since, until: todayStr(0) });
  } catch (e) { toast('조회 실패: ' + e.message); }
  P.loading = false; admgrPastRender();
}
function admgrPastToggle(k) { const S = admgr.past.sel; if (S.has(k)) S.delete(k); else if (S.size >= 20) toast('한 번에 20개까지예요'); else S.add(k); admgrPastRender(); }
function admgrPastPick(k, no) { admgr.past.picks[k] = Number(no); admgrPastRender(); }
function admgrPastRender() {
  const P = admgr.past, rows = admgrPastRows(), chosen = rows.filter(g => P.sel.has(g.key)), plan = admgrPastPlan(chosen);
  const camps = admgrRows().camps, camp = camps.find(c => c.id === P.camp), cbo = !!camp && (camp.budget > 0 || camp.budget_life > 0);
  const ym = d => d ? d.slice(2, 7).replace('-', '.') : '';
  const row = g => { const on = P.sel.has(g.key), pl = plan.get(g.key), a = g.best;
    return `<label style="display:grid;grid-template-columns:20px 46px minmax(0,1fr) auto;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid #f3f4f6;cursor:pointer;font-size:.76rem;">
      <input type="checkbox" ${on ? 'checked' : ''} data-k="${esc(g.key)}" onchange="admgrPastToggle(this.dataset.k)" />
      ${g.thumb ? `<img src="${esc(g.thumb)}" style="width:46px;height:46px;object-fit:cover;border-radius:6px;" loading="lazy" />` : '<div style="width:46px;height:46px;border-radius:6px;background:#f3f4f6;"></div>'}
      <div style="min-width:0;"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${g.is_video ? '<i class="fa-solid fa-film" style="color:#9ca3af;margin-right:4px;"></i>' : ''}${esc(admgrBase(a.ad))}</div>
        <div class="ag-muted" style="font-size:.7rem;">${ym(g.first)} ~ ${ym(g.last)} · 세트 ${g.nSets}개 · 가장 좋았던 세트 ${esc(admgrBase(a.set).slice(0, 30))}${g.live ? ' · <span style="color:#b45309;">지금 켜져 있음</span>' : ''}</div>
        ${on && pl ? `<div style="font-size:.72rem;color:#4f46e5;margin-top:2px;">→ ${esc(pl.to)}${pl.note ? ` <span style="color:#b45309;">· ${esc(pl.note)}</span>` : ''}</div>
          ${pl.cands && pl.cands.length > 1 ? `<div style="font-size:.7rem;color:#b45309;">비슷한 상품 ${pl.cands.length}개 — <select data-k="${esc(g.key)}" onchange="admgrPastPick(this.dataset.k, this.value)" style="font-size:.7rem;max-width:100%;">${pl.cands.map(c => `<option value="${c.no}" ${c.no === pl.pick ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>` : ''}` : ''}</div>
      <div style="text-align:right;white-space:nowrap;"><b>${comma(Math.round(g.p))}건</b><div style="font-size:.7rem;color:${g.pct == null ? '#9ca3af' : g.pct <= 30 ? '#15803d' : g.pct <= 40 ? '#374151' : '#dc2626'};">${g.pct == null ? '마진 모름' : '마진의 ' + g.pct + '%'} · ROAS ${g.roas.toFixed(1)}</div></div></label>`; };
  const d = P.data;
  $('abm-body').innerHTML = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
      <input class="inp" id="ag-past-q" value="${esc(P.q)}" placeholder="상품명 (예: 클레르 블라우스)" style="flex:1;min-width:160px;" onkeydown="if(event.key==='Enter')admgrPastSearch()" />
      <input class="inp" type="date" id="ag-past-since" value="${esc(P.since)}" style="width:140px;" />
      <button class="btn-analyze" onclick="admgrPastSearch()" ${P.loading ? 'disabled' : ''}>${P.loading ? '찾는 중…' : '찾기'}</button></div>
    <div class="ag-muted" style="font-size:.7rem;margin-bottom:6px;">광고 이름에 상품명이 들어간 광고 · 같은 영상·이미지·인스타 게시물끼리 묶음 · 클릭 7일 구매 5건 이상 · 구매당 비용 ÷ 마진 낮은 순</div>
    <div style="max-height:46vh;overflow:auto;">${P.loading ? '<div style="padding:16px;color:#6b7280;font-size:.8rem;"><i class="fa-solid fa-spinner fa-spin"></i> 작년부터 돈 광고를 모으는 중… (10초쯤)</div>'
      : !d ? '' : rows.length ? rows.map(row).join('') : '<div style="padding:12px 0;color:#9ca3af;font-size:.78rem;">구매 5건 이상인 소재가 없어요</div>'}</div>
    ${d && (d.ads_capped || d.meta_err) ? `<div style="font-size:.7rem;color:#b45309;margin-top:6px;">${d.ads_capped ? '광고가 많아 지출 상위 400개만 봤어요 · ' : ''}${d.meta_err ? '일부 소재 정보를 못 받아 따로 보일 수 있어요' : ''}</div>` : ''}
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px;">
      <span style="font-size:.76rem;color:#4b5563;">넣을 캠페인</span>
      <select class="inp" style="flex:1;min-width:160px;" onchange="admgr.past.camp=this.value;admgrPastRender()">${camps.map(c => `<option value="${c.id}" ${c.id === P.camp ? 'selected' : ''}>${esc(admgrBase(c.name))}${c.budget > 0 || c.budget_life > 0 ? ' · CBO' : ''}</option>`).join('')}</select>
      ${cbo ? '' : `<span style="font-size:.76rem;color:#4b5563;">세트 일예산</span><input class="inp" id="ag-past-budget" value="${esc(P.budget)}" style="width:90px;" oninput="admgr.past.budget=this.value" />`}</div>
    <div style="font-size:.7rem;color:#9ca3af;margin-top:8px;">소재마다 새 세트 1개 · 타겟은 그 소재가 가장 잘 됐던 세트에서, 입찰·최적화·전환 이벤트는 넣을 캠페인의 지금 세트를 따라요 · <b style="color:#dc2626;">세트·광고 모두 켜진 상태로 바로 게재</b> · PIN 필요</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
      <button class="btn-ghost" onclick="closeModal('admgr-budget-modal')">닫기</button>
      <button class="btn-analyze" id="ag-past-go" onclick="admgrPastRun()" ${chosen.length ? '' : 'disabled'}>${chosen.length ? chosen.length + '개 켜서 만들기' : '소재를 고르세요'}</button></div>`;
}
async function admgrPastRun() {
  const w = admgr.write;
  if (!w.pin) { admgrPinPrompt(() => admgrPastRun()); return; }
  const P = admgr.past, rows = admgrPastRows().filter(g => P.sel.has(g.key)); if (!rows.length) return;
  const camp = admgrRows().camps.find(c => c.id === P.camp); if (!camp) { toast('캠페인을 고르세요'); return; }
  const cbo = camp.budget > 0 || camp.budget_life > 0, budget = Number(String(P.budget || '').replace(/[^\d]/g, ''));
  if (!cbo && !(budget >= 1000)) { toast('세트 일예산을 입력하세요 (1,000원 이상)'); return; }
  const plan = admgrPastPlan(rows), items = rows.map(g => ({ ad_id: g.best.ad_id, name: (plan.get(g.key) || {}).to })).filter(x => x.name);
  if (!confirm(`${admgrBase(camp.name)}에 세트 ${items.length}개를 켜진 상태로 만들어요${cbo ? '' : ` (하루 최대 ${comma(budget * items.length)}원)`}. 진행할까요?`)) return;
  const btn = $('ag-past-go'); btn.disabled = true; btn.textContent = '만드는 중…';
  try {
    const d = await sbCall('meta-upload', { action: 'adset_repost' }, { pin: w.pin, campaign_id: camp.id, daily_budget: budget, items });
    P.sel.clear();
    $('abm-title').textContent = '지난 소재 다시 테스트 결과';
    $('abm-body').innerHTML = `<div style="font-size:.8rem;color:#374151;margin-bottom:6px;">${esc(d.campaign || '')}에 세트 <b style="color:#15803d;">${(d.created || []).length}</b>개를 켜진 상태로 만들었어요${(d.failed || []).length ? ` · 실패 <b style="color:#dc2626;">${d.failed.length}</b>개` : ''}</div>
      ${(d.created || []).map(c => `<div style="font-size:.74rem;">✓ ${esc(c.name)}</div>`).join('')}
      ${(d.failed || []).map(f => `<div style="font-size:.74rem;color:#dc2626;">✗ ${esc(f.name || f.ad_id)} — ${esc(String(f.error || ''))}</div>`).join('')}
      <div style="font-size:.7rem;color:#9ca3af;margin-top:10px;">이름에 test가 들어가 테스트 소재 탭에서 판정돼요 · 화면을 새로 받아오고 있어요</div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn-ghost" onclick="admgrPastModal()">다시 찾기</button> <button class="btn-analyze" onclick="closeModal('admgr-budget-modal')">확인</button></div>`;
    admgrFetch();
  } catch (e) {
    btn.disabled = false; btn.textContent = rows.length + '개 켜서 만들기';
    if (/PIN/.test(e.message)) admgrPinInvalidate();
    toast('만들기 실패: ' + e.message);
  }
}
function admgrCopyModal() {
  const { camps, ads } = admgrRows();
  if (!admgr.copyPick) admgr.copyGroups = null;   // 광고 탭에서 연 경우 — 승격 후보에서 남은 상품 묶음은 버림
  const picked = admgr.copyPick || ads.filter(a => admgr.selAds.has(a.id));   // copyPick: 승격 후보 모달에서 넘어온 테스트 광고 (계층 데이터에 없어도 복사)
  if (!picked.length) { toast('복사할 광고를 먼저 체크하세요'); return; }
  const cid = admgr.copyCamp && camps.some(c => c.id === admgr.copyCamp) ? admgr.copyCamp : (camps[0] || {}).id;
  admgr.copyCamp = cid;
  const camp = camps.find(c => c.id === cid) || { adsets: [] };
  /* 세트 목록은 서버에서 따로 받는다 — 꺼진 캠페인 안의 세트는 화면 데이터(활성만)에 없어서 "세트가 없어요"로 보이던 문제 (2026-09-16) */
  admgr.copySets = admgr.copySets || {};
  const cached = admgr.copySets[cid];
  if (cached === undefined) {
    admgr.copySets[cid] = null;   // 불러오는 중
    metaGet({ action: 'adsets', campaign_id: cid })
      .then(d => { admgr.copySets[cid] = d.rows || []; if ($('ag-copy-camp')) admgrCopyModal(); })
      .catch(e => { admgr.copySets[cid] = []; toast('광고세트 목록 실패: ' + e.message); if ($('ag-copy-camp')) admgrCopyModal(); });
  }
  const sets = cached || [];
  const loading = cached === null || cached === undefined;
  $('abm-title').textContent = `광고 복사 — ${picked.length}개`;
  $('abm-sub').style.display = 'none';
  const newMode = admgr.copyMode === 'new';
  const list = `<div style="font-size:.78rem;color:#374151;line-height:1.7;max-height:24vh;overflow:auto;margin-bottom:12px;">
      ${picked.map(a => `· ${esc(admgrBase(a.name))} <span style="color:#9ca3af;">(${esc(admgrBase(a._setName))})</span>`).join('<br/>')}</div>
    <div class="filter-tabs" style="margin-bottom:10px;">
      <button class="filter-tab ${newMode ? '' : 'active'}" onclick="admgr.copyMode='set';admgrCopyModal()">기존 세트에 복사</button>
      <button class="filter-tab ${newMode ? 'active' : ''}" onclick="admgr.copyMode='new';admgrCopyModal()">새 상품 CBO 캠페인 만들기</button></div>`;
  if (newMode) {   // 상품 CBO (2026-10-16): 본뜰 캠페인 설정으로 새 CBO 캠페인 + 세트 1개(꺼짐) + 광고(켜짐) 복사 — PIN
    const guess = admgr.copyProduct || admgrBase(picked[0].name).split(/[_]| \d|\(/)[0].replace(/\s*-\s*사본.*$/, '').trim();
    const kindAll = admgr.copyKind === 'all', ymd = todayStr(0).replace(/-/g, '').slice(2);   // 종합 CBO: 캠페인 하나, 이름 종합CBO_날짜 (2026-10-26 사용자 요청)
    $('abm-body').innerHTML = `${list}
    <div class="filter-tabs" style="margin-bottom:8px;">
      <button class="filter-tab ${kindAll ? '' : 'active'}" onclick="admgr.copyKind='prod';admgrCopyModal()">상품 CBO <small class="ag-muted">상품마다 캠페인</small></button>
      <button class="filter-tab ${kindAll ? 'active' : ''}" onclick="admgr.copyKind='all';admgrCopyModal()">종합 CBO <small class="ag-muted">캠페인 하나 · 종합CBO_${ymd}</small></button></div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <label style="font-size:.76rem;font-weight:700;color:#4b5563;">본뜰 캠페인 <span style="font-weight:400;color:#9ca3af;">(목표·입찰·타겟·노출 위치·전환 이벤트를 그대로)</span>
        <select class="inp" id="ag-copy-model" style="width:100%;margin-top:4px;" onchange="admgr.copyCamp=this.value">
          ${camps.map(c => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(admgrBase(c.name))}${c.budget ? ' · CBO' : ''}${c.status === 'ACTIVE' ? '' : ' (꺼짐)'}</option>`).join('')}</select></label>
      ${kindAll ? `<div style="font-size:.76rem;font-weight:700;color:#4b5563;">캠페인 이름: 종합CBO_${ymd} <span style="font-weight:400;color:#9ca3af;">— 체크한 광고 ${picked.length}개가 세트 하나에 들어가요</span></div>`
      : admgr.copyGroups && admgr.copyGroups.length > 1 ? `<div style="font-size:.76rem;font-weight:700;color:#4b5563;">상품 ${admgr.copyGroups.length}개 → 캠페인 ${admgr.copyGroups.length}개를 따로 만들어요 <span style="font-weight:400;color:#9ca3af;">— 상품CBO_상품명_${todayStr(0).replace(/-/g, '').slice(2)}</span>
        <div style="font-weight:400;margin-top:4px;line-height:1.7;">${admgr.copyGroups.map(g => `· ${esc(g.product)} <span style="color:#9ca3af;">(광고 ${g.ads.length}개)</span>`).join('<br/>')}</div></div>`
      : `<label style="font-size:.76rem;font-weight:700;color:#4b5563;">상품명 <span style="font-weight:400;color:#9ca3af;">— 캠페인 이름: 상품CBO_상품명_${todayStr(0).replace(/-/g, '').slice(2)}</span>
        <input class="inp" id="ag-copy-prod" value="${esc(guess)}" style="width:100%;margin-top:4px;" oninput="admgr.copyProduct=this.value" /></label>`}
      <label style="font-size:.76rem;font-weight:700;color:#4b5563;">캠페인 일예산 (원)${!kindAll && admgr.copyGroups && admgr.copyGroups.length > 1 ? ' <span style="font-weight:400;color:#9ca3af;">— 캠페인마다 같은 금액</span>' : ''}
        <input class="inp" id="ag-copy-budget" type="text" inputmode="numeric" value="${admgr.copyBudget || ''}" placeholder="예: 100000" style="width:100%;margin-top:4px;" oninput="admgr.copyBudget=this.value" /></label>
    </div>
    <div style="font-size:.7rem;color:#9ca3af;margin-top:10px;line-height:1.6;">캠페인·광고세트는 <b>꺼진 상태</b>, 광고는 <b>켜진 상태</b>로 만들어요 — 세트를 켜면 바로 게재돼요 · 같은 소재는 하나만 들어가요<br/>원본 세트 이름 뒤에 [→캠페인명] 표시가 붙어요</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button class="btn-ghost" onclick="closeModal('admgr-budget-modal')">취소</button>
      <button class="btn-analyze" id="ag-copy-go" onclick="admgrCampCopyRun()"><i class="fa-solid fa-lock" style="font-size:.7em;margin-right:4px;"></i> 캠페인 만들기</button></div>`;
    $('admgr-budget-modal').classList.add('show');
    return;
  }
  $('abm-body').innerHTML = `${list}
    <div style="display:flex;flex-direction:column;gap:8px;">
      <label style="font-size:.76rem;font-weight:700;color:#4b5563;">캠페인
        <select class="inp" id="ag-copy-camp" style="width:100%;margin-top:4px;" onchange="admgr.copyCamp=this.value;admgrCopyModal()">
          ${camps.map(c => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(admgrBase(c.name))}${c.status === 'ACTIVE' ? '' : ' (꺼짐)'}</option>`).join('')}</select></label>
      <label style="font-size:.76rem;font-weight:700;color:#4b5563;">광고세트
        <select class="inp" id="ag-copy-set" style="width:100%;margin-top:4px;">
          ${loading ? '<option value="">불러오는 중…</option>' : sets.length ? sets.map(x => `<option value="${x.id}">${esc(admgrBase(x.name))}${x.status === 'ACTIVE' ? '' : ' (꺼짐)'}</option>`).join('') : '<option value="">(이 캠페인에 광고세트가 없어요)</option>'}</select></label>
    </div>
    <div style="font-size:.7rem;color:#9ca3af;margin-top:10px;line-height:1.6;">복사한 광고는 <b>꺼진 상태</b>로 만들어져요 · 같은 소재가 이미 있으면 건너뛰고 알려드려요<br/>원본 세트 이름 뒤에 <b>[→${esc(admgrBase(camp.name || ''))}]</b> 표시가 붙어요 (메타 광고관리자에도 보여요)</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button class="btn-ghost" onclick="closeModal('admgr-budget-modal')">취소</button>
      <button class="btn-analyze" id="ag-copy-go" onclick="admgrCopyRun()" ${sets.length ? '' : 'disabled'}>${loading ? '불러오는 중…' : '복사'}</button></div>`;
  $('admgr-budget-modal').classList.add('show');
}
async function admgrCopyRun() {
  const setId = ($('ag-copy-set') || {}).value || '';
  const camps = admgrRows().camps, ads = admgr.copyPick || admgrRows().ads.filter(a => admgr.selAds.has(a.id));
  const camp = camps.find(c => c.id === admgr.copyCamp);
  if (!setId || !ads.length || !camp) return;
  const btn = $('ag-copy-go'); btn.disabled = true; btn.textContent = '복사 중…';
  try {
    const d = await sbCall('meta-upload', { action: 'ad_copy' }, { ads: ads.map(a => a.id), adset_id: setId });
    let marked = 0;
    const campName = admgrBase(camp.name);
    const bySet = new Map();   // 원본 세트 → 이름 (복사 성공분만 표시)
    for (const c of (d.created || [])) { const a = ads.find(x => x.id === c.id); if (a) bySet.set(a._setId, a._setName); }
    const items = [];
    for (const [sid, sname] of bySet) {
      const { camps: has } = admgrMarkParse(sname);
      if (has.includes(campName)) continue;
      items.push({ id: sid, name: admgrMarkName(sname, [...has, campName]) });
    }
    if (items.length) { const r = await sbCall('meta-upload', { action: 'adset_rename' }, { items }); marked = r.ok || 0; }
    admgr.selAds.clear(); admgr.mSelect = false; admgr.copyPick = null; admgr.copyGroups = null;   // 폰 선택모드였다면 동작 완료로 나감 (B)
    const tgt = (admgr.copySets && admgr.copySets[admgr.copyCamp] || []).find(x => x.id === setId) || admgrRows().sets.find(x => x.id === setId) || {};
    admgrCopyResult(d, campName, admgrBase(tgt.name || ''), marked, [...bySet.keys()]);
    admgrFetch();
  } catch (e) {
    btn.disabled = false; btn.textContent = '복사';
    toast('복사 실패: ' + e.message);
  }
}
async function admgrCampCopyRun() {
  const w = admgr.write;
  if (!w.pin) { admgrPinPrompt(() => admgrCampCopyRun()); return; }
  const ads = admgr.copyPick || admgrRows().ads.filter(a => admgr.selAds.has(a.id));
  const kindAll = admgr.copyKind === 'all', multi = !kindAll && admgr.copyGroups && admgr.copyGroups.length > 1;
  const modelId = ($('ag-copy-model') || {}).value || admgr.copyCamp, product = (multi || kindAll) ? '' : (($('ag-copy-prod') || {}).value || '').trim();
  const budget = Number(String(($('ag-copy-budget') || {}).value || '').replace(/[^\d]/g, ''));
  if (!ads.length || !modelId) return;
  if (!multi && !kindAll && !product) { toast('상품명을 입력하세요'); return; }
  if (!(budget >= 1000)) { toast('캠페인 일예산을 입력하세요 (1,000원 이상)'); return; }
  const btn = $('ag-copy-go'); btn.disabled = true; btn.textContent = '만드는 중…';
  const groups = multi ? admgr.copyGroups : [{ product, ads }];   // 상품마다 캠페인 하나씩 (2026-10-26) · 종합 CBO는 묶지 않고 하나
  try {
    const all = { created: [], skipped: [], failed: [] }, names = [], srcSets = new Set(); let marked = 0;
    for (const g of groups) {
      if (groups.length > 1) btn.textContent = `만드는 중… ${names.length + 1}/${groups.length} ${g.product}`;
      let d;
      try { d = await sbCall('meta-upload', { action: 'campaign_copy' }, { pin: w.pin, model_campaign_id: modelId, product: g.product, kind: kindAll ? 'all' : 'prod', daily_budget: budget, ads: g.ads.map(a => a.id) }); }
      catch (e) { if (/PIN/.test(e.message)) throw e; all.failed.push({ id: '', name: `${g.product} 캠페인`, error: e.message }); continue; }   // 한 상품이 실패해도 다음 상품은 계속
      names.push(d.name);
      for (const c of (d.created || [])) { const a = g.ads.find(x => x.id === c.id); all.created.push({ ...c, name: `${c.name} → ${d.name}` }); if (a) srcSets.add(a._setId); }
      (d.skipped || []).forEach(x => all.skipped.push(x)); (d.failed || []).forEach(x => all.failed.push({ ...x, name: `${x.name || x.id} (${d.name})` }));
      const bySet = new Map(); for (const c of (d.created || [])) { const a = g.ads.find(x => x.id === c.id); if (a) bySet.set(a._setId, a._setName); }
      const items = []; for (const [sid, sname] of bySet) { const { camps: has } = admgrMarkParse(sname); if (!has.includes(d.name)) items.push({ id: sid, name: admgrMarkName(sname, [...has, d.name]) }); }
      if (items.length) { try { const r = await sbCall('meta-upload', { action: 'adset_rename' }, { items }); marked += r.ok || 0; } catch { /* 표시만 실패 */ } }
    }
    admgr.selAds.clear(); admgr.mSelect = false; admgr.copyProduct = ''; admgr.copyBudget = ''; admgr.copyPick = null; admgr.copyGroups = null;
    admgrCopyResult(all, names.length > 1 ? `상품CBO ${names.length}개 만듦` : (names[0] || (kindAll ? '종합CBO' : '상품CBO')), (names.length > 1 ? names.join(' · ') : names[0] || '') + ' (캠페인·세트 꺼짐 · 광고 켜짐)', marked, [...srcSets]);
    admgrFetch();
  } catch (e) {
    btn.disabled = false; btn.textContent = '캠페인 만들기';
    if (/PIN/.test(e.message)) admgrPinInvalidate();
    toast('캠페인 만들기 실패: ' + e.message);
  }
}
function admgrCopyResult(d, campName, setName, marked, srcSets) {   // srcSets: 복사 성공한 광고의 원본 테스트 세트 id — 예산 1,000원 임시 저장 버튼 (2026-10-23 ⑦)
  const ok = (d.created || []), skip = (d.skipped || []), bad = (d.failed || []);
  const src = (srcSets || []).filter(id => admgrRows().sets.some(s => s.id === id && s.status === 'ACTIVE' && s.budget > 1000));
  const line = (t, c) => `<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid #f3f4f6;font-size:.78rem;"><span style="flex:none;color:${c};font-weight:800;">${c === '#15803d' ? '✓' : c === '#b45309' ? '!' : '✗'}</span><span style="min-width:0;">${t}</span></div>`;
  $('abm-title').textContent = '광고 복사 결과';
  $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = `
    <div style="font-size:.82rem;font-weight:800;color:#1e1b4b;margin-bottom:8px;">${esc(campName)} · ${esc(setName)}</div>
    <div style="font-size:.8rem;color:#374151;margin-bottom:10px;">복사 <b style="color:#15803d;">${ok.length}</b>개${skip.length ? ` · 건너뜀 <b style="color:#b45309;">${skip.length}</b>개` : ''}${bad.length ? ` · 실패 <b style="color:#dc2626;">${bad.length}</b>개` : ''}${marked ? ` · 원본 세트 ${marked}개에 표시` : ''}</div>
    <div style="max-height:40vh;overflow:auto;">
      ${ok.map(x => line(`${esc(x.name)} <span style="color:#9ca3af;">— ${String(campName).startsWith('상품CBO_') ? '켜진 상태로 넣었어요 (세트는 꺼짐)' : '꺼진 상태로 만들었어요'}</span>`, '#15803d')).join('')}
      ${skip.map(x => line(`${esc(x.name)} <span style="color:#b45309;">— 이미 같은 소재가 있어요${x.existing ? ` (${esc(x.existing)})` : ''}</span>`, '#b45309')).join('')}
      ${bad.map(x => line(`${esc(x.id)} <span style="color:#dc2626;">— ${esc(String(x.error || '실패'))}</span>`, '#dc2626')).join('')}</div>
    <div style="font-size:.7rem;color:#9ca3af;margin-top:10px;">복사본은 꺼져 있어요 — 메타나 이 화면의 켜기/끄기로 켜주세요</div>
    ${src.length ? `<div style="margin-top:10px;padding:8px 10px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px;font-size:.76rem;color:#92400e;">같은 소재가 테스트 세트에서도 돌고 있어요 — <button class="btn-ghost" style="padding:3px 10px;font-size:.74rem;" onclick="admgrPromoCut(${esc(JSON.stringify(src))})">원본 테스트 세트 ${src.length}개 예산 1,000원 임시 저장</button></div>` : ''}
    <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn-analyze" onclick="closeModal('admgr-budget-modal')">확인</button></div>`;
  $('admgr-budget-modal').classList.add('show');
}
async function admgrMarkerSync() {   // 표시 정리 — 복사본이 꺼졌거나 사라졌으면 세트 이름의 표시를 뗀다. 새로고침할 때마다(연타는 30초 막음 — 2026-09-16 사용자 지정)
  if (admgr.demo || !admgrCfg()) return;
  if (Date.now() - Number(lsGet('adc_admgr_marksync', 0)) < 30 * 1000) return;
  lsSet('adc_admgr_marksync', Date.now());
  try { const d = await sbCall('meta-upload', { action: 'marker_sync' }, {}); if (d && d.cleared) admgrFetch(); } catch { /* 권한 없음 등 무시 */ }
}
function admgrRowClick(ev, kind, id) {
  if (ev.target.closest('button, a, input, select, label, .mtg, .ag-chev, td [onclick]')) return;   // tr 자신의 onclick은 제외 대상이 아님
  if (window.getSelection && String(window.getSelection()).length) return;   // 글자 드래그 복사 중이면 무시
  (kind === 'camp' ? admgrToggleCamp : admgrToggleSet)(id);
}
function admgrRowToggle(btn) {
  const d = btn.closest('tr').nextElementSibling;
  if (d && d.classList.contains('ag-detail')) { d.classList.toggle('open'); btn.classList.toggle('on', d.classList.contains('open')); }
}
/* ═══ 소재가 들어간 캠페인 표시 (2026-09-16) — 광고세트 이름 뒤 " [→캠페인명]". Meta 이름에 그대로 들어가고, 화면에서는 배지로 보여준다 ═══ */
const AG_MARK = /\s*\[→([^\]]+)\]/g;
function admgrMarkParse(name) {
  const camps = [];
  const base = String(name || '').normalize('NFC').replace(AG_MARK, (m, c) => { camps.push(c.trim()); return ''; }).trim();
  return { base, camps };
}
const admgrMarkName = (name, camps) => admgrMarkParse(name).base + camps.map(c => ` [→${c}]`).join('');
const admgrMarkBadges = name => admgrMarkParse(name).camps.map(c => `<span class="ag-mark" title="이 소재가 들어간 캠페인 — 그 캠페인에서 꺼지면 표시도 사라져요">⧉ ${esc(c)}</span>`).join('');
const admgrBase = name => admgrMarkParse(name).base || '(이름 없음)';
const admgrMobile = () => window.innerWidth <= 768;
let admgrMobileWas = null;
window.addEventListener('resize', () => {   // 폰↔데스크톱 경계를 넘을 때만 다시 그림 (데스크톱 표는 이 이벤트로 안 건드림)
  const now = admgrMobile();
  if (admgrMobileWas === null) { admgrMobileWas = now; return; }
  if (now !== admgrMobileWas) { admgrMobileWas = now; if (admgr.data && ['camp', 'set', 'ad'].includes(admgr.view)) renderAdmgr(true); }
});

/* ═══ 폰 롱프레스 선택 모드 (2026-09-18 스펙 B) — 카드를 500ms 누르고 있으면 선택 모드 진입 + 그 카드 선택.
   손가락이 10px 넘게 움직이면(스크롤 포함) 취소. 롱프레스가 실제로 발동하면 뒤이어 오는 합성 click 1번은 무시(그대로 두면 방금 켠 선택이 곧바로 꺼짐) */
let admgrLP = null, admgrLPFired = false;
function admgrCardDown(ev, kind, id) {
  if (!admgrMobile() || admgr.mSelect) return;   // 이미 선택모드면 탭이 곧 토글이라 롱프레스 불필요
  const p = ev.touches ? ev.touches[0] : ev;
  admgrLP = { x: p.clientX, y: p.clientY, timer: setTimeout(() => { admgrLPFired = true; admgrLP = null; admgrSelectEnter(kind, id); setTimeout(() => { admgrLPFired = false; }, 600); }, 500) };
}
function admgrCardMove(ev) {
  if (!admgrLP) return;
  const p = ev.touches ? ev.touches[0] : ev;
  if (Math.hypot(p.clientX - admgrLP.x, p.clientY - admgrLP.y) > 10) admgrCardCancel();
}
function admgrCardCancel() { if (admgrLP) { clearTimeout(admgrLP.timer); admgrLP = null; } }
function admgrCardClick(ev, kind, id) {   // 카드 탭 — 선택모드면 토글, 아니면 광고 카드는 미리보기(기존 동작 유지)
  if (admgrLPFired) { admgrLPFired = false; return; }
  if (admgr.mSelect) { admgrSelToggle(kind, id); return; }
  if (kind === 'ad') showMetaPreview(id);
}
function admgrCardOpen(id) {   // 카드 펼치기 — 다시 그려도 펼친 상태 유지 (2026-09-18)
  admgr.mOpen = admgr.mOpen || new Set();
  const on = !admgr.mOpen.has(id);
  if (on) admgr.mOpen.add(id); else admgr.mOpen.delete(id);
  const c = document.querySelector(`#sec-admgr .mcard[data-id="${id}"]`); if (!c) return;
  c.classList.toggle('open', on);
  const b = c.querySelector('.mc-exp'); if (b) { b.classList.toggle('on', on); b.innerHTML = `<i class="fa-solid fa-chevron-${on ? 'up' : 'down'}"></i>`; }
}
function admgrSelToggle(kind, id) { (kind === 'camp' ? admgrToggleCamp : kind === 'set' ? admgrToggleSet : admgrToggleAd)(id); }
function admgrSelectEnter(kind, id) {
  if (!lsGet('adc_admgr_lphint', false)) { toast('카드를 길게 누르면 선택 모드'); lsSet('adc_admgr_lphint', true); }
  admgr.mSelect = true;
  admgrSelToggle(kind, id);   // 내부에서 renderAdmgr(true) 호출
}
function admgrSelectExit() { admgr.mSelect = false; admgrClearSel(); }   // ✕ 닫기 — 선택도 전부 해제
/* 선택 모드 상단 바 — 기존 상단 컨트롤(도구바·필터·탭)을 CSS로 숨기고 이 자리에 표시 */
function admgrSelBarHtml() {
  const kind = admgr.view === 'camp' ? 'camp' : admgr.view === 'set' ? 'set' : 'ad';
  const set = kind === 'camp' ? admgr.selCamps : kind === 'set' ? admgr.selSets : admgr.selAds;
  return `<div class="ag-selbar">
    <button class="ag-selbar-x" onclick="admgrSelectExit()" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button>
    <b>${set.size}개 선택됨</b>
    <button class="ag-selbar-all" onclick="admgrSelAllDisp()">전체 선택</button>
  </div>`;
}
/* 선택 모드 하단 동작 패널 — 폰 탭바(.mnav) 대신 뜨는 자리. 전부 기존 함수 재사용 */
function admgrSelPanelHtml() {
  const w = admgr.write, R = admgr.data ? admgrRows() : { sets: [] };
  const items = [];
  if (admgr.view === 'camp') items.push(['fa-layer-group', '세트 보기', "admgrSetView('set')"]);
  if (admgr.view === 'set') {
    items.push(['fa-arrow-down', '÷10 임시 저장', 'admgrCutSel()']);
    if (w.daystart && w.daystart.size) items.push(['fa-rotate-left', '시작 예산 복구', 'admgrRestoreSel()']);
    if ([...admgr.selSets].some(id => { const r = R.sets.find(x => x.id === id); return r && admgrIsTest(r); })) items.push(['fa-flag-checkered', '테스트 종료', 'admgrTestEndModal()']);
    items.push(['fa-ellipsis', '더보기', 'admgrSelMoreMenu(event)']);
  }
  if (admgr.view === 'ad') items.push(['fa-copy', '광고 복사', 'admgrCopyModal()']);
  return `<div class="ag-selpanel">${items.map(([ic, label, fn]) => `<button onclick="${fn}"><i class="fa-solid ${ic}"></i><span>${label}</span></button>`).join('')}</div>`;
}
function admgrSelMoreMenu(ev) {
  admgrPopAt(ev, `<div class="ag-menu">${agItem('fa-eye', '광고 보기', "admgrSetView('ad')")}${agItem('fa-star', '베스트 담기', 'admgrBestAdd()')}<div class="ag-menu-sep">만든 사람 지정</div>${admgrMakerAssignItems()}</div>`, 200);
}
/* 선택 아닌 상태에서 상위 선택이 필터로 남아 있을 때(D) — 다크 액션바 대신 알림줄 하나 + 해제 버튼 */
function admgrFNoticeHtml(name, n) {
  return `<div class="ag-fnotice"><span class="ag-fpill">${esc(name)}${n > 1 ? ` 외 ${n - 1}개` : ''} 만 보는 중</span><button onclick="admgrClearSel()" aria-label="보기 해제"><i class="fa-solid fa-xmark"></i></button></div>`;
}

/* ═══ 오늘의 판정 (2026-09-05 사용자 운영 규칙) ═══
   마진 = 판매가 − 공급가×1.1 (카페24 상품, 세트명에 상품명이 들어간 것으로 매칭 — 가장 긴 이름 우선) · 세트별 수동 입력이 있으면 그것 우선
   구매 0 & 지출 ≥ 마진 → 감액 ÷10 / 구매 0 & 지출 ≥ 마진×0.8 → 곧 도달 / 구매 ≥ 3 → 증액 검토(수동) / 오늘 ↓ 이력 → 오늘 감액됨
   (1차/2차 구분·수동 조정·재증액 검토는 2026-09-07 사용자 요청으로 제거) */
/* 이름 비교 키: 한글·영문·숫자만 남긴다 (공백·_·/ 무시 — "덴버 라운드/브이넥" ↔ "덴버 라운드_브이넥") */
/* ⚠ normalize('NFC') 필수 — 맥에서 파일명으로 만든 세트명은 한글이 자모 분리형(NFD)이라 그대로 비교하면 [가-힣]에 안 걸려 매칭 0 (2026-09-07 실사례: '안스 후드 집업 … 다나스토리') */
const admgrNorm = s => String(s || '').normalize('NFC').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
/* 카페24 상품명 핵심: 앞뒤 괄호 설명 "(자체제작,2사이즈) … (3 colors)"를 전부 벗긴 뒤 키로 (원본 paKey 규칙) */
const admgrProdKey = name => admgrNorm(String(name || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' '));
let admgrPI = null;
function admgrProdIdx() {   // 상품 인덱스 (긴 핵심명 먼저 → 부분 겹침 오매칭 방지) — products 배열이 바뀔 때만 재계산
  if (!admgrPI || admgrPI.src !== admgr.products) {
    admgrPI = { src: admgr.products, list: (admgr.products || []).map(p => ({ ...p, n: admgrProdKey(p.name) })).filter(p => p.n.length >= 3).sort((a, b) => b.n.length - a.n.length) };
  }
  return admgrPI.list;
}
async function admgrLoadProducts() {
  admgr.productsLoading = true;
  try {
    const rows = (await perfApi({ action: 'products' })).rows || [];
    admgr.products = rows.filter(p => p.name && p.price > 0).map(p => ({ no: p.product_no, name: p.name, price: p.price, supply: p.supply_price || 0 }));
    lsSet('adc_admgr_products2', admgr.products);
    lsSet('adc_admgr_products2_at', Date.now());   // 받은 시각 — 인스타 게시물 상품 검색이 오래된 목록을 쓰지 않게 (2026-10-18)
  } catch (e) { toast('카페24 상품 가격 조회 실패: ' + e.message); }
  admgr.productsLoading = false; renderAdmgr(true);
}
function admgrMarginOf(r) {
  const manual = admgr.margins[r.id];
  if (manual > 0) return { m: manual, src: '직접 입력' };
  const n = admgrNorm(r.name);
  const p = admgrProdIdx().find(p => n.includes(p.n));
  if (!p) return { m: null, src: '' };
  if (!p.supply) return { m: null, src: p.name + ' (공급가 없음)' };
  return { m: Math.round(p.price - p.supply * 1.1), src: `${p.name} · 판매가 ${comma(p.price)} − 공급가 ${comma(p.supply)}×1.1` };
}
const admgrIsTest = r => /test/i.test(String(r.name || '').normalize('NFC'));
/* 역할 보기 (2026-10-26 사용자 승인) — 테스트 = 세트 예산 캠페인 안 _test 세트 · 운영 = 그 캠페인 안 test 없는 세트 · CBO = 캠페인 예산 있는 캠페인(리타겟팅 포함). 광고는 세트를 따라간다 */
function admgrRoleOf(r) {
  if (r.adsets) return (r.budget > 0 || r.budget_life > 0) ? 'cbo' : 'ops';   // 캠페인 행
  return r._cbo ? 'cbo' : (r._test != null ? r._test : admgrIsTest(r)) ? 'test' : 'ops';
}
function admgrRolePass(r, role) { if (role === 'all') return true; const k = admgrRoleOf(r); return r.adsets && role !== 'cbo' ? k !== 'cbo' : k === role; }
function admgrRoleSet(k) {
  admgr.role = k; admgr.judgeFilter = 'all';   // 운영 역할의 기본 정렬(예상 마감 높은 순)은 admgrCmp가 열 정렬 없을 때 알아서
  renderAdmgr(true);
}
function admgrProj(r) {   // 지금 속도면 마감 때 마진의 몇 % — 오늘 지출 × 24 ÷ 지난 시간 ÷ 마진 (받아온 시각 기준, 1시간 전엔 1시간으로)
  if (!admgrJudgeView() || admgr.preset !== 'today') return null;
  const m = admgrMarginOf(r).m; if (!(m > 0) || !(r.spend > 0)) return null;
  const at = admgr.data && admgr.data.fetched_at ? new Date(admgr.data.fetched_at) : new Date();
  const kst = new Date(at.getTime() + 9 * 3600e3), h = Math.max(1, kst.getUTCHours() + kst.getUTCMinutes() / 60);
  return Math.round(r.spend * 24 / h / m * 100);
}
function admgrProjCell(r) {
  if (admgrP7(r) > 0 || admgrIsTest(r)) return '<span style="color:#d1d5db;" title="구매가 있는 세트는 예상 마감을 보지 않아요">—</span>';
  const p = admgrProj(r); if (p == null) return '<span style="color:#d1d5db;">—</span>';
  return `<span class="status-badge ${p >= 100 ? 'badge-red' : p >= 50 ? 'badge-yellow' : 'badge-gray'}" style="white-space:nowrap;">${p}%</span>`;
}
function admgrCutDisp() {   // 표시된 세트(예상 마감 칩) 중 오늘 안 깎은 구매 0 세트 ÷10 임시 저장
  const ids = new Set(admgr._dispIds || []);
  const cutToday = r => ((admgr.budget.byObj && admgr.budget.byObj.get(r.id)) || []).some(e => e.new_value < e.old_value);
  admgrCutDraft(admgrRows().sets.filter(r => ids.has(r.id) && admgrP7(r) === 0 && r.spend > 0 && !cutToday(r)), '표시된 세트');   // 구매 0 · 지출 있음 · 오늘 안 깎음 (테스트 세트 포함)
}   // 세트명에 test — 테스트중이라 감액·증액 판정에서 뺀다 (2026-09-17 사용자 요청)
function admgrJudge(r) {   // 2026-09-15 사용자 규칙: 구매 수로만 판정 (마진·지출%는 참고 표시). 지출 0원인 세트는 감액 후보에서 제외
  const { m, src } = admgrMarginOf(r);
  if (admgrIsTest(r)) return { key: 'testing', m, src, ratio: m > 0 ? (r.spend || 0) / m : null };
  const spend = r.spend || 0, pur = admgrP7(r);   // 2026-10-25: 클릭 후 7일 구매로 판정 (조회 기여 제외). 서버 갱신 전 데이터면 기본 − 조회1일
  const ratio = m > 0 ? spend / m : null;
  const evs = (admgr.budget.byObj && admgr.budget.byObj.get(r.id)) || [];
  const cutToday = evs.some(e => e.new_value < e.old_value);
  const roas = spend > 0 ? (admgrV7(r)) / spend : 0;
  if (cutToday && pur >= 2 && roas >= 5)  return { key: 'rebound', m, src, ratio, roas };   // 감액 후 성과가 붙은 세트 — 되돌릴지 검토 (2026-09-16 사용자 규칙: 구매 2건 이상 + ROAS 500% 이상)
  if (pur >= 3)                  return { key: 'up',   m, src, ratio };   // 구매 3건 이상 → 증액 검토
  if (pur >= 1)                  return { key: 'warn', m, src, ratio };   // 구매 1~2건 → 곧 도달
  if (cutToday)                  return { key: 'done', m, src, ratio };   // 구매 0이지만 오늘 이미 감액한 세트 — 두 번 깎지 않게
  if (spend > 0)                 return { key: 'cut',  m, src, ratio };   // 구매 0 + 지출 있음 → 감액 ÷10
  return { key: '', m, src, ratio };                                       // 아직 지출 0원 → 판정 보류
}
const ADMGR_JUDGE = {
  cut:      { cls: 'badge-red',    t: '🔴 감액 ÷10' },
  warn:     { cls: 'badge-yellow', t: '🟡 곧 도달' },
  up:       { cls: 'badge-green',  t: '🟢 증액 검토' },
  done:     { cls: 'badge-gray',   t: '✓ 오늘 감액됨' },
  rebound:  { cls: 'badge-blue',   t: '↗ 감액 후 반등' },
  testing:  { cls: 'badge-gray',   t: '⚗ 테스트중' },
};
function admgrJudgeCell(r) {
  const j = admgrJudge(r);
  const b = ADMGR_JUDGE[j.key];
  const pen = `<i class="fa-solid fa-pen" title="마진 직접 입력${j.src ? ' — 현재: ' + esc(j.src) : ''}" style="font-size:.55rem;color:#a5b4fc;cursor:pointer;margin-left:4px;" onclick="event.stopPropagation();admgrMarginEdit('${r.id}')"></i>`;
  const sub = j.m > 0 ? `<div style="font-size:.62rem;color:#9ca3af;white-space:nowrap;">구매 ${comma(admgrP7(r))}(클릭7일) · 마진 ${comma(j.m)} · 지출 ${Math.round((j.ratio || 0) * 100)}%${pen}</div>` : `<div style="font-size:.62rem;color:#9ca3af;">구매 ${comma(r.purchases || 0)} · ${j.src ? esc(j.src.slice(0, 18)) : '마진 정보 없음'}${pen}</div>`;
  const act = j.key === 'cut' && admgr.write.st && dnrbCan('budget') && r.budget > 0
    ? ` <button class="filter-tab" style="padding:2px 8px;font-size:.66rem;color:#dc2626;border-color:#fca5a5;" title="${comma(r.budget)} → ${comma(Math.max(1000, Math.round(r.budget / 10)))}원으로 임시 저장 — 상단 \'게시\'로 반영" onclick="event.stopPropagation();admgrCut10('${r.id}')">÷10</button>` : '';
  return `${b ? `<span class="status-badge ${b.cls}" style="white-space:nowrap;">${b.t}</span>${act}` : '<span style="color:#d1d5db;">—</span>'}${sub}`;
}
function admgrJudgeSet(k) { admgr.judgeFilter = k; renderAdmgr(true); }
function admgrAdFilter(k) { admgr.judgeFilter = k; admgr.view = 'ad'; renderAdmgr(); }   // CBO 할 일 칩: 광고 탭에서 그 광고만 (2026-10-26)
function admgrMarginEdit(id) {   // 브라우저 prompt() 대신 모달 (2026-09-14)
  const r = admgrRows().sets.find(x => x.id === id); if (!r) return;
  const cur = admgrMarginOf(r);
  admgrConfirmModal('마진 직접 입력', `<div style="font-weight:700;color:#1e1b4b;margin-bottom:8px;">${esc(r.name)}</div>
    <input id="ag-margin-inp" class="inp" type="text" inputmode="numeric" value="${cur.m > 0 ? cur.m : ''}" placeholder="판매가 − 원가 (원)" style="width:100%;" />
    <div style="font-size:.72rem;color:#9ca3af;margin-top:6px;">비우면 카페24 자동 계산으로 돌아가요${cur.src ? ' · 현재: ' + esc(cur.src) : ''}</div>`, '저장', () => {
    const n = Math.round(Number(String(($('ag-margin-inp') || {}).value || '').replace(/[^0-9]/g, '')));
    if (n > 0) admgr.margins[id] = n; else delete admgr.margins[id];
    lsSet('adc_admgr_margin', admgr.margins); renderAdmgr(true);
  });
  setTimeout(() => { const i = $('ag-margin-inp'); if (i) i.focus(); }, 0);
}
/* ÷10 감액은 모두 '임시 저장'까지만 — Meta 반영은 상단 '게시'에서 (2026-09-16 사용자 요청: 행별·감액 후보 전체도 즉시 적용 금지) */
/* ═══ 빠른 증액 (2026-10-26 사용자 확정) ═══
   운영 세트 · 일예산 5만 이하 · 최근 3일(어제까지) 구매(클릭 7일) 6건 이상(일예산 3만 미만은 4건, 10/27) · 3일 구매당 비용 ≤ 마진의 30% → 요일 상관없이 2배.
   근거: 10/17~25 백테스트 — 이 조건(작은 예산·6건↑·30%↓)을 2배 가까이 키운 5건은 구매당 비용 13%→28%, (마진−광고비) 144만→298만. 3~5건짜리는 17%→55%로 무너짐.
   올린 뒤 이틀 구매당 비용이 마진 40%를 넘으면 '되돌리기' 칩. 기록: shared_state 'fast_boost' {items:{adset_id:{from,to,day,name}}} — 게시 안 했거나 그 뒤 손으로 바꾼 세트는 지금 예산≠to라 제외 */
const ADMGR_FAST = { maxBudget: 50000, minPur: 6, smallBudget: 30000, smallMinPur: 4, pct: 30, mul: 2, revertPct: 40 };   // 일예산 3만 미만은 3일 4건 (2026-10-27 사용자 확정 — 9/8~10/26 하루 지출 3만↓ 세트 2배: 4건도 구매 2.6→5.9/일·이익 유지, 하루·이틀 신호는 이익 반 토막)
admgr.fast = { days: null, at: 0, loading: false, failAt: 0, boost: null, ver: null };
async function admgrFastEnsure() {
  const F = admgr.fast;
  if (admgr.demo || !admgrCfg() || F.loading || (F.days && Date.now() - F.at < 30 * 60000) || Date.now() - F.failAt < 5 * 60000) return;
  F.loading = true;
  try {
    const ds = [-3, -2, -1].map(n => todayStr(n));   // 어제까지 꽉 찬 3일 — 날짜별로 받아 이틀(되돌리기)도 같이 쓴다 (서버 캐시)
    const [hs, st] = await Promise.all([Promise.all(ds.map(d => metaGet({ action: 'hierarchy', preset: 'custom', since: d, until: d }))),
      sbCall('client-log', { action: 'state_get', key: 'fast_boost' }).catch(() => null)]);
    F.days = hs.map(h => { const m = new Map(); for (const c of h.campaigns || []) for (const s of c.adsets || []) { let p = 0; for (const x of s.ads || []) p += x.purchases_7d || 0; m.set(s.id, { sp: s.spend || 0, p }); } return m; });
    F.boost = (st && st.data) || { items: {} }; F.ver = (st && st.ver) || null; F.at = Date.now(); F.failAt = 0;
    renderAdmgr(true);
  } catch (e) { F.failAt = Date.now(); }   // 실패하면 5분 쉼
  F.loading = false;
}
function admgrFastSum(id, idx) { const F = admgr.fast; let sp = 0, p = 0; for (const i of idx) { const x = F.days[i].get(id); if (x) { sp += x.sp; p += x.p; } } return { sp, p }; }
function admgrFastOf(r) {   // 빠른 증액 후보면 {sp, p, pct} — 3일 합계
  const F = admgr.fast;
  if (!F.days || r._cbo || admgrIsTest(r) || r.status !== 'ACTIVE' || !(r.budget > 0) || r.budget > ADMGR_FAST.maxBudget) return null;
  const m = admgrMarginOf(r).m; if (!(m > 0)) return null;
  const s = admgrFastSum(r.id, [0, 1, 2]); if (s.p < (r.budget < ADMGR_FAST.smallBudget ? ADMGR_FAST.smallMinPur : ADMGR_FAST.minPur)) return null;
  const pct = Math.round(s.sp / s.p / m * 100);
  return pct <= ADMGR_FAST.pct ? { ...s, pct } : null;
}
function admgrFastRevertOf(r) {   // 2배 올린 뒤 이틀이 지났고 그 이틀 구매당 비용이 마진 40% 초과면 {pct, from}
  const F = admgr.fast, b = F.boost && F.boost.items && F.boost.items[r.id];
  if (!b || !F.days || r.budget !== b.to || b.day > todayStr(-3) || b.day < todayStr(-7)) return null;
  const m = admgrMarginOf(r).m; if (!(m > 0)) return null;
  const s = admgrFastSum(r.id, [1, 2]);
  const pct = s.p ? Math.round(s.sp / s.p / m * 100) : (s.sp > 0 ? 999 : 0);
  return pct > ADMGR_FAST.revertPct ? { ...s, pct, from: b.from } : null;
}
function admgrFastBadge(r) {
  if (admgr.view !== 'set' || !admgrJudgeView()) return '';
  const f = admgrFastOf(r);
  if (f) return ` <span class="status-badge badge-green" style="font-size:.62rem;white-space:nowrap;" title="빠른 증액 후보 — 최근 3일(어제까지) ${f.p}건 · 구매당 비용 ${comma(Math.round(f.sp / f.p))}원 = 마진의 ${f.pct}%">⚡ 빠른 증액</span>`;
  const b = admgrFastRevertOf(r);
  return b ? ` <span class="status-badge badge-yellow" style="font-size:.62rem;white-space:nowrap;" title="2배 올린 뒤 이틀 구매당 비용이 마진의 ${b.pct === 999 ? '— (구매 0)' : b.pct + '%'} — 올리기 전 ${comma(b.from)}원으로 되돌리기 후보">↩ 되돌리기</span>` : '';
}
async function admgrFastSave(edit) {   // fast_boost 기록 — 충돌이면 최신본에 다시 한 번
  const F = admgr.fast;
  for (let i = 0; i < 2; i++) {
    const cur = JSON.parse(JSON.stringify(F.boost || { items: {} })); cur.items = cur.items || {}; edit(cur);
    const r = await sbCall('client-log', { action: 'state_set' }, { key: 'fast_boost', base: F.ver, data: cur });
    if (!r.conflict) { F.boost = cur; F.ver = r.ver; return; }
    F.boost = r.data || { items: {} }; F.ver = r.ver;
  }
}
function admgrFastBoostDisp() {
  const ids = new Set(admgr._dispIds || []);
  const rows = admgrRows().sets.filter(r => ids.has(r.id) && admgrFastOf(r));
  if (!rows.length) { toast('빠른 증액할 세트가 없어요'); return; }
  const max = (admgr.write.st && admgr.write.st.max_budget) || 300000, day = todayStr(0);
  for (const r of rows) admgrDraft[r.id] = Math.min(max, Math.round(r.budget * ADMGR_FAST.mul / 1000) * 1000);
  lsSet('adc_admgr_draft', admgrDraft);
  admgrFastSave(d => { for (const k of Object.keys(d.items)) if (d.items[k].day < todayStr(-10)) delete d.items[k];
    for (const r of rows) d.items[r.id] = { from: r.budget, to: admgrDraft[r.id], day, name: admgrBase(r.name).slice(0, 60) }; }).catch(() => toast('빠른 증액 기록 저장 실패 — 되돌리기 알림이 안 뜰 수 있어요'));
  toast(`빠른 증액 ${rows.length}개 2배 임시 저장 — 상단 '게시'로 반영. 이틀 뒤 구매당 비용이 마진 40%를 넘으면 '되돌리기'에 올라와요`);
  renderAdmgr(true);
}
function admgrFastRevertDisp() {
  const ids = new Set(admgr._dispIds || []);
  const rows = admgrRows().sets.filter(r => ids.has(r.id)).map(r => [r, admgrFastRevertOf(r)]).filter(x => x[1]);
  if (!rows.length) { toast('되돌릴 세트가 없어요'); return; }
  for (const [r, v] of rows) admgrDraft[r.id] = v.from;
  lsSet('adc_admgr_draft', admgrDraft);
  admgrFastSave(d => { for (const [r] of rows) delete d.items[r.id]; }).catch(() => {});
  toast(`${rows.length}개를 올리기 전 예산으로 임시 저장 — 상단 '게시'로 반영`);
  renderAdmgr(true);
}
function admgrCutDraft(rows, label) {
  const ok = rows.filter(r => r.budget > 0), skip = rows.length - ok.length;   // 일예산 없는 세트(캠페인 예산 CBO 등)는 세트에서 못 바꿈
  if (!ok.length) { toast(skip ? `일예산이 있는 세트가 없어요 (캠페인 예산 세트 ${skip}개는 캠페인에서 바꿔야 해요)` : '감액할 세트가 없어요'); return 0; }
  for (const r of ok) admgrDraft[r.id] = Math.max(1000, Math.round(r.budget / 10));   // 기준 = 현재 Meta 예산 (기존 임시 저장값은 덮어씀)
  lsSet('adc_admgr_draft', admgrDraft);
  toast(`${label} ${ok.length}개 ÷10 임시 저장${skip ? ` · 캠페인 예산 세트 ${skip}개 제외` : ''} — Meta엔 아직 반영 안 됐어요. 상단 '게시'로 반영`);
  renderAdmgr(true);
  return ok.length;
}
function admgrCut10(id) {   // 판정 셀의 ÷10 (행 하나)
  const r = admgrRows().sets.find(x => x.id === id); if (!r) return;
  admgrCutDraft([r], '이 세트');
}
function admgrCutAll() {   // 판정 '감액' 후보 전체
  admgrCutDraft(admgrRows().sets.filter(r => admgrJudge(r).key === 'cut'), '감액 후보');
}
function admgrRestoreSel() {   // 체크한 세트를 오늘 시작 예산(00:10 기록)으로 되돌리기 → 임시 저장 (2026-09-16 사용자 요청)
  const ds = admgr.write.daystart;
  if (!ds || !ds.size) { toast('오늘 시작 예산 기록이 아직 없어요 (00:10에 저장돼요)'); return; }
  const sel = admgrRows().sets.filter(r => admgr.selSets.has(r.id));
  let n = 0, same = 0, none = 0;
  for (const r of sel) {
    const st = Math.round(ds.get(r.id) ?? 0);
    if (!(st >= 1000)) { none++; continue; }
    if (st === Math.round(r.budget)) { same++; continue; }
    admgrDraft[r.id] = st; n++;
  }
  if (!n) { toast(same ? `이미 시작 예산 그대로예요 (${same}개)` : `되돌릴 시작 예산 기록이 없어요 (${none}개)`); return; }
  lsSet('adc_admgr_draft', admgrDraft);
  admgr.selSets.clear(); admgr.mSelect = false;   // 폰 선택모드였다면 동작 완료로 나감 (B)
  toast(`${n}개를 시작 예산으로 임시 저장${same ? ` · 동일 ${same}개` : ''}${none ? ` · 기록 없음 ${none}개` : ''} — 상단 '게시'로 반영`);
  renderAdmgr(true);
}
function admgrCutSel() {   // 체크한 광고세트
  if (admgrCutDraft(admgrRows().sets.filter(r => admgr.selSets.has(r.id)), '선택한 세트')) { admgr.selSets.clear(); admgr.mSelect = false; renderAdmgr(true); }
}

/* ═══ 만든 사람 거르기 (2026-09-20 사용자 요청 — 9/18 칩·필터 줄 판은 "지저분·복잡"으로 되돌림) ═══
   원칙: 입력은 소재 등록할 때만(creatives.maker) · 평소 화면엔 이름을 어디에도 안 보임(비교판이 되지 않게) · '만든 사람 ▾'로 골랐을 때만 그 사람 것 + 알림 한 줄.
   출처 2개: ① creatives.maker (ad_id·adset_id로 연결 — admgr.test.creatives) ② 대시보드 밖에서 올린 세트는 광고세트 탭에서 체크 → '만든 사람 지정' → shared_state 'makers' {sets:{adset_id:key}} (②가 ①보다 우선)
   ponytail: creatives_list는 최대 500행 — 등록 소재가 500개를 넘으면 오래된 광고가 '미지정'으로 빠진다. 그때 서버에 maker 전용 가벼운 목록 액션을 추가할 것 */
admgr.mk = { filter: 'all', sets: {}, ads: {}, ver: null, tried: false, loading: false, idx: null, idxSrc: null };   // ads = 광고 단위 지정 (내 소재 성과의 '만든 사람 바꾸기'가 적는다 — 2026-09-22)
async function admgrMakerLoad() {
  const m = admgr.mk;
  if (m.loading || admgr.demo || !admgrCfg()) return;
  m.loading = true;
  try { const r = await sbCall('client-log', { action: 'state_get', key: 'makers' }); m.sets = ((r && r.data) || {}).sets || {}; m.ads = ((r && r.data) || {}).ads || {}; m.ver = (r && r.ver) || null; }
  catch (e) { console.warn('만든 사람 지정분 불러오기 실패', e.message); }
  m.loading = false; if (m.filter !== 'all') renderAdmgr(true);
  if (typeof curMenu !== 'undefined' && curMenu === 'mycre' && typeof renderMycre === 'function') renderMycre();
}
function admgrMakerIdx() {
  const m = admgr.mk, src = admgr.test.creatives;
  if (m.idx && m.idxSrc === src) return m.idx;
  const ad = new Map(), set = new Map();
  if (src) for (const c of src.values()) { if (!MAKERS[c.maker]) continue; ad.set(String(c.ad_id), c.maker); if (c.adset_id && !set.has(String(c.adset_id))) set.set(String(c.adset_id), c.maker); }
  m.idxSrc = src; return (m.idx = { ad, set });
}
/* 순서: ② 수동 지정 → ① 등록 기록 → ③ 이름 규칙(2026-09-20 사용자 지정: 세트명에 '다나'가 있으면 다나대표, 나머지는 전부 김도희 — 0017과 같은 규칙). ③ 덕에 미지정은 없다 */
function admgrMakerOf(adId, setId, name) {
  const w = adId && admgr.mk.ads[adId]; if (MAKER_NAMES[w]) return w;   // 광고 단위 지정이 최우선 (CBO처럼 한 세트에 여러 사람 소재가 섞인 경우)
  const v = admgr.mk.sets[setId]; if (MAKER_NAMES[v]) return v;
  const ix = admgrMakerIdx();
  return (adId && ix.ad.get(String(adId))) || ix.set.get(String(setId)) || (String(name || '').normalize('NFC').includes('다나') ? 'dana' : 'dohee');
}
function admgrMakerPass(adId, setId, name) { const f = admgr.mk.filter; return f === 'all' || admgrMakerOf(adId, setId, name) === f; }
function admgrMakerFilter(k) { admgr.mk.filter = k; if (k !== 'all') admgrTestCreativesEnsure(); renderAdmgr(); }
/* 버튼 하나 — 기존 버튼 줄 끝에 끼운다. 고른 상태면 이름이 보이고 색이 들어온다 */
function admgrMakerBtn(cls) {
  if (admgr.demo || !admgrCfg()) return '';
  const f = admgr.mk.filter, on = f !== 'all';
  return `<button class="filter-tab ag-mkbtn ${on ? 'on' : ''} ${cls || ''}" onclick="admgrMakerMenu(event)" title="고른 사람이 만든 소재만 보기 — 평소 화면에는 이름이 표시되지 않아요"><i class="fa-solid fa-user"></i> ${on ? MAKERS[f] : '만든 사람'} <i class="fa-solid fa-chevron-down" style="font-size:.7em;"></i></button>`;
}
function admgrMakerMenuItems() {
  const f = admgr.mk.filter, it = (k, label, sub) => agItem(f === k ? 'fa-circle-check' : 'fa-circle', label, `admgrMakerFilter('${k}')`, sub);
  return it('all', '전체') + Object.entries(MAKERS).map(([k, n]) => it(k, n)).join('');
}
function admgrMakerMenu(ev) { admgrPopAt(ev, `<div class="ag-menu">${admgrMakerMenuItems()}</div>`, 200); }
/* 거른 상태 알림 한 줄 — rows = 거른 뒤 행, stats면 지출·구매·ROAS도 */
function admgrMakerBanner(rows, stats) {
  const f = admgr.mk.filter; if (f === 'all') return '';
  const loading = !admgr.test.creatives;
  const spend = rows.reduce((s0, r) => s0 + (r.spend || 0), 0), value = rows.reduce((s0, r) => s0 + (r.value || 0), 0), pur = rows.reduce((s0, r) => s0 + (r.purchases || 0), 0);
  return `<div class="ag-mkban"><i class="fa-solid fa-user"></i><b>${esc(MAKERS[f] || '')} 소재만 보는 중</b>
    <span>${loading ? '등록 기록 불러오는 중…' : `${rows.length}개${stats ? ` · 지출 <b>${won(spend)}</b> · 구매 <b>${comma(pur)}</b> · ROAS <b>${spend ? (value / spend).toFixed(2) : '—'}</b>` : ''}`}</span>
    <span style="flex:1;"></span><button onclick="admgrMakerFilter('all')">✕ 전체 보기</button></div>`;
}
/* 광고세트 탭 체크분에 수동 지정 (대시보드 밖에서 올린 광고용) */
function admgrMakerAssignItems() {
  return Object.entries(MAKERS).map(([k, n]) => agItem('fa-user', n, `admgrMakerAssign(null,'${k}')`)).join('') + agItem('fa-xmark', '지정 지우기', "admgrMakerAssign(null,'')", '등록 기록·이름 규칙으로 돌아가요');
}
async function admgrMakerAssign(ev, k) {
  if (ev) { admgrPopAt(ev, `<div class="ag-menu"><div class="ag-menu-sep">체크한 세트 ${admgr.selSets.size}개 — 누가 만들었나요?</div>${admgrMakerAssignItems()}</div>`, 220); return; }
  const m = admgr.mk, ids = [...admgr.selSets];
  if (!ids.length) { toast('먼저 세트를 체크하세요'); return; }
  const apply = () => ids.forEach(id => { if (k) m.sets[id] = k; else delete m.sets[id]; });
  for (let tries = 0; tries < 2; tries++) {   // 남이 먼저 저장했으면 최신본 위에 내 지정만 다시 얹어 한 번 더
    try {
      apply();
      const r = await sbCall('client-log', { action: 'state_set' }, { key: 'makers', base: m.ver, data: { sets: m.sets, ads: m.ads || {} } });
      if (!r.conflict) { m.ver = r.ver; toast(`세트 ${ids.length}개 — ${k ? MAKERS[k] : '지정 지움'}`); renderAdmgr(true); return; }
      m.sets = ((r.data || {}).sets) || {}; m.ads = ((r.data || {}).ads) || {}; m.ver = r.ver || null;
    } catch (e) { toast('만든 사람 저장 실패: ' + e.message); return; }
  }
  toast('만든 사람 저장 실패 — 새로고침 후 다시 시도해 주세요');
}
