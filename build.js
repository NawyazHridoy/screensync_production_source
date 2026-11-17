#!/usr/bin/env node
'use strict';

/**
 * ScreenSync Build Entrypoint (build.js)
 * Synchronizes all 5 HTML bundles, PWA assets, and runtime config via scripts/sync-web-assets.js,
 * and validates SHA-256 parity across all generated targets.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('./scripts/sync-web-assets.js');

const ROOT = __dirname;
const BUNDLES = [
  'src/index.html',
  'www/index.html',
  'android/app/src/main/assets/public/index.html',
  'ios/App/App/public/index.html',
  'screensync_healthy_device_usage_cross_device_reel_tracker.html'
];

const digests = BUNDLES.map((rel) => {
  const full = path.join(ROOT, rel);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  return { rel, hash };
});

const uniqueHashes = new Set(digests.map((d) => d.hash));
if (uniqueHashes.size !== 1) {
  console.error('[ScreenSync Build] ERROR: HTML bundle SHA-256 mismatch:', digests);
  process.exit(1);
}

console.log(`[ScreenSync Build] SUCCESS: All 5 HTML bundles synchronized (SHA-256: ${digests[0].hash})`);
