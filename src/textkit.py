"""Tiny text helpers (a sandbox project for testing the software factory)."""


def slugify(text):
    return "-".join("".join(c.lower() if c.isalnum() else " " for c in text).split())


def truncate(text, n):
    if len(text) <= n:
        return text
    return text[: n - 1] + "…"
