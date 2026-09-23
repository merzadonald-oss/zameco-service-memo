import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const appSettingsTable = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  driveFolderId: text("drive_folder_id").notNull().default(""),
  spreadsheetId: text("spreadsheet_id").notNull().default(""),
  sheetName: text("sheet_name").notNull().default("Service Memos"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});