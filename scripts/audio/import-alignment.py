"""Prepare imported lesson word maps without requiring a running HTTP server."""
import importlib.util
import json
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location("alignment", Path(__file__).with_name("prepare-read-along.py"))
alignment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alignment)
root = Path(sys.argv[1])
sections = json.loads((root / "sections.json").read_text())
model = None
for index, section in enumerate(sections):
    clip = root / "audio" / (section["slug"] + ".mp3")
    sha = alignment.digest(clip.read_bytes())
    cache = root / "transcripts" / (section["slug"] + ".json")
    transcript = json.loads(cache.read_text()) if cache.exists() else None
    if not transcript or transcript["audioSha256"] != sha:
        if model is None:
            import stable_whisper
            model = stable_whisper.load_mlx_whisper(alignment.MODEL)
        result = model.transcribe(str(clip), language="en", temperature=0, verbose=None, condition_on_previous_text=False)
        words = [{"word": w["word"].strip(), "start": round(w["start"], 3), "end": round(w["end"], 3), "probability": w.get("probability", 1)} for segment in result.to_dict()["segments"] for w in segment["words"]]
        transcript = {"model": alignment.MODEL, "audioSha256": sha, "words": words}
        alignment.write_json(cache, transcript)
    alignment.write_json(root / "alignment" / (section["slug"] + ".json"), alignment.make_alignment(section, transcript))
    print(f"{index + 1}/{len(sections)} sections synchronized", flush=True)
