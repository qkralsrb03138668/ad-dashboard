/* ② 소재 목록 · ③ 소재 비교 · ④ 테스트 소재 · ⑤ 소재 등록/수정 · ⑥ 소재 상세
   (index.html에서 분리 — 2026-09-08 2단계. 파일 순서는 index.html의 <script> 순서, 전역 함수·변수를 그대로 공유) */
'use strict';

/* ═══════════ ② 소재 목록 ═══════════ */
let listView = lsGet(LS.view, 'grid');
let listCh = 'all', listSt = 'all';
let listSort = { key: 'spend', dir: -1 };

function setListView(v) { listView = v; lsSet(LS.view, v); renderList(); }
function setListCh(v) { listCh = v; renderList(); }
function setListSt(v) { listSt = v; renderList(); }
function setListSort(key) {
  if (listSort.key === key) listSort.dir *= -1;
  else listSort = { key, dir: -1 };
  renderList();
}

function listFiltered(p) {
  const q = ($('list-q').value || '').trim().toLowerCase();
  return creatives
    .filter(c => listCh === 'all' || c.channel === listCh)
    .filter(c => listSt === 'all' || c.status === listSt)
    .filter(c => !q || (c.name + ' ' + (c.product || '')).toLowerCase().includes(q))
    .map(c => ({ c, a: aggFor(c.id, p.s, p.e) }));
}

function renderList() {
  const p = getPeriod();
  /* 채널 칩 */
  const chCounts = { all: creatives.length };
  for (const c of creatives) chCounts[c.channel] = (chCounts[c.channel] || 0) + 1;
  $('list-ch-tabs').innerHTML =
    `<button class="filter-tab ${listCh==='all'?'active':''}" onclick="setListCh('all')">전체 ${chCounts.all}</button>` +
    Object.keys(CH).filter(k => chCounts[k]).map(k =>
      `<button class="filter-tab ${listCh===k?'active':''}" onclick="setListCh('${k}')">${CH[k]} ${chCounts[k]}</button>`).join('');
  /* 상태 칩 */
  const stCounts = {};
  for (const c of creatives) stCounts[c.status] = (stCounts[c.status] || 0) + 1;
  $('list-st-tabs').innerHTML =
    `<button class="filter-tab ${listSt==='all'?'active':''}" onclick="setListSt('all')">모든 상태</button>` +
    Object.keys(ST).map(k =>
      `<button class="filter-tab ${listSt===k?'active':''}" onclick="setListSt('${k}')">${ST[k].t} ${stCounts[k] || 0}</button>`).join('');

  $('btn-view-grid').style.color = listView === 'grid' ? '#4f46e5' : '';
  $('btn-view-table').style.color = listView === 'table' ? '#4f46e5' : '';

  const items = listFiltered(p);
  const body = $('list-body');
  if (!items.length) {
    body.innerHTML = `<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-folder-open"></i></div>
      <p>조건에 맞는 소재가 없어요.</p></div>`;
    return;
  }

  if (listView === 'grid') {
    const sorted = items.slice().sort((x, y) => y.a.spend - x.a.spend);
    body.innerHTML = `<div class="cre-grid">${sorted.map(({c, a}) => `
      <div class="cre-tile" onclick="openDetail('${c.id}')">
        ${c.thumb
          ? `<img src="${c.thumb}" alt="" loading="lazy" />`
          : `<div class="ct-ph"><i class="${c.type === 'video' ? 'fa-solid fa-clapperboard' : 'fa-regular fa-image'}"></i></div>`}
        ${c.type === 'video' ? '<div class="ct-play"><i class="fa-solid fa-play"></i></div>' : ''}
        <span class="ct-status">${stBadge(c)}</span>
        <span class="ct-ch" title="${CH[c.channel] || ''}"><i class="${CH_ICON[c.channel] || CH_ICON.etc}"></i></span>
        ${a.spend ? `<span class="cre-roas">ROAS ${a.roas.toFixed(1)}</span>` : ''}
        <div class="ct-name">${esc(c.name)}</div>
      </div>`).join('')}</div>`;
    return;
  }

  /* 표 보기 */
  const sk = listSort.key, dir = listSort.dir;
  const sorted = items.slice().sort((x, y) => {
    if (sk === 'name') return x.c.name.localeCompare(y.c.name, 'ko') * dir;
    if (sk === 'reg')  return String(x.c.reg_date || '').localeCompare(String(y.c.reg_date || '')) * dir;
    return ((x.a[sk] || 0) - (y.a[sk] || 0)) * dir;
  });
  const arrow = key => listSort.key === key ? (listSort.dir === -1 ? ' ▼' : ' ▲') : '';
  const tot = aggRows(sorted.flatMap(({c}) => recsFor(c.id, p.s, p.e)));
  body.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th class="sortable" style="text-align:left;" onclick="setListSort('name')">소재${arrow('name')}</th>
      <th class="m-hide">채널</th><th class="m-hide sortable" onclick="setListSort('reg')">등록일${arrow('reg')}</th><th>상태</th>
      <th class="sortable" onclick="setListSort('spend')">지출${arrow('spend')}</th>
      <th class="m-hide sortable" onclick="setListSort('imp')">노출${arrow('imp')}</th>
      <th class="m-hide sortable" onclick="setListSort('ctr')">CTR${arrow('ctr')}</th>
      <th class="m-hide sortable" onclick="setListSort('cpc')">CPC${arrow('cpc')}</th>
      <th class="sortable" onclick="setListSort('purch')">구매${arrow('purch')}</th>
      <th class="m-hide sortable" onclick="setListSort('cpa')">구매당 비용${arrow('cpa')}</th>
      <th class="sortable" onclick="setListSort('roas')">ROAS${arrow('roas')}</th>
      <th>관리</th>
    </tr></thead>
    <tbody>${sorted.map(({c, a}) => `
      <tr>
        <td class="name-cell" onclick="openDetail('${c.id}')" style="cursor:pointer;">${thumbCell(c)} ${esc(c.name)}
          ${c.product ? `<div style="font-size:.7rem;color:#9ca3af;margin-top:2px;">${esc(c.product)}</div>` : ''}</td>
        <td class="m-hide">${CH[c.channel] || '-'}</td>
        <td class="m-hide">${c.reg_date || '-'}</td>
        <td>${stBadge(c)}</td>
        <td><b>${won(a.spend)}</b></td>
        <td class="m-hide">${comma(a.imp)}</td>
        <td class="m-hide">${a.imp ? a.ctr.toFixed(2) + '%' : '—'}</td>
        <td class="m-hide">${a.clicks ? won(a.cpc) : '—'}</td>
        <td>${comma(a.purch)}</td>
        <td class="m-hide">${a.purch ? won(a.cpa) : '—'}</td>
        <td>${roasCell(a)}</td>
        <td><button class="btn-ghost" style="padding:4px 10px;font-size:.72rem;" onclick="openCreForm('${c.id}')"><i class="fa-solid fa-pen"></i></button></td>
      </tr>`).join('')}</tbody>
    <tfoot><tr>
      <td style="text-align:left;">합계 (${sorted.length}개)</td>
      <td class="m-hide"></td><td class="m-hide"></td><td></td>
      <td>${won(tot.spend)}</td>
      <td class="m-hide">${comma(tot.imp)}</td>
      <td class="m-hide">${tot.imp ? tot.ctr.toFixed(2) + '%' : '—'}</td>
      <td class="m-hide">${tot.clicks ? won(tot.cpc) : '—'}</td>
      <td>${comma(tot.purch)}</td>
      <td class="m-hide">${tot.purch ? won(tot.cpa) : '—'}</td>
      <td>${tot.spend ? tot.roas.toFixed(2) : '—'}</td><td></td>
    </tr></tfoot>
  </table></div>`;
}

/* ═══════════ ③ 소재 비교 ═══════════ */
let cmpSel = [];
let cmpMetric = 'roas';
function toggleCmp(id) {
  const i = cmpSel.indexOf(id);
  if (i >= 0) cmpSel.splice(i, 1);
  else {
    if (cmpSel.length >= 6) { toast('비교는 최대 6개까지예요'); return; }
    cmpSel.push(id);
  }
  renderCompare(getPeriod());
}
function setCmpMetric(m) { cmpMetric = m; renderCompare(getPeriod()); }

const CMP_COLORS = ['#4f46e5', '#f59e0b', '#10b981', '#ef4444', '#0ea5e9', '#a855f7'];

function renderCompare(p) {
  cmpSel = cmpSel.filter(id => creById(id));
  $('cmp-pick').innerHTML = creatives.length
    ? creatives.map(c =>
        `<button class="filter-tab ${cmpSel.includes(c.id) ? 'active' : ''}" onclick="toggleCmp('${c.id}')">${esc(c.name)}</button>`).join('')
    : '<span style="font-size:.82rem;color:#9ca3af;">등록된 소재가 없어요 — 먼저 소재를 등록해 주세요.</span>';
  $('cmp-metric-tabs').innerHTML = Object.keys(METRICS).map(k =>
    `<button class="filter-tab ${cmpMetric === k ? 'active' : ''}" onclick="setCmpMetric('${k}')">${METRICS[k].t}</button>`).join('');

  const body = $('cmp-body');
  if (cmpSel.length < 2) {
    body.innerHTML = `<div class="empty-state"><div class="es-icon"><i class="fa-solid fa-scale-balanced"></i></div>
      <p>위에서 소재를 <b>2개 이상</b> 선택하면 기간 내 추이와 합계를 비교해 드려요.</p></div>`;
    return;
  }

  const sel = cmpSel.map(id => creById(id));
  body.innerHTML = `
    <div class="sub-title">${METRICS[cmpMetric].t} 일별 추이</div>
    <div class="chart-box"><canvas id="cmp-chart" height="100"></canvas></div>
    <div class="sub-title">기간 합계 비교</div>
    <div class="table-wrap"><table>
      <thead><tr><th style="text-align:left;">소재</th><th>지출</th><th class="m-hide">노출</th><th class="m-hide">CTR</th>
        <th class="m-hide">CPC</th><th>구매</th><th class="m-hide">구매당 비용</th><th class="m-hide">전환값</th><th>ROAS</th></tr></thead>
      <tbody>${sel.map((c, i) => { const a = aggFor(c.id, p.s, p.e); return `
        <tr>
          <td class="name-cell"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${CMP_COLORS[i]};margin-right:6px;"></span>${esc(c.name)}</td>
          <td><b>${won(a.spend)}</b></td>
          <td class="m-hide">${comma(a.imp)}</td>
          <td class="m-hide">${a.imp ? a.ctr.toFixed(2) + '%' : '—'}</td>
          <td class="m-hide">${a.clicks ? won(a.cpc) : '—'}</td>
          <td>${comma(a.purch)}</td>
          <td class="m-hide">${a.purch ? won(a.cpa) : '—'}</td>
          <td class="m-hide">${won(a.value)}</td>
          <td>${roasCell(a)}</td>
        </tr>`; }).join('')}</tbody>
    </table></div>`;

  const labels = dailySeries(p.s, p.e).days;
  mkChart('cmp', 'cmp-chart', {
    type: 'line',
    data: {
      labels: labels.map(fmtMD),
      datasets: sel.map((c, i) => {
        const ser = dailySeries(p.s, p.e, c.id);
        return { label: c.name, data: ser.rows.map(r => r[cmpMetric] || 0),
          borderColor: CMP_COLORS[i], backgroundColor: CMP_COLORS[i], tension: .3, pointRadius: 2 };
      }),
    },
    options: {
      responsive: true, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { boxWidth: 12 } } },
      scales: { y: { ticks: { callback: v => typeof v === 'number' ? comma(v) : v } } },
    },
  });
}

/* ═══════════ ④ 테스트 소재 ═══════════ */
let testFilter = 'all';
function setTestFilter(v) { testFilter = v; renderTest(); }
function renderTest() {
  const counts = { all: creatives.length };
  for (const k of Object.keys(ST)) counts[k] = creatives.filter(c => c.status === k).length;
  const reqN = creatives.filter(c => c.asset_req_at && !c.asset_done_at).length;
  $('test-tabs').innerHTML =
    `<button class="filter-tab ${testFilter==='all'?'active':''}" onclick="setTestFilter('all')">전체 ${counts.all}</button>` +
    Object.keys(ST).map(k =>
      `<button class="filter-tab ${testFilter===k?'active':''}" onclick="setTestFilter('${k}')">${ST[k].t} ${counts[k]}</button>`).join('') +
    `<button class="filter-tab ${testFilter==='req'?'active':''}" onclick="setTestFilter('req')">추가소재 요청 ${reqN}</button>`;

  let rows = creatives.slice();
  if (testFilter === 'req') rows = rows.filter(c => c.asset_req_at && !c.asset_done_at);
  else if (testFilter !== 'all') rows = rows.filter(c => c.status === testFilter);
  rows.sort((a, b) => String(b.reg_date || '').localeCompare(String(a.reg_date || '')));

  const body = $('test-body');
  if (!rows.length) {
    body.innerHTML = `<div class="empty-state"><div class="es-icon"><i class="fa-solid fa-flask"></i></div>
      <p>해당하는 소재가 없어요.</p></div>`;
    return;
  }

  body.innerHTML = `<div class="info-bar"><i class="fa-solid fa-circle-info"></i>
      성과 수치는 <b>등록일 이후 누적</b> 기준이에요. 우수로 판정한 소재에는 추가소재 요청·제작완료를 기록할 수 있어요.</div>
    <div class="table-wrap"><table>
    <thead><tr><th style="text-align:left;">소재</th><th class="m-hide">등록일</th><th class="m-hide">경과</th>
      <th>누적 지출</th><th>구매</th><th class="m-hide">구매당 비용</th><th>ROAS</th><th>판정</th><th>추가소재</th></tr></thead>
    <tbody>${rows.map(c => {
      const a = aggLifetime(c.id);
      const days = c.reg_date ? daysBetween(c.reg_date, todayStr(0)) : null;
      return `
      <tr>
        <td class="name-cell" onclick="openDetail('${c.id}')" style="cursor:pointer;">${thumbCell(c)} ${esc(c.name)}
          ${c.product ? `<div style="font-size:.7rem;color:#9ca3af;margin-top:2px;">${esc(c.product)}</div>` : ''}</td>
        <td class="m-hide">${c.reg_date || '-'}</td>
        <td class="m-hide">${days === null ? '-' : days + '일'}</td>
        <td><b>${won(a.spend)}</b></td>
        <td>${comma(a.purch)}</td>
        <td class="m-hide">${a.purch ? won(a.cpa) : '—'}</td>
        <td>${roasCell(a)}</td>
        <td><span class="verdict-btns">
          <button class="vbtn ${c.status==='good'?'on-good':''}" onclick="setVerdict('${c.id}','good')">우수</button>
          <button class="vbtn ${c.status==='meh'?'on-meh':''}" onclick="setVerdict('${c.id}','meh')">애매</button>
          <button class="vbtn ${c.status==='off'?'on-off':''}" onclick="setVerdict('${c.id}','off')">OFF</button>
        </span></td>
        <td>${c.status === 'good' ? `
          <label style="font-size:.72rem;font-weight:600;color:#4b5563;cursor:pointer;white-space:nowrap;">
            <input type="checkbox" ${c.asset_req_at ? 'checked' : ''} onchange="toggleAsset('${c.id}','asset_req_at',this.checked)" /> 요청${c.asset_req_at ? ' <span style="color:#9ca3af;">' + fmtMD(c.asset_req_at) + '</span>' : ''}</label>
          <label style="font-size:.72rem;font-weight:600;color:#4b5563;cursor:pointer;white-space:nowrap;margin-left:6px;">
            <input type="checkbox" ${c.asset_done_at ? 'checked' : ''} onchange="toggleAsset('${c.id}','asset_done_at',this.checked)" /> 완료${c.asset_done_at ? ' <span style="color:#9ca3af;">' + fmtMD(c.asset_done_at) + '</span>' : ''}</label>`
          : '<span style="color:#d1d5db;">—</span>'}</td>
      </tr>`; }).join('')}</tbody>
  </table></div>`;
}
function setVerdict(id, v) {
  const c = creById(id); if (!c) return;
  c.status = (c.status === v) ? 'testing' : v;   // 같은 버튼 재클릭 = 해제 → 평가중
  saveAll(); rerender();
}
function toggleAsset(id, field, on) {
  const c = creById(id); if (!c) return;
  c[field] = on ? todayStr(0) : null;
  saveAll(); renderTest();
}

/* ═══════════ ⑤ 소재 등록/수정 ═══════════ */
let thumbData = null;
function openCreForm(id) {
  const c = id ? creById(id) : null;
  $('cre-modal-title').textContent = c ? '소재 수정' : '소재 등록';
  $('cf-id').value = c ? c.id : '';
  $('cf-name').value = c ? c.name : '';
  $('cf-product').value = c ? (c.product || '') : '';
  $('cf-date').value = c ? (c.reg_date || '') : todayStr(0);
  $('cf-channel').value = c ? c.channel : 'meta';
  $('cf-type').value = c ? c.type : 'image';
  $('cf-status').value = c ? c.status : 'testing';
  $('cf-memo').value = c ? (c.memo || '') : '';
  $('cf-thumb').value = '';
  thumbData = c ? (c.thumb || null) : null;
  renderThumbPrev();
  $('cf-del').style.display = c ? '' : 'none';
  $('cre-modal').classList.add('show');
}
function renderThumbPrev() {
  $('cf-thumb-prev').innerHTML = thumbData
    ? `<img src="${thumbData}" style="max-width:120px;border-radius:10px;border:1px solid #e7e8ee;" />
       <button class="btn-ghost" style="padding:4px 10px;font-size:.72rem;vertical-align:top;margin-left:8px;" onclick="thumbData=null;renderThumbPrev()">제거</button>`
    : '';
}
function onThumbPick(input) {
  const f = input.files && input.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    const MAX = 480;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    thumbData = cv.toDataURL('image/jpeg', .82);
    renderThumbPrev();
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(f);
}
function saveCre() {
  const name = $('cf-name').value.trim();
  if (!name) { toast('소재명을 입력해 주세요'); return; }
  const id = $('cf-id').value;
  const data = {
    name, product: $('cf-product').value.trim(),
    reg_date: $('cf-date').value || todayStr(0),
    channel: $('cf-channel').value, type: $('cf-type').value,
    status: $('cf-status').value, memo: $('cf-memo').value.trim(),
    thumb: thumbData,
  };
  if (id) {
    const c = creById(id); Object.assign(c, data);
    toast('소재를 수정했어요');
  } else {
    creatives.push(Object.assign({ id: newId(), asset_req_at: null, asset_done_at: null }, data));
    toast('소재를 등록했어요');
  }
  saveAll(); closeModal('cre-modal'); rerender();
}
function deleteCre() {
  const id = $('cf-id').value; const c = creById(id); if (!c) return;
  const n = records.filter(r => r.cid === id).length;
  if (!confirm(`'${c.name}' 소재와 성과 기록 ${n}건을 삭제할까요?`)) return;
  creatives = creatives.filter(x => x.id !== id);
  records = records.filter(r => r.cid !== id);
  saveAll(); closeModal('cre-modal'); closeModal('detail-modal'); rerender();
  toast('삭제했어요');
}
function closeModal(id) { $(id).classList.remove('show'); }

/* ═══════════ ⑥ 소재 상세 ═══════════ */
function openDetail(id) {
  const c = creById(id); if (!c) return;
  const p = getPeriod();
  const a = aggFor(id, p.s, p.e);
  const life = aggLifetime(id);
  const tile = (label, val, sub) => `
    <div class="kpi-tile"><div class="kt-label">${label}</div>
      <div class="kt-value" style="font-size:1.1rem;">${val}</div>${sub ? `<div class="kt-sub">${sub}</div>` : ''}</div>`;

  $('detail-body').innerHTML = `
    <div class="modal-head"><b>${esc(c.name)}</b>
      <button class="btn-ghost" style="padding:5px 12px;font-size:.75rem;" onclick="closeModal('detail-modal');openCreForm('${c.id}')"><i class="fa-solid fa-pen"></i> 수정</button>
      <button class="modal-x" onclick="closeModal('detail-modal')">✕</button></div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px;">
      <div style="width:150px;flex-shrink:0;">
        ${c.thumb
          ? `<img src="${c.thumb}" style="width:150px;height:150px;object-fit:cover;border-radius:12px;border:1px solid #e7e8ee;" />`
          : `<div style="width:150px;height:150px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:2.4rem;color:#a5b4fc;background:linear-gradient(140deg,#eef2ff,#ede9fe);"><i class="${c.type==='video'?'fa-solid fa-clapperboard':'fa-regular fa-image'}"></i></div>`}
      </div>
      <div style="flex:1;min-width:200px;font-size:.82rem;color:#4b5563;line-height:2;">
        <div>${stBadge(c)} <span class="status-badge badge-gray">${CH[c.channel] || '-'}</span>
          <span class="status-badge badge-gray">${c.type === 'video' ? '영상' : '이미지'}</span></div>
        ${c.product ? `<div><b>상품</b> · ${esc(c.product)}</div>` : ''}
        <div><b>등록일</b> · ${c.reg_date || '-'}${c.reg_date ? ` (${daysBetween(c.reg_date, todayStr(0))}일 경과)` : ''}</div>
        ${c.memo ? `<div style="background:#f8f9fb;border-radius:8px;padding:8px 12px;line-height:1.6;margin-top:4px;">${esc(c.memo)}</div>` : ''}
      </div>
    </div>
    <div class="sub-title">선택 기간 (${p.s} ~ ${p.e})</div>
    <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr));">
      ${tile('지출', won(a.spend))}
      ${tile('노출', comma(a.imp), 'CTR ' + (a.imp ? a.ctr.toFixed(2) + '%' : '—'))}
      ${tile('클릭', comma(a.clicks), 'CPC ' + (a.clicks ? won(a.cpc) : '—'))}
      ${tile('구매', comma(a.purch), a.purch ? won(a.cpa) + '/건' : '')}
      ${tile('ROAS', a.spend ? a.roas.toFixed(2) : '—', '전환값 ' + won(a.value))}
    </div>
    <div class="sub-title">누적 (전체 기간)</div>
    <div style="font-size:.82rem;color:#4b5563;margin-bottom:14px;">
      지출 <b>${won(life.spend)}</b> · 구매 <b>${comma(life.purch)}</b> ·
      구매당 비용 <b>${life.purch ? won(life.cpa) : '—'}</b> · ROAS <b>${life.spend ? life.roas.toFixed(2) : '—'}</b></div>
    <div class="chart-box"><canvas id="detail-chart" height="110"></canvas></div>`;

  $('detail-modal').classList.add('show');

  const ser = dailySeries(p.s, p.e, id);
  mkChart('detail', 'detail-chart', {
    data: {
      labels: ser.days.map(fmtMD),
      datasets: [
        { type: 'bar', label: '지출', data: ser.rows.map(r => r.spend),
          backgroundColor: 'rgba(99,102,241,.45)', borderRadius: 5, yAxisID: 'y' },
        { type: 'line', label: 'ROAS', data: ser.rows.map(r => r.roas),
          borderColor: '#f59e0b', backgroundColor: '#f59e0b', tension: .3, yAxisID: 'y2', pointRadius: 3 },
      ],
    },
    options: {
      responsive: true, interaction: { mode: 'index', intersect: false },
      scales: { y: { position: 'left', ticks: { callback: v => comma(v) } },
                y2: { position: 'right', grid: { drawOnChartArea: false } } },
    },
  });
}
