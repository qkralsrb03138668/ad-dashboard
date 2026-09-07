// ═══════════════════════════════════════════════
// Meta 예산 쓰기 함수 — 광고관리자의 예산 직접 변경 + 자정 예약
// (danarobe/dnrb-dashboard의 meta-budget에서 이식 — 이식 가이드 4단계. 안전장치는 원본 그대로, 인증만 이 프로젝트 방식으로)
//   읽기 함수(meta-ads)와 일부러 분리: 쓰기 토큰(META_WRITE_TOKEN)은 이 함수만 안다.
//
//   GET  ?action=status   → { allowed, token_set, pin_set, max_budget }  (버튼 노출 판단용)
//   GET  ?action=pending  → { pending: [...], recent: [...] }
//   POST ?action=verify   { pin } → PIN 인증만 (메뉴의 'PIN 인증' 버튼 — 세션 단위 활성화)
//   POST ?action=apply    { object_id, level, new_budget, pin } → 즉시 적용
//   POST ?action=schedule { object_id, object_name, level, new_budget, pin } → 다음 자정 예약
//   POST ?action=cancel   { id, pin } → 예약 취소
//   POST ?action=run      (헤더 x-cron-secret) → 자정 예약분 일괄 적용 — pg_cron이 00:00 KST(15:00 UTC)에 호출
//
// 보안 (전부 서버 강제 — 화면 우회 불가):
//   ① DASH_KEY(x-dash-key) — 원본의 '로그인 + admin + 허용 사용자 목록' 자리. 이 대시보드는 로그인이 없어 접근키가 그 역할
//   ② PIN(WRITE_PIN secret) 매 쓰기 요청 검증, 15분 내 5회 실패 시 잠금(api_cache 카운터)
//   ③ 일예산 상한 300,000원 / 하한 1,000원 (원본 사용자 지정값 그대로)
//   ④ 총예산(lifetime) 캠페인·세트는 변경 불가(일예산만)
//   ⑤ 모든 실행·예약·취소·실패를 budget_writes에 기록
//
// 필요 secrets: META_WRITE_TOKEN(ads_management 시스템 사용자 토큰 — 사용자가 발급), WRITE_PIN, CRON_SECRET,
//               DASH_KEY, META_ACCESS_TOKEN(읽기 — 현재값 조회용). secrets 변경 후에는 이 함수 재배포 필요.
// ═══════════════════════════════════════════════
import { cacheGet, cacheSet, checkDashKey, dbRest, handleOptions, json } from "../_shared/util.ts";

const GRAPH = "https://graph.facebook.com/v23.0";
const MAX_BUDGET = 300_000;   // 개당 일예산 상한
const MIN_BUDGET = 1_000;

const env = (k: string) => Deno.env.get(k) ?? "";
const num = (v: unknown) => { const n = parseFloat(String(v ?? "0")); return isFinite(n) ? n : 0; };
function seoulToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}
function addDays(ymd: string, d: number): string {
  const t = new Date(`${ymd}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

// budget_writes·api_cache 접근 (service_role)
async function pg(path: string, method: string, body?: unknown): Promise<unknown> {
  const res = await dbRest(path, {
    method,
    headers: { Prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`DB ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function metaGetObj(id: string, token: string): Promise<{ name: string; daily: number; lifetime: number }> {
  const qs = new URLSearchParams({ fields: "name,daily_budget,lifetime_budget", access_token: token });
  const res = await fetch(`${GRAPH}/${id}?${qs}`);
  const body = await res.json();
  if (!res.ok) throw new Error(`Meta 조회 실패: ${(body?.error?.message ?? "").slice(0, 200)}`);
  return { name: String(body.name ?? ""), daily: num(body.daily_budget), lifetime: num(body.lifetime_budget) };
}
async function metaSetBudget(id: string, won: number): Promise<void> {
  const res = await fetch(`${GRAPH}/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ daily_budget: String(won), access_token: env("META_WRITE_TOKEN") }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    throw new Error(`Meta 적용 실패: ${(body?.error?.message ?? JSON.stringify(body)).slice(0, 250)}`);
  }
}

// 광고세트 전체(id·이름·일예산) — 읽기 토큰, 페이지네이션
async function metaAllAdsets(): Promise<{ id: string; name: string; budget: number }[]> {
  const token = env("META_ACCESS_TOKEN") || env("META_WRITE_TOKEN");
  let account = env("META_AD_ACCOUNT_ID"); if (!account.startsWith("act_")) account = "act_" + account;
  const out: { id: string; name: string; budget: number }[] = [];
  // 활성 세트만 — 무필터면 종료·일시중지 세트까지 3,000개 가까이 나와 스냅샷·원복 대상이 부풀었다 (2026-09-07 실측 2,942개)
  let url: string | null = `${GRAPH}/${account}/adsets?${new URLSearchParams({ fields: "id,name,daily_budget", limit: "500", access_token: token,
    filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]) })}`;
  for (let i = 0; i < 6 && url; i++) {
    const res = await fetch(url); const body = await res.json();
    if (!res.ok) throw new Error(`Meta 세트 조회 실패: ${(body?.error?.message ?? "").slice(0, 200)}`);
    for (const r of (body.data ?? []) as Record<string, unknown>[]) out.push({ id: String(r.id), name: String(r.name ?? ""), budget: num(r.daily_budget) });
    url = (body.paging as { next?: string } | undefined)?.next ?? null;
  }
  return out;
}

// 00:10 KST — 오늘 시작 예산 스냅샷 (budget_daystart). 자정 예약 반영(00:00) 뒤의 값이 '하루 시작 예산'
// backfill=true: 00:10을 놓친 날(첫 도입일 등) 낮에 불러도 '하루 시작 예산'을 복원 — 오늘 예산 변경 이력의 첫 old_value, 변경 없던 세트는 현재값
async function snapshotDayStart(backfill = false): Promise<Record<string, unknown>> {
  const day = seoulToday();
  const sets = (await metaAllAdsets()).filter((s) => s.budget > 0);
  if (backfill) {
    // meta-ads의 budgethistory(오늘, 5분 캐시/서버 수집분)를 재사용 — Meta 추가 호출 없음
    const r = await fetch(`${env("SUPABASE_URL")}/functions/v1/meta-ads?action=budgethistory`, { headers: { "x-dash-key": env("DASH_KEY") } });
    const hist = r.ok ? (await r.json()) as { events?: { time: string; level: string; object_id: string; old_value: number }[] } : {};
    const first = new Map<string, number>();
    const cut = `${addDays(day, -1)}T15:10:00Z`;   // 00:10 KST — 그 전(자정 ×10 예약 반영)은 '시작' 이전 변경이라 제외
    for (const ev of (hist.events ?? []).filter((e) => e.level === "adset" && e.old_value > 0 && e.time >= cut).sort((a, b) => a.time.localeCompare(b.time))) {
      if (!first.has(ev.object_id)) first.set(ev.object_id, ev.old_value);
    }
    for (const s of sets) if (first.has(s.id)) s.budget = first.get(s.id)!;
  }
  if (sets.length) {
    await dbRest(`budget_daystart?day=eq.${day}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });   // 그날 스냅샷은 통째로 새로 (재실행·복원 시 잔여 행 제거)
    await dbRest("budget_daystart?on_conflict=day,adset_id", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(sets.map((s) => ({ day, adset_id: s.id, name: s.name, budget: s.budget, taken_at: new Date().toISOString() }))),
    });
  }
  return { day, count: sets.length };
}

// 23:55 KST — 오늘 '원복 승인'(budget_writes mode=reset_approve, pending, apply_date=오늘)이 있으면
// 스냅샷 예산과 다른 세트를 시작 예산으로 되돌린다 (2026-09-07 사용자 운영 규칙)
async function runReset(): Promise<Record<string, unknown>> {
  const day = seoulToday();
  const appr = (await pg(`budget_writes?mode=eq.reset_approve&status=eq.pending&apply_date=eq.${day}&limit=1`, "GET")) as Record<string, unknown>[];
  if (!appr.length) return { day, skipped: "승인 없음" };
  const snap = (await pg(`budget_daystart?day=eq.${day}&select=adset_id,name,budget`, "GET")) as Record<string, unknown>[];
  if (!snap.length) {
    await pg(`budget_writes?id=eq.${appr[0].id}`, "PATCH", { status: "failed", applied_at: new Date().toISOString(), error: "오늘 시작 예산 스냅샷이 없음(00:10 기록 전)" });
    return { day, skipped: "스냅샷 없음" };
  }
  const cur = new Map((await metaAllAdsets()).map((s) => [s.id, s]));
  let ok = 0, fail = 0, same = 0;
  for (const s of snap) {
    const id = String(s.adset_id), target = Math.round(num(s.budget));
    const now = cur.get(id); if (!now) continue;
    if (Math.round(now.budget) === target) { same++; continue; }
    try {
      await metaSetBudget(id, target);
      await pg("budget_writes", "POST", { object_id: id, object_name: now.name, level: "adset", old_budget: now.budget, new_budget: target, mode: "reset", status: "applied", requested_by: "cron", applied_at: new Date().toISOString() });
      ok++;
    } catch (e) {
      await pg("budget_writes", "POST", { object_id: id, object_name: now.name, level: "adset", old_budget: now.budget, new_budget: target, mode: "reset", status: "failed", requested_by: "cron", applied_at: new Date().toISOString(), error: String(e).slice(0, 300) }).catch(() => {});
      fail++;
    }
  }
  await pg(`budget_writes?id=eq.${appr[0].id}`, "PATCH", { status: "applied", applied_at: new Date().toISOString(), error: `원복 ${ok}·동일 ${same}·실패 ${fail}` });
  if (ok) await clearMetaCaches();
  return { day, reset: ok, same, failed: fail };
}

// 예산 변경 후 관련 서버 캐시 비우기 — 화면이 바로 새 값을 보게 (이 프로젝트의 api_cache 키 컬럼은 cache_key)
async function clearMetaCaches(): Promise<void> {
  await pg(`api_cache?cache_key=like.${encodeURIComponent("meta:hierarchy")}*`, "DELETE").catch(() => {});
  await pg(`api_cache?cache_key=like.${encodeURIComponent("meta:budgethist")}*`, "DELETE").catch(() => {});
}

// PIN 검증 + 15분 5회 잠금
async function checkPin(pin: string): Promise<string | null> {
  const set = env("WRITE_PIN");
  if (!set) return "PIN이 아직 설정되지 않았습니다 (WRITE_PIN secret)";
  const key = "pinfail:dashboard";
  const rec = (await cacheGet(key, 15 * 60 * 1000)) as { n?: number } | null;
  const n = rec?.n ?? 0;
  if (n >= 5) return "PIN 5회 오류 — 15분 뒤 다시 시도하세요";
  if (String(pin ?? "") !== set) {
    await cacheSet(key, { n: n + 1 });
    return `PIN이 올바르지 않습니다 (남은 시도 ${4 - n}회)`;
  }
  return null;
}

// 자정 예약분 일괄 적용 — pg_cron이 00:00 KST(15:00 UTC)에 호출
async function runPending(): Promise<Record<string, unknown>> {
  const today = seoulToday();
  const due = (await pg(`budget_writes?status=eq.pending&apply_date=lte.${today}&order=requested_at.asc`, "GET")) as Record<string, unknown>[];
  let ok = 0, fail = 0;
  for (const row of due) {
    try {
      if (!env("META_WRITE_TOKEN")) throw new Error("META_WRITE_TOKEN 미설정");
      await metaSetBudget(String(row.object_id), num(row.new_budget));
      await pg(`budget_writes?id=eq.${row.id}`, "PATCH", { status: "applied", applied_at: new Date().toISOString() });
      ok++;
    } catch (e) {
      await pg(`budget_writes?id=eq.${row.id}`, "PATCH", { status: "failed", applied_at: new Date().toISOString(), error: String(e).slice(0, 300) }).catch(() => {});
      fail++;
    }
  }
  if (ok) await clearMetaCaches();
  return { due: due.length, applied: ok, failed: fail };
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "status";

  try {
    // 자정 실행 경로 — 접근키 대신 cron 비밀 헤더
    if (action === "run" || action === "snapshot" || action === "run_reset") {
      const secret = env("CRON_SECRET");
      if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "권한 없음" }, 403);
      if (action === "snapshot") return json(await snapshotDayStart(url.searchParams.get("backfill") === "1"));
      if (action === "run_reset") return json(await runReset());
      return json(await runPending());
    }

    if (!checkDashKey(req)) return json({ error: "접근 권한이 없습니다 (x-dash-key)" }, 403);
    // ⚠ DASH_KEY가 비어 있으면 누구나 예산을 바꿀 수 있으므로 쓰기 기능 자체를 잠근다
    if (!env("DASH_KEY")) return json({ error: "DASH_KEY가 설정되지 않아 예산 변경을 사용할 수 없습니다" }, 403);

    if (action === "status") {
      return json({ allowed: true, token_set: !!env("META_WRITE_TOKEN"), pin_set: !!env("WRITE_PIN"), max_budget: MAX_BUDGET });
    }
    if (action === "pending") {
      const pending = await pg("budget_writes?status=eq.pending&order=requested_at.desc&limit=100", "GET");
      const recent = await pg("budget_writes?status=neq.pending&order=requested_at.desc&limit=20", "GET");
      const daystart = await pg(`budget_daystart?day=eq.${seoulToday()}&select=adset_id,budget`, "GET");   // 자정세팅 열: 시작 예산·23:55 원복 대상 표시용
      return json({ pending, recent, daystart });
    }

    // 이하 쓰기 — 매 요청 PIN 검증
    if (req.method !== "POST") return json({ error: "POST 필요" }, 405);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const pinErr = await checkPin(String(body.pin ?? ""));
    if (pinErr) return json({ error: pinErr }, 403);
    const who = "dashboard";

    if (action === "verify") return json({ ok: true });

    // 오늘 23:55 원복 승인 등록 (PIN) — 같은 날 기존 승인은 교체. 취소는 기존 cancel 액션(id)
    if (action === "approve_reset") {
      const day = seoulToday();
      await pg(`budget_writes?mode=eq.reset_approve&status=eq.pending&apply_date=eq.${day}`, "PATCH", { status: "canceled", applied_at: new Date().toISOString() }).catch(() => {});
      const rows = (await pg("budget_writes", "POST", {
        object_id: "*", object_name: "23:55 시작 예산 원복 승인", level: "adset",
        old_budget: null, new_budget: 0, mode: "reset_approve", apply_date: day, status: "pending", requested_by: who,
      })) as Record<string, unknown>[];
      return json({ ok: true, id: rows?.[0]?.id, apply_date: day });
    }

    if (action === "cancel") {
      const id = Math.round(num(body.id));
      const rows = (await pg(`budget_writes?id=eq.${id}&status=eq.pending`, "PATCH", { status: "canceled", applied_at: new Date().toISOString() })) as unknown[];
      if (!rows.length) return json({ error: "취소할 예약이 없습니다" }, 400);
      return json({ ok: true });
    }

    // 켜기/끄기 (2026-09-07) — 캠페인·세트·광고 status 변경. 쓰기 토큰 + PIN, budget_writes에 mode='status'로 기록(new_budget 1=켜짐 0=꺼짐)
    if (action === "setstatus") {
      const objectId = String(body.object_id ?? "");
      const level = String(body.level ?? "");
      const status = String(body.status ?? "");
      if (!/^\d{5,25}$/.test(objectId) || !["campaign", "adset", "ad"].includes(level) || !["ACTIVE", "PAUSED"].includes(status)) {
        return json({ error: "대상/상태가 올바르지 않습니다" }, 400);
      }
      if (!env("META_WRITE_TOKEN")) return json({ error: "Meta 쓰기 토큰(META_WRITE_TOKEN)이 아직 설정되지 않았습니다" }, 400);
      const res = await fetch(`${GRAPH}/${objectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ status, access_token: env("META_WRITE_TOKEN") }),
      });
      const rb = await res.json().catch(() => ({}));
      if (!res.ok || rb?.success === false) return json({ error: `Meta 적용 실패: ${(rb?.error?.message ?? JSON.stringify(rb)).slice(0, 250)}` }, 500);
      await pg("budget_writes", "POST", {
        object_id: objectId, object_name: String(body.object_name ?? ""), level,
        old_budget: null, new_budget: status === "ACTIVE" ? 1 : 0, mode: "status", status: "applied",
        requested_by: who, applied_at: new Date().toISOString(),
      }).catch(() => {});
      await clearMetaCaches();
      return json({ ok: true, status });
    }

    // apply / schedule 공통 검증
    const objectId = String(body.object_id ?? "");
    const level = String(body.level ?? "");
    const newBudget = Math.round(num(body.new_budget));
    if (!/^\d{5,25}$/.test(objectId) || !["campaign", "adset"].includes(level)) return json({ error: "대상이 올바르지 않습니다" }, 400);
    if (newBudget < MIN_BUDGET || newBudget > MAX_BUDGET) {
      return json({ error: `예산은 ${MIN_BUDGET.toLocaleString()}원 ~ ${MAX_BUDGET.toLocaleString()}원 사이여야 합니다 (상한선 서버 강제)` }, 400);
    }

    // 현재값 확인 (읽기 토큰) — 총예산 전용 대상은 거부
    let cur = { name: String(body.object_name ?? ""), daily: 0, lifetime: 0 };
    try { cur = await metaGetObj(objectId, env("META_ACCESS_TOKEN") || env("META_WRITE_TOKEN")); } catch { /* 조회 실패해도 진행 */ }
    if (!cur.daily && cur.lifetime) return json({ error: "총예산(lifetime) 대상은 지원하지 않습니다 — 일예산만 변경 가능" }, 400);

    if (action === "apply") {
      if (!env("META_WRITE_TOKEN")) return json({ error: "Meta 쓰기 토큰(META_WRITE_TOKEN)이 아직 설정되지 않았습니다" }, 400);
      await metaSetBudget(objectId, newBudget);
      await pg("budget_writes", "POST", {
        object_id: objectId, object_name: cur.name || String(body.object_name ?? ""), level,
        old_budget: cur.daily || null, new_budget: newBudget, mode: "now", status: "applied",
        requested_by: who, applied_at: new Date().toISOString(),
      });
      await clearMetaCaches();
      return json({ ok: true, old_budget: cur.daily, new_budget: newBudget });
    }

    if (action === "schedule") {
      // 같은 대상의 기존 예약은 자동 대체 (최신 예약 하나만 유효)
      await pg(`budget_writes?object_id=eq.${objectId}&status=eq.pending`, "PATCH", { status: "canceled", applied_at: new Date().toISOString() }).catch(() => {});
      const applyDate = addDays(seoulToday(), 1);   // 다음 자정 = 내일 날짜 00:00 KST
      await pg("budget_writes", "POST", {
        object_id: objectId, object_name: cur.name || String(body.object_name ?? ""), level,
        old_budget: cur.daily || null, new_budget: newBudget, mode: "midnight", apply_date: applyDate,
        status: "pending", requested_by: who,
      });
      return json({ ok: true, apply_date: applyDate, new_budget: newBudget, token_set: !!env("META_WRITE_TOKEN") });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e).slice(0, 400) }, 500);
  }
});
