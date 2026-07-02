import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

export interface UsageEvent {
  sourceId: string;
  timestamp: string;
  credits: number;
  model?: string;
  context?: string;
}

interface FileCursor {
  offset: number;
  size: number;
  mtimeMs: number;
}

interface SessionState {
  title?: string;
  requests: Map<number, RequestState>;
}

interface RequestState {
  requestId?: string;
  timestamp?: number;
  credits?: number;
  model?: string;
  context?: string;
}

interface ChatDelta {
  kind?: number;
  k?: Array<string | number>;
  v?: unknown;
}

const MODEL_FIELDS = ['model', 'modelSlug', 'modelId', 'chatModelId', 'selectedModelId'];

export class CopilotCreditsWatcher extends EventEmitter {
  private readonly directoryWatchers: fs.FSWatcher[] = [];
  private readonly fileWatchers = new Map<string, fs.FSWatcher>();
  private readonly cursors = new Map<string, FileCursor>();
  private readonly trackedChatDirs = new Set<string>();
  private readonly sessions = new Map<string, SessionState>();

  constructor(private readonly scanDirs: string[]) {
    super();
  }

  start(): void {
    for (const scanDir of this.scanDirs) {
      this.trackScanDir(scanDir);
    }
  }

  stop(): void {
    for (const watcher of this.directoryWatchers) watcher.close();
    for (const watcher of this.fileWatchers.values()) watcher.close();

    this.directoryWatchers.length = 0;
    this.fileWatchers.clear();
    this.cursors.clear();
    this.trackedChatDirs.clear();
    this.sessions.clear();
  }

  private trackScanDir(scanDir: string): void {
    if (!this.isDirectory(scanDir)) return;

    if (this.isChatSessionsDir(scanDir)) {
      this.trackChatDir(scanDir);
      return;
    }

    this.trackKnownWorkspaceDirs(scanDir);
    this.watchDirectory(scanDir, (entryName) => {
      this.trackWorkspaceDir(path.join(scanDir, entryName));
    });
  }

  private trackKnownWorkspaceDirs(scanDir: string): void {
    for (const entryName of this.readDirNames(scanDir)) {
      this.trackWorkspaceDir(path.join(scanDir, entryName));
    }
  }

  private trackWorkspaceDir(workspaceDir: string): void {
    const chatDir = path.join(workspaceDir, 'chatSessions');
    if (this.isDirectory(chatDir)) {
      this.trackChatDir(chatDir);
    }
  }

  private trackChatDir(chatDir: string): void {
    if (this.trackedChatDirs.has(chatDir)) return;
    this.trackedChatDirs.add(chatDir);

    for (const filePath of this.listSessionFiles(chatDir)) {
      this.fastForward(filePath);
      this.watchSessionFile(filePath);
    }

    this.watchDirectory(chatDir, (entryName) => {
      if (!this.isSessionFileName(entryName)) return;
      const filePath = path.join(chatDir, entryName);
      this.watchSessionFile(filePath);
      this.processSessionFile(filePath);
    });
  }

  private watchDirectory(dirPath: string, onEntry: (entryName: string) => void): void {
    try {
      const watcher = fs.watch(dirPath, { recursive: false, encoding: 'utf8' }, (_event, fileName) => {
        if (fileName) onEntry(fileName);
      });
      this.directoryWatchers.push(watcher);
    } catch {
      // Some VS Code storage dirs are transient or not watchable on startup.
    }
  }

  private watchSessionFile(filePath: string): void {
    if (this.fileWatchers.has(filePath)) return;

    try {
      const watcher = fs.watch(filePath, () => {
        this.processSessionFile(filePath);
      });
      this.fileWatchers.set(filePath, watcher);
    } catch {
      // The directory watcher will try again when VS Code finishes creating it.
    }
  }

  private processSessionFile(filePath: string): void {
    if (filePath.endsWith('.json')) {
      this.processJsonSession(filePath);
      return;
    }

    this.processJsonLinesSession(filePath);
  }

  private processJsonLinesSession(filePath: string): void {
    try {
      const stat = fs.statSync(filePath);
      const cursor = this.nextCursor(filePath, stat);
      if (stat.size <= cursor.offset) return;

      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(stat.size - cursor.offset);
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, cursor.offset);
      fs.closeSync(fd);

      this.cursors.set(filePath, {
        offset: cursor.offset + bytesRead,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });

      for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
        this.processJsonLine(filePath, line);
      }
    } catch {
      // Copilot can write these files in small chunks; the next event will retry.
    }
  }

  private processJsonSession(filePath: string): void {
    try {
      const stat = fs.statSync(filePath);
      const previous = this.cursors.get(filePath);
      if (previous && previous.size === stat.size && previous.mtimeMs === stat.mtimeMs) return;

      this.cursors.set(filePath, { offset: stat.size, size: stat.size, mtimeMs: stat.mtimeMs });
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
      if (this.isRecord(parsed)) {
        this.mergeSessionSnapshot(filePath, parsed);
      }
    } catch {
      // Ignore half-written legacy snapshots.
    }
  }

  private nextCursor(filePath: string, stat: fs.Stats): FileCursor {
    const previous = this.cursors.get(filePath);
    if (!previous) {
      return { offset: 0, size: stat.size, mtimeMs: stat.mtimeMs };
    }

    const rewritten = stat.size < previous.offset || (stat.mtimeMs !== previous.mtimeMs && stat.size <= previous.size);
    if (rewritten) {
      this.sessions.delete(filePath);
      return { offset: 0, size: stat.size, mtimeMs: stat.mtimeMs };
    }

    return previous;
  }

  private processJsonLine(filePath: string, rawLine: string): void {
    const line = rawLine.trim();
    if (!line) return;

    try {
      this.processDelta(filePath, JSON.parse(line) as ChatDelta);
    } catch {
      // Skip malformed fragments from in-progress writes.
    }
  }

  private processDelta(filePath: string, delta: ChatDelta): void {
    if (delta.kind === 0 && this.isRecord(delta.v)) {
      this.mergeSessionSnapshot(filePath, delta.v);
      return;
    }

    if (!Array.isArray(delta.k)) return;

    const key = delta.k;
    if (key.length === 1 && key[0] === 'customTitle' && typeof delta.v === 'string') {
      this.stateFor(filePath).title = delta.v;
      return;
    }

    if (key[0] !== 'requests') return;

    if (key.length === 1 && Array.isArray(delta.v)) {
      this.mergeRequestArray(filePath, 0, delta.v);
      return;
    }

    if (typeof key[1] !== 'number') return;
    const index = key[1];

    if (key.length === 2 && Array.isArray(delta.v)) {
      this.mergeRequestArray(filePath, index, delta.v);
      return;
    }

    this.mergeRequestField(filePath, index, key.slice(2), delta.v);
  }

  private mergeSessionSnapshot(filePath: string, snapshot: Record<string, unknown>): void {
    if (typeof snapshot.customTitle === 'string') {
      this.stateFor(filePath).title = snapshot.customTitle;
    }

    if (Array.isArray(snapshot.requests)) {
      this.mergeRequestArray(filePath, 0, snapshot.requests);
    }
  }

  private mergeRequestArray(filePath: string, startIndex: number, requests: unknown[]): void {
    requests.forEach((request, offset) => {
      if (!this.isRecord(request)) return;
      this.mergeRequestPatch(filePath, startIndex + offset, this.requestFromObject(filePath, request));
    });
  }

  private mergeRequestField(filePath: string, index: number, pathParts: Array<string | number>, value: unknown): void {
    const [field, nestedField] = pathParts;
    if (typeof field !== 'string') return;

    if (pathParts.length === 1) {
      if (field === 'requestId' && typeof value === 'string') {
        this.mergeRequestPatch(filePath, index, { requestId: value });
        return;
      }

      if (field === 'timestamp' && typeof value === 'number') {
        this.mergeRequestPatch(filePath, index, { timestamp: value });
        return;
      }

      if (field === 'copilotCredits' && typeof value === 'number') {
        this.mergeRequestPatch(filePath, index, { credits: value });
        return;
      }

      if (MODEL_FIELDS.includes(field)) {
        this.mergeRequestPatch(filePath, index, { model: this.modelFrom(value) });
        return;
      }

      if (field === 'message' && this.isRecord(value)) {
        this.mergeRequestPatch(filePath, index, { context: this.contextFromMessage(filePath, value) });
        return;
      }

      if ((field === 'result' || field === 'response') && this.isRecord(value)) {
        this.mergeRequestPatch(filePath, index, this.resultFromObject(value));
      }

      return;
    }

    if ((field !== 'result' && field !== 'response') || typeof nestedField !== 'string') return;

    if (nestedField === 'copilotCredits' && typeof value === 'number') {
      this.mergeRequestPatch(filePath, index, { credits: value });
      return;
    }

    if (nestedField === 'modelName' || MODEL_FIELDS.includes(nestedField)) {
      this.mergeRequestPatch(filePath, index, { model: this.modelFrom(value) });
    }
  }

  private mergeRequestPatch(filePath: string, index: number, patch: RequestState): void {
    const state = this.stateFor(filePath);
    const current = state.requests.get(index) ?? {};
    const next = this.compactRequestState({ ...current, ...patch });

    state.requests.set(index, next);
    this.emitIfComplete(next);
  }

  private compactRequestState(request: RequestState): RequestState {
    return {
      requestId: request.requestId,
      timestamp: request.timestamp,
      credits: request.credits,
      model: request.model,
      context: request.context,
    };
  }

  private requestFromObject(filePath: string, request: Record<string, unknown>): RequestState {
    return {
      requestId: typeof request.requestId === 'string' ? request.requestId : undefined,
      timestamp: typeof request.timestamp === 'number' ? request.timestamp : undefined,
      credits: this.creditsFromObject(request),
      model: this.firstModel(request, MODEL_FIELDS) ?? this.modelFromResult(request.result) ?? this.modelFromResult(request.response),
      context: this.contextFromMessage(filePath, request.message),
    };
  }

  private resultFromObject(result: Record<string, unknown>): RequestState {
    return {
      credits: typeof result.copilotCredits === 'number' ? result.copilotCredits : undefined,
      model: this.modelFrom(result.model) ?? this.modelFrom(result.modelName),
    };
  }

  private creditsFromObject(request: Record<string, unknown>): number | undefined {
    if (typeof request.copilotCredits === 'number') return request.copilotCredits;

    const resultCredits = this.creditsFromResult(request.result);
    if (resultCredits !== undefined) return resultCredits;

    return this.creditsFromResult(request.response);
  }

  private creditsFromResult(result: unknown): number | undefined {
    if (!this.isRecord(result)) return undefined;
    return typeof result.copilotCredits === 'number' ? result.copilotCredits : undefined;
  }

  private modelFromResult(result: unknown): string | undefined {
    if (!this.isRecord(result)) return undefined;
    return this.modelFrom(result.model) ?? this.modelFrom(result.modelName);
  }

  private firstModel(record: Record<string, unknown>, fields: string[]): string | undefined {
    for (const field of fields) {
      const model = this.modelFrom(record[field]);
      if (model) return model;
    }
    return undefined;
  }

  private modelFrom(value: unknown): string | undefined {
    if (typeof value === 'string') return this.cleanText(value);
    if (!this.isRecord(value)) return undefined;
    return this.firstString(value, ['id', 'name', 'modelId', 'slug']);
  }

  private contextFromMessage(filePath: string, message: unknown): string | undefined {
    const title = this.cleanText(this.stateFor(filePath).title);
    if (title) return title;

    if (!this.isRecord(message)) return undefined;
    return typeof message.text === 'string' ? this.cleanText(message.text, 100) : undefined;
  }

  private emitIfComplete(request: RequestState): void {
    if (!request.requestId || !request.credits || request.credits <= 0) return;

    this.emit('usage', {
      sourceId: request.requestId,
      timestamp: this.timestampFrom(request.timestamp),
      credits: request.credits,
      model: request.model,
      context: request.context,
    } satisfies UsageEvent);
  }

  private timestampFrom(timestamp: number | undefined): string {
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      return new Date(timestamp).toISOString();
    }
    return new Date().toISOString();
  }

  private stateFor(filePath: string): SessionState {
    const existing = this.sessions.get(filePath);
    if (existing) return existing;

    const created = { requests: new Map<number, RequestState>() };
    this.sessions.set(filePath, created);
    return created;
  }

  private fastForward(filePath: string): void {
    try {
      const stat = fs.statSync(filePath);
      this.cursors.set(filePath, { offset: stat.size, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch {
      // The file can disappear while Copilot tidies sessions.
    }
  }

  private listSessionFiles(dirPath: string): string[] {
    return this.readDirNames(dirPath)
      .filter((fileName) => this.isSessionFileName(fileName))
      .map((fileName) => path.join(dirPath, fileName));
  }

  private readDirNames(dirPath: string): string[] {
    try {
      return fs.readdirSync(dirPath);
    } catch {
      return [];
    }
  }

  private isSessionFileName(fileName: string): boolean {
    return fileName.endsWith('.jsonl') || fileName.endsWith('.json');
  }

  private isChatSessionsDir(dirPath: string): boolean {
    return path.basename(dirPath).toLowerCase().includes('chatsessions');
  }

  private isDirectory(dirPath: string): boolean {
    try {
      return fs.statSync(dirPath).isDirectory();
    } catch {
      return false;
    }
  }

  private firstString(record: Record<string, unknown>, fields: string[]): string | undefined {
    for (const field of fields) {
      if (typeof record[field] !== 'string') continue;
      const value = this.cleanText(record[field]);
      if (value) return value;
    }
    return undefined;
  }

  private cleanText(value: unknown, maxLength = 200): string | undefined {
    if (typeof value !== 'string') return undefined;
    const cleaned = value.replace(/\s+/g, ' ').trim();
    return cleaned ? cleaned.slice(0, maxLength) : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
}
