# Label-based OCR (replaces the fixed-box version)

Upload these 4 files to the SAME paths in your GitHub repo (overwrite), commit to main:

  artifacts/zameco-service-memo/src/lib/ocr/fieldOcr.ts      (rewritten)
  artifacts/zameco-service-memo/src/lib/ocr/labelExtract.ts  (NEW)
  artifacts/zameco-service-memo/src/pages/scan.tsx           (updated)
  artifacts/zameco-service-memo/src/App.tsx                  (removes the /calibrate page)

Then DELETE these 2 files on GitHub (no longer used; harmless if left):

  artifacts/zameco-service-memo/src/lib/ocr/calibration.ts
  artifacts/zameco-service-memo/src/pages/calibrate.tsx

No new dependencies, no lockfile change.

## What changed
The old version cut the page into fixed boxes, which broke whenever a photo was framed or
tilted differently. This one reads the whole page, finds the printed labels ("Consumer:",
"Address:", "Work:", "Amount", ...) wherever they are, straightens a tilted page, then
re-reads the header lines, amounts and O.R./A.R. column up close.
It also checks that the amounts add up to the printed total, which catches misread digits.

## Always check
The O.R./A.R. number and amounts are the hardest thing for OCR. A digit can be misread
with no warning (e.g. 6 read as 8). Compare them with the photo before submitting.
