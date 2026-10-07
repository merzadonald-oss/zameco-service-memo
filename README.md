# OCR calibration fix

Only two files changed - both in artifacts/zameco-service-memo/src/lib/ocr/.
No new dependencies, no lockfile change needed this time.

## What was wrong
The original calibration was tuned against a raw, loosely-framed photo.
Your real scan (sent to me directly) was framed much more tightly around
the paper, so several field boxes landed in slightly the wrong place.

## What changed
- calibration.ts: all seven field positions re-measured against your real
  scan, with small padding added for tolerance to minor framing variation
- fieldOcr.ts: added a cleanup pass for number fields (amount, O.R./A.R.
  number) that strips stray letters while leaving the digits alone, plus
  two more label-fragment patterns ("ddress:", "rk:") trimmed from text
  fields

## Verified against your real scan before packaging
- Name, date, address, nature of complaint, O.R./A.R. number, and total
  amount all read correctly
- Account number correctly reads as empty (it's blank on your form)
- Whole project typecheck: clean

## One real limitation worth knowing
Two different test photos of the same form - one loosely framed, one
tightly framed - needed different calibration to read well. This
calibration is tuned for a scan where the paper fills most of the frame,
close to how your real scan was taken. For best reliability, try to frame
every scan that way. If results drift again, send me the actual photo
(not just a description) the same way you did this time - that's what let
me fix this precisely rather than guess.
