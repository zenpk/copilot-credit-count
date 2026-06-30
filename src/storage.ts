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

export class CreditsStorage {
  private readonly storageDir: string;
  private readonly seenIds = new Map<string, { month: string; credits: number }>();

  constructor(storageDir: string) {
    fs.mkdirSync(storageDir, { recursive: true });
    this.storageDir = storageDir;
    this.loadSeenIds();
  }

  private loadSeenIds(): void {
    for (const file of this.listMonthFiles()) {
      for (const e of this.readFile(file)) {
        const month = this.monthKey(e.timestamp);
        const existing = this.seenIds.get(e.sourceId);
        if (!existing || e.credits > existing.credits) {
          this.seenIds.set(e.sourceId, { month, credits: e.credits });
        }
      }
    }
  }

  private listMonthFiles(): string[] {
    try {
      return fs
        .readdirSync(this.storageDir)
        .filter((f) => /^credits-\d{4}-\d{2}\.json$/.test(f))
        .map((f) => path.join(this.storageDir, f));
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

  private readFile(filePath: string): CreditEntry[] {
    if (!fs.existsSync(filePath)) return [];
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CreditEntry[];
    } catch {
      return [];
    }
  }

  private writeFile(filePath: string, entries: CreditEntry[]): void {
    const sorted = [...entries].sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      return ta !== tb ? ta - tb : a.id.localeCompare(b.id);
    });
    fs.writeFileSync(filePath, JSON.stringify(sorted, null, 2), 'utf-8');
  }

  add(entry: Omit<CreditEntry, 'id'>): CreditEntry | undefined {
    if ((Number(entry.credits) || 0) <= 0) return undefined;

    const existing = this.seenIds.get(entry.sourceId);

    if (existing) {
      if (entry.credits <= existing.credits) return undefined;

      const entries = this.readFile(this.fileForMonth(existing.month));
      const idx = entries.findIndex((e) => e.sourceId === entry.sourceId);
      if (idx >= 0) {
        const updated: CreditEntry = {
          ...entries[idx],
          timestamp: entry.timestamp,
          credits: entry.credits,
          model: entry.model || entries[idx].model,
          context: entry.context || entries[idx].context,
        };
        entries[idx] = updated;
        this.writeFile(this.fileForMonth(existing.month), entries);
        this.seenIds.set(entry.sourceId, { month: existing.month, credits: entry.credits });
        return updated;
      }
    }

    const month = this.monthKey(entry.timestamp);
    const filePath = this.fileForMonth(month);
    const entries = this.readFile(filePath);
    const newEntry: CreditEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ...entry,
    };
    entries.push(newEntry);
    this.writeFile(filePath, entries);
    this.seenIds.set(entry.sourceId, { month, credits: entry.credits });
    return newEntry;
  }

  getByMonth(year: number, month: number): CreditEntry[] {
    const m = `${year}-${String(month).padStart(2, '0')}`;
    return this.readFile(this.fileForMonth(m));
  }

  getAll(): CreditEntry[] {
    const all: CreditEntry[] = [];
    for (const file of this.listMonthFiles()) {
      all.push(...this.readFile(file));
    }
    return all.sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      return ta !== tb ? ta - tb : a.id.localeCompare(b.id);
    });
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
