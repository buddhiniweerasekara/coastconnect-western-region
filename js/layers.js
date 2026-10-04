/*
FILE PURPOSE: Turns the loaded GeoJSON datasets AND the current merged
  community data into Leaflet map layers - this is where "existing GIS
  data" and "community contributions" actually become the SAME layer,
  per tourism category.
WHAT THIS FILE DOES:
  - For the 6 non-editable datasets (Western Province boundary, Cities,
    Transport, Water, Railway, Roads): builds a Leaflet layer straight
    from their GeoJSON, exactly as before - informational only, no
    Add/Edit anything.
  - For the 11 EDITABLE tourism categories: builds a Leaflet layer from
    CommunityData.getCurrentCategoryRecords(categoryId) instead of the
    raw GeoJSON - that is already the correctly merged "existing +
    newly_added + updated" picture (see community-data.js, PART 5), so
    there is exactly ONE marker per place_id and it always shows the
    latest information. There is no separate "Community Added Places"
    layer: a newly-added restaurant appears inside the SAME Restaurants
    layer as every original one.
  - Builds ONE popup type for all 11 editable categories
    (buildCategoryPlacePopup), driven entirely by
    APP_CONFIG.editableCategories[categoryId].fields - this is the same
    "one function instead of eleven" idea place-form.js uses for the
    form, applied to the popup. It shows a status badge ("Community
    Added" / "Community Updated" / nothing for an untouched original
    place), an unverified disclaimer for community-sourced information,
    and three action buttons: Edit Information, Give Feedback, Report an
    Issue. "Suggest an Update" is retired - editing now happens through
    Edit Information instead.
  - Keeps the small internal registry so the Layers panel (ui.js), the
    category Filters, and the Legend can show/hide layers without
    duplicating logic - unchanged contract from before.
  - Exposes registerExternalGroup() so community-data.js can plug the
    one remaining non-category layer (community-reported Issues) into
    the same registry/legend system.
  - Exposes refreshCategoryLayer(categoryId) / refreshAllCategoryLayers()
    so a successful Add/Edit submission (place-form.js, via
    community-data.js) can redraw just that one category's markers
    in place, and focusPlace(categoryId, placeId) so search results and
    Explore cards can open the right marker's popup even when it is
    inside a marker cluster OR currently hidden by the progressive zoom
    reveal / outside the current viewport (see focusPlace()'s own
    comment - it force-reveals its target before searching for it).
  - IMPORTANT FIX vs the old file: registerLayer() now removes any
    PREVIOUS layer already registered under the same id from the map
    before adding the replacement, and carries over its current
    panelVisible/filterVisible state. Without this, calling
    refreshCategoryLayer()/registerExternalGroup() a second time (which
    now happens routinely, every time someone adds/edits a place or
    reports an issue) would leave the old markers on the map forever,
    silently doubling up every time.
  - ROAD CARTOGRAPHY (cartographic + UI/UX refinement): the "roads"
    dataset is no longer drawn as one thick uniform line. buildRoadLayer()
    below classifies every road feature into one of 4 tiers (major /
    medium / local / minor - see APP_CONFIG.roadHierarchy in config.js),
    builds one Leaflet GeoJSON layer per tier ONCE, and a single
    map "zoomend" listener adds/removes whichever tiers belong at the
    current zoom to/from a small shell L.layerGroup - the one Leaflet
    layer actually registered for "roads". The roads GeoJSON is still
    only ever loaded once (data-loader.js, unchanged); nothing here
    re-fetches it or rebuilds the tier layers on zoom, only membership
    of the shell group changes.
  - CLUSTERING RULE (UI/UX refinement): marker clustering for the 11
    editable tourism categories switches on only when EXACTLY ONE
    editable category is currently visible (Layers panel checkbox AND
    category Filter both allowing it) - see countVisibleEditableCategories()
    and refreshCategoryClusteringIfNeeded(). With zero or two-plus
    categories visible at once, every marker is shown individually so
    overlapping categories never hide inside a shared, ambiguous cluster
    bubble.
  - PROGRESSIVE POI ZOOM REVEAL (cartographic/UI-UX refinement, latest):
    each editable category now has its own minimum zoom level
    (APP_CONFIG.poiZoomLevels), and even once a category is zoom-
    eligible, only the markers currently inside the visible map extent
    (map.getBounds()) are actually added to its Leaflet group. This is
    implemented WITHOUT ever re-fetching data or rebuilding markers on
    pan/zoom: buildCategoryLayer() now builds every marker for a
    category ONCE and keeps the full array in categoryMarkerStore[id],
    returning an initially EMPTY shell group (reusing the exact same
    "shell group" pattern buildRoadLayer() already uses for the road
    tiers). updateCategoryMarkerMembership(id) - called once right after
    the category is registered, and then repeatedly from
    updatePOIVisibilityForViewport() on every map "zoomend"/"moveend"
    (bound in map.js, debounced) - adds/removes individual ALREADY-BUILT
    marker objects to/from that shell based on current zoom/bounds. This
    is a completely separate, independent axis from the Layers-panel/
    Filter visibility (which still only controls whether the shell
    itself is on the map at all, via the unchanged recomputeVisibility())
    - combining the two gives exactly: visible = zoom-eligible AND
    inside current bounds AND panel-visible AND filter-visible.
MAIN FUNCTIONS:
  LayerManager.buildAll, LayerManager.getRegistry, LayerManager.setPanelVisible,
  LayerManager.applyCategoryFilter, LayerManager.getVisiblePlaceCount,
  LayerManager.registerExternalGroup, LayerManager.buildExistingPlacePopup,
  LayerManager.refreshCategoryLayer, LayerManager.refreshAllCategoryLayers,
  LayerManager.focusPlace, LayerManager.updatePOIVisibilityForViewport
DEPENDENCIES: Leaflet, Leaflet.markercluster (global L.markerClusterGroup),
  config.js, utils.js, data-loader.js, map.js, community-data.js
  (CommunityData.getCurrentCategoryRecords - used defensively so this
  file still works, showing only original GIS data, before PART 5's
  module has loaded anything), place-form.js (PlaceForm.startEditFlow),
  feedback.js (Feedback.openFeedbackForm), participation.js
  (Participation.openReportIssueForm).
--------------------------------------------------------------------------
*/

const LayerManager = (function () {
  let map = null;

  // ------------------------------------------------------------------
  // ROAD HIERARCHY STATE (see buildRoadLayer() below). Module-level so
  // the single zoomend listener (bound once) can reach the tier layers
  // and the shell group they live inside without rebuilding anything.
  // ------------------------------------------------------------------
  let roadTierLayers = null;   // { major: L.geoJSON, medium: ..., local: ..., minor: ... }
  let roadShellGroup = null;   // the one L.layerGroup actually registered as "roads"
  let roadZoomHandlerBound = false;

  // CLUSTERING RULE STATE (UI/UX refinement) - see
  // countVisibleEditableCategories()/refreshCategoryClusteringIfNeeded()
  // below. null on startup so the very first check always runs once,
  // regardless of whether it resolves to true or false.
  let lastClusterDecision = null;

  // PROGRESSIVE POI ZOOM REVEAL STATE - categoryMarkerStore[categoryId]
  // holds the FULL array of already-built Leaflet marker objects for
  // that category (every current record, regardless of zoom/bounds).
  // These marker objects are created once per build/refresh and then
  // only ever added to or removed from their category's shell group -
  // never recreated on pan/zoom. See updateCategoryMarkerMembership().
  const categoryMarkerStore = {};

  // registry[id] = {
  //   id, name, group, icon, color, geometryType, filterTags,
  //   layer,            // the actual Leaflet layer/group currently on the map
  //   source: "informational" | "editable" | "issues",
  //   panelVisible: bool,   // Layers panel checkbox state
  //   filterVisible: bool   // category Filter state
  // }
  const registry = {};
  let activeFilterTags = []; // empty array = no filter = show everything

  function buildAll(leafletMap) {
    map = leafletMap;
    const loaded = DataLoader.getAllLoaded();

    APP_CONFIG.dataFiles.forEach((def) => {
      const isEditable = !!APP_CONFIG.editableCategories[def.id];
      let leafletLayer;

      if (def.geometryType === "boundary") {
        const geojson = loaded[def.id];
        if (!geojson) return;
        leafletLayer = buildBoundaryLayer(def, geojson);
        MapCore.fitToBoundsLayer(leafletLayer);
      } else if (def.geometryType === "line" && def.id === "roads") {
        // Roads get the scale-dependent hierarchy (see buildRoadLayer
        // below) instead of the single-style line every other line
        // dataset (railway) still uses.
        const geojson = loaded[def.id];
        if (!geojson) return;
        leafletLayer = buildRoadLayer(def, geojson);
      } else if (def.geometryType === "line") {
        const geojson = loaded[def.id];
        if (!geojson) return;
        leafletLayer = buildLineLayer(def, geojson);
      } else if (def.geometryType === "polygon") {
        const geojson = loaded[def.id];
        if (!geojson) return;
        leafletLayer = buildPolygonLayer(def, geojson);
      } else if (isEditable) {
        // Community data has not loaded yet the first time this runs, so
        // this initially shows "existing" places only. ui.js calls
        // LayerManager.refreshAllCategoryLayers() right after
        // CommunityData.loadAll() resolves, which redraws this layer
        // with the full merged picture (and also gives the clustering
        // rule a final, consistent pass once every category is
        // registered).
        leafletLayer = buildCategoryLayer(def);
      } else {
        const geojson = loaded[def.id];
        if (!geojson) return;
        leafletLayer = buildInformationalPointLayer(def, geojson);
      }

      registerLayer({
        id: def.id,
        name: def.name,
        group: def.group,
        icon: def.icon,
        color: def.color,
        geometryType: def.geometryType,
        filterTags: def.filterTags || [],
        layer: leafletLayer,
        source: isEditable ? "editable" : "informational"
      });

      map.addLayer(leafletLayer);

      // PROGRESSIVE POI ZOOM REVEAL: the shell just added to the map
      // above is EMPTY for an editable category (buildCategoryLayer()
      // no longer auto-populates it - see that function's comment). Now
      // that registerLayer() has given it a registry entry (so its
      // panelVisible/filterVisible/layer fields all exist), populate it
      // correctly for the CURRENT zoom/bounds right away, instead of
      // waiting for the first zoomend/moveend.
      if (isEditable) updateCategoryMarkerMembership(def.id);
    });

    return registry;
  }

  // Registers (or REPLACES) one layer in the registry. If a layer with
  // this id already exists, its old Leaflet layer is removed from the
  // map first and its panelVisible/filterVisible state is carried over,
  // so refreshing a category or the Issues layer never leaves stale
  // duplicate markers behind and never silently re-shows a layer the
  // user had turned off.
  function registerLayer(entry) {
    const existing = registry[entry.id];
    if (existing && map && map.hasLayer(existing.layer)) {
      map.removeLayer(existing.layer);
    }
    entry.panelVisible = existing ? existing.panelVisible : (entry.addToMapByDefault !== false);
    entry.filterVisible = existing ? existing.filterVisible : true;
    registry[entry.id] = entry;
  }

  // Used by community-data.js so the Issues layer shares the same Layers
  // panel + legend + visibility system as every other layer.
  function registerExternalGroup(entry) {
    registerLayer(entry);
    const finalEntry = registry[entry.id];
    if (finalEntry.panelVisible && finalEntry.filterVisible && map) {
      map.addLayer(finalEntry.layer);
    }
    return finalEntry;
  }

  function getRegistry() {
    return registry;
  }

  // ------------------------------------------------------------------
  // BUILDING EACH GEOMETRY TYPE
  // ------------------------------------------------------------------
  function buildBoundaryLayer(def, geojson) {
    return L.geoJSON(geojson, {
      pane: "boundaryPane", // see map.js's createPanes() for the ordering rationale
      style: { color: def.color || "#334155", weight: 2, fill: false, dashArray: "6 4" }
    });
  }

  // Railway only, now that roads has its own buildRoadLayer() below -
  // one line type, one style, unchanged from before.
  function buildLineLayer(def, geojson) {
    return L.geoJSON(geojson, {
      style: {
        color: def.color || "#525252",
        weight: 2,
        opacity: 0.8,
        dashArray: "1 6",
        lineCap: "round"
      },
      onEachFeature: (feature, layer) => {
        const name = getPlaceName(feature.properties);
        if (name) layer.bindTooltip(escapeHTML(name));
      }
    });
  }

  // =====================================================================
  // ROAD HIERARCHY
  // Major / medium / local / minor - built ONCE from the already-loaded
  // roads.geojson, then shown/hidden by zoom level without ever
  // re-fetching or rebuilding the underlying Leaflet layers.
  // =====================================================================

  // Looks at a road feature's properties and returns the first road-class
  // VALUE it finds, trying every candidate field name in
  // APP_CONFIG.roadHierarchy.classFieldCandidates in order (section:
  // ROAD HIERARCHY). Different GIS exports name this column differently
  // ("highway", "fclass", "ROAD_CLASS", ...) so we do not assume one
  // name - we try the whole list and use whichever is actually present.
  // Returns "" if the feature has none of the candidate fields at all.
  function getRoadClassValue(properties) {
    const candidates = APP_CONFIG.roadHierarchy.classFieldCandidates;
    for (let i = 0; i < candidates.length; i++) {
      const key = candidates[i];
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        const value = properties[key];
        if (value !== null && value !== undefined && String(value).trim() !== "") {
          return String(value).trim().toLowerCase();
        }
      }
    }
    return "";
  }

  // Maps one road feature to one of the 4 tiers defined in
  // APP_CONFIG.roadHierarchy.tiers. A value that does not match any
  // tier's "classes" list (an unexpected class, or no class property at
  // all) falls back to the "local" tier - a deliberate middle ground so
  // an unrecognised road still shows up at a reasonable (not too early,
  // not too late) zoom instead of disappearing or cluttering the
  // regional view.
  function classifyRoadFeature(properties) {
    const rawValue = getRoadClassValue(properties);
    const tiers = APP_CONFIG.roadHierarchy.tiers;
    if (rawValue) {
      const matchedTier = tiers.find((tier) =>
        tier.classes.some((className) => className.toLowerCase() === rawValue)
      );
      if (matchedTier) return matchedTier.key;
    }
    const fallbackTier = tiers.find((tier) => tier.key === "local");
    return fallbackTier ? fallbackTier.key : tiers[tiers.length - 1].key;
  }

  // Builds the 4 tier Leaflet layers ONCE (partitioning roads.geojson's
  // features by classifyRoadFeature()), and returns a single shell
  // L.layerGroup - THIS is the one Leaflet layer registered under the
  // "roads" id, so the existing Layers-panel on/off checkbox and the
  // existing registerLayer()/recomputeVisibility() machinery (unchanged)
  // keep working exactly as they always have, with no special-casing.
  function buildRoadLayer(def, geojson) {
    const tiers = APP_CONFIG.roadHierarchy.tiers;

    // Partition features into one bucket per tier, once.
    const buckets = {};
    tiers.forEach((tier) => { buckets[tier.key] = []; });
    geojson.features.forEach((feature) => {
      if (!feature.geometry) return;
      const tierKey = classifyRoadFeature(feature.properties || {});
      (buckets[tierKey] || buckets.local).push(feature);
    });

    roadTierLayers = {};
    tiers.forEach((tier) => {
      roadTierLayers[tier.key] = L.geoJSON(
        { type: "FeatureCollection", features: buckets[tier.key] },
        {
          pane: "roadPane", // see map.js createPanes() - sits below boundary/tourism
          style: () => ({
            color: tier.style.color,
            weight: tier.style.weight,
            opacity: tier.style.opacity,
            lineCap: "round",
            lineJoin: "round"
          }),
          // Subtle name tooltip only, never a full popup, and never at
          // the regional zoom - the basemap already carries its own
          // road labels, so we would only be duplicating clutter.
          onEachFeature: (feature, layer) => {
            const name = getPlaceName(feature.properties || {});
            if (name && name !== "Unnamed place") {
              layer.bindTooltip(escapeHTML(name), { sticky: true, className: "cc-road-tooltip" });
            }
          }
        }
      );
    });

    roadShellGroup = L.layerGroup();
    updateRoadTiersForZoom(); // populate the shell for whatever zoom we're at right now

    // ===================================================================
    // SCALE-DEPENDENT ROAD VISIBILITY
    // One zoomend listener, bound once, for the lifetime of the map.
    // updateRoadTiersForZoom() always runs on every zoomend, REGARDLESS
    // of whether the user currently has the Roads layer switched on -
    // that is deliberate, not an oversight: updating which tiers sit
    // inside roadShellGroup has no visual effect while the shell group
    // itself is not on the map (recomputeVisibility()/setPanelVisible(),
    // both unchanged, are what actually add/remove the shell group from
    // the map based on the user's own checkbox). So:
    //   - Roads OFF, user zooms: tier membership still updates quietly,
    //     but nothing is visible - zooming can never turn Roads back on.
    //   - Roads ON, user zooms: the visible tiers update immediately.
    //   - Roads OFF -> user zooms -> Roads ON: the shell group already
    //     holds the correct tiers for the CURRENT zoom the moment it is
    //     added back to the map, with no extra step needed.
    // ===================================================================
    if (!roadZoomHandlerBound && map) {
      map.on("zoomend", updateRoadTiersForZoom);
      roadZoomHandlerBound = true;
    }

    return roadShellGroup;
  }

  // Adds/removes each tier layer from roadShellGroup based on the
  // current map zoom vs that tier's minZoom (APP_CONFIG.roadHierarchy).
  // Cheap: no GeoJSON parsing, no new Leaflet layers - just Leaflet's
  // own addLayer/removeLayer on layers that already exist in memory.
  function updateRoadTiersForZoom() {
    if (!map || !roadTierLayers || !roadShellGroup) return;
    const zoom = map.getZoom();
    APP_CONFIG.roadHierarchy.tiers.forEach((tier) => {
      const tierLayer = roadTierLayers[tier.key];
      const shouldShow = zoom >= tier.minZoom;
      const isCurrentlyIn = roadShellGroup.hasLayer(tierLayer);
      if (shouldShow && !isCurrentlyIn) roadShellGroup.addLayer(tierLayer);
      else if (!shouldShow && isCurrentlyIn) roadShellGroup.removeLayer(tierLayer);
    });
  }

  function buildPolygonLayer(def, geojson) {
    return L.geoJSON(geojson, {
      pane: "waterPane", // see map.js's createPanes() for the ordering rationale
      style: { color: def.color || "#0ea5e9", weight: 1, fillColor: def.color || "#0ea5e9", fillOpacity: 0.25 },
      onEachFeature: (feature, layer) => {
        const name = getPlaceName(feature.properties);
        if (name) layer.bindTooltip(escapeHTML(name));
      }
    });
  }

  // The 2 remaining informational POINT datasets (Cities, Transport).
  // UNCHANGED by the progressive POI reveal feature - Cities is
  // deliberately kept OUTSIDE that gating system entirely (see
  // APP_CONFIG.poiZoomLevels's comment) so it stays visible at the
  // regional zoom level as the primary reference layer, exactly as
  // required. Transport (bus stops etc.) is informational, not one of
  // the 11 editable tourism categories, so it is not in scope for the
  // zoom-tiered reveal either - it keeps its existing always-on
  // behaviour, same as before this feature existed.
  function buildInformationalPointLayer(def, geojson) {
    const group = makePointGroup("tourismPane");

    geojson.features.forEach((feature) => {
      if (!feature.geometry || feature.geometry.type !== "Point") return;
      const [lng, lat] = feature.geometry.coordinates;
      if (!isValidCoordinate(lat, lng)) {
        console.warn("CoastConnect: skipped a feature in " + def.name + " with invalid coordinates.");
        return;
      }

      const marker = L.marker([lat, lng], { icon: buildDivIcon(def), pane: "tourismPane" });
      marker.bindPopup(() => buildExistingPlacePopup(def, feature, [lat, lng]), { maxWidth: 280 });
      group.addLayer(marker);
    });

    return group;
  }

  // The 11 EDITABLE tourism categories - built from the current MERGED
  // data (existing + newly_added + updated), never the raw GeoJSON.
  //
  // PROGRESSIVE POI ZOOM REVEAL: unlike before, this function no longer
  // adds every marker straight into the returned group. It builds every
  // L.marker ONCE, stores the full array in categoryMarkerStore[def.id]
  // (so later pan/zoom events can add/remove these SAME marker objects
  // without ever rebuilding them), and returns an EMPTY shell group.
  // The caller (buildAll() or refreshCategoryLayer()) is responsible for
  // calling updateCategoryMarkerMembership(def.id) immediately after
  // registering this shell, so it is correctly populated for whatever
  // zoom/bounds are current right away rather than appearing empty until
  // the next pan/zoom.
  function buildCategoryLayer(def) {
    // ===================================================================
    // CLUSTERING RULE (UI/UX refinement)
    // Marker clusters (the "636", "172" style number bubbles) are only
    // useful when ONE editable tourism category is on screen - with two
    // or more categories visible at once, a shared cluster bubble would
    // mix different kinds of places together and hide which category
    // they actually belong to, so instead every marker is shown
    // individually. "Visible" here means the SAME combined check
    // recomputeVisibility() already uses: the Layers panel checkbox AND
    // the category Filter both have to currently allow it.
    // ===================================================================
    const shouldCluster = countVisibleEditableCategories() === 1;
    const shell = makePointGroup("tourismPane", shouldCluster);
    const records = (typeof CommunityData !== "undefined" && CommunityData.getCurrentCategoryRecords)
      ? CommunityData.getCurrentCategoryRecords(def.id)
      : [];

    const markers = [];
    records.forEach((place) => {
      if (!isValidCoordinate(place.lat, place.lng)) return;
      const marker = L.marker([place.lat, place.lng], { icon: buildDivIcon(def), pane: "tourismPane" });
      marker.coastconnectPlaceId = place.placeId; // tagged so focusPlace() can find it again
      marker.bindPopup(() => buildCategoryPlacePopup(def, place), { maxWidth: 300 });
      markers.push(marker);
    });

    categoryMarkerStore[def.id] = markers;

    return shell; // intentionally empty - see updateCategoryMarkerMembership()
  }

  // How many EDITABLE tourism categories are currently actually visible
  // on the map (panel checkbox ON and not excluded by the active
  // Filter). Non-editable layers (Roads, Water, Cities, ...) are never
  // counted - this is specifically about the 11 tourism categories the
  // clustering rule above cares about. Deliberately NOT aware of the
  // zoom/bounds gate below - see the note inside
  // refreshCategoryClusteringIfNeeded() for why those two systems are
  // kept independent.
  function countVisibleEditableCategories() {
    let count = 0;
    Object.keys(registry).forEach((id) => {
      const entry = registry[id];
      if (entry.source === "editable" && entry.panelVisible && entry.filterVisible) count++;
    });
    return count;
  }

  // Called after ANY change that could affect which editable categories
  // are visible (a Layers panel checkbox, or the Filter buttons). Only
  // actually rebuilds anything if the cluster/no-cluster DECISION
  // changed (lastClusterDecision) - toggling two different categories
  // that are both already in "2+ visible, no clustering" territory does
  // nothing extra, it does not rebuild on every single click.
  // refreshAllCategoryLayers() (unchanged, already existed) rebuilds
  // every editable category's layer from the current merged data, which
  // is also how buildCategoryLayer() above gets a fresh chance to
  // re-evaluate countVisibleEditableCategories() for each one.
  //
  // NOTE on NOT coupling this to the zoom/extent gate: this count is
  // intentionally based on Layers-panel/Filter state only, not on
  // "how many categories currently have at least one marker showing at
  // this zoom". Coupling it to zoom would mean a rebuild (expensive -
  // re-creates marker objects) on every zoomend/moveend, which defeats
  // the whole point of the shell-group/incremental-membership design.
  // The practical effect: in the common case of "every category enabled,
  // no filter active", clustering stays off project-wide regardless of
  // zoom, even during the early zoom tiers where only 4 categories
  // (Beaches/Heritage/Parks/Museums) actually have visible markers. If
  // that turns out to feel wrong once you test it, it is a one-line
  // change to revisit - flagging it here rather than guessing silently.
  function refreshCategoryClusteringIfNeeded() {
    const desiredCluster = countVisibleEditableCategories() === 1;
    if (desiredCluster === lastClusterDecision) return;
    lastClusterDecision = desiredCluster;
    refreshAllCategoryLayers();
  }

  // ===================================================================
  // PROGRESSIVE POI ZOOM REVEAL
  // ===================================================================

  // Reads APP_CONFIG.poiZoomLevels for one category id. Falls back to
  // 13 (the mid-tier value) for any category id that is not explicitly
  // listed there, so a future new category never silently crashes this
  // function - it just reveals a bit later than ideal until someone adds
  // a proper entry for it.
  function getCategoryMinZoom(categoryId) {
    const levels = APP_CONFIG.poiZoomLevels || {};
    return (typeof levels[categoryId] === "number") ? levels[categoryId] : 13;
  }

  // The actual "should this one marker currently be on the map" check,
  // applied to every stored marker of ONE category. This only ever
  // adds/removes markers that ALREADY EXIST (from categoryMarkerStore) -
  // it never creates or destroys a Leaflet marker object. Deliberately
  // independent of panelVisible/filterVisible: those control whether the
  // category's SHELL GROUP is on the map at all (recomputeVisibility(),
  // unchanged); this function only controls membership WITHIN that
  // shell. If the shell itself is not on the map, changing its
  // membership here has no visible effect - exactly like the existing
  // road-tier shell pattern.
  function updateCategoryMarkerMembership(categoryId) {
    if (!map) return;
    const entry = registry[categoryId];
    const markers = categoryMarkerStore[categoryId];
    if (!entry || !markers) return;

    const shell = entry.layer;
    const minZoom = getCategoryMinZoom(categoryId);
    const zoom = map.getZoom();
    const bounds = map.getBounds();

    markers.forEach((marker) => {
      const shouldBeIn = (zoom >= minZoom) && bounds.contains(marker.getLatLng());
      const isCurrentlyIn = shell.hasLayer(marker);
      if (shouldBeIn && !isCurrentlyIn) shell.addLayer(marker);
      else if (!shouldBeIn && isCurrentlyIn) shell.removeLayer(marker);
    });
  }

  // Called from map.js on every (debounced) "zoomend"/"moveend". Re-runs
  // the membership check above for every editable category in one pass.
  // Cheap even for a couple thousand markers total - no GeoJSON parsing,
  // no network, no new objects, just bounds.contains() checks against
  // markers already sitting in memory.
  function updatePOIVisibilityForViewport() {
    if (!map) return;
    APP_CONFIG.editableCategoryOrder.forEach(updateCategoryMarkerMembership);
  }

  // paneName is best-effort (see the long comment this function used to
  // carry - unchanged reasoning). forceCluster is new: when a caller
  // passes an explicit true/false, that decision wins outright; when it
  // is omitted (informational layers - Cities, Transport - still call
  // this with just paneName), the OLD static config.js setting is used,
  // completely unchanged from before. Only buildCategoryLayer() above
  // ever passes forceCluster now - see the CLUSTERING RULE comment there.
  // Either way, tourism/community markers already sit above every road/
  // water/boundary vector layer for free, because Leaflet's own default
  // markerPane (600) outranks every custom pane created in map.js
  // (395-399) - this pane assignment is only for a deliberate, visible
  // ordering BETWEEN tourism and community markers, not a requirement
  // for roads to sit below tourism attractions.
  function makePointGroup(paneName, forceCluster) {
    const shouldCluster = (typeof forceCluster === "boolean")
      ? forceCluster
      : APP_CONFIG.behaviour.clusterPointLayers;
    return shouldCluster
      ? L.markerClusterGroup({ disableClusteringAtZoom: APP_CONFIG.behaviour.clusterDisableAtZoom, pane: paneName })
      : L.layerGroup();
  }

  function buildDivIcon(def) {
    return L.divIcon({
      className: "coastconnect-marker coastconnect-marker-existing",
      html:
        '<span class="coastconnect-marker-dot" style="background:' + (def.color || "#334155") + '">' +
        '<i class="fa-solid ' + def.icon + '"></i></span>',
      iconSize: [30, 30],
      iconAnchor: [15, 28],
      popupAnchor: [0, -26]
    });
  }

  // ------------------------------------------------------------------
  // POPUP: the 6 informational datasets (unchanged apart from dropping
  // the retired "Suggest an Update" button and the new Feedback contract)
  // ------------------------------------------------------------------
  function buildExistingPlacePopup(def, feature, latlng) {
    const props = feature.properties || {};
    const name = getPlaceName(props);
    const category = getPlaceCategory(props) || def.name;
    const description = getPlaceDescription(props);

    const openingHours = getFirstAvailableProperty(props, APP_CONFIG.attributeFieldCandidates.openingHours);
    const contact = getFirstAvailableProperty(props, APP_CONFIG.attributeFieldCandidates.contact);
    const accessibility = getFirstAvailableProperty(props, APP_CONFIG.attributeFieldCandidates.accessibility);

    const wrapper = document.createElement("div");
    wrapper.className = "cc-popup";

    wrapper.innerHTML =
      '<div class="cc-popup-source cc-source-existing"><i class="fa-solid fa-database"></i> Existing GIS Data</div>' +
      '<h3 class="cc-popup-title">' + escapeHTML(name) + "</h3>" +
      '<div class="cc-popup-category">' + escapeHTML(category) + "</div>" +
      '<dl class="cc-popup-fields">' +
        popupFieldHTML("Description", description) +
        popupFieldHTML("Opening hours", openingHours) +
        popupFieldHTML("Contact", contact) +
        popupFieldHTML("Accessibility", accessibility) +
      "</dl>" +
      '<div class="cc-popup-actions"></div>';

    const actions = wrapper.querySelector(".cc-popup-actions");

    actions.appendChild(makePopupButton("fa-comment-dots", "Give Feedback", "", () => {
      Feedback.openFeedbackForm({ placeName: name, placeId: "", categoryId: def.id, lat: latlng[0], lng: latlng[1] });
    }));
    actions.appendChild(makePopupButton("fa-triangle-exclamation", "Report an Issue", "", () => {
      Participation.openReportIssueForm({ relatedPlaceName: name, lat: latlng[0], lng: latlng[1] });
    }));

    return wrapper;
  }

  // ------------------------------------------------------------------
  // POPUP: the 11 editable tourism categories - ONE function for all of
  // them, driven by APP_CONFIG.editableCategories[categoryId].fields.
  // ------------------------------------------------------------------
  function buildCategoryPlacePopup(def, place) {
    const schema = APP_CONFIG.editableCategories[def.id];

    const sourceLine = (place.status === "existing")
      ? '<div class="cc-popup-source cc-source-existing"><i class="fa-solid fa-database"></i> Existing GIS Data</div>'
      : '<div class="cc-popup-source cc-source-community"><i class="fa-solid fa-users"></i> Community Contribution</div>';

    const statusBadge =
      place.status === "newly_added" ? ' <span class="cc-badge cc-badge-added">Community Added</span>' :
      place.status === "updated" ? ' <span class="cc-badge cc-badge-updated">Community Updated</span>' : "";

    let fieldsHTML = "";
    (schema.fields || []).forEach((fieldDef) => {
      const value = place.fields ? place.fields[fieldDef.key] : "";
      fieldsHTML += popupFieldHTML(fieldDef.label, value);
    });

    const wrapper = document.createElement("div");
    wrapper.className = "cc-popup";
    wrapper.innerHTML =
      sourceLine +
      '<h3 class="cc-popup-title">' + escapeHTML(place.name) + statusBadge + "</h3>" +
      '<div class="cc-popup-category">' + escapeHTML(schema.label) + "</div>" +
      (place.address ? '<div class="cc-popup-address"><i class="fa-solid fa-location-dot"></i> ' + escapeHTML(place.address) + "</div>" : "") +
      (place.website ? '<a class="cc-popup-video-link" target="_blank" rel="noopener" href="' + escapeHTML(place.website) + '"><i class="fa-solid fa-globe"></i> Visit Website</a>' : "") +
      (place.description ? '<p class="cc-popup-desc">' + escapeHTML(place.description) + "</p>" : "") +
      (fieldsHTML ? '<dl class="cc-popup-fields">' + fieldsHTML + "</dl>" : "") +
      (isValidImageURL(place.photoUrl) ? '<img class="cc-popup-photo" src="' + escapeHTML(place.photoUrl) + '" alt="Photo of ' + escapeHTML(place.name) + '" onerror="this.remove()">' : "") +
      (place.status !== "existing"
        ? '<p class="cc-popup-disclaimer">This information was contributed by the community and may not have been independently verified.</p>'
        : "") +
      '<div class="cc-popup-actions"></div>';

    const actions = wrapper.querySelector(".cc-popup-actions");

    actions.appendChild(makePopupButton("fa-pen-to-square", "Edit Information", "cc-popup-btn-edit", () => {
      PlaceForm.startEditFlow({
        categoryId: def.id,
        placeId: place.placeId,
        lat: place.lat,
        lng: place.lng,
        values: Object.assign(
          { name: place.name, address: place.address, website: place.website, desc: place.description },
          place.fields || {}
        ),
        photoURL: place.photoUrl
      });
    }));
    actions.appendChild(makePopupButton("fa-comment-dots", "Give Feedback", "", () => {
      Feedback.openFeedbackForm({ placeName: place.name, placeId: place.placeId, categoryId: def.id, lat: place.lat, lng: place.lng });
    }));
    actions.appendChild(makePopupButton("fa-triangle-exclamation", "Report an Issue", "", () => {
      Participation.openReportIssueForm({ relatedPlaceName: place.name, lat: place.lat, lng: place.lng });
    }));

    return wrapper;
  }

  function popupFieldHTML(label, value) {
    const safeValue = (value === null || value === undefined || String(value).trim() === "")
      ? "Information not currently available."
      : escapeHTML(value);
    return "<dt>" + escapeHTML(label) + "</dt><dd>" + safeValue + "</dd>";
  }

  function makePopupButton(iconClass, label, extraClass, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cc-popup-btn" + (extraClass ? " " + extraClass : "");
    btn.innerHTML = '<i class="fa-solid ' + iconClass + '"></i> ' + escapeHTML(label);
    btn.addEventListener("click", onClick);
    return btn;
  }

  // ------------------------------------------------------------------
  // REFRESHING A CATEGORY / FOCUSING ONE PLACE (used by community-data.js
  // after a successful submission, and by search.js / ui.js's Explore
  // cards + Near Me results)
  // ------------------------------------------------------------------
  function refreshCategoryLayer(categoryId) {
    const def = APP_CONFIG.dataFiles.find((d) => d.id === categoryId);
    if (!def || !map) return;
    const newLayer = buildCategoryLayer(def); // rebuilds categoryMarkerStore[categoryId] too
    registerLayer({
      id: def.id, name: def.name, group: def.group, icon: def.icon, color: def.color,
      geometryType: def.geometryType, filterTags: def.filterTags || [],
      layer: newLayer, source: "editable"
    });
    const entry = registry[categoryId];
    if (entry.panelVisible && entry.filterVisible) map.addLayer(entry.layer);
    // PROGRESSIVE POI ZOOM REVEAL: the freshly rebuilt shell above is
    // empty (same reason as in buildAll()) - populate it immediately for
    // the CURRENT zoom/bounds rather than waiting for the next pan/zoom.
    updateCategoryMarkerMembership(categoryId);
  }

  function refreshAllCategoryLayers() {
    APP_CONFIG.editableCategoryOrder.forEach(refreshCategoryLayer);
  }

  // Opens the popup for one specific merged record - even if it is
  // currently hidden inside a marker cluster, OR currently excluded by
  // the progressive zoom reveal (too far zoomed out for its category),
  // OR currently outside the visible map extent. Used instead of
  // buildExistingPlacePopup()'s "I already have the raw feature" path
  // whenever the caller only knows {categoryId, placeId} (search
  // results, Explore cards, Near Me - see participation.js's file
  // header for why those two shapes exist).
  function focusPlace(categoryId, placeId) {
    if (!map) return;
    setPanelVisible(categoryId, true);
    // IMPORTANT: re-fetch the registry entry AFTER setPanelVisible, not
    // before. setPanelVisible can trigger refreshCategoryClustering-
    // IfNeeded(), which rebuilds registry[categoryId].layer (and
    // categoryMarkerStore[categoryId]) into brand new objects
    // (registerLayer() always writes a fresh entry) - grabbing "entry"
    // before that call would leave this function holding a stale layer
    // that may no longer be on the map at all.
    const entry = registry[categoryId];
    if (!entry) return;

    // FORCE-REVEAL (fixes a real race condition): the caller (Search,
    // Explore cards, Near Me) is about to pan/zoom the map to this exact
    // place, but the progressive zoom reveal / viewport filter normally
    // only updates on "zoomend"/"moveend" - which, for an ANIMATED
    // map.setView() call, fires asynchronously AFTER the animation
    // finishes. If this function searched the shell group for the
    // marker right now, it might not be a member yet. So: find this
    // specific marker in the category's FULL stored array (built once,
    // always complete, regardless of current zoom/bounds) and force it
    // into the shell group directly, bypassing the normal zoom/bounds
    // gate for this one marker only. Every OTHER marker in this category
    // is unaffected and will still be governed normally by the next
    // zoom/extent recompute.
    const storedMarkers = categoryMarkerStore[categoryId] || [];
    const targetMarker = storedMarkers.find((m) => m.coastconnectPlaceId === placeId);
    if (targetMarker && !entry.layer.hasLayer(targetMarker)) {
      entry.layer.addLayer(targetMarker);
    }

    let foundMarker = null;
    entry.layer.eachLayer((layer) => {
      if (layer.coastconnectPlaceId === placeId) foundMarker = layer;
    });
    if (!foundMarker) return;

    if (typeof entry.layer.zoomToShowLayer === "function") {
      entry.layer.zoomToShowLayer(foundMarker, () => foundMarker.openPopup());
    } else {
      map.setView(foundMarker.getLatLng(), 16);
      foundMarker.openPopup();
    }
  }

  // ------------------------------------------------------------------
  // VISIBILITY: Layers panel checkboxes + category Filters combine
  // ------------------------------------------------------------------
  function recomputeVisibility(id) {
    const entry = registry[id];
    if (!entry || !map) return;
    const shouldBeVisible = entry.panelVisible && entry.filterVisible;
    const isOnMap = map.hasLayer(entry.layer);
    if (shouldBeVisible && !isOnMap) map.addLayer(entry.layer);
    if (!shouldBeVisible && isOnMap) map.removeLayer(entry.layer);
  }

  function setPanelVisible(id, visible) {
    if (!registry[id]) return;
    registry[id].panelVisible = visible;
    recomputeVisibility(id);
    // Only an editable tourism category toggling affects the clustering
    // rule - toggling Roads/Water/Cities/etc. never needs to rebuild
    // anything here.
    if (registry[id].source === "editable") refreshCategoryClusteringIfNeeded();
  }

  // activeTags: array of filter keys currently selected in the Filter
  // panel. An empty array means "no filter, show all".
  function applyCategoryFilter(activeTags) {
    activeFilterTags = activeTags || [];
    Object.keys(registry).forEach((id) => {
      const entry = registry[id];
      if (!entry.filterTags || entry.filterTags.length === 0) {
        entry.filterVisible = true; // not affected by the tourism-category filter buttons
      } else if (activeFilterTags.length === 0) {
        entry.filterVisible = true;
      } else {
        entry.filterVisible = entry.filterTags.some((t) => activeFilterTags.includes(t));
      }
      recomputeVisibility(id);
    });
    // A filter change can affect several editable categories' visibility
    // at once, so always re-check the clustering rule here, unconditionally.
    refreshCategoryClusteringIfNeeded();
  }

  function clearCategoryFilter() {
    applyCategoryFilter([]);
  }

  // Count of point features currently visible on the map. NOTE: this
  // counts what is currently a MEMBER of each visible shell group, which
  // after the progressive zoom reveal correctly reflects only the
  // markers actually eligible at the current zoom/within the current
  // extent - not the category's total record count. That matches what
  // the label next to it ("N places visible") is meant to communicate.
  function getVisiblePlaceCount() {
    let count = 0;
    Object.keys(registry).forEach((id) => {
      const entry = registry[id];
      if (entry.geometryType !== "point" || !entry.panelVisible || !entry.filterVisible) return;
      const layer = entry.layer;
      if (typeof layer.eachLayer === "function") {
        layer.eachLayer(() => count++);
      }
    });
    return count;
  }

  return {
    buildAll,
    getRegistry,
    registerExternalGroup,
    setPanelVisible,
    applyCategoryFilter,
    clearCategoryFilter,
    getVisiblePlaceCount,
    buildExistingPlacePopup,
    buildDivIcon,
    refreshCategoryLayer,
    refreshAllCategoryLayers,
    focusPlace,
    updatePOIVisibilityForViewport
  };
})();