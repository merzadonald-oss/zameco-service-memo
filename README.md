# Test APK (step 1 of the Android conversion)

## 1. Upload these files to GitHub (keep the folders)
Drag the `artifacts` and `mobile` folders (from INSIDE this unzipped folder) into
Add file -> Upload files. Before committing, check the paths shown start with
`artifacts/...` or `mobile/...` and nothing else in front. Commit to main.

  artifacts/zameco-service-memo/src/App.tsx        (changed)
  artifacts/zameco-service-memo/src/lib/native.ts  (new)
  mobile/package.json, package-lock.json, capacitor.config.json
  mobile/scripts/prepare-assets.mjs, patch-android.mjs

## 2. Create the build recipe (GitHub can't take dot-folders by upload)
Add file -> Create new file. In the name box type exactly:
  .github/workflows/build-apk.yml
Paste the whole contents of build-apk.yml (in this folder) and commit.

## 3. Build the APK
GitHub -> Actions tab -> "Build Android APK" -> Run workflow.
Takes roughly 10-15 minutes. When green, open the run and download
"zameco-memo-apk" from the bottom (a zip containing app-debug.apk).

## 4. Install and test on your phone
Send app-debug.apk to your phone and open it (allow "install unknown apps" if asked).
This is a TEST build of the scanner. Saving, history and the dashboard still need
the server and are not expected to work yet.
