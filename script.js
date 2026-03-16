/**
 * BALLISTIC BARRAGE — script.js
 * ==============================
 * A polished browser arcade game.
 *
 * HOW TO RUN:
 *   1. Open index.html in any modern browser.
 *   2. Or: `python3 -m http.server 8080` then visit http://localhost:8080
 *
 * ARCHITECTURE (single-file, organized sections):
 *   1. Config & Constants
 *   2. Audio Engine
 *   3. State Management
 *   4. Canvas / Renderer setup
 *   5. Input Handling
 *   6. Physics & Collision
 *   7. Level Generation
 *   8. Particle System
 *   9. Game Loop
 *  10. UI Helpers
 *  11. Init
 */

'use strict';

// ─────────────────────────────────────────────
// 1. CONFIG & CONSTANTS
// ─────────────────────────────────────────────

const CFG = {
  // Grid
  COLS:         7,
  ROWS:         10,         // visible grid rows
  BLOCK_PAD:    3,          // gap between blocks

  // Ball
  BALL_RADIUS:  7,
  BALL_SPEED:   540,        // px/s at base

  // Physics
  FIXED_DT:     1 / 60,     // 60 Hz fixed timestep
  MAX_STEPS:    8,          // physics substeps per frame

  // Launch
  MIN_ANGLE_DEG:  2,        // min angle above horizontal
  LAUNCH_DELAY:   40,       // ms between successive ball launches

  // Spawn
  PICKUP_CHANCE_BASE: 0.10, // base chance of pickup per row cell
  GAP_CHANCE_BASE:    0.30, // chance of empty cell
  MIN_HEALTH:         1,
  HEALTH_PER_TURN:    0.55, // avg health growth per turn

  // Juice
  SHAKE_THRESHOLD:  3,      // min simultaneous hits to trigger shake
  PARTICLE_COUNT:   12,
};

// Colours (drawn on canvas)
const COLORS = {
  BG:          '#0a0c14',
  BG_GRID:     'rgba(255,255,255,0.025)',
  BALL:        '#00e5ff',
  BALL_GLOW:   'rgba(0,229,255,0.35)',
  PICKUP:      '#a8ff78',
  PICKUP_GLOW: 'rgba(168,255,120,0.4)',
  BLOCK:       [          // gradient by health tier
    '#1e3a5f', // tier 0
    '#0f5fa8', // tier 1
    '#0a8fcc', // tier 2
    '#00bcd4', // tier 3
    '#00e676', // tier 4
    '#ffeb3b', // tier 5
    '#ff9800', // tier 6
    '#f44336', // tier 7
    '#e040fb', // tier 8+
  ],
  PARTICLE:    ['#00e5ff','#ff3d71','#ffd700','#a8ff78','#ff9800'],
  WALL_LINE:   'rgba(0,229,255,0.12)',
  AIM_LINE:    'rgba(0,229,255,0.55)',
  AIM_DOT:     'rgba(0,229,255,0.25)',
  GHOST_BALL:  'rgba(0,229,255,0.2)',
  LAUNCH_ZONE: 'rgba(0,229,255,0.06)',
  DANGER_LINE: 'rgba(255,61,113,0.4)',
};

// ─────────────────────────────────────────────
// 2. AUDIO ENGINE  (Web Audio API synthesis)
// ─────────────────────────────────────────────

const Audio = (() => {
  let ctx = null;
  let muted = localStorage.getItem('bb_mute') === '1';

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, type, duration, vol = 0.25, attack = 0.005, decay = 0.1) {
    if (muted) return;
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain);
      gain.connect(c.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      gain.gain.setValueAtTime(0, c.currentTime);
      gain.gain.linearRampToValueAtTime(vol, c.currentTime + attack);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
      osc.start(c.currentTime);
      osc.stop(c.currentTime + duration + 0.01);
    } catch (e) { /* ignore */ }
  }

  function noise(duration, vol = 0.15) {
    if (muted) return;
    try {
      const c = getCtx();
      const bufLen = Math.floor(c.sampleRate * duration);
      const buf = c.createBuffer(1, bufLen, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      const gain = c.createGain();
      src.buffer = buf;
      src.connect(gain);
      gain.connect(c.destination);
      gain.gain.setValueAtTime(vol, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
      src.start(c.currentTime);
    } catch (e) { /* ignore */ }
  }

  return {
    launch()      { tone(220, 'sine',     0.18, 0.2, 0.01, 0.15); tone(330, 'triangle', 0.12, 0.1); },
    wallBounce()  { tone(440, 'triangle', 0.06, 0.08); },
    blockHit()    { tone(280, 'square',   0.08, 0.12, 0.003, 0.06); },
    blockBreak()  { noise(0.18, 0.2); tone(80, 'sawtooth', 0.2, 0.15, 0.005, 0.18); },
    pickup()      { tone(880, 'sine', 0.15, 0.2); tone(1100, 'sine', 0.12, 0.15, 0.01); },
    gameOver()    { tone(110, 'sawtooth', 0.6, 0.25, 0.01, 0.5); tone(80, 'square', 0.8, 0.2, 0.05, 0.7); },
    get muted()   { return muted; },
    toggle()      {
      muted = !muted;
      localStorage.setItem('bb_mute', muted ? '1' : '0');
      return muted;
    },
  };
})();

// ─────────────────────────────────────────────
// 3. STATE MANAGEMENT
// ─────────────────────────────────────────────

const State = {
  // Game phases: 'start' | 'aiming' | 'firing' | 'rolling' | 'shifting' | 'gameover' | 'paused'
  phase: 'start',
  prevPhase: 'aiming',

  score: 0,
  best: parseInt(localStorage.getItem('bb_best') || '0'),
  turn: 1,
  ballCount: 1,

  // Grid: array of { hp, maxHp, col, row } or null
  blocks: [],
  // Pickups: array of { col, row, collected }
  pickups: [],

  // Ball objects during firing/rolling
  balls: [],
  // Launch origin x (updated each turn from where first ball lands)
  launchX: 0,
  launchY: 0,
  // First ball to land (determines next launchX)
  firstLandX: null,

  // Balls yet to be launched this turn
  ballsToLaunch: 0,
  launchAngle: 0,  // radians
  launchTimer: 0,  // ms accumulator

  // Queued pickups collected this turn (add to ballCount after turn)
  pendingBallGain: 0,

  // Balls that have landed (counted)
  ballsLanded: 0,
  ballsFired:  0,

  reset() {
    this.phase          = 'aiming';
    this.score          = 0;
    this.turn           = 1;
    this.ballCount      = 1;
    this.blocks         = [];
    this.pickups        = [];
    this.balls          = [];
    this.firstLandX     = null;
    this.pendingBallGain = 0;
    this.ballsLanded    = 0;
    this.ballsFired     = 0;
    this.ballsToLaunch  = 0;
  },

  saveBest() {
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem('bb_best', this.best);
      return true;
    }
    return false;
  },
};

// ─────────────────────────────────────────────
// 4. CANVAS / RENDERER SETUP
// ─────────────────────────────────────────────

const canvas = document.getElementById('game-canvas');
const ctx2d   = canvas.getContext('2d');

// Layout computed values (updated on resize)
const Layout = {
  W: 0, H: 0,          // canvas size
  blockW: 0, blockH: 0, // block dimensions
  gridOffX: 0,          // grid left edge
  gridOffY: 0,          // grid top edge (first row starts here)
  launchZoneY: 0,       // y where balls are launched from
  cellSize: 0,          // square cell dimension
};

function resizeCanvas() {
  const hud = document.getElementById('hud');
  const hudH = hud.offsetHeight + 4;
  const maxW = Math.min(window.innerWidth, 480);
  const maxH = window.innerHeight - hudH;

  // Keep a portrait aspect ratio
  const aspect = 9 / 16;
  let W = maxW;
  let H = W / aspect;
  if (H > maxH) {
    H = maxH;
    W = H * aspect;
  }
  W = Math.floor(W);
  H = Math.floor(H);

  canvas.width  = W;
  canvas.height = H;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  Layout.W = W;
  Layout.H = H;

  const pad = Math.floor(W * 0.02);
  const cellW = Math.floor((W - pad * 2) / CFG.COLS);
  const cellH = cellW; // square cells
  Layout.cellSize = cellW;
  Layout.blockW   = cellW - CFG.BLOCK_PAD * 2;
  Layout.blockH   = cellH - CFG.BLOCK_PAD * 2;
  Layout.gridOffX = pad;
  Layout.gridOffY = Math.floor(H * 0.06);
  Layout.launchZoneY = H - Math.floor(H * 0.02);

  // Update launch position to stay centred after resize
  if (State.phase !== 'start') {
    State.launchX = W / 2;
    State.launchY = Layout.launchZoneY;
  }
}

// Get pixel position of block centre
function blockToPixel(col, row) {
  return {
    x: Layout.gridOffX + col * Layout.cellSize + Layout.cellSize / 2,
    y: Layout.gridOffY + row * Layout.cellSize + Layout.cellSize / 2,
  };
}

// Get top-left pixel of a cell
function cellTopLeft(col, row) {
  return {
    x: Layout.gridOffX + col * Layout.cellSize + CFG.BLOCK_PAD,
    y: Layout.gridOffY + row * Layout.cellSize + CFG.BLOCK_PAD,
  };
}

// Block colour based on hp relative to maxHp
function blockColor(hp, maxHp) {
  const t = hp / maxHp;
  const idx = Math.min(
    Math.floor(t * (COLORS.BLOCK.length - 1)),
    COLORS.BLOCK.length - 1
  );
  return COLORS.BLOCK[COLORS.BLOCK.length - 1 - idx];
}

// ─────────────────────────────────────────────
// 5. INPUT HANDLING
// ─────────────────────────────────────────────

const Input = {
  down:    false,
  startX:  0,
  startY:  0,
  currentX: 0,
  currentY: 0,
  aimAngle: Math.PI / 2, // straight up
  valid:   false,        // is aim valid (pointing upward enough)?

  init() {
    canvas.addEventListener('mousedown',  e => this._start(e.clientX, e.clientY));
    canvas.addEventListener('mousemove',  e => this._move(e.clientX, e.clientY));
    canvas.addEventListener('mouseup',    e => this._end());
    canvas.addEventListener('mouseleave', e => this._cancel());

    canvas.addEventListener('touchstart', e => { e.preventDefault(); const t = e.touches[0]; this._start(t.clientX, t.clientY); }, { passive: false });
    canvas.addEventListener('touchmove',  e => { e.preventDefault(); const t = e.touches[0]; this._move(t.clientX, t.clientY); }, { passive: false });
    canvas.addEventListener('touchend',   e => { e.preventDefault(); this._end(); }, { passive: false });
  },

  _canvasPos(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width  / rect.width),
      y: (clientY - rect.top)  * (canvas.height / rect.height),
    };
  },

  _start(cx, cy) {
    if (State.phase !== 'aiming') return;
    const p = this._canvasPos(cx, cy);
    this.down    = true;
    this.startX  = p.x;
    this.startY  = p.y;
    this.currentX = p.x;
    this.currentY = p.y;
    this._calcAngle();
  },

  _move(cx, cy) {
    if (!this.down) return;
    const p = this._canvasPos(cx, cy);
    this.currentX = p.x;
    this.currentY = p.y;
    this._calcAngle();
  },

  _end() {
    if (!this.down) return;
    this.down = false;
    if (this.valid && State.phase === 'aiming') {
      startFiring();
    }
  },

  _cancel() {
    this.down = false;
    this.valid = false;
  },

  _calcAngle() {
    // Angle from launch position toward cursor
    const dx = this.currentX - State.launchX;
    const dy = this.currentY - State.launchY; // positive = downward

    // We want upward direction: dy must be negative
    const minDeg = CFG.MIN_ANGLE_DEG;
    const minRad = minDeg * Math.PI / 180;

    // Angle from positive-x axis, going counter-clockwise
    // But easier: use atan2 from launch origin
    let angle = Math.atan2(-dy, dx); // angle above horizontal (positive x)

    // Clamp to [minRad, PI - minRad]
    angle = Math.max(minRad, Math.min(Math.PI - minRad, angle));

    this.aimAngle = angle;
    this.valid = true; // angle clamp already prevents straight-down shots
  },
};

// ─────────────────────────────────────────────
// 6. PHYSICS & COLLISION
// ─────────────────────────────────────────────

// Create a ball object
function makeBall(x, y, vx, vy) {
  return { x, y, vx, vy, alive: true, landed: false, trail: [] };
}

/**
 * Step a ball forward by dt seconds.
 * Splits dt into SUBSTEPS micro-steps so the ball moves only ~1-2px per
 * sub-step, making tunneling impossible without needing complex CCD.
 * Returns an array of event descriptors.
 */
function stepBall(ball, dt) {
  if (ball.landed) return [];

  const events  = [];
  const r       = CFG.BALL_RADIUS;
  const SUBSTEPS = 6;
  const subDt   = dt / SUBSTEPS;

  const leftX  = Layout.gridOffX;
  const rightX = Layout.gridOffX + CFG.COLS * Layout.cellSize;
  const topY   = Layout.gridOffY;
  const botY   = Layout.launchZoneY;

  // Record trail point once per full step
  ball.trail.push({ x: ball.x, y: ball.y });
  if (ball.trail.length > 8) ball.trail.shift();

  for (let s = 0; s < SUBSTEPS; s++) {
    if (ball.landed) break;

    // Move
    ball.x += ball.vx * subDt;
    ball.y += ball.vy * subDt;

    // ── Wall collisions ──
    if (ball.x - r < leftX) {
      ball.x  = leftX + r;
      ball.vx = Math.abs(ball.vx);
      events.push('wall');
    } else if (ball.x + r > rightX) {
      ball.x  = rightX - r;
      ball.vx = -Math.abs(ball.vx);
      events.push('wall');
    }

    if (ball.y - r < topY) {
      ball.y  = topY + r;
      ball.vy = Math.abs(ball.vy);
      events.push('wall');
    }

    // ── Bottom — ball lands (only when moving downward to prevent
    //    immediate landing since ball starts exactly at launchZoneY) ──
    if (ball.vy > 0 && ball.y + r >= botY) {
      ball.x     = Math.max(leftX + r, Math.min(rightX - r, ball.x));
      ball.y     = botY - r;
      ball.landed = true;
      ball.alive  = false;
      events.push('land');
      break;
    }

    // ── Block collisions (check all blocks, allow multiple hits) ──
    for (const block of State.blocks) {
      if (block.hp <= 0) continue;

      const { x: bx, y: by } = cellTopLeft(block.col, block.row);
      const bw = Layout.blockW, bh = Layout.blockH;

      // Broad-phase AABB
      if (ball.x + r < bx || ball.x - r > bx + bw ||
          ball.y + r < by || ball.y - r > by + bh) continue;

      // Overlap on each axis
      const oL = (ball.x + r) - bx;
      const oR = (bx + bw)    - (ball.x - r);
      const oT = (ball.y + r) - by;
      const oB = (by + bh)    - (ball.y - r);

      if (oL <= 0 || oR <= 0 || oT <= 0 || oB <= 0) continue;

      // Push out on shallowest axis, flip velocity on that axis
      const minO = Math.min(oL, oR, oT, oB);
      if (minO === oL) { ball.x -= oL; ball.vx = -Math.abs(ball.vx); }
      else if (minO === oR) { ball.x += oR; ball.vx =  Math.abs(ball.vx); }
      else if (minO === oT) { ball.y -= oT; ball.vy = -Math.abs(ball.vy); }
      else                  { ball.y += oB; ball.vy =  Math.abs(ball.vy); }

      // Damage block once per full step (avoid multi-hit within substeps)
      if (!block._hitThisStep) {
        block._hitThisStep = true;
        block.hp--;
        block.flashTimer = 0.12;
        events.push({ type: 'hit', block });
        if (block.hp <= 0) {
          events.push({ type: 'break', block });
          State.score += block.maxHp;
        }
      }
    }

    // ── Pickup collisions ──
    for (const pu of State.pickups) {
      if (pu.collected) continue;
      const { x: px, y: py } = blockToPixel(pu.col, pu.row);
      const puR = Layout.cellSize * 0.22;
      const dx  = ball.x - px, dy = ball.y - py;
      if (dx * dx + dy * dy < (r + puR) * (r + puR)) {
        pu.collected = true;
        State.pendingBallGain++;
        events.push({ type: 'pickup', pu });
      }
    }
  }

  // Clear the per-step hit flag
  for (const block of State.blocks) block._hitThisStep = false;

  return events;
}

// ─────────────────────────────────────────────
// 7. LEVEL GENERATION
// ─────────────────────────────────────────────

// Generate a new top row of blocks/pickups for the current turn
function spawnRow() {
  const turn = State.turn;
  const baseHp = Math.max(1, Math.round(turn * CFG.HEALTH_PER_TURN));
  const spread = Math.max(1, Math.round(baseHp * 0.4));

  const gapChance    = Math.max(0.10, CFG.GAP_CHANCE_BASE - turn * 0.005);
  const pickupChance = Math.min(0.25, CFG.PICKUP_CHANCE_BASE + turn * 0.003);

  for (let col = 0; col < CFG.COLS; col++) {
    const r = Math.random();
    if (r < gapChance) continue; // empty cell
    if (r < gapChance + pickupChance) {
      // Check no block already here
      if (!State.blocks.find(b => b.col === col && b.row === 0)) {
        State.pickups.push({ col, row: 0, collected: false });
      }
      continue;
    }
    // Block
    const hp = baseHp + Math.floor(Math.random() * spread * 2) - spread + 1;
    const finalHp = Math.max(1, hp);
    State.blocks.push({ col, row: 0, hp: finalHp, maxHp: finalHp, flashTimer: 0 });
  }
}

// Shift all blocks and pickups down one row, return true if game over
function shiftDown() {
  let gameOver = false;
  for (const b of State.blocks) {
    b.row++;
    if (b.row >= CFG.ROWS) gameOver = true;
  }
  for (const pu of State.pickups) {
    pu.row++;
    if (pu.row >= CFG.ROWS) pu.collected = true; // remove pickup off bottom
  }
  // Remove off-screen
  State.blocks  = State.blocks.filter(b => b.row < CFG.ROWS && b.hp > 0);
  State.pickups = State.pickups.filter(p => !p.collected && p.row < CFG.ROWS);
  return gameOver;
}

// ─────────────────────────────────────────────
// 8. PARTICLE SYSTEM
// ─────────────────────────────────────────────

const Particles = {
  list: [],

  burst(x, y, count, colorArr) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 200;
      this.list.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.5 + Math.random() * 0.4,
        maxLife: 0.9,
        r: 2 + Math.random() * 3,
        color: colorArr[Math.floor(Math.random() * colorArr.length)],
      });
    }
  },

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 280 * dt; // gravity
      p.life -= dt;
      if (p.life <= 0) this.list.splice(i, 1);
    }
  },

  draw(c) {
    for (const p of this.list) {
      const alpha = Math.max(0, p.life / p.maxLife);
      c.globalAlpha = alpha;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, p.r * alpha, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  },
};

// ─────────────────────────────────────────────
// 9. GAME LOOP
// ─────────────────────────────────────────────

let lastTime    = 0;
let accumulator = 0;
let rafId       = null;
let shakeFrames = 0;

function gameLoop(timestamp) {
  rafId = requestAnimationFrame(gameLoop);

  const rawDt = Math.min((timestamp - lastTime) / 1000, 0.05); // cap at 50ms
  lastTime = timestamp;

  if (State.phase === 'start' || State.phase === 'gameover') {
    renderIdle();
    return;
  }
  if (State.phase === 'paused') {
    return;
  }

  accumulator += rawDt;
  const dt = CFG.FIXED_DT;
  let steps = 0;

  while (accumulator >= dt && steps < CFG.MAX_STEPS) {
    update(dt);
    accumulator -= dt;
    steps++;
  }

  Particles.update(rawDt);
  render();
}

// ── Update Logic ──
function update(dt) {
  if (State.phase === 'firing') {
    updateFiring(dt);
  } else if (State.phase === 'rolling') {
    updateRolling(dt);
  } else if (State.phase === 'shifting') {
    // shifting is handled as a one-shot, not per-frame
  }

  // Flash timers on blocks
  for (const b of State.blocks) {
    if (b.flashTimer > 0) b.flashTimer -= dt;
  }
}

// Fire balls one-by-one with a delay
let launchElapsed = 0;
let launchIndex   = 0;

function updateFiring(dt) {
  launchElapsed += dt * 1000;
  if (launchElapsed >= CFG.LAUNCH_DELAY && launchIndex < State.ballsToLaunch) {
    launchElapsed = 0;
    const speed = CFG.BALL_SPEED;
    const angle = State.launchAngle;
    const vx =  Math.cos(angle) * speed;
    const vy = -Math.sin(angle) * speed;
    State.balls.push(makeBall(State.launchX, State.launchY, vx, vy));
    launchIndex++;
    if (launchIndex === 1) Audio.launch();
  }
  // Move to rolling once all balls are launched
  if (launchIndex >= State.ballsToLaunch) {
    State.phase = 'rolling';
  }
  // Also process existing balls
  updateRolling(dt);
}

// Process active balls
function updateRolling(dt) {
  let totalHitsThisStep = 0;

  for (const ball of State.balls) {
    if (!ball.alive) continue;
    const events = stepBall(ball, dt);
    for (const ev of events) {
      if (ev === 'wall') {
        Audio.wallBounce();
      } else if (ev === 'land') {
        State.ballsLanded++;
        if (State.firstLandX === null) {
          State.firstLandX = ball.x;
        }
      } else if (typeof ev === 'object') {
        if (ev.type === 'hit') {
          totalHitsThisStep++;
          Audio.blockHit();
        }
        if (ev.type === 'break') {
          const { x, y } = blockToPixel(ev.block.col, ev.block.row);
          Particles.burst(x, y, CFG.PARTICLE_COUNT, COLORS.PARTICLE);
          Audio.blockBreak();
        }
        if (ev.type === 'pickup') {
          const { x, y } = blockToPixel(ev.pu.col, ev.pu.row);
          Particles.burst(x, y, 8, [COLORS.PICKUP, '#ffffff', COLORS.PICKUP_GLOW]);
          Audio.pickup();
        }
      }
    }
  }

  if (totalHitsThisStep >= CFG.SHAKE_THRESHOLD) {
    shakeFrames = 11;
  }

  // Check if all balls have landed (only end turn once all are fired + all landed)
  const allLaunched = State.phase === 'rolling'; // firing phase sets rolling when done
  const allDone = allLaunched && State.balls.length > 0 && State.balls.every(b => !b.alive);
  if (allDone) {
    endTurn();
  }
}

function startFiring() {
  State.phase        = 'firing';
  State.launchAngle  = Input.aimAngle;
  State.ballsToLaunch = State.ballCount;
  State.ballsFired   = 0;
  State.ballsLanded  = 0;
  State.firstLandX   = null;
  State.pendingBallGain = 0;
  State.balls        = [];
  launchElapsed      = 0;
  launchIndex        = 0;
}

function endTurn() {
  // Apply ball gains from pickups
  State.ballCount += State.pendingBallGain;

  // Update launch x from first ball to land
  if (State.firstLandX !== null) {
    const margin = CFG.BALL_RADIUS + 4;
    const minX = Layout.gridOffX + margin;
    const maxX = Layout.gridOffX + CFG.COLS * Layout.cellSize - margin;
    State.launchX = Math.max(minX, Math.min(maxX, State.firstLandX));
  }
  State.launchY = Layout.launchZoneY;

  // Remove dead blocks
  State.blocks = State.blocks.filter(b => b.hp > 0);

  // Shift blocks down
  const gameOver = shiftDown();

  if (gameOver) {
    triggerGameOver();
    return;
  }

  // Spawn new row
  State.turn++;
  spawnRow();

  // Update UI
  updateHUD();

  State.phase = 'aiming';
  State.balls = [];
}

function triggerGameOver() {
  Audio.gameOver();
  State.phase = 'gameover';

  const isNewBest = State.saveBest();

  document.getElementById('go-score').textContent = State.score;
  document.getElementById('go-best').textContent  = State.best;
  document.getElementById('go-turn').textContent  = State.turn;

  const badge = document.getElementById('new-best-badge');
  badge.classList.toggle('visible', isNewBest);

  showOverlay('gameover-screen');
  updateHUD();
}

// ─────────────────────────────────────────────
// 10. RENDERING
// ─────────────────────────────────────────────

function render() {
  const c = ctx2d;
  const { W, H } = Layout;

  const shaking = shakeFrames > 0;
  if (shaking) {
    shakeFrames--;
    c.save();
    c.translate((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5);
  }

  // Background
  c.fillStyle = COLORS.BG;
  c.fillRect(0, 0, W, H);

  drawGrid(c);
  drawBlocks(c);
  drawPickups(c);
  drawLaunchZone(c);
  drawBalls(c);
  Particles.draw(c);
  drawAim(c);
  drawDangerLine(c);

  if (shaking) c.restore();
}

function renderIdle() {
  const c = ctx2d;
  const { W, H } = Layout;
  c.fillStyle = COLORS.BG;
  c.fillRect(0, 0, W, H);
  drawGrid(c);
  drawBlocks(c);
  drawPickups(c);
}

function drawGrid(c) {
  const { gridOffX, gridOffY, cellSize } = Layout;
  const gridW = CFG.COLS * cellSize;
  const gridH = CFG.ROWS * cellSize;
  c.strokeStyle = COLORS.BG_GRID;
  c.lineWidth   = 0.5;
  for (let col = 0; col <= CFG.COLS; col++) {
    const x = gridOffX + col * cellSize;
    c.beginPath(); c.moveTo(x, gridOffY); c.lineTo(x, gridOffY + gridH); c.stroke();
  }
  for (let row = 0; row <= CFG.ROWS; row++) {
    const y = gridOffY + row * cellSize;
    c.beginPath(); c.moveTo(gridOffX, y); c.lineTo(gridOffX + gridW, y); c.stroke();
  }
}

function drawBlocks(c) {
  for (const block of State.blocks) {
    if (block.hp <= 0) continue;
    const { x: tlx, y: tly } = cellTopLeft(block.col, block.row);
    const bw = Layout.blockW, bh = Layout.blockH;
    const r = 5;
    const color = blockColor(block.hp, block.maxHp);

    // Flash effect
    const flash = block.flashTimer > 0;

    // Block fill
    c.fillStyle = flash ? '#ffffff' : color;
    roundRect(c, tlx, tly, bw, bh, r);
    c.fill();

    // Subtle border
    c.strokeStyle = flash ? '#ffffff' : 'rgba(255,255,255,0.15)';
    c.lineWidth = 1;
    roundRect(c, tlx, tly, bw, bh, r);
    c.stroke();

    // Glow for low-hp blocks
    if (!flash && block.hp === 1) {
      c.shadowColor = color;
      c.shadowBlur  = 14;
      roundRect(c, tlx, tly, bw, bh, r);
      c.fill();
    }
    c.shadowBlur = 0;

    // HP text
    const fontSize = Math.max(9, Math.min(Layout.blockW * 0.38, 18));
    c.font = `700 ${fontSize}px "Segoe UI", Arial, sans-serif`;
    c.textAlign    = 'center';
    c.textBaseline = 'middle';
    c.fillStyle    = flash ? '#000' : 'rgba(255,255,255,0.92)';
    c.shadowBlur   = 0;
    c.fillText(
      block.hp > 999 ? '...' : block.hp,
      tlx + bw / 2,
      tly + bh / 2
    );
  }
}

function drawPickups(c) {
  for (const pu of State.pickups) {
    if (pu.collected) continue;
    const { x, y } = blockToPixel(pu.col, pu.row);
    const r = Layout.cellSize * 0.22;

    // Glow
    c.shadowColor = COLORS.PICKUP;
    c.shadowBlur  = 18;
    c.fillStyle   = COLORS.PICKUP_GLOW;
    c.beginPath();
    c.arc(x, y, r * 1.5, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;

    // Orb
    c.fillStyle = COLORS.PICKUP;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();

    // '+1' label
    const fontSize = Math.max(8, Math.min(r * 1.1, 13));
    c.font = `700 ${fontSize}px "Segoe UI", Arial, sans-serif`;
    c.textAlign    = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#000';
    c.fillText('+1', x, y);
  }
}

function drawLaunchZone(c) {
  if (State.phase !== 'aiming' && State.phase !== 'firing') return;
  const { W, launchZoneY } = Layout;
  c.fillStyle = COLORS.LAUNCH_ZONE;
  c.fillRect(0, launchZoneY, W, Layout.H - launchZoneY);

  // Launch marker
  c.strokeStyle = 'rgba(0,229,255,0.4)';
  c.lineWidth   = 2;
  c.setLineDash([4, 6]);
  c.beginPath();
  c.moveTo(0, launchZoneY);
  c.lineTo(W, launchZoneY);
  c.stroke();
  c.setLineDash([]);

  // Ball indicator at launch position
  c.fillStyle = COLORS.BALL;
  c.shadowColor = COLORS.BALL;
  c.shadowBlur  = 14;
  c.beginPath();
  c.arc(State.launchX, State.launchY, CFG.BALL_RADIUS, 0, Math.PI * 2);
  c.fill();
  c.shadowBlur = 0;
}

function drawBalls(c) {
  for (const ball of State.balls) {
    if (!ball.alive) continue;

    // Trail
    for (let i = 0; i < ball.trail.length; i++) {
      const t = ball.trail[i];
      const alpha = (i / ball.trail.length) * 0.3;
      const r = CFG.BALL_RADIUS * (i / ball.trail.length) * 0.7;
      c.globalAlpha = alpha;
      c.fillStyle = COLORS.BALL;
      c.beginPath();
      c.arc(t.x, t.y, Math.max(1, r), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    // Ball glow
    c.shadowColor = COLORS.BALL;
    c.shadowBlur  = 12;
    c.fillStyle   = COLORS.BALL;
    c.beginPath();
    c.arc(ball.x, ball.y, CFG.BALL_RADIUS, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
  }
}

function drawAim(c) {
  if (State.phase !== 'aiming' || !Input.down || !Input.valid) return;

  const lx = State.launchX, ly = State.launchY;
  const angle  = Input.aimAngle;
  const speed  = CFG.BALL_SPEED;
  const vx = Math.cos(angle) * speed;
  const vy = -Math.sin(angle) * speed;

  // Simulate trajectory for preview dots
  let px = lx, py = ly, pvx = vx, pvy = vy;
  const simDt   = 0.016;
  const dotStep = 5;
  let dotCount  = 0;
  const maxDots = 80;

  c.fillStyle = COLORS.AIM_DOT;

  for (let step = 0; step < 600 && dotCount < maxDots; step++) {
    px += pvx * simDt;
    py += pvy * simDt;

    // Wall bounces in sim
    const margin = Layout.gridOffX;
    const rightEdge = Layout.gridOffX + CFG.COLS * Layout.cellSize;
    if (px - CFG.BALL_RADIUS < margin) { px = margin + CFG.BALL_RADIUS; pvx = Math.abs(pvx); }
    if (px + CFG.BALL_RADIUS > rightEdge) { px = rightEdge - CFG.BALL_RADIUS; pvx = -Math.abs(pvx); }
    if (py - CFG.BALL_RADIUS < Layout.gridOffY) { py = Layout.gridOffY + CFG.BALL_RADIUS; pvy = Math.abs(pvy); }
    if (pvy > 0 && py + CFG.BALL_RADIUS > Layout.launchZoneY) break;

    if (step % dotStep === 0) {
      const alpha = 1 - dotCount / maxDots;
      c.globalAlpha = alpha * 0.65;
      c.beginPath();
      c.arc(px, py, 3, 0, Math.PI * 2);
      c.fill();
      dotCount++;
    }
  }
  c.globalAlpha = 1;

  // Arrow at the start
  const arrowLen = 36;
  const ex = lx + Math.cos(angle) * arrowLen;
  const ey = ly - Math.sin(angle) * arrowLen;
  c.strokeStyle = COLORS.AIM_LINE;
  c.lineWidth   = 2;
  c.beginPath();
  c.moveTo(lx, ly - CFG.BALL_RADIUS - 2);
  c.lineTo(ex, ey);
  c.stroke();
}

function drawDangerLine(c) {
  // Highlight bottom boundary
  const y = Layout.gridOffY + CFG.ROWS * Layout.cellSize;
  c.strokeStyle = COLORS.DANGER_LINE;
  c.lineWidth   = 2;
  c.setLineDash([6, 4]);
  c.beginPath();
  c.moveTo(Layout.gridOffX, y);
  c.lineTo(Layout.gridOffX + CFG.COLS * Layout.cellSize, y);
  c.stroke();
  c.setLineDash([]);
}

// Utility: draw a rounded rectangle path
function roundRect(c, x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y,     x + w, y + h, r);
  c.arcTo(x + w, y + h, x,     y + h, r);
  c.arcTo(x,     y + h, x,     y,     r);
  c.arcTo(x,     y,     x + w, y,     r);
  c.closePath();
}

// ─────────────────────────────────────────────
// 11. UI HELPERS
// ─────────────────────────────────────────────

function showOverlay(id) {
  document.querySelectorAll('.overlay').forEach(el => {
    el.classList.toggle('active', el.id === id);
  });
}

function hideAllOverlays() {
  document.querySelectorAll('.overlay').forEach(el => el.classList.remove('active'));
}

function updateHUD() {
  document.getElementById('hud-score').textContent = State.score;
  document.getElementById('hud-best').textContent  = State.best;
  document.getElementById('hud-turn').textContent  = State.turn;
  document.getElementById('hud-balls').textContent = State.ballCount;
}

// ─────────────────────────────────────────────
// 12. INIT
// ─────────────────────────────────────────────

function initGame() {
  State.reset();
  resizeCanvas();
  State.launchX = Layout.W / 2;
  State.launchY = Layout.launchZoneY;
  Particles.list = [];

  // Spawn the first few rows so there's something to shoot at immediately
  const startRows = 3;
  for (let i = 0; i < startRows; i++) {
    // Shift all existing entities down to make room at the top
    for (const b of State.blocks) b.row++;
    for (const p of State.pickups) p.row++;
    spawnRow(); // always places at row 0
  }

  updateHUD();
}

function startGame() {
  hideAllOverlays();
  initGame();
  State.phase = 'aiming';
  if (!rafId) {
    lastTime = performance.now();
    rafId = requestAnimationFrame(gameLoop);
  }
}

function restartGame() {
  hideAllOverlays();
  initGame();
  State.phase = 'aiming';
}

// ── Button Wiring ──

document.getElementById('btn-play').addEventListener('click', () => {
  startGame();
});

document.getElementById('btn-restart').addEventListener('click', () => {
  restartGame();
});

document.getElementById('btn-restart-pause').addEventListener('click', () => {
  restartGame();
});

document.getElementById('btn-resume').addEventListener('click', () => {
  if (State.phase === 'paused') {
    State.phase = State.prevPhase;
    hideAllOverlays();
    lastTime = performance.now();
  }
});

document.getElementById('btn-pause').addEventListener('click', () => {
  if (State.phase === 'paused') {
    State.phase = State.prevPhase;
    hideAllOverlays();
    lastTime = performance.now();
  } else if (State.phase !== 'start' && State.phase !== 'gameover') {
    State.prevPhase = State.phase;
    State.phase = 'paused';
    showOverlay('pause-screen');
  }
});

document.getElementById('btn-mute').addEventListener('click', () => {
  const m = Audio.toggle();
  document.getElementById('btn-mute').textContent = m ? '🔇' : '🔊';
});

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    document.getElementById('btn-pause').click();
  }
  if (e.key === 'm' || e.key === 'M') {
    document.getElementById('btn-mute').click();
  }
});

// Resize handler
window.addEventListener('resize', () => {
  resizeCanvas();
  State.launchY = Layout.launchZoneY;
  // Clamp launchX within new bounds
  if (State.phase !== 'start') {
    const margin = CFG.BALL_RADIUS + 4;
    const minX = Layout.gridOffX + margin;
    const maxX = Layout.gridOffX + CFG.COLS * Layout.cellSize - margin;
    State.launchX = Math.max(minX, Math.min(maxX, State.launchX));
  }
});

// Show best on start screen
function updateStartScreen() {
  const el = document.getElementById('start-best-score');
  if (State.best > 0) {
    el.textContent = `BEST: ${State.best}`;
  }
}

// ── Bootstrap ──
(function bootstrap() {
  resizeCanvas();
  Input.init();
  updateStartScreen();
  updateHUD();

  // Apply stored mute pref
  if (Audio.muted) {
    document.getElementById('btn-mute').textContent = '🔇';
  }

  // Start the render loop in idle mode (shows start screen canvas bg)
  lastTime = performance.now();
  rafId = requestAnimationFrame(gameLoop);

  showOverlay('start-screen');
})();
