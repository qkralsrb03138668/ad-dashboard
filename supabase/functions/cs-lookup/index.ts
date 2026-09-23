// ═══════════════════════════════════════════════
// CS 주문조회 API — cs-lookup.html 전용 (카카오 상담톡 답변용, 조회만 함·수정 없음)
//   POST { action, ... }  헤더 x-cs-code = 초대코드(CS_CODE secret)
//   ping                 → { ok }
//   search { q }         → { kind, orders:[...] }   q = 전화번호 | 주문번호 | 주문자 이름 (최근 3개월)
//   delays               → { articles:[...] } | { error }   배송지연 게시판 글 (CS_BOARD_NO), 5분 캐시
//   stock { product_no } → { variants:[{option, stock, selling, ...}] }  카페24 옵션별 재고
//   boards               → { boards }                       게시판 번호 찾기용 (셋업 때 한 번)
//   GET ?action=overlay&code=<초대코드> → 셀메이트 위 조회창 스크립트(cs_assets.overlay, 공개 저장소 밖) — 상담원 북마크가 <script src>로 받아감
// secrets: CS_CODE(초대코드), CS_BOARD_NO(배송지연 게시판 번호), CAFE24_*(판매성과와 공유)
// 배포: ./deploy-cs-lookup.sh <초대코드> <게시판번호>
// ═══════════════════════════════════════════════
import { CORS_HEADERS, dbRest } from "../_shared/util.ts";
import { API_BASE, apiGet, getAccessToken } from "../_shared/cafe24.ts";

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
