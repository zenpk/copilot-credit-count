import * as path from 'path';
import * as vscode from 'vscode';
import { showDashboard, refreshDashboard } from './dashboard';
import type { CreditEntry } from './storage';
import { CreditsStorage } from './storage';
import type { UsageEvent } from './watcher';
import { CopilotCreditsWatcher } from './watcher';

let storage: CreditsStorage;
let watcher: CopilotCreditsWatcher;
let statusBar: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  const storageDir = path.join(context.globalStorageUri.fsPath, '..', '..', '..', 'copilot-credit-count');
  storage = new CreditsStorage(storageDir);

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'copilotCredits.showDashboard';
  statusBar.tooltip = 'Copilot Credits — click to open dashboard';
  updateStatusBar();
  statusBar.show();

  const userDir = path.resolve(context.globalStorageUri.fsPath, '..', '..');
  const workspaceStorageDir = path.join(userDir, 'workspaceStorage');

  watcher = new CopilotCreditsWatcher(workspaceStorageDir);
  watcher.on('usage', (event: UsageEvent) => {
    const entry = storage.add(event);
    if (entry) {
      updateStatusBar();
      refreshDashboard(storage);
    }
  });
  watcher.start();

  context.subscriptions.push(
    vscode.commands.registerCommand('copilotCredits.showDashboard', () => showDashboard(context, storage)),
    statusBar,
    { dispose: () => watcher.stop() },
  );
}

function updateStatusBar() {
  const now = new Date();
  const entries = storage.getByMonth(now.getFullYear(), now.getMonth() + 1);
  const s = storage.summarize(entries);
  statusBar.text = `$(credit-card) ${s.totalCredits.toFixed(1)} credits`;
}

export function deactivate() {}
