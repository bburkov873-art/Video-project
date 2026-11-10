# Lo-fi space

A ~65 s vertical (1080×1920, 30 fps) free-camera flight through the solar system: deep blue palette, soft glow, no text.
Everything is procedural (Three.js shaders, no image assets) and deterministic — each frame is a pure function of time.

| Time | Shot |
| --- | --- |
| 0–6 s | Stars and the Milky Way fade in, the Sun glows in the distance |
| 6–12 s | Mercury, then Venus in its yellow haze |
| 12–22 s | Earth (clouds, oceans, city lights on the night side), the Moon, a space station |
| 22–28 s | Mars, the asteroid belt, a comet |
| 28–38 s | Jupiter with the Great Red Spot, the camera arcs around it |
| 38–48 s | Saturn — the camera glides just above the rings |
| 48–56 s | Uranus and Neptune, shooting stars |
| 56–65 s | Pull-back until the system is a glowing dot, fade to black |

## Render

Needs Node, ffmpeg and Chrome (path via `CHROME`, default `/usr/local/bin/google-chrome`). No GPU required.

```sh
npm install
node render.mjs                        # -> out/lofi-space.mp4 (~20 min on 4 cores)
node render.mjs --audio track.mp3      # same, with the track muxed in and faded
node render.mjs --encode-only --audio track.mp3   # reuse rendered frames, just re-encode
node render.mjs --stills 16,32,44.5 --w 360 --h 640 --texq 0.5   # quick preview stills + out/sheet.jpg
```

Rendering resumes where it stopped (existing frames in `out/frames` are skipped).
To preview in real time, serve the repo root and open `/src/index.html?w=540&h=960` in a browser with a GPU.

## Tuning

- `src/main.js` — layout, camera keyframes (`posTrack` / `lookTrack`), timing of fades and props.
- `src/shaders.js` — planet surfaces, rings, sky, glow and the final colour grade.
