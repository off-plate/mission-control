# Obsidian

One folder in the vault mirrors one folder of Notes, both ways.

```
~/Library/Mobile Documents/com~apple~CloudDocs/Off-Plate System/
  Mission Control/
    MC Notes/          <-->   Notes -> MC Notes, in the app
```

Nothing else in the vault is touched. The other three top folders are his
writing and stay his.

## How it runs

A launchd job on this Mac, every two minutes and once at login:
`tools/obsidian-sync.mjs`, booked by `scripts/com.michael.mc-obsidian.plist`.

Not the desktop app, and deliberately. He edits Mission Control on the phone and
in a browser as well, and those edits still have to reach the vault. The vault
exists only on this Mac, so the Mac is the only place the work can happen. The
cost is that a change made elsewhere waits for the laptop to be open. He agreed
that trade on 2026-08-25.

It signs in the way the app does, with the emailed 8-digit code, once:

```
node tools/obsidian-sync.mjs --login
```

The refresh token goes to `~/.mc-obsidian/session.json`, mode 600, outside this
repo, which is public. There is no service key: this job reaches exactly what he
reaches and nothing more.

```
node tools/obsidian-sync.mjs --status   what it can see
node tools/obsidian-sync.mjs --dry      what it would do, changes nothing
node tools/obsidian-sync.mjs            do it
node tools/obsidian-test.mjs            45 assertions, no account needed
```

What it did is in `~/.mc-obsidian/sync.log`.

## The file

```markdown
---
mc: note-mfq2p1o
updated: 2026-08-25T10:12:00Z
---

# Restaurant automation case

The body, exactly as Mission Control stores it.
```

`mc` is the join key and the only field that matters. Everything below the
frontmatter is the note body **verbatim**: not re-wrapped, not re-indented, not
reformatted. `src/richtext.ts` already holds the line that a markdown round trip
must not lose text, and this obeys the same one. Tables, code fences, wikilinks,
diacritics and a body that itself begins with `---` all survive, and each has a
test.

## The rules

**The first line is the title, on both sides.** That is already the app's
convention: `noteTitle` reads the first non-empty line and drops a leading `#`.

**A file rename is a retitle.** In Obsidian the filename *is* the title, so
renaming the file rewrites the note's first line. Retitling in the app renames
the file. Whichever side changed since the last agreement is the one that wins.

**Delete a file in the vault and the note is ticked off,** not destroyed. It
moves to Done in Mission Control and is out of every other list, which is what he
asked for: a deletion in Obsidian is a decision, not an accident, but a note is
still a paragraph he wrote and nothing here throws one away.

**Tick a note off in the app and its file leaves the vault.** The same rule read
from the other end, so Done never accumulates dead files.

**Both sides changed: the newer text becomes the note, the older is kept twice.**
On the note as `conflict`, which the app already renders, and as
`Name (conflict 2026-08-25 14-30).md` beside the file. A conflict sibling is
never read back in, so resolving one by deleting it is final.

## What stops it eating a folder

`MAX_VANISHED = 3`. iCloud evicting the folder looks exactly like him deleting
everything, and the answer to a deletion is to tick the note off. So a run that
would tick off more than three notes at once refuses, logs the names, and changes
nothing. Undownloaded iCloud placeholders (`.name.md.icloud`) are recognised as
files that exist and are merely not here yet, never as deletions.

Every write to the server reads the head first and patches only the notes in this
folder, which is the same discipline `src/supabase.ts` uses. A save from here
cannot erase what another device banked a second earlier.

## Why the sync knows what changed

`~/.mc-obsidian/ledger.json` holds, per note, the body hash both sides last
agreed on plus the filename and title. Without it there is no way to tell "he
edited the note" from "he edited the file" and the whole thing degrades to
last-writer-wins, which loses paragraphs.

`bodyHash` here is byte for byte the one in `src/sync-merge.ts`, and the test
asserts that against an independent copy. If the two ever drift, the app reads
every ordinary Obsidian save as a divergence and puts a conflict banner on a note
nobody fought over.

Notes written from here are stamped `dev: 'obsidian'`, and every body they
replace leaves its hash in `hist`. That is what tells the app's merge "you are
merely behind" from "we both wrote", so an ordinary sync stays silent.

## The part that is worth more than the sync

The folder is a write surface for Mission Control. Any Claude session, or he
himself in Obsidian on the phone, creates a note in Mission Control by writing a
markdown file into it. No credentials in the session, no API to call.
