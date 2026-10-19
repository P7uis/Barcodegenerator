import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../js/translations.js", import.meta.url), "utf8");
const document = { documentElement: { lang: "en" }, body: {} };
const context = { document, window: {}, MutationObserver: class { observe() {} } };
vm.createContext(context);
vm.runInContext(source, context);
const translate = context.window.localizeUi;
for (const [lang, expected] of [["en", "Use my location"], ["nl", "Mijn locatie gebruiken"], ["de", "Meinen Standort verwenden"]]) {
  document.documentElement.lang = lang;
  assert.equal(translate("Use my location"), expected);
  assert.equal(translate("https://example.com/my-content"), "https://example.com/my-content");
}
document.documentElement.lang = "nl";
assert.equal(translate("Pin placed at 52.123456, 4.654321."), "Speld geplaatst op 52.123456, 4.654321.");
assert.match(translate("QR 21×21 modules · 0.42 mm/module · ECC M · quiet zone 4. Warning: increase colour contrast."), /foutcorrectie M.*Let op: vergroot het kleurcontrast/);
document.documentElement.lang = "de";
assert.equal(translate("Open example.com?\n\nhttps://example.com"), "example.com öffnen?\n\nhttps://example.com");
assert.equal(translate("My network is hidden"), "Mein Netzwerk ist ausgeblendet");
// Check all translation rows, including punctuation and Unicode accents.
const rows = [...source.matchAll(/^    \[("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*")\],?$/gm)];
assert.ok(rows.length > 80);
for (const match of rows) {
  const entries = match.slice(1).map(JSON.parse);
  for (const [index, lang] of ["en", "nl", "de"].entries()) {
    document.documentElement.lang = lang;
    assert.equal(translate(entries[0]), entries[index], `${lang}: ${entries[0]}`);
  }
}
console.log(`Translation checks passed (${rows.length} phrases, three languages).`);
