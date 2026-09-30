// ═══════════════════════════════════════════════
// CS 주문조회 API — cs-lookup.html 전용 (카카오 상담톡 답변용, 조회만 함·수정 없음)
//   POST { action, ... }  헤더 x-cs-code = 초대코드(CS_CODE secret)
//   ping                 → { ok }
//   search { q }         → { kind, orders:[...] }   q = 전화번호 | 주문번호 | 주문자 이름 (최근 3개월)
//   delays               → { articles:[...] } | { error }   배송지연 게시판 글 (CS_BOARD_NO), 5분 캐시
//   stock { product_no } → { variants:[{option, stock, selling, ...}] }  카페24 옵션별 재고
//   boards               → { boards }                       게시판 번호 찾기용 (셋업 때 한 번)
//   status               → { kakao:{n,err,at}, naver:{...} }  CS 진행상황판(cs-board.html)용
//   record { chats:[{id,a:담당자id,r:답변함0/1}], names:{담당자id:이름} } → 오늘 바뀐 카카오 채팅들 → 새로 시작된 상담만 'daily:kakao:<날짜>'에 누적 ({seed:true}면 먼저 seed)
//   seed { chats:[...] }  → 최근 60일 채팅의 현재 상태를 'kakao:ledger'에 기준으로 저장 (처음 한 번, 셈 없음)
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
// 카카오 '오늘 처리' = 오늘 새로 시작된 상담, 담당자별 (2026-09-30 사용자 기준):
//   담당자가 없다가 오늘 지정됨 → 1건 | 전날 끝에 우리가 답해 둔(끝난) 채팅에 고객이 오늘 다시 문의 → 붙어 있는 담당자 1건 | 처음 보는 채팅방 + 담당자 → 1건
//   어제 고객 말에 답 못 하고 자정을 넘긴 채팅('이어지는 상담')은 오늘 하루 종일 안 셈. 이틀 이상 고객 말로 끝나 있던 방은 끝난 걸로 봄.
//   카카오 데이터에 지정 시각이 없어서, 채팅별 마지막 상태를 'kakao:ledger' {채팅id: Led}에 두고 1분마다 비교 — 판정은 kakao-step.ts
//   ponytail: 북마크 탭이 꺼져 있던 동안의 변화는 못 봄 — 상황판 카카오 탭을 업무시간 내내 켜 두는 전제.
type Snap = { id: string; a: number; r: number };
const snapOk = (x: unknown): x is Snap[] => Array.isArray(x) && x.length <= 3000 &&
  x.every((c) => c && typeof c.id === "string" && c.id.length <= 40 && Number.isInteger(c.a) && (c.r === 0 || c.r === 1));
const namesOk = (o: unknown) => o && typeof o === "object" && Object.keys(o).length <= 200 && Object.entries(o).every(([k, x]) => k.length <= 20 && typeof x === "string" && x.length <= 40);
async function seedKakao(op: Row): Promise<unknown> {   // 첫날 기준점: 지금 답 못 한 담당 채팅은 오늘 '이어지는 상담'으로 둠
  if (!snapOk(op.chats)) throw new Error("bad seed");
  const L = (await getAsset("kakao:ledger")) ?? {}, t = kst(new Date());
  for (const c of op.chats) L[c.id] ??= [c.a, c.r, t, c.a && !c.r ? "c" : "", c.a];
  await putAsset("kakao:ledger", L);
  return { ok: true, n: Object.keys(L).length };
}
async function recordKakao(op: Row): Promise<unknown> {
  if (!snapOk(op.chats) || !namesOk(op.names ?? {})) throw new Error("bad record");
  const L = await getAsset("kakao:ledger");
  if (!L) return { seed: true };
  const today = kst(new Date()), yday = kst(new Date(Date.now() - 86400_000)), key = `daily:kakao:${today}`;
  const cur = (await getAsset(key)) ?? { chats: {}, names: {} };
  for (const c of op.chats) {
    const { p, count } = kakaoStep(L[c.id], c, today, yday);
    if (count) cur.chats[c.id] = c.a;   // 오늘 센 채팅 — 담당자가 바뀌면 새 담당자로
    L[c.id] = p;
  }
  const cut = kst(new Date(Date.now() - 60 * 86400_000));
  for (const id in L) if (L[id][2] < cut) delete L[id];   // 60일 넘게 조용한 채팅은 잊음 → 다시 오면 새 상담
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
