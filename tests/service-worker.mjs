import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");
const base = "https://example.com/Barcodegenerator/";
const key = (request) => new URL(typeof request === "string" ? request : request.url, base).href;
const entries = new Map();
const cache = { async match(request) { return entries.get(key(request)); }, async put(request, response) { entries.set(key(request), response); } };
const handlers = {};
const deleted = [];
let online = true;
const context = {
  self: { location: { origin: "https://example.com" }, addEventListener(name, callback) { handlers[name] = callback; }, clients: { async claim() {} } },
  caches: { async open() { return cache; }, async keys() { return ["barcode-creator-tool-v1", "unrelated-app"]; }, async delete(name) { deleted.push(name); } },
  Response, URL,
  fetch: async (_request, options) => { assert.equal(options.cache, "no-cache"); if (!online) throw new Error("offline"); return new Response("fresh script"); },
};
vm.createContext(context); vm.runInContext(source, context);
const request = { method: "GET", mode: "cors", url: base + "js/app-browser.js?v=2.6.2" };
entries.set(key(request), new Response("stale script"));
async function get(request) { let result; handlers.fetch({ request, respondWith(promise) { result = promise; } }); return await result; }
assert.equal(await (await get(request)).text(), "fresh script", "online requests must bypass stale application caches");
online = false;
assert.equal(await (await get(request)).text(), "fresh script", "offline requests must retain the latest cached script");
entries.set(key("./index.html"), new Response("offline page"));
assert.equal(await (await get({ ...request, mode: "navigate", url: base + "other-page" })).text(), "offline page");
let activation; handlers.activate({ waitUntil(promise) { activation = promise; } }); await activation;
assert.deepEqual(deleted, ["barcode-creator-tool-v1"], "activation must preserve other applications' caches");
console.log("Service-worker online update and offline fallback checks passed.");
