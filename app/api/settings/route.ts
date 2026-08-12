import { NextResponse } from 'next/server';
import { loadDeskSettings, saveDeskSettings, type DeskSettings } from '../../../scripts/desk-settings';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json(loadDeskSettings());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load settings' },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as Partial<DeskSettings>;
    const next = saveDeskSettings({
      accounts: Array.isArray(body.accounts) ? body.accounts : [],
      activeAccountId: String(body.activeAccountId || ''),
      tiktokPostMode:
        body.tiktokPostMode === 'live'
          ? 'live'
          : body.tiktokPostMode === 'zernio'
            ? 'zernio'
            : 'inbox',
    });
    return NextResponse.json(next);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save settings' },
      { status: 500 }
    );
  }
}
