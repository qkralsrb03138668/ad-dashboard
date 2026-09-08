#!/bin/zsh
# 운영 보조 함수(오류 수집·브라우저 백업·내보내기) 배포 — 최초 1회 + 함수/SQL 수정 시 재실행
#   1) ~/.local/bin/supabase login   (로그인이 안 돼 있을 때만)
#   2) ./deploy-client-log.sh
set -e
cd "$(dirname "$0")"
SB=~/.local/bin/supabase
REF=pydxcqfztjogmztvayux
echo "▶ DB 테이블 만들기 (client_errors · client_backups)"
$SB db query --linked --project-ref $REF -f supabase/migrations/0009_client_log.sql
echo "▶ 서버 함수 배포"
$SB functions deploy client-log --project-ref $REF
echo "✅ 완료. 대시보드 › 데이터 관리 › 서버 백업 / 오류 기록 에서 확인"
