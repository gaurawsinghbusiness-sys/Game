# Shield Painter

Shield Painter is a portrait mobile game where the player moves with one thumb and draws short-lived shield lines with the other to deflect bullet storms.

## Run locally

1. Start dev server:
   - `npm run dev`
2. Build production bundle:
   - `npm run build`
3. Preview production bundle:
   - `npm run preview`

This game has zero runtime dependencies for local web testing. `npm install` is only needed later when adding Capacitor packages for Play Store packaging.

## Public URL (GitHub Pages)

After enabling Pages in repository settings, the game is published automatically on every push to `main` by the workflow in `.github/workflows/deploy-pages.yml`.

- Expected URL: `https://gaurawsinghbusiness-sys.github.io/Game/`
- Enable once in GitHub: `Settings -> Pages -> Source: GitHub Actions`

## Controls

- Left side touch: move player
- Right side touch and drag: draw shield (0.5 second lifespan)
- Shield cooldown: 0.25 second
- Desktop fallback: `WASD`/arrow keys for movement, mouse drag for shield

## Gameplay scoring

- Deflect: score increases by current combo
- Combo: grows if next deflect happens within 1.2 seconds
- Close call: +2 when enemy bullets pass very near the player
- Damage: 3 HP total

## PWA testing checklist

1. Open with HTTPS (or localhost during development).
2. Confirm install prompt / Add to Home Screen.
3. Launch installed app and check standalone behavior.
4. Disable network and verify app shell still opens (service worker cache).
5. Run Lighthouse PWA audit before release.

## Google Play path (Capacitor-ready)

Monetization is intentionally deferred, but this project is structured for Play Store packaging through Capacitor.

1. Install Capacitor packages:
   - `npm install @capacitor/core @capacitor/cli`
2. Initialize (if not already):
   - `npx cap init "Shield Painter" "com.shieldpainter.game"`
3. Add Android project:
   - `npm install @capacitor/android`
   - `npx cap add android`
4. Build and copy web assets:
   - `npm run build`
   - `npx cap copy`
5. Open Android Studio project:
   - `npx cap open android`
6. Build signed `AAB` from Android Studio and upload to Play Console Internal testing.

## Next production tasks

- Add turret entities and friendly deflect-hit effects
- Add progression (waves / daily challenge seed)
- Integrate ads/IAP later through Capacitor plugins when needed
