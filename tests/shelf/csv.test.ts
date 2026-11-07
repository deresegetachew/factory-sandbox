import { describe, expect, test } from "bun:test";
import { parseCsv, writeCsv } from "../../src/shelf/csv";

describe("writeCsv", () => {
  test("joins fields with commas and ends every row, including the last, with CRLF", () => {
    expect(writeCsv([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d\r\n");
  });
  test("an empty list of rows is the empty string", () => {
    expect(writeCsv([])).toBe("");
  });
  test("plain fields, empty strings, emoji and Amharic are not quoted", () => {
    expect(writeCsv([["", "😀", "ሰላም", "=SUM(A1)"]])).toBe(",😀,ሰላም,=SUM(A1)\r\n");
  });
  test("quotes a field with a comma", () => {
    expect(writeCsv([["a,b"]])).toBe('"a,b"\r\n');
  });
  test("quotes a field with a double quote and doubles the quote", () => {
    expect(writeCsv([['say "hi"']])).toBe('"say ""hi"""\r\n');
  });
  test("quotes fields with LF or CRLF and keeps the breaks exactly", () => {
    expect(writeCsv([["a\nb", "c\r\nd", "e\rf"]])).toBe('"a\nb","c\r\nd","e\rf"\r\n');
  });
  test("has no BOM", () => {
    expect(writeCsv([["a"]]).charCodeAt(0)).not.toBe(0xfeff);
  });
});

describe("parseCsv", () => {
  test("parses an empty string to no rows", () => {
    expect(parseCsv("")).toEqual([]);
  });
  test("reads CRLF and LF row endings", () => {
    expect(parseCsv("a,b\r\nc,d\ne,f")).toEqual([["a", "b"], ["c", "d"], ["e", "f"]]);
  });
  test("a trailing line break does not add an empty row", () => {
    expect(parseCsv("a,b\r\n")).toEqual([["a", "b"]]);
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
    expect(parseCsv("a,b")).toEqual([["a", "b"]]);
  });
  test("quoted fields keep commas, doubled quotes and line breaks exactly", () => {
    expect(parseCsv('"a,b","say ""hi""","x\r\ny","p\nq"\r\n')).toEqual([["a,b", 'say "hi"', "x\r\ny", "p\nq"]]);
  });
  test("an empty field and empty trailing field are kept", () => {
    expect(parseCsv(",a,\r\n")).toEqual([["", "a", ""]]);
    expect(parseCsv('"",a\r\n')).toEqual([["", "a"]]);
  });
  test("an empty line in the middle is a row with one empty field", () => {
    expect(parseCsv("a\r\n\r\nb\r\n")).toEqual([["a"], [""], ["b"]]);
  });
  test("an unclosed quote throws an error naming the line", () => {
    expect(() => parseCsv('a,b\r\nc,"oops\r\n')).toThrow(/\b2\b|line 2/i);
    expect(() => parseCsv('"oops')).toThrow(/\b1\b/);
  });
  test("a quote in the middle of an unquoted field throws an error naming the line", () => {
    expect(() => parseCsv('a,b\r\nx,a"b\r\n')).toThrow(/\b2\b/);
    expect(() => parseCsv('a"b')).toThrow(/\b1\b/);
  });
});

describe("round trip", () => {
  test("parseCsv(writeCsv(rows)) equals rows", () => {
    const rows = [
      ["title", "notes"],
      ["a,b", 'say "hi"'],
      ["crlf\r\nbreak", "lf\nbreak"],
      ["😀 emoji", "ሰላም ለዓለም"],
      ["", ""],
      ["=1+1", "+x"],
      ['"', ","],
    ];
    expect(parseCsv(writeCsv(rows))).toEqual(rows);
  });
});
