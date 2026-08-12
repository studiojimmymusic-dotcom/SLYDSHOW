# SLYDSHOW

TikTok photo-carousel remake desk for FELAR. Paste a viral slideshow URL, pick studio photos, copy slide text, then share as a Zernio draft or TikTok Creator Inbox post.

## Setup

```bash
npm install
cp .env.example .env
```

Fill `.env`:

```
RAPIDAPI_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
ZERNIO_API_KEY=
ZERNIO_TIKTOK_ACCOUNT_ID=
```

## Run Desk

```bash
npm run dev
```

Open [http://localhost:3007](http://localhost:3007).

## CLI

```bash
npm run remake -- --source "https://www.tiktok.com/@user/photo/123"
npm run pipeline
```

## Share destinations

- **Zernio draft** — stays in Zernio until you publish
- **TikTok inbox** — Creator Inbox so you can add text + music in TikTok
- **Save for TikTok** — export images locally for manual upload
