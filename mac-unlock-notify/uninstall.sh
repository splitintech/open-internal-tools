#!/bin/zsh
# Remove the LaunchAgent and installed watcher. Keeps the webhook unless --purge.
set -euo pipefail

LABEL="com.mac-unlock-notify"
LIBEXEC_DIR="$HOME/.local/libexec/mac-unlock-notify"
BIN_LINK="$HOME/.local/bin/mac-unlock-notify"
CONFIG_DIR="$HOME/.config/mac-unlock-notify"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
purge=0

usage() {
  cat <<'EOF'
Usage: ./uninstall.sh [--purge]

  --purge   Also delete ~/.config/mac-unlock-notify (webhook)
  --help    Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge) purge=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *)
      print -r -- "unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

uid="$(id -u)"
launchctl bootout "gui/${uid}/${LABEL}" >/dev/null 2>&1 || true
if [[ -f "$PLIST" ]]; then
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST"
fi

rm -f "$BIN_LINK"
rm -rf "$LIBEXEC_DIR"

if (( purge == 1 )); then
  rm -rf "$CONFIG_DIR"
  print -r -- "removed $LABEL, installed files, and $CONFIG_DIR"
else
  print -r -- "removed $LABEL and installed files"
  print -r -- "webhook left in $CONFIG_DIR (use --purge to delete it)"
fi
