# Fork changes — ComfyUI Gallery (multi-select, dark theme, fast lazy previews)

This repository is a fork of
[PanicTitan/ComfyUI-Gallery](https://github.com/PanicTitan/ComfyUI-Gallery) 2.7.1.
Upstream is tracked as the `upstream` git remote; the initial commit in this fork
is the unmodified 2.7.1 import.

## New features

### Layout: preview size and sidebar width

- **Preview size slider** in the bottom-left corner of the gallery changes card
  size from 160 to 600 px while dragging (`thumbSize` setting, persisted).
- **Resizable sidebar**: drag the vertical divider on the right edge of the
  folder tree to resize it (`sidebarWidth` setting, persisted). Double-click the
  divider to reset it to 320 px.

### External file actions

- Each card has hover buttons to **show the asset in the host file manager**
  (Explorer `/select`, Finder `open -R`, `xdg-open` on Linux) and to **open it in
  the default associated application** (`os.startfile` / `open` / `xdg-open`).
- Both actions run on the machine hosting ComfyUI, not in the browser.
- Paths are validated with the same realpath containment as delete/thumbnail.

### Selection and batch operations

- **Ctrl/Cmd+click** toggles one asset; **Shift+click** selects the range between
  the anchor and the clicked asset (dividers are skipped).
- **Box-drag select** on the empty grid background: drag a marquee over cards.
  Hold Ctrl/Cmd while dragging to add to the existing selection. The marquee
  auto-scrolls the virtualized grid near the edges.
- **Ctrl/Cmd+A** selects all visible/filtered assets, **Esc** clears the
  selection, **Delete/Backspace** deletes the selected assets.
- **Floating selection toolbar** shows the count, Select all, ZIP download, batch
  delete and Clear.
- **Batch delete** is one `POST /Gallery/delete` request (`image_paths`) instead
  of N sequential requests; per-file failures are reported and successful
  deletions are removed from the grid optimistically. The confirmation dialog is
  rendered above the gallery modal.
- **Per-card trash button** appears in the top-right corner on hover/focus and
  deletes that one asset after a compact confirmation.

### Dark theme

- The whole gallery now follows `darkMode`: modal, header, sidebar/tree, grid,
  cards, selection toolbar, settings, performance panel, metadata view, raw JSON
  viewer and scrollbars.
- The header reserves space for the modal close button, so the sort control
  does not run underneath the X.
- Toggling Dark Mode in Settings now previews the theme immediately, before
  saving. Cancel/close reverts to the saved theme; Save persists it.
- Ant Design tokens and CSS variables are used instead of hard-coded colours;
  light mode remains the default and is unchanged visually.

### Performance and diagnostics

- `/Gallery/images` no longer opens every image. It performs a directory walk +
  `stat` only, runs off the aiohttp event loop (`asyncio.to_thread`), and is
  backed by a single-flight + TTL scan cache. Concurrent startup requests
  (`/Gallery/images` and the monitor's initial scan) share one real scan.
- **Lazy metadata**: `GET /Gallery/metadata?path=...` extracts one asset's
  metadata on demand and caches it by `realpath + mtime + size`. Opening the
  info view no longer requires metadata for the whole folder.
- **Server-side thumbnails**: `GET /Gallery/thumbnail?path=...&w=400` returns
  cached WebP previews (Pillow, EXIF orientation baked in, atomic disk cache).
  The grid never downloads full-resolution originals; the original is loaded
  only when the preview opens.
- **Paged preview loading** on the client: a queue with 6 concurrent requests,
  object-URL cache, fallback to the original on error, and virtualized mounting
  from `react-window`.
- **Video hover previews**: hovering a video card plays it looped. Hold
  **Shift** while hovering to hear the audio; releasing Shift mutes it again.
  Leaving the card pauses the preview.
- **Performance report** (bug icon in the header, or Settings → Performance):
  client timeline (bootstrap, settings, listing, first paint, thumbnail paging),
  server timings from `/Gallery/perf`, scan cache hit/miss and thumbnail stats.
  Enable verbose `[GalleryPerf]` logs with Settings → Debug Performance
  (`debugPerf`), or force with `?galleryPerf=1`.
- Fixed the watchdog observer inversion (`usePollingObserver` now actually uses
  `PollingObserver`), removed blocking joins from the scan path, and closed
  Pillow file handles that used to leak on every scan.
- Date-divider rows are now 56 px instead of a full card row, so the grid shows
  many more assets per screen.

## API additions

| Endpoint | Purpose |
| --- | --- |
| `GET /Gallery/images` | Lightweight listing (metadata is `{}`); headers `X-Gallery-Scan-Ms`, `X-Gallery-Scan-Cache`, `X-Gallery-File-Count`, `X-Gallery-Metadata-Ms` |
| `GET /Gallery/metadata?path=...` | `{metadata, cached}` for one asset |
| `GET /Gallery/thumbnail?path=...&w=...` | Cached WebP thumbnail (`X-Gallery-Thumb-Cache`) |
| `POST /Gallery/delete` | `{image_path}` (legacy) or `{image_paths: [...]}`; returns `{deleted, failed, count}` |
| `POST /Gallery/reveal` | `{image_path}`; selects the asset in the host file manager |
| `POST /Gallery/open` | `{image_path}`; opens the asset with the default application |
| `GET /Gallery/perf` | Recent server phase timings + aggregate scan/thumbnail stats |
| `DELETE /Gallery/perf` | Reset those records |

All paths still use the `/static_gallery/...` form and are validated against the
real static root (realpath containment, no `..`, no absolute escapes).

## Settings

- `thumbSize` (default `350`) — asset card width in pixels (160–600), changed by
  the bottom slider.
- `sidebarWidth` (default `320`) — folder tree width in pixels, changed by
  dragging its divider.
- `debugPerf` (default `false`) — verbose client/server performance logging.
- `autoPlayVideos` now means “play videos on hover” (the grid never autoplays
  every visible video at once).
- Everything else is backward compatible with upstream `user_settings.json`.

## Build

```powershell
cd web
npm install
npm run build
```

The build writes `web/dist/assets/comfy-ui-gallery.js`, which is tracked because
ComfyUI loads `WEB_DIRECTORY = ./web/dist/assets` directly.

## Tests

Backend (stdlib `unittest`, uses the ComfyUI Python environment for Pillow/aiohttp):

```powershell
& 'Q:\Ai\Comfy\stacks\comfyui-0.45\env\Scripts\python.exe' -m unittest discover -s tests -v
```

Benchmark (generates temporary files, reports cold/warm scans):

```powershell
& 'Q:\Ai\Comfy\stacks\comfyui-0.45\env\Scripts\python.exe' tests\benchmark_scan.py 1000
```

The frontend is type-checked by `npm run build` (`tsc -b && vite build`).

## Known limitations

- Thumbnails are generated for raster images (`.png`, `.jpg`, `.jpeg`, `.webp`,
  `.gif`); video/audio/3D assets keep using their native preview path.
- Batch delete is permanent (no trash/undo).
- Thumbnail cache files are evicted by key changes and delete/move invalidation,
  but old files from previous processes are not garbage-collected by age yet.
