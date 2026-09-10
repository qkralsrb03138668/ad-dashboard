/* ④-4 광고 업로드 (Meta) — Ads Uploader 대체
   (index.html에서 분리 — 2026-09-08 2단계. 파일 순서는 index.html의 <script> 순서, 전역 함수·변수를 그대로 공유) */
'use strict';

/* ═══════════ ④-4 광고 업로드 (Meta) — Ads Uploader 대체 v1 ═══════════
   사용자 실사용 패턴: 모델 광고(직전 테스트 광고) 선택 → 파일 N개 → 파일당 새 세트(예산만 입력)+광고 1개,
   문구는 직접 기입, 강화옵션·페이지·타겟은 모델 그대로. 미디어는 meta-upload 함수를 거쳐 조각 전송(토큰은 서버에만). */
const upl = { data: null, camp: null, set: null, modelAdId: null, model: null, files: [], commonText: null, running: false };
const UPL_CTA = [['LEARN_MORE','더 알아보기'],['SHOP_NOW','지금 구매하기'],['ORDER_NOW','지금 주문하기'],['BUY_NOW','바로 구매'],['GET_OFFER','혜택 받기'],['SIGN_UP','가입하기'],['CONTACT_US','문의하기'],['NO_BUTTON','버튼 없음']];
let UPL_CHUNK = 8 * 1024 * 1024;     // 8MB 조각 — 서버가 413/네트워크 오류로 거부하면 자동으로 절반씩 줄임 (최소 1MB)
const UPL_PARALLEL = 3;                // 미디어 동시 전송 수 (파일끼리 병렬, 한 영상 안의 조각은 순서대로)

function uplCall(params, payload) { return sbCall('meta-upload', params, payload); }
const uplPin = () => ($('upl-pin').value || '').trim();

function renderUpload() {
  if (!admgrCfg()) { $('upl-model').innerHTML = `<div class="empty-state" style="padding:24px;"><p>config.js에 Supabase 연동 정보를 먼저 채워주세요 (SETUP-광고관리자.md)</p></div>`; return; }
  if (!$('upl-pin').value) $('upl-pin').value = lsGet('adc_admgr_pin', '') || '';
  if (!upl.data) { upl.data = admgr.data; }   // 광고관리자에서 이미 불러왔으면 재사용
  uplRenderModel(); uplRenderFiles(); uplLoadRegistered();
}
/* ② 등록된 소재(대기) 자동 채움 — 파일은 이미 Meta 보관함에 있어 전송 없이 바로 생성 */
async function uplLoadRegistered() {
  try {
    const { rows } = await uplCall({ action: 'creatives_list', status: 'registered', limit: 300 });
    let added = 0;
    for (const r of rows) {
      if (upl.files.some(f => f.creative_id === r.id)) continue;
      upl.files.push({ id: newId(), creative_id: r.id, file: null, kind: r.kind, name: r.file_name.replace(/\.[^.]+$/, ''), product_name: r.product_name || '', product_no: r.product_no || null, url: r.url || '',
        text: r.text && r.text.message ? { ...r.text, link: r.text.link || r.url } : null, status: '등록됨 (전송 불필요)', media: r.media, result: null, sel: false, registered_at: r.created_at });
      added++;
    }
    // 문구 없는 등록 소재 → 상품 고정 문구가 있으면 채움
    const need = upl.files.filter(f => f.creative_id && !f.text && f.product_no);
    if (need.length) {
      try {
        const { rows: copies } = await perfApi({ action: 'copy_get', product_nos: [...new Set(need.map(f => f.product_no))].join(',') });
        for (const f of need) { const c = copies.find(c => c.product_no === f.product_no); if (c) f.text = { message: c.text.message || '', title: c.text.title || '', description: c.text.description || '', link: f.url, cta: c.text.cta || 'LEARN_MORE' }; }
      } catch (e) { /* 없으면 그대로 */ }
    }
    if (added) { uplRenderFiles(); toast(`등록된 소재 ${added}개를 불러왔어요`); }
  } catch (e) { /* 미배포·권한 없음 등은 조용히 */ }
}
async function uplLoad() {
  $('upl-model').innerHTML = '<div style="padding:16px;color:#6b7280;">Meta 광고 목록 불러오는 중…</div>';
  try { upl.data = await metaGet({ action: 'hierarchy', preset: 'last_7d' }); }
  catch (e) { toast('불러오기 실패: ' + e.message); upl.data = null; }
  uplRenderModel();
}
const byCreatedDesc = (a, b) => String(b.created || '').localeCompare(String(a.created || ''));
function uplRenderModel() {
  const box = $('upl-model');
  if (!upl.data) { box.innerHTML = `<button class="btn-analyze" onclick="uplLoad()"><i class="fa-solid fa-rotate"></i> Meta 광고 목록 불러오기</button>`; return; }
  const camps = [...upl.data.campaigns].sort(byCreatedDesc);
  const camp = camps.find(c => c.id === upl.camp) || null;
  const sets = camp ? [...camp.adsets].sort(byCreatedDesc) : [];
  const set = sets.find(s => s.id === upl.set) || null;
  const ads = set ? [...set.ads].sort(byCreatedDesc) : [];
  const col = (title, rows, sel, fn) => `<div style="border:1px solid #e7e8ee;border-radius:10px;overflow:hidden;min-width:0;">
    <div style="background:#f8fafc;padding:6px 10px;font-size:.72rem;font-weight:700;color:#475569;">${title} (${rows.length})</div>
    <div style="max-height:220px;overflow:auto;">${rows.map(r => `<div onclick="${fn}('${r.id}')" style="padding:6px 10px;font-size:.78rem;cursor:pointer;border-bottom:1px solid #f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${r.id===sel?'background:#eef2ff;color:#3730a3;font-weight:700;':''}" title="${esc(r.name)}">
      <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${r.status==='ACTIVE'?'#16a34a':'#cbd5e1'};margin-right:6px;"></span>${esc(r.name)}</div>`).join('') || '<div style="padding:14px;color:#9ca3af;font-size:.76rem;">왼쪽에서 선택</div>'}</div></div>`;
  const m = upl.model, s = m && m.summary;
  box.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
      ${col('캠페인', camps, upl.camp, 'uplPickCamp')}${col('광고세트', sets, upl.set, 'uplPickSet')}${col('광고', ads, upl.modelAdId, 'uplPickAd')}
    </div>
    <div style="margin-top:6px;text-align:right;"><button class="btn-ghost" style="padding:3px 10px;font-size:.72rem;" onclick="uplLoad()"><i class="fa-solid fa-rotate"></i> 목록 새로고침</button></div>
    ${m ? `<div style="margin-top:8px;background:#f8fafc;border:1px solid #e7e8ee;border-radius:10px;padding:12px 14px;font-size:.8rem;line-height:1.8;">
      <div><b style="color:#1e1b4b;">모델:</b> ${esc(m.campaign.name)} › ${esc(m.adset.name)} › ${esc(m.ad.name)}</div>
      <div style="color:#475569;">최적화 <b>${esc(s.optimization_goal||'-')}</b> · 입찰 ${esc(s.bid_strategy||'-')} · 타겟 ${esc((s.countries||[]).join(',')||'-')} ${esc(s.age)} ${s.genders&&s.genders.length?(s.genders[0]===1?'남':'여'):'전체'}
        · ${m.cbo ? `<span style="color:#b45309;">캠페인 예산(CBO) ${s.campaign_daily_budget.toLocaleString()}원 — 세트 예산 입력 불필요</span>` : `세트 일예산 ${s.daily_budget.toLocaleString()}원`}
        · 소재 ${m.creative.kind === 'video' ? '영상' : m.creative.kind === 'image' ? '이미지' : '기타'}${m.creative.dynamic ? ' <span style="color:#dc2626;">(다이나믹/플렉시블 소재 — 문구 복사가 불완전할 수 있어요)</span>' : ''}</div>
      <div style="color:#475569;">문구: ${esc((m.text.message||'').slice(0,80))}${(m.text.message||'').length>80?'…':''} · URL ${esc((m.text.link||'').slice(0,60))}</div>
    </div>` : upl.modelAdId ? '<div style="padding:10px;color:#6b7280;font-size:.8rem;">모델 광고 설정 읽는 중…</div>' : ''}`;
}
function uplPickCamp(id) { upl.camp = id; upl.set = null; uplRenderModel(); }
function uplPickSet(id) { upl.set = id; uplRenderModel(); }
async function uplPickAd(id) {
  upl.modelAdId = id; upl.model = null; uplRenderModel();
  try {
    upl.model = await uplCall({ action: 'model', ad_id: id });
    if (!$('upl-budget').value && !upl.model.cbo) $('upl-budget').value = upl.model.summary.daily_budget || '';
  } catch (e) { toast('모델 광고 읽기 실패: ' + e.message); upl.modelAdId = null; }
  uplRenderModel(); uplRenderFiles();
}

/* ── 파일 ── */
function uplAddFiles(list) {
  for (const f of list) {
    const isVideo = /^video\//.test(f.type) || /\.(mp4|mov|m4v)$/i.test(f.name);
    const isImage = /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);
    if (!isVideo && !isImage) { toast(`${f.name}: 지원하지 않는 형식`); continue; }
    if (isImage && f.size > 30 * 1024 * 1024) { toast(`${f.name}: 이미지는 30MB까지`); continue; }
    /* normalize('NFC'): 맥 파일명은 한글 자모 분리형(NFD) — 그대로 세트·광고명에 쓰면 Meta 검색·상품 매칭이 안 된다 (2026-09-07) */
    upl.files.push({ id: newId(), file: f, kind: isVideo ? 'video' : 'image', name: f.name.replace(/\.[^.]+$/, '').normalize('NFC'), text: null, status: '대기', media: null, result: null, sel: false });
  }
  uplRenderFiles();
}
function uplDelFile(id) { upl.files = upl.files.filter(f => f.id !== id); uplRenderFiles(); }
const fmtMB = n => (n / 1048576).toFixed(1) + ' MB';
function uplRenderFiles() {
  const box = $('upl-files');
  if (!upl.files.length) { box.innerHTML = ''; $('upl-run').textContent = ' 광고 생성'; uplSelBtn(); return; }
  box.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th style="width:28px;"><input type="checkbox" title="전체 선택" ${upl.files.length && upl.files.every(f => f.sel) ? 'checked' : ''} onchange="uplSelAll(this.checked)" /></th><th style="text-align:left;">파일</th><th style="text-align:left;">세트명 · 광고명</th><th>문구</th><th style="text-align:left;">상태</th><th></th></tr></thead>
    <tbody>${upl.files.map((f, i) => `<tr>
      <td><input type="checkbox" ${f.sel ? 'checked' : ''} onchange="upl.files[${i}].sel=this.checked;uplSelBtn()" /></td>
      <td style="font-size:.78rem;"><i class="fa-solid ${f.kind==='video'?'fa-video':'fa-image'}" style="color:#4f46e5;"></i> ${esc(f.file ? f.file.name : f.name)}<div style="color:#9ca3af;font-size:.7rem;">${f.file ? fmtMB(f.file.size) : `<i class="fa-solid fa-cloud" style="color:#4f46e5;"></i> 등록 소재${f.product_name ? ' · ' + esc(f.product_name) : ''}${f.registered_at ? ' · ' + f.registered_at.slice(5, 10) : ''}`}</div></td>
      <td><input class="inp" value="${esc(f.name)}" style="min-width:260px;background:#fff;font-size:.8rem;" oninput="upl.files[${i}].name=this.value" ${upl.running?'disabled':''} /></td>
      <td style="text-align:center;"><button class="btn-ghost" style="padding:3px 10px;font-size:.72rem;" onclick="uplTextOpen(${i})">${f.text ? '<i class="fa-solid fa-check" style="color:#15803d;"></i> 기입됨' : upl.commonText ? '<i class="fa-solid fa-check" style="color:#6b7280;"></i> 일괄' : '<i class="fa-solid fa-pen"></i> 기입'}</button></td>
      <td style="font-size:.78rem;${/실패/.test(f.status)?'color:#dc2626;':/완료/.test(f.status)?'color:#15803d;font-weight:700;':''}">${esc(f.status)}${f.result ? ` <a href="https://adsmanager.facebook.com/adsmanager/manage/ads?act=${(upl.model&&upl.model.account||'').replace('act_','')}&selected_ad_ids=${f.result.ad_id}" target="_blank" style="font-size:.7rem;">열기</a>` : ''}</td>
      <td>${upl.running ? '' : `<button class="btn-ghost btn-danger-ghost" style="padding:3px 9px;font-size:.7rem;" onclick="uplDelFile('${f.id}')"><i class="fa-solid fa-xmark"></i></button>`}</td>
    </tr>`).join('')}</tbody></table></div>`;
  $('upl-run').innerHTML = `<i class="fa-solid fa-rocket"></i> 광고 생성 (${upl.files.length}개)`;
  uplSelBtn();
}
function uplSelAll(on) { for (const f of upl.files) f.sel = on; uplRenderFiles(); }
function uplSelBtn() {
  const n = upl.files.filter(f => f.sel).length, b = $('upl-text-sel');
  b.disabled = !n; b.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> 선택 파일 문구 기입${n ? ` (${n})` : ''}`;
}

/* ── 문구 모달: idx=-1 → 전체 일괄, 아니면 해당 행 ── */
let uplTextIdx = -1;
/* 공용 문구 모달: title, 초기값, 적용 콜백. opts.linkOptional → 여러 파일에 적용할 때 URL 비워도 됨(파일별 URL 유지) */
const TEXT_MODAL = { onApply: null, linkOptional: false };
function textModalOpen(title, base, onApply, opts) {
  TEXT_MODAL.onApply = onApply; TEXT_MODAL.linkOptional = !!(opts && opts.linkOptional);
  $('upl-text-title').textContent = title;
  $('ut-cta').innerHTML = UPL_CTA.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  uplTextFill(base);
  $('upl-text-modal').classList.add('show'); $('ut-message').focus();
}
function uplTextOpen(idx) {
  uplTextIdx = idx;
  const selected = upl.files.filter(f => f.sel);
  if (idx === -2 && !selected.length) { toast('파일을 먼저 체크하세요'); return; }
  const f0 = idx >= 0 ? upl.files[idx] : idx === -2 ? selected[0] : null;
  const fallback = upl.commonText || (upl.model && upl.model.text) || { message: '', title: '', description: '', link: '', cta: 'LEARN_MORE' };
  const base = (f0 && f0.text) || (f0 && f0.url ? { ...fallback, link: f0.url } : fallback);   // 등록 소재는 상품 URL을 기본으로
  const title = idx >= 0 ? `광고 문구 — ${upl.files[idx].name}` : idx === -2 ? `광고 문구 — 선택한 ${selected.length}개 파일에 적용` : '광고 문구 일괄 기입 (모든 파일에 적용 · 등록 소재는 상품 URL 유지)';
  textModalOpen(title, base, t => {
    let n = 0;
    if (uplTextIdx >= 0) upl.files[uplTextIdx].text = t;
    else if (uplTextIdx === -2) { for (const f of upl.files) if (f.sel) { f.text = { ...t, link: f.url || t.link }; f.sel = false; n++; } }
    else { upl.commonText = t; for (const f of upl.files) f.text = null; }
    uplRenderFiles();
    toast(uplTextIdx >= 0 ? '이 파일의 문구를 저장했어요' : uplTextIdx === -2 ? `선택한 ${n}개 파일에 문구를 적용했어요` : '모든 파일에 문구를 적용했어요');
  }, { linkOptional: idx < 0 });
}
function uplTextFill(t) { $('ut-message').value = t.message || ''; $('ut-title').value = t.title || ''; $('ut-description').value = t.description || ''; $('ut-link').value = t.link || ''; $('ut-cta').value = t.cta || 'LEARN_MORE'; }
function uplTextReset() { if (!upl.model) { toast('모델 광고를 먼저 선택하세요 (광고 업로드 탭)'); return; } const link = $('ut-link').value; uplTextFill({ ...upl.model.text, link: link || upl.model.text.link }); }
function uplTextApply() {
  const t = { message: $('ut-message').value.trim(), title: $('ut-title').value.trim(), description: $('ut-description').value.trim(), link: $('ut-link').value.trim(), cta: $('ut-cta').value };
  if (t.link && !/^https?:\/\//.test(t.link)) { toast('웹사이트 URL은 http(s)://로 시작해야 해요'); return; }
  if (!t.link && !TEXT_MODAL.linkOptional) { toast('웹사이트 URL을 입력하세요'); return; }
  if (!t.message) { toast('본문을 입력하세요'); return; }
  closeModal('upl-text-modal');
  if (TEXT_MODAL.onApply) TEXT_MODAL.onApply(t);
}

/* ── 진단: 쓰기 토큰의 페이지 권한 + validate_only (생성 없음) ── */
async function uplDiagnose() {
  if (!upl.modelAdId) { toast('① 모델 광고를 먼저 선택하세요'); return; }
  uplLog('연결 진단 시작 (실제 생성 없음)');
  try {
    const d = await uplCall({ action: 'diagnose', ad_id: upl.modelAdId });
    uplLog(`쓰기 토큰 사용자: ${d.me && d.me.name ? d.me.name : d.me} · 권한: ${Array.isArray(d.permissions) ? d.permissions.join(', ') : d.permissions}`);
    if (d.app) uplLog(`토큰 발급 앱: ${d.app.name ? `${d.app.name} (ID ${d.app.id})` : d.app} — 크리에이티브 생성에는 이 앱이 '라이브(공개) 모드'여야 해요`);
    const pageOk = d.page && d.page.id;
    uplLog(pageOk ? `페이지 접근 OK: ${d.page.name}` : `페이지 접근 불가 — 비즈니스 설정에서 시스템 사용자에게 페이지 자산을 추가하고 토큰을 재발급하세요 (SETUP-광고업로드.md)`, pageOk ? 'ok' : 'err');
    if (d.instagram) uplLog(d.instagram.username ? `인스타그램 접근 OK: @${d.instagram.username}` : `인스타그램 접근 불가: ${d.instagram}`, d.instagram.username ? 'ok' : 'err');
    const v = await uplCall({ action: 'validate', ad_id: upl.modelAdId });
    for (const k of ['adset', 'creative', 'ad']) uplLog(`${{ adset: '광고세트', creative: '크리에이티브', ad: '광고' }[k]} 생성 검증: ${v[k]}`, v[k] === 'ok' ? 'ok' : 'err');
    const all = ['adset', 'creative', 'ad'].every(k => v[k] === 'ok');
    uplLog(all ? '진단 통과 — 광고 생성 가능' : '진단 실패 항목이 있어요 — 위 메시지를 확인하세요', all ? 'ok' : 'err');
  } catch (e) { uplLog('진단 실패: ' + e.message, 'err'); }
}

/* ── 실행 ── */
function uplLog(msg, cls) {
  const box = $('upl-log'); box.style.display = 'block';
  const t = new Date().toTimeString().slice(0, 8);
  box.insertAdjacentHTML('beforeend', `<div style="${cls==='ok'?'color:#4ade80;':cls==='err'?'color:#f87171;':''}">${t} ${cls==='ok'?'✓':cls==='err'?'✗':'→'} ${esc(msg)}</div>`);
  box.scrollTop = box.scrollHeight;
}
function uplSetStatus(f, s) { f.status = s; uplRenderFiles(); }
async function uplUploadMedia(f, pin) {
  if (f.kind === 'image') {
    const fd = new FormData(); fd.append('pin', pin); fd.append('file', f.file, f.file.name);
    const r = await uplCall({ action: 'image' }, fd);
    return { type: 'image', image_hash: r.image_hash };
  }
  const size = f.file.size;
  const st = await uplCall({ action: 'video_start' }, { pin, file_size: size });
  let start = st.start_offset, end = st.end_offset;
  while (start < size) {
    const to = Math.min(end, start + UPL_CHUNK, size);
    const fd = new FormData(); fd.append('pin', pin); fd.append('session_id', st.session_id); fd.append('start_offset', String(start));
    fd.append('chunk', f.file.slice(start, to), 'chunk');
    let r;
    try { r = await uplCall({ action: 'video_chunk' }, fd); }
    catch (e) {
      if (/PIN/.test(e.message) || UPL_CHUNK <= 1024 * 1024) throw e;
      UPL_CHUNK = Math.floor(UPL_CHUNK / 2);   // 요청 크기 한도로 보이면 조각을 줄여 같은 위치부터 재시도
      uplLog(`${f.name}: 조각 전송 실패(${e.message.slice(0, 60)}) → ${fmtMB(UPL_CHUNK)} 조각으로 재시도`);
      continue;
    }
    start = r.start_offset; end = r.end_offset;
    uplSetStatus(f, `영상 전송 ${Math.round(start / size * 100)}%`);
  }
  await uplCall({ action: 'video_finish' }, { pin, session_id: st.session_id, title: f.name });
  uplSetStatus(f, 'Meta 영상 처리 대기…');
  for (let i = 0; i < 100; i++) {   // 최대 5분
    await new Promise(r => setTimeout(r, 3000));
    const v = await uplCall({ action: 'video_status', video_id: st.video_id });
    if (v.video_status === 'error') throw new Error('Meta 영상 처리 실패');
    if (v.ready && v.thumbnail_url) return { type: 'video', video_id: st.video_id, thumbnail_url: v.thumbnail_url };
    uplSetStatus(f, `Meta 영상 처리 중 ${v.progress != null ? v.progress + '%' : ''}`);
  }
  throw new Error('영상 처리 시간 초과 (5분)');
}
async function uplRun() {
  if (upl.running) return;
  if (!upl.model) { toast('① 모델 광고를 먼저 선택하세요'); return; }
  if (!upl.files.length) { toast('② 파일을 추가하세요'); return; }
  const pin = uplPin(); if (!pin) { toast('PIN을 입력하세요'); $('upl-pin').focus(); return; }
  const budget = Number($('upl-budget').value || 0);
  if (!upl.model.cbo && (budget < 1000 || budget > 300000)) { toast('세트당 일예산은 1,000~300,000원'); $('upl-budget').focus(); return; }
  const mode = document.querySelector('input[name=upl-mode]:checked').value;
  const effText = f => f.text || (upl.commonText ? { ...upl.commonText, link: f.url || upl.commonText.link } : null);
  const missing = upl.files.filter(f => !effText(f));
  if (missing.length) { toast(`문구가 없는 파일 ${missing.length}개 — 기입하거나 일괄 기입하세요`); return; }
  const dup = upl.files.filter(f => !f.name.trim()); if (dup.length) { toast('이름이 빈 파일이 있어요'); return; }
  const pending = upl.files.filter(f => !f.result);
  if (!pending.length) { toast('모두 생성 완료됐어요'); return; }
  if (!confirm(`광고 ${pending.length}개를 ${mode === 'ACTIVE' ? '⚠ 바로 활성 상태로' : '세트 일시중지(광고는 활성) 상태로'} 생성할까요?\n캠페인: ${upl.model.campaign.name}\n${upl.model.cbo ? '캠페인 예산(CBO)' : `세트당 일예산 ${budget.toLocaleString()}원`}\n\n${mode === 'ACTIVE' ? '활성 생성은 즉시 지출이 시작돼요.' : '광고관리자에서 세트를 켜기 전까지 지출 없음.'}`)) return;

  upl.running = true; $('upl-run').disabled = true; uplRenderFiles();
  lsSet('adc_admgr_pin', pin);
  uplLog(`시작 — ${pending.length}개, ${mode}, 모델 ${upl.model.ad.name} · 미디어 ${UPL_PARALLEL}개씩 동시 전송`);
  const t0 = Date.now();
  // 1단계: 미디어 병렬 업로드 (이미 올라간 파일은 건너뜀 — 재시도 시 재전송 없음)
  let pinFail = false;
  const queue = pending.filter(f => !f.media);
  const worker = async () => {
    while (queue.length && !pinFail) {
      const f = queue.shift();
      try {
        uplSetStatus(f, f.kind === 'video' ? '영상 전송 0%' : '이미지 업로드 중');
        f.media = await uplUploadMedia(f, pin);
        uplSetStatus(f, '미디어 준비됨'); uplLog(`${f.name}: 미디어 업로드 완료`);
      } catch (e) {
        uplSetStatus(f, '실패: ' + e.message); uplLog(`${f.name}: ${e.message}`, 'err');
        if (/PIN/.test(e.message)) pinFail = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPL_PARALLEL, queue.length) }, worker));
  uplLog(`미디어 전송 끝 — ${Math.round((Date.now() - t0) / 1000)}초`);
  // 2단계: 세트·광고 순차 생성
  let ok = 0;
  for (const f of pending) {
    if (!f.media || pinFail) continue;
    try {
      uplSetStatus(f, '세트·광고 생성 중');
      const r = await uplCall({ action: 'create' }, { pin, model_ad_id: upl.modelAdId, name: f.name.trim(), budget, status: mode, media: f.media, text: effText(f), creative_id: f.creative_id || null });
      f.result = r; ok++;
      uplSetStatus(f, `완료 (세트 ${r.adset_id} · 광고 ${r.ad_id})`);
      uplLog(`${f.name}: 광고 생성 완료 → ${r.ad_id}`, 'ok');
    } catch (e) {
      uplSetStatus(f, '실패: ' + e.message);
      uplLog(`${f.name}: ${e.message}`, 'err');
      if (/PIN/.test(e.message)) { uplLog('PIN 오류 — 중단', 'err'); break; }
    }
  }
  upl.running = false; $('upl-run').disabled = false; uplRenderFiles();
  uplLog(`끝 — 성공 ${ok} / ${pending.length} · 총 ${Math.round((Date.now() - t0) / 1000)}초`, ok === pending.length ? 'ok' : 'err');
  if (ok) reg.list = null;   // 체크보드·등록 목록은 다음 렌더에서 다시 읽음
  toast(`광고 생성 ${ok}/${pending.length} 완료${ok < pending.length ? ` · 실패 ${pending.length - ok}개 (아래 로그 확인)` : ''}`);
}
