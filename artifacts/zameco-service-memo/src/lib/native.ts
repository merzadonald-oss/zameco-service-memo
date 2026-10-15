import { configureOcrEngine } from "@/lib/ocr/fieldOcr";

/**
 * True when the app is running inside the installed Android app (Capacitor injects
 * `window.Capacitor` there), false in an ordinary browser.
 */
export function isNativeApp(): boolean {
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(capacitor?.isNativePlatform?.());
}

/**
 * Inside the installed app the OCR engine files are bundled with the app (under /ocr), so
 * scanning works with no internet connection. In a browser they are downloaded from a CDN
 * on first use instead.
 */
export function configureNativeOcrAssets(): void {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  configureOcrEngine({
    workerPath: `${base}/ocr/worker.min.js`,
    corePath: `${base}/ocr/core`,
    langPath: `${base}/ocr/lang`,
  });
}
