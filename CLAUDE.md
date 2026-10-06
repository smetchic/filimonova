# Filimonova

Static PTO web app (GitHub Pages, no build step) on Supabase. Russian UI.

- App code lives in `assets/app/NN-section.js`, plain classic scripts loaded in order by `index.html`; they share top-level scope. See the file map in README.md and open only the section file a task needs.
- When changing a script, bump its `?v=` query in `index.html` so browsers drop the cached copy.
- DB changes go in `supabase/migrations/` as new files. Applied in filename order, the migrations rebuild the live schema (verified 2026-10-06). Never apply migrations to the live project without the user's explicit OK.
- The repo is public: no real project data, Excel/PDF sources or secret keys.
