/* ⑦ 내 소재 성과 (2026-09-21 사용자 기획) — 컨텐츠마케터용 화면.
   광고관리자는 예산 조절·매출이 보여 마케터에게 열지 않는다. 이 화면은 서버 meta-ads `mycre`가 지출·전환값·예산을 아예 빼고 내려준 것만 그린다
   (ROAS·구매 건수·클릭률·3초 재생·랜딩 도착·판정·추세·추가소재 요청). 서로의 소재도 참고하라고 사람 전환은 누구에게나 열려 있다.
   (index.html의 <script> 순서 — admgr-tabs.js 뒤: admgrProductOf·showMetaPreview·admgrTestGoRegister·metaGet 재사용) */
'use strict';

const mycre = { data: null, loading: false, err: '', who: null, thumbs: {}, thumbsAsked: new Set(), moreRun: false, moreRes: false, tview: 'live', tsort: { key: 'spend', dir: -1 }, tmode: 'ad', psort: { key: 'spend', dir: -1 }, prod: '', prev: null, prevKey: '', prevLoading: false,
  range: lsGet('adc_mycre_range', null) || { preset: 'last_7d' } };   // 기간 (2026-09-22): today·yesterday·last_7d·last_14d·last_30d·custom{since,until} — 누적은 없다
const MY_PRESETS = { today: '오늘', yesterday: '어제', last_7d: '최근 7일', last_14d: '최근 14일', last_30d: '최근 30일' };

async function mycreFetch(force) {
  if (mycre.loading) return;
  if (typeof admgr === 'object' && admgr.mk && !admgr.mk.tried) { admgr.mk.tried = true; admgrMakerLoad(); }   // 만든 사람 수동 지정분 (광고관리자와 같은 저장소)
  if (!admgrCfg()) { mycre.err = '연동 정보가 없어요'; renderMycre(); return; }
  mycre.loading = true; mycre.err = ''; renderMycre();
  const rg = mycre.range, q = { action: 'mycre', preset: rg.preset };
  if (rg.preset === 'custom') { q.since = rg.since; q.until = rg.until; }
  try { mycre.data = await metaGet(q); }
  catch (e) { mycre.err = e.message; }
  mycre.loading = false; renderMycre();
}
function mycreRangeSet(preset) {
  if (preset === 'custom') { mycre.customOpen = !mycre.customOpen; renderMycre(); return; }
  mycre.range = { preset }; mycre.customOpen = false; lsSet('adc_mycre_range', mycre.range); mycreFetch(true);
}
function mycreRangeApply() {
  let a = $('my-since').value, b = $('my-until').value;
  if (!a || !b) { toast('시작일과 종료일을 골라주세요'); return; }
  if (a > b) [a, b] = [b, a];
  mycre.range = { preset: 'custom', since: a, until: b }; mycre.customOpen = false; lsSet('adc_mycre_range', mycre.range); mycreFetch(true);
}
function mycreWho(k) { mycre.who = k; mycre.moreRun = mycre.moreRes = false; renderMycre(); }
function mycreSort(k) { const t = mycre.tsort; if (t.key === k) t.dir = -t.dir; else { t.key = k; t.dir = k === 'name' || k === 'st' ? 1 : -1; } renderMycre(); }

const MY_ST = {   // 상태 → [배지 색, 글자]
  good: ['badge-green', '우수'], passed: ['badge-green', '테스트 통과 · 계속 도는 중'], meh: ['badge-yellow', '애매'], eval: ['badge-blue', '테스트중'],
  off: ['badge-red', '꺼짐'], ended: ['badge-gray', '판정 없이 종료'], review: ['badge-orange', '검토중'], rejected: ['badge-red', '거부·문제'],
};
const myRoasColor = r => r == null ? '#9ca3af' : r >= 3 ? '#15803d' : r < 1 ? '#dc2626' : '#b45309';
const myPct = (v, d) => v == null ? '—' : (Math.min(v, 1) * 100).toFixed(d || 0) + '%';
const myDplus = a => a.reg_date ? Math.max(0, daysBetween(a.reg_date, todayStr(0))) : null;
/* 만든 사람 — 수동으로 바꾼 값(광고관리자와 같은 저장소 shared_state 'makers'.ads)이 있으면 그것, 없으면 서버가 계산한 값.
   서버 응답은 10~30분 캐시라, 바꾼 직후에도 바로 보이도록 화면에서 한 번 더 덮는다 */
const myMaker = a => { const o = (typeof admgr === 'object' && admgr.mk && admgr.mk.ads) || {}; for (const m of (a.sets || [])) if (MAKER_NAMES[o[m.id]]) return o[m.id]; return a.maker; };
const myProd = a => admgrProductOf({ adset_name: a.adset_name || a.name });   // 상품명 — '만들어 달라는 요청'과 소재 등록 이동에만
const mySet = a => (typeof admgrBase === 'function' ? admgrBase(a.adset_name || '') : (a.adset_name || '')) || a.name || '(이름 없음)';   // 카드·표 제목 = 광고세트명 (2026-09-22 사용자 요청: 광고관리자에서 보던 이름 그대로여야 찾기 쉽다)
function mySpark(tr) {   // 최근 7일 일별 ROAS 막대 (비율만 — 금액 없음)
  if (!tr || !tr.daily || tr.daily.length < 3) return '';
  const cap = Math.max(3, ...tr.daily);
  return `<svg width="${tr.daily.length * 7}" height="18" style="vertical-align:bottom;" aria-label="최근 7일 ROAS 추세">${tr.daily.map((r, i) => { const h = r > 0 ? Math.max(2, Math.round(Math.min(r, cap) / cap * 18)) : 1;
    return `<rect x="${i * 7}" y="${18 - h}" width="5" height="${h}" rx="1" fill="${r <= 0 ? '#e5e7eb' : r < 1 ? '#ef4444' : '#22c55e'}"><title>ROAS ${r.toFixed(2)}</title></rect>`; }).join('')}</svg>`;
}
async function mycreThumbsEnsure(ads) {   // 보이는 카드의 썸네일만 — 세트 100개씩 (creatives 액션은 썸네일·이름만 돌려준다)
  const ids = [...new Set(ads.filter(a => mycre.thumbs[a.id] === undefined && !mycre.thumbsAsked.has(a.adset_id)).map(a => a.adset_id))].slice(0, 100);
  if (!ids.length) return;
  ids.forEach(id => mycre.thumbsAsked.add(id));
  try { const r = await metaGet({ action: 'creatives', set_ids: ids.join(',') }); (r.ads || []).forEach(x => { mycre.thumbs[x.id] = x.image || x.thumb || ''; }); renderMycre(); }
  catch (e) { /* 썸네일은 없어도 화면은 돈다 */ }
}

function renderMycre() {
  const box = $('mycre-body'); if (!box) return;
  if (!mycre.data && !mycre.loading && !mycre.err) { mycreFetch(); return; }
  if (!mycre.data) { box.innerHTML = `<div class="empty-state"><p>${mycre.err ? '불러오기 실패: ' + esc(mycre.err) : '내 소재 성과를 불러오는 중… (처음엔 10초쯤 걸려요)'}</p></div>`; return; }
  const mine = makerMine();
  if (mycre.who === null) mycre.who = mine || 'all';
  const who = mycre.who, all = mycre.data.ads || [], scope = mycre.data.scope || [];
  const list = who === 'all' ? all : all.filter(a => myMaker(a) === who);
  const whoLabel = who === 'all' ? '전체' : (MAKER_NAMES[who] || who);

  /* 사람 전환 — 내 소재 · 전체 · 나머지 마케터 (서로 다 볼 수 있다) */
  const others = Object.keys(MAKERS).filter(k => k !== mine);
  const sw = (k, label) => `<button class="filter-tab ${who === k ? 'active' : ''}" onclick="mycreWho('${k}')">${esc(label)}</button>`;
  const switcher = `<div class="filter-tabs my-who">${mine ? sw(mine, '내 소재') : ''}${sw('all', '전체')}${others.map(k => sw(k, MAKERS[k])).join('')}
    <span style="flex:1;"></span>${authIsAdmin() ? `<button class="filter-tab" onclick="mycreCfgOpen()" title="컨텐츠마케터에게 보여줄 캠페인을 고릅니다 — 고른 캠페인 안의 세트·광고만 이 화면에 나와요"><i class="fa-solid fa-filter"></i> 보여줄 캠페인${scope.length ? ' ' + scope.length : ''}</button>` : ''}<button class="filter-tab" onclick="mycreFetch(true)" ${mycre.loading ? 'disabled' : ''}><i class="fa-solid ${mycre.loading ? 'fa-spinner fa-spin' : 'fa-rotate'}"></i> 새로고침</button></div>`;

  /* 기간 — 오늘·어제·최근 7/14/30일·직접 (성과 숫자·지출·주력 판정이 전부 이 기간 기준) */
  const rg = mycre.range, rgInfo = mycre.data.range || {};
  const pbtn = (k, label) => `<button class="${rg.preset === k ? 'on' : ''}" onclick="mycreRangeSet('${k}')" ${mycre.loading ? 'disabled' : ''}>${label}</button>`;
  const period = `<div class="my-period"><span class="ag-seg">${Object.entries(MY_PRESETS).map(([k, l]) => pbtn(k, l)).join('')}${pbtn('custom', rg.preset === 'custom' ? `<i class="fa-regular fa-calendar"></i> ${esc(rg.since)} ~ ${esc(rg.until)}` : '<i class="fa-regular fa-calendar"></i> 직접 설정')}</span>
    ${rgInfo.since ? `<span class="my-sub">${esc(rgInfo.since)}${rgInfo.until !== rgInfo.since ? ' ~ ' + esc(rgInfo.until) : ''}${mycre.loading ? ' · 불러오는 중…' : ''}</span>` : ''}
    ${mycre.customOpen ? `<span class="my-custom"><input type="date" class="inp" id="my-since" value="${esc(rg.since || todayStr(-7))}" max="${todayStr(0)}" /> ~ <input type="date" class="inp" id="my-until" value="${esc(rg.until || todayStr(0))}" max="${todayStr(0)}" /><button class="btn-analyze" style="padding:5px 12px;" onclick="mycreRangeApply()">적용</button></span>` : ''}</div>`;

  /* ① 요약 — 개수만 */
  const running = list.filter(a => a.active), judged = list.filter(a => ['good', 'meh', 'off', 'ended', 'passed'].includes(a.st) && !(a.st === 'passed' && a.active && false));
  const good = list.filter(a => a.st === 'good' || a.st === 'passed').length;
  const month = todayStr(0).slice(0, 7), thisMonth = list.filter(a => String(a.reg_date).slice(0, 7) === month).length;
  const reqOpen = list.filter(a => a.asset_req_at && !a.asset_done_at);
  const tile = (label, val, sub, cls) => `<div class="kpi-tile ${cls || ''}"><div class="kt-label">${label}</div><div class="kt-value" style="font-size:1.25rem;">${val}</div>${sub ? `<div class="kt-sub">${sub}</div>` : ''}</div>`;
  const tiles = `<div class="kpi-grid my-tiles" style="margin-bottom:16px;">
    ${tile('살아남아 돌고 있는 소재', running.length + '개', `그중 주력 ${running.filter(a => a.ace).length} · 효율 애매 ${running.filter(a => a.heavy).length}`, 'kt-hero')}
    ${tile('만든 소재 (최근 60일)', list.length + '개', `이번 달 +${thisMonth}`)}
    ${tile('테스트 통과·우수', `<span style="color:#15803d;">${good}개</span>`, judged.length ? `결과 나온 ${judged.length}개 중 ${Math.round(good / judged.length * 100)}%` : '')}
    ${tile('이 소재들로 나온 구매', comma(list.reduce((s0, a) => s0 + (a.purchases || 0), 0)) + '건', esc(rgInfo.label || '') + ' 기준')}
    ${tile('만들어 달라는 요청', `<span style="color:${reqOpen.length ? '#92400e' : '#374151'};">${reqOpen.length}건</span>`, reqOpen.length ? '아래에서 확인' : '지금은 없어요', reqOpen.length ? 'my-req-tile' : '')}
  </div>`;

  /* ② 주력 소재 + 살아남은 소재 (2026-09-21 사용자 요청: "살아남은 것 중에 돈도 실리고 효율도 나는 게 이런 애들"을 보여주는 화면)
     지출은 금액이 아니라 비중(지금 켜져 있는 소재들의 누적 지출 합 = 100%)으로만. 주력·효율 애매 판정은 서버가 해서 표시만 내려준다 (기준 숫자는 관리자만) */
  running.sort((x, y) => (y.spend || 0) - (x.spend || 0) || (y.purchases || 0) - (x.purchases || 0));
  const maxShare = Math.max(1, ...running.map(a => a.spend || 0));   // 막대 길이 기준 = 살아 있는 소재 중 최대 지출
  const aces = running.filter(a => a.ace).slice(0, 6), aceIds = new Set(aces.map(a => a.id));
  const rest = running.filter(a => !aceIds.has(a.id));
  const runShow = mycre.moreRun ? rest : rest.slice(0, 10);
  setTimeout(() => mycreThumbsEnsure([...aces, ...runShow]), 0);
  const shareBar = a => `<div class="my-share" title="고른 기간 동안 이 소재에 쓴 광고비"><span>지출 <b>${won(a.spend || 0)}</b></span><i><em style="width:${Math.min(100, (a.spend || 0) / maxShare * 100)}%;"></em></i></div>`;
  const card = a => {
    const st = MY_ST[a.st] || ['badge-gray', a.st], dp = myDplus(a), tired = a.trend && a.trend.tired, src = mycre.thumbs[a.id];
    const badge = a.ace ? '<span class="status-badge my-ace-b"><i class="fa-solid fa-star"></i> 주력</span>' : a.heavy ? '<span class="status-badge badge-orange">효율 애매</span>' : `<span class="status-badge ${st[0]}">${st[1]}</span>`;
    return `<div class="my-card ${a.ace ? 'ace' : a.heavy ? 'heavy' : ''} ${tired ? 'tired' : ''}" onclick="mycreDetail('${a.id}')" title="누르면 자세히">
      <div class="my-thumb">${src ? `<img src="${esc(src)}" loading="lazy" alt="" />` : '<i class="fa-regular fa-image"></i>'}${badge}${tired ? '<span class="status-badge badge-red my-tired">식는 중</span>' : ''}${a.n > 1 ? `<span class="my-n" title="같은 소재가 광고 ${a.n}곳에서 돌았어요 — 성과를 합쳐서 보여줘요">${a.n}곳</span>` : ''}</div>
      <div class="my-cbody">
        <b class="my-name" title="${esc(a.adset_name)}">${esc(mySet(a))}</b>
        <div class="my-sub ell">${[a.tag, a.kind === 'video' ? '릴스·영상' : a.kind === 'image' ? '이미지' : '', dp == null ? '' : 'D+' + dp, who === 'all' ? (MAKER_NAMES[myMaker(a)] || '') : '', scope.length > 1 ? a.camp : ''].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="my-nums"><span>ROAS<b style="color:${myRoasColor(a.roas)};">${a.roas == null ? '—' : a.roas.toFixed(2)}</b></span><span>구매<b>${comma(a.purchases || 0)}</b></span><span class="my-sp">${mySpark(a.trend)}</span></div>
        ${shareBar(a)}
        ${tired ? '<div class="my-warn">최근 7일이 누적의 절반 아래 — 교체 소재를 준비해 주세요</div>' : a.heavy ? '<div class="my-warn" style="color:#9a3412;">돈은 많이 실리는데 효율이 애매해요</div>' : ''}
      </div></div>`;
  };
  const aceSec = aces.length ? `<div class="my-h"><b><i class="fa-solid fa-star" style="color:#4f46e5;"></i> 주력 소재</b><span>살아남은 것 중에서 ${esc(rgInfo.label || '')} 동안 돈도 많이 실리고 효율도 제대로 나온 소재</span></div><div class="my-grid my-grid-ace">${aces.map(card).join('')}</div>${mycreCommonHtml(list)}` : '';
  const deltaSec = mycreDeltaHtml(list);
  const runSec = aceSec + deltaSec + `<div class="my-h"><b>살아남은 ${who === 'all' ? '' : esc(whoLabel) + ' '}소재</b><span>지금 돌고 있는 것 · 지출 큰 순 · 주황 테두리 = 돈은 실리는데 효율이 애매 · 카드를 누르면 자세히</span></div>
    ${running.length ? `<div class="my-grid">${runShow.map(card).join('')}</div>${rest.length > runShow.length ? `<button class="btn-ghost my-more" onclick="mycre.moreRun=true;renderMycre()">나머지 ${rest.length - runShow.length}개 더 보기</button>` : ''}`
      : '<div class="empty-state" style="padding:24px;"><p>지금 돌고 있는 소재가 없어요.</p></div>'}`;

  /* ③ 광고관리자식 표 — 보기 전용 (켜고 끄기·예산·수정 없음). 살아남은 것 / 꺼진 것 / 전체 전환, 머리글 정렬. 꺼진 것이 보일 때는 '이유'(퍼널 진단) 열이 붙는다 */
  const tv = mycre.tview, ts = mycre.tsort;
  const pool0 = tv === 'live' ? running : tv === 'off' ? list.filter(a => !a.active) : list;
  const pool = mycre.prod ? pool0.filter(a => myProd(a) === mycre.prod) : pool0;
  const val = (a, k) => k === 'name' ? mySet(a) : k === 'st' ? ((MY_ST[a.st] || [])[1] || '') : k === 'd' ? (myDplus(a) ?? -1) : (a[k] ?? -1);
  const sorted = pool.slice().sort((x, y) => { const p = val(x, ts.key), q = val(y, ts.key); return (typeof p === 'string' ? p.localeCompare(q) : p - q) * ts.dir; });
  const tShow = mycre.moreRes ? sorted : sorted.slice(0, 30);
  const showWhy = tv !== 'live';
  const th = (k, label, cls) => `<th class="sortable ${cls || ''}" onclick="mycreSort('${k}')" title="누르면 정렬">${label}${ts.key === k ? (ts.dir < 0 ? ' ▼' : ' ▲') : ''}</th>`;
  const tvBtn = (k, label, n) => `<button class="filter-tab ${tv === k ? 'active' : ''}" onclick="mycre.tview='${k}';mycre.moreRes=false;renderMycre()">${label} ${n}</button>`;
  const stCell = a => { const st = MY_ST[a.st] || ['badge-gray', a.st]; return `<span class="status-badge ${a.ace ? 'my-ace-b' : a.heavy ? 'badge-orange' : st[0]}">${a.ace ? '주력' : a.heavy ? '효율 애매' : st[1]}</span>`; };
  const tRows = tShow.map(a => `<tr onclick="mycreDetail('${a.id}')" style="cursor:pointer;" title="누르면 자세히">
      <td style="text-align:left;" class="name-cell"><b>${a.ace ? '<i class="fa-solid fa-star" style="color:#4f46e5;font-size:.8em;"></i> ' : ''}${esc(mySet(a))}</b><div class="my-sub ell" title="${esc(a.adset_name)}">${[a.tag, a.reg_date ? fmtMD(a.reg_date) : '', who === 'all' ? (MAKER_NAMES[myMaker(a)] || '') : '', scope.length > 1 ? a.camp : ''].filter(Boolean).map(esc).join(' · ')}</div></td>
      <td class="ctr">${stCell(a)}</td>
      <td class="num"><span class="my-tbar"><em style="width:${Math.min(100, (a.spend || 0) / maxShare * 100)}%;"></em></span> ${won(a.spend || 0)}</td>
      <td class="num">${comma(a.purchases || 0)}</td><td class="num"><b style="color:${myRoasColor(a.roas)};">${a.roas == null ? '—' : a.roas.toFixed(2)}</b></td>
      <td class="num m-hide">${myPct(a.ctr, 2)}</td><td class="num m-hide">${myPct(a.ts)}</td><td class="num m-hide">${myDplus(a) == null ? '—' : 'D+' + myDplus(a)}</td>
      ${showWhy ? `<td style="text-align:left;" class="my-why m-hide">${a.active ? '' : `<b class="my-why-${a.diag.k}">${esc(a.diag.label)}</b> <span>— ${esc(a.diag.fix)}</span>`}</td>` : ''}</tr>`).join('');
  const modeBtn = (k, label) => `<button class="${mycre.tmode === k ? 'on' : ''}" onclick="mycre.tmode='${k}';mycre.moreRes=false;renderMycre()">${label}</button>`;
  const adTable = `<div class="filter-tabs" style="margin-bottom:10px;">${tvBtn('live', '살아남은 것', running.length)}${tvBtn('off', '꺼진 것 (이유 보기)', list.length - running.length)}${tvBtn('all', '전체', list.length)}
      ${mycre.prod ? `<span class="my-prodchip">상품: ${esc(mycre.prod)} <a href="#" onclick="mycre.prod='';renderMycre();return false;" aria-label="상품 필터 해제"><i class="fa-solid fa-xmark"></i></a></span>` : ''}</div>
    ${pool.length ? `<div class="table-wrap"><table class="my-table"><thead><tr>${th('name', '소재', 'l')}${th('st', '상태')}${th('spend', '지출', 'num')}${th('purchases', '구매', 'num')}${th('roas', 'ROAS', 'num')}${th('ctr', '클릭률', 'num m-hide')}${th('ts', '3초 재생', 'num m-hide')}${th('d', '일수', 'num m-hide')}${showWhy ? '<th class="m-hide" style="text-align:left;">이유</th>' : ''}</tr></thead><tbody>${tRows}</tbody></table></div>
      ${sorted.length > tShow.length ? `<button class="btn-ghost my-more" onclick="mycre.moreRes=true;renderMycre()">나머지 ${sorted.length - tShow.length}개 더 보기</button>` : ''}`
      : '<div class="empty-state" style="padding:24px;"><p>해당하는 소재가 없어요.</p></div>'}`;
  const resSec = `<div class="my-h"><b>전체 표</b><span class="ag-seg my-mode">${modeBtn('ad', '소재별')}${modeBtn('prod', '상품별')}</span><span>${mycre.tmode === 'prod' ? '상품마다 소재가 몇 개 살아 있고 주력이 몇 개인지 · 줄을 누르면 그 상품의 소재만' : '광고관리자처럼 한 줄씩 · 머리글을 누르면 정렬 · 보기 전용'}</span></div>
    ${mycre.tmode === 'prod' ? mycreProdTable(list) : adTable}`;

  /* ④ 만들어 달라는 요청 + 잘 먹힌 것 */
  const reqs = list.filter(a => a.asset_req_at).sort((x, y) => (x.asset_done_at ? 1 : 0) - (y.asset_done_at ? 1 : 0) || String(y.asset_req_at).localeCompare(String(x.asset_req_at))).slice(0, 8);
  const reqSec = `<div class="my-h"><b>만들어 달라는 요청</b></div><div class="my-reqs">${reqs.length ? reqs.map(a => `<div class="my-req ${a.asset_done_at ? 'done' : ''}">
      <b>${esc(myProd(a))}</b>
      <div class="my-sub">${MY_ST[a.st] ? MY_ST[a.st][1] : ''} · ${fmtMD(String(a.asset_req_at).slice(0, 10))} 요청${a.asset_done_at ? ` · <span style="color:#15803d;font-weight:700;">${fmtMD(String(a.asset_done_at).slice(0, 10))} 제작 완료</span>` : ''}${a.tag ? ' · ' + esc(a.tag) + ' 컷이 잘 먹혔어요' : ''}</div>
      ${a.asset_done_at ? '' : `<button class="btn-analyze" style="padding:5px 12px;font-size:.74rem;align-self:flex-start;" onclick="admgrTestGoRegister('${esc(myProd(a))}')"><i class="fa-solid fa-cloud-arrow-up"></i> 소재 등록하러 가기</button>`}</div>`).join('')
    : '<div class="my-sub" style="padding:6px 2px;">지금은 요청이 없어요 — 우수 소재가 나오면 여기에 떠요.</div>'}</div>`;
  const rate = (key, label) => { const m = new Map(); list.filter(a => a[key] && ['good', 'passed', 'meh', 'off', 'ended'].includes(a.st)).forEach(a => { const o = m.get(a[key]) || m.set(a[key], { n: 0, g: 0 }).get(a[key]); o.n++; if (a.st === 'good' || a.st === 'passed') o.g++; });
    const best = [...m.entries()].filter(([, o]) => o.n >= 3 && o.g > 0).sort((x, y) => y[1].g / y[1].n - x[1].g / x[1].n)[0];
    return best ? `${label} <b>${esc(best[0] === 'video' ? '릴스·영상' : best[0] === 'image' ? '이미지' : best[0])}</b> ${best[1].n}개 중 ${best[1].g}개 통과` : ''; };
  const tips = [rate('tag', '소구점'), rate('kind', '형식')].filter(Boolean);
  const tipSec = tips.length ? `<div class="my-tip"><b>${who === 'all' ? '전체에서' : esc(whoLabel) + ' 소재에서'} 잘 먹힌 것</b><br/>${tips.join(' · ')}</div>` : '';

  box.innerHTML = switcher + period + tiles + runSec + resSec + `<div class="my-two"><div>${reqSec}</div><div>${tipSec ? '<div class="my-h"><b>패턴</b></div>' + tipSec : ''}</div></div>
    <div class="info-bar" style="margin-top:14px;"><i class="fa-regular fa-clock"></i> ${admgrAgo(mycre.data.fetched_at)} 기준 · 성과·지출·주력은 <b>${esc(rgInfo.label || '')}</b> 기준 (최근 N일은 광고관리자처럼 오늘 제외) · 일예산·예산 변경·마진은 이 화면에 나오지 않아요${scope.length ? ` · 보는 범위: ${scope.map(esc).join(', ')}` : ''}</div>`;
}

/* ── 보여줄 캠페인 (관리자, 2026-09-21) — 고른 캠페인 안의 세트·광고만 이 화면에 나온다. shared_state 'mycre_cfg' (저장은 서버가 관리자만 허용).
   아무것도 안 고르면 예전처럼 테스트 소재 전체(세트명에 test) 기준 ── */
async function mycreCfgOpen() {
  $('abm-title').textContent = '내 소재 성과 — 보여줄 캠페인 · 주력 기준'; $('abm-sub').textContent = '고른 캠페인 안의 광고세트·광고만 컨텐츠마케터에게 보여요';
  $('abm-body').innerHTML = '<div style="padding:16px;color:#6b7280;font-size:.8rem;">캠페인 목록을 불러오는 중…</div>';
  $('admgr-budget-modal').classList.add('show');
  try {
    const [cfg, h] = await Promise.all([sbCall('client-log', { action: 'state_get', key: 'mycre_cfg' }), (typeof admgr === 'object' && admgr.data) ? admgr.data : metaGet({ action: 'hierarchy', preset: 'today' })]);
    const picked = new Set((((cfg || {}).data || {}).campaigns || []).map(x => String(x.id)));
    const ace = Object.assign({ top: 20, roas: 3, pur: 5 }, ((cfg || {}).data || {}).ace || {});
    mycre.cfgVer = (cfg && cfg.ver) || null;
    const camps = (h.campaigns || []).slice().sort((x, y) => (x.status === 'ACTIVE' ? 0 : 1) - (y.status === 'ACTIVE' ? 0 : 1) || String(x.name).localeCompare(String(y.name)));
    $('abm-body').innerHTML = `<div style="max-height:52vh;overflow:auto;border:1px solid #e7e8ee;border-radius:10px;">${camps.map(c => `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid #f0f1f5;cursor:pointer;font-size:.8rem;">
        <input type="checkbox" class="mycre-camp" value="${esc(c.id)}" data-name="${esc(c.name)}" ${picked.has(String(c.id)) ? 'checked' : ''} style="margin:0;" />
        <span style="flex:1;min-width:0;" class="ell"><b style="color:#1e1b4b;">${esc(c.name)}</b></span>
        <span class="status-badge ${c.status === 'ACTIVE' ? 'badge-green' : 'badge-gray'}" style="font-size:.62rem;">${c.status === 'ACTIVE' ? '켜짐' : '꺼짐'}</span>
        <span style="font-size:.68rem;color:#9ca3af;white-space:nowrap;">세트 ${(c.adsets || []).length}</span></label>`).join('')}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:12px;padding:10px 12px;background:#f8fafc;border:1px solid #e7e8ee;border-radius:10px;font-size:.76rem;">
        <b style="color:#1e1b4b;"><i class="fa-solid fa-star" style="color:#4f46e5;"></i> 주력 소재 기준</b>
        <label>지출 상위 <input class="inp" id="mycre-ace-top" type="number" min="1" max="100" step="1" value="${ace.top}" style="width:64px;padding:3px 6px;" />% 안</label>
        <label>ROAS <input class="inp" id="mycre-ace-roas" type="number" min="0" step="0.1" value="${ace.roas}" style="width:64px;padding:3px 6px;" /> 이상</label>
        <label>구매 <input class="inp" id="mycre-ace-pur" type="number" min="0" step="1" value="${ace.pur}" style="width:64px;padding:3px 6px;" />건 이상</label>
        <span style="color:#9ca3af;">지출은 상위인데 ROAS가 모자라면 '효율 애매' · 이 숫자는 마케터에게 안 보여요</span></div>
      <div style="font-size:.7rem;color:#9ca3af;margin-top:8px;">아무것도 안 고르면 세트명에 test가 든 소재 전체가 기준이에요. 저장하면 1~2분 안에 새 범위로 다시 계산돼요.</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;"><button class="btn-ghost" onclick="closeModal('admgr-budget-modal')">취소</button><button class="btn-analyze" id="mycre-cfg-go" onclick="mycreCfgSave()">저장</button></div>`;
  } catch (e) { $('abm-body').innerHTML = `<div style="padding:16px;color:#dc2626;font-size:.8rem;">불러오기 실패: ${esc(e.message)}</div>`; }
}
async function mycreCfgSave() {
  const campaigns = [...document.querySelectorAll('.mycre-camp:checked')].map(el => ({ id: el.value, name: el.dataset.name }));
  const btn = $('mycre-cfg-go'); btn.disabled = true; btn.textContent = '저장 중…';
  try {
    const num = (id, d) => { const v = parseFloat($(id).value); return isFinite(v) && v >= 0 ? v : d; };
    const ace = { top: Math.min(100, Math.max(1, num('mycre-ace-top', 20))), roas: num('mycre-ace-roas', 3), pur: num('mycre-ace-pur', 5) };
    const r = await sbCall('client-log', { action: 'state_set' }, { key: 'mycre_cfg', base: mycre.cfgVer, data: { campaigns, ace } });
    if (r.conflict) throw new Error('다른 사람이 먼저 바꿨어요 — 창을 닫고 다시 열어주세요');
    closeModal('admgr-budget-modal'); toast(campaigns.length ? `캠페인 ${campaigns.length}개로 범위를 정했어요 — 다시 계산 중` : '범위를 풀었어요 — 다시 계산 중');
    mycre.data = null; mycre.thumbsAsked.clear(); mycreFetch(true);
  } catch (e) { btn.disabled = false; btn.textContent = '저장'; toast('저장 실패: ' + e.message); }
}

/* ═══ 고도화 (2026-09-22): 주력 공통점 · 소재 생애 · 상세 창 · 상품별 · 지난 기간 대비 ═══ */
function mycreProdSort(k) { const t = mycre.psort; if (t.key === k) t.dir = -t.dir; else { t.key = k; t.dir = k === 'name' ? 1 : -1; } renderMycre(); }
function mycreProdPick(name) { mycre.prod = name; mycre.tmode = 'ad'; mycre.tview = 'all'; mycre.moreRes = false; renderMycre(); const el = document.querySelector('#sec-mycre .my-mode'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

/* ② 주력 소재의 공통점 — 주력 vs 꺼진 것에서 어느 쪽에 치우친 특징인지 (형식·소구점·AI 태그). 표본이 적으면 말하지 않는다 */
function mycreCommonHtml(list) {
  const A = list.filter(a => a.ace), B = list.filter(a => !a.active && a.st === 'off');
  if (A.length < 5 || B.length < 5) return '';
  const axes = [['형식', a => a.kind === 'video' ? '릴스·영상' : a.kind === 'image' ? '이미지' : ''], ['소구점', a => a.tag || ''],
    ['장면', a => a.ai && a.ai.cut ? a.ai.cut + ' 컷' : ''], ['자막', a => a.ai && a.ai.text != null ? (a.ai.text ? '자막 있음' : '자막 없음') : ''],
    ['사이즈 표기', a => a.ai && a.ai.size != null ? (a.ai.size ? '사이즈 보임' : '사이즈 안 보임') : ''], ['첫 장면', a => a.ai && a.ai.hook ? '첫 장면 ' + a.ai.hook : '']];
  const rows = [];
  for (const [axis, f] of axes) {
    const ka = A.map(f).filter(Boolean), kb = B.map(f).filter(Boolean);
    if (ka.length < 5 || kb.length < 5) continue;
    for (const v of new Set([...ka, ...kb])) { const na = ka.filter(x => x === v).length, nb = kb.filter(x => x === v).length, pa = na / ka.length, pb = nb / kb.length;
      rows.push({ axis, v, na, ta: ka.length, pa, nb, tb: kb.length, pb, d: pa - pb }); }
  }
  const up = rows.filter(r => r.na >= 3 && r.d >= 0.15).sort((x, y) => y.d - x.d).slice(0, 4), upAxes = new Set(up.map(r => r.axis)), down = rows.filter(r => r.nb >= 3 && r.d <= -0.15 && !upAxes.has(r.axis)).sort((x, y) => x.d - y.d).slice(0, 3);   // 같은 항목의 거울상(릴스↑ = 이미지↓)은 한 번만
  if (!up.length && !down.length) return '';
  const pc = v => Math.round(v * 100) + '%';
  const li = (r, good) => `<li><b>${esc(r.v)}</b> <span class="my-sub">${esc(r.axis)}</span> — 주력 ${r.ta}개 중 <b style="color:${good ? '#15803d' : '#374151'};">${r.na}개(${pc(r.pa)})</b> · 꺼진 것 ${r.tb}개 중 <b style="color:${good ? '#374151' : '#b91c1c'};">${r.nb}개(${pc(r.pb)})</b></li>`;
  return `<div class="my-common"><div class="my-common-h"><i class="fa-solid fa-lightbulb"></i> 주력 소재의 공통점 <span class="my-sub">주력 ${A.length}개와 꺼진 것 ${B.length}개를 비교 · 한쪽에 치우친 특징만</span></div>
    <div class="my-common-body">${up.length ? `<div><div class="my-common-t" style="color:#15803d;">주력에 많은 것</div><ul>${up.map(r => li(r, true)).join('')}</ul></div>` : ''}
    ${down.length ? `<div><div class="my-common-t" style="color:#b91c1c;">꺼진 것에 많은 것</div><ul>${down.map(r => li(r, false)).join('')}</ul></div>` : ''}</div></div>`;
}

/* ⑥ 지난 기간 대비 — 같은 길이의 바로 앞 기간을 뒤에서 조용히 받아와(같은 서버 액션·캐시) 주력에 새로 든 것·빠진 것을 소재 키로 비교 */
function mycrePrevRange() {
  const r = (mycre.data || {}).range; if (!r || !r.since) return null;
  const len = daysBetween(r.since, r.until) + 1, until = admgrShiftDay(r.since, -1), since = admgrShiftDay(until, -(len - 1));
  return { since, until, key: since + '_' + until };
}
async function mycrePrevEnsure() {
  const pr = mycrePrevRange(); if (!pr || mycre.prevLoading || mycre.prevKey === pr.key) return;
  mycre.prevLoading = true;
  try { const d = await metaGet({ action: 'mycre', preset: 'custom', since: pr.since, until: pr.until }); mycre.prev = d; mycre.prevKey = pr.key; }
  catch (e) { mycre.prev = null; mycre.prevKey = pr.key; }
  mycre.prevLoading = false; if (curMenu === 'mycre') renderMycre();
}
function mycreDeltaHtml(list) {
  const pr = mycrePrevRange(); if (!pr) return '';
  if (mycre.prevKey !== pr.key) { setTimeout(mycrePrevEnsure, 0); return `<div class="my-delta my-sub"><i class="fa-solid fa-spinner fa-spin"></i> 지난 기간(${esc(pr.since)} ~ ${esc(pr.until)})과 비교하는 중…</div>`; }
  if (!mycre.prev) return '';
  const who = mycre.who, prevAds = (mycre.prev.ads || []).filter(a => who === 'all' || myMaker(a) === who);
  const was = new Map(prevAds.filter(a => a.ace).map(a => [a.key, a])), now = new Map(list.filter(a => a.ace).map(a => [a.key, a])), cur = new Map(list.map(a => [a.key, a]));
  const inn = [...now.values()].filter(a => !was.has(a.key)), out = [...was.values()].filter(a => !now.has(a.key));
  if (!inn.length && !out.length) return `<div class="my-delta my-sub">지난 기간(${esc(pr.since)} ~ ${esc(pr.until)})과 주력 소재가 같아요.</div>`;
  const whyOut = a => { const c = cur.get(a.key); return !c || !c.active ? '꺼짐' : c.heavy || (c.roas != null && c.roas < (a.roas || 0) * 0.7) ? `효율 하락 (ROAS ${(a.roas || 0).toFixed(1)} → ${c.roas == null ? '—' : c.roas.toFixed(1)})` : '지출 순위에서 밀림'; };
  const item = (a, sub) => `<button class="my-delta-i" onclick="mycreDetail('${(cur.get(a.key) || a).id}')">${esc(mySet(a))}${sub ? ` <span class="my-sub">${esc(sub)}</span>` : ''}</button>`;
  return `<div class="my-delta"><div class="my-delta-h">지난 기간 대비 <span class="my-sub">${esc(pr.since)} ~ ${esc(pr.until)} 의 주력과 비교</span></div>
    ${inn.length ? `<div class="my-delta-row"><span class="status-badge badge-green">새로 주력 ${inn.length}</span>${inn.slice(0, 8).map(a => item(a, `ROAS ${a.roas == null ? '—' : a.roas.toFixed(1)} · 구매 ${a.purchases}`)).join('')}</div>` : ''}
    ${out.length ? `<div class="my-delta-row"><span class="status-badge badge-gray">주력에서 빠짐 ${out.length}</span>${out.slice(0, 8).map(a => item(a, whyOut(a))).join('')}</div>` : ''}</div>`;
}

/* ⑤ 상품별 — 소재 몇 개 중 몇 개가 살아 있고 주력이 몇 개인지. ROAS는 지출로 가중 평균 */
function mycreProdTable(list) {
  const m = new Map();
  for (const a of list) { const k = myProd(a), o = m.get(k) || m.set(k, { name: k, n: 0, live: 0, aces: 0, spend: 0, purchases: 0, w: 0, wv: 0 }).get(k);
    o.n++; if (a.active) o.live++; if (a.ace) o.aces++; o.spend += a.spend || 0; o.purchases += a.purchases || 0; if (a.roas != null && a.spend) { o.w += a.spend; o.wv += a.spend * a.roas; } }
  const rows = [...m.values()].map(o => ({ ...o, roas: o.w > 0 ? o.wv / o.w : null, short: (o.aces > 0 || (o.w > 0 && o.wv / o.w >= 3 && o.purchases >= 5)) && o.live <= 1 }));
  const ps = mycre.psort; rows.sort((x, y) => { const p = x[ps.key] ?? -1, q = y[ps.key] ?? -1; return (typeof p === 'string' ? p.localeCompare(q) : p - q) * ps.dir; });
  const show = mycre.moreRes ? rows : rows.slice(0, 40), maxS = Math.max(1, ...rows.map(r => r.spend));
  const th = (k, label, cls) => `<th class="sortable ${cls || ''}" onclick="mycreProdSort('${k}')" title="누르면 정렬">${label}${ps.key === k ? (ps.dir < 0 ? ' ▼' : ' ▲') : ''}</th>`;
  return `<div class="table-wrap"><table class="my-table"><thead><tr>${th('name', '상품', 'l')}${th('n', '소재', 'num')}${th('live', '살아 있는 것', 'num')}${th('aces', '주력', 'num')}${th('spend', '지출', 'num')}${th('purchases', '구매', 'num')}${th('roas', 'ROAS', 'num')}<th style="text-align:left;" class="m-hide">신호</th></tr></thead><tbody>
    ${show.map(r => `<tr onclick="mycreProdPick('${esc(r.name).replace(/'/g, '&#39;')}')" style="cursor:pointer;" title="누르면 이 상품의 소재만 보기">
      <td style="text-align:left;" class="name-cell"><b>${esc(r.name)}</b></td><td class="num">${r.n}</td><td class="num">${r.live}</td><td class="num">${r.aces ? `<b style="color:#4f46e5;">${r.aces}</b>` : '0'}</td>
      <td class="num"><span class="my-tbar"><em style="width:${Math.min(100, r.spend / maxS * 100)}%;"></em></span> ${won(r.spend)}</td><td class="num">${comma(r.purchases)}</td>
      <td class="num"><b style="color:${myRoasColor(r.roas)};">${r.roas == null ? '—' : r.roas.toFixed(2)}</b></td>
      <td style="text-align:left;" class="m-hide">${r.short ? '<span class="status-badge badge-orange">효율 좋은데 살아 있는 소재 ' + r.live + '개 — 추가 소재 필요</span>' : r.live === 0 ? '<span class="my-sub">지금 도는 소재 없음</span>' : ''}</td></tr>`).join('')}
    </tbody></table></div>${rows.length > show.length ? `<button class="btn-ghost my-more" onclick="mycre.moreRes=true;renderMycre()">나머지 ${rows.length - show.length}개 더 보기</button>` : ''}`;
}

/* ④ 상세 창 — 소재 하나의 숫자·진단·추세·AI 태그 + ③ 이 소재가 도는 곳(테스트 → CBO) + 같은 상품의 다른 소재와 비교 */
function mycreDetail(id) {
  const all = (mycre.data || {}).ads || [], a = all.find(x => x.id === id); if (!a) return;
  const st = MY_ST[a.st] || ['badge-gray', a.st], src = mycre.thumbs[a.id], rg = (mycre.data.range || {}).label || '';
  const cell = (label, val, color) => `<div class="my-dcell"><i>${label}</i><b${color ? ` style="color:${color};"` : ''}>${val}</b></div>`;
  const sib = all.filter(x => x.id !== a.id && myProd(x) === myProd(a)).sort((x, y) => (y.spend || 0) - (x.spend || 0)).slice(0, 12);
  const ai = a.ai ? [a.ai.hook ? '첫 장면 ' + a.ai.hook : '', a.ai.cuts ? '컷 ' + a.ai.cuts + '개' : '', a.ai.cut ? a.ai.cut + ' 컷' : '', a.ai.text == null ? '' : a.ai.text ? '자막 있음' : '자막 없음', a.ai.size == null ? '' : a.ai.size ? '사이즈 보임' : '사이즈 안 보임'].filter(Boolean) : [];
  $('mycre-modal-title').textContent = mySet(a);
  $('mycre-modal-body').innerHTML = `<div class="my-dtop">
      <div class="my-dthumb">${src ? `<img src="${esc(src)}" alt="" />` : '<i class="fa-regular fa-image"></i>'}
        <button class="btn-analyze" onclick="closeModal('mycre-modal');showMetaPreview('${a.id}')"><i class="fa-solid fa-play"></i> 소재·문구 미리보기</button></div>
      <div class="my-dmain">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">${a.ace ? '<span class="status-badge my-ace-b"><i class="fa-solid fa-star"></i> 주력</span>' : ''}${a.heavy ? '<span class="status-badge badge-orange">효율 애매</span>' : ''}<span class="status-badge ${st[0]}">${st[1]}</span>${a.trend && a.trend.tired ? '<span class="status-badge badge-red">식는 중</span>' : ''}
          <label class="my-mksel" title="자기 소재가 아니면 여기서 바꿔요 — 광고관리자의 '만든 사람' 거르기에도 똑같이 반영돼요">만든 사람 <select class="inp" onchange="mycreMakerSet('${a.id}',this.value)">${Object.entries({ ...MAKERS, ...(MAKERS[myMaker(a)] ? {} : { [myMaker(a)]: MAKER_NAMES[myMaker(a)] || myMaker(a) }) }).map(([k, n]) => `<option value="${esc(k)}" ${k === myMaker(a) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
          <span class="my-sub">${[a.tag, a.kind === 'video' ? '릴스·영상' : a.kind === 'image' ? '이미지' : '', myDplus(a) == null ? '' : 'D+' + myDplus(a)].filter(Boolean).map(esc).join(' · ')}</span></div>
        <div class="my-dgrid">${cell('ROAS', a.roas == null ? '—' : a.roas.toFixed(2), myRoasColor(a.roas))}${cell('구매', comma(a.purchases || 0))}${cell('지출', won(a.spend || 0))}
          ${cell('클릭률', myPct(a.ctr, 2))}${cell('3초 재생', myPct(a.ts))}${cell('랜딩 도착', myPct(a.lpvR))}${cell('장바구니', a.atc == null ? '—' : comma(a.atc))}${cell('방문 → 구매', myPct(a.cvr, 2))}${cell('같은 사람에게', a.freq ? a.freq.toFixed(1) + '회' : '—')}</div>
        <div class="my-ddiag"><b class="my-why-${a.diag.k}">${esc(a.diag.label)}</b> — ${esc(a.diag.fix)}</div>
        <div class="my-sub">${esc(rg)} 기준${a.trend && a.trend.daily && a.trend.daily.length >= 3 ? ` · 최근 7일 추세 ${mySpark(a.trend)}` : ''}${ai.length ? ' · ' + ai.map(esc).join(' · ') : ''}</div>
      </div></div>
    <div class="my-h" style="margin-top:14px;"><b>이 소재가 도는 곳</b><span>${a.n > 1 ? `같은 영상·이미지가 광고 ${a.n}곳에서 돌았어요 — 위 숫자는 전부 합친 것` : '지금은 한 곳에서만 돌아요'}</span></div>
    <div class="table-wrap"><table class="my-table"><thead><tr><th style="text-align:left;">광고세트</th><th style="text-align:left;" class="m-hide">캠페인</th><th>상태</th><th class="num">지출</th><th class="num">구매</th><th class="num">ROAS</th></tr></thead><tbody>
      ${(a.sets || []).map(x => `<tr><td style="text-align:left;" class="name-cell"><b>${esc(typeof admgrBase === 'function' ? admgrBase(x.adset_name) : x.adset_name)}</b><div class="my-sub">${x.reg_date ? fmtMD(x.reg_date) + ' 시작' : ''}</div></td><td style="text-align:left;" class="m-hide my-sub">${esc(x.camp)}</td>
        <td class="ctr"><span class="status-badge ${x.active ? 'badge-green' : 'badge-gray'}">${x.active ? '도는 중' : '꺼짐'}</span></td><td class="num">${won(x.spend || 0)}</td><td class="num">${comma(x.purchases || 0)}</td><td class="num"><b style="color:${myRoasColor(x.roas)};">${x.roas == null ? '—' : x.roas.toFixed(2)}</b></td></tr>`).join('')}</tbody></table></div>
    <div class="my-h" style="margin-top:14px;"><b>같은 상품의 다른 소재</b><span>${esc(myProd(a))} · ${sib.length ? `${sib.length}개와 비교` : '다른 소재가 없어요'}</span></div>
    ${sib.length ? `<div class="table-wrap"><table class="my-table"><thead><tr><th style="text-align:left;">소재</th><th>상태</th><th class="num">지출</th><th class="num">구매</th><th class="num">ROAS</th><th style="text-align:left;" class="m-hide">진단</th></tr></thead><tbody>
      ${sib.map(x => { const s2 = MY_ST[x.st] || ['badge-gray', x.st]; return `<tr onclick="mycreDetail('${x.id}')" style="cursor:pointer;"><td style="text-align:left;" class="name-cell"><b>${x.ace ? '<i class="fa-solid fa-star" style="color:#4f46e5;font-size:.8em;"></i> ' : ''}${esc(mySet(x))}</b></td>
        <td class="ctr"><span class="status-badge ${s2[0]}">${s2[1]}</span></td><td class="num">${won(x.spend || 0)}</td><td class="num">${comma(x.purchases || 0)}</td><td class="num"><b style="color:${myRoasColor(x.roas)};">${x.roas == null ? '—' : x.roas.toFixed(2)}</b></td>
        <td style="text-align:left;" class="m-hide my-sub">${esc(x.diag.label)}</td></tr>`; }).join('')}</tbody></table></div>` : ''}`;
  $('mycre-modal').classList.add('show');
  if (mycre.thumbs[a.id] === undefined) mycreThumbsEnsure([a]);
}

/* 만든 사람 바꾸기 (2026-09-22 사용자 요청: 자기 소재가 아닌 게 섞여 있을 수 있다) — 광고관리자와 같은 저장소(shared_state 'makers')에 적어 양쪽에 똑같이 반영.
   · 이 소재의 모든 광고 id → makers.ads (광고 단위, 최우선)  · 그 광고만 들어 있는 세트(1세트-1광고)는 makers.sets에도 → 광고관리자 '광고세트' 탭의 세트 단위 거르기에도 맞게
   · CBO처럼 여러 소재가 섞인 세트는 세트 단위로 적지 않는다 (남의 소재까지 바뀌니까) */
async function mycreMakerSet(id, key) {
  const all = (mycre.data || {}).ads || [], a = all.find(x => x.id === id); if (!a || !MAKER_NAMES[key]) return;
  const m = admgr.mk, shared = new Map();   // 세트 id → 그 세트에 든 소재 수
  for (const x of all) for (const st of new Set((x.sets || []).map(z => z.adset_id).filter(Boolean))) shared.set(st, (shared.get(st) || 0) + 1);
  const apply = () => { for (const z of (a.sets || [])) { m.ads[z.id] = key; if (z.adset_id && shared.get(z.adset_id) === 1) m.sets[z.adset_id] = key; } };
  for (let tries = 0; tries < 2; tries++) {
    try {
      const cur = await sbCall('client-log', { action: 'state_get', key: 'makers' });   // 최신본 위에 내 변경만 얹는다
      m.sets = ((cur && cur.data) || {}).sets || {}; m.ads = ((cur && cur.data) || {}).ads || {}; m.ver = (cur && cur.ver) || null;
      apply();
      const r = await sbCall('client-log', { action: 'state_set' }, { key: 'makers', base: m.ver, data: { sets: m.sets, ads: m.ads } });
      if (!r.conflict) { m.ver = r.ver; toast(`만든 사람을 ${MAKER_NAMES[key]}(으)로 바꿨어요 — 광고관리자에도 반영돼요`); renderMycre(); if ($('mycre-modal').classList.contains('show')) mycreDetail(id); return; }
    } catch (e) { toast('저장 실패: ' + e.message); mycreDetail(id); return; }
  }
  toast('저장 실패 — 잠시 후 다시 시도해 주세요'); mycreDetail(id);
}
