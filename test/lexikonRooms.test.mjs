import assert from "node:assert/strict";
import test from "node:test";
import { signaturLexikon as deEntries, sucheImLexikon as searchDe } from "../public/signaturLexikon.js";


const languages = [
  { name: "Deutsch", entries: deEntries, search: searchDe, overview: "Entwicklungsräume", room: "Raum", aliases: ["Räume", "Raeume", "Raum", "Entwicklungsräume", "Entwicklungsraeume", "Entwicklungsraum"], other: ["Ursignatur", "Raumkörper", "Achsen"] },

];

for (const lang of languages) {
  test(lang.name + ": Raum-Gruppenbegriffe erschliessen die Übersicht und alle neun Räume", () => {
    const expected = [lang.overview, ...Array.from({ length: 9 }, (_, i) => lang.room + " " + (i + 1))];
    for (const alias of lang.aliases) assert.deepEqual(lang.search(alias).map(e => e.term), expected, alias);
  });
  test(lang.name + ": Einzelräume und kompakte Nummernsuche bleiben eindeutig", () => {
    for (let i = 1; i <= 9; i++) {
      const term = lang.room + " " + i;
      assert.deepEqual(lang.search(term).map(e => e.term), [term]);
      assert.deepEqual(lang.search(lang.room + i).map(e => e.term), [term]);
      assert.ok(lang.search(term)[0].lang.length > 200);
    }
  });
  test(lang.name + ": Die neun Zuordnungen stehen auf getrennten, verlinkbaren Zeilen", () => {
    const overview = lang.entries.find(e => e.term === lang.overview);
    const rows = overview.lang.split("\n\n").filter(p => /^(Raum|Room) [1-9] – /.test(p));
    assert.equal(rows.length, 9);
    for (let i = 0; i < 9; i++) {
      assert.ok(rows[i].startsWith(lang.room + " " + (i + 1) + " – "));
      assert.ok(lang.entries.some(e => e.term === lang.room + " " + (i + 1)));
    }
  });
  test(lang.name + ": Andere Kernbegriffe bleiben direkt erreichbar", () => {
    for (const term of lang.other) assert.equal(lang.search(term)[0].term, term);
  });
  test(lang.name + ": Leere und zu kurze Suchanfragen ergeben keine Treffer", () => {
    for (const value of ["", " ", "r"]) assert.deepEqual(lang.search(value), []);
  });
}
