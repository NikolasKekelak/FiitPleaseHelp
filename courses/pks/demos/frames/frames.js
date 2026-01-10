/*
Frame Analysis Demo (Analyze + Build)
Developer notes:
- Hexdump policy: Ethernet preamble/SFD and FCS are EXCLUDED from all dumps and validation.
- Checksums policy (v1):
  • IPv4 header checksum is computed and validated.
  • UDP/TCP checksums are set to 0; we DO NOT ask checksum questions for them in v1.
  • ICMP checksum: implemented for Echo; if disabled, skip related questions.
- Seed RNG: deterministic mulberry32 via ?seed=...; if missing, one is generated and injected via history.replaceState.

Architecture (single-file modules):
- rng: seeded PRNG helpers
- hexUtils: bytes<->hex, Wireshark-like dump (offsets, ASCII)
- macUtils: parse/format MAC
- ipUtils: IPv4 parse/format, checksum
- protocols: ethernet, ipv4, udp, tcp, icmp, arp (encode/decode)
- taskGenerator: curated seeded frames + build tasks
- questionBank/validator: derive/validate answers from bytes
- ui: tabs, hexdump, decoded tree, questions; build form; controls
*/
(function(){
  'use strict';

  // ---------- DOM helpers ----------
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  // ---------- Theme + background ----------
  (function initTheme(){
    try {
      const raw = localStorage.getItem('mq_settings');
      const s = raw ? JSON.parse(raw) : {};
      document.documentElement.setAttribute('data-theme', s.themeDark ? 'dark' : 'light');
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
      const aDemo = document.createElement('a'); aDemo.href='./'; aDemo.textContent='Frame Analysis';
      el.append(aHome, sep, aCourse, sep2, aDemo);
    } catch(_){}
  })();

  // ---------- RNG ----------
  function mulberry32(a){
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function randInt(rng, min, max){ return Math.floor(rng()*(max-min+1))+min; }
  function getUrlParams(){ return new URLSearchParams(window.location.search); }
  function setUrlParams(params){ const url = new URL(window.location.href); url.search = params.toString(); history.replaceState(null, '', url.toString()); }
  function ensureSeed(){
    const params = getUrlParams();
    let seed = params.get('seed');
    if (!seed){ seed = String((Math.random()*2**31) ^ Date.now() ^ Math.floor(performance.now()*1000)); params.set('seed', seed); setUrlParams(params); }
    return Number(seed) >>> 0;
  }
  function ensureIndex(){
    const params = getUrlParams();
    let idx = params.get('idx');
    if (idx == null){ idx = '0'; params.set('idx', idx); setUrlParams(params); }
    return Math.max(0, Number(idx)||0);
  }

  // ---------- hexUtils ----------
  const hexUtils = {
    toHex(n){ n = n & 0xFF; return n.toString(16).padStart(2,'0'); },
    bytesToHexArr(bytes){ return Array.from(bytes, b => this.toHex(b)); },
    isPrintable(b){ return b >= 0x20 && b <= 0x7E; },
    renderDump(container, bytes){
      container.innerHTML = '';
      const arr = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes||[]);
      for (let off=0; off<arr.length; off+=16){
        const row = document.createElement('div'); row.className = 'hex-row';
        const colOff = document.createElement('div'); colOff.className = 'hex-off'; colOff.textContent = off.toString(16).padStart(4,'0');
        const colHex = document.createElement('div'); colHex.className = 'hex-bytes';
        const colAsc = document.createElement('div'); colAsc.className = 'hex-asc';
        let ascii = '';
        for (let i=0;i<16;i++){
          const idx = off+i;
          const cell = document.createElement('span'); cell.className = 'byte';
          if (idx < arr.length){
            const b = arr[idx];
            cell.textContent = this.toHex(b);
            ascii += this.isPrintable(b) ? String.fromCharCode(b) : '.';
          } else {
            cell.textContent = '  ';
            ascii += ' ';
          }
          colHex.appendChild(cell);
        }
        colAsc.textContent = ascii;
        row.append(colOff, colHex, colAsc);
        container.appendChild(row);
      }
    }
  };

  // ---------- macUtils ----------
  const macUtils = {
    parse(str){
      const s = String(str||'').trim(); if (!s) return null;
      const norm = s.replace(/-/g, ':').toLowerCase();
      const parts = norm.split(':'); if (parts.length !== 6) return null;
      const out = new Uint8Array(6);
      for (let i=0;i<6;i++){ if (!/^[0-9a-f]{2}$/i.test(parts[i])) return null; out[i]=parseInt(parts[i],16); }
      return out;
    },
    format(bytes){ if (!bytes || bytes.length!==6) return ''; return Array.from(bytes, b=>b.toString(16).padStart(2,'0')).join(':'); }
  };

  // ---------- ipUtils (IPv4) ----------
  const ipUtils = {
    toInt(ipStr){ const parts = String(ipStr).trim().split('.'); if (parts.length!==4) return null; let n=0; for (let i=0;i<4;i++){ const v=Number(parts[i]); if(!Number.isInteger(v)||v<0||v>255) return null; n=(n<<8)|v; } return n>>>0; },
    toStr(n){ n=n>>>0; return [ (n>>>24)&255, (n>>>16)&255, (n>>>8)&255, n&255 ].join('.'); },
    checksumIPv4Header(hdr){ let sum=0; for (let i=0;i<hdr.length;i+=2){ sum += (hdr[i]<<8) + (hdr[i+1]||0); while (sum>0xFFFF) sum=(sum&0xFFFF)+(sum>>>16); } return (~sum)&0xFFFF; }
  };

  // ---------- Protocols ----------
  const protocols = {
    ethernet: {
      decode(bytes){
        const b = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes||[]);
        if (b.length < 14) return { ok:false, error:'short ethernet' };
        const dst = b.slice(0,6); const src = b.slice(6,12); const t = (b[12]<<8)|b[13];
        const isLen = t < 0x0600; // IEEE 802.3 if < 1536
        const payload = b.slice(14);
        return { ok:true, dst, src, typeOrLen:t, isLen, payload };
      },
      encode({ dst, src, etherType, payload }){
        const p = payload||new Uint8Array(0);
        const out = new Uint8Array(14+p.length);
        out.set(dst,0); out.set(src,6); out[12]=(etherType>>>8)&0xFF; out[13]=etherType&0xFF; out.set(p,14);
        return out;
      }
    },
    ipv4: {
      decode(bytes){
        const b = (bytes instanceof Uint8Array)?bytes:new Uint8Array(bytes||[]);
        if (b.length < 20) return { ok:false, error:'short ip' };
        const verIhl = b[0]; const version = verIhl>>>4; const ihl = (verIhl&0x0F)*4; if (version!==4 || b.length<ihl) return { ok:false, error:'ihl' };
        const totalLen = (b[2]<<8)|b[3]; if (b.length<totalLen) return { ok:false, error:'totlen' };
        const id = (b[4]<<8)|b[5]; const flagsFrag = (b[6]<<8)|b[7]; const ttl=b[8]; const proto=b[9]; const csum=((b[10]<<8)|b[11])>>>0;
        const src = (b[12]<<24)|(b[13]<<16)|(b[14]<<8)|b[15]; const dst=(b[16]<<24)|(b[17]<<16)|(b[18]<<8)|b[19];
        // verify checksum
        const hdr = b.slice(0,ihl); const tmp = hdr.slice(); tmp[10]=0; tmp[11]=0; const calc = ipUtils.checksumIPv4Header(tmp);
        const payload = b.slice(ihl,totalLen);
        return { ok:true, ihl, totalLen, id, flagsFrag, ttl, proto, checksum:csum, checksumOk: (csum===calc), src:src>>>0, dst:dst>>>0, payload, rawHeader:hdr };
      },
      encode(h){
        // h: { src, dst, proto, ttl, id, flagsFrag, payload:Uint8Array }
        const ihl = 20; const totalLen = ihl + (h.payload?.length||0);
        const b = new Uint8Array(totalLen);
        b[0]=0x45; b[1]=0x00; b[2]=(totalLen>>>8)&0xFF; b[3]=totalLen&0xFF; b[4]=(h.id>>>8)&0xFF; b[5]=h.id&0xFF; b[6]=(h.flagsFrag>>>8)&0xFF; b[7]=h.flagsFrag&0xFF; b[8]=h.ttl|0; b[9]=h.proto|0; b[10]=0; b[11]=0;
        const src=h.src>>>0, dst=h.dst>>>0; b[12]=(src>>>24)&255; b[13]=(src>>>16)&255; b[14]=(src>>>8)&255; b[15]=src&255; b[16]=(dst>>>24)&255; b[17]=(dst>>>16)&255; b[18]=(dst>>>8)&255; b[19]=dst&255;
        const csum = ipUtils.checksumIPv4Header(b.slice(0,ihl)); b[10]=(csum>>>8)&0xFF; b[11]=csum&0xFF; if (h.payload) b.set(h.payload, ihl); return b;
      }
    },
    udp: {
      decode(bytes){ const b=(bytes instanceof Uint8Array)?bytes:new Uint8Array(bytes||[]); if (b.length<8) return {ok:false}; const srcPort=(b[0]<<8)|b[1], dstPort=(b[2]<<8)|b[3], len=(b[4]<<8)|b[5]; const payload=b.slice(8,len); return { ok:true, srcPort, dstPort, len, payload, checksum: ((b[6]<<8)|b[7])>>>0 } },
      encode(h){ const payload=h.payload||new Uint8Array(0); const len=8+payload.length; const b=new Uint8Array(len); b[0]=(h.srcPort>>>8)&0xFF; b[1]=h.srcPort&0xFF; b[2]=(h.dstPort>>>8)&0xFF; b[3]=h.dstPort&0xFF; b[4]=(len>>>8)&0xFF; b[5]=len&0xFF; b[6]=0; b[7]=0; b.set(payload,8); return b; }
    },
    tcp: {
      decode(bytes){ const b=(bytes instanceof Uint8Array)?bytes:new Uint8Array(bytes||[]); if (b.length<20) return {ok:false}; const srcPort=(b[0]<<8)|b[1], dstPort=(b[2]<<8)|b[3]; const dataOff=((b[12]>>>4)&0xF)*4; const flags=b[13]; const payload=b.slice(dataOff); return { ok:true, srcPort, dstPort, dataOff, flags, payload } },
      encode(h){ const hdrLen=20; const payload=h.payload||new Uint8Array(0); const b=new Uint8Array(hdrLen+payload.length); b[0]=(h.srcPort>>>8)&0xFF; b[1]=h.srcPort&0xFF; b[2]=(h.dstPort>>>8)&0xFF; b[3]=h.dstPort&0xFF; // seq/ack zero for demo
        b[12]= (5<<4); b[13]= h.flags|0; b[14]=0x10; b[15]=0x00; b[16]=0; b[17]=0; b[18]=0; b[19]=0; b.set(payload, hdrLen); return b; }
    },
    icmp: {
      checksum(data){ let sum=0; for (let i=0;i<data.length;i+=2){ sum += (data[i]<<8)+(data[i+1]||0); while(sum>0xFFFF) sum=(sum&0xFFFF)+(sum>>>16); } return (~sum)&0xFFFF; },
      decode(bytes){ const b=(bytes instanceof Uint8Array)?bytes:new Uint8Array(bytes||[]); if (b.length<4) return {ok:false}; const type=b[0], code=b[1], csum=((b[2]<<8)|b[3])>>>0; const rest=b.slice(4); return { ok:true, type, code, checksum:csum, payload:rest } },
      encode(h){ const rest=h.payload||new Uint8Array(0); const b=new Uint8Array(4+rest.length); b[0]=h.type|0; b[1]=h.code|0; b[2]=0; b[3]=0; b.set(rest,4); const c=this.checksum(b); b[2]=(c>>>8)&0xFF; b[3]=c&0xFF; return b; }
    },
    arp: {
      decode(bytes){ const b=(bytes instanceof Uint8Array)?bytes:new Uint8Array(bytes||[]); if (b.length<28) return {ok:false}; const htype=(b[0]<<8)|b[1], ptype=(b[2]<<8)|b[3], hlen=b[4], plen=b[5], oper=(b[6]<<8)|b[7]; if (htype!==1||ptype!==0x0800||hlen!==6||plen!==4) return { ok:false };
        const sha=b.slice(8,14), spa=(b[14]<<24)|(b[15]<<16)|(b[16]<<8)|b[17]; const tha=b.slice(18,24), tpa=(b[24]<<24)|(b[25]<<16)|(b[26]<<8)|b[27]; return { ok:true, oper, sha, spa:spa>>>0, tha, tpa:tpa>>>0 } },
      encode(h){ const b=new Uint8Array(28); b[0]=0; b[1]=1; b[2]=0x08; b[3]=0x00; b[4]=6; b[5]=4; b[6]=(h.oper>>>8)&0xFF; b[7]=h.oper&0xFF; b.set(h.sha,8); const spa=h.spa>>>0; b[14]=(spa>>>24)&255; b[15]=(spa>>>16)&255; b[16]=(spa>>>8)&255; b[17]=spa&255; b.set(h.tha||new Uint8Array(6),18); const tpa=h.tpa>>>0; b[24]=(tpa>>>24)&255; b[25]=(tpa>>>16)&255; b[26]=(tpa>>>8)&255; b[27]=tpa&255; return b; }
    }
  };

  // ---------- Task generator ----------
  function randMac(rng, broadcast=false){ if (broadcast) return new Uint8Array([0xff,0xff,0xff,0xff,0xff,0xff]); const m=new Uint8Array(6); for(let i=0;i<6;i++) m[i]=randInt(rng,0,255); m[0]&=0xFE; return m; }
  function ipInPrivate(rng){ const blocks=[{b:0x0A000000,p:8},{b:0xAC100000,p:12},{b:0xC0A80000,p:16}]; const sel=blocks[randInt(rng,0,blocks.length-1)]; const hostBits=32-sel.p; const n=randInt(rng,1,(1<<hostBits)-2); return (sel.b + n)>>>0; }

  const taskGenerator = {
    // returns { bytes, decode, questions }
    makeUDP_DNS(rng){
      const dstMac = randMac(rng,false), srcMac=randMac(rng,false);
      const sport=randInt(rng,1024,65535), dport=53;
      const payload=new Uint8Array([0x01,0x00,0x00,0x01]); // tiny placeholder DNS-like
      const udp=protocols.udp.encode({ srcPort:sport, dstPort:dport, payload });
      const src=ipInPrivate(rng), dst=ipInPrivate(rng);
      const ip=protocols.ipv4.encode({ src, dst, proto:17, ttl:randInt(rng,32,128), id:randInt(rng,0,65535), flagsFrag:0, payload:udp });
      const eth=protocols.ethernet.encode({ dst:dstMac, src:srcMac, etherType:0x0800, payload:ip });
      return { bytes:eth };
    },
    makeICMP_Echo(rng){
      const dstMac = randMac(rng,false), srcMac=randMac(rng,false);
      const echoPayload=new Uint8Array([0,1,2,3]);
      const icmp=protocols.icmp.encode({ type:8, code:0, payload:echoPayload });
      const src=ipInPrivate(rng), dst=ipInPrivate(rng);
      const ip=protocols.ipv4.encode({ src, dst, proto:1, ttl:randInt(rng,32,128), id:randInt(rng,0,65535), flagsFrag:0, payload:icmp });
      const eth=protocols.ethernet.encode({ dst:randMac(rng,false), src:randMac(rng,false), etherType:0x0800, payload:ip });
      return { bytes:eth };
    },
    makeARP_Request(rng){
      const sha=randMac(rng,false), spa=ipInPrivate(rng), tpa=ipInPrivate(rng), tha=new Uint8Array([0,0,0,0,0,0]);
      const arp=protocols.arp.encode({ oper:1, sha, spa, tha, tpa });
      const eth=protocols.ethernet.encode({ dst:randMac(rng,true), src:sha, etherType:0x0806, payload:arp });
      return { bytes:eth };
    },
    makeARP_Reply(rng){
      const sha=randMac(rng,false), spa=ipInPrivate(rng), tpa=ipInPrivate(rng), tha=randMac(rng,false);
      const arp=protocols.arp.encode({ oper:2, sha, spa, tha, tpa });
      const eth=protocols.ethernet.encode({ dst:tha, src:sha, etherType:0x0806, payload:arp });
      return { bytes:eth };
    },
    makeTCP_SYN(rng){
      const tcp=protocols.tcp.encode({ srcPort:randInt(rng,1024,65535), dstPort:randInt(rng,1,1023), flags:0x02, payload:new Uint8Array(0) });
      const ip=protocols.ipv4.encode({ src:ipInPrivate(rng), dst:ipInPrivate(rng), proto:6, ttl:randInt(rng,32,128), id:randInt(rng,0,65535), flagsFrag:0, payload:tcp });
      const eth=protocols.ethernet.encode({ dst:randMac(rng,false), src:randMac(rng,false), etherType:0x0800, payload:ip });
      return { bytes:eth };
    },
    makeTCP_Data(rng){
      const data=new TextEncoder().encode('hi');
      const tcp=protocols.tcp.encode({ srcPort:randInt(rng,1024,65535), dstPort:randInt(rng,1024,65535), flags:0x18, payload:data });
      const ip=protocols.ipv4.encode({ src:ipInPrivate(rng), dst:ipInPrivate(rng), proto:6, ttl:randInt(rng,32,128), id:randInt(rng,0,65535), flagsFrag:0, payload:tcp });
      const eth=protocols.ethernet.encode({ dst:randMac(rng,false), src:randMac(rng,false), etherType:0x0800, payload:ip });
      return { bytes:eth };
    },
    frames(rng){
      return [ this.makeUDP_DNS(rng), this.makeICMP_Echo(rng), this.makeARP_Request(rng), this.makeARP_Reply(rng), this.makeTCP_SYN(rng), this.makeTCP_Data(rng) ];
    }
  };

  // ---------- Parsing to Decoded Tree and Questions ----------
  function parseAll(bytes){
    const eth = protocols.ethernet.decode(bytes); if (!eth.ok) return { eth };
    const res = { eth };
    if (!eth.isLen && eth.typeOrLen===0x0800){
      const ip = protocols.ipv4.decode(eth.payload); res.ip=ip;
      if (ip && ip.ok){
        if (ip.proto===17) res.udp = protocols.udp.decode(ip.payload);
        else if (ip.proto===6) res.tcp = protocols.tcp.decode(ip.payload);
        else if (ip.proto===1) res.icmp = protocols.icmp.decode(ip.payload);
      }
    } else if (!eth.isLen && eth.typeOrLen===0x0806){
      res.arp = protocols.arp.decode(eth.payload);
    }
    return res;
  }

  function etherTypeName(val){ const map={ 0x0800:'IPv4', 0x0806:'ARP' }; return map[val]||('0x'+val.toString(16).padStart(4,'0')); }

  function buildQuestions(parsed){
    const qs=[];
    // Destination MAC
    if (parsed.eth && parsed.eth.ok){
      qs.push({ kind:'text', id:'dstmac', prompt:'What is Destination MAC?', fmt:'mac', expected: macUtils.format(parsed.eth.dst) });
      qs.push({ kind:'text', id:'srcmac', prompt:'What is Source MAC?', fmt:'mac', expected: macUtils.format(parsed.eth.src) });
      qs.push({ kind:'mc', id:'ethkind', prompt:'Is this Ethernet II or IEEE 802.3 + LLC?', options:['Ethernet II','IEEE 802.3 + LLC'], expected: parsed.eth.isLen ? 'IEEE 802.3 + LLC' : 'Ethernet II' });
      qs.push({ kind:'text', id:'ethertype', prompt:'What is EtherType?', fmt:'ethertype', expected: '0x'+parsed.eth.typeOrLen.toString(16).padStart(4,'0') });
    }
    if (parsed.ip && parsed.ip.ok){
      qs.push({ kind:'text', id:'srcip', prompt:'What is Source IP (IPv4)?', fmt:'ip', expected: ipUtils.toStr(parsed.ip.src) });
      qs.push({ kind:'text', id:'dstip', prompt:'What is Destination IP (IPv4)?', fmt:'ip', expected: ipUtils.toStr(parsed.ip.dst) });
      qs.push({ kind:'text', id:'ihl', prompt:'What is IPv4 header length (IHL) in bytes?', fmt:'number', expected: String(parsed.ip.ihl) });
      qs.push({ kind:'text', id:'totlen', prompt:'What is Total Length?', fmt:'number', expected: String(parsed.ip.totalLen) });
      qs.push({ kind:'text', id:'ttl', prompt:'What is TTL?', fmt:'number', expected: String(parsed.ip.ttl) });
      const protMap={1:'ICMP',6:'TCP',17:'UDP'}; qs.push({ kind:'mc', id:'proto', prompt:'What is Protocol?', options:['ICMP','TCP','UDP'], expected: protMap[parsed.ip.proto]||'ICMP' });
      if (parsed.udp && parsed.udp.ok){
        qs.push({ kind:'text', id:'usport', prompt:'For UDP: what is Source Port?', fmt:'number', expected: String(parsed.udp.srcPort) });
        qs.push({ kind:'text', id:'udport', prompt:'For UDP: what is Destination Port?', fmt:'number', expected: String(parsed.udp.dstPort) });
        qs.push({ kind:'text', id:'udplen', prompt:'For UDP: what is UDP Length?', fmt:'number', expected: String(parsed.udp.len) });
      }
      if (parsed.tcp && parsed.tcp.ok){
        qs.push({ kind:'text', id:'tsport', prompt:'For TCP: what is Source Port?', fmt:'number', expected: String(parsed.tcp.srcPort) });
        qs.push({ kind:'text', id:'tdport', prompt:'For TCP: what is Destination Port?', fmt:'number', expected: String(parsed.tcp.dstPort) });
      }
      if (parsed.icmp && parsed.icmp.ok){
        qs.push({ kind:'mc', id:'icmpkind', prompt:'ICMP type?', options:['Echo request (8)','Echo reply (0)','Other'], expected: parsed.icmp.type===8?'Echo request (8)':(parsed.icmp.type===0?'Echo reply (0)':'Other') });
      }
    }
    if (parsed.arp && parsed.arp.ok){
      qs.push({ kind:'mc', id:'arptype', prompt:'For ARP: is it request or reply?', options:['request','reply'], expected: parsed.arp.oper===1?'request':'reply' });
      qs.push({ kind:'text', id:'arptpa', prompt:'For ARP: what is target protocol address?', fmt:'ip', expected: ipUtils.toStr(parsed.arp.tpa) });
      if (parsed.eth && parsed.eth.dst && parsed.eth.dst.every(b=>b===0xFF)){
        qs.push({ kind:'mc', id:'bcast', prompt:'What is Broadcast address used here?', options:['Yes (ff:ff:ff:ff:ff:ff)','No'], expected:'Yes (ff:ff:ff:ff:ff:ff)' });
      }
    }
    return qs.slice(0,10);
  }

  // ---------- Validation helpers ----------
  function normalizeMac(s){ const m=macUtils.parse(s); return m?macUtils.format(m):null; }
  function normalizeIP(s){ const n=ipUtils.toInt(s); return n!=null?ipUtils.toStr(n):null; }
  function normalizeEtherType(s){ const v=String(s).trim().toLowerCase(); if (!v) return null; if (v.startsWith('0x')) return '0x'+v.slice(2).padStart(4,'0'); if (/^[0-9a-f]{1,4}$/i.test(v)) return '0x'+v.padStart(4,'0'); return null; }
  function isNumberStr(s){ return /^\d+$/.test(String(s).trim()); }

  function validateAnswer(q, userVal){
    if (q.kind==='mc'){ return { ok: String(userVal)===q.expected }; }
    const val=String(userVal||'').trim(); if (!val) return { ok:false };
    if (q.fmt==='mac'){ const n=normalizeMac(val); return { ok: n!=null && n.toLowerCase()===q.expected.toLowerCase() } }
    if (q.fmt==='ip'){ const n=normalizeIP(val); return { ok: n!=null && n===q.expected } }
    if (q.fmt==='ethertype'){ const n=normalizeEtherType(val); return { ok: n!=null && n.toLowerCase()===q.expected.toLowerCase() } }
    if (q.fmt==='number'){ return { ok: isNumberStr(val) && String(Number(val))===q.expected } }
    return { ok:false };
  }

  // ---------- UI: Analyze ----------
  function renderDecodedTree(parsed){
    const tree = $('#decodedTree'); tree.innerHTML='';
    const ul = document.createElement('ul'); ul.className='tree';
    if (parsed.eth && parsed.eth.ok){
      const li = document.createElement('li'); li.innerHTML = '<span class="node">Ethernet II</span> <span class="range">[0..13] ' + etherTypeName(parsed.eth.typeOrLen) + '</span>'; ul.appendChild(li);
    }
    if (parsed.ip && parsed.ip.ok){
      const li = document.createElement('li'); li.innerHTML = '<span class="node">IPv4</span> <span class="range">IHL '+parsed.ip.ihl+', TTL '+parsed.ip.ttl+', Proto '+parsed.ip.proto+'</span>'; ul.appendChild(li);
    }
    if (parsed.udp && parsed.udp.ok){ const li=document.createElement('li'); li.innerHTML='<span class="node">UDP</span> <span class="range">'+parsed.udp.srcPort+'→'+parsed.udp.dstPort+' len '+parsed.udp.len+'</span>'; ul.appendChild(li); }
    if (parsed.tcp && parsed.tcp.ok){ const li=document.createElement('li'); li.innerHTML='<span class="node">TCP</span> <span class="range">'+parsed.tcp.srcPort+'→'+parsed.tcp.dstPort+'</span>'; ul.appendChild(li); }
    if (parsed.icmp && parsed.icmp.ok){ const li=document.createElement('li'); li.innerHTML='<span class="node">ICMP</span> <span class="range">type '+parsed.icmp.type+' code '+parsed.icmp.code+'</span>'; ul.appendChild(li); }
    if (parsed.arp && parsed.arp.ok){ const li=document.createElement('li'); li.innerHTML='<span class="node">ARP</span> <span class="range">oper '+parsed.arp.oper+'</span>'; ul.appendChild(li); }
    tree.appendChild(ul);
  }

  function renderQuestions(qs){
    const cont = $('#questions'); cont.innerHTML='';
    qs.forEach((q,idx)=>{
      const div = document.createElement('div'); div.className='question'; div.dataset.qid=q.id;
      const prompt = document.createElement('div'); prompt.className='prompt'; prompt.textContent = q.prompt;
      const answers = document.createElement('div'); answers.className='answers';
      if (q.kind==='mc'){
        q.options.forEach(opt=>{
          const label = document.createElement('label');
          const input = document.createElement('input'); input.type='radio'; input.name='q_'+q.id; input.value=opt; label.appendChild(input); label.appendChild(document.createTextNode(' '+opt)); answers.appendChild(label);
        });
      } else {
        const input = document.createElement('input'); input.type='text'; input.placeholder=''; input.dataset.fmt=q.fmt||''; answers.appendChild(input);
      }
      div.append(prompt, answers); cont.appendChild(div);
    });
  }

  function collectAnswers(qs){
    const vals={};
    qs.forEach(q=>{
      if (q.kind==='mc'){
        const sel = $(`input[name="q_${q.id}"]:checked`, $('#questions'));
        vals[q.id] = sel ? sel.value : '';
      } else {
        const inp = $(`[data-fmt][type="text"]`, $(`.question[data-qid="${q.id}"]`)) || $(`.question[data-qid="${q.id}"] input[type="text"]`);
        vals[q.id] = inp ? inp.value : '';
      }
    });
    return vals;
  }

  function checkQuestions(qs, vals){
    let correct=0, total=qs.length;
    qs.forEach(q=>{
      const div = $(`.question[data-qid="${q.id}"]`);
      const res = validateAnswer(q, vals[q.id]);
      div.classList.remove('ok','bad'); div.classList.add(res.ok?'ok':'bad');
      if (res.ok) correct++;
    });
    $('#analyzeScore').textContent = `Score: ${correct}/${total} (${total?Math.round(correct*100/total):0}%)`;
  }

  // ---------- UI: Build ----------
  const buildTasks = [
    { id:'arp-req', name:'ARP request', make:(rng)=>{
        const sha=randMac(rng,false), spa=ipInPrivate(rng), tpa=ipInPrivate(rng), tha=new Uint8Array(6);
        const arp=protocols.arp.encode({ oper:1, sha, spa, tha, tpa });
        const eth=protocols.ethernet.encode({ dst:new Uint8Array([0xff,0xff,0xff,0xff,0xff,0xff]), src:sha, etherType:0x0806, payload:arp });
        return { bytes:eth, fields:{ dstMac:macUtils.format(new Uint8Array([0xff,0xff,0xff,0xff,0xff,0xff])), srcMac:macUtils.format(sha), ethType:'0x0806', arp:{ oper:'request', sha:macUtils.format(sha), spa:ipUtils.toStr(spa), tha:'00:00:00:00:00:00', tpa:ipUtils.toStr(tpa) } } };
      }
    },
    { id:'icmp-echo', name:'ICMP Echo (IPv4)', make:(rng)=>{
        const icmp=protocols.icmp.encode({ type:8, code:0, payload:new Uint8Array([1,2,3,4]) });
        const src=ipInPrivate(rng), dst=ipInPrivate(rng); const ip=protocols.ipv4.encode({ src, dst, proto:1, ttl:64, id:0x1234, flagsFrag:0, payload:icmp });
        const eth=protocols.ethernet.encode({ dst:randMac(rng,false), src:randMac(rng,false), etherType:0x0800, payload:ip });
        return { bytes:eth, fields:{ dstMac:'', srcMac:'', ethType:'0x0800', ip:{ src:ipUtils.toStr(src), dst:ipUtils.toStr(dst), ttl:'64', proto:'ICMP' } } };
      }
    },
    { id:'udp-dns', name:'UDP DNS-like (IPv4)', make:(rng)=>{
        const payload=new Uint8Array([0xaa,0xbb,0x01,0x00]); const udp=protocols.udp.encode({ srcPort:randInt(rng,1024,65535), dstPort:53, payload });
        const src=ipInPrivate(rng), dst=ipInPrivate(rng); const ip=protocols.ipv4.encode({ src, dst, proto:17, ttl:randInt(rng,32,128), id:randInt(rng,0,65535), flagsFrag:0, payload:udp });
        const eth=protocols.ethernet.encode({ dst:randMac(rng,false), src:randMac(rng,false), etherType:0x0800, payload:ip });
        return { bytes:eth, fields:{ dstMac:'', srcMac:'', ethType:'0x0800', ip:{ src:ipUtils.toStr(src), dst:ipUtils.toStr(dst), ttl:String(64) }, udp:{ srcPort:'', dstPort:'53' } } };
      }
    }
  ];

  function renderBuildTasks(rng){
    const sel = $('#buildTask'); sel.innerHTML='';
    buildTasks.forEach((t,i)=>{ const opt=document.createElement('option'); opt.value=String(i); opt.textContent=t.name; sel.appendChild(opt); });
    sel.addEventListener('change', ()=> loadBuildTask(rng));
  }

  function buildFormForTask(task){
    const form = $('#buildForm'); form.innerHTML='';
    // Basic fields: Ethernet + IPv4/ARP depending on stack
    const ethernetFields = [ {label:'Dest MAC', id:'dstMac'}, {label:'Src MAC', id:'srcMac'}, {label:'EtherType', id:'ethType'} ];
    ethernetFields.forEach(f=>{ const row=document.createElement('div'); row.className='field'; const lab=document.createElement('label'); lab.htmlFor=f.id; lab.textContent=f.label; const inp=document.createElement('input'); inp.id=f.id; inp.type='text'; row.append(lab,inp); form.appendChild(row); });
    // IP and L4 or ARP
    const et = task.fields.ethType.toLowerCase();
    if (et==='0x0800'){
      [['Src IP','ipSrc'],['Dst IP','ipDst'],['TTL','ipTtl']].forEach(([label,id])=>{ const row=document.createElement('div'); row.className='field'; const lab=document.createElement('label'); lab.htmlFor=id; lab.textContent=label; const inp=document.createElement('input'); inp.id=id; inp.type='text'; row.append(lab,inp); form.appendChild(row); });
      if (task.fields.udp){ [['UDP Src Port','udpSrc'],['UDP Dst Port','udpDst']].forEach(([label,id])=>{ const row=document.createElement('div'); row.className='field'; const lab=document.createElement('label'); lab.htmlFor=id; lab.textContent=label; const inp=document.createElement('input'); inp.id=id; inp.type='text'; row.append(lab,inp); form.appendChild(row); }); }
    } else if (et==='0x0806'){
      [['ARP Oper (request/reply)','arpOper'],['Sender MAC','arpSha'],['Sender IP','arpSpa'],['Target MAC','arpTha'],['Target IP','arpTpa']].forEach(([label,id])=>{ const row=document.createElement('div'); row.className='field'; const lab=document.createElement('label'); lab.htmlFor=id; lab.textContent=label; const inp=document.createElement('input'); inp.id=id; inp.type='text'; row.append(lab,inp); form.appendChild(row); });
    }
  }

  function populateBuildDefaults(task){
    $('#dstMac').value = task.fields.dstMac || '';
    $('#srcMac').value = task.fields.srcMac || '';
    $('#ethType').value = task.fields.ethType || '';
    if (task.fields.ip){ $('#ipSrc').value = task.fields.ip.src||''; $('#ipDst').value = task.fields.ip.dst||''; $('#ipTtl').value = task.fields.ip.ttl||''; }
    if (task.fields.udp){ $('#udpSrc').value = task.fields.udp.srcPort||''; $('#udpDst').value = task.fields.udp.dstPort||''; }
    if (task.fields.arp){ $('#arpOper').value = task.fields.arp.oper; $('#arpSha').value = task.fields.arp.sha; $('#arpSpa').value = task.fields.arp.spa; $('#arpTha').value = task.fields.arp.tha; $('#arpTpa').value = task.fields.arp.tpa; }
  }

  function encodeFromForm(){
    const et = String($('#ethType').value||'').trim().toLowerCase();
    const dst = macUtils.parse($('#dstMac').value); const src = macUtils.parse($('#srcMac').value); if (!dst||!src) return null;
    if (et==='0x0800'){
      const srcIp = ipUtils.toInt($('#ipSrc').value); const dstIp = ipUtils.toInt($('#ipDst').value); const ttl = Number($('#ipTtl').value)||64;
      let payload = new Uint8Array(0);
      if ($('#udpSrc')){ const sp=Number($('#udpSrc').value)||0; const dp=Number($('#udpDst').value)||0; payload = protocols.udp.encode({ srcPort:sp, dstPort:dp, payload:new Uint8Array(0) }); }
      const ip = protocols.ipv4.encode({ src:srcIp>>>0, dst:dstIp>>>0, proto: ($('#udpSrc')?17:1), ttl, id:0x1111, flagsFrag:0, payload });
      return protocols.ethernet.encode({ dst, src, etherType:0x0800, payload:ip });
    } else if (et==='0x0806'){
      const operStr = String($('#arpOper').value||'').toLowerCase(); const oper = operStr.includes('reply')?2:1;
      const sha=macUtils.parse($('#arpSha').value); const tha=macUtils.parse($('#arpTha').value)||new Uint8Array(6);
      const spa=ipUtils.toInt($('#arpSpa').value)>>>0; const tpa=ipUtils.toInt($('#arpTpa').value)>>>0;
      const arp=protocols.arp.encode({ oper, sha, spa, tha, tpa });
      return protocols.ethernet.encode({ dst, src, etherType:0x0806, payload:arp });
    }
    return null;
  }

  function loadBuildTask(rng){
    const sel = $('#buildTask'); const idx = Math.max(0, Math.min(buildTasks.length-1, Number(sel.value)||0));
    const task = buildTasks[idx].make(rng); state.build.expected = task.bytes; state.build.task = task; buildFormForTask(task); populateBuildDefaults(task);
    hexUtils.renderDump($('#buildDumpWrap'), new Uint8Array(0));
  }

  function checkBuild(){
    const produced = encodeFromForm(); if (!produced){ $('#buildScore').textContent = 'Invalid inputs'; return; }
    const expected = state.build.expected; let ok = produced.length===expected.length;
    let firstMismatch = -1;
    if (ok){ for (let i=0;i<expected.length;i++){ if (produced[i]!==expected[i]){ ok=false; firstMismatch=i; break; } } }
    if (!ok && firstMismatch<0){ firstMismatch = Math.min(produced.length, expected.length); }
    $('#buildScore').textContent = ok ? 'Build OK' : `Mismatch at byte offset ${firstMismatch}`;
    hexUtils.renderDump($('#buildDumpWrap'), produced);
  }

  function showBuildSolution(){ hexUtils.renderDump($('#buildDumpWrap'), state.build.expected); }

  // ---------- App state ----------
  const state = { seed: 0, rng: null, frameIdx: 0, analyze: { bytes:null, qs:[] }, build: { expected:null, task:null } };

  function renderAnalyze(bytes){
    hexUtils.renderDump($('#dumpWrap'), bytes);
    const parsed = parseAll(bytes); renderDecodedTree(parsed);
    const qs = buildQuestions(parsed); state.analyze.qs = qs; renderQuestions(qs);
  }

  function initAnalyzeControls(){
    const seedIn = $('#seedInput'); seedIn.value = String(state.seed);
    $('#btnApplySeed').addEventListener('click', ()=>{
      const v = Number(seedIn.value)>>>0; if (!Number.isFinite(v)) return; const p=getUrlParams(); p.set('seed', String(v)); setUrlParams(p); state.seed=v; state.rng=mulberry32(state.seed); state.frameIdx=0; const frames=taskGenerator.frames(state.rng); renderAnalyze(frames[state.frameIdx%frames.length].bytes);
    });
    $('#btnRegenerateFrame').addEventListener('click', ()=>{
      const newSeed = String(((Math.random()*2**31) ^ Date.now())>>>0); const p=getUrlParams(); p.set('seed', newSeed); p.set('idx','0'); setUrlParams(p);
      state.seed=Number(newSeed)>>>0; seedIn.value=String(state.seed); state.rng=mulberry32(state.seed); state.frameIdx=0; const frames=taskGenerator.frames(state.rng); renderAnalyze(frames[0].bytes);
    });
    $('#btnCheckAnswers').addEventListener('click', ()=>{ const vals=collectAnswers(state.analyze.qs); checkQuestions(state.analyze.qs, vals); });
    $('#btnShowSolutionAnalyze').addEventListener('click', ()=>{ state.analyze.qs.forEach(q=>{ const div=$(`.question[data-qid="${q.id}"]`); if (!div) return; if (q.kind==='mc'){ $$(`input[name="q_${q.id}"]`, div).forEach(inp=>{ inp.checked = (inp.value===q.expected); }); } else { const inp=$('input[type="text"]', div); if (inp) inp.value = q.expected; } }); });
    $('#btnNextFrame').addEventListener('click', ()=>{
      const frames = taskGenerator.frames(state.rng); state.frameIdx = (state.frameIdx+1) % frames.length; const p=getUrlParams(); p.set('idx', String(state.frameIdx)); setUrlParams(p); renderAnalyze(frames[state.frameIdx].bytes);
    });
  }

  function initBuildControls(){
    $('#btnCheckBuild').addEventListener('click', checkBuild);
    $('#btnResetBuild').addEventListener('click', ()=>{ loadBuildTask(state.rng); $('#buildScore').textContent=''; });
    $('#btnShowSolutionBuild').addEventListener('click', showBuildSolution);
  }

  function main(){
    const app = document.getElementById('framesApp'); if (!app) return;
    state.seed = ensureSeed(); const idx = ensureIndex(); state.frameIdx = idx;
    state.rng = mulberry32(state.seed);
    // Tabs
    (function initTabs(){ const tabA=$('#tab-analyze'), tabB=$('#tab-build'), panelA=$('#panel-analyze'), panelB=$('#panel-build'); function activate(which){ if(which==='analyze'){ tabA.classList.add('active'); tabA.setAttribute('aria-selected','true'); tabB.classList.remove('active'); tabB.setAttribute('aria-selected','false'); panelA.classList.remove('hidden'); panelB.classList.add('hidden'); } else { tabB.classList.add('active'); tabB.setAttribute('aria-selected','true'); tabA.classList.remove('active'); tabA.setAttribute('aria-selected','false'); panelB.classList.remove('hidden'); panelA.classList.add('hidden'); } } tabA.addEventListener('click',()=>activate('analyze')); tabB.addEventListener('click',()=>activate('build')); activate('analyze'); })();

    // Analyze: render current frame
    const frames = taskGenerator.frames(state.rng); renderAnalyze(frames[state.frameIdx%frames.length].bytes);
    initAnalyzeControls();

    // Build: tasks
    renderBuildTasks(state.rng); $('#buildTask').value='0'; loadBuildTask(state.rng); initBuildControls();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main, { once: true });
  else main();
})();
