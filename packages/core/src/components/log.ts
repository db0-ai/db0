import type { Db0Backend, LogAppendOpts, LogEntry } from "../types.js";

export class Log {
  constructor(
    private backend: Db0Backend,
    private agentId: string,
    private sessionId: string,
  ) {}

  async append(opts: LogAppendOpts): Promise<LogEntry> {
    return this.backend.logAppend(this.agentId, this.sessionId, opts);
  }

  async query(limit?: number): Promise<LogEntry[]> {
    return this.backend.logQuery(this.agentId, this.sessionId, limit);
  }
}
