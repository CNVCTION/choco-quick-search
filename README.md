# Choco Quick Search

A lightweight, self-hosted Chocolatey package finder. Search packages, open their Community Repository pages, and copy install commands.

## Run locally

Requires Node.js 20+.

```bash
npm start
```

Open http://localhost:3000.

## Deploy

This project includes a Vercel Node runtime adapter. Import the repository into Vercel and deploy from the existing default branch. For a VPS, run the Node server behind HTTPS.

To enable the included GitHub Actions deploy workflow, add repository secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`.

## Install as a PWA

On iPhone, open the HTTPS URL in Safari → Share → Add to Home Screen. On desktop, use Chrome or Edge's Install app option.

## Search integration

The app queries Chocolatey's NuGet v2 OData feed. Custom direct queries are not a guaranteed supported integration surface; Chocolatey's documented supported repository query methods are Chocolatey CLI and `chocolatey.lib`. If that endpoint changes, replace the search adapter in `api/search.js` / `lib/chocolatey.js`.

The app copies commands only; it does not install software on the browsing device. Run copied commands in an elevated PowerShell terminal on a Windows PC with Chocolatey installed.
