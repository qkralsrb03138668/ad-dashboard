/* 공통: 유틸·상수·저장소(localStorage)·기간·집계·메뉴·차트·토스트·초기화
   (index.html에서 분리 — 2026-09-08 2단계. 파일 순서는 index.html의 <script> 순서, 전역 함수·변수를 그대로 공유) */
'use strict';

/* ═══════════ 유틸 ═══════════ */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '';   // href엔 http(s)만 (javascript: 차단)
const comma = n => (Math.round(n) || 0).toLocaleString('ko-KR');
const won = n => comma(n) + '원';
function todayStr(offset) {
  const d = new Date(); d.setDate(d.getDate() + (offset || 0));
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
const fmtMD = ds => ds ? ds.slice(5).replace('-','/') : '';
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

/* ═══════════ 상수 ═══════════ */
const CH = { meta:'Meta', naver:'네이버 GFA', google:'구글', tiktok:'틱톡', etc:'기타' };
const CH_ICON = { meta:'fa-brands fa-meta', naver:'fa-solid fa-n', google:'fa-brands fa-google', tiktok:'fa-brands fa-tiktok', etc:'fa-solid fa-bullhorn' };
const ST = {
  testing:{ t:'평가중', b:'badge-blue' },
  good:   { t:'우수',   b:'badge-green' },
  meh:    { t:'애매',   b:'badge-yellow' },
  off:    { t:'OFF',    b:'badge-red' },
};
const METRICS = {
  spend:{ t:'지출',        f:v=>won(v) },
  imp:  { t:'노출',        f:v=>comma(v) },
  clicks:{t:'클릭',        f:v=>comma(v) },
  ctr:  { t:'CTR',        f:v=>v.toFixed(2)+'%' },
  cpc:  { t:'CPC',        f:v=>won(v) },
  purch:{ t:'구매',        f:v=>comma(v) },
  cpa:  { t:'구매당 비용', f:v=>won(v) },
  value:{ t:'구매 전환값', f:v=>won(v) },
  roas: { t:'ROAS',       f:v=>v.toFixed(2) },
};

/* ═══════════ 저장소 ═══════════ */
const LS = { cre:'adc_creatives', rec:'adc_records', period:'adc_period', view:'adc_listview', pt:'adc_ptest' };
function lsGet(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch(e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) { toast('저장 실패 — 저장 공간이 가득 찼을 수 있어요'); } }

let creatives = lsGet(LS.cre, []);
let records   = lsGet(LS.rec, []);   // {cid, date:'YYYY-MM-DD', spend, imp, clicks, purch, value}
function saveAll() { lsSet(LS.cre, creatives); lsSet(LS.rec, records); updateHdr(); }
function updateHdr() { $('hdr-count').textContent = '소재 ' + creatives.length + '개 · 기록 ' + records.length + '건'; }
const creById = id => creatives.find(c => c.id === id);
function newId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* ═══════════ 기간 ═══════════ */
function getPeriod() {
  const p = lsGet(LS.period, null);
  if (p && p.s && p.e) return p;
  return { s: todayStr(-6), e: todayStr(0) };
}
function setPeriod(s, e) { lsSet(LS.period, { s, e }); $('pd-start').value = s; $('pd-end').value = e; rerender(); }
function onPeriodInput() {
  let s = $('pd-start').value, e = $('pd-end').value;
  if (!s || !e) return;
  if (s > e) { const t = s; s = e; e = t; }
  setPeriod(s, e);
}
function setPreset(days) {
  if (days === 0)      setPeriod(todayStr(0), todayStr(0));
  else if (days === 1) setPeriod(todayStr(-1), todayStr(-1));
  else                 setPeriod(todayStr(-(days - 1)), todayStr(0));
}
function setPresetMonth() {
  const d = new Date();
  const s = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-01';
  setPeriod(s, todayStr(0));
}

/* ═══════════ 집계 ═══════════ */
function aggRows(rows) {
  const a = { spend:0, imp:0, clicks:0, purch:0, value:0 };
  for (const r of rows) { a.spend += r.spend||0; a.imp += r.imp||0; a.clicks += r.clicks||0; a.purch += r.purch||0; a.value += r.value||0; }
  return derive(a);
}
function derive(a) {
  a.ctr  = a.imp    ? a.clicks / a.imp * 100 : 0;
  a.cpc  = a.clicks ? a.spend / a.clicks     : 0;
  a.cpm  = a.imp    ? a.spend / a.imp * 1000 : 0;
  a.cpa  = a.purch  ? a.spend / a.purch      : 0;
  a.roas = a.spend  ? a.value / a.spend      : 0;
  return a;
}
function recsFor(cid, s, e) { return records.filter(r => r.cid === cid && r.date >= s && r.date <= e); }
function aggFor(cid, s, e)  { return aggRows(recsFor(cid, s, e)); }
function aggTotal(s, e)     { return aggRows(records.filter(r => r.date >= s && r.date <= e)); }
function aggLifetime(cid)   { return aggRows(records.filter(r => r.cid === cid)); }
/* 기간 내 일별 시계열 (지표별) */
function dailySeries(s, e, cid) {
  const days = [];
  for (let d = s; d <= e; d = nextDay(d)) days.push(d);
  const map = {};
  for (const d of days) map[d] = { spend:0, imp:0, clicks:0, purch:0, value:0 };
  for (const r of records) {
    if (r.date < s || r.date > e) continue;
    if (cid && r.cid !== cid) continue;
    const m = map[r.date]; if (!m) continue;
    m.spend += r.spend||0; m.imp += r.imp||0; m.clicks += r.clicks||0; m.purch += r.purch||0; m.value += r.value||0;
  }
  return { days, rows: days.map(d => derive(map[d])) };
}
function nextDay(ds) { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); }

/* ═══════════ 메뉴 ═══════════ */
let curMenu = 'home';
/* 접히는 메뉴 묶음 (2026-09-11: 분석 = 대시보드·소재 비교, 기본 접힘) — 상태는 브라우저에 기억 */
function menuGroupToggle(id, force) {
  const box = $('mg-' + id), open = force !== undefined ? force : box.style.display === 'none';
  box.style.display = open ? 'flex' : 'none';
  $('mg-' + id + '-h').querySelector('i').className = `fa-solid fa-chevron-${open ? 'down' : 'right'}`;
  if (force === undefined) lsSet('adc_mg_' + id, open);
}
const ADMGR_SOLO = { atest: 'test', abest: 'best' };   // 소재 메뉴의 단독 화면 → 광고관리자 섹션을 그 탭만으로 (2026-09-11)
/* 폰 메뉴 서랍(≤900px, 2026-09-11) — 헤더 ☰·하단 '더보기'로 열고, 덮개 클릭·ESC·메뉴 선택으로 닫힘. 데스크톱은 CSS가 서랍 규칙을 안 켜므로 무영향 */
function menuDrawer(open) {
  document.body.classList.toggle('menu-open', !!open);
  document.body.style.overflow = open ? 'hidden' : '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('menu-open')) menuDrawer(false); });
function showMenu(key) {
  if (typeof dnrbPerms === 'function' && dnrbPerms() && !(dnrbPerms().menus || []).includes(key)) { toast('이 메뉴는 권한이 없어요'); return; }
  menuDrawer(false);
  curMenu = key;
  if ((key === 'home' || key === 'compare') && $('mg-analysis').style.display === 'none') menuGroupToggle('analysis', true);   // 접힌 묶음 안 메뉴로 가면 펼쳐서 활성 표시가 보이게
  const sec = ADMGR_SOLO[key] ? 'admgr' : key;
  document.querySelectorAll('.page-sec').forEach(el => el.style.display = 'none');
  $('sec-' + sec).style.display = 'block';
  document.querySelectorAll('.menu-item').forEach(b => b.classList.toggle('active', b.dataset.menu === key));
  // 광고관리자는 Meta 프리셋 기간을 따로 쓰므로 공통 기간 바를 숨긴다
  $('period-bar').style.display = (sec === 'admgr' || key === 'perf' || key === 'upload') ? 'none' : 'flex';
  rerender();
}
function rerender() {
  const p = getPeriod();
  if (curMenu === 'home') renderHome(p);
  else if (curMenu === 'ptest') renderPTest();
  else if (curMenu === 'compare') renderCompare(p);
  else if (curMenu === 'admgr') admgrOpen();
  else if (ADMGR_SOLO[curMenu]) admgrSolo(ADMGR_SOLO[curMenu]);
  else if (curMenu === 'upload') renderUpload();
  else if (curMenu === 'perf') perfMenuInit();
  else if (curMenu === 'data') renderData();
}

/* ═══════════ 차트 관리 ═══════════ */
const charts = {};
function mkChart(key, canvasId, cfg) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
  const el = $(canvasId); if (!el || typeof Chart === 'undefined') return;
  charts[key] = new Chart(el.getContext('2d'), cfg);
}

/* ═══════════ 토스트 · 초기화 ═══════════ */
var toastTimer = null;   // var 필수 — 스크립트 상단(lsSet 실패 등)에서 toast가 불려도 TDZ 크래시가 없도록
var toastLast = { msg: '', at: 0 };
function toast(msg, cls) {
  const t = $('toast'); if (!t) return;
  const err = cls === 'err' || /실패|오류|에러|error/i.test(msg);   // ponytail: 문구로 실패 판별 — 기존 호출 40여 곳을 안 고치고 빨간색·6초로 승격
  if (err && msg === toastLast.msg && Date.now() - toastLast.at < 6000) return;   // 같은 오류가 반복(타이머·렌더 루프)돼도 알림은 한 번
  toastLast = { msg, at: Date.now() };
  t.textContent = msg; t.classList.toggle('err', err); t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), err ? 6000 : 2600);
  if (err) logError(msg);
}
/* 조용한 실패 방지 (2026-09-08 1단계): 어디서든 잡히지 않은 오류는 반드시 화면에 보인다 */
const errText = r => !r ? '알 수 없음' : typeof r === 'string' ? r : r.message || (() => { try { return JSON.stringify(r); } catch { return String(r); } })();
window.addEventListener('error', e => { if (e.message === 'Script error.') return; toast('오류: ' + (e.message || '알 수 없음'), 'err'); logError(e.message, e.error && e.error.stack); });   // 'Script error.' = 외부 스크립트의 내용 없는 오류
window.addEventListener('unhandledrejection', e => { toast('오류: ' + errText(e.reason), 'err'); logError(errText(e.reason), e.reason && e.reason.stack); });

/* ═══════════ 운영 (2026-09-08 3단계): 오류 서버 기록 · 브라우저 데이터 서버 백업 ═══════════
   서버 함수 client-log (deploy-client-log.sh). 둘 다 실패해도 화면 기능엔 영향 없음 — 조용히 넘긴다. */
var __errSeen = {};   // ponytail: 같은 문구 30초 내 1번만 전송 (렌더 루프에서 같은 오류가 반복돼도 서버를 안 때린다)
function logError(message, stack) {
  try {
    if (!message || typeof sbCall !== 'function' || !admgrCfg() || !(typeof AUTH === 'object' && AUTH.me)) return;
    const now = Date.now(); if (__errSeen[message] > now - 30000) return; __errSeen[message] = now;
    sbCall('client-log', { action: 'error' }, { message: String(message), stack: stack ? String(stack) : null, url: location.href }).catch(() => {});
  } catch { /* 기록 실패는 무시 */ }
}
/* 백업 대상 = 사용자가 만든 데이터(adc_*) — PIN과 서버에서 받아둔 캐시는 제외 */
const BACKUP_SKIP = /^adc_(admgr_(pin|last|test|off|best|products)|reg_pin)$/;
function backupPayload() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('adc_') && !BACKUP_SKIP.test(k)) out[k] = localStorage.getItem(k); }
  return out;
}
async function backupToServer(force) {
  const today = todayStr(0);
  if (!force && lsGet('adc_backup_day', '') === today) return null;   // 하루 1회
  if (!admgrCfg() || !AUTH.me) return null;
  const d = await sbCall('client-log', { action: 'backup' }, { payload: backupPayload() });
  lsSet('adc_backup_day', today);
  return d;
}
async function restoreFromServer(day) {
  const { payload } = await sbCall('client-log', { action: 'backup', day });
  if (!confirm(`${day} 서버 백업으로 이 브라우저의 소재·기록·체크보드를 교체할까요? (지금 데이터는 먼저 서버에 한 번 더 저장해 둡니다)`)) return;
  try { await backupToServer(true); } catch (e) { if (!confirm('현재 데이터 저장에 실패했어요: ' + e.message + '\n그래도 복원할까요?')) return; }
  for (const [k, v] of Object.entries(payload)) localStorage.setItem(k, v);
  toast('복원했어요 — 새로고침합니다'); setTimeout(() => location.reload(), 800);
}

document.addEventListener('DOMContentLoaded', async () => {
  const p = getPeriod();
  $('pd-start').value = p.s; $('pd-end').value = p.e;
  updateHdr();
  menuGroupToggle('analysis', !!lsGet('adc_mg_analysis', false));
  showMenu('ptest');   // 첫 화면 = 소재 업로드 (2026-09-11: 분석 메뉴는 CSV 기반 옛 기능이라 접어 둠)
  await authInit();
  backupToServer().then(d => { if (d) console.info('서버 백업 완료', d.day, d.bytes + 'B'); }).catch(e => console.warn('서버 백업 실패', e.message));   // 하루 1회, 실패해도 조용히(콘솔만)
});
