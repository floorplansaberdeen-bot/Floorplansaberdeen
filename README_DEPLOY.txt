Floorplan clean bundle (backend-enabled)

Upload ALL files in this zip to the ROOT of your GitHub Pages repo (same folder level):
- admin.html
- index.html
- shared.js
- admin.js
- index.js
- event_plan.svg

Then open:
- index.html?v=1
- admin.html?v=1

Admin URL lock (optional):
- Open admin.js and change ADMIN_URL_KEY from "CHANGE_ME" to a secret.
- Then use: admin.html?k=YOUR_SECRET

Backend:
- Default is Cloudflare Worker: https://floorplansaberdeen.floorplansaberdeen.workers.dev
- If you need to change it: admin page shows a black toast with "Set backend URL".
