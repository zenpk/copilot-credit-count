import * as fs from 'fs';
import * as path from 'path';

export interface CreditEntry {
  id: string;
  sourceId: string;
  timestamp: string;
  credits: number;
  model?: string;
  context?: string;
}

export interface Summary {
  count: number;
  totalCredits: number;
}

interface SeenEntry {
  month: string;
  credits: number;
  model?: string;
  context?: string;
}

export class CreditsStorage {
  private readonly storageDir: string;
  private readonly seenIds = new Map<string, SeenEntry>();

  constructor(storageDir: string) {
    fs.mkdirSync(storageDir, { recursive: true });
    this.storageDir = storageDir;
    this.loadSeenIds();
  }

  private loadSeenIds(): void {
    for (const file of this.listMonthFiles()) {
      const month = this.monthFromFile(file);
      for (const e of this.readFile(file)) {
        this.seenIds.set(e.sourceId, {
          month,
          credits: Number(e.credits) || 0,
          model: e.model,
          context: e.context,
        });
      }
    }
  }

  private listMonthFiles(): string[] {
    try {
      return fs
        .readdirSync(this.storageDir)
        .filter((f) => /^credits-\d{4}-\d{2}\.json$/.test(f))
        .map((f) => path.join(this.storageDir, f))
        .sort();
    } catch {
      return [];
    }
  }

  private monthKey(ts: string): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private fileForMonth(month: string): string {
    return path.join(this.storageDir, `credits-${month}.json`);
  }

  private monthFromFile(filePath: string): string {
    return path.basename(filePath).replace(/^credits-/, '').replace(/\.json$/, '');
  }

  private readFile(filePath: string): CreditEntry[] {
    if (!fs.existsSync(filePath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry): entry is CreditEntry => this.isCreditEntry(entry));
    } catch {
      return [];
    }
  }

  private isCreditEntry(entry: unknown): entry is CreditEntry {
    if (!entry || typeof entry !== 'object') return false;
    const obj = entry as Record<string, unknown>;
    return (
      typeof obj.id === 'string'
      && typeof obj.sourceId === 'string'
      && typeof obj.timestamp === 'string'
      && typeof obj.credits === 'number'
    );
  }

  private writeFile(filePath: string, entries: CreditEntry[]): void {
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  private createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  private shouldAppend(existing: SeenEntry, entry: Omit<CreditEntry, 'id'>, credits: number): boolean {
    if (credits > existing.credits) return true;
    if (credits < existing.credits) return false;

    return Boolean(
      (entry.model && entry.model !== existing.model)
      || (entry.context && entry.context !== existing.context),
    );
  }

  private mergeEntry(existing: SeenEntry | undefined, entry: Omit<CreditEntry, 'id'>, credits: number): Omit<CreditEntry, 'id'> {
    return {
      sourceId: entry.sourceId,
      timestamp: entry.timestamp,
      credits,
      model: entry.model ?? existing?.model,
      context: entry.context ?? existing?.context,
    };
  }

  private sortEntries(entries: CreditEntry[]): CreditEntry[] {
    return [...entries].sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      return ta !== tb ? ta - tb : a.id.localeCompare(b.id);
    });
  }

  private collapseEntries(entries: CreditEntry[]): CreditEntry[] {
    const latestBySourceId = new Map<string, CreditEntry>();
    for (const entry of entries) {
      if (!entry.sourceId) continue;
      latestBySourceId.set(entry.sourceId, entry);
    }
    return this.sortEntries([...latestBySourceId.values()]);
  }

  add(entry: Omit<CreditEntry, 'id'>): CreditEntry | undefined {
    const credits = Number(entry.credits);
    if (!Number.isFinite(credits) || credits <= 0) return undefined;

    const existing = this.seenIds.get(entry.sourceId);
    if (existing && !this.shouldAppend(existing, entry, credits)) return undefined;

    // Keep revisions in the original month so the history stays append-only.
    const month = existing?.month ?? this.monthKey(entry.timestamp);
    const filePath = this.fileForMonth(month);
    const entries = this.readFile(filePath);
    const newEntry: CreditEntry = {
      id: this.createId(),
      ...this.mergeEntry(existing, entry, credits),
    };
    entries.push(newEntry);
    this.writeFile(filePath, entries);
    this.seenIds.set(entry.sourceId, {
      month,
      credits,
      model: newEntry.model,
      context: newEntry.context,
    });
    return newEntry;
  }

  getByMonth(year: number, month: number): CreditEntry[] {
    const m = `${year}-${String(month).padStart(2, '0')}`;
    return this.collapseEntries(this.readFile(this.fileForMonth(m)));
  }

  getAll(): CreditEntry[] {
    const all: CreditEntry[] = [];
    for (const file of this.listMonthFiles()) {
      all.push(...this.readFile(file));
    }
    return this.collapseEntries(all);
  }

  getAvailableMonths(): string[] {
    return this.listMonthFiles()
      .map((f) => path.basename(f).replace(/^credits-/, '').replace(/\.json$/, ''))
      .sort()
      .reverse();
  }

  getAvailableModels(): string[] {
    const models = new Set<string>();
    for (const entry of this.getAll()) {
      if (entry.model) models.add(entry.model);
    }
    return [...models].sort();
  }

  getMonthFilePath(month: string): string {
    const filePath = this.fileForMonth(month);
    if (!fs.existsSync(filePath)) {
      this.writeFile(filePath, []);
    }
    return filePath;
  }

  summarize(entries: CreditEntry[]): Summary {
    return entries.reduce<Summary>(
      (acc, e) => ({
        count: acc.count + 1,
        totalCredits: acc.totalCredits + (Number(e.credits) || 0),
      }),
      { count: 0, totalCredits: 0 },
    );
  }
}
