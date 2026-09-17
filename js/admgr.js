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
  selAds: new Set(),
  customRange: lsGet('adc_admgr_range', null),   // 직접 지정 기간 {since, until} (2026-09-16)   // 광고 탭 선택 (복사용 — 2026-09-16)
  judgeFilter: 'all', margins: lsGet('adc_admgr_margin', {}), products: lsGet('adc_admgr_products2', null), productsLoading: false,   // products2: product_no 포함 (2026-09-12 순이익 등급용)
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
    const cr = admgr.preset === 'custom' && admgr.customRange ? admgr.customRange : null;
    admgr.data = await metaGet({ action: 'hierarchy', preset: admgr.preset, ...(cr ? { since: cr.since, until: cr.until } : {}) });
    lsSet('adc_admgr_last', { preset: admgr.preset, range: admgr.customRange, data: admgr.data });   // 새로고침해도 마지막 데이터 유지 (2026-09-05 사용자 요청)
    admgr.budget = { byObj: null, loading: false, error: false, seven: null, sevenLoading: false };
    if (admgr.preset === 'today') admgrBudgetFetch();   // '최근 변경' 열은 오늘 칩에서만
    admgrWriteInit();                                     // 예산 쓰기 가능 여부(토큰·PIN 설정) 확인
    metaGet({ action: 'usage' }).then(u => { admgr.usage = u; renderAdmgr(true); }).catch(() => {});
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

  /* ── 상단 도구 바 (2026-09-14 리디자인 A+B): 상태 알약 + 주 동작 1개(새로고침) + 23:55 세팅 + ⋯ 메뉴. 설명문은 툴팁으로 ── */
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
      : `<span class="ag-pill ok" title="${esc(range)} 기준 · ${m.sync_at ? '서버가 5분마다 Meta에서 받아 저장해 두고, 화면은 저장된 것만 읽어요 (새로고침해도 Meta 호출이 늘지 않아요)' : '서버 5분 캐시'}${pct != null ? ' · Meta 사용량 ' + Math.round(pct) + '%' : ''}"><span class="dot"></span>${m.sync_at ? '자동 수집' : '캐시'} · ${admgrAgo(admgr.data.fetched_at)}</span>`;
    if (admgr.data.truncated) status += `<span class="ag-pill warn" title="500개 한도로 일부가 잘렸어요">일부 잘림</span>`;
  }
  const canWrite = !own && !admgr.demo && !!w.st && dnrbCan('budget');
  const nd = canWrite ? admgrDraftTargets().length : 0;
  const npend = w.pendingByObj ? w.pendingByObj.size : 0;
  const midState = w.midMode === 'setting' ? `<span class="ag-tag amber">세팅중${npend ? ' · ' + npend : ''}</span>`
    : w.resetRow ? '<span class="ag-tag green">원복 승인됨</span>' : (npend ? `<span class="ag-tag">예약 ${npend}</span>` : '');
  const toolbar = `<div class="ag-bar">
      ${status}
      <span style="flex:1;"></span>
      ${canWrite ? `<button class="btn-ghost ag-btn" onclick="admgrMidMenu(event)" title="23:55 세팅 — 반영 세팅 시작/완료 · 원복 승인 · 예약 목록"><i class="fa-regular fa-clock"></i> 23:55 세팅${midState}</button>` : ''}
      ${nd ? `<button class="btn-analyze ag-btn" style="background:#0a7c3f;" onclick="admgrPublishDrafts()" title="임시 저장해둔 예산·켜기/끄기를 한 번에 Meta에 게시"><i class="fa-solid fa-paper-plane"></i> 게시 ${nd}</button>` : ''}
      ${cfg && !admgr.demo ? `<button class="btn-analyze ag-btn" onclick="admgrRefresh()" ${busy ? 'disabled' : ''} title="${own ? '서버에서 다시 불러오기' : 'Meta에서 다시 불러오기'}"><i class="fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-rotate'}"></i> ${busy ? '불러오는 중' : '새로고침'}</button>` : ''}
      ${!cfg || admgr.demo ? `<button class="btn-sample ag-btn" onclick="admgrDemo()"><i class="fa-solid fa-wand-magic-sparkles"></i> 데모 데이터로 보기</button>` : ''}
      <button class="btn-ghost ag-btn ag-more" onclick="admgrMoreMenu(event)" title="더 보기 — PIN · 열 · 임시 저장 · 예약 목록"><i class="fa-solid fa-ellipsis"></i></button>
    </div>`;
  const filters = `<div class="ag-filters">
      ${own ? '' : `<span class="ag-seg">${Object.entries(ADMGR_PRESETS).map(([k, t]) => `<button class="${admgr.preset === k ? 'on' : ''}" onclick="admgrSetPreset('${k}')">${t.replace('최근 ', '')}</button>`).join('')}<button class="${admgr.preset === 'custom' ? 'on' : ''}" onclick="admgrRangeModal()" title="기간 직접 지정"><i class="fa-regular fa-calendar"></i>${admgr.preset === 'custom' && admgr.customRange ? ` ${esc(admgr.customRange.since.slice(5))}~${esc(admgr.customRange.until.slice(5))}` : ' 직접'}</button></span>
      <label class="ag-check" title="켜져 있는 것만 표시"><input type="checkbox" ${admgr.activeOnly ? 'checked' : ''} onchange="admgrToggleActive()" /> 활성만</label>`}
      <span class="ag-search"><i class="fa-solid fa-magnifying-glass"></i><input class="inp" id="admgr-q" placeholder="${own ? '세트명·소재명 검색' : '이름 검색'}" value="${esc(admgr.q)}" oninput="admgrSearch(this.value)" /></span>
      <span style="flex:1;"></span>
      ${!own ? `<button class="btn-ghost ag-btn" onclick="admgrColsMenu(event)" title="표시할 열 선택 · 드래그로 순서 변경 (기본은 핵심 열만, 나머지는 행 끝 ∨로 펼치기)"><i class="fa-solid fa-table-columns"></i> 열</button>` : ''}
    </div>`;
  const controls = toolbar + filters;
  const banner = '';

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
  const tabs = `<div class="mtabs">${tabDefs.map(([k, label, n], i) =>
    `${i === 3 ? '<span class="mtab-sep"></span>' : ''}<button class="mtab ${admgr.view === k ? 'on' : ''}" onclick="admgrSetView('${k}')">${label}${n == null ? '' : ` <span class="n">${n}</span>`}</button>`).join('')}</div>`;

  let main;
  if (admgr.view === 'test') main = renderAdmgrTest();
  else if (admgr.view === 'offad') main = renderAdmgrOff();
  else if (admgr.view === 'best') main = renderAdmgrBest();
  else main = renderAdmgrHier(R, setsInSel, adsInSel, cfg);

  /* 검색창에 커서가 있을 때(타이핑 중)는 컨트롤 바를 그대로 두고 그 아래만 다시 그린다 — 입력칸까지 새로 만들면 폰에서 키보드가
     닫혔다 열리며 화면이 깜빡이고 한글 조합이 끊겼다 (2026-09-13 사용자 제보) */
  const rest = (admgr.solo ? '' : tabs) + main;
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
      <span class="ag-lbl">판정</span>
      ${chip('all', '전체', all.length, admgr.judgeFilter === 'all', "admgrJudgeSet('all')")}
      ${chip('cut', '<span class="ag-dot red"></span>감액 ÷10 <small class="ag-muted">구매 0</small>', cnt('cut'), admgr.judgeFilter === 'cut', "admgrJudgeSet('cut')")}${chip('warn', '<span class="ag-dot amber"></span>곧 도달 <small class="ag-muted">구매 1~2</small>', cnt('warn'), admgr.judgeFilter === 'warn', "admgrJudgeSet('warn')")}${chip('up', '<span class="ag-dot green"></span>증액 검토 <small class="ag-muted">구매 3+</small>', cnt('up'), admgr.judgeFilter === 'up', "admgrJudgeSet('up')")}${cnt('rebound') ? chip('rebound', '<span class="ag-dot blue"></span>감액 후 반등 <small class="ag-muted">구매 2+ · ROAS 5+</small>', cnt('rebound'), admgr.judgeFilter === 'rebound', "admgrJudgeSet('rebound')") : ''}${cnt('testing') ? chip('testing', '<span class="ag-dot gray"></span>테스트중 <small class="ag-muted">세트명 test</small>', cnt('testing'), admgr.judgeFilter === 'testing', "admgrJudgeSet('testing')") : ''}
      ${bb.byObj ? `<span class="ag-vsep"></span>${chip('nochg', '<i class="fa-solid fa-pen-slash" style="font-size:.7em;margin-right:5px;"></i>오늘 예산 미변경', vis.filter(r => !admgrIsTest(r) && !(bb.byObj.get(r.id) || []).length).length, admgr.judgeFilter === 'nochg', "admgrJudgeSet('nochg')")}` : ''}
      <span style="flex:1;"></span>
      ${admgr.write.st && dnrbCan('budget') && all.filter(x => x.j.key === 'cut' && x.r.budget > 0).length ? `<button class="filter-tab" style="color:#fff;background:#dc2626;border-color:transparent;" onclick="admgrCutAll()" title="구매 0 + 지출 있는 세트 전체를 현재 예산 ÷10으로 임시 저장 (오늘 이미 감액한 세트 제외 · 캠페인 예산 세트 제외) — 상단 \'게시\'를 눌러야 Meta에 반영돼요">감액 후보 ÷10 임시 저장 (${all.filter(x => x.j.key === 'cut' && x.r.budget > 0).length})</button>` : ''}
      ${admgr.productsLoading ? '<span style="font-size:.72rem;color:#9ca3af;">카페24 상품 가격 불러오는 중…</span>' : ''}
    </div>`;
    if (admgr.judgeFilter === 'nochg') vis = bb.byObj ? vis.filter(r => !admgrIsTest(r) && !(bb.byObj.get(r.id) || []).length) : vis;   // 오늘 예산 변경 이력 없는 세트 (Meta 활동 로그 기준)
    else if (admgr.judgeFilter !== 'all') vis = all.filter(x => x.j.key === admgr.judgeFilter).map(x => x.r);
  }
  let chgChips = '';
  if (showChg && bb.byObj) {
    const base = vis;
    const changed = base.filter(r => (bb.byObj.get(r.id) || []).length);
    const ups = changed.filter(r => admgrChgUp(bb.byObj.get(r.id))).length;
    const chip = (k, label, n) => `<button class="filter-tab ${admgr.chgFilter === k ? 'active' : ''}" onclick="admgrChgSet('${k}')">${label} ${n}</button>`;
    chgChips = `<div class="filter-tabs" style="margin-bottom:12px;"><span class="ag-lbl">오늘 예산</span>
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
    <td class="m-hide">${admgrCpa(tot)}</td><td class="m-hide">${won(tot.value)}</td><td>${admgrRoasTd(tot)}</td><td class="m-hide">${cpcTd(tot)}</td><td class="xp"></td>
  </tr></tfoot>`;
  /* 행 끝 ∨ — 기본 숨김 열(구매당 비용·전환값·클릭·CPC·최근 변경·게재)을 상세 행으로 (2026-09-14 리디자인: 기본 열 6개) */
  const chev = `<button class="ag-chev" onclick="event.stopPropagation();admgrRowToggle(this)" title="자세히"><i class="fa-solid fa-chevron-down"></i></button>`;
  const detail = r => `<tr class="ag-detail"><td colspan="99"><div class="ag-detail-grid">
      <span><i>구매당 비용</i>${admgrCpa(r)}</span><span><i>전환값</i>${admgrMoney(r.value)}</span><span><i>클릭</i>${comma(r.clicks || 0)}</span><span><i>CPC</i>${cpcTd(r)}</span>
      ${showChg ? `<span><i>최근 변경</i>${admgrChgCell(r)}</span>` : ''}${r.budget_life ? `<span><i>총예산</i>${won(r.budget_life)}</span>` : ''}</div></td></tr>`;

  let table;
  if (!vis.length) {
    table = `<div class="empty-state" style="padding:36px;"><p>조건에 맞는 행이 없어요.</p></div>`;
  } else if (isCamp || isSet) {
    table = `<div class="table-wrap"><table>
      <thead><tr><th class="cb"><input type="checkbox" ${vis.length && vis.every(r => (isCamp ? admgr.selCamps : admgr.selSets).has(r.id)) ? 'checked' : ''} onclick="admgrSelAllDisp()" title="표시된 ${VIEW_LABEL} 전체 선택/해제" /></th><th class="l tg" title="켜기/끄기 — 클릭하면 임시 저장, 상단 '게시'로 반영">켜짐</th>${admgrTh('name', VIEW_LABEL, 'l')}${showJudge ? '<th class="l" title="오늘 구매 수 기준 — 0건(지출 있음)=감액 ÷10 · 1~2건=곧 도달 · 3건+=증액 검토. 아래 줄의 마진·지출%는 참고">판정</th>' : ''}${showMid ? '<th class="l m-hide" title="시작 = 오늘 하루 시작 예산(00:10 기록). 23:55 원복 승인 시 이 값으로 되돌아가요. 아래 칸은 23:55에 따로 걸 금액(선택) — 예약한 세트는 원복 대신 그 금액으로">23:55 세팅</th>' : ''}${admgrTh('budget', '예산', 'm-hide')}${showChg ? '<th class="l m-hide" title="오늘 예산 변경 (Meta 활동 로그)">최근 변경</th>' : ''}
        ${admgrTh('spend', '지출')}${admgrTh('purch', '구매')}${admgrTh('cpa', '구매당 비용', 'm-hide')}${admgrTh('value', '전환값', 'm-hide')}${admgrTh('roas', 'ROAS')}${admgrTh('cpc', 'CPC', 'm-hide')}<th class="xp"></th></tr></thead>
      <tbody>${vis.map(r => `
        <tr class="ag-row ${(isCamp ? admgr.selCamps : admgr.selSets).has(r.id) ? 'sel' : ''}" onclick="admgrRowClick(event,'${isCamp ? 'camp' : 'set'}','${r.id}')" title="행을 클릭하면 선택/해제">
          <td class="cb"><input type="checkbox" ${(isCamp ? admgr.selCamps : admgr.selSets).has(r.id) ? 'checked' : ''}
               onclick="event.stopPropagation();${isCamp ? 'admgrToggleCamp' : 'admgrToggleSet'}('${r.id}')" /></td>
          <td class="l tg">${admgrOnOff(r, isCamp ? 'campaign' : 'adset')}</td>
          <td class="name-cell" title="${esc(r.name || '')}${!isCamp ? ' · ' + esc(r._campName || '') : ''}">
            <b>${esc(admgrBase(r.name))}</b>${admgrMarkBadges(r.name)}<button class="btn-ghost row-act"
              onclick="admgrDrill('${isCamp ? 'camp' : 'set'}','${r.id}')">${isCamp ? '세트 보기' : '광고 보기'} →</button>
            <div class="ag-sub">${admgrStBadge(r.status)}${!isCamp && r._campName ? ` · ${esc(r._campName)}` : ''}</div></td>
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
          <td class="xp">${chev}</td>
        </tr>${detail(r)}`).join('')}</tbody>
      ${totalRow(3 + (showJudge ? 1 : 0), `${showMid ? '<td class="m-hide">—</td>' : ''}<td class="m-hide">—</td>${showChg ? '<td class="m-hide">—</td>' : ''}`)}
    </table></div>`;
  } else {
    table = `<div class="table-wrap"><table>
      <thead><tr><th class="cb"><input type="checkbox" ${vis.length && vis.every(r => admgr.selAds.has(r.id)) ? 'checked' : ''} onclick="event.stopPropagation();admgrSelAllDisp()" title="표시된 광고 전체 선택/해제" /></th><th class="l tg" title="켜기/끄기 — 클릭하면 임시 저장, 상단 '게시'로 반영">켜짐</th>${admgrTh('name', '광고', 'l')}${admgrTh('spend', '지출')}${admgrTh('clicks', '클릭', 'm-hide')}
        ${admgrTh('purch', '구매')}${admgrTh('cpa', '구매당 비용', 'm-hide')}${admgrTh('value', '전환값', 'm-hide')}${admgrTh('roas', 'ROAS')}${admgrTh('cpc', 'CPC', 'm-hide')}<th class="xp"></th></tr></thead>
      <tbody>${vis.map(r => `
        <tr onclick="showMetaPreview('${r.id}')" style="cursor:pointer;" title="클릭 → 소재 미리보기" class="${admgr.selAds.has(r.id) ? 'sel' : ''}">
          <td class="cb" onclick="event.stopPropagation()"><input type="checkbox" ${admgr.selAds.has(r.id) ? 'checked' : ''} onclick="admgrToggleAd('${r.id}')" title="복사할 광고 선택" /></td>
          <td class="l tg" onclick="event.stopPropagation()">${admgrOnOff(r, 'ad')}</td>
          <td class="name-cell" title="${esc(r.name || '')} · ${esc(r._setName || '')}">
            <b>${esc(r.name || '(이름 없음)')}</b><div class="ag-sub">${admgrStBadge(r.status)}${r._setName ? ` · ${esc(admgrBase(r._setName))}` : ''}${admgrMarkBadges(r._setName)}</div></td>
          <td>${admgrMoney(r.spend)}</td>
          <td class="m-hide">${comma(r.clicks || 0)}</td>
          <td>${comma(r.purchases || 0)}</td>
          <td class="m-hide">${admgrCpa(r)}</td>
          <td class="m-hide">${admgrMoney(r.value)}</td>
          <td>${admgrRoasTd(r)}</td>
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
        <div class="mc-top"><div class="mc-name"><b>${esc(admgrBase(r.name))}</b>${admgrMarkBadges(r.name)}<div class="mc-sub">${admgrStBadge(r.status)}${sub ? ' · ' + esc(admgrBase(sub)) : ''}${admgrMarkBadges(sub)}</div></div>
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
  /* 체크 선택 시 하단 동작 바 (상단 '선택: …' 표시줄 대체) */
  const nc = admgr.selCamps.size, ns = admgr.selSets.size, na = admgr.view === 'ad' ? admgr.selAds.size : 0;
  const actbar = (nc || ns || na) ? `<div class="ag-actbar">
      <b>${nc ? `캠페인 ${nc}` : ''}${nc && ns ? ' · ' : ''}${ns ? `세트 ${ns}` : ''}${na ? `광고 ${na}` : ''} 선택</b><span class="sep"></span>
      ${na && cfg && !admgr.demo ? `<button onclick="admgrCopyModal()" title="고른 광고의 소재를 다른 캠페인·광고세트에 복사 (꺼진 상태로 만들어요)"><i class="fa-regular fa-copy"></i> 광고 복사</button>` : ''}
      ${isCamp && nc ? `<button onclick="admgrSetView('set')">선택한 캠페인의 세트 보기 →</button>` : ''}
      ${isSet && ns ? `<button onclick="admgrSetView('ad')">선택한 세트의 광고 보기 →</button>` : ''}
      ${isSet && ns && admgr.write.st && dnrbCan('budget') && !admgr.demo && admgr.write.daystart && admgr.write.daystart.size ? `<button onclick="admgrRestoreSel()" title="체크한 세트를 오늘 시작 예산(00:10 기록)으로 임시 저장 — 상단 '게시'를 눌러야 Meta에 반영돼요"><i class="fa-solid fa-rotate-left"></i> 시작 예산 복구</button>` : ''}
      ${isSet && ns && admgr.write.st && dnrbCan('budget') && !admgr.demo ? `<button class="cut" onclick="admgrCutSel()" title="체크한 광고세트 일예산 ÷10을 임시 저장 — 상단 \'게시\'를 눌러야 Meta에 반영돼요"><i class="fa-solid fa-arrow-down"></i> ÷10 임시 저장</button>` : ''}
      ${isSet && ns && cfg && !admgr.demo ? `<button onclick="admgrBestAdd()" title="체크한 광고세트의 소재를 베스트소재에 담기"><i class="fa-solid fa-star"></i> 베스트 담기</button>` : ''}
      <span style="flex:1;"></span><button class="ghost" onclick="admgrClearSel()">선택 해제 ✕</button></div>` : '';
  return chgChips + judgeChips + tiles + table + cards + actbar;
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
    <div style="font-size:.7rem;color:#9ca3af;margin-top:10px;">최대 400일 · 판정·23:55 세팅·최근 변경 열은 '오늘'에서만 보여요</div>
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
function admgrCopyModal() {
  const { camps, ads } = admgrRows();
  const picked = ads.filter(a => admgr.selAds.has(a.id));
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
  $('abm-body').innerHTML = `
    <div style="font-size:.78rem;color:#374151;line-height:1.7;max-height:24vh;overflow:auto;margin-bottom:12px;">
      ${picked.map(a => `· ${esc(admgrBase(a.name))} <span style="color:#9ca3af;">(${esc(admgrBase(a._setName))})</span>`).join('<br/>')}</div>
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
  const camps = admgrRows().camps, ads = admgrRows().ads.filter(a => admgr.selAds.has(a.id));
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
    admgr.selAds.clear();
    const tgt = (admgr.copySets && admgr.copySets[admgr.copyCamp] || []).find(x => x.id === setId) || admgrRows().sets.find(x => x.id === setId) || {};
    admgrCopyResult(d, campName, admgrBase(tgt.name || ''), marked);
    admgrFetch();
  } catch (e) {
    btn.disabled = false; btn.textContent = '복사';
    toast('복사 실패: ' + e.message);
  }
}
function admgrCopyResult(d, campName, setName, marked) {
  const ok = (d.created || []), skip = (d.skipped || []), bad = (d.failed || []);
  const line = (t, c) => `<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid #f3f4f6;font-size:.78rem;"><span style="flex:none;color:${c};font-weight:800;">${c === '#15803d' ? '✓' : c === '#b45309' ? '!' : '✗'}</span><span style="min-width:0;">${t}</span></div>`;
  $('abm-title').textContent = '광고 복사 결과';
  $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = `
    <div style="font-size:.82rem;font-weight:800;color:#1e1b4b;margin-bottom:8px;">${esc(campName)} · ${esc(setName)}</div>
    <div style="font-size:.8rem;color:#374151;margin-bottom:10px;">복사 <b style="color:#15803d;">${ok.length}</b>개${skip.length ? ` · 건너뜀 <b style="color:#b45309;">${skip.length}</b>개` : ''}${bad.length ? ` · 실패 <b style="color:#dc2626;">${bad.length}</b>개` : ''}${marked ? ` · 원본 세트 ${marked}개에 표시` : ''}</div>
    <div style="max-height:40vh;overflow:auto;">
      ${ok.map(x => line(`${esc(x.name)} <span style="color:#9ca3af;">— 꺼진 상태로 만들었어요</span>`, '#15803d')).join('')}
      ${skip.map(x => line(`${esc(x.name)} <span style="color:#b45309;">— 이미 같은 소재가 있어요${x.existing ? ` (${esc(x.existing)})` : ''}</span>`, '#b45309')).join('')}
      ${bad.map(x => line(`${esc(x.id)} <span style="color:#dc2626;">— ${esc(String(x.error || '실패'))}</span>`, '#dc2626')).join('')}</div>
    <div style="font-size:.7rem;color:#9ca3af;margin-top:10px;">복사본은 꺼져 있어요 — 메타나 이 화면의 켜기/끄기로 켜주세요</div>
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
const admgrIsTest = r => /test/i.test(String(r.name || '').normalize('NFC'));   // 세트명에 test — 테스트중이라 감액·증액 판정에서 뺀다 (2026-09-17 사용자 요청)
function admgrJudge(r) {   // 2026-09-15 사용자 규칙: 구매 수로만 판정 (마진·지출%는 참고 표시). 지출 0원인 세트는 감액 후보에서 제외
  const { m, src } = admgrMarginOf(r);
  if (admgrIsTest(r)) return { key: 'testing', m, src, ratio: m > 0 ? (r.spend || 0) / m : null };
  const spend = r.spend || 0, pur = r.purchases || 0;
  const ratio = m > 0 ? spend / m : null;
  const evs = (admgr.budget.byObj && admgr.budget.byObj.get(r.id)) || [];
  const cutToday = evs.some(e => e.new_value < e.old_value);
  const roas = spend > 0 ? (r.value || 0) / spend : 0;
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
  const sub = j.m > 0 ? `<div style="font-size:.62rem;color:#9ca3af;white-space:nowrap;">구매 ${comma(r.purchases || 0)} · 마진 ${comma(j.m)} · 지출 ${Math.round((j.ratio || 0) * 100)}%${pen}</div>` : `<div style="font-size:.62rem;color:#9ca3af;">구매 ${comma(r.purchases || 0)} · ${j.src ? esc(j.src.slice(0, 18)) : '마진 정보 없음'}${pen}</div>`;
  const act = j.key === 'cut' && admgr.write.st && dnrbCan('budget') && r.budget > 0
    ? ` <button class="filter-tab" style="padding:2px 8px;font-size:.66rem;color:#dc2626;border-color:#fca5a5;" title="${comma(r.budget)} → ${comma(Math.max(1000, Math.round(r.budget / 10)))}원으로 임시 저장 — 상단 \'게시\'로 반영" onclick="event.stopPropagation();admgrCut10('${r.id}')">÷10</button>` : '';
  return `${b ? `<span class="status-badge ${b.cls}" style="white-space:nowrap;">${b.t}</span>${act}` : '<span style="color:#d1d5db;">—</span>'}${sub}`;
}
function admgrJudgeSet(k) { admgr.judgeFilter = k; renderAdmgr(true); }
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
  admgr.selSets.clear();
  toast(`${n}개를 시작 예산으로 임시 저장${same ? ` · 동일 ${same}개` : ''}${none ? ` · 기록 없음 ${none}개` : ''} — 상단 '게시'로 반영`);
  renderAdmgr(true);
}
function admgrCutSel() {   // 체크한 광고세트
  if (admgrCutDraft(admgrRows().sets.filter(r => admgr.selSets.has(r.id)), '선택한 세트')) { admgr.selSets.clear(); renderAdmgr(true); }
}
