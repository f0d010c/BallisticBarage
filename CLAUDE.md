# Ballistic Barrage — Claude Context

## Project
Browser arcade game. Zero build step, zero dependencies. Open `index.html` directly or `python3 -m http.server 8080`.

## Files
| File | Purpose |
|------|---------|
| `index.html` | Structure, overlays, canvas, Firebase SDK tags |
| `styles.css` | Neon noir theme, all UI layout |
| `script.js` | Everything: game logic, physics, rendering, audio, Firebase |

## script.js Sections (in order)
1. `CFG` — all tunable constants (HP, speed, chances, thresholds)
2. Audio Engine — Web Audio API synthesis, no samples
3. State — `State` object, `State.reset()`
4. Canvas / Layout — responsive 9:16, `Layout` object
5. Input — mouse + touch, drag-to-aim
6. Physics & Collision — circle-AABB, fixed 60Hz timestep, substeps
7. Level Generation — `spawnRow()`, `_rowLayout()`, `_burstLayout()`, `_shuffle()`
8. Particle System
9. Game Loop — `updateAiming`, `updateFiring`, `updateRolling`, `endTurn`
10. Rendering — `render()`, `drawBlocks()`, `drawBalls()`, etc.
11. Init — `initGame()`, Firebase init, event listeners

## Key Architecture Rules
- **No build step** — never introduce bundlers, npm packages, or imports
- **Single JS file** — all logic stays in `script.js`
- **CFG is the balance knob** — tune values there, not inline
- **No Co-Authored-By in commits**

## Balance (current tuning)
- `HEALTH_PER_TURN: 0.9` — block HP grows ~0.9 per turn
- Ball floor: `State.ballCount = Math.max(State.ballCount, State.turn)` — 1:1 with turn
- Spawn density by turn: 2–3 blocks (≤8), 4–5 (≤16), 5–6 (≤28), 6–7 (28+)
- Special blocks: armored ≥2, explosive ≥3, stone ≥5
- Explosive chain damage: `Math.ceil(src.maxHp * 0.6)` — scales with tier

## Block Types
| Type | Turn | HP Modifier | Notes |
|------|------|-------------|-------|
| normal | 1 | ×1 | |
| armored | 2 | ×1.5 | requires 2 hits per HP point |
| explosive | 3 | ×1 | chain-damages neighbors on death |
| stone | 5 | ×5 | immune to explosions, max 2 per row |

## Spawning Logic (`_rowLayout`)
Pattern-based, not per-cell random:
- Sparse (turns ≤8): 2–3 blocks
- Alternating/gap-wall ×2 (turns ≤16): 4–5 blocks
- Corridor/gap-wall ×1 (turns ≤28): 5–6 blocks
- Dense (turns 29+): 6–7 blocks, always ≥1 gap

Screen clear spawns 2 dense rows (`_burstLayout` — full row minus 1 gap) + 1 normal row.

## Firebase (Leaderboard + Auth)
- SDK loaded via CDN compat tags in `index.html` (v9 compat)
- Config object in `script.js` — **client config is intentionally public**
- Security is enforced via **Firestore Security Rules** (not by hiding config)
- Required Firestore rules: authenticated write only, `uid` must match `request.auth.uid`, no direct updates
- Google OAuth via `firebase.auth().signInWithPopup(GoogleAuthProvider)`

## Ball Skins
- Defined in `SKINS` array near top of `script.js`
- Each skin: `{ id, name, draw(ctx, x, y, r) }` — pure canvas drawing function
- Active skin stored in `localStorage['bb_skin']`
- Selector UI in `#skin-screen` overlay, grid populated dynamically

## Screens / Overlays
- `#start-screen` — PLAY, SKINS, LEADERBOARD buttons
- `#gameover-screen` — score summary, PLAY AGAIN, LEADERBOARD
- `#pause-screen` — RESUME, SKINS, RESTART
- `#skin-screen` — skin selector grid
- `#leaderboard-screen` — Google sign-in, top scores list

## Persistence (localStorage)
| Key | Value |
|-----|-------|
| `bb_best` | integer best score |
| `bb_mute` | `'0'` or `'1'` |
| `bb_skin` | skin id string |

## Git
- Branch: `main`
- Remote: `origin` → `https://github.com/f0d010c/BallisticBarage`
- No `--no-verify`, no `Co-Authored-By`
