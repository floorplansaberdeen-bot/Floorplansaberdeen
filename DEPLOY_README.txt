Deploy steps (simple):
1) Upload/replace these files in the SAME GitHub Pages folder (repo root):
   - admin.html
   - index.html
   - admin.js
   - index.js
   - shared.js
   - event_plan.svg
2) Commit + push.
3) Test with cache-busting:
   - admin.html?v=1
   - index.html?v=1

If you ever update files and don't see changes, bump v=2, v=3, etc in the URL.
