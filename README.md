# Monstreets

A top-down pixel-art action game for iPhone and iPad. You play an open city with a creature partner who fights next to you, steal cars and drive them, take on quests and fight swarms of monsters. Multiplayer has co-op and PvP.

The characters, creatures, art and name are all original. Nothing is copied from any existing game.

## What's in the game

| Feature | Details |
|---|---|
| **Character creator** | Skin, hair color, hair style, hat, shirt and pants. Pick 1 of 3 starter creatures. |
| **Creature partners** | Cindkit (fire, hits hardest), Puddlo (water, slows enemies), Thornub (grass, heals you). Each one evolves at level 10 into Blazelynx, Tidalor or Briarok. |
| **Story mode (single player)** | Open city with roads, parks, ponds and buildings. Enter any car and drive it, and run enemies over. NPCs give quests that repeat in tougher tiers: Street Sweep (kill), Lost Cargo (collect), Hot Wheels (drive), Big Trouble (boss). The radar and an arrow point to your objective. |
| **Leveling** | XP and coins come from kills and quests. Levels go up to 50, and each level gives 1 stat point (Power, Vitality or Agility). |
| **Weapons** | Pistol, Uzi, Shotgun, Rifle (pierces) and Rocket (splash). Buy them in the Shop; each needs a minimum level. Ammo drops come from enemies. |
| **Co-op quest (multiplayer)** | Up to 4 players fight escalating waves in an arena, with a boss every 5 waves. The squad quest is to clear wave 10 for a big bonus. XP is shared. |
| **PvP arena (multiplayer)** | Up to 6 players, first to 10 knockouts. Every player gets all weapons and the same stats, so it stays fair. |
| **Graphics** | Default 3D handheld-console look built with three.js (WebGL2), shown on a tilted camera. Buildings are extruded with windows, doors and roofs, and the trees and cars are low-poly 3D. Sunlight casts real shadows, and depth-of-field blur softens the screen edges. The pixel characters stand in the world as sprites. A building turns see-through when you walk behind it. Settings → Graphics cycles **3D High** (shadows and blur), **3D Fast** and **Classic 2D**. Classic is used automatically on devices without WebGL2. |
| **Layout** | Settings → Layout. **Auto** (default) shows two screens when the phone is upright, with the game on the top screen and a touch panel on the lower screen, and full screen when sideways. The panel holds your stats, the quest, a large radar, MOVE and AIM thumb zones, tap-to-equip weapon slots, Pause and A. **Two screens** puts the panel beside the game when sideways. **Full screen** always uses the classic overlay HUD. |
| **Controls** | Left thumb moves, right thumb aims and fires automatically, **A** enters cars or talks, and the weapon button cycles weapons. On desktop: WASD to move, mouse to aim and click to fire, E for action, Q or 1-5 for weapons, Esc to pause. |

## Run it (any computer)

```bash
npm install
npm start          # http://localhost:8080
npm test           # 14 automated tests (simulation + server)
```

To play on your iPhone right away (no Mac needed), put the phone on the same Wi-Fi as the computer and open `http://<computer-ip>:8080` in Safari. Then tap Share → **Add to Home Screen** and it runs full screen like an app. Multiplayer connects to the same server automatically.

## Build the real iOS app (needs a Mac with Xcode)

The Xcode project is already generated in `ios/` (Capacitor 6).

```bash
npm install
npx cap sync ios   # copies web/ into the app and runs pod install (CocoaPods required)
npx cap open ios   # opens Xcode → pick your team under Signing → Run on device
```

Inside the iOS app, open Multiplayer and enter your server address, for example `ws://192.168.1.20:8080/ws`. Local network servers are allowed. An internet server must use `wss://` (TLS).

## Project layout

```
web/                  the game (plain HTML/JS, no build step)
  vendor/             three.js r170 (MIT), bundled so the app works offline
  js/shared/          rules shared by client and server: data, maps, simulation
  js/client/          rendering, pixel art, input, audio, menus, networking
server/index.js       static file server + WebSocket multiplayer (authoritative)
test/                 node:test suites
ios/                  Capacitor Xcode project
```

The single-player simulation is the same code the server runs for multiplayer, so the two modes follow identical rules.

## Known limits

- Progress is saved on the device in `localStorage`. There are no accounts or cloud saves yet, and a determined player could edit their own save. PvP equalizes stats, so an edited save gives no advantage there.
- The iOS app has not been compiled in this environment, because that needs macOS and Xcode.
