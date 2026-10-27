"""Transcribe local clips, then match spoken words to the unchanged article.

Run the study server first. See README for the optional Python environment.
Cached transcripts are reusable; no model is needed to rebuild text mappings.
"""
import argparse
import os
from difflib import SequenceMatcher
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.request import urlopen

ROOT = Path(os.environ.get("STUDY_DATA_HOME", Path(__file__).resolve().parents[2] / ".study-data")) / "study"
MODEL = "small.en"


def digest(data):
    return hashlib.sha256(data).hexdigest()


class ArticleWords(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.words = []
        self.figures = []
        self.feed(html)

    def handle_data(self, text):
        self.words.extend(re.findall(r"\S+", text))

    def handle_starttag(self, tag, attrs):
        if tag == "img":
            self.figures.append(len(self.words))


def normalize(word):
    word = re.sub(r"[^a-z0-9]", "", word.lower())
    for british, american in (("tokenis", "tokeniz"), ("optimis", "optimiz"), ("generalis", "generaliz"), ("recognis", "recogniz")):
        word = word.replace(british, american)
    return word


def match_words(article, spoken):
    """Only highlight supported matches; never stretch a word across a digression."""
    left = [(i, normalize(w)) for i, w in enumerate(article)]
    left = [(i, w) for i, w in left if w]
    right = [(i, normalize(w["word"])) for i, w in enumerate(spoken)]
    right = [(i, w) for i, w in right if w]
    blocks = SequenceMatcher(None, [w for _, w in left], [w for _, w in right], autojunk=False).get_matching_blocks()
    matched = []
    for a, b, size in blocks:
        # A lone common word can otherwise attach to an unrelated description.
        if size < 2 or (size == 2 and sum(len(w) for _, w in left[a:a+size]) < 8):
            continue
        for offset in range(size):
            wi = left[a + offset][0]
            si = right[b + offset][0]
            word = spoken[si]
            if word["end"] > word["start"] and word.get("probability", 1) >= .35:
                matched.append({"word": wi, "start": word["start"], "end": word["end"], "spoken": si})
    return matched


def make_alignment(section, transcript):
    article = ArticleWords(section["html"])
    spoken = transcript["words"]
    matches = match_words(article.words, spoken)
    passages = []
    # Describe only gaps containing actual unmatched speech, not silent pauses.
    edges = [{"spoken": -1, "word": -1}, *matches, {"spoken": len(spoken), "word": len(article.words)}]
    for previous, following in zip(edges, edges[1:]):
        gap = spoken[previous["spoken"] + 1:following["spoken"]]
        if not gap or gap[-1]["end"] - gap[0]["start"] < 1.5:
            continue
        passage = {"start": gap[0]["start"], "end": gap[-1]["end"], "kind": "narration"}
        text = " ".join(w["word"] for w in gap).lower()
        candidates = [i for i, pos in enumerate(article.figures) if previous["word"] < pos <= following["word"] + 1]
        if len(candidates) == 1 and re.search(r"\b(diagram|illustration|image|figure|picture|screenshot)\b", text):
            passage.update(kind="figure", figure=candidates[0])
        passages.append(passage)
    return {
        "version": 1,
        "model": transcript["model"],
        "markdownSha256": digest(section["markdown"].encode()),
        "audioSha256": transcript["audioSha256"],
        "words": article.words,
        "cues": [{k: c[k] for k in ("word", "start", "end")} for c in matches],
        "passages": passages,
    }


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:4830")
    parser.add_argument("--section", help="Only prepare this section slug")
    parser.add_argument("--cached-only", action="store_true", help="Rebuild mappings without running speech recognition")
    args = parser.parse_args()
    with urlopen(args.url + "/study-api/lessons") as response:
        sections = json.load(response)
    if args.section:
        sections = [s for s in sections if s["slug"] == args.section]
        if not sections:
            parser.error("Unknown section")
    model = None
    for section in sections:
        slug = section["slug"]
        clip = ROOT / "public" / "audio" / (slug + ".mp3")
        audio_hash = digest(clip.read_bytes())
        cached = ROOT / "alignment" / "transcripts" / (slug + ".json")
        transcript = json.loads(cached.read_text()) if cached.exists() else None
        if not transcript or transcript["audioSha256"] != audio_hash or transcript["model"] != MODEL:
            if args.cached_only:
                raise RuntimeError(f"Missing current transcript: {slug}")
            if model is None:
                import stable_whisper
                model = stable_whisper.load_mlx_whisper(MODEL)
            print(f"Transcribing {slug}…", flush=True)
            result = model.transcribe(str(clip), language="en", temperature=0, verbose=None, condition_on_previous_text=False)
            words = [{"word": w["word"].strip(), "start": round(w["start"], 3), "end": round(w["end"], 3),
                      "probability": round(w.get("probability", 1), 3)}
                     for segment in result.to_dict()["segments"] for w in segment["words"]]
            transcript = {"model": MODEL, "engine": "stable-ts 2.19.1 / mlx-whisper 0.4.3", "audioSha256": audio_hash, "words": words}
            write_json(cached, transcript)
        alignment = make_alignment(section, transcript)
        write_json(ROOT / "alignment" / (slug + ".json"), alignment)
        print(f"{slug}: {len(alignment['cues'])}/{len(alignment['words'])} words matched, {len(alignment['passages'])} narration gaps", flush=True)


if __name__ == "__main__":
    main()
