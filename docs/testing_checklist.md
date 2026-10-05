# Testing Checklist (A-M)

A complete end-to-end test plan for CoastConnect, in a sensible order
(each section builds on the last). Run through this once after you
finish deployment (`google-apps-script/README_Google_Setup.md`), and
again any time you change `Code.gs` or `js/config.js`. Useful for your
viva too - it doubles as a walkthrough of every feature.

Open the browser console (F12) before you start - CoastConnect logs a
clear message for almost everything (datasets loaded/skipped, community
data refreshes, submission failures), which makes every check below
faster to confirm.

---

### A. Initial load and graceful degradation

1. Open `index.html` with Live Server with the `data/` folder **empty**.
   The map should still load (base layer, UI, panels) without crashing,
   and the console should log one warning per missing `.geojson` file.
2. Add your real GeoJSON files to `data/` one at a time and reload -
   confirm each layer appears in the **Layers** panel as soon as its
   file is present, with no code changes needed.
3. With the Apps Script URL still set to the placeholder in
   `js/config.js`, confirm the Community panel shows zero community
   activity and the console explains why, rather than throwing an
   error.

### B. Layers panel and legend

1. Open the **Layers** panel - every dataset you have added should
   appear, grouped under "Base", "Tourism Attractions", "Tourism
   Services", "Transport and Accessibility", "Natural Features", and
   "Community Reports" (once at least one issue exists - see section G).
2. Toggle each checkbox off and on - its markers should
   disappear/reappear on the map immediately.
3. Open the legend and confirm its colours/icons match what is drawn
   on the map.

### C. Add Tourism Place (the core participatory flow)

1. Click **+ Add Tourism Place** (floating button or Community panel).
2. Pick any category, click a point on the map inside the Western
   Province boundary, confirm the location.
3. Fill in all required fields (marked `*`), attach a photo (optional),
   submit.
4. Expect: a "Place added successfully" message, the modal closes, and
   within a moment a **new marker appears on the map** with a
   **"Community Added"** badge in its popup - showing the name,
   description, category fields, and (if attached) the photo.
5. Open your Google Sheet's matching category tab - confirm a new row
   appeared with `place_id` (matching this category's prefix, but in
   the long timestamp+random pattern, not a short QGIS-style id),
   `status = newly_added`, `created_at` and `updated_at` both set to
   "now", and every field you typed.
6. Reload the whole page (not just re-open the panel) - the new place
   should still be there, now loaded from the Sheet via
   `CommunityData.loadAll()` on startup, not just held in memory from
   the submission.

### D. Edit Information - on an original (pre-existing) GIS place

1. Click an existing marker that came from your own QGIS data (status
   badge should show nothing special - it is an "existing" place).
2. Click **Edit Information**, change the name or a field, submit.
3. Expect: the marker's popup now shows a **"Community Updated"**
   badge, with your changed value.
4. Check the Sheet - a **new row** was appended (the Sheet is append-
   only; it is never edited in place) with `status = updated`,
   `place_id` equal to the GeoJSON feature's own `place_id` (this is
   why Part 1's QGIS preparation matters - see
   `docs/qgis_data_preparation.md`), `created_at` set to "now" (since
   no prior Sheet row existed for this place), and `updated_at` also
   "now".
5. Confirm there is still only **one** marker on the map for this
   place - not two.

### E. Edit Information - editing a place twice

1. Edit the same place from Step D again (a second time).
2. Check the Sheet again: there should now be a **third** row for this
   `place_id` (the original edit from Step D plus this new one), but
   `Code.gs`'s `?action=category` resolves them down to only the latest
   one - confirm by reloading the map that only the newest change is
   shown, and that `created_at` on this latest row now matches the
   `created_at` from Step D's row (preserved), while `updated_at`
   advanced to "now" again.

### F. Give Feedback

1. Open any place's popup (existing, newly-added, or updated) and click
   **Give Feedback**.
2. Submit with only the required Visitor Type + Overall Experience
   filled in (leave the optional ratings as "Not Rated" and comments
   blank) - should succeed.
3. Submit a second feedback on a different place with every optional
   rating filled in and both comments written.
4. Check the **Feedback** Sheet tab - two new rows, blank cells for any
   rating left as "Not Rated".
5. Open **Planning Insights** - confirm the feedback count increased and
   the ratings chart reflects the numeric ratings you entered.

### G. Report an Issue (both entry points)

1. From an existing place's popup, click **Report an Issue** - the
   location and related place name should already be filled in; submit
   with a category, severity, and description.
2. From the floating **! Report Issue** button (or Community panel),
   start a report with no place pre-selected - confirm you are asked to
   click the map first, exactly like Add Place.
3. After both submissions, check the **Issues** Sheet tab for two new
   rows, and confirm both now appear on the map as markers under the
   "Community Reports" legend/layer group, and in the issue-severity
   chart in Planning Insights.

### H. Near Me

1. Click **Near Me** (first time will prompt for location permission -
   allow it).
2. Confirm a "you are here" marker appears and a sorted-by-distance list
   of nearby places is shown, spanning both informational layers
   (e.g. nearby cities/transport) and editable tourism categories
   (including anything you just added in Steps C-E).
3. Click a result from an editable category - the map should zoom to it
   and open its popup correctly, even if it is inside a marker cluster.
4. Deny location permission (browser settings) and click **Near Me**
   again - confirm a clear message is shown instead of a silent failure.

### I. Search

1. Type the name of a place you added in Step C into the search box -
   it should appear in results immediately (no reload needed, thanks to
   `Search.rebuildIndex()` being called after every submission).
2. Type the name of an original GIS place and an informational place
   (e.g. a city) - both should be found.
3. Click a result - map zooms in, marker briefly pulses, and its popup
   opens.

### J. Duplicate-place warning

1. Start **Add Tourism Place** in the same category as, and very close
   to (within the configured `duplicateCheck.maxDistanceMeters`, default
   60m), an existing or community-added place with a similar name.
2. Type a similar name and tab out of (blur) the Name field - a soft
   "a similar place may already exist" notice should appear.
3. Confirm this warning **never blocks submission** - you can still
   submit successfully if you choose to.
4. While editing a place, confirm it never warns against itself.

### K. Photo upload and compression

1. Attach a large photo (several MB, straight from a phone camera) to
   an Add Place or Report Issue submission.
2. Confirm the browser compresses it (check Network tab or just note
   the submission succeeds quickly) before it reaches the server.
3. Confirm the photo displays correctly in the resulting popup, and
   that the file appears in your `CoastConnect_Photos` Drive folder,
   shared as "Anyone with the link - Viewer".
4. Try an unsupported file type (e.g. a `.gif` or `.pdf` renamed to
   `.jpg`) - should be rejected client-side with a clear message before
   it is ever sent.

### L. Honeypot anti-abuse (manual simulation)

Since the hidden `hp` field is never visible or reachable by tabbing
through the form, the only way to test it yourself is to simulate what
a bot would do:

1. Open any one of the three forms (Add Place, Report Issue, Give
   Feedback).
2. Open the browser console and run, for example:
```js
   document.querySelector('[name="hp"]').value = "spam";
```
3. Fill in the rest of the form normally and submit.
4. Expect: the UI shows the **same "success" message as always** (the
   honeypot check in `Code.gs` deliberately returns `success: true`
   with no id, so a bot gets no signal it was caught), but **no new row
   appears** in the Sheet and the "place" never shows up on the map.
   This confirms the check is silently discarding the submission rather
   than failing loudly.

### M. Planning Insights, exports, and final sanity check

1. Open **Planning Insights** after completing Steps C-G and confirm:
   the stat tiles (existing/newly added/updated places, feedback count,
   issues reported, high-severity count) match what you actually
   submitted; the category bar chart, the "Places by Status" doughnut,
   the issue-severity doughnut, and the ratings bar chart all render
   without errors in the console.
2. Trigger each export function from the Community panel (CSV and
   GeoJSON for places, CSV and GeoJSON for issues) and open the
   downloaded files - confirm the CSVs have consistent columns across
   categories (via the shared `extra_fields` JSON column) and the
   GeoJSON files open correctly in QGIS.
3. As a final sanity check, reload the page one more time from a clean
   browser tab (or a private/incognito window) and confirm everything
   you added across Steps C-G is still there, correctly merged with
   your original GIS data, with no duplicate markers anywhere on the
   map.

   