// The Shelf page: loads the list from the REST API, and wires the add form, the search and filters, and each
// item's controls to it. The search and filters live in the page URL's query string.
import { importContentType, importFormat, importProblem, importSummary, statsTables } from "./data.js";
import { FILTER_KEYS, filtersFromSearch, filtersToSearch, hasFilters, itemsPath } from "./filters.js";
import { parseTags, renderImportResult, renderList, renderStats, renderTagOptions } from "./render.js";

const list = document.getElementById("items");
const addForm = document.getElementById("add-form");
const addError = document.getElementById("add-error");
const message = document.getElementById("message");
const filterForm = document.getElementById("filters");
const tagSelect = filterForm.elements.tag;
const statsBody = document.getElementById("stats-body");
const importForm = document.getElementById("import-form");
const importResult = document.getElementById("import-result");

/** The filters as the form shows them. */
function readFilters() {
  return Object.fromEntries(FILTER_KEYS.map((key) => [key, filterForm.elements[key].value]));
}

/** Puts `filters` into the form (the tag select is filled by loadTags, which keeps the selection). */
function fillFilters(filters) {
  for (const key of FILTER_KEYS) {
    if (key !== "tag") filterForm.elements[key].value = filters[key];
  }
}

/** The filters the page started with, from its URL; kept current as they change. */
let filters = filtersFromSearch(location.search);

/** Keeps the URL in step with the filters (no new history entry per keystroke), then reloads the list. */
function applyFilters(next) {
  filters = next;
  history.replaceState(null, "", location.pathname + filtersToSearch(filters));
  load();
}

/** Calls the API; resolves to the JSON answer (or null for 204), or rejects with "message Fix: fix" text. */
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data && data.error;
    throw new Error(
      err ? `${err.message} ${err.fix}` : `The server answered ${res.status}. Reload the page and try again; if it keeps happening, restart Shelf.`,
    );
  }
  return data;
}

function show(target, text) {
  target.textContent = text ?? "";
  target.hidden = !text;
}

const actions = {
  onStatus: (id, status) => change(id, { status }),
  onRating: (id, rating) => change(id, { rating }),
  async onDelete(id, item) {
    if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    try {
      await api("DELETE", `/api/items/${id}`);
      await load();
    } catch (e) {
      show(message, e.message);
    }
  },
  async onSave(id, fields, showError) {
    try {
      await api("PATCH", `/api/items/${id}`, fields);
      await load();
    } catch (e) {
      showError(e.message);
    }
  },
};

/** A status or rating change; resolves to the error text for the item to show, or null when it worked. */
async function change(id, fields) {
  try {
    await api("PATCH", `/api/items/${id}`, fields);
  } catch (e) {
    return e.message;
  }
  await load();
  return null;
}

/** Refills the tag filter from GET /api/tags (counts change after every edit), keeping the selected tag. */
async function loadTags() {
  const tags = await api("GET", "/api/tags");
  tagSelect.replaceChildren(...renderTagOptions(document, tags, filters.tag));
  tagSelect.value = filters.tag;
}

/** Refills the stats section from GET /api/stats (it changes with every edit and import). */
async function loadStats() {
  const stats = await api("GET", "/api/stats");
  statsBody.replaceChildren(...renderStats(document, statsTables(stats)));
}

/** Shows a short message in the import result area (as text). */
function showImportMessage(text) {
  const p = document.createElement("p");
  p.textContent = text;
  importResult.replaceChildren(p);
}

importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = importForm.elements.file.files[0];
  if (!file) return showImportMessage("Choose a .json or .csv file exported from Shelf.");
  const problem = importProblem(file);
  if (problem) return showImportMessage(problem);

  const format = importFormat(file.name);
  const button = importForm.querySelector("button");
  button.disabled = true;
  showImportMessage("Importing...");
  try {
    // The file goes as it is; fetch streams it, so the page stays responsive while the server works.
    const res = await fetch(`/api/import?format=${format}`, {
      method: "POST",
      headers: { "content-type": importContentType(format) },
      body: file,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = data && data.error;
      showImportMessage(err ? `${err.message} ${err.fix}` : `The server answered ${res.status}. Try a smaller file or reload the page.`);
      return;
    }
    importResult.replaceChildren(renderImportResult(document, importSummary(data)));
    importForm.reset();
    await load();
  } catch {
    showImportMessage("The import could not be sent. Check that Shelf is still running, then try again.");
  } finally {
    button.disabled = false;
  }
});

/** The newest load wins: an older answer arriving late (fast typing) must not overwrite a newer list. */
let loadSeq = 0;

/** Reloads the tag filter and the list for the current filters; a successful load clears the error above it. */
async function load() {
  const seq = ++loadSeq;
  try {
    const [items] = await Promise.all([api("GET", itemsPath(filters)), loadTags(), loadStats()]);
    if (seq !== loadSeq) return;
    const emptyText = hasFilters(filters) ? "No items match" : "Nothing on your shelf yet";
    list.replaceChildren(...renderList(document, items, actions, emptyText));
    show(message, "");
  } catch (e) {
    if (seq === loadSeq) show(message, e.message);
  }
}

let typing;
filterForm.addEventListener("input", (event) => {
  // Selects apply at once; the search box waits for a short pause in typing.
  clearTimeout(typing);
  if (event.target.name === "q") typing = setTimeout(() => applyFilters(readFilters()), 250);
  else applyFilters(readFilters());
});
filterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearTimeout(typing);
  applyFilters(readFilters());
});
document.getElementById("clear-filters").addEventListener("click", () => {
  clearTimeout(typing);
  filterForm.reset();
  applyFilters(filtersFromSearch(""));
});

fillFilters(filters);

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const f = addForm.elements;
  const body = {
    title: f.title.value,
    author: f.author.value,
    url: f.url.value,
    kind: f.kind.value,
    status: f.status.value,
    rating: f.rating.value === "" ? null : Number(f.rating.value),
    notes: f.notes.value,
    tags: parseTags(f.tags.value),
  };
  try {
    await api("POST", "/api/items", body);
    addForm.reset();
    show(addError, "");
    await load();
  } catch (e) {
    show(addError, e.message);
  }
});

load();
