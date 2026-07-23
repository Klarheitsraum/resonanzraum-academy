// Erzeugt einen neuen, zufälligen Zugangscode für den Resonanzraum.
//
// Benutzung:
//   node generate-code.js
//
// Der erzeugte Code muss danach manuell in Vercel unter "Umgebungsvariablen"
// bei ACADEMY_ACCESS_CODE eingetragen werden (alten Wert ersetzen), dann
// einmal "Redeploy". Erst danach ist der neue Code aktiv, der alte
// funktioniert nicht mehr.

const WORTE = [
  "quelle", "raum", "klarheit", "resonanz", "schwelle", "signatur",
  "achse", "vektor", "echo", "feld", "kern", "spiegel", "pfad", "kreis",
  "stern", "welle", "ton", "licht", "boden", "horizont",
];

function zufallsZahl(max) {
  return Math.floor(Math.random() * max);
}

function neuerCode() {
  const wort = WORTE[zufallsZahl(WORTE.length)];
  const zahl = 100 + zufallsZahl(900); // dreistellige Zahl, 100-999
  const jahr = new Date().getFullYear();
  return `${wort}-${zahl}-${jahr}`;
}

const code = neuerCode();

console.log("");
console.log("Neuer Zugangscode:");
console.log("");
console.log("  " + code);
console.log("");
console.log("Naechste Schritte:");
console.log("1. Vercel -> Umgebungsvariablen -> ACADEMY_ACCESS_CODE bearbeiten");
console.log("2. Diesen Wert eintragen: " + code);
console.log("3. Speichern, dann Deployments -> neuester Eintrag -> Redeploy");
console.log("4. Alten Code an alle aktuell Berechtigten neu verteilen");
console.log("");
