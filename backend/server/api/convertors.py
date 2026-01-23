"""
Custom path convertors for FastAPI routes.

This module registers custom path convertors that must be available
before route modules are imported.
"""

from starlette.convertors import Convertor, register_url_convertor


class NonReservedPathConvertor(Convertor):
    """Matches any path segment except reserved words (confirm, check, etc.)"""
    regex = r"(?!confirm$|check$)[^/]+"

    def convert(self, value: str) -> str:
        return value

    def to_string(self, value: str) -> str:
        return value


# Register on import
register_url_convertor("non_reserved", NonReservedPathConvertor())
