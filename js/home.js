/* ① 대시보드 탭
   (index.html에서 분리 — 2026-09-08 2단계. 파일 순서는 index.html의 <script> 순서, 전역 함수·변수를 그대로 공유) */
'use strict';

/* ═══════════ ① 대시보드 ═══════════ */
function renderHome(p) {
  $('home-range').textContent = p.s + ' ~ ' + p.e;
  const body = $('home-body');

  if (!creatives.length) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="es-icon"><i class="fa-solid fa-images"></i></div>
        <p><b>아직 등록된 소재가 없어요.</b><br/>
        위의 <b>소재 등록</b> 버튼으로 직접 추가하거나, 데이터 관리에서 Meta CSV를 올리거나,<br/>샘플 데이터로 화면을 먼저 구경해 보세요.</p>
        <div style="margin-top:16px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          <button class="btn-analyze" onclick="openCreForm()"><i class="fa-solid fa-plus"></i> 소재 등록</button>
          <button class="btn-ghost" onclick="showMenu('data')"><i class="fa-solid fa-file-csv"></i> CSV 업로드</button>
          <button class="btn-sample" onclick="loadSample()"><i class="fa-solid fa-wand-magic-sparkles"></i> 샘플 데이터 넣어보기</button>
        </div>
      </div>`;
    return;
  }

  const t = aggTotal(p.s, p.e);
  const live = creatives.filter(c => c.status !== 'off').length;
  const tiles = `
    <div class="kpi-grid">
      <div class="kpi-tile kt-hero"><div class="kt-label"><i class="fa-solid fa-coins"></i> 총 지출</div>
        <div class="kt-value">${won(t.spend)}</div><div class="kt-sub">운영 소재 ${live}개 / 전체 ${creatives.length}개</div></div>
      <div class="kpi-tile"><div class="kt-label"><i class="fa-solid fa-eye"></i> 노출</div>
        <div class="kt-value">${comma(t.imp)}</div><div class="kt-sub">CPM ${won(t.cpm)}</div></div>
      <div class="kpi-tile"><div class="kt-label"><i class="fa-solid fa-arrow-pointer"></i> 클릭</div>
        <div class="kt-value">${comma(t.clicks)}</div><div class="kt-sub">CTR ${t.ctr.toFixed(2)}% · CPC ${won(t.cpc)}</div></div>
      <div class="kpi-tile"><div class="kt-label"><i class="fa-solid fa-bag-shopping"></i> 구매</div>
        <div class="kt-value">${comma(t.purch)}</div><div class="kt-sub">구매당 비용 ${t.purch ? won(t.cpa) : '—'}</div></div>
      <div class="kpi-tile"><div class="kt-label"><i class="fa-solid fa-won-sign"></i> 구매 전환값</div>
        <div class="kt-value">${won(t.value)}</div><div class="kt-sub">기간 합계</div></div>
      <div class="kpi-tile"><div class="kt-label"><i class="fa-solid fa-chart-line"></i> ROAS</div>
        <div class="kt-value" style="color:${t.roas >= 2 ? '#15803d' : t.roas >= 1 ? '#92400e' : '#dc2626'};">${t.roas.toFixed(2)}</div>
        <div class="kt-sub">전환값 ÷ 지출</div></div>
    </div>`;

  /* 일별 차트 */
  const chartBox = `
    <div class="sub-title">일별 지출 · ROAS</div>
    <div class="chart-box"><canvas id="home-chart" height="90"></canvas></div>`;

  /* TOP 소재 표 (지출순) */
  const rows = creatives
    .map(c => ({ c, a: aggFor(c.id, p.s, p.e) }))
    .filter(x => x.a.spend > 0 || x.a.imp > 0)
    .sort((x, y) => y.a.spend - x.a.spend)
    .slice(0, 10);
  const topHtml = rows.length ? `
    <div class="sub-title">기간 내 지출 TOP ${rows.length}</div>
    <div class="table-wrap"><table>
      <thead><tr><th style="text-align:left;">소재</th><th class="m-hide">채널</th><th>상태</th><th>지출</th>
        <th class="m-hide">노출</th><th class="m-hide">CTR</th><th>구매</th><th class="m-hide">구매당 비용</th><th>ROAS</th></tr></thead>
      <tbody>${rows.map(({c, a}) => `
        <tr onclick="openDetail('${c.id}')" style="cursor:pointer;">
          <td class="name-cell">${thumbCell(c)} ${esc(c.name)}</td>
          <td class="m-hide">${CH[c.channel] || '-'}</td>
          <td>${stBadge(c)}</td>
          <td><b>${won(a.spend)}</b></td>
          <td class="m-hide">${comma(a.imp)}</td>
          <td class="m-hide">${a.ctr.toFixed(2)}%</td>
          <td>${comma(a.purch)}</td>
          <td class="m-hide">${a.purch ? won(a.cpa) : '—'}</td>
          <td>${roasCell(a)}</td>
        </tr>`).join('')}</tbody>
    </table></div>`
    : `<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-folder-open"></i></div>
       <p>이 기간에는 성과 기록이 없어요.<br/>기간을 넓히거나, 데이터 관리에서 성과를 입력해 주세요.</p></div>`;

  body.innerHTML = tiles + chartBox + topHtml;

  const ser = dailySeries(p.s, p.e);
  mkChart('home', 'home-chart', {
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
      plugins: { legend: { labels: { font: { family: 'inherit' } } } },
      scales: {
        y:  { position: 'left', ticks: { callback: v => comma(v) } },
        y2: { position: 'right', grid: { drawOnChartArea: false } },
      },
    },
  });
}

function thumbCell(c) {
  return c.thumb
    ? `<img class="mini-thumb" src="${c.thumb}" alt="" /> `
    : `<span class="mini-ph"><i class="${c.type === 'video' ? 'fa-solid fa-clapperboard' : 'fa-regular fa-image'}"></i></span> `;
}
function stBadge(c) { const s = ST[c.status] || ST.testing; return `<span class="status-badge ${s.b}">${s.t}</span>`; }
function roasCell(a) {
  if (!a.spend) return '—';
  const color = a.roas >= 2 ? '#15803d' : a.roas >= 1 ? '#92400e' : '#dc2626';
  return `<b style="color:${color};">${a.roas.toFixed(2)}</b>`;
}
