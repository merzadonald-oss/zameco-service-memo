import { ReplitConnectors } from "@replit/connectors-sdk";
import type { ServiceMemoRecord } from "@workspace/db";

const connectors = new ReplitConnectors();

export const MEMO_SHEET_COLUMNS = [
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
] as const;
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";

async function checked(response: Response, label: string): Promise<Response> {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${label} failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  return response;
}

export async function uploadMemoImage(
  memo: ServiceMemoRecord,
  folderId: string,
): Promise<string> {
  if (!folderId) throw new Error("Google Drive folder ID is not configured");
  const filename = memoImageFilename(memo);
  const query = encodeURIComponent(
    `'${folderId.replaceAll("'", "\\'")}' in parents and name = '${filename.replaceAll("'", "\\'")}' and trashed = false`,
  );
  const existingResponse = await connectors.proxy(
    "google-drive",
    `/drive/v3/files?q=${query}&pageSize=1&fields=files(id,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  );
  const existing = (await (await checked(existingResponse, "Drive lookup")).json()) as {
    files?: Array<{ id: string; webViewLink?: string }>;
  };
  const existingFile = existing.files?.[0];
  if (existingFile) {
    return existingFile.webViewLink ?? `https://drive.google.com/file/d/${existingFile.id}/view`;
  }

  const metadata = JSON.stringify({ name: filename, parents: [folderId] });
  const boundary = `zameco-${Date.now()}`;
  const image = Buffer.from(memo.imageData, "base64");
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${memo.imageMimeType}\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--`);
  const response = await connectors.proxy(
    "google-drive",
    "/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: Buffer.concat([prefix, image, suffix]),
    },
  );
  const data = (await (await checked(response, "Drive upload")).json()) as { webViewLink?: string; id: string };
  return data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view`;
}

export async function validateDriveFolder(folderId: string): Promise<void> {
  const response = await connectors.proxy(
    "google-drive",
    `/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,name,mimeType,trashed`,
    { method: "GET" },
  );
  if (response.status === 404) {
    throw new Error("Drive folder not found. Check the folder link and make sure the connected Google account can access it.");
  }
  const data = (await (await checked(response, "Drive folder check")).json()) as {
    mimeType?: string;
    trashed?: boolean;
  };
  if (data.trashed) throw new Error("The selected Drive folder is in the trash.");
  if (data.mimeType !== DRIVE_FOLDER_MIME) {
    throw new Error("The Drive destination must be a folder.");
  }
}

export async function listDriveItems(
  parentId: string,
  type: "folder" | "spreadsheet",
): Promise<Array<{ id: string; name: string; kind: "folder" | "spreadsheet" }>> {
  const allowedMimeTypes = type === "folder"
    ? [DRIVE_FOLDER_MIME]
    : [DRIVE_FOLDER_MIME, GOOGLE_SHEET_MIME];
  const mimeQuery = allowedMimeTypes.map((mime) => `mimeType='${mime}'`).join(" or ");
  const query = `'${parentId.replaceAll("'", "\\'")}' in parents and trashed=false and (${mimeQuery})`;
  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name,mimeType)",
    orderBy: "folder,name_natural",
    pageSize: "100",
    spaces: "drive",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const response = await connectors.proxy(
    "google-drive",
    `/drive/v3/files?${params.toString()}`,
    { method: "GET" },
  );
  const data = (await (await checked(response, "Drive browse")).json()) as {
    files?: Array<{ id: string; name: string; mimeType: string }>;
  };
  return (data.files ?? []).map((file) => ({
    id: file.id,
    name: file.name,
    kind: file.mimeType === DRIVE_FOLDER_MIME ? "folder" as const : "spreadsheet" as const,
  }));
}

function sheetRange(sheetName: string, columns: string): string {
  return encodeURIComponent(`'${sheetName.replaceAll("'", "''")}'!${columns}`);
}

async function sheetRequest(path: string, label: string): Promise<Response> {
  const response = await connectors.proxy("google-sheet", path, { method: "GET" });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Google Sheet not found. Select a spreadsheet accessible to the connected Google Sheets account.");
    if (response.status === 403) throw new Error("Google Sheets access denied. Give the connected Google Sheets account access to this spreadsheet.");
    await checked(response, label);
  }
  return response;
}

export async function listSheetTabs(spreadsheetId: string): Promise<string[]> {
  const response = await sheetRequest(
    `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(title))`,
    "Sheets destination check",
  );
  const data = (await response.json()) as { sheets?: Array<{ properties?: { title?: string } }> };
  return (data.sheets ?? []).flatMap((sheet) => sheet.properties?.title ? [sheet.properties.title] : []);
}

export async function validateSheetDestination(spreadsheetId: string, sheetName: string): Promise<void> {
  const tabs = await listSheetTabs(spreadsheetId);
  if (!tabs.includes(sheetName)) {
    throw new Error(`Tab "${sheetName}" does not exist in the selected Google Sheet. Choose an existing tab${tabs.length ? ` (available: ${tabs.join(", ")})` : ""}.`);
  }
}

async function memoAlreadyInSheet(
  memoCode: string,
  spreadsheetId: string,
  sheetName: string,
): Promise<boolean> {
  const response = await sheetRequest(
    `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${sheetRange(sheetName, "A:A")}`,
    "Sheets duplicate check",
  );
  const data = (await response.json()) as { values?: string[][] };
  return (data.values ?? []).some((row) => row[0]?.trim() === memoCode);
}

export async function appendMemoRow(
  memo: ServiceMemoRecord,
  spreadsheetId: string,
  sheetName: string,
  driveLink: string,
): Promise<void> {
  if (!spreadsheetId) throw new Error("Google Sheet ID is not configured");
  await validateSheetDestination(spreadsheetId, sheetName);
  const lookupResponse = await sheetRequest(
    `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${sheetRange(sheetName, "A:A")}`,
    "Sheets duplicate check",
  );
  const lookup = (await lookupResponse.json()) as { values?: string[][] };
  const existingIndex = lookup.values?.findIndex((row) => row[0]?.trim() === memo.serviceMemoCode) ?? -1;
  const values = [memoSheetRow(memo, driveLink)];

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 1;
    const response = await connectors.proxy(
      "google-sheet",
      `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${sheetRange(sheetName, `A${rowNumber}:J${rowNumber}`)}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      },
    );
    await checked(response, "Sheets update");
    return;
  }

  try {
    const response = await connectors.proxy(
      "google-sheet",
      `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${sheetRange(sheetName, "A:J")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      },
    );
    const result = (await (await checked(response, "Sheets append")).json()) as { updates?: { updatedRows?: number } };
    if (!result.updates?.updatedRows) throw new Error("Sheets did not confirm that the memo row was added.");
  } catch (error) {
    // A lost response can follow a successful append; do not report a false failure.
    try {
      if (await memoAlreadyInSheet(memo.serviceMemoCode, spreadsheetId, sheetName)) return;
    } catch {
      // Keep the original append error if the verification read also fails.
    }
    throw error;
  }
}

export function memoSheetRow(
  memo: Pick<ServiceMemoRecord,
    "serviceMemoCode" | "dateReceived" | "dateOfServiceMemo" | "natureOfComplaint" |
    "accountNumber" | "consumerName" | "address" | "totalAmountPaid" | "orArNumber">,
  driveLink: string,
): string[] {
  return [
    memo.serviceMemoCode,
    memo.dateReceived,
    memo.dateOfServiceMemo,
    memo.natureOfComplaint,
    memo.accountNumber,
    memo.consumerName,
    memo.address,
    memo.totalAmountPaid,
    memo.orArNumber,
    driveLink,
  ];
}

export function memoImageFilename(memo: Pick<ServiceMemoRecord, "serviceMemoCode" | "imageMimeType">): string {
  const extension = memo.imageMimeType === "image/webp" ? "webp" : memo.imageMimeType === "image/png" ? "png" : "jpg";
  return `${memo.serviceMemoCode}.${extension}`;
}
