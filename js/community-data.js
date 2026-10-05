/*
FILE PURPOSE: The merge engine. Fetches community-contributed data (new
  places, edits to existing places, reported issues, feedback) from the
  Google Apps Script backend and combines it with the original GeoJSON
  data already loaded by data-loader.js, so every other file can ask one
  simple question - "what does category X look like RIGHT NOW?" - and get
  back the correct, de-duplicated answer.
WHAT THIS FILE DOES:
  - Calls the Apps Script Web App URL (APP_CONFIG.googleAppsScript.apiURL)
    for the current community data: one combined "all" request on
    startup (places for all 11 editable categories + issues + feedback
    in one round trip), plus small targeted "category" / "issues"
    requests after a single add/edit/report succeeds.
  - THE MERGE: the Sheet only ever contains rows for places that were
    ADDED or EDITED by the community (status = newly_added / updated) -
    an untouched original GIS place never gets a Sheet row at all, and
    the Apps Script backend has already resolved "latest version per
    place_id" before this file ever sees the data (see Code.gs, PART 8).
    So for each editable category, this file:
      1. reads the ORIGINAL GeoJSON already loaded by data-loader.js and
         turns every point feature into an "existing" record (using its
         place_id property - see the QGIS preparation note below),
      2. takes the community rows for that category and OVERWRITES or
         ADDS into that same place_id-keyed collection,
      3. hands back one flat array with no duplicates and no stale
         versions - an edited existing place appears ONCE, showing its
         latest information, while data/<category>.geojson on disk is
         never touched.
  - NOTE ON place_id FOR EXISTING FEATURES: this assumes your prepared
    GeoJSON files already carry a stable "place_id" property per the
    QGIS preparation guidance (PART 9). If a feature has no place_id yet,
    this file generates a temporary one and logs a one-time console
    warning per category - the app keeps working, but that feature won't
    correctly match a future community edit until you add real place_ids
    in QGIS and re-export.
  - Builds the ONE Leaflet layer that has no underlying GeoJSON file at
    all: community-reported Issues. (The 11 tourism categories' own
    Leaflet layers are built by layers.js in PART 6, using
    getCurrentCategoryRecords() below - there is no separate "Community
    Added Places" layer anymore.)
  - Lets the current, non-sensitive community data be exported as CSV or
    GeoJSON from the Community panel.
MAIN FUNCTIONS:
  CommunityData.loadAll()
  CommunityData.getCurrentCategoryRecords(categoryId) -> merged array
  CommunityData.getIssues() / getFeedback()
  CommunityData.refreshCategory(categoryId) / refreshIssues()
  CommunityData.exportPlacesAsCSV/GeoJSON, exportIssuesAsCSV/GeoJSON
DEPENDENCIES: Leaflet, config.js, utils.js, data-loader.js (DataLoader),
  layers.js (LayerManager.registerExternalGroup - still a stable contract
  from PART 6 - and, once PART 6 lands, LayerManager.refreshCategoryLayer/
  refreshIssuesLayer), search.js (Search.rebuildIndex, once PART 6 lands).
--------------------------------------------------------------------------
BACKEND CONTRACT THIS FILE EXPECTS FROM Code.gs (to be built in PART 8):
  GET  ?action=all
    -> { success:true,
         places: { <categoryId>: [ <community row>, ... ], ... },
         issues: [ <issue row>, ... ],
         feedback: [ <feedback row>, ... ] }
  GET  ?action=category&category=<categoryId>
    -> { success:true, records: [ <community row>, ... ] }
  GET  ?action=issues   -> { success:true, issues: [ <issue row>, ... ] }
  GET  ?action=feedback -> { success:true, feedback: [ <feedback row>, ... ] }

  A <community row> is one place, already resolved to its LATEST version
  only, shaped like: { place_id, status ("newly_added"|"updated"), name,
  address, website, description, latitude, longitude, photo_url,
  created_at, updated_at, ...category-specific fields (e.g. dine_in,
  takeaway, delivery for a restaurant) }. Both snake_case and camelCase
  keys are accepted below so small naming differences in Code.gs will not
  break the frontend.
--------------------------------------------------------------------------
*/

const CommunityData = (function () {

  // communityByCategory[categoryId] = array of normalised community rows
  // (status newly_added / updated only - never "existing").
  let communityByCategory = {};
  let issuesCache = [];
  let feedbackCache = [];

  // mergedCache[categoryId] = the computed "existing + community" array,
  // rebuilt lazily. Cleared whenever the underlying data changes.
  let mergedCache = {};
  const warnedMissingPlaceId = new Set();

  // ------------------------------------------------------------------
  // LOADING
  // ------------------------------------------------------------------
  async function loadAll() {
    const apiURL = APP_CONFIG.googleAppsScript.apiURL;
    if (isPlaceholderValue(apiURL)) {
      console.info("CoastConnect: Google Apps Script URL not configured yet - " +
        "community contributions will stay empty until js/config.js is filled in.");
      communityByCategory = {};
      issuesCache = [];
      feedbackCache = [];
      mergedCache = {};
      buildCommunityIssuesLayer();
      return;
    }

    try {
      const data = await fetchJSON(buildURL(apiURL, "all"));
      if (!data || data.success !== true) throw new Error("Unexpected response shape for action=all");

      const rawPlaces = data.places || {};
      communityByCategory = {};
      APP_CONFIG.editableCategoryOrder.forEach((categoryId) => {
        communityByCategory[categoryId] = (rawPlaces[categoryId] || [])
          .map((raw) => normaliseCommunityPlaceRow(raw, categoryId))
          .filter(Boolean);
      });

      issuesCache = (data.issues || []).map(normaliseIssueRecord).filter(Boolean);
      feedbackCache = (data.feedback || []).map(normaliseFeedbackRecord).filter(Boolean);
      mergedCache = {};
    } catch (err) {
      console.warn("CoastConnect: could not load community data from Apps Script.", err.message);
      if (typeof UI !== "undefined" && UI.showToast) {
        UI.showToast("Could not reach the community data service. The map will continue with only the original GIS data.", "warning");
      }
      communityByCategory = communityByCategory || {};
      issuesCache = issuesCache || [];
      feedbackCache = feedbackCache || [];
    }

    buildCommunityIssuesLayer();
  }

  async function refreshCategory(categoryId) {
    const apiURL = APP_CONFIG.googleAppsScript.apiURL;
    if (isPlaceholderValue(apiURL)) return;

    try {
      const data = await fetchJSON(buildURL(apiURL, "category", { category: categoryId }));
      if (!data || data.success !== true) throw new Error("Unexpected response shape for action=category");
      communityByCategory[categoryId] = (data.records || [])
        .map((raw) => normaliseCommunityPlaceRow(raw, categoryId))
        .filter(Boolean);
      delete mergedCache[categoryId];

      if (typeof LayerManager !== "undefined" && LayerManager.refreshCategoryLayer) {
        LayerManager.refreshCategoryLayer(categoryId);
      }
      if (typeof Search !== "undefined" && Search.rebuildIndex) {
        Search.rebuildIndex();
      }
    } catch (err) {
      console.warn("CoastConnect: could not refresh category '" + categoryId + "' after submission.", err.message);
    }
  }

  async function refreshIssues() {
    const apiURL = APP_CONFIG.googleAppsScript.apiURL;
    if (isPlaceholderValue(apiURL)) return;

    try {
      const data = await fetchJSON(buildURL(apiURL, "issues"));
      if (!data || data.success !== true) throw new Error("Unexpected response shape for action=issues");
      issuesCache = (data.issues || []).map(normaliseIssueRecord).filter(Boolean);
      buildCommunityIssuesLayer();
    } catch (err) {
      console.warn("CoastConnect: could not refresh issues after submission.", err.message);
    }
  }

  async function refreshFeedback() {
    const apiURL = APP_CONFIG.googleAppsScript.apiURL;
    if (isPlaceholderValue(apiURL)) return;

    try {
      const data = await fetchJSON(buildURL(apiURL, "feedback"));
      if (!data || data.success !== true) throw new Error("Unexpected response shape for action=feedback");
      feedbackCache = (data.feedback || []).map(normaliseFeedbackRecord).filter(Boolean);
    } catch (err) {
      console.warn("CoastConnect: could not refresh feedback after submission.", err.message);
    }
  }

  function buildURL(apiURL, action, extraParams) {
    const params = new URLSearchParams(Object.assign({ action }, extraParams || {}));
    const separator = apiURL.includes("?") ? "&" : "?";
    return apiURL + separator + params.toString();
  }

  async function fetchJSON(url) {
    const response = await fetch(url, { method: "GET", cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }

  // ------------------------------------------------------------------
  // NORMALISATION (never trust raw network data)
  // ------------------------------------------------------------------
  function pick(raw, snakeKey, camelKey) {
    if (raw[snakeKey] !== undefined && raw[snakeKey] !== null) return raw[snakeKey];
    if (raw[camelKey] !== undefined && raw[camelKey] !== null) return raw[camelKey];
    return "";
  }

  function normaliseCommunityPlaceRow(raw, categoryId) {
    const lat = toCleanNumber(pick(raw, "latitude", "lat"));
    const lng = toCleanNumber(pick(raw, "longitude", "lng"));
    if (!isValidCoordinate(lat, lng)) return null;

    const placeId = pick(raw, "place_id", "placeId");
    if (!placeId) return null; // a community row with no place_id cannot be merged safely - drop it

    const status = pick(raw, "status", "status") || "newly_added";
    const fields = {};
    ((APP_CONFIG.editableCategories[categoryId] || {}).fields || []).forEach((fieldDef) => {
      fields[fieldDef.key] = raw[fieldDef.key] !== undefined && raw[fieldDef.key] !== null ? raw[fieldDef.key] : "";
    });

    return {
      placeId, categoryId,
      status: (status === "updated") ? "updated" : "newly_added",
      name: pick(raw, "name", "name") || "Unnamed place",
      address: pick(raw, "address", "address"),
      website: pick(raw, "website", "website"),
      description: pick(raw, "description", "description"),
      lat, lng,
      photoUrl: pick(raw, "photo_url", "photoUrl"),
      createdAt: pick(raw, "created_at", "createdAt"),
      updatedAt: pick(raw, "updated_at", "updatedAt"),
      fields
    };
  }

  function normaliseIssueRecord(raw) {
    const lat = toCleanNumber(pick(raw, "latitude", "lat"));
    const lng = toCleanNumber(pick(raw, "longitude", "lng"));
    if (!isValidCoordinate(lat, lng)) return null;
    return {
      issueId: pick(raw, "issue_id", "issueId") || uid("issue"),
      issueType: pick(raw, "issue_type", "issueType") || "Other",
      severity: pick(raw, "severity", "severity") || "Low",
      description: pick(raw, "description", "description"),
      relatedPlaceName: pick(raw, "related_place_name", "relatedPlaceName"),
      lat, lng,
      photoUrl: pick(raw, "photo_url", "photoUrl"),
      createdAt: pick(raw, "created_at", "createdAt")
    };
  }

  function normaliseFeedbackRecord(raw) {
    return {
      feedbackId: pick(raw, "feedback_id", "feedbackId") || uid("feedback"),
      placeId: pick(raw, "place_id", "placeId"),
      categoryId: pick(raw, "category_id", "categoryId"),
      placeName: pick(raw, "place_name", "placeName"),
      visitorType: pick(raw, "visitor_type", "visitorType"),
      overallExperience: toCleanNumber(pick(raw, "overall_experience", "overallExperience")),
      accessibility: toCleanNumber(raw.accessibility),
      cleanliness: toCleanNumber(raw.cleanliness),
      safety: toCleanNumber(raw.safety),
      environmentalQuality: toCleanNumber(pick(raw, "environmental_quality", "environmentalQuality")),
      touristFacilities: toCleanNumber(pick(raw, "tourist_facilities", "touristFacilities")),
      likedComments: pick(raw, "liked_comments", "likedComments"),
      improvementComments: pick(raw, "improvement_comments", "improvementComments"),
      createdAt: pick(raw, "created_at", "createdAt")
    };
  }

  // ------------------------------------------------------------------
  // THE MERGE ENGINE
  // ------------------------------------------------------------------
  // Turns one category's ORIGINAL GeoJSON into "existing" records. These
  // never change at runtime and the file on disk is never written to -
  // only this in-memory array is rebuilt, each time from the untouched
  // source file data-loader.js already holds.
  function buildExistingRecordsForCategory(categoryId) {
    const loaded = (typeof DataLoader !== "undefined") ? DataLoader.getAllLoaded() : {};
    const geojson = loaded[categoryId];
    if (!geojson || !Array.isArray(geojson.features)) return [];

    const categoryDef = APP_CONFIG.editableCategories[categoryId] || {};
    const fieldDefs = categoryDef.fields || [];
    let missingIdCount = 0;

    const records = geojson.features.map((feature, index) => {
      if (!feature.geometry || feature.geometry.type !== "Point") return null;
      const [lng, lat] = feature.geometry.coordinates;
      if (!isValidCoordinate(lat, lng)) return null;

      const props = feature.properties || {};
      let placeId = props.place_id || props.placeId || props.PLACE_ID;
      if (!placeId) {
        missingIdCount++;
        placeId = "TEMP_" + categoryId.toUpperCase() + "_" + index;
      }

      const fields = {};
      fieldDefs.forEach((fieldDef) => {
        fields[fieldDef.key] = (props[fieldDef.key] !== undefined && props[fieldDef.key] !== null) ? props[fieldDef.key] : "";
      });

      return {
        placeId, categoryId, status: "existing",
        name: props.name || getPlaceName(props),
        address: props.address || "",
        website: props.website || "",
        description: props.description || getPlaceDescription(props),
        lat, lng,
        photoUrl: "",
        createdAt: "",
        updatedAt: "",
        fields
      };
    }).filter(Boolean);

    if (missingIdCount > 0 && !warnedMissingPlaceId.has(categoryId)) {
      warnedMissingPlaceId.add(categoryId);
      console.warn(
        "CoastConnect: " + missingIdCount + " feature(s) in data/" + categoryId + ".geojson have no place_id property. " +
        "Temporary IDs were generated so the map keeps working, but edits to these places will not merge correctly " +
        "until you add stable place_id values in QGIS (see the QGIS preparation guide in PART 9) and re-export."
      );
    }

    return records;
  }

  function computeMergedCategory(categoryId) {
    const map = new Map();
    buildExistingRecordsForCategory(categoryId).forEach((record) => map.set(record.placeId, record));
    // Community rows OVERWRITE an existing record with the same place_id
    // (an edit) or ADD a brand-new one (a newly_added place) - either way,
    // the map ends up with exactly one current entry per place_id.
    (communityByCategory[categoryId] || []).forEach((record) => map.set(record.placeId, record));
    return Array.from(map.values());
  }

  function getCurrentCategoryRecords(categoryId) {
    if (!mergedCache[categoryId]) {
      mergedCache[categoryId] = computeMergedCategory(categoryId);
    }
    return mergedCache[categoryId].slice();
  }

  function getAllCurrentRecords() {
    const all = {};
    APP_CONFIG.editableCategoryOrder.forEach((categoryId) => {
      all[categoryId] = getCurrentCategoryRecords(categoryId);
    });
    return all;
  }

  function getIssues() { return issuesCache.slice(); }
  function getFeedback() { return feedbackCache.slice(); }

  // ------------------------------------------------------------------
  // COMMUNITY REPORTED ISSUES LAYER (the one layer with no base GeoJSON)
  // ------------------------------------------------------------------
  const SEVERITY_SIZE = { Low: 18, Moderate: 24, High: 30, Critical: 34 };

  function buildCommunityIssuesLayer() {
    const group = L.layerGroup(); // issues stay ungrouped so severity is always visible

    issuesCache.forEach((issue) => {
      const size = SEVERITY_SIZE[issue.severity] || SEVERITY_SIZE.Low;
      const strongOutline = issue.severity === "Critical";
      const marker = L.marker([issue.lat, issue.lng], {
        pane: "communityPane", // see map.js's createPanes() - sits above tourismPane
        icon: L.divIcon({
          className: "coastconnect-marker coastconnect-marker-issue coastconnect-severity-" + issue.severity.toLowerCase(),
          html:
            '<span class="coastconnect-issue-dot' + (strongOutline ? " coastconnect-issue-strong" : "") +
            '" style="width:' + size + "px;height:" + size + 'px;">' +
            '<i class="fa-solid fa-triangle-exclamation"></i></span>',
          iconSize: [size, size],
          iconAnchor: [size / 2, size - 2],
          popupAnchor: [0, -size]
        })
      });
      marker.bindPopup(() => buildIssuePopup(issue), { maxWidth: 300 });
      group.addLayer(marker);
    });

    LayerManager.registerExternalGroup({
      id: "community_issues",
      name: "Community Reported Issues",
      group: "Community Reports",
      icon: "fa-triangle-exclamation",
      color: "#b91c1c",
      geometryType: "point",
      filterTags: [],
      layer: group,
      source: "issues"
    });
  }

  function buildIssuePopup(issue) {
    const wrapper = document.createElement("div");
    wrapper.className = "cc-popup";
    wrapper.innerHTML =
      '<div class="cc-popup-source cc-source-issue"><i class="fa-solid fa-triangle-exclamation"></i> Community-Reported Issue</div>' +
      '<h3 class="cc-popup-title">' + escapeHTML(issue.issueType) + "</h3>" +
      '<div class="cc-popup-severity cc-severity-' + escapeHTML(issue.severity.toLowerCase()) + '">Severity: ' + escapeHTML(issue.severity) + "</div>" +
      (issue.relatedPlaceName ? '<div class="cc-popup-category">Near: ' + escapeHTML(issue.relatedPlaceName) + "</div>" : "") +
      (issue.description ? '<p class="cc-popup-desc">' + escapeHTML(issue.description) + "</p>" : "") +
      (isValidImageURL(issue.photoUrl) ? '<img class="cc-popup-photo" src="' + escapeHTML(issue.photoUrl) + '" alt="Reported issue photo" onerror="this.remove()">' : "") +
      (issue.createdAt ? '<div class="cc-popup-date">Reported: ' + escapeHTML(issue.createdAt) + "</div>" : "") +
      '<p class="cc-popup-disclaimer">This information was voluntarily contributed by users and may not have been independently verified.</p>';
    return wrapper;
  }

  // ------------------------------------------------------------------
  // DATA EXPORT (CSV / GeoJSON) - the CURRENT merged picture
  // ------------------------------------------------------------------
  // Every editable category has different category-specific fields, so a
  // single flat CSV keeps one consistent set of columns (place_id,
  // category, status, name, address, website, description, lat, lng,
  // created_at, updated_at, photo_url) plus one "extra_fields" column
  // holding the category-specific values as JSON - this avoids a ragged,
  // mostly-empty CSV while still keeping every value. The GeoJSON export
  // does not have this limitation, so category-specific fields are kept
  // as their own properties there.
  function exportPlacesAsCSV() {
    const rows = [];
    APP_CONFIG.editableCategoryOrder.forEach((categoryId) => {
      getCurrentCategoryRecords(categoryId).forEach((p) => {
        rows.push({
          place_id: p.placeId, category: categoryId, status: p.status,
          name: p.name, address: p.address, website: p.website, description: p.description,
          latitude: p.lat, longitude: p.lng,
          created_at: p.createdAt, updated_at: p.updatedAt, photo_url: p.photoUrl,
          extra_fields: JSON.stringify(p.fields || {})
        });
      });
    });
    downloadCSV(rows, "coastconnect_tourism_places.csv");
  }

  function exportPlacesAsGeoJSON() {
    const features = [];
    APP_CONFIG.editableCategoryOrder.forEach((categoryId) => {
      getCurrentCategoryRecords(categoryId).forEach((p) => {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
          properties: Object.assign({
            place_id: p.placeId, category: categoryId, status: p.status,
            name: p.name, address: p.address, website: p.website, description: p.description,
            created_at: p.createdAt, updated_at: p.updatedAt, photo_url: p.photoUrl
          }, p.fields || {})
        });
      });
    });
    downloadText(JSON.stringify({ type: "FeatureCollection", features }, null, 2),
      "coastconnect_tourism_places.geojson", "application/geo+json");
  }

  function exportIssuesAsCSV() {
    const rows = issuesCache.map((i) => ({
      type: i.issueType, severity: i.severity, latitude: i.lat, longitude: i.lng,
      related_place: i.relatedPlaceName, description: i.description, reported_at: i.createdAt
    }));
    downloadCSV(rows, "coastconnect_community_issues.csv");
  }

  function exportIssuesAsGeoJSON() {
    const fc = {
      type: "FeatureCollection",
      features: issuesCache.map((i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [i.lng, i.lat] },
        properties: { type: i.issueType, severity: i.severity, related_place: i.relatedPlaceName, reported_at: i.createdAt }
      }))
    };
    downloadText(JSON.stringify(fc, null, 2), "coastconnect_community_issues.geojson", "application/geo+json");
  }

  function downloadCSV(rows, filename) {
    if (rows.length === 0) {
      if (typeof UI !== "undefined") UI.showToast("No data available to export yet.", "warning");
      return;
    }
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(",")];
    rows.forEach((row) => {
      lines.push(headers.map((h) => csvEscape(row[h])).join(","));
    });
    downloadText(lines.join("\n"), filename, "text/csv");
  }

  function csvEscape(value) {
    const str = value === null || value === undefined ? "" : String(value);
    if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  function downloadText(text, filename, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

    return {
    loadAll, refreshCategory, refreshIssues, refreshFeedback,
    getCurrentCategoryRecords, getAllCurrentRecords, getIssues, getFeedback,
    exportPlacesAsCSV, exportPlacesAsGeoJSON, exportIssuesAsCSV, exportIssuesAsGeoJSON
  };
})();