import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from textkit import slugify, truncate

def test_slugify():
    assert slugify("Hello, World!") == "hello-world"

def test_truncate():
    assert truncate("hello", 5) == "hello"
    assert truncate("hi", 5) == "hi"
    assert truncate("hello world", 5) == "hell…"
    assert truncate("hello", 1) == "…"
    assert truncate("", 3) == ""

if __name__ == "__main__":
    test_slugify(); test_truncate(); print("ok")
