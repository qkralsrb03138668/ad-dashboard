// 우리 서버 함수 호출 도우미 (점검·분석용) — 이 폴더의 config.js(연동 키)를 읽어 헤더로만 보내고 화면에 찍지 않는다.
//   import { call } from './scripts/api.mjs';  const r = await call('meta-ads', { action: 'usage' });  → { status, body }
import fs from 'node:fs';
const s = fs.readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const pick = k => (s.match(new RegExp(k + "\\s*:\\s*['\"]([^'\"]+)")) || [])[1];
const URL_ = pick('SUPABASE_URL'), ANON = pick('SUPABASE_ANON_KEY'), KEY = pick('DASH_KEY');
export async function call(fn, params, { key = true, extra = {}, body } = {}) {
  const init = { headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, ...(key ? { 'x-dash-key': KEY } : {}), ...extra } };
  if (body) { init.method = 'POST'; init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const r = await fetch(`${URL_}/functions/v1/${fn}?` + new URLSearchParams(params), init);
  const text = await r.text(); let b; try { b = JSON.parse(text); } catch { b = { _raw: text.slice(0, 120) }; }
  return { status: r.status, body: b };
}
