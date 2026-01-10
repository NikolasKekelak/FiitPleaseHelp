/*
Subnetting Practice Demo (VLSM-style)
Developer notes:
- IP conversion approach:
  IPv4 dotted decimal is converted to an unsigned 32-bit integer using big-endian composition: a.b.c.d -> (a<<24)|(b<<16)|(c<<8)|d.
  Reverse conversion extracts each octet by shifting and masking. All math uses unsigned >>> operations.
  Prefix to mask: mask = prefix === 0 ? 0 : (~0 >>> 0) << (32 - prefix) >>> 0; dotted by octets. Mask to prefix counts 1-bits.
- VLSM allocation approach:
  Given host requirements H_i (usable hosts), compute needed block size S_i as the smallest power of two with (2^h - 2) >= H_i, with h in [2..30].
  The corresponding prefix is P_i = 32 - h. Sort subnets by descending H_i (and then by index for stability) and allocate sequentially from the base network start, each at the next boundary multiple of its block size within the base.
  Verify each allocated subnet lies fully inside base range and does not overlap the previous one. Map results back to original row order.
- Validation rules:
  Accept IPs only in dotted decimal. Mask accepts either /xx or dotted decimal; normalize to prefix.
  Network and broadcast must match computed values for that row's allocated subnet.
  Router IP must strictly equal the system-chosen router IP for that row (chosen randomly from usable range, fixed per task).
  Per-cell correctness is shown independently. Overall score is (#correct cells) / (total answer cells).
*/
(function(){
  'use strict';

  // ---------- Utility: DOM helpers ----------
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  // ---------- Theme + background (reuse behavior from course pages) ----------
  (function initThemeAndBackground(){
    try {
      const raw = localStorage.getItem('mq_settings');
      const s = raw ? JSON.parse(raw) : {};
      const isDark = (s.themeDark === undefined ? true : !!s.themeDark);
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      document.documentElement.setAttribute('data-palette', s.palette || 'cozy');
      const layer = document.getElementById('bgLayer');
      if (layer) {
        const img = s.backgroundImage || '';
        const op = typeof s.backgroundOpacity === 'number' ? s.backgroundOpacity : 0.5;
        if (img) { layer.style.backgroundImage = `url('${img}')`; layer.style.opacity = String(Math.max(0, Math.min(1, op))); }
        else { layer.style.backgroundImage = 'none'; layer.style.opacity = '0'; }
      }
    } catch(_){}
  })();

  // ---------- Breadcrumb ----------
  (function initBreadcrumb(){
    try {
      const el = document.getElementById('courseBreadcrumb');
      if (!el) return;
      el.innerHTML = '';
      const aHome = document.createElement('a'); aHome.href='../../../../'; aHome.textContent='Home';
      const sep = document.createElement('span'); sep.textContent=' / ';
      const aCourse = document.createElement('a'); aCourse.href='../../#demos'; aCourse.textContent='pks';
      const sep2 = document.createElement('span'); sep2.textContent=' / ';
      const aDemo = document.createElement('a'); aDemo.href='./'; aDemo.textContent='Subnetting';
      el.append(aHome, sep, aCourse, sep2, aDemo);
    } catch(_){}
  })();

  // ---------- PRNG (mulberry32) ----------
  function mulberry32(a){
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function randInt(rng, min, max){ // inclusive min, inclusive max
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  // ---------- IP utils ----------
  const ipUtils = {
    toInt(ipStr){
      const parts = String(ipStr).trim().split('.');
      if (parts.length !== 4) return null;
      let n = 0;
      for (let i=0;i<4;i++){
        const v = Number(parts[i]);
        if (!Number.isInteger(v) || v < 0 || v > 255) return null;
        n = (n << 8) | v;
      }
      return n >>> 0;
    },
    toStr(n){
      n = n >>> 0;
      return [ (n>>>24)&255, (n>>>16)&255, (n>>>8)&255, n&255 ].join('.');
    },
    prefixToMask(prefix){
      prefix = Number(prefix);
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
      if (prefix === 0) return 0 >>> 0;
      const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
      return mask >>> 0;
    },
    maskToPrefix(mask){
      if (typeof mask === 'string'){
        const asInt = this.toInt(mask);
        if (asInt == null) return null;
        mask = asInt >>> 0;
      }
      mask = mask >>> 0;
      // count 1s from MSB; ensure it is contiguous ones then zeros
      let count = 0; let seenZero = false;
      for (let i=31;i>=0;i--){
        const bit = (mask >>> i) & 1;
        if (bit === 1){ if (seenZero) return null; count++; }
        else { seenZero = true; }
      }
      return count;
    },
    maskToStr(mask){
      if (typeof mask === 'number') mask = mask >>> 0;
      else mask = this.toInt(mask);
      if (mask == null) return null;
      return this.toStr(mask);
    },
    normalizeMaskToPrefix(value){
      value = String(value).trim();
      if (!value) return null;
      if (value.startsWith('/')){
        const p = Number(value.slice(1));
        if (!Number.isInteger(p)) return null;
        if (p < 0 || p > 32) return null;
        return p;
      }
      const p2 = this.maskToPrefix(value);
      return p2;
    }
  };

  // ---------- Subnet math ----------
  const subnetMath = {
    network(ip, prefix){
      const mask = ipUtils.prefixToMask(prefix);
      return (ip & mask) >>> 0;
    },
    broadcast(ip, prefix){
      const mask = ipUtils.prefixToMask(prefix);
      return ((ip & mask) | (~mask >>> 0)) >>> 0;
    },
    dottedMask(prefix){
      const m = ipUtils.prefixToMask(prefix);
      return ipUtils.toStr(m);
    },
    usableRange(ip, prefix){
      const net = this.network(ip, prefix);
      const bc = this.broadcast(ip, prefix);
      if (prefix >= 31) return { first: null, last: null, count: 0 };
      return { first: (net + 1) >>> 0, last: (bc - 1) >>> 0, count: Math.max(0, (bc - net + 1) - 2) };
    },
    // Smallest prefix that satisfies usable hosts >= H
    prefixForHosts(H){
      H = Math.max(0, Math.floor(H));
      if (H <= 0) return 32; // degenerate, but we will clamp higher up
      // Need size >= H + 2 (net+broadcast). Find h with 2^h >= H+2, where h in [2..32]
      let h = 0; let need = H + 2;
      while ((1 << h) < need && h <= 32) h++;
      let p = 32 - h;
      // Guard: if H >= 2, do not allow /31 or /32; min /30
      if (H >= 2 && p > 30) p = 30;
      if (p < 0) p = 0;
      return p;
    },
    // Align an address down to prefix boundary
    alignToPrefix(addr, prefix){
      const mask = ipUtils.prefixToMask(prefix);
      return (addr & mask) >>> 0;
    },
    // Given current pointer and desired block prefix, find next aligned start >= ptr
    nextAligned(ptr, prefix){
      const blockSize = 1 << (32 - prefix);
      const aligned = (ptr >>> 0) & ~((blockSize - 1) >>> 0);
      if (aligned === ptr) return ptr >>> 0;
      const next = (aligned + blockSize) >>> 0;
      return next >>> 0;
    }
  };

  // ---------- URL parameters & seeded RNG ----------
  function getUrlParams(){
    return new URLSearchParams(window.location.search);
  }
  function setUrlParams(params){
    const url = new URL(window.location.href);
    url.search = params.toString();
    history.replaceState(null, '', url.toString());
  }

  function ensureSeedAndK(){
    const params = getUrlParams();
    let seed = params.get('seed');
    let k = params.get('k');
    let changed = false;
    if (!seed){
      seed = String(Math.floor(Math.random()*2**31) ^ Date.now());
      params.set('seed', seed);
      changed = true;
    }
    if (!k){
      k = '4';
      params.set('k', k);
      changed = true;
    }
    if (changed) setUrlParams(params);
    return { seed: Number(seed) >>> 0, k: Math.max(2, Math.min(10, Number(k)||4)) };
  }

  // ---------- Generator ----------
  function chooseBasePrefix(rng){
    const choices = [22,23,24,25,26];
    return choices[randInt(rng, 0, choices.length-1)];
  }
  function choosePrivateBaseIp(rng, prefix){
    // pick a private block, then a random network aligned to prefix
    const blocks = [
      { base: ipUtils.toInt('10.0.0.0'), p: 8 },
      { base: ipUtils.toInt('172.16.0.0'), p: 12 },
      { base: ipUtils.toInt('192.168.0.0'), p: 16 },
    ];
    const b = blocks[randInt(rng, 0, blocks.length-1)];
    const blockSize = 1 << (32 - prefix);
    const maxInBlock = 1 << (32 - b.p);
    // number of prefix-sized networks inside selected private block
    const count = Math.max(1, Math.floor(maxInBlock / blockSize));
    const idx = randInt(rng, 0, count-1);
    return (b.base + idx * blockSize) >>> 0;
  }

  function generateHostRequirements(rng, k, basePrefix){
    // Aim for varied sizes that fit the base capacity
    const baseSize = 1 << (32 - basePrefix);
    let remaining = baseSize;
    const req = [];
    // heuristic buckets
    const bucketSizes = [2, 6, 14, 30, 62, 126, 254, 510, 1022]; // typical usable counts
    for (let i=0;i<k;i++){
      // pick a bucket biased to small/medium
      const idx = Math.min(bucketSizes.length-1, Math.floor(Math.pow(rng(), 1.7) * bucketSizes.length));
      let h = bucketSizes[idx];
      // Ensure feasible upper bound for remaining capacity
      const maxUsableIfAll = Math.max(0, remaining - 2*(k-i)); // rough conservative
      if (maxUsableIfAll <= 0){ h = 2; }
      else h = Math.min(h, Math.max(2, maxUsableIfAll));
      req.push(h);
      // Don't decrease remaining here; we validate after rounding to power-of-two during allocation
    }
    return req;
  }

  function vlsmAllocate(rng, baseNet, basePrefix, pcsNeededArr){
    const baseEnd = subnetMath.broadcast(baseNet, basePrefix);
    const k = pcsNeededArr.length;
    const items = pcsNeededArr.map((h, i) => ({ i, h, p: subnetMath.prefixForHosts(h) }));
    // sort descending by host requirement, then by index
    items.sort((a,b)=> (b.h - a.h) || (a.i - b.i));
    let ptr = baseNet;
    const allocDesc = [];
    for (const it of items){
      // find aligned start at it.p
      let start = subnetMath.nextAligned(ptr, it.p);
      if (start < baseNet) start = subnetMath.alignToPrefix(ptr, it.p);
      const end = subnetMath.broadcast(start, it.p);
      // move ptr to end+1 for next iteration
      ptr = (end + 1) >>> 0;
      // check in-range and non-overlap
      if (end > baseEnd){ return null; }
      allocDesc.push({ i: it.i, h: it.h, p: it.p, start, end });
    }
    // map back to original order
    const byOrig = Array(k);
    for (const a of allocDesc){
      // choose router IP randomly in usable range
      const usable = subnetMath.usableRange(a.start, a.p);
      let router = null;
      if (usable.count > 0){
        const offset = randInt(rng, 0, usable.count - 1);
        router = (usable.first + offset) >>> 0;
      }
      byOrig[a.i] = {
        h: a.h, prefix: a.p, network: a.start, broadcast: a.end,
        maskStr: subnetMath.dottedMask(a.p), router,
        usableFirst: usable.first, usableLast: usable.last
      };
    }
    return byOrig;
  }

  function generateTask(rng, k){
    let tries = 0;
    while (tries++ < 50){
      const basePrefix = chooseBasePrefix(rng);
      const baseNetwork = choosePrivateBaseIp(rng, basePrefix);
      const req = generateHostRequirements(rng, k, basePrefix);
      const alloc = vlsmAllocate(rng, baseNetwork, basePrefix, req);
      if (alloc){
        return { baseNetwork, basePrefix, baseMaskStr: subnetMath.dottedMask(basePrefix), subnets: alloc };
      }
    }
    throw new Error('Failed to generate a feasible task');
  }

  // ---------- UI rendering and logic ----------
  const state = {
    seed: 0,
    rng: null,
    k: 4,
    task: null,
    userInputs: null, // preserve between show solution toggles
    showSolution: false,
  };

  function formatRange(net, bc){
    return `${ipUtils.toStr(net)} – ${ipUtils.toStr(bc)}`;
  }

  function renderBaseCard(){
    const baseNet = state.task.baseNetwork;
    const basePrefix = state.task.basePrefix;
    $('#baseNet').textContent = ipUtils.toStr(baseNet);
    $('#basePrefix').textContent = `/${basePrefix}`;
    $('#baseMask').textContent = state.task.baseMaskStr;
    const bc = subnetMath.broadcast(baseNet, basePrefix);
    $('#baseRange').textContent = formatRange(baseNet, bc);
  }

  function buildTable(){
    const tbody = $('#answerTable tbody');
    tbody.innerHTML = '';
    for (let i=0;i<state.k;i++){
      const tr = document.createElement('tr');
      const cIdx = document.createElement('td'); cIdx.textContent = `N${i+1}`;
      const cPcs = document.createElement('td'); cPcs.innerHTML = `<span class="ro" id="pcs-${i}"></span>`;
      const cNet = document.createElement('td'); cNet.innerHTML = `<input type="text" id="net-${i}" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="e.g., 192.168.1.0">`;
      const cMask = document.createElement('td'); cMask.innerHTML = `<input type="text" id="mask-${i}" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="/24 or 255.255.255.0">`;
      const cBc = document.createElement('td'); cBc.innerHTML = `<input type="text" id="bc-${i}" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="e.g., 192.168.1.255">`;
      const cRouter = document.createElement('td'); cRouter.innerHTML = `<input type="text" id="rtr-${i}" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="any usable host">`;
      const cStatus = document.createElement('td'); cStatus.id = `status-${i}`; cStatus.textContent = '';
      tr.append(cIdx, cPcs, cNet, cMask, cBc, cRouter, cStatus);
      tbody.appendChild(tr);
    }
  }

  function fillPcs(){
    for (let i=0;i<state.k;i++){
      const span = $(`#pcs-${i}`);
      span.textContent = String(state.task.subnets[i].h);
    }
  }

  function clearValidation(){
    $$('#answerTable td').forEach(td=>{
      td.classList.remove('cell-ok','cell-bad');
    });
    $('#scoreBox').textContent = '';
    for (let i=0;i<state.k;i++){
      const st = $(`#status-${i}`); if (st) st.textContent = '';
    }
  }

  function saveUserInputs(){
    const inputs = [];
    for (let i=0;i<state.k;i++){
      inputs.push({
        net: $(`#net-${i}`).value.trim(),
        mask: $(`#mask-${i}`).value.trim(),
        bc: $(`#bc-${i}`).value.trim(),
        rtr: $(`#rtr-${i}`).value.trim(),
      });
    }
    state.userInputs = inputs;
  }
  function restoreUserInputs(){
    if (!state.userInputs) return;
    for (let i=0;i<state.k;i++){
      $(`#net-${i}`).value = state.userInputs[i]?.net || '';
      $(`#mask-${i}`).value = state.userInputs[i]?.mask || '';
      $(`#bc-${i}`).value = state.userInputs[i]?.bc || '';
      $(`#rtr-${i}`).value = state.userInputs[i]?.rtr || '';
    }
  }

  function populateSolution(overwrite){
    for (let i=0;i<state.k;i++){
      const s = state.task.subnets[i];
      if (overwrite){
        $(`#net-${i}`).value = ipUtils.toStr(s.network);
        $(`#mask-${i}`).value = `/${s.prefix}`; // consistent formatting
        $(`#bc-${i}`).value = ipUtils.toStr(s.broadcast);
        $(`#rtr-${i}`).value = s.router ? ipUtils.toStr(s.router) : '';
      } else {
        // show solution as placeholders if not overwriting
        $(`#net-${i}`).placeholder = ipUtils.toStr(s.network);
        $(`#mask-${i}`).placeholder = `/${s.prefix}`;
        $(`#bc-${i}`).placeholder = ipUtils.toStr(s.broadcast);
        $(`#rtr-${i}`).placeholder = s.router ? ipUtils.toStr(s.router) : '';
      }
    }
  }

  function resetInputs(){
    for (let i=0;i<state.k;i++){
      $(`#net-${i}`).value = '';
      $(`#mask-${i}`).value = '';
      $(`#bc-${i}`).value = '';
      $(`#rtr-${i}`).value = '';
    }
    clearValidation();
  }

  function checkAnswers(){
    let correctCells = 0; let totalCells = 0;
    for (let i=0;i<state.k;i++){
      const s = state.task.subnets[i];
      const tdNet = $(`#net-${i}`).parentElement;
      const tdMask = $(`#mask-${i}`).parentElement;
      const tdBc = $(`#bc-${i}`).parentElement;
      const tdRtr = $(`#rtr-${i}`).parentElement;
      const st = $(`#status-${i}`);
      // reset
      [tdNet, tdMask, tdBc, tdRtr].forEach(td=> td.classList.remove('cell-ok','cell-bad'));

      // normalize inputs
      const userNet = ipUtils.toInt($(`#net-${i}`).value.trim());
      const userBc = ipUtils.toInt($(`#bc-${i}`).value.trim());
      const userMaskPref = ipUtils.normalizeMaskToPrefix($(`#mask-${i}`).value.trim());
      const userRtr = ipUtils.toInt($(`#rtr-${i}`).value.trim());

      // Network
      let okNet = (userNet != null && userNet === s.network);
      totalCells++;
      tdNet.classList.add(okNet ? 'cell-ok' : 'cell-bad');
      if (okNet) correctCells++;

      // Mask/prefix
      let okMask = (userMaskPref != null && userMaskPref === s.prefix);
      totalCells++;
      tdMask.classList.add(okMask ? 'cell-ok' : 'cell-bad');
      if (okMask) correctCells++;

      // Broadcast
      let okBc = (userBc != null && userBc === s.broadcast);
      totalCells++;
      tdBc.classList.add(okBc ? 'cell-ok' : 'cell-bad');
      if (okBc) correctCells++;

      // Router IP (strict equal to chosen router)
      let okRtr = (s.router != null && userRtr != null && userRtr === s.router);
      totalCells++;
      tdRtr.classList.add(okRtr ? 'cell-ok' : 'cell-bad');
      if (okRtr) correctCells++;

      const rowOk = okNet && okMask && okBc && okRtr;
      st.textContent = rowOk ? 'OK' : '—';
    }
    const pct = totalCells ? Math.round((correctCells / totalCells) * 100) : 0;
    $('#scoreBox').textContent = `Score: ${correctCells}/${totalCells} (${pct}%)`;
  }

  function renderApp(){
    renderBaseCard();
    buildTable();
    fillPcs();
    clearValidation();
    if (state.showSolution){ populateSolution(false); }
  }

  function regenerate(withNewSeed){
    // persist k in URL
    const params = getUrlParams();
    params.set('k', String(state.k));
    if (withNewSeed){
      const newSeed = String(Math.floor(Math.random()*2**31) ^ Date.now());
      params.set('seed', newSeed);
      setUrlParams(params);
      state.seed = Number(newSeed) >>> 0;
    } else {
      setUrlParams(params);
    }
    state.rng = mulberry32(state.seed);
    state.task = generateTask(state.rng, state.k);
    state.userInputs = null;
    renderApp();
  }

  function initControls(){
    const kSlider = $('#kSlider');
    const kVal = $('#kVal');
    const params = getUrlParams();
    kSlider.value = String(state.k);
    kVal.textContent = String(state.k);
    kSlider.addEventListener('input', () => {
      const newK = Math.max(2, Math.min(10, Number(kSlider.value)||4));
      state.k = newK;
      kVal.textContent = String(newK);
      params.set('k', String(newK));
      setUrlParams(params);
      // rebuild task to ensure feasibility for changed k
      state.task = generateTask(state.rng, state.k);
      renderApp();
    });

    $('#btnRegenerate').addEventListener('click', ()=>{
      regenerate(true);
    });
    $('#btnReset').addEventListener('click', ()=>{
      resetInputs();
    });
    $('#btnCheck').addEventListener('click', ()=>{
      checkAnswers();
    });

    let showing = false;
    $('#btnShowSolution').addEventListener('click', ()=>{
      if (!showing){
        saveUserInputs();
        populateSolution(true); // overwrite to show final answers
        showing = true; state.showSolution = true;
        $('#btnShowSolution').textContent = 'Restore my inputs';
      } else {
        restoreUserInputs();
        showing = false; state.showSolution = false;
        $('#btnShowSolution').textContent = 'Show solution';
      }
      clearValidation();
    });
  }

  function main(){
    const { seed, k } = ensureSeedAndK();
    state.seed = seed; state.k = k;
    state.rng = mulberry32(seed);
    initControls();
    state.task = generateTask(state.rng, state.k);
    renderApp();
    // Reflect initial k in UI
    $('#kSlider').value = String(state.k);
    $('#kVal').textContent = String(state.k);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main, { once: true });
  else main();
})();
