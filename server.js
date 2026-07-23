// Resonanzraum – eigener API-Server
// Hält den Anthropic-API-Key sicher auf dem Server (niemals im Browser).
// Baut den vollständigen Signaturlehre-Prompt bei jedem Request serverseitig zusammen.

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { Redis } from "@upstash/redis";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const ADMIN_NAME = process.env.ADMIN_NAME || "Thomas";
const ADMIN_SCHWELLE = 4;
const ADMIN_RAUMKOERPER = 13;
// Startwert aus den Umgebungsvariablen. Der tatsächlich gültige Code kann
// danach über die Admin-Seite live geändert werden, ohne Vercel anzufassen -
// er liegt dann im selben persistenten Speicher wie die Nachrichten.
const FALLBACK_ACCESS_CODE = process.env.ACADEMY_ACCESS_CODE || null;

if (!API_KEY) {
  console.error(
    "FEHLER: ANTHROPIC_API_KEY fehlt. Lege eine .env-Datei an (siehe .env.example) " +
      "und trag deinen Console-API-Key ein, bevor du den Server startest."
  );
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.warn(
    "HINWEIS: OPENAI_API_KEY fehlt. Der Weg 'Klarheit' (ChatGPT) ist ohne " +
      "diesen Key nicht nutzbar - 'Resonanz' (Claude) läuft trotzdem normal."
  );
}
if (!FALLBACK_ACCESS_CODE) {
  console.warn(
    "WARNUNG: ACADEMY_ACCESS_CODE ist nicht gesetzt und noch nie über die " +
      "Admin-Seite ein Code vergeben worden! Der Raum ist damit OHNE " +
      "ZUGANGSSCHUTZ öffentlich erreichbar - jede Person mit dem Link kann " +
      "schreiben und Kosten verursachen. Setz einen Startwert in Vercel " +
      "oder leg gleich über /admin.html einen Code fest."
  );
}

const CORE_PROMPT = fs.readFileSync(
  path.join(__dirname, "prompts", "core.md"),
  "utf-8"
);
const BUSINESS_PROMPT = fs.readFileSync(
  path.join(__dirname, "prompts", "business.md"),
  "utf-8"
);
const FIELD_LAYER = fs.readFileSync(
  path.join(__dirname, "prompts", "field.md"),
  "utf-8"
);

function buildSystemPrompt(businessMode) {
  return businessMode
    ? `${BUSINESS_PROMPT}\n\n${CORE_PROMPT}\n\n${FIELD_LAYER}`
    : `${CORE_PROMPT}\n\n${FIELD_LAYER}`;
}

// ---- Persistenter Raum-Speicher ----
// Wenn UPSTASH_REDIS_REST_URL / _TOKEN gesetzt sind (empfohlen, auch für Vercel/
// Render): echte, dauerhafte Speicherung, überlebt Neustarts und Kaltstarts.
// Ohne diese Werte: einfacher Arbeitsspeicher, nur für lokale Entwicklung/Tests
// geeignet - Inhalt geht beim Neustart des Servers verloren.
const RAW_UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const RAW_UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

// Absicherung: Ein Redis-Token (langer, zufälliger String) sieht komplett
// anders aus als eine Redis-URL (beginnt immer mit "https://"). Wenn beide
// Werte gesetzt, aber vertauscht wurden - genau das ist schon einmal
// passiert und hat den Server abstürzen lassen (FUNCTION_INVOCATION_FAILED)
// - fangen wir das hier ab, statt den Server crashen zu lassen. Stattdessen:
// klare Fehlermeldung, sauberer Fallback auf Arbeitsspeicher.
const upstashConfigured = Boolean(RAW_UPSTASH_URL && RAW_UPSTASH_TOKEN);
const upstashUrlLooksValid = RAW_UPSTASH_URL.startsWith("https://");

if (upstashConfigured && !upstashUrlLooksValid) {
  console.error(
    "FEHLER: UPSTASH_REDIS_REST_URL sieht ungültig aus - sie muss mit " +
      "'https://' beginnen. Vermutlich wurden URL und TOKEN in Vercel " +
      "vertauscht oder vermischt eingetragen. Der Server läuft trotzdem " +
      "weiter (nicht abgestürzt), aber OHNE dauerhafte Speicherung, bis " +
      "das korrigiert ist. Aktueller Wert von UPSTASH_REDIS_REST_URL: " +
      `"${RAW_UPSTASH_URL.slice(0, 20)}..."`
  );
}

const USE_REDIS = upstashConfigured && upstashUrlLooksValid;

const redis = USE_REDIS
  ? new Redis({
      url: RAW_UPSTASH_URL,
      token: RAW_UPSTASH_TOKEN,
    })
  : null;

const memoryStore = new Map(); // nur für den lokalen Fallback, key -> value

async function getValue(key, fallback) {
  if (USE_REDIS) {
    const data = await redis.get(key);
    return data ?? fallback;
  }
  return memoryStore.has(key) ? memoryStore.get(key) : fallback;
}

async function setValue(key, value) {
  if (USE_REDIS) {
    await redis.set(key, value);
  } else {
    memoryStore.set(key, value);
  }
}

const keyMessages = (roomId) => `resonanzraum:messages:${roomId}`;
const keyBusinessMode = (roomId) => `resonanzraum:business:${roomId}`;
const keyPresence = (roomId) => `resonanzraum:presence:${roomId}`;
const keyTyping = (roomId) => `resonanzraum:typing:${roomId}`;
const MESSAGE_HISTORY_LIMIT = 200; // wie viele Nachrichten dauerhaft aufbewahrt werden
const PRESENCE_TIMEOUT_MS = 2 * 60 * 1000; // nach 2 Min ohne Heartbeat gilt jemand als weg
const TYPING_TIMEOUT_MS = 6 * 1000; // "tippt gerade" verschwindet nach 6 Sek Stille

function filterActive(list, timeoutMs) {
  const now = Date.now();
  return (list || []).filter((p) => now - p.ts < timeoutMs);
}

// Nachrichten liegen als Redis-LISTE vor, nicht als ein einzelnes JSON-Array-
// Objekt. RPUSH fügt atomar an - zwei Personen, die im selben Moment
// schreiben, können sich dadurch nicht mehr gegenseitig überschreiben, weil
// keiner von beiden den ganzen alten Stand lesen und zurückschreiben muss.
async function appendMessage(roomId, message) {
  if (USE_REDIS) {
    await redis.rpush(keyMessages(roomId), message);
    await redis.ltrim(keyMessages(roomId), -MESSAGE_HISTORY_LIMIT, -1);
  } else {
    const list = memoryStore.get(keyMessages(roomId)) || [];
    list.push(message);
    if (list.length > MESSAGE_HISTORY_LIMIT) list.splice(0, list.length - MESSAGE_HISTORY_LIMIT);
    memoryStore.set(keyMessages(roomId), list);
  }
}

async function getMessages(roomId) {
  if (USE_REDIS) {
    const list = await redis.lrange(keyMessages(roomId), 0, -1);
    return list || [];
  }
  return memoryStore.get(keyMessages(roomId)) || [];
}

async function resetMessages(roomId) {
  if (USE_REDIS) {
    await redis.del(keyMessages(roomId));
  } else {
    memoryStore.set(keyMessages(roomId), []);
  }
}

if (!USE_REDIS && !upstashConfigured) {
  console.warn(
    "HINWEIS: UPSTASH_REDIS_REST_URL/TOKEN fehlen. Der Raum läuft nur im " +
      "Arbeitsspeicher - gut zum lokalen Testen, aber für den echten Betrieb " +
      "(besonders auf Vercel) fehlt dauerhafte Speicherung. Siehe README.md."
  );
}

app.use(cors());
app.use(express.json({ limit: "1mb" }));
// Verhindert, dass Browser eine veraltete app.js/index.html zwischenspeichern
// und dadurch nach einem Update stillschweigend mit altem Code weiterlaufen.
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders: (res) => {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    },
  })
);

// Der Zugangscode liegt im selben persistenten Speicher wie die Nachrichten
// - global, ein Code für die ganze Academy, nicht pro Raum. Der Wert aus
// Vercel (FALLBACK_ACCESS_CODE) dient nur als Startwert beim allerersten
// Mal; danach hat der über die Admin-Seite gesetzte Code immer Vorrang.
const ACCESS_CODE_KEY = "resonanzraum:access-code";

async function getAccessCode() {
  const stored = await getValue(ACCESS_CODE_KEY, null);
  // Upstash erkennt rein numerische Werte (z.B. "2412") automatisch als
  // Zahl, nicht als Text, und gibt sie beim Lesen als Zahl zurück statt als
  // Zeichenkette. String(...) erzwingt hier konsequent Text, egal was
  // zurückkam - sonst würde "2412" (Zahl) nie zu "2412" (eingegebener Text)
  // passen, obwohl beide identisch aussehen.
  const value = stored ?? FALLBACK_ACCESS_CODE;
  return value === null || value === undefined ? null : String(value);
}

async function setAccessCode(newCode) {
  await setValue(ACCESS_CODE_KEY, String(newCode));
}

// NOTAUSGANG: Falls der gespeicherte Zugangscode kaputt ist oder niemand
// mehr weiß, welcher Code gerade gilt, kann dieser Zustand nicht mehr über
// die Admin-Seite behoben werden (die braucht ja selbst den gültigen Code -
// klassisches Henne-Ei-Problem). Deshalb dieser Weg über Vercel, den man
// immer erreicht, egal was gespeichert ist:
//   1. In Vercel: Umgebungsvariable FORCE_RESET_ACCESS_CODE = true setzen.
//   2. Redeploy.
//   3. Der gespeicherte Code wird beim Start gelöscht, es gilt wieder der
//      Wert aus ACADEMY_ACCESS_CODE (Vercel-Umgebungsvariable).
//   4. FORCE_RESET_ACCESS_CODE danach wieder entfernen, sonst wird bei
//      jedem künftigen Start erneut zurückgesetzt und die Admin-Seite kann
//      den Code nicht mehr dauerhaft ändern.
if (String(process.env.FORCE_RESET_ACCESS_CODE || "").toLowerCase() === "true") {
  console.warn(
    "NOTAUSGANG AKTIV: FORCE_RESET_ACCESS_CODE=true gesetzt. Gespeicherter " +
      "Zugangscode wird gelöscht, es gilt wieder ACADEMY_ACCESS_CODE aus " +
      "den Vercel-Umgebungsvariablen. Danach FORCE_RESET_ACCESS_CODE bitte " +
      "wieder entfernen."
  );
  if (USE_REDIS) {
    redis.del(ACCESS_CODE_KEY).catch((e) => console.error("Notausgang-Fehler:", e));
  } else {
    memoryStore.delete(ACCESS_CODE_KEY);
  }
}

// Zugangsschutz für alle Raum-Endpunkte: ohne gültigen Code kein Zugriff.
// Prüft serverseitig, nicht nur im Frontend - kann nicht umgangen werden,
// indem man die Eingabemaske überspringt und die API direkt anspricht.
async function requireAccessCode(req, res, next) {
  try {
    const currentCode = await getAccessCode();
    if (!currentCode) {
      // Kein Code konfiguriert: Server läuft absichtlich offen (z.B. lokaler
      // Test). Warnung steht schon beim Start in der Konsole.
      return next();
    }
    const provided = String(req.get("x-academy-code") || req.query.code || "");
    if (provided !== currentCode) {
      return res.status(403).json({ error: "Ungültiger oder fehlender Zugangscode." });
    }
    next();
  } catch (err) {
    // Ohne dieses try/catch würde eine fehlgeschlagene Datenbank-Abfrage die
    // Anfrage einfach hängen lassen, ohne Antwort, ohne Fehlermeldung - genau
    // das sah aus wie ein blockierter "Aktualisieren"-Knopf, war aber ein
    // fehlendes Sicherheitsnetz hier in dieser Funktion.
    console.error("Fehler bei Zugangscode-Prüfung:", err);
    res.status(503).json({ error: "Zugangsprüfung gerade nicht möglich. Bitte erneut versuchen." });
  }
}
app.use("/api/room", requireAccessCode);
app.use("/api/admin", requireAccessCode);

// Admin-Seite: neuen Zugangscode setzen (live, ohne Vercel/Redeploy) und
// Nutzungsstatistik abrufen. Zusätzlich zum Zugangscode (oben bereits
// geprüft) wird hier noch der Administratorname verlangt.
app.post("/api/admin/access-code", async (req, res) => {
  try {
    const name = (req.body?.name || "").trim().toLowerCase();
    const newCode = (req.body?.newCode || "").trim();
    if (name !== ADMIN_NAME.toLowerCase()) {
      return res.status(403).json({ error: "Nur der Administrator darf den Code ändern." });
    }
    if (!newCode || newCode.length < 4) {
      return res.status(400).json({ error: "Neuer Code muss mindestens 4 Zeichen haben." });
    }
    await setAccessCode(newCode);

    // Upstash "Global" repliziert über mehrere Regionen - ein gerade
    // geschriebener Wert kann kurzzeitig noch nicht überall angekommen
    // sein. Deshalb hier aktiv nachprüfen, bis der neue Wert wirklich
    // lesbar ist, statt sofort "ok" zu melden und das Problem dem Browser
    // zu überlassen.
    let bestaetigt = false;
    for (let versuch = 0; versuch < 6; versuch++) {
      const gelesen = await getAccessCode();
      if (gelesen === newCode) {
        bestaetigt = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    if (!bestaetigt) {
      return res.status(202).json({
        ok: false,
        pending: true,
        error:
          "Code wurde geschrieben, ist aber nach mehreren Versuchen noch nicht überall bestätigt " +
          "(Upstash Global braucht manchmal etwas länger). Bitte in ein paar Sekunden erneut prüfen.",
      });
    }

    res.json({ ok: true, code: newCode });
  } catch (err) {
    console.error("Fehler beim Ändern des Zugangscodes:", err);
    res.status(503).json({ error: "Zugangscode konnte nicht geändert werden." });
  }
});

// Verhindert, dass Browser oder Zwischenspeicher jemals eine veraltete
// Antwort zeigen.
app.use("/api/room", (req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  next();
});

app.get("/api/room/:roomId", async (req, res) => {
  try {
    const roomId = req.params.roomId;
    const [messages, businessMode, presence, typing] = await Promise.all([
      getMessages(roomId),
      getValue(keyBusinessMode(roomId), false),
      getValue(keyPresence(roomId), []),
      getValue(keyTyping(roomId), []),
    ]);
    res.json({
      messages,
      businessMode,
      presence: filterActive(presence, PRESENCE_TIMEOUT_MS).map((p) => p.name),
      typing: filterActive(typing, TYPING_TIMEOUT_MS).map((p) => p.name),
      _speicher: USE_REDIS ? "upstash-redis (dauerhaft)" : "arbeitsspeicher (nicht dauerhaft)",
    });
  } catch (err) {
    console.error("Fehler beim Laden des Raums:", err);
    res.status(503).json({ error: "Raum konnte gerade nicht geladen werden." });
  }
});

// Sparsamer Heartbeat: eigenen Namen als "gerade aktiv" eintragen. Eigener
// Schlüssel, getrennt von Nachrichten - kann sie nicht überschreiben.
app.post("/api/room/:roomId/presence", async (req, res) => {
  try {
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name fehlt." });
    const roomId = req.params.roomId;
    const current = await getValue(keyPresence(roomId), []);
    const filtered = filterActive(current, PRESENCE_TIMEOUT_MS).filter(
      (p) => p.name.toLowerCase() !== name.toLowerCase()
    );
    filtered.push({ name, ts: Date.now() });
    await setValue(keyPresence(roomId), filtered);
    res.json({ presence: filtered.map((p) => p.name) });
  } catch (err) {
    console.error("Fehler beim Presence-Heartbeat:", err);
    res.status(503).json({ error: "Anwesenheit konnte nicht gespeichert werden." });
  }
});

// "Tippt gerade" melden. Eigener Schlüssel, getrennt von Nachrichten und
// Anwesenheit - kann keins von beiden überschreiben.
app.post("/api/room/:roomId/typing", async (req, res) => {
  try {
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name fehlt." });
    const roomId = req.params.roomId;
    const current = await getValue(keyTyping(roomId), []);
    const filtered = filterActive(current, TYPING_TIMEOUT_MS).filter(
      (p) => p.name.toLowerCase() !== name.toLowerCase()
    );
    filtered.push({ name, ts: Date.now() });
    await setValue(keyTyping(roomId), filtered);
    res.json({ ok: true });
  } catch (err) {
    console.error("Fehler beim Typing-Signal:", err);
    res.status(503).json({ error: "Tipp-Signal konnte nicht gespeichert werden." });
  }
});

// Raum zurücksetzen (löscht den gesamten Gesprächsverlauf). Läuft bereits
// hinter dem Zugangscode-Schutz (requireAccessCode), zusätzlich nur für den
// Administratornamen zugelassen - kein Reset durch normale Teilnehmende.
// Nutzungsübersicht für den Administrator: wie oft hat wer geschrieben.
// Nur mit Admin-Namen abrufbar, läuft bereits hinter dem Zugangscode-Schutz.
app.get("/api/room/:roomId/stats", async (req, res) => {
  try {
    const name = (req.query?.name || "").trim().toLowerCase();
    if (name !== ADMIN_NAME.toLowerCase()) {
      return res.status(403).json({ error: "Nur der Administrator darf die Übersicht sehen." });
    }
    const messages = await getMessages(req.params.roomId);
    const counts = {};
    for (const m of messages) {
      if (m.role !== "user") continue;
      counts[m.name] = (counts[m.name] || 0) + 1;
    }
    const sorted = Object.entries(counts)
      .map(([name, count]) => ({ name, nachrichten: count }))
      .sort((a, b) => b.nachrichten - a.nachrichten);
    res.json({ gesamt: messages.filter((m) => m.role === "user").length, nutzung: sorted });
  } catch (err) {
    console.error("Fehler bei Nutzungsübersicht:", err);
    res.status(503).json({ error: "Übersicht konnte nicht geladen werden." });
  }
});

app.post("/api/room/:roomId/reset", async (req, res) => {
  try {
    const name = (req.body?.name || "").trim().toLowerCase();
    if (name !== ADMIN_NAME.toLowerCase()) {
      return res.status(403).json({ error: "Nur der Administrator darf den Raum zurücksetzen." });
    }
    await resetMessages(req.params.roomId);
    res.json({ ok: true });
  } catch (err) {
    console.error("Fehler beim Zurücksetzen:", err);
    res.status(503).json({ error: "Raum konnte nicht zurückgesetzt werden." });
  }
});

// Business-Modus umschalten - berührt ausschließlich diesen einen Schlüssel.
app.post("/api/room/:roomId/business-mode", async (req, res) => {
  try {
    const businessMode = !!req.body.businessMode;
    await setValue(keyBusinessMode(req.params.roomId), businessMode);
    res.json({ businessMode });
  } catch (err) {
    console.error("Fehler beim Umschalten des Business-Modus:", err);
    res.status(503).json({ error: "Business-Modus konnte nicht geändert werden." });
  }
});

// Nachricht senden und Antwort aus dem Feld erhalten
async function callClaude(systemPrompt, history) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      // Der Signaturlehre-Prompt (Kern + Feld-Layer, optional Business) ist bei
      // jeder Nachricht identisch. cache_control markiert ihn zur Zwischen-
      // speicherung: Anthropic verarbeitet den unveränderten Teil dann nicht
      // jedes Mal neu, sondern liest ihn aus dem Cache - deutlich günstiger,
      // inhaltlich vollkommen unverändert. Cache gilt 5 Minuten, wird bei
      // jeder Nutzung automatisch verlängert.
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: history,
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API Fehler ${response.status}: ${errText}`);
  }
  const data = await response.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

async function callOpenAI(systemPrompt, history) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY fehlt auf dem Server.");
  }
  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
  ];
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_completion_tokens: 1200,
      messages,
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API Fehler ${response.status}: ${errText}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

app.post("/api/room/:roomId/message", async (req, res) => {
  try {
    const { name, schwelle, raumkoerper, text, engine } = req.body;
    if (!name || !text) {
      return res.status(400).json({ error: "name und text sind erforderlich" });
    }
    const chosenEngine = engine === "openai" ? "openai" : "claude";
    const roomId = req.params.roomId;
    const isAdmin = name.trim().toLowerCase() === ADMIN_NAME.toLowerCase();

    const userMsg = {
      id: crypto.randomUUID(),
      role: "user",
      name: name.trim(),
      schwelle: isAdmin ? ADMIN_SCHWELLE : schwelle || null,
      raumkoerper: isAdmin ? ADMIN_RAUMKOERPER : raumkoerper || null,
      isAdmin,
      text,
      ts: Date.now(),
    };
    // Atomares Anhängen - kein Lesen-Ändern-Zurückschreiben des ganzen
    // Verlaufs mehr, dadurch können zwei gleichzeitige Nachrichten sich
    // nicht mehr gegenseitig überschreiben.
    await appendMessage(roomId, userMsg);

    const [allMessages, businessMode] = await Promise.all([
      getMessages(roomId),
      getValue(keyBusinessMode(roomId), false),
    ]);

    const history = allMessages.slice(-40).map((m) => {
      if (m.role === "assistant") {
        return { role: "assistant", content: m.text };
      }
      const tag = m.isAdmin
        ? `${m.name} (Administrator, Schwelle ${ADMIN_SCHWELLE}, Raumkörper ${ADMIN_RAUMKOERPER})`
        : `${m.name}${m.schwelle ? ` (Schwelle ${m.schwelle}${m.raumkoerper ? `, Raumkörper ${m.raumkoerper}` : ""})` : ""}`;
      return { role: "user", content: `[${tag}]: ${m.text}` };
    });

    const systemPrompt = buildSystemPrompt(businessMode);
    let replyText;
    try {
      replyText =
        chosenEngine === "openai"
          ? await callOpenAI(systemPrompt, history)
          : await callClaude(systemPrompt, history);
    } catch (engineErr) {
      console.error(`${chosenEngine} Fehler:`, engineErr.message);
      return res.status(502).json({
        error:
          chosenEngine === "openai"
            ? "Der Weg 'Klarheit' konnte gerade nicht antworten."
            : "Der Weg 'Resonanz' konnte gerade nicht antworten.",
      });
    }

    const assistantMsg = {
      id: crypto.randomUUID(),
      role: "assistant",
      name: chosenEngine === "openai" ? "Klarheit" : "Resonanz",
      engine: chosenEngine,
      text: replyText || "Das Feld ist gerade still geblieben.",
      ts: Date.now(),
    };
    await appendMessage(roomId, assistantMsg);

    res.json({ userMsg, assistantMsg });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Interner Fehler im Resonanzraum." });
  }
});

// Lokal (npm start) startet der Server normal. Auf Vercel übernimmt die
// Plattform selbst das Annehmen von Requests über den Export unten.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Resonanzraum-Server läuft auf http://localhost:${PORT}`);
    console.log(`Resonanz-Modell (Claude): ${MODEL}`);
    console.log(`Klarheit-Modell (OpenAI): ${OPENAI_API_KEY ? OPENAI_MODEL : "nicht konfiguriert"}`);
    console.log(`Speicher: ${USE_REDIS ? "Upstash Redis (dauerhaft)" : "Arbeitsspeicher (nur lokal)"}`);
  });
}

export default app;
