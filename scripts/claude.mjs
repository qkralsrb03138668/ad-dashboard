// 이 맥의 Claude Code(구독)를 부르는 공용 실행기 — 문구생성(gen-copy)·리포트 해석(weekly-insight·test-insight)이 같이 쓴다.
//   · 모델 목록 순서대로 시도하고, 사용량 한도가 차면 다음 모델로 자동 전환 (그 실행 동안 계속 유지)
//     - 광고 문구 COPY_MODELS: Opus 5 · 최대 → 한도면 Fable 5.1 · 높음 (2026-09-17 사용자 지정: 문구는 Opus 최대)
//     - 리포트 해석 MODELS: Fable 5.1 · 중간 → 한도면 Opus 5 · 중간
//   · 실패하면 claude가 실제로 말한 이유를 한국어 한 문장으로 (예전엔 무조건 "로그인 확인"이라 한도 초과를 오해하게 만들었다 — 2026-09-15)
import { execFileSync } from 'node:child_process';

export const MODELS = [['claude-fable-5-1', 'Fable 5.1', 'medium'], ['claude-opus-5', 'Opus 5', 'medium']];   // [모델 id, 이름, 강도]
export const COPY_MODELS = [['claude-opus-5', 'Opus 5', 'max'], ['claude-fable-5-1', 'Fable 5.1', 'high']];
const EFFORT_KO = { low: '낮음', medium: '중간', high: '높음', xhigh: '매우 높음', max: '최대' };
const pos = new Map();   // 목록별 현재 위치 — 한도로 넘어간 모델은 그 실행 동안 유지
export const claudeModel = (models = MODELS) => { const m = models[pos.get(models) || 0]; return `${m[1]} · ${EFFORT_KO[m[2]] || m[2]}`; };
const LIMIT = /reached your .*limit|usage limit|rate.?limit|limit reached/i;

/* claude 출력·오류 → 사람이 읽는 한 문장 */
export function claudeError(out, err, models = MODELS) {
  const text = String(out || '');
  if (err && err.code === 'ENOENT') return 'claude 명령을 찾을 수 없어요 — 이 맥에 Claude Code가 설치돼 있는지 확인하세요';
  if (LIMIT.test(text)) return `Claude 사용량 한도 초과 (${models.map(m => m[1]).join('·')} 모두) — claude.ai/settings/usage 에서 확인 후 한도가 풀리면 다시 실행하세요`;
  if (/not logged in|log ?in|authenticat|\/login|invalid api key|unauthorized/i.test(text)) return '로그인이 필요해요 — 터미널에서 claude 실행 후 /login';
  const line = text.split('\n').map(s => s.trim()).find(Boolean) || String(err && err.message || '').split('\n')[0];
  return 'Claude Code 실행 실패: ' + line.slice(0, 200);
}

/* prompt + 추가 옵션으로 실행해 stdout 텍스트를 돌려준다. exec는 검사용으로만 바꿔 끼운다 */
export function runClaude(prompt, extra = [], exec = execFileSync, models = MODELS) {
  for (;;) {
    const i = pos.get(models) || 0, [id, name, effort] = models[i];
    try {
      return exec('claude', ['-p', prompt, '--model', id, '--effort', effort, '--output-format', 'text', ...extra],
        { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const out = String(e.stdout || '') + '\n' + String(e.stderr || '');
      if (LIMIT.test(out) && i < models.length - 1) {
        pos.set(models, i + 1);
        process.stdout.write(`\n⚠ ${name} 사용량 한도 — 이번 실행은 ${claudeModel(models)}로 계속합니다\n`);
        continue;
      }
      throw new Error(claudeError(out, e, models));
    }
  }
}
/* 광고 문구 생성 전용 — Opus 5 · 최대 */
export const runCopy = (prompt, extra = [], exec = execFileSync) => runClaude(prompt, extra, exec, COPY_MODELS);
