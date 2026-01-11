// Connect Nodes question type: renderer + evaluator + normalization
// Public API:
//  - normalizeConnectNodesQuestion(raw)
//  - evaluateConnectNodes(q, userState) -> { correct: boolean, meta: { details } }
//  - renderConnectNodesQuestion(form, q)

function uid(prefix, i) { return `${prefix}${i + 1}`; }

export function normalizeConnectNodesQuestion(raw) {
  const q = JSON.parse(JSON.stringify(raw));
  // Normalize nodes to objects with stable ids
  const toNodeObjs = (arr, pref) => {
    if (!Array.isArray(arr)) return [];
    if (arr.length && typeof arr[0] === 'string') {
      return arr.map((label, i) => ({ id: uid(pref, i), label: String(label) }));
    }
    // sanitize provided nodes
    const ids = new Set();
    return arr.map((n, i) => {
      const id = String(n.id ?? uid(pref, i));
      const label = String(n.label ?? n.text ?? '');
      // ensure uniqueness of id
      let finalId = id;
      let k = 2;
      while (ids.has(finalId)) { finalId = `${id}_${k++}`; }
      ids.add(finalId);
      return { id: finalId, label };
    });
  };

  q.leftNodes = toNodeObjs(q.leftNodes || [], 'l');
  q.rightNodes = toNodeObjs(q.rightNodes || [], 'r');

  // Build lookup maps by label (trimmed, case-sensitive by default as per project behavior)
  const leftByLabel = new Map(q.leftNodes.map(n => [String(n.label).trim(), n.id]));
  const rightByLabel = new Map(q.rightNodes.map(n => [String(n.label).trim(), n.id]));

  // Normalize correctPairs to ids
  const pairs = Array.isArray(q.correctPairs) ? q.correctPairs : [];
  q.correctPairs = pairs.map(p => {
    // Accept either {leftId,rightId} or {left,right} by labels
    if (p.leftId && p.rightId) return { leftId: String(p.leftId), rightId: String(p.rightId) };
    const leftId = leftByLabel.get(String(p.left ?? '').trim());
    const rightId = rightByLabel.get(String(p.right ?? '').trim());
    return { leftId, rightId };
  }).filter(p => p.leftId && p.rightId);

  // Enforce one-to-one uniqueness in correctPairs (last wins)
  const usedL = new Set();
  const usedR = new Set();
  const unique = [];
  for (const p of q.correctPairs) {
    if (usedL.has(p.leftId) || usedR.has(p.rightId)) continue;
    usedL.add(p.leftId); usedR.add(p.rightId); unique.push(p);
  }
  q.correctPairs = unique;
  return q;
}

export function evaluateConnectNodes(q, userState) {
  // userState: { connections: Array<{leftId,rightId}> }
  const normQ = normalizeConnectNodesQuestion(q);
  const corrSet = new Set(normQ.correctPairs.map(p => `${p.leftId}=>${p.rightId}`));
  const uaPairs = Array.isArray(userState && userState.connections) ? userState.connections : [];

  // Coerce to ids and enforce one-to-one in UA (later pairs override earlier)
  const latestByL = new Map();
  const latestByR = new Map();
  for (const p of uaPairs) {
    const l = String(p.leftId || '');
    const r = String(p.rightId || '');
    if (!l || !r) continue;
    // Remove reverse mapping if reassigning
    if (latestByL.has(l)) {
      const prevR = latestByL.get(l);
      if (latestByR.get(prevR) === l) latestByR.delete(prevR);
    }
    if (latestByR.has(r)) {
      const prevL = latestByR.get(r);
      if (latestByL.get(prevL) === r) latestByL.delete(prevL);
    }
    latestByL.set(l, r);
    latestByR.set(r, l);
  }
  const uaSet = new Set(Array.from(latestByL.entries()).map(([l, r]) => `${l}=>${r}`));

  const isExactMatch = uaSet.size === corrSet.size && [...uaSet].every(s => corrSet.has(s));

  // Per-connection correctness for partial feedback
  const details = Array.from(uaSet).map(s => ({ pair: s, correct: corrSet.has(s) }));

  return { correct: isExactMatch, meta: { details } };
}

// ---- Renderer ----
// The renderer attaches state to the form element under __connectNodesState
// readUserAnswer will read it back.

export function renderConnectNodesQuestion(form, rawQ) {
  const q = normalizeConnectNodesQuestion(rawQ);
  form.innerHTML = '';
  form.classList.add('cn-form');

  // Container
  const container = document.createElement('div');
  container.className = 'cn-container';

  const guidance = document.createElement('div');
  guidance.className = 'cn-guidance';
  guidance.textContent = 'Select a node on the left, then a matching node on the right.';

  // Columns
  const grid = document.createElement('div');
  grid.className = 'cn-grid';

  const leftCol = document.createElement('div');
  leftCol.className = 'cn-col cn-left';
  const rightCol = document.createElement('div');
  rightCol.className = 'cn-col cn-right';

  const leftList = document.createElement('ul'); leftList.className = 'cn-list';
  const rightList = document.createElement('ul'); rightList.className = 'cn-list';

  leftCol.appendChild(leftList); rightCol.appendChild(rightList);

  grid.appendChild(leftCol); grid.appendChild(rightCol);

  // SVG overlay for connections
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'cn-svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');

  container.appendChild(guidance);
  container.appendChild(grid);
  container.appendChild(svg);
  form.appendChild(container);

  // State
  const state = {
    selected: null, // { side: 'left'|'right', id }
    connections: new Map(), // leftId -> rightId
    reverse: new Map(),     // rightId -> leftId
  };
  form.__connectNodesState = state;

  // Create list items
  const makeNode = (side, node) => {
    const li = document.createElement('li');
    li.className = 'cn-node';
    li.tabIndex = 0;
    li.dataset.side = side;
    li.dataset.id = node.id;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', `${side === 'left' ? 'Left node' : 'Right node'}: ${node.label}`);
    li.textContent = node.label;

    const clearBtn = document.createElement('button');
    clearBtn.className = 'cn-clear';
    clearBtn.type = 'button';
    clearBtn.title = 'Clear connection';
    clearBtn.textContent = '×';
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = node.id;
      if (side === 'left') {
        const r = state.connections.get(id);
        if (r) { state.connections.delete(id); if (state.reverse.get(r) === id) state.reverse.delete(r); }
      } else {
        const l = state.reverse.get(id);
        if (l) { state.reverse.delete(id); if (state.connections.get(l) === id) state.connections.delete(l); }
      }
      draw();
      updateUi();
    });
    li.appendChild(clearBtn);

    const select = () => {
      const s = state.selected;
      if (!s) {
        state.selected = { side, id: node.id };
        updateUi();
        guidance.textContent = 'Now choose a node on the other side to connect.';
        return;
      }
      if (s.side === side) {
        // Toggle selection if same side
        state.selected = (s.id === node.id) ? null : { side, id: node.id };
        updateUi();
        guidance.textContent = state.selected ? 'Now choose a node on the other side to connect.' : 'Select a node on the left, then a matching node on the right.';
        return;
      }
      // Different sides -> create/move connection
      let leftId, rightId;
      if (side === 'left') { leftId = node.id; rightId = s.id; } else { leftId = s.id; rightId = node.id; }
      // Reassign to keep one-to-one
      const prevR = state.connections.get(leftId);
      if (prevR && state.reverse.get(prevR) === leftId) state.reverse.delete(prevR);
      const prevL = state.reverse.get(rightId);
      if (prevL && state.connections.get(prevL) === rightId) state.connections.delete(prevL);
      state.connections.set(leftId, rightId);
      state.reverse.set(rightId, leftId);
      state.selected = null;
      updateUi();
      draw();
      guidance.textContent = 'Select a node on the left, then a matching node on the right.';
    };

    li.addEventListener('click', select);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
    });

    return li;
  };

  q.leftNodes.forEach(n => leftList.appendChild(makeNode('left', n)));
  q.rightNodes.forEach(n => rightList.appendChild(makeNode('right', n)));

  // Reset button
  const actions = document.createElement('div');
  actions.className = 'cn-actions';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', () => {
    state.connections.clear();
    state.reverse.clear();
    state.selected = null;
    draw();
    updateUi();
  });
  actions.appendChild(resetBtn);
  container.appendChild(actions);

  function updateUi() {
    const sel = state.selected;
    for (const el of container.querySelectorAll('.cn-node')) {
      el.classList.remove('selected');
      const side = el.dataset.side; const id = el.dataset.id;
      if (sel && sel.side === side && sel.id === id) el.classList.add('selected');
      // Mark connected
      const connected = side === 'left' ? state.connections.has(id) : state.reverse.has(id);
      el.classList.toggle('connected', !!connected);
    }
  }

  function centerPoint(el) {
    const rect = el.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - svgRect.left, y: rect.top + rect.height / 2 - svgRect.top };
  }

  function draw() {
    // Resize svg to container bounds
    const gRect = grid.getBoundingClientRect();
    svg.setAttribute('width', String(gRect.width));
    svg.setAttribute('height', String(gRect.height));
    svg.setAttribute('viewBox', `0 0 ${gRect.width} ${gRect.height}`);

    // Clear
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // Draw each connection
    state.connections.forEach((rightId, leftId) => {
      const leftEl = leftList.querySelector(`.cn-node[data-id="${CSS.escape(leftId)}"]`);
      const rightEl = rightList.querySelector(`.cn-node[data-id="${CSS.escape(rightId)}"]`);
      if (!leftEl || !rightEl) return;
      const p1 = centerPoint(leftEl);
      const p2 = centerPoint(rightEl);
      // Create smooth path (cubic bezier)
      const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.35);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`);
      path.setAttribute('class', 'cn-link');
      svg.appendChild(path);
    });
  }

  // Resize/scroll redraw handling
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => requestAnimationFrame(draw)) : null;
  if (ro) {
    ro.observe(container);
    ro.observe(grid);
    ro.observe(leftList);
    ro.observe(rightList);
  }
  const onScroll = () => requestAnimationFrame(draw);
  window.addEventListener('resize', onScroll);
  document.addEventListener('scroll', onScroll, true);

  // Cleanup when form is removed (best-effort)
  const observer = new MutationObserver(() => {
    if (!document.body.contains(form)) {
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('scroll', onScroll, true);
      if (ro) ro.disconnect();
      observer.disconnect();
    }
  });
  observer.observe(document, { childList: true, subtree: true });

  // Initial draw
  updateUi();
  requestAnimationFrame(draw);
}
