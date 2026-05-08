import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAnalytics, isSupported as analyticsIsSupported } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";
import { getFirestore, collection, addDoc, getDocs, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

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
analyticsIsSupported()
  .then(supported => {
    if (supported) getAnalytics(app);
  })
  .catch(() => {});

let allImages = [];
let offsetX = 0, offsetY = 0;
let dragging = false, startX, startY;
let velocityX = 0, velocityY = 0;
let lastPointerX = 0, lastPointerY = 0, lastPointerTime = 0;
let inertiaTween = null;
let introTween = null;
let keyPanTween = null;
let hasUserNavigated = false;
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
wrap.setAttribute('tabindex', '0');

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

function panBy(dx, dy) {
  stopIntroNudge();
  stopInertia();
  offsetX += dx;
  offsetY += dy;
  updateCanvasTransform();
  queueRender();
}

function panByWithGsap(dx, dy) {
  stopIntroNudge();
  stopInertia();
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
    ease: MOMENTUM_EASE,
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

const MOMENTUM_EASE = 'power2.out';
const MOMENTUM_MULTIPLIER_MS = 900; // velocity is px/ms → distance = v * multiplier
const MOMENTUM_DURATION_MIN = 0.25;
const MOMENTUM_DURATION_MAX = 1.1;
const KEYBOARD_PAN_STEP = 110;
const KEYBOARD_PAN_DURATION = 0.22;

function stopInertia() {
  if (!inertiaTween) return;
  inertiaTween.kill();
  inertiaTween = null;
}

function stopIntroNudge() {
  if (!introTween) return;
  introTween.kill();
  introTween = null;
}

function startIntroNudge() {
  stopIntroNudge();
  const g = window.gsap;
  if (!g) return;

  const state = { x: offsetX, y: offsetY };
  introTween = g.to(state, {
    x: offsetX - 150,
    y: offsetY - 110,
    duration: 1.0,
    delay: 0.35,
    ease: 'power2.out',
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
  stopIntroNudge();
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
  startIntroNudge();
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
  wrap.focus();
  markUserNavigated();
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
  wrap.focus();
  markUserNavigated();
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

window.addEventListener('wheel', e => {
  const onCanvas = e.target instanceof Element && !!e.target.closest('#canvas-wrap');
  if (!onCanvas) return;
  e.preventDefault();
  markUserNavigated();
  panBy(-e.deltaX, -e.deltaY);
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

const burgerBtn = document.getElementById('burger-btn');
const sidebar = document.getElementById('sidebar');
const menuOverlay = document.getElementById('menu-overlay');
let menuOpen = false;
let menuTween = null;

function setMenuOpen(nextOpen, animate = true) {
  const g = window.gsap;
  menuOpen = nextOpen;

  if (!g || !animate) {
    sidebar.style.transform = nextOpen ? 'translateY(0%)' : 'translateY(-110%)';
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

  menuTween.to(sidebar, {
    yPercent: nextOpen ? 0 : -110,
    duration: 0.34,
    ease: 'power3.out',
  }, 0);
  menuTween.to(menuOverlay, {
    opacity: nextOpen ? 1 : 0,
    duration: 0.24,
    ease: 'power2.out',
  }, 0);
}

function openMenu(animate = true) {
  setMenuOpen(true, animate);
}

function closeMenu(animate = true) {
  setMenuOpen(false, animate);
}

function closeMenuOnNavigate() {
  if (!hasUserNavigated || !menuOpen) return;
  closeMenu(true);
}

function markUserNavigated() {
  hasUserNavigated = true;
  closeMenuOnNavigate();
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
menuOverlay.addEventListener('click', () => closeMenu(true));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMenu(true);
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    markUserNavigated();
    panByWithGsap(0, KEYBOARD_PAN_STEP);
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    markUserNavigated();
    panByWithGsap(0, -KEYBOARD_PAN_STEP);
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    markUserNavigated();
    panByWithGsap(KEYBOARD_PAN_STEP, 0);
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    markUserNavigated();
    panByWithGsap(-KEYBOARD_PAN_STEP, 0);
  }
});

function openPanel() {
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
  const metadata = {
    contentType: file.type || 'image/jpeg',
  };
  const uploadTask = uploadBytesResumable(storageRef, file, metadata);

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
openMenu(false);
loadImages();

