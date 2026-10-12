/* 어제 광고 보고서 (2026-10-12) — 예약 작업 daily-ad-brief(매일 9시, 이 맥의 Claude 앱)가 scripts/save-brief.mjs로
   shared_state `daily_briefs` { items: { 'YYYY-MM-DD': brief } }에 저장한 AI 브리핑을 날짜별로 보여준다. 읽기 전용.
   brief 형식은 ~/.claude/scheduled-tasks/daily-ad-brief/SKILL.md 3단계 (claude.ai 브리핑 아티팩트와 같은 JSON) */
'use strict';
const brief = { items: null, cur: null, loading: false, at: 0 };
const BRIEF_KPIS = [   // [키, 이름, 형식, 좋아지는 방향: 1 높을수록 · -1 낮을수록 · 0 중립]
  ['spend', '지출', n => won(n), 0], ['value', '매출(전환값)', n => won(n), 1], ['roas', 'ROAS', n => (+n).toFixed(2), 1],
  ['purchases', '구매', n => comma(Math.round(n)) + '건', 1], ['cpa', 'CPA', n => won(n), -1], ['cpc', 'CPC', n => won(n), -1],
];
const briefDay = d => { const x = new Date(d + 'T00:00:00'); return `${x.getMonth() + 1}월 ${x.getDate()}일 (${'일월화수목금토'[x.getDay()]})`; };
async function renderBrief() {
  const box = $('brief-body');
  if (!brief.items || Date.now() - brief.at > 5 * 60_000) {   // 5분마다 새로 — 9시 넘어 열어 둔 화면도 새 보고서를 받게
    if (brief.loading) return;
    brief.loading = true;
    if (!brief.items) box.innerHTML = '<div class="empty-state"><p>보고서를 불러오는 중…</p></div>';
    try {
      const r = await sbCall('client-log', { action: 'state_get', key: 'daily_briefs' });
      brief.items = (r && r.data && r.data.items) || {}; brief.at = Date.now();
    } catch (e) { brief.loading = false; box.innerHTML = `<div class="empty-state"><p>보고서를 불러오지 못했어요: ${esc(e.message)}</p></div>`; return; }
    brief.loading = false;
  }
  const dates = Object.keys(brief.items).sort().reverse();
  if (!brief.cur || !brief.items[brief.cur]) brief.cur = dates[0] || null;
  if (!brief.cur) { box.innerHTML = '<div class="empty-state"><p>아직 보고서가 없어요 — 매일 오전 9시에 이 맥의 Claude 앱이 켜져 있으면 만들어져요.</p></div>'; return; }
  const b = brief.items[brief.cur], i = dates.indexOf(brief.cur);
  const yday = todayStr(-1);
  const stale = dates[0] < yday && brief.cur === dates[0]
    ? `<div class="info-bar" style="background:#fff7ed;border-color:#fed7aa;color:#9a3412;"><i class="fa-regular fa-clock"></i> ${briefDay(yday)} 보고서는 아직 없어요 — 9시에 맥이나 Claude 앱이 꺼져 있었으면 다음 실행 때 만들어져요. 가장 최근 보고서를 보여드려요.</div>` : '';
  const nav = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;flex-wrap:wrap;">
    <button class="filter-tab" ${i >= dates.length - 1 ? 'disabled' : ''} onclick="briefGo(1)" aria-label="이전 날짜">‹</button>
    <select class="inp" style="width:auto;padding:5px 10px;" onchange="brief.cur=this.value;renderBrief()" aria-label="날짜 선택">${dates.map(d => `<option value="${d}" ${d === brief.cur ? 'selected' : ''}>${briefDay(d)}</option>`).join('')}</select>
    <button class="filter-tab" ${i <= 0 ? 'disabled' : ''} onclick="briefGo(-1)" aria-label="다음 날짜">›</button>
    <span style="flex:1;"></span>
    <button class="filter-tab" onclick="briefCopy()"><i class="fa-regular fa-copy"></i> 텍스트 복사</button></div>`;
  const k = b.kpi || {}, y = k.yesterday;
  const delta = (cur, base, dir, label) => {
    if (!base || cur == null) return `<span style="color:#9ca3af;">${label} –</span>`;
    const p = (cur - base) / base * 100, c = Math.abs(p) < 1 || dir === 0 ? '#6b7280' : (p > 0) === (dir > 0) ? '#15803d' : '#dc2626';
    return `<span>${label} <b style="color:${c};">${p > 0 ? '+' : ''}${p.toFixed(0)}%</b></span>`;
  };
  const kpis = y ? `<div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:10px;">${BRIEF_KPIS.map(([key, name, fmt, dir]) =>
    `<div class="kpi-tile"><div class="kt-label">${name}</div><div class="kt-value" style="font-size:1.2rem;">${y[key] == null ? '–' : fmt(y[key])}</div>
      <div class="kt-sub" style="display:flex;gap:8px;flex-wrap:wrap;">${delta(y[key], (k.day_before || {})[key], dir, '그제')}${delta(y[key], (k.avg_7d || {})[key], dir, '7일 평균')}</div></div>`).join('')}</div>` : '';
  const c = b.cafe24;
  const store = c ? `<div style="font-size:.84rem;color:#4b5563;margin:0 2px 14px;">카페24 ${c.date && c.date !== b.date ? briefDay(c.date) + ' ' : ''}주문 <b style="color:#111827;">${won(c.order_amount || 0)}</b> · <b style="color:#111827;">${comma(c.paid_qty || 0)}개</b> · 취소·반품 <b style="color:#111827;">${comma(c.cancel_qty || 0)}개</b>${c.note ? ` <span style="color:#9ca3af;">(${esc(c.note)})</span>` : ''}</div>` : '';
  // 최근 14일 ROAS 막대 — 누르면 그날로
  const recent = dates.slice(0, 14).reverse().filter(d => brief.items[d].kpi && brief.items[d].kpi.yesterday);
  const max = Math.max(1, ...recent.map(d => brief.items[d].kpi.yesterday.roas || 0));
  const bars = recent.length > 1 ? `<div style="border:1px solid #e7e8ee;border-radius:12px;padding:12px 14px;margin-bottom:14px;"><div style="font-size:.8rem;font-weight:800;color:#374151;margin-bottom:6px;">최근 ROAS</div>
    <div style="display:flex;align-items:flex-end;gap:6px;height:90px;">${recent.map(d => { const r = brief.items[d].kpi.yesterday.roas || 0, on = d === brief.cur;
      return `<button onclick="brief.cur='${d}';renderBrief()" title="${briefDay(d)} ROAS ${r.toFixed(2)}" style="flex:1;min-width:0;max-width:40px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px;background:none;border:0;padding:0;cursor:pointer;font-size:.62rem;color:${on ? '#111827' : '#9ca3af'};">
        <span>${r.toFixed(1)}</span><i style="display:block;width:100%;height:${Math.max(4, r / max * 56)}px;background:${on ? '#4f46e5' : '#e0e7ff'};border-radius:3px 3px 0 0;"></i><span>${d.slice(5).replace('-', '/')}</span></button>`; }).join('')}</div></div>` : '';
  const secs = (b.sections || []).filter(s => s.items && s.items.length).map(s => `<div style="border:1px solid #e7e8ee;border-radius:12px;padding:12px 16px;margin-bottom:10px;${/할 일/.test(s.title) ? 'border-color:#c7d2fe;background:#f5f7ff;' : ''}">
    <div style="font-size:.9rem;font-weight:800;color:#1e1b4b;margin-bottom:6px;">${esc(s.title)}</div>
    <ul style="margin:0;padding-left:18px;display:grid;gap:5px;font-size:.86rem;line-height:1.6;color:#374151;">${s.items.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('');
  box.innerHTML = stale + nav
    + `<div style="font-size:1.02rem;font-weight:600;line-height:1.55;padding:14px 16px;border-radius:12px;margin-bottom:14px;background:${b.status === 'error' ? '#fef2f2' : '#eef2ff'};color:#1e1b4b;">${esc(b.headline || '')}</div>`
    + kpis + store + bars + secs
    + (b.written_at ? `<div style="font-size:.72rem;color:#9ca3af;margin-top:6px;">작성 ${esc(new Date(b.written_at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }))} · Meta 광고관리자 기준 (어트리뷰션 반영으로 이후 숫자가 조금 바뀔 수 있어요) · 읽기·제안 전용, 예산은 바꾸지 않아요</div>` : '');
}
function briefGo(step) {   // step 1 = 이전(과거) 날짜
  const dates = Object.keys(brief.items || {}).sort().reverse(), i = dates.indexOf(brief.cur);
  if (dates[i + step]) { brief.cur = dates[i + step]; renderBrief(); }
}
async function briefCopy() {
  const b = brief.items && brief.items[brief.cur]; if (!b) return;
  const y = (b.kpi || {}).yesterday;
  const txt = [`[어제 광고 보고서] ${briefDay(b.date)}`, b.headline || '',
    y ? `지출 ${won(y.spend)} · 매출 ${won(y.value)} · ROAS ${(+y.roas).toFixed(2)} · 구매 ${comma(y.purchases)}건 · CPA ${won(y.cpa)}` : '',
    ...(b.sections || []).filter(s => s.items && s.items.length).map(s => `\n■ ${s.title}\n` + s.items.map(t => '· ' + t).join('\n'))].filter(Boolean).join('\n');
  try { await navigator.clipboard.writeText(txt); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast('보고서를 복사했어요');
}
