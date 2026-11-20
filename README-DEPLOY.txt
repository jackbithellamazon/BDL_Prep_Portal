BDL PrepHub — how to update the live app
1. Open the GitHub repo → Add file → Upload files.
2. Drag the WHOLE contents of this folder in (index.html, css/, js/, tests/).
3. Commit. GitHub Pages serves it within a minute. Same URL, same logins.
Rollback: upload the previous dated folder the same way.
b669: four files were renamed (Lavarion → PLUB): js/plub.js, js/plub-bridge.js, css/plub.css, css/plub-overrides.css.
The old js/lavarion.js, js/lavarion-bridge.js, css/lavarion.css and css/lavarion-overrides.css on GitHub are no longer
loaded — leave them or delete them, nothing changes either way (they are what a rollback to b668 would use).
b689 goes on top of b675 (live since 12 Nov) and includes b676 to b688.
(If any of b680 to b688 is already live, it simply goes on top.)
b676 = cases on the On order list, Receive and Receive several; a part with no case size asks once at check-in.
b677 = every count box has a CASES box beside the units box, kept in step both ways.
b678 = smoother order checks on Jack's Admin (the card opens where the row was, every order of the product joins it,
a delivered order with nothing booked in joins by itself, ticks don't move the page) + a send that was still
"ready to ship" when SellerFuse counted now counts as on the way.
b679 = the part popup redone: units AND cases everywhere, a case's price from every supplier, used-up batches
folded away; the Components list's To buy says it in cases too.
b680 = the order-check cards opened on the old version fix themselves: an order outside the card that is short
too joins it by itself (no yellow box, no grey Send). Plus Jack's Admin audit fixes: Not delivered yet parks (never
"cancelled"), Undo puts a card back on his list, escalations clear, ticks show, honest wording, search by order number.
b681 = stock on its way to us, every day: each booking-in on the Prep Sheet gets its own dated line, a close with
units never arrived says so, and once a day PrepHub saves the day before (one small line in the activity log).
PLUB → Data → "Every day since we started (Excel)" downloads the lot.
b682 = the first run backdates and saves every day back to the first order (16 Jan 2026); a missed day is filled.
b683 = Jack's CHECK card: "Some still coming, the rest delivered…" — the row waits for the part coming on Amazon's
date; the moment it is booked in, the rest come to Jack as check every order (date passes first = Sarah chases).
b684 = a LATE tile on the Prep Sheet (between COG In Transit and Sent Today; click it for those rows); an open
shelf check is always Becki's even on a row closed earlier (the Canon SELPHY); Send on an order-check card never
puts an older copy back over another laptop's change when a save fails.
b689 = Products tab: the product names are back on laptops. Product always keeps 240px; on a narrower screen the
other columns shrink evenly so everything still fits with Ship/Open on screen, and on a very narrow one the table
scrolls sideways with the names pinned on the left. (Since b685 the names went to 0px on a ~1,700px laptop.)

b688 = Q4 'Complete, day by day' chart redesigned: no empty run-out after the finish, the pace line ends on a
ringed 100% finish marker, the last send day and the finish are named under the axis, the daily bars are a
'Sent each day' strip scaled to an ordinary day with the need and pace levels across it (weekend sends shaded as a
bonus), and the key is three figures in one row.

b687 = Q4 Realistic finish: the middle of three paces (this week, last 2 weeks, last 4 weeks) in units a working day,
hours only as a one-person check on the timed lines (a weekend
send is a bonus, never a day; a day with nothing sent counts), each morning starts without today and every send brings it in, Mon–Fri only; needed a working day from today; a Today figure; the
graph's lines step over the working days and run into Feb/Mar if needed; 22 Dec – 4 Jan are days off. No line for this week alone any more.
Sends recorded on one laptop now show on the others without a reload.

b686 = Q4 chart: the weekly average updates every day (this week counts as it goes, Mon–Fri; a weekend send
counts to its week), this week's pace + its finish date, one 'needed a week' figure, green only with 3+ days spare,
daily bars under the chart and a band between the two paces.

b685 = Lavarion: a send made earlier on the day of the count stays counted (Gluten Free Tea said Send 114 with 54
already gone); 0 on the shelf while stock moves between Amazon's warehouses and still sells is no longer "EMPTY";
Products table: Stock needed drawn wide (need, have, short or spare, Q4 target) and a Profit a day column.
No SQL, no settings. After it is live, reload PrepHub once (⌘R) on every laptop.
Build: v56.4 · lav3 · 2026-11-20 · b689
