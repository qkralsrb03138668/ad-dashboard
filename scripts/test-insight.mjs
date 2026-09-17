// 테스트 소재 리포트에 "눈으로 본 공통점"과 AI 해석 붙이기 — 이 맥의 Claude Code(구독)로, API 결제 없이.
//   1) 대시보드 테스트 소재 탭 → [리포트]를 연다 (숫자 리포트 + OFF·우수 소재 목록·썸네일 주소가 계정 공유 상태 test_report에 저장됨)
//   2) node scripts/test-insight.mjs → 썸네일을 내려받아 Claude가 보고 소재마다 태그(컷 유형·자막·사이즈 숫자·얼굴·배경)를 단 뒤,
//      숫자 리포트 + 태그 표로 OFF 공통점·실패 이유 / 우수 공통점·이유 / 추가소재 방향을 쓴다 → test_report_ai에 저장
//   3) 대시보드에서 리포트를 다시 열면 비교표에 'AI 컷 유형·자막' 줄과 'AI 해석' 칸이 붙는다
// 옵션: --dry = 저장 안 함. 인증: 이 폴더의 config.js(SUPABASE_URL·anon key·DASH_KEY)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude } from './claude.mjs';   // Fable 5.1 → 한도 시 Opus 5 자동 전환, 실패 이유 한국어

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfgSrc = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const cfg = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DASH_KEY'].map(k => [k, (cfgSrc.match(new RegExp(k + '\\s*:\\s*"([^"]*)"')) || [])[1] || '']));
if (!cfg.SUPABASE_URL || !cfg.DASH_KEY) { console.error('❌ config.js에 SUPABASE_URL·DASH_KEY가 필요합니다 (로컬 폴더에서만 실행)'); process.exit(1); }
const headers = { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, 'x-dash-key': cfg.DASH_KEY, 'Content-Type': 'application/json' };
async function api(fn, params, body) {
  const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/${fn}?` + new URLSearchParams(params), body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || ('HTTP ' + res.status));
  return j;
}
const dry = process.argv.includes('--dry');
const cur = await api('client-log', { action: 'state_get', key: 'test_report' });
if (!cur.data || !cur.data.text) { console.error('❌ 저장된 리포트가 없어요 — 대시보드 테스트 소재 탭에서 [리포트]를 먼저 열어 주세요'); process.exit(1); }
const r = cur.data;
console.log(`📋 리포트 ${r.from}~${r.to} (${r.days}일, ${String(r.at).slice(0, 16).replace('T', ' ')} 저장) — OFF ${r.ads.filter(a => a.group === 'off').length}개 · 우수 ${r.ads.filter(a => a.group === 'good').length}개`);

/* ── 1) 썸네일 내려받기 — 우수 전부 + OFF는 지출 큰 순 25개까지 (한 번에 너무 많이 보면 느리고 한도만 쓴다) ── */
const pick = [...r.ads.filter(a => a.group === 'good'), ...r.ads.filter(a => a.group === 'off').sort((x, y) => y.spend - x.spend).slice(0, 25)].filter(a => a.thumb);
const dir = path.join(root, '.insight-tmp');   // 프로젝트 안이어야 한다 — --restricted 모드의 Read는 작업 폴더 밖 파일을 못 연다 (2026-09-17 실사고: /tmp에 두니 태그 0개)
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const files = [];
for (const a of pick) {
  try {
    const res = await fetch(a.thumb); if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const fp = path.join(dir, `${a.group}_${a.id}.jpg`); fs.writeFileSync(fp, buf); files.push({ a, fp });
  } catch (e) { console.log(`  · 썸네일 못 받음 ${a.name.slice(0, 30)} (${e.message})`); }
}
console.log(`🖼 썸네일 ${files.length}개 준비 → Claude가 보는 중…`);

/* ── 2) 태그 — 12장씩 Read 도구만 주고 JSON으로 ── */
const TAG_SYS = `너는 여성 의류 쇼핑몰 광고 소재를 분류하는 검수자다. 주어진 이미지 파일을 Read 도구로 하나씩 열어 본 뒤, 파일마다 아래 JSON 객체를 만들어 배열로만 출력한다. 설명·인사·코드펜스 없이 JSON 배열만.
{"id":"파일명의 숫자 id","cut":"시연|착용|정면|디테일|비교|텍스트|기타","text":true/false(자막·글자 오버레이 유무),"size":true/false(사이즈 숫자·kg·cm 노출),"face":true/false(얼굴 노출),"bg":"실내|야외|스튜디오|기타","note":"10자 이내 특징"}
컷 유형 기준 — 시연: 신축·핏·기능을 손이나 동작으로 보여줌(당기기·앉기·비교 착용) / 착용: 모델이 입고 있는 전신·반신 / 정면: 옷만 걸린 정면 컷·제품컷 / 디테일: 소재·단추·박음질 근접 / 비교: 전후·사이즈별·컬러별 나란히 / 텍스트: 글자가 화면의 절반 이상.`;
const tags = {};
for (let i = 0; i < files.length; i += 12) {
  const chunk = files.slice(i, i + 12);
  const prompt = `아래 이미지 ${chunk.length}장을 각각 Read로 열어 보고 태그 JSON 배열만 출력해.\n` + chunk.map(f => `- id ${f.a.id}: ${f.fp}`).join('\n');
  let out = '';
  try { out = runClaude(prompt, ['--restricted', '--tools', 'Read', '--strict-mcp-config', '--append-system-prompt', TAG_SYS]); }
  catch (e) { console.log(`  ✗ 태그 실패 (${i + 1}~${i + chunk.length}): ${e.message}`); continue; }
  const m = out.match(/\[[\s\S]*\]/);
  try { for (const t of JSON.parse(m ? m[0] : '[]')) if (t && t.id) tags[String(t.id)] = { cut: t.cut || '기타', text: !!t.text, size: !!t.size, face: !!t.face, bg: t.bg || '기타', note: String(t.note || '').slice(0, 20) }; }
  catch (e) { console.log(`  ✗ 태그 JSON 해석 실패 (${i + 1}~): ${out.slice(0, 120)}`); }
  process.stdout.write(`  · ${Math.min(i + 12, files.length)}/${files.length}\n`);
}
fs.rmSync(dir, { recursive: true, force: true });

/* ── 3) 태그 교차표 (그룹 × 컷·자막·사이즈·얼굴·배경) ── */
const cross = (key, fn) => { const m = { off: {}, good: {} }; r.ads.forEach(a => { const t = tags[a.id]; if (!t) return; const v = fn(t); m[a.group][v] = (m[a.group][v] || 0) + 1; }); const line = g => Object.entries(m[g]).sort((x, y) => y[1] - x[1]).map(([v, n]) => `${v} ${n}`).join(' · ') || '—'; return ` · ${key} — OFF: ${line('off')} | 우수: ${line('good')}`; };
const table = Object.keys(tags).length ? ['[AI가 썸네일을 보고 단 태그 — 릴스는 첫 장면 기준]',
  cross('컷 유형', t => t.cut), cross('자막·글자', t => t.text ? '있음' : '없음'), cross('사이즈 숫자 노출', t => t.size ? '있음' : '없음'), cross('얼굴 노출', t => t.face ? '있음' : '없음'), cross('배경', t => t.bg),
  '', ...r.ads.filter(a => tags[a.id]).map(a => { const t = tags[a.id]; return ` - [${a.group === 'good' ? '우수' : 'OFF'}] ${a.name.slice(0, 40)} · ${a.fmt} · ${t.cut}${t.text ? '·자막' : ''}${t.size ? '·사이즈숫자' : ''} · ${t.note} · 진단 ${a.diag} · ROAS ${a.roas} · 구매 ${a.purchases}`; })].join('\n')
  : '(썸네일 태그 없음 — 숫자만으로 해석)';

/* ── 4) 해석 ── */
const SYS = `너는 여성 의류 쇼핑몰 '다나로브'의 메타 광고 소재 분석가다. 입력은 테스트 소재 리포트(숫자 비교·실패 이유 분포·규칙으로 만든 방향)와 AI가 썸네일을 보고 단 태그 표다.
규칙
- 리포트와 태그에 있는 것만 근거로 쓴다. 표본이 3개 미만인 항목은 "아직 판단하기 이르다"고 말한다. 추측을 사실처럼 쓰지 않는다.
- 릴스 태그는 첫 장면(썸네일) 기준이라는 걸 알고 말한다. 첫 1초가 3초 재생을 가르므로 첫 장면 공통점은 의미가 있다.
- 직원이 읽는 글: 성과를 먼저 인정하고 다음 행동을 제안하는 톤. 대비형 지적("~보다 못하다"), 단정적 평가, 이모지 금지. 한 줄 한 문장, 짧게. 전체 22줄 이내.
- 참고 공식(회의 확정): 잘 터진 소재 = 체형커버 상품 + 사이즈 숫자 훅 + 시연 컷.
출력 형식 — 아래 여섯 제목을 이 글자 그대로 쓰고(괄호 설명은 쓰지 않는다), 제목 아래에 줄만 쓴다. 다른 말은 없이.
■ OFF 소재 공통점
■ 실패 이유 추측
■ 우수 소재 공통점
■ 우수 이유 추측
■ 추가소재 방향
■ 주의할 점
분량: OFF 공통점 최대 3줄(숫자·태그 인용) · 실패 이유 최대 3줄(퍼널 단계와 연결) · 우수 공통점 최대 3줄 · 우수 이유 최대 2줄 · 추가소재 방향은 상품별 최대 6줄로 "상품명 — 무엇을 몇 개" 형식 · 주의 최대 2줄.`;
console.log('🧠 해석 생성 중…');
let text;
try { text = runClaude(`아래 테스트 소재 리포트와 태그 표를 해석해 줘.\n\n${r.text}\n\n${table}`, ['--append-system-prompt', SYS]).trim(); }
catch (e) { console.error('❌ ' + e.message); process.exit(1); }
console.log('\n' + table + '\n\n' + text + '\n');
if (dry) { console.log('(--dry: 저장 안 함)'); process.exit(0); }
const prev = await api('client-log', { action: 'state_get', key: 'test_report_ai' });
const saved = await api('client-log', { action: 'state_set' }, { key: 'test_report_ai', base: prev.ver || null, data: { text, table, tags, at: new Date().toISOString(), from: r.from, to: r.to } });
if (saved.conflict) { console.error('⚠ 다른 사람이 방금 저장해서 덮어쓰지 않았어요 — 다시 실행해 주세요'); process.exit(1); }
console.log(`✅ 저장 완료 (태그 ${Object.keys(tags).length}개) — 대시보드에서 테스트 소재 리포트를 다시 열면 붙어요`);
