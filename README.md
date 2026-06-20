# wake-up-claude

Scheduled browser automation that sends a single message to [claude.ai](https://claude.ai) every morning, starting the usage-limit reset window earlier in the day.

## Description

A small Playwright/TypeScript tool that opens Brave, navigates to `claude.ai/new`, sends one message, waits for the response to finish streaming, and closes the window. Triggered daily via a systemd user timer.

## Suggested GitHub topics

`automation` `playwright`

## Why

Claude's usage limit resets on a rolling window after your first message of the period. If that first message happens late in the morning, the reset lands at an inconvenient time. This tool sends that first message automatically at a fixed early hour, so the reset window aligns with your actual work schedule instead of whenever you happen to open a chat.

## How it works

1. A systemd user timer fires daily at a configured time
2. Playwright launches Brave using an **isolated, dedicated browser profile** — never your daily-driver profile
3. Closes any stale tabs left over from previous runs, keeping one working tab
4. It waits for `claude.ai/new` to finish loading
5. Types `0` into the chat input and submits it
6. Waits for Claude's response to finish streaming (detected via UI state, not a fixed delay)
7. Closes the browser window

The isolated profile is intentional. Using a real daily-driver profile risks session invalidation and profile corruption from automated access. A separate profile, logged in once, keeps your everyday browsing session completely untouched while still authenticating as your real Claude account.

## Tech stack

- TypeScript (strict mode)
- Node.js
- [Playwright](https://playwright.dev/) (`playwright`, not `@playwright/test`)
- Brave Browser
- systemd user timers (Linux scheduling)

## Prerequisites

- Linux with systemd and an active graphical session
- Node.js and npm
- Brave Browser installed
- A Claude account you can log into manually once

## Installation

```bash
git clone https://github.com/<your-username>/wake-up-claude.git
cd wake-up-claude
chmod +x install.sh
./install.sh
```

`install.sh` runs `npm install`, builds the TypeScript source, symlinks the systemd unit files into `~/.config/systemd/user/`, reloads the systemd user daemon, and enables the timer.

## First-run login (required, one-time)

The isolated profile starts with no session. Before the scheduled timer can run unattended, log in once manually:

```bash
node dist/index.js
```

This opens Brave and navigates to Claude's login page. Complete the login in that window, then return to the terminal and press Enter to continue. The session is saved inside the isolated profile directory and reused automatically by every future run — manual or scheduled.

## Configuration

Environment variables, all optional:

| Variable | Purpose | Default |
|---|---|---|
| `WAKE_UP_CLAUDE_HOME` | Base directory for the isolated profile and logs | `~/.wake-up-claude` |
| `BRAVE_EXECUTABLE_PATH` | Explicit path to the Brave binary | Auto-detected from common Linux install locations |

The scheduled time is set in `systemd/wake-up-claude.timer`. Edit the `OnCalendar` value and re-run `systemctl --user daemon-reload` to change it.

## Checking status

```bash
systemctl --user status wake-up-claude.timer
journalctl --user -u wake-up-claude.service -n 50 --no-pager
tail -n 20 ~/.wake-up-claude/logs/run.log
```

## Running a test manually

```bash
systemctl --user start wake-up-claude.service
```

This triggers an immediate run without waiting for the scheduled time.

## Known constraints

- Requires `DISPLAY` and `XAUTHORITY` to match the currently active graphical session. If these change (different display number after a reboot, different session type), the systemd service file needs to be updated accordingly.
- The isolated Brave profile must remain logged in. If Claude's session expires, re-run `node dist/index.js` interactively to log in again.
- Designed for a single active graphical session on a personal Linux machine, not a headless server.

## Project structure

```
wake-up-claude/
├── src/index.ts
├── package.json
├── tsconfig.json
├── systemd/
│   ├── wake-up-claude.service
│   └── wake-up-claude.timer
└── install.sh
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.

