// UI rendering for question types
// Keep logic minimal; actual correctness is handled by engine

function shuffleWithIndex(arr) {
  const indexed = arr.map((v, i) => ({ v, i }));
  for (let i = indexed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
  }
  return indexed;
}

export function clearAnswerArea(form) {
  form.innerHTML = '';
}

export function setDisabled(el, v) {
  el.disabled = !!v;
}

export function renderQuestion(form, q) {
  switch (q.type) {
    case 'true_false':
      renderTrueFalse(form, q);
      break;
    case 'mc_single':
      renderMcSingle(form, q);
      break;
    case 'mc_multi':
      renderMcMulti(form, q);
      break;
    case 'fill_text':
      renderFillText(form, q);
      break;
    case 'fill_table':
      renderFillTable(form, q);
      break;
    case 'sort':
      renderSort(form, q);
      break;
    default:
      form.textContent = 'Unsupported question type';
  }
}

function renderTrueFalse(form, q) {
  const opts = [
    { label: 'True', value: 'true' },
    { label: 'False', value: 'false' },
  ];
  opts.forEach((opt, idx) => {
    const label = document.createElement('label');
    label.className = 'option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'tf';
    input.value = opt.value;
    label.appendChild(input);
    label.appendChild(document.createTextNode(opt.label));
    form.appendChild(label);
  });
}

function renderMcSingle(form, q) {
  const shuffled = shuffleWithIndex(q.options);
  shuffled.forEach(({ v, i }) => {
    const label = document.createElement('label');
    label.className = 'option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'mc_single';
    input.value = String(i); // original index
    label.appendChild(input);
    label.appendChild(document.createTextNode(v));
    form.appendChild(label);
  });
}

function renderMcMulti(form, q) {
  const shuffled = shuffleWithIndex(q.options);
  shuffled.forEach(({ v, i }) => {
    const label = document.createElement('label');
    label.className = 'option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'mc_multi';
    input.value = String(i); // original index
    label.appendChild(input);
    label.appendChild(document.createTextNode(v));
    form.appendChild(label);
  });
}

function renderFillText(form, q) {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.name = 'fill_text';
  inp.placeholder = 'Type your answer';
  form.appendChild(inp);
}

function renderFillTable(form, q) {
  const a = q.table.answers;
  const table = document.createElement('table');
  table.style.borderCollapse = 'separate';
  table.style.borderSpacing = '6px';
  for (let r = 0; r < a.length; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < a[r].length; c++) {
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.name = `cell_${r}_${c}`;
      inp.style.padding = '8px 10px';
      inp.style.borderRadius = '10px';
      inp.style.border = '1px solid var(--border)';
      td.appendChild(inp);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  form.appendChild(table);
}

function renderSort(form, q) {
  const list = document.createElement('div');
  list.className = 'sort-list';

  // Normalize items to array of { id, text }
  const items = (q.items || []).map((it, idx) => {
    if (typeof it === 'string') return { id: String(idx), text: it };
    return { id: String(it.id), text: it.text };
  });

  // Create rows
  items.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'sort-item';
    row.setAttribute('draggable', 'true');
    row.dataset.id = it.id;

    const handle = document.createElement('span');
    handle.className = 'sort-handle';
    handle.textContent = '≡';
    row.appendChild(handle);

    const label = document.createElement('span');
    label.className = 'sort-label';
    label.textContent = it.text;
    row.appendChild(label);

    list.appendChild(row);
  });

  // DnD behavior (HTML5)
  let dragEl = null;
  list.addEventListener('dragstart', (e) => {
    const target = e.target.closest('.sort-item');
    if (!target) return;
    dragEl = target;
    target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', target.dataset.id || ''); } catch (_) {}
  });
  list.addEventListener('dragend', (e) => {
    const target = e.target.closest('.sort-item');
    if (target) target.classList.remove('dragging');
    dragEl = null;
  });
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const after = getDragAfterElement(list, e.clientY);
    const dragging = list.querySelector('.dragging');
    if (!dragging) return;
    if (after == null) {
      list.appendChild(dragging);
    } else {
      list.insertBefore(dragging, after);
    }
  });

  function getDragAfterElement(container, y) {
    const els = [...container.querySelectorAll('.sort-item:not(.dragging)')];
    return els.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
  }

  form.appendChild(list);
}

export function readUserAnswer(form, q) {
  switch (q.type) {
    case 'true_false': {
      const v = form.querySelector('input[name="tf"]:checked');
      return v ? v.value === 'true' : null;
    }
    case 'mc_single': {
      const v = form.querySelector('input[name="mc_single"]:checked');
      return v ? Number(v.value) : null;
    }
    case 'mc_multi': {
      const values = Array.from(form.querySelectorAll('input[name="mc_multi"]:checked')).map(el => Number(el.value));
      values.sort((a,b)=>a-b);
      return values;
    }
    case 'fill_text': {
      const inp = form.querySelector('input[name="fill_text"]');
      return inp ? inp.value : '';
    }
    case 'fill_table': {
      const a = q.table.answers;
      const user = [];
      for (let r = 0; r < a.length; r++) {
        const row = [];
        for (let c = 0; c < a[r].length; c++) {
          const inp = form.querySelector(`input[name="cell_${r}_${c}"]`);
          row.push(inp ? inp.value : '');
        }
        user.push(row);
      }
      return user;
    }
    case 'sort': {
      const rows = Array.from(form.querySelectorAll('.sort-list .sort-item'));
      return rows.map(r => {
        const id = r.getAttribute('data-id');
        // Prefer numeric when possible for consistency
        const n = Number(id);
        return Number.isNaN(n) ? id : n;
      });
    }
    default:
      return null;
  }
}
