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
  ptPull().then(ch => { if (ch) renderPTest(); });   // 계정 공유본 (1분에 1번) — 바뀌었으면 다시 그림
  ptSyncNote();
  if (!pt.products.length && (pt.hidden || []).length) pt.hidden = [];   // 보드가 비었는데 숨김만 남은 상태(전체 삭제 직후 등) → 자동 복구
  if ($('pt-tools') && !$('pt-tools').dataset.init) { $('pt-tools').dataset.init = '1'; ptToolsToggle(!!lsGet('adc_pt_tools_open', false)); }
  ptBackfillCreated();
  if (!reg.list && !reg.listLoading && admgrCfg()) regRefresh();   // 등록 기록은 서버에서 (처음 한 번, 이후 새로고침 버튼)
  regSyncBoard(); ptRegIdx = regBoardIndex();
  if (reg.list) regRenderList();
  const N = pt.types.length;
  const doneAll = pt.products.filter(p => N && ptDone(p) === N).length;
  const partial = pt.products.filter(p => ptDone(p) > 0 && ptDone(p) < N).length;
  const none = pt.products.length - doneAll - partial;
  const totalCells = pt.products.length * N;
  const runCells = pt.products.reduce((s, p) => s + ptDone(p), 0);

  /* 요약 타일 */
  $('pt-summary').innerHTML = pt.products.length ? `
    <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:16px;">
      <div class="kpi-tile kt-hero"><div class="kt-label"><i class="fa-solid fa-box"></i> 상품</div>
        <div class="kt-value">${pt.products.length}개</div><div class="kt-sub">소재 유형 ${N}종</div></div>
      <div class="kpi-tile"><div class="kt-label"><i class="fa-solid fa-circle-check" style="color:#15803d;"></i> 전 유형 진행</div>
        <div class="kt-value">${doneAll}개</div><div class="kt-sub">모든 소재 진행중</div></div>
      <div class="kpi-tile"><div class="kt-label"><i class="fa-solid fa-circle-half-stroke" style="color:#d97706;"></i> 일부 진행</div>
        <div class="kt-value">${partial}개</div><div class="kt-sub">진행 안 한 유형 남음</div></div>
      <div class="kpi-tile"><div class="kt-label"><i class="fa-regular fa-circle" style="color:#9ca3af;"></i> 미진행</div>
        <div class="kt-value">${none}개</div><div class="kt-sub">아직 진행 소재 없음</div></div>
      <div class="kpi-tile"><div class="kt-label"><i class="fa-solid fa-chart-pie"></i> 전체 진행률</div>
        <div class="kt-value">${totalCells ? Math.round(runCells / totalCells * 100) : 0}%</div>
        <div class="kt-sub">${runCells}/${totalCells} 칸 진행중</div></div>
    </div>` : '';

  /* 필터 칩 */
  $('pt-tabs').innerHTML = `
    <button class="filter-tab ${ptFilter==='all'?'active':''}" onclick="setPtFilter('all')">전체 ${pt.products.length}</button>
    <button class="filter-tab ${ptFilter==='todo'?'active':''}" onclick="setPtFilter('todo')">미완료 ${partial + none}</button>
    <button class="filter-tab ${ptFilter==='done'?'active':''}" onclick="setPtFilter('done')">전 유형 진행 ${doneAll}</button>`;

  let rows = pt.products;
  if (ptFilter === 'todo') rows = rows.filter(p => !N || ptDone(p) < N);
  else if (ptFilter === 'done') rows = rows.filter(p => N && ptDone(p) === N);

  const body = $('pt-body');
  ptSelBtn();
  if (!pt.products.length) {
    body.innerHTML = `<div class="empty-state"><div class="es-icon"><i class="fa-solid fa-clipboard-check"></i></div>
      <p>위에서 <b>상품을 추가</b>하면 소재 유형별 체크보드가 만들어져요.</p></div>`;
    return;
  }
  if (!rows.length) {
    body.innerHTML = `<div class="empty-state" style="padding:32px;"><p>조건에 맞는 상품이 없어요.</p></div>`;
    return;
  }
  const total = rows.length, pages = Math.ceil(total / ptPer);
  if (ptPage > pages) ptPage = pages;
  const from = (ptPage - 1) * ptPer;
  rows = rows.slice(from, from + ptPer);
  const pager = `<div style="display:flex;align-items:center;gap:10px;margin-top:12px;font-size:.8rem;color:#6b7280;">
    <span>${total}개 중 ${from + 1}–${from + rows.length}</span>
    <select class="inp" style="width:auto;padding:4px 8px;font-size:.8rem;background:#fff;" onchange="setPtPer(this.value)">
      ${[10,20,30,50,100].map(n => `<option value="${n}" ${n===ptPer?'selected':''}>${n}개씩</option>`).join('')}</select>
    <span style="margin-left:auto;display:flex;align-items:center;gap:6px;">
      <button class="btn-ghost" style="padding:3px 10px;" ${ptPage<=1?'disabled':''} onclick="setPtPage(${ptPage-1})">‹</button>
      <b>${ptPage} / ${pages}</b>
      <button class="btn-ghost" style="padding:3px 10px;" ${ptPage>=pages?'disabled':''} onclick="setPtPage(${ptPage+1})">›</button></span></div>`;

  const cellHtml = (p, t) => {
    const rc = regCellFor(ptRegIdx, p, t);
    if (rc) return `<span class="status-badge ${rc.run ? 'badge-green' : 'badge-blue'}">${rc.run ? '진행중' : '제작완료'}</span><span class="pt-date" title="소재 등록 ${rc.n}개 · 광고 생성 ${rc.run}개">${rc.n}개 · ${fmtMD(rc.latest)}</span>`;
    const c = p.cells[t];
    if (!c) return `<span class="pt-empty" title="클릭 → 제작완료"></span>`;
    if (c.st === 'made') return `<span class="status-badge badge-blue">제작완료</span><span class="pt-date">${fmtMD(c.date)}</span>`;
    return `<span class="status-badge badge-green">진행중</span><span class="pt-date">${fmtMD(c.date)}</span>`;
  };

  body.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th style="width:28px;"><input type="checkbox" title="이 페이지 전체 선택" onchange="ptSelPage(this.checked)" /></th>
      <th style="text-align:left;">상품명</th><th title="카페24 상품 등록일">등록일</th>
      ${pt.types.map((t, ti) => `<th>${esc(t)}<button class="pt-th-x" title="'${esc(t)}' 유형 삭제" onclick="ptDelType(${ti})"><i class="fa-solid fa-xmark"></i></button></th>`).join('')}
      <th>진행률</th><th></th>
    </tr></thead>
    <tbody>${rows.map(p => {
      const done = ptDone(p);
      return `<tr>
        <td><input type="checkbox" value="${p.id}" ${ptSel.has(p.id)?'checked':''} onchange="ptSelToggle(this.value, this.checked)" /></td>
        <td class="name-cell" style="font-weight:700;">${esc(p.name)}</td>
        <td style="text-align:center;font-size:.76rem;color:#6b7280;white-space:nowrap;">${fmtYMD(p.created)}</td>
        ${pt.types.map((t, ti) => regCellFor(ptRegIdx, p, t) ? `<td class="pt-cell" title="소재 등록 기록으로 자동 표시 — 클릭으로 못 바꿔요">${cellHtml(p, t)}</td>` : `<td class="pt-cell" onclick="ptCycle('${p.id}',${ti})">${cellHtml(p, t)}</td>`).join('')}
        <td><span class="pt-prog-wrap"><span class="pt-prog-bar"><span class="pt-prog-fill" style="width:${N ? done / N * 100 : 0}%;"></span></span>
          <b style="font-size:.78rem;">${done}/${N}</b></span></td>
        <td><button class="btn-ghost btn-danger-ghost" style="padding:3px 9px;font-size:.7rem;" onclick="ptDelProduct('${p.id}')"><i class="fa-solid fa-xmark"></i></button></td>
      </tr>`; }).join('')}</tbody>
  </table></div>${pager}
  <p style="font-size:.75rem;color:#9ca3af;margin-top:10px;line-height:1.7;">
    칸을 클릭할 때마다 <b>— → 제작완료 → 진행중 → 해제</b> 순서로 바뀌고, 바꾼 날짜가 함께 기록돼요.
    소재 유형 열은 위의 <b>소재 유형 추가</b>로 자유롭게 늘릴 수 있어요 (예: 후킹영상, 카드뉴스).</p>`;
  ptSelBtn();
}
