import React, { useEffect, useRef, useState } from 'react';
import Modal from 'antd/es/modal/Modal';
import Layout from 'antd/es/layout/layout';
import Sider from 'antd/es/layout/Sider';
import { useGalleryContext } from './GalleryContext';
import GalleryHeader from './GalleryHeader';
import GallerySidebar from './GallerySidebar';
import GalleryImageGrid from './GalleryImageGrid';
import GallerySettingsModal from './GallerySettingsModal';
import PerfPanel from './PerfPanel';
import { BASE_Z_INDEX } from './ComfyAppApi';
import { galleryThemeClass } from './theme';

const MIN_SIDEBAR = 200;
const MAX_SIDEBAR = 640;

const GalleryModal = () => {
    const { open, setOpen, size, showSettings, siderCollapsed, effectiveDarkMode, settings, setSettings } = useGalleryContext();
    const themeClass = galleryThemeClass(effectiveDarkMode);
    const modalWidth = size?.width && size.width > 320 ? size.width : '96vw';
    const [sidebarWidth, setSidebarWidth] = useState(settings.sidebarWidth || 320);
    const resizeRef = useRef<{ startX: number; startWidth: number; lastWidth: number } | null>(null);

    useEffect(() => {
        setSidebarWidth(settings.sidebarWidth || 320);
    }, [settings.sidebarWidth]);

    const persistSidebarWidth = (width: number) => {
        setSettings({ ...settings, sidebarWidth: width });
    };

    const startSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        resizeRef.current = { startX: event.clientX, startWidth: sidebarWidth, lastWidth: sidebarWidth };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const available = size?.width ?? window.innerWidth;
        const maxWidth = Math.max(MIN_SIDEBAR, Math.min(MAX_SIDEBAR, available - 360));

        const onMove = (moveEvent: PointerEvent) => {
            const drag = resizeRef.current;
            if (!drag) return;
            const next = Math.max(MIN_SIDEBAR, Math.min(maxWidth, drag.startWidth + (moveEvent.clientX - drag.startX)));
            drag.lastWidth = next;
            setSidebarWidth(next);
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            const finalWidth = resizeRef.current?.lastWidth ?? sidebarWidth;
            resizeRef.current = null;
            persistSidebarWidth(finalWidth);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    };

    const resetSidebarWidth = () => {
        setSidebarWidth(320);
        persistSidebarWidth(320);
    };

    return (
        <>
            <Modal
                zIndex={BASE_Z_INDEX}
                rootClassName={`gallery-modal-root ${themeClass}`}
                title={<GalleryHeader />}
                centered
                open={open}
                keyboard={false}
                afterOpenChange={setOpen}
                onOk={() => setOpen(false)}
                onCancel={() => setOpen(false)}
                width={modalWidth}
                footer={null}
            >
                <Layout
                    style={{
                        borderRadius: 8,
                        overflowX: "hidden",
                        overflowY: "auto",
                        width: '100%',
                        height: "85vh",
                        position: 'relative',
                        background: 'var(--gallery-bg-sunken)',
                    }}
                >
                    <Sider
                        collapsed={siderCollapsed}
                        collapsedWidth={0}
                        width={sidebarWidth}
                        style={{
                            overflow: 'auto',
                            position: 'sticky',
                            insetInlineStart: 0,
                            top: 0,
                            bottom: 0,
                            scrollbarWidth: 'thin',
                            scrollbarGutter: 'stable',
                            background: "var(--gallery-bg)",
                            borderRight: '1px solid var(--gallery-border)',
                        }}
                    >
                        <GallerySidebar />
                    </Sider>
                    {!siderCollapsed && (
                        <div
                            className="gallery-sider-resizer"
                            style={{ left: sidebarWidth }}
                            onPointerDown={startSidebarResize}
                            onDoubleClick={resetSidebarWidth}
                            title="Drag to resize the sidebar; double-click to reset"
                            role="separator"
                            aria-orientation="vertical"
                            aria-label="Resize sidebar"
                        />
                    )}
                    <GalleryImageGrid />
                </Layout>
            </Modal>
            {showSettings && <GallerySettingsModal />}
            <PerfPanel />
        </>
    );
};

export default GalleryModal;
