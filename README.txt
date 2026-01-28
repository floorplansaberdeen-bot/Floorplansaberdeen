Floorplansaberdeen – PROD Package (index + admin)

Included files:
- index.html        Public map (polls Google Sheet via JSONP every 30 seconds)
- admin.html        Admin editor (click stand -> list filters to that stand)
- .nojekyll         Ensures GitHub Pages serves files as-is

IMPORTANT:
1) This package expects event_plan.svg to be in the SAME folder as index.html/admin.html.
2) This package does NOT embed the SVG. You can replace event_plan.svg any time (CAD export) without changing code.
3) Google Apps Script Web App URL is currently set to:
   https://script.google.com/macros/s/AKfycbxEq83BUYJ-oewP_2lPFL0tyol4veM2mhukSTTMCaKCZgEJS5m-f8Jqy1EO_bDc3q3a/exec

Admin behavior:
- Click a stand on the plan:
  - selects that stand
  - filters the table to show ONLY that stand
- Use "Show all" to return to full list.
- Saves write immediately to the Sheet using POST.
- Polls the Sheet so multiple admins see updates.

Multi-admin note:
- Two admins can edit different stands safely.
- If two admins edit the same stand, last write wins.
- The admin page performs a refresh-before-save and will warn if the stand changed since you selected it.

Deployment:
- Upload index.html, admin.html, .nojekyll, and event_plan.svg to the repo root.
- GitHub Pages should serve from the root of the main branch.
- Use cache-busting during testing: ?v=17

After deploying:
- Verify public sync: change a stand in the Sheet, wait <= 30s, public colors update.
- Verify admin: click a stand -> list shows only that stand; edit company/status; Save; public updates on next poll.
