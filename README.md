# Copilot Credit Count

\*Vibe coded\*

Track and visualize your GitHub Copilot credit usage directly in VS Code.

## Features

- **Real-time tracking** — Records Copilot credit usage from the moment the extension is installed; only new usage is counted.
- **Interactive dashboard** — Filter by month or model, sort by date or credits, and view per-model breakdowns.
- **Status bar** — Shows your current month's credit total at a glance.
- **Monthly storage** — Credit data is appended to monthly JSON files; existing entries are never regenerated or removed by the extension.

## Usage

1. Install the extension.
2. Use Copilot as you normally would — credits are tracked automatically.
3. Click the credit count in the status bar, or run **Copilot Credits: Show Dashboard** from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

## How It Works

The extension watches VS Code's Copilot Chat session files (`workspaceStorage/*/chatSessions/` and `globalStorage/emptyWindowChatSessions/`) and records credit usage as new data is written. Past usage before install is not backfilled. Data is appended into monthly JSON files stored in your user data directory.

## Data Storage

Credit data is stored at:

- **Windows:** `%APPDATA%/Code/User/copilot-credit-count/`
- **macOS:** `~/Library/Application Support/Code/User/copilot-credit-count/`
- **Linux:** `~/.config/Code/User/copilot-credit-count/`

Each month gets its own file (e.g. `credits-2025-06.json`).

## License

MIT
