/* ④-3 광고관리자: 예산 변경·예약 목록·PIN·열 표시/너비·최근 변경 이력
   (2026-10-29 정리: 23:45 세팅·원복 승인 화면을 뺌 — 7일 판정으로 바꾼 뒤 10/21·10/26 이후 안 씀. 서버 run_reset·snapshot은 그대로 두어 되살릴 수 있음)
   (index.html에서 분리 — 2026-09-08 2단계. 파일 순서는 index.html의 <script> 순서, 전역 함수·변수를 그대로 공유) */
'use strict';

/* ═══ 예산 직접 변경 (이식 4단계 — 원본 admgrWrite·admgrBudgetPop 그대로) ═══
   ⚠ 실제 돈이 움직이는 기능. 서버(meta-budget)가 DASH_KEY·PIN·상한(30만원)·총예산 거부·전 기록을 강제하고,
   화면은 편의 장치일 뿐이다. PIN은 메모리에만 두고(새로고침하면 다시 인증) 절대 저장하지 않는다. */
async function admgrWriteInit() {
  if (admgr.demo || admgr.write.st) return;
  try {
    admgr.write.st = await metaBudgetCall({ action: 'status' });
    await admgrWritePending();
  } catch { /* 쓰기 기능 없이 표시 (조회 실패는 치명적이지 않음) */ }
}
async function admgrWritePending() {
  try {
    const d = await metaBudgetCall({ action: 'pending' });
    const pend = d.pending || [];
    admgr.write.pendingByObj = new Map(pend.filter(p => p.mode === 'midnight').map(p => [p.object_id, p]));   // 옛 23:45 예약(남은 것) — 예산 배지·예약 목록
    admgr.write.timedByObj = new Map(pend.filter(p => p.mode === 'timed').sort((a, b) => String(b.apply_at).localeCompare(String(a.apply_at))).map(p => [p.object_id, p]));   // 시각 예약(주말 모드) — 대상별 가장 이른 것
    admgr.write.lastPending = d;   // 주말 모드 알림(admgrWeekendRun)이 시각 예약 결과를 본다
    renderAdmgr(true);
  } catch { /* 무시 */ }
}
/* 예산 셀 — 일예산 있는 행은 클릭 편집(연필), 자정 예약이 있으면 배지 */
function admgrBudgetCell(r, level) {
  const w = admgr.write;
  let base = admgrBudget(r);
  if (w.st && w.st.allowed && r.budget > 0 && !admgr.demo && dnrbCan('budget')) {
    /* Meta 광고관리자식: 연필 + 금액, 클릭하면 작은 편집창(취소 · 임시 저장 · 게시) — 2026-09-05 사용자 요청 */
    const d = admgrDraft[r.id];
    const dirty = d && d !== r.budget;
    base = `<span onclick="event.stopPropagation();admgrBudgetPop(event,'${r.id}','${level}')" title="클릭해서 예산 변경" style="cursor:pointer;white-space:nowrap;display:inline-block;text-align:left;">
      <i class="fa-solid fa-pen" style="font-size:.6rem;color:#9ca3af;margin-right:5px;"></i><b>₩${comma(r.budget)}</b><div style="font-size:.62rem;color:#9ca3af;padding-left:16px;">일일</div></span>
      ${dirty ? `<div style="font-size:.6rem;color:#b45309;padding-left:16px;">임시 저장 ₩${comma(d)}</div>` : ''}`;
  }
  const pend = admgrPendOf(r.id);
  if (pend) base += `<div><span class="status-badge badge-yellow" style="margin-top:3px;font-size:.62rem;" title="${admgrPendWhen(pend)}에 자동 반영 예약"><i class="fa-regular fa-clock"></i> ${pend.mode === 'timed' ? admgrPendWhen(pend) : '23:45'} ${won(pend.new_budget)}</span></div>`;
  return base;
}
/* 임시저장 = 브라우저에만 보관하는 예산 메모 (id → 금액). 즉각반영하면 지워진다 */
const admgrDraft = lsGet('adc_admgr_draft', {});
function admgrDraftSave(id, val) {
  const n = Math.round(Number(String(val).replace(/[^0-9]/g, '')));
  if (!(n >= 1000)) { toast('1,000원 이상 입력하세요'); return; }
  admgrDraft[id] = n; lsSet('adc_admgr_draft', admgrDraft);
  toast(`임시저장 ${comma(n)}원 — Meta엔 아직 반영 안 됐어요`); renderAdmgr(true);
}
/* 확인창은 브라우저 confirm() 대신 대시보드 모달로 — Chrome이 "추가 대화상자 차단"을 켜면 confirm이 조용히 취소돼 버튼이 먹통이 되는 실사례 (2026-09-06) */
function admgrConfirmModal(title, bodyHtml, okLabel, onOk) {
  $('abm-title').textContent = title; $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = `<div style="max-height:50vh;overflow:auto;font-size:.8rem;line-height:1.7;color:#374151;">${bodyHtml}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
      <button class="btn-ghost" onclick="closeModal('admgr-budget-modal')">취소</button>
      <button class="btn-analyze" id="abm-ok">${okLabel}</button></div>`;
  $('abm-ok').onclick = () => { closeModal('admgr-budget-modal'); onOk(); };
  $('admgr-budget-modal').classList.add('show');
}
function admgrApplyNow(id, level, val) {
  const w = admgr.write;
  if (!w.pin) { admgrPinPrompt(() => admgrApplyNow(id, level, val)); return; }
  const node = (level === 'campaign' ? admgrRows().camps : admgrRows().sets).find(x => x.id === id); if (!node) return;
  const amount = Math.round(Number(String(val).replace(/[^0-9]/g, '')));
  if (!(amount >= 1000 && amount <= w.st.max_budget)) { toast(`1,000원 ~ ${comma(w.st.max_budget)}원 사이로 입력하세요`); return; }
  $('admgr-bpop').style.display = 'none';   // 편집창 닫기 (PIN 프롬프트가 같은 창을 쓰므로 여기서만)
  admgrConfirmModal('예산 즉시 변경', `<b>${esc(node.name)}</b><br/>일예산 ${won(node.budget)} → <b style="color:#4f46e5;">${won(amount)}</b><br/><span style="color:#9ca3af;font-size:.72rem;">Meta에 즉시 반영되는 실제 예산 변경이에요</span>`, '게시', async () => {
    try {
      await metaBudgetCall({ action: 'apply' }, { object_id: id, object_name: node.name, level, new_budget: amount, pin: w.pin });
      delete admgrDraft[id]; lsSet('adc_admgr_draft', admgrDraft);
      toast(`일예산을 ${comma(amount)}원으로 변경했어요`); admgrFetch(); admgrWritePending();
    } catch (e) { if (String(e.message).includes('PIN')) admgrPinInvalidate(); toast('반영 실패: ' + e.message); }
  });
}
/* ⋯ 메뉴 — 상단 버튼 난립 대신 팝오버 (2026-09-14 리디자인). #admgr-bpop 재사용 */
const admgrPendOf = id => { const w = admgr.write; return (w.pendingByObj && w.pendingByObj.get(id)) || (w.timedByObj && w.timedByObj.get(id)) || null; };   // 예산 칸·편집창에 보일 예약
function admgrPopAt(ev, html, w) {
  const r0 = ev.currentTarget.getBoundingClientRect();
  const pop = $('admgr-bpop'); pop.innerHTML = html; pop.style.display = 'block';
  pop.style.left = Math.max(8, Math.min(r0.right - (w || 270), window.innerWidth - (w || 270) - 12)) + 'px';
  /* 아래 공간이 모자라면 위로 연다 (2026-09-21: 화면 하단 동작 바의 '만든 사람 지정' 메뉴가 아래로 잘리던 문제) — 위도 모자라면 화면 안에만 들어오게 */
  const h = pop.offsetHeight, below = r0.bottom + 6;
  pop.style.top = (below + h <= window.innerHeight - 8 ? below : Math.max(8, Math.min(r0.top - 6 - h, window.innerHeight - h - 8))) + 'px';
}
/* 표 창(예산 조정 후보·빠른 증액)만 넓게 — 닫히면 원래 폭(560px)으로 (2026-10-29 사용자: 결과 칸이 잘려 보기 불편) */
function admgrAbmWide() {
  const m = $('admgr-budget-modal'), b = m.querySelector('.modal-box'); b.style.maxWidth = 'min(980px, calc(100vw - 32px))';
  new MutationObserver((_, o) => { if (!m.classList.contains('show')) { b.style.maxWidth = '560px'; o.disconnect(); } }).observe(m, { attributes: true, attributeFilter: ['class'] });
}
const agItem = (icon, label, onclick, sub) => `<button class="ag-item" onclick="document.getElementById('admgr-bpop').style.display='none';${onclick}"><i class="fa-solid ${icon}"></i><span>${label}${sub ? `<small>${sub}</small>` : ''}</span></button>`;
function admgrMoreMenu(ev) {
  const w = admgr.write, nd = admgrDraftTargets().length, npend = (w.pendingByObj ? w.pendingByObj.size : 0) + (w.timedByObj ? w.timedByObj.size : 0);
  const rect = ev.currentTarget.getBoundingClientRect();
  admgrPopAt(ev, `<div class="ag-menu">
    ${w.st && dnrbCan('budget') ? (w.pin ? agItem('fa-lock-open', '잠그기', 'admgrPinClear()', '다음 예산 변경부터 PIN을 다시 물어요') : agItem('fa-lock', 'PIN 인증', 'admgrPinPrompt()', '한 번 인증하면 이 화면을 열어두는 동안 유효')) : ''}
    ${admgrMobile() ? '' : agItem('fa-table-columns', '열 표시·순서', `admgrColsAnchor={left:${Math.round(rect.left)},bottom:${Math.round(rect.bottom)}};admgrColsMenuRender()`)}
    ${admgrMobile() && !ADMGR_OWN.includes(admgr.view) ? `${agItem(admgr.activeOnly ? 'fa-square-check' : 'fa-square', '활성만 보기', 'admgrToggleActive()', admgr.activeOnly ? '켜져 있거나 오늘 지출이 있는 것만' : '꺼진 것도 전부 보기')}` : ''}
    ${admgrMobile() && admgr.view === 'set' && admgrCfg() && !admgr.demo ? `<div class="ag-menu-sep">만든 사람</div>${admgrMakerMenuItems()}` : ''}
    ${admgrMobile() ? `<div class="ag-menu-sep">다른 탭</div>${agItem('fa-flask', '테스트 소재', "admgrSetView('test')")}${agItem('fa-power-off', 'OFF 광고', "admgrSetView('offad')")}${agItem('fa-star', '베스트', "admgrSetView('best')")}` : ''}
    ${npend ? agItem('fa-list', `예약 목록 (${npend})`, 'admgrMidList()', '주말 모드 감액·원복 등 걸어 둔 예약') : ''}
    ${admgrCfg() && !admgr.demo && dnrbCan('upload') && admgrCopySets().length ? agItem('fa-arrow-up-from-bracket', `끌올 사본 정리 (${admgrCopySets().length})`, 'admgrRepostModal()', '" - 사본" 붙은 세트·광고 이름을 소재 업로드 규칙으로') : ''}
    ${admgrCfg() && !admgr.demo && dnrbCan('upload') ? agItem('fa-clock-rotate-left', '지난 소재 찾기', 'admgrPastModal()', '상품명으로 작년부터 돈 소재 중 효율 좋은 것 → 새 세트로 켜서 다시 테스트 (PIN)') : ''}
    ${admgrCfg() && !admgr.demo && dnrbCan('budget') ? agItem('fa-sliders', '알림 기준', 'admgrAlertCfgModal()', '일예산 상한 · 소재 피로 · 주말 모드 기준 (모든 계정 공유)') : ''}
    ${nd ? agItem('fa-eraser', `임시 저장 전체 취소 (${nd})`, 'admgrClearDrafts()', 'Meta에는 아무 변화 없어요') : ''}
  </div>`);
}
function admgrClearDrafts() {
  const n = Object.keys(admgrDraft).length + Object.keys(admgrSDraft).length;
  admgrConfirmModal('임시 저장 전체 취소', `임시 저장 ${n}개(예산·켜기/끄기)를 전부 지울까요?<br/><span style="color:#9ca3af;font-size:.72rem;">Meta에는 아무 변화 없어요</span>`, '전체 취소', () => {
    Object.keys(admgrDraft).forEach(k => delete admgrDraft[k]);
    Object.keys(admgrSDraft).forEach(k => delete admgrSDraft[k]);
    lsSet('adc_admgr_draft', admgrDraft); lsSet('adc_admgr_sdraft', admgrSDraft); toast('임시 저장을 모두 취소했어요'); renderAdmgr(true);
  });
}
/* 임시 저장 중 현재 표에 있고 금액이 실제와 다른 것만 (캠페인·세트 모두) */
function admgrDraftTargets() {
  const R = admgrRows();
  const out = [];
  for (const [id, amt] of Object.entries(admgrDraft)) {
    const c = R.camps.find(x => x.id === id), s = c ? null : R.sets.find(x => x.id === id);
    const node = c || s; if (!node || !(amt > 0) || amt === node.budget) continue;
    out.push({ id, kind: 'budget', level: c ? 'campaign' : 'adset', name: node.name, from: node.budget, to: amt });
  }
  /* 켜기/끄기 임시 저장 — 현재 상태와 같아졌으면 건너뜀 */
  const R2 = admgrRows();
  for (const [id, d] of Object.entries(admgrSDraft)) {
    const node = (d.level === 'campaign' ? R2.camps : d.level === 'adset' ? R2.sets : R2.ads).find(x => x.id === id);
    if (!node) continue;
    if ((node.status === 'ACTIVE') === (d.status === 'ACTIVE')) { delete admgrSDraft[id]; continue; }
    out.push({ id, kind: 'status', level: d.level, name: node.name, status: d.status });
  }
  return out;
}
async function admgrPublishDrafts() {
  const w = admgr.write;
  if (!w.pin) { admgrPinPrompt(admgrPublishDrafts); return; }
  const targets = admgrDraftTargets();
  if (!targets.length) { toast('게시할 임시 저장이 없어요'); return; }
  const bad = targets.filter(t => t.kind === 'budget' && (t.to < 1000 || t.to > w.st.max_budget));
  if (bad.length) { toast(`상한(${comma(w.st.max_budget)}원)·하한(1,000원)을 벗어난 임시 저장이 ${bad.length}개 있어요 — 고친 뒤 다시 눌러주세요`); return; }
  const lines = targets.map(t => t.kind === 'status'
    ? `· ${esc(t.name)}: <b style="color:${t.status === 'ACTIVE' ? '#1e7b34' : '#c9372c'};">${t.status === 'ACTIVE' ? '켜기' : '끄기'}</b>`
    : `· ${esc(t.name)}: ${comma(t.from)} → <b>${comma(t.to)}</b>`).join('<br/>');
  const capCfg = typeof admgrAlertCfg === 'function' ? admgrAlertCfg() : { cap: 0 }, B = typeof admgrBudgetTotal === 'function' ? admgrBudgetTotal(true) : null;
  const capWarn = B && capCfg.cap > 0 && B.after > capCfg.cap ? `<div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:8px 10px;margin-bottom:8px;font-weight:700;">⚠ 게시하면 켜진 일예산 합계가 ${comma(B.after)}원 — 상한 ${comma(capCfg.cap)}원을 ${comma(B.after - capCfg.cap)}원 넘어요</div>` : '';
  admgrConfirmModal(`임시 저장 ${targets.length}개 게시`, `${capWarn}${lines}<br/><span style="color:#9ca3af;font-size:.72rem;">Meta에 즉시 반영돼요 · 순서대로 처리(개당 1초쯤)</span>`, `${targets.length}개 게시`, async () => {
    /* 진행 중 → 결과 알림창 (2026-09-07 사용자 요청: 적용됐는지 안 됐는지 창으로) */
    const results = [];
    const prog = () => { const el = $('abm-body'); if (el) el.innerHTML = `<div style="font-size:.85rem;padding:8px 0;"><i class="fa-solid fa-spinner fa-spin"></i> Meta에 게시 중… <b>${results.length}/${targets.length}</b><div style="font-size:.72rem;color:#9ca3af;margin-top:6px;">창을 닫지 말고 잠시 기다려 주세요</div></div>`; };
    $('abm-title').textContent = '임시 저장 게시 중'; $('abm-sub').style.display = 'none'; prog(); $('admgr-budget-modal').classList.add('show');
    let stopped = false;
    for (const t of targets) {   // ponytail: 순차 실행 (Meta 호출 한도 배려)
      try {
        if (t.kind === 'status') {
          await metaBudgetCall({ action: 'setstatus' }, { object_id: t.id, object_name: t.name, level: t.level, status: t.status, pin: w.pin });
          delete admgrSDraft[t.id];
        } else {
          await metaBudgetCall({ action: 'apply' }, { object_id: t.id, object_name: t.name, level: t.level, new_budget: t.to, pin: w.pin });
          delete admgrDraft[t.id];
        }
        results.push({ t, ok: true });
      } catch (e) {
        results.push({ t, ok: false, err: e.message });
        if (String(e.message).includes('PIN')) { admgrPinInvalidate(); stopped = true; break; }
      }
      prog();
    }
    lsSet('adc_admgr_draft', admgrDraft); lsSet('adc_admgr_sdraft', admgrSDraft);
    admgrPublishResult(results, targets.length, stopped);
    admgrFetch();
  });
}
/* 게시 결과 알림창 — 항목별 ✓/✗ 와 오류 내용. 실패분은 임시 저장에 그대로 남는다 */
function admgrPublishResult(results, total, stopped) {
  const ok = results.filter(r => r.ok).length, fail = results.length - ok, skipped = total - results.length;
  const what = t => t.kind === 'status' ? (t.status === 'ACTIVE' ? '켜기' : '끄기') : `${comma(t.from)} → ${comma(t.to)}`;
  const lines = results.map(r => `<div style="display:flex;gap:8px;align-items:flex-start;padding:4px 0;border-bottom:1px solid #f3f4f6;">
      <span style="flex:none;font-weight:800;color:${r.ok ? '#15803d' : '#dc2626'};">${r.ok ? '✓' : '✗'}</span>
      <span style="min-width:0;"><b>${esc(r.t.name)}</b> · ${what(r.t)}${r.ok ? '' : `<div style="color:#dc2626;font-size:.72rem;">${esc(r.err || '실패')}</div>`}</span></div>`).join('');
  $('abm-title').textContent = fail || skipped ? `게시 결과 — 성공 ${ok} · 실패 ${fail}${skipped ? ` · 미처리 ${skipped}` : ''}` : `게시 완료 — ${ok}개 모두 Meta에 반영됐어요`;
  $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = `<div style="max-height:50vh;overflow:auto;font-size:.8rem;line-height:1.6;color:#374151;">${lines}</div>
    ${fail || skipped ? `<div class="info-bar" style="margin-top:8px;font-size:.72rem;background:#fef2f2;border-color:#fecaca;color:#991b1b;">${stopped ? 'PIN 오류로 중단됐어요 — 다시 인증한 뒤 ' : '실패·미처리 항목은 임시 저장에 그대로 남아 있어요 — '}<b>임시 저장 전체 게시</b>를 다시 누르면 남은 것만 게시돼요</div>` : ''}
    <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn-analyze" onclick="closeModal('admgr-budget-modal')">확인</button></div>`;
  $('admgr-budget-modal').classList.add('show');
  toast(fail || skipped ? `게시 ${ok}개 성공 · ${fail + skipped}개 실패/미처리` : `게시 완료 ${ok}개`);
}
const admgrBP = { id: null, level: null, name: '', after: null };
function admgrPinPrompt(after) {
  admgrBP.after = after || null;
  const pop = $('admgr-bpop');
  pop.innerHTML = `
    <div style="font-size:.78rem;font-weight:800;color:#1e1b4b;margin-bottom:8px;"><i class="fa-solid fa-lock" style="color:#4f46e5;"></i> 예산 변경 PIN 인증</div>
    <input id="bpop-pin" class="inp" type="password" inputmode="numeric" placeholder="PIN 입력 후 Enter" style="margin-bottom:6px;" onkeydown="if(event.key==='Enter')admgrPinVerify()" />
    <div id="bpop-err" style="display:none;font-size:.68rem;color:#dc2626;margin-bottom:6px;"></div>
    <button class="btn-analyze" style="width:100%;justify-content:center;" onclick="admgrPinVerify()">인증</button>
    <div style="font-size:.64rem;color:#9ca3af;margin-top:6px;">한 번 인증하면 이 화면을 열어두는 동안 계속 유효 · 5회 오류 시 15분 잠금</div>`;
  pop.style.display = 'block';
  pop.style.left = Math.max(8, (window.innerWidth - 270) / 2) + 'px';
  pop.style.top = '150px';
  setTimeout(() => { const p = $('bpop-pin'); if (p) p.focus(); }, 0);
}
async function admgrPinVerify() {
  const pin = (($('bpop-pin') || {}).value || '').trim();
  if (!pin) { admgrBpopErr('PIN을 입력하세요'); return; }
  try {
    await metaBudgetCall({ action: 'verify' }, { pin });
    admgr.write.pin = pin;
    pinSet(pin);   // 잠그기 버튼을 누르기 전까지, 이 탭에서만 유지 (2026-10-26)
    $('admgr-bpop').style.display = 'none';
    toast('PIN 인증 완료 — 잠그기를 누르기 전까지 계속 풀려 있어요');
    const after = admgrBP.after; admgrBP.after = null;
    renderAdmgr(true);
    if (after) after();
  } catch (e) { admgrBpopErr(e.message); }
}
function admgrPinClear() {
  admgr.write.pin = null;
  pinSet(null);
  toast('잠갔어요 — 다음 예산 변경부터 PIN을 다시 물어요'); renderAdmgr(true);
}
/* 서버가 PIN을 거부하면(PIN 변경·잠금) 저장된 것도 지운다 */
function admgrPinInvalidate() { admgr.write.pin = null; pinSet(null); renderAdmgr(true); }
const admgrPendWhen = p => p.mode === 'timed' && p.apply_at ? admgrKst(p.apply_at).toISOString().slice(5, 16).replace('T', ' ') : `${p.apply_date} 23:45`;   // 시각 예약은 'MM-DD HH:MM'
function admgrMidList() {   // 예약 목록 — 시각 예약(주말 모드) + 남아 있는 옛 23:45 예약 (히스토리 모달 껍데기 재사용)
  const w = admgr.write;
  const rows = [...(w.pendingByObj ? w.pendingByObj.values() : []), ...((w.lastPending && w.lastPending.pending) || []).filter(p => p.mode === 'timed')];
  $('abm-title').textContent = '반영 예약 목록'; $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = (rows.length ? `<div class="table-wrap"><table style="font-size:.78rem;">
      <thead><tr><th style="text-align:left;">대상</th><th>현재</th><th>반영값</th><th>적용</th><th></th></tr></thead>
      <tbody>${rows.map(p => `<tr>
        <td class="name-cell" style="text-align:left;">${esc(p.object_name || p.object_id)}<div style="font-size:.64rem;color:#9ca3af;">${p.level === 'campaign' ? '캠페인' : '광고세트'}</div></td>
        <td style="white-space:nowrap;">${p.old_budget ? won(Math.round(p.old_budget)) : '—'}</td>
        <td style="white-space:nowrap;font-weight:800;color:#b45309;">${won(Math.round(p.new_budget))}</td>
        <td style="white-space:nowrap;">${admgrPendWhen(p)}</td>
        <td><button class="btn-ghost btn-danger-ghost" style="padding:2px 10px;font-size:.7rem;" onclick="admgrMidCancel(${p.id})">취소</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state" style="padding:20px;"><p>걸어 둔 예약이 없어요.</p></div>')
    + `<div style="display:flex;gap:6px;margin-top:10px;">
      <button class="btn-ghost" style="flex:1;justify-content:center;" onclick="closeModal('admgr-budget-modal')">닫기</button></div>`;
  $('admgr-budget-modal').classList.add('show');
}
async function admgrMidCancel(pid) {
  if (!admgr.write.pin) { toast('먼저 PIN 인증을 해주세요'); return; }
  try {
    await metaBudgetCall({ action: 'cancel' }, { id: pid, pin: admgr.write.pin });
    toast('예약을 취소했어요');
    await admgrWritePending();
    admgrMidList();
  } catch (e) { toast('취소 실패: ' + e.message); }
}
function admgrBudgetPop(ev, id, level) {
  if (admgrMobile()) { admgrBudgetSheet(id, level); return; }   // 폰은 작은 팝업 대신 하단 판 (2026-09-18)
  const w = admgr.write;
  const R = admgrRows();
  const node = (level === 'campaign' ? R.camps : R.sets).find(x => x.id === id);
  admgrBP.id = id; admgrBP.level = level; admgrBP.name = node ? node.name : '';
  const cur = node ? node.budget : 0;
  const pend = admgrPendOf(id);
  const pop = $('admgr-bpop');
  const warn = w.st.token_set ? '' :
    `<div class="info-bar" style="background:#fffbeb;border-color:#fde68a;color:#92400e;font-size:.68rem;padding:6px 8px;margin-bottom:8px;">Meta 쓰기 토큰이 아직 설정되지 않았어요 — 게시 불가.</div>`;
  const draft = admgrDraft[id];
  /* Meta 광고관리자식 편집창: 일일 [₩ 금액 KRW] / 취소 · [임시 저장] [게시] */
  const primary = `<button id="bpop-apply" class="btn-analyze" style="background:#0a7c3f;padding:7px 18px;" onclick="admgrApplyNow('${id}','${level}',document.getElementById('bpop-amount').value)">게시</button>`;
  pop.innerHTML = `
    <div style="font-size:.72rem;color:#6b7280;word-break:break-all;margin-bottom:8px;">${esc(admgrBP.name)}${pend ? ` · <span style="color:#b45309;">${admgrPendWhen(pend)} 예약 ₩${comma(pend.new_budget)}</span>` : ''}</div>
    ${warn}
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
      <span style="font-size:.8rem;font-weight:700;color:#1e1b4b;white-space:nowrap;">일일</span>
      <span style="flex:1;display:flex;align-items:center;border:1.5px solid #4f46e5;border-radius:8px;padding:0 10px;background:#fff;">
        <span style="color:#6b7280;font-size:.82rem;">₩</span>
        <input id="bpop-amount" type="text" inputmode="numeric" autocomplete="off" value="${comma(Math.round(Number(draft || cur) || 0))}" oninput="admgrNumInput(this)" onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('bpop-apply').click()}" style="flex:1;min-width:0;border:none;outline:none;padding:8px 6px;font-size:.88rem;font-weight:700;font-family:inherit;color:#1e1b4b;background:transparent;" />
        <span style="color:#9ca3af;font-size:.72rem;">KRW</span>
      </span>
    </div>
    <div id="bpop-err" style="display:none;font-size:.68rem;color:#dc2626;margin-bottom:6px;"></div>
    <div style="display:flex;align-items:center;gap:8px;">
      <a onclick="document.getElementById('admgr-bpop').style.display='none'" style="color:#4f46e5;font-size:.78rem;cursor:pointer;">취소</a>
      <span style="flex:1;"></span>
      <button class="btn-ghost" style="padding:7px 14px;" onclick="admgrDraftSave('${id}',document.getElementById('bpop-amount').value);document.getElementById('admgr-bpop').style.display='none'">임시 저장</button>
      ${primary}
    </div>
    ${pend ? `<a onclick="admgrBudgetCancel(${pend.id})" style="display:block;margin-top:8px;font-size:.7rem;color:#9ca3af;cursor:pointer;">예약 취소</a>` : ''}`;
  const r0 = (ev.target.closest('td, .mcard') || ev.target).getBoundingClientRect();   // 폰 카드에는 td가 없어 null 오류가 났다 (2026-09-13)
  pop.style.display = 'block';
  const pw = 270, ph = pop.offsetHeight || 230;
  pop.style.left = Math.max(8, Math.min(r0.left, window.innerWidth - pw - 12)) + 'px';
  pop.style.top = (r0.bottom + 6 + ph > window.innerHeight - 10 ? Math.max(10, r0.top - ph - 6) : r0.bottom + 6) + 'px';
  setTimeout(() => { const a = $('bpop-amount'); if (a) { a.focus(); const n = a.value.length; a.setSelectionRange(n, n); } }, 0);   // 메타 광고관리자처럼: 전체 선택 없이 커서 맨 뒤 (2026-09-15)
}
document.addEventListener('click', e => {   // 팝업 바깥 클릭 닫기 (여는 클릭은 표시 전이라 무해)
  const pop = document.getElementById('admgr-bpop');
  if (pop && pop.style.display !== 'none' && !pop.contains(e.target)) pop.style.display = 'none';
}, true);
/* 숫자 입력칸: 타이핑 중 천 단위 쉼표 자동, 커서는 같은 자리 유지 (2026-09-15) */
function admgrNumInput(el) {
  const raw = el.value, pos = el.selectionStart || 0;
  const after = raw.slice(pos).replace(/[^0-9]/g, '').length;   // 커서 뒤 숫자 개수 — 포맷 뒤에도 같은 위치로
  const digits = raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  el.value = digits ? comma(Number(digits)) : '';
  let i = el.value.length, seen = 0;
  while (i > 0 && seen < after) { i--; if (/[0-9]/.test(el.value[i])) seen++; }
  el.setSelectionRange(i, i);
}
function admgrBpopErr(m) { const el = $('bpop-err'); if (el) { el.textContent = m; el.style.display = 'block'; } }
async function admgrBudgetCancel(pid) {
  const w = admgr.write;
  if (!w.pin) { admgrBpopErr('먼저 PIN 인증을 해주세요'); return; }
  try {
    await metaBudgetCall({ action: 'cancel' }, { id: pid, pin: w.pin });
    $('admgr-bpop').style.display = 'none';
    toast('예약을 취소했어요');
    admgrWritePending();
  } catch (e) {
    if (String(e.message).includes('PIN')) admgrPinInvalidate();
    admgrBpopErr(e.message);
  }
}

/* ═══ 열 표시/순서 (Meta 광고관리자의 '열' 메뉴처럼) — localStorage { hidden:[라벨], order:[라벨] } (2026-09-07 사용자 요청) ═══
   렌더 후 DOM을 재배치한다(무명 열=체크박스는 항상 맨 앞, 합계 행의 colspan은 풀어서 열 수를 맞춘 뒤 처리)
   2026-10-01: 캠페인·광고세트·광고 탭이 한 설정을 같이 쓴다 — 이름 열(캠페인/광고세트/광고)은 '이름'으로 묶고, 그 탭에 없는 열은 건너뛴다 */
const ADMGR_NAME_LABELS = ['캠페인', '광고세트', '광고'];
const admgrColNorm = l => ADMGR_NAME_LABELS.includes(l) ? '이름' : l === '23:55 세팅' ? '23:45 세팅' : l === '구매(클릭7일)' ? '구매(클릭7일)' : l === 'ROAS(클릭7일)' ? 'ROAS(클릭7일)' : l;   // 옛 저장값 이름 → 현재 이름 (10/7 23:45 · 10/25 클릭7일)   // '23:55 세팅'은 옛 저장값 (2026-10-07 23:45로 변경)
function admgrColsKey() { return 'adc_admgr_cols'; }
const ADMGR_COLS_DEFAULT = { hidden: ['구매당 비용', '최근 변경', '전환값', 'CPC', '클릭', '구매(클릭7일)'], order: ['켜짐', '이름', '판정', '예상 마감', '구매', '구매당 비용', '예산', '지출', '클릭', 'ROAS', 'ROAS(클릭7일)', '구매(클릭7일)', '최근 변경', '전환값', 'CPC'] };   // 사용자가 정한 표시·순서 (2026-09-30)
const admgrColsOk = c => c && Array.isArray(c.hidden) && Array.isArray(c.order);
const admgrColsNorm = c => { const k = l => l !== '23:45 세팅'; return { hidden: [...new Set(c.hidden.map(admgrColNorm))].filter(k), order: [...new Set(c.order.map(admgrColNorm))].filter(k) }; };   // 23:45 세팅 열은 2026-10-29에 뺌
function admgrColsDefKey() { return 'adc_admgr_colsdef'; }   // 내가 저장한 기본값 (이 브라우저)
function admgrLsMove(from, to) { const v = lsGet(from, null); if (v != null) { lsSet(to, v); try { localStorage.removeItem(from); } catch { /* 무시 */ } } return v; }   // 옛 탭별 저장값(광고세트)을 공통 키로 한 번 옮김
function admgrColsDef() {
  const d = lsGet(admgrColsDefKey(), null) ?? admgrLsMove('adc_admgr_colsdef_set', admgrColsDefKey()); if (!admgrColsOk(d)) return admgrColsNorm(ADMGR_COLS_DEFAULT);
  const n = admgrColsNorm(d);
  if (!lsGet('adc_admgr_colsdef1029', false)) {   // 직접 저장한 기본값에도 구매당 비용 숨김 한 번 (2026-10-29 — 저장 설정만 고쳐서 이쪽 사용자는 그대로 보였음)
    lsSet('adc_admgr_colsdef1029', true); if (!n.hidden.includes('구매당 비용')) { n.hidden.push('구매당 비용'); lsSet(admgrColsDefKey(), n); }
  }
  return n;
}
function admgrColsCfg() {
  const c = lsGet(admgrColsKey(), null) ?? admgrLsMove('adc_admgr_cols_set', admgrColsKey());
  if (!admgrColsOk(c)) return admgrColsDef();
  const n = admgrColsNorm(c);
  if (!n.order.includes('ROAS(클릭7일)') && !n.hidden.includes('ROAS(클릭7일)')) {   // 2026-10-22 새 열: 저장된 순서의 ROAS 뒤에 한 번 끼워 넣기, 구매(1일)은 숨김
    const i = n.order.indexOf('ROAS'); n.order.splice(i < 0 ? n.order.length : i + 1, 0, 'ROAS(클릭7일)', '구매(클릭7일)'); n.hidden.push('구매(클릭7일)'); lsSet(admgrColsKey(), n);
  }
  if (!lsGet('adc_admgr_cols1029', false)) {   // 2026-10-29 판정이 ROAS라 구매당 비용 열은 기본 숨김 — 저장된 설정에도 한 번만 (다시 켜면 그대로 둠)
    lsSet('adc_admgr_cols1029', true); if (!n.hidden.includes('구매당 비용')) { n.hidden.push('구매당 비용'); lsSet(admgrColsKey(), n); }
  }
  if (!n.order.includes('예상 마감') && !n.hidden.includes('예상 마감')) {   // 2026-10-26 새 열: 판정 뒤에 한 번 끼워 넣기
    const i = n.order.indexOf('판정'); n.order.splice(i < 0 ? n.order.length : i + 1, 0, '예상 마감'); lsSet(admgrColsKey(), n);
  }
  return n;
}
function admgrColsDefSave() { lsSet(admgrColsDefKey(), admgrColsCfg()); toast('지금 열 설정을 기본값으로 저장했어요'); }
function admgrColsSave(c) { lsSet(admgrColsKey(), c); }
function admgrColsApply() {
  const table = $('admgr-body').querySelector('table'); if (!table) return;
  const labels = [...table.querySelectorAll('thead th')].map(admgrColLabel);
  admgr._colLabels = labels;
  const cfg = admgrColsCfg();
  const ths = [...table.querySelectorAll('thead th')];
  const fixed = labels.map((l, i) => ({ l, i })).filter(p => !p.l && !ths[p.i].classList.contains('xp'));
  const tail = labels.map((l, i) => ({ l, i })).filter(p => !p.l && ths[p.i].classList.contains('xp'));   // ∨ 열은 항상 맨 뒤
  const movable = labels.map((l, i) => ({ l, i })).filter(p => p.l);
  const ordered = [...cfg.order.map(l => movable.find(p => admgrColNorm(p.l) === l)).filter(Boolean), ...movable.filter(p => !cfg.order.includes(admgrColNorm(p.l)))];
  const idx = [...fixed, ...ordered, ...tail].map(p => p.i);
  const identity = idx.every((v, k) => v === k);
  const hidden = new Set(cfg.hidden);
  if (identity && !hidden.size) return;
  table.querySelectorAll('tfoot tr').forEach(tr => {   // 합계 행 colspan 풀기
    const first = tr.children[0]; const span = parseInt(first.getAttribute('colspan') || '1', 10);
    if (span > 1) { first.removeAttribute('colspan'); for (let k = 1; k < span; k++) first.insertAdjacentElement('afterend', document.createElement('td')); }
  });
  table.querySelectorAll('tr').forEach(tr => {
    const cells = [...tr.children]; if (cells.length !== labels.length) return;
    if (!identity) idx.forEach(i => tr.appendChild(cells[i]));   // appendChild = 이동 → 새 순서로 재배치
    cells.forEach((c, i) => { if (hidden.has(admgrColNorm(labels[i]))) c.style.display = 'none'; });
  });
}
let admgrColsAnchor = null, admgrColDragL = null;
function admgrColsMenu(ev) { admgrColsAnchor = ev.currentTarget.getBoundingClientRect(); admgrColsMenuRender(); }
function admgrColsMenuRender() {
  const cfg = admgrColsCfg();
  const raw = (admgr._colLabels || []).filter(Boolean), nameL = raw.find(l => ADMGR_NAME_LABELS.includes(l)) || '이름';
  const labels = raw.map(admgrColNorm);
  const order = [...cfg.order.filter(l => labels.includes(l)), ...labels.filter(l => !cfg.order.includes(l))];
  const show = l => l === '이름' ? nameL : l;
  const pop = $('admgr-bpop');
  pop.innerHTML = `<div style="font-size:.78rem;font-weight:800;color:#1c1e21;margin-bottom:6px;">열 표시 · 순서 <span style="font-weight:400;color:#9ca3af;font-size:.68rem;">체크 = 표시 · ⋮⋮ 드래그 = 순서 · 캠페인·광고세트·광고 공통</span></div>
    <div id="cols-list" style="max-height:52vh;overflow:auto;">${order.map(l => `
      <div draggable="true" data-l="${esc(l)}" ondragstart="admgrColDrag(event)" ondragover="event.preventDefault()" ondrop="admgrColDrop(event)"
           style="display:flex;align-items:center;gap:8px;padding:5px 6px;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:4px;background:#fff;cursor:grab;font-size:.78rem;">
        <span style="color:#c4c8d4;">⋮⋮</span><input type="checkbox" ${cfg.hidden.includes(l) ? '' : 'checked'} onchange="admgrColToggle('${esc(l)}',this.checked)" style="margin:0;" /><span>${esc(show(l))}</span></div>`).join('')}</div>
    <button class="btn-ghost" style="width:100%;justify-content:center;font-size:.72rem;margin-top:8px;" title="지금 체크·순서를 '기본으로'를 눌렀을 때 돌아갈 값으로 저장" onclick="admgrColsDefSave()">지금 설정을 기본값으로 저장</button>
    <div style="display:flex;gap:6px;margin-top:6px;">
      <button class="btn-ghost" style="flex:1;justify-content:center;font-size:.72rem;" title="저장해 둔 기본값으로 되돌리기 (열 너비도 초기화)" onclick="try{localStorage.removeItem(admgrColsKey())}catch{};try{localStorage.removeItem(admgrColKey())}catch{};renderAdmgr(true);admgrColsMenuRender()">기본으로</button>
      <button class="btn-analyze" style="flex:1;justify-content:center;font-size:.72rem;" onclick="document.getElementById('admgr-bpop').style.display='none'">닫기</button></div>`;
  const r0 = admgrColsAnchor || { left: 100, bottom: 100 };
  pop.style.display = 'block';
  pop.style.left = Math.max(8, Math.min(r0.left, window.innerWidth - 282)) + 'px';
  pop.style.top = (r0.bottom + 6) + 'px';
}
function admgrColToggle(l, on) {
  const cfg = admgrColsCfg();
  cfg.hidden = on ? cfg.hidden.filter(x => x !== l) : [...new Set([...cfg.hidden, l])];
  admgrColsSave(cfg); renderAdmgr(true);
}
function admgrColDrag(e) { admgrColDragL = e.currentTarget.dataset.l; }
function admgrColDrop(e) {
  e.preventDefault();
  const to = e.currentTarget.dataset.l;
  if (!admgrColDragL || admgrColDragL === to) return;
  const items = [...$('cols-list').children].map(d => d.dataset.l);
  const cfg = admgrColsCfg();
  const full = [...cfg.order, ...items.filter(l => !cfg.order.includes(l))].filter(l => l !== admgrColDragL);   // 다른 탭에만 있는 열의 자리는 그대로 두고 옮긴다
  full.splice(full.indexOf(to) + (items.indexOf(admgrColDragL) < items.indexOf(to) ? 1 : 0), 0, admgrColDragL);
  cfg.order = full; admgrColsSave(cfg);
  admgrColDragL = null;
  renderAdmgr(true); admgrColsMenuRender();
}

/* ═══ 표 열 너비 조절 (원본 admgrColResize) — 머리글 오른쪽 가장자리 드래그, 더블클릭 = 원래대로. 탭별 localStorage 저장. 마우스 전용 ═══ */
function admgrColKey() { return 'adc_admgr_colw_' + admgr.view; }
function admgrColLoad() { try { return JSON.parse(localStorage.getItem(admgrColKey()) || '{}'); } catch { return {}; } }
function admgrColSave(obj) { try { localStorage.setItem(admgrColKey(), JSON.stringify(obj)); } catch { /* 저장 불가 환경이면 이번 세션만 적용 */ } }
function admgrColLabel(th) { return th.textContent.replace(/[▲▼]\s*\d*/g, '').replace(/\s+/g, ' ').trim(); }
function admgrColApply(table, idx, w) {   // 해당 열의 머리글+본문 셀 전부에 너비 강제 (인라인 min-width 제압)
  table.querySelectorAll('tr').forEach(tr => {
    const c = tr.children[idx]; if (!c) return;
    c.style.width = c.style.minWidth = c.style.maxWidth = w + 'px';
    c.style.overflow = 'hidden';
  });
}
function admgrColResize() {
  if (window.innerWidth <= 900) return;   // 모바일은 미지원
  const table = $('admgr-body').querySelector('table');
  if (!table) return;
  const saved = admgrColLoad();
  table.querySelectorAll('thead th').forEach((th, idx) => {
    const key = admgrColLabel(th);
    if (!key || th.classList.contains('tg')) return;   // 체크박스·토글 열은 폭 고정 (드래그 제외)
    if (saved[key]) admgrColApply(table, idx, saved[key]);
    const h = document.createElement('span');
    h.className = 'colh';   // 구분선이 보이게 (CSS)
    h.title = '드래그 = 열 너비 조절 · 더블클릭 = 원래대로';
    h.style.cssText = 'position:absolute;top:0;right:-5px;width:10px;height:100%;cursor:col-resize;z-index:5;';
    h.onclick = e => e.stopPropagation();   // 정렬 클릭으로 안 새게
    h.ondblclick = e => {
      e.stopPropagation();
      const s0 = admgrColLoad(); delete s0[key];
      admgrColSave(s0);
      renderAdmgr(true);
    };
    h.onmousedown = e => {
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX, startW = th.getBoundingClientRect().width;
      const move = ev => {
        const w = Math.max(28, Math.round(startW + ev.clientX - startX));   // 토글·좁은 열도 줄일 수 있게
        th.style.width = th.style.minWidth = th.style.maxWidth = w + 'px';   // 드래그 중엔 머리글만 (가볍게)
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        // 드래그를 놓는 순간 머리글에 click이 발생해 정렬이 바뀌는 것 방지 — 직후 클릭 1회를 삼킨다 (2026-09-07 사용자 지적)
        const swallow = e => { e.stopPropagation(); e.preventDefault(); };
        document.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => document.removeEventListener('click', swallow, true), 300);
        const w = parseInt(th.style.width) || Math.round(startW);
        admgrColApply(table, idx, w);   // 놓는 순간 본문 셀까지 반영
        const s0 = admgrColLoad(); s0[key] = w;
        admgrColSave(s0);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };
    th.appendChild(h);
  });
}

/* ═══ 최근 변경 — 오늘 예산 변경 이력 (원본 admgrBudget* 이식, 읽기 전용 · 영향 분석은 제외) ═══ */
const admgrKst = iso => { const t = new Date(iso); return isNaN(t.getTime()) ? null : new Date(t.getTime() + 9 * 3600 * 1000); };
const admgrPad2 = n => String(n).padStart(2, '0');
const admgrKstLabel = iso => { const k = admgrKst(iso); return k ? `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${admgrPad2(k.getUTCHours())}:${admgrPad2(k.getUTCMinutes())}` : '—'; };
async function admgrBudgetFetch() {
  const b = admgr.budget;
  if (b.loading || b.byObj || b.error) return;
  b.loading = true;
  try {
    const d = await metaGet({ action: 'budgethistory' });   // 기본 = 오늘
    const m = new Map();
    for (const ev of (d.events || [])) { if (!m.has(ev.object_id)) m.set(ev.object_id, []); m.get(ev.object_id).push(ev); }
    for (const list of m.values()) list.sort((x, y) => y.time.localeCompare(x.time));   // 최신순
    b.byObj = m;
  } catch (e) { b.error = true; }
  b.loading = false; renderAdmgr(true);
}
const admgrChgUp = evs => evs[0].new_value >= evs[0].old_value;   // 최신 이벤트 방향 (분류 칩 기준)
function admgrChgSet(k) { admgr.chgFilter = k; renderAdmgr(); }
/* 셀: 오늘 변경 전부 — 맨 위 '시작 N'(첫 조정 직전 예산), 그 아래 ↑파랑(증액)/↓빨강(감액) + 변경 후 설정 예산 + 시각 (원본 규칙) */
function admgrChgCell(r) {
  const b = admgr.budget;
  const evs = b.byObj && b.byObj.get(r.id);
  if (evs && evs.length) {
    const first = evs[evs.length - 1];
    const startTxt = first && first.old_value > 0
      ? `<div title="오늘 첫 조정 직전 예산" style="font-size:.62rem;color:#9ca3af;font-weight:700;white-space:nowrap;">시작 ${comma(first.old_value)}</div>` : '';
    const badges = evs.slice().reverse().map(ev => {
      const up = ev.new_value >= ev.old_value;
      const k = admgrKst(ev.time);
      const hm = k ? `${admgrPad2(k.getUTCHours())}:${admgrPad2(k.getUTCMinutes())}` : '';
      return `<span class="status-badge ${up ? 'badge-blue' : 'badge-red'}" style="font-size:.68rem;"><i class="fa-solid fa-arrow-${up ? 'up' : 'down'}" style="font-size:.58rem;"></i> ${comma(ev.new_value)} <span style="opacity:.65;font-weight:600;">${hm}</span></span>`;
    }).join('');
    return `<div onclick="event.stopPropagation();admgrBudgetModal('${r.id}')" title="오늘 예산 변경 ${evs.length}건 — 클릭하면 히스토리" style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;cursor:pointer;">${startTxt}${badges}</div>`;
  }
  if (b.loading) return '<i class="fa-solid fa-spinner fa-spin" style="color:#e5e7eb;font-size:.65rem;"></i>';
  return '<span style="color:#d1d5db;">—</span>';
}
const admgrKstDate = iso => { const k = admgrKst(iso); return k ? `${k.getUTCFullYear()}-${admgrPad2(k.getUTCMonth() + 1)}-${admgrPad2(k.getUTCDate())}` : ''; };
const admgrBM = { id: null, name: '', range: 'today', hourly: null, hourlyId: null, _evs: [] };   // hourly = 영향 분석용 시간대별 성과 캐시
function admgrBudgetModal(id) {
  $('abm-sub').style.display = '';   // 히스토리 창에서만 부제목 표시 (다른 용도로 쓸 땐 숨김)
  const R = admgrRows();
  const node = R.camps.find(x => x.id === id) || R.sets.find(x => x.id === id);
  const evs = (admgr.budget.byObj && admgr.budget.byObj.get(id)) || [];
  admgrBM.id = id; admgrBM.name = node ? node.name : (evs[0] ? evs[0].object_name : id); admgrBM.range = 'today';
  if (admgrBM.hourlyId !== id) { admgrBM.hourly = null; admgrBM.hourlyId = null; }   // 다른 대상이면 시간대 캐시 비움
  $('admgr-budget-modal').classList.add('show');
  admgrBudgetModalRender();
}
function admgrBudgetRange(rg) {
  admgrBM.range = rg;
  if (rg === 'week' && !admgr.budget.seven && !admgr.budget.sevenLoading) admgrBudgetSeven();
  admgrBudgetModalRender();
}
async function admgrBudgetSeven() {
  const b = admgr.budget;
  b.sevenLoading = true; admgrBudgetModalRender();
  try {
    const d = await metaGet({ action: 'budgethistory', start_date: todayStr(-6), end_date: todayStr(0) });
    b.seven = d.events || [];
  } catch (e) { toast('조회 실패: ' + e.message); b.seven = []; }
  b.sevenLoading = false; admgrBudgetModalRender();
}
function admgrBudgetModalRender() {
  $('abm-title').textContent = admgrBM.name;
  const b = admgr.budget;
  let evs;
  if (admgrBM.range === 'today') evs = (b.byObj && b.byObj.get(admgrBM.id)) || [];
  else if (b.sevenLoading) evs = null;
  else evs = (b.seven || []).filter(e => e.object_id === admgrBM.id).slice().sort((x, y) => y.time.localeCompare(x.time));
  let html = `<div class="filter-tabs" style="margin-bottom:10px;">
    <button class="filter-tab ${admgrBM.range === 'today' ? 'active' : ''}" onclick="admgrBudgetRange('today')">오늘</button>
    <button class="filter-tab ${admgrBM.range === 'week' ? 'active' : ''}" onclick="admgrBudgetRange('week')">최근 7일</button></div>`;
  if (evs === null) html += '<div class="empty-state" style="padding:20px;"><p>불러오는 중…</p></div>';
  else if (!evs.length) html += '<div class="empty-state" style="padding:20px;"><p>이 기간에 예산 변경 기록이 없어요.</p></div>';
  else {
    const t0 = todayStr(0), y0 = todayStr(-1);
    html += evs.map((ev, i) => {
      const up = ev.new_value >= ev.old_value, diff = ev.new_value - ev.old_value;
      const canImpact = [t0, y0].includes(admgrKstDate(ev.time));   // 시간대별 데이터가 어제~오늘뿐
      return `<div style="border:1.5px solid #e7e8ee;border-radius:12px;padding:10px 12px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:.74rem;color:#6b7280;font-weight:700;white-space:nowrap;">${admgrKstLabel(ev.time)}</span>
          <span style="font-size:.82rem;font-weight:700;color:#1e1b4b;">${won(ev.old_value)} → ${won(ev.new_value)}</span>
          <span class="status-badge ${up ? 'badge-blue' : 'badge-red'}"><i class="fa-solid fa-arrow-${up ? 'up' : 'down'}" style="font-size:.6rem;"></i> ${up ? '증액' : '감액'} ${up ? '+' : '−'}${won(Math.abs(diff))}</span>
          ${ev.note ? `<span style="font-size:.68rem;color:#9ca3af;">${esc(ev.note)}</span>` : ''}
          ${canImpact ? `<button class="filter-tab" style="margin-left:auto;color:#4338ca;border-color:#c7d2fe;padding:3px 10px;font-size:.72rem;" onclick="admgrBudgetImpact(${i})" title="변경 전 3시간 vs 적용 후 3시간 비교">영향 분석</button>` : ''}
        </div>
        <div id="abm-imp-${i}"></div></div>`; }).join('');
    html += `<div style="font-size:.68rem;color:#9ca3af;margin-top:4px;">기록은 Meta 활동 로그 기준(약 90일 보관) · 시각은 한국 시간 · 영향 분석은 어제·오늘 변경만 가능(시간대별 데이터 범위)</div>`;
  }
  $('abm-body').innerHTML = html;
  admgrBM._evs = evs || [];
}
/* 영향 분석 (원본 admgrBudgetImpact 그대로) — 변경 전 3시간 vs 적용 후 3시간, 어제 같은 시간대 참조.
   Meta 예산 반영 지연(~1시간)을 고려해 변경 시간대와 다음 1시간은 건너뛴다. 완결된 시간대만 사용.
   판정: 적용 후 완결 2h+ 이고 전후 지출이 있으면 ROAS ±10% 기준 긍정/부정/중립, 그 외 판단 보류. */
async function admgrBudgetImpact(i) {
  const ev = (admgrBM._evs || [])[i]; if (!ev) return;
  const box = $('abm-imp-' + i); if (!box) return;
  box.innerHTML = '<p style="padding:8px;color:#9ca3af;font-size:.72rem;">시간대별 성과 조회 중…</p>';
  try {
    if (!admgrBM.hourly || admgrBM.hourlyId !== admgrBM.id) {
      admgrBM.hourly = await metaGet({ action: 'hourlystats', object_id: admgrBM.id });
      admgrBM.hourlyId = admgrBM.id;
    }
  } catch (e) { box.innerHTML = `<p style="padding:8px;color:#dc2626;font-size:.72rem;">조회 실패: ${esc(e.message)}</p>`; return; }
  const h = admgrBM.hourly;
  const evDate = admgrKstDate(ev.time);
  const cH = admgrKst(ev.time).getUTCHours();
  const dayRows = h.rows.filter(r => r.date === evDate);
  const refRows = evDate === h.today ? h.rows.filter(r => r.date === h.yesterday) : [];
  const nowK = new Date(Date.now() + 9 * 3600 * 1000);
  const maxH = evDate === todayStr(0) ? nowK.getUTCHours() - 1 : 23;   // 완결된 시간대만
  const beforeH = [cH - 3, cH - 2, cH - 1].filter(x => x >= 0);
  const afterH = [cH + 2, cH + 3, cH + 4].filter(x => x <= maxH && x <= 23);   // 변경 시간대 + 반영 1시간 건너뜀
  const agg = (rows, hs) => { const s0 = { spend: 0, purchases: 0, value: 0, h: hs.length }; for (const r of rows) if (hs.includes(r.hour)) { s0.spend += r.spend; s0.purchases += r.purchases; s0.value += r.value; } return s0; };
  const B = agg(dayRows, beforeH), A = agg(dayRows, afterH), R = refRows.length ? agg(refRows, afterH) : null;
  let verdict, vCls, vNote;
  const rb = B.spend > 0 ? B.value / B.spend : 0, ra = A.spend > 0 ? A.value / A.spend : 0;
  if (A.h < 2) { verdict = '판단 보류'; vCls = 'badge-gray'; vNote = '적용 후 완결된 시간이 2시간 미만 — 시간이 더 지난 뒤 다시 확인하세요'; }
  else if (B.spend <= 0 || A.spend <= 0) { verdict = '판단 보류'; vCls = 'badge-gray'; vNote = '비교할 지출 데이터가 부족해요'; }
  else if (!B.purchases && !A.purchases) { verdict = '판단 보류'; vCls = 'badge-gray'; vNote = '전후 모두 구매 0건 — 구매 기준 판단 불가'; }
  else if (!B.purchases && A.purchases) { verdict = '긍정 신호'; vCls = 'badge-green'; vNote = '변경 전 구매 0건 → 적용 후 구매 발생'; }
  else if (ra >= rb * 1.1) { verdict = '긍정 신호'; vCls = 'badge-green'; vNote = `ROAS ${rb.toFixed(2)} → ${ra.toFixed(2)} (+10% 이상)`; }
  else if (ra <= rb * 0.9) { verdict = '부정 신호'; vCls = 'badge-red'; vNote = `ROAS ${rb.toFixed(2)} → ${ra.toFixed(2)} (−10% 이상)`; }
  else { verdict = '중립'; vCls = 'badge-gray'; vNote = `ROAS 비슷 (${rb.toFixed(2)} → ${ra.toFixed(2)})`; }
  const hRange = hs => hs.length ? `${admgrPad2(hs[0])}~${admgrPad2(hs[hs.length - 1] + 1)}시` : '—';
  const row = (label, hs, s0) => s0 ? `<tr><td style="text-align:left;font-weight:600;">${label}</td><td>${hRange(hs)}</td><td>${admgrMoney(s0.spend)}</td><td>${comma(s0.purchases)}</td><td>${admgrRoasTd(s0)}</td></tr>` : '';
  box.innerHTML = `<div style="margin-top:10px;background:#f8f9fb;border-radius:10px;padding:10px 12px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
      <span class="status-badge ${vCls}" style="font-size:.78rem;">${verdict}</span>
      <span style="font-size:.72rem;color:#6b7280;">${vNote}</span></div>
    <div class="table-wrap"><table style="font-size:.76rem;">
      <thead><tr><th style="text-align:left;">구간</th><th>시간대</th><th>지출</th><th>구매</th><th>ROAS</th></tr></thead>
      <tbody>${row('변경 전', beforeH, B)}${row('적용 후', afterH, A)}${R ? row('어제 같은 시간', afterH, R) : ''}</tbody></table></div>
    <div style="font-size:.66rem;color:#9ca3af;margin-top:6px;">Meta 예산 반영 지연(~1시간)을 고려해 변경 시간대와 다음 1시간은 뺐어요 · 참고용 — 시간대·요일 효과가 섞여 있어 확정 판단은 금물</div></div>`;
}

/* ═══ 폰 예산 수정 하단 판 (2026-09-18 스펙 A) — 빠른 버튼은 입력칸만 채우고, 저장은 임시 저장/게시 중 하나로.
   입력칸·오류칸 id는 팝업과 같게 써서 admgrNumInput·admgrBudgetCancel을 그대로 재사용 ═══ */
function admgrBudgetSheet(id, level) {
  const w = admgr.write, R = admgrRows();
  const node = (level === 'campaign' ? R.camps : R.sets).find(x => x.id === id); if (!node) return;
  admgrBP.id = id; admgrBP.level = level; admgrBP.name = node.name;
  const cur = Math.round(node.budget || 0), draft = admgrDraft[id];
  const pend = admgrPendOf(id), max = (w.st && w.st.max_budget) || 300000;
  const r100 = v => Math.max(1000, Math.round(v / 100) * 100);
  const quick = [['÷10', Math.max(1000, Math.round(cur / 10)), 'cut'], ['−50%', r100(cur * 0.5)], ['+20%', r100(cur * 1.2)], ['+50%', r100(cur * 1.5)]];
  let sh = $('admgr-sheet');
  if (!sh) { sh = document.createElement('div'); sh.id = 'admgr-sheet'; document.body.appendChild(sh); }
  sh.innerHTML = `<div class="ags-dim" onclick="admgrSheetClose()"></div>
    <div class="ags-panel" role="dialog" aria-label="예산 수정">
      <div class="ags-grab"></div>
      <div class="ags-head"><div style="min-width:0;"><b>${esc(admgrProductOf({ adset_name: admgrBase(node.name) }))}</b><small>${esc(admgrBase(node.name))}</small></div>
        <button class="ags-x" onclick="admgrSheetClose()" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button></div>
      ${w.st && w.st.token_set ? '' : '<div class="ags-warn">Meta 쓰기 토큰이 아직 설정되지 않아 게시할 수 없어요</div>'}
      <label class="ags-lbl" for="bpop-amount">일일 예산</label>
      <div class="ags-amt"><span>₩</span><input id="bpop-amount" type="text" inputmode="numeric" autocomplete="off" value="${comma(Math.round(Number(draft || cur) || 0))}" oninput="admgrNumInput(this);admgrSheetMark(null)" /><em>KRW</em></div>
      <div class="ags-info">현재 ${comma(cur)}${draft && draft !== cur ? ` · <b style="color:#b45309;">임시 저장 ${comma(draft)}</b>` : ''}${pend ? ` · <b style="color:#b45309;">${admgrPendWhen(pend)} 예약 ${comma(pend.new_budget)}</b>` : ''}</div>
      <div id="bpop-err" class="ags-err" style="display:none;"></div>
      <div class="ags-quick">${quick.map(([t, v, cls], i) => `<button class="${cls || ''}" data-i="${i}" onclick="admgrSheetQuick(${v},${i})"><b>${t}</b><small>${v > max ? '상한 초과' : comma(v)}</small></button>`).join('')}</div>
      ${pend ? `<button class="ags-link" onclick="admgrSheetCancelPend(${pend.id})">예약 취소</button>` : ''}
      <div class="ags-btns">
        <button class="btn-ghost" onclick="admgrSheetSave()">임시 저장</button>
        <button id="bpop-apply" class="btn-analyze" onclick="admgrSheetPublish()"><i class="fa-solid fa-paper-plane"></i> 게시</button>
      </div>
    </div>`;
  sh.style.display = 'block';
  document.body.classList.add('ags-open');
}
function admgrSheetMark(i) { document.querySelectorAll('#admgr-sheet .ags-quick button').forEach(b => b.classList.toggle('on', String(b.dataset.i) === String(i))); }
function admgrSheetQuick(v, i) { const a = $('bpop-amount'); if (a) a.value = comma(v); admgrSheetMark(i); }
function admgrSheetClose() { const sh = $('admgr-sheet'); if (sh) { sh.style.display = 'none'; sh.innerHTML = ''; } document.body.classList.remove('ags-open'); }
function admgrSheetVal() { return String(($('bpop-amount') || {}).value || ''); }
function admgrSheetSave() {
  const n = Math.round(Number(admgrSheetVal().replace(/[^0-9]/g, '')));
  if (!(n >= 1000)) { admgrBpopErr('1,000원 이상 입력하세요'); return; }
  const id = admgrBP.id; admgrSheetClose(); admgrDraftSave(id, n);
}
function admgrSheetPublish() { const { id, level } = admgrBP, v = admgrSheetVal(); admgrSheetClose(); admgrApplyNow(id, level, v); }
async function admgrSheetCancelPend(pid) {
  await admgrBudgetCancel(pid);
  const e = $('bpop-err'); if (!e || e.style.display !== 'block') admgrSheetClose();
}
