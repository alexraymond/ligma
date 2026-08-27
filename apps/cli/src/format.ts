/** Minimal fixed-width table printer — no dependency pulls its weight for this. */
export function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)));
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(line(headers));
  for (const row of rows) console.log(line(row));
}

export function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
