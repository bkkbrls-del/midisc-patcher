# MIDISC patcher

Browser patcher that builds **1.40MIDISC8.2** for Elektron Octatrack from your own stock **OS 1.40C**.

Live page: https://bkkbrls-del.github.io/midisc-patcher/

No firmware is hosted here. Patching runs entirely in the browser.
Frozen from local build `1.40MIDISC8.2` (splash `MIDISC8.2`).
MIDISC8 scenes; **CHAN T1–T8 route disabled** (HW brick — WIP in midisc repo). CC filter on hold.

## Local

Open `index.html` via any static server (GitHub Pages, or `npx serve .`).

## Flash

1. Build `1.40MIDISC8.2.bin` on the page
2. Copy it to the CompactFlash **root**
3. On the unit: **OS UPGRADE** (splash shows `MIDISC8.2`)
4. Keep stock 1.40C for recovery

Do not redistribute generated `.bin` / `.syx` files.
