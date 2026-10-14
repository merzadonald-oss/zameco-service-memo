/**
 * Label-anchored field extraction for the ZAMECO "Service Memorandum" form.
 *
 * Instead of trusting fixed percentage boxes (which break whenever a photo
 * is framed, zoomed or tilted differently), this works from a full-page OCR
 * result: every recognized word with its position. It finds the printed
 * labels by their text ("Consumer:", "Address:", "Work:", "Amount", ...) and
 * reads each value from wherever that label actually sits on THIS photo.
 *
 * This file is plain logic with no browser or Tesseract dependency, so it
 * can be tested directly against recorded OCR output.
 */

export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 0-100, from Tesseract */
  confidence: number;
}

export type FieldKey =
  | "consumerName"
  | "dateOfServiceMemo"
  | "accountNumber"
  | "address"
  | "natureOfComplaint"
  | "orArNumber"
  | "totalAmountPaid";

export interface FieldExtraction {
  value: string;
  /** 0-100. 0 when the field could not be located at all. */
  confidence: number;
  /** The words the value was built from (lets a caller re-read them more carefully). */
  words: OcrWord[];
}

export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LabelExtractionResult {
  fields: Record<FieldKey, FieldExtraction>;
  /** Plain-language notes for the person reviewing the memo. */
  warnings: string[];
  /**
   * Where the O.R./A.R. column sits on this particular photo (found from the
   * surrounding labels, not from fixed percentages). Digits are the weak
   * spot of OCR, so the caller re-reads this area more closely.
   */
  orArRegion: Region | null;
  /** Where the Amount column's numbers sit on this photo; re-read closely for the same reason. */
  amountRegion: Region | null;
  /**
   * The three header rows of the form (name+date / account+address / complaint), located
   * from the labels. Each is re-read closely as a line of text, which is more accurate
   * than the first full-page pass.
   */
  rowRegions: { consumer: Region | null; address: Region | null; nature: Region | null };
  /**
   * Page tilt in radians (0 when the page is level) and the point it was measured
   * around. Every region below is in STRAIGHTENED coordinates: the caller rotates
   * the image by this angle once, then crops regions straight out of it.
   */
  skew: { radians: number; originX: number; originY: number };
  /** Internal: lets a later re-read recompute warnings without duplicating them. */
  notes: { base: string[]; amount: string | null; orAr: string | null };
}

export const FIELD_LABELS: Record<FieldKey, string> = {
  consumerName: "Name of Consumer",
  dateOfServiceMemo: "Date of Service Memo",
  accountNumber: "Account Number",
  address: "Address",
  natureOfComplaint: "Nature of Complaints / Work",
  orArNumber: "O.R. / A.R. Number",
  totalAmountPaid: "Total Amount Paid",
};

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const cx = (w: OcrWord) => (w.x0 + w.x1) / 2;
const cy = (w: OcrWord) => (w.y0 + w.y1) / 2;
const hasAlnum = (s: string) => /[A-Za-z0-9]/.test(s);

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Text after the first colon of a token, when a label and its value were read as one word ("Consumer:Dai"). */
function afterColon(word: OcrWord): OcrWord | null {
  const idx = word.text.indexOf(":");
  if (idx < 0 || idx >= word.text.length - 1) return null;
  const rest = word.text.slice(idx + 1);
  if (!hasAlnum(rest)) return null;
  const frac = (idx + 1) / word.text.length;
  return { ...word, text: rest, x0: word.x0 + frac * (word.x1 - word.x0) };
}

function build(words: OcrWord[], kind: "text" | "digits" = "text"): FieldExtraction {
  const used = words.filter((w) => hasAlnum(w.text));
  if (used.length === 0) return { value: "", confidence: 0, words: [] };
  const value = used.map((w) => w.text.trim()).join(" ").replace(/\s+/g, " ").trim();
  // For numbers a single misread digit matters, so report the weakest word;
  // for ordinary text the average is a fairer picture.
  const confs = used.map((w) => w.confidence);
  return { value, confidence: kind === "digits" ? Math.min(...confs) : mean(confs), words: used };
}

const EMPTY: FieldExtraction = { value: "", confidence: 0, words: [] };

/** "235,830.45" or "₱235,830.45" -> 235830.45, otherwise null */
function parseMoney(text: string): number | null {
  const cleaned = text.replace(/^[₱P]/i, "").replace(/[\s]/g, "");
  if (!/^\d{1,3}(,\d{3})*\.\d{2}$/.test(cleaned) && !/^\d+\.\d{2}$/.test(cleaned)) return null;
  return Number(cleaned.replace(/,/g, ""));
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "August 20, 2026" / "08/20/2026" -> "2026-08-20"; anything unrecognised comes back unchanged. */
export function normalizeDate(text: string): string {
  const named = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*[,.]?\s+(\d{4})/.exec(text);
  if (named) {
    const month = MONTHS.indexOf(named[1]!.slice(0, 3).toLowerCase());
    if (month >= 0) return iso(Number(named[3]), month + 1, Number(named[2]));
  }
  const numeric = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(text);
  if (numeric) return iso(Number(numeric[3]), Number(numeric[1]), Number(numeric[2]));
  return text.trim();
}

function iso(y: number, m: number, d: number): string {
  if (m < 1 || m > 12 || d < 1 || d > 31) return `${y}-${m}-${d}`;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// tilt: estimate how far the page is rotated and straighten the word positions
// ---------------------------------------------------------------------------

/**
 * Estimates page tilt (radians, positive = clockwise as seen on screen) by finding
 * the rotation that makes the words fall into the sharpest horizontal rows.
 * Works from word positions only, so no image processing is involved.
 */
export function estimateSkew(words: OcrWord[]): number {
  const pts = words.filter((w) => hasAlnum(w.text) && w.confidence >= 50);
  if (pts.length < 12) return 0;
  const mh = median(pts.map((w) => w.y1 - w.y0)) || 1;
  const bin = mh * 0.5;

  const sharpness = (theta: number): number => {
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    const counts = new Map<number, number>();
    for (const w of pts) {
      const y = cy(w) * cos - cx(w) * sin;
      const key = Math.round(y / bin);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let score = 0;
    counts.forEach((c) => (score += c * c));
    return score;
  };

  let best = 0;
  let bestScore = sharpness(0);
  const flat = bestScore;
  const deg = Math.PI / 180;
  for (let a = -8; a <= 8; a += 0.25) {
    const score = sharpness(a * deg);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  for (let a = best - 0.25; a <= best + 0.25; a += 0.05) {
    const score = sharpness(a * deg);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  // Only trust a correction that clearly tightens the rows.
  return bestScore > flat * 1.08 ? best * deg : 0;
}

function rotateWords(words: OcrWord[], theta: number, ox: number, oy: number): OcrWord[] {
  if (theta === 0) return words;
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  return words.map((w) => {
    const px = cx(w) - ox;
    const py = cy(w) - oy;
    // the same rotation estimateSkew measured: y' = y*cos - x*sin, x' = x*cos + y*sin
    const nx = px * cos + py * sin + ox;
    const ny = py * cos - px * sin + oy;
    const hw = (w.x1 - w.x0) / 2;
    const hh = (w.y1 - w.y0) / 2;
    return { ...w, x0: nx - hw, x1: nx + hw, y0: ny - hh, y1: ny + hh };
  });
}

// ---------------------------------------------------------------------------
// extraction
// ---------------------------------------------------------------------------

export function extractFromWords(rawWords: OcrWord[], imageWidth: number, imageHeight: number): LabelExtractionResult {
  const cleaned = rawWords
    .map((w) => ({ ...w, text: w.text.trim() }))
    .filter((w) => w.text.length > 0 && w.x1 > w.x0 && w.y1 > w.y0);

  // Straighten the page logically before looking for rows (a few degrees of tilt is normal for a handheld photo).
  const theta = estimateSkew(cleaned);
  const ox = imageWidth / 2;
  const oy = imageHeight / 2;
  const words = rotateWords(cleaned, theta, ox, oy);

  const fields: Record<FieldKey, FieldExtraction> = {
    consumerName: EMPTY,
    dateOfServiceMemo: EMPTY,
    accountNumber: EMPTY,
    address: EMPTY,
    natureOfComplaint: EMPTY,
    orArNumber: EMPTY,
    totalAmountPaid: EMPTY,
  };
  const warnings: string[] = [];
  const missing = (key: FieldKey) =>
    warnings.push(`Couldn't find "${FIELD_LABELS[key]}" on the page. Please fill it in manually.`);

  if (words.length === 0) {
    (Object.keys(fields) as FieldKey[]).forEach(missing);
    return finish({ fields, warnings: [], orArRegion: null, amountRegion: null, rowRegions: { consumer: null, address: null, nature: null }, skew: { radians: 0, originX: imageWidth / 2, originY: imageHeight / 2 }, notes: { base: warnings, amount: null, orAr: null } });
  }

  // Typical text height on this page; everything else is measured against it,
  // which is what makes the logic independent of photo size or zoom.
  const mh =
    median(words.filter((w) => w.confidence >= 60 && hasAlnum(w.text) && w.text.length >= 3).map((w) => w.y1 - w.y0)) ||
    median(words.map((w) => w.y1 - w.y0));
  const rowTol = mh * 0.65;

  // Everything above the "SERVICE MEMORANDUM" title is the letterhead (it has
  // its own "address:" and "No." that must not be mistaken for form fields).
  const title = words.filter((w) => /memoran/i.test(w.text));
  const bodyTop = title.length ? Math.max(...title.map((w) => w.y1)) : -Infinity;
  const body = words.filter((w) => w.y0 >= bodyTop - 2);

  /** Words to the right of x on (roughly) the same row, following the row's baseline if the photo is tilted. */
  const rowRightOf = (anchorCy: number, fromX: number, toX = Infinity): OcrWord[] => {
    const candidates = body.filter((w) => w.x0 >= fromX - 2 && w.x0 < toX).sort((a, b) => a.x0 - b.x0);
    const out: OcrWord[] = [];
    let lastCy = anchorCy;
    for (const w of candidates) {
      if (Math.abs(cy(w) - lastCy) <= rowTol) {
        out.push(w);
        lastCy = cy(w);
      }
    }
    return out;
  };

  const firstBelow = (list: OcrWord[], y: number) => [...list].filter((w) => cy(w) > y).sort((a, b) => cy(a) - cy(b))[0];
  const topmost = (list: OcrWord[]) => [...list].sort((a, b) => cy(a) - cy(b))[0];

  // ---- Name of Consumer + Date ------------------------------------------
  const consumer = topmost(body.filter((w) => /consum/i.test(w.text)));
  let consumerRowCy: number | null = null;

  if (consumer) {
    consumerRowCy = cy(consumer);
    // The memo date is the "Date:" printed on the same row as the consumer name
    // (the table below has its own "Date" column and the footer has "Date Accomplished:").
    const dateLabel = [...body.filter((w) => /^date[:;.]?/i.test(w.text) && w.x0 > consumer.x1)]
      .filter((w) => Math.abs(cy(w) - consumerRowCy!) <= mh * 2.5)
      .sort((a, b) => Math.abs(cy(a) - consumerRowCy!) - Math.abs(cy(b) - consumerRowCy!))[0];

    const fused = afterColon(consumer);
    const nameWords = [
      ...(fused ? [fused] : []),
      ...rowRightOf(consumerRowCy, consumer.x1, dateLabel ? dateLabel.x0 : Infinity),
    ];
    fields.consumerName = build(nameWords);

    if (dateLabel) {
      const dFused = afterColon(dateLabel);
      const dateWords = [...(dFused ? [dFused] : []), ...rowRightOf(cy(dateLabel), dateLabel.x1)];
      const built = build(dateWords);
      fields.dateOfServiceMemo = { ...built, value: normalizeDate(built.value) };
    }
  }
  if (!fields.consumerName.value) missing("consumerName");
  if (!fields.dateOfServiceMemo.value) missing("dateOfServiceMemo");

  // ---- Address ------------------------------------------------------------
  const address = topmost(
    body.filter((w) => /^(ad)?dress/i.test(w.text) && (consumerRowCy === null || cy(w) > consumerRowCy - mh * 0.5)),
  );
  let addressRowCy: number | null = null;
  if (address) {
    addressRowCy = cy(address);
    const fused = afterColon(address);
    fields.address = build([...(fused ? [fused] : []), ...rowRightOf(addressRowCy, address.x1)]);
  }
  if (!fields.address.value) missing("address");

  // ---- Account number (frequently left blank on the form) ------------------
  const acct = topmost(body.filter((w) => /^ac+e?t/i.test(w.text)));
  if (acct) {
    const stop = address && Math.abs(cy(address) - cy(acct)) <= mh * 1.5 ? address.x0 : Infinity;
    const digits = rowRightOf(cy(acct), acct.x1, stop).filter((w) => (w.text.match(/\d/g) ?? []).length >= 3);
    fields.accountNumber = build(digits, "digits");
  }
  // (a blank account number is normal, so no warning when it is empty)

  // ---- Nature of Complaints / Work (may wrap onto a second line) ------------
  const aboveY = Math.max(consumerRowCy ?? -Infinity, addressRowCy ?? -Infinity);
  const work = topmost(body.filter((w) => /^work/i.test(w.text) && cy(w) > aboveY));
  const tableHeader = work ? firstBelow(body.filter((w) => /^payments?$/i.test(w.text)), cy(work)) : undefined;
  if (work) {
    const fused = afterColon(work);
    const first = [...(fused ? [fused] : []), ...rowRightOf(cy(work), work.x1)];
    // A long complaint continues on the ruled line beneath it, before the table.
    const limit = tableHeader ? cy(tableHeader) - mh * 0.8 : cy(work) + mh * 3.2;
    const rows = body
      .filter((w) => cy(w) > cy(work) + mh * 0.9 && cy(w) < limit && w.confidence >= 60 && w.text.length >= 2 && hasAlnum(w.text))
      .sort((a, b) => cy(a) - cy(b) || a.x0 - b.x0);
    fields.natureOfComplaint = build([...first, ...rows]);
  }
  if (!fields.natureOfComplaint.value) missing("natureOfComplaint");

  // ---- Payment table: total amount + O.R./A.R. number -------------------------
  const rowAnchorY = work ? cy(work) : aboveY;
  const amountHeader = firstBelow(body.filter((w) => /^amount$/i.test(w.text)), rowAnchorY);
  const tableTop = amountHeader ? cy(amountHeader) : tableHeader ? cy(tableHeader) : rowAnchorY;
  const bom = firstBelow(body.filter((w) => /^bom$/i.test(w.text)), tableTop);
  const tableBottom = bom ? cy(bom) : Infinity;

  const moneyWords = body
    .filter((w) => cy(w) > tableTop + mh * 0.5 && cy(w) < tableBottom && parseMoney(w.text) !== null)
    .sort((a, b) => cy(a) - cy(b));

  const notes = { base: warnings, amount: null as string | null, orAr: null as string | null };
  let amountRegion: Region | null = null;

  let totalWord: OcrWord | undefined;
  if (moneyWords.length > 0) {
    totalWord = moneyWords[moneyWords.length - 1]!;
    const verdict = judgeAmounts(moneyWords);
    fields.totalAmountPaid = verdict.field;
    notes.amount = verdict.note;
    amountRegion = {
      x0: Math.min(...moneyWords.map((w) => w.x0)) - mh,
      y0: Math.min(...moneyWords.map((w) => w.y0)) - mh * 0.8,
      x1: Math.max(...moneyWords.map((w) => w.x1)) + mh,
      y1: Math.max(...moneyWords.map((w) => w.y1)) + mh * 0.8,
    };
  } else {
    missing("totalAmountPaid");
  }

  // O.R./A.R. numbers sit in the column between the amounts and the Date column.
  const dateColumn = amountHeader
    ? [...body.filter((w) => /^date[:;.]?$/i.test(w.text) && w.x0 > amountHeader.x1 && Math.abs(cy(w) - cy(amountHeader)) <= mh * 2.5)].sort(
        (a, b) => a.x0 - b.x0,
      )[0]
    : undefined;
  const moneyRight = moneyWords.length ? Math.max(...moneyWords.map((w) => w.x1)) : -Infinity;
  const orBottom = totalWord ? cy(totalWord) - mh * 0.5 : tableBottom;
  const orWords = body
    .filter(
      (w) =>
        /^\d[\d-]{3,}$/.test(w.text) &&
        cy(w) > tableTop + mh * 0.5 &&
        cy(w) < orBottom &&
        w.x0 >= moneyRight - mh * 0.5 &&
        (dateColumn ? cx(w) < dateColumn.x0 : true),
    )
    .sort((a, b) => cy(a) - cy(b) || a.x0 - b.x0);

  let orArRegion: Region | null = null;
  const regionLeft = Number.isFinite(moneyRight) ? moneyRight : amountHeader ? amountHeader.x1 + mh * 3 : null;
  if (regionLeft !== null) {
    orArRegion = {
      x0: regionLeft,
      y0: tableTop + mh * 0.6,
      x1: dateColumn ? dateColumn.x0 - mh * 0.3 : regionLeft + mh * 14,
      y1: totalWord ? cy(totalWord) - mh * 0.6 : Number.isFinite(tableBottom) ? tableBottom : tableTop + mh * 12,
    };
  }
  if (orWords.length > 0) {
    fields.orArNumber = buildOrAr(orWords);
  } else {
    // not necessarily an error yet: the close-up re-read of this column may still find it
    notes.orAr = `Couldn't find "${FIELD_LABELS.orArNumber}" on the page. Please fill it in manually.`;
  }

  // Row geometry for the close-up re-reads. If a label was missed, the row is inferred from its neighbours
  // (the form's rows are evenly spaced), so one misread label doesn't lose the whole row.
  const pageLeft = Math.min(...body.filter((w) => w.confidence >= 60 && hasAlnum(w.text)).map((w) => w.x0), Infinity);
  const pageRight = Math.max(...body.filter((w) => w.confidence >= 60 && hasAlnum(w.text)).map((w) => w.x1), -Infinity);
  const nameCy = consumer ? cy(consumer) : null;
  const workCy = work ? cy(work) : null;
  let addrCy: number | null = address ? cy(address) : acct ? cy(acct) : null;
  if (addrCy === null && nameCy !== null && workCy !== null) addrCy = (nameCy + workCy) / 2;
  let natureCy: number | null = workCy;
  if (natureCy === null && nameCy !== null && addrCy !== null) natureCy = addrCy + (addrCy - nameCy);
  let consumerCy2: number | null = nameCy;
  if (consumerCy2 === null && addrCy !== null && natureCy !== null) consumerCy2 = addrCy - (natureCy - addrCy);
  const rowBox = (rowCy: number | null, above: number, below: number): Region | null =>
    rowCy === null || !Number.isFinite(pageLeft) || !Number.isFinite(pageRight)
      ? null
      : { x0: Math.max(0, pageLeft - mh), x1: Math.min(imageWidth, pageRight + mh * 6), y0: rowCy - mh * above, y1: rowCy + mh * below };
  const rowRegions = {
    consumer: rowBox(consumerCy2, 0.95, 0.95),
    address: rowBox(addrCy, 0.95, 0.95),
    // the complaint may continue on the ruled line underneath
    nature: rowBox(natureCy, 0.95, tableHeader ? Math.min(2.5, (cy(tableHeader) - (natureCy ?? 0)) / mh - 0.9) : 2.5),
  };

  if (Math.abs(theta) > (6 * Math.PI) / 180) {
    notes.base.push("The page looks quite tilted. Retaking the photo with the paper flatter and squarer will read more reliably.");
  }
  return finish({
    fields,
    warnings: [],
    orArRegion,
    amountRegion,
    rowRegions,
    skew: { radians: theta, originX: ox, originY: oy },
    notes,
  });
}

// ---------------------------------------------------------------------------
// amounts: judge a list of money words, and reconcile a closer re-read
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The bottom-most amount is the printed total; it should equal the sum of the lines above it. */
function judgeAmounts(sortedMoney: OcrWord[]): { field: FieldExtraction; note: string | null; verified: boolean } {
  const total = sortedMoney[sortedMoney.length - 1]!;
  let field = build([total], "digits");
  if (sortedMoney.length < 2) return { field, note: null, verified: false };

  const sum = Math.round(sortedMoney.slice(0, -1).reduce((a, w) => a + parseMoney(w.text)!, 0) * 100) / 100;
  const printed = parseMoney(total.text)!;
  if (Math.abs(sum - printed) <= 0.005) return { field, note: null, verified: true };

  // A single misread digit in any amount breaks this, which is exactly the OCR
  // slip that is otherwise easy to miss.
  field = { ...field, confidence: Math.min(field.confidence, 40) };
  return {
    field,
    note: `The total (${total.text}) doesn't match the amounts above it, which add up to ${fmt(sum)}. One of the amounts may have been misread - please check them against the photo.`,
    verified: false,
  };
}

function moneyOf(words: OcrWord[]): OcrWord[] {
  return words.filter((w) => parseMoney(w.text.trim()) !== null).map((w) => ({ ...w, text: w.text.trim() })).sort((a, b) => cy(a) - cy(b));
}

/**
 * Takes the words from a close-up re-read of the Amount column. The closer
 * read wins when its numbers add up (a strong sign they are right) or when the
 * first read's numbers didn't; otherwise the first read is kept.
 */
export function applyAmountRefinement(result: LabelExtractionResult, refinedWords: OcrWord[]): LabelExtractionResult {
  const refined = moneyOf(refinedWords);
  if (refined.length === 0) return result;

  const current = result.fields.totalAmountPaid;
  const currentVerified = result.notes.amount === null && current.value !== "" && result.amountRegion !== null && current.confidence > 40;
  const verdict = judgeAmounts(refined);

  const useRefined = verdict.verified || !currentVerified;
  if (!useRefined) return result;

  const fields = { ...result.fields, totalAmountPaid: verdict.field };
  let note = verdict.note;
  // With a single amount there is nothing to add up, so two different readings of it deserve a second look.
  if (refined.length === 1 && current.value && current.value !== verdict.field.value) {
    note = `The total was read two different ways (${current.value} and ${verdict.field.value}). Please check it against the photo.`;
    fields.totalAmountPaid = { ...verdict.field, confidence: Math.min(verdict.field.confidence, 40) };
  }
  return finish({ ...result, fields, notes: { ...result.notes, amount: note } });
}

// ---------------------------------------------------------------------------
// O.R./A.R. number: reconcile one or more close-up readings of its column
// ---------------------------------------------------------------------------

function buildOrAr(words: OcrWord[]): FieldExtraction {
  const unique: OcrWord[] = [];
  for (const w of words) if (!unique.some((u) => u.text === w.text)) unique.push(w);
  return { ...build(unique, "digits"), value: unique.map((w) => w.text).join(", ") };
}

const orArTokens = (words: OcrWord[]) =>
  words.map((w) => ({ ...w, text: w.text.trim() })).filter((w) => /^\d[\d-]{3,}$/.test(w.text)).sort((a, b) => cy(a) - cy(b) || a.x0 - b.x0);

/**
 * Each reading is the words from one close-up pass over the O.R./A.R. column
 * (e.g. at two different magnifications). Two passes that agree are trusted;
 * if they disagree the person is told, since digits are where OCR slips.
 */
export function applyOrArRefinement(result: LabelExtractionResult, readings: OcrWord[][]): LabelExtractionResult {
  const built = readings.map((r) => orArTokens(r)).filter((t) => t.length > 0).map((t) => buildOrAr(t));
  if (built.length === 0) return result;

  const best = [...built].sort((a, b) => b.confidence - a.confidence)[0]!;
  const agree = built.every((b) => b.value === best.value);
  if (agree && built.length >= 2) return finish({ ...result, fields: { ...result.fields, orArNumber: best }, notes: { ...result.notes, orAr: null } });

  if (built.length === 1) {
    // only one close-up read produced digits: usable, but nothing to compare it with
    return finish({
      ...result,
      fields: { ...result.fields, orArNumber: { ...best, confidence: Math.min(best.confidence, 54) } },
      notes: { ...result.notes, orAr: null },
    });
  }

  // A reading that is just the other one with a digit missing (a digit lost at the edge of the crop)
  // is the same number read less completely, not a disagreement: go with the complete one.
  const longest = [...built].sort((a, b) => b.value.length - a.value.length)[0]!;
  const allContained = built.every((b) => longest.value.includes(b.value));
  if (allContained) {
    return finish({
      ...result,
      fields: { ...result.fields, orArNumber: { ...longest, confidence: Math.min(longest.confidence, 60) } },
      notes: { ...result.notes, orAr: null },
    });
  }

  const values = Array.from(new Set(built.map((b) => b.value)));
  return finish({
    ...result,
    fields: { ...result.fields, orArNumber: { ...best, confidence: Math.min(best.confidence, 40) } },
    notes: { ...result.notes, orAr: `The O.R./A.R. number was read two different ways (${values.join(" and ")}). Please check it against the photo.` },
  });
}

/** Recomputes the final warning list from its parts. */
function finish(result: LabelExtractionResult): LabelExtractionResult {
  const { base, amount, orAr } = result.notes;
  return { ...result, warnings: [...base, ...(amount ? [amount] : []), ...(orAr ? [orAr] : [])] };
}


// ---------------------------------------------------------------------------
// header rows: reconcile a close-up, line-level re-read with the first pass
// ---------------------------------------------------------------------------

/** Groups words into reading-order lines (words on a slightly wavy baseline still land on one line). */
function linesOf(words: OcrWord[]): OcrWord[][] {
  const usable = words.filter((w) => w.text.trim().length > 0);
  if (usable.length === 0) return [];
  const mh = median(usable.map((w) => w.y1 - w.y0)) || 1;
  const sorted = [...usable].sort((a, b) => cy(a) - cy(b));
  const lines: OcrWord[][] = [];
  for (const w of sorted) {
    const line = lines.find((l) => Math.abs(mean(l.map(cy)) - cy(w)) <= mh * 0.6);
    if (line) line.push(w);
    else lines.push([w]);
  }
  lines.sort((a, b) => mean(a.map(cy)) - mean(b.map(cy)));
  return lines.map((l) => l.sort((a, b) => a.x0 - b.x0));
}

/** Drops scraps of the printed rules/underlines that Tesseract reads as stray low-confidence marks. */
function isDebris(w: OcrWord): boolean {
  const t = w.text.trim();
  const alnum = (t.match(/[A-Za-z0-9]/g) ?? []).length;
  if (alnum === 0) return true;
  if (alnum / t.length < 0.5) return true;
  return w.confidence < 45 && t.length <= 3;
}

function textOf(words: OcrWord[]): string {
  return linesOf(words.filter((w) => !isDebris(w)))
    .map((l) => l.map((w) => w.text.trim()).join(" "))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips underline/bracket debris that Tesseract reads from the printed rules. */
function tidy(t: string): string {
  return t
    .replace(/[_|~=]+/g, " ")
    .replace(/\s[-—–]{1,}\s/g, " ")
    .replace(/^[^A-Za-z0-9₱(]+/, "")
    .replace(/[^A-Za-z0-9.)%]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(\s+[oeaisclz]{1,2})+$/, "")
    .trim();
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_LIKE = /(?:[A-Za-z]{3,9}\.?\s*\d{1,2}\s*[,.]?\s*\d{2,4}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/;

/**
 * "Dai Hui Date: August 20, 2026" -> name "Dai Hui", date "August 20, 2026".
 * Tolerates a misread or punctuation-less "Date" label ("Cate:", "Date August...").
 */
function splitNameAndDate(afterLabel: string): { name: string; date: string } {
  const labelRe = /\b[dco]a[tlf]e\b\s*[:;.]?\s*/gi;
  let match: RegExpExecArray | null;
  let found: { index: number; rest: string } | null = null;
  while ((match = labelRe.exec(afterLabel)) !== null) {
    const rest = afterLabel.slice(match.index + match[0].length);
    if (DATE_LIKE.test(rest)) found = { index: match.index, rest };
  }
  if (found) return { name: afterLabel.slice(0, found.index), date: found.rest };
  const month = MONTH_DATE.exec(afterLabel);
  if (month) return { name: afterLabel.slice(0, month.index), date: month[1] ?? "" };
  return { name: afterLabel, date: "" };
}

const MONTH_DATE = /([A-Za-z]{3,9}\.?\s*\d{1,2}\s*[,.]?\s*\d{4})/;

function confidenceOf(words: OcrWord[]): number {
  return mean(words.filter((w) => hasAlnum(w.text)).map((w) => w.confidence));
}

export interface HeaderRowReads {
  consumer?: OcrWord[];
  address?: OcrWord[];
  nature?: OcrWord[];
}

/**
 * Takes closely re-read lines for the three header rows and pulls the values out by the
 * printed label text. A value from the close-up replaces the first-pass one only when it
 * actually parsed to something.
 */
export function applyHeaderRowReads(result: LabelExtractionResult, reads: HeaderRowReads): LabelExtractionResult {
  const fields = { ...result.fields };
  const base = [...result.notes.base];
  const resolved = (key: FieldKey) => {
    const text = `Couldn't find "${FIELD_LABELS[key]}" on the page. Please fill it in manually.`;
    const i = base.indexOf(text);
    if (i >= 0) base.splice(i, 1);
  };
  const apply = (key: FieldKey, value: string, words: OcrWord[], kind: "text" | "digits" = "text") => {
    const cleaned = key === "dateOfServiceMemo" ? normalizeDate(value) : tidy(value);
    if (!cleaned) return;
    fields[key] = { value: cleaned, confidence: confidenceOf(words) || (kind === "digits" ? 50 : 60), words };
    resolved(key);
  };

  // name + date
  if (reads.consumer && reads.consumer.length) {
    const text = textOf(reads.consumer);
    const afterLabel = /consum[a-z]*\s*[:;.]?\s*(.*)$/i.exec(text)?.[1] ?? text.replace(/^.*?name\s+of\s*/i, "");
    const { name, date } = splitNameAndDate(afterLabel);
    apply("consumerName", name, reads.consumer);
    if (date) {
      // keep the first pass's date when the close-up one is incomplete (e.g. a year cut off at the margin)
      const closeUp = normalizeDate(date);
      const firstPass = result.fields.dateOfServiceMemo.value;
      if (ISO_DATE.test(closeUp) || !ISO_DATE.test(firstPass)) apply("dateOfServiceMemo", date, reads.consumer);
    }
  }

  // address (the account number shares this row; it is usually blank so only digits are taken)
  if (reads.address && reads.address.length) {
    const text = textOf(reads.address);
    const addr = /\baddress\b[\s:;.\u2018\u2019']*(.*)$/i.exec(text) ?? /\b(?:ad)?dress\s*[:;.\u2018\u2019']\s*(.*)$/i.exec(text);
    if (addr) {
      apply("address", addr[1] ?? "", reads.address);
      const before = text.slice(0, addr.index);
      const acctDigits = (/ac+e?t[^0-9]*([0-9][0-9\s-]{2,})/i.exec(before)?.[1] ?? "").replace(/\s+/g, "");
      if (acctDigits.length >= 4) apply("accountNumber", acctDigits, reads.address, "digits");
    }
  }

  // nature of complaint (may run onto a second line)
  if (reads.nature && reads.nature.length) {
    const text = textOf(reads.nature);
    const work = /\bwork\s*[:;.]\s*(.*)$/i.exec(text);
    if (work) apply("natureOfComplaint", work[1] ?? "", reads.nature);
  }

  return finish({ ...result, fields, notes: { ...result.notes, base } });
}
