import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAnalytics, isSupported as analyticsIsSupported } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";
import { getFirestore, collection, addDoc, doc, serverTimestamp, onSnapshot }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import {
  districtFromCoordinates,
  isInCopenhagenArea,
  roundCoordinate,
} from "./geolocation.js";

const firebaseConfig = {
  apiKey: "AIzaSyAYVVPPWW2czYfd4lqkqEMsSNzlYacAIdE",
  authDomain: "kbh-samlet2.firebaseapp.com",
  projectId: "kbh-samlet2",
  storageBucket: "kbh-samlet2.firebasestorage.app",
  messagingSenderId: "97281184924",
  appId: "1:97281184924:web:31da88dc3d983bc53a4959",
  measurementId: "G-4V02WQTVVT"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app, 'us-central1');
const processImageEnrichment = httpsCallable(functions, 'processImageEnrichment');
analyticsIsSupported()
  .then(supported => {
    if (supported) getAnalytics(app);
  })
  .catch(() => {});

let allImages = [];
/** @type {string} */
let searchQuery = '';
/** @type {Set<string>} */
let filterDistricts = new Set();
/** @type {Set<string>} */
let filterColors = new Set();
let filterYearFrom = null;
let filterYearTo = null;
let catalogYearMin = new Date().getFullYear();
let catalogYearMax = new Date().getFullYear();
let filtersInitialized = false;
let introStarted = false;
let enrichmentWorkerRunning = false;
let enrichmentWorkerTimer = null;
let lastEnrichmentError = '';
let offsetX = 0, offsetY = 0;
let canvasScale = 1;
let dragging = false, startX, startY;
let velocityX = 0, velocityY = 0;
let lastPointerX = 0, lastPointerY = 0, lastPointerTime = 0;
let inertiaTween = null;
let wheelPanTween = null;
let wheelTargetX = 0;
let wheelTargetY = 0;
const wheelProxy = { x: 0, y: 0 };
let introTween = null;
let introNudgeTimer = null;
let introNudgePending = false;
let keyPanTween = null;
let hasUserNavigated = false;
const cards = new Map();
const aspectRatioCache = new Map();
let renderQueued = false;
let committedPoolSignature = null;
let gridAnimGeneration = 0;
/** Per-cell fade-in delay (seconds), reshuffled on each gallery change. */
let revealDelays = new Map();

/** Danish ↔ English groups so e.g. "lampe" also matches "lamp" in keywords. */
const SEARCH_SYNONYM_GROUPS = [
  ['dør', 'dor', 'door', 'doors', 'døre'],
  ['vindue', 'window', 'windows', 'rude'],
  ['lampe', 'lamper', 'lamp', 'lamps', 'lygte', 'lygter', 'light', 'lights', 'belysning'],
  ['stol', 'chair', 'chairs'],
  ['bord', 'table', 'tables'],
  ['cykel', 'cykler', 'bike', 'bicycle', 'bicycles'],
  ['bil', 'car', 'cars', 'auto'],
  ['bus', 'buses'],
  ['tog', 'train', 'trains'],
  ['bro', 'bridge', 'bridges'],
  ['kanal', 'canal', 'canals'],
  ['gade', 'street', 'streets', 'vej', 'road'],
  ['plads', 'square', 'squares'],
  ['mur', 'wall', 'walls', 'facade', 'facader'],
  ['tag', 'roof', 'roofs'],
  ['træ', 'trae', 'tree', 'trees', 'wood', 'wooden'],
  ['blomst', 'flower', 'flowers'],
  ['vand', 'water', 'havn', 'harbor', 'harbour', 'port'],
  ['himmel', 'sky', 'skies'],
  ['skilt', 'sign', 'signs', 'skilte'],
  ['brosten', 'cobblestone', 'cobblestones', 'belægning'],
  ['menneske', 'person', 'people', 'folk', 'mand', 'kvinde'],
  ['rød', 'rod', 'red'],
  ['blå', 'blaa', 'blue'],
  ['grøn', 'gron', 'green'],
  ['gul', 'yellow'],
  ['hvid', 'white'],
  ['sort', 'black'],
  ['grå', 'graa', 'gray', 'grey'],
  ['brun', 'brown'],
  ['orange'],
  ['pink', 'rosa', 'lyseroed', 'lyserød'],
  ['lilla', 'purple', 'violet'],
  ['beige'],
  ['metal', 'metallisk'],
  ['glas', 'glass'],
  ['sten', 'stone', 'brick', 'mursten', 'tegl'],
  ['beton', 'concrete'],
  ['indendørs', 'indendoers', 'indoor', 'inside'],
  ['udendørs', 'udendoers', 'outdoor', 'outside'],
  ['dag', 'day', 'daytime'],
  ['nat', 'night', 'nighttime'],
  ['sommer', 'summer'],
  ['vinter', 'winter'],
];

const FILTER_DISTRICTS = [
  { id: 'vanloese', label: 'Vanløse' },
  { id: 'broenshoej-husum', label: 'Brønshøj/Husum' },
  { id: 'indre-by', label: 'Indre By' },
  { id: 'vestebro', label: 'Vesterbro/Kongens Enghave' },
  { id: 'norrebro', label: 'Nørrebro' },
  { id: 'frederiksberg', label: 'Frederiksberg' },
  { id: 'osterbro', label: 'Østerbro' },
  { id: 'amager-ost', label: 'Amager Øst' },
  { id: 'amager-vest', label: 'Amager Vest' },
  { id: 'valby', label: 'Valby' },
  { id: 'bispebjerg', label: 'Bispebjerg' },
];

const FILTER_COLORS = [
  { id: 'roed', label: 'Rød', hex: '#E4002B' },
  { id: 'blaa', label: 'Blå', hex: '#00AEEF' },
  { id: 'groen', label: 'Grøn', hex: '#00B140' },
  { id: 'gul', label: 'Gul', hex: '#FFE600' },
  { id: 'lyseroed', label: 'Lyserød', hex: '#F4A6C8' },
  { id: 'orange', label: 'Orange', hex: '#FF8200' },
  { id: 'sort', label: 'Sort', hex: '#000000' },
  { id: 'graa', label: 'Grå', hex: '#B5B5B5' },
  { id: 'hvid', label: 'Hvid', hex: '#FFFFFF' },
  { id: 'beige', label: 'Beige', hex: '#F2E8D5' },
  { id: 'lilla', label: 'Lilla', hex: '#C400B8' },
  { id: 'brun', label: 'Brun', hex: '#8B5A2B' },
];

const COLOR_FILTER_KEYWORDS = {
  roed: ['rød', 'rod', 'red'],
  blaa: ['blå', 'blaa', 'blue'],
  groen: ['grøn', 'gron', 'green'],
  gul: ['gul', 'yellow'],
  lyseroed: ['lyserød', 'lyserod', 'pink', 'rosa'],
  orange: ['orange'],
  sort: ['sort', 'black'],
  graa: ['grå', 'graa', 'gray', 'grey'],
  hvid: ['hvid', 'white'],
  beige: ['beige'],
  lilla: ['lilla', 'purple', 'violet'],
  brun: ['brun', 'brown'],
};

const CELL = 290;
const GAP = 18;
const STEP = CELL + GAP;
const PRELOAD_CELLS = 1;
const GRID_X_OFFSET = -Math.round(CELL / 2);
const REVEAL_FADE_DURATION = 0.2;
const REVEAL_SPAN_MAX = 0.42;
const REVEAL_SPAN_BASE = 0.02;
const REVEAL_SPAN_PER_CARD = 0.009;
const REVEAL_JITTER_MAX = 0.028;
const INTRO_NUDGE_DURATION = 1.45;
const INTRO_NUDGE_EASE = 'power3.out';

const wrap = document.getElementById('canvas-wrap');
const canvas = document.getElementById('canvas');
const imageDetail = document.getElementById('image-detail');
const imageDetailPanel = document.getElementById('image-detail-panel');
const imageDetailCloseBtn = document.getElementById('image-detail-close');
const imageDetailDistrictEl = document.getElementById('image-detail-district');
const imageDetailYearEl = document.getElementById('image-detail-year');
const imageDetailColorsEl = document.getElementById('image-detail-colors');
const imageDetailCaptionEl = document.getElementById('image-detail-caption');
wrap.setAttribute('tabindex', '0');

let galleryClickAnchor = { x: 0, y: 0, moved: false, dismissed: false };
let suppressDetailClick = false;
let imageDetailOpen = false;
let imageDetailClosing = false;
let imageDetailTween = null;
let imageDetailCard = null;
let imageDetailPanelW = 360;
let savedGalleryView = { offsetX: 0, offsetY: 0, scale: 1 };
const DETAIL_OPEN_DURATION = 0.78;
const DETAIL_CLOSE_DURATION = 0.62;
const DETAIL_EASE = 'power3.inOut';
const DETAIL_PANEL_EASE = 'expo.out';
const DETAIL_PANEL_GAP = 0;
/** Screen height fraction — every image zooms to this exact height. */
const DETAIL_TARGET_HEIGHT_RATIO = 0.78;

function updateCanvasTransform() {
  canvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${canvasScale})`;
}

function getCardCanvasRect(card) {
  const left = parseFloat(card.style.left) || 0;
  const top = parseFloat(card.style.top) || 0;
  const width = CELL;
  const height = parseFloat(card.style.height) || CELL;
  return { left, top, width, height };
}

function getCardScreenRect(card) {
  const { left, top, width, height } = getCardCanvasRect(card);
  return {
    left: offsetX + left * canvasScale,
    top: offsetY + top * canvasScale,
    width: width * canvasScale,
    height: height * canvasScale,
  };
}

function getDetailPanelWidth() {
  return Math.min(wrap.clientWidth * 0.3, 360);
}

/** Pan/zoom canvas so the image is centered with the info panel on its right. */
function computeDetailView(card) {
  const { left, top, width, height } = getCardCanvasRect(card);
  const vw = wrap.clientWidth;
  const vh = wrap.clientHeight;
  const panelW = getDetailPanelWidth();
  const targetImgH = vh * DETAIL_TARGET_HEIGHT_RATIO;
  const scale = targetImgH / height;
  const scaledW = width * scale;
  const scaledH = height * scale;
  const imageLeft = (vw - panelW - DETAIL_PANEL_GAP - scaledW) / 2;
  const imageTop = (vh - scaledH) / 2;
  return {
    offsetX: imageLeft - left * scale,
    offsetY: imageTop - top * scale,
    scale,
    panelW,
  };
}

function syncDetailPanel(card, panelW, reveal = 1) {
  if (!card || !imageDetailPanel) return;
  const rect = getCardScreenRect(card);
  positionDetailPanel(rect, panelW);
  const openX = getDetailPanelOpenX(rect);
  const x = openX * reveal;
  const clipLeft = rect.width * (1 - reveal);
  const clipPath = `inset(0 0 0 ${clipLeft}px)`;
  const g = window.gsap;
  if (g) {
    g.set(imageDetailPanel, { x, opacity: reveal, clipPath });
  } else {
    imageDetailPanel.style.transform = `translateX(${x}px)`;
    imageDetailPanel.style.opacity = String(reveal);
    imageDetailPanel.style.clipPath = clipPath;
  }
}

function requestCloseImageDetail() {
  if (!imageDetailOpen || imageDetailClosing) return false;
  suppressDetailClick = true;
  closeImageDetail(true);
  return true;
}

function positionDetailPanel(screenRect, panelW) {
  if (!imageDetailPanel) return;
  imageDetailPanel.style.left = `${screenRect.left}px`;
  imageDetailPanel.style.top = `${screenRect.top}px`;
  imageDetailPanel.style.width = `${panelW}px`;
  imageDetailPanel.style.height = `${screenRect.height}px`;
}

function getDetailPanelOpenX(screenRect) {
  return screenRect.width + DETAIL_PANEL_GAP;
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

const PAN_EASE = 'power4.out';
const WHEEL_SCALE = 0.3;
const WHEEL_PAN_DURATION = 1.5;
const KEYBOARD_PAN_STEP = 115;
const KEYBOARD_PAN_DURATION = 1.4;
const MOMENTUM_EASE = 'power4.out';
const MOMENTUM_MULTIPLIER_MS = 480;
const MOMENTUM_DURATION_MIN = 0.95;
const MOMENTUM_DURATION_MAX = 3.5;
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const keysPressed = new Set();

function stopWheelPan() {
  if (!wheelPanTween) return;
  wheelPanTween.kill();
  wheelPanTween = null;
}

function panBy(dx, dy) {
  stopIntroNudge();
  stopInertia();
  stopWheelPan();
  offsetX += dx;
  offsetY += dy;
  updateCanvasTransform();
  queueRender();
}

function panFromWheel(deltaX, deltaY) {
  stopIntroNudge();
  stopInertia();
  if (keyPanTween) {
    keyPanTween.kill();
    keyPanTween = null;
  }

  if (!wheelPanTween) {
    wheelTargetX = offsetX;
    wheelTargetY = offsetY;
  }
  wheelTargetX -= deltaX * WHEEL_SCALE;
  wheelTargetY -= deltaY * WHEEL_SCALE;

  const g = window.gsap;
  if (!g) {
    offsetX = wheelTargetX;
    offsetY = wheelTargetY;
    updateCanvasTransform();
    queueRender();
    return;
  }

  if (wheelPanTween) wheelPanTween.kill();
  wheelProxy.x = offsetX;
  wheelProxy.y = offsetY;
  wheelPanTween = g.to(wheelProxy, {
    x: wheelTargetX,
    y: wheelTargetY,
    duration: WHEEL_PAN_DURATION,
    ease: PAN_EASE,
    overwrite: true,
    onUpdate() {
      offsetX = wheelProxy.x;
      offsetY = wheelProxy.y;
      updateCanvasTransform();
      queueRender();
    },
    onComplete() {
      wheelPanTween = null;
    },
  });
}

function panByWithGsap(dx, dy) {
  stopIntroNudge();
  stopInertia();
  stopWheelPan();
  const g = window.gsap;
  if (!g) {
    panBy(dx, dy);
    return;
  }

  if (keyPanTween) {
    keyPanTween.kill();
    keyPanTween = null;
  }

  const state = { x: offsetX, y: offsetY };
  keyPanTween = g.to(state, {
    x: offsetX + dx,
    y: offsetY + dy,
    duration: KEYBOARD_PAN_DURATION,
    ease: PAN_EASE,
    overwrite: true,
    onUpdate() {
      offsetX = state.x;
      offsetY = state.y;
      updateCanvasTransform();
      queueRender();
    },
    onComplete() {
      keyPanTween = null;
    },
  });
}

function stopInertia() {
  if (!inertiaTween) return;
  inertiaTween.kill();
  inertiaTween = null;
}

function stopIntroNudge() {
  if (introNudgeTimer) {
    clearTimeout(introNudgeTimer);
    introNudgeTimer = null;
  }
  if (!introTween) return;
  introTween.kill();
  introTween = null;
}

function getMaxRevealDelay() {
  let max = 0;
  for (const delay of revealDelays.values()) max = Math.max(max, delay);
  return max;
}

function scheduleIntroNudgeAfterReveal() {
  if (introNudgeTimer) {
    clearTimeout(introNudgeTimer);
    introNudgeTimer = null;
  }
  if (hasUserNavigated) {
    introNudgePending = false;
    return;
  }

  const maxDelay = getMaxRevealDelay();
  const waitMs = (maxDelay + REVEAL_FADE_DURATION) * 1000 + 30;

  introNudgeTimer = setTimeout(() => {
    introNudgeTimer = null;
    introNudgePending = false;
    if (!hasUserNavigated) startIntroNudge();
  }, waitMs);
}

function startIntroNudge() {
  if (introTween) return;
  const g = window.gsap;
  if (!g) return;

  const state = { x: offsetX, y: offsetY };
  introTween = g.to(state, {
    x: offsetX - 150,
    y: offsetY - 110,
    duration: INTRO_NUDGE_DURATION,
    ease: INTRO_NUDGE_EASE,
    onUpdate() {
      offsetX = state.x;
      offsetY = state.y;
      updateCanvasTransform();
      queueRender();
    },
    onComplete() {
      introTween = null;
    },
  });
}

function startInertia() {
  stopInertia();

  const g = window.gsap;
  if (!g) return;

  const speed = Math.hypot(velocityX, velocityY); // px/ms
  if (speed < 0.02) return;

  const duration = g.utils.clamp(
    MOMENTUM_DURATION_MIN,
    MOMENTUM_DURATION_MAX,
    speed * 1.75
  );

  const targetX = offsetX + (velocityX * MOMENTUM_MULTIPLIER_MS);
  const targetY = offsetY + (velocityY * MOMENTUM_MULTIPLIER_MS);

  inertiaTween = g.to(
    { x: offsetX, y: offsetY },
    {
      x: targetX,
      y: targetY,
      duration,
      ease: MOMENTUM_EASE,
      overwrite: true,
      onUpdate() {
        const p = this.targets()[0];
        offsetX = p.x;
        offsetY = p.y;
        updateCanvasTransform();
        queueRender();
      },
      onComplete() {
        inertiaTween = null;
      },
    }
  );
}

function dismissOverlaysForGalleryPan() {
  hasUserNavigated = true;
  closeMenuIfOpen();
  closeFilterPanel();
  closeSearchPanel();
  requestCloseImageDetail();
}

function startDrag(clientX, clientY) {
  galleryClickAnchor = { x: clientX, y: clientY, moved: false, dismissed: false };
  stopIntroNudge();
  stopInertia();
  stopWheelPan();
  dragging = true;
  startX = clientX - offsetX;
  startY = clientY - offsetY;
  lastPointerX = clientX;
  lastPointerY = clientY;
  lastPointerTime = performance.now();
  velocityX = 0;
  velocityY = 0;
}

function moveDrag(clientX, clientY) {
  if (!dragging) return;
  const movedPx = Math.hypot(clientX - galleryClickAnchor.x, clientY - galleryClickAnchor.y);
  if (movedPx > 6) {
    if (!galleryClickAnchor.dismissed) {
      galleryClickAnchor.dismissed = true;
      dismissOverlaysForGalleryPan();
    }
    galleryClickAnchor.moved = true;
  }
  const now = performance.now();
  const dt = Math.max(1, now - lastPointerTime);
  const dx = clientX - lastPointerX;
  const dy = clientY - lastPointerY;

  offsetX = clientX - startX;
  offsetY = clientY - startY;

  velocityX = dx / dt;
  velocityY = dy / dt;
  lastPointerX = clientX;
  lastPointerY = clientY;
  lastPointerTime = now;

  updateCanvasTransform();
  queueRender();
}

function endDrag() {
  if (!dragging) return;
  dragging = false;
  startInertia();
}

function getAspectRatio(image) {
  if (!image || !image.url) return 1;
  if (typeof image.aspectRatio === 'number' && image.aspectRatio > 0) return image.aspectRatio;

  const cached = aspectRatioCache.get(image.url);
  if (typeof cached === 'number' && cached > 0) return cached;
  if (cached === 'loading') return 1;

  aspectRatioCache.set(image.url, 'loading');
  const probe = new Image();
  probe.onload = () => {
    const ratio = probe.naturalWidth > 0 && probe.naturalHeight > 0
      ? probe.naturalWidth / probe.naturalHeight
      : 1;
    aspectRatioCache.set(image.url, ratio);
    queueRender();
  };
  probe.onerror = () => {
    aspectRatioCache.set(image.url, 1);
  };
  probe.src = image.url;

  return 1;
}

function getCardHeight(image) {
  const ratio = getAspectRatio(image);
  return Math.max(120, Math.round(CELL / ratio));
}

let exifrModulePromise = null;

async function getExifr() {
  if (!exifrModulePromise) {
    exifrModulePromise = import('https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs').catch(() => null);
  }
  return exifrModulePromise;
}

async function readGpsFromFile(file) {
  try {
    const exifr = await getExifr();
    if (!exifr?.gps) return null;
    const gps = await exifr.gps(file);
    if (!gps || !Number.isFinite(gps.latitude) || !Number.isFinite(gps.longitude)) {
      return null;
    }
    const latitude = roundCoordinate(gps.latitude);
    const longitude = roundCoordinate(gps.longitude);
    if (!isInCopenhagenArea(latitude, longitude)) {
      return { latitude, longitude, district: null, outsideCopenhagen: true };
    }
    return {
      latitude,
      longitude,
      district: districtFromCoordinates(latitude, longitude),
      outsideCopenhagen: false,
    };
  } catch {
    return null;
  }
}

function readFileAspectRatio(file) {
  return new Promise(resolve => {
    const blobUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const ratio = img.naturalWidth > 0 && img.naturalHeight > 0
        ? img.naturalWidth / img.naturalHeight
        : 1;
      URL.revokeObjectURL(blobUrl);
      resolve(ratio);
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      resolve(1);
    };
    img.src = blobUrl;
  });
}

function isHeicFile(file) {
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  return type === 'image/heic'
    || type === 'image/heif'
    || name.endsWith('.heic')
    || name.endsWith('.heif');
}

async function normalizeUploadFile(file) {
  if (!isHeicFile(file)) return file;

  const converter = window.heic2any;
  if (!converter) {
    throw new Error('HEIC conversion is unavailable. Please refresh and try again.');
  }

  const converted = await converter({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.92,
  });

  const outputBlob = Array.isArray(converted) ? converted[0] : converted;
  const jpgName = file.name.replace(/\.(heic|heif)$/i, '') + '.jpg';
  return new File([outputBlob], jpgName, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

function getDistrictSearchTerms(districtId) {
  const def = FILTER_DISTRICTS.find((x) => x.id === districtId);
  if (!def) return [normalizeSearchText(districtId)];
  const parts = [districtId, def.label, ...def.label.split(/[/\s,]+/)];
  return [...new Set(parts.map((p) => normalizeSearchText(p)).filter((p) => p.length >= 3))];
}

function imageHasSearchableMetadata(img) {
  return Boolean(
    img.aiCaption ||
    img.aiSearchText ||
    (Array.isArray(img.aiKeywords) && img.aiKeywords.length > 0)
  );
}

function countEnrichedImages() {
  return allImages.filter(imageHasSearchableMetadata).length;
}

function needsEnrichment(img) {
  if (img.aiEnrichmentInProgress === true) return false;
  if (imageHasSearchableMetadata(img)) return false;
  if (img.aiEnrichedAt != null && img.aiEnrichmentFailed !== true) {
    const v = typeof img.aiSearchVersion === 'number' ? img.aiSearchVersion : 0;
    if (v >= 3) return false;
  }
  return Boolean(img.url);
}

function countPendingEnrichment() {
  return allImages.filter(needsEnrichment).length;
}

function stopEnrichmentWorker() {
  if (enrichmentWorkerTimer != null) {
    clearTimeout(enrichmentWorkerTimer);
    enrichmentWorkerTimer = null;
  }
}

async function runEnrichmentWorker() {
  const pending = countPendingEnrichment();
  if (pending === 0) {
    lastEnrichmentError = '';
    stopEnrichmentWorker();
    return;
  }
  if (enrichmentWorkerRunning) return;

  enrichmentWorkerRunning = true;
  try {
    const { data } = await processImageEnrichment({ limit: 2 });
    lastEnrichmentError = '';
    console.info('AI enrichment batch', data);
  } catch (err) {
    lastEnrichmentError = err?.message || String(err);
    console.error('AI enrichment batch failed', err);
  }
  enrichmentWorkerRunning = false;
  refreshGalleryFilters();

  if (countPendingEnrichment() > 0) {
    enrichmentWorkerTimer = setTimeout(runEnrichmentWorker, 8000);
  }
}

function startEnrichmentWorker() {
  stopEnrichmentWorker();
  if (countPendingEnrichment() > 0) {
    runEnrichmentWorker();
  }
}

// ── Load images from Firebase (live updates when AI enrichment completes) ──
function loadImages() {
  onSnapshot(
    collection(db, 'images'),
    (snapshot) => {
      allImages = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      updateCatalogYearBounds();
      initFilterPanel();
      updateFilterYearInputs();
      refreshGalleryFilters();
      startEnrichmentWorker();
      render();
      if (!introStarted && !hasUserNavigated) {
        introStarted = true;
        introNudgePending = true;
      }
    },
    (error) => {
      const emptyEl = document.getElementById('canvas-empty');
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = 'Kunne ikke hente billeder.';
      }
      console.error(error);
    }
  );
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/å/g, 'aa')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe');
}

function expandSearchTerm(term) {
  const normalized = normalizeSearchText(term);
  const variants = new Set([term.toLowerCase(), normalized]);
  for (const group of SEARCH_SYNONYM_GROUPS) {
    const normalizedGroup = group.map(normalizeSearchText);
    const hit = group.some(
      (word, i) => word === term.toLowerCase() || normalizedGroup[i] === normalized
    );
    if (hit) group.forEach((word) => variants.add(word));
  }
  return [...variants];
}

function buildImageSearchHaystack(img) {
  const chunks = [
    img.name,
    img.aiCaption,
    img.aiSearchText,
    ...(Array.isArray(img.aiKeywords) ? img.aiKeywords : []),
  ];
  const district = getImageDistrict(img);
  if (district) {
    const def = FILTER_DISTRICTS.find((x) => x.id === district);
    if (def) chunks.push(def.label, district);
  }
  if (Array.isArray(img.aiColors)) {
    for (const colorId of img.aiColors) {
      const def = FILTER_COLORS.find((x) => x.id === colorId);
      if (def) chunks.push(def.label, colorId);
    }
  }
  return normalizeSearchText(chunks.filter(Boolean).join(' '));
}

/** Whole words/tokens only — avoids "door" matching inside "udendørs" (→ udendo**ers** / doer). */
function getSearchTokens(img) {
  const haystack = buildImageSearchHaystack(img);
  return new Set(
    haystack.split(/[^a-z0-9]+/).filter((token) => token.length >= 2)
  );
}

function imageMatchesSearchTerm(img, term) {
  const tokens = getSearchTokens(img);
  return expandSearchTerm(term).some((variant) => {
    const nv = normalizeSearchText(variant);
    if (!nv || nv.length < 2) return false;
    if (tokens.has(nv)) return true;
    // Prefix match only for longer terms (e.g. "køben" → København token).
    if (nv.length >= 4) {
      return [...tokens].some((t) => t.startsWith(nv) || nv.startsWith(t));
    }
    return false;
  });
}

function imageMatchesDistrict(img, districtId) {
  if (getImageDistrict(img) === districtId) return true;
  const tokens = getSearchTokens(img);
  return getDistrictSearchTerms(districtId).some((term) => tokens.has(term));
}

/** GPS bydel takes priority over AI guess. */
function getImageDistrict(img) {
  if (typeof img.district === 'string' && img.district) return img.district;
  if (typeof img.aiDistrict === 'string' && img.aiDistrict) return img.aiDistrict;
  return null;
}

function getImageYear(img) {
  if (typeof img.year === 'number') return img.year;
  if (typeof img.photoYear === 'number') return img.photoYear;
  const ts = img.uploadedAt;
  if (ts && typeof ts.toDate === 'function') return ts.toDate().getFullYear();
  if (ts && typeof ts.seconds === 'number') {
    return new Date(ts.seconds * 1000).getFullYear();
  }
  return null;
}

function getImageAspectRatio(img) {
  if (typeof img.aspectRatio === 'number' && img.aspectRatio > 0) return img.aspectRatio;
  return 1;
}

function findImageById(imageId) {
  return allImages.find((img) => img.id === imageId) ?? null;
}

function formatDistrictLabel(img) {
  const id = getImageDistrict(img);
  if (!id) return 'Ukendt';
  return FILTER_DISTRICTS.find((d) => d.id === id)?.label ?? id;
}

function formatColorsLabel(img) {
  const ids = Array.isArray(img.aiColors) ? img.aiColors : [];
  if (!ids.length) return '—';
  return ids.map((id) => FILTER_COLORS.find((c) => c.id === id)?.label ?? id).join(', ');
}

function populateImageDetailPanel(img) {
  if (imageDetailDistrictEl) imageDetailDistrictEl.textContent = formatDistrictLabel(img);
  if (imageDetailYearEl) {
    const year = getImageYear(img);
    imageDetailYearEl.textContent = year != null ? String(year) : 'Ukendt';
  }
  if (imageDetailColorsEl) imageDetailColorsEl.textContent = formatColorsLabel(img);
  if (imageDetailCaptionEl) {
    imageDetailCaptionEl.textContent =
      (typeof img.aiCaption === 'string' && img.aiCaption.trim())
        ? img.aiCaption.trim()
        : 'Ingen beskrivelse endnu.';
  }
}

function clearImageDetailFocus() {
  if (imageDetailCard) {
    imageDetailCard.classList.remove('img-card--detail');
    imageDetailCard = null;
  }
  wrap.classList.remove('is-detail-zoom');
}

function killImageDetailTween() {
  if (!imageDetailTween) return;
  imageDetailTween.eventCallback('onComplete', null);
  imageDetailTween.kill();
  imageDetailTween = null;
}

function snapDetailClosed() {
  if (!imageDetailOpen && !imageDetailClosing) return;
  killImageDetailTween();
  offsetX = savedGalleryView.offsetX;
  offsetY = savedGalleryView.offsetY;
  canvasScale = savedGalleryView.scale;
  updateCanvasTransform();
  finalizeImageDetailClosed();
}

function finalizeImageDetailClosed() {
  if (!imageDetailOpen && !imageDetailClosing) return;

  imageDetailClosing = false;
  killImageDetailTween();

  offsetX = savedGalleryView.offsetX;
  offsetY = savedGalleryView.offsetY;
  canvasScale = savedGalleryView.scale;
  updateCanvasTransform();
  clearImageDetailFocus();

  const g = window.gsap;
  if (imageDetailPanel) {
    if (g) {
      g.killTweensOf(imageDetailPanel);
      g.set(imageDetailPanel, { clearProps: 'all' });
    } else {
      imageDetailPanel.removeAttribute('style');
    }
  }

  imageDetail.classList.remove('is-open');
  imageDetail.setAttribute('aria-hidden', 'true');
  imageDetail.hidden = true;
  if (imageDetailCloseBtn) imageDetailCloseBtn.hidden = true;
  imageDetailOpen = false;
  queueRender();
}

function openImageDetail(img, sourceCard) {
  if (!imageDetail || !sourceCard) return;

  if (imageDetailOpen || imageDetailClosing) snapDetailClosed();

  closeMenuIfOpen();
  closeFilterPanel();
  closeSearchPanel();

  savedGalleryView = { offsetX, offsetY, scale: canvasScale };
  imageDetailCard = sourceCard;
  const target = computeDetailView(sourceCard);
  imageDetailPanelW = target.panelW;
  sourceCard.classList.add('img-card--detail');
  populateImageDetailPanel(img);

  imageDetail.hidden = false;
  imageDetail.classList.add('is-open');
  imageDetail.setAttribute('aria-hidden', 'false');
  if (imageDetailCloseBtn) imageDetailCloseBtn.hidden = false;
  imageDetailOpen = true;
  imageDetailClosing = false;
  wrap.classList.add('is-detail-zoom');

  const g = window.gsap;
  if (!g) {
    offsetX = target.offsetX;
    offsetY = target.offsetY;
    canvasScale = target.scale;
    updateCanvasTransform();
    syncDetailPanel(sourceCard, imageDetailPanelW, 1);
    return;
  }

  killImageDetailTween();
  if (imageDetailPanel) g.killTweensOf(imageDetailPanel);

  const view = { x: offsetX, y: offsetY, scale: canvasScale };
  const reveal = { t: 0 };
  if (imageDetailPanel) {
    const startRect = getCardScreenRect(sourceCard);
    syncDetailPanel(sourceCard, imageDetailPanelW, 0);
    g.set(imageDetailPanel, {
      x: 0,
      opacity: 0,
      clipPath: `inset(0 0 0 ${startRect.width}px)`,
    });
  }

  imageDetailTween = g.timeline({
    onUpdate() {
      offsetX = view.x;
      offsetY = view.y;
      canvasScale = view.scale;
      updateCanvasTransform();
      if (imageDetailCard) syncDetailPanel(imageDetailCard, imageDetailPanelW, reveal.t);
    },
    onComplete() {
      imageDetailTween = null;
    },
  });

  imageDetailTween.to(view, {
    x: target.offsetX,
    y: target.offsetY,
    scale: target.scale,
    duration: DETAIL_OPEN_DURATION,
    ease: DETAIL_EASE,
  }, 0);

  imageDetailTween.to(reveal, {
    t: 1,
    duration: 0.55,
    ease: DETAIL_PANEL_EASE,
  }, '-=0.3');
}

function closeImageDetail(animate = true) {
  if (!imageDetailOpen || !imageDetail || imageDetailClosing) return;

  const g = window.gsap;
  if (!g || !animate) {
    snapDetailClosed();
    return;
  }

  killImageDetailTween();
  if (imageDetailPanel) g.killTweensOf(imageDetailPanel);

  const card = imageDetailCard;
  const view = { x: offsetX, y: offsetY, scale: canvasScale };
  const startReveal = imageDetailPanel
    ? Math.min(1, Math.max(0, Number(g.getProperty(imageDetailPanel, 'opacity')) || 0))
    : 1;

  imageDetailClosing = true;
  const reveal = { t: startReveal };

  imageDetailTween = g.timeline({
    onUpdate() {
      offsetX = view.x;
      offsetY = view.y;
      canvasScale = view.scale;
      updateCanvasTransform();
      if (card) syncDetailPanel(card, imageDetailPanelW, reveal.t);
    },
    onComplete: finalizeImageDetailClosed,
  });

  imageDetailTween.to(reveal, {
    t: 0,
    duration: DETAIL_CLOSE_DURATION * 0.5,
    ease: DETAIL_PANEL_EASE,
  }, 0);

  imageDetailTween.to(view, {
    x: savedGalleryView.offsetX,
    y: savedGalleryView.offsetY,
    scale: savedGalleryView.scale,
    duration: DETAIL_CLOSE_DURATION,
    ease: DETAIL_EASE,
  }, 0);
}

function imageHasColor(img, colorId) {
  const colors = Array.isArray(img.aiColors) ? img.aiColors : [];
  if (colors.includes(colorId)) return true;
  const keywords = COLOR_FILTER_KEYWORDS[colorId];
  if (!keywords?.length) return false;
  const tokens = getSearchTokens(img);
  return keywords.some((word) => tokens.has(normalizeSearchText(word)));
}

function isYearFilterActive() {
  if (filterYearFrom == null || filterYearTo == null) return false;
  return filterYearFrom > catalogYearMin || filterYearTo < catalogYearMax;
}

function applyFilters(images) {
  let pool = images;

  if (filterDistricts.size > 0) {
    pool = pool.filter((img) =>
      [...filterDistricts].some((districtId) => imageMatchesDistrict(img, districtId))
    );
  }

  if (filterColors.size > 0) {
    pool = pool.filter((img) =>
      [...filterColors].some((colorId) => imageHasColor(img, colorId))
    );
  }

  if (isYearFilterActive()) {
    const from = filterYearFrom ?? catalogYearMin;
    const to = filterYearTo ?? catalogYearMax;
    pool = pool.filter((img) => {
      const year = getImageYear(img);
      return year != null && year >= from && year <= to;
    });
  }

  return pool;
}

function applySearch(images) {
  const q = searchQuery.trim();
  if (!q) return images;
  const terms = q.split(/\s+/).filter(Boolean);
  // Match if ANY word matches (more forgiving when metadata is sparse).
  return images.filter((img) => terms.some((term) => imageMatchesSearchTerm(img, term)));
}

function getImagePool() {
  if (!allImages.length) return allImages;
  return applySearch(applyFilters(allImages));
}

function countActiveFilters() {
  let n = filterDistricts.size + filterColors.size;
  if (isYearFilterActive()) n += 1;
  return n;
}

function updateCatalogYearBounds() {
  const years = allImages.map(getImageYear).filter((y) => typeof y === 'number');
  const currentYear = new Date().getFullYear();
  catalogYearMin = years.length ? Math.min(...years) : currentYear;
  catalogYearMax = years.length ? Math.max(...years) : currentYear;
}

function updateFilterYearInputs() {
  const fromEl = document.getElementById('filter-year-from');
  const toEl = document.getElementById('filter-year-to');
  if (!fromEl || !toEl) return;
  fromEl.min = String(catalogYearMin);
  fromEl.max = String(catalogYearMax);
  toEl.min = String(catalogYearMin);
  toEl.max = String(catalogYearMax);
  if (filterYearFrom == null) filterYearFrom = catalogYearMin;
  if (filterYearTo == null) filterYearTo = catalogYearMax;
  fromEl.value = String(filterYearFrom);
  toEl.value = String(filterYearTo);
}

function updateFilterHint() {
  /* filter-hint removed — no image count in filter panel */
}

function updateSearchHint() {
  const hint = document.getElementById('search-hint');
  if (!hint) return;
  const q = searchQuery.trim();
  const enriched = countEnrichedImages();
  if (!q) {
    hint.textContent = '';
    hint.hidden = true;
    return;
  }
  const n = getImagePool().length;
  if (n === 0) {
    hint.textContent = enriched < allImages.length
      ? 'Ingen match. Billeder uden AI-beskrivelse kan kun søges på filnavn — vent eller upload nye.'
      : 'Ingen billeder matcher.';
    hint.hidden = false;
    return;
  }
  hint.textContent = '';
  hint.hidden = true;
}

function updateCanvasEmptyState() {
  const emptyEl = document.getElementById('canvas-empty');
  if (!emptyEl) return;
  const pool = getImagePool();
  const hasFilters = countActiveFilters() > 0 || searchQuery.trim().length > 0;
  if (allImages.length > 0 && pool.length === 0 && hasFilters) {
    emptyEl.hidden = false;
    emptyEl.textContent = 'Ingen billeder matcher dine filtre eller søgning.';
  } else {
    emptyEl.hidden = true;
    emptyEl.textContent = '';
  }
}

function refreshGalleryFilters() {
  updateFilterHint();
  updateSearchHint();
  updateCanvasEmptyState();
  queueRender();
}

function isDarkFilterColor(hex) {
  if (!hex) return false;
  const n = hex.replace('#', '');
  if (n.length !== 6) return false;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.55;
}

function buildFilterBoxOption(inputId, value, label, groupName, checked, hex = null) {
  const labelEl = document.createElement('label');
  labelEl.className = 'filter-box-option';
  labelEl.htmlFor = inputId;
  const dark = hex ? isDarkFilterColor(hex) : false;
  const boxClass = hex
    ? `filter-box filter-box--color${dark ? ' filter-box--dark' : ''}`
    : 'filter-box filter-box--district';
  const boxStyle = hex ? `background-color:${hex}` : '';
  labelEl.innerHTML = `
    <input type="checkbox" id="${inputId}" name="${groupName}" value="${value}" ${checked ? 'checked' : ''} />
    <span class="${boxClass}"${boxStyle ? ` style="${boxStyle}"` : ''}>
      <span class="filter-box-mark" aria-hidden="true">
        <svg viewBox="0 0 22 22" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="0" x2="22" y2="22" />
          <line x1="22" y1="0" x2="0" y2="22" />
        </svg>
      </span>
    </span>
    <span class="filter-box-label">${label}</span>
  `;
  return labelEl;
}

function initFilterPanel() {
  if (filtersInitialized) return;
  const districtsEl = document.getElementById('filter-districts');
  const colorsEl = document.getElementById('filter-colors');
  if (!districtsEl || !colorsEl) return;

  FILTER_DISTRICTS.forEach(({ id, label }) => {
    const checkboxId = `filter-district-${id}`;
    const row = buildFilterBoxOption(checkboxId, id, label, 'district', false);
    const input = row.querySelector('input');
    input.addEventListener('change', () => {
      if (input.checked) filterDistricts.add(id);
      else filterDistricts.delete(id);
      refreshGalleryFilters();
    });
    districtsEl.appendChild(row);
  });

  FILTER_COLORS.forEach(({ id, label, hex }) => {
    const checkboxId = `filter-color-${id}`;
    const row = buildFilterBoxOption(checkboxId, id, label, 'color', false, hex);
    const input = row.querySelector('input');
    input.addEventListener('change', () => {
      if (input.checked) filterColors.add(id);
      else filterColors.delete(id);
      refreshGalleryFilters();
    });
    colorsEl.appendChild(row);
  });

  const yearFromEl = document.getElementById('filter-year-from');
  const yearToEl = document.getElementById('filter-year-to');
  const onYearChange = () => {
    const from = parseInt(yearFromEl?.value ?? '', 10);
    const to = parseInt(yearToEl?.value ?? '', 10);
    if (Number.isFinite(from)) filterYearFrom = from;
    if (Number.isFinite(to)) filterYearTo = to;
    if (filterYearFrom != null && filterYearTo != null && filterYearFrom > filterYearTo) {
      filterYearTo = filterYearFrom;
      if (yearToEl) yearToEl.value = String(filterYearTo);
    }
    refreshGalleryFilters();
  };
  yearFromEl?.addEventListener('change', onYearChange);
  yearToEl?.addEventListener('change', onYearChange);
  yearFromEl?.addEventListener('input', onYearChange);
  yearToEl?.addEventListener('input', onYearChange);

  filtersInitialized = true;
}

// ── Get a deterministic image for a grid cell ─
function getImageFor(col, row, pool = getImagePool()) {
  if (!pool.length) return null;
  const seed = Math.abs((col * 73856093) ^ (row * 19349663)) % pool.length;
  return pool[seed];
}

function getPoolSignature(pool = getImagePool()) {
  if (!pool.length) return '';
  return pool.map((img) => img.id).sort().join('|');
}

function shuffleRevealDelays(keys) {
  const list = [...keys];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const span = Math.min(
    REVEAL_SPAN_MAX,
    REVEAL_SPAN_BASE + list.length * REVEAL_SPAN_PER_CARD
  );
  const next = new Map();
  list.forEach((key, order) => {
    const slot = list.length <= 1 ? 0 : (order / (list.length - 1)) * span;
    next.set(key, slot + Math.random() * REVEAL_JITTER_MAX);
  });
  revealDelays = next;
}

function getRevealDelay(key) {
  if (revealDelays.has(key)) return revealDelays.get(key);
  return Math.random() * REVEAL_SPAN_MAX;
}

function getRandomOutDelay() {
  return Math.random() * 0.22;
}

function resetCardMotion(card) {
  const g = window.gsap;
  if (g) g.set(card, { clearProps: 'transform' });
  card.style.transform = '';
}

function animateCardIn(card, revealDelay = 0) {
  const g = window.gsap;
  if (!g) return;
  resetCardMotion(card);
  g.killTweensOf(card);
  g.fromTo(
    card,
    { opacity: 0 },
    {
      opacity: 1,
      duration: REVEAL_FADE_DURATION,
      ease: 'power2.out',
      delay: revealDelay,
      overwrite: true,
    }
  );
}

function animateCardOut(card, onComplete, revealDelay = 0) {
  const g = window.gsap;
  if (!g) {
    onComplete();
    return;
  }
  g.killTweensOf(card);
  g.to(card, {
    opacity: 0,
    duration: 0.16,
    ease: 'power2.in',
    delay: revealDelay,
    overwrite: true,
    onComplete: () => {
      resetCardMotion(card);
      onComplete();
    },
  });
}

function animateCardSwap(card, img, revealDelay = 0) {
  const g = window.gsap;
  const imgEl = card.querySelector('img');
  if (!imgEl) return;

  card.dataset.imageId = img.id;
  if (!g) {
    imgEl.src = img.url;
    imgEl.alt = img.aiCaption || img.name || '';
    return;
  }

  g.killTweensOf(card);
  g.to(card, {
    opacity: 0,
    duration: 0.12,
    ease: 'power2.in',
    delay: revealDelay * 0.25,
    overwrite: true,
    onComplete: () => {
      imgEl.src = img.url;
      imgEl.alt = (typeof img.aiCaption === 'string' && img.aiCaption) ? img.aiCaption : (img.name || '');
      resetCardMotion(card);
      g.to(card, {
        opacity: 1,
        duration: REVEAL_FADE_DURATION,
        ease: 'power2.out',
        delay: revealDelay * 0.35,
        overwrite: true,
      });
    },
  });
}

function upsertCard(key, col, top, height, img, { isPoolChange, revealDelay }) {
  const left = GRID_X_OFFSET + (col * STEP);
  let card = cards.get(key);

  if (!card) {
    card = document.createElement('div');
    card.className = 'img-card';
    card.dataset.key = key;
    card.dataset.imageId = img.id;
    card.style.left = left + 'px';
    card.style.width = CELL + 'px';
    card.style.top = top + 'px';
    card.style.height = height + 'px';

    const el = document.createElement('img');
    el.src = img.url;
    el.alt = (typeof img.aiCaption === 'string' && img.aiCaption) ? img.aiCaption : (img.name || '');
    el.draggable = false;
    el.loading = 'lazy';
    el.decoding = 'async';
    card.appendChild(el);
    canvas.appendChild(card);
    cards.set(key, card);

    if (isPoolChange) {
      card.style.opacity = '0';
      animateCardIn(card, revealDelay);
    }
    return card;
  }

  const imgEl = card.querySelector('img');
  const imageChanged = card.dataset.imageId !== img.id;

  card.style.left = left + 'px';
  card.style.top = top + 'px';
  card.style.height = height + 'px';
  if (!isPoolChange) resetCardMotion(card);

  if (imageChanged) {
    if (isPoolChange) {
      animateCardSwap(card, img, revealDelay);
    } else if (imgEl) {
      imgEl.src = img.url;
      card.dataset.imageId = img.id;
    }
  }

  if (imgEl) {
    imgEl.alt = (typeof img.aiCaption === 'string' && img.aiCaption) ? img.aiCaption : (img.name || '');
  }

  return card;
}

// ── Render visible cells ─────────────────────
function render() {
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  const pool = getImagePool();
  const nextSignature = getPoolSignature(pool);
  const isPoolChange = committedPoolSignature !== nextSignature;
  committedPoolSignature = nextSignature;
  const animGen = isPoolChange ? ++gridAnimGeneration : gridAnimGeneration;

  const startCol = Math.floor((-offsetX - GRID_X_OFFSET) / STEP) - PRELOAD_CELLS;
  const endCol = startCol + Math.ceil(W / STEP) + (PRELOAD_CELLS * 2);
  const minY = -offsetY - (STEP * 2);
  const maxY = -offsetY + H + (STEP * 2);
  const needed = new Set();
  const visibleCells = [];

  for (let col = startCol; col <= endCol; col++) {
    const visibleRows = [];

    // Render downward from the origin row.
    let row = 0;
    let yTop = 0;
    let safety = 0;
    while (yTop <= maxY && safety < 600) {
      const img = getImageFor(col, row, pool);
      if (!img) break;
      const height = getCardHeight(img);
      const yBottom = yTop + height;

      if (yBottom >= minY) {
        visibleRows.push({ row, top: yTop, height, img });
      }

      yTop = yBottom + GAP;
      row += 1;
      safety += 1;
    }

    // Render upward above the origin row.
    row = -1;
    let yBottom = -GAP;
    safety = 0;
    while (yBottom >= minY && safety < 600) {
      const img = getImageFor(col, row, pool);
      if (!img) break;
      const height = getCardHeight(img);
      const top = yBottom - height;

      if (top <= maxY) {
        visibleRows.push({ row, top, height, img });
      }

      yBottom = top - GAP;
      row -= 1;
      safety += 1;
    }

    visibleRows.forEach(({ row: visibleRow, top, height, img }) => {
      const key = `${col},${visibleRow}`;
      needed.add(key);
      visibleCells.push({ key, col, top, height, img });
    });
  }

  if (isPoolChange) shuffleRevealDelays(needed);

  visibleCells.forEach(({ key, col, top, height, img }) => {
    const revealDelay = isPoolChange ? getRevealDelay(key) : 0;
    upsertCard(key, col, top, height, img, { isPoolChange, revealDelay });
  });

  if (introNudgePending && isPoolChange) {
    scheduleIntroNudgeAfterReveal();
  }

  updateCanvasTransform();

  cards.forEach((el, key) => {
    if (needed.has(key)) return;
    if (isPoolChange) {
      animateCardOut(el, () => {
        if (animGen !== gridAnimGeneration) return;
        el.remove();
        cards.delete(key);
      }, getRandomOutDelay());
    } else {
      el.remove();
      cards.delete(key);
    }
  });
}

// ── Drag interactions ─────────────────────────
wrap.addEventListener('mousedown', e => {
  if (!isGalleryNavigationTarget(e.target)) return;
  if (requestCloseImageDetail()) return;
  const onCard = e.target instanceof Element && !!e.target.closest('.img-card');
  if (!onCard) dismissOverlaysForGalleryPan();
  startDrag(e.clientX, e.clientY);
  wrap.classList.add('dragging');
});

wrap.addEventListener('click', (e) => {
  if (suppressDetailClick) {
    suppressDetailClick = false;
    return;
  }
  if (imageDetailOpen || imageDetailClosing) return;
  if (galleryClickAnchor.moved) return;
  const card = e.target instanceof Element ? e.target.closest('.img-card') : null;
  if (!card) return;
  const img = findImageById(card.dataset.imageId);
  if (img) openImageDetail(img, card);
});

window.addEventListener('mousemove', e => {
  moveDrag(e.clientX, e.clientY);
});

window.addEventListener('mouseup', () => {
  endDrag();
  wrap.classList.remove('dragging');
});

// ── Touch drag ───────────────────────────────
wrap.addEventListener('touchstart', e => {
  if (!isGalleryNavigationTarget(e.target)) return;
  const t = e.touches[0];
  if (requestCloseImageDetail()) return;
  const onCard = e.target instanceof Element && !!e.target.closest('.img-card');
  if (!onCard) dismissOverlaysForGalleryPan();
  startDrag(t.clientX, t.clientY);
  wrap.classList.add('dragging');
}, { passive: true });

wrap.addEventListener('touchmove', e => {
  const t = e.touches[0];
  moveDrag(t.clientX, t.clientY);
}, { passive: true });

wrap.addEventListener('touchend', (e) => {
  if (!imageDetailOpen && !imageDetailClosing && !galleryClickAnchor.moved && e.changedTouches[0]) {
    const t = e.changedTouches[0];
    const target = document.elementFromPoint(t.clientX, t.clientY);
    const card = target instanceof Element ? target.closest('.img-card') : null;
    if (card) {
      const img = findImageById(card.dataset.imageId);
      if (img) {
        openImageDetail(img, card);
        endDrag();
        wrap.classList.remove('dragging');
        return;
      }
    }
  }
  endDrag();
  wrap.classList.remove('dragging');
});

window.addEventListener('wheel', e => {
  if (imageDetailOpen || imageDetailClosing) {
    e.preventDefault();
    if (imageDetailOpen) requestCloseImageDetail();
    return;
  }
  if (!isGalleryNavigationTarget(e.target)) return;
  e.preventDefault();
  dismissOverlaysForGalleryPan();
  panFromWheel(e.deltaX, e.deltaY);
}, { passive: false });

// ── Upload + burger menu ──────────────────────
const uploadBtn = document.getElementById('upload-btn');
const uploadPanel = document.getElementById('upload-panel');
const overlay = document.getElementById('overlay');
const closeBtn = document.getElementById('close-btn');
const fileInput = document.getElementById('file-input');
const progressWrap = document.getElementById('progress-bar-wrap');
const progressBar = document.getElementById('progress-bar');
const statusEl = document.getElementById('status');
const searchPanel = document.getElementById('search-panel');
const searchInput = document.getElementById('search-input');
const searchCloseBtn = document.getElementById('search-close');
let searchPanelTween = null;
const SEARCH_OPEN_DURATION = 0.72;
const SEARCH_CLOSE_DURATION = 0.95;
const SEARCH_OPEN_EASE = 'expo.inOut';
const SEARCH_CLOSE_EASE = 'expo.out';
const filterPanel = document.getElementById('filter-panel');
const filterCloseBtn = document.getElementById('filter-close');
let filterPanelTween = null;
const FILTER_OPEN_DURATION = 0.72;
const FILTER_CLOSE_DURATION = 0.95;
const FILTER_OPEN_EASE = 'expo.inOut';
const FILTER_CLOSE_EASE = 'expo.out';

const burgerBtn = document.getElementById('burger-btn');
const sidebar = document.getElementById('sidebar');
const menuOverlay = document.getElementById('menu-overlay');
let menuOpen = true;
let menuTween = null;
const MENU_OPEN_DURATION = 1.1;
const MENU_OPEN_EASE = 'expo.inOut';
const MENU_CLOSE_DURATION = 1.05;
const MENU_CLOSE_EASE = 'expo.out';

function setMenuOpen(nextOpen, animate = true) {
  const g = window.gsap;
  menuOpen = nextOpen;

  if (!g || !animate) {
    g?.set(sidebar, { yPercent: nextOpen ? 0 : -110, clearProps: 'transform' });
    if (!g) {
      sidebar.style.transform = nextOpen ? 'translateY(0%)' : 'translateY(-110%)';
    }
    menuOverlay.style.display = nextOpen ? 'block' : 'none';
    menuOverlay.style.opacity = nextOpen ? '1' : '0';
    return;
  }

  if (menuTween) {
    menuTween.kill();
    menuTween = null;
  }

  if (nextOpen) menuOverlay.style.display = 'block';

  menuTween = g.timeline({
    defaults: { overwrite: true },
    onComplete() {
      menuTween = null;
      if (!menuOpen) menuOverlay.style.display = 'none';
    },
  });

  const duration = nextOpen ? MENU_OPEN_DURATION : MENU_CLOSE_DURATION;
  const ease = nextOpen ? MENU_OPEN_EASE : MENU_CLOSE_EASE;

  menuTween.to(sidebar, {
    yPercent: nextOpen ? 0 : -110,
    duration,
    ease,
  }, 0);
  menuTween.to(menuOverlay, {
    opacity: nextOpen ? 1 : 0,
    duration,
    ease,
  }, 0);
}

function initMenuOpen() {
  menuOpen = true;
  menuOverlay.style.display = 'block';
  menuOverlay.style.opacity = '1';
  const g = window.gsap;
  if (g) {
    g.set(sidebar, { yPercent: 0 });
  } else {
    sidebar.style.transform = 'translateY(0%)';
  }
}

function openMenu(animate = true) {
  setMenuOpen(true, animate);
}

function closeMenu(animate = true) {
  setMenuOpen(false, animate);
}

function closeMenuIfOpen() {
  if (menuOpen) closeMenu(true);
}

function markUserNavigated() {
  hasUserNavigated = true;
  closeMenuIfOpen();
  closeFilterPanel();
  closeSearchPanel();
  requestCloseImageDetail();
}

function isGalleryNavigationTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest(
    '#sidebar, #topbar, #upload-panel, #search-panel.is-open, #filter-panel.is-open, #image-detail.is-open, #overlay'
  )) {
    return false;
  }
  return true;
}

function isTypingInField(target) {
  return target instanceof HTMLElement
    && !!target.closest('input, textarea, select, [contenteditable="true"]');
}

const menuApi = document.getElementById('menu-api');
const menuAbout = document.getElementById('menu-about');
menuApi?.addEventListener('click', () => {
  console.log('API button clicked (not implemented).');
});
menuAbout?.addEventListener('click', () => {
  console.log('OM PROJEKTET button clicked (not implemented).');
});

function rotateLabelText(text, step) {
  const chars = Array.from(text);
  if (chars.length <= 1) return text;
  const n = ((step % chars.length) + chars.length) % chars.length;
  return chars.slice(n).join('') + chars.slice(0, n).join('');
}

const menuLabelStates = new WeakMap();

function getMenuLabelState(button) {
  if (menuLabelStates.has(button)) return menuLabelStates.get(button);
  const labelEl = button.querySelector('.label');
  if (!labelEl) return null;
  const state = {
    labelEl,
    baseText: labelEl.textContent || '',
    hoverInterval: null,
    clickTween: null,
    clickFadeTween: null,
    step: 0,
  };
  menuLabelStates.set(button, state);
  return state;
}

function stopHoverCycle(state) {
  if (!state?.hoverInterval) return;
  clearInterval(state.hoverInterval);
  state.hoverInterval = null;
  state.step = 0;
  state.labelEl.textContent = state.baseText;
}

function startHoverCycle(state) {
  if (!state || state.hoverInterval) return;
  if (state.clickTween) {
    state.clickTween.kill();
    state.clickTween = null;
  }
  if (state.clickFadeTween) {
    state.clickFadeTween.kill();
    state.clickFadeTween = null;
  }
  state.labelEl.style.opacity = '1';
  state.hoverInterval = setInterval(() => {
    state.step += 1;
    state.labelEl.textContent = rotateLabelText(state.baseText, state.step);
  }, 170);
}

function playClickCycle(state) {
  if (!state) return;
  stopHoverCycle(state);

  const g = window.gsap;
  if (!g) return;

  if (state.clickTween) state.clickTween.kill();
  if (state.clickFadeTween) state.clickFadeTween.kill();

  const chars = Array.from(state.baseText);
  if (chars.length <= 1) return;

  const proxy = { frame: 0 };
  const turns = chars.length * 3;
  state.labelEl.style.opacity = '0.55';

  state.clickTween = g.to(proxy, {
    frame: turns,
    duration: 1.0,
    ease: 'none',
    onUpdate() {
      const step = Math.floor(proxy.frame);
      state.labelEl.textContent = rotateLabelText(state.baseText, step);
    },
    onComplete() {
      state.labelEl.textContent = state.baseText;
      state.clickTween = null;
      state.clickFadeTween = g.to(state.labelEl, {
        opacity: 1,
        duration: 1.1,
        ease: 'power2.out',
        onComplete() {
          state.clickFadeTween = null;
        },
      });
    },
  });
}

document.querySelectorAll('#sidebar .menu-item').forEach(button => {
  const state = getMenuLabelState(button);
  if (!state) return;
  button.addEventListener('mouseenter', () => startHoverCycle(state));
  button.addEventListener('mouseleave', () => stopHoverCycle(state));
  button.addEventListener('click', () => playClickCycle(state));
});

burgerBtn.addEventListener('click', () => {
  if (menuOpen) closeMenu(true);
  else openMenu(true);
});
function getKeyboardPanDelta() {
  let vx = 0;
  let vy = 0;
  if (keysPressed.has('ArrowUp')) vy += 1;
  if (keysPressed.has('ArrowDown')) vy -= 1;
  if (keysPressed.has('ArrowLeft')) vx += 1;
  if (keysPressed.has('ArrowRight')) vx -= 1;
  if (vx === 0 && vy === 0) return { dx: 0, dy: 0 };
  const len = Math.hypot(vx, vy);
  return {
    dx: (vx / len) * KEYBOARD_PAN_STEP,
    dy: (vy / len) * KEYBOARD_PAN_STEP,
  };
}

function applyKeyboardPan() {
  const { dx, dy } = getKeyboardPanDelta();
  if (dx === 0 && dy === 0) return;
  panByWithGsap(dx, dy);
}

function handleArrowKeyDown(e) {
  if (!ARROW_KEYS.has(e.key)) return;
  e.preventDefault();
  requestCloseImageDetail();
  markUserNavigated();
  const wasPressed = keysPressed.has(e.key);
  keysPressed.add(e.key);
  if (!wasPressed || e.repeat) applyKeyboardPan();
}

function handleArrowKeyUp(e) {
  if (!ARROW_KEYS.has(e.key)) return;
  keysPressed.delete(e.key);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeMenu(true);
    closePanel();
    closeSearchPanel();
    closeFilterPanel();
    requestCloseImageDetail();
    return;
  }
  if (isTypingInField(e.target)) return;
  handleArrowKeyDown(e);
});

document.addEventListener('keyup', handleArrowKeyUp);
window.addEventListener('blur', () => keysPressed.clear());

function syncOverlay() {
  const open = uploadPanel.style.display === 'block';
  overlay.style.display = open ? 'block' : 'none';
}

function openPanel() {
  closeSearchPanel();
  closeFilterPanel();
  uploadPanel.style.display = 'block';
  syncOverlay();
}

function closePanel() {
  uploadPanel.style.display = 'none';
  syncOverlay();
  statusEl.textContent = '';
  progressWrap.style.display = 'none';
  progressBar.style.width = '0%';
  fileInput.value = '';
}

function getFilterHiddenX() {
  if (!filterPanel) return -900;
  const menuW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--menu-w')) || 260;
  return -(filterPanel.offsetWidth + menuW + 24);
}

function openFilterPanel() {
  closePanel();
  closeSearchPanel();
  initFilterPanel();
  updateCatalogYearBounds();
  updateFilterYearInputs();
  updateFilterHint();
  if (!filterPanel || filterPanel.classList.contains('is-open')) return;

  filterPanel.classList.add('is-open');
  filterPanel.setAttribute('aria-hidden', 'false');

  const g = window.gsap;
  if (!g) {
    filterPanel.style.transform = 'translateX(0)';
    return;
  }

  if (filterPanelTween) {
    filterPanelTween.kill();
    filterPanelTween = null;
  }

  g.set(filterPanel, { x: getFilterHiddenX() });
  filterPanelTween = g.to(filterPanel, {
    x: 0,
    duration: FILTER_OPEN_DURATION,
    ease: FILTER_OPEN_EASE,
    overwrite: true,
    onComplete() {
      filterPanelTween = null;
    },
  });
}

function closeFilterPanel(animate = true) {
  if (!filterPanel || !filterPanel.classList.contains('is-open')) return;

  const g = window.gsap;
  const hiddenX = getFilterHiddenX();

  if (!g || !animate) {
    if (filterPanelTween) {
      filterPanelTween.kill();
      filterPanelTween = null;
    }
    g?.set(filterPanel, { x: hiddenX, clearProps: 'transform' });
    filterPanel.classList.remove('is-open');
    filterPanel.setAttribute('aria-hidden', 'true');
    return;
  }

  if (filterPanelTween) {
    filterPanelTween.kill();
    filterPanelTween = null;
  }

  filterPanelTween = g.to(filterPanel, {
    x: hiddenX,
    duration: FILTER_CLOSE_DURATION,
    ease: FILTER_CLOSE_EASE,
    overwrite: true,
    onComplete() {
      filterPanelTween = null;
      g.set(filterPanel, { clearProps: 'transform' });
      filterPanel.classList.remove('is-open');
      filterPanel.setAttribute('aria-hidden', 'true');
    },
  });
}

function openSearchPanel() {
  closePanel();
  closeFilterPanel();
  if (!searchPanel || searchPanel.classList.contains('is-open')) return;

  searchPanel.classList.add('is-open');
  searchPanel.setAttribute('aria-hidden', 'false');
  if (searchInput) {
    searchInput.value = searchQuery;
  }
  updateSearchHint();

  const g = window.gsap;
  if (!g) {
    if (searchInput) searchInput.focus();
    return;
  }

  if (searchPanelTween) {
    searchPanelTween.kill();
    searchPanelTween = null;
  }

  g.set(searchPanel, { xPercent: -100 });
  searchPanelTween = g.to(searchPanel, {
    xPercent: 0,
    duration: SEARCH_OPEN_DURATION,
    ease: SEARCH_OPEN_EASE,
    overwrite: true,
    onComplete() {
      searchPanelTween = null;
      searchInput?.focus();
    },
  });
}

function closeSearchPanel(animate = true) {
  if (!searchPanel || !searchPanel.classList.contains('is-open')) return;

  const g = window.gsap;
  if (!g || !animate) {
    if (searchPanelTween) {
      searchPanelTween.kill();
      searchPanelTween = null;
    }
    g?.set(searchPanel, { clearProps: 'transform' });
    searchPanel.classList.remove('is-open');
    searchPanel.setAttribute('aria-hidden', 'true');
    return;
  }

  if (searchPanelTween) {
    searchPanelTween.kill();
    searchPanelTween = null;
  }

  searchPanelTween = g.to(searchPanel, {
    xPercent: -100,
    duration: SEARCH_CLOSE_DURATION,
    ease: SEARCH_CLOSE_EASE,
    overwrite: true,
    onComplete() {
      searchPanelTween = null;
      g.set(searchPanel, { clearProps: 'transform' });
      searchPanel.classList.remove('is-open');
      searchPanel.setAttribute('aria-hidden', 'true');
    },
  });
}

function toggleSearchPanel() {
  if (searchPanel?.classList.contains('is-open')) closeSearchPanel();
  else openSearchPanel();
}

uploadBtn.addEventListener('click', openPanel);
closeBtn.addEventListener('click', closePanel);
document.getElementById('menu-search')?.addEventListener('click', () => toggleSearchPanel());

function toggleFilterPanel() {
  if (filterPanel?.classList.contains('is-open')) closeFilterPanel();
  else openFilterPanel();
}

document.getElementById('menu-filter')?.addEventListener('click', () => toggleFilterPanel());
filterCloseBtn?.addEventListener('click', closeFilterPanel);
searchCloseBtn?.addEventListener('click', closeSearchPanel);
imageDetailCloseBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  requestCloseImageDetail();
});
imageDetail?.addEventListener('mousedown', (e) => {
  if (!imageDetailOpen) return;
  e.stopPropagation();
  requestCloseImageDetail();
});
imageDetailPanel?.addEventListener('mousedown', (e) => {
  if (!imageDetailOpen) return;
  e.stopPropagation();
  requestCloseImageDetail();
});
searchInput?.addEventListener('input', () => {
  searchQuery = searchInput.value;
  refreshGalleryFilters();
});
overlay.addEventListener('click', () => {
  closePanel();
});

fileInput.addEventListener('change', async (e) => {
  const originalFile = e.target.files[0];
  if (!originalFile) return;

  try {
    const gpsMeta = await readGpsFromFile(originalFile);
    const file = await normalizeUploadFile(originalFile);
    const aspectRatio = await readFileAspectRatio(file);

    const storageRef = ref(storage, `images/${Date.now()}_${file.name}`);
    const metadata = {
      contentType: file.type || 'image/jpeg',
    };
    const uploadTask = uploadBytesResumable(storageRef, file, metadata);

    progressWrap.style.display = 'block';
    if (gpsMeta?.latitude != null) {
      statusEl.textContent = gpsMeta.district
        ? `GPS fundet (${gpsMeta.latitude}, ${gpsMeta.longitude}) — uploader…`
        : gpsMeta.outsideCopenhagen
          ? 'GPS uden for København — uploader uden bydel…'
          : `GPS fundet — uploader…`;
    } else {
      statusEl.textContent = 'Ingen GPS i billedet — uploader…';
    }

    uploadTask.on('state_changed',
      snapshot => {
        const pct = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        progressBar.style.width = pct + '%';
      },
      error => {
        statusEl.textContent = 'Upload failed: ' + error.message;
      },
      async () => {
        const url = await getDownloadURL(uploadTask.snapshot.ref);
        const photoYear = file.lastModified
          ? new Date(file.lastModified).getFullYear()
          : new Date().getFullYear();

        /** @type {Record<string, unknown>} */
        const docData = {
          url,
          name: file.name,
          size: file.size,
          aspectRatio,
          photoYear,
          storagePath: storageRef.fullPath,
          uploadedAt: serverTimestamp(),
        };
        if (gpsMeta?.latitude != null && gpsMeta?.longitude != null) {
          docData.latitude = gpsMeta.latitude;
          docData.longitude = gpsMeta.longitude;
          docData.locationSource = 'exif';
          if (gpsMeta.district) docData.district = gpsMeta.district;
        }

        const docRef = await addDoc(collection(db, 'images'), docData);

        const newImage = {
          id: docRef.id,
          url,
          name: file.name,
          aspectRatio,
          photoYear,
          storagePath: storageRef.fullPath,
          aiCaption: null,
          aiKeywords: [],
          aiColors: [],
          ...(gpsMeta?.latitude != null
            ? {
                latitude: gpsMeta.latitude,
                longitude: gpsMeta.longitude,
                locationSource: 'exif',
                district: gpsMeta.district ?? null,
              }
            : {}),
        };
        allImages.push(newImage);

        const unsub = onSnapshot(docRef, (snap) => {
          if (!snap.exists()) return;
          const d = snap.data();
          if (typeof d.aiCaption === 'string') newImage.aiCaption = d.aiCaption;
          if (Array.isArray(d.aiKeywords)) newImage.aiKeywords = d.aiKeywords;
          if (typeof d.aiSearchText === 'string') newImage.aiSearchText = d.aiSearchText;
          if (typeof d.aiDistrict === 'string') newImage.aiDistrict = d.aiDistrict;
          if (typeof d.district === 'string') newImage.district = d.district;
          if (typeof d.latitude === 'number') newImage.latitude = d.latitude;
          if (typeof d.longitude === 'number') newImage.longitude = d.longitude;
          if (typeof d.locationSource === 'string') newImage.locationSource = d.locationSource;
          if (Array.isArray(d.aiColors)) newImage.aiColors = d.aiColors;
          if (typeof d.year === 'number') newImage.year = d.year;
          if (d.aiEnrichedAt != null || d.aiEnrichmentFailed === true) {
            updateCatalogYearBounds();
            updateFilterYearInputs();
            unsub();
          }
          refreshGalleryFilters();
        });

        statusEl.textContent = 'Upload complete!';
        updateCatalogYearBounds();
        updateFilterYearInputs();
        refreshGalleryFilters();
        setTimeout(closePanel, 1200);
      }
    );
  } catch (error) {
    statusEl.textContent = 'Upload failed: ' + error.message;
  }
});

window.addEventListener('resize', () => {
  queueRender();
  if (imageDetailOpen && imageDetailCard && !imageDetailClosing) {
    const target = computeDetailView(imageDetailCard);
    imageDetailPanelW = target.panelW;
    offsetX = target.offsetX;
    offsetY = target.offsetY;
    canvasScale = target.scale;
    updateCanvasTransform();
    syncDetailPanel(imageDetailCard, imageDetailPanelW, 1);
  }
});
initMenuOpen();
loadImages();

