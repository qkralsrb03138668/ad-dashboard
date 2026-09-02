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
import { cacheGet, cacheSet, checkDashKey, dbRest, handleOptions, json } from "../_shared/util.ts";

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

// 페이지네이션 — Meta는 한 번에 최대 500개. paging.next를 따라가며 모은다 (maxPages 상한 = 호출 폭주 방지)
async function graphGetAll(path: string, params: Record<string, string>, token: string, maxPages = 6): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let body = await graphGet(path, params, token);
  for (let i = 0; i < maxPages; i++) {
    out.push(...((body.data ?? []) as Record<string, unknown>[]));
    const next = (body.paging as { next?: string } | undefined)?.next;
    if (!next) break;
    const res = await fetch(next);   // next에는 access_token이 이미 포함돼 있다
    body = await res.json();
    if (!res.ok) throw new Error(`Meta API ${res.status}: ${String((body as { error?: { message?: string } })?.error?.message ?? "").slice(0, 300)}`);
  }
  return out;
}

const num = (v: unknown) => {
  const n = parseFloat(String(v ?? "0"));
  return isFinite(n) ? n : 0;
};

// ad_test_state 행 정제 — 클라이언트가 보낸 값 중 허용 필드만, 타입 강제 (판정 저장 API용)
function sanitizeState(r: Record<string, unknown>): Record<string, unknown> | null {
  const adId = String(r.ad_id ?? "");
  if (!/^\d{5,25}$/.test(adId)) return null;
  const iso = (v: unknown) => { const s = v == null ? "" : String(v); return s && !isNaN(new Date(s).getTime()) ? new Date(s).toISOString() : null; };
  const verdict = r.verdict === "good" || r.verdict === "meh" ? r.verdict : null;
  return {
    ad_id: adId,
    ad_name: String(r.ad_name ?? "").slice(0, 300),
    hidden: !!r.hidden,
    recommend: false,
    memo: r.memo == null || r.memo === "" ? null : String(r.memo).slice(0, 500),
    verdict,
    asset_req_at: iso(r.asset_req_at),
    asset_done_at: iso(r.asset_done_at),
    updated_by: String(r.updated_by ?? "dashboard").slice(0, 60),
    updated_at: new Date().toISOString(),
  };
}

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
      // fmt: feed(기본) / reels / story — 모달의 형식 전환 버튼. 거부되면 표준 → 데스크톱 피드 순으로 폴백
      const fmtParam = url.searchParams.get("fmt") ?? "feed";
      const fmt = fmtParam === "reels" ? "INSTAGRAM_REELS" : fmtParam === "story" ? "INSTAGRAM_STORY" : "INSTAGRAM_STANDARD";
      const [prev, meta] = await Promise.all([
        graphGet(`${adId}/previews`, { ad_format: fmt }, c.token)
          .catch(() => graphGet(`${adId}/previews`, { ad_format: "INSTAGRAM_STANDARD" }, c.token))
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

    // ═══ 이식 2단계 — 테스트 소재 (원본 testads 그대로) ═══
    // 광고세트명에 kw(기본 'test')가 들어간 세트의 광고 전부(꺼진 것 포함) + 등록 이후 누적 성과.
    // 본 소재는 test_ad_snap에 스냅샷으로 남겨, 세트명에서 test를 지워 목록에서 사라져도 60일간 '테스트 종료'(gone)로 함께 돌려준다.
    if (action === "testads") {
      const today = seoulToday();
      const kw = (url.searchParams.get("kw") ?? "test").slice(0, 30);
      const cacheKey = `meta:testads:${kw.toLowerCase()}:${today}`;
      const hit = await cacheGet(cacheKey, 60 * 1000);
      if (hit) return json(hit);

      const kwRe = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const allSets = await graphGetAll(`${c.account}/adsets`, { fields: "id,name", limit: "500" }, c.token);
      const testSets = allSets.filter((r) => kwRe.test(String(r.name ?? "")));
      const setName = new Map(testSets.map((r) => [String(r.id), String(r.name ?? "")]));
      const setIds = [...setName.keys()].slice(0, 200);   // IN 필터 값 개수·URL 길이 방어
      if (!setIds.length) {
        const empty = { fetched_at: new Date().toISOString(), until: today, adset_count: 0, truncated: false, ads: [] };
        await cacheSet(cacheKey, empty);
        return json(empty);
      }

      const adsetFilter = JSON.stringify([{ field: "adset.id", operator: "IN", value: setIds }]);
      const insParams = {
        time_range: JSON.stringify({ since: "2024-01-01", until: today }),
        level: "ad",
        fields: "ad_id,adset_id,spend,actions,action_values",
        limit: "500",
      };
      const [adRows, insRows] = await Promise.all([
        graphGetAll(`${c.account}/ads`, {
          fields: "id,name,status,effective_status,created_time,adset_id",
          filtering: adsetFilter,
          limit: "500",
        }, c.token),
        // insights의 adset.id IN 필터가 거부되면 무필터 전체를 받아 서버에서 거른다 (성과 누락 방지)
        graphGetAll(`${c.account}/insights`, { ...insParams, filtering: adsetFilter }, c.token)
          .catch(() => graphGetAll(`${c.account}/insights`, insParams, c.token, 12)),
      ]);

      const metric = new Map(insRows
        .filter((r) => setName.has(String(r.adset_id ?? "")))
        .map((r) => [String(r.ad_id ?? ""), r]));
      const regDate = (ct: string) => {
        const d = new Date(ct);
        return isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
      };
      const ads = adRows.map((a) => {
        const id = String(a.id ?? "");
        const m = metric.get(id);
        return {
          id,
          name: String(a.name ?? ""),
          adset_id: String(a.adset_id ?? ""),
          adset_name: setName.get(String(a.adset_id ?? "")) ?? "",
          status: String(a.status ?? ""),                       // 소재 자체 스위치
          effective_status: String(a.effective_status ?? ""),   // 실제 상태 (상위 꺼짐·검토중·거부 포함)
          created_time: String(a.created_time ?? ""),
          reg_date: regDate(String(a.created_time ?? "")),
          spend: m ? num(m.spend) : 0,
          purchases: m ? pickPurchase(m.actions) : 0,
          value: m ? pickPurchase(m.action_values) : 0,
        };
      });

      let goneAds: Record<string, unknown>[] = [];
      try {
        if (ads.length) {
          await dbRest(`test_ad_snap?on_conflict=ad_id`, {
            method: "POST",
            headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify(ads.map((a) => ({
              ad_id: a.id, name: a.name, adset_id: a.adset_id, adset_name: a.adset_name,
              status: a.status, effective_status: a.effective_status, reg_date: a.reg_date,
              spend: a.spend, purchases: a.purchases, value: a.value,
              last_seen: new Date().toISOString(),   // first_seen은 최초 삽입 때만 (본문에서 제외)
            }))),
          });
        }
        const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString();
        const res2 = await dbRest(`test_ad_snap?last_seen=gte.${encodeURIComponent(cutoff)}&select=*`);
        const snaps = res2.ok ? (await res2.json()) as Record<string, unknown>[] : [];
        const liveIds = new Set(ads.map((a) => a.id));
        goneAds = snaps
          .filter((s) => !liveIds.has(String(s.ad_id)))
          .map((s) => ({
            id: String(s.ad_id), name: String(s.name ?? ""),
            adset_id: String(s.adset_id ?? ""), adset_name: String(s.adset_name ?? ""),
            status: String(s.status ?? ""), effective_status: String(s.effective_status ?? ""),
            created_time: "", reg_date: String(s.reg_date ?? ""),
            spend: num(s.spend), purchases: num(s.purchases), value: num(s.value),
            gone: true, gone_since: String(s.last_seen ?? ""),
          }));
      } catch { /* 보관 실패해도 본 목록은 정상 반환 */ }

      const body = {
        fetched_at: new Date().toISOString(),
        until: today,
        adset_count: setIds.length,
        truncated: setName.size > setIds.length,
        ads: [...ads, ...goneAds],
      };
      await cacheSet(cacheKey, body);
      return json(body);
    }

    // ═══ 이식 3단계 — 베스트소재 썸네일 (원본 creatives) ═══
    // creative의 thumbnail_url은 기본 64px라 field 수정자로 600px 요청, 거부되면 기본 필드 폴백. 10분 캐시.
    if (action === "creatives") {
      const ids = (url.searchParams.get("set_ids") ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).slice(0, 100);
      if (!ids.length) return json({ ads: [] });
      const cacheKey = `meta:creatives:${[...ids].sort().join(",")}`;
      const hit = await cacheGet(cacheKey, 10 * 60 * 1000);
      if (hit) return json(hit);
      const setFilter = JSON.stringify([{ field: "adset.id", operator: "IN", value: ids }]);
      const baseParams = { filtering: setFilter, limit: "500" };
      let rows: Record<string, unknown>[];
      try {
        rows = await graphGetAll(`${c.account}/ads`, {
          ...baseParams,
          fields: "id,name,adset_id,status,effective_status,creative.thumbnail_width(600).thumbnail_height(600){thumbnail_url,image_url,object_type,video_id}",
        }, c.token);
      } catch {
        rows = await graphGetAll(`${c.account}/ads`, {
          ...baseParams,
          fields: "id,name,adset_id,status,effective_status,creative{thumbnail_url,image_url,object_type,video_id}",
        }, c.token);
      }
      const body = {
        fetched_at: new Date().toISOString(),
        ads: rows.map((a) => {
          const cr = (a.creative ?? {}) as Record<string, unknown>;
          return {
            id: String(a.id ?? ""),
            name: String(a.name ?? ""),
            adset_id: String(a.adset_id ?? ""),
            status: String(a.status ?? ""),
            effective_status: String(a.effective_status ?? ""),
            thumb: String(cr.thumbnail_url ?? ""),
            image: String(cr.image_url ?? ""),
            is_video: !!cr.video_id || String(cr.object_type ?? "") === "VIDEO",
          };
        }),
      };
      await cacheSet(cacheKey, body);
      return json(body);
    }

    // ═══ 이식 3단계 — 기존광고 중 OFF (원본 offsets) ═══
    // Meta 활동 로그(약 90일)의 update_ad_set_run_status 이벤트: new_value 1=활성, 그 외=비활성.
    // activities는 최신순이라 세트별 첫 이벤트 = 기간 내 마지막 상태. 마지막이 비활성인 세트만(껐다 켠 세트 제외), 테스트 세트 제외.
    // 한계: 세트 스위치를 직접 끈 것 기준 — 캠페인을 통째로 끈 경우는 세트 이벤트가 없어 안 잡힌다 (가이드 §7-4).
    if (action === "offsets") {
      const s = url.searchParams.get("start_date") ?? addDays(seoulToday(), -7);
      const e = url.searchParams.get("end_date") ?? seoulToday();
      const cacheKey = `meta:offsets:${s}:${e}`;
      const hit = await cacheGet(cacheKey, 60 * 1000);
      if (hit) return json(hit);

      const [acts, allSets] = await Promise.all([
        graphGetAll(`${c.account}/activities`, {
          fields: "event_type,event_time,object_id,extra_data",
          since: s,
          until: addDays(e, 1),   // until은 그 날 0시 기준 → 하루 더해 종료일 포함
          limit: "500",
        }, c.token, 8),
        // ids 배치 조회는 삭제 세트가 섞이면 통째로 실패 → 전체 목록 (삭제분은 목록에 없어 자연히 걸러짐)
        graphGetAll(`${c.account}/adsets`, { fields: "id,name,status,effective_status,created_time", limit: "500" }, c.token),
      ]);

      const last = new Map<string, { off: boolean; time: string }>();
      for (const r of acts) {
        if (String(r.event_type ?? "") !== "update_ad_set_run_status") continue;
        const id = String(r.object_id ?? "");
        if (last.has(id)) continue;
        let nv = 0;
        try {
          const raw = r.extra_data;
          const extra = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>) ?? {};
          nv = num(((extra.run_status ?? {}) as Record<string, unknown>).new_value);
        } catch { /* extra_data 없음/비JSON — 건너뜀 */ }
        if (!nv) continue;
        last.set(id, { off: nv !== 1, time: String(r.event_time ?? "") });
      }

      const info = new Map(allSets.map((r) => [String(r.id), r]));
      const offAll = [...last.entries()]
        .filter(([id, v]) => v.off && info.has(id) && !/test/i.test(String(info.get(id)?.name ?? "")))
        .map(([id]) => id);
      const offIds = offAll.slice(0, 200);

      const kstDate = (iso: string) => {
        const d = new Date(iso);
        return isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
      };

      let metric = new Map<string, Record<string, unknown>>();
      if (offIds.length) {
        const setFilter = JSON.stringify([{ field: "adset.id", operator: "IN", value: offIds }]);
        const insParams = {
          time_range: JSON.stringify({ since: "2024-01-01", until: seoulToday() }),   // 등록 이후 누적 (테스트 소재와 같은 기준)
          level: "adset",
          fields: "adset_id,spend,actions,action_values",
          limit: "500",
        };
        const insRows = await graphGetAll(`${c.account}/insights`, { ...insParams, filtering: setFilter }, c.token)
          .catch(() => [] as Record<string, unknown>[]);
        metric = new Map(insRows.map((r) => [String(r.adset_id ?? ""), r]));
      }

      const sets = offIds.map((id) => {
        const d0 = info.get(id) ?? {};
        const ev = last.get(id)!;
        const m = metric.get(id);
        return {
          id,
          name: String(d0.name ?? ""),
          created_time: String(d0.created_time ?? ""),
          reg_date: kstDate(String(d0.created_time ?? "")),
          off_time: ev.time,
          off_date: kstDate(ev.time),
          reactivated: String(d0.effective_status ?? "") === "ACTIVE",   // 기간 내 마지막은 OFF였지만 이후 다시 켜진 세트
          spend: m ? num(m.spend) : 0,
          purchases: m ? pickPurchase(m.actions) : 0,
          value: m ? pickPurchase(m.action_values) : 0,
        };
      });

      const body = {
        fetched_at: new Date().toISOString(),
        period: { start: s, end: e },
        count: sets.length,
        truncated: offAll.length > offIds.length,
        sets,
      };
      await cacheSet(cacheKey, body);
      return json(body);
    }

    // ═══ 예산 변경 이력 (원본 budgethistory) — Meta 활동 로그에서 예산 이벤트만 추출, 60초 캐시 ═══
    // 이벤트 타입 실측: update_ad_set_budget / update_campaign_budget 두 가지가 금액 변경.
    // extra_data는 중첩 JSON: {old_value:{old_value:30000}, new_value:{new_value:50000, additional_value:"(일일 기준)"}}
    // ⚠ object_type은 Meta 옛 명칭(CAMPAIGN=광고세트!) — 층 판정은 event_type으로 (가이드 §7-4). event_time은 UTC.
    if (action === "budgethistory") {
      const s = url.searchParams.get("start_date") ?? seoulToday();
      const e = url.searchParams.get("end_date") ?? seoulToday();
      const cacheKey = `meta:budgethist:${s}:${e}`;
      const hit = await cacheGet(cacheKey, 60 * 1000);
      if (hit) return json(hit);
      const rows = await graphGetAll(`${c.account}/activities`, {
        fields: "event_type,event_time,object_id,object_name,object_type,extra_data",
        since: s,
        until: addDays(e, 1),
        limit: "500",
      }, c.token, 4);
      const events = rows
        .filter((r) => /^update_(ad_set|campaign)_budget$/.test(String(r.event_type ?? "")))
        .map((r) => {
          let extra: Record<string, unknown> = {};
          try {
            const raw = r.extra_data;
            extra = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>) ?? {};
          } catch { /* extra_data 없음/비JSON */ }
          const ov = (extra.old_value ?? {}) as Record<string, unknown>;
          const nv = (extra.new_value ?? {}) as Record<string, unknown>;
          return {
            time: String(r.event_time ?? ""),
            level: String(r.event_type ?? "").startsWith("update_ad_set") ? "adset" : "campaign",
            object_id: String(r.object_id ?? ""),
            object_name: String(r.object_name ?? ""),
            old_value: num(ov.old_value ?? extra.old_value),
            new_value: num(nv.new_value ?? extra.new_value),
            note: String(nv.additional_value ?? ""),
          };
        })
        .filter((ev) => ev.old_value > 0 || ev.new_value > 0);
      const body = { period: { start: s, end: e }, count: events.length, events };
      await cacheSet(cacheKey, body);
      return json(body);
    }

    // ═══ 대시보드 상태 저장소 (ad_test_state · best_ads) ═══
    // 원본은 별도 db 프록시 함수를 썼지만(가이드 §5-2 어댑터 지점) 이 프로젝트는 함수 하나로 — DASH_KEY 인증 뒤에서만 접근.
    // ⚠ DASH_KEY를 안 설정하면 anon key만으로 판정 기록을 바꿀 수 있으니 반드시 설정할 것.
    if (action === "state_list") {
      const r = await dbRest("ad_test_state?select=*");
      return json(r.ok ? await r.json() : []);
    }
    if (action === "state_save" && req.method === "POST") {
      const raw = await req.json();
      const list = (Array.isArray(raw) ? raw : [raw]).map((x) => sanitizeState(x as Record<string, unknown>)).filter(Boolean).slice(0, 200);
      if (!list.length) return json({ error: "저장할 행이 없습니다" }, 400);
      const r = await dbRest("ad_test_state?on_conflict=ad_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(list),
      });
      if (!r.ok) return json({ error: "DB 저장 실패: " + (await r.text()).slice(0, 200) }, 500);
      return json({ ok: true, rows: await r.json() });
    }
    if (action === "best_list") {
      const r = await dbRest("best_ads?select=*&order=created_at.desc");
      return json(r.ok ? await r.json() : []);
    }
    if (action === "best_add" && req.method === "POST") {
      const raw = await req.json();
      const rows = (Array.isArray(raw) ? raw : [raw])
        .map((x) => x as Record<string, unknown>)
        .filter((x) => /^\d{5,25}$/.test(String(x.adset_id ?? "")))
        .map((x) => ({ adset_id: String(x.adset_id), adset_name: String(x.adset_name ?? "").slice(0, 300), added_by: String(x.added_by ?? "dashboard").slice(0, 60), created_at: new Date().toISOString() }))
        .slice(0, 100);
      if (!rows.length) return json({ error: "adset_id가 없습니다" }, 400);
      const r = await dbRest("best_ads?on_conflict=adset_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
      if (!r.ok) return json({ error: "DB 저장 실패: " + (await r.text()).slice(0, 200) }, 500);
      return json({ ok: true, count: rows.length });
    }
    if (action === "best_del" && req.method === "POST") {
      const { adset_id } = await req.json() as { adset_id?: unknown };
      if (!/^\d{5,25}$/.test(String(adset_id ?? ""))) return json({ error: "adset_id 형식 오류" }, 400);
      const r = await dbRest(`best_ads?adset_id=eq.${adset_id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      if (!r.ok) return json({ error: "DB 삭제 실패: " + (await r.text()).slice(0, 200) }, 500);
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e).slice(0, 400) }, 500);
  }
});
