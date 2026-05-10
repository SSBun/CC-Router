import type { ReadableStream } from "node:stream/web";

export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<{ event?: string; data: string }> {
  const decoder = new TextDecoder();
  const reader = body.getReader();

  let buffer = "";
  let event: string | undefined;
  let dataLines: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop()!;

      for (const block of parts) {
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) {
            event = line.slice(7);
          } else if (line.startsWith("data: ")) {
            dataLines.push(line.slice(6));
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5));
          }
        }

        if (dataLines.length > 0) {
          yield { event, data: dataLines.join("\n") };
          event = undefined;
          dataLines = [];
        }
      }
    }

    if (buffer.trim()) {
      for (const line of buffer.split("\n")) {
        if (line.startsWith("event: ")) {
          event = line.slice(7);
        } else if (line.startsWith("data: ")) {
          dataLines.push(line.slice(6));
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5));
        }
      }
      if (dataLines.length > 0) {
        yield { event, data: dataLines.join("\n") };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
