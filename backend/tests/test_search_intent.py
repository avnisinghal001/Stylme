from app.services.product_service import _lexical_search


def test_lexical_search_extracts_price_and_removes_filler_words():
    terms, maximum = _lexical_search("maroon festive outfit under ₹2,500")

    assert terms == ["maroon", "festive"]
    assert maximum == 250_000


def test_lexical_search_deduplicates_terms():
    terms, maximum = _lexical_search("classic classic office look")

    assert terms == ["classic", "office"]
    assert maximum is None
