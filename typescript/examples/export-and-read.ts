import { MemoryCloudClient, readExportPackage } from "../src";
import { writeFile } from "node:fs/promises";

async function main() {
  // 1) Create client.
  const apiBaseUrl = process.env.AWARENESS_API_BASE_URL || "https://awareness.market/api/v1";
  const client = new MemoryCloudClient({
    baseUrl: apiBaseUrl,
    apiKey: "YOUR_API_KEY",
  });

  // 2) Export package.
  const exported = await client.exportMemoryPackage({
    memoryId: "your-memory-id",
    payload: {
      package_type: "vector_with_kv_cache",
      vector_binary_format: "safetensors",
      include_kv_summary: true,
      include_kv_binary: false,
      generate_kv_on_export: true,
      kv_latent_steps: 3,
      regenerate_vectors_if_missing: true,
    },
  });

  await writeFile(exported.filename, exported.bytes);
  console.log("saved:", exported.filename, exported.bytes.byteLength);

  // 3) Parse package directly from bytes.
  const parsed = await readExportPackage(exported.bytes);
  const manifestExport = (parsed.manifest.export ?? {}) as Record<string, unknown>;
  console.log("package_type:", manifestExport.package_type);
  console.log("vector_format:", manifestExport.vector_binary_format);
  console.log("chunks:", parsed.chunks.length);
  console.log("vectorsJsonl:", parsed.vectorsJsonl.length);
  console.log("hasSafetensors:", Boolean(parsed.safetensors));
  console.log("kvSummaryKeys:", Object.keys(parsed.kvSummary ?? {}));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
