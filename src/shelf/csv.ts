/**
 * A small RFC 4180 CSV writer and reader, written here because the app takes no npm packages. The export writes
 * with it and the import reads with it, so whatever one writes the other reads back unchanged.
 */

const NEEDS_QUOTES = /[",\r\n]/;

/** One field: quoted only when it contains a comma, a quote or a line break; quotes inside are doubled. */
function writeField(value: string): string {
  return NEEDS_QUOTES.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Rows to CSV text. Every row ends with CRLF; line breaks inside a field are kept exactly. No BOM. */
export function writeCsv(rows: string[][]): string {
  return rows.map((row) => row.map(writeField).join(",") + "\r\n").join("");
}

/**
 * CSV text to rows. Rows may end with CRLF or LF, and the last line break is optional. Quoted fields may hold
 * commas, doubled quotes and line breaks (kept exactly). Throws an Error naming the line for an unclosed quote or
 * a quote inside an unquoted field. An empty line is a row with one empty field [""].
 */
export function parseCsv(text: string): string[][] {
  return parseCsvRecords(text).map((row) => (row.length === 0 ? [""] : row));
}

/**
 * Like parseCsv, but a truly empty line comes back as [] so it can be told apart from a line holding one empty
 * or quoted-empty field ("" or a space), which is [""] or [" "]. The import skips only the empty lines.
 */
export function parseCsvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let line = 1;
  let i = 0;
  let rowStarted = false;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    if (rowStarted) {
      endField();
      rows.push(row);
    } else {
      rows.push([]);
    }
    row = [];
    field = "";
    rowStarted = false;
  };

  while (i < n) {
    const c = text[i]!;
    const isLineBreak = c === "\n" || (c === "\r" && text[i + 1] === "\n");
    if (!isLineBreak) rowStarted = true;
    if (c === '"') {
      if (field !== "") throw new Error(`CSV line ${line}: a quote inside an unquoted field. Put the whole field in quotes and double the quote ("").`);
      const startLine = line;
      i++;
      for (;;) {
        if (i >= n) throw new Error(`CSV line ${startLine}: a quoted field is never closed. Add the closing quote.`);
        const q = text[i]!;
        if (q === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (q === "\n") line++;
        field += q;
        i++;
      }
      // After a closing quote only a separator, a line break or the end may follow.
      const next = text[i];
      if (next !== undefined && next !== "," && next !== "\n" && !(next === "\r" && text[i + 1] === "\n")) {
        throw new Error(`CSV line ${line}: text after a closing quote. Put the whole field in quotes and double any quote inside ("").`);
      }
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\r" && text[i + 1] === "\n") {
      endRow();
      line++;
      i += 2;
      continue;
    }
    if (c === "\n") {
      endRow();
      line++;
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // A final row without a line break; a trailing line break adds no empty row.
  if (rowStarted) endRow();
  return rows;
}
