const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions");
const OpenAI = require("openai");

initializeApp();

const openaiApiKey = defineSecret("OPENAI_API_KEY");

const MODEL = "gpt-4o-mini";
const AI_SEARCH_VERSION = 3;

const DISTRICT_IDS = [
  "vanloese",
  "broenshoej-husum",
  "indre-by",
  "vestebro",
  "norrebro",
  "frederiksberg",
  "osterbro",
  "amager-ost",
  "amager-vest",
  "valby",
  "bispebjerg",
];

const COLOR_IDS = [
  "roed",
  "blaa",
  "groen",
  "gul",
  "lyseroed",
  "orange",
  "sort",
  "graa",
  "hvid",
  "beige",
  "lilla",
  "brun",
];

function buildAiSearchText(caption, keywords, district, colors) {
  return [caption, district, ...(colors || []), ...(keywords || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function normalizeDistrict(value) {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return DISTRICT_IDS.includes(id) ? id : null;
}

function normalizeColors(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((c) => (typeof c === "string" ? c.trim().toLowerCase() : "")))]
    .filter((c) => COLOR_IDS.includes(c))
    .slice(0, 8);
}

function normalizeYearEstimate(value) {
  const y = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isFinite(y) || y < 1850 || y > 2100) return null;
  return y;
}

function hasSearchableMetadata(data) {
  return (
    (typeof data.aiCaption === "string" && data.aiCaption.trim().length > 0) ||
    (typeof data.aiSearchText === "string" && data.aiSearchText.trim().length > 0) ||
    (Array.isArray(data.aiKeywords) && data.aiKeywords.length > 0)
  );
}

function shouldEnrich(data) {
  if (data.aiEnrichmentInProgress === true) return false;
  const searchVersion = typeof data.aiSearchVersion === "number" ? data.aiSearchVersion : 0;
  if (
    !data.enrichmentRequested &&
    searchVersion >= AI_SEARCH_VERSION &&
    data.aiEnrichedAt != null &&
    data.aiEnrichmentFailed !== true &&
    hasSearchableMetadata(data)
  ) {
    return false;
  }
  return true;
}

async function enrichImageDoc(docRef, data) {
  const imageUrl = typeof data.url === "string" ? data.url : "";
  if (!imageUrl) {
    await docRef.update({
      aiEnrichmentFailed: true,
      aiEnrichmentError: "missing_url",
      aiEnrichedAt: FieldValue.serverTimestamp(),
      aiSearchVersion: AI_SEARCH_VERSION,
      enrichmentRequested: FieldValue.delete(),
    });
    return { ok: false, reason: "missing_url" };
  }

  await docRef.update({ aiEnrichmentInProgress: true });
  logger.info("Enriching image", { imageId: docRef.id });

  const openai = new OpenAI({ apiKey: openaiApiKey.value() });

  const system =
    "You help a public photo archive about Copenhagen (KBH Arkiv). " +
    "Describe only what is clearly visible. Caption in Danish. Keywords for search in Danish AND English.";

  const userText =
    "Return one JSON object with keys: caption, keywords, district, colors, yearEstimate. " +
    '"caption": 1–2 Danish sentences — concrete, searchable. ' +
    '"keywords": 40–70 unique lowercase strings (Danish + English for objects, materials, setting). ' +
    (data.latitude != null && data.longitude != null
      ? '"district": null (GPS already set — do not guess location). '
      : `"district": exactly one id from [${DISTRICT_IDS.join(", ")}] if the photo is clearly in that Copenhagen area; otherwise null. `) +
    `"colors": array of 0–6 dominant color ids from [${COLOR_IDS.join(", ")}] (only clearly visible). ` +
    '"yearEstimate": 4-digit year if era is guessable from architecture, vehicles, fashion, signage; otherwise null. ' +
    "JSON only, no markdown.";

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      max_tokens: 1200,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await docRef.update({
        aiEnrichmentFailed: true,
        aiEnrichmentError: "invalid_json_from_model",
        aiEnrichedAt: FieldValue.serverTimestamp(),
        aiEnrichmentInProgress: FieldValue.delete(),
        enrichmentRequested: FieldValue.delete(),
      });
      return { ok: false, reason: "invalid_json_from_model" };
    }

    const caption =
      typeof parsed.caption === "string" ? parsed.caption.trim().slice(0, 800) : "";
    let keywords = Array.isArray(parsed.keywords) ? parsed.keywords : [];
    keywords = keywords
      .filter((k) => typeof k === "string")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 70);

    const gpsDistrict = normalizeDistrict(data.district);
    const aiDistrict = normalizeDistrict(parsed.district);
    const districtForSearch = gpsDistrict || aiDistrict;
    const aiColors = normalizeColors(parsed.colors);
    const yearEstimate = normalizeYearEstimate(parsed.yearEstimate);
    const photoYear = typeof data.photoYear === "number" ? data.photoYear : yearEstimate;
    const aiSearchText = buildAiSearchText(caption, keywords, districtForSearch, aiColors);

    const enrichmentUpdate = {
      aiCaption: caption || null,
      aiKeywords: keywords,
      aiDistrict: gpsDistrict ? null : aiDistrict,
      aiColors,
      year: photoYear ?? null,
      aiSearchText,
      aiSearchVersion: AI_SEARCH_VERSION,
      aiModel: MODEL,
      aiEnrichedAt: FieldValue.serverTimestamp(),
      aiEnrichmentFailed: FieldValue.delete(),
      aiEnrichmentError: FieldValue.delete(),
      aiEnrichmentInProgress: FieldValue.delete(),
      enrichmentRequested: FieldValue.delete(),
    };
    if (!gpsDistrict && aiDistrict) enrichmentUpdate.district = aiDistrict;

    await docRef.update(enrichmentUpdate);
    logger.info("Enriched image OK", { imageId: docRef.id, keywordCount: keywords.length });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Enrichment failed", { imageId: docRef.id, message });
    await docRef.update({
      aiEnrichmentFailed: true,
      aiEnrichmentError: message.slice(0, 500),
      aiEnrichedAt: FieldValue.serverTimestamp(),
      aiEnrichmentInProgress: FieldValue.delete(),
      enrichmentRequested: FieldValue.delete(),
    });
    return { ok: false, reason: message };
  }
}

/** Firestore trigger — new uploads & enrichmentRequested flag. */
exports.enrichImageMetadata = onDocumentWritten(
  {
    document: "images/{imageId}",
    database: "(default)",
    secrets: [openaiApiKey],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (event) => {
    const change = event.data;
    if (!change?.after?.exists) return;

    const snap = change.after;
    const data = snap.data();
    if (!shouldEnrich(data)) return;

    await enrichImageDoc(snap.ref, data);
  }
);

/**
 * Callable backfill — processes images directly (does not rely on Eventarc).
 * Client calls this while the gallery is open.
 */
exports.processImageEnrichment = onCall(
  {
    region: "us-central1",
    secrets: [openaiApiKey],
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async (request) => {
    const limit = Math.min(Math.max(Number(request.data?.limit) || 2, 1), 5);
    const db = getFirestore();
    const snap = await db.collection("images").get();

    const results = [];
    for (const docSnap of snap.docs) {
      if (results.length >= limit) break;
      const data = docSnap.data();
      if (!shouldEnrich(data)) continue;
      const result = await enrichImageDoc(docSnap.ref, data);
      results.push({ id: docSnap.id, ...result });
    }

    return {
      processed: results.length,
      results,
      remaining: snap.size - countWithMetadata(snap.docs),
    };
  }
);

function countWithMetadata(docs) {
  return docs.filter((d) => hasSearchableMetadata(d.data())).length;
}
