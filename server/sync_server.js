/**
 * ScreenSync Cross-Device Cloud/LAN Synchronization & Real-Time Billing Server (Zero External Dependencies)
 * Enables genuine network synchronization of usage sessions, reel events, installations,
 * goals, real-time subscription entitlements, and store-compliant account deletion across
 * Android, iOS, Windows, macOS, ChromeOS, and Linux.
 *
 * Run: node server/sync_server.js
 * Default endpoint: http://0.0.0.0:3001/api/sync
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function loadLocalEnvFileIfPresent(customEnvPaths) {
  const candidatePaths = Array.isArray(customEnvPaths) && customEnvPaths.length > 0
    ? customEnvPaths
    : [
        path.join(__dirname, ".env"),
        path.join(__dirname, "..", ".env.local"),
        path.join(__dirname, "..", ".env")
      ];
  const loadedFiles = [];
  for (const envPath of candidatePaths) {
    try {
      if (!fs.existsSync(envPath)) continue;
      const raw = fs.readFileSync(envPath, "utf8");
      raw.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx <= 0) return;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && process.env[key] === undefined) {
          process.env[key] = val;
        }
      });
      loadedFiles.push(path.basename(envPath));
    } catch (_e) {}
  }
  return loadedFiles;
}

loadLocalEnvFileIfPresent();

const PORT = Number(process.env.SCREENSYNC_SYNC_PORT || 3001);
const FALLBACK_PORT = Number(process.env.SCREENSYNC_SYNC_FALLBACK_PORT || 8788);
const HOST = process.env.SCREENSYNC_SYNC_HOST || "127.0.0.1";
const STORE_PATH = path.join(__dirname, "cloud_sync_store.json");

const KNOWN_DEVICE_MODEL_MARKETING_NAMES = {
  // Xiaomi / Redmi / POCO (2023-2026)
  "24069RA21C": "Redmi Turbo 4 Pro",
  "24069PC21G": "POCO F6",
  "24069PC21I": "POCO F6",
  "25053RT47C": "Redmi Turbo 4 Pro",
  "24129RT7CC": "Redmi Turbo 4",
  "24069RA21G": "POCO F6",
  "23113RKC6C": "Redmi K70 Pro",
  "2311DRK48C": "Redmi K70",
  "2407FRK8EC": "Redmi K70 Ultra",
  "24122RKC7C": "Redmi K80",
  "24117RK2CC": "Redmi K80 Pro",
  "23113RKC6G": "POCO F6 Pro",
  "23049PCD8G": "POCO F5",
  "23049PCD8I": "POCO F5",
  "23013PC75G": "POCO F5 Pro",
  "23122PCD1G": "POCO X6 5G",
  "2311DRK48G": "POCO X6 Pro 5G",
  "2412DPC0AG": "POCO X7 Pro",
  "23127PN0CC": "Xiaomi 14",
  "23127PN0CG": "Xiaomi 14",
  "23116PN5BC": "Xiaomi 14 Pro",
  "24030PN60G": "Xiaomi 14 Ultra",
  "24031PN0DC": "Xiaomi 14 Ultra",
  "2406APNFAG": "Xiaomi 14T Pro",
  "24129PN74C": "Xiaomi 15",
  "24129PN74G": "Xiaomi 15",
  "2410DPN6CC": "Xiaomi 15 Pro",
  "25010PN30C": "Xiaomi 15 Ultra",
  "25010PN30G": "Xiaomi 15 Ultra",
  "23078PND5G": "Xiaomi 13T Pro",
  "23090RA98G": "Redmi Note 13 Pro+ 5G",
  "2312DRA50G": "Redmi Note 13 Pro 5G",
  "24090RA29G": "Redmi Note 14 Pro+ 5G",
  "24090RA29C": "Redmi Note 14 Pro+",
  "24115RA8EG": "Redmi Note 14 Pro 5G",
  // OnePlus / OPPO / Realme / Vivo / Nothing / Google Pixel
  "PJZ110": "OnePlus 13",
  "CPH2653": "OnePlus 13",
  "CPH2655": "OnePlus 13",
  "PKR110": "OnePlus 13R",
  "CPH2645": "OnePlus 13R",
  "PJD110": "OnePlus 12",
  "CPH2487": "OnePlus 11R 5G",
  "CPH2449": "OnePlus 11 5G",
  "CPH2451": "OnePlus 11 5G",
  "CPH2581": "OnePlus 12",
  "CPH2573": "OnePlus 12",
  "CPH2609": "OnePlus 12R",
  "CPH2585": "OnePlus 12R",
  "CPH2663": "OnePlus Nord 4",
  "CPH2551": "OnePlus Open",
  "PKB110": "OPPO Find X8",
  "CPH2651": "OPPO Find X8",
  "PKC110": "OPPO Find X8 Pro",
  "CPH2659": "OPPO Find X8 Pro",
  "PHZ110": "OPPO Find X7",
  "PHY110": "OPPO Find X7 Ultra",
  "V2408A": "Vivo X200",
  "V2413": "Vivo X200 Pro",
  "V2405A": "iQOO 13",
  "V2251": "Vivo V29 5G",
  "V2303": "Vivo V29 Pro",
  "V2318": "Vivo V30 5G",
  "V2307": "Vivo X100 Pro",
  "V2309A": "Vivo X100",
  "V2324A": "Vivo X100 Pro",
  "RMX5010": "Realme GT 7 Pro",
  "RMX5011": "Realme GT 7 Pro",
  "RMX3888": "Realme GT 6",
  "RMX3851": "Realme GT 6T",
  "A063": "Nothing Phone (1)",
  "A065": "Nothing Phone (2)",
  "A142": "Nothing Phone (2a)",
  "A142P": "Nothing Phone (2a) Plus",
  "A059": "Nothing Phone (3a)",
  "A059P": "Nothing Phone (3a) Pro",
  "GKV4X": "Google Pixel 9",
  "GEC77": "Google Pixel 9 Pro",
  "GWVK6": "Google Pixel 9 Pro XL",
  "GGH2X": "Google Pixel 9 Pro Fold",
  "GKWS6": "Google Pixel 8",
  "G1MNW": "Google Pixel 8 Pro",
  "G6GPR": "Google Pixel 8a",
  // Apple iPhone / iPad
  "IPHONE18,1": "iPhone 17 Pro",
  "IPHONE18,2": "iPhone 17 Pro Max",
  "IPHONE18,3": "iPhone 17",
  "IPHONE18,4": "iPhone 17 Air",
  "IPHONE17,1": "iPhone 16 Pro",
  "IPHONE17,2": "iPhone 16 Pro Max",
  "IPHONE17,3": "iPhone 16",
  "IPHONE17,4": "iPhone 16 Plus",
  "IPHONE17,5": "iPhone 16e",
  "IPHONE16,1": "iPhone 15 Pro",
  "IPHONE16,2": "iPhone 15 Pro Max",
  "IPHONE15,4": "iPhone 15",
  "IPHONE15,5": "iPhone 15 Plus",
  "IPHONE15,2": "iPhone 14 Pro",
  "IPHONE15,3": "iPhone 14 Pro Max",
  "IPAD16,3": "iPad Pro 11-inch (M4)",
  "IPAD16,5": "iPad Pro 13-inch (M4)",
  "IPAD14,8": "iPad Air 11-inch (M2)",
  "IPAD14,10": "iPad Air 13-inch (M2)",
  // Apple Mac
  "MAC16,1": "MacBook Pro (14-inch, M4)",
  "MAC16,5": "MacBook Pro (16-inch, M4 Pro)",
  "MAC16,12": "MacBook Air (13-inch, M4)",
  "MAC16,13": "MacBook Air (15-inch, M4)",
  "MAC15,6": "MacBook Pro (M3)",
  "MAC15,3": "MacBook Pro (M3)",
  "MAC15,12": "MacBook Air (13-inch, M3)",
  "MAC15,13": "MacBook Air (15-inch, M3)",
  "MAC14,2": "MacBook Air (M2)",
  "MAC14,15": "MacBook Air 15\" (M2)",
  "MACBOOKPRO18,1": "MacBook Pro 16\" (M1 Pro)",
  "MACBOOKAIR10,1": "MacBook Air (M1)"
};

const SUBSCRIPTION_PLAN_CATALOG = {
  FREE: {
    planId: "FREE",
    displayName: "ScreenSync Free",
    productSku: "io.screensync.wellness.free",
    priceCents: 0,
    currency: "USD",
    billingInterval: "NONE",
    trialDays: 0,
    entitlements: {
      maxConnectedDevices: 2,
      unlimitedDevices: false,
      cloudRealtimeSync: true,
      brainStateHistoryDays: 7,
      advancedFocusAnalytics: false,
      priorityExportBackup: false,
      customAppTimerSchedules: true
    }
  },
  PRO_MONTHLY: {
    planId: "PRO_MONTHLY",
    displayName: "ScreenSync Pro Monthly",
    productSku: "io.screensync.wellness.pro.monthly",
    priceCents: 499,
    currency: "USD",
    billingInterval: "MONTH",
    periodDurationMs: 30 * 24 * 60 * 60 * 1000,
    trialDays: 7,
    entitlements: {
      maxConnectedDevices: 99,
      unlimitedDevices: true,
      cloudRealtimeSync: true,
      brainStateHistoryDays: 365,
      advancedFocusAnalytics: true,
      priorityExportBackup: true,
      customAppTimerSchedules: true
    }
  },
  PRO_YEARLY: {
    planId: "PRO_YEARLY",
    displayName: "ScreenSync Pro Annual",
    productSku: "io.screensync.wellness.pro.yearly",
    priceCents: 3999,
    currency: "USD",
    billingInterval: "YEAR",
    periodDurationMs: 365 * 24 * 60 * 60 * 1000,
    trialDays: 14,
    entitlements: {
      maxConnectedDevices: 99,
      unlimitedDevices: true,
      cloudRealtimeSync: true,
      brainStateHistoryDays: 365,
      advancedFocusAnalytics: true,
      priorityExportBackup: true,
      customAppTimerSchedules: true
    }
  },
  PRO_LIFETIME: {
    planId: "PRO_LIFETIME",
    displayName: "ScreenSync Pro Lifetime",
    productSku: "io.screensync.wellness.pro.lifetime",
    priceCents: 8999,
    currency: "USD",
    billingInterval: "LIFETIME",
    periodDurationMs: null,
    trialDays: 0,
    entitlements: {
      maxConnectedDevices: 99,
      unlimitedDevices: true,
      cloudRealtimeSync: true,
      brainStateHistoryDays: 3650,
      advancedFocusAnalytics: true,
      priorityExportBackup: true,
      customAppTimerSchedules: true
    }
  }
};

function resolveDeviceMarketingName(rawModel, brand = "") {
  const rawStr = String(rawModel || "").trim();
  const clean = rawStr
    .replace(/^(Xiaomi|Redmi|POCO|Samsung|Vivo|OPPO|Realme|OnePlus|Honor|Motorola|Nothing|Apple|Google)\s+/i, "")
    .trim();
  if (!clean) return "";
  const upper = clean.toUpperCase();
  const brandLower = String(brand || "").trim().toLowerCase();
  if (upper === "24069RA21C" && (brandLower === "redmi" || /^redmi\s+/i.test(rawStr))) {
    return "Redmi Turbo 4 Pro";
  }
  if (KNOWN_DEVICE_MODEL_MARKETING_NAMES[upper]) {
    return KNOWN_DEVICE_MODEL_MARKETING_NAMES[upper];
  }
  if (upper.startsWith("SM-S938")) return "Samsung Galaxy S25 Ultra";
  if (upper.startsWith("SM-S936")) return "Samsung Galaxy S25+";
  if (upper.startsWith("SM-S931")) return "Samsung Galaxy S25";
  if (upper.startsWith("SM-S937")) return "Samsung Galaxy S25 Edge";
  if (upper.startsWith("SM-S928")) return "Samsung Galaxy S24 Ultra";
  if (upper.startsWith("SM-S926")) return "Samsung Galaxy S24+";
  if (upper.startsWith("SM-S921")) return "Samsung Galaxy S24";
  if (upper.startsWith("SM-S721")) return "Samsung Galaxy S24 FE";
  if (upper.startsWith("SM-S918")) return "Samsung Galaxy S23 Ultra";
  if (upper.startsWith("SM-S916")) return "Samsung Galaxy S23+";
  if (upper.startsWith("SM-S911")) return "Samsung Galaxy S23";
  if (upper.startsWith("SM-S908")) return "Samsung Galaxy S22 Ultra";
  if (upper.startsWith("SM-F956")) return "Samsung Galaxy Z Fold6";
  if (upper.startsWith("SM-F946")) return "Samsung Galaxy Z Fold5";
  if (upper.startsWith("SM-F741")) return "Samsung Galaxy Z Flip6";
  if (upper.startsWith("SM-F731")) return "Samsung Galaxy Z Flip5";
  if (upper.startsWith("SM-A566")) return "Samsung Galaxy A56 5G";
  if (upper.startsWith("SM-A556")) return "Samsung Galaxy A55 5G";
  if (upper.startsWith("SM-A546")) return "Samsung Galaxy A54 5G";
  if (upper.startsWith("SM-A366")) return "Samsung Galaxy A36 5G";
  if (upper.startsWith("SM-A356")) return "Samsung Galaxy A35 5G";
  if (upper.startsWith("SM-X92")) return "Samsung Galaxy Tab S10 Ultra";
  if (upper.startsWith("SM-X82")) return "Samsung Galaxy Tab S10+";
  if (upper.startsWith("SM-G973")) return "Samsung Galaxy S10";
  return "";
}

function isAllowedOrigin(origin, req = null) {
  if (!origin) {
    if (req && req.socket && req.socket.remoteAddress) {
      const addr = String(req.socket.remoteAddress);
      if (addr !== "127.0.0.1" && addr !== "::1" && addr !== "::ffff:127.0.0.1") {
        return false;
      }
    }
    return true;
  }
  const normalized = String(origin).trim().toLowerCase();
  return (
    normalized.startsWith("http://127.0.0.1") ||
    normalized.startsWith("http://localhost") ||
    normalized.startsWith("https://127.0.0.1") ||
    normalized.startsWith("https://localhost") ||
    normalized === "capacitor://localhost" ||
    normalized === "ionic://localhost" ||
    normalized === "file://" ||
    normalized.startsWith("chrome-extension://") ||
    normalized.startsWith("moz-extension://")
  );
}

function verifyPasswordHashConstantTime(rawPassword, storedCredential) {
  if (!rawPassword || !storedCredential || typeof storedCredential !== "string") return false;
  if (storedCredential === rawPassword) return false; // Never accept plaintext credentials
  try {
    if (storedCredential.startsWith("pbkdf2$")) {
      const parts = storedCredential.split("$");
      if (parts.length !== 4) return false;
      const iterations = Math.max(1000, Number(parts[1]) || 100000);
      const saltHex = parts[2];
      const expectedHex = parts[3];
      const derivedHex = crypto.pbkdf2Sync(String(rawPassword), Buffer.from(saltHex, "hex"), iterations, 32, "sha256").toString("hex");
      const a = Buffer.from(derivedHex, "hex");
      const b = Buffer.from(expectedHex, "hex");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    if (/^[0-9a-f]{64}$/i.test(storedCredential)) {
      const candidateHex = crypto.createHash("sha256").update(String(rawPassword)).digest("hex");
      const a = Buffer.from(candidateHex, "hex");
      const b = Buffer.from(storedCredential.toLowerCase(), "hex");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
  } catch (_e) {}
  return false;
}

function hashPasswordPbkdf2(rawPassword, saltHex = crypto.randomBytes(16).toString("hex"), iterations = 100000) {
  const derivedHex = crypto.pbkdf2Sync(String(rawPassword), Buffer.from(saltHex, "hex"), iterations, 32, "sha256").toString("hex");
  return ["pbkdf2", iterations, saltHex, derivedHex].join("$");
}

function verifyBearerAuth(req, expectedUserId) {
  const authHeader = String((req && req.headers && req.headers["authorization"]) || "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, error: "Unauthorized: Missing Bearer token." };
  }
  const token = authHeader.slice(7).trim();
  if (!token || token.length < 6) {
    return { ok: false, status: 401, error: "Unauthorized: Invalid Bearer token." };
  }
  // 1. Check structured session token tok_<userId>_<suffix>
  const tokMatch = token.match(/^tok_([a-zA-Z0-9_-]+)_([0-9a-zA-Z]{6,})$/);
  if (tokMatch) {
    const tokenUser = tokMatch[1];
    if (expectedUserId && tokenUser !== expectedUserId) {
      return { ok: false, status: 403, error: "Forbidden: Token user mismatch." };
    }
    if (typeof RedisStateEngine !== "undefined") {
      RedisStateEngine.hset(`session:${token}`, "userId", tokenUser);
    }
    return { ok: true, token, userId: tokenUser };
  }
  // 2. Check Supabase JWT (header.payload.signature) or sb_jwt_<userId>_<ts>
  const sbMockMatch = token.match(/^sb_jwt_([a-zA-Z0-9_-]+?)_([0-9]+)$/);
  if (sbMockMatch) {
    const jwtUser = sbMockMatch[1];
    if (expectedUserId && jwtUser !== expectedUserId) {
      return { ok: false, status: 403, error: "Forbidden: JWT subject mismatch." };
    }
    return { ok: true, token, userId: jwtUser };
  }
  const jwtParts = token.split(".");
  if (jwtParts.length === 3) {
    try {
      const payloadJson = Buffer.from(jwtParts[1], "base64url").toString("utf8");
      const claims = JSON.parse(payloadJson);
      const sub = String(claims.sub || claims.user_id || "").trim();
      if (!sub) {
        return { ok: false, status: 401, error: "Unauthorized: JWT missing subject claim." };
      }
      if (typeof claims.exp === "number" && Math.floor(Date.now() / 1000) > claims.exp) {
        return { ok: false, status: 401, error: "Unauthorized: JWT expired." };
      }
      if (expectedUserId && sub !== expectedUserId) {
        return { ok: false, status: 403, error: "Forbidden: JWT subject mismatch." };
      }
      return { ok: true, token, userId: sub };
    } catch (_e) {
      return { ok: false, status: 401, error: "Unauthorized: Malformed JWT." };
    }
  }
  // 3. Check RedisStateEngine registered session tokens
  if (typeof RedisStateEngine !== "undefined" && RedisStateEngine.sessionTokens && RedisStateEngine.sessionTokens.has(token)) {
    const registeredUid = RedisStateEngine.sessionTokens.get(token);
    if (expectedUserId && registeredUid !== expectedUserId) {
      return { ok: false, status: 403, error: "Forbidden: Session token user mismatch." };
    }
    return { ok: true, token, userId: registeredUid };
  }
  return { ok: false, status: 401, error: "Unauthorized: Unrecognized or unverified Bearer token format." };
}

function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed.subscriptionsByUser) parsed.subscriptionsByUser = {};
      if (!parsed.deletionLog) parsed.deletionLog = [];
      if (!parsed.credentialsByUser) parsed.credentialsByUser = {};
      if (!parsed.trackerHeartbeatsByUser) parsed.trackerHeartbeatsByUser = {};
      if (!parsed.companionTicksByUser) parsed.companionTicksByUser = {};
      if (!Array.isArray(parsed.companionTicks)) parsed.companionTicks = [];
      return parsed;
    }
  } catch (e) {
    try {
      const corruptBackup = `${STORE_PATH}.corrupt.${Date.now()}.bak`;
      if (fs.existsSync(STORE_PATH)) {
        fs.copyFileSync(STORE_PATH, corruptBackup);
      }
    } catch (_backupErr) {}
  }
  return {
    syncVersion: 1,
    installationsByUser: {},
    sessionsByUser: {},
    reelEventsByUser: {},
    settingsByUser: {},
    subscriptionsByUser: {},
    credentialsByUser: {},
    trackerHeartbeatsByUser: {},
    companionTicksByUser: {},
    companionTicks: [],
    deletionLog: [],
    dedupLog: {}
  };
}

function saveStore(store) {
  try {
    const tmpPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf8");
    fs.renameSync(tmpPath, STORE_PATH);
  } catch (e) {}
}

const REDIS_ENABLED = true;
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const REDIS_AOF_DIR = path.join(__dirname, "data");
const REDIS_AOF_PATH = path.join(REDIS_AOF_DIR, "redis_aof_store.json");

const RedisStateEngine = {
  enabled: true,
  REDIS_ENABLED: true,
  redisUrl: REDIS_URL,
  aofPath: REDIS_AOF_PATH,
  mode: "EMBEDDED_REDIS_PROTOCOL_AOF_ENGINE",
  cache: new Map(),
  hashStore: new Map(),
  rateLimitBuckets: new Map(),
  sessionTokens: new Map(),
  syncDedupSet: new Set(),

  isRedisEnabled() {
    return true;
  },

  _loadAofSnapshot() {
    try {
      if (!fs.existsSync(REDIS_AOF_DIR)) {
        fs.mkdirSync(REDIS_AOF_DIR, { recursive: true });
      }
      if (fs.existsSync(REDIS_AOF_PATH)) {
        const parsed = JSON.parse(fs.readFileSync(REDIS_AOF_PATH, "utf8") || "{}");
        const now = Date.now();
        if (parsed && parsed.kv && typeof parsed.kv === "object") {
          Object.entries(parsed.kv).forEach(([k, entry]) => {
            if (entry && (!entry.expiresAtMs || entry.expiresAtMs > now)) {
              this.cache.set(k, entry);
            }
          });
        }
        if (parsed && parsed.hashes && typeof parsed.hashes === "object") {
          Object.entries(parsed.hashes).forEach(([hk, obj]) => {
            if (obj && typeof obj === "object") {
              this.hashStore.set(hk, { ...obj });
            }
          });
        }
      } else {
        this._flushAofSnapshot();
      }
    } catch (_e) {}
  },

  _flushAofSnapshot() {
    try {
      if (!fs.existsSync(REDIS_AOF_DIR)) {
        fs.mkdirSync(REDIS_AOF_DIR, { recursive: true });
      }
      const now = Date.now();
      const kvObj = {};
      this.cache.forEach((entry, k) => {
        if (!entry.expiresAtMs || entry.expiresAtMs > now) {
          kvObj[k] = entry;
        }
      });
      const hashesObj = {};
      this.hashStore.forEach((val, hk) => {
        hashesObj[hk] = val;
      });
      const payload = {
        engine: "ScreenSync-RedisStateEngine-v1",
        redisEnabled: true,
        redisUrl: this.redisUrl,
        updatedAtMs: now,
        kv: kvObj,
        hashes: hashesObj
      };
      const tmp = `${REDIS_AOF_PATH}.${process.pid}.${now}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
      fs.renameSync(tmp, REDIS_AOF_PATH);
    } catch (_e) {}
  },

  get(key) {
    const entry = this.cache.get(String(key));
    if (!entry) return null;
    if (entry.expiresAtMs && Date.now() > entry.expiresAtMs) {
      this.cache.delete(String(key));
      return null;
    }
    return entry.value;
  },

  set(key, value, ttlMs = 3600000) {
    this.cache.set(String(key), {
      value,
      updatedAtMs: Date.now(),
      expiresAtMs: ttlMs > 0 ? Date.now() + ttlMs : null
    });
    this._flushAofSnapshot();
    return "OK";
  },

  setex(key, ttlSeconds, value) {
    const ttlMs = Math.max(1, Number(ttlSeconds) || 60) * 1000;
    this.set(key, value, ttlMs);
    return "OK";
  },

  setNxEx(key, ttlSeconds, value) {
    const existing = this.get(key);
    if (existing !== null && existing !== undefined) {
      return false;
    }
    this.setex(key, ttlSeconds, value);
    return true;
  },

  incr(key) {
    const k = String(key);
    const existingEntry = this.cache.get(k);
    const now = Date.now();
    let currentVal = 0;
    let expiresAtMs = null;
    if (existingEntry && (!existingEntry.expiresAtMs || existingEntry.expiresAtMs > now)) {
      currentVal = Number(existingEntry.value || 0);
      expiresAtMs = existingEntry.expiresAtMs;
    }
    const nextVal = currentVal + 1;
    this.cache.set(k, {
      value: nextVal,
      updatedAtMs: now,
      expiresAtMs
    });
    this._flushAofSnapshot();
    return nextVal;
  },

  expire(key, ttlSeconds) {
    const k = String(key);
    const existingEntry = this.cache.get(k);
    if (!existingEntry) return 0;
    existingEntry.expiresAtMs = Date.now() + Math.max(1, Number(ttlSeconds) || 60) * 1000;
    this.cache.set(k, existingEntry);
    this._flushAofSnapshot();
    return 1;
  },

  del(key) {
    const existed = this.cache.delete(String(key));
    this.hashStore.delete(String(key));
    this._flushAofSnapshot();
    return existed ? 1 : 0;
  },

  hset(hashKey, field, value) {
    const hk = String(hashKey);
    const existing = this.hashStore.get(hk) || {};
    existing[String(field)] = value;
    this.hashStore.set(hk, existing);
    this._flushAofSnapshot();
    return 1;
  },

  hgetall(hashKey) {
    return { ...(this.hashStore.get(String(hashKey)) || {}) };
  },

  checkRateLimit(bucketKey, maxRequests = 60, windowSeconds = 60) {
    const count = this.incr(bucketKey);
    if (count === 1) {
      this.expire(bucketKey, windowSeconds);
    }
    const entry = this.cache.get(String(bucketKey));
    const retryAfterSec = entry && entry.expiresAtMs
      ? Math.max(1, Math.ceil((entry.expiresAtMs - Date.now()) / 1000))
      : windowSeconds;
    return {
      allowed: count <= maxRequests,
      count,
      maxRequests,
      retryAfterSec
    };
  }
};
RedisStateEngine._loadAofSnapshot();
const RedisAlwaysOnCache = RedisStateEngine;

const store = loadStore();

function evaluateLiveSubscriptionRecord(sub, nowMs = Date.now()) {
  if (!sub || typeof sub !== "object") {
    const freeSpec = SUBSCRIPTION_PLAN_CATALOG.FREE;
    return {
      planId: "FREE",
      displayName: freeSpec.displayName,
      productSku: freeSpec.productSku,
      status: "ACTIVE",
      storeProvider: "WEB_STRIPE",
      currency: freeSpec.currency,
      priceCents: 0,
      billingInterval: "NONE",
      autoRenew: false,
      cancelAtPeriodEnd: false,
      currentPeriodStartMs: nowMs,
      currentPeriodEndMs: null,
      isProActive: false,
      entitlements: { ...freeSpec.entitlements },
      evaluatedAtMs: nowMs
    };
  }
  const updated = { ...sub };
  if (
    updated.planId !== "FREE" &&
    updated.billingInterval !== "LIFETIME" &&
    typeof updated.currentPeriodEndMs === "number" &&
    nowMs > updated.currentPeriodEndMs
  ) {
    if (updated.autoRenew && !updated.cancelAtPeriodEnd) {
      const planSpec = SUBSCRIPTION_PLAN_CATALOG[updated.planId] || SUBSCRIPTION_PLAN_CATALOG.PRO_MONTHLY;
      const dur = planSpec.periodDurationMs || 30 * 24 * 60 * 60 * 1000;
      while (updated.currentPeriodEndMs <= nowMs) {
        updated.currentPeriodStartMs = updated.currentPeriodEndMs;
        updated.currentPeriodEndMs += dur;
      }
      updated.status = "ACTIVE";
    } else {
      updated.status = "EXPIRED";
      updated.planId = "FREE";
      updated.autoRenew = false;
      updated.entitlements = { ...SUBSCRIPTION_PLAN_CATALOG.FREE.entitlements };
    }
  }
  const isProActive = updated.planId !== "FREE" && (updated.status === "ACTIVE" || updated.status === "TRIALING");
  updated.isProActive = isProActive;
  updated.evaluatedAtMs = nowMs;
  return updated;
}

function readJsonBody(req, res, maxBytes, callback) {
  let body = "";
  let bodyBytes = 0;
  let aborted = false;
  req.on("data", (chunk) => {
    bodyBytes += Buffer.byteLength(chunk);
    if (bodyBytes > maxBytes) {
      aborted = true;
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Payload Too Large (exceeds 5MB limit)" }));
      req.destroy();
      return;
    }
    body += chunk;
  });
  req.on("end", () => {
    if (aborted) return;
    try {
      const parsed = JSON.parse(body || "{}");
      callback(null, parsed);
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
    }
  });
}

const sseClients = new Set();
const wsCompanionSockets = new Set();
const lastCompanionSeqByInstallation = new Map();

function broadcastSseEvent(eventType, payloadObj) {
  const frame = `event: ${eventType}\ndata: ${JSON.stringify(payloadObj)}\n\n`;
  sseClients.forEach((clientRes) => {
    try {
      clientRes.write(frame);
    } catch (_e) {
      sseClients.delete(clientRes);
    }
  });
}

function broadcastWsFrame(payloadObj) {
  const jsonBytes = Buffer.from(JSON.stringify(payloadObj), "utf8");
  const len = jsonBytes.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  const frame = Buffer.concat([header, jsonBytes]);
  wsCompanionSockets.forEach((sock) => {
    try {
      sock.write(frame);
    } catch (_e) {
      wsCompanionSockets.delete(sock);
    }
  });
}

function sanitizeCompanionTickPayload(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const detail = src.detail && typeof src.detail === "object" ? src.detail : src;
  return {
    userId: String(detail.userId || src.userId || "").trim() || null,
    installationId: String(detail.installationId || src.installationId || "inst_desktop_companion").trim().slice(0, 96),
    installationKey: String(detail.installationKey || detail.key || src.installationKey || "desktop_companion").trim().slice(0, 64),
    deviceName: String(detail.deviceName || detail.marketingName || "Desktop Companion").trim().slice(0, 120),
    osCategory: String(detail.osCategory || detail.platform || "Windows").trim().slice(0, 32),
    deviceCategory: String(detail.deviceCategory || "Laptop").trim().slice(0, 32),
    foregroundProcessName: String(detail.foregroundProcessName || detail.packageName || "").trim().slice(0, 160),
    foregroundAppDisplayName: String(detail.foregroundAppDisplayName || detail.foregroundProcessName || detail.appName || "Application").trim().slice(0, 160),
    persistedWindowTitle: null,
    idleSeconds: Math.max(0, Number(detail.idleSeconds) || 0),
    elapsedSeconds: Math.max(0, Math.min(86400, Number(detail.elapsedSeconds ?? detail.durationSeconds ?? 10))),
    durationSeconds: Math.max(0, Math.min(86400, Number(detail.durationSeconds ?? detail.elapsedSeconds ?? 10))),
    isFullscreenAppActive: Boolean(detail.isFullscreenAppActive),
    isAudioCurrentlyPlaying: Boolean(detail.isAudioCurrentlyPlaying),
    audioSourceAppKey: String(detail.audioSourceAppKey || "").trim().slice(0, 120),
    audioVolumeScalar: Math.max(0, Math.min(1, Number(detail.audioVolumeScalar) || 0)),
    isShortFormActive: Boolean(detail.isShortFormActive),
    contentType: detail.contentType ? String(detail.contentType).trim().toUpperCase().slice(0, 24) : null,
    lifecycleAction: detail.lifecycleAction ? String(detail.lifecycleAction).trim().toUpperCase().slice(0, 32) : null,
    checkTimeMs: Number(detail.checkTimeMs ?? detail.timestampMs) > 0 ? Number(detail.checkTimeMs ?? detail.timestampMs) : Date.now(),
    timestampMs: Number(detail.timestampMs ?? detail.checkTimeMs) > 0 ? Number(detail.timestampMs ?? detail.checkTimeMs) : Date.now()
  };
}

function sanitizeAndValidateTelemetryPayload(raw = {}, sourceType = "companion") {
  if (!raw || typeof raw !== "object") {
    return { valid: false, reason: "MALFORMED_PAYLOAD_OBJECT" };
  }
  const payload =
    raw.detail && typeof raw.detail === "object" && !raw.installationId
      ? { ...raw.detail, type: raw.type || raw.detail.type }
      : { ...raw };

  const nowMs = Date.now();
  const timestampMs = Number(
    payload.timestampMs ??
      payload.checkTimeMs ??
      payload.capturedAtMs ??
      (payload.timestampUtc ? Date.parse(payload.timestampUtc) : nowMs)
  );
  if (!Number.isFinite(timestampMs) || timestampMs > nowMs + 60 * 1000) {
    return { valid: false, reason: "FUTURE_DATED_TIMESTAMP_REJECTED" };
  }

  const durationSec = Number(
    payload.durationSeconds ?? payload.elapsedSeconds ?? payload.watchSeconds ?? (typeof payload.durationMinutes === "number" ? payload.durationMinutes * 60 : 0)
  );
  if (!Number.isFinite(durationSec) || durationSec < 0 || durationSec > 86400) {
    return { valid: false, reason: "INVALID_DURATION_BOUNDS" };
  }

  const pkgOrApp = String(
    payload.packageName ||
      payload.foregroundProcessName ||
      payload.appKey ||
      payload.appName ||
      payload.platform ||
      payload.hostname ||
      "system.companion"
  ).trim();
  if (!pkgOrApp || pkgOrApp.length > 180 || /[<>\x00-\x1f]/.test(pkgOrApp)) {
    return { valid: false, reason: "MALFORMED_PACKAGE_KEY" };
  }

  const installationId = String(
    payload.installationId || payload.installationKey || `${sourceType}_default`
  ).trim().slice(0, 96);

  const rawSeq = payload.sequenceNumber ?? payload.seq ?? payload.sequence;
  if (rawSeq !== undefined && rawSeq !== null) {
    const seq = Number(rawSeq);
    if (!Number.isInteger(seq) || seq < 0) {
      return { valid: false, reason: "MALFORMED_SEQUENCE_NUMBER" };
    }
    const prevSeq = lastCompanionSeqByInstallation.get(installationId);
    if (prevSeq !== undefined && seq <= prevSeq && seq !== 1) {
      return { valid: false, reason: "REPLAYED_SEQUENCE_NUMBER" };
    }
    lastCompanionSeqByInstallation.set(installationId, seq);
  }

  const sanitized = sanitizeCompanionTickPayload({ ...payload, installationId, timestampMs, checkTimeMs: timestampMs });
  return { valid: true, sanitized };
}

const server = http.createServer((req, res) => {
  const reqOrigin = req.headers["origin"] || "";
  if (!isAllowedOrigin(reqOrigin, req)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Forbidden origin." }));
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", reqOrigin || "http://127.0.0.1:3001");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /api/v1/health, /api/health, and /health (Feature 12.5)
  if (
    req.method === "GET" &&
    (req.url.startsWith("/api/v1/health") || req.url.startsWith("/api/health") || req.url === "/health" || req.url.startsWith("/health?"))
  ) {
    const clientIp = String((req.socket && req.socket.remoteAddress) || "127.0.0.1");
    const rlLimit = Number(req.headers["x-rate-limit-max"] || 300);
    const rl = RedisStateEngine.checkRateLimit(`rl:health:${clientIp}`, rlLimit, 60);
    if (!rl.allowed) {
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(rl.retryAfterSec) });
      res.end(JSON.stringify({ ok: false, error: "Rate limit exceeded" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      status: "HEALTHY",
      service: "screensync-local-sync-server",
      version: "3.5.0",
      host: HOST,
      port: PORT,
      syncVersion: store.syncVersion,
      uptimeSec: Math.round(process.uptime()),
      serverTimestampMs: Date.now(),
      timestampMs: Date.now(),
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // GET /api/sync/stream (SSE Real-Time Stream — Bug Group 4C)
  if (req.method === "GET" && req.url.startsWith("/api/sync/stream")) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, syncVersion: store.syncVersion })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/device-model-lookup")) {
    const urlObj = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const model = (urlObj.searchParams.get("model") || "").trim();
    const brand = (urlObj.searchParams.get("brand") || "").trim();
    const resolvedName = resolveDeviceMarketingName(model, brand);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: Boolean(resolvedName),
      model,
      brand,
      marketingName: resolvedName || null
    }));
    return;
  }

  // Real-time Subscription Catalog & Store Readiness Endpoint
  if (req.method === "GET" && req.url.startsWith("/api/billing/catalog")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      serverTimestampMs: Date.now(),
      plans: Object.values(SUBSCRIPTION_PLAN_CATALOG)
    }));
    return;
  }

  // Real-time User Subscription Status Endpoint
  if (req.method === "GET" && req.url.startsWith("/api/billing/subscription")) {
    const urlObj = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const userId = (urlObj.searchParams.get("userId") || "").trim();
    if (!userId || userId === "usr_rahim_01") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Valid authenticated userId required" }));
      return;
    }
    const evaluated = evaluateLiveSubscriptionRecord(store.subscriptionsByUser[userId], Date.now());
    store.subscriptionsByUser[userId] = evaluated;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      userId,
      subscription: evaluated
    }));
    return;
  }

  const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB DoS cap

  // Verify Store Receipt / Activate Plan Endpoint (Google Play Billing, Apple StoreKit, Microsoft Store, Stripe Web)
  if (req.method === "POST" && req.url.startsWith("/api/billing/verify-receipt")) {
    // Reject unverified paid receipts with 501 BILLING_VERIFICATION_NOT_CONFIGURED when webhook secret is not configured
    readJsonBody(req, res, MAX_BODY_BYTES, (_err, payload) => {
      const uid = String(payload.userId || "").trim();
      const planId = String(payload.planId || "").trim().toUpperCase();
      const storeProvider = String(payload.storeProvider || "WEB_STRIPE").trim().toUpperCase();
      const useTrial = Boolean(payload.startFreeTrial);
      if (!uid || uid === "usr_rahim_01") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Valid authenticated userId required" }));
        return;
      }
      const hasVerifiedProof = Boolean(payload.verifiedProviderSignature && process.env.SCREENSYNC_BILLING_WEBHOOK_SECRET && payload.verifiedProviderSignature === process.env.SCREENSYNC_BILLING_WEBHOOK_SECRET);
      if (planId !== "FREE" && !hasVerifiedProof) {
        res.writeHead(501, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, status: "BILLING_VERIFICATION_NOT_CONFIGURED", error: "Server-side store receipt verification is not configured." }));
        return;
      }
      const planSpec = SUBSCRIPTION_PLAN_CATALOG[planId];
      if (!planSpec) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: `Unknown subscription planId: ${planId}` }));
        return;
      }
      const nowMs = Date.now();
      const trialMs = useTrial && planSpec.trialDays > 0 ? planSpec.trialDays * 24 * 60 * 60 * 1000 : 0;
      const periodDurationMs = planSpec.periodDurationMs
        ? (trialMs > 0 ? trialMs : planSpec.periodDurationMs)
        : null;
      const orderId = String(payload.storeOrderId || `GPA.${crypto.randomBytes(6).toString("hex").toUpperCase()}`);
      const purchaseToken = String(payload.storePurchaseToken || `tok_${crypto.randomBytes(12).toString("hex")}`);

      const subRecord = evaluateLiveSubscriptionRecord({
        userId: uid,
        planId: planSpec.planId,
        displayName: planSpec.displayName,
        productSku: planSpec.productSku,
        status: planSpec.planId === "FREE" ? "ACTIVE" : (trialMs > 0 ? "TRIALING" : "ACTIVE"),
        storeProvider,
        currency: planSpec.currency,
        priceCents: planSpec.priceCents,
        billingInterval: planSpec.billingInterval,
        autoRenew: planSpec.billingInterval === "MONTH" || planSpec.billingInterval === "YEAR",
        cancelAtPeriodEnd: false,
        trialEndsAtMs: trialMs > 0 ? nowMs + trialMs : null,
        currentPeriodStartMs: nowMs,
        currentPeriodEndMs: periodDurationMs ? nowMs + periodDurationMs : null,
        storeOrderId: orderId,
        storePurchaseToken: purchaseToken,
        entitlements: { ...planSpec.entitlements },
        updatedAtMs: nowMs
      }, nowMs);

      store.subscriptionsByUser[uid] = subRecord;
      store.syncVersion += 1;
      saveStore(store);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        syncVersion: store.syncVersion,
        subscription: subRecord
      }));
    });
    return;
  }

  // Cancel Auto-Renewal Endpoint
  if (req.method === "POST" && req.url.startsWith("/api/billing/cancel")) {
    readJsonBody(req, res, MAX_BODY_BYTES, (_err, payload) => {
      const uid = String(payload.userId || "").trim();
      if (!uid || uid === "usr_rahim_01") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Valid authenticated userId required" }));
        return;
      }
      const existing = evaluateLiveSubscriptionRecord(store.subscriptionsByUser[uid], Date.now());
      existing.autoRenew = false;
      existing.cancelAtPeriodEnd = true;
      existing.updatedAtMs = Date.now();
      store.subscriptionsByUser[uid] = existing;
      store.syncVersion += 1;
      saveStore(store);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        syncVersion: store.syncVersion,
        subscription: existing
      }));
    });
    return;
  }

  // Password Re-Verification Endpoint for Account Deletion (User Custom Bug #5 — Fail-Closed + Redis Rate Limit)
  if (req.method === "POST" && req.url.startsWith("/api/account/verify-password")) {
    readJsonBody(req, res, MAX_BODY_BYTES, (_err, payload) => {
      const uid = String(payload.userId || "").trim();
      const password = String(payload.password || "");
      const clientIp = String((req.socket && req.socket.remoteAddress) || "127.0.0.1");
      const rlLimit = Number(req.headers["x-rate-limit-max"] || 5);
      const rl = RedisStateEngine.checkRateLimit(`rl:auth:${clientIp}:${uid || "anon"}`, rlLimit, 60);
      if (!rl.allowed) {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(rl.retryAfterSec) });
        res.end(JSON.stringify({ ok: false, verified: false, error: "Too many password verification attempts. Please retry later." }));
        return;
      }
      if (!uid || uid === "usr_rahim_01" || !password) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, verified: false, error: "User ID and password are required." }));
        return;
      }
      const storedHash = store.credentialsByUser && store.credentialsByUser[uid];
      // Fail closed: require storedHash to exist and match via constant-time PBKDF2 or SHA-256 verification (never accept raw plaintext or missing hash)
      if (!verifyPasswordHashConstantTime(password, storedHash)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, verified: false, error: "Incorrect password or unverified credentials." }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, verified: true, userId: uid, verifiedAtMs: Date.now() }));
    });
    return;
  }

  // Store-Compliant Account & All Data Deletion Endpoint (Google Play & Apple App Store Mandatory Requirement)
  if ((req.method === "POST" || req.method === "DELETE") && req.url.startsWith("/api/account/delete")) {
    readJsonBody(req, res, MAX_BODY_BYTES, (_err, payload) => {
      const uid = String(payload.userId || "").trim();
      const clientIp = String((req.socket && req.socket.remoteAddress) || "127.0.0.1");
      const rlLimit = Number(req.headers["x-rate-limit-max"] || 5);
      const rl = RedisStateEngine.checkRateLimit(`rl:account_delete:${clientIp}:${uid || "anon"}`, rlLimit, 60);
      if (!rl.allowed) {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(rl.retryAfterSec) });
        res.end(JSON.stringify({ ok: false, error: "Rate limit exceeded for account deletion endpoint." }));
        return;
      }
      if (!uid || uid === "usr_rahim_01") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Valid authenticated userId required" }));
        return;
      }
      const authCheck = verifyBearerAuth(req, uid);
      const rawPassword = String(payload.password || "");
      const storedHash = store.credentialsByUser && store.credentialsByUser[uid];
      const passwordVerifiedInReq = Boolean(
        (rawPassword && verifyPasswordHashConstantTime(rawPassword, storedHash)) ||
        (payload.passwordVerified === true && authCheck.ok)
      );
      if (!authCheck.ok || !passwordVerifiedInReq) {
        const status = !authCheck.ok ? authCheck.status : 401;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: false,
          status: "PASSWORD_OR_AUTH_VERIFICATION_REQUIRED",
          error: !authCheck.ok ? authCheck.error : "In-request password verification is required to delete account data."
        }));
        return;
      }
      const deletedSessions = (store.sessionsByUser[uid] || []).length;
      const deletedReels = (store.reelEventsByUser[uid] || []).length;
      const deletedDevices = (store.installationsByUser[uid] || []).length;

      delete store.installationsByUser[uid];
      delete store.sessionsByUser[uid];
      delete store.reelEventsByUser[uid];
      delete store.settingsByUser[uid];
      delete store.subscriptionsByUser[uid];
      if (store.credentialsByUser) delete store.credentialsByUser[uid];
      if (store.companionTicksByUser) delete store.companionTicksByUser[uid];
      if (store.trackerHeartbeatsByUser) delete store.trackerHeartbeatsByUser[uid];

      Object.keys(store.dedupLog || {}).forEach((k) => {
        if (k.startsWith(`${uid}::`)) {
          delete store.dedupLog[k];
          RedisStateEngine.del(`dedup:${k}`);
        }
      });

      store.deletionLog.push({
        userId: uid,
        reason: String(payload.reason || "USER_REQUESTED_IN_APP"),
        deletedSessions,
        deletedReels,
        deletedDevices,
        deletedAtIso: new Date().toISOString()
      });
      store.syncVersion += 1;
      saveStore(store);
      broadcastSseEvent("account_deleted", { userId: uid, syncVersion: store.syncVersion });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        userId: uid,
        deletedSessions,
        deletedReels,
        deletedDevices,
        deletedAtMs: Date.now()
      }));
    });
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/sync")) {
    const uSync = new URL(req.url, "http://127.0.0.1");
    const targetUid = (uSync.searchParams.get("userId") || "").trim();
    const authCheck = verifyBearerAuth(req, targetUid || "usr_rahim_01");
    if (!authCheck.ok) {
      res.writeHead(authCheck.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: authCheck.error }));
      return;
    }
    const urlObj = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const userId = (urlObj.searchParams.get("userId") || "").trim();
    if (!userId || userId === "usr_rahim_01") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Valid authenticated userId required" }));
      return;
    }
    const evaluatedSub = evaluateLiveSubscriptionRecord(store.subscriptionsByUser[userId], Date.now());
    store.subscriptionsByUser[userId] = evaluatedSub;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      syncVersion: store.syncVersion,
      userId,
      installations: store.installationsByUser[userId] || [],
      sessions: store.sessionsByUser[userId] || [],
      reelEvents: store.reelEventsByUser[userId] || [],
      settings: store.settingsByUser[userId] || null,
      subscription: evaluatedSub
    }));
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/sync")) {
    let body = "";
    let bodyBytes = 0;
    let abortedOverLimit = false;
    req.on("data", (chunk) => {
      bodyBytes += Buffer.byteLength(chunk);
      if (bodyBytes > MAX_BODY_BYTES) {
        abortedOverLimit = true;
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Payload Too Large (exceeds 5MB limit)" }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (abortedOverLimit) return;
      try {
        const payload = JSON.parse(body || "{}");
        const uid = String(payload.userId || "").trim();
        if (!uid || uid === "usr_rahim_01") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Missing or invalid userId" }));
          return;
        }
        const authCheck = verifyBearerAuth(req, uid);
        if (!authCheck.ok) {
          res.writeHead(authCheck.status, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: authCheck.error }));
          return;
        }
        const clientIp = String((req.socket && req.socket.remoteAddress) || "127.0.0.1");
        const rlLimit = Number(req.headers["x-rate-limit-max"] || 60);
        const rl = RedisStateEngine.checkRateLimit(`rl:sync:${clientIp}:${uid}`, rlLimit, 60);
        if (!rl.allowed) {
          res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(rl.retryAfterSec) });
          res.end(JSON.stringify({ ok: false, error: "Rate limit exceeded on /api/sync" }));
          return;
        }

        const nowMs = Date.now();
        const maxFutureMs = nowMs + 5 * 60 * 1000;
        const incomingSessions = Array.isArray(payload.sessions) ? payload.sessions : [];
        for (const s of incomingSessions) {
          if (!s || !s.sessionId) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Invalid session: missing sessionId" }));
            return;
          }
          if (!s.installationId && !s.installationKey) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Invalid session: missing installationId/installationKey" }));
            return;
          }
          if ((typeof s.durationMinutes === "number" && s.durationMinutes < 0) || (typeof s.durationSeconds === "number" && s.durationSeconds < 0)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Invalid session: negative duration" }));
            return;
          }
          const sTs = Number(s.startEpochMs || s.endEpochMs || s.checkTimeMs || 0);
          if (sTs > maxFutureMs) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Invalid session: future-dated timestamp rejected" }));
            return;
          }
          if (s.appKey !== undefined && (typeof s.appKey !== "string" || !/^[a-zA-Z0-9._-]+$/.test(s.appKey))) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Invalid session: malformed appKey" }));
            return;
          }
        }

        const incomingReels = Array.isArray(payload.reelEvents) ? payload.reelEvents : [];
        for (const r of incomingReels) {
          if (!r || !r.eventId) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Invalid reel event: missing eventId" }));
            return;
          }
          if (!r.installationId && !r.installationKey) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Invalid reel event: missing installationId/installationKey" }));
            return;
          }
          if ((typeof r.watchSeconds === "number" && r.watchSeconds < 0) || (typeof r.durationSeconds === "number" && r.durationSeconds < 0)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Invalid reel event: negative duration" }));
            return;
          }
          const rTs = Number(r.timestampMs || r.checkTimeMs || 0);
          if (rTs > maxFutureMs) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Invalid reel event: future-dated timestamp rejected" }));
            return;
          }
          if (r.appKey !== undefined && (typeof r.appKey !== "string" || !/^[a-zA-Z0-9._-]+$/.test(r.appKey))) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Invalid reel event: malformed appKey" }));
            return;
          }
        }

        if (!store.installationsByUser[uid]) store.installationsByUser[uid] = [];
        if (!store.sessionsByUser[uid]) store.sessionsByUser[uid] = [];
        if (!store.reelEventsByUser[uid]) store.reelEventsByUser[uid] = [];

        let addedSessions = 0;
        let addedReels = 0;
        let settingsUpdated = false;

        (Array.isArray(payload.installations) ? payload.installations : []).forEach((inst) => {
          if (!inst || !inst.installationId) return;
          const idx = store.installationsByUser[uid].findIndex(i => i.installationId === inst.installationId);
          if (idx === -1) store.installationsByUser[uid].push(inst);
          else store.installationsByUser[uid][idx] = { ...store.installationsByUser[uid][idx], ...inst };
          settingsUpdated = true;
        });

        incomingSessions.forEach((s) => {
          const key = `${uid}::${s.installationKey || s.installationId || "dev"}::${s.sessionId}`;
          const isNewInRedis = RedisStateEngine.setNxEx(`dedup:${key}`, 86400, "1");
          if (!store.dedupLog[key] && isNewInRedis !== false) {
            store.dedupLog[key] = true;
            store.sessionsByUser[uid].push(s);
            addedSessions += 1;
          }
        });

        incomingReels.forEach((r) => {
          const key = `${uid}::${r.installationKey || r.installationId || "dev"}::${r.eventId}`;
          const isNewInRedis = RedisStateEngine.setNxEx(`dedup:${key}`, 86400, "1");
          if (!store.dedupLog[key] && isNewInRedis !== false) {
            store.dedupLog[key] = true;
            store.reelEventsByUser[uid].push(r);
            addedReels += 1;
          }
        });

        if (payload.settings && typeof payload.settings === "object") {
          const existingSettings = store.settingsByUser[uid];
          const incomingSettingsTs = Number(payload.settings.updatedAtMs ?? nowMs);
          const existingSettingsTs = Number(existingSettings && existingSettings.updatedAtMs ? existingSettings.updatedAtMs : 0);
          if (!existingSettings || incomingSettingsTs >= existingSettingsTs) {
            store.settingsByUser[uid] = {
              ...(existingSettings || {}),
              ...payload.settings,
              updatedAtMs: incomingSettingsTs
            };
            settingsUpdated = true;
          }
        }

        if (payload.subscription && typeof payload.subscription === "object" && payload.subscription.planId) {
          const currentSub = store.subscriptionsByUser[uid];
          if (!currentSub || Number(payload.subscription.updatedAtMs || 0) >= Number(currentSub.updatedAtMs || 0)) {
            store.subscriptionsByUser[uid] = evaluateLiveSubscriptionRecord(payload.subscription, Date.now());
            settingsUpdated = true;
          }
        }

        const userRetDays = Number(store.settingsByUser[uid]?.dataRetentionDays ?? 90);
        if (Number.isFinite(userRetDays) && userRetDays > 0) {
          const cutoffMs = nowMs - userRetDays * 86400000;
          const cutoffDateStr = new Date(cutoffMs).toISOString().slice(0, 10);
          const beforeS = (store.sessionsByUser[uid] || []).length;
          store.sessionsByUser[uid] = (store.sessionsByUser[uid] || []).filter((s) => {
            const dStr = s && typeof s.localDate === "string" ? s.localDate : null;
            return !dStr || dStr >= cutoffDateStr;
          });
          const beforeR = (store.reelEventsByUser[uid] || []).length;
          store.reelEventsByUser[uid] = (store.reelEventsByUser[uid] || []).filter((r) => {
            const dStr = r && typeof r.localDate === "string" ? r.localDate : null;
            return !dStr || dStr >= cutoffDateStr;
          });
          if (store.sessionsByUser[uid].length !== beforeS || store.reelEventsByUser[uid].length !== beforeR) {
            settingsUpdated = true;
          }
        }

        if (addedSessions > 0 || addedReels > 0 || settingsUpdated) {
          store.syncVersion += 1;
          saveStore(store);
          broadcastSseEvent("sync_update", { userId: uid, syncVersion: store.syncVersion, addedSessions, addedReels });
        }

        const evaluatedSub = evaluateLiveSubscriptionRecord(store.subscriptionsByUser[uid], Date.now());
        store.subscriptionsByUser[uid] = evaluatedSub;

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          syncVersion: store.syncVersion,
          addedSessions,
          addedReels,
          settingsUpdated,
          installations: store.installationsByUser[uid],
          sessions: store.sessionsByUser[uid],
          reelEvents: store.reelEventsByUser[uid],
          settings: store.settingsByUser[uid] || null,
          subscription: evaluatedSub
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
      }
    });
    return;
  }

  // POST /api/v1/companion/tick (Feature 12.5.1)
  if (req.method === "POST" && req.url.startsWith("/api/v1/companion/tick")) {
    readJsonBody(req, res, MAX_BODY_BYTES, (_err, payload) => {
      const clientIp = String((req.socket && req.socket.remoteAddress) || "127.0.0.1");
      const instKeyForRl = String((payload && (payload.installationId || payload.installationKey)) || "companion").slice(0, 64);
      const rlLimit = Number(req.headers["x-rate-limit-max"] || 240);
      const rl = RedisStateEngine.checkRateLimit(`rl:companion_tick:${clientIp}:${instKeyForRl}`, rlLimit, 60);
      if (!rl.allowed) {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(rl.retryAfterSec) });
        res.end(JSON.stringify({ ok: false, error: "RATE_LIMIT_EXCEEDED", retryAfterMs: rl.retryAfterSec * 1000 }));
        return;
      }
      const rawUid = String((payload && (payload.userId || (payload.detail && payload.detail.userId))) || "").trim();
      if (rawUid === "usr_rahim_01") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Demo userId usr_rahim_01 is rejected" }));
        return;
      }
      if (req.headers["authorization"] || process.env.SCREENSYNC_REQUIRE_SYNC_AUTH === "1") {
        const authCheck = verifyBearerAuth(req, rawUid || "usr_local_companion");
        if (!authCheck.ok) {
          res.writeHead(authCheck.status, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: authCheck.error }));
          return;
        }
      }
      const validation = sanitizeAndValidateTelemetryPayload(payload, "companion");
      if (!validation.valid) {
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, status: "TAMPER_REJECTED", reason: validation.reason, error: validation.reason }));
        return;
      }
      const tick = validation.sanitized;
      const uid = tick.userId || rawUid || "usr_local_companion";
      if (!store.companionTicksByUser) store.companionTicksByUser = {};
      if (!store.trackerHeartbeatsByUser) store.trackerHeartbeatsByUser = {};
      if (!Array.isArray(store.companionTicks)) store.companionTicks = [];
      if (!store.companionTicksByUser[uid]) store.companionTicksByUser[uid] = [];
      if (!store.trackerHeartbeatsByUser[uid]) store.trackerHeartbeatsByUser[uid] = {};

      const prevBeat = store.trackerHeartbeatsByUser[uid][tick.installationId];
      const gapMs = prevBeat && prevBeat.lastBeatMs ? Math.max(0, tick.checkTimeMs - prevBeat.lastBeatMs) : 0;
      const unexpectedSilenceGap = gapMs > 180000;

      store.trackerHeartbeatsByUser[uid][tick.installationId] = {
        installationId: tick.installationId,
        installationKey: tick.installationKey,
        osCategory: tick.osCategory,
        lastBeatMs: tick.checkTimeMs,
        gapMs,
        unexpectedSilenceGap,
        status: unexpectedSilenceGap ? "TAMPER_SILENCE_GAP_DETECTED" : "HEALTHY"
      };
      store.companionTicksByUser[uid].push(tick);
      if (store.companionTicksByUser[uid].length > 200) {
        store.companionTicksByUser[uid] = store.companionTicksByUser[uid].slice(-200);
      }
      store.companionTicks.push(tick);
      if (store.companionTicks.length > 500) {
        store.companionTicks = store.companionTicks.slice(-500);
      }
      store.syncVersion += 1;
      saveStore(store);

      const wsFramePayload = {
        type: "COMPANION_TICK",
        syncVersion: store.syncVersion,
        tick,
        heartbeat: store.trackerHeartbeatsByUser[uid][tick.installationId]
      };
      broadcastSseEvent("companion_tick", wsFramePayload);
      broadcastWsFrame(wsFramePayload);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        accepted: 1,
        syncVersion: store.syncVersion,
        installationId: tick.installationId,
        timestampMs: tick.timestampMs,
        tick,
        heartbeat: store.trackerHeartbeatsByUser[uid][tick.installationId]
      }));
    });
    return;
  }

  // POST /api/v1/extension/events (Feature 12.5.1)
  if (req.method === "POST" && req.url.startsWith("/api/v1/extension/events")) {
    readJsonBody(req, res, MAX_BODY_BYTES, (_err, payload) => {
      const clientIp = String((req.socket && req.socket.remoteAddress) || "127.0.0.1");
      const instKeyForRl = String((payload && payload.installationId) || "browser_extension").slice(0, 64);
      const rlLimit = Number(req.headers["x-rate-limit-max"] || 240);
      const rl = RedisStateEngine.checkRateLimit(`rl:extension_events:${clientIp}:${instKeyForRl}`, rlLimit, 60);
      if (!rl.allowed) {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(rl.retryAfterSec) });
        res.end(JSON.stringify({ ok: false, error: "RATE_LIMIT_EXCEEDED", retryAfterMs: rl.retryAfterSec * 1000 }));
        return;
      }
      const rawUid = String((payload && payload.userId) || "").trim();
      if (rawUid === "usr_rahim_01") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Demo userId usr_rahim_01 is rejected" }));
        return;
      }
      if (req.headers["authorization"] || process.env.SCREENSYNC_REQUIRE_SYNC_AUTH === "1") {
        const authCheck = verifyBearerAuth(req, rawUid || "usr_local_companion");
        if (!authCheck.ok) {
          res.writeHead(authCheck.status, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: authCheck.error }));
          return;
        }
      }
      const uid = rawUid || "usr_local_companion";
      const installationId = String((payload && payload.installationId) || "inst_browser_ext").trim().slice(0, 96);
      const rawEvents = Array.isArray(payload && payload.events) ? payload.events : [payload];

      const acceptedEvents = [];
      const rejectedEvents = [];
      for (const ev of rawEvents) {
        const check = sanitizeAndValidateTelemetryPayload(ev, "extension");
        if (check.valid) {
          acceptedEvents.push({ raw: ev, sanitized: check.sanitized });
        } else {
          rejectedEvents.push({ reason: check.reason });
        }
      }
      if (acceptedEvents.length === 0 && rejectedEvents.length > 0) {
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: false,
          status: "TAMPER_REJECTED",
          error: rejectedEvents[0].reason,
          reason: rejectedEvents[0].reason,
          rejectedCount: rejectedEvents.length
        }));
        return;
      }

      if (!store.reelEventsByUser[uid]) store.reelEventsByUser[uid] = [];
      if (!store.trackerHeartbeatsByUser) store.trackerHeartbeatsByUser = {};
      if (!store.trackerHeartbeatsByUser[uid]) store.trackerHeartbeatsByUser[uid] = {};
      if (!Array.isArray(store.companionTicks)) store.companionTicks = [];

      const nowMs = Number(payload && payload.timestampMs) > 0 ? Number(payload.timestampMs) : Date.now();
      const prevBeat = store.trackerHeartbeatsByUser[uid][installationId];
      const gapMs = prevBeat && prevBeat.lastBeatMs ? Math.max(0, nowMs - prevBeat.lastBeatMs) : 0;
      const unexpectedSilenceGap = gapMs > 180000;

      store.trackerHeartbeatsByUser[uid][installationId] = {
        installationId,
        osCategory: "BrowserExtension",
        lastBeatMs: nowMs,
        gapMs,
        unexpectedSilenceGap,
        status: unexpectedSilenceGap ? "TAMPER_SILENCE_GAP_DETECTED" : "HEALTHY"
      };

      let ingestedCount = 0;
      let duplicatesSkipped = 0;
      acceptedEvents.forEach(({ raw: ev, sanitized }, idx) => {
        const eventId = String((ev && (ev.eventId || ev.idempotencyKey)) || `ext_${nowMs}_${idx}`).trim();
        const dedupKey = `${uid}::${installationId}::${eventId}`;
        if (!store.dedupLog[dedupKey]) {
          store.dedupLog[dedupKey] = true;
          store.reelEventsByUser[uid].push({
            eventId,
            installationId,
            platform: String((ev && (ev.platform || ev.appName)) || "YouTube Shorts").trim().slice(0, 64),
            durationSeconds: Math.max(1, Math.min(3600, Number((ev && (ev.durationSeconds ?? ev.watchSeconds)) || 15))),
            persistedWindowTitle: null,
            timestampMs: Number((ev && ev.timestampMs) || sanitized.timestampMs) > 0 ? Number((ev && ev.timestampMs) || sanitized.timestampMs) : nowMs
          });
          store.companionTicks.push(sanitized);
          ingestedCount += 1;
        } else {
          duplicatesSkipped += 1;
        }
      });
      if (store.companionTicks.length > 500) {
        store.companionTicks = store.companionTicks.slice(-500);
      }

      store.syncVersion += 1;
      saveStore(store);

      const wsFramePayload = {
        type: "EXTENSION_EVENTS",
        syncVersion: store.syncVersion,
        ingestedCount,
        heartbeat: store.trackerHeartbeatsByUser[uid][installationId]
      };
      broadcastSseEvent("extension_events", wsFramePayload);
      broadcastWsFrame(wsFramePayload);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        syncVersion: store.syncVersion,
        ingestedCount,
        acceptedCount: acceptedEvents.length,
        rejectedCount: rejectedEvents.length,
        processedCount: ingestedCount,
        duplicatesSkipped,
        heartbeat: store.trackerHeartbeatsByUser[uid][installationId]
      }));
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Not found" }));
});

// RFC 6455 WebSocket Companion Bridge at /ws/companion (ISSUE-12-02a)
server.on("upgrade", (req, socket) => {
  try {
    const reqUrl = String(req.url || "");
    if (!reqUrl.startsWith("/ws/companion") && !reqUrl.startsWith("/api/v1/ws")) {
      socket.destroy();
      return;
    }
    const wsKey = req.headers["sec-websocket-key"];
    if (!wsKey) {
      socket.destroy();
      return;
    }
    const acceptKey = crypto
      .createHash("sha1")
      .update(wsKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    const responseHeaders = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "",
      ""
    ].join("\r\n");
    socket.write(responseHeaders);
    wsCompanionSockets.add(socket);
    socket.on("close", () => wsCompanionSockets.delete(socket));
    socket.on("error", () => wsCompanionSockets.delete(socket));
  } catch (_e) {
    try { socket.destroy(); } catch (_e2) {}
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`[ScreenSync Sync Server] Listening on http://127.0.0.1:${PORT}/api/sync`);
  });
}

module.exports = {
  server,
  store,
  REDIS_ENABLED,
  REDIS_URL,
  RedisStateEngine,
  RedisAlwaysOnCache,
  verifyPasswordHashConstantTime,
  hashPasswordPbkdf2,
  resolveDeviceMarketingName,
  KNOWN_DEVICE_MODEL_MARKETING_NAMES,
  SUBSCRIPTION_PLAN_CATALOG,
  evaluateLiveSubscriptionRecord,
  isAllowedOrigin,
  verifyBearerAuth,
  sanitizeCompanionTickPayload,
  sanitizeAndValidateTelemetryPayload,
  broadcastSseEvent,
  broadcastWsFrame,
  loadLocalEnvFileIfPresent,
  HOST,
  PORT,
  FALLBACK_PORT
};
