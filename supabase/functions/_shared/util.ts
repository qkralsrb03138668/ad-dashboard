// 공용 유틸 — Edge Functions 전용
// (danarobe/dnrb-dashboard의 _shared/util.ts에서 이식 — 자체 로그인 대신 DASH_KEY 단일 키 인증으로 단순화)

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dash-key, x-dnrb-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  return null;
}

// (checkDashKey는 2026-10-26 보안 점검에서 제거 — 어디서도 안 쓰였고, DASH_KEY가 비면 무조건 통과하는 함수라 남겨두면 위험)
// 오류 메시지에 Meta 토큰이 섞여 나가지 않게 (네트워크 오류 문구에 요청 URL 전체가 들어갈 수 있다) — 2026-10-26 보안 점검
export const maskTok = (s: unknown): string => String(s).replace(/access_token=[^&\s)"']+/g, "access_token=***");

// ── 로그인 인증 (2026-09-07): DASH_KEY(로컬 파일용, admin 취급) 또는 Supabase Auth 사용자 JWT + profiles 역할 ──
//   프로필이 없는 계정은 거부 — 계정은 관리자가 '데이터 관리 › 사용자 관리'에서 만든다 (auth-admin 함수).
export interface AuthUser { id: string; email: string; name: string; role: "admin" | "marketer"; perms?: { menus: string[]; actions: string[] } }
// 세부 권한(2026-09-11 2탄): SSO 사용자는 워크스페이스 관리자가 정한 perms(menus·actions)로, 자체 로그인 사용자는 기존 role 규칙으로
export type Act = "toggle" | "budget" | "upload" | "creative" | "delete";
export function canAct(me: AuthUser, action: Act): boolean {
  if (me.perms) return (me.perms.actions ?? []).includes(action);
  return me.role === "admin" || action === "creative";   // 기존 규칙: 마케터는 소재 등록만
}
export function canMenu(me: AuthUser, menu: string): boolean { return me.perms ? (me.perms.menus ?? []).includes(menu) : me.role === "admin"; }
export function denyAct(action: string): Response { return json({ error: `이 동작(${action}) 권한이 없습니다 — 워크스페이스 관리자에게 요청하세요` }, 403); }
// DNRB 워크스페이스 SSO 토큰(2026-09-11): x-dnrb-token을 워크스페이스 auth 함수 verify로 확인 (시크릿 공유 없음).
//   401 위조·만료 / 403 워크스페이스 허용 목록에서 빠짐 → 둘 다 거부. 워크스페이스 admin만 admin, 나머지는 marketer. 60초 캐시.
const DNRB_AUTH_URL = "https://eeffmbusaqaadeojjlnc.supabase.co/functions/v1/auth";
const DNRB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZmZtYnVzYXFhYWRlb2pqbG5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3NDExOTIsImV4cCI6MjEwMDMxNzE5Mn0.P5Zxh1qrxpNU-SM_dpNz58xT6OWVk5Fq8l0c4WuuF2w";   // 워크스페이스 공개 anon 키 — 게이트웨이 통과용
const dnrbCache = new Map<string, { at: number; u: AuthUser }>();
/* 거절(401 위조·만료 / 403 허용 목록에서 빠짐)과 일시 장애(네트워크·5xx·429)를 구분한다 (2026-09-21).
   예전엔 둘 다 null → 우리 함수가 401 → 브라우저가 로그인 세션을 지워, 워크스페이스 인증 서버가 잠깐 느려도 전원 로그아웃됐다.
   일시 장애면 10분 안의 확인 결과를 그대로 쓰고, 그것도 없으면 오류를 던진다(호출부에서 5xx → 세션은 유지, "잠시 후 다시"). */
const DNRB_STALE_MS = 10 * 60_000;
async function dnrbVerify(token: string): Promise<AuthUser | null> {
  const c = dnrbCache.get(token);
  if (c && Date.now() - c.at < 60_000) return c.u;
  const stale = () => { if (c && Date.now() - c.at < DNRB_STALE_MS) return c.u; throw new Error("워크스페이스 인증 서버가 잠시 응답하지 않아요 — 잠시 후 다시 시도하세요"); };
  let r: Response;
  try {
    r = await fetch(DNRB_AUTH_URL, { method: "POST", headers: { "Content-Type": "application/json", apikey: DNRB_ANON, Authorization: `Bearer ${DNRB_ANON}` }, body: JSON.stringify({ action: "verify", token }), signal: AbortSignal.timeout(8000) });
  } catch { return stale(); }
  if (r.status === 401 || r.status === 403) { dnrbCache.delete(token); return null; }
  if (!r.ok) return stale();
  const d = await r.json().catch(() => null);
  if (!d || !d.id) return stale();
  const u: AuthUser = { id: "dnrb:" + d.id, email: String(d.id), name: String(d.name ?? d.id), role: d.role === "admin" ? "admin" : "marketer", perms: d.perms };
  dnrbCache.set(token, { at: Date.now(), u });
  return u;
}
export async function getAuth(req: Request): Promise<AuthUser | null> {
  const key = Deno.env.get("DASH_KEY") ?? "";
  if (key && req.headers.get("x-dash-key") === key) return { id: "dash-key", email: "dash-key", name: "접근키", role: "admin" };
  const dt = req.headers.get("x-dnrb-token");
  if (dt) return await dnrbVerify(dt);
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!token || token === anon) return null;
  const c = jwtCache.get(token);
  if (c && Date.now() - c.at < 60_000) return c.u;
  const inflight = jwtInflight.get(token);   // 화면 첫 로드처럼 같은 토큰으로 동시에 들어오면 한 번만 확인
  if (inflight) return await inflight;
  const p = (async (): Promise<AuthUser | null> => {
    try {
      const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const u = await r.json();
      const pr = await rest(`profiles?user_id=eq.${u.id}&select=role,email,name`);
      const row = (await pr.json())[0];
      if (!row) return null;
      const me: AuthUser = { id: u.id, email: row.email ?? u.email, name: row.name ?? "", role: row.role };
      jwtCache.set(token, { at: Date.now(), u: me });   // 성공만 보관 — 역할 변경·삭제는 최대 60초 뒤 반영
      if (jwtCache.size > 200) jwtCache.clear();
      return me;
    } catch { return null; } finally { jwtInflight.delete(token); }
  })();
  jwtInflight.set(token, p);
  return await p;
}
const jwtCache = new Map<string, { at: number; u: AuthUser }>();   // 2026-10-26 점검: 요청마다 auth/v1/user + profiles 2왕복이던 것을 60초 캐시
const jwtInflight = new Map<string, Promise<AuthUser | null>>();
// 역할 검사 헬퍼 — 통과하면 사용자, 아니면 403 응답
export async function requireRole(req: Request, roles: Array<"admin" | "marketer">): Promise<AuthUser | Response> {
  const me = await getAuth(req);
  if (!me) return json({ error: "로그인이 필요합니다" }, 401);
  if (!roles.includes(me.role)) return json({ error: "권한이 없습니다 (관리자만)" }, 403);
  return me;
}

// ── Supabase PostgREST 접근 (service_role — api_cache 테이블용) ──
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export async function dbRest(path: string, init: RequestInit = {}): Promise<Response> {
  const go = () => fetch(`${SB_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(30_000),   // PostgREST가 멈춰도 함수 전체가 같이 멈추지 않게 (2026-10-26 점검) — 호출부 signal이 있으면 그쪽 우선
    ...init,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const r = await go();
  if (r.status !== 401) return r;
  // PGRST303 "JWT issued at future" (2026-09-18 실사례): 고정 service_role 키(iat 9/2)를 Supabase 쪽이 잠깐 '미래 발급'으로 거절 — 그쪽 시계 문제라 일시적.
  // 인증 단계 거절 = SQL 실행 전이라 쓰기도 다시 보내 안전. 1초 뒤 한 번만. (호출부 body는 전부 문자열이라 재전송 가능)
  if (!(await r.clone().text()).includes("PGRST303")) return r;
  await new Promise((res) => setTimeout(res, 1000));
  return await go();
}

const rest = dbRest;   // (아래 캐시 코드가 쓰는 짧은 이름 — dbRest는 meta-ads의 상태 저장 액션도 함께 쓴다)

// ── 조회 결과 캐시 (api_cache 테이블) ──
// Meta 호출 한도(rate limit)의 방어선 — 반복 조회 실사고가 있었으니 캐시 없이 돌리지 말 것 (이식 가이드 §7-1).
export async function cacheGet(key: string, ttlMs: number): Promise<unknown | null> {
  try {
    const res = await rest(`api_cache?cache_key=eq.${encodeURIComponent(key)}&created_at=gte.${encodeURIComponent(new Date(Date.now() - ttlMs).toISOString())}&select=payload,created_at`);   // 만료분은 DB가 걸러 payload를 안 보낸다 (2026-10-26 점검)
    if (!res.ok) return null;
    const row = (await res.json())[0];
    if (!row) return null;
    if (Date.now() - new Date(row.created_at).getTime() > ttlMs) return null;
    return row.payload;
  } catch { return null; }
}

// 나이 상관없이 마지막 저장값 (한도 초과 시 stale 응답용, 24시간 이내)
export async function cacheGetAny(key: string): Promise<unknown | null> {
  try {
    const res = await rest(`api_cache?cache_key=eq.${encodeURIComponent(key)}&select=payload`);
    if (!res.ok) return null;
    const row = (await res.json())[0];
    return row ? row.payload : null;
  } catch { return null; }
}

let cacheSweepAt = 0;   // 정리 DELETE 마지막 실행 (isolate 메모리) — 2026-10-26 점검: 쓰기마다 돌던 전체 스캔을 10분에 1회로
export async function cacheSet(key: string, payload: unknown): Promise<void> {
  try {
    await rest(`api_cache?on_conflict=cache_key`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ cache_key: key, payload, created_at: new Date().toISOString() }),
    });
    // 오래된 항목 정리 (실패해도 무해) — 10분에 1회
    // 24시간 지난 것만 정리 — 한도 초과 시 '마지막 데이터'(stale)로 돌려쓰려면 하루는 남아 있어야 한다 (2026-09-07)
    if (Date.now() - cacheSweepAt < 10 * 60_000) return;
    cacheSweepAt = Date.now();
    await rest(`api_cache?created_at=lt.${encodeURIComponent(new Date(Date.now() - 24 * 3600_000).toISOString())}`, {
      method: "DELETE", headers: { Prefer: "return=minimal" },
    });
  } catch { /* 캐시는 실패해도 기능에 영향 없음 */ }
}

// ── 외부 API OAuth 토큰 (api_tokens 테이블 — 카페24 판매 성과용, 이식 패키지 그대로) ──
export interface TokenRow {
  provider: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  refresh_expires_at: string | null;
}

export async function getToken(provider: string): Promise<TokenRow | null> {
  const res = await rest(`api_tokens?provider=eq.${provider}&select=*`);
  if (!res.ok) throw new Error(`token read failed: ${res.status}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

export async function saveToken(row: TokenRow): Promise<void> {
  const res = await rest(`api_tokens?on_conflict=provider`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`token save failed: ${res.status} ${await res.text()}`);
}
