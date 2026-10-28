# BDL PrepHub

> **PLUB** is what the app calls the own-brand area. It was "Lavarion" until 13 Oct 2026, when a second brand arrived. Only the wording changed. The code, the database tables (`lavarion_*`), the settings keys and the Google Sheet tabs ("Lavarion Q1–Q4", which spend.dash also reads) keep the old name on purpose.

The Bithell Distribution prep app: Prep Sheet, Sarah's Admin, Jack's Admin, Lavarion, Recovery Stock, Shipments, Insights. One page, served by GitHub Pages, data in Supabase.

## What's in here

| Folder / file | What it is |
|---|---|
| `index.html` | The page itself — the layout only. Loads everything below. |
| `css/` | How it looks. One file per area: `base`, `prep`, `modals`, `closeoff`, `pages`, `lavarion`, `followup`, `auth`, `unify`, `lavarion-overrides`. |
| `js/` | What it does. One file per area, loaded in order: `core` (shared helpers) → `rules` (the rules every save obeys, and who owns a row) → `prep` → `claims` → `sarah-admin` → `closeoff` → `recovery` → `jack-admin` → `admin-queue` → `dashboard` → `lavarion-bridge` → `insights` → `audit-ean` → `ui` → `stock-moves` → `shipments` → `sheet-sync` → `db` (Supabase) → `issues` → `returns` → `boot` → `lavarion`. |
| `js/usage.js` | Counts what each person clicks (one small audit line per 30 min). Jack reads it on Audit → What gets used. |
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
  - **Option tiles (22 Oct, Jack: "easy to use — different options mean different things", "dead space"):** the NOT SENT card's answers are tiles across the card (`.csOpt`, grid via `.jkC3 .csActs:has(.csOpt)`), each with what happens underneath. *Only N ordered* is back (Centrum: Sarah asked "9 or 5?"). The card's header is just what Sarah asked; the facts sit in the question and her note is the quote.
  - **Qty fix corrects the count too:** when the new number is below what was booked in (and at least what was sent), a tick box (`#qfRcvd`) sets booked in to the same number. It starts ticked on Amazon orders. It is logged as `qtyFix.rcvdFrom` plus an audit line. Check 73.
- **Full story popup, wide (v54.3):** `jkStory` is 1040px wide. Rows get a units strip across the top (Ordered → Booked in → Sent to Amazon with the shipment IDs → Cancelled / Never arrived / Never sent / all accounted for). Below it, "The facts" sit beside "What happened". Claims and late orders use the same two columns.
- **Shipments search marks the line (v54.3):** the search is trimmed, so pasted spaces don't matter. A SKU, ASIN or product match highlights its line (`tr.shHit`), moves it to the top of the shipment and opens that shipment. Check 74.
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

## Leftovers follow Jack's triage again (v54.3, 22 Oct 2026)
Jack's process: **Sarah first → OA: Sarah handles it · Amazon: Jack checks the account → back to Sarah → wrong SKU? → physical check: Becki.**

Units booked in but never sent ("part shipped", `_partShipStale`, added 11 Sep for the Cadbury) never fitted this, in four ways:
- Sarah's card had no Send to Jack and no Ask Becki.
- Becki's list only counts rows where units are owed (`_isAmzDel` needed owed > 0). Leftovers owe nothing, so "No — send to Becki" went nowhere.
- "Yes — wrong SKU" closed the row without accounting for the units, so it came straight back (approved but `_partShipStale`).
- A v54.3 draft gave Jack shelf answers instead of the Amazon question.

Now:
- **Sarah's leftover card:** on an Amazon order, *Send to Jack — check the Amazon order*. On OA, *Went out under another SKU…* and *Ask Becki to check the shelves*.
- **Jack's card** asks "All N booked in — X sent, Y not sent. What does the Amazon order show?" The answers are *All N were delivered*, *Only X were ordered — the sheet is wrong* (fixes sheet and count), *The sheet quantity is wrong…* and *Answer with a note*.
- **After "delivered", back to Sarah:** *Yes — went out under another SKU…* (`wentOutUnder`, which accounts for the units) or *No — send to Becki*.
- **Becki:** `amzDelivered.kind='leftover'` (`_leftUnits`, `_isAmzDel`) puts it on her banner, with Not here and Another SKU on the row. Found means she sends them; it clears when sent (`_amzFoundBySave`). **Not here** corrects booked in to what went. On Amazon it goes to Jack (amz-missing, owed = the leftover); on OA it goes back to Sarah as a normal part-arrived shortage.
- The Sarah ↔ Jack loop is gone. Checks 69 and 73 walk the flow.

## v54.4 · b604 (22 Oct 2026)
- Same content as the v54.3 work above. The build number is bumped because files changed after b603 was stamped, and browsers kept serving cached b603 files: Jack was seeing the removed NOT SENT card and the old narrow popup.
- **Jack's cards, side by side:** the header stays across the top; the story (left) and the answers (right) sit side by side from 1200px wide. This removes the empty right half of each band.
- **Sarah's note on a check:** her words in quotes, then "Sarah ticked: …", said once.

## v54.5 · b605 (22 Oct 2026): full audit
- **Shark vacuum bug:** Sarah's list skipped every row with status "In Warehouse", so a part arrival (1 of 2 booked in, the other never came) dropped off every list for 9 days. A part arrival past its 2 working days now reaches Sarah whatever the status (`_partLate` in sarah-admin.js). Check 75.
- The checks' audit no longer counts grey done/parked rows as Sarah's active work (false alarms on the two rows Jack parked on Amazon dates).
- Live audit after the fix: 0 rows on the wrong page; no late order, open claim, PLUB shortage or PLUB late order on nobody's list.

## v54.6 · b606 (23 Oct 2026)
- **Wrong-SKU check is real (Prep Sheet, Sarah):** "No — check, then send to Becki…" opens a check (`skuCheckOpen`).
  - It lists the same product's other SKUs with ordered, in, sent and shipments, and flags any that sent more than they booked in.
  - It shows where to look in Seller Central.
  - Two ticks are needed before "Not there — send to Becki" works. The check is saved (`resolution.skuCheck`) and written into the history.
  - Rows sent to Becki without a recorded check say so on Sarah's With Becki list. Check 76.
- **PLUB Action centre rebuilt by job:** Build & send · Receive deliveries (Becki · UK team) · To order (Jack), plus Snoozed and Today.
  - Build lines have no DONE; they clear when the send is recorded. Products with no sends in 30 days are grey, not red.
  - **Change date** on a delivery is kept on the line (`etaMoved`).
  - **Snooze** offers Tomorrow, Next week or a date.
  - **Pause** (`D.settings.acPause`) always wins in `planDemandOf` until someone presses Selling again.
  - Opened-today is recorded per person, and "Today — what happened" is the record in plain words.
  - Fixes:
    - Sends after Sarah's Amazon count count as on the way (`plAmazonRow` since).
    - A DONE is kept 14 days instead of being wiped by a redraw.
    - A part never appears twice.
  - Check 77.

## v54.7 · b607 (23 Oct 2026): In Transit counts what is still to arrive
- **Cause:** the In Transit tiles added up `expected_qty` on rows whose status was "In-Transit". Booking in part of an order changes the status to "In Warehouse", so the whole order dropped out, including the units still to come. Shark 1 of 2, and every short delivery, vanished from the tile.
- **Now:** one count, `_toArrive(r)` = `_owedUnits(r)` (ordered − booked in − cancelled), on any open row whatever its status. `_transitTotals()` in core.js feeds the Prep Sheet tiles, the Dashboard pipeline and Insights (pipeline + supplier transit). The tile adds "· N overdue" (late or part-overdue) and "· N being claimed".
- **Tile click works:** `statFilter` was setting the accounts dropdown, so nothing happened. It now sets the status filter to "Still to arrive (any status)" (`__toArrive`, `_stMatches`).
- **Typing a received number** on an In-Transit / Not Arrived / Delivered row moves it to In Warehouse, as Counted in already did, and writes "Received typed" to the audit log.
- **Difference column:** amber "N to come" while the rest is not due, red −N once it needs chasing (`_diffChase` = part-overdue or late).
- Data behind the choices (audit_log, 60 days): Becki books in with Counted in (691), almost never the dropdown. Of 76 part deliveries, the rest came later only twice (within a day), so the 2-working-day chase stays and there is no "rest coming separately" tick. "Delivered" was picked 5 times, last on 28 Aug.
- Check 78.

## v54.8 · b608 (23 Oct 2026): what actually gets clicked
- **New file `js/usage.js`.** Jack asked to "see what's being clicked and what's being used". The audit log only records saves, so filters, tabs, popups and look-only buttons left no trace.
  - Every click is counted per person per day, by place and control: "Prep Sheet › + issue", "Menu › PLUB ASINs", "PLUB · Deliveries › Arrived", "Prep Sheet › Statuses filter = In-Transit", "Prep Sheet › Status column = In Warehouse".
  - Numbers, SKUs in popup titles and row ids are squashed so one button is one line. Nothing typed is recorded, only that a box was typed in.
  - The counts go up as ONE `audit_log` line (action `Usage`, detail = JSON) at most every 30 minutes, or on leaving the tab if the last send was 10+ minutes ago. Unsent counts survive a closed laptop (`phUsagePending`). Test mode counts but never sends.
  - The Audit page list leaves `Usage` lines out. Jack reads them on Audit → **What gets used** (Jack only): by person, Today / 7 / 30 days, grouped by page with clicks, days used, last used.
  - Check 79.
- Also in this build: the v54.7 In Transit fix above. The tile reads "N units overdue" / "N units being claimed".

## v54.9 · b609 (23 Oct 2026): Dashboard Pipeline counts units where they are; "Delivered" retired
- **Pipeline box (Dashboard):** the bars added up the whole order of every row by STATUS. A part delivery sat in "In Warehouse" at its full 100 while its missing 88 were also In Transit, and "Part Sent" counted units already at Amazon (264 "In Warehouse", only 173 on the shelf; 349 "Part Sent", 29 on the shelf). Now three bars, each unit counted once:
  - **Still to arrive** = `_transitTotals()` (same as the Prep Sheet tile).
  - **On the shelf, not sent** = `_onShelf(r)`: booked in minus on a shipment, via `sendableQty`, so damaged/eBay units held back and units that went out under another SKU are not counted. Rows Jack took off the lists (`_offPrepSheet`) are not counted.
  - **Issue still open** = `_issueOpen(r)`: flagged issue units on rows `_rowOwner` does not call finished.
  - Each bar shows its orders and COG. Clicking it opens the Prep Sheet on exactly those rows (`dashToPrep`: clears the other filters, sets `__toArrive` / `__onShelf` / `__issue`). The Prep Sheet status filter offers all three.
- **Active Inventory (Dashboard):** same fix. Active = still to arrive + on the shelf (645 at build time, was 951 by status). Issue units = issue still open.
- **"Delivered" retired** (Jack, 23 Oct; 5 uses in 60 days, last 28 Aug). It's gone from the row status dropdown, the bulk Set Status list, the Add/Edit Row list and the status filter. An old row that still has it keeps it (row dropdown shows it for that row; Edit Row's `_selKeep`). The rules that read "Delivered" stay, so old rows behave as before.
- Insights: removed an unused pipeline line (worked out by status, never shown).
- **Fixed before it went live:** v54.7 (b607/b608) removed `transitRows` from dashboard.js but the Suppliers pill still used it. The Dashboard failed to draw and the load logged "Load error". No check opened the Dashboard. **Check 81 now opens every page** and fails on any error; it was tested against a deliberately broken Dashboard.
- Check 79 no longer fires real handlers from its test controls.
- Checks 80 + 81. 81/81.
- Audit note (old, not from this build; shows now because check 81 opens Recovery Stock, which live loads at start): Amuk_75_26066_146_Jac_02 (2 units, gated) is already in Recovery Stock. Jack's page hides its card (claimsQ checks REC), but `_rowOwner` still says "claim with Jack: Gated". Nothing visible is wrong; waiting on Jack before changing the owner rule.

## v55.0 · b610 (23 Oct 2026): the SellerFuse check (prep only)
- **How it works.** A scheduled Claude task on Jack's Mac (Mon/Wed/Fri 07:30, `~/.claude/scheduled-tasks/prephub-sellerfuse-check/`) reads PrepHub (read-only) and SellerFuse (read-only) and writes ONE row into `sf_check_runs` (SQL: "BDL PrepHub - SellerFuse check - run ONCE in Supabase - 23Oct.sql"; an insert needs the `x-sf-check` header secret). The run only carries data; **`js/sfcheck.js` decides what it means**, so the rules are checked like the rest.
- **Automatic:**
  - Late-order answer on Sarah's cards: SellerFuse fact line, plus "SellerFuse checked: not shipped — send to Becki" on the wrong-SKU step (records `resolution.skuCheck` by "SellerFuse check (Claude)").
  - PLUB Stock at Amazon (available − today's pending orders not yet reserved; a newer hand count wins) and Sold in 30 days: `LV3.sfApplyFromRun`, once per run across laptops (`D.settings.sfApplied`), logged.
  - An order removed from the sheet (`sync_excluded`) that Amazon shows shipped is put back with booked in + sent (Henry Quick Pro ×3 on FBA15M7B2KQM).
  - Shipment IDs are cleaned/refused at every entry point (`_cleanShipId`; "SHIPMENT ID: FBA15M720K7G" matched as FBA15M720K7G).
- **Page + button:**
  - Sarah's page, "SellerFuse check": late order Amazon received / send nobody stamped → **Record it** (books in what isn't, stamps on the real shipment with SellerFuse's date, history line). Returns re-sends and PLUB lines are not on her list.
  - Becki's PLUB Action centre, "SellerFuse says": missed PLUB send → **Record the send** (the normal Ship popup, filled in); same send recorded twice → **Remove the copy** (`delLavShipLine`, parts back).
- **Rule:** "went out under X" (close-off popup and the went-out-under flow) needs X to have sent more than its own orders (PrepHub, or SellerFuse extra) — otherwise an override with a reason, kept as `resolution.wentAsCheck` (`sfSkuSpare`).
- **Ready-to-clear fix (Jack: "why are these still on the prep sheet?"):** `acHold` counts units sent under another SKU (`elsewhereShipped`) and damaged/eBay units held back, and ignores an issue flag whose claims are all Resolved/Closed. iHerb Baking Soda, GoPro and Cadbury now clear; MAM after its 48 hours.
- Checks 82 + 83; check 6 updated for the SKU rule. 83/83.

## v55.1 · b611 (23 Oct 2026): PLUB — keep things in stock (Jack: A B C F H I J K L yes; M, N answered)
- **Sales (B, C):** `sold30`/`planDemandOf` use SellerFuse's rolling 30 days (`D.settings.sfSold[asin]={u30,u7,at}`, fresh for 8 days) ahead of the hub's last calendar month. Per day = max(30-day pace, 0.7 × 7-day pace). A SellerFuse zero never wipes a non-zero hub month (an empty shelf sells nothing). The old typed-in `sold30` slot stays the last fallback; SellerFuse no longer writes into it.
- **Dated planning figure (N, L):** `D.settings.planSeason[asin]={m,until,by,at}` beats every sales figure until its date (`planSeasonOf`, `setPlanSeason`; editor in the product's plan popup, "Figure…" on Planner rows). Seeded once: Dove 75ml MD 9 a month until 31 Mar 2027 (53 sold Oct–Mar last year vs 829 Apr–Aug).
- **Build & send (A, F, H):** ranked by money a day — empty now or empties before a send could land first, then by `ads × profit a unit` (SellerFuse `profit_per_unit`, `profitOf`, median when unknown). "NO SENDS IN 30 DAYS" grey-out removed. Ship opens at the planned number (`openShip(id,planned)`). Each line shows "on the list N working days" (`D.settings.acFirst`), red from 2. Red banner from 12:00 on weekdays if nobody but Jack/Sarah has opened it (`acUkMissing`), also on Jack's Dashboard (`_plubUnopened`, one cached read of lavarion_prefs).
- **To order (I, J):** two lanes — Becki (every supplier but Alibaba) and Jack (Alibaba). Chip reads "N DAYS LATE". Parts with a lead of 30+ days go "soon" 30 days before their order-by date (not 7). A part with some on order shows the rest as a top-up when every open order has a date.
- **Products (K):** new columns On the way (with date), Days left (counts inbound that lands in time, else "then N days empty"), Sold 7d, Sold 30d, Per day (+ ▲▼ trend), Last sent; Ship button carries the plan. COG/unit and Parts coming off by default (once, `cols55_1`), back in Settings. Sales strip says when SellerFuse figures are in use.
- **Planner (L) rebuilt:** one table sorted by the day something has to happen; product rows, part rows grouped by supplier, set-up rows (no sales figure, no supplier, no route — with the fix on the row) in red; 60-day timeline per row; who (UK team / Becki / Jack) and the button. Safe rows behind "Show the N that are fine". Styles in css, not JS.
- **Supplier on a part (M):** `setCompSupplier` (saved on the part row; `compSupplier` now reads it). Seeded once: Ube Powder 100g → Alibaba. Its lead time uses Alibaba's route (rail) until Jack says otherwise.
- **SellerFuse run fix:** two SKUs on one ASIN now add up (GF Snacks had its 36 inbound overwritten by the other SKU's 0). The scheduled task also brings `units7` and `profit`.
- `render()` clears the planner cache so a change shows on the same pass.
- Check 82 updated (sfSold), check 84 added. 84/84.
- **Send list (Jack, 23 Oct: "nothing should be out of stock — units / profit / revenue lost per day, highest to lowest — a little is better than nothing, but you know how long that stock should last"):** Build & send is numbered top-down with a Copy list button. `sendUrgency(r)`: when all known stock is gone (at Amazon, plus inbound if it lands before the shelf empties, or from its landing when the gap before it can't be reached by a send today) → the last day a send can leave. Past it (`losing`): every day of waiting loses sales — these come first, most profit a day first. Then the rest by that date; lines the inbound already covers go last but stay. Each line: units / profit / sales a day, and how long the send lasts. No minimum send. Planner "When" uses the same date. Price a unit comes from SellerFuse (`sfPrice`, task sends `price`).
- **Never last minute, always a buffer (Jack, 23 Oct):** send-by dates keep the safety reserve (`sendUrgency`: last day = stock gone − FBA days − safetyDays). "SEND NOW — INTO THE BUFFER" shows how many buffer days a send today lands with. Lines join the list `aheadDays` (default 7, Planner → Assumptions) before they are due (`trigger` = FBA + safety + ahead), so they can share a shipment.
- **Counts aged:** `plAmazonRow` takes the planned pace × days since the count off the count (`counted`, `soldSince`); the Action centre says "~18 (20 counted, ~2 sold since)". Products page still shows the count as taken.
- **Good sales data (D):** `sfPace` — once the Mon/Wed/Fri counts (`D.settings.amzHist`, kept by each run) cover 30 days, sales ÷ in-stock days; until then, empty now or no sales this week → the month before (`unitsPrev30`, fetched by the task only for those) when it is higher.
- **Blips:** a 7-day jump gets the faster pace for 3 weeks of the send; the rest of the cover at the normal pace (`spikeCapped`). Parts plan at halfway between the two.
- **Winter figures (good sales data for tanning):** seeded once (`seed551Tan`) from SellerFuse Oct 2025–Mar 2026 ÷ 6, until 31 Mar 2027 — Dove 75ml LM 7, Dove LM 200ml 7, Dove MD 150ml 20 (was unplanned), Dove LM150ml 6, Dove MD150 2-pack 14, Nivea Q10 2. 2026 launches have no winter history and keep their sales.
- **Sticky header ResizeObserver:** re-observes only new nodes and works just after its callback — the old re-observe-every-time could chase itself round (intermittent check 81 failure on the taller Planner).
- 84/84, three runs in a row.


## v55.2 · b612 (23 Oct 2026): Sarah's triage as cards; SellerFuse does the double check (Jack: "yes love it")
- **Cards (A):** each row on Sarah's page is one card — product / supplier / units across the top, what's wrong, the checks as numbered steps, and "Your next step" on the right with the existing triage buttons (`_C` cells built exactly as before, laid out by `_tcCard`; `_cardMode`). Column headers became sort chips.
- **The double check (B):** `_tcSteps` shows, in order: did it arrive (Jack's answer, or booked in) → went out under this SKU but not recorded (SellerFuse) → went out under another SKU (SellerFuse) → next step. `_tcSkuBtns` / `_tcFoundBtns` put the matching button first and big: Record it (`sfRecordRow`, new — records from the row's own check, older than the window too), Yes — went out under <sku>, or Send to Becki (`sfCheckedToBecki`).
- **Booked in but not all sent (C):** the check now covers them (task helper `sfcheck.py` adds `kind:'shelf'` rows to `late`) — Centrum (4 of 9 never sent) was skipped before.
- **Claim window shut (D)** is off Sarah's card.
- Task v3 (`~/.claude/scheduled-tasks/prephub-sellerfuse-check/`): one fixed helper (`sfcheck.py prep|ships|plan|post`, pre-approved), the secret in `.secret` (600), a shipment line store on the Mac (`cache/lines.json`, seeded from run 1, 184 shipments) — late/shelf rows answered from it with no SellerFuse calls, only shipments not in the store and not matching PrepHub opened, ranked sales lists, slow sellers refreshed Mondays, no pending-orders call, no helper agents.
- Schedule (Jack, 23 Oct): twice a week — Mon + Thu 07:00 (cron `0 7 * * 1,4`); `sfNextCheck` follows; stale after 5 days (Thu → Mon is 4).
- Prep Sheet tiles (Jack, 23 Oct "5 ye"): COG In Transit (its COG is already on the In Transit tile) became two small tiles — "On the shelf, not sent" (units · orders · COG, click = `__onShelf` filter) and "Booked in today" (orders with `rcvdAt` today, UK).
- "This doesn't match SF" (Jack, 23 Oct): Products "Sold 30d" shows SellerFuse's real 30 days when it has one (a hub month used for planning shows only under Per day, labelled); Per day says month before (ran out) / in-stock days / hub month; a PLUB product with no stock row and no sales in a run is 0 at Amazon as of the run. Task: ASINs missing from the "Lavarion" search are searched one by one only when they sell (Pub Snacks, Decaf).
- Runs are marked applied as `<id>@552`, so tonight's run (applied by v55.1) is applied once more by v55.2 with the new stamping.
- Check 85. 85/85.

## v55.3 · b613 (23 Oct 2026): Products table lettering (Jack: "improve font")
- One number style (Geist, bold, tabular, 16px), product names 14px bold, ASIN/SKU and sub-labels 11–11.5px in the brighter text colour; the "last 7 days" / "last 30 days" repeated under every row are gone (the headings say it). CSS at the end of lavarion.css, scoped to the sticky tables.

## v55.4 · b614 (23 Oct 2026): Action centre + Planner ranked by money at stake (Jack: "audited action centre and planner and improved it with added context")
- `lossOfRows(rows, lead)` gives two figures for the products an order or part holds up: **lost** = units a day × SellerFuse profit a unit for products already empty or that will run out before a send can land; **stake** = that × the days they sit empty before the fix can arrive (part lead + the trip to Amazon). Lists sort by stake, so "empty tomorrow" beats "empty in 11 days".
- Action centre order lanes: a red "≈ £X at risk" chip (hover: £ a day and why) and "<product> empties in N days / is empty at Amazon" on the line. Orders with real money at stake go first; the rest keep the days-late order.
- Planner: money-first sort (rows losing money now on top, then by stake, then by date); the strip leads with "≈ £X/day being lost now"; "NOTHING TO SEND" instead of "waiting"; set-up rows with more than 60 days' cover drop to Later; "1 day" not "1 days".
- Check 84 gains the money-at-stake assertions. 85/85.

## v55.5 · b615 (26 Oct 2026): the SAS stock rule, same-day sends, the three new figures, calmer wording, stat chips
- **Stock rule (Jack, 26 Oct, matching SAS):** at Amazon = available; on the way = inbound + units moving between Amazon warehouses (`transfer`). Processing and customer-order units are carried but not counted. Every PLUB listing is carried by the v4 check, empty ones too, with its price and last-sold date. A run an older build applied is applied once more (`@555`).
- **Same-day sends count.** A send recorded after the count's time on the count's day is on its way (`lavShipments[].at` from `created_at`); the old "after the count's day" rule hid two sends all day.
- **Three new figures per send line:** days empty (SellerFuse last-sold date; before that the first 0 on the count record, shown as "3+"), lost so far, and still to lose even if sent today (the calendar days until a send today is sellable). `lossLine()`.
- **Wording pass:** EMPTY AT AMAZON · RUNS OUT BEFORE A SEND LANDS · SEND NOW · LANDS INSIDE THE 14-DAY BUFFER · N DAYS LATE (receive) · LANDS dd/mm · AFTER AMAZON RUNS OUT · N DAYS PAST ORDER-BY · NOT ORDERED YET · "≈ £X lost even if ordered today".
- **Stat chips** on every send line (a day · ≈ £ a day · at Amazon · +on the way · days empty · lost so far · more even if sent today · days this send lasts · can build · short of …), each with the arithmetic on hover; "selling faster" chip when the 7-day pace runs ahead; "typical margin" marked where no SellerFuse margin exists.
- **Lanes:** a totals strip on each; a sticky jump bar; the two columns of a row are equal height and scroll inside; lines covered by what is on its way fold away; in-person suppliers (route = collection) read SHOP RUN with "Bought — log it".
- Autosol Metal Polish → supplier Stax (Jack, 26 Oct), once, logged.
- The planned send is a figure ("Send 69"), not a button: Jack, 26 Oct — nobody ships from the Action centre; the send is recorded on the Shipments page and the line clears itself.

### b616 (26 Oct, evening) — the Planner audit: where the Planner and the Action centre disagreed
- **Moving-between-warehouses stock is its own tranche**, sellable in ~3 days (`MOV_DAYS`); shipping stock keeps the FBA pipeline. Protection, the send size, the run-out date and the Planner's timeline use the tranches in order (`plAmazonRow.tranches`, `gapQ/gapEta`). Reindeer Food's 75 moving units are days away, not two weeks.
- **A part's loss counts only the gap after the units that can be built now have gone** (`lossOfRows(…, afterSend)`): Pedigree with 69 Dog Treats buildable is "ORDER BY 13/11", not "£104 lost". Part lines in the order lanes carry the Planner's order-by date (N DAYS PAST ORDER-BY / ORDER TODAY / ORDER BY dd/mm) and only go red when sales are actually being lost.
- **One £/day figure**, split: "≈ £86 a day being lost now · £18 fixable by sending today · £68 waiting on parts" — on the Action centre (under Opened today) and on the Planner strip.
- Planner chips in the Action centre's words (N DAYS PAST ORDER-BY, PARTS LAND dd/mm · AFTER AMAZON RUNS OUT); an overdue order reads "ON ORDER · 16 DAYS LATE", not "covered"; the per-day label says "month before (ran out)" / "in-stock days" / the hub month.
- A top-up under 5% of the plan (or under 2 units) once something is on its way counts as done — "Send 101" minus a 100 send is not "Send 1".

### b617 (26 Oct, late) — Jack's answers to the audit list
- **No "Log order" anywhere.** Orders live on the purchase sheet; the Action centre's order lines have one button, "Ordered — it is on the sheet" (or "Bought — it is on the sheet" for a shop run), which ticks the line until the sheet sync brings the purchase in. The Planner shows the quantity and cost as text.
- **Planner "Ship" buttons are figures** ("Send 69"), like the Action centre: the Shipments page is the only place a send is recorded.
- **Set-up jobs are Jack's:** unrouted suppliers (one job each, with a one-click "Same as Stax" where a routed supplier's name is the first word of an unrouted one), parts with no supplier, unlinked orders and undated deliveries all sit on his list; the Planner's SET ROUTE / NO SUPPLIER rows are tagged Jack.
- **Stale-check strip on every page** (`sfStaleBanner`, js/sfcheck.js): from 10:00 UK on a Monday or Thursday with no count from today, or whenever the last count is over 5 days old.
- "Lost so far" is counted over one 60-day cycle at most ("lost in the last 60 days"), not since January.
- A and B (done-today trail, Jack's weekly line): no — a recorded send clears its line, as it does.

## v55.6 · b618 (26 Oct 2026, night): "we should never ever run out of stock — but not send or buy way too much"
- **Two clocks** (`sfPace`): when a product runs out uses the FASTEST of the 7-, 14- and 30-day paces; how much to send uses the 14-day pace (until the check carries it, the middle of 7 and 30), never under 3 weeks at the fastest. New lines (first send < 60 days) and lines that ran out this month are sized on the fastest, unless slowing. The old 0.7 × spike rule is gone.
- **Sellable days**: every pace is units ÷ days the product could be bought (`emptyDaysIn`, from the stock-out record).
- **Buffer** (`safetyFor`): land with at least 14 days AND 10 units (half a send for very slow lines); +1 day for anything selling 100+ a month.
- **Part dates tied to sends** (`partDatesFromSends`): a part that holds up a send is due when the rest of that send must leave, if that is earlier than its own shelf date; it shows 14 days ahead instead of 7.
- **Escalation**: an order line 3 working days past its date reads CHASE and goes to the top of its lane; an order ticked "on the sheet" that the sheet hasn't brought in after 5 working days comes back. Jack's Dashboard shows "PLUB orders past their date" (from `acLateSnap` in the shared settings).
- **Stock-out record** (`stockOuts`, `stockLedger`): opens when a count finds 0 on a selling product (from the day after its last sale), closes on the next count with stock; keeps pace, profit a unit, cause, what the app said. October seeded once from the SellerToolKit daily-sales file (confirmed / likely). "Sold nothing for a week with stock on the shelf" is recorded too.
- **Stock health page** (new tab): stock-outs scored by month and cause, a 12-month strip, every record; sold nothing with stock; overstock at Amazon (> 90 days) and in the warehouse (> 180 days) at cost; slowing lines.
- **Products**: Sold 7d / 30d say "empty N of 7 days"; Per day says which clock, ↑ / ↓, with every pace on hover.
- SellerFuse check: carries the 14-day sales (`units14`).

## v55.7 · b619 (26 Oct 2026, late): the Build & send line as a card
- Jack: "too messy — can barely see the title and ASIN". Each send line: product name (bold) and ASIN (click to copy) first, the send figure on the right with how long it lasts; one plain sentence (runs out ~date · a send today sells from ~date); one aligned row of figures (sells a day, at Amazon + on the way, stock lasts / empty for, profit a day, lost so far, still to lose); a parts shortage on its own amber line; pause / snooze as small links in the footer. Snoozed and done lines keep the compact row.

## v55.8 · b620 (26 Oct 2026, night)
- Prep Sheet: "On the shelf, not sent" + "Booked in today" removed — the COG In Transit tile is back (Jack: "go back").
- Order lanes: a line 3 working days past its date says ORDER NOW / SHOP RUN NOW · N DAYS LATE (CHASE was wrong — nothing to chase on a line nobody ordered).
- Send-to-sellable time measured from the SellerFuse check's receipts (created → last received, +1 working day). The plan uses the SLOWER of Jack's figure and the slowest recent send — it only ever goes up ("much rather overestimate"). Shown under the figure in Settings.
- Stuck at Amazon: PLUB shipments over 7 days with under 95% received — on Stock health and on the send card.
- Dashboard (Jack): "Empty at Amazon — N PLUB products" from the stock-out record.
- Weekly from the check: ads share (send-card footer). (Buy Box was built and taken out — Jack: not needed for PLUB listings.)
- Dashboard (Jack, Mondays and Tuesdays): last week's PLUB stock-outs in one line — how many, empty days, ≈ £ profit lost, and why (sends too late / parts not in time / sales jumped), biggest cost first.
- Working days skip England & Wales bank holidays as well as weekends (collections are 9–5 weekdays only) — UK_BH in lavarion.js, 2026–2028.

## v55.9 · b621 (26 Oct 2026, late)
- Sarah's Admin: the sort bar above the cards had collapsed into a 166px column stacked over the first card (a flex header row inside a table gets squeezed into the first column). Now one full-width header cell with the pills, column widths kept in a colgroup so the compact rows below don't move.
- Stuck-shipment flag REMOVED (Jack: only a closed shipment's shortfall matters, and that is the reimbursement side; units still in transit or being checked in keep counting as on the way). Receipts now only feed the measured send time.
- Send card visual pass: ASIN in the app's font with a copy icon ("Copied" on click, selectable), status chip beside it; the Send box shows the plan ("66 of 112 planned" + bar, or "the full plan"); figures as tiles with a colour edge; the shortage line says how many wait and when (order / shop run by, or on order); ads as a chip; icon buttons.
- Action centre: a 7th tile, Warehouse stock — PLUB parts on the shelf at cost (whNow(), shared with Stock health), units and £ on order; click → Stock health's warehouse panel.

## v56.0 · b622 (27 Oct 2026): a tab can no longer sit on an old copy in silence
- Sarah: "after checking them, it came back again". Her answers HAD saved (09:23–09:48, all three "with Jack"); her tab was showing an old copy. The self-refresh (wake, reconnect, every 15 min, and Sync Now) returned early while the archive load was "still streaming" — and that load had no time limit, so one hung request left the tab skipping every refresh until a full reload.
- Every archive / finalize request now has a 20-second limit (counts as a failed attempt); a generation number stops a late, stale load finishing over a newer one; a refresh or archive load stuck over 2 minutes is restarted; skipped refreshes (popup open, archive loading) are retried instead of dropped; the live connection is rebuilt on wake / reconnect; an amber bar says so when a page has not read the database for 30 minutes, with Reload.
