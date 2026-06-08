#!/usr/bin/env bash
# setup.sh — karax 단일 진입 셋업 스크립트
# 의존성 설치 → 빌드 → karax CLI 글로벌 등록을 순차 수행한다.
# 실행: ./setup.sh
set -euo pipefail

cd "$(dirname "$0")"

# ─── 컬러 로그 헬퍼 ──────────────────────────────────────────────────
_GREEN='\033[0;32m'
_YELLOW='\033[1;33m'
_RED='\033[0;31m'
_RESET='\033[0m'

info()    { printf "[setup] %s\n" "$*"; }
success() { printf "${_GREEN}[setup] %s${_RESET}\n" "$*"; }
warn()    { printf "${_YELLOW}[setup] 경고: %s${_RESET}\n" "$*" >&2; }
die()     { printf "${_RED}[setup] 오류: %s${_RESET}\n" "$*" >&2; exit 1; }

# ─── 1단계: pnpm 확인 ───────────────────────────────────────────────
info "1/3  pnpm 확인 중..."

if ! command -v pnpm &>/dev/null; then
  info "     pnpm 없음 — corepack enable 시도 중..."
  if command -v corepack &>/dev/null; then
    corepack enable || die "corepack enable 실패. pnpm을 수동으로 설치한 뒤 다시 실행하세요.\n  설치 방법: https://pnpm.io/installation"
  fi
fi

if ! command -v pnpm &>/dev/null; then
  die "pnpm을 찾을 수 없습니다.\n  설치 방법: https://pnpm.io/installation\n  (예: npm install -g pnpm  또는  corepack enable)"
fi

info "     pnpm $(pnpm --version) 확인됨"

# ─── 2단계: PNPM_HOME 보장 (멱등) ───────────────────────────────────
info "2/3  PNPM_HOME 설정 확인 중..."

_global_bin_dir="$(pnpm config get global-bin-dir 2>/dev/null || true)"

# "undefined" 문자열이나 빈 문자열이면 미설정으로 간주
if [ -z "$_global_bin_dir" ] || [ "$_global_bin_dir" = "undefined" ]; then
  info "     PNPM_HOME 미설정 — pnpm setup 실행 중..."
  info "     (pnpm setup이 ~/.zshrc, ~/.bashrc 등 셸 설정 파일에 PNPM_HOME/PATH를 추가할 수 있습니다)"
  pnpm setup || warn "pnpm setup 실행 중 일부 경고가 발생했습니다 (무시하고 진행)"

  # pnpm setup 이후 경로 재확인
  _global_bin_dir="$(pnpm config get global-bin-dir 2>/dev/null || true)"
fi

# 여전히 비어있으면 플랫폼별 기본값으로 추정
if [ -z "$_global_bin_dir" ] || [ "$_global_bin_dir" = "undefined" ]; then
  case "$(uname -s)" in
    Darwin)
      _global_bin_dir="$HOME/Library/pnpm"
      ;;
    *)
      _global_bin_dir="${XDG_DATA_HOME:-$HOME/.local/share}/pnpm"
      ;;
  esac
  warn "pnpm config get global-bin-dir 응답이 없어 기본값을 사용합니다: $_global_bin_dir"
fi

# 현재 세션 PATH에 PNPM_HOME 추가
if [ -n "$_global_bin_dir" ]; then
  export PNPM_HOME="$_global_bin_dir"
  case ":$PATH:" in
    *":$PNPM_HOME:"*)
      info "     PNPM_HOME 이미 PATH에 포함됨 — 건너뜀 ($_global_bin_dir)"
      ;;
    *)
      export PATH="$PNPM_HOME:$PATH"
      info "     PNPM_HOME을 PATH에 추가했습니다: $_global_bin_dir"
      ;;
  esac
fi

# ─── 3단계: link-cli 실행 (install → build → pnpm link --global) ────
info "3/3  karax CLI 설치 중 (pnpm link-cli)..."
info "     (의존성 설치 → 전체 빌드 → 글로벌 등록 순서로 진행됩니다)"
echo ""

pnpm link-cli

echo ""

# ─── 마무리 안내 ─────────────────────────────────────────────────────
if command -v karax &>/dev/null; then
  _karax_path="$(command -v karax)"
  success "셋업 완료! karax 명령어가 등록됐습니다."
  success "  경로: $_karax_path"
else
  warn "현재 셸 세션에서는 karax 명령어를 아직 찾지 못했습니다."
  warn "아래 중 하나를 실행한 뒤 'karax --help'로 확인하세요:"
  warn "  source ~/.zshrc       (zsh 사용 시)"
  warn "  source ~/.bashrc      (bash 사용 시)"
  warn "또는 새 터미널을 열면 자동으로 반영됩니다."
fi
