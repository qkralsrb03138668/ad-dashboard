#!/bin/zsh
# Claude API 키(ANTHROPIC_API_KEY) 등록 — 상품 광고 문구 AI 생성용. console.anthropic.com → API Keys → Create → [복사] 직후 더블클릭
set -e
cd "$(dirname "$0")"
SB=~/.local/bin/supabase
REF=pydxcqfztjogmztvayux
KEY="$(pbpaste | tr -d '[:space:]')"
if ! [[ "$KEY" =~ ^sk-ant-[A-Za-z0-9_-]{20,}$ ]]; then echo "❌ 클립보드에 Claude API 키가 없습니다 (sk-ant-…로 시작). 키 [복사] 후 다시 실행하세요."; read -k1; exit 1; fi
echo "▶ 키 확인: ${KEY:0:10}…${KEY: -4} (${#KEY}자)"
$SB secrets set ANTHROPIC_API_KEY="$KEY" --project-ref $REF
$SB functions deploy cafe24-perf --project-ref $REF
pbcopy < /dev/null
echo "✅ 완료 — 클립보드를 비웠습니다. 소재 등록에서 [AI 문구 생성]을 눌러 확인하세요."
read -k1
