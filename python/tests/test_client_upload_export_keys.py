"""Unit tests for upload, export, API key management, and wizard operations.

All tests use mock HTTP responses — no live server required.
"""

import json
from unittest.mock import MagicMock, mock_open, patch

import pytest

from memory_cloud.client import MemoryCloudClient


def _make_client(**kwargs):
    defaults = dict(base_url="http://localhost:8000/api/v1", api_key="test-key")
    defaults.update(kwargs)
    return MemoryCloudClient(**defaults)


def _mock_response(json_data, status_code=200, headers=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.headers = headers or {"X-Trace-Id": "trace-test"}
    resp.json.return_value = json_data
    resp.text = json.dumps(json_data)
    resp.raise_for_status = MagicMock()
    return resp


# ------------------------------------------------------------------
# Upload File
# ------------------------------------------------------------------


class TestUploadFile:
    def test_upload_file_sends_post_multipart(self, tmp_path):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"upload_job_id": "uj-1", "status": "processing"})
        )

        # Create a temporary file to upload
        test_file = tmp_path / "notes.txt"
        test_file.write_text("hello world")

        result = client.upload_file("mem-1", str(test_file))

        call_kwargs = client.session.request.call_args[1]
        assert call_kwargs["method"] == "POST"
        assert "/memories/mem-1/upload_file" in call_kwargs["url"]
        # multipart upload uses 'files' kwarg, not 'json'
        assert "files" in call_kwargs
        file_tuple = call_kwargs["files"]["file"]
        assert file_tuple[0] == "notes.txt"
        assert result["upload_job_id"] == "uj-1"

    def test_upload_file_with_custom_filename(self, tmp_path):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"upload_job_id": "uj-2"})
        )

        test_file = tmp_path / "data.bin"
        test_file.write_bytes(b"\x00\x01\x02")

        client.upload_file("mem-1", str(test_file), filename="custom_report.pdf")

        call_kwargs = client.session.request.call_args[1]
        file_tuple = call_kwargs["files"]["file"]
        assert file_tuple[0] == "custom_report.pdf"


# ------------------------------------------------------------------
# Get Upload Job Status
# ------------------------------------------------------------------


class TestGetUploadJobStatus:
    def test_get_upload_job_status_sends_get(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"status": "completed", "chunks": 12})
        )

        result = client.get_upload_job_status("mem-1", "uj-42")

        call_kwargs = client.session.request.call_args[1]
        assert call_kwargs["method"] == "GET"
        assert "/memories/mem-1/upload_jobs/uj-42" in call_kwargs["url"]
        assert result["status"] == "completed"


# ------------------------------------------------------------------
# Get Async Job Status
# ------------------------------------------------------------------


class TestGetAsyncJobStatus:
    def test_get_async_job_status_sends_get(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"job_id": "job-99", "status": "running"})
        )

        result = client.get_async_job_status("job-99")

        call_kwargs = client.session.request.call_args[1]
        assert call_kwargs["method"] == "GET"
        assert "/jobs/job-99" in call_kwargs["url"]
        assert result["status"] == "running"


# ------------------------------------------------------------------
# Export Memory Package
# ------------------------------------------------------------------


class TestExportMemoryPackage:
    def test_export_memory_package_sends_post(self):
        client = _make_client()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {
            "X-Trace-Id": "trace-export",
            "Content-Type": "application/zip",
            "Content-Disposition": 'attachment; filename="mem_export.zip"',
        }
        mock_resp.content = b"PK\x03\x04fake-zip-bytes"

        client.session = MagicMock()
        client.session.request = MagicMock(return_value=mock_resp)

        result = client.export_memory_package("mem-1", {"package_type": "full"})

        call_kwargs = client.session.request.call_args[1]
        assert call_kwargs["method"] == "POST"
        assert "/memories/mem-1/export" in call_kwargs["url"]
        assert result["filename"] == "mem_export.zip"
        assert result["content_type"] == "application/zip"

    def test_export_returns_response(self):
        client = _make_client()
        zip_content = b"PK\x03\x04test-data"
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {
            "X-Trace-Id": "trace-export-2",
            "Content-Type": "application/zip",
        }
        mock_resp.content = zip_content

        client.session = MagicMock()
        client.session.request = MagicMock(return_value=mock_resp)

        result = client.export_memory_package("mem-1", {"package_type": "snapshot"})

        assert result["bytes"] == zip_content
        assert "filename" in result
        assert result["trace_id"] == "trace-export-2"


# ------------------------------------------------------------------
# Save Export Memory Package
# ------------------------------------------------------------------


class TestSaveExportMemoryPackage:
    def test_save_export_sends_post(self):
        client = _make_client()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {
            "X-Trace-Id": "trace-save",
            "Content-Type": "application/zip",
            "Content-Disposition": 'attachment; filename="export.zip"',
        }
        mock_resp.content = b"PK\x03\x04data"

        client.session = MagicMock()
        client.session.request = MagicMock(return_value=mock_resp)

        with patch("builtins.open", mock_open()) as mocked_file:
            target = client.save_export_memory_package(
                "mem-1", {"package_type": "full"}, output_path="/tmp/out.zip"
            )

        call_kwargs = client.session.request.call_args[1]
        assert call_kwargs["method"] == "POST"
        assert "/memories/mem-1/export" in call_kwargs["url"]
        assert target == "/tmp/out.zip"

    def test_save_export_writes_file(self):
        client = _make_client()
        zip_bytes = b"PK\x03\x04saved-content"
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {
            "X-Trace-Id": "trace-write",
            "Content-Type": "application/zip",
            "Content-Disposition": 'attachment; filename="saved.zip"',
        }
        mock_resp.content = zip_bytes

        client.session = MagicMock()
        client.session.request = MagicMock(return_value=mock_resp)

        m = mock_open()
        with patch("builtins.open", m):
            target = client.save_export_memory_package(
                "mem-1", {"package_type": "full"}, output_path="/tmp/my_export.zip"
            )

        assert target == "/tmp/my_export.zip"
        m.assert_called_once_with("/tmp/my_export.zip", "wb")
        m().write.assert_called_once_with(zip_bytes)


# ------------------------------------------------------------------
# Create API Key
# ------------------------------------------------------------------


class TestCreateApiKey:
    def test_create_api_key_sends_post(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"id": "key-1", "key": "aw_live_xxx"})
        )

        result = client.create_api_key("owner-1", name="My Key")

        call_kwargs = client.session.request.call_args[1]
        assert call_kwargs["method"] == "POST"
        assert "/apikeys" in call_kwargs["url"]
        body = call_kwargs.get("json", {})
        assert body["owner_id"] == "owner-1"
        assert body["name"] == "My Key"
        assert result["id"] == "key-1"


# ------------------------------------------------------------------
# List API Keys
# ------------------------------------------------------------------


class TestListApiKeys:
    def test_list_api_keys_sends_get(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response([{"id": "key-1"}, {"id": "key-2"}])
        )

        result = client.list_api_keys("owner-1")

        call_kwargs = client.session.request.call_args[1]
        assert call_kwargs["method"] == "GET"
        assert "/apikeys" in call_kwargs["url"]
        assert call_kwargs["params"]["owner_id"] == "owner-1"
        assert len(result) == 2


# ------------------------------------------------------------------
# Revoke API Key
# ------------------------------------------------------------------


class TestRevokeApiKey:
    def test_revoke_api_key_sends_delete(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"revoked": True})
        )

        result = client.revoke_api_key("owner-1", "key-42")

        call_kwargs = client.session.request.call_args[1]
        assert call_kwargs["method"] == "DELETE"
        assert "/apikeys/key-42" in call_kwargs["url"]
        assert call_kwargs["params"]["owner_id"] == "owner-1"
        assert result["revoked"] is True


# ------------------------------------------------------------------
# Memory Wizard
# ------------------------------------------------------------------


class TestMemoryWizard:
    def test_memory_wizard_sends_post(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"reply": "Here is your memory config", "draft": {"name": "My Memory"}})
        )

        messages = [{"role": "user", "content": "Create a coding memory"}]
        result = client.memory_wizard("owner-1", messages, locale="en")

        call_kwargs = client.session.request.call_args[1]
        assert call_kwargs["method"] == "POST"
        assert "/wizard/memory_designer" in call_kwargs["url"]
        body = call_kwargs.get("json", {})
        assert body["owner_id"] == "owner-1"
        assert body["messages"] == messages
        assert body["locale"] == "en"
        assert result["reply"] == "Here is your memory config"
