import { sucheImLexikon } from "./signaturLexikon.js";

const ADMIN_NAME = "Thomas";
const ADMIN_SCHWELLE = 4;
const ADMIN_RAUMKOERPER = 13;
const ROOM_ID = new URLSearchParams(location.search).get("room") || "default";

let state = { name: "", schwelle: "", raumkoerper: "", isAdmin: false, sending: false, engine: "claude", accessCode: "" };

const entryScreen = document.getElementById("entry-screen");
const roomScreen = document.getElementById("room-screen");
const entryForm = document.getElementById("entry-form");
const messagesEl = document.getElementById("messages");
const errorBar = document.getElementById("error-bar");
const msgInput = document.getElementById("msg-input");
const sendBtn = document.getElementById("send-btn");
const headerSub = document.getElementById("header-sub");
const businessBtn = document.getElementById("business-toggle-btn");
const saveBtn = document.getElementById("save-btn");
const resetBtn = document.getElementById("reset-btn");
const lexikonBtn = document.getElementById("lexikon-btn");
const lexikonOverlay = document.getElementById("lexikon-overlay");
const lexikonCloseBtn = document.getElementById("lexikon-close-btn");
const lexikonSearch = document.getElementById("lexikon-search");
const lexikonResults = document.getElementById("lexikon-results");
const typingIndicator = document.getElementById("typing-indicator");

let businessMode = false;
let currentMessages = [];

document.querySelectorAll("#engine-choice .engine-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#engine-choice .engine-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.engine = btn.dataset.engine;
  });
});

document.querySelectorAll("#room-engine-switch .engine-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#room-engine-switch .engine-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.engine = btn.dataset.engine;
  });
});

entryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("name-input").value.trim();
  const accessCode = document.getElementById("access-code-input").value.trim();
  if (!name || !accessCode) return;

  const submitBtn = entryForm.querySelector(".entry-button");
  submitBtn.disabled = true;
  submitBtn.textContent = "Prüfe Zugangscode …";

  // Zugangscode serverseitig prüfen, bevor der Raum überhaupt geöffnet wird.
  try {
    const check = await fetch(`/api/room/${ROOM_ID}`, {
      headers: { "x-academy-code": accessCode },
    });
    if (!check.ok) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Eintreten";
      alert("Zugangscode ist ungültig. Bitte beim Administrator nachfragen.");
      return;
    }
  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Eintreten";
    alert("Verbindung zum Resonanzraum fehlgeschlagen. Bitte erneut versuchen.");
    return;
  }

  state.name = name;
  state.accessCode = accessCode;
  state.isAdmin = name.toLowerCase() === ADMIN_NAME.toLowerCase();
  state.schwelle = state.isAdmin ? String(ADMIN_SCHWELLE) : "";
  state.raumkoerper = state.isAdmin ? String(ADMIN_RAUMKOERPER) : "";

  entryScreen.style.display = "none";
  roomScreen.style.display = "flex";
  if (state.isAdmin) {
    businessBtn.style.display = "inline-block";
    resetBtn.style.display = "inline-block";
  }

  document.querySelectorAll("#room-engine-switch .engine-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.engine === state.engine);
  });

  forceScrollNext = true;
  loadRoom();
  setInterval(loadRoom, 4000);
  sendHeartbeat();
  setInterval(sendHeartbeat, 20000);
});

businessBtn.addEventListener("click", async () => {
  businessMode = !businessMode;
  updateBusinessUI();
  await fetch(`/api/room/${ROOM_ID}/business-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-academy-code": state.accessCode },
    body: JSON.stringify({ businessMode }),
  });
});

function updateBusinessUI() {
  businessBtn.textContent = businessMode ? "Business-Modus an" : "Business-Modus aus";
  businessBtn.classList.toggle("active", businessMode);
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "gerade eben";
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std`;
  return new Date(ts).toLocaleDateString("de-DE");
}

let forceScrollNext = false;

function renderMessages(messages) {
  // Nur nach unten springen, wenn man ohnehin schon (fast) unten war -
  // also gerade live mitliest - oder wenn man gerade selbst etwas
  // abgeschickt hat (forceScrollNext). Wer bewusst nach oben gescrollt hat,
  // um Älteres zu lesen, wird sonst nicht mehr ständig nach unten gerissen.
  const NAHE_UNTEN_PX = 80;
  const warSchonUnten =
    forceScrollNext ||
    messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < NAHE_UNTEN_PX;
  forceScrollNext = false;

  messagesEl.innerHTML = "";
  if (messages.length === 0) {
    messagesEl.innerHTML = '<div class="empty-state">Der Raum ist noch still. Bring, was gerade da ist.</div>';
    return;
  }
  for (const m of messages) {
    const row = document.createElement("div");
    row.className = `msg-row ${m.role}`;

    if (m.role === "assistant") {
      const avatar = document.createElement("div");
      avatar.className = "msg-avatar";
      row.appendChild(avatar);
    }

    const bubble = document.createElement("div");
    bubble.className = `bubble ${m.role}`;

    const meta = document.createElement("div");
    meta.className = "bubble-meta";
    if (m.role === "user") {
      meta.textContent = m.isAdmin
        ? `${m.name} · Schwelle ${ADMIN_SCHWELLE} · Raumkörper ${ADMIN_RAUMKOERPER}`
        : `${m.name}${m.schwelle ? ` · Schwelle ${m.schwelle}${m.raumkoerper ? ` · Raumkörper ${m.raumkoerper}` : ""}` : ""}`;
    } else {
      meta.textContent = m.name || (m.engine === "openai" ? "Klarheit" : "Resonanz");
    }
    bubble.appendChild(meta);

    const text = document.createElement("div");
    text.className = "bubble-text";
    text.textContent = m.text;
    bubble.appendChild(text);

    const time = document.createElement("div");
    time.className = "bubble-time";
    time.textContent = timeAgo(m.ts);
    bubble.appendChild(time);

    row.appendChild(bubble);
    messagesEl.appendChild(row);
  }

  if (warSchonUnten) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

async function loadRoom() {
  try {
    const res = await fetch(`/api/room/${ROOM_ID}`, {
      headers: { "x-academy-code": state.accessCode },
    });

    if (!res.ok) {
      // Fehlgeschlagene Abfrage NICHT wie einen leeren Raum behandeln -
      // sonst wird der Bildschirm bei jedem kurzen Netzwerk-Ruckler leer
      // geleert und beim nächsten Poll wieder gefüllt ("Flackern").
      // Stattdessen: aktuellen Stand einfach unverändert lassen, nur den
      // Hinweis zeigen.
      errorBar.style.display = "block";
      errorBar.textContent = "Verbindung zum Resonanzraum unterbrochen - Anzeige bleibt beim letzten bekannten Stand.";
      return;
    }

    const data = await res.json();
    currentMessages = data.messages || [];
    renderMessages(currentMessages);
    businessMode = !!data.businessMode;
    updateBusinessUI();

    const names = data.presence || [];
    let sub = names.length
      ? `${names.length} ${names.length === 1 ? "Signatur" : "Signaturen"} aktiv: ${names.join(", ")}`
      : "verbunden";
    if (state.isAdmin) sub += " · du bist Administrator";
    if (businessMode) sub += " · Business-Modus";
    headerSub.textContent = sub;

    const typingOthers = (data.typing || []).filter(
      (n) => n.toLowerCase() !== state.name.toLowerCase()
    );
    if (typingOthers.length > 0) {
      const verb = typingOthers.length === 1 ? "schreibt" : "schreiben";
      typingIndicator.textContent = `${typingOthers.join(", ")} ${verb} gerade …`;
      typingIndicator.style.display = "block";
    } else {
      typingIndicator.style.display = "none";
    }

    errorBar.style.display = "none";
  } catch (e) {
    errorBar.style.display = "block";
    errorBar.textContent = "Verbindung zum Resonanzraum unterbrochen.";
  }
}

async function sendHeartbeat() {
  try {
    await fetch(`/api/room/${ROOM_ID}/presence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-academy-code": state.accessCode },
      body: JSON.stringify({ name: state.name }),
    });
  } catch (e) {
    // Anwesenheit ist nicht kritisch - stiller Fehlschlag reicht hier
  }
}

function downloadConversation() {
  if (!currentMessages.length) return;
  const lines = [
    `Resonanzraum – Gespräch`,
    `Raum: ${ROOM_ID}`,
    `Gespeichert am: ${new Date().toLocaleString("de-DE")}`,
    `${"=".repeat(50)}`,
    "",
  ];
  for (const m of currentMessages) {
    const who =
      m.role === "assistant"
        ? "Resonator"
        : m.isAdmin
        ? `${m.name} (Administrator, Schwelle ${ADMIN_SCHWELLE}, Raumkörper ${ADMIN_RAUMKOERPER})`
        : `${m.name}${m.schwelle ? ` (Schwelle ${m.schwelle}${m.raumkoerper ? `, Raumkörper ${m.raumkoerper}` : ""})` : ""}`;
    const when = new Date(m.ts).toLocaleString("de-DE");
    lines.push(`[${when}] ${who}:`);
    lines.push(m.text);
    lines.push("");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `resonanzraum-${ROOM_ID}-${dateStr}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

saveBtn.addEventListener("click", downloadConversation);

resetBtn.addEventListener("click", async () => {
  const first = confirm(
    `Wirklich den GESAMTEN Gesprächsverlauf im Raum "${ROOM_ID}" unwiderruflich löschen?`
  );
  if (!first) return;
  const second = confirm("Ganz sicher? Das kann nicht rückgängig gemacht werden.");
  if (!second) return;

  try {
    const res = await fetch(`/api/room/${ROOM_ID}/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-academy-code": state.accessCode },
      body: JSON.stringify({ name: state.name }),
    });
    if (!res.ok) throw new Error("reset failed");
    currentMessages = [];
    renderMessages(currentMessages);
    errorBar.style.display = "none";
  } catch (e) {
    errorBar.style.display = "block";
    errorBar.textContent = "Zurücksetzen fehlgeschlagen. Bitte erneut versuchen.";
  }
});

async function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || state.sending) return;
  state.sending = true;
  msgInput.value = "";
  sendBtn.disabled = true;

  try {
    forceScrollNext = true;
    const res = await fetch(`/api/room/${ROOM_ID}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-academy-code": state.accessCode },
      body: JSON.stringify({
        name: state.name,
        schwelle: state.schwelle,
        raumkoerper: state.raumkoerper,
        text,
        engine: state.engine,
      }),
    });
    if (!res.ok) throw new Error("send failed");
    await loadRoom();
  } catch (e) {
    errorBar.style.display = "block";
    errorBar.textContent = "Der Resonator konnte gerade nicht antworten.";
  } finally {
    state.sending = false;
  }
}

let lastTypingPing = 0;
msgInput.addEventListener("input", () => {
  sendBtn.disabled = !msgInput.value.trim();
  const now = Date.now();
  if (msgInput.value.trim() && now - lastTypingPing > 3000) {
    lastTypingPing = now;
    fetch(`/api/room/${ROOM_ID}/typing`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-academy-code": state.accessCode },
      body: JSON.stringify({ name: state.name }),
    }).catch(() => {});
  }
});
msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
sendBtn.addEventListener("click", sendMessage);

// ---- Signatur-Enzyklopädie ----
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderLexikonEntries(entries) {
  lexikonResults.innerHTML = "";
  if (entries.length === 0) {
    lexikonResults.innerHTML =
      '<div class="lexikon-hint">Tippe mindestens zwei Zeichen, um einen Begriff zu suchen.</div>';
    return;
  }
  for (const entry of entries) {
    const el = document.createElement("div");
    el.className = "lexikon-entry";
    el.innerHTML = `
      <div class="lexikon-term">${escapeHtml(entry.term)}</div>
      <p class="lexikon-kurz">${escapeHtml(entry.kurz)}</p>
      <button class="lexikon-toggle" type="button">Mehr erfahren</button>
      <div class="lexikon-lang" style="display:none;">${escapeHtml(entry.lang)}</div>
    `;
    const toggleBtn = el.querySelector(".lexikon-toggle");
    const langEl = el.querySelector(".lexikon-lang");
    toggleBtn.addEventListener("click", () => {
      const expanded = langEl.style.display !== "none";
      langEl.style.display = expanded ? "none" : "block";
      toggleBtn.textContent = expanded ? "Mehr erfahren" : "Weniger anzeigen";
    });
    lexikonResults.appendChild(el);
  }
}

function openLexikon() {
  lexikonOverlay.style.display = "flex";
  lexikonSearch.value = "";
  lexikonSearch.focus();
  renderLexikonEntries([]);
}

function closeLexikon() {
  lexikonOverlay.style.display = "none";
}

lexikonBtn.addEventListener("click", openLexikon);
lexikonCloseBtn.addEventListener("click", closeLexikon);
lexikonOverlay.addEventListener("click", (e) => {
  if (e.target === lexikonOverlay) closeLexikon();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && lexikonOverlay.style.display === "flex") closeLexikon();
});
lexikonSearch.addEventListener("input", () => {
  const results = sucheImLexikon(lexikonSearch.value);
  renderLexikonEntries(results);
});
