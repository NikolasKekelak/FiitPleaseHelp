// Data loading utilities for static hosting (GitHub Pages compatible)
// Courses are declared in /data/courses.json
// Topics are declared in /data/<course>/topics.json

export async function loadCourses() {
  const res = await fetch('data/courses.json');
  if (!res.ok) throw new Error(`Failed to load courses.json (${res.status})`);
  const data = await res.json();
  // Expected shape: { courses: [{ id, course_name }] }
  return data.courses || [];
}

export async function loadTopics(courseId) {
  if (!courseId) return [];
  const res = await fetch(`data/${courseId}/topics.json`);
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
    const res = await fetch(`data/${courseId}/presets.json`);
    if (!res.ok) return [];
    const data = await res.json();
    // Expected: { presets: [ { id, name, description, topics?: ["id", ...] } ] }
    return data.presets || [];
  } catch (e) {
    return [];
  }
}

export async function loadTopicQuestions(courseId, relativeFilePath) {
  const url = `data/${courseId}/${relativeFilePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load topic file ${url} (${res.status})`);
  const data = await res.json();
  // Ensure each question has required fields minimally
  if (!data || !Array.isArray(data.questions)) throw new Error('Invalid topic file structure: missing questions[]');
  // Normalize image paths to be relative from project root if they are relative in file
  data.questions.forEach(q => {
    if (q.image && !/^https?:\/\//.test(q.image)) {
      const p = String(q.image).replace(/\\/g, '/');
      // If already starts with images/ (absolute within site), keep as is
      if (/^\/?images\//.test(p)) {
        q.image = p.replace(/^\//, '');
      } else {
        // Otherwise, treat as relative to course folder inside images/<courseId>/...
        q.image = `images/${courseId}/${p}`;
      }
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
