import { createWorker, type Worker, type ImageLike } from "tesseract.js";
import {
  extractFromWords,
  applyHeaderRowReads,
  applyAmountRefinement,
  applyOrArRefinement,
  type FieldKey,
  type OcrWord,
  type Region,
  type LabelExtractionResult,
} from "./labelExtract";

export { FIELD_LABELS } from "./labelExtract";
export type { FieldKey } from "./labelExtract";

export interface FieldOcrResult {
  value: string;
  /** Tesseract's own 0-100 confidence for this field. 0 means it could not be located. */
  confidence: number;
}

export type OcrResults = Record<FieldKey, FieldOcrResult>;

export interface OcrOutcome {
  fields: OcrResults;
  /** Plain-language notes for whoever reviews the memo (missing fields, numbers that don't add up, ...). */
  warnings: string[];
}

export interface ExtractProgress {
  label: string;
  index: number;
  total: number;
}

// ---------------------------------------------------------------------------
// engine setup
// ---------------------------------------------------------------------------

export interface OcrEngineOptions {
  /** Where the OCR language data / engine files are loaded from. Defaults to Tesseract.js's CDN. */
  langPath?: string;
  corePath?: string;
  workerPath?: string;
  gzip?: boolean;
  /** Converts a canvas into something the recognizer accepts. Defaults to the canvas itself. */
  imageInput?: (canvas: HTMLCanvasElement) => ImageLike;
  /** Diagnostics: receives the words each reading pass produced (useful when a photo reads badly). */
  debug?: (stage: string, words: OcrWord[]) => void;
}

let engineOptions: OcrEngineOptions = {};

/**
 * Optional. Lets the app point the OCR engine at files bundled inside it (so
 * scanning works with no internet) instead of downloading them on first use.
 */
export function configureOcrEngine(options: OcrEngineOptions): void {
  engineOptions = options;
}

let sharedWorker: Worker | null = null;

async function getWorker(): Promise<Worker> {
  if (!sharedWorker) {
    const { imageInput: _input, debug: _debug, ...workerOptions } = engineOptions;
    sharedWorker = await createWorker("eng", 1, workerOptions);
  }
  return sharedWorker;
}

/** Releases the Tesseract worker. Call when leaving the scan flow. */
export async function terminateOcrWorker(): Promise<void> {
  if (sharedWorker) {
    await sharedWorker.terminate();
    sharedWorker = null;
  }
}

// ---------------------------------------------------------------------------
// image helpers
// ---------------------------------------------------------------------------

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the scanned image for OCR."));
    img.src = dataUrl;
  });
}

function newCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");
  return ctx;
}

function drawToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = newCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const ctx = context(canvas);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return canvas;
}

/**
 * Rotates the page so its text rows are level. This is the same rotation the
 * extractor applied to the word positions, so a region found there can be
 * cropped straight out of the result.
 */
function straighten(source: HTMLCanvasElement, skew: LabelExtractionResult["skew"]): HTMLCanvasElement {
  if (Math.abs(skew.radians) < 0.0025) return source; // under ~0.15 degrees: leave it alone
  const canvas = newCanvas(source.width, source.height);
  const ctx = context(canvas);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cos = Math.cos(skew.radians);
  const sin = Math.sin(skew.radians);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(skew.originX, skew.originY);
  // x' = cos*x + sin*y, y' = -sin*x + cos*y (about the origin)
  ctx.transform(cos, -sin, sin, cos, 0, 0);
  ctx.drawImage(source, -skew.originX, -skew.originY);
  return canvas;
}

/** Lanczos (a = 3) kernel: the sharpest of the common enlargement filters, which keeps the gaps between letters intact. */
function lanczos3(x: number): number {
  if (x === 0) return 1;
  if (Math.abs(x) >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

/** For each output position, which source pixels contribute and with what weight. */
function lanczosWeights(sourceSize: number, targetSize: number): { start: number; weights: Float32Array }[] {
  const ratio = sourceSize / targetSize;
  const out: { start: number; weights: Float32Array }[] = [];
  for (let i = 0; i < targetSize; i++) {
    const center = (i + 0.5) * ratio - 0.5;
    const start = Math.floor(center) - 2;
    const weights = new Float32Array(6);
    let sum = 0;
    for (let k = 0; k < 6; k++) {
      weights[k] = lanczos3(center - (start + k));
      sum += weights[k]!;
    }
    for (let k = 0; k < 6; k++) weights[k] = weights[k]! / sum;
    out.push({ start, weights });
  }
  return out;
}

/** Enlarges a single-channel image with Lanczos resampling (horizontal pass, then vertical). */
function resizeGray(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const xw = lanczosWeights(sw, dw);
  const yw = lanczosWeights(sh, dh);
  const tmp = new Float32Array(dw * sh);
  for (let y = 0; y < sh; y++) {
    const row = y * sw;
    for (let x = 0; x < dw; x++) {
      const { start, weights } = xw[x]!;
      let acc = 0;
      for (let k = 0; k < 6; k++) {
        const sx = Math.min(sw - 1, Math.max(0, start + k));
        acc += src[row + sx]! * weights[k]!;
      }
      tmp[y * dw + x] = acc;
    }
  }
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const { start, weights } = yw[y]!;
    for (let x = 0; x < dw; x++) {
      let acc = 0;
      for (let k = 0; k < 6; k++) {
        const sy = Math.min(sh - 1, Math.max(0, start + k));
        acc += tmp[sy * dw + x]! * weights[k]!;
      }
      out[y * dw + x] = acc;
    }
  }
  return out;
}

/**
 * Cuts a region out of the page and enlarges it, which makes small print easier for OCR to read.
 * (Done with Lanczos resampling rather than the canvas's own smoothing: on lower-resolution photos
 * the canvas's softer enlargement blurs the gaps between letters and words run together.)
 */
function cropRegion(source: HTMLCanvasElement, region: Region, scale: number): HTMLCanvasElement | null {
  const x0 = Math.max(0, Math.floor(region.x0));
  const y0 = Math.max(0, Math.floor(region.y0));
  const x1 = Math.min(source.width, Math.ceil(region.x1));
  const y1 = Math.min(source.height, Math.ceil(region.y1));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 8 || h < 8) return null;

  const pixels = context(source).getImageData(x0, y0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * pixels[i * 4]! + 0.587 * pixels[i * 4 + 1]! + 0.114 * pixels[i * 4 + 2]!;
  }

  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  const big = resizeGray(gray, w, h, dw, dh);

  const canvas = newCanvas(dw, dh);
  const ctx = context(canvas);
  const image = ctx.createImageData(dw, dh);
  for (let i = 0; i < dw * dh; i++) {
    const v = Math.max(0, Math.min(255, big[i]!));
    image.data[i * 4] = v;
    image.data[i * 4 + 1] = v;
    image.data[i * 4 + 2] = v;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------
// recognition
// ---------------------------------------------------------------------------

async function readWords(canvas: HTMLCanvasElement, pageSegMode: string, stage = ""): Promise<OcrWord[]> {
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: pageSegMode as never });
  const input = engineOptions.imageInput ? engineOptions.imageInput(canvas) : canvas;
  const { data } = await worker.recognize(input, {}, { blocks: true });
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const w of line.words) {
          words.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, confidence: w.confidence });
        }
      }
    }
  }
  engineOptions.debug?.(stage, words);
  return words;
}

/** Page segmentation modes, chosen by testing against real memo photos. */
const SPARSE_TEXT = "11"; // whole page: find words wherever they are
const SINGLE_COLUMN = "4"; // a few lines of text (the complaint, which may wrap)
const SINGLE_BLOCK = "6"; // a block such as the amounts column
const SINGLE_LINE = "7"; // one line (name+date row, account+address row)

async function reread(
  page: HTMLCanvasElement,
  region: Region | null,
  scale: number,
  pageSegMode: string,
  stage: string,
): Promise<OcrWord[] | undefined> {
  if (!region) return undefined;
  const crop = cropRegion(page, region, scale);
  if (!crop) return undefined;
  try {
    return await readWords(crop, pageSegMode, stage);
  } catch (err) {
    // A failed close-up shouldn't lose the whole scan; the first full-page read still stands.
    console.warn("Close-up OCR pass failed", err);
    return undefined;
  }
}

/**
 * Reads a scanned ZAMECO service memo entirely on-device (no server, no AI key).
 *
 * 1. Reads the whole page once and finds the printed labels ("Consumer:", "Address:",
 *    "Amount", ...) - so it works wherever the paper sits in the photo.
 * 2. Straightens the page if it is tilted.
 * 3. Re-reads the header lines, the amounts and the O.R./A.R. column up close, where
 *    the exact position is now known, and reconciles the readings.
 */
export async function extractFieldsWithOcr(
  imageDataUrl: string,
  onProgress?: (progress: ExtractProgress) => void,
): Promise<OcrOutcome> {
  const total = 4;
  const step = (index: number, label: string) => onProgress?.({ label, index, total });

  const img = await loadImage(imageDataUrl);
  const original = drawToCanvas(img);

  step(1, "Reading the page");
  const fullPage = await readWords(original, SPARSE_TEXT, "full page");
  let result: LabelExtractionResult = extractFromWords(fullPage, original.width, original.height);

  const page = straighten(original, result.skew);

  step(2, "Reading the header lines");
  const rows = result.rowRegions;
  const consumer = await reread(page, rows.consumer, 2, SINGLE_LINE, "consumer row");
  const address = await reread(page, rows.address, 2, SINGLE_LINE, "address row");
  const nature = await reread(page, rows.nature, 2, SINGLE_COLUMN, "nature row");
  result = applyHeaderRowReads(result, { consumer, address, nature });

  step(3, "Checking the amounts");
  const amounts = await reread(page, result.amountRegion, 3, SINGLE_BLOCK, "amounts");
  if (amounts) result = applyAmountRefinement(result, amounts);

  step(4, "Checking the O.R./A.R. number");
  const orArReads = [await reread(page, result.orArRegion, 3, SINGLE_BLOCK, "or/ar 3x"), await reread(page, result.orArRegion, 4, SINGLE_COLUMN, "or/ar 4x")].filter(
    (r): r is OcrWord[] => r !== undefined,
  );
  if (orArReads.length > 0) result = applyOrArRefinement(result, orArReads);

  const fields = {} as OcrResults;
  (Object.keys(result.fields) as FieldKey[]).forEach((key) => {
    fields[key] = { value: result.fields[key].value, confidence: result.fields[key].confidence };
  });
  return { fields, warnings: result.warnings };
}
