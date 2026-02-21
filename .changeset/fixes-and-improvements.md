---
"@agent-wechat/cli": patch
"@agent-wechat/wechat": patch
---

- Use versioned Docker image tags matching CLI version, with fallback to latest
- Inject version from package.json at build time
- Fix release workflow Docker tag parsing for scoped packages
- Increase media poll retries from 5 to 15
- Add setup docs to both package READMEs
