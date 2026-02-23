---
"@agent-wechat/cli": minor
"@agent-wechat/wechat": minor
---

Add WeChat crash recovery and auth status enum

- Auto-restart WeChat in entrypoint with crash-loop backoff (3s delay, 30s backoff after 5 rapid restarts)
- Replace `isLoggedIn: boolean` with `status: "logged_in" | "logged_out" | "app_not_running" | "unknown"` in auth endpoint
- Detect WeChat process not running via `find_wechat_pid()` check before a11y observation
- Notify agent on auth state transitions (session lost, server unreachable, first-poll not authenticated)
- Add `app_not_running` diagnostic in openclaw extension status checks
