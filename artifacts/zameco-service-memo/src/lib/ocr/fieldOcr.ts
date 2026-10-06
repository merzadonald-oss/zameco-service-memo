import { createWorker, type Worker } from "tesseract.js";
import { type Calibration, type CalibratedField, FIELD_LABELS } from "./calibration";

export interface FieldOcrResult {
  value: string;
  /** Tesseract's own 0-100 confidence score for this region. */
  confidence: number;
}

export type OcrResults = Record<CalibratedField, FieldOcrResult>;

/**
 * Loads an image from a base64 data URL (what the scan/crop screen already
 * produces) as an HTMLImageElement, ready to be drawn onto a canvas.
 */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the scanned image for OCR."));
    img.src = dataUrl;
  });
}

/**
 * Crops one calibrated field out of the full image onto its own canvas,
 * upscaled 3x. OCR accuracy on the small text regions of a form like this
 * is noticeably better on an upscaled crop than on the crop at its native
 * resolution, since each character ends up with more pixels to work with.
 */
function cropField(img: HTMLImageElement, field: { x: number; y: number; width: number; height: number }): HTMLCanvasElement {
  const sx = Math.round(field.x * img.naturalWidth);
  const sy = Math.round(field.y * img.naturalHeight);
  const sw = Math.round(field.width * img.naturalWidth);
  const sh = Math.round(field.height * img.naturalHeight);

  const canvas = document.createElement("canvas");
  const scale = 3;
  canvas.width = sw * scale;
  canvas.height = sh * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported in this browser.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Strips common leftover fragments of the printed field label that can
 * bleed into a crop when its left edge sits close to the label text (for
 * example "imer:Dai Hui" instead of "Dai Hui", from the tail end of "Name
 * of Consumer:"). This is a light cleanup pass, not a guarantee - the
 * Verification screen is still where the user confirms or corrects values.
 */
function cleanText(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/^[^A-Za-z0-9₱.]+/, "") // drop leading punctuation/stray glyphs
    .replace(/^(imer|mer|umer)[:;]\s*/i, "") // tail of "...Consumer:"
    .replace(/^[0-9]?[:;]\s*/, "") // stray leading colon/semicolon fragments
    .trim();
}

let sharedWorker: Worker | null = null;
let sharedWorkerPsm: number | null = null;

async function getWorker(psm: number): Promise<Worker> {
  if (sharedWorker && sharedWorkerPsm === psm) return sharedWorker;
  if (sharedWorker) await sharedWorker.terminate();
  const worker = await createWorker("eng");
  await worker.setParameters({ tessedit_pageseg_mode: String(psm) as any });
  sharedWorker = worker;
  sharedWorkerPsm = psm;
  return worker;
}

/** Releases the Tesseract worker. Call when leaving the scan flow. */
export async function terminateOcrWorker(): Promise<void> {
  if (sharedWorker) {
    await sharedWorker.terminate();
    sharedWorker = null;
    sharedWorkerPsm = null;
  }
}

export interface ExtractProgress {
  field: CalibratedField;
  label: string;
  index: number;
  total: number;
}

/**
 * Runs OCR over every calibrated field region of a scanned memo image and
 * returns the recognized text and confidence for each one. Runs entirely
 * on-device - no network call, no API key, no server.
 */
export async function extractFieldsWithOcr(
  imageDataUrl: string,
  calibration: Calibration,
  onProgress?: (progress: ExtractProgress) => void,
): Promise<OcrResults> {
  const img = await loadImage(imageDataUrl);
  const fields = Object.keys(calibration) as CalibratedField[];
  const results = {} as OcrResults;

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const region = calibration[field];
    onProgress?.({ field, label: FIELD_LABELS[field], index: i + 1, total: fields.length });

    const canvas = cropField(img, region);
    const worker = await getWorker(region.psm);
    const { data } = await worker.recognize(canvas);

    results[field] = {
      value: cleanText(data.text),
      confidence: data.confidence,
    };
  }

  return results;
}
