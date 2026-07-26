import pytest
from livekit.plugins.sarvam import tts as sarvam_tts

from app.models import VoiceConfig
from inferences.tts import (
    SARVAM_BULBUL_V3_FEMALE_SPEAKERS,
    SARVAM_BULBUL_V3_MALE_SPEAKERS,
    SARVAM_BULBUL_V3_SPEAKERS,
    build_tts,
)


def test_bulbul_v3_catalog_matches_sarvam_current_voice_list() -> None:
    assert len(SARVAM_BULBUL_V3_SPEAKERS) == 37
    assert len(SARVAM_BULBUL_V3_FEMALE_SPEAKERS) == 14
    assert len(SARVAM_BULBUL_V3_MALE_SPEAKERS) == 23
    assert "amelia" not in SARVAM_BULBUL_V3_SPEAKERS
    assert "sophia" not in SARVAM_BULBUL_V3_SPEAKERS

    compatibility = sarvam_tts.MODEL_SPEAKER_COMPATIBILITY["bulbul:v3"]
    assert compatibility["female"] == list(SARVAM_BULBUL_V3_FEMALE_SPEAKERS)
    assert compatibility["male"] == list(SARVAM_BULBUL_V3_MALE_SPEAKERS)
    assert compatibility["all"] == list(SARVAM_BULBUL_V3_SPEAKERS)


@pytest.mark.parametrize(
    "speaker",
    ["anand", "tarun", "sunny", "mani", "gokul", "vijay", "mohit", "rehan", "soham"],
)
def test_build_tts_accepts_every_newly_added_bulbul_v3_speaker(speaker: str) -> None:
    engine = build_tts(VoiceConfig(speaker=speaker), api_key="test-sarvam-key")
    assert engine._opts.model == "bulbul:v3"
    assert engine._opts.speaker == speaker
