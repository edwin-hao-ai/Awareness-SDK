from typing import Any, Dict, Optional


class MemoryCloudError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: Optional[int] = None,
        trace_id: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.trace_id = trace_id
        self.payload = payload or {}
