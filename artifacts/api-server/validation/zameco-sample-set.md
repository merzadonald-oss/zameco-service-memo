# ZAMECO service memo field validation

Approve exactly one representative original photo for each capture condition:

| Sample | Required condition | Approved file | Approved by | Date |
| --- | --- | --- | --- | --- |
| 1 | Clear, evenly lit |  |  |  |
| 2 | Angled/perspective |  |  |  |
| 3 | Dim or low light |  |  |  |
| 4 | Handwritten fields |  |  |  |

The uploaded photo `0_IMG_20260922_093945_1790131262529.jpg` is a clear,
mostly printed form with a handwritten annotation, **not** an approved set
covering all four conditions. On 2026-09-23, a live extraction through
`/api/memos/extract` matched all seven visible required fields; the account
number was blank on the form and the extractor returned an empty value with
an unreadable/blank warning. This is an informal clear-photo check only;
approval and the other three photos are still needed. Do not copy real
customer data into this validation document.

The same sample also exposed a review-screen formatting issue: extraction
returned a timestamp for the received date, a written-out memo date, and
an amount with a thousands separator. Browser date/number inputs could
appear blank even though the API had values. The review screen now converts
both dates to the date input format and shows the amount as text without
discarding its punctuation. A subsequent live extraction returned the
memo date in ISO format and retained the amount's comma and decimals.

For every photo, compare the source form with the extraction review screen before saving:

| Required field | Clear | Angled | Dim | Handwritten |
| --- | --- | --- | --- | --- |
| Date of service memo |  |  |  |  |
| Nature of complaint |  |  |  |  |
| Account number |  |  |  |  |
| Consumer name |  |  |  |  |
| Address |  |  |  |  |
| Total amount paid |  |  |  |  |
| OR/AR number(s) |  |  |  |  |

Use `Exact`, `Corrected`, or `Unreadable` in each result cell. Record corrections below, including the OCR warning and confidence shown by the app.

## End-to-end sync checks

1. Save each approved sample once.
2. Confirm its Drive filename is `<service memo code>.jpg`, `.png`, or `.webp`, matching the uploaded image type.
3. Confirm the Sheets values occupy columns A–J in this order:
   Service Memo Code, Date Received, Date of Service Memo, Nature of Complaint,
   Account Number, Consumer Name, Address, Total Amount Paid, OR/AR Number,
   Drive Image Link.
4. Force or observe a failed sync, then retry it twice.
5. Confirm Drive contains one file with that service memo code and Sheets contains one row with that service memo code.

## Approval

Field rollout is approved only when all four samples are named above, every required field has a result, corrections have been reviewed, and all end-to-end checks pass.
On 2026-09-23, an isolated retry simulation passed. A separate live sync
check used **synthetic values and a synthetic one-pixel image**, never the
uploaded customer photo. A temporary test-only Drive folder and Sheet were
configured through the application. The first API submission produced one
file named for its memo code and one A–J Sheet row in the specified order.
A second submission was made while the Sheet tab name was intentionally
invalid: the Drive upload succeeded and the Sheet step failed. Restoring
the tab and retrying twice synced the memo; forcing a retry of the already
written row left exactly one file and one row for each of the two synthetic
codes. The values are written as literal strings: a live retry preserved
the test amount `5.00` instead of converting it to `5`. The app settings
were returned to their previous empty destinations and the synthetic app
records were removed after testing; the labeled test-only Google folder
and Sheet remain as evidence. This verifies the live sync path and sequential retries,
but does not replace approval of the missing field-photo conditions above.