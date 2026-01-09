// Home page script: render course grid and apply theme/background
import { loadCourses } from './data.js';
import { loadSettings } from './storage.js';

function applyBackgroundFromSettings() {
  try {
    const s = loadSettings();
    const layer = document.getElementById('bgLayer');
    if (!layer) return;
    const img = s && s.backgroundImage ? String(s.backgroundImage) : '';
    const op = s && typeof s.backgroundOpacity === 'number' ? s.backgroundOpacity : 0.5;
    if (img) {
      layer.style.backgroundImage = `url('${img}')`;
      layer.style.opacity = String(Math.max(0, Math.min(1, op)));
    } else {
      layer.style.backgroundImage = 'none';
      layer.style.opacity = '0';
    }
  } catch (_) {}
}

function initTheme() {
  try {
    const s = loadSettings();
    document.documentElement.setAttribute('data-theme', s.themeDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-palette', s.palette || 'cozy');
  } catch (_) {}
}

async function renderCourseGrid() {
  const spread = document.getElementById('courseGrid');
  if (!spread) return;
  spread.innerHTML = '';
  try {
    const courses = await loadCourses();
    // Set mid index for fan transform: (N-1)/2
    const mid = (courses.length - 1) / 2;
    spread.style.setProperty('--mid', String(mid));

    courses.forEach((c, idx) => {
      const card = document.createElement('div');
      card.className = 'tarot-card';
      card.setAttribute('tabindex', '0');
      card.style.setProperty('--i', String(idx));

      const h3 = document.createElement('h3');
      h3.textContent = c.course_name || c.id;

      const actions = document.createElement('div');
      actions.className = 'actions';

      const open = document.createElement('a');
      open.className = 'btn';
      open.href = `./courses/${encodeURIComponent(c.id)}/index.html`;
      open.textContent = 'Open';

      const practice = document.createElement('a');
      practice.className = 'btn primary';
      practice.href = `./quiz.html?course=${encodeURIComponent(c.id)}`;
      practice.textContent = 'Practice';

      actions.appendChild(open);
      actions.appendChild(practice);
      card.appendChild(h3);
      card.appendChild(actions);
      spread.appendChild(card);
    });
  } catch (e) {
    const err = document.createElement('div');
    err.textContent = 'Failed to load courses.';
    spread.appendChild(err);
    // Avoid console noise in release; uncomment for debugging
    // console.error(e);
  }
}

function main() {
  initTheme();
  applyBackgroundFromSettings();
  renderCourseGrid();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main, { once: true });
} else {
  main();
}
