# Resonanzraum – eigener API-Server

Das ist die "echte" Version des Resonanzraums: Der Signaturlehre-Prompt und
der Anthropic-API-Key liegen auf einem Server, den du kontrollierst – nicht
im Browser der Teilnehmenden und nicht über deren eigene Claude-Konten.

## Was das bedeutet

- Der API-Key ist **niemals** im Browser sichtbar. Er lebt ausschließlich
  serverseitig in einer `.env`-Datei.
- Alle Anfragen laufen über deinen eigenen Console-API-Key, nicht über die
  privaten Claude-Konten deiner Klienten. Damit gelten Anthropics
  **kommerzielle Bedingungen**: Ein- und Ausgaben werden standardmäßig nicht
  zum Training verwendet, Standard-Aufbewahrung 30 Tage.
- Der komplette Signaturlehre-Prompt (`prompts/core.md`), die
  Feld-Erweiterung (`prompts/field.md`) und der Business-Layer
  (`prompts/business.md`) werden bei **jedem** Request serverseitig
  zusammengesetzt – niemand außer dir kann diesen Prompt sehen oder verändern.

## Einrichtung

1. Node.js 18 oder neuer muss installiert sein.
2. Im Projektordner:
   ```
   npm install
   ```
3. `.env.example` zu `.env` kopieren und deinen echten API-Key eintragen:
   ```
   cp .env.example .env
   ```
   Den Key bekommst du in der Anthropic Console (console.anthropic.com) unter
   "API Keys". Für Gesundheitsdaten: Sprich vorher mit dem Anthropic-Sales-Team
   über eine Zero-Data-Retention-Vereinbarung für dein Konto.
4. Server starten:
   ```
   npm start
   ```
5. Im Browser öffnen: `http://localhost:3000`

## Zwei Wege: Resonanz (Claude) und Klarheit (ChatGPT)

Genau wie in deinem privaten Klarheitsraum kann jede Person im Raum wählen,
wer antwortet:

- **Resonanz** – läuft über Claude (`ANTHROPIC_API_KEY`).
- **Klarheit** – läuft über ChatGPT (`OPENAI_API_KEY`).

Beide Wege bekommen exakt denselben Prompt aus `prompts/` – Kern-Lehre,
Feld-Layer, optional Business-Layer. Der Unterschied liegt allein im
Modell, das antwortet, nicht im Prompt.

Wenn `OPENAI_API_KEY` in der `.env` fehlt, läuft "Resonanz" trotzdem ganz
normal weiter – "Klarheit" zeigt dann nur eine Fehlermeldung, bis der Key
eingetragen ist.

Die Wahl trifft jede Person für sich beim Eintritt und kann sie im Raum
jederzeit oben über der Eingabezeile wechseln – pro Nachricht, nicht global
für den ganzen Raum.

## Zugangsschutz (wichtig!)

Ohne `ACADEMY_ACCESS_CODE` ist der Raum **öffentlich erreichbar** - jede
Person, die den Link findet (z.B. über deine Website), kann schreiben und
auf deine Kosten API-Anfragen auslösen.

Setz in `.env` (lokal) bzw. in den Vercel-Umgebungsvariablen (produktiv)
einen eigenen `ACADEMY_ACCESS_CODE` und gib ihn nur echten Academy-
Teilnehmenden weiter - z.B. per E-Mail zusammen mit dem Link. Ohne
passenden Code lehnt der Server jede Anfrage mit "403 Forbidden" ab, auch
wenn jemand versucht, die API direkt anzusprechen und die Eingabemaske zu
umgehen.

## Mehrere Räume gleichzeitig

Über die URL lässt sich ein eigener Raum pro Gruppe öffnen, z.B.:
`http://localhost:3000?room=academy-gruppe-1`
`http://localhost:3000?room=academy-gruppe-2`

Jeder Raum-Name hat seinen eigenen, getrennten Nachrichtenverlauf.

## Was hier bewusst NICHT enthalten ist (ehrlich, damit nichts überrascht)

Das ist ein funktionierendes Grundgerüst, kein fertiges Produkt für den
Live-Betrieb mit sensiblen Klientendaten. Vor dem echten Einsatz mit der
Academy fehlt noch:

- **Login/Zugriffsschutz.** Aktuell kann jeder mit dem Link in einen Raum
  schreiben. Es gibt keine Passwort- oder Einladungsprüfung.
- **Persistenter Speicher.** Die Nachrichten liegen jetzt in einer echten
  Upstash-Redis-Datenbank, wenn du `UPSTASH_REDIS_REST_URL` und
  `UPSTASH_REDIS_REST_TOKEN` in der `.env` einträgst (kostenloses Konto
  reicht für den Start: https://console.upstash.com). Ohne diese Werte
  läuft der Raum nur im Arbeitsspeicher des Servers - gut zum lokalen
  Testen, aber Inhalte gehen bei jedem Neustart verloren. **Für Vercel ist
  Upstash praktisch Pflicht**, weil dort jede Anfrage auf einer neuen,
  leeren Instanz landen kann.
- **Verschlüsselung sensibler Inhalte in der Datenbank**, sobald eine
  Datenbank angebunden ist.
- **Ein Hosting.** Dieser Code muss noch auf einem Server laufen – z.B. bei
  Render, Railway, Hetzner oder deinem eigenen Root-Server. Ich kann dir
  beim nächsten Schritt helfen, das aufzusetzen, wenn du sagst, wo du hosten
  willst.
- **Rechtliche Prüfung.** Bei gesundheitsnahen Klientendaten empfehle ich dir,
  das kurz mit jemandem vom Fach zum Datenschutz (DSG/DSGVO) gegenzuchecken,
  bevor die Academy live geht.

## Modell wechseln

In `.env`: `CLAUDE_MODEL=claude-opus-4-8` für die aktuelle Opus-Generation,
falls du mehr Tiefe statt Geschwindigkeit willst. Sonnet ist schneller und
günstiger, Opus trägt mehr Kontext und Nuance bei sehr langen Gesprächen.
