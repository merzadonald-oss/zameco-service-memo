import { format, isValid, parse, parseISO } from "date-fns";

/** Date inputs only display YYYY-MM-DD, not ISO timestamps or OCR prose. */
export function dateForInput(value: string): string {
  const text = value.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(text);
  if (iso) {
    const parsed = parseISO(iso[1]);
    return isValid(parsed) && format(parsed, "yyyy-MM-dd") === iso[1] ? iso[1] : "";
  }

  for (const pattern of ["MMMM d, yyyy", "MMM d, yyyy", "MMMM d yyyy", "MMM d yyyy", "M/d/yyyy", "MM/dd/yyyy", "d MMMM yyyy", "d MMM yyyy"]) {
    const parsed = parse(text, pattern, new Date(2000, 0, 1));
    if (isValid(parsed)) return format(parsed, "yyyy-MM-dd");
  }
  return "";
}