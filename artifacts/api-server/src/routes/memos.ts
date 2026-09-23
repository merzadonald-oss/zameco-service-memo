import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, appSettingsTable, serviceMemosTable, type ServiceMemoRecord } from "@workspace/db";
import {
  CreateMemoBody, CreateMemoResponse, ExtractMemoBody, ExtractMemoResponse,
  GetDashboardResponse, GetNextMemoCodeResponse, ListMemosQueryParams, ListMemosResponse,
  RetryMemoSyncParams, RetryMemoSyncResponse,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { appendMemoRow, uploadMemoImage } from "../lib/google-sync";

const router: IRouter = Router();

const publicMemo = (memo: ServiceMemoRecord) => ({
  id: memo.id,
  serviceMemoCode: memo.serviceMemoCode,
  dateReceived: memo.dateReceived,
  dateOfServiceMemo: memo.dateOfServiceMemo,
  natureOfComplaint: memo.natureOfComplaint,
  accountNumber: memo.accountNumber,
  consumerName: memo.consumerName,
  address: memo.address,
  totalAmountPaid: memo.totalAmountPaid,
  orArNumber: memo.orArNumber,
  driveStatus: memo.driveStatus,
  sheetStatus: memo.sheetStatus,
  driveImageLink: memo.driveImageLink,
  syncError: memo.syncError,
  createdAt: memo.createdAt,
});

function todayTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function syncMemo(memo: ServiceMemoRecord): Promise<ServiceMemoRecord> {
  return db.transaction(async (tx) => {
    // Serialize retries for a memo, including concurrent requests from different servers.
    await tx.execute(sql`select pg_advisory_xact_lock(48221, ${memo.id})`);
    const [current] = await tx.select().from(serviceMemosTable).where(eq(serviceMemosTable.id, memo.id));
    if (!current) throw new Error("Memo not found");
    if (current.driveStatus === "synced" && current.sheetStatus === "synced") return current;
    const [settings] = await tx.select().from(appSettingsTable).limit(1);
    let driveLink = current.driveImageLink;
    let driveStatus = current.driveStatus;
    let sheetStatus = current.sheetStatus;
    try {
      if (!settings) throw new Error("Google Workspace settings are not configured");
      if (driveStatus !== "synced") {
        driveLink = await uploadMemoImage(current, settings.driveFolderId);
        driveStatus = "synced";
      }
      if (sheetStatus !== "synced") {
        await appendMemoRow(current, settings.spreadsheetId, settings.sheetName, driveLink ?? "");
        sheetStatus = "synced";
      }
      const [updated] = await tx.update(serviceMemosTable).set({
        driveStatus, sheetStatus, driveImageLink: driveLink, syncError: null,
        imageData: driveStatus === "synced" ? "" : current.imageData,
      }).where(eq(serviceMemosTable.id, current.id)).returning();
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed";
      const [updated] = await tx.update(serviceMemosTable).set({
        driveStatus: driveStatus === "synced" ? "synced" : "failed",
        sheetStatus: sheetStatus === "synced" ? "synced" : "failed",
        driveImageLink: driveLink,
        imageData: driveStatus === "synced" ? "" : current.imageData,
        syncError: message,
      }).where(eq(serviceMemosTable.id, current.id)).returning();
      return updated;
    }
  });
}

router.get("/dashboard", async (_req, res): Promise<void> => {
  const today = todayTaipei();
  const [counts] = await db.select({
    total: sql<number>`count(*)::int`,
    today: sql<number>`count(*) filter (where ${serviceMemosTable.dateReceived} = ${today})::int`,
    synced: sql<number>`count(*) filter (where ${serviceMemosTable.driveStatus} = 'synced' and ${serviceMemosTable.sheetStatus} = 'synced')::int`,
    failed: sql<number>`count(*) filter (where ${serviceMemosTable.driveStatus} = 'failed' or ${serviceMemosTable.sheetStatus} = 'failed')::int`,
    pending: sql<number>`count(*) filter (where ${serviceMemosTable.driveStatus} = 'pending' or ${serviceMemosTable.sheetStatus} = 'pending')::int`,
  }).from(serviceMemosTable);
  const recent = await db.select().from(serviceMemosTable).orderBy(desc(serviceMemosTable.createdAt)).limit(5);
  res.json(GetDashboardResponse.parse({
    todayScans: counts.today, totalScans: counts.total, syncedCount: counts.synced,
    pendingCount: counts.pending, failedCount: counts.failed, recentMemos: recent.map(publicMemo),
  }));
});

router.get("/memos", async (req, res): Promise<void> => {
  const parsed = ListMemosQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { search, status, limit = 50 } = parsed.data;
  const filters = [];
  if (search) filters.push(or(
    ilike(serviceMemosTable.serviceMemoCode, `%${search}%`),
    ilike(serviceMemosTable.consumerName, `%${search}%`),
    ilike(serviceMemosTable.accountNumber, `%${search}%`),
  ));
  if (status && status !== "all") {
    if (status === "synced") filters.push(and(eq(serviceMemosTable.driveStatus, "synced"), eq(serviceMemosTable.sheetStatus, "synced")));
    else filters.push(or(eq(serviceMemosTable.driveStatus, status), eq(serviceMemosTable.sheetStatus, status)));
  }
  const rows = await db.select().from(serviceMemosTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(serviceMemosTable.createdAt)).limit(limit);
  res.json(ListMemosResponse.parse(rows.map(publicMemo)));
});

router.get("/memos/next-code", async (_req, res): Promise<void> => {
  const dateReceived = todayTaipei();
  const [row] = await db.select({ max: sql<number>`coalesce(max(${serviceMemosTable.dailySequence}), 0)::int` })
    .from(serviceMemosTable).where(eq(serviceMemosTable.dateReceived, dateReceived));
  const code = `SM-${dateReceived.replaceAll("-", "")}${String(row.max + 1).padStart(4, "0")}`;
  res.json(GetNextMemoCodeResponse.parse({ code, dateReceived }));
});

router.post("/memos/extract", async (req, res): Promise<void> => {
  const parsed = ExtractMemoBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const response = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `Read this ZAMECO utility service memo. Return only JSON with keys dateOfServiceMemo, natureOfComplaint, accountNumber, consumerName, address, totalAmountPaid, orArNumber, confidence (0-1), warnings (string array). The dateOfServiceMemo MUST be the date printed at the top of the document, not a payment date, due date, meter date, or date elsewhere on the form. Return that date as YYYY-MM-DD. The totalAmountPaid MUST be the bottom-most (lowest positioned) numeric value under the AMOUNT column; preserve its decimals and do not add other amounts. Return the amount as a string, including any printed thousands separators. Preserve wording. Use empty strings when unreadable. Multiple OR/AR numbers must be comma-separated.` },
        { type: "image_url", image_url: { url: `data:${parsed.data.imageMimeType};base64,${parsed.data.imageData}` } },
      ],
    }],
  });
  const raw = response.choices[0]?.message.content;
  if (!raw) throw new Error("OCR returned no result");
  const extracted = JSON.parse(raw) as Record<string, unknown>;
  res.json(ExtractMemoResponse.parse({
    serviceMemoCode: parsed.data.serviceMemoCode,
    dateReceived: parsed.data.dateReceived,
    dateOfServiceMemo: extracted.dateOfServiceMemo ?? "",
    natureOfComplaint: extracted.natureOfComplaint ?? "",
    accountNumber: extracted.accountNumber ?? "",
    consumerName: extracted.consumerName ?? "",
    address: extracted.address ?? "",
    totalAmountPaid: extracted.totalAmountPaid ?? "",
    orArNumber: extracted.orArNumber ?? "",
    confidence: extracted.confidence ?? 0,
    warnings: extracted.warnings ?? [],
  }));
});

router.post("/memos", async (req, res): Promise<void> => {
  const parsed = CreateMemoBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const sequence = Number(parsed.data.serviceMemoCode.slice(-4));
  const dateReceived = parsed.data.dateReceived instanceof Date
    ? parsed.data.dateReceived.toISOString().slice(0, 10)
    : String(parsed.data.dateReceived);
  const [memo] = await db.insert(serviceMemosTable).values({
    ...parsed.data,
    dateReceived,
    dailySequence: sequence,
  }).returning();
  const synced = await syncMemo(memo);
  res.status(201).json(CreateMemoResponse.parse(publicMemo(synced)));
});

router.post("/memos/:id/retry", async (req, res): Promise<void> => {
  const parsed = RetryMemoSyncParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [memo] = await db.select().from(serviceMemosTable).where(eq(serviceMemosTable.id, parsed.data.id));
  if (!memo) { res.status(404).json({ error: "Memo not found" }); return; }
  const synced = await syncMemo(memo);
  res.json(RetryMemoSyncResponse.parse(publicMemo(synced)));
});

export default router;