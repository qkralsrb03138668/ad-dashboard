#!/bin/zsh
# Meta 쓰기 토큰(META_WRITE_TOKEN) 갱신 — 클립보드의 새 시스템 사용자 토큰을 Supabase secret에 등록하고 쓰기 함수 2개 재배포
#   사용법: 비즈니스 설정 → 시스템 사용자 → 토큰 생성 → [복사] 한 직후 이 파일 더블클릭 (토큰이 화면·대화에 남지 않음)
set -e
cd "$(dirname "$0")"
SB=~/.local/bin/supabase
REF=pydxcqfztjogmztvayux
TOKEN="$(pbpaste | tr -d '[:space:]')"
if ! [[ "$TOKEN" =~ ^EAA[A-Za-z0-9]{40,}$ ]]; then echo "❌ 클립보드에 Meta 토큰이 없습니다 (EAA…로 시작해야 함). 토큰 [복사] 후 다시 실행하세요."; read -k1; exit 1; fi
echo "▶ 토큰 확인: ${TOKEN:0:6}…${TOKEN: -4} (${#TOKEN}자)"
echo "▶ Supabase secret 등록"
$SB secrets set META_WRITE_TOKEN="$TOKEN" --project-ref $REF
echo "▶ 쓰기 함수 재배포 (meta-upload · meta-budget)"
$SB functions deploy meta-upload --project-ref $REF
$SB functions deploy meta-budget --project-ref $REF
pbcopy < /dev/null
echo "✅ 완료 — 클립보드를 비웠습니다. 대시보드 '광고 업로드' 메뉴에서 [연결 진단]을 눌러 확인하세요."
read -k1
