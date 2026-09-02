// ═══════════════════════════════════════════════
// Meta(페이스북·인스타그램) 광고관리자 연동 함수
// danarobe/dnrb-dashboard의 meta-ads에서 이식 (이식 가이드 1단계: 읽기 전용) —
//   GET ?action=hierarchy&preset=...  → 캠페인/광고세트/광고 전체 현황 (60초 캐시)
//   GET ?action=adstats&ad_id=...     → 소재 기간 7종 지출·ROAS (오늘/어제/3일/7일/이전7일/14일/30일)
//   GET ?action=preview&ad_id=...     → 소재 미리보기(iframe HTML) + 썸네일
//
// 필요 secrets: META_ACCESS_TOKEN (비즈니스 설정 > 시스템 사용자 토큰, ads_read 권한),
//               META_AD_ACCOUNT_ID (act_ 제외 숫자만 또는 act_숫자),
//               DASH_KEY (선택 — 설정하면 x-dash-key 헤더 일치 필요)
//
// 이식 가이드가 강조한 원칙 그대로:
//   ① 토큰은 서버에만 (클라이언트가 Meta를 직접 부르지 않음)
//   ② 60초 캐시 = 호출 한도 방어선 (원본에서 "User request limit reached" 실사고)
//   ③ 하향식 조립 — /ads 무필터 500 한도 잘림으로 캠페인 통째 누락 사고를 피하는 구조
// ═══════════════════════════════════════════════
import { cacheGet, cacheSet, checkDashKey, handleOptions, json } from "../_shared/util.ts";

const GRAPH = "https://graph.facebook.com/v23.0";

function creds(): { token: string; account: string } | null {
  const token = Deno.env.get("META_ACCESS_TOKEN") ?? "";
  let account = Deno.env.get("META_AD_ACCOUNT_ID") ?? "";
  if (!token || !account) return null;
  if (!account.startsWith("act_")) account = "act_" + account;
  return { token, account };
}

async function graphGet(path: string, params: Record<string, string>, token: string): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const body = await res.json();
  if (!res.ok) {
    const msg = (body?.error?.message ?? JSON.stringify(body)).slice(0, 300);
    throw new Error(`Meta API ${res.status}: ${msg}`);
  }
  return body;
}

const num = (v: unknown) => {
  const n = parseFloat(String(v ?? "0"));
  return isFinite(n) ? n : 0;
};

// 광고계정 시간대(한국) 기준 오늘 — date_preset도 계정 시간대로 계산되므로 UTC를 쓰면 하루 어긋난다 (가이드 §7-9)
function seoulToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

// YYYY-MM-DD ± 일수 (UTC 정오 기준이라 경계 영향 없음)
function addDays(ymd: string, d: number): string {
  const t = new Date(`${ymd}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

// actions/action_values 배열에서 구매 항목 추출 (픽셀 설정에 따라 purchase 또는 omni_purchase)
function pickPurchase(arr: unknown): number {
  const list = (arr ?? []) as { action_type?: string; value?: unknown }[];
  for (const t of ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]) {
    const hit = list.find((a) => a.action_type === t);
    if (hit) return num(hit.value);
  }
  return 0;
}

// 인사이트 행 → 표준 광고 행
function mapAdRow(r: Record<string, unknown>) {
  const spend = num(r.spend);
  const purchases = pickPurchase(r.actions);
  const purchaseValue = pickPurchase(r.action_values);
  const roasArr = (r.purchase_roas ?? []) as { value?: unknown }[];
  return {
    ad_id: String(r.ad_id ?? ""),
    ad_name: String(r.ad_name ?? ""),
    spend,
    purchases,
    purchase_value: purchaseValue,
    roas: roasArr.length ? num(roasArr[0].value) : (spend > 0 ? purchaseValue / spend : 0),
  };
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  if (!checkDashKey(req)) return json({ error: "접근 권한이 없습니다 (x-dash-key)" }, 403);

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "hierarchy";

  const c = creds();
  if (!c) {
    return json({ error: "not_connected", message: "Meta 연동이 설정되지 않았습니다 (META_ACCESS_TOKEN / META_AD_ACCOUNT_ID)" }, 200);
  }

  try {
    // ── 캠페인/광고세트/광고 계층 현황 (하향식 4호출 조립, 60초 캐시) ──
    if (action === "hierarchy") {
      const preset = ["today", "yesterday", "last_7d", "last_30d"].includes(url.searchParams.get("preset") ?? "")
        ? url.searchParams.get("preset")! : "today";
      // 실제 날짜 범위(계정 시간대) — last_7d/last_30d는 Meta 표준대로 '오늘 제외, 어제까지'
      const t = seoulToday();
      const range = preset === "today" ? { start: t, end: t }
        : preset === "yesterday" ? { start: addDays(t, -1), end: addDays(t, -1) }
        : preset === "last_7d" ? { start: addDays(t, -7), end: addDays(t, -1) }
        : { start: addDays(t, -30), end: addDays(t, -1) };
      const cacheKey = `meta:hierarchy:${preset}:${t}`;   // 오늘 날짜 포함 — 자정 넘김 대비
      const hit = await cacheGet(cacheKey, 60 * 1000);
      if (hit) return json(hit);

      type Node = Record<string, unknown>;
      const [camps, adsets, adsAct, ins] = await Promise.all([
        graphGet(`${c.account}/campaigns`, { fields: "id,name,effective_status,daily_budget,lifetime_budget,created_time,updated_time", limit: "200" }, c.token),
        graphGet(`${c.account}/adsets`, {
          fields: "id,name,effective_status,daily_budget,lifetime_budget,campaign_id,created_time,updated_time",
          filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]),
          limit: "500",
        }, c.token),   // 활성 필터 — 무필터 500 한도에 활성 세트가 잘리던 원본 버그 수정분 그대로
        graphGet(`${c.account}/ads`, {
          fields: "id,name,effective_status,adset_id,campaign_id,created_time,updated_time",
          filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]),
          limit: "500",
        }, c.token),
        graphGet(`${c.account}/insights`, {
          date_preset: preset, level: "ad",
          fields: "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,clicks,actions,action_values,purchase_roas",
          limit: "500",
        }, c.token),
      ]);

      // 캠페인/세트 뼈대
      const cMap = new Map<string, Node>();
      for (const r of (camps.data ?? []) as Node[]) {
        cMap.set(String(r.id), { id: String(r.id), name: String(r.name ?? ""), status: String(r.effective_status ?? ""),
          budget: num(r.daily_budget), budget_life: num(r.lifetime_budget),
          created: String(r.created_time ?? ""), updated: String(r.updated_time ?? ""),
          spend: 0, purchases: 0, value: 0, clicks: 0, adsets: new Map<string, Node>() });
      }
      const sMap = new Map<string, Node>();
      const ensureCamp = (id: string, name = "") => {
        if (!cMap.has(id)) cMap.set(id, { id, name, status: "", budget: 0, budget_life: 0, created: "", updated: "", spend: 0, purchases: 0, value: 0, clicks: 0, adsets: new Map() });
        return cMap.get(id)!;
      };
      const ensureAdset = (id: string, campId: string, name = "", status = "", budget = 0, budgetLife = 0, created = "", updated = "") => {
        if (!sMap.has(id)) {
          const node: Node = { id, name, status, budget, budget_life: budgetLife, created, updated, spend: 0, purchases: 0, value: 0, clicks: 0, ads: new Map<string, Node>() };
          sMap.set(id, node);
          (ensureCamp(campId).adsets as Map<string, Node>).set(id, node);
        }
        return sMap.get(id)!;
      };
      for (const r of (adsets.data ?? []) as Node[]) {
        ensureAdset(String(r.id), String(r.campaign_id ?? ""), String(r.name ?? ""), String(r.effective_status ?? ""),
          num(r.daily_budget), num(r.lifetime_budget), String(r.created_time ?? ""), String(r.updated_time ?? ""));
      }

      // 광고: 활성 전체 + 기간 중 게재분(인사이트) 합집합 — 중간에 꺼진 광고도 지출이 보인다
      const ensureAd = (adId: string, adsetId: string, campId: string, name: string, status: string, created = "", updated = "") => {
        const st = ensureAdset(adsetId, campId);
        const ads = st.ads as Map<string, Node>;
        if (!ads.has(adId)) ads.set(adId, { id: adId, name, status, created, updated, spend: 0, purchases: 0, value: 0, clicks: 0, roas: 0 });
        return ads.get(adId)!;
      };
      for (const r of (adsAct.data ?? []) as Node[]) {
        ensureAd(String(r.id), String(r.adset_id ?? ""), String(r.campaign_id ?? ""), String(r.name ?? ""), String(r.effective_status ?? ""),
          String(r.created_time ?? ""), String(r.updated_time ?? ""));
      }
      for (const r of (ins.data ?? []) as Node[]) {
        const m = mapAdRow(r);
        const campId = String(r.campaign_id ?? "");
        const camp = ensureCamp(campId, String(r.campaign_name ?? ""));
        if (!camp.name) camp.name = String(r.campaign_name ?? "");
        const st = ensureAdset(String(r.adset_id ?? ""), campId, String(r.adset_name ?? ""));
        if (!st.name) st.name = String(r.adset_name ?? "");
        const ad = ensureAd(String(r.ad_id ?? ""), String(r.adset_id ?? ""), campId, m.ad_name, "");
        const clicks = num(r.clicks);
        ad.spend = m.spend; ad.purchases = m.purchases; ad.value = m.purchase_value; ad.roas = m.roas; ad.clicks = clicks;
        st.spend = num(st.spend) + m.spend; st.purchases = num(st.purchases) + m.purchases; st.value = num(st.value) + m.purchase_value; st.clicks = num(st.clicks) + clicks;
        camp.spend = num(camp.spend) + m.spend; camp.purchases = num(camp.purchases) + m.purchases; camp.value = num(camp.value) + m.purchase_value; camp.clicks = num(camp.clicks) + clicks;
      }

      const campaigns = [...cMap.values()].map((cRow) => ({
        ...cRow,
        adsets: [...(cRow.adsets as Map<string, Node>).values()].map((st) => ({
          ...st, ads: [...(st.ads as Map<string, Node>).values()],
        })),
      }));
      const truncated = [camps, adsets, adsAct, ins].some((r) => ((r.data ?? []) as unknown[]).length >= 500);
      const body = { preset, range, fetched_at: new Date().toISOString(), truncated, campaigns };
      await cacheSet(cacheKey, body);
      return json(body);
    }

    // ── 소재 기간 7종 성과 (미리보기 모달용) ──
    if (action === "adstats") {
      const adId = url.searchParams.get("ad_id");
      if (!adId) return json({ error: "ad_id 필수" }, 400);
      const FIELDS = "spend,purchase_roas,action_values,date_start,date_stop";
      const presets = ["today", "yesterday", "last_3d", "last_7d", "last_14d", "last_30d"];
      const results = await Promise.all(presets.map((p) =>
        graphGet(`${adId}/insights`, { date_preset: p, fields: FIELDS }, c.token)
          .catch(() => ({ data: [] }))));
      const rowOf = (r: unknown) =>
        ((((r ?? {}) as Record<string, unknown>).data ?? []) as Record<string, unknown>[])[0] ?? {};

      // '이전 7일'은 Meta에 프리셋이 없어 time_range로 직접 — 기준일은 last_7d 응답에서 역산 (가이드 §7-9)
      const last7Start = String(rowOf(results[presets.indexOf("last_7d")]).date_start ?? "") ||
        addDays(seoulToday(), -7);
      const prevRange = { since: addDays(last7Start, -7), until: addDays(last7Start, -1) };
      const prevBody = await graphGet(`${adId}/insights`, {
        time_range: JSON.stringify(prevRange),
        fields: FIELDS,
      }, c.token).catch(() => ({ data: [] }));

      const toStat = (preset: string, r: Record<string, unknown>) => {
        const spend = num(r.spend);
        const roasArr = (r.purchase_roas ?? []) as { value?: unknown }[];
        const pv = pickPurchase(r.action_values);
        return {
          preset, spend,
          roas: roasArr.length ? num(roasArr[0].value) : (spend > 0 ? pv / spend : 0),
          start: String(r.date_start ?? ""),
          end: String(r.date_stop ?? ""),
        };
      };
      const byPreset: Record<string, ReturnType<typeof toStat>> = {};
      presets.forEach((p, i) => { byPreset[p] = toStat(p, rowOf(results[i])); });
      const prevStat = { ...toStat("prev_7d", rowOf(prevBody)), start: prevRange.since, end: prevRange.until };

      const stats = [
        byPreset.today, byPreset.yesterday, byPreset.last_3d, byPreset.last_7d,
        prevStat, byPreset.last_14d, byPreset.last_30d,
      ];
      return json({ ad_id: adId, stats });
    }

    // ── 소재 미리보기 — 실제 게재 형태의 iframe + 썸네일 ──
    // INSTAGRAM_STANDARD가 안정적 (REELS는 모달에서 잘리고 재생 안 되는 실사례 — 가이드 §7-7)
    if (action === "preview") {
      const adId = url.searchParams.get("ad_id");
      if (!adId) return json({ error: "ad_id 필수" }, 400);
      const [prev, meta] = await Promise.all([
        graphGet(`${adId}/previews`, { ad_format: "INSTAGRAM_STANDARD" }, c.token)
          .catch(() => graphGet(`${adId}/previews`, { ad_format: "DESKTOP_FEED_STANDARD" }, c.token)),
        graphGet(`${adId}`, { fields: "name,creative{thumbnail_url}", thumbnail_width: "512", thumbnail_height: "512" }, c.token)
          .catch(() => ({})),
      ]);
      const iframe = String(((prev.data ?? []) as { body?: string }[])[0]?.body ?? "");
      const creative = (meta as Record<string, Record<string, unknown>>).creative ?? {};
      return json({
        ad_id: adId,
        name: String((meta as Record<string, unknown>).name ?? ""),
        iframe,
        thumbnail: String(creative.thumbnail_url ?? ""),
      });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e).slice(0, 400) }, 500);
  }
});
