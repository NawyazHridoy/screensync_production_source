#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC_HTML = path.join(ROOT, 'src', 'index.html');
const WWW_HTML = path.join(ROOT, 'www', 'index.html');
const SRC_CSS = path.join(ROOT, 'src', 'styles', 'main.css');
const SRC_JS = path.join(ROOT, 'src', 'js', 'app.js');
const CONFIG_JSON = path.join(ROOT, 'config', 'screensync.config.json');
const SRC_CONFIG_JSON = path.join(ROOT, 'src', 'config', 'screensync.config.json');
const SRC_ICONS_DIR = path.join(ROOT, 'src', 'icons');

const TARGETS = [
  SRC_HTML,
  WWW_HTML,
  path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public', 'index.html'),
  path.join(ROOT, 'ios', 'App', 'App', 'public', 'index.html'),
  path.join(ROOT, 'screensync_healthy_device_usage_cross_device_reel_tracker.html'),
  path.join(ROOT, 'platforms', 'browser-extension', 'index.html')
];

const PWA_ASSETS = [
  'manifest.webmanifest',
  'sw.js',
  'privacy_policy.html',
  'terms_of_service.html'
];

const PWA_TARGET_DIRS = [
  ROOT,
  path.join(ROOT, 'www'),
  path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public'),
  path.join(ROOT, 'ios', 'App', 'App', 'public')
];

const CONFIG_TARGET_DIRS = [
  path.join(ROOT, 'config'),
  path.join(ROOT, 'src', 'config'),
  path.join(ROOT, 'www', 'config'),
  path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public', 'config'),
  path.join(ROOT, 'ios', 'App', 'App', 'public', 'config')
];

const EXTRA_CONFIG_FILES = [
  'accessibility_supported_apps.json',
  'oem_profiles.json'
];

function verifyCanonicalConfigParity(options = {}) {
  const strict = Boolean(
    options.strict ||
    process.env.SCREENSYNC_STRICT_CONFIG_DRIFT === '1' ||
    process.argv.includes('--check-config-drift')
  );
  if (fs.existsSync(CONFIG_JSON) && fs.existsSync(SRC_CONFIG_JSON)) {
    const rootCfg = fs.readFileSync(CONFIG_JSON, 'utf8');
    const srcCfg = fs.readFileSync(SRC_CONFIG_JSON, 'utf8');
    if (rootCfg !== srcCfg) {
      const msg = '[ScreenSync Sync] CONFIG_DRIFT_DETECTED: src/config/screensync.config.json differs from canonical config/screensync.config.json. Edit config/screensync.config.json (canonical source of truth).';
      if (strict) {
        console.error(msg);
        process.exit(1);
      }
      return { ok: false, driftDetected: true, message: msg };
    }
  }
  return { ok: true, driftDetected: false };
}

function sync() {
  verifyCanonicalConfigParity();

  let html = fs.readFileSync(SRC_HTML, 'utf8');
  let css = '';
  let js = '';
  if (fs.existsSync(SRC_CSS) && fs.existsSync(SRC_JS)) {
    css = fs.readFileSync(SRC_CSS, 'utf8');
    js = fs.readFileSync(SRC_JS, 'utf8');
    html = html
      .replace(/<style>[\s\S]*?<\/style>/, () => `<style>\n${css}\n  </style>`)
      .replace(/<script>\s*\/\/ ===[\s\S]*?<\/script>/, () => `<script>\n${js}\n  </script>`);
  }
  for (const target of TARGETS) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, html, 'utf8');
    console.log(`[ScreenSync Sync] Synchronized -> ${path.relative(ROOT, target)}`);
  }

  for (const assetName of PWA_ASSETS) {
    const srcAsset = path.join(ROOT, 'src', assetName);
    if (fs.existsSync(srcAsset)) {
      const content = fs.readFileSync(srcAsset, 'utf8');
      for (const dir of PWA_TARGET_DIRS) {
        fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, assetName);
        fs.writeFileSync(dest, content, 'utf8');
        console.log(`[ScreenSync Sync] Synchronized PWA Asset -> ${path.relative(ROOT, dest)}`);
      }
    }
  }

  // Binary-safe Buffer copy for PWA PNG icons (C1-11 / A.4 Build Pitfall #3)
  if (fs.existsSync(SRC_ICONS_DIR)) {
    const iconFiles = fs.readdirSync(SRC_ICONS_DIR).filter((f) => /\.(png|ico|svg)$/i.test(f));
    for (const iconName of iconFiles) {
      const srcIconPath = path.join(SRC_ICONS_DIR, iconName);
      const iconBuffer = fs.readFileSync(srcIconPath);
      for (const dir of PWA_TARGET_DIRS) {
        const destIconsDir = path.join(dir, 'icons');
        fs.mkdirSync(destIconsDir, { recursive: true });
        const destIconPath = path.join(destIconsDir, iconName);
        fs.writeFileSync(destIconPath, iconBuffer);
      }
    }
  }

  if (fs.existsSync(CONFIG_JSON)) {
    const cfgContent = fs.readFileSync(CONFIG_JSON, 'utf8');
    for (const cfgDir of CONFIG_TARGET_DIRS) {
      fs.mkdirSync(cfgDir, { recursive: true });
      const dest = path.join(cfgDir, 'screensync.config.json');
      fs.writeFileSync(dest, cfgContent, 'utf8');
      console.log(`[ScreenSync Sync] Synchronized Runtime Config -> ${path.relative(ROOT, dest)}`);
    }
  }

  // Part 15 Task 15.3 Layer 3: Stamp cryptographic SHA-256 digest of index.html, app.js, and main.css
  const indexHtmlSha256 = crypto.createHash('sha256').update(Buffer.from(html, 'utf8')).digest('hex');
  const appJsSha256 = crypto.createHash('sha256').update(Buffer.from(js, 'utf8')).digest('hex');
  const mainCssSha256 = crypto.createHash('sha256').update(Buffer.from(css, 'utf8')).digest('hex');
  const integrityJson = JSON.stringify({
    version: '3.5.0',
    buildNumber: 35,
    indexHtmlSha256,
    appJsSha256,
    mainCssSha256
  }, null, 2);
  for (const cfgDir of CONFIG_TARGET_DIRS) {
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(path.join(cfgDir, 'bundle_integrity.json'), integrityJson, 'utf8');
  }

  for (const extraCfgName of EXTRA_CONFIG_FILES) {
    const srcExtraCfg = path.join(ROOT, 'src', 'config', extraCfgName);
    if (fs.existsSync(srcExtraCfg)) {
      const extraContent = fs.readFileSync(srcExtraCfg, 'utf8');
      for (const cfgDir of CONFIG_TARGET_DIRS) {
        fs.mkdirSync(cfgDir, { recursive: true });
        const dest = path.join(cfgDir, extraCfgName);
        fs.writeFileSync(dest, extraContent, 'utf8');
      }
    }
  }
}

if (require.main === module) {
  sync();
} else {
  sync();
  module.exports = { sync, verifyCanonicalConfigParity };
}
