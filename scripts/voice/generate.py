#!/usr/bin/env python3
"""Generated radio voice for Joker's Run.

Clips are made ahead of time with ElevenLabs (the same API as the Animal-Sounds clips), run
through a radio filter with ffmpeg and shipped as static MP3s in public/voice/.
src/voice-manifest.json maps "WHO|text" to a clip and its length.

The API key comes from ELEVENLABS_API_KEY or ../ChannelKnowledgeBase/.env. `design` and
`verify` also need numpy and mlx_whisper, so run it with the ChannelKnowledgeBase venv:

  ../ChannelKnowledgeBase/.venv/bin/python scripts/voice/generate.py <command>

Commands:
  check          every radio line in src/ has an entry in lines.json, and nothing extra
  design WHO     audition three new voice previews for a speaker (scripts/voice/auditions/)
  create WHO N   save preview N as the speaker's voice and record its id in cast.json
  lines          render missing clips, process them and rewrite the manifest
  verify         transcribe every clip with Whisper and compare it with its line

Clips are cached by everything that shapes them (voice, model, settings, text, seed), so
`lines` only calls the API for new or changed lines. To re-roll one take, give the line a
new "seed" in lines.json. A line can also carry "say", the text the voice reads when the
caption needs a nudge (a pause, a respelling), like spokenName in Animal-Sounds.
"""
import base64
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CAST = HERE / "cast.json"
LINES = HERE / "lines.json"
RAW = HERE / "raw"
AUDITIONS = HERE / "auditions"
OUT = ROOT / "public" / "voice"
MANIFEST = ROOT / "src" / "voice-manifest.json"
API = "https://api.elevenlabs.io"
WHISPER = "mlx-community/whisper-large-v3-turbo"

# Bump when FX changes so processed clips get new file names (and dodge stale caches).
FX_VERSION = 1
# Radio: trim the silence at both ends, band-limit to a headset range, squash and lightly
# clip it, then lay a faint hiss under the words.
FX = (
    "[0:a]aformat=sample_rates=44100:channel_layouts=mono,"
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,"
    "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,"
    "highpass=f=300:poles=2,lowpass=f=3400:poles=2,"
    "acompressor=threshold=-24dB:ratio=6:attack=2:release=60:makeup=3,"
    "asoftclip=type=atan:threshold=0.8[v];"
    "anoisesrc=color=pink:amplitude=0.012:sample_rate=44100,highpass=f=600,lowpass=f=3000[n];"
    "[v][n]amix=inputs=2:duration=first:normalize=0,"
    "afade=t=in:d=0.02,areverse,afade=t=in:d=0.04,areverse"
)
PEAK_DB = -1.0


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def save(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def api_key():
    key = os.environ.get("ELEVENLABS_API_KEY", "")
    env = ROOT.parent / "ChannelKnowledgeBase" / ".env"
    if not key and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("ELEVENLABS_API_KEY="):
                key = line.split("=", 1)[1].strip().strip("\"'")
    if not key:
        sys.exit("ELEVENLABS_API_KEY is not set")
    return key


def post(path, body, accept="application/json"):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode(),
        method="POST",
        headers={"xi-api-key": api_key(), "content-type": "application/json", "accept": accept},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"POST {path}: HTTP {e.code} {e.read().decode(errors='replace')[:600]}")


# ---------------------------------------------------------------- check

LIT = r"'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\""


def literals(s):
    return [m[1:-1].replace("\\'", "'").replace('\\"', '"') for m in re.findall(LIT, s)]


def source_lines():
    """(who, text) for every radio call in src/, expanding random picks and lookup tables."""
    arg = rf"{LIT}|\[[^\]]*\](?:\[[^\]]*\])?|[A-Za-z_]\w*\[[^\]]*\]"
    found = set()
    for f in sorted((ROOT / "src").glob("*.ts")):
        src = f.read_text(encoding="utf-8")
        for who, text in re.findall(rf"\bradio\(\s*({arg})\s*,\s*({arg})", src):
            def values(a):
                if re.match(r"[A-Za-z_]", a):  # table[key]: the string values of `table`
                    name = a.split("[")[0]
                    m = re.search(rf"\b{name}\b[^=\n]*=\s*(\{{[^}}]*\}}|\[[^\]]*\])", src)
                    return literals(m.group(1)) if m else []
                return literals(a)
            for w in values(who):
                for t in values(text):
                    found.add((w, t))
    return found


def check():
    want = source_lines()
    have = {(ln["who"], ln["text"]) for ln in load(LINES)}
    missing, extra = want - have, have - want
    for w, t in sorted(missing):
        print(f"missing from lines.json: {w}: {t}")
    for w, t in sorted(extra):
        print(f"not in src/: {w}: {t}")
    print(f"{len(want)} radio lines in src/, {len(have)} in lines.json")
    return not missing and not extra


# ---------------------------------------------------------------- analysis

def pcm(path, sr=16000):
    import numpy as np
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def median_pitch(path):
    """Median F0 in Hz over voiced 40 ms frames (plain autocorrelation)."""
    import numpy as np
    sr, n, hop = 16000, 640, 160
    x = pcm(path, sr)
    gate = 0.5 * float(np.sqrt(np.mean(x ** 2)))
    lo, hi = sr // 400, sr // 65
    f0 = []
    for i in range(0, len(x) - n, hop):
        fr = x[i:i + n] - x[i:i + n].mean()
        if float(np.sqrt(np.mean(fr ** 2))) < gate:
            continue
        ac = np.correlate(fr, fr, "full")[n - 1:]
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.3 * ac[0]:
            f0.append(sr / k)
    return float(np.median(f0)) if f0 else 0.0


DIGITS = "zero one two three four five six seven eight nine".split()


def words(s):
    out = []
    for w in re.sub(r"[^a-z0-9' ]+", " ", s.lower().replace("-", " ")).split():
        w = w.strip("'")
        out.extend(DIGITS[int(c)] for c in w) if w.isdigit() else out.append(w)
    return [w for w in out if w]


def transcribe(path):
    import mlx_whisper
    return mlx_whisper.transcribe(str(path), path_or_hf_repo=WHISPER, language="en")["text"].strip()


def match(heard, text):
    return difflib.SequenceMatcher(None, words(heard), words(text)).ratio()


# ---------------------------------------------------------------- voices

def design(who):
    cast = load(CAST)
    sp = cast["speakers"][who]
    res = json.loads(post("/v1/text-to-voice/design", {
        "voice_description": sp["description"],
        "model_id": cast["design_model"],
        "text": sp["sample"],
    }))
    AUDITIONS.mkdir(exist_ok=True)
    previews = []
    for i, p in enumerate(res["previews"], 1):
        f = AUDITIONS / f"{slug(who)}-{i}.mp3"
        f.write_bytes(base64.b64decode(p["audio_base_64"]))
        heard = transcribe(f)
        previews.append({
            "n": i,
            "generated_voice_id": p["generated_voice_id"],
            "file": f.name,
            "pitch_hz": round(median_pitch(f)),
            "match": round(match(heard, sp["sample"]), 3),
            "heard": heard,
        })
        print(f"{who} preview {i}: pitch {previews[-1]['pitch_hz']} Hz, match {previews[-1]['match']}")
    save(AUDITIONS / f"{slug(who)}.json", {"who": who, "previews": previews})


def create(who, n):
    cast = load(CAST)
    sp = cast["speakers"][who]
    aud = load(AUDITIONS / f"{slug(who)}.json")
    pick = aud["previews"][n - 1]["generated_voice_id"]
    res = json.loads(post("/v1/text-to-voice", {
        "voice_name": f"Joker's Run - {who}",
        "voice_description": sp["description"],
        "generated_voice_id": pick,
        "played_not_selected_voice_ids": [p["generated_voice_id"] for p in aud["previews"] if p["generated_voice_id"] != pick],
    }))
    sp["voice_id"] = res["voice_id"]
    save(CAST, cast)
    print(f"{who}: voice {res['voice_id']}")


# ---------------------------------------------------------------- clips

def spoken(ln):
    """What the voice reads: the caption, or "say" where it needs a nudge, after any v3 tag."""
    text = ln.get("say", ln["text"])
    return f"{ln['tag']} {text}" if ln.get("tag") else text


def process(raw, out):
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "fx.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-filter_complex", FX, str(wav)], check=True)
        stats = subprocess.run(
            ["ffmpeg", "-i", str(wav), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True
        ).stderr
        peak = float(re.search(r"max_volume: (-?[\d.]+) dB", stats).group(1))
        subprocess.run([
            "ffmpeg", "-v", "error", "-y", "-i", str(wav), "-af", f"volume={PEAK_DB - peak:.2f}dB",
            "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "80k", str(out),
        ], check=True)


def duration(path):
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout)


def lines():
    if not check():
        sys.exit("lines.json is out of step with src/")
    cast = load(CAST)
    RAW.mkdir(exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    manifest, keep_raw, keep_out = {}, set(), set()
    for ln in load(LINES):
        who = ln["who"]
        voice = cast["speakers"][who]["voice_id"]
        if not voice:
            sys.exit(f"{who} has no voice yet: run `design` and `create` first")
        spec = {"voice": voice, "model": cast["model"], "settings": cast["voice_settings"],
                "text": spoken(ln), "seed": ln.get("seed", 1)}
        key = hashlib.sha1(json.dumps(spec, sort_keys=True).encode()).hexdigest()[:10]
        name = slug(f"{who} {ln['text']}")[:48].strip("-")
        raw = RAW / f"{name}-{key}.mp3"
        if not raw.exists():
            print(f"render {who}: {spoken(ln)}")
            raw.write_bytes(post(
                f"/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
                {"text": spec["text"], "model_id": spec["model"], "voice_settings": spec["settings"], "seed": spec["seed"]},
                accept="audio/mpeg",
            ))
        out = OUT / f"{name}-{hashlib.sha1(f'{key}:{FX_VERSION}'.encode()).hexdigest()[:8]}.mp3"
        if not out.exists():
            process(raw, out)
        keep_raw.add(raw.name)
        keep_out.add(out.name)
        manifest[f"{who}|{ln['text']}"] = {"file": f"voice/{out.name}", "dur": round(duration(out), 2)}
    for d, keep in ((RAW, keep_raw), (OUT, keep_out)):
        for f in d.glob("*.mp3"):
            if f.name not in keep:
                f.unlink()
    save(MANIFEST, manifest)
    print(f"{len(manifest)} clips, {sum(v['dur'] for v in manifest.values()):.1f} s")


def verify():
    bad = 0
    for key, clip in load(MANIFEST).items():
        who, text = key.split("|", 1)
        heard = transcribe(ROOT / "public" / clip["file"])
        score = match(heard, text)
        flag = "" if score >= 0.85 else "  <-- CHECK"
        bad += bool(flag)
        print(f"{score:.2f} {clip['dur']:5.2f}s {who}: {text}\n      heard: {heard}{flag}")
    print(f"{bad} clip(s) to check")
    return bad == 0


if __name__ == "__main__":
    cmd, args = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else ("", [])
    if cmd == "check":
        sys.exit(0 if check() else 1)
    elif cmd == "design" and args:
        design(args[0])
    elif cmd == "create" and len(args) == 2:
        create(args[0], int(args[1]))
    elif cmd == "lines":
        lines()
    elif cmd == "verify":
        sys.exit(0 if verify() else 1)
    else:
        sys.exit(__doc__)
