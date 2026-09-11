// 문구 없는 등록 대기 소재의 상품 문구를 이 맥의 Claude Code(구독)로 생성해 상품에 고정 — API 결제 없이.
//   node scripts/gen-copy.mjs            → 대기 소재 중 문구·저장본 없는 상품만 생성 → product_copy 고정 + 해당 소재 문구 채움
//   node scripts/gen-copy.mjs --dry 2450 → 상품 2450 문구를 화면에만 출력 (저장 안 함)
// 인증: 이 폴더의 config.js(SUPABASE_URL·anon key·DASH_KEY). 지시문: supabase/functions/cafe24-perf/ad-copy-prompt.ts (서버와 동일)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfgSrc = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const cfg = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DASH_KEY'].map(k => [k, (cfgSrc.match(new RegExp(k + '\\s*:\\s*"([^"]*)"')) || [])[1] || '']));
if (!cfg.SUPABASE_URL || !cfg.DASH_KEY) { console.error('❌ config.js에 SUPABASE_URL·DASH_KEY가 필요합니다 (로컬 폴더에서만 실행)'); process.exit(1); }
const P = await import(path.join(root, 'supabase/functions/cafe24-perf/ad-copy-prompt.ts'));

const headers = { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, 'x-dash-key': cfg.DASH_KEY, 'Content-Type': 'application/json' };
async function api(fn, params, body) {
  const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/${fn}?` + new URLSearchParams(params), body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || ('HTTP ' + res.status));
  return j;
}
const SYSTEM = `${P.COPY_PROMPT_ORIGINAL}\n\n${P.COPY_LONG_RULES}\n\n${P.COPY_EXAMPLES_HUMAN}\n\n${P.COPY_EXAMPLE_LONG}`;

function generate(facts, url) {
  const prompt = `아래 상품의 광고 문구를 운영자 후기형(기본)으로 써줘. 상품 페이지(${url})를 WebFetch로 열어 컬러·옵션·후기·상세 이미지 속 텍스트를 확인하고, 카페24에서 받은 상품 정보도 근거로 써. 완성 카피만 출력하고 다른 말은 하지 마.\n\n[카페24 상품 정보]\n${facts}`;
  const out = execFileSync('claude', ['-p', prompt, '--model', 'claude-fable-5-1', '--effort', 'medium', '--output-format', 'text', '--allowedTools', 'WebFetch', '--append-system-prompt', SYSTEM], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });   // 모델: 사용자 지정 Fable 5.1 · 중간
  return P.tidyCopy(out);   // 빈 줄 하나 · 한 줄 18자 이내 (서버와 같은 규칙)
}

const dry = process.argv.includes('--dry');
const only = process.argv.filter(a => /^\d+$/.test(a)).map(Number);
let targets;   // [{product_no, product_name, creatives:[...]}]
if (only.length) {   // 지정 상품은 저장본이 있어도 다시 생성(덮어씀) + 그 상품의 대기 소재 문구도 갱신
  const { rows } = await api('meta-upload', { action: 'creatives_list', status: 'registered', limit: 500 });
  targets = only.map(no => ({ product_no: no, product_name: (rows.find(r => r.product_no === no) || {}).product_name || '', creatives: rows.filter(r => r.product_no === no) }));
}
else {
  const { rows } = await api('meta-upload', { action: 'creatives_list', status: 'registered', limit: 500 });
  const regen = rows.filter(r => r.product_no && r.regen);                          // 대시보드에서 '문구 다시 생성' 표시한 소재 → 저장본 있어도 새로
  const need = rows.filter(r => r.product_no && !r.regen && !(r.text && r.text.message));
  const byNo = new Map();
  const put = (r, force) => { if (!byNo.has(r.product_no)) byNo.set(r.product_no, { product_no: r.product_no, product_name: r.product_name, creatives: [], force: false }); const t = byNo.get(r.product_no); t.creatives.push(r); if (force) t.force = true; };
  for (const r of regen) put(r, true);
  for (const r of need) put(r, false);
  for (const t of byNo.values()) if (t.force) {   // 다시 생성하는 상품은 그 상품의 대기 소재 전부에 새 문구를 넣는다 (소재끼리 다른 문구가 되지 않게)
    for (const r of rows) if (r.product_no === t.product_no && !t.creatives.some(x => x.id === r.id)) t.creatives.push(r);
  }
  if (regen.length) console.log(`↻ 다시 생성 표시된 소재 ${regen.length}개 (상품 ${new Set(regen.map(r => r.product_no)).size}개)`);
  const plain = [...byNo.values()].filter(t => !t.force);
  if (plain.length) {
    const { rows: copies } = await api('cafe24-perf', { action: 'copy_get', product_nos: plain.map(t => t.product_no).join(',') });
    for (const c of copies) {   // 저장본이 이미 있으면 생성 없이 소재에 채우기만 (다시 생성 표시가 없는 경우)
      const t = byNo.get(c.product_no); if (!t || t.force) continue;
      for (const cr of t.creatives) await api('meta-upload', { action: 'creative_save' }, { id: cr.id, text: { ...c.text, link: cr.url || '' } });
      console.log(`↺ ${t.product_name} — 저장된 문구를 소재 ${t.creatives.length}개에 채움`);
      byNo.delete(c.product_no);
    }
  }
  targets = [...byNo.values()];
}
if (!targets.length) { console.log('✅ 문구가 필요한 대기 소재가 없어요'); process.exit(0); }
console.log(`▶ 생성할 상품 ${targets.length}개${dry ? ' (--dry: 저장 안 함)' : ''}`);
let ok = 0;
for (const t of targets) {
  try {
    const f = await api('cafe24-perf', { action: 'copy_facts', product_no: t.product_no });
    process.stdout.write(`… #${t.product_no} ${t.product_name || ''} 생성 중`);
    const message = generate(f.facts, f.url);
    console.log(` — ${message.length}자`);
    if (dry) { console.log('\n' + message + '\n'); continue; }
    const text = { message, title: '', description: '', cta: 'LEARN_MORE' };
    await api('cafe24-perf', { action: 'copy_save' }, { product_no: t.product_no, product_name: t.product_name, text });
    for (const cr of t.creatives) await api('meta-upload', { action: 'creative_save' }, { id: cr.id, text: { ...text, link: cr.url || f.url }, regen: false });
    ok++; console.log(`✓ 상품에 고정 + 소재 ${t.creatives.length}개에 채움`);
  } catch (e) { const m = String(e.message).split('\n')[0].replace(/^Command failed: claude .*$/, 'Claude Code 실행 실패 — 이 맥에서 claude 로그인 상태인지 확인하세요 (터미널에서 `claude` 한 번 실행)'); console.log(`\n✗ #${t.product_no}: ${m}`); }
}
console.log(`끝 — ${ok}/${targets.length}`);
