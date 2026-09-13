import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
  nativeImage,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import {
  initMySql,
  getDbStatus,
  dbPool,
  listKitabs,
  getTranslation,
  saveTranslation,
  searchGlobal,
  findKitabByFolder,
  createKitab,
  getDbConfig,
  setDbConfig,
  listKitabFolders,
  addKitabFolder,
  removeKitabFolder,
  getKitabDetailByFolder,
  updateKitab,
  getKitabDetailById,
  deleteKitab,
  listApiSettings,
  upsertApiSetting,
  deleteApiSetting,
  getApiSettingByName,
  getApiSettingById,
  filterProvidersByCapability,
  listAgentSystemPrompts,
  getAgentSystemPromptById,
  upsertAgentSystemPrompt,
  deleteAgentSystemPrompt,
  listAgentPromptBindings,
  setAgentPromptBinding,
  getAgentActiveSystemPrompt,
  listAiChatThreads,
  createAiChatThread,
  getAiChatThread,
  updateAiChatThreadTitle,
  listAiChatMessages,
  addAiChatMessage,
  countAiChatMessages,
  deleteAiChatThread,
  cloneAiChatThread,
  getTranslationAssistContext,
  listTranslationVersions,
  listTranslationFeedbackHistory,
  submitTranslationReview,
  listTranslationGlossary,
  upsertTranslationGlossaryEntry,
  deleteTranslationGlossaryEntry,
  seedTranslationGlossary,
  recordTranslationRuntimeMetric,
  getTranslationRuntimeMetricsSummary,
  upsertTranslationMemoryEntry,
  markTranslationMemoryUsed,
  importSourceUnitsFromFolder,
  getSourceUnitContext,
  evaluateTranslationConfidence,
  listTranslationMemorySemanticCandidates,
  listTranslationMemorySemanticReindexCandidates,
  listSourceUnitSemanticCandidates,
  getSemanticEmbeddingEntry,
  upsertSemanticEmbeddingEntry,
  listSemanticSourceUnitExamples,
  listSemanticTranslationMemoryExamples,
  listLearningDatasetCandidates,
  listTranslationStyleProfiles,
  getActiveTranslationStyleProfile,
  createTranslationStyleProfile,
  activateTranslationStyleProfile,
} from "./db.js";
import {
  detectAndCropBoxLayout,
  mergeOcrText,
  normalizeLayoutRuntimeOptions,
} from "./ocr-layout.js";
import { reindexRagCorpus, verifyRagIndexForKitab } from "./rag/indexer.js";
import { hybridSearch, RAG_SEARCH_DEFAULTS } from "./rag/retrieve.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chromiumCacheRoot = path.join(
  app.getPath("temp"),
  "reader_app_chromium_cache",
);
try {
  ensureDir(chromiumCacheRoot);
  ensureDir(path.join(chromiumCacheRoot, "gpu"));
  app.commandLine.appendSwitch("disk-cache-dir", chromiumCacheRoot);
  app.commandLine.appendSwitch(
    "gpu-shader-cache-dir",
    path.join(chromiumCacheRoot, "gpu"),
  );
  app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
} catch (_) {}

let mainWindow;
let keepWindow;
let keepDebuggerAttached = false;
let ocrState = { running: false, total: 0, completed: 0, lastFile: null };
let translateState = {
  running: false,
  provider: null,
  model: null,
  attempt: 0,
  startedAt: 0,
  textLength: 0,
  jobId: null,
  queueLength: 0,
  fileName: null,
  page: null,
  filePath: null,
  folderPath: null,
  windowId: null,
  webContentsId: null,
  stage: null,
  stageLabel: null,
  stageDetail: null,
};

let translateQueueCount = 0;
let translateJobSeq = 0;
let translateLock = Promise.resolve();

function acquireTranslateSlot() {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const prev = translateLock;
  translateLock = prev.then(
    () => gate,
    () => gate,
  );
  return prev.then(() => release);
}

function sendToAllWindows(channel, payload) {
  const wins = BrowserWindow.getAllWindows();
  for (const w of wins) {
    try {
      w.webContents.send(channel, payload);
    } catch (_) {}
  }
}

function pushTranslateStatus(patch = {}) {
  translateState = {
    ...translateState,
    ...patch,
  };
  sendToAllWindows("translate-status", { ...translateState });
}

// Settings persistence helpers
function getSettingsFile() {
  const userDir = app.getPath("userData");
  return path.join(userDir, "settings.json");
}

function readSettings() {
  try {
    const file = getSettingsFile();
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf-8");
      return JSON.parse(raw);
    }
  } catch (_) {}
  return {};
}

function writeSettings(partial) {
  const file = getSettingsFile();
  const current = readSettings();
  const next = { ...current, ...partial };
  try {
    fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to write settings:", e);
  }
  return next;
}

function normalizeSemanticTuningSettings(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  const clamp01 = (value, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(1, num));
  };
  const clampInt = (value, fallback, min, max) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(num)));
  };
  return {
    tmSimilarityThreshold: clamp01(cfg.tmSimilarityThreshold, 0.68),
    sourceUnitSimilarityThreshold: clamp01(cfg.sourceUnitSimilarityThreshold, 0.72),
    maxTmExamples: clampInt(cfg.maxTmExamples, 4, 1, 12),
    maxSourceUnitExamples: clampInt(cfg.maxSourceUnitExamples, 3, 1, 8),
  };
}

function getSemanticTuningSettings() {
  const s = readSettings();
  return normalizeSemanticTuningSettings(s && s.semanticTuning ? s.semanticTuning : {});
}

function normalizeRagSearchSettings(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  const clamp01 = (value, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(1, num));
  };
  const clampInt = (value, fallback, min, max) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(num)));
  };
  return {
    searchSimilarityThreshold: clamp01(
      cfg.searchSimilarityThreshold,
      RAG_SEARCH_DEFAULTS.searchSimilarityThreshold,
    ),
    chatSimilarityThreshold: clamp01(
      cfg.chatSimilarityThreshold,
      RAG_SEARCH_DEFAULTS.chatSimilarityThreshold,
    ),
    candidateLimit: clampInt(
      cfg.candidateLimit,
      RAG_SEARCH_DEFAULTS.candidateLimit,
      50,
      2000,
    ),
    topK: clampInt(cfg.topK, RAG_SEARCH_DEFAULTS.topK, 1, 100),
  };
}

function getRagSearchSettings() {
  const s = readSettings();
  return normalizeRagSearchSettings(s && s.ragSearch ? s.ragSearch : {});
}

function normalizeTranslationStyleMemorySettings(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  const clamp01 = (value, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(1, num));
  };
  const clampInt = (value, fallback, min, max) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(num)));
  };
  return {
    useGlobalStyleInTranslate:
      typeof cfg.useGlobalStyleInTranslate === "boolean"
        ? cfg.useGlobalStyleInTranslate
        : true,
    approvedOnly:
      typeof cfg.approvedOnly === "boolean" ? cfg.approvedOnly : true,
    requireExplicitApproval:
      typeof cfg.requireExplicitApproval === "boolean"
        ? cfg.requireExplicitApproval
        : true,
    includeHighQualityFallback:
      typeof cfg.includeHighQualityFallback === "boolean"
        ? cfg.includeHighQualityFallback
        : false,
    useQualityWeighting:
      typeof cfg.useQualityWeighting === "boolean"
        ? cfg.useQualityWeighting
        : true,
    includeRepresentativeSamples:
      typeof cfg.includeRepresentativeSamples === "boolean"
        ? cfg.includeRepresentativeSamples
        : false,
    representativeSampleCount: clampInt(
      cfg.representativeSampleCount,
      2,
      1,
      3,
    ),
    lockedRulesText:
      typeof cfg.lockedRulesText === "string"
        ? cfg.lockedRulesText
        : [
            "Gelar ulama dipertahankan sebagai gelar, bukan diterjemahkan literal.",
            "Doa setelah nama diterjemahkan ke makna Indonesia secara wajar.",
            "Hindari istilah akademik modern yang tidak tersurat jelas dalam sumber.",
            "Pertahankan gaya dasar terjemahan kitab pesantren.",
          ].join("\n"),
    enableClusterFallback:
      typeof cfg.enableClusterFallback === "boolean"
        ? cfg.enableClusterFallback
        : false,
    clusterStrategy:
      cfg.clusterStrategy === "manual" ? "manual" : "auto",
    defaultClusterKey:
      typeof cfg.defaultClusterKey === "string"
        ? String(cfg.defaultClusterKey).trim().toLowerCase()
        : "",
    minConfidence: clamp01(cfg.minConfidence, 0.85),
    limit: clampInt(cfg.limit, 500, 20, 5000),
    minSamples: clampInt(cfg.minSamples, 8, 1, 1000),
  };
}

function getTranslationStyleMemorySettings() {
  const s = readSettings();
  return normalizeTranslationStyleMemorySettings(
    s && s.translationStyleMemory ? s.translationStyleMemory : {},
  );
}

function normalizeOcrLayoutSettings(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  const clampPct = (value, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(0.2, num));
  };
  const layoutMode = cfg.ocrLayoutMode === "box_notes" ? "box_notes" : "full";
  const outsideFormat = cfg.ocrOutsideFormat === "zoned" ? "zoned" : "flat";
  return {
    ocrLayoutMode: layoutMode,
    ocrBoxPaddingPct: clampPct(cfg.ocrBoxPaddingPct, 0.01),
    ocrNotePaddingPct: clampPct(cfg.ocrNotePaddingPct, 0.01),
    ocrOutsideFormat: outsideFormat,
  };
}

function normalizeCloudDbConfig(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  const host = String(cfg.host || "").trim();
  const user = String(cfg.user || "").trim();
  const password = typeof cfg.password === "string" ? cfg.password : "";
  const database = String(cfg.database || "").trim();
  const port = (() => {
    const n = Number(cfg.port);
    if (Number.isFinite(n) && n > 0 && n < 65536) return Math.floor(n);
    const t = String(cfg.port || "").trim();
    if (!t) return 3306;
    const m = Number(t);
    if (Number.isFinite(m) && m > 0 && m < 65536) return Math.floor(m);
    return 3306;
  })();
  return { host, user, password, database, port };
}

function getCloudDbConfigFromSettings() {
  const s = readSettings();
  return normalizeCloudDbConfig(s && s.cloudDb ? s.cloudDb : {});
}

function getAllowedCloudTables() {
  return [
    "master_kitab",
    "kitab_folders",
    "kitab_terjemahan",
    "translation_versions",
    "translation_feedback",
    "semantic_embeddings",
    "source_units",
    "translation_memory",
    "translation_glossary",
    "api_settings",
    "agent_system_prompts",
    "agent_prompt_bindings",
    "ai_chat_threads",
    "ai_chat_messages",
  ];
}

function orderTablesForTruncate(tables) {
  const order = [
    "ai_chat_messages",
    "ai_chat_threads",
    "agent_prompt_bindings",
    "agent_system_prompts",
    "api_settings",
    "translation_feedback",
    "translation_versions",
    "semantic_embeddings",
    "source_units",
    "translation_glossary",
    "translation_memory",
    "kitab_terjemahan",
    "kitab_folders",
    "master_kitab",
  ];
  const set = new Set(tables || []);
  return order.filter((t) => set.has(t));
}

function orderTablesForInsert(tables) {
  const order = [
    "master_kitab",
    "kitab_folders",
    "kitab_terjemahan",
    "translation_versions",
    "translation_feedback",
    "semantic_embeddings",
    "source_units",
    "translation_memory",
    "translation_glossary",
    "api_settings",
    "agent_system_prompts",
    "agent_prompt_bindings",
    "ai_chat_threads",
    "ai_chat_messages",
  ];
  const set = new Set(tables || []);
  return order.filter((t) => set.has(t));
}

async function createCloudPool(cfg) {
  const c = normalizeCloudDbConfig(cfg);
  if (!c.host || !c.user || !c.database) {
    throw new Error("Cloud DB config belum lengkap (host/user/database).");
  }
  return mysql.createPool({
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: c.database,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  });
}

async function cloudEnsureTables({ cloudPool, tables }) {
  const tbls = Array.isArray(tables) ? tables : [];
  for (const t of tbls) {
    const [existsRows] = await cloudPool.query("SHOW TABLES LIKE ?", [t]);
    const exists = Array.isArray(existsRows) && existsRows.length > 0;
    if (exists) continue;
    const [crRows] = await dbPool.query(`SHOW CREATE TABLE \`${t}\``);
    const createSql = crRows && crRows[0] ? String(crRows[0]["Create Table"] || "") : "";
    if (!createSql) throw new Error(`Gagal mengambil schema untuk table: ${t}`);
    const patched = createSql.replace(/^CREATE TABLE\s+`/i, "CREATE TABLE IF NOT EXISTS `");
    await cloudPool.query(patched);
  }
}

async function getTableColumns(pool, table) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM \`${table}\``);
  const cols = (rows || []).map((r) => String(r.Field || "")).filter(Boolean);
  return cols;
}

async function getTablePrimaryKeys(pool, table) {
  const [rows] = await pool.query(`SHOW KEYS FROM \`${table}\` WHERE Key_name = 'PRIMARY'`);
  const cols = (rows || []).map((r) => String(r.Column_name || "")).filter(Boolean);
  return cols;
}

async function copyTableReplace({ cloudPool, table, batchSize = 500 }) {
  const [cntRows] = await dbPool.query(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
  const total = cntRows && cntRows[0] ? Number(cntRows[0].cnt) || 0 : 0;
  if (total === 0) return { table, total: 0, copied: 0 };

  const cols = await getTableColumns(dbPool, table);
  if (cols.length === 0) return { table, total, copied: 0 };

  let copied = 0;
  for (let offset = 0; offset < total; offset += batchSize) {
    const [rows] = await dbPool.query(`SELECT * FROM \`${table}\` LIMIT ? OFFSET ?`, [
      batchSize,
      offset,
    ]);
    const arr = Array.isArray(rows) ? rows : [];
    if (arr.length === 0) continue;
    const values = arr.map((r) => cols.map((c) => r[c]));
    const colSql = cols.map((c) => `\`${c}\``).join(", ");
    await cloudPool.query(`INSERT INTO \`${table}\` (${colSql}) VALUES ?`, [values]);
    copied += arr.length;
  }
  return { table, total, copied };
}

async function copyTableUpsert({ cloudPool, table, batchSize = 500 }) {
  const [cntRows] = await dbPool.query(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
  const total = cntRows && cntRows[0] ? Number(cntRows[0].cnt) || 0 : 0;
  if (total === 0) return { table, total: 0, copied: 0 };

  const cols = await getTableColumns(dbPool, table);
  if (cols.length === 0) return { table, total, copied: 0 };

  const pk = await getTablePrimaryKeys(dbPool, table);
  const pkSet = new Set(pk);
  const upCols = cols.filter((c) => !pkSet.has(c));
  const updates =
    upCols.length > 0
      ? upCols.map((c) => `\`${c}\`=VALUES(\`${c}\`)`).join(", ")
      : cols.map((c) => `\`${c}\`=VALUES(\`${c}\`)`).join(", ");

  let copied = 0;
  for (let offset = 0; offset < total; offset += batchSize) {
    const [rows] = await dbPool.query(`SELECT * FROM \`${table}\` LIMIT ? OFFSET ?`, [
      batchSize,
      offset,
    ]);
    const arr = Array.isArray(rows) ? rows : [];
    if (arr.length === 0) continue;
    const values = arr.map((r) => cols.map((c) => r[c]));
    const colSql = cols.map((c) => `\`${c}\``).join(", ");
    await cloudPool.query(
      `INSERT INTO \`${table}\` (${colSql}) VALUES ? ON DUPLICATE KEY UPDATE ${updates}`,
      [values],
    );
    copied += arr.length;
  }
  return { table, total, copied };
}

function createWindow(opts = {}) {
  const { setMain = false } = opts || {};
  const win = new BrowserWindow({
    width: 900,
    height: 650,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });
  if (setMain || !mainWindow) mainWindow = win;

  const startUrl = process.env.ELECTRON_START_URL;
  if (startUrl && !/^file:/i.test(startUrl)) {
    win.loadURL(startUrl);
  } else {
    const filePath = path.join(__dirname, "../dist", "index.html");
    win.loadFile(filePath);
  }
  return win;
}

function ensureKeepWindow(show = true) {
  if (keepWindow && !keepWindow.isDestroyed()) {
    if (show) keepWindow.show();
    return keepWindow;
  }

  keepWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    show,
    webPreferences: {
      contextIsolation: true,
      partition: "persist:keep",
    },
  });

  keepWindow.on("closed", () => {
    keepWindow = null;
    keepDebuggerAttached = false;
  });

  keepWindow.loadURL("https://keep.google.com/");
  return keepWindow;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferMimeType(filePath) {
  const ext = String(path.extname(filePath) || "").toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  return "application/octet-stream";
}

async function keepExec(js) {
  const win = ensureKeepWindow(false);
  return await win.webContents.executeJavaScript(js, true);
}

async function keepWaitFor(testJs, timeoutMs = 30000, intervalMs = 500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const ok = await keepExec(testJs);
      if (ok) return true;
    } catch (_) {}
    await sleep(intervalMs);
  }
  return false;
}

async function keepSetFileInputFiles(selector, files) {
  const win = ensureKeepWindow(false);
  const wc = win.webContents;
  try {
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach("1.3");
      keepDebuggerAttached = true;
    }
  } catch (_) {
    keepDebuggerAttached = wc.debugger.isAttached();
  }
  if (!wc.debugger.isAttached()) throw new Error("Debugger attach failed");

  try {
    await wc.debugger.sendCommand("DOM.enable");
  } catch (_) {}
  try {
    await wc.debugger.sendCommand("Page.enable");
  } catch (_) {}
  try {
    await wc.debugger.sendCommand("Runtime.enable");
  } catch (_) {}

  const evalRes = await wc.debugger.sendCommand("Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(selector)})`,
    returnByValue: false,
  });
  const objectId = evalRes?.result?.objectId;
  if (!objectId) throw new Error("File input not found");

  const nodeRes = await wc.debugger.sendCommand("DOM.requestNode", { objectId });
  const nodeId = nodeRes?.nodeId || 0;
  if (!nodeId) throw new Error("File input not found");

  await wc.debugger.sendCommand("DOM.setFileInputFiles", {
    nodeId,
    files,
  });
}

async function keepGetFileInputCount() {
  try {
    const n = await keepExec(
      `(() => document.querySelectorAll('input[type="file"]').length)()`,
    );
    return Number.isFinite(Number(n)) ? Number(n) : 0;
  } catch (_) {
    return 0;
  }
}

async function keepGetDebugInfo() {
  try {
    const info = await keepExec(`(() => {
      const url = String(location.href || '');
      const title = String(document.title || '');
      const readyState = String(document.readyState || '');
      const inputs = document.querySelectorAll('input[type="file"]').length;
      const sample = Array.from(document.querySelectorAll('button[aria-label], div[role="button"][aria-label]'))
        .map(e => String(e.getAttribute('aria-label') || '').trim())
        .filter(Boolean)
        .filter(a => /image|gambar|foto|upload|lampir|attachment|note/i.test(a))
        .slice(0, 25);
      return { url, title, readyState, inputs, sample };
    })()`);
    return info && typeof info === "object" ? info : null;
  } catch (_) {
    return null;
  }
}

async function keepClickByAriaLabelIncludes(words) {
  const arr = Array.isArray(words) ? words : [String(words || "")];
  const js = `(() => {
    const needles = ${JSON.stringify(arr)}.map(s => String(s || '').toLowerCase()).filter(Boolean);
    const els = Array.from(document.querySelectorAll('button[aria-label], div[role="button"][aria-label]'));
    const matches = els.filter(e => {
      const a = String(e.getAttribute('aria-label') || '').toLowerCase();
      return needles.some(n => a.includes(n));
    });
    const el = matches.length ? matches[matches.length - 1] : null;
    if (!el) return false;
    el.click();
    return true;
  })()`;
  return await keepExec(js);
}

async function keepClickMenuItemTextIncludes(words) {
  const arr = Array.isArray(words) ? words : [String(words || "")];
  const js = `(() => {
    const needles = ${JSON.stringify(arr)}.map(s => String(s || '').toLowerCase()).filter(Boolean);
    const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] [role="button"], [role="menu"] div'));
    const el = items.find(e => {
      const t = String(e.innerText || '').trim().toLowerCase();
      return t && needles.some(n => t.includes(n));
    });
    if (!el) return false;
    el.click();
    return true;
  })()`;
  return await keepExec(js);
}

async function keepReadBestTextboxText() {
  const js = `(() => {
    const boxes = Array.from(document.querySelectorAll('[role="textbox"]'));
    const texts = boxes
      .filter(b => {
        const aria = String(b.getAttribute('aria-label') || '').toLowerCase();
        if (aria.includes('search') || aria.includes('telusur')) return false;
        return true;
      })
      .map(b => String(b.innerText || '').trim())
      .filter(Boolean);
    texts.sort((a, b) => b.length - a.length);
    return texts[0] || '';
  })()`;
  return await keepExec(js);
}

async function keepCreateNoteWithText(text) {
  const win = ensureKeepWindow(true);
  const currentUrl = String(win.webContents.getURL() || "");
  if (!/keep\.google\.com/i.test(currentUrl) && !/accounts\.google\.com/i.test(currentUrl)) {
    try {
      await win.loadURL("https://keep.google.com/");
    } catch (_) {}
  }
  const url = String(win.webContents.getURL() || "");
  if (/accounts\.google\.com/i.test(url)) {
    return { ok: false, error: "Silakan login Google di jendela Keep dulu." };
  }

  await keepWaitFor(
    `(() => document.readyState === 'complete' || document.readyState === 'interactive')()`,
    45000,
    250,
  );

  const ok = await keepExec(`(() => {
    const content = ${JSON.stringify(String(text || ""))};
    const candidates = Array.from(document.querySelectorAll('[role="textbox"]')).filter(b => {
      const aria = String(b.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('search') || aria.includes('telusur')) return false;
      return true;
    });
    const box = candidates.find(b => {
      const aria = String(b.getAttribute('aria-label') || '').toLowerCase();
      return aria.includes('take a note') || aria.includes('buat catatan') || aria.includes('catatan');
    }) || candidates[0];
    if (!box) return false;
    box.focus();
    try {
      document.execCommand('insertText', false, content);
    } catch (_) {
      box.textContent = content;
    }
    box.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return true;
  })()`);

  if (!ok) return { ok: false, error: "Gagal mengisi note di Keep." };
  return { ok: true };
}

async function runKeepOcr({ imagePath, waitMs }) {
  if (!imagePath || !fs.existsSync(imagePath)) {
    return { ok: false, error: "Image file not found." };
  }

  const win = ensureKeepWindow(true);
  if (!win || win.isDestroyed()) return { ok: false, error: "Keep window not available." };

  try {
    await win.loadURL("https://keep.google.com/");
  } catch (_) {}

  const url = String(win.webContents.getURL() || "");
  if (/accounts\.google\.com/i.test(url)) {
    return { ok: false, error: "Silakan login Google di jendela Keep dulu." };
  }

  await keepWaitFor(
    `(() => document.readyState === 'complete' || document.readyState === 'interactive')()`,
    45000,
    250,
  );

  let fileInputs = await keepGetFileInputCount();
  if (fileInputs === 0) {
    await keepClickByAriaLabelIncludes([
      "new note with image",
      "catatan baru dengan gambar",
      "buat catatan baru dengan gambar",
      "note with image",
      "gambar",
      "image",
      "photo",
      "foto",
    ]);
    await keepWaitFor(
      `(() => document.querySelectorAll('input[type="file"]').length > 0)()`,
      20000,
      500,
    );
    fileInputs = await keepGetFileInputCount();
  }

  if (fileInputs === 0) {
    await keepClickByAriaLabelIncludes([
      "add image",
      "tambahkan gambar",
      "sisipkan gambar",
      "lampirkan gambar",
      "insert image",
    ]);
    await keepWaitFor(
      `(() => document.querySelectorAll('input[type="file"]').length > 0)()`,
      15000,
      500,
    );
    fileInputs = await keepGetFileInputCount();
  }

  if (fileInputs === 0) {
    await keepExec(`(() => {
      const needles = ['take a note', 'buat catatan', 'ambil catatan', 'catatan', 'note'];
      const els = Array.from(document.querySelectorAll('[role="textbox"], div[aria-label], textarea'));
      const el = els.find(e => {
        const a = String(e.getAttribute('aria-label') || '').toLowerCase();
        const t = String(e.innerText || '').toLowerCase();
        return needles.some(n => a.includes(n) || t.includes(n));
      });
      if (!el) return false;
      el.click();
      return true;
    })()`);
    await sleep(400);
    await keepClickByAriaLabelIncludes([
      "add image",
      "tambahkan gambar",
      "sisipkan gambar",
      "lampirkan gambar",
      "insert image",
    ]);
    await keepWaitFor(
      `(() => document.querySelectorAll('input[type="file"]').length > 0)()`,
      15000,
      500,
    );
    fileInputs = await keepGetFileInputCount();
  }

  if (fileInputs === 0) {
    const dbg = await keepGetDebugInfo();
    const extra = dbg
      ? ` (inputs=${dbg.inputs}, title=${JSON.stringify(dbg.title)}, url=${JSON.stringify(dbg.url)}, sampleButtons=${JSON.stringify(dbg.sample)})`
      : "";
    return {
      ok: false,
      error:
        "File input not found. Tombol upload gambar Keep tidak terdeteksi." +
        extra,
    };
  }

  await keepSetFileInputFiles('input[type="file"]', [imagePath]);

  await keepWaitFor(`(() => document.querySelectorAll('img').length > 0)()`, 45000, 500);

  await keepClickByAriaLabelIncludes(["more", "lainnya"]);
  await sleep(300);
  const clicked = await keepClickMenuItemTextIncludes(["grab image text", "ambil teks gambar", "ambil teks dari gambar"]);
  if (!clicked) {
    return { ok: false, error: "Menu OCR Keep tidak ditemukan (Grab image text / Ambil teks gambar)." };
  }

  await sleep(Math.max(0, Number(waitMs) || 40000));

  const text = await keepReadBestTextboxText();
  if (!text) {
    return { ok: false, error: "OCR Keep belum menghasilkan teks. Coba tunggu lebih lama atau jalankan ulang." };
  }
  return { ok: true, text };
}

function getDriveOAuth() {
  const s = readSettings();
  const d = s && typeof s.driveOAuth === "object" ? s.driveOAuth : {};
  const clientId = typeof d.clientId === "string" ? d.clientId : "";
  const clientSecret = typeof d.clientSecret === "string" ? d.clientSecret : "";
  const accessToken = typeof d.accessToken === "string" ? d.accessToken : "";
  const refreshToken = typeof d.refreshToken === "string" ? d.refreshToken : "";
  const expiry = Number.isFinite(Number(d.expiry)) ? Number(d.expiry) : 0;
  return { clientId, clientSecret, accessToken, refreshToken, expiry };
}

function saveDriveOAuth(partial) {
  const current = readSettings();
  const prev = current && typeof current.driveOAuth === "object" ? current.driveOAuth : {};
  const nextDrive = { ...prev, ...partial };
  writeSettings({ ...current, driveOAuth: nextDrive });
  return nextDrive;
}

async function driveRefreshAccessToken() {
  const d = getDriveOAuth();
  if (!d.clientId || !d.clientSecret)
    throw new Error("Drive clientId/clientSecret belum diset.");
  if (!d.refreshToken) throw new Error("Drive belum login (refresh token kosong).");

  const body = new URLSearchParams();
  body.set("client_id", d.clientId);
  body.set("client_secret", d.clientSecret);
  body.set("refresh_token", d.refreshToken);
  body.set("grant_type", "refresh_token");

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await resp.json();
  if (!resp.ok) {
    const msg = (data && data.error_description) || (data && data.error) || resp.statusText;
    throw new Error(String(msg));
  }
  const accessToken = String(data.access_token || "");
  const expiresIn = Number(data.expires_in || 0);
  if (!accessToken) throw new Error("Token refresh gagal.");
  const expiry = Date.now() + Math.max(0, expiresIn) * 1000;
  saveDriveOAuth({ accessToken, expiry });
  return accessToken;
}

async function driveEnsureAccessToken() {
  const d = getDriveOAuth();
  if (d.accessToken && d.expiry && Date.now() < d.expiry - 60_000) return d.accessToken;
  return await driveRefreshAccessToken();
}

async function driveAuthFlow() {
  const d = getDriveOAuth();
  if (!d.clientId || !d.clientSecret)
    return { ok: false, error: "Drive clientId/clientSecret belum diset." };

  const state = crypto.randomUUID();
  const scope = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/drive.file",
  ].join(" ");

  let authWindow = null;
  let server;
  try {
    const code = await new Promise((resolve, reject) => {
      let done = false;
      server = http.createServer((req, res) => {
        try {
          const u = new URL(req.url || "/", "http://127.0.0.1");
          const qsState = u.searchParams.get("state") || "";
          const qsCode = u.searchParams.get("code") || "";
          const qsErr = u.searchParams.get("error") || "";
          if (qsErr) {
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Login dibatalkan. Silakan kembali ke aplikasi.");
            done = true;
            reject(new Error(qsErr));
            return;
          }
          if (qsCode && qsState === state) {
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Login berhasil. Silakan kembali ke aplikasi.");
            done = true;
            resolve(qsCode);
            return;
          }
          res.writeHead(404);
          res.end("Not found");
        } catch (e) {
          done = true;
          reject(e);
        }
      });
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = addr && typeof addr === "object" ? addr.port : 0;
        if (!port) {
          done = true;
          reject(new Error("Gagal membuka callback server."));
          return;
        }

        const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authUrl.searchParams.set("client_id", d.clientId);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("scope", scope);
        authUrl.searchParams.set("access_type", "offline");
        authUrl.searchParams.set("prompt", "consent");
        authUrl.searchParams.set("state", state);

        authWindow = new BrowserWindow({
          width: 520,
          height: 720,
          show: true,
          webPreferences: { contextIsolation: true, partition: "persist:drive" },
        });
        authWindow.on("closed", () => {
          if (!done) reject(new Error("Login window ditutup."));
        });
        authWindow.loadURL(authUrl.toString());
      });
    });

    const addr = server.address();
    const port = addr && typeof addr === "object" ? addr.port : 0;
    if (!port) return { ok: false, error: "Callback server tidak aktif." };
    const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
    const body = new URLSearchParams();
    body.set("code", code);
    body.set("client_id", d.clientId);
    body.set("client_secret", d.clientSecret);
    body.set("redirect_uri", redirectUri);
    body.set("grant_type", "authorization_code");

    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error_description) || (data && data.error) || resp.statusText;
      return { ok: false, error: String(msg) };
    }

    const accessToken = String(data.access_token || "");
    const refreshToken = String(data.refresh_token || "");
    const expiresIn = Number(data.expires_in || 0);
    if (!accessToken) return { ok: false, error: "Access token kosong." };

    const expiry = Date.now() + Math.max(0, expiresIn) * 1000;
    const update = { accessToken, expiry };
    if (refreshToken) update.refreshToken = refreshToken;
    saveDriveOAuth(update);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try {
      if (authWindow && !authWindow.isDestroyed()) authWindow.close();
    } catch (_) {}
    try {
      server && server.close();
    } catch (_) {}
  }
}

async function driveUploadAndShare(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error("File tidak ditemukan.");
  if (typeof FormData === "undefined" || typeof Blob === "undefined") {
    throw new Error("FormData/Blob tidak tersedia di runtime.");
  }
  const token = await driveEnsureAccessToken();
  const mime = inferMimeType(filePath);
  const buf = fs.readFileSync(filePath);
  const name = path.basename(filePath);

  const metadata = { name, mimeType: mime };
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  form.append("file", new Blob([buf], { type: mime }), name);

  const uploadResp = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  const uploadData = await uploadResp.json();
  if (!uploadResp.ok) {
    const msg =
      (uploadData && uploadData.error && uploadData.error.message) ||
      uploadResp.statusText;
    throw new Error(String(msg));
  }
  const fileId = String(uploadData.id || "");
  if (!fileId) throw new Error("Upload berhasil tapi fileId kosong.");

  const permResp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    },
  );
  if (!permResp.ok) {
    const p = await permResp.json().catch(() => null);
    const msg = (p && p.error && p.error.message) || permResp.statusText;
    throw new Error(String(msg));
  }

  const link = `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view?usp=sharing`;
  return { fileId, link };
}

app.whenReady().then(() => {
  createWindow({ setMain: true });

  // Initialize MySQL connection and ensure schema
  initMySql();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0)
      createWindow({ setMain: true });
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("open-new-window", async () => {
  try {
    createWindow({ setMain: false });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("select-folder", async (_event, defaultPath) => {
  const options = {
    properties: ["openDirectory"],
  };
  if (typeof defaultPath === "string" && defaultPath.length > 0) {
    options.defaultPath = defaultPath;
  }
  const result = await dialog.showOpenDialog(mainWindow, options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("select-pdf", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("select-image", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("keep-open", async () => {
  try {
    ensureKeepWindow(true);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("keep-ocr", async (_event, payload) => {
  try {
    const imagePath = payload && typeof payload.imagePath === "string" ? payload.imagePath : "";
    const waitMs = payload && Number.isFinite(Number(payload.waitMs)) ? Number(payload.waitMs) : 40000;
    return await runKeepOcr({ imagePath, waitMs });
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("keep-create-note", async (_event, payload) => {
  try {
    const text = payload && typeof payload.text === "string" ? payload.text : "";
    if (!text.trim()) return { ok: false, error: "Text kosong." };
    return await keepCreateNoteWithText(text);
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("drive-auth-status", async () => {
  const d = getDriveOAuth();
  const hasClient = !!(d.clientId && d.clientSecret);
  const authorized = !!d.refreshToken;
  return { ok: true, hasClient, authorized };
});

ipcMain.handle("drive-auth", async () => {
  return await driveAuthFlow();
});

ipcMain.handle("drive-upload", async (_event, payload) => {
  try {
    const filePath = payload && typeof payload.filePath === "string" ? payload.filePath : "";
    const { fileId, link } = await driveUploadAndShare(filePath);
    return { ok: true, fileId, link };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("select-tesseract", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Executable", extensions: ["exe"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("select-magick", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "ImageMagick", extensions: ["exe"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("select-pdftoppm", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Poppler pdftoppm", extensions: ["exe"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("open-explorer", async (_event, dirPath) => {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return { ok: false, error: "Folder tidak ditemukan." };
  }
  try {
    const res = await shell.openPath(dirPath);
    if (!res) return { ok: true };
    // Fallback to explorer.exe if shell.openPath returns an error string
    await new Promise((resolve, reject) => {
      const proc = spawn("explorer.exe", [dirPath]);
      proc.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("explorer.exe exit " + code)),
      );
      proc.on("error", reject);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("ensure-folder", async (_event, dirPath) => {
  try {
    const normalized = sanitizeFsPath(dirPath);
    if (!normalized) return { ok: false, error: "Folder path diperlukan." };
    ensureDir(normalized);
    return { ok: true, path: normalized };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

// Global search (Phase 2: hybrid keyword + vector RAG)
ipcMain.handle("search-global", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();

    const isObjectPayload = payload && typeof payload === "object" && !Array.isArray(payload);
    const keyword = isObjectPayload
      ? String(payload.keyword || payload.query || "").trim()
      : String(payload || "").trim();
    const modeRaw = isObjectPayload ? String(payload.mode || "hybrid").toLowerCase() : "hybrid";
    const mode = ["keyword", "semantic", "hybrid"].includes(modeRaw) ? modeRaw : "hybrid";
    const idKitab = isObjectPayload
      ? payload.idKitab != null
        ? Number(payload.idKitab)
        : payload.id_kitab != null
          ? Number(payload.id_kitab)
          : null
      : null;
    const ragCfg = getRagSearchSettings();
    const threshold =
      isObjectPayload && payload.threshold != null
        ? Number(payload.threshold)
        : ragCfg.searchSimilarityThreshold;
    const topK =
      isObjectPayload && payload.topK != null ? Number(payload.topK) : ragCfg.topK;
    const candidateLimit =
      isObjectPayload && payload.candidateLimit != null
        ? Number(payload.candidateLimit)
        : ragCfg.candidateLimit;

    if (mode === "keyword") {
      const data = await searchGlobal(keyword, {
        idKitab: Number.isFinite(idKitab) ? idKitab : null,
        limit: topK || 100,
      });
      return {
        ok: true,
        mode: "keyword",
        data,
        meta: {
          query: keyword,
          threshold: null,
          model: null,
          idKitab: Number.isFinite(idKitab) ? idKitab : null,
        },
      };
    }

    const result = await hybridSearch({
      keyword,
      mode,
      idKitab: Number.isFinite(idKitab) ? idKitab : null,
      threshold,
      topK,
      candidateLimit,
      resolveEmbeddingProvider: () =>
        resolveEmbeddingProviderSetting(isObjectPayload ? payload : {}),
      embedText: embedTextWithProvider,
      computeCosineSimilarity,
      getDefaultModelName: getDefaultEmbeddingModelName,
    });
    return result;
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("read-file", async (_event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, error: "File tidak ditemukan." };
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return { ok: true, content };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("read-image-data-url", async (_event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, error: "File gambar tidak ditemukan." };
    }
    const buf = fs.readFileSync(filePath);
    let mime = "image/jpeg";
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".png")) mime = "image/png";
    else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
      mime = "image/jpeg";
    const base64 = buf.toString("base64");
    const dataUrl = `data:${mime};base64,${base64}`;
    return { ok: true, dataUrl };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// DB status for diagnostics
ipcMain.handle("db-status", async () => {
  return getDbStatus();
});

// Get translation for given original text under a kitab name
ipcMain.handle("get-translation", async (_event, payload) => {
  try {
    const { kitabName, folderPath, fileName, originalText } = payload || {};
    if ((!kitabName && !folderPath) || !originalText)
      return {
        ok: false,
        error: "kitabName/folderPath and originalText required",
      };
    const data = await getTranslation({
      kitabName,
      folderPath,
      fileName,
      originalText,
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("get-translation-assist-context", async (_event, payload) => {
  try {
    const { kitabName, folderPath, originalText, sourceLang, targetLang } = payload || {};
    if ((!kitabName && !folderPath) || !originalText) {
      return {
        ok: false,
        error: "kitabName/folderPath and originalText required",
      };
    }
    const data = await getTranslationAssistContext({
      kitabName,
      folderPath,
      originalText,
      sourceLang: sourceLang || "ar",
      targetLang: targetLang || "id",
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("get-source-unit-context", async (_event, payload) => {
  try {
    const { kitabName, folderPath, fileName, filePath, originalText, pageNumber, preferredUnitType } = payload || {};
    if ((!kitabName && !folderPath) || (!fileName && !filePath && !originalText && !pageNumber)) {
      return {
        ok: false,
        error: "kitabName/folderPath and locator payload required",
      };
    }
    const data = await getSourceUnitContext({
      kitabName,
      folderPath,
      fileName,
      filePath,
      originalText,
      pageNumber,
      preferredUnitType: preferredUnitType || "segment",
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("import-source-units", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const { kitabName, folderPath, unitType } = payload || {};
    if ((!kitabName && !folderPath) || !folderPath) {
      return {
        ok: false,
        error: "folderPath required",
      };
    }
    const data = await importSourceUnitsFromFolder({
      kitabName,
      folderPath,
      unitType: unitType || "segment",
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Insert or update translation for given original text under a kitab name
ipcMain.handle("save-translation", async (_event, payload) => {
  try {
    const { kitabName, folderPath, fileName, originalText, translatedText, sourceLabel, feedbackLabel, feedbackNotes, actorName, sourceFlow } =
      payload || {};
    if ((!kitabName && !folderPath) || !originalText)
      return {
        ok: false,
        error: "kitabName/folderPath and originalText required",
      };
    const res = await saveTranslation({
      kitabName,
      folderPath,
      fileName,
      originalText,
      translatedText,
      sourceLabel,
      feedbackLabel,
      feedbackNotes,
      actorName,
      sourceFlow,
    });
    if (res?.memory_id) {
      try {
        const embedProvider = await resolveEmbeddingProviderSetting({});
        if (embedProvider) {
          await indexTranslationMemorySemantics({
            providerSetting: embedProvider,
            idKitab: null,
            sourceLang: "ar",
            targetLang: "id",
            sourceText: originalText,
            memoryId: res.memory_id,
            limit: 1,
          });
        }
      } catch (e) {
        console.warn("Failed to index semantic embedding after save-translation:", e);
      }
    }
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("list-translation-versions", async (_event, payload) => {
  try {
    const data = await listTranslationVersions(payload || {});
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("list-translation-feedback-history", async (_event, payload) => {
  try {
    const data = await listTranslationFeedbackHistory(payload || {});
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("submit-translation-review", async (_event, payload) => {
  try {
    const data = await submitTranslationReview(payload || {});
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("learning-refresh-semantic", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const result = await refreshApprovedSemanticIndex({
      approvedOnly:
        payload && typeof payload.approvedOnly === "boolean"
          ? payload.approvedOnly
          : true,
      requireExplicitApproval:
        payload && typeof payload.requireExplicitApproval === "boolean"
          ? payload.requireExplicitApproval
          : false,
      includeHighQualityFallback:
        payload && typeof payload.includeHighQualityFallback === "boolean"
          ? payload.includeHighQualityFallback
          : true,
      minConfidence:
        payload && payload.minConfidence != null
          ? Number(payload.minConfidence)
          : 0.8,
      limit:
        payload && payload.limit != null ? Number(payload.limit) : 5000,
      embeddingProviderPayload: payload || {},
    });
    return result;
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("learning-preview-candidates", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    return await previewLearningCandidates({
      approvedOnly:
        payload && typeof payload.approvedOnly === "boolean"
          ? payload.approvedOnly
          : true,
      requireExplicitApproval:
        payload && typeof payload.requireExplicitApproval === "boolean"
          ? payload.requireExplicitApproval
          : false,
      includeHighQualityFallback:
        payload && typeof payload.includeHighQualityFallback === "boolean"
          ? payload.includeHighQualityFallback
          : true,
      minConfidence:
        payload && payload.minConfidence != null
          ? Number(payload.minConfidence)
          : 0.8,
      limit:
        payload && payload.limit != null ? Number(payload.limit) : 5000,
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("preview-global-style-profile", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const settings = normalizeTranslationStyleMemorySettings({
      ...getTranslationStyleMemorySettings(),
      ...(payload || {}),
    });
    return await buildStyleProfileDraft({
      ...settings,
      scopeType: "global",
      scopeKey: null,
      scopeLabel: "Global",
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("rebuild-global-style-profile", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const settings = normalizeTranslationStyleMemorySettings({
      ...getTranslationStyleMemorySettings(),
      ...(payload || {}),
    });
    const draftResult = await buildStyleProfileDraft({
      ...settings,
      scopeType: "global",
      scopeKey: null,
      scopeLabel: "Global",
    });
    if (!draftResult?.ok || !draftResult?.draft) return draftResult;
    const profile = await createTranslationStyleProfile({
      scopeType: draftResult.draft.scopeType,
      scopeKey: draftResult.draft.scopeKey,
      sourceLang: draftResult.draft.sourceLang,
      targetLang: draftResult.draft.targetLang,
      profileName: draftResult.draft.profileName,
      summaryText: draftResult.draft.summaryText,
      rules: draftResult.draft.rules,
      sampleCount: draftResult.draft.sampleCount,
      sourcePolicy: draftResult.draft.sourcePolicy,
      metadata: draftResult.draft.metadata,
      createdBy: "settings_rebuild",
    });
    return { ok: true, profile, draft: draftResult.draft };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("preview-kitab-style-profile", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const idKitab = Number(payload?.idKitab);
    if (!Number.isFinite(idKitab) || idKitab <= 0) {
      return { ok: false, error: "idKitab wajib dipilih." };
    }
    const kitab = await getKitabDetailById(idKitab);
    if (!kitab) return { ok: false, error: "Kitab tidak ditemukan." };
    const settings = normalizeTranslationStyleMemorySettings({
      ...getTranslationStyleMemorySettings(),
      ...(payload || {}),
    });
    return await buildStyleProfileDraft({
      ...settings,
      scopeType: "kitab",
      scopeKey: String(idKitab),
      scopeLabel: kitab.nama_kitab || `Kitab ${idKitab}`,
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("rebuild-kitab-style-profile", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const idKitab = Number(payload?.idKitab);
    if (!Number.isFinite(idKitab) || idKitab <= 0) {
      return { ok: false, error: "idKitab wajib dipilih." };
    }
    const kitab = await getKitabDetailById(idKitab);
    if (!kitab) return { ok: false, error: "Kitab tidak ditemukan." };
    const settings = normalizeTranslationStyleMemorySettings({
      ...getTranslationStyleMemorySettings(),
      ...(payload || {}),
    });
    const draftResult = await buildStyleProfileDraft({
      ...settings,
      scopeType: "kitab",
      scopeKey: String(idKitab),
      scopeLabel: kitab.nama_kitab || `Kitab ${idKitab}`,
    });
    if (!draftResult?.ok || !draftResult?.draft) return draftResult;
    const profile = await createTranslationStyleProfile({
      scopeType: draftResult.draft.scopeType,
      scopeKey: draftResult.draft.scopeKey,
      sourceLang: draftResult.draft.sourceLang,
      targetLang: draftResult.draft.targetLang,
      profileName: draftResult.draft.profileName,
      summaryText: draftResult.draft.summaryText,
      rules: draftResult.draft.rules,
      sampleCount: draftResult.draft.sampleCount,
      sourcePolicy: draftResult.draft.sourcePolicy,
      metadata: draftResult.draft.metadata,
      createdBy: "settings_rebuild_kitab",
    });
    return { ok: true, profile, draft: draftResult.draft };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("preview-cluster-style-profile", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const clusterKey = String(payload?.clusterKey || "").trim().toLowerCase();
    const clusterDef = getStyleClusterDefinition(clusterKey);
    if (!clusterDef) {
      return { ok: false, error: "Cluster style belum dipilih atau tidak valid." };
    }
    const settings = normalizeTranslationStyleMemorySettings({
      ...getTranslationStyleMemorySettings(),
      ...(payload || {}),
    });
    return await buildStyleProfileDraft({
      ...settings,
      scopeType: "global_cluster",
      scopeKey: clusterKey,
      clusterKey,
      scopeLabel: clusterDef.label,
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("rebuild-cluster-style-profile", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const clusterKey = String(payload?.clusterKey || "").trim().toLowerCase();
    const clusterDef = getStyleClusterDefinition(clusterKey);
    if (!clusterDef) {
      return { ok: false, error: "Cluster style belum dipilih atau tidak valid." };
    }
    const settings = normalizeTranslationStyleMemorySettings({
      ...getTranslationStyleMemorySettings(),
      ...(payload || {}),
    });
    const draftResult = await buildStyleProfileDraft({
      ...settings,
      scopeType: "global_cluster",
      scopeKey: clusterKey,
      clusterKey,
      scopeLabel: clusterDef.label,
    });
    if (!draftResult?.ok || !draftResult?.draft) return draftResult;
    const profile = await createTranslationStyleProfile({
      scopeType: draftResult.draft.scopeType,
      scopeKey: draftResult.draft.scopeKey,
      sourceLang: draftResult.draft.sourceLang,
      targetLang: draftResult.draft.targetLang,
      profileName: draftResult.draft.profileName,
      summaryText: draftResult.draft.summaryText,
      rules: draftResult.draft.rules,
      sampleCount: draftResult.draft.sampleCount,
      sourcePolicy: draftResult.draft.sourcePolicy,
      metadata: draftResult.draft.metadata,
      createdBy: "settings_rebuild_cluster",
    });
    return { ok: true, profile, draft: draftResult.draft };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("list-translation-style-profiles", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const profiles = await listTranslationStyleProfiles({
      scopeType:
        payload && typeof payload.scopeType === "string"
          ? payload.scopeType
          : "global",
      sourceLang:
        payload && typeof payload.sourceLang === "string"
          ? payload.sourceLang
          : "ar",
      targetLang:
        payload && typeof payload.targetLang === "string"
          ? payload.targetLang
          : "id",
      onlyActive:
        payload && Object.prototype.hasOwnProperty.call(payload, "onlyActive")
          ? payload.onlyActive
          : null,
      limit:
        payload && payload.limit != null ? Number(payload.limit) : 20,
    });
    return { ok: true, data: profiles };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("activate-translation-style-profile", async (_event, profileId) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const profile = await activateTranslationStyleProfile(profileId);
    return { ok: true, data: profile };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("semantic-reindex-translation-memory", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    return await reindexTranslationMemorySemanticIndex({
      mode:
        payload && typeof payload.mode === "string"
          ? payload.mode
          : "incremental",
      approvedOnly:
        payload && typeof payload.approvedOnly === "boolean"
          ? payload.approvedOnly
          : true,
      includeHighQualityFallback:
        payload && typeof payload.includeHighQualityFallback === "boolean"
          ? payload.includeHighQualityFallback
          : true,
      minQualityScore:
        payload && payload.minQualityScore != null
          ? Number(payload.minQualityScore)
          : 0.8,
      limit:
        payload && payload.limit != null ? Number(payload.limit) : 5000,
      embeddingProviderPayload: payload || {},
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("rag-reindex-corpus", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const idKitab =
      payload && payload.idKitab != null
        ? Number(payload.idKitab)
        : payload && payload.id_kitab != null
          ? Number(payload.id_kitab)
          : null;
    return await reindexRagCorpus({
      idKitab,
      mode:
        payload && typeof payload.mode === "string"
          ? payload.mode
          : "incremental",
      limit:
        payload && payload.limit != null ? Number(payload.limit) : 5000,
      includeOriginal:
        payload && typeof payload.includeOriginal === "boolean"
          ? payload.includeOriginal
          : true,
      includeTranslation:
        payload && typeof payload.includeTranslation === "boolean"
          ? payload.includeTranslation
          : true,
      resolveEmbeddingProvider: () =>
        resolveEmbeddingProviderSetting(payload || {}),
      embedText: embedTextWithProvider,
      getDefaultModelName: getDefaultEmbeddingModelName,
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("rag-verify-index", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const idKitab =
      payload && payload.idKitab != null
        ? Number(payload.idKitab)
        : payload && payload.id_kitab != null
          ? Number(payload.id_kitab)
          : null;
    if (!idKitab) return { ok: false, error: "id_kitab wajib." };
    const report = await verifyRagIndexForKitab(idKitab, {
      sampleLimit:
        payload && payload.sampleLimit != null
          ? Number(payload.sampleLimit)
          : 3,
    });
    return { ok: true, ...report };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("learning-export-jsonl", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const approvedOnly =
      payload && typeof payload.approvedOnly === "boolean"
        ? payload.approvedOnly
        : true;
    const requireExplicitApproval =
      payload && typeof payload.requireExplicitApproval === "boolean"
        ? payload.requireExplicitApproval
        : false;
    const includeHighQualityFallback =
      payload && typeof payload.includeHighQualityFallback === "boolean"
        ? payload.includeHighQualityFallback
        : true;
    const minConfidence =
      payload && payload.minConfidence != null
        ? Number(payload.minConfidence)
        : 0.8;
    const limit =
      payload && payload.limit != null ? Number(payload.limit) : 5000;
    const exportVariant =
      payload && String(payload.exportVariant || "").trim().toLowerCase() === "chat"
        ? "chat"
        : "flat";
    const includeManifest =
      payload && typeof payload.includeManifest === "boolean"
        ? payload.includeManifest
        : true;
    const deduplicateExact =
      payload && typeof payload.deduplicateExact === "boolean"
        ? payload.deduplicateExact
        : true;
    const candidateRows = await listLearningDatasetCandidates({
      approvedOnly,
      requireExplicitApproval,
      includeHighQualityFallback,
      minConfidence,
      limit,
    });
    const dedupInfo = deduplicateExact
      ? deduplicateLearningDatasetRows(candidateRows)
      : {
          dedupedRows: candidateRows,
          duplicateRowsRemoved: 0,
          uniquePairCount: candidateRows.length,
          duplicateExamples: [],
        };
    const rows = dedupInfo.dedupedRows;
    const defaultName = `reader-dataset-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-")}.jsonl`;
    const win = BrowserWindow.getFocusedWindow() || mainWindow || null;
    const saveResult = await dialog.showSaveDialog(win || undefined, {
      title: "Simpan Dataset JSONL",
      defaultPath: path.join(app.getPath("documents"), defaultName),
      filters: [{ name: "JSONL", extensions: ["jsonl"] }],
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return { ok: false, cancelled: true, error: "Penyimpanan dibatalkan." };
    }
    const exportedAt = new Date().toISOString();
    const lines = rows
      .map((item) =>
        serializeDatasetJsonlRow(item, {
          variant: exportVariant,
          exportedAt,
        }),
      )
      .join("\n");
    fs.writeFileSync(saveResult.filePath, lines ? `${lines}\n` : "", "utf-8");
    let manifestPath = null;
    if (includeManifest) {
      manifestPath = `${saveResult.filePath}.manifest.json`;
      const manifest = buildDatasetExportManifest({
        rows,
        originalRows: candidateRows,
        filePath: saveResult.filePath,
        exportedAt,
        approvedOnly,
        requireExplicitApproval,
        includeHighQualityFallback,
        minConfidence,
        limit,
        exportVariant,
        deduplicateExact,
      });
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    }
    return {
      ok: true,
      filePath: saveResult.filePath,
      manifestPath,
      count: rows.length,
      originalCount: candidateRows.length,
      duplicateRowsRemoved: dedupInfo.duplicateRowsRemoved,
      uniquePairCount: dedupInfo.uniquePairCount,
      approvedOnly,
      requireExplicitApproval,
      includeHighQualityFallback,
      minConfidence,
      limit,
      exportVariant,
      includeManifest,
      deduplicateExact,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// List all kitab from master_kitab
ipcMain.handle("list-kitabs", async () => {
  try {
    const status = getDbStatus();
    if (!status.ok) {
      await initMySql();
    }
    const rows = await listKitabs();
    return { ok: true, data: rows };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// DB config handlers
ipcMain.handle("get-db-config", async () => {
  try {
    return { ok: true, config: getDbConfig(), status: getDbStatus() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("save-db-config", async (_event, partial) => {
  try {
    setDbConfig(partial || {});
    await initMySql();
    return { ok: true, status: getDbStatus(), config: getDbConfig() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// API settings CRUD
ipcMain.handle("list-api-settings", async () => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const rows = await listApiSettings();
    return { ok: true, data: rows };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("filter-providers-by-capability", async (_event, capability) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const rows = await filterProvidersByCapability(capability);
    return { ok: true, data: rows };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("save-api-setting", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const res = await upsertApiSetting(payload || {});
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("list-translation-glossary", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const data = await listTranslationGlossary(payload || {});
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("save-translation-glossary", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const res = await upsertTranslationGlossaryEntry(payload || {});
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("delete-translation-glossary", async (_event, id) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const res = await deleteTranslationGlossaryEntry(id);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("seed-translation-glossary", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const res = await seedTranslationGlossary(payload || {});
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("get-translation-runtime-metrics", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const data = await getTranslationRuntimeMetricsSummary(payload || {});
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("delete-api-setting", async (_event, id) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    await deleteApiSetting(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("list-agent-system-prompts", async () => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const data = await listAgentSystemPrompts();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("save-agent-system-prompt", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const res = await upsertAgentSystemPrompt(payload || {});
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("delete-agent-system-prompt", async (_event, id) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    await deleteAgentSystemPrompt(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("list-agent-prompt-bindings", async () => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const data = await listAgentPromptBindings();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("set-agent-prompt-binding", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const res = await setAgentPromptBinding(payload || {});
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("ai-chat-list-threads", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const limit = payload && payload.limit !== undefined ? payload.limit : 50;
    const data = await listAiChatThreads({ limit });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("ai-chat-create-thread", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const title = payload && typeof payload.title === "string" ? payload.title : "";
    const provider =
      payload && typeof payload.provider === "string" ? payload.provider : "openai";
    const model = payload && typeof payload.model === "string" ? payload.model : "";
    const data = await createAiChatThread({ title, provider, model });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("ai-chat-list-messages", async (_event, threadId) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const data = await listAiChatMessages(threadId, { limit: 2000 });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("ai-chat-rename-thread", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const threadId = payload && payload.threadId ? Number(payload.threadId) : null;
    const title = payload && typeof payload.title === "string" ? payload.title : "";
    const res = await updateAiChatThreadTitle(threadId, title);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("ai-chat-delete-thread", async (_event, threadId) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const res = await deleteAiChatThread(threadId);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("ai-chat-clone-thread", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const threadId = payload && payload.threadId ? Number(payload.threadId) : null;
    const title = payload && typeof payload.title === "string" ? payload.title : "";
    const data = await cloneAiChatThread({ threadId, title });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("ai-chat-send", async (_event, payload) => {
  const threadId = payload && payload.threadId ? Number(payload.threadId) : null;
  const content = payload && typeof payload.content === "string" ? payload.content : "";
  const provider =
    payload && typeof payload.provider === "string" ? payload.provider : "";
  const model = payload && typeof payload.model === "string" ? payload.model : "";
  const promptId = payload && payload.promptId ? Number(payload.promptId) : null;

  if (!content || !content.trim()) return { ok: false, error: "Pesan kosong." };

  const runChat = async ({ prov, mod, systemPrompt, history, input }) => {
    if (prov === "gemini") {
      const item = await getApiSettingByName("geminicli");
      if (!item || !item.api_key)
        return { ok: false, error: 'API key "geminicli" tidak ditemukan.' };

      const modPkg = await import("@google/generative-ai");
      const GoogleGenerativeAI = modPkg.GoogleGenerativeAI || modPkg.default;
      const genAI = new GoogleGenerativeAI(item.api_key);
      const requestedModel = String(mod || "").trim();
      const modelId = requestedModel || "gemini-2.5-flash";
      const m = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: systemPrompt || undefined,
      });

      const chatHistory = (history || [])
        .filter((h) => h && h.role && h.content)
        .map((h) => ({
          role: h.role === "assistant" ? "model" : "user",
          parts: [{ text: String(h.content || "") }],
        }));

      const chat = m.startChat({ history: chatHistory });
      const result = await chat.sendMessage(String(input || ""));
      const resp = await result.response;
      const output = String(resp.text() || "");
      return { ok: true, output };
    }

    const item = await getApiSettingByName("openai");
    if (!item || !item.api_key)
      return { ok: false, error: 'API key "openai" tidak ditemukan.' };

    const messages = [];
    if (systemPrompt && systemPrompt.trim()) {
      messages.push({ role: "system", content: systemPrompt });
    }
    for (const h of history || []) {
      const r = h && typeof h.role === "string" ? h.role : "";
      if (r !== "user" && r !== "assistant") continue;
      messages.push({ role: r, content: String(h.content || "") });
    }
    messages.push({ role: "user", content: String(input || "") });

    const chosenModel = String(mod || "").trim() || "gpt-4o-mini";
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${item.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: chosenModel,
        messages,
        temperature: 0.4,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || resp.statusText;
      return { ok: false, error: msg };
    }
    const output =
      (data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content) ||
      "";
    return { ok: true, output: String(output || "") };
  };

  const buildTitleFromAnswer = async ({ prov, mod, answerText }) => {
    const prompt = `Buat judul singkat dalam Bahasa Indonesia untuk percakapan ini berdasarkan jawaban berikut.

Aturan:
- Maksimal 8 kata
- Tanpa tanda kutip
- Fokus pada tema/kesimpulan inti

Jawaban:
${String(answerText || "").trim()}

Judul:`;

    const sys = "Kamu membuat judul singkat.";
    const res = await runChat({
      prov,
      mod,
      systemPrompt: sys,
      history: [],
      input: prompt,
    });
    if (!res || !res.ok) return { ok: false, error: res?.error || "Gagal membuat judul." };
    const raw = String(res.output || "").trim();
    const cleaned = raw
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const title = cleaned.length > 0 ? cleaned.slice(0, 255) : "";
    if (!title) return { ok: false, error: "Judul kosong." };
    return { ok: true, title };
  };

  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();

    let thread = null;
    if (threadId) {
      thread = await getAiChatThread(threadId);
    }
    if (!thread) {
      const created = await createAiChatThread({
        title: "Chat Baru",
        provider: provider || "openai",
        model: model || "",
      });
      thread = created;
    }

    const prov = String(provider || thread.provider || "openai").trim() || "openai";
    const mod = String(model || thread.model || "").trim();
    let sysPrompt = null;
    if (promptId) {
      const p = await getAgentSystemPromptById(promptId);
      if (!p || !p.system_prompt) return { ok: false, error: "System prompt tidak ditemukan." };
      sysPrompt = String(p.system_prompt || "");
    }
    if (!sysPrompt || !sysPrompt.trim()) {
      sysPrompt =
        (await getActivePromptText("ai_chat")) ||
        "Kamu adalah asisten AI yang membantu pengguna dengan jawaban yang jelas, ringkas, dan akurat.";
    }

    const beforeCount = await countAiChatMessages(thread.id);
    await addAiChatMessage(thread.id, { role: "user", content: String(content || "") });

    const all = await listAiChatMessages(thread.id, { limit: 2000 });
    const convo = all
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role, content: m.content }));
    const take = convo.slice(Math.max(0, convo.length - 21));
    const hist = take.length > 0 ? take.slice(0, -1) : [];

    const aiRes = await runChat({ prov, mod, systemPrompt: sysPrompt, history: hist, input: content });
    if (!aiRes || !aiRes.ok) return { ok: false, error: aiRes?.error || "Gagal memproses AI." };

    const answer = String(aiRes.output || "").trim();
    if (answer) {
      await addAiChatMessage(thread.id, { role: "assistant", content: answer });
    }

    let titleUpdate = null;
    if (beforeCount === 0 && /^Chat Baru\b/i.test(String(thread.title || ""))) {
      const tRes = await buildTitleFromAnswer({ prov, mod, answerText: answer });
      if (tRes && tRes.ok && tRes.title) {
        try {
          await updateAiChatThreadTitle(thread.id, tRes.title);
          titleUpdate = tRes.title;
        } catch (_) {}
      }
    }

    const messages = await listAiChatMessages(thread.id, { limit: 2000 });
    const updatedThread = await getAiChatThread(thread.id);
    return {
      ok: true,
      thread: updatedThread || thread,
      titleUpdated: titleUpdate,
      messages,
      answer,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("translate-gemini-cli", async (event, payload) => {
  const text = payload && typeof payload.text === "string" ? payload.text : "";
  const target =
    payload && typeof payload.target === "string" ? payload.target : "id";
  const model =
    payload && typeof payload.model === "string"
      ? payload.model
      : "gemini-1.5-flash";
  const extraPrompt =
    payload && typeof payload.prompt === "string" ? payload.prompt : "";
  const fileName =
    payload && typeof payload.fileName === "string" ? payload.fileName : "";
  const page = payload && typeof payload.page === "string" ? payload.page : "";
  const filePath =
    payload && typeof payload.filePath === "string" ? payload.filePath : "";
  const folderPath =
    payload && typeof payload.folderPath === "string" ? payload.folderPath : "";
  const win = event ? BrowserWindow.fromWebContents(event.sender) : null;
  const windowId = win ? win.id : null;
  const webContentsId = event && event.sender ? event.sender.id : null;

  if (!text) return { ok: false, error: "Input text is empty." };

  translateQueueCount += 1;
  if (translateState.running) {
    sendToAllWindows("translate-status", {
      ...translateState,
      queueLength: Math.max(0, translateQueueCount - 1),
    });
  }

  const jobId = (translateJobSeq += 1);
  const release = await acquireTranslateSlot();

  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const item = await getApiSettingByName("geminicli");
    if (!item || !item.api_key)
      return { ok: false, error: 'API key "geminicli" tidak ditemukan.' };
    translateState = {
      running: true,
      provider: "gemini",
      model: null,
      attempt: 0,
      startedAt: Date.now(),
      textLength: text.length,
      jobId,
      queueLength: Math.max(0, translateQueueCount - 1),
      fileName: fileName || null,
      page: page || null,
      filePath: filePath || null,
      folderPath: folderPath || null,
      windowId,
      webContentsId,
      stage: "init",
    };
    sendToAllWindows("translate-status", { ...translateState, stage: "init" });
    const extra = String(extraPrompt || "").trim();
    const prompt = [
      "Terjemahkan dengan bahasa yang mudah dimengerti " +
        String(target || "id") +
        ". Keep original line breaks.",
      extra ? `Instruksi tambahan:\n${extra}` : "",
      "",
      String(text || ""),
    ]
      .filter((s) => typeof s === "string")
      .join("\n");
    const mod = await import("@google/generative-ai");
    const GoogleGenerativeAI = mod.GoogleGenerativeAI || mod.default;
    const genAI = new GoogleGenerativeAI(item.api_key);
    const requestedModel = String(model || "").trim();
    let candidates = [];
    try {
      const listResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${item.api_key}`,
      );
      if (listResp.ok) {
        const listData = await listResp.json();
        const models = Array.isArray(listData?.models) ? listData.models : [];
        const eligibleRaw = models
          .filter((m) =>
            m?.supportedGenerationMethods?.includes("generateContent"),
          )
          .map((m) => ({
            id: String(m?.name || "").replace("models/", ""),
            raw: m,
          }))
          .filter((m) => !!m.id);

        const eligible = eligibleRaw.map((m) => m.id);
        const prefer = [];
        const pushIf = (needle) => {
          const found = eligible.find((id) => id.includes(needle));
          if (found && !prefer.includes(found)) prefer.push(found);
        };
        if (requestedModel && eligible.includes(requestedModel)) {
          prefer.push(requestedModel);
        }
        pushIf("gemini-2.5-flash");
        pushIf("gemini-2.0-flash");
        pushIf("gemini-1.5-flash");
        pushIf("gemini-1.5-pro");
        eligible.forEach((id) => {
          if (id.includes("gemini") && !prefer.includes(id)) prefer.push(id);
        });
        candidates = prefer.length ? prefer : ["gemini-1.5-flash"];
      }
    } catch (e) {
      console.warn("Failed to list models for translate-gemini-cli:", e);
      candidates = [requestedModel || "gemini-1.5-flash"];
    }
    const errors = [];
    for (const mid of candidates) {
      translateState.model = mid;
      translateState.attempt = 0;
      translateState.stage = "try";
      sendToAllWindows("translate-status", { ...translateState, stage: "try" });
      const m = genAI.getGenerativeModel({
        model: mid,
        systemInstruction:
          "Kamu adalah penerjemah khusus kitab dan teks Islam klasik berbahasa Arab. Kamu memahami bahasa Arab klasik, istilah tasawuf, biografi ulama, dan gaya penulisan manaqib. Ketentuan: Makna harus terjaga, tidak kaku (word-for-word), bahasa mengalir alami dan religius seperti gaya kitab kuning atau biografi ulama Nusantara.",
      });
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        translateState.attempt = attempt + 1;
        translateState.stage = "attempt";
        sendToAllWindows("translate-status", {
          ...translateState,
          stage: "attempt",
        });
        try {
          const result = await m.generateContent(prompt);
          const response = await result.response;
          const output = String(response.text() || "");
          if (output.trim()) {
            translateState.running = false;
            sendToAllWindows("translate-complete", {
              ok: true,
              provider: "gemini",
              model: mid,
            });
            return { ok: true, output };
          } else {
            lastErr = new Error("Empty response");
          }
        } catch (err) {
          lastErr = err;
          const msg = String((err && err.message) || "");
          const isOverloaded =
            msg.includes("503") ||
            msg.toLowerCase().includes("overloaded") ||
            msg.toLowerCase().includes("service unavailable");
          if (isOverloaded) {
            await delayMs(attempt === 0 ? 800 : attempt === 1 ? 1500 : 2500);
            continue;
          } else {
            break;
          }
        }
      }
      errors.push(
        `Model ${mid}: ${lastErr ? lastErr.message : "unknown error"}`,
      );
    }
    translateState.running = false;
    sendToAllWindows("translate-complete", {
      ok: false,
      provider: "gemini",
      error: errors.join(" | "),
    });
    return { ok: false, error: errors.join(" | ") };
  } catch (e) {
    translateState.running = false;
    sendToAllWindows("translate-complete", {
      ok: false,
      provider: "gemini",
      error: e.message,
    });
    return { ok: false, error: e.message };
  } finally {
    translateQueueCount = Math.max(0, translateQueueCount - 1);
    if (translateQueueCount === 0) {
      translateState = {
        running: false,
        provider: null,
        model: null,
        attempt: 0,
        startedAt: 0,
        textLength: 0,
        jobId: null,
        queueLength: 0,
        fileName: null,
        page: null,
        filePath: null,
        folderPath: null,
        windowId: null,
        webContentsId: null,
        stage: null,
      };
      sendToAllWindows("translate-status", { ...translateState });
    }
    try {
      release && release();
    } catch (_) {}
  }
});

ipcMain.handle("stt-gemini", async (_event, payload) => {
  const { audioData, mimeType } = payload || {};
  if (!audioData) return { ok: false, error: "No audio data provided" };

  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();

    const item = await getApiSettingByName("geminicli");
    if (!item || !item.api_key)
      return { ok: false, error: 'API key "geminicli" not found.' };

    const mod = await import("@google/generative-ai");
    const GoogleGenerativeAI = mod.GoogleGenerativeAI || mod.default;

    // Dynamic Model Discovery to fix "404 Not Found"
    let selectedModel = "gemini-1.5-flash"; // Default fallback
    try {
      const listResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${item.api_key}`,
      );
      if (listResp.ok) {
        const listData = await listResp.json();
        const models = listData.models || [];

        // Find valid models that support generateContent
        // Prioritize: 1.5-flash -> 1.5-pro -> any gemini
        const flash = models.find(
          (m) =>
            m.name.includes("gemini-1.5-flash") &&
            m.supportedGenerationMethods?.includes("generateContent"),
        );
        const pro = models.find(
          (m) =>
            m.name.includes("gemini-1.5-pro") &&
            m.supportedGenerationMethods?.includes("generateContent"),
        );
        const anyGemini = models.find(
          (m) =>
            m.name.includes("gemini") &&
            m.supportedGenerationMethods?.includes("generateContent"),
        );

        if (flash) selectedModel = flash.name.replace("models/", "");
        else if (pro) selectedModel = pro.name.replace("models/", "");
        else if (anyGemini)
          selectedModel = anyGemini.name.replace("models/", "");
      }
    } catch (e) {
      console.warn("Failed to list models, using default:", e);
    }

    const genAI = new GoogleGenerativeAI(item.api_key);
    const model = genAI.getGenerativeModel({ model: selectedModel });

    try {
      const result = await model.generateContent([
        "Transcribe the following audio into text. Return ONLY the transcribed text. Do not add any markdown, punctuation or explanation. Just the words.",
        {
          inlineData: {
            data: audioData,
            mimeType: mimeType || "audio/webm",
          },
        },
      ]);
      const response = await result.response;
      const text = response.text();
      return { ok: true, text: text.trim() };
    } catch (e) {
      return {
        ok: false,
        error: `STT Failed (Model: ${selectedModel}): ${e.message}`,
      };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

function buildOpenAiTranslateSystemPrompt() {
  return `You are a translator of classical Arabic Islamic texts (turath).

Your task is to translate Arabic manuscripts into Indonesian in the style of traditional pesantren kitab translations.

Principles:

- Preserve the original meaning faithfully.
- Do not summarize or omit information.
- Maintain the logical flow of the Arabic text.
- Do not add interpretation or commentary.
- If the Arabic wording is symbolic, mystical, or metaphorical, keep the symbolism.

Translation style:

- Indonesian should be natural but still close to the Arabic wording.
- Follow the style commonly used in Indonesian kitab translations.
- Slight reordering of words is allowed only when necessary for Indonesian grammar.
- Avoid modern academic language unless the Arabic explicitly implies it.
- Avoid Western philosophical terminology.

Output rule:

Return ONLY the Indonesian translation text.
Do not include explanations.

Example:

Arabic:
وكم لله من لطف خفي

Indonesian translation:
Betapa banyak kelembutan Allah yang tersembunyi.

Arabic:
الصبر مفتاح الفرج

Indonesian translation:
Kesabaran adalah kunci datangnya jalan keluar.

Scholarly titles:

When Arabic honorific titles appear before names, treat them as titles, not literal meanings.

Examples:
الحبيب → Habib (not “kekasih”)
الإمام → Imam
السيد → Sayyid
الشيخ → Syekh
العلامة → al-‘Allāmah
القاضي → Qadhi

Do not translate these titles into Indonesian meanings.
Keep them as scholarly titles used in Islamic literature.

Honorific prayers:

Common Arabic supplications following scholars or names must be translated into Indonesian meaning, not transliterated.

Examples:

رضي الله عنه → semoga Allah meridhainya
رضي الله عنها → semoga Allah meridhainya
رضي الله عنهم → semoga Allah meridhai mereka
رضوان الله عليه → semoga Allah melimpahkan keridhaan-Nya kepadanya
رحمه الله → semoga Allah merahmatinya
حفظه الله → semoga Allah menjaganya
غفر الله له → semoga Allah mengampuninya

Do NOT transliterate these phrases.
Always translate their meaning into Indonesian.`;
}

function getTargetLanguageLabel(targetCode) {
  const code = String(targetCode || "id").trim().toLowerCase();
  if (code === "id") return "Bahasa Indonesia";
  if (code === "en") return "English";
  if (code === "ar") return "Arabic";
  return code || "Bahasa Indonesia";
}

function trimPromptSnippet(input, maxLength = 360) {
  const text = String(input || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildGlossaryPromptBlock(glossaryHits) {
  const rows = Array.isArray(glossaryHits) ? glossaryHits : [];
  if (rows.length === 0) return "";
  const lines = rows.slice(0, 12).map((item) => {
    const note = String(item?.notes || "").trim();
    return `- ${item?.source_term || ""} -> ${item?.target_term || ""}${note ? ` | catatan: ${note}` : ""}`;
  });
  return ["Glossary yang relevan:", ...lines].join("\n");
}

function buildTranslationMemoryPromptBlock(tmHits) {
  const renderStatus = (item) => {
    const status = String(item?.approval_status || "").trim();
    return status && status !== "unreviewed" ? ` [status=${status}]` : "";
  };
  const exact = tmHits?.exact && String(tmHits.exact.text_translate || "").trim()
    ? [`[Exact${renderStatus(tmHits.exact)}]\n- Sumber: ${trimPromptSnippet(tmHits.exact.text_original, 280)}\n- Terjemahan: ${trimPromptSnippet(tmHits.exact.text_translate, 280)}`]
    : [];
  const similar = Array.isArray(tmHits?.similar)
    ? tmHits.similar.slice(0, 4).map((item, index) => `${index + 1}.${renderStatus(item)} ${trimPromptSnippet(item.text_original, 160)} => ${trimPromptSnippet(item.text_translate, 180)}`)
    : [];
  const substring = Array.isArray(tmHits?.substring)
    ? tmHits.substring.slice(0, 4).map((item, index) => `${index + 1}.${renderStatus(item)} ${trimPromptSnippet(item.text_original, 160)} => ${trimPromptSnippet(item.text_translate, 180)}`)
    : [];
  const blocks = [];
  if (exact.length > 0) blocks.push("Translation memory exact:\n" + exact.join("\n"));
  if (similar.length > 0) blocks.push("Translation memory similar:\n" + similar.join("\n"));
  if (substring.length > 0) blocks.push("Translation memory substring:\n" + substring.join("\n"));
  return blocks.join("\n\n");
}

function buildSemanticExamplesPromptBlock(semanticExamples) {
  const items = Array.isArray(semanticExamples) ? semanticExamples : [];
  if (items.length === 0) return "";
  const lines = ["Contoh semantic retrieval yang mirip secara makna/gaya:"];
  items.slice(0, 4).forEach((item, index) => {
    const similarity =
      item?.similarity_score == null ? "-" : Number(item.similarity_score).toFixed(3);
    const status = String(item?.approval_status || "").trim();
    const statusLabel = status && status !== "unreviewed" ? ` | status=${status}` : "";
    lines.push(
      `${index + 1}. Similarity: ${similarity}${statusLabel}\nSumber: ${trimPromptSnippet(
        item?.text_original || "",
        320,
      )}\nTerjemahan: ${trimPromptSnippet(item?.text_translate || "", 320)}`,
    );
  });
  return lines.join("\n\n");
}

function buildSemanticSourceUnitsPromptBlock(sourceUnitExamples) {
  const items = Array.isArray(sourceUnitExamples) ? sourceUnitExamples : [];
  if (items.length === 0) return "";
  const lines = ["Konteks semantic dari source unit lain yang mirip:"];
  items.slice(0, 3).forEach((item, index) => {
    const similarity =
      item?.similarity_score == null ? "-" : Number(item.similarity_score).toFixed(3);
    const meta = [];
    if (item?.page_number != null) meta.push(`page=${item.page_number}`);
    if (item?.segment_order != null) meta.push(`segment=${item.segment_order}`);
    if (item?.file_name) meta.push(`file=${item.file_name}`);
    lines.push(
      `${index + 1}. Similarity: ${similarity}${meta.length ? ` | ${meta.join(", ")}` : ""}\nTeks: ${trimPromptSnippet(
        item?.source_text || "",
        340,
      )}`,
    );
  });
  return lines.join("\n\n");
}

function buildSemanticObservabilityPayload(semanticContext) {
  const tmThreshold =
    semanticContext?.semanticMeta?.tmThreshold == null
      ? 0.68
      : Number(semanticContext.semanticMeta.tmThreshold);
  const sourceUnitThreshold =
    semanticContext?.semanticMeta?.sourceUnitThreshold == null
      ? 0.72
      : Number(semanticContext.semanticMeta.sourceUnitThreshold);
  const tmHits = Array.isArray(semanticContext?.semanticExamples)
    ? semanticContext.semanticExamples.map((item, index) => ({
        source_type: "translation_memory",
        rank: index + 1,
        threshold: tmThreshold,
        similarity_score:
          item?.similarity_score == null ? null : Number(item.similarity_score),
        approval_status: item?.approval_status || "unreviewed",
        text_original: item?.text_original || "",
        text_translate: item?.text_translate || "",
        file_name: item?.file_name || null,
        provider: item?.provider || null,
        model: item?.model || null,
      }))
    : [];
  const sourceUnitHits = Array.isArray(semanticContext?.semanticSourceUnits)
    ? semanticContext.semanticSourceUnits.map((item, index) => ({
        source_type: "source_unit",
        rank: index + 1,
        threshold: sourceUnitThreshold,
        similarity_score:
          item?.similarity_score == null ? null : Number(item.similarity_score),
        page_number: item?.page_number == null ? null : Number(item.page_number),
        segment_order:
          item?.segment_order == null ? null : Number(item.segment_order),
        file_name: item?.file_name || null,
        unit_type: item?.unit_type || null,
        source_text: item?.source_text || "",
      }))
    : [];
  return {
    enabled: !!semanticContext?.semanticMeta?.enabled,
    provider: semanticContext?.semanticMeta?.provider || null,
    model: semanticContext?.semanticMeta?.model || null,
    indexedCount: Number(semanticContext?.semanticMeta?.indexedCount || 0),
    exampleCount: Number(semanticContext?.semanticMeta?.exampleCount || 0),
    tmIndexedCount: Number(semanticContext?.semanticMeta?.tmIndexedCount || 0),
    tmExampleCount: Number(semanticContext?.semanticMeta?.tmExampleCount || 0),
    sourceUnitIndexedCount: Number(
      semanticContext?.semanticMeta?.sourceUnitIndexedCount || 0,
    ),
    sourceUnitCount: Number(semanticContext?.semanticMeta?.sourceUnitCount || 0),
    maxTmExamples: Number(semanticContext?.semanticMeta?.maxTmExamples || 0),
    maxSourceUnitExamples: Number(
      semanticContext?.semanticMeta?.maxSourceUnitExamples || 0,
    ),
    tmThreshold,
    sourceUnitThreshold,
    tmHits,
    sourceUnitHits,
  };
}

function buildSourceContextPromptBlock(sourceContext) {
  const current = sourceContext?.current;
  const prev = sourceContext?.prev;
  const next = sourceContext?.next;
  const currentPageSegments = Array.isArray(sourceContext?.current_page_segments)
    ? sourceContext.current_page_segments
    : [];
  if (!current && !prev && !next && currentPageSegments.length === 0) return "";
  const formatUnit = (label, item) => {
    if (!item || !String(item.source_text || "").trim()) return "";
    const meta = [];
    if (item.unit_type) meta.push(`type=${item.unit_type}`);
    if (item.page_number != null) meta.push(`page=${item.page_number}`);
    if (item.segment_order != null) meta.push(`segment=${item.segment_order}`);
    if (item.file_name) meta.push(`file=${item.file_name}`);
    return `[${label}${meta.length ? ` | ${meta.join(", ")}` : ""}]\n${trimPromptSnippet(item.source_text, 600)}`;
  };
  const currentPageBlock = currentPageSegments.length > 0
    ? [
        '[CurrentPageSegments]',
        ...currentPageSegments.slice(0, 6).map((item) => {
          const meta = [];
          if (item.page_number != null) meta.push(`page=${item.page_number}`);
          if (item.segment_order != null) meta.push(`segment=${item.segment_order}`);
          return `- ${meta.join(', ')}\n${trimPromptSnippet(item.source_text, 280)}`;
        })
      ].join('\n')
    : '';
  const parts = [
    formatUnit("Prev", prev),
    formatUnit("Current", current),
    formatUnit("Next", next),
    currentPageBlock,
  ].filter(Boolean);
  if (parts.length === 0) return "";
  return ["Konteks sekitar source unit:", ...parts].join("\n\n");
}

function buildStyleProfilePromptBlock(styleProfile) {
  const styleSettings = getTranslationStyleMemorySettings();
  if (!styleProfile || !String(styleProfile.summary_text || "").trim()) return "";
  const metadata =
    styleProfile?.metadata && typeof styleProfile.metadata === "object"
      ? styleProfile.metadata
      : {};
  const lockedRules = Array.isArray(metadata.lockedRules)
    ? metadata.lockedRules.filter((item) => String(item || "").trim())
    : [];
  const adaptiveRules = Array.isArray(metadata.adaptiveRules)
    ? metadata.adaptiveRules.filter((item) => String(item || "").trim())
    : Array.isArray(styleProfile.rules)
      ? styleProfile.rules.filter((item) => String(item || "").trim())
      : [];
  const summary = String(styleProfile.summary_text || "").trim();
  const lines = [
    `Style profile aktif: ${styleProfile.profile_name || "Global Style Profile"} (v${Number(styleProfile.version_number || 1)})`,
    summary,
  ];
  if (metadata.clusterLabel || metadata.clusterKey) {
    lines.push(
      "",
      `Cluster gaya: ${metadata.clusterLabel || metadata.clusterKey}`,
    );
  }
  if (lockedRules.length > 0) {
    lines.push("", "Aturan terkunci:");
    for (const rule of lockedRules.slice(0, 8)) {
      lines.push(`- ${String(rule).trim()}`);
    }
  }
  if (adaptiveRules.length > 0) {
    lines.push("", "Aturan adaptif:");
    for (const rule of adaptiveRules.slice(0, 12)) {
      lines.push(`- ${String(rule).trim()}`);
    }
  }
  const representativeSamples = Array.isArray(
    metadata.representativeSamples,
  )
    ? metadata.representativeSamples
    : [];
  if (
    styleSettings.includeRepresentativeSamples &&
    representativeSamples.length > 0
  ) {
    lines.push("", "Contoh gaya representatif:");
    for (const [index, item] of representativeSamples
      .slice(0, styleSettings.representativeSampleCount)
      .entries()) {
      const sourceText = trimPromptSnippet(item?.source_preview || "", 180);
      const targetText = trimPromptSnippet(item?.target_preview || "", 180);
      if (!sourceText || !targetText) continue;
      lines.push(
        `${index + 1}. Sumber: ${sourceText}\n   Terjemahan: ${targetText}`,
      );
    }
  }
  return lines.join("\n");
}

function buildTranslateSupportContext(
  context,
  sourceContext,
  semanticContext,
  styleProfile,
) {
  const glossaryBlock = buildGlossaryPromptBlock(context?.glossaryHits);
  const tmBlock = buildTranslationMemoryPromptBlock(context?.tmHits);
  const sourceBlock = buildSourceContextPromptBlock(sourceContext);
  const styleBlock = buildStyleProfilePromptBlock(styleProfile);
  const semanticBlock = buildSemanticExamplesPromptBlock(
    semanticContext?.semanticExamples,
  );
  const semanticSourceUnitBlock = buildSemanticSourceUnitsPromptBlock(
    semanticContext?.semanticSourceUnits,
  );
  const pieces = [
    styleBlock,
    glossaryBlock,
    tmBlock,
    sourceBlock,
    semanticBlock,
    semanticSourceUnitBlock,
  ].filter((item) => String(item || "").trim());
  if (pieces.length === 0) return "";
  return [
    "Gunakan konteks internal berikut bila relevan.",
    "Style profile dipakai sebagai fallback gaya bila tidak ada referensi kitab yang lebih spesifik.",
    "Istilah glossary bersifat prioritas. Jika ada exact translation memory untuk teks yang sama, pertahankan terjemahannya kecuali jelas salah.",
    "",
    ...pieces,
  ].join("\n");
}

function buildPromptObservabilityPayload({
  aiCalled = false,
  skipReason = "",
  provider = "",
  protocol = "",
  model = "",
  systemPrompt = "",
  userPrompt = "",
  extraPrompt = "",
  supportContext = "",
  requestBody = null,
}) {
  let requestPayload = "";
  if (requestBody && typeof requestBody === "object") {
    try {
      requestPayload = JSON.stringify(requestBody, null, 2);
    } catch (_) {
      requestPayload = "";
    }
  } else if (typeof requestBody === "string") {
    requestPayload = requestBody;
  }

  return {
    aiCalled: !!aiCalled,
    skipReason: String(skipReason || "").trim() || null,
    provider: String(provider || "").trim() || null,
    protocol: String(protocol || "").trim() || null,
    model: String(model || "").trim() || null,
    systemPrompt: String(systemPrompt || ""),
    userPrompt: String(userPrompt || ""),
    extraPrompt: String(extraPrompt || ""),
    supportContext: String(supportContext || ""),
    requestPayload,
  };
}

function buildOpenAiTranslateUserPrompt({ text, targetCode, extraPrompt, supportContext }) {
  const targetLabel = getTargetLanguageLabel(targetCode);
  const extra = String(extraPrompt || "").trim();
  const support = String(supportContext || "").trim();
  return `Terjemahkan teks Arab berikut ke ${targetLabel} dengan gaya terjemahan kitab (pesantren), bukan gaya ensiklopedi atau akademik modern.

Ketentuan:

- Kembalikan hanya teks terjemahan (tanpa markdown atau penjelasan).
- Jangan meringkas atau menghilangkan bagian apa pun dari teks.
- Jangan menambahkan tafsir, komentar, atau penjelasan.
- Pertahankan makna dan alur logika sebagaimana dalam teks Arab.
- Urutan gagasan harus mengikuti teks Arab, tetapi penyesuaian kecil untuk tata bahasa target diperbolehkan agar kalimat tetap terbaca.
- Jika terdapat ungkapan simbolik, sufistik, atau metaforis, pertahankan sifat simboliknya tanpa merasionalisasi.
- Gunakan gaya bahasa yang lazim dalam terjemahan kitab di pesantren.
- Hindari istilah akademik modern yang tidak tersurat jelas dalam teks Arab.

${support ? `${support}\n\n` : ""}${extra ? `Instruksi tambahan pengguna:\n${extra}\n\n` : ""}Teks Arab:
${String(text || "")}

Terjemahan:`;
}

function buildGeminiTranslatePrompt({ text, targetCode, extraPrompt, supportContext }) {
  const targetLabel = getTargetLanguageLabel(targetCode);
  const extra = String(extraPrompt || "").trim();
  const support = String(supportContext || "").trim();
  return [
    `Terjemahkan teks Arab berikut ke ${targetLabel}. Pertahankan line breaks asli bila ada.`,
    "Kembalikan hanya hasil terjemahan tanpa penjelasan tambahan.",
    support ? `Konteks internal:\n${support}` : "",
    extra ? `Instruksi tambahan:\n${extra}` : "",
    "",
    "Teks Arab:",
    String(text || ""),
  ]
    .filter((part) => typeof part === "string" && part.trim())
    .join("\n\n");
}

async function getActivePromptText(category) {
  const item = await getAgentActiveSystemPrompt(category);
  const t = item && typeof item.system_prompt === "string" ? item.system_prompt : "";
  return t && t.trim() ? t : null;
}

function normalizeHttpBaseUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function buildOpenAiChatCompletionsUrl(baseUrl) {
  const b = normalizeHttpBaseUrl(baseUrl) || "https://api.openai.com";
  if (b.endsWith("/v1")) return `${b}/chat/completions`;
  return `${b}/v1/chat/completions`;
}

async function resolveTranslateProviderSetting(payload) {
  const providerId = payload && payload.providerId != null ? Number(payload.providerId) : null;
  const provider = payload && typeof payload.provider === "string" ? payload.provider.trim() : "";

  if (providerId) {
    const row = await getApiSettingById(providerId);
    if (row) return row;
  }

  const providerKey = provider.toLowerCase();
  if (providerKey) {
    const list = await listApiSettings();
    const found = (list || []).find((it) => {
      const p = String(it?.provider || "").trim().toLowerCase();
      const status = String(it?.status || "active").trim().toLowerCase();
      const caps = Array.isArray(it?.capabilities) ? it.capabilities : [];
      return status !== "inactive" && p === providerKey && caps.includes("translate");
    });
    if (found) return found;
  }

  if (providerKey === "openai") {
    const row = await getApiSettingByName("openai");
    if (row) return row;
  }
  if (providerKey === "gemini") {
    const row =
      (await getApiSettingByName("geminicli")) ||
      (await getApiSettingByName("gemini"));
    if (row) return row;
  }

  if (providerKey) {
    const row = await getApiSettingByName(providerKey);
    if (row) return row;
  }

  return null;
}

async function resolveEmbeddingProviderSetting(payload = {}) {
  const providerId =
    payload && payload.embeddingProviderId != null
      ? Number(payload.embeddingProviderId)
      : null;
  const provider =
    payload && typeof payload.embeddingProvider === "string"
      ? payload.embeddingProvider.trim()
      : "";

  if (providerId) {
    const row = await getApiSettingById(providerId);
    if (row) return row;
  }

  if (provider) {
    const list = await listApiSettings();
    const found = (list || []).find((it) => {
      const p = String(it?.provider || "")
        .trim()
        .toLowerCase();
      const status = String(it?.status || "active")
        .trim()
        .toLowerCase();
      const caps = Array.isArray(it?.capabilities) ? it.capabilities : [];
      return status !== "inactive" && p === provider.toLowerCase() && caps.includes("embed");
    });
    if (found) return found;
  }

  const rows = await filterProvidersByCapability("embed");
  if (Array.isArray(rows) && rows.length > 0) return rows[0];

  // Fallback when capabilities_json belum diisi: pakai provider OpenAI/Gemini aktif.
  const openai =
    (await getApiSettingByName("openai")) ||
    (await getApiSettingByName("OpenAI"));
  if (openai && String(openai.status || "active").toLowerCase() !== "inactive") {
    return openai;
  }
  const gemini =
    (await getApiSettingByName("geminicli")) ||
    (await getApiSettingByName("gemini"));
  if (gemini && String(gemini.status || "active").toLowerCase() !== "inactive") {
    return gemini;
  }
  return null;
}

function buildOpenAiEmbeddingsUrl(baseUrl) {
  const b = normalizeHttpBaseUrl(baseUrl) || "https://api.openai.com";
  if (b.endsWith("/v1")) return `${b}/embeddings`;
  return `${b}/v1/embeddings`;
}

async function embedTextWithProvider(providerSetting, text) {
  const sourceText = String(text || "").trim();
  if (!providerSetting || !sourceText) {
    return { ok: false, error: "Embedding provider or text missing." };
  }
  if (!providerSetting.api_key) {
    return { ok: false, error: "Embedding provider API key tidak ditemukan." };
  }
  const meta =
    providerSetting.meta && typeof providerSetting.meta === "object"
      ? providerSetting.meta
      : {};
  const protocol = String(meta.protocol || providerSetting.provider || "")
    .trim()
    .toLowerCase();

  if (protocol === "openai") {
    const model =
      String(meta.embedding_model || providerSetting.model_default || "").trim() ||
      "text-embedding-3-small";
    const endpoint = buildOpenAiEmbeddingsUrl(providerSetting.base_url);
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${providerSetting.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: sourceText,
      }),
    });
    let data = null;
    try {
      data = await resp.json();
    } catch (_) {
      data = null;
    }
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || resp.statusText;
      return { ok: false, error: msg };
    }
    const vector =
      data &&
      Array.isArray(data.data) &&
      data.data[0] &&
      Array.isArray(data.data[0].embedding)
        ? data.data[0].embedding
        : [];
    return {
      ok: Array.isArray(vector) && vector.length > 0,
      vector,
      modelName: model,
      protocol,
      error:
        Array.isArray(vector) && vector.length > 0
          ? null
          : "Embedding vector kosong.",
    };
  }

  if (protocol === "gemini") {
    const model =
      String(meta.embedding_model || providerSetting.model_default || "").trim() ||
      "text-embedding-004";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${providerSetting.api_key}`;
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${model}`,
        content: {
          parts: [{ text: sourceText }],
        },
      }),
    });
    let data = null;
    try {
      data = await resp.json();
    } catch (_) {
      data = null;
    }
    if (!resp.ok) {
      const msg =
        (data && data.error && data.error.message) || resp.statusText || "Gemini embedding gagal.";
      return { ok: false, error: msg };
    }
    const vector =
      data &&
      data.embedding &&
      Array.isArray(data.embedding.values)
        ? data.embedding.values
        : [];
    return {
      ok: Array.isArray(vector) && vector.length > 0,
      vector,
      modelName: model,
      protocol,
      error:
        Array.isArray(vector) && vector.length > 0
          ? null
          : "Embedding vector kosong.",
    };
  }

  return {
    ok: false,
    error: `Protocol embedding "${protocol}" belum didukung.`,
  };
}

function computeCosineSimilarity(a, b) {
  const va = Array.isArray(a) ? a : [];
  const vb = Array.isArray(b) ? b : [];
  if (!va.length || va.length !== vb.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < va.length; i += 1) {
    const x = Number(va[i]) || 0;
    const y = Number(vb[i]) || 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function getDefaultEmbeddingModelName(providerSetting) {
  const providerMeta =
    providerSetting && providerSetting.meta && typeof providerSetting.meta === "object"
      ? providerSetting.meta
      : {};
  return (
    String(providerMeta.embedding_model || providerSetting?.model_default || "").trim() ||
    (String(providerMeta.protocol || providerSetting?.provider || "")
      .trim()
      .toLowerCase() === "gemini"
      ? "text-embedding-004"
      : "text-embedding-3-small")
  );
}

function incrementReasonCounter(map, key) {
  const reasonKey = String(key || "unknown");
  map[reasonKey] = Number(map[reasonKey] || 0) + 1;
}

async function indexTranslationMemorySemantics({
  providerSetting,
  idKitab,
  sourceLang,
  targetLang,
  sourceText,
  memoryId = null,
  limit = 18,
}) {
  if (!providerSetting) {
    return { ok: false, reason: "embedding_provider_missing", modelName: null };
  }

  const semanticRows = await listTranslationMemorySemanticCandidates({
    idKitab,
    sourceLang,
    targetLang,
    limit: memoryId ? Math.max(1, Math.min(limit, 6)) : limit,
  });
  const toIndex = memoryId
    ? semanticRows.filter((row) => Number(row.id) === Number(memoryId))
    : semanticRows;
  let indexed = 0;
  let modelName = getDefaultEmbeddingModelName(providerSetting);

  for (const row of toIndex) {
    const source = String(row?.source_text || "").trim();
    if (!source) continue;
    const existing = modelName
      ? await getSemanticEmbeddingEntry({
          entityType: "translation_memory",
          entityId: row.id,
          modelName,
        })
      : null;
    const textHash = crypto.createHash("sha256").update(source, "utf8").digest("hex");
    if (existing && existing.text_hash === textHash && Array.isArray(existing.vector) && existing.vector.length > 0) {
      indexed += 0;
      continue;
    }
    const embedded = await embedTextWithProvider(providerSetting, source);
    if (!embedded.ok || !Array.isArray(embedded.vector) || embedded.vector.length === 0) {
      continue;
    }
    modelName = embedded.modelName || modelName;
    await upsertSemanticEmbeddingEntry({
      entityType: "translation_memory",
      entityId: row.id,
      idKitab: row.id_kitab || null,
      sourceLang: row.source_lang || sourceLang,
      targetLang: row.target_lang || targetLang,
      modelName: embedded.modelName,
      text: source,
      vector: embedded.vector,
      metadata: {
        provider: providerSetting.provider || null,
        protocol: embedded.protocol || null,
        translated_text_preview: String(row?.translated_text || "").slice(0, 280),
      },
    });
    indexed += 1;
  }

  return { ok: true, indexed, modelName };
}

async function indexSourceUnitSemantics({
  providerSetting,
  sourceContext,
  sourceLang,
  targetLang,
  limit = 48,
}) {
  if (!providerSetting) {
    return { ok: false, reason: "embedding_provider_missing", modelName: null };
  }
  const current = sourceContext?.current;
  const idKitab = sourceContext?.idKitab || current?.id_kitab || null;
  if (!current || !idKitab) {
    return { ok: true, indexed: 0, modelName: getDefaultEmbeddingModelName(providerSetting) };
  }

  const seededRows = [
    current,
    sourceContext?.prev || null,
    sourceContext?.next || null,
    ...(Array.isArray(sourceContext?.current_page_segments)
      ? sourceContext.current_page_segments
      : []),
  ].filter(Boolean);
  const candidateRows = await listSourceUnitSemanticCandidates({
    idKitab,
    folderPath: current.folder_path || null,
    unitType: "segment",
    currentPageNumber: current.page_number,
    currentFileName: current.file_name || null,
    limit,
  });
  const merged = new Map();
  [...seededRows, ...candidateRows].forEach((row) => {
    if (row && row.id != null && !merged.has(Number(row.id))) {
      merged.set(Number(row.id), row);
    }
  });
  const toIndex = Array.from(merged.values()).slice(
    0,
    Math.max(1, Math.min(Number(limit) || 48, 120)),
  );
  let indexed = 0;
  let modelName = getDefaultEmbeddingModelName(providerSetting);

  for (const row of toIndex) {
    const source = String(row?.source_text || "").trim();
    if (!source) continue;
    const existing = modelName
      ? await getSemanticEmbeddingEntry({
          entityType: "source_unit",
          entityId: row.id,
          modelName,
        })
      : null;
    const textHash = crypto.createHash("sha256").update(source, "utf8").digest("hex");
    if (existing && existing.text_hash === textHash && Array.isArray(existing.vector) && existing.vector.length > 0) {
      continue;
    }
    const embedded = await embedTextWithProvider(providerSetting, source);
    if (!embedded.ok || !Array.isArray(embedded.vector) || embedded.vector.length === 0) {
      continue;
    }
    modelName = embedded.modelName || modelName;
    await upsertSemanticEmbeddingEntry({
      entityType: "source_unit",
      entityId: row.id,
      idKitab: row.id_kitab || idKitab,
      sourceLang: row.source_lang || sourceLang || "ar",
      targetLang: row.target_lang || targetLang || "id",
      modelName: embedded.modelName || modelName,
      text: source,
      vector: embedded.vector,
      metadata: {
        provider: providerSetting.provider || null,
        protocol: embedded.protocol || null,
        indexed_from: "source_units",
        unit_type: row.unit_type || "segment",
        folder_path: row.folder_path || null,
        file_name: row.file_name || null,
        page_number: row.page_number == null ? null : Number(row.page_number),
        segment_order: row.segment_order == null ? null : Number(row.segment_order),
      },
    });
    indexed += 1;
  }

  return { ok: true, indexed, modelName };
}

async function reindexTranslationMemorySemanticIndex({
  mode = "incremental",
  approvedOnly = true,
  includeHighQualityFallback = true,
  minQualityScore = 0.8,
  limit = 5000,
  embeddingProviderPayload = {},
} = {}) {
  const providerSetting = await resolveEmbeddingProviderSetting(
    embeddingProviderPayload,
  );
  if (!providerSetting) {
    return {
      ok: false,
      error: "Provider embedding dengan capability `embed` belum tersedia.",
    };
  }

  const normalizedMode = String(mode || "incremental").trim().toLowerCase() === "full"
    ? "full"
    : "incremental";
  const qualityGate = Math.max(0, Math.min(1, Number(minQualityScore) || 0));
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 5000, 20000));
  const candidates = await listTranslationMemorySemanticReindexCandidates({
    sourceLang: "ar",
    targetLang: "id",
    limit: boundedLimit,
  });
  const skipReasons = {};
  const failedReasons = {};
  const seenNormalized = new Set();
  const jobStartedAt = new Date().toISOString();
  let modelName = getDefaultEmbeddingModelName(providerSetting);
  let scanned = 0;
  let indexed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of candidates) {
    scanned += 1;
    const sourceText = String(row?.source_text || "").trim();
    const translatedText = String(row?.translated_text || "").trim();
    const normalizedSource = String(row?.source_text_normalized || "").trim();
    const qualityScore =
      row?.quality_score == null ? null : Number(row.quality_score);
    const hasApproval = Number(row?.has_explicit_approval || 0) === 1;
    const hasReviewSignal =
      hasApproval || Number(row?.has_review_signal || 0) === 1;
    const passesQualityGate =
      qualityScore != null && Number.isFinite(qualityScore) && qualityScore >= qualityGate;

    if (!sourceText || !translatedText || !normalizedSource) {
      skipped += 1;
      incrementReasonCounter(skipReasons, "empty_text");
      continue;
    }
    if (Number(row?.has_rejection || 0) === 1) {
      skipped += 1;
      incrementReasonCounter(skipReasons, "rejected");
      continue;
    }
    if (seenNormalized.has(normalizedSource)) {
      skipped += 1;
      incrementReasonCounter(skipReasons, "duplicate_source");
      continue;
    }
    seenNormalized.add(normalizedSource);

    if (approvedOnly) {
      if (!hasReviewSignal) {
        skipped += 1;
        incrementReasonCounter(skipReasons, "missing_review_signal");
        continue;
      }
    } else if (!(hasReviewSignal || (includeHighQualityFallback && passesQualityGate))) {
      skipped += 1;
      incrementReasonCounter(
        skipReasons,
        includeHighQualityFallback ? "below_quality_gate" : "unreviewed",
      );
      continue;
    }

    const existing = modelName
      ? await getSemanticEmbeddingEntry({
          entityType: "translation_memory",
          entityId: row.id,
          modelName,
        })
      : null;
    const sourceHash = crypto
      .createHash("sha256")
      .update(sourceText, "utf8")
      .digest("hex");
    if (
      normalizedMode !== "full" &&
      existing &&
      existing.text_hash === sourceHash &&
      Array.isArray(existing.vector) &&
      existing.vector.length > 0
    ) {
      skipped += 1;
      incrementReasonCounter(skipReasons, "unchanged_embedding");
      continue;
    }

    const embedded = await embedTextWithProvider(providerSetting, sourceText);
    if (!embedded.ok || !Array.isArray(embedded.vector) || embedded.vector.length === 0) {
      failed += 1;
      incrementReasonCounter(
        failedReasons,
        embedded.error ? `embedding_failed:${embedded.error}` : "embedding_failed",
      );
      continue;
    }
    modelName = embedded.modelName || modelName;
    await upsertSemanticEmbeddingEntry({
      entityType: "translation_memory",
      entityId: row.id,
      idKitab: row.id_kitab || null,
      sourceLang: row.source_lang || "ar",
      targetLang: row.target_lang || "id",
      modelName: embedded.modelName || modelName,
      text: sourceText,
      vector: embedded.vector,
      metadata: {
        provider: providerSetting.provider || null,
        protocol: embedded.protocol || null,
        source_hash: sourceHash,
        indexed_from: "translation_memory",
        reindex_mode: normalizedMode,
        approval_status: row.approval_status || "unreviewed",
        quality_score: qualityScore,
        usage_count: Number(row?.usage_count || 0),
        feedback_count: Number(row?.feedback_count || 0),
        embedded_at: new Date().toISOString(),
        job_started_at: jobStartedAt,
        translated_text_preview: translatedText.slice(0, 280),
      },
    });
    indexed += 1;
  }

  return {
    ok: true,
    provider: providerSetting.provider || null,
    model: modelName || null,
    mode: normalizedMode,
    candidateCount: candidates.length,
    scannedCount: scanned,
    indexedCount: indexed,
    skippedCount: skipped,
    failedCount: failed,
    approvedOnly,
    includeHighQualityFallback,
    minQualityScore: qualityGate,
    skipReasons,
    failedReasons,
    jobStartedAt,
  };
}

function buildDatasetExportRowMetadata(item, exportedAt) {
  return {
    translation_id: item?.translation_id || null,
    kitab_id: item?.id_kitab || null,
    kitab_name: item?.nama_kitab || null,
    author: item?.pengarang || null,
    file_name: item?.file_name || null,
    confidence_score:
      item?.confidence_score == null ? null : Number(item.confidence_score),
    approval_status: item?.approval_status || null,
    source_label: item?.source_label || null,
    feedback_count:
      item?.feedback_count == null ? null : Number(item.feedback_count),
    exported_at: exportedAt,
  };
}

function serializeDatasetJsonlRow(item, options = {}) {
  const exportedAt = options.exportedAt || new Date().toISOString();
  const variant =
    String(options.variant || "flat").trim().toLowerCase() === "chat"
      ? "chat"
      : "flat";
  const metadata = buildDatasetExportRowMetadata(item, exportedAt);
  if (variant === "chat") {
    return JSON.stringify({
      messages: [
        {
          role: "system",
          content: "Translate Arabic source text into natural Indonesian.",
        },
        {
          role: "user",
          content: String(item?.text_original || ""),
        },
        {
          role: "assistant",
          content: String(item?.text_translate || ""),
        },
      ],
      metadata,
    });
  }
  return JSON.stringify({
    source_lang: "ar",
    target_lang: "id",
    source_text: String(item?.text_original || ""),
    target_text: String(item?.text_translate || ""),
    metadata,
  });
}

function buildDatasetExportManifest({
  rows = [],
  originalRows = [],
  filePath,
  exportedAt,
  approvedOnly,
  requireExplicitApproval,
  includeHighQualityFallback,
  minConfidence,
  limit,
  exportVariant,
  deduplicateExact = false,
}) {
  const approvalStats = {
    approved: 0,
    confirmed: 0,
    high_quality_manual: 0,
    unqualified: 0,
    rejected: 0,
  };
  const sourceLabelStats = {};
  const kitabStats = new Map();
  const confidenceBuckets = {
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
  };
  let confidenceTotal = 0;
  let confidenceCount = 0;

  for (const item of rows) {
    const approvalStatus = String(item?.approval_status || "unqualified");
    approvalStats[approvalStatus] = Number(approvalStats[approvalStatus] || 0) + 1;
    const sourceLabel = String(item?.source_label || "unknown");
    sourceLabelStats[sourceLabel] = Number(sourceLabelStats[sourceLabel] || 0) + 1;
    const confidence = Number(item?.confidence_score);
    if (Number.isFinite(confidence)) {
      confidenceTotal += confidence;
      confidenceCount += 1;
      if (confidence >= 0.95) confidenceBuckets.high += 1;
      else if (confidence >= 0.85) confidenceBuckets.medium += 1;
      else confidenceBuckets.low += 1;
    } else {
      confidenceBuckets.unknown += 1;
    }
    const kitabKey = String(item?.id_kitab ?? "none");
    if (!kitabStats.has(kitabKey)) {
      kitabStats.set(kitabKey, {
        id_kitab: item?.id_kitab ?? null,
        nama_kitab: item?.nama_kitab || "Tanpa Kitab",
        count: 0,
      });
    }
    kitabStats.get(kitabKey).count += 1;
  }

  return {
    exported_at: exportedAt,
    dataset_type: "reader_learning_jsonl",
    export_variant: exportVariant,
    file_path: filePath,
    row_count: rows.length,
    original_row_count: originalRows.length || rows.length,
    duplicate_rows_removed: Math.max(
      0,
      Number((originalRows.length || rows.length) - rows.length),
    ),
    source_lang: "ar",
    target_lang: "id",
    filters: {
      approvedOnly: !!approvedOnly,
      requireExplicitApproval: !!requireExplicitApproval,
      includeHighQualityFallback: !!includeHighQualityFallback,
      minConfidence: Math.max(0, Math.min(1, Number(minConfidence) || 0)),
      limit: Math.max(1, Math.min(Number(limit) || 5000, 20000)),
      deduplicateExact: !!deduplicateExact,
    },
    summary: {
      average_confidence: confidenceCount > 0 ? confidenceTotal / confidenceCount : 0,
      confidence_buckets: confidenceBuckets,
      approval_status: approvalStats,
      source_label: sourceLabelStats,
      kitab_count: kitabStats.size,
      top_kitabs: Array.from(kitabStats.values())
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return String(a.nama_kitab || "").localeCompare(String(b.nama_kitab || ""));
        })
        .slice(0, 10),
    },
    schema:
      exportVariant === "chat"
        ? "messages[] + metadata"
        : "source_text + target_text + metadata",
  };
}

function buildLearningDatasetDedupKey(item) {
  const source = normalizeArabicText(String(item?.text_original || ""));
  const target = String(item?.text_translate || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!source || !target) return "";
  return `${source}::${target}`;
}

function deduplicateLearningDatasetRows(rows = []) {
  const dedupedRows = [];
  const seen = new Set();
  const duplicateExamples = [];
  let duplicateRowsRemoved = 0;

  for (const item of Array.isArray(rows) ? rows : []) {
    const key = buildLearningDatasetDedupKey(item);
    if (!key) {
      dedupedRows.push(item);
      continue;
    }
    if (seen.has(key)) {
      duplicateRowsRemoved += 1;
      if (duplicateExamples.length < 5) {
        duplicateExamples.push({
          translation_id: Number(item?.translation_id || 0),
          kitab_name: item?.nama_kitab || null,
          file_name: item?.file_name || null,
          approval_status: item?.approval_status || null,
          source_text_preview: trimPromptSnippet(item?.text_original || "", 90),
          target_text_preview: trimPromptSnippet(item?.text_translate || "", 110),
        });
      }
      continue;
    }
    seen.add(key);
    dedupedRows.push(item);
  }

  return {
    dedupedRows,
    duplicateRowsRemoved,
    uniquePairCount: seen.size,
    duplicateExamples,
  };
}

async function refreshApprovedSemanticIndex({
  approvedOnly = true,
  requireExplicitApproval = false,
  includeHighQualityFallback = true,
  minConfidence = 0.8,
  limit = 5000,
  embeddingProviderPayload = {},
} = {}) {
  const providerSetting = await resolveEmbeddingProviderSetting(
    embeddingProviderPayload,
  );
  if (!providerSetting) {
    return {
      ok: false,
      error: "Provider embedding dengan capability `embed` belum tersedia.",
    };
  }

  const candidates = await listLearningDatasetCandidates({
    approvedOnly,
    requireExplicitApproval,
    includeHighQualityFallback,
    minConfidence,
    limit,
  });
  let indexed = 0;
  let skipped = 0;
  let modelName = null;

  for (const item of candidates) {
    const sourceText = String(item?.text_original || "").trim();
    const translatedText = String(item?.text_translate || "").trim();
    if (!sourceText || !translatedText) {
      skipped += 1;
      continue;
    }
    const memory = await upsertTranslationMemoryEntry({
      idKitab: item?.id_kitab || null,
      sourceText,
      translatedText,
      fileName: item?.file_name || null,
      sourceLang: "ar",
      targetLang: "id",
      provider: item?.approval_status === "approved" ? "approved_export" : "learning_refresh",
      qualityScore: item?.confidence_score == null ? 1 : Number(item.confidence_score),
    });
    if (!memory?.id) {
      skipped += 1;
      continue;
    }
    const result = await indexTranslationMemorySemantics({
      providerSetting,
      idKitab: item?.id_kitab || null,
      sourceLang: "ar",
      targetLang: "id",
      sourceText,
      memoryId: memory.id,
      limit: 1,
    });
    if (result?.ok) {
      indexed += Number(result.indexed || 0);
      modelName = result.modelName || modelName;
    } else {
      skipped += 1;
    }
  }

  return {
    ok: true,
    provider: providerSetting.provider || null,
    model: modelName || null,
    candidateCount: candidates.length,
    indexedCount: indexed,
    skippedCount: skipped,
    minConfidence,
    approvedOnly,
    requireExplicitApproval,
    includeHighQualityFallback,
  };
}

async function previewLearningCandidates({
  approvedOnly = true,
  requireExplicitApproval = false,
  includeHighQualityFallback = true,
  minConfidence = 0.8,
  limit = 5000,
} = {}) {
  const candidates = await listLearningDatasetCandidates({
    approvedOnly,
    requireExplicitApproval,
    includeHighQualityFallback,
    minConfidence,
    limit,
  });
  const dedupInfo = deduplicateLearningDatasetRows(candidates);
  const summary = {
    candidateCount: candidates.length,
    uniquePairCount: dedupInfo.uniquePairCount,
    duplicateRowsRemoved: dedupInfo.duplicateRowsRemoved,
    approvedCount: 0,
    confirmedCount: 0,
    highQualityManualCount: 0,
    kitabCount: 0,
    averageConfidence: 0,
    highConfidenceCount: 0,
    mediumConfidenceCount: 0,
    lowConfidenceCount: 0,
    unknownConfidenceCount: 0,
    minConfidence: Math.max(0, Math.min(1, Number(minConfidence) || 0)),
    approvedOnly: !!approvedOnly,
    requireExplicitApproval: !!requireExplicitApproval,
    includeHighQualityFallback: !!includeHighQualityFallback,
    limit: Math.max(1, Math.min(Number(limit) || 5000, 20000)),
  };
  const kitabStats = new Map();
  const sourceLabelStats = {};
  let confidenceTotal = 0;
  let confidenceCount = 0;

  for (const item of candidates) {
    const approvalStatus = String(item?.approval_status || "unqualified");
    if (approvalStatus === "approved") summary.approvedCount += 1;
    else if (approvalStatus === "confirmed") summary.confirmedCount += 1;
    else if (approvalStatus === "high_quality_manual") {
      summary.highQualityManualCount += 1;
    }
    const confidence = Number(item?.confidence_score);
    if (Number.isFinite(confidence)) {
      confidenceTotal += confidence;
      confidenceCount += 1;
      if (confidence >= 0.95) summary.highConfidenceCount += 1;
      else if (confidence >= 0.85) summary.mediumConfidenceCount += 1;
      else summary.lowConfidenceCount += 1;
    } else {
      summary.unknownConfidenceCount += 1;
    }
    const sourceLabel = String(item?.source_label || "unknown");
    sourceLabelStats[sourceLabel] = Number(sourceLabelStats[sourceLabel] || 0) + 1;
    const kitabKey = String(item?.id_kitab ?? "none");
    if (!kitabStats.has(kitabKey)) {
      kitabStats.set(kitabKey, {
        id_kitab: item?.id_kitab ?? null,
        nama_kitab: item?.nama_kitab || "Tanpa Kitab",
        count: 0,
      });
    }
    kitabStats.get(kitabKey).count += 1;
  }

  summary.kitabCount = kitabStats.size;
  summary.averageConfidence =
    confidenceCount > 0 ? confidenceTotal / confidenceCount : 0;

  return {
    ok: true,
    summary,
    duplicateExamples: dedupInfo.duplicateExamples,
    topSourceLabels: Object.entries(sourceLabelStats)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return String(a.label || "").localeCompare(String(b.label || ""));
      })
      .slice(0, 5),
    topKitabs: Array.from(kitabStats.values())
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return String(a.nama_kitab || "").localeCompare(String(b.nama_kitab || ""));
      })
      .slice(0, 5),
    samples: candidates.slice(0, 8).map((item) => ({
      translation_id: Number(item.translation_id || 0),
      id_kitab: item.id_kitab == null ? null : Number(item.id_kitab),
      nama_kitab: item.nama_kitab || null,
      file_name: item.file_name || null,
      confidence_score:
        item.confidence_score == null ? null : Number(item.confidence_score),
      approval_status: item.approval_status || "unqualified",
      source_label: item.source_label || null,
      feedback_count: Number(item.feedback_count || 0),
      text_original_preview: trimPromptSnippet(item.text_original || "", 120),
      text_translate_preview: trimPromptSnippet(item.text_translate || "", 140),
    })),
  };
}

function buildGlobalStyleRules({
  topKitabs = [],
  averageConfidence = 0,
  averageTargetLength = 0,
  averageSourceLength = 0,
  scopeType = "global",
} = {}) {
  const rules = [
    "Gunakan bahasa Indonesia yang natural, religius, dan akrab dengan tradisi pesantren.",
    "Pertahankan urutan makna dan alur logika teks Arab tanpa menambah tafsir baru.",
    "Hindari istilah akademik modern bila tidak tersurat jelas dalam teks sumber.",
    "Pertahankan nuansa doa, penghormatan ulama, dan ungkapan sufistik secara wajar.",
    "Jika ada istilah Arab yang sudah mapan di pesantren, pertahankan bentuk serapan yang umum.",
    "Utamakan kalimat yang mengalir dan mudah dibaca, tetapi jangan meringkas isi.",
  ];
  if (scopeType === "global" && topKitabs.length > 1) {
    rules.push(
      "Jaga gaya tetap cukup netral lintas kitab, jangan terlalu meniru idiom satu kitab tertentu.",
    );
  } else if (scopeType === "kitab") {
    rules.push(
      "Pertahankan ciri khas kitab ini secara konsisten, tetapi tetap gunakan bahasa Indonesia yang wajar.",
    );
  }
  if (averageSourceLength > 0 && averageTargetLength / averageSourceLength >= 1.1) {
    rules.push(
      "Gunakan kalimat Indonesia yang utuh dan sedikit elaboratif, tetapi tetap setia pada makna sumber.",
    );
  } else {
    rules.push("Pilih terjemahan yang padat dan langsung selama makna tetap lengkap.");
  }
  if (averageConfidence >= 0.95) {
    rules.push("Pertahankan konsistensi istilah dan ritme kalimat karena corpus sumber sangat stabil.");
  }
  return rules.slice(0, 8);
}

function computeStyleCandidateWeight(item, useQualityWeighting = true) {
  const approvalStatus = String(item?.approval_status || "unqualified");
  const sourceLabel = String(item?.source_label || "").toLowerCase();
  const confidence = Number(item?.confidence_score);
  const feedbackCount = Math.max(0, Number(item?.feedback_count || 0));
  if (!useQualityWeighting) {
    return {
      weight: 1,
      reasons: ["uniform_weighting"],
    };
  }
  let weight = 0;
  const reasons = [];
  if (approvalStatus === "approved") {
    weight += 5;
    reasons.push("approved:+5");
  } else if (approvalStatus === "confirmed") {
    weight += 3;
    reasons.push("reviewed:+3");
  } else if (approvalStatus === "high_quality_manual") {
    weight += 4;
    reasons.push("manual_high_quality:+4");
  } else if (approvalStatus === "rejected") {
    weight -= 5;
    reasons.push("rejected:-5");
  }
  if (sourceLabel.startsWith("manual")) {
    weight += 1;
    reasons.push("manual_source:+1");
  } else if (sourceLabel.includes("accepted")) {
    weight += 0.5;
    reasons.push("accepted:+0.5");
  }
  if (Number.isFinite(confidence)) {
    const confidenceBonus = Math.max(0, Math.min(2, (confidence - 0.8) * 10));
    weight += confidenceBonus;
    reasons.push(`confidence:+${confidenceBonus.toFixed(2)}`);
  }
  if (feedbackCount > 0) {
    const feedbackBonus = Math.min(1.5, feedbackCount * 0.25);
    weight += feedbackBonus;
    reasons.push(`feedback:+${feedbackBonus.toFixed(2)}`);
  }
  return {
    weight: Number(weight.toFixed(4)),
    reasons,
  };
}

function rankStyleCandidates(rows, useQualityWeighting = true) {
  return (Array.isArray(rows) ? rows : [])
    .map((item, index) => {
      const quality = computeStyleCandidateWeight(item, useQualityWeighting);
      return {
        ...item,
        quality_weight: quality.weight,
        quality_reasons: quality.reasons,
        original_rank: index + 1,
      };
    })
    .sort((a, b) => {
      if (b.quality_weight !== a.quality_weight) {
        return b.quality_weight - a.quality_weight;
      }
      const confidenceA = Number(a?.confidence_score);
      const confidenceB = Number(b?.confidence_score);
      if (Number.isFinite(confidenceB) && Number.isFinite(confidenceA) && confidenceB !== confidenceA) {
        return confidenceB - confidenceA;
      }
      const feedbackA = Number(a?.feedback_count || 0);
      const feedbackB = Number(b?.feedback_count || 0);
      if (feedbackB !== feedbackA) return feedbackB - feedbackA;
      return (a.original_rank || 0) - (b.original_rank || 0);
    });
}

const STYLE_CLUSTER_DEFINITIONS = [
  {
    key: "manaqib",
    label: "Manaqib",
    keywords: ["manaqib", "manaqib", "manakib", "wali", "karamah"],
  },
  {
    key: "tasawuf",
    label: "Tasawuf",
    keywords: ["tasawuf", "sufi", "tarekat", "thariq", "dzikir", "maqam"],
  },
  {
    key: "fiqih",
    label: "Fiqih",
    keywords: ["fiqih", "fikih", "thaharah", "shalat", "zakat", "nikah", "jual beli"],
  },
  {
    key: "biografi_ulama",
    label: "Biografi Ulama",
    keywords: ["biografi", "tarjamah", "sirah", "riwayat", "ulama", "syekh"],
  },
  {
    key: "matan_ringkas",
    label: "Matan Ringkas",
    keywords: ["matan", "mukhtashar", "ringkas", "nadham", "taqrib"],
  },
];

function parseLockedRulesText(rawText) {
  return Array.from(
    new Set(
      String(rawText || "")
        .split(/\r?\n/)
        .map((line) => String(line || "").replace(/^\s*[-*]\s*/, "").trim())
        .filter(Boolean),
    ),
  );
}

function getStyleClusterDefinition(clusterKey) {
  const normalized = String(clusterKey || "").trim().toLowerCase();
  return STYLE_CLUSTER_DEFINITIONS.find((item) => item.key === normalized) || null;
}

function inferStyleClusterKey({
  kitabName = "",
  authorName = "",
  folderPath = "",
  sourceText = "",
  extraPrompt = "",
} = {}) {
  const haystack = [
    kitabName,
    authorName,
    folderPath,
    trimPromptSnippet(sourceText, 240),
    extraPrompt,
  ]
    .join(" ")
    .toLowerCase();
  let best = null;
  for (const cluster of STYLE_CLUSTER_DEFINITIONS) {
    let score = 0;
    for (const keyword of cluster.keywords) {
      if (haystack.includes(String(keyword).toLowerCase())) score += 1;
    }
    if (!best || score > best.score) best = { key: cluster.key, score };
  }
  return best && best.score > 0 ? best.key : null;
}

function filterStyleCandidatesByCluster(rows, clusterKey) {
  const cluster = getStyleClusterDefinition(clusterKey);
  if (!cluster) return [];
  return (Array.isArray(rows) ? rows : []).filter((item) => {
    const inferred = inferStyleClusterKey({
      kitabName: item?.nama_kitab || "",
      authorName: item?.pengarang || "",
      folderPath: item?.file_name || "",
      sourceText: item?.text_original || "",
    });
    return inferred === cluster.key;
  });
}

async function buildStyleProfileDraft(rawOptions = {}) {
  const settings = normalizeTranslationStyleMemorySettings(rawOptions);
  const scopeType = String(rawOptions?.scopeType || "global").trim() || "global";
  const scopeKey =
    rawOptions?.scopeKey == null || rawOptions?.scopeKey === ""
      ? null
      : String(rawOptions.scopeKey);
  const normalizedIdKitab =
    scopeType === "kitab" && Number.isFinite(Number(scopeKey)) && Number(scopeKey) > 0
      ? Number(scopeKey)
      : null;
  const clusterKey =
    scopeType === "global_cluster"
      ? String(rawOptions?.clusterKey || scopeKey || "").trim().toLowerCase()
      : "";
  const clusterDef = clusterKey ? getStyleClusterDefinition(clusterKey) : null;
  let scopeLabel = String(rawOptions?.scopeLabel || "").trim() || null;
  if (scopeType === "kitab" && normalizedIdKitab && !scopeLabel) {
    const kitab = await getKitabDetailById(normalizedIdKitab);
    scopeLabel = kitab?.nama_kitab || `Kitab ${normalizedIdKitab}`;
  } else if (scopeType === "global_cluster" && !scopeLabel) {
    scopeLabel = clusterDef?.label || clusterKey || "Cluster";
  }
  const candidates = await listLearningDatasetCandidates({
    approvedOnly: settings.approvedOnly,
    requireExplicitApproval: settings.requireExplicitApproval,
    includeHighQualityFallback: settings.includeHighQualityFallback,
    minConfidence: settings.minConfidence,
    limit: settings.limit,
    idKitab: normalizedIdKitab,
  });
  const filteredCandidates =
    scopeType === "global_cluster"
      ? filterStyleCandidatesByCluster(candidates, clusterKey)
      : candidates;
  const dedupInfo = deduplicateLearningDatasetRows(filteredCandidates);
  const rows = rankStyleCandidates(
    dedupInfo.dedupedRows,
    settings.useQualityWeighting,
  );
  const lockedRules = parseLockedRulesText(settings.lockedRulesText);
  if (rows.length < settings.minSamples) {
    const scopeDescription =
      scopeType === "kitab"
        ? `Sample approved kitab ${scopeLabel || scopeKey || "-"}`
        : scopeType === "global_cluster"
          ? `Sample approved cluster ${scopeLabel || clusterKey || "-"}`
          : "Sample approved";
    return {
      ok: false,
      error: `${scopeDescription} belum cukup. Minimal ${settings.minSamples}, tersedia ${rows.length}.`,
      candidateCount: filteredCandidates.length,
      usableCount: rows.length,
      minSamples: settings.minSamples,
    };
  }

  const kitabStats = new Map();
  let totalConfidence = 0;
  let confidenceCount = 0;
  let totalSourceLength = 0;
  let totalTargetLength = 0;
  let totalWeight = 0;

  for (const item of rows) {
    const kitabKey = String(item?.id_kitab ?? "none");
    if (!kitabStats.has(kitabKey)) {
      kitabStats.set(kitabKey, {
        id_kitab: item?.id_kitab ?? null,
        nama_kitab: item?.nama_kitab || "Tanpa Kitab",
        count: 0,
        weighted_count: 0,
      });
    }
    kitabStats.get(kitabKey).count += 1;
    kitabStats.get(kitabKey).weighted_count += Number(item?.quality_weight || 0);
    const confidence = Number(item?.confidence_score);
    if (Number.isFinite(confidence)) {
      const weight = Math.max(1, Number(item?.quality_weight || 1));
      totalConfidence += confidence * weight;
      confidenceCount += weight;
    }
    totalSourceLength += String(item?.text_original || "").trim().length;
    totalTargetLength += String(item?.text_translate || "").trim().length;
    totalWeight += Math.max(1, Number(item?.quality_weight || 1));
  }

  const topKitabs = Array.from(kitabStats.values())
    .sort((a, b) => {
      if (b.weighted_count !== a.weighted_count) {
        return b.weighted_count - a.weighted_count;
      }
      if (b.count !== a.count) return b.count - a.count;
      return String(a.nama_kitab || "").localeCompare(String(b.nama_kitab || ""));
    })
    .slice(0, 3);
  const averageConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0;
  const averageSourceLength = rows.length > 0 ? totalSourceLength / rows.length : 0;
  const averageTargetLength = rows.length > 0 ? totalTargetLength / rows.length : 0;
  const adaptiveRules = buildGlobalStyleRules({
    topKitabs,
    averageConfidence,
    averageSourceLength,
    averageTargetLength,
    scopeType,
  });
  const rules = [...lockedRules, ...adaptiveRules];
  const summaryLines =
    scopeType === "kitab"
      ? [
          `Profile kitab ini diringkas dari ${rows.length} sampel approved berkualitas tinggi untuk ${scopeLabel || `Kitab ${scopeKey || "-"}`}.`,
          "Gunakan profile ini sebagai prioritas utama untuk request translate yang berasal dari kitab ini.",
          `Rata-rata confidence sumber: ${(averageConfidence * 100).toFixed(1)}%.`,
          settings.useQualityWeighting
            ? "Profile ini memakai ranking quality-weighted untuk memilih sampel terbaik."
            : "Profile ini memakai ranking seragam tanpa quality weighting.",
        ]
      : scopeType === "global_cluster"
        ? [
            `Profile cluster global ini diringkas dari ${rows.length} sampel approved berkualitas tinggi untuk cluster ${scopeLabel || clusterKey || "-"}.`,
            "Gunakan profile ini sebagai fallback sebelum global default bila cluster request berhasil dikenali.",
            `Rata-rata confidence sumber: ${(averageConfidence * 100).toFixed(1)}%.`,
            settings.useQualityWeighting
              ? "Profile cluster ini memakai ranking quality-weighted."
              : "Profile cluster ini memakai ranking seragam tanpa quality weighting.",
          ]
      : [
          `Profile global ini diringkas dari ${rows.length} sampel approved berkualitas tinggi lintas ${kitabStats.size} kitab.`,
          "Gunakan profile ini sebagai fallback saat kitab belum punya style profile sendiri.",
          `Rata-rata confidence sumber: ${(averageConfidence * 100).toFixed(1)}%.`,
          settings.useQualityWeighting
            ? "Profile ini memakai ranking quality-weighted untuk menjaga sampel terbaik lebih dominan."
            : "Profile ini memakai ranking seragam tanpa quality weighting.",
        ];
  if (scopeType === "global" && topKitabs.length > 0) {
    summaryLines.push(
      `Kitab dominan: ${topKitabs
        .map((item) => `${item.nama_kitab} (${item.count})`)
        .join(", ")}.`,
    );
  }
  if (scopeType === "kitab" && scopeLabel) {
    summaryLines.push(`Kitab target: ${scopeLabel}.`);
  }
  if (scopeType === "global_cluster" && scopeLabel) {
    summaryLines.push(`Cluster target: ${scopeLabel}.`);
  }
  const summaryText = `${summaryLines.join(" ")}\n\n${rules
    .map((rule) => `- ${rule}`)
    .join("\n")}`;

  return {
    ok: true,
    draft: {
      scopeType,
      scopeKey,
      sourceLang: "ar",
      targetLang: "id",
      profileName:
        scopeType === "kitab"
          ? `Kitab Style Profile - ${scopeLabel || scopeKey || "Unknown"}`
          : scopeType === "global_cluster"
            ? `Global Cluster Style - ${scopeLabel || clusterKey || "Unknown"}`
            : "Global Style Profile",
      summaryText,
      rules,
      sampleCount: rows.length,
      sourcePolicy: {
        approvedOnly: settings.approvedOnly,
        requireExplicitApproval: settings.requireExplicitApproval,
        includeHighQualityFallback: settings.includeHighQualityFallback,
        useQualityWeighting: settings.useQualityWeighting,
        includeRepresentativeSamples: settings.includeRepresentativeSamples,
        representativeSampleCount: settings.representativeSampleCount,
        lockedRulesText: settings.lockedRulesText,
        enableClusterFallback: settings.enableClusterFallback,
        clusterStrategy: settings.clusterStrategy,
        defaultClusterKey: settings.defaultClusterKey,
        minConfidence: settings.minConfidence,
        limit: settings.limit,
        minSamples: settings.minSamples,
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        scopeLabel,
        clusterKey: clusterKey || null,
        clusterLabel: clusterDef?.label || scopeLabel || null,
        candidateCount: filteredCandidates.length,
        usableCount: rows.length,
        duplicateRowsRemoved: dedupInfo.duplicateRowsRemoved,
        kitabCount: kitabStats.size,
        totalWeight,
        averageConfidence,
        averageSourceLength,
        averageTargetLength,
        topKitabs,
        lockedRules,
        adaptiveRules,
        weighting: {
          enabled: !!settings.useQualityWeighting,
          topWeightedCandidates: rows.slice(0, 5).map((item) => ({
            translation_id: Number(item.translation_id || 0),
            kitab_name: item.nama_kitab || null,
            quality_weight: Number(item.quality_weight || 0),
            quality_reasons: Array.isArray(item.quality_reasons)
              ? item.quality_reasons
              : [],
          })),
        },
        representativeSamples: rows
          .slice(0, Math.max(5, settings.representativeSampleCount))
          .map((item) => ({
          translation_id: Number(item.translation_id || 0),
          kitab_name: item.nama_kitab || null,
          file_name: item.file_name || null,
          quality_weight: Number(item.quality_weight || 0),
          quality_reasons: Array.isArray(item.quality_reasons)
            ? item.quality_reasons
            : [],
          source_preview: trimPromptSnippet(item.text_original || "", 120),
          target_preview: trimPromptSnippet(item.text_translate || "", 140),
        })),
      },
    },
  };
}

async function buildSemanticRetrievalContext({
  payload,
  kitabName,
  folderPath,
  sourceText,
  sourceLang = "ar",
  targetLang = "id",
  idKitab = null,
  sourceContext = null,
}) {
  const tuning = getSemanticTuningSettings();
  const providerSetting = await resolveEmbeddingProviderSetting(payload);
  if (!providerSetting) {
    return {
      semanticExamples: [],
      semanticSourceUnits: [],
      semanticMeta: {
        enabled: false,
        provider: null,
        model: null,
        indexedCount: 0,
        exampleCount: 0,
        tmIndexedCount: 0,
        tmExampleCount: 0,
        sourceUnitIndexedCount: 0,
        sourceUnitCount: 0,
        tmThreshold: tuning.tmSimilarityThreshold,
        sourceUnitThreshold: tuning.sourceUnitSimilarityThreshold,
        maxTmExamples: tuning.maxTmExamples,
        maxSourceUnitExamples: tuning.maxSourceUnitExamples,
      },
    };
  }

  let queryEmbedding = await embedTextWithProvider(providerSetting, sourceText);
  if (!queryEmbedding.ok) {
    return {
      semanticExamples: [],
      semanticSourceUnits: [],
      semanticMeta: {
        enabled: false,
        provider: providerSetting.provider || null,
        model: null,
        indexedCount: 0,
        exampleCount: 0,
        tmIndexedCount: 0,
        tmExampleCount: 0,
        sourceUnitIndexedCount: 0,
        sourceUnitCount: 0,
        tmThreshold: tuning.tmSimilarityThreshold,
        sourceUnitThreshold: tuning.sourceUnitSimilarityThreshold,
        maxTmExamples: tuning.maxTmExamples,
        maxSourceUnitExamples: tuning.maxSourceUnitExamples,
        error: queryEmbedding.error || "query_embedding_failed",
      },
    };
  }

  const tmIndexed = await indexTranslationMemorySemantics({
    providerSetting,
    idKitab,
    sourceLang,
    targetLang,
    sourceText,
    limit: 18,
  });
  const sourceUnitIndexed = await indexSourceUnitSemantics({
    providerSetting,
    sourceContext,
    sourceLang,
    targetLang,
    limit: 48,
  });
  const modelName =
    queryEmbedding.modelName ||
    tmIndexed.modelName ||
    sourceUnitIndexed.modelName ||
    null;
  const semanticRows = modelName
    ? await listSemanticTranslationMemoryExamples({
        idKitab,
        sourceLang,
        targetLang,
        modelName,
        excludeNormalizedText: sourceText,
        limit: 60,
      })
    : [];
  const semanticSourceUnitRows =
    modelName && sourceContext?.current && (sourceContext?.idKitab || idKitab)
      ? await listSemanticSourceUnitExamples({
          idKitab: sourceContext?.idKitab || idKitab,
          folderPath:
            sourceContext?.current?.folder_path || folderPath || null,
          sourceLang,
          targetLang,
          unitType: "segment",
          modelName,
          excludeUnitId: sourceContext?.current?.id || null,
          currentPageNumber: sourceContext?.current?.page_number ?? null,
          currentFileName: sourceContext?.current?.file_name || null,
          limit: 80,
        })
      : [];

  const semanticExamples = (semanticRows || [])
    .map((row) => ({
      ...row,
      similarity_score: computeCosineSimilarity(queryEmbedding.vector, row.semantic_vector),
      ranking_score:
        computeCosineSimilarity(queryEmbedding.vector, row.semantic_vector) +
        (Number(row.feedback_boost || 0) / 1000) +
        (Number(row.has_explicit_approval || 0) === 1 ? 0.04 : 0) +
        (Number(row.has_review_signal || 0) === 1 ? 0.02 : 0) -
        (Number(row.has_rejection || 0) === 1 ? 0.06 : 0),
    }))
    .filter(
      (row) =>
        row.similarity_score >= tuning.tmSimilarityThreshold &&
        String(row.text_translate || "").trim() &&
        String(row.text_original || "").trim(),
    )
    .sort((a, b) => {
      if (b.ranking_score !== a.ranking_score) {
        return b.ranking_score - a.ranking_score;
      }
      if (b.similarity_score !== a.similarity_score) {
        return b.similarity_score - a.similarity_score;
      }
      return (Number(b.usage_count || 0) - Number(a.usage_count || 0));
    })
    .slice(0, tuning.maxTmExamples);
  const semanticSourceUnits = (semanticSourceUnitRows || [])
    .map((row) => ({
      ...row,
      similarity_score: computeCosineSimilarity(queryEmbedding.vector, row.semantic_vector),
      ranking_score:
        computeCosineSimilarity(queryEmbedding.vector, row.semantic_vector) +
        (Number(row.folder_rank || 0) === 0 ? 0.03 : 0) +
        (Number(row.file_rank || 0) === 0 ? 0.02 : 0) -
        Math.min(Number(row.page_gap || 0), 50) * 0.0004,
    }))
    .filter(
      (row) =>
        row.similarity_score >= tuning.sourceUnitSimilarityThreshold &&
        String(row.source_text || "").trim() &&
        Number(row.id || 0) !== Number(sourceContext?.current?.id || 0),
    )
    .sort((a, b) => {
      if (b.ranking_score !== a.ranking_score) {
        return b.ranking_score - a.ranking_score;
      }
      if (b.similarity_score !== a.similarity_score) {
        return b.similarity_score - a.similarity_score;
      }
      if ((Number(a.page_gap || 0)) !== (Number(b.page_gap || 0))) {
        return Number(a.page_gap || 0) - Number(b.page_gap || 0);
      }
      return Number(a.segment_order || 0) - Number(b.segment_order || 0);
    })
    .slice(0, tuning.maxSourceUnitExamples);

  return {
    semanticExamples,
    semanticSourceUnits,
    semanticMeta: {
      enabled: true,
      provider: providerSetting.provider || null,
      model: modelName,
      indexedCount:
        Number(tmIndexed?.indexed || 0) + Number(sourceUnitIndexed?.indexed || 0),
      exampleCount: semanticExamples.length + semanticSourceUnits.length,
      tmIndexedCount: Number(tmIndexed?.indexed || 0),
      tmExampleCount: semanticExamples.length,
      sourceUnitIndexedCount: Number(sourceUnitIndexed?.indexed || 0),
      sourceUnitCount: semanticSourceUnits.length,
      tmThreshold: tuning.tmSimilarityThreshold,
      sourceUnitThreshold: tuning.sourceUnitSimilarityThreshold,
      maxTmExamples: tuning.maxTmExamples,
      maxSourceUnitExamples: tuning.maxSourceUnitExamples,
    },
  };
}

ipcMain.handle("translate-ai", async (event, payload) => {
  const text = payload && typeof payload.text === "string" ? payload.text : "";
  const target =
    payload && typeof payload.target === "string" ? payload.target : "id";
  const model =
    payload && typeof payload.model === "string" ? payload.model : "";
  const extraPrompt =
    payload && typeof payload.prompt === "string" ? payload.prompt : "";
  const fileName =
    payload && typeof payload.fileName === "string" ? payload.fileName : "";
  const page = payload && typeof payload.page === "string" ? payload.page : "";
  const filePath =
    payload && typeof payload.filePath === "string" ? payload.filePath : "";
  const folderPath =
    payload && typeof payload.folderPath === "string" ? payload.folderPath : "";
  const win = event ? BrowserWindow.fromWebContents(event.sender) : null;
  const windowId = win ? win.id : null;
  const webContentsId = event && event.sender ? event.sender.id : null;

  if (!text) return { ok: false, error: "Input text is empty." };

  translateQueueCount += 1;
  if (translateState.running) {
    sendToAllWindows("translate-status", {
      ...translateState,
      queueLength: Math.max(0, translateQueueCount - 1),
    });
  }

  const jobId = (translateJobSeq += 1);
  const release = await acquireTranslateSlot();

  try {
    translateState = {
      running: true,
      provider: String(payload?.provider || "").trim().toLowerCase() || null,
      model: String(model || "").trim() || null,
      attempt: 0,
      startedAt: Date.now(),
      textLength: text.length,
      jobId,
      queueLength: Math.max(0, translateQueueCount - 1),
      fileName: fileName || null,
      page: page || null,
      filePath: filePath || null,
      folderPath: folderPath || null,
      windowId,
      webContentsId,
      stage: "preparing",
      stageLabel: "Memulai proses terjemahan",
      stageDetail: "Sistem sedang menyiapkan proses terjemahan.",
    };
    pushTranslateStatus();

    const status = getDbStatus();
    pushTranslateStatus({
      stage: "checking_database",
      stageLabel: "Mengecek database",
      stageDetail: "Mencari apakah terjemahan yang sama sudah pernah disimpan.",
    });
    if (!status.ok) await initMySql();

    const targetCode = String(target || "id")
      .trim()
      .toLowerCase();
    const kitabName = folderPath ? path.basename(folderPath) : "";
    pushTranslateStatus({
      stage: "loading_reference",
      stageLabel: "Menyiapkan referensi terjemahan",
      stageDetail: "Mengambil glossary dan contoh terjemahan yang mirip dari database.",
    });
    const assistContext = await getTranslationAssistContext({
      kitabName,
      folderPath,
      originalText: text,
      sourceLang: "ar",
      targetLang: targetCode || "id",
    });
    pushTranslateStatus({
      stage: "loading_context",
      stageLabel: "Menyiapkan konteks halaman",
      stageDetail: "Mengecek potongan sebelum dan sesudah agar hasil lebih tepat.",
    });
    const sourceContext = await getSourceUnitContext({
      kitabName,
      folderPath,
      fileName,
      filePath,
      originalText: text,
      pageNumber: page,
    });
    pushTranslateStatus({
      stage: "semantic_search",
      stageLabel: "Mencari contoh yang paling mirip",
      stageDetail: "Sistem membandingkan dengan data lama untuk menjaga konsistensi terjemahan.",
    });
    const semanticContext = await buildSemanticRetrievalContext({
      payload,
      kitabName,
      folderPath,
      sourceText: text,
      sourceLang: "ar",
      targetLang: targetCode || "id",
      idKitab: assistContext?.idKitab || null,
      sourceContext,
    });
    const styleSettings = getTranslationStyleMemorySettings();
    let activeStyleProfile = null;
    let inferredClusterKey = null;
    if (styleSettings.useGlobalStyleInTranslate) {
      const kitabStyleProfile =
        assistContext?.idKitab != null
          ? await getActiveTranslationStyleProfile({
              scopeType: "kitab",
              scopeKey: String(assistContext.idKitab),
              sourceLang: "ar",
              targetLang: targetCode || "id",
            })
          : null;
      if (!kitabStyleProfile && styleSettings.enableClusterFallback) {
        inferredClusterKey =
          styleSettings.clusterStrategy === "manual" &&
          styleSettings.defaultClusterKey
            ? styleSettings.defaultClusterKey
            : inferStyleClusterKey({
                kitabName,
                authorName: "",
                folderPath,
                sourceText: text,
                extraPrompt,
              });
      }
      const clusterStyleProfile =
        !kitabStyleProfile && inferredClusterKey
          ? await getActiveTranslationStyleProfile({
              scopeType: "global_cluster",
              scopeKey: inferredClusterKey,
              sourceLang: "ar",
              targetLang: targetCode || "id",
            })
          : null;
      activeStyleProfile =
        kitabStyleProfile ||
        clusterStyleProfile ||
        (await getActiveTranslationStyleProfile({
          scopeType: "global",
          sourceLang: "ar",
          targetLang: targetCode || "id",
        }));
    }
    const supportContext = buildTranslateSupportContext(
      assistContext,
      sourceContext,
      semanticContext,
      activeStyleProfile,
    );
    const contextMeta = {
      glossaryCount: Array.isArray(assistContext?.glossaryHits) ? assistContext.glossaryHits.length : 0,
      similarCount: Array.isArray(assistContext?.tmHits?.similar) ? assistContext.tmHits.similar.length : 0,
      substringCount: Array.isArray(assistContext?.tmHits?.substring) ? assistContext.tmHits.substring.length : 0,
      semanticCount: Array.isArray(semanticContext?.semanticExamples)
        ? semanticContext.semanticExamples.length
        : 0,
      semanticSourceUnitCount: Array.isArray(semanticContext?.semanticSourceUnits)
        ? semanticContext.semanticSourceUnits.length
        : 0,
      semanticEnabled: !!semanticContext?.semanticMeta?.enabled,
      semanticProvider: semanticContext?.semanticMeta?.provider || null,
      semanticModel: semanticContext?.semanticMeta?.model || null,
      exactSource: assistContext?.tmHits?.exact?.source_table || null,
      hasPrevContext: !!sourceContext?.prev,
      hasCurrentContext: !!sourceContext?.current,
      hasNextContext: !!sourceContext?.next,
      styleProfileEnabled: !!styleSettings.useGlobalStyleInTranslate,
      inferredClusterKey,
      styleProfileScope: activeStyleProfile?.scope_type || null,
      styleProfileScopeKey: activeStyleProfile?.scope_key || null,
      styleProfileVersion: activeStyleProfile?.version_number ?? null,
      styleProfileSampleCount: activeStyleProfile?.sample_count ?? null,
      currentPage: sourceContext?.current?.page_number ?? null,
      semantic: buildSemanticObservabilityPayload(semanticContext),
      promptTrace: null,
    };
    const hasAnyTmAssist =
      !!assistContext?.tmHits?.exact ||
      (Array.isArray(assistContext?.tmHits?.similar) && assistContext.tmHits.similar.length > 0) ||
      (Array.isArray(assistContext?.tmHits?.substring) && assistContext.tmHits.substring.length > 0);
    const exactMatch = assistContext?.tmHits?.exact;
    try {
      await recordTranslationRuntimeMetric({
        requestCount: 1,
        exactHitCount: exactMatch ? 1 : 0,
        tmReuseCount: hasAnyTmAssist ? 1 : 0,
        aiGenerationCount: exactMatch ? 0 : 1,
      });
    } catch (metricError) {
      console.warn("Failed to record translation runtime metric:", metricError);
    }
    if (exactMatch && String(exactMatch.text_translate || "").trim()) {
      contextMeta.promptTrace = buildPromptObservabilityPayload({
        aiCalled: false,
        skipReason: "AI tidak dipanggil karena exact translation memory ditemukan.",
        provider: "translation-memory",
      });
      pushTranslateStatus({
        stage: "reuse_exact",
        stageLabel: "Terjemahan ditemukan di database",
        stageDetail: "Sistem memakai hasil yang sudah ada, jadi AI tidak perlu dipanggil.",
        provider: "translation-memory",
        model: null,
      });
      const confidence = evaluateTranslationConfidence({
        sourceText: text,
        translatedText: exactMatch.text_translate,
        sourceLabel: exactMatch.source_table === "translation_memory" ? "tm_exact" : "legacy_exact",
      });
      if (exactMatch.source_table === "translation_memory" && exactMatch.id) {
        try {
          await markTranslationMemoryUsed(exactMatch.id);
        } catch (_) {}
      }
      sendToAllWindows("translate-complete", {
        ok: true,
        provider: "translation-memory",
        model: null,
        reused: true,
      });
      return {
        ok: true,
        output: exactMatch.text_translate,
        provider: "translation-memory",
        providerId: null,
        model: null,
        target: targetCode || "id",
        reused: true,
        context: contextMeta,
        confidence,
      };
    }

    pushTranslateStatus({
      stage: "preparing_ai",
      stageLabel: "Tidak ada terjemahan langsung",
      stageDetail: "Sistem akan menyiapkan permintaan ke AI dengan referensi yang sudah ditemukan.",
    });
    const providerSetting = await resolveTranslateProviderSetting(payload);
    const providerKey = String(providerSetting?.provider || payload?.provider || "")
      .trim()
      .toLowerCase();
    if (!providerSetting || !providerKey) {
      return { ok: false, error: "Provider translate tidak ditemukan." };
    }
    if (!providerSetting.api_key) {
      return {
        ok: false,
        error: `API key untuk provider "${providerSetting.name || providerKey}" tidak ditemukan.`,
      };
    }

    const meta = providerSetting.meta && typeof providerSetting.meta === "object" ? providerSetting.meta : {};
    const protocol = String(meta.protocol || providerKey).trim().toLowerCase();

    if (protocol === "openai") {
      const chosenModel =
        String(model || "").trim() ||
        String(providerSetting.model_default || "").trim() ||
        "gpt-4o-mini";

      translateState = {
        running: true,
        provider: providerKey,
        model: chosenModel,
        attempt: 1,
        startedAt: Date.now(),
        textLength: text.length,
        jobId,
        queueLength: Math.max(0, translateQueueCount - 1),
        fileName: fileName || null,
        page: page || null,
        filePath: filePath || null,
        folderPath: folderPath || null,
        windowId,
        webContentsId,
        stage: "init",
        stageLabel: "Menyiapkan AI",
        stageDetail: "Menyusun prompt dan aturan sebelum permintaan dikirim ke AI.",
      };
      pushTranslateStatus();

      const category = `translate_${providerKey}`;
      pushTranslateStatus({
        stage: "building_prompt",
        stageLabel: "Menyusun instruksi untuk AI",
        stageDetail: "Sistem menggabungkan teks, istilah, dan referensi yang sudah ditemukan.",
      });
      const sysPrompt =
        (await getActivePromptText(category)) ||
        (providerKey !== "openai" ? await getActivePromptText("translate_openai") : null) ||
        buildOpenAiTranslateSystemPrompt();

      const userPrompt = buildOpenAiTranslateUserPrompt({
        text,
        targetCode,
        extraPrompt,
        supportContext,
      });
      const openAiRequestBody = {
        model: chosenModel,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      };
      contextMeta.promptTrace = buildPromptObservabilityPayload({
        aiCalled: true,
        provider: providerKey,
        protocol: "openai",
        model: chosenModel,
        systemPrompt: sysPrompt,
        userPrompt,
        extraPrompt,
        supportContext,
        requestBody: openAiRequestBody,
      });

      const baseUrl = normalizeHttpBaseUrl(providerSetting.base_url) || "https://api.openai.com";
      const endpoint = buildOpenAiChatCompletionsUrl(baseUrl);
      pushTranslateStatus({
        stage: "calling_ai",
        stageLabel: "Memanggil AI untuk menerjemahkan",
        stageDetail: "Permintaan sedang dikirim ke AI. Mohon tunggu sebentar.",
      });
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${providerSetting.api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(openAiRequestBody),
      });
      let data = null;
      try {
        data = await resp.json();
      } catch (_) {
        data = null;
      }
      if (!resp.ok) {
        const msg = (data && data.error && data.error.message) || resp.statusText;
        translateState.running = false;
        sendToAllWindows("translate-complete", {
          ok: false,
          provider: providerKey,
          error: msg,
        });
        return { ok: false, error: msg, context: contextMeta };
      }
      const output =
        (data &&
          data.choices &&
          data.choices[0] &&
          data.choices[0].message &&
          data.choices[0].message.content) ||
        "";
      const confidence = evaluateTranslationConfidence({
        sourceText: text,
        translatedText: output,
        sourceLabel: `ai_${providerKey}`,
      });
      if (String(output || "").trim()) {
        pushTranslateStatus({
          stage: "saving_memory",
          stageLabel: "Menyimpan hasil untuk referensi berikutnya",
          stageDetail: "Hasil AI sedang disimpan agar bisa dipakai lagi nanti.",
        });
        try {
          await upsertTranslationMemoryEntry({
            kitabName,
            folderPath,
            sourceText: text,
            translatedText: output,
            fileName,
            sourceLang: "ar",
            targetLang: targetCode || "id",
            provider: `ai_${providerKey}`,
            model: chosenModel,
            qualityScore: 0.7,
          });
        } catch (e) {
          console.warn("Failed to persist translation memory (openai):", e);
        }
      }
      translateState.running = false;
      sendToAllWindows("translate-complete", {
        ok: true,
        provider: providerKey,
        model: chosenModel,
      });
      return {
        ok: true,
        output,
        provider: providerKey,
        providerId: providerSetting.id || null,
        model: chosenModel,
        target: targetCode || "id",
        context: contextMeta,
        confidence,
      };
    }

    if (protocol === "gemini") {
      const requestedModel =
        String(model || "").trim() || String(providerSetting.model_default || "").trim();
      translateState = {
        running: true,
        provider: providerKey,
        model: null,
        attempt: 0,
        startedAt: Date.now(),
        textLength: text.length,
        jobId,
        queueLength: Math.max(0, translateQueueCount - 1),
        fileName: fileName || null,
        page: page || null,
        filePath: filePath || null,
        folderPath: folderPath || null,
        windowId,
        webContentsId,
        stage: "init",
        stageLabel: "Menyiapkan AI",
        stageDetail: "Menyusun instruksi dan memilih model AI yang paling sesuai.",
      };
      pushTranslateStatus();

      pushTranslateStatus({
        stage: "building_prompt",
        stageLabel: "Menyusun instruksi untuk AI",
        stageDetail: "Sistem menggabungkan teks, istilah, dan referensi yang sudah ditemukan.",
      });
      const prompt = buildGeminiTranslatePrompt({
        text,
        targetCode,
        extraPrompt,
        supportContext,
      });

      const category = `translate_${providerKey}`;
      const systemInstruction =
        (await getActivePromptText(category)) ||
        "Kamu adalah penerjemah khusus kitab dan teks Islam klasik berbahasa Arab. Kamu memahami bahasa Arab klasik, istilah tasawuf, biografi ulama, dan gaya penulisan manaqib. Ketentuan: Makna harus terjaga, tidak kaku (word-for-word), bahasa mengalir alami dan religius seperti gaya kitab kuning atau biografi ulama Nusantara.";

      const mod = await import("@google/generative-ai");
      const GoogleGenerativeAI = mod.GoogleGenerativeAI || mod.default;
      const genAI = new GoogleGenerativeAI(providerSetting.api_key);

      let candidates = [];
      try {
        const listResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${providerSetting.api_key}`,
        );
        if (listResp.ok) {
          const listData = await listResp.json();
          const models = Array.isArray(listData?.models) ? listData.models : [];
          const eligibleRaw = models
            .filter((m) => m?.supportedGenerationMethods?.includes("generateContent"))
            .map((m) => ({
              id: String(m?.name || "").replace("models/", ""),
              raw: m,
            }))
            .filter((m) => !!m.id);

          const eligible = eligibleRaw.map((m) => m.id);
          const prefer = [];
          const pushIf = (needle) => {
            const found = eligible.find((id) => id.includes(needle));
            if (found && !prefer.includes(found)) prefer.push(found);
          };
          if (requestedModel && eligible.includes(requestedModel)) {
            prefer.push(requestedModel);
          }
          pushIf("gemini-2.5-flash");
          pushIf("gemini-2.0-flash");
          pushIf("gemini-1.5-flash");
          pushIf("gemini-1.5-pro");
          eligible.forEach((id) => {
            if (id.includes("gemini") && !prefer.includes(id)) prefer.push(id);
          });
          candidates = prefer.length ? prefer : ["gemini-1.5-flash"];
        }
      } catch (e) {
        console.warn("Failed to list models for translate-ai (gemini):", e);
        candidates = [requestedModel || "gemini-1.5-flash"];
      }

      const errors = [];
      for (const mid of candidates) {
        contextMeta.promptTrace = buildPromptObservabilityPayload({
          aiCalled: true,
          provider: providerKey,
          protocol: "gemini",
          model: mid,
          systemPrompt: systemInstruction,
          userPrompt: prompt,
          extraPrompt,
          supportContext,
          requestBody: {
            model: mid,
            systemInstruction,
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }],
              },
            ],
          },
        });
        translateState.model = mid;
        translateState.attempt = 0;
        translateState.stage = "try";
        translateState.stageLabel = "Memilih model AI";
        translateState.stageDetail = `Mencoba model ${mid} untuk proses terjemahan.`;
        pushTranslateStatus();
        const m = genAI.getGenerativeModel({
          model: mid,
          systemInstruction: systemInstruction,
        });
        let lastErr = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          translateState.attempt = attempt + 1;
          translateState.stage = "attempt";
          pushTranslateStatus({
            stage: "attempt",
            stageLabel: "Memanggil AI untuk menerjemahkan",
            stageDetail: `AI sedang memproses terjemahan dengan model ${mid}, percobaan ke-${attempt + 1}.`,
          });
          try {
            const result = await m.generateContent(prompt);
            const response = await result.response;
            const output = String(response.text() || "");
            if (output.trim()) {
              const confidence = evaluateTranslationConfidence({
                sourceText: text,
                translatedText: output,
                sourceLabel: `ai_${providerKey}`,
              });
              pushTranslateStatus({
                stage: "saving_memory",
                stageLabel: "Menyimpan hasil untuk referensi berikutnya",
                stageDetail: "Hasil AI sedang disimpan agar bisa dipakai lagi nanti.",
              });
              try {
                await upsertTranslationMemoryEntry({
                  kitabName,
                  folderPath,
                  sourceText: text,
                  translatedText: output,
                  fileName,
                  sourceLang: "ar",
                  targetLang: targetCode || "id",
                  provider: `ai_${providerKey}`,
                  model: mid,
                  qualityScore: 0.7,
                });
              } catch (e) {
                console.warn("Failed to persist translation memory (gemini):", e);
              }
              translateState.running = false;
              sendToAllWindows("translate-complete", {
                ok: true,
                provider: providerKey,
                model: mid,
              });
              return {
                ok: true,
                output,
                provider: providerKey,
                providerId: providerSetting.id || null,
                model: mid,
                target: targetCode || "id",
                context: contextMeta,
                confidence,
              };
            } else {
              lastErr = new Error("Empty response");
            }
          } catch (err) {
            lastErr = err;
            const msg = String((err && err.message) || "");
            const isOverloaded =
              msg.includes("503") ||
              msg.toLowerCase().includes("overloaded") ||
              msg.toLowerCase().includes("service unavailable");
            if (isOverloaded) {
              await delayMs(attempt === 0 ? 800 : attempt === 1 ? 1500 : 2500);
              continue;
            } else {
              break;
            }
          }
        }
        errors.push(`Model ${mid}: ${lastErr ? lastErr.message : "unknown error"}`);
      }
      translateState.running = false;
      sendToAllWindows("translate-complete", {
        ok: false,
        provider: providerKey,
        error: errors.join(" | "),
      });
      return { ok: false, error: errors.join(" | ") };
    }

    return { ok: false, error: `Provider/protocol "${providerKey}" belum didukung.` };
  } catch (e) {
    translateState.running = false;
    sendToAllWindows("translate-complete", {
      ok: false,
      provider: String(payload?.provider || "") || null,
      error: e.message,
    });
    return { ok: false, error: e.message };
  } finally {
    translateQueueCount = Math.max(0, translateQueueCount - 1);
    if (translateQueueCount === 0) {
      translateState = {
        running: false,
        provider: null,
        model: null,
        attempt: 0,
        startedAt: 0,
        textLength: 0,
        jobId: null,
        queueLength: 0,
        fileName: null,
        page: null,
        filePath: null,
        folderPath: null,
        windowId: null,
        webContentsId: null,
        stage: null,
        stageLabel: null,
        stageDetail: null,
      };
      pushTranslateStatus();
    }
    try {
      release && release();
    } catch (_) {}
  }
});

ipcMain.handle("translate-openai-cli", async (event, payload) => {
  const text = payload && typeof payload.text === "string" ? payload.text : "";
  const target =
    payload && typeof payload.target === "string" ? payload.target : "id";
  const model =
    payload && typeof payload.model === "string" ? payload.model : "gpt-4.1";
  const extraPrompt =
    payload && typeof payload.prompt === "string" ? payload.prompt : "";
  const fileName =
    payload && typeof payload.fileName === "string" ? payload.fileName : "";
  const page = payload && typeof payload.page === "string" ? payload.page : "";
  const filePath =
    payload && typeof payload.filePath === "string" ? payload.filePath : "";
  const folderPath =
    payload && typeof payload.folderPath === "string" ? payload.folderPath : "";
  const win = event ? BrowserWindow.fromWebContents(event.sender) : null;
  const windowId = win ? win.id : null;
  const webContentsId = event && event.sender ? event.sender.id : null;

  if (!text) return { ok: false, error: "Input text is empty." };

  translateQueueCount += 1;
  if (translateState.running) {
    sendToAllWindows("translate-status", {
      ...translateState,
      queueLength: Math.max(0, translateQueueCount - 1),
    });
  }

  const jobId = (translateJobSeq += 1);
  const release = await acquireTranslateSlot();

  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const item = await getApiSettingByName("openai");
    if (!item || !item.api_key)
      return { ok: false, error: 'API key "openai" tidak ditemukan.' };
    translateState = {
      running: true,
      provider: "openai",
      model,
      attempt: 1,
      startedAt: Date.now(),
      textLength: text.length,
      jobId,
      queueLength: Math.max(0, translateQueueCount - 1),
      fileName: fileName || null,
      page: page || null,
      filePath: filePath || null,
      folderPath: folderPath || null,
      windowId,
      webContentsId,
      stage: "init",
    };
    sendToAllWindows("translate-status", { ...translateState, stage: "init" });

    const targetCode = String(target || "id")
      .trim()
      .toLowerCase();
    const targetLabel =
      targetCode === "id" || targetCode === "ind" || targetCode === "indo"
        ? "Bahasa Indonesia"
        : targetCode;
    const extra = String(extraPrompt || "").trim();
    const sysPrompt =
      (await getActivePromptText("translate_openai")) ||
      buildOpenAiTranslateSystemPrompt();
    const userPrompt = `Terjemahkan teks Arab berikut ke Bahasa Indonesia dengan gaya terjemahan kitab (pesantren), bukan gaya ensiklopedi atau akademik modern.

Ketentuan:

- Kembalikan hanya teks terjemahan (tanpa markdown atau penjelasan).
- Jangan meringkas atau menghilangkan bagian apa pun dari teks.
- Jangan menambahkan tafsir, komentar, atau penjelasan.
- Pertahankan makna dan alur logika sebagaimana dalam teks Arab.
- Urutan gagasan harus mengikuti teks Arab, tetapi penyesuaian kecil untuk tata bahasa Indonesia diperbolehkan agar kalimat tetap terbaca.
- Jika terdapat ungkapan simbolik, sufistik, atau metaforis, pertahankan sifat simboliknya tanpa merasionalisasi.
- Gunakan gaya bahasa yang lazim dalam terjemahan kitab di pesantren (misalnya penggunaan kata seperti: maka, adapun, sesungguhnya, yakni, dan semacamnya bila diperlukan untuk kelancaran kalimat).
- Hindari istilah akademik modern seperti “konsep”, “fenomena”, “entitas”, atau “secara filosofis” kecuali memang tersurat jelas dalam teks Arab.

${extra ? `Instruksi tambahan pengguna:\n${extra}\n` : ""}

Teks Arab:
${String(text || "")}

Terjemahan:`;
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${item.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || resp.statusText;
      translateState.running = false;
      sendToAllWindows("translate-complete", {
        ok: false,
        provider: "openai",
        error: msg,
      });
      return { ok: false, error: msg };
    }
    const output =
      (data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content) ||
      "";
    translateState.running = false;
    sendToAllWindows("translate-complete", {
      ok: true,
      provider: "openai",
      model,
    });
    return { ok: true, output };
  } catch (e) {
    translateState.running = false;
    sendToAllWindows("translate-complete", {
      ok: false,
      provider: "openai",
      error: e.message,
    });
    return { ok: false, error: e.message };
  } finally {
    translateQueueCount = Math.max(0, translateQueueCount - 1);
    if (translateQueueCount === 0) {
      translateState = {
        running: false,
        provider: null,
        model: null,
        attempt: 0,
        startedAt: 0,
        textLength: 0,
        jobId: null,
        queueLength: 0,
        fileName: null,
        page: null,
        filePath: null,
        folderPath: null,
        windowId: null,
        webContentsId: null,
        stage: null,
      };
      sendToAllWindows("translate-status", { ...translateState });
    }
    try {
      release && release();
    } catch (_) {}
  }
});

ipcMain.handle("translate-word-analysis", async (_event, payload) => {
  const text = payload && typeof payload.text === "string" ? payload.text : "";
  const provider =
    payload && typeof payload.provider === "string"
      ? payload.provider
      : "gemini";
  const model =
    payload && typeof payload.model === "string"
      ? payload.model
      : provider === "openai"
        ? "gpt-4o-mini"
        : "gemini-1.5-flash";

  if (!text) return { ok: false, error: "Input text is empty." };

  const systemInstruction = `Kamu adalah ahli tata bahasa Arab (Nahwu & Shorof) dan penerjemah kitab klasik.
Analisis teks Arab berikut secara mendalam per kata.

Format Jawaban:
1. **Analisis Kata per Kata**:
   - [Kata Arab]: [Makna] | [Analisis Nahwu/I'rab ringkas] | [Analisis Shorof jika ada]

2. **Terjemahan Harfiah**:
   [Terjemahan letterlek sesuai urutan kata]

3. **Terjemahan Maksud (Maknawiyah)**:
   [Terjemahan mengalir, bahasa Indonesia yang baik, gaya kitab/biografi ulama]

Pastikan analisis akurat secara gramatika bahasa Arab.`;

  const userPrompt = `Analisis dan terjemahkan teks berikut:\n\n${text}`;

  try {
    const status = getDbStatus();
    if (!status.ok) await initMySql();

    if (provider === "gemini") {
      const item = await getApiSettingByName("geminicli");
      if (!item || !item.api_key)
        return { ok: false, error: 'API key "geminicli" tidak ditemukan.' };

      const mod = await import("@google/generative-ai");
      const GoogleGenerativeAI = mod.GoogleGenerativeAI || mod.default;
      const genAI = new GoogleGenerativeAI(item.api_key);
      const allowed = new Set([
        "gemini-2.5-flash",
        "gemini-1.5-flash",
        "gemini-1.5-pro",
      ]);
      const modelId = allowed.has(String(model))
        ? String(model)
        : "gemini-2.5-flash";

      const m = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: systemInstruction,
      });

      const result = await m.generateContent(userPrompt);
      const response = await result.response;
      const output = String(response.text() || "");
      return { ok: true, output };
    } else if (provider === "openai") {
      const item = await getApiSettingByName("openai");
      if (!item || !item.api_key)
        return { ok: false, error: 'API key "openai" tidak ditemukan.' };

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${item.api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model || "gpt-4o-mini",
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        const msg =
          (data && data.error && data.error.message) || resp.statusText;
        return { ok: false, error: msg };
      }
      const output =
        (data &&
          data.choices &&
          data.choices[0] &&
          data.choices[0].message &&
          data.choices[0].message.content) ||
        "";
      return { ok: true, output };
    } else {
      return { ok: false, error: "Unknown provider: " + provider };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("tts-openai", async (_event, payload) => {
  try {
    const { text, model, voice, saveToFile, folderPath, filePath } = payload || {};
    if (!text) return { ok: false, error: "Text is empty" };

    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const item = await getApiSettingByName("openai");
    if (!item || !item.api_key)
      return { ok: false, error: 'API key "openai" tidak ditemukan.' };
    const chunks = splitTextForTts(text);
    if (!chunks.length) return { ok: false, error: "Teks tidak valid untuk TTS." };

    const buffers = [];
    for (const chunk of chunks) {
      const buffer = await fetchOpenAiTtsBuffer({
        apiKey: item.api_key,
        text: chunk.text,
        model: model || "tts-1",
        voice: voice || "alloy",
      });
      buffers.push(buffer);
    }

    const buffer = buffers.length === 1 ? buffers[0] : Buffer.concat(buffers);
    const base64 = buffer.toString("base64");
    const manifest = {
      provider: "openai",
      model: model || "tts-1",
      voice: voice || "alloy",
      chunkCount: chunks.length,
      totalChars: chunks.reduce((sum, chunk) => sum + (chunk.charCount || 0), 0),
      chunks: chunks.map((chunk) => ({
        index: chunk.index,
        startChar: chunk.startChar,
        endChar: chunk.endChar,
        charCount: chunk.charCount,
      })),
    };
    if (saveToFile) {
      const audioFilePath = getKitabAudioFilePath({ folderPath, filePath });
      const manifestPath = getKitabAudioManifestPath({ folderPath, filePath });
      if (!audioFilePath) {
        return { ok: false, error: "Folder kitab atau file halaman tidak valid untuk menyimpan audio." };
      }
      ensureDir(path.dirname(audioFilePath));
      fs.writeFileSync(audioFilePath, buffer);
      if (manifestPath) {
        fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
      }
      return {
        ok: true,
        audioData: `data:audio/mp3;base64,${base64}`,
        audioPath: audioFilePath,
        audioUrl: pathToFileURL(audioFilePath).href,
        manifest,
        saved: true,
      };
    }
    return {
      ok: true,
      audioData: `data:audio/mp3;base64,${base64}`,
      manifest,
      saved: false,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("get-saved-tts-audio", async (_event, payload) => {
  try {
    const { folderPath, filePath } = payload || {};
    const audioFilePath = getKitabAudioFilePath({ folderPath, filePath });
    const manifestPath = getKitabAudioManifestPath({ folderPath, filePath });
    if (!audioFilePath) {
      return { ok: false, error: "Folder kitab atau file halaman tidak valid." };
    }
    const exists = fs.existsSync(audioFilePath);
    let manifest = null;
    if (manifestPath && fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      } catch (_) {
        manifest = null;
      }
    }
    return {
      ok: true,
      exists,
      audioPath: exists ? audioFilePath : "",
      audioUrl: exists ? pathToFileURL(audioFilePath).href : "",
      fileName: path.basename(audioFilePath),
      manifest,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("copy-image-to-clipboard", async (_event, dataUrl) => {
  try {
    if (!dataUrl) return { ok: false, error: "No data URL provided." };
    const img = nativeImage.createFromDataURL(dataUrl);
    clipboard.writeImage(img);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Find kitab by folder path
ipcMain.handle("find-kitab-by-folder", async (_event, folderPath) => {
  try {
    const data = await findKitabByFolder(folderPath);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Create a new kitab
ipcMain.handle("create-kitab", async (_event, payload) => {
  try {
    const status = getDbStatus();
    if (!status.ok) {
      await initMySql();
    }
    const res = await createKitab(payload || {});
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Kitab folders
ipcMain.handle("list-kitab-folders", async (_event, idKitab) => {
  try {
    const rows = await listKitabFolders(idKitab);
    return { ok: true, data: rows };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("add-kitab-folder", async (_event, payload) => {
  try {
    const { idKitab, folderPath, imageFolderPath } = payload || {};
    if (!idKitab || !folderPath)
      return { ok: false, error: "idKitab and folderPath required" };
    const res = await addKitabFolder(idKitab, folderPath, imageFolderPath);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("remove-kitab-folder", async (_event, payload) => {
  try {
    const { idKitab, folderPath } = payload || {};
    if (!idKitab || !folderPath)
      return { ok: false, error: "idKitab and folderPath required" };
    const res = await removeKitabFolder(idKitab, folderPath);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Kitab detail and update
ipcMain.handle("get-kitab-detail-by-folder", async (_event, folderPath) => {
  try {
    const data = await getKitabDetailByFolder(folderPath);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("get-kitab-detail-by-id", async (_event, idKitab) => {
  try {
    const data = await getKitabDetailById(idKitab);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("update-kitab", async (_event, payload) => {
  try {
    const res = await updateKitab(payload || {});
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("delete-kitab", async (_event, idKitab) => {
  try {
    if (!idKitab) return { ok: false, error: "idKitab required" };
    const res = await deleteKitab(idKitab);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// List .txt files in a directory
ipcMain.handle("list-txt-files", async (_event, dirPath) => {
  try {
    if (!dirPath) return { ok: false, error: "Folder path required." };
    if (!fs.existsSync(dirPath))
      return { ok: false, error: "Folder not found." };
    // First pass: top-level .txt files only (fast)
    let files = [];
    try {
      const dirents = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const d of dirents) {
        if (d.isFile() && d.name.toLowerCase().endsWith(".txt")) {
          files.push(path.join(dirPath, d.name));
        }
      }
    } catch (_) {}

    // If none found, do a limited recursive search to discover files in common subfolders
    if (files.length === 0) {
      const stack = [{ p: dirPath, depth: 0 }];
      const maxDepth = 3;
      while (stack.length > 0) {
        const { p, depth } = stack.pop();
        let dirents;
        try {
          dirents = fs.readdirSync(p, { withFileTypes: true });
        } catch (_) {
          continue;
        }
        for (const d of dirents) {
          const fp = path.join(p, d.name);
          if (d.isDirectory()) {
            if (depth < maxDepth) stack.push({ p: fp, depth: depth + 1 });
          } else if (d.isFile() && d.name.toLowerCase().endsWith(".txt")) {
            files.push(fp);
          }
        }
        // Short-circuit if we already found some files
        if (files.length > 0) break;
      }
    }
    return { ok: true, files };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// List image files in a directory
ipcMain.handle("list-image-files", async (_event, dirPath) => {
  try {
    if (!dirPath) return { ok: false, error: "Folder path required." };
    if (!fs.existsSync(dirPath))
      return { ok: false, error: "Folder not found." };
    const files = listAllImages(dirPath);
    return { ok: true, files };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Translate text using OpenAI ChatGPT
ipcMain.handle("translate-chatgpt", async (_event, payload) => {
  const { apiKey, text, target = "en", model = "gpt-4o-mini" } = payload || {};
  if (!apiKey) return { ok: false, error: "OpenAI API key is required." };
  if (!text) return { ok: false, error: "Input text is empty." };
  try {
    const sysPrompt =
      "You are a professional translator. Preserve meaning, line breaks, and basic formatting. Return plain text.";
    const userPrompt = `Translate the following text into ${target}. Keep original line breaks.\n\n${text}`;
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || resp.statusText;
      return { ok: false, error: msg };
    }
    const out =
      (data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content) ||
      "";
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("get-settings", async () => {
  return readSettings();
});

ipcMain.handle("save-settings", async (_event, partial) => {
  const nextPartial = { ...(partial || {}) };
  if (
    Object.prototype.hasOwnProperty.call(nextPartial, "ocrLayoutMode") ||
    Object.prototype.hasOwnProperty.call(nextPartial, "ocrBoxPaddingPct") ||
    Object.prototype.hasOwnProperty.call(nextPartial, "ocrNotePaddingPct") ||
    Object.prototype.hasOwnProperty.call(nextPartial, "ocrOutsideFormat")
  ) {
    Object.assign(nextPartial, normalizeOcrLayoutSettings(nextPartial));
  }
  if (Object.prototype.hasOwnProperty.call(nextPartial, "translationStyleMemory")) {
    nextPartial.translationStyleMemory = normalizeTranslationStyleMemorySettings(
      nextPartial.translationStyleMemory,
    );
  }
  if (Object.prototype.hasOwnProperty.call(nextPartial, "semanticTuning")) {
    nextPartial.semanticTuning = normalizeSemanticTuningSettings(
      nextPartial.semanticTuning,
    );
  }
  if (Object.prototype.hasOwnProperty.call(nextPartial, "ragSearch")) {
    nextPartial.ragSearch = normalizeRagSearchSettings(nextPartial.ragSearch);
  }
  const saved = writeSettings(nextPartial);
  return { ok: true, settings: saved };
});

ipcMain.handle("cloud-db-test", async (_event, payload) => {
  try {
    const cfg = payload && payload.config ? normalizeCloudDbConfig(payload.config) : getCloudDbConfigFromSettings();
    const pool = await createCloudPool(cfg);
    try {
      await pool.query("SELECT 1");
      return { ok: true };
    } finally {
      try { await pool.end() } catch (_) {}
    }
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle("cloud-db-sync", async (_event, payload) => {
  try {
    const modeRaw = payload && typeof payload.mode === "string" ? payload.mode : "replace";
    const mode = modeRaw === "update" ? "update" : "replace";
    const allowed = new Set(getAllowedCloudTables());
    const requestedTables = Array.isArray(payload && payload.tables ? payload.tables : [])
      ? payload.tables.map((t) => String(t || "").trim()).filter(Boolean)
      : [];
    const tables = (requestedTables.length ? requestedTables : getAllowedCloudTables()).filter((t) => allowed.has(t));
    if (tables.length === 0) return { ok: false, error: "Tidak ada table yang dipilih." };

    const status = getDbStatus();
    if (!status.ok) await initMySql();
    if (!dbPool) return { ok: false, error: "Database local belum siap." };

    const cfg = payload && payload.config ? normalizeCloudDbConfig(payload.config) : getCloudDbConfigFromSettings();
    const cloudPool = await createCloudPool(cfg);
    try {
      await cloudEnsureTables({ cloudPool, tables });
      const stats = {};

      if (mode === "replace") {
        const truncOrder = orderTablesForTruncate(tables);
        await cloudPool.query("SET FOREIGN_KEY_CHECKS=0");
        for (const t of truncOrder) {
          await cloudPool.query(`TRUNCATE TABLE \`${t}\``);
        }
        await cloudPool.query("SET FOREIGN_KEY_CHECKS=1");

        const insOrder = orderTablesForInsert(tables);
        for (const t of insOrder) {
          stats[t] = await copyTableReplace({ cloudPool, table: t });
        }
      } else {
        for (const t of tables) {
          stats[t] = await copyTableUpsert({ cloudPool, table: t });
        }
      }

      return { ok: true, mode, tables, stats };
    } finally {
      try { await cloudPool.end() } catch (_) {}
    }
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizeFsPath(p) {
  const s = String(p || "").trim();
  if (!s) return "";
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function sanitizeFileNamePart(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function getKitabAudioFilePath({ folderPath, filePath }) {
  const normalizedFolder = sanitizeFsPath(folderPath);
  const normalizedFile = sanitizeFsPath(filePath);
  if (!normalizedFolder || !normalizedFile) return "";
  const baseName = sanitizeFileNamePart(path.parse(normalizedFile).name || "page");
  if (!baseName) return "";
  return path.join(normalizedFolder, "audio", `${baseName}.mp3`);
}

function getKitabAudioManifestPath({ folderPath, filePath }) {
  const normalizedFolder = sanitizeFsPath(folderPath);
  const normalizedFile = sanitizeFsPath(filePath);
  if (!normalizedFolder || !normalizedFile) return "";
  const baseName = sanitizeFileNamePart(path.parse(normalizedFile).name || "page");
  if (!baseName) return "";
  return path.join(normalizedFolder, "audio", `${baseName}.json`);
}

function splitTextForTts(rawText, maxChars = 1200) {
  const source = String(rawText || "").replace(/\r\n/g, "\n");
  const chunks = [];
  let cursor = 0;
  let index = 0;

  while (cursor < source.length) {
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    if (cursor >= source.length) break;

    let sliceEnd = Math.min(cursor + maxChars, source.length);
    if (sliceEnd < source.length) {
      const slice = source.slice(cursor, sliceEnd);
      const candidates = [
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf("۔"),
        slice.lastIndexOf("."),
        slice.lastIndexOf("!"),
        slice.lastIndexOf("?"),
        slice.lastIndexOf("؟"),
        slice.lastIndexOf("،"),
        slice.lastIndexOf(";"),
        slice.lastIndexOf(":"),
        slice.lastIndexOf(" "),
      ];
      const bestBreak = Math.max(...candidates);
      if (bestBreak >= Math.floor(maxChars * 0.45)) {
        sliceEnd = cursor + bestBreak + 1;
      }
    }

    let startChar = cursor;
    let endChar = sliceEnd;
    while (startChar < endChar && /\s/.test(source[startChar])) startChar += 1;
    while (endChar > startChar && /\s/.test(source[endChar - 1])) endChar -= 1;
    const text = source.slice(startChar, endChar);
    if (text) {
      chunks.push({
        index,
        startChar,
        endChar,
        charCount: text.length,
        text,
      });
      index += 1;
    }
    cursor = sliceEnd;
  }

  return chunks;
}

async function fetchOpenAiTtsBuffer({ apiKey, text, model, voice }) {
  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "tts-1",
      input: text,
      voice: voice || "alloy",
      response_format: "mp3",
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(err || "TTS request gagal.");
  }

  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function listJpgFiles(dir) {
  const files = fs.readdirSync(dir);
  return files
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .map((f) => path.join(dir, f));
}

function baseNameNoExt(filePath) {
  return path.parse(filePath).name;
}

function sortNumericByBaseName(files) {
  return files.sort((a, b) => {
    const na = parseInt(baseNameNoExt(a), 10);
    const nb = parseInt(baseNameNoExt(b), 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

function listImagesForOcr(dir) {
  const exts = new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".tif",
    ".tiff",
    ".webp",
  ]);
  try {
    const files = fs.readdirSync(dir);
    return files
      .filter((f) => exts.has(path.extname(f).toLowerCase()))
      .map((f) => path.join(dir, f));
  } catch (_) {
    return [];
  }
}

function createTempDir(prefix) {
  const base = app.getPath("temp");
  const dir = path.join(
    base,
    String(prefix || "ocr_pre") + "_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex"),
  );
  ensureDir(dir);
  return dir;
}

function cleanupTempDir(dir) {
  try {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

async function preprocessImageForOcr(inputPath, outputPath, magickPath) {
  const exe = magickPath || findMagickExe() || "magick";
  const tmpDir = path.dirname(outputPath);
  const env = {
    MAGICK_TMPDIR: tmpDir,
    MAGICK_TEMPORARY_PATH: tmpDir,
    TMP: tmpDir,
    TEMP: tmpDir,
  };
  const args = [
    "-limit",
    "area",
    "512MiB",
    "-limit",
    "memory",
    "1GiB",
    "-limit",
    "map",
    "4GiB",
    inputPath,
    "-colorspace",
    "Gray",
    "-resize",
    "200%",
    "-despeckle",
    "-auto-threshold",
    "OTSU",
    "-deskew",
    "40%",
    "+repage",
    outputPath,
  ];
  const res = await spawnTool(exe, args, { env, timeoutMs: 15000 });
  if (res.code === 0 && fs.existsSync(outputPath)) return { ok: true, path: outputPath };
  return { ok: false, error: res.err || `magick exited with code ${res.code}` };
}

async function prepareOcrSingleImage(imagePath) {
  const s = readSettings();
  const base = path.parse(imagePath).name;
  const tmpDir = createTempDir("ocr_pre");
  const outPath = path.join(tmpDir, base + ".png");
  const pre = await preprocessImageForOcr(imagePath, outPath, s.magickPath);
  if (pre && pre.ok) {
    return { path: pre.path, cleanup: () => cleanupTempDir(tmpDir), preprocessed: true };
  }
  cleanupTempDir(tmpDir);
  return { path: imagePath, cleanup: () => {}, preprocessed: false, error: pre?.error || null };
}

async function prepareOcrFolder(inputFolder) {
  const s = readSettings();
  const tmpDir = createTempDir("ocr_pre_folder");
  const files = sortNumericByBaseName(listImagesForOcr(inputFolder));
  for (const p of files) {
    try {
      const base = path.parse(p).name;
      const outPath = path.join(tmpDir, base + ".png");
      const pre = await preprocessImageForOcr(p, outPath, s.magickPath);
      if (!pre || !pre.ok) {
        try {
          const ext = path.extname(p).toLowerCase() || ".png";
          const fallbackPath = path.join(tmpDir, base + ext);
          fs.copyFileSync(p, fallbackPath);
        } catch (_) {}
      }
    } catch (_) {}
  }
  return { folder: tmpDir, cleanup: () => cleanupTempDir(tmpDir) };
}

function findPreparedImageForBase(folder, base) {
  const exts = [".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"];
  for (const ext of exts) {
    const p = path.join(folder, base + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveOcrLayoutOptions(payload, settings) {
  return normalizeLayoutRuntimeOptions(payload || {}, normalizeOcrLayoutSettings(settings || {}));
}

async function runTesseractCli({ inputPath, outBase, tesseractPath, lang, psm = "6" }) {
  return await new Promise((resolve) => {
    const args = [
      inputPath,
      outBase,
      "-l",
      lang || "ara",
      "--psm",
      String(psm || "6"),
      "--oem",
      "1",
      "-c",
      "preserve_interword_spaces=1",
    ];
    const proc = spawn(tesseractPath, args, { shell: false });
    let err = "";
    proc.stderr.on("data", (d) => {
      err += d.toString();
    });
    proc.on("error", (e) => {
      resolve({
        ok: false,
        error: e && e.message ? e.message : String(e),
      });
    });
    proc.on("exit", (code) => {
      const resultFile = outBase + ".txt";
      if (code !== 0) {
        resolve({
          ok: false,
          error: err || `tesseract exited with code ${code}`,
        });
        return;
      }
      try {
        const text = fs.existsSync(resultFile) ? fs.readFileSync(resultFile, "utf-8") : "";
        resolve({ ok: true, text, resultFile });
      } catch (e) {
        resolve({ ok: false, error: e.message || String(e) });
      }
    });
  });
}

async function prepareOcrCropImage(imagePath, tmpDir, baseName, magickPath) {
  const outPath = path.join(tmpDir, `${baseName}_pre.png`);
  const pre = await preprocessImageForOcr(imagePath, outPath, magickPath);
  if (pre && pre.ok) return pre.path;
  return imagePath;
}

async function runStandardTesseractOcr({ imagePath, outBase, tesseractPath, lang }) {
  const prepared = await prepareOcrSingleImage(imagePath);
  try {
    return await runTesseractCli({
      inputPath: prepared.path || imagePath,
      outBase,
      tesseractPath,
      lang,
      psm: "6",
    });
  } finally {
    try { prepared.cleanup && prepared.cleanup(); } catch (_) {}
  }
}

async function runLayoutAwareTesseractOcr({
  imagePath,
  outBase,
  tesseractPath,
  lang,
  settings,
  layoutOptions,
}) {
  const tmpDir = createTempDir("ocr_box_notes");
  try {
    const layout = await detectAndCropBoxLayout(imagePath, {
      magickPath: settings && settings.magickPath ? settings.magickPath : "",
      boxPaddingPct: layoutOptions.boxPaddingPct,
      notePaddingPct: layoutOptions.notePaddingPct,
      tempDir: tmpDir,
      timeoutMs: 20000,
    });

    if (!layout.ok) {
      console.warn("[ocr-box-notes] layout helper failed, fallback full page:", imagePath, layout.error);
      const fallback = await runStandardTesseractOcr({ imagePath, outBase, tesseractPath, lang });
      return { ...fallback, layoutDetected: false, fallbackReason: layout.error || "layout-helper-failed" };
    }

    if (!layout.detected) {
      console.info("[ocr-box-notes] main box not detected, fallback full page:", imagePath, layout.reason || "");
      const fallback = await runStandardTesseractOcr({ imagePath, outBase, tesseractPath, lang });
      return { ...fallback, layoutDetected: false, fallbackReason: layout.reason || "box-not-found" };
    }

    console.info("[ocr-box-notes] main box detected:", {
      file: path.basename(imagePath),
      boxRect: layout.boxRect,
      debug: layout.debug,
    });

    const insideInput = await prepareOcrCropImage(
      layout.crops.inside,
      tmpDir,
      "inside",
      settings && settings.magickPath ? settings.magickPath : "",
    );
    const mainRes = await runTesseractCli({
      inputPath: insideInput,
      outBase: path.join(tmpDir, "inside_ocr"),
      tesseractPath,
      lang,
      psm: "6",
    });
    if (!mainRes.ok) return { ...mainRes, layoutDetected: true };

    const outsideTexts = {};
    for (const zone of ["top", "right", "bottom", "left"]) {
      const cropPath = layout.crops.outside[zone];
      if (!cropPath) continue;
      const outsideInput = await prepareOcrCropImage(
        cropPath,
        tmpDir,
        `outside_${zone}`,
        settings && settings.magickPath ? settings.magickPath : "",
      );
      const zoneRes = await runTesseractCli({
        inputPath: outsideInput,
        outBase: path.join(tmpDir, `outside_${zone}_ocr`),
        tesseractPath,
        lang,
        psm: "11",
      });
      if (!zoneRes.ok) {
        console.warn("[ocr-box-notes] outside OCR failed:", path.basename(imagePath), zone, zoneRes.error);
        continue;
      }
      const zoneText = String(zoneRes.text || "").trim();
      if (!zoneText) continue;
      outsideTexts[zone] = zoneText;
    }

    const mergedText = mergeOcrText(mainRes.text, outsideTexts, {
      outsideFormat: layoutOptions.outsideFormat,
    });
    const targetTxt = outBase + ".txt";
    fs.writeFileSync(targetTxt, mergedText, "utf-8");
    return {
      ok: true,
      text: mergedText,
      resultFile: targetTxt,
      layoutDetected: true,
      boxRect: layout.boxRect,
      outsideZones: Object.keys(outsideTexts),
    };
  } finally {
    try { cleanupTempDir(tmpDir); } catch (_) {}
  }
}

async function runOpenAiOcrImage({
  inputPath,
  model,
  apiKey,
  sysPrompt,
  userText,
}) {
  const ext = path.extname(inputPath).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" :
    ext === ".webp" ? "image/webp" :
    ext === ".gif" ? "image/gif" :
    "image/jpeg";
  const buf = fs.readFileSync(inputPath);
  const base64 = buf.toString("base64");
  const dataUrl = `data:${mime};base64,${base64}`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: sysPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0,
    }),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    return {
      ok: false,
      error: (data && data.error && data.error.message) || resp.statusText || "OpenAI OCR error",
    };
  }
  const out =
    (data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content) ||
    "";
  return { ok: true, text: String(out || "") };
}

async function runGoogleVisionOcrImage({
  inputPath,
  apiKey,
  lang,
}) {
  const buf = fs.readFileSync(inputPath);
  const base64 = buf.toString("base64");
  const langHint = String(lang || "ara").toLowerCase() === "ara" ? "ar" : String(lang || "");

  const resp = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64 },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            imageContext: langHint ? { languageHints: [langHint] } : undefined,
          },
        ],
      }),
    },
  );
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    return {
      ok: false,
      error: (data && data.error && data.error.message) || resp.statusText || "Google Vision error",
    };
  }
  return { ok: true, text: String(data?.responses?.[0]?.fullTextAnnotation?.text || "") };
}

async function runLayoutAwareGoogleVisionOcr({
  imagePath,
  txtPath,
  settings,
  layoutOptions,
  apiKey,
  lang,
}) {
  const tmpDir = createTempDir("ocr_box_notes_vision");
  let fullPrepared = null;
  try {
    const layout = await detectAndCropBoxLayout(imagePath, {
      magickPath: settings && settings.magickPath ? settings.magickPath : "",
      boxPaddingPct: layoutOptions.boxPaddingPct,
      notePaddingPct: layoutOptions.notePaddingPct,
      tempDir: tmpDir,
      timeoutMs: 20000,
    });

    fullPrepared = await prepareOcrSingleImage(imagePath);
    const fullPageFallback = async (reason) => {
      const fullRes = await runGoogleVisionOcrImage({
        inputPath: fullPrepared.path || imagePath,
        apiKey,
        lang,
      });
      if (!fullRes.ok) return { ...fullRes, layoutDetected: false, fallbackReason: reason };
      fs.writeFileSync(txtPath, fullRes.text, "utf-8");
      return {
        ok: true,
        text: fullRes.text,
        layoutDetected: false,
        fallbackReason: reason,
        outsideZones: [],
      };
    };

    if (!layout.ok) {
      console.warn("[ocr-box-notes] vision layout helper failed, fallback full page:", imagePath, layout.error);
      return await fullPageFallback(layout.error || "layout-helper-failed");
    }

    if (!layout.detected) {
      console.info("[ocr-box-notes] vision main box not detected, fallback full page:", imagePath, layout.reason || "");
      return await fullPageFallback(layout.reason || "box-not-found");
    }

    const insideInput = await prepareOcrCropImage(
      layout.crops.inside,
      tmpDir,
      "inside_vision",
      settings && settings.magickPath ? settings.magickPath : "",
    );
    const mainRes = await runGoogleVisionOcrImage({
      inputPath: insideInput,
      apiKey,
      lang,
    });
    if (!mainRes.ok) return { ...mainRes, layoutDetected: true };

    const outsideTexts = {};
    for (const zone of ["top", "right", "bottom", "left"]) {
      const cropPath = layout.crops.outside[zone];
      if (!cropPath) continue;
      const outsideInput = await prepareOcrCropImage(
        cropPath,
        tmpDir,
        `outside_vision_${zone}`,
        settings && settings.magickPath ? settings.magickPath : "",
      );
      const zoneRes = await runGoogleVisionOcrImage({
        inputPath: outsideInput,
        apiKey,
        lang,
      });
      if (!zoneRes.ok) {
        console.warn("[ocr-box-notes] vision outside OCR failed:", path.basename(imagePath), zone, zoneRes.error);
        continue;
      }
      const zoneText = String(zoneRes.text || "").trim();
      if (!zoneText) continue;
      outsideTexts[zone] = zoneText;
    }

    const mergedText = mergeOcrText(mainRes.text, outsideTexts, {
      outsideFormat: layoutOptions.outsideFormat,
    });
    fs.writeFileSync(txtPath, mergedText, "utf-8");
    return {
      ok: true,
      text: mergedText,
      layoutDetected: true,
      outsideZones: Object.keys(outsideTexts),
    };
  } finally {
    try { fullPrepared && fullPrepared.cleanup && fullPrepared.cleanup(); } catch (_) {}
    try { cleanupTempDir(tmpDir); } catch (_) {}
  }
}

async function runLayoutAwareOpenAiOcr({
  imagePath,
  txtPath,
  model,
  settings,
  layoutOptions,
  apiKey,
  sysPrompt,
}) {
  const tmpDir = createTempDir("ocr_box_notes_openai");
  let fullPrepared = null;
  try {
    const layout = await detectAndCropBoxLayout(imagePath, {
      magickPath: settings && settings.magickPath ? settings.magickPath : "",
      boxPaddingPct: layoutOptions.boxPaddingPct,
      notePaddingPct: layoutOptions.notePaddingPct,
      tempDir: tmpDir,
      timeoutMs: 20000,
    });

    fullPrepared = await prepareOcrSingleImage(imagePath);
    const fullPageFallback = async (reason) => {
      const fullRes = await runOpenAiOcrImage({
        inputPath: fullPrepared.path || imagePath,
        model,
        apiKey,
        sysPrompt,
        userText: "Transcribe the Arabic text in this image.",
      });
      if (!fullRes.ok) return { ...fullRes, layoutDetected: false, fallbackReason: reason };
      fs.writeFileSync(txtPath, fullRes.text, "utf-8");
      return {
        ok: true,
        text: fullRes.text,
        layoutDetected: false,
        fallbackReason: reason,
        outsideZones: [],
      };
    };

    if (!layout.ok) {
      console.warn("[ocr-box-notes] openai layout helper failed, fallback full page:", imagePath, layout.error);
      return await fullPageFallback(layout.error || "layout-helper-failed");
    }

    if (!layout.detected) {
      console.info("[ocr-box-notes] openai main box not detected, fallback full page:", imagePath, layout.reason || "");
      return await fullPageFallback(layout.reason || "box-not-found");
    }

    const insideInput = await prepareOcrCropImage(
      layout.crops.inside,
      tmpDir,
      "inside_openai",
      settings && settings.magickPath ? settings.magickPath : "",
    );
    const mainRes = await runOpenAiOcrImage({
      inputPath: insideInput,
      model,
      apiKey,
      sysPrompt,
      userText: "Transcribe only the main text inside this cropped manuscript image. Return only the transcription.",
    });
    if (!mainRes.ok) return { ...mainRes, layoutDetected: true };

    const outsideTexts = {};
    for (const zone of ["top", "right", "bottom", "left"]) {
      const cropPath = layout.crops.outside[zone];
      if (!cropPath) continue;
      const outsideInput = await prepareOcrCropImage(
        cropPath,
        tmpDir,
        `outside_openai_${zone}`,
        settings && settings.magickPath ? settings.magickPath : "",
      );
      const zoneRes = await runOpenAiOcrImage({
        inputPath: outsideInput,
        model,
        apiKey,
        sysPrompt,
        userText: `Transcribe only the marginal or outside-box text from this cropped manuscript image. Return only the transcription.`,
      });
      if (!zoneRes.ok) {
        console.warn("[ocr-box-notes] openai outside OCR failed:", path.basename(imagePath), zone, zoneRes.error);
        continue;
      }
      const zoneText = String(zoneRes.text || "").trim();
      if (!zoneText) continue;
      outsideTexts[zone] = zoneText;
    }

    const mergedText = mergeOcrText(mainRes.text, outsideTexts, {
      outsideFormat: layoutOptions.outsideFormat,
    });
    fs.writeFileSync(txtPath, mergedText, "utf-8");
    return {
      ok: true,
      text: mergedText,
      layoutDetected: true,
      outsideZones: Object.keys(outsideTexts),
    };
  } finally {
    try { fullPrepared && fullPrepared.cleanup && fullPrepared.cleanup(); } catch (_) {}
    try { cleanupTempDir(tmpDir); } catch (_) {}
  }
}

ipcMain.handle("run-ocr", async (_event, payload) => {
  const inputFolder = sanitizeFsPath(payload && payload.inputFolder);
  const outputFolder = sanitizeFsPath(payload && payload.outputFolder);
  const tesseractPath = sanitizeFsPath(payload && payload.tesseractPath);
  const lang = payload && payload.lang;
  const settings = readSettings();
  const layoutOptions = resolveOcrLayoutOptions(payload, settings);
  if (!inputFolder || !outputFolder || !tesseractPath) {
    return {
      ok: false,
      error: "Input, output, and tesseract path are required.",
    };
  }
  if (!fs.existsSync(inputFolder))
    return { ok: false, error: "Input folder not found." };
  if (!fs.existsSync(tesseractPath))
    return { ok: false, error: "Tesseract path not found." };
  ensureDir(outputFolder);

  const jpgFiles = sortNumericByBaseName(listImagesForOcr(inputFolder));
  if (jpgFiles.length === 0)
    return { ok: false, error: "No image files found in input folder." };

  // Initialize global OCR state so navigation can restore progress
  ocrState = {
    running: true,
    total: jpgFiles.length,
    completed: 0,
    lastFile: null,
  };
  sendToAllWindows("ocr-progress", {
    file: "(mulai)",
    index: 0,
    total: jpgFiles.length,
    ok: true,
    error: null,
  });
  let completed = 0;
  for (const file of jpgFiles) {
    const outBase = path.join(outputFolder, baseNameNoExt(file));
    let counted = false;
    try {
      const res = layoutOptions.layoutMode === "box_notes"
        ? await runLayoutAwareTesseractOcr({
          imagePath: file,
          outBase,
          tesseractPath,
          lang,
          settings,
          layoutOptions,
        })
        : await runStandardTesseractOcr({
          imagePath: file,
          outBase,
          tesseractPath,
          lang,
        });
      completed += 1;
      counted = true;
      ocrState = {
        running: true,
        total: jpgFiles.length,
        completed,
        lastFile: path.basename(file),
      };
      sendToAllWindows("ocr-progress", {
        file: path.basename(file),
        index: completed,
        total: jpgFiles.length,
        ok: !!res.ok,
        error: res.ok ? null : (res.error || "OCR failed."),
      });
    } catch (err) {
      // Continue on error but report it
      if (!counted) {
        completed += 1;
        ocrState = {
          running: true,
          total: jpgFiles.length,
          completed,
          lastFile: path.basename(file),
        };
      }
      sendToAllWindows("ocr-progress", {
        file: path.basename(file),
        index: completed,
        total: jpgFiles.length,
        ok: false,
        error: err.message,
      });
    }
  }

  sendToAllWindows("ocr-complete", { total: jpgFiles.length });
  ocrState.running = false;
  return { ok: true };
});

ipcMain.handle("run-ocr-file", async (_event, payload) => {
  const { imagePath, txtPath, engine } = payload;
  if (!imagePath || !txtPath)
    return { ok: false, error: "Image and text paths required" };
  if (!fs.existsSync(imagePath))
    return { ok: false, error: "Image file not found." };

  const settings = readSettings();
  const tesseractPath =
    settings.tesseractPath || "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
  const lang = settings.lang || "ara";
  const selectedEngine = engine || settings.ocrEngine || "tesseract";
  const layoutOptions = resolveOcrLayoutOptions(payload, settings);

  const outputFolder = path.dirname(txtPath);
  const outBase = txtPath.replace(/\.txt$/i, "");
  const expectedTxtPath =
    fs.existsSync(txtPath) || /\.txt$/i.test(String(txtPath || ""))
      ? txtPath
      : path.join(outputFolder, path.parse(imagePath).name + ".txt");
  ocrState = {
    running: true,
    total: 1,
    completed: 0,
    lastFile: path.basename(imagePath),
  };
  sendToAllWindows("ocr-progress", {
    file: path.basename(imagePath),
    index: 0,
    total: 1,
    ok: true,
    error: null,
  });

  let prepared = null;
  try {
    if (selectedEngine === "kraken" || selectedEngine === "kraken_arabic") {
      prepared = await prepareOcrSingleImage(imagePath);
      const ocrInputPath = prepared.path;
      const scriptPath = path.join(
        app.isPackaged ? process.resourcesPath : process.cwd(),
        "engines",
        "run_kraken.py",
      );
      if (!fs.existsSync(scriptPath))
        return { ok: false, error: "Kraken engine wrapper not found." };

      const modelPath =
        (settings && (settings.krakenArabicModelPath || settings.krakenModelPath)) ||
        "";
      if (modelPath && !fs.existsSync(modelPath)) {
        return {
          ok: false,
          error:
            `Kraken model tidak ditemukan: ${modelPath}. ` +
            `Simpan path model ke settings.json (krakenArabicModelPath / krakenModelPath).`,
        };
      }

      const pythonExe = findPythonExeForEngine("kraken");
      const args = [
        scriptPath,
        "--file",
        ocrInputPath,
        "--output",
        outputFolder,
        "--lang",
        lang,
      ];
      if (modelPath) args.push("--model", modelPath);

      const res = await new Promise((resolve) => {
        const proc = spawn(pythonExe, args, {
          shell: false,
          env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
        });
        let err = "";
        proc.stderr.on("data", (d) => {
          err += d.toString();
        });
        proc.on("error", (e) => {
          const msg = e && e.message ? e.message : String(e);
          sendToAllWindows("ocr-progress", {
            file: path.basename(imagePath),
            index: 1,
            total: 1,
            ok: false,
            error: msg,
          });
          sendToAllWindows("ocr-complete", { total: 1 });
          ocrState.running = false;
          resolve({ ok: false, error: msg });
        });
        proc.on("exit", (code) => {
          sendToAllWindows("ocr-progress", {
            file: path.basename(imagePath),
            index: 1,
            total: 1,
            ok: code === 0,
            error: code === 0 ? null : err || `Exit code ${code}`,
          });
          sendToAllWindows("ocr-complete", { total: 1 });
          ocrState.running = false;
          if (code === 0 && fs.existsSync(expectedTxtPath)) {
            try {
              const content = fs.readFileSync(expectedTxtPath, "utf-8");
              resolve({
                ok: true,
                text: content,
                layoutDetected: layoutOptions.layoutMode !== "box_notes",
                fallbackReason:
                  layoutOptions.layoutMode === "box_notes"
                    ? "engine-does-not-support-box-notes"
                    : null,
                outsideZones: [],
              });
            } catch (e) {
              resolve({ ok: false, error: e.message });
            }
          } else {
            resolve({ ok: false, error: err || `Exit code ${code}` });
          }
        });
      });
      return res;
    } else if (selectedEngine === "google_vision") {
      prepared = await prepareOcrSingleImage(imagePath);
      const ocrInputPath = prepared.path;
      const status = getDbStatus();
      if (!status.ok) await initMySql();
      const item =
        (await getApiSettingByName("google_vision")) ||
        (await getApiSettingByName("googlevision")) ||
        (await getApiSettingByName("vision"));
      if (!item || !item.api_key)
        return { ok: false, error: 'API key "google_vision" tidak ditemukan.' };

      const apiKey = String(item.api_key || "").trim();
      if (!apiKey) return { ok: false, error: 'API key "google_vision" kosong.' };
      const result = layoutOptions.layoutMode === "box_notes"
        ? await runLayoutAwareGoogleVisionOcr({
          imagePath,
          txtPath: expectedTxtPath,
          settings,
          layoutOptions,
          apiKey,
          lang,
        })
        : await runGoogleVisionOcrImage({
          inputPath: ocrInputPath,
          apiKey,
          lang,
        });
      if (!result.ok) {
        sendToAllWindows("ocr-progress", {
          file: path.basename(imagePath),
          index: 1,
          total: 1,
          ok: false,
          error: result.error || "Google Vision error",
        });
        sendToAllWindows("ocr-complete", { total: 1 });
        ocrState.running = false;
        return { ok: false, error: result.error || "Google Vision error" };
      }
      const outText = String(result.text || "");
      if (layoutOptions.layoutMode !== "box_notes") {
        try {
          fs.writeFileSync(expectedTxtPath, outText, "utf-8");
        } catch (e) {
          sendToAllWindows("ocr-progress", {
            file: path.basename(imagePath),
            index: 1,
            total: 1,
            ok: false,
            error: e.message,
          });
          sendToAllWindows("ocr-complete", { total: 1 });
          ocrState.running = false;
          return { ok: false, error: e.message };
        }
      }

      sendToAllWindows("ocr-progress", {
        file: path.basename(imagePath),
        index: 1,
        total: 1,
        ok: true,
        error: null,
      });
      sendToAllWindows("ocr-complete", { total: 1 });
      ocrState.running = false;
      return {
        ok: true,
        text: outText,
        layoutDetected: !!result.layoutDetected,
        fallbackReason: result.fallbackReason || null,
        outsideZones: Array.isArray(result.outsideZones) ? result.outsideZones : [],
      };
    } else if (selectedEngine === "arabic_dl") {
      prepared = await prepareOcrSingleImage(imagePath);
      const ocrInputPath = prepared.path;
      const scriptPath = path.join(
        app.isPackaged ? process.resourcesPath : process.cwd(),
        "engines",
        "run_arabic_dl.py",
      );
      if (!fs.existsSync(scriptPath))
        return { ok: false, error: "Arabic DL engine not found." };
      const pythonExe = findPythonExeForEngine("arabic_dl");
      const args = [
        scriptPath,
        "--file",
        ocrInputPath,
        "--output",
        outputFolder,
        "--lang",
        lang,
      ];
      if (tesseractPath) args.push("--tesseract-path", tesseractPath);

      const res = await new Promise((resolve) => {
        const proc = spawn(pythonExe, args, {
          shell: false,
          env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
        });
        let err = "";
        proc.stderr.on("data", (d) => {
          err += d.toString();
        });
        proc.on("error", (e) => {
          const msg = e && e.message ? e.message : String(e);
          sendToAllWindows("ocr-progress", {
            file: path.basename(imagePath),
            index: 1,
            total: 1,
            ok: false,
            error: msg,
          });
          sendToAllWindows("ocr-complete", { total: 1 });
          ocrState.running = false;
          resolve({ ok: false, error: msg });
        });
        proc.on("exit", (code) => {
          sendToAllWindows("ocr-progress", {
            file: path.basename(imagePath),
            index: 1,
            total: 1,
            ok: code === 0,
            error: code === 0 ? null : err || `Exit code ${code}`,
          });
          sendToAllWindows("ocr-complete", { total: 1 });
          ocrState.running = false;
          if (code === 0 && fs.existsSync(expectedTxtPath)) {
            try {
              const content = fs.readFileSync(expectedTxtPath, "utf-8");
              resolve({ ok: true, text: content });
            } catch (e) {
              resolve({ ok: false, error: e.message });
            }
          } else {
            resolve({ ok: false, error: err || `Exit code ${code}` });
          }
        });
      });
      return res;
    } else if (selectedEngine === "easyocr") {
      prepared = await prepareOcrSingleImage(imagePath);
      const ocrInputPath = prepared.path;
      const scriptPath = path.join(
        app.isPackaged ? process.resourcesPath : process.cwd(),
        "engines",
        "run_easyocr.py",
      );
      if (!fs.existsSync(scriptPath))
        return { ok: false, error: "EasyOCR engine not found." };
      const pythonExe = findPythonExeForEngine("easyocr");
      const args = [
        scriptPath,
        "--file",
        ocrInputPath,
        "--output",
        outputFolder,
        "--lang",
        lang,
      ];

      const res = await new Promise((resolve) => {
        const proc = spawn(pythonExe, args, {
          shell: false,
          env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
        });
        let err = "";
        proc.stderr.on("data", (d) => {
          err += d.toString();
        });
        proc.on("exit", (code) => {
          sendToAllWindows("ocr-progress", {
            file: path.basename(imagePath),
            index: 1,
            total: 1,
            ok: code === 0,
            error: code === 0 ? null : err || `Exit code ${code}`,
          });
          sendToAllWindows("ocr-complete", { total: 1 });
          ocrState.running = false;
          if (code === 0 && fs.existsSync(expectedTxtPath)) {
            try {
              const content = fs.readFileSync(expectedTxtPath, "utf-8");
              resolve({ ok: true, text: content });
            } catch (e) {
              resolve({ ok: false, error: e.message });
            }
          } else {
            resolve({ ok: false, error: err || `Exit code ${code}` });
          }
        });
      });
      return res;
    } else if (selectedEngine === "unlimited_ocr") {
      prepared = await prepareOcrSingleImage(imagePath);
      const ocrInputPath = prepared.path;
      const scriptPath = path.join(
        app.isPackaged ? process.resourcesPath : process.cwd(),
        "engines",
        "run_unlimited_ocr.py",
      );
      if (!fs.existsSync(scriptPath))
        return { ok: false, error: "Unlimited-OCR engine wrapper not found." };
      const modelDir = resolveUnlimitedOcrModelDir(settings);
      if (!fs.existsSync(modelDir)) {
        return {
          ok: false,
          error:
            `Folder model Unlimited-OCR tidak ditemukan: ${modelDir}. ` +
            "Simpan snapshot lokal model ke folder tersebut atau set `unlimitedOcrModelDir` di settings.json.",
        };
      }
      const pythonExe = findPythonExeForEngine("unlimited_ocr");
      const args = [
        scriptPath,
        "--file",
        ocrInputPath,
        "--output",
        outputFolder,
        "--model-dir",
        modelDir,
      ];

      const res = await new Promise((resolve) => {
        const proc = spawn(pythonExe, args, {
          shell: false,
          env: buildUnlimitedOcrEnv(),
        });
        let err = "";
        proc.stderr.on("data", (d) => {
          err += d.toString();
        });
        proc.on("error", (e) => {
          const msg = e && e.message ? e.message : String(e);
          sendToAllWindows("ocr-progress", {
            file: path.basename(imagePath),
            index: 1,
            total: 1,
            ok: false,
            error: msg,
          });
          sendToAllWindows("ocr-complete", { total: 1 });
          ocrState.running = false;
          resolve({ ok: false, error: msg });
        });
        proc.on("exit", (code) => {
          sendToAllWindows("ocr-progress", {
            file: path.basename(imagePath),
            index: 1,
            total: 1,
            ok: code === 0,
            error: code === 0 ? null : err || `Exit code ${code}`,
          });
          sendToAllWindows("ocr-complete", { total: 1 });
          ocrState.running = false;
          if (code === 0 && fs.existsSync(expectedTxtPath)) {
            try {
              const content = fs.readFileSync(expectedTxtPath, "utf-8");
              resolve({ ok: true, text: content });
            } catch (e) {
              resolve({ ok: false, error: e.message });
            }
          } else {
            resolve({ ok: false, error: err || `Exit code ${code}` });
          }
        });
      });
      return res;
    } else {
      if (!fs.existsSync(tesseractPath))
        return { ok: false, error: "Tesseract path not found." };
      const res = layoutOptions.layoutMode === "box_notes"
        ? await runLayoutAwareTesseractOcr({
          imagePath,
          outBase,
          tesseractPath,
          lang,
          settings,
          layoutOptions,
        })
        : await runStandardTesseractOcr({
          imagePath,
          outBase,
          tesseractPath,
          lang,
        });
      sendToAllWindows("ocr-progress", {
        file: path.basename(imagePath),
        index: 1,
        total: 1,
        ok: !!res.ok,
        error: res.ok ? null : (res.error || "OCR failed."),
      });
      sendToAllWindows("ocr-complete", { total: 1 });
      ocrState.running = false;
      if (res.ok) {
        const content = typeof res.text === "string"
          ? res.text
          : (fs.existsSync(expectedTxtPath) ? fs.readFileSync(expectedTxtPath, "utf-8") : "");
        return {
          ok: true,
          text: content,
          layoutDetected: !!res.layoutDetected,
          fallbackReason: res.fallbackReason || null,
          outsideZones: Array.isArray(res.outsideZones) ? res.outsideZones : [],
        };
      }
      return res;
    }
  } finally {
    try { prepared.cleanup && prepared.cleanup() } catch (_) {}
  }
});

ipcMain.handle("run-ocr-openai", async (_event, payload) => {
  const imagePath = payload && typeof payload.imagePath === "string" ? payload.imagePath : "";
  const txtPath = payload && typeof payload.txtPath === "string" ? payload.txtPath : "";
  const model = payload && typeof payload.model === "string" ? payload.model : "gpt-4.1";
  const settings = readSettings();
  const layoutOptions = resolveOcrLayoutOptions(payload, settings);
  if (!imagePath || !txtPath) return { ok: false, error: "Image and text paths required" };
  if (!fs.existsSync(imagePath)) return { ok: false, error: "Image file not found." };

  ocrState = { running: true, total: 1, completed: 0, lastFile: path.basename(imagePath) };
  sendToAllWindows("ocr-progress", { file: path.basename(imagePath), index: 0, total: 1, ok: true, error: null });

  let prepared = null;
  try {
    prepared = await prepareOcrSingleImage(imagePath);
    const ocrInputPath = prepared.path;
    const status = getDbStatus();
    if (!status.ok) await initMySql();
    const item = await getApiSettingByName("openai");
    if (!item || !item.api_key) return { ok: false, error: 'API key "openai" tidak ditemukan.' };

    const sysPrompt = (await getActivePromptText("ocr_openai")) || `You are an OCR engine for Arabic manuscripts.

Return ONLY the transcribed text.
Keep original line breaks.
Do NOT translate.
Do NOT add explanations.`;
    const result = layoutOptions.layoutMode === "box_notes"
      ? await runLayoutAwareOpenAiOcr({
        imagePath,
        txtPath,
        model,
        settings,
        layoutOptions,
        apiKey: item.api_key,
        sysPrompt,
      })
      : await runOpenAiOcrImage({
        inputPath: ocrInputPath,
        model,
        apiKey: item.api_key,
        sysPrompt,
        userText: "Transcribe the Arabic text in this image.",
      });
    if (!result.ok) {
      ocrState.running = false;
      sendToAllWindows("ocr-progress", { file: path.basename(imagePath), index: 1, total: 1, ok: false, error: result.error || "OpenAI OCR error" });
      sendToAllWindows("ocr-complete", { total: 1 });
      return { ok: false, error: result.error || "OpenAI OCR error" };
    }
    const textOut = String(result.text || "");
    if (layoutOptions.layoutMode !== "box_notes") {
      try {
        fs.writeFileSync(txtPath, textOut, "utf-8");
      } catch (e) {
        ocrState.running = false;
        sendToAllWindows("ocr-progress", { file: path.basename(imagePath), index: 1, total: 1, ok: false, error: e.message });
        sendToAllWindows("ocr-complete", { total: 1 });
        return { ok: false, error: e.message };
      }
    }

    ocrState.running = false;
    sendToAllWindows("ocr-progress", { file: path.basename(imagePath), index: 1, total: 1, ok: true, error: null });
    sendToAllWindows("ocr-complete", { total: 1 });
    return {
      ok: true,
      text: textOut,
      layoutDetected: !!result.layoutDetected,
      fallbackReason: result.fallbackReason || null,
      outsideZones: Array.isArray(result.outsideZones) ? result.outsideZones : [],
    };
  } catch (e) {
    ocrState.running = false;
    sendToAllWindows("ocr-progress", { file: path.basename(imagePath), index: 1, total: 1, ok: false, error: e.message });
    sendToAllWindows("ocr-complete", { total: 1 });
    return { ok: false, error: e.message };
  } finally {
    try { prepared && prepared.cleanup && prepared.cleanup() } catch (_) {}
  }
});

ipcMain.handle("join-text", async (_event, payload) => {
  const { textFolder } = payload;
  if (!textFolder) return { ok: false, error: "Text folder required." };
  if (!fs.existsSync(textFolder))
    return { ok: false, error: "Text folder not found." };

  const files = fs
    .readdirSync(textFolder)
    .filter((f) => f.toLowerCase().endsWith(".txt"))
    .map((f) => path.join(textFolder, f));
  if (files.length === 0) return { ok: false, error: "No .txt files found." };
  const sorted = sortNumericByBaseName(files);

  const outPath = path.join(textFolder, "all_pages.txt");
  const headerStart = "***** MULAI GABUNGAN TEKS *****\n\n";
  const headerEnd = "\n***** SELESAI *****\n";
  let content = headerStart;
  for (const f of sorted) {
    const base = baseNameNoExt(f);
    content += `[===== ${base} =====]\n`;
    content += fs.readFileSync(f, "utf-8");
    content += "\n\n";
  }
  content += headerEnd;
  fs.writeFileSync(outPath, content, "utf-8");
  return { ok: true, output: outPath };
});

function listGeneratedImages(dir, baseName) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir);
  return files
    .filter(
      (f) =>
        f.toLowerCase().endsWith(".jpg") || f.toLowerCase().endsWith(".png"),
    )
    .filter(
      (f) =>
        f.startsWith(baseName + "-") ||
        f.startsWith(baseName + "_") ||
        f.startsWith(baseName),
    )
    .map((f) => path.join(dir, f))
    .sort();
}

function listAllImages(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir);
  return files
    .filter(
      (f) =>
        f.toLowerCase().endsWith(".jpg") || f.toLowerCase().endsWith(".png"),
    )
    .map((f) => path.join(dir, f));
}

function extractTrailingNumber(filePath) {
  const base = path.parse(filePath).name;
  const m = base.match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : NaN;
}

function renameFilesToNumeric(files) {
  if (!files || files.length === 0) return [];
  const dir = path.dirname(files[0]);
  const sorted = [...files].sort((a, b) => {
    const na = extractTrailingNumber(a);
    const nb = extractTrailingNumber(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
  const result = [];
  let n = 1;
  for (const src of sorted) {
    const ext = path.extname(src).toLowerCase() || ".jpg";
    let candidate;
    // Find next available number to avoid overwriting existing files
    while (true) {
      candidate = path.join(dir, String(n).padStart(3, "0") + ext);
      if (!fs.existsSync(candidate)) break;
      n += 1;
    }
    try {
      fs.renameSync(src, candidate);
      result.push(candidate);
      n += 1;
    } catch (e) {
      // If rename fails, keep original path in the list
      result.push(src);
    }
  }
  return result;
}

function cleanupDirSafe(dirPath) {
  try {
    if (!dirPath) return;
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (_) {}
}

async function convertWithMagick(
  pdfPath,
  outputFolder,
  density = 200,
  quality = 90,
  magickPath,
) {
  const base = path.parse(pdfPath).name;
  ensureDir(outputFolder);
  const tempDir = path.join(outputFolder, ".magick_tmp");
  ensureDir(tempDir);
  const outPattern = path.join(outputFolder, `${base}-%03d.jpg`);
  // Try provided path or command name
  const candidate = magickPath || "magick";
  const gs = findGhostscriptExe();
  const extraPath = gs ? [path.dirname(gs)] : [];
  const env = {
    MAGICK_TMPDIR: tempDir,
    MAGICK_TEMPORARY_PATH: tempDir,
    TMP: tempDir,
    TEMP: tempDir,
  };

  const args = [
    "-limit",
    "area",
    "512MiB",
    "-limit",
    "memory",
    "1GiB",
    "-limit",
    "map",
    "4GiB",
    "-density",
    String(density),
    pdfPath,
    "-quality",
    String(quality),
    outPattern,
  ];

  try {
    let res = await spawnTool(candidate, args, { extraPath, env });
    if (res.code === 0) {
      const generated = listGeneratedImages(outputFolder, base);
      const renamed = renameFilesToNumeric(generated);
      return { ok: true, files: renamed };
    }
    // If ENOENT or failure, attempt to locate
    const loc = findMagickExe();
    if (loc) {
      res = await spawnTool(loc, args, { extraPath, env });
      if (res.code === 0) {
        const generated = listGeneratedImages(outputFolder, base);
        const renamed = renameFilesToNumeric(generated);
        return { ok: true, files: renamed };
      }
    }
    return { ok: false, error: res.err || "magick not found" };
  } finally {
    cleanupDirSafe(tempDir);
  }
}

async function getPdfPageCountWithMagick(
  pdfPath,
  magickExe,
  extraPath = [],
  env = undefined,
) {
  const cmd = magickExe || "magick";
  const res = await spawnTool(
    cmd,
    ["identify", "-ping", "-format", "%n", pdfPath],
    { extraPath, env },
  );
  if (res.code !== 0) return null;
  const raw = String(res.out || "").trim();
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n <= 0 || n > 100000)
    return null;
  return n;
}

async function convertWithMagickChunked(
  pdfPath,
  outputFolder,
  density = 200,
  quality = 90,
  magickPath,
  chunkSize = 20,
  chunkDelay = 3000,
) {
  const base = path.parse(pdfPath).name;
  ensureDir(outputFolder);
  const tempDir = path.join(outputFolder, ".magick_tmp");
  ensureDir(tempDir);
  const outPattern = path.join(outputFolder, `${base}-%03d.jpg`);

  const gs = findGhostscriptExe();
  const extraPath = gs ? [path.dirname(gs)] : [];
  const env = {
    MAGICK_TMPDIR: tempDir,
    MAGICK_TEMPORARY_PATH: tempDir,
    TMP: tempDir,
    TEMP: tempDir,
  };
  const exe = magickPath || findMagickExe() || "magick";
  const pageCount = await getPdfPageCountWithMagick(
    pdfPath,
    exe,
    extraPath,
    env,
  );
  if (!pageCount || pageCount <= chunkSize) {
    return convertWithMagick(
      pdfPath,
      outputFolder,
      density,
      quality,
      magickPath,
    );
  }

  try {
    let converted = 0;
    const allFiles = [];
    mainWindow?.webContents?.send("pdf-convert-progress", {
      completed: 0,
      total: pageCount,
    });

    for (let start1 = 1; start1 <= pageCount; start1 += chunkSize) {
      const end1 = Math.min(pageCount, start1 + chunkSize - 1);
      const start0 = start1 - 1;
      const end0 = end1 - 1;
      const inputRange = `${pdfPath}[${start0}-${end0}]`;

      const args = [
        "-limit",
        "area",
        "512MiB",
        "-limit",
        "memory",
        "1GiB",
        "-limit",
        "map",
        "4GiB",
        "-density",
        String(density),
        inputRange,
        "-quality",
        String(quality),
        "-scene",
        String(start0),
        outPattern,
      ];
      const res = await spawnTool(exe, args, { extraPath, env });
      if (res.code !== 0) {
        return {
          ok: false,
          error: res.err || `magick exited with code ${res.code}`,
        };
      }

      const generated = listGeneratedImages(outputFolder, base);
      const renamed = renameFilesToNumeric(generated);
      allFiles.push(...renamed);
      converted += renamed.length;
      mainWindow?.webContents?.send("pdf-convert-progress", {
        completed: converted,
        total: pageCount,
      });
      if (end1 < pageCount) await delayMs(chunkDelay);
    }

    mainWindow?.webContents?.send("pdf-convert-complete", {
      total: pageCount,
      completed: pageCount,
      files: allFiles.length,
    });
    return { ok: true, files: allFiles };
  } finally {
    cleanupDirSafe(tempDir);
  }
}

async function convertWithPdftoppm(
  pdfPath,
  outputFolder,
  density = 200,
  pdftoppmPath,
) {
  const base = path.parse(pdfPath).name;
  ensureDir(outputFolder);
  const outBase = path.join(outputFolder, base);
  const candidate = pdftoppmPath || "pdftoppm";
  let res = await spawnTool(candidate, [
    "-jpeg",
    "-r",
    String(density),
    pdfPath,
    outBase,
  ]);
  if (res.code === 0) {
    const generated = listGeneratedImages(outputFolder, base);
    const renamed = renameFilesToNumeric(generated);
    return { ok: true, files: renamed };
  }
  // Attempt to locate
  const loc = findPdftoppmExe();
  if (loc) {
    res = await spawnTool(loc, [
      "-jpeg",
      "-r",
      String(density),
      pdfPath,
      outBase,
    ]);
    if (res.code === 0) {
      const generated = listGeneratedImages(outputFolder, base);
      const renamed = renameFilesToNumeric(generated);
      return { ok: true, files: renamed };
    }
  }
  return { ok: false, error: res.err || "pdftoppm not found" };
}

async function convertWithPdftoppmChunked(
  pdfPath,
  outputFolder,
  density = 200,
  pdftoppmPath,
  chunkSize = 20,
  chunkDelay = 3000,
) {
  const base = path.parse(pdfPath).name;
  ensureDir(outputFolder);
  const outBase = path.join(outputFolder, base);

  const exe = pdftoppmPath || findPdftoppmExe() || "pdftoppm";
  const pageCount = await getPdfPageCount(pdfPath, exe);
  if (!pageCount || pageCount <= chunkSize) {
    return convertWithPdftoppm(pdfPath, outputFolder, density, pdftoppmPath);
  }

  let converted = 0;
  const allFiles = [];
  mainWindow?.webContents?.send("pdf-convert-progress", {
    completed: 0,
    total: pageCount,
  });

  for (let start = 1; start <= pageCount; start += chunkSize) {
    const end = Math.min(pageCount, start + chunkSize - 1);
    const res = await spawnTool(exe, [
      "-jpeg",
      "-r",
      String(density),
      "-f",
      String(start),
      "-l",
      String(end),
      pdfPath,
      outBase,
    ]);
    if (res.code !== 0) {
      return {
        ok: false,
        error: res.err || `pdftoppm exited with code ${res.code}`,
      };
    }
    const generated = listGeneratedImages(outputFolder, base);
    const renamed = renameFilesToNumeric(generated);
    allFiles.push(...renamed);
    converted += renamed.length;
    mainWindow?.webContents?.send("pdf-convert-progress", {
      completed: converted,
      total: pageCount,
    });
    if (end < pageCount) await delayMs(chunkDelay);
  }

  mainWindow?.webContents?.send("pdf-convert-complete", {
    total: pageCount,
    completed: pageCount,
    files: allFiles.length,
  });
  return { ok: true, files: allFiles };
}

async function convertWithGhostscript(
  pdfPath,
  outputFolder,
  density = 200,
  quality = 90,
  ghostscriptPath,
) {
  const base = path.parse(pdfPath).name;
  ensureDir(outputFolder);
  const outPattern = path.join(outputFolder, `${base}-%03d.jpg`);
  const gsFound = ghostscriptPath || findGhostscriptExe();
  const gsExe = gsFound || "gswin64c";
  const extraPath = gsFound ? [path.dirname(gsFound)] : [];
  const args = [
    "-dSAFER",
    "-dBATCH",
    "-dNOPAUSE",
    "-sDEVICE=jpeg",
    `-r${String(density)}`,
    `-dJPEGQ=${String(quality)}`,
    `-sOutputFile=${outPattern}`,
    pdfPath,
  ];
  const res = await spawnTool(gsExe, args, { extraPath });
  if (res.code !== 0)
    return {
      ok: false,
      error: res.err || `ghostscript exited with code ${res.code}`,
    };
  const generated = listGeneratedImages(outputFolder, base);
  const renamed = renameFilesToNumeric(generated);
  return { ok: true, files: renamed };
}

async function convertWithGhostscriptChunked(
  pdfPath,
  outputFolder,
  density = 200,
  quality = 90,
  ghostscriptPath,
  chunkSize = 20,
  chunkDelay = 3000,
) {
  const base = path.parse(pdfPath).name;
  ensureDir(outputFolder);
  const outPattern = path.join(outputFolder, `${base}-%03d.jpg`);

  const gsFound = ghostscriptPath || findGhostscriptExe();
  const gsExe = gsFound || "gswin64c";
  const extraPath = gsFound ? [path.dirname(gsFound)] : [];

  const pageCount = await getPdfPageCountWithGhostscript(
    pdfPath,
    gsExe,
    extraPath,
  );
  if (!pageCount || pageCount <= chunkSize) {
    return convertWithGhostscript(
      pdfPath,
      outputFolder,
      density,
      quality,
      ghostscriptPath,
    );
  }

  let converted = 0;
  const allFiles = [];
  mainWindow?.webContents?.send("pdf-convert-progress", {
    completed: 0,
    total: pageCount,
  });

  for (let start = 1; start <= pageCount; start += chunkSize) {
    const end = Math.min(pageCount, start + chunkSize - 1);
    const args = [
      "-dSAFER",
      "-dBATCH",
      "-dNOPAUSE",
      "-sDEVICE=jpeg",
      `-r${String(density)}`,
      `-dJPEGQ=${String(quality)}`,
      `-dFirstPage=${String(start)}`,
      `-dLastPage=${String(end)}`,
      `-sOutputFile=${outPattern}`,
      pdfPath,
    ];
    const res = await spawnTool(gsExe, args, { extraPath });
    if (res.code !== 0) {
      return {
        ok: false,
        error: res.err || `ghostscript exited with code ${res.code}`,
      };
    }
    const generated = listGeneratedImages(outputFolder, base);
    const renamed = renameFilesToNumeric(generated);
    allFiles.push(...renamed);
    converted += renamed.length;
    mainWindow?.webContents?.send("pdf-convert-progress", {
      completed: converted,
      total: pageCount,
    });
    if (end < pageCount) await delayMs(chunkDelay);
  }

  mainWindow?.webContents?.send("pdf-convert-complete", {
    total: pageCount,
    completed: pageCount,
    files: allFiles.length,
  });
  return { ok: true, files: allFiles };
}

ipcMain.handle("convert-pdf", async (_event, payload) => {
  const {
    pdfPath,
    outputFolder,
    density = 200,
    quality = 90,
    magickPath,
    pdftoppmPath,
  } = payload || {};
  if (!pdfPath || !outputFolder)
    return { ok: false, error: "PDF path dan output folder diperlukan." };
  if (!fs.existsSync(pdfPath))
    return { ok: false, error: "File PDF tidak ditemukan." };
  ensureDir(outputFolder);
  cleanupDirSafe(path.join(outputFolder, ".magick_tmp"));

  const popplerExe = pdftoppmPath || findPdftoppmExe();
  if (popplerExe) {
    const pages = await getPdfPageCount(pdfPath, popplerExe);
    if (pages && pages > 20) {
      const chunked = await convertWithPdftoppmChunked(
        pdfPath,
        outputFolder,
        density,
        pdftoppmPath,
        20,
        3000,
      );
      if (chunked.ok) return chunked;
    }
    const popplerRes = await convertWithPdftoppm(
      pdfPath,
      outputFolder,
      density,
      pdftoppmPath,
    );
    if (popplerRes.ok) return popplerRes;
  }

  const gs = findGhostscriptExe();
  if (gs) {
    const gsRes = await convertWithGhostscriptChunked(
      pdfPath,
      outputFolder,
      density,
      quality,
      gs,
      20,
      3000,
    );
    if (gsRes.ok) return gsRes;
    return {
      ok: false,
      error: `Ghostscript gagal: ${gsRes.error || "unknown error"}`,
    };
  }

  const magickRes = await convertWithMagickChunked(
    pdfPath,
    outputFolder,
    density,
    quality,
    magickPath,
    20,
    3000,
  );
  if (magickRes.ok) return magickRes;
  return {
    ok: false,
    error: `Converter tidak ditemukan atau gagal berjalan. Coba install Poppler atau Ghostscript. Detail: magick: ${magickRes.error}`,
  };
});

ipcMain.handle("split-pdf", async (_event, payload) => {
  try {
    const { pdfPath, outputFolder, ranges } = payload || {};
    if (!pdfPath || !outputFolder) {
      return { ok: false, error: "PDF path dan output folder diperlukan." };
    }
    if (!fs.existsSync(pdfPath)) {
      return { ok: false, error: "File PDF tidak ditemukan." };
    }
    ensureDir(outputFolder);

    if (!Array.isArray(ranges) || ranges.length === 0) {
      return { ok: false, error: "Range halaman diperlukan." };
    }

    const gsExe = findGhostscriptExe();
    if (!gsExe) {
      return {
        ok: false,
        error:
          "Ghostscript tidak ditemukan. Install Ghostscript atau set path Ghostscript di settings.json.",
      };
    }

    const baseName = path.parse(pdfPath).name || "output";
    const sanitize = (name) =>
      String(name || "")
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);

    const makeUnique = (outPath) => {
      if (!fs.existsSync(outPath)) return outPath;
      const dir = path.dirname(outPath);
      const parsed = path.parse(outPath);
      for (let i = 2; i <= 9999; i++) {
        const candidate = path.join(dir, `${parsed.name}_${i}${parsed.ext}`);
        if (!fs.existsSync(candidate)) return candidate;
      }
      return outPath;
    };

    const outputs = [];
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i] || {};
      let from = parseInt(String(r.from || "").trim(), 10);
      let to = parseInt(String(r.to || "").trim(), 10);
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) continue;
      if (from <= 0 || to <= 0) continue;
      if (from > to) [from, to] = [to, from];

      const custom = sanitize(r.name);
      const suffix = custom ? `${custom}_p${from}-${to}` : `p${from}-${to}`;
      const rawOut = path.join(
        outputFolder,
        `${sanitize(baseName)}_${suffix}.pdf`,
      );
      const outputPath = makeUnique(rawOut);

      const args = [
        "-dSAFER",
        "-dBATCH",
        "-dNOPAUSE",
        "-sDEVICE=pdfwrite",
        `-dFirstPage=${String(from)}`,
        `-dLastPage=${String(to)}`,
        `-sOutputFile=${outputPath}`,
        pdfPath,
      ];
      const res = await spawnTool(gsExe, args);
      if (res.code !== 0) {
        return {
          ok: false,
          error: res.err || `ghostscript exited with code ${res.code}`,
        };
      }
      outputs.push({ from, to, outputPath });
    }

    if (outputs.length === 0) {
      return { ok: false, error: "Tidak ada range valid untuk diproses." };
    }

    return { ok: true, outputs };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle("get-defaults", () => {
  const s = readSettings();
  const semanticTuning = getSemanticTuningSettings();
  const ragSearch = getRagSearchSettings();
  const ocrLayout = normalizeOcrLayoutSettings(s);
  const inputFolder =
    s.inputFolder || "E:\\BOOK\\scanned_syarah_dalail\\1-50";
  const outputFolder =
    s.outputFolder || path.dirname(inputFolder) || "E:\\BOOK\\scanned_syarah_dalail\\text";
  const translateProviderId = (() => {
    const n = Number(s.translateProviderId);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  })();
  return {
    inputFolder,
    outputFolder,
    tesseractPath:
      s.tesseractPath || "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
    lang: s.lang || "ara",
    ocrEngine: s.ocrEngine || "tesseract",
    translateAi: s.translateAi || "gemini",
    translateProviderId,
    openAiModel: s.openAiModel || "gpt-4o-mini",
    geminiModel: s.geminiModel || "gemini-1.5-flash-latest",
    ocrLayoutMode: ocrLayout.ocrLayoutMode,
    ocrBoxPaddingPct: ocrLayout.ocrBoxPaddingPct,
    ocrNotePaddingPct: ocrLayout.ocrNotePaddingPct,
    ocrOutsideFormat: ocrLayout.ocrOutsideFormat,
    semanticTuning,
    ragSearch,
  };
});
function tryPaths(paths) {
  for (const p of paths) {
    if (!p) continue;
    const s = String(p || "").trim();
    if (!s) continue;
    const isCmd =
      !s.includes("\\") && !s.includes("/") && !/^[a-zA-Z]:/.test(s);
    if (isCmd) return s;
    if (fs.existsSync(s)) return s;
  }
  return null;
}

function findMagickExe() {
  const s = readSettings();
  const envHome = process.env.MAGICK_HOME;
  const candidates = [];
  if (s.magickPath) candidates.push(s.magickPath);
  if (envHome) candidates.push(path.join(envHome, "magick.exe"));
  candidates.push("C:\\Windows\\System32\\magick.exe");
  // Scan common install dirs
  const roots = ["C:\\Program Files", "C:\\Program Files (x86)"];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs
      .readdirSync(root)
      .filter((d) => d.toLowerCase().startsWith("imagemagick"));
    dirs.sort().reverse();
    for (const d of dirs) {
      candidates.push(path.join(root, d, "magick.exe"));
    }
  }
  return tryPaths(candidates);
}

function findPdftoppmExe() {
  const s = readSettings();
  const envHome = process.env.POPPLER_HOME;
  const candidates = [];
  if (s.pdftoppmPath) candidates.push(s.pdftoppmPath);
  if (envHome) candidates.push(path.join(envHome, "bin", "pdftoppm.exe"));
  candidates.push("C:\\ProgramData\\chocolatey\\bin\\pdftoppm.exe");
  // Scan common install dirs
  const roots = ["C:\\Program Files", "C:\\Program Files (x86)"];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs
      .readdirSync(root)
      .filter((d) => d.toLowerCase().startsWith("poppler"));
    dirs.sort().reverse();
    for (const d of dirs) {
      candidates.push(path.join(root, d, "bin", "pdftoppm.exe"));
      candidates.push(path.join(root, d, "Library", "bin", "pdftoppm.exe"));
    }
  }
  return tryPaths(candidates);
}

function findPdfinfoExeFromPdftoppm(pdftoppmExe) {
  if (!pdftoppmExe || !fs.existsSync(pdftoppmExe)) return null;
  const dir = path.dirname(pdftoppmExe);
  return tryPaths([
    path.join(dir, "pdfinfo.exe"),
    path.join(dir, "pdfinfo64.exe"),
  ]);
}

async function getPdfPageCount(pdfPath, pdftoppmExe) {
  const pdfinfoExe = findPdfinfoExeFromPdftoppm(pdftoppmExe) || "pdfinfo";
  const res = await spawnTool(pdfinfoExe, [pdfPath]);
  if (res.code !== 0) return null;
  const txt = String(res.out || res.err || "");
  const m = txt.match(/Pages:\s+(\d+)/i);
  if (!m || !m[1]) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function pathToPsLiteral(p) {
  const s = String(p || "").replace(/\\/g, "/");
  return s.replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

async function getPdfPageCountWithGhostscript(
  pdfPath,
  ghostscriptExe,
  extraPath = [],
) {
  const cmd = ghostscriptExe || "gswin64c";
  const ps = `(${pathToPsLiteral(
    pdfPath,
  )}) (r) file runpdfbegin pdfpagecount == quit`;
  const res = await spawnTool(cmd, ["-q", "-dNODISPLAY", "-c", ps], {
    extraPath,
  });
  if (res.code !== 0) return null;
  const raw = String(res.out || "").trim();
  const m = raw.match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n <= 0 || n > 100000)
    return null;
  return n;
}

function delayMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findGhostscriptExe() {
  const s = readSettings();
  const candidates = [];
  if (s.ghostscriptPath) candidates.push(s.ghostscriptPath);
  const envGS = process.env.GHOSTSCRIPT_HOME || process.env.GS_HOME;
  if (envGS) {
    candidates.push(path.join(envGS, "bin", "gswin64c.exe"));
    candidates.push(path.join(envGS, "bin", "gswin32c.exe"));
  }
  candidates.push("C:\\Windows\\System32\\gswin64c.exe");
  candidates.push("C:\\Windows\\System32\\gswin32c.exe");
  // Common installs under C:\Program Files\gs\gsX.YY.Z\bin
  const roots = ["C:\\Program Files", "C:\\Program Files (x86)"];
  for (const root of roots) {
    const gsRoot = path.join(root, "gs");
    if (!fs.existsSync(gsRoot)) continue;
    const dirs = fs
      .readdirSync(gsRoot)
      .filter((d) => d.toLowerCase().startsWith("gs"));
    dirs.sort().reverse();
    for (const d of dirs) {
      candidates.push(path.join(gsRoot, d, "bin", "gswin64c.exe"));
      candidates.push(path.join(gsRoot, d, "bin", "gswin32c.exe"));
    }
  }
  // Chocolatey common bin
  candidates.push("C:\\ProgramData\\chocolatey\\bin\\gswin64c.exe");
  candidates.push("C:\\ProgramData\\chocolatey\\bin\\gswin32c.exe");
  return tryPaths(candidates);
}

function spawnTool(cmd, args, options = {}) {
  return new Promise((resolve) => {
    try {
      const env = { ...process.env };
      if (
        options.extraPath &&
        Array.isArray(options.extraPath) &&
        options.extraPath.length > 0
      ) {
        const extra = options.extraPath.filter(Boolean).join(";");
        env.PATH = env.PATH ? `${env.PATH};${extra}` : extra;
      }
      if (options.env && typeof options.env === "object") {
        Object.assign(env, options.env);
      }
      const proc = spawn(cmd, args, { env });
      let settled = false;
      let timer = null;
      let out = "";
      let err = "";
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      };
      const timeoutMs = Number(options.timeoutMs) || 0;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          try { proc.kill() } catch (_) {}
          finish({
            code: -2,
            err: `Process timeout after ${timeoutMs}ms: ${cmd}`,
            out,
          });
        }, timeoutMs);
      }
      proc.stdout.on("data", (d) => {
        out += d.toString();
      });
      proc.stderr.on("data", (d) => {
        err += d.toString();
      });
      proc.on("exit", (code) => {
        finish({ code, err, out });
      });
      proc.on("error", (e) => finish({ code: -1, err: e.message, out: "" }));
    } catch (e) {
      resolve({ code: -1, err: e.message, out: "" });
    }
  });
}

function findPythonExe() {
  const s = readSettings();
  const candidates = [];
  const engineBase = app.isPackaged ? process.resourcesPath : process.cwd();
  if (s.pythonPath) candidates.push(s.pythonPath);
  // Prefer local venv inside the Arabic-Handwritten-OCR engine if present
  candidates.push(
    path.join(
      engineBase,
      "engines",
      "Arabic-Handwritten-OCR",
      ".venv",
      "Scripts",
      "python.exe",
    ),
  );
  candidates.push("py");
  candidates.push("python");
  return tryPaths(candidates) || (process.platform === "win32" ? "py" : "python");
}

// Engine-aware Python discovery to avoid importing wrong site-packages
function findPythonExeForEngine(engine) {
  const s = readSettings();
  const candidates = [];
  const engineBase = app.isPackaged ? process.resourcesPath : process.cwd();
  if (s.pythonPath) candidates.push(s.pythonPath);
  if (engine === "arabic_dl") {
    candidates.push(
      path.join(
        engineBase,
        "engines",
        "Arabic-Handwritten-OCR",
        ".venv",
        "Scripts",
        "python.exe",
      ),
    );
  } else if (engine === "easyocr") {
    candidates.push(
      path.join(
        engineBase,
        "engines",
        "EasyOCR",
        ".venv",
        "Scripts",
        "python.exe",
      ),
    );
  } else if (engine === "kraken" || engine === "kraken_arabic") {
    candidates.push(
      path.join(
        engineBase,
        "engines",
        "Kraken",
        ".venv",
        "Scripts",
        "python.exe",
      ),
    );
    candidates.push(
      path.join(
        engineBase,
        "engines",
        "KrakenOCR",
        ".venv",
        "Scripts",
        "python.exe",
      ),
    );
    candidates.push(
      path.join(
        engineBase,
        "engines",
        "kraken",
        ".venv",
        "Scripts",
        "python.exe",
      ),
    );
  } else if (engine === "unlimited_ocr") {
    candidates.push(
      path.join(
        engineBase,
        "engines",
        "Unlimited-OCR",
        ".venv",
        "Scripts",
        "python.exe",
      ),
    );
    candidates.push(
      path.join(
        engineBase,
        "engines",
        "Unlimited-OCR-local",
        ".venv",
        "Scripts",
        "python.exe",
      ),
    );
  }
  // Removed PaddleOCR venv preference
  // Fallbacks: try other venvs then system
  candidates.push(
    path.join(
      engineBase,
      "engines",
      "Arabic-Handwritten-OCR",
      ".venv",
      "Scripts",
      "python.exe",
    ),
  );
  // Removed PaddleOCR venv fallback
  candidates.push("py");
  candidates.push("python");
  return tryPaths(candidates) || (process.platform === "win32" ? "py" : "python");
}

function resolveUnlimitedOcrModelDir(settings) {
  const engineBase = app.isPackaged ? process.resourcesPath : process.cwd();
  const configured =
    settings && typeof settings.unlimitedOcrModelDir === "string"
      ? settings.unlimitedOcrModelDir.trim()
      : "";
  if (configured) return configured;
  return path.join(engineBase, "engines", "Unlimited-OCR-local");
}

function buildUnlimitedOcrEnv() {
  return {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
  };
}

ipcMain.handle("run-ocr-dl", async (_event, payload) => {
  const { inputFolder, outputFolder, lang } = payload || {};
  if (!inputFolder || !outputFolder) {
    return { ok: false, error: "Input and output folder are required." };
  }
  if (!fs.existsSync(inputFolder))
    return { ok: false, error: "Input folder not found." };
  ensureDir(outputFolder);

  const prep = await prepareOcrFolder(inputFolder);
  const scriptPath = path.join(
    app.isPackaged ? process.resourcesPath : process.cwd(),
    "engines",
    "run_arabic_dl.py",
  );
  if (!fs.existsSync(scriptPath)) {
    prep.cleanup();
    return {
      ok: false,
      error: "Arabic DL engine wrapper not found at engines/run_arabic_dl.py",
    };
  }

  const pythonExe = findPythonExeForEngine("arabic_dl");
  const args = [
    scriptPath,
    "--input",
    prep.folder,
    "--output",
    outputFolder,
    "--lang",
    lang || "ara",
  ];
  const s = readSettings();
  if (s && s.tesseractPath) {
    args.push("--tesseract-path", s.tesseractPath);
  }
  let total = 0;
  let completed = 0;

  ocrState = { running: true, total: 0, completed: 0, lastFile: null };
  return await new Promise((resolve) => {
    const proc = spawn(pythonExe, args, {
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    let err = "";
    proc.stdout.on("data", (d) => {
      const line = d.toString().trim();
      if (line.startsWith("PROGRESS ")) {
        const parts = line.split(" ");
        const file = parts[1];
        completed = parseInt(parts[2], 10) || completed;
        total = parseInt(parts[3], 10) || total;
        ocrState = { running: true, total, completed, lastFile: file };
        sendToAllWindows("ocr-progress", {
          file,
          index: completed,
          total,
          ok: true,
          error: null,
        });
      } else if (line.startsWith("TOTAL ")) {
        total = parseInt(line.split(" ")[1], 10) || total;
        ocrState.total = total;
      }
    });
    proc.stderr.on("data", (d) => {
      err += d.toString();
    });
    proc.on("exit", (code) => {
      sendToAllWindows("ocr-complete", { total });
      ocrState.running = false;
      prep.cleanup();
      if (code === 0) {
        resolve({ ok: true, total });
      } else {
        resolve({
          ok: false,
          error: err || `Arabic DL engine exited with code ${code}`,
        });
      }
    });
    proc.on("error", (e) => {
      ocrState.running = false;
      prep.cleanup();
      resolve({ ok: false, error: e.message });
    });
  });
});

// EasyOCR handler
// EasyOCR handler
ipcMain.handle("run-ocr-easy", async (_event, payload) => {
  const { inputFolder, outputFolder, lang } = payload || {};
  if (!inputFolder || !outputFolder) {
    return { ok: false, error: "Input and output folder are required." };
  }
  if (!fs.existsSync(inputFolder))
    return { ok: false, error: "Input folder not found." };
  ensureDir(outputFolder);

  const prep = await prepareOcrFolder(inputFolder);
  const scriptPath = path.join(
    app.isPackaged ? process.resourcesPath : process.cwd(),
    "engines",
    "run_easyocr.py",
  );
  if (!fs.existsSync(scriptPath)) {
    prep.cleanup();
    return {
      ok: false,
      error: "EasyOCR engine wrapper not found at engines/run_easyocr.py",
    };
  }

  const pythonExe = findPythonExeForEngine("easyocr");
  const args = [
    scriptPath,
    "--input",
    prep.folder,
    "--output",
    outputFolder,
    "--lang",
    lang || "ara",
  ];
  let total = 0;
  let completed = 0;

  ocrState = { running: true, total: 0, completed: 0, lastFile: null };
  return await new Promise((resolve) => {
    const proc = spawn(pythonExe, args, {
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    let err = "";
    proc.stdout.on("data", (d) => {
      const line = d.toString().trim();
      if (line.startsWith("PROGRESS ")) {
        const parts = line.split(" ");
        const file = parts[1];
        completed = parseInt(parts[2], 10) || completed;
        total = parseInt(parts[3], 10) || total;
        ocrState = { running: true, total, completed, lastFile: file };
        sendToAllWindows("ocr-progress", {
          file,
          index: completed,
          total,
          ok: true,
          error: null,
        });
      } else if (line.startsWith("TOTAL ")) {
        total = parseInt(line.split(" ")[1], 10) || total;
        ocrState.total = total;
      }
    });
    proc.stderr.on("data", (d) => {
      err += d.toString();
    });
    proc.on("exit", (code) => {
      sendToAllWindows("ocr-complete", { total });
      ocrState.running = false;
      prep.cleanup();
      if (code === 0) {
        resolve({ ok: true, total });
      } else {
        resolve({
          ok: false,
          error: err || `EasyOCR engine exited with code ${code}`,
        });
      }
    });
    proc.on("error", (e) => {
      ocrState.running = false;
      prep.cleanup();
      resolve({ ok: false, error: e.message });
    });
  });
});

// Kraken OCR handler
ipcMain.handle("run-ocr-kraken", async (_event, payload) => {
  const { inputFolder, outputFolder, lang } = payload || {};
  if (!inputFolder || !outputFolder) {
    return { ok: false, error: "Input and output folder are required." };
  }
  if (!fs.existsSync(inputFolder))
    return { ok: false, error: "Input folder not found." };
  ensureDir(outputFolder);

  const prep = await prepareOcrFolder(inputFolder);
  const scriptPath = path.join(
    app.isPackaged ? process.resourcesPath : process.cwd(),
    "engines",
    "run_kraken.py",
  );
  if (!fs.existsSync(scriptPath)) {
    prep.cleanup();
    return {
      ok: false,
      error: "Kraken engine wrapper not found at engines/run_kraken.py",
    };
  }

  const pythonExe = findPythonExeForEngine("kraken");
  const args = [
    scriptPath,
    "--input",
    prep.folder,
    "--output",
    outputFolder,
    "--lang",
    lang || "ara",
  ];
  const s = readSettings();
  const modelPath = (s && (s.krakenArabicModelPath || s.krakenModelPath)) || "";
  if (modelPath) args.push("--model", modelPath);

  let total = 0;
  let completed = 0;

  ocrState = { running: true, total: 0, completed: 0, lastFile: null };
  return await new Promise((resolve) => {
    const proc = spawn(pythonExe, args, {
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    let err = "";
    proc.stdout.on("data", (d) => {
      const line = d.toString().trim();
      if (line.startsWith("PROGRESS ")) {
        const parts = line.split(" ");
        const file = parts[1];
        completed = parseInt(parts[2], 10) || completed;
        total = parseInt(parts[3], 10) || total;
        ocrState = { running: true, total, completed, lastFile: file };
        sendToAllWindows("ocr-progress", {
          file,
          index: completed,
          total,
          ok: true,
          error: null,
        });
      } else if (line.startsWith("TOTAL ")) {
        total = parseInt(line.split(" ")[1], 10) || total;
        ocrState.total = total;
      }
    });
    proc.stderr.on("data", (d) => {
      err += d.toString();
    });
    proc.on("exit", (code) => {
      sendToAllWindows("ocr-complete", { total });
      ocrState.running = false;
      prep.cleanup();
      if (code === 0) {
        resolve({ ok: true, total });
      } else {
        resolve({
          ok: false,
          error: err || `Kraken engine exited with code ${code}`,
        });
      }
    });
    proc.on("error", (e) => {
      ocrState.running = false;
      prep.cleanup();
      resolve({ ok: false, error: e.message });
    });
  });
});

ipcMain.handle("run-ocr-unlimited", async (_event, payload) => {
  const { inputFolder, outputFolder } = payload || {};
  if (!inputFolder || !outputFolder) {
    return { ok: false, error: "Input and output folder are required." };
  }
  if (!fs.existsSync(inputFolder))
    return { ok: false, error: "Input folder not found." };
  ensureDir(outputFolder);

  const prep = await prepareOcrFolder(inputFolder);
  const scriptPath = path.join(
    app.isPackaged ? process.resourcesPath : process.cwd(),
    "engines",
    "run_unlimited_ocr.py",
  );
  if (!fs.existsSync(scriptPath)) {
    prep.cleanup();
    return {
      ok: false,
      error: "Unlimited-OCR engine wrapper not found at engines/run_unlimited_ocr.py",
    };
  }

  const settings = readSettings();
  const modelDir = resolveUnlimitedOcrModelDir(settings);
  if (!fs.existsSync(modelDir)) {
    prep.cleanup();
    return {
      ok: false,
      error:
        `Folder model Unlimited-OCR tidak ditemukan: ${modelDir}. ` +
        "Simpan snapshot lokal model ke folder tersebut atau set `unlimitedOcrModelDir` di settings.json.",
    };
  }

  const pythonExe = findPythonExeForEngine("unlimited_ocr");
  const args = [
    scriptPath,
    "--input",
    prep.folder,
    "--output",
    outputFolder,
    "--model-dir",
    modelDir,
  ];
  let total = 0;
  let completed = 0;

  ocrState = { running: true, total: 0, completed: 0, lastFile: null };
  return await new Promise((resolve) => {
    const proc = spawn(pythonExe, args, {
      shell: false,
      env: buildUnlimitedOcrEnv(),
    });
    let err = "";
    proc.stdout.on("data", (d) => {
      const line = d.toString().trim();
      if (line.startsWith("PROGRESS ")) {
        const parts = line.split(" ");
        const file = parts[1];
        completed = parseInt(parts[2], 10) || completed;
        total = parseInt(parts[3], 10) || total;
        ocrState = { running: true, total, completed, lastFile: file };
        sendToAllWindows("ocr-progress", {
          file,
          index: completed,
          total,
          ok: true,
          error: null,
        });
      } else if (line.startsWith("TOTAL ")) {
        total = parseInt(line.split(" ")[1], 10) || total;
        ocrState.total = total;
      }
    });
    proc.stderr.on("data", (d) => {
      err += d.toString();
    });
    proc.on("exit", (code) => {
      sendToAllWindows("ocr-complete", { total });
      ocrState.running = false;
      prep.cleanup();
      if (code === 0) {
        resolve({ ok: true, total });
      } else {
        resolve({
          ok: false,
          error: err || `Unlimited-OCR engine exited with code ${code}`,
        });
      }
    });
    proc.on("error", (e) => {
      ocrState.running = false;
      prep.cleanup();
      resolve({ ok: false, error: e.message });
    });
  });
});

// Google Vision API handler
ipcMain.handle("run-ocr-vision", async (_event, payload) => {
  const inputFolder = sanitizeFsPath(payload && payload.inputFolder);
  const outputFolder = sanitizeFsPath(payload && payload.outputFolder);
  const lang = payload && payload.lang;
  if (!inputFolder || !outputFolder) {
    return { ok: false, error: "Input and output folder are required." };
  }
  if (!fs.existsSync(inputFolder))
    return { ok: false, error: "Input folder not found." };
  ensureDir(outputFolder);

  const status = getDbStatus();
  if (!status.ok) await initMySql();
  const item =
    (await getApiSettingByName("google_vision")) ||
    (await getApiSettingByName("googlevision")) ||
    (await getApiSettingByName("vision"));
  if (!item || !item.api_key)
    return { ok: false, error: 'API key "google_vision" tidak ditemukan di database.' };

  const apiKey = String(item.api_key || "").trim();
  if (!apiKey) return { ok: false, error: 'API key "google_vision" kosong.' };

  const jpgFiles = sortNumericByBaseName(listImagesForOcr(inputFolder));
  if (jpgFiles.length === 0) {
    return { ok: false, error: "No image files found to process." };
  }

  ocrState = { running: true, total: jpgFiles.length, completed: 0, lastFile: null };
  sendToAllWindows("ocr-progress", {
    file: "(mulai)",
    index: 0,
    total: jpgFiles.length,
    ok: true,
    error: null,
  });
  const langHint = String(lang || "ara").toLowerCase() === "ara" ? "ar" : String(lang || "");

  let completed = 0;
  for (const file of jpgFiles) {
    const prepared = await prepareOcrSingleImage(file);
    const ocrInput = prepared.path || file;
    const outBase = path.join(outputFolder, baseNameNoExt(file));
    const outTxt = outBase + ".txt";

    try {
      const buf = fs.readFileSync(ocrInput);
      const base64 = buf.toString("base64");
      const resp = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: [
              {
                image: { content: base64 },
                features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
                imageContext: langHint ? { languageHints: [langHint] } : undefined,
              },
            ],
          }),
        },
      );
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error((data && data.error && data.error.message) || resp.statusText || "Google Vision API error");
      }

      const outText = String(data?.responses?.[0]?.fullTextAnnotation?.text || "");
      fs.writeFileSync(outTxt, outText, "utf-8");

      completed += 1;
      ocrState = { running: true, total: jpgFiles.length, completed, lastFile: path.basename(file) };
      sendToAllWindows("ocr-progress", {
        file: path.basename(file),
        index: completed,
        total: jpgFiles.length,
        ok: true,
        error: null,
      });
    } catch (err) {
      completed += 1;
      ocrState = { running: true, total: jpgFiles.length, completed, lastFile: path.basename(file) };
      sendToAllWindows("ocr-progress", {
        file: path.basename(file),
        index: completed,
        total: jpgFiles.length,
        ok: false,
        error: err.message,
      });
    } finally {
      try { prepared.cleanup && prepared.cleanup() } catch (_) {}
    }
  }

  sendToAllWindows("ocr-complete", { total: jpgFiles.length });
  ocrState.running = false;
  return { ok: true, total: jpgFiles.length };
});

// OCR status for restoring UI after navigation
ipcMain.handle("get-ocr-status", async () => {
  return { ...ocrState };
});

// Translate status for global indicator
ipcMain.handle("get-translate-status", async () => {
  const q = Math.max(0, translateQueueCount - (translateState.running ? 1 : 0));
  return { ...translateState, queueLength: q };
});
// Removed: PaddleOCR handler
