#!/usr/bin/env node
'use strict';

/**
 * ScreenSync Browser Extension Packaging Script (Part 15 Section P15.2)
 * Usage: node scripts/package-browser-extension.js
 *
 * Pure Node.js PKZIP archive generator (using built-in `zlib.deflateRawSync` + IEEE 802.3 CRC-32)
 * so it runs deterministically across Windows, macOS, Linux, ChromeOS, and minimal CI containers
 * without requiring an external `zip` binary.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'platforms', 'browser-extension');
const DIST_DIR = path.join(ROOT, 'dist');
const OUT_ZIP = path.join(DIST_DIR, 'screensync-chrome-extension-mv3.zip');

require('./sync-web-assets.js');

const REQUIRED_FILES = [
  'manifest.json',
  'background_collector.js',
  'content_shortform_observer.js',
  'content_bridge.js',
  'popup.html',
  'popup.js',
  'options.html',
  'options.js',
  'index.html',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png'
];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function collectFilesRecursive(baseDir, relDir = '') {
  const results = [];
  const fullDir = path.join(baseDir, relDir);
  const entries = fs.readdirSync(fullDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursive(baseDir, relPath));
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

function buildZipBufferFromDirectory(sourceDir) {
  const files = collectFilesRecursive(sourceDir);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const relPath of files) {
    const fullPath = path.join(sourceDir, relPath);
    const rawData = fs.readFileSync(fullPath);
    const compressed = zlib.deflateRawSync(rawData, { level: 9 });
    const useDeflate = compressed.length < rawData.length;
    const payload = useDeflate ? compressed : rawData;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(rawData);
    const nameBuf = Buffer.from(relPath.replace(/\\/g, '/'), 'utf8');

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x5d71, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5d71, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    localParts.push(localHeader, payload);
    centralParts.push(centralHeader);
    offset += localHeader.length + payload.length;
  }

  const centralSize = centralParts.reduce((acc, b) => acc + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function packageExtension() {
  for (const rel of REQUIRED_FILES) {
    const full = path.join(EXT_DIR, rel);
    if (!fs.existsSync(full)) {
      throw new Error(`[ScreenSync Extension Packager] Missing required MV3 file: ${rel}`);
    }
  }

  fs.mkdirSync(DIST_DIR, { recursive: true });
  const zipBuf = buildZipBufferFromDirectory(EXT_DIR);
  fs.writeFileSync(OUT_ZIP, zipBuf);

  const sha256 = crypto.createHash('sha256').update(zipBuf).digest('hex');
  console.log(`[ScreenSync Extension Packager] Packaged -> ${path.relative(ROOT, OUT_ZIP)} (${zipBuf.length} bytes, SHA-256: ${sha256})`);
  return {
    ok: true,
    outputPath: OUT_ZIP,
    sizeBytes: zipBuf.length,
    sha256
  };
}

if (require.main === module) {
  packageExtension();
} else {
  module.exports = { packageExtension, REQUIRED_FILES };
}
