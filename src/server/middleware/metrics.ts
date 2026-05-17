import { randomUUID } from "node:crypto";
import { logger } from "../../utils/logger.js";
import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
} from "../../providers/types.js";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface RequestRecord {
  id: string;
  timestamp: number;
  model: string;
  resolvedModel: string;
  provider: string;
  stream: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  toolCount: number;
  toolNames: string[];
  messageCount: number;
  hasThinking: boolean;
  thinkingBudget: number | null;
  systemLength: number;
  latencyMs: number;
  status: "success" | "error";
  errorMessage: string | null;
  fullRequest: AnthropicMessagesRequest | null;
  fullResponse: AnthropicMessagesResponse | null;
}

export interface AggregatedStats {
  totalRequests: number;
  requestsPerMinute: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  errorCount: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
  uptimeMs: number;
}

// ---------------------------------------------------------------------------
// MetricsCollector
// ---------------------------------------------------------------------------

type RecordListener = (record: RequestRecord) => void;

export class MetricsCollector {
  private requests: RequestRecord[] = [];
  private readonly maxSize: number;
  private readonly startTime: number = Date.now();
  private listeners: RecordListener[] = [];

  constructor(isTrace: boolean) {
    this.maxSize = isTrace ? 500 : 1000;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  record(
    request: AnthropicMessagesRequest,
    resolvedModel: string,
    providerName: string,
    response: AnthropicMessagesResponse | null,
    latencyMs: number,
    error: string | null,
    isTrace: boolean,
  ): RequestRecord {
    const usage = response?.usage;

    // Derive tool information from the request
    const tools = request.tools ?? [];
    const toolCount = tools.length;
    const toolNames = tools.map((t) => t.name);

    // Derive thinking information
    const hasThinking = request.thinking?.type === "enabled";
    const thinkingBudget = hasThinking
      ? (request.thinking as { type: "enabled"; budget_tokens: number })
          .budget_tokens
      : null;

    // System prompt length
    let systemLength = 0;
    if (typeof request.system === "string") {
      systemLength = request.system.length;
    } else if (Array.isArray(request.system)) {
      systemLength = request.system.reduce(
        (sum, block) => sum + block.text.length,
        0,
      );
    }

    const rec: RequestRecord = {
      id: randomUUID(),
      timestamp: Date.now(),
      model: request.model,
      resolvedModel,
      provider: providerName,
      stream: request.stream ?? false,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      toolCount,
      toolNames,
      messageCount: request.messages.length,
      hasThinking,
      thinkingBudget,
      systemLength,
      latencyMs,
      status: error ? "error" : "success",
      errorMessage: error,
      fullRequest: isTrace ? request : null,
      fullResponse: isTrace ? response : null,
    };

    // Push to ring buffer (evict oldest when at capacity)
    this.requests.push(rec);
    if (this.requests.length > this.maxSize) {
      this.requests.shift();
    }

    // Notify subscribers (fire-and-forget)
    for (const listener of this.listeners) {
      try {
        listener(rec);
      } catch (err) {
        logger.warn({ err }, "metrics listener error");
      }
    }

    return rec;
  }

  getStats(): AggregatedStats {
    const now = Date.now();
    const uptimeMs = now - this.startTime;
    const all = this.requests;
    const totalRequests = all.length;

    if (totalRequests === 0) {
      return {
        totalRequests: 0,
        requestsPerMinute: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        errorCount: 0,
        errorRate: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        byProvider: {},
        byModel: {},
        uptimeMs,
      };
    }

    const totalInputTokens = all.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutputTokens = all.reduce((s, r) => s + r.outputTokens, 0);
    const errorCount = all.filter((r) => r.status === "error").length;
    const totalLatency = all.reduce((s, r) => s + r.latencyMs, 0);

    // P95 latency
    const sorted = all
      .map((r) => r.latencyMs)
      .sort((a, b) => a - b);
    const p95Index = Math.ceil(sorted.length * 0.95) - 1;
    const p95LatencyMs = sorted[Math.max(0, p95Index)];

    // Breakdowns
    const byProvider: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    for (const r of all) {
      byProvider[r.provider] = (byProvider[r.provider] ?? 0) + 1;
      byModel[r.resolvedModel] = (byModel[r.resolvedModel] ?? 0) + 1;
    }

    return {
      totalRequests,
      requestsPerMinute: totalRequests / (uptimeMs / 60_000),
      totalInputTokens,
      totalOutputTokens,
      errorCount,
      errorRate: errorCount / totalRequests,
      avgLatencyMs: totalLatency / totalRequests,
      p95LatencyMs,
      byProvider,
      byModel,
      uptimeMs,
    };
  }

  getRequests(limit: number, offset: number): RequestRecord[] {
    // Newest first, then slice
    const reversed = [...this.requests].reverse();
    return reversed.slice(offset, offset + limit);
  }

  getRequestById(id: string): RequestRecord | undefined {
    return this.requests.find((r) => r.id === id);
  }

  onRecord(listener: RecordListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}
