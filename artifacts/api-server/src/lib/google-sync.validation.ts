import assert from "node:assert/strict";
import { ReplitConnectors } from "@replit/connectors-sdk";
import type { ServiceMemoRecord } from "@workspace/db";
import { MEMO_SHEET_COLUMNS, appendMemoRow, memoImageFilename, memoSheetRow, uploadMemoImage } from "./google-sync";

const memo = {
  serviceMemoCode: "SM-202609220001",
  dateReceived: "2026-09-22",
  dateOfServiceMemo: "2026-09-21",
  natureOfComplaint: "Low voltage",
  accountNumber: "123456789",
  consumerName: "Sample Consumer",
  address: "Iba, Zambales",
  totalAmountPaid: "1,250.00",
  orArNumber: "OR-1001",
  imageMimeType: "image/jpeg",
  imageData: Buffer.from("validation image").toString("base64"),
} satisfies Partial<ServiceMemoRecord> as ServiceMemoRecord;

assert.deepEqual(MEMO_SHEET_COLUMNS, [
  "Service Memo Code",
  "Date Received",
  "Date of Service Memo",
  "Nature of Complaint",
  "Account Number",
  "Consumer Name",
  "Address",
  "Total Amount Paid",
  "OR/AR Number",
  "Drive Image Link",
]);
assert.equal(memoImageFilename(memo), "SM-202609220001.jpg");
assert.deepEqual(memoSheetRow(memo, "https://drive.example/image"), [
  "SM-202609220001",
  "2026-09-22",
  "2026-09-21",
  "Low voltage",
  "123456789",
  "Sample Consumer",
  "Iba, Zambales",
  "1,250.00",
  "OR-1001",
  "https://drive.example/image",
]);

const originalProxy = ReplitConnectors.prototype.proxy;
const files: Array<{ id: string; name: string; webViewLink: string }> = [];
const rows: string[][] = [Array.from(MEMO_SHEET_COLUMNS)];
let lostAppendResponse = true;
let lostUploadResponse = true;
let appendCount = 0;

ReplitConnectors.prototype.proxy = async (_connector, path, options) => {
  if (path.startsWith("/drive/v3/files?")) {
    const query = new URL(`https://example.invalid${path}`).searchParams.get("q") ?? "";
    assert.match(query, /'folder-test' in parents/);
    return Response.json({ files: files.filter((file) => query.includes(`name = '${file.name}'`)) });
  }
  if (path.includes("/upload/drive/v3/files")) {
    assert.equal(options?.method, "POST");
    files.push({ id: "file-test", name: memoImageFilename(memo), webViewLink: "https://drive.example/image" });
    if (lostUploadResponse) {
      lostUploadResponse = false;
      throw new Error("Drive response lost after upload");
    }
    return Response.json(files[0]);
  }
  if (path.includes("/v4/spreadsheets/sheet-test?fields=sheets(properties(title))")) {
    return Response.json({ sheets: [{ properties: { title: "Service Memos" } }] });
  }
  if (path.includes("/values/")) {
    const url = new URL(`https://example.invalid${path}`);
    const range = decodeURIComponent(url.pathname.split("/values/")[1].replace(/:(append)$/, ""));
    if (!options?.method || options.method === "GET") {
      assert.equal(range, "'Service Memos'!A:A");
      return Response.json({ values: rows.map((row) => [row[0]]) });
    }
    const body = JSON.parse(String(options.body)) as { values: string[][] };
    if (options.method === "POST") {
      assert.equal(range, "'Service Memos'!A:J");
      assert.equal(url.searchParams.get("valueInputOption"), "RAW");
      appendCount++;
      rows.push(body.values[0]);
      if (lostAppendResponse) {
        lostAppendResponse = false;
        throw new Error("Sheets response lost after append");
      }
      return Response.json({ updates: { updatedRows: 1 } });
    }
    assert.equal(options.method, "PUT");
    assert.equal(range, "'Service Memos'!A2:J2");
    assert.equal(url.searchParams.get("valueInputOption"), "RAW");
    rows[1] = body.values[0];
    return Response.json({});
  }
  throw new Error(`Unexpected proxy request: ${path}`);
};

try {
  await assert.rejects(uploadMemoImage(memo, "folder-test"), /Drive response lost/);
  const driveLink = await uploadMemoImage(memo, "folder-test");
  assert.equal(driveLink, "https://drive.example/image");
  assert.equal(files.length, 1, "Retry should reuse the Drive file");

  await appendMemoRow(memo, "sheet-test", "Service Memos", driveLink);
  await appendMemoRow(memo, "sheet-test", "Service Memos", driveLink);
  await appendMemoRow(memo, "sheet-test", "Service Memos", driveLink);
  assert.equal(appendCount, 1, "Retry should not append a second row");
  assert.equal(rows.length, 2, "There should be exactly one memo row");
  assert.deepEqual(rows[1], memoSheetRow(memo, driveLink));
} finally {
  ReplitConnectors.prototype.proxy = originalProxy;
}

console.info("Google sync contract and ambiguous-response retry validation passed");