import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from textkit import slugify

def test_slugify():
    assert slugify("Hello, World!") == "hello-world"

if __name__ == "__main__":
    test_slugify(); print("ok")
