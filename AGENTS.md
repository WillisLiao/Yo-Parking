# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Compact instructions

When compacting this conversation, preserve in detail:

- **Deploy/setup checklist** still outstanding — un-run migrations, the `notify-nearby` DB webhook wiring, Edge Function deploys, and the Xcode/EAS build status.
- **Non-obvious gotchas** discovered this project — especially the Supabase Realtime + PostGIS WKB issue (geography columns arrive as WKB hex, not GeoJSON; read the generated `lat`/`lng` columns instead).
- **Current typecheck status** and the working command: `node node_modules/typescript/lib/tsc.js --noEmit` (the `.bin/tsc` shim is broken in this install).
- **Unfinished feature work** by roadmap phase, plus any bug found-but-not-yet-fixed.

Drop verbatim file dumps and resolved tool output; keep a short summary of what changed and why instead.

# Model strategy

- Default to **Sonnet** for routine coding (screens, queries, styling, CRUD). It handles most of this app well and costs less.
- Reserve **Opus** for cross-cutting design — trust/probability/consensus engine changes, schema redesigns, multi-step refactors.
- For simple, well-scoped subagent tasks (file search, mechanical edits), spawn with `model: haiku`.
