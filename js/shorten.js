/**
 * Client-side URL shortening via CleanURI fetch plus is.gd / v.gd JSONP fallback.
 * @see https://cleanuri.com/docs
 * @see https://is.gd/apishorteningreference.php
 */

const FETCH_TIMEOUT_MS = 18000;
const JSONP_TIMEOUT_MS = 18000;

function readableProviderName(provider) {
  if (provider === "cleanuri") return "CleanURI";
  if (provider === "vgd") return "v.gd";
  return "is.gd";
}

async function shortenWithCleanUri(longUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const body = new URLSearchParams({ url: longUrl });
    const response = await fetch("https://cleanuri.com/api/v1/shorten", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
    });

    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      // The status text below is more useful than a JSON parse error.
    }

    if (!response.ok) {
      const msg = data && data.error ? data.error : response.statusText;
      throw new Error(msg || "Shortening failed.");
    }
    if (data && data.result_url) {
      return String(data.result_url).trim();
    }
    if (data && data.error) {
      throw new Error(String(data.error));
    }
    throw new Error("Unexpected response from shortening service.");
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Shortening request timed out.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function loadJsonp(url, callbackName) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const t = setTimeout(() => {
      cleanup();
      reject(new Error("Shortening request timed out."));
    }, JSONP_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(t);
      delete window[callbackName];
      script.removeEventListener("error", onScriptError);
      script.remove();
    }

    function onScriptError() {
      cleanup();
      reject(new Error("Could not reach shortening service."));
    }

    window[callbackName] = (data) => {
      cleanup();
      if (data && typeof data.errorcode === "number") {
        const msg = data.errormessage || "Shortening failed.";
        reject(new Error(msg));
        return;
      }
      if (data && data.shorturl) {
        resolve(String(data.shorturl).trim());
        return;
      }
      reject(new Error("Unexpected response from shortening service."));
    };

    script.async = true;
    script.addEventListener("error", onScriptError);
    script.src = url;
    document.body.appendChild(script);
  });
}

function makeCallbackName() {
  return `qrLinkShort_cb_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * @param {string} longUrl
 * @param {'cleanuri' | 'isgd' | 'vgd'} provider
 * @returns {Promise<string>}
 */
export function shortenWithProvider(longUrl, provider) {
  if (provider === "cleanuri") {
    return shortenWithCleanUri(longUrl);
  }

  const base = provider === "vgd" ? "https://v.gd" : "https://is.gd";
  const cb = makeCallbackName();
  const url = `${base}/create.php?format=json&url=${encodeURIComponent(longUrl)}&callback=${encodeURIComponent(cb)}`;
  return loadJsonp(url, cb);
}

/**
 * Try CleanURI first, then is.gd / v.gd on failure (blocked URLs, rate limits, outages).
 * @param {string} longUrl
 * @returns {Promise<string>}
 */
export async function shortenUrlAuto(longUrl) {
  const errors = [];
  for (const provider of ["cleanuri", "isgd", "vgd"]) {
    try {
      return await shortenWithProvider(longUrl, provider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${readableProviderName(provider)}: ${msg}`);
    }
  }
  throw new Error(errors.join(" | "));
}
