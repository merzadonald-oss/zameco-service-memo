---
name: Ambiguous Google sync responses
description: Reliability principle for retries after an uncertain Google API result
---

Treat an interrupted or failed Google API response as an ambiguous outcome, not proof that the remote write failed. Before retrying a service memo upload or Sheet append, check the destination by its stable service memo code and reuse or update the existing resource.

**Why:** A Drive or Sheets write can succeed even when the response is lost before the local sync status is recorded; blindly repeating the write creates duplicate files or rows.

**How to apply:** This matters when changing sync, retry, or error-handling behavior. Preserve the stable-code lookup and test the "write accepted, response lost" case. A lookup before append is not an atomic uniqueness guarantee for simultaneous writers, so serialize concurrent sync attempts if that case becomes relevant.