// ═══════════════════════════════════════════════
// 운영 보조 함수 (2026-09-08 3단계) — 오류 수집 · 브라우저 데이터 백업 · 서버 데이터 내보내기
//   POST ?action=error   { message, stack?, url? }      (로그인 사용자·접근키) → { ok }     최근 5,000건만 유지
//   POST ?action=backup  { payload:{adc_*: any} }        (로그인 사용자·접근키) → { ok, day, bytes }  사용자·날짜당 1건(덮어씀), 30일 보관
//   GET  ?action=backups                                 (로그인 사용자·접근키) → { rows:[{day, bytes, created_at}] }
//   GET  ?action=backup&day=YYYY-MM-DD                   (로그인 사용자·접근키) → { payload }
//   GET  ?action=errors&limit=200                        (admin)               → { rows }
//   GET  ?action=export                                  (admin)               → { exported_at, tables:{이름: 행[]} }   토큰·캐시 제외
// 로그인/auth-admin과 분리된 별도 함수 — 여기가 잘못돼도 로그인·광고 기능엔 영향 없음.
// ═══════════════════════════════════════════════
import { dbRest, getAuth, handleOptions, json, requireRole } from "../_shared/util.ts";

const MAX_ERR = 5000, KEEP_DAYS = 30, MAX_BACKUP_BYTES = 8 * 1024 * 1024;
// 내보내기 대상 — api_tokens(카페24 토큰)·api_cache(임시 캐시)는 제외
const EXPORT_TABLES = ["profiles", "creatives", "product_alias", "perf_archive", "best_ads", "ad_test_state", "test_ad_snap",
  "budget_writes", "budget_daystart", "shoot_trips", "shoot_items", "client_backups"];
const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";
  try {
    const me = await getAuth(req);
    if (!me) return json({ error: "로그인이 필요합니다" }, 401);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    if (action === "error" && req.method === "POST") {
      if (!body.message) return json({ error: "message 필요" }, 400);
      const r = await dbRest("client_errors", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
        user_email: me.email, url: clip(body.url, 500), message: clip(body.message, 2000), stack: clip(body.stack, 8000), ua: clip(req.headers.get("user-agent"), 300),
      }) });
      if (!r.ok) return json({ error: await r.text() }, 500);
      // 오래된 행 정리 — 최근 MAX_ERR건 밖은 삭제 (실패해도 무해)
      const old = await dbRest(`client_errors?select=id&order=id.desc&offset=${MAX_ERR}&limit=1`);
      const row = old.ok ? (await old.json())[0] : null;
      if (row) await dbRest(`client_errors?id=lte.${row.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => {});
      return json({ ok: true });
    }

    if (action === "backup" && req.method === "POST") {
      const payload = body.payload;
      if (!payload || typeof payload !== "object") return json({ error: "payload 필요" }, 400);
      const text = JSON.stringify(payload);
      if (text.length > MAX_BACKUP_BYTES) return json({ error: `백업이 너무 커요 (${Math.round(text.length / 1048576)}MB, 최대 8MB) — 소재 썸네일을 줄이세요` }, 413);
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
      const r = await dbRest("client_backups?on_conflict=user_key,day", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_key: me.email, day, payload, bytes: text.length, created_at: new Date().toISOString() }) });
      if (!r.ok) return json({ error: await r.text() }, 500);
      const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString().slice(0, 10);
      await dbRest(`client_backups?user_key=eq.${encodeURIComponent(me.email)}&day=lt.${cutoff}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => {});
      return json({ ok: true, day, bytes: text.length });
    }

    if (action === "backups") {
      const r = await dbRest(`client_backups?user_key=eq.${encodeURIComponent(me.email)}&select=day,bytes,created_at&order=day.desc`);
      return json({ rows: r.ok ? await r.json() : [] });
    }
    if (action === "backup") {
      const day = url.searchParams.get("day") ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "day 형식 오류" }, 400);
      const r = await dbRest(`client_backups?user_key=eq.${encodeURIComponent(me.email)}&day=eq.${day}&select=payload`);
      const row = r.ok ? (await r.json())[0] : null;
      return row ? json({ payload: row.payload }) : json({ error: "그 날짜의 백업이 없어요" }, 404);
    }

    const admin = await requireRole(req, ["admin"]); if (admin instanceof Response) return admin;
    if (action === "errors") {
      const limit = Math.min(1000, Number(url.searchParams.get("limit") ?? 200) || 200);
      const r = await dbRest(`client_errors?select=id,created_at,user_email,url,message,stack&order=id.desc&limit=${limit}`);
      return json({ rows: r.ok ? await r.json() : [] });
    }
    if (action === "export") {
      const tables: Record<string, unknown[]> = {};
      for (const t of EXPORT_TABLES) {
        const r = await dbRest(`${t}?select=*&limit=10000`);
        tables[t] = r.ok ? await r.json() : [{ _error: await r.text() }];
      }
      return json({ exported_at: new Date().toISOString(), tables });
    }
    return json({ error: `알 수 없는 action: ${action}` }, 400);
  } catch (e) { return json({ error: String((e as Error).message ?? e) }, 500); }
});
