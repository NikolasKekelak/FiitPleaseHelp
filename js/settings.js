import { loadSettings, saveSettings } from './storage.js';

// Reuse background applier (local copy to avoid importing app.js)
function applyBackgroundFromSettings(settings) {
  const layer = document.getElementById('bgLayer');
  if (!layer) return;
  const img = settings && settings.backgroundImage ? String(settings.backgroundImage) : '';
  const op = settings && typeof settings.backgroundOpacity === 'number' ? settings.backgroundOpacity : 0.5;
  if (img) {
    layer.style.backgroundImage = `url('${img}')`;
    layer.style.opacity = String(Math.max(0, Math.min(1, op)));
  } else {
    layer.style.backgroundImage = 'none';
    layer.style.opacity = '0';
  }
}

function byId(id) { return document.getElementById(id); }

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function init() {
  const els = {
    showExplanation: byId('setShowExplanation'),
    keepResponses: byId('setKeepResponses'),
    hardcore: byId('setHardcore'),
    darkMode: byId('setDarkMode'),
    palette: byId('setPalette'),
    bgFile: byId('bgFile'),
    bgUrl: byId('bgUrl'),
    bgOpacity: byId('bgOpacity'),
    bgOpacityVal: byId('bgOpacityVal'),
    saveBtn: byId('saveBtn'),
    clearBgBtn: byId('clearBgBtn'),
  };

  let settings = loadSettings();
  // Populate controls
  if (els.showExplanation) els.showExplanation.checked = !!settings.showExplanation;
  if (els.keepResponses) els.keepResponses.checked = !!settings.keepResponses;
  if (els.hardcore) els.hardcore.checked = !!settings.hardcoreMode;
  if (els.darkMode) els.darkMode.checked = !!settings.themeDark;
  if (els.palette) els.palette.value = settings.palette || 'cozy';

  // Apply theme & palette immediately
  document.documentElement.setAttribute('data-theme', settings.themeDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-palette', settings.palette || 'cozy');

  const opPct = Math.round(((typeof settings.backgroundOpacity === 'number' ? settings.backgroundOpacity : 0.5) || 0) * 100);
  if (els.bgOpacity) els.bgOpacity.value = String(opPct);
  if (els.bgOpacityVal) els.bgOpacityVal.textContent = `${opPct}%`;
  if (els.bgUrl) {
    // If stored image looks like URL (not data URL), show it
    const img = settings.backgroundImage || '';
    if (img && typeof img === 'string' && !img.startsWith('data:')) els.bgUrl.value = img;
  }

  // Apply background immediately
  applyBackgroundFromSettings(settings);

  // Live update of opacity label
  els.bgOpacity && els.bgOpacity.addEventListener('input', () => {
    const v = Number(els.bgOpacity.value || '50');
    if (els.bgOpacityVal) els.bgOpacityVal.textContent = `${v}%`;
  });

  // Clear background
  els.clearBgBtn && els.clearBgBtn.addEventListener('click', (e) => {
    e.preventDefault();
    settings.backgroundImage = '';
    settings.backgroundOpacity = 0.5;
    saveSettings(settings);
    // Reset inputs
    if (els.bgFile) els.bgFile.value = '';
    if (els.bgUrl) els.bgUrl.value = '';
    if (els.bgOpacity) els.bgOpacity.value = '50';
    if (els.bgOpacityVal) els.bgOpacityVal.textContent = '50%';
    applyBackgroundFromSettings(settings);
  });

  // Save
  els.saveBtn && els.saveBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    let img = settings.backgroundImage || '';
    // If a new file is chosen, take precedence
    const file = els.bgFile && els.bgFile.files && els.bgFile.files[0];
    if (file) {
      try {
        img = await fileToDataUrl(file);
      } catch (_) {}
    } else if (els.bgUrl && els.bgUrl.value.trim()) {
      img = els.bgUrl.value.trim();
    }
    const opacity = Math.max(0, Math.min(100, Number(els.bgOpacity ? els.bgOpacity.value : 50))) / 100;

    const next = {
      ...settings,
      showExplanation: !!(els.showExplanation && els.showExplanation.checked),
      keepResponses: !!(els.keepResponses && els.keepResponses.checked),
      hardcoreMode: !!(els.hardcore && els.hardcore.checked),
      themeDark: !!(els.darkMode && els.darkMode.checked),
      palette: (els.palette && els.palette.value) || 'cozy',
      backgroundImage: img,
      backgroundOpacity: opacity,
    };
    settings = saveSettings(next);
    // Apply visuals now
    document.documentElement.setAttribute('data-theme', settings.themeDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-palette', settings.palette || 'cozy');
    applyBackgroundFromSettings(settings);

    // Small UX feedback
    if (els.saveBtn) {
      const orig = els.saveBtn.textContent;
      els.saveBtn.textContent = 'Saved';
      setTimeout(() => { els.saveBtn.textContent = orig; }, 900);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
