"""Tiny text helpers (a sandbox project for testing the software factory)."""


def slugify(text):
    return "-".join("".join(c.lower() if c.isalnum() else " " for c in text).split())


def is_palindrome(text):
    chars = [c.lower() for c in text if c.isalnum()]
    return chars == chars[::-1]
