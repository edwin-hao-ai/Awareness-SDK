import JSZip from "jszip";
import { JsonObject, ParsedExportPackage, ParsedSafetensors } from "./types";

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonlText(text: string): JsonObject[] {
  const rows: JsonObject[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (isRecord(parsed)) {
        rows.push(parsed);
      }
    } catch {
      // Ignore malformed line.
    }
  }
  return rows;
}

async function readTextFile(archive: JSZip, path: string): Promise<string | null> {
  const file = archive.file(path);
  if (!file) return null;
  return file.async("text");
}

async function readBytesFile(archive: JSZip, path: string): Promise<Uint8Array | null> {
  const file = archive.file(path);
  if (!file) return null;
  return new Uint8Array(await file.async("uint8array"));
}

export async function readExportPackage(
  input: ArrayBuffer | Uint8Array | Blob,
  options?: { includeBinary?: boolean }
): Promise<ParsedExportPackage> {
  const includeBinary = options?.includeBinary ?? false;
  const archive = await JSZip.loadAsync(
    input as unknown as Parameters<typeof JSZip.loadAsync>[0]
  );

  const files = Object.keys(archive.files)
    .filter((path) => !archive.files[path].dir)
    .sort();

  const manifestText = await readTextFile(archive, "manifest.json");
  let manifest: JsonObject = {};
  if (manifestText) {
    try {
      const parsed = JSON.parse(manifestText);
      if (isRecord(parsed)) {
        manifest = parsed;
      }
    } catch {
      // Keep empty manifest.
    }
  }

  const vectorsText = await readTextFile(archive, "vectors/vectors.jsonl");
  const vectorsJsonl = vectorsText ? parseJsonlText(vectorsText) : [];

  const vectorIndexText = await readTextFile(archive, "vectors/index.json");
  let vectorIndex: JsonObject[] = [];
  if (vectorIndexText) {
    try {
      const parsed = JSON.parse(vectorIndexText);
      if (Array.isArray(parsed)) {
        vectorIndex = parsed.filter((item): item is JsonObject => isRecord(item));
      }
    } catch {
      // Ignore parse error.
    }
  }

  const chunksText = await readTextFile(archive, "chunks/raw_chunks.jsonl");
  const chunks = chunksText ? parseJsonlText(chunksText) : [];

  const kvSummaryText = await readTextFile(archive, "kv_cache/summary.json");
  let kvSummary: JsonObject | null = null;
  if (kvSummaryText) {
    try {
      const parsed = JSON.parse(kvSummaryText);
      if (isRecord(parsed)) {
        kvSummary = parsed;
      }
    } catch {
      // Ignore parse error.
    }
  }

  const safetensorBytes = await readBytesFile(archive, "vectors/embeddings.safetensors");
  let safetensors: ParsedSafetensors | null = null;
  if (safetensorBytes) {
    safetensors = {
      path: "vectors/embeddings.safetensors",
      size: safetensorBytes.byteLength,
    };
    if (includeBinary) {
      safetensors.bytes = safetensorBytes;
    }
  }

  const result: ParsedExportPackage = {
    manifest,
    files,
    vectorsJsonl,
    vectorIndex,
    chunks,
    kvSummary,
    safetensors,
  };

  if (includeBinary) {
    const binaryFiles: Record<string, Uint8Array> = {};
    for (const path of files) {
      if (path.endsWith(".pt") || path.endsWith(".safetensors")) {
        const payload = await readBytesFile(archive, path);
        if (payload) {
          binaryFiles[path] = payload;
        }
      }
    }
    result.binaryFiles = binaryFiles;
  }

  return result;
}

export { parseJsonlText };
