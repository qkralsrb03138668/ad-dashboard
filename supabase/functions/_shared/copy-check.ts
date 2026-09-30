/* 모델이 카피 앞뒤에 붙이는 안내문 제거 + 검증 — 서버·로컬 스크립트 공용 (2026-09-30: "상품 페이지는 접근 권한이 없어 … 근거로 썼습니다." 한국어 안내 문단이
   첫 한글 줄 규칙을 통과해 광고 9개에 그대로 나갔고 고객이 'AI가 쓴 것 같다'고 알려옴 — 이제 안내 문단은 잘라내고, 남아 있으면 실패 처리) */
export const NOTE_RE = /권한|근거로 (썼|쓴|작성)|카피입니다|열지 못|확인하지 못|불러오지 못|불러올 수 없|접근할 수 없|작성했습니다|페이지를 열|확인해보니|다음과 같이/;
export function stripNotes(text: string): string {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  let end = -1; lines.forEach((l, i) => { if (/♡\s*$/.test(l)) end = i; });   // 마지막 ♡ 줄 뒤는 버림
  let body = end >= 0 ? lines.slice(0, end + 1) : lines;
  const first = body.findIndex((l) => /[가-힣]/.test(l));                        // 영어 머리말("I'll check the product page first.")
  body = first > 0 ? body.slice(first) : body;
  const cut = body.findIndex((l) => /^\s*(---|참고:|※|\[참고)/.test(l)); if (cut > 0) body = body.slice(0, cut);
  return stripLeadNotes(body.join("\n"));
}
export function stripLeadNotes(text: string): string {   // 앞쪽 안내 문단(권한·근거 설명)만 통째로 제거 — 저장·광고 생성 직전에도 쓴다
  const paras = String(text ?? "").replace(/\r/g, "").trim().split(/\n\s*\n/);
  while (paras.length > 1 && NOTE_RE.test(paras[0])) paras.shift();
  return paras.join("\n\n").trim();
}
export function badCopy(text: string): string {   // 빈 문자열 = 통과, 아니면 실패 이유
  const t = String(text ?? "").trim();
  if (!t) return "빈 출력";
  const latin = (t.match(/[A-Za-z]/g) || []).length, hangul = (t.match(/[가-힣]/g) || []).length;
  if (latin > hangul * 0.3) return "영어 문장 섞임";
  if (/\b(I'm|I am|tools?|declined|WebFetch|curl|fetch|http)\b/i.test(t)) return "과정 설명·도구 언급";
  if (NOTE_RE.test(t)) return "서론·과정 설명";
  const lines = t.split("\n").length;
  if (lines < 10 || lines > 36) return `줄 수 ${lines} (10~36 밖)`;   // 18자 줄바꿈으로 늘어난 31줄짜리를 버리지 않게 (실사례 31줄)
  if (!/♡\s*$/.test(t)) return "마지막 ♡ 없음";
  return "";
}
