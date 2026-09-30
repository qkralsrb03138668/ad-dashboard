#!/bin/zsh
# CS 온보딩 체크리스트 서버 배포 — 최초 1회 + 함수 수정 시 재실행
#   1) ~/.local/bin/supabase login   (로그인이 안 돼 있을 때만)
#   2) ./deploy-cs-onboarding.sh <초대코드>
set -e
cd "$(dirname "$0")"
SB=~/.local/bin/supabase
REF=pydxcqfztjogmztvayux
CODE="$1"
if [ -z "$CODE" ]; then echo "사용법: ./deploy-cs-onboarding.sh <초대코드>"; exit 1; fi
echo "▶ 초대코드 등록"
$SB secrets set CS_ONBOARD_CODE="$CODE" --project-ref $REF
echo "▶ DB 테이블 (cs_onboarding_checks)"
$SB db query --linked --project-ref $REF -f supabase/migrations/0020_cs_onboarding.sql
echo "▶ 서버 함수 배포 (cs-onboarding)"
$SB functions deploy cs-onboarding --project-ref $REF --no-verify-jwt
echo "✅ 완료. 초대코드: $CODE"
