// ═══════════════════════════════════════════════
// CS 주문조회 API — cs-lookup.html 전용 (카카오 상담톡 답변용, 조회만 함·수정 없음)
//   POST { action, ... }  헤더 x-cs-code = 초대코드(CS_CODE secret)
//   ping                 → { ok }
//   search { q }         → { kind, orders:[...] }   q = 전화번호 | 주문번호 | 주문자 이름 (최근 3개월)
//   delays               → { articles:[...] } | { error }   배송지연 게시판 글 (CS_BOARD_NO), 5분 캐시
//   stock { product_no } → { variants:[{option, stock, selling, ...}] }  카페24 옵션별 재고
//   boards               → { boards }                       게시판 번호 찾기용 (셋업 때 한 번)
//   status               → { kakao:{n,err,at}, naver:{...} }  CS 진행상황판(cs-board.html)용
//   record { chats:[{id,a:담당자id,m,w}], names:{담당자id:이름} } → 오늘 바뀐 카카오 채팅들 → 새로 시작된 상담만 'daily:kakao:<날짜>'에 누적 ({seed:true}면 먼저 seed)
//   seed { chats:[{id,a}] } → 최근 60일 채팅의 현재 담당자를 'kakao:ledger'에 기준(=자정 담당자)으로 저장 (처음 한 번, 셈 없음)
//   lease { src, id }    → { ok } 탭·PC가 여러 개여도 수집은 한 곳만 (마지막 갱신 2분 반 안이면 다른 id는 거절)
//   pick { chat, pick, rank, top } → 카카오 답변 패널에서 직원이 고른 후보 기록 ('picks:<날짜>' 배열, 하루 2000개까지) — 적중률 보려고
//   diag { src, kind, html } → 화면 구조 보고(고객 글은 지운 뼈대) 'diag:<src>:<kind>'에 저장 — 내가 직접 못 여는 화면(네이버페이센터) 파악용
//   favs / favs-save { favs:[{name,text}] } → 카카오 '자주 쓰는 답변' 사본 (카카오 패널이 저장, 네이버 패널이 읽음 — 네이버 화면에선 카카오 목록을 직접 못 읽어서)
//   qa-add { rows:[{src, ref, asked_at(ms), q, a, fav}] } → 상담 데이터(cs_qa)에 추가 (같은 src·ref·asked_at은 건너뜀) + 1년 지난 줄 삭제
//   similar { text, n } → 비슷한 과거 질문 n개 [{q, a, asked_at, src, score}] — 글자 2개씩 묶음(bigram) TF-IDF 코사인, 목록은 함수 메모리에 10분 캐시
//   records              → { days:[{day, kakao:{담당자:건수}, naver:건수}] }  CS 처리 기록(cs-record.html)용
//   GET ?action=overlay&code=<초대코드> → 셀메이트 위 조회창 스크립트(cs_assets.overlay, 공개 저장소 밖) — 상담원 북마크가 <script src>로 받아감
//   GET ?action=push&code=&src=kakao|naver&n=&err=[&ids=네이버 미답변 문의번호들] → 상황판 북마크가 카카오 10초·네이버 1분마다 보내는 미답변 수 (cs_assets 'status:<src>'에 저장)
// secrets: CS_CODE(초대코드), CS_BOARD_NO(배송지연 게시판 번호), CAFE24_*(판매성과와 공유)
// 배포: ./deploy-cs-lookup.sh <초대코드> <게시판번호>
// ═══════════════════════════════════════════════
import { CORS_HEADERS, dbRest } from "../_shared/util.ts";
import { API_BASE, apiGet, getAccessToken } from "../_shared/cafe24.ts";
import { kakaoStep } from "./kakao-step.ts";

const H = { ...CORS_HEADERS, "Access-Control-Allow-Headers": CORS_HEADERS["Access-Control-Allow-Headers"] + ", x-cs-code" };
const j = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...H, "Content-Type": "application/json" } });
type Row = Record<string, any>;

const kst = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const ORDER_FIELDS = "order_id,order_date,member_id,payment_method_name,paid,items,receivers,buyer";   // 주문자 이름·번호는 embed=buyer 안에 옴

async function orders(qs: string, token: string): Promise<Row[]> {
  const r = await apiGet(`${API_BASE}/admin/orders?embed=items,receivers,buyer&fields=${ORDER_FIELDS}&limit=50&${qs}`, token);
  return (r.orders ?? []) as Row[];
}

// 응답을 화면이 쓰기 좋은 모양으로 — 개인정보는 필요한 것만
function slim(o: Row): Row {
  const rc = ((o.receivers ?? []) as Row[])[0] ?? {};
  const by = (o.buyer ?? {}) as Row;
  return {
    order_id: o.order_id, order_date: o.order_date, member_id: o.member_id ?? "",
    buyer_name: by.name ?? "", buyer_cellphone: by.cellphone ?? "", paid: o.paid ?? "", payment: [].concat(o.payment_method_name ?? []).join("+"),   // 배열로 옴 (예: ["선불금","쿠폰"])
    receiver: { name: rc.name ?? "", cellphone: rc.cellphone ?? "", address: [rc.address1, rc.address2].filter(Boolean).join(" "), message: rc.shipping_message ?? "" },
    items: ((o.items ?? []) as Row[]).map((it) => ({
      product_no: it.product_no, product_name: it.product_name ?? "", option: it.option_value ?? "", qty: it.quantity ?? 1,
      status: it.order_status ?? "", status_text: it.order_status_text ?? "",
      carrier: it.shipping_company_name ?? "", tracking: it.tracking_no ?? "", shipped_date: it.shipped_date ?? "",
    })),
  };
}

async function search(raw: string): Promise<unknown> {
  const q = String(raw ?? "").trim();
  if (!q) throw new Error("검색어를 입력하세요");
  const token = await getAccessToken();
  const end = kst(new Date()), start = kst(new Date(Date.now() - 89 * 86400_000));   // 카페24 한도: 한 번에 3개월
  const range = `start_date=${start}&end_date=${end}`;
  let kind: string, rows: Row[] = [];
  if (/^\d{8}-\d{7}$/.test(q)) {                              // 주문번호 20260901-0001234
    kind = "order_id";
    rows = await orders(`order_id=${q}`, token);
  } else if (/^[\d\s-]{9,14}$/.test(q)) {                       // 전화번호 → 010-1234-5678 로 정규화
    kind = "phone";
    const d = q.replace(/\D/g, "");
    if (!/^01\d{8,9}$/.test(d)) throw new Error("휴대폰 번호 형식이 아닙니다 (예: 010-1234-5678)");
    const p = d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    // 카페24 주문 목록 필터: buyer_cellphone 만 동작한다. receiver_cellphone 은 무시되고 최신 50건이 그대로 와서(2026-09-23 실사고: 다른 고객 주문이 나옴) 쓰지 않는다.
    // 혹시 필터가 무시돼도 다른 고객이 안 나오게 주문자·받는분 번호로 한 번 더 거른다.
    const same = (v: unknown) => String(v ?? "").replace(/\D/g, "") === d;
    const hit = (o: Row) => same(o.buyer?.cellphone) || same(o.buyer?.phone) || ((o.receivers ?? []) as Row[]).some((r) => same(r.cellphone) || same(r.phone));
    rows = (await orders(`${range}&buyer_cellphone=${p}`, token)).filter(hit);
  } else if (/^\d{16}$/.test(q)) {                              // 네이버페이 주문번호 (네이버 고객문의 패널) — 카페24 market_order_no
    kind = "naver";
    rows = await orders(`${range}&market_order_no=${q}`, token);
    if (rows.length > 3) rows = [];   // 필터가 무시되면 최신 주문들이 통째로 옴 → 다른 고객 주문을 보여주지 않게 버림
  } else {                                                      // 이름
    kind = "name";
    if (q.length > 20) throw new Error("검색어가 너무 깁니다");
    rows = await orders(`${range}&buyer_name=${encodeURIComponent(q)}`, token);
  }
  rows.sort((x, y) => String(y.order_date).localeCompare(String(x.order_date)));
  return { kind, since: start, orders: rows.map(slim) };
}

// 배송지연 게시판 — 5분 캐시 (인스턴스 메모리; 상담원이 연달아 조회해도 카페24를 매번 부르지 않게)
let delayCache: { at: number; data: unknown } | null = null;
// 지연 리스트 본문 → 행마다 "상품명 | 옵션 | 출고예정일" 한 줄.
//   실제 글(2026-09)은 <div class="row"><div class="cell name">…</div><div class="cell option">…</div><div class="cell date">…</div></div> 구조.
//   <table>로 바꿔 써도 동작하게 tr/td도 같이 처리. <style> 블록은 버림.
const cell = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const strip = (html: string) => String(html ?? "")
  .replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<tr[\s\S]*?<\/tr>/gi, (row) => row.split(/<\/t[dh]>/i).map(cell).filter(Boolean).join(" | ") + "\n")
  .replace(/<div class="row[^>]*>/gi, "\n").replace(/<div class="cell[^>]*>/gi, " | ")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .split("\n").map((l) => l.replace(/\s*\|\s*/g, " | ").replace(/^\s*\|\s*/, "").trim()).filter(Boolean).join("\n");
async function delays(): Promise<unknown> {
  if (delayCache && Date.now() - delayCache.at < 5 * 60_000) return delayCache.data;
  const no = Deno.env.get("CS_BOARD_NO") ?? "";
  if (!/^\d+$/.test(no)) return { error: "CS_BOARD_NO(배송지연 게시판 번호)가 등록되지 않았습니다 — deploy-cs-lookup.sh 참고" };
  const token = await getAccessToken();
  let data: unknown;
  try {
    const r = await apiGet(`${API_BASE}/admin/boards/${no}/articles?is_display=T&limit=100`, token);
    const articles = ((r.articles ?? []) as Row[]).map((a) => ({
      no: a.article_no, title: String(a.title ?? ""), text: strip(a.content).slice(0, 8000), date: String(a.created_date ?? "").slice(0, 10),
      product_no: a.product_no ?? null, product_name: a.product_name ?? "",
    }));
    data = { board_no: Number(no), articles };
  } catch (e) {
    const m = String((e as Error).message ?? e);
    data = { error: /403|scope|권한/i.test(m) ? "게시판 읽기 권한(mall.read_community)이 없습니다 — 카페24 개발자센터 앱 권한에 '게시판 조회'를 추가하고 cafe24-oauth?action=start 로 다시 인증하세요" : m };
    return data;   // 실패는 캐시하지 않음
  }
  delayCache = { at: Date.now(), data };
  return data;
}

// cs_assets 한 줄을 JSON으로 읽고 쓰기 (상황판 상태·처리 기록)
async function getAsset(key: string): Promise<Row | null> {
  const r = await dbRest(`cs_assets?key=eq.${encodeURIComponent(key)}&select=body`);
  const row = r.ok ? (await r.json())[0] : null;
  return row ? JSON.parse(row.body) : null;
}
async function putAsset(key: string, body: unknown): Promise<void> {
  await dbRest("cs_assets?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key, body: JSON.stringify(body), updated_at: new Date().toISOString() }) });
}
// 카카오 '오늘 처리' = 오늘 새로 시작된 상담, 담당자별 — 판정 규칙은 kakao-step.ts.
//   '어제 고객 말에 답 못 한 채 자정을 넘겼나(m)'·'오늘 고객이 썼나(w)'는 북마크가 채팅 기록(누가·언제)에서 계산해 보냄 → 탭이 꺼져 있던 동안 것도 다음 실행 때 따라잡음.
//   카카오 데이터에 담당자 지정 시각은 없어서 '자정 담당자'만 'kakao:ledger' {채팅id: Led}에 기억 (탭이 밤새 꺼져 있으면 마지막으로 본 담당자로 대신).
type Snap = { id: string; a: number; m: number; w: number };
const bit = (x: unknown) => x === 0 || x === 1;
const listOk = (x: unknown, f: (c: Row) => boolean) => Array.isArray(x) && x.length <= 3000 && x.every((c) => c && typeof c.id === "string" && c.id.length <= 40 && Number.isInteger(c.a) && f(c));
const namesOk = (o: unknown) => o && typeof o === "object" && Object.keys(o).length <= 200 && Object.entries(o).every(([k, x]) => k.length <= 20 && typeof x === "string" && x.length <= 40);
async function seedKakao(op: Row): Promise<unknown> {
  if (!listOk(op.chats, () => true)) throw new Error("bad seed");
  const L = (await getAsset("kakao:ledger")) ?? {};
  for (const c of op.chats) L[c.id] ??= [c.a, "0", "", c.a];   // 날짜 "0" → 오늘 첫 판정 때 이 담당자를 자정 담당자로 씀
  await putAsset("kakao:ledger", L);
  return { ok: true, n: Object.keys(L).length };
}
async function recordKakao(op: Row): Promise<unknown> {
  if (!listOk(op.chats, (c) => bit(c.m) && bit(c.w)) || !namesOk(op.names ?? {})) throw new Error("bad record");
  const L = await getAsset("kakao:ledger");
  if (!L) return { seed: true };
  const today = kst(new Date()), key = `daily:kakao:${today}`;
  const cur = (await getAsset(key)) ?? { chats: {}, names: {} };
  for (const c of op.chats as Snap[]) {
    const { p, count } = kakaoStep(L[c.id], c, today);
    if (count) cur.chats[c.id] = c.a;   // 오늘 센 채팅 — 담당자가 바뀌면 새 담당자로
    L[c.id] = p;
  }
  const cut = kst(new Date(Date.now() - 60 * 86400_000));
  for (const id in L) if (L[id][1] !== "0" && L[id][1] < cut) delete L[id];   // 60일 넘게 조용한 채팅은 잊음 → 다시 오면 처음 보는 방
  Object.assign(cur.names, op.names ?? {});
  await putAsset("kakao:ledger", L);
  await putAsset(key, cur);
  return { ok: true, n: Object.keys(cur.chats).length };
}
// 네이버: 1분 전 미답변 목록에 있던 문의번호가 지금 없으면 = 답변 처리됨 → 오늘 기록에 추가.
// ponytail: 목록 한 페이지에 미답변이 다 보일 때(번호 수 == 총 N건)만 셈. 미답변이 한 페이지를 넘으면 그동안의 답변은 못 셈 — 그런 날이 잦으면 네이버 목록 표시 개수를 늘릴 것.
async function trackNaver(ids: string[], n: number): Promise<void> {
  const prev = await getAsset("status:naver");
  if (!prev?.ids || prev.ids.length !== prev.n || ids.length !== n) return;
  const gone = (prev.ids as string[]).filter((x) => !ids.includes(x));
  if (!gone.length) return;
  const key = `daily:naver:${kst(new Date())}`;
  const cur = (await getAsset(key)) ?? { ids: [] };
  cur.ids = [...new Set([...cur.ids, ...gone])];
  await putAsset(key, cur);
}
async function records(): Promise<unknown> {
  const r = await dbRest("cs_assets?key=like.daily:*&select=key,body&order=key.desc&limit=800");
  const days: Record<string, Row> = {};
  for (const x of (r.ok ? await r.json() : []) as Row[]) {
    const [, src, day] = x.key.split(":"), b = JSON.parse(x.body);
    const d = days[day] ??= { day, kakao: {}, naver: 0 };
    if (src === "naver") d.naver = b.ids.length;
    else for (const a of Object.values(b.chats) as number[]) { const nm = a ? (b.names[a] ?? `담당자 ${a}`) : "미지정"; d.kakao[nm] = (d.kakao[nm] ?? 0) + 1; }
  }
  return { days: Object.values(days).sort((a, b) => b.day.localeCompare(a.day)) };
}

// ── 상담 데이터 (cs_qa) ──
// ponytail: 전부 메모리에 올려 매번 훑음 — 1년치 수천 건이면 충분. 수만 건이 되면 DB 쪽 검색(pg_trgm·벡터)으로.
type QA = { id: number; src: string; asked_at: string; q: string; a: string; fav: string | null; v: Map<string, number>; n: number };
let qaCache: { at: number; rows: QA[]; idf: Map<string, number> } | null = null;
const grams = (t: string) => { const s = String(t).replace(/\[[^\]]*\]|https?:\S+/g, " ").replace(/[^가-힣a-zA-Z0-9]+/g, ""); const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
async function qaLoad(): Promise<NonNullable<typeof qaCache>> {
  if (qaCache && Date.now() - qaCache.at < 10 * 60_000) return qaCache;
  const all: Row[] = [];
  for (let off = 0; off < 50_000; off += 1000) {
    const r = await dbRest(`cs_qa?select=id,src,asked_at,q,a,fav&order=asked_at.desc&limit=1000&offset=${off}`);
    const part = r.ok ? await r.json() : []; all.push(...part); if (part.length < 1000) break;
  }
  const df = new Map<string, number>(), rows: QA[] = all.map((x) => { const g = grams(x.q); g.forEach((_, k) => df.set(k, (df.get(k) ?? 0) + 1)); return { ...x, v: g, n: 0 } as QA; });
  const idf = new Map<string, number>(); df.forEach((c, k) => idf.set(k, Math.log(1 + rows.length / c)));
  rows.forEach((r) => { let s = 0; r.v.forEach((c, k) => { s += (c * (idf.get(k) ?? 0)) ** 2; }); r.n = Math.sqrt(s); });
  qaCache = { at: Date.now(), rows, idf };
  return qaCache;
}
async function similar(text: string, n: number): Promise<unknown> {
  const { rows, idf } = await qaLoad(), qv = grams(text);
  let qn = 0; qv.forEach((c, k) => { qn += (c * (idf.get(k) ?? 0)) ** 2; }); qn = Math.sqrt(qn);
  if (!qn) return { items: [] };
  const scored = rows.map((r) => { let dot = 0; qv.forEach((c, k) => { const d = r.v.get(k); if (d) { const w = idf.get(k) ?? 0; dot += c * w * d * w; } }); return { r, s: r.n ? dot / (qn * r.n) : 0 }; })
    .filter((x) => x.s >= 0.2).sort((a, b) => b.s - a.s);
  const seen = new Set<string>(), items: Row[] = [];
  for (const { r, s } of scored) { const k = r.a.slice(0, 60); if (seen.has(k)) continue; seen.add(k); items.push({ q: r.q, a: r.a, asked_at: r.asked_at, src: r.src, fav: r.fav, score: Math.round(s * 100) }); if (items.length >= n) break; }
  return { items, total: rows.length };
}
async function qaAdd(op: Row): Promise<unknown> {
  const rows = op.rows, str = (x: unknown, m: number) => typeof x === "string" && x.length > 0 && x.length <= m;
  if (!Array.isArray(rows) || rows.length > 500 || !rows.every((x: Row) => x && ["kakao", "naver"].includes(x.src) && str(x.ref, 40) && Number.isFinite(x.asked_at) && str(x.q, 3000) && str(x.a, 4000) && (x.fav == null || str(x.fav, 80)))) throw new Error("bad qa rows");
  if (rows.length) {
    const r = await dbRest("cs_qa?on_conflict=src,ref,asked_at", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(rows.map((x: Row) => ({ src: x.src, ref: x.ref, asked_at: new Date(x.asked_at).toISOString(), q: x.q, a: x.a, fav: x.fav ?? null }))) });
    if (!r.ok) throw new Error("qa 저장 실패: " + (await r.text()).slice(0, 200));
  }
  await dbRest(`cs_qa?asked_at=lt.${encodeURIComponent(new Date(Date.now() - 365 * 86400_000).toISOString())}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });   // 보관 1년
  qaCache = null;
  return { ok: true, n: rows.length };
}

async function run(op: Row): Promise<unknown> {
  switch (op?.action) {
    case "ping": return { ok: true };
    case "search": return await search(op.q);
    case "delays": return await delays();
    case "stock": {   // 카페24 옵션별 재고 (셀메이트가 카페24로 재고를 내려보내고 있으면 이게 곧 셀메이트 재고)
      const no = Number(op.product_no); if (!Number.isInteger(no) || no <= 0) throw new Error("bad product_no");
      const r = await apiGet(`${API_BASE}/admin/products/${no}/variants?embed=inventories`, await getAccessToken());
      const variants = ((r.variants ?? []) as Row[]).map((v) => ({
        code: v.variant_code, option: ((v.options ?? []) as Row[]).map((x) => `${x.name}=${x.value}`).join(", "),
        display: v.display, selling: v.selling, use_inventory: v.use_inventory,
        stock: v.inventories?.stock_quantity ?? v.quantity ?? null, safety: v.inventories?.safety_stock_quantity ?? null,
      }));
      return { product_no: no, variants };
    }
    case "status": {
      const r = await dbRest("cs_assets?key=like.status:*&select=key,body,updated_at");
      const out: Row = {};
      for (const x of (r.ok ? await r.json() : []) as Row[]) out[x.key.slice(7)] = { ...JSON.parse(x.body), at: x.updated_at };
      return out;
    }
    case "lease": {
      if (!["kakao", "naver"].includes(op.src) || typeof op.id !== "string" || op.id.length > 20) throw new Error("bad lease");
      const key = `lease:${op.src}`, cur = await getAsset(key), now = Date.now();
      if (cur && cur.id !== op.id && now - cur.at < 150_000) return { ok: false };
      await putAsset(key, { id: op.id, at: now });
      return { ok: true };
    }
    case "pick": {
      const str = (x: unknown, n: number) => typeof x === "string" && x.length <= n;
      if (!str(op.chat, 40) || !str(op.pick, 80) || !Number.isInteger(op.rank) || !Array.isArray(op.top) || op.top.length > 5 || !op.top.every((t: unknown) => str(t, 80))) throw new Error("bad pick");
      const key = `picks:${kst(new Date())}`, cur = ((await getAsset(key)) ?? []) as Row[];
      if (cur.length < 2000) cur.push({ at: new Date().toISOString(), chat: op.chat, pick: op.pick, rank: op.rank, top: op.top });
      await putAsset(key, cur);
      return { ok: true };
    }
    case "diag": {
      if (!["naver", "kakao"].includes(op.src) || !/^[a-z0-9-]{1,20}$/.test(String(op.kind)) || typeof op.html !== "string") throw new Error("bad diag");
      await putAsset(`diag:${op.src}:${op.kind}`, { at: new Date().toISOString(), url: String(op.url ?? "").slice(0, 200), html: op.html.slice(0, 120_000) });
      return { ok: true };
    }
    case "favs": return { favs: (await getAsset("favs")) ?? [] };
    case "favs-save": {
      const f = op.favs;
      if (!Array.isArray(f) || !f.length || f.length > 100 || !f.every((x: Row) => x && typeof x.name === "string" && x.name.length <= 80 && typeof x.text === "string" && x.text.length <= 4000)) throw new Error("bad favs");
      await putAsset("favs", f.map((x: Row) => ({ name: x.name, text: x.text })));
      return { ok: true };
    }
    case "qa-add": return await qaAdd(op);
    case "similar": return await similar(String(op.text ?? "").slice(0, 2000), Math.min(5, Number(op.n) || 3));
    case "record": return await recordKakao(op);
    case "seed": return await seedKakao(op);
    case "records": return await records();
    case "boards": { const r = await apiGet(`${API_BASE}/admin/boards`, await getAccessToken()); return { boards: ((r.boards ?? []) as Row[]).map((b) => ({ board_no: b.board_no, name: b.board_name, type: b.board_type })) }; }
    default: throw new Error("unknown action");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });
  const code = Deno.env.get("CS_CODE") ?? "";
  if (!code) return j({ error: "CS_CODE secret not set" }, 500);
  if (req.method === "GET") {   // 북마크용 스크립트 — <script src>는 헤더를 못 붙이니 초대코드를 쿼리로 받는다
    const u = new URL(req.url);
    if (u.searchParams.get("action") === "push") {   // GET인 이유: 페이지가 fetch를 막으면 북마크가 <img>로 대신 보낼 수 있게
      const p = u.searchParams, src = p.get("src") ?? "", n = p.get("n") ?? "", idq = p.get("ids");
      if (p.get("code") !== code) return j({ error: "unauthorized" }, 401);
      if (!["kakao", "naver"].includes(src) || !/^\d{0,5}$/.test(n) || (idq !== null && !/^[\d,]{0,2000}$/.test(idq))) return j({ error: "bad params" }, 400);
      const ids = idq ? idq.split(",").filter(Boolean) : idq === "" ? [] : null;
      if (src === "naver" && ids && n !== "") await trackNaver(ids, Number(n));
      await putAsset(`status:${src}`, { n: n === "" ? null : Number(n), err: (p.get("err") ?? "").slice(0, 120), ...(ids ? { ids } : {}) });
      return j({ ok: true });
    }
    if (u.searchParams.get("action") !== "overlay") return j({ error: "unknown action" }, 400);
    if (u.searchParams.get("code") !== code) return new Response("alert('CS 조회: 초대코드가 맞지 않습니다. 북마크를 다시 만들어 주세요.')", { status: 401, headers: { ...H, "Content-Type": "application/javascript; charset=utf-8" } });
    const r = await dbRest("cs_assets?key=eq.overlay&select=body");
    const row = r.ok ? (await r.json())[0] : null;
    if (!row) return new Response("alert('CS 조회: 스크립트가 아직 올라가지 않았습니다 (deploy-cs-lookup.sh)')", { status: 404, headers: { ...H, "Content-Type": "application/javascript; charset=utf-8" } });
    return new Response(row.body, { headers: { ...H, "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" } });
  }
  if (req.headers.get("x-cs-code") !== code) return j({ error: "unauthorized" }, 401);
  let body: Row;
  try { body = await req.json(); } catch { return j({ error: "bad json" }, 400); }
  try { return j(await run(body)); }
  catch (e) { return j({ error: String((e as Error)?.message ?? e) }, 400); }
});
