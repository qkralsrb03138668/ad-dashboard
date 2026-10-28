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
  const kpis = y ? `<div class="kpi-grid bf-kpis" style="margin-bottom:10px;">${BRIEF_KPIS.map(([key, name, fmt, dir]) =>
    `<div class="kpi-tile"><div class="kt-label">${name}</div><div class="kt-value" style="font-size:1.2rem;">${y[key] == null ? '–' : fmt(y[key])}</div>
      <div class="kt-sub" style="display:flex;gap:8px;flex-wrap:wrap;">${delta(y[key], (k.day_before || {})[key], dir, '그제')}${delta(y[key], (k.avg_7d || {})[key], dir, '7일 평균')}</div></div>${key === 'value' ? briefStoreTile(b, delta) : ''}`).join('')}</div>` : '';
  const c = b.cafe24;
  const store = c && c.note ? `<div style="font-size:.76rem;color:#9ca3af;margin:-4px 2px 12px;">카페24: ${esc(c.note)}</div>` : '';   // 매출은 위 '카페24 매출' 칸으로 (2026-10-13)
  // 최근 14일 ROAS 막대 — 누르면 그날로
  const recent = dates.slice(0, 14).reverse().filter(d => brief.items[d].kpi && brief.items[d].kpi.yesterday);
  const max = Math.max(1, ...recent.map(d => brief.items[d].kpi.yesterday.roas || 0));
  const bars = recent.length > 1 ? `<div style="border:1px solid #e7e8ee;border-radius:12px;padding:12px 14px;margin-bottom:14px;"><div style="font-size:.8rem;font-weight:800;color:#374151;margin-bottom:6px;">최근 ROAS</div>
    <div style="display:flex;align-items:flex-end;gap:6px;height:90px;">${recent.map(d => { const r = brief.items[d].kpi.yesterday.roas || 0, on = d === brief.cur;
      return `<button onclick="brief.cur='${d}';renderBrief()" title="${briefDay(d)} ROAS ${r.toFixed(2)}" style="flex:1;min-width:0;max-width:40px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px;background:none;border:0;padding:0;cursor:pointer;font-size:.62rem;color:${on ? '#111827' : '#9ca3af'};">
        <span>${r.toFixed(1)}</span><i style="display:block;width:100%;height:${Math.max(4, r / max * 56)}px;background:${on ? '#4f46e5' : '#e0e7ff'};border-radius:3px 3px 0 0;"></i><span>${d.slice(5).replace('-', '/')}</span></button>`; }).join('')}</div></div>` : '';
  /* 2026-10-13 콘텐츠 마케터용: 캠페인 섹션 뺌 · 잘된/지켜볼 소재는 AI 글 대신 어제 광고 데이터로 카드 진열 (AI 글은 카드 위 메모로) */
  const S = b.sections || [], pick = re => S.find(x => re.test(x.title || ''));
  const text = s0 => s0 && s0.items && s0.items.length ? `<div style="border:1px solid #e7e8ee;border-radius:12px;padding:12px 16px;margin-bottom:10px;${/할 일/.test(s0.title) ? 'border-color:#c7d2fe;background:#f5f7ff;' : ''}">
    <div style="font-size:.9rem;font-weight:800;color:#1e1b4b;margin-bottom:6px;">${esc(s0.title)}</div>
    <ul style="margin:0;padding-left:18px;display:grid;gap:5px;font-size:.86rem;line-height:1.6;color:#374151;">${s0.items.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : '';
  const rest = S.filter(x => !/캠페인|잘된 소재|지켜볼 소재|전체 흐름|할 일/.test(x.title || ''));
  const secs = text(pick(/전체 흐름/)) + briefAdsHtml(b.date, (pick(/잘된 소재/) || {}).items, (pick(/지켜볼 소재/) || {}).items) + rest.map(text).join('') + (authIsAdmin() ? text(pick(/할 일/)) : '');   // 오늘 할 일(예산 운영 제안)은 관리자만
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
    ...(b.sections || []).filter(s => s.items && s.items.length && !/캠페인/.test(s.title) && (authIsAdmin() || !/할 일/.test(s.title))).map(s => `\n■ ${s.title}\n` + s.items.map(t => '· ' + t).join('\n'))].filter(Boolean).join('\n');
  try { await navigator.clipboard.writeText(txt); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast('보고서를 복사했어요');
}

/* 카페24(자사몰) 매출 칸 — 보고서마다 그날 카페24 주문금액이 들어 있어서 그제·7일 평균은 앞 보고서들에서 꺼낸다 (같은 날짜 집계만) */
function briefStoreTile(b, delta) {
  const c = b.cafe24; if (!c) return '';
  const amt = d => { const x = brief.items[d] && brief.items[d].cafe24; return x && x.date === d ? +x.order_amount || 0 : null; };
  const d0 = c.date || b.date, prev = amt(admgrShiftDay(d0, -1));
  const wk = [1, 2, 3, 4, 5, 6, 7].map(i => amt(admgrShiftDay(d0, -i))).filter(v => v != null), avg = wk.length >= 3 ? wk.reduce((s0, v) => s0 + v, 0) / wk.length : null;
  return `<div class="kpi-tile"><div class="kt-label">카페24 매출 (자사몰)${c.date && c.date !== b.date ? ` · ${fmtMD(c.date)}` : ''}</div><div class="kt-value" style="font-size:1.2rem;">${won(c.order_amount || 0)}</div>
    <div class="kt-sub" style="display:flex;gap:8px;flex-wrap:wrap;">${delta(c.order_amount, prev, 1, '그제')}${avg != null ? delta(c.order_amount, avg, 1, `${wk.length}일 평균`) : ''}<span style="color:#6b7280;">주문 ${comma(c.paid_qty || 0)}개 · 취소 ${comma(c.cancel_qty || 0)}</span></div></div>`;
}
/* ═══ 소재 진열 (2026-10-13) — 보고서 날짜 하루치 Meta 광고 데이터를 같은 소재끼리 합쳐서
   잘된 소재 / 지켜볼 소재 카드로. 기준은 테스트 소재 판정과 같은 선 (지출 3만↑, 잘됨 = 구매 3↑ & ROAS 550%↑, 손해 = ROAS 450% 미만 — 10/28 한 장 광고비÷마진 → ROAS)
   + 식는 중 = 그제보다 ROAS가 30% 넘게 떨어짐. 썸네일 누르면 Meta 미리보기 ═══ */
brief.ads = {};
const briefKey = n => String(n || '').normalize('NFC').replace(/\s*\[→[^\]]*\]/g, '').replace(/\s*\/\s*CBO\s*\d+\s*$/i, '').replace(/\s*-\s*사본\s*$/, '').replace(/[_\s-]*test\s*$/i, '').trim();   // [→캠페인]·' / CBO3'·_test 꼬리 제거
function briefAgg(h) {   // hierarchy → Map(소재 키 → 합계) — CBO 복사본처럼 같은 소재가 여러 캠페인에 있으면 하나로
  const m = new Map();
  (h.campaigns || []).forEach(c => (c.adsets || []).forEach(st => (st.ads || []).forEach(a => {
    const multi = (st.ads || []).length > 1 || /^CBO\s*\d/i.test(String(st.name || '').trim());   // 세트명 = 소재명이 아닌 묶음 세트(CBO 등)는 광고명으로
    const k = briefKey(multi ? a.name : st.name); let x = m.get(k);
    if (!x) m.set(k, x = { key: k, id: a.id, set_id: st.id, set: st.name, created: String(a.created || '').slice(0, 10), spend: 0, purchases: 0, value: 0, clicks: 0, n: 0, live: false });
    x.spend += +a.spend || 0; x.purchases += +a.purchases || 0; x.value += +a.value || 0; x.clicks += +a.clicks || 0; x.n++;
    if (a.status === 'ACTIVE') x.live = true;
    if ((+a.spend || 0) > (x.top || 0)) { x.top = +a.spend || 0; x.id = a.id; x.set_id = st.id; x.set = st.name; }   // 대표 = 그날 제일 많이 쓴 복사본
  })));
  return m;
}
async function briefAdsLoad(date) {
  const st = brief.ads[date] = { loading: true };
  try {
    if (typeof admgr === 'object' && !admgr.products && !admgr.productsLoading && typeof admgrLoadProducts === 'function') await admgrLoadProducts();
    const prev = admgrShiftDay(date, -1);
    const [h, h0] = await Promise.all([metaGet({ action: 'hierarchy', preset: 'custom', since: date, until: date }), metaGet({ action: 'hierarchy', preset: 'custom', since: prev, until: prev }).catch(() => null)]);
    const A = briefAgg(h), B = h0 ? briefAgg(h0) : new Map(), J = admgrTJudge;
    const rows = [...A.values()].filter(x => x.spend >= J.spend).map(x => {
      const R = ADMGR_ROAS, cpa = x.purchases ? x.spend / x.purchases : null, roas = x.spend ? x.value / x.spend : 0;
      const p = B.get(x.key), pc = p && p.purchases ? p.spend / p.purchases : null, proas = p && p.spend ? p.value / p.spend : null;
      let kind = null, why = '';
      if (x.purchases >= J.goodPurch && roas >= R.keep) { kind = 'good'; why = `ROAS ${Math.round(roas * 100)}% (${Math.round(R.keep * 100)}%↑)`; }
      else if (roas < R.off) { kind = 'watch'; why = x.purchases ? `ROAS ${Math.round(roas * 100)}% — ${Math.round(R.off * 100)}% 미만` : `${won(J.spend)}↑ 쓰고 0장`; }
      else if (proas && roas < proas * 0.7) { kind = 'watch'; why = `식는 중 — ROAS가 그제 ${Math.round(proas * 100)}%에서 ${Math.round(roas * 100)}%로 떨어졌어요`; }
      return { ...x, cpa, roas, prev: p || null, pcpa: pc, kind, why, fmt: admgrFmtOf(x.key), maker: MAKER_NAMES[admgrMakerOf(x.id, x.set_id, x.set)] || '' };
    });
    st.good = rows.filter(r => r.kind === 'good').sort((a, b) => b.purchases - a.purchases).slice(0, 12);
    st.watch = rows.filter(r => r.kind === 'watch').sort((a, b) => b.spend - a.spend).slice(0, 12);
    st.thumbs = {};
    const sets = [...new Set([...st.good, ...st.watch].map(r => r.set_id))];
    for (let i = 0; i < sets.length; i += 100) { try { const r = await metaGet({ action: 'creatives', set_ids: sets.slice(i, i + 100).join(',') }); (r.ads || []).forEach(a => { st.thumbs[a.id] = a.image || a.thumb || ''; }); } catch (e) { /* 썸네일 없이도 진열 */ } }
    st.loading = false;
  } catch (e) { st.loading = false; st.err = e.message; }
  if (curMenu === 'brief' && brief.cur === date) renderBrief();
}
function briefAdsHtml(date, aiGood, aiWatch) {
  const st = brief.ads[date];
  if (!st) { setTimeout(() => briefAdsLoad(date), 0); return '<div class="empty-state" style="padding:20px;"><p>어제 광고 데이터로 소재를 모으는 중…</p></div>'; }
  if (st.loading) return '<div class="empty-state" style="padding:20px;"><p>어제 광고 데이터로 소재를 모으는 중…</p></div>';
  if (st.err) return `<div class="empty-state" style="padding:20px;"><p>소재 데이터를 못 불러왔어요: ${esc(st.err)}</p></div>`;
  const J = admgrTJudge, man = v => v >= 10000 ? (v / 10000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '') + '만' : comma(Math.round(v));
  const arrow = (cur, prev, goodDown, unit) => { if (cur == null || prev == null || !prev) return ''; const d = cur / prev - 1; if (Math.abs(d) < 0.05) return '<span class="bf-d">→</span>';
    const good = goodDown ? d < 0 : d > 0; return `<span class="bf-d" style="color:${good ? '#16a34a' : '#dc2626'};">${d > 0 ? '▲' : '▼'}${Math.round(Math.abs(d) * 100)}%</span>`; };
  const card = r => {
    const th = st.thumbs[r.id], col = r.roas >= ADMGR_ROAS.keep ? '#15803d' : r.roas >= ADMGR_ROAS.off ? '#b45309' : '#dc2626';   // 색 = ROAS 선
    const name = r.key, prod = name.split('_')[0], tail = name.slice(prod.length).replace(/^_/, '');
    const isNew = r.created && daysBetween(r.created, admgrShiftDay(date, 1)) <= 3;
    return `<div class="bf-card ${r.kind}">
      <div class="bf-th" onclick="showMetaPreview('${r.id}')" title="광고 미리보기">${th ? `<img src="${esc(th)}" loading="lazy">` : ''}${isNew ? '<span class="bf-new">NEW</span>' : ''}</div>
      <div class="bf-b"><b class="bf-p">${esc(prod)}</b><div class="bf-t">${esc(tail)}</div>
        <div class="bf-s">${[r.created ? fmtMD(r.created) + ' 업로드' : '', r.fmt.fmt !== '기타' ? r.fmt.fmt : '', r.fmt.kind, r.maker].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="bf-m"><div><i>팔린 수</i><b>${comma(r.purchases)}장</b>${arrow(r.purchases, r.prev && r.prev.purchases, false)}</div>
          <div><i>한 장 팔 때 광고비</i><b>${r.cpa ? man(r.cpa) + '원' : '–'}</b>${arrow(r.cpa, r.pcpa, true)}</div>
          <div><i>광고비</i><b>${man(r.spend)}원</b></div><div><i>ROAS</i><b style="color:${col};">${Math.round(r.roas * 100)}%</b>${arrow(r.roas, r.prev && r.prev.spend ? r.prev.value / r.prev.spend : null, false)}</div></div>
        <div class="bf-why ${r.kind}">${esc(r.why)}</div></div></div>`;
  };
  const memo = L => L && L.length ? `<details class="bf-ai"><summary>AI 메모 ${L.length}줄</summary><ul>${L.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>` : '';
  const grid = (L, empty) => L.length ? `<div class="bf-grid">${L.map(card).join('')}</div>` : `<div style="font-size:.82rem;color:#9ca3af;padding:6px 2px;">${empty}</div>`;
  return `<div class="bf-sec"><div class="bf-h">✅ 잘된 소재 <span>${st.good.length}개 · 지출 ${won(J.spend)}↑, ${J.goodPurch}장 이상 팔렸고 ROAS ${Math.round(ADMGR_ROAS.keep * 100)}%↑ · 많이 팔린 순</span></div>${memo(aiGood)}${grid(st.good, '기준을 넘은 소재가 없어요')}</div>
    <div class="bf-sec"><div class="bf-h">👀 지켜볼 소재 <span>${st.watch.length}개 · ROAS ${Math.round(ADMGR_ROAS.off * 100)}% 미만이거나, 그제보다 ROAS가 30% 넘게 떨어진 소재 · 광고비 큰 순</span></div>${memo(aiWatch)}${grid(st.watch, '지켜볼 소재가 없어요')}</div>
    <div style="font-size:.7rem;color:#9ca3af;margin:-4px 2px 12px;">${fmtMD(date)} 하루 Meta 광고 데이터 · 이름은 광고세트명 (CBO처럼 여러 소재를 담은 세트는 광고명) · 같은 이름은 합쳐서 · ▲▼ = 그제 대비 · 썸네일을 누르면 광고 미리보기</div>`;
}
