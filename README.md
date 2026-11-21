# Aura Ascendants

An original 3D arena fighter for iOS in the spirit of free-roaming anime fighters:
lock-on combat in open 3D space, flight, melee combos, energy blasts, beams, a
power-up transformation (**Ascend**), a cinematic finisher (**Apex**), and a deep
character creator where every fighter is yours.

All names, characters, moves and looks are original.

## Play it

```bash
npm install
npm start          # http://localhost:8080
npm test           # simulation tests (node --test)
```

Open the URL on a phone in landscape or on desktop (keyboard or gamepad).

## Controls

| Touch | Keys | What it does |
|---|---|---|
| Stick | WASD | Move. Forward always means toward the rival (lock-on), even in the air |
| ATTACK | J | Tap: 5-hit combo (lunges in from range). Hold: guard-breaking Smash |
| BLAST | K | Tap: homing energy blast. Hold: charge and fire your Beam |
| GUARD | L | Hold: block. Tap just before a hit: **Blink** behind the attacker. Tap while being comboed: break out (costs a blink and 20 aura) |
| DASH | Shift | With the stick: dash. Stick neutral: dash at the rival. Hold (stick neutral): charge aura. Dash then ATTACK: Rush special |
| JUMP | Space | Jump into flight. Hold to rise, tap in the air to drop |
| ASCEND / APEX | U | At 50 aura: transform. Once ascended with full aura: Apex finisher |

**Touch layout:** Settings → *Edit touch controls* lets you drag every button and the stick, resize them, and set their transparency. Your layout is saved.

**Graphics:** Settings has three quality tiers:
- **Ultra:** sharpest, with dense grass and 2048 shadows.
- **High:** the default.
- **Battery saver:** no bloom, shadows or grass.

It also has two looks:
- **Realistic** (default): physically based skin, cloth, leather and metal, lit by the sky.
- **Anime:** cel shading with outlines.

Fighters are a single continuous skinned body, so joints bend smoothly. They have sculpted heads with 3D eyes that blink and react, and curved textured hair.

**CPU levels:** Easy, Normal, Hard and Master. Master reads your attack timing: it blocks and blinks on cue and sidesteps beams. Fights last about 1 to 1.5 minutes on a 180-second clock.

## Character creator

- **Body:** height, build, shoulders and skin.
- **Face:** 4 eye shapes, eye colour, 4 brow shapes, 5 marks and 2 ear types.
- **Hair:** 12 styles, a normal colour and an ascended colour.
- **Outfit:** 7 tops, 4 bottoms, 4 footwear, 4 hand types and 6 accessories, each with its own colours.
- **Aura:** a normal colour and an ascended colour.
- **Moves:**
  - a fighting style: Brawler, Striker or Mystic
  - a blast: 3 to choose from
  - a beam: 3 to choose from
  - a rush special: 2 to choose from
  - an Apex finisher: 3 to choose from

Every swatch row has an "any colour" picker. Fighters can be shared as a text code: *Share* copies it, and *Import Code* adds a friend's fighter.

Looks never change hitboxes. Styles and moves are trade-offs, not upgrades. In 300 CPU-vs-CPU fights, every style and move won between 47% and 54% of the time.

## Project layout

```
web/js/sim/       deterministic 60 Hz fight simulation, CPU, fighter specs (no DOM)
web/js/client/    three.js rendering: fighter rig, arena, effects, camera, input, audio, creator
web/js/main.js    screens, battle loop, HUD, saving
web/vendor/three  vendored three.js r170 (MIT)
test/             node tests: damage, guard, blink, combos, beams, flight, KO/timer,
                  mirror symmetry, determinism, CPU-vs-CPU and random-input soak
ios/              Capacitor iOS project (landscape, full screen)
```

The simulation only consumes per-tick input structs. That is what makes it
testable, replayable, and ready for online versus later.

## Build for iPhone (needs a Mac with Xcode)

```bash
npm install
npx cap sync ios
npx cap open ios   # then pick your team under Signing and press Run
```
