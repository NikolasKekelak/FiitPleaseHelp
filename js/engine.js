// QuizEngine: mastery-based logic
// - One question at a time
// - Correct -> permanently removed (mastered)
// - Incorrect -> stays; increases weight; set short cooldown to avoid immediate repeat
// - Failed questions appear more often than unseen ones (weighted random)
// - Quiz ends only when all questions are mastered
import { normalizeConnectNodesQuestion, evaluateConnectNodes } from './connect-nodes.js';

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

export class QuizEngine {
  constructor(questions) {
    this.questions = normalizeQuestions(questions);
    this.indexById = new Map(this.questions.map((q, i) => [q.id, i]));
    this.total = this.questions.length;
    this.mastered = new Set();
    this.wrongCount = {}; // id -> times wrong
    this.cooldown = {};   // id -> questions to wait
    this.currentId = null;

    // Start by selecting first question
    this.next();
  }

  static deserialize(questions, state) {
    const e = new QuizEngine(questions);
    // override initial selections
    e.mastered = new Set(state.mastered || []);
    e.wrongCount = state.wrongCount || {};
    e.cooldown = state.cooldown || {};
    e.currentId = state.currentId || null;
    // Ensure currentId is valid
    if (e.currentId && e.mastered.has(e.currentId)) e.currentId = null;
    if (!e.currentId) e.next();
    return e;
  }

  serialize() {
    return {
      mastered: Array.from(this.mastered),
      wrongCount: this.wrongCount,
      cooldown: this.cooldown,
      currentId: this.currentId,
    };
  }

  progress() {
    return { mastered: this.mastered.size, total: this.total };
  }

  cooldownInfo() {
    // Provide a small hint about how many have cooldown > 0 (optional)
    const active = Object.values(this.cooldown).filter(v => v > 0).length;
    return active > 0 ? `${active} cooling` : '';
  }

  isDone() {
    return this.mastered.size >= this.total;
  }

  current() {
    return this.currentId ? this.questions[this.indexById.get(this.currentId)] : null;
  }

  next() {
    // Reduce cooldowns
    for (const id of Object.keys(this.cooldown)) {
      if (this.cooldown[id] > 0) this.cooldown[id] -= 1;
    }

    const candidates = [];
    for (const q of this.questions) {
      if (this.mastered.has(q.id)) continue;
      if ((this.cooldown[q.id] || 0) > 0) continue;
      const weight = this.weightFor(q.id);
      for (let i = 0; i < weight; i++) candidates.push(q.id);
    }
    if (candidates.length === 0) {
      this.currentId = null;
      return null;
    }
    this.currentId = candidates[Math.floor(Math.random() * candidates.length)];
    return this.current();
  }

  skip() {
    if (!this.currentId) return;
    // Small cooldown to not repeat immediately
    this.cooldown[this.currentId] = Math.max(this.cooldown[this.currentId] || 0, 1);
    this.next();
  }

  weightFor(id) {
    const wrong = this.wrongCount[id] || 0;
    // Unseen: 1; Wrong once: 3; each extra wrong adds +1
    return wrong === 0 ? 1 : 3 + (wrong - 1);
  }

  answer(id, userAnswer) {
    const q = this.questions[this.indexById.get(id)];
    const { correct, meta } = evaluate(q, userAnswer);

    if (correct) {
      this.mastered.add(q.id);
      this.cooldown[q.id] = 0;
    } else {
      this.wrongCount[q.id] = (this.wrongCount[q.id] || 0) + 1;
      // Cooldown to not repeat instantly; harsher if repeated mistakes
      this.cooldown[q.id] = Math.min(3, 1 + (this.wrongCount[q.id] - 1));
    }

    const { showCorrect, correctAnswerHtml } = correctAnswerInfo(q);

    return { correct, showCorrect, correctAnswerHtml, meta };
  }
}

function normalizeQuestions(questions) {
  // Ensure consistent shapes used by engine
  return questions.map(raw => {
    const q = clone(raw);
    q.type = q.type || inferType(q);
    if (!q.id) throw new Error('Question missing id');
    if (!q.question) throw new Error(`Question ${q.id} missing question text`);
    if (!q.explanation) q.explanation = '';

    switch (q.type) {
      case 'true_false':
        // expect q.correct as boolean or 'true'/'false'
        if (typeof q.correct !== 'boolean') q.correct = String(q.correct).toLowerCase() === 'true';
        break;
      case 'mc_single':
        if (!Array.isArray(q.options) || q.options.length < 2) throw new Error(`Question ${q.id} missing options`);
        if (Array.isArray(q.correct)) q.correct = q.correct[0];
        if (typeof q.correct !== 'number') throw new Error(`Question ${q.id} mc_single requires numeric correct index`);
        break;
      case 'mc_multi':
        if (!Array.isArray(q.options) || q.options.length < 2) throw new Error(`Question ${q.id} missing options`);
        if (!Array.isArray(q.correct)) throw new Error(`Question ${q.id} mc_multi requires array of correct indices`);
        q.correct = Array.from(new Set(q.correct.map(n => Number(n)))).sort((a,b)=>a-b);
        break;
      case 'fill_text':
        if (!Array.isArray(q.answers) || q.answers.length === 0) throw new Error(`Question ${q.id} fill_text requires answers[]`);
        break;
      case 'fill_table':
        if (!q.table || !Array.isArray(q.table.answers)) throw new Error(`Question ${q.id} fill_table requires table.answers 2D array`);
        break;
      case 'sort': {
        // Normalize items to objects { id, text }
        if (!Array.isArray(q.items) || q.items.length < 2) throw new Error(`Question ${q.id} sort requires items[] (>=2)`);
        q.items = q.items.map((it, idx) => (typeof it === 'string' ? { id: String(idx), text: it } : { id: String(it.id), text: it.text }));
        if (!Array.isArray(q.correct) || q.correct.length !== q.items.length) throw new Error(`Question ${q.id} sort requires correct[] same length as items[]`);
        // Coerce correct IDs to strings matching items ids, but allow numeric indices if items were strings
        const idSet = new Set(q.items.map(it => String(it.id)));
        q.correct = q.correct.map(v => String(v));
        // If provided as indices, map to string indices as ids
        if (!q.correct.every(id => idSet.has(id))) {
          // Try mapping numeric indices to ids
          const mapped = q.correct.map(v => {
            const n = Number(v);
            if (Number.isNaN(n) || n < 0 || n >= q.items.length) return String(v);
            return String(q.items[n].id);
          });
          q.correct = mapped;
        }
        break;
      }
      case 'connect_nodes': {
        const norm = normalizeConnectNodesQuestion(q);
        if (!Array.isArray(norm.leftNodes) || !Array.isArray(norm.rightNodes)) throw new Error(`Question ${q.id} connect_nodes requires leftNodes[] and rightNodes[]`);
        q.leftNodes = norm.leftNodes;
        q.rightNodes = norm.rightNodes;
        q.correctPairs = norm.correctPairs || [];
        break;
      }
      default:
        throw new Error(`Unknown type: ${q.type}`);
    }

    return q;
  });
}

function inferType(q) {
  if (q.hasOwnProperty('answers') && !q.options) return 'fill_text';
  if (q.table) return 'fill_table';
  if (q.items && Array.isArray(q.correct) && !q.options) return 'sort';
  if (q.options && Array.isArray(q.correct)) return 'mc_multi';
  if (q.options) return 'mc_single';
  if (typeof q.correct === 'boolean') return 'true_false';
  return 'fill_text';
}

function evaluate(q, userAnswer) {
  switch (q.type) {
    case 'true_false':
      return { correct: Boolean(userAnswer) === Boolean(q.correct), meta: {} };
    case 'mc_single': {
      const idx = typeof userAnswer === 'number' ? userAnswer : Number(userAnswer);
      return { correct: idx === q.correct, meta: {} };
    }
    case 'mc_multi': {
      const ua = Array.isArray(userAnswer) ? userAnswer.slice().sort((a,b)=>a-b) : [];
      if (ua.length !== q.correct.length) return { correct: false, meta: {} };
      for (let i=0;i<ua.length;i++) if (ua[i] !== q.correct[i]) return { correct: false, meta: {} };
      return { correct: true, meta: {} };
    }
    case 'fill_text': {
      const norm = s => String(s || '').trim().toLowerCase();
      const ans = norm(userAnswer);
      return { correct: q.answers.some(a => norm(a) === ans), meta: {} };
    }
    case 'fill_table': {
      const norm = s => String(s || '').trim().toLowerCase();
      const ua = userAnswer || [];
      const a = q.table.answers;
      if (!Array.isArray(ua) || ua.length !== a.length) return { correct: false, meta: {} };
      for (let r=0;r<a.length;r++) {
        if (!Array.isArray(ua[r]) || ua[r].length !== a[r].length) return { correct: false, meta: {} };
        for (let c=0;c<a[r].length;c++) {
          if (norm(ua[r][c]) !== norm(a[r][c])) return { correct: false, meta: {} };
        }
      }
      return { correct: true, meta: {} };
    }
    case 'sort': {
      const ua = Array.isArray(userAnswer) ? userAnswer.map(v => String(v)) : [];
      const corr = q.correct.map(v => String(v));
      const correct = ua.length === corr.length && ua.every((v, i) => v === corr[i]);
      // Compute consecutive runs of correct relative order (in correct positions consecutively)
      // As per requirement: highlight any spans of length >=2 that are in the right consecutive order.
      const runs = [];
      let runStart = -1;
      for (let i = 0; i < Math.min(ua.length, corr.length); i++) {
        if (ua[i] === corr[i]) {
          if (runStart === -1) runStart = i;
        } else {
          if (runStart !== -1 && i - runStart >= 2) runs.push([runStart, i - 1]);
          runStart = -1;
        }
      }
      if (runStart !== -1 && ua.length - runStart >= 2) runs.push([runStart, ua.length - 1]);
      return { correct, meta: { consecutiveRuns: runs } };
    }
    case 'connect_nodes': {
      // userAnswer expected: { connections: Array<{leftId,rightId}> }
      const { correct, meta } = evaluateConnectNodes(q, userAnswer || { connections: [] });
      return { correct, meta };
    }
    default:
      return { correct: false, meta: {} };
  }
}

function correctAnswerInfo(q) {
  switch (q.type) {
    case 'true_false':
      return { showCorrect: true, correctAnswerHtml: q.correct ? 'True' : 'False' };
    case 'mc_single':
      return { showCorrect: true, correctAnswerHtml: escapeHtml(q.options[q.correct]) };
    case 'mc_multi': {
      const txt = q.correct.map(i => escapeHtml(q.options[i])).join(', ');
      return { showCorrect: true, correctAnswerHtml: txt };
    }
    case 'fill_text':
      return { showCorrect: true, correctAnswerHtml: q.answers.map(escapeHtml).join(' | ') };
    case 'fill_table': {
      const rows = q.table.answers.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`).join('');
      return { showCorrect: true, correctAnswerHtml: `<table>${rows}</table>` };
    }
    case 'sort': {
      const idToText = new Map(q.items.map(it => [String(it.id), it.text]));
      const txt = q.correct.map(id => escapeHtml(String(idToText.get(String(id)) || id))).join(' → ');
      return { showCorrect: true, correctAnswerHtml: txt };
    }
    case 'connect_nodes': {
      // Do not reveal correct solution by default
      return { showCorrect: false, correctAnswerHtml: '' };
    }
    default:
      return { showCorrect: false, correctAnswerHtml: '' };
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}
