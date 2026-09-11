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
  write: { st: null, pin: lsGet('adc_admgr_pin', null), pendingByObj: null, midMode: 'idle' },   // pin: 잠그기 전까지 유지 (2026-09-04 사용자 요청 — 이 브라우저에만 저장, 서버는 매 요청 검증)
  /* 오늘의 판정(광고세트 탭, 오늘 칩): round r1(11시경)/r2(14시경) 수동 전환, judgeFilter = all/cut/warn/up/manual/reup,
     margins = 세트별 마진 수동 입력(id → 원), products = 카페24 상품(판매가·공급가) 캐시 */
  judgeFilter: 'all', margins: lsGet('adc_admgr_margin', {}), products: lsGet('adc_admgr_products', null), productsLoading: false,
};
const ADMGR_PRESETS = { today:'오늘', yesterday:'어제', last_7d:'최근 7일', last_30d:'최근 30일' };
const ADMGR_OWN = ['test', 'offad', 'best'];   // 자체 컨트롤을 쓰는 탭 (기간 칩·'활성만' 숨김)
const ADMGR_USER = '대시보드';                  // 판정·담기 기록자 이름 (원본은 로그인 이름 — 이 대시보드는 로그인 없음)

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
async function sbCall(fn, params, payload) {
  const cfg = admgrCfg();
  if (!cfg) throw new Error('config.js에 Supabase 연동 정보를 먼저 채워주세요 (SETUP 문서 참고)');
  const url = cfg.SUPABASE_URL + '/functions/v1/' + fn + '?' + new URLSearchParams(params);
  const headers = metaHeaders(cfg);
  const ds = typeof dnrbSession === 'function' ? dnrbSession() : null;
  if (ds) headers['x-dnrb-token'] = ds.token;   // 워크스페이스 SSO 세션 — 서버 getAuth가 워크스페이스 verify로 확인
  const init = payload === undefined ? { headers }
    : payload instanceof FormData ? { method: 'POST', headers, body: payload }
    : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
  let res;
  try { res = await fetch(url, init); }
  catch (e) { throw new Error(`서버에 연결할 수 없어요 (${e.message}) — 인터넷 연결 또는 서버 상태를 확인하세요`); }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : {}; } catch { /* JSON 아님 — 아래에서 처리 */ }
  if (body && !body.error && res.ok) return body;
  if (ds && (res.status === 401 || res.status === 403)) localStorage.removeItem(DNRB_KEY);   // 워크스페이스에서 권한 해제됨 → 세션 폐기
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
    admgr.data = await metaGet({ action: 'hierarchy', preset: admgr.preset });
    lsSet('adc_admgr_last', { preset: admgr.preset, data: admgr.data });   // 새로고침해도 마지막 데이터 유지 (2026-09-05 사용자 요청)
    admgr.budget = { byObj: null, loading: false, error: false, seven: null, sevenLoading: false };
    if (admgr.preset === 'today') admgrBudgetFetch();   // '최근 변경' 열은 오늘 칩에서만
    admgrWriteInit();                                     // 예산 쓰기 가능 여부(토큰·PIN 설정) 확인
    metaGet({ action: 'usage' }).then(u => { admgr.usage = u; renderAdmgr(true); }).catch(() => {});   // Meta 사용량·쿨다운 표시 (우리 서버만 조회)
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
  if (admgr.solo) { admgr.view = admgr.prevView || 'camp'; admgr.solo = null; $('admgr-note').style.display = ''; $('admgr-title').innerHTML = '<i class="fa-brands fa-meta" style="color:#4f46e5;font-size:.9em;"></i> 광고관리자 (Meta)'; }
  if (!admgr.data && !admgr.demo && admgrCfg()) {
    const c = lsGet('adc_admgr_last', null);
    if (c && c.data) { admgr.data = c.data; admgr.preset = c.preset || admgr.preset; admgrWriteInit(); }   // 예산 편집 버튼용 상태만 (우리 서버, Meta 호출 아님)
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
function admgrSearch(v) { clearTimeout(admgrQTimer); admgrQTimer = setTimeout(() => { admgr.q = v.trim().toLowerCase(); renderAdmgr(true); }, 200); }

/* 정렬: 클릭 = 오름 → 내림 → 해제, 먼저 누른 열이 1순위 (원본 다중 정렬) */
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
    default: return 0;
  }
}
const ADMGR_STR_KEYS = ['name', 'aname', 'reg', 'offd'];
function admgrCmp(x, y) {
  for (const s of admgr.sort) {
    if (ADMGR_STR_KEYS.includes(s.key)) {
      const c = String(admgrVal(x, s.key)).localeCompare(String(admgrVal(y, s.key)), 'ko');
      if (c) return c * s.dir; continue;
    }
    const vx = admgrVal(x, s.key), vy = admgrVal(y, s.key);
    if (vx !== vy) return (vx - vy) * s.dir;
  }
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
      s._campId = c.id; s._campName = c.name; sets.push(s);
      for (const a of (s.ads || [])) {
        a._setId = s.id; a._setName = s.name; a._campId = c.id; ads.push(a);
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
function admgrClearSel() { admgr.selCamps.clear(); admgr.selSets.clear(); renderAdmgr(true); }
/* 헤더 체크박스 — 지금 표에 보이는 행(검색·활성만·필터 반영) 전체 선택/해제 */
function admgrSelAllDisp() {
  const isCamp = admgr.view === 'camp';
  const set = isCamp ? admgr.selCamps : admgr.selSets;
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
const admgrRoasTd = r => r.spend ? (r.value / r.spend < 1 ? `<b style="color:#dc2626;">${(r.value / r.spend).toFixed(2)}</b>` : (r.value / r.spend).toFixed(2)) : '—';   // 1 미만만 강조 (전부 색칠하면 소음)
const admgrMoney = v => v ? won(v) : '—';
const admgrCpa = r => r.purchases ? won(r.spend / r.purchases) : '—';
/* 정렬 표시 머리글 */
function admgrTh(key, label, cls) {
  const i = admgr.sort.findIndex(s => s.key === key);
  const ar = i < 0 ? '' : (admgr.sort[i].dir === 1 ? ' ▲' : ' ▼') + (admgr.sort.length > 1 ? '<sup>' + (i + 1) + '</sup>' : '');
  return `<th class="sortable ${cls || ''}" onclick="admgrSortClick('${key}')" title="클릭: 오름차순 → 내림차순 → 해제">${label}${ar}</th>`;
}
const admgrTile = (label, val) => `<div class="kpi-tile"><div class="kt-label">${label}</div><div class="kt-value" style="font-size:1.15rem;">${val}</div></div>`;

/* ═══ 메인 렌더 — 공통(배너·컨트롤·탭) + 탭별 본문 ═══ */
function renderAdmgr(keepScroll) {
  const body = $('admgr-body');
  const cfg = admgrCfg();
  /* 재렌더 시 표 스크롤 유지 (가이드 §7-10) + 검색창 포커스 유지 */
  const wrap = body.querySelector('.table-wrap');
  const sc = keepScroll && wrap ? { t: wrap.scrollTop, l: wrap.scrollLeft } : null;
  const pageY = window.scrollY;   // innerHTML 교체 순간 페이지가 줄었다 늘어나며 스크롤이 튀는 것 방지 (2026-09-06 사용자 지적)
  const hadFocus = document.activeElement && document.activeElement.id === 'admgr-q';

  /* 상단 안내 */
  let banner = '';
  if (!cfg && !admgr.demo) {
    banner = `<div class="info-bar" style="background:#fffbeb;border-color:#fde68a;color:#78350f;">
      <i class="fa-solid fa-plug"></i> 아직 Meta 연동 전이에요 — <b>SETUP-광고관리자.md</b>의 순서대로 Supabase·Meta 토큰을 준비하고
      <b>config.js</b>를 채우면 실데이터가 나옵니다. 그 전에는 데모 데이터로 화면을 구경할 수 있어요.</div>`;
  } else if (admgr.demo) {
    banner = `<div class="info-bar"><i class="fa-solid fa-wand-magic-sparkles"></i> <b>데모 데이터</b> 표시 중 — 실제 연동 후에는 이 자리에 내 광고계정이 나옵니다.</div>`;
  } else if (!ADMGR_OWN.includes(admgr.view) && admgr.data) {
    /* 한도 방어 상태 표시 (2026-09-07): 서버가 쿨다운 중이면 마지막 데이터를 stale로 주고 _meta.cooldown_until을 실어준다 */
    const m = admgr.data._meta || {}, u = admgr.usage || {};
    const until = m.cooldown_until || u.cooldown_until;
    const pct = u.usage_pct != null ? u.usage_pct : m.usage_pct;
    banner = `<div class="info-bar" ${until ? 'style="background:#fff7ed;border-color:#fdba74;color:#9a3412;"' : ''}><i class="fa-regular fa-clock"></i>
      ${esc(admgr.data.range ? admgr.data.range.start + ' ~ ' + admgr.data.range.end : '')} ·
      ${admgrAgo(admgr.data.fetched_at)} 기준 ${m.sync_at ? '· <span title="서버가 5분마다 Meta에서 받아 저장해 두고, 화면은 저장된 것만 읽어요. 새로고침을 아무리 해도 Meta 호출이 늘지 않아요">서버 자동 수집(5분마다)</span>' : '(서버 5분 캐시)'}
      ${admgr.data.truncated ? ' · <b style="color:#c2410c;">⚠ 500개 한도로 일부 잘림</b>' : ''}
      ${until ? ` · <b>⚠ Meta 조회 한도 대기 중 — ${admgrKstLabel(until)} 이후 자동 재시도 · 마지막으로 받은 데이터를 보여주고 있어요</b>` : ''}
      ${pct != null ? ` · <span style="color:${pct >= 80 ? '#c2410c' : '#65676b'};">Meta 사용량 ${Math.round(pct)}%</span>` : ''}</div>`;
  }

  /* 컨트롤 */
  const own = ADMGR_OWN.includes(admgr.view);
  const busy = admgrBusy();
  const controls = `
    <div class="control-bar" style="margin-bottom:16px;">
      ${own ? '' : `<label>기간</label>
      <span class="qp">${Object.entries(ADMGR_PRESETS).map(([k, t]) =>
        `<button style="${admgr.preset === k ? 'background:#4f46e5;color:#fff;border-color:transparent;' : ''}" onclick="admgrSetPreset('${k}')">${t}</button>`).join('')}</span>
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:.8rem;">
        <input type="checkbox" ${admgr.activeOnly ? 'checked' : ''} onchange="admgrToggleActive()" /> 활성만</label>`}
      <input class="inp" id="admgr-q" style="max-width:200px;background:#fff;" placeholder="${own ? '세트명·소재명 검색' : '이름 검색'}" value="${esc(admgr.q)}" oninput="admgrSearch(this.value)" />
      ${!own ? `<button class="filter-tab" onclick="admgrColsMenu(event)" title="표시할 열 선택 · 드래그로 순서 변경"><i class="fa-solid fa-table-columns"></i> 열</button>` : ''}
      ${!own && !admgr.demo && admgr.write.st && dnrbCan('budget') ? `<span style="display:inline-flex;gap:6px;flex-wrap:wrap;">${admgrWriteCtrlHtml()}</span>` : ''}
      <span style="flex:1;"></span>
      ${cfg && !admgr.demo ? `<button class="btn-analyze" onclick="admgrRefresh()" ${busy ? 'disabled' : ''}>
          <i class="fa-solid ${own ? 'fa-rotate' : 'fa-cloud-arrow-down'}"></i> ${busy ? '불러오는 중…' : own ? '새로고침' : 'Meta 불러오기'}</button>` : ''}
      ${!cfg || admgr.demo ? `<button class="btn-sample" onclick="admgrDemo()"><i class="fa-solid fa-wand-magic-sparkles"></i> 데모 데이터로 보기</button>` : ''}
    </div>`;

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
    ['offad', '기존광고 중 OFF', admgr.offad.loaded ? admgr.offad.data.count : null],
    ['best', '베스트소재', admgr.best.loaded ? (admgr.best.rows || []).length : null],
  ];
  /* Meta 광고관리자식 탭 스트립 (캠페인 / 광고 세트 / 광고 + 부가 탭) — 2026-09-07 */
  const ICON = { camp: '▣', set: '▤', ad: '▥', test: '⚗', offad: '⏻', best: '★' };
  const tabs = `<div class="mtabs">${tabDefs.map(([k, label, n]) =>
    `<button class="mtab ${admgr.view === k ? 'on' : ''}" onclick="admgrSetView('${k}')">${ICON[k] || ''} ${label}${n == null ? '' : ` <span class="n">${n}개</span>`}</button>`).join('')}</div>
    <div class="filter-tabs" style="margin:8px 0 4px;">
    ${!own && (admgr.selCamps.size || admgr.selSets.size) ? `
      <span style="font-size:.75rem;color:#6b7280;font-weight:600;">선택: 캠페인 ${admgr.selCamps.size} · 세트 ${admgr.selSets.size}</span>
      ${admgr.view === 'set' && admgr.selSets.size && cfg && !admgr.demo ? `<button class="filter-tab" style="color:#4f46e5;border-color:#a5b4fc;" onclick="admgrBestAdd()" title="체크한 광고세트의 소재를 베스트소재 탭에 모아둡니다"><i class="fa-solid fa-star"></i> 베스트소재로</button>` : ''}
      <button class="filter-tab" style="color:#dc2626;" onclick="admgrClearSel()">선택 해제 ✕</button>` : ''}</div>`;

  let main;
  if (admgr.view === 'test') main = renderAdmgrTest();
  else if (admgr.view === 'offad') main = renderAdmgrOff();
  else if (admgr.view === 'best') main = renderAdmgrBest();
  else main = renderAdmgrHier(R, setsInSel, adsInSel, cfg);

  body.innerHTML = banner + controls + (admgr.solo ? '' : tabs) + main;
  window.scrollTo(0, pageY);
  if (sc) { const w = body.querySelector('.table-wrap'); if (w) { w.scrollTop = sc.t; w.scrollLeft = sc.l; } }
  if (hadFocus) { const i = $('admgr-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  if (['camp', 'set', 'ad'].includes(admgr.view)) admgrColsApply();   // 열 표시/순서 (Meta의 '열' 메뉴) — 너비 적용보다 먼저
  admgrColResize();   // 표를 새로 그릴 때마다 핸들 재부착 + 저장된 너비 재적용 (원본 규칙)
}

/* ═══ 계층 3탭 (1단계) ═══ */
function renderAdmgrHier(R, setsInSel, adsInSel, cfg) {
  if (!admgr.data) {
    return `<div class="empty-state"><div class="es-icon"><i class="fa-brands fa-meta"></i></div>
      <p>${admgr.loading ? '불러오는 중…' : cfg
        ? '<b>Meta 불러오기</b>를 누르면 캠페인 → 광고세트 → 광고 현황이 나옵니다.'
        : '연동 전이라면 <b>데모 데이터로 보기</b>로 화면을 먼저 구경해 보세요.'}</p></div>`;
  }
  const isCamp = admgr.view === 'camp', isSet = admgr.view === 'set';
  const VIEW_LABEL = isCamp ? '캠페인' : isSet ? '광고세트' : '광고';
  let vis = isCamp ? admgrVisible(R.camps) : isSet ? admgrVisible(setsInSel) : admgrVisible(adsInSel);

  /* '최근 변경' 열 + '오늘 예산' 필터 칩 — 오늘 칩 + 캠페인/세트 탭에서만 (원본 규칙) */
  const bb = admgr.budget;
  const showChg = admgr.preset === 'today' && (isCamp || isSet) && !admgr.demo;
  const showMid = !!(admgr.write.st && admgr.write.st.allowed) && isSet && !admgr.demo && dnrbCan('budget');   // '자정세팅' 열 — 광고세트 탭만 (캠페인 예산은 수동 — 2026-09-04 사용자 지정)
  /* '판정' 열 — 광고세트 탭 + 오늘 칩: 지출 vs 마진(판매가−공급가×1.1)·구매로 1차/2차 후보 배지 (2026-09-05 사용자 운영 규칙) */
  const showJudge = isSet && admgr.preset === 'today' && !admgr.demo;
  let judgeChips = '';
  if (showJudge) {
    if (!admgr.products && !admgr.productsLoading && admgrCfg()) admgrLoadProducts();
    const all = vis.map(r => ({ r, j: admgrJudge(r) }));
    const cnt = k => all.filter(x => x.j.key === k).length;
    const chip = (k, label, n, on, fn) => `<button class="filter-tab ${on ? 'active' : ''}" onclick="${fn}">${label}${n == null ? '' : ' ' + n}</button>`;
    /* 1차/2차 구분은 2026-09-07 사용자 요청으로 제거 — 칩은 필터: 누르면 그 판정에 해당하는 세트만 표시 */
    judgeChips = `<div class="filter-tabs" style="margin-bottom:12px;">
      <span style="font-size:.75rem;font-weight:700;color:#6b7280;">판정:</span>
      ${chip('all', '전체', all.length, admgr.judgeFilter === 'all', "admgrJudgeSet('all')")}
      ${chip('cut', '🔴 감액 ÷10', cnt('cut'), admgr.judgeFilter === 'cut', "admgrJudgeSet('cut')")}${chip('warn', '🟡 곧 도달', cnt('warn'), admgr.judgeFilter === 'warn', "admgrJudgeSet('warn')")}${chip('up', '🟢 증액 검토', cnt('up'), admgr.judgeFilter === 'up', "admgrJudgeSet('up')")}
      ${chip('nomargin', '마진 없음', cnt('nomargin'), admgr.judgeFilter === 'nomargin', "admgrJudgeSet('nomargin')")}
      <span style="flex:1;"></span>
      ${cnt('cut') && admgr.write.st && dnrbCan('budget') ? `<button class="filter-tab" style="color:#fff;background:#dc2626;border-color:transparent;" onclick="admgrCutAll()" title="감액 후보 전체를 현재 예산 ÷10으로 즉시 적용 (PIN·확인창)">감액 후보 전체 ÷10 (${cnt('cut')})</button>` : ''}
      ${admgr.productsLoading ? '<span style="font-size:.72rem;color:#9ca3af;">카페24 상품 가격 불러오는 중…</span>' : ''}
    </div>`;
    if (admgr.judgeFilter !== 'all') vis = all.filter(x => x.j.key === admgr.judgeFilter).map(x => x.r);
  }
  let chgChips = '';
  if (showChg && bb.byObj) {
    const base = vis;
    const changed = base.filter(r => (bb.byObj.get(r.id) || []).length);
    const ups = changed.filter(r => admgrChgUp(bb.byObj.get(r.id))).length;
    const chip = (k, label, n) => `<button class="filter-tab ${admgr.chgFilter === k ? 'active' : ''}" onclick="admgrChgSet('${k}')">${label} ${n}</button>`;
    chgChips = `<div class="filter-tabs" style="margin-bottom:12px;"><span style="font-size:.75rem;font-weight:700;color:#6b7280;">오늘 예산:</span>
      ${chip('all', '전체', base.length)}${chip('changed', '변경', changed.length)}${chip('up', '↑ 증액', ups)}${chip('down', '↓ 감액', changed.length - ups)}</div>`;
    if (admgr.chgFilter !== 'all') {
      vis = vis.filter(r => { const evs = bb.byObj.get(r.id); if (!evs || !evs.length) return false;
        return admgr.chgFilter === 'changed' || ((admgr.chgFilter === 'up') === admgrChgUp(evs)); });
    }
  }

  admgr._dispIds = vis.map(r => r.id);   // 헤더 전체선택용 (검색·활성만·판정 필터 반영된 표시 행)
  /* 요약 타일 (표시분 기준) */
  const tot = { spend: 0, purchases: 0, value: 0, clicks: 0 };
  for (const r of vis) { tot.spend += r.spend || 0; tot.purchases += r.purchases || 0; tot.value += r.value || 0; tot.clicks += r.clicks || 0; }
  const tiles = !admgrMobile() ? '' : `<div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:14px;">
    ${admgrTile('지출 (표시분)', won(tot.spend))}${admgrTile('구매', comma(tot.purchases))}
    ${admgrTile('구매당 비용', admgrCpa(tot))}${admgrTile('구매 전환값', won(tot.value))}
    ${admgrTile('ROAS', tot.spend ? (tot.value / tot.spend).toFixed(2) : '—')}${admgrTile('표시 중 ' + VIEW_LABEL, vis.length + '개')}
  </div>`;
  const cpcTd = r => r.clicks ? won(r.spend / r.clicks) : '—';
  const totalRow = (lead, extraCols) => `<tfoot><tr>
    <td colspan="${lead}" style="text-align:left;">${vis.length}개 ${VIEW_LABEL}의 결과</td>
    ${extraCols}
    <td>${won(tot.spend)}</td>${isCamp || isSet ? '' : `<td class="m-hide">${comma(tot.clicks)}</td>`}<td>${comma(tot.purchases)}</td>
    <td class="m-hide">${admgrCpa(tot)}</td><td class="m-hide">${won(tot.value)}</td><td>${admgrRoasTd(tot)}</td><td class="m-hide">${cpcTd(tot)}</td>
  </tr></tfoot>`;

  let table;
  if (!vis.length) {
    table = `<div class="empty-state" style="padding:36px;"><p>조건에 맞는 행이 없어요.</p></div>`;
  } else if (isCamp || isSet) {
    table = `<div class="table-wrap"><table>
      <thead><tr><th class="cb"><input type="checkbox" ${vis.length && vis.every(r => (isCamp ? admgr.selCamps : admgr.selSets).has(r.id)) ? 'checked' : ''} onclick="admgrSelAllDisp()" title="표시된 ${VIEW_LABEL} 전체 선택/해제" /></th><th class="l tg">켜기/끄기</th>${admgrTh('name', VIEW_LABEL, 'l')}<th class="l">게재</th>${showJudge ? '<th class="l" title="오늘 지출 vs 마진(판매가−공급가×1.1)·구매 기준 — 감액 ÷10 / 곧 도달 / 증액 검토">판정</th>' : ''}${showMid ? '<th class="l m-hide" title="시작 = 오늘 하루 시작 예산(00:10 기록). 23:55 원복 승인 시 이 값으로 되돌아가요. 아래 칸은 23:55에 따로 걸 금액(선택) — 예약한 세트는 원복 대신 그 금액으로">23:55 세팅</th>' : ''}${admgrTh('budget', '예산', 'm-hide')}${showChg ? '<th class="l m-hide" title="오늘 예산 변경 (Meta 활동 로그)">최근 변경</th>' : ''}
        ${admgrTh('spend', '지출')}${admgrTh('purch', '구매')}${admgrTh('cpa', '구매당 비용', 'm-hide')}${admgrTh('value', '전환값', 'm-hide')}${admgrTh('roas', 'ROAS')}${admgrTh('cpc', 'CPC', 'm-hide')}</tr></thead>
      <tbody>${vis.map(r => `
        <tr>
          <td class="cb"><input type="checkbox" ${(isCamp ? admgr.selCamps : admgr.selSets).has(r.id) ? 'checked' : ''}
               onclick="event.stopPropagation();${isCamp ? 'admgrToggleCamp' : 'admgrToggleSet'}('${r.id}')" /></td>
          <td class="l tg">${admgrOnOff(r, isCamp ? 'campaign' : 'adset')}</td>
          <td class="name-cell" title="${esc(r.name || '')}${!isCamp ? ' · ' + esc(r._campName || '') : ''}">
            <b>${esc(r.name || '(이름 없음)')}</b>${!isCamp ? `<span class="sub">· ${esc(r._campName || '')}</span>` : ''}<button class="btn-ghost row-act"
              onclick="admgrDrill('${isCamp ? 'camp' : 'set'}','${r.id}')">${isCamp ? '세트 보기' : '광고 보기'} →</button></td>
          <td class="l" style="white-space:nowrap;">${admgrStBadge(r.status)}</td>
          ${showJudge ? `<td class="l">${admgrJudgeCell(r)}</td>` : ''}
          ${showMid ? `<td class="l m-hide">${admgrMidCell(r, isCamp ? 'campaign' : 'adset')}</td>` : ''}
          <td class="m-hide">${admgrBudgetCell(r, isCamp ? 'campaign' : 'adset')}</td>
          ${showChg ? `<td class="l m-hide">${admgrChgCell(r)}</td>` : ''}
          <td>${admgrMoney(r.spend)}</td>
          <td>${comma(r.purchases || 0)}</td>
          <td class="m-hide">${admgrCpa(r)}</td>
          <td class="m-hide">${admgrMoney(r.value)}</td>
          <td>${admgrRoasTd(r)}</td>
          <td class="m-hide">${cpcTd(r)}</td>
        </tr>`).join('')}</tbody>
      ${totalRow(4 + (showJudge ? 1 : 0), `${showMid ? '<td class="m-hide">—</td>' : ''}<td class="m-hide">—</td>${showChg ? '<td class="m-hide">—</td>' : ''}`)}
    </table></div>`;
  } else {
    table = `<div class="table-wrap"><table>
      <thead><tr><th class="l tg">켜기/끄기</th>${admgrTh('name', '광고', 'l')}<th class="l">게재</th>${admgrTh('spend', '지출')}${admgrTh('clicks', '클릭', 'm-hide')}
        ${admgrTh('purch', '구매')}${admgrTh('cpa', '구매당 비용', 'm-hide')}${admgrTh('value', '전환값', 'm-hide')}${admgrTh('roas', 'ROAS')}${admgrTh('cpc', 'CPC', 'm-hide')}</tr></thead>
      <tbody>${vis.map(r => `
        <tr onclick="showMetaPreview('${r.id}')" style="cursor:pointer;" title="클릭 → 소재 미리보기">
          <td class="l tg" onclick="event.stopPropagation()">${admgrOnOff(r, 'ad')}</td>
          <td class="name-cell" title="${esc(r.name || '')} · ${esc(r._setName || '')}">
            <b>${esc(r.name || '(이름 없음)')}</b><span class="sub">· ${esc(r._setName || '')}</span></td>
          <td class="l" style="white-space:nowrap;">${admgrStBadge(r.status)}</td>
          <td>${admgrMoney(r.spend)}</td>
          <td class="m-hide">${comma(r.clicks || 0)}</td>
          <td>${comma(r.purchases || 0)}</td>
          <td class="m-hide">${admgrCpa(r)}</td>
          <td class="m-hide">${admgrMoney(r.value)}</td>
          <td>${admgrRoasTd(r)}</td>
          <td class="m-hide">${cpcTd(r)}</td>
        </tr>`).join('')}</tbody>
      ${totalRow(3, '')}
    </table></div>`;
  }
  /* 폰(≤768px): 표 대신 카드 (같은 vis 행·같은 셀 렌더러 재사용 — 표는 CSS로 숨김) */
  let cards = '';
  if (admgrMobile() && vis.length && (isCamp || isSet || admgr.view === 'ad')) {
    const level = isCamp ? 'campaign' : isSet ? 'adset' : 'ad';
    const roas = r => r.spend ? (r.value / r.spend).toFixed(2) : '—';
    const roasColor = r => !r.spend ? '#9ca3af' : r.value / r.spend < 1 ? '#dc2626' : '#1c1e21';
    const sel = isCamp ? admgr.selCamps : admgr.selSets;
    cards = `<div class="mcards">${vis.map(r => {
      const sub = isCamp ? '' : isSet ? (r._campName || '') : (r._setName || '');
      const more = `
        ${admgr.view === 'ad' ? `<div class="row"><span>클릭</span><span>${comma(r.clicks || 0)}</span></div>` : ''}
        <div class="row"><span>구매당 비용</span><span>${admgrCpa(r)}</span></div>
        <div class="row"><span>전환값</span><span>${admgrMoney(r.value)}</span></div>
        <div class="row"><span>CPC</span><span>${cpcTd(r)}</span></div>
        ${showChg ? `<div class="row"><span>최근 변경</span><span>${admgrChgCell(r)}</span></div>` : ''}
        ${showMid ? `<div class="row"><span>23:55 세팅</span><span>${admgrMidCell(r, level)}</span></div>` : ''}
        ${admgr.view !== 'ad' ? `<div class="row"><span>선택</span><span><label style="display:inline-flex;align-items:center;gap:6px;"><input type="checkbox" ${sel.has(r.id) ? 'checked' : ''} onclick="event.stopPropagation();${isCamp ? 'admgrToggleCamp' : 'admgrToggleSet'}('${r.id}')" /> ${isCamp ? '이 캠페인의 세트만 보기' : '베스트소재 담기용 선택'}</label></span></div>
        <div class="row"><span></span><span><a class="drill" onclick="event.stopPropagation();admgrDrill('${isCamp ? 'camp' : 'set'}','${r.id}')">${isCamp ? '세트 보기' : '광고 보기'} →</a></span></div>` : ''}`;
      return `<div class="mcard ${sel.has(r.id) ? 'sel' : ''}" ${admgr.view === 'ad' ? `onclick="showMetaPreview('${r.id}')"` : ''}>
        <div class="mc-top"><div class="mc-name"><b>${esc(r.name || '(이름 없음)')}</b><div class="mc-sub">${admgrStBadge(r.status)}${sub ? ' · ' + esc(sub) : ''}</div></div>
          <div class="mc-tg" onclick="event.stopPropagation()">${admgrOnOff(r, level)}</div></div>
        ${showJudge ? `<div class="mc-judge">${admgrJudgeCell(r)}</div>` : ''}
        <div class="mc-nums"><div><i>지출</i>${admgrMoney(r.spend)}</div><div><i>구매</i>${comma(r.purchases || 0)}</div><div><i>ROAS</i><span style="color:${roasColor(r)};">${roas(r)}</span></div></div>
        <div class="mc-foot">
          <div class="mc-budget" onclick="event.stopPropagation()">${admgr.view === 'ad' ? '<span style="color:#9ca3af;">탭하면 소재 미리보기</span>' : admgrBudgetCell(r, level)}</div>
          <div class="mc-btns"><button onclick="event.stopPropagation();const c=this.closest('.mcard');c.classList.toggle('open');this.classList.toggle('on',c.classList.contains('open'))" title="더 보기"><i class="fa-solid fa-chevron-down"></i></button></div>
        </div>
        <div class="mc-more" onclick="event.stopPropagation()">${more}</div>
      </div>`; }).join('')}</div>`;
  }
  return chgChips + judgeChips + tiles + table + cards;
}
const admgrMobile = () => window.innerWidth <= 768;
let admgrMobileWas = null;
window.addEventListener('resize', () => {   // 폰↔데스크톱 경계를 넘을 때만 다시 그림 (데스크톱 표는 이 이벤트로 안 건드림)
  const now = admgrMobile();
  if (admgrMobileWas === null) { admgrMobileWas = now; return; }
  if (now !== admgrMobileWas) { admgrMobileWas = now; if (admgr.data && ['camp', 'set', 'ad'].includes(admgr.view)) renderAdmgr(true); }
});

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
    admgr.products = rows.filter(p => p.name && p.price > 0).map(p => ({ name: p.name, price: p.price, supply: p.supply_price || 0 }));
    lsSet('adc_admgr_products', admgr.products);
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
function admgrJudge(r) {
  const { m, src } = admgrMarginOf(r);
  const spend = r.spend || 0, pur = r.purchases || 0;
  if (!(m > 0)) return { key: 'nomargin', m, src };
  const ratio = spend / m;
  const evs = (admgr.budget.byObj && admgr.budget.byObj.get(r.id)) || [];
  const cutToday = evs.some(e => e.new_value < e.old_value);
  if (cutToday)                  return { key: 'done', m, src, ratio };   // 오늘 이미 감액한 세트 — 두 번 깎지 않게
  if (pur === 0 && ratio >= 1)   return { key: 'cut',  m, src, ratio };   // 구매 0인데 지출이 마진 이상 → 감액 ÷10
  if (pur === 0 && ratio >= 0.8) return { key: 'warn', m, src, ratio };   // 구매 0, 지출이 마진의 80% 이상 → 곧 도달
  if (pur >= 3)                  return { key: 'up',   m, src, ratio };   // 구매 3건 이상 → 증액 검토
  return { key: '', m, src, ratio };
}
const ADMGR_JUDGE = {
  cut:      { cls: 'badge-red',    t: '🔴 감액 ÷10' },
  warn:     { cls: 'badge-yellow', t: '🟡 곧 도달' },
  up:       { cls: 'badge-green',  t: '🟢 증액 검토' },
  done:     { cls: 'badge-gray',   t: '✓ 오늘 감액됨' },
  nomargin: { cls: 'badge-gray',   t: '마진 없음' },
};
function admgrJudgeCell(r) {
  const j = admgrJudge(r);
  const b = ADMGR_JUDGE[j.key];
  const pen = `<i class="fa-solid fa-pen" title="마진 직접 입력${j.src ? ' — 현재: ' + esc(j.src) : ''}" style="font-size:.55rem;color:#a5b4fc;cursor:pointer;margin-left:4px;" onclick="event.stopPropagation();admgrMarginEdit('${r.id}')"></i>`;
  const sub = j.m > 0 ? `<div style="font-size:.62rem;color:#9ca3af;white-space:nowrap;">마진 ${comma(j.m)} · 지출 ${Math.round((j.ratio || 0) * 100)}%${pen}</div>` : `<div style="font-size:.62rem;color:#9ca3af;">${j.src ? esc(j.src.slice(0, 18)) : '상품 매칭 안 됨'}${pen}</div>`;
  const act = j.key === 'cut' && admgr.write.st && dnrbCan('budget') && r.budget > 0
    ? ` <button class="filter-tab" style="padding:2px 8px;font-size:.66rem;color:#dc2626;border-color:#fca5a5;" title="${comma(r.budget)} → ${comma(Math.max(1000, Math.round(r.budget / 10)))}원 즉시 적용" onclick="event.stopPropagation();admgrCut10('${r.id}')">÷10</button>` : '';
  return `${b ? `<span class="status-badge ${b.cls}" style="white-space:nowrap;">${b.t}</span>${act}` : '<span style="color:#d1d5db;">—</span>'}${sub}`;
}
function admgrJudgeSet(k) { admgr.judgeFilter = k; renderAdmgr(true); }
function admgrMarginEdit(id) {
  const r = admgrRows().sets.find(x => x.id === id); if (!r) return;
  const cur = admgrMarginOf(r);
  const v = prompt(`'${r.name}'\n마진(판매가 − 원가, 원)을 입력하세요. 비우면 카페24 자동 계산으로 돌아갑니다.`, cur.m > 0 ? cur.m : '');
  if (v === null) return;
  const n = Math.round(Number(String(v).replace(/[^0-9]/g, '')));
  if (n > 0) admgr.margins[id] = n; else delete admgr.margins[id];
  lsSet('adc_admgr_margin', admgr.margins); renderAdmgr(true);
}
function admgrCut10(id) {
  const r = admgrRows().sets.find(x => x.id === id); if (!r || !(r.budget > 0)) return;
  admgrApplyNow(id, 'adset', Math.max(1000, Math.round(r.budget / 10)));
}
async function admgrCutAll() {
  const w = admgr.write;
  if (!w.pin) { admgrPinPrompt(admgrCutAll); return; }
  const targets = admgrRows().sets.filter(r => r.budget > 0 && admgrJudge(r).key === 'cut');
  if (!targets.length) { toast('감액 후보가 없어요'); return; }
  const lines = targets.map(r => `· ${esc(r.name)}: ${comma(r.budget)} → <b>${comma(Math.max(1000, Math.round(r.budget / 10)))}</b>`).join('<br/>');
  admgrConfirmModal(`감액 후보 ${targets.length}개 ÷10`, `${lines}<br/><span style="color:#9ca3af;font-size:.72rem;">Meta에 즉시 반영돼요 · 순서대로 처리</span>`, `${targets.length}개 감액`, async () => {
    let ok = 0, fail = 0;
    for (const r of targets) {   // ponytail: 순차 실행 (Meta 호출 한도 배려) — 수십 개면 수십 초
      try { await metaBudgetCall({ action: 'apply' }, { object_id: r.id, object_name: r.name, level: 'adset', new_budget: Math.max(1000, Math.round(r.budget / 10)), pin: w.pin }); ok++; }
      catch (e) { fail++; if (String(e.message).includes('PIN')) { admgrPinInvalidate(); toast('PIN 오류로 중단: ' + e.message); break; } }
    }
    toast(`감액 완료 ${ok}개${fail ? ` · 실패 ${fail}개` : ''}`);
    admgrFetch();
  });
}
