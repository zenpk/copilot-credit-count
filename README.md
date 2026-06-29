# Copilot Credit Count

\*Vibe coded\*

Track and visualize your GitHub Copilot credit usage directly in VS Code.

## Features

- **Real-time tracking** — Automatically detects Copilot credit usage by monitoring chat session files.
- **Interactive dashboard** — Filter by month or model, sort by date or credits, and view per-model breakdowns.
- **Status bar** — Shows your current month's credit total at a glance.
- **Monthly storage** — Credit data is stored in separate monthly JSON files for clean isolation.

## Usage

1. Install the extension.
2. Use Copilot as you normally would — credits are tracked automatically.
3. Click the credit count in the status bar, or run **Copilot Credits: Show Dashboard** from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

## How It Works

The extension reads VS Code's Copilot Chat session files (`workspaceStorage/*/chatSessions/*.jsonl`) to extract credit usage data including the model used, credit cost, and conversation context. Data is aggregated into monthly JSON files stored in your user data directory.

## Data Storage

Credit data is stored at:

- **Windows:** `%APPDATA%/Code/User/copilot-credit-count/`
- **macOS:** `~/Library/Application Support/Code/User/copilot-credit-count/`
- **Linux:** `~/.config/Code/User/copilot-credit-count/`

Each month gets its own file (e.g. `credits-2025-06.json`).

## License

MIT
