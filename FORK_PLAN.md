# ComfyUI-Gallery — план форка

Форк upstream `PanicTitan/ComfyUI-Gallery` 2.7.1. Базовая копия закоммичена как
`Import upstream ComfyUI-Gallery 2.7.1`, upstream добавлен как git remote.

## 1. Цели

1. Shift-select, Ctrl/Cmd-select и Box-drag-select ассетов.
2. Multi-delete выбранных ассетов (batch endpoint + подтверждение + optimistic UI).
3. Иконка корзины в углу карточки при наведении.
4. Полноценная тёмная тема интерфейса.
5. Диагностика и ускорение инициализации галереи и постраничной загрузки превью.

Не цели: менять формат метаданных, ломать upstream API, трогать PromptAssistant.

## 2. Что уже есть в upstream

- Ctrl/Cmd-select карточек и папок, `selectedImages` в контексте.
- «Delete Selected» в заголовке: последовательные одиночные `POST /Gallery/delete`.
- Чёрновик тёмной темы: `darkMode` включает только antd `darkAlgorithm`, при этом
  в компонентах много жёстко заданных цветов (`#23272f`, `#ccc`, `#888`, `white`).
- `/Gallery/images` сканирует всё дерево, извлекает метаданные всех картинок
  (Pillow открывает каждый файл) и **блокирует event loop** через
  `queue.Queue.get()` внутри `async`-хендлера.
- При старте выполняется 2–3 полных сканирования (monitor initial scan + fetch images).
- Сетка грузит полноразмерные оригиналы: скрытый `<Image src=original>` на каждой
  карточке, плюс `<img>` с тем же оригиналом. Превью-«пейджинг» фактически отсутствует.
- `folder_monitor` перепутан: при `use_polling_observer=False` используется
  `PollingObserver`, при `true` — `Observer`.

## 3. Архитектура изменений

### Backend

```
gallery_paths.py      — единая безопасная резолюция /static_gallery/... путей
gallery_perf.py       — таймеры, ring buffer, /Gallery/perf
scan_service.py       — single-flight + TTL-кэш сканов (дерево без метаданных)
metadata_service.py   — ленивое извлечение метаданных по одному файлу + LRU
thumbnail_service.py  — дисковый кэш WebP-превью, Pillow, атомарная запись
```

- `/Gallery/images`: быстрый листинг без метаданных, `async` + `asyncio.to_thread`,
  заголовки `X-Gallery-Scan-Ms`, `X-Gallery-Scan-Cache`, `X-Gallery-File-Count`.
- `/Gallery/metadata?path=...`: метаданные одного ассета по запросу (кэш по
  `realpath+mtime+size`), инвалидация при изменении файла.
- `/Gallery/thumbnail?path=...&w=400&v=mtime`: WebP-превью с дисковым кэшем,
  `Cache-Control: immutable`, `X-Gallery-Thumb-Cache`.
- `/Gallery/delete`: батч `{"image_paths": [...]}`, обратная совместимость с
  `{"image_path": ...}`, отчёт `{deleted, failed, count}`, инвалидация кэшей.
- `/Gallery/perf`: последние серверные тайминги; `DELETE` — сброс.
- `scan_service`: один реальный скан на конкурентные запросы, TTL 2 c,
  инвалидация при старте монитора, move/delete, изменении настроек.
- `folder_monitor`: исправить Observer/PollingObserver, убрать лишние сканы,
  rescans без метаданных, не блокировать старт.
- `metadata_extractor`: закрывать PIL-хэндлы (`with Image.open`) — текущая утечка
  открытых файлов на каждом скане.

### Frontend

```
theme.ts              — antd tokens + CSS-переменные для light/dark
gallery.css?inline    — маркиза, hover-корзина, тулбар выделения, скроллбары
perf.ts               — performance.mark/measure, отчёт, window.__galleryPerf
thumbnails.ts         — очередь превью: concurrency 6, батчи, fallback на оригинал
useBoxSelection.ts    — marquee: pointer events, автоскролл, additive Ctrl
SelectionToolbar.tsx  — N selected / Select all / Download / Delete / Clear
PerfPanel.tsx         — клиентский таймлайн + серверные записи + статистика превью
```

- Единая модель выделения в `GalleryContext`: `selectedSet`, `anchor`,
  `selectImage(url, {ctrl, shift})`, `selectAllVisible`, `clearSelection`,
  `removeAssets` (optimistic), очистка при смене папки.
- Ctrl/Cmd-click и Shift-click перехватываются в capture-фазе, чтобы не открывать
  antd-превью. Обычный клик открывает превью; клик по уже выбранной карточке
  сохраняет выделение. Esc — снять, Ctrl+A — выбрать всё, Delete — удалить выбранное.
- Box-drag: старт только по фону/пустым ячейкам, порог 4 px, overlay, выбор
  пересечённых `.image-card[data-asset-url]`, Ctrl добавляет к текущему выделению,
  автоскролл у краёв, подавление клика после маркизы.
- Multi-delete: batch endpoint, подтверждение с количеством, optimistic удаление
  из `data`, prune выделения, сообщение об ошибках; одиночное удаление — корзина
  на карточке (Popconfirm).
- Тема: `ConfigProvider` tokens + `rootClassName` на модалках + CSS-переменные;
  убрать жёсткие цвета из `ImageCard`, `GalleryImageGrid`, `GallerySidebar`,
  `MetadataView`, `GalleryModal`; JSON-view в тёмной палитре; кастомные скроллбары.
- Инициализация: `main.tsx` больше не запускает монитор (это делает контекст после
  загрузки настроек), один `runAsync` на старте, тайминги на всех этапах.
- Превью: в сетке только thumbnail URL, оригинал грузится при открытии превью
  (`preview={{src: original}}`); видео не автоплеятся все сразу — play on hover,
  `preload="metadata"`; очередь с ограничением concurrency и батчами, skeleton.

## 4. Этапы

1. **База** — копия upstream, git, upstream remote, этот план. ✅
2. **Backend perf/paging** — параллельно с фронтендом; контракт API выше.
3. **Frontend selection + delete + theme** — единая модель выделения, тулбар,
   корзина, тема.
4. **Frontend perf** — таймлайн, очередь превью, PerfPanel.
5. **Интеграция** — сборка `web/dist`, TS strict, Python-тесты, проверка в живом
   ComfyUI 0.45 (junction `Q:\Ai\Comfy\Shareable\custom_nodes`).
6. **Документация** — README/FORK_CHANGES, версия 2.8.0+fork.1, коммиты.

## 5. Приёмка

- Ctrl-click точечно, Shift-click диапазон, box-drag мышью; выделение видно,
  не открывает превью, не конфликтует с перетаскиванием файлов.
- Выбранное удаляется одной операцией, UI обновляется сразу, ошибки видны.
- Корзина на карточке появляется при hover и удаляет один файл после подтверждения.
- Тёмная тема: модалка, сайдбар, сетка, карточки, метаданные, настройки,
  скроллбары, JSON-view — без белых «просветов»; светлая тема не сломана.
- `/Gallery/images` не блокирует event loop, повторные запросы используют кэш,
  метаданные грузятся по требованию.
- В консоли/панели виден таймлайн: settings → images → first paint → thumbnails;
  серверные фазы скана и генерации превью.
- `npm run build` и Python-тесты проходят; `web/dist/assets/comfy-ui-gallery.js`
  пересобран.
