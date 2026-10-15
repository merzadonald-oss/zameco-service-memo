// Assembles the files that go inside the Android app into ./www:
//   - the built web app (artifacts/zameco-service-memo/dist/public)
//   - the OCR engine files, so scanning works with no internet connection
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const mobile = resolve(here, "..");
const webBuild = resolve(mobile, "../artifacts/zameco-service-memo/dist/public");
const www = join(mobile, "www");
const require = createRequire(join(mobile, "package.json"));

if (!existsSync(join(webBuild, "index.html"))) {
  console.error(`The web app has not been built yet: ${webBuild}/index.html is missing.`);
  process.exit(1);
}

rmSync(www, { recursive: true, force: true });
cpSync(webBuild, www, { recursive: true });

// The browser cache (service worker) is not used inside the app.
rmSync(join(www, "sw.js"), { force: true });

const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const ocr = join(www, "ocr");
mkdirSync(join(ocr, "core"), { recursive: true });
mkdirSync(join(ocr, "lang"), { recursive: true });

// The OCR worker script
cpSync(join(pkgDir("tesseract.js"), "dist", "worker.min.js"), join(ocr, "worker.min.js"));

// The OCR engine (two builds; the phone uses the faster one if it supports SIMD)
for (const file of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"]) {
  cpSync(join(pkgDir("tesseract.js-core"), file), join(ocr, "core", file));
}

// English language data - the same model the website downloads
cpSync(join(pkgDir("@tesseract.js-data/eng"), "4.0.0_best_int", "eng.traineddata.gz"), join(ocr, "lang", "eng.traineddata.gz"));

console.log("Assembled app files in", www);
