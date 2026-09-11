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
  try { await admgrTestSave(adId, { verdict: nv, verdict_at: nv ? new Date().toISOString() : null }); renderAdmgr(true); }
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
    const heads = ['광고세트명', '소재명', '등록일', 'D+', '상태', '누적 지출', '구매', '구매당 비용', 'ROAS', '추가소재 요청일', '제작완료일', '메모'];
    heads.forEach((h, i) => ws.cell(1, i + 1).value(h).style({ bold: true, fill: 'EEF2FF' }));
    [34, 34, 12, 6, 10, 12, 8, 12, 8, 14, 12, 24].forEach((w, i) => ws.column(i + 1).width(w));
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
function admgrReportBuild(rows, days, today) {
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
  };
  // 세트명 첫 _ 앞 = 상품 (fileCore는 확장자 제거 규칙이 '(가을VER.)' 같은 점을 잘라 못 씀) — 괄호·날짜 꼬리·가격 숫자 제거
  const product = a => coreName(String(a.adset_name || a.name || '').split('_')[0].replace(/\s+\d{6}\b.*$/, '')).replace(/\s+\d{2,}\s*$/, '') || '(상품 미상)';   // 꼬리 가격·마진 숫자(2자리↑)만 제거, '스커트 2' 같은 한 자리는 유지
  const group = list => {
    const m = new Map();
    list.slice().sort((x, y) => y.spend - x.spend).forEach(a => { const k = product(a); (m.get(k) || m.set(k, []).get(k)).push(a); });
    return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0], 'ko')).map(([name, ads]) => ({ name, ads }));
  };
  const secs = ADMGR_RP_SECS.map(([key, title, short, color, note]) => { const list = rows.filter(pick[key]); return { key, title, short, color, note, n: list.length, groups: group(list) }; });
  const seen = new Set(); const all = [];
  secs.forEach(s => s.groups.forEach(g => g.ads.forEach(a => { if (!seen.has(a.id)) { seen.add(a.id); all.push(a); } })));
  return { from, to: today, days, secs, all };
}
function admgrReportLine(a) {
  const dp = admgrDPlus(a);
  const parts = [dp == null ? '' : 'D+' + dp, '지출 ' + won(a.spend), '구매 ' + comma(a.purchases),
    a.purchases > 0 ? 'CPA ' + won(a.spend / a.purchases) : '', a.spend > 0 ? 'ROAS ' + (a.value / a.spend).toFixed(1) : '',
    a.meta.asset_req_at ? '요청 ' + fmtMD(String(a.meta.asset_req_at).slice(0, 10)) : '',
    a.meta.asset_done_at ? '제작완료 ' + fmtMD(String(a.meta.asset_done_at).slice(0, 10)) : ''];
  return parts.filter(Boolean).join(' · ');
}
function admgrReportText(rep) {
  const L = [`📋 테스트 소재 리포트 · ${fmtMD(rep.from)}~${fmtMD(rep.to)} (${rep.days}일)`,
    rep.secs.map(s => `${s.short} ${s.n}`).join(' · '), ''];
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
  return L.join('\n').trim();
}
function admgrReportHtml(rep, thumbs) {
  const chip = (t, c) => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${c}18;color:${c};font-size:.72rem;font-weight:700;margin-right:4px;">${t}</span>`;
  const head = `<div style="margin-bottom:14px;"><div style="font-size:1.05rem;font-weight:800;color:#1e1b4b;">테스트 소재 리포트 <span style="font-weight:600;color:#6b7280;font-size:.85rem;">${fmtMD(rep.from)} ~ ${fmtMD(rep.to)} (${rep.days}일)</span></div>
    <div style="margin-top:6px;">${rep.secs.map(s => chip(`${s.short} ${s.n}`, s.color)).join('')}</div></div>`;
  const body = rep.secs.map(s => `<section style="margin-bottom:18px;break-inside:avoid;">
    <div style="display:flex;align-items:baseline;gap:8px;border-left:4px solid ${s.color};padding-left:8px;margin-bottom:6px;">
      <b style="font-size:.92rem;color:#111827;">${esc(s.title)}</b><span style="font-size:.78rem;color:${s.color};font-weight:700;">${s.n}</span>
      <span style="font-size:.7rem;color:#9ca3af;">${esc(s.note)}</span></div>
    ${s.n ? s.groups.map(g => (s.key === 'fresh' || s.key === 'ended')
      ? `<div style="margin:3px 0 3px 12px;font-size:.78rem;"><b style="color:#312e81;">${esc(g.name)}</b> <span style="color:#9ca3af;">${g.ads.length}개</span> <span style="color:#6b7280;">${esc(g.ads.map(a => a.adset_name).join(' / '))}</span></div>`
      : `<div style="margin:6px 0 8px 12px;">
      <div style="font-weight:800;font-size:.86rem;color:#312e81;margin-bottom:4px;">${esc(g.name)} <span style="font-weight:600;color:#9ca3af;font-size:.72rem;">${g.ads.length}개</span></div>
      ${g.ads.map(a => { const th = thumbs[a.id]; return `<div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-top:1px solid #f1f2f6;">
        <div style="width:56px;height:56px;flex:none;border-radius:8px;background:#f3f4f6;overflow:hidden;">${th ? `<img src="${esc(th)}" style="width:100%;height:100%;object-fit:cover;" />` : ''}</div>
        <div style="min-width:0;flex:1;"><div style="font-size:.8rem;font-weight:700;color:#1f2937;word-break:break-all;">${esc(a.adset_name)}</div>
          <div style="font-size:.72rem;color:#4b5563;margin-top:2px;">${esc(admgrReportLine(a))}</div>
          ${a.meta.memo ? `<div style="font-size:.72rem;color:#7c3aed;margin-top:2px;">메모: ${esc(a.meta.memo)}</div>` : ''}</div></div>`; }).join('')}</div>`).join('')
      : '<div style="margin-left:12px;font-size:.78rem;color:#9ca3af;">없음</div>'}</section>`).join('');
  return head + body;
}
function admgrReportModal() {
  let m = $('admgr-report');
  if (m) return m;
  m = document.createElement('div'); m.className = 'modal'; m.id = 'admgr-report';
  m.onclick = e => { if (e.target === m) closeModal('admgr-report'); };
  m.innerHTML = `<div class="modal-box wide" style="max-width:860px;"><div class="modal-head" style="flex-wrap:wrap;"><b>주간 리포트</b>
    <select id="rp-days" class="inp" style="width:auto;padding:4px 8px;font-size:.76rem;" onchange="admgrTestReport()">
      <option value="7">최근 7일</option><option value="14">최근 14일</option><option value="30">최근 30일</option></select>
    <button class="filter-tab" style="color:#4f46e5;" onclick="admgrReportCopy()" title="플로우·카톡에 붙여넣기용 텍스트"><i class="fa-regular fa-copy"></i> 텍스트 복사</button>
    <button class="filter-tab" onclick="admgrReportPrint()" title="새 창 → 인쇄 대화상자에서 PDF로 저장"><i class="fa-solid fa-print"></i> 인쇄·PDF</button>
    <button class="modal-x" onclick="closeModal('admgr-report')">✕</button></div><div id="rp-body"></div></div>`;
  document.body.appendChild(m);
  return m;
}
async function admgrTestReport() {
  const t = admgr.test;
  if (!t.loaded) { await admgrTestFetch(); if (!t.loaded) return; }
  admgrReportModal().classList.add('show');
  const sel = $('rp-days');
  if (!sel.dataset.init) { sel.value = String(lsGet('adc_admgr_rpdays', 7)); sel.dataset.init = '1'; }
  const days = +sel.value || 7; lsSet('adc_admgr_rpdays', days);
  t.thumbs = t.thumbs || {};
  const rep = admgrReportBuild(admgrTestRowSets().vis, days, todayStr(0));
  t.report = rep;
  $('rp-body').innerHTML = admgrReportHtml(rep, t.thumbs);
  const need = admgr.demo ? [] : [...new Set(rep.all.filter(a => !(a.id in t.thumbs)).map(a => a.adset_id))];
  if (!need.length) return;
  try {
    for (let i = 0; i < need.length; i += 100) {
      const r = await metaGet({ action: 'creatives', set_ids: need.slice(i, i + 100).join(',') });
      (r.ads || []).forEach(a => { t.thumbs[a.id] = a.image || a.thumb || ''; });
    }
    rep.all.forEach(a => { if (!(a.id in t.thumbs)) t.thumbs[a.id] = ''; });   // 못 찾은 소재는 재조회 안 함
    if (t.report === rep) $('rp-body').innerHTML = admgrReportHtml(rep, t.thumbs);
  } catch (e) { toast('썸네일 조회 실패 (텍스트는 정상): ' + e.message); }
}
async function admgrReportCopy() {
  const rep = admgr.test.report; if (!rep) return;
  const txt = admgrReportText(rep);
  try { await navigator.clipboard.writeText(txt); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast('리포트 텍스트를 복사했어요 — 플로우에 붙여넣기');
}
function admgrReportPrint() {
  /* 팝업 창 대신 숨은 iframe에 그려서 인쇄 — 팝업 차단·앱 내 브라우저에서도 동작. 인쇄 대화상자에서 'PDF로 저장' */
  const t = admgr.test; if (!t.report) return;
  const old = $('rp-print'); if (old) old.remove();
  const f = document.createElement('iframe'); f.id = 'rp-print';
  f.style.cssText = 'position:fixed;left:-9999px;width:800px;height:600px;border:0;';
  f.srcdoc = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>테스트 소재 리포트 ${esc(t.report.from)}~${esc(t.report.to)}</title>
    <style>body{font-family:-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;margin:24px;color:#111827;max-width:800px;}img{max-width:100%;}</style></head>
    <body>${admgrReportHtml(t.report, t.thumbs || {})}
    <script>Promise.all([...document.images].map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r}))).then(()=>setTimeout(()=>{focus();print();},300));</script></body></html>`;
  document.body.appendChild(f);
  toast('인쇄 창이 열려요 — 대상에서 "PDF로 저장"을 고르세요');
}
/* ── 판정 추천: 기준(일수·지출·ROAS·구매)은 화면에서 바꿀 수 있고 브라우저에 기억 ── */
const ADMGR_TJUDGE_DEFAULT = { days: 3, spend: 30000, offRoas: 1, goodRoas: 3, goodPurch: 3 };
let admgrTJudge = Object.assign({}, ADMGR_TJUDGE_DEFAULT, lsGet('adc_admgr_tjudge', null) || {});
function admgrRecommend(a) {   // null = 평가중 아님. k: off | good | wait(기준 채웠지만 애매) | watch(아직 기준 미달)
  if (a.st !== 'eval') return null;
  // ROAS = 구매 전환값 ÷ 지출 (테스트 소재 데이터엔 roas 필드가 없고 value만 온다 — 실사고 2026-09-11: roas 0으로 읽어 전부 OFF 후보)
  const dp = admgrDPlus(a) ?? 0, roas = a.spend ? (a.roas != null ? a.roas : (a.value || 0) / a.spend) : 0, J = admgrTJudge;
  if (dp < J.days || (a.spend || 0) < J.spend) return { k: 'watch', label: '지켜보기', why: `D+${dp} · ${won(a.spend || 0)} — 기준(D+${J.days}·${won(J.spend)}) 전` };
  if (roas < J.offRoas) return { k: 'off', label: 'OFF 후보', why: `ROAS ${roas.toFixed(2)} < ${J.offRoas}` };
  if (roas >= J.goodRoas && (a.purchases || 0) >= J.goodPurch) return { k: 'good', label: '우수 후보', why: `ROAS ${roas.toFixed(2)} · 구매 ${a.purchases}` };
  return { k: 'wait', label: '애매', why: `ROAS ${roas.toFixed(2)} · 구매 ${a.purchases || 0} — 우수·OFF 기준 사이` };
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
function admgrTJudgeSet(k, v) { admgrTJudge[k] = Number(v) || ADMGR_TJUDGE_DEFAULT[k]; lsSet('adc_admgr_tjudge', admgrTJudge); renderAdmgr(true); }
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
const admgrProductOf = a => String(a.adset_name || a.name || '').normalize('NFC').split('_')[0].replace(/\s+\d{6}\b.*$/, '').trim() || '(이름 없음)';
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
      <label><span style="color:#dc2626;">OFF 후보</span>: ROAS <input class="inp" type="number" min="0" step="0.1" value="${J.offRoas}" style="width:60px;padding:3px 6px;" onchange="admgrTJudgeSet('offRoas',this.value)" /> 미만</label>
      <label><span style="color:#15803d;">우수 후보</span>: ROAS <input class="inp" type="number" min="0" step="0.1" value="${J.goodRoas}" style="width:60px;padding:3px 6px;" onchange="admgrTJudgeSet('goodRoas',this.value)" /> 이상 · 구매 <input class="inp" type="number" min="0" value="${J.goodPurch}" style="width:50px;padding:3px 6px;" onchange="admgrTJudgeSet('goodPurch',this.value)" />건 이상</label>
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
  <div class="info-bar"><i class="fa-regular fa-clock"></i> 성과는 <b>등록 이후 누적</b> · ${admgrAgo(d.fetched_at)} 기준 (60초 캐시)${d.truncated ? ' · 일부 생략(200세트 한도)' : ''} · 테스트 세트 ${d.adset_count || 0}개 · 정렬 안 고르면 <b>판정 필요 순</b></div>`;

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
  const rowHtml = a => {
    const checked = t.sel.has(a.id), dp = admgrDPlus(a), c = cre.get(String(a.id));
    const th = (t.thumbs || {})[a.id]; const thSrc = th && th !== '-' ? th : '';
    return `<tr onclick="admgrTestSel('${a.id}')" style="cursor:pointer;${checked ? 'background:#eef2ff;' : ''}">
        <td class="cb"><input type="checkbox" ${checked ? 'checked' : ''} style="pointer-events:none;" /></td>
        <td onclick="event.stopPropagation();showMetaPreview('${a.id}')" title="클릭하면 소재 미리보기" style="cursor:zoom-in;">${mediaThumbHtml(thSrc, 'image', 48)}</td>
        <td class="name-cell" style="text-align:left;">
          <span onclick="event.stopPropagation();showMetaPreview('${a.id}')" title="클릭하면 소재 미리보기" style="font-weight:700;color:#4338ca;cursor:pointer;">${esc(a.adset_name)}</span>
          <div style="font-size:.68rem;color:#9ca3af;margin-top:2px;">${esc(a.name)}</div>
          ${c ? `<div style="font-size:.66rem;color:#6b7280;margin-top:2px;"><i class="fa-solid fa-cloud" style="color:#4f46e5;"></i> ${esc(admgrTagOf(c.file_name) || '소재')} · ${esc((c.created_by_email || '').split('@')[0])} 등록 · <a href="#" onclick="event.stopPropagation();admgrTestCopy('${a.id}');return false;">문구 ${c.text && c.text.message ? '보기' : '기입'}</a></div>` : ''}</td>
        <td style="white-space:nowrap;">${a.reg_date ? fmtMD(a.reg_date) : '—'}<div style="font-size:.62rem;color:#9ca3af;">${dp == null ? '' : 'D+' + dp}</div></td>
        <td>${admgrRecBadge(a)}${admgrTestBadge(a)}${admgrVerdictBtns(a)}</td>
        <td><b>${won(a.spend)}</b></td>
        <td class="m-hide">${comma(a.purchases)}</td>
        <td class="m-hide">${admgrCpa(a)}</td>
        <td>${admgrRoasTd(a)}</td>
        <td>${admgrAssetCell(a)}${a.meta.asset_req_at && !a.meta.asset_done_at ? `<div style="margin-top:3px;"><a href="#" style="font-size:.66rem;" onclick="event.stopPropagation();admgrTestGoRegister('${esc(admgrProductOf(a))}');return false;"><i class="fa-solid fa-cloud-arrow-up"></i> 소재 등록하러</a></div>` : ''}</td>
        <td class="m-hide" onclick="event.stopPropagation();admgrTestMemo(event,'${a.id}')" title="클릭해서 메모 수정" style="cursor:text;text-align:left;max-width:180px;white-space:normal;font-size:.74rem;color:${a.meta.memo ? '#374151' : '#c4c9d4'};">${a.meta.memo ? esc(a.meta.memo) : '메모…'}</td>
      </tr>`;
  };
  const head = `<thead><tr>
      <th class="cb"><input type="checkbox" ${allChecked ? 'checked' : ''} onclick="admgrTestSelAll()" title="표시된 전체 선택/해제" /></th><th></th>
      ${admgrTh('aname', '광고세트명')}${admgrTh('reg', '등록일')}<th>판정</th>
      ${admgrTh('spend', '누적 지출')}${admgrTh('purchases', '구매', 'm-hide')}${admgrTh('cpa', '구매당 비용', 'm-hide')}${admgrTh('roas', 'ROAS')}
      <th>추가소재</th><th class="m-hide">메모</th>
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
        <td colspan="2" style="text-align:center;color:#6b7280;"><i class="fa-solid fa-chevron-${open ? 'down' : 'right'}"></i></td>
        <td style="text-align:left;"><b style="color:#1e1b4b;">${esc(k)}</b> <span style="font-size:.7rem;color:#6b7280;">소재 ${list.length}개 · 평가중 ${st.eval} · <span style="color:#22c55e;">우수 ${st.good}</span> · <span style="color:#f97316;">애매 ${st.meh}</span> · <span style="color:#ef4444;">OFF ${st.off}</span></span>
          <a href="#" style="font-size:.68rem;margin-left:8px;" onclick="event.stopPropagation();admgrTestGoRegister('${esc(k)}');return false;"><i class="fa-solid fa-cloud-arrow-up"></i> 이 상품 소재 등록</a></td>
        <td></td><td></td>
        <td><b>${won(spend)}</b></td><td class="m-hide">${comma(purch)}</td><td class="m-hide">${purch ? won(Math.round(spend / purch)) : '—'}</td>
        <td><b>${spend ? (value / spend).toFixed(2) : '—'}</b></td><td></td><td class="m-hide"></td></tr>` + (open ? list.map(rowHtml).join('') : '');
    }).join('');
  } else bodyHtml = rows.map(rowHtml).join('');
  const table = `<div class="table-wrap" style="max-height:640px;overflow:auto;"><table>${head}<tbody>${bodyHtml}</tbody></table></div>
  <p style="font-size:.75rem;color:#9ca3af;margin-top:8px;">썸네일·세트명 클릭 = 소재 미리보기 · 행 클릭 = 선택(일괄 제거용) · 판정 열의 <b>▶ 후보</b>는 기준에 따른 추천이고, [애매]/[우수] 버튼으로 확정 · 우수 소재는 추가소재 요청 → "소재 등록하러"로 바로 이동</p>`;
  return ctrl + tiles + table;
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
  return ctrl + info + tiles + table;
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
function renderAdmgrBest() {
  const b = admgr.best;
  if (!admgrCfg() || admgr.demo) {
    return `<div class="empty-state"><div class="es-icon"><i class="fa-solid fa-star"></i></div>
      <p>실제 Meta 연동 후, 광고세트 탭에서 세트를 체크하고 <b>베스트소재로</b>를 누르면 그 소재들이 여기에 격자로 모여요 (데모 모드에서는 제공되지 않아요).</p></div>`;
  }
  if (!b.loaded) return `<div class="empty-state"><p>${b.loading ? '베스트소재를 불러오는 중…' : '<b>새로고침</b>을 누르면 베스트소재를 불러와요.'}</p></div>`;
  if (!(b.rows || []).length) {
    return `<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-images"></i></div>
      <p>아직 담은 세트가 없어요.<br/><b>광고세트</b> 탭에서 세트를 체크하고 <b>베스트소재로</b> 버튼을 누르면 여기에 소재가 모여요.</p></div>`;
  }
  const nameOf = new Map(b.rows.map(r => [r.adset_id, r.adset_name]));
  const chips = b.rows.map(r => `<span class="status-badge badge-blue" style="padding:3px 6px 3px 12px;gap:6px;">${esc(r.adset_name)}
    <button onclick="admgrBestRemove('${r.adset_id}')" title="베스트소재에서 제거" style="border:none;background:#fff;color:#6b7280;border-radius:50%;width:18px;height:18px;line-height:1;font-size:.68rem;cursor:pointer;">✕</button></span>`).join(' ');
  let ads = (b.ads || []);
  if (admgr.q) ads = ads.filter(a => ((nameOf.get(a.adset_id) || '') + ' ' + a.name).toLowerCase().includes(admgr.q));
  const tiles = ads.map(a => {
    const src = a.image || a.thumb;
    const setNm = nameOf.get(a.adset_id) || '';
    return `<div class="cre-tile" style="aspect-ratio:9/16;" onclick="showMetaPreview('${a.id}')" title="${esc(a.name)} — 클릭하면 소재 보기">
      ${src ? `<img src="${esc(src)}" loading="lazy" alt="" />` : `<div class="ct-ph"><i class="fa-regular fa-image"></i></div>`}
      ${a.is_video ? '<div class="ct-play"><i class="fa-solid fa-play"></i></div>' : ''}
      ${a.effective_status !== 'ACTIVE' ? '<span class="ct-status"><span class="status-badge badge-red">꺼짐</span></span>' : ''}
      <div class="ct-name">${esc(setNm)}</div>
    </div>`;
  }).join('');
  return `<div class="info-bar"><i class="fa-solid fa-star"></i> 담은 세트 ${b.rows.length}개 · 소재 ${ads.length}개 · 타일 클릭 = 소재 미리보기 · 세트 이름표의 ✕ = 목록에서 제거</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;align-items:center;">${chips}</div>
    <div class="cre-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));">${tiles || `<div class="empty-state"><p>${admgr.q ? '검색 결과가 없어요.' : '담은 세트에 표시할 소재가 없어요.'}</p></div>`}</div>`;
}

/* ── 소재 미리보기 (원본 showMetaPreview — iframe + 형식 전환(피드/릴스/스토리) + 기간 7종 성과 차트) ── */
const apCur = { id: null, fmt: 'feed' };
const AP_FMTS = [['feed', '피드'], ['reels', '릴스'], ['story', '스토리']];
async function showMetaPreview(adId, fmt) {
  const sameAd = apCur.id === adId;          // 형식만 바꿀 때는 성과를 다시 조회하지 않는다
  apCur.id = adId; apCur.fmt = fmt || 'feed';
  const myFmt = apCur.fmt;
  $('admgr-preview').classList.add('show');
  if (!sameAd) { $('ap-title').textContent = '소재 미리보기'; $('ap-stats').innerHTML = ''; }
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
