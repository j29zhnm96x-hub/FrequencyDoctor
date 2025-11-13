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
  {
    name: "Brain Fog",
    frequency: 291.9,
    category: "Neurological",      // optional (defaults to "General")
    tags: ["focus", "clarity"],    // optional
    description: "Mental clarity"   // optional
  },
  // Add more...
];
```

- `name`: What the frequency is for.
- `frequency`: Number; decimals allowed (e.g., 291.9).
- `category`: Optional string used by the Category filter.
- `tags`: Optional array of short labels; used by search.
- `description`: Optional short note; used by search.

Search matches name, Hz, category, tags, and description. The list auto-sorts by name.

## How to use

- Search: Use the top search box to filter by condition, Hz, tags, category, or description.
- Category filter: Use the Category dropdown to narrow to a group.
- Favorites: Toggle the ★ on any item. Use "Favorites only" to show starred items.
- Play from list: Tap an item to auto-set and play that frequency.
- Custom play: Enter any frequency in the Frequency (Hz) field and press Play.
- Volume: Adjust with the slider.

### Favorites persistence
Favorites are remembered in your browser (localStorage). They will be preserved across reloads on the same device and browser.

## Install to Home Screen (iOS Safari)

- Open the app URL in Safari.
- Tap Share → Add to Home Screen.
- The provided `img/favicon.png` is referenced for the app icon via `apple-touch-icon` and in the manifest.

## Notes

- Audio may require a user gesture to start (tap Play first time).
- Service Worker updates are applied on next reload after a change.
- If you host under a subpath, ensure `sw.js` and cached paths still resolve.
