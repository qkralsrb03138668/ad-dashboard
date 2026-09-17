#!/bin/zsh
# 테스트 소재 리포트(최근 30일)를 만들고 AI 태그·해석까지 붙인다 — 대시보드를 먼저 안 열어도 됨 (이 맥의 Claude Code 구독, 결제 없음). 금요일 08:00 자동 실행(launchd)과 같은 일
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
node scripts/weekly-test-report.mjs 30
echo; echo "아무 키나 누르면 닫힙니다"; read -k1
