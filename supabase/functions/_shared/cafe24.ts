// 카페24 Admin API 호출 공용 — 토큰 갱신 + 429/401 재시도
// (cafe24-perf/index.ts 안의 getAccessToken·apiGet과 같은 로직. perf는 자기 복사본을 쓰고 있으니 perf를 다음에 손볼 때 이걸로 합칠 것)
import { getToken, saveToken } from "./util.ts";

const MALL_ID = Deno.env.get("CAFE24_MALL_ID")!;
const CLIENT_ID = Deno.env.get("CAFE24_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("CAFE24_CLIENT_SECRET")!;
export const API_BASE = `https://${MALL_ID}.cafe24api.com/api/v2`;
export const API_VERSION = "2026-09-01";   // 앱 등록 시 배정된 버전 (cafe24-perf와 동일)

export async function getAccessToken(force = false): Promise<string> {
  const t = await getToken("cafe24");
  if (!t?.refresh_token) throw new Error("카페24 미연동: 먼저 cafe24-oauth?action=start 로 인증하세요.");
  const expiresAt = t.expires_at ? new Date(t.expires_at).getTime() : 0;
  if (!force && expiresAt - Date.now() > 5 * 60 * 1000 && t.access_token) return t.access_token;

  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token }),
  });
  const body = await res.json();
  if (!res.ok) {
    await new Promise((r) => setTimeout(r, 1500));   // 다른 인스턴스가 먼저 갱신했을 수 있음
    const latest = await getToken("cafe24");
    if (latest?.access_token && latest.access_token !== t.access_token) return latest.access_token;
    throw new Error(`토큰 갱신 실패 ${res.status}: ${JSON.stringify(body)} — 재인증이 필요할 수 있습니다.`);
  }
  const now = Date.now();
  await saveToken({
    provider: "cafe24",
    access_token: String(body.access_token ?? ""),
    refresh_token: String(body.refresh_token ?? t.refresh_token),
    expires_at: body.expires_at ? new Date(String(body.expires_at)).toISOString() : new Date(now + 2 * 3600_000).toISOString(),
    refresh_expires_at: body.refresh_token_expires_at ? new Date(String(body.refresh_token_expires_at)).toISOString() : new Date(now + 14 * 86400_000).toISOString(),
  });
  return String(body.access_token);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function apiGet(url: string, token: string): Promise<Record<string, unknown>> {
  const doFetch = (tk: string) => fetch(url, { headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json", "X-Cafe24-Api-Version": API_VERSION } });
  let res = await doFetch(token);
  if (res.status === 401) res = await doFetch(await getAccessToken(true));
  for (let i = 0; res.status === 429 && i < 6; i++) {
    const ra = Number(res.headers.get("Retry-After"));
    await res.body?.cancel();
    await sleep(isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(1000 * 2 ** i, 8000));
    res = await doFetch(token);
  }
  const body = await res.json();
  if (!res.ok) throw new Error(`GET ${url.replace(/\?.*$/, "")} → ${res.status}: ${JSON.stringify(body)}`);
  return body;
}
