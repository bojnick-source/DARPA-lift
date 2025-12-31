from __future__ import annotations

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


def Field(*, default=None, default_factory=None):
    if default_factory is not None:
        return default_factory()
    return default
