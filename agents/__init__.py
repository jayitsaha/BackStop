"""Agents under test. Scripted ones run offline and deterministically; LLM ones need a key."""
from .base import Agent
from .scripted import Dash, Quill, SageReference
from .sage_adapter import Sage

REGISTRY = {"Sage": Sage, "Quill": Quill, "Dash": Dash, "SageReference": SageReference}

__all__ = ["Agent", "Dash", "Quill", "SageReference", "Sage", "REGISTRY"]
