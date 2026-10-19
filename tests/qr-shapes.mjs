import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import QRCode from "../vendor/qrcode.mjs";

const source = await readFile(new URL("../js/app-browser.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const context = { Path2D: class { constructor(path) { this.path = path; } } };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf("function isDark("), source.indexOf("function createLogoMask(")), context);
vm.runInContext(source.slice(source.indexOf("function makeQrSvg("), source.indexOf("function announce(")), context);
const options = (id) => [...html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`))[1].matchAll(/value="([^"]+)"/g)].map((match) => match[1]);
const bodies = options("shape-select"), frames = options("corner-shape"), centres = options("centre-shape");
const all = [...new Set([...bodies, ...frames, ...centres])];
const paths = new Set();
for (const shape of all) {
  const path = context.qrShapePath(shape, 2, 3, 7);
  assert.ok(path.startsWith("M")); assert.ok(!/NaN|undefined|Infinity/.test(path));
  assert.ok(!paths.has(path), `${shape} must have distinct geometry`); paths.add(path);
}
const qr = QRCode.create("https://example.com/shapes", { errorCorrectionLevel: "M" });
for (const [body, frame, centre] of [...bodies.map((shape) => [shape, "square", "square"]), ...frames.map((shape) => ["square", shape, "square"]), ...centres.map((shape) => ["square", "square", shape])]) {
  const svg = context.makeQrSvg(qr, 4, "#123456", "#ffffff", body, frame, centre);
  assert.ok(!/NaN|undefined|Infinity/.test(svg));
  // Canvas and SVG must use the same frame, cutout and centre paths.
  const positions = [[4, 4], [4 + qr.modules.size - 7, 4], [4, 4 + qr.modules.size - 7]];
  for (const [corner, [x, y]] of positions.entries()) {
    const painted = [];
    const ctx = { save() {}, restore() {}, fill(value) { painted.push(value.path); } };
    context.drawFinder(ctx, x, y, 1, frame, "#ffffff", centre, corner);
    for (const path of painted) assert.ok(svg.includes(`d="${path}"`), `${frame}/${centre} corner ${corner} canvas/SVG parity`);
  }
}
assert.equal(new Set([0, 1, 2].map((corner) => context.qrShapePath("leaf-inward", 0, 0, 7, corner))).size, 3, "inward leaves must use three different orientations");
console.log(`QR shape checks passed (${bodies.length} body, ${frames.length} frame, ${centres.length} centre styles).`);
