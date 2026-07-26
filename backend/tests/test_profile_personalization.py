from app.services.profile_personalization import (
    compatible_gender_keys,
    measurement_band,
    profile_personalization,
)
from app.services.search_intent_service import (
    _profile_fallback,
    _resolved_gender,
    _use_profile_measurements,
)


def test_gender_departments_follow_catalogue_age_overlap():
    assert compatible_gender_keys(["women"], 10) == ["girls", "kids", "unisex"]
    assert compatible_gender_keys(["women"], 13) == ["women", "girls", "kids", "unisex"]
    assert compatible_gender_keys(["girls"], 20) == ["women", "unisex"]
    assert compatible_gender_keys(["men"], 10) == ["boys", "kids", "unisex"]


def test_search_gender_precedence_keeps_current_intent_in_control():
    assert _resolved_gender(["men"], ["women"], ["girls"], 10) == ["men"]
    assert _resolved_gender([], ["men"], ["girls"], 10) == ["men"]
    assert _resolved_gender([], [], ["women"], 10) == ["girls", "kids", "unisex"]


def test_profile_numeric_signals_are_only_fallbacks():
    assert _profile_fallback(21, 18, 12) == 21
    assert _profile_fallback(None, 18, 12) == 18
    assert _profile_fallback(None, None, 12) == 12


def test_height_and_weight_use_stable_half_open_style_bands():
    assert measurement_band(149, 15) == {"min": 135, "max": 150}
    assert measurement_band(150, 15) == {"min": 150, "max": 165}
    assert measurement_band(164.9, 15) == {"min": 150, "max": 165}
    assert measurement_band(165, 15) == {"min": 165, "max": 180}
    assert measurement_band(49.9, 10) == {"min": 40, "max": 50}
    assert measurement_band(50, 10) == {"min": 50, "max": 60}


def test_search_drops_own_fit_when_query_switches_department():
    assert _use_profile_measurements([], ["women"], 22) is True
    assert _use_profile_measurements(["women"], ["women"], 22) is True
    assert _use_profile_measurements(["unisex"], ["women"], 22) is True
    assert _use_profile_measurements(["men"], ["women"], 22) is False
    assert _use_profile_measurements(["women"], ["girls"], 10) is False


def test_deep_explicit_preferences_feed_soft_metadata_ranking():
    result = profile_personalization(
        {
            "preferences": {
                "styleKeys": ["streetwear"],
                "generationKeys": ["gen-z"],
                "aestheticKeys": ["y2k"],
                "occasionKeys": ["college"],
                "festivalKeys": ["diwali"],
                "personalizationSegmentKeys": ["creator-core"],
            },
            "body_profile": {"consent": False},
        }
    )
    assert result["softMetadata"] == {
        "style": ["streetwear"],
        "generation": ["gen-z"],
        "aesthetic": ["y2k"],
        "occasion": ["college"],
        "festival": ["diwali"],
        "personalization_segment": ["creator-core"],
    }
