/** CSV-escape a field AND neutralize spreadsheet formula injection. */
export function csvField(value: string): string {
  // Prefix a leading formula trigger with a single quote so Excel/Sheets treat it as text.
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}
