// The Shelf page: loads the list from the REST API, and wires the add form and each item's controls to it.
import { parseTags, renderList } from "./render.js";

const list = document.getElementById("items");
const addForm = document.getElementById("add-form");
const addError = document.getElementById("add-error");
const message = document.getElementById("message");

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
    throw new Error(err ? `${err.message} ${err.fix}` : `The server answered ${res.status}.`);
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

async function change(id, fields) {
  try {
    await api("PATCH", `/api/items/${id}`, fields);
    show(message, "");
    await load();
  } catch (e) {
    show(message, e.message);
    await load();
  }
}

async function load() {
  try {
    const items = await api("GET", "/api/items");
    list.replaceChildren(...renderList(document, items, actions));
  } catch (e) {
    show(message, e.message);
  }
}

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
