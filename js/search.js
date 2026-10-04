/*
FILE PURPOSE: Name search across BOTH the informational GeoJSON layers and
  the current merged data of the 11 editable tourism categories.
WHAT THIS FILE DOES:
  - Builds a simple in-memory search index, made of:
      - every point feature from the 2 informational datasets marked
        "searchable: true" in config.js (Cities, Transport) - straight
        from their raw GeoJSON, unchanged from before;
      - every CURRENT record (existing + newly_added + updated) from
        each of the 11 editable tourism categories, via
        CommunityData.getCurrentCategoryRecords() - so a brand-new
        community place, or a renamed existing one, is searchable the
        moment it is added/edited, not just the original GIS data.
  - Returns matching results for a typed query (case-insensitive,
    "contains" match - good enough for a student GIS project).
  - Can zoom the map to a chosen result, open its popup (using
    LayerManager.focusPlace for an editable-category result, so it works
    correctly even inside a marker cluster - see participation.js's file
    header for why two different result shapes exist), and briefly
    highlight it.
  - rebuildIndex() lets community-data.js force an immediate rebuild
    right after a category's data changes, so the very next keystroke in
    the search box already reflects a just-added or just-edited place.
MAIN FUNCTIONS: Search.query, Search.goToResult, Search.rebuildIndex
DEPENDENCIES: Leaflet, config.js, utils.js, data-loader.js, layers.js,
  map.js, community-data.js (CommunityData.getCurrentCategoryRecords -
  used defensively, so search still works over informational data alone
  before PART 5's module has loaded anything).
--------------------------------------------------------------------------
*/

const Search = (function () {
  let index = null; // built lazily, after DataLoader has finished
  let highlightMarker = null;

  function buildIndex() {
    index = [];
    const loaded = DataLoader.getAllLoaded();

    APP_CONFIG.dataFiles
      .filter((def) => def.searchable)
      .forEach((def) => {
        const isEditable = !!APP_CONFIG.editableCategories[def.id];

        if (isEditable && typeof CommunityData !== "undefined" && CommunityData.getCurrentCategoryRecords) {
          CommunityData.getCurrentCategoryRecords(def.id).forEach((place) => {
            index.push({
              name: place.name,
              datasetId: def.id,
              datasetName: def.name,
              icon: def.icon,
              lat: place.lat, lng: place.lng,
              placeId: place.placeId
            });
          });
          return;
        }

        const geojson = loaded[def.id];
        if (!geojson) return;
        geojson.features.forEach((feature) => {
          if (!feature.geometry || feature.geometry.type !== "Point") return;
          const [lng, lat] = feature.geometry.coordinates;
          if (!isValidCoordinate(lat, lng)) return;

          index.push({
            name: getPlaceName(feature.properties),
            datasetId: def.id,
            datasetName: def.name,
            icon: def.icon,
            lat, lng,
            feature,
            def
          });
        });
      });
  }

  function rebuildIndex() {
    buildIndex();
  }

  function query(text) {
    if (!index) buildIndex();
    const q = (text || "").trim().toLowerCase();
    if (q.length === 0) return [];

    return index
      .filter((item) => item.name && item.name.toLowerCase().includes(q))
      .slice(0, APP_CONFIG.behaviour.maxSearchResults);
  }

  // Zooms to a search result, makes sure its layer is visible, and opens
  // the right kind of popup for it.
  function goToResult(result) {
    const map = MapCore.getMap();
    if (!map) return;

    LayerManager.setPanelVisible(result.datasetId, true);
    map.setView([result.lat, result.lng], 16, { animate: true });
    showHighlightPulse(result.lat, result.lng);

    if (result.placeId) {
      // An editable-category record - let LayerManager find the right
      // marker (handles marker clustering correctly) and open its popup.
      if (typeof LayerManager.focusPlace === "function") {
        LayerManager.focusPlace(result.datasetId, result.placeId);
      }
      return;
    }

    // An informational-layer record - same raw-GeoJSON popup as before.
    L.popup({ maxWidth: 280 })
      .setLatLng([result.lat, result.lng])
      .setContent(() => LayerManager.buildExistingPlacePopup(result.def, result.feature, [result.lat, result.lng]))
      .openOn(map);
  }

  function showHighlightPulse(lat, lng) {
    const map = MapCore.getMap();
    if (!map) return;
    if (highlightMarker) map.removeLayer(highlightMarker);
    highlightMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "coastconnect-search-highlight",
        html: '<span class="coastconnect-pulse"></span>',
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      }),
      interactive: false
    }).addTo(map);

    setTimeout(() => {
      if (highlightMarker) {
        map.removeLayer(highlightMarker);
        highlightMarker = null;
      }
    }, 4000);
  }

  function resetIndex() {
    index = null;
  }

  return { query, goToResult, rebuildIndex, resetIndex };
})();