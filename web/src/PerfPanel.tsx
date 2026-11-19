import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Divider, Empty, Flex, Modal, Tag, Typography } from 'antd';
import CopyOutlined from '@ant-design/icons/lib/icons/CopyOutlined';
import ReloadOutlined from '@ant-design/icons/lib/icons/ReloadOutlined';
import { useGalleryContext } from './GalleryContext';
import { BASE_Z_INDEX, ComfyAppApi, type ServerPerfResponse } from './ComfyAppApi';
import { formatMs, getPerfEvents, getPerfSnapshot, resetPerf, type PerfEvent } from './perf';
import { formatBytes, getThumbnailStats } from './thumbnails';
import { galleryThemeClass } from './theme';

const IMPORTANT = new Set([
    'gallery.bootstrap',
    'settings.fetch',
    'images.fetch',
    'images.fetch.network',
    'grid.firstPaint',
    'thumbnails.firstBatch',
    'gallery.ready',
]);

function eventDetail(event: PerfEvent): string {
    if (!event.detail) return '';
    return Object.entries(event.detail)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
        .join(' · ');
}

const PerfPanel = () => {
    const { showPerf, setShowPerf, scanInfo, settings } = useGalleryContext();
    const { message } = App.useApp();
    const [server, setServer] = useState<ServerPerfResponse | undefined>(undefined);
    const [loading, setLoading] = useState(false);
    const [events, setEvents] = useState<PerfEvent[]>([]);

    const refresh = useCallback(async () => {
        setEvents(getPerfEvents());
        setLoading(true);
        try {
            setServer(await ComfyAppApi.fetchPerf());
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!showPerf) return;
        void refresh();
    }, [showPerf, refresh]);

    const thumbStats = useMemo(() => getThumbnailStats(), [server, events]);

    const summary = useMemo(() => {
        const find = (name: string) => [...events].reverse().find((event) => event.name === name);
        return {
            bootstrap: find('gallery.bootstrap')?.duration,
            settings: find('settings.fetch')?.duration,
            images: find('images.fetch')?.duration,
            scan: scanInfo?.scanMs,
            firstPaint: find('grid.firstPaint')?.duration,
        };
    }, [events, scanInfo]);

    const sortedEvents = useMemo(
        () => [...events].filter((event) => event.duration > 0).sort((a, b) => a.start - b.start),
        [events]
    );

    const copyReport = useCallback(async () => {
        const report = {
            client: getPerfSnapshot(),
            server,
            scanInfo,
            thumbnails: thumbStats,
            settings,
        };
        try {
            await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
            message.success('Performance report copied');
        } catch {
            message.error('Clipboard is not available');
        }
    }, [message, scanInfo, server, settings, thumbStats]);

    return (
        <Modal
            zIndex={BASE_Z_INDEX + 2}
            rootClassName={`gallery-modal-root ${galleryThemeClass(settings.darkMode)}`}
            title="Performance report"
            open={showPerf}
            onCancel={() => setShowPerf(false)}
            footer={(
                <Flex justify="space-between" align="center">
                    <Flex gap={8}>
                        <Button icon={<ReloadOutlined />} loading={loading} onClick={refresh}>Refresh</Button>
                        <Button
                            onClick={() => {
                                resetPerf();
                                setEvents([]);
                                void ComfyAppApi.resetPerf();
                            }}
                        >
                            Reset counters
                        </Button>
                    </Flex>
                    <Flex gap={8}>
                        <Button icon={<CopyOutlined />} onClick={copyReport}>Copy JSON</Button>
                        <Button type="primary" onClick={() => setShowPerf(false)}>Close</Button>
                    </Flex>
                </Flex>
            )}
            width={860}
            centered
        >
            <Flex vertical gap={12}>
                <Alert
                    type={settings.debugPerf ? 'success' : 'info'}
                    showIcon
                    message={settings.debugPerf ? 'Detailed logging is enabled (settings.debugPerf).' : 'Detailed logging is off; events are still measured in memory.'}
                    description="Marks cover bootstrap, settings, listing, first paint and thumbnail paging. Server timings are reported by /Gallery/perf."
                />

                <Flex gap={8} wrap>
                    <Tag color="blue">bootstrap: {formatMs(summary.bootstrap ?? NaN)}</Tag>
                    <Tag color="geekblue">settings: {formatMs(summary.settings ?? NaN)}</Tag>
                    <Tag color="cyan">listing: {formatMs(summary.images ?? NaN)}</Tag>
                    <Tag color="purple">server scan: {formatMs(summary.scan ?? NaN)}</Tag>
                    <Tag color="gold">first paint: {formatMs(summary.firstPaint ?? NaN)}</Tag>
                    <Tag>{scanInfo?.files ?? '?'} files</Tag>
                    <Tag>{scanInfo?.cache === 'hit' ? 'scan cache hit' : 'scan cache miss'}</Tag>
                </Flex>

                <div>
                    <Typography.Title level={5} style={{ marginBottom: 4 }}>Thumbnail paging</Typography.Title>
                    <Flex gap={8} wrap>
                        <Tag>requested: {thumbStats.requested}</Tag>
                        <Tag>loaded: {thumbStats.loaded}</Tag>
                        <Tag>failed: {thumbStats.failed}</Tag>
                        <Tag>in flight: {thumbStats.inFlight}</Tag>
                        <Tag>queued: {thumbStats.queued}</Tag>
                        <Tag>peak queue: {thumbStats.peakQueue}</Tag>
                        <Tag>cache: {thumbStats.cacheEntries}</Tag>
                        <Tag>bytes: {formatBytes(thumbStats.bytes)}</Tag>
                        <Tag>avg: {formatMs(thumbStats.avgMs)}</Tag>
                    </Flex>
                </div>

                <Divider style={{ margin: '4px 0' }} />

                <Typography.Title level={5} style={{ marginBottom: 4 }}>Client timeline</Typography.Title>
                <div className="gallery-perf-table" style={{ maxHeight: 300, overflowY: 'auto' }}>
                    {sortedEvents.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No events yet" /> : sortedEvents.map((event) => (
                        <div className="gallery-perf-row" key={`${event.id}-${event.name}`} style={IMPORTANT.has(event.name) ? { fontWeight: 600 } : undefined}>
                            <div>
                                <div className="gallery-perf-name">{event.name}</div>
                                <div className="gallery-perf-detail">{eventDetail(event)}</div>
                            </div>
                            <div className="gallery-perf-value">{formatMs(event.duration)}</div>
                        </div>
                    ))}
                </div>

                <Divider style={{ margin: '4px 0' }} />

                <Typography.Title level={5} style={{ marginBottom: 4 }}>Server timeline</Typography.Title>
                <div className="gallery-perf-table" style={{ maxHeight: 240, overflowY: 'auto' }}>
                    {(server?.records ?? []).length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No server records" /> : [...(server?.records ?? [])].reverse().map((record, index) => {
                        const { label, ms, ts, timestamp, fields, ...rest } = record;
                        const detail = fields ?? rest;
                        const detailText = Object.keys(detail).length > 0 ? JSON.stringify(detail) : '';
                        return (
                            <div className="gallery-perf-row" key={`${ts ?? timestamp ?? index}-${label}-${index}`}>
                                <div>
                                    <div className="gallery-perf-name">{label}</div>
                                    <div className="gallery-perf-detail">{detailText}</div>
                                </div>
                                <div className="gallery-perf-value">{formatMs(Number(ms))}</div>
                            </div>
                        );
                    })}
                </div>
            </Flex>
        </Modal>
    );
};

export default PerfPanel;
