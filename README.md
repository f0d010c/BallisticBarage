# 💥 Ballistic Barrage

> Aim. Launch. Obliterate.

A fast-paced browser arcade game where you fire a volley of balls to smash descending blocks before they reach the bottom. Every turn the blocks get tougher — and stranger.

---

## Play

Just open `index.html` in any modern browser. No build step, no dependencies.

```bash
# Or serve locally:
python3 -m http.server 8080
# then visit http://localhost:8080
```

Works on desktop and mobile.

---

## How to Play

| Action | Control |
|--------|---------|
| Aim | Click / drag anywhere on the canvas |
| Fire | Release |
| Fast-forward | ⏩ button (appears during a volley) |
| Pause | ⏸ button or `P` / `Esc` |
| Mute | 🔊 button or `M` |

- Each turn a new row of blocks slides in from the top and everything shifts down one row.
- Break blocks to score. **The score for each block equals its HP** — tougher blocks are worth more.
- Collect the green **+1 orbs** to permanently add a ball to your volley.
- **Game over** when any block crosses the bottom line.

---

## Block Types

| Block | Indicator | Behaviour |
|-------|-----------|-----------|
| Normal | — | Standard. Break it. |
| **Armored** | Gold border + `◆` | Needs **2 hits per HP point**. Shows a crack after the first absorbed hit. Appears from turn 2. |
| **Explosive** | Orange glow + `!` | On destruction, deals 1 damage to all 4 neighbours. Chain reactions are fully supported. Appears from turn 3. |
| **Stone** | Diagonal hatch | **5× the normal HP** for its turn. Tanky but killable. Appears from turn 5. |

---

## Scoring

- Breaking a block scores `block.maxHp × comboMultiplier`.
- The **combo multiplier** builds when you break blocks within **1.5 seconds** of each other — x2, x3, up to x10. It resets between turns.
- Chain explosions from Explosive blocks count toward the combo.

---

## Warnings

- Blocks in the **last two rows** pulse red — act fast.
- The ball count in the HUD ticks down in real time showing how many balls are still in the air.

---

## Architecture

Three files, zero dependencies:

```
index.html   — DOM structure, HUD, overlay screens
styles.css   — Layout, UI, animations
script.js    — Everything else (12 sections, ~1 200 lines)
```

`script.js` is organised into clearly labelled sections:

1. Config & Constants
2. Audio Engine (Web Audio API synthesis — no samples)
3. State Management
4. Canvas / Renderer Setup
5. Input Handling (mouse + touch)
6. Physics & Collision (fixed-timestep with substeps)
7. Level Generation
8. Particle System
9. Game Loop
10. Rendering
11. UI Helpers
12. Init & Bootstrap
