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
  const h = admgrAlert.h7; if (!h || !h.campaigns) { if (!admgr.demo && admgrCfg()) setTimeout(() => admgrPromoEnsure(), 0); return { ads: [], prods: [], ready: false }; }   // 테스트 소재 메뉴로 바로 들어와 광고관리자 데이터가 없어도 7일 성과는 따로 받는다
  const prodCbo = new Set(h.campaigns.filter(c => /^상품CBO_/.test(admgrBase(c.name)) && c.status === 'ACTIVE').map(c => admgrNorm(admgrBase(c.name).replace(/^상품CBO_/, '').replace(/_\d{6}$/, ''))));
  const rows = [];
  for (const c of h.campaigns) { if (!/테스트/.test(c.name) || c.status !== 'ACTIVE') continue;
    for (const s of (c.adsets || [])) { if (s.status !== 'ACTIVE' || !(s.spend > 0)) continue;
      const p = admgrP7(s), roas = admgrV7(s) / s.spend, prod = admgrProductOf(s), pc = prodCbo.has(admgrNorm(prod));   // 클릭 후 7일 기준 (2026-10-25) — 조회 기여 제외
      const be = (typeof admgrBreakEven === 'function' && admgrBreakEven({ adset_id: s.id, adset_name: s.name, name: s.name }) || {}).be || null;
      rows.push({ s, a: { id: s.id, adset_id: s.id, adset_name: s.name, name: s.name }, p, roas, spend: s.spend, be, prod, prodCbo: pc, inCbo: /\[→/.test(s.name) || pc, adIds: (s.ads || []).map(a => a.id), good: p >= ADMGR_PROMO.goodPur && roas >= (be ? be * ADMGR_PROMO.goodMul : ADMGR_PROMO.roas) }); } }
  const byProd = new Map(); rows.forEach(r => (byProd.get(r.prod) || byProd.set(r.prod, []).get(r.prod)).push(r));
  const toAll = new Set(lsGet('adc_promo_toall', []));   // 상품 CBO 후보지만 사용자가 "종합으로"라고 정한 상품 (2026-10-23 사용자 요청)
  const prods = [...byProd.entries()].map(([name, L]) => ({ name, n: L.length, pur: L.reduce((t, r) => t + r.p, 0), goods: L.filter(r => r.good).sort((x, y) => y.roas - x.roas), inCbo: L.some(r => r.prodCbo),
      roas: L.reduce((t, r) => t + r.roas * r.spend, 0) / Math.max(1, L.reduce((t, r) => t + r.spend, 0)), toAll: toAll.has(name) }))
    .filter(x => !x.inCbo && x.pur >= ADMGR_PROMO.prodPur && x.goods.length >= ADMGR_PROMO.goodMin).sort((x, y) => y.pur - x.pur);
  // 상품 CBO 후보로 분류된 상품의 세트는 종합 후보에 안 넣는다 — 사용자가 '종합으로' 돌린 상품만 예외 (2026-10-23 사용자 요청: 양쪽에 겹치지 않게)
  const prodOnly = new Set(prods.filter(x => !x.toAll).map(x => x.name));
  // [종합 CBO로] 보낸 상품은 그 상품의 '우수 세트'(상품 CBO 후보 기준) 전부가 종합 후보로 — 세트 하나하나가 30건을 넘어야 하던 규칙 때문에 상품당 1개만 넘어가던 문제 (2026-10-26 사용자 지적)
  const ads = rows.filter(r => !r.inCbo && (toAll.has(r.prod) ? r.good : (!prodOnly.has(r.prod) && r.p >= ADMGR_PROMO.pur && r.roas >= ADMGR_PROMO.roas))).map(r => ({ ...r, fromProd: toAll.has(r.prod) })).sort((x, y) => y.roas - x.roas);
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
  const row = (r, chk) => `<label style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #f3f4f6;font-size:.78rem;cursor:pointer;"><input type="checkbox" class="pm-ad" value="${esc(r.s.id)}" ${chk ? 'checked' : ''} /><span style="flex:1;min-width:0;word-break:break-all;">${esc(admgrBase(r.s.name))}${r.fromProd ? ' <span class="status-badge badge-blue" style="font-size:.58rem;" title="상품 CBO 후보였지만 종합으로 보내기로 한 상품">상품→종합</span>' : ''}</span><span style="flex:none;color:#6b7280;">7일 구매 ${r.p} · ROAS <b>${r.roas.toFixed(1)}</b>${r.inCbo ? ' · <span class="ag-mark">⧉ CBO 있음</span>' : ''}</span></label>`;
  let body;
  if (!c.ready) body = '<div style="color:#9ca3af;font-size:.8rem;padding:10px 0;">최근 7일 성과를 불러오는 중…</div>';
  else if (M === 'all') body = c.ads.length ? `<div style="font-size:.74rem;color:#6b7280;margin-bottom:6px;">최근 7일(${(c.range || {}).start || ''}~${(c.range || {}).end || ''}) 구매 ${ADMGR_PROMO.pur}건↑ · ROAS ${ADMGR_PROMO.roas}↑ · 아직 CBO에 없는 세트 — 체크해서 종합 CBO 세트에 복사</div>${c.ads.map(r => row(r, true)).join('')}` : '<div style="color:#9ca3af;font-size:.8rem;padding:10px 0;">지금 기준을 넘는 소재가 없어요</div>';
  else if (M !== 'all') body = c.prods.length ? `<div style="font-size:.74rem;color:#6b7280;margin-bottom:6px;">상품 CBO 후보로 잡힌 상품의 세트는 종합 후보에 안 올라가요 — 종합이 낫다고 보시면 [종합 CBO로]를 누르세요 (이 브라우저에 기억)</div>` + c.prods.map(x => `<div style="display:flex;align-items:center;gap:8px;margin:8px 0 4px;${x.toAll ? 'opacity:.6;' : ''}"><span style="flex:1;min-width:0;font-weight:800;font-size:.82rem;color:#1e1b4b;">${esc(x.name)} <span style="font-weight:600;color:#6b7280;font-size:.72rem;">7일 구매 ${x.pur} · ROAS ${x.roas.toFixed(1)} · 우수 소재 ${x.goods.length}개</span>${x.toAll ? ' <span class="status-badge badge-blue" style="font-size:.58rem;">종합으로 보냄</span>' : ''}</span><button class="ag-al-btn ${x.toAll ? 'ghost' : ''}" style="flex:none;" onclick="admgrPromoToAll(${JSON.stringify(x.name).replace(/"/g, '&quot;')}, ${x.toAll ? 'false' : 'true'})">${x.toAll ? '상품 CBO로 되돌리기' : '종합 CBO로'}</button></div>${x.toAll ? '' : x.goods.map(r => row(r, true)).join('')}`).join('') : '<div style="color:#9ca3af;font-size:.8rem;padding:10px 0;">우수 소재 2개↑·7일 구매 60↑인 상품이 없어요</div>';
  $('abm-title').textContent = '승격 후보'; $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = `<div style="display:flex;gap:6px;margin-bottom:8px;"><button class="filter-tab ${M === 'all' ? 'active' : ''}" onclick="admgrPromoModal('all')">종합 CBO 후보 (${c.ads.length})</button><button class="filter-tab ${M === 'prod' ? 'active' : ''}" onclick="admgrPromoModal('prod')">상품 CBO 후보 (${c.prods.length})</button></div>
    <div style="max-height:45vh;overflow:auto;">${body}</div>
    <div style="font-size:.7rem;color:#9ca3af;margin-top:8px;line-height:1.6;">복사 뒤 결과 창에서 원본 테스트 세트 예산을 1,000원으로 내릴 수 있어요 (같은 소재 두 곳 동시 운영 방지)</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;"><button class="btn-ghost" onclick="closeModal('admgr-budget-modal')">닫기</button><button class="btn-analyze" onclick="admgrPromoCopy()"><i class="fa-solid fa-copy"></i> ${M === 'all' ? '종합 CBO 세트에 복사' : '새 상품 CBO 만들기'}</button></div>`;
  $('admgr-budget-modal').classList.add('show');
}
function admgrPromoToAll(name, on) {   // 상품 CBO 후보 → 종합 CBO 후보로 (사용자 판단) · 되돌리기
  const L = new Set(lsGet('adc_promo_toall', [])); on ? L.add(name) : L.delete(name); lsSet('adc_promo_toall', [...L]);
  toast(on ? `${name} — 이제 종합 CBO 후보 탭에 세트가 올라와요` : `${name} — 상품 CBO 후보로 되돌렸어요`); admgrPromoModal(on ? 'all' : 'prod');
}
async function admgrPromoCopy() {   // 체크한 후보 세트의 광고를 광고 복사 모달로 — 7일 계층에 광고가 안 실린 세트는 썸네일 조회(creatives)로 광고 id를 찾는다
  const setIds = [...document.querySelectorAll('.pm-ad:checked')].map(x => x.value); if (!setIds.length) { toast('소재를 체크하세요'); return; }
  const c = admgrPromoCands(), rows = [...c.ads, ...c.prods.flatMap(p => p.goods)].filter((r, i, L) => setIds.includes(r.s.id) && L.findIndex(x => x.s.id === r.s.id) === i);
  const need = rows.filter(r => !r.adIds.length).map(r => r.s.id); const found = new Map();
  if (need.length) { try { for (let i = 0; i < need.length; i += 100) { const d = await metaGet({ action: 'creatives', set_ids: need.slice(i, i + 100).join(',') }); (d.ads || []).forEach(a => { if (a.effective_status !== 'DELETED') (found.get(String(a.adset_id)) || found.set(String(a.adset_id), []).get(String(a.adset_id))).push(a.id); }); } } catch (e) { toast('광고 목록 조회 실패: ' + e.message); return; } }
  admgr.copyPick = rows.flatMap(r => (r.adIds.length ? r.adIds : (found.get(String(r.s.id)) || [])).map(id => ({ id, name: r.s.name, _setId: r.s.id, _setName: r.s.name, _prod: r.prod })));
  if (!admgr.copyPick.length) { toast('복사할 광고를 찾지 못했어요'); return; }
  admgr.copyMode = admgr.promoMode === 'prod' ? 'new' : 'set';
  // 상품 CBO: 상품마다 캠페인 하나씩 — 여러 상품을 체크하면 한 캠페인으로 묶이던 문제 (2026-10-26 사용자 지적)
  admgr.copyGroups = null;
  if (admgr.copyMode === 'new') { const g = new Map(); admgr.copyPick.forEach(a => (g.get(a._prod) || g.set(a._prod, []).get(a._prod)).push(a)); admgr.copyGroups = [...g.entries()].map(([product, ads]) => ({ product, ads })); }
  if (admgr.copyMode === 'new') { const p = c.prods.find(x => x.goods.some(g => setIds.includes(g.s.id))); admgr.copyProduct = p ? p.name : ''; }
  admgrCopyModal();
}
function admgrPromoCut(ids) {   // 승격한 소재의 원본 테스트 세트 예산 1,000원 임시 저장 → 게시로 반영
  let n = 0; for (const id of ids) { admgrDraft[id] = 1000; n++; } lsSet('adc_admgr_draft', admgrDraft);
  toast(`테스트 세트 ${n}개 예산 1,000원을 임시 저장했어요 — 상단 [게시]로 반영`); closeModal('admgr-budget-modal'); renderAdmgr(true);
}

/* ── 검사 ⑧ 소재 피로 → 추가소재 요청 자동 등록 (2026-10-23): 상품 단위로 "이번 주(최근 7일) 구매당 비용"이 "지난주(8~14일 전)"보다 fatigue% 이상 오르고
   지난주 구매가 fatigueMinPur 이상이면 → 그 상품의 가장 잘 된 테스트 소재에 '추가소재 요청'을 자동으로 올리고(메모에 숫자), 알림판에 한 줄.
   같은 상품은 fatigueCooldown일 안에 다시 올리지 않음(계정 공유 fatigue_log). 이미 열린 요청(요청만 되고 제작완료 전)이 있으면 올리지 않고 알림만 */
function admgrFatigueCalc(hNow, hPrev, cfg) {   // 순수 계산 — [{ prod, cpaNow, cpaPrev, purNow, purPrev, up }]
  const agg = h => { const m = new Map(); for (const c of (h && h.campaigns) || []) for (const s of c.adsets || []) { if (!(s.spend > 0)) continue; const k = admgrProductOf(s); const o = m.get(k) || { spend: 0, pur: 0 }; o.spend += s.spend; o.pur += s.purchases || 0; m.set(k, o); } return m; };
  const now = agg(hNow), prev = agg(hPrev), out = [];
  for (const [prod, a] of now) { const b = prev.get(prod); if (!b || b.pur < cfg.fatigueMinPur || a.pur < 5) continue;
    const cpaNow = a.spend / a.pur, cpaPrev = b.spend / b.pur, up = (cpaNow - cpaPrev) / cpaPrev;
    if (up * 100 >= cfg.fatigue) out.push({ prod, cpaNow, cpaPrev, purNow: a.pur, purPrev: b.pur, up }); }
  return out.sort((x, y) => y.up - x.up);
}
async function admgrFatigueEnsure() {
  const A = admgrAlert; if (admgr.demo || !admgrCfg() || A.fLoading || (A.hPrev && Date.now() - A.hPrevAt < 30 * 60000)) return;
  A.fLoading = true;
  try {
    const d = todayStr(0), sh = (n) => admgrShiftDay(d, n);
    const [hp, log] = await Promise.all([metaGet({ action: 'hierarchy', preset: 'custom', since: sh(-14), until: sh(-8) }), sbCall('client-log', { action: 'state_get', key: 'fatigue_log' })]);
    A.hPrev = hp; A.hPrevAt = Date.now(); A.fLog = (log && log.data) || { prods: {} }; A.fLogVer = (log && log.ver) || null;
    renderAdmgr(true); setTimeout(() => admgrFatigueAuto(), 0);
  } catch (e) { A.hPrev = A.hPrev || null; }
  A.fLoading = false;
}
function admgrFatigueOpenReq(prod) {   // 그 상품에 열린 추가소재 요청(요청됨·제작완료 전)이 있나
  const t = admgr.test; if (!t || !t.loaded) return false;
  return ((t.data || {}).ads || []).some(a => admgrProductOf(a) === prod && (() => { const m = t.state.get(a.id) || {}; return m.asset_req_at && !m.asset_done_at; })());
}
async function admgrFatigueAuto() {   // 자동 등록 — 테스트 소재 데이터가 있어야 어느 소재에 올릴지 안다 (없으면 불러오고 다음 렌더에서)
  const A = admgrAlert, cfg = admgrAlertCfg(); if (!A.h7 || !A.hPrev || !A.fLog || A.fBusy || !dnrbCan('creative')) return;
  const t = admgr.test; if (!t.loaded) { if (!t.loading && typeof admgrTestFetch === 'function') admgrTestFetch().then(() => admgrFatigueAuto()); return; }
  const hits = admgrFatigueCalc(A.h7, A.hPrev, cfg), today = todayStr(0), log = A.fLog.prods || (A.fLog.prods = {}), none = A.fLog.none || (A.fLog.none = {});
  const fresh = (m, k) => !(m[k] && admgrShiftDay(m[k], cfg.fatigueCooldown) > today);   // 재알림 간격 안이면 건너뜀
  const due = hits.filter(h => fresh(log, h.prod) && fresh(none, h.prod) && !admgrFatigueOpenReq(h.prod));
  if (!due.length) return;
  A.fBusy = true;
  try {
    for (const h of due) {
      // 테스트 완료로 _test를 뗀 소재(gone, 60일 보관)도 요청 대상 — 완료된 소재가 곧 그 상품의 대표 소재라서. 켜진 것 먼저, 구매 많은 순
      const ads = ((t.data || {}).ads || []).filter(a => admgrProductOf(a) === h.prod && !(t.state.get(a.id) || {}).hidden).sort((x, y) => (x.gone ? 1 : 0) - (y.gone ? 1 : 0) || (y.purchases || 0) - (x.purchases || 0));
      const a = ads[0]; if (!a) { none[h.prod] = today; continue; }   // 테스트 소재 기록이 전혀 없는 상품(CBO만·옛 세트) — 요청 올릴 자리가 없어 알림만
      const cur = t.state.get(a.id) || {}, note = `자동 · 피로 감지 ${today.slice(5)}: 구매당 ${comma(Math.round(h.cpaPrev))}→${comma(Math.round(h.cpaNow))}원 (+${Math.round(h.up * 100)}%)`;
      await admgrTestSave(a.id, { asset_req_at: new Date().toISOString(), memo: ((cur.memo ? cur.memo + ' / ' : '') + note).slice(0, 500) });
      log[h.prod] = today;
    }
    const r = await sbCall('client-log', { action: 'state_set' }, { key: 'fatigue_log', base: A.fLogVer, data: A.fLog });
    if (r.conflict) { A.fLog = r.data || { prods: {} }; A.fLogVer = r.ver; } else A.fLogVer = r.ver;
    renderAdmgr(true);
  } catch (e) { toast('피로 감지 요청 등록 실패: ' + e.message); }
  A.fBusy = false;
}
function admgrCheckFatigue(cfg) {
  const A = admgrAlert; if (!A.h7 || !A.hPrev) { if (A.h7 && admgr.data && !admgr.demo) setTimeout(() => admgrFatigueEnsure(), 0); return []; }
  const hits = admgrFatigueCalc(A.h7, A.hPrev, cfg); if (!hits.length) return [];
  const log = (A.fLog && A.fLog.prods) || {}, none = (A.fLog && A.fLog.none) || {}, today = todayStr(0);
  const line = h => `${esc(h.prod)} ${comma(Math.round(h.cpaPrev))}→<b>${comma(Math.round(h.cpaNow))}</b>원(+${Math.round(h.up * 100)}%)`;
  const done = hits.filter(h => log[h.prod]), manual = hits.filter(h => !log[h.prod] && none[h.prod]), wait = hits.filter(h => !log[h.prod] && !none[h.prod]);
  const out = [];
  if (done.length) out.push({ key: 'fatigue:' + today, lvl: 'yellow', text: `<b>소재 피로</b> ${done.length}개 상품 — 추가소재 요청을 올려뒀어요 <small>(구매당 비용 지난주→이번 주)</small><br/>${done.map(line).join(' · ')}`, act: { label: '요청 보기', onclick: 'admgrReqListModal()' } });
  if (manual.length) out.push({ key: 'fatigue-m:' + today, lvl: 'yellow', text: `<b>소재 피로</b> ${manual.length}개 상품 — 테스트 소재가 없어(세트명에 test 없음·CBO만) 요청은 직접 올려주세요<br/>${manual.map(line).join(' · ')}` });
  if (wait.length) out.push({ key: 'fatigue-w:' + today, lvl: 'yellow', text: `<b>소재 피로</b> ${wait.length}개 상품 ${dnrbCan('creative') ? '— 테스트 소재를 확인하는 대로 추가소재 요청을 올려요' : ''}<br/>${wait.map(line).join(' · ')}` });
  return out;
}
admgrAlert.checks.push(admgrCheckFatigue);

/* ── 검사 ⑨ 작년 같은 시즌 승자 (2026-10-23): Meta 성과는 37개월 조회가 되므로 '작년 (3~7주 뒤) 기간'의 세트를 구매순으로 본다 — 끌올 소재를 Meta에서 뒤지지 않게.
   하루 한 번 받아 브라우저에 보관(adc_admgr_season). 지금 켜진 세트에 같은 상품이 있으면 '끌올됨' */
const ADMGR_SEASON = { lead: 21, span: 28, minPur: 20, minRoas: 3, top: 12 };
function admgrGuessProduct(name) {   // 옛 이름('영상_(기모ver.) 클레르 블라우스_24.000')도 상품명으로 — 상품 목록에서 찾기 → 없으면 가장 긴 토막(괄호·날짜·가격·색상 제거)
  const base = admgrBase(name), n = admgrNorm(base), p = (typeof admgrProdIdx === 'function' ? admgrProdIdx() : []).find(x => n.includes(x.n));
  if (p) return coreName(p.name);
  return base.split('_').map(x => coreName(x).replace(/^\d{3,4}\s+/, '').replace(/\d{1,3}([.,]\d{3})+|\d{4,6}/g, '').replace(/\s*-\s*[가-힣]+\s*$/, '').replace(/\s+\d{1,3}$/, '').replace(/\s+/g, ' ').trim())
    .filter(x => x && !/^\d+$/.test(x) && !/^(영상|이미지|릴스|스토리|인스타|메인|히어로|전환|테스트|사본)\d*$/.test(x)).sort((a, b) => b.length - a.length)[0] || admgrProductOf({ adset_name: base });
}
function admgrSeasonRange(today) { const base = admgrShiftDay(today, -365); return { since: admgrShiftDay(base, ADMGR_SEASON.lead), until: admgrShiftDay(base, ADMGR_SEASON.lead + ADMGR_SEASON.span - 1) }; }
function admgrSeasonCalc(h, curSets, today) {   // 순수 계산 → [{ name, camp, pur, roas, spend, prod, now }]
  const live = new Set((curSets || []).filter(s => s.status === 'ACTIVE').map(s => admgrNorm(admgrGuessProduct(s.name))));
  return ((h && h.campaigns) || []).flatMap(c => (c.adsets || []).map(s => ({ ...s, camp: c.name })))
    .filter(s => s.spend > 0 && (s.purchases || 0) >= ADMGR_SEASON.minPur && s.value / s.spend >= ADMGR_SEASON.minRoas)
    .map(s => { const prod = admgrGuessProduct(s.name); return { name: s.name, camp: s.camp, pur: s.purchases, roas: s.value / s.spend, spend: s.spend, prod, now: live.has(admgrNorm(prod)) }; })
    .sort((x, y) => y.pur - x.pur).slice(0, ADMGR_SEASON.top);
}
async function admgrSeasonEnsure() {
  const A = admgrAlert, today = todayStr(0); if (admgr.demo || !admgrCfg() || A.sLoading) return;
  const saved = lsGet('adc_admgr_season', null); if (saved && saved.day === today) { A.season = saved.h; return; }
  A.sLoading = true;
  try { const r = admgrSeasonRange(today); A.season = await metaGet({ action: 'hierarchy', preset: 'custom', since: r.since, until: r.until }); lsSet('adc_admgr_season', { day: today, h: A.season }); renderAdmgr(true); }
  catch (e) { A.season = A.season || null; }
  A.sLoading = false;
}
function admgrSeasonCands() { const A = admgrAlert; if (!A.season) { if (admgr.data && !admgr.demo) setTimeout(() => admgrSeasonEnsure(), 0); return null; } return admgrSeasonCalc(A.season, admgrRows().sets, todayStr(0)); }
function admgrCheckSeason() {
  const L = admgrSeasonCands(); if (!L || !L.length) return [];
  const r = admgrSeasonRange(todayStr(0)), fresh = L.filter(x => !x.now).length;
  return [{ key: 'season:' + todayStr(0), lvl: 'blue', text: `<b>작년 이맘때 베스트</b> ${L.length}개 <small>작년 ${r.since.slice(5)}~${r.until.slice(5)} 구매순${fresh ? ` · 아직 안 켠 상품 ${fresh}개` : ' · 전부 끌올됨'}</small>`, act: { label: '보기', onclick: 'admgrSeasonModal()' } }];
}
admgrAlert.checks.push(admgrCheckSeason);
function admgrSeasonCopy(n) { navigator.clipboard.writeText(n).then(() => toast('세트명을 복사했어요 — Meta 광고관리자 검색창에 붙여넣어 찾은 뒤 복사하세요'), () => toast('복사 실패 — 이름을 직접 선택해 복사하세요')); }
function admgrSeasonModal() {
  const L = admgrSeasonCands() || [], r = admgrSeasonRange(todayStr(0));
  const row = x => `<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #f3f4f6;font-size:.78rem;"><span style="flex:1;min-width:0;word-break:break-all;"><b style="color:#1e1b4b;">${esc(x.prod)}</b><div style="color:#6b7280;font-size:.7rem;">${esc(admgrBase(x.name))} · ${esc(x.camp)}</div></span><span style="flex:none;color:#374151;">구매 <b>${x.pur}</b> · ROAS ${x.roas.toFixed(1)}</span>${x.now ? '<span class="status-badge badge-green" style="flex:none;font-size:.62rem;">끌올됨</span>' : `<button class="ag-al-btn" style="flex:none;" data-n="${esc(admgrBase(x.name))}" onclick="admgrSeasonCopy(this.dataset.n)">세트명 복사</button>`}</div>`;
  $('abm-title').textContent = '작년 이맘때 베스트 (3~7주 뒤 시즌)'; $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = `<div style="font-size:.74rem;color:#6b7280;margin-bottom:6px;">작년 ${r.since}~${r.until} · 구매 ${ADMGR_SEASON.minPur}건↑ · ROAS ${ADMGR_SEASON.minRoas}↑ · 구매 많은 순 ${ADMGR_SEASON.top}개 · "끌올됨" = 지금 같은 상품 세트가 켜져 있음</div>
    <div style="max-height:50vh;overflow:auto;">${L.map(row).join('') || '<div style="color:#9ca3af;padding:10px 0;">작년 이 기간에 기준을 넘은 세트가 없어요</div>'}</div>
    <div style="font-size:.7rem;color:#9ca3af;margin-top:8px;line-height:1.6;">끌올 순서: Meta에서 세트 복사 → 대시보드 새로고침 → ⋯ 메뉴 '끌올 사본 정리'로 이름 맞추기</div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn-analyze" onclick="closeModal('admgr-budget-modal')">닫기</button></div>`;
  $('admgr-budget-modal').classList.add('show');
}

/* ── 검사 ⑩ 이름·페이지 위생 (2026-10-23): ' - 사본' 미정리 세트 · 3일 안에 만든 테스트 캠페인 세트 중 이름 규칙(상품명_R1_소구점_마진_날짜_test) 밖 · 다른 페이스북 페이지로 나가는 광고(adpages, 30분마다) */
const AG_NAME_OK = /^[^_]+_.*_\d+_\d{6}(_test)?$/;   // 느슨한 규칙: 상품명_…_마진_YYMMDD(_test) — 인스타게시물 세트(R/P 번호 없음)·테스트 완료(_test 뗌)도 통과
function admgrHygieneCalc(sets, pages, today) {
  const out = [];
  const copies = sets.filter(s => AG_COPY_TAIL.test(admgrBase(s.name)));
  if (copies.length) out.push({ key: 'hy-copy:' + today, lvl: 'yellow', text: `<b>사본 세트</b> ${copies.length}개 — 이름이 아직 "- 사본"이에요`, act: { label: '끌올 사본 정리', onclick: 'admgrRepostModal()' } });
  const since = admgrShiftDay(today, -3);
  const odd = sets.filter(s => /테스트/.test(s._campName || '') && String(s.created || '').slice(0, 10) >= since && !AG_NAME_OK.test(admgrBase(s.name)) && !AG_COPY_TAIL.test(admgrBase(s.name)));
  if (odd.length) out.push({ key: 'hy-name:' + today, lvl: 'yellow', text: `<b>이름 규칙 밖</b> 최근 3일 테스트 세트 ${odd.length}개 <small>${esc(odd.slice(0, 3).map(s => admgrBase(s.name)).join(' · '))}${odd.length > 3 ? ' …' : ''}</small> — '상품명_…_마진_날짜' 형식이 아니면 테스트 탭·리포트에서 상품을 못 잡아요` });
  if (pages && pages.length) {
    const cnt = {}; pages.forEach(a => { cnt[a.page_id] = (cnt[a.page_id] || 0) + 1; });
    const main = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
    const off = pages.filter(a => a.page_id && a.page_id !== main);
    if (off.length) out.push({ key: 'hy-page:' + today, lvl: 'red', text: `<b>다른 페이지로 나가는 광고</b> ${off.length}개 — ${esc(off.slice(0, 3).map(a => a.name).join(' · '))}${off.length > 3 ? ' …' : ''} <small>(페이지 ${esc(off[0].page || off[0].page_id)})</small>` });
  }
  return out;
}
async function admgrPagesEnsure() {
  const A = admgrAlert; if (admgr.demo || !admgrCfg() || A.pLoading || (A.pages && Date.now() - A.pagesAt < 30 * 60000) || !dnrbCan('budget')) return;
  A.pLoading = true;
  try { const d = await metaGet({ action: 'adpages' }); A.pages = d.ads || []; A.pagesAt = Date.now(); renderAdmgr(true); } catch (e) { A.pages = A.pages || []; A.pagesAt = Date.now(); }
  A.pLoading = false;
}
function admgrCheckHygiene() {
  const A = admgrAlert; if (!A.pages && admgr.data && !admgr.demo) setTimeout(() => admgrPagesEnsure(), 0);
  return admgrHygieneCalc(admgrRows().sets, A.pages || null, todayStr(0));
}
admgrAlert.checks.push(admgrCheckHygiene);

/* ── 추가소재 요청 목록 (2026-10-23): 요청됐고 아직 제작완료 전인 소재 — 피로 자동 등록분·수동 요청 모두. 컨텐츠팀 화면(내 소재 성과 '만들어 달라는 요청')과 같은 데이터 */
function admgrReqListModal() {
  const t = admgr.test; if (!t.loaded) { toast('테스트 소재를 불러오는 중이에요 — 잠시 뒤 다시'); if (!t.loading && typeof admgrTestFetch === 'function') admgrTestFetch().then(() => admgrReqListModal()); return; }
  const L = ((t.data || {}).ads || []).map(a => ({ a, m: t.state.get(a.id) || {} })).filter(x => x.m.asset_req_at).sort((x, y) => (x.m.asset_done_at ? 1 : 0) - (y.m.asset_done_at ? 1 : 0) || String(y.m.asset_req_at).localeCompare(String(x.m.asset_req_at)));
  const open = L.filter(x => !x.m.asset_done_at);
  const row = x => `<div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:.78rem;${x.m.asset_done_at ? 'opacity:.55;' : ''}">
      <span style="flex:1;min-width:0;"><b style="color:#1e1b4b;">${esc(admgrProductOf(x.a))}</b> <span style="color:#6b7280;font-size:.7rem;word-break:break-all;">${esc(admgrBase(x.a.adset_name || x.a.name))}</span>
        <div style="color:#6b7280;font-size:.7rem;">${fmtMD(String(x.m.asset_req_at).slice(0, 10))} 요청${x.m.asset_done_at ? ` · <span style="color:#15803d;font-weight:700;">${fmtMD(String(x.m.asset_done_at).slice(0, 10))} 제작완료</span>` : ''}${x.m.memo ? ` · ${esc(x.m.memo)}` : ''}</div></span>
      ${x.m.asset_done_at ? '' : `<button class="ag-al-btn" style="flex:none;" onclick="admgrTestAsset('${esc(x.a.id)}','asset_done_at').then(()=>admgrReqListModal())">제작완료</button>`}</div>`;
  $('abm-title').textContent = `추가소재 요청 — 진행 중 ${open.length}개`; $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = `<div style="font-size:.74rem;color:#6b7280;margin-bottom:6px;">컨텐츠팀은 <b>내 소재 성과 → 만들어 달라는 요청</b>에서 같은 목록을 봐요 · "자동 · 피로 감지"는 알림판이 올린 것</div>
    <div style="max-height:50vh;overflow:auto;">${L.map(row).join('') || '<div style="color:#9ca3af;padding:10px 0;">요청이 없어요</div>'}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn-analyze" onclick="closeModal('admgr-budget-modal')">닫기</button></div>`;
  $('admgr-budget-modal').classList.add('show');
}

/* ── 예산 조정 플랜 (2026-10-25): Claude가 계산해 shared_state 'budget_plan'에 저장한 세트별 변경(from→to)을 임시 저장으로 한 번에 넣는다 → 사용자가 확인 후 [게시].
   지금 예산이 플랜의 from과 다른 세트(그 사이 바뀜)는 건너뛰고 알려준다. 적용하면 applied_at을 기록해 다른 사람 화면에서도 사라진다 */
async function admgrPlanEnsure() {
  const A = admgrAlert; if (admgr.demo || !admgrCfg() || A.planLoading || (A.plan !== undefined && Date.now() - (A.planAt || 0) < 5 * 60000)) return;
  A.planLoading = true;
  try { const r = await sbCall('client-log', { action: 'state_get', key: 'budget_plan' }); A.plan = (r && r.data) || null; A.planVer = (r && r.ver) || null; A.planAt = Date.now(); renderAdmgr(true); } catch (e) { A.plan = A.plan || null; A.planAt = Date.now(); }
  A.planLoading = false;
}
function admgrCheckPlan() {
  const A = admgrAlert; if (A.plan === undefined) { if (admgr.data && !admgr.demo) setTimeout(() => admgrPlanEnsure(), 0); return []; }
  const P = A.plan; if (!P || P.applied_at || !Array.isArray(P.items)) return [];
  const ch = P.items.filter(i => i.to !== i.from), up = ch.filter(i => i.to > i.from).length;
  if (!ch.length || !dnrbCan('budget')) return [];
  return [{ key: 'plan:' + String(P.at).slice(0, 10), lvl: 'blue', text: `<b>예산 조정 플랜</b> ${ch.length}건 (증액 ${up} · 감액 ${ch.length - up}) <small>${esc(P.title || '')} · ${fmtMD(String(P.at).slice(0, 10))} 계산</small>`, act: { label: '임시 저장에 넣기', onclick: 'admgrPlanApply()' } }];
}
async function admgrPlanApply() {
  const A = admgrAlert, P = A.plan; if (!P) return;
  const sets = new Map(admgrRows().sets.map(s => [s.id, s]));
  let n = 0; const skipped = [], gone = [];
  for (const it of P.items) { if (it.to === it.from) continue; const s = sets.get(it.id); if (!s) { gone.push(it.name); continue; } if (s.budget !== it.from) { skipped.push(`${admgrBase(it.name)} (지금 ${comma(s.budget)} ≠ 플랜 기준 ${comma(it.from)})`); continue; } admgrDraft[it.id] = it.to; n++; }
  lsSet('adc_admgr_draft', admgrDraft);
  try { const r = await sbCall('client-log', { action: 'state_set' }, { key: 'budget_plan', base: A.planVer, data: { ...P, applied_at: new Date().toISOString(), applied_by: typeof ADMGR_USER !== 'undefined' ? ADMGR_USER : '' } }); if (!r.conflict) { A.plan = { ...P, applied_at: new Date().toISOString() }; A.planVer = r.ver; } } catch (e) { /* 표시만 — 임시 저장은 이미 들어감 */ }
  $('abm-title').textContent = '예산 조정 플랜 → 임시 저장'; $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = `<div style="font-size:.82rem;color:#374151;line-height:1.7;">세트 <b style="color:#15803d;">${n}</b>개의 변경을 임시 저장에 넣었어요. 표에서 금액을 확인·수정한 뒤 상단 <b>[게시]</b>를 눌러야 Meta에 반영돼요.
    ${skipped.length ? `<div style="margin-top:8px;color:#b45309;"><b>건너뜀 ${skipped.length}개</b> — 플랜 계산 뒤 예산이 바뀐 세트 (직접 정하세요)<div style="font-size:.74rem;color:#6b7280;">${skipped.map(esc).join('<br/>')}</div></div>` : ''}
    ${gone.length ? `<div style="margin-top:8px;color:#9ca3af;font-size:.74rem;">화면 데이터에 없는 세트 ${gone.length}개 — 새로고침 뒤 다시 시도</div>` : ''}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn-analyze" onclick="closeModal('admgr-budget-modal');admgrSetView('set');renderAdmgr()">세트 표에서 확인</button></div>`;
  $('admgr-budget-modal').classList.add('show'); renderAdmgr(true);
}
admgrAlert.checks.push(admgrCheckPlan);
