import * as path from 'path';
import * as vscode from 'vscode';
import { showDashboard, refreshDashboard } from './dashboard';
import { CreditsStorage } from './storage';
import type { UsageEvent } from './watcher';
import { CopilotCreditsWatcher } from './watcher';

let storage: CreditsStorage;
let watcher: CopilotCreditsWatcher;
let statusBar: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  const storageDir = vscode.Uri.joinPath(context.globalStorageUri, '..', '..', '..', 'copilot-credit-count').fsPath;
  storage = new CreditsStorage(storageDir);

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'copilot-credit-count.showDashboard';
  statusBar.tooltip = 'Copilot Credits — click to open dashboard';
  updateStatusBar();
  statusBar.show();

  const userDir = vscode.Uri.joinPath(context.globalStorageUri, '..', '..').fsPath;
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
    vscode.commands.registerCommand('copilot-credit-count.showDashboard', () =>
      showDashboard(context, storage),
    ),
    vscode.commands.registerCommand('copilot-credit-count.openStorageFile', async () => {
      const filePath = storage.getCurrentMonthFilePath();
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      await vscode.window.showTextDocument(doc, { preview: false });
    }),
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
