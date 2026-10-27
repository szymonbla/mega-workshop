import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("prepare", Path(__file__).with_name("prepare-read-along.py"))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


def speech(text):
    return [{"word": word, "start": i * .3, "end": (i + 1) * .3} for i, word in enumerate(text.split())]


class MatchingTests(unittest.TestCase):
    def test_skips_a_digression_and_resumes_at_the_actual_words(self):
        article = "Models read numbers. Then generate more numbers.".split()
        spoken = speech("Models read numbers. This picture shows a cat. Then generate more numbers.")
        matches = prepare.match_words(article, spoken)
        self.assertEqual([m["word"] for m in matches], list(range(len(article))))
        self.assertEqual(matches[3]["start"], next(w["start"] for w in spoken if w["word"] == "Then"))

    def test_does_not_attach_a_single_common_word_to_unrelated_speech(self):
        self.assertEqual(prepare.match_words(["the", "model"], speech("Look at the picture")), [])

    def test_spelling_variants_and_inline_markup_keep_the_original_text(self):
        article = prepare.ArticleWords('<p><strong>Tokenization:</strong> optimizes <a href="/">the model</a>.</p><img src="x">')
        matches = prepare.match_words(article.words, speech("Tokenisation optimises the model"))
        self.assertEqual([m["word"] for m in matches], [0, 1, 2, 3])
        self.assertEqual(article.words, ["Tokenization:", "optimizes", "the", "model", "."])
        self.assertEqual(article.figures, [5])

    def test_zero_duration_words_are_not_invented(self):
        spoken = speech("Read this text")
        spoken[1]["end"] = spoken[1]["start"]
        self.assertEqual([m["word"] for m in prepare.match_words("Read this text".split(), spoken)], [0, 2])


if __name__ == "__main__":
    unittest.main()
