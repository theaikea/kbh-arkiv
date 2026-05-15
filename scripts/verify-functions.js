#!/usr/bin/env node
/**
 * Predeploy guard: Cloud Functions must be Firestore triggers, not HTTP.
 * Prevents redeploying enrichImageWithOpenAI as HTTPS by mistake.
 */
const fs = require("fs");
const path = require("path");

const indexPath = path.join(__dirname, "..", "functions", "index.js");
const source = fs.readFileSync(indexPath, "utf8");

const forbidden = [
  /\bonRequest\s*\(/,
  /\bfunctions\.https\b/,
  /\bhttps\.onRequest\b/,
  /exports\.enrichImageWithOpenAI\s*=/,
];

const hits = forbidden.filter((re) => re.test(source));
if (hits.length) {
  console.error("Functions predeploy check failed:");
  console.error("  functions/index.js must not use HTTP triggers or export enrichImageWithOpenAI.");
  console.error("  Use exports.enrichImageMetadata = onDocumentWritten(...) only.");
  process.exit(1);
}

if (!/exports\.enrichImageMetadata\s*=\s*onDocumentWritten/.test(source)) {
  console.error("Functions predeploy check failed:");
  console.error("  Expected exports.enrichImageMetadata = onDocumentWritten(...)");
  process.exit(1);
}

if (!/exports\.processImageEnrichment\s*=\s*onCall/.test(source)) {
  console.error("Expected exports.processImageEnrichment = onCall(...) for reliable backfill.");
  process.exit(1);
}

console.log("Functions predeploy check passed (enrichImageMetadata + processImageEnrichment).");
