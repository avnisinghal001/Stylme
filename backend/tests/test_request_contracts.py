import pytest
from pydantic import ValidationError

from app.schemas.ai_processing import AICompleteRequest
from app.schemas.auth import RegisterRequest
from app.schemas.user import AppearanceReserveRequest, UserProfileUpdate
from app.schemas.seller import SellerApplicationCreate
from app.schemas.cart import CartItemAdd
from app.schemas.search import AdvancedSearchRequest
from app.schemas.checkout_recovery import CheckoutRecoveryConfigUpdate


def test_seller_application_requires_brand_and_primary_location():
    application = SellerApplicationCreate.model_validate(
        {
            "email": "seller@example.com",
            "password": "a secure password",
            "fullName": "Example Seller",
            "displayName": "Example Store",
            "brandName": "Example Brand",
            "primaryLocation": {
                "addressLine": "12 Market Road, Bengaluru",
                "pincode": "560001",
            },
        }
    )
    assert application.brand_name == "Example Brand"
    assert application.primary_location.pincode == "560001"


def test_ai_completion_rejects_uncontracted_fields():
    with pytest.raises(ValidationError):
        AICompleteRequest.model_validate(
            {
                "provider": "google",
                "model": "gemini",
                "confidence": 0.9,
                "proposal": {"metadata": {}, "price": 1},
            }
        )


def test_customer_registration_and_profile_range_contracts():
    registration = RegisterRequest.model_validate(
        {
            "email": "shopper@example.com",
            "phone": "+919876543210",
            "password": "strong-pass-123",
            "fullName": "Styl Shopper",
        }
    )
    profile = UserProfileUpdate.model_validate(
        {
            "dateOfBirth": "2004-07-18",
            "heightCm": 168,
            "weightKg": 62,
            "bodyProfileConsent": True,
            "generationKeys": ["gen-z"],
            "genderKeys": ["women"],
            "aestheticKeys": ["y2k"],
            "personalizationSegmentKeys": ["creator-core"],
        }
    )
    assert str(registration.email) == "shopper@example.com"
    assert registration.phone == "+919876543210"
    assert profile.height_cm == 168
    assert profile.gender_keys == ["women"]
    assert profile.aesthetic_keys == ["y2k"]


def test_appearance_reservation_caps_transient_photo_hashes():
    with pytest.raises(ValidationError):
        AppearanceReserveRequest.model_validate(
            {
                "consent": True,
                "inputHash": "a" * 64,
                "metadataSchemaVersion": 3,
                "allowedFiltersHash": "b" * 64,
                "imageHashes": [str(index).zfill(64) for index in range(5)],
            }
        )


def test_cart_requires_exact_offer_and_variant_identity():
    item = CartItemAdd.model_validate(
        {"offerId": "507f1f77bcf86cd799439011", "variantId": "variant-medium-maroon", "quantity": 2}
    )
    assert item.offer_id == "507f1f77bcf86cd799439011"
    assert item.variant_id == "variant-medium-maroon"


def test_advanced_search_contract_rejects_inverted_ranges_and_requires_swoop_pincode():
    with pytest.raises(ValidationError):
        AdvancedSearchRequest.model_validate({"query": "kurta", "minPrice": 2500, "maxPrice": 1000})
    with pytest.raises(ValidationError):
        AdvancedSearchRequest.model_validate({"query": "kurta", "swoopstyl": True})

    request = AdvancedSearchRequest.model_validate(
        {
            "query": "pink festive kurta under 2500",
            "pincode": "560001",
            "swoopstyl": True,
            "metadata": {"occasion": ["festive"]},
        }
    )
    assert request.pincode == "560001"


def test_advanced_search_infers_trailing_pincode_when_swoopstyl_is_enabled():
    request = AdvancedSearchRequest.model_validate(
        {"query": "red kurta under Rs 5600 560041", "swoopstyl": True}
    )
    assert request.pincode == "560041"
    assert request.swoopstyl is True


def test_advanced_search_accepts_profile_fallback_signals():
    request = AdvancedSearchRequest.model_validate(
        {
            "query": "festive outfit",
            "profileGender": ["girls"],
            "profileAge": 12,
            "profileHeightCm": 148,
            "profileWeightKg": 42,
        }
    )
    assert request.profile_gender == ["girls"]
    assert request.profile_age == 12


def test_checkout_recovery_multilingual_primary_must_be_supported():
    base = {
        "samora": {"agentId": "00000000-0000-4000-8000-000000000001", "campaignId": "00000000-0000-4000-8000-000000000002"},
        "multilingual": {"enabled": True, "primaryLanguage": "hi-IN", "supportedLanguages": ["en-IN"]},
    }
    with pytest.raises(ValidationError):
        CheckoutRecoveryConfigUpdate.model_validate(base)

    valid = CheckoutRecoveryConfigUpdate.model_validate(
        {**base, "multilingual": {"enabled": True, "primaryLanguage": "hi-IN", "supportedLanguages": ["en-IN", "hi-IN"]}}
    )
    assert valid.multilingual.language_switch_tool == "switch_language_tool"
