// 카카오 '오늘 처리' 판정 한 걸음 — 채팅 하나의 저장 상태 p + 지금 상태 c → 새 상태, 오늘 셀지 (index.ts recordKakao가 씀, test/cs-kakao-step.test.ts로 점검)
//   p = [담당자, 답변함0/1, 마지막으로 바뀐 날, 오늘표시 ''|'c'(이어지는 상담)|'n'(오늘 셈), 오늘 첫 상태의 담당자] | undefined(처음 보는 방)
export type Led = [number, number, string, string, number];
export function kakaoStep(prev: Led | undefined, c: { a: number; r: number }, today: string, yday: string): { p: Led; count: boolean } {
  let p: Led;
  if (!prev) p = [0, 1, today, "", 0];                                                       // 처음 보는 방 = 자정엔 없던(끝난) 상담
  else if (prev[2] < today) p = [prev[0], prev[1], today, prev[0] && !prev[1] && prev[2] === yday ? "c" : "", prev[0]];   // 오늘 첫 변화: 저장 상태 = 자정 상태
  else p = [...prev];
  if (p[3] === "" && c.a && (!c.r || !p[4])) p[3] = "n";                                     // 고객이 새로 문의(답 대기) | 오늘 담당자 지정
  const count = p[3] === "n" && !!c.a;
  p[0] = c.a; p[1] = c.r;
  return { p, count };
}
