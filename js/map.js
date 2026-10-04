/*
FILE PURPOSE: Creates and owns the single Leaflet map instance.
WHAT THIS FILE DOES:
  - Builds the Leaflet map inside <div id="map">.
  - Adds the basemap (tile layer) options listed in config.js and lets
    the user switch between them.
  - Provides a "fit to Western Province" helper, used once the wp.geojson
    boundary layer has loaded (falls back to a hard-coded box until then).
  - Provides a small "click-to-pick-a-location" helper used by
    participation.js (Add Place / Report Issue workflows).
  - Binds the two map-wide events that drive zoom/extent-dependent
    behaviour elsewhere in the project: "zoomend" (used by the road
    hierarchy in layers.js, AND by the new progressive POI reveal) and
    "moveend" (used only by the new progressive POI reveal - panning
    without zooming still needs to update which tourism points are
    currently inside the visible extent).
MAIN FUNCTIONS:
  MapCore.init, MapCore.getMap, MapCore.fitToBoundsLayer,
  MapCore.startLocationPicking, MapCore.stopLocationPicking
DEPENDENCIES: Leaflet (global L), config.js, utils.js (debounce).

IMPORTANT LESSON BAKED INTO THIS FILE:
  Every call to the Leaflet global "L" happens INSIDE a function, never
  at the top level of the file. If this script ever loads before the
  Leaflet <script> tag (e.g. a slow network), a top-level "L.something"
  would throw and stop every file loaded after it. Keeping everything
  inside init() means the rest of the app can still show a clear error
  message instead of a totally blank, unresponsive page.
--------------------------------------------------------------------------
*/

const MapCore = (function () {
  let map = null;
  let activeBaseLayer = null;
  const baseLayers = {};

  // Location-picking state (used by "Add Tourism Place" / "Report Issue")
  let pickingActive = false;
  let pickingCallback = null;
  let pickingMarker = null;

  // ------------------------------------------------------------------
  // PROGRESSIVE POI REVEAL (cartographic/UI-UX refinement)
  // ------------------------------------------------------------------
  // One handler, bound to BOTH zoomend and moveend, debounced so a fast
  // drag-pan or a scroll-wheel zoom burst does not trigger dozens of
  // recomputes - only one, ~150ms after the user stops moving the map.
  // It simply asks LayerManager to re-check, for every editable tourism
  // category, which of its already-built markers currently belong on
  // the map (see layers.js's updatePOIVisibilityForViewport() for the
  // actual zoom/bounds/panel/filter logic - this file only triggers it,
  // it has no opinion about WHICH markers should be visible). Guarded
  // with typeof checks because map.js loads before layers.js (see
  // index.html's script order), so LayerManager does not exist yet at
  // the moment this function is DEFINED - only at the moment it is
  // eventually CALLED, by which point the whole app has finished
  // booting (ui.js's boot() always finishes LayerManager.buildAll()
  // long before the user can pan/zoom for the first time).
  const triggerPOIVisibilityUpdate = debounce(() => {
    if (typeof LayerManager !== "undefined" && typeof LayerManager.updatePOIVisibilityForViewport === "function") {
      LayerManager.updatePOIVisibilityForViewport();
    }
  }, 150);

  function init(containerId) {
    const cfg = APP_CONFIG.map;

    map = L.map(containerId, {
      center: cfg.initialCenter,
      zoom: cfg.initialZoom,
      zoomControl: false // we add it in a chosen corner below
    });

    createPanes(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);

    // Build every basemap listed in config.js, but only add the default
    // one to the map immediately.
    Object.keys(cfg.basemaps).forEach((name) => {
      const def = cfg.basemaps[name];
      const layer = L.tileLayer(def.url, {
        attribution: def.attribution,
        maxZoom: def.maxZoom || 19
      });
      baseLayers[name] = layer;
    });

    const defaultName = cfg.defaultBasemap in baseLayers
      ? cfg.defaultBasemap
      : Object.keys(baseLayers)[0];
    activeBaseLayer = baseLayers[defaultName];
    activeBaseLayer.addTo(map);

    // Fallback extent until the real Western Province boundary loads.
    const fb = cfg.fallbackBounds;
    map.fitBounds(fb);

    map.on("click", onMapClick);

    // Progressive POI reveal - see the function's own comment above.
    map.on("zoomend", triggerPOIVisibilityUpdate);
    map.on("moveend", triggerPOIVisibilityUpdate);

    return map;
  }

  // ------------------------------------------------------------------
  // LEAFLET PANES (cartographic layer ordering - UI/UX refinement)
  // ------------------------------------------------------------------
  // Leaflet's own built-in panes already put every marker-based layer
  // (markerPane: 600) above every vector overlay layer (overlayPane:
  // 400) automatically - that alone is what guarantees tourism markers
  // always sit above roads, with zero extra work. The three panes
  // created below exist only to make the order BETWEEN the vector
  // overlay layers themselves (water fill / roads / the Western
  // Province boundary outline) deliberate instead of accidental - by
  // default, same-pane Leaflet layers stack purely in the order they
  // happen to be added to the map, which here is just whatever order
  // config.js's dataFiles array happens to list them in.
  //   waterPane     (395) - polygon fill, sits lowest
  //   roadPane      (397) - the road hierarchy (layers.js), above water
  //   boundaryPane  (399) - the Western Province outline, drawn on top
  //                         of both so it always reads as a reference
  //                         line, never hidden under road/water fill
  // All three stay below Leaflet's own default overlayPane (400), so
  // nothing else needs to change. tourismPane/communityPane exist for
  // the same "deliberate, not accidental" reason between tourism
  // category markers and community-reported issue markers - both still
  // sit comfortably below Leaflet's own tooltipPane/popupPane (650/700),
  // so a popup or tooltip always draws above the marker it belongs to.
  function createPanes(leafletMap) {
    const panes = [
      { name: "waterPane", zIndex: 395 },
      { name: "roadPane", zIndex: 397 },
      { name: "boundaryPane", zIndex: 399 },
      { name: "tourismPane", zIndex: 601 },
      { name: "communityPane", zIndex: 602 }
    ];
    panes.forEach((p) => {
      leafletMap.createPane(p.name);
      leafletMap.getPane(p.name).style.zIndex = p.zIndex;
    });
  }

  function getMap() {
    return map;
  }

  function getBaseLayerNames() {
    return Object.keys(baseLayers);
  }

  function setBaseLayer(name) {
    if (!map || !baseLayers[name]) return;
    if (activeBaseLayer) map.removeLayer(activeBaseLayer);
    activeBaseLayer = baseLayers[name];
    activeBaseLayer.addTo(map);
  }

  // Called once the Western Province boundary (wp.geojson) is available
  // as a Leaflet layer, to replace the fallback rectangle extent.
  function fitToBoundsLayer(leafletLayer) {
    if (!map || !leafletLayer) return;
    try {
      const bounds = leafletLayer.getBounds();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    } catch (err) {
      console.warn("CoastConnect: could not fit map to Western Province boundary.", err);
    }
  }

  // ------------------------------------------------------------------
  // LOCATION PICKING (used by participation.js, section I and L)
  // ------------------------------------------------------------------
  function startLocationPicking(callback) {
    if (!map) return;
    pickingActive = true;
    pickingCallback = callback;
    map.getContainer().classList.add("coastconnect-picking-cursor");
  }

  function stopLocationPicking() {
    pickingActive = false;
    pickingCallback = null;
    if (map) map.getContainer().classList.remove("coastconnect-picking-cursor");
    if (pickingMarker) {
      map.removeLayer(pickingMarker);
      pickingMarker = null;
    }
  }

  function onMapClick(e) {
    if (!pickingActive) return;
    const { lat, lng } = e.latlng;

    if (pickingMarker) map.removeLayer(pickingMarker);
    pickingMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "coastconnect-pick-marker",
        html: '<i class="fa-solid fa-map-pin"></i>',
        iconSize: [30, 30],
        iconAnchor: [15, 28]
      })
    }).addTo(map);

    if (typeof pickingCallback === "function") {
      pickingCallback(lat, lng);
    }
  }

  return {
    init,
    getMap,
    getBaseLayerNames,
    setBaseLayer,
    fitToBoundsLayer,
    startLocationPicking,
    stopLocationPicking
  };
})();