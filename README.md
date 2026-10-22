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

- **Stock at Amazon is in UK time.** Sarah counts from the Philippines. The count is typed and shown in UK time on every laptop and stored with its offset (`ukStamp` gives `2026-10-13T14:18+01:00`), so `slice(0,10)` is still the UK day. Stamps from before 13 Oct have no offset and read as they were written. One press of Save is one save (`_amzSaving`). Check 56.

- **A question to Jack beats an old promise.** A row waiting on a promised date goes back to Sarah when the date slips. But a question sent to Jack *after* the date had passed is a new question and stays his (`_askIsSlippedDate` in `js/rules.js`, used by `_rowOwner`, Sarah's list and Jack's list). Logitech X56, 13 Oct: Send to Jack bounced straight back three times. Checks 20 and 57.
- **Opening PLUB writes nothing.** A product's "last saved" mark is its own fields (`_sig`). The build list has a separate mark (`_rsig`), taken only once the build lists have loaded. A build-list change goes to `lavarion_recipes` only, never the product row. Check 58.

- **UK time on every laptop.** Sarah works from the Philippines, 7–8 hours ahead. "Today", "now", weekends and working days all come from the UK calendar and clock (`_ukParts`, `ukDayISO`, `ukAddDays`, `_ukDayStart` in `js/core.js`; `todayISO` and `getNowUK` use them). Never build a stored date from `getDate()`/`getHours()`. A promised date is parked through the whole UK day it names (`_parkedOnDate`). PLUB's `TODAY` refreshes every minute. Check 59.
- **A row with no order date takes the date in its SKU** (`Amuk_3.2_02096_…` = 02/09; `skuDateDDMM`). This only happens in memory and is never saved; the Prep Sheet marks it "SKU". The sheet's own date always wins. Oct 2026: the Q3 tab's date column is headed "find", so its rows came in undated and could never go late. Check 59.

- **Prep Sheet search has one rule** (`_prepSrchText` / `_prepMatch` in `js/prep.js`; the bulk-action fallback uses it too):
  - Barcodes typed as printed ("0 619659 204853"), with dashes or a stray space still match.
  - A leading 0 doesn't count.
  - The last 4 digits work.
  - A newly fetched EAN is searchable straight away.
  - EAN search is on the Prep Sheet only (Jack, 14 Oct).
  - A background refresh only waits for a table cell being edited (`#prepBody`), never the search box, which used to freeze the search until a click elsewhere.
  - Check 60.

- **Edit Row keeps what it doesn't show.**
  - A dropdown value the list doesn't offer is kept, not blanked (`_selKeep`). Part Sent rows used to lose their status.
  - The send date is only cleared when Sent changes from Yes to No.
  - `rcvdAt` carries over.
  - The save sends only the changed fields: the rebuilt row takes the old one's `_base`.
  - Add New Row starts with no barcode.
  - The order year comes from `_ddmmToISO`.
  - Check 61.

- **Extras are stock.**
  - At check-in, units counted over the order are recorded on the batch (`extra`, in `LAYER_META`).
  - Re-applying a purchase's allocation (`setAlloc`) never caps a received batch below what was counted. It only shrinks when the allocation itself shrinks.
  - At packing, "We have extra parts" (`pkExtraToggle` → `LV3.bookExtraForBuild`) books the missing parts in as Found extra, with a reason, before the send takes them off.
  - Correct stock (`doAdjust`) now saves.
  - Check 62.
- **Numbers typed on the Prep Sheet go into the search box.** They never edit the selected row (Jack, 21 Oct). Check 63.
- **eBay stock** is an issue type for stock we decide to sell on eBay:
  - The record closes itself and the units go straight to Recovery Stock (`_ebayToRecovery`).
  - It's held out of "to send" (`sendableQty`).
  - The row files once everything on the shelf went to eBay (`_recoveryFiled`).
  - Check 64.

- **Every PLUB send route handles extras the same way:**
  - Routes: New Shipment, Add PLUB to shipment, the PLUB page's Ship popup (`shipExtra`), and raising a line's units on Shipments (asks first, never logs "owed" quietly).
  - Found-extra parts are priced like the newest batch still in stock, so they never start a second price run.
  - Booking in more than one part, or when none can be built, shows a red warning.
  - Correct stock opened from the Ship popup redraws the Ship popup.
  - Check 65.

- **Date boxes:** an impossible date (31 November) shows it but hands the app nothing. `dateBoxMsg` names the problem on save and when you leave the box. Check 66.

- **Restocks shows "Last bought":** supplier, price, date and quantity of the newest real purchase (`lastBuy`). It also names the usual supplier when that differs. Found-extra and correction batches are never counted as suppliers (`_SUP_JUNK`). Check 67.
- **Sent over stock is settled properly (v54.3):** Settle used to tick the line only, so the parts never came off and the shelf read high. Now there are two buttons, and each asks first. *Take the parts off now* runs `shipConsume` and takes what the shelf can build; anything left stays owed. *Close — the count already allows for it* takes nothing off and logs that. The way it was settled is shown on the row (`settledHow`). Check 68.
- **All arrived, some never sent (v54.3, BioEars):** Jack's check card used to ask "12 of 12 booked in — what happened to the other 0?". When nothing is owed and units are still unsent (`_partShipStale`), it now shows a NOT SENT card that asks where the other N are. Its buttons are *Still on the shelf — send them*, *Went out under another SKU…* and *Answer with a note* (`_jkLeftActs`). Sarah's Send-to-Jack popup now says when every unit is booked in. Check 69.
- **Layout sweep (v54.3):** these were all checked at 1440px.
  - `prep.css table{min-width:1280px}` was reaching every table in a PLUB popup and pushing columns off the edge: product, component, Add several, Data, and Sent over stock (whose Settle buttons were never visible). Fixed with `.overlay.lav3 .mb table{min-width:0}`.
  - The Recipes grid (`table.mx`) now sizes to its cells (`table-layout:auto; width:max-content`, 76px inputs) and scrolls sideways. It had been squeezed to about 12px per column.
  - On Sarah's Admin, the buttons on waiting rows (With Jack / With Becki) now sit inside the row's own grid (`.tfuCmpActs`). Before, Undo and Details were cut off by the 118px Actions column.
  - The PLUB Settings override log fits its box.
  - The Dashboard's Weekly Activity heading is no longer squeezed into a 47px strip; the week controls wrap below it.
  - The Shipments KPI grid at 4 across: the 7th card spans 2 so there is no empty slot.
  - The Shipments row buttons and the Prep Sheet's "Send more" went from 9px to 11px / 10.5px.
  - Check 70.
- **Reading tidy (v54.3):**
  - Micro-labels raised from 8.5–9px to the house 10px: form labels, KPI captions, card captions, and the Dashboard's per-day tiles.
  - `_squashBounces` (rules.js) shows a run of "Sent to Jack" / "back with Sarah" pairs as one line on Sarah's card, Jack's card and lkStory. Display only; X56 goes from 26 lines to 3.
  - Written-off layers are no longer shown as on the way in four places: `nextIn`, the product popup, the products-table incoming column and the overview list (Dove MD ×2).
  - Prep Sheet tags say whose a row is: "Parked till dd/mm → Sarah", "Becki — …" on her shelf questions.
  - Check 71.
- **Written off on Jack's page (v54.3):** a folded panel under Done (`_writeOffs` + `_woHtml` in jack-admin.js) lists every loss, newest first. Sources:
  - Prep Sheet `moneyOff`, the Amazon refund refused, `refused-loss`, and the old backlog tidy-up
  - Claims with `reimbursed:'Write-off'`
  - PLUB `LV3.woList()`: a shortage written off (`shortEnd.k='writeoff'` or a dated `writtenOff`) and damaged units binned

  Each line shows day, source, product, supplier · order, why · who, units and £. Its heading gives £ this month and in all. Click a line to open its record. PLUB lines closed as refunded, auto refunded or miscount are NOT losses (`writtenOff:1` only means closed). Check 72.

Build number: in `js/lavarion.js` (`BUILD`) and on Settings.
