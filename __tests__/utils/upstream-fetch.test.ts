import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { upstreamFetch } from "../../src/utils/upstream-fetch.js";

const servers: http.Server[] = [];

function listen(server: http.Server, port: number): Promise<void> {
  servers.push(server);
  return new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
});

describe("upstreamFetch", () => {
  it("aborts when response headers do not arrive within timeoutMs", async () => {
    const server = http.createServer(() => {
      // never respond
    });
    await listen(server, 17991);

    const start = Date.now();
    await expect(
      upstreamFetch(
        "http://127.0.0.1:17991/",
        { method: "POST" },
        { timeoutMs: 500 },
      ),
    ).rejects.toThrow(/timed out/);
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it("rejects immediately when the caller signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      upstreamFetch(
        "http://127.0.0.1:17991/",
        { method: "POST" },
        { signal: ac.signal },
      ),
    ).rejects.toThrow();
  });

  it("aborts and closes the upstream socket when the caller aborts before headers", async () => {
    let upstreamClosed = 0;
    const server = http.createServer((_req, res) => {
      res.on("close", () => upstreamClosed++);
      // never respond
    });
    await listen(server, 17992);

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    await expect(
      upstreamFetch(
        "http://127.0.0.1:17992/",
        { method: "POST" },
        { signal: ac.signal },
      ),
    ).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(upstreamClosed).toBeGreaterThan(0);
  });

  it("still cancels the upstream body when the caller aborts mid-stream, after headers arrived", async () => {
    let upstreamClosed = 0;
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: partial\n\n");
      res.on("close", () => upstreamClosed++);
      // keep the body open forever
    });
    await listen(server, 17993);

    const ac = new AbortController();
    const response = await upstreamFetch(
      "http://127.0.0.1:17993/",
      { method: "POST" },
      { signal: ac.signal },
    );
    expect(response.ok).toBe(true); // headers arrived — the caller listener must stay armed

    ac.abort(); // client disconnects mid-body
    await expect(response.text()).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(upstreamClosed).toBeGreaterThan(0);
  });

  it("passes a normal request through untouched", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
    await listen(server, 17994);

    const response = await upstreamFetch("http://127.0.0.1:17994/", {
      method: "GET",
    });
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ ok: true });
  });
});
