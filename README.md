# Shelf

## What it is

Shelf is a single-user reading list that runs on your own machine. It keeps books and articles with a title, author or
source, URL, status (to read, reading, done), a rating from 1 to 5, notes and tags. You can search and filter the list,
import and export it as CSV, JSON or Markdown, see reading stats per month and by tag, and set a yearly goal. It has a
web UI and a REST API. There is no login.

It is built on Bun alone (`Bun.serve`, `bun:sqlite`), with no npm runtime packages. The repo also holds textkit
(`src/textkit.ts`), a small text helper library.

## How to run it

```sh
bun src/shelf/server.ts
```

Then open the address it prints (by default `http://127.0.0.1:3000`).

| Variable   | Default     | What it sets                                |
|------------|-------------|---------------------------------------------|
| `SHELF_DB` | `shelf.db`  | The SQLite database file                    |
| `PORT`     | `3000`      | The port; `0` picks a free one              |
| `HOST`     | `127.0.0.1` | The address the server listens on           |

## API

| Method | Path | What it does |
|--------|------|--------------|
| GET | `/api/health` | Answers `{"ok": true}` |
| GET | `/api/items` | Lists items; filters `q`, `status`, `kind`, `tag`, `min_rating` |
| POST | `/api/items` | Adds an item |
| GET | `/api/items/:id` | One item |
| PATCH | `/api/items/:id` | Changes an item |
| DELETE | `/api/items/:id` | Deletes an item |
| GET | `/api/tags` | Every tag with its item count |
| GET | `/api/stats?year=YYYY` | Reading stats, with the goal for that year (default: the current year) |
| PUT | `/api/goals/:year` | Sets the yearly goal, `{"books": n}` |
| DELETE | `/api/goals/:year` | Removes the yearly goal |
| GET | `/api/export?format=json\|csv\|md` | Downloads every item as JSON, CSV or Markdown |
| POST | `/api/import?format=json\|csv` | Adds the items from a JSON or CSV file; never changes existing ones |

The web UI is served at `/`. Writes must send JSON (import also takes `text/csv`) from the same Host and Origin as
Shelf itself, or they are refused (the cross-site guard, b23). Errors come back as JSON.

## Tests

```sh
bun test
```

The Shelf tests live in `tests/shelf`.
