document.addEventListener('DOMContentLoaded', () => {
  const state = {
    players: {},
    remainingIds: [],
    starters: { PG:null, SG:null, SF:null, PF:null, C:null },
    bench: [null, null, null],
    turn: 1,
    currentChoices: [],
    currentTarget: null,
    swapSource: null,
    overlayVisible: false,
    overlayPaused: false
  };

  const synergies = {
    'Primary Ball Handler': ['3&D Wing','Stretch Big','Rim Protector'],
    '3&D Wing': ['Primary Ball Handler','Rim Protector'],
    'Stretch Big': ['Primary Ball Handler','Rim Protector'],
    'Rim Protector': ['Primary Ball Handler','3&D Wing','Stretch Big'],
    'Bench Scorer': []
  };
  const posAdj = {
    PG: ['PF', 'SG', 'C'],
    SG: ['PG', 'C', 'SF'],
    PF: ['PG', 'C'],
    C:  ['PF', 'SG', 'SF', 'PG'],
    SF: ['C', 'SG']
  };

  const el = {
    formation: document.getElementById('formation'),
    bench: document.getElementById('bench'),
    overlay: document.getElementById('choice-overlay'),
    choices: document.getElementById('choices'),
    toggleBoard: document.getElementById('toggle-board'),
    talent: document.getElementById('talent-score'),
    chemistry: document.getElementById('chemistry-score'),
    final: document.getElementById('final-score'),
    turnNum: document.getElementById('turn-num'),
    resetBtn: document.getElementById('reset-btn'),
    svg: document.getElementById('chem-svg')
  };

  function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } }
  function q(sel, root=document){ return root.querySelector(sel) }
  function qa(sel, root=document){ return Array.from(root.querySelectorAll(sel)) }
  const ease = 'cubic-bezier(.22,.9,.3,1)';

  async function init(){
    try {
      const r = await fetch('players.json');
      const data = await r.json();
      state.players = data.players || {};
      state.remainingIds = Object.keys(state.players);
      shuffle(state.remainingIds);

      renderAll();
      attachListeners();
      window.addEventListener('resize', drawLines);
      drawLines();
    } catch(err) {
      console.error('players.json load failed', err);
    }
  }

  function attachListeners(){
    el.formation.addEventListener('click', (e) => {
      const slot = e.target.closest('.slot');
      if(!slot) return;
      const pos = slot.dataset.pos;
      handleSlotClick({ type:'starter', key: pos });
    });

    el.bench.addEventListener('click', (e) => {
      const b = e.target.closest('.bench-slot');
      if(!b) return;
      const idx = Number(b.dataset.idx);
      handleSlotClick({ type:'bench', key: idx });
    });

    el.choices.addEventListener('click', (e) => {
      const card = e.target.closest('.choice-card');
      if(!card) return;
      const pid = card.dataset.id;
      if(!pid) return;
      if(!state.overlayVisible || state.overlayPaused) return;
      pickFromChoices(pid, card);
    });

    el.toggleBoard.addEventListener('click', () => {
      if (!state.overlayVisible) return;
      state.overlayPaused = !state.overlayPaused;
      if (state.overlayPaused) {
        el.overlay.classList.add('paused');
        el.toggleBoard.textContent = 'Show Cards';
      } else {
        el.overlay.classList.remove('paused');
        el.toggleBoard.textContent = 'Show Board';
      }
    });

    el.resetBtn.addEventListener('click', resetDraft);

    el.overlay.addEventListener('click', (e) => {});

    el.choices.addEventListener('dragstart', (e) => {
      const c = e.target.closest('.choice-card');
      if(!c) return;
      e.dataTransfer.setData('text/plain', c.dataset.id);
    });

    document.addEventListener('drop', (e) => {
      e.preventDefault();
      const pid = e.dataTransfer?.getData('text/plain');
      if(!pid) return;
      const node = document.elementFromPoint(e.clientX, e.clientY);
      const slotNode = node?.closest('.slot, .bench-slot');
      if(!slotNode) return;
      if(slotNode.classList.contains('slot')) handleDropToSlot(pid, { type:'starter', key: slotNode.dataset.pos });
      else handleDropToSlot(pid, { type:'bench', key: Number(slotNode.dataset.idx) });
    });
  }

  function handleSlotClick(target) {
    if (state.overlayVisible && !state.overlayPaused) {
      return;
    }

    if (state.swapSource) {
      if (state.swapSource.type === target.type && String(state.swapSource.key) === String(target.key)) {
        state.swapSource = null;
        clearSwapHighlight();
        return;
      }
      swapSlots(state.swapSource, target);
      state.swapSource = null;
      clearSwapHighlight();
      renderAll();
      return;
    }

    const occupied = isOccupied(target);
    if (occupied) {
      state.swapSource = target;
      highlightSwapSlot(target);
      return;
    }

    if (isValidDraftTarget(target)) {
      openOverlayFor(target);
    }
  }

  function isOccupied(target) {
    return target.type === 'starter' ? !!state.starters[target.key] : !!state.bench[target.key];
  }

  function isValidDraftTarget(target) {
    if (state.turn <= 5 && target.type === 'starter') return true;
    if (state.turn >= 6 && state.turn <= 8 && target.type === 'bench') return true;
    return false;
  }

  function highlightSwapSlot(target) {
    clearSwapHighlight();
    let node = null;
    if (target.type === 'starter') node = el.formation.querySelector(`.slot[data-pos="${target.key}"]`);
    else node = el.bench.querySelector(`.bench-slot[data-idx="${target.key}"]`);
    if (node) node.classList.add('selected');
  }

  function clearSwapHighlight() {
    qa('.slot.selected, .bench-slot.selected').forEach(n => n.classList.remove('selected'));
  }

  function swapSlots(a, b) {
    if (a.type === 'starter' && b.type === 'starter') {
      const tmp = state.starters[a.key]; state.starters[a.key] = state.starters[b.key]; state.starters[b.key] = tmp;
    } else if (a.type === 'bench' && b.type === 'bench') {
      const tmp = state.bench[a.key]; state.bench[a.key] = state.bench[b.key]; state.bench[b.key] = tmp;
    } else if (a.type === 'starter' && b.type === 'bench') {
      const tmp = state.starters[a.key]; state.starters[a.key] = state.bench[b.key]; state.bench[b.key] = tmp;
    } else if (a.type === 'bench' && b.type === 'starter') {
      const tmp = state.bench[a.key]; state.bench[a.key] = state.starters[b.key]; state.starters[b.key] = tmp;
    }
    updateScores();
  }

  function openOverlayFor(target) {
    state.currentTarget = target;
    state.currentChoices = drawChoices(3, target);
    renderChoices();
    state.overlayVisible = true;
    state.overlayPaused = false;
    el.overlay.classList.remove('hidden','paused');
    el.toggleBoard.textContent = 'Show Board';
  }

  function closeOverlay() {
    state.currentChoices = [];
    state.currentTarget = null;
    state.overlayVisible = false;
    state.overlayPaused = false;
    el.overlay.classList.add('hidden');
    el.overlay.classList.remove('paused');
  }

  function drawChoices(n, target) {
    const pool = state.remainingIds.slice();
    shuffle(pool);
    const preferred = [];
    if (target.type === 'starter') {
      pool.forEach(id => { if (state.players[id].position === target.key) preferred.push(id); });
    }
    const chosen = new Set();
    for (const id of preferred) { if (chosen.size >= n) break; chosen.add(id); }
    for (const id of pool) { if (chosen.size >= n) break; if (!chosen.has(id)) chosen.add(id); }
    return Array.from(chosen).slice(0, n);
  }

  function renderChoices() {
    el.choices.innerHTML = '';
    state.currentChoices.forEach((id, i) => {
      const p = state.players[id];
      if(!p) return;
      const node = createChoiceFullCard(p);
      node.classList.add('reveal');
      node.style.animationDelay = `${i*110}ms`;
      el.choices.appendChild(node);
    });
  }

  function pickFromChoices(pid, cardEl) {
    if (!state.currentTarget) return;

    flyToSlot(cardEl, state.currentTarget).then(() => {
        assignPlayerToTarget(pid, state.currentTarget);
        state.remainingIds = state.remainingIds.filter(x => x !== pid);
        state.turn++;
        closeOverlay();
        renderAll();
    });
  }

  function handleDropToSlot(pid, target) {
    if (isValidDraftTarget(target) && !isOccupied(target)) {
      assignPlayerToTarget(pid, target);
      state.remainingIds = state.remainingIds.filter(x => x !== pid);
      state.turn++;
      closeOverlay();
      renderAll();
    } else if (state.swapSource) {
      if (state.swapSource.type === 'starter') state.starters[state.swapSource.key] = pid;
      else state.bench[state.swapSource.key] = pid;
      state.remainingIds = state.remainingIds.filter(x => x !== pid);
      state.swapSource = null; clearHighlight(); renderAll();
    }
  }

  function assignPlayerToTarget(pid, target) {
    if (target.type === 'starter') state.starters[target.key] = pid;
    else state.bench[target.key] = pid;
    updateScores();
  }

  function flyToSlot(cardEl, target) {
    return new Promise((resolve) => {
        try {
            const src = cardEl.getBoundingClientRect();
            let destNode;
            if (target.type === 'starter') destNode = el.formation.querySelector(`.slot[data-pos="${target.key}"] .slot-inner`);
            else destNode = el.bench.querySelector(`.bench-slot[data-idx="${target.key}"] .slot-inner`);
            
            if (!destNode) {
                resolve();
                return;
            }
            const dest = destNode.getBoundingClientRect();

            const clone = cardEl.cloneNode(true);
            clone.classList.add('fly-clone');
            clone.style.width = `${src.width}px`;
            clone.style.height = `${src.height}px`;
            clone.style.left = `${src.left}px`;
            clone.style.top = `${src.top}px`;
            clone.style.position = 'fixed';
            clone.style.margin = '0';
            clone.style.transition = `transform 500ms ${ease}, width 500ms ${ease}, height 500ms ${ease}`;
            document.body.appendChild(clone);

            requestAnimationFrame(() => {
                const dx = (dest.left + dest.width / 2) - (src.left + src.width / 2);
                const dy = (dest.top + dest.height / 2) - (src.top + src.height / 2);
                const scaleX = dest.width / src.width;
                const scaleY = dest.height / src.height;
                const scale = Math.min(scaleX, scaleY, 1);
                clone.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
            });

            setTimeout(() => {
                if (clone.parentNode) clone.parentNode.removeChild(clone);
                resolve();
            }, 500);
        } catch (err) {
            console.error("Fly-to-slot animation failed:", err);
            resolve();
        }
    });
  }

  function createSlotCard(player) {
    const wrapper = document.createElement('div');
    wrapper.className = 'slot-card';
    wrapper.innerHTML = `
      <div style="position:relative;width:100%;height:100%;">
        <div style="position:absolute;right:12px;top:10px;width:52px;height:52px;border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.04)"><img src="${player.teamLogoUrl}" style="width:100%;height:100%;object-fit:contain" alt=""></div>
        <div style="position:absolute;left:12px;top:10px;font-weight:800;font-size:1.6vh;color:${getComputedStyle(document.documentElement).getPropertyValue('--gold') || '#ffd86b'}">${player.talentScore}</div>
        <div style="position:absolute;left:12px;top:38px;padding:.28vh .6vw;border-radius:8px;background:rgba(0,0,0,0.45);border:1px solid rgba(255,255,255,0.04);font-weight:700">${player.position}</div>
        <div style="position:absolute;left:0;right:0;bottom:8px;padding:.6vh .8vw;text-align:center">
          <div style="font-weight:800;font-size:1.1vh">${player.name}</div>
          <div style="color:var(--gold);font-weight:700;font-size:0.95vh;margin-top:.3vh">${player.archetype}</div>
        </div>
        <div style="position:absolute;left:50%;top:32%;transform:translateX(-50%);width:74%;height:40%;display:flex;align-items:center;justify-content:center"><img src="${player.photoUrl}" style="max-width:100%;max-height:100%;object-fit:contain;filter: drop-shadow(0 16px 24px rgba(0,0,0,0.6))" alt=""></div>
      </div>
    `;
    return wrapper;
  }

  function createChoiceFullCard(player) {
    const card = createSlotCard(player);
    card.className = 'choice-card';
    card.dataset.id = player.id;
    return card;
  }

  function renderAll() {
    renderSlots();
    renderBench();
    updateScores();
    drawLines();
    el.turnNum.textContent = Math.min(state.turn, 8);
  }

  function renderSlots() {
    qa('.slot').forEach(slot => {
      const pos = slot.dataset.pos;
      const inner = slot.querySelector('.slot-inner');
      inner.innerHTML = '';
      const pid = state.starters[pos];
      if (pid) {
        inner.appendChild(createSlotCard(state.players[pid]));
      } else {
        inner.innerHTML = `<div class="slot-placeholder">${pos}</div>`;
      }
    });
  }

  function renderBench() {
    qa('.bench-slot').forEach(bs => {
      const idx = Number(bs.dataset.idx);
      const inner = bs.querySelector('.slot-inner');
      inner.innerHTML = '';
      const pid = state.bench[idx];
      if (pid) {
        inner.appendChild(createSlotCard(state.players[pid]));
      } else {
        inner.innerHTML = `<div class="slot-placeholder">Bench</div>`;
      }
    });
  }

  function updateScores(){
    const starterIds = Object.values(state.starters).filter(Boolean);
    const talentSum = starterIds.reduce((s,id) => s + (state.players[id]?.talentScore || 0), 0);
    const talent = starterIds.length > 0 ? Math.round(talentSum / starterIds.length) : 0;
    
    let raw = 0;

    for (const pos in state.starters) {
      const pid = state.starters[pos];
      if (!pid) continue;
      const p = state.players[pid];
      if (p && p.position === pos) {
          raw += 10;
      }
    }

    for (const p1 in posAdj) {
      const pid1 = state.starters[p1];
      if (!pid1) continue;
      posAdj[p1].forEach(p2 => {
          const pid2 = state.starters[p2];
          if (!pid2) return;
          const a = state.players[pid1];
          const b = state.players[pid2];
          if (!a || !b) return;
          if (synergies[a.archetype]?.includes(b.archetype) || synergies[b.archetype]?.includes(a.archetype)) {
              raw += 4;
          }
      });
    }

    if (starterIds.length > 1) {
      for (let i = 0; i < starterIds.length; i++) {
        for (let j = i + 1; j < starterIds.length; j++) {
          const p1 = state.players[starterIds[i]];
          const p2 = state.players[starterIds[j]];

          if (p1 && p2) {
            if (p1.teamName && p1.teamName === p2.teamName) {
              raw += 15;
            } 
            else if (p1.conference && p1.conference === p2.conference) {
              raw += 5;
            }
          }
        }
      }
    }

    const chemistry = Math.min(100, Math.round(raw * 0.45));
    el.talent.textContent = talent;
    el.chemistry.textContent = chemistry;
    el.final.textContent = talent + chemistry;
  }

  function drawLines(){
    while(el.svg.firstChild) el.svg.removeChild(el.svg.firstChild);
    const svgRect = el.svg.getBoundingClientRect();
    const centers = {};
    qa('.slot').forEach(s=>{
      const pos = s.dataset.pos;
      const pid = state.starters[pos];
      if(!pid) return;
      const r = s.getBoundingClientRect();
      centers[pos] = { pid, x: r.left + r.width/2 - svgRect.left, y: r.top + r.height/2 - svgRect.top };
    });

    const drawn = new Set();
    for(const a in posAdj){
      posAdj[a].forEach(b=>{
        const key = [a,b].sort().join('-');
        if(drawn.has(key)) return;
        if(!centers[a] || !centers[b]) return;
        const A = centers[a], B = centers[b];
        const pa = state.players[A.pid], pb = state.players[B.pid];
        const aIn = pa && pa.position === a, bIn = pb && pb.position === b;
        const syn = pa && pb && (synergies[pa.archetype]?.includes(pb.archetype) || synergies[pb.archetype]?.includes(pa.archetype));
        let color = '#ff6b6b', width = 3;
        if(aIn && bIn && syn){ color = '#b7ffdf'; width = 6; }
        else if((aIn && bIn) || syn){ color = '#ffd86b'; width = 5; }
        const line = document.createElementNS('http://www.w3.org/2000/svg','line');
        line.setAttribute('x1', A.x); line.setAttribute('y1', A.y);
        line.setAttribute('x2', B.x); line.setAttribute('y2', B.y);
        line.setAttribute('stroke', color); line.setAttribute('stroke-width', width); line.setAttribute('stroke-linecap','round');
        el.svg.appendChild(line);
      });
    }
  }

  function resetDraft(){
    state.starters = { PG:null, SG:null, SF:null, PF:null, C:null };
    state.bench = [null,null,null];
    state.turn = 1;
    state.currentChoices = [];
    state.currentTarget = null;
    state.swapSource = null;
    state.overlayVisible = false;
    state.overlayPaused = false;
    state.remainingIds = Object.keys(state.players);
    shuffle(state.remainingIds);
    el.overlay.classList.add('hidden');
    el.overlay.classList.remove('paused');
    renderAll();
  }

  init();
});