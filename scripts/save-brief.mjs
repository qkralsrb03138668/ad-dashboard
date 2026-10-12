// 데일리 브리핑 JSON을 대시보드 '어제 광고 보고서' 메뉴에 저장 — shared_state `daily_briefs` { items: { 'YYYY-MM-DD': brief } }
//   node scripts/save-brief.mjs /tmp/daily-ad-brief.json [더.json …]
// 예약 작업 daily-ad-brief가 ArtifactData 저장 뒤에 부른다. 인증은 config.js DASH_KEY (daily-brief-data.mjs와 같음)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEP = 180;   // 날짜 수 — 브리핑 1건 3~5KB라 180일이어도 1MB 안 (shared_state 한도 2MB)
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfgSrc = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const cfg = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DASH_KEY'].map(k => [k, (cfgSrc.match(new RegExp(k + '\\s*:\\s*"([^"]*)"')) || [])[1] || '']));
const headers = { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, 'x-dash-key': cfg.DASH_KEY, 'content-type': 'application/json' };
async function call(params, body) {
  const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/client-log?` + new URLSearchParams(params), body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || ('HTTP ' + res.status));
  return j;
}

const briefs = process.argv.slice(2).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
if (!briefs.length || briefs.some(b => !/^\d{4}-\d{2}-\d{2}$/.test(b.date || ''))) { console.error('사용법: node scripts/save-brief.mjs <brief.json> — JSON에 date(YYYY-MM-DD) 필요'); process.exit(1); }
for (let tries = 0; tries < 3; tries++) {
  const cur = await call({ action: 'state_get', key: 'daily_briefs' });
  const items = { ...((cur.data && cur.data.items) || {}) };
  briefs.forEach(b => { items[b.date] = b; });
  const keep = Object.keys(items).sort().slice(-KEEP);
  const r = await call({ action: 'state_set' }, { key: 'daily_briefs', base: cur.ver || null, data: { items: Object.fromEntries(keep.map(d => [d, items[d]])) } });
  if (!r.conflict) { console.log(JSON.stringify({ ok: true, saved: briefs.map(b => b.date), total: keep.length })); process.exit(0); }
}
console.error('저장 충돌이 계속돼요 — 잠시 후 다시 실행하세요'); process.exit(1);
