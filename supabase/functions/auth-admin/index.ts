// ═══════════════════════════════════════════════
// 로그인 계정 관리 — Supabase Auth 사용자 + profiles 역할 (2026-09-07)
//   GET  ?action=status                 → { needs_bootstrap }  (프로필 0개면 true — 인증 불필요)
//   GET  ?action=me                     → { email, name, role }  (로그인 사용자 또는 DASH_KEY)
//   POST ?action=bootstrap  { email, password, name }   — 프로필 0개 + x-dash-key 일치 시에만: 최초 관리자 생성
//   GET  ?action=users                  (admin) → { users:[...] }
//   POST ?action=user_create { email, password, name, role }  (admin)
//   POST ?action=user_role   { user_id, role }                (admin)
//   POST ?action=user_del    { user_id }                      (admin — 자기 자신은 불가)
// 비밀번호 변경은 브라우저에서 supabase-js updateUser 로 본인이 직접.
// ═══════════════════════════════════════════════
import { dbRest, getAuth, handleOptions, json, requireRole } from "../_shared/util.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };

async function createUser(email: string, password: string, name: string, role: string) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("이메일 형식이 올바르지 않습니다");
  if (password.length < 8) throw new Error("비밀번호는 8자 이상");
  if (!["admin", "marketer"].includes(role)) throw new Error("role 오류");
  const r = await fetch(`${SB_URL}/auth/v1/admin/users`, { method: "POST", headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } }) });
  const u = await r.json();
  if (!r.ok) throw new Error(`계정 생성 실패: ${u.msg ?? u.message ?? u.error_description ?? JSON.stringify(u)}`);
  const pr = await dbRest("profiles", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ user_id: u.id, email, name, role }) });
  if (!pr.ok) {
    await fetch(`${SB_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: adminHeaders }).catch(() => {});
    throw new Error(`프로필 저장 실패: ${await pr.text()}`);
  }
  return (await pr.json())[0];
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "me";
  try {
    if (action === "status") {
      const r = await dbRest("profiles?select=user_id&limit=1");
      return json({ needs_bootstrap: r.ok && (await r.json()).length === 0 });
    }
    if (action === "me") {
      const me = await getAuth(req);
      return me ? json({ email: me.email, name: me.name, role: me.role }) : json({ error: "로그인이 필요합니다" }, 401);
    }
    if (req.method !== "POST" && action !== "users") return json({ error: "POST 필요" }, 405);
    const body = req.method === "POST" ? await req.json() : {};

    if (action === "bootstrap") {
      const key = Deno.env.get("DASH_KEY") ?? "";
      if (!key || req.headers.get("x-dash-key") !== key) return json({ error: "접근키가 필요합니다 (로컬 config.js)" }, 403);
      const r = await dbRest("profiles?select=user_id&limit=1");
      if ((await r.json()).length) return json({ error: "이미 관리자가 있습니다 — 로그인하세요" }, 400);
      const row = await createUser(String(body.email ?? "").trim().toLowerCase(), String(body.password ?? ""), String(body.name ?? "").trim(), "admin");
      return json({ ok: true, user: row });
    }

    const me = await requireRole(req, ["admin"]); if (me instanceof Response) return me;
    if (action === "users") {
      const r = await dbRest("profiles?select=user_id,email,name,role,created_at&order=created_at.asc");
      return json({ users: await r.json() });
    }
    if (action === "user_create") {
      const row = await createUser(String(body.email ?? "").trim().toLowerCase(), String(body.password ?? ""), String(body.name ?? "").trim(), String(body.role ?? "marketer"));
      return json({ ok: true, user: row });
    }
    if (action === "user_role") {
      if (!["admin", "marketer"].includes(body.role)) return json({ error: "role 오류" }, 400);
      if (body.user_id === me.id) return json({ error: "자기 역할은 바꿀 수 없어요" }, 400);
      const r = await dbRest(`profiles?user_id=eq.${body.user_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ role: body.role }) });
      if (!r.ok) return json({ error: await r.text() }, 500);
      return json({ ok: true });
    }
    if (action === "user_del") {
      if (body.user_id === me.id) return json({ error: "자기 계정은 삭제할 수 없어요" }, 400);
      const r = await fetch(`${SB_URL}/auth/v1/admin/users/${body.user_id}`, { method: "DELETE", headers: adminHeaders });
      if (!r.ok) return json({ error: `계정 삭제 실패: ${await r.text()}` }, 500);
      await dbRest(`profiles?user_id=eq.${body.user_id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return json({ ok: true });
    }
    return json({ error: `알 수 없는 action: ${action}` }, 400);
  } catch (e) { return json({ error: String((e as Error).message ?? e) }, 500); }
});
