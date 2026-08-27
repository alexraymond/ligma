import { DATA_DIR } from "../../paths";
import { NextRequest, NextResponse } from "../../http";
import { readFile } from "fs/promises";
import path from "path";

const LOG_PATH = path.join(DATA_DIR, "daemon.log");
const DEFAULT_LINES = 200;
const MAX_LINES = 500;

export async function GET(request: NextRequest) {
  const linesParam = request.nextUrl.searchParams.get("lines");
  const requestedLines = Math.min(
    Math.max(1, Number(linesParam) || DEFAULT_LINES),
    MAX_LINES
  );

  try {
    const content = await readFile(LOG_PATH, "utf-8");
    const allLines = content.split("\n").filter((l) => l.length > 0);
    const total = allLines.length;
    const lines = allLines.slice(-requestedLines);
    return NextResponse.json({ lines, total });
  } catch {
    // Log file doesn't exist yet — not an error
    return NextResponse.json({ lines: [], total: 0 });
  }
}
