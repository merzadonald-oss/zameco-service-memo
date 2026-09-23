import { date, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const serviceMemosTable = pgTable("service_memos", {
  id: serial("id").primaryKey(),
  serviceMemoCode: text("service_memo_code").notNull().unique(),
  dateReceived: date("date_received", { mode: "string" }).notNull(),
  dateOfServiceMemo: text("date_of_service_memo").notNull().default(""),
  natureOfComplaint: text("nature_of_complaint").notNull().default(""),
  accountNumber: text("account_number").notNull().default(""),
  consumerName: text("consumer_name").notNull().default(""),
  address: text("address").notNull().default(""),
  totalAmountPaid: text("total_amount_paid").notNull().default(""),
  orArNumber: text("or_ar_number").notNull().default(""),
  imageData: text("image_data").notNull(),
  imageMimeType: text("image_mime_type").notNull(),
  driveStatus: text("drive_status").notNull().default("pending"),
  sheetStatus: text("sheet_status").notNull().default("pending"),
  driveImageLink: text("drive_image_link"),
  syncError: text("sync_error"),
  dailySequence: integer("daily_sequence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertServiceMemoSchema = createInsertSchema(serviceMemosTable).omit({ id: true, createdAt: true });
export type InsertServiceMemo = z.infer<typeof insertServiceMemoSchema>;
export type ServiceMemoRecord = typeof serviceMemosTable.$inferSelect;