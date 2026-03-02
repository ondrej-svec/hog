const isTTY = process.stdout.isTTY ?? false;

let forceFormat: "json" | "human" | null = null;

export function setFormat(format: "json" | "human"): void {
  forceFormat = format;
}

export function useJson(): boolean {
  if (forceFormat === "json") return true;
  if (forceFormat === "human") return false;
  return !isTTY;
}

export function jsonOut(data: unknown): void {
  console.log(JSON.stringify(data));
}

export function errorOut(message: string, data?: Record<string, unknown>): never {
  if (useJson()) {
    jsonOut({ ok: false, error: message, ...(data ? { data } : {}) });
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(1);
}

export function printSuccess(message: string, data?: Record<string, unknown> | object): void {
  if (useJson()) {
    jsonOut({ ok: true, message, ...data });
    return;
  }
  console.log(message);
}
