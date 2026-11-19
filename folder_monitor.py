# folder_monitor.py
import os
import time
import threading
from watchdog.observers import Observer
from watchdog.observers.polling import PollingObserver
from watchdog.events import PatternMatchingEventHandler
from . import scan_service  # single-flight / TTL scan cache
from .gallery_config import gallery_log


class GalleryEventHandler(PatternMatchingEventHandler):
    """Handles file system events, including symlinks, recursively."""

    def __init__(self, base_path, patterns=None, ignore_patterns=None,
                 ignore_directories=False, case_sensitive=True,
                 debounce_interval=0.5, extensions=None, deduplicate_symlinks=True):
        super().__init__(patterns=patterns, ignore_patterns=ignore_patterns,
                         ignore_directories=ignore_directories,
                         case_sensitive=case_sensitive)
        self.base_path = os.path.realpath(base_path)  # Use realpath for base_path
        self.debounce_timer = None
        self.debounce_interval = debounce_interval
        self.processed_events = {}
        self.extensions = extensions
        self.deduplicate_symlinks = deduplicate_symlinks
        self.last_known_folders = {}
        self._scan_lock = threading.Lock()
        self._pending_rescan = False
        self._stopped = threading.Event()

    def on_any_event(self, event):
        """Handles events, including symlinks, with debouncing and duplicate prevention."""
        if self._stopped.is_set() or event.is_directory:
            return

        # Ignore temporary files
        if event.src_path.endswith(('.swp', '.tmp', '~')):
            return

        real_path = os.path.realpath(event.src_path)

        # Check if this event (type + path) has been processed recently
        event_key = (event.event_type, real_path)
        current_time = time.time()

        last_processed_time = self.processed_events.get(event_key)
        if last_processed_time is not None and current_time - last_processed_time < self.debounce_interval:
            return

        # Mark this event as processed; occasionally prune the dictionary so a
        # long-running server does not accumulate one entry per file forever.
        self.processed_events[event_key] = current_time
        if len(self.processed_events) > 2048:
            cutoff = current_time - 60.0
            self.processed_events = {
                key: value for key, value in self.processed_events.items() if value >= cutoff
            }

        if event.event_type in ('created', 'deleted', 'modified', 'moved'):
            gallery_log(f"Watchdog detected {event.event_type}: {event.src_path} (Real path: {real_path}) - debouncing")
            self.debounce_event()

    def debounce_event(self):
        """Debounces the file system event."""
        if self._stopped.is_set():
            return
        if self.debounce_timer and self.debounce_timer.is_alive():
            self.debounce_timer.cancel()

        self.debounce_timer = threading.Timer(self.debounce_interval, self.rescan_and_send_changes)
        self.debounce_timer.daemon = True
        self.debounce_timer.start()

    def cancel(self):
        self._stopped.set()
        if self.debounce_timer and self.debounce_timer.is_alive():
            self.debounce_timer.cancel()
            self.debounce_timer = None

    def rescan_and_send_changes(self):
        """Rescan without metadata, diff against the last baseline, notify clients.

        Runs in the debounce timer thread.  If another scan is already running the
        rescan is coalesced into one follow-up instead of overlapping.
        """
        if self._stopped.is_set():
            return
        if not self._scan_lock.acquire(blocking=False):
            self._pending_rescan = True
            return

        try:
            # Files changed: the shared scan cache is stale, force a fresh scan.
            scan_service.invalidate(self.base_path)
            new_folders_data, _info = scan_service.get_scan(
                self.base_path,
                os.path.basename(self.base_path),
                self.extensions,
                self.deduplicate_symlinks,
                extract_metadata=False,
            )
            old_folders_data = self.last_known_folders
            changes = detect_folder_changes(old_folders_data, new_folders_data)

            if changes and changes.get("folders"):
                gallery_log("FileSystemMonitor: Changes detected after debounce, sending updates")
                try:
                    from .server import sanitize_json_data
                    from server import PromptServer

                    PromptServer.instance.send_sync("Gallery.file_change", sanitize_json_data(changes))
                except Exception as exc:  # pragma: no cover - depends on live ComfyUI
                    gallery_log(f"FileSystemMonitor: Unable to send file_change event: {exc}")
            else:
                gallery_log("FileSystemMonitor: Watchdog event(s) produced no relevant gallery changes.")

            self.last_known_folders = new_folders_data
        except Exception as e:
            gallery_log(f"FileSystemMonitor: Error during scan: {e}")
        finally:
            self._scan_lock.release()
            if self._pending_rescan and not self._stopped.is_set():
                self._pending_rescan = False
                self.debounce_event()


class FileSystemMonitor:
    """Monitors the output directory, including symlinks, recursively."""

    def __init__(self, base_path, interval=1.0, use_polling_observer=False,
                 extensions=None, deduplicate_symlinks=True):
        self.base_path = base_path
        self.interval = interval
        self.use_polling_observer = use_polling_observer
        self.extensions = extensions
        self.deduplicate_symlinks = deduplicate_symlinks

        # NOTE: these used to be swapped (polling flag produced a native Observer
        # and vice versa).  Native observer by default, polling when requested.
        if use_polling_observer:
            self.observer = PollingObserver(timeout=interval)
        else:
            self.observer = Observer(timeout=interval)

        # Generate patterns from extensions if provided
        if self.extensions:
            patterns = [f"*{ext}" if ext.startswith('.') else f"*.{ext}" for ext in self.extensions]
        else:
            patterns = ["*"]

        self.event_handler = GalleryEventHandler(
            base_path=base_path,
            patterns=patterns,
            debounce_interval=0.5,
            extensions=self.extensions,
            deduplicate_symlinks=self.deduplicate_symlinks,
        )

        # Never perform a blocking scan in __init__/start_monitoring(); the
        # initial baseline scan runs on the background monitor thread and is
        # shared with /Gallery/images through scan_service.
        self.thread = None
        self._stop_event = threading.Event()

    def start_monitoring(self):
        """Starts the Watchdog observer.  Returns immediately."""
        if self.thread is None or not self.thread.is_alive():
            self._stop_event.clear()
            self.thread = threading.Thread(target=self._start_observer_thread, daemon=True)
            self.thread.start()
            gallery_log("FileSystemMonitor: Watchdog monitoring thread started.")
        else:
            gallery_log("FileSystemMonitor: Watchdog monitoring thread already running.")

    def _initial_scan(self):
        """Populate the baseline from the shared scan cache (single-flight)."""
        try:
            gallery_log("FileSystemMonitor: Starting initial background scan...")
            started = time.perf_counter()
            initial_data, info = scan_service.get_scan(
                self.base_path,
                os.path.basename(self.base_path),
                self.extensions,
                self.deduplicate_symlinks,
                extract_metadata=False,
            )
            with self.event_handler._scan_lock:
                self.event_handler.last_known_folders = initial_data
            gallery_log(
                "FileSystemMonitor: Initial background scan complete "
                f"({info.get('files', 0)} files, {info.get('duration_ms', 0.0):.1f} ms, "
                f"cache={'hit' if info.get('cache_hit') else 'miss'}, "
                f"total={((time.perf_counter() - started) * 1000.0):.1f} ms)."
            )
        except Exception as e:
            gallery_log(f"FileSystemMonitor: Error during initial scan: {e}")

    def _start_observer_thread(self):
        try:
            self.observer.schedule(self.event_handler, self.base_path, recursive=True)
            self.observer.follow_directory_symlinks = True  # Ensure symlinks are followed
            self.observer.start()
        except Exception as e:
            gallery_log(f"FileSystemMonitor: Unable to start watchdog observer: {e}")
            return

        try:
            # Baseline after the observer is running so no change is missed.  The
            # scan is shared with a concurrent /Gallery/images request.
            if not self._stop_event.is_set():
                self._initial_scan()

            while not self._stop_event.wait(0.2):
                pass
        except KeyboardInterrupt:
            self.stop_monitoring()
        finally:
            # Handles stop() racing with the startup sequence: stop_monitoring()
            # may have run before the observer was started.
            try:
                if self.observer.is_alive():
                    self.observer.stop()
            except Exception:
                pass

    def stop_monitoring(self):
        """Stops the Watchdog observer."""
        self._stop_event.set()
        self.event_handler.cancel()
        stopped = False
        try:
            if self.observer.is_alive():
                self.observer.stop()
                self.observer.join(timeout=5.0)
                stopped = True
        except Exception as e:
            gallery_log(f"FileSystemMonitor: Error stopping watchdog observer: {e}")

        thread = self.thread
        if thread and thread.is_alive():
            thread.join(timeout=5.0)
        self.thread = None
        if stopped:
            gallery_log("FileSystemMonitor: Watchdog monitoring thread stopped.")
        else:
            gallery_log("FileSystemMonitor: Watchdog monitoring thread was not running.")


# --- Helper function to detect folder changes ---
def detect_folder_changes(old_folders, new_folders):
    """Detects changes between two folder data dictionaries."""
    changes = {"folders": {}}

    all_folders = set(old_folders.keys()) | set(new_folders.keys())
    for folder_name in all_folders:
        old_folder = old_folders.get(folder_name, {})
        new_folder = new_folders.get(folder_name, {})
        folder_changes = {}

        old_files = set(old_folder.keys())
        new_files = set(new_folder.keys())
        all_files = old_files | new_files

        for filename in all_files:
            old_file_data = old_folder.get(filename)
            new_file_data = new_folder.get(filename)

            if filename not in old_folder:  # New file
                folder_changes[filename] = {"action": "create", **new_file_data}
            elif filename not in new_folder:  # Removed file
                folder_changes[filename] = {"action": "remove"}
            elif old_file_data != new_file_data:  # Updated file (simplistic comparison)
                folder_changes[filename] = {"action": "update", **new_file_data}

        if folder_changes:
            changes["folders"][folder_name] = folder_changes

    return changes
