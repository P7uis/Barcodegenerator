/**
 * Renders QR to canvas with optional module styling and center logo.
 */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function fillRoundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rr);
  } else {
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 */
function fillCircle(ctx, cx, cy, radius) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLImageElement} img
 * @param {number} fraction
 */
function drawCenterLogo(canvas, img, fraction) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const maxSide = Math.floor(w * fraction);
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) return;

  const scale = Math.min(maxSide / iw, maxSide / ih);
  const lw = Math.round(iw * scale);
  const lh = Math.round(ih * scale);
  const pad = Math.max(4, Math.round(w * 0.02));
  const rw = lw + pad * 2;
  const rh = lh + pad * 2;
  const rx = Math.round((w - rw) / 2);
  const ry = Math.round((w - rh) / 2);

  ctx.save();
  ctx.fillStyle = "#ffffff";
  fillRoundRect(ctx, rx, ry, rw, rh, Math.min(12, Math.floor(Math.min(rw, rh) / 5)));
  ctx.drawImage(img, rx + pad, ry + pad, lw, lh);
  ctx.restore();
}

/**
 * @param {*} qrModules
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function isDark(qrModules, x, y) {
  if (!qrModules) return false;
  if (typeof qrModules.get === "function") return Boolean(qrModules.get(x, y));
  if (Array.isArray(qrModules.data) && typeof qrModules.size === "number") {
    return Boolean(qrModules.data[y * qrModules.size + x]);
  }
  return false;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @returns {boolean}
 */
function isInFinder(x, y, size) {
  const zones = [
    { x: 0, y: 0 },
    { x: size - 7, y: 0 },
    { x: 0, y: size - 7 },
  ];
  return zones.some((z) => x >= z.x && x < z.x + 7 && y >= z.y && y < z.y + 7);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} px
 * @param {number} py
 * @param {number} unit
 * @param {"square"|"rounded"|"dots"} shape
 */
function drawModule(ctx, px, py, unit, shape) {
  if (shape === "dots") {
    fillCircle(ctx, px + unit / 2, py + unit / 2, unit * 0.38);
    return;
  }
  if (shape === "rounded") {
    fillRoundRect(ctx, px, py, unit, unit, unit * 0.32);
    return;
  }
  ctx.fillRect(px, py, unit, unit);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} left
 * @param {number} top
 * @param {number} unit
 * @param {"square"|"rounded"|"dots"} finderShape
 */
function drawFinder(ctx, left, top, unit, finderShape) {
  const outer = unit * 7;
  const innerCut = unit * 5;
  const center = unit * 3;
  const innerDot = unit * 3;
  const outerRadius = finderShape === "square" ? 0 : unit * 1.2;
  const centerRadius = finderShape === "square" ? 0 : unit * 0.9;

  fillRoundRect(ctx, left, top, outer, outer, outerRadius);
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  fillRoundRect(ctx, left + unit, top + unit, innerCut, innerCut, Math.max(0, outerRadius - unit * 0.45));
  ctx.restore();
  fillRoundRect(ctx, left + unit * 2, top + unit * 2, center, innerDot, centerRadius);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {*} qrData
 * @param {number} width
 * @param {number} margin
 * @param {"square"|"rounded"|"dots"} shape
 */
function paintStyledQr(canvas, qrData, width, margin, shape) {
  const modules = qrData.modules;
  const size = modules.size;
  const fullCount = size + margin * 2;
  const unit = width / fullCount;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to get 2D canvas context.");

  canvas.width = width;
  canvas.height = width;
  ctx.clearRect(0, 0, width, width);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, width);
  ctx.fillStyle = "#000000";

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!isDark(modules, x, y)) continue;
      if (isInFinder(x, y, size)) continue;
      const px = (x + margin) * unit;
      const py = (y + margin) * unit;
      drawModule(ctx, px, py, unit, shape);
    }
  }

  const finderShape = shape === "dots" ? "rounded" : shape;
  const offsets = [
    { x: margin, y: margin },
    { x: margin + (size - 7), y: margin },
    { x: margin, y: margin + (size - 7) },
  ];
  offsets.forEach((o) => drawFinder(ctx, o.x * unit, o.y * unit, unit, finderShape));
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} text
 * @param {*} QRCode
 * @param {{ width?: number, margin?: number, logoImage?: HTMLImageElement | null, logoSizeFraction?: number, moduleShape?: "square"|"rounded"|"dots" }} [options]
 * @returns {Promise<void>}
 */
export function renderQrToCanvas(canvas, text, QRCode, options = {}) {
  const width = options.width ?? 256;
  const margin = options.margin ?? 2;
  const logo = options.logoImage && options.logoImage.complete ? options.logoImage : null;
  const moduleShape = options.moduleShape ?? "square";
  const errorCorrectionLevel = logo ? "H" : "M";

  return new Promise((resolve, reject) => {
    try {
      const qrData = QRCode.create(text, { errorCorrectionLevel });
      paintStyledQr(canvas, qrData, width, margin, moduleShape);
      if (logo && logo.naturalWidth > 0) {
        drawCenterLogo(canvas, logo, options.logoSizeFraction ?? 0.22);
      }
      resolve();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
