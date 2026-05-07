import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyC2sccaYxF0KBAH1ZHRUvjwsl5dWo2IdCw",
  authDomain: "kbh-arkiv.firebaseapp.com",
  projectId: "kbh-arkiv",
  storageBucket: "kbh-arkiv.firebasestorage.app",
  messagingSenderId: "938011502039",
  appId: "1:938011502039:web:86343db1471f9939551792"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

let allImages = [];
let offsetX = 0, offsetY = 0;
let dragging = false, startX, startY;
let velocityX = 0, velocityY = 0;
let lastPointerX = 0, lastPointerY = 0, lastPointerTime = 0;
let inertiaTween = null;
const cards = new Map();
const aspectRatioCache = new Map();
let renderQueued = false;

const CELL = 290;
const GAP = 18;
const STEP = CELL + GAP;
const PRELOAD_CELLS = 1;
const GRID_X_OFFSET = -Math.round(CELL / 2);

const wrap = document.getElementById('canvas-wrap');
const canvas = document.getElementById('canvas');
const loading = document.getElementById('loading');

function updateCanvasTransform() {
  canvas.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

const MOMENTUM_EASE = 'power2.out';
const MOMENTUM_MULTIPLIER_MS = 900; // velocity is px/ms → distance = v * multiplier
const MOMENTUM_DURATION_MIN = 0.25;
const MOMENTUM_DURATION_MAX = 1.1;

function stopInertia() {
  if (!inertiaTween) return;
  inertiaTween.kill();
  inertiaTween = null;
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
    speed * 0.9
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

function startDrag(clientX, clientY) {
  stopInertia();
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

// ── Load images from Firebase ────────────────
async function loadImages() {
  const snapshot = await getDocs(collection(db, 'images'));
  snapshot.forEach(doc => allImages.push(doc.data()));
  loading.style.display = 'none';
  render();
}

// ── Get a deterministic image for a grid cell ─
function getImageFor(col, row) {
  if (!allImages.length) return null;
  const seed = Math.abs((col * 73856093) ^ (row * 19349663)) % allImages.length;
  return allImages[seed];
}

// ── Render visible cells ─────────────────────
function render() {
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;

  const startCol = Math.floor((-offsetX - GRID_X_OFFSET) / STEP) - PRELOAD_CELLS;
  const endCol = startCol + Math.ceil(W / STEP) + (PRELOAD_CELLS * 2);
  const minY = -offsetY - (STEP * 2);
  const maxY = -offsetY + H + (STEP * 2);
  const needed = new Set();

  for (let col = startCol; col <= endCol; col++) {
    const visibleRows = [];

    // Render downward from the origin row.
    let row = 0;
    let yTop = 0;
    let safety = 0;
    while (yTop <= maxY && safety < 600) {
      const img = getImageFor(col, row);
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
      const img = getImageFor(col, row);
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

      if (!cards.has(key)) {
        const card = document.createElement('div');
        card.className = 'img-card';
        card.dataset.key = key;
        card.style.left = (GRID_X_OFFSET + (col * STEP)) + 'px';
        card.style.width = CELL + 'px';

        const el = document.createElement('img');
        el.src = img.url;
        el.alt = img.name || '';
        el.draggable = false;
        el.loading = 'lazy';
        el.decoding = 'async';
        card.appendChild(el);
        canvas.appendChild(card);
        cards.set(key, card);
      }

      const card = cards.get(key);
      card.style.top = top + 'px';
      card.style.height = height + 'px';
    });
  }

  updateCanvasTransform();

  cards.forEach((el, key) => {
    if (needed.has(key)) return;
    el.remove();
    cards.delete(key);
  });
}

// ── Drag interactions ─────────────────────────
wrap.addEventListener('mousedown', e => {
  startDrag(e.clientX, e.clientY);
  wrap.classList.add('dragging');
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
  const t = e.touches[0];
  startDrag(t.clientX, t.clientY);
  wrap.classList.add('dragging');
}, { passive: true });

wrap.addEventListener('touchmove', e => {
  const t = e.touches[0];
  moveDrag(t.clientX, t.clientY);
}, { passive: true });

wrap.addEventListener('touchend', () => {
  endDrag();
  wrap.classList.remove('dragging');
});

// ── Upload + burger menu ──────────────────────
const uploadBtn = document.getElementById('upload-btn');
const uploadPanel = document.getElementById('upload-panel');
const overlay = document.getElementById('overlay');
const closeBtn = document.getElementById('close-btn');
const fileInput = document.getElementById('file-input');
const progressWrap = document.getElementById('progress-bar-wrap');
const progressBar = document.getElementById('progress-bar');
const statusEl = document.getElementById('status');

const burgerBtn = document.getElementById('burger-btn');
const sidebar = document.getElementById('sidebar');
const menuOverlay = document.getElementById('menu-overlay');

function openMenu() {
  sidebar.classList.add('open');
  menuOverlay.classList.add('open');
}

function closeMenu() {
  sidebar.classList.remove('open');
  menuOverlay.classList.remove('open');
}

const menuApi = document.getElementById('menu-api');
const menuAbout = document.getElementById('menu-about');
menuApi?.addEventListener('click', () => {
  closeMenu();
  console.log('API button clicked (not implemented).');
});
menuAbout?.addEventListener('click', () => {
  closeMenu();
  console.log('OM PROJEKTET button clicked (not implemented).');
});

burgerBtn.addEventListener('click', () => {
  if (sidebar.classList.contains('open')) closeMenu();
  else openMenu();
});
menuOverlay.addEventListener('click', closeMenu);
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMenu();
});

function openPanel() {
  closeMenu();
  uploadPanel.style.display = 'block';
  overlay.style.display = 'block';
}

function closePanel() {
  uploadPanel.style.display = 'none';
  overlay.style.display = 'none';
  statusEl.textContent = '';
  progressWrap.style.display = 'none';
  progressBar.style.width = '0%';
  fileInput.value = '';
}

uploadBtn.addEventListener('click', openPanel);
closeBtn.addEventListener('click', closePanel);
overlay.addEventListener('click', closePanel);

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const aspectRatio = await readFileAspectRatio(file);

  const storageRef = ref(storage, `images/${Date.now()}_${file.name}`);
  const uploadTask = uploadBytesResumable(storageRef, file);

  progressWrap.style.display = 'block';
  statusEl.textContent = 'Uploading…';

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
      await addDoc(collection(db, 'images'), {
        url,
        name: file.name,
        size: file.size,
        aspectRatio,
        storagePath: storageRef.fullPath,
        uploadedAt: serverTimestamp(),
      });

      const newImage = { url, name: file.name, aspectRatio, storagePath: storageRef.fullPath };
      allImages.push(newImage);

      statusEl.textContent = 'Upload complete!';
      setTimeout(closePanel, 1200);
    }
  );
});

window.addEventListener('resize', queueRender);
loadImages();

