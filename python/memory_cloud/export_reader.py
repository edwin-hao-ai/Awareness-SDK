import io
import json
import zipfile
from typing import Any, Dict, List, Optional, Union


def parse_jsonl_bytes(data: bytes) -> List[Dict[str, Any]]:
    if not data:
        return []
    rows: List[Dict[str, Any]] = []
    text = data.decode("utf-8", errors="replace")
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
        except Exception:
            continue
        if isinstance(parsed, dict):
            rows.append(parsed)
    return rows


def read_export_package_bytes(
    archive_bytes: bytes,
    include_binary: bool = False,
) -> Dict[str, Any]:
    return _read_export_package(archive_bytes=archive_bytes, include_binary=include_binary)


def read_export_package(
    archive_path: str,
    include_binary: bool = False,
) -> Dict[str, Any]:
    with open(archive_path, "rb") as fp:
        return _read_export_package(archive_bytes=fp.read(), include_binary=include_binary)


def _read_export_package(
    archive_bytes: bytes,
    include_binary: bool,
) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "manifest": {},
        "files": [],
        "vectors_jsonl": [],
        "vector_index": [],
        "chunks": [],
        "kv_summary": None,
        "safetensors": None,
    }
    if include_binary:
        result["binary_files"] = {}

    with zipfile.ZipFile(io.BytesIO(archive_bytes), mode="r") as zf:
        names = sorted(zf.namelist())
        result["files"] = names

        manifest = _read_json(zf, "manifest.json")
        if isinstance(manifest, dict):
            result["manifest"] = manifest

        result["vectors_jsonl"] = parse_jsonl_bytes(_read_bytes(zf, "vectors/vectors.jsonl") or b"")

        vector_index = _read_json(zf, "vectors/index.json")
        if isinstance(vector_index, list):
            result["vector_index"] = [item for item in vector_index if isinstance(item, dict)]

        result["chunks"] = parse_jsonl_bytes(_read_bytes(zf, "chunks/raw_chunks.jsonl") or b"")

        kv_summary = _read_json(zf, "kv_cache/summary.json")
        if isinstance(kv_summary, dict):
            result["kv_summary"] = kv_summary

        safetensor_bytes = _read_bytes(zf, "vectors/embeddings.safetensors")
        if safetensor_bytes is not None:
            safetensor_item: Dict[str, Any] = {
                "path": "vectors/embeddings.safetensors",
                "size": len(safetensor_bytes),
            }
            if include_binary:
                safetensor_item["bytes"] = safetensor_bytes
            result["safetensors"] = safetensor_item

        if include_binary:
            binaries: Dict[str, bytes] = {}
            for name in names:
                lower = name.lower()
                if lower.endswith(".pt") or lower.endswith(".safetensors"):
                    payload = _read_bytes(zf, name)
                    if payload is not None:
                        binaries[name] = payload
            result["binary_files"] = binaries

    return result


def _read_bytes(zf: zipfile.ZipFile, name: str) -> Optional[bytes]:
    try:
        return zf.read(name)
    except KeyError:
        return None


def _read_json(zf: zipfile.ZipFile, name: str) -> Optional[Union[Dict[str, Any], List[Any]]]:
    payload = _read_bytes(zf, name)
    if payload is None:
        return None
    try:
        parsed = json.loads(payload.decode("utf-8", errors="replace"))
    except Exception:
        return None
    if isinstance(parsed, (dict, list)):
        return parsed
    return None
