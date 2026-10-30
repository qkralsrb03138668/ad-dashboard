/* 광고관리자 '상품 보드' 탭 (2026-10-30 사용자 요청: DNRB 종합판매처럼 상품 판매 순위·등락을 보면서 그 상품 광고 효율이 같이 떨어지는지 한 줄로).
   카페24 = 어제까지 7일 vs 직전 7일 판매(cafe24-perf performance, 결제수량 순위) · Meta = 어제까지 7일·3일 세트를 상품명으로 합산(알림판이 받아 둔 A.h7·A.h3).
   세트명 → 상품: admgrProductOf → 카페24 상품 색인(admgrProdIdx). 이름이 상품명보다 짧으면 그 이름을 품은 상품 중 7일 판매가 가장 많은 것.
   판정 (판매 7일 vs 직전 7일 ±10% · ROAS 3일 vs 7일 ±10%):
     판매↑ 효율↑ = 증액 후보 · 판매↑ 효율↓ = 소재 피로 · 판매↓ 효율↑ = 노출 부족 · 판매↓ 효율↓ = 식는 중 · 그 밖 = 보합
     증액 후보·노출 부족은 3일 ROAS가 유지선(550%) 이상일 때만 (아니면 보합). 품절·판매 안 함이 먼저. 직전 7일 판매 5개 미만 또는 7일 구매 5건 미만 = 표본 적음 */
'use strict';

const BOARD_V = {
  up: ['증액 후보', '#15803d', '#dcfce7', '판매도 늘고 광고 효율도 오르는 중 — 재고 확인 후 증액'],
  fatigue: ['소재 피로', '#b45309', '#fef3c7', '상품은 더 팔리는데 광고 효율은 떨어지는 중 — 새 소재 투입'],
  reach: ['노출 부족', '#2563eb', '#dbeafe', '광고 효율은 오르는데 판매가 줄어드는 중 — 덜 돌고 있음, 예산 증액 검토'],
  cool: ['식는 중', '#b91c1c', '#fee2e2', '판매도 광고 효율도 떨어지는 중 — 감액·교체'],
  soldout: ['품절', '#7f1d1d', '#fecaca', '전체 품절·판매 안 함 — 광고 끄기'],
  flat: ['보합', '#4b5563', '#f3f4f6', '큰 변화 없음 (±10% 안쪽, 또는 3일 ROAS가 유지선 미만)'],
  few: ['표본 적음', '#9ca3af', '#f9fafb', '직전 7일 판매 5개 미만 또는 7일 광고 구매 5건 미만'],
};

/* 순수 계산 — 테스트에서 인자 전부 넘김. cur/prev = performance rows(결제수량 내림차순) 또는 null(카페24 실패) */
function admgrBoardCalc(cur, prev, h7, h3, idx, stock, d) {
  const { prodOf, norm, PJ, VJ, keep } = d;
  const rank = rows => new Map((rows || []).map((r, i) => [Number(r.product_no), { rank: i + 1, qty: r.paid_qty || 0, amt: r.order_amount || 0 }]));
  const C = rank(cur), P = rank(prev);
  const agg = h => { const m = new Map(); for (const c of (h && h.campaigns) || []) for (const s of c.adsets || []) { if (!(s.spend > 0)) continue;
    const k = prodOf({ name: String(s.name).replace(/^(상품|종합)\s*CBO_/, '') }), o = m.get(k) || { sp: 0, p: 0, v: 0, sets: 0 };
    o.sp += s.spend; o.p += PJ(s); o.v += VJ(s); o.sets++; m.set(k, o); } return m; };
  const m7 = agg(h7), m3 = agg(h3), byNo = new Map(), unmatched = [];
  const find = name => { const n = norm(name); const hit = idx.find(p => n.includes(p.n)); if (hit) return hit;
    if (n.length < 4) return null;
    return idx.filter(p => p.n.includes(n)).sort((a, b) => ((C.get(Number(b.no)) || {}).qty || 0) - ((C.get(Number(a.no)) || {}).qty || 0))[0] || null; };
  for (const [name, w] of m7) {
    const p = find(name); if (!p) { unmatched.push({ name, sp: w.sp, p: w.p }); continue; }
    const no = Number(p.no), o = byNo.get(no) || { no, name: p.name, metaNames: [], sp7: 0, p7: 0, v7: 0, sp3: 0, p3: 0, v3: 0, sets: 0 };
    const t = m3.get(name) || { sp: 0, p: 0, v: 0 };
    o.metaNames.push(name); o.sp7 += w.sp; o.p7 += w.p; o.v7 += w.v; o.sp3 += t.sp; o.p3 += t.p; o.v3 += t.v; o.sets += w.sets; byNo.set(no, o);
  }
  const trend = (a, b) => b == null ? null : a >= b * 1.1 ? 1 : a <= b * 0.9 ? -1 : 0;
  const rows = [...byNo.values()].map(o => {
    const c = C.get(o.no), q = P.get(o.no), st = stock && stock.get(o.no);
    const r7 = o.sp7 > 0 ? o.v7 / o.sp7 : 0, r3 = o.sp3 > 0 ? o.v3 / o.sp3 : null;
    const sT = cur && q && q.qty >= 5 ? trend(c ? c.qty : 0, q.qty) : null, eT = o.p7 >= 5 && r3 != null ? trend(r3, r7) : null;
    let v = st && ['all', 'off', 'gone'].includes(st.state) ? 'soldout' : sT == null || eT == null ? 'few'
      : sT > 0 && eT > 0 ? 'up' : sT > 0 && eT < 0 ? 'fatigue' : sT < 0 && eT > 0 ? 'reach' : sT < 0 && eT < 0 ? 'cool' : 'flat';
    if ((v === 'up' || v === 'reach') && !(r3 >= keep)) v = 'flat';
    return { ...o, rank: c ? c.rank : null, prevRank: q ? q.rank : null, qty: c ? c.qty : 0, prevQty: q ? q.qty : 0, amt: c ? c.amt : 0,
      r7, r3, mer: cur && o.sp7 > 0 ? (c ? c.amt : 0) / o.sp7 : null, stock: st || null, sT, eT, v };
  });
  return { rows, unmatched: unmatched.sort((a, b) => b.sp - a.sp) };
}

admgr.board = { loading: false, loaded: false, cur: null, prev: null, err: '', at: 0, range: null, stock: null, filter: 'all', sort: 'rank' };

function admgrBoardRange() { return { s: todayStr(-7), e: todayStr(-1), ps: todayStr(-14), pe: todayStr(-8) }; }
function admgrBoardLoadCache() {
  const b = admgr.board, c = lsGet('adc_admgr_board', null);
  if (c && c.cur) Object.assign(b, { cur: c.cur, prev: c.prev, at: c.at, range: c.range, loaded: true });
}
async function admgrBoardFetch() {
  const b = admgr.board; if (b.loading) return;
  b.loading = true; b.err = ''; renderAdmgr();
  if (!admgr.products && !admgr.productsLoading) admgrLoadProducts();
  setTimeout(() => admgrPromoEnsure(), 0);   // Meta 7일·3일 (30분 유지 — 이미 있으면 그대로)
  const R = admgrBoardRange();
  try {
    const [cur, prev] = await Promise.all([perfApi({ action: 'performance', start_date: R.s, end_date: R.e }), perfApi({ action: 'performance', start_date: R.ps, end_date: R.pe })]);
    Object.assign(b, { cur: cur.rows || [], prev: prev.rows || [], at: Date.now(), range: R, loaded: true });
    lsSet('adc_admgr_board', { cur: b.cur, prev: b.prev, at: b.at, range: R });
  } catch (e) { b.err = e.message || String(e); b.loaded = true; }
  b.loading = false; renderAdmgr();
  admgrBoardStock();
}
async function admgrBoardStock() {   // 표에 나온 상품 재고 — 뒤에서 받아 다시 그림 (상품당 1회 호출이라 수십 초 걸릴 수 있음)
  const b = admgr.board, A = admgrAlert; if (!A.h7 || !admgr.products) return;
  const nos = admgrBoardCalc(b.cur, b.prev, A.h7, A.h3, admgrProdIdx(), null, admgrBoardDeps()).rows.map(r => r.no);
  if (!nos.length) return;
  try { b.stock = await stockGet(nos); renderAdmgr(true); } catch (e) { /* 재고 칸만 비움 */ }
}
const admgrBoardDeps = () => ({ prodOf: admgrProductOf, norm: admgrNorm, PJ: admgrPJ, VJ: admgrVJ, keep: ADMGR_ROAS.keep });
function admgrBoardSet(k, v) { admgr.board[k] = v; renderAdmgr(); }

function renderAdmgrBoard() {
  const b = admgr.board, A = admgrAlert;
  if (!admgrCfg() || admgr.demo) return `<div class="empty-state"><p>실제 Meta·카페24 연동 후에 상품 보드가 나와요.</p></div>`;
  if (!b.loaded) return `<div class="empty-state"><div class="es-icon"><i class="fa-solid fa-ranking-star"></i></div><p>${b.loading ? '카페24 판매 데이터를 받는 중… (처음엔 수십 초 걸릴 수 있어요)' : '<b>새로고침</b>을 누르면 카페24 판매 순위와 광고 효율을 함께 불러와요.'}</p></div>`;
  if (!A.h7) { setTimeout(() => admgrPromoEnsure(), 0); return `<div class="empty-state"><p>Meta 최근 7일·3일 데이터를 받는 중…</p></div>`; }
  if (!admgr.products) { if (!admgr.productsLoading) setTimeout(() => admgrLoadProducts(), 0); return `<div class="empty-state"><p>카페24 상품 목록을 받는 중…</p></div>`; }
  if (b.stock === null && !b.stockAsked) { b.stockAsked = true; setTimeout(() => admgrBoardStock(), 0); }
  const cur = b.err ? null : b.cur, { rows: all, unmatched } = admgrBoardCalc(cur, b.err ? null : b.prev, A.h7, A.h3, admgrProdIdx(), b.stock, admgrBoardDeps());
  let rows = admgr.q ? all.filter(r => (r.name + ' ' + r.metaNames.join(' ')).toLowerCase().includes(admgr.q)) : all;
  if (b.filter !== 'all') rows = rows.filter(r => r.v === b.filter);
  rows.sort((x, y) => b.sort === 'spend' ? y.sp7 - x.sp7 : (x.rank || 1e9) - (y.rank || 1e9) || y.sp7 - x.sp7);
  const R = b.range || admgrBoardRange(), md = s => String(s).slice(5).replace('-', '/');
  const pct = v => v == null ? '—' : Math.round(v * 100).toLocaleString() + '%';
  const arrow = (a, p) => { if (!p) return ''; const d = a / p - 1, c = d >= 0.1 ? '#dc2626' : d <= -0.1 ? '#2563eb' : '#9ca3af'; return ` <small style="color:${c};font-weight:700;">${d >= 0 ? '+' : ''}${Math.round(d * 100)}%</small>`; };
  const rankCell = r => { if (!r.rank) return '<span class="ag-muted">—</span>'; const d = r.prevRank ? r.prevRank - r.rank : null;
    return `<b>${r.rank}</b>위 ${d == null ? '<span style="background:#eef2ff;color:#4338ca;border-radius:6px;padding:0 6px;font-size:.64rem;font-weight:800;" title="직전 7일엔 판매 없음">NEW</span>' : d > 0 ? `<span style="color:#dc2626;font-weight:800;" title="직전 ${r.prevRank}위">↑${d}</span>` : d < 0 ? `<span style="color:#2563eb;font-weight:800;" title="직전 ${r.prevRank}위">↓${-d}</span>` : '<span class="ag-muted">—</span>'}`; };
  const stockCell = r => !r.stock ? '<span class="ag-muted">—</span>' : r.stock.state === 'ok' ? '<span style="color:#15803d;">있음</span>' : `<span style="color:${r.stock.state === 'part' ? '#b45309' : '#b91c1c'};" title="${esc(stockLine(r.stock))}">${r.stock.state === 'part' ? '일부 품절' : esc(STOCK_TXT[r.stock.state] || r.stock.state)}</span>`;
  const badge = v => { const [t, c, bg, tip] = BOARD_V[v]; return `<span class="status-badge" style="color:${c};background:${bg};font-size:.68rem;" title="${tip}">${t}</span>`; };
  const chip = (k, label) => `<button class="filter-tab ${b.filter === k ? 'active' : ''}" onclick="admgrBoardSet('filter','${k}')" title="${k === 'all' ? '' : BOARD_V[k][3]}">${label} <small class="ag-muted">${k === 'all' ? all.length : all.filter(r => r.v === k).length}</small></button>`;
  const ctrl = `<div class="filter-tabs m-wrap" style="margin-bottom:10px;">${chip('all', '전체')}${['up', 'fatigue', 'reach', 'cool', 'soldout', 'flat', 'few'].map(k => chip(k, BOARD_V[k][0])).join('')}
    <span style="width:1px;height:22px;background:#e5e7eb;margin:0 4px;"></span>
    <button class="filter-tab ${b.sort === 'rank' ? 'active' : ''}" onclick="admgrBoardSet('sort','rank')">판매순위순</button><button class="filter-tab ${b.sort === 'spend' ? 'active' : ''}" onclick="admgrBoardSet('sort','spend')">광고 지출순</button></div>`;
  const warn = b.err ? `<div class="info-bar" style="background:#fef2f2;color:#991b1b;"><i class="fa-solid fa-triangle-exclamation"></i> 카페24 판매 데이터를 못 받았어요 (${esc(b.err)}) — 광고 칸만 보여요. 카페24 연결이 끊겼으면 판매 성과 메뉴에서 다시 연결하세요.</div>` : '';
  const info = `<div class="info-bar"><i class="fa-solid fa-ranking-star"></i> 판매 = 카페24 결제수량 <b>${md(R.s)}~${md(R.e)}</b> vs 직전 ${md(R.ps)}~${md(R.pe)} · 광고 = Meta 어제까지 7일 → 3일 (${admgrAttrTxt()}) · 순위는 전체 상품 중 · 받은 시각 ${b.at ? new Date(b.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}${b.loading ? ' · 새로 받는 중…' : ''}</div>`;
  const tr = r => `<tr><td style="white-space:nowrap;">${rankCell(r)}</td>
    <td class="name-cell" style="text-align:left;white-space:normal;min-width:180px;"><b>${esc(coreName(r.name))}</b><div class="ag-muted" style="font-size:.66rem;">광고 이름: ${esc(r.metaNames.join(' · '))} · 세트 ${r.sets}</div></td>
    <td style="white-space:nowrap;">${comma(r.qty)}개${arrow(r.qty, r.prevQty)}<div class="ag-muted" style="font-size:.66rem;">직전 ${comma(r.prevQty)}개</div></td>
    <td style="white-space:nowrap;">${cur ? admgrW(r.amt) : '—'}</td>
    <td style="white-space:nowrap;">${admgrW(Math.round(r.sp7))}<div class="ag-muted" style="font-size:.66rem;">구매 ${comma(r.p7)}건</div></td>
    <td style="white-space:nowrap;"><b>${pct(r.r7)}</b> → <b style="color:${r.eT > 0 ? '#dc2626' : r.eT < 0 ? '#2563eb' : '#374151'};">${pct(r.r3)}</b><div class="ag-muted" style="font-size:.66rem;">3일 지출 ${admgrW(Math.round(r.sp3))} · ${comma(r.p3)}건</div></td>
    <td style="white-space:nowrap;">${pct(r.mer)}</td><td style="white-space:nowrap;">${stockCell(r)}</td><td>${badge(r.v)}</td></tr>`;
  const table = rows.length ? `<div class="table-wrap" style="max-height:640px;overflow:auto;"><table style="font-size:.76rem;"><thead><tr>
    <th>판매 순위</th><th style="text-align:left;">상품</th><th>판매 7일</th><th>카페24 매출</th><th>광고 지출 7일</th><th>ROAS 7일 → 3일</th>
    <th title="카페24 7일 매출 ÷ Meta 7일 광고비 — Meta ROAS보다 훨씬 높으면 광고 밖(검색·재구매 등)에서도 팔리는 상품">매출÷광고비 <span style="color:#c4c9d4;">?</span></th><th>재고</th><th>판정</th></tr></thead>
    <tbody>${rows.map(tr).join('')}</tbody></table></div>` : `<div class="empty-state"><p>${all.length ? '이 조건에 맞는 상품이 없어요.' : '최근 7일 광고 지출이 있는 상품이 없어요.'}</p></div>`;
  const un = unmatched.length ? `<details style="margin-top:10px;"><summary style="cursor:pointer;font-size:.74rem;color:#6b7280;">연결 안 됨 ${unmatched.length}개 — 세트 이름으로 카페24 상품을 못 찾음 (7일 지출 ${admgrW(Math.round(unmatched.reduce((a, x) => a + x.sp, 0)))})</summary>${unmatched.map(x => `<div style="font-size:.72rem;color:#6b7280;padding:2px 0;">${esc(x.name)} · 지출 ${admgrW(Math.round(x.sp))} · 구매 ${comma(x.p)}건</div>`).join('')}</details>` : '';
  return warn + ctrl + info + table + un;
}
