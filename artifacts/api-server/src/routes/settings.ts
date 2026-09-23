import { Router, type IRouter } from "express";
import { db, appSettingsTable } from "@workspace/db";
import {
  GetSettingsResponse,
  ListDriveItemsQueryParams,
  ListDriveItemsResponse,
  ListSheetTabsParams,
  ListSheetTabsResponse,
  UpdateSettingsBody,
  UpdateSettingsResponse,
} from "@workspace/api-zod";
import { listDriveItems, listSheetTabs, validateDriveFolder, validateSheetDestination } from "../lib/google-sync";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

async function ensureSettings() {
  const [existing] = await db.select().from(appSettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(appSettingsTable).values({}).returning();
  return created;
}

router.get("/settings", async (_req, res): Promise<void> => {
  const settings = await ensureSettings();
  res.json(GetSettingsResponse.parse({
    ...settings,
    driveConnected: true,
    sheetsConnected: true,
  }));
});

router.put("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const driveFolderId = extractDriveFolderId(parsed.data.driveFolderId);
  const spreadsheetId = extractSpreadsheetId(parsed.data.spreadsheetId);
  if (!driveFolderId || !spreadsheetId) {
    res.status(400).json({ error: "Enter a valid Google Drive folder link/ID and Google Sheet link/ID." });
    return;
  }
  try {
    await validateDriveFolder(driveFolderId);
    await validateSheetDestination(spreadsheetId, parsed.data.sheetName.trim());
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to validate the sync destinations." });
    return;
  }
  const current = await ensureSettings();
  const [updated] = await db.update(appSettingsTable)
    .set({ ...parsed.data, sheetName: parsed.data.sheetName.trim(), driveFolderId, spreadsheetId, updatedAt: new Date() })
    .where(eq(appSettingsTable.id, current.id))
    .returning();
  res.json(UpdateSettingsResponse.parse({ ...updated, driveConnected: true, sheetsConnected: true }));
});

router.get("/sheets/:spreadsheetId/tabs", async (req, res): Promise<void> => {
  const parsed = ListSheetTabsParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    res.json(ListSheetTabsResponse.parse({ tabs: await listSheetTabs(parsed.data.spreadsheetId) }));
  } catch (error) {
    req.log.warn({ err: error }, "Unable to list spreadsheet tabs");
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to list spreadsheet tabs." });
  }
});

router.get("/drive/items", async (req, res): Promise<void> => {
  const parsed = ListDriveItemsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const items = await listDriveItems(parsed.data.parentId ?? "root", parsed.data.type);
    res.json(ListDriveItemsResponse.parse({ items }));
  } catch (error) {
    req.log.error({ err: error }, "Unable to browse Google Drive");
    res.status(502).json({ error: error instanceof Error ? error.message : "Unable to browse Google Drive." });
  }
});

function extractDriveFolderId(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? trimmed;
}

function extractSpreadsheetId(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? trimmed;
}

export default router;