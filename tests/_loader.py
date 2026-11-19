"""Load the hyphenated repo folder as a Python package for tests.

The checkout directory is named ``ComfyUI-Gallery`` so it cannot be imported by
name.  We create a synthetic package module pointing at the repo root and import
submodules through it.  ``__init__.py`` is intentionally *not* executed: it
imports the whole ComfyUI extension (and ComfyUI itself), which unit tests do not
need.
"""

from __future__ import annotations

import importlib
import os
import shutil
import sys
import tempfile
import types

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKAGE_NAME = "gallery_under_test"

# The sandbox permits writes only inside the workspace; point tempfile at a
# workspace-local directory so TemporaryDirectory works in tests.
TEST_TMP_ROOT = os.path.join(REPO_ROOT, ".test-tmp")
os.makedirs(TEST_TMP_ROOT, exist_ok=True)
tempfile.tempdir = TEST_TMP_ROOT


def _cleanup_test_tmp():
    shutil.rmtree(TEST_TMP_ROOT, ignore_errors=True)


import atexit  # noqa: E402

atexit.register(_cleanup_test_tmp)

_package = None


def load_package():
    global _package
    if _package is not None:
        return _package
    existing = sys.modules.get(PACKAGE_NAME)
    if existing is not None and getattr(existing, "__path__", None):
        _package = existing
        return existing

    package = types.ModuleType(PACKAGE_NAME)
    package.__path__ = [REPO_ROOT]
    package.__package__ = PACKAGE_NAME
    package.__file__ = os.path.join(REPO_ROOT, "__init__.py")
    sys.modules[PACKAGE_NAME] = package
    _package = package
    return package


def load_module(name: str):
    """Import ``<repo>/<name>.py`` as a submodule of the synthetic package."""
    load_package()
    return importlib.import_module(f"{PACKAGE_NAME}.{name}")
