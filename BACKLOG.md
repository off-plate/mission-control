# Backlog

Work that is agreed but deliberately not started. Nothing here gets built
without Michael saying go: both items change how the app looks or navigates,
and that is his call, not the implementer's.

---

## 1. The 12 to 9 page merge

From the release critic's IA review, 2026-08-02, prompted by his own worry:
*"there is maybe a bit more pages... some of them might be together, some should
be under workspace."*

```
Today       all spaces, landing
Plan        all spaces   <- absorbs Brain Dump as its capture rail
Calendar    all spaces   <- absorbs the hidden #/day/ record as its selected-day state
Habits      all spaces   <- absorbs Routines (a routine is a habit with steps)
Goals       all spaces
Money       Personal and All only
Review      all spaces   <- absorbs Focus history; the timer stays the floating pill
Avoidance   all spaces
Vision      all spaces, the exempt wall
```

Why each merge is safe: every one joins two surfaces that already tell the same
record. Routines and Habits cross-reference each other card for card. The Focus
tab is a break picker plus a history already retold on Review, on Calendar's day
column and on the day record. The day record restates the day the calendar
already draws. Brain Dump is pre-task capture.

Money is the odd one: `MoneyPage` ignores the space switcher entirely, so the
same personal debt readout renders under Big Time, Off-Plate and Corner. Its
alerts already reach every space through `globalExceptions`, so scoping the tab
to Personal loses nothing and keeps debt off a work screen.

Measured reason, not taste: 12 tabs scroll two viewports at 390px; 9 fit in one
swipe, leaving the five-space switcher as the only second axis.

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
- **Rebalance ultrawide dead space** on Review (name and figure a screen apart),
  Calendar (one squat month, two thirds empty below) and Routines (rows aligned
  to the tallest card).

---

_Anything finished moves out of this file and into the commit log, not into a
"done" section here._
