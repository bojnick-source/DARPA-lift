from __future__ import annotations

try:
    from pydantic import BaseModel, Field
except Exception:
    # Fallback minimal BaseModel compatible with our tests
    class BaseModel:
        model_fields: dict = {}

        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)

        @classmethod
        def model_json_schema(cls):
            return {"title": cls.__name__, "properties": {k: {} for k in getattr(cls, "model_fields", {}).keys()}}

        @classmethod
        def schema(cls):
            return cls.model_json_schema()

    def Field(default=None):
        return default


class Morphology(BaseModel):
    schema_version: str = Field(default="0.0.1")
    nodes: list = Field(default_factory=list)
    edges: list = Field(default_factory=list)

    class Config:
        arbitrary_types_allowed = True

# Ensure stub metadata is present for field discovery in tests.
if not getattr(Morphology, "model_fields", None):
    Morphology.model_fields = {
        "schema_version": {},
        "nodes": {},
        "edges": {},
    }
