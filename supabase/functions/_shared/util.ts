// 공용 유틸 — Edge Functions 전용
// (danarobe/dnrb-dashboard의 _shared/util.ts에서 이식 — 자체 로그인 대신 DASH_KEY 단일 키 인증으로 단순화)

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dash-key",
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

// ── 간단 인증: DASH_KEY secret이 설정돼 있으면 x-dash-key 헤더가 일치해야 한다 ──
// 개인용 대시보드 전제. 키를 아예 안 만들면 anon key만으로 접근 가능하니
// 광고 데이터를 남에게 보이고 싶지 않으면 DASH_KEY를 꼭 설정할 것.
// (원본은 자체 로그인 verifyAuthToken + 역할(admin/staff) 검사 — 이식 가이드 §5의 어댑터 지점)
export function checkDashKey(req: Request): boolean {
  const key = Deno.env.get("DASH_KEY") ?? "";
  if (!key) return true;
  return req.headers.get("x-dash-key") === key;
}

// ── Supabase PostgREST 접근 (service_role — api_cache 테이블용) ──
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export async function dbRest(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

const rest = dbRest;   // (아래 캐시 코드가 쓰는 짧은 이름 — dbRest는 meta-ads의 상태 저장 액션도 함께 쓴다)

// ── 조회 결과 캐시 (api_cache 테이블) ──
// Meta 호출 한도(rate limit)의 방어선 — 반복 조회 실사고가 있었으니 캐시 없이 돌리지 말 것 (이식 가이드 §7-1).
export async function cacheGet(key: string, ttlMs: number): Promise<unknown | null> {
  try {
    const res = await rest(`api_cache?cache_key=eq.${encodeURIComponent(key)}&select=payload,created_at`);
    if (!res.ok) return null;
    const row = (await res.json())[0];
    if (!row) return null;
    if (Date.now() - new Date(row.created_at).getTime() > ttlMs) return null;
    return row.payload;
  } catch { return null; }
}

export async function cacheSet(key: string, payload: unknown): Promise<void> {
  try {
    await rest(`api_cache?on_conflict=cache_key`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ cache_key: key, payload, created_at: new Date().toISOString() }),
    });
    // 오래된 항목 정리 (실패해도 무해)
    await rest(`api_cache?created_at=lt.${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}`, {
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
