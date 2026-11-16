import WebSocket from 'ws';

/** One entry of Chromium's `/json` target list. */
export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

type EventHandler = (params: Record<string, unknown>) => void;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Lists the debuggable targets of an app started with a debugging port. */
export async function listTargets(port: number): Promise<CdpTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error(`/json answered ${response.status}`);
  const raw: unknown = await response.json();
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((entry) => ({
    id: String(entry.id ?? ''),
    type: String(entry.type ?? ''),
    title: String(entry.title ?? ''),
    url: String(entry.url ?? ''),
    webSocketDebuggerUrl:
      typeof entry.webSocketDebuggerUrl === 'string'
        ? entry.webSocketDebuggerUrl
        : undefined,
  }));
}

/** A DevTools protocol connection to one target (one window). */
export class CdpSession {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private closed = false;

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => this.onMessage(String(data)));
    socket.on('close', () => this.onClose());
    socket.on('error', () => this.onClose());
  }

  static connect(url: string, timeoutMs = 10_000): Promise<CdpSession> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { perMessageDeflate: false });
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error(`Timed out connecting to ${url}`));
      }, timeoutMs);
      socket.once('open', () => {
        clearTimeout(timer);
        resolve(new CdpSession(socket));
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  on(event: string, handler: EventHandler): void {
    const set = this.handlers.get(event) ?? new Set<EventHandler>();
    set.add(handler);
    this.handlers.set(event, set);
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30_000
  ): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error('Target is gone'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(isRecord(value) ? value : {}),
        reject,
        timer,
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Runs an expression in the page and returns its JSON value. The
   * expression is a string on purpose: a function serialised by a bundler
   * can refer to helpers that do not exist in the page.
   */
  async evaluate<T>(expression: string, timeoutMs = 30_000): Promise<T> {
    const result = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      timeoutMs
    );
    if (isRecord(result.exceptionDetails)) {
      const details = result.exceptionDetails;
      const exception = isRecord(details.exception) ? details.exception : {};
      throw new Error(
        `Page script failed: ${String(exception.description ?? details.text)}`
      );
    }
    const value = isRecord(result.result) ? result.result.value : undefined;
    return value as T;
  }

  close(): void {
    if (this.closed) return;
    this.socket.close();
    this.onClose();
  }

  private onMessage(text: string): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (isRecord(message.error)) {
        pending.reject(new Error(String(message.error.message ?? 'CDP error')));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof message.method === 'string') {
      const params = isRecord(message.params) ? message.params : {};
      for (const handler of this.handlers.get(message.method) ?? []) {
        handler(params);
      }
    }
  }

  private onClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Target closed'));
    }
    this.pending.clear();
  }
}
