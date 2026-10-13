# BDL PrepHub

> **PLUB** is what the app calls the own-brand area. It was "Lavarion" until 13 Oct 2026, when a second brand arrived. Only the wording changed. The code, the database tables (`lavarion_*`), the settings keys and the Google Sheet tabs ("Lavarion Q1–Q4", which spend.dash also reads) keep the old name on purpose.

The Bithell Distribution prep app: Prep Sheet, Sarah's Admin, Jack's Admin, Lavarion, Recovery Stock, Shipments, Insights. One page, served by GitHub Pages, data in Supabase.

## What's in here

| Folder / file | What it is |
|---|---|
| `index.html` | The page itself — the layout only. Loads everything below. |
| `css/` | How it looks. One file per area: `base`, `prep`, `modals`, `closeoff`, `pages`, `lavarion`, `followup`, `auth`, `unify`, `lavarion-overrides`. |
| `js/` | What it does. One file per area, loaded in order: `core` (shared helpers) → `rules` (the rules every save obeys, and who owns a row) → `prep` → `claims` → `sarah-admin` → `closeoff` → `recovery` → `jack-admin` → `admin-queue` → `dashboard` → `lavarion-bridge` → `insights` → `audit-ean` → `ui` → `stock-moves` → `shipments` → `sheet-sync` → `db` (Supabase) → `issues` → `returns` → `boot` → `lavarion`. |
| `tests/checks.js` | The agreed workflows, as checks. Run from the TEST MODE build ("Run the checks" on the red bar). A build only ships when they are all green. |
| `README-DEPLOY.txt` | The three-step upload. |

## Updating the live app

1. GitHub → **Add file → Upload files**.
2. Drag the **contents** of the dated build folder in (`index.html`, `css`, `js`, `tests`, the two READMEs) — not the folder itself.
3. **Commit changes**. Pages redeploys within a minute. Same URL, same logins.

Rollback: upload the previous dated folder the same way.

## Rules of the house

- The app never writes the Google Sheet.
- Nothing is ever deleted — rows are filed (archived) and stay in history.
- Every change to a row goes through `saveRow`, which runs the rules in `js/rules.js` and writes an audit line.
- "Is this row finished, and whose is it?" has one answer: `_rowOwner` in `js/rules.js`. Every list reads it.
- Test in TEST MODE (nothing saves there), never on live.
- Browser storage goes through `lsGet` / `lsSet` / `lsDel` in `js/core.js`, never `localStorage` directly. Every app on jackbithellamazon.github.io shares one ~5 MB pot. If another app fills it, `lsSet` drops our own spare copy, then keeps the value in memory and shows a red bar. The login uses the same guard (`PH_AUTH_STORE`), so a full pot can't sign anyone out. Real work lives in the database, never only in the browser. Check 38 fakes a full pot.
- Every database request goes through `phFetch` in `js/core.js` (the Supabase client is built with it). The watchdog counts requests per minute and shows a red bar if a minute passes 400, or three minutes in a row pass 150. Nothing ever re-renders in reply to its own load (the Oct 2026 prep-fee loop did, about 13 requests a second). Checks 41 and 43 cover this.
- Lavarion's shared settings (`lavarion_prefs`) and activity log (`lavarion_state`) are merged, never overwritten. `savePrefs` is a three-way merge against `_prefsBase` (what this laptop last read), so only what this laptop changed goes up. The log is a union. A save that does not land says so. Checks 44 and 45 cover this.
- **Saves send only what changed.** Prep rows keep `_base`, which is what this laptop last knew the database held (db.js FIELD-LEVEL SAVES). `saveRow` and the Sync bulk save send only the changed columns. A realtime update merges column by column through `_rtMergeUpdate`. Lavarion batches and purchases send `_colDiff` against `_pushedRow`. Never write a whole row from memory. Check 52.
- **Lavarion stays current.** `reloadData` runs on the 15-minute check, after a sleep, before every Sync, and a few seconds after another laptop changes a batch or a purchase (`rtChange`). It only reloads when nothing is waiting to save. Saves run one at a time (`_pushing`), purchases before batches. Nothing is deleted just because this laptop doesn't hold it. Checks 47 and 51.
- **The Lavarion sheet is the truth.** One sheet line is one purchase. Sync removes app-made copies (never one with stock), re-attaches orphaned stock (`relinkOrphans`), and lists lines that differ for a person to decide (`openSheetDiff`). The duplicate logic is retired (`dupTwin` returns null). Checks 48 and 54.
- **Stock safety.** A batch's `remaining` is sent as a change through `lav_add_remaining` (one-time SQL: `BDL PrepHub - stock safety - run once in Supabase.sql`). Supabase does the sum, so two laptops can't overwrite each other. If the function isn't there, the app saves the old way by itself. The status shows in Lavarion → Settings → Stock safety. Check 55.

Build number: in `js/lavarion.js` (`BUILD`) and on Settings.
