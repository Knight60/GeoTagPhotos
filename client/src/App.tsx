import { useState, useEffect, useMemo, useRef, forwardRef } from 'react'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Camera, Video, MapPin, X, ChevronLeft, ChevronRight, Layers, RefreshCw, Navigation, Globe, Calendar } from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import '@photo-sphere-viewer/core/index.css'
import { ReactPhotoSphereViewer } from 'react-photo-sphere-viewer'

import MarkerClusterGroup from 'react-leaflet-cluster'
import 'default-passive-events'
import { VirtuosoGrid } from 'react-virtuoso'
import type { VirtuosoGridHandle } from 'react-virtuoso'

// CSS fixes for cluster bounds and visibility
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

interface MediaItem {
  id: string
  name: string
  folder: string
  type: 'image' | 'video'
  url: string
  lat: number | null
  lng: number | null
  yaw: number | null
  date: string | null
  isPano?: boolean
}

const gridComponents = {
  List: forwardRef<HTMLDivElement, any>(({ style, children, className, ...props }, ref) => (
    <div
      ref={ref}
      {...props}
      style={{ ...style }}
      className="catalog-grid"
    >
      {children}
    </div>
  )),
  Item: ({ children, ...props }: any) => (
    <div {...props} className="catalog-grid-item">
      {children}
    </div>
  )
};


// Center of Khao Yai / Dong Phayayen roughly
const INITIAL_CENTER: [number, number] = [14.436, 101.381]
const INITIAL_ZOOM = 10

const formatIsoDate = (dateString: string) => {
  const d = new Date(dateString);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function MapUpdater({ selectedItem }: { selectedItem: MediaItem | null }) {
  const map = useMap();
  useEffect(() => {
    if (selectedItem && selectedItem.lat && selectedItem.lng) {
      map.flyTo([selectedItem.lat, selectedItem.lng], 16, {
        animate: true,
        duration: 1.5
      });
    }
  }, [selectedItem, map]);
  return null;
}

export default function App() {
  const [catalog, setCatalog] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'image' | 'video' | 'pano'>('all')
  const [dateFilter, setDateFilter] = useState<string>('all')
  const [activeItem, setActiveItem] = useState<MediaItem | null>(null)
  const [viewingItem, setViewingItem] = useState<MediaItem | null>(null)
  const gridRef = useRef<VirtuosoGridHandle>(null);

  const loadCatalog = (forceRefresh = false) => {
    setLoading(true);
    fetch(`/api/catalog${forceRefresh ? '?refresh=true' : ''}`)
      .then(res => res.json())
      .then(data => {
        setCatalog(data)
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to load catalog:', err)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadCatalog()
  }, [])

  const handleClearCache = () => {
    if (window.confirm('Are you sure you want to rebuild the catalog cache? This may take several minutes.')) {
      loadCatalog(true);
    }
  }

  const uniqueDates = useMemo(() => {
    const dates = new Set<string>()
    catalog.forEach(item => {
      if (item.date) dates.add(item.date.split('T')[0])
    })
    return Array.from(dates).sort((a, b) => b.localeCompare(a))
  }, [catalog])

  const filteredCatalog = useMemo(() => {
    return catalog.filter(item => {
      // Date filter
      if (dateFilter !== 'all') {
         if (!item.date || !item.date.startsWith(dateFilter)) return false;
      }
      
      // Type Filter
      if (filter === 'all') return true;
      if (filter === 'pano') return item.isPano;
      if (filter === 'image') return item.type === 'image' && !item.isPano;
      return item.type === filter;
    });
  }, [catalog, filter, dateFilter])

  const mapMarkers = useMemo(() => {
    // Only map markers that pass the current filter
    return filteredCatalog.filter(item => item.lat !== null && item.lng !== null)
  }, [filteredCatalog])

  // Build a mixed list of date headers + items for the grid
  type DisplayEntry = { kind: 'header'; date: string } | { kind: 'item'; item: MediaItem };
  const groupedDisplayList = useMemo<DisplayEntry[]>(() => {
    const list: DisplayEntry[] = [];
    let lastDate = '';
    for (const item of filteredCatalog) {
      const itemDate = item.date ? item.date.split('T')[0] : 'Unknown';
      if (itemDate !== lastDate) {
        list.push({ kind: 'header', date: itemDate });
        lastDate = itemDate;
      }
      list.push({ kind: 'item', item });
    }
    return list;
  }, [filteredCatalog]);

  // Auto-scroll sidebar to active item when marker is clicked
  useEffect(() => {
    if (activeItem && gridRef.current) {
      const idx = groupedDisplayList.findIndex(
        e => e.kind === 'item' && e.item.id === activeItem.id
      );
      if (idx >= 0) {
        gridRef.current.scrollToIndex({ index: idx, align: 'center' });
      }
    }
  }, [activeItem, groupedDisplayList]);

  const handleNext = () => {
    if (!viewingItem) return
    const currentIndex = filteredCatalog.findIndex(item => item.id === viewingItem.id)
    if (currentIndex < filteredCatalog.length - 1) {
      setViewingItem(filteredCatalog[currentIndex + 1])
      setActiveItem(filteredCatalog[currentIndex + 1])
    }
  }

  const handlePrev = () => {
    if (!viewingItem) return
    const currentIndex = filteredCatalog.findIndex(item => item.id === viewingItem.id)
    if (currentIndex > 0) {
      setViewingItem(filteredCatalog[currentIndex - 1])
      setActiveItem(filteredCatalog[currentIndex - 1])
    }
  }

  // Generate customized leaflet div icons
  const createIcon = (item: MediaItem) => {
    const isVideo = item.type === 'video';
    const isPano = item.isPano;
    const isActive = activeItem?.id === item.id;
    // We use the image itself as background if it's an image, or a placeholder/thumb if video.
    const bgImage = item.type === 'image' ? item.url : 'https://images.unsplash.com/photo-1542204165-65bf26472b9b?auto=format&fit=crop&q=50&w=150';
    
    return L.divIcon({
      className: `custom-marker ${isVideo ? 'video' : ''} ${isPano ? 'pano' : ''} ${isActive ? 'active' : ''}`,
      html: `
        <div style="width:100%; height:100%; border-radius:50%; background-image:url('${bgImage}'); background-size:cover; background-position:center; position:relative;">
          ${item.yaw !== null && !isPano ? `<div class="marker-direction" style="transform: rotate(${item.yaw}deg);"></div>` : ''}
        </div>
      `,
      iconSize: [isActive ? 42 : 30, isActive ? 42 : 30],
      iconAnchor: [isActive ? 21 : 15, isActive ? 42 : 30],
      // @ts-ignore
      bgUrl: bgImage, // Save URL to use in cluster previews
      // @ts-ignore
      isPano: isPano
    });
  }

  // Customized cluster icon showing first image preview
  const createClusterCustomIcon = function (cluster: any) {
    const count = cluster.getChildCount();
    const children = cluster.getAllChildMarkers();
    const bgUrl = children[0]?.options?.icon?.options?.bgUrl || '';
    const hasPano = children.some((child: any) => child.options?.icon?.options?.isPano);

    let size = 46;
    if (count > 50) size = 56;
    if (count > 100) size = 66;
    
    // Orange border if cluster contains at least one sphere/panorama
    const borderColor = hasPano ? '#ea580c' : 'var(--accent)';
    
    return L.divIcon({
      html: `
        <div style="width:100%; height:100%; border-radius:50%; background-image:url('${bgUrl}'); background-size:cover; background-position:center; display:flex; align-items:center; justify-content:center; border: 3px solid ${borderColor}; position:relative; overflow:hidden;">
          <div style="position:absolute; inset:0; background:rgba(0, 0, 0, 0.45);"></div>
          <span style="position:relative; z-index:1; font-weight:bold; color:#fff; font-size:15px; text-shadow:0 2px 6px rgba(0,0,0,1);">${count}</span>
        </div>
      `,
      className: 'custom-cluster-marker',
      iconSize: L.point(size, size, true),
    });
  }

  return (
    <div className="app-container">
      {/* Map Area */}
      <div className="map-container">
        <MapContainer
          center={INITIAL_CENTER}
          zoom={INITIAL_ZOOM}
          style={{ width: '100%', height: '100%' }}
          zoomControl={false}
          preferCanvas={true} // Boosts performance when rendering many layers
          wheelPxPerZoomLevel={120}
        >
          {/* Hybrid tiles suitable for nature surveys */}
          <TileLayer
            attribution='&copy; Google Maps'
            url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
            maxZoom={20}
          />
          <MapUpdater selectedItem={activeItem} />

          {/* Add markers using Cluster Group for performance */}
          <MarkerClusterGroup
            chunkedLoading={true}
            iconCreateFunction={createClusterCustomIcon}
            maxClusterRadius={60}
            spiderfyOnMaxZoom={true}
            showCoverageOnHover={false}
          >
            {mapMarkers.map(item => (
              <Marker
                key={item.id}
                position={[item.lat!, item.lng!]}
                icon={createIcon(item)}
                eventHandlers={{
                  click: () => {
                    setActiveItem(item)
                    setViewingItem(item)
                  }
                }}
              />
            ))}
          </MarkerClusterGroup>
        </MapContainer>

        {/* Floating Map Overlay Header */}
        <div className="map-overlay">
          <div className="map-overlay-icon">
            <Layers size={18} />
          </div>
          <div className="map-overlay-text">
            <h2>การสำรวจแหล่งมรดกโลก</h2>
            <p>กลุ่มป่าดงพญาเย็น-เขาใหญ่</p>
          </div>
        </div>

        {/* Fullscreen Media Viewer Modal */}
        {viewingItem && (
          <div className="viewer-overlay">
            <div className="viewer-header">
              <div className="viewer-title">{viewingItem.name}</div>
              <button className="close-btn" onClick={() => {
                setViewingItem(null)
                setActiveItem(null)
              }}>
                <X size={20} />
              </button>
            </div>
            <div className="viewer-content">
              <button className="viewer-nav prev" onClick={handlePrev}>
                <ChevronLeft size={24} />
              </button>
              
              {viewingItem.type === 'image' ? (
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%' }}>
                  {viewingItem.isPano ? (
                    <ReactPhotoSphereViewer
                      src={viewingItem.url}
                      height={'100%'}
                      width={'100%'}
                      containerClass="pano-viewer"
                    />
                  ) : (
                    <img src={viewingItem.url} alt={viewingItem.name} />
                  )}
                  {viewingItem.yaw !== null && !viewingItem.isPano && (
                    <div className="viewer-north-arrow" style={{ transform: `rotate(${-viewingItem.yaw}deg)` }}>
                      <Navigation size={32} color="#fff" fill="#ef4444" strokeWidth={1} />
                    </div>
                  )}
                </div>
              ) : (
                <video src={viewingItem.url} controls autoPlay />
              )}
              
              <button className="viewer-nav next" onClick={handleNext}>
                <ChevronRight size={24} />
              </button>
            </div>

            {/* Minimap */}
            {viewingItem.lat !== null && viewingItem.lng !== null && (
              <div className="viewer-minimap" onClick={(e) => e.stopPropagation()}>
                <MapContainer
                  center={[viewingItem.lat, viewingItem.lng]}
                  zoom={14}
                  style={{ width: '100%', height: '100%' }}
                  zoomControl={false}
                  attributionControl={false}
                >
                  <TileLayer url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}" />
                  <Marker position={[viewingItem.lat, viewingItem.lng]} icon={createIcon(viewingItem)} />
                  <MapUpdater selectedItem={viewingItem} />
                </MapContainer>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sidebar Catalog */}
      <div className="sidebar">
        <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1>Asset Catalog</h1>
            <p>{filteredCatalog.length} records found in database.</p>
          </div>
          <button 
            onClick={handleClearCache} 
            title="Rebuild Cache"
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: 'var(--text-muted)', 
              cursor: 'pointer',
              padding: '0.25rem'
            }}
          >
            <RefreshCw size={18} />
          </button>
        </div>

        <div className="filters">
          <button 
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All Media
          </button>
          <button 
            className={`filter-btn ${filter === 'image' ? 'active' : ''}`}
            onClick={() => setFilter('image')}
          >
            <Camera size={14} /> Images
          </button>
          <button 
            className={`filter-btn ${filter === 'pano' ? 'active' : ''}`}
            onClick={() => setFilter('pano')}
          >
            <Globe size={14} /> Sphere
          </button>
          <button 
            className={`filter-btn ${filter === 'video' ? 'active' : ''}`}
            onClick={() => setFilter('video')}
          >
            <Video size={14} /> Videos
          </button>
        </div>

        <div className="date-filter-container" style={{ padding: '0 1rem 1rem 1rem', borderBottom: '1px solid var(--border-glass)' }}>
          <div className="date-select-wrapper" style={{ position: 'relative', width: '100%' }}>
            <Calendar size={14} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <select 
              value={dateFilter} 
              onChange={(e) => setDateFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 1rem 0.6rem 2.25rem',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-glass)',
                color: 'var(--text-main)',
                borderRadius: '8px',
                fontSize: '0.875rem',
                appearance: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit'
              }}
            >
              <option value="all" style={{ color: '#000' }}>All Dates</option>
              {uniqueDates.map(date => (
                <option key={date} value={date} style={{ color: '#000' }}>{date}</option>
              ))}
            </select>
            {/* simple chevron down for dropdown icon */}
            <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '4px solid var(--text-muted)' }}></div>
          </div>
        </div>

        {loading ? (
          <div className="status">
            <div className="spinner" />
            Scanning massive UAV directories...
          </div>
        ) : (
          <VirtuosoGrid
            ref={gridRef}
            className="catalog"
            components={gridComponents}
            totalCount={groupedDisplayList.length}
            itemContent={(index: number) => {
              const entry = groupedDisplayList[index];
              if (entry.kind === 'header') {
                return (
                  <div className="date-separator">
                    <Calendar size={14} />
                    <span>{entry.date}</span>
                  </div>
                );
              }
              const item = entry.item;
              return (
                <div 
                  key={item.id} 
                  className={`catalog-item ${item.type === 'video' ? 'catalog-item-video' : ''} ${activeItem?.id === item.id ? 'catalog-item-active' : ''}`}
                  style={{
                    backgroundImage: `url('${item.type === 'image' ? item.url : 'https://images.unsplash.com/photo-1542204165-65bf26472b9b?auto=format&fit=crop&q=50&w=300'}')`
                  }}
                  onClick={() => {
                    setActiveItem(item)
                    setViewingItem(item)
                  }}
                >
                  {item.type === 'video' && <Video color="#fff" fill="#000" size={16} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 2 }} />}
                  {item.isPano && <Globe color="#ea580c" fill="rgba(0,0,0,0.5)" size={24} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 2, borderRadius: '50%' }} />}
                  {item.type === 'image' && item.yaw !== null && !item.isPano && (
                    <div className="catalog-north-arrow" style={{ transform: `rotate(${-item.yaw}deg)` }} title="North Direction">
                      <Navigation size={14} color="#fff" fill="#ef4444" strokeWidth={1} />
                    </div>
                  )}
                  <div className="catalog-item-info">
                    <div className="catalog-item-name">{item.name}</div>
                    <div className="catalog-item-date" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}>
                      {item.date ? formatIsoDate(item.date) : 'Unknown Date'}
                      {item.lat && <MapPin size={10} color="#10b981" />}
                    </div>
                  </div>
                </div>
              );
            }}
          />
        )}
      </div>

    </div>
  )
}
