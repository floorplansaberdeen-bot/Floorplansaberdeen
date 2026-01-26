# Exhibition Stand Tracker (Google Sheets shared data)

## Files
- `index.html`  -> Public view (reads stand status from Google Sheets)
- `admin.html`  -> Admin view (edits stands + pushes updates to Google Sheets)
- `event_plan.svg` -> Your floorplan SVG (stand groups must be `<g id="A1">` style)

## Step 1: Prepare Google Sheet
Create a Google Sheet with columns:

| stand | status | company |
|------|--------|---------|

`status` must be `sold` or `available`.

## Step 2: Publish the Sheet as CSV (public read)
1. Share the sheet as **Anyone with the link: Viewer**
2. File -> Share -> Publish to web
3. Choose the sheet and publish as **CSV**
4. Copy the published CSV URL. It looks like:
   `https://docs.google.com/spreadsheets/d/e/.../pub?output=csv`

Paste it into BOTH files:
- `index.html` -> `SHEET_CSV_URL`
- `admin.html` -> `SHEET_CSV_URL`

## Step 3: Add Apps Script for writing (admin save)
1. In the sheet: Extensions -> Apps Script
2. Create a new script file and paste the contents of `apps_script.gs`
3. Deploy -> New deployment -> Type: Web app
   - Execute as: Me
   - Who has access: Anyone
4. Copy the Web app URL

Paste it into `admin.html`:
- `APPS_SCRIPT_WEBAPP_URL`

## Step 4: Host the website
Upload these three files to any static host (Netlify, GitHub Pages, etc.):
- index.html
- admin.html
- event_plan.svg

## Notes
- Public page updates on refresh. You can add auto-refresh if you want.
- Admin changes are debounced (~600ms) before sending to the sheet.
- The admin POST uses `mode: "no-cors"` for compatibility with Apps Script web apps.


## IMPORTANT: Apps Script deployment settings (to allow syncing)
In Apps Script > Deploy > Manage deployments:
- Type: Web app
- Execute as: **Me**
- Who has access: **Anyone**

If "Who has access" is not "Anyone", the website can show "sent" but the sheet will NOT update (Google redirects to a login page).

## IMPORTANT: Sheet tab name
The Apps Script in `apps_script.gs` writes to SHEET_NAME = "Sheet1".
If your tab is named differently (e.g. "Stands"), change SHEET_NAME accordingly before deploying.
