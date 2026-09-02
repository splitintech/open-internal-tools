#!/usr/bin/env bash
# Install slack-agent-hq from this folder only. Does not touch other product folders.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage: ./install.sh

Copies example config, creates .env from env.example if missing, and runs npm install.
This folder is self-contained. Other users:

  git clone https://github.com/splitintech/open-internal-tools.git
  cd open-internal-tools/slack-agent-hq
  ./install.sh

Next: edit config/*.yaml and .env, create Slack apps from manifests/, then npm start.
See README.md and docs/WORKSPACE_SETUP.md.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js >= 20 is required." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm is required." >&2
  exit 1
fi

mkdir -p config data
if [[ ! -f config/domains.yaml ]]; then
  cp config/examples/domains.yaml config/domains.yaml
  echo "wrote config/domains.yaml"
fi
if [[ ! -f config/agents.yaml ]]; then
  cp config/examples/agents.yaml config/agents.yaml
  echo "wrote config/agents.yaml"
fi
if [[ ! -f config/loops.yaml ]]; then
  cp config/examples/loops.yaml config/loops.yaml
  echo "wrote config/loops.yaml"
fi
if [[ ! -f config/integrations.yaml ]]; then
  cp config/examples/integrations.yaml config/integrations.yaml
  echo "wrote config/integrations.yaml"
fi
if [[ ! -f .env ]]; then
  cp env.example .env
  echo "wrote .env (fill tokens; never commit this file)"
fi

chmod 600 .env 2>/dev/null || true
npm install

echo
echo "installed slack-agent-hq in $ROOT"
echo "  1. Fill .env and config/agents.yaml slack_user_id values"
echo "  2. Create Slack apps from manifests/ (see docs/WORKSPACE_SETUP.md)"
echo "  3. npm run inventory"
echo "  4. npm run bootstrap -- --dry-run"
echo "  5. npm start"
echo "  6. #ideate LOOP: npm run bootstrap (creates #ideate) then /loop auto <idea>"
echo
if [[ -x "$HOME/.slack/bin/slack" ]]; then
  echo "Slack CLI: $HOME/.slack/bin/slack"
  "$HOME/.slack/bin/slack" auth list || true
else
  echo "Slack CLI not found. Install: curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash"
fi
