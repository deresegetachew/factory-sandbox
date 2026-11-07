// Builds the shelf's list from items, using only createElement, append, setAttribute, textContent,
// addEventListener and plain properties. User text is always set as text, never parsed as HTML.

export const STATUS_LABELS = { to_read: "To read", reading: "Reading", done: "Done" };
export const KIND_LABELS = { book: "Book", article: "Article" };

/** The url when it is an http or https address, otherwise null. Only such urls ever become links. */
export function safeHref(url) {
  if (typeof url !== "string" || url === "") return null;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Splits a "sci-fi, history" tags field into a list (the API trims, lowercases and deduplicates). */
export function parseTags(text) {
  return String(text)
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

/** Creates `tag` with string attributes and children (elements or text). */
function h(doc, tag, attrs = {}, ...children) {
  const el = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  if (children.length) el.append(...children);
  return el;
}

function option(doc, value, label, selected) {
  const o = h(doc, "option", { value });
  o.textContent = label;
  o.value = value;
  if (selected) {
    o.selected = true;
    o.setAttribute("selected", "");
  }
  return o;
}

function labelled(doc, text, control) {
  return h(doc, "label", {}, text, control);
}

function input(doc, name, value, type = "text") {
  const el = h(doc, "input", { name, type });
  el.value = value ?? "";
  return el;
}

function select(doc, name, choices, current) {
  const el = h(doc, "select", { name }, ...choices.map(([v, label]) => option(doc, v, label, v === current)));
  el.value = current;
  return el;
}

const statusChoices = Object.entries(STATUS_LABELS);
const kindChoices = Object.entries(KIND_LABELS);
const ratingChoices = [["", "None"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"]];

/**
 * One item as an <li>: its fields (marked with data-field), quick controls for status and rating, and an edit form
 * that is hidden until Edit is pressed. `actions` callbacks: onStatus(id, status) and onRating(id, rating|null)
 * resolve to an error text or null; onDelete(id, item); onSave(id, fields, showError).
 */
export function renderItem(doc, item, actions = {}) {
  const href = safeHref(item.url);
  const title = href
    ? h(doc, "a", { "data-field": "title", class: "title", href, rel: "noopener noreferrer", target: "_blank" })
    : h(doc, "span", { "data-field": "title", class: "title" });
  title.textContent = item.title;

  const li = h(doc, "li", { class: "item", "data-id": item.id }, title);

  if (item.author) {
    const author = h(doc, "span", { "data-field": "author", class: "author" });
    author.textContent = item.author;
    li.append(author);
  }

  const kind = h(doc, "span", { "data-field": "kind", class: "kind" });
  kind.textContent = item.kind;
  li.append(kind);

  const tags = h(doc, "span", { "data-field": "tags", class: "tags" });
  tags.textContent = (item.tags ?? []).join(", ");
  tags.hidden = !item.tags || item.tags.length === 0;
  li.append(tags);

  if (item.notes) {
    const notes = h(doc, "p", { "data-field": "notes", class: "notes" });
    notes.textContent = item.notes;
    li.append(notes);
  }

  const error = h(doc, "div", { class: "error", role: "alert" });
  error.hidden = true;
  const showError = (message) => {
    error.textContent = message ?? "";
    error.hidden = !message;
  };

  // A quick change that the API refuses puts the control back and shows the message and fix on this item.
  const quickChange = (control, previous, send) => {
    control.addEventListener("change", async () => {
      const problem = await send(control.value);
      if (problem) {
        control.value = previous;
        showError(problem);
      }
    });
  };

  const status = select(doc, "status", statusChoices, item.status);
  status.setAttribute("data-field", "status");
  quickChange(status, item.status, (value) => actions.onStatus?.(item.id, value));

  const ratingValue = item.rating == null ? "" : String(item.rating);
  const rating = select(doc, "rating", ratingChoices, ratingValue);
  rating.setAttribute("data-field", "rating");
  quickChange(rating, ratingValue, (value) => actions.onRating?.(item.id, value === "" ? null : Number(value)));

  li.append(h(doc, "div", { class: "controls" }, labelled(doc, "Status", status), labelled(doc, "Rating", rating)));

  const form = editForm(doc, item, actions, showError);
  form.hidden = true;

  const editButton = h(doc, "button", { type: "button", class: "secondary" });
  editButton.textContent = "Edit";
  editButton.addEventListener("click", () => {
    form.hidden = !form.hidden;
  });
  const deleteButton = h(doc, "button", { type: "button", class: "danger" });
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => actions.onDelete?.(item.id, item));

  li.append(h(doc, "div", { class: "buttons" }, editButton, deleteButton), form, error);
  return li;
}

/** The edit form for every field; on submit it calls onSave with only the fields that changed. */
function editForm(doc, item, actions, showError) {
  const fields = {
    title: input(doc, "title", item.title),
    author: input(doc, "author", item.author),
    url: input(doc, "url", item.url, "url"),
    kind: select(doc, "kind", kindChoices, item.kind),
    tags: input(doc, "tags", (item.tags ?? []).join(", ")),
    finished_at: input(doc, "finished_at", item.finished_at ? item.finished_at.slice(0, 10) : "", "date"),
    notes: h(doc, "textarea", { name: "notes", rows: 3 }),
  };
  fields.notes.value = item.notes ?? "";

  const save = h(doc, "button", { type: "submit" });
  save.textContent = "Save";
  const form = h(
    doc,
    "form",
    { class: "edit" },
    labelled(doc, "Title", fields.title),
    labelled(doc, "Author or source", fields.author),
    labelled(doc, "URL", fields.url),
    labelled(doc, "Kind", fields.kind),
    labelled(doc, "Tags", fields.tags),
    labelled(doc, "Finished on", fields.finished_at),
    labelled(doc, "Notes", fields.notes),
    save,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const changes = {
      title: fields.title.value,
      author: fields.author.value,
      url: fields.url.value,
      kind: fields.kind.value,
      notes: fields.notes.value,
      tags: parseTags(fields.tags.value),
    };
    const before = item.finished_at ? item.finished_at.slice(0, 10) : "";
    if (fields.finished_at.value !== before) changes.finished_at = fields.finished_at.value || null;
    actions.onSave?.(item.id, changes, showError);
  });
  return form;
}

/**
 * One <li> per item in order, or a single line of `emptyText` when there are none ("Nothing on your shelf yet" for
 * an empty shelf; the page passes "No items match" when a search or filter is set).
 */
export function renderList(doc, items, actions = {}, emptyText = "Nothing on your shelf yet") {
  if (!items.length) {
    const empty = h(doc, "li", { class: "empty" });
    empty.textContent = emptyText;
    return [empty];
  }
  return items.map((item) => renderItem(doc, item, actions));
}

/**
 * The tag filter's options: "All tags", then each tag with its count from GET /api/tags. A selected tag no item has
 * any more (an old bookmark) is added at the end with (0), so the filter still shows what is applied.
 */
export function renderTagOptions(doc, tags, selected = "") {
  const options = [option(doc, "", "All tags", selected === "")];
  for (const { tag, count } of tags) options.push(option(doc, tag, `${tag} (${count})`, tag === selected));
  if (selected !== "" && !tags.some((t) => t.tag === selected)) options.push(option(doc, selected, `${selected} (0)`, true));
  return options;
}

/** A small table: a caption, a header row and body rows, every cell set as text. */
function table(doc, kind, caption, head, rows) {
  const captionEl = h(doc, "caption");
  captionEl.textContent = caption;
  const headRow = h(doc, "tr", {}, ...head.map((text) => {
    const th = h(doc, "th", { scope: "col" });
    th.textContent = text;
    return th;
  }));
  const body = h(doc, "tbody", {}, ...rows.map((cells) => h(doc, "tr", {}, ...cells.map((text) => {
    const td = h(doc, "td");
    td.textContent = text;
    return td;
  }))));
  return h(doc, "table", { class: "stats", "data-stats": kind }, captionEl, h(doc, "thead", {}, headRow), body);
}

/**
 * The stats section from statsTables(): totals by status, items finished per month (newest first) and per tag.
 * An empty history says "Nothing finished yet" instead of an empty month table.
 */
export function renderStats(doc, tables) {
  const out = [table(doc, "totals", "By status", ["Status", "Items"], tables.totals)];
  if (tables.nothingFinished) {
    const empty = h(doc, "p", { class: "empty" });
    empty.textContent = "Nothing finished yet";
    out.push(empty);
  } else {
    out.push(table(doc, "months", "Finished per month", ["Month", "Done"], tables.months));
  }
  if (tables.tags.length) out.push(table(doc, "tags", "By tag", ["Tag", "Items", "Done"], tables.tags));
  return out;
}

/** The import answer: the headline, then one line per skipped or rejected row with its number and reason. */
export function renderImportResult(doc, summary) {
  const headline = h(doc, "p", { class: "headline" });
  headline.textContent = summary.headline;
  const box = h(doc, "div", { class: "import-result" }, headline);
  if (summary.rows.length) {
    box.append(
      h(doc, "ul", {}, ...summary.rows.map(({ kind, row, reason }) => {
        const li = h(doc, "li", { class: kind });
        li.textContent = `Row ${row} ${kind}: ${reason}`;
        return li;
      })),
    );
  }
  return box;
}

/**
 * The "Currently reading" strip: one <li> per reading item (title, author when set, a Finished button), or [] when
 * nothing is being read (the page then hides the strip). onFinished(id) resolves to an error text or null; while it
 * runs the button is disabled, so a double click sends one request. On null the entry leaves the strip; on an error
 * it stays and shows the message.
 */
export function renderReadingStrip(doc, items, onFinished) {
  return items.map((item) => {
    const title = h(doc, "span", { "data-field": "title", class: "title" });
    title.textContent = item.title;
    const li = h(doc, "li", { class: "reading-item", "data-id": item.id }, title);

    if (item.author) {
      const author = h(doc, "span", { "data-field": "author", class: "author" });
      author.textContent = item.author;
      li.append(author);
    }

    const error = h(doc, "div", { class: "error", role: "alert" });
    error.hidden = true;

    const button = h(doc, "button", { type: "button", "aria-label": `Finished: ${item.title}` });
    button.textContent = "Finished";
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      const problem = await onFinished?.(item.id);
      if (problem) {
        button.disabled = false;
        error.textContent = problem;
        error.hidden = false;
        return;
      }
      li.remove();
    });

    li.append(button, error);
    return li;
  });
}
