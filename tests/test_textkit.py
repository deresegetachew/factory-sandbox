import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from textkit import is_palindrome, slugify


class SlugifyTest(unittest.TestCase):
    def test_slugify(self):
        self.assertEqual(slugify("Hello, World!"), "hello-world")


class IsPalindromeTest(unittest.TestCase):
    def test_simple_palindrome(self):
        self.assertTrue(is_palindrome("racecar"))

    def test_mixed_case(self):
        self.assertTrue(is_palindrome("RaceCar"))

    def test_spaces_and_punctuation_ignored(self):
        self.assertTrue(is_palindrome("A man, a plan, a canal: Panama"))

    def test_digits_palindrome(self):
        self.assertTrue(is_palindrome("12321"))

    def test_digits_not_palindrome(self):
        self.assertFalse(is_palindrome("123"))

    def test_not_a_palindrome(self):
        self.assertFalse(is_palindrome("hello"))

    def test_empty_string_is_true(self):
        self.assertTrue(is_palindrome(""))

    def test_punctuation_only_is_true(self):
        self.assertTrue(is_palindrome("?! ,."))


if __name__ == "__main__":
    unittest.main()
