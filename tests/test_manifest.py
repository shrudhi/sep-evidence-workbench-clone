import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def test_available_sources_match_manifest_hashes():
    manifest = json.loads((ROOT / "sources" / "manifest.json").read_text())
    available = [entry for entry in manifest["documents"] if entry["status"] == "available"]
    assert len(available) == 3
    for entry in available:
        assert sha256(ROOT / "sources" / entry["filename"]) == entry["sha256"]


def test_h265_has_clean_pending_slot():
    manifest = json.loads((ROOT / "sources" / "manifest.json").read_text())
    h265 = next(entry for entry in manifest["documents"] if entry["family"] == "H.265")
    assert h265["edition"] == "ITU-T H.265 V10 (07/2024)"
    assert h265["status"] == "pending"
    assert h265["sha256"] is None
