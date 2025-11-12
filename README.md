# FrequencyDoctor

A simple, good-looking web app to browse healing frequencies and play a pure sine wave at a chosen frequency (supports decimals like 291.90 Hz). Optimized for mobile and installable as a PWA.

## Run locally

- Use any static web server (service workers require http/https, not file://).
- Examples (pick one):
  - Python: `python -m http.server 5173`
  - Node (serve): `npx serve -s . -l 5173`
- Open http://localhost:5173

## Project structure

- index.html — UI layout and links
- styles.css — Visual design
- app.js — Audio engine and UI logic
- data/frequencies.js — The searchable list you can edit
- manifest.webmanifest — PWA metadata (name, theme, icons)
- sw.js — Offline caching / install support
- img/favicon.png — App icon used for favicon and A2HS

## Editing the frequency list

Open `data/frequencies.js` and modify the array:

```js
window.FREQUENCY_DATA = [
  { name: "Brain Fog", frequency: 291.9 },
  { name: "Headache", frequency: 291.9 },
  { name: "Calm", frequency: 174.0 },
  // Add more...
];
```

- `name`: What the frequency is for.
- `frequency`: A number; decimals allowed (e.g., 291.9).
- The list auto-sorts by name and is searchable by name or frequency.

## How to use

- Search: Use the top search box to filter list by condition or Hz.
- Play from list: Tap an item to auto-set and play that frequency.
- Custom play: Enter any frequency in the Frequency (Hz) field and press Play.
- Volume: Adjust with the slider.

## Install to Home Screen (iOS Safari)

- Open the app URL in Safari.
- Tap Share → Add to Home Screen.
- The provided `img/favicon.png` is referenced for the app icon via `apple-touch-icon` and in the manifest.

## Notes

- Audio may require a user gesture to start (tap Play first time).
- Service Worker updates are applied on next reload after a change.
- If you host under a subpath, ensure `sw.js` and cached paths still resolve.
