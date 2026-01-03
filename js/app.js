import { loadCourses, loadTopics, loadTopicQuestions, loadPresets, loadQuestionsForTopics } from './data.js';
import { QuizEngine } from './engine.js';
import { renderQuestion, readUserAnswer, clearAnswerArea, setDisabled } from './ui.js';
import { loadSettings, saveSettings } from './storage.js';
// persistence removed

// Rapid practice mode enabled: default flow auto-answers on pick for most types.
// Special questions (mc_multi, fill_text) require explicit Answer.
const rapidMode = true;
let waitingForTap = false;
let tapCleanup = null;
let doubleTapTimer = null;
let tapCount = 0;

// Keyboard navigation detection for focus-visible styling only when using keyboard
(function initKbdNavDetection() {
  const root = document.documentElement;
  const add = () => root.classList.add('kbd-nav');
  const remove = () => root.classList.remove('kbd-nav');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' || (typeof e.key === 'string' && e.key.startsWith('Arrow'))) add();
  }, { capture: true });
  // Any pointer/touch interaction disables keyboard-focused styling
  document.addEventListener('mousedown', remove, { capture: true });
  document.addEventListener('pointerdown', remove, { capture: true });
  document.addEventListener('touchstart', remove, { capture: true, passive: true });
})();

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
  paletteSelect: document.getElementById('paletteSelect'),
  // settings
  setShowExplanation: document.getElementById('setShowExplanation'),
  setKeepResponses: document.getElementById('setKeepResponses'),
  setHardcore: document.getElementById('setHardcore'),

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
  explanationImage: document.getElementById('explanationImage'),
  explanationText: document.getElementById('explanationText'),

  // done
  restartBtn: document.getElementById('restartBtn'),
  backBtn: document.getElementById('backBtn'),
  doneSubtitle: document.getElementById('doneSubtitle'),
  summaryBox: document.getElementById('summaryBox'),
};

let engine = null;
let context = { course: null, sessionLabel: '', lastSelection: null };
let settings = loadSettings();
let hardcoreResults = [];

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

function setPalette(name) {
  const value = name || 'cozy';
  document.documentElement.setAttribute('data-palette', value);
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

  // Initialize color palette (persist per-device)
  const savedPal = localStorage.getItem('mq_palette') || 'cozy';
  setPalette(savedPal);
  if (els.paletteSelect) {
    els.paletteSelect.value = savedPal;
    els.paletteSelect.addEventListener('change', () => {
      const p = els.paletteSelect.value || 'cozy';
      setPalette(p);
      localStorage.setItem('mq_palette', p);
    });
  }
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
  if (settings.hardcoreMode) {
    els.progressText.textContent = `${mastered} / ${total} answered`;
  } else {
    els.progressText.textContent = `${mastered} / ${total} mastered`;
  }
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
  // Feedback
  els.feedback.textContent = '';
  els.feedback.classList.remove('ok', 'bad', 'show');
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
  els.feedback.classList.add('show');

  // Explanation: only show/open when enabled in settings
  if (settings.showExplanation) {
    els.explanationText.textContent = q.explanation || '';
    if (els.explanationImage) {
      els.explanationImage.innerHTML = '';
      if (q.explanation_image) {
        const img = document.createElement('img');
        img.src = q.explanation_image;
        img.alt = 'Explanation image';
        els.explanationImage.appendChild(img);
      }
    }
    els.explanationBox.open = true;
  } else {
    els.explanationText.textContent = '';
    if (els.explanationImage) els.explanationImage.innerHTML = '';
    els.explanationBox.open = false;
  }

  if (settings.keepResponses) {
    // Keep options and highlight chosen + correct/incorrect
    highlightAnswersInPlace(q, result);
  } else {
    // Hide answer options to keep the focus on the explanation
    clearAnswerArea(els.answerForm);
  }
}

function highlightAnswersInPlace(q, result) {
  const labels = Array.from(els.answerForm.querySelectorAll('label.option'));
  const isChosen = (idx) => {
    const input = els.answerForm.querySelector(`input[value="${String(idx)}"]`);
    return input && (input.checked || input.getAttribute('data-chosen') === '1');
  };
  if (q.type === 'mc_single') {
    labels.forEach((lab) => {
      const input = lab.querySelector('input');
      const idx = input ? Number(input.value) : -1;
      lab.classList.remove('correct', 'incorrect', 'chosen');
      if (idx === q.correct) lab.classList.add('correct');
      if (isChosen(idx)) lab.classList.add('chosen');
      if (isChosen(idx) && idx !== q.correct) lab.classList.add('incorrect');
    });
  } else if (q.type === 'mc_multi') {
    const corr = new Set(q.correct || []);
    labels.forEach((lab) => {
      const input = lab.querySelector('input');
      const idx = input ? Number(input.value) : -1;
      lab.classList.remove('correct', 'incorrect', 'chosen');
      if (corr.has(idx)) lab.classList.add('correct');
      if (isChosen(idx)) lab.classList.add('chosen');
      if (isChosen(idx) && !corr.has(idx)) lab.classList.add('incorrect');
    });
  }
}

function attachDoubleTapToContinue() {
  if (waitingForTap) return;
  waitingForTap = true;
  tapCount = 0;
  if (doubleTapTimer) { clearTimeout(doubleTapTimer); doubleTapTimer = null; }

  const installClickShield = (duration = 450) => {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '9999';
    overlay.style.background = 'transparent';
    overlay.setAttribute('aria-hidden', 'true');
    const swallow = (ev) => {
      if (typeof ev.cancelable !== 'boolean' || ev.cancelable) ev.preventDefault();
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    };
    const cap = true;
    const addAll = (target) => {
      target.addEventListener('click', swallow, { capture: true });
      target.addEventListener('pointerdown', swallow, { capture: true });
      target.addEventListener('pointerup', swallow, { capture: true });
      target.addEventListener('mousedown', swallow, { capture: true });
      target.addEventListener('mouseup', swallow, { capture: true });
      target.addEventListener('touchstart', swallow, { capture: true, passive: false });
      target.addEventListener('touchend', swallow, { capture: true, passive: false });
      target.addEventListener('touchcancel', swallow, { capture: true, passive: false });
    };
    const removeAll = (target) => {
      target.removeEventListener('click', swallow, cap);
      target.removeEventListener('pointerdown', swallow, cap);
      target.removeEventListener('pointerup', swallow, cap);
      target.removeEventListener('mousedown', swallow, cap);
      target.removeEventListener('mouseup', swallow, cap);
      target.removeEventListener('touchstart', swallow, cap);
      target.removeEventListener('touchend', swallow, cap);
      target.removeEventListener('touchcancel', swallow, cap);
    };
    addAll(window);
    document.body.appendChild(overlay);
    addAll(overlay);
    setTimeout(() => {
      removeAll(window);
      removeAll(overlay);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, duration);
  };

  const advance = (e) => {
    waitingForTap = false;
    if (e) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }
    if (tapCleanup) { tapCleanup(); tapCleanup = null; }
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    onNext();
    installClickShield(280);
  };

  const handleTap = (e) => {
    if (!waitingForTap) return;
    tapCount += 1;
    if (tapCount === 1) {
      // First tap: update hint and start a short timer window for the second tap
      const hint = els.feedback.querySelector('.hint.pulse');
      if (hint) hint.textContent = 'Tap again to continue';
      doubleTapTimer = setTimeout(() => {
        tapCount = 0; // require two taps within window
      }, 800);
      // consume event
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
      return;
    }
    if (tapCount >= 2) {
      if (doubleTapTimer) { clearTimeout(doubleTapTimer); doubleTapTimer = null; }
      advance(e);
    }
  };

  const keyHandler = (e) => {
    if (!waitingForTap) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handleTap(e);
    }
  };

  setTimeout(() => {
    document.body.addEventListener('click', handleTap, { capture: true });
    document.body.addEventListener('touchstart', handleTap, { passive: false, capture: true });
    document.addEventListener('keydown', keyHandler);
    tapCleanup = () => {
      document.body.removeEventListener('click', handleTap, true);
      document.body.removeEventListener('touchstart', handleTap, true);
      document.removeEventListener('keydown', keyHandler);
    };
  }, 0);

  // Show hint for rapid mode
  els.feedback.insertAdjacentHTML('beforeend', '<div class="hint pulse" style="margin-top:8px;opacity:0.7">Tap twice to continue</div>');
}

function renderCurrentQuestion() {
  if (rapidMode) {
    // In rapid mode, hide buttons by default, except for mc_multi and fill_text which require manual Answer
    const qCur = engine && engine.current();
    if (qCur && (qCur.type === 'mc_multi' || qCur.type === 'fill_text')) {
      els.submitBtn.style.display = '';
      els.nextBtn.style.display = 'none';
    } else {
      els.submitBtn.style.display = 'none';
      els.nextBtn.style.display = 'none';
    }
  } else {
    // Non-rapid mode: show both controls
    els.submitBtn.style.display = '';
    els.nextBtn.style.display = '';
  }
  // reset any pending tap handlers
  waitingForTap = false;
  if (tapCleanup) { tapCleanup(); tapCleanup = null; }
  if (doubleTapTimer) { clearTimeout(doubleTapTimer); doubleTapTimer = null; }
  tapCount = 0;

  const q = engine.current();
  if (!q) {
    // End of quiz: show appropriate finished screen
    if (settings.hardcoreMode) {
      showHardcoreSummary();
    } else {
      showNonHardcoreDone();
    }
    return;
  }
  els.feedback.textContent = '';
  els.feedback.className = 'feedback';
  els.explanationBox.open = false;
  els.explanationText.textContent = '';
  if (els.explanationImage) els.explanationImage.innerHTML = '';

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

  // For mc_multi, ensure the Answer button is enabled only when at least one option is selected
  if (q.type === 'mc_multi') {
    const updateSubmitEnabled = () => {
      const anyChecked = els.answerForm.querySelectorAll('input[name="mc_multi"]:checked').length > 0;
      setDisabled(els.submitBtn, !anyChecked);
    };
    updateSubmitEnabled();
    els.answerForm.addEventListener('change', (e) => {
      if (e.target && e.target.name === 'mc_multi') updateSubmitEnabled();
    }, { once: false });
  } else {
    setDisabled(els.submitBtn, false);
  }

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
      if (settings.hardcoreMode) {
        const result = engine.answer(q.id, idx);
        hardcoreResults.push({ id: q.id, q, userAnswer: idx, correct: result.correct, correctAnswerHtml: result.correctAnswerHtml });
        // Force single-pass: mark as mastered to prevent repeats
        // (Engine already mastered when correct; ensure wrong ones also mastered)
        engine.mastered.add(q.id);
        engine.cooldown[q.id] = 0;
        // Immediately go next without feedback
        if (engine.isDone()) {
          showHardcoreSummary();
        } else {
          engine.next();
          renderCurrentQuestion();
        }
      } else {
        const result = engine.answer(q.id, idx);
        displayResult(result, q);
        disableAnswerInputs(true);
        attachDoubleTapToContinue();
      }
    };
    radios.forEach(r => {
      r.addEventListener('change', onPick, { once: true });
      r.addEventListener('click', onPick, { once: true });
    });
  } else if (rapidMode && q.type === 'true_false') {
    const radios = els.answerForm.querySelectorAll('input[name="tf"]');
    const onPick = (e) => {
      if (waitingForTap) return;
      const val = String(e.target.value) === 'true';
      if (settings.hardcoreMode) {
        const result = engine.answer(q.id, val);
        hardcoreResults.push({ id: q.id, q, userAnswer: val, correct: result.correct, correctAnswerHtml: result.correctAnswerHtml });
        engine.mastered.add(q.id);
        engine.cooldown[q.id] = 0;
        if (engine.isDone()) {
          showHardcoreSummary();
        } else {
          engine.next();
          renderCurrentQuestion();
        }
      } else {
        const result = engine.answer(q.id, val);
        displayResult(result, q);
        disableAnswerInputs(true);
        attachDoubleTapToContinue();
      }
    };
    radios.forEach(r => {
      r.addEventListener('change', onPick, { once: true });
      r.addEventListener('click', onPick, { once: true });
    });
  } else if (rapidMode && q.type === 'fill_text') {
    const inp = els.answerForm.querySelector('input[name="fill_text"]');
    if (inp) {
      const onKey = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (waitingForTap) return;
          const ans = inp.value;
          if (settings.hardcoreMode) {
            const result = engine.answer(q.id, ans);
            hardcoreResults.push({ id: q.id, q, userAnswer: ans, correct: result.correct, correctAnswerHtml: result.correctAnswerHtml });
            engine.mastered.add(q.id);
            engine.cooldown[q.id] = 0;
            if (engine.isDone()) {
              showHardcoreSummary();
            } else {
              engine.next();
              renderCurrentQuestion();
            }
          } else {
            const result = engine.answer(q.id, ans);
            displayResult(result, q);
            disableAnswerInputs(true);
            attachDoubleTapToContinue();
          }
        }
      };
      inp.addEventListener('keydown', onKey, { once: false });
    }
  } else if (rapidMode && q.type === 'fill_table') {
    const onKey = (e) => {
      if (e.key === 'Enter' && e.target && e.target.name && e.target.name.startsWith('cell_')) {
        e.preventDefault();
        if (waitingForTap) return;
        const ans = readUserAnswer(els.answerForm, q);
        if (settings.hardcoreMode) {
          const result = engine.answer(q.id, ans);
          hardcoreResults.push({ id: q.id, q, userAnswer: ans, correct: result.correct, correctAnswerHtml: result.correctAnswerHtml });
          engine.mastered.add(q.id);
          engine.cooldown[q.id] = 0;
          if (engine.isDone()) {
            showHardcoreSummary();
          } else {
            engine.next();
            renderCurrentQuestion();
          }
        } else {
          const result = engine.answer(q.id, ans);
          displayResult(result, q);
          disableAnswerInputs(true);
          attachDoubleTapToContinue();
        }
      }
    };
    els.answerForm.addEventListener('keydown', onKey, { once: false });
  }

  if (q.type !== 'mc_multi') setDisabled(els.submitBtn, false);
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
  if (settings.hardcoreMode) {
    const result = engine.answer(q.id, userAnswer);
    hardcoreResults.push({ id: q.id, q, userAnswer, correct: result.correct, correctAnswerHtml: result.correctAnswerHtml });
    engine.mastered.add(q.id);
    engine.cooldown[q.id] = 0;
    if (engine.isDone()) {
      showHardcoreSummary();
    } else {
      engine.next();
      renderCurrentQuestion();
    }
  } else {
    const result = engine.answer(q.id, userAnswer);
    // Use common result renderer to populate feedback and explanation
    displayResult(result, q);
    // Lock inputs; in rapid mode we do not show Next button. Use double-tap to continue.
    disableAnswerInputs(true);
    setDisabled(els.submitBtn, true);
    els.nextBtn.style.display = 'none';
    attachDoubleTapToContinue();
  }
}

function onNext() {
  if (!engine) return;
  if (engine.isDone()) {
    if (settings.hardcoreMode) {
      showHardcoreSummary();
    } else {
      showNonHardcoreDone();
    }
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
    context.sessionLabel = pr.name ? `Preset: ${pr.name}` : `Preset: ${pr.id}`;
    hardcoreResults = [];
    settings = loadSettings();
    engine = new QuizEngine(questions);
    show('quiz');
    renderCurrentQuestion();
  } else if (context.lastSelection.mode === 'custom') {
    const ids = context.lastSelection.topicIds || [];
    const { questions, label } = await loadQuestionsForTopics(context.course, ids);
    context.sessionLabel = `Topics: ${label}`;
    hardcoreResults = [];
    settings = loadSettings();
    engine = new QuizEngine(questions);
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
  initSettingsUi();
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

function initSettingsUi() {
  // Load current settings
  settings = loadSettings();
  if (els.setShowExplanation) els.setShowExplanation.checked = !!settings.showExplanation;
  if (els.setKeepResponses) els.setKeepResponses.checked = !!settings.keepResponses;
  if (els.setHardcore) els.setHardcore.checked = !!settings.hardcoreMode;

  const save = () => {
    settings = saveSettings({
      showExplanation: !!els.setShowExplanation.checked,
      keepResponses: !!els.setKeepResponses.checked,
      hardcoreMode: !!els.setHardcore.checked,
    });
  };

  els.setShowExplanation && els.setShowExplanation.addEventListener('change', save);
  els.setKeepResponses && els.setKeepResponses.addEventListener('change', save);
  els.setHardcore && els.setHardcore.addEventListener('change', save);
}

function showHardcoreSummary() {
  // Show done screen with score + detailed rows
  show('done');
  const total = hardcoreResults.length;
  const ok = hardcoreResults.filter(r => r.correct).length;
  if (els.doneSubtitle) {
    els.doneSubtitle.textContent = `Hardcore score: ${ok} / ${total}`;
  }
  if (els.summaryBox) {
    els.summaryBox.innerHTML = '';
    hardcoreResults.forEach(r => {
      const row = document.createElement('div');
      row.className = 'row ' + (r.correct ? 'ok' : 'bad');
      const qTitle = document.createElement('div');
      qTitle.className = 'q';
      qTitle.textContent = r.q.question;
      const badge = document.createElement('span');
      badge.className = 'badge ' + (r.correct ? 'ok' : 'bad');
      badge.textContent = r.correct ? 'Correct' : 'Wrong';
      qTitle.appendChild(badge);
      row.appendChild(qTitle);
      if (!r.correct && r.correctAnswerHtml) {
        const corr = document.createElement('div');
        corr.innerHTML = `<small>Correct:</small> ${r.correctAnswerHtml}`;
        row.appendChild(corr);
      }
      if (settings.showExplanation && r.q.explanation) {
        const expl = document.createElement('div');
        expl.innerHTML = `<small>Explanation:</small> ${r.q.explanation}`;
        row.appendChild(expl);
      }
      els.summaryBox.appendChild(row);
    });
  }
}

function showNonHardcoreDone() {
  // Generic finish view without score/summary
  show('done');
  if (els.doneSubtitle) {
    els.doneSubtitle.textContent = 'You mastered every question in this topic.';
  }
  if (els.summaryBox) {
    els.summaryBox.innerHTML = '';
  }
}
