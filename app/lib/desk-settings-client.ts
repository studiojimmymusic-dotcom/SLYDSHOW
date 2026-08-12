'use client';

export type TikTokAccount = { id: string; label: string };
export type TikTokPostMode = 'zernio' | 'inbox' | 'live';

export type DeskSettings = {
  accounts: TikTokAccount[];
  activeAccountId: string;
  tiktokPostMode: TikTokPostMode;
};

const STORAGE_KEY = 'slydshow.desk-settings.v1';
const MAX_ACCOUNTS = 2;

function normalizeMode(value: unknown): TikTokPostMode {
  if (value === 'live' || value === 'zernio' || value === 'inbox') return value;
  return 'inbox';
}

export function normalizeDeskSettings(input: Partial<DeskSettings> | null | undefined): DeskSettings {
  const accounts = (input?.accounts || [])
    .map((a) => ({
      id: String(a?.id || '').trim(),
      label: String(a?.label || '').trim() || 'TikTok',
    }))
    .filter((a) => a.id)
    .slice(0, MAX_ACCOUNTS);

  let activeAccountId = String(input?.activeAccountId || '').trim();
  if (!accounts.some((a) => a.id === activeAccountId)) {
    activeAccountId = accounts[0]?.id || '';
  }

  return {
    accounts,
    activeAccountId,
    tiktokPostMode: normalizeMode(input?.tiktokPostMode),
  };
}

export function loadLocalDeskSettings(): DeskSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeDeskSettings(JSON.parse(raw) as Partial<DeskSettings>);
  } catch {
    return null;
  }
}

export function saveLocalDeskSettings(input: Partial<DeskSettings>): DeskSettings {
  const next = normalizeDeskSettings(input);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}
