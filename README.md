# On-device OCR (no AI, no server)

Copy each file to the same path in your GitHub repo and commit to `main`.
pnpm-lock.yaml at the repo root must be included too (it changed because
tesseract.js was added).

## New files
- artifacts/zameco-service-memo/src/lib/ocr/calibration.ts
- artifacts/zameco-service-memo/src/lib/ocr/fieldOcr.ts
- artifacts/zameco-service-memo/src/pages/calibrate.tsx

## Changed files
- artifacts/zameco-service-memo/package.json (added tesseract.js)
- artifacts/zameco-service-memo/src/App.tsx (registered /calibrate route)
- artifacts/zameco-service-memo/src/pages/scan.tsx (uses local OCR instead
  of the server's AI extraction endpoint)
- pnpm-lock.yaml (repo root)

## What this does
Scanning now reads each field straight from the photo on-device, using
fixed positions calibrated against a real ZAMECO memo. No OpenAI or
Gemini call happens during scanning anymore.

## Verified before packaging
- Real OCR run (actual Tesseract engine) against your sample memo photo,
  field positions tuned until every field read correctly
- Whole project typecheck: clean (pnpm run typecheck)
- Production build: clean

## Known limitation to solve before the APK
Tesseract.js downloads its language data from a CDN the first time OCR
runs, rather than shipping it inside the app. For true offline/no-server
use this needs to be bundled as a local asset instead - next step once
we start the APK packaging work.

## Try it
Visit /calibrate on the deployed site to see the default boxes over a
scan you upload. Scanning a memo on /scan now runs OCR locally - open
the browser console to see it working if you want to watch.
