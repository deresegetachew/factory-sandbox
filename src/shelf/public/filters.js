// The list's search and filters, and how they live in the page URL's query string. Pure: no DOM, so Bun tests it.

export const FILTER_KEYS = ["q", "status", "kind", "tag", "min_rating"];

const ALLOWED = {
  status: ["to_read", "reading", "done"],
  kind: ["book", "article"],
  min_rating: ["1", "2", "3", "4", "5"],
};

/**
 * Reads the filters from a query string ("?q=dune&status=done" or without the "?"). Absent keys are "". A status,
 * kind or min_rating the API would refuse becomes "", so an old or hand-edited bookmark shows the list, not an error.
 */
export function filtersFromSearch(search) {
  const params = new URLSearchParams(search);
  const filters = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key) ?? "";
    filters[key] = ALLOWED[key] && !ALLOWED[key].includes(value) ? "" : value;
  }
  return filters;
}

const isSet = (key, value) => (key === "q" ? value.trim() !== "" : value !== "");

/** The query string for `filters`: "" when nothing is set, else "?" and the set ones in FILTER_KEYS order. */
export function filtersToSearch(filters) {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key] ?? "";
    if (isSet(key, value)) params.set(key, value);
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/** True when any filter is set (a q of only spaces does not count). */
export function hasFilters(filters) {
  return FILTER_KEYS.some((key) => isSet(key, filters[key] ?? ""));
}

/** The API path that lists the items matching `filters`. */
export function itemsPath(filters) {
  return `/api/items${filtersToSearch(filters)}`;
}
