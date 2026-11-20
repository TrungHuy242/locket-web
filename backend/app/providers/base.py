"""Provider contract: the normalized, frontend-facing shapes the Locket backend returns.

user     {uid, firstName, lastName, name, username, avatar, email?}
moment   {id, user: user, image, video, caption, overlay, createdAt(ms), mine, approxDate}
feed     {moments[], nextCursor, total, sources}
overlay  {text, icon, colors[], textColor, type} | None
message  {id, conversationId, mine, text, createdAt(ms), reaction, moment?}
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional, Union


class ProviderError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


class AuthExpired(ProviderError):
    def __init__(self, message: str = "Phiên đăng nhập đã hết hạn"):
        super().__init__(message, 401)


class Provider:
    mode = "base"

    # account
    def me(self, refresh: bool = False) -> dict: raise NotImplementedError
    def update_name(self, first_name: str, last_name: str) -> dict: raise NotImplementedError
    def update_avatar(self, image: bytes) -> dict: raise NotImplementedError
    def set_notifications(self, enabled: bool) -> dict: raise NotImplementedError

    # moments
    def feed(self, before: Optional[str] = None, limit: int = 30, refresh: bool = False) -> dict: raise NotImplementedError
    def post_moment(self, image: Optional[bytes], video: Optional[Union[bytes, Path]], caption: str,
                    preset: Optional[str], recipients: list, private: bool = False,
                    mirror_video: bool = False, video_start: float = 0.0,
                    video_length: float = 0.0) -> dict: raise NotImplementedError
    def delete_moment(self, moment_id: str) -> None: raise NotImplementedError
    def memories(self, before=None, limit=60, kind="all", author=None, q="", year=None, month=None,
                 tz_minutes=0) -> dict: raise NotImplementedError
    def react(self, moment_id: str, emoji: str) -> dict: raise NotImplementedError
    def mark_viewed(self, moment_id: str) -> None: raise NotImplementedError
    def activity(self, moment_id: str) -> dict: raise NotImplementedError
    def moment(self, moment_id: str) -> dict: raise NotImplementedError
    def notifications(self, refresh: bool = False) -> dict: raise NotImplementedError
    def mark_notifications(self, ids=None, everything: bool = False) -> dict: raise NotImplementedError
    def comments(self, moment_id: str) -> dict: raise NotImplementedError
    def add_comment(self, moment_id: str, text: str, to: Optional[str] = None) -> dict: raise NotImplementedError

    # friends
    def friends(self) -> dict: raise NotImplementedError
    def lookup(self, username: str) -> Optional[dict]: raise NotImplementedError
    def send_request(self, uid: str) -> None: raise NotImplementedError
    def accept_request(self, uid: str) -> None: raise NotImplementedError
    def remove_friend(self, uid: str) -> None: raise NotImplementedError
    def block(self, uid: str) -> None: raise NotImplementedError
    def unblock(self, uid: str) -> None: raise NotImplementedError
    def delete_request(self, uid: str, direction: str) -> None: raise NotImplementedError
    def friend_profile(self, uid: str) -> dict: raise NotImplementedError

    # chat
    def conversations(self) -> list: raise NotImplementedError
    def messages(self, peer_uid: str, limit: int = 50, before: Optional[int] = None) -> dict: raise NotImplementedError
    def send_message(self, peer_uid: str, text: str, moment_id: Optional[str]) -> dict: raise NotImplementedError
    def mark_read(self, peer_uid: str, conversation_id: Optional[str], receipt: bool) -> None: raise NotImplementedError
    def react_message(self, conversation_id: str, message_id: str, emoji: Optional[str]) -> None: raise NotImplementedError
    def delete_message(self, conversation_id: str, message_id: str) -> None: raise NotImplementedError

    def close(self) -> None: pass
    def logout(self) -> None: pass


def display_name(first: str, last: str, fallback: str = "") -> str:
    name = f"{first or ''} {last or ''}".strip()
    return name or fallback or "Locket"
