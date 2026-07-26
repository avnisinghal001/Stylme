import re
import unicodedata


def normalize_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).replace("&", " and ")
    normalized = re.sub(r"[®™©]", "", normalized).casefold()
    return re.sub(r"[^a-z0-9]+", " ", normalized).strip()


def slugify(value: str, max_length: int = 90) -> str:
    return normalize_name(value).replace(" ", "-")[:max_length].strip("-")
