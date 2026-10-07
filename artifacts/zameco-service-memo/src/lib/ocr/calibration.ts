/**
 * Field calibration for on-device OCR.
 *
 * Each field is a rectangle expressed as FRACTIONS of the full image's
 * width/height (0 to 1), not pixels. This is what makes one calibration
 * work regardless of the exact resolution a given phone's camera or
 * scanner produces, as long as the photo is cropped to the page edges the
 * same way every time (which the scan/crop screen already does).
 *
 * `psm` is Tesseract's "page segmentation mode" - different modes read
 * short snippets of printed text differently well. 6 ("a uniform block of
 * text") is the general default; 11 ("sparse text") works better for a few
 * specific fields on this form. These were chosen by testing against a
 * real scanned ZAMECO memo, not guessed.
 */

export interface FieldRegion {
  /** Left edge, as a fraction of image width (0-1) */
  x: number;
  /** Top edge, as a fraction of image height (0-1) */
  y: number;
  /** Width, as a fraction of image width (0-1) */
  width: number;
  /** Height, as a fraction of image height (0-1) */
  height: number;
  /** Tesseract page segmentation mode to use for this field */
  psm: number;
}

export type CalibratedField =
  | "consumerName"
  | "dateOfServiceMemo"
  | "accountNumber"
  | "address"
  | "natureOfComplaint"
  | "orArNumber"
  | "totalAmountPaid";

export type Calibration = Record<CalibratedField, FieldRegion>;

export const FIELD_LABELS: Record<CalibratedField, string> = {
  consumerName: "Name of Consumer",
  dateOfServiceMemo: "Date of Service Memo",
  accountNumber: "Account Number",
  address: "Address",
  natureOfComplaint: "Nature of Complaints / Work",
  orArNumber: "O.R. / A.R. Number",
  totalAmountPaid: "Total Amount Paid",
};

/**
 * Default calibration for ZAMECO I's "Service Memorandum" form, validated
 * against a real scanned sample. Converts (left, top, right, bottom)
 * fractions, which are easier to eyeball against a form, into the
 * (x, y, width, height) shape FieldRegion actually uses.
 */
function region(left: number, top: number, right: number, bottom: number, psm: number): FieldRegion {
  return { x: left, y: top, width: right - left, height: bottom - top, psm };
}

export const ZAMECO_DEFAULT_CALIBRATION: Calibration = {
  consumerName:      region(0.16,  0.200, 0.74, 0.225, 11),
  dateOfServiceMemo: region(0.73,  0.200, 0.97, 0.225, 6),
  accountNumber:     region(0.08,  0.221, 0.31, 0.245, 6),
  address:           region(0.38,  0.221, 0.92, 0.245, 11),
  natureOfComplaint: region(0.20,  0.240, 0.97, 0.265, 6),
  orArNumber:        region(0.60,  0.330, 0.76, 0.356, 6),
  totalAmountPaid:   region(0.47,  0.521, 0.62, 0.559, 6),
};

const STORAGE_KEY = "zameco:ocr-calibration";

/** Loads the saved calibration, falling back to the validated ZAMECO default. */
export function loadCalibration(): Calibration {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return ZAMECO_DEFAULT_CALIBRATION;
    const parsed = JSON.parse(raw) as Partial<Calibration>;
    // Merge over the default so a partially-saved/older calibration doesn't
    // leave a field completely missing.
    return { ...ZAMECO_DEFAULT_CALIBRATION, ...parsed };
  } catch {
    return ZAMECO_DEFAULT_CALIBRATION;
  }
}

export function saveCalibration(calibration: Calibration): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(calibration));
}

export function resetCalibration(): void {
  localStorage.removeItem(STORAGE_KEY);
}
