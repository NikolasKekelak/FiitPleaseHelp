// Lightweight authoring editor for connect_nodes
// This page is standalone at /tools/editor.html
import { renderConnectNodesQuestion, normalizeConnectNodesQuestion } from './connect-nodes.js';

const root = document.getElementById('editorRoot');
const typeSelect = document.getElementById('typeSelect');

const state = {
  type: 'connect_nodes',
  id: 'q1',
  question: 'Match items',
  explanation: '',
  leftNodes: [{ id: 'l1', label: 'A' }, { id: 'l2', label: 'B' }],
  rightNodes: [{ id: 'r1', label: '1' }, { id: 'r2', label: '2' }],
  correctPairs: [],
};

function uid(prefix, arr) {
  let i = arr.length + 1;
  let id = `${prefix}${i}`;
  const used = new Set(arr.map(n => n.id));
  while (used.has(id)) { i += 1; id = `${prefix}${i}`; }
  return id;
}

function buildEditor() {
  root.innerHTML = '';

  // Left pane: form
  const paneL = document.createElement('div');
  paneL.className = 'pane';
  const paneR = document.createElement('div');
  paneR.className = 'pane';

  // Fields common
  const fldId = field('ID', inputText('id', state.id, (v)=>{ state.id = v.trim(); renderPreview(); }));
  const fldQ = field('Question', textarea('question', state.question, (v)=>{ state.question = v; renderPreview(); }));
  const fldE = field('Explanation (optional)', textarea('explanation', state.explanation, (v)=>{ state.explanation = v; }));

  paneL.appendChild(fldId);
  paneL.appendChild(fldQ);
  paneL.appendChild(fldE);

  // Nodes editor
  const nodesWrap = document.createElement('div');
  nodesWrap.className = 'nodes-columns';

  nodesWrap.appendChild(nodesColumn('Left nodes', 'left', state.leftNodes));
  nodesWrap.appendChild(nodesColumn('Right nodes', 'right', state.rightNodes));

  paneL.appendChild(nodesWrap);

  // Pairs editor
  const pairsBox = document.createElement('div');
  pairsBox.className = 'field';
  const title = document.createElement('div'); title.textContent = 'Correct pairs'; title.style.fontWeight = '600';
  const helper = document.createElement('div'); helper.className = 'muted'; helper.textContent = 'Click "Pair mode" then click a left and a right node to add a pair.';
  pairsBox.appendChild(title); pairsBox.appendChild(helper);

  const pairModeBtn = document.createElement('button');
  pairModeBtn.type = 'button'; pairModeBtn.className = 'btn'; pairModeBtn.textContent = 'Pair mode';
  let pairing = null; // { side, id }

  const list = document.createElement('div'); list.className = 'list'; list.style.marginTop = '8px';

  function refreshPairsList() {
    list.innerHTML = '';
    state.correctPairs.forEach((p, idx) => {
      const row = document.createElement('div'); row.className = 'row';
      const l = state.leftNodes.find(n => n.id === p.leftId); const r = state.rightNodes.find(n => n.id === p.rightId);
      const label = document.createElement('div'); label.textContent = `${l ? l.label : p.leftId} ↔ ${r ? r.label : p.rightId}`;
      const del = document.createElement('button'); del.type='button'; del.className='btn'; del.textContent='Delete';
      del.addEventListener('click', ()=>{ state.correctPairs.splice(idx,1); refreshPairsList(); renderPreview(); });
      row.appendChild(label); row.appendChild(del);
      list.appendChild(row);
    });
  }

  function setPairMode(active) {
    if (active) {
      pairing = { side: null, id: null };
      pairModeBtn.classList.add('primary');
      pairModeBtn.textContent = 'Pair mode: ON';
    } else {
      pairing = null;
      pairModeBtn.classList.remove('primary');
      pairModeBtn.textContent = 'Pair mode';
    }
  }

  pairModeBtn.addEventListener('click', ()=>{
    setPairMode(!pairing);
  });

  pairsBox.appendChild(pairModeBtn);
  pairsBox.appendChild(list);
  paneL.appendChild(pairsBox);

  // Validation + JSON output
  const outBox = document.createElement('div'); outBox.className = 'field';
  const valDiv = document.createElement('div'); valDiv.className = 'muted';
  const jsonArea = document.createElement('textarea'); jsonArea.readOnly = true; jsonArea.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  outBox.appendChild(valDiv); outBox.appendChild(jsonArea);
  paneL.appendChild(outBox);

  // Right pane: Live Preview
  const prevTitle = document.createElement('h3'); prevTitle.textContent = 'Preview';
  const prevForm = document.createElement('form'); prevForm.className = 'answer-area';
  paneR.appendChild(prevTitle);
  paneR.appendChild(prevForm);

  root.appendChild(paneL);
  root.appendChild(paneR);

  // Node item click handling for pair mode
  function attachPairingHandlers(container) {
    container.addEventListener('click', (e) => {
      if (!pairing) return;
      const btn = e.target.closest('button[data-node-id]');
      if (!btn) return;
      const side = btn.dataset.side; const id = btn.dataset.nodeId;
      if (!pairing.side) {
        pairing.side = side; pairing.id = id; btn.classList.add('primary'); setTimeout(()=>btn.classList.remove('primary'), 200);
      } else if (pairing.side !== side) {
        // finalize pair
        const leftId = pairing.side === 'left' ? pairing.id : id;
        const rightId = pairing.side === 'right' ? pairing.id : id;
        // enforce one-to-one: remove existing pairs with same left/right
        state.correctPairs = state.correctPairs.filter(p => p.leftId !== leftId && p.rightId !== rightId);
        state.correctPairs.push({ leftId, rightId });
        pairing = null; setPairMode(false);
        refreshPairsList(); renderPreview();
      } else {
        // same side -> restart
        pairing = { side: side, id };
      }
    });
  }

  // Build nodes columns after appending so we can attach events
  const leftCol = nodesWrap.children[0]; const rightCol = nodesWrap.children[1];
  attachPairingHandlers(leftCol); attachPairingHandlers(rightCol);

  function validate() {
    const problems = [];
    const dup = (arr) => {
      const seen = new Set(); const dups = new Set();
      arr.forEach(n => { const key = String(n.label).trim(); if (seen.has(key)) dups.add(key); seen.add(key); });
      return Array.from(dups);
    };
    const dL = dup(state.leftNodes);
    const dR = dup(state.rightNodes);
    if (dL.length) problems.push(`Duplicate left labels: ${dL.join(', ')}`);
    if (dR.length) problems.push(`Duplicate right labels: ${dR.join(', ')}`);
    // Pairs reference check
    const leftIds = new Set(state.leftNodes.map(n => n.id));
    const rightIds = new Set(state.rightNodes.map(n => n.id));
    for (const p of state.correctPairs) {
      if (!leftIds.has(p.leftId) || !rightIds.has(p.rightId)) problems.push(`Dangling pair: ${p.leftId} ↔ ${p.rightId}`);
    }
    // One-to-one check
    const usedL = new Set(); const usedR = new Set();
    for (const p of state.correctPairs) {
      if (usedL.has(p.leftId)) problems.push(`Left node used multiple times: ${p.leftId}`);
      if (usedR.has(p.rightId)) problems.push(`Right node used multiple times: ${p.rightId}`);
      usedL.add(p.leftId); usedR.add(p.rightId);
    }
    return problems;
  }

  function renderPreview() {
    // Normalize for preview consumption (renderer tolerates variation)
    const q = normalizeConnectNodesQuestion({ ...state });
    // Show JSON
    const out = {
      id: state.id,
      type: 'connect_nodes',
      question: state.question,
      explanation: state.explanation,
      leftNodes: q.leftNodes,
      rightNodes: q.rightNodes,
      correctPairs: q.correctPairs,
    };
    jsonArea.value = JSON.stringify(out, null, 2);
    const problems = validate();
    valDiv.textContent = problems.length ? `Validation: ${problems.join(' | ')}` : 'Validation: OK';
    // Preview
    prevForm.innerHTML = '';
    renderConnectNodesQuestion(prevForm, out);
  }

  refreshPairsList();
  renderPreview();
}

function nodesColumn(title, side, arr) {
  const box = document.createElement('div'); box.className = 'field';
  const h = document.createElement('div'); h.textContent = title; h.style.fontWeight = '600';
  const list = document.createElement('div'); list.className = 'list';
  const addBtn = document.createElement('button'); addBtn.type='button'; addBtn.className='btn'; addBtn.textContent = `Add ${side === 'left' ? 'left' : 'right'} node`;
  addBtn.addEventListener('click', () => {
    const id = uid(side === 'left' ? 'l' : 'r', arr);
    arr.push({ id, label: side === 'left' ? `L${arr.length+1}` : `R${arr.length+1}` });
    refresh();
  });
  box.appendChild(h);
  box.appendChild(list);
  box.appendChild(addBtn);

  function refresh() {
    list.innerHTML = '';
    arr.forEach((node, idx) => {
      const row = document.createElement('div'); row.className='node-item';
      const btn = document.createElement('button'); btn.type='button'; btn.className='btn'; btn.textContent='●'; btn.title='Use in Pair mode'; btn.dataset.nodeId = node.id; btn.dataset.side = side;
      const input = document.createElement('input'); input.type='text'; input.value = node.label; input.addEventListener('input', ()=>{ node.label = input.value; renderPreview(); });
      const del = document.createElement('button'); del.type='button'; del.className='btn'; del.textContent='Delete';
      del.addEventListener('click', ()=>{
        // remove node and any pairs
        arr.splice(idx,1);
        state.correctPairs = state.correctPairs.filter(p => (side==='left'? p.leftId!==node.id : p.rightId!==node.id));
        refresh();
      });
      row.appendChild(btn);
      row.appendChild(input);
      row.appendChild(del);
      list.appendChild(row);
    });
    renderPreview();
  }

  // expose refresh for outer calls
  box.refresh = refresh;
  refresh();
  return box;
}

function field(labelText, control) {
  const wrap = document.createElement('div'); wrap.className = 'field';
  const lbl = document.createElement('label'); lbl.textContent = labelText;
  wrap.appendChild(lbl); wrap.appendChild(control);
  return wrap;
}

function inputText(name, val, onChange) {
  const input = document.createElement('input'); input.type='text'; input.name=name; input.value=val;
  input.addEventListener('input', ()=> onChange(input.value));
  return input;
}

function textarea(name, val, onChange) {
  const ta = document.createElement('textarea'); ta.name=name; ta.value=val;
  ta.addEventListener('input', ()=> onChange(ta.value));
  return ta;
}

buildEditor();
