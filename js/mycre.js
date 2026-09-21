/* ⑦ 내 소재 성과 (2026-09-21 사용자 기획) — 컨텐츠마케터용 화면.
   광고관리자는 예산 조절·매출이 보여 마케터에게 열지 않는다. 이 화면은 서버 meta-ads `mycre`가 지출·전환값·예산을 아예 빼고 내려준 것만 그린다
   (ROAS·구매 건수·클릭률·3초 재생·랜딩 도착·판정·추세·추가소재 요청). 서로의 소재도 참고하라고 사람 전환은 누구에게나 열려 있다.
   (index.html의 <script> 순서 — admgr-tabs.js 뒤: admgrProductOf·showMetaPreview·admgrTestGoRegister·metaGet 재사용) */
'use strict';

const mycre = { data: null, loading: false, err: '', who: null, thumbs: {}, thumbsAsked: new Set(), moreRun: false, moreRes: false, tview: 'live', tsort: { key: 'share', dir: -1 },
  range: lsGet('adc_mycre_range', null) || { preset: 'last_7d' } };   // 기간 (2026-09-22): today·yesterday·last_7d·last_14d·last_30d·custom{since,until} — 누적은 없다
const MY_PRESETS = { today: '오늘', yesterday: '어제', last_7d: '최근 7일', last_14d: '최근 14일', last_30d: '최근 30일' };

async function mycreFetch(force) {
  if (mycre.loading) return;
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
  const list = who === 'all' ? all : all.filter(a => a.maker === who);
  const whoLabel = who === 'all' ? '전체' : (MAKER_NAMES[who] || who);

  /* 사람 전환 — 내 소재 · 전체 · 나머지 마케터 (서로 다 볼 수 있다) */
  const others = Object.keys(MAKERS).filter(k => k !== mine);
  const sw = (k, label) => `<button class="filter-tab ${who === k ? 'active' : ''}" onclick="mycreWho('${k}')">${esc(label)}</button>`;
  const switcher = `<div class="filter-tabs my-who">${mine ? sw(mine, '내 소재') : ''}${sw('all', '전체')}${others.map(k => sw(k, MAKERS[k])).join('')}
    <span style="flex:1;"></span>${authIsAdmin() ? `<button class="filter-tab" onclick="mycreCfgOpen()" title="컨텐츠마케터에게 보여줄 캠페인을 고릅니다 — 고른 캠페인 안의 세트·광고만 이 화면에 나와요"><i class="fa-solid fa-filter"></i> 보여줄 캠페인${scope.length ? ' ' + scope.length : ''}</button>` : ''}<button class="filter-tab" onclick="mycreFetch(true)" ${mycre.loading ? 'disabled' : ''}><i class="fa-solid ${mycre.loading ? 'fa-spinner fa-spin' : 'fa-rotate'}"></i> 새로고침</button></div>`;

  /* 기간 — 오늘·어제·최근 7/14/30일·직접 (성과 숫자·지출 비중·주력 판정이 전부 이 기간 기준) */
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
  running.sort((x, y) => (y.share || 0) - (x.share || 0) || (y.purchases || 0) - (x.purchases || 0));
  const maxShare = Math.max(1, ...running.map(a => a.share || 0));
  const aces = running.filter(a => a.ace).slice(0, 6), aceIds = new Set(aces.map(a => a.id));
  const rest = running.filter(a => !aceIds.has(a.id));
  const runShow = mycre.moreRun ? rest : rest.slice(0, 10);
  setTimeout(() => mycreThumbsEnsure([...aces, ...runShow]), 0);
  const shareBar = a => `<div class="my-share" title="지금 켜져 있는 소재들의 지출을 100으로 봤을 때 이 소재의 몫"><span>지출 비중 <b>${(a.share || 0).toFixed(1)}%</b></span><i><em style="width:${Math.min(100, (a.share || 0) / maxShare * 100)}%;"></em></i></div>`;
  const card = a => {
    const st = MY_ST[a.st] || ['badge-gray', a.st], dp = myDplus(a), tired = a.trend && a.trend.tired, src = mycre.thumbs[a.id];
    const badge = a.ace ? '<span class="status-badge my-ace-b"><i class="fa-solid fa-star"></i> 주력</span>' : a.heavy ? '<span class="status-badge badge-orange">효율 애매</span>' : `<span class="status-badge ${st[0]}">${st[1]}</span>`;
    return `<div class="my-card ${a.ace ? 'ace' : a.heavy ? 'heavy' : ''} ${tired ? 'tired' : ''}" onclick="showMetaPreview('${a.id}')" title="누르면 소재 미리보기">
      <div class="my-thumb">${src ? `<img src="${esc(src)}" loading="lazy" alt="" />` : '<i class="fa-regular fa-image"></i>'}${badge}${tired ? '<span class="status-badge badge-red my-tired">식는 중</span>' : ''}</div>
      <div class="my-cbody">
        <b class="my-name" title="${esc(a.adset_name)}">${esc(mySet(a))}</b>
        <div class="my-sub ell">${[a.tag, a.kind === 'video' ? '릴스·영상' : a.kind === 'image' ? '이미지' : '', dp == null ? '' : 'D+' + dp, who === 'all' ? (MAKER_NAMES[a.maker] || '') : '', scope.length > 1 ? a.camp : ''].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="my-nums"><span>ROAS<b style="color:${myRoasColor(a.roas)};">${a.roas == null ? '—' : a.roas.toFixed(2)}</b></span><span>구매<b>${comma(a.purchases || 0)}</b></span><span class="my-sp">${mySpark(a.trend)}</span></div>
        ${shareBar(a)}
        ${tired ? '<div class="my-warn">최근 7일이 누적의 절반 아래 — 교체 소재를 준비해 주세요</div>' : a.heavy ? '<div class="my-warn" style="color:#9a3412;">돈은 많이 실리는데 효율이 애매해요</div>' : ''}
      </div></div>`;
  };
  const aceSec = aces.length ? `<div class="my-h"><b><i class="fa-solid fa-star" style="color:#4f46e5;"></i> 주력 소재</b><span>살아남은 것 중에서 ${esc(rgInfo.label || '')} 동안 돈도 많이 실리고 효율도 제대로 나온 소재</span></div><div class="my-grid my-grid-ace">${aces.map(card).join('')}</div>` : '';
  const runSec = aceSec + `<div class="my-h"><b>살아남은 ${who === 'all' ? '' : esc(whoLabel) + ' '}소재</b><span>지금 돌고 있는 것 · 지출 비중 큰 순 · 주황 테두리 = 돈은 실리는데 효율이 애매 · 카드를 누르면 미리보기</span></div>
    ${running.length ? `<div class="my-grid">${runShow.map(card).join('')}</div>${rest.length > runShow.length ? `<button class="btn-ghost my-more" onclick="mycre.moreRun=true;renderMycre()">나머지 ${rest.length - runShow.length}개 더 보기</button>` : ''}`
      : '<div class="empty-state" style="padding:24px;"><p>지금 돌고 있는 소재가 없어요.</p></div>'}`;

  /* ③ 광고관리자식 표 — 보기 전용 (켜고 끄기·예산·수정 없음). 살아남은 것 / 꺼진 것 / 전체 전환, 머리글 정렬. 꺼진 것이 보일 때는 '이유'(퍼널 진단) 열이 붙는다 */
  const tv = mycre.tview, ts = mycre.tsort;
  const pool = tv === 'live' ? running : tv === 'off' ? list.filter(a => !a.active) : list;
  const val = (a, k) => k === 'name' ? mySet(a) : k === 'st' ? ((MY_ST[a.st] || [])[1] || '') : k === 'd' ? (myDplus(a) ?? -1) : (a[k] ?? -1);
  const sorted = pool.slice().sort((x, y) => { const p = val(x, ts.key), q = val(y, ts.key); return (typeof p === 'string' ? p.localeCompare(q) : p - q) * ts.dir; });
  const tShow = mycre.moreRes ? sorted : sorted.slice(0, 30);
  const showWhy = tv !== 'live';
  const th = (k, label, cls) => `<th class="sortable ${cls || ''}" onclick="mycreSort('${k}')" title="누르면 정렬">${label}${ts.key === k ? (ts.dir < 0 ? ' ▼' : ' ▲') : ''}</th>`;
  const tvBtn = (k, label, n) => `<button class="filter-tab ${tv === k ? 'active' : ''}" onclick="mycre.tview='${k}';mycre.moreRes=false;renderMycre()">${label} ${n}</button>`;
  const stCell = a => { const st = MY_ST[a.st] || ['badge-gray', a.st]; return `<span class="status-badge ${a.ace ? 'my-ace-b' : a.heavy ? 'badge-orange' : st[0]}">${a.ace ? '주력' : a.heavy ? '효율 애매' : st[1]}</span>`; };
  const tRows = tShow.map(a => `<tr onclick="showMetaPreview('${a.id}')" style="cursor:pointer;" title="누르면 소재 미리보기">
      <td style="text-align:left;" class="name-cell"><b>${a.ace ? '<i class="fa-solid fa-star" style="color:#4f46e5;font-size:.8em;"></i> ' : ''}${esc(mySet(a))}</b><div class="my-sub ell" title="${esc(a.adset_name)}">${[a.tag, a.reg_date ? fmtMD(a.reg_date) : '', who === 'all' ? (MAKER_NAMES[a.maker] || '') : '', scope.length > 1 ? a.camp : ''].filter(Boolean).map(esc).join(' · ')}</div></td>
      <td class="ctr">${stCell(a)}</td>
      <td class="num"><span class="my-tbar"><em style="width:${Math.min(100, (a.share || 0) / maxShare * 100)}%;"></em></span> ${(a.share || 0).toFixed(1)}%</td>
      <td class="num">${comma(a.purchases || 0)}</td><td class="num"><b style="color:${myRoasColor(a.roas)};">${a.roas == null ? '—' : a.roas.toFixed(2)}</b></td>
      <td class="num m-hide">${myPct(a.ctr, 2)}</td><td class="num m-hide">${myPct(a.ts)}</td><td class="num m-hide">${myDplus(a) == null ? '—' : 'D+' + myDplus(a)}</td>
      ${showWhy ? `<td style="text-align:left;" class="my-why m-hide">${a.active ? '' : `<b class="my-why-${a.diag.k}">${esc(a.diag.label)}</b> <span>— ${esc(a.diag.fix)}</span>`}</td>` : ''}</tr>`).join('');
  const resSec = `<div class="my-h"><b>전체 표</b><span>광고관리자처럼 한 줄씩 · 머리글을 누르면 정렬 · 보기 전용</span></div>
    <div class="filter-tabs" style="margin-bottom:10px;">${tvBtn('live', '살아남은 것', running.length)}${tvBtn('off', '꺼진 것 (이유 보기)', list.length - running.length)}${tvBtn('all', '전체', list.length)}</div>
    ${pool.length ? `<div class="table-wrap"><table class="my-table"><thead><tr>${th('name', '소재', 'l')}${th('st', '상태')}${th('share', '지출 비중', 'num')}${th('purchases', '구매', 'num')}${th('roas', 'ROAS', 'num')}${th('ctr', '클릭률', 'num m-hide')}${th('ts', '3초 재생', 'num m-hide')}${th('d', '일수', 'num m-hide')}${showWhy ? '<th class="m-hide" style="text-align:left;">이유</th>' : ''}</tr></thead><tbody>${tRows}</tbody></table></div>
      ${sorted.length > tShow.length ? `<button class="btn-ghost my-more" onclick="mycre.moreRes=true;renderMycre()">나머지 ${sorted.length - tShow.length}개 더 보기</button>` : ''}`
      : '<div class="empty-state" style="padding:24px;"><p>해당하는 소재가 없어요.</p></div>'}`;

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
    <div class="info-bar" style="margin-top:14px;"><i class="fa-regular fa-clock"></i> ${admgrAgo(mycre.data.fetched_at)} 기준 · 성과·지출 비중·주력은 <b>${esc(rgInfo.label || '')}</b> 기준 (최근 N일은 광고관리자처럼 오늘 제외) · 이 화면에는 지출·매출·예산이 나오지 않아요${scope.length ? ` · 보는 범위: ${scope.map(esc).join(', ')}` : ''}</div>`;
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
