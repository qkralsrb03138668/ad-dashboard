#!/bin/zsh
# 광고 업로드 탭의 등록 대기 소재 중 문구 없는 상품만 — 이 맥의 Claude Code(구독)로 문구 생성 → 상품에 고정 + 소재에 채움
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
node scripts/gen-copy.mjs "$@"
echo; echo "아무 키나 누르면 닫힙니다"; read -k1
