// Course Page Controller (vanilla JS)
// Responsibilities:
// - Handle sidebar navigation and hash routing (#theory/#lectures/#links)
// - Load partial HTML files via fetch and inject into content area
// - Run inline highlight transform for *asterisk* wrapped words/phrases
// - Skip code/pre/script/style and .no-hl regions; support escaping with \*

(function () {
  // Ensure course pages use the same global theme and background as the rest of the site
  (function initThemeAndBackground() {
    const DEFAULTS = {
      backgroundImage: '',
      backgroundOpacity: 0.5,
      themeDark: false,
      palette: 'cozy',
    };
    let settings = DEFAULTS;
    try {
      const raw = localStorage.getItem('mq_settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        settings = { ...DEFAULTS, ...(parsed || {}) };
      }
    } catch (_) {}

    try {
      // Apply theme + palette on <html>
      document.documentElement.setAttribute('data-theme', settings.themeDark ? 'dark' : 'light');
      document.documentElement.setAttribute('data-palette', settings.palette || 'cozy');
    } catch (_) {}

    try {
      // Apply background image/opacity to #bgLayer if present
      const layer = document.getElementById('bgLayer');
      if (layer) {
        const img = settings.backgroundImage ? String(settings.backgroundImage) : '';
        const op = typeof settings.backgroundOpacity === 'number' ? settings.backgroundOpacity : 0.5;
        if (img) {
          layer.style.backgroundImage = `url('${img}')`;
          layer.style.opacity = String(Math.max(0, Math.min(1, op)));
        } else {
          layer.style.backgroundImage = 'none';
          layer.style.opacity = '0';
        }
      }
    } catch (_) {}
  })();

  const CONTENT_ID = 'courseContent';
  const TITLE_ID = 'courseTitle';
  const BREADCRUMB_ID = 'courseBreadcrumb';

  const elContent = document.getElementById(CONTENT_ID);
  const elTitle = document.getElementById(TITLE_ID);
  const elBreadcrumb = document.getElementById(BREADCRUMB_ID);

  if (!elContent) return; // nothing to do

  const COURSE_SLUG = (function () {
    // Expect URL like .../courses/<slug>/index.html
    const parts = location.pathname.replace(/\\+/g, '/').split('/').filter(Boolean);
    const i = parts.lastIndexOf('courses');
    if (i >= 0 && parts.length > i + 1) return decodeURIComponent(parts[i + 1]);
    return '';
  })();

  function setActive(btnId) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const el = document.getElementById(btnId);
    // Clear previous aria-current
    document.querySelectorAll('.nav-btn[aria-current]')
      .forEach(b => b.removeAttribute('aria-current'));
    if (el) {
      el.classList.add('active');
      el.setAttribute('aria-current', 'page');
    }
  }

  function updateTitleAndCrumb(section) {
    const nice = section.charAt(0).toUpperCase() + section.slice(1);
    if (elTitle) elTitle.textContent = nice;
    if (elBreadcrumb) {
      elBreadcrumb.innerHTML = '';
      const aHome = document.createElement('a');
      aHome.href = '../../';
      aHome.textContent = 'Home';
      const sep = document.createElement('span'); sep.textContent = ' / ';
      const aCourse = document.createElement('a');
      aCourse.href = './#' + section;
      aCourse.textContent = COURSE_SLUG || 'Course';
      elBreadcrumb.appendChild(aHome);
      elBreadcrumb.appendChild(sep.cloneNode(true));
      elBreadcrumb.appendChild(aCourse);
    }
  }

  const partialCache = new Map(); // in-memory cache of loaded partial HTML

  async function loadSection(section) {
    const file = `./${section}.html`;
    updateTitleAndCrumb(section);
    setActive('btn-' + section);
    try {
      elContent.setAttribute('aria-busy', 'true');
      let html;
      if (partialCache.has(file)) {
        html = partialCache.get(file);
      } else {
        const res = await fetch(file, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
        partialCache.set(file, html);
      }
      elContent.innerHTML = html;
      runInlineHighlight(elContent);
    } catch (e) {
      // Preserve existing visible message text from earlier implementation
      elContent.innerHTML = `<div class="error">Section not available. (${escapeHtml(String(e.message || e))})</div>`;
    }
    finally {
      elContent.removeAttribute('aria-busy');
    }
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function isSkippable(node) {
    if (!node || node.nodeType !== 1) return false;
    const tag = node.tagName.toLowerCase();
    if (tag === 'code' || tag === 'pre' || tag === 'script' || tag === 'style') return true;
    if (node.classList && node.classList.contains('no-hl')) return true;
    return false;
  }

  function walk(node, visitor) {
    if (isSkippable(node)) return;
    for (let child = node.firstChild; child;) {
      const next = child.nextSibling; // cache next in case visitor replaces child
      if (child.nodeType === Node.TEXT_NODE) {
        visitor(child);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (!isSkippable(child)) walk(child, visitor);
      }
      child = next;
    }
  }

  // Replace non-escaped *...* with <span class="hl">...</span> within a text node
  function highlightTextNode(textNode) {
    const text = textNode.nodeValue;
    if (!text || text.indexOf('*') === -1) return;

    const segments = []; // array of {type:'text', value} | {type:'hl', value}
    let i = 0;
    let open = false;
    let buf = '';
    let outside = '';

    const flushOutside = () => {
      if (outside) { segments.push({ type: 'text', value: outside }); outside = ''; }
    };
    const flushBufAsHl = () => {
      segments.push({ type: 'hl', value: buf }); buf = ''; open = false;
    };

    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\') {
        if (i + 1 < text.length) {
          const next = text[i + 1];
          if (open) buf += next; else outside += next;
          i += 2; continue;
        } else {
          // trailing backslash, keep literal
          if (open) buf += ch; else outside += ch;
          i++; continue;
        }
      }
      if (ch === '*') {
        if (open) {
          // close
          flushOutside();
          flushBufAsHl();
        } else {
          // open
          open = true; buf = '';
        }
        i++; continue;
      }
      if (open) buf += ch; else outside += ch;
      i++;
    }
    if (open) {
      // unclosed, treat as literal
      outside += '*' + buf;
      buf = ''; open = false;
    }
    flushOutside();

    // Build DOM fragment safely
    const frag = document.createDocumentFragment();
    segments.forEach(seg => {
      if (seg.type === 'text') {
        frag.appendChild(document.createTextNode(seg.value));
      } else {
        const span = document.createElement('span');
        span.className = 'hl';
        span.textContent = seg.value;
        frag.appendChild(span);
      }
    });

    const parent = textNode.parentNode;
    if (!parent) return;
    parent.replaceChild(frag, textNode);
  }

  function runInlineHighlight(root) {
    walk(root, highlightTextNode);
  }

  function onNavClick(e) {
    const btn = e.currentTarget;
    const section = btn && btn.dataset && btn.dataset.section;
    if (!section) return;
    if (location.hash !== '#' + section) history.replaceState(null, '', '#' + section);
    loadSection(section);
  }

  function getSectionFromHash() {
    const h = (location.hash || '').replace(/^#/, '');
    if (h === 'lectures' || h === 'links' || h === 'theory' || h === 'demos') return h;
    return 'theory';
  }

  // Wire sidebar buttons
  ['theory', 'lectures', 'links', 'demos'].forEach(sec => {
    const id = 'btn-' + sec;
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', onNavClick);
  });

  // Practice button should link to quiz filtered by course
  const practice = document.getElementById('btn-practice');
  if (practice && COURSE_SLUG) {
    practice.setAttribute('href', `../../quiz/?course=${encodeURIComponent(COURSE_SLUG)}`);
  }

  window.addEventListener('hashchange', () => {
    loadSection(getSectionFromHash());
  });

  // Initial load
  loadSection(getSectionFromHash());

  // Mobile drawer toggle (no visible text; button with aria-label)
  try {
    const drawerBtn = document.querySelector('.drawer-btn');
    const sidebar = document.querySelector('.course-sidebar');
    if (drawerBtn && sidebar) {
      const setExpanded = (v) => {
        drawerBtn.setAttribute('aria-expanded', v ? 'true' : 'false');
        if (v) document.documentElement.classList.add('drawer-open');
        else document.documentElement.classList.remove('drawer-open');
      };
      setExpanded(false);
      drawerBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const isOpen = document.documentElement.classList.contains('drawer-open');
        setExpanded(!isOpen);
      });
      // Close drawer on navigation to a section
      document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => setExpanded(false));
      });
    }
  } catch(_) {}
})();
