#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_home="${WAKE_UP_CLAUDE_HOME:-"$HOME/.wake-up-claude"}"
unit_dir="${XDG_CONFIG_HOME:-"$HOME/.config"}/systemd/user"
: "${DISPLAY:?DISPLAY must be set in the invoking graphical session}"
: "${XAUTHORITY:?XAUTHORITY must be set in the invoking graphical session}"

cd "$script_dir"
npm install
npm run build
mkdir -p "$app_home" "$unit_dir"
printf 'DISPLAY=%s\nXAUTHORITY=%s\n' "$DISPLAY" "$XAUTHORITY" > "$app_home/display.env"
ln -sfn "$script_dir" "$app_home/app"
ln -sfn "$script_dir/systemd/wake-up-claude.service" "$unit_dir/wake-up-claude.service"
ln -sfn "$script_dir/systemd/wake-up-claude.timer" "$unit_dir/wake-up-claude.timer"
systemctl --user daemon-reload
systemctl --user enable --now wake-up-claude.timer
