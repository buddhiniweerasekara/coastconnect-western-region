/*
FILE PURPOSE: "Give Feedback" - an in-page rating/comment form about one
  specific existing, newly-added, or previously-updated tourism place.
WHAT THIS FILE DOES:
  - Google Forms is gone. This file opens the SAME shared modal shell used
    by place-form.js and participation.js (#appModal, via AppModal in
    utils.js), pre-filled with the place the feedback is about, and
    submits straight to the Apps Script backend - no developer-approval
    step, no login, no personally identifying information collected.
  - The question set below intentionally mirrors the old "Community
    Feedback" Google Form almost field-for-field (Overall experience
    required; Accessibility / Cleanliness / Safety / Environmental
    quality / Tourism facilities all optional 1-5 ratings; two optional
    free-text questions) so nothing about WHAT is being measured changes
    - only HOW it is collected. A "Visitor Type" question (already added
      to APP_CONFIG.feedback.visitorTypes back in PART 1) is new.
  - Feedback is about an EXISTING place, so unlike Add Place / Report an
    Issue there is no "click the map" step here - the place's own
    coordinates travel with the submission automatically, read-only.
  - Feedback rows do not create or change a place_id, status, or
    created_at/updated_at on any tourism record. They are their own
    simple log in the "Feedback" sheet tab, and are only ever summarised
    (counts / averages) in Planning Insights - never shown as individual
    identified entries anywhere in the UI.
  - This form also carries the same hidden honeypot field ("hp") used by
    place-form.js and participation.js - see place-form.js's header for
    how it works. Code.gs (PART 8) silently accepts-and-discards any
    feedback submission where this field is non-empty.
MAIN FUNCTIONS:
  Feedback.openFeedbackForm({ placeName, placeId, categoryId, lat, lng })
    - this exact signature is the forward contract that the rewritten
      js/layers.js (PART 6) must call from every eligible place's popup,
      in place of the old Feedback.openFeedbackForm({placeName, placeId,
      lat, lng}) call that still exists (for now) in the OLD js/layers.js.
DEPENDENCIES: config.js (APP_CONFIG.feedback, APP_CONFIG.googleAppsScript),
  utils.js (AppModal, escapeHTML, isPlaceholderValue, postToAppsScript),
  ui.js (UI.showToast).
--------------------------------------------------------------------------
*/

const Feedback = (function () {

  let feedbackContext = null; // { placeName, placeId, categoryId, lat, lng }
  let feedbackSubmitting = false;

  const RATING_FIELDS = [
    { key: "accessibility", label: "Accessibility" },
    { key: "cleanliness", label: "Cleanliness" },
    { key: "safety", label: "Safety" },
    { key: "environmentalQuality", label: "Environmental Quality" },
    { key: "touristFacilities", label: "Tourism Facilities / Infrastructure" }
  ];

  // ------------------------------------------------------------------
  // PUBLIC ENTRY POINT - called from a place's popup (layers.js)
  // ------------------------------------------------------------------
  function openFeedbackForm({ placeName, placeId, categoryId, lat, lng } = {}) {
    feedbackContext = {
      placeName: placeName || "",
      placeId: placeId || "",
      categoryId: categoryId || "",
      lat: (typeof lat === "number") ? lat : null,
      lng: (typeof lng === "number") ? lng : null
    };
    renderFeedbackForm();
  }

  function renderFeedbackForm() {
    const body = AppModal.open("Give Feedback");
    if (!body) return;

    const formEl = document.createElement("form");
    formEl.className = "cc-place-form"; // re-uses the shared form/section/field CSS
    formEl.noValidate = true;
    formEl.innerHTML = buildFeedbackFormHTML();
    body.appendChild(formEl);

    wireFeedbackForm(formEl);
  }

  function buildFeedbackFormHTML() {
    const ctx = feedbackContext || {};
    const cfg = APP_CONFIG.feedback;

    let visitorOptions = '<option value="">Select...</option>';
    cfg.visitorTypes.forEach((v) => { visitorOptions += "<option>" + escapeHTML(v) + "</option>"; });

    const ratingFieldsHTML = RATING_FIELDS.map((f) =>
      '<div class="cc-field-group">' +
        '<label class="cc-field-label">' + escapeHTML(f.label) + "</label>" +
        buildRatingSelect(f.key, false) +
      "</div>"
    ).join("");

    return (
      '<div class="cc-form-section">' +
        '<h4 class="cc-form-section-title">About</h4>' +
        '<p class="cc-field-hint">Sharing feedback about: <strong>' +
          escapeHTML(ctx.placeName || "this place") + "</strong></p>" +
        '<p class="cc-field-hint">This feedback is published immediately and is not reviewed before appearing ' +
          "in Planning Insights. Please do not include your name or contact details.</p>" +
      "</div>" +

      '<div class="cc-form-section">' +
        '<h4 class="cc-form-section-title">About You</h4>' +
        '<div class="cc-field-group">' +
          '<label class="cc-field-label">Visitor Type<span class="cc-required">*</span></label>' +
          '<select class="cc-field-input" name="visitorType" required>' + visitorOptions + "</select>" +
        "</div>" +
      "</div>" +

      '<div class="cc-form-section">' +
        '<h4 class="cc-form-section-title">Ratings</h4>' +
        '<div class="cc-field-group">' +
          '<label class="cc-field-label">Overall Experience<span class="cc-required">*</span></label>' +
          buildRatingSelect("overallExperience", true) +
        "</div>" +
        ratingFieldsHTML +
      "</div>" +

      '<div class="cc-form-section">' +
        '<h4 class="cc-form-section-title">Comments (Optional)</h4>' +
        '<div class="cc-field-group">' +
          '<label class="cc-field-label">What do you like about this place?</label>' +
          '<textarea class="cc-field-input cc-field-textarea" name="likedComments"></textarea>' +
        "</div>" +
        '<div class="cc-field-group">' +
          '<label class="cc-field-label">What needs improvement?</label>' +
          '<textarea class="cc-field-input cc-field-textarea" name="improvementComments"></textarea>' +
        "</div>" +
      "</div>" +

      renderHoneypotHTML() +

      '<div class="cc-form-actions">' +
        '<button type="button" class="cc-form-cancel cc-text-btn">Cancel</button>' +
        '<button type="submit" class="cc-form-submit">Submit Feedback</button>' +
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

  function buildRatingSelect(name, required) {
    let options = required
      ? '<option value="">Select a rating...</option>'
      : '<option value="">Not Rated</option>';
    for (let i = 1; i <= 5; i++) {
      const labels = { 1: "1 (Poor)", 2: "2", 3: "3 (Average)", 4: "4", 5: "5 (Excellent)" };
      options += '<option value="' + i + '">' + labels[i] + "</option>";
    }
    return '<select class="cc-field-input" name="' + name + '"' + (required ? " required" : "") + ">" + options + "</select>";
  }

  function wireFeedbackForm(formEl) {
    formEl.querySelector(".cc-form-cancel").addEventListener("click", () => AppModal.close());
    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      submitFeedbackForm(formEl);
    });
  }

  async function submitFeedbackForm(formEl) {
    if (feedbackSubmitting) return;

    const visitorType = formEl.querySelector('[name="visitorType"]').value;
    const overallExperience = formEl.querySelector('[name="overallExperience"]').value;

    if (!visitorType || !overallExperience) {
      UI.showToast("Please select a Visitor Type and an Overall Experience rating.", "warning");
      return;
    }

    const apiURL = APP_CONFIG.googleAppsScript.apiURL;
    if (isPlaceholderValue(apiURL)) {
      UI.showToast("The Apps Script backend is not configured yet. Paste its URL into js/config.js.", "warning");
      return;
    }

    feedbackSubmitting = true;
    const submitBtn = formEl.querySelector(".cc-form-submit");
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="cc-spinner"></span> Submitting...';

    const ctx = feedbackContext || {};
    const hpField = formEl.querySelector('[name="hp"]');
    const payload = {
      action: "feedback",
      placeName: ctx.placeName || "",
      placeId: ctx.placeId || "",
      categoryId: ctx.categoryId || "",
      latitude: (typeof ctx.lat === "number") ? ctx.lat : "",
      longitude: (typeof ctx.lng === "number") ? ctx.lng : "",
      visitorType,
      overallExperience,
      likedComments: formEl.querySelector('[name="likedComments"]').value.trim(),
      improvementComments: formEl.querySelector('[name="improvementComments"]').value.trim(),
      hp: hpField ? hpField.value : "" // honeypot - always empty for a real human submission
    };
    RATING_FIELDS.forEach((f) => {
      payload[f.key] = formEl.querySelector('[name="' + f.key + '"]').value;
    });

    try {
      const result = await postToAppsScript(apiURL, payload);
      if (!result || result.success !== true) {
        throw new Error((result && result.error) || "The server rejected this feedback.");
      }

      AppModal.getBody().innerHTML =
        '<div class="cc-form-success"><i class="fa-solid fa-circle-check"></i>' +
        "<p>Thank you for your feedback - it has been recorded.</p></div>";

      setTimeout(() => AppModal.close(), 1400);
    } catch (err) {
      console.error("CoastConnect: feedback submission failed.", err);
      UI.showToast("Could not submit this feedback: " + err.message, "error");
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
    feedbackSubmitting = false;
  }

  return { openFeedbackForm };
})();