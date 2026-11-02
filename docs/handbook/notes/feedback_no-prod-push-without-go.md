---
name: feedback_no-prod-push-without-go
description: Never push to main/production unless Kaden explicitly says so in that moment; push to dev only
metadata:
  type: feedback
---
Kaden (2026-10-09): "Stop pushing to prod until I tell you."

**Why:** I had been pushing every change to `main` along with `dev` (each prod deploy costs 15 Netlify credits and changes what customers see) without him asking each time.
**How to apply:** push to `dev` only. Push `dev:main` ONLY when Kaden says to push to prod for that specific change; a past "push to prod" does not carry over. When work is ready, say it's on the dev preview and that prod is waiting for his go.
