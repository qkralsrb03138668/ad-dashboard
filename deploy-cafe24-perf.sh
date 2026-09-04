#!/bin/zsh
# 판매 성과(카페24) 서버 배포 — 최초 1회 + 함수/SQL 수정 시 재실행
#   1) ~/.local/bin/supabase login   (로그인이 안 돼 있을 때만)
#   2) ./deploy-cafe24-perf.sh <몰아이디> <클라이언트ID> <클라이언트시크릿>
#      (카페24 개발자센터에서 만든 앱 값 — SETUP-판매성과.md §1)
set -e
cd "$(dirname "$0")"
SB=~/.local/bin/supabase
REF=pydxcqfztjogmztvayux
if [ $# -lt 3 ]; then echo "사용법: ./deploy-cafe24-perf.sh <몰아이디> <클라이언트ID> <클라이언트시크릿>"; exit 1; fi
echo "▶ DB 테이블 만들기 (api_tokens · perf_archive)"
$SB db query --linked --project-ref $REF -f supabase/migrations/0006_cafe24_perf.sql
echo "▶ 카페24 앱 정보 등록"
$SB secrets set CAFE24_MALL_ID="$1" CAFE24_CLIENT_ID="$2" CAFE24_CLIENT_SECRET="$3" --project-ref $REF
echo "▶ 서버 함수 배포"
$SB functions deploy cafe24-oauth --project-ref $REF --no-verify-jwt
$SB functions deploy cafe24-perf --project-ref $REF
echo "✅ 완료. 이제 브라우저에서 아래 주소를 한 번 열어 몰 관리자 계정으로 동의하세요:"
echo "   https://$REF.supabase.co/functions/v1/cafe24-oauth?action=start"
