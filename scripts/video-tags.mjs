// 릴스 광고 영상을 프레임으로 뽑아 Claude가 보고 태그 → 계정 공유 상태 video_tags 에 저장 (2026-09-18)
//   node scripts/video-tags.mjs [개수=20] [--force] [--only <ad_id>]
//   1) 저장된 테스트 리포트(test_report)의 OFF·우수 소재 중 영상만 골라
//   2) Meta에서 원본 주소를 받아 내려받고 (meta-upload video_src)
//   3) 맥 내장 AVFoundation(scripts/frames.swift)으로 0~3초는 0.5초 간격, 이후 3초 간격 프레임 추출
//   4) Claude가 프레임을 순서대로 보고 훅·장면 구성·자막·사이즈 숫자·컷 전환을 JSON으로
//   결제 없음(이 맥의 Claude Code 구독). 영상 1개 약 30초, 3개씩 동시 처리
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runClaude } from './claude.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BIN = path.join(root, 'scripts/.bin/frames'), SRC = path.join(root, 'scripts/frames.swift');
const TMP = path.join(root, '.insight-tmp/video');
const cfgSrc = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const cfg = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DASH_KEY'].map(k => [k, (cfgSrc.match(new RegExp(k + '\\s*:\\s*"([^"]*)"')) || [])[1] || '']));
if (!cfg.SUPABASE_URL || !cfg.DASH_KEY) { console.error('❌ config.js에 SUPABASE_URL·DASH_KEY가 필요합니다'); process.exit(1); }
const headers = { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, 'x-dash-key': cfg.DASH_KEY, 'Content-Type': 'application/json' };
async function api(fn, params, body) {
  const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/${fn}?` + new URLSearchParams(params), body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(`${fn}/${params.action}: ` + (j.error || ('HTTP ' + res.status)));
  return j;
}
/* 프레임 추출기 — 없거나 소스가 더 새로우면 컴파일 (맥 명령줄 도구의 swiftc, 설치 불필요) */
function ensureBin() {
  const fresh = fs.existsSync(BIN) && fs.statSync(BIN).mtimeMs >= fs.statSync(SRC).mtimeMs;
  if (fresh) return;
  fs.mkdirSync(path.dirname(BIN), { recursive: true });
  execFileSync('xcrun', ['swiftc', '-O', '-o', BIN, SRC], { stdio: 'inherit' });
}
/* 훅 구간(0~3초)은 0.5초 간격, 그 뒤는 3초 간격 — 최대 14장 */
const frameTimes = len => {
  const t = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  for (let s = 6; s < (len || 30) && t.length < 14; s += 3) t.push(s);
  return t;
};
const SYS = `너는 여성 의류 쇼핑몰의 릴스 광고 소재를 분석하는 검수자다. 한 영상에서 시각 순서대로 뽑은 프레임들을 Read 도구로 모두 열어 본 뒤, 아래 JSON 객체 하나만 출력한다. 설명·코드펜스 없이 JSON만.
{"hook":"손 시연|텍스트 화면|정면 제품|착용 전신|착용 반신|비교|얼굴|기타","hook_desc":"첫 1초를 15자 이내로","scenes":[{"t":0,"kind":"시연|착용|비교|디테일|텍스트|기타","note":"12자 이내"}],"subtitles":[{"t":0,"text":"화면의 자막 그대로"}],"size_number":{"shown":true,"t":2.0,"text":"키 154 등"},"cuts":3,"motion":"정지컷 위주|보통|움직임 많음","face":false,"bg":"실내|야외|스튜디오|기타","summary":"이 영상의 구성 25자 이내"}
규칙: 자막은 프레임에 보이는 글자를 그대로 옮긴다(없으면 빈 배열). cuts는 장면이 바뀐 횟수. 사이즈 숫자는 키·몸무게·44~88 같은 숫자가 화면에 보일 때만 true. 안 보이는 것은 추측하지 말고 false·빈 값으로 둔다.`;

async function tagOne(ad) {
  const dir = path.join(TMP, ad.video_id);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const mp4 = path.join(dir, 'v.mp4');
  try {
    const src = await api('meta-upload', { action: 'video_src', video_id: ad.video_id });
    if (!src.source) throw new Error('원본 주소 없음' + (src.error ? ' — ' + src.error : ''));
    const r = await fetch(src.source); if (!r.ok) throw new Error('내려받기 HTTP ' + r.status);
    fs.writeFileSync(mp4, Buffer.from(await r.arrayBuffer()));
    const out = execFileSync(BIN, [mp4, dir, frameTimes(src.length).join(',')], { encoding: 'utf8' });
    const frames = out.split('\n').filter(l => l.endsWith('.jpg'));
    const dur = Number((out.match(/duration=([\d.]+)/) || [])[1]) || src.length || 0;
    if (!frames.length) throw new Error('프레임 추출 실패');
    const list = frames.map(f => `- ${(Number(f.match(/_(\d+)ms/)[1]) / 1000).toFixed(1)}초: ${f}`).join('\n');
    const txt = await runClaude(`아래는 릴스 광고 영상 1개에서 뽑은 프레임 ${frames.length}장이다. 시각 순서대로 Read로 열어 보고 JSON 하나만 출력해.\n${list}`,
      ['--restricted', '--tools', 'Read', '--strict-mcp-config', '--append-system-prompt', SYS], { timeoutMs: 8 * 60000 });
    const m = txt.match(/\{[\s\S]*\}/); if (!m) throw new Error('JSON 없음: ' + txt.slice(0, 80));
    const t = JSON.parse(m[0]);
    return { ...t, frames: frames.length, duration: +dur.toFixed(1), video_id: ad.video_id, at: new Date().toISOString() };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/* ── 대상: 저장된 리포트의 OFF·우수 소재 중 영상 (등록 기록에 video_id가 있는 것) ── */
const limit = Number(process.argv.find(a => /^\d+$/.test(a))) || 20;
const force = process.argv.includes('--force');
const only = (process.argv[process.argv.indexOf('--only') + 1] || '').match(/^\d{5,25}$/) ? process.argv[process.argv.indexOf('--only') + 1] : null;
ensureBin();
const [rep, cre, prev] = await Promise.all([
  api('client-log', { action: 'state_get', key: 'test_report' }),
  api('meta-upload', { action: 'creatives_list', status: 'ad_created', limit: 500 }),
  api('client-log', { action: 'state_get', key: 'video_tags' }),
]);
if (!rep.data || !Array.isArray(rep.data.ads)) { console.error('❌ 저장된 리포트가 없어요 — 대시보드 테스트 소재 탭에서 [리포트]를 먼저 열거나 weekly-test-report.mjs를 실행하세요'); process.exit(1); }
const vidOf = new Map((cre.rows || []).filter(r => r.ad_id && r.media && r.media.video_id).map(r => [String(r.ad_id), { video_id: String(r.media.video_id), file: r.file_name }]));
const have = (prev.data && prev.data.tags) || {};
let targets = rep.data.ads.filter(a => vidOf.has(String(a.id))).map(a => ({ ...a, ...vidOf.get(String(a.id)) }));
if (only) targets = targets.filter(a => a.id === only);
if (!force) targets = targets.filter(a => !have[a.id] || have[a.id].video_id !== a.video_id);
targets.sort((x, y) => (x.group === 'good' ? -1 : 1) - (y.group === 'good' ? -1 : 1) || y.spend - x.spend);   // 우수 먼저, 그다음 지출 큰 순
targets = targets.slice(0, limit);
console.log(`▶ 리포트 ${rep.data.from}~${rep.data.to} · 영상 소재 ${targets.length}개 분석 (이미 태그된 것 ${Object.keys(have).length}개${force ? ', --force로 다시' : ' 건너뜀'})`);
if (!targets.length) { console.log('✅ 새로 태그할 영상이 없어요'); process.exit(0); }

const tags = { ...have };
let ok = 0, fail = 0, i = 0;
const worker = async () => {
  while (i < targets.length) {
    const ad = targets[i++], n = i;
    process.stdout.write(`… (${n}/${targets.length}) ${String(ad.name || ad.file).slice(0, 34)}\n`);
    try { tags[ad.id] = await tagOne(ad); ok++; console.log(`  ✓ ${ad.name.slice(0, 24)} — 훅 ${tags[ad.id].hook} · 컷 ${tags[ad.id].cuts} · 자막 ${(tags[ad.id].subtitles || []).length}줄 · ${tags[ad.id].duration}초`); }
    catch (e) { fail++; console.log(`  ✗ ${String(ad.name || '').slice(0, 24)}: ${e.message.split('\n')[0]}`); }
  }
};
await Promise.all([worker(), worker(), worker()]);   // 동시 3개
fs.rmSync(TMP, { recursive: true, force: true });
const cur = await api('client-log', { action: 'state_get', key: 'video_tags' });
const saved = await api('client-log', { action: 'state_set' }, { key: 'video_tags', base: cur.ver || null, data: { tags, at: new Date().toISOString() } });
if (saved.conflict) { console.error('⚠ 다른 사람이 방금 저장해서 덮어쓰지 않았어요 — 다시 실행해 주세요'); process.exit(1); }
console.log(`끝 — 성공 ${ok} · 실패 ${fail} · 저장된 영상 태그 ${Object.keys(tags).length}개`);
