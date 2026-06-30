import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

export interface UsageEvent {
  sourceId: string;
  timestamp: string;
  credits: number;
  model?: string;
  context?: string;
}

interface ChatSessionDelta {
  kind?: number;
  k?: Array<string | number>;
  v?: unknown;
}

interface RequestMeta {
  requestId?: string;
  timestamp?: number;
  model?: string;
  context?: string;
}

const MODEL_FIELDS = new Set([
  'model',
  'modelSlug',
  'modelId',
  'chatModelId',
  'selectedModelId',
]);

export class CopilotCreditsWatcher extends EventEmitter {
  private readonly workspaceStorageDir: string;
  private readonly filePositions = new Map<string, number>();
  private readonly trackedChatDirs = new Set<string>();
  private readonly requestMetaByFile = new Map<string, Map<number, RequestMeta>>();
  private readonly pendingCreditsByFile = new Map<string, Map<number, number>>();
  private readonly sessionTitleByFile = new Map<string, string>();
  private readonly dirWatchers: fs.FSWatcher[] = [];
  private readonly fileWatchers = new Map<string, fs.FSWatcher>();

  constructor(workspaceStorageDir: string) {
    super();
    this.workspaceStorageDir = workspaceStorageDir;
  }

  start(): void {
    if (!fs.existsSync(this.workspaceStorageDir)) return;

    this.scanAllFiles();

    const top = fs.watch(
      this.workspaceStorageDir,
      { recursive: false, encoding: 'utf8' },
      (_event: fs.WatchEventType, filename: string | null) => {
        if (!filename) return;
        this.watchWorkspaceDir(path.join(this.workspaceStorageDir, filename));
      },
    );
    this.dirWatchers.push(top);

    for (const entry of fs.readdirSync(this.workspaceStorageDir)) {
      this.watchWorkspaceDir(path.join(this.workspaceStorageDir, entry));
    }
  }

  stop(): void {
    for (const w of this.dirWatchers) w.close();
    for (const w of this.fileWatchers.values()) w.close();
    this.dirWatchers.length = 0;
    this.fileWatchers.clear();
    this.pendingCreditsByFile.clear();
    this.sessionTitleByFile.clear();
  }

  private scanAllFiles(): void {
    for (const entry of fs.readdirSync(this.workspaceStorageDir)) {
      const workspaceDir = path.join(this.workspaceStorageDir, entry);
      if (!this.isDirectory(workspaceDir)) continue;
      const chatSessionsDir = path.join(workspaceDir, 'chatSessions');
      if (!this.isDirectory(chatSessionsDir)) continue;

      this.trackedChatDirs.add(chatSessionsDir);

      for (const file of fs.readdirSync(chatSessionsDir)) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = path.join(chatSessionsDir, file);
        this.watchFile(filePath);
        this.processFile(filePath);
      }
    }
  }

  private watchWorkspaceDir(workspaceDir: string): void {
    if (!this.isDirectory(workspaceDir)) return;
    const chatSessionsDir = path.join(workspaceDir, 'chatSessions');
    if (!this.isDirectory(chatSessionsDir)) return;

    if (this.trackedChatDirs.has(chatSessionsDir)) return;
    this.trackedChatDirs.add(chatSessionsDir);

    for (const file of fs.readdirSync(chatSessionsDir)) {
      if (!file.endsWith('.jsonl')) continue;
      this.watchFile(path.join(chatSessionsDir, file));
    }

    const watcher = fs.watch(
      chatSessionsDir,
      { recursive: false, encoding: 'utf8' },
      (_event: fs.WatchEventType, filename: string | null) => {
        if (!filename?.endsWith('.jsonl')) return;
        const filePath = path.join(chatSessionsDir, filename);
        this.watchFile(filePath);
        this.processFile(filePath);
      },
    );
    this.dirWatchers.push(watcher);
  }

  private isDirectory(dirPath: string): boolean {
    try {
      return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    } catch {
      return false;
    }
  }

  private watchFile(filePath: string): void {
    if (this.fileWatchers.has(filePath)) return;
    try {
      const w = fs.watch(filePath, () => this.processFile(filePath));
      this.fileWatchers.set(filePath, w);
    } catch {
      /* file may not exist yet */
    }
  }

  private processFile(filePath: string): void {
    try {
      const stat = fs.statSync(filePath);
      const lastPos = this.filePositions.get(filePath) ?? 0;
      if (stat.size <= lastPos) return;

      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(stat.size - lastPos);
      const bytesRead = fs.readSync(fd, buf, 0, buf.length, lastPos);
      fs.closeSync(fd);

      this.filePositions.set(filePath, lastPos + bytesRead);

      const chunk = buf.subarray(0, bytesRead).toString('utf-8');
      for (const rawLine of chunk.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        this.parseLine(filePath, line);
      }
    } catch {
      /* file may be mid-write */
    }
  }

  private parseLine(filePath: string, line: string): void {
    let obj: ChatSessionDelta;
    try {
      obj = JSON.parse(line) as ChatSessionDelta;
    } catch {
      return;
    }

    if (!Array.isArray(obj.k)) return;
    const key = obj.k;
    const kind = obj.kind;
    const requestMeta = this.requestMetaByFile.get(filePath) ?? new Map<number, RequestMeta>();
    this.requestMetaByFile.set(filePath, requestMeta);
    const pendingCredits = this.pendingCreditsByFile.get(filePath) ?? new Map<number, number>();
    this.pendingCreditsByFile.set(filePath, pendingCredits);

    if (kind === 1 && key.length === 1 && key[0] === 'customTitle' && typeof obj.v === 'string') {
      this.sessionTitleByFile.set(filePath, obj.v);
      return;
    }

    // Seed request metadata from a requests array snapshot.
    if (kind === 2 && key.length === 1 && key[0] === 'requests' && Array.isArray(obj.v)) {
      const requests = obj.v as unknown[];
      for (let i = 0; i < requests.length; i++) {
        const current = requestMeta.get(i);
        const parsed = this.extractMetaFromRequest(filePath, requests[i]);
        const meta: RequestMeta = {
          requestId: parsed.requestId ?? current?.requestId,
          timestamp: parsed.timestamp ?? current?.timestamp,
          model: parsed.model ?? current?.model,
          context: parsed.context ?? current?.context,
        };
        requestMeta.set(i, meta);

        const pending = pendingCredits.get(i);
        if (pending !== undefined && meta.requestId) {
          this.emitUsage(meta, pending);
          pendingCredits.delete(i);
        }
      }
      return;
    }

    // Handle updates on a specific request index.
    if (key.length < 2 || key[0] !== 'requests' || typeof key[1] !== 'number') return;
    const index = key[1];

    if (kind === 1 && key.length === 3 && key[2] === 'copilotCredits' && typeof obj.v === 'number') {
      const meta = requestMeta.get(index);
      if (!meta?.requestId) {
        const fallback = this.getSingleKnownMeta(requestMeta);
        if (fallback) {
          this.emitUsage(fallback, obj.v);
          return;
        }
        pendingCredits.set(index, obj.v);
        return;
      }
      this.emitUsage(meta, obj.v);
      return;
    }

    // Capture request metadata when an entire request object is inserted at index.
    if (kind === 2 && key.length === 2 && Array.isArray(obj.v) && obj.v.length > 0) {
      const current = requestMeta.get(index);
      const first = this.extractMetaFromRequest(filePath, obj.v[0]);
      const meta: RequestMeta = {
        requestId: first.requestId ?? current?.requestId,
        timestamp: first.timestamp ?? current?.timestamp,
        model: first.model ?? current?.model,
        context: first.context ?? current?.context,
      };
      requestMeta.set(index, meta);

      const pending = pendingCredits.get(index);
      if (pending !== undefined && meta.requestId) {
        this.emitUsage(meta, pending);
        pendingCredits.delete(index);
      }
      return;
    }

    // Capture field-level deltas on individual request properties.
    if (kind === 1 && key.length >= 3) {
      const field = key[2];

      if (field === 'requestId' && key.length === 3 && typeof obj.v === 'string') {
        const current = requestMeta.get(index) ?? {};
        const meta: RequestMeta = { ...current, requestId: obj.v };
        requestMeta.set(index, meta);

        const pending = pendingCredits.get(index);
        if (pending !== undefined) {
          this.emitUsage(meta, pending);
          pendingCredits.delete(index);
        }
        return;
      }

      if (field === 'timestamp' && key.length === 3 && typeof obj.v === 'number') {
        const current = requestMeta.get(index) ?? {};
        requestMeta.set(index, { ...current, timestamp: obj.v });
        return;
      }

      // Model can be a string or an object like { id: "gpt-4o", ... }
      if (key.length === 3 && MODEL_FIELDS.has(field as string)) {
        const model = this.extractModelValue(obj.v);
        if (model) {
          const current = requestMeta.get(index) ?? {};
          requestMeta.set(index, { ...current, model });
        }
        return;
      }

      // Extract model from result/response sub-objects
      if (key.length === 3 && (field === 'result' || field === 'response') && typeof obj.v === 'object' && obj.v !== null) {
        const nested = obj.v as Record<string, unknown>;
        const model = this.extractModelValue(nested.model) ?? this.extractModelValue(nested.modelName);
        if (model) {
          const current = requestMeta.get(index) ?? {};
          if (!current.model) {
            requestMeta.set(index, { ...current, model });
          }
        }
        return;
      }

      // Handle deeper paths: requests[i].result.model, requests[i].response.model, etc.
      if (key.length === 4 && (field === 'result' || field === 'response')) {
        const subField = key[3];
        if (MODEL_FIELDS.has(subField as string) || subField === 'modelName') {
          const model = this.extractModelValue(obj.v);
          if (model) {
            const current = requestMeta.get(index) ?? {};
            if (!current.model) {
              requestMeta.set(index, { ...current, model });
            }
          }
        }
        return;
      }

      if (field === 'message' && key.length === 3 && typeof obj.v === 'object' && obj.v !== null) {
        const current = requestMeta.get(index) ?? {};
        const messageText = (obj.v as { text?: unknown }).text;
        if (typeof messageText !== 'string') return;
        const context = this.buildContext(filePath, messageText);
        if (!context) return;
        requestMeta.set(index, { ...current, context });
      }
    }
  }

  private extractModelValue(v: unknown): string | undefined {
    if (typeof v === 'string' && v.length > 0) return v;
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      for (const key of ['id', 'name', 'modelId', 'slug']) {
        if (typeof obj[key] === 'string' && (obj[key] as string).length > 0) {
          return obj[key] as string;
        }
      }
    }
    return undefined;
  }

  private emitUsage(meta: RequestMeta, credits: number): void {
    if (!meta.requestId) return;
    const ts =
      typeof meta.timestamp === 'number' ? new Date(meta.timestamp).toISOString() : new Date().toISOString();
    this.emit('usage', {
      sourceId: meta.requestId,
      timestamp: ts,
      credits,
      model: meta.model,
      context: meta.context,
    } as UsageEvent);
  }

  private extractMetaFromRequest(filePath: string, req: unknown): RequestMeta {
    if (!req || typeof req !== 'object') return {};
    const obj = req as Record<string, unknown>;
    const messageText =
      typeof (obj.message as { text?: unknown })?.text === 'string'
        ? ((obj.message as { text: string }).text)
        : undefined;

    let model = this.extractModelValue(obj.model)
      ?? this.extractModelValue(obj.modelSlug)
      ?? this.extractModelValue(obj.chatModelId)
      ?? this.extractModelValue(obj.modelId)
      ?? this.extractModelValue(obj.selectedModelId);

    // Check nested result/response objects for model info
    if (!model && obj.result && typeof obj.result === 'object') {
      const result = obj.result as Record<string, unknown>;
      model = this.extractModelValue(result.model) ?? this.extractModelValue(result.modelName);
    }
    if (!model && obj.response && typeof obj.response === 'object') {
      const response = obj.response as Record<string, unknown>;
      model = this.extractModelValue(response.model) ?? this.extractModelValue(response.modelName);
    }

    return {
      requestId: typeof obj.requestId === 'string' ? obj.requestId : undefined,
      timestamp: typeof obj.timestamp === 'number' ? obj.timestamp : undefined,
      model,
      context: this.buildContext(filePath, messageText),
    };
  }

  private buildContext(filePath: string, messageText?: string): string | undefined {
    const title = this.sessionTitleByFile.get(filePath);
    const text = title?.trim() ? title : messageText;
    if (!text?.trim()) return undefined;
    return text.replace(/\s+/g, ' ').trim().slice(0, 100);
  }

  private getSingleKnownMeta(requestMeta: Map<number, RequestMeta>): RequestMeta | undefined {
    const ids = new Map<string, RequestMeta>();
    for (const meta of requestMeta.values()) {
      if (!meta.requestId) continue;
      if (!ids.has(meta.requestId)) {
        ids.set(meta.requestId, meta);
      }
    }
    if (ids.size !== 1) return undefined;
    return ids.values().next().value as RequestMeta;
  }
}
