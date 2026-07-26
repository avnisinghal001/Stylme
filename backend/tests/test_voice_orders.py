from app.api.v1.endpoints.voice_runtime import (
    phone_suffix_matches,
    require_internal_key,
    voice_order_public,
)
from app.core.config import settings


def test_phone_suffix_match_requires_exact_four_digits() -> None:
    assert phone_suffix_matches("+91 81266 79138", "9138")
    assert not phone_suffix_matches("+91 81266 79138", "79138")
    assert not phone_suffix_matches("+91 81266 79138", "1234")
    assert not phone_suffix_matches("", "9138")


def test_voice_order_contract_exposes_status_but_not_payment_or_address_secrets() -> None:
    result = voice_order_public(
        {
            "order_number": "ST-1042",
            "status": "shipped",
            "payment_status": "paid",
            "item_count": 2,
            "shipping_address": {
                "name": "Avni Singhal",
                "phone": "+918126679138",
                "addressLine": "private address",
            },
            "metadata": {
                "shipmentStatus": "in_transit",
                "estimatedDeliveryAt": "2026-07-24",
                "trackingUrl": "https://carrier.example/private-token",
                "refundStatus": "not_requested",
            },
            "payment": {"cardNumber": "4111111111111111", "cvv": "123"},
        }
    )

    assert result == {
        "orderNumber": "ST-1042",
        "status": "shipped",
        "paymentStatus": "paid",
        "itemCount": 2,
        "shipmentStatus": "in_transit",
        "estimatedDeliveryAt": "2026-07-24",
        "refundStatus": "not_requested",
    }
    serialized = repr(result).lower()
    assert "private address" not in serialized
    assert "4111111111111111" not in serialized
    assert "cvv" not in serialized
    assert "trackingurl" not in serialized


def test_voice_runtime_accepts_existing_cron_secret_fallback(monkeypatch) -> None:
    monkeypatch.setattr(settings, "AI_INTERNAL_API_KEY", "")
    monkeypatch.setattr(settings, "CRON_SECRET", "c" * 40)

    assert require_internal_key("c" * 40) is None
