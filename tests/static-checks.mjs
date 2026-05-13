import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const files = {
  index: new URL("../index.html", import.meta.url),
  appSingle: new URL("../app-single.html", import.meta.url),
  app: new URL("../js/app.js", import.meta.url),
  appBrowser: new URL("../js/app-browser.js", import.meta.url),
  qrLoad: new URL("../js/qr-load.js", import.meta.url),
  pdfLoad: new URL("../js/pdf-load.js", import.meta.url),
  qrBundle: new URL("../vendor/qrcode.mjs", import.meta.url),
  pdfBundle: new URL("../vendor/jspdf.mjs", import.meta.url),
  qrGlobal: new URL("../vendor/qrcode.global.js", import.meta.url),
  pdfGlobal: new URL("../vendor/jspdf.umd.min.js", import.meta.url),
  barcodeGlobal: new URL("../vendor/jsbarcode.umd.min.js", import.meta.url),
  jsqr: new URL("../vendor/jsqr.js", import.meta.url),
};

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

const index = await readFile(files.index, "utf8");
assert.equal(count(index, "<!DOCTYPE html>"), 1, "index.html must contain exactly one HTML document");
assert.match(index, /<script src="\.\/vendor\/qrcode\.global\.js"><\/script>/, "index.html must load the file-compatible QR bundle");
assert.match(index, /<script src="\.\/vendor\/jsbarcode\.umd\.min\.js"><\/script>/, "index.html must load the file-compatible JsBarcode bundle");
assert.match(index, /<script src="\.\/vendor\/jspdf\.umd\.min\.js"><\/script>/, "index.html must load the file-compatible PDF bundle");
assert.match(index, /<script src="\.\/js\/app-browser\.js"><\/script>/, "index.html must load the file-compatible browser app");
assert.match(index, /id="barcode-type"/, "index.html must expose the barcode type dropdown");
assert.match(index, /<option[^>]+value="qr"/, "barcode type dropdown must include a QR option");
assert.doesNotMatch(index, /http-equiv="refresh"/i, "index.html must not redirect away from the maintained app");

const appSingle = await readFile(files.appSingle, "utf8");
assert.match(appSingle, /url=\.\/index\.html/, "app-single.html should redirect to the maintained entrypoint");

const qrLoad = await readFile(files.qrLoad, "utf8");
const pdfLoad = await readFile(files.pdfLoad, "utf8");
assert.match(qrLoad, /\.\.\/vendor\/qrcode\.mjs/, "QR loader should use the local bundle");
assert.match(pdfLoad, /\.\.\/vendor\/jspdf\.mjs/, "PDF loader should use the local bundle");
assert.doesNotMatch(qrLoad + pdfLoad, /https:\/\/(cdn\.jsdelivr\.net|esm\.sh)/, "runtime loaders must not import QR/PDF libraries from CDNs");

const qrBundleStat = await stat(files.qrBundle);
const pdfBundleStat = await stat(files.pdfBundle);
const qrGlobalStat = await stat(files.qrGlobal);
const pdfGlobalStat = await stat(files.pdfGlobal);
const barcodeGlobalStat = await stat(files.barcodeGlobal);
assert.ok(qrBundleStat.size > 10_000, "vendored QR bundle looks too small");
assert.ok(pdfBundleStat.size > 100_000, "vendored jsPDF bundle looks too small");
assert.ok(qrGlobalStat.size > 10_000, "vendored QR global bundle looks too small");
assert.ok(pdfGlobalStat.size > 100_000, "vendored jsPDF UMD bundle looks too small");
assert.ok(barcodeGlobalStat.size > 10_000, "vendored JsBarcode UMD bundle looks too small");
const jsqrStat = await stat(files.jsqr);
assert.ok(jsqrStat.size > 100_000, "vendored jsQR bundle looks too small");

const QRModule = await import(files.qrBundle.href);
const QRCode = QRModule.default || QRModule;
assert.equal(typeof QRCode.create, "function", "vendored QR bundle should expose create()");
const qr = QRCode.create("https://example.com/test", { errorCorrectionLevel: "M" });
assert.equal(typeof qr.modules.size, "number", "QR module matrix should expose a size");
assert.ok(qr.modules.size >= 21, "QR module matrix should be a valid QR size");
assert.equal(qr.modules.data.length, qr.modules.size * qr.modules.size, "QR module matrix dimensions should match data length");

const PdfModule = await import(files.pdfBundle.href);
const jsPDF = PdfModule.jsPDF || PdfModule.default?.jsPDF || PdfModule.default;
assert.equal(typeof jsPDF, "function", "vendored jsPDF bundle should expose a constructor");

const app = await readFile(files.app, "utf8");
assert.match(app, /is\.gd\/v\.gd|is\.gd, then v\.gd/, "app copy should disclose third-party link shortening");
const appBrowser = await readFile(files.appBrowser, "utf8");
assert.doesNotMatch(appBrowser, /^import\s/m, "file-compatible app must not use module imports");
assert.match(appBrowser, /is\.gd\/v\.gd|is\.gd, then v\.gd/, "file-compatible app copy should disclose third-party link shortening");

console.log("Static checks passed.");
