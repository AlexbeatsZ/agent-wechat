# Message sending automation research

## Findings

- wxauto-style automation keeps a stable chat-window/controller object after switching into a conversation. That reduces stale UI references compared with repeatedly rediscovering controls from the whole desktop.
- wxauto4 and wxauto-mcp expose explicit send and switch-chat operations, and their reliability depends on foreground-window visibility and verifying the selected conversation before sending.
- WeChatFerry represents the ideal API shape (`sendTxt`, `sendImg`, `sendFile` with an explicit receiver), but that implementation is Windows-specific and not directly portable to the Linux WeChat process used by this container.
- This project already has a lower-level Frida path for session enumeration and selection (`chat-select.py`). It can verify the current session by reading WeChat memory for BuildID `eba86b80`, but no verified text-send ABI is available in this repository yet.

## Implementation policy

1. Try the experimental low-level sender only for plain text and only after the target chat has been selected and verified.
2. Treat exit code `77` from the low-level sender as unsupported and fall back to UI automation.
3. Keep image and file sends on the existing paste-based UI path.
4. For the UI path, activate the target WeChat frame before every keyboard, clipboard, paste, and click operation, then re-check the selected chat before sending.
