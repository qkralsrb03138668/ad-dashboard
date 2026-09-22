#!/bin/zsh
# CS 주문조회 서버 배포 — 최초 1회 + 함수 수정 시 재실행
#   1) ~/.local/bin/supabase login   (로그인이 안 돼 있을 때만)
#   2) ./deploy-cs-lookup.sh <초대코드> [배송지연 게시판번호]
#      게시판번호를 모르면 초대코드만 넣고 배포한 뒤, 페이지에서 '게시판 찾기'로 번호를 확인해 다시 실행
set -e
cd "$(dirname "$0")"
SB=~/.local/bin/supabase
REF=pydxcqfztjogmztvayux
CODE="$1"; BOARD="$2"
if [ -z "$CODE" ]; then echo "사용법: ./deploy-cs-lookup.sh <초대코드> [게시판번호]"; exit 1; fi
echo "▶ 초대코드 등록"
if [ -n "$BOARD" ]; then $SB secrets set CS_CODE="$CODE" CS_BOARD_NO="$BOARD" --project-ref $REF
else $SB secrets set CS_CODE="$CODE" --project-ref $REF; fi
echo "▶ 서버 함수 배포 (cs-lookup + 게시판 권한이 추가된 cafe24-oauth)"
$SB functions deploy cafe24-oauth --project-ref $REF --no-verify-jwt
$SB functions deploy cs-lookup --project-ref $REF --no-verify-jwt
echo "✅ 완료. 초대코드: $CODE${BOARD:+, 게시판: $BOARD}"
