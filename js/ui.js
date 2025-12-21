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
    default:
      return null;
  }
}
