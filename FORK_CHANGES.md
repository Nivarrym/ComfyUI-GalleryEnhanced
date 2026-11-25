# Fork changes — ComfyUI Gallery (multi-select, dark theme, fast lazy previews)

This repository is a fork of
[PanicTitan/ComfyUI-Gallery](https://github.com/PanicTitan/ComfyUI-Gallery) 2.7.1.
Upstream is tracked as the `upstream` git remote; the initial commit in this fork
is the unmodified 2.7.1 import.

## New features

### Layout: preview size, sidebar and pagination

- **Preview size slider** in the top bar, immediately left of the sort control,
  changes card size from 160 to 600 px while dragging (`thumbSize` setting,
  persisted). The drag only updates CSS variables; the CSS grid reflows natively
  and no React card is re-rendered.
- **Pagination** next to the slider: `Endless scroll`, `20`, `40`, `60`, `100`,
  `200`. In fixed modes the arrow buttons move between pages; in endless mode
  they are disabled.
- **Endless scroll** mounts cards in batches and requests thumbnails only for
  cards within the viewport plus roughly two rows above/below.
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

## Fork identity

- Repository/package name: **ComfyUI-Gallery-Fork**.
- Maintainer/author metadata: **KagePC** (`pyproject.toml`, `AUTHORS.md`).
- Upstream attribution: PanicTitan/ComfyUI-Gallery remains credited in
  `README.md`, `AUTHORS.md` and the upstream repository URL.

### Trash, favorites, folder editing and replace

- Preview backdrop clicks close only the preview.
- Tags are persisted in `localStorage` under `comfy-ui-gallery-asset-tags`.
  Space toggles trash and advances to the next image (optionally skipping
  marked images); F toggles favorite. Trashed cards are muted and show a bin;
  favorites show a star.
- The header filter switches between No filter, Favorites and Trash.
- The sidebar supports creating folders/subfolders, renaming and deleting empty
  folders through a custom context menu; empty folders remain in the tree.
- Card Replace updates the selected gallery loader node's widget in place.
- The header trash button opens a quick-delete confirmation with optional
  From/To date-time bounds; only trash-marked assets inside the range are
  deleted.

### Asset comparison and mask editor

- Compare is enabled only when exactly two visual assets (image or video) are
  selected. The viewer defaults to a 50/50 wipe overlay.
- Top controls: horizontal/vertical wipe direction, Overlay switch
  (overlay vs side-by-side), Fade switch (compact drag bar), Swap A/B, fit mode,
  anchor and percentage readout.
- Videos autoplay muted and loop in both overlay and side-by-side modes.
- The overlay switch is labelled **Overlay** with a tooltip; **Swap A/B**
  exchanges reference and target without extra fit options.
- Fade is adjusted by dragging anywhere over the image. A fixed 360 px movement
  covers the full range, with no jump based on the click position and no visible
  slider overlay.
- A is centered as the reference box; B is scaled independently by fit mode
  (`fit`, `fill`, `stretch`, `original`, `match-width`, `match-height`) and
  positioned by a configurable 3×3 anchor (center by default). Works with
  images and videos of different sizes/aspect ratios.
- Card and selection-toolbar Mask buttons upload the image to
  `input/gallery_masks` and open the built-in ComfyUI mask editor on a standard
  `LoadImage` node. The gallery modal closes first because the global editor
  opens behind it; non-image assets disable the action.
- The selected-card outline is an inset pseudo-element border, avoiding clipping
  by content-visibility at grid row boundaries.
- The Mask action also closes any open Ant image preview before starting the
  editor.

### Graph image preview

- Nodes created by Add to Graph keep the registered **Load Image From Gallery**
  title; the filename is only the widget value, so there is one visible loader
  node type with a fixed name.

- `LoadImageFromGallery` installs a non-serialized DOM widget showing the
  selected image inside the node.
- The preview is built from the output-relative combo value via `/view` and
  refreshes on dropdown changes, Add to Graph, configure/undo and draw-time
  value changes.
- Nodes created by the gallery shortcut call the same preview installer.

### Video and audio gallery loaders

- `Load Video From Gallery` (`video`): recursively lists output-folder videos
  (mp4, webm, mov, mkv, avi, m4v) and returns a ComfyUI `VIDEO` object via
  `InputImpl.VideoFromFile`.
- `Load Audio From Gallery` (`audio`): recursively lists output-folder audio
  (wav, mp3, m4a, flac, aac, ogg, opus) and returns `AUDIO` as
  `{"waveform": ..., "sample_rate": ...}` using PyAV, matching `LoadAudio`.
- Both nodes validate paths against the output root and use mtime/size for
  `IS_CHANGED`.
- Card and multi-selection graph shortcuts map `image` → image node,
  `media` → video node, `audio` → audio node.

### Selection-aware previews

- Clicking an image card opens a selection preview: the viewed image is selected
  (or kept in an existing multi-selection), and paging through the preview calls
  `selectImage` for the newly viewed image. Delete therefore targets what is on
  screen.
- In selection mode the selection action toolbar is portalled above the Ant
  preview mask with a very high z-index, so Add/Download/Delete remain usable.
- A new magnifier card action opens a plain preview. It does not select the
  asset, does not show the selection overlay, and the global Delete/Backspace
  handler ignores the key while `previewMode !== 'selection'`.
- The sticky date divider is flush with the top of the gallery scroll area;
  top padding and inter-section margins were removed so cards cannot show or
  receive clicks in the gap above it.
- The filename is displayed in a chip above the previewed image in both modes,
  so the active file is always identifiable.
- Metadata/video/audio/3D previews use the same plain mode.

## Gallery graph shortcuts

- Every image card has an **Add to active graph** action that creates a
  `LoadImageFromGallery` node at the graph viewport with the image path set.
- The multi-selection toolbar adds each selected image as its own node.
- New nodes are placed in the first free slot inside the visible viewport;
  repeated additions no longer push them under the side panel or off-screen.
- Works with ComfyUI's active subgraph (`canvas.subgraph`) and its typed-array
  `visible_area`; the added node is selected after insertion.
- ComfyUI's active graph is used, including when a subgraph is open.

### Load Image From Gallery node

- New `Load Image From Gallery` node in `image`, returning `IMAGE` and `MASK`.
- Recursively scans `folder_paths.get_output_directory()` so images from past
  ComfyUI sessions and nested output folders are available. The built-in
  `Load Image` only scans the input directory.
- Paths are validated against the output root; path traversal and unsupported
  extensions are rejected.
- Supports PNG, JPEG, WebP, GIF, BMP and TIFF, EXIF orientation, alpha masks and
  animated frames.
- The combo list is built when ComfyUI refreshes node definitions. Use the
  frontend refresh action (or restart ComfyUI) to see files generated after the
  node was created.
- `IS_CHANGED` uses mtime/size, so a replaced file triggers re-execution.

### Unload Models node

- New `Unload Models` output node in `utils`.
- Calls `comfy.model_management.unload_all_models()` and
  `soft_empty_cache(force=True)`; falls back for older ComfyUI versions without
  the `force` argument.
- No required inputs; an optional wildcard `trigger` input can be connected when
  the unload must run after a particular loader.
- `IS_CHANGED` always returns `NaN`, so the output node runs on every queue even
  though it has no inputs.

### Sorting and settings

- One `Name` sort segment toggles ascending/descending; its arrow icon shows the
  active direction instead of duplicating two segments.
- The settings dialog is a compact two-column layout: short switches with labels
  and descriptions, grouped cards for appearance, performance, navigation,
  files/monitoring, and source/thumbnails.
- The theme switch shows a moon icon when dark and a sun icon when light.

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

- Per-file revision token (`mtime_ns-size`) is added to preview, video, audio,
  model and thumbnail URLs. ComfyUI reuses output filenames after the output
  folder is emptied; without the token the browser's immutable thumbnail cache
  and the static route could show the deleted file's bytes.
- Opening the gallery sends `refresh=1`, invalidating the short scan cache so a
  newly generated file appears without waiting for the TTL.

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
- **Paged preview loading** on the client: thumbnails are requested only for
  cards near the viewport (plus two rows), with a stable 600 px request width,
  object-URL cache and fallback to the original on error.
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
  the top-bar slider.
- `sidebarWidth` (default `320`) — folder tree width in pixels, changed by
  dragging its divider.
- `pageMode` (default `endless`) — `endless`, `20`, `40`, `60`, `100` or `200`
  cards per page.
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
