import { getOcrEngineOptions, readTextForCheck, startEngineForCheck } from "./fieldOcr";
import { isNativeApp } from "@/lib/native";

/**
 * A step-by-step check of the on-device OCR engine, for when scanning won't work on a particular
 * phone. Each stage is tested separately and reported in plain language, so it is clear whether
 * the engine's files can't be loaded, the background worker can't start, or it is just slow.
 */

const CDN_WORKER = "https://cdn.jsdelivr.net/npm/tesseract.js@v6.0.1/dist/worker.min.js";

function absolute(path: string): string {
  return new URL(path, window.location.href).href;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "TIMEOUT"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("TIMEOUT"), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        resolve(`ERROR: ${error instanceof Error ? error.message : String(error)}` as never);
      },
    );
  });
}

/** Runs a few lines of code inside a throwaway background worker and returns what it reports. */
function runInWorker(code: string, ms: number): Promise<string> {
  return new Promise((resolve) => {
    let worker: Worker | null = null;
    const timer = setTimeout(() => {
      worker?.terminate();
      resolve("TIMEOUT (no answer)");
    }, ms);
    try {
      const url = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
      worker = new Worker(url);
      worker.onmessage = (event) => {
        clearTimeout(timer);
        worker?.terminate();
        resolve(String(event.data));
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        worker?.terminate();
        resolve(`ERROR ${event.message || "(worker failed to start)"}`);
      };
    } catch (error) {
      clearTimeout(timer);
      resolve(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

async function checkFile(url: string): Promise<string> {
  const started = Date.now();
  const result = await withTimeout(
    (async () => {
      const response = await fetch(url, { cache: "no-store" });
      const type = response.headers.get("content-type") ?? "unknown type";
      const bytes = await response.arrayBuffer();
      const head = new TextDecoder().decode(bytes.slice(0, 20)).trimStart();
      const looksLikeWebPage = head.startsWith("<");
      return `${response.status}, ${(bytes.byteLength / 1024).toFixed(0)} KB, ${type}${looksLikeWebPage ? " <- this is a web page, not the file!" : ""}`;
    })(),
    15000,
  );
  return `${result} (${((Date.now() - started) / 1000).toFixed(1)}s)`;
}

function supportsSimd(): boolean {
  // the smallest WebAssembly module that uses a SIMD instruction
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
  try {
    return typeof WebAssembly === "object" && WebAssembly.validate(bytes);
  } catch {
    return false;
  }
}

export async function diagnoseOcrEngine(onLine?: (line: string) => void): Promise<string[]> {
  const lines: string[] = [];
  const started = Date.now();
  const log = (line: string) => {
    lines.push(line);
    onLine?.(line);
  };
  const secs = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

  // 1. the phone
  log(`Running as: ${isNativeApp() ? "installed app" : "web browser"}`);
  log(`Online: ${navigator.onLine ? "yes" : "no"}`);
  log(`Background workers: ${typeof Worker !== "undefined" ? "available" : "NOT available"}`);
  log(`WebAssembly: ${typeof WebAssembly === "object" ? "available" : "NOT available"}, SIMD: ${supportsSimd() ? "yes" : "no"}`);
  log(`Cores: ${navigator.hardwareConcurrency ?? "?"}, memory: ${(navigator as { deviceMemory?: number }).deviceMemory ?? "?"} GB`);
  log(`Web view: ${navigator.userAgent.replace(/^Mozilla\/5.0 /, "").slice(0, 90)}`);

  // 2. the engine's files, as seen from the page
  const options = getOcrEngineOptions();
  const bundled = Boolean(options.workerPath || options.corePath || options.langPath);
  log(bundled ? "Engine files: bundled inside the app" : "Engine files: downloaded from the internet");
  const workerUrl = absolute(options.workerPath ?? CDN_WORKER);
  if (bundled) {
    const core = options.corePath ?? "";
    log(`  worker script: ${await checkFile(workerUrl)}`);
    log(`  core (standard): ${await checkFile(absolute(`${core}/tesseract-core-lstm.wasm.js`))}`);
    log(`  core (SIMD): ${await checkFile(absolute(`${core}/tesseract-core-simd-lstm.wasm.js`))}`);
    log(`  language data: ${await checkFile(absolute(`${options.langPath}/eng.traineddata.gz`))}`);
  }

  // 3. can a background worker run, and load the engine's files itself?
  log(`Worker starts: ${await runInWorker("postMessage('yes');", 8000)}  [${secs()}]`);
  log(`Worker loads the engine script: ${await runInWorker(`try { importScripts(${JSON.stringify(workerUrl)}); postMessage('yes'); } catch (e) { postMessage('NO - ' + e); }`, 15000)}  [${secs()}]`);
  if (bundled) {
    const langUrl = absolute(`${options.langPath}/eng.traineddata.gz`);
    log(
      `Worker downloads language data: ${await runInWorker(`fetch(${JSON.stringify(langUrl)}).then(r => r.arrayBuffer()).then(b => postMessage('yes, ' + b.byteLength + ' bytes')).catch(e => postMessage('NO - ' + e));`, 20000)}  [${secs()}]`,
    );
  }

  // 4. the engine itself
  let lastDetail = "";
  try {
    const source = await startEngineForCheck((detail) => {
      lastDetail = detail;
    });
    log(`Engine starts: yes (${source === "bundled" ? "bundled copy" : "online copy"})  [${secs()}]`);
  } catch (error) {
    log(`Engine starts: NO - ${error instanceof Error ? error.message : String(error)}`);
    if (lastDetail) log(`  last status: ${lastDetail}`);
    return lines;
  }

  // 5. read a small piece of text
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 420;
    canvas.height = 90;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas not supported");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    ctx.font = "bold 44px sans-serif";
    ctx.fillText("ZAMECO 177736", 14, 62);
    const readStarted = Date.now();
    const text = await withTimeout(readTextForCheck(canvas), 60000);
    log(`Reads a test image: "${text}" (expected "ZAMECO 177736") in ${((Date.now() - readStarted) / 1000).toFixed(1)}s`);
  } catch (error) {
    log(`Reads a test image: NO - ${error instanceof Error ? error.message : String(error)}`);
  }

  log(`Done in ${secs()}`);
  return lines;
}
