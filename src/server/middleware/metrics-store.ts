import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { logger } from "../../utils/logger.js";
import type { RequestRecord } from "./metrics.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  model TEXT NOT NULL,
  resolved_model TEXT NOT NULL,
  provider TEXT NOT NULL,
  stream INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  tool_count INTEGER NOT NULL DEFAULT 0,
  tool_names TEXT NOT NULL DEFAULT '[]',
  message_count INTEGER NOT NULL DEFAULT 0,
  has_thinking INTEGER NOT NULL DEFAULT 0,
  thinking_budget INTEGER,
  system_length INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT,
  full_request TEXT,
  full_response TEXT
);
CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests(timestamp DESC);
`;

function rowToRecord(row: Record<string, unknown>): RequestRecord {
  return {
    id: row.id as string,
    timestamp: row.timestamp as number,
    model: row.model as string,
    resolvedModel: row.resolved_model as string,
    provider: row.provider as string,
    stream: !!row.stream,
    inputTokens: row.input_tokens as number,
    outputTokens: row.output_tokens as number,
    cacheCreationTokens: row.cache_creation_tokens as number,
    cacheReadTokens: row.cache_read_tokens as number,
    toolCount: row.tool_count as number,
    toolNames: JSON.parse(row.tool_names as string),
    messageCount: row.message_count as number,
    hasThinking: !!row.has_thinking,
    thinkingBudget: row.thinking_budget as number | null,
    systemLength: row.system_length as number,
    latencyMs: row.latency_ms as number,
    status: row.status as "success" | "error",
    errorMessage: row.error_message as string | null,
    fullRequest: row.full_request
      ? JSON.parse(row.full_request as string)
      : null,
    fullResponse: row.full_response
      ? JSON.parse(row.full_response as string)
      : null,
  };
}

export class MetricsStore {
  private db: Database.Database;
  private insertStmt: Database.Statement;

  constructor(dbPath?: string) {
    const path = dbPath ?? join(homedir(), ".cc-router", "metrics.db");
    mkdirSync(join(path, ".."), { recursive: true });

    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);

    this.insertStmt = this.db.prepare(`
      INSERT INTO requests (
        id, timestamp, model, resolved_model, provider, stream,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        tool_count, tool_names, message_count, has_thinking, thinking_budget,
        system_length, latency_ms, status, error_message, full_request, full_response
      ) VALUES (
        @id, @timestamp, @model, @resolvedModel, @provider, @stream,
        @inputTokens, @outputTokens, @cacheCreationTokens, @cacheReadTokens,
        @toolCount, @toolNames, @messageCount, @hasThinking, @thinkingBudget,
        @systemLength, @latencyMs, @status, @errorMessage, @fullRequest, @fullResponse
      )
    `);

    logger.info({ path }, "Metrics store initialized");
  }

  insert(record: RequestRecord): void {
    try {
      this.insertStmt.run({
        id: record.id,
        timestamp: record.timestamp,
        model: record.model,
        resolvedModel: record.resolvedModel,
        provider: record.provider,
        stream: record.stream ? 1 : 0,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        cacheCreationTokens: record.cacheCreationTokens,
        cacheReadTokens: record.cacheReadTokens,
        toolCount: record.toolCount,
        toolNames: JSON.stringify(record.toolNames),
        messageCount: record.messageCount,
        hasThinking: record.hasThinking ? 1 : 0,
        thinkingBudget: record.thinkingBudget,
        systemLength: record.systemLength,
        latencyMs: record.latencyMs,
        status: record.status,
        errorMessage: record.errorMessage,
        fullRequest: record.fullRequest
          ? JSON.stringify(record.fullRequest)
          : null,
        fullResponse: record.fullResponse
          ? JSON.stringify(record.fullResponse)
          : null,
      });
    } catch (err) {
      logger.warn({ err, id: record.id }, "Failed to persist record to SQLite");
    }
  }

  loadRecent(limit: number): RequestRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM requests ORDER BY timestamp DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToRecord).reverse();
  }

  getById(id: string): RequestRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM requests WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  getHistory(limit: number, offset: number): RequestRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM requests ORDER BY timestamp DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }

  getHistoryCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM requests").get() as { count: number };
    return row.count;
  }

  prune(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const result = this.db
      .prepare("DELETE FROM requests WHERE timestamp < ?")
      .run(cutoff);
    return result.changes;
  }

  clearAll(): number {
    const result = this.db.prepare("DELETE FROM requests").run();
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
