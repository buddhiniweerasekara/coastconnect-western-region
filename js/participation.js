/*
FILE PURPOSE: "Report an Issue" (in-page form, no Google Form) plus the
  two location-independent participatory tools, Near Me and Get
  Directions.
WHAT THIS FILE DOES:
  - "Report an Issue": either opened directly from an existing place's
    popup (its coordinates are already known), or from the floating
    "! Report Issue" button / Community panel button (click-to-pick a
    map location first, exactly like Add Place). The form itself opens
    in the SAME shared modal shell as place-form.js and feedback.js
    (#appModal, via AppModal in utils.js) and is submitted straight to
    the Apps Script backend - there is no Google Form anywhere, and no
    developer-approval step: a submitted report appears immediately,
    clearly labelled as unverified community information.
  - "Near Me": asks for the browser's location only when the button is
    actually pressed, then lists nearby tourism places using a
    straight-line (Haversine) distance across BOTH the 6 informational
    datasets (cities, transport) and the CURRENT merged data (existing +
    newly added + updated) of the 11 editable tourism categories.
  - "Get Directions": opens Google Maps with the place's coordinates -
    no API key required.
  - The issue form also carries the same hidden honeypot field ("hp")
    used by place-form.js and feedback.js - see that file's header for
    how it works. Code.gs (PART 8) silently accepts-and-discards any
    issue report where this field is non-empty.
MAIN FUNCTIONS:
  Participation.openReportIssueForm, Participation.startReportIssueFlow,
  Participation.runNearMe, Participation.getDirectionsURL
DEPENDENCIES: Leaflet, config.js, utils.js (AppModal, escapeHTML,
  isValidCoordinate, isPlaceholderValue, postToAppsScript,
  compressImageFile, haversineDistanceKm), map.js, data-loader.js, ui.js
  (UI.showToast, UI.setPickingBannerVisible, UI.showLocationConfirmDialog),
  community-data.js (optional - CommunityData.getCurrentCategoryRecords
  for Near Me, CommunityData.refreshIssues after a successful report).
--------------------------------------------------------------------------
NOTE ON RESULT SHAPES (read this before touching ui.js's Near Me cards):
  findNearbyPlaces() below can return two different shapes, because it
  searches two different kinds of dataset:
    - informational datasets (cities, transport): { name, datasetName,
      icon, lat, lng, distanceKm, def, feature } - exactly as before,
      so ui.js can keep using LayerManager.buildExistingPlacePopup(def,
      feature, [lat,lng]) for these.
    - editable tourism categories: { name, datasetName, icon, lat, lng,
      distanceKm, categoryId, placeId } - ui.js should use
      LayerManager.focusPlace(categoryId, placeId) for these (added in
      the Part that rewrites layers.js) instead of def/feature, since
      the marker shown might be a community override, not the raw
      GeoJSON feature.
--------------------------------------------------------------------------
*/

const Participation = (function () {

  // ------------------------------------------------------------------
  // REPORT AN ISSUE - state for the one issue form that can be open
  // ------------------------------------------------------------------
  let issuePickedLat = null;
  let issuePickedLng = null;
  let issuePrefilledPlaceName = "";
  let issueSelectedPhoto = null;
  let issueSubmitting = false;

  // Case A: called directly from an existing place's popup - coordinates
  // and a related place name are already known, so we skip straight to
  // the form.
  function openReportIssueForm({ relatedPlaceName, lat, lng } = {}) {
    issuePickedLat = (typeof lat === "number") ? lat : null;
    issuePickedLng = (typeof lng === "number") ? lng : null;
    issuePrefilledPlaceName = relatedPlaceName || "";
    issueSelectedPhoto = null;
    renderIssueForm();
  }

  // Case B: called with no arguments by the floating "! Report Issue"
  // button or the Community panel button - we need to ask the user to
  // click the map first, exactly like Add Place does.
  function startReportIssueFlow() {
    UI.showToast("Click the map at the location of the problem.", "info");
    UI.setPickingBannerVisible(true, "Click the map to mark where the issue is.");

    MapCore.startLocationPicking((lat, lng) => {
      UI.showLocationConfirmDialog({
        lat, lng,
        title: "Report an issue at this location?",
        onConfirm: () => {
          MapCore.stopLocationPicking();
          UI.setPickingBannerVisible(false);
          openReportIssueForm({ lat, lng });
        },
        onReposition: () => UI.showToast("Click a new location on the map.", "info"),
        onCancel: () => {
          MapCore.stopLocationPicking();
          UI.setPickingBannerVisible(false);
        }
      });
    });
  }

  function renderIssueForm() {
    const body = AppModal.open("Report an Issue");
    if (!body) return;

    const formEl = document.createElement("form");
    formEl.className = "cc-place-form"; // reuses the exact same section/field CSS as place-form.js
    formEl.noValidate = true;
    formEl.innerHTML = buildIssueFormHTML();
    body.appendChild(formEl);

    wireIssueForm(formEl);
  }

  function buildIssueFormHTML() {
    const cfg = APP_CONFIG.issueReport;
    const coordText = (issuePickedLat != null && issuePickedLng != null)
      ? "Latitude: " + issuePickedLat.toFixed(6) + "    Longitude: " + issuePickedLng.toFixed(6)
      : "No location selected.";

    let categoryOptions = '<option value="">Select...</option>';
    cfg.categories.forEach((c) => { categoryOptions += "<option>" + escapeHTML(c) + "</option>"; });

    let severityOptions = '<option value="">Select...</option>';
    cfg.severities.forEach((s) => { severityOptions += "<option>" + escapeHTML(s) + "</option>"; });

    return (
      '<div class="cc-form-section">' +
        '<h4 class="cc-form-section-title">Location</h4>' +
        '<div class="cc-coord-display"><span>' + escapeHTML(coordText) + "</span>" +
        '<button type="button" class="cc-change-location-btn">Change Location</button></div>' +
      "</div>" +

      '<div class="cc-form-section">' +
        '<h4 class="cc-form-section-title">Issue Details</h4>' +
        '<div class="cc-field-group">' +
          '<label class="cc-field-label">Related Place Name</label>' +
          '<input class="cc-field-input" type="text" name="relatedPlaceName" value="' + escapeHTML(issuePrefilledPlaceName) + '">' +
        "</div>" +
        '<div class="cc-field-group">' +
          '<label class="cc-field-label">Issue Category<span class="cc-required">*</span></label>' +
          '<select class="cc-field-input" name="issueType" required>' + categoryOptions + "</select>" +
        "</div>" +
        '<div class="cc-field-group">' +
          '<label class="cc-field-label">Severity<span class="cc-required">*</span></label>' +
          '<select class="cc-field-input" name="severity" required>' + severityOptions + "</select>" +
        "</div>" +
        '<div class="cc-field-group">' +
          '<label class="cc-field-label">Describe the Issue<span class="cc-required">*</span></label>' +
          '<textarea class="cc-field-input cc-field-textarea" name="description" required></textarea>' +
        "</div>" +
      "</div>" +

      '<div class="cc-form-section">' +
        '<h4 class="cc-form-section-title">Photo</h4>' +
        renderIssuePhotoSectionHTML() +
      "</div>" +

      renderHoneypotHTML() +

      '<div class="cc-form-actions">' +
        '<button type="button" class="cc-form-cancel cc-text-btn">Cancel</button>' +
        '<button type="submit" class="cc-form-submit">Submit Report</button>' +
      "</div>"
    );
  }

  // Same off-screen anti-abuse field as place-form.js - see that file's
  // header for the full explanation of how the honeypot works.
  function renderHoneypotHTML() {
    return (
      '<div class="cc-hp-field" aria-hidden="true" ' +
      'style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;">' +
        '<label>Leave this field blank</label>' +
        '<input type="text" class="cc-field-input" name="hp" tabindex="-1" autocomplete="off">' +
      "</div>"
    );
  }

  function renderIssuePhotoSectionHTML() {
    if (issueSelectedPhoto) {
      return (
        '<div class="cc-photo-preview-wrap">' +
          '<img class="cc-photo-preview" src="' + issueSelectedPhoto.previewDataURL + '" alt="Selected photo preview">' +
          '<button type="button" class="cc-photo-remove-btn" title="Remove selected photo"><i class="fa-solid fa-xmark"></i></button>' +
        "</div>" +
        '<div class="cc-photo-input-wrap">' +
          '<label class="cc-photo-input-label">' +
            '<input type="file" accept="image/jpeg,image/png,image/webp" class="cc-photo-file-input">' +
            '<i class="fa-solid fa-camera"></i> Choose a different photo' +
          "</label>" +
        "</div>"
      );
    }
    return (
      '<div class="cc-photo-input-wrap">' +
        '<label class="cc-photo-input-label">' +
          '<input type="file" accept="image/jpeg,image/png,image/webp" class="cc-photo-file-input">' +
          '<i class="fa-solid fa-camera"></i> Click to choose a photo (optional, JPEG/PNG/WEBP)' +
        "</label>" +
      "</div>"
    );
  }

  function wireIssueForm(formEl) {
    const changeLocBtn = formEl.querySelector(".cc-change-location-btn");
    if (changeLocBtn) {
      changeLocBtn.addEventListener("click", () => {
        const nameField = formEl.querySelector('[name="relatedPlaceName"]');
        issuePrefilledPlaceName = nameField ? nameField.value : issuePrefilledPlaceName;
        AppModal.close();
        pickNewIssueLocation();
      });
    }

    wireIssuePhotoInput(formEl);

    formEl.querySelector(".cc-form-cancel").addEventListener("click", () => {
      AppModal.close();
      issueSelectedPhoto = null;
    });

    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      submitIssueForm(formEl);
    });
  }

  function pickNewIssueLocation() {
    UI.showToast("Click the map at the new location.", "info");
    UI.setPickingBannerVisible(true, "Click the map to mark where the issue is.");
    MapCore.startLocationPicking((lat, lng) => {
      UI.showLocationConfirmDialog({
        lat, lng,
        title: "Use this location?",
        onConfirm: () => {
          MapCore.stopLocationPicking();
          UI.setPickingBannerVisible(false);
          issuePickedLat = lat;
          issuePickedLng = lng;
          renderIssueForm();
        },
        onReposition: () => UI.showToast("Click a new location on the map.", "info"),
        onCancel: () => {
          MapCore.stopLocationPicking();
          UI.setPickingBannerVisible(false);
        }
      });
    });
  }

  function wireIssuePhotoInput(formEl) {
    const fileInput = formEl.querySelector(".cc-photo-file-input");
    if (fileInput) {
      fileInput.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          UI.showToast("Processing photo...", "info");
          issueSelectedPhoto = await compressImageFile(file, APP_CONFIG.uploads);
          refreshIssuePhotoSection(formEl);
        } catch (err) {
          UI.showToast(err.message || "That photo could not be used.", "warning");
          fileInput.value = "";
        }
      });
    }
    const removeBtn = formEl.querySelector(".cc-photo-remove-btn");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        issueSelectedPhoto = null;
        refreshIssuePhotoSection(formEl);
      });
    }
  }

  function refreshIssuePhotoSection(formEl) {
    const sections = formEl.querySelectorAll(".cc-form-section");
    const photoSection = Array.prototype.find.call(sections, (s) => {
      const h = s.querySelector(".cc-form-section-title");
      return h && h.textContent === "Photo";
    });
    if (!photoSection) return;
    photoSection.innerHTML = '<h4 class="cc-form-section-title">Photo</h4>' + renderIssuePhotoSectionHTML();
    wireIssuePhotoInput(formEl);
  }

  async function submitIssueForm(formEl) {
    if (issueSubmitting) return;

    const issueType = formEl.querySelector('[name="issueType"]').value;
    const severity = formEl.querySelector('[name="severity"]').value;
    const description = formEl.querySelector('[name="description"]').value.trim();

    if (!issueType || !severity || !description) {
      UI.showToast("Please fill in Issue Category, Severity and a description.", "warning");
      return;
    }
    if (issuePickedLat == null || issuePickedLng == null || !isValidCoordinate(issuePickedLat, issuePickedLng)) {
      UI.showToast("Please select a location on the map before submitting.", "warning");
      return;
    }
    const apiURL = APP_CONFIG.googleAppsScript.apiURL;
    if (isPlaceholderValue(apiURL)) {
      UI.showToast("The Apps Script backend is not configured yet. Paste its URL into js/config.js.", "warning");
      return;
    }

    issueSubmitting = true;
    const submitBtn = formEl.querySelector(".cc-form-submit");
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="cc-spinner"></span> Submitting...';

    const relatedPlaceNameField = formEl.querySelector('[name="relatedPlaceName"]');
    const hpField = formEl.querySelector('[name="hp"]');
    const payload = {
      action: "issue",
      issueType, severity, description,
      relatedPlaceName: relatedPlaceNameField ? relatedPlaceNameField.value : "",
      latitude: issuePickedLat,
      longitude: issuePickedLng,
      hp: hpField ? hpField.value : "" // honeypot - always empty for a real human submission
    };
    if (issueSelectedPhoto) {
      payload.photo = { base64: issueSelectedPhoto.base64, mimeType: issueSelectedPhoto.mimeType };
    }

    try {
      const result = await postToAppsScript(apiURL, payload);
      if (!result || result.success !== true) {
        throw new Error((result && result.error) || "The server rejected this report.");
      }

      AppModal.getBody().innerHTML =
        '<div class="cc-form-success"><i class="fa-solid fa-circle-check"></i>' +
        "<p>Thank you - your report has been submitted and is now visible on the map.</p></div>";

      if (typeof CommunityData !== "undefined" && CommunityData.refreshIssues) {
        await CommunityData.refreshIssues();
      }

      setTimeout(() => {
        AppModal.close();
        issueSelectedPhoto = null;
      }, 1400);
    } catch (err) {
      console.error("CoastConnect: issue submission failed.", err);
      UI.showToast("Could not submit this report: " + err.message, "error");
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
    issueSubmitting = false;
  }

  // ------------------------------------------------------------------
  // NEAR ME
  // ------------------------------------------------------------------
  // Only asks for location permission when this is actually called
  // (i.e. only when the user presses the "Near Me" button).
  function runNearMe(onSuccess, onError) {
    if (!("geolocation" in navigator)) {
      onError("Your browser does not support location services.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;
        const results = findNearbyPlaces(userLat, userLng);
        showUserLocationOnMap(userLat, userLng);
        onSuccess({ userLat, userLng, results });
      },
      () => {
        onError("Location permission was not granted. Enable location access to use Near Me.");
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }

  let userLocationMarker = null;
  function showUserLocationOnMap(lat, lng) {
    const map = MapCore.getMap();
    if (!map) return;
    if (userLocationMarker) map.removeLayer(userLocationMarker);
    userLocationMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "coastconnect-you-are-here",
        html: '<span class="coastconnect-pulse coastconnect-pulse-blue"></span>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      })
    }).addTo(map).bindPopup("You are here (approximate).");
  }

  // Straight-line distance search. See the file-header note above for the
  // two different result shapes this can return.
  function findNearbyPlaces(userLat, userLng, limit) {
    const results = [];
    const loaded = DataLoader.getAllLoaded();

    APP_CONFIG.dataFiles
      .filter((def) => def.searchable)
      .forEach((def) => {
        const isEditableCategory = !!APP_CONFIG.editableCategories[def.id];

        if (isEditableCategory && typeof CommunityData !== "undefined" && CommunityData.getCurrentCategoryRecords) {
          // Editable tourism categories: search the CURRENT merged list
          // (existing GIS data + any community override), never the raw
          // GeoJSON alone - an updated place must show its latest name.
          CommunityData.getCurrentCategoryRecords(def.id).forEach((place) => {
            results.push({
              name: place.name,
              datasetName: def.name,
              icon: def.icon,
              lat: place.lat,
              lng: place.lng,
              distanceKm: haversineDistanceKm(userLat, userLng, place.lat, place.lng),
              categoryId: def.id,
              placeId: place.placeId
            });
          });
          return;
        }

        // Non-editable informational layers (cities, transport): search
        // the raw GeoJSON directly, exactly as before.
        const geojson = loaded[def.id];
        if (!geojson) return;
        geojson.features.forEach((feature) => {
          if (!feature.geometry || feature.geometry.type !== "Point") return;
          const [lng, lat] = feature.geometry.coordinates;
          if (!isValidCoordinate(lat, lng)) return;
          results.push({
            name: getPlaceName(feature.properties),
            datasetName: def.name,
            icon: def.icon,
            lat, lng,
            distanceKm: haversineDistanceKm(userLat, userLng, lat, lng),
            def, feature
          });
        });
      });

    results.sort((a, b) => a.distanceKm - b.distanceKm);
    return results.slice(0, limit || 15);
  }

  // ------------------------------------------------------------------
  // GET DIRECTIONS (no API key needed)
  // ------------------------------------------------------------------
  function getDirectionsURL(lat, lng) {
    return "https://www.google.com/maps/dir/?api=1&destination=" + lat + "," + lng;
  }

  return {
    openReportIssueForm,
    startReportIssueFlow,
    runNearMe,
    getDirectionsURL
  };
})();