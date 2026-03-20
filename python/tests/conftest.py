"""Shared pytest configuration for Python SDK tests."""
from __future__ import annotations

import socket

import pytest


def _is_port_open(host: str, port: int, timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (OSError, ConnectionRefusedError):
        return False


_SERVICE_CHECKS = {
    "requires_live_api": (
        lambda: _is_port_open("localhost", 8000),
        "Live API is not running on :8000",
    ),
}


def pytest_configure(config):
    for marker_name, (_, desc) in _SERVICE_CHECKS.items():
        config.addinivalue_line("markers", f"{marker_name}: skip when {desc}")


def pytest_collection_modifyitems(config, items):
    for item in items:
        for marker_name, (check_fn, reason) in _SERVICE_CHECKS.items():
            if marker_name in item.keywords and not check_fn():
                item.add_marker(pytest.mark.skip(reason=reason))
