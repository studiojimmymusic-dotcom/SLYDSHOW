# SLYDSHOW

TikTok photo-carousel remake desk for FELAR. Paste a viral slideshow URL, pick studio photos, copy slide text, then save the photos and post them yourself.

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
```

## Run Desk

```bash
npm run dev
```

Open [http://localhost:3007](http://localhost:3007).

Pick photos, click **Save photos**, copy the caption, then send both to WhatsApp and post from your phone.

## CLI

```bash
npm run remake -- --source "https://www.tiktok.com/@user/photo/123"
npm run pipeline
```
