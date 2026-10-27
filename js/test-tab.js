/* ═══ 테스트 소재 탭 — 단계별 화면 (2026-10-13 사용자 시안 승인) ═══
   흐름: 세트명 test 자동 수집 → [테스트 중] D+2 전 (금액 조건 없음) → [판정할 차례] 추천 보고 우수/애매/OFF 확정 → [판정 끝] 체크 → 테스트 완료 + 리포트.
   - 판정은 기록만: OFF로 확정해도 광고는 자동으로 안 꺼진다 (사용자 지시). 끄기는 광고관리자에서 따로.
   - 같은 상품끼리 묶고 구매당비용 1등에 🏆 · 테스트 중은 업로드 날짜별 묶음 · 구매당비용 옆에 어제 대비 흐름 화살표.
   - 자주 안 쓰는 기능(기준·엑셀·주간 리포트·숨기기·끝난 소재)은 ⋯ 메뉴. 퍼널·메모·추가소재는 이름을 누르면 여는 상세 패널.
   데이터·저장 함수는 admgr-tabs.js 것을 그대로 쓴다 (admgrTestRowSets·admgrTestVerdict·admgrTestSave·admgrRecommend…) */
'use strict';
const TT_STAGES = [
  ['run', '테스트 중', 'D+0~1 · 기준 전이라 지켜만 봐요'],
  ['judge', '판정할 차례', ''],
  ['done', '판정 끝 · 완료 대기', '체크 → 테스트 완료 + 리포트'],
];
const TT_V = { good: ['우수', '#166534', '#dcfce7'], meh: ['애매', '#9a3412', '#ffedd5'], off: ['OFF', '#991b1b', '#fee2e2'] };
function admgrTestStage(a) {   // run | judge | done | gone | hidden
  if (a.meta.hidden) return 'hidden';
  if (a.gone) return 'gone';
  if (a.meta.verdict) return 'done';
  const J = admgrTJudge, dp = admgrDPlus(a) ?? 0, sp = a.spend || 0;
  if (dp >= J.days) return 'judge';   // 2026-10-14 사용자: 판정은 날짜만 (소액이어도 잘 나오는 소재가 있고, 많이 써도 안 나오는 건 안 나옴)
  if (a.effective_status !== 'ACTIVE' && !['review', 'rejected'].includes(a.st) && sp > 0) return 'judge';   // 기준 전에 직접 끈 소재도 판정은 해야 완료할 수 있다
  return 'run';
}
/* 메뉴 배지 — 판정할 차례 개수. 자동 조회는 안 함(사용자 지정) → 마지막으로 받아둔 데이터 기준, 새로고침·판정 때 갱신 */
function admgrTestMenuBadge() {
  const el = document.querySelector('.side-menu [data-menu="atest"]'); if (!el) return;
  const t = admgr.test;
  if (!t.loaded) { const c = lsGet('adc_admgr_test', null); if (c && c.data) { t.data = c.data; t.state = new Map(c.state || []); t.loaded = true; } }
  const n = t.loaded ? ((t.data || {}).ads || []).filter(a => { const meta = t.state.get(a.id) || {}; return admgrTestStage({ ...a, meta, st: admgrTestStatusOf(a, meta) }) === 'judge'; }).length : 0;
  let b = el.querySelector('.tt-badge');
  if (!b) { b = document.createElement('span'); b.className = 'tt-badge'; el.appendChild(b); }
  b.textContent = n; b.style.display = n ? '' : 'none'; b.title = `판정할 차례 ${n}개`;
}
/* 구매당비용 흐름 — 일별 누적 스냅샷 두 개(가장 최근·그 전날)의 구매당비용 비교. 낮아지면 좋아지는 중 */
function admgrCpaTrend(a) {
  const L = ((admgr.test.trend && admgr.test.trend.get(a.id)) || []).slice().sort((x, y) => String(x.day).localeCompare(String(y.day)));
  const cpa = r => (+r.purchases > 0 ? +r.spend / +r.purchases : null);
  const now = cpa({ spend: a.spend, purchases: a.purchases });
  const prev = L.length ? cpa(L[L.length - 1]) : null;
  const cur = L.length >= 2 && L[L.length - 1].day === todayStr(0) ? cpa(L[L.length - 1]) : now;   // 오늘 스냅샷이 있으면 '어제까지' vs '그제까지'로
  const base = L.length >= 2 && L[L.length - 1].day === todayStr(0) ? cpa(L[L.length - 2]) : prev;
  if (cur == null || base == null) return '';
  const d = cur / base - 1;
  if (Math.abs(d) < 0.05) return '<span class="tt-tr" style="color:#9ca3af;" title="어제와 비슷">→</span>';
  return d < 0 ? `<span class="tt-tr" style="color:#16a34a;" title="구매당비용이 어제보다 ${Math.round(-d * 100)}% 낮아짐 — 좋아지는 중">↘ ${Math.round(-d * 100)}%</span>`
    : `<span class="tt-tr" style="color:#dc2626;" title="구매당비용이 어제보다 ${Math.round(d * 100)}% 높아짐 — 나빠지는 중">↗ ${Math.round(d * 100)}%</span>`;
}
function admgrTtCpa(a) {
  const pu = a.purchases || 0; if (!pu) return '<span style="color:#9ca3af;">구매 없음</span>';
  const cpa = a.spend / pu, be = admgrBreakEven(a), m = be && be.margin, J = admgrTJudge;
  const bar = m ? `<span class="tt-cbar" title="마진 ${won(Math.round(m))} 대비 ${Math.round(cpa / m * 100)}% — 세로선이 ${Math.round(J.goodCpa * 100)}%"><i style="width:${Math.min(100, cpa / m * 100)}%;background:${cpa <= m * J.goodCpa ? '#22c55e' : cpa <= m ? '#f59e0b' : '#ef4444'};"></i><b style="left:${J.goodCpa * 100}%;"></b></span>` : '';
  return `<span style="white-space:nowrap;">${won(Math.round(cpa))}${bar}</span>${admgrCpaTrend(a)}`;
}
function admgrTtVerdictBtns(a, rec) {
  const v = a.meta.verdict;
  return `<div class="tt-vb">${['good', 'meh', 'off'].map(k => `<button class="${v === k ? 'on-' + k : rec && !v && (rec.k === k || (rec.k === 'wait' && k === 'meh')) ? 'rec' : ''}" onclick="event.stopPropagation();admgrTtVerdict('${a.id}','${k}')" title="${v === k ? '다시 누르면 판정 취소' : TT_V[k][0] + '로 확정 (광고는 그대로 — 끄기는 따로)'}">${TT_V[k][0]}</button>`).join('')}</div>`;
}
async function admgrTtVerdict(id, k) { await admgrTestVerdict(id, k); admgrTestMenuBadge(); const s = $('tt-side'); if (s && s.classList.contains('show') && s.dataset.id === id) admgrTtSide(id); }
function renderAdmgrTest() {
  if (!admgr.products && !admgr.productsLoading && admgrCfg() && !admgr.demo) admgrLoadProducts();   // 마진(판매가·공급가)
  const t = admgr.test, J = admgrTJudge;
  if (!admgrCfg() && !admgr.demo) return `<div class="empty-state"><div class="es-icon"><i class="fa-solid fa-flask"></i></div><p>연동 후에는 <b>광고세트명에 'test'</b>가 들어간 세트의 소재가 여기에 자동으로 모여요.</p></div>`;
  if (!t.loaded) return `<div class="empty-state"><p>${t.loading ? '테스트 소재를 불러오는 중… (전체 세트를 훑어서 10초쯤 걸려요)' : '<b>새로고침</b>을 누르면 테스트 소재를 불러와요.'}</p></div>`;
  const q = admgr.q ? admgr.q.normalize('NFC') : '';
  const all = ((t.data || {}).ads || []).map(a => { const meta = t.state.get(a.id) || {}; return { ...a, meta, st: admgrTestStatusOf(a, meta) }; })
    .filter(a => admgr.mk.filter === 'all' || admgrMakerPass(a.id, a.adset_id, a.adset_name))
    .filter(a => !q || (a.name + ' ' + a.adset_name).normalize('NFC').toLowerCase().includes(q));
  all.forEach(a => { a.stage = admgrTestStage(a); });
  const by = k => all.filter(a => a.stage === k);
  const stage = t.stage || (by('judge').length ? 'judge' : 'run');
  const rows = by(stage);
  setTimeout(() => { admgrTestThumbsEnsure(rows); admgrTestCreativesEnsure(); admgrTrendEnsure(); admgrTestMenuBadge(); }, 0);
  const dd = (label, fn, icon) => `<button onclick="this.closest('details').open=false;${fn}"><i class="fa-solid ${icon}"></i> ${label}</button>`;
  const head = `<div class="tt-head">
    <span class="tt-info">테스트 세트 ${(t.data || {}).adset_count || 0}개 · ${admgrAgo((t.data || {}).fetched_at)} 기준 · 성과는 등록 이후 누적</span>
    ${admgrMakerBtn()}
    <button class="filter-tab" style="color:#4f46e5;border-color:#c7d2fe;" onclick="admgrEndReportList()"><i class="fa-solid fa-clipboard-check"></i> 완료 리포트</button>
    ${(() => { const c = typeof admgrPromoCands === 'function' ? admgrPromoCands() : { ads: [], prods: [] }; const n = c.ads.length + c.prods.length; return n ? `<button class="filter-tab" style="color:#0369a1;border-color:#bae6fd;background:#f0f9ff;" onclick="admgrPromoModal()" title="최근 7일 구매 30↑·ROAS 5↑ (종합 CBO) / 우수 소재 2개↑·상품 구매 60↑ (상품 CBO)"><i class="fa-solid fa-arrow-up-right-dots"></i> 승격 후보 ${n}</button>` : ''; })()}
    <details class="tt-more m-hide"><summary class="filter-tab" title="보일 열 고르기"><i class="fa-solid fa-table-columns"></i> 열</summary><div class="tt-dd">${TT_OPT_COLS.map(([k, l]) => `<label style="display:flex;gap:8px;align-items:center;padding:7px 10px;font-size:.8rem;cursor:pointer;"><input type="checkbox" ${admgrTtCols()[k] ? 'checked' : ''} onchange="admgrTtColToggle('${k}')"> ${l}</label>`).join('')}</div></details>
    <details class="tt-more"><summary class="filter-tab" title="기타 기능"><i class="fa-solid fa-ellipsis"></i></summary><div class="tt-dd">
      ${dd('판정 기준 바꾸기', 'admgrTJudgeToggle()', 'fa-sliders')}
      ${dd('이번 주 리포트 모아보기', 'admgrTestReport()', 'fa-clipboard-list')}
      ${dd(`추가소재 요청 목록 (${all.filter(a => a.meta.asset_req_at && !a.meta.asset_done_at).length})`, 'admgrReqListModal()', 'fa-pen-ruler')}
      ${dd('엑셀로 받기', "admgr.test.filter='all';admgrTestXlsx()", 'fa-file-arrow-down')}
      ${dd(`테스트 끝난 소재 (${by('gone').length})`, "admgrTtStage('gone')", 'fa-box-archive')}
      ${dd(`숨긴 소재 (${by('hidden').length})`, "admgrTtStage('hidden')", 'fa-eye-slash')}
    </div></details></div>`;
  const pct = Math.round(J.goodCpa * 100);
  const judgeBox = t.judgeOpen ? `<div class="tt-crit tt-edit">
      <label>판정 시작: D+<input class="inp" type="number" min="0" value="${J.days}" onchange="admgrTJudgeSet('days',this.value)"></label>
      <label>우수: 구매 <input class="inp" type="number" min="0" value="${J.goodPurch}" onchange="admgrTJudgeSet('goodPurch',this.value)">건↑ & 구매당비용 ≤ 마진의 <input class="inp" type="number" min="1" max="100" value="${pct}" onchange="admgrTJudgeSet('goodCpa',this.value)">%</label>
      <span style="color:#6b7280;">OFF: 구매당비용 > 마진 · 그 사이 애매</span>
      <button class="btn-ghost" onclick="admgrTJudgeReset()">기본값</button><button class="btn-ghost" onclick="admgrTJudgeToggle()">닫기</button></div>` : '';
  const tile = ([k, label, sub]) => { const n = by(k).length;
    const s = k === 'judge' ? `D+${J.days}부터 — 추천 보고 확정` : sub;
    return `<button class="tt-stage ${stage === k ? 'on' : ''}" onclick="admgrTtStage('${k}')"><span class="t">${label}</span>${k === 'judge' && n ? '<span class="n">오늘 할 일</span>' : ''}<b>${n}개</b>${n && !admgrMobile() ? admgrTtStageNums(by(k), k) : ''}<small>${s}</small></button>`; };
  const extra = stage === 'gone' || stage === 'hidden' ? `<div class="tt-crit">${stage === 'gone' ? '테스트 완료로 이름에서 test가 빠진 소재예요 (60일 보관) — 늦은 판정도 여기서 할 수 있어요' : '숨긴 소재예요 — 체크하고 아래 [다시 보이기]'} <a href="#" onclick="admgrTtStage('${by('judge').length ? 'judge' : 'run'}');return false;">← 돌아가기</a></div>` : '';
  const crit = stage === 'judge' ? `<div class="tt-crit"><b>판정 기준</b> · 우수 = 구매 ${J.goodPurch}건↑ & 구매당비용이 마진의 ${pct}% 이하 · OFF = 구매당비용 > 마진 (또는 마진만큼 쓰고 구매 0) · 그 사이 애매 &nbsp;|&nbsp; <b style="color:#4f46e5;">파란 테두리</b> = 추천, 누르면 확정 · OFF로 확정해도 광고는 자동으로 안 꺼져요</div>`
    : stage === 'done' ? `<div class="tt-crit">판정을 확정한 소재예요 — 체크하고 <b>테스트 완료</b>를 누르면 세트 이름에서 _test를 지우고 리포트를 만들어요 · 판정을 바꾸려면 다른 버튼, 취소는 같은 버튼을 다시</div>`
    : stage === 'run' ? `<div class="tt-crit">아직 판정 전이에요 — D+${J.days}가 되면 금액과 상관없이 '판정할 차례'로 넘어가요</div>` : '';
  return head + judgeBox + `<div class="tt-stages">${TT_STAGES.map(tile).join('')}${admgrMobile() ? '' : admgrTtWeekRate()}</div>` + extra + crit + (admgrMobile() ? admgrTtList(rows, stage) : admgrTtTable(rows, stage)) + admgrTtBar(rows, stage);
}
function admgrTtProg(dp) {   // 판정까지 남은 날 — 금액 조건 없음 (2026-10-14)
  const D = admgrTJudge.days, left = Math.max(0, D - (dp ?? 0));
  return `<div class="tt-prog"><span>${left ? `판정까지 ${left}일` : '내일 판정할 차례'}</span><div><i style="width:${Math.min(100, ((dp ?? 0) / D) * 100)}%;"></i></div></div>`;
}
function admgrTtStage(k) { const t = admgr.test; t.stage = k; t.sel.clear(); renderAdmgr(true); }
function admgrTtGroups(rows, stage) {   // [{ key, title, sub, rows }]
  if (stage === 'run' || stage === 'gone' || stage === 'hidden') {   // 업로드 날짜별 묶음 (최근 먼저), 안에서는 상품 → 지출
    const m = new Map();
    rows.slice().sort((x, y) => String(y.reg_date || '').localeCompare(String(x.reg_date || '')) || admgrProductOf(x).localeCompare(admgrProductOf(y), 'ko') || (y.spend || 0) - (x.spend || 0))
      .forEach(a => { const k = a.reg_date || '날짜 없음'; (m.get(k) || m.set(k, []).get(k)).push(a); });
    return [...m.entries()].map(([d, L]) => { const start = d.length === 10 ? admgrShiftDay(d, admgrTJudge.days) : '';
      return { key: d, title: d.length === 10 ? `${fmtMD(d)} 업로드` : d, sub: `${L.length}개${stage === 'run' && start ? ` · ${start <= todayStr(0) ? '판정할 차례' : fmtMD(start) + '부터 판정'}` : ''}`, rows: L }; });
  }
  const m = new Map();   // 같은 상품끼리 — 구매당비용 1등 🏆
  rows.forEach(a => { const k = admgrProductOf(a).replace(/\s+/g, ''); (m.get(k) || m.set(k, []).get(k)).push(a); });
  const cpa = a => (a.purchases ? a.spend / a.purchases : Infinity);
  return [...m.values()].map(L => {
    L.sort((x, y) => cpa(x) - cpa(y) || (y.spend || 0) - (x.spend || 0));
    const win = L.length > 1 && L[0].purchases ? L[0].id : null;
    L.forEach(a => { a.win = a.id === win; });
    const sp = L.reduce((s0, a) => s0 + (a.spend || 0), 0), pu = L.reduce((s0, a) => s0 + (a.purchases || 0), 0);
    return { key: admgrProductOf(L[0]), title: admgrProductOf(L[0]), sub: `${L.length}개 · 지출 ${won(sp)} · 구매 ${comma(pu)}건${win ? ' · 🏆 ' + esc(admgrTtShort(L[0]).replace(admgrProductOf(L[0]), '').replace(/^_/, '')) : ''}`, rows: L, maxD: Math.max(...L.map(a => admgrDPlus(a) ?? 0)) };
  }).sort((x, y) => y.maxD - x.maxD || x.title.localeCompare(y.title, 'ko'));
}
const admgrTtShort = a => String(a.adset_name || a.name || '').normalize('NFC').replace(/[_\s-]*test\s*$/i, '');
function admgrTtList(rows, stage) {
  const t = admgr.test;
  if (!rows.length) return `<div class="empty-state"><p>${stage === 'judge' ? '오늘 판정할 소재를 다 처리했어요 — \'판정 끝\'에서 테스트 완료' : stage === 'done' ? '판정을 확정한 소재가 없어요' : stage === 'run' ? "지금 테스트 중인 소재가 없어요. 광고세트명에 'test'를 넣어 올리면 자동으로 들어와요." : '없어요'}</p></div>`;
  const row = a => {
    const dp = admgrDPlus(a), th = (t.thumbs || {})[a.id], src = th && th !== '-' ? th : '', rec = admgrRecommend(a);
    const maker = MAKER_NAMES[admgrMakerOf(a.id, a.adset_id, a.adset_name)] || '';
    const sub = [a.reg_date ? `${fmtMD(a.reg_date)} 업로드` : '', dp == null ? '' : `D+${dp}`, maker].filter(Boolean).join(' · ');
    const badge = a.st === 'review' ? '<span class="status-badge badge-orange">검토중</span>' : a.st === 'rejected' ? '<span class="status-badge badge-red">거부·문제</span>' : a.effective_status !== 'ACTIVE' && !a.gone ? '<span class="status-badge badge-gray" title="Meta에서 꺼져 있어요">꺼짐</span>' : '';
    let act;
    if (stage === 'run') {
      act = admgrTtProg(dp);
    } else if (stage === 'hidden') act = '';
    else act = admgrTtVerdictBtns(a, rec) + (rec && rec.k !== 'watch' ? `<div class="tt-why">${esc(rec.why)}</div>` : rec ? `<div class="tt-why">${esc(rec.why)}</div>` : a.meta.verdict && a.meta.verdict_at ? `<div class="tt-why">${fmtMD(String(a.meta.verdict_at).slice(0, 10))} 확정</div>` : '');
    return `<div class="tt-row ${t.sel.has(a.id) ? 'sel' : ''}">
      <label class="tt-cb" onclick="event.stopPropagation()"><input type="checkbox" ${t.sel.has(a.id) ? 'checked' : ''} onchange="admgrTestSel('${a.id}')"></label>
      <div class="tt-ad"><span class="tt-th" onclick="showMetaPreview('${a.id}')" title="미리보기">${src ? `<img src="${esc(src)}" loading="lazy">` : ''}</span>
        <div onclick="admgrTtSide('${a.id}')" title="상세 보기" style="cursor:pointer;min-width:0;"><div class="tt-nm">${a.win ? '<span title="같은 상품 중 구매당비용 1등">🏆</span> ' : ''}${esc(admgrTtShort(a))} ${badge}</div><div class="tt-sub">${esc(sub)}${a.meta.memo ? ` · <i class="fa-regular fa-note-sticky"></i> ${esc(a.meta.memo)}` : ''}${a.meta.asset_req_at && !a.meta.asset_done_at ? ' · <span style="color:#7c3aed;">추가소재 요청됨</span>' : ''}</div></div></div>
      <div class="tt-num tt-s"><i>지출</i>${won(a.spend || 0)}</div>
      <div class="tt-num tt-p"><i>구매</i>${comma(a.purchases || 0)}건</div>
      <div class="tt-num tt-c"><i>구매당비용</i>${admgrTtCpa(a)}</div>
      <div class="tt-num tt-r"><i>ROAS</i>${a.spend ? ((a.value || 0) / a.spend).toFixed(2) : '–'}</div>
      <div class="tt-act">${act}</div></div>`;
  };
  return `<div class="tt-list"><div class="tt-row tt-hd"><span></span><span>소재</span><span>지출</span><span>구매</span><span>구매당비용</span><span>ROAS</span><span>${stage === 'run' ? '판정까지' : stage === 'hidden' ? '' : '판정'}</span></div>
    ${admgrTtGroups(rows, stage).map(g => `<div class="tt-grp"><b>${esc(g.title)}</b> <span>${g.sub}</span>${stage === 'done' && g.rows.some(a => a.meta.verdict === 'good') ? ` <a href="#" onclick="admgrTestGoRegister('${esc(g.title)}');return false;"><i class="fa-solid fa-cloud-arrow-up"></i> 추가소재 등록</a>` : ''}</div>${g.rows.map(row).join('')}`).join('')}</div>`;
}
function admgrTtBar(rows, stage) {
  const t = admgr.test, sel = rows.filter(a => t.sel.has(a.id));
  const all = rows.length && rows.every(a => t.sel.has(a.id));
  const pick = `<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" ${all ? 'checked' : ''} onchange="admgrTtSelAll(${all ? 'false' : 'true'})"> 전체</label>`;
  if (!sel.length) return rows.length && stage !== 'run' ? `<div class="tt-bar idle">${pick}<span>${stage === 'done' ? '완료할 소재를 체크하세요' : '체크하면 숨기기 등을 할 수 있어요'}</span></div>` : '';
  const btns = stage === 'done' ? `<button class="btn-ghost" onclick="admgrTtUndo()">판정 취소</button><button class="btn-analyze" onclick="admgrTestEndFromTest()"><i class="fa-solid fa-flag-checkered"></i> 테스트 완료 + 리포트 (${sel.length})</button>`
    : stage === 'hidden' ? `<button class="btn-analyze" onclick="admgrTestBulkHide(false)">다시 보이기 (${sel.length})</button>`
    : `<button class="btn-ghost" onclick="admgrTestBulkHide(true)">목록에서 숨기기 (${sel.length})</button>`;
  return `<div class="tt-bar">${pick}<span>${sel.length}개 선택</span><span style="flex:1;"></span>${btns}</div>`;
}
function admgrTtSelAll(on) {
  const t = admgr.test; const stage = t.stage || 'judge';
  const ids = ((t.data || {}).ads || []).filter(a => { const meta = t.state.get(a.id) || {}; return admgrTestStage({ ...a, meta, st: admgrTestStatusOf(a, meta) }) === stage; }).map(a => a.id);
  ids.forEach(id => on ? t.sel.add(id) : t.sel.delete(id)); renderAdmgr(true);
}
async function admgrTtUndo() {
  const t = admgr.test, ids = [...t.sel].filter(id => (t.state.get(id) || {}).verdict);
  if (!ids.length) return;
  try { for (const id of ids) await admgrTestSave(id, { verdict: null, verdict_at: null }); t.sel.clear(); toast(`${ids.length}개 판정을 취소했어요`); renderAdmgr(true); admgrTestMenuBadge(); }
  catch (e) { toast('저장 실패: ' + e.message); }
}
/* 상세 패널 — 퍼널·추세·추가소재·메모·문구·광고명 (표에서 뺀 정보) */
function admgrTtSide(id) {
  const t = admgr.test, a0 = ((t.data || {}).ads || []).find(x => x.id === id); if (!a0) return;
  const meta = t.state.get(id) || {}, a = { ...a0, meta, st: admgrTestStatusOf(a0, meta) };
  const all = ((t.data || {}).ads || []).map(x => ({ ...x, meta: t.state.get(x.id) || {} })).filter(x => !x.meta.hidden);
  const base = admgrFunnelBase(all), r = admgrFunnelRates(a), d = admgrFunnelDiag(a, base), be = admgrBreakEven(a), rec = admgrRecommend(a);
  const th = (t.thumbs || {})[id], c = t.creatives && t.creatives.get(String(id));
  const pct = v => v == null ? '–' : (v * 100).toFixed(v < 0.1 ? 2 : 0) + '%';
  const line = (k, v) => `<div class="tt-sl"><span>${k}</span><span>${v}</span></div>`;
  let s = $('tt-side'); if (!s) { s = document.createElement('div'); s.id = 'tt-side'; document.body.appendChild(s); }
  s.innerHTML = `<div class="tt-side-in"><div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><b style="flex:1;">소재 상세</b><button class="modal-x" onclick="$('tt-side').classList.remove('show')">✕</button></div>
    ${th && th !== '-' ? `<img src="${esc(th)}" style="width:100%;border-radius:12px;cursor:pointer;" onclick="showMetaPreview('${id}')" title="미리보기">` : ''}
    <div style="font-weight:800;margin:10px 0 2px;word-break:break-all;">${esc(admgrTtShort(a))}</div>
    <div style="font-size:.72rem;color:#9ca3af;word-break:break-all;margin-bottom:8px;">광고명 ${esc(a.name)}</div>
    ${admgrTtVerdictBtns(a, rec)}${rec ? `<div class="tt-why" style="margin-bottom:8px;">${esc(rec.why)}</div>` : ''}
    ${line('업로드', `${a.reg_date ? fmtMD(a.reg_date) : '–'} · D+${admgrDPlus(a) ?? '–'}`)}
    ${line('만든 사람', esc(MAKER_NAMES[admgrMakerOf(a.id, a.adset_id, a.adset_name)] || '–'))}
    ${line('지출 · 구매', `${won(a.spend || 0)} · ${comma(a.purchases || 0)}건`)}
    ${line('구매당비용', admgrTtCpa(a))}
    ${line('상품 마진', be ? won(Math.round(be.margin)) + ` <span style="color:#9ca3af;">(${esc(be.name)})</span>` : '<span style="color:#9ca3af;">카페24 상품을 못 찾음</span>')}
    ${line('ROAS', a.spend ? ((a.value || 0) / a.spend).toFixed(2) : '–')}
    <div style="font-weight:800;font-size:.82rem;margin:14px 0 6px;">퍼널 — <span class="status-badge ${d.cls}">${esc(d.label)}</span></div>
    <div style="font-size:.76rem;color:#4b5563;margin-bottom:6px;">${esc(d.fix)}</div>
    ${r ? line('노출 → 클릭', `${comma(a.imp)} → ${comma(a.clicks || 0)}`) + line('CPC (클릭당 비용)', a.clicks > 0 ? won(Math.round((a.spend || 0) / a.clicks)) : '–') + (r.ts != null ? line('3초 재생', pct(r.ts)) : '') + line('랜딩 도착', pct(r.lpvR)) + line('장바구니 → 구매', `${comma(a.atc || 0)} → ${comma(a.purchases || 0)}`) + line('빈도', (r.freq || 0).toFixed(1)) : ''}
    ${admgrSparkHtml(admgrTrend(a), be && be.be) ? `<div style="margin-top:8px;">${admgrSparkHtml(admgrTrend(a), be && be.be)}</div>` : ''}
    <div style="font-weight:800;font-size:.82rem;margin:14px 0 6px;">추가소재</div>${admgrAssetCell({ ...a, st: meta.verdict === 'good' ? 'good' : a.st })}
    <div style="margin-top:6px;"><a href="#" onclick="admgrTestGoRegister('${esc(admgrProductOf(a))}');return false;"><i class="fa-solid fa-cloud-arrow-up"></i> 이 상품 소재 등록하러</a></div>
    <div style="font-weight:800;font-size:.82rem;margin:14px 0 6px;">메모</div>
    <textarea class="inp" rows="2" style="width:100%;" placeholder="메모 (저장은 칸 밖을 누르면)" onchange="admgrTestSave('${id}',{memo:this.value||null}).then(()=>renderAdmgr(true)).catch(e=>toast('저장 실패: '+e.message))">${esc(meta.memo || '')}</textarea>
    ${c ? `<div style="margin-top:12px;"><a href="#" onclick="admgrTestCopy('${id}');return false;"><i class="fa-regular fa-pen-to-square"></i> 광고 문구 보기·수정</a></div>` : ''}</div>`;
  s.dataset.id = id; s.classList.add('show');
}

/* ═══ 데스크톱 표 (2026-10-13 2차 — "예전 표가 보기 편했다") ═══
   예전처럼 열을 펼친 표 + 새 흐름(단계·추천·🏆·업로드 날짜). 폰은 위 카드 목록(admgrTtList) 그대로.
   열 켜고 끄기: 퍼널·ROAS 추세·추가소재·메모 (ls adc_tt_cols) · 열 제목 누르면 정렬 (상품 묶음 안에서) */
const TT_OPT_COLS = [['funnel', '퍼널 진단'], ['roas', 'ROAS · 7일 추세'], ['asset', '추가소재'], ['memo', '메모']];
function admgrTtCols() { const c = lsGet('adc_tt_cols', null); return Object.assign({ funnel: true, roas: true, asset: false, memo: false }, c || {}); }   // 추가소재·메모는 기본 끔 — 이름 아래 한 줄로 보이고, 넓은 화면이면 '열'에서 켜기
function admgrTtColToggle(k) { const c = admgrTtCols(); c[k] = !c[k]; lsSet('adc_tt_cols', c); renderAdmgr(true); }
function admgrTtSort(k) { const t = admgr.test, s = t.sort2 || {}; t.sort2 = s.k === k ? (s.dir === 1 ? { k, dir: -1 } : {}) : { k, dir: 1 }; renderAdmgr(true); }
const TT_SORT = { name: a => admgrTtShort(a), reg: a => a.reg_date || '', spend: a => a.spend || 0, purch: a => a.purchases || 0,
  cpa: a => (a.purchases ? a.spend / a.purchases : 1e12), roas: a => (a.spend ? (a.value || 0) / a.spend : 0) };
/* 일별 구매당비용 — 누적 스냅샷 차이로 하루씩 (D+ 기준). 마지막 칸은 오늘 지금까지 */
function admgrCpaDaily(a) {
  const L = ((admgr.test.trend && admgr.test.trend.get(a.id)) || []).slice().sort((x, y) => String(x.day).localeCompare(String(y.day)));
  const pts = L.map(r => ({ day: r.day, spend: +r.spend || 0, purchases: +r.purchases || 0 }));
  if (!pts.length || pts[pts.length - 1].day !== todayStr(0)) pts.push({ day: todayStr(0), spend: a.spend || 0, purchases: a.purchases || 0 });
  else pts[pts.length - 1] = { day: todayStr(0), spend: a.spend || 0, purchases: a.purchases || 0 };
  const out = []; let prev = a.reg_date && pts[0].day > a.reg_date ? null : { spend: 0, purchases: 0 };
  for (const p of pts) { if (prev) { const sp = p.spend - prev.spend, pu = p.purchases - prev.purchases; out.push({ day: p.day, dp: a.reg_date ? daysBetween(a.reg_date, p.day) : null, spend: sp, purchases: pu, cpa: pu > 0 ? sp / pu : null }); } prev = p; }
  return out.slice(-7);
}
function admgrCpaChart(a, m) {   // 마우스 올리면 뜨는 작은 막대 — 높이 = 그날 구매당비용, 초록 = 마진 60% 이하, 빨강 = 마진 초과
  const D = admgrCpaDaily(a); if (D.length < 2) return '';
  const max = Math.max(...D.map(d => d.cpa || 0), m || 0) || 1, J = admgrTJudge;
  return `<div class="tt-pop"><div style="font-weight:800;margin-bottom:6px;">하루별 구매당비용</div><div class="tt-pop-bars">${D.map(d => { const h = d.cpa ? Math.max(4, d.cpa / max * 60) : 2;
    const col = d.cpa == null ? '#e5e7eb' : !m ? '#818cf8' : d.cpa <= m * J.goodCpa ? '#22c55e' : d.cpa <= m ? '#f59e0b' : '#ef4444';
    return `<div><span>${d.cpa ? (d.cpa / 10000).toFixed(1) + '만' : d.spend > 0 ? '구매0' : '–'}</span><i style="height:${h}px;background:${col};"></i><small>${d.dp != null ? 'D+' + d.dp : fmtMD(d.day)}</small></div>`; }).join('')}</div>
    ${m ? `<div style="color:#6b7280;margin-top:4px;">마진 ${won(Math.round(m))} · 우수선 ${won(Math.round(m * J.goodCpa))}</div>` : ''}</div>`;
}
/* 단계 카드 숫자 + 이번 주 우수율 */
function admgrTtStageNums(L, k) {
  const sp = L.reduce((s, a) => s + (a.spend || 0), 0), pu = L.reduce((s, a) => s + (a.purchases || 0), 0);
  let extra = '';
  if (k === 'judge') { const r = L.map(a => (admgrRecommend(a) || {}).k); extra = ` · <span style="color:#16a34a;">우수 추천 ${r.filter(x => x === 'good').length}</span> · <span style="color:#dc2626;">OFF ${r.filter(x => x === 'off').length}</span>`; }
  if (k === 'done') { const v = L.map(a => a.meta.verdict); extra = ` · <span style="color:#16a34a;">우수 ${v.filter(x => x === 'good').length}</span> · 애매 ${v.filter(x => x === 'meh').length} · <span style="color:#dc2626;">OFF ${v.filter(x => x === 'off').length}</span>`; }
  return `<span class="tt-sn">지출 ${won(sp)} · 구매 ${comma(pu)}${pu ? ' · 구매당 ' + won(Math.round(sp / pu)) : ''}${extra}</span>`;
}
function admgrTtWeekRate() {   // 판정 시각 기준 최근 7일 vs 그 전 7일 — 우수 ÷ (우수+애매+OFF)
  const t = admgr.test, today = todayStr(0), w1 = admgrShiftDay(today, -6), w0 = admgrShiftDay(today, -13);
  const c = { cur: [0, 0], prev: [0, 0] };
  t.state.forEach(m => { if (!m.verdict || !m.verdict_at) return; const d = String(m.verdict_at).slice(0, 10); const k = d >= w1 ? 'cur' : d >= w0 ? 'prev' : null; if (!k) return; c[k][1]++; if (m.verdict === 'good') c[k][0]++; });
  const pct = x => (x[1] ? Math.round(x[0] / x[1] * 100) : null);
  const p = pct(c.cur), q = pct(c.prev);
  return `<div class="tt-stage tt-rate"><span class="t">이번 주 우수율</span><b>${p == null ? '–' : p + '%'}</b><small>판정 ${c.cur[1]}개 중 우수 ${c.cur[0]}${q != null ? ` · 지난주 ${q}%${p != null ? (p > q ? ' <span style="color:#16a34a;">▲</span>' : p < q ? ' <span style="color:#dc2626;">▼</span>' : '') : ''}` : ''}</small></div>`;
}
function admgrTtTable(rows, stage) {
  const t = admgr.test, C = admgrTtCols(), s2 = t.sort2 || {};
  if (!rows.length) return admgrTtList(rows, stage);
  const all = ((t.data || {}).ads || []).map(x => ({ ...x, meta: t.state.get(x.id) || {} })).filter(x => !x.meta.hidden);
  const base = admgrFunnelBase(all);
  const th = (k, label, cls) => `<th class="${cls || ''} sortable" onclick="admgrTtSort('${k}')" style="cursor:pointer;">${label}${s2.k === k ? (s2.dir === 1 ? ' ▲' : ' ▼') : ''}</th>`;
  const cols = [`<col style="width:30px;">`, `<col>`, `<col style="width:${stage === 'run' ? 130 : 176}px;">`, C.funnel ? '<col style="width:110px;">' : '', '<col style="width:86px;">', '<col style="width:48px;">', '<col style="width:120px;">', C.roas ? '<col style="width:84px;">' : '', C.asset ? '<col style="width:74px;">' : '', C.memo ? '<col style="width:96px;">' : ''].join('');
  const head = `<tr><th class="ctr"><input type="checkbox" ${rows.every(a => t.sel.has(a.id)) ? 'checked' : ''} onclick="admgrTtSelAll(${rows.every(a => t.sel.has(a.id)) ? 'false' : 'true'})"></th>
    ${th('name', '소재 · 업로드', 'tl')}<th class="ctr">${stage === 'run' ? '판정까지' : '판정 (추천 → 확정)'}</th>${C.funnel ? '<th class="tl">퍼널 진단</th>' : ''}
    ${th('spend', '지출', 'num')}${th('purch', '구매', 'num')}${th('cpa', '구매당비용', 'num')}${C.roas ? th('roas', 'ROAS', 'num') : ''}${C.asset ? '<th class="ctr">추가소재</th>' : ''}${C.memo ? '<th class="tl">메모</th>' : ''}</tr>`;
  const row = a => {
    const dp = admgrDPlus(a), thb = (t.thumbs || {})[a.id], src = thb && thb !== '-' ? thb : '', rec = admgrRecommend(a), be = admgrBreakEven(a);
    const maker = MAKER_NAMES[admgrMakerOf(a.id, a.adset_id, a.adset_name)] || '';
    const badge = a.st === 'review' ? ' <span class="status-badge badge-orange">검토중</span>' : a.st === 'rejected' ? ' <span class="status-badge badge-red">거부</span>' : a.effective_status !== 'ACTIVE' && !a.gone ? ' <span class="status-badge badge-gray" title="Meta에서 꺼져 있어요">꺼짐</span>' : '';
    let judge;
    if (stage === 'run') judge = admgrTtProg(dp);
    else if (stage === 'hidden') judge = '';
    else judge = `${rec && rec.k !== 'watch' ? `<span class="status-badge ${rec.k === 'good' ? 'badge-green' : rec.k === 'off' ? 'badge-red' : 'badge-yellow'}" style="margin-bottom:3px;" title="${esc(rec.why)}">▶ ${rec.label}</span>` : ''}${admgrTtVerdictBtns(a, rec)}<div class="tt-why">${rec ? esc(rec.why) : a.meta.verdict_at ? fmtMD(String(a.meta.verdict_at).slice(0, 10)) + ' 확정' : ''}</div>`;
    return `<tr class="${t.sel.has(a.id) ? 'sel' : ''}">
      <td class="ctr" onclick="event.stopPropagation()"><input type="checkbox" ${t.sel.has(a.id) ? 'checked' : ''} onchange="admgrTestSel('${a.id}')"></td>
      <td><div class="tt-ad"><span class="tt-th" onclick="showMetaPreview('${a.id}')" title="미리보기">${src ? `<img src="${esc(src)}" loading="lazy">` : ''}</span>
        <div style="min-width:0;cursor:pointer;" onclick="admgrTtSide('${a.id}')" title="상세 보기"><div class="tt-nm">${a.win ? '<span title="같은 상품 중 구매당비용 1등">🏆</span> ' : ''}${esc(admgrTtShort(a))}${badge}</div>
        <div class="tt-sub">${[a.reg_date ? fmtMD(a.reg_date) + ' 업로드' : '', dp == null ? '' : 'D+' + dp, maker].filter(Boolean).map(esc).join(' · ')}${!C.memo && a.meta.memo ? ` · <i class="fa-regular fa-note-sticky"></i> ${esc(a.meta.memo)}` : ''}${!C.asset && a.meta.asset_req_at ? ` · <span style="color:#7c3aed;">${a.meta.asset_done_at ? '추가소재 제작완료' : '추가소재 요청됨'}</span>` : ''}</div></div></div></td>
      <td class="ctr">${judge}</td>
      ${C.funnel ? `<td>${admgrFunnelCell(a, base)}</td>` : ''}
      <td class="num"><b>${won(a.spend || 0)}</b></td><td class="num">${comma(a.purchases || 0)}</td>
      <td class="num tt-cpa-td">${admgrTtCpa(a)}${admgrCpaChart(a, be && be.margin)}</td>
      ${C.roas ? `<td class="num">${admgrRoasTd(a)}${admgrSparkHtml(admgrTrend(a), be && be.be)}</td>` : ''}
      ${C.asset ? `<td class="ctr">${admgrAssetCell({ ...a, st: a.meta.verdict === 'good' ? 'good' : a.st })}</td>` : ''}
      ${C.memo ? `<td class="ell" onclick="event.stopPropagation();admgrTestMemo(event,'${a.id}')" title="${a.meta.memo ? esc(a.meta.memo) + ' — 클릭해서 수정' : '클릭해서 메모'}" style="cursor:text;font-size:.72rem;color:${a.meta.memo ? '#374151' : '#c4c9d4'};">${a.meta.memo ? esc(a.meta.memo) : '메모…'}</td>` : ''}</tr>`;
  };
  const nCol = 7 + ['funnel', 'roas', 'asset', 'memo'].filter(k => C[k]).length;
  const collapsed = t.collapsed || (t.collapsed = new Set());
  const body = admgrTtGroups(rows, stage).map(g => {
    const L = s2.k ? g.rows.slice().sort((x, y) => { const f = TT_SORT[s2.k], p = f(x), q = f(y); return (p < q ? -1 : p > q ? 1 : 0) * s2.dir; }) : g.rows;
    const open = !collapsed.has(g.key), sp = L.reduce((s0, a) => s0 + (a.spend || 0), 0), pu = L.reduce((s0, a) => s0 + (a.purchases || 0), 0), va = L.reduce((s0, a) => s0 + (a.value || 0), 0);
    return `<tr class="tt-gr" onclick="admgrTestGroupCollapse('${esc(g.key)}')"><td class="ctr"><i class="fa-solid fa-chevron-${open ? 'down' : 'right'}"></i></td>
      <td colspan="${C.funnel ? 3 : 2}"><b>${esc(g.title)}</b> <span>${g.sub.replace(/ · 지출 .*?건/, '')}</span>${stage === 'done' && g.rows.some(a => a.meta.verdict === 'good') ? ` <a href="#" onclick="event.stopPropagation();admgrTestGoRegister('${esc(g.title)}');return false;"><i class="fa-solid fa-cloud-arrow-up"></i> 추가소재 등록</a>` : ''}</td>
      <td class="num"><b>${won(sp)}</b></td><td class="num"><b>${comma(pu)}</b></td><td class="num"><b>${pu ? won(Math.round(sp / pu)) : '–'}</b></td>${C.roas ? `<td class="num"><b>${sp ? (va / sp).toFixed(2) : '–'}</b></td>` : ''}${C.asset ? '<td></td>' : ''}${C.memo ? '<td></td>' : ''}</tr>`
      + (open ? L.map(row).join('') : '');
  }).join('');
  return `<div class="tt-table"><table><colgroup>${cols}</colgroup><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <p style="font-size:.72rem;color:#9ca3af;margin-top:6px;">구매·구매당비용·ROAS = 클릭 후 7일 (조회 제외) · 썸네일 = 미리보기 · 이름 = 상세 패널 · 구매당비용에 마우스 = 하루별 그래프 · 열 제목 = 정렬 · 상품 줄 = 접기 · 퍼널 진단에 마우스 = 숫자</p>`;
}
