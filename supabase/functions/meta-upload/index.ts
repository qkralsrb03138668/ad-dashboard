// ═══════════════════════════════════════════════
// Meta 광고 업로드 함수 — Ads Uploader 대체 v1 (사용자 실사용 패턴 기준)
//   모델 광고 1개 선택 → 파일 1개 = 광고세트 1개 + 광고 1개. 세트 설정·강화옵션·페이지는 모델과 동일, 예산만 입력.
//   미디어는 브라우저→이 함수→Meta 로 조각 전달(영상은 Meta 재개 가능 업로드, 4MB 조각) — 쓰기 토큰은 서버에만.
//
//   GET  ?action=status                    → { token_set, pin_set, account }
//   POST ?action=verify        { pin }
//   GET  ?action=model&ad_id=…             → 모델 광고·세트·캠페인 설정 + 문구 (5분 캐시)
//   GET  ?action=diagnose&ad_id=…          → 쓰기 토큰 권한·페이지/인스타 접근 진단
//   GET  ?action=validate&ad_id=…          → 모델 자신의 미디어로 세트·크리에이티브·광고 생성을 validate_only 검증 (생성 없음, PIN 불필요)
//   POST ?action=image         multipart(pin, file)                         → { image_hash }
//   POST ?action=video_start   { pin, file_size }                           → { video_id, session_id, start_offset, end_offset }
//   POST ?action=video_chunk   multipart(pin, session_id, start_offset, chunk) → { start_offset, end_offset }
//   POST ?action=video_finish  { pin, session_id, title }                   → { ok }
//   GET  ?action=video_status&video_id=…   → { ready, progress, thumbnail_url }
//   POST ?action=create        { pin, model_ad_id, name, budget, status, media:{type,image_hash|video_id,thumbnail_url}, text:{message,title,description,link,cta} }
//                                          → { adset_id, creative_id, ad_id }
//
// 보안: DASH_KEY + 매 쓰기 요청 PIN(WRITE_PIN, meta-budget과 동일 규칙: 15분 5회 잠금) + 일예산 상한 300,000원.
// 필요 secrets: META_WRITE_TOKEN, WRITE_PIN, DASH_KEY, META_AD_ACCOUNT_ID
// ═══════════════════════════════════════════════
import { cacheGet, cacheSet, checkDashKey, handleOptions, json } from "../_shared/util.ts";

const GRAPH = "https://graph.facebook.com/v23.0";
const MAX_BUDGET = 300_000, MIN_BUDGET = 1_000;
const env = (k: string) => Deno.env.get(k) ?? "";
const ACCOUNT = (() => { const a = env("META_AD_ACCOUNT_ID"); return a.startsWith("act_") ? a : `act_${a}`; })();
type Rec = Record<string, unknown>;

async function graph(path: string, init: { method?: string; params?: Record<string, string>; form?: FormData } = {}): Promise<Rec> {
  const token = env("META_WRITE_TOKEN");
  if (!token) throw new Error("META_WRITE_TOKEN 미설정");
  let res: Response;
  if (init.form) {
    init.form.set("access_token", token);
    res = await fetch(`${GRAPH}/${path}`, { method: "POST", body: init.form });
  } else if (init.method === "POST") {
    res = await fetch(`${GRAPH}/${path}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...(init.params ?? {}), access_token: token }),
    });
  } else {
    res = await fetch(`${GRAPH}/${path}?${new URLSearchParams({ ...(init.params ?? {}), access_token: token })}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    const e = body?.error ?? {};
    throw new Error(`Meta ${path.split("?")[0]}: ${e.error_user_msg ?? e.message ?? JSON.stringify(body)}`.slice(0, 400));
  }
  return body as Rec;
}

// PIN 검증 — meta-budget과 같은 카운터 키를 써서 잠금도 공유
async function checkPin(pin: unknown): Promise<string | null> {
  const set = env("WRITE_PIN");
  if (!set) return "PIN이 아직 설정되지 않았습니다 (WRITE_PIN secret)";
  const key = "pinfail:dashboard";
  const rec = (await cacheGet(key, 15 * 60 * 1000)) as { n?: number } | null;
  const n = rec?.n ?? 0;
  if (n >= 5) return "PIN 5회 오류 — 15분 뒤 다시 시도하세요";
  if (String(pin ?? "") !== set) { await cacheSet(key, { n: n + 1 }); return `PIN이 올바르지 않습니다 (남은 시도 ${4 - n}회)`; }
  return null;
}

// ── 모델 광고 읽기: 세트/캠페인 설정 + 크리에이티브(페이지·문구·강화옵션) ──
const ADSET_FIELDS = "name,campaign_id,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_strategy,bid_amount,promoted_object,attribution_spec,destination_type,status,dsa_beneficiary,dsa_payor";
async function readModel(adId: string): Promise<Rec> {
  if (!/^\d{5,25}$/.test(adId)) throw new Error("ad_id 형식 오류");
  const key = `upload:model:v3:${adId}`;
  const cached = await cacheGet(key, 5 * 60 * 1000);
  if (cached) return cached as Rec;
  const ad = await graph(adId, { params: { fields: "id,name,adset_id,campaign_id,status,creative{id,name,object_story_spec,degrees_of_freedom_spec,contextual_multi_ads,url_tags,asset_feed_spec}" } });
  const adset = await graph(String(ad.adset_id), { params: { fields: ADSET_FIELDS } });
  const campaign = await graph(String(ad.campaign_id), { params: { fields: "name,objective,daily_budget,lifetime_budget,status" } });
  const cre = (ad.creative ?? {}) as Rec;
  const oss = (cre.object_story_spec ?? {}) as Rec;
  const ld = (oss.link_data ?? {}) as Rec, vd = (oss.video_data ?? {}) as Rec;
  const cta = ((ld.call_to_action ?? vd.call_to_action ?? {}) as Rec);
  const ctaVal = (cta.value ?? {}) as Rec;
  const text = {
    message: String(ld.message ?? vd.message ?? ""),
    title: String(ld.name ?? vd.title ?? ""),
    description: String(ld.description ?? vd.link_description ?? ""),
    link: String(ld.link ?? ctaVal.link ?? ""),
    cta: String(cta.type ?? "LEARN_MORE"),
  };
  const tg = (adset.targeting ?? {}) as Rec;
  const geo = (tg.geo_locations ?? {}) as Rec;
  const body = {
    ad: { id: ad.id, name: ad.name, status: ad.status },
    adset: { id: ad.adset_id, ...adset },
    campaign: { id: ad.campaign_id, ...campaign },
    cbo: !!(campaign.daily_budget || campaign.lifetime_budget),
    creative: { id: cre.id, page_id: oss.page_id ?? null, instagram_user_id: oss.instagram_user_id ?? oss.instagram_actor_id ?? null,
      degrees_of_freedom_spec: cre.degrees_of_freedom_spec ?? null, contextual_multi_ads: cre.contextual_multi_ads ?? null, url_tags: cre.url_tags ?? null, dynamic: !!cre.asset_feed_spec,
      kind: oss.video_data ? "video" : oss.link_data ? "image" : "other" },
    text,
    media: ld.image_hash ? { type: "image", image_hash: ld.image_hash } : vd.video_id ? { type: "video", video_id: vd.video_id, thumbnail_url: vd.image_url ?? null } : null,
    summary: {
      countries: (geo.countries as string[]) ?? [], age: `${tg.age_min ?? "?"}~${tg.age_max ?? "?"}`,
      genders: (tg.genders as number[]) ?? [], optimization_goal: adset.optimization_goal, bid_strategy: adset.bid_strategy,
      daily_budget: Number(adset.daily_budget ?? 0), campaign_daily_budget: Number(campaign.daily_budget ?? 0),
    },
  };
  await cacheSet(key, body);
  return body;
}

// ── 광고세트 복제 (예산·이름·상태만 새로) ──
const VALIDATE = { execution_options: JSON.stringify(["validate_only"]) };
async function createAdset(model: Rec, name: string, budget: number, status: string, validate = false): Promise<string> {
  const src = model.adset as Rec;
  const p: Record<string, string> = { name, campaign_id: String(src.campaign_id), status, ...(validate ? VALIDATE : {}) };
  if (!model.cbo) p.daily_budget = String(budget);
  for (const k of ["optimization_goal", "billing_event", "bid_strategy", "bid_amount", "destination_type", "dsa_beneficiary", "dsa_payor"]) {
    if (src[k] !== undefined && src[k] !== null && src[k] !== "") p[k] = String(src[k]);
  }
  const tg = { ...((src.targeting ?? {}) as Rec) };
  if (Array.isArray(tg.instagram_positions)) {   // 모델 세트에 남아 있는 지원 중단 위치는 빼야 생성됨 (실측: explore)
    tg.instagram_positions = (tg.instagram_positions as string[]).filter((x) => x !== "explore");
  }
  p.targeting = JSON.stringify(tg);
  for (const k of ["promoted_object", "attribution_spec"]) {
    if (src[k] !== undefined && src[k] !== null) p[k] = JSON.stringify(src[k]);
  }
  const r = await graph(`${ACCOUNT}/adsets`, { method: "POST", params: p });
  return String(r.id);
}

async function createCreative(model: Rec, name: string, media: Rec, text: Rec, validate = false): Promise<string> {
  const cre = model.creative as Rec;
  const cta = { type: String(text.cta || "LEARN_MORE"), value: { link: String(text.link) } };
  const oss: Rec = { page_id: cre.page_id };
  if (cre.instagram_user_id) oss.instagram_user_id = cre.instagram_user_id;
  if (media.type === "video") {
    oss.video_data = { video_id: media.video_id, image_url: media.thumbnail_url, message: text.message, call_to_action: cta,
      ...(text.title ? { title: text.title } : {}), ...(text.description ? { link_description: text.description } : {}) };
  } else {
    oss.link_data = { image_hash: media.image_hash, link: text.link, message: text.message, call_to_action: cta,
      ...(text.title ? { name: text.title } : {}), ...(text.description ? { description: text.description } : {}) };
  }
  const p: Record<string, string> = { name, object_story_spec: JSON.stringify(oss), ...(validate ? VALIDATE : {}) };
  if (cre.degrees_of_freedom_spec) {   // 실측: 'standard_enhancements' 묶음 키는 v23에서 지원 중단 → 개별 기능만 그대로 복사
    const dof = JSON.parse(JSON.stringify(cre.degrees_of_freedom_spec)) as Rec;
    const feats = (dof.creative_features_spec ?? {}) as Rec;
    for (const k of Object.keys(feats)) if (/^standard_enhancements/.test(k)) delete feats[k];
    p.degrees_of_freedom_spec = JSON.stringify(dof);
  }
  if (cre.url_tags) p.url_tags = String(cre.url_tags);
  // '여러 광고주의 광고' — 광고 단위 설정. 안 보내면 Meta가 기본 ON으로 만들므로(실측) 모델 값을 명시, 모델에 없으면 OFF
  p.contextual_multi_ads = JSON.stringify(cre.contextual_multi_ads ?? { enroll_status: "OPT_OUT" });
  const r = await graph(`${ACCOUNT}/adcreatives`, { method: "POST", params: p });
  return String(r.id);
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "status";
  try {
    if (!checkDashKey(req) || !env("DASH_KEY")) return json({ error: "접근 권한이 없습니다 (x-dash-key)" }, 403);

    if (action === "status") return json({ token_set: !!env("META_WRITE_TOKEN"), pin_set: !!env("WRITE_PIN"), account: ACCOUNT });
    if (action === "model") return json(await readModel(url.searchParams.get("ad_id") ?? ""));
    if (action === "diagnose") {   // 쓰기 토큰이 페이지·인스타에 접근되는지 (크리에이티브 생성 전제조건)
      const adId = url.searchParams.get("ad_id") ?? "";
      const out: Rec = {};
      try { const r = await graph("me/permissions"); out.permissions = ((r.data ?? []) as Rec[]).filter((x) => x.status === "granted").map((x) => x.permission); } catch (e) { out.permissions = String((e as Error).message); }
      try { const r = await graph("me", { params: { fields: "id,name" } }); out.me = r; } catch (e) { out.me = String((e as Error).message); }
      try { out.app = await graph("app", { params: { fields: "id,name" } }); } catch (e) { out.app = String((e as Error).message); }   // 토큰을 발급한 앱 — 개발 모드면 크리에이티브 생성 거부
      if (adId) {
        const model = await readModel(adId); const cre = model.creative as Rec;
        try { out.page = await graph(String(cre.page_id), { params: { fields: "id,name" } }); } catch (e) { out.page = String((e as Error).message); }
        try { const r = await graph("me/accounts", { params: { fields: "id,name,tasks", limit: "100" } }); out.pages_assigned = (r.data ?? []) as Rec[]; } catch (e) { out.pages_assigned = String((e as Error).message); }
        if (cre.instagram_user_id) { try { out.instagram = await graph(String(cre.instagram_user_id), { params: { fields: "id,username" } }); } catch (e) { out.instagram = String((e as Error).message); } }
      }
      return json(out);
    }
    if (action === "validate") {
      const model = await readModel(url.searchParams.get("ad_id") ?? "");
      const media = model.media as Rec | null;
      if (!media) return json({ error: "모델 광고의 미디어를 읽지 못했습니다" }, 400);
      const out: Rec = {};
      const s = model.summary as Rec;
      try { await createAdset(model, "validate_only", Number(s.daily_budget) || MIN_BUDGET, "PAUSED", true); out.adset = "ok"; } catch (e) { out.adset = String((e as Error).message); }
      try { await createCreative(model, "validate_only", media, model.text as Rec, true); out.creative = "ok"; } catch (e) { out.creative = String((e as Error).message); }
      try {
        await graph(`${ACCOUNT}/ads`, { method: "POST", params: { name: "validate_only", adset_id: String((model.adset as Rec).id), creative: JSON.stringify({ creative_id: (model.creative as Rec).id }), status: "PAUSED", ...VALIDATE } });
        out.ad = "ok";
      } catch (e) { out.ad = String((e as Error).message); }
      return json(out);
    }
    if (action === "video_status") {
      const id = url.searchParams.get("video_id") ?? "";
      if (!/^\d{5,25}$/.test(id)) return json({ error: "video_id 형식 오류" }, 400);
      const v = await graph(id, { params: { fields: "status" } });
      const st = (v.status ?? {}) as Rec;
      const ready = st.video_status === "ready";
      let thumbnail_url: string | null = null;
      if (ready) {
        const t = await graph(`${id}/thumbnails`, { params: { fields: "uri,is_preferred" } });
        const list = (t.data ?? []) as Rec[];
        thumbnail_url = String((list.find((x) => x.is_preferred) ?? list[0])?.uri ?? "") || null;
      }
      return json({ ready, video_status: st.video_status ?? null, progress: st.processing_progress ?? null, thumbnail_url });
    }

    if (req.method !== "POST") return json({ error: "POST 필요" }, 405);
    // ── 쓰기: JSON 또는 multipart — 둘 다 pin 필수 ──
    const isForm = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
    const form = isForm ? await req.formData() : null;
    const body: Rec = form ? Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) : await req.json();
    const pinErr = await checkPin(body.pin);
    if (pinErr) return json({ error: pinErr }, 403);

    if (action === "verify") return json({ ok: true });

    if (action === "image") {
      const file = form?.get("file");
      if (!(file instanceof File)) return json({ error: "file 필요" }, 400);
      const fd = new FormData(); fd.append("filename", file, file.name);
      const r = await graph(`${ACCOUNT}/adimages`, { form: fd });
      const images = (r.images ?? {}) as Record<string, Rec>;
      const first = Object.values(images)[0];
      if (!first?.hash) return json({ error: "이미지 해시를 받지 못했습니다" }, 500);
      return json({ image_hash: first.hash, url: first.url ?? null });
    }
    if (action === "video_start") {
      const size = Number(body.file_size ?? 0);
      if (!size) return json({ error: "file_size 필요" }, 400);
      const r = await graph(`${ACCOUNT}/advideos`, { method: "POST", params: { upload_phase: "start", file_size: String(size) } });
      return json({ video_id: r.video_id, session_id: r.upload_session_id, start_offset: Number(r.start_offset), end_offset: Number(r.end_offset) });
    }
    if (action === "video_chunk") {
      const chunk = form?.get("chunk");
      if (!(chunk instanceof File)) return json({ error: "chunk 필요" }, 400);
      const fd = new FormData();
      fd.append("upload_phase", "transfer"); fd.append("upload_session_id", String(body.session_id)); fd.append("start_offset", String(body.start_offset));
      fd.append("video_file_chunk", chunk, "chunk");
      const r = await graph(`${ACCOUNT}/advideos`, { form: fd });
      return json({ start_offset: Number(r.start_offset), end_offset: Number(r.end_offset) });
    }
    if (action === "video_finish") {
      const r = await graph(`${ACCOUNT}/advideos`, { method: "POST", params: { upload_phase: "finish", upload_session_id: String(body.session_id), title: String(body.title ?? "") } });
      return json({ ok: r.success !== false });
    }

    if (action === "create") {
      const model = await readModel(String(body.model_ad_id ?? ""));
      const name = String(body.name ?? "").trim().slice(0, 200);
      const budget = Math.round(Number(body.budget ?? 0));
      const status = body.status === "ACTIVE" ? "ACTIVE" : "PAUSED";
      const media = (body.media ?? {}) as Rec, text = (body.text ?? {}) as Rec;
      if (!name) return json({ error: "이름 필요" }, 400);
      if (!model.cbo && (budget < MIN_BUDGET || budget > MAX_BUDGET)) return json({ error: `일예산은 ${MIN_BUDGET.toLocaleString()}~${MAX_BUDGET.toLocaleString()}원 사이여야 합니다` }, 400);
      if (media.type === "video" ? !(media.video_id && media.thumbnail_url) : !media.image_hash) return json({ error: "미디어 정보 부족" }, 400);
      if (!String(text.link ?? "").startsWith("http")) return json({ error: "웹사이트 URL이 필요합니다" }, 400);
      if (!(model.creative as Rec).page_id) return json({ error: "모델 광고에서 페이지 ID를 읽지 못했습니다" }, 400);

      const adset_id = await createAdset(model, name, budget, status);
      const creative_id = await createCreative(model, name, media, text);
      // 광고는 항상 활성 — 일시중지 모드는 세트만 멈춤(세트가 꺼져 있으면 지출 없음). 사용자가 세트만 켜면 바로 게재.
      const ad = await graph(`${ACCOUNT}/ads`, { method: "POST", params: { name, adset_id, creative: JSON.stringify({ creative_id }), status: "ACTIVE" } });
      return json({ adset_id, creative_id, ad_id: ad.id });
    }
    return json({ error: `알 수 없는 action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
