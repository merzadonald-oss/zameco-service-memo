// Small edits to the freshly generated Android project.
// The scanner opens the phone camera through a normal <input type="file" capture>, which
// only works if the app declares the camera permission.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, "../android/app/src/main/AndroidManifest.xml");
let xml = readFileSync(manifestPath, "utf8");

const permission = '<uses-permission android:name="android.permission.CAMERA" />';
const feature = '<uses-feature android:name="android.hardware.camera" android:required="false" />';

if (!xml.includes("android.permission.CAMERA")) {
  xml = xml.replace('<uses-permission android:name="android.permission.INTERNET" />', `<uses-permission android:name="android.permission.INTERNET" />\n    ${permission}\n    ${feature}`);
}
if (!xml.includes("android.permission.CAMERA")) {
  console.error("Could not add the camera permission: the manifest layout was not what this script expects.");
  process.exit(1);
}

writeFileSync(manifestPath, xml);
console.log("Patched", manifestPath);
