import { loadCourses, loadTopics, loadTopicQuestions, loadPresets, loadQuestionsForTopics } from './data.js';
import { QuizEngine } from './engine.js';
import { renderQuestion, readUserAnswer, clearAnswerArea, setDisabled } from './ui.js';
// persistence removed

// Rapid practice mode: only single-choice, instant feedback, tap anywhere to continue
const rapidMode = true;
let waitingForTap = false;
let tapCleanup = null;

const els = {
  screens: {
    course: document.getElementById('screen-course'),
    choose: document.getElementById('screen-choose'),
    quiz: document.getElementById('screen-quiz'),
    done: document.getElementById('screen-done'),
  },
  // course screen
  courseSelect: document.getElementById('courseSelect'),
  continueBtn: document.getElementById('continueBtn'),
  // choose screen
  tabPresets: document.getElementById('tabPresets'),
  tabCustom: document.getElementById('tabCustom'),
  presetsPane: document.getElementById('presetsPane'),
  customPane: document.getElementById('customPane'),
  presetList: document.getElementById('presetList'),
  topicsList: document.getElementById('topicsList'),
  startBtn2: document.getElementById('startBtn2'),
  backToCourseBtn: document.getElementById('backToCourseBtn'),
  // theme
  themeToggle: document.getElementById('themeToggle'),

  // quiz
  progressText: document.getElementById('progressText'),
  cooldownText: document.getElementById('cooldownText'),
  questionMeta: document.getElementById('questionMeta'),
  questionText: document.getElementById('questionText'),
  questionImage: document.getElementById('questionImage'),
  answerForm: document.getElementById('answerForm'),
  submitBtn: document.getElementById('submitBtn'),
  nextBtn: document.getElementById('nextBtn'),
  feedback: document.getElementById('feedback'),
  explanationBox: document.getElementById('explanationBox'),
  explanationText: document.getElementById('explanationText'),

  // done
  restartBtn: document.getElementById('restartBtn'),
  backBtn: document.getElementById('backBtn'),
};

let engine = null;
let context = { course: null, sessionLabel: '', lastSelection: null };

function applyEnter(el, cls = 'enter') {
  if (!el) return;
  el.classList.remove(cls);
  // force reflow to restart animation
  void el.offsetWidth;
  el.classList.add(cls);
}

function show(screen) {
  els.screens.course.classList.toggle('hidden', screen !== 'course');
  els.screens.choose.classList.toggle('hidden', screen !== 'choose');
  els.screens.quiz.classList.toggle('hidden', screen !== 'quiz');
  els.screens.done.classList.toggle('hidden', screen !== 'done');

  // animate the newly visible screen
  const map = {
    course: els.screens.course,
    choose: els.screens.choose,
    quiz: els.screens.quiz,
    done: els.screens.done,
  };
  applyEnter(map[screen], 'enter');
}

function setTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

function initTheme() {
  const saved = localStorage.getItem('mq_theme');
  const preferDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = saved ? saved === 'dark' : preferDark;
  setTheme(dark);
  els.themeToggle.checked = dark;
  els.themeToggle.addEventListener('change', () => {
    const d = els.themeToggle.checked;
    setTheme(d);
    localStorage.setItem('mq_theme', d ? 'dark' : 'light');
  });
}

async function initCourseScreen() {
  els.courseSelect.innerHTML = '';
  const courses = await loadCourses();
  for (const c of courses) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.course_name || c.id;
    els.courseSelect.appendChild(opt);
  }
}

function activateTab(name) {
  const isPresets = name === 'presets';
  els.tabPresets.classList.toggle('primary', isPresets);
  els.tabCustom.classList.toggle('primary', !isPresets);
  els.presetsPane.classList.toggle('hidden', !isPresets);
  els.customPane.classList.toggle('hidden', isPresets);
}

async function loadChooseScreen() {
  // Reset lists
  els.presetList.innerHTML = '';
  els.topicsList.innerHTML = '';
  els.startBtn2.disabled = true;

  // Load presets and topics for current course
  const [presets, topics] = await Promise.all([
    loadPresets(context.course),
    loadTopics(context.course),
  ]);

  // Render presets
  if (presets.length === 0) {
    const p = document.createElement('div');
    p.className = 'hint';
    p.textContent = 'No presets defined for this course.';
    els.presetList.appendChild(p);
  } else {
    presets.forEach(pr => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'item btn';
      item.textContent = pr.name || pr.id;
      item.title = pr.description || '';
      item.addEventListener('click', () => {
        // Mark selected
        Array.from(els.presetList.children).forEach(ch => ch.classList.remove('selected'));
        item.classList.add('selected');
        els.startBtn2.disabled = false;
        context.lastSelection = { mode: 'preset', preset: pr };
      });
      els.presetList.appendChild(item);
    });
  }

  // Render topics checklist
  topics.forEach(t => {
    const label = document.createElement('label');
    label.className = 'option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = t.id;
    const span = document.createElement('span');
    span.textContent = t.topic_name || t.id;
    label.appendChild(cb);
    label.appendChild(span);
    cb.addEventListener('change', () => {
      const ids = getSelectedTopicIds();
      els.startBtn2.disabled = ids.length === 0;
      context.lastSelection = ids.length ? { mode: 'custom', topicIds: ids } : null;
    });
    els.topicsList.appendChild(label);
  });

  // Default to presets tab
  activateTab('presets');
}

function getSelectedTopicIds() {
  return Array.from(els.topicsList.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
}

function updateProgress() {
  if (!engine) return;
  const { mastered, total } = engine.progress();
  els.progressText.textContent = `${mastered} / ${total} mastered`;
}

function updateCooldown() {
  if (!engine) return;
  const t = engine.cooldownInfo();
  els.cooldownText.textContent = t ? `Cooldown: ${t}` : '';
}

function disableAnswerInputs(disabled) {
  const inputs = els.answerForm.querySelectorAll('input');
  inputs.forEach(inp => inp.disabled = !!disabled);
}

function displayResult(result, q) {
  els.explanationText.textContent = q.explanation || '';
  if (result.correct) {
    els.feedback.textContent = 'Correct';
    els.feedback.classList.add('ok');
  } else {
    els.feedback.textContent = 'Incorrect';
    els.feedback.classList.add('bad');
    if (result.showCorrect) {
      const cc = document.createElement('div');
      cc.style.marginTop = '6px';
      cc.innerHTML = `<small>Correct answer:</small> ${result.correctAnswerHtml}`;
      els.feedback.appendChild(cc);
    }
  }
  // trigger subtle fade-in animation
  els.feedback.classList.add('show');
  els.explanationBox.open = true;
}

function attachTapToContinueOnce() {
  if (waitingForTap) return;
  waitingForTap = true;
  const handler = () => {
    if (!waitingForTap) return;
    waitingForTap = false;
    if (tapCleanup) { tapCleanup(); tapCleanup = null; }
    onNext();
  };
  const keyHandler = (e) => {
    if (!waitingForTap) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handler();
    }
  };
  // Defer attaching click listeners to avoid catching the same click that selected the answer
  setTimeout(() => {
    document.body.addEventListener('click', handler, { once: true });
    document.body.addEventListener('touchstart', handler, { once: true, passive: true });
    document.addEventListener('keydown', keyHandler);
    tapCleanup = () => {
      document.removeEventListener('keydown', keyHandler);
    };
  }, 0);
  // Show hint for rapid mode
  els.feedback.insertAdjacentHTML('beforeend', '<div class="hint pulse" style="margin-top:8px;opacity:0.7">Tap anywhere to continue</div>');
}

function renderCurrentQuestion() {
  if (rapidMode) {
    // Hide traditional buttons in rapid mode
    els.submitBtn.style.display = 'none';
    els.nextBtn.style.display = 'none';
  } else {
    els.submitBtn.style.display = '';
    els.nextBtn.style.display = '';
  }
  // reset any pending tap handlers
  waitingForTap = false;
  if (tapCleanup) { tapCleanup(); tapCleanup = null; }

  const q = engine.current();
  if (!q) {
    show('done');
    return;
  }
  els.feedback.textContent = '';
  els.feedback.className = 'feedback';
  els.explanationBox.open = false;
  els.explanationText.textContent = '';

  els.questionMeta.textContent = context.sessionLabel ? context.sessionLabel : '';
  els.questionText.textContent = q.question;
  els.questionImage.innerHTML = '';
  if (q.image) {
    const img = document.createElement('img');
    img.src = q.image;
    img.alt = 'Question image';
    els.questionImage.appendChild(img);
  }

  clearAnswerArea(els.answerForm);
  renderQuestion(els.answerForm, q);

  // animate question content subtly
  applyEnter(els.questionText, 'enter-soft');
  applyEnter(els.questionImage, 'enter-soft');
  applyEnter(els.answerForm, 'enter-soft');

  // Rapid-mode per-question behavior
  if (rapidMode && q.type === 'mc_single') {
    const radios = els.answerForm.querySelectorAll('input[name="mc_single"]');
    const onPick = (e) => {
      if (waitingForTap) return;
      const idx = Number(e.target.value);
      const result = engine.answer(q.id, idx);
      displayResult(result, q);
      disableAnswerInputs(true);
      attachTapToContinueOnce();
    };
    radios.forEach(r => {
      r.addEventListener('change', onPick, { once: true });
      r.addEventListener('click', onPick, { once: true });
    });
  }

  setDisabled(els.submitBtn, false);
  setDisabled(els.nextBtn, true);
  disableAnswerInputs(false);
  updateProgress();
  updateCooldown();
}

function onSubmit(e) {
  e.preventDefault();
  if (!engine) return;
  const q = engine.current();
  if (!q) return;

  const userAnswer = readUserAnswer(els.answerForm, q);
  const result = engine.answer(q.id, userAnswer);

  els.explanationText.textContent = q.explanation || '';
  if (result.correct) {
    els.feedback.textContent = 'Correct';
    els.feedback.classList.add('ok');
  } else {
    els.feedback.textContent = 'Incorrect';
    els.feedback.classList.add('bad');
    if (result.showCorrect) {
      const cc = document.createElement('div');
      cc.style.marginTop = '6px';
      cc.innerHTML = `<small>Correct answer:</small> ${result.correctAnswerHtml}`;
      els.feedback.appendChild(cc);
    }
  }
  els.explanationBox.open = true;

  // Lock inputs; wait for explicit Next
  disableAnswerInputs(true);
  setDisabled(els.submitBtn, true);
  setDisabled(els.nextBtn, false);
}

function onNext() {
  if (!engine) return;
  if (engine.isDone()) {
    show('done');
    return;
  }
  engine.next();
  renderCurrentQuestion();
}

async function onContinue() {
  const courseId = els.courseSelect.value;
  if (!courseId) return;
  context.course = courseId;
  await loadChooseScreen();
  show('choose');
}

function filterToMcSingle(questions) {
  return questions.filter(q => {
    if (q && q.type === 'mc_single') return true;
    if (!q) return false;
    const hasOptions = Array.isArray(q.options);
    const numCorrect = typeof q.correct === 'number' && !Array.isArray(q.correct);
    return hasOptions && numCorrect;
  });
}

async function startFromSelection() {
  if (!context.lastSelection) return;
  if (context.lastSelection.mode === 'preset') {
    const pr = context.lastSelection.preset;
    // If preset specifies topics, use them; otherwise default to all topics
    let topicIds = pr.topics && pr.topics.length ? pr.topics.slice() : (await loadTopics(context.course)).map(t => t.id);
    const { questions, label } = await loadQuestionsForTopics(context.course, topicIds);
    const filtered = rapidMode ? filterToMcSingle(questions) : questions;
    if (rapidMode && filtered.length === 0) {
      alert('No single-choice questions available in the selected topics.');
      return;
    }
    context.sessionLabel = pr.name ? `Preset: ${pr.name}` : `Preset: ${pr.id}`;
    engine = new QuizEngine(filtered);
    show('quiz');
    renderCurrentQuestion();
  } else if (context.lastSelection.mode === 'custom') {
    const ids = context.lastSelection.topicIds || [];
    const { questions, label } = await loadQuestionsForTopics(context.course, ids);
    const filtered = rapidMode ? filterToMcSingle(questions) : questions;
    if (rapidMode && filtered.length === 0) {
      alert('No single-choice questions available in the selected topics.');
      return;
    }
    context.sessionLabel = `Topics: ${label}`;
    engine = new QuizEngine(filtered);
    show('quiz');
    renderCurrentQuestion();
  }
}

function onStartChoose() {
  startFromSelection().catch(err => {
    alert('Failed to start quiz: ' + err.message);
    console.error(err);
  });
}

function onBackToCourse() {
  show('course');
}

function onRestart() {
  // Restart the last selection freshly
  startFromSelection();
}

function onBackFromDone() {
  show('choose');
}

function main() {
  initTheme();
  initCourseScreen();
  show('course');

  // Tabs
  els.tabPresets.addEventListener('click', () => activateTab('presets'));
  els.tabCustom.addEventListener('click', () => activateTab('custom'));

  // Navigation
  els.continueBtn.addEventListener('click', onContinue);
  els.backToCourseBtn.addEventListener('click', onBackToCourse);

  // Quiz actions
  els.submitBtn.addEventListener('click', onSubmit);
  els.nextBtn.addEventListener('click', onNext);
  els.restartBtn.addEventListener('click', onRestart);
  els.backBtn.addEventListener('click', onBackFromDone);

  // Start from Choose screen
  els.startBtn2.addEventListener('click', onStartChoose);
}

main();
