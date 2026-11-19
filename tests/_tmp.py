"""Workspace-local temporary directories for tests.

``tempfile.mkdtemp`` applies a restrictive chmod that makes the directory
unwritable inside the Windows sandbox, so tests create plain directories under
the repo instead and clean them up explicitly.
"""

from __future__ import annotations

import os
import shutil
import uuid

from _loader import TEST_TMP_ROOT


def make_temp(prefix: str = "tmp-") -> str:
    os.makedirs(TEST_TMP_ROOT, exist_ok=True)
    path = os.path.join(TEST_TMP_ROOT, f"{prefix}{uuid.uuid4().hex[:10]}")
    os.makedirs(path)
    return path


def remove_temp(path: str) -> None:
    shutil.rmtree(path, ignore_errors=True)


class TempDir:
    """Small ``TemporaryDirectory`` replacement with a ``.name``/``.cleanup()`` API."""

    def __init__(self, prefix: str = "tmp-") -> None:
        self.name = make_temp(prefix)

    def cleanup(self) -> None:
        remove_temp(self.name)

    def __enter__(self) -> "TempDir":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.cleanup()
