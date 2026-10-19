import { test } from "node:test";
import assert from "node:assert/strict";
process.env.VERCEL = "1";
process.env.ACADEMY_ACCESS_CODE = "LOCAL-ONLY";
process.env.ANTHROPIC_API_KEY = "local-fake-key";
process.env.CLAUDE_API_KEY = "local-fake-key";
process.env.OPENAI_API_KEY = "local-fake-key";
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
const { default: app, callClaude, callOpenAI } = await import("../../server.js");
process.env.CLAUDE_API_KEY = "local-fake-key";
process.env.OPENAI_API_KEY = "local-fake-key";
process.env.CLAUDE_MAX_TOKENS = "900";
process.env.OPENAI_MAX_TOKENS = "1200";
const partial = "Möchtest du das an einer konkreten";
const full = "Achse, Raum und Raumkörper gehören zusammen. ".repeat(120) + "Die Antwort ist vollständig.";
for (const provider of ["claude", "openai"]) {
 for (const truncated of [false, true]) {
  test(`${provider}: ${truncated ? "Längenabbruch wird erkannt" : "lange vollständige Antwort bleibt erhalten"}`, async () => {
   const original = globalThis.fetch, calls = [], completion = [];
   const expected = truncated ? partial : full;
   globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => provider === "claude"
     ? { content: [{ type: "text", text: expected }], stop_reason: truncated ? "max_tokens" : "end_turn", usage: { output_tokens: 900 } }
     : { choices: [{ message: { content: expected }, finish_reason: truncated ? "length" : "stop" }], usage: { completion_tokens: 1200 } } };
   };
   try {
    const call = provider === "claude" ? callClaude : callOpenAI;
    const reply = await call("Unveränderter Hauptprompt", [{ role: "user", content: "Zeige die Verbindung zwischen Achsen, Räumen und Raumkörpern." }], value => completion.push(value));
    assert.equal(reply, expected);
    assert.equal(calls.length, 1, "Kein zusätzlicher kostenpflichtiger Fortsetzungsaufruf");
    assert.equal(provider === "claude" ? calls[0].body.max_tokens : calls[0].body.max_completion_tokens, 4096);
    assert.equal(completion.length, 1);
    assert.equal(completion[0].truncated, truncated);
    assert.equal(provider === "claude" ? calls[0].body.system[0].text : calls[0].body.messages[0].content, "Unveränderter Hauptprompt");
   } finally { globalThis.fetch = original; }
  });
 }
}

// Real HTTP handler, isolated local memory and fake provider; no production data.
test("Academy: Längenabbruch erreicht HTTP-Antwort und gespeicherte Raum-Nachricht", async () => {
  const { request } = await import("node:http");
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const original = globalThis.fetch;
  const body = JSON.stringify({ name: "Lokaler Test", text: "Zeige die Verbindung zwischen Achsen, Räumen und Raumkörpern.", engine: "claude" });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: partial }], stop_reason: "max_tokens" }) });
  try {
    const result = await new Promise((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port: server.address().port, path: "/api/room/local-regression/message", method: "POST", headers: { "content-type": "application/json", "x-academy-code": "LOCAL-ONLY", "content-length": Buffer.byteLength(body) } }, res => {
        let text = ""; res.on("data", chunk => text += chunk); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on("error", reject);req.end(body);
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.assistantMsg.text, partial);
    assert.deepEqual(result.body.assistantMsg.completion, { stopReason: "max_tokens", truncated: true });
  } finally { globalThis.fetch = original; await new Promise(resolve => server.close(resolve)); }
});
