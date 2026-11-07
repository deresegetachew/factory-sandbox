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

/** One <li> per item in order, or a single "Nothing on your shelf yet" line for an empty shelf. */
export function renderList(doc, items, actions = {}) {
  if (!items.length) {
    const empty = h(doc, "li", { class: "empty" });
    empty.textContent = "Nothing on your shelf yet";
    return [empty];
  }
  return items.map((item) => renderItem(doc, item, actions));
}
