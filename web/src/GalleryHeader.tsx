import { memo, useEffect, useRef, useState } from 'react';
import { Flex, AutoComplete, Button, Segmented, Select, Tag, Tooltip, Typography } from 'antd';
import { BugOutlined, CloseSquareFilled, DoubleLeftOutlined, DoubleRightOutlined, LeftOutlined, RightOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { useGalleryContext, type AssetFilter, type PageMode } from './GalleryContext';
import { useDebounce, useCountDown } from 'ahooks';
import GallerySizeControl from './GallerySizeControl';

const GalleryHeader = memo(function GalleryHeader() {
    const {
        showSettings, setShowSettings,
        setSearchFileName,
        sortMethod, setSortMethod,
        imagesAutoCompleteNames,
        autoCompleteOptions, setAutoCompleteOptions,
        setOpen,
        selectedImages,
        setShowPerf,
        pageMode, setPageMode,
        pageIndex, setPageIndex, pageCount,
        siderCollapsed, setSiderCollapsed,
        assetFilter, setAssetFilter
    } = useGalleryContext();

    const [search, setSearch] = useState("");
    const [showClose, setShowClose] = useState(false);
    const [targetDate, setTargetDate] = useState<number>();
    const [countdown] = useCountDown({
        targetDate,
        onEnd: () => {
            setOpen(false);
            setShowClose(false);
            setTargetDate(undefined);
        },
    });
    const dragCounter = useRef(0);

    // Show close button only when dragging
    useEffect(() => {
        const onDragStart = () => setShowClose(true);
        const onDragEnd = () => {
            setShowClose(false);
            setTargetDate(undefined);
        };
        window.addEventListener('dragstart', onDragStart);
        window.addEventListener('dragend', onDragEnd);
        return () => {
            window.removeEventListener('dragstart', onDragStart);
            window.removeEventListener('dragend', onDragEnd);
        };
    }, []);

    // Debounce the search input to prevent lag
    const debouncedSearch = useDebounce(search, { wait: 100 });

    useEffect(() => {
        setSearchFileName(debouncedSearch);

        if (!debouncedSearch || debouncedSearch.length == 0) {
            setAutoCompleteOptions(imagesAutoCompleteNames);
        } else {
            setAutoCompleteOptions(
                imagesAutoCompleteNames.filter(opt =>
                    typeof opt.value === 'string' && opt.value.toLowerCase().includes(debouncedSearch.toLowerCase())
                )
            );
        }
    }, [debouncedSearch, imagesAutoCompleteNames, setAutoCompleteOptions]);

    return (
        <Flex
            justify={"space-between"}
            align={"center"}
            gap={16}
            style={{ width: '100%' }}
        >
            <div
                style={{
                    display: "flex",
                    alignContent: "center",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "8px",
                }}
            >
                <Button
                    size="middle"
                    onClick={() => setSiderCollapsed((prev: boolean) => !prev)}
                    aria-label="Toggle sidebar"
                >
                    {siderCollapsed ? <DoubleRightOutlined /> : <DoubleLeftOutlined />}
                </Button>
                <Button
                    size={"middle"}
                    onClick={() => setShowSettings(true)}
                >
                    Settings
                </Button>
                <Tooltip title="Performance report">
                    <Button
                        size={"middle"}
                        icon={<BugOutlined />}
                        onClick={() => setShowPerf(true)}
                        aria-label="Performance report"
                    />
                </Tooltip>
            </div>
            {selectedImages.length > 0 && (
                <Tag color="blue" style={{ marginInlineEnd: 0, whiteSpace: 'nowrap' }}>
                    {selectedImages.length} selected
                </Tag>
            )}
            {showClose && (
                <div
                    style={{
                        display: 'inline-block'
                    }}
                    onDragEnter={e => {
                        e.preventDefault();
                        dragCounter.current++;
                        if (!targetDate) {
                            setTargetDate(Date.now() + 3000);
                        }
                    }}
                    onDragLeave={e => {
                        e.preventDefault();
                        dragCounter.current--;
                        if (dragCounter.current === 0 && targetDate) {
                            setTargetDate(undefined);
                        }
                    }}
                >
                    <Button
                        type="default"
                        style={{
                            marginLeft: "8px",
                            display: "flex",
                            alignItems: "center",
                            position: "relative",
                            cursor: "pointer",
                            justifyContent: "center",
                            alignContent: "center",
                            flexWrap: "wrap",
                            width: 150
                        }}
                        tabIndex={-1} // Prevent focus flicker
                    >
                        {targetDate
                            ? (
                                <Typography
                                    style={{
                                        color: '#ff4d4f',
                                        fontWeight: 500
                                    }}
                                >
                                    {`   Close in ${Math.ceil(countdown / 1000)}s   `}
                                </Typography>
                            ) : (
                                <Typography
                                    style={{
                                        color: '#888',
                                        fontWeight: 400
                                    }}
                                >
                                    Hover to close 3s
                                </Typography>
                            )
                        }
                    </Button>
                </div>
            )}
            <AutoComplete
                options={
                    autoCompleteOptions && autoCompleteOptions.length > 0
                        ? autoCompleteOptions
                        : imagesAutoCompleteNames
                }
                style={{
                    flex: '1 1 280px',
                    minWidth: 160,
                }}
                onSearch={text => setSearch(text)}
                value={search}
                onChange={val => setSearch(val)}
                placeholder="Search for file name"
                allowClear={{
                    clearIcon: <CloseSquareFilled />
                }}
            />
            <GallerySizeControl />
            <Select<AssetFilter>
                className="gallery-asset-filter"
                size="small"
                value={assetFilter}
                onChange={(value) => setAssetFilter(value)}
                style={{ width: 126, flex: '0 0 auto' }}
                options={[
                    { value: 'none', label: 'No filter' },
                    { value: 'favorite', label: 'Favorites' },
                    { value: 'trash', label: 'Trash' },
                ]}
                aria-label="Filter assets"
            />
            <Select<PageMode>
                className="gallery-page-mode"
                size="small"
                value={pageMode}
                onChange={(value) => setPageMode(value)}
                style={{ width: 132, flex: '0 0 auto' }}
                options={[
                    { value: 'endless' as PageMode, label: 'Endless scroll' },
                    { value: 20 as PageMode, label: '20' },
                    { value: 40 as PageMode, label: '40' },
                    { value: 60 as PageMode, label: '60' },
                    { value: 100 as PageMode, label: '100' },
                    { value: 200 as PageMode, label: '200' },
                ]}
                aria-label="Pagination mode"
            />
            <Button
                size="small"
                icon={<LeftOutlined />}
                disabled={pageMode === 'endless' || pageIndex <= 0}
                onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
                aria-label="Previous page"
            />
            <Button
                size="small"
                icon={<RightOutlined />}
                disabled={pageMode === 'endless' || pageIndex >= pageCount - 1}
                onClick={() => setPageIndex((index) => Math.min(pageCount - 1, index + 1))}
                aria-label="Next page"
            />
            <Segmented<string>
                style={{
                    marginRight: 8
                }}
                options={[
                    { value: 'Newest', label: 'Newest' },
                    { value: 'Oldest', label: 'Oldest' },
                    {
                        value: 'Name',
                        label: (
                            <span
                                className="gallery-sort-name"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setSortMethod(prev => {
                                        if (prev === 'Name ↑') return 'Name ↓';
                                        if (prev === 'Name ↓') return 'Name ↑';
                                        return 'Name ↑';
                                    });
                                }}
                            >
                                Name
                                {sortMethod === 'Name ↓' ? <ArrowDownOutlined /> : <ArrowUpOutlined />}
                            </span>
                        ),
                    },
                ]}
                value={sortMethod === 'Name ↑' || sortMethod === 'Name ↓' ? 'Name' : sortMethod}
                onChange={value => {
                    if (value === 'Name') {
                        setSortMethod(prev => {
                            if (prev === 'Name ↑') return 'Name ↓';
                            if (prev === 'Name ↓') return 'Name ↑';
                            return 'Name ↑';
                        });
                    } else {
                        setSortMethod(value as any);
                    }
                }}
            />
        </Flex>
    );
});

export default GalleryHeader;
