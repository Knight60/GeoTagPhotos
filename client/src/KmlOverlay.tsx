import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import JSZip from 'jszip';
import { kml } from '@tmcw/togeojson';

const KML_FILES = [
  '/sea/kml/PRTC-DPKY.kmz',
];

/**
 * Extract style from GeoJSON feature properties (as output by @tmcw/togeojson).
 * togeojson maps KML <Style> elements to these GeoJSON properties:
 *   stroke, stroke-opacity, stroke-width, fill, fill-opacity
 */
function featureStyle(feature: GeoJSON.Feature): L.PathOptions {
  const props = feature.properties || {};
  return {
    color: props['stroke'] || '#ffffff',
    weight: props['stroke-width'] ?? 2.4,
    opacity: props['stroke-opacity'] ?? 1,
    fillColor: props['fill'] || '#91522d',
    fillOpacity: props['fill-opacity'] ?? 0.15,
  };
}

async function parseKmz(url: string): Promise<GeoJSON.FeatureCollection> {
  const response = await fetch(url);
  const blob = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(blob);

  // Find the .kml file inside the KMZ
  const kmlFile = Object.keys(zip.files).find(name => name.endsWith('.kml'));
  if (!kmlFile) throw new Error('No KML file found inside KMZ');

  const kmlText = await zip.files[kmlFile].async('text');
  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlText, 'text/xml');
  return kml(doc) as GeoJSON.FeatureCollection;
}

async function parseKml(url: string): Promise<GeoJSON.FeatureCollection> {
  const response = await fetch(url);
  const text = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');
  return kml(doc) as GeoJSON.FeatureCollection;
}

export default function KmlOverlay() {
  const map = useMap();

  useEffect(() => {
    const layers: L.Layer[] = [];

    async function loadAll() {
      for (const url of KML_FILES) {
        try {
          const isKmz = url.toLowerCase().endsWith('.kmz');
          const geojson = isKmz ? await parseKmz(url) : await parseKml(url);

          const layer = L.geoJSON(geojson, {
            // Apply per-feature style from KML Style definitions
            style: (feature) => feature ? featureStyle(feature) : {},
            pointToLayer: (feature, latlng) => {
              const style = featureStyle(feature);
              return L.circleMarker(latlng, {
                radius: 6,
                color: style.color,
                weight: style.weight,
                opacity: style.opacity,
                fillColor: style.fillColor,
                fillOpacity: 0.6,
              });
            },
            onEachFeature: (feature, layer) => {
              const props = feature.properties || {};
              const name = props.name || '';
              const typeTh = props.Type_th || '';
              const nameTh = props.Name_TH || '';
              const paro = props.PARO_NAME || '';

              let popup = '';
              if (nameTh) popup += `<b style="font-size:14px">${nameTh}</b><br/>`;
              else if (name) popup += `<b style="font-size:14px">${name}</b><br/>`;
              if (typeTh) popup += `<span style="color:#888">${typeTh}</span><br/>`;
              if (paro) popup += `<span style="font-size:12px">${paro}</span>`;

              if (popup) {
                layer.bindPopup(popup, { maxWidth: 300 });
              }
            },
          });

          layer.addTo(map);
          layers.push(layer);
          console.log(`KML loaded: ${url} (${geojson.features.length} features)`);
        } catch (err) {
          console.error(`Failed to load KML: ${url}`, err);
        }
      }
    }

    loadAll();

    return () => {
      layers.forEach(l => map.removeLayer(l));
    };
  }, [map]);

  return null;
}
