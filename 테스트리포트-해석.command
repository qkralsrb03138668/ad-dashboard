#!/bin/zsh
# 테스트 소재 리포트에 AI 태그(컷 유형·자막)와 해석(OFF·우수 공통점, 실패·우수 이유, 추가소재 방향) 붙이기 — 대시보드에서 [리포트]를 연 뒤 실행 (이 맥의 Claude Code 구독, 결제 없음)
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
node scripts/test-insight.mjs
echo; echo "아무 키나 누르면 닫힙니다"; read -k1
