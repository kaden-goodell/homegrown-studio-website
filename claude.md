# Claude Code Session Notes

## Git Configuration

This project is being developed by kaden on Catherine's computer.

Git should be configured with kaden's credentials:

```bash
git config user.name "kaden"
git config user.email "kaden.goodell@gmail.com"
```

Or to set globally:

```bash
git config --global user.name "kaden"
git config --global user.email "kaden.goodell@gmail.com"
```

Git configuration has been set for this repository.

## Netlify Deployment

**IMPORTANT: Develop locally first! Netlify Free Plan has limited credits.**

### Credit Limits (Free Plan: 300 credits/month)
- Production deploys: **15 credits each** (~20 deploys/month max)
- SSR compute: 5 credits per GB-hour
- Web requests: 3 credits per 10,000 requests
- Deploy previews (branch deploys): **FREE**

### Local Development
Always test locally before pushing to production:
```bash
npm run dev
```
Site runs at http://localhost:4321

### Netlify Site Info
- Site name: `iridescent-croissant-494fc3`
- Custom domain: `homegrowncraftstudio.com`
- Netlify URL: `https://iridescent-croissant-494fc3.netlify.app`

### Environment Variables (set in Netlify dashboard)
- `SQUARE_ACCESS_TOKEN` - Square API token
- `SQUARE_ENVIRONMENT` - "production" or "sandbox"

For local dev, create a `.env` file (already gitignored):
```
SQUARE_ACCESS_TOKEN=your_sandbox_token
SQUARE_ENVIRONMENT=sandbox
```
