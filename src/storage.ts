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

type NewCreditEntry = Omit<CreditEntry, 'id'>;

interface IndexedEntry {
  month: string;
  entry: CreditEntry;
}

const MONTH_FILE_RE = /^credits-(\d{4}-\d{2})\.json$/;

export class CreditsStorage {
  private readonly latestBySourceId = new Map<string, IndexedEntry>();

  constructor(private readonly storageDir: string) {
    fs.mkdirSync(storageDir, { recursive: true });
    this.rebuildIndex();
  }

  add(input: NewCreditEntry): CreditEntry | undefined {
    const normalized = this.normalize(input);
    if (!normalized) return undefined;

    const known = this.latestBySourceId.get(normalized.sourceId);
    if (known && !this.isNewInformation(known.entry, normalized)) return undefined;

    const entry: CreditEntry = {
      id: this.createId(),
      ...this.mergeWithKnownEntry(normalized, known?.entry),
    };
    const month = known?.month ?? this.monthKey(entry.timestamp);

    this.appendToMonthFile(month, entry);
    this.latestBySourceId.set(entry.sourceId, { month, entry });

    return entry;
  }

  getByMonth(year: number, month: number): CreditEntry[] {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    return this.currentEntries(this.readMonthFile(this.monthFilePath(monthKey)));
  }

  getAll(): CreditEntry[] {
    const entries: CreditEntry[] = [];
    for (const filePath of this.listMonthFiles()) {
      entries.push(...this.readMonthFile(filePath));
    }
    return this.currentEntries(entries);
  }

  getAvailableMonths(): string[] {
    return this.listMonthFiles()
      .map((filePath) => this.monthFromFilePath(filePath))
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
    const filePath = this.monthFilePath(month);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '[]\n', 'utf8');
    }
    return filePath;
  }

  summarize(entries: CreditEntry[]): Summary {
    return entries.reduce<Summary>(
      (summary, entry) => ({
        count: summary.count + 1,
        totalCredits: summary.totalCredits + entry.credits,
      }),
      { count: 0, totalCredits: 0 },
    );
  }

  private rebuildIndex(): void {
    this.latestBySourceId.clear();

    for (const filePath of this.listMonthFiles()) {
      const month = this.monthFromFilePath(filePath);
      for (const entry of this.readMonthFile(filePath)) {
        this.latestBySourceId.set(entry.sourceId, { month, entry });
      }
    }
  }

  private normalize(input: NewCreditEntry): NewCreditEntry | undefined {
    const credits = Number(input.credits);
    if (!input.sourceId || !Number.isFinite(credits) || credits <= 0) return undefined;

    const timestamp = this.validTimestamp(input.timestamp) ? input.timestamp : new Date().toISOString();

    return {
      sourceId: input.sourceId,
      timestamp,
      credits,
      model: this.cleanOptionalText(input.model),
      context: this.cleanOptionalText(input.context),
    };
  }

  private validTimestamp(timestamp: string): boolean {
    return typeof timestamp === 'string' && Number.isFinite(new Date(timestamp).getTime());
  }

  private cleanOptionalText(value: string | undefined): string | undefined {
    const cleaned = value?.trim();
    return cleaned ? cleaned : undefined;
  }

  private isNewInformation(known: CreditEntry, next: NewCreditEntry): boolean {
    if (next.credits > known.credits) return true;
    if (next.credits < known.credits) return false;

    return Boolean(
      (next.model && next.model !== known.model)
      || (!known.context && next.context),
    );
  }

  private mergeWithKnownEntry(next: NewCreditEntry, known: CreditEntry | undefined): NewCreditEntry {
    return {
      sourceId: next.sourceId,
      timestamp: next.timestamp,
      credits: next.credits,
      model: next.model ?? known?.model,
      context: next.context ?? known?.context,
    };
  }

  private listMonthFiles(): string[] {
    try {
      return fs
        .readdirSync(this.storageDir)
        .filter((fileName) => MONTH_FILE_RE.test(fileName))
        .map((fileName) => path.join(this.storageDir, fileName))
        .sort();
    } catch {
      return [];
    }
  }

  private readMonthFile(filePath: string): CreditEntry[] {
    if (!fs.existsSync(filePath)) return [];

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((value) => {
        const entry = this.toCreditEntry(value);
        return entry ? [entry] : [];
      });
    } catch {
      return [];
    }
  }

  private toCreditEntry(value: unknown): CreditEntry | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const credits = Number(record.credits);

    if (
      typeof record.id !== 'string'
      || typeof record.sourceId !== 'string'
      || typeof record.timestamp !== 'string'
      || !Number.isFinite(credits)
      || credits <= 0
    ) {
      return undefined;
    }

    return {
      id: record.id,
      sourceId: record.sourceId,
      timestamp: record.timestamp,
      credits,
      model: typeof record.model === 'string' ? record.model : undefined,
      context: typeof record.context === 'string' ? record.context : undefined,
    };
  }

  private currentEntries(entries: CreditEntry[]): CreditEntry[] {
    const latest = new Map<string, CreditEntry>();
    for (const entry of entries) {
      latest.set(entry.sourceId, entry);
    }
    return this.sortEntries([...latest.values()]);
  }

  private sortEntries(entries: CreditEntry[]): CreditEntry[] {
    return [...entries].sort((a, b) => {
      const timestampDelta = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return timestampDelta || a.id.localeCompare(b.id);
    });
  }

  private appendToMonthFile(month: string, entry: CreditEntry): void {
    const filePath = this.monthFilePath(month);
    const entryJson = this.indent(JSON.stringify(entry, null, 2));

    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      fs.writeFileSync(filePath, `[\n${entryJson}\n]\n`, 'utf8');
      return;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const closeIndex = this.findArrayCloseIndex(content);
    if (closeIndex < 0) {
      throw new Error(`Cannot append credit entry because ${filePath} is not a JSON array.`);
    }

    const hasEntries = this.hasArrayEntries(content.slice(0, closeIndex));
    const addition = hasEntries ? `,\n${entryJson}\n]` : `\n${entryJson}\n]`;
    const byteOffset = Buffer.byteLength(content.slice(0, closeIndex), 'utf8');
    const fd = fs.openSync(filePath, 'r+');

    try {
      fs.writeSync(fd, addition, byteOffset, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  private findArrayCloseIndex(content: string): number {
    for (let i = content.length - 1; i >= 0; i--) {
      const char = content[i];
      if (/\s/.test(char)) continue;
      return char === ']' ? i : -1;
    }
    return -1;
  }

  private hasArrayEntries(beforeClose: string): boolean {
    return beforeClose.replace(/^\s*\[/, '').trim().length > 0;
  }

  private indent(json: string): string {
    return json
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n');
  }

  private monthFilePath(month: string): string {
    return path.join(this.storageDir, `credits-${month}.json`);
  }

  private monthFromFilePath(filePath: string): string {
    return path.basename(filePath).replace(/^credits-/, '').replace(/\.json$/, '');
  }

  private monthKey(timestamp: string): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
