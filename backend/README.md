# StylMe API

FastAPI/Motor API over the canonical StylMe MongoDB collections. The runtime
does not deserialize seeded products through the legacy flat Myntra model.

## Required environment

The backend reads the repository-root `.env` locally and Vercel project
environment variables in deployment:

```text
MONGODB_URL
MONGODB_DB_NAME=StylMe
JWT_SECRET=<at least 32 random characters>
CORS_ORIGINS=http://localhost:3000,https://your-frontend.vercel.app
OWNER_EMAIL=<bootstrap owner email>
OWNER_PASSWORD_HASH=<bcrypt hash, never plaintext>
```

Generate the owner hash without placing the password in shell history:

```bash
python -c 'import bcrypt,getpass; print(bcrypt.hashpw(getpass.getpass().encode(),bcrypt.gensalt(12)).decode())'
```

`OWNER_EMAIL` and `OWNER_PASSWORD_HASH` are idempotently applied on startup.
Authorization uses `Authorization: Bearer <accessToken>`; roles are reloaded
from MongoDB for every protected request.

## Local run and tests

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
pytest -q
```

Vercel uses `api/index.py` and `vercel.json` when the backend directory is the
deployment root.

## Primary contracts

- `POST /api/v1/auth/login` → `{accessToken, tokenType, user}`
- `GET /api/v1/auth/me` → user with `sellerId` and `sellerStatus`
- `POST /api/v1/seller/application` accepts account, `brandName`, and
  `primaryLocation`; returns `{user, seller, primaryLocation, brand}`
- `GET /api/v1/seller/me`
- `GET /api/v1/admin/sellers?status=pending`
- `PATCH /api/v1/admin/sellers/{id}/decision`
- `GET /api/v1/metadata/fields`
- `GET /api/v1/product-drafts/options`
- `POST/PATCH /api/v1/product-drafts[/{id}]`
- `POST /api/v1/product-drafts/{id}/submit`
- `PATCH /api/v1/admin/product-drafts/{id}/decision`
- `POST /api/v1/ai-processing/reserve`
- `POST /api/v1/ai-processing/{runId}/complete|fail`
- `GET /api/v1/products`, `/products/{slugOrId}` and
  `/products/{slugOrId}/related`
- `GET /api/v1/products?swoopstyl=true&pincode=201011` for the strict one-day
  zone ranked 60% distance, 20% relevance, 10% capacity, 5% stock and 5%
  readiness
- `GET /api/v1/home`, `/filters`, `/dashboard/stats`, `/admin/audit-logs`

AI processing is proposal-only. The unique
`(draft_id,input_hash,contract_version)` index permits one provider call per
input, and Python revalidates every completed proposal against the current
metadata registry before storing it. Provider keys are never accepted or
stored by this API.
