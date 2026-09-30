// ═══════════════════════════════════════════════
// CS 온보딩 체크리스트 API — cs-onboarding.html 전용
//   POST { action, ... }  헤더 x-cs-code = 초대코드(CS_ONBOARD_CODE secret)
//   ping                          → { ok }
//   list                          → { records:[{id,name,checked_on,day,solo,updated_at}] }  최신순 200건
//   get    { id }                 → { record }   st·quiz·memo 포함
//   save   { name, checked_on, day, st, quiz, memo } → { id }   같은 이름·날짜면 덮어씀
//   delete { id }                 → { ok }
// 배포: ./deploy-cs-onboarding.sh <초대코드>
// secrets: CS_ONBOARD_CODE. SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY는 자동 주입.
// ═══════════════════════════════════════════════
import { CORS_HEADERS, dbRest } from "../_shared/util.ts";

const H: Record<string, string> = { ...CORS_HEADERS, "Access-Control-Allow-Headers": CORS_HEADERS["Access-Control-Allow-Headers"] + ", x-cs-code" };
const j = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...H, "Content-Type": "application/json" } });
const T = "cs_onboarding_checks";
const UUID = /^[0-9a-f-]{36}$/i;
const LIST = "id,name,checked_on,day,solo,updated_at";

async function pg(path: string, method = "GET", body?: unknown, prefer = "return=representation"): Promise<any> {
  const res = await dbRest(path, { method, headers: { Prefer: prefer }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await res.text();
  if (!res.ok) throw new Error(`DB ${res.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

// 화면이 보낸 값만 받아 모양을 맞춘다 — 항목 값은 0·1·2, 질문은 true만
function cleanSt(v: unknown): Record<string, number> {
  const o: Record<string, number> = {};
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (/^[a-d]\d{1,2}$/.test(k) && (x === 0 || x === 1 || x === 2)) o[k] = x;
  }
  return o;
}
function cleanQuiz(v: unknown): Record<string, true> {
  const o: Record<string, true> = {};
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (/^q\d{1,2}$/.test(k) && x === true) o[k] = true;
  return o;
}

async function run(op: any): Promise<unknown> {
  switch (op?.action) {
    case "ping":
      return { ok: true };
    case "list":
      return { records: await pg(`${T}?select=${LIST}&order=checked_on.desc,updated_at.desc&limit=200`) };
    case "get": {
      if (!UUID.test(String(op.id))) throw new Error("bad id");
      const rows = await pg(`${T}?id=eq.${op.id}&select=*`);
      if (!rows.length) throw new Error("기록이 없습니다");
      return { record: rows[0] };
    }
    case "save": {
      const name = String(op.name ?? "").trim().slice(0, 40);
      if (!name) throw new Error("이름을 입력하세요");
      const checked_on = String(op.checked_on ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(checked_on)) throw new Error("날짜 형식이 아닙니다");
      const day = Math.max(1, Math.min(10, Math.round(Number(op.day) || 1)));
      const st = cleanSt(op.st), quiz = cleanQuiz(op.quiz);
      const memo = String(op.memo ?? "").slice(0, 4000);
      const solo = Object.values(st).filter((v) => v === 2).length;
      const rows = await pg(`${T}?on_conflict=name,checked_on`, "POST", { name, checked_on, day, st, quiz, memo, solo, updated_at: new Date().toISOString() }, "resolution=merge-duplicates,return=representation");
      return { id: rows[0]?.id, solo };
    }
    case "delete": {
      if (!UUID.test(String(op.id))) throw new Error("bad id");
      await pg(`${T}?id=eq.${op.id}`, "DELETE", undefined, "return=minimal");
      return { ok: true };
    }
    default:
      throw new Error("unknown action");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });
  const code = Deno.env.get("CS_ONBOARD_CODE") ?? "";
  if (!code) return j({ error: "CS_ONBOARD_CODE secret not set" }, 500);
  if (req.headers.get("x-cs-code") !== code) return j({ error: "unauthorized" }, 401);
  let body: unknown;
  try { body = await req.json(); } catch { return j({ error: "bad json" }, 400); }
  try { return j(await run(body)); }
  catch (e) { return j({ error: String((e as Error)?.message ?? e) }, 400); }
});
