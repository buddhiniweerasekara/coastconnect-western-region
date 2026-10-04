/*
FILE PURPOSE: Wires up every button/panel in index.html and starts the app.
WHAT THIS FILE DOES:
  - Contains the boot() function that runs once the page has loaded: it
    initialises the map, loads the existing GIS data, builds the map
    layers, loads community data, then wires every button.
  - Switches between the five main panels: Explore, Layers, Community,
    Planning Insights, About.
  - Builds the Layers panel checkboxes and the collapsible Legend from
    whatever LayerManager actually has in its registry. There is no
    longer a separate generic "Community Added Places" layer/group - the
    11 editable tourism categories each carry their own merged
    existing+community data and sit in the Layers panel grouped exactly
    like before (Tourism Attractions / Tourism Services / etc. - see
    APP_CONFIG.dataFiles[].group). The one genuinely new, separate layer
    is community-reported Issues, which has no underlying GeoJSON file.
  - Builds the Explore panel: search box, quick discovery buttons (which
    now read the CURRENT merged data for the 11 editable categories, so
    a newly-added or renamed place shows up immediately - not just the
    original GeoJSON), category filters with a visible-count, Near Me
    results, Favourites.
  - Renders the Planning Insights panel: status-aware stat tiles, charts,
    heatmap toggles, Community-Based Planning Priority and Tourism
    Service Gap text (all built from analytics.js).
  - Small reusable UI pieces used by other files: toast notifications,
    the "click the map" picking banner, and the location-confirm dialog
    used by the Add Place / Report Issue / Change Location workflows.
  - PROGRESSIVE POI ZOOM REVEAL (UI/UX refinement): wireQuickDiscovery()
    now checks whether the clicked category's minimum zoom
    (APP_CONFIG.poiZoomLevels) is higher than the map's current zoom,
    and if so, zooms in to that level (keeping the current map center -
    it does not try to guess "the best city" to jump to) BEFORE applying
    the filter. This avoids ever dumping hundreds of regional-scale
    markers onto the map from an explicit Quick Discovery click, while
    still honouring the user's intent immediately rather than silently
    showing nothing.
MAIN FUNCTIONS:
  UI.showToast, UI.showTab, UI.setPickingBannerVisible,
  UI.showLocationConfirmDialog, boot()
DEPENDENCIES: every other js/ file. This file must be loaded LAST.
--------------------------------------------------------------------------
FORWARD CONTRACTS THIS FILE RELIES ON (not all implemented yet - see the
roadmap; each is called defensively with a typeof/feature check so the
app keeps running with "0 / blank" stats until its PART lands):

  PlaceForm.startAddFlow()                                    [done, PART 3]
  Participation.startReportIssueFlow() / runNearMe() /
    getDirectionsURL()                                        [done, PART 3]
  Feedback.openFeedbackForm({...})                             [done, PART 4]

  CommunityData.loadAll()                                     [[PART 5]]
  CommunityData.getCurrentCategoryRecords(categoryId)
    -> [{ placeId, name, lat, lng, status, ... }]              [PART 5]
  CommunityData.refreshCategory(categoryId) / refreshIssues()  [PART 5]
  CommunityData.exportPlacesAsCSV() / exportPlacesAsGeoJSON() /
    exportIssuesAsCSV() / exportIssuesAsGeoJSON()               [PART 5]

  LayerManager.getRegistry() -> { [id]: {
      id, name, icon, color, group, geometryType, panelVisible,
      source: "informational" | "editable" | "issues"
    } }                                                     [done, PART 6]
    - "informational"  = the 6 non-editable datasets (unchanged)
    - "editable"        = one of the 11 tourism categories (merged
                           existing + newly_added + updated records)
    - "issues"          = the single community-reported-problems layer
    (the "wp" boundary entry is still excluded from the panel/legend)
  LayerManager.setPanelVisible(id, visible) / applyCategoryFilter(keys) /
    clearCategoryFilter() / getVisiblePlaceCount() /
    buildExistingPlacePopup(def, feature, latlng)            [done, PART 6]
  LayerManager.focusPlace(categoryId, placeId)
    - opens/centres the popup for one merged record. Used instead of
      buildExistingPlacePopup() whenever a card/result came from an
      EDITABLE category (see findNearbyPlaces()'s two result shapes,
      documented at the top of participation.js).              [done, PART 6]
  LayerManager.refreshAllCategoryLayers()
    - called once, right after CommunityData.loadAll() resolves in
      boot() below, to redraw all 11 category layers with the merged
      data (they were first drawn with "existing" places only, before
      community data had loaded).                               [done, PART 6]

  Analytics.computeIndicators() -> {
      existingPlaces, newlyAddedPlaces, updatedPlaces,
      totalCurrentPlaces, communityFeedbackCount,
      totalIssuesReported, highSeverityProblems, ...per-category data
    }                                                             [PART 7]
  Analytics.renderCharts({category, placeStatus, issuesSeverity, ratings}, indicators)
  Analytics.computeCommunityPriorityAreas() / buildPriorityLayer(cells)
  Analytics.buildHeatmapLayers() -> { tourismActivity, communityPlaces,
      problems, participation }
  Analytics.computeServiceGapInsights()                          [PART 7]
--------------------------------------------------------------------------
*/

const UI = (function () {

  let activeFilters = [];
  const FAVOURITES_KEY = APP_CONFIG.behaviour.favouritesStorageKey;

  // ------------------------------------------------------------------
  // TOAST NOTIFICATIONS (used everywhere for friendly error/status text)
  // ------------------------------------------------------------------
  function showToast(message, type) {
    const container = document.getElementById("toastContainer");
    if (!container) { console.log("[" + (type || "info") + "] " + message); return; }

    const toast = document.createElement("div");
    toast.className = "cc-toast cc-toast-" + (type || "info");
    toast.setAttribute("role", "status");
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => toast.classList.add("cc-toast-visible"), 10);
    setTimeout(() => {
      toast.classList.remove("cc-toast-visible");
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  // ------------------------------------------------------------------
  // PICKING BANNER ("Click the map to locate the tourism place")
  // ------------------------------------------------------------------
  function setPickingBannerVisible(visible, text) {
    const banner = document.getElementById("pickingBanner");
    if (!banner) return;
    if (text) banner.querySelector(".cc-picking-text").textContent = text;
    banner.hidden = !visible;
  }

  // ------------------------------------------------------------------
  // LOCATION CONFIRM DIALOG (used by place-form.js and participation.js)
  // ------------------------------------------------------------------
  function showLocationConfirmDialog({ lat, lng, title, onConfirm, onReposition, onCancel }) {
    const dialog = document.getElementById("locationConfirmDialog");
    if (!dialog) return;

    dialog.querySelector(".cc-dialog-title").textContent = title || "Confirm this location?";
    dialog.querySelector(".cc-dialog-coords").textContent =
      "Latitude: " + lat.toFixed(6) + "   Longitude: " + lng.toFixed(6);
    dialog.hidden = false;

    const confirmBtn = dialog.querySelector(".cc-dialog-confirm");
    const repositionBtn = dialog.querySelector(".cc-dialog-reposition");
    const cancelBtn = dialog.querySelector(".cc-dialog-cancel");

    function cleanup() { dialog.hidden = true; }

    // "Reposition" just closes this dialog - the map is still in picking
    // mode, so the user's next map click fires this same flow again with
    // fresh coordinates. We must NOT reopen the dialog here ourselves, or
    // it would reappear showing the old, now-incorrect coordinates.
    confirmBtn.onclick = () => { cleanup(); onConfirm && onConfirm(); };
    repositionBtn.onclick = () => { cleanup(); onReposition && onReposition(); };
    cancelBtn.onclick = () => { cleanup(); onCancel && onCancel(); };
  }

  // ------------------------------------------------------------------
  // PANEL / TAB NAVIGATION
  // ------------------------------------------------------------------
  const TAB_NAMES = ["explore", "layers", "community", "planning", "about"];

  function showTab(name) {
    TAB_NAMES.forEach((tab) => {
      const section = document.getElementById("panel-" + tab);
      const navBtn = document.querySelector('.cc-nav-btn[data-tab="' + tab + '"]');
      if (section) section.hidden = tab !== name;
      if (navBtn) navBtn.classList.toggle("cc-nav-btn-active", tab === name);
    });
    document.body.classList.add("cc-panel-open"); // used for the mobile drawer
  }

  function wireNav() {
    document.querySelectorAll(".cc-nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => showTab(btn.dataset.tab));
    });
    const closeBtn = document.getElementById("panelCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", () => document.body.classList.remove("cc-panel-open"));
  }

  // ------------------------------------------------------------------
  // LAYERS PANEL + LEGEND (built from LayerManager's registry)
  // ------------------------------------------------------------------
  // All 17 point/line/polygon datasets - the 6 informational ones AND the
  // 11 editable tourism categories - share the same `group` labels that
  // already exist in APP_CONFIG.dataFiles (e.g. "Tourism Attractions"),
  // so they are simply grouped together here. The only layer that is NOT
  // backed by a dataFiles entry is the single "issues" layer, which
  // LayerManager is expected to register under its own group (see the
  // forward-contract note at the top of this file).
  function buildLayersPanel() {
    const container = document.getElementById("layersPanelBody");
    const legendContainer = document.getElementById("legendBody");
    if (!container) return;
    container.innerHTML = "";
    if (legendContainer) legendContainer.innerHTML = "";

    const registry = LayerManager.getRegistry();
    const groups = {};
    const groupOrder = [];

    Object.values(registry).forEach((entry) => {
      if (entry.id === "wp") return; // boundary outline - not a toggle-able "layer" for the user
      if (!groups[entry.group]) { groups[entry.group] = []; groupOrder.push(entry.group); }
      groups[entry.group].push(entry);
    });

    groupOrder.forEach((groupName) => {
      container.appendChild(buildLayerGroupBlock(groupName, groups[groupName]));
    });

    buildLegend(groups, groupOrder);
  }

  function buildLayerGroupBlock(groupName, entries) {
    const block = document.createElement("div");
    block.className = "cc-layer-group";
    const heading = document.createElement("h4");
    heading.textContent = groupName;
    block.appendChild(heading);

    entries.forEach((entry) => {
      const row = document.createElement("label");
      row.className = "cc-layer-row";
      row.innerHTML =
        '<input type="checkbox" ' + (entry.panelVisible ? "checked" : "") + '> ' +
        '<span class="cc-layer-swatch" style="background:' + entry.color + '"></span>' +
        '<i class="fa-solid ' + entry.icon + '"></i> <span>' + escapeHTML(entry.name) + "</span>";
      row.querySelector("input").addEventListener("change", (e) => {
        LayerManager.setPanelVisible(entry.id, e.target.checked);
      });
      block.appendChild(row);
    });
    return block;
  }

  // ------------------------------------------------------------------
  // LEGEND (collapsible, grouped by data source/trust level)
  // ------------------------------------------------------------------
  function buildLegend(groups, groupOrder) {
    const legendContainer = document.getElementById("legendBody");
    if (!legendContainer) return;

    const tourismEntries = [];
    const issueEntries = [];
    groupOrder.forEach((groupName) => {
      groups[groupName].forEach((entry) => {
        if (entry.source === "issues") issueEntries.push(entry);
        else if (entry.geometryType === "point") tourismEntries.push(entry);
      });
    });

    legendContainer.appendChild(legendSection("Tourism & Map Layers", tourismEntries));
    legendContainer.appendChild(legendSection("Community Reports", issueEntries));

    const planningNote = document.createElement("p");
    planningNote.className = "cc-legend-note";
    planningNote.textContent =
      "Planning Information (heatmaps, priority areas) is shown in the Planning Insights panel and is exploratory, not official.";
    legendContainer.appendChild(planningNote);

    const sourceNote = document.createElement("p");
    sourceNote.className = "cc-legend-note cc-legend-note-strong";
    sourceNote.textContent =
      "Each tourism layer can include both the original surveyed data and unverified community contributions. " +
      "Open a place's popup to see whether it is Existing, Community Added, or Community Updated.";
    legendContainer.appendChild(sourceNote);

    // Roads itself is intentionally left out of the point-based legend
    // list above (it is a line layer, not a point layer) - a one-line
    // plain-language note instead of listing all 4 road tiers keeps the
    // legend from becoming a road-class reference table.
    const roadNote = document.createElement("p");
    roadNote.className = "cc-legend-note";
    roadNote.textContent = "Road detail increases as you zoom in - only major roads show at a regional view.";
    legendContainer.appendChild(roadNote);

    // Progressive tourism POI reveal note - same spirit as the road
    // note above: a one-line plain-language explanation instead of
    // listing every category's exact zoom threshold.
    const poiNote = document.createElement("p");
    poiNote.className = "cc-legend-note";
    poiNote.textContent = "Tourism places appear progressively as you zoom in, starting with Beaches, Heritage Sites, Parks and Museums, then more categories as you zoom further.";
    legendContainer.appendChild(poiNote);
  }

  function legendSection(title, entries) {
    const wrap = document.createElement("div");
    wrap.className = "cc-legend-section";
    const heading = document.createElement("h5");
    heading.textContent = title;
    wrap.appendChild(heading);
    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "cc-empty-note";
      empty.textContent = "None yet.";
      wrap.appendChild(empty);
      return wrap;
    }
    entries.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "cc-legend-row";
      row.innerHTML =
        '<span class="cc-layer-swatch" style="background:' + entry.color + '"></span>' +
        '<i class="fa-solid ' + entry.icon + '"></i> <span>' + escapeHTML(entry.name) + "</span>";
      wrap.appendChild(row);
    });
    return wrap;
  }

  function wireLegendToggle() {
    const toggleBtn = document.getElementById("legendToggleBtn");
    const legendPanel = document.getElementById("legendPanel");
    if (!toggleBtn || !legendPanel) return;
    toggleBtn.addEventListener("click", () => legendPanel.classList.toggle("cc-legend-collapsed"));
  }

  // ------------------------------------------------------------------
  // BASEMAP SWITCHER
  // ------------------------------------------------------------------
  function buildBasemapSwitcher() {
    const container = document.getElementById("basemapSwitcher");
    if (!container) return;
    container.innerHTML = "";
    MapCore.getBaseLayerNames().forEach((name, index) => {
      const label = document.createElement("label");
      label.className = "cc-basemap-row";
      label.innerHTML =
        '<input type="radio" name="basemap" value="' + escapeHTML(name) + '" ' + (index === 0 ? "checked" : "") + "> " +
        "<span>" + escapeHTML(name) + "</span>";
      label.querySelector("input").addEventListener("change", () => MapCore.setBaseLayer(name));
      container.appendChild(label);
    });
  }

  // ------------------------------------------------------------------
  // SEARCH + EXPLORE PANEL (quick discovery, cards, filters)
  // ------------------------------------------------------------------
  function wireSearch() {
    const input = document.getElementById("searchInput");
    const resultsBox = document.getElementById("searchResults");
    if (!input || !resultsBox) return;

    const runSearch = debounce(() => {
      const results = Search.query(input.value);
      resultsBox.innerHTML = "";
      resultsBox.hidden = results.length === 0;
      results.forEach((result) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "cc-search-result";
        row.innerHTML = '<i class="fa-solid ' + result.icon + '"></i> <span>' + escapeHTML(result.name) +
          '</span><small>' + escapeHTML(result.datasetName) + "</small>";
        row.addEventListener("click", () => {
          Search.goToResult(result);
          resultsBox.hidden = true;
          input.value = result.name;
        });
        resultsBox.appendChild(row);
      });
    }, 250);

    input.addEventListener("input", runSearch);
    document.addEventListener("click", (e) => {
      if (!resultsBox.contains(e.target) && e.target !== input) resultsBox.hidden = true;
    });
  }

  function buildFilterChips() {
    const container = document.getElementById("filterChips");
    if (!container) return;
    container.innerHTML = "";

    APP_CONFIG.filters.forEach((filter) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "cc-chip";
      chip.dataset.key = filter.key;
      chip.innerHTML = '<i class="fa-solid ' + filter.icon + '"></i> ' + escapeHTML(filter.label);
      chip.addEventListener("click", () => toggleFilter(filter.key, chip));
      container.appendChild(chip);
    });
  }

  function toggleFilter(key, chipEl) {
    const index = activeFilters.indexOf(key);
    if (index === -1) { activeFilters.push(key); chipEl.classList.add("cc-chip-active"); }
    else { activeFilters.splice(index, 1); chipEl.classList.remove("cc-chip-active"); }
    LayerManager.applyCategoryFilter(activeFilters);
    updateVisibleCount();
  }

  function wireFilterActions() {
    const showAllBtn = document.getElementById("filterShowAll");
    const clearBtn = document.getElementById("filterClear");

    if (showAllBtn) showAllBtn.addEventListener("click", () => {
      Object.keys(LayerManager.getRegistry()).forEach((id) => LayerManager.setPanelVisible(id, true));
      resetFilterChips();
    });
    if (clearBtn) clearBtn.addEventListener("click", resetFilterChips);

    function resetFilterChips() {
      activeFilters = [];
      document.querySelectorAll(".cc-chip").forEach((chip) => chip.classList.remove("cc-chip-active"));
      LayerManager.clearCategoryFilter();
      updateVisibleCount();
    }
  }

  function updateVisibleCount() {
    const el = document.getElementById("visiblePlacesCount");
    if (el) el.textContent = LayerManager.getVisiblePlaceCount() + " places visible";
  }

  // PROGRESSIVE POI ZOOM REVEAL: given a Filter/Quick-Discovery key (e.g.
  // "beaches", "banks_atm"), finds the ONE editable tourism category
  // dataset that owns this exact tag (now a strict 1:1 relationship
  // after the Other-Attractions/Heritage-Museums/Shops-Banks fix in
  // config.js) and returns its minimum zoom from APP_CONFIG.poiZoomLevels.
  // Returns null for a key that matches no editable category at all
  // (e.g. "transport", which only matches informational datasets) - in
  // that case there is no zoom gate to respect, so the caller should
  // not force any zoom change.
  function getRequiredZoomForFilterKey(key) {
    const matchingDef = APP_CONFIG.dataFiles.find((def) =>
      def.filterTags && def.filterTags.includes(key) && APP_CONFIG.editableCategories[def.id]
    );
    if (!matchingDef) return null;
    const levels = APP_CONFIG.poiZoomLevels || {};
    return (typeof levels[matchingDef.id] === "number") ? levels[matchingDef.id] : null;
  }

  // Quick discovery buttons - re-uses the same filter system, then shows
  // a scrollable card list of the matching places. For the 11 editable
  // tourism categories the cards now come from the CURRENT merged data
  // (existing + newly_added + updated), never the raw GeoJSON alone, so
  // a community contribution shows up here immediately too.
  //
  // PROGRESSIVE POI ZOOM REVEAL: before applying the filter, this now
  // checks whether the clicked category's minimum zoom
  // (getRequiredZoomForFilterKey) is higher than the map's CURRENT zoom.
  // If so, it zooms in to exactly that level, keeping the current map
  // center (it does not guess which city to pan to) - this is what
  // reveals the category's markers in the current view rather than
  // silently showing zero results because the map was still too
  // zoomed-out. The Explore card list itself is unaffected by this (it
  // already lists every current record for the category, same as
  // before) - only the MAP's marker visibility depends on zoom/extent.
  function wireQuickDiscovery() {
    document.querySelectorAll(".cc-quick-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.filter;
        if (key === "near-me") { runNearMeFlow(); return; }

        const map = MapCore.getMap();
        const requiredZoom = getRequiredZoomForFilterKey(key);
        if (map && requiredZoom !== null && map.getZoom() < requiredZoom) {
          map.setZoom(requiredZoom);
        }

        activeFilters = [key];
        document.querySelectorAll(".cc-chip").forEach((chip) =>
          chip.classList.toggle("cc-chip-active", chip.dataset.key === key));
        LayerManager.applyCategoryFilter(activeFilters);
        updateVisibleCount();
        const cards = buildCardsForFilter(key);
        const label = (APP_CONFIG.filters.find((f) => f.key === key) || {}).label || key;
        showCards(label, cards);
      });
    });
  }

  // Returns cards in one of two shapes (see the file-header note on
  // findNearbyPlaces() in participation.js for why): editable-category
  // cards carry {categoryId, placeId}; informational-layer cards carry
  // {def, feature}.
  function buildCardsForFilter(key) {
    const loaded = DataLoader.getAllLoaded();
    const cards = [];

    APP_CONFIG.dataFiles.forEach((def) => {
      if (!def.filterTags || !def.filterTags.includes(key)) return;
      const isEditable = !!APP_CONFIG.editableCategories[def.id];

      if (isEditable && typeof CommunityData !== "undefined" && CommunityData.getCurrentCategoryRecords) {
        CommunityData.getCurrentCategoryRecords(def.id).forEach((place) => {
          cards.push({
            name: place.name, lat: place.lat, lng: place.lng, icon: def.icon,
            categoryId: def.id, placeId: place.placeId
          });
        });
        return;
      }

      const geojson = loaded[def.id];
      if (!geojson) return;
      geojson.features.forEach((f) => {
        if (!f.geometry || f.geometry.type !== "Point") return;
        const [lng, lat] = f.geometry.coordinates;
        if (!isValidCoordinate(lat, lng)) return;
        cards.push({ name: getPlaceName(f.properties), lat, lng, icon: def.icon, def, feature: f });
      });
    });
    return cards;
  }

  function showCards(title, cards) {
    const container = document.getElementById("exploreCards");
    if (!container) return;
    document.getElementById("exploreCardsTitle").textContent = title + " (" + cards.length + ")";
    container.innerHTML = "";

    if (cards.length === 0) {
      container.innerHTML = '<p class="cc-empty-note">No places found for this category yet.</p>';
      return;
    }

    cards.forEach((card) => {
      const el = document.createElement("div");
      el.className = "cc-card";
      el.innerHTML =
        '<i class="fa-solid ' + card.icon + '"></i>' +
        '<div class="cc-card-body"><strong>' + escapeHTML(card.name) + "</strong></div>" +
        '<div class="cc-card-actions">' +
        '<button type="button" class="cc-card-btn cc-card-view" title="View on map"><i class="fa-solid fa-location-crosshairs"></i></button>' +
        '<button type="button" class="cc-card-btn cc-card-directions" title="Get Directions"><i class="fa-solid fa-diamond-turn-right"></i></button>' +
        '<button type="button" class="cc-card-btn cc-card-fav" title="Add to Favourites"><i class="fa-regular fa-star"></i></button>' +
        "</div>";

      el.querySelector(".cc-card-view").addEventListener("click", () => {
        const map = MapCore.getMap();
        map.setView([card.lat, card.lng], 16);
        if (card.categoryId && card.placeId && typeof LayerManager !== "undefined" && LayerManager.focusPlace) {
          LayerManager.focusPlace(card.categoryId, card.placeId);
        } else if (card.def && card.feature) {
          LayerManager.setPanelVisible(card.def.id, true);
          L.popup({ maxWidth: 280 }).setLatLng([card.lat, card.lng])
            .setContent(() => LayerManager.buildExistingPlacePopup(card.def, card.feature, [card.lat, card.lng]))
            .openOn(map);
        }
      });

      el.querySelector(".cc-card-directions").addEventListener("click", () => {
        window.open(Participation.getDirectionsURL(card.lat, card.lng), "_blank", "noopener");
      });

      const favBtn = el.querySelector(".cc-card-fav");
      updateFavButton(favBtn, card.name);
      favBtn.addEventListener("click", () => {
        toggleFavourite({ name: card.name, lat: card.lat, lng: card.lng });
        updateFavButton(favBtn, card.name);
        renderFavourites();
      });

      container.appendChild(el);
    });
  }

  // ------------------------------------------------------------------
  // NEAR ME (triggered from a quick discovery button or FAB)
  // ------------------------------------------------------------------
  function runNearMeFlow() {
    showToast("Requesting your location...", "info");
    Participation.runNearMe(
      ({ results }) => {
        showToast("Location found. Showing nearby places.", "success");
        // Preserve BOTH possible shapes findNearbyPlaces() can hand back
        // (see participation.js's file header) so showCards()'s "View on
        // map" button can branch correctly for each card.
        const cards = results.map((r) => ({
          name: r.name + " (" + formatDistance(r.distanceKm) + ")",
          lat: r.lat, lng: r.lng, icon: r.icon,
          def: r.def, feature: r.feature,
          categoryId: r.categoryId, placeId: r.placeId
        }));
        showCards("Nearby Places", cards);
        showTab("explore");
      },
      (message) => showToast(message, "warning")
    );
  }

  function wireFabButtons() {
    const addBtn = document.getElementById("fabAddPlace");
    const issueBtn = document.getElementById("fabReportIssue");
    const nearBtn = document.getElementById("fabNearMe");
    if (addBtn) addBtn.addEventListener("click", () => PlaceForm.startAddFlow());
    if (issueBtn) issueBtn.addEventListener("click", () => Participation.startReportIssueFlow());
    if (nearBtn) nearBtn.addEventListener("click", runNearMeFlow);
  }

  // ------------------------------------------------------------------
  // FAVOURITES (browser localStorage, no account needed)
  // ------------------------------------------------------------------
  function readFavourites() {
    try {
      const raw = localStorage.getItem(FAVOURITES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      return [];
    }
  }

  function writeFavourites(list) {
    try { localStorage.setItem(FAVOURITES_KEY, JSON.stringify(list)); }
    catch (err) { console.warn("CoastConnect: could not save favourites (browser storage unavailable)."); }
  }

  function isFavourite(name) {
    return readFavourites().some((f) => f.name === name);
  }

  function toggleFavourite(place) {
    let list = readFavourites();
    if (isFavourite(place.name)) list = list.filter((f) => f.name !== place.name);
    else list.push(place);
    writeFavourites(list);
  }

  function updateFavButton(btn, name) {
    const fav = isFavourite(name);
    btn.innerHTML = fav ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-regular fa-star"></i>';
    btn.classList.toggle("cc-card-fav-active", fav);
  }

  function renderFavourites() {
    const container = document.getElementById("favouritesList");
    if (!container) return;
    const list = readFavourites();
    container.innerHTML = "";
    if (list.length === 0) {
      container.innerHTML = '<p class="cc-empty-note">No favourites saved yet. Use the star on any place card.</p>';
      return;
    }
    list.forEach((place) => {
      const row = document.createElement("div");
      row.className = "cc-fav-row";
      row.innerHTML = '<span>' + escapeHTML(place.name) + '</span>' +
        '<button type="button" class="cc-fav-remove" title="Remove from favourites"><i class="fa-solid fa-xmark"></i></button>';
      row.querySelector("span").addEventListener("click", () => MapCore.getMap().setView([place.lat, place.lng], 16));
      row.querySelector(".cc-fav-remove").addEventListener("click", () => {
        toggleFavourite(place);
        renderFavourites();
      });
      container.appendChild(row);
    });
  }

  // ------------------------------------------------------------------
  // COMMUNITY PANEL
  // ------------------------------------------------------------------
  function wireCommunityPanel() {
    const addBtn = document.getElementById("communityAddPlaceBtn");
    const issueBtn = document.getElementById("communityReportIssueBtn");
    if (addBtn) addBtn.addEventListener("click", () => PlaceForm.startAddFlow());
    if (issueBtn) issueBtn.addEventListener("click", () => Participation.startReportIssueFlow());

    bindClick("exportPlacesCSV", () => CommunityData.exportPlacesAsCSV());
    bindClick("exportPlacesGeoJSON", () => CommunityData.exportPlacesAsGeoJSON());
    bindClick("exportIssuesCSV", () => CommunityData.exportIssuesAsCSV());
    bindClick("exportIssuesGeoJSON", () => CommunityData.exportIssuesAsGeoJSON());
  }

  function bindClick(id, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", handler);
  }

  // Reuses Analytics.computeIndicators() (the same source of truth as the
  // Planning Insights stat tiles) so this sentence and those tiles can
  // never disagree. Defaults to 0 for every field so the panel reads
  // cleanly even before analytics.js is rewritten.
  function renderCommunitySummary() {
    const el = document.getElementById("communitySummary");
    if (!el) return;
    const ind = safeComputeIndicators();
    el.textContent =
      (ind.newlyAddedPlaces || 0) + " newly added place(s), " +
      (ind.updatedPlaces || 0) + " updated place(s), " +
      (ind.totalIssuesReported || 0) + " reported issue(s) and " +
      (ind.communityFeedbackCount || 0) + " feedback submission(s) are currently reflected on the map.";
  }

  function safeComputeIndicators() {
    if (typeof Analytics !== "undefined" && Analytics.computeIndicators) {
      try { return Analytics.computeIndicators() || {}; }
      catch (err) { console.warn("CoastConnect: Analytics.computeIndicators() failed.", err); return {}; }
    }
    return {};
  }

  // ------------------------------------------------------------------
  // PLANNING INSIGHTS PANEL
  // ------------------------------------------------------------------
  let heatmapLayers = null;
  let priorityLayerOnMap = null;

  function renderPlanningInsights() {
    const indicators = safeComputeIndicators();

    setText("statExistingPlaces", indicators.existingPlaces || 0);
    setText("statNewPlaces", indicators.newlyAddedPlaces || 0);
    setText("statUpdatedPlaces", indicators.updatedPlaces || 0);
    setText("statTotalPlaces", indicators.totalCurrentPlaces || 0);
    setText("statFeedbackCount", indicators.communityFeedbackCount || 0);
    setText("statHighSeverity", indicators.highSeverityProblems || 0);

    if (typeof Analytics !== "undefined" && Analytics.renderCharts) {
      Analytics.renderCharts(
        { category: "chartCategory", placeStatus: "chartPlaceStatus", issuesSeverity: "chartIssuesSeverity", ratings: "chartRatings" },
        indicators
      );
    }

    renderPriorityAreas();
    renderServiceGapInsights();
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function wireHeatmapToggles() {
    const map = MapCore.getMap();
    const toggles = {
      heatToggleTourism: "tourismActivity",
      heatToggleCommunity: "communityPlaces",
      heatToggleProblems: "problems",
      heatToggleParticipation: "participation"
    };
    Object.keys(toggles).forEach((checkboxId) => {
      const checkbox = document.getElementById(checkboxId);
      if (!checkbox) return;
      checkbox.addEventListener("change", (e) => {
        if (!heatmapLayers && typeof Analytics !== "undefined" && Analytics.buildHeatmapLayers) {
          heatmapLayers = Analytics.buildHeatmapLayers();
        }
        if (!heatmapLayers) { showToast("Heatmaps are not available yet.", "warning"); e.target.checked = false; return; }
        const layer = heatmapLayers[toggles[checkboxId]];
        if (e.target.checked) map.addLayer(layer); else map.removeLayer(layer);
      });
    });
  }

  function renderPriorityAreas() {
    if (typeof Analytics === "undefined" || !Analytics.computeCommunityPriorityAreas) return;
    const cells = Analytics.computeCommunityPriorityAreas();
    const list = document.getElementById("priorityAreasList");
    if (list) {
      list.innerHTML = "";
      if (cells.length === 0) {
        list.innerHTML = '<p class="cc-empty-note">No reported issues yet - nothing to prioritise.</p>';
      } else {
        cells.slice(0, 8).forEach((cell) => {
          const row = document.createElement("div");
          row.className = "cc-priority-row cc-priority-" + cell.tier.split(" ")[0].toLowerCase();
          row.innerHTML = "<strong>" + escapeHTML(cell.tier) + "</strong> - score " + cell.score +
            " (" + cell.reportCount + " report" + (cell.reportCount === 1 ? "" : "s") + ")";
          list.appendChild(row);
        });
      }
    }

    const toggleBtn = document.getElementById("priorityMapToggle");
    if (toggleBtn) {
      toggleBtn.onclick = () => {
        const map = MapCore.getMap();
        if (priorityLayerOnMap) {
          map.removeLayer(priorityLayerOnMap);
          priorityLayerOnMap = null;
          toggleBtn.textContent = "Show Priority Areas on Map";
        } else {
          priorityLayerOnMap = Analytics.buildPriorityLayer(cells);
          priorityLayerOnMap.addTo(map);
          toggleBtn.textContent = "Hide Priority Areas on Map";
        }
      };
    }
  }

  function renderServiceGapInsights() {
    const container = document.getElementById("serviceGapInsights");
    if (!container) return;
    if (typeof Analytics === "undefined" || !Analytics.computeServiceGapInsights) {
      container.innerHTML = '<p class="cc-empty-note">Service gap analysis is not available yet.</p>';
      return;
    }
    const insights = Analytics.computeServiceGapInsights();

    container.innerHTML =
      '<p>' + insights.attractionsWithLimitedServicesCount + ' existing tourism attraction(s) have no restaurant, ' +
      'accommodation, shop or ATM within 1 km.</p>' +
      '<p>' + insights.highActivityHighProblemAreas + ' area(s) have 3 or more reported problems clustered together.</p>' +
      '<p class="cc-popup-disclaimer">These are simple distance/attribute based observations for exploratory planning ' +
      'discussion only, not a validated spatial analysis.</p>';
  }

  // ------------------------------------------------------------------
  // BOOT SEQUENCE
  // ------------------------------------------------------------------
  async function boot() {
    wireNav();
    showTab("explore");

    try {
      MapCore.init("map");
    } catch (err) {
      console.error("CoastConnect: the map could not start.", err);
      showFatalError("The map could not start. Please check that Leaflet loaded correctly (see browser console).");
      return;
    }

    buildBasemapSwitcher();
    wireLegendToggle();
    wireSearch();
    buildFilterChips();
    wireFilterActions();
    wireQuickDiscovery();
    wireFabButtons();
    wireCommunityPanel();
    wireHeatmapToggles();
    renderFavourites();

    showToast("Loading existing tourism GIS data...", "info");
    await DataLoader.loadAll();

    const failedCount = DataLoader.getLoadReport().filter((r) => r.status === "failed").length;
    if (failedCount > 0) {
      showToast(failedCount + " dataset(s) could not be loaded - check the data/ folder. The map will continue without them.", "warning");
    }

    LayerManager.buildAll(MapCore.getMap());
    buildLayersPanel();
    updateVisibleCount();

    if (typeof CommunityData !== "undefined" && CommunityData.loadAll) {
      try {
        await CommunityData.loadAll();
      } catch (err) {
        console.warn("CoastConnect: community data failed to load.", err);
      }
      // The 11 editable category layers were first drawn (in
      // LayerManager.buildAll() above) before any community data had
      // loaded, so they only showed "existing" places so far. Now that
      // CommunityData has the merged picture, redraw every one of them
      // with newly_added/updated places included too.
      if (typeof LayerManager !== "undefined" && LayerManager.refreshAllCategoryLayers) {
        LayerManager.refreshAllCategoryLayers();
      }
      buildLayersPanel(); // rebuild so merged/community-sourced data is reflected in counts
      updateVisibleCount();
    }

    renderCommunitySummary();
    renderPlanningInsights();

    showToast("CoastConnect is ready.", "success");
  }

  function showFatalError(message) {
    const mapEl = document.getElementById("map");
    if (mapEl) {
      mapEl.innerHTML = '<div class="cc-fatal-error"><i class="fa-solid fa-triangle-exclamation"></i><p>' +
        escapeHTML(message) + "</p></div>";
    }
  }

  return {
    showToast, showTab, setPickingBannerVisible, showLocationConfirmDialog,
    boot
  };
})();

// ------------------------------------------------------------------
// START THE APPLICATION
// ------------------------------------------------------------------
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", UI.boot);
} else {
  UI.boot();
}