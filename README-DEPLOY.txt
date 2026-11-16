BDL PrepHub — how to update the live app
1. Open the GitHub repo → Add file → Upload files.
2. Drag the WHOLE contents of this folder in (index.html, css/, js/, tests/).
3. Commit. GitHub Pages serves it within a minute. Same URL, same logins.
Rollback: upload the previous dated folder the same way.
b669: four files were renamed (Lavarion → PLUB): js/plub.js, js/plub-bridge.js, css/plub.css, css/plub-overrides.css.
The old js/lavarion.js, js/lavarion-bridge.js, css/lavarion.css and css/lavarion-overrides.css on GitHub are no longer
loaded — leave them or delete them, nothing changes either way (they are what a rollback to b668 would use).
b683 goes on top of b675 (live since 12 Nov) and includes b676, b677, b678, b679, b680, b681 and b682.
(If any of b680, b681 or b682 is already live, it simply goes on top.)
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
No SQL, no settings. After it is live, reload PrepHub once (⌘R) on every laptop.
Build: v56.4 · lav3 · 2026-11-16 · b683
