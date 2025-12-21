// Local persistence for quiz progress (optional)
// Keys:
//  - mq_persist: '1' to enable, '0' to disable
//  - mq_state::<course>::<topic> : JSON serialized engine state

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
