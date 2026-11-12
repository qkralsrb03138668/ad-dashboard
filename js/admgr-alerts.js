/* ═══ 알림판 (2026-10-23, 사용자 요청: 상한·피로 같은 알림을 광고관리자 맨 위 한 곳에) ═══
   #admgr-banner 자리에 그린다. 머리줄 = 켜진 일예산 합계(세트+CBO)와 상한, 그 아래 = 검사 항목들.
   기준값은 계정 공유 설정(shared_state 'admgr_alert_cfg', 관리자만 저장) — ⋯ 메뉴 '알림 기준' 또는 머리줄 [기준] 버튼.
   검사는 admgrAlert.checks에 함수로 등록: (cfg) → [{ key, lvl:'red'|'yellow'|'blue', text(html), act?:{label, onclick} }]. '오늘 하루 숨기기'는 이 브라우저에만.
   (index.html에서 분리 로드 — 전역 함수·변수를 그대로 공유) */
'use strict';
const ADMGR_ALERT_DEF = { cap: 4500000 };   // 소재 피로(전주 대비 ROAS 20%↓ → 추가소재 요청 자동 등록)·주말 모드는 2026-11-02 사용자 요청으로 뺌 — 알림판은 예산 조정 후보 · 7일 점검표 · 품절 · 위생만
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
  if (!admgr.products && !admgr.productsLoading && admgrCfg()) setTimeout(() => admgrLoadProducts(), 0);   // 마진(판매가·공급가)이 있어야 주말 모드·승격 후보·플랜 비율이 나온다 — 광고관리자 첫 화면에선 안 불러오던 경우가 있었다 (2026-10-26)
  const cfg = admgrAlertCfg(), B = admgrBudgetTotal(false), over = cfg.cap > 0 && B.total > cfg.cap;
  const items = admgrAlertItems(), hide = lsGet('adc_admgr_alert_hide', {}), today = todayStr(0);
  const shown = items.filter(i => hide[i.key] !== today);
  const row = i => `<div class="ag-al ag-al-${i.lvl}"><span class="ag-al-dot"></span><span class="ag-al-txt">${i.text}</span>${i.act ? `<button class="ag-al-btn" onclick="${i.act.onclick}">${esc(i.act.label)}</button>` : ''}<button class="ag-al-x" onclick="admgrAlertHide('${esc(i.key)}')" title="오늘 하루 숨기기" aria-label="오늘 하루 숨기기">×</button></div>`;
  return `<div class="ag-alerts">
    <div class="ag-al ag-al-head ${over ? 'ag-al-red' : ''}"><span class="ag-al-dot"></span><span class="ag-al-txt"><b>켜진 일예산 ${admgrW(B.total)}원</b> <small>세트 ${admgrW(B.sets)} · CBO ${admgrW(B.cbo)}${cfg.cap > 0 ? ` · 상한 ${admgrW(cfg.cap)}` : ''}</small>${over ? ` <b class="ag-al-over">상한 초과 +${admgrW(B.total - cfg.cap)}</b>` : ''}</span>${typeof dnrbCan === 'function' && dnrbCan('budget') ? `<button class="ag-al-btn ghost" onclick="admgrAlertCfgModal()" title="상한·피로 기준 편집"><i class="fa-solid fa-sliders"></i> 기준</button>` : ''}</div>
    ${shown.map(row).join('')}${items.length && !shown.length ? `<div class="ag-al-muted">알림 ${items.length}개 오늘 숨김 · <a href="#" onclick="lsSet('adc_admgr_alert_hide',{});renderAdmgr(true);return false;">다시 보기</a></div>` : ''}</div>`;
}
function admgrAlertHide(key) { const h = lsGet('adc_admgr_alert_hide', {}); h[key] = todayStr(0); lsSet('adc_admgr_alert_hide', h); renderAdmgr(true); }
function admgrAlertCfgModal() {
  const c = admgrAlertCfg();
  const f = (k, label, unit, step) => `<label style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #f3f4f6;font-size:.8rem;"><span style="flex:1;">${label}</span><input id="alc-${k}" class="inp" type="number" min="0" step="${step || 1}" value="${c[k]}" style="width:120px;text-align:right;" /><span style="width:28px;color:#6b7280;">${unit}</span></label>`;
  $('abm-title').textContent = '알림 기준'; $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = `${f('cap', '켜진 일예산 합계 상한 (0 = 경고 안 함)', '원', 10000)}
    <div style="font-size:.7rem;color:#9ca3af;margin-top:8px;line-height:1.6;">모든 계정에 같이 적용돼요 · 비우면 기본값(상한 450만)</div>
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

/* 검사 ③ CBO 독식은 2026-10-28 사용자 요청으로 뺌 (CBO 승격 없이 ABO로만 운영)
   2026-10-29 정리(사용자 승인): 23:45 원복 승인·반영 결과 알림, 작년 이맘때 베스트(→ 베스트 탭 아래에만), 예산 조정 플랜(→ 예산 조정 후보로 대체)을 알림판에서 뺌 */

/* ── 검사 ⑦ 승격 후보 (2026-10-23): 테스트 캠페인(이름에 '테스트') 안 켜진 세트의 **최근 7일 Meta 성과**로 — 월요일 브리핑(daily-brief-data.mjs promotion)과 같은 기준.
   종합 CBO 후보 = 7일 구매 30↑ · ROAS 5↑ · 아직 [→CBO] 표시 없음 · 그 상품의 상품 CBO가 켜져 있지 않음
   상품 CBO 후보 = 한 상품에 우수 세트(7일 구매 10↑ · ROAS 손익×2.5↑, 상품 모르면 5↑) 2개↑ 이고 상품 7일 구매 60↑ · 상품 CBO 없음
   테스트 소재 탭 데이터(_test 이름 기준)가 아니라 캠페인 기준인 이유: 테스트 완료로 _test를 뗀 세트가 테스트 캠페인에 그대로 돌아가는데 그게 승격 대상이라서.
   7일 계층 데이터는 패널이 열릴 때 한 번(30분 유지) 따로 받는다 — 서버 5분 캐시라 Meta 추가 호출은 거의 없음 */
const ADMGR_PROMO = { on: false, pur: 30, roas: 5, goodPur: 10, goodMul: 2.5, prodPur: 100, goodMin: 2, prodPct: 35, trend: 1.15, allPct: 30, outPct: 40 };   // 종합 CBO (2026-10-26 사용자 승인): 넣기 = 세트 7일 30건↑ · 7일 구매당 비용 ≤ 마진 30% · 3일 안 꺾임(ROAS 5 기준 대체 — 헤이 나그랑처럼 마진 얇은 상품이 들어가던 것) / 빼기 = 광고 3일 구매당 비용 > 마진 40%   // 상품 CBO (2026-10-26 사용자 승인): 7일 100건↑ · 상품 7일 구매당 비용 ≤ 마진 35% · 최근 3일 구매당 비용 ≤ 7일 × 1.15 (꺾이는 상품 제외) — 하울·슬리즈가 60건 기준으로 꺾이는 중에 올라갔던 것
async function admgrPromoEnsure() {
  const A = admgrAlert; if (admgr.demo || !admgrCfg() || A.h7Loading || (A.h7 && Date.now() - A.h7At < 30 * 60000) || Date.now() - (A.h7FailAt || 0) < 5 * 60000) return;
  A.h7Loading = true;
  try { const [h7, h3] = await Promise.all([admgrSkipHit(7) ? admgrHierClean(7) : metaGet({ action: 'hierarchy', preset: 'last_7d' }), (admgrSkipHit(3) ? admgrHierClean(3) : metaGet({ action: 'hierarchy', preset: 'custom', since: todayStr(-3), until: todayStr(-1) })).catch(() => null)]);   // 판정에서 빼는 날(ADMGR_SKIP_DAYS)이 창에 걸리면 깨끗한 날만   // h3 = 어제까지 3일 — 상품 CBO 추세 확인용
    A.h7 = h7; A.h3 = h3; A.h7At = Date.now(); A.h7FailAt = 0; renderAdmgr(true); } catch (e) { A.h7 = A.h7 || null; A.h7FailAt = Date.now(); }   // 실패하면 5분 쉼 — 렌더마다 재시도하던 것 (2026-10-26 점검)
  /* CBO 캠페인에서 이미 돌아가는 소재(영상·이미지·이름) — 세트 이름의 [→] 표시가 없어도(메타에서 직접 복사, 표시 정리 뒤) 후보에서 빼기 위해 (2026-10-26 사용자 지적) */
  if (ADMGR_PROMO.on) try {
    const cboSets = []; for (const c of ((A.h7 || {}).campaigns || [])) if (c.budget > 0 && c.status === 'ACTIVE') for (const s of (c.adsets || [])) if (s.status === 'ACTIVE') cboSets.push(s.id);
    const keys = new Set(), names = new Set();
    for (let i = 0; i < cboSets.length; i += 100) { const d = await metaGet({ action: 'creatives', set_ids: cboSets.slice(i, i + 100).join(',') }); for (const a of (d.ads || [])) { if (a.effective_status !== 'ACTIVE') continue; if (a.video_id) keys.add('v:' + a.video_id); if (a.image_hash) keys.add('i:' + a.image_hash); names.add(admgrPromoBase(a.name)); } }
    A.cboKeys = keys; A.cboNames = names;
    const testSets = []; for (const c of ((A.h7 || {}).campaigns || [])) if (/테스트/.test(c.name) && c.status === 'ACTIVE') for (const s of (c.adsets || [])) if (s.status === 'ACTIVE' && (s.spend || 0) > 0) testSets.push(s.id);
    const setKeys = new Map();
    for (let i = 0; i < testSets.length; i += 100) { const d = await metaGet({ action: 'creatives', set_ids: testSets.slice(i, i + 100).join(',') }); for (const a of (d.ads || [])) { const L = setKeys.get(String(a.adset_id)) || setKeys.set(String(a.adset_id), []).get(String(a.adset_id)); if (a.video_id) L.push('v:' + a.video_id); if (a.image_hash) L.push('i:' + a.image_hash); L.push('n:' + admgrPromoBase(a.name)); } }
    A.setKeys = setKeys; renderAdmgr(true);
  } catch (e) { /* 소재 비교 실패 — 이름 표시 기준만으로 */ }
  A.h7Loading = false;
}
const admgrPromoBase = n => String(n || '').normalize('NFC').replace(/\s*-\s*사본\s*\d*$/g, '').replace(/\s*\/\s*CBO\d*/gi, '').replace(/\s*\[→[^\]]+\]/g, '').replace(/[_\s-]*재?test\s*$/i, '').replace(/\s+/g, ' ').trim();
const admgrPromoInCbo = s => { const A = admgrAlert; if (!A.setKeys) return false; const L = A.setKeys.get(String(s.id)) || []; return L.some(k => k.startsWith('n:') ? (A.cboNames || new Set()).has(k.slice(2)) : (A.cboKeys || new Set()).has(k)); };   // 같은 영상·이미지·이름의 광고가 CBO 캠페인에서 켜져 있음
function admgrPromoCands() {
  if (!ADMGR_PROMO.on) return { ads: [], prods: [], ready: true };   // 2026-10-28 사용자: CBO 승격 없이 ABO로만 운영해 보기 — 다시 켜려면 ADMGR_PROMO.on = true
  const h = admgrAlert.h7; if (!h || !h.campaigns) { if (!admgr.demo && admgrCfg()) setTimeout(() => admgrPromoEnsure(), 0); return { ads: [], prods: [], ready: false }; }   // 테스트 소재 메뉴로 바로 들어와 광고관리자 데이터가 없어도 7일 성과는 따로 받는다
  const prodCbo = new Set(h.campaigns.filter(c => /^상품CBO_/.test(admgrBase(c.name)) && c.status === 'ACTIVE').map(c => admgrNorm(admgrBase(c.name).replace(/^상품CBO_/, '').replace(/_\d{6}$/, ''))));
  const rows = [];
  for (const c of h.campaigns) { if (!/테스트/.test(c.name) || c.status !== 'ACTIVE') continue;
    for (const s of (c.adsets || [])) { if (s.status !== 'ACTIVE' || !(s.spend > 0)) continue;
      const p = admgrP7(s), roas = admgrV7(s) / s.spend, prod = admgrProductOf(s), pc = prodCbo.has(admgrNorm(prod));   // 클릭 후 7일 기준 (2026-10-25) — 조회 기여 제외
      const be = (typeof admgrBreakEven === 'function' && admgrBreakEven({ adset_id: s.id, adset_name: s.name, name: s.name }) || {}).be || null;
      rows.push({ s, a: { id: s.id, adset_id: s.id, adset_name: s.name, name: s.name }, p, roas, spend: s.spend, be, prod, prodCbo: pc, inCbo: /\[→/.test(s.name) || pc || admgrPromoInCbo(s), adIds: (s.ads || []).map(a => a.id), good: p >= ADMGR_PROMO.goodPur && roas >= (be ? be * ADMGR_PROMO.goodMul : ADMGR_PROMO.roas) }); } }
  const s3 = new Map(); for (const c of ((admgrAlert.h3 || {}).campaigns || [])) for (const s of (c.adsets || [])) { let p = 0; for (const a of (s.ads || [])) p += a.purchases_7d || 0; s3.set(s.id, { sp: s.spend || 0, p }); }
  const byProd = new Map(); rows.forEach(r => (byProd.get(r.prod) || byProd.set(r.prod, []).get(r.prod)).push(r));
  const toAll = new Set(lsGet('adc_promo_toall', []));   // 상품 CBO 후보지만 사용자가 "종합으로"라고 정한 상품 (2026-10-23 사용자 요청)
  // 이미 CBO(종합·상품)에서 도는 세트는 상품 후보 계산에서 뺀다 — 아직 승격 안 된 세트만으로 판단 (2026-10-26)
  const prods = [...byProd.entries()].map(([name, L0]) => { const L = L0.filter(r => !r.inCbo); return ({ name, n: L.length, pur: L.reduce((t, r) => t + r.p, 0), goods: L.filter(r => r.good).sort((x, y) => y.roas - x.roas), inCbo: L0.some(r => r.prodCbo),
      roas: L.reduce((t, r) => t + r.roas * r.spend, 0) / Math.max(1, L.reduce((t, r) => t + r.spend, 0)), toAll: toAll.has(name), ...admgrPromoProdEff(L, s3) }); })
    .filter(x => !x.inCbo && x.pur >= ADMGR_PROMO.prodPur && x.goods.length >= ADMGR_PROMO.goodMin && x.pct7 != null && x.pct7 <= ADMGR_PROMO.prodPct && x.trendOk).sort((x, y) => y.pur - x.pur);
  // 상품 CBO 후보로 분류된 상품의 세트는 종합 후보에 안 넣는다 — 사용자가 '종합으로' 돌린 상품만 예외 (2026-10-23 사용자 요청: 양쪽에 겹치지 않게)
  const prodOnly = new Set(prods.filter(x => !x.toAll).map(x => x.name));
  // [종합 CBO로] 보낸 상품은 그 상품의 '우수 세트'(상품 CBO 후보 기준) 전부가 종합 후보로 — 세트 하나하나가 30건을 넘어야 하던 규칙 때문에 상품당 1개만 넘어가던 문제 (2026-10-26 사용자 지적)
  const ads = rows.map(r => ({ ...r, ...admgrPromoProdEff([r], s3) })).filter(r => !r.inCbo && r.pct7 != null && r.pct7 <= ADMGR_PROMO.allPct && r.trendOk && (toAll.has(r.prod) ? r.good : (!prodOnly.has(r.prod) && r.p >= ADMGR_PROMO.pur))).map(r => ({ ...r, fromProd: toAll.has(r.prod) })).sort((x, y) => x.pct7 - y.pct7);
  return { ads, prods, ready: true, range: h.range };
}
function admgrPromoProdEff(L, s3) {   // 상품 전체 7일·3일 구매당 비용 ÷ 마진 (2026-10-26)
  let sp = 0, p = 0, sp3 = 0, p3 = 0, m = null;
  for (const r of L) { sp += r.spend; p += r.p; const t = s3.get(r.s.id); if (t) { sp3 += t.sp; p3 += t.p; } if (m == null) { const mm = admgrMarginOf({ id: r.s.id, name: r.s.name }).m; if (mm > 0) m = mm; } }
  const pct7 = p && m ? Math.round(sp / p / m * 100) : null, pct3 = p3 && m ? Math.round(sp3 / p3 / m * 100) : null;
  return { pct7, pct3, trendOk: pct7 != null && pct3 != null && sp3 / p3 <= (sp / p) * ADMGR_PROMO.trend };
}
function admgrCheckPromo() {
  const c = admgrPromoCands(); if (!c.ads.length && !c.prods.length) return [];
  return [{ key: 'promo:' + todayStr(0), lvl: 'blue', text: `<b>승격 후보</b> 종합 CBO ${c.ads.length}개 · 상품 CBO ${c.prods.length}개 <small>최근 7일 기준</small>`, act: { label: '보기', onclick: 'admgrPromoModal()' } }];
}
admgrAlert.checks.push(admgrCheckPromo);
/* 종합 CBO 빼기 후보 (2026-10-26 사용자 승인): 종합CBO 안에서 켜져 있는 광고 중 어제까지 3일 구매당 비용 > 마진 40% (구매 0이면 3일 지출 ≥ 마진) */
function admgrZongOut() {
  const A = admgrAlert; if (!ADMGR_PROMO.on || !A.h3 || !admgr.data) return [];
  const live = new Map(admgrRows().ads.map(a => [a.id, a]));
  const out = [];
  for (const c of (A.h3.campaigns || [])) { if (!/^종합CBO/.test(admgrBase(c.name))) continue;
    for (const s of (c.adsets || [])) for (const a of (s.ads || [])) {
      const now = live.get(a.id); if (!now || now.status !== 'ACTIVE' || (admgrSDraft[a.id] && admgrSDraft[a.id].status === 'PAUSED')) continue;
      const m = admgrMarginOf({ id: a.id, name: a.name }).m; if (!(m > 0) || !(a.spend > 0)) continue;
      const p = a.purchases_7d || 0, pct = p ? Math.round(a.spend / p / m * 100) : null;
      if (p ? pct > ADMGR_PROMO.outPct : a.spend >= m) out.push({ id: a.id, name: a.name, sp: a.spend, p, pct });
    } }
  return out.sort((x, y) => y.sp - x.sp);
}
function admgrCheckZongOut() {
  const L = admgrZongOut(); if (!L.length) return [];
  return [{ key: 'zongout:' + todayStr(0) + ':' + L.map(x => x.id).join(','), lvl: 'red',
    text: `<b>종합 CBO 빼기 후보</b> ${L.length}개 <small>어제까지 3일 구매당 비용 마진 ${ADMGR_PROMO.outPct}%↑</small> — ${L.slice(0, 3).map(x => `${esc(admgrBase(x.name).slice(0, 18))} ${x.p ? x.pct + '%' : '구매 0'}`).join(' · ')}${L.length > 3 ? ' …' : ''}`,
    act: dnrbCan('toggle') ? { label: `${L.length}개 끄기 임시 저장`, onclick: `admgrZongOff('${L.map(x => x.id).join(',')}')` } : null }];
}
function admgrZongOff(csv) {
  const ids = String(csv).split(',').filter(x => /^\d{5,25}$/.test(x)); if (!ids.length) return;
  for (const id of ids) admgrSDraft[id] = { level: 'ad', status: 'PAUSED' };
  lsSet('adc_admgr_sdraft', admgrSDraft);
  toast(`종합 CBO 광고 ${ids.length}개 끄기를 임시 저장했어요 — 상단 [게시]를 눌러야 Meta에 반영돼요`); renderAdmgr(true);
}
admgrAlert.checks.push(admgrCheckZongOut);
function admgrPromoModal(mode) {
  const c = admgrPromoCands(); admgr.promoMode = mode || admgr.promoMode || (c.ads.length ? 'all' : 'prod');
  const M = admgr.promoMode;
  const row = (r, chk) => `<label style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #f3f4f6;font-size:.78rem;cursor:pointer;"><input type="checkbox" class="pm-ad" value="${esc(r.s.id)}" ${chk ? 'checked' : ''} /><span style="flex:1;min-width:0;word-break:break-all;">${esc(admgrBase(r.s.name))}${r.fromProd ? ' <span class="status-badge badge-blue" style="font-size:.58rem;" title="상품 CBO 후보였지만 종합으로 보내기로 한 상품">상품→종합</span>' : ''}</span><span style="flex:none;color:#6b7280;">7일 구매 ${r.p} · ROAS <b>${r.roas.toFixed(1)}</b>${r.pct7 != null ? ` · 마진의 <b>${r.pct7}%</b> (3일 ${r.pct3 ?? '—'}%)` : ''}${r.inCbo ? ' · <span class="ag-mark">⧉ CBO 있음</span>' : ''}</span></label>`;
  let body;
  if (!c.ready) body = '<div style="color:#9ca3af;font-size:.8rem;padding:10px 0;">최근 7일 성과를 불러오는 중…</div>';
  else if (M === 'all') body = c.ads.length ? `<div style="font-size:.74rem;color:#6b7280;margin-bottom:6px;">최근 7일(${(c.range || {}).start || ''}~${(c.range || {}).end || ''}) 구매 ${ADMGR_PROMO.pur}건↑ · 구매당 비용 마진 ${ADMGR_PROMO.allPct}%↓ · 최근 3일 안 꺾임 · 아직 CBO에 없는 세트 — 체크해서 종합 CBO 세트에 복사</div>${c.ads.map(r => row(r, true)).join('')}` : '<div style="color:#9ca3af;font-size:.8rem;padding:10px 0;">지금 기준을 넘는 소재가 없어요</div>';
  else if (M !== 'all') body = c.prods.length ? `<div style="font-size:.74rem;color:#6b7280;margin-bottom:6px;">상품 CBO 후보로 잡힌 상품의 세트는 종합 후보에 안 올라가요 — 종합이 낫다고 보시면 [종합 CBO로]를 누르세요 (이 브라우저에 기억)</div>` + c.prods.map(x => `<div style="display:flex;align-items:center;gap:8px;margin:8px 0 4px;${x.toAll ? 'opacity:.6;' : ''}"><span style="flex:1;min-width:0;font-weight:800;font-size:.82rem;color:#1e1b4b;">${esc(x.name)} <span style="font-weight:600;color:#6b7280;font-size:.72rem;">7일 구매 ${x.pur} · 구매당 비용 마진의 ${x.pct7}% (3일 ${x.pct3}%) · 우수 소재 ${x.goods.length}개</span>${x.toAll ? ' <span class="status-badge badge-blue" style="font-size:.58rem;">종합으로 보냄</span>' : ''}</span><button class="ag-al-btn ${x.toAll ? 'ghost' : ''}" style="flex:none;" data-name="${esc(x.name)}" onclick="admgrPromoToAll(this.dataset.name, ${x.toAll ? 'false' : 'true'})">${x.toAll ? '상품 CBO로 되돌리기' : '종합 CBO로'}</button></div>${x.toAll ? '' : x.goods.map(r => row(r, true)).join('')}`).join('') : '<div style="color:#9ca3af;font-size:.8rem;padding:10px 0;">7일 구매 100건↑ · 구매당 비용 마진 35%↓ · 최근 3일 안 꺾임 · 우수 소재 2개↑인 상품이 없어요</div>';
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
  admgr.copyKind = admgr.promoMode === 'prod' ? 'prod' : 'all';   // 종합 후보 탭에서 새로 만들면 종합CBO_날짜 (2026-10-26)
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
  const A = admgrAlert, today = todayStr(0); if (admgr.demo || !admgrCfg() || A.sLoading || Date.now() - (A.sFailAt || 0) < 5 * 60000) return;
  const saved = lsGet('adc_admgr_season', null); if (saved && saved.day === today) { A.season = saved.h; return; }
  A.sLoading = true;
  try { const r = admgrSeasonRange(today); A.season = await metaGet({ action: 'hierarchy', preset: 'custom', since: r.since, until: r.until }); lsSet('adc_admgr_season', { day: today, h: A.season }); renderAdmgr(true); }
  catch (e) { A.season = A.season || null; A.sFailAt = Date.now(); }
  A.sLoading = false;
}
function admgrSeasonCands() { const A = admgrAlert; if (!A.season) { if (admgr.data && !admgr.demo) setTimeout(() => admgrSeasonEnsure(), 0); return null; } return admgrSeasonCalc(A.season, admgrRows().sets, todayStr(0)); }
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

/* ── 검사 ⑪ 품절 상품 광고 (2026-10-30 사용자 요청 "품절 상품이 돌아가면 돈 낭비"): 켜진 캠페인의 켜진 세트 → 이름으로 카페24 상품 → 재고(cafe24-perf stock, 30분마다).
   전체 품절·판매 안 함·카페24에 없음 = 빨강 + [세트 끄기 임시 저장] / 일부 옵션 품절 = 노랑(안내만) */
async function admgrStockEnsure(nos) {
  const A = admgrAlert, key = nos.join(',');
  if (A.stLoading || (A.stKey === key && Date.now() - A.stAt < 30 * 60000) || Date.now() - (A.stFailAt || 0) < 5 * 60000) return;
  A.stLoading = true;
  try { A.stock = await stockGet(nos); A.stKey = key; A.stAt = Date.now(); A.stFailAt = 0; renderAdmgr(true); } catch (e) { A.stFailAt = Date.now(); }
  A.stLoading = false;
}
function admgrCheckStock() {
  const A = admgrAlert, R = admgrRows(), on = new Set(R.camps.filter(c => c.status === 'ACTIVE').map(c => c.id)), idx = admgrProdIdx();
  if (!idx.length) return [];
  const live = R.sets.filter(s => s.status === 'ACTIVE' && on.has(s._campId) && !(admgrSDraft[s.id] && admgrSDraft[s.id].status === 'PAUSED'))
    .map(s => { const n = admgrNorm(s.name), p = idx.find(x => n.includes(x.n)); return p ? { s, p } : null; }).filter(Boolean);
  const nos = [...new Set(live.map(x => x.p.no))].sort((a, b) => a - b);
  if (nos.length) setTimeout(() => admgrStockEnsure(nos), 0);
  if (!A.stock) return [];
  const by = lvl => { const g = new Map(); for (const x of live) { const r = A.stock.get(Number(x.p.no)); if (!r || (lvl === 'red' ? !['all', 'off', 'gone'].includes(r.state) : r.state !== 'part')) continue; if (!g.has(x.p.no)) g.set(x.p.no, { p: x.p, r, sets: [] }); g.get(x.p.no).sets.push(x.s); } return [...g.values()]; };
  const out = [], red = by('red'), part = by('part'), names = L => L.slice(0, 3).map(g => `${esc(coreName(g.p.name))} <small>(${esc(stockLine(g.r))} · 세트 ${g.sets.length})</small>`).join(' · ') + (L.length > 3 ? ' …' : '');
  if (red.length) { const ids = red.flatMap(g => g.sets.map(s => s.id));
    out.push({ key: 'stock-red:' + todayStr(0) + ':' + ids.join(','), lvl: 'red', text: `<b>품절 상품 광고가 켜져 있어요</b> 상품 ${red.length}개 · 세트 ${ids.length}개 — ${names(red)}`,
      act: dnrbCan('toggle') ? { label: `세트 ${ids.length}개 끄기 임시 저장`, onclick: `admgrStockOff('${ids.join(',')}')` } : null }); }
  if (part.length) out.push({ key: 'stock-part:' + todayStr(0) + ':' + part.map(g => g.p.no).join(','), lvl: 'yellow', text: `<b>일부 옵션 품절</b> 상품 ${part.length}개 광고 중 — ${names(part)}` });
  return out;
}
function admgrStockOff(csv) {
  const ids = String(csv).split(',').filter(x => /^\d{5,25}$/.test(x)); if (!ids.length) return;
  for (const id of ids) admgrSDraft[id] = { level: 'adset', status: 'PAUSED' };
  lsSet('adc_admgr_sdraft', admgrSDraft);
  toast(`품절 상품 세트 ${ids.length}개 끄기를 임시 저장했어요 — 상단 [게시]를 눌러야 Meta에 반영돼요`); renderAdmgr(true);
}
admgrAlert.checks.push(admgrCheckStock);

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



/* ═══ 예산 조정 후보 (2026-10-28 사용자 요청: "말 안 했으면 언제 하려고 했냐" — 매일 자동으로, 놓치는 세트 없게) ═══
   대상: CBO가 아닌 켜진 세트(운영·테스트 모두) · 일예산 1,000원 초과 · 만든 지 3일↑. 상품 마진은 안 씀(같이 산 상품까지 든 전환값으로 보려고).
   기준 = 어제까지 7일 ROAS (ADMGR_ROAS — 2026-10-28 사용자 확정: 구매당 비용÷마진 대신 ROAS, 최소 550%, 2주는 메타 기본값 창). 3일은 참고 — 단 2026-10-29부터 7일 450% 미만이어도 3일 ROAS 550%↑·3일 구매 3↑(감액 이력 없음)이면 OFF 대신 절반
   (.insight-tmp/r7r3.mjs: 그런 세트 다음 7일 495~516% = 절반 구간 세트(507~534%)와 비슷, 한 번 감액한 뒤 회복은 482%라 그대로 OFF)
   2026-10-29 '상품이 식는 중'(사용자 확정, 슬리즈 원피스 사례): 상품 전체(세트+CBO 세트 합)의 어제까지 3일 ROAS 450% 미만·3일 구매 10↑이면 그 상품의 유지 구간(7일 550~900%) 세트 중
   자기 3일도 550% 미만인 것을 절반 (.insight-tmp/prod-drop2.mjs: 그런 상품 다음 7일 504~526% = 절반 구간 수준, 세트 하나만 3일 꺾인 건 559%라 안 건드림)
   2026-10-30 상품 원복·증액(사용자 확정, .insight-tmp/prod-up.mjs): 상품 규칙으로 절반 한 세트(shared_state prod_drop_log)는 상품 3일 550%↑(10건↑)로 살아나면 원래 예산으로(그런 세트 다음 7일 568%,
   계속 식으면 502%) · 상품 3일 900%↑·20건↑이면 유지 세트(자기 3일 550%↑)도 +20%(다음 7일 681%, 지출 늘린 세트 699%)
   근거: 9/8~10/26 세트 27,051건 — 줄일 세트 고르기는 구매당 비용·ROAS가 같고, 키울 세트 고르기는 ROAS가 훨씬 나음(다음 주 광고비 1원당 이익 2.32 vs 2.81).
   백테스트(.insight-tmp/sim-cbo.mjs L550): 최근 6개월 기본값 550% 기준이면 광고비 7.13억 → 3.43억 (클릭 7일 550%는 2.19억).
   판단 : 7일 구매 5건↑ 또는 7일 지출 5만원↑일 때만 (표본 부족이면 건너뜀)
   OFF  : 7일 450% 미만 · 또는 4~10일 전에 감액했는데 7일이 아직 550% 미만 ("줄였는데도 계속 나쁨") · 또는 하루 지출 5만↑(7일 지출÷7)인데 7일 550% 미만 (절반 단계 없이, 3일 회복 예외도 없이)
   절반 : 7일 450~550% (하루 5만 미만 세트만)
   하루 5만↑ 바로 OFF 근거(2026-10-30 사용자 확정, .insight-tmp/off-big.mjs 2025-01~2026-09): 5만↑ 세트 7일 450~550% 1,092건 → 다음 7일 504%·550%↑ 회복 32%, 3일 550%↑여도 517% / 7일 450% 미만·3일 550%↑(회복 예외) 48건 → 491%.
   3일 회복 예외는 하루 2만 미만 세트만(사용자 확정 10/30): 2만 미만 572%·회복 42% / 2~5만 470%·25% / 5만↑ 491%. OFF 선 400%도 검토(off400.mjs): 400~450% → 483%·회복 29%라 450% 유지.
   유지 : 7일 550~900% — 손대지 않음 (표시만)
   증액 : 7일 900%↑ & 7일 구매 10↑ & 3일 안 증액 없음 — 금·토 제외 (1100%↑ +30%, 900%↑ +20%)
   대기 : 최근 3일 안에 감액한 세트 — OFF 조건만 빼고 3일은 다시 건드리지 않음
   2026-11-04 사용자 확정 세 가지 ("정해진 수치로만 딱딱 봐서 효율이 올라오는 것도 다 끄거나 절반"):
   ① 보류 : 오늘 구매가 당일 증액 기준 건수(admgrTodayNeed: 4만↓ 2건·5~6만 3건·… 14시부터 +1) 이상이면 OFF·절반을 내일로 (당일 3~4건이면 다음 7일 550%↑ 74%, 5건↑ 90% — up3-follow.mjs)
   ② 표본 : 7일 지출이 전부 최근 3일 안에 있으면(그 전 4일 지출 0) 건너뜀 — 만든 지 3일↑여도 돌기 시작한 지 며칠 안 된 세트는 7일 규칙 대상이 아님
   ③ 5만↑ 세트도 3일 550%↑·3건↑(감액 이력 없음)이면 OFF 대신 절반 (rescue-aftercut.mjs: 그런 세트 다음 7일 ~530%, 손익분기 278~338% 위)
   ④ 감액 4~10일 전 있어도 7일 450~550%·3일 550%↑·3건↑이면 OFF 대신 현 예산 유지(대기) — 감액 이력 유무로 회복 결과가 안 갈림(rescue-aftercut.mjs: 감액 뒤 529~547% vs 없음 520~533%, 550↑ 37~44% 같음). 7일 450% 미만은 회복해도 495%·27%라 그대로 OFF
   ⑤ (2026-11-05 사용자 확정) 5만↑ 세트 7일 450~550%는 3일 400%↑면 OFF 대신 절반, 3일 400% 미만만 바로 OFF — big-mid.mjs: 그런 세트 계속 돌린 다음 7일 ROAS 486~501%(손익분기 338% 위, 공헌이익 +), 3일 400 미만은 절반해도 적자 32%
   ⑥ (2026-11-05 사용자 "두번째로 넣어줘") 표본(5건·5만) 전인 소액 세트도 7일 지출 3만↑이면 테스트 판정과 같은 기준으로 OFF 후보 — 구매 0 → OFF · ROAS 450% 미만 → OFF(금·토·일은 보류).
     이름에 test 없는 1.5만 분리 세트(11/2 켠 40개)가 테스트 탭에도 7일 규칙에도 안 걸려 5일째(5만)까지 판정이 없던 공백. ②(최근 3일뿐) 건너뜀은 이 줄엔 적용 안 함.
     주의 — .insight-tmp/small-new.mjs(8/8~10/26 첫 지출 611세트, 꺼지지 않고 계속 돈 세트만): 누적 3만 시점 구매 0 → 다음 7일 531% · 450% 미만 486% · 450~550% 450% · 550%↑ 473% 로 갈리지 않음.
     3만 시점 세트 숫자는 예측력이 약하다는 뜻(계속 돈 비율은 16%·44%·64%·88%로 달라 선택 편향 있음). 사용자에게 알렸고, 기준은 테스트 탭과 맞춘 것 */
const ADMGR_ADJ = { minPur: 5, minSpend: 50000, upMinPur: 10, cool: 3, back: 10, minAge: 3, rescuePur: 3, prodPur3: 10, prodUpPur3: 20, bigSpend: 50000, rescueSpend: 20000, bigOff3: 4, smallSpend: 30000 };   // smallSpend: 표본(5건·5만) 전이라도 7일 지출 이 이상이면 테스트 기준으로 OFF 후보(⑥)   // bigSpend: 하루 지출(7일÷7) 이 이상이면 550% 미만 바로 OFF · rescueSpend: 3일 회복 예외는 하루 지출 이 미만만   // ROAS 선은 ADMGR_ROAS (js/admgr.js)
async function admgrAdjEnsure() {   // 최근 10일 예산 변경 이력 (감액 날짜 → 대기·재확인)
  const A = admgrAlert; if (admgr.demo || !admgrCfg() || A.adjLoading || (A.adjHist && Date.now() - A.adjHistAt < 30 * 60000) || Date.now() - (A.adjFailAt || 0) < 5 * 60000) return;
  A.adjLoading = true;
  try { const [r, L] = await Promise.all([metaGet({ action: 'budgethistory', start_date: todayStr(-ADMGR_ADJ.back), end_date: todayStr(0) }), sbCall('client-log', { action: 'state_get', key: 'prod_drop_log' }).catch(() => null)]);
    A.adjHist = r.events || []; A.adjHistAt = Date.now(); A.adjFailAt = 0; A.dropLog = (L && L.data) || { items: {} }; A.dropLogVer = (L && L.ver) || null; renderAdmgr(true); }
  catch (e) { A.adjFailAt = Date.now(); }
  A.adjLoading = false;
}
const admgrKstDay = t => { const k = new Date(new Date(t).getTime() + 9 * 3600e3); return k.toISOString().slice(0, 10); };
function admgrAdjCalc(sets, s7, s3, hist, today, dow, prodOf = admgrProductOf, dropLog = {}, hour = null) {   // hour: KST 시각(오늘 기간일 때만) — 오늘 구매로 보류 판단, null이면 안 봄   // dropLog: 상품 규칙으로 절반 한 세트 {id: {from, to, day, prod}}   // 순수 계산 — 테스트용으로 인자 전부 받음 (prodOf: 세트명 → 상품, admgr-tabs.js)
  const C = ADMGR_ADJ, R = ADMGR_ROAS, pc = v => Math.round(v * 100) + '%', last = new Map();   // 세트 id → { cut: 가장 최근 감액일, up: 가장 최근 증액일 }
  // 시간순으로 본다. 감액 뒤 원래 예산 이하로 되올린 건 '원복'(주말 모드·낮 감액 23:45 원복 등) — 감액도 증액도 아닌 것으로 지운다 (2026-10-28)
  for (const e of [...(hist || [])].sort((x, y) => String(x.time).localeCompare(String(y.time)))) { if (e.level !== 'adset' || !(e.old_value > 0)) continue; const d = admgrKstDay(e.time), o = last.get(e.object_id) || {};
    if (e.new_value < e.old_value) { if (!o.cut) o.cutFrom = e.old_value; o.cut = d; }
    else if (e.new_value > e.old_value) { if (o.cut && e.new_value <= o.cutFrom) { delete o.cut; delete o.cutFrom; } else { o.up = d; delete o.cut; delete o.cutFrom; } }
    last.set(e.object_id, o); }
  const coolFrom = admgrShiftDay(today, -(C.cool - 1)), backFrom = admgrShiftDay(today, -C.back), ageTo = admgrShiftDay(today, -C.minAge);
  const r1k = v => Math.max(1000, Math.round(v / 1000) * 1000), out = [];
  const prod3 = new Map();   // 상품 → 어제까지 3일 합 (이름 있는 세트만 — CBO 세트 포함)
  const pkey = n => prodOf({ name: String(n).replace(/^(상품|종합)\s*CBO_/, '') });   // '상품CBO_슬리즈 …' 세트도 그 상품으로
  for (const w of s3.values()) { if (!w || !w.name) continue; const k = pkey(w.name), o = prod3.get(k) || { sp: 0, v: 0, p: 0 }; o.sp += w.spend || 0; o.v += admgrVJ(w); o.p += admgrPJ(w); prod3.set(k, o); }
  for (const s of sets) {
    if (s.status !== 'ACTIVE' || s._cbo || !(s.budget > 1000)) continue;
    if (s.created && admgrKstDay(s.created) > ageTo) continue;   // 신규(3일 미만)는 테스트 판정이 맡는다
    const w = s7.get(s.id); if (!w || !(w.spend > 0)) continue;
    const p7 = admgrPJ(w), r7 = admgrVJ(w) / w.spend;   // 7일 ROAS (구매 0이면 0)
    const t = s3.get(s.id), sp3 = t ? t.spend || 0 : 0, p3 = t ? admgrPJ(t) : 0, r3 = sp3 > 0 ? admgrVJ(t) / sp3 : null;
    if (!(p7 >= C.minPur || w.spend >= C.minSpend)) {   // 표본 부족 — ⑥ 소액 세트만 테스트 판정 기준으로 OFF 후보 (이름에 test 있는 세트는 테스트 탭이 맡는다)
      const wk = [5, 6, 0].includes(dow);   // 금·토·일엔 450% 미만 OFF 보류 (테스트 판정 admgrWkHold와 같음), 구매 0은 그대로
      if (w.spend >= C.smallSpend && !/test/i.test(String(s.name || '')) && (!p7 || (r7 < R.off && !wk))) {
        const k0 = hour != null ? admgrPJ(s) : 0, need = hour != null ? admgrTodayNeed(s.budget, hour) : 0, b0 = { s, r7, r3, p7, p3, sp7: w.spend, sp3, from: s.budget, lastCut: null, big: false, small: true };
        out.push(hour != null && k0 >= need ? { ...b0, act: 'hold', would: 'off', to: s.budget, why: `오늘 ${k0}건(기준 ${need}건↑) — OFF는 내일 다시 (7일 ${pc(r7)})` }
          : { ...b0, act: 'off', to: 0, why: p7 ? `소액 세트 · 지출 ${Math.round(w.spend / 1000) / 10}만원에 ROAS ${pc(r7)}(${pc(R.off)} 미만) — 테스트 기준으로 OFF` : `소액 세트 · 구매 0인데 ${Math.round(w.spend / 1000) / 10}만원 씀(${C.smallSpend / 10000}만↑) — 테스트 기준으로 OFF` });
      }
      continue;
    }
    if (w.spend - sp3 < 1000) continue;   // ② 7일 지출이 전부 최근 3일 — 표본이 3일치뿐이라 내일부터 (2026-11-04)
    const L = last.get(s.id) || {}, cool = !!(L.cut && L.cut >= coolFrom), prevCut = !!(L.cut && !cool && L.cut >= backFrom);
    const big = w.spend / 7 >= C.bigSpend;   // 하루 5만↑ — 절반 없이 550% 미만이면 OFF (2026-10-30), 단 3일 회복(③)이면 절반
    const base = { s, r7, r3, p7, p3, sp7: w.spend, sp3, from: s.budget, lastCut: L.cut || null, big };
    const rescue = !prevCut && r3 != null && r3 >= R.keep && p3 >= C.rescuePur && (big ? r7 < R.keep : w.spend / 7 < C.rescueSpend && r7 < R.off);   // 3일 회복 → OFF 대신 절반 — 하루 2만 미만(450% 미만일 때) · 5만↑(550% 미만일 때, ③)
    const k0 = hour != null ? admgrPJ(s) : 0, need = hour != null ? admgrTodayNeed(s.budget, hour) : 0, hold = hour != null && k0 >= need;   // ① 오늘 구매가 기준 건수↑ → OFF·절반 보류
    const holdOr = act => hold ? { ...base, act: 'hold', would: act, to: s.budget, why: `오늘 ${k0}건(기준 ${need}건↑) — ${act === 'off' ? 'OFF' : '절반'}은 내일 다시 (7일 ${pc(r7)} · 3일 ${pc(r3 || 0)})` } : null;
    if (prevCut && r7 >= R.off && r7 < R.keep && r3 != null && r3 >= R.keep && p3 >= C.rescuePur) { out.push({ ...base, act: 'cool', to: s.budget, why: `${L.cut.slice(5)} 감액 뒤 7일 ${pc(r7)}지만 3일 ${pc(r3)}(${p3}건)로 회복 — 현 예산 유지, 3일 뒤 다시` }); continue; }   // ④
    const bigOff = big && !prevCut && r7 >= R.off && r7 < R.keep && !(r3 >= C.bigOff3);   // ⑤ 5만↑·450~550%는 3일 400% 미만일 때만 바로 OFF
    if (!rescue && (r7 < R.off || (prevCut && r7 < R.keep) || bigOff)) { const h = holdOr('off'); if (h) { out.push(h); continue; } out.push({ ...base, act: 'off', to: 0, why: bigOff ? `하루 ${Math.round(w.spend / 7 / 1000) / 10}만원 세트 · 7일 ROAS ${pc(r7)}(${pc(R.keep)} 미만) · 3일 ${pc(r3 || 0)}(${pc(C.bigOff3)} 미만으로 꺾임) — 절반 없이 바로 OFF` : prevCut ? `${L.cut.slice(5)} 감액 뒤에도 7일 ROAS ${pc(r7)}(${pc(R.keep)} 미만)${r3 != null && r3 >= R.keep ? ` — 3일 ${pc(r3)} 회복은 감액 뒤라 OFF 유지` : ''}` : `7일 ROAS ${pc(R.off)} 미만 — 회복 가능성 낮음` }); continue; }
    if (cool) { out.push({ ...base, act: 'cool', to: s.budget, why: `${L.cut.slice(5)}에 감액 — 3일 뒤 다시 확인` }); continue; }
    if (r7 < R.keep) { const h = holdOr('half'); if (h) { out.push(h); continue; } out.push({ ...base, act: 'half', rescue, to: r1k(s.budget / 2), why: rescue ? `${big ? `하루 ${Math.round(w.spend / 7 / 1000) / 10}만원 세트 · ` : ''}7일 ROAS ${pc(r7)}지만 3일 ${pc(r3)}(${p3}건)로 회복 — OFF 대신 절반, 다음에도 7일 ${pc(R.keep)} 미만이면 OFF` : big ? `하루 ${Math.round(w.spend / 7 / 1000) / 10}만원 세트 · 7일 ROAS ${pc(r7)} · 3일 ${pc(r3 || 0)}(${pc(C.bigOff3)}↑) — 절반, 3일 뒤 다시 (${pc(C.bigOff3)} 미만으로 꺾이면 OFF)` : `7일 ROAS ${pc(R.off)}~${pc(R.keep)} — 3일 뒤에도 ${pc(R.keep)} 미만이면 OFF` }); continue; }
    const pd = prod3.get(pkey(s.name)), pr3 = pd && pd.sp > 0 ? pd.v / pd.sp : null, dl = dropLog[s.id];
    if (dl && pd && pd.p >= C.prodPur3 && pr3 >= R.keep && s.budget <= dl.to) { out.push({ ...base, act: 'back', to: dl.from, why: `${String(dl.day).slice(5)} 상품이 식어 절반 → 상품 3일 ROAS ${pc(pr3)}(${pd.p}건)로 회복 — 원래 예산으로` }); continue; }
    if (r7 < R.up && pd && pd.p >= C.prodPur3 && pr3 < R.off && !(r3 >= R.keep)) { const h = holdOr('half'); if (h) { out.push(h); continue; } out.push({ ...base, act: 'half', prodDrop: true, to: r1k(s.budget / 2), why: `상품 전체 3일 ROAS ${pc(pr3)}(${pd.p}건)로 꺾임 — 세트 7일 ${pc(r7)}지만 절반` }); continue; }
    const upOk = dow !== 5 && dow !== 6 && p7 >= C.upMinPur && !(L.up && L.up >= coolFrom);
    if (r7 < R.up && upOk && pd && pd.p >= C.prodUpPur3 && pr3 >= R.up && r3 != null && r3 >= R.keep) { out.push({ ...base, act: 'up', prodUp: true, to: r1k(s.budget * 1.2), why: `상품 전체 3일 ROAS ${pc(pr3)}(${pd.p}건)로 뜨는 중 — 세트 7일 ${pc(r7)}지만 +20%` }); continue; }
    if (r7 < R.up) { out.push({ ...base, act: 'watch', to: s.budget, why: `7일 ROAS ${pc(R.keep)}~${pc(R.up)} — 유지` }); continue; }
    if (upOk) out.push({ ...base, act: 'up', to: r1k(s.budget * (r7 >= R.upBig ? 1.3 : 1.2)), why: r7 >= R.upBig ? `7일 ROAS ${pc(R.upBig)}↑ → +30%` : `7일 ROAS ${pc(R.up)}~${pc(R.upBig)} → +20%` });
  }
  return out;
}
function admgrAdjRows() {
  const A = admgrAlert; if (!A.h7 || !A.h3) { if (admgr.data && !admgr.demo) setTimeout(() => admgrPromoEnsure(), 0); return null; }
  if (!A.adjHist) { if (admgr.data && !admgr.demo) setTimeout(() => admgrAdjEnsure(), 0); return null; }
  const M = h => new Map(((h && h.campaigns) || []).flatMap(c => (c.adsets || []).map(s => [s.id, s])));
  const k = admgrKst(new Date().toISOString()), dow = k ? k.getUTCDay() : new Date().getDay();
  const cut = todayStr(-14), items = (A.dropLog && A.dropLog.items) || {};   // 14일 지난 기록은 안 봄
  return admgrAdjCalc(admgrRows().sets, M(A.h7), M(A.h3), A.adjHist, todayStr(0), dow, admgrProductOf, Object.fromEntries(Object.entries(items).filter(([, v]) => v.day >= cut)), admgr.preset === 'today' ? admgrKstHour() : null);   // 오늘 기간일 때만 오늘 구매로 보류(①)
}
function admgrCheckAdj() {
  if (!dnrbCan('budget')) return [];
  const R = admgrAdjRows(); if (!R) return [];
  const n = k => R.filter(x => x.act === k && !admgrDraft[x.s.id] && !admgrSDraft[x.s.id]).length, off = n('off'), half = n('half'), up = n('up');
  if (!off && !half && !up) return [];
  return [{ key: 'adj:' + todayStr(0), lvl: off ? 'red' : 'yellow', text: `<b>예산 조정 후보</b> OFF ${off} · 절반 ${half}${up ? ` · 증액 ${up}` : ''} <small>최근 7일 ROAS · ${admgrAttrTxt()} · 유지 ${R.filter(x => x.act === 'watch').length} · 감액 뒤 대기 ${R.filter(x => x.act === 'cool').length}${R.some(x => x.act === 'hold') ? ` · 오늘 구매로 보류 ${R.filter(x => x.act === 'hold').length}` : ''}</small>`, act: { label: '보기', onclick: 'admgrAdjModal()' } }];
}
admgrAlert.checks.push(admgrCheckAdj);
/* 판정 기간에서 빼는 날 안내 (2026-11-12) — 7일 창에 걸려 있는 동안만 */
admgrAlert.checks.push(() => { if (admgr.demo || !dnrbCan('budget') || !admgrSkipHit(7)) return [];
  const md = d => +d.slice(5, 7) + '/' + +d.slice(8), R = n => admgrDayRanges(admgrCleanDays(n)).map(r => r.since === r.until ? md(r.since) : `${md(r.since)}~${md(r.until)}`).join(' + ');
  return [{ key: 'skipdays:' + todayStr(0), lvl: 'blue', text: `<b>판정 기간</b> ${ADMGR_SKIP_DAYS.map(md).join('·')} 제외 <small>손으로 운영한 날 — 7일 = ${R(7)} · 3일 = ${R(3)}</small>` }]; });
/* '오늘 할 일' 칩을 알림판에도 (2026-11-05 사용자 요청) — 칩은 운영·CBO 역할에서만 보여서 다른 화면에 있으면 놓친다. 칩은 그대로 두고 같은 계산으로 건수만 알림.
   당일 증액(11~17시) · 증액 되돌리기 → 증액 후보 창 / CBO 지출 0 광고 → CBO 역할 광고 탭. 승격 후보는 이미 위 admgrCheckPromo. 예산 조정 후보(OFF·절반)와 겹친 세트는 건수에서 뺌.
   임시 저장한 세트도 건수에 넣고 '게시 전 n'으로 따로 알림 (2026-11-06 사용자 요청) — 빼면 임시 저장만 하고 게시를 잊었을 때 알림이 9 → 1로 줄어 다 끝난 것처럼 보였다 */
function admgrTodoCount(sets, adjIds, drafts, upOf, backOf) {   // 순수 계산 — 테스트용
  let up = 0, back = 0, pend = 0;   // pend = 그중 임시 저장만 돼 있고 아직 게시 전
  for (const r of sets) { let hit = false; if (upOf(r)) { if (!adjIds.has(r.id)) { up++; hit = true; } } else if (backOf(r)) { back++; hit = true; } if (hit && drafts[r.id] != null) pend++; }
  return { up, back, pend };
}
function admgrCheckTodo() {
  const out = [], R = admgrRows();
  if (dnrbCan('budget')) {
    if (admgr.data && !admgr.demo) setTimeout(() => admgrFastEnsure(), 0);   // 되돌리기에 쓰는 3일 성적·증액 기록 (30분 캐시)
    const adj = new Set((admgrAdjRows() || []).filter(x => x.act === 'off' || x.act === 'half').map(x => x.s.id));
    const { up, back, pend } = admgrTodoCount(R.sets, adj, admgrDraft, r => admgrTodayUpOf(r), r => admgr.fast.days ? admgrFastRevertOf(r) : null);
    if (up || back) out.push({ key: 'todo:' + todayStr(0), lvl: back || pend ? 'yellow' : 'blue', text: `<b>증액 후보</b> 당일 증액 ${up} · 되돌리기 ${back}${pend ? ` · <b style="color:#b45309;">임시 저장만 하고 게시 전 ${pend}</b>` : ''} <small>당일 증액은 11~17시 · 되돌리기는 올린 뒤 이틀 ROAS 550%↓</small>`, act: { label: '보기', onclick: 'admgrFastModal()' } });
  }
  const zero = R.ads.filter(x => x._cbo && x.status === 'ACTIVE' && !(x.spend > 0)).length;
  if (zero) out.push({ key: 'zero:' + todayStr(0), lvl: 'blue', text: `<b>CBO 지출 0 광고</b> ${zero}개 <small>켜져 있는데 이 기간 지출 없음</small>`, act: { label: '보기', onclick: "admgrRoleSet('cbo');admgrAdFilter('zero')" } });
  return out;
}
admgrAlert.checks.push(admgrCheckTodo);
/* 예산 되돌리기 예약 알림 (2026-11-12, 일회용 — admgr-budget.js ADMGR_RESTORE): 예약 전 = 대상 수, 예약 뒤 = 걸린 수 */
admgrAlert.checks.push(() => {
  if (!admgrRestoreOn() || !dnrbCan('budget') || !admgrAlert.adjHist || admgr.demo) return [];
  const w = admgr.write, R = admgrRestoreAdj(admgrRestoreCalc(admgrRows().camps, admgrAlert.adjHist, ADMGR_RESTORE.since)).filter(r => !r.off), booked = R.filter(r => w.timedByObj && w.timedByObj.has(r.id)).length, hm = ADMGR_RESTORE.at.slice(11);
  return R.length ? [{ key: 'restore:' + ADMGR_RESTORE.at + ':' + booked, lvl: booked ? 'yellow' : 'blue', text: `<b>예산 되돌리기</b> ${ADMGR_RESTORE.label} 예산으로 ${R.length}개${booked ? ` · <b>${booked}개 ${hm} 예약됨</b>` : ` <small>아직 예약 전 — 오늘 ${hm} 자동 반영으로 걸 수 있어요</small>`}`, act: { label: '보기', onclick: 'admgrRestoreModal()' } }] : [];
});
function admgrAdjModal() {
  const R = admgrAdjRows() || [], man = v => admgrW(Math.round(v || 0));
  const line = (k, r, sp, p, bold) => `${k} ${bold ? '<b>' : ''}ROAS ${r == null ? '—' : Math.round(r * 100) + '%'}${bold ? '</b>' : ''} · 구매 ${p || 0}건 · 지출 ${man(sp)}`;
  const role = x => admgrIsTest(x.s) ? '<span class="status-badge badge-gray" style="font-size:.58rem;">테스트</span>' : '<span class="status-badge badge-blue" style="font-size:.58rem;">운영</span>';
  const P = r => r == null ? '—' : Math.round(r * 100).toLocaleString() + '%';   // 2026-10-29 사용자 요청: 세트 · 7일 · 3일 · 일예산 · 결과 표로
  const res = x => x.act === 'off' ? '<b style="color:#b91c1c;">OFF</b>' : x.act === 'half' ? `<b style="color:#b45309;">절반 → ${man(x.to)}</b>` : x.act === 'back' ? `<b style="color:#2563eb;">원복 → ${man(x.to)}</b>` : `<b style="color:#15803d;">+${Math.round((x.to / x.from - 1) * 100)}% → ${man(x.to)}</b>`;
  const canOff = admgr.write.st && admgr.write.st.allowed && !admgr.demo && dnrbCan('toggle');   // 줄 끝 [OFF] — 절반·원복·증액 후보도 바로 끄기 임시 저장 (증액 후보 창과 같은 admgrFastOff · 2026-11-10 사용자 요청)
  const row = x => { const off = admgrSDraft[x.s.id] && admgrSDraft[x.s.id].status === 'PAUSED', pend = admgrDraft[x.s.id] || admgrSDraft[x.s.id], swap = off && x.act !== 'off';   // swap = 후보는 절반·증액인데 OFF로 임시 저장
    return `<tr${pend ? ' style="opacity:.55;"' : ''}><td>${swap ? '' : `<input type="checkbox" class="adj-ck" data-id="${esc(x.s.id)}" data-act="${x.act}" data-to="${x.to}" data-from="${x.from}" data-pd="${x.prodDrop ? 1 : ''}" ${pend ? '' : 'checked'} />`}</td>
      <td class="name-cell" style="text-align:left;white-space:normal;min-width:240px;">${role(x)} ${esc(admgrBase(x.s.name))}<div style="color:#6b7280;font-size:.66rem;white-space:normal;">${esc(x.why)}${pend ? ` · <b style="color:#b45309;">${off ? 'OFF ' : ''}임시 저장됨 · 아직 게시 전</b>` : ''}</div></td>
      <td style="white-space:nowrap;"><b>${P(x.r7)}</b><div style="font-size:.7rem;color:#374151;line-height:1.5;">지출 <b>${man(x.sp7)}</b> · ${x.p7 || 0}건${x.p7 ? `<br>구매당 ${comma(Math.round(x.sp7 / x.p7))}` : ''}</div></td>
      <td style="white-space:nowrap;">${P(x.r3)}<div style="font-size:.7rem;color:#374151;line-height:1.5;">지출 <b>${man(x.sp3)}</b> · ${x.p3 || 0}건${x.p3 ? `<br>구매당 ${comma(Math.round(x.sp3 / x.p3))}` : ''}</div></td>
      <td style="white-space:nowrap;">${man(x.from)}</td><td style="white-space:nowrap;">${swap ? '<b style="color:#b91c1c;">OFF</b>' : res(x)}</td>
      <td>${canOff && (off || x.act !== 'off') ? `<button class="btn-ghost" style="padding:3px 8px;font-size:.66rem;white-space:nowrap;${off ? '' : 'color:#b91c1c;border-color:#fca5a5;'}" onclick="admgrFastOff('${esc(x.s.id)}',1)">${off ? 'OFF 취소' : 'OFF'}</button>` : ''}</td></tr>`; };
  const sec = (k, t, c) => { const L = R.filter(x => x.act === k).sort((a, b) => k === 'up' ? b.r7 - a.r7 : a.r7 - b.r7); return L.length ? `<tr><td colspan="7" style="text-align:left;padding-top:12px;font-weight:800;font-size:.8rem;color:${c};">${t} ${L.length}</td></tr>${L.map(row).join('')}` : ''; };
  const info = (k, t) => { const L = R.filter(x => x.act === k); return L.length ? `<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:.74rem;color:#6b7280;">${t} ${L.length}개 (손대지 않음)</summary>${L.map(x => `<div style="font-size:.72rem;color:#6b7280;padding:2px 0;">${esc(admgrBase(x.s.name))} — ${line('7일', x.r7, x.sp7, x.p7)} · ${line('3일', x.r3, x.sp3, x.p3)} · ${esc(x.why)}</div>`).join('')}</details>` : ''; };
  const sum = () => { let a = 0, b = 0; R.filter(x => ['off', 'half', 'back', 'up'].includes(x.act)).forEach(x => { a += x.from; b += x.to; }); return { a, b }; }, S = sum(), B = admgrBudgetTotal(false);
  const k = admgrKst(new Date().toISOString()), dow = k ? k.getUTCDay() : 1;
  $('abm-title').textContent = `예산 조정 후보 — ${fmtMD(todayStr(0))}`; $('abm-sub').style.display = 'none';
  $('abm-body').innerHTML = `<div style="font-size:.74rem;color:#4b5563;line-height:1.6;">어제까지 7일 <b>ROAS</b>로 골랐어요 (${admgrAttrTxt()}). 450% 미만 OFF · 450~550% 절반(3일 뒤에도 550% 미만이면 OFF) · 하루 지출 5만↑ 세트는 450~550%면 절반, 3일 400% 미만으로 꺾였으면 바로 OFF · 550~900% 유지 · 900%↑ 증액(1100%↑ +30%). 7일 구매 5건 또는 지출 5만원부터 판단 · 7일 450% 미만이어도 3일 550%↑·3건↑면 OFF 대신 절반(하루 지출 2만 미만 · 감액 이력 없을 때) · 감액 뒤라도 7일 450~550%·3일 550%↑·3건↑면 현 예산 유지 · 오늘 구매가 당일 증액 기준 건수(4만↓ 2건 · 5~6만 3건 · 7~8만 4건 …)를 넘으면 OFF·절반은 내일 다시 · 표본 전인 소액 세트도 7일 지출 3만↑에 구매 0이거나 450% 미만이면 테스트 기준으로 OFF(450% 미만은 금·토·일 보류) · 돌기 시작한 지 3일 안 된 세트는 안 봄 · 상품 전체 3일 450% 미만(10건↑)이면 그 상품 유지 세트도 절반, 상품이 550%↑로 살아나면 원복 · 상품 3일 900%↑(20건↑)면 유지 세트도 +20%. 체크한 것만 임시 저장에 들어가고, 상단 <b>[게시]</b>를 눌러야 Meta에 반영돼요. 절반·원복·증액 줄 끝 <b>[OFF]</b>는 그 세트를 끄기로 임시 저장(다시 누르면 취소).
      <div>후보 세트 지출 합 — 7일 ${admgrW(Math.round(R.filter(x => ['off', 'half', 'back', 'up'].includes(x.act)).reduce((a, x) => a + x.sp7, 0)))} · 3일 ${admgrW(Math.round(R.filter(x => ['off', 'half', 'back', 'up'].includes(x.act)).reduce((a, x) => a + x.sp3, 0)))}</div>
      <div>대상 세트 일예산 ${admgrW(S.a)} → ${admgrW(S.b)} · 켜진 일예산 전체 ${admgrW(B.total)} → 약 ${admgrW(B.total - S.a + S.b)}${dow === 5 || dow === 6 ? ' · 금·토요일엔 증액 후보를 내지 않아요' : ''}</div></div>
    <div class="table-wrap" style="max-height:62vh;overflow:auto;"><table style="font-size:.74rem;width:100%;"><thead><tr><th></th><th style="text-align:left;">세트</th><th>7일 ROAS<br><small style="font-weight:600;color:#9ca3af;">지출 · 구매 · 구매당</small></th><th>3일 ROAS<br><small style="font-weight:600;color:#9ca3af;">지출 · 구매 · 구매당</small></th><th>일예산</th><th>결과</th><th></th></tr></thead>
      <tbody>${sec('off', 'OFF', '#b91c1c')}${sec('half', '절반으로', '#b45309')}${sec('back', '원복 (상품 회복)', '#2563eb')}${sec('up', '증액', '#15803d')}</tbody></table>${info('hold', '오늘 구매 기준 건수↑ — OFF·절반 내일 다시')}${info('watch', '유지 (7일 ROAS 550~900%)')}${info('cool', '감액 뒤 대기 (3일)')}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;"><button class="btn-ghost" onclick="closeModal('admgr-budget-modal')">닫기</button><button class="btn-analyze" onclick="admgrAdjApply()">체크한 것 임시 저장에 넣기</button></div>`;
  admgrAbmWide();
  $('admgr-budget-modal').classList.add('show');
}
function admgrAdjApply() {
  let n = 0;
  const A = admgrAlert, log = { items: { ...((A.dropLog && A.dropLog.items) || {}) } }; let logChanged = false;
  document.querySelectorAll('.adj-ck:checked').forEach(el => { const id = el.dataset.id; if (el.dataset.act === 'off') admgrSDraft[id] = { level: 'adset', status: 'PAUSED' }; else admgrDraft[id] = Number(el.dataset.to); n++;
    if (el.dataset.pd) { log.items[id] = { from: Number(el.dataset.from), to: Number(el.dataset.to), day: todayStr(0) }; logChanged = true; }   // 상품 규칙 절반 → 회복 때 원복하려고 기록
    if (el.dataset.act === 'back' && log.items[id]) { delete log.items[id]; logChanged = true; } });
  lsSet('adc_admgr_draft', admgrDraft); lsSet('adc_admgr_sdraft', admgrSDraft);
  if (logChanged) sbCall('client-log', { action: 'state_set' }, { key: 'prod_drop_log', base: A.dropLogVer, data: log }).then(r => { if (r && !r.conflict) { A.dropLog = log; A.dropLogVer = r.ver; } }).catch(() => {});
  closeModal('admgr-budget-modal'); toast(`${n}개를 임시 저장했어요 — 표에서 확인한 뒤 상단 [게시]를 누르세요`);
  admgrSetView('set'); renderAdmgr();
}

/* ── 검사 ⑪ 7일 점검표 (2026-11-02 사용자 확정 — Desktop/클ㄹ드/답변-예산운영방식.md): 어제까지 7일 공헌이익(매출×36% − 광고비 · 택배·포장은 고정비에 넣은 기준) · ROAS · 테스트 지출 비중.
   월요일에 보면 지난주 월~일. 유지선 = 공헌이익 1,700만(주 고정비 1,154만 + 여유) · ROAS 500% · 테스트 25%. 알림은 숫자만 — 방식을 바꾸는 건 4주 연속 1,700만 미만 또는 2주 연속 450% 미만일 때만 */
const ADMGR_WEEKLY = { contrib: 0.36, minContrib: 17000000, minRoas: 5, testShare: 0.25 };
function admgrWeeklyCalc(h7, isTest = admgrIsTest) {   // 순수 계산 — 테스트용. 테스트 = 이름에 test 또는 7일 안에 만든 세트
  let sp = 0, v = 0, p = 0, tsp = 0;
  for (const c of ((h7 && h7.campaigns) || [])) for (const s of (c.adsets || [])) { const x = s.spend || 0; sp += x; v += admgrVJ(s); p += admgrPJ(s); if (isTest(s) || (s.created && admgrKstDay(s.created) >= todayStr(-7))) tsp += x; }
  return sp > 0 ? { sp, v, p, roas: v / sp, contrib: v * ADMGR_WEEKLY.contrib - sp, test: tsp / sp } : null;
}
function admgrCheckWeekly() {
  const w = admgrWeeklyCalc(admgrAlert.h7); if (!w) return [];
  const W = ADMGR_WEEKLY, okC = w.contrib >= W.minContrib, okR = w.roas >= W.minRoas, okT = w.test <= W.testShare;
  const f = (ok, s) => ok ? `<b>${s}</b>` : `<b style="color:#b45309;">${s} ▼</b>`;
  return [{ key: 'weekly:' + todayStr(0), lvl: okC && okR && okT ? 'blue' : 'yellow', text: `<b>7일 점검표</b> 공헌이익 ${f(okC, admgrW(Math.round(w.contrib)))} · ROAS ${f(okR, Math.round(w.roas * 100) + '%')} · 테스트 지출 ${f(okT, Math.round(w.test * 100) + '%')} <small>어제까지 7일 · 광고비 ${admgrW(Math.round(w.sp))} · 구매 ${w.p}건 · 유지선 1,700만 · 500% · 25%</small>` }];
}
admgrAlert.checks.push(admgrCheckWeekly);
