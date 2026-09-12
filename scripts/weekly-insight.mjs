// 베스트 소재 주간 리포트에 AI 해석 붙이기 — 이 맥의 Claude Code(구독)로, API 결제 없이.
//   1) 대시보드 베스트 소재 탭 → [주간 리포트]를 연다 (숫자 리포트가 계정 공유 상태 best_report에 저장됨)
//   2) node scripts/weekly-insight.mjs  → 그 숫자를 읽어 해석(왜 터졌나·MD팀/컨텐츠팀 다음 행동)을 만들고 best_report_ai에 저장
//   3) 대시보드에서 리포트를 다시 열면 'AI 해석' 칸에 붙는다 (텍스트 복사·PDF에도 포함)
// 인증: 이 폴더의 config.js(SUPABASE_URL·anon key·DASH_KEY). 옵션: --dry = 저장 안 하고 화면에만
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

const SYSTEM = `너는 여성 의류 쇼핑몰 '다나로브'의 메타(인스타·페이스북) 광고팀 주간 회의 분석가다.
입력은 대시보드가 계산한 숫자 리포트(베스트 소재 성과·전주 대비·릴스/이미지·소구점·가격대·상품 판단·테스트 효율)다.
너의 일은 숫자를 해석해 MD팀(상품·재고)과 컨텐츠마케터팀(소재 촬영·문구)이 다음 주에 할 일을 정해 주는 것.

규칙
- 리포트에 있는 숫자만 근거로 쓴다. 숫자가 없거나 표본이 작으면(소재 3개 미만) "아직 판단하기 이르다"고 말한다. 추측을 사실처럼 쓰지 않는다.
- 직원이 읽는 글이다: 성과를 먼저 인정하고 다음 행동을 제안하는 톤. "~보다 못하다" 같은 대비형 지적, 단정적 평가, 이모지는 쓰지 않는다.
- 참고 공식(2026-09 회의): 잘 터진 소재 = 체형커버 상품 + 사이즈 숫자 훅(44~88, kg·cm) + 시연 컷. 리포트의 '문구 훅' 수치와 소구점 결과를 이 공식에 비춰 본다. 컷 유형은 아직 집계하지 않으니 언급만 한다.
- 각 줄은 한 문장, 회의에서 소리 내어 읽을 수 있게 짧게. 전체 20줄 이내.

출력 형식 (제목 그대로, 다른 말 없이)
■ 이번 주 한 줄 평
■ 왜 터졌나 (최대 3줄, 숫자 인용)
■ MD팀 다음 주 (최대 3줄, 상품명 명시)
■ 컨텐츠팀 다음 주 (최대 3줄, 소구점·형식 명시)
■ 주의할 점 (최대 2줄)`;

const dry = process.argv.includes('--dry');
const cur = await api('client-log', { action: 'state_get', key: 'best_report' });
if (!cur.data || !cur.data.text) { console.error('❌ 저장된 리포트가 없어요 — 대시보드 베스트 소재 탭에서 [주간 리포트]를 먼저 열어 주세요'); process.exit(1); }
const r = cur.data;
console.log(`📊 리포트 ${r.from}~${r.to} (${r.days}일, ${String(r.at).slice(0, 16).replace('T', ' ')} 저장) 읽음 → 해석 생성 중…`);
const out = execFileSync('claude', ['-p', `아래 주간 리포트를 해석해 줘.\n\n${r.text}`, '--model', 'claude-fable-5-1', '--effort', 'medium', '--output-format', 'text', '--append-system-prompt', SYSTEM],
  { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] }).trim();   // 도구 없이 — 숫자만 해석
console.log('\n' + out + '\n');
if (dry) { console.log('(--dry: 저장 안 함)'); process.exit(0); }
const prev = await api('client-log', { action: 'state_get', key: 'best_report_ai' });
const saved = await api('client-log', { action: 'state_set' }, { key: 'best_report_ai', base: prev.ver || null, data: { text: out, at: new Date().toISOString(), from: r.from, to: r.to } });
if (saved.conflict) { console.error('⚠ 다른 사람이 방금 저장해서 덮어쓰지 않았어요 — 다시 실행해 주세요'); process.exit(1); }
console.log('✅ 저장 완료 — 대시보드에서 주간 리포트를 다시 열면 AI 해석이 붙어요');
