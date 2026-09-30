// 카카오 '오늘 처리' 판정 한 걸음 (index.ts recordKakao가 씀, 점검: node test/cs-kakao-step.test.ts)
//   prev = [현재 담당자, 오늘 날짜(마지막 판정일), 오늘표시 ''|'c'(이어지는 상담)|'n'(오늘 셈), 자정 담당자] | undefined(처음 보는 방)
//   c    = { a: 지금 담당자, m: 자정에 '어제 고객 말'에 답 못 한 상태였나 0/1, w: 오늘 고객이 쓴 메시지 있나 0/1 }  ← m·w는 북마크가 채팅 기록에서 계산
//   규칙(2026-09-30 사용자): 담당자 없다가 오늘 지정 → 1건 | 끝난 상담(자정에 답해 둠)에 고객이 오늘 문의 → 붙어 있는 담당자 1건 |
//        자정에 담당자가 있고 어제 고객 말에 답 못 한 채 넘어온 상담 → 오늘 내내 안 셈
export type Led = [number, string, string, number];
export function kakaoStep(prev: Led | undefined, c: { a: number; m: number; w: number }, today: string): { p: Led; count: boolean } {
  const p: Led = prev && prev[1] === today ? [...prev] : [prev ? prev[0] : 0, today, "", prev ? prev[0] : 0];   // 오늘 첫 판정: 마지막으로 본 담당자 = 자정 담당자
  if (p[2] === "" && p[3] && c.m) p[2] = "c";
  if (p[2] === "" && c.a && (c.w || !p[3])) p[2] = "n";
  p[0] = c.a;
  return { p, count: p[2] === "n" && !!c.a };
}
