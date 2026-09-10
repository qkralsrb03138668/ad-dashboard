/* ④-2b 소재 등록 (파일 → 카페24 상품 매칭 → Meta 보관함)
   (index.html에서 분리 — 2026-09-08 2단계. 파일 순서는 index.html의 <script> 순서, 전역 함수·변수를 그대로 공유) */
'use strict';

/* ═══════════ ④-2b 소재 등록 (광고소재 대시보드 안) ═══════════
   파일명 → 핵심 상품명(괄호 묶음 제거) → 카페24 상품 매칭(정확히 1개면 자동, 여러 개면 선택, 없으면 후보) →
   URL 자동 → 문구(선택) → 파일은 Meta 보관함(meta-upload image/video_*)으로, 메타데이터는 creatives 표로.
   체크보드는 creatives를 읽어 스토리(이미지)·릴스(영상) 칸을 자동 채운다. */
const reg = { products: null, aliases: null, rows: [], list: null, listLoading: false, filter: 'registered', running: false };
const SHOP_URL = (window.DASH_CFG && window.DASH_CFG.SHOP_URL) || 'https://danarobe.com';
const REG_KIND_TYPE = { image: '스토리', video: '릴스' };
// 맥 파일명은 한글이 자모 분리(NFD)로 들어와 카페24 상품명(NFC)과 문자열이 달라진다 → 항상 NFC로 맞춘 뒤 비교 (실사고 2026-09-10)
function coreName(n) { let s = String(n || '').normalize('NFC').replace(/[（）]/g, m => m === '（' ? '(' : ')'); for (let i = 0; i < 6; i++) s = s.replace(/\([^()]*\)|\[[^\[\]]*\]/g, ' '); return s.replace(/\s+/g, ' ').trim(); }
function fileCore(fileName) { let n = String(fileName).normalize('NFC').replace(/\.[^.]+$/, ''); n = n.split('_')[0]; n = n.replace(/\s+\d{6}\b.*$/, ''); return coreName(n); }
const normKey = s => coreName(s).toLowerCase().replace(/\s+/g, '');
const productUrl = no => `${SHOP_URL}/product/detail.html?product_no=${no}`;

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
  try { await regLoadRefs(); } catch (e) { toast('상품 목록 불러오기 실패: ' + e.message); return; }
  for (const f of list) {
    const isVideo = /^video\//.test(f.type) || /\.(mp4|mov|m4v)$/i.test(f.name);
    const isImage = /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);
    if (!isVideo && !isImage) { toast(`${f.name}: 지원하지 않는 형식`); continue; }
    if (isImage && f.size > 30 * 1024 * 1024) { toast(`${f.name}: 이미지는 30MB까지`); continue; }
    if (reg.rows.some(r => r.file.name === f.name && r.file.size === f.size)) continue;
    const m = regMatch(f.name);
    reg.rows.push({ id: newId(), file: f, kind: isVideo ? 'video' : 'image', name: f.name.replace(/\.[^.]+$/, ''), core: m.core, cands: m.cands, product: m.pick, why: m.why, multi: m.multi,
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
        <td style="font-size:.78rem;"><i class="fa-solid ${r.kind === 'video' ? 'fa-video' : 'fa-image'}" style="color:#4f46e5;"></i> ${esc(r.file.name)}<div style="color:#9ca3af;font-size:.7rem;">${fmtMB(r.file.size)} · ${REG_KIND_TYPE[r.kind]} · 인식한 상품명: <b>${esc(r.core || '-')}</b></div></td>
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
  const pin = ($('reg-pin').value || '').trim(); if (!pin) { toast('등록 PIN을 입력하세요'); $('reg-pin').focus(); return; }
  const noProd = todo.filter(r => !r.product);
  if (noProd.length && !confirm(`상품이 안 정해진 파일 ${noProd.length}개가 있어요. 상품 없이(URL만) 등록할까요?\n취소하면 돌아가서 고를 수 있어요.`)) return;
  const ask = todo.filter(r => r.multi && r.why !== 'manual' && r.why !== 'alias');
  if (ask.length && !confirm(`같은 이름 상품이 여러 개인데 아직 고르지 않은 파일 ${ask.length}개가 있어요. 첫 번째 후보로 등록할까요?`)) return;
  reg.running = true; regRender(); lsSet('adc_reg_pin', pin);
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
        await uplCall({ action: 'creative_add' }, { file_name: r.file.name, kind: r.kind, core_name: r.core, product_no: p ? p.product_no : null, product_name: p ? p.name : null, url: r.url || null, text: r.text, media: r.media });
        r.done = true; r.status = '등록됨'; ok++; regLog(`${r.file.name}: 등록 완료`, 'ok');
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
      <td style="font-size:.78rem;">${esc(r.file_name)}</td>
      <td style="font-size:.78rem;">${esc(r.product_name || '-')}${safeUrl(r.url) ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener" style="font-size:.7rem;">↗</a>` : ''}</td>
      <td style="text-align:center;font-size:.74rem;">${REG_KIND_TYPE[r.kind] || r.kind}</td>
      <td style="text-align:center;"><button class="btn-ghost" style="padding:2px 8px;font-size:.7rem;" onclick="regListText('${r.id}')">${r.text && r.text.message ? '<i class="fa-solid fa-check" style="color:#15803d;"></i>' : '<i class="fa-solid fa-pen"></i>'}</button></td>
      <td style="font-size:.76rem;">${r.status === 'ad_created' ? `<span class="status-badge badge-green">광고 생성됨</span> <span style="color:#9ca3af;font-size:.68rem;">${(r.ad_created_at || '').slice(5, 10)} · ${esc(r.ad_created_by || '')}</span>` : '<span class="status-badge badge-blue">대기</span>'}</td>
      <td style="text-align:center;font-size:.72rem;color:#6b7280;">${esc((r.created_by_email || '').split('@')[0])}</td>
      <td>${r.status === 'registered' ? `<button class="btn-ghost btn-danger-ghost" style="padding:2px 8px;font-size:.7rem;" onclick="regListDel('${r.id}')"><i class="fa-solid fa-xmark"></i></button>` : ''}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function regListText(id) {
  const r = reg.list.find(x => x.id === id); if (!r) return;
  textModalOpen(`광고 문구 — ${r.file_name}`, r.text || { message: '', title: '', description: '', link: r.url || '', cta: 'LEARN_MORE' }, async t => {
    try { const res = await uplCall({ action: 'creative_save' }, { id, text: t, url: t.link }); Object.assign(r, res.row); regRenderList(); toast('문구를 저장했어요'); if (r.product_no) regCopySave({ product_no: r.product_no, name: r.product_name }, t); }
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
    const byName = pt.products.find(p => !p.product_no && normKey(p.name) === normKey(r.product_name || r.core_name || ''));
    if (byName) { byName.product_no = r.product_no; changed = true; continue; }
    const cp = (reg.products || []).find(p => p.product_no === r.product_no);
    pt.products.unshift({ id: newId(), name: r.product_name || r.core_name, product_no: r.product_no, created: cp && cp.created || '', cells: {} }); changed = true;
  }
  if (changed) ptSave();
}
