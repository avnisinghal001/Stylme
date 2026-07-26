from livekit.plugins import sarvam
from livekit.plugins.sarvam import tts as sarvam_tts

from app.models import VoiceConfig
from settings import SARVAM_API_KEY

SARVAM_BULBUL_V3_FEMALE_SPEAKERS = (
    "ritu",
    "priya",
    "neha",
    "pooja",
    "simran",
    "kavya",
    "ishita",
    "shreya",
    "roopa",
    "tanya",
    "shruti",
    "suhani",
    "kavitha",
    "rupali",
)
SARVAM_BULBUL_V3_MALE_SPEAKERS = (
    "shubh",
    "aditya",
    "rahul",
    "rohan",
    "amit",
    "dev",
    "ratan",
    "varun",
    "manan",
    "sumit",
    "kabir",
    "aayan",
    "ashutosh",
    "advait",
    "anand",
    "tarun",
    "sunny",
    "mani",
    "gokul",
    "vijay",
    "mohit",
    "rehan",
    "soham",
)
SARVAM_BULBUL_V3_SPEAKERS = (
    *SARVAM_BULBUL_V3_FEMALE_SPEAKERS,
    *SARVAM_BULBUL_V3_MALE_SPEAKERS,
)


def _sync_livekit_bulbul_v3_catalog() -> None:
    """Keep the LiveKit plugin's runtime validation aligned with Sarvam docs."""
    # UNVERIFIED: Please check docs.livekit.io for a future public catalog API.
    compatibility = sarvam_tts.MODEL_SPEAKER_COMPATIBILITY.get("bulbul:v3")
    if compatibility is None:
        return
    compatibility["female"] = list(SARVAM_BULBUL_V3_FEMALE_SPEAKERS)
    compatibility["male"] = list(SARVAM_BULBUL_V3_MALE_SPEAKERS)
    compatibility["all"] = list(SARVAM_BULBUL_V3_SPEAKERS)


_sync_livekit_bulbul_v3_catalog()


def build_tts(config: VoiceConfig, api_key: str = "") -> sarvam.TTS:
    target_language = "hi-IN" if config.language == "multi" else config.language
    return sarvam.TTS(
        model=config.tts_model,
        target_language_code=target_language,
        speaker=config.speaker,
        api_key=api_key or SARVAM_API_KEY,
        pace=config.pace,
        temperature=0.6,
        speech_sample_rate=22050,
        output_audio_bitrate="128k",
        output_audio_codec="mp3",
        min_buffer_size=40,
        max_chunk_length=120,
        send_completion_event=True,
    )
