# Meadow

A musical experiment where color becomes sound.

Drag virtual pens over colors to create generative music. Each pen transforms into a different instrument — drums, bass, arpeggios, or flute — turning paintings and color palettes into playable compositions.

## Running Locally

Serve the project with any static file server:

```bash
npx live-server --port=3000
```

Then open [http://localhost:3000/login.html](http://localhost:3000/login.html)

**Password:** `lark`

## Views

### Studio (3D)
The primary experience. Four wooden pens sit on a virtual table with a painting and color strips. Drag pens over colors to trigger sounds. Pens physically tip over when released on the table, their glowing screens reflecting the color beneath them.

- **Tap a pen** to cycle through instruments
- **Drag over colors** to play notes mapped to hue
- **Drag over black** areas for special ambient sounds (crickets, frogs, meadowlark calls) or crystalline arpeggio mode

### Classic (2D)
A simplified test view with draggable tiles for direct interaction.

## Instruments

| Icon | Name | Sound | Over Black |
|------|------|-------|------------|
| 🪶 | Woodpecker | Drum kit patterns | Cricket chirps (16-step cycle) |
| 🐸 | Toad | Squelchy bass with filter sweep | Frog croaks (48-step cycle) |
| 🧚 | Fairy | Climbing arpeggios | Crystalline half-speed, wandering chords (64-step cycle for meadowlark) |
| 🐦 | Robin | Vibrato flute/voice | Meadowlark song (64-step cycle) |

## Controls

- **Orbit camera** — click and drag the background
- **Reset Camera** — button appears when camera is moved
- **2D test** — switch to the simplified view

## Project Structure

```
Meadow/
├── audio/              # Sound samples (drums, nature sounds)
├── images/             # Paintings and textures
├── js/
│   ├── studio/
│   │   ├── main.js         # Three.js scene, pen physics, color detection
│   │   └── audio-adapter.js # Sound engine, instrument modes
│   ├── pens/           # Individual pen instrument logic
│   ├── arpeggio.js     # Arpeggio pattern generator
│   ├── drum-kits.js    # Drum sample loading and patterns
│   ├── music-player.js # Core Web Audio playback
│   └── utils.js        # Note/frequency mapping
├── index.html          # Classic 2D view
├── studio.html         # 3D studio view
├── login.html          # Password gate
└── styles.css          # Classic view styles
```

## Technical Notes

- Built with [Three.js](https://threejs.org/) r170
- Audio via Web Audio API (no external audio libraries)
- Color-to-note mapping uses HSL hue detection
- Bloom post-processing for screen glow effect
- RectAreaLights pulse in musical time synced to BPM

## Audio Samples

The `audio/` folder contains:
- Drum kit samples (woodblocks, clicks, xylo)
- Nature ambient sounds (cricket chirps, frog, meadowlark calls)
- Various click and chime textures

---

*A musical experiment by IDEO*
