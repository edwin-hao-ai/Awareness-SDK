import os

from memory_cloud import MemoryCloudClient, read_export_package


def main():
    # 1) Create client.
    client = MemoryCloudClient(
        base_url=os.getenv("AWARENESS_API_BASE_URL", os.getenv("AWARENESS_BASE_URL", "http://localhost:8000/api/v1")),
        api_key="YOUR_API_KEY",
    )

    # 1) Export safetensors package with optional on-export KV generation.
    export_path = client.save_export_memory_package(
        memory_id="your-memory-id",
        payload={
            "package_type": "vector_with_kv_cache",
            "vector_binary_format": "safetensors",
            "include_kv_summary": True,
            "include_kv_binary": False,
            "generate_kv_on_export": True,
            "kv_latent_steps": 3,
            "regenerate_vectors_if_missing": True,
        },
        output_path="memory_export.zip",
    )
    print("saved:", export_path)

    # 2) Read export zip from SDK helper.
    parsed = read_export_package(export_path)
    manifest = parsed.get("manifest", {})
    print("package_type:", manifest.get("export", {}).get("package_type"))
    print("vector_format:", manifest.get("export", {}).get("vector_binary_format"))
    print("chunks:", len(parsed.get("chunks") or []))
    print("vectors_jsonl:", len(parsed.get("vectors_jsonl") or []))
    print("has_safetensors:", bool(parsed.get("safetensors")))
    print("kv_summary_keys:", list((parsed.get("kv_summary") or {}).keys()))


if __name__ == "__main__":
    main()
