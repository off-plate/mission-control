# Backlog

Work that is agreed but deliberately not started. Nothing here gets built
without Michael saying go: both items change how the app looks or navigates,
and that is his call, not the implementer's.

---

## 1. The page merge, now a 10 to 8

Overtaken in part on 2026-08-07: he cut three tabs himself after living with
them. Calendar is gone (its date and clock live on Today's band), Avoidance is
gone, and the Assistant left the menu to become a permanent rail on Today. What
remains of the plan below is the two merges those cuts did not cover.

From the release critic's IA review, 2026-08-02, prompted by his own worry:
*"there is maybe a bit more pages... some of them might be together, some should
be under workspace."*

```
Today       all spaces, landing
Plan        all spaces
Notes       all spaces   <- built since this plan; it is where Brain Dump went
Habits      all spaces   <- absorbs Routines (a routine is a habit with steps)
Goals       all spaces
Money       Personal and All only   <- DONE, shipped 2026-08-02
Review      all spaces   <- absorbs Focus history; the timer stays the floating pill
Why's       all spaces, the exempt wall
```

Why each merge is safe: both join two surfaces that already tell the same
record. Routines and Habits cross-reference each other card for card. The Focus
tab is a break picker plus a history already retold on Review and on the day
record.

Money is off this list: he agreed it on 2026-08-02 and it shipped on its own,
ahead of the merge. The tab renders in Personal and All only, and standing on it
while switching to a work space walks back to Today. Its alerts still reach every
space through `globalExceptions`, so nothing was lost by hiding the page.

Measured reason, not taste: 12 tabs scrolled two viewports at 390px. The three
cuts took it to 10; these two merges take it to 8, leaving the five-space switcher
as the only second axis.

---

## 2. Canon items that change the look

Held back from the overnight fix batch on purpose. Each one is defensible on its
own and all four change the app's feel, so they ship together, after he has seen
a preview.

- **Drop the blanket card shadow** on every panel. The canon is hairlines over
  shadows; shadows belong to true overlays only.
- **Drop the coloured SpaceMark bar.** A 3px coloured left border on every card
  head in All view is the forbidden coloured-left-border device, and the neutral
  space letter beside it already carries the meaning.
- **Load one real mono face for data.** `--font-mono` currently resolves to a
  sans, so roughly forty "this is a number" call sites are only pretending.
- **Rebalance ultrawide dead space** on Review (name and figure a screen apart)
  and Routines (rows aligned to the tallest card).

---

## 3. Full focus mode, button and mode

Asked for on 2026-08-03, and explicitly parked the same breath: *"DO not do this
until ill tell you more about it."*

What is known so far, in his words: a button that puts him inside one specific
task, where only the things that belong to that task are shown. Nothing else on
the screen.

What is NOT known and must come from him before a line is written: what counts
as belonging to the task (its steps, its notes, its timer, its goal, all of
these), whether it takes over the whole window or is its own route, how he
leaves it, and whether it is tied to the focus timer that already exists or is
its own thing.

Do not design it, do not build a preview, do not fold it into another change.
It waits for his brief.

---

_Anything finished moves out of this file and into the commit log, not into a
"done" section here._
