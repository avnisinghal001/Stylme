from __future__ import annotations

from typing import Any, Dict, Sequence, Tuple


Target = Tuple[str, str, float]
DEMAND_PACK_VERSION = "india-hinglish-hindi-v1"


def _query(
    query: str,
    group: str,
    language: str,
    *targets: Target,
) -> Dict[str, Any]:
    return {
        "query": query,
        "group": group,
        "language": language,
        "targets": targets,
    }


# Exactly 100 high-signal Indian fashion requests. The targets are conservative
# merchandising interpretations, not demographic claims. Runtime graph building
# still intersects every target with the active database taxonomy before use.
INDIAN_SEARCH_DEMAND: Sequence[Dict[str, Any]] = (
    # Beauty, polish and aesthetic intent (1-15)
    _query("sundar", "aesthetic", "hi-Latn", ("mood", "elegant", 0.94), ("style", "classic", 0.78)),
    _query("सुंदर", "aesthetic", "hi-Deva", ("mood", "elegant", 0.94), ("style", "classic", 0.78)),
    _query("bahut sundar", "aesthetic", "hi-Latn", ("mood", "elegant", 0.96), ("style", "classic", 0.8)),
    _query("बहुत सुंदर", "aesthetic", "hi-Deva", ("mood", "elegant", 0.96), ("style", "classic", 0.8)),
    _query("ekdam pretty", "aesthetic", "hinglish", ("mood", "romantic", 0.9), ("aesthetic", "soft-girl", 0.86)),
    _query("bilkul pretty", "aesthetic", "hinglish", ("mood", "romantic", 0.88), ("aesthetic", "soft-girl", 0.84)),
    _query("khoobsurat", "aesthetic", "hi-Latn", ("mood", "elegant", 0.94), ("style", "classic", 0.8)),
    _query("खूबसूरत", "aesthetic", "hi-Deva", ("mood", "elegant", 0.94), ("style", "classic", 0.8)),
    _query("pyara sa", "aesthetic", "hi-Latn", ("mood", "playful", 0.88), ("aesthetic", "soft-girl", 0.84)),
    _query("एकदम प्यारा", "aesthetic", "hi-Deva", ("mood", "playful", 0.9), ("aesthetic", "soft-girl", 0.84)),
    _query("elegant lagna hai", "aesthetic", "hinglish", ("mood", "elegant", 0.98), ("style", "classic", 0.86)),
    _query("classy chahiye", "aesthetic", "hinglish", ("aesthetic", "quiet-luxury", 0.9), ("style", "classic", 0.86)),
    _query("royal look", "aesthetic", "en-IN", ("style", "luxury", 0.92), ("aesthetic", "quiet-luxury", 0.84)),
    _query("shahi look", "aesthetic", "hi-Latn", ("style", "luxury", 0.92), ("mood", "elegant", 0.88)),
    _query("सादा और सुंदर", "aesthetic", "hi-Deva", ("style", "minimalist", 0.92), ("mood", "elegant", 0.84)),

    # Fit, movement, heat and comfort (16-30)
    _query("loose", "fit", "en-IN", ("fit", "loose", 0.99), ("mood", "relaxed", 0.78)),
    _query("loose fit ka", "fit", "hinglish", ("fit", "loose", 0.99), ("fit", "relaxed", 0.86)),
    _query("dheela", "fit", "hi-Latn", ("fit", "loose", 0.98), ("fit", "relaxed", 0.86)),
    _query("ढीला", "fit", "hi-Deva", ("fit", "loose", 0.98), ("fit", "relaxed", 0.86)),
    _query("thoda loose", "fit", "hinglish", ("fit", "loose", 0.96), ("fit", "relaxed", 0.84)),
    _query("baggy chahiye", "fit", "hinglish", ("fit", "oversized", 0.98), ("style", "streetwear", 0.8)),
    _query("oversized look", "fit", "en-IN", ("fit", "oversized", 0.98), ("style", "streetwear", 0.82)),
    _query("relaxed fit", "fit", "en-IN", ("fit", "relaxed", 0.99), ("mood", "relaxed", 0.84)),
    _query("aaramdayak", "fit", "hi-Latn", ("fit", "relaxed", 0.96), ("material", "cotton", 0.84)),
    _query("आरामदायक", "fit", "hi-Deva", ("fit", "relaxed", 0.96), ("material", "cotton", 0.84)),
    _query("chipka hua nahi", "fit", "hi-Latn", ("fit", "loose", 0.94), ("fit", "relaxed", 0.88)),
    _query("चिपका हुआ नहीं", "fit", "hi-Deva", ("fit", "loose", 0.94), ("fit", "relaxed", 0.88)),
    _query("body pe tight nahi", "fit", "hinglish", ("fit", "loose", 0.94), ("fit", "relaxed", 0.88)),
    _query("hawa daar", "fit", "hi-Latn", ("material", "cotton", 0.92), ("material", "linen", 0.88), ("fit", "relaxed", 0.82)),
    _query("हवादार", "fit", "hi-Deva", ("material", "cotton", 0.92), ("material", "linen", 0.88), ("fit", "relaxed", 0.82)),

    # Pattern and colour language (31-45)
    _query("floral", "pattern-colour", "en-IN", ("pattern", "floral", 0.99),),
    _query("floral wala", "pattern-colour", "hinglish", ("pattern", "floral", 0.98),),
    _query("phool wala", "pattern-colour", "hi-Latn", ("pattern", "floral", 0.98),),
    _query("फूलों वाला", "pattern-colour", "hi-Deva", ("pattern", "floral", 0.98),),
    _query("flower print", "pattern-colour", "en-IN", ("pattern", "floral", 0.96), ("pattern", "printed", 0.84)),
    _query("white color ka", "pattern-colour", "hinglish", ("color_family", "white", 0.99), ("pattern", "solid", 0.74)),
    _query("safed wala", "pattern-colour", "hi-Latn", ("color_family", "white", 0.99),),
    _query("सफेद रंग का", "pattern-colour", "hi-Deva", ("color_family", "white", 0.99),),
    _query("plain white", "pattern-colour", "en-IN", ("color_family", "white", 0.98), ("pattern", "solid", 0.94)),
    _query("bina print ka", "pattern-colour", "hi-Latn", ("pattern", "solid", 0.97), ("style", "minimalist", 0.82)),
    _query("बिना प्रिंट का", "pattern-colour", "hi-Deva", ("pattern", "solid", 0.97), ("style", "minimalist", 0.82)),
    _query("solid color", "pattern-colour", "en-IN", ("pattern", "solid", 0.98),),
    _query("striped wala", "pattern-colour", "hinglish", ("pattern", "striped", 0.98),),
    _query("checks wala", "pattern-colour", "hinglish", ("pattern", "checked", 0.98),),
    _query("embroidered wala", "pattern-colour", "hinglish", ("pattern", "embroidered", 0.96), ("surface_detail", "embroidery", 0.92)),

    # Indian occasions and festivals (46-60)
    _query("shaadi ke liye", "occasion", "hi-Latn", ("occasion", "wedding", 0.99), ("dress_code", "wedding-guest", 0.9)),
    _query("शादी के लिए", "occasion", "hi-Deva", ("occasion", "wedding", 0.99), ("dress_code", "wedding-guest", 0.9)),
    _query("bhai ki shaadi", "occasion", "hi-Latn", ("occasion", "wedding", 0.99), ("dress_code", "wedding-guest", 0.92)),
    _query("भाई की शादी", "occasion", "hi-Deva", ("occasion", "wedding", 0.99), ("dress_code", "wedding-guest", 0.92)),
    _query("cousin ki mehendi", "occasion", "hinglish", ("occasion", "mehendi", 0.99), ("dress_code", "ethnic-festive", 0.9)),
    _query("हल्दी फंक्शन", "occasion", "hi-Deva", ("occasion", "haldi", 0.99), ("color_family", "yellow", 0.82)),
    _query("sangeet night", "occasion", "hinglish", ("occasion", "sangeet", 0.99), ("dress_code", "bridal-party", 0.86)),
    _query("family function", "occasion", "en-IN", ("dress_code", "ethnic-festive", 0.94), ("style", "ethnic", 0.9)),
    _query("diwali outfit", "occasion", "hinglish", ("festival", "diwali", 0.99), ("theme", "festive", 0.94)),
    _query("navratri garba", "occasion", "hi-Latn", ("festival", "navratri", 0.99), ("theme", "festive", 0.94)),
    _query("eid ke liye", "occasion", "hi-Latn", ("festival", "eid", 0.99), ("theme", "festive", 0.94)),
    _query("rakhi outfit", "occasion", "hinglish", ("festival", "raksha-bandhan", 0.99), ("theme", "festive", 0.92)),
    _query("durga puja look", "occasion", "hinglish", ("festival", "durga-puja", 0.99), ("occasion", "puja", 0.92)),
    _query("पूजा के कपड़े", "occasion", "hi-Deva", ("occasion", "puja", 0.99), ("theme", "devotional", 0.92)),
    _query("wedding guest look", "occasion", "en-IN", ("occasion", "wedding-guest", 0.99), ("dress_code", "wedding-guest", 0.98)),

    # Mood, social effect and presentation (61-75)
    _query("minimal look", "mood-effect", "en-IN", ("style", "minimalist", 0.98), ("theme", "minimal", 0.96)),
    _query("zyada loud nahi", "mood-effect", "hi-Latn", ("style", "minimalist", 0.94), ("theme", "minimal", 0.9)),
    _query("ज्यादा चमकीला नहीं", "mood-effect", "hi-Deva", ("style", "minimalist", 0.92), ("pattern", "solid", 0.84)),
    _query("subtle chahiye", "mood-effect", "hinglish", ("style", "minimalist", 0.94), ("aesthetic", "quiet-luxury", 0.82)),
    _query("funky look", "mood-effect", "en-IN", ("mood", "bold", 0.92), ("aesthetic", "indie", 0.88)),
    _query("bold chahiye", "mood-effect", "hinglish", ("mood", "bold", 0.98), ("pattern", "colourblocked", 0.78)),
    _query("happy mood", "mood-effect", "en-IN", ("mood", "playful", 0.96), ("pattern", "floral", 0.76)),
    _query("chill vibe", "mood-effect", "en-IN", ("mood", "relaxed", 0.96), ("dress_code", "casual", 0.9)),
    _query("romantic look", "mood-effect", "en-IN", ("mood", "romantic", 0.98), ("theme", "romantic", 0.94)),
    _query("date night", "mood-effect", "en-IN", ("occasion", "date-night", 0.98), ("dress_code", "smart-casual", 0.82)),
    _query("boss lady look", "mood-effect", "hinglish", ("mood", "power-dressing", 0.98), ("fit", "tailored", 0.9)),
    _query("professional smart", "mood-effect", "en-IN", ("dress_code", "formal", 0.94), ("style", "smart-casual", 0.9)),
    _query("reel ready", "mood-effect", "en-IN", ("trend_signal", "viral", 0.96), ("style", "contemporary", 0.82)),
    _query("instagram worthy", "mood-effect", "en-IN", ("trend_signal", "trending", 0.94), ("mood", "bold", 0.84)),
    _query("clean look", "mood-effect", "en-IN", ("aesthetic", "clean-girl", 0.94), ("style", "minimalist", 0.88)),

    # City, climate and regional shopping context (76-90)
    _query("udaipur vibe", "regional", "hinglish", ("style", "ethnic", 0.9), ("aesthetic", "desi-fusion", 0.84)),
    _query("jaipur ethnic", "regional", "hinglish", ("style", "ethnic", 0.92), ("material", "cotton", 0.82)),
    _query("lucknow chikankari", "regional", "hinglish", ("surface_detail", "chikankari", 0.98), ("style", "ethnic", 0.88)),
    _query("mumbai ki garmi", "regional", "hi-Latn", ("season", "summer", 0.96), ("material", "cotton", 0.9), ("material", "linen", 0.86)),
    _query("chennai heat ke liye", "regional", "hinglish", ("season", "summer", 0.98), ("material", "cotton", 0.92), ("fit", "relaxed", 0.8)),
    _query("bangalore office look", "regional", "hinglish", ("occasion", "office", 0.94), ("dress_code", "smart-casual", 0.92)),
    _query("goa trip outfit", "regional", "hinglish", ("occasion", "travel", 0.96), ("theme", "vacation", 0.92), ("fit", "relaxed", 0.82)),
    _query("manali winter", "regional", "hinglish", ("season", "winter", 0.98), ("material", "wool", 0.9)),
    _query("shimla cold", "regional", "hinglish", ("season", "winter", 0.98), ("material", "wool", 0.9)),
    _query("मुंबई की बारिश", "regional", "hi-Deva", ("season", "monsoon", 0.98), ("style", "sporty", 0.72)),
    _query("kolkata puja look", "regional", "hinglish", ("occasion", "puja", 0.96), ("festival", "durga-puja", 0.94)),
    _query("ahmedabad navratri", "regional", "hinglish", ("festival", "navratri", 0.98), ("theme", "festive", 0.92)),
    _query("varanasi puja", "regional", "hinglish", ("occasion", "puja", 0.96), ("style", "ethnic", 0.88)),
    _query("kochi monsoon", "regional", "hinglish", ("season", "monsoon", 0.98), ("material", "cotton", 0.86)),
    _query("rishikesh travel", "regional", "hinglish", ("occasion", "travel", 0.96), ("fit", "relaxed", 0.84)),

    # Generation, trend and fabric intent (91-100)
    _query("gen z college look", "trend-fabric", "en-IN", ("generation", "gen-z", 0.98), ("occasion", "college", 0.94), ("style", "gen-z", 0.9)),
    _query("gen alpha trendy", "trend-fabric", "en-IN", ("generation", "gen-alpha", 0.98), ("trend_signal", "trending", 0.9)),
    _query("millennial classic", "trend-fabric", "en-IN", ("generation", "millennial", 0.98), ("style", "classic", 0.92)),
    _query("timeless style", "trend-fabric", "en-IN", ("generation", "timeless", 0.96), ("trend_signal", "evergreen", 0.92)),
    _query("y2k vibe", "trend-fabric", "en-IN", ("aesthetic", "y2k", 0.98), ("generation", "gen-z", 0.84)),
    _query("old money look", "trend-fabric", "en-IN", ("aesthetic", "old-money", 0.98), ("style", "classic", 0.88)),
    _query("clean girl aesthetic", "trend-fabric", "en-IN", ("aesthetic", "clean-girl", 0.99), ("style", "minimalist", 0.88)),
    _query("boho chic", "trend-fabric", "en-IN", ("aesthetic", "boho-chic", 0.99), ("style", "bohemian", 0.94)),
    _query("pure cotton ka", "trend-fabric", "hinglish", ("material", "pure-cotton", 0.99), ("season", "summer", 0.82)),
    _query("कॉटन का", "trend-fabric", "hi-Deva", ("material", "cotton", 0.99), ("season", "summer", 0.82)),
)


INDIAN_LANGUAGE_CONTEXTS: Dict[str, Sequence[Target]] = {
    item["query"]: item["targets"] for item in INDIAN_SEARCH_DEMAND
}

