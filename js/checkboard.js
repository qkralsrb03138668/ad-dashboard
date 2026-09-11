/* ④-2 광고소재 대시보드 (상품 × 소재유형 체크보드)
   (index.html에서 분리 — 2026-09-08 2단계. 파일 순서는 index.html의 <script> 순서, 전역 함수·변수를 그대로 공유) */
'use strict';

/* ═══════════ ④-2 광고소재 대시보드 (상품별 소재 테스트 체크보드) ═══════════
   pt = { types: ['스토리','릴스', ...],
          products: [{ id, name, product_no?, created?(카페24 등록일), cells: { 유형명: {st:'made'|'run', date:'YYYY-MM-DD'} } }] }
   칸 클릭 순환: 없음 → made(제작완료) → run(진행중) → 없음                              */
let pt = lsGet(LS.pt, null);
if (!pt) { pt = ptSampleData(); lsSet(LS.pt, pt); }   // 최초 1회 예시 데이터
if (!lsGet('adc_pt_mig_thumb', false)) {   // 2026-09-10: '썸네일릴스' 열 제거 (1회) — 다시 추가하면 유지됨
  pt.types = pt.types.filter(t => t !== '썸네일릴스'); for (const p of pt.products) delete p.cells['썸네일릴스'];
  lsSet(LS.pt, pt); lsSet('adc_pt_mig_thumb', true);
}
let ptSel = new Set(), ptFilter = 'all', ptPage = 1, ptPer = Number(lsGet('adc_pt_per', 20)) || 20;

/* ═══ 계정 공유 (2026-09-11): 보드(pt)는 서버 shared_state 'pt'에 저장 — 관리자·마케터·워크스페이스 SSO 어느 계정으로 들어와도 같은 보드.
   브라우저 저장은 사본(오프라인·미연동용). 서버에 보드가 있으면 서버가 우선, 비어 있으면 이 브라우저의 보드(예시 데이터 제외)를 첫 공유본으로 올린다.
   저장은 0.8초 묶음 전송, 저장 전 버전(ver) 비교 — 다른 사람이 먼저 바꿨으면 서버 최신본으로 교체하고 알린다(덮어쓰기 없음). 열람 중엔 1분마다 새로 받는다. */
const PT_PULL_MS = 60000;
let ptSrv = { at: 0, ver: null, by: null, timer: null };
function ptShared() { return typeof sbCall === 'function' && typeof admgrCfg === 'function' && !!admgrCfg() && typeof AUTH === 'object' && !!AUTH.me; }
function ptApplyServer(d) {   // 서버 본으로 교체 → 바뀐 게 있으면 true
  const changed = d.ver !== ptSrv.ver;
  ptSrv.ver = d.ver; ptSrv.by = d.updated_by;
  if (changed) { pt = d.data; lsSet(LS.pt, pt); ptSel.clear(); }
  return changed;
}
function ptSyncNote() {
  const el = $('pt-sync'); if (!el) return;
  const at = ptSrv.ver && !isNaN(Date.parse(ptSrv.ver)) ? new Date(ptSrv.ver).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';   // 서버 ver(UTC ISO) → 보는 사람 시간대
  el.textContent = !ptShared() ? '이 브라우저에만 저장' : ptSrv.ver ? `계정 공유 · 마지막 저장 ${ptSrv.by || ''} ${at}` : '계정 공유';
}
async function ptPull(force) {
  if (!ptShared() || (!force && Date.now() - ptSrv.at < PT_PULL_MS)) return false;
  ptSrv.at = Date.now();
  let d;
  try { d = await sbCall('client-log', { action: 'state_get', key: 'pt' }); }
  catch (e) { console.warn('체크보드 서버 조회 실패', e.message); return false; }   // 미배포·오프라인 → 브라우저 사본으로 계속
  const changed = d.data ? ptApplyServer(d) : false;
  if (!d.data && !pt.sample) ptPush();   // 서버가 비어 있음 → 이 브라우저의 보드가 첫 공유본
  ptSyncNote();
  return changed;
}
async function ptPush() {
  if (!ptShared() || pt.sample) return;   // 예시 보드는 절대 공유본으로 올리지 않음
  try {
    const d = await sbCall('client-log', { action: 'state_set' }, { key: 'pt', data: pt, base: ptSrv.ver });
    if (d.conflict) { ptApplyServer(d); renderPTest(); toast(`${d.updated_by || '다른 사람'}이(가) 먼저 바꿔서 최신 보드를 불러왔어요 — 방금 한 것은 다시 해 주세요`, 'err'); return; }
    ptSrv.ver = d.ver; ptSrv.by = AUTH.me.name || AUTH.me.email; ptSyncNote();
  } catch (e) { toast('체크보드 서버 저장 실패: ' + e.message + ' — 이 브라우저에는 저장됐어요'); }
}
function ptSave() {
  delete pt.sample;   // 사용자가 손댄 보드는 더 이상 예시가 아님
  lsSet(LS.pt, pt);
  clearTimeout(ptSrv.timer); ptSrv.timer = setTimeout(ptPush, 800);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && curMenu === 'ptest') ptPull().then(ch => { if (ch) renderPTest(); }); });
/* 삭제한 상품 기억(pt.hidden) — 등록 소재가 있는 상품은 보드에 자동 추가되므로, 지운 건 다시 안 올라오게 */
function ptHide(products) { pt.hidden = pt.hidden || []; for (const p of products) if (p.product_no && !pt.hidden.includes(p.product_no)) pt.hidden.push(p.product_no); }
function ptUnhide(no) { if (pt.hidden) pt.hidden = pt.hidden.filter(x => x !== no); }
function ptUnhideAll() {
  const n = (pt.hidden || []).length; if (!n) { toast('숨긴 상품이 없어요'); return; }
  pt.hidden = []; ptSave(); renderPTest(); toast(`숨겼던 상품 ${n}개를 다시 표시해요 (소재가 등록된 상품만 올라와요)`);
}
/* 상품·유형 관리 도구 접기/펼치기 (기본 접힘, 브라우저에 기억) */
function ptToolsToggle(force) {
  const open = force !== undefined ? force : $('pt-tools').style.display === 'none';
  $('pt-tools').style.display = open ? 'flex' : 'none';
  $('pt-tools-toggle').innerHTML = `<i class="fa-solid fa-chevron-${open ? 'down' : 'right'}"></i> 상품·유형 관리`;
  if (force === undefined) lsSet('adc_pt_tools_open', open);
}
function ptSampleData() {
  const d = n => todayStr(-n);
  return {
    sample: true,   // 예시 데이터 표시 — 서버 공유본으로 올리지 않음 (사용자가 손대면 ptSave가 지움)
    types: ['스토리', '릴스'],
    products: [
      { id: newId(), name: '클레르 블라우스',   created: d(40), cells: { '스토리': { st:'run',  date:d(12) }, '릴스': { st:'made', date:d(3) } } },
      { id: newId(), name: '내티 원피스',       created: d(33), cells: { '스토리': { st:'run',  date:d(15) }, '릴스': { st:'run',  date:d(7) } } },
      { id: newId(), name: '프레시 훌 티셔츠',  created: d(20), cells: { '스토리': { st:'made', date:d(4) } } },
      { id: newId(), name: '모튼 가디건',       created: d(9),  cells: { '릴스': { st:'made', date:d(1) } } },
      { id: newId(), name: '센느 후드 원피스',  created: d(2),  cells: {} },
    ],
  };
}
function ptAddProduct() {
  const name = $('pt-new-name').value.trim();
  if (!name) { toast('상품명을 입력해 주세요'); return; }
  if (pt.products.some(p => p.name === name)) { toast('이미 있는 상품이에요'); return; }
  pt.products.push({ id: newId(), name, cells: {} });
  $('pt-new-name').value = '';
  ptSave(); renderPTest();
  toast(`'${name}' 상품을 추가했어요`);
}
/* 카페24 진열·판매 중 상품 목록을 모달로 띄우고, 체크한 상품만 체크보드에 추가 (이미 있는 상품은 표시만) */
let ptCafe24Rows = [], ptPickSel = new Set();
async function ptImportCafe24() {
  const btn = $('pt-import-btn'); btn.disabled = true;
  try {
    ptCafe24Rows = (await perfApi({ action: 'products' })).rows.filter(r => r.name);
    ptFillCreated(ptCafe24Rows);
    ptPickSel = new Set(); $('pt-pick-q').value = '';
    renderPtPick(); $('pt-pick-modal').classList.add('show'); $('pt-pick-q').focus();
  } catch (e) { toast('불러오기 실패: ' + e.message); }
  finally { btn.disabled = false; }
}
function ptHas(r) { return pt.products.some(p => p.product_no === r.product_no || p.name === r.name); }
function renderPtPick() {
  const q = $('pt-pick-q').value.trim().toLowerCase();
  const rows = ptCafe24Rows.filter(r => !q || r.name.toLowerCase().includes(q) || String(r.product_no).includes(q));
  $('pt-pick-list').innerHTML = rows.map(r => {
    const has = ptHas(r), on = ptPickSel.has(r.product_no);
    return `<label style="display:flex;align-items:center;gap:10px;padding:7px 6px;border-bottom:1px solid #f1f2f6;cursor:${has ? 'default' : 'pointer'};opacity:${has ? .5 : 1};">
      <input type="checkbox" ${has ? 'disabled' : ''} ${on ? 'checked' : ''} onchange="ptPickToggle(${r.product_no}, this.checked)" />
      ${r.image ? `<img src="${esc(r.image)}" style="width:34px;height:34px;object-fit:cover;border-radius:6px;background:#f3f4f6;" loading="lazy" />` : '<span style="width:34px;height:34px;border-radius:6px;background:#f3f4f6;"></span>'}
      <span style="flex:1;font-size:.84rem;">${esc(r.name)}</span>
      <span style="font-size:.72rem;color:#9ca3af;">${has ? '이미 추가됨' : '#' + r.product_no}</span></label>`;
  }).join('') || '<div style="padding:20px;text-align:center;color:#9ca3af;">검색 결과 없음</div>';
  $('pt-pick-count').textContent = `${rows.length}개 표시 · 전체 ${ptCafe24Rows.length}개`;
  $('pt-pick-add').textContent = `선택한 ${ptPickSel.size}개 추가`;
  $('pt-pick-add').disabled = !ptPickSel.size;
}
function ptPickToggle(no, on) {   // 목록은 다시 그리지 않음 (스크롤·검색 유지)
  on ? ptPickSel.add(no) : ptPickSel.delete(no);
  $('pt-pick-add').textContent = `선택한 ${ptPickSel.size}개 추가`;
  $('pt-pick-add').disabled = !ptPickSel.size;
}
function ptPickAdd() {
  const added = ptCafe24Rows.filter(r => ptPickSel.has(r.product_no) && !ptHas(r))
    .map(r => { ptUnhide(r.product_no); return { id: newId(), name: r.name, product_no: r.product_no, created: r.created || '', cells: {} }; });
  pt.products = [...added, ...pt.products];
  ptSave(); renderPTest(); closeModal('pt-pick-modal');
  toast(`상품 ${added.length}개를 추가했어요`);
}
/* 카페24 등록일 채우기 — 이미 보드에 있던 상품(번호·이름 일치)에 created가 없으면 넣는다 */
function ptFillCreated(rows) {
  let n = 0;
  for (const p of pt.products) {
    if (p.created) continue;
    const r = rows.find(r => (p.product_no && r.product_no === p.product_no) || r.name === p.name);
    if (r && r.created) { p.created = r.created; if (!p.product_no) p.product_no = r.product_no; n++; }
  }
  if (n) lsSet(LS.pt, pt);   // 브라우저 사본만 — 카페24에서 파생된 값이라 공유본(push)을 만들지 않는다 (사용자 조작 아님)
  return n;
}
let ptCreatedTried = false;
async function ptBackfillCreated() {   // 세션당 1회: 등록일 없는 상품이 있으면 조용히 채움 (서버 10분 캐시)
  if (ptCreatedTried || !pt.products.some(p => !p.created) || typeof admgrCfg !== 'function' || !admgrCfg()) return;
  ptCreatedTried = true;
  try { const rows = (await perfApi({ action: 'products', nocache: '1' })).rows; if (ptFillCreated(rows)) renderPTest(); } catch (e) { /* 미연동·오프라인은 무시 */ }   // nocache: 등록일 없는 옛 캐시를 피함
}
const fmtYMD = d => d ? String(d).slice(2, 10).replace(/-/g, '.') : '-';
function ptDelProduct(id) {
  const p = pt.products.find(x => x.id === id); if (!p) return;
  if (!confirm(`'${p.name}' 행을 삭제할까요?`)) return;
  ptHide([p]); pt.products = pt.products.filter(x => x.id !== id);
  ptSave(); renderPTest();
}
function ptAddType() {
  const name = (prompt('추가할 소재 유형 이름 (예: 후킹영상, 카드뉴스)') || '').trim();
  if (!name) return;
  if (pt.types.includes(name)) { toast('이미 있는 유형이에요'); return; }
  pt.types.push(name);
  ptSave(); renderPTest();
}
function ptDelType(ti) {   // 유형은 인덱스로 (이름을 onclick 문자열에 넣으면 따옴표가 든 이름이 스크립트로 새어 나간다)
  const name = pt.types[ti]; if (name == null) return;
  const used = pt.products.filter(p => p.cells[name]).length;
  if (!confirm(`'${name}' 유형 열을 삭제할까요?${used ? ` (체크된 상품 ${used}개의 기록도 지워져요)` : ''}`)) return;
  pt.types = pt.types.filter(t => t !== name);
  for (const p of pt.products) delete p.cells[name];
  ptSave(); renderPTest();
}
function ptCycle(pid, ti) {
  const type = pt.types[ti]; if (type == null) return;
  const p = pt.products.find(x => x.id === pid); if (!p) return;
  const cur = p.cells[type] ? p.cells[type].st : null;
  if (cur === null)        p.cells[type] = { st: 'made', date: todayStr(0) };
  else if (cur === 'made') p.cells[type] = { st: 'run',  date: todayStr(0) };
  else                     delete p.cells[type];
  ptSave(); renderPTest();
}
/* 칸 상태 = 소재 등록 기록(자동, 우선) 또는 수동 클릭 */
let ptRegIdx = new Map();
function ptCellState(p, t) {
  const c = regCellFor(ptRegIdx, p, t);
  if (c) return c.run ? 'run' : 'made';
  return p.cells[t] ? p.cells[t].st : null;
}
function ptDone(p) { return pt.types.filter(t => ptCellState(p, t) === 'run').length; }
function setPtFilter(v) { ptFilter = v; ptPage = 1; renderPTest(); }
function setPtPer(v) { ptPer = Number(v); lsSet('adc_pt_per', ptPer); ptPage = 1; renderPTest(); }
function setPtPage(n) { ptPage = n; renderPTest(); }
function ptSelToggle(id, on) { on ? ptSel.add(id) : ptSel.delete(id); ptSelBtn(); }
function ptSelPage(on) {   // 현재 페이지 행 전체 선택/해제
  for (const cb of document.querySelectorAll('#pt-body tbody input[type=checkbox]')) { cb.checked = on; on ? ptSel.add(cb.value) : ptSel.delete(cb.value); }
  ptSelBtn();
}
function ptSelBtn() {
  const b = $('pt-del-sel'); b.disabled = !ptSel.size;
  b.innerHTML = `<i class="fa-solid fa-square-check"></i> 선택 삭제${ptSel.size ? ` (${ptSel.size})` : ''}`;
}
function ptDelSel() {
  if (!ptSel.size || !confirm(`선택한 상품 ${ptSel.size}개를 삭제할까요?`)) return;
  ptHide(pt.products.filter(p => ptSel.has(p.id))); pt.products = pt.products.filter(p => !ptSel.has(p.id));
  ptSel.clear(); ptSave(); renderPTest(); toast('선택한 상품을 삭제했어요');
}
function ptDelAll() {
  if (!pt.products.length) return;
  if (!confirm(`상품 ${pt.products.length}개를 전부 삭제할까요? 체크 기록도 모두 지워져요.\n(소재가 등록된 상품은 자동으로 다시 표시돼요)`)) return;
  pt.products = []; pt.hidden = []; ptPage = 1; ptSel.clear();   // 전체 삭제 = 초기화 (숨김도 해제 → 등록 소재 있는 상품은 다시 올라옴)
  ptSave(); renderPTest(); toast('상품을 전부 삭제했어요 — 소재가 등록된 상품은 자동으로 다시 표시돼요');
}

function renderPTest() {
  if (typeof regStepsRender === 'function') { regStepsRender(); regTagsRender(); if (reg.products) regRecentRender(); }
  ptPull().then(ch => { if (ch) renderPTest(); });   // 계정 공유본 (1분에 1번) — 바뀌었으면 다시 그림
  ptSyncNote();
  if (!pt.products.length && (pt.hidden || []).length) pt.hidden = [];   // 보드가 비었는데 숨김만 남은 상태(전체 삭제 직후 등) → 자동 복구
  if ($('pt-tools') && !$('pt-tools').dataset.init) { $('pt-tools').dataset.init = '1'; ptToolsToggle(!!lsGet('adc_pt_tools_open', false)); }
  ptBackfillCreated();
  if (!reg.list && !reg.listLoading && admgrCfg()) regRefresh();   // 등록 기록은 서버에서 (처음 한 번, 이후 새로고침 버튼)
  regSyncBoard(); ptRegIdx = regBoardIndex();
  if (reg.list) regRenderList();
  const N = pt.types.length;
  const today = todayStr(0), dayDiff = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);
  const info = p => {   // 행 요약: 등록 소재 수·대기 수·마지막 활동·신상품 여부
    const rows = ptRegRows(p);
    const latest = rows.reduce((m, r) => { const d = (r.ad_created_at || r.created_at || '').slice(0, 10); return d > m ? d : m; }, '');
    return { rows, n: rows.length, waiting: rows.filter(r => r.status === 'registered').length, latest, ago: latest ? dayDiff(today, latest) : null,
      isNew: !!p.created && dayDiff(today, p.created) <= 30, noStory: !regCellFor(ptRegIdx, p, '스토리'), noReels: !regCellFor(ptRegIdx, p, '릴스') };
  };
  const all = pt.products.map(p => ({ p, ...info(p) }));
  const cnt = {
    newnone: all.filter(x => x.isNew && !x.n).length,
    waiting: all.filter(x => x.waiting).length,
    week: (reg.list || []).filter(r => dayDiff(today, (r.created_at || '').slice(0, 10)) <= 7).length,
    stale: all.filter(x => (x.n && x.ago > 30) || (!x.n && p_old(x.p))).length,
    none: all.filter(x => !x.n).length, nostory: all.filter(x => x.noStory).length, noreels: all.filter(x => x.noReels).length, new30: all.filter(x => x.isNew).length,
  };
  function p_old(p) { return !!p.created && dayDiff(today, p.created) > 30; }

  /* 요약 타일 — 누르면 그 조건으로 걸러짐 */
  const tile = (key, icon, color, label, value, sub) => `<div class="kpi-tile ${ptFilter === key ? 'kt-hero' : ''}" style="cursor:pointer;" onclick="setPtFilter('${key}')" title="누르면 이 조건으로 걸러요">
      <div class="kt-label"><i class="${icon}" style="color:${ptFilter === key ? '#fff' : color};"></i> ${label}</div><div class="kt-value">${value}</div><div class="kt-sub">${sub}</div></div>`;
  $('pt-summary').innerHTML = pt.products.length ? `
    <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:16px;">
      ${tile('all', 'fa-solid fa-box', '#4f46e5', '상품', `${pt.products.length}개`, `소재 등록 ${(reg.list || []).length}건`)}
      ${tile('newnone', 'fa-solid fa-bolt', '#dc2626', '소재 없는 신상품', `${cnt.newnone}개`, '최근 30일 등록인데 소재 0')}
      ${tile('waiting', 'fa-solid fa-hourglass-half', '#d97706', '광고 생성 대기', `${cnt.waiting}개`, `소재 ${all.reduce((s, x) => s + x.waiting, 0)}건 대기 중`)}
      ${tile('week', 'fa-solid fa-calendar-week', '#15803d', '이번 주 등록 소재', `${cnt.week}건`, '최근 7일')}
      ${tile('stale', 'fa-solid fa-moon', '#6b7280', '한 달 넘게 소재 없음', `${cnt.stale}개`, '새 소재가 필요한 상품')}
    </div>` : '';

  /* 필터 칩 */
  const chips = [['all', `전체 ${pt.products.length}`], ['none', `소재 없음 ${cnt.none}`], ['nostory', `스토리 없음 ${cnt.nostory}`], ['noreels', `릴스 없음 ${cnt.noreels}`], ['new30', `최근 30일 신상품 ${cnt.new30}`], ['waiting', `생성 대기 ${cnt.waiting}`], ['stale', `한 달+ 방치 ${cnt.stale}`]];
  $('pt-tabs').innerHTML = chips.map(([k, l]) => `<button class="filter-tab ${ptFilter === k ? 'active' : ''}" onclick="setPtFilter('${k}')">${l}</button>`).join('');

  let list = all;
  if (ptFilter === 'none') list = all.filter(x => !x.n);
  else if (ptFilter === 'nostory') list = all.filter(x => x.noStory);
  else if (ptFilter === 'noreels') list = all.filter(x => x.noReels);
  else if (ptFilter === 'new30') list = all.filter(x => x.isNew);
  else if (ptFilter === 'newnone') list = all.filter(x => x.isNew && !x.n);
  else if (ptFilter === 'waiting') list = all.filter(x => x.waiting);
  else if (ptFilter === 'week') list = all.filter(x => x.rows.some(r => dayDiff(today, (r.created_at || '').slice(0, 10)) <= 7));
  else if (ptFilter === 'stale') list = all.filter(x => (x.n && x.ago > 30) || (!x.n && p_old(x.p)));
  /* 정렬: 기본 등록일 최신순 */
  const dir = ptSort.dir === 'asc' ? 1 : -1;
  list = [...list].sort((a, b) => {
    if (ptSort.key === 'name') return dir * coreName(a.p.name).localeCompare(coreName(b.p.name), 'ko');
    if (ptSort.key === 'last') return dir * ((a.latest || '').localeCompare(b.latest || ''));
    return dir * ((a.p.created || '').localeCompare(b.p.created || ''));
  });

  const body = $('pt-body');
  ptSelBtn();
  if (!pt.products.length) {
    body.innerHTML = `<div class="empty-state"><div class="es-icon"><i class="fa-solid fa-clipboard-check"></i></div>
      <p>위에서 <b>소재를 등록</b>하거나 상품·유형 관리에서 <b>상품을 추가</b>하면 체크보드가 만들어져요.</p></div>`;
    return;
  }
  if (!list.length) {
    body.innerHTML = `<div class="empty-state" style="padding:32px;"><p>조건에 맞는 상품이 없어요.</p></div>`;
    return;
  }
  const total = list.length, pages = Math.ceil(total / ptPer);
  if (ptPage > pages) ptPage = pages;
  const from = (ptPage - 1) * ptPer;
  list = list.slice(from, from + ptPer);
  const pager = `<div style="display:flex;align-items:center;gap:10px;margin-top:12px;font-size:.8rem;color:#6b7280;">
    <span>${total}개 중 ${from + 1}–${from + list.length}</span>
    <select class="inp" style="width:auto;padding:4px 8px;font-size:.8rem;background:#fff;" onchange="setPtPer(this.value)">
      ${[10,20,30,50,100].map(n => `<option value="${n}" ${n===ptPer?'selected':''}>${n}개씩</option>`).join('')}</select>
    <span style="margin-left:auto;display:flex;align-items:center;gap:6px;">
      <button class="btn-ghost" style="padding:3px 10px;" ${ptPage<=1?'disabled':''} onclick="setPtPage(${ptPage-1})">‹</button>
      <b>${ptPage} / ${pages}</b>
      <button class="btn-ghost" style="padding:3px 10px;" ${ptPage>=pages?'disabled':''} onclick="setPtPage(${ptPage+1})">›</button></span></div>`;

  const cellHtml = (p, t) => {
    const rc = regCellFor(ptRegIdx, p, t);
    if (rc) return `<span class="status-badge ${rc.run ? 'badge-green' : 'badge-blue'}">${rc.run ? '진행중' : '제작완료'}</span><span class="pt-date">${rc.n}개 · ${fmtMD(rc.latest)}</span>`;
    const c = p.cells[t];
    if (!c) return `<span class="pt-empty" title="클릭 → 제작완료"></span>`;
    if (c.st === 'made') return `<span class="status-badge badge-blue">제작완료</span><span class="pt-date">${fmtMD(c.date)}</span>`;
    return `<span class="status-badge badge-green">진행중</span><span class="pt-date">${fmtMD(c.date)}</span>`;
  };
  const sortTh = (key, label, extra) => `<th ${extra || ''} style="cursor:pointer;${extra ? '' : ''}" onclick="setPtSort('${key}')" title="정렬">${label}${ptSort.key === key ? (ptSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;
  const imgOf = p => { const c = (reg.products || []).find(x => x.product_no === p.product_no) || ptCafe24Rows.find(x => x.product_no === p.product_no); return c ? c.image : ''; };
  const nameHtml = p => {
    const core = coreName(p.name), ver = regVerTag(p.name), parens = (String(p.name).normalize('NFC').match(/\([^()]*\)|\[[^\[\]]*\]/g) || []).join(' ');
    return `<div style="display:flex;gap:10px;align-items:center;min-width:0;">${mediaThumbHtml(imgOf(p), 'image', 40)}
      <div style="min-width:0;"><div style="font-weight:800;color:#1e1b4b;">${ver ? `<span class="status-badge badge-blue" style="font-size:.62rem;margin-right:4px;">${esc(ver)}</span>` : ''}${esc(core)}</div>
      ${parens ? `<div style="font-size:.68rem;color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;">${esc(parens)}</div>` : ''}</div></div>`;
  };
  const agoHtml = x => !x.latest ? '<span style="color:#dc2626;">소재 없음</span>' : x.ago === 0 ? '오늘' : x.ago === 1 ? '어제' : `<span style="${x.ago > 30 ? 'color:#dc2626;' : ''}">${x.ago}일 전</span>`;

  body.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th style="width:28px;"><input type="checkbox" title="이 페이지 전체 선택" onchange="ptSelPage(this.checked)" /></th>
      ${sortTh('name', '상품명', 'style="text-align:left;"').replace('style="cursor:pointer;"', 'style="cursor:pointer;text-align:left;"')}${sortTh('created', '등록일')}
      ${pt.types.map((t, ti) => `<th>${esc(t)}<button class="pt-th-x" title="'${esc(t)}' 유형 삭제" onclick="ptDelType(${ti})"><i class="fa-solid fa-xmark"></i></button></th>`).join('')}
      ${sortTh('last', '마지막 소재')}<th></th>
    </tr></thead>
    <tbody>${list.map(x => { const p = x.p; return `<tr>
        <td><input type="checkbox" value="${p.id}" ${ptSel.has(p.id)?'checked':''} onchange="ptSelToggle(this.value, this.checked)" /></td>
        <td class="name-cell">${nameHtml(p)}</td>
        <td style="text-align:center;font-size:.76rem;color:#6b7280;white-space:nowrap;">${fmtYMD(p.created)}${x.isNew ? '<div><span class="status-badge badge-green" style="font-size:.6rem;">NEW</span></div>' : ''}</td>
        ${pt.types.map((t, ti) => regCellFor(ptRegIdx, p, t) ? `<td class="pt-cell" style="cursor:pointer;" title="클릭 → 이 상품의 ${esc(t)} 소재 목록" onclick="ptCellPopup('${p.id}',${ti})">${cellHtml(p, t)}</td>` : `<td class="pt-cell" onclick="ptCycle('${p.id}',${ti})">${cellHtml(p, t)}</td>`).join('')}
        <td style="text-align:center;font-size:.76rem;white-space:nowrap;">${agoHtml(x)}${x.waiting ? `<div style="font-size:.66rem;color:#d97706;">대기 ${x.waiting}</div>` : ''}</td>
        <td style="white-space:nowrap;"><button class="btn-ghost" style="padding:3px 9px;font-size:.7rem;" title="이 상품으로 소재 등록 (위 등록 영역에 상품이 잡혀요)" onclick="ptUploadFor('${p.id}')"><i class="fa-solid fa-cloud-arrow-up"></i> 소재 올리기</button>
          <button class="btn-ghost btn-danger-ghost" style="padding:3px 9px;font-size:.7rem;" onclick="ptDelProduct('${p.id}')"><i class="fa-solid fa-xmark"></i></button></td>
      </tr>`; }).join('')}</tbody>
  </table></div>${pager}
  <p style="font-size:.75rem;color:#9ca3af;margin-top:10px;line-height:1.7;">
    스토리·릴스 칸은 소재 등록 기록으로 자동 표시되고, 누르면 그 소재 목록이 열려요. 기록이 없는 칸은 클릭할 때마다 <b>— → 제작완료 → 진행중 → 해제</b>로 바뀌어요.
    소재 유형 열은 <b>상품·유형 관리 → 소재 유형 추가</b>로 늘릴 수 있어요.</p>`;
  ptSelBtn();
}

/* ── 보드 부가 기능: 정렬 · 상품의 소재 목록 · 칸 팝업 · 행에서 바로 소재 올리기 ── */
let ptSort = lsGet('adc_pt_sort', null) || { key: 'created', dir: 'desc' };
function setPtSort(key) {
  const first = key === 'name' ? 'asc' : 'desc';   // 이름은 가나다순부터, 날짜는 최신순부터
  ptSort = { key, dir: ptSort.key === key ? (ptSort.dir === first ? (first === 'asc' ? 'desc' : 'asc') : first) : first }; lsSet('adc_pt_sort', ptSort); ptPage = 1; renderPTest();
}
function ptRegRows(p) {
  return (reg.list || []).filter(r => p.product_no ? r.product_no === p.product_no : (r.core_name && normKey(r.core_name) === normKey(p.name)));
}
function ptCellPopup(pid, ti) {
  const p = pt.products.find(x => x.id === pid), t = pt.types[ti]; if (!p || !t) return;
  const kind = Object.keys(REG_KIND_TYPE).find(k => REG_KIND_TYPE[k] === t);
  const rows = ptRegRows(p).filter(r => r.kind === kind).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const act = (window.DASH_CFG && window.DASH_CFG.META_ACCOUNT_ID) || '';
  const tagOf = fn => { const m = String(fn).match(/_(?:R|P)\d+_([^_]+)_\d+_\d{6}_test/); return m ? m[1] : ''; };
  $('pt-cell-title').innerHTML = `${esc(coreName(p.name))} · ${esc(t)} <span style="font-weight:400;color:#6b7280;font-size:.8rem;">${rows.length}개</span>`;
  $('pt-cell-body').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th></th><th style="text-align:left;">파일</th><th>소구점</th><th style="text-align:left;">상태</th><th>등록</th><th>문구</th></tr></thead><tbody>
    ${rows.map(r => `<tr>
      <td>${mediaThumbHtml(mediaThumbSrc(r.media), r.kind, 48)}</td>
      <td style="font-size:.78rem;">${esc(r.file_name)}</td>
      <td style="text-align:center;font-size:.74rem;">${esc(tagOf(r.file_name) || '-')}</td>
      <td style="font-size:.76rem;white-space:nowrap;">${r.status === 'ad_created' ? `<span class="status-badge badge-green">광고 생성됨</span><div style="font-size:.66rem;color:#9ca3af;">${(r.ad_created_at || '').slice(5, 10)} · ${esc(r.ad_created_by || '')}${r.ad_id && act ? ` · <a href="https://adsmanager.facebook.com/adsmanager/manage/ads?act=${act}&selected_ad_ids=${r.ad_id}" target="_blank" rel="noopener">광고관리자 ↗</a>` : ''}</div>` : '<span class="status-badge badge-blue">대기</span>'}</td>
      <td style="text-align:center;font-size:.7rem;color:#6b7280;white-space:nowrap;">${(r.created_at || '').slice(5, 10)}<div>${esc((r.created_by_email || '').split('@')[0])}</div></td>
      <td style="text-align:center;"><button class="btn-ghost" style="padding:2px 8px;font-size:.7rem;" onclick="closeModal('pt-cell-modal');regListText('${r.id}')">${r.text && r.text.message ? '<i class="fa-solid fa-check" style="color:#15803d;"></i> 보기' : '<i class="fa-solid fa-pen"></i> 기입'}</button></td>
    </tr>`).join('')}</tbody></table></div>` : '<div style="padding:16px;color:#9ca3af;">등록된 소재가 없어요</div>';
  $('pt-cell-modal').classList.add('show');
}
async function ptUploadFor(pid) {
  const p = pt.products.find(x => x.id === pid); if (!p) return;
  try { await regPresetInit(); } catch (e) { /* 아래에서 안내 */ }
  const cp = (reg.products || []).find(x => x.product_no === p.product_no) || (reg.products || []).find(x => normKey(x.name) === normKey(p.name));
  if (!cp) { toast('카페24 상품 목록에서 이 상품을 찾지 못했어요 (진열 중 상품만 가능)'); return; }
  regPresetPick(String(cp.product_no));
  const el = $('reg-preset-card'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast(`'${cp.core}'로 잡았어요 — 파일을 올리면 이 상품으로 등록돼요`);
}
