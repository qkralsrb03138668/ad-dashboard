// 카카오 처리 기록 판정 점검 — `node test/cs-kakao-step.test.ts`
import assert from "node:assert/strict";
import { kakaoStep, type Led } from "../supabase/functions/cs-lookup/kakao-step.ts";

const T = "2026-09-30", Y = "2026-09-29";
function run(p: Led | undefined, ...seq: [number, number][]) {   // 상태 변화들을 차례로 넣고, 마지막에 오늘 세는지 + 담당자
  let count = false, a = 0;
  for (const [ca, cr] of seq) ({ p, count } = kakaoStep(p, { a: ca, r: cr }, T, Y)), a = ca;
  return count ? a : 0;
}
assert.equal(run([7, 1, Y, "", 7], [7, 0]), 7, "어제 답해 둔 방에 고객 재문의 → 붙어 있는 담당자");
assert.equal(run([7, 0, Y, "", 7], [7, 0], [7, 1], [7, 0]), 0, "어제 답 못 하고 넘어온 방 → 오늘 내내 안 셈");
assert.equal(run([0, 0, Y, "", 0], [8, 0]), 8, "담당자 없다가 오늘 지정");
assert.equal(run([7, 0, "2026-09-20", "", 7], [7, 0]), 7, "이틀 넘게 고객 말로 끝나 있던 방 → 새 상담");
assert.equal(run(undefined, [9, 0]), 9, "처음 보는 방 + 담당자");
assert.equal(run([7, 1, Y, "", 7], [7, 1]), 0, "직원이 먼저 보낸 메시지만 → 안 셈");
assert.equal(run(undefined, [0, 0], [5, 0], [6, 0]), 6, "지정 후 다른 담당자로 바뀌면 새 담당자");
assert.equal(run([7, 1, T, "c", 7], [7, 0]), 0, "오늘 이미 '이어지는 상담'으로 판정된 방");
console.log("cs-kakao-step: 8개 통과");
