// 카카오 처리 기록 판정 점검 — `node test/cs-kakao-step.test.ts`
import assert from "node:assert/strict";
import { kakaoStep, type Led } from "../supabase/functions/cs-lookup/kakao-step.ts";

const T = "2026-09-30", Y = "2026-09-29";
function run(p: Led | undefined, ...seq: [number, number, number][]) {   // [담당자, m, w] 상태들을 차례로 → 오늘 센 담당자(0 = 안 셈)
  let count = false, a = 0;
  for (const [ca, m, w] of seq) ({ p, count } = kakaoStep(p, { a: ca, m, w }, T)), a = ca;
  return count ? a : 0;
}
assert.equal(run([7, Y, "", 7], [7, 0, 1]), 7, "끝난 상담에 고객 재문의 → 붙어 있는 담당자");
assert.equal(run([7, Y, "", 7], [7, 1, 1], [7, 1, 1]), 0, "어제 답 못 하고 넘어온 담당 상담 → 오늘 내내 안 셈");
assert.equal(run([0, Y, "", 0], [8, 1, 1]), 8, "밤에 온 신규 문의, 오늘 아침 담당자 지정");
assert.equal(run(undefined, [9, 1, 1]), 9, "처음 보는 방 + 담당자");
assert.equal(run([7, Y, "", 7], [7, 0, 0]), 0, "직원이 먼저 보낸 메시지만 → 안 셈");
assert.equal(run(undefined, [0, 0, 1], [5, 0, 1], [6, 0, 1]), 6, "지정 후 담당자 바뀌면 새 담당자로");
assert.equal(run([7, T, "c", 7], [7, 0, 1]), 0, "오늘 이미 이어지는 상담으로 판정된 방");
assert.equal(run([7, "0", "", 7], [7, 0, 1]), 7, "첫 설치(seed) 뒤 끝난 상담에 재문의");
console.log("cs-kakao-step: 8개 통과");
