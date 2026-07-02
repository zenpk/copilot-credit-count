import * as path from 'path';
import * as vscode from 'vscode';
import { refreshDashboard, showDashboard } from './dashboard';
import { CreditsStorage } from './storage';
import { CopilotCreditsWatcher, type UsageEvent } from './watcher';

const SHOW_DASHBOARD_COMMAND = 'copilot-credit-count.showDashboard';
const OPEN_STORAGE_FILE_COMMAND = 'copilot-credit-count.openStorageFile';
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let storage: CreditsStorage;
let watcher: CopilotCreditsWatcher;
let statusBar: vscode.StatusBarItem;
let storageErrorShown = false;

export function activate(context: vscode.ExtensionContext): void {
  storage = new CreditsStorage(storageDirFor(context));
  statusBar = createStatusBarItem();
  watcher = new CopilotCreditsWatcher(scanDirsFor(context));

  watcher.on('usage', recordUsage);
  watcher.start();
  updateStatusBar();

  context.subscriptions.push(
    vscode.commands.registerCommand(SHOW_DASHBOARD_COMMAND, () => showDashboard(context, storage)),
    vscode.commands.registerCommand(OPEN_STORAGE_FILE_COMMAND, openStorageFile),
    statusBar,
    { dispose: () => watcher.stop() },
  );
}

export function deactivate(): void {
  watcher?.stop();
}

function createStatusBarItem(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = SHOW_DASHBOARD_COMMAND;
  item.show();
  return item;
}

function recordUsage(event: UsageEvent): void {
  try {
    const entry = storage.add(event);
    if (!entry) return;

    updateStatusBar();
    refreshDashboard(storage);
  } catch (error) {
    if (storageErrorShown) return;
    storageErrorShown = true;
    vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Unable to record Copilot credit usage.');
  }
}

async function openStorageFile(): Promise<void> {
  const month = await pickStorageMonth();
  if (!month) return;

  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(storage.getMonthFilePath(month)));
  await vscode.window.showTextDocument(document, { preview: false });
}

async function pickStorageMonth(): Promise<string | undefined> {
  const months = storage.getAvailableMonths();
  if (months.length === 0) {
    vscode.window.showInformationMessage('No credit data files found.');
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    months.map((month) => ({
      label: monthLabel(month),
      description: month,
      month,
    })),
    { placeHolder: 'Select month to open' },
  );

  return picked?.month;
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return `${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

function updateStatusBar(): void {
  const now = new Date();
  const entries = storage.getByMonth(now.getFullYear(), now.getMonth() + 1);
  const summary = storage.summarize(entries);

  statusBar.text = `$(credit-card) $${(summary.totalCredits / 100).toFixed(2)}`;
  statusBar.tooltip = `Copilot Credits this month: ${summary.totalCredits.toFixed(1)}\nClick to open dashboard`;
}

function storageDirFor(context: vscode.ExtensionContext): string {
  return vscode.Uri.joinPath(context.globalStorageUri, '..', '..', '..', 'copilot-credit-count').fsPath;
}

function scanDirsFor(context: vscode.ExtensionContext): string[] {
  const userDir = vscode.Uri.joinPath(context.globalStorageUri, '..', '..').fsPath;
  return [
    path.join(userDir, 'workspaceStorage'),
    path.join(userDir, 'globalStorage', 'emptyWindowChatSessions'),
  ];
}
