#!/bin/zsh
# 출장촬영 보드 서버 배포 — 최초 1회 + 함수/SQL 수정 시 재실행
#   1) ~/.local/bin/supabase login   (브라우저에서 확인 — 로그인이 안 돼 있을 때만)
#   2) ./deploy-shoot-board.sh <초대코드>
set -e
cd "$(dirname "$0")"
SB=~/.local/bin/supabase
REF=pydxcqfztjogmztvayux
CODE="$1"
if [ -z "$CODE" ]; then echo "사용법: ./deploy-shoot-board.sh <초대코드>"; exit 1; fi
echo "▶ DB 테이블·사진 버킷 만들기"
$SB db query --project-ref $REF -f supabase/migrations/0004_shoot_board.sql
echo "▶ 초대코드 등록"
$SB secrets set SHOOT_CODE="$CODE" --project-ref $REF
echo "▶ 서버 함수 배포"
$SB functions deploy shoot-board --project-ref $REF --no-verify-jwt
echo "✅ 완료. 초대코드: $CODE"
