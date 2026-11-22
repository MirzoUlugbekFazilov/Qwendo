"""Authenticated, user-scoped onboarding storage. Drafts never power recommendations."""
import asyncio
from datetime import datetime, timezone
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from api.deps import CurrentUser, get_anon_db

router = APIRouter(tags=["discovery"])
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)]
Category = Literal["tech","film","music","business","gaming","sports","arts","food","education","fashion","comedy","wellness"]


class Consent(BaseModel):
    alerts: bool = False
    digest: bool = False
    tickets: bool = False


class Topic(BaseModel):
    name: Label
    type: Label
    source: Literal["explicit", "inferred"]
    confidence: float = Field(ge=0, le=1)
    related: list[Label] = Field(default_factory=list, max_length=12)
    priority: Literal["must", "very", "curious"] = "curious"
    source_text: LongText = ""
    confirmed: bool = False


ClockTime = Annotated[str, StringConstraints(pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")]


class RadarPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    frequency: Literal["immediate", "daily", "weekly"] = "immediate"
    quiet_start: ClockTime | None = None
    quiet_end: ClockTime | None = None
    timezone: str = Field(default="UTC", min_length=1, max_length=128)

    @model_validator(mode="after")
    def validate_delivery(self):
        if (self.quiet_start is None) != (self.quiet_end is None):
            raise ValueError("Supply both quiet hours or leave both empty")
        try:
            ZoneInfo(self.timezone)
        except (ValueError, ZoneInfoNotFoundError) as exc:
            raise ValueError("Choose an IANA timezone") from exc
        return self


class Preferences(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    categories: list[Category] = Field(default_factory=list,max_length=12)
    interests: list[Topic] = Field(default_factory=list,max_length=64)
    text: LongText = ""
    motivations: list[Label] = Field(default_factory=list,max_length=8)
    formats: list[Label] = Field(default_factory=list,max_length=10)
    city: str = Field(default="",max_length=120)
    radius: Literal[5,10,25,50,100] = 25
    online: bool = True
    flexible_travel: bool = True
    budget: Literal[0,20,50,100] | None = None
    budget_strict: bool = False
    availability: str = Field(default="Flexible",max_length=60)
    availability_strict: bool = False
    notice: str = Field(default="Any time",max_length=60)
    notice_strict: bool = False
    radar: LongText = ""
    radar_preferences: RadarPreferences = Field(default_factory=RadarPreferences)
    notifications: Consent = Field(default_factory=Consent)

    @model_validator(mode="after")
    def validate_topics(self):
        keys = [t.name.casefold() for t in self.interests]
        if len(keys) != len(set(keys)):
            raise ValueError("Each interest must be unique")
        must = [t for t in self.interests if t.priority == "must"]
        if len(must) > 3 or any(t.source == "inferred" and not t.confirmed for t in must):
            raise ValueError("Choose at most three confirmed Radar interests")
        return self


class Draft(BaseModel):
    step: int = Field(ge=0, le=7)
    profile: Preferences


def account_db(user):
    return get_anon_db().as_user(user["access_token"])


@router.get("/me/discovery")
async def read_discovery(user: CurrentUser):
    db = account_db(user)
    filters = {"user_id": f"eq.{user['id']}"}
    profile, draft, consent = await asyncio.gather(*(
        db.select(table, columns=columns, filters=filters, single=True)
        for table, columns in [
            ("user_discovery_profiles", "profile"),
            ("user_discovery_drafts", "step,profile"),
            ("user_notification_settings", "alerts,digest,tickets"),
        ]
    ))
    if not profile and not draft:
        # Existing members may already have picked interests in the original onboarding.
        legacy = await db.select("profiles", columns="city,interest_text,radius_km,include_online,onboarded",
                                 filters={"id": f"eq.{user['id']}"}, single=True)
        if legacy and legacy.get("onboarded"):
            selected = await db.select("user_interests", columns="interests(label,category)", filters=filters)
            taxonomy = [row["interests"] for row in selected or [] if row.get("interests")]
            known = {"tech","film","music","business","gaming","sports","arts","food","education","fashion","comedy","wellness"}
            old_radius = (legacy.get("radius_km") or 40) / 1.609344
            seed = Preferences(
                city=legacy.get("city") or "", text=legacy.get("interest_text") or "",
                radius=min((5,10,25,50,100), key=lambda miles: abs(miles-old_radius)),
                online=bool(legacy.get("include_online")),
                categories=list(dict.fromkeys(t["category"] for t in taxonomy if t["category"] in known)),
                interests=[Topic(name=t["label"],type="topic",source="explicit",confidence=1,
                                 source_text=t["label"],confirmed=True) for t in taxonomy],
            )
            draft = {"step": 1, "profile": seed.model_dump()}
    return {"profile": {**profile["profile"], "notifications": consent or Consent().model_dump()} if profile else None,
            "draft": draft}


@router.put("/me/discovery/draft")
async def save_draft(user: CurrentUser, payload: Draft):
    await account_db(user).insert("user_discovery_drafts", {
        **payload.model_dump(), "user_id": user["id"], "updated_at": datetime.now(timezone.utc).isoformat()
    }, upsert=True,on_conflict="user_id",returning="minimal")
    return {"ok": True}


@router.put("/me/discovery")
async def confirm_profile(user: CurrentUser, payload: Preferences):
    if not payload.city or not (payload.categories or any(t.source == "explicit" for t in payload.interests)):
        raise HTTPException(422, "Choose a category or interest and enter your city.")
    await account_db(user).rpc("confirm_discovery_profile", {"p_profile":payload.model_dump()})
    return {"ok": True}
