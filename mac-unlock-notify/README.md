# mac-unlock-notify

A security tool to notify your iPhone in Slack whenever your Mac is unlocked in your absence.

Plug-and-play on any personal Mac: clone, run `./install.sh`, paste a Slack incoming webhook. A LaunchAgent watches lock state with `ioreg` and `curl`s Slack on **locked → unlocked** only.

```text
unlock → ioreg → zsh watcher → curl → Slack webhook → iPhone banner
```

## Requirements

- macOS (tested on recent versions including Tahoe)
- Slack workspace you can add an app to
- Slack iOS app with notifications allowed
- `zsh`, `curl`, `python3`, and `ioreg` (all stock on macOS)

## 1. Slack (once)

1. Create a **private** channel, e.g. `#mac-unlock`.
2. Open [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.
3. Name it `Mac Unlock`, pick your workspace.
4. **Incoming Webhooks** → On → **Add New Webhook to Workspace** → select `#mac-unlock`.
5. Copy the URL (`https://hooks.slack.com/services/…`). Treat it as a password.
6. In that channel, notify on **All messages**.
7. Slack **Preferences → Notifications → When I'm not active on desktop → Immediately, even if I'm active**.
   Without this, Slack on the Mac you just unlocked often swallows the iPhone banner. See [Slack notification settings](https://slack.com/help/articles/201355156-Configure-your-Slack-notifications).
8. On iPhone: Slack notifications on; allow Slack in any Focus mode.

## 2. Install on this Mac

```zsh
git clone https://github.com/splitintech/open-internal-tools.git
cd open-internal-tools/mac-unlock-notify
chmod +x install.sh uninstall.sh bin/mac-unlock-notify
./install.sh
```

You will be asked for the webhook (input is hidden). The installer:

- writes `~/.config/mac-unlock-notify/env` (mode `600`)
- copies the watcher to `~/.local/libexec/mac-unlock-notify/`
- loads `~/Library/LaunchAgents/com.mac-unlock-notify.plist`
- sends one Slack test unless you pass `--skip-test`

Non-interactive:

```zsh
./install.sh --webhook 'https://hooks.slack.com/services/T…/B…/…'
./install.sh --webhook "$SLACK_WEBHOOK" --skip-test
```

The clone can be deleted after install. Re-run `./install.sh` from a fresh clone to upgrade.

## 3. Confirm it works

```zsh
~/.local/bin/mac-unlock-notify --status    # unlocked or locked
~/.local/bin/mac-unlock-notify --test      # one Slack message
```

Then lock the Mac (`Control-Command-Q`), wait a second, unlock. You should get **one** Slack message with computer name and local time.

If `~/.local/bin` is not on your `PATH`:

```zsh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
```

Logs: `~/Library/Logs/mac-unlock-notify.log`

## Uninstall

```zsh
./uninstall.sh           # keep webhook
./uninstall.sh --purge   # also delete ~/.config/mac-unlock-notify
```

## Behavior

| Event | Slack? |
|---|---|
| Agent starts while already unlocked | No |
| Lid open, lock screen still up | No |
| Password / Touch ID / Apple Watch unlock | Yes |
| Fast double unlock within 5s | One message (debounced) |
| Slack HTTP error | Logged; watcher keeps running |

## Security

- The webhook is a secret. Anyone with it can post to your channel.
- It is never stored in this repo. `env.example` is a placeholder only.
- Do not commit `~/.config/mac-unlock-notify/env`.
- This is a user LaunchAgent, not a system daemon. It runs only while you are logged in.

## Commands

| Command | What it does |
|---|---|
| `./install.sh` | Install or reinstall for the current user |
| `./uninstall.sh` | Remove the agent and copied files |
| `mac-unlock-notify --watch` | Foreground watcher (LaunchAgent uses this) |
| `mac-unlock-notify --test` | Send one Slack message |
| `mac-unlock-notify --status` | Print `locked` or `unlocked` |

## License

MIT. See [LICENSE](LICENSE).
