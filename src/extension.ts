import * as path from 'path';
import * as vscode from 'vscode';
import { showDashboard, refreshDashboard } from './dashboard';
import { CreditsStorage } from './storage';
import type { UsageEvent } from './watcher';
import { CopilotCreditsWatcher } from './watcher';

let storage: CreditsStorage;
let watcher: CopilotCreditsWatcher;
let statusBar: vscode.StatusBarItem;

function onUsage(event: UsageEvent) {
  const entry = storage.add(event);
  if (entry) {
    updateStatusBar();
    refreshDashboard(storage);
  }
}

function getScanDirs(userDir: string): string[] {
  return [
    path.join(userDir, 'workspaceStorage'),
    path.join(userDir, 'globalStorage', 'emptyWindowChatSessions'),
  ];
}

export function activate(context: vscode.ExtensionContext) {
  const storageDir = vscode.Uri.joinPath(context.globalStorageUri, '..', '..', '..', 'copilot-credit-count').fsPath;
  storage = new CreditsStorage(storageDir);

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'copilot-credit-count.showDashboard';
  updateStatusBar();
  statusBar.show();

  const userDir = vscode.Uri.joinPath(context.globalStorageUri, '..', '..').fsPath;
  watcher = new CopilotCreditsWatcher(getScanDirs(userDir));
  watcher.on('usage', onUsage);
  watcher.start();

  context.subscriptions.push(
    vscode.commands.registerCommand('copilot-credit-count.showDashboard', () =>
      showDashboard(context, storage),
    ),
    vscode.commands.registerCommand('copilot-credit-count.openStorageFile', cmdOpenStorageFile),
    statusBar,
    { dispose: () => watcher.stop() },
  );
}

async function cmdOpenStorageFile() {
  const months = storage.getAvailableMonths();
  if (months.length === 0) {
    vscode.window.showInformationMessage('No credit data files found.');
    return;
  }

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const items = months.map((m) => {
    const [y, mo] = m.split('-').map(Number);
    return { label: `${MONTH_NAMES[mo - 1]} ${y}`, description: m, month: m };
  });

  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select month to open' });
  if (!picked) return;

  const filePath = storage.getMonthFilePath(picked.month);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(doc, { preview: false });
}

function updateStatusBar() {
  const now = new Date();
  const entries = storage.getByMonth(now.getFullYear(), now.getMonth() + 1);
  const s = storage.summarize(entries);
  statusBar.text = `$(credit-card) $${(s.totalCredits / 100).toFixed(2)}`;
  statusBar.tooltip = `Copilot Credits this month: ${s.totalCredits.toFixed(1)}\nClick to open dashboard`;
}

export function deactivate() {}
