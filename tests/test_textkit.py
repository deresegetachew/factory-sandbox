import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from textkit import slugify, word_count

def test_slugify():
    assert slugify("Hello, World!") == "hello-world"

def test_word_count():
    assert word_count("hello world") == 2
    assert word_count("  a \t b\nc  ") == 3
    assert word_count("") == 0
    assert word_count("   \n\t ") == 0

if __name__ == "__main__":
    test_slugify(); test_word_count(); print("ok")
