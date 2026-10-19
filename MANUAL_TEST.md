# Manual test matrix

Every row was **NOT RUN** at the time of writing: this build was produced on a
Linux CI box with no iOS/Android device, no simulator, no browser automation and
no Mac. Nothing here is claimed as verified. Fill in the result column per
release; keep FAIL/NOT RUN visible rather than deleting rows.

Environment to record per run: device model, OS version, Expo Go vs release
preview build, RN/Expo SDK, and whether the New Architecture is on.

| # | Scenario | Steps | Expected | Result |
| --- | --- | --- | --- | --- |
| 1 | Small iPhone (e.g. SE) | Tap FAB, type, close, reopen | Sheet is usable, toolbar not clipped, keyboard does not cover the caret | NOT RUN |
| 2 | Activation → editable focus | Time FAB tap to caret-visible-with-keyboard | < 300 ms on the stated device; measure separately from keyboard animation | NOT RUN |
| 3 | iPad split view / floating keyboard | Open the sheet with a floating keyboard, then dock it | Inset recalculates, no double padding, editor still scrolls | NOT RUN |
| 4 | Android gesture nav + edge-to-edge | Open/close the sheet, back gesture while keyboard is up | First back press dismisses the IME, second closes the sheet | NOT RUN |
| 5 | Android 3-button nav | Press hardware back with the sheet open | `onRequestClose` closes the sheet | NOT RUN |
| 6 | Landscape rotation | Open the sheet, rotate both ways while it is open and while dragging the FAB | FAB re-clamps inside the safe region, sheet stays usable | NOT RUN |
| 7 | Drag + snap | Drag the FAB to each edge and each corner | Snaps to nearest edge with a spring, position persists across launches | NOT RUN |
| 8 | Long-press hide | Long-press the FAB 500 ms, then tap the recovery message | FAB hides, hint appears, tapping it restores the FAB | NOT RUN |
| 9 | Tap/drag disambiguation | Start a drag and release without moving; then drag and release | No accidental open on a drag; tap opens reliably | NOT RUN |
| 10 | Expo Go | Run the example in Expo Go | Works (no native module required); note capture works | NOT RUN |
| 11 | Release preview build | Same flows in a release build | Send path, share sheet and persistence work in a non-debug build | NOT RUN |
| 12 | Mobile Safari | Same flows on iOS Safari over the dev tunnel | Focus lands in the editor; Escape/backdrop close; localStorage persists across reload | NOT RUN |
| 13 | Web focus trap + hotkey | Tab through the open sheet; press ⌘/Ctrl+Shift+. | Focus stays inside the sheet; hotkey opens and restores it | NOT RUN |
| 14 | Keyboard already visible at open | Focus a host input, then tap the FAB | Sheet opens above the keyboard, no jump or double padding | NOT RUN |
| 15 | Screen reader (VoiceOver / TalkBack) | Navigate the FAB, header, toolbar, editor, preview checkbox | Labels/roles/states announced; checkbox toggles; focus returns to the host on dismiss | NOT RUN |
| 16 | Large text / dynamic type | Set the largest accessibility text size | Controls remain reachable, ≥48 pt targets, AA contrast | NOT RUN |
| 17 | IME / emoji / autocorrect | Type with a CJK IME, insert emoji, paste over a selection, use autocorrect | No corrupted text or caret jumps; smart-list continuation does not fire | NOT RUN |
| 18 | Native undo/scroll | Use the system undo gesture and scroll inside the editor | Best-effort (documented, not guaranteed across programmatic value replacement) | NOT RUN |
| 19 | Native modal conflict | Open a host native modal, then press the web hotkey / call `open()` | Documented limitation: the host modal may cover the FAB | NOT RUN |
| 20 | Real send to the local Node receiver | Start `node server/node/index.mjs`, set `endpoint` to `http://<lan-ip>:8787/v1/notes`, press Send, then open the returned link | 201 → banner shows Sent + Open; the returned page shows the notes | NOT RUN |
| 21 | Timeout path | Point `endpoint` at a black-hole host, press Send | Inline timeout message after ~15 s with Retry available | NOT RUN |
| 22 | Persistence across a hard kill | Type, kill the app inside the 400 ms debounce window | Documented: the last characters may be lost; nothing is silently sent | NOT RUN |

## Automation note

Rows 7, 8, 9, 14 and part of 4/6 are covered by unit/integration evidence
(`tests/ui/punchlist.test.tsx`, `tests/logic/geometry-and-storage.test.ts`) and
by the RNTL flow — but unit evidence is **not** a substitute for device keyboard
and navigation-bar testing.
