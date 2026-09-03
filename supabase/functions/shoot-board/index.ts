// ═══════════════════════════════════════════════
// 출장촬영 보드 API — shoot-board.html 전용 (광고관리자 함수와 분리)
//   POST { action, ... }  헤더 x-shoot-code = 초대코드(SHOOT_CODE secret)
//   ping                       → { ok }                       초대코드 확인
//   trips                      → { trips }                    출장 목록
//   trip_set  { trip }         → 출장 만들기/수정
//   list      { trip_id, since? } → { trip, trips, items, now } since 이후 바뀐 항목만(삭제 포함) — 폰이 20초마다 호출
//   set       { trip_id, id, kind, data } → 코디/릴스/일정 저장 (통째로 덮어쓰기, 마지막 저장이 이김)
//   delete    { id }           → 삭제 표시
//   upload    { id, b64 }      → 사진을 shoot-photos 버킷에 저장 → { url }
//   bulk      { ops: [...] }   → 위 액션 여러 개 순서대로 (최대 50 — PPT 데이터 이관용)
// 배포: ~/.local/bin/supabase functions deploy shoot-board --project-ref pydxcqfztjogmztvayux --no-verify-jwt
// secrets: SHOOT_CODE (초대코드). SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY는 자동 주입.
// ═══════════════════════════════════════════════
import { CORS_HEADERS, dbRest } from "../_shared/util.ts";

const H: Record<string, string> = {
  ...CORS_HEADERS,
  "Access-Control-Allow-Headers": CORS_HEADERS["Access-Control-Allow-Headers"] + ", x-shoot-code",
};
const j = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...H, "Content-Type": "application/json" } });

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "shoot-photos";
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const now = () => new Date().toISOString();

async function pg(path: string, method = "GET", body?: unknown, prefer = "return=representation"): Promise<any> {
  const res = await dbRest(path, {
    method,
    headers: { Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`DB ${res.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
const TRIP_SEL = "shoot_trips?deleted=eq.false&select=id,name,start_date,days,models&order=start_date.desc";

async function run(op: any): Promise<unknown> {
  switch (op?.action) {
    case "ping":
      return { ok: true };
    case "trips":
      return { trips: await pg(TRIP_SEL) };
    case "trip_set": {
      const t = op.trip ?? {};
      if (!ID.test(String(t.id))) throw new Error("bad trip id");
      const row = {
        id: t.id, name: String(t.name ?? "").slice(0, 200), start_date: t.start || null,
        days: Math.max(1, Math.min(30, Number(t.days) || 1)),
        models: Array.isArray(t.models) ? t.models.map((m: unknown) => String(m).slice(0, 40)).slice(0, 20) : [],
        updated_at: now(), deleted: false,
      };
      await pg("shoot_trips?on_conflict=id", "POST", row, "resolution=merge-duplicates,return=minimal");
      return { ok: true };
    }
    case "list": {
      const tid = String(op.trip_id ?? "");
      if (!ID.test(tid)) throw new Error("bad trip id");
      const ts = now();                       // 조회 전에 시각을 잡아야 사이에 들어온 저장을 놓치지 않는다
      const trips = await pg(TRIP_SEL);
      const trip = trips.find((t: any) => t.id === tid) ?? null;
      let q = `shoot_items?trip_id=eq.${tid}&select=id,kind,data,updated_at,deleted&order=updated_at.asc&limit=3000`;
      q += op.since ? `&updated_at=gt.${encodeURIComponent(String(op.since))}` : "&deleted=eq.false";
      const items = await pg(q);
      return { trip, trips, items, now: ts };
    }
    case "set": {
      const { trip_id, id, kind, data } = op;
      if (!ID.test(String(trip_id)) || !ID.test(String(id))) throw new Error("bad id");
      if (!["outfit", "reel", "schedule"].includes(kind)) throw new Error("bad kind");
      if (!data || typeof data !== "object" || JSON.stringify(data).length > 200_000) throw new Error("bad data");
      await pg("shoot_items?on_conflict=id", "POST",
        { id, trip_id, kind, data, updated_at: now(), deleted: false },
        "resolution=merge-duplicates,return=minimal");
      return { ok: true };
    }
    case "delete": {
      if (!ID.test(String(op.id))) throw new Error("bad id");
      await pg(`shoot_items?id=eq.${op.id}`, "PATCH", { deleted: true, updated_at: now() }, "return=minimal");
      return { ok: true };
    }
    case "upload": {
      const id = String(op.id ?? "");
      if (!ID.test(id)) throw new Error("bad id");
      const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(op.b64 ?? ""));
      if (!m) throw new Error("bad image");
      const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      if (bytes.length > 2_000_000) throw new Error("image too large");
      const res = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${id}.jpg`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY, "Content-Type": `image/${m[1]}`, "x-upsert": "true" },
        body: bytes,
      });
      if (!res.ok) throw new Error(`storage ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { url: `${SB_URL}/storage/v1/object/public/${BUCKET}/${id}.jpg` };
    }
    case "bulk": {
      const ops = op.ops;
      if (!Array.isArray(ops) || ops.length > 50) throw new Error("bad ops");
      const results: unknown[] = [];
      for (const o of ops) { if (o?.action === "bulk") throw new Error("no nested bulk"); results.push(await run(o)); }
      return { results };
    }
    default:
      throw new Error("unknown action");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });
  const code = Deno.env.get("SHOOT_CODE") ?? "";
  if (!code) return j({ error: "SHOOT_CODE secret not set" }, 500);
  if (req.headers.get("x-shoot-code") !== code) return j({ error: "unauthorized" }, 401);
  let body: unknown;
  try { body = await req.json(); } catch { return j({ error: "bad json" }, 400); }
  try { return j(await run(body)); }
  catch (e) { return j({ error: String((e as Error)?.message ?? e) }, 400); }
});
