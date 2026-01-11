// Data loading utilities for static hosting (GitHub Pages compatible)
// Courses are declared in /data/courses.json
// Topics are declared in /data/<course>/topics.json

// Resolve root prefix robustly: when running from subfolders like /quiz/ or /courses/...,
// relative fetch('data/...') would point to a non-existent subpath. We compute a prefix
// to reach the site root from the current page location without relying on absolute '/'.
function getRootPrefix() {
  try {
    const p = (location && location.pathname) ? location.pathname : '/';
    // Heuristic: if path ends with '/', count segments to determine depth.
    // We consider known top-level folders: quiz, courses, images, data, js, assets.
    // We only need to handle pages under '/quiz/' (depth 1) in this app.
    if (/\/quiz\//i.test(p)) return '../';
    // Demos under courses go deeper but do not use this module; safe default
    return './';
  } catch (_) {
    return './';
  }
}
const ROOT = getRootPrefix();
// Cache-busting: prevent stale data/*.json on static hosting/CDNs
const __BUST__ = String(Date.now());
function withBust(url) { try { return `${url}${url.includes('?') ? '&' : '?'}v=${__BUST__}`; } catch(_) { return url; } }

export async function loadCourses() {
  const url = withBust(`${ROOT}data/courses.json`);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load courses.json (${res.status})`);
  const data = await res.json();
  // Expected shape: { courses: [{ id, course_name }] }
  return data.courses || [];
}

export async function loadTopics(courseId) {
  if (!courseId) return [];
  const url = withBust(`${ROOT}data/${courseId}/topics.json`);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load topics for ${courseId} (${res.status})`);
  const data = await res.json();
  // Expected shape per spec
  // {
  //   "course": "OS",
  //   "course_name": "Operačné systémy",
  //   "topics": [ { "id": "memory", "file": "topic/memory.json", "topic_name": "..." } ]
  // }
  const topics = (data.topics || []).map(t => ({
    id: t.id,
    file: t.file, // path relative to the course folder
    topic_name: t.topic_name || t.id,
  }));
  return topics;
}

export async function loadPresets(courseId) {
  try {
    const url = withBust(`${ROOT}data/${courseId}/presets.json`);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    // Expected: { presets: [ { id, name, description, topics?: ["id", ...] } ] }
    return data.presets || [];
  } catch (e) {
    return [];
  }
}

export async function loadTopicQuestions(courseId, relativeFilePath) {
  const url = withBust(`${ROOT}data/${courseId}/${relativeFilePath}`);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load topic file ${url} (${res.status})`);
  const data = await res.json();
  // Ensure each question has required fields minimally
  if (!data || !Array.isArray(data.questions)) throw new Error('Invalid topic file structure: missing questions[]');
  // Normalize image paths to be relative from project root if they are relative in file
  data.questions.forEach(q => {
    // Normalize primary question image path
    if (q.image && !/^https?:\/\//.test(q.image)) {
      const p = String(q.image).replace(/\\/g, '/');
      if (/^\/?images\//.test(p)) {
        q.image = p.replace(/^\//, '');
      } else {
        q.image = `images/${courseId}/${p}`;
      }
      // Prefix to root for correct resolution from subfolders like /quiz/
      if (!/^https?:\/\//.test(q.image)) q.image = `${ROOT}${q.image}`;
    }
    // Normalize optional explanation image path
    if (q.explanation_image && !/^https?:\/\//.test(q.explanation_image)) {
      const pe = String(q.explanation_image).replace(/\\/g, '/');
      if (/^\/?images\//.test(pe)) {
        q.explanation_image = pe.replace(/^\//, '');
      } else {
        q.explanation_image = `images/${courseId}/${pe}`;
      }
      if (!/^https?:\/\//.test(q.explanation_image)) q.explanation_image = `${ROOT}${q.explanation_image}`;
    }
  });
  return data;
}

export async function loadQuestionsForTopics(courseId, topicIds) {
  // Load topics.json to resolve file paths
  const allTopics = await loadTopics(courseId);
  const selected = allTopics.filter(t => topicIds.includes(t.id));
  const loaded = [];
  for (const t of selected) {
    const data = await loadTopicQuestions(courseId, t.file);
    const questions = (data.questions || []).map(q => ({
      ...q,
      id: `${t.id}::${q.id}`, // ensure uniqueness across topics
      _topicId: t.id,
      _topicName: data.topic_name || t.topic_name || t.id,
    }));
    loaded.push({ topic: t, questions });
  }
  const merged = loaded.flatMap(x => x.questions);
  const label = selected.map(t => (t.topic_name || t.id)).join(', ');
  return { questions: merged, label };
}
