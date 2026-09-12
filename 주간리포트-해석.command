#!/bin/zsh
# 베스트 소재 주간 리포트에 AI 해석 붙이기 — 대시보드에서 [주간 리포트]를 연 뒤 실행 (이 맥의 Claude Code 구독 사용, 결제 없음)
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
node scripts/weekly-insight.mjs
echo; echo "아무 키나 누르면 닫힙니다"; read -k1
