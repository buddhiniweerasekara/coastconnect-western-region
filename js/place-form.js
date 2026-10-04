/*
FILE PURPOSE: THE single reusable dynamic Add/Edit Tourism Place form.
WHAT THIS FILE DOES:
  - "Add Tourism Place": shows a category picker (Restaurant, Beach, ...),
    then click-to-pick a map location, then opens the right form for that
    category, built entirely from APP_CONFIG.editableCategories - there
    is only ONE form-building function in this whole project, not 11.
  - "Edit Information" (called from a popup in layers.js): opens the
    exact same form, pre-filled with the place's current values, with
    its category locked and its place_id carried silently.
  - Lets the user replace the map location via "Change Location" without
    losing anything else they already typed.
  - Lets the user attach one photo from their own device (no Google
    login), compresses it in the browser (utils.js -> compressImageFile),
    and previews it before submitting.
  - Shows a soft "a similar place may already exist" warning (never
    blocks submission) by comparing the typed name + picked location
    against the categories' current merged data.
  - Validates required fields client-side (Apps Script validates again,
    server-side, because the frontend is never trusted alone).
  - Submits the finished record as JSON to the Apps Script backend
    (utils.js -> postToAppsScript) with action "add" or "edit", then asks
    community-data.js to refresh just that one category.
  - Carries a hidden honeypot field ("hp") in every submission. A human
    never sees or fills it (it sits off-screen via inline style and is
    skipped by tab order), but a simple bot script that blindly fills
    every input in a form will fill it too. Code.gs (PART 8) silently
    accepts-and-discards any submission where this field is non-empty.
MAIN FUNCTIONS: PlaceForm.startAddFlow, PlaceForm.startEditFlow
DEPENDENCIES: Leaflet (via map.js), config.js, utils.js (AppModal,
  compressImageFile, postToAppsScript, textSimilarity, escapeHTML,
  haversineDistanceKm, isValidCoordinate, isPlaceholderValue), map.js
  (MapCore.startLocationPicking/stopLocationPicking), ui.js (UI.showToast,
  UI.setPickingBannerVisible, UI.showLocationConfirmDialog),
  community-data.js (CommunityData.getCurrentCategoryRecords /
  refreshCategory - used if that file has loaded; both calls are
  defensive so this file works even before community-data.js is wired).
--------------------------------------------------------------------------
MARKUP CONVENTIONS (matches the CSS classes in css/style.css):
  .cc-place-form                 the whole <form>
  .cc-form-section               one labelled section (Location, Basic
                                  Information, Category Details, Photo)
  .cc-form-section-title         that section's small heading
  .cc-field-group                one question: label + input/select/textarea
  .cc-field-input                every text/url/select/textarea input
  .cc-required                   the red "*" on a required field's label
  .cc-coord-display               read-only "Latitude: ... Longitude: ..."
  .cc-change-location-btn        re-opens map-click picking
  .cc-photo-input-label          the "choose a photo" control
  .cc-photo-preview / cc-photo-current   photo previews
  .cc-duplicate-warning          soft "similar place" notice
  .cc-form-actions / .cc-form-submit / .cc-form-cancel   bottom buttons
--------------------------------------------------------------------------
*/

const PlaceForm = (function () {

  // ------------------------------------------------------------------
  // MODULE STATE (there is only ever one form open at a time, so plain
  // variables are enough - no need for a class/instance per form)
  // ------------------------------------------------------------------
  let formMode = null;        // "add" | "edit"
  let activeCategoryId = null;
  let activePlaceId = null;   // null while formMode === "add"
  let pickedLat = null;
  let pickedLng = null;
  let existingPhotoURL = "";  // edit mode only - the place's current photo
  let selectedPhoto = null;   // { base64, mimeType, previewDataURL } | null
  let isSubmitting = false;

  function resetState() {
    formMode = null;
    activeCategoryId = null;
    activePlaceId = null;
    pickedLat = null;
    pickedLng = null;
    existingPhotoURL = "";
    selectedPhoto = null;
    isSubmitting = false;
  }

  // ------------------------------------------------------------------
  // ENTRY POINT 1: ADD TOURISM PLACE
  // ------------------------------------------------------------------
  function startAddFlow() {
    resetState();
    formMode = "add";
    openCategoryPicker();
  }

  // ------------------------------------------------------------------
  // ENTRY POINT 2: EDIT INFORMATION (called by layers.js's popup button)
  // ------------------------------------------------------------------
  // opts = {
  //   categoryId: "restaurants",
  //   placeId: "RES_0001",
  //   lat: 6.9271, lng: 79.8612,
  //   values: { name, address, website, desc, ...category fields... },
  //   photoURL: "https://..." | ""
  // }
  function startEditFlow(opts) {
    resetState();
    formMode = "edit";
    activeCategoryId = opts.categoryId;
    activePlaceId = opts.placeId;
    pickedLat = opts.lat;
    pickedLng = opts.lng;
    existingPhotoURL = opts.photoURL || "";
    openForm(opts.values || {});
  }

  // ------------------------------------------------------------------
  // STEP 1 (Add only): CATEGORY PICKER
  // ------------------------------------------------------------------
  function openCategoryPicker() {
    const body = AppModal.open("Add Tourism Place");
    if (!body) return;

    const intro = document.createElement("p");
    intro.className = "cc-small-note";
    intro.textContent = "Choose the kind of tourism place you want to add.";
    body.appendChild(intro);

    const grid = document.createElement("div");
    grid.className = "cc-category-grid";

    APP_CONFIG.editableCategoryOrder.forEach((categoryId) => {
      const schema = APP_CONFIG.editableCategories[categoryId];
      const datasetDef = APP_CONFIG.dataFiles.find((d) => d.id === categoryId);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cc-category-btn";
      btn.innerHTML =
        '<i class="fa-solid ' + (datasetDef ? datasetDef.icon : "fa-map-pin") + '"></i>' +
        "<span>" + escapeHTML(schema.label) + "</span>";
      btn.addEventListener("click", () => {
        activeCategoryId = categoryId;
        AppModal.close();
        beginLocationPick({});
      });
      grid.appendChild(btn);
    });

    body.appendChild(grid);
  }

  // ------------------------------------------------------------------
  // STEP 2: MAP-CLICK LOCATION SELECTION
  // ------------------------------------------------------------------
  // Used both for the very first location pick (Add Place) and for the
  // "Change Location" button inside an already-open form (Add or Edit).
  // preservedValues carries across whatever the user had already typed,
  // so changing the location never throws away their work.
  function beginLocationPick(preservedValues) {
    const schema = APP_CONFIG.editableCategories[activeCategoryId];

    UI.showToast("Click the map to select the location.", "info");
    UI.setPickingBannerVisible(true, "Click the map to select the location of this " + schema.label.toLowerCase() + ".");

    MapCore.startLocationPicking((lat, lng) => {
      UI.showLocationConfirmDialog({
        lat, lng,
        title: "Use this location?",
        onConfirm: () => {
          MapCore.stopLocationPicking();
          UI.setPickingBannerVisible(false);
          pickedLat = lat;
          pickedLng = lng;
          openForm(preservedValues || {});
        },
        onReposition: () => {
          UI.showToast("Click a new location on the map.", "info");
        },
        onCancel: () => {
          MapCore.stopLocationPicking();
          UI.setPickingBannerVisible(false);
          // If this cancel happened mid-Add-Place (no form has been shown
          // yet), there is nothing left open - the user simply starts
          // again from "+ Add Tourism Place" if they change their mind.
        }
      });
    });
  }

  // ------------------------------------------------------------------
  // STEP 3: THE FORM ITSELF
  // ------------------------------------------------------------------
  function openForm(prefillValues) {
    const schema = APP_CONFIG.editableCategories[activeCategoryId];
    const title = formMode === "add" ? "Add " + schema.label : "Edit Information - " + schema.label;

    const body = AppModal.open(title);
    if (!body) return;

    const formEl = document.createElement("form");
    formEl.className = "cc-place-form";
    formEl.noValidate = true; // we show our own validation messages (section: validation)
    formEl.innerHTML = renderFormHTML(schema, prefillValues || {});
    body.appendChild(formEl);

    wireForm(formEl, schema);
  }

  function renderFormHTML(schema, values) {
    const coordText = (pickedLat != null && pickedLng != null)
      ? "Latitude: " + pickedLat.toFixed(6) + "    Longitude: " + pickedLng.toFixed(6)
      : "No location selected.";

    const nameField = { key: "name", label: schema.nameLabel, type: "text", required: true };
    const addressField = schema.hasAddress
      ? { key: "address", label: schema.addressLabel || "Address", type: "text", required: false }
      : null;
    const websiteField = schema.hasWebsite
      ? { key: "website", label: "Website", type: "url", required: false }
      : null;
    const descField = { key: "desc", label: "Short Description", type: "textarea", required: !!schema.descRequired };

    let basicHTML = renderFieldHTML(nameField, values.name);
    if (addressField) basicHTML += renderFieldHTML(addressField, values.address);
    if (websiteField) basicHTML += renderFieldHTML(websiteField, values.website);
    basicHTML += renderFieldHTML(descField, values.desc);

    let categoryHTML = "";
    schema.fields.forEach((field) => {
      categoryHTML += renderFieldHTML(field, values[field.key]);
    });

    return (
      '<div class="cc-form-section">' +
        '<h4 class="cc-form-section-title">Location</h4>' +
        '<div class="cc-coord-display"><span>' + escapeHTML(coordText) + "</span>" +
        '<button type="button" class="cc-change-location-btn">Change Location</button></div>' +
      "</div>" +

      '<div class="cc-form-section">' +
        '<h4 class="cc-form-section-title">Basic Information</h4>' +
        basicHTML +
      "</div>" +

      (categoryHTML
        ? '<div class="cc-form-section">' +
            '<h4 class="cc-form-section-title">Category Details</h4>' +
            categoryHTML +
          "</div>"
        : "") +

      '<div class="cc-form-section">' +
        '<h4 class="cc-form-section-title">Photo</h4>' +
        renderPhotoSectionHTML() +
      "</div>" +

      '<div id="duplicateWarningSlot"></div>' +

      renderHoneypotHTML() +

      '<div class="cc-form-actions">' +
        '<button type="button" class="cc-form-cancel cc-text-btn">Cancel</button>' +
        '<button type="submit" class="cc-form-submit"><span class="cc-form-submit-label">' +
        (formMode === "add" ? "Submit New Place" : "Save Changes") +
        "</span></button>" +
      "</div>"
    );
  }

  // A hidden anti-abuse field - see the file header note on the honeypot.
  // It is positioned off-screen (not display:none, which some very old
  // assistive tech still exposes) and pulled out of tab order, so a
  // human filling in the form in the normal way never encounters it.
  function renderHoneypotHTML() {
    return (
      '<div class="cc-hp-field" aria-hidden="true" ' +
      'style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;">' +
        '<label>Leave this field blank</label>' +
        '<input type="text" class="cc-field-input" name="hp" tabindex="-1" autocomplete="off">' +
      "</div>"
    );
  }

  // Renders ONE question (text / url / textarea / select) as a
  // .cc-field-group. This single function is what lets 11 different
  // categories share one form-builder instead of 11 hand-written forms.
  function renderFieldHTML(field, value) {
    const requiredMark = field.required ? '<span class="cc-required">*</span>' : "";
    const safeValue = (value === undefined || value === null) ? "" : escapeHTML(value);

    if (field.type === "select") {
      let optionsHTML = '<option value="">Select...</option>';
      field.options.forEach((opt) => {
        const selected = String(value || "") === opt ? " selected" : "";
        optionsHTML += '<option value="' + escapeHTML(opt) + '"' + selected + ">" + escapeHTML(opt) + "</option>";
      });
      return (
        '<div class="cc-field-group">' +
        '<label class="cc-field-label">' + escapeHTML(field.label) + requiredMark + "</label>" +
        '<select class="cc-field-input" name="' + field.key + '"' + (field.required ? " required" : "") + ">" +
        optionsHTML + "</select></div>"
      );
    }

    if (field.type === "textarea") {
      return (
        '<div class="cc-field-group">' +
        '<label class="cc-field-label">' + escapeHTML(field.label) + requiredMark + "</label>" +
        '<textarea class="cc-field-input cc-field-textarea" name="' + field.key + '"' +
        (field.required ? " required" : "") + ">" + safeValue + "</textarea></div>"
      );
    }

    const inputType = field.type === "url" ? "url" : "text";
    return (
      '<div class="cc-field-group">' +
      '<label class="cc-field-label">' + escapeHTML(field.label) + requiredMark + "</label>" +
      '<input class="cc-field-input" type="' + inputType + '" name="' + field.key + '" value="' + safeValue + '"' +
      (field.required ? " required" : "") + "></div>"
    );
  }

  function renderPhotoSectionHTML() {
    let html = "";
    if (selectedPhoto) {
      html +=
        '<div class="cc-photo-preview-wrap">' +
          '<img class="cc-photo-preview" src="' + selectedPhoto.previewDataURL + '" alt="Selected photo preview">' +
          '<button type="button" class="cc-photo-remove-btn" title="Remove selected photo"><i class="fa-solid fa-xmark"></i></button>' +
        "</div>";
    } else if (existingPhotoURL) {
      html +=
        '<div class="cc-photo-current">' +
          '<img src="' + escapeHTML(existingPhotoURL) + '" alt="Current photo" onerror="this.closest(\'.cc-photo-current\').remove()">' +
          "<span>Current photo - choose a new one below to replace it.</span>" +
        "</div>";
    }
    html +=
      '<div class="cc-photo-input-wrap">' +
        '<label class="cc-photo-input-label">' +
          '<input type="file" accept="image/jpeg,image/png,image/webp" class="cc-photo-file-input">' +
          '<i class="fa-solid fa-camera"></i> Click to choose a photo (optional, JPEG/PNG/WEBP)' +
        "</label>" +
      "</div>";
    return html;
  }

  // ------------------------------------------------------------------
  // WIRING THE FORM'S INTERACTIVE PARTS
  // ------------------------------------------------------------------
  function wireForm(formEl, schema) {
    wireChangeLocationButton(formEl);
    wirePhotoInput(formEl);

    formEl.querySelector(".cc-form-cancel").addEventListener("click", () => {
      AppModal.close();
      resetState();
    });

    const nameInput = formEl.querySelector('[name="name"]');
    if (nameInput) {
      nameInput.addEventListener("blur", () => runDuplicateCheck(formEl));
    }

    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      submitForm(formEl, schema);
    });
  }

  function wireChangeLocationButton(formEl) {
    const btn = formEl.querySelector(".cc-change-location-btn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const preserved = collectFormValues(formEl);
      AppModal.close();
      beginLocationPick(preserved);
    });
  }

  function wirePhotoInput(formEl) {
    const fileInput = formEl.querySelector(".cc-photo-file-input");
    if (fileInput) {
      fileInput.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          UI.showToast("Processing photo...", "info");
          selectedPhoto = await compressImageFile(file, APP_CONFIG.uploads);
          refreshPhotoSection(formEl);
        } catch (err) {
          UI.showToast(err.message || "That photo could not be used.", "warning");
          fileInput.value = "";
        }
      });
    }
    const removeBtn = formEl.querySelector(".cc-photo-remove-btn");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        selectedPhoto = null;
        refreshPhotoSection(formEl);
      });
    }
  }

  // Re-renders ONLY the Photo section in place, so anything the user has
  // already typed in the rest of the form is left completely untouched.
  function refreshPhotoSection(formEl) {
    const section = findSectionByTitle(formEl, "Photo");
    if (!section) return;
    section.innerHTML = '<h4 class="cc-form-section-title">Photo</h4>' + renderPhotoSectionHTML();
    wirePhotoInput(formEl);
  }

  function findSectionByTitle(formEl, titleText) {
    const sections = formEl.querySelectorAll(".cc-form-section");
    return Array.prototype.find.call(sections, (s) => {
      const h = s.querySelector(".cc-form-section-title");
      return h && h.textContent === titleText;
    });
  }

  function collectFormValues(formEl) {
    const values = {};
    formEl.querySelectorAll(".cc-field-input").forEach((el) => {
      if (el.name) values[el.name] = el.value;
    });
    return values;
  }

  // ------------------------------------------------------------------
  // POSSIBLE-DUPLICATE WARNING (soft - never blocks submission)
  // ------------------------------------------------------------------
  // Compares the typed name + picked location against this category's
  // CURRENT data (existing GIS places plus any community overrides,
  // supplied by community-data.js). If community-data.js has not loaded
  // yet, this check is simply skipped - it is a helpful hint, not a
  // required safety control.
  function runDuplicateCheck(formEl) {
    const slot = formEl.querySelector("#duplicateWarningSlot");
    if (!slot) return;
    slot.innerHTML = "";

    const nameInput = formEl.querySelector('[name="name"]');
    const nameValue = nameInput ? nameInput.value : "";
    if (!nameValue.trim() || pickedLat == null || pickedLng == null) return;
    if (typeof CommunityData === "undefined" || !CommunityData.getCurrentCategoryRecords) return;

    const candidates = CommunityData.getCurrentCategoryRecords(activeCategoryId) || [];
    const match = candidates.find((place) => {
      if (formMode === "edit" && place.placeId === activePlaceId) return false; // never warn against itself
      const distanceM = haversineDistanceKm(pickedLat, pickedLng, place.lat, place.lng) * 1000;
      if (distanceM > APP_CONFIG.duplicateCheck.maxDistanceMeters) return false;
      return textSimilarity(nameValue, place.name) >= APP_CONFIG.duplicateCheck.nameSimilarityThreshold;
    });

    if (match) {
      slot.innerHTML =
        '<div class="cc-duplicate-warning"><i class="fa-solid fa-triangle-exclamation"></i>' +
        '<span>A similar place ("' + escapeHTML(match.name) + '") may already exist very close to this location. ' +
        "If this is the same place, consider using Edit Information on it instead of adding a new one.</span></div>";
    }
  }

  // ------------------------------------------------------------------
  // VALIDATION (client-side convenience only - Apps Script validates
  // again, server-side, because the frontend is never trusted alone)
  // ------------------------------------------------------------------
  function validateForm(formEl, schema) {
    formEl.querySelectorAll(".cc-field-input").forEach((el) => el.classList.remove("cc-field-input-invalid"));
    const invalidFields = [];

    const nameInput = formEl.querySelector('[name="name"]');
    if (!nameInput.value.trim()) invalidFields.push(nameInput);

    if (schema.descRequired) {
      const descInput = formEl.querySelector('[name="desc"]');
      if (!descInput.value.trim()) invalidFields.push(descInput);
    }

    schema.fields.forEach((field) => {
      if (!field.required) return;
      const input = formEl.querySelector('[name="' + field.key + '"]');
      if (input && !input.value) invalidFields.push(input);
    });

    if (pickedLat == null || pickedLng == null || !isValidCoordinate(pickedLat, pickedLng)) {
      UI.showToast("Please select a location on the map before submitting.", "warning");
      return false;
    }

    if (invalidFields.length > 0) {
      invalidFields.forEach((el) => el.classList.add("cc-field-input-invalid"));
      UI.showToast("Please fill in all required fields (marked with *).", "warning");
      invalidFields[0].focus();
      return false;
    }
    return true;
  }

  // ------------------------------------------------------------------
  // SUBMIT
  // ------------------------------------------------------------------
  async function submitForm(formEl, schema) {
    if (isSubmitting) return; // guards against a double click / double submit
    if (!validateForm(formEl, schema)) return;

    const apiURL = APP_CONFIG.googleAppsScript.apiURL;
    if (isPlaceholderValue(apiURL)) {
      UI.showToast("The Apps Script backend is not configured yet. Paste its URL into js/config.js.", "warning");
      return;
    }

    isSubmitting = true;
    const submitBtn = formEl.querySelector(".cc-form-submit");
    const originalLabel = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="cc-spinner"></span> Saving...';

    const values = collectFormValues(formEl);
    const payload = {
      action: formMode === "add" ? "add" : "edit",
      category: activeCategoryId,
      placeId: formMode === "edit" ? activePlaceId : null,
      latitude: pickedLat,
      longitude: pickedLng,
      name: values.name || "",
      address: values.address || "",
      website: values.website || "",
      desc: values.desc || "",
      hp: values.hp || "" // honeypot - always empty for a real human submission
    };
    schema.fields.forEach((field) => { payload[field.key] = values[field.key] || ""; });
    if (selectedPhoto) {
      payload.photo = { base64: selectedPhoto.base64, mimeType: selectedPhoto.mimeType };
    }

    try {
      const result = await postToAppsScript(apiURL, payload);
      if (!result || result.success !== true) {
        throw new Error((result && result.error) || "The server rejected this submission.");
      }

      showSuccessMessage(formMode === "add" ? "Place added successfully." : "Place information updated successfully.");

      if (typeof CommunityData !== "undefined" && CommunityData.refreshCategory) {
        await CommunityData.refreshCategory(activeCategoryId);
      }

      setTimeout(() => {
        AppModal.close();
        resetState();
      }, 1400);
    } catch (err) {
      console.error("CoastConnect: place submission failed.", err);
      UI.showToast("Could not save this place: " + err.message, "error");
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalLabel;
      isSubmitting = false;
      return;
    }
    isSubmitting = false;
  }

  function showSuccessMessage(message) {
    const body = AppModal.getBody();
    if (!body) return;
    body.innerHTML =
      '<div class="cc-form-success"><i class="fa-solid fa-circle-check"></i><p>' + escapeHTML(message) + "</p></div>";
  }

  return { startAddFlow, startEditFlow };
})();