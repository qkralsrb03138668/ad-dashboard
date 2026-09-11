/* 로그인 (Supabase Auth + profiles 역할)·사용자 관리
   (index.html에서 분리 — 2026-09-08 2단계. 파일 순서는 index.html의 <script> 순서, 전역 함수·변수를 그대로 공유) */
'use strict';

/* ═══════════ ⓪ 로그인 (Supabase Auth + profiles 역할) ═══════════
   세션이 없으면 #login-gate로 앱을 가린다. 서버 함수는 사용자 토큰(Authorization)으로 역할을 확인.
   로컬 config.js에 DASH_KEY가 있으면 로그인 없이도 관리자로 동작(기존 방식 유지). */
const AUTH = { sb: null, session: null, me: null, mode: 'login' };
/* DNRB 워크스페이스 SSO (2026-09-11, 친구 가이드 docs/… 참고): 워크스페이스 메뉴에서 #sso=코드로 넘어오면 60초 일회용 코드를
   ad-dashboard 전용 7일 토큰과 바꿔 저장하고 자체 로그인을 건너뛴다. 권한은 워크스페이스 서버(verify)가 매 요청 강제. */
const DNRB_AUTH_URL = 'https://eeffmbusaqaadeojjlnc.supabase.co/functions/v1/auth';
const DNRB_KEY = 'dnrb_sso';
// 워크스페이스 공개 anon 키(공개 레포 danarobe/dnrb-dashboard config.js) — 게이트웨이 통과용일 뿐, 권한은 토큰이 결정
const DNRB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZmZtYnVzYXFhYWRlb2pqbG5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3NDExOTIsImV4cCI6MjEwMDMxNzE5Mn0.P5Zxh1qrxpNU-SM_dpNz58xT6OWVk5Fq8l0c4WuuF2w';
async function dnrbApi(body) {
  const r = await fetch(DNRB_AUTH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: DNRB_ANON, Authorization: 'Bearer ' + DNRB_ANON }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) { const e = new Error(d.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
  return d;
}
function dnrbSession() {
  try { const s = JSON.parse(localStorage.getItem(DNRB_KEY)); return s && s.token && s.exp > Date.now() ? s : null; } catch { return null; }
}
async function dnrbInit() {
  const m = location.hash.match(/[#&]sso=([A-Za-z0-9_-]{20,80})/);
  if (m) {
    history.replaceState(null, '', location.pathname + location.search);   // 코드는 주소에서 바로 지움 (일회용)
    try { const d = await dnrbApi({ action: 'sso_redeem', code: m[1] }); localStorage.setItem(DNRB_KEY, JSON.stringify(d)); }
    catch (e) { toast('워크스페이스 자동 로그인 실패: ' + e.message); }
  }
  let s = dnrbSession();
  if (!s) return false;
  try { const v = await dnrbApi({ action: 'verify', token: s.token }); s = { ...s, ...v, token: s.token }; localStorage.setItem(DNRB_KEY, JSON.stringify(s)); }   // 권한(perms)은 관리자가 바꾸는 즉시 → 진입마다 새로 받음
  catch (e) { if (e.status === 401 || e.status === 403) { localStorage.removeItem(DNRB_KEY); toast('워크스페이스 권한이 없어요: ' + e.message); return false; } }   // 네트워크 오류면 저장본으로 진행
  AUTH.me = { email: s.id, name: s.name, role: s.role === 'admin' ? 'admin' : 'marketer', dnrb: true };   // 워크스페이스 관리자만 관리자
  $('login-gate').style.display = 'none'; authApplyRole();
  return true;
}
function authApi(params, payload) { return sbCall('auth-admin', params, payload); }
async function authInit() {
  const cfg = admgrCfg();
  if (!cfg || !window.supabase) return;                       // 연동 정보 없음 → 데모 모드 그대로
  AUTH.sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  if (await dnrbInit()) return;
  const { data } = await AUTH.sb.auth.getSession(); AUTH.session = data.session;
  AUTH.sb.auth.onAuthStateChange((_e, s) => { AUTH.session = s; });
  if (cfg.DASH_KEY && !AUTH.session) {   // 로컬 파일: 접근키가 곧 관리자. 단 계정이 하나도 없으면 최초 관리자 만들기를 먼저 안내
    AUTH.me = { email: '접근키', name: '로컬', role: 'admin' }; authApplyRole();
    let boot = false; try { boot = (await authApi({ action: 'status' })).needs_bootstrap; } catch (e) { /* 무시 */ }
    if (boot) { await authGate(); $('lg-skip').style.display = 'block'; }
    return;
  }
  if (!AUTH.session) { await authGate(); return; }
  await authLoadMe();
}
async function authLoadMe() {
  try { AUTH.me = await authApi({ action: 'me' }); }
  catch (e) { AUTH.me = null; }
  if (!AUTH.me || !AUTH.me.role) {
    await AUTH.sb.auth.signOut(); AUTH.session = null;
    await authGate('이 계정은 대시보드 권한이 없어요. 관리자에게 등록을 요청하세요.'); return;
  }
  $('login-gate').style.display = 'none'; authApplyRole();
}
async function authGate(msg) {
  let boot = false;
  try { boot = (await authApi({ action: 'status' })).needs_bootstrap; } catch (e) { /* 서버 미배포 등 — 로그인 화면으로 */ }
  AUTH.mode = (boot && admgrCfg().DASH_KEY) ? 'bootstrap' : 'login';
  $('lg-name-wrap').style.display = AUTH.mode === 'bootstrap' ? 'block' : 'none';
  $('lg-sub').textContent = AUTH.mode === 'bootstrap' ? '아직 계정이 없어요 — 최초 관리자 계정을 만드세요' : '계정으로 로그인하세요';
  $('lg-btn').textContent = AUTH.mode === 'bootstrap' ? '관리자 계정 만들기' : '로그인';
  $('lg-note').textContent = AUTH.mode === 'bootstrap' ? '이 이메일·비밀번호로 앞으로 로그인해요. 다른 사람 계정은 로그인 후 데이터 관리 › 사용자 관리에서 만듭니다.'
    : (boot ? '아직 관리자 계정이 없어요 — 연동 키가 있는 로컬 파일에서 먼저 만들어야 해요.' : '계정이 없으면 관리자에게 등록을 요청하세요.');
  $('lg-skip').style.display = 'none'; authErr(msg || ''); $('login-gate').style.display = 'flex';
  setTimeout(() => $(AUTH.mode === 'bootstrap' ? 'lg-name' : 'lg-email').focus(), 0);
}
function authErr(m) { const e = $('lg-err'); e.textContent = m; e.style.display = m ? 'block' : 'none'; }
async function authSubmit() {
  const email = $('lg-email').value.trim().toLowerCase(), pw = $('lg-pw').value;
  if (!email || !pw) { authErr('이메일과 비밀번호를 입력하세요'); return; }
  const btn = $('lg-btn'); btn.disabled = true; authErr('');
  try {
    if (AUTH.mode === 'bootstrap') {
      const name = $('lg-name').value.trim(); if (!name) throw new Error('이름을 입력하세요');
      await authApi({ action: 'bootstrap' }, { email, password: pw, name });
      toast('관리자 계정을 만들었어요 — 로그인합니다');
    }
    const { data, error } = await AUTH.sb.auth.signInWithPassword({ email, password: pw });
    if (error) throw new Error(/invalid/i.test(error.message) ? '이메일 또는 비밀번호가 틀렸어요' : error.message);
    AUTH.session = data.session; $('lg-pw').value = '';
    await authLoadMe();
  } catch (e) { authErr(e.message); }
  finally { btn.disabled = false; }
}
async function authLogout() { localStorage.removeItem(DNRB_KEY); if (AUTH.sb) await AUTH.sb.auth.signOut(); location.reload(); }
async function authChangePw() {
  const pw = prompt('새 비밀번호 (8자 이상)'); if (pw === null) return;
  if (pw.length < 8) { toast('8자 이상이어야 해요'); return; }
  const { error } = await AUTH.sb.auth.updateUser({ password: pw });
  toast(error ? '변경 실패: ' + error.message : '비밀번호를 바꿨어요');
}
function authIsAdmin() { return !AUTH.me || AUTH.me.role === 'admin'; }   // me 없음 = 연동 없는 데모 → 제한 없음
function authApplyRole() {
  setTimeout(() => { if (typeof uplBadgeRefresh === 'function') uplBadgeRefresh(); }, 0);
  const admin = authIsAdmin();
  document.querySelectorAll('[data-role="admin"]').forEach(el => el.style.display = admin ? '' : 'none');
  const chip = $('auth-chip');
  if (AUTH.me && chip) chip.innerHTML = `<i class="fa-solid fa-user" style="color:#4f46e5;"></i> ${esc(AUTH.me.name || AUTH.me.email)} <span style="color:#9ca3af;">(${admin ? '관리자' : '마케터'})</span>`
    + (AUTH.session ? ` · <a href="#" onclick="authChangePw();return false;">비밀번호 변경</a>` : '')
    + (AUTH.session || AUTH.me.dnrb ? ` · <a href="#" onclick="authLogout();return false;">로그아웃</a>` : '');
  if (!admin && ['admgr', 'upload', 'perf', 'data'].includes(curMenu)) showMenu('ptest');
  dnrbApplyPerms();
}
/* 세부 권한(2탄, 2026-09-11): SSO 세션의 perms.menus(= data-menu 값)·perms.actions(toggle/budget/upload/creative/delete).
   화면 숨김은 편의, 진짜 잠금은 서버(util canAct). SSO가 아니면 null = 기존 role 규칙 */
function dnrbPerms() { const s = dnrbSession(); return s && s.perms ? s.perms : null; }
function dnrbCan(action) { const p = dnrbPerms(); return !p || (p.actions || []).includes(action); }
function dnrbApplyPerms() {
  const p = dnrbPerms(); if (!p) return;
  const menus = new Set(p.menus || []);
  document.querySelectorAll('.menu-item[data-menu]').forEach(el => { el.style.display = menus.has(el.dataset.menu) ? '' : 'none'; });
  document.querySelectorAll('a.menu-item[href="shoot-board.html"]').forEach(el => { el.style.display = menus.has('shoot') ? '' : 'none'; });
  document.querySelectorAll('[data-act]').forEach(el => { el.style.display = dnrbCan(el.dataset.act) ? '' : 'none'; });
  if (!menus.has(curMenu)) showMenu([...menus].find(k => k !== 'shoot') || 'home');
}

/* 사용자 관리 (데이터 관리 탭, 관리자) */
async function umLoad() {
  const box = $('um-list'); if (!box) return;
  if (!admgrCfg()) { box.textContent = '연동 정보가 없어 계정 관리를 쓸 수 없어요'; return; }
  try {
    const { users } = await authApi({ action: 'users' });
    AUTH.users = users;
    box.innerHTML = users.length ? `<div class="table-wrap"><table><thead><tr><th style="text-align:left;">이메일</th><th style="text-align:left;">이름</th><th>역할</th><th>만든 날</th><th></th></tr></thead><tbody>
      ${users.map(u => `<tr><td>${esc(u.email)}</td><td>${esc(u.name || '')}</td>
        <td style="text-align:center;"><select class="inp" style="padding:3px 6px;font-size:.78rem;background:#fff;" onchange="umRole('${u.user_id}', this.value)"><option value="marketer" ${u.role==='marketer'?'selected':''}>마케터</option><option value="admin" ${u.role==='admin'?'selected':''}>관리자</option></select></td>
        <td style="text-align:center;font-size:.76rem;color:#6b7280;">${(u.created_at||'').slice(0,10)}</td>
        <td><button class="btn-ghost btn-danger-ghost" style="padding:3px 9px;font-size:.7rem;" onclick="umDel('${u.user_id}')"><i class="fa-solid fa-xmark"></i></button></td></tr>`).join('')}
      </tbody></table></div>` : '<div style="padding:8px;">계정이 없어요</div>';
  } catch (e) { box.textContent = '불러오기 실패: ' + e.message; }
}
async function umCreate() {
  const email = $('um-email').value.trim().toLowerCase(), name = $('um-name').value.trim(), password = $('um-pw').value, role = $('um-role').value;
  if (!email || !password) { toast('이메일과 임시 비밀번호를 입력하세요'); return; }
  try {
    await authApi({ action: 'user_create' }, { email, name, password, role });
    toast(`${email} 계정을 만들었어요 — 임시 비밀번호를 전달하세요`);
    $('um-email').value = ''; $('um-name').value = ''; $('um-pw').value = ''; umLoad();
  } catch (e) { toast('실패: ' + e.message); }
}
async function umRole(user_id, role) { try { await authApi({ action: 'user_role' }, { user_id, role }); toast('역할을 바꿨어요'); } catch (e) { toast('실패: ' + e.message); umLoad(); } }
async function umDel(user_id) {
  const email = ((AUTH.users || []).find(u => u.user_id === user_id) || {}).email || '';
  if (!confirm(`${email} 계정을 삭제할까요? 더 이상 로그인할 수 없어요.`)) return;
  try { await authApi({ action: 'user_del' }, { user_id }); toast('삭제했어요'); umLoad(); } catch (e) { toast('실패: ' + e.message); }
}
