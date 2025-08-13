document.addEventListener('DOMContentLoaded', () => {
  
  const CONFIG = {
    PLAYER_DATA_URL: 'players.json',
    TURNS: { MAX: 10, STARTER_END: 5, BENCH_START: 6 },
    BENCH_SLOTS: 5,
    CHOICES_PER_ROUND: 3,
    CHEMISTRY: {
      MULTIPLIER: 0.6,
      CAP: 100,
      BONUS: { POSITIONAL_FIT: 10, ARCHETYPE_SYNERGY: 4, SAME_TEAM: 15, SAME_CONFERENCE: 5 }
    },
    ANIMATION: {
      FLY_DURATION: 600,
      CHOICE_REVEAL_DELAY: 110,
      EASE_BEZIER: 'cubic-bezier(.22, .9, .3, 1)'
    },
    SYNERGIES: {
      'Primary Ball Handler': ['3&D Wing', 'Stretch Big', 'Rim Protector'],
      '3&D Wing': ['Primary Ball Handler', 'Rim Protector'],
      'Stretch Big': ['Primary Ball Handler', 'Rim Protector'],
      'Rim Protector': ['Primary Ball Handler', '3&D Wing', 'Stretch Big'],
      'Bench Scorer': []
    },
    ADJACENT_POSITIONS: {
      PG: ['PF', 'SG', 'C'], SG: ['PG', 'C', 'SF'], PF: ['PG', 'C'],
      C:  ['PF', 'SG', 'SF', 'PG'], SF: ['C', 'SG']
    }
  };

  
  const state = {
    players: {},
    remainingIds: [],
    starters: { PG: null, SG: null, SF: null, PF: null, C: null },
    bench: [],
    turn: 1,
    currentChoices: [],
    currentTarget: null,
    swapSource: null,
    overlayVisible: false,
    overlayPaused: false
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
    svg: document.getElementById('chem-svg'),
    playerCardTemplate: document.getElementById('player-card-template')
  };

  
  const shuffle = (a) => { for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } };
  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  
  function preloadAllImages(players) {
    Object.values(players).forEach(player => {
      if (player.photoUrl) {
        const img = new Image();
        img.src = player.photoUrl;
      }
    });
  }

  
  async function init() {
    try {
      const response = await fetch(CONFIG.PLAYER_DATA_URL);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      state.players = data.players || {};
      
      preloadAllImages(state.players);

      resetDraftState();
      renderAll();
      attachEventListeners();
      window.addEventListener('resize', () => requestAnimationFrame(drawChemistryLines));
    } catch (err) {
      console.error('Failed to load player data:', err);
    }
  }

  
  function attachEventListeners() {
    el.formation.addEventListener('click', handleSlotInteraction);
    el.bench.addEventListener('click', handleSlotInteraction);
    el.choices.addEventListener('click', handleChoiceSelection);
    el.toggleBoard.addEventListener('click', toggleOverlayPause);
    el.resetBtn.addEventListener('click', () => {
        resetDraftState();
        renderAll();
    });
  }

  
  function handleSlotInteraction(e) {
    const slot = e.target.closest('.slot, .bench-slot');
    if (!slot) return;
    
    const target = slot.classList.contains('slot')
      ? { type: 'starter', key: slot.dataset.pos }
      : { type: 'bench', key: Number(slot.dataset.idx) };
    
    handleSlotClick(target);
  }
  
  
  function handleChoiceSelection(e) {
      const card = e.target.closest('.choice-card');
      if (!card || !card.dataset.id || !state.overlayVisible || state.overlayPaused) return;
      pickFromChoices(card.dataset.id, card);
  }

  
  function handleSlotClick(target) {
    if (state.overlayVisible && !state.overlayPaused) return;

    if (state.swapSource) {
      if (state.swapSource.type === target.type && String(state.swapSource.key) === String(target.key)) {
        state.swapSource = null; 
      } else {
        swapSlots(state.swapSource, target);
        state.swapSource = null;
      }
      clearSwapHighlight();
      renderAll();
    } else if (isOccupied(target)) {
      state.swapSource = target;
      highlightSwapSlot(target);
    } else if (isValidDraftTarget(target)) {
      openOverlayFor(target);
    }
  }

  
  function pickFromChoices(playerId, cardElement) {
    if (!state.currentTarget) return;

    
    qa('.choice-card').forEach(card => {
      if (card !== cardElement) {
        card.classList.add('fade-out-choice');
      }
    });
    q('.overlay-header').classList.add('fade-out');
    q('.overlay-actions').classList.add('fade-out');

    
    flyToSlot(cardElement, state.currentTarget).then(() => {
      placePlayer(playerId, state.currentTarget);
    });
  }

  
  function placePlayer(playerId, target) {
    if (target.type === 'starter') {
      state.starters[target.key] = playerId;
    } else {
      state.bench[target.key] = playerId;
    }
    
    state.remainingIds = state.remainingIds.filter(id => id !== playerId);
    state.turn++;
    
    closeOverlay();
    renderAll();
  }

  
  function swapSlots(source, destination) {
    const getSet = (target) => ({
      get: () => target.type === 'starter' ? state.starters[target.key] : state.bench[target.key],
      set: (val) => {
        if (target.type === 'starter') state.starters[target.key] = val;
        else state.bench[target.key] = val;
      }
    });

    const sourceSlot = getSet(source);
    const destSlot = getSet(destination);
    
    const temp = sourceSlot.get();
    sourceSlot.set(destSlot.get());
    destSlot.set(temp);
  }

  
  function openOverlayFor(target) {
    state.currentTarget = target;
    state.currentChoices = drawChoices(CONFIG.CHOICES_PER_ROUND, target);
    renderChoices();
    state.overlayVisible = true;
    state.overlayPaused = false;
    el.overlay.classList.remove('hidden', 'paused');
    el.toggleBoard.textContent = 'Show Board';
    
    q('.overlay-backdrop').classList.remove('fade-out');
    q('.overlay-header').classList.remove('fade-out');
    q('.overlay-actions').classList.remove('fade-out');
  }

  
  function closeOverlay() {
    state.overlayVisible = false;
    state.overlayPaused = false;
    el.overlay.classList.add('hidden');
    state.currentChoices = [];
    state.currentTarget = null;
  }

  
  function toggleOverlayPause() {
    if (!state.overlayVisible) return;
    state.overlayPaused = !state.overlayPaused;
    el.overlay.classList.toggle('paused', state.overlayPaused);
    el.toggleBoard.textContent = state.overlayPaused ? 'Show Cards' : 'Show Board';
  }

  
  function drawChoices(count, target) {
    const pool = [...state.remainingIds];
    const isStarterSlot = target.type === 'starter';
    const preferred = isStarterSlot ? pool.filter(id => state.players[id]?.position === target.key) : [];
    const other = pool.filter(id => !preferred.includes(id));
    shuffle(other);
    return [...preferred, ...other].slice(0, count);
  }
  
  
  function resetDraftState() {
    state.starters = { PG: null, SG: null, SF: null, PF: null, C: null };
    state.bench = Array(CONFIG.BENCH_SLOTS).fill(null);
    state.turn = 1;
    state.swapSource = null;
    state.remainingIds = Object.keys(state.players);
    shuffle(state.remainingIds);
    if(state.overlayVisible) closeOverlay();
    clearSwapHighlight();
  }

  
  function updateScores() {
    const starterIds = Object.values(state.starters).filter(Boolean);
    const starterPlayers = starterIds.map(id => state.players[id]);

    const talentScore = calculateTalentScore(starterPlayers);
    const chemistryScore = calculateChemistryScore(state.starters, starterPlayers);

    el.talent.textContent = talentScore;
    el.chemistry.textContent = chemistryScore;
    el.final.textContent = talentScore + chemistryScore;
  }
  
  
  function calculateTalentScore(players) {
    if (players.length === 0) return 0;
    const talentSum = players.reduce((sum, p) => sum + (p?.talentScore || 0), 0);
    return Math.round(talentSum / players.length);
  }
  
  
  function calculateChemistryScore(starters, starterPlayers) {
    let rawScore = 0;
    rawScore += calculatePositionalFitBonus(starters);
    rawScore += calculateTeamAndConferenceBonus(starterPlayers);
    rawScore += calculateSynergyBonus(starters);
    return Math.min(CONFIG.CHEMISTRY.CAP, Math.round(rawScore * CONFIG.CHEMISTRY.MULTIPLIER));
  }

  const calculatePositionalFitBonus = (starters) => {
    let bonus = 0;
    for (const pos in starters) {
      const player = state.players[starters[pos]];
      if (player && player.position === pos) {
        bonus += CONFIG.CHEMISTRY.BONUS.POSITIONAL_FIT;
      }
    }
    return bonus;
  };

  const calculateTeamAndConferenceBonus = (starterPlayers) => {
    let bonus = 0;
    for (let i = 0; i < starterPlayers.length; i++) {
      for (let j = i + 1; j < starterPlayers.length; j++) {
        const p1 = starterPlayers[i];
        const p2 = starterPlayers[j];
        if (!p1 || !p2) continue;
        if (p1.teamName === p2.teamName) bonus += CONFIG.CHEMISTRY.BONUS.SAME_TEAM;
        else if (p1.conference === p2.conference) bonus += CONFIG.CHEMISTRY.BONUS.SAME_CONFERENCE;
      }
    }
    return bonus;
  };

  const calculateSynergyBonus = (starters) => {
    let bonus = 0;
    for (const pos1 in CONFIG.ADJACENT_POSITIONS) {
      const player1 = state.players[starters[pos1]];
      if (!player1) continue;
      CONFIG.ADJACENT_POSITIONS[pos1].forEach(pos2 => {
        if (pos1 < pos2) { 
          const player2 = state.players[starters[pos2]];
          if (!player2) return;
          const hasSynergy = CONFIG.SYNERGIES[player1.archetype]?.includes(player2.archetype) || CONFIG.SYNERGIES[player2.archetype]?.includes(player1.archetype);
          if (hasSynergy) {
            bonus += CONFIG.CHEMISTRY.BONUS.ARCHETYPE_SYNERGY;
          }
        }
      });
    }
    return bonus;
  };

  
  function renderAll() {
    renderFormation();
    renderBench();
    updateScores();
    requestAnimationFrame(drawChemistryLines);
    el.turnNum.textContent = Math.min(state.turn, CONFIG.TURNS.MAX);
  }

  
  function renderFormation() {
    qa('.slot').forEach(slot => {
      const pos = slot.dataset.pos;
      renderSlot(slot, state.starters[pos], pos);
    });
  }

  
  function renderBench() {
    qa('.bench-slot').forEach(slot => {
      const idx = Number(slot.dataset.idx);
      renderSlot(slot, state.bench[idx], 'Bench');
    });
  }

  
  function renderSlot(slotEl, playerId, placeholderText) {
    const inner = slotEl.querySelector('.slot-inner');
    inner.innerHTML = '';
    if (playerId) {
      inner.appendChild(createSlotCard(state.players[playerId]));
    } else {
      inner.innerHTML = `<div class="slot-placeholder">${placeholderText}</div>`;
    }
  }
  
  
  function renderChoices() {
    el.choices.innerHTML = '';
    state.currentChoices.forEach((id, i) => {
      const player = state.players[id];
      if (!player) return;
      const node = createChoiceCard(player);
      node.classList.add('reveal');
      node.style.animationDelay = `${i * CONFIG.ANIMATION.CHOICE_REVEAL_DELAY}ms`;
      el.choices.appendChild(node);
    });
  }

  
  function createPlayerCard(player) {
    const template = el.playerCardTemplate.content.cloneNode(true);
    const cardContent = template.querySelector('.player-card-content');
    q('.player-card-logo', cardContent).src = player.teamLogoUrl;
    q('.player-card-logo', cardContent).alt = `${player.teamName} Logo`;
    q('.player-card-talent', cardContent).textContent = player.talentScore;
    q('.player-card-pos', cardContent).textContent = player.position;
    q('.player-card-conference', cardContent).textContent = player.conference;
    q('.player-card-photo', cardContent).src = player.photoUrl;
    q('.player-card-photo', cardContent).alt = player.name;
    q('.player-card-name', cardContent).textContent = player.name;
    q('.player-card-archetype', cardContent).textContent = player.archetype;
    return cardContent;
  }

  
  function createSlotCard(player) {
    const wrapper = document.createElement('div');
    wrapper.className = 'slot-card';
    wrapper.appendChild(createPlayerCard(player));
    return wrapper;
  }

  
  function createChoiceCard(player) {
    const card = document.createElement('div');
    card.className = 'choice-card';
    card.dataset.id = player.id;
    card.appendChild(createPlayerCard(player));
    return card;
  }

  
  function flyToSlot(cardEl, target) {
    return new Promise((resolve) => {
      
      cardEl.classList.add('is-flying');

      const srcRect = cardEl.getBoundingClientRect();
      const targetSelector = target.type === 'starter'
        ? `.slot[data-pos="${target.key}"] .slot-inner`
        : `.bench-slot[data-idx="${target.key}"] .slot-inner`;
      const destNode = q(targetSelector);
      
      if (!destNode) return resolve();
      const destRect = destNode.getBoundingClientRect();

      const clone = cardEl.cloneNode(true);
      clone.classList.remove('reveal', 'is-flying');
      clone.classList.add('flying-card-clone');
      document.body.appendChild(clone);
      
      Object.assign(clone.style, {
        left: `${srcRect.left}px`,
        top: `${srcRect.top}px`,
        transition: `all ${CONFIG.ANIMATION.FLY_DURATION}ms ${CONFIG.ANIMATION.EASE_BEZIER}`
      });

      q('.overlay-backdrop').classList.add('fade-out');

      requestAnimationFrame(() => {
        const dx = (destRect.left + destRect.width / 2) - (srcRect.left + srcRect.width / 2);
        const dy = (destRect.top + destRect.height / 2) - (srcRect.top + srcRect.height / 2);
        const scale = Math.min(destRect.width / srcRect.width, destRect.height / srcRect.height, 1);
        clone.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
        clone.style.opacity = '0.5';
      });

      setTimeout(() => {
        clone.remove();
        resolve();
      }, CONFIG.ANIMATION.FLY_DURATION);
    });
  }

  
  function drawChemistryLines() {
    el.svg.innerHTML = '';
    const svgRect = el.svg.getBoundingClientRect();
    const slotCenters = {};

    qa('.slot').forEach(slot => {
      const pos = slot.dataset.pos;
      if (state.starters[pos]) {
        const r = slot.getBoundingClientRect();
        slotCenters[pos] = {
          pid: state.starters[pos],
          x: r.left + r.width / 2 - svgRect.left,
          y: r.top + r.height / 2 - svgRect.top
        };
      }
    });

    const drawnLinks = new Set();
    for (const pos1 in CONFIG.ADJACENT_POSITIONS) {
      if (!slotCenters[pos1]) continue;
      CONFIG.ADJACENT_POSITIONS[pos1].forEach(pos2 => {
        const linkId = [pos1, pos2].sort().join('-');
        if (drawnLinks.has(linkId) || !slotCenters[pos2]) return;
        
        const p1 = state.players[slotCenters[pos1].pid];
        const p2 = state.players[slotCenters[pos2].pid];
        if (!p1 || !p2) return;

        const synergy = CONFIG.SYNERGIES[p1.archetype]?.includes(p2.archetype) || CONFIG.SYNERGIES[p2.archetype]?.includes(p1.archetype);
        
        let color = 'rgba(255, 107, 107, 0.5)';
        let width = 3;
        if (synergy) { color = 'rgba(255, 216, 107, 0.8)'; width = 5; }

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', slotCenters[pos1].x); line.setAttribute('y1', slotCenters[pos1].y);
        line.setAttribute('x2', slotCenters[pos2].x); line.setAttribute('y2', slotCenters[pos2].y);
        line.setAttribute('stroke', color); line.setAttribute('stroke-width', width);
        line.setAttribute('stroke-linecap', 'round');
        el.svg.appendChild(line);

        drawnLinks.add(linkId);
      });
    }
  }
  
  
  const isOccupied = (t) => t.type === 'starter' ? !!state.starters[t.key] : !!state.bench[t.key];
  
  const isValidDraftTarget = (t) => {
    const isStarterTurn = state.turn <= CONFIG.TURNS.STARTER_END;
    const isBenchTurn = state.turn >= CONFIG.TURNS.BENCH_START && state.turn <= CONFIG.TURNS.MAX;
    return (isStarterTurn && t.type === 'starter') || (isBenchTurn && t.type === 'bench');
  };

  
  function highlightSwapSlot(target) {
    clearSwapHighlight();
    const selector = target.type === 'starter'
      ? `.slot[data-pos="${target.key}"]`
      : `.bench-slot[data-idx="${target.key}"]`;
    q(selector)?.classList.add('selected');
  }

  
  function clearSwapHighlight() {
    qa('.slot.selected, .bench-slot.selected').forEach(n => n.classList.remove('selected'));
  }

  
  init();
});