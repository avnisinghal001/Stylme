from livekit.plugins import deepgram

from app.models import VoiceConfig
from settings import DEEPGRAM_API_KEY


def build_stt(config: VoiceConfig, api_key: str = "") -> deepgram.STT:
    return deepgram.STT(
        model=config.stt_model,
        language=config.language,
        api_key=api_key or DEEPGRAM_API_KEY,
        interim_results=True,
        punctuate=True,
        filler_words=True,
        smart_format=True,
        endpointing_ms=25,
    )
