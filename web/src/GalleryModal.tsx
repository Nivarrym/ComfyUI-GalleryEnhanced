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

const GalleryModal = () => {
    const { open, setOpen, size, showSettings, siderCollapsed, settings } = useGalleryContext();
    const themeClass = galleryThemeClass(settings.darkMode);
    const modalWidth = size?.width && size.width > 320 ? size.width : '96vw';

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
                        background: 'var(--gallery-bg-sunken)',
                    }}
                >
                    <Sider
                        collapsed={siderCollapsed}
                        collapsedWidth={0}
                        width="20%"
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
                    <GalleryImageGrid />
                </Layout>
            </Modal>
            {showSettings && <GallerySettingsModal />}
            <PerfPanel />
        </>
    );
};

export default GalleryModal;
