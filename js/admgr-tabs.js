/* ④-3 광고관리자: 테스트 소재·기존광고 중 OFF·베스트소재 탭·소재 미리보기·데모 데이터
   (index.html에서 분리 — 2026-09-08 2단계. 파일 순서는 index.html의 <script> 순서, 전역 함수·변수를 그대로 공유) */
'use strict';

/* ═══ 테스트 소재 탭 (2단계 — 원본 admgrTest* 이식) ═══
   운영 규칙: 광고세트명에 'test'(대소문자 무시)를 넣으면 자동 수집. 세트명에서 test를 지우면 '테스트 종료'로 60일간 남는다.
   상태: OFF·검토중·거부는 Meta 상태로 자동, 애매·우수는 버튼으로 직접 지정, 켜져 있고 미지정 = 평가중.        */
async function admgrTestFetch() {
  const t = admgr.test;
  if (t.loading) return;
  if (!admgrCfg() && !admgr.demo) { renderAdmgr(); return; }
  t.loading = true; renderAdmgr();
  try {
    if (admgr.demo) {
      t.data = admgrDemoTestData();
    } else {
      const [data, stRows] = await Promise.all([metaGet({ action: 'testads' }), metaGet({ action: 'state_list' })]);
      t.data = data;
      t.state = new Map((Array.isArray(stRows) ? stRows : []).map(r => [r.ad_id, r]));
    }
    t.loaded = true;
    t.sel.clear();
    if (!admgr.demo) lsSet('adc_admgr_test', { data: t.data, state: [...t.state.entries()] });
    setTimeout(() => admgrTrendEnsure(), 0);   // 일별 스냅샷(추세·피로도)은 뒤따라 — 표는 먼저 그린다
  } catch (e) { toast('테스트 소재 조회 실패: ' + e.message); }
  t.loading = false; renderAdmgr();
}
function admgrDPlus(a) {
  if (!a.reg_date) return null;
  return Math.max(0, daysBetween(a.reg_date, todayStr(0)));
}
function admgrTestStatusOf(a, meta) {
  if (a.gone) return meta.verdict === 'good' ? 'good' : meta.verdict === 'meh' ? 'meh' : 'ended';
  const es = a.effective_status;
  if (['PENDING_REVIEW', 'IN_PROCESS', 'PENDING_BILLING_INFO'].includes(es)) return 'review';
  if (['DISAPPROVED', 'WITH_ISSUES'].includes(es)) return 'rejected';
  if (es !== 'ACTIVE') return 'off';
  if (meta.verdict === 'good') return 'good';
  if (meta.verdict === 'meh') return 'meh';
  return 'eval';
}
const ADMGR_ST_LABEL = { eval:'평가중', off:'OFF', meh:'애매', good:'우수', review:'검토중', rejected:'거부·문제', ended:'테스트 종료' };
function admgrTestBadge(a) {
  const pill = (cls, txt) => `<span class="status-badge ${cls}">${txt}</span>`;
  const end = a.gone ? pill('badge-gray', '테스트 종료') + ' ' : '';
  if (a.st === 'ended') return end.trim() + '<div style="font-size:.6rem;color:#9ca3af;">판정 없이 종료</div>';
  if (a.st === 'eval') return pill('badge-blue', '평가중');
  if (a.st === 'good') return end + pill('badge-green', '● 우수');
  if (a.st === 'meh') return end + pill('badge-yellow', '● 애매');
  if (a.st === 'review') return pill('badge-orange', '검토중');
  if (a.st === 'rejected') return pill('badge-red', '거부·문제');
  return pill('badge-red', '● OFF') + `<div style="font-size:.6rem;color:#9ca3af;">${a.status === 'PAUSED' ? '소재 꺼짐' : '상위 꺼짐'}</div>`;
}
/* 판정 버튼 — 켜진 소재 + 테스트 종료 소재(늦은 판정 보완)에 표시, 켜진 판정을 다시 누르면 해제 */
function admgrVerdictBtns(a) {
  if (!['eval', 'meh', 'good', 'ended'].includes(a.st)) return '';
  return `<span class="verdict-btns" style="margin-top:3px;">
    <button class="vbtn ${a.st === 'meh' ? 'on-meh' : ''}" onclick="event.stopPropagation();admgrTestVerdict('${a.id}','meh')" title="${a.st === 'meh' ? '클릭하면 해제 (평가중으로)' : '애매로 지정'}">애매</button>
    <button class="vbtn ${a.st === 'good' ? 'on-good' : ''}" onclick="event.stopPropagation();admgrTestVerdict('${a.id}','good')" title="${a.st === 'good' ? '클릭하면 해제 (평가중으로)' : '우수로 지정'}">우수</button></span>`;
}
async function admgrTestVerdict(adId, v) {
  const cur = admgr.test.state.get(adId) || {};
  const nv = cur.verdict === v ? null : v;
  try {
    await admgrTestSave(adId, { verdict: nv, verdict_at: nv ? new Date().toISOString() : null }); renderAdmgr(true);
    // 우수 판정은 판정일 뿐 — 베스트 소재 담기는 광고세트 탭에서 직접 (2026-09-14 사용자 요청으로 자동 담기 제거)
  }
  catch (e) { toast('저장 실패: ' + e.message); }
}
/* 추가소재 열 — 우수 소재에서 요청/제작완료 체크(날짜 자동 기록). 우수가 아니어도 기존 체크는 계속 표시 */
function admgrAssetCell(a) {
  const m = a.meta;
  if (a.st !== 'good' && !m.asset_req_at && !m.asset_done_at) return '<span style="color:#d1d5db;">—</span>';
  const d = iso => iso ? `<span style="font-size:.6rem;color:#9ca3af;margin-left:2px;">${fmtMD(String(iso).slice(0, 10))}</span>` : '';
  const row = (field, label, iso) => `<label onclick="event.stopPropagation();" style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:.7rem;font-weight:600;color:${iso ? '#374151' : '#9ca3af'};white-space:nowrap;">
    <input type="checkbox" ${iso ? 'checked' : ''} onchange="admgrTestAsset('${a.id}','${field}')" style="margin:0;" />${label}${d(iso)}</label>`;
  return `<div style="display:inline-flex;flex-direction:column;gap:2px;text-align:left;">${row('asset_req_at', '요청', m.asset_req_at)}${row('asset_done_at', '제작완료', m.asset_done_at)}</div>`;
}
async function admgrTestAsset(adId, field) {
  const cur = admgr.test.state.get(adId) || {};
  try { await admgrTestSave(adId, { [field]: cur[field] ? null : new Date().toISOString() }); renderAdmgr(true); }
  catch (e) { toast('저장 실패: ' + e.message); }
}
function admgrTestFilter(k) { const t = admgr.test; t.filter = k; t.showHidden = false; t.sel.clear(); renderAdmgr(); }
function admgrTestToggleHidden() { const t = admgr.test; t.showHidden = !t.showHidden; t.sel.clear(); renderAdmgr(); }
function admgrTestSel(id) { const s = admgr.test.sel; s.has(id) ? s.delete(id) : s.add(id); renderAdmgr(true); }
function admgrTestSelAll() {
  const t = admgr.test; const { rows } = admgrTestRowSets();
  const all = rows.length && rows.every(r => t.sel.has(r.id));
  if (all) rows.forEach(r => t.sel.delete(r.id)); else rows.forEach(r => t.sel.add(r.id));
  renderAdmgr(true);
}
/* ad_test_state 저장 (upsert) — 안 바꾸는 필드도 현재값을 실어 보내 덮어쓰기 손실 방지 (원본 규칙) */
async function admgrTestSave(adId, patch) {
  const t = admgr.test;
  const a = ((t.data || {}).ads || []).find(x => x.id === adId);
  const cur = t.state.get(adId) || {};
  const row = {
    ad_id: adId, ad_name: a ? a.name : (cur.ad_name || ''),
    hidden: cur.hidden || false, memo: cur.memo ?? null,
    verdict: cur.verdict ?? null, verdict_at: cur.verdict_at ?? null, asset_req_at: cur.asset_req_at ?? null, asset_done_at: cur.asset_done_at ?? null,
    ...patch, updated_by: ADMGR_USER, updated_at: new Date().toISOString(),
  };
  if (!admgr.demo) await metaPost({ action: 'state_save' }, row);
  t.state.set(adId, row);
  if (!admgr.demo) lsSet('adc_admgr_test', { data: t.data, state: [...t.state.entries()] });   // 새로고침 전 리포트도 방금 판정을 보게
}
async function admgrTestBulkHide(hidden) {
  const t = admgr.test;
  const ids = [...t.sel];
  if (!ids.length) { toast(hidden ? '먼저 제거할 소재를 체크하세요' : '먼저 복원할 소재를 체크하세요'); return; }
  if (hidden && !confirm(`선택한 ${ids.length}개 소재를 목록에서 제거할까요?\n('제거한 소재 보기'에서 언제든 복원할 수 있어요)`)) return;
  const byId = new Map(((t.data || {}).ads || []).map(a => [a.id, a]));
  const rows = ids.map(id => {
    const cur = t.state.get(id) || {};
    return { ad_id: id, ad_name: (byId.get(id) || {}).name || cur.ad_name || '', hidden,
      memo: cur.memo ?? null, verdict: cur.verdict ?? null, verdict_at: cur.verdict_at ?? null,
      asset_req_at: cur.asset_req_at ?? null, asset_done_at: cur.asset_done_at ?? null,
      updated_by: ADMGR_USER, updated_at: new Date().toISOString() };
  });
  try {
    if (!admgr.demo) await metaPost({ action: 'state_save' }, rows);
    rows.forEach(r => t.state.set(r.ad_id, r));
    t.sel.clear();
    toast(hidden ? `${ids.length}개 소재를 목록에서 제거했어요` : `${ids.length}개 소재를 복원했어요`);
    renderAdmgr();
  } catch (e) { toast('저장 실패: ' + e.message); }
}
/* 메모 그 자리 수정 — 클릭 → input, Enter 저장 / Esc·바깥 클릭 취소 */
function admgrTestMemo(ev, adId) {
  const td = ev.currentTarget;
  if (td.querySelector('input')) return;
  const cur = (admgr.test.state.get(adId) || {}).memo || '';
  td.innerHTML = '<input class="inp" style="min-width:130px;padding:3px 6px;font-size:.74rem;" placeholder="메모 입력 후 Enter" />';
  const inp = td.querySelector('input');
  inp.value = cur; inp.focus();
  inp.onkeydown = async (e) => {
    if (e.key === 'Enter') {
      inp.onblur = null;
      const v = inp.value.trim();
      try { await admgrTestSave(adId, { memo: v || null }); } catch (err) { toast('저장 실패: ' + err.message); }
      renderAdmgr(true);
    } else if (e.key === 'Escape') { inp.onblur = null; renderAdmgr(true); }
  };
  inp.onblur = () => renderAdmgr(true);
}
/* 표시 행 계산 공용 — 화면 표와 엑셀 추출이 같은 필터·검색·정렬을 쓴다 */
function admgrTestRowSets() {
  const t = admgr.test;
  if (!t.loaded) return { vis: [], hid: [], rows: [] };
  const all = ((t.data || {}).ads || []).map(a => { const meta = t.state.get(a.id) || {}; return { ...a, meta, st: admgrTestStatusOf(a, meta) }; });
  const vis = all.filter(a => !a.meta.hidden);
  const hid = all.filter(a => a.meta.hidden);
  let rows = t.showHidden ? hid
    : t.filter === 'all' ? vis
    : t.filter === 'req' ? vis.filter(a => a.meta.asset_req_at)
    : t.filter === 'gone' ? vis.filter(a => a.gone)
    : t.filter === 'judge' ? vis.filter(a => ['off', 'good'].includes((admgrRecommend(a) || {}).k))
    : vis.filter(a => a.st === t.filter);
  if (admgr.q) rows = rows.filter(a => (a.name + ' ' + a.adset_name).normalize('NFC').toLowerCase().includes(admgr.q.normalize('NFC')));
  // 정렬을 안 골랐으면 '판정 필요 순': OFF·우수 후보 → 기준 미달 → 지켜보기 → 판정 끝난 것, 같은 급에선 D+ 큰 순
  return { vis, hid, rows: rows.slice().sort(admgr.sort.length ? admgrCmp : admgrTJudgeCmp) };
}
/* 엑셀 추출 — 지금 화면에 보이는 표 그대로 */
async function admgrTestXlsx() {
  try {
    if (typeof XlsxPopulate === 'undefined') throw new Error('엑셀 라이브러리 로드 실패 — 페이지를 새로고침해 주세요');
    const t = admgr.test;
    const { rows } = admgrTestRowSets();
    if (!rows.length) { toast('내려받을 소재가 없어요'); return; }
    const wb = await XlsxPopulate.fromBlankAsync();
    const ws = wb.sheet(0).name('테스트 소재');
    const heads = ['광고세트명', '소재명', '등록일', 'D+', '상태', '누적 지출', '구매', '구매당 비용', 'ROAS', '추가소재 요청일', '제작완료일', '메모', '노출', 'CTR', '3초 재생율', '랜딩 도착률', '장바구니', '빈도', '퍼널 진단'];
    heads.forEach((h, i) => ws.cell(1, i + 1).value(h).style({ bold: true, fill: 'EEF2FF' }));
    [34, 34, 12, 6, 10, 12, 8, 12, 8, 14, 12, 24, 10, 8, 10, 10, 8, 6, 14].forEach((w, i) => ws.column(i + 1).width(w));
    const fbase = admgrFunnelBase(admgrTestRowSets().vis);
    rows.forEach((a, ri) => {
      const r = ri + 2;
      const dp = admgrDPlus(a);
      const put = (c, v) => { if (v !== '' && v != null) ws.cell(r, c).value(v); };
      put(1, a.adset_name); put(2, a.name);
      put(3, a.reg_date || ''); put(4, dp == null ? '' : dp);
      put(5, ADMGR_ST_LABEL[a.st] + (a.st === 'off' ? (a.status === 'PAUSED' ? ' (소재 꺼짐)' : ' (상위 꺼짐)') : a.gone && a.st !== 'ended' ? ' (테스트 종료)' : ''));
      put(6, Math.round(a.spend)); put(7, a.purchases);
      put(8, a.purchases > 0 ? Math.round(a.spend / a.purchases) : '');
      put(9, a.spend > 0 ? Number((a.value / a.spend).toFixed(2)) : '');
      put(10, a.meta.asset_req_at ? String(a.meta.asset_req_at).slice(0, 10) : '');
      put(11, a.meta.asset_done_at ? String(a.meta.asset_done_at).slice(0, 10) : '');
      put(12, a.meta.memo || '');
      const fr = admgrFunnelRates(a);
      put(13, a.imp || 0); if (fr) { put(14, Number((fr.ctr * 100).toFixed(2))); if (fr.ts != null) put(15, Number((fr.ts * 100).toFixed(1))); if (fr.lpvR != null) put(16, Number((fr.lpvR * 100).toFixed(0))); put(17, a.atc || 0); put(18, Number((fr.freq || 0).toFixed(1))); }
      put(19, admgrFunnelDiag(a, fbase).label);
    });
    [6, 7, 8].forEach(c => ws.range(2, c, rows.length + 1, c).style('numberFormat', '#,##0'));
    const out = await wb.outputAsync();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const FILT = { all: '전체', eval: '평가중', off: 'OFF', meh: '애매', good: '우수', req: '추가소재요청', gone: '테스트종료' };
    a.download = `테스트소재_${t.showHidden ? '제거목록' : FILT[t.filter] || '전체'}_${todayStr(0)}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { toast('엑셀 추출 실패: ' + e.message); }
}
/* ═══ 주간 리포트 — 상품팀 전달용 (2026-09-11) ═══
   기간 안에 판정한 우수·애매(verdict_at), 추가소재 진행 현황, 기간 안에 등록된 새 테스트·종료를 상품(세트명 첫 _ 앞)별로 묶는다.
   출력: 화면 모달 + 플로우 붙여넣기용 텍스트 + 인쇄(PDF) 창. 썸네일은 creatives 액션(10분 캐시)에서 세트 단위로 가져온다. */
const ADMGR_RP_SECS = [   // [키, 제목, 짧은 이름(요약 칩), 색, 설명]
  ['good',    '우수 → 추가소재 제작 요청', '우수',        '#16a34a', '기간 안에 우수로 판정한 소재. 같은 상품·같은 소구점으로 추가소재를 만들어 주세요.'],
  ['pending', '추가소재 진행 중',         '진행 중',      '#4f46e5', '요청은 됐고 아직 제작완료 체크가 안 된 소재 (기간 무관).'],
  ['done',    '추가소재 제작완료',         '제작완료',     '#0891b2', '기간 안에 제작완료로 체크된 소재.'],
  ['meh',     '애매 (지켜보는 중)',        '애매',        '#ea580c', '기간 안에 애매로 판정. 반응은 있는데 확신이 없어 조금 더 돌려봅니다.'],
  ['fresh',   '새로 시작한 테스트',         '새 테스트',    '#2563eb', '기간 안에 등록돼 아직 평가 중인 소재.'],
  ['ended',   '종료·OFF',                 '종료',        '#6b7280', '기간 안에 등록됐다가 판정 없이 꺼진 소재.'],
];
/* ═══ 테스트 리포트 고도화 (2026-09-17) — OFF·우수 소재 공통점 비교, 실패 이유 분포, 추가소재 방향.
   숫자 공통점(형식·소구점·가격대·등록자·문구 훅·퍼널 단계)은 여기서, 눈으로 보는 공통점(컷 유형·자막)은 scripts/test-insight.mjs가 썸네일을 보고 태그를 달아 shared_state test_report_ai로 넘긴다.
   ponytail: 표본 5개 미만은 '표본 부족' 표시만, 통계 검정 없음 */
/* 릴스 영상 태그(scripts/video-tags.mjs가 프레임을 보고 단 것) → 비교 축 값. 영상은 첫 장면이 아니라 전체 구성 기준 (2026-09-18) */
function admgrVideoFeat(vt) {
  if (!vt) return null;
  const sc = Array.isArray(vt.scenes) ? vt.scenes : [], subs = Array.isArray(vt.subtitles) ? vt.subtitles : [];
  const kinds = sc.map(x => x.kind).filter(Boolean);
  const main = kinds.length ? kinds.slice().sort((a, b) => kinds.filter(k => k === b).length - kinds.filter(k => k === a).length)[0] : null;   // 가장 많이 나온 장면 유형
  return { cut: main || null, text: subs.length > 0, size: !!(vt.size_number && vt.size_number.shown), hook: vt.hook || null,
    cutsB: vt.cuts >= 8 ? '컷 8+' : vt.cuts >= 4 ? '컷 4~7' : vt.cuts >= 1 ? '컷 1~3' : null, src: 'video' };
}
const ADMGR_HOOK_RE = /\b(44|55|66|77|88)\b|사이즈|kg|\d{2,3}\s?cm|뱃살|팔뚝|허벅지|골반|체형|커버|날씬|슬림|가려|숨겨/;
function admgrPriceOf(name) { const n = admgrNorm(name); const p = admgrProdIdx().find(p => n.includes(p.n)); return p ? p.price : 0; }
const admgrPriceBand = pr => !pr ? '가격 미상' : pr < 30000 ? '3만 미만' : pr < 50000 ? '3~5만' : pr < 80000 ? '5~8만' : '8만 이상';
function admgrAdFeat(a, base, cre, ai, kinds, vtags) {   // 소재 하나의 비교 축 값. kinds = Map(광고 id → is_video) — 썸네일 조회 응답 (등록 기록·퍼널 없는 옛 소재의 형식 폴백)
  const c = cre.get(String(a.id)), r = admgrFunnelRates(a), kv = kinds && kinds.get(String(a.id));
  const vf = admgrVideoFeat(vtags && vtags[a.id]);   // 영상 태그가 있으면 썸네일 태그보다 우선 (영상 전체를 본 결과)
  const tg = vf || (ai && ai.tags && ai.tags[a.id]);
  const fmt = c ? (c.kind === 'video' ? '릴스' : '이미지') : kv != null ? (kv ? '릴스' : '이미지') : a.v3 > 0 ? '릴스' : a.imp > 0 ? '이미지' : '미상';
  const msg = c && c.text && c.text.message ? String(c.text.message).normalize('NFC') : '';
  return { fmt, tag: (c && admgrTagOf(c.file_name)) || '미기입', price: admgrPriceBand(admgrPriceOf(a.adset_name || a.name)),
    who: c ? (whoName(c.created_by_name, c.created_by_email) || '?') : '외부 등록', hook: msg ? (ADMGR_HOOK_RE.test(msg) ? '훅 있음' : '훅 없음') : '문구 미상', vhook: vf ? vf.hook : null,
    diag: admgrFunnelDiag(a, base), ctr: r ? r.ctr : null, ts: r ? r.ts : null, cvr: r ? r.cvr : null, roas: a.spend > 0 ? (a.value || 0) / a.spend : 0,
    cut: tg ? (tg.cut || '미상') : null, text: tg ? (tg.text ? '자막 있음' : '자막 없음') : null, size: tg ? (tg.size ? '사이즈 숫자 노출' : '없음') : null,
    cutsB: vf ? vf.cutsB : null, tagSrc: vf ? '영상 전체' : tg ? '썸네일' : null };
}
const ADMGR_CMP_AXES = [['fmt', '형식'], ['tag', '소구점'], ['price', '가격대'], ['who', '등록자'], ['hook', '문구 훅(사이즈·체형)'], ['cut', 'AI 장면 유형'], ['text', 'AI 자막'], ['size', 'AI 사이즈 노출'], ['vhook', '릴스 훅(첫 1초)'], ['cutsB', '릴스 컷 전환']];
function admgrReportCompare(rows, pick, base, cre, ai, kinds, vtags) {
  const F = list => list.map(a => ({ a, f: admgrAdFeat(a, base, cre, ai, kinds, vtags) }));
  const off = F(rows.filter(pick.offAll)), good = F(rows.filter(pick.goodAll));
  const dist = (L, k) => { const m = {}; L.forEach(x => { const v = x.f[k]; if (v == null) return; m[v] = (m[v] || 0) + 1; }); return Object.entries(m).sort((x, y) => y[1] - x[1]); };
  const cnt = (L, k) => L.filter(x => x.f[k] != null).length;   // 축별 분모 — AI 태그는 썸네일 본 소재만 있으므로 그룹 전체 수로 나누면 비율이 틀린다
  const axes = ADMGR_CMP_AXES.map(([k, label]) => ({ k, label, off: dist(off, k), good: dist(good, k), offN: cnt(off, k), goodN: cnt(good, k) })).filter(x => x.off.length || x.good.length);
  const med = L => ({ ctr: admgrMedian(L.map(x => x.f.ctr)), ts: admgrMedian(L.map(x => x.f.ts)), cvr: admgrMedian(L.map(x => x.f.cvr)), roas: admgrMedian(L.map(x => x.f.roas)) });
  const reasons = dist(off.map(x => ({ f: { d: x.f.diag.label } })), 'd').map(([label, n]) => ({ label, n, fix: (off.find(x => x.f.diag.label === label) || {}).f.diag.fix.replace(/^[^—]*—\s*/, '') }));
  // 공통점 = 한쪽에 치우친 값: 그 값의 비율이 상대 그룹보다 20%p 이상 높고 2개↑ (양쪽 다 흔한 '자막 있음 90% vs 88%'는 공통점이 아니다)
  const share = (d, v, n) => { const e = d.find(x => x[0] === v); return n ? (e ? e[1] : 0) / n : 0; };
  const lean = (mine) => axes.flatMap(x => { const nm = mine === good ? x.goodN : x.offN, no = mine === good ? x.offN : x.goodN; return (mine === good ? x.good : x.off).map(([v, n]) => { const a = n / nm, b = share(mine === good ? x.off : x.good, v, no); return n >= 2 && a - b >= 0.2 && !/미상|미기입|외부 등록|문구 미상/.test(v) ? { s: `${x.label} ${v} ${Math.round(a * 100)}% (${mine === good ? 'OFF' : '우수'} ${Math.round(b * 100)}%)`, d: a - b } : null; }); }).filter(Boolean).sort((x, y) => y.d - x.d).map(x => x.s);
  return { off: { n: off.length, med: med(off), items: off }, good: { n: good.length, med: med(good), items: good }, axes, reasons, commonGood: lean(good), commonOff: lean(off), thin: off.length < 5 || good.length < 5 };
}
/* 추가소재 방향 — 상품별 제작 요청 문장 (규칙). AI 해석은 별도 */
function admgrReportDirs(cmp, product, pkey) {
  pkey = pkey || (a => product(a));
  const byProd = L => { const m = new Map(); L.forEach(x => { const k = pkey(x.a); (m.get(k) || m.set(k, []).get(k)).push(x); }); return m; };
  const G = byProd(cmp.good.items), O = byProd(cmp.off.items), out = [];
  for (const [, L] of G) {
    const name = product(L[0].a);
    const fmts = new Set(L.map(x => x.f.fmt)), tags = [...new Set(L.map(x => x.f.tag).filter(t => t !== '미기입'))];
    const asks = [tags.length ? `같은 소구점(${tags.join('·')})으로 다른 컷 2개` : '소구점을 정해서 2개 (지금 미기입)'];
    if (fmts.has('릴스') && !fmts.has('이미지')) asks.push('이미지 변형 1개'); else if (fmts.has('이미지') && !fmts.has('릴스')) asks.push('릴스 1개 (첫 1초 = 이미지의 훅 장면)');
    if (L.some(x => x.f.hook === '훅 없음')) asks.push('문구에 사이즈 숫자·체형커버 훅');
    const roas = admgrMedian(L.map(x => x.f.roas));
    out.push({ kind: 'good', name, why: `우수 ${L.length}개 · ROAS ${roas != null ? roas.toFixed(1) : '—'}`, asks });
  }
  const FIX = { '후크 약함': '첫 1초 장면·자막만 바꾼 재편집 1개', '클릭 약함': '소구점 바꿔서 1개 (문구 첫 줄도 함께)', '랜딩 이탈': '새 소재 보류 — 링크·상세페이지 로딩 점검', '장바구니 이탈': '새 소재 보류 — 상세페이지·가격·옵션 점검', '클릭↑ 구매 0': '새 소재 보류 — 상세페이지·가격·후기 점검', '노출 부족': '판단 보류 — 예산·기간이 짧아 꺼짐', '퍼널 균형': '소재는 통함 — 꺼진 이유(예산·시즌) 확인 후 재가동 검토', '특이 없음': '소재 무난 — 재도전 시 다른 소구점' };
  FIX['구매 0 (클릭 정상)'] = FIX['클릭↑ 구매 0']; FIX['구매 있으나 손해'] = '새 소재 보류 — CPA가 마진보다 큼: 가격·마진·타겟 확인';
  const ACT = new Set(['후크 약함', '클릭 약함', '랜딩 이탈', '장바구니 이탈', '구매 0 (클릭 정상)', '구매 있으나 손해']);
  const offs = [];
  for (const [key, L] of O) {
    if (G.has(key)) continue;
    const d = {}; L.forEach(x => { d[x.f.diag.label] = (d[x.f.diag.label] || 0) + 1; });
    const [top, k] = Object.entries(d).sort((x, y) => y[1] - x[1])[0];
    if (L.length < 2 && !ACT.has(top)) continue;   // OFF 1개짜리 '특이 없음'은 방향이 안 나온다 — 목록에서 제외
    offs.push({ kind: 'off', name: product(L[0].a), why: `OFF ${L.length}개 · ${top} ${k}개`, asks: [FIX[top] || '재도전 시 다른 소구점'], _n: L.length, _s: L.reduce((s0, x) => s0 + (x.a.spend || 0), 0) });
  }
  offs.sort((x, y) => y._n - x._n || y._s - x._s).slice(0, 10).forEach(({ _n, _s, ...d }) => out.push(d));
  return out;
}
function admgrReportBuild(rows, days, today, opt) {
  const from = (() => { const d = new Date(today); d.setDate(d.getDate() - (days - 1)); return d.toISOString().slice(0, 10); })();
  const inWin = iso => { const d = String(iso || '').slice(0, 10); return !!d && d >= from && d <= today; };
  const vAt = a => a.meta.verdict_at || a.meta.updated_at;        // verdict_at 없는 옛 판정은 updated_at으로
  const pick = {
    good:    a => a.st === 'good' && inWin(vAt(a)),
    pending: a => !!a.meta.asset_req_at && !a.meta.asset_done_at,
    done:    a => inWin(a.meta.asset_done_at),
    meh:     a => a.st === 'meh' && inWin(vAt(a)),
    fresh:   a => inWin(a.reg_date) && (a.st === 'eval' || a.st === 'review'),
    ended:   a => inWin(a.reg_date) && ['off', 'ended', 'rejected'].includes(a.st),
    // 공통점 비교용 그룹 — OFF: 기간 안 등록돼 꺼진 것, 우수: 기간 안에 우수 판정(꺼졌어도 판정은 판정)
    offAll:  a => inWin(a.reg_date) && ['off', 'ended', 'rejected'].includes(a.st),
    goodAll: a => a.meta.verdict === 'good' && inWin(vAt(a)),
  };
  // 세트명 첫 _ 앞 = 상품 (fileCore는 확장자 제거 규칙이 '(가을VER.)' 같은 점을 잘라 못 씀) — 괄호·날짜 꼬리·가격 숫자 제거
  const product = a => coreName(String(a.adset_name || a.name || '').split('_')[0].replace(/\s+\d{6}\b.*$/, '')).replace(/\s+\d{2,}\s*$/, '')
    .replace(/(\s+(?:[RP]\d+|릴스\d*|스토리\d*|다나스토리\d*|인스타\d*|test|\d))+$/i, '').trim() || '(상품 미상)';   // 꼬리 가격·마진 숫자, 순번(P3·릴스1·2), test 제거 → '헬린 드레이프 티 P3' = '헬린 드레이프 티'
  const pkey = a => product(a).replace(/\s+/g, '');   // '안스 후드 집업' = '안스 후드집업' — 띄어쓰기 무시해 같은 상품으로
  const group = list => {
    const m = new Map();
    list.slice().sort((x, y) => y.spend - x.spend).forEach(a => { const k = pkey(a); (m.get(k) || m.set(k, []).get(k)).push(a); });
    return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0], 'ko')).map(([, ads]) => ({ name: product(ads[0]), ads }));
  };
  const secs = ADMGR_RP_SECS.map(([key, title, short, color, note]) => { const list = rows.filter(pick[key]); return { key, title, short, color, note, n: list.length, groups: group(list) }; });
  const o = opt || {}, cre = o.cre || admgr.test.creatives || new Map();
  const cmp = admgrReportCompare(rows, pick, admgrFunnelBase(rows), cre, o.ai || null, o.kinds || admgr.test.kinds || null, o.vtags || admgr.test.vtags || null);
  const dirs = admgrReportDirs(cmp, product, pkey);
  const seen = new Set(); const all = [];
  secs.forEach(s => s.groups.forEach(g => g.ads.forEach(a => { if (!seen.has(a.id)) { seen.add(a.id); all.push(a); } })));
  [...cmp.off.items, ...cmp.good.items].forEach(x => { if (!seen.has(x.a.id)) { seen.add(x.a.id); all.push(x.a); } });   // 썸네일 조회·AI 태그 대상에 포함
  return { from, to: today, days, secs, all, cmp, dirs, ai: o.ai || null };
}
function admgrReportLine(a) {
  const dp = admgrDPlus(a);
  const parts = [dp == null ? '' : 'D+' + dp, '지출 ' + won(a.spend), '구매 ' + comma(a.purchases),
    a.purchases > 0 ? 'CPA ' + won(a.spend / a.purchases) : '', a.spend > 0 ? 'ROAS ' + (a.value / a.spend).toFixed(1) : '',
    a.meta.asset_req_at ? '요청 ' + fmtMD(String(a.meta.asset_req_at).slice(0, 10)) : '',
    a.meta.asset_done_at ? '제작완료 ' + fmtMD(String(a.meta.asset_done_at).slice(0, 10)) : ''];
  return parts.filter(Boolean).join(' · ');
}
/* ═══ 리포트 화면 재구성 (2026-09-17 시안 승인) — 결론 한 장 먼저, 근거는 접기.
   첫 화면: 숫자 3개 + 결론 3줄(통한 것·안 통한 이유·다음 주) + 이번 주 할 일(상품별 체크리스트). 아래는 <details>로 접힘: 왜 그런가(칩·막대·비교표), 소재 목록, AI 원문.
   텍스트 복사는 '요약'(첫 화면만, 플로우용)과 '전체' 둘. AI 해석이 있으면 결론·할 일에 AI 문장을 우선 쓰고, 없으면 규칙 문장 */
function admgrAiBlock(ai, title) {   // AI 해석 원문에서 '■ 제목' 아래 줄들
  if (!ai || !ai.text) return [];
  const m = ai.text.match(new RegExp('■\\s*' + title + '[^\\n]*\\n([\\s\\S]*?)(?=\\n■|$)'));
  return m ? m[1].split('\n').map(s => s.replace(/^[\s·\-•]+/, '').trim()).filter(Boolean) : [];
}
/* ═══ 할 일 추적 (2026-09-17) — 리포트 체크박스를 계정 공유 상태 test_todo에 저장.
   항목 키 = 상품명(띄어쓰기 무시) + 종류. 다음 리포트에서 "지난주 할 일 n개 중 완료 m"을 보여주고, 안 끝난 항목은 '지난주부터' 표시로 다시 올라온다 */
const admgrTodoKey = (name, kind) => String(name || '').normalize('NFC').replace(/\s+/g, '') + '|' + (kind || 'good');
function admgrTodoMerge(cur, saved, today) {   // cur = 이번 리포트 할 일, saved = 저장된 items → { items(표시용), prev:{n, done} }
  const S = Array.isArray(saved) ? saved : [];
  const byKey = new Map(S.map(x => [x.key, x]));
  const now = new Date().toISOString();
  const items = cur.map(t => { const k = admgrTodoKey(t.name, t.kind), o = byKey.get(k); return { ...t, key: k, done: !!(o && o.done), doneAt: o && o.doneAt || null, doneBy: o && o.doneBy || '', addedAt: o && o.addedAt || now, carried: !!(o && String(o.addedAt || '').slice(0, 10) < today && !o.done) }; });
  const keys = new Set(items.map(x => x.key));
  const cutoff = admgrShiftDay(today, -30);
  S.forEach(o => { if (!keys.has(o.key) && !o.done && String(o.addedAt || '').slice(0, 10) >= cutoff) items.push({ ...o, carried: true }); });   // 지난 리포트에서 못 끝낸 것은 이어서
  const prev = S.filter(o => String(o.addedAt || '').slice(0, 10) < today);
  return { items: items.slice(0, 12), prev: { n: prev.length, done: prev.filter(o => o.done).length } };
}
async function admgrTodoToggle(key) {
  const isBest = admgrRp.kind === 'best', t = admgr.test, rep = isBest ? admgr.best.report : t.report; if (!rep || !rep.todo) return;
  const it = rep.todo.items.find(x => x.key === key); if (!it) return;
  it.done = !it.done; it.doneAt = it.done ? new Date().toISOString() : null; it.doneBy = it.done ? ((AUTH.me && (AUTH.me.name || AUTH.me.email)) || ADMGR_USER) : '';
  (rep.todo.dirty = rep.todo.dirty || new Set()).add(key);   // 내가 바꾼 항목만 저장 때 내 값을 쓴다
  await admgrTodoSave(rep, isBest ? 'best_todo' : 'test_todo');
  $('rp-body').innerHTML = isBest ? admgrBestReportHtml(rep, admgr.best.ai) : admgrReportHtml(rep, t.thumbs);
}
async function admgrTodoSave(rep, stateKey) {
  stateKey = stateKey || 'test_todo';   // 표시 목록을 저장본에 합쳐 저장 — 남이 먼저 저장했으면 최신본 위에 다시
  if (admgr.demo) return;
  for (let tries = 0; tries < 2; tries++) {
    try {
      const cur = await sbCall('client-log', { action: 'state_get', key: stateKey });
      const base = (cur.data && Array.isArray(cur.data.items)) ? cur.data.items : [];
      const m = new Map(base.map(x => [x.key, x]));
      const dirty = rep.todo.dirty || new Set();
      rep.todo.items.forEach(({ carried, ...x }) => { const o = m.get(x.key), mine = dirty.has(x.key) || !o;   // 안 건드린 항목은 서버의 완료 상태 유지 (다른 사람·자동 실행이 바꾼 것 보존)
        m.set(x.key, { key: x.key, name: x.name, text: x.text, kind: x.kind, why: x.why || '', done: mine ? !!x.done : !!o.done, doneAt: mine ? (x.doneAt || null) : (o.doneAt || null), doneBy: mine ? (x.doneBy || '') : (o.doneBy || ''), addedAt: (o && o.addedAt) || x.addedAt }); });
      const items = [...m.values()].filter(x => String(x.addedAt || '').slice(0, 10) >= admgrShiftDay(todayStr(0), -120));   // 4달 지난 건 정리
      const r = await sbCall('client-log', { action: 'state_set' }, { key: stateKey, base: cur.ver || null, data: { items } });
      if (!r.conflict) return;
    } catch (e) { if (tries) toast('할 일 저장 실패: ' + e.message); }
  }
}
function admgrReportSummary(rep) {
  const c = rep.cmp, ai = rep.ai, secs = Object.fromEntries(rep.secs.map(s => [s.key, s]));
  const judged = c.off.n + c.good.n + secs.meh.n;
  const top = c.reasons.filter(r => !/특이 없음|퍼널 균형|데이터 없음/.test(r.label))[0] || c.reasons[0];
  const first = (t, fb) => admgrAiBlock(ai, t)[0] || fb;
  const win = first('우수 소재 공통점', c.commonGood.length ? c.commonGood.slice(0, 2).join(' · ') + '이(가) 우수 쪽에 몰려 있어요' : c.good.n ? '우수 소재에 두드러진 공통점이 아직 없어요' : '기간 안 우수 판정이 없어요');
  const why = first('실패 이유 추측', top ? `OFF ${c.off.n}개 중 ${top.n}개가 ${top.label} — ${top.fix}` : 'OFF 소재가 없어요');
  const G = rep.dirs.filter(d => d.kind === 'good'), O = rep.dirs.filter(d => d.kind === 'off');
  const next = G.length || O.length ? `우수 ${G.length}개 상품에 추가 소재 ${G.reduce((s0, d) => s0 + d.asks.length, 0)}건${O.length ? `, OFF ${O.length}개 상품은 점검·재시도` : ''} — 아래 목록대로` : '다음 주 할 일이 없어요 — 새 테스트 등록부터';   // 요약 문장은 규칙으로 (AI 방향은 상품별 줄이라 한 줄 요약엔 안 맞음)
  // 할 일: AI 방향 줄("상품 — 내용") 우선, 규칙 방향 중 AI가 안 다룬 상품 추가. 최대 8
  const todo = [];
  admgrAiBlock(ai, '추가소재 방향').forEach(l => { const m = l.match(/^(.+?)\s*[—\-–:]\s*(.+)$/); if (!m) return; const d = rep.dirs.find(x => x.name.replace(/\s/g, '') === m[1].replace(/\s/g, '') || m[1].includes(x.name) || x.name.includes(m[1].replace(/·.*$/, ''))); todo.push({ name: m[1], text: m[2], kind: d ? d.kind : 'good', why: d ? d.why : '' }); });
  [...G, ...O].forEach(d => { if (todo.length >= 8 || todo.some(t => t.name.replace(/\s/g, '') === d.name.replace(/\s/g, '') || t.name.includes(d.name))) return; todo.push({ name: d.name, text: d.asks.join(' / '), kind: d.kind, why: d.why }); });
  const merged = rep.todo || admgrTodoMerge(todo.slice(0, 8), rep.todoSaved || [], rep.to);
  return { kpi: { good: c.good.n, off: c.off.n, fresh: secs.fresh.n, rate: judged ? Math.round(c.good.n / judged * 100) : null, judged, prods: new Set(c.good.items.map(x => admgrProductOf(x.a))).size }, win, why, next, todo: merged.items, prev: merged.prev };
}
function admgrReportText(rep, mode) {   // mode: 'summary' = 첫 화면만(플로우용) · 그 외 = 전체
  const S = admgrReportSummary(rep), c = rep.cmp;
  const L = [`📋 테스트 소재 리포트 · ${fmtMD(rep.from)}~${fmtMD(rep.to)} (${rep.days}일)`,
    `우수 ${S.kpi.good} · OFF ${S.kpi.off} · 우수율 ${S.kpi.rate == null ? '—' : S.kpi.rate + '%'} (판정 ${S.kpi.judged}개) · 새 테스트 ${S.kpi.fresh}`, '',
    `■ 결론`, ` · 통한 것: ${S.win}`, ` · 안 통한 이유: ${S.why}`, ` · 다음 주: ${S.next}`, '',
    `■ 이번 주 할 일${S.prev.n ? ` (지난주 ${S.prev.n}개 중 완료 ${S.prev.done})` : ''}`];
  if (!S.todo.length) L.push('  없음');
  S.todo.forEach(t => L.push(` ${t.done ? '☑' : '☐'} ${t.name} — ${t.text}${t.why ? ` (${t.why})` : ''}${t.carried ? ' · 지난주부터' : ''}`));
  if (mode === 'summary') return L.join('\n').trim();
  if (c) {
    const pct = v => v == null ? '—' : (v * 100).toFixed(v < 0.1 ? 2 : 0) + '%';
    const dl = d => d.map(([v, n]) => `${v} ${n}`).join(' · ') || '—';
    L.push('', `■ 왜 그런가`, ` · 우수 공통점: ${c.commonGood.slice(0, 3).join(' · ') || (c.good.n ? 'OFF보다 두드러진 항목 없음' : '우수 소재 없음')}`, ` · OFF 공통점: ${c.commonOff.slice(0, 3).join(' · ') || (c.off.n ? '우수보다 두드러진 항목 없음' : 'OFF 소재 없음')}`);
    c.reasons.forEach(r => L.push(` · 실패 이유 ${r.label} ${r.n} — ${r.fix}`));
    L.push('', `■ 비교표 (OFF ${c.off.n} vs 우수 ${c.good.n})${c.thin ? ' — 표본 5개 미만은 참고만' : ''}`);
    c.axes.forEach(x => L.push(` · ${x.label} — OFF: ${dl(x.off)} | 우수: ${dl(x.good)}${/^AI|^릴스/.test(x.label) ? ` (태그 OFF ${x.offN}·우수 ${x.goodN}개 기준)` : ''}`));
    L.push(` · 중앙값 — CTR OFF ${pct(c.off.med.ctr)} | 우수 ${pct(c.good.med.ctr)} · 3초 재생 OFF ${pct(c.off.med.ts)} | 우수 ${pct(c.good.med.ts)} · 전환율 OFF ${pct(c.off.med.cvr)} | 우수 ${pct(c.good.med.cvr)} · ROAS OFF ${c.off.med.roas != null ? c.off.med.roas.toFixed(1) : '—'} | 우수 ${c.good.med.roas != null ? c.good.med.roas.toFixed(1) : '—'}`);
  }
  L.push('');
  rep.secs.forEach(s => {
    L.push(`■ ${s.title} (${s.n})`);
    if (!s.n) L.push('  없음');
    s.groups.forEach(g => {
      if (s.key === 'fresh' || s.key === 'ended') { L.push(` · ${g.name} ${g.ads.length}개: ${g.ads.map(a => a.adset_name).join(' / ')}`); return; }
      L.push(`[${g.name}]`);
      g.ads.forEach(a => { L.push(` · ${a.adset_name} — ${admgrReportLine(a)}`); if (a.meta.memo) L.push(`   메모: ${a.meta.memo}`); });
    });
    L.push('');
  });
  if (rep.ai && rep.ai.text) L.push(`■ AI 해석 원문 (${fmtMD(String(rep.ai.at || '').slice(0, 10))} 생성)`, rep.ai.text.trim());
  return L.join('\n').trim();
}
function admgrReportCmpHtml(rep) {   // 비교표 (접힘 안 내용)
  const c = rep.cmp; if (!c) return '';
  const pct = v => v == null ? '—' : (v * 100).toFixed(v < 0.1 ? 2 : 0) + '%';
  const cell = (d, n) => d.map(([v, k]) => `<span style="display:inline-block;margin:1px 6px 1px 0;white-space:nowrap;">${esc(v)} <b>${k}</b><span style="color:#9ca3af;font-size:.66rem;">(${n ? Math.round(k / n * 100) : 0}%)</span></span>`).join(' ') || '<span style="color:#c4c9d4;">—</span>';
  const td = 'padding:3px 8px;border-top:1px solid #f1f2f6;white-space:normal;';
  return `<table style="border-collapse:collapse;width:100%;font-size:.76rem;table-layout:fixed;"><colgroup><col style="width:110px;"><col><col></colgroup><tr><th style="text-align:left;padding:3px 8px 3px 0;color:#6b7280;font-weight:600;">항목</th><th style="text-align:left;padding:3px 8px;color:#dc2626;font-weight:700;">OFF ${c.off.n}개</th><th style="text-align:left;padding:3px 8px;color:#16a34a;font-weight:700;">우수 ${c.good.n}개</th></tr>
    ${c.axes.map(x => `<tr><td style="padding:3px 8px 3px 0;border-top:1px solid #f1f2f6;color:#4b5563;">${x.label}${/^AI|^릴스/.test(x.label) ? `<div style="font-size:.62rem;color:#c4c9d4;">태그 ${x.offN}·${x.goodN}개</div>` : ''}</td><td style="${td}">${cell(x.off, x.offN)}</td><td style="${td}">${cell(x.good, x.goodN)}</td></tr>`).join('')}
    ${[['CTR 중앙값', pct(c.off.med.ctr), pct(c.good.med.ctr)], ['3초 재생 중앙값', pct(c.off.med.ts), pct(c.good.med.ts)], ['전환율 중앙값', pct(c.off.med.cvr), pct(c.good.med.cvr)], ['ROAS 중앙값', c.off.med.roas != null ? c.off.med.roas.toFixed(1) : '—', c.good.med.roas != null ? c.good.med.roas.toFixed(1) : '—']].map(([l, a, b]) => `<tr><td style="padding:3px 8px 3px 0;border-top:1px solid #f1f2f6;color:#4b5563;">${l}</td><td style="${td}"><b>${a}</b></td><td style="${td}"><b>${b}</b></td></tr>`).join('')}</table>
    ${c.thin ? '<div style="font-size:.7rem;color:#b45309;margin-top:6px;">표본 5개 미만은 참고만 — 기간을 30일로 늘리면 정확해져요</div>' : ''}`;
}
function admgrReportHtml(rep, thumbs) {
  const S = admgrReportSummary(rep), c = rep.cmp;
  const kpi = (label, val, sub, color) => `<div style="background:#f8fafc;border:1px solid #e7e8ee;border-radius:12px;padding:10px 14px;"><div style="font-size:.7rem;color:#6b7280;">${label}</div><b style="font-size:1.25rem;color:${color || '#1e1b4b'};">${val}</b>${sub ? `<span style="color:#6b7280;font-size:.7rem;margin-left:6px;">${sub}</span>` : ''}</div>`;
  const h3 = (t, n) => `<div style="display:flex;align-items:center;gap:8px;margin:18px 0 8px;font-size:.92rem;font-weight:800;color:#111827;">${t}${n ? `<span style="font-size:.72rem;color:#6b7280;font-weight:600;">${n}</span>` : ''}</div>`;
  const det = (title, n, body, open) => `<details ${open ? 'open' : ''} style="border:1px solid #e7e8ee;border-radius:12px;margin-top:8px;background:#fff;"><summary style="cursor:pointer;padding:9px 14px;font-size:.84rem;font-weight:700;color:#374151;display:flex;align-items:center;gap:8px;list-style:none;"><span class="rp-arrow" style="color:#9ca3af;display:inline-block;transition:transform .15s;">▸</span>${esc(title)}${n ? `<span style="color:#6b7280;font-weight:600;font-size:.74rem;">${n}</span>` : ''}</summary><div style="padding:0 14px 12px;font-size:.8rem;color:#4b5563;line-height:1.7;">${body}</div></details>`;
  const head = `<div style="font-size:1.02rem;font-weight:800;color:#1e1b4b;">테스트 소재 리포트 <span style="font-weight:600;color:#6b7280;font-size:.82rem;margin-left:4px;">${fmtMD(rep.from)} ~ ${fmtMD(rep.to)} (${rep.days}일)${rep.ai && rep.ai.text ? ` · AI 해석 ${fmtMD(String(rep.ai.at || '').slice(0, 10))} · 썸네일 ${Object.keys(rep.ai.tags || {}).length}장 분석` : ''}</span></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0;">${kpi('우수', S.kpi.good, `상품 ${S.kpi.prods}개`, '#16a34a')}${kpi('OFF·종료', S.kpi.off, `새 테스트 ${S.kpi.fresh} 중`, '#dc2626')}${kpi('우수율', S.kpi.rate == null ? '—' : S.kpi.rate + '%', `판정 ${S.kpi.judged}개 기준`)}</div>
    <div style="border-left:4px solid #4f46e5;padding:2px 0 2px 12px;margin:10px 0 4px;font-size:.9rem;line-height:1.6;">
      <div style="padding:3px 0;"><b style="color:#1e1b4b;font-size:.76rem;margin-right:6px;">통한 것</b>${esc(S.win)}</div>
      <div style="padding:3px 0;"><b style="color:#1e1b4b;font-size:.76rem;margin-right:6px;">안 통한 이유</b>${esc(S.why)}</div>
      <div style="padding:3px 0;"><b style="color:#1e1b4b;font-size:.76rem;margin-right:6px;">다음 주</b>${esc(S.next)}</div></div>`;
  const nG = S.todo.filter(t => t.kind === 'good').length, nO = S.todo.length - nG;
  const doneN = S.todo.filter(t => t.done).length;
  const todo = h3('이번 주 할 일', `컨텐츠팀 ${nG} · MD·CS ${nO}${doneN ? ` · 완료 ${doneN}` : ''}${S.prev.n ? ` · <span style="color:#7c3aed;">지난주 ${S.prev.n}개 중 완료 ${S.prev.done}</span>` : ''}`) + `<div style="border:1px solid #ddd6fe;background:#faf5ff;border-radius:12px;padding:6px 12px;">
    ${S.todo.length ? S.todo.map(t => `<label style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-bottom:1px dashed #e9d5ff;font-size:.86rem;cursor:pointer;${t.done ? 'opacity:.55;' : ''}"><input type="checkbox" ${t.done ? 'checked' : ''} onchange="admgrTodoToggle('${esc(t.key)}')" style="margin:3px 0 0;flex:none;accent-color:#7c3aed;" /><span style="${t.kind === 'off' ? 'color:#b91c1c;' : ''}${t.done ? 'text-decoration:line-through;' : ''}"><b style="color:#1e1b4b;">${esc(t.name)}</b> — ${esc(t.text)}${t.carried ? ' <span class="status-badge badge-yellow" style="font-size:.6rem;">지난주부터</span>' : ''}${t.done && t.doneBy ? ` <span style="font-size:.66rem;color:#6b7280;">✓ ${esc(t.doneBy)} ${fmtMD(String(t.doneAt || '').slice(0, 10))}</span>` : ''}</span>${t.why ? `<span style="color:#6b7280;font-size:.72rem;margin-left:auto;white-space:nowrap;" class="m-hide">${esc(t.why)}</span>` : ''}</label>`).join('') : '<div style="padding:6px 0;color:#9ca3af;font-size:.82rem;">없음</div>'}</div>
    <div style="font-size:.7rem;color:#6b7280;margin-top:6px;">체크는 모든 계정에 공유돼요 · "요약 복사"는 결론 3줄 + 이 목록만 복사 (플로우 붙여넣기용)</div>`;
  const chip = (s, cls) => { const m = s.match(/^(.*?)\s(\d+%)\s\((.+)\)$/); return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:.78rem;font-weight:700;margin:3px 4px 3px 0;background:${cls === 'g' ? '#dcfce7' : '#fee2e2'};color:${cls === 'g' ? '#166534' : '#991b1b'};">${esc(m ? `${m[1]} ${m[2]}` : s)}${m ? `<small style="font-weight:500;opacity:.75;margin-left:4px;">${esc(m[3])}</small>` : ''}</span>`; };
  const box = (title, cls, chips, empty) => `<div style="border:1px solid #e7e8ee;border-radius:12px;padding:10px 12px;"><div style="font-size:.78rem;font-weight:800;color:${cls === 'g' ? '#16a34a' : '#dc2626'};margin-bottom:4px;">${title}</div>${chips.length ? chips.map(s => chip(s, cls)).join('') : `<span style="color:#9ca3af;font-size:.78rem;">${empty}</span>`}</div>`;
  const maxN = Math.max(1, ...c.reasons.map(r => r.n));
  const bars = c.reasons.filter(r => !/특이 없음|퍼널 균형|데이터 없음/.test(r.label)).slice(0, 4).map(r => `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:.8rem;"><span style="width:120px;font-weight:700;">${esc(r.label)}</span><span style="width:160px;flex:none;height:9px;background:#f3f4f6;border-radius:999px;overflow:hidden;"><span style="display:block;height:100%;width:${Math.round(r.n / maxN * 100)}%;background:#ef4444;"></span></span><b style="width:24px;">${r.n}</b><span style="color:#6b7280;font-size:.72rem;">${esc(r.fix)}</span></div>`).join('') || '<div style="color:#9ca3af;font-size:.78rem;">막힌 단계가 뚜렷한 OFF 소재가 없어요</div>';
  const why = h3('왜 그런가', '한쪽에 치우친 항목만') + `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;" class="rp-why">${box('우수 소재 공통점', 'g', c.commonGood.slice(0, 3), c.good.n ? 'OFF보다 두드러진 항목 없음' : '우수 소재 없음')}${box('OFF 소재 공통점', 'r', c.commonOff.slice(0, 3), c.off.n ? '우수보다 두드러진 항목 없음' : 'OFF 소재 없음')}</div>
    <div style="margin-top:12px;">${bars}</div>` + det('비교표 전체 보기', '형식·소구점·가격대·등록자·문구 훅·AI 태그 · 중앙값', admgrReportCmpHtml(rep));
  const adRow = a => { const th = thumbs[a.id]; return `<div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-top:1px solid #f1f2f6;">
        <div style="width:48px;height:48px;flex:none;border-radius:8px;background:#f3f4f6;overflow:hidden;">${th ? `<img src="${esc(th)}" style="width:100%;height:100%;object-fit:cover;" />` : ''}</div>
        <div style="min-width:0;flex:1;"><div style="font-size:.78rem;font-weight:700;color:#1f2937;word-break:break-all;">${esc(a.adset_name)}</div><div style="font-size:.7rem;color:#4b5563;">${esc(admgrReportLine(a))}</div>${a.meta.memo ? `<div style="font-size:.7rem;color:#7c3aed;">메모: ${esc(a.meta.memo)}</div>` : ''}</div></div>`; };
  const secBody = s => !s.n ? '<span style="color:#9ca3af;">없음</span>' : s.groups.map(g => (s.key === 'fresh' || s.key === 'ended')
    ? `<div style="margin:3px 0;"><b style="color:#312e81;">${esc(g.name)}</b> <span style="color:#9ca3af;">${g.ads.length}개</span> <span style="color:#6b7280;">${esc(g.ads.map(a => a.adset_name).join(' / '))}</span></div>`
    : `<div style="margin:6px 0;"><div style="font-weight:800;font-size:.84rem;color:#312e81;">${esc(g.name)} <span style="font-weight:600;color:#9ca3af;font-size:.72rem;">${g.ads.length}개</span></div>${g.ads.map(adRow).join('')}</div>`).join('');
  const good = rep.secs.find(s => s.key === 'good'), top5 = c.good.items.slice().sort((x, y) => y.f.roas - x.f.roas).slice(0, 5);
  const goodBody = (top5.length ? `<div style="display:flex;gap:8px;margin:6px 0 8px;">${top5.map(x => { const th = thumbs[x.a.id]; return `<div title="${esc(x.a.adset_name)}" style="width:64px;height:64px;border-radius:8px;background:#f3f4f6;overflow:hidden;position:relative;flex:none;">${th ? `<img src="${esc(th)}" style="width:100%;height:100%;object-fit:cover;" />` : ''}<span style="position:absolute;bottom:3px;right:4px;font-size:.62rem;font-weight:800;color:#fff;background:#111827cc;border-radius:6px;padding:1px 5px;">${x.f.roas.toFixed(1)}</span></div>`; }).join('')}</div>` : '') + secBody(good);
  const list = h3('소재 목록', rep.secs.map(s => `${s.short} ${s.n}`).join(' · '))
    + det(good.title, `${good.n}${top5.length ? ' · 상위 ' + top5.length + ' 미리보기' : ''}`, goodBody, true)
    + rep.secs.filter(s => s.key !== 'good').map(s => det(s.title, s.n, secBody(s), false)).join('');
  const aiSec = rep.ai && rep.ai.text
    ? h3('AI 해석 원문', `${fmtMD(String(rep.ai.at || '').slice(0, 10))} 생성`) + det('펼쳐 보기', 'OFF 공통점 · 실패 이유 · 우수 공통점 · 우수 이유 · 방향 · 주의', `<div style="white-space:pre-line;">${esc(rep.ai.text.trim())}</div>`, false)
    : h3('AI 해석', '아직 없음') + `<div style="font-size:.78rem;color:#9ca3af;">이 리포트를 연 뒤 바탕화면의 <b>테스트리포트-해석.command</b>를 실행하면 썸네일을 보고 컷 유형·자막 태그를 달고 결론·할 일에 AI 문장이 들어가요 (이 맥의 Claude Code, 결제 없음)</div>`;
  const foot = `<div style="font-size:.7rem;color:#9ca3af;margin-top:14px;">OFF = 기간 안 등록돼 꺼진 소재 · 우수 = 기간 안 우수 판정 · 테스트 종료 보관분은 CTR·3초 값 없음 · AI 태그는 썸네일(릴스는 첫 장면) 기준</div>`;
  return head + todo + why + list + aiSec + foot;
}
const admgrRp = { kind: 'test', cur: null };   // 모달에 지금 떠 있는 리포트 — cur = { title, text(), html() } (복사·인쇄 공용)
function admgrReportRefresh() { admgrRp.kind === 'best' ? admgrBestReport() : admgrTestReport(); }
function admgrReportModal() {
  let m = $('admgr-report');
  if (m) return m;
  m = document.createElement('div'); m.className = 'modal'; m.id = 'admgr-report';
  m.onclick = e => { if (e.target === m) closeModal('admgr-report'); };
  m.innerHTML = `<div class="modal-box wide" style="max-width:860px;"><div class="modal-head" style="flex-wrap:wrap;"><b id="rp-title">주간 리포트</b>
    <select id="rp-days" class="inp" style="width:auto;padding:4px 8px;font-size:.76rem;" onchange="admgrReportRefresh()">
      <option value="7">최근 7일</option><option value="14">최근 14일</option><option value="30">최근 30일</option></select>
    <button class="filter-tab" id="rp-copy-sum" style="color:#4f46e5;border-color:#c7d2fe;background:#eef2ff;" onclick="admgrReportCopy('summary')" title="결론 3줄 + 이번 주 할 일만 — 플로우 붙여넣기용"><i class="fa-regular fa-copy"></i> 요약 복사</button>
    <button class="filter-tab" onclick="admgrReportCopy()" title="리포트 전체 텍스트"><i class="fa-regular fa-copy"></i> 전체 복사</button>
    <button class="filter-tab" onclick="admgrReportPrint()" title="새 창 → 인쇄 대화상자에서 PDF로 저장"><i class="fa-solid fa-print"></i> 인쇄·PDF</button>
    <button class="modal-x" onclick="closeModal('admgr-report')">✕</button></div><div id="rp-body"></div></div>`;
  document.body.appendChild(m);
  return m;
}
async function admgrTestReport() {
  const t = admgr.test;
  if (!t.loaded) { await admgrTestFetch(); if (!t.loaded) return; }
  const days = admgrReportOpen('test', '주간 리포트 (테스트 소재)');
  t.thumbs = t.thumbs || {};
  $('rp-body').innerHTML = '<div class="empty-state"><p>등록 기록·상품 가격·AI 해석을 모으는 중…</p></div>';
  if (!admgr.demo) {
    if (!t.creatives) await admgrTestCreativesEnsure();
    if (!admgr.products && !admgr.productsLoading) await admgrLoadProducts();
    try { const r = await sbCall('client-log', { action: 'state_get', key: 'test_report_ai' }); t.ai = r && r.data ? r.data : null; } catch (e) { t.ai = null; }
    try { const r = await sbCall('client-log', { action: 'state_get', key: 'test_todo' }); t.todoSaved = r && r.data && Array.isArray(r.data.items) ? r.data.items : []; } catch (e) { t.todoSaved = []; }
    try { const r = await sbCall('client-log', { action: 'state_get', key: 'video_tags' }); t.vtags = r && r.data && r.data.tags ? r.data.tags : null; } catch (e) { t.vtags = null; }
  }
  const withTodo = r => { r.todoSaved = t.todoSaved || []; const S = admgrReportSummary(r); r.todo = { items: S.todo, prev: S.prev }; return r; };   // 저장본과 합친 할 일을 rep에 고정 (체크 토글이 이 객체를 바꾼다)
  let rep = withTodo(admgrReportBuild(admgrTestRowSets().vis, days, todayStr(0), { ai: t.ai, vtags: t.vtags }));
  t.report = rep;
  admgrRp.cur = { title: `테스트 소재 리포트 ${rep.from}~${rep.to}`, text: () => admgrReportText(rep), textSummary: () => admgrReportText(rep, 'summary'), html: () => admgrReportHtml(rep, t.thumbs) };
  $('rp-body').innerHTML = admgrReportHtml(rep, t.thumbs);
  const need = admgr.demo ? [] : [...new Set(rep.all.filter(a => !(a.id in t.thumbs)).map(a => a.adset_id))];
  try {
    for (let i = 0; i < need.length; i += 100) {
      const r = await metaGet({ action: 'creatives', set_ids: need.slice(i, i + 100).join(',') });
      (r.ads || []).forEach(a => { t.thumbs[a.id] = a.image || a.thumb || ''; t.kinds = t.kinds || new Map(); t.kinds.set(String(a.id), !!a.is_video); });
    }
    rep.all.forEach(a => { if (!(a.id in t.thumbs)) t.thumbs[a.id] = ''; });   // 못 찾은 소재는 재조회 안 함
    if (need.length && t.report === rep) { rep = withTodo(admgrReportBuild(admgrTestRowSets().vis, days, todayStr(0), { ai: t.ai, vtags: t.vtags })); t.report = rep; admgrRp.cur.text = () => admgrReportText(rep); admgrRp.cur.textSummary = () => admgrReportText(rep, 'summary'); admgrRp.cur.html = () => admgrReportHtml(rep, t.thumbs); $('rp-body').innerHTML = admgrReportHtml(rep, t.thumbs); }   // 형식(릴스/이미지) 폴백이 채워졌으니 다시 계산
  } catch (e) { toast('썸네일 조회 실패 (텍스트는 정상): ' + e.message); }
  admgrTodoSave(rep);   // 이번 리포트의 할 일을 저장본에 합쳐 둔다 (addedAt 기록 → 다음 주 '지난주 할 일' 집계)
  // 숫자 리포트 + OFF·우수 소재 목록(썸네일 주소)을 계정 공유 상태에 저장 → 바탕화면 '테스트리포트-해석'이 읽어 AI 태그·해석을 붙인다
  if (admgr.demo) return;
  try {
    const ads = [...rep.cmp.off.items.map(x => ({ ...x, g: 'off' })), ...rep.cmp.good.items.map(x => ({ ...x, g: 'good' }))]
      .map(x => ({ id: x.a.id, name: x.a.adset_name, group: x.g, thumb: t.thumbs[x.a.id] || '', fmt: x.f.fmt, tag: x.f.tag, diag: x.f.diag.label, roas: +x.f.roas.toFixed(2), purchases: x.a.purchases || 0, spend: Math.round(x.a.spend || 0), ctr: x.f.ctr, ts: x.f.ts }));
    const cur = await sbCall('client-log', { action: 'state_get', key: 'test_report' });
    await sbCall('client-log', { action: 'state_set' }, { key: 'test_report', base: cur.ver || null, data: { from: rep.from, to: rep.to, days, at: new Date().toISOString(), text: admgrReportText({ ...rep, ai: null }), ads } });
  } catch (e) { /* 저장 실패해도 화면 리포트는 정상 */ }
}
function admgrReportOpen(kind, title) {   // 모달 열고 기간 읽기 — 두 리포트 공용
  admgrReportModal().classList.add('show');
  admgrRp.kind = kind; $('rp-title').textContent = title; $('rp-copy-sum').style.display = '';
  const sel = $('rp-days');
  if (!sel.dataset.init) { sel.value = String(lsGet('adc_admgr_rpdays', 7)); sel.dataset.init = '1'; }
  const days = +sel.value || 7; lsSet('adc_admgr_rpdays', days);
  return days;
}
async function admgrReportCopy(mode) {
  const c = admgrRp.cur; if (!c) return;
  const txt = mode === 'summary' && c.textSummary ? c.textSummary() : c.text();
  try { await navigator.clipboard.writeText(txt); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast(mode === 'summary' ? '요약을 복사했어요 — 플로우에 붙여넣기' : '리포트 전체를 복사했어요');
}
function admgrReportPrint() {
  /* 팝업 창 대신 숨은 iframe에 그려서 인쇄 — 팝업 차단·앱 내 브라우저에서도 동작. 인쇄 대화상자에서 'PDF로 저장' */
  const c = admgrRp.cur; if (!c) return;
  const old = $('rp-print'); if (old) old.remove();
  const f = document.createElement('iframe'); f.id = 'rp-print';
  f.style.cssText = 'position:fixed;left:-9999px;width:800px;height:600px;border:0;';
  f.srcdoc = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(c.title)}</title>
    <style>body{font-family:-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;margin:24px;color:#111827;max-width:800px;}img{max-width:100%;}</style></head>
    <body>${c.html().replace(/<details /g, '<details open ')}
    <script>Promise.all([...document.images].map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r}))).then(()=>setTimeout(()=>{focus();print();},300));</script></body></html>`;
  document.body.appendChild(f);
  toast('인쇄 창이 열려요 — 대상에서 "PDF로 저장"을 고르세요');
}
/* ═══ 베스트 소재 주간 리포트 — MD팀·컨텐츠팀 회의용 (2026-09-12) ═══
   숫자는 여기서 계산(브라우저), 해석은 scripts/weekly-insight.mjs(이 맥의 Claude Code)가 붙인다.
   기간 성과 = 지금 누적 − 기간 시작일 스냅샷(test_ad_day, 서버가 매일 1행). 스냅샷이 없는 옛 소재는 누적으로 대신하고 approx 표시.
   ponytail: 컷 유형(시연/착용)은 회의 뒤 태그 추가 예정 — 지금은 소구점·릴스/이미지·가격대·문구 훅만 */
const ADMGR_BR_VERDICT = { expand: ['확장', '#16a34a', '재입고·유사 상품 소싱 + 추가 소재'], more: ['소재 추가 테스트', '#2563eb', '베스트 1개 — 같은 소구점으로 소재를 더'], replace: ['교체 검토', '#dc2626', '베스트였지만 식음 — 새 소구점으로 재시도 또는 정리'] };
function admgrBestReportBuild(inp, days, today) {
  const { tests = [], best = [], bestAds = [], dayRows = [], cre = new Map(), products = [], judge = ADMGR_TJUDGE_DEFAULT } = inp;
  const shift = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const from = shift(today, -(days - 1)), prevFrom = shift(from, -days);
  const inWin = iso => { const d = String(iso || '').slice(0, 10); return !!d && d >= from && d <= today; };
  const byAd = new Map();
  dayRows.slice().sort((x, y) => String(x.day).localeCompare(String(y.day))).forEach(r => (byAd.get(r.ad_id) || byAd.set(r.ad_id, []).get(r.ad_id)).push(r));
  const baseAt = (id, day) => { const L = byAd.get(id) || []; let b = null; for (const r of L) if (r.day <= day) b = r; return b; };
  const M = (s, p, v) => ({ spend: +s || 0, purchases: +p || 0, value: +v || 0 });
  const sub = (a, b) => M(a.spend - b.spend, a.purchases - b.purchases, a.value - b.value);
  let approx = 0;
  const period = a => {   // { cur, prev } — cur: 이번 기간, prev: 이전 기간(모르면 null)
    const cum = M(a.spend, a.purchases, a.value), b1 = baseAt(a.id, from), b0 = baseAt(a.id, prevFrom);
    let cur, prev;
    if (b1) { cur = sub(cum, b1); prev = b0 ? sub(b1, b0) : (a.reg_date >= prevFrom ? M(b1.spend, b1.purchases, b1.value) : null); }
    else if (a.reg_date && a.reg_date >= from) { cur = cum; prev = M(0, 0, 0); }
    else { cur = cum; prev = null; approx++; }
    return { cur, prev };
  };
  const roas = m => m && m.spend > 0 ? m.value / m.spend : 0;
  const sum = list => list.reduce((o, m) => m ? M(o.spend + m.spend, o.purchases + m.purchases, o.value + m.value) : o, M(0, 0, 0));
  const testById = new Map(tests.map(a => [a.id, a]));
  const T = tests.map(a => ({ ...a, p: period(a), prod: admgrProductOf(a), c: cre.get(String(a.id)) }));
  // 베스트 소재: creatives 응답(bestAds) + 테스트 데이터로 성과 연결. 테스트 세트가 아닌 베스트는 성과 없이 이름만
  const setNm = new Map(best.map(r => [String(r.adset_id), r.adset_name || '']));
  const B = bestAds.map(a => { const t = T.find(x => x.id === a.id); const nm = setNm.get(String(a.adset_id)) || a.name; return { id: a.id, adset_id: a.adset_id, name: nm, prod: admgrProductOf({ adset_name: nm }), active: a.effective_status === 'ACTIVE', video: !!a.is_video, t, c: cre.get(String(a.id)) }; });
  const Bm = B.filter(a => a.t);
  const S = {
    best: { n: B.length, active: B.filter(a => a.active).length, cur: sum(Bm.map(a => a.t.p.cur)), prev: dayRows.length ? sum(Bm.map(a => a.t.p.prev)) : null },   // 스냅샷이 하나도 없으면 전주 대비 없음
    test: { n: T.filter(a => !a.gone).length, cur: sum(T.map(a => a.p.cur)), prev: dayRows.length ? sum(T.map(a => a.p.prev)) : null },
  };
  const newBest = best.filter(r => inWin(r.created_at)).map(r => r.adset_name || r.adset_id);
  const offBest = B.filter(a => !a.active).map(a => a.name);
  const top = Bm.filter(a => a.t.p.cur.spend > 0).sort((x, y) => roas(y.t.p.cur) - roas(x.t.p.cur) || y.t.p.cur.spend - x.t.p.cur.spend).slice(0, 3).map(a => ({ name: a.name, m: a.t.p.cur }));
  const cooled = Bm.filter(a => a.active && a.t.p.cur.spend >= judge.spend && roas(a.t.p.cur) < judge.offRoas).map(a => ({ name: a.name, m: a.t.p.cur }));
  // 패턴: 릴스/이미지 · 소구점 · 가격대 — 베스트 소재의 이번 기간 성과로
  const bucket = (list, keyOf) => { const m = new Map(); list.forEach(a => { const k = keyOf(a); (m.get(k) || m.set(k, []).get(k)).push(a); });
    return [...m.entries()].map(([k, L]) => ({ k, n: L.length, m: sum(L.map(a => a.t.p.cur)) })).sort((x, y) => roas(y.m) - roas(x.m)); };
  const fmt = bucket(Bm, a => a.video ? '릴스' : '이미지');
  const tags = bucket(Bm, a => (a.c && admgrTagOf(a.c.file_name)) || '미기입');
  const pidx = products.map(p => ({ ...p, n: admgrProdKey(p.name) })).filter(p => p.n.length >= 3).sort((a, b) => b.n.length - a.n.length);
  const priceOf = nm => { const n = admgrNorm(nm); const p = pidx.find(p => n.includes(p.n)); return p ? p.price : 0; };
  const band = pr => !pr ? '가격 미상' : pr < 30000 ? '3만 미만' : pr < 50000 ? '3~5만' : pr < 80000 ? '5~8만' : '8만 이상';
  const price = pidx.length ? bucket(Bm, a => band(priceOf(a.name))) : [];
  // 문구 훅 검사 — 사이즈 숫자·체형커버 단어 (2026-09-11 베스트 공식 중 문구로 확인 가능한 부분)
  const HOOK = /\b(44|55|66|77|88)\b|사이즈|kg|\d{2,3}\s?cm|뱃살|팔뚝|허벅지|골반|체형|커버|날씬|슬림|가려|숨겨/;
  const withText = B.filter(a => a.c && a.c.text && a.c.text.message);
  const formula = { n: withText.length, hit: withText.filter(a => HOOK.test(String(a.c.text.message).normalize('NFC'))).length };
  // 상품 판단 — 베스트가 있는 상품만
  const prodMap = new Map();
  B.forEach(a => { const g = prodMap.get(a.prod) || prodMap.set(a.prod, { name: a.prod, best: 0, active: 0, tests: 0, good: 0, ms: [] }).get(a.prod); g.best++; if (a.active) g.active++; if (a.t) g.ms.push(a.t.p.cur); });
  T.forEach(a => { const g = prodMap.get(a.prod); if (!g) return; if (inWin(a.reg_date)) g.tests++; if (a.meta.verdict === 'good') g.good++; });
  const prods = [...prodMap.values()].map(g => {
    const m = sum(g.ms), r = roas(m);
    const cold = g.active === 0 || (m.spend >= judge.spend && r < judge.offRoas);
    const v = cold ? 'replace' : g.best >= 2 ? 'expand' : 'more';
    return { ...g, m, roas: r, v, label: ADMGR_BR_VERDICT[v][0], why: g.active === 0 ? '베스트 전부 꺼짐' : cold ? `이번 기간 ROAS ${r.toFixed(1)} (기준 ${judge.offRoas} 미만)` : g.best >= 2 ? `베스트 ${g.best}개 (켜짐 ${g.active})` : '베스트 1개' };
  }).sort((x, y) => ['expand', 'more', 'replace'].indexOf(x.v) - ['expand', 'more', 'replace'].indexOf(y.v) || y.m.spend - x.m.spend);
  // 테스트 효율 — 기간 안 등록·판정. 등록자별은 대시보드로 올린 소재(creatives)만 알 수 있다
  const vAt = a => a.meta.verdict_at || a.meta.updated_at;
  const reg = T.filter(a => inWin(a.reg_date));
  const good = T.filter(a => a.meta.verdict === 'good' && inWin(vAt(a))).length, meh = T.filter(a => a.meta.verdict === 'meh' && inWin(vAt(a))).length;   // 판정 뒤 꺼져도 판정은 판정 (st 아닌 verdict)
  const off = reg.filter(a => ['off', 'ended', 'rejected'].includes(a.st)).length;
  const who = new Map();
  reg.forEach(a => { if (!a.c) return; const k = whoName(a.c.created_by_name, a.c.created_by_email) || '?'; const w = who.get(k) || who.set(k, { who: k, n: 0, good: 0 }).get(k); w.n++; if (a.meta.verdict === 'good') w.good++; });
  const eff = { reg: reg.length, good, meh, off, rate: good + meh + off ? good / (good + meh + off) : null, by: [...who.values()].sort((x, y) => y.good - x.good || y.n - x.n) };
  // 다음 주 액션 — 규칙으로. 해석·우선순위는 AI 해석(scripts/weekly-insight.mjs)에서
  const names = v => prods.filter(p => p.v === v).map(p => p.name);
  const bestTag = tags.find(t => t.k !== '미기입' && t.m.spend > 0), bestFmt = fmt.length > 1 ? fmt[0] : null;
  const md = [], ct = [];
  if (names('expand').length) md.push(`재입고·유사 상품 소싱 검토: ${names('expand').join(', ')}`);
  if (names('replace').length) md.push(`판매 추이 확인 후 정리 여부 결정: ${names('replace').join(', ')}`);
  if (newBest.length) md.push(`이번 기간 새 베스트 상품 재고 확인: ${[...new Set(newBest.map(n => admgrProductOf({ adset_name: n })))].join(', ')}`);
  if (bestTag) ct.push(`소구점 '${bestTag.k}' 반복 (ROAS ${roas(bestTag.m).toFixed(1)}) — 다른 상품에도 같은 훅으로`);
  if (bestFmt) ct.push(`${bestFmt.k} 비중 유지 (ROAS ${roas(bestFmt.m).toFixed(1)} vs ${fmt[1].k} ${roas(fmt[1].m).toFixed(1)})`);
  if (names('more').length) ct.push(`추가 소재 촬영: ${names('more').join(', ')}`);
  if (names('replace').length) ct.push(`새 소구점으로 재시도: ${names('replace').join(', ')}`);
  if (formula.n) ct.push(`사이즈·체형커버 훅 문구 비율 ${formula.hit}/${formula.n} — ${formula.hit < formula.n ? '나머지 소재 문구에도 훅 넣기' : '전 소재 적용 중, 유지'}`);
  // ═══ 2026-09-17 재구성: 순이익·추세·AI 태그를 소재마다 붙이고, 결론 3줄·할 일·TOP5·경보를 만든다 ═══
  const pfFn = inp.pf || null, trendFn = inp.trend || null, aiTags = inp.aiTags || null, thumbOf = inp.thumbs || {};
  B.forEach(a => {
    a.pf = pfFn && a.t ? pfFn(a.name, a.t.p.cur) : null;
    a.pfPrev = pfFn && a.t && a.t.p.prev ? pfFn(a.name, a.t.p.prev) : null;
    a.tr = trendFn && a.t ? trendFn(a.t) : null;
    a.tag = aiTags && aiTags[a.id] ? aiTags[a.id] : null;
    a.roasCur = a.t ? roas(a.t.p.cur) : 0;
    a.thumb = thumbOf[a.id] || '';
  });
  const withPf = B.filter(a => a.pf);
  const profit = { n: withPf.length, cur: withPf.reduce((s0, a) => s0 + a.pf.net, 0), prev: dayRows.length && withPf.some(a => a.pfPrev) ? withPf.reduce((s0, a) => s0 + (a.pfPrev ? a.pfPrev.net : 0), 0) : null };
  const top5 = B.filter(a => a.t).sort((x, y) => ((y.pf ? y.pf.net : -Infinity) - (x.pf ? x.pf.net : -Infinity)) || y.roasCur - x.roasCur).slice(0, 5)
    .map(a => ({ id: a.id, name: a.name, prod: a.prod, net: a.pf ? a.pf.net : null, grade: a.pf ? a.pf.grade : null, roas: a.roasCur, m: a.t.p.cur, tr: a.tr, tag: a.tag, active: a.active, thumb: a.thumb }));
  const tired = B.filter(a => a.tr && a.tr.tired);
  const alerts = { tired: tired.map(a => ({ name: a.name, prod: a.prod, recent: a.tr.recentRoas, cum: a.tr.cumRoas })), off: offBest, gradeC: B.filter(a => a.pf && a.pf.grade === 'C').map(a => ({ name: a.name, net: a.pf.net })) };
  const tagged = B.filter(a => a.tag);
  const check = { tagN: tagged.length, cmp: tagged.filter(a => a.tag.cut === '비교').length, size: tagged.filter(a => a.tag.size).length, hookN: formula.n, hook: formula.hit };
  // 상품 판단 — 순이익 기준으로 다시: 교체 검토 = 전부 꺼짐 · 기간 순이익 마이너스(지출 기준 이상) · (순이익 모르면) ROAS 손해
  prods.forEach(p => {
    const L = B.filter(a => a.prod === p.name);
    p.net = L.reduce((s0, a) => s0 + (a.pf ? a.pf.net : 0), 0); p.hasPf = L.some(a => a.pf); p.tired = L.filter(a => a.tr && a.tr.tired).length;
    p.grades = [...new Set(L.filter(a => a.pf && a.pf.grade).map(a => a.pf.grade))].sort().join('·');
    const cold = p.active === 0 || (p.hasPf ? p.net < 0 && p.m.spend >= judge.spend : p.m.spend >= judge.spend && p.roas < judge.offRoas);
    p.v = cold ? 'replace' : (p.best >= 2 && p.active >= 1) ? 'expand' : 'more'; p.label = ADMGR_BR_VERDICT[p.v][0];
    p.why = p.active === 0 ? '베스트 전부 꺼짐' : cold ? (p.hasPf ? `이번 기간 순이익 ${won(Math.round(p.net))}` : `ROAS ${p.roas.toFixed(1)} < ${judge.offRoas}`) : `베스트 ${p.best}개 (켜짐 ${p.active})${p.grades ? ' · 등급 ' + p.grades : ''}${p.tired ? ` · 식음 ${p.tired}` : ''}`;
  });
  prods.sort((x, y) => ['expand', 'more', 'replace'].indexOf(x.v) - ['expand', 'more', 'replace'].indexOf(y.v) || (y.hasPf ? y.net : y.m.spend) - (x.hasPf ? x.net : x.m.spend));
  // 이번 주 할 일 — MD팀(상품)·컨텐츠팀(베스트 변형만). 전체 제작 요청은 테스트 리포트에
  const todoRule = [];
  prods.forEach(p => {
    const money = p.hasPf ? '순이익 ' + won(Math.round(p.net)) : 'ROAS ' + p.roas.toFixed(1);
    if (p.v === 'expand') todoRule.push({ name: p.name, kind: 'md', text: '재고 확인, 유사 상품 소싱 후보 검토', why: `확장 · ${money}` });
    else if (p.v === 'replace') todoRule.push({ name: p.name, kind: 'md', text: '판매 추이·상세페이지 점검 후 정리 여부 결정', why: `교체 검토 · ${p.why}` });
    else todoRule.push({ name: p.name, kind: 'md', text: '재고 확인만 — 추가 발주는 다음 주 숫자 뒤', why: `소재 추가 테스트 · ${money}` });
  });
  prods.filter(p => p.v !== 'replace').forEach(p => {
    const L = B.filter(a => a.prod === p.name), hasCmp = L.some(a => a.tag && a.tag.cut === '비교'), hasSize = L.some(a => a.tag && a.tag.size), tiredHere = L.some(a => a.tr && a.tr.tired);
    todoRule.push({ name: p.name, kind: 'ct', text: tiredHere ? '식은 소재 교체용 새 소재 1개 (첫 장면 바꿔서)' : hasCmp ? `비교 컷 변형 1개${hasSize ? '' : ' (자막에 사이즈 숫자)'}` : '비교 컷 1개 새로 (키·사이즈별 나란히)', why: tiredHere ? '식음' : hasCmp ? '비교 컷 통함' : '우수 공식 적용' });
  });
  // 결론 3줄 (규칙) — AI 해석이 있으면 화면에서 AI 문장이 우선
  const heroP = prods[0], secondP = prods[1];   // prods는 확장 → 소재 추가 → 교체 순, 같은 급에선 순이익(없으면 지출) 큰 순 — 교체 검토 상품이 주인공이 되지 않게
  const hero = heroP ? `${heroP.name} — 소재 ${heroP.best}개로 ${heroP.hasPf ? '순이익 ' + won(Math.round(heroP.net)) : '지출 ' + won(Math.round(heroP.m.spend))}, ROAS ${heroP.roas.toFixed(1)}${secondP ? `. ${secondP.name}이(가) 뒤를 받침` : ''}` : '베스트 소재가 없어요 — 광고세트 탭에서 담아 주세요';
  const whyParts = [tagged.length ? `비교 컷 ${check.cmp}/${check.tagN}, 사이즈 숫자 ${check.size}/${check.tagN}` : '', price[0] && price[0].k !== '가격 미상' ? `${price[0].k} 가격대` : '', fmt[0] ? `${fmt[0].k} ${fmt[0].n}개` : ''].filter(Boolean);
  const whyLine = whyParts.length ? whyParts.join(' · ') : '근거가 아직 부족해요 — 소구점·AI 태그가 쌓이면 채워져요';
  const nv = v => prods.filter(p => p.v === v).length;
  const nextLine = prods.length ? `확장 ${nv('expand')}개 상품 소싱·재입고, 소재 추가 ${nv('more')}개 재고 확인${tired.length ? `, 식은 소재 ${tired.length}개 교체 준비` : ''}${nv('replace') ? `, ${nv('replace')}개 정리 검토` : ''} — 아래 목록대로` : '베스트를 담으면 방향이 나와요';
  return { from, to: today, days, prevFrom, approx, S, newBest, offBest, top, cooled, fmt, tags, price, formula, prods, eff, actions: { md, ct }, profit, top5, alerts, check, todoRule, lines: { hero, why: whyLine, next: nextLine } };
}
/* ═══ 베스트 리포트 화면 (2026-09-17 시안 승인) — 결론 한 장 + TOP5 카드 + 경보, 나머지는 접기 ═══ */
function admgrBestSummary(rep, ai) {
  const first = (t, fb) => admgrAiBlock(ai, t)[0] || fb;
  const merged = rep.todo || admgrTodoMerge(rep.todoRule || [], rep.todoSaved || [], rep.to);
  return { hero: first('이번 주 한 줄 평', rep.lines.hero), why: first('왜 터졌나', rep.lines.why), next: rep.lines.next, todo: merged.items, prev: merged.prev };
}
const admgrPct = (a, b) => b ? `${a >= b ? '+' : ''}${Math.round((a - b) / Math.abs(b) * 100)}%` : '';
function admgrBestReportText(rep, ai, mode) {
  const S = admgrBestSummary(rep, ai), R = m => m && m.spend > 0 ? (m.value / m.spend).toFixed(1) : '—';
  const pc = rep.S.best.cur, pp = rep.S.best.prev, pf = rep.profit;
  const L = [`📊 베스트 소재 리포트 · ${fmtMD(rep.from)}~${fmtMD(rep.to)} (${rep.days}일)`,
    `베스트 ${rep.S.best.n}개${rep.newBest.length ? ` (+${rep.newBest.length} 새로 담김)` : ''} · 기간 순이익 ${pf.n ? (pf.cur >= 0 ? '+' : '') + won(Math.round(pf.cur)) + (pf.prev != null ? ` (${admgrPct(pf.cur, pf.prev) || '—'})` : '') : '— (반품률 불러오면 계산)'} · 기간 ROAS ${R(pc)}${pp ? ` (지난 기간 ${R(pp)})` : ''}`, '',
    `■ 결론`, ` · 주인공: ${S.hero}`, ` · 왜 터졌나: ${S.why}`, ` · 다음 주: ${S.next}`, '',
    `■ 이번 주 할 일${S.prev.n ? ` (지난주 ${S.prev.n}개 중 완료 ${S.prev.done})` : ''}`];
  const grp = (k, label) => { const D = S.todo.filter(t => t.kind === k); if (!D.length) return; L.push(` [${label}]`); D.forEach(t => L.push(`  ${t.done ? '☑' : '☐'} ${t.name} — ${t.text}${t.why ? ` (${t.why})` : ''}${t.carried ? ' · 지난주부터' : ''}`)); };
  grp('md', 'MD팀'); grp('ct', '컨텐츠팀 — 베스트 변형');
  if (!S.todo.length) L.push('  없음');
  if (mode === 'summary') return L.join('\n').trim();
  L.push('', `■ 베스트 TOP ${rep.top5.length} (순이익순)`);
  rep.top5.forEach((a, i) => L.push(` ${i + 1}. ${a.name} — ${a.net != null ? '순이익 ' + (a.net >= 0 ? '+' : '') + won(Math.round(a.net)) + ' · 등급 ' + (a.grade || '—') + ' · ' : ''}ROAS ${a.roas.toFixed(1)}${a.tr && a.tr.days >= 3 && a.tr.recent ? ` · 7일 ${a.tr.recentRoas.toFixed(1)}` : ''}${a.tr && a.tr.tired ? ' · 식음' : ''}${a.tag ? ` · ${a.tag.cut}${a.tag.text ? '·자막' : ''}${a.tag.size ? '·사이즈숫자' : ''}` : ''}`));
  L.push('', `■ 경보`, ` · 식은 소재 ${rep.alerts.tired.length}: ${rep.alerts.tired.map(x => `${x.name} (7일 ${x.recent.toFixed(1)} / 누적 ${x.cum.toFixed(1)})`).join(' / ') || '없음'}`, ` · 꺼진 베스트 ${rep.alerts.off.length}: ${rep.alerts.off.join(' / ') || '없음'}`, ` · 순이익 C 등급 ${rep.alerts.gradeC.length}: ${rep.alerts.gradeC.map(x => x.name).join(' / ') || '없음'}`);
  const line = m => `지출 ${won(Math.round(m.spend))} · 구매 ${comma(m.purchases)} · ROAS ${R(m)}`;
  const bk = (title, list) => { L.push(` · ${title}: ${list.map(b => `${b.k} ${b.n}개(ROAS ${R(b.m)})`).join(' · ') || '—'}`); };
  L.push('', `■ 왜 그런가 (누적 기준)`, ` · 공식 점검: ${rep.check.tagN ? `비교 컷 ${rep.check.cmp}/${rep.check.tagN} · 사이즈 숫자 ${rep.check.size}/${rep.check.tagN}` : 'AI 태그 없음'}${rep.check.hookN ? ` · 체형커버 훅 문구 ${rep.check.hook}/${rep.check.hookN}` : ''}`);
  bk('형식', rep.fmt); bk('소구점', rep.tags); if (rep.price.length) bk('가격대', rep.price);
  L.push('', `■ 상품 판단 (순이익 기준)`); if (!rep.prods.length) L.push('  베스트 상품 없음');
  rep.prods.forEach(p => L.push(` · [${p.label}] ${p.name} — 베스트 ${p.best}(켜짐 ${p.active}) · ${p.hasPf ? '순이익 ' + (p.net >= 0 ? '+' : '') + won(Math.round(p.net)) + ' · ' : ''}${line(p.m)} · ${p.why}`));
  const e = rep.eff;
  L.push('', `■ 테스트 효율`, ` · 새 테스트 ${e.reg}개 · 우수 ${e.good} · 애매 ${e.meh} · 종료 ${e.off}${e.rate != null ? ` · 우수율 ${Math.round(e.rate * 100)}%` : ''}`);
  if (rep.approx) L.push('', `※ 스냅샷 없는 옛 소재 ${rep.approx}개는 누적으로 계산`);
  if (ai && ai.text) L.push('', `■ AI 해석 원문 (${fmtMD(String(ai.at || '').slice(0, 10))} 생성)`, ai.text.trim());
  return L.join('\n').trim();
}
function admgrBestReportHtml(rep, ai) {
  const S = admgrBestSummary(rep, ai), R = m => m && m.spend > 0 ? (m.value / m.spend).toFixed(1) : '—';
  const pc = rep.S.best.cur, pp = rep.S.best.prev, pf = rep.profit;
  const kpi = (label, val, sub) => `<div style="background:#f8fafc;border:1px solid #e7e8ee;border-radius:12px;padding:10px 14px;"><div style="font-size:.7rem;color:#6b7280;">${label}</div><b style="font-size:1.2rem;color:#1e1b4b;">${val}</b>${sub ? `<span style="font-size:.72rem;margin-left:6px;font-weight:700;">${sub}</span>` : ''}</div>`;
  const delta = (a, b, fmtV) => b == null ? '' : `<span style="color:${a >= b ? '#16a34a' : '#dc2626'};">${a >= b ? '▲' : '▼'} ${fmtV(Math.abs(a - b))}</span>`;
  const h3 = (t, n) => `<div style="display:flex;align-items:center;gap:8px;margin:18px 0 8px;font-size:.92rem;font-weight:800;color:#111827;">${t}${n ? `<span style="font-size:.72rem;color:#6b7280;font-weight:600;">${n}</span>` : ''}</div>`;
  const det = (title, n, body, open) => `<details ${open ? 'open' : ''} style="border:1px solid #e7e8ee;border-radius:12px;margin-top:8px;background:#fff;"><summary style="cursor:pointer;padding:9px 14px;font-size:.84rem;font-weight:700;color:#374151;display:flex;align-items:center;gap:8px;list-style:none;"><span class="rp-arrow" style="color:#9ca3af;display:inline-block;transition:transform .15s;">▸</span>${esc(title)}${n ? `<span style="color:#6b7280;font-weight:600;font-size:.74rem;">${n}</span>` : ''}</summary><div style="padding:0 14px 12px;font-size:.8rem;color:#4b5563;line-height:1.7;">${body}</div></details>`;
  const head = `<div style="font-size:1.02rem;font-weight:800;color:#1e1b4b;">베스트 소재 리포트 <span style="font-weight:600;color:#6b7280;font-size:.82rem;margin-left:4px;">${fmtMD(rep.from)} ~ ${fmtMD(rep.to)} (${rep.days}일) · 패턴 근거는 누적${ai && ai.text ? ` · AI 해석 ${fmtMD(String(ai.at || '').slice(0, 10))}` : ''}</span></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0;">
      ${kpi('베스트 소재', rep.S.best.n, rep.newBest.length ? `<span style="color:#16a34a;">+${rep.newBest.length} 새로 담김</span>` : `<span style="color:#6b7280;font-weight:600;">켜짐 ${rep.S.best.active}</span>`)}
      ${kpi('이번 기간 순이익', pf.n ? `<span style="color:${pf.cur >= 0 ? '#15803d' : '#dc2626'};">${pf.cur >= 0 ? '+' : ''}${won(Math.round(pf.cur))}</span>` : '<span style="font-size:.8rem;color:#9ca3af;">— 반품률 불러오는 중</span>', pf.n && pf.prev != null ? delta(pf.cur, pf.prev, v => admgrPct(pf.cur, pf.prev)) : (pf.n ? '<span style="color:#9ca3af;font-weight:600;">전주 비교는 다음 주부터</span>' : ''))}
      ${kpi('기간 ROAS', R(pc), pp ? delta(+R(pc), +R(pp), v => v.toFixed(1)) + `<span style="color:#9ca3af;font-weight:600;"> (지난 기간 ${R(pp)})</span>` : '<span style="color:#9ca3af;font-weight:600;">전주 비교는 다음 주부터</span>')}</div>
    <div style="border-left:4px solid #4f46e5;padding:2px 0 2px 12px;margin:10px 0 4px;font-size:.9rem;line-height:1.6;">
      <div style="padding:3px 0;"><b style="color:#1e1b4b;font-size:.76rem;margin-right:6px;">주인공</b>${esc(S.hero)}</div>
      <div style="padding:3px 0;"><b style="color:#1e1b4b;font-size:.76rem;margin-right:6px;">왜 터졌나</b>${esc(S.why)}</div>
      <div style="padding:3px 0;"><b style="color:#1e1b4b;font-size:.76rem;margin-right:6px;">다음 주</b>${esc(S.next)}</div></div>`;
  const nMd = S.todo.filter(t => t.kind === 'md').length, nCt = S.todo.length - nMd, doneN = S.todo.filter(t => t.done).length;
  const row = t => `<label style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-bottom:1px dashed #e9d5ff;font-size:.86rem;cursor:pointer;${t.done ? 'opacity:.55;' : ''}"><input type="checkbox" ${t.done ? 'checked' : ''} onchange="admgrTodoToggle('${esc(t.key)}')" style="margin:3px 0 0;flex:none;accent-color:#7c3aed;" /><span style="${t.done ? 'text-decoration:line-through;' : ''}"><b style="color:#1e1b4b;">${esc(t.name)}</b> — ${esc(t.text)}${t.carried ? ' <span class="status-badge badge-yellow" style="font-size:.6rem;">지난주부터</span>' : ''}${t.done && t.doneBy ? ` <span style="font-size:.66rem;color:#6b7280;">✓ ${esc(t.doneBy)} ${fmtMD(String(t.doneAt || '').slice(0, 10))}</span>` : ''}</span>${t.why ? `<span style="color:#6b7280;font-size:.72rem;margin-left:auto;white-space:nowrap;" class="m-hide">${esc(t.why)}</span>` : ''}</label>`;
  const grp = (k, label, color) => { const D = S.todo.filter(t => t.kind === k); return D.length ? `<div style="font-size:.72rem;font-weight:800;color:${color};padding:8px 0 2px;">${label}</div>${D.map(row).join('')}` : ''; };
  const todo = h3('이번 주 할 일', `MD팀 ${nMd} · 컨텐츠팀 ${nCt}${doneN ? ` · 완료 ${doneN}` : ''}${S.prev.n ? ` · <span style="color:#7c3aed;">지난주 ${S.prev.n}개 중 완료 ${S.prev.done}</span>` : ''}`) + `<div style="border:1px solid #ddd6fe;background:#faf5ff;border-radius:12px;padding:2px 12px 6px;">${grp('md', 'MD팀', '#b45309')}${grp('ct', '컨텐츠팀 (베스트 변형)', '#4f46e5')}${S.todo.length ? '' : '<div style="padding:8px 0;color:#9ca3af;font-size:.82rem;">없음</div>'}</div>
    <div style="font-size:.7rem;color:#6b7280;margin-top:6px;">체크는 모든 계정에 공유 · 컨텐츠팀 제작 요청 전체는 테스트 소재 리포트에, 여기는 베스트 변형만 · "요약 복사"는 결론 3줄 + 이 목록</div>`;
  const GC = { S: '#16a34a', A: '#2563eb', B: '#d97706', C: '#dc2626' };
  const card = (a, i) => `<div style="border:1px solid #e7e8ee;border-radius:12px;overflow:hidden;background:#fff;">
      <div style="height:150px;background:#f3f4f6;position:relative;cursor:zoom-in;" onclick="showMetaPreview('${a.id}')">${a.thumb ? `<img src="${esc(a.thumb)}" style="width:100%;height:100%;object-fit:cover;display:block;" />` : ''}<span style="position:absolute;top:6px;left:6px;font-size:.62rem;font-weight:800;background:#111827cc;color:#fff;border-radius:999px;padding:2px 7px;">#${i + 1}</span>${a.grade ? `<span style="position:absolute;bottom:6px;right:6px;font-size:.7rem;font-weight:800;color:#fff;background:${GC[a.grade]};border-radius:6px;padding:1px 6px;">${a.grade}</span>` : ''}${!a.active ? '<span style="position:absolute;top:6px;right:6px;font-size:.6rem;font-weight:700;background:#fee2e2;color:#991b1b;border-radius:999px;padding:1px 6px;">꺼짐</span>' : ''}</div>
      <div style="padding:6px 8px 0;font-size:.72rem;font-weight:700;color:#1e1b4b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(a.name)}">${esc(a.name)}</div>
      <div style="padding:2px 8px;font-size:.66rem;color:#6b7280;">${a.net != null ? `순이익 <b style="color:${a.net >= 0 ? '#15803d' : '#dc2626'};">${a.net >= 0 ? '+' : ''}${won(Math.round(a.net))}</b> · ` : ''}ROAS ${a.roas.toFixed(1)}</div>
      <div style="padding:2px 8px;font-size:.66rem;color:#6b7280;">${a.tr ? admgrSparkHtml(a.tr, null) : '<span style="color:#c4c9d4;">추세 없음</span>'}</div>
      <div style="padding:2px 8px 8px;">${a.tag ? [a.tag.cut, a.tag.text ? '자막' : '', a.tag.size ? '사이즈 숫자' : ''].filter(Boolean).map(t => `<span style="display:inline-block;font-size:.6rem;padding:1px 6px;border-radius:999px;background:#eef2ff;color:#3730a3;margin:2px 2px 0 0;">${esc(t)}</span>`).join('') : '<span style="font-size:.6rem;color:#c4c9d4;">AI 태그 없음</span>'}</div></div>`;
  const top = h3(`베스트 TOP ${rep.top5.length}`, '순이익순 · 등급 S/A/B/C · 추세 7일 · AI 태그 · 클릭 = 미리보기') + (rep.top5.length ? `<div class="rp-cards" style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;">${rep.top5.map(card).join('')}</div>` : '<div style="color:#9ca3af;font-size:.8rem;">베스트 소재에 성과 데이터가 없어요</div>');
  const al = rep.alerts, alertN = al.tired.length + al.off.length + al.gradeC.length;
  const alerts = h3('경보', '조치 필요한 것만') + `<div style="border:1px solid ${alertN ? '#fecaca' : '#e7e8ee'};background:${alertN ? '#fef2f2' : '#f8fafc'};border-radius:12px;padding:8px 12px;font-size:.82rem;">
    ${al.tired.length ? `<div><b style="color:#991b1b;">식은 소재 ${al.tired.length}</b> — ${al.tired.map(x => `${esc(x.name)}: 최근 7일 ROAS ${x.recent.toFixed(1)} (누적 ${x.cum.toFixed(1)})`).join(' / ')} → 교체 준비, 같은 상품 새 소재 1개</div>` : ''}
    <div><b style="color:${al.off.length ? '#991b1b' : '#374151'};">꺼진 베스트 ${al.off.length}</b>${al.off.length ? ' — ' + al.off.map(esc).join(' / ') : ''} · <b style="color:${al.gradeC.length ? '#991b1b' : '#374151'};">순이익 C 등급 ${al.gradeC.length}</b>${al.gradeC.length ? ' — ' + al.gradeC.map(x => esc(x.name)).join(' / ') : ''}${!alertN ? ' · <span style="color:#16a34a;font-weight:700;">조치 필요 없음</span>' : ''}</div></div>`;
  const chip = (t, on) => `<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:.78rem;font-weight:700;margin:3px 4px 3px 0;background:${on ? '#dcfce7' : '#f3f4f6'};color:${on ? '#166534' : '#374151'};">${t}</span>`;
  const c = rep.check;
  const tbl = (title, list) => `<div style="margin-top:6px;"><b style="font-size:.74rem;color:#4b5563;">${title}</b><table style="border-collapse:collapse;font-size:.76rem;margin:4px 0;width:100%;"><tr>${['', '소재', '지출', '구매', 'ROAS'].map(h => `<th style="text-align:left;padding:2px 10px 2px 0;color:#6b7280;font-weight:600;">${h}</th>`).join('')}</tr>${list.map(b => `<tr>${[esc(b.k), b.n + '개', won(Math.round(b.m.spend)), comma(b.m.purchases), `<b style="color:#15803d;">${R(b.m)}</b>`].map(x => `<td style="padding:2px 10px 2px 0;border-top:1px solid #f1f2f6;">${x}</td>`).join('')}</tr>`).join('')}</table></div>`;
  const why = h3('왜 그런가', '우수 공식 점검 — 누적 근거') + `<div class="rp-why" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="border:1px solid #e7e8ee;border-radius:12px;padding:10px 12px;"><div style="font-size:.78rem;font-weight:800;color:#1e1b4b;margin-bottom:4px;">공식 부합 (비교 컷 · 사이즈 숫자 · 체형커버 훅)</div>${c.tagN ? chip(`비교 컷 ${c.cmp}/${c.tagN}`, c.cmp / c.tagN >= 0.4) + chip(`사이즈 숫자 ${c.size}/${c.tagN}`, c.size / c.tagN >= 0.4) : chip('AI 태그 없음 — 테스트 리포트 해석을 돌리면 채워져요', false)}${c.hookN ? chip(`체형커버 훅 문구 ${c.hook}/${c.hookN}`, c.hook / c.hookN >= 0.5) : ''}</div>
      <div style="border:1px solid #e7e8ee;border-radius:12px;padding:10px 12px;"><div style="font-size:.78rem;font-weight:800;color:#1e1b4b;margin-bottom:4px;">형식 · 소구점 · 가격대</div>${chip(rep.fmt.map(b => `${b.k} ${b.n}`).join(' · ') || '—', false)}${chip(rep.tags.map(b => `${b.k} ${b.n}`).join(' · ') || '—', false)}${rep.price.length ? chip(rep.price.map(b => `${b.k} ${b.n}`).join(' · '), true) : ''}</div></div>`
    + det('패턴 표 전체 보기', '릴스/이미지 · 소구점 · 가격대별 지출·구매·ROAS', tbl('릴스 vs 이미지', rep.fmt) + tbl('소구점', rep.tags) + (rep.price.length ? tbl('가격대', rep.price) : ''));
  const V = ADMGR_BR_VERDICT;
  const prodTbl = rep.prods.length ? `<table style="border-collapse:collapse;font-size:.76rem;width:100%;"><tr>${['판단', '상품', '베스트', '순이익', 'ROAS', '근거'].map(h => `<th style="text-align:left;padding:3px 8px 3px 0;color:#6b7280;font-weight:600;">${h}</th>`).join('')}</tr>${rep.prods.map(p => `<tr>${[`<span style="display:inline-block;padding:1px 8px;border-radius:999px;background:${V[p.v][1]}18;color:${V[p.v][1]};font-weight:700;white-space:nowrap;">${p.label}</span>`, `<b>${esc(p.name)}</b>`, `${p.best} (켜짐 ${p.active})`, p.hasPf ? `<b style="color:${p.net >= 0 ? '#15803d' : '#dc2626'};">${p.net >= 0 ? '+' : ''}${won(Math.round(p.net))}</b>` : '—', R(p.m), `<span style="color:#6b7280;">${esc(p.why)}</span>`].map(x => `<td style="padding:4px 8px 4px 0;border-top:1px solid #f1f2f6;vertical-align:top;">${x}</td>`).join('')}</tr>`).join('')}</table><div style="margin-top:6px;color:#9ca3af;">교체 검토 = 베스트 전부 꺼짐 · 기간 순이익 마이너스 · (반품률 없으면) ROAS 손해</div>` : '<span style="color:#9ca3af;">베스트 상품 없음</span>';
  const nv = v => rep.prods.filter(p => p.v === v).length;
  const prods = h3('상품 판단', '순이익 기준') + det(`${rep.prods.length}개 상품`, `확장 ${nv('expand')} · 소재 추가 테스트 ${nv('more')} · 교체 검토 ${nv('replace')}`, prodTbl, true);
  const aiSec = ai && ai.text
    ? h3('AI 해석 원문', `${fmtMD(String(ai.at || '').slice(0, 10))} 생성`) + det('펼쳐 보기', '한 줄 평 · 왜 터졌나 · MD팀 · 컨텐츠팀 · 주의', `<div style="white-space:pre-line;">${esc(ai.text.trim())}</div>`, false)
    : h3('AI 해석', '아직 없음') + `<div style="font-size:.78rem;color:#9ca3af;">금요일 08:00 자동 실행 또는 바탕화면 <b>테스트리포트-해석.command</b>가 두 리포트의 AI 해석을 같이 붙여요 (이 맥의 Claude Code, 결제 없음)</div>`;
  const foot = `<div style="font-size:.7rem;color:#9ca3af;margin-top:14px;">기간 성과 = 일별 스냅샷 기준 증분${rep.approx ? ` (스냅샷 없는 옛 소재 ${rep.approx}개는 누적)` : ''} · 순이익 = 전환값×마진율×(1−순반품률)−지출 (관리자만) · AI 태그는 테스트 리포트가 단 것 재사용(릴스는 첫 장면) · 테스트 효율: 새 테스트 ${rep.eff.reg} · 우수 ${rep.eff.good} · 우수율 ${rep.eff.rate != null ? Math.round(rep.eff.rate * 100) + '%' : '—'}</div>`;
  return head + todo + top + alerts + why + prods + aiSec + foot;
}
async function admgrBestReport() {
  const b = admgr.best, t = admgr.test;
  if (!admgrCfg() || admgr.demo) { toast('실제 Meta 연동 후 쓸 수 있어요'); return; }
  const days = admgrReportOpen('best', '베스트 소재 리포트');
  $('rp-body').innerHTML = '<div class="empty-state"><p>베스트·테스트 소재와 일별 스냅샷을 모으는 중…</p></div>';
  try {
    if (!b.loaded) await admgrBestFetch();
    if (!t.loaded) await admgrTestFetch();
    if (!t.loaded) throw new Error('테스트 소재를 불러오지 못했어요');
    if (!t.creatives) await admgrTestCreativesEnsure();
    if (!admgr.products && !admgr.productsLoading) await admgrLoadProducts();
    const today = todayStr(0), from = (() => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - (days - 1)); return d.toISOString().slice(0, 10); })();
    const prevFrom = (() => { const d = new Date(from + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); })();
    await Promise.all([admgrTrendEnsure(), admgrProfitEnsure()]);   // 추세(일별 스냅샷)·순이익(반품률, 관리자만)
    const get = k => sbCall('client-log', { action: 'state_get', key: k }).catch(() => null);
    const [dayRes, aiRes, tagRes, todoRes] = await Promise.all([metaGet({ action: 'daystats', d1: from, d0: prevFrom }), get('best_report_ai'), get('test_report_ai'), get('best_todo')]);
    b.ai = aiRes && aiRes.data ? aiRes.data : null;
    const thumbs = {}; (b.ads || []).forEach(a => { thumbs[a.id] = a.image || a.thumb || ''; });
    const rep = admgrBestReportBuild({ tests: admgrTestRowSets().vis, best: b.rows || [], bestAds: b.ads || [], dayRows: dayRes.rows || [], cre: t.creatives || new Map(), products: admgr.products || [], judge: admgrTJudge,
      pf: admgrProfit, trend: a => admgrTrend(a), aiTags: tagRes && tagRes.data && tagRes.data.tags || null, thumbs }, days, today);
    rep.todoSaved = todoRes && todoRes.data && Array.isArray(todoRes.data.items) ? todoRes.data.items : [];
    rep.todo = admgrTodoMerge(rep.todoRule, rep.todoSaved, rep.to);
    b.report = rep;
    admgrRp.cur = { title: `베스트 소재 리포트 ${rep.from}~${rep.to}`, text: () => admgrBestReportText(rep, b.ai), textSummary: () => admgrBestReportText(rep, b.ai, 'summary'), html: () => admgrBestReportHtml(rep, b.ai) };
    $('rp-body').innerHTML = admgrBestReportHtml(rep, b.ai);
    admgrTodoSave(rep, 'best_todo');
    // 숫자 리포트를 계정 공유 상태에 저장 → 바탕화면 '주간리포트-해석'이 읽어 AI 해석을 붙인다 (마지막으로 연 리포트 기준)
    try {
      const cur = await sbCall('client-log', { action: 'state_get', key: 'best_report' });
      await sbCall('client-log', { action: 'state_set' }, { key: 'best_report', base: cur.ver || null, data: { from: rep.from, to: rep.to, days, at: new Date().toISOString(), text: admgrBestReportText(rep, null) } });
    } catch (e) { /* 저장 실패해도 화면 리포트는 정상 — 해석만 못 붙는다 */ }
  } catch (e) { $('rp-body').innerHTML = `<div class="empty-state"><p>리포트를 만들지 못했어요: ${esc(e.message)}</p></div>`; }
}
/* ═══ 추세·피로도 (2026-09-12) — test_ad_day 일별 누적 스냅샷(서버가 매일 1행)으로
   최근 7일 성과 = 지금 누적 − 7일 전 이하 최신 행, 일별 증분 = 이웃 행 차이 → 작은 막대(스파크라인).
   식음(피로) = 최근 7일 지출이 기준 이상인데 최근 ROAS가 누적 ROAS의 절반 미만 (누적 구매 5건↑일 때만). 스냅샷은 2026-09-12부터 쌓여 며칠간은 '추세 n일'로만 표시 */
const ADMGR_TREND_DAYS = 7;
const admgrShiftDay = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
async function admgrTrendEnsure() {
  const t = admgr.test, today = todayStr(0);
  if (admgr.demo || t.trendLoading || (t.trendDay === today && t.trend) || !admgrCfg()) return;
  t.trendLoading = true;
  try {
    const { rows } = await metaGet({ action: 'daystats', since: admgrShiftDay(today, -(ADMGR_TREND_DAYS + 1)) });
    t.trend = new Map(); (rows || []).forEach(r => (t.trend.get(r.ad_id) || t.trend.set(r.ad_id, []).get(r.ad_id)).push(r));
    t.trendDay = today; renderAdmgr(true);
  } catch (e) { /* 추세는 없어도 표는 정상 */ }
  t.trendLoading = false;
}
function admgrTrend(a, trendMap, today) {   // null = 스냅샷 없음. { days, recent, daily:[{day,spend,purchases,value}], cumRoas, recentRoas, tired }
  const L = ((trendMap || admgr.test.trend) && (trendMap || admgr.test.trend).get(a.id)) || [];
  if (!L.length) return null;
  today = today || todayStr(0);
  const from = admgrShiftDay(today, -ADMGR_TREND_DAYS);
  const M = r => ({ spend: +r.spend || 0, purchases: +r.purchases || 0, value: +r.value || 0 });
  const sub = (x, y) => ({ spend: x.spend - y.spend, purchases: x.purchases - y.purchases, value: x.value - y.value });
  const cum = M(a);
  let base = null; for (const r of L) if (r.day <= from) base = r;
  const recent = base ? sub(cum, M(base)) : (a.reg_date && a.reg_date >= from ? cum : null);
  const pts = L.filter(r => r.day > from).map(r => ({ day: r.day, ...M(r) }));
  if (!pts.length || pts[pts.length - 1].day !== today) pts.push({ day: today, ...cum }); else pts[pts.length - 1] = { day: today, ...cum };   // 오늘은 지금 누적으로
  const daily = []; let prev = base ? M(base) : (a.reg_date && a.reg_date >= from ? { spend: 0, purchases: 0, value: 0 } : null);
  for (const p of pts) { if (prev) daily.push({ day: p.day, ...sub(p, prev) }); prev = p; }
  const roas = m => m && m.spend > 0 ? m.value / m.spend : 0;
  const cumRoas = roas(cum), recentRoas = roas(recent);
  const tired = !!recent && recent.spend >= admgrTJudge.spend && cum.purchases >= 5 && cumRoas > 0 && recentRoas < cumRoas * 0.5;
  return { days: L.length, recent, daily, cumRoas, recentRoas, tired };
}
function admgrSparkHtml(tr, be) {   // 일별 ROAS 막대 7개 (높이 = ROAS, 손익분기(없으면 1) 미만은 빨강) + 최근 7일 ROAS
  if (!tr) return '';
  const line = be || 1, cap = Math.max(line * 3, 3);
  const bars = tr.daily.slice(-ADMGR_TREND_DAYS).map(d => { const r = d.spend > 0 ? d.value / d.spend : 0, h = d.spend > 0 ? Math.max(2, Math.round(Math.min(r, cap) / cap * 14)) : 1;
    return `<rect width="4" height="${h}" y="${14 - h}" fill="${d.spend <= 0 ? '#e5e7eb' : r < line ? '#ef4444' : '#22c55e'}"><title>${fmtMD(d.day)} 지출 ${won(Math.round(d.spend))} · 구매 ${d.purchases} · ROAS ${r.toFixed(2)}</title></rect>`; });
  const svg = bars.length ? `<svg width="${bars.length * 6}" height="14" style="vertical-align:middle;">${bars.map((b, i) => `<g transform="translate(${i * 6},0)">${b}</g>`).join('')}</svg>` : '';
  const txt = tr.days < 3 ? `<span style="color:#c4c9d4;" title="일별 스냅샷이 ${tr.days}일치 — 3일부터 추세가 보여요">추세 ${tr.days}일</span>`
    : tr.recent ? `<span title="최근 7일 지출 ${won(Math.round(tr.recent.spend))} · 구매 ${tr.recent.purchases} · ROAS ${tr.recentRoas.toFixed(2)} (누적 ${tr.cumRoas.toFixed(2)})">7일 ${tr.recentRoas.toFixed(1)}</span>` : '';
  return `<div style="font-size:.6rem;color:#9ca3af;white-space:nowrap;display:flex;align-items:center;gap:4px;">${svg}${txt}${tr.tired ? '<span class="status-badge badge-red" style="font-size:.58rem;padding:0 5px;" title="최근 7일 ROAS가 누적의 절반 미만 — 소재 피로, 교체 준비">식음</span>' : ''}</div>`;
}

/* ═══ 퍼널 진단 (2026-09-12) — "왜 안 터졌는지"를 노출→클릭→랜딩→장바구니→구매 단계로.
   기준은 절대값이 아니라 지금 보이는 테스트 소재들의 중앙값(노출 1,000↑인 것) — 계정·시즌이 바뀌어도 자동으로 맞춰진다.
   ponytail: 진단은 규칙 6개. 정밀 기준이 필요해지면 admgrFunnelBase에 분위수 추가 */
const ADMGR_FUNNEL_MIN_IMP = 1000;
function admgrFunnelRates(a) {
  if (!(a.imp > 0)) return null;
  const ctr = (a.clicks || 0) / a.imp, ts = a.v3 > 0 ? a.v3 / a.imp : null, lpvR = a.clicks > 0 ? (a.lpv || 0) / a.clicks : null;
  const cvr = a.lpv > 0 ? (a.purchases || 0) / a.lpv : a.clicks > 0 ? (a.purchases || 0) / a.clicks : null;
  return { ctr, ts, lpvR, cvr, atcR: a.lpv > 0 ? (a.atc || 0) / a.lpv : null, cartR: a.atc >= 3 ? (a.purchases || 0) / a.atc : null, freq: a.freq || 0 };   // cartR = 장바구니→구매 (장바구니 3건↑만)
}
const admgrMedian = arr => { const L = arr.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return L.length ? (L.length % 2 ? L[(L.length - 1) / 2] : (L[L.length / 2 - 1] + L[L.length / 2]) / 2) : null; };
function admgrFunnelBase(rows) {   // 표본 기준선 — 노출 1,000↑ 소재들의 중앙값
  const R = rows.filter(a => a.imp >= ADMGR_FUNNEL_MIN_IMP).map(admgrFunnelRates).filter(Boolean);
  return { n: R.length, ctr: admgrMedian(R.map(r => r.ctr)), ts: admgrMedian(R.map(r => r.ts)), lpvR: admgrMedian(R.map(r => r.lpvR)), cvr: admgrMedian(R.map(r => r.cvr)), cartR: admgrMedian(R.map(r => r.cartR)) };
}
/* 진단 결과: { k, label, fix, cls } — k: nodata | hook | click | landing | detail | cart | good | ok */
function admgrFunnelDiag(a, base) {
  const r = admgrFunnelRates(a);
  if (a.imp == null) return { k: 'nodata', label: '퍼널 데이터 없음', fix: '테스트 종료 보관분(옛 소재)은 노출·클릭이 저장되지 않아 진단 불가', cls: 'badge-gray' };   // gone 스냅샷엔 퍼널 필드가 없다 — '노출 부족'으로 오해하지 않게
  if (!r || a.imp < ADMGR_FUNNEL_MIN_IMP) return { k: 'nodata', label: '노출 부족', fix: `노출 ${comma(a.imp || 0)} < ${comma(ADMGR_FUNNEL_MIN_IMP)} — 진단은 조금 더 돌린 뒤`, cls: 'badge-gray' };
  const J = admgrTJudge;
  if (r.ts != null && base.ts && r.ts < base.ts * 0.7) return { k: 'hook', label: '후크 약함', fix: `3초 재생 ${(r.ts * 100).toFixed(0)}% (평균 ${(base.ts * 100).toFixed(0)}%) — 첫 1초 장면·자막을 바꿔서 다시`, cls: 'badge-red' };
  if (base.ctr && r.ctr < base.ctr * 0.7) return { k: 'click', label: '클릭 약함', fix: `CTR ${(r.ctr * 100).toFixed(2)}% (평균 ${(base.ctr * 100).toFixed(2)}%) — 소구점·문구 첫 줄을 바꿔서 다시`, cls: 'badge-red' };
  if (r.lpvR != null && a.clicks >= 30 && r.lpvR < 0.6) return { k: 'landing', label: '랜딩 이탈', fix: `클릭 ${comma(a.clicks)} 중 도착 ${(r.lpvR * 100).toFixed(0)}% — 상세페이지 로딩·링크 확인`, cls: 'badge-orange' };
  if (a.atc >= 5 && base.cartR != null && r.cartR < base.cartR * 0.5) return { k: 'cart', label: '장바구니 이탈', fix: `장바구니 ${comma(a.atc)} → 구매 ${comma(a.purchases || 0)} (${(r.cartR * 100).toFixed(0)}%, 평균 ${(base.cartR * 100).toFixed(0)}%) — 옵션·배송비·결제 단계 확인`, cls: 'badge-orange' };   // 고정 20%는 절반 가까이 걸려서(실데이터 41/145) 중앙값의 절반 미만만
  if ((a.purchases || 0) === 0 && (a.spend || 0) >= J.spend) return { k: 'detail', label: '구매 0 (클릭 정상)', fix: `CTR ${(r.ctr * 100).toFixed(2)}%로 클릭은 나오는데 구매 0 — 상세페이지·가격·후기 확인`, cls: 'badge-orange' };   // 클릭 약함이 아닌데 구매 0 = 소재 뒤 단계 문제
  const be = admgrTJudge.useBe !== false ? admgrBreakEven(a) : null, roasV = a.spend > 0 ? (a.value || 0) / a.spend : 0, lossLine = be ? be.be : J.offRoas;
  if ((a.purchases || 0) > 0 && (a.spend || 0) >= J.spend && roasV < lossLine) return { k: 'loss', label: '구매 있으나 손해', fix: `ROAS ${roasV.toFixed(2)} < 손익분기 ${lossLine.toFixed(1)} — 구매는 나오지만 CPA가 마진보다 큼: 타겟·가격·마진 확인`, cls: 'badge-orange' };
  if (base.ctr && base.cvr != null && r.ctr >= base.ctr && r.cvr != null && r.cvr >= base.cvr) return { k: 'good', label: '퍼널 균형', fix: `CTR·전환율 모두 평균 이상 — 예산 확대 후보`, cls: 'badge-green' };
  return { k: 'ok', label: '특이 없음', fix: '각 단계가 평균 근처', cls: 'badge-gray' };
}
function admgrFunnelTip(a, r) {   // 툴팁·엑셀용 숫자 한 줄
  if (!r) return '노출 데이터 없음';
  const pct = v => v == null ? '—' : (v * 100).toFixed(v < 0.1 ? 2 : 0) + '%';
  return `노출 ${comma(a.imp)} · 링크 클릭 ${comma(a.clicks || 0)} (CTR ${pct(r.ctr)})${r.ts != null ? ` · 3초 재생 ${pct(r.ts)}` : ''} · 랜딩 도착 ${comma(a.lpv || 0)} (${pct(r.lpvR)}) · 장바구니 ${comma(a.atc || 0)} · 구매 ${comma(a.purchases || 0)} (전환율 ${pct(r.cvr)}) · 빈도 ${(r.freq || 0).toFixed(1)}`;
}
function admgrFunnelCell(a, base) {
  const r = admgrFunnelRates(a), d = admgrFunnelDiag(a, base);
  const pct = v => v == null ? '—' : (v * 100).toFixed(v < 0.1 ? 2 : 0) + '%';
  const nums = r ? `CTR ${pct(r.ctr)}${r.ts != null ? ` · 3초 ${pct(r.ts)}` : r.lpvR != null ? ` · 도착 ${pct(r.lpvR)}` : ''}` : '—';
  return `<div title="${esc(admgrFunnelTip(a, r))}\n${esc(d.fix)}" style="cursor:help;">
    <div style="font-size:.64rem;color:#6b7280;white-space:nowrap;">${nums}${r && r.freq >= 3 ? ` <span style="color:#b45309;" title="같은 사람에게 평균 ${r.freq.toFixed(1)}회 노출 — 피로 주의">빈도 ${r.freq.toFixed(1)}</span>` : ''}</div>
    <span class="status-badge ${d.cls}" style="font-size:.6rem;margin-top:2px;">${d.label}</span></div>`;
}

/* ── 판정 추천: 기준(일수·지출·ROAS·구매)은 화면에서 바꿀 수 있고 브라우저에 기억 ── */
/* 기준: useBe=상품 마진으로 손익분기 ROAS를 계산해 소재마다 다른 기준(OFF = 손익분기 미만, 우수 = 손익분기×beMult 이상). 상품이 안 잡히면 offRoas/goodRoas 고정값.
   goodPurch = 우수에 필요한 최소 구매(표본) — ROAS가 좋아도 이보다 적으면 '표본 부족' (구매 몇 건의 ROAS는 우연이 크다) */
const ADMGR_TJUDGE_DEFAULT = { days: 3, spend: 30000, offRoas: 1, goodRoas: 3, goodPurch: 5, useBe: true, beMult: 1.5 };
let admgrTJudge = Object.assign({}, ADMGR_TJUDGE_DEFAULT, lsGet('adc_admgr_tjudge', null) || {});
/* 손익분기 ROAS = 판매가 ÷ (판매가 − 공급가×1.1) — 광고세트 탭 오늘의 판정과 같은 마진 식(admgrMarginOf). 세트 id로 직접 입력한 마진도 반영. 상품 못 찾으면 null */
function admgrBreakEven(a) {
  const name = a.adset_name || a.name || '';
  const n = admgrNorm(name), p = admgrProdIdx().find(p => n.includes(p.n));
  const manual = admgr.margins[a.adset_id];
  if (p && p.price > 0) { const m = manual > 0 ? manual : p.price - (p.supply || 0) * 1.1; return m > 0 ? { be: p.price / m, price: p.price, margin: m, name: p.name } : null; }
  return null;
}
function admgrRecommend(a) {   // null = 평가중 아님. k: off | good | wait(기준 채웠지만 애매·표본 부족) | watch(아직 기준 미달)
  if (a.st !== 'eval') return null;
  // ROAS = 구매 전환값 ÷ 지출 (테스트 소재 데이터엔 roas 필드가 없고 value만 온다 — 실사고 2026-09-11: roas 0으로 읽어 전부 OFF 후보)
  const dp = admgrDPlus(a) ?? 0, roas = a.spend ? (a.roas != null ? a.roas : (a.value || 0) / a.spend) : 0, J = admgrTJudge;
  const be = J.useBe !== false ? admgrBreakEven(a) : null;
  const offR = be ? be.be : J.offRoas, goodR = be ? be.be * (J.beMult || 1.5) : J.goodRoas, base = be ? `손익분기 ${be.be.toFixed(1)}` : '고정 기준';
  const out = r => ({ ...r, be: be ? be.be : null, offR, goodR });
  if (dp < J.days || (a.spend || 0) < J.spend) return out({ k: 'watch', label: '지켜보기', why: `D+${dp} · ${won(a.spend || 0)} — 기준(D+${J.days}·${won(J.spend)}) 전` });
  if (roas < offR) return out({ k: 'off', label: 'OFF 후보', why: `ROAS ${roas.toFixed(2)} < ${offR.toFixed(1)} (${base}${be ? ' — 이 소재는 손해' : ''})` });
  if (roas >= goodR) {
    if ((a.purchases || 0) >= J.goodPurch) return out({ k: 'good', label: '우수 후보', why: `ROAS ${roas.toFixed(2)} ≥ ${goodR.toFixed(1)} (${base}×${J.beMult || 1.5}) · 구매 ${a.purchases}` });
    return out({ k: 'wait', sample: true, label: '표본 부족', why: `ROAS ${roas.toFixed(2)}는 좋지만 구매 ${a.purchases || 0}건 < ${J.goodPurch}건 — 우연일 수 있어 더 지켜보기` });
  }
  return out({ k: 'wait', label: '애매', why: `ROAS ${roas.toFixed(2)} · 구매 ${a.purchases || 0} — OFF(${offR.toFixed(1)})·우수(${goodR.toFixed(1)}) 사이` });
}
const ADMGR_REC_RANK = { off: 0, good: 0, wait: 1, watch: 2 };
function admgrTJudgeCmp(x, y) {
  const rx = admgrRecommend(x), ry = admgrRecommend(y);
  const kx = rx ? ADMGR_REC_RANK[rx.k] : 3, ky = ry ? ADMGR_REC_RANK[ry.k] : 3;
  if (kx !== ky) return kx - ky;
  const dx = admgrDPlus(x) ?? -1, dy = admgrDPlus(y) ?? -1;
  if (dx !== dy) return dy - dx;
  return admgrCmp(x, y);
}
function admgrRecBadge(a) {
  const r = admgrRecommend(a); if (!r) return '';
  const cls = r.k === 'off' ? 'badge-red' : r.k === 'good' ? 'badge-green' : r.k === 'wait' ? 'badge-yellow' : 'badge-gray';
  return `<div style="margin-bottom:3px;"><span class="status-badge ${cls}" title="${esc(r.why)}" style="font-size:.62rem;">${r.k === 'watch' ? '' : '▶ '}${r.label}</span></div>`;
}
function admgrTJudgeToggle() { admgr.test.judgeOpen = !admgr.test.judgeOpen; renderAdmgr(true); }
function admgrTJudgeSet(k, v) { admgrTJudge[k] = k === 'useBe' ? !!Number(v) : (Number(v) || ADMGR_TJUDGE_DEFAULT[k]); lsSet('adc_admgr_tjudge', admgrTJudge); renderAdmgr(true); }
function admgrTJudgeReset() { admgrTJudge = { ...ADMGR_TJUDGE_DEFAULT }; lsSet('adc_admgr_tjudge', admgrTJudge); renderAdmgr(true); }

/* ── 행 썸네일: 리포트용 캐시(t.thumbs)를 표에도 — 없는 세트만 100개씩 조회 후 다시 그림 ── */
async function admgrTestThumbsEnsure(rows) {
  const t = admgr.test; t.thumbs = t.thumbs || {};
  if (admgr.demo || t.thumbsLoading) return;
  // 아직 안 받았거나(''), 이전에 실패해서 비어 있는 것만 다시 — 응답에 진짜 없는 건 '-'로 표시해 재조회 안 함
  const need = [...new Set(rows.filter(a => !t.thumbs[a.id]).map(a => a.adset_id))].slice(0, 300);
  if (!need.length) return;
  t.thumbsLoading = true;
  try {
    for (let i = 0; i < need.length; i += 100) {
      const chunk = need.slice(i, i + 100);
      const r = await metaGet({ action: 'creatives', set_ids: chunk.join(',') });
      const got = new Set();
      (r.ads || []).forEach(a => { t.thumbs[a.id] = a.image || a.thumb || '-'; got.add(String(a.adset_id)); });
      rows.forEach(a => { if (chunk.includes(a.adset_id) && got.has(String(a.adset_id)) && !t.thumbs[a.id]) t.thumbs[a.id] = '-'; });
    }
  } catch (e) { /* 썸네일은 실패해도 표는 정상 — 다음 렌더에서 다시 시도 */ }
  t.thumbsLoading = false; renderAdmgr(true);
}
/* ── 우리 대시보드로 만든 광고의 등록 기록(소구점·등록자·문구) — ad_id로 연결 ── */
async function admgrTestCreativesEnsure() {
  const t = admgr.test;
  if (t.creatives || t.creativesLoading || admgr.demo || typeof uplCall !== 'function') return;
  t.creativesLoading = true;
  try { const { rows } = await uplCall({ action: 'creatives_list', status: 'ad_created', limit: 500 }); t.creatives = new Map(rows.filter(r => r.ad_id).map(r => [String(r.ad_id), r])); renderAdmgr(true); }
  catch (e) { t.creatives = new Map(); }
  t.creativesLoading = false;
}
const admgrTagOf = fn => { const m = String(fn || '').match(/_(?:R|P)\d+_([^_]+)_\d+_\d{6}_test/); return m ? m[1] : ''; };
function admgrTestCopy(adId) {
  const c = admgr.test.creatives && admgr.test.creatives.get(String(adId)); if (!c) return;
  textModalOpen(`광고 문구 — ${c.file_name}`, c.text || { message: '', title: '', description: '', link: c.url || '', cta: 'LEARN_MORE' }, async t => {
    try { await uplCall({ action: 'creative_save' }, { id: c.id, text: t, apply_product: true }); c.text = t; toast('문구를 저장했어요 (같은 상품 대기 소재에도 적용)'); }
    catch (e) { toast('저장 실패: ' + e.message); }
  });
}
/* 세트명 앞부분(첫 _ 앞) = 상품명 — 상품별 묶기·소재 등록 이동에 사용 */
const admgrProductOf = a => String(a.adset_name || a.name || '').normalize('NFC').split('_')[0].replace(/\s+\d{6}\b.*$/, '').replace(/\s+\d{2,}\s*$/, '').trim() || '(이름 없음)';   // 꼬리 날짜·가격 숫자 제거 ('안스 후드 집업 28500 260906 test' → '안스 후드 집업')
async function admgrTestGoRegister(prodName) {
  showMenu('ptest');
  try { await regPresetInit(); } catch (e) { toast('상품 목록을 불러오지 못했어요'); return; }
  const key = normKey(prodName);
  const cp = (reg.products || []).find(p => p.key === key) || (reg.products || []).find(p => p.key.includes(key) || key.includes(p.key));
  if (!cp) { $('reg-preset-q').value = prodName; regPresetFilter(); toast(`'${prodName}' 검색 결과에서 상품을 골라주세요`); $('reg-preset-q').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  regPresetPick(String(cp.product_no));
  $('reg-preset-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast(`'${cp.core}'로 잡았어요 — 추가 소재 파일을 올리세요`);
}
function admgrTestGroupToggle() { const t = admgr.test; t.group = !t.group; lsSet('adc_admgr_test_group', t.group); renderAdmgr(true); }
function admgrTestGroupCollapse(key) { const t = admgr.test; t.collapsed = t.collapsed || new Set(); t.collapsed.has(key) ? t.collapsed.delete(key) : t.collapsed.add(key); renderAdmgr(true); }

function renderAdmgrTest() {
  if (!admgr.products && !admgr.productsLoading && admgrCfg() && !admgr.demo) admgrLoadProducts();   // 손익분기 ROAS용 카페24 판매가·공급가
  const t = admgr.test;
  if (t.group === undefined) t.group = !!lsGet('adc_admgr_test_group', false);
  if (!admgrCfg() && !admgr.demo) {
    return `<div class="empty-state"><div class="es-icon"><i class="fa-solid fa-flask"></i></div>
      <p>연동 후에는 <b>광고세트명에 'test'</b>가 들어간 세트의 소재가 여기에 자동으로 모여요.<br/>지금은 <b>데모 데이터로 보기</b>로 화면을 구경할 수 있어요.</p></div>`;
  }
  if (!t.loaded) {
    return `<div class="empty-state"><p>${t.loading ? '테스트 소재를 불러오는 중… (전체 세트를 훑어서 10초쯤 걸려요)' : '<b>새로고침</b>을 누르면 테스트 소재를 불러와요.'}</p></div>`;
  }
  const d = t.data;
  const { vis, hid, rows } = admgrTestRowSets();
  const cnt = k => vis.filter(a => a.st === k).length;
  const nEval = cnt('eval'), nOff = cnt('off'), nMeh = cnt('meh'), nGood = cnt('good'), nEtc = cnt('review') + cnt('rejected');
  const nReq = vis.filter(a => a.meta.asset_req_at).length;
  const nGone = vis.filter(a => a.gone).length;
  const recs = vis.map(a => admgrRecommend(a)).filter(Boolean);
  const nJudge = recs.filter(r => r.k === 'off' || r.k === 'good').length, nWait = recs.filter(r => r.k === 'wait').length, nWatch = recs.filter(r => r.k === 'watch').length;
  setTimeout(() => { admgrTestThumbsEnsure(rows); admgrTestCreativesEnsure(); }, 0);

  const chip = (key, label, n, dot) => {
    const on = t.filter === key && !t.showHidden;
    return `<button class="filter-tab ${on ? 'active' : ''}" onclick="admgrTestFilter('${key}')">${dot ? `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${on ? '#fff' : dot};margin-right:5px;"></span>` : ''}${label} ${n}</button>`;
  };
  const J = admgrTJudge;
  const judgeBox = t.judgeOpen ? `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;background:#f8fafc;border:1px solid #e7e8ee;border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:.76rem;">
      <b style="color:#1e1b4b;">판정 추천 기준</b>
      <label>D+ <input class="inp" type="number" min="0" value="${J.days}" style="width:60px;padding:3px 6px;" onchange="admgrTJudgeSet('days',this.value)" />일 이상</label>
      <label>누적 지출 <input class="inp" type="number" min="0" step="1000" value="${J.spend}" style="width:90px;padding:3px 6px;" onchange="admgrTJudgeSet('spend',this.value)" />원 이상일 때</label>
      <label style="display:inline-flex;align-items:center;gap:4px;"><input type="checkbox" ${J.useBe !== false ? 'checked' : ''} onchange="admgrTJudgeSet('useBe',this.checked?1:0)" style="margin:0;" /> <b>상품 마진으로 손익분기 ROAS</b> 계산 (OFF = 손익분기 미만 · 우수 = 손익분기 × <input class="inp" type="number" min="1" step="0.1" value="${J.beMult || 1.5}" style="width:56px;padding:3px 6px;" onchange="admgrTJudgeSet('beMult',this.value)" /> 이상)</label>
      <label title="${J.useBe !== false ? '카페24 상품과 이름이 안 맞을 때만 쓰는 고정값' : ''}"><span style="color:#dc2626;">OFF 후보</span>${J.useBe !== false ? '(미매칭 시)' : ''}: ROAS <input class="inp" type="number" min="0" step="0.1" value="${J.offRoas}" style="width:60px;padding:3px 6px;" onchange="admgrTJudgeSet('offRoas',this.value)" /> 미만</label>
      <label><span style="color:#15803d;">우수 후보</span>${J.useBe !== false ? '(미매칭 시)' : ''}: ROAS <input class="inp" type="number" min="0" step="0.1" value="${J.goodRoas}" style="width:60px;padding:3px 6px;" onchange="admgrTJudgeSet('goodRoas',this.value)" /> 이상</label>
      <label title="ROAS가 좋아도 구매가 이보다 적으면 '표본 부족' — 구매 몇 건의 ROAS는 우연이 크다">표본: 구매 <input class="inp" type="number" min="0" value="${J.goodPurch}" style="width:50px;padding:3px 6px;" onchange="admgrTJudgeSet('goodPurch',this.value)" />건 이상이어야 우수</label>
      <span style="color:#9ca3af;">그 사이는 '애매', 기준 전은 '지켜보기'</span>
      <button class="btn-ghost" style="padding:3px 9px;font-size:.7rem;" onclick="admgrTJudgeReset()">기본값</button></div>` : '';
  const ctrl = `<div class="filter-tabs" style="margin-bottom:10px;">
    ${chip('judge', '▶ 판정 필요', nJudge, '#4f46e5')}${chip('all', '전체', vis.length)}${chip('eval', '평가중', nEval)}${chip('off', 'OFF', nOff, '#ef4444')}
    ${chip('meh', '애매', nMeh, '#f97316')}${chip('good', '우수', nGood, '#22c55e')}
    ${chip('gone', '테스트 종료', nGone)}${chip('req', '추가소재 요청', nReq)}
    <span style="flex:1;"></span>
    <button class="filter-tab ${t.group ? 'active' : ''}" onclick="admgrTestGroupToggle()" title="세트명 앞 상품명으로 묶어 상품별 소계 표시"><i class="fa-solid fa-layer-group"></i> 상품별 묶기</button>
    <button class="filter-tab ${t.judgeOpen ? 'active' : ''}" onclick="admgrTJudgeToggle()" title="판정 추천 기준 바꾸기"><i class="fa-solid fa-sliders"></i> 기준</button>
    <button class="filter-tab" style="color:${t.showHidden ? '#4f46e5' : '#dc2626'};border-color:${t.showHidden ? '#a5b4fc' : '#fecaca'};" onclick="admgrTestBulkHide(${t.showHidden ? 'false' : 'true'})">${t.showHidden ? '선택 복원' : '목록에서 제거'}</button>
    <button class="filter-tab" onclick="admgrTestToggleHidden()">${t.showHidden ? '목록으로 돌아가기' : `제거한 소재 ${hid.length}개 보기`}</button>
    <button class="filter-tab" style="color:#15803d;" onclick="admgrTestXlsx()" title="지금 보이는 표 그대로 (필터·검색·정렬 반영)"><i class="fa-solid fa-file-arrow-down"></i> 엑셀</button>
    <button class="filter-tab" style="color:#4f46e5;border-color:#c7d2fe;" onclick="admgrTestReport()" title="상품팀 전달용 — 기간 내 판정·추가소재 현황을 상품별로 정리 (텍스트 복사·PDF)"><i class="fa-solid fa-clipboard-list"></i> 리포트</button>
  </div>${judgeBox}
  <div class="info-bar"><i class="fa-regular fa-clock"></i> 성과는 <b>등록 이후 누적</b> · ${admgrAgo(d.fetched_at)} 기준 (60초 캐시)${d.truncated ? ' · 일부 생략(세트가 너무 많아요)' : ''} · 테스트 세트 ${d.adset_count || 0}개 · 정렬 안 고르면 <b>판정 필요 순</b></div>`;

  const tileBtn = (key, label, val, sub) => `<div class="kpi-tile ${t.filter === key && !t.showHidden ? 'kt-hero' : ''}" style="cursor:pointer;" onclick="admgrTestFilter('${key}')" title="누르면 걸러요"><div class="kt-label">${label}</div><div class="kt-value" style="font-size:1.15rem;">${val}</div>${sub ? `<div class="kt-sub">${sub}</div>` : ''}</div>`;
  const tiles = `<div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:14px;">
    ${tileBtn('judge', '<i class="fa-solid fa-gavel"></i> 오늘 판정할 소재', nJudge + '개', `애매 ${nWait} · 지켜보기 ${nWatch}`)}
    ${tileBtn('eval', '평가중', nEval + '개')}${tileBtn('good', '<span style="color:#22c55e;">●</span> 우수', nGood + '개')}
    ${tileBtn('meh', '<span style="color:#f97316;">●</span> 애매', nMeh + '개')}${tileBtn('off', '<span style="color:#ef4444;">●</span> OFF' + (nEtc ? ` · 검토중 ${nEtc}` : ''), nOff + '개')}
    ${admgrTile('누적 지출 (표시 소재)', won(vis.reduce((s0, a) => s0 + a.spend, 0)))}
  </div>`;

  if (!rows.length) {
    return ctrl + tiles + `<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-folder-open"></i></div>
      <p>${t.showHidden ? '제거한 소재가 없어요.' : t.filter === 'judge' ? '지금 판정할 소재가 없어요 — 기준을 채운 소재가 생기면 여기 모여요.' : admgr.q ? '검색 결과가 없어요.' : "표시할 테스트 소재가 없어요. 광고세트명에 'test'를 포함해 등록하면 여기에 자동으로 나타나요."}</p></div>`;
  }
  const allChecked = rows.length && rows.every(r => t.sel.has(r.id));
  const cre = t.creatives || new Map();
  const fbase = admgrFunnelBase(vis);   // 퍼널 기준선 — 숨긴 것 빼고 전체 테스트 소재의 중앙값 (필터와 무관하게 같은 기준)
  /* 열: 선택 · 소재(썸네일+세트명+광고명+등록기록) · 등록(MM/DD, D+) · 판정(추천 → 현재 상태 → 버튼) · 지출 · 구매/CPA · ROAS · 추가소재 · 메모 */
  const rowHtml = a => {
    const checked = t.sel.has(a.id), dp = admgrDPlus(a), c = cre.get(String(a.id));
    const th = (t.thumbs || {})[a.id]; const thSrc = th && th !== '-' ? th : '';
    const rec = admgrRecommend(a);
    const recCls = rec ? (rec.k === 'off' ? 'badge-red' : rec.k === 'good' ? 'badge-green' : rec.k === 'wait' ? 'badge-yellow' : 'badge-gray') : '';
    return `<tr onclick="admgrTestSel('${a.id}')" style="cursor:pointer;${checked ? 'background:#eef2ff;' : ''}">
        <td class="cb"><input type="checkbox" ${checked ? 'checked' : ''} style="pointer-events:none;" /></td>
        <td class="name-cell" style="text-align:left;"><div style="display:flex;gap:8px;align-items:center;min-width:0;">
          <span onclick="event.stopPropagation();showMetaPreview('${a.id}')" title="소재 미리보기" style="cursor:zoom-in;flex:none;">${mediaThumbHtml(thSrc, 'image', 40)}</span>
          <div style="min-width:0;flex:1;">
            <div class="ell" onclick="event.stopPropagation();showMetaPreview('${a.id}')" title="${esc(a.adset_name)} — 클릭하면 미리보기" style="font-weight:700;color:#4338ca;cursor:pointer;">${esc(a.adset_name)}</div>
            <div class="ell" style="font-size:.66rem;color:#9ca3af;" title="${esc(a.name)}">${esc(a.name)}</div>
            ${c ? `<div class="ell" style="font-size:.64rem;color:#6b7280;"><i class="fa-solid fa-cloud" style="color:#4f46e5;"></i> ${esc(admgrTagOf(c.file_name) || '소재')} · ${esc(whoName(c.created_by_name, c.created_by_email))} · <a href="#" onclick="event.stopPropagation();admgrTestCopy('${a.id}');return false;">문구</a></div>` : ''}
          </div></div></td>
        <td class="ctr" style="white-space:nowrap;">${a.reg_date ? fmtMD(a.reg_date) : '—'}<div style="font-size:.62rem;color:#9ca3af;">${dp == null ? '' : 'D+' + dp}</div></td>
        <td class="ctr" style="white-space:nowrap;">
          ${rec ? `<div><span class="status-badge ${recCls}" title="${esc(rec.why)}">${rec.k === 'watch' ? '' : '▶ '}${rec.label}</span></div>` : `<div>${admgrTestBadge(a)}</div>`}
          ${rec ? `<div style="margin-top:2px;">${admgrVerdictBtns(a)}</div>` : ['meh', 'good', 'ended'].includes(a.st) ? `<div style="margin-top:2px;">${admgrVerdictBtns(a)}</div>` : ''}
          ${rec && rec.be ? `<div style="font-size:.6rem;color:#9ca3af;white-space:nowrap;" title="${esc(rec.why)}">손익 ${rec.be.toFixed(1)} · 우수 ${rec.goodR.toFixed(1)}↑</div>` : rec && rec.k !== 'watch' ? '<div style="font-size:.6rem;color:#c4c9d4;" title="카페24 상품과 이름이 안 맞아 고정 기준 사용">상품 미매칭</div>' : ''}</td>
        <td class="ctr" style="text-align:left;">${admgrFunnelCell(a, fbase)}</td>
        <td class="num"><b>${won(a.spend)}</b></td>
        <td class="num m-hide">${comma(a.purchases)}<div style="font-size:.62rem;color:#9ca3af;">${a.purchases ? won(Math.round(a.spend / a.purchases)) : '—'}</div></td>
        <td class="num">${admgrRoasTd(a)}${admgrSparkHtml(admgrTrend(a), rec && rec.be)}</td>
        <td class="ctr" style="white-space:nowrap;">${admgrAssetCell(a)}${a.meta.asset_req_at && !a.meta.asset_done_at ? `<div><a href="#" style="font-size:.62rem;" onclick="event.stopPropagation();admgrTestGoRegister('${esc(admgrProductOf(a))}');return false;"><i class="fa-solid fa-cloud-arrow-up"></i> 등록하러</a></div>` : ''}</td>
        <td class="m-hide ell" onclick="event.stopPropagation();admgrTestMemo(event,'${a.id}')" title="${a.meta.memo ? esc(a.meta.memo) + ' — 클릭해서 수정' : '클릭해서 메모'}" style="cursor:text;text-align:left;font-size:.7rem;color:${a.meta.memo ? '#374151' : '#c4c9d4'};">${a.meta.memo ? esc(a.meta.memo) : '메모…'}</td>
      </tr>`;
  };
  const head = `<colgroup><col style="width:28px;"><col><col style="width:64px;"><col style="width:132px;"><col style="width:120px;"><col style="width:88px;"><col class="m-hide" style="width:84px;"><col style="width:64px;"><col style="width:96px;"><col class="m-hide" style="width:110px;"></colgroup>
    <thead><tr>
      <th class="cb"><input type="checkbox" ${allChecked ? 'checked' : ''} onclick="admgrTestSelAll()" title="표시된 전체 선택/해제" /></th>
      ${admgrTh('aname', '소재 · 광고세트명').replace('<th class="sortable ', '<th style="text-align:left;" class="sortable ')}${admgrTh('reg', '등록')}<th class="ctr" title="▶ 추천 → 현재 상태 → 버튼으로 확정">판정</th>
      <th style="text-align:left;" title="노출→클릭→랜딩→장바구니→구매 단계 진단. 기준 = 노출 1,000↑ 테스트 소재 ${fbase.n}개의 중앙값 (CTR ${fbase.ctr != null ? (fbase.ctr * 100).toFixed(2) + '%' : '—'}${fbase.ts != null ? ' · 3초 ' + (fbase.ts * 100).toFixed(0) + '%' : ''}). 마우스를 올리면 숫자와 고칠 점">퍼널 <i class="fa-regular fa-circle-question" style="color:#c4c9d4;"></i></th>
      ${admgrTh('spend', '지출').replace('<th class="sortable ', '<th class="num sortable ')}${admgrTh('purchases', '구매 / CPA', 'm-hide').replace('<th class="sortable ', '<th class="num sortable ')}${admgrTh('roas', 'ROAS').replace('<th class="sortable ', '<th class="num sortable ')}
      <th class="ctr">추가소재</th><th class="m-hide" style="text-align:left;">메모</th>
    </tr></thead>`;
  let bodyHtml;
  if (t.group) {
    const groups = new Map();
    for (const a of rows) { const k = admgrProductOf(a); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
    const collapsed = t.collapsed || new Set();
    bodyHtml = [...groups.entries()].map(([k, list]) => {
      const spend = list.reduce((s0, a) => s0 + (a.spend || 0), 0), purch = list.reduce((s0, a) => s0 + (a.purchases || 0), 0), value = list.reduce((s0, a) => s0 + (a.value || 0), 0);
      const st = { eval: 0, good: 0, meh: 0, off: 0 }; list.forEach(a => { if (a.st in st) st[a.st]++; });
      const open = !collapsed.has(k);
      return `<tr style="background:#f8fafc;cursor:pointer;" onclick="admgrTestGroupCollapse('${esc(k)}')">
        <td class="ctr" style="color:#6b7280;"><i class="fa-solid fa-chevron-${open ? 'down' : 'right'}"></i></td>
        <td style="text-align:left;" class="ell"><b style="color:#1e1b4b;">${esc(k)}</b> <span style="font-size:.68rem;color:#6b7280;">${list.length}개 · 평가중 ${st.eval} · <span style="color:#22c55e;">우수 ${st.good}</span> · <span style="color:#f97316;">애매 ${st.meh}</span> · <span style="color:#ef4444;">OFF ${st.off}</span></span>
          <a href="#" style="font-size:.66rem;margin-left:8px;" onclick="event.stopPropagation();admgrTestGoRegister('${esc(k)}');return false;"><i class="fa-solid fa-cloud-arrow-up"></i> 소재 등록</a></td>
        <td></td><td></td><td></td>
        <td class="num"><b>${won(spend)}</b></td><td class="num m-hide">${comma(purch)}<div style="font-size:.62rem;color:#9ca3af;">${purch ? won(Math.round(spend / purch)) : '—'}</div></td>
        <td class="num"><b>${spend ? (value / spend).toFixed(2) : '—'}</b></td><td></td><td class="m-hide"></td></tr>` + (open ? list.map(rowHtml).join('') : '');
    }).join('');
  } else bodyHtml = rows.map(rowHtml).join('');
  const table = `<div class="table-wrap tt-compact" style="max-height:640px;overflow:auto;"><table>${head}<tbody>${bodyHtml}</tbody></table></div>
  <p class="m-hide" style="font-size:.75rem;color:#9ca3af;margin-top:8px;">썸네일·세트명 클릭 = 미리보기 · 행 클릭 = 선택(일괄 제거용) · 판정 열: <b>▶ 추천</b> 아래 [애매]/[우수] 버튼으로 확정(재클릭 = 해제) · 우수는 추가소재 요청 → "등록하러"로 이동</p>`;
  /* 폰(≤768px): 표는 CSS로 숨겨지므로 카드 목록을 같이 그린다 (광고세트 탭 .mcards와 같은 틀). 카드 = 썸네일·세트명·판정 버튼·지출/구매/ROAS, 더보기 = 추가소재·메모·문구 */
  let cards = '';
  if (admgrMobile()) {
    const card = a => {
      const checked = t.sel.has(a.id), dp = admgrDPlus(a), c = cre.get(String(a.id));
      const th = (t.thumbs || {})[a.id]; const thSrc = th && th !== '-' ? th : '';
      const rec = admgrRecommend(a);
      const recCls = rec ? (rec.k === 'off' ? 'badge-red' : rec.k === 'good' ? 'badge-green' : rec.k === 'wait' ? 'badge-yellow' : 'badge-gray') : '';
      const judge = `${rec ? `<span class="status-badge ${recCls}" title="${esc(rec.why)}">${rec.k === 'watch' ? '' : '▶ '}${rec.label}</span> ` : admgrTestBadge(a)}${rec || ['meh', 'good', 'ended'].includes(a.st) ? admgrVerdictBtns(a) : ''}${rec && rec.be ? `<span style="font-size:.62rem;color:#9ca3af;">손익 ${rec.be.toFixed(1)} · 우수 ${rec.goodR.toFixed(1)}↑</span>` : ''}`;
      return `<div class="mcard ${checked ? 'sel' : ''}">
        <div class="mc-top" onclick="showMetaPreview('${a.id}')" style="cursor:pointer;">
          <span style="flex:none;">${mediaThumbHtml(thSrc, 'image', 44)}</span>
          <div class="mc-name" style="flex:1;"><b>${esc(a.adset_name)}</b><div class="mc-sub">${a.reg_date ? fmtMD(a.reg_date) + (dp == null ? '' : ` · D+${dp}`) : ''}${c ? ` · <i class="fa-solid fa-cloud" style="color:#4f46e5;"></i> ${esc(admgrTagOf(c.file_name) || '소재')} · ${esc(whoName(c.created_by_name, c.created_by_email))}` : ''}</div></div>
          <div class="mc-tg" onclick="event.stopPropagation()"><label style="display:inline-flex;padding:4px;"><input type="checkbox" ${checked ? 'checked' : ''} onchange="admgrTestSel('${a.id}')" title="선택 (일괄 제거용)" /></label></div></div>
        <div class="mc-judge" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">${judge}</div>
        <div class="mc-nums"><div><i>지출</i>${won(a.spend)}</div><div><i>구매 · CPA</i>${comma(a.purchases)}<span style="font-size:.64rem;color:#9ca3af;font-weight:600;"> ${a.purchases ? won(Math.round(a.spend / a.purchases)) : ''}</span></div><div><i>ROAS</i>${admgrRoasTd(a)}</div></div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">${admgrFunnelCell(a, fbase)}${admgrSparkHtml(admgrTrend(a), rec && rec.be)}</div>
        <div class="mc-foot"><div class="mc-budget" style="font-size:.72rem;color:#6b7280;">${a.meta.memo ? `<i class="fa-regular fa-note-sticky"></i> ${esc(a.meta.memo)}` : `<span style="color:#9ca3af;">${a.meta.asset_req_at ? '추가소재 요청됨' : '탭하면 미리보기'}</span>`}</div>
          <div class="mc-btns"><button onclick="const c=this.closest('.mcard');c.classList.toggle('open');this.classList.toggle('on',c.classList.contains('open'))" title="더 보기"><i class="fa-solid fa-chevron-down"></i></button></div></div>
        <div class="mc-more">
          <div class="row"><span>추가소재</span><span>${admgrAssetCell(a)}</span></div>
          ${a.meta.asset_req_at && !a.meta.asset_done_at ? `<div class="row"><span></span><span><a class="drill" href="#" onclick="admgrTestGoRegister('${esc(admgrProductOf(a))}');return false;"><i class="fa-solid fa-cloud-arrow-up"></i> 소재 등록하러 →</a></span></div>` : ''}
          <div class="row"><span>메모</span><span onclick="admgrTestMemo(event,'${a.id}')" style="cursor:text;color:${a.meta.memo ? '#374151' : '#c4c9d4'};">${a.meta.memo ? esc(a.meta.memo) : '탭해서 메모…'}</span></div>
          <div class="row"><span>광고명</span><span style="font-size:.7rem;color:#6b7280;">${esc(a.name)}</span></div>
          ${c ? `<div class="row"><span>문구</span><span><a class="drill" href="#" onclick="admgrTestCopy('${a.id}');return false;">보기·수정 →</a></span></div>` : ''}
        </div></div>`;
    };
    let inner;
    if (t.group) {
      const groups = new Map();
      for (const a of rows) { const k = admgrProductOf(a); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
      const collapsed = t.collapsed || new Set();
      inner = [...groups.entries()].map(([k, list]) => { const open = !collapsed.has(k); const spend = list.reduce((s0, a) => s0 + (a.spend || 0), 0);
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 4px 6px;font-size:.8rem;" onclick="admgrTestGroupCollapse('${esc(k)}')"><i class="fa-solid fa-chevron-${open ? 'down' : 'right'}" style="color:#6b7280;"></i><b style="color:#1e1b4b;">${esc(k)}</b><span style="color:#6b7280;font-size:.7rem;">${list.length}개 · ${won(spend)}</span></div>` + (open ? list.map(card).join('') : ''); }).join('');
    } else inner = rows.map(card).join('');
    cards = `<div class="mcards">${inner}<p style="font-size:.7rem;color:#9ca3af;margin-top:6px;">카드 위쪽 탭 = 미리보기 · 체크 = 선택(일괄 제거) · [애매]/[우수] 재탭 = 해제 · ∨ = 추가소재·메모·문구</p></div>`;
  }
  return ctrl + tiles + table + cards;
}

/* ═══ 기존광고 중 OFF 탭 (3단계 — 원본 admgrOff* 이식) ═══
   기간 내 OFF로 바뀐 광고세트(테스트 세트 제외) + 등록 이후 누적 성과. 세트 스위치를 직접 끈 것 기준(활동 로그 약 90일). */
function admgrOffDates() {
  const o = admgr.offad;
  if (!o.end) o.end = todayStr(0);
  if (!o.start) o.start = todayStr(-6);
  return o;
}
async function admgrOffFetch() {
  const o = admgrOffDates();
  if (o.loading) return;
  if (!admgrCfg() || admgr.demo) { renderAdmgr(); return; }
  if (o.start > o.end) { toast('시작일이 종료일보다 늦어요'); return; }
  o.loading = true; renderAdmgr();
  try {
    o.data = await metaGet({ action: 'offsets', start_date: o.start, end_date: o.end });
    o.loaded = true;
    lsSet('adc_admgr_off', { data: o.data, start: o.start, end: o.end });
  } catch (e) { toast('조회 실패: ' + e.message); }
  o.loading = false; renderAdmgr();
}
function admgrOffSetDate(which, v) { admgr.offad[which] = v; }
function admgrOffPreset(days) { const o = admgr.offad; o.end = todayStr(0); o.start = todayStr(-(days - 1)); admgrOffFetch(); }
function admgrOffDay(offset) { const o = admgr.offad; o.start = o.end = todayStr(offset); admgrOffFetch(); }
function renderAdmgrOff() {
  const o = admgrOffDates();
  if (!admgrCfg() || admgr.demo) {
    return `<div class="empty-state"><div class="es-icon"><i class="fa-solid fa-power-off"></i></div>
      <p>실제 Meta 연동 후에 기간 내 <b>OFF로 바뀐 광고세트</b>를 모아 보여줘요 (데모 모드에서는 제공되지 않아요).</p></div>`;
  }
  const chip = (label, fn) => `<button class="filter-tab" onclick="${fn}">${label}</button>`;
  const ctrl = `<div class="control-bar" style="margin-bottom:14px;padding:10px 14px;">
    <label>OFF 전환 기간</label>
    <input type="date" value="${o.start}" onchange="admgrOffSetDate('start',this.value)" />
    <span class="date-sep">~</span>
    <input type="date" value="${o.end}" onchange="admgrOffSetDate('end',this.value)" />
    <button class="btn-analyze" style="padding:7px 16px;" onclick="admgrOffFetch()">조회</button>
    <span class="filter-tabs" style="margin:0;">${chip('오늘', 'admgrOffDay(0)')}${chip('어제', 'admgrOffDay(-1)')}${chip('최근 7일', 'admgrOffPreset(7)')}${chip('최근 14일', 'admgrOffPreset(14)')}${chip('최근 30일', 'admgrOffPreset(30)')}</span>
  </div>`;
  if (!o.loaded) {
    return ctrl + `<div class="empty-state"><p>${o.loading ? '기간 내 OFF된 광고세트를 찾는 중…' : '기간을 정하고 조회를 눌러주세요.'}</p></div>`;
  }
  const d = o.data;
  let rows = (d.sets || []).slice();
  if (admgr.q) rows = rows.filter(s0 => s0.name.toLowerCase().includes(admgr.q));
  rows.sort((a, b) => admgr.sort.length ? admgrCmp(a, b) : String(b.off_time).localeCompare(String(a.off_time)));   // 기본: 최근 OFF 순

  const tSpend = rows.reduce((s0, r) => s0 + r.spend, 0);
  const tPur = rows.reduce((s0, r) => s0 + r.purchases, 0);
  const tVal = rows.reduce((s0, r) => s0 + r.value, 0);
  const info = `<div class="info-bar"><i class="fa-regular fa-clock"></i> ${d.period.start} ~ ${d.period.end} OFF 전환 · 성과는 등록 이후 누적 · ${admgrAgo(d.fetched_at)} 기준${d.truncated ? ' · 일부 생략(200개 한도)' : ''} · 테스트 세트 제외, 세트를 직접 끈 것 기준(캠페인 통째 OFF는 안 잡힘)</div>`;
  const tiles = `<div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:14px;">
    ${admgrTile('기간 내 OFF 세트', rows.length + '개')}${admgrTile('누적 지출 (합)', won(tSpend))}${admgrTile('구매 (합)', comma(tPur) + '건')}
    ${admgrTile('구매당 비용 (합산)', tPur > 0 ? won(tSpend / tPur) : '—')}${admgrTile('ROAS (합산)', tSpend > 0 ? (tVal / tSpend).toFixed(2) : '—')}
  </div>`;
  if (!rows.length) {
    return ctrl + info + tiles + `<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-folder-open"></i></div><p>${admgr.q ? '검색 결과가 없어요.' : '이 기간에 OFF로 바뀐 광고세트가 없어요.'}</p></div>`;
  }
  const table = `<div class="table-wrap" style="max-height:640px;overflow:auto;"><table>
    <thead><tr>
      ${admgrTh('name', '광고세트명')}${admgrTh('reg', '등록일', 'm-hide')}${admgrTh('offd', 'OFF일')}
      ${admgrTh('spend', '누적 지출')}${admgrTh('purchases', '구매', 'm-hide')}${admgrTh('cpa', '구매당 비용', 'm-hide')}${admgrTh('roas', 'ROAS')}
    </tr></thead><tbody>${rows.map(s0 => {
      const offHm = s0.off_time ? new Date(s0.off_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }) : '';
      return `<tr>
        <td class="name-cell" style="text-align:left;"><b>${esc(s0.name)}</b>
          ${s0.reactivated ? ' <span class="status-badge badge-green" style="margin-left:4px;">현재 다시 켜짐</span>' : ''}</td>
        <td class="m-hide" style="white-space:nowrap;">${s0.reg_date || '—'}</td>
        <td style="white-space:nowrap;" title="${offHm ? 'OFF 시각 ' + offHm : ''}">${s0.off_date || '—'}<div style="font-size:.62rem;color:#9ca3af;">${offHm}</div></td>
        <td><b>${won(s0.spend)}</b></td>
        <td class="m-hide">${comma(s0.purchases)}</td>
        <td class="m-hide">${admgrCpa(s0)}</td>
        <td>${admgrRoasTd(s0)}</td></tr>`; }).join('')}</tbody></table></div>`;
  const cards = admgrMobile() ? `<div class="mcards">${rows.map(s0 => {
    const offHm = s0.off_time ? new Date(s0.off_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }) : '';
    return `<div class="mcard">
      <div class="mc-top"><div class="mc-name"><b>${esc(s0.name)}</b><div class="mc-sub">등록 ${s0.reg_date || '—'} · OFF ${s0.off_date || '—'} ${offHm}</div></div>
        ${s0.reactivated ? '<span class="status-badge badge-green" style="flex:none;">다시 켜짐</span>' : ''}</div>
      <div class="mc-nums"><div><i>누적 지출</i>${won(s0.spend)}</div><div><i>구매 · CPA</i>${comma(s0.purchases)}<span style="font-size:.64rem;color:#9ca3af;font-weight:600;"> ${s0.purchases ? admgrCpa(s0) : ''}</span></div><div><i>ROAS</i>${admgrRoasTd(s0)}</div></div>
    </div>`; }).join('')}</div>` : '';
  return ctrl + info + tiles + table + cards;
}

/* ═══ 베스트소재 탭 (3단계 — 원본 admgrBest* 이식) ═══
   광고세트 탭에서 세트 체크 → '베스트소재로' → best_ads 테이블에 저장 → 소재 썸네일 격자(인스타 돋보기식). 타일 클릭 = 미리보기. */
async function admgrBestAdd() {
  const ids = [...admgr.selSets];
  if (!ids.length) { toast('먼저 광고세트를 체크하세요'); return; }
  const byId = new Map(admgrRows().sets.map(s0 => [s0.id, s0]));
  const rows = ids.map(id => ({ adset_id: id, adset_name: (byId.get(id) || {}).name || '', added_by: ADMGR_USER }));
  try {
    await metaPost({ action: 'best_add' }, rows);
    toast(`${ids.length}개 세트를 베스트소재에 담았어요`);
    admgr.selSets.clear();
    admgr.best.loaded = false;   // 다음 진입 때 새로 조회
    admgrSetView('best');
  } catch (e) { toast('저장 실패: ' + e.message); }
}
async function admgrBestFetch() {
  const b = admgr.best;
  if (b.loading) return;
  if (!admgrCfg() || admgr.demo) { renderAdmgr(); return; }
  b.loading = true; renderAdmgr();
  try {
    const rows = await metaGet({ action: 'best_list' });
    b.rows = Array.isArray(rows) ? rows : [];
    b.ads = b.rows.length
      ? ((await metaGet({ action: 'creatives', set_ids: b.rows.map(r => r.adset_id).join(',') })).ads || [])
      : [];
    b.loaded = true;
    lsSet('adc_admgr_best', { rows: b.rows, ads: b.ads });
  } catch (e) { toast('조회 실패: ' + e.message); }
  b.loading = false; renderAdmgr();
}
async function admgrBestRemove(setId) {
  if (!confirm('이 세트를 베스트소재에서 뺄까요? (Meta 광고는 그대로예요)')) return;
  try {
    await metaPost({ action: 'best_del' }, { adset_id: setId });
    const b = admgr.best;
    b.rows = (b.rows || []).filter(r => r.adset_id !== setId);
    b.ads = (b.ads || []).filter(a => a.adset_id !== setId);
    renderAdmgr();
  } catch (e) { toast('삭제 실패: ' + e.message); }
}
/* ═══ 순이익 기준 베스트 (2026-09-12) — ROAS가 아니라 "광고비 대비 순이익"으로 등급.
   순이익 = 전환값 × 마진율(판매가−공급가×1.1 ÷ 판매가) × (1 − 순반품률) − 지출. 순반품률은 판매 성과의 netreturns(최근 60일, 배송완료 기준),
   배송완료 10개 미만 상품은 몰 평균으로. 판매 성과 권한(관리자)이 있어야 반품률을 받는다 — 마케터 화면엔 등급이 안 붙는다. */
const ADMGR_GRADE = { S: ['#16a34a', '순이익이 광고비 이상'], A: ['#2563eb', '순이익이 광고비의 절반 이상'], B: ['#d97706', '순이익 0 이상'], C: ['#dc2626', '광고비를 못 건짐'] };
async function admgrProfitEnsure() {
  const b = admgr.best, today = todayStr(0);
  if (admgr.demo || b.nrLoading || (b.nrDay === today && b.nr) || !admgrCfg()) return;
  if (typeof authIsAdmin === 'function' && !authIsAdmin()) return;
  b.nrLoading = true;
  try {
    const r = await perfApi({ action: 'netreturns', start_date: admgrShiftDay(today, -60), end_date: today });
    b.nr = new Map((r.rows || []).map(x => [x.product_no, x])); b.nrTotal = r.totals ? r.totals.net_return_rate : null; b.nrDay = today;
    renderAdmgr(true);
  } catch (e) { b.nr = new Map(); b.nrTotal = null; b.nrDay = today; }   // 권한 없음·카페24 오류 → 반품 0으로 계산하지 않고 등급 생략
  b.nrLoading = false;
}
function admgrProfit(setName, m) {   // null = 상품 못 찾음·반품률 아직 없음. { net, roi, grade, mr, rr, rrSrc, beRoas, product }
  const b = admgr.best;
  if (!b.nrDay || !b.nr || !m) return null;
  const n = admgrNorm(setName), p = admgrProdIdx().find(p => n.includes(p.n));
  if (!p || !(p.price > 0)) return null;
  const margin = p.price - (p.supply || 0) * 1.1; if (!(margin > 0)) return null;
  const mr = margin / p.price;
  const row = p.no != null ? b.nr.get(p.no) : null, own = row && row.total_qty >= 10;
  const rr = own ? row.net_return_rate / 100 : b.nrTotal != null ? b.nrTotal / 100 : null;
  if (rr == null) return null;
  const net = m.value * mr * (1 - rr) - m.spend, roi = m.spend > 0 ? net / m.spend : 0;
  return { net, roi, grade: m.spend > 0 ? (roi >= 1 ? 'S' : roi >= 0.5 ? 'A' : roi >= 0 ? 'B' : 'C') : null, mr, rr, rrSrc: own ? `상품 반품률 (배송완료 ${comma(row.total_qty)}개)` : '몰 평균 반품률 (이 상품 배송완료 10개 미만)', beRoas: 1 / (mr * (1 - rr)), product: p.name };
}
function admgrGradeBadge(pf, size) {
  if (!pf || !pf.grade) return '';
  const [c, why] = ADMGR_GRADE[pf.grade];
  return `<span title="${esc(why)} — 순이익 ${won(Math.round(pf.net))} (마진율 ${(pf.mr * 100).toFixed(0)}% · 반품 ${(pf.rr * 100).toFixed(1)}% ${esc(pf.rrSrc)} · 손익 ROAS ${pf.beRoas.toFixed(2)})" style="display:inline-block;min-width:${size || 18}px;text-align:center;font-size:${size ? size * .6 : 11}px;font-weight:800;padding:1px 5px;border-radius:6px;background:${c};color:#fff;cursor:help;">${pf.grade}</span>`;
}

/* ── 베스트 소재: 성과 숫자(테스트 소재 누적 데이터) · 상품별 묶기 · 정렬/필터 · 타일 버튼(모델 광고·문구 복사·소재 등록) ── */
function admgrBestMetric(a) {   // 누적 성과: 테스트 소재 데이터(광고 id) → 없으면 광고관리자 기간 데이터(세트 id)
  const t = admgr.test;
  const ta = t.loaded ? ((t.data || {}).ads || []).find(x => x.id === a.id) : null;
  if (ta) return { spend: ta.spend || 0, purchases: ta.purchases || 0, value: ta.value || 0, reg: ta.reg_date || '', src: '누적' };
  const st = (admgr.data ? admgrRows().sets : []).find(x => x.id === a.adset_id);
  if (st) return { spend: st.spend || 0, purchases: st.purchases || 0, value: st.value || 0, reg: (st.created || '').slice(0, 10), src: '기간' };
  return null;
}
function admgrBestSet(k, v) { admgr.best[k] = v; lsSet('adc_admgr_best_ui', { sort: admgr.best.sort, hideOff: admgr.best.hideOff }); renderAdmgr(true); }
async function admgrBestCopyText(adId) {
  const c = admgr.test.creatives && admgr.test.creatives.get(String(adId));
  let msg = c && c.text && c.text.message;
  if (!msg) { try { msg = (await uplCall({ action: 'model', ad_id: adId })).text.message; } catch (e) { toast('문구를 가져오지 못했어요: ' + e.message); return; } }
  try { await navigator.clipboard.writeText(msg); } catch (e) { const ta = document.createElement('textarea'); ta.value = msg; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast('광고 문구를 복사했어요');
}
function admgrBestUseModel(adId) {   // 광고 업로드 ① 모델 광고로
  showMenu('upload');
  if (typeof uplPickAd === 'function') uplPickAd(String(adId));
  toast('이 소재를 모델 광고로 잡았어요 — ② 소재를 확인하고 ③에서 생성하세요');
}
function renderAdmgrBest() {
  const b = admgr.best;
  if (b.sort === undefined) { const ui = lsGet('adc_admgr_best_ui', null) || {}; b.sort = ui.sort || 'roas'; b.hideOff = !!ui.hideOff; b.prod = 'all'; }
  if (!admgrCfg() || admgr.demo) {
    return `<div class="empty-state"><div class="es-icon"><i class="fa-solid fa-star"></i></div>
      <p>실제 Meta 연동 후, <b>광고세트</b> 탭에서 세트를 체크해 <b>베스트소재로</b>를 누르면 여기에 모여요.</p></div>`;
  }
  if (!b.loaded) return `<div class="empty-state"><p>${b.loading ? '베스트소재를 불러오는 중…' : '<b>새로고침</b>을 누르면 베스트소재를 불러와요.'}</p></div>`;
  if (!(b.rows || []).length) {
    return `<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-images"></i></div>
      <p>아직 담은 소재가 없어요.<br/><b>광고세트</b> 탭에서 세트를 체크해 <b>베스트소재로</b>를 누르면 담겨요.</p>
      <button class="filter-tab" style="color:#4f46e5;border-color:#c7d2fe;margin-top:8px;" onclick="admgrBestReport()"><i class="fa-solid fa-clipboard-list"></i> 주간 리포트 (테스트 효율만)</button></div>`;
  }
  // 성과·등록 기록은 테스트 소재 데이터에서 — 아직 없으면 조용히 불러온다
  if (!admgr.test.loaded && !admgr.test.loading) setTimeout(() => admgrTestFetch(), 0);
  setTimeout(() => admgrTestCreativesEnsure(), 0);
  const nameOf = new Map(b.rows.map(r => [r.adset_id, r.adset_name]));
  const cre = admgr.test.creatives || new Map();
  const testAds = admgr.test.loaded ? ((admgr.test.data || {}).ads || []) : [];
  if (admgr.test.loaded) setTimeout(() => admgrTrendEnsure(), 0);
  if (!admgr.products && !admgr.productsLoading) admgrLoadProducts();
  setTimeout(() => admgrProfitEnsure(), 0);
  let ads = (b.ads || []).map(a => { const m = admgrBestMetric(a) || { spend: 0, purchases: 0, value: 0, reg: '', src: '' }; const ta = testAds.find(x => x.id === a.id); return { ...a, m, roas: m.spend ? m.value / m.spend : 0, setNm: nameOf.get(a.adset_id) || '', prod: admgrProductOf({ adset_name: nameOf.get(a.adset_id) || a.name }), c: cre.get(String(a.id)), tr: ta ? admgrTrend(ta) : null, pf: admgrProfit(nameOf.get(a.adset_id) || a.name, m) }; });
  if (admgr.q) ads = ads.filter(a => (a.setNm + ' ' + a.name).toLowerCase().includes(admgr.q));
  const allAds = ads;
  const prods = [...new Set(ads.map(a => a.prod))];
  if (b.hideOff) ads = ads.filter(a => a.effective_status === 'ACTIVE');
  if (b.prod && b.prod !== 'all') ads = ads.filter(a => a.prod === b.prod);
  ads.sort((x, y) => b.sort === 'spend' ? y.m.spend - x.m.spend : b.sort === 'recent' ? String(y.m.reg).localeCompare(String(x.m.reg)) : b.sort === 'profit' ? ((y.pf ? y.pf.net : -Infinity) - (x.pf ? x.pf.net : -Infinity)) : y.roas - x.roas);
  const pfAds = allAds.filter(a => a.pf), pfSum = pfAds.reduce((s0, a) => s0 + a.pf.net, 0);
  const pfNote = b.nrDay ? (pfAds.length ? '' : ' (상품 매칭 없음)') : (typeof authIsAdmin === 'function' && !authIsAdmin()) ? ' (관리자만)' : ' (반품률 불러오는 중…)';
  const rank = new Map([...allAds].sort((x, y) => y.roas - x.roas).map((a, k) => [a.id, k + 1]));
  const sum = list => list.reduce((o, a) => ({ spend: o.spend + a.m.spend, purchases: o.purchases + a.m.purchases, value: o.value + a.m.value }), { spend: 0, purchases: 0, value: 0 });
  const tot = sum(allAds), off = allAds.filter(a => a.effective_status !== 'ACTIVE').length;
  const metricsReady = admgr.test.loaded;

  const chip = (on, label, onclick) => `<button class="filter-tab ${on ? 'active' : ''}" onclick="${onclick}">${label}</button>`;
  const sw = (on, label, onclick, title) => `<button class="filter-tab" style="display:inline-flex;align-items:center;gap:6px;${on ? 'color:#3730a3;border-color:#a5b4fc;' : ''}" onclick="${onclick}" title="${title || ''}"><span style="width:26px;height:14px;border-radius:999px;background:${on ? '#4f46e5' : '#d1d5db'};position:relative;display:inline-block;"><span style="position:absolute;top:2px;${on ? 'right:2px' : 'left:2px'};width:10px;height:10px;border-radius:50%;background:#fff;"></span></span>${label}</button>`;
  const ctrl = `<div class="filter-tabs m-wrap" style="margin-bottom:10px;">
    ${chip(b.sort === 'roas', 'ROAS순', "admgrBestSet('sort','roas')")}${chip(b.sort === 'profit', '순이익순', "admgrBestSet('sort','profit')")}${chip(b.sort === 'spend', '지출순', "admgrBestSet('sort','spend')")}${chip(b.sort === 'recent', '최근순', "admgrBestSet('sort','recent')")}
    <span style="width:1px;height:22px;background:#e5e7eb;margin:0 4px;"></span>
    ${chip(b.prod === 'all', `전체 ${allAds.length}`, "admgrBestSet('prod','all')")}${prods.map(pn => chip(b.prod === pn, `${esc(pn)} ${allAds.filter(a => a.prod === pn).length}`, `admgrBestSet('prod','${esc(pn)}')`)).join('')}
    <span style="flex:1;"></span>
    ${sw(b.hideOff, '꺼진 소재 숨기기', `admgrBestSet('hideOff',${!b.hideOff})`)}
    <button class="filter-tab" style="color:#4f46e5;border-color:#c7d2fe;" onclick="admgrBestReport()" title="회의용 — 이번 기간 베스트 성과·전주 대비·패턴(릴스/이미지·소구점·가격대)·상품 판단·테스트 효율·다음 주 액션 (텍스트 복사·PDF)"><i class="fa-solid fa-clipboard-list"></i> 주간 리포트</button>
  </div>
  <div class="info-bar"><i class="fa-solid fa-star"></i> 담은 세트 ${b.rows.length}개 · 소재 ${allAds.length}개 · 성과는 <b>등록 이후 누적</b>${metricsReady ? '' : ' (불러오는 중…)'} · 타일 클릭 = 큰 미리보기 · 상품 제목의 ✕ = 세트 빼기</div>`;
  const tiles = `<div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:14px;">
    <div class="kpi-tile kt-hero"><div class="kt-label"><i class="fa-solid fa-star"></i> 베스트 소재</div><div class="kt-value" style="font-size:1.15rem;">${allAds.length}개</div><div class="kt-sub">상품 ${prods.length}개</div></div>
    ${admgrTile('누적 지출', metricsReady ? won(tot.spend) : '…')}${admgrTile('구매', metricsReady ? comma(tot.purchases) + '건' : '…')}
    ${admgrTile('평균 ROAS', metricsReady ? `<span style="color:#15803d;">${tot.spend ? (tot.value / tot.spend).toFixed(2) : '—'}</span>` : '…')}
    ${admgrTile('순이익 합 <span title="전환값 × 마진율 × (1 − 순반품률) − 지출. 반품률은 판매 성과 최근 60일 배송완료 기준, 등급 S=순이익≥광고비 · A=≥50% · B=≥0 · C=손실" style="color:#c4c9d4;cursor:help;">?</span>', pfAds.length ? `<span style="color:${pfSum >= 0 ? '#15803d' : '#dc2626'};">${pfSum >= 0 ? '+' : ''}${won(Math.round(pfSum))}</span>` : `<span style="font-size:.8rem;color:#9ca3af;">—${pfNote}</span>`)}
    ${admgrTile('꺼진 소재', `<span style="color:${off ? '#dc2626' : '#374151'};">${off}개</span>`)}
    ${admgrTile('식은 소재 <span title="최근 7일 ROAS가 누적의 절반 미만 (일별 스냅샷 3일치부터 판정)" style="color:#c4c9d4;cursor:help;">?</span>', `<span style="color:${allAds.filter(a => a.tr && a.tr.tired).length ? '#dc2626' : '#374151'};">${allAds.filter(a => a.tr && a.tr.tired).length}개</span>`)}
  </div>`;

  const tile = a => {
    const src = a.image || a.thumb, offed = a.effective_status !== 'ACTIVE', r = rank.get(a.id);
    return `<div class="cre-tile" style="aspect-ratio:auto;display:flex;flex-direction:column;${offed ? 'opacity:.7;' : ''}">
      <div style="position:relative;aspect-ratio:9/16;max-height:250px;overflow:hidden;cursor:zoom-in;background:#f3f4f6;" onclick="showMetaPreview('${a.id}')" title="${esc(a.name)} — 클릭하면 크게">
        ${src ? `<img src="${esc(src)}" loading="lazy" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" />` : `<div class="ct-ph"><i class="fa-regular fa-image"></i></div>`}
        <span class="status-badge ${offed ? 'badge-red' : 'badge-green'}" style="position:absolute;top:8px;left:8px;font-size:.62rem;">${offed ? '꺼짐' : '우수'}</span>
        ${r ? `<span style="position:absolute;top:8px;right:8px;font-size:.62rem;font-weight:800;padding:2px 7px;border-radius:999px;background:#111827cc;color:#fff;">#${r}</span>` : ''}
        ${a.pf && a.pf.grade ? `<span style="position:absolute;bottom:8px;right:8px;">${admgrGradeBadge(a.pf, 22)}</span>` : ''}
        ${a.is_video ? '<div class="ct-play"><i class="fa-solid fa-play"></i></div>' : ''}
      </div>
      <div style="padding:8px 10px;">
        <div class="ell" style="font-size:.76rem;font-weight:700;color:#1e1b4b;" title="${esc(a.setNm)}">${esc(a.setNm)}</div>
        <div class="ell" style="font-size:.64rem;color:#6b7280;">${a.c ? `<i class="fa-solid fa-cloud" style="color:#4f46e5;"></i> ${esc(admgrTagOf(a.c.file_name) || '소재')} · ${esc(whoName(a.c.created_by_name, a.c.created_by_email))} · ` : ''}${a.m.reg ? fmtMD(a.m.reg) + (admgrDPlus({ reg_date: a.m.reg }) != null ? ` (D+${admgrDPlus({ reg_date: a.m.reg })})` : '') : ''}</div>
        <div style="display:flex;gap:10px;margin-top:6px;font-size:.66rem;color:#6b7280;">
          <span>지출<b style="display:block;font-size:.8rem;color:#1e1b4b;">${metricsReady ? won(a.m.spend) : '…'}</b></span>
          <span>구매<b style="display:block;font-size:.8rem;color:#1e1b4b;">${metricsReady ? comma(a.m.purchases) : '…'}</b></span>
          <span>ROAS<b style="display:block;font-size:.8rem;color:#15803d;">${metricsReady ? (a.m.spend ? a.roas.toFixed(2) : '—') : '…'}</b></span></div>
        ${a.tr ? `<div style="margin-top:4px;">${admgrSparkHtml(a.tr, null)}</div>` : ''}
        ${a.pf ? `<div style="margin-top:4px;font-size:.64rem;color:#6b7280;white-space:nowrap;" title="${esc(a.pf.rrSrc)} · 손익분기 ROAS ${a.pf.beRoas.toFixed(2)}">순이익 <b style="color:${a.pf.net >= 0 ? '#15803d' : '#dc2626'};">${a.pf.net >= 0 ? '+' : ''}${won(Math.round(a.pf.net))}</b> · 마진 ${(a.pf.mr * 100).toFixed(0)}% · 반품 ${(a.pf.rr * 100).toFixed(1)}%</div>` : ''}
        <div style="display:flex;gap:4px;margin-top:8px;">
          <button class="btn-ghost" style="flex:1;padding:4px 4px;font-size:.64rem;background:#eef2ff;border-color:#c7d2fe;color:#3730a3;font-weight:700;" onclick="admgrBestUseModel('${a.id}')" title="광고 업로드 ①에 이 소재를 모델 광고로">모델 광고로</button>
          <button class="btn-ghost" style="flex:1;padding:4px 4px;font-size:.64rem;" onclick="admgrBestCopyText('${a.id}')" title="이 광고의 본문 문구를 복사">문구 복사</button>
          <button class="btn-ghost" style="flex:1;padding:4px 4px;font-size:.64rem;" onclick="admgrTestGoRegister('${esc(a.prod)}')" title="같은 상품으로 소재 등록">소재 등록</button></div>
      </div></div>`;
  };
  const groups = new Map();
  for (const a of ads) { if (!groups.has(a.prod)) groups.set(a.prod, []); groups.get(a.prod).push(a); }
  const body = [...groups.entries()].map(([pn, list]) => {
    const g = sum(list), sets = [...new Set(list.map(a => a.adset_id))];
    return `<div style="margin-bottom:18px;">
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f8fafc;border:1px solid #e7e8ee;border-radius:10px;margin-bottom:10px;font-size:.8rem;flex-wrap:wrap;">
        <b style="color:#1e1b4b;">${esc(pn)}</b>
        <span style="color:#6b7280;font-size:.72rem;">소재 ${list.length}개${metricsReady ? ` · 지출 ${won(g.spend)} · 구매 ${comma(g.purchases)} · ROAS <b style="color:#15803d;">${g.spend ? (g.value / g.spend).toFixed(2) : '—'}</b>` : ''}${list.some(a => a.pf) ? ` · 순이익 <b style="color:${list.reduce((s0, a) => s0 + (a.pf ? a.pf.net : 0), 0) >= 0 ? '#15803d' : '#dc2626'};">${won(Math.round(list.reduce((s0, a) => s0 + (a.pf ? a.pf.net : 0), 0)))}</b>` : ''}</span>
        <span style="flex:1;"></span>
        <a href="#" style="font-size:.72rem;" onclick="admgrTestGoRegister('${esc(pn)}');return false;"><i class="fa-solid fa-cloud-arrow-up"></i> 같은 상품 소재 등록</a>
        ${sets.map(id => `<button class="btn-ghost btn-danger-ghost" style="padding:2px 8px;font-size:.64rem;" onclick="admgrBestRemove('${id}')" title="${esc(nameOf.get(id) || '')} 세트를 베스트에서 빼기"><i class="fa-solid fa-xmark"></i></button>`).join('')}</div>
      <div class="cre-grid" style="grid-template-columns:repeat(auto-fill,minmax(196px,1fr));">${list.map(tile).join('')}</div></div>`;
  }).join('');
  return ctrl + tiles + (body || `<div class="empty-state"><p>${admgr.q ? '검색 결과가 없어요.' : '조건에 맞는 소재가 없어요.'}</p></div>`);
}

/* 미리보기 하단: 광고 문구(복사) + 모델 광고로 / 같은 상품 소재 등록 */
async function admgrPreviewExtra(adId) {
  const box = $('ap-extra'); if (!box || admgr.demo) return;
  const ta = ((admgr.test.data || {}).ads || []).find(x => x.id === adId) || ((admgr.best.ads || []).find(x => x.id === adId));
  const prod = ta ? admgrProductOf({ adset_name: ta.adset_name || (new Map((admgr.best.rows || []).map(r => [r.adset_id, r.adset_name]))).get(ta.adset_id) || ta.name }) : '';
  box.innerHTML = `<div style="display:flex;gap:6px;margin-top:10px;">
      <button class="btn-analyze" style="padding:6px 12px;font-size:.74rem;" onclick="closeModal('admgr-preview');admgrBestUseModel('${adId}')"><i class="fa-solid fa-cloud-arrow-up"></i> 이 소재를 모델 광고로</button>
      <button class="btn-ghost" style="padding:6px 12px;font-size:.74rem;" onclick="admgrBestCopyText('${adId}')"><i class="fa-regular fa-copy"></i> 문구 복사</button>
      ${prod ? `<button class="btn-ghost" style="padding:6px 12px;font-size:.74rem;" onclick="closeModal('admgr-preview');admgrTestGoRegister('${esc(prod)}')"><i class="fa-solid fa-upload"></i> 같은 상품 소재 등록</button>` : ''}</div>
    <div id="ap-copy" style="margin-top:10px;font-size:.76rem;line-height:1.6;white-space:pre-line;background:#f8fafc;border:1px solid #e7e8ee;border-radius:10px;padding:10px 12px;color:#374151;max-height:220px;overflow:auto;text-align:left;">문구 불러오는 중…</div>`;
  let msg = '';
  const c = admgr.test.creatives && admgr.test.creatives.get(String(adId));
  if (c && c.text && c.text.message) msg = c.text.message;
  else if (typeof uplCall === 'function' && typeof authIsAdmin === 'function' && authIsAdmin()) { try { msg = (await uplCall({ action: 'model', ad_id: adId })).text.message || ''; } catch (e) { msg = ''; } }
  const el = $('ap-copy'); if (el && apCur.id === adId) el.textContent = msg || '문구를 가져오지 못했어요';
}

/* ── 소재 미리보기 (원본 showMetaPreview — iframe + 형식 전환(피드/릴스/스토리) + 기간 7종 성과 차트) ── */
const apCur = { id: null, fmt: 'feed' };
const AP_FMTS = [['feed', '피드'], ['reels', '릴스'], ['story', '스토리']];
async function showMetaPreview(adId, fmt) {
  const sameAd = apCur.id === adId;          // 형식만 바꿀 때는 성과를 다시 조회하지 않는다
  apCur.id = adId; apCur.fmt = fmt || 'feed';
  const myFmt = apCur.fmt;
  $('admgr-preview').classList.add('show');
  if (!sameAd) { $('ap-title').textContent = '소재 미리보기'; $('ap-stats').innerHTML = ''; if ($('ap-extra')) { $('ap-extra').innerHTML = ''; admgrPreviewExtra(adId); } }
  $('ap-fmt').innerHTML = AP_FMTS.map(([k, l]) =>
    `<button class="filter-tab ${myFmt === k ? 'active' : ''}" style="padding:4px 12px;font-size:.75rem;" onclick="showMetaPreview('${adId}','${k}')">${l}</button>`).join('')
    + '<span style="font-size:.7rem;color:#9ca3af;margin-left:4px;">미리보기 형식</span>';
  if (admgr.demo) {
    $('ap-body').innerHTML = `<div class="empty-state" style="padding:32px;">
      <div class="es-icon"><i class="fa-regular fa-image"></i></div>
      <p>데모 모드에서는 미리보기가 없어요.<br/>실제 Meta 연동 후에는 이 자리에 인스타 게재 형태 그대로 나옵니다.</p></div>`;
    return;
  }
  $('ap-body').innerHTML = `<p style="padding:40px 0;color:#9ca3af;font-size:.82rem;">불러오는 중…</p>`;
  /* 미리보기와 기간별 성과를 병렬로 — 하나가 실패해도 나머지는 표시 (원본 방식) */
  metaGet({ action: 'preview', ad_id: adId, fmt: myFmt }).then(prev => {
    if (apCur.id !== adId || apCur.fmt !== myFmt) return;   // 그 사이 다른 소재·형식으로 바뀜
    $('ap-title').textContent = prev.name || '소재 미리보기';
    $('ap-body').innerHTML = prev.iframe || (prev.thumbnail
      ? `<img src="${esc(prev.thumbnail)}" style="max-width:100%;border-radius:10px;" />`
      : '<p style="padding:30px 0;color:#9ca3af;">미리보기를 가져오지 못했어요.</p>');
    const ifr = $('ap-body').querySelector('iframe');
    if (ifr) { ifr.style.maxWidth = '100%'; ifr.style.border = 'none'; }
  }).catch(e => {
    if (apCur.id === adId) $('ap-body').innerHTML = `<p style="padding:30px 0;color:#dc2626;font-size:.82rem;">불러오기 실패: ${esc(e.message)}</p>`;
  });
  if (sameAd) return;

  $('ap-stats').innerHTML = `<p style="padding:10px 0;color:#9ca3af;font-size:.78rem;">기간별 성과 조회 중…</p>`;
  metaGet({ action: 'adstats', ad_id: adId }).then(d => {
    if (apCur.id !== adId) return;
    const stats = (d.stats || []).filter(Boolean);
    if (!stats.length) { $('ap-stats').innerHTML = ''; return; }
    const LBL = { today:'오늘', yesterday:'어제', last_3d:'최근 3일', last_7d:'최근 7일', prev_7d:'이전 7일', last_14d:'최근 14일', last_30d:'최근 30일' };
    const range = s => s.start && s.end ? `${s.start} ~ ${s.end}` : '';
    $('ap-stats').innerHTML = `<div class="sub-title">기간별 지출 · ROAS <span style="font-weight:400;text-transform:none;letter-spacing:0;">(오늘 외에는 어제까지 · 이전 7일 = 최근 7일의 직전 7일)</span></div>
      <div style="height:180px;"><canvas id="ap-chart"></canvas></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(64px,1fr));gap:4px;margin-top:8px;text-align:center;">
        ${stats.map(s => `<div title="${esc(range(s))}" style="background:${s.preset === 'prev_7d' ? '#fff7ed' : '#f8f9ff'};border-radius:8px;padding:6px 2px;">
          <div style="font-size:.68rem;color:#9ca3af;font-weight:700;">${LBL[s.preset] || s.preset}</div>
          <div style="font-size:.76rem;font-weight:800;color:#1e1b4b;">${s.spend >= 10000 ? comma(Math.round(s.spend / 10000)) + '만' : won(s.spend)}</div>
          <div style="font-size:.7rem;font-weight:700;color:${s.roas >= 2 ? '#15803d' : s.roas >= 1 ? '#92400e' : s.spend ? '#dc2626' : '#9ca3af'};">${s.spend ? s.roas.toFixed(2) : '—'}</div>
        </div>`).join('')}</div>`;
    mkChart('apstats', 'ap-chart', {
      data: {
        labels: stats.map(s => LBL[s.preset] || s.preset),
        datasets: [
          { type: 'bar', label: '지출 (만원)', data: stats.map(s => Math.round(s.spend / 10000)), backgroundColor: 'rgba(99,102,241,.55)', borderRadius: 6, yAxisID: 'y' },
          { type: 'line', label: 'ROAS', data: stats.map(s => +s.roas.toFixed(2)), borderColor: '#f59e0b', backgroundColor: '#f59e0b', tension: .3, pointRadius: 4, yAxisID: 'y1' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { font: { size: 11 } } }, tooltip: { callbacks: { afterTitle: it => range(stats[it[0].dataIndex]) } } },
        scales: { y: { position: 'left' }, y1: { position: 'right', grid: { drawOnChartArea: false } } },
      },
    });
  }).catch(() => { if (apCur.id === adId) $('ap-stats').innerHTML = ''; });
}

/* ── 데모 데이터 (연동 전 화면 구경용) ── */
function admgrDemo() { admgr.demo = true; admgr.data = admgrDemoData(); admgr.test.loaded = false; admgr.test.state = new Map(); renderAdmgr(); }
/* 데모 테스트 소재 = 데모 계층에서 이름에 test가 든 세트의 광고 */
function admgrDemoTestData() {
  const ads = [];
  for (const c of (admgr.data || admgrDemoData()).campaigns) for (const s of c.adsets) {
    if (!/test/i.test(s.name)) continue;
    for (const a of s.ads) ads.push({ id: a.id, name: a.name, adset_id: s.id, adset_name: s.name,
      status: a.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED', effective_status: a.status || 'PAUSED',
      created_time: a.created, reg_date: (a.created || '').slice(0, 10), spend: a.spend, purchases: a.purchases, value: a.value });
  }
  return { fetched_at: new Date().toISOString(), until: todayStr(0), adset_count: new Set(ads.map(a => a.adset_id)).size, truncated: false, ads };
}
function admgrDemoData() {
  const mult = admgr.preset === 'last_30d' ? 26 : admgr.preset === 'last_7d' ? 6.4 : 1;
  const rng = mulberry32(admgr.preset.length * 977 + 20260901);
  let seq = 0;
  const mkId = () => '1207' + String(1e12 + Math.floor(rng() * 9e12)) + String(seq++).padStart(1, '0');
  const t = todayStr(0);
  const range = admgr.preset === 'today' ? { start: t, end: t }
    : admgr.preset === 'yesterday' ? { start: todayStr(-1), end: todayStr(-1) }
    : admgr.preset === 'last_7d' ? { start: todayStr(-7), end: todayStr(-1) }
    : { start: todayStr(-30), end: todayStr(-1) };
  const mkAd = (name, on, base, roas) => {
    const spend = Math.round(base * mult * (0.8 + rng() * .4));
    const value = Math.round(spend * roas * (0.85 + rng() * .3));
    const purchases = Math.max(spend > 0 ? 1 : 0, Math.round(value / 52000));
    return { id: mkId(), name, status: on ? 'ACTIVE' : (rng() < .5 ? 'PAUSED' : ''), created: '2026-08-' + String(10 + Math.floor(rng() * 18)).padStart(2, '0') + 'T10:00:00+0900',
      spend, clicks: Math.round(spend / (600 + rng() * 500)), purchases: value ? purchases : 0, value, roas: spend ? value / spend : 0 };
  };
  const mkSet = (name, on, budget, ads) => {
    const rows = ads.map(a => mkAd(a[0], a[1], a[2], a[3]));
    return { id: mkId(), name, status: on ? 'ACTIVE' : 'PAUSED', budget, budget_life: 0,
      created: '2026-08-' + String(8 + Math.floor(rng() * 20)).padStart(2, '0') + 'T09:00:00+0900',
      spend: rows.reduce((s, r) => s + r.spend, 0), clicks: rows.reduce((s, r) => s + r.clicks, 0),
      purchases: rows.reduce((s, r) => s + r.purchases, 0), value: rows.reduce((s, r) => s + r.value, 0), ads: rows };
  };
  const mkCamp = (name, on, sets) => ({
    id: mkId(), name, status: on ? 'ACTIVE' : 'PAUSED', budget: 0, budget_life: 0,
    created: '2026-07-' + String(1 + Math.floor(rng() * 27)).padStart(2, '0') + 'T09:00:00+0900',
    spend: sets.reduce((s, r) => s + r.spend, 0), clicks: sets.reduce((s, r) => s + r.clicks, 0),
    purchases: sets.reduce((s, r) => s + r.purchases, 0), value: sets.reduce((s, r) => s + r.value, 0), adsets: sets,
  });
  const campaigns = [
    mkCamp('상시 전환 캠페인', true, [
      mkSet('클레르 블라우스 여름ver', true, 50000, [
        ['260810 클레르 블라우스 영상A', true, 22000, 3.2], ['260810 클레르 블라우스 이미지B', true, 14000, 1.6],
        ['260731 클레르 블라우스 착용컷', false, 4000, 1.1]]),
      mkSet('내티 원피스', true, 80000, [
        ['260815 내티 원피스 후킹 영상', true, 41000, 2.8], ['260815 내티 원피스 UGC', true, 22000, 2.1]]),
      mkSet('센느 후드 원피스', false, 30000, [['260822 센느 릴스', false, 9000, 1.3]]),
    ]),
    mkCamp('신규 소재 test', true, [
      mkSet('프레시 훌 티셔츠 test', true, 20000, [
        ['260818 프레시 훌 티셔츠 UGC', true, 9000, 1.9], ['260829 프레시 훌 티셔츠 스토리', true, 6000, 0.7]]),
      mkSet('모튼 가디건 test', true, 20000, [['260820 모튼 가디건 착용컷 A', true, 8000, 1.2]]),
    ]),
    mkCamp('리타겟팅', true, [
      mkSet('전체 방문자 리타겟', true, 30000, [['260801 시즌오프 안내', true, 16000, 4.1]]),
    ]),
  ];
  return { preset: admgr.preset, range, fetched_at: new Date().toISOString(), truncated: false, campaigns };
}
