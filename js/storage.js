// Local persistence for quiz progress and user settings (optional)
// Keys:
//  - mq_persist: '1' to enable, '0' to disable
//  - mq_state::<course>::<topic> : JSON serialized engine state
//  - mq_settings: JSON serialized UI/behavior settings

const PERSIST_KEY = 'mq_persist';

export function setPersistenceEnabled(enabled) {
  try { localStorage.setItem(PERSIST_KEY, enabled ? '1' : '0'); } catch (e) {}
}

export function isPersistenceEnabled() {
  try { return localStorage.getItem(PERSIST_KEY) === '1'; } catch (e) { return false; }
}

function stateKey(course, topic) {
  return `mq_state::${course}::${topic}`;
}

export function saveState(course, topic, obj) {
  try {
    localStorage.setItem(stateKey(course, topic), JSON.stringify(obj));
  } catch (e) {
    console.warn('Failed to save state', e);
  }
}

export function loadState(course, topic) {
  try {
    const s = localStorage.getItem(stateKey(course, topic));
    return s ? JSON.parse(s) : null;
  } catch (e) {
    console.warn('Failed to load state', e);
    return null;
  }
}

export function clearState(course, topic) {
  try { localStorage.removeItem(stateKey(course, topic)); } catch (e) {}
}

const SETTINGS_KEY = 'mq_settings';

const DEFAULT_SETTINGS = {
  showExplanation: true,
  keepResponses: true,
  hardcoreMode: false,
  // Background customization
  backgroundImage: '', // data URL or URL string
  backgroundOpacity: 0.5, // 0..1
  // Theme
  themeDark: true,
  palette: 'cozy',
};

export function loadSettings() {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (!s) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(s);
    return { ...DEFAULT_SETTINGS, ...(parsed || {}) };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    return merged;
  } catch (e) {
    // ignore
    return settings;
  }
}

export function getDefaultSettings() {
  return { ...DEFAULT_SETTINGS };
}
