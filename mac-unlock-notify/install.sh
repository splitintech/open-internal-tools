#!/bin/zsh
# Install mac-unlock-notify for the current macOS user.
set -euo pipefail

REPO_DIR="${0:A:h}"
LABEL="com.mac-unlock-notify"
ZSH_BIN="/bin/zsh"
LIBEXEC_DIR="$HOME/.local/libexec/mac-unlock-notify"
BIN_DIR="$HOME/.local/bin"
CONFIG_DIR="$HOME/.config/mac-unlock-notify"
ENV_FILE="$CONFIG_DIR/env"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_FILE="$HOME/Library/Logs/mac-unlock-notify.log"
TEMPLATE="$REPO_DIR/share/com.mac-unlock-notify.plist.template"
WATCHER_SRC="$REPO_DIR/bin/mac-unlock-notify"

webhook=""
skip_test=0

usage() {
  cat <<'EOF'
Usage: ./install.sh [--webhook URL] [--skip-test]

Installs a LaunchAgent that Slack-notifies your phone when this Mac unlocks.

  --webhook URL   Slack incoming webhook (otherwise you will be prompted)
  --skip-test     Do not send a Slack test after install
  --help          Show this help
EOF
}

require_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    print -r -- "error: this installer only runs on macOS." >&2
    exit 1
  fi
}

looks_like_webhook() {
  [[ "$1" == https://hooks.slack.com/services/* ]]
}

prompt_webhook() {
  local entered
  print -r -- "Paste your Slack incoming webhook URL (input hidden):"
  read -rs entered
  print
  if ! looks_like_webhook "$entered"; then
    print -r -- "error: URL must start with https://hooks.slack.com/services/" >&2
    exit 1
  fi
  webhook="$entered"
}

write_env() {
  mkdir -p "$CONFIG_DIR"
  chmod 700 "$CONFIG_DIR"
  umask 077
  print -r -- "SLACK_WEBHOOK=${webhook}" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

install_watcher() {
  mkdir -p "$LIBEXEC_DIR" "$BIN_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  /bin/cp "$WATCHER_SRC" "$LIBEXEC_DIR/mac-unlock-notify"
  chmod 755 "$LIBEXEC_DIR/mac-unlock-notify"
  ln -sfn "$LIBEXEC_DIR/mac-unlock-notify" "$BIN_DIR/mac-unlock-notify"
}

render_plist() {
  local script="$LIBEXEC_DIR/mac-unlock-notify"
  /usr/bin/sed \
    -e "s|__LABEL__|${LABEL}|g" \
    -e "s|__ZSH__|${ZSH_BIN}|g" \
    -e "s|__SCRIPT__|${script}|g" \
    -e "s|__LOG__|${LOG_FILE}|g" \
    "$TEMPLATE" > "$PLIST"
  chmod 644 "$PLIST"
}

load_agent() {
  local uid domain
  uid="$(id -u)"
  domain="gui/${uid}"
  launchctl bootout "${domain}/${LABEL}" >/dev/null 2>&1 || true
  if launchctl bootstrap "$domain" "$PLIST" 2>/dev/null; then
    launchctl enable "${domain}/${LABEL}" 2>/dev/null || true
    print -r -- "loaded LaunchAgent via launchctl bootstrap"
    return 0
  fi
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  launchctl load -w "$PLIST"
  print -r -- "loaded LaunchAgent via launchctl load"
}

ensure_path_hint() {
  if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    print -r -- "note: add $BIN_DIR to PATH to run mac-unlock-notify from any terminal"
    print -r -- "      echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --webhook)
      if [[ $# -lt 2 ]]; then
        print -r -- "error: --webhook requires a URL" >&2
        exit 1
      fi
      webhook="$2"
      shift 2
      ;;
    --skip-test)
      skip_test=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      print -r -- "unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_macos

if [[ ! -f "$WATCHER_SRC" || ! -f "$TEMPLATE" ]]; then
  print -r -- "error: run install.sh from a complete clone of this repo." >&2
  exit 1
fi

if [[ -z "$webhook" && -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  webhook="${SLACK_WEBHOOK:-}"
fi

if [[ -z "$webhook" ]]; then
  if [[ ! -t 0 ]]; then
    print -r -- "error: pass --webhook URL when stdin is not a terminal." >&2
    exit 1
  fi
  prompt_webhook
elif ! looks_like_webhook "$webhook"; then
  print -r -- "error: URL must start with https://hooks.slack.com/services/" >&2
  exit 1
fi

write_env
install_watcher
render_plist
load_agent

print -r -- "installed $LABEL"
print -r -- "  watcher: $LIBEXEC_DIR/mac-unlock-notify"
print -r -- "  config:  $ENV_FILE"
print -r -- "  plist:   $PLIST"
print -r -- "  log:     $LOG_FILE"
ensure_path_hint

if (( skip_test == 0 )); then
  print -r -- "sending Slack test…"
  "$LIBEXEC_DIR/mac-unlock-notify" --test
  print -r -- "if your iPhone did not banner, set Slack → Notifications → Immediately, even if I'm active"
fi
