/* ④-2b 소재 등록 (파일 → 카페24 상품 매칭 → Meta 보관함)
   (index.html에서 분리 — 2026-09-08 2단계. 파일 순서는 index.html의 <script> 순서, 전역 함수·변수를 그대로 공유) */
'use strict';

/* ═══════════ ④-2b 소재 등록 (광고소재 대시보드 안) ═══════════
   파일명 → 핵심 상품명(괄호 묶음 제거) → 카페24 상품 매칭(정확히 1개면 자동, 여러 개면 선택, 없으면 후보) →
   URL 자동 → 문구(선택) → 파일은 Meta 보관함(meta-upload image/video_*)으로, 메타데이터는 creatives 표로.
   체크보드는 creatives를 읽어 스토리(이미지)·릴스(영상) 칸을 자동 채운다. */
const reg = { products: null, aliases: null, rows: [], list: null, listLoading: false, filter: 'registered', running: false, preset: null };
const SHOP_URL = (window.DASH_CFG && window.DASH_CFG.SHOP_URL) || 'https://danarobe.com';
const REG_KIND_TYPE = { image: '스토리', video: '릴스' };
// 맥 파일명은 한글이 자모 분리(NFD)로 들어와 카페24 상품명(NFC)과 문자열이 달라진다 → 항상 NFC로 맞춘 뒤 비교 (실사고 2026-09-10)
function coreName(n) { let s = String(n || '').normalize('NFC').replace(/[（）]/g, m => m === '（' ? '(' : ')'); for (let i = 0; i < 6; i++) s = s.replace(/\([^()]*\)|\[[^\[\]]*\]/g, ' '); return s.replace(/\s+/g, ' ').trim(); }
function fileCore(fileName) { let n = String(fileName).normalize('NFC').replace(/\.[^.]+$/, ''); n = n.split('_')[0]; n = n.replace(/\s+\d{6}\b.*$/, ''); return coreName(n); }
const normKey = s => coreName(s).toLowerCase().replace(/\s+/g, '');
const productUrl = no => `${SHOP_URL}/product/detail.html?product_no=${no}`;
/* 썸네일: 로컬 파일은 브라우저 객체 URL(첫 장면), 등록된 소재는 Meta가 준 주소(영상 thumbnail_url · 이미지 url) */
function mediaThumbHtml(src, kind, size) {
  const s = size || 44, box = `width:${s}px;height:${s}px;border-radius:6px;background:#f3f4f6;object-fit:cover;flex:none;`;
  if (!src) return `<span style="${box}display:inline-flex;align-items:center;justify-content:center;color:#c7d2fe;"><i class="fa-solid ${kind === 'video' ? 'fa-video' : 'fa-image'}"></i></span>`;
  return kind === 'video' && src.startsWith('blob:')
    ? `<video src="${esc(src)}#t=0.1" muted playsinline preload="metadata" style="${box}"></video>`
    : `<img src="${esc(src)}" loading="lazy" style="${box}" onerror="this.style.visibility='hidden'" />`;
}
function regFileThumb(r) { if (!r.thumbUrl) { try { r.thumbUrl = URL.createObjectURL(r.file); } catch (e) { r.thumbUrl = ''; } } return mediaThumbHtml(r.thumbUrl, r.kind); }
const mediaThumbSrc = m => m ? (m.thumbnail_url || m.url || '') : '';

async function regLoadRefs(force) {
  if (force || !reg.products) reg.products = (await perfApi({ action: 'products' })).rows.map(r => ({ ...r, core: coreName(r.name), key: normKey(r.name) }));
  if (force || !reg.aliases) reg.aliases = (await uplCall({ action: 'aliases' })).rows;
  $('reg-dl').innerHTML = reg.products.map(p => `<option value="${esc(p.name)}"></option>`).join('');
}
function regMatch(fileName) {
  const core = fileCore(fileName), key = normKey(core);
  const exact = reg.products.filter(p => p.key === key);
  const alias = reg.aliases.find(a => normKey(a.core_name) === key);
  let cands = exact;
  if (!cands.length && key) cands = reg.products.filter(p => p.key.includes(key) || key.includes(p.key)).slice(0, 8);
  if (!cands.length && key) {
    const toks = core.split(' ').filter(t => t.length > 1);
    cands = reg.products.filter(p => toks.filter(t => p.core.includes(t)).length >= Math.max(1, Math.ceil(toks.length * 0.6))).slice(0, 8);
  }
  const aliasHit = alias && reg.products.find(p => p.product_no === alias.product_no);
  let pick = null, why = 'none';
  if (exact.length === 1) { pick = exact[0]; why = 'auto'; }
  else if (aliasHit) { pick = aliasHit; why = 'alias'; if (!cands.find(p => p.product_no === aliasHit.product_no)) cands = [aliasHit, ...cands]; }
  return { core, cands, pick, why, multi: exact.length > 1 };
}
async function regAddFiles(list) {
  try { await regLoadRefs(); if (reg.preset && !reg.list) await regRefresh(); } catch (e) { toast('상품 목록 불러오기 실패: ' + e.message); return; }
  for (const f of list) {
    const isVideo = /^video\//.test(f.type) || /\.(mp4|mov|m4v)$/i.test(f.name);
    const isImage = /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);
    if (!isVideo && !isImage) { toast(`${f.name}: 지원하지 않는 형식`); continue; }
    if (isImage && f.size > 30 * 1024 * 1024) { toast(`${f.name}: 이미지는 30MB까지`); continue; }
    if (reg.rows.some(r => r.file.name === f.name && r.file.size === f.size)) continue;
    if (reg.preset) {   // 상품을 먼저 골랐으면 파일명은 안 본다 — 규칙대로 새 파일명 생성 (광고세트·광고명이 됨)
      const pr = reg.preset, kind = isVideo ? 'video' : 'image', seq = regPresetSeq(pr, kind), ext = (f.name.match(/\.([^.]+)$/) || [])[1] || (isVideo ? 'mp4' : 'jpg');
      const tag = ($('reg-preset-tag') && $('reg-preset-tag').value || '').trim();
      const fileName = regPresetFileName(pr, kind, seq, ext, null, tag);
      reg.rows.push({ id: newId(), file: f, fileName, seq, ext, tag, kind, name: fileName.replace(/\.[^.]+$/, ''), core: pr.core, cands: [pr], product: pr, why: 'preset', multi: false,
        url: productUrl(pr.product_no), text: null, sel: false, status: '대기', media: null, done: false });
      continue;
    }
    const m = regMatch(f.name);
    reg.rows.push({ id: newId(), file: f, fileName: f.name, kind: isVideo ? 'video' : 'image', name: f.name.replace(/\.[^.]+$/, ''), core: m.core, cands: m.cands, product: m.pick, why: m.why, multi: m.multi,
      url: m.pick ? productUrl(m.pick.product_no) : '', text: null, sel: false, status: '대기', media: null, done: false });
  }
  regRender();
  const ask = reg.rows.filter(r => !r.done && (r.multi || !r.product)).length;
  if (ask) toast(`상품을 골라야 하는 파일 ${ask}개 — 노란 행을 확인하세요`);
  regLoadCopies();
}
/* ── 상품별 고정 문구 (product_copy) ── */
const regCopies = new Map();   // product_no → { text, source, updated_at }
function regCopyText(copy, url) { return { message: copy.text.message || '', title: copy.text.title || '', description: copy.text.description || '', link: url || '', cta: copy.text.cta || 'LEARN_MORE' }; }
/* 순수 함수(검사용): 상품이 정해졌고 문구가 비어 있는 행에 저장본을 채운다. 채운 행 수를 돌려준다 */
function regApplySavedCopies(rows, copies) {
  let n = 0;
  for (const r of rows) {
    if (r.done || r.text || !r.product) continue;
    const c = copies.get(r.product.product_no); if (!c) continue;
    r.text = regCopyText(c, r.url); r.textFrom = 'saved'; n++;
  }
  return n;
}
async function regLoadCopies() {
  const nos = [...new Set(reg.rows.filter(r => !r.done && r.product).map(r => r.product.product_no))].filter(no => !regCopies.has(no));
  if (nos.length) {
    try { for (const row of (await perfApi({ action: 'copy_get', product_nos: nos.join(',') })).rows) regCopies.set(row.product_no, row); }
    catch (e) { toast('저장 문구 조회 실패: ' + e.message); return; }
  }
  const n = regApplySavedCopies(reg.rows, regCopies);
  if (n) { regRender(); toast(`저장된 상품 문구 ${n}개를 자동으로 넣었어요`); }
}
async function regGen(i) {   // 행 하나 AI 생성 → 그 상품에 고정
  const r = reg.rows[i]; if (!r || !r.product) { toast('상품을 먼저 정하세요'); return; }
  await regGenRows([r]);
}
async function regGenSel() { const rows = reg.rows.filter(r => r.sel && !r.done && r.product); if (!rows.length) { toast('상품이 정해진 파일을 체크하세요'); return; } await regGenRows(rows); }
async function regGenRows(rows) {
  const byNo = new Map(); for (const r of rows) if (!byNo.has(r.product.product_no)) byNo.set(r.product.product_no, r);   // 같은 상품은 한 번만 생성
  let ok = 0;
  for (const [no, first] of byNo) {
    for (const r of rows) if (r.product.product_no === no) { r.status = 'AI 문구 생성 중…'; }
    regRender();
    try {
      const { row } = await perfApi({ action: 'copy_generate' }, { product_no: no, product_name: first.product.name });
      regCopies.set(no, row);
      for (const r of rows) if (r.product.product_no === no) { r.text = regCopyText(row, r.url); r.textFrom = 'ai'; r.status = '대기'; r.sel = false; ok++; }
    } catch (e) {
      for (const r of rows) if (r.product.product_no === no) r.status = '문구 생성 실패: ' + e.message;
    }
    regRender();
  }
  if (ok) toast(`AI 문구 ${ok}개 생성 — 상품에 고정했어요. 열어서 다듬어도 돼요`);
}
async function regCopySave(product, text) {   // 직접 기입·수정한 문구를 그 상품에 고정
  try { const { row } = await perfApi({ action: 'copy_save' }, { product_no: product.product_no, product_name: product.name, text: { message: text.message, title: text.title, description: text.description, cta: text.cta } }); regCopies.set(product.product_no, row); }
  catch (e) { toast('상품 문구 저장 실패: ' + e.message); }
}
/* ── 상품 먼저 고르기 (핸드폰 업로드처럼 파일명을 못 바꿀 때) ── */
/* 먼저 고른 상품의 파일명 규칙: `상품명_R1|P1_마진_YYMMDD_test.확장자`
   상품명 = 괄호 묶음 뺀 핵심명 · R=영상/P=이미지 + 순번(이미 등록된 것 이어서) · 마진 = (판매가−공급가) 천 원 단위 내림 · 날짜 = 오늘 */
/* 상품명 괄호 안의 버전 표기(여름ver / 기모ver. / 봄.가을VER.)는 파일명 상품명 앞에 붙인다 — 같은 이름 다른 버전 구분 */
function regVerTag(name) {
  // 'ver' 바로 앞 한글 단어(봄/가을, 봄.가을, 투포켓 등) + ver(.)(숫자) — 'silver' 같은 영단어 안의 ver은 제외. 파일명에 못 쓰는 / 는 . 으로
  const m = String(name || '').normalize('NFC').match(/([가-힣0-9.\/]+?)\s*ver\.?(\d*)(?=[\s),\]]|$)/i);   // 쉼표는 단어 경계 → '2사이즈,여름ver' → 여름ver
  return m ? `${m[1].replace(/\//g, '.')}ver${m[2]}` : '';
}
function regPresetFileName(pr, kind, seq, ext, ymd, tag) {   // tag(소구점: 착용컷·인스타·다나대표…)는 순번 뒤에
  const ver = regVerTag(pr.name), pname = ver ? `${ver} ${pr.core}` : pr.core;
  const margin = Math.floor(Math.max(0, (Number(pr.price) || 0) - (Number(pr.supply_price) || 0)) / 1000);
  const d = (ymd || todayStr(0)).replace(/-/g, '').slice(2);   // 2026-09-11 → 260911
  const t = String(tag || '').trim().replace(/[_\/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  return `${pname}_${kind === 'video' ? 'R' : 'P'}${seq}${t ? '_' + t : ''}_${margin}_${d}_test${ext ? '.' + ext.toLowerCase() : ''}`;
}
function regRowRename(i, tag) {   // 행의 소구점 바꾸면 파일명 다시 생성 (먼저 고른 상품 행만)
  const r = reg.rows[i]; if (!r || r.why !== 'preset' || r.done) return;
  r.tag = tag; r.fileName = regPresetFileName(r.product, r.kind, r.seq, r.ext, null, tag); r.name = r.fileName.replace(/\.[^.]+$/, '');
  const cell = document.querySelector(`#reg-rows tbody tr:nth-child(${i + 1}) .reg-fname`); if (cell) cell.textContent = r.fileName;
}
function regPresetSeq(pr, kind) {   // 다음 순번 = 서버에 등록된 같은 상품·같은 유형 수 + 이번 배치에 담긴 수 + 1
    const onServer = (reg.list || []).filter(r => r.product_no === pr.product_no && r.kind === kind).length;
    const inBatch = reg.rows.filter(r => r.product && r.product.product_no === pr.product_no && r.kind === kind && !r.done).length;
    return onServer + inBatch + 1;
}
async function regPresetInit() {
  if (reg.products) { regRecentRender(); return; }
  try { await regLoadRefs(); } catch (e) { toast('상품 목록 불러오기 실패: ' + e.message); return; }
  regRecentRender(); regPresetFilter();
}
/* 검색 → 썸네일 목록 (최대 8개). 결과가 하나면 입력 중 자동 선택 */
function regPresetFilter(auto) {
  const q = ($('reg-preset-q').value || '').trim().toLowerCase(), box = $('reg-preset-results');
  if (!q) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const rows = (reg.products || []).filter(p => p.name.toLowerCase().includes(q) || String(p.product_no).includes(q)).slice(0, 8);
  box.style.display = 'block';
  box.innerHTML = rows.map(p => `<div onclick="regPresetPick('${p.product_no}')" style="display:flex;align-items:center;gap:10px;padding:7px 10px;cursor:pointer;border-bottom:1px solid #f1f5f9;">
      ${mediaThumbHtml(p.image, 'image', 40)}<div style="flex:1;min-width:0;"><div style="font-size:.84rem;color:#1e1b4b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.name)}</div>
      <div style="font-size:.7rem;color:#9ca3af;">${regVerTag(p.name) ? esc(regVerTag(p.name)) + ' · ' : ''}${esc(p.core)} · 등록 ${p.created ? p.created.slice(2).replace(/-/g, '.') : '-'} · 마진 ${Math.floor(Math.max(0, p.price - p.supply_price) / 1000)}</div></div></div>`).join('')
    || '<div style="padding:12px;font-size:.8rem;color:#9ca3af;">검색 결과 없음 — 진열·판매 중 상품만 나와요</div>';
  if (auto && rows.length === 1 && !reg.preset) regPresetPick(String(rows[0].product_no));
}
function regPresetPick(no) {
  reg.preset = (reg.products || []).find(p => String(p.product_no) === String(no)) || null;
  const card = $('reg-preset-card'), picker = $('reg-preset-picker');
  if (reg.preset) {
    const p = reg.preset;
    card.style.display = 'flex'; picker.style.display = 'none';
    card.innerHTML = `${mediaThumbHtml(p.image, 'image', 56)}<div style="flex:1;min-width:0;">
      <div style="font-size:.72rem;color:#6b7280;">① 이 상품으로 등록돼요 — 파일명은 안 봐요</div>
      <div style="font-size:.9rem;font-weight:800;color:#1e1b4b;">${esc(p.name)}</div>
      <div style="font-size:.72rem;color:#6b7280;">파일명: <b>${esc((regVerTag(p.name) ? regVerTag(p.name) + ' ' : '') + p.core)}</b>_R1·P1_소구점_<b>${Math.floor(Math.max(0, p.price - p.supply_price) / 1000)}</b>_오늘_test</div></div>
      <button class="btn-ghost" style="padding:6px 12px;" onclick="regPresetPick('')"><i class="fa-solid fa-xmark"></i> 다른 상품</button>`;
    $('reg-preset-q').value = ''; $('reg-preset-results').style.display = 'none';
  } else {
    card.style.display = 'none'; picker.style.display = 'block'; card.innerHTML = '';
    setTimeout(() => $('reg-preset-q').focus(), 0);
  }
  regStepsRender();
}
/* 최근 등록 상품 (브라우저 기억, 5개) */
function regRecentRender() {
  const box = $('reg-recent'); if (!box) return;
  const nos = lsGet('adc_reg_recent', []), items = nos.map(no => (reg.products || []).find(p => p.product_no === no)).filter(Boolean);
  box.innerHTML = items.length ? `<span style="font-size:.7rem;color:#9ca3af;">최근:</span>` + items.map(p => `<button class="btn-ghost" style="padding:3px 10px;font-size:.72rem;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" onclick="regPresetPick('${p.product_no}')" title="${esc(p.name)}">${esc(p.core)}</button>`).join('') : '';
}
function regRecentPush(no) { const list = [no, ...lsGet('adc_reg_recent', []).filter(x => x !== no)].slice(0, 5); lsSet('adc_reg_recent', list); regRecentRender(); }
/* 소구점 버튼 — 기본 3개 + 직접 추가(브라우저 기억). 누르면 선택, 다시 누르면 해제 */
const REG_TAGS_DEFAULT = ['착용컷', '인스타', '다나대표'];
function regTags() { return lsGet('adc_reg_tags', null) || REG_TAGS_DEFAULT; }
function regTagsRender() {
  const box = $('reg-tags'); if (!box) return;
  const cur = $('reg-preset-tag').value;
  box.innerHTML = regTags().map(t => `<button class="${cur === t ? 'btn-analyze' : 'btn-ghost'}" style="padding:4px 12px;font-size:.76rem;" onclick="regTagPick('${esc(t)}')">${esc(t)}</button>`).join('')
    + `<button class="btn-ghost" style="padding:4px 10px;font-size:.72rem;color:#6b7280;" onclick="regTagAdd()" title="소구점 버튼 추가"><i class="fa-solid fa-plus"></i> 추가</button>`
    + (regTags().length > REG_TAGS_DEFAULT.length || regTags().some(t => !REG_TAGS_DEFAULT.includes(t)) ? `<button class="btn-ghost" style="padding:4px 8px;font-size:.68rem;color:#9ca3af;" onclick="regTagRemove()" title="버튼 지우기"><i class="fa-solid fa-minus"></i></button>` : '')
    + `<span style="font-size:.7rem;color:#9ca3af;margin-left:4px;">${cur ? `선택: <b style="color:#3730a3;">${esc(cur)}</b> (파일명 순번 뒤에 들어가요)` : '선택 안 함 — 순번_마진 형식'}</span>`;
}
function regTagPick(t) { $('reg-preset-tag').value = $('reg-preset-tag').value === t ? '' : t; regTagsRender(); regStepsRender(); }
function regTagAdd() {
  const t = (prompt('추가할 소구점 (예: 착용컷2, 리뷰, 상세컷)') || '').trim().replace(/[_\/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return; const list = regTags(); if (list.includes(t)) { regTagPick(t); return; }
  lsSet('adc_reg_tags', [...list, t]); regTagPick(t);
}
function regTagRemove() {
  const list = regTags(); const t = (prompt(`지울 소구점 이름을 입력하세요\n${list.join(' · ')}`) || '').trim();
  if (!t || !list.includes(t)) return;
  lsSet('adc_reg_tags', list.filter(x => x !== t)); if ($('reg-preset-tag').value === t) $('reg-preset-tag').value = ''; regTagsRender();
}
/* 단계 표시: ① 상품 → ② 소구점 → ③ 파일 → ④ 등록 */
function regStepsRender() {
  const box = $('reg-steps'); if (!box) return;
  const cur = reg.rows.some(r => !r.done) ? 4 : reg.preset ? ($('reg-preset-tag').value ? 3 : 2) : 1;
  const steps = [['① 상품 고르기', '핸드폰 업로드는 필수 · PC는 파일명 자동 인식이면 생략'], ['② 소구점', '선택'], ['③ 파일 올리기', ''], ['④ 등록', '']];
  box.innerHTML = steps.map(([t, hint], i) => `<span title="${esc(hint)}" style="padding:3px 10px;border-radius:999px;${i + 1 === cur ? 'background:#4f46e5;color:#fff;font-weight:800;' : i + 1 < cur ? 'background:#e0e7ff;color:#3730a3;' : 'background:#f1f5f9;color:#9ca3af;'}">${t}</span>${i < 3 ? '<span style="color:#cbd5e1;">→</span>' : ''}`).join('');
}
function regDel(id) { reg.rows = reg.rows.filter(r => r.id !== id); regRender(); }
function regPick(i, no) {
  const r = reg.rows[i], p = reg.products.find(p => String(p.product_no) === String(no));
  r.product = p || null; r.url = p ? productUrl(p.product_no) : ''; r.why = p ? 'manual' : 'none';
  if (p && r.textFrom === 'saved') { r.text = null; r.textFrom = null; }   // 다른 상품으로 바꾸면 이전 상품 저장본은 뺀다
  regRender(); if (p) regLoadCopies();
}
function regSearch(i, name) { const p = reg.products.find(p => p.name === name); if (p) { if (!reg.rows[i].cands.find(c => c.product_no === p.product_no)) reg.rows[i].cands.unshift(p); regPick(i, p.product_no); } }
function regSelBtn() { const n = reg.rows.filter(r => r.sel && !r.done).length, b = $('reg-text-sel'); if (!b) return; b.disabled = !n; b.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> 선택 문구 기입${n ? ` (${n})` : ''}`; }
function regRender() {
  regStepsRender(); regTagsRender();
  const box = $('reg-rows'), bar = $('reg-bar');
  if (!reg.rows.length) { box.innerHTML = ''; bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  box.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th style="width:28px;"><input type="checkbox" onchange="reg.rows.forEach(r=>r.sel=this.checked);regRender()" ${reg.rows.every(r => r.sel) ? 'checked' : ''} /></th>
      <th style="text-align:left;">파일</th><th style="text-align:left;">상품</th><th style="text-align:left;">URL</th><th>문구</th><th style="text-align:left;">상태</th><th></th></tr></thead>
    <tbody>${reg.rows.map((r, i) => {
      const warn = !r.done && (r.multi || !r.product);
      const opts = r.cands.map(c => `<option value="${c.product_no}" ${r.product && r.product.product_no === c.product_no ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
      return `<tr style="${warn ? 'background:#fffbeb;' : ''}">
        <td><input type="checkbox" ${r.sel ? 'checked' : ''} ${r.done ? 'disabled' : ''} onchange="reg.rows[${i}].sel=this.checked;regSelBtn()" /></td>
        <td style="font-size:.78rem;"><div style="display:flex;gap:8px;align-items:flex-start;">${regFileThumb(r)}<div><span class="reg-fname">${esc(r.fileName || r.file.name)}</span><div style="color:#9ca3af;font-size:.7rem;">${fmtMB(r.file.size)} · ${REG_KIND_TYPE[r.kind]} · ${r.why === 'preset' ? `먼저 고른 상품 (원본 ${esc(r.file.name)})` : `인식한 상품명: <b>${esc(r.core || '-')}</b>`}</div>${r.why === 'preset' && !r.done ? `<div style="margin-top:4px;"><input class="inp" value="${esc(r.tag || '')}" placeholder="소구점 (착용컷·인스타·다나대표)" style="width:200px;font-size:.72rem;padding:3px 8px;background:#fff;" oninput="regRowRename(${i}, this.value)" /></div>` : ''}</div></div></td>
        <td style="min-width:240px;">${r.done ? esc(r.product ? r.product.name : '-') : `
          <select class="inp" style="width:100%;font-size:.78rem;background:#fff;padding:5px 8px;" onchange="regPick(${i}, this.value)">
            <option value="">— 상품 선택 —</option>${opts}</select>
          ${r.multi ? `<div style="font-size:.7rem;color:#b45309;margin-top:3px;"><i class="fa-solid fa-triangle-exclamation"></i> 같은 이름 상품 ${r.cands.length}개 (버전 다름) — 어느 상품인지 골라주세요${r.why === 'alias' ? ' · 지난번 선택을 기본으로 넣었어요' : ''}</div>`
            : !r.product ? `<div style="font-size:.7rem;color:#b45309;margin-top:3px;"><i class="fa-solid fa-triangle-exclamation"></i> 자동 매칭 실패 — ${r.cands.length ? '비슷한 상품을 골라주세요' : '아래에서 검색하세요'}</div>` : ''}
          <input class="inp" list="reg-dl" placeholder="🔍 상품명 검색" style="width:100%;font-size:.74rem;background:#fff;padding:4px 8px;margin-top:4px;" onchange="regSearch(${i}, this.value)" />`}</td>
        <td><input class="inp" value="${esc(r.url)}" style="min-width:220px;font-size:.74rem;background:#fff;padding:5px 8px;" oninput="reg.rows[${i}].url=this.value" ${r.done ? 'disabled' : ''} /></td>
        <td style="text-align:center;white-space:nowrap;"><button class="btn-ghost" style="padding:3px 10px;font-size:.72rem;" onclick="regTextOpen(${i})" ${r.done ? 'disabled' : ''} title="${r.textFrom === 'saved' ? '이 상품에 저장된 문구' : r.textFrom === 'ai' ? 'AI가 방금 생성한 문구' : ''}">${r.text ? `<i class="fa-solid fa-check" style="color:#15803d;"></i> ${r.textFrom === 'saved' ? '저장 문구' : r.textFrom === 'ai' ? 'AI 문구' : '기입됨'}` : '<i class="fa-solid fa-pen"></i> 기입'}</button>${!r.done && r.product && !r.text ? `<button class="btn-ghost" style="padding:3px 8px;font-size:.72rem;margin-left:4px;" onclick="regGen(${i})" title="이 상품 문구를 AI로 생성해 상품에 고정"><i class="fa-solid fa-wand-magic-sparkles" style="color:#7c3aed;"></i> AI</button>` : ''}</td>
        <td style="font-size:.78rem;${/실패/.test(r.status) ? 'color:#dc2626;' : r.done ? 'color:#15803d;font-weight:700;' : ''}">${esc(r.status)}</td>
        <td>${r.done || reg.running ? '' : `<button class="btn-ghost btn-danger-ghost" style="padding:3px 9px;font-size:.7rem;" onclick="regDel('${r.id}')"><i class="fa-solid fa-xmark"></i></button>`}</td></tr>`; }).join('')}</tbody></table></div>`;
  const todo = reg.rows.filter(r => !r.done).length;
  $('reg-run').innerHTML = `<i class="fa-solid fa-check"></i> 등록 (${todo}개)`; $('reg-run').disabled = !todo || reg.running;
  regSelBtn();
}
/* 문구 모달 공용 사용 — 등록 행: idx>=0 / 전체 -1 / 선택 -2 */
function regTextOpen(idx) {
  const targets = idx >= 0 ? [reg.rows[idx]] : idx === -2 ? reg.rows.filter(r => r.sel && !r.done) : reg.rows.filter(r => !r.done);
  if (!targets.length) { toast(idx === -2 ? '파일을 먼저 체크하세요' : '파일이 없어요'); return; }
  const first = targets[0];
  const base = first.text || { message: '', title: '', description: '', link: first.url || '', cta: 'LEARN_MORE' };
  textModalOpen(idx >= 0 ? `광고 문구 — ${first.name}` : `광고 문구 — ${idx === -2 ? '선택한' : '전체'} ${targets.length}개 파일에 적용 (URL은 파일별 상품 URL 유지)`, base, t => {
    for (const r of targets) { r.text = { ...t, link: targets.length > 1 && r.url ? r.url : t.link }; r.textFrom = 'manual'; r.sel = false; }
    regRender(); toast(`${targets.length}개 파일에 문구를 넣었어요`);
    const prods = new Map(); for (const r of targets) if (r.product) prods.set(r.product.product_no, r.product);
    if (targets.length === 1 && prods.size) regCopySave([...prods.values()][0], t);   // 행별 기입은 그 상품에 고정 (여러 파일 일괄은 상품이 섞이므로 고정 안 함)
  }, { linkOptional: targets.length > 1 });
}
function regLog(msg, cls) {
  const box = $('reg-log'); box.style.display = 'block';
  box.insertAdjacentHTML('beforeend', `<div style="${cls === 'ok' ? 'color:#4ade80;' : cls === 'err' ? 'color:#f87171;' : ''}">${new Date().toTimeString().slice(0, 8)} ${cls === 'ok' ? '✓' : cls === 'err' ? '✗' : '→'} ${esc(msg)}</div>`);
  box.scrollTop = box.scrollHeight;
}
async function regRun() {
  if (reg.running) return;
  const todo = reg.rows.filter(r => !r.done);
  if (!todo.length) return;
  const pin = '';   // 등록 PIN 폐지 — 로그인 계정으로 충분
  const noProd = todo.filter(r => !r.product);
  if (noProd.length && !confirm(`상품이 안 정해진 파일 ${noProd.length}개가 있어요. 상품 없이(URL만) 등록할까요?\n취소하면 돌아가서 고를 수 있어요.`)) return;
  const ask = todo.filter(r => r.multi && r.why !== 'manual' && r.why !== 'alias');
  if (ask.length && !confirm(`같은 이름 상품이 여러 개인데 아직 고르지 않은 파일 ${ask.length}개가 있어요. 첫 번째 후보로 등록할까요?`)) return;
  reg.running = true; regRender();
  regLog(`등록 시작 — ${todo.length}개, ${UPL_PARALLEL}개씩 동시 전송`);
  const t0 = Date.now(); let ok = 0, pinFail = false;
  const queue = [...todo];
  const worker = async () => {
    while (queue.length && !pinFail) {
      const r = queue.shift();
      try {
        r.status = r.kind === 'video' ? '영상 전송 0%' : '이미지 업로드 중'; regRender();
        if (!r.media) r.media = await uplUploadMedia({ kind: r.kind, file: r.file, name: r.name, _reg: r }, pin);
        r.status = '기록 저장 중'; regRender();
        const p = r.product || (r.multi ? r.cands[0] : null);
        await uplCall({ action: 'creative_add' }, { file_name: r.fileName || r.file.name, kind: r.kind, core_name: r.core, product_no: p ? p.product_no : null, product_name: p ? p.name : null, url: r.url || null, text: r.text, media: r.media });
        r.done = true; r.status = '등록됨'; ok++; regLog(`${r.fileName || r.file.name}: 등록 완료`, 'ok'); if (p) regRecentPush(p.product_no);
      } catch (e) {
        r.status = '실패: ' + e.message; regLog(`${r.file.name}: ${e.message}`, 'err');
        if (/PIN/.test(e.message)) pinFail = true;
      }
      regRender();
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPL_PARALLEL, queue.length) }, worker));
  reg.running = false; regRender();
  regLog(`끝 — 성공 ${ok} / ${todo.length} · ${Math.round((Date.now() - t0) / 1000)}초`, ok === todo.length ? 'ok' : 'err');
  toast(`소재 등록 ${ok}/${todo.length} 완료${ok < todo.length ? ` · 실패 ${todo.length - ok}개 (아래 로그 확인)` : ''}`);
  reg.aliases = null; regRefresh(true);
  reg.rows = reg.rows.filter(r => !r.done); regRender(); if (typeof uplBadgeRefresh === 'function') uplBadgeRefresh();   // 등록된 파일은 위 목록에서 제거 (아래 '등록된 소재'에 남음) — 실패한 것만 남겨 재시도
  // 끝나면 알림창으로 확실히 알림 (핸드폰에서도 보이게) — 사용자 요청 2026-09-11
  const failed = todo.filter(r => /실패/.test(r.status));
  alert(ok === todo.length
    ? `소재 등록 완료 ✓\n${ok}개 등록됐어요.\n\n광고 업로드 탭에서 바로 쓸 수 있어요.`
    : `소재 등록 ${ok}/${todo.length} 완료\n\n실패 ${failed.length}개:\n${failed.map(r => `· ${r.fileName || r.file.name}\n  ${r.status.replace(/^실패: /, '')}`).join('\n')}\n\n[등록]을 다시 누르면 실패한 것만 다시 시도해요.`);
}
/* 등록된 소재 목록 + 체크보드 반영 */
async function regRefresh(force) {
  if (reg.listLoading) return;
  if (reg.list && !force) { regRenderList(); return; }
  reg.listLoading = true;
  try { reg.list = (await uplCall({ action: 'creatives_list', status: 'all', limit: 500 })).rows; }
  catch (e) { reg.list = reg.list || []; toast('등록 목록 불러오기 실패: ' + e.message); }
  reg.listLoading = false; renderPTest();   // renderPTest가 등록 목록도 그린다
}
function regRenderList() {
  const box = $('reg-list'); if (!box || !reg.list) return;
  const all = reg.list, wait = all.filter(r => r.status === 'registered'), made = all.filter(r => r.status === 'ad_created');
  $('reg-tabs').innerHTML = [['registered', `대기 ${wait.length}`], ['ad_created', `광고 생성됨 ${made.length}`], ['all', `전체 ${all.length}`]].map(([k, l]) => `<button class="filter-tab ${reg.filter === k ? 'active' : ''}" onclick="reg.filter='${k}';regRenderList()">${l}</button>`).join('');
  const rows = reg.filter === 'all' ? all : all.filter(r => r.status === reg.filter);
  if (!rows.length) { box.innerHTML = '<div style="padding:10px;">없음</div>'; return; }
  box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>등록일</th><th style="text-align:left;">파일</th><th style="text-align:left;">상품</th><th>유형</th><th>문구</th><th style="text-align:left;">상태</th><th>등록자</th><th></th></tr></thead><tbody>
    ${rows.slice(0, 200).map(r => `<tr>
      <td style="text-align:center;font-size:.74rem;color:#6b7280;">${(r.created_at || '').slice(5, 10)}</td>
      <td style="font-size:.78rem;"><div style="display:flex;gap:8px;align-items:center;">${mediaThumbHtml(mediaThumbSrc(r.media), r.kind, 40)}<span>${esc(r.file_name)}</span></div></td>
      <td style="font-size:.78rem;" id="reg-prod-${r.id}">${esc(r.product_name || '-')}${safeUrl(r.url) ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener" style="font-size:.7rem;">↗</a>` : ''}${r.status === 'registered' ? ` <button class="btn-ghost" style="padding:1px 7px;font-size:.66rem;margin-left:4px;" title="상품을 잘못 골랐을 때 바꾸기 (URL·파일명도 같이)" onclick="regListProduct('${r.id}')">변경</button>` : ''}</td>
      <td style="text-align:center;font-size:.74rem;">${REG_KIND_TYPE[r.kind] || r.kind}</td>
      <td style="text-align:center;"><button class="btn-ghost" style="padding:2px 8px;font-size:.7rem;" onclick="regListText('${r.id}')">${r.text && r.text.message ? '<i class="fa-solid fa-check" style="color:#15803d;"></i>' : '<i class="fa-solid fa-pen"></i>'}</button></td>
      <td style="font-size:.76rem;">${r.status === 'ad_created' ? `<span class="status-badge badge-green">광고 생성됨</span> <span style="color:#9ca3af;font-size:.68rem;">${(r.ad_created_at || '').slice(5, 10)} · ${esc(r.ad_created_by || '')}</span>` : '<span class="status-badge badge-blue">대기</span>'}</td>
      <td style="text-align:center;font-size:.72rem;color:#6b7280;">${esc((r.created_by_email || '').split('@')[0])}</td>
      <td>${r.status === 'registered' ? `<button class="btn-ghost btn-danger-ghost" data-act="delete" style="padding:2px 8px;font-size:.7rem;${dnrbCan('delete') ? '' : 'display:none;'}" onclick="regListDel('${r.id}')"><i class="fa-solid fa-xmark"></i></button>` : ''}</td></tr>`).join('')}
  </tbody></table></div>`;
}
/* 등록된 소재의 상품 바꾸기 — 셀을 검색창으로 바꾸고, 고르면 상품·URL·(규칙 파일명이면) 파일명까지 저장 */
async function regListProduct(id) {
  const r = reg.list.find(x => x.id === id); if (!r) return;
  try { await regLoadRefs(); } catch (e) { toast('상품 목록 불러오기 실패: ' + e.message); return; }
  const cell = $('reg-prod-' + id); if (!cell) return;
  cell.innerHTML = `<input class="inp" list="reg-dl" placeholder="상품명 검색 후 선택" style="width:100%;font-size:.76rem;padding:4px 8px;background:#fff;" onchange="regListProductPick('${id}', this.value)" autofocus />
    <a href="#" style="font-size:.68rem;color:#6b7280;" onclick="regRenderList();return false;">취소</a>`;
  cell.querySelector('input').focus();
}
async function regListProductPick(id, name) {
  const r = reg.list.find(x => x.id === id), p = (reg.products || []).find(p => p.name === name);
  if (!r || !p) { toast('목록에서 상품을 골라주세요'); return; }
  const patch = { product_no: p.product_no, product_name: p.name, core_name: p.core, url: productUrl(p.product_no) };
  const m = String(r.file_name || '').match(/^(.+?)_(R|P)(\d+)((?:_[^_]+)?)_(\d+)_(\d{6})_test(\.\w+)$/);   // 규칙대로 지은 파일명이면 상품 부분만 갈아끼움
  if (m) patch.file_name = regPresetFileName(p, m[2] === 'R' ? 'video' : 'image', Number(m[3]), m[7].slice(1), `20${m[6].slice(0, 2)}-${m[6].slice(2, 4)}-${m[6].slice(4, 6)}`, m[4].slice(1));
  if (r.text && r.text.link) patch.text = { ...r.text, link: patch.url };
  try {
    const res = await uplCall({ action: 'creative_save' }, { id, ...patch });
    Object.assign(r, res.row); regRenderList(); renderPTest();
    toast(`상품을 '${p.core}'(으)로 바꿨어요${patch.file_name ? ' · 파일명도 갱신' : ''}`);
  } catch (e) { toast('변경 실패: ' + e.message); regRenderList(); }
}
function regListText(id) {
  const r = reg.list.find(x => x.id === id); if (!r) return;
  textModalOpen(`광고 문구 — ${r.file_name}`, r.text || { message: '', title: '', description: '', link: r.url || '', cta: 'LEARN_MORE' }, async t => {
    try {
      const res = await uplCall({ action: 'creative_save' }, { id, text: t, url: t.link, apply_product: true });
      Object.assign(r, res.row);
      if (r.product_no) { for (const o of reg.list) if (o.product_no === r.product_no && o.status === 'registered' && o.id !== id) o.text = { ...t, link: o.url || t.link }; regCopies.delete(r.product_no); }
      regRenderList(); toast(res.applied ? `문구를 저장했어요 — 같은 상품 대기 소재 ${res.applied}개와 상품 고정 문구도 함께` : '문구를 저장했어요');
    }
    catch (e) { toast('저장 실패: ' + e.message); }
  });
}
async function regListDel(id) {
  const name = ((reg.list || []).find(x => x.id === id) || {}).file_name || '';
  if (!confirm(`'${name}' 등록을 삭제할까요? (Meta 보관함의 파일은 남아요)`)) return;
  try { await uplCall({ action: 'creative_del' }, { id }); reg.list = reg.list.filter(x => x.id !== id); renderPTest(); toast('삭제했어요'); }
  catch (e) { toast('삭제 실패: ' + e.message); }
}
/* 체크보드용: 상품번호 → 유형별 {n, run, latest}. 이름만 있는 행은 핵심 이름으로 연결 */
function regBoardIndex() {
  const idx = new Map();
  for (const r of (reg.list || [])) {
    const type = REG_KIND_TYPE[r.kind]; if (!type) continue;
    const keys = [r.product_no ? 'no:' + r.product_no : null, r.core_name ? 'nm:' + normKey(r.core_name) : null].filter(Boolean);
    for (const k of keys) {
      if (!idx.has(k)) idx.set(k, {});
      const cell = idx.get(k)[type] || (idx.get(k)[type] = { n: 0, run: 0, latest: '' });
      cell.n++; if (r.status === 'ad_created') cell.run++;
      const d = (r.ad_created_at || r.created_at || '').slice(0, 10); if (d > cell.latest) cell.latest = d;
    }
  }
  return idx;
}
function regCellFor(idx, p, t) { return (p.product_no && idx.get('no:' + p.product_no) || idx.get('nm:' + normKey(p.name)) || {})[t] || null; }
/* 등록된 소재의 상품이 체크보드에 없으면 행 추가 (마케터 PC에서 등록한 것도 관리자 보드에 보이게) */
function regSyncBoard() {
  if (!reg.list) return;
  let changed = false;
  for (const r of reg.list) {
    if (!r.product_no) continue;
    if (pt.products.some(p => p.product_no === r.product_no)) continue;
    if ((pt.hidden || []).includes(r.product_no)) continue;   // 사용자가 보드에서 지운 상품은 다시 안 올림
    const byName = pt.products.find(p => !p.product_no && normKey(p.name) === normKey(r.product_name || r.core_name || ''));
    if (byName) { byName.product_no = r.product_no; changed = true; continue; }
    const cp = (reg.products || []).find(p => p.product_no === r.product_no);
    pt.products.unshift({ id: newId(), name: r.product_name || r.core_name, product_no: r.product_no, created: cp && cp.created || '', cells: {} }); changed = true;
  }
  if (changed) lsSet(LS.pt, pt);   // 브라우저 사본만 — 등록 기록에서 파생된 행이라 서버 공유본(ptSave→ptPush)을 만들지 않는다 (예시 보드가 공유본이 되던 버그, 2026-09-11)
}
