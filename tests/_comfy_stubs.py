"""Minimal stub ``server`` / ``folder_paths`` modules for handler tests.

``server.py`` needs ComfyUI's ``PromptServer`` singleton and ``folder_paths`` at
import time.  The stubs mimic just enough of the API used by the extension:
route decorators, a named static route whose directory can be swapped, an app
router and ``send_sync``.
"""

from __future__ import annotations

import os
import pathlib
import sys
import tempfile
import types

from aiohttp import web


def _temp_root():
    from _tmp import make_temp

    return make_temp("comfy-stub-")


class _FakeResource:
    def __init__(self, directory):
        self._directory = pathlib.Path(directory)


class _NamedRoute:
    def __init__(self, name, directory):
        self.name = name
        self.resource = _FakeResource(directory)


class _FakeRouter:
    def __init__(self):
        self._routes = []

    def routes(self):
        return list(self._routes)


class _FakeRoutes:
    """Stands in for ``PromptServer.instance.routes``."""

    def __init__(self):
        self._registered = {}

    def _decorator(self, method):
        def register(path):
            def wrapper(handler):
                self._registered[(method, path)] = handler
                return handler

            return wrapper

        return register

    def get(self, path):
        return self._decorator("GET")(path)

    def post(self, path):
        return self._decorator("POST")(path)

    def patch(self, path):
        return self._decorator("PATCH")(path)

    def delete(self, path):
        return self._decorator("DELETE")(path)

    def static(self, prefix, directory, follow_symlinks=True, name=None):
        route = _NamedRoute(name, directory)
        _PROMPT_SERVER.app.router._routes.append(route)
        return route


class _FakeApp:
    def __init__(self):
        self.router = _FakeRouter()


class _FakePromptServer:
    def __init__(self):
        self.app = _FakeApp()
        self.routes = _FakeRoutes()
        self.scan_lock = None
        self.sent_events = []

    def send_sync(self, event, data=None):
        self.sent_events.append((event, data))


_PROMPT_SERVER = _FakePromptServer()


def set_static_dir(directory):
    for route in _PROMPT_SERVER.app.router.routes():
        if route.name == "static_gallery_placeholder":
            route.resource._directory = pathlib.Path(directory)
            return True
    return False


def get_static_dir():
    for route in _PROMPT_SERVER.app.router.routes():
        if route.name == "static_gallery_placeholder":
            return str(route.resource._directory)
    return None


_FOLDER_STATE = {
    "output": _temp_root(),
    "user": _temp_root(),
}


def set_output_directory(directory):
    _FOLDER_STATE["output"] = str(directory)


def set_user_directory(directory):
    _FOLDER_STATE["user"] = str(directory)


def get_output_directory():
    return _FOLDER_STATE["output"]


def get_user_directory():
    return _FOLDER_STATE["user"]


def make_aiohttp_app(server_module):
    """Register the extension handlers on a real aiohttp app for TestServer."""
    app = web.Application()
    app.router.add_get("/Gallery/settings", server_module.get_settings)
    app.router.add_post("/Gallery/settings", server_module.save_settings)
    app.router.add_get("/Gallery/images", server_module.get_gallery_images)
    app.router.add_get("/Gallery/metadata", server_module.get_asset_metadata)
    app.router.add_get("/Gallery/thumbnail", server_module.get_asset_thumbnail)
    app.router.add_post("/Gallery/monitor/start", server_module.start_gallery_monitor)
    app.router.add_post("/Gallery/monitor/stop", server_module.stop_gallery_monitor)
    app.router.add_post("/Gallery/delete", server_module.delete_image)
    app.router.add_post("/Gallery/move", server_module.move_image)
    app.router.add_get("/Gallery/perf", server_module.get_gallery_perf)
    app.router.add_delete("/Gallery/perf", server_module.reset_gallery_perf)
    return app


_installed = False


def install():
    """Install the stubs into ``sys.modules`` (idempotent)."""
    global _installed
    if _installed:
        return _PROMPT_SERVER

    server_stub = types.ModuleType("server")
    server_stub.PromptServer = types.SimpleNamespace(instance=_PROMPT_SERVER)
    sys.modules["server"] = server_stub

    folder_paths_stub = types.ModuleType("folder_paths")
    folder_paths_stub.get_output_directory = get_output_directory
    folder_paths_stub.get_temp_directory = lambda: tempfile.gettempdir()
    folder_paths_stub.get_input_directory = lambda: tempfile.gettempdir()
    folder_paths_stub.get_user_directory = get_user_directory
    folder_paths_stub.set_output_directory = set_output_directory
    folder_paths_stub.set_user_directory = set_user_directory
    sys.modules["folder_paths"] = folder_paths_stub

    _installed = True
    return _PROMPT_SERVER
