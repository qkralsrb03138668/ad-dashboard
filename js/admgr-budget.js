/* ④-3 광고관리자: 예산 변경·23:55 예약/원복·PIN·열 표시/너비·최근 변경 이력
   (index.html에서 분리 — 2026-09-08 2단계. 파일 순서는 index.html의 <script> 순서, 전역 함수·변수를 그대로 공유) */
'use strict';

/* ═══ 예산 직접 변경 + 자정 예약 (이식 4단계 — 원본 admgrWrite·admgrBudgetPop·admgrBudgetWrite 그대로) ═══
   ⚠ 실제 돈이 움직이는 기능. 서버(meta-budget)가 DASH_KEY·PIN·상한(30만원)·총예산 거부·전 기록을 강제하고,
   화면은 편의 장치일 뿐이다. PIN은 메모리에만 두고(새로고침하면 다시 인증) 절대 저장하지 않는다. */
async function admgrWriteInit() {
  if (admgr.demo || admgr.write.st) return;
  try {
    admgr.write.st = await metaBudgetCall({ action: 'status' });
    await admgrWritePending();
  } catch { /* 쓰기 기능 없이 표시 (조회 실패는 치명적이지 않음) */ }
}
/* ═══ 23:55 반영 결과 알림창 (2026-09-08 사용자 요청) — 원복 승인분·23:55 예약분이 실행되면 한 번 띄운다.
   서버 pending 응답의 lastrun(가장 최근 23:55 이후 실행 행)을 보고, 같은 실행(run_day)은 adc_admgr_runseen 으로 한 번만.
   승인 행이 아직 pending이면(실행 중) 건너뛰고 다음 확인 때 다시 본다. 23:55~00:40 사이엔 1분마다 서버만 확인(Meta 호출 없음) */
function admgrRunNotify(d) {
  const rows = d.lastrun || []; if (!rows.length) return;
  const key = d.run_day || rows[0].applied_at.slice(0, 10);
  if (lsGet('adc_admgr_runseen', '') === key) return;
  const appr = rows.find(r => r.mode === 'reset_approve');
  const resets = rows.filter(r => r.mode === 'reset'), mids = rows.filter(r => r.mode === 'midnight');
  if (!appr && !mids.length) return;
  const line = r => `<div style="display:flex;gap:8px;align-items:flex-start;padding:3px 0;border-bottom:1px solid #f3f4f6;">
      <span style="flex:none;font-weight:800;color:${r.status === 'applied' ? '#15803d' : '#dc2626'};">${r.status === 'applied' ? '✓' : '✗'}</span>
      <span style="min-width:0;"><b>${esc(r.object_name || r.object_id)}</b> · ${r.old_budget ? comma(Math.round(r.old_budget)) + ' → ' : ''}<b>${comma(Math.round(r.new_budget))}</b>${r.status === 'applied' ? '' : `<div style="color:#dc2626;font-size:.7rem;">${esc(r.error || '실패')}</div>`}</span></div>`;
  const ok = a => a.filter(r => r.status === 'applied').length;
  let body = '';
  if (appr) {
    body += `<div style="font-weight:800;margin:4px 0 6px;">원복 승인분 ${appr.status === 'applied' ? `<span style="color:#15803d;">완료</span>` : `<span style="color:#dc2626;">실패</span>`} <span style="font-weight:600;color:#6b7280;font-size:.75rem;">${esc(appr.error || '')}</span></div>`;
    body += resets.length ? `<details ${resets.length <= 12 ? 'open' : ''}><summary style="cursor:pointer;font-size:.78rem;color:#4f46e5;">원복 ${ok(resets)}/${resets.length}건 목록</summary><div style="max-height:32vh;overflow:auto;">${resets.map(line).join('')}</div></details>` : `<div style="font-size:.78rem;color:#6b7280;">되돌릴 세트가 없었어요 (전부 시작 예산 그대로)</div>`;
  }
  if (mids.length) body += `<div style="font-weight:800;margin:12px 0 6px;">23:55 예약 반영 ${ok(mids)}/${mids.length}건</div><div style="max-height:32vh;overflow:auto;">${mids.map(line).join('')}</div>`;
  $('abm-title').textContent = `23:55 반영 결과 — ${key.slice(5).replace('-', '/')}`;
  $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = `<div style="font-size:.8rem;line-height:1.6;color:#374151;">${body}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn-analyze" onclick="lsSet('adc_admgr_runseen','${key}');closeModal('admgr-budget-modal')">확인</button></div>`;
  $('admgr-budget-modal').classList.add('show');
}
setInterval(() => {   // 23:55 실행 창 동안 화면이 열려 있으면 결과를 바로 알림 (우리 서버만 조회)
  if (!admgr.data || admgr.demo || !admgrCfg()) return;
  const k = admgrKst(new Date().toISOString()); if (!k) return;
  const hm = k.getUTCHours() * 60 + k.getUTCMinutes();
  if (hm >= 23 * 60 + 56 || hm < 40) admgrWritePending();
}, 60 * 1000);
async function admgrWritePending() {
  try {
    const d = await metaBudgetCall({ action: 'pending' });
    const pend = d.pending || [];
    admgr.write.resetRow = pend.find(p => p.mode === 'reset_approve' && p.apply_date === todayStr(0)) || null;   // 오늘 23:55 원복 승인
    admgr.write.pendingByObj = new Map(pend.filter(p => p.mode !== 'reset_approve').map(p => [p.object_id, p]));
    admgr.write.daystart = new Map((d.daystart || []).map(r => [String(r.adset_id), Number(r.budget)]));   // 오늘 시작 예산(00:10 스냅샷) — 자정세팅 열
    renderAdmgr(true);
    admgrRunNotify(d);   // 23:55 반영 결과 알림창 (한 번만)
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
  const pend = w.pendingByObj && w.pendingByObj.get(r.id);
  if (pend) base += `<div><span class="status-badge badge-yellow" style="margin-top:3px;font-size:.62rem;" title="${pend.apply_date} 23:55에 자동 반영 예약"><i class="fa-regular fa-clock"></i> 23:55 ${won(pend.new_budget)}</span></div>`;
  return base;
}
/* '자정세팅' 열 (2026-09-04 사용자 요청) — 버튼 한 번 = 현재 일예산 뒤에 0 하나 붙인 금액(×10)으로 자정 예약.
   이미 그 금액으로 예약돼 있으면 ✓ 배지. 취소는 예산 연필 팝업의 '자정 예약 취소'. 서버 상한(30만원)을 넘으면 버튼이 흐려지고 안내. */
function admgrMidCell(r, level) {
  if (!(r.budget > 0)) return '<span style="color:#d1d5db;">—</span>';
  /* 2026-09-07 사용자가 자정세팅법을 바꿈: "매일 처음 세팅된 일예산으로 23:55에 자동 원복(승인제)".
     → 첫 줄 = 시작 예산 + 23:55 원복 상태. ×10 기본값은 폐기(시작 예산이 이미 ×10 수준이라 상한만 넘겼음).
     아래 입력칸+⏰는 23:55에 따로 금액을 걸고 싶을 때만(기본 빈칸). 2026-09-07 저녁: 예약 시각 00:00 → 23:55(원복과 같은 실행에서 원복 대신 적용), 용어 '자정'→'23:55' */
  const w = admgr.write;
  const start = w.daystart && w.daystart.get(r.id);
  const cur = Math.round(r.budget);
  const pend = w.pendingByObj && w.pendingByObj.get(r.id);
  let startTxt;
  if (start == null) startTxt = `<div style="font-size:.62rem;color:#9ca3af;white-space:nowrap;" title="00:10 스냅샷이 아직 없어요 (오늘 도입 시 '스냅샷 복원' 후 표시)">시작 기록 없음</div>`;
  else {
    const st = Math.round(start), diff = st !== cur;
    const tail = pend ? `<span style="color:#b45309;" title="23:55 예약이 있어 원복 대신 예약 금액으로 바뀌어요">· 23:55 예약 우선</span>`
      : w.resetRow
      ? (diff ? `<b style="color:#15803d;">→ 23:55 원복</b>` : `<span style="color:#15803d;">· 23:55 유지</span>`)
      : (diff ? `<span style="color:#b45309;" title="상단 '23:55 원복 승인'을 누르면 23:55에 시작 예산으로 돌아가요">· 승인 전</span>` : '');
    startTxt = `<div style="font-size:.66rem;color:#374151;white-space:nowrap;" title="오늘 00:10에 기록된 하루 시작 예산">시작 <b>${comma(st)}</b> ${tail}</div>`;
  }
  const max = (w.st && w.st.max_budget) || 300000;
  const val = pend ? Math.round(pend.new_budget) : '';
  /* 텍스트 입력(위아래 화살표 없음, 클릭한 자리에 커서) — 2026-09-06 사용자 요청 */
  const inp = `<input type="text" inputmode="numeric" value="${val}" placeholder="23:55 예약" onclick="event.stopPropagation()" ${pend ? 'readonly' : ''}
      onkeydown="if(event.key==='Enter'){event.stopPropagation();admgrMidQuick('${r.id}','${level}',this.value)}"
      style="width:84px;padding:2px 6px;font-size:.72rem;font-weight:700;text-align:right;border:1.5px solid ${pend ? '#86efac' : '#e5e7eb'};border-radius:7px;background:${pend ? '#f0fdf4' : '#fff'};color:#1e1b4b;font-family:inherit;outline:none;" />`;
  /* 예약돼 있으면 ⏰가 ✓(초록)으로 바뀌고, 한 번 더 누르면 예약 취소 */
  const btn = pend
    ? `<button class="filter-tab" style="padding:2px 8px;font-size:.72rem;color:#fff;background:#16a34a;border-color:transparent;white-space:nowrap;"
        onclick="event.stopPropagation();admgrMidUnschedule(${pend.id})" title="23:55 예약됨 — 한 번 더 누르면 예약 취소"><i class="fa-solid fa-check"></i></button>`
    : `<button class="filter-tab" style="padding:2px 8px;font-size:.72rem;color:#6b7280;border-color:#e5e7eb;background:#fff;white-space:nowrap;"
        onclick="event.stopPropagation();admgrMidQuick('${r.id}','${level}',this.previousElementSibling.value)"
        title="입력한 금액으로 23:55 예약 (1,000 ~ ${comma(max)}원) — 23:55 전에 걸면 오늘, 지나면 내일"><i class="fa-regular fa-clock"></i></button>`;
  const note = pend ? `<div style="font-size:.6rem;color:#15803d;font-weight:700;">✓ ${pend.apply_date} 23:55 · ${comma(pend.new_budget)}원 예약됨</div>` : '';
  return `<div style="display:inline-flex;flex-direction:column;align-items:flex-start;gap:2px;">${startTxt}<div style="display:inline-flex;align-items:center;gap:4px;">${inp}${btn}</div>${note}</div>`;
}
/* ✓ 버튼 = 예약 취소 (admgrMidCancel은 예약 목록 모달용이라 별도 — 셀에서는 목록을 다시 열지 않는다) */
async function admgrMidUnschedule(pid) {
  if (!admgr.write.pin) { admgrPinPrompt(() => admgrMidUnschedule(pid)); return; }
  try {
    await metaBudgetCall({ action: 'cancel' }, { id: pid, pin: admgr.write.pin });
    toast('23:55 예약을 취소했어요');
    await admgrWritePending();
  } catch (e) { if (String(e.message).includes('PIN')) admgrPinInvalidate(); toast('취소 실패: ' + e.message); }
}
async function admgrMidQuick(id, level, amountStr) {
  const w = admgr.write;
  if (!w.pin) { admgrPinPrompt(() => admgrMidQuick(id, level, amountStr)); return; }   // 인증부터, 끝나면 이어서
  const R = admgrRows();
  const node = (level === 'campaign' ? R.camps : R.sets).find(x => x.id === id);
  if (!node || !(node.budget > 0)) return;
  const typed = Math.round(Number(String(amountStr || '').replace(/[^0-9]/g, '')));   // 텍스트 입력칸 — 콤마·공백 무시
  const target = typed;   // 2026-09-07: 빈칸이면 예약 안 함 (×10 기본값 폐기 — 23:55 원복이 시작 예산 복귀를 맡음)
  if (!(target > 0)) { toast('23:55에 걸 금액을 먼저 입력해 주세요'); return; }
  if (target < 1000 || target > w.st.max_budget) { toast(`예산은 1,000원 ~ ${comma(w.st.max_budget)}원 사이여야 해요 (입력: ${comma(target)}원)`); return; }
  try {
    const d = await metaBudgetCall({ action: 'schedule' }, { object_id: id, object_name: node.name, level, new_budget: target, pin: w.pin });
    toast(`${d.apply_date} 23:55에 ${comma(target)}원으로 예약했어요`);
    admgrWritePending();
  } catch (e) {
    if (String(e.message).includes('PIN')) admgrPinInvalidate();
    toast('예약 실패: ' + e.message);
  }
}
/* 임시저장 = 브라우저에만 보관하는 예산 메모 (id → 금액). 즉각반영하면 지워진다 */
const admgrDraft = lsGet('adc_admgr_draft', {});
function admgrDraftSave(id, val) {
  const n = Math.round(Number(val));
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
/* 메뉴 컨트롤: 'PIN 인증'(한 번 인증하면 세션 동안 유효) + '자정 반영 세팅' 3단계 버튼 */
function admgrWriteCtrlHtml() {
  const w = admgr.write;
  const pinBtn = w.pin
    ? `<button class="filter-tab" style="color:#15803d;border-color:#86efac;background:#f0fdf4;" onclick="admgrPinClear()" title="지금은 풀려 있어요 — 클릭하면 잠김 (다시 PIN 필요)"><i class="fa-solid fa-lock-open"></i> 인증됨 · 잠그기</button>`
    : `<button class="filter-tab" style="color:#4338ca;border-color:#c7d2fe;background:#eef2ff;" onclick="admgrPinPrompt()"><i class="fa-solid fa-lock"></i> PIN 인증</button>`;
  const n = w.pendingByObj ? w.pendingByObj.size : 0;
  const mid = w.midMode === 'setting'
    ? `<button class="filter-tab" style="background:#f59e0b;color:#fff;border-color:transparent;" onclick="admgrMidBtn()"><i class="fa-regular fa-clock"></i> 23:55 반영 세팅중${n ? ` · ${n}건` : ''} — 완료하기</button>`
    : w.midMode === 'done'
      ? `<button class="filter-tab" style="background:#16a34a;color:#fff;border-color:transparent;" onclick="admgrMidBtn()"><i class="fa-solid fa-check"></i> 23:55 반영 세팅 완료 · ${n}건 보기</button>`
      : `<button class="filter-tab" style="color:#b45309;border-color:#fcd34d;background:#fffbeb;" onclick="admgrMidBtn()"><i class="fa-regular fa-clock"></i> 23:55 반영 세팅 시작${n ? ` (예약 ${n}건)` : ''}</button>`;
  /* 23:55 시작 예산 원복 — 오늘 승인 여부 토글 (2026-09-07 사용자 운영 규칙: 승인한 날만 23:55에 하루 시작 예산으로 되돌림) */
  const rr = w.resetRow;
  const reset = rr
    ? `<button class="filter-tab" style="color:#15803d;border-color:#86efac;background:#f0fdf4;" onclick="admgrResetApprove()" title="오늘 23:55에 모든 광고세트를 하루 시작 예산으로 되돌려요 — 클릭하면 승인 취소"><i class="fa-solid fa-check"></i> 23:55 원복 승인됨</button>`
    : `<button class="filter-tab" style="color:#0f766e;border-color:#99f6e4;background:#f0fdfa;" onclick="admgrResetApprove()" title="누르면 오늘 23:55에 모든 광고세트 예산이 하루 시작 예산(00:10 기록)으로 자동 원복돼요. 23:55 전에만 유효"><i class="fa-regular fa-clock"></i> 23:55 원복 승인</button>`;
  const nd = admgrDraftTargets().length;
  const pub = nd ? `<button class="filter-tab" style="background:#0a7c3f;color:#fff;border-color:transparent;" onclick="admgrPublishDrafts()" title="임시 저장해둔 예산을 한 번에 Meta에 게시"><i class="fa-solid fa-paper-plane"></i> 임시 저장 전체 게시 (${nd})</button>
    <button class="filter-tab" style="color:#dc2626;border-color:#fecaca;" onclick="admgrClearDrafts()" title="임시 저장을 전부 지움 (Meta에는 아무 변화 없음)">임시 저장 전체 취소</button>` : '';
  return pinBtn + mid + reset + pub;
}
async function admgrResetApprove() {
  const w = admgr.write;
  if (!w.pin) { admgrPinPrompt(admgrResetApprove); return; }
  try {
    if (w.resetRow) {
      await metaBudgetCall({ action: 'cancel' }, { id: w.resetRow.id, pin: w.pin });
      toast('오늘 23:55 원복 승인을 취소했어요');
    } else {
      const now = new Date(); const hm = now.getHours() * 60 + now.getMinutes();
      if (hm >= 23 * 60 + 55) { toast('오늘 23:55는 이미 지났어요 — 내일 다시 승인해 주세요'); return; }
      await metaBudgetCall({ action: 'approve_reset' }, { pin: w.pin });
      toast('승인 완료 — 오늘 23:55에 모든 광고세트가 하루 시작 예산으로 돌아가요');
    }
    await admgrWritePending();
  } catch (e) { if (String(e.message).includes('PIN')) admgrPinInvalidate(); toast('실패: ' + e.message); }
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
  admgrConfirmModal(`임시 저장 ${targets.length}개 게시`, `${lines}<br/><span style="color:#9ca3af;font-size:.72rem;">Meta에 즉시 반영돼요 · 순서대로 처리(개당 1초쯤)</span>`, `${targets.length}개 게시`, async () => {
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
    lsSet('adc_admgr_pin', pin);   // 잠그기 버튼을 누르기 전까지 유지
    $('admgr-bpop').style.display = 'none';
    toast('PIN 인증 완료 — 잠그기를 누르기 전까지 계속 풀려 있어요');
    const after = admgrBP.after; admgrBP.after = null;
    renderAdmgr(true);
    if (after) after();
  } catch (e) { admgrBpopErr(e.message); }
}
function admgrPinClear() {
  admgr.write.pin = null;
  try { localStorage.removeItem('adc_admgr_pin'); } catch { /* 무시 */ }
  toast('잠갔어요 — 다음 예산 변경부터 PIN을 다시 물어요'); renderAdmgr(true);
}
/* 서버가 PIN을 거부하면(PIN 변경·잠금) 저장된 것도 지운다 */
function admgrPinInvalidate() { admgr.write.pin = null; try { localStorage.removeItem('adc_admgr_pin'); } catch { /* 무시 */ } renderAdmgr(true); }
function admgrMidBtn() {
  const w = admgr.write;
  if (w.midMode === 'setting') { w.midMode = 'done'; toast('23:55 반영 세팅 완료 — 버튼을 누르면 예약 목록이 열려요'); renderAdmgr(true); }
  else if (w.midMode === 'done') admgrMidList();
  else {
    if (!w.pin) { admgrPinPrompt(admgrMidBtn); return; }   // 인증부터
    w.midMode = 'setting';
    toast('23:55 반영 세팅 시작 — 예산을 클릭해 23:55에 반영될 금액을 입력하세요');
    renderAdmgr(true);
  }
}
function admgrMidList() {   // 자정 예약 목록 (히스토리 모달 껍데기 재사용)
  const w = admgr.write;
  const rows = [...(w.pendingByObj ? w.pendingByObj.values() : [])];
  $('abm-title').textContent = '23:55 반영 예약 목록'; $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = (rows.length ? `<div class="table-wrap"><table style="font-size:.78rem;">
      <thead><tr><th style="text-align:left;">대상</th><th>현재</th><th>23:55 반영값</th><th>적용</th><th></th></tr></thead>
      <tbody>${rows.map(p => `<tr>
        <td class="name-cell" style="text-align:left;">${esc(p.object_name || p.object_id)}<div style="font-size:.64rem;color:#9ca3af;">${p.level === 'campaign' ? '캠페인' : '광고세트'}</div></td>
        <td style="white-space:nowrap;">${p.old_budget ? won(Math.round(p.old_budget)) : '—'}</td>
        <td style="white-space:nowrap;font-weight:800;color:#b45309;">${won(Math.round(p.new_budget))}</td>
        <td style="white-space:nowrap;">${p.apply_date} 23:55</td>
        <td><button class="btn-ghost btn-danger-ghost" style="padding:2px 10px;font-size:.7rem;" onclick="admgrMidCancel(${p.id})">취소</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state" style="padding:20px;"><p>23:55 반영 예약이 없어요.</p></div>')
    + `<div style="display:flex;gap:6px;margin-top:10px;">
      <button class="btn-ghost" style="flex:1;justify-content:center;color:#b45309;border-color:#fcd34d;" onclick="admgr.write.midMode='setting';closeModal('admgr-budget-modal');renderAdmgr(true);toast('23:55 반영 세팅을 다시 시작해요')">새 세팅 시작</button>
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
  const w = admgr.write;
  const R = admgrRows();
  const node = (level === 'campaign' ? R.camps : R.sets).find(x => x.id === id);
  admgrBP.id = id; admgrBP.level = level; admgrBP.name = node ? node.name : '';
  const cur = node ? node.budget : 0;
  const pend = w.pendingByObj && w.pendingByObj.get(id);
  const pop = $('admgr-bpop');
  const setting = w.midMode === 'setting';
  const warn = w.st.token_set ? '' :
    `<div class="info-bar" style="background:#fffbeb;border-color:#fde68a;color:#92400e;font-size:.68rem;padding:6px 8px;margin-bottom:8px;">Meta 쓰기 토큰이 아직 설정되지 않았어요 — 게시 불가.</div>`;
  const draft = admgrDraft[id];
  /* Meta 광고관리자식 편집창: 일일 [₩ 금액 KRW] / 취소 · [임시 저장] [게시]. 세팅 모드에선 게시 대신 자정 반영 */
  const primary = setting
    ? `<button id="bpop-sched" class="btn-analyze" style="background:#f59e0b;padding:7px 16px;" onclick="admgrBudgetWrite('schedule')"><i class="fa-regular fa-clock"></i> 23:55 반영으로 저장</button>`
    : `<button id="bpop-apply" class="btn-analyze" style="background:#0a7c3f;padding:7px 18px;" onclick="admgrApplyNow('${id}','${level}',document.getElementById('bpop-amount').value)">게시</button>`;
  pop.innerHTML = `
    <div style="font-size:.72rem;color:#6b7280;word-break:break-all;margin-bottom:8px;">${esc(admgrBP.name)}${pend ? ` · <span style="color:#b45309;">23:55 예약 ₩${comma(pend.new_budget)}</span>` : ''}</div>
    ${setting ? '<div class="info-bar" style="background:#fffbeb;border-color:#fde68a;color:#b45309;font-size:.68rem;font-weight:700;padding:4px 8px;margin-bottom:8px;"><i class="fa-regular fa-clock"></i> 23:55 반영 세팅중</div>' : ''}
    ${warn}
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
      <span style="font-size:.8rem;font-weight:700;color:#1e1b4b;white-space:nowrap;">일일</span>
      <span style="flex:1;display:flex;align-items:center;border:1.5px solid #4f46e5;border-radius:8px;padding:0 10px;background:#fff;">
        <span style="color:#6b7280;font-size:.82rem;">₩</span>
        <input id="bpop-amount" type="number" min="1000" max="${w.st.max_budget}" step="1000" value="${draft || cur}" style="flex:1;min-width:0;border:none;outline:none;padding:8px 6px;font-size:.88rem;font-weight:700;font-family:inherit;" onkeydown="if(event.key==='Enter')document.getElementById('${setting ? 'bpop-sched' : 'bpop-apply'}').click()" />
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
    ${pend ? `<a onclick="admgrBudgetCancel(${pend.id})" style="display:block;margin-top:8px;font-size:.7rem;color:#9ca3af;cursor:pointer;">23:55 예약 취소</a>` : ''}`;
  const r0 = ev.target.closest('td').getBoundingClientRect();
  pop.style.display = 'block';
  const pw = 270, ph = pop.offsetHeight || 230;
  pop.style.left = Math.max(8, Math.min(r0.left, window.innerWidth - pw - 12)) + 'px';
  pop.style.top = (r0.bottom + 6 + ph > window.innerHeight - 10 ? Math.max(10, r0.top - ph - 6) : r0.bottom + 6) + 'px';
  setTimeout(() => { const a = $('bpop-amount'); if (a) { a.focus(); a.select(); } }, 0);
}
document.addEventListener('click', e => {   // 팝업 바깥 클릭 닫기 (여는 클릭은 표시 전이라 무해)
  const pop = document.getElementById('admgr-bpop');
  if (pop && pop.style.display !== 'none' && !pop.contains(e.target)) pop.style.display = 'none';
}, true);
function admgrBpopErr(m) { const el = $('bpop-err'); if (el) { el.textContent = m; el.style.display = 'block'; } }
async function admgrBudgetWrite(mode) {
  const w = admgr.write;
  const amount = Math.round(Number(($('bpop-amount') || {}).value || 0));
  if (!(amount >= 1000 && amount <= w.st.max_budget)) { admgrBpopErr(`1,000원 ~ ${comma(w.st.max_budget)}원 사이로 입력하세요`); return; }
  if (!w.pin) { admgrBpopErr('먼저 PIN 인증을 해주세요 (메뉴의 PIN 인증 버튼)'); return; }
  if (mode === 'apply' && !confirm(`'${admgrBP.name}'의 일예산을 ${comma(amount)}원으로 지금 바로 바꿀까요?\n(Meta에 즉시 반영되는 실제 예산 변경이에요)`)) return;
  const btn = $(mode === 'apply' ? 'bpop-apply' : 'bpop-sched');
  btn.disabled = true;
  try {
    const d = await metaBudgetCall({ action: mode }, { object_id: admgrBP.id, object_name: admgrBP.name, level: admgrBP.level, new_budget: amount, pin: w.pin });
    $('admgr-bpop').style.display = 'none';
    if (mode === 'apply') { toast(`일예산을 ${comma(amount)}원으로 변경했어요`); admgrFetch(); }
    else toast(`${d.apply_date} 23:55에 ${comma(amount)}원으로 변경 예약했어요`);
    admgrWritePending();
  } catch (e) {
    if (String(e.message).includes('PIN')) admgrPinInvalidate();
    admgrBpopErr(e.message);
    btn.disabled = false;
  }
}
async function admgrBudgetCancel(pid) {
  const w = admgr.write;
  if (!w.pin) { admgrBpopErr('먼저 PIN 인증을 해주세요'); return; }
  try {
    await metaBudgetCall({ action: 'cancel' }, { id: pid, pin: w.pin });
    $('admgr-bpop').style.display = 'none';
    toast('23:55 예약을 취소했어요');
    admgrWritePending();
  } catch (e) {
    if (String(e.message).includes('PIN')) admgrPinInvalidate();
    admgrBpopErr(e.message);
  }
}

/* ═══ 열 표시/순서 (Meta 광고관리자의 '열' 메뉴처럼) — 탭별 localStorage { hidden:[라벨], order:[라벨] } (2026-09-07 사용자 요청) ═══
   렌더 후 DOM을 재배치한다(무명 열=체크박스는 항상 맨 앞, 합계 행의 colspan은 풀어서 열 수를 맞춘 뒤 처리) */
function admgrColsKey() { return 'adc_admgr_cols_' + admgr.view; }
function admgrColsCfg() { const c = lsGet(admgrColsKey(), null); return c && Array.isArray(c.hidden) && Array.isArray(c.order) ? c : { hidden: [], order: [] }; }
function admgrColsSave(c) { lsSet(admgrColsKey(), c); }
function admgrColsApply() {
  const table = $('admgr-body').querySelector('table'); if (!table) return;
  const labels = [...table.querySelectorAll('thead th')].map(admgrColLabel);
  admgr._colLabels = labels;
  const cfg = admgrColsCfg();
  const fixed = labels.map((l, i) => ({ l, i })).filter(p => !p.l);
  const movable = labels.map((l, i) => ({ l, i })).filter(p => p.l);
  const ordered = [...cfg.order.map(l => movable.find(p => p.l === l)).filter(Boolean), ...movable.filter(p => !cfg.order.includes(p.l))];
  const idx = [...fixed, ...ordered].map(p => p.i);
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
    cells.forEach((c, i) => { if (hidden.has(labels[i])) c.style.display = 'none'; });
  });
}
let admgrColsAnchor = null, admgrColDragL = null;
function admgrColsMenu(ev) { admgrColsAnchor = ev.currentTarget.getBoundingClientRect(); admgrColsMenuRender(); }
function admgrColsMenuRender() {
  const cfg = admgrColsCfg();
  const labels = (admgr._colLabels || []).filter(Boolean);
  const order = [...cfg.order.filter(l => labels.includes(l)), ...labels.filter(l => !cfg.order.includes(l))];
  const pop = $('admgr-bpop');
  pop.innerHTML = `<div style="font-size:.78rem;font-weight:800;color:#1c1e21;margin-bottom:6px;">열 표시 · 순서 <span style="font-weight:400;color:#9ca3af;font-size:.68rem;">체크 = 표시 · ⋮⋮ 드래그 = 순서</span></div>
    <div id="cols-list" style="max-height:52vh;overflow:auto;">${order.map(l => `
      <div draggable="true" data-l="${esc(l)}" ondragstart="admgrColDrag(event)" ondragover="event.preventDefault()" ondrop="admgrColDrop(event)"
           style="display:flex;align-items:center;gap:8px;padding:5px 6px;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:4px;background:#fff;cursor:grab;font-size:.78rem;">
        <span style="color:#c4c8d4;">⋮⋮</span><input type="checkbox" ${cfg.hidden.includes(l) ? '' : 'checked'} onchange="admgrColToggle('${esc(l)}',this.checked)" style="margin:0;" /><span>${esc(l)}</span></div>`).join('')}</div>
    <div style="display:flex;gap:6px;margin-top:8px;">
      <button class="btn-ghost" style="flex:1;justify-content:center;font-size:.72rem;" title="표시·순서·저장된 열 너비를 모두 초기화" onclick="admgrColsSave({hidden:[],order:[]});try{localStorage.removeItem(admgrColKey())}catch{};renderAdmgr(true);admgrColsMenuRender()">기본으로</button>
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
  const from = items.indexOf(admgrColDragL), t = items.indexOf(to);
  items.splice(t, 0, items.splice(from, 1)[0]);
  const cfg = admgrColsCfg(); cfg.order = items; admgrColsSave(cfg);
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
