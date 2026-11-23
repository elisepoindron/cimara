# Cimara

A demonstration mountain archive: real OpenStreetMap places with invented content, a
server-rendered Node 24 app over SQLite, no build step, one runtime dependency
(`@anthropic-ai/sdk`, optional at runtime). The README says what it is and why.

## Language

Everything is written in English — code, comments, commit messages, docs — except what an
Italian climber reads on screen, which is Italian (`label: { it: 'Quota base' }`). A fact's id
(`quota_base`) is a key; its `label.it` is what appears.

## Rules the code is held to

- `src/domain/` is pure: it imports nothing from `src/db`, `src/render` or `node:*`.
  Decisions are arithmetic over values; finding sets of things is SQL.
- SQL lives only in `src/db/` and `db/` (`db/migrate.ts` runs opaque files and is the exception).
- `Html` is branded: build it only with `html`, `raw`, `join`, `concat`; never `+` two of them.
- Withdrawing a report adds a retraction row; reports are never deleted.
- Nothing grades a route's conditions: no score, no colour, no "good" in a ranking reason.
  What a page says about today is the sky (`src/domain/sky.ts`); about reports, how many and when.
- An importer refuses a row it cannot read, by name, with the field and what it found; it never
  invents a value.
- Find parses against the archive, never a word list, and keeps visibly what it cannot read.
- The stylesheet `public/app.css` is a design deliverable: edits are additions.

## The guard

This repository never names the private archive the code was first written for. The name
lives once, encoded, in `src/import/osm/never-named.ts`; `scripts/guard/check.ts` refuses it
in commit messages (`.githooks/commit-msg`), in staged files (`.githooks/pre-commit`) and in
the whole tree and history (CI). Commits are authored with a GitHub noreply address. The hooks
are switched on by `npm install` (the `prepare` script). Never bypass them with `--no-verify`.

## Checking a change

```bash
npm test
npm run typecheck
npm run guard
DATABASE_FILE=build/demo.db npm run demo:build && DATABASE_FILE=build/demo.db npm start
```

Two traps: a backtick inside a comment in a template literal (SQL in `src/db/`, HTML in
`src/render/`) closes the string; and never `assert.equal(<a DOM node>, null)` — linkedom
nodes unfold the whole document when assert formats them, and the run dies without a message.
Assert on a name, an attribute or a count.
