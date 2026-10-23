/* ═══ 알림판 (2026-10-23, 사용자 요청: 상한·독식·피로 같은 알림을 광고관리자 맨 위 한 곳에) ═══
   #admgr-banner 자리에 그린다. 머리줄 = 켜진 일예산 합계(세트+CBO)와 상한, 그 아래 = 검사 항목들.
   기준값은 계정 공유 설정(shared_state 'admgr_alert_cfg', 관리자만 저장) — ⋯ 메뉴 '알림 기준' 또는 머리줄 [기준] 버튼.
   검사는 admgrAlert.checks에 함수로 등록: (cfg) → [{ key, lvl:'red'|'yellow'|'blue', text(html), act?:{label, onclick} }]. '오늘 하루 숨기기'는 이 브라우저에만.
   (index.html에서 분리 로드 — 전역 함수·변수를 그대로 공유) */
'use strict';
const ADMGR_ALERT_DEF = { cap: 4500000, hog: 60, hogCpa: 60, fatigue: 25, fatigueMinPur: 20, fatigueCooldown: 7 };
const admgrAlert = { cfg: null, ver: null, loading: false, checks: [] };
function admgrAlertCfg() { return Object.assign({}, ADMGR_ALERT_DEF, admgrAlert.cfg || {}); }
async function admgrAlertCfgEnsure() {
  if (admgrAlert.cfg || admgrAlert.loading || admgr.demo || !admgrCfg()) return;
  admgrAlert.loading = true;
  try { const r = await sbCall('client-log', { action: 'state_get', key: 'admgr_alert_cfg' }); admgrAlert.cfg = (r && r.data) || {}; admgrAlert.ver = (r && r.ver) || null; renderAdmgr(true); }
  catch { admgrAlert.cfg = {}; }   // 못 읽으면 기본값으로
  admgrAlert.loading = false;
}
/* 켜진 일예산 합계 — CBO 캠페인은 캠페인 예산, 아니면 켜진 세트 예산. drafts=true면 임시 저장(예산·켜기/끄기)까지 반영한 '게시 후' 값 */
function admgrBudgetTotal(drafts) {
  const R = admgrRows(); let sets = 0, cbo = 0;
  for (const c of R.camps) { if (c.status !== 'ACTIVE') continue; if (c.budget > 0) cbo += c.budget; else for (const s of (c.adsets || [])) if (s.status === 'ACTIVE') sets += s.budget || 0; }
  let delta = 0;
  if (drafts && typeof admgrDraftTargets === 'function') for (const t of admgrDraftTargets()) {
    const node = t.level === 'campaign' ? R.camps.find(x => x.id === t.id) : R.sets.find(x => x.id === t.id); if (!node) continue;
    if (t.kind === 'budget') { if (node.status === 'ACTIVE') delta += t.to - t.from; }
    else if (t.kind === 'status') delta += (t.status === 'ACTIVE' ? 1 : -1) * (node.budget || 0);
  }
  return { sets, cbo, total: sets + cbo, after: sets + cbo + delta };
}
const admgrW = v => v >= 1e4 ? (Math.round(v / 1000) / 10).toLocaleString() + '만' : comma(v);
function admgrAlertItems() {
  const cfg = admgrAlertCfg();
  return admgrAlert.checks.flatMap(fn => { try { return fn(cfg) || []; } catch (e) { return []; } });
}
function admgrAlertPanel() {
  if (!admgr.data || admgr.demo) return '';
  const cfg = admgrAlertCfg(), B = admgrBudgetTotal(false), over = cfg.cap > 0 && B.total > cfg.cap;
  const items = admgrAlertItems(), hide = lsGet('adc_admgr_alert_hide', {}), today = todayStr(0);
  const shown = items.filter(i => hide[i.key] !== today);
  const row = i => `<div class="ag-al ag-al-${i.lvl}"><span class="ag-al-dot"></span><span class="ag-al-txt">${i.text}</span>${i.act ? `<button class="ag-al-btn" onclick="${i.act.onclick}">${esc(i.act.label)}</button>` : ''}<button class="ag-al-x" onclick="admgrAlertHide('${esc(i.key)}')" title="오늘 하루 숨기기" aria-label="오늘 하루 숨기기">×</button></div>`;
  return `<div class="ag-alerts">
    <div class="ag-al ag-al-head ${over ? 'ag-al-red' : ''}"><span class="ag-al-dot"></span><span class="ag-al-txt"><b>켜진 일예산 ${admgrW(B.total)}원</b> <small>세트 ${admgrW(B.sets)} · CBO ${admgrW(B.cbo)}${cfg.cap > 0 ? ` · 상한 ${admgrW(cfg.cap)}` : ''}</small>${over ? ` <b class="ag-al-over">상한 초과 +${admgrW(B.total - cfg.cap)}</b>` : ''}</span>${typeof dnrbCan === 'function' && dnrbCan('budget') ? `<button class="ag-al-btn ghost" onclick="admgrAlertCfgModal()" title="상한·독식·피로 기준 편집"><i class="fa-solid fa-sliders"></i> 기준</button>` : ''}</div>
    ${shown.map(row).join('')}${items.length && !shown.length ? `<div class="ag-al-muted">알림 ${items.length}개 오늘 숨김 · <a href="#" onclick="lsSet('adc_admgr_alert_hide',{});renderAdmgr(true);return false;">다시 보기</a></div>` : ''}</div>`;
}
function admgrAlertHide(key) { const h = lsGet('adc_admgr_alert_hide', {}); h[key] = todayStr(0); lsSet('adc_admgr_alert_hide', h); renderAdmgr(true); }
function admgrAlertCfgModal() {
  const c = admgrAlertCfg();
  const f = (k, label, unit, step) => `<label style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #f3f4f6;font-size:.8rem;"><span style="flex:1;">${label}</span><input id="alc-${k}" class="inp" type="number" min="0" step="${step || 1}" value="${c[k]}" style="width:120px;text-align:right;" /><span style="width:28px;color:#6b7280;">${unit}</span></label>`;
  $('abm-title').textContent = '알림 기준'; $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = `${f('cap', '켜진 일예산 합계 상한 (0 = 경고 안 함)', '원', 10000)}${f('hog', 'CBO 독식 — 한 광고가 캠페인 지출의', '%')}${f('hogCpa', '독식 경고 조건 — 그 광고 구매당 비용이 마진의', '%', 5)}${f('fatigue', '소재 피로 — 전주 대비 구매당 비용 상승', '%', 5)}${f('fatigueMinPur', '피로 감지에 필요한 지난주 구매', '건')}${f('fatigueCooldown', '같은 상품 피로 재알림 간격', '일')}
    <div style="font-size:.7rem;color:#9ca3af;margin-top:8px;line-height:1.6;">모든 계정에 같이 적용돼요 · 비우면 기본값(상한 450만 · 독식 60% · 마진의 60% · 피로 25% · 20건 · 7일)</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;"><button class="btn-ghost" onclick="closeModal('admgr-budget-modal')">취소</button><button class="btn-analyze" onclick="admgrAlertCfgSave()">저장</button></div>`;
  $('admgr-budget-modal').classList.add('show');
}
async function admgrAlertCfgSave() {
  const d = {};
  for (const k of Object.keys(ADMGR_ALERT_DEF)) { const raw = ($('alc-' + k) || {}).value, v = raw === '' ? ADMGR_ALERT_DEF[k] : Number(raw); if (!isFinite(v) || v < 0) { toast('숫자를 확인하세요'); return; } d[k] = v; }
  try {
    const r = await sbCall('client-log', { action: 'state_set' }, { key: 'admgr_alert_cfg', base: admgrAlert.ver, data: d });
    if (r.conflict) { admgrAlert.cfg = r.data || {}; admgrAlert.ver = r.ver; toast('다른 사람이 먼저 바꿨어요 — 최신 값을 불러왔으니 다시 저장하세요'); admgrAlertCfgModal(); return; }
    admgrAlert.cfg = d; admgrAlert.ver = r.ver; closeModal('admgr-budget-modal'); toast('알림 기준을 저장했어요'); renderAdmgr(true);
  } catch (e) { toast('저장 실패: ' + e.message); }
}

/* ── 검사 ③ CBO 독식 (2026-10-23): CBO 캠페인(캠페인 예산 있음·켜짐) 안에서 광고 하나가 지출의 hog% 이상을 먹고,
   그 광고의 구매당 비용이 마진×hogCpa% 를 넘거나(구매 0이면 마진만큼 쓴 경우) → 빨강 + [이 광고 끄기 임시 저장]. 데이터는 지금 화면 기간 기준 */
function admgrCheckHog(cfg) {
  const out = [], R = admgrRows();
  const per = admgr.preset === 'custom' && admgr.customRange ? `${admgr.customRange.since.slice(5)}~${admgr.customRange.until.slice(5)}` : (ADMGR_PRESETS[admgr.preset] || '오늘');
  for (const c of R.camps) {
    if (c.status !== 'ACTIVE' || !(c.budget > 0)) continue;
    const ads = (c.adsets || []).flatMap(s => s.ads || []).filter(a => a.spend > 0);
    const total = ads.reduce((a, x) => a + x.spend, 0); if (total < 30000 || ads.length < 2) continue;
    const top = ads.slice().sort((x, y) => y.spend - x.spend)[0], share = top.spend / total;
    if (share * 100 < cfg.hog) continue;
    const m = typeof admgrMarginOf === 'function' ? admgrMarginOf({ id: top.id, name: top.name }).m : null;
    const cpa = top.purchases > 0 ? top.spend / top.purchases : null;
    const bad = m ? (cpa == null ? top.spend >= m : cpa > m * cfg.hogCpa / 100) : cpa == null;
    if (!bad) continue;
    out.push({ key: 'hog:' + c.id + ':' + top.id, lvl: 'red',
      text: `<b>CBO 독식</b> ${esc(c.name)} — "${esc(top.name)}"가 ${per} 지출의 <b>${Math.round(share * 100)}%</b>(${won(top.spend)}) · 구매당 ${cpa == null ? '<b>구매 0</b>' : `<b>${won(cpa)}</b>`}${m ? ` (마진 ${comma(m)}의 ${cpa == null ? '—' : Math.round(cpa / m * 100) + '%'})` : ''}`,
      act: { label: '이 광고 끄기 임시 저장', onclick: `admgrHogOff('${esc(top.id)}')` } });
  }
  return out;
}
function admgrHogOff(adId) {   // 끄기 임시 저장 → 상단 '게시'로 Meta 반영 (다른 켜기/끄기와 같은 길)
  admgrSDraft[adId] = { level: 'ad', status: 'PAUSED' }; lsSet('adc_admgr_sdraft', admgrSDraft);
  toast('끄기를 임시 저장했어요 — 상단 [게시]를 눌러야 Meta에 반영돼요'); renderAdmgr(true);
}
/* ── 23:45 관련 알림을 팝업 대신 여기로 (사용자 요청: 알림은 한 곳에) — 원복 승인 상태 · 예약 건수 · 반영 결과 */
function admgrCheck2345(cfg) {
  const w = admgr.write, out = []; if (!w || !w.st) return out;
  const k = admgrKst(new Date().toISOString()), hm = k ? k.getUTCHours() * 60 + k.getUTCMinutes() : 0;
  const npend = w.pendingByObj ? w.pendingByObj.size : 0;
  if (w.resetRow) out.push({ key: 'reset:' + todayStr(0), lvl: 'blue', text: `오늘 23:45 원복 승인됨 <small>${esc(w.resetRow.object_name || '')}</small>${npend ? ` · 예약 ${npend}건` : ''}`, act: npend ? { label: '예약 목록', onclick: 'admgrMidList()' } : null });
  else if (hm >= 15 * 60 && hm < 23 * 60 + 45 && dnrbCan('budget')) out.push({ key: 'noreset:' + todayStr(0), lvl: 'yellow', text: `오늘 23:45 원복 승인이 아직 없어요${npend ? ` · 예약 ${npend}건은 그대로 실행` : ''}`, act: { label: '승인하기', onclick: 'admgrMidMenu(event)' } });
  else if (npend) out.push({ key: 'pend:' + todayStr(0), lvl: 'blue', text: `23:45 예약 ${npend}건`, act: { label: '예약 목록', onclick: 'admgrMidList()' } });
  const d = w.lastPending, rows = d && d.lastrun || [];
  if (rows.length) {
    const key = d.run_day || String(rows[0].applied_at || '').slice(0, 10);
    const ok = rows.filter(r => r.status === 'applied').length, fail = rows.length - ok;
    if (rows.some(r => r.mode === 'reset_approve' || r.mode === 'midnight')) out.push({ key: 'run:' + key, lvl: fail ? 'yellow' : 'blue', text: `23:45 반영 결과 (${key.slice(5).replace('-', '/')}) — 완료 ${ok}${fail ? ` · <b>실패 ${fail}</b>` : ''}`, act: { label: '자세히', onclick: `admgrRunNotify(admgr.write.lastPending, true)` } });
  }
  return out;
}
admgrAlert.checks.push(admgrCheckHog, admgrCheck2345);

/* ── 검사 ⑦ 승격 후보 (2026-10-23): 테스트 캠페인(이름에 '테스트') 안 켜진 세트의 **최근 7일 Meta 성과**로 — 월요일 브리핑(daily-brief-data.mjs promotion)과 같은 기준.
   종합 CBO 후보 = 7일 구매 30↑ · ROAS 5↑ · 아직 [→CBO] 표시 없음 · 그 상품의 상품 CBO가 켜져 있지 않음
   상품 CBO 후보 = 한 상품에 우수 세트(7일 구매 10↑ · ROAS 손익×2.5↑, 상품 모르면 5↑) 2개↑ 이고 상품 7일 구매 60↑ · 상품 CBO 없음
   테스트 소재 탭 데이터(_test 이름 기준)가 아니라 캠페인 기준인 이유: 테스트 완료로 _test를 뗀 세트가 테스트 캠페인에 그대로 돌아가는데 그게 승격 대상이라서.
   7일 계층 데이터는 패널이 열릴 때 한 번(30분 유지) 따로 받는다 — 서버 5분 캐시라 Meta 추가 호출은 거의 없음 */
const ADMGR_PROMO = { pur: 30, roas: 5, goodPur: 10, goodMul: 2.5, prodPur: 60, goodMin: 2 };
async function admgrPromoEnsure() {
  const A = admgrAlert; if (admgr.demo || !admgrCfg() || A.h7Loading || (A.h7 && Date.now() - A.h7At < 30 * 60000)) return;
  A.h7Loading = true;
  try { A.h7 = await metaGet({ action: 'hierarchy', preset: 'last_7d' }); A.h7At = Date.now(); renderAdmgr(true); } catch (e) { A.h7 = A.h7 || null; }
  A.h7Loading = false;
}
function admgrPromoCands() {
  const h = admgrAlert.h7; if (!h || !h.campaigns) { if (admgr.data && !admgr.demo) setTimeout(() => admgrPromoEnsure(), 0); return { ads: [], prods: [], ready: false }; }
  const prodCbo = new Set(h.campaigns.filter(c => /^상품CBO_/.test(admgrBase(c.name)) && c.status === 'ACTIVE').map(c => admgrNorm(admgrBase(c.name).replace(/^상품CBO_/, '').replace(/_\d{6}$/, ''))));
  const rows = [];
  for (const c of h.campaigns) { if (!/테스트/.test(c.name) || c.status !== 'ACTIVE') continue;
    for (const s of (c.adsets || [])) { if (s.status !== 'ACTIVE' || !(s.spend > 0)) continue;
      const p = s.purchases || 0, roas = s.value / s.spend, prod = admgrProductOf(s), pc = prodCbo.has(admgrNorm(prod));
      const be = (typeof admgrBreakEven === 'function' && admgrBreakEven({ adset_id: s.id, adset_name: s.name, name: s.name }) || {}).be || null;
      rows.push({ s, a: { id: s.id, adset_id: s.id, adset_name: s.name, name: s.name }, p, roas, spend: s.spend, be, prod, prodCbo: pc, inCbo: /\[→/.test(s.name) || pc, adIds: (s.ads || []).map(a => a.id), good: p >= ADMGR_PROMO.goodPur && roas >= (be ? be * ADMGR_PROMO.goodMul : ADMGR_PROMO.roas) }); } }
  const ads = rows.filter(r => !r.inCbo && r.p >= ADMGR_PROMO.pur && r.roas >= ADMGR_PROMO.roas).sort((x, y) => y.roas - x.roas);
  const byProd = new Map(); rows.forEach(r => (byProd.get(r.prod) || byProd.set(r.prod, []).get(r.prod)).push(r));
  const prods = [...byProd.entries()].map(([name, L]) => ({ name, n: L.length, pur: L.reduce((t, r) => t + r.p, 0), goods: L.filter(r => r.good).sort((x, y) => y.roas - x.roas), inCbo: L.some(r => r.prodCbo),
      roas: L.reduce((t, r) => t + r.roas * r.spend, 0) / Math.max(1, L.reduce((t, r) => t + r.spend, 0)) }))
    .filter(x => !x.inCbo && x.pur >= ADMGR_PROMO.prodPur && x.goods.length >= ADMGR_PROMO.goodMin).sort((x, y) => y.pur - x.pur);
  return { ads, prods, ready: true, range: h.range };
}
function admgrCheckPromo() {
  const c = admgrPromoCands(); if (!c.ads.length && !c.prods.length) return [];
  return [{ key: 'promo:' + todayStr(0), lvl: 'blue', text: `<b>승격 후보</b> 종합 CBO ${c.ads.length}개 · 상품 CBO ${c.prods.length}개 <small>최근 7일 기준</small>`, act: { label: '보기', onclick: 'admgrPromoModal()' } }];
}
admgrAlert.checks.push(admgrCheckPromo);
function admgrPromoModal(mode) {
  const c = admgrPromoCands(); admgr.promoMode = mode || admgr.promoMode || (c.ads.length ? 'all' : 'prod');
  const M = admgr.promoMode;
  const row = (r, chk) => `<label style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #f3f4f6;font-size:.78rem;cursor:pointer;"><input type="checkbox" class="pm-ad" value="${esc(r.s.id)}" ${chk ? 'checked' : ''} /><span style="flex:1;min-width:0;word-break:break-all;">${esc(admgrBase(r.s.name))}</span><span style="flex:none;color:#6b7280;">7일 구매 ${r.p} · ROAS <b>${r.roas.toFixed(1)}</b>${r.inCbo ? ' · <span class="ag-mark">⧉ CBO 있음</span>' : ''}</span></label>`;
  let body;
  if (!c.ready) body = '<div style="color:#9ca3af;font-size:.8rem;padding:10px 0;">최근 7일 성과를 불러오는 중…</div>';
  else if (M === 'all') body = c.ads.length ? `<div style="font-size:.74rem;color:#6b7280;margin-bottom:6px;">최근 7일(${(c.range || {}).start || ''}~${(c.range || {}).end || ''}) 구매 ${ADMGR_PROMO.pur}건↑ · ROAS ${ADMGR_PROMO.roas}↑ · 아직 CBO에 없는 세트 — 체크해서 종합 CBO 세트에 복사</div>${c.ads.map(r => row(r, true)).join('')}` : '<div style="color:#9ca3af;font-size:.8rem;padding:10px 0;">지금 기준을 넘는 소재가 없어요</div>';
  else if (M !== 'all') body = c.prods.length ? c.prods.map(x => `<div style="margin:8px 0 4px;font-weight:800;font-size:.82rem;color:#1e1b4b;">${esc(x.name)} <span style="font-weight:600;color:#6b7280;font-size:.72rem;">7일 구매 ${x.pur} · ROAS ${x.roas.toFixed(1)} · 우수 소재 ${x.goods.length}개</span></div>${x.goods.map(r => row(r, true)).join('')}`).join('') : '<div style="color:#9ca3af;font-size:.8rem;padding:10px 0;">우수 소재 2개↑·7일 구매 60↑인 상품이 없어요</div>';
  $('abm-title').textContent = '승격 후보'; $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = `<div style="display:flex;gap:6px;margin-bottom:8px;"><button class="filter-tab ${M === 'all' ? 'active' : ''}" onclick="admgrPromoModal('all')">종합 CBO 후보 (${c.ads.length})</button><button class="filter-tab ${M === 'prod' ? 'active' : ''}" onclick="admgrPromoModal('prod')">상품 CBO 후보 (${c.prods.length})</button></div>
    <div style="max-height:45vh;overflow:auto;">${body}</div>
    <div style="font-size:.7rem;color:#9ca3af;margin-top:8px;line-height:1.6;">복사 뒤 결과 창에서 원본 테스트 세트 예산을 1,000원으로 내릴 수 있어요 (같은 소재 두 곳 동시 운영 방지)</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;"><button class="btn-ghost" onclick="closeModal('admgr-budget-modal')">닫기</button><button class="btn-analyze" onclick="admgrPromoCopy()"><i class="fa-solid fa-copy"></i> ${M === 'all' ? '종합 CBO 세트에 복사' : '새 상품 CBO 만들기'}</button></div>`;
  $('admgr-budget-modal').classList.add('show');
}
async function admgrPromoCopy() {   // 체크한 후보 세트의 광고를 광고 복사 모달로 — 7일 계층에 광고가 안 실린 세트는 썸네일 조회(creatives)로 광고 id를 찾는다
  const setIds = [...document.querySelectorAll('.pm-ad:checked')].map(x => x.value); if (!setIds.length) { toast('소재를 체크하세요'); return; }
  const c = admgrPromoCands(), rows = [...c.ads, ...c.prods.flatMap(p => p.goods)].filter((r, i, L) => setIds.includes(r.s.id) && L.findIndex(x => x.s.id === r.s.id) === i);
  const need = rows.filter(r => !r.adIds.length).map(r => r.s.id); const found = new Map();
  if (need.length) { try { for (let i = 0; i < need.length; i += 100) { const d = await metaGet({ action: 'creatives', set_ids: need.slice(i, i + 100).join(',') }); (d.ads || []).forEach(a => { if (a.effective_status !== 'DELETED') (found.get(String(a.adset_id)) || found.set(String(a.adset_id), []).get(String(a.adset_id))).push(a.id); }); } } catch (e) { toast('광고 목록 조회 실패: ' + e.message); return; } }
  admgr.copyPick = rows.flatMap(r => (r.adIds.length ? r.adIds : (found.get(String(r.s.id)) || [])).map(id => ({ id, name: r.s.name, _setId: r.s.id, _setName: r.s.name })));
  if (!admgr.copyPick.length) { toast('복사할 광고를 찾지 못했어요'); return; }
  admgr.copyMode = admgr.promoMode === 'prod' ? 'new' : 'set';
  if (admgr.copyMode === 'new') { const p = c.prods.find(x => x.goods.some(g => setIds.includes(g.s.id))); admgr.copyProduct = p ? p.name : ''; }
  admgrCopyModal();
}
function admgrPromoCut(ids) {   // 승격한 소재의 원본 테스트 세트 예산 1,000원 임시 저장 → 게시로 반영
  let n = 0; for (const id of ids) { admgrDraft[id] = 1000; n++; } lsSet('adc_admgr_draft', admgrDraft);
  toast(`테스트 세트 ${n}개 예산 1,000원을 임시 저장했어요 — 상단 [게시]로 반영`); closeModal('admgr-budget-modal'); renderAdmgr(true);
}
