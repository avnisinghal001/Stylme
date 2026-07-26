import pytest
from fastapi import HTTPException

from app.core import security
from app.core.config import settings
from app.api.v1.endpoints.checkout_recovery import _require_cron_secret
from app.api.v1.endpoints.taxonomy_reconciler import require_reconciler_cron


def test_password_hash_and_verify():
    password_hash = security.hash_password("correct horse battery staple")
    assert password_hash != "correct horse battery staple"
    assert security.verify_password("correct horse battery staple", password_hash)
    assert not security.verify_password("incorrect", password_hash)


def test_access_token_round_trip(monkeypatch):
    monkeypatch.setattr(settings, "JWT_SECRET", "t" * 48)
    token = security.create_access_token("507f1f77bcf86cd799439011")
    payload = security.decode_access_token(token)
    assert payload["sub"] == "507f1f77bcf86cd799439011"
    assert payload["type"] == "access"


def test_external_cron_uses_server_environment_secret(monkeypatch):
    monkeypatch.setattr(settings, "CRON_SECRET", "c" * 64)
    config = {"cron_secret_encrypted": None}
    _require_cron_secret(config, "c" * 64)
    with pytest.raises(HTTPException) as error:
        _require_cron_secret(config, "wrong-secret")
    assert error.value.status_code == 401


def test_taxonomy_reconciler_cron_requires_constant_server_secret(monkeypatch):
    monkeypatch.setattr(settings, "CRON_SECRET", "r" * 64)
    require_reconciler_cron("r" * 64)
    require_reconciler_cron(None, f"Bearer {'r' * 64}")
    with pytest.raises(HTTPException) as error:
        require_reconciler_cron("wrong")
    assert error.value.status_code == 401
