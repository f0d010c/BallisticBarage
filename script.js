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
  PICKUP_CHANCE_BASE: 0.04, // base chance of pickup per row cell (lower = fewer ball gains)
  GAP_CHANCE_BASE:    0.20, // (legacy, kept for reference — pattern spawner ignores this)
  MIN_HEALTH:         1,
  HEALTH_PER_TURN:    0.9,  // avg health growth per turn

  // Special blocks (enabled from these turns onward)
  ARMORED_MIN_TURN:    2,
  EXPLOSIVE_MIN_TURN:  3,
  STONE_MIN_TURN:      5,
  ARMORED_CHANCE:      0.16,
  EXPLOSIVE_CHANCE:    0.09,
  STONE_CHANCE:        0.05,

  // Combo
  COMBO_WINDOW:     1.5,    // seconds between breaks to maintain combo

  // Juice
  SHAKE_THRESHOLD:  3,      // min simultaneous hits to trigger shake
  PARTICLE_COUNT:   12,
};

// Colours (drawn on canvas)
const COLORS = {
  BG:          '#04060f',
  BG_GRID:     'rgba(0,240,255,0.022)',
  BALL:        '#00f0ff',
  BALL_GLOW:   'rgba(0,240,255,0.4)',
  PICKUP:      '#39ff14',
  PICKUP_GLOW: 'rgba(57,255,20,0.4)',
  BLOCK:       [          // gradient by health tier
    '#0d2040', // tier 0
    '#0a4a90', // tier 1
    '#0065cc', // tier 2
    '#0099cc', // tier 3
    '#00c89a', // tier 4
    '#88e000', // tier 5
    '#ffaa00', // tier 6
    '#ff4400', // tier 7
    '#ff0066', // tier 8+
  ],
  PARTICLE:    ['#00f0ff','#ff1a5e','#ffcc00','#39ff14','#ff6600'],
  WALL_LINE:      'rgba(0,240,255,0.1)',
  AIM_LINE:       'rgba(0,240,255,0.65)',
  AIM_DOT:        '#00f0ff',
  GHOST_BALL:     'rgba(0,240,255,0.18)',
  LAUNCH_ZONE:    'rgba(0,240,255,0.05)',
  DANGER_LINE:    'rgba(255,26,94,0.55)',
  STONE:          '#3a3a55',
  ARMORED_BORDER: '#ffcc00',
  EXPLOSIVE_GLOW: '#ff6600',
};

// ─────────────────────────────────────────────
// BALL SKINS
// ─────────────────────────────────────────────

const SKINS = {
  plasma: { name: 'PLASMA', color: '#00f0ff',              glow: 'rgba(0,240,255,0.28)',   glowEdge: 'rgba(0,240,255,0)',   shadow: '#00f0ff',  spec: 'rgba(255,255,255,0.88)' },
  magma:  { name: 'MAGMA',  color: '#ff5500',              glow: 'rgba(255,85,0,0.28)',    glowEdge: 'rgba(255,85,0,0)',    shadow: '#ff5500',  spec: 'rgba(255,220,180,0.85)' },
  void:   { name: 'VOID',   color: '#aa44ff',              glow: 'rgba(170,68,255,0.28)',  glowEdge: 'rgba(170,68,255,0)', shadow: '#aa44ff',  spec: 'rgba(220,200,255,0.85)' },
  nova:   { name: 'NOVA',   color: '#ffcc00',              glow: 'rgba(255,204,0,0.28)',   glowEdge: 'rgba(255,204,0,0)',  shadow: '#ffcc00',  spec: 'rgba(255,255,220,0.88)' },
  ghost:  { name: 'GHOST',  color: 'rgba(210,230,255,0.9)',glow: 'rgba(200,220,255,0.22)', glowEdge: 'rgba(200,220,255,0)',shadow: '#c8dcff',  spec: 'rgba(255,255,255,0.95)' },
};

function getSkin() { return SKINS[State.activeSkin] || SKINS.plasma; }

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
    armorHit()    { tone(620, 'square',   0.07, 0.12, 0.003, 0.06); },
    explosion()   { noise(0.25, 0.28); tone(55, 'sawtooth', 0.28, 0.22, 0.005, 0.25); },
    combo(n)      { const f = 440 + Math.min(n - 2, 6) * 100; tone(f, 'sine', 0.15, 0.3, 0.005, 0.1); tone(f * 1.5, 'triangle', 0.08, 0.2, 0.01); },
    screenClear() { tone(550, 'sine', 0.35, 0.35, 0.01, 0.25); tone(880, 'sine', 0.25, 0.28, 0.05, 0.2); tone(1320, 'sine', 0.15, 0.22, 0.1, 0.15); },
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

  // Combo
  combo:       0,
  comboTimer:  0,
  comboPopups: [],

  // Skins & clear banners
  activeSkin:   localStorage.getItem('bb_skin') || 'plasma',
  clearBanners: [],

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
    this.combo          = 0;
    this.comboTimer     = 0;
    this.comboPopups    = [];
    this.activeSkin     = localStorage.getItem('bb_skin') || 'plasma';
    this.clearBanners   = [];
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

    canvas.addEventListener('touchstart',  e => { e.preventDefault(); const t = e.touches[0]; this._start(t.clientX, t.clientY); }, { passive: false });
    canvas.addEventListener('touchmove',   e => { e.preventDefault(); const t = e.touches[0]; this._move(t.clientX, t.clientY); }, { passive: false });
    canvas.addEventListener('touchend',    e => { e.preventDefault(); this._end(); }, { passive: false });
    canvas.addEventListener('touchcancel', e => { e.preventDefault(); this._cancel(); }, { passive: false });
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
    // If pointer is dragged below the launch zone, cancel the shot
    if (this.currentY > Layout.launchZoneY) {
      this.valid = false;
      return;
    }

    // Angle from launch position toward cursor
    const dx = this.currentX - State.launchX;
    const dy = this.currentY - State.launchY; // positive = downward

    const minDeg = CFG.MIN_ANGLE_DEG;
    const minRad = minDeg * Math.PI / 180;

    // Angle from positive-x axis, going counter-clockwise
    let angle = Math.atan2(-dy, dx); // angle above horizontal (positive x)

    // Clamp to [minRad, PI - minRad]
    angle = Math.max(minRad, Math.min(Math.PI - minRad, angle));

    this.aimAngle = angle;
    this.valid = true;
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
        if (block.type === 'armored') {
          block.flashTimer = 0.12;
          block.armorHits = (block.armorHits || 0) + 1;
          if (block.armorHits >= 2) {
            block.armorHits = 0;
            block.hp--;
            events.push({ type: 'hit', block });
            if (block.hp <= 0) events.push({ type: 'break', block });
          } else {
            events.push({ type: 'armorhit', block }); // armor absorbed the hit
          }
        } else {
          block.hp--;
          block.flashTimer = 0.12;
          events.push({ type: 'hit', block });
          if (block.hp <= 0) events.push({ type: 'break', block });
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

// ── Spawn helpers ──

function _shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Returns a 'B'/'E'/'P' layout array for one row based on turn progression.
function _rowLayout(turn) {
  const allCols = Array.from({ length: CFG.COLS }, (_, i) => i);
  const r = Math.random();
  let blockCols;

  if (turn <= 4) {
    // Sparse: 3–4 blocks spread across the row
    const count = Math.random() < 0.4 ? 4 : 3;
    blockCols = new Set(_shuffle(allCols).slice(0, count));

  } else if (turn <= 9) {
    // Alternating checkerboard OR gap-wall with 2 gaps
    if (r < 0.45) {
      const offset = Math.random() < 0.5 ? 0 : 1;
      blockCols = new Set(allCols.filter(c => c % 2 === offset));
    } else {
      const gaps = new Set(_shuffle(allCols).slice(0, 2));
      blockCols = new Set(allCols.filter(c => !gaps.has(c)));
    }

  } else if (turn <= 18) {
    // Corridor (2 adjacent gaps) OR single-gap wall
    if (r < 0.5) {
      const gapStart = Math.floor(Math.random() * (CFG.COLS - 1));
      blockCols = new Set(allCols.filter(c => c !== gapStart && c !== gapStart + 1));
    } else {
      const gap = Math.floor(Math.random() * CFG.COLS);
      blockCols = new Set(allCols.filter(c => c !== gap));
    }

  } else {
    // Late game: almost solid — 1 gap, occasionally 2 spread gaps
    if (r < 0.65) {
      const gap = Math.floor(Math.random() * CFG.COLS);
      blockCols = new Set(allCols.filter(c => c !== gap));
    } else {
      const gaps = new Set(_shuffle(allCols).slice(0, 2));
      blockCols = new Set(allCols.filter(c => !gaps.has(c)));
    }
  }

  const layout = new Array(CFG.COLS).fill('E');
  blockCols.forEach(c => { layout[c] = 'B'; });

  // Sprinkle pickups in some empty cells
  const pickupChance = Math.min(0.22, CFG.PICKUP_CHANCE_BASE + turn * 0.003);
  for (let i = 0; i < CFG.COLS; i++) {
    if (layout[i] === 'E' && Math.random() < pickupChance) layout[i] = 'P';
  }
  return layout;
}

// Dense burst layout (after screen clear): solid row with exactly 1 gap
function _burstLayout() {
  const layout = new Array(CFG.COLS).fill('B');
  layout[Math.floor(Math.random() * CFG.COLS)] = 'E';
  return layout;
}

// Generate a new row of blocks/pickups.
// targetRow: which grid row to place at (0 = top). dense: solid burst for screen-clear penalty.
function spawnRow(targetRow = 0, dense = false) {
  const turn = State.turn;
  const baseHp = Math.max(1, Math.round(turn * CFG.HEALTH_PER_TURN));
  const spread = Math.max(1, Math.round(baseHp * 0.4));
  const slideStart = -Layout.cellSize * (targetRow + 1);
  const occupied = new Set(State.blocks.filter(b => b.row === targetRow).map(b => b.col));

  const layout = dense ? _burstLayout() : _rowLayout(turn);

  let stoneCount = 0;
  const placedExplosive = new Set();

  for (let col = 0; col < CFG.COLS; col++) {
    if (occupied.has(col)) continue;
    const cell = layout[col];

    if (cell === 'P') {
      State.pickups.push({ col, row: targetRow, collected: false, slideOffset: slideStart });
      continue;
    }
    if (cell !== 'B') continue;

    // Type: enforce max 2 stone per row, no adjacent explosives
    let type = 'normal';
    const tr = Math.random();
    const sc = CFG.STONE_CHANCE, ec = CFG.EXPLOSIVE_CHANCE, ac = CFG.ARMORED_CHANCE;
    const noAdjExp = !placedExplosive.has(col - 1) && !placedExplosive.has(col + 1);

    if      (turn >= CFG.STONE_MIN_TURN     && stoneCount < 2 && tr < sc)        type = 'stone';
    else if (turn >= CFG.EXPLOSIVE_MIN_TURN && noAdjExp        && tr < sc + ec)  type = 'explosive';
    else if (turn >= CFG.ARMORED_MIN_TURN                      && tr < sc+ec+ac) type = 'armored';

    if (type === 'stone')     stoneCount++;
    if (type === 'explosive') placedExplosive.add(col);

    let hp = baseHp + Math.floor(Math.random() * spread * 2) - spread + 1;
    hp = Math.max(1, hp);
    if (type === 'stone')   hp = Math.ceil(hp * 5);
    if (type === 'armored') hp = Math.ceil(hp * 1.5);

    State.blocks.push({
      col, row: targetRow, hp, maxHp: hp, type,
      flashTimer: 0, armorHits: 0, slideOffset: slideStart,
    });
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

function getAdjacentBlocks(col, row) {
  return State.blocks.filter(b =>
    b.hp > 0 &&
    ((Math.abs(b.col - col) === 1 && b.row === row) ||
     (Math.abs(b.row - row) === 1 && b.col === col))
  );
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
let fastForward = false;

function gameLoop(timestamp) {
  rafId = requestAnimationFrame(gameLoop);

  const rawDt = Math.min((timestamp - lastTime) / 1000, 0.05) * (fastForward ? 5 : 1);
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

  // Flash timers + slide-in on blocks
  for (const b of State.blocks) {
    if (b.flashTimer > 0) b.flashTimer -= dt;
    if (b.slideOffset < 0) b.slideOffset = Math.min(0, b.slideOffset + Layout.cellSize * 4 * dt);
  }

  // Slide-in on pickups
  for (const p of State.pickups) {
    if (p.slideOffset < 0) p.slideOffset = Math.min(0, p.slideOffset + Layout.cellSize * 4 * dt);
  }

  // Combo timer — reset combo once the window expires
  if (State.comboTimer > 0) {
    State.comboTimer -= dt;
    if (State.comboTimer <= 0) State.combo = 0;
  }

  // Float combo popups upward
  for (let i = State.comboPopups.length - 1; i >= 0; i--) {
    const p = State.comboPopups[i];
    p.y  -= 35 * dt;
    p.life -= dt;
    if (p.life <= 0) State.comboPopups.splice(i, 1);
  }

  // Clear banners
  for (let i = State.clearBanners.length - 1; i >= 0; i--) {
    const b = State.clearBanners[i];
    b.life -= dt;
    if (b.life <= 0) State.clearBanners.splice(i, 1);
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
  const explosionQueue = [];

  for (const ball of State.balls) {
    if (!ball.alive) continue;
    const events = stepBall(ball, dt);
    for (const ev of events) {
      if (ev === 'wall') {
        Audio.wallBounce();
      } else if (ev === 'land') {
        State.ballsLanded++;
        if (State.firstLandX === null) State.firstLandX = ball.x;
      } else if (typeof ev === 'object') {
        if (ev.type === 'hit') {
          totalHitsThisStep++;
          Audio.blockHit();
        }
        if (ev.type === 'armorhit') {
          totalHitsThisStep++;
          Audio.armorHit();
        }
        if (ev.type === 'break') {
          State.combo = Math.min(State.combo + 1, 10);
          State.comboTimer = CFG.COMBO_WINDOW;
          State.score += ev.block.maxHp * State.combo;
          updateHUD();
          const { x, y } = blockToPixel(ev.block.col, ev.block.row);
          Particles.burst(x, y, CFG.PARTICLE_COUNT, COLORS.PARTICLE);
          Audio.blockBreak();
          if (State.combo >= 2) {
            State.comboPopups.push({
              text: `x${State.combo}`, x, y: y - Layout.cellSize * 0.3,
              life: 0.9, maxLife: 0.9, color: comboColor(State.combo),
            });
            Audio.combo(State.combo);
          }
          if (ev.block.type === 'explosive') explosionQueue.push(ev.block);
        }
        if (ev.type === 'pickup') {
          const { x, y } = blockToPixel(ev.pu.col, ev.pu.row);
          Particles.burst(x, y, 8, [COLORS.PICKUP, '#ffffff', COLORS.PICKUP_GLOW]);
          Audio.pickup();
        }
      }
    }
  }

  // Explosion chain reactions — damage scales with the exploder's maxHp
  while (explosionQueue.length > 0) {
    const src = explosionQueue.shift();
    // Exponential damage: each tier of explosive hits harder
    const blastDmg = Math.max(1, Math.ceil(src.maxHp * 0.6));
    for (const nb of getAdjacentBlocks(src.col, src.row)) {
      if (nb.type === 'stone') continue;
      nb.flashTimer = 0.18;
      if (nb.type === 'armored') {
        // Each blast point counts as one armor hit
        nb.armorHits = (nb.armorHits || 0) + blastDmg;
        const hpDrain = Math.floor(nb.armorHits / 2);
        nb.armorHits = nb.armorHits % 2;
        nb.hp = Math.max(0, nb.hp - hpDrain);
      } else {
        nb.hp = Math.max(0, nb.hp - blastDmg);
      }
      if (nb.hp <= 0) {
        State.combo = Math.min(State.combo + 1, 10);
        State.comboTimer = CFG.COMBO_WINDOW;
        State.score += nb.maxHp * State.combo;
        updateHUD();
        const { x, y } = blockToPixel(nb.col, nb.row);
        Particles.burst(x, y, CFG.PARTICLE_COUNT, COLORS.PARTICLE);
        Audio.explosion();
        if (nb.type === 'explosive') explosionQueue.push(nb);
      }
    }
  }

  if (totalHitsThisStep >= CFG.SHAKE_THRESHOLD) shakeFrames = 11;

  // Check if all balls have landed (only end turn once all are fired + all landed)
  const allLaunched = State.phase === 'rolling';
  const allDone = allLaunched && State.balls.length > 0 && State.balls.every(b => !b.alive);
  if (allDone) endTurn();
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
  State.combo        = 0;
  State.comboTimer   = 0;
  State.comboPopups  = [];
  document.getElementById('btn-fast').style.display = '';
}

function endTurn() {
  fastForward = false;
  const btn = document.getElementById('btn-fast');
  btn.style.display = 'none';
  btn.textContent = '⏩';

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

  // Remove dead blocks — check for screen clear before shift
  State.blocks = State.blocks.filter(b => b.hp > 0);
  const screenCleared = State.blocks.length === 0;

  // Shift blocks down
  const gameOver = shiftDown();

  if (gameOver) {
    triggerGameOver();
    return;
  }

  State.turn++;

  if (screenCleared) {
    // Bonus points scale with turn — big reward for clearing late boards
    const bonus = State.turn * 100;
    State.score += bonus;
    updateHUD();

    // Particle cascade across the grid
    const cols = CFG.COLS, rows = CFG.ROWS;
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row += 2) {
        const { x, y } = blockToPixel(col, row);
        Particles.burst(x, y, 5, ['#ffcc00', '#00f0ff', '#ff1a5e', '#39ff14']);
      }
    }

    // Trigger clear animation banner
    State.clearBanners.push({
      text:    'SCREEN CLEAR!',
      subtext: `+${bonus} PTS`,
      x: Layout.W / 2,
      y: Layout.H * 0.42,
      life:    2.4,
      maxLife: 2.4,
    });
    Audio.screenClear();

    // Spawn 3 dense rows as the penalty wave (2-3× default)
    spawnRow(0, true);
    spawnRow(1, true);
    spawnRow(2, false);
  } else {
    spawnRow(0, false);
  }

  updateHUD();
  State.phase = 'aiming';
  State.balls = [];
}

function triggerGameOver() {
  Audio.gameOver();
  State.phase = 'gameover';

  submitScore(); // async, fire-and-forget
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

  // Vignette — darken corners, subtle top glow
  const vignette = c.createRadialGradient(W * 0.5, H * 0.42, H * 0.1, W * 0.5, H * 0.5, H * 0.88);
  vignette.addColorStop(0, 'transparent');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  c.fillStyle = vignette;
  c.fillRect(0, 0, W, H);

  drawGrid(c);
  drawBlocks(c);
  drawPickups(c);
  drawLaunchZone(c);
  drawBalls(c);
  Particles.draw(c);
  drawAim(c);
  drawDangerLine(c);
  drawComboPopups(c);
  drawClearBanners(c);

  if (shaking) c.restore();

  // Tick the in-flight ball count in HUD
  if (State.phase === 'firing' || State.phase === 'rolling') {
    document.getElementById('hud-balls').textContent = State.balls.filter(b => b.alive).length;
  }
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

  // Subtle grid lines
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

  // Crosshair dots at intersections — targeting reticle aesthetic
  c.fillStyle = 'rgba(0,240,255,0.18)';
  for (let col = 0; col <= CFG.COLS; col++) {
    for (let row = 0; row <= CFG.ROWS; row++) {
      c.beginPath();
      c.arc(gridOffX + col * cellSize, gridOffY + row * cellSize, 1, 0, Math.PI * 2);
      c.fill();
    }
  }
}

function drawBlocks(c) {
  for (const block of State.blocks) {
    if (block.hp <= 0) continue;

    // Slide-in: offset y upward while animating
    const yOff = block.slideOffset || 0;
    const { x: tlx, y: tlyBase } = cellTopLeft(block.col, block.row);
    const tly = tlyBase + yOff;
    const bw = Layout.blockW, bh = Layout.blockH;
    const r = 5;

    const isStone = block.type === 'stone';
    const color   = isStone ? COLORS.STONE : blockColor(block.hp, block.maxHp);
    const flash   = block.flashTimer > 0;

    // Block fill
    c.fillStyle = flash ? '#ffffff' : color;
    roundRect(c, tlx, tly, bw, bh, r);
    c.fill();

    // Inner lighting: top highlight + bottom shadow for depth
    if (!flash) {
      c.save();
      c.beginPath(); roundRect(c, tlx, tly, bw, bh, r); c.clip();
      c.fillStyle = 'rgba(255,255,255,0.16)';
      c.fillRect(tlx, tly, bw, bh * 0.42);
      c.fillStyle = 'rgba(0,0,0,0.28)';
      c.fillRect(tlx, tly + bh * 0.60, bw, bh * 0.40);
      c.restore();
    }

    // Stone: diagonal hatch overlay
    if (isStone && !flash) {
      c.save();
      c.beginPath(); roundRect(c, tlx, tly, bw, bh, r); c.clip();
      c.strokeStyle = 'rgba(255,255,255,0.1)';
      c.lineWidth = 1.5;
      for (let i = -bh; i < bw + bh; i += 10) {
        c.beginPath();
        c.moveTo(tlx + i, tly);
        c.lineTo(tlx + i + bh, tly + bh);
        c.stroke();
      }
      c.restore();
    }

    // Explosive: pulsing orange glow border
    if (block.type === 'explosive' && !flash) {
      const pulse = (Math.sin(Date.now() * 0.006) + 1) / 2;
      c.shadowColor = COLORS.EXPLOSIVE_GLOW;
      c.shadowBlur  = 8 + pulse * 8;
      c.strokeStyle = `rgba(255,120,0,${0.65 + pulse * 0.35})`;
      c.lineWidth = 2;
      roundRect(c, tlx + 1, tly + 1, bw - 2, bh - 2, r);
      c.stroke();
      c.shadowBlur = 0;
    }

    // Armored: gold border (+ crack when first armor-hit absorbed)
    if (block.type === 'armored' && !flash) {
      c.strokeStyle = COLORS.ARMORED_BORDER;
      c.lineWidth = 2;
      roundRect(c, tlx + 1, tly + 1, bw - 2, bh - 2, r);
      c.stroke();
      if (block.armorHits > 0) {
        c.strokeStyle = 'rgba(255,255,255,0.55)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(tlx + bw * 0.35, tly + bh * 0.18);
        c.lineTo(tlx + bw * 0.50, tly + bh * 0.55);
        c.lineTo(tlx + bw * 0.66, tly + bh * 0.82);
        c.stroke();
      }
    }

    // Subtle base border
    c.strokeStyle = flash ? '#ffffff' : 'rgba(255,255,255,0.15)';
    c.lineWidth = 1;
    roundRect(c, tlx, tly, bw, bh, r);
    c.stroke();

    // Glow for low-hp (non-stone) blocks
    if (!flash && !isStone && block.hp === 1) {
      c.shadowColor = color;
      c.shadowBlur  = 14;
      roundRect(c, tlx, tly, bw, bh, r);
      c.fill();
    }
    c.shadowBlur = 0;

    // HP text (stone shows ∞)
    const fontSize = Math.max(8, Math.min(Layout.blockW * 0.36, 16));
    c.font = `700 ${fontSize}px 'Orbitron', 'Segoe UI', sans-serif`;
    c.textAlign    = 'center';
    c.textBaseline = 'middle';
    c.fillStyle    = flash ? '#000' : (isStone ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.92)');
    c.fillText(block.hp > 999 ? '...' : block.hp, tlx + bw / 2, tly + bh / 2);

    // Small type badge (bottom-right corner)
    if (!flash) {
      const badgeSize = Math.max(6, bh * 0.2);
      c.font = `700 ${badgeSize}px 'Orbitron', 'Segoe UI', sans-serif`;
      c.textAlign    = 'right';
      c.textBaseline = 'bottom';
      if (block.type === 'armored') {
        c.fillStyle = 'rgba(255,215,0,0.85)';
        c.fillText('◆', tlx + bw - 3, tly + bh - 2);
      } else if (block.type === 'explosive') {
        c.fillStyle = 'rgba(255,120,0,0.9)';
        c.fillText('!', tlx + bw - 3, tly + bh - 2);
      }
    }

    // Danger pulse for blocks in the last two rows
    if (block.row >= CFG.ROWS - 2) {
      const pulse = (Math.sin(Date.now() * 0.008) + 1) / 2;
      c.globalAlpha = 0.28 + pulse * 0.32;
      c.fillStyle = '#ff3d71';
      roundRect(c, tlx, tly, bw, bh, r);
      c.fill();
      c.globalAlpha = 1;
    }
  }
}

function drawPickups(c) {
  for (const pu of State.pickups) {
    if (pu.collected) continue;
    const yOff = pu.slideOffset || 0;
    const { x, y: yBase } = blockToPixel(pu.col, pu.row);
    const y = yBase + yOff;
    const r = Layout.cellSize * 0.22;
    const pulse = (Math.sin(Date.now() * 0.004) + 1) / 2;

    // Outer pulsing ring
    c.save();
    c.globalAlpha = 0.22 + pulse * 0.28;
    c.strokeStyle = COLORS.PICKUP;
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(x, y, r * (1.85 + pulse * 0.38), 0, Math.PI * 2);
    c.stroke();
    c.restore();

    // Glow shadow
    c.shadowColor = COLORS.PICKUP;
    c.shadowBlur  = 14 + pulse * 10;

    // Orb with radial gradient (white specular → green → dark edge)
    const grad = c.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    grad.addColorStop(0,   '#ffffff');
    grad.addColorStop(0.3, COLORS.PICKUP);
    grad.addColorStop(1,   'rgba(10,60,10,0.85)');
    c.fillStyle = grad;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;

    // '+1' label
    const fontSize = Math.max(7, Math.min(r * 0.95, 11));
    c.font = `700 ${fontSize}px 'Orbitron', sans-serif`;
    c.textAlign    = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(0,0,0,0.85)';
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
  const _skin = getSkin();
  c.fillStyle = _skin.color;
  c.shadowColor = _skin.shadow;
  c.shadowBlur  = 14;
  c.beginPath();
  c.arc(State.launchX, State.launchY, CFG.BALL_RADIUS, 0, Math.PI * 2);
  c.fill();
  c.shadowBlur = 0;
}

function drawBalls(c) {
  const skin = getSkin();
  for (const ball of State.balls) {
    if (!ball.alive) continue;

    // Trail
    for (let i = 0; i < ball.trail.length; i++) {
      const t = ball.trail[i];
      const frac = i / ball.trail.length;
      c.globalAlpha = frac * 0.32;
      c.fillStyle = skin.color;
      c.beginPath();
      c.arc(t.x, t.y, Math.max(1, CFG.BALL_RADIUS * frac * 0.72), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    const r = CFG.BALL_RADIUS;

    // Outer diffuse glow
    const glowGrad = c.createRadialGradient(ball.x, ball.y, r * 0.5, ball.x, ball.y, r * 3.2);
    glowGrad.addColorStop(0, skin.glow);
    glowGrad.addColorStop(1, skin.glowEdge);
    c.fillStyle = glowGrad;
    c.beginPath();
    c.arc(ball.x, ball.y, r * 3.2, 0, Math.PI * 2);
    c.fill();

    // Ball body
    c.shadowColor = skin.shadow;
    c.shadowBlur  = 20;
    c.fillStyle   = skin.color;
    c.beginPath();
    c.arc(ball.x, ball.y, r, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;

    // Inner specular highlight
    c.fillStyle = skin.spec;
    c.beginPath();
    c.arc(ball.x - r * 0.24, ball.y - r * 0.24, r * 0.38, 0, Math.PI * 2);
    c.fill();
  }
}

function drawAim(c) {
  if (State.phase !== 'aiming' || !Input.down) return;

  const lx = State.launchX, ly = State.launchY;

  // Show cancel indicator when dragged below the floor
  if (!Input.valid) {
    const r = 12;
    const xCy = ly - CFG.BALL_RADIUS - r - 6;
    c.save();
    c.strokeStyle = 'rgba(255, 80, 80, 0.9)';
    c.lineWidth = 3.5;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(lx - r, xCy - r);
    c.lineTo(lx + r, xCy + r);
    c.moveTo(lx + r, xCy - r);
    c.lineTo(lx - r, xCy + r);
    c.stroke();
    c.restore();
    return;
  }

  const angle = Input.aimAngle;
  const speed = CFG.BALL_SPEED;
  const vx = Math.cos(angle) * speed;
  const vy = -Math.sin(angle) * speed;

  // Simulate trajectory for preview dots
  let px = lx, py = ly, pvx = vx, pvy = vy;
  const simDt   = 0.016;
  const dotStep = 6;
  let dotCount  = 0;
  const maxDots = 45;

  c.save();
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
      const t = dotCount / maxDots;          // 0 = near launcher, 1 = far
      const alpha = (1 - t * 0.75) * 0.88;  // fade from 0.88 → 0.22
      const dotR  = 7 - t * 4;              // shrink from 7px → 3px

      c.globalAlpha = alpha;
      c.fillStyle = 'rgba(210, 225, 255, 1)';
      c.beginPath();
      c.arc(px, py, Math.max(dotR, 2.5), 0, Math.PI * 2);
      c.fill();
      dotCount++;
    }
  }
  c.restore();
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

function comboColor(n) {
  const cols = ['#ffeb3b', '#ff9800', '#ff3d71', '#e040fb', '#00e5ff'];
  return cols[Math.min(n - 2, cols.length - 1)];
}

function drawComboPopups(c) {
  for (const p of State.comboPopups) {
    const alpha = p.life / p.maxLife;
    c.globalAlpha = alpha;
    c.font = `900 ${Math.round(17 + (1 - alpha) * 8)}px 'Orbitron', 'Segoe UI', sans-serif`;
    c.textAlign    = 'center';
    c.textBaseline = 'middle';
    c.fillStyle    = p.color;
    c.shadowColor  = p.color;
    c.shadowBlur   = 10;
    c.fillText(p.text, p.x, p.y);
    c.shadowBlur = 0;
  }
  c.globalAlpha = 1;
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
    for (const b of State.blocks) b.row++;
    for (const p of State.pickups) p.row++;
    spawnRow();
  }
  // No slide animation for the initial blocks — they appear instantly
  for (const b of State.blocks) b.slideOffset = 0;
  for (const p of State.pickups) p.slideOffset = 0;

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

document.getElementById('btn-fast').addEventListener('click', () => {
  if (State.phase !== 'firing' && State.phase !== 'rolling') return;
  fastForward = !fastForward;
  document.getElementById('btn-fast').textContent = fastForward ? '▶▶' : '⏩';
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

// ─────────────────────────────────────────────
// 13. CLEAR BANNER RENDERER
// ─────────────────────────────────────────────

function drawClearBanners(c) {
  for (const b of State.clearBanners) {
    const t = 1 - b.life / b.maxLife;
    const alpha = t < 0.12 ? t / 0.12 : t > 0.65 ? Math.max(0, 1 - (t - 0.65) / 0.35) : 1;
    const scale = 0.72 + t * 0.28;
    c.save();
    c.globalAlpha = alpha;
    c.translate(b.x, b.y);
    c.scale(scale, scale);
    const fs1 = Math.round(Layout.W * 0.082);
    c.font = `900 ${fs1}px 'Orbitron', sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = '#ffcc00'; c.shadowBlur = 30; c.fillStyle = '#ffcc00';
    c.fillText(b.text, 0, -fs1 * 0.6);
    const fs2 = Math.round(Layout.W * 0.052);
    c.font = `700 ${fs2}px 'Orbitron', sans-serif`;
    c.shadowColor = '#00f0ff'; c.shadowBlur = 20; c.fillStyle = '#00f0ff';
    c.fillText(b.subtext, 0, fs1 * 0.55);
    c.shadowBlur = 0;
    c.restore();
  }
  c.globalAlpha = 1;
}

// ─────────────────────────────────────────────
// 14. SKINS UI
// ─────────────────────────────────────────────

function initSkinSelector() {
  const grid = document.getElementById('skin-grid');
  if (!grid) return;
  while (grid.firstChild) grid.removeChild(grid.firstChild);

  Object.entries(SKINS).forEach(([key, skin]) => {
    const btn = document.createElement('button');
    btn.className = 'skin-card' + (State.activeSkin === key ? ' selected' : '');
    btn.dataset.skin = key;

    const cv = document.createElement('canvas');
    cv.width = cv.height = 56;
    const cc = cv.getContext('2d');
    const cx = 28, cy = 28, r = 18;
    const grad = cc.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.5);
    grad.addColorStop(0, skin.glow); grad.addColorStop(1, skin.glowEdge);
    cc.fillStyle = grad;
    cc.beginPath(); cc.arc(cx, cy, r * 2.5, 0, Math.PI * 2); cc.fill();
    cc.shadowColor = skin.shadow; cc.shadowBlur = 14;
    cc.fillStyle = skin.color;
    cc.beginPath(); cc.arc(cx, cy, r, 0, Math.PI * 2); cc.fill();
    cc.shadowBlur = 0;
    cc.fillStyle = skin.spec;
    cc.beginPath(); cc.arc(cx - r * 0.24, cy - r * 0.24, r * 0.38, 0, Math.PI * 2); cc.fill();

    const nameEl = document.createElement('span');
    nameEl.className = 'skin-name';
    nameEl.textContent = skin.name;

    btn.appendChild(cv);
    btn.appendChild(nameEl);
    btn.addEventListener('click', () => selectSkin(key));
    grid.appendChild(btn);
  });
}

function selectSkin(key) {
  State.activeSkin = key;
  localStorage.setItem('bb_skin', key);
  document.querySelectorAll('.skin-card').forEach(el => {
    el.classList.toggle('selected', el.dataset.skin === key);
  });
}

// ─────────────────────────────────────────────
// 15. FIREBASE / LEADERBOARD
// ─────────────────────────────────────────────
//
// To enable leaderboards + Google sign-in:
//  1. Create a Firebase project at https://console.firebase.google.com
//  2. Enable Google as a sign-in provider (Authentication → Sign-in method)
//  3. Create a Firestore database in production mode
//  4. Add Firestore composite index: collection "leaderboard", field "score" (Descending)
//  5. Fill in FIREBASE_CONFIG below with your project values (found in Project Settings → Your apps)

const FIREBASE_CONFIG = {
  apiKey:            '',  // ← paste your values here
  authDomain:        '',
  projectId:         '',
  storageBucket:     '',
  messagingSenderId: '',
  appId:             '',
};

const FB = (() => {
  if (typeof firebase === 'undefined' || !FIREBASE_CONFIG.apiKey) return null;
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    return { auth: firebase.auth(), db: firebase.firestore() };
  } catch (e) { console.warn('Firebase init failed:', e); return null; }
})();

let currentUser = null;

function signIn()  { if (FB) FB.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(console.error); }
function signOut() { if (FB) FB.auth.signOut(); }

if (FB) {
  FB.auth.onAuthStateChanged(user => { currentUser = user; _syncAuthUI(); });
}

function _syncAuthUI() {
  const signinBtn  = document.getElementById('btn-signin');
  const signoutBtn = document.getElementById('btn-signout');
  const nameEl     = document.getElementById('lb-user-name');
  const photoEl    = document.getElementById('lb-user-photo');
  const authRow    = document.getElementById('lb-auth-row');

  if (!FB && authRow) {
    authRow.style.display = 'none';
    return;
  }

  if (currentUser) {
    if (signinBtn)  signinBtn.style.display  = 'none';
    if (signoutBtn) signoutBtn.style.display = '';
    if (nameEl)  nameEl.textContent = currentUser.displayName || currentUser.email || '';
    if (photoEl) {
      photoEl.src = currentUser.photoURL || '';
      photoEl.style.display = currentUser.photoURL ? '' : 'none';
    }
  } else {
    if (signinBtn)  signinBtn.style.display  = '';
    if (signoutBtn) signoutBtn.style.display = 'none';
    if (nameEl)  nameEl.textContent = '';
    if (photoEl) photoEl.style.display = 'none';
  }
}

async function submitScore() {
  if (!FB || !currentUser) return;
  const score = State.score, turn = State.turn;
  try {
    const existing = await FB.db.collection('leaderboard')
      .where('uid', '==', currentUser.uid).orderBy('score', 'desc').limit(1).get();
    if (!existing.empty && existing.docs[0].data().score >= score) return;
    existing.docs.forEach(d => d.ref.delete());
    await FB.db.collection('leaderboard').add({
      uid:  currentUser.uid,
      name: currentUser.displayName || 'Anonymous',
      photo: currentUser.photoURL || '',
      score, turn,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) { console.error('submitScore:', e); }
}

function _makeLbNote(msg) {
  const el = document.createElement('div');
  el.className = 'lb-note';
  el.textContent = msg;
  return el;
}

async function fetchLeaderboard() {
  const listEl = document.getElementById('lb-list');
  if (!listEl) return;
  while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

  if (!FB) { listEl.appendChild(_makeLbNote('Add your Firebase config to enable leaderboards.')); return; }

  const loading = document.createElement('div');
  loading.className = 'lb-loading';
  loading.textContent = 'Loading...';
  listEl.appendChild(loading);

  try {
    const snap = await FB.db.collection('leaderboard').orderBy('score', 'desc').limit(50).get();
    const seen = new Set(); const entries = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      if (!seen.has(d.uid)) { seen.add(d.uid); entries.push(d); if (entries.length >= 10) break; }
    }
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

    if (!entries.length) { listEl.appendChild(_makeLbNote('No scores yet — be the first!')); return; }

    entries.forEach((e, i) => {
      const row = document.createElement('div');
      row.className = 'lb-entry' + (currentUser && e.uid === currentUser.uid ? ' lb-you' : '');

      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = `#${i + 1}`;
      row.appendChild(rank);

      if (e.photo) {
        const img = document.createElement('img');
        img.className = 'lb-photo';
        img.width = img.height = 22;
        img.alt = '';
        img.src = e.photo;
        img.addEventListener('error', () => { img.style.display = 'none'; });
        row.appendChild(img);
      } else {
        const ph = document.createElement('span');
        ph.className = 'lb-photo-ph';
        ph.textContent = '◎';
        row.appendChild(ph);
      }

      const name = document.createElement('span');
      name.className = 'lb-name';
      name.textContent = e.name || 'Anonymous';
      row.appendChild(name);

      const scoreEl = document.createElement('span');
      scoreEl.className = 'lb-score';
      scoreEl.textContent = e.score;
      row.appendChild(scoreEl);

      const turnEl = document.createElement('span');
      turnEl.className = 'lb-turn';
      turnEl.textContent = `T${e.turn}`;
      row.appendChild(turnEl);

      listEl.appendChild(row);
    });
  } catch (err) {
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    listEl.appendChild(_makeLbNote('Failed to load scores.'));
    console.error(err);
  }
}

function openLeaderboard() {
  showOverlay('leaderboard-screen');
  _syncAuthUI();
  fetchLeaderboard();
}

// Skin / Leaderboard button wiring
document.getElementById('btn-skins').addEventListener('click', () => {
  initSkinSelector();
  showOverlay('skin-screen');
});
document.getElementById('btn-skin-close').addEventListener('click', () => showOverlay('start-screen'));

document.getElementById('btn-skins-pause').addEventListener('click', () => {
  initSkinSelector();
  showOverlay('skin-screen');
});

document.getElementById('btn-leaderboard-start').addEventListener('click', openLeaderboard);
document.getElementById('btn-leaderboard-go').addEventListener('click', openLeaderboard);
document.getElementById('btn-lb-close').addEventListener('click', () => {
  if (State.phase === 'gameover') showOverlay('gameover-screen');
  else if (State.phase === 'paused') showOverlay('pause-screen');
  else showOverlay('start-screen');
});

document.getElementById('btn-signin').addEventListener('click', signIn);
document.getElementById('btn-signout').addEventListener('click', signOut);

// ── Bootstrap ──
(function bootstrap() {
  resizeCanvas();
  Input.init();
  updateStartScreen();
  updateHUD();
  _syncAuthUI();

  // Apply stored mute pref
  if (Audio.muted) {
    document.getElementById('btn-mute').textContent = '🔇';
  }

  // Start the render loop in idle mode (shows start screen canvas bg)
  lastTime = performance.now();
  rafId = requestAnimationFrame(gameLoop);

  showOverlay('start-screen');
})();
