BDL PrepHub — how to update the live app
1. Open the GitHub repo → Add file → Upload files.
2. Drag the WHOLE contents of this folder in (index.html, css/, js/, tests/).
3. Commit. GitHub Pages serves it within a minute. Same URL, same logins.
Rollback: upload the previous dated folder the same way.
b669: four files were renamed (Lavarion → PLUB): js/plub.js, js/plub-bridge.js, css/plub.css, css/plub-overrides.css.
The old js/lavarion.js, js/lavarion-bridge.js, css/lavarion.css and css/lavarion-overrides.css on GitHub are no longer
loaded — leave them or delete them, nothing changes either way (they are what a rollback to b668 would use).
b677 goes on top of b675 (live since 12 Nov) and includes b676. b676 = cases on the On order list, Receive and
Receive several — count deliveries in boxes; a part with no case size asks once at check-in and keeps it.
b677 = every count box has a CASES box beside the units box, kept in step both ways.
No SQL, no settings. After it is live, reload PrepHub once (⌘R) on every laptop.
Build: v56.4 · lav3 · 2026-11-12 · b677
