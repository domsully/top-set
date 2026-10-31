# Top Set

A small, offline workout log for your phone. It tracks every set and suggests the weight for your next heavy top set based on your last few sessions, so one bad night of sleep doesn't wreck your numbers.

No accounts, no server, no build step. Plain HTML, CSS and JavaScript.

## How suggestions work

Each exercise lives once in your **exercise library** and keeps one history. A workout is a list of numbered **groups** (Calf, Chest, Hinge…), and each group holds the exercises you can choose from that day. You tap the one you're doing, and next time the app pre-selects whichever you did last. Log DB overhead extensions on pull day and the suggestion on push day already reflects it.

Reps can be whole or half (5.5). The first set is the top set and drives every suggestion; the sets after it are back-offs.

For each exercise:

| Rule | Default | What it does |
|---|---|---|
| Move up | 9 reps | One top set with 9+ reps → next time the weight goes up by the jump. |
| Weight jump | 5 lb | Can be overridden per exercise (e.g. 2.5 for dumbbells). |
| Grace period | 3 sessions | After a jump the weight stays put for 3 sessions, however they go. |
| Rep floor | 4 reps | After those 3 sessions, if the average top-set reps is below 4, drop back to the previous weight. |
| Rolling window | 4 sessions | The strength trend and the "aim for X reps" target use the average estimated max (Epley) over the last 4 sessions. |
| Back-off sets | 2 × 70% | Pre-filled after the top set, rounded to the jump. |

All of these can be changed in **Settings**. The logic lives in `js/progression.js` with tests in `tests/`.

## Put it on your phone

The app has to be served over HTTPS to install and work offline. GitHub Pages is free and the easiest:

1. Create a new GitHub repository and upload everything in this folder (keep the folder structure).
2. In the repo, go to **Settings → Pages**, set **Source** to "Deploy from a branch", pick `main` and `/ (root)`, and save.
3. After a minute your app is live at `https://<your-username>.github.io/<repo-name>/`.
4. Open that link on your phone:
   - **iPhone (Safari):** Share button → **Add to Home Screen**.
   - **Android (Chrome):** menu → **Install app** (or **Add to Home screen**).

Open it from the home-screen icon from then on. It works with no signal at the gym.

Other free hosts (Netlify, Cloudflare Pages, Vercel) work too: drag the folder in, no build settings needed.

## Your data

- Everything is stored on your phone (browser `localStorage`). Nothing is sent anywhere.
- **Back up now and then:** Settings → *Save backup file* (on iPhone this opens the share sheet, so you can save to Files or iCloud Drive) or *Copy backup text*.
- **Restore** from Settings with the file or pasted text. Restoring replaces everything on the phone.
- The home-screen app and the same site opened in the browser keep **separate** data on iPhone. Pick one and stick with it, or move data between them with a backup.
- The app starts with example workouts so you can see how it works. Tap **Clear examples** on the Train tab when you're ready.

## Updating the app

Edit files, push to GitHub, then bump `VERSION` in `sw.js` (e.g. `topset-v1.0.1`). Phones pick up the new version the next time the app is opened with a connection. Your data is not affected.

## Project layout

```
index.html            App shell and all styles
js/progression.js     Suggestion engine (pure functions, no DOM)
js/app.js             UI, storage, backup/restore
sw.js                 Offline cache
manifest.webmanifest  Install metadata
icons/                App icons
tests/                Node tests for the suggestion engine
```

## Run locally

```sh
python3 -m http.server 8000      # then open http://localhost:8000
node --test tests/*.test.js      # suggestion engine tests (Node 18+)
```

## License

MIT. See `LICENSE`.
