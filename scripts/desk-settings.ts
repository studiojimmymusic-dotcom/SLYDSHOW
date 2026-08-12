import * as fs from 'fs';
import * as path from 'path';
import { ensureDir, readJson, resolvePath, writeJson } from './utils';

export type TikTokAccount = {
  id: string;
  label: string;
};

/** zernio = stay in Zernio dashboard; inbox = TikTok Creator Inbox; live = publish to profile */
export type TikTokPostMode = 'zernio' | 'inbox' | 'live';

export type DeskSettings = {
  accounts: TikTokAccount[];
  activeAccountId: string;
  tiktokPostMode: TikTokPostMode;
};

const MAX_ACCOUNTS = 2;
const SETTINGS_FILE = () => resolvePath('data', 'desk-settings.json');

function envFallbackAccount(): TikTokAccount | null {
  const id = process.env.ZERNIO_TIKTOK_ACCOUNT_ID?.trim() || '';
  if (!id) return null;
  return { id, label: 'Account 1' };
}

function normalizeMode(value: unknown): TikTokPostMode {
  if (value === 'live' || value === 'zernio' || value === 'inbox') return value;
  return 'inbox';
}

function normalize(settings: Partial<DeskSettings>): DeskSettings {
  const accounts = (settings.accounts || [])
    .map((a) => ({
      id: String(a.id || '').trim(),
      label: String(a.label || '').trim() || 'TikTok',
    }))
    .filter((a) => a.id)
    .slice(0, MAX_ACCOUNTS);

  let activeAccountId = String(settings.activeAccountId || '').trim();
  if (!accounts.some((a) => a.id === activeAccountId)) {
    activeAccountId = accounts[0]?.id || '';
  }

  return {
    accounts,
    activeAccountId,
    tiktokPostMode: normalizeMode(settings.tiktokPostMode),
  };
}

export function loadDeskSettings(): DeskSettings {
  const file = SETTINGS_FILE();
  const stored = readJson<Partial<DeskSettings> | null>(file, null);
  if (stored?.accounts?.length) {
    return normalize(stored);
  }

  const fallback = envFallbackAccount();
  if (fallback) {
    const seeded = normalize({
      accounts: [fallback],
      activeAccountId: fallback.id,
      tiktokPostMode: 'inbox',
    });
    saveDeskSettings(seeded);
    return seeded;
  }

  return normalize({ accounts: [], activeAccountId: '', tiktokPostMode: 'inbox' });
}

export function saveDeskSettings(input: Partial<DeskSettings>): DeskSettings {
  const next = normalize(input);
  if (next.accounts.length > MAX_ACCOUNTS) {
    throw new Error(`You can connect up to ${MAX_ACCOUNTS} TikTok accounts`);
  }
  ensureDir(path.dirname(SETTINGS_FILE()));
  writeJson(SETTINGS_FILE(), next);
  return next;
}

export function resolveTikTokPostMode(override?: TikTokPostMode): TikTokPostMode {
  if (override === 'live' || override === 'inbox' || override === 'zernio') return override;
  return loadDeskSettings().tiktokPostMode;
}

export function resolvePostAccountId(override?: string): string {
  const settings = loadDeskSettings();
  const requested = String(override || '').trim();
  if (requested) {
    if (!settings.accounts.some((a) => a.id === requested)) {
      throw new Error('That TikTok account is not connected in Settings');
    }
    return requested;
  }
  if (settings.activeAccountId) return settings.activeAccountId;
  const envId = process.env.ZERNIO_TIKTOK_ACCOUNT_ID?.trim();
  if (envId) return envId;
  throw new Error('No TikTok account configured. Add one in Settings.');
}

export function deskSettingsPathExists(): boolean {
  return fs.existsSync(SETTINGS_FILE());
}
