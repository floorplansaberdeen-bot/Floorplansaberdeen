FLOORPLAN SYSTEM – QUICK GUIDE (Generated 2026-02-07)

Files to upload (same folder as event_plan.svg)
- index.html (Public)
- admin.html (Admin)
- shared.js (Shared rendering logic)
- event_plan.svg (SVG floorplan – must be in same folder)

Backend
- Cloudflare Worker base URL: https://floorplansaberdeen.floorplansaberdeen.workers.dev
- Routes: GET /stands, GET /settings, POST /stand, POST /settings
- Google Sheets is the source of truth via Apps Script behind the Worker.

URL-only secret gate for admin (extra safety)
1) Open admin.html in a text editor
2) Find:  const ADMIN_URL_KEY = "CHANGE_ME";
3) Replace CHANGE_ME with a hard-to-guess secret e.g. "ABERDEEN-2026-9XK7"
4) Access admin using: admin.html?key=YOUR_SECRET
   Example:
   https://YOUR_GITHUB_PAGES/admin.html?key=ABERDEEN-2026-9XK7
5) Bookmark that full URL. If you change the key, old links stop working.

Admin password
- Lives in Apps Script Script Properties (ADMIN_PASSWORD)
- Admin page will prompt when needed for saving/reset/settings.

Public auto-refresh
- index.html polls about every 12 seconds
- Updated timestamp appears on the page

Public search highlight
- When you type in search, matching stands get a subtle outline on the plan.