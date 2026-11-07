# Product requirements: Shelf

## Vision

Shelf is a personal reading list. One person keeps the books and articles they want to read, are reading and have read,
in one place they own: a small web app and a REST API that run on their own machine. They can rate and annotate what
they read, tag it, find it again with search and filters, move their list in and out as CSV or JSON, and see how much
they read each month and by tag. Version 1 is for a single user and has no login.

## Users

- **The reader**: one person, on their own machine, using the web UI in a browser.
- **The reader's scripts**: the same person automating things through the REST API (for example a bookmarklet or a
  script that adds an article).

## User stories

- US-1: I can add an item with a title, an author or source, an optional URL and a kind (book or article); its status starts as "to read".
- US-2: I can edit any field of an item, and delete an item.
- US-3: I can set an item's status to "to read", "reading" or "done"; when it becomes "done", the date it was finished is recorded.
- US-4: I can give an item a rating from 1 to 5 (or none) and free-text notes.
- US-5: I can add and remove tags on an item, and see all my tags with how many items each has.
- US-6: I can search my items by text: title, author or source, notes and tags.
- US-7: I can filter my items by status, tag, kind and minimum rating, combined with search.
- US-8: I can export all my items as a JSON file or a CSV file.
- US-9: I can import items from a JSON or CSV file in the export's format, and I am told how many were added and which rows were rejected and why.
- US-10: I can see how many items I finished in each month.
- US-11: I can see, for each tag, how many items have it and how many of those are done.
- US-12: I can do all of the above in a simple web UI served by the app.
- US-13: I can do all of the above through a REST API that speaks JSON.

### Version 1.1

- US-14: I can set a reading goal for a year (a number of books) and see my progress toward it on the stats view and
  in `GET /api/stats`.
- US-15: I can export my shelf as a Markdown file, grouped by status, with ratings shown as stars.
- US-16: I see the items I am currently reading in a strip at the top of the page, and can mark one finished with one click.

### Version 1.2

- US-17: I can copy an item as a citation, `Author, Title (URL)`, to the clipboard with one click.

## How it is built

- **Bun only.** The server is `Bun.serve`, storage is `bun:sqlite`, tests are `bun test`. No npm runtime packages;
  dev-only type packages need the dev manager's yes. The web UI is plain HTML, CSS and JavaScript served by the app,
  with no build step and no framework.
- **Where the code lives.** `src/shelf/` for the app, `tests/shelf/` for its tests. The start command is
  `bun src/shelf/server.ts`. The database file comes from `SHELF_DB` (default `shelf.db`); tests use `:memory:`.
  The port comes from `PORT` (default 3000).
- **The textkit module stays as it is.** `src/textkit.ts` and its tests are not changed by Shelf work. Shelf may import it.
- **The item.** `id`, `title` (required, not blank), `author` (author or source, optional), `url` (optional, http or https),
  `kind` (`book` or `article`, default `book`), `status` (`to_read`, `reading`, `done`, default `to_read`), `rating`
  (whole number 1 to 5, or null), `notes` (text), `tags` (list of strings), `created_at`, `updated_at`, `finished_at`
  (set when the status becomes `done`, cleared when it leaves `done`). Dates are ISO 8601 in UTC.
- **Tags** are trimmed and lowercased, so "Sci-Fi" and "sci-fi " are one tag. An item has each tag at most once.
- **Errors** from the API are JSON `{ "error": { "code", "message", "fix" } }` with a 4xx status, where `fix` tells the
  person what to do.
- **API routes** (all under `/api`): `GET /health`; `GET/POST /items`; `GET/PATCH/DELETE /items/:id`; `GET /tags`;
  `GET /stats`; `GET /export?format=json|csv`; `POST /import?format=json|csv`. Search and filters are query parameters
  on `GET /items`: `q`, `status`, `tag`, `kind`, `min_rating`.
- **Reading goal (v1.1).** One goal per year: a whole number of books from 1 to 1000. `PUT /api/goals/:year` with
  `{ "books": n }` sets it, `DELETE /api/goals/:year` removes it. `GET /api/stats` gains `goal` for the current UTC
  year (or `?year=YYYY`): `{ "year", "books", "done" }`, or `null` when no goal is set. `done` counts items with status
  `done` and kind `book` (see Q4) whose `finished_at` falls in that UTC year (the same date the monthly stats use).
- **Markdown export (v1.1).** `GET /api/export?format=md` downloads `shelf-YYYY-MM-DD.md`: a heading per status in the
  order Reading, To read, Done (an empty group is left out), one list line per item with title, author, a link when it
  has a URL, the rating as stars (`★★★★☆` for 4, nothing when unrated) and its tags. Notes are left out. Text the user
  typed is escaped so it cannot break the Markdown. Markdown is export only; it cannot be imported.
- **Currently reading strip (v1.1).** The top of the page lists the items with status `reading`, each with a
  "Finished" button that sets the status to `done` (so `finished_at` is now). The strip is hidden when nothing is being
  read; the list and the stats update after a click.
- **Copy as citation (v1.2).** Each item in the list has a "Copy as citation" button that copies one line of plain
  text to the clipboard: `Author, Title (URL)`. Without an author it is `Title (URL)`; without a URL it is
  `Author, Title`; with neither, just `Title`. The text is what the user typed (trimmed), not escaped or reformatted.
  The button says "Copied" briefly on success; when the browser refuses the clipboard, the line is shown selected so
  the user can copy it by hand. It is UI only: no new API route.
- **CSV format.** A header row: `title,author,url,kind,status,rating,notes,tags,created_at,finished_at`. Tags are joined
  with `;` in one cell. Quoting follows RFC 4180 (commas, quotes and line breaks inside a cell). UTF-8.

## Rules that must never break

- Import never deletes or changes items already on the shelf; it only adds. A bad row is reported, never silently dropped.
- Exporting and then importing the file into an empty shelf gives the same items (same fields and tags) in both formats.
- Nothing the user typed is run as code: titles, notes and tags show as text in the UI, and SQL uses bound parameters.
- The server listens on 127.0.0.1 only by default, because v1 has no login.
- No npm runtime packages.

## Out of scope for v1

- Accounts, login, more than one user, sharing.
- Fetching book or article details from the internet (covers, metadata lookups).
- Imports from other apps' formats (Goodreads and the like).
- A mobile app; the web UI only needs to be usable on a phone-sized screen.
- Changes to the textkit module.

## Decisions

The owner decided these on 2026-11-07.

- Duplicates on import: a row whose URL (or, without a URL, title plus author) matches an existing item, or an earlier
  row in the same file, is skipped and reported as a duplicate.
- The month in the stats is the month the item was marked done (`finished_at`), and `finished_at` can be set by hand
  through edit and import, for books finished before Shelf.
- The book/article `kind` field stays.

## Open questions for the owner

Each has a default the builders use until the owner says otherwise.

- Q4: Does the yearly goal count only items whose kind is `book`, or everything finished (books and articles)?
  Default: only books, since the goal is "a number of books".
