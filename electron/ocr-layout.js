import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeRect(rect, imageSize) {
  if (!rect || !imageSize) return null;
  const left = clamp(Math.round(rect.left), 0, Math.max(0, imageSize.width - 1));
  const top = clamp(Math.round(rect.top), 0, Math.max(0, imageSize.height - 1));
  const right = clamp(Math.round(rect.left + rect.width), left + 1, imageSize.width);
  const bottom = clamp(Math.round(rect.top + rect.height), top + 1, imageSize.height);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += Number(value) || 0;
  return total / values.length;
}

function movingAverage(values, radius = 1) {
  const out = new Array(values.length).fill(0);
  for (let index = 0; index < values.length; index += 1) {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    let total = 0;
    let count = 0;
    for (let cursor = start; cursor <= end; cursor += 1) {
      total += values[cursor];
      count += 1;
    }
    out[index] = count > 0 ? total / count : 0;
  }
  return out;
}

function longestDarkRun(values, threshold) {
  let best = 0;
  let current = 0;
  for (const value of values) {
    if (value <= threshold) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return best;
}

function scoreHorizontalRow(gray, width, y, startX, endX, darkThreshold) {
  const row = [];
  const offset = y * width;
  for (let x = startX; x < endX; x += 1) {
    row.push(gray[offset + x]);
  }
  const darkCount = row.filter((value) => value <= darkThreshold).length;
  const longestRun = longestDarkRun(row, darkThreshold);
  const total = Math.max(1, row.length);
  return 0.7 * (longestRun / total) + 0.3 * (darkCount / total);
}

function scoreVerticalColumn(gray, width, height, x, startY, endY, darkThreshold) {
  const col = [];
  for (let y = startY; y < endY; y += 1) {
    col.push(gray[(y * width) + x]);
  }
  const darkCount = col.filter((value) => value <= darkThreshold).length;
  const longestRun = longestDarkRun(col, darkThreshold);
  const total = Math.max(1, col.length);
  return 0.7 * (longestRun / total) + 0.3 * (darkCount / total);
}

function findBestIndex(scores, start, end, minScore) {
  let bestIndex = -1;
  let bestScore = minScore;
  for (let index = start; index <= end; index += 1) {
    const score = scores[index];
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return { index: bestIndex, score: bestScore };
}

function ensureDir(dir) {
  if (!dir) return;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function spawnBuffer(cmd, args, options = {}) {
  return new Promise((resolve) => {
    try {
      const proc = spawn(cmd, args, {
        env: { ...process.env, ...(options.env || {}) },
        shell: false,
      });
      const outChunks = [];
      const errChunks = [];
      let settled = false;
      let timer = null;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      };
      const timeoutMs = Number(options.timeoutMs) || 0;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          try { proc.kill(); } catch (_) {}
          finish({
            code: -2,
            err: Buffer.concat(errChunks).toString("utf-8") || `Process timeout after ${timeoutMs}ms: ${cmd}`,
            out: Buffer.concat(outChunks),
          });
        }, timeoutMs);
      }
      proc.stdout.on("data", (chunk) => outChunks.push(Buffer.from(chunk)));
      proc.stderr.on("data", (chunk) => errChunks.push(Buffer.from(chunk)));
      proc.on("exit", (code) => {
        finish({
          code,
          err: Buffer.concat(errChunks).toString("utf-8"),
          out: Buffer.concat(outChunks),
        });
      });
      proc.on("error", (error) => {
        finish({
          code: -1,
          err: error && error.message ? error.message : String(error),
          out: Buffer.alloc(0),
        });
      });
    } catch (error) {
      resolve({
        code: -1,
        err: error && error.message ? error.message : String(error),
        out: Buffer.alloc(0),
      });
    }
  });
}

export function normalizeLayoutRuntimeOptions(raw = {}, defaults = {}) {
  const layoutMode = raw.layoutMode === "box_notes"
    ? "box_notes"
    : (defaults.ocrLayoutMode === "box_notes" ? "box_notes" : "full");
  const clampPct = (value, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return clamp(num, 0, 0.2);
  };
  return {
    layoutMode,
    boxPaddingPct: clampPct(raw.boxPaddingPct, Number(defaults.ocrBoxPaddingPct) || 0.01),
    notePaddingPct: clampPct(raw.notePaddingPct, Number(defaults.ocrNotePaddingPct) || 0.01),
    outsideFormat: raw.outsideFormat === "zoned"
      ? "zoned"
      : (defaults.ocrOutsideFormat === "zoned" ? "zoned" : "flat"),
  };
}

export async function getImageSize(imagePath, options = {}) {
  const cmd = options.magickPath || "magick";
  const args = ["identify", "-format", "%w %h", imagePath];
  const res = await spawnBuffer(cmd, args, { timeoutMs: options.timeoutMs || 10000 });
  if (res.code !== 0) {
    return { ok: false, error: res.err || `magick identify exited with code ${res.code}` };
  }
  const raw = String(res.out || "").trim();
  const match = raw.match(/^(\d+)\s+(\d+)$/);
  if (!match) return { ok: false, error: `Unable to parse image size: ${raw}` };
  return {
    ok: true,
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

async function loadGrayPreview(imagePath, options = {}) {
  const size = await getImageSize(imagePath, options);
  if (!size.ok) return size;
  const width = Number(size.width);
  const height = Number(size.height);
  const maxDim = clamp(Number(options.previewMaxDim) || 320, 128, 512);
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const previewWidth = Math.max(64, Math.round(width * scale));
  const previewHeight = Math.max(64, Math.round(height * scale));
  const cmd = options.magickPath || "magick";
  const args = [
    imagePath,
    "-colorspace",
    "Gray",
    "-filter",
    "Triangle",
    "-resize",
    `${previewWidth}x${previewHeight}!`,
    "-depth",
    "8",
    "gray:-",
  ];
  const res = await spawnBuffer(cmd, args, { timeoutMs: options.timeoutMs || 15000 });
  if (res.code !== 0) {
    return { ok: false, error: res.err || `magick preview exited with code ${res.code}` };
  }
  const expectedLength = previewWidth * previewHeight;
  if (!res.out || res.out.length < expectedLength) {
    return { ok: false, error: "Gray preview buffer terlalu kecil untuk diproses." };
  }
  return {
    ok: true,
    originalWidth: width,
    originalHeight: height,
    previewWidth,
    previewHeight,
    gray: Uint8Array.from(res.out.subarray(0, expectedLength)),
  };
}

export async function detectMainBox(imagePath, options = {}) {
  const preview = await loadGrayPreview(imagePath, options);
  if (!preview.ok) return { ok: false, error: preview.error, detected: false };
  const {
    gray,
    previewWidth,
    previewHeight,
    originalWidth,
    originalHeight,
  } = preview;

  const centerStartX = Math.floor(previewWidth * 0.15);
  const centerEndX = Math.max(centerStartX + 1, Math.ceil(previewWidth * 0.85));
  const centerStartY = Math.floor(previewHeight * 0.15);
  const centerEndY = Math.max(centerStartY + 1, Math.ceil(previewHeight * 0.85));
  const darkThreshold = Number(options.darkThreshold) || 150;
  const minLineScore = Number(options.minLineScore) || 0.45;

  const rowScores = new Array(previewHeight).fill(0);
  for (let y = 0; y < previewHeight; y += 1) {
    rowScores[y] = scoreHorizontalRow(gray, previewWidth, y, centerStartX, centerEndX, darkThreshold);
  }
  const colScores = new Array(previewWidth).fill(0);
  for (let x = 0; x < previewWidth; x += 1) {
    colScores[x] = scoreVerticalColumn(gray, previewWidth, previewHeight, x, centerStartY, centerEndY, darkThreshold);
  }

  const smoothRows = movingAverage(rowScores, 1);
  const smoothCols = movingAverage(colScores, 1);

  const topSearch = findBestIndex(
    smoothRows,
    Math.floor(previewHeight * 0.02),
    Math.floor(previewHeight * 0.45),
    minLineScore,
  );
  const bottomSearch = findBestIndex(
    smoothRows,
    Math.floor(previewHeight * 0.55),
    Math.floor(previewHeight * 0.98),
    minLineScore,
  );
  const leftSearch = findBestIndex(
    smoothCols,
    Math.floor(previewWidth * 0.02),
    Math.floor(previewWidth * 0.45),
    minLineScore,
  );
  const rightSearch = findBestIndex(
    smoothCols,
    Math.floor(previewWidth * 0.55),
    Math.floor(previewWidth * 0.98),
    minLineScore,
  );

  if (
    topSearch.index < 0 ||
    bottomSearch.index < 0 ||
    leftSearch.index < 0 ||
    rightSearch.index < 0
  ) {
    return {
      ok: true,
      detected: false,
      reason: "No strong box edges found.",
      debug: { topSearch, bottomSearch, leftSearch, rightSearch },
    };
  }

  if (topSearch.index >= bottomSearch.index || leftSearch.index >= rightSearch.index) {
    return { ok: true, detected: false, reason: "Invalid box candidate geometry." };
  }

  const scaleX = originalWidth / previewWidth;
  const scaleY = originalHeight / previewHeight;
  const candidate = normalizeRect({
    left: Math.round(leftSearch.index * scaleX),
    top: Math.round(topSearch.index * scaleY),
    width: Math.round((rightSearch.index - leftSearch.index) * scaleX),
    height: Math.round((bottomSearch.index - topSearch.index) * scaleY),
  }, { width: originalWidth, height: originalHeight });

  if (!candidate) {
    return { ok: true, detected: false, reason: "Unable to normalize box candidate." };
  }

  const areaRatio = (candidate.width * candidate.height) / Math.max(1, originalWidth * originalHeight);
  const margins = {
    left: candidate.left / Math.max(1, originalWidth),
    top: candidate.top / Math.max(1, originalHeight),
    right: (originalWidth - (candidate.left + candidate.width)) / Math.max(1, originalWidth),
    bottom: (originalHeight - (candidate.top + candidate.height)) / Math.max(1, originalHeight),
  };
  if (areaRatio < 0.15 || areaRatio > 0.98) {
    return { ok: true, detected: false, reason: `Candidate area ratio out of range: ${areaRatio}` };
  }
  if (margins.left < 0.01 || margins.right < 0.01 || margins.top < 0.01 || margins.bottom < 0.01) {
    return { ok: true, detected: false, reason: "Candidate too close to page border." };
  }

  return {
    ok: true,
    detected: true,
    imageSize: { width: originalWidth, height: originalHeight },
    boxRect: candidate,
    debug: {
      areaRatio,
      margins,
      scores: {
        top: topSearch.score,
        bottom: bottomSearch.score,
        left: leftSearch.score,
        right: rightSearch.score,
      },
    },
  };
}

export function buildLayoutRegions(imageSize, boxRect, options = {}) {
  if (!imageSize || !boxRect) return null;
  const boxPaddingPct = Number(options.boxPaddingPct) || 0.01;
  const notePaddingPct = Number(options.notePaddingPct) || 0.01;
  const notePadX = Math.round(imageSize.width * notePaddingPct);
  const notePadY = Math.round(imageSize.height * notePaddingPct);
  const insetX = Math.round(imageSize.width * boxPaddingPct);
  const insetY = Math.round(imageSize.height * boxPaddingPct);
  const minRegionArea = Math.max(400, Math.round(imageSize.width * imageSize.height * 0.0025));

  const inside = normalizeRect({
    left: boxRect.left + insetX,
    top: boxRect.top + insetY,
    width: boxRect.width - (2 * insetX),
    height: boxRect.height - (2 * insetY),
  }, imageSize);

  const top = normalizeRect({
    left: notePadX,
    top: notePadY,
    width: imageSize.width - (2 * notePadX),
    height: boxRect.top - (2 * notePadY),
  }, imageSize);

  const right = normalizeRect({
    left: boxRect.left + boxRect.width + notePadX,
    top: notePadY,
    width: imageSize.width - (boxRect.left + boxRect.width) - (2 * notePadX),
    height: imageSize.height - (2 * notePadY),
  }, imageSize);

  const bottom = normalizeRect({
    left: notePadX,
    top: boxRect.top + boxRect.height + notePadY,
    width: imageSize.width - (2 * notePadX),
    height: imageSize.height - (boxRect.top + boxRect.height) - (2 * notePadY),
  }, imageSize);

  const left = normalizeRect({
    left: notePadX,
    top: notePadY,
    width: boxRect.left - (2 * notePadX),
    height: imageSize.height - (2 * notePadY),
  }, imageSize);

  const outside = { top, right, bottom, left };
  for (const key of Object.keys(outside)) {
    const rect = outside[key];
    if (!rect || (rect.width * rect.height) < minRegionArea) delete outside[key];
  }

  return {
    inside,
    outside,
    minRegionArea,
  };
}

export async function cropRectToFile(imagePath, outputPath, rect, options = {}) {
  ensureDir(path.dirname(outputPath));
  const cmd = options.magickPath || "magick";
  const args = [
    imagePath,
    "-crop",
    `${rect.width}x${rect.height}+${rect.left}+${rect.top}`,
    "+repage",
    outputPath,
  ];
  const res = await spawnBuffer(cmd, args, { timeoutMs: options.timeoutMs || 15000 });
  if (res.code !== 0 || !fs.existsSync(outputPath)) {
    return { ok: false, error: res.err || `magick crop exited with code ${res.code}` };
  }
  return { ok: true, path: outputPath };
}

export async function cropLayoutRegions(imagePath, regions, options = {}) {
  const tempDir = options.tempDir;
  if (!tempDir) return { ok: false, error: "tempDir is required for cropLayoutRegions." };
  ensureDir(tempDir);
  const result = { ok: true, inside: null, outside: {} };

  if (!regions || !regions.inside) {
    return { ok: false, error: "Inside region is required." };
  }

  const insidePath = path.join(tempDir, "inside.png");
  const insideCrop = await cropRectToFile(imagePath, insidePath, regions.inside, options);
  if (!insideCrop.ok) return insideCrop;
  result.inside = insideCrop.path;

  for (const zone of ["top", "right", "bottom", "left"]) {
    if (!regions.outside || !regions.outside[zone]) continue;
    const outPath = path.join(tempDir, `outside_${zone}.png`);
    const crop = await cropRectToFile(imagePath, outPath, regions.outside[zone], options);
    if (crop.ok) result.outside[zone] = crop.path;
  }

  return result;
}

function normalizeTextBlock(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function mergeOcrText(mainText, outsideByZone = {}, options = {}) {
  const main = normalizeTextBlock(mainText);
  const sections = [];
  const order = ["top", "right", "bottom", "left"];
  const outsideFormat = options.outsideFormat === "zoned" ? "zoned" : "flat";

  for (const zone of order) {
    const text = normalizeTextBlock(outsideByZone[zone]);
    if (!text) continue;
    sections.push({ zone, text });
  }

  if (sections.length === 0) return main;

  const footer = outsideFormat === "zoned"
    ? sections.map(({ zone, text }) => `[OUTSIDE:${zone}]\n${text}`).join("\n\n")
    : sections.map(({ text }) => text).join("\n\n");

  const outsideBlock = `--- OUTSIDE BOX ---\n${footer}\n--- END OUTSIDE BOX ---`;
  if (!main) return outsideBlock;
  return `${main}\n\n${outsideBlock}`;
}

export async function detectAndCropBoxLayout(imagePath, options = {}) {
  const detected = await detectMainBox(imagePath, options);
  if (!detected.ok) return detected;
  if (!detected.detected) return { ok: true, detected: false, reason: detected.reason, debug: detected.debug };
  const regions = buildLayoutRegions(detected.imageSize, detected.boxRect, options);
  if (!regions || !regions.inside) {
    return { ok: true, detected: false, reason: "Failed to build OCR regions." };
  }
  const crops = await cropLayoutRegions(imagePath, regions, options);
  if (!crops.ok) return crops;
  return {
    ok: true,
    detected: true,
    imageSize: detected.imageSize,
    boxRect: detected.boxRect,
    regions,
    crops,
    debug: detected.debug,
  };
}

export function scoreRegionText(text) {
  const normalized = normalizeTextBlock(text);
  if (!normalized) return 0;
  return mean([
    normalized.length >= 8 ? 1 : 0,
    normalized.split(/\s+/).length >= 2 ? 1 : 0,
  ]);
}
