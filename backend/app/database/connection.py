from __future__ import annotations

from typing import Optional

import certifi
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import settings


class MongoRuntime:
    def __init__(self) -> None:
        self.client: Optional[AsyncIOMotorClient] = None
        self.database: Optional[AsyncIOMotorDatabase] = None

    async def connect(self) -> AsyncIOMotorDatabase:
        if self.database is not None:
            return self.database
        self.client = AsyncIOMotorClient(
            settings.MONGODB_URI,
            tlsCAFile=certifi.where(),
            serverSelectionTimeoutMS=15_000,
            uuidRepresentation="standard",
            tz_aware=True,
        )
        await self.client.admin.command("ping")
        self.database = self.client[settings.DATABASE_NAME]
        return self.database

    async def close(self) -> None:
        if self.client is not None:
            self.client.close()
        self.client = None
        self.database = None


mongo_runtime = MongoRuntime()


async def get_database() -> AsyncIOMotorDatabase:
    if mongo_runtime.database is None:
        raise RuntimeError("MongoDB has not been initialized")
    return mongo_runtime.database
