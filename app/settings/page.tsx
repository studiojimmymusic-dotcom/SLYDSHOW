'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { DeskShell } from '../components/desk-shell';
import { Button, fieldClassName } from '../components/ui';
import {
  loadLocalDeskSettings,
  normalizeDeskSettings,
  saveLocalDeskSettings,
  type DeskSettings,
  type TikTokAccount,
  type TikTokPostMode,
} from '../lib/desk-settings-client';

const EMPTY_SLOT: TikTokAccount = { id: '', label: '' };

function slotsFromAccounts(list: TikTokAccount[]): TikTokAccount[] {
  const next = [{ ...EMPTY_SLOT }, { ...EMPTY_SLOT }];
  list.slice(0, 2).forEach((account, i) => {
    next[i] = { id: account.id, label: account.label };
  });
  return next;
}

function snapshot(
  accounts: TikTokAccount[],
  activeAccountId: string,
  tiktokPostMode: TikTokPostMode
): string {
  return JSON.stringify({
    accounts: accounts.map((a) => ({ id: a.id.trim(), label: a.label.trim() })),
    activeAccountId: activeAccountId.trim(),
    tiktokPostMode,
  });
}

function applySettings(data: DeskSettings) {
  const next = slotsFromAccounts(data.accounts || []);
  const active = data.activeAccountId || data.accounts[0]?.id || '';
  const mode = data.tiktokPostMode;
  return { next, active, mode };
}

export default function SettingsPage() {
  const [accounts, setAccounts] = useState<TikTokAccount[]>([{ ...EMPTY_SLOT }, { ...EMPTY_SLOT }]);
  const [activeAccountId, setActiveAccountId] = useState('');
  const [tiktokPostMode, setTikTokPostMode] = useState<TikTokPostMode>('inbox');
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const local = loadLocalDeskSettings();
    if (local?.accounts.length) {
      const { next, active, mode } = applySettings(local);
      setAccounts(next);
      setActiveAccountId(active);
      setTikTokPostMode(mode);
      setSavedSnapshot(snapshot(next, active, mode));
      setLoaded(true);
      return;
    }

    void (async () => {
      try {
        const res = await fetch('/api/settings');
        const data = (await res.json()) as DeskSettings & { error?: string };
        if (!res.ok) throw new Error(data.error || 'Failed to load settings');
        const normalized = normalizeDeskSettings(data);
        if (normalized.accounts.length) {
          saveLocalDeskSettings(normalized);
        }
        const { next, active, mode } = applySettings(normalized);
        setAccounts(next);
        setActiveAccountId(active);
        setTikTokPostMode(mode);
        setSavedSnapshot(snapshot(next, active, mode));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Failed to load settings');
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const dirty = useMemo(
    () => loaded && snapshot(accounts, activeAccountId, tiktokPostMode) !== savedSnapshot,
    [accounts, activeAccountId, tiktokPostMode, loaded, savedSnapshot]
  );

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    setStatus('Saving…');
    try {
      const cleaned = accounts
        .map((a, i) => ({
          id: a.id.trim(),
          label: a.label.trim() || `Account ${i + 1}`,
        }))
        .filter((a) => a.id);

      if (cleaned.length === 0) {
        throw new Error('Add at least one Zernio TikTok account ID');
      }

      const ids = cleaned.map((a) => a.id);
      if (new Set(ids).size !== ids.length) {
        throw new Error('Account IDs must be unique');
      }

      const trimmedActive = activeAccountId.trim();
      const nextActive = cleaned.some((a) => a.id === trimmedActive)
        ? trimmedActive
        : cleaned[0].id;

      const saved = saveLocalDeskSettings({
        accounts: cleaned,
        activeAccountId: nextActive,
        tiktokPostMode,
      });

      // Best-effort local filesystem sync (works in local npm run, ephemeral on Vercel)
      void fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saved),
      }).catch(() => undefined);

      const { next, active, mode } = applySettings(saved);
      setAccounts(next);
      setActiveAccountId(active);
      setTikTokPostMode(mode);
      setSavedSnapshot(snapshot(next, active, mode));
      setStatus('Saved in this browser');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  function updateAccount(index: number, patch: Partial<TikTokAccount>) {
    setAccounts((prev) => {
      const previous = prev[index];
      const nextAccounts = prev.map((account, i) => (i === index ? { ...account, ...patch } : account));

      if (patch.id !== undefined) {
        const oldId = previous?.id.trim() || '';
        const newId = String(patch.id).trim();
        setActiveAccountId((active) => {
          // Keep default pointed at the same slot when editing its ID
          if (active && oldId && active === oldId) return newId;
          // Only auto-pick a default when this becomes the first/only connected account
          if (!active) {
            const filled = nextAccounts.filter((a) => a.id.trim());
            if (filled.length === 1 && filled[0].id === newId) return newId;
          }
          return active;
        });
      }

      return nextAccounts;
    });
  }

  function clearAccount(index: number) {
    setAccounts((prev) => {
      const clearedId = prev[index]?.id.trim() || '';
      const next = prev.map((account, i) => (i === index ? { ...EMPTY_SLOT } : account));
      const remaining = next.map((a) => a.id.trim()).filter(Boolean);
      setActiveAccountId((active) => {
        if (active && active === clearedId) return remaining[0] || '';
        if (active && remaining.includes(active)) return active;
        return remaining[0] || '';
      });
      return next;
    });
  }

  function setDefaultAccount(id: string) {
    const trimmed = id.trim();
    if (trimmed) setActiveAccountId(trimmed);
  }

  const connected = accounts.filter((a) => a.id.trim()).length;

  return (
    <DeskShell
      footer={<span className="font-mono">{connected}/2 accounts</span>}
      headerLeft={status || (loaded ? 'TikTok accounts & publish mode' : 'Loading…')}
      headerRight={
        <Button type="button" onClick={() => void save()} disabled={busy || !loaded || !dirty}>
          {busy ? 'Saving' : 'Save'}
        </Button>
      }
    >
      <div className="mx-auto max-w-[720px] space-y-5">
        <div>
          <h1 className="font-display text-[28px] font-medium tracking-tight text-text-primary">Settings</h1>
          <p className="mt-1 text-[14px] text-text-secondary">
            Connect up to two Zernio TikTok accounts. Settings are saved in this browser.
          </p>
        </div>

        <section className="rounded-xl border border-border bg-background p-5 shadow-[0_1px_2px_rgba(20,19,17,0.03)]">
          <h2 className="text-[15px] font-semibold text-text-primary">Default Share destination</h2>
          <p className="mt-1 text-[13px] text-text-secondary">
            Studio also lets you pick this right before Share. Inbox = add text/music in TikTok first.
          </p>
          <div className="mt-4 space-y-2">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-card border border-border px-3 py-3">
              <input
                type="radio"
                name="tiktok-mode"
                className="mt-0.5 size-4 accent-[var(--felar-accent)]"
                checked={tiktokPostMode === 'zernio'}
                onChange={() => setTikTokPostMode('zernio')}
              />
              <span>
                <span className="block text-[13px] font-medium text-text-primary">Zernio draft</span>
                <span className="block text-[12px] text-text-secondary">
                  Stays in Zernio until you publish from the dashboard.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-card border border-border px-3 py-3">
              <input
                type="radio"
                name="tiktok-mode"
                className="mt-0.5 size-4 accent-[var(--felar-accent)]"
                checked={tiktokPostMode === 'inbox'}
                onChange={() => setTikTokPostMode('inbox')}
              />
              <span>
                <span className="block text-[13px] font-medium text-text-primary">TikTok Creator Inbox</span>
                <span className="block text-[12px] text-text-secondary">
                  Sends photos to TikTok so you can add text + music, then publish.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-card border border-border px-3 py-3">
              <input
                type="radio"
                name="tiktok-mode"
                className="mt-0.5 size-4 accent-[var(--felar-accent)]"
                checked={tiktokPostMode === 'live'}
                onChange={() => setTikTokPostMode('live')}
              />
              <span>
                <span className="block text-[13px] font-medium text-text-primary">Publish live</span>
                <span className="block text-[12px] text-text-secondary">
                  Goes public immediately — caption only, no in-app text/music editing.
                </span>
              </span>
            </label>
          </div>
        </section>

        <form onSubmit={save} className="space-y-4">
          {accounts.map((account, index) => {
            const filled = Boolean(account.id.trim());
            return (
              <section
                key={index}
                className="rounded-xl border border-border bg-background p-5 shadow-[0_1px_2px_rgba(20,19,17,0.03)]"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-semibold text-text-primary">Account {index + 1}</h2>
                    <p className="mt-0.5 text-[13px] text-text-secondary">
                      {filled ? 'Connected' : 'Empty slot'}
                    </p>
                  </div>
                  {filled ? (
                    <Button type="button" variant="ghost" size="xs" onClick={() => clearAccount(index)}>
                      Clear
                    </Button>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-text-secondary">Label</span>
                    <input
                      value={account.label}
                      onChange={(e) => updateAccount(index, { label: e.target.value })}
                      placeholder={`e.g. Main account`}
                      className={fieldClassName}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-text-secondary">
                      Zernio TikTok account ID
                    </span>
                    <input
                      value={account.id}
                      onChange={(e) => updateAccount(index, { id: e.target.value })}
                      placeholder="Paste account ID"
                      className={`${fieldClassName} font-mono`}
                    />
                  </label>
                  {filled ? (
                    <div className="flex items-center gap-2.5 pt-1">
                      {activeAccountId === account.id.trim() ? (
                        <span className="text-[13px] font-medium text-text-primary">Default for Share</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDefaultAccount(account.id)}
                          className="text-[13px] font-semibold text-[#B87A12] hover:underline"
                        >
                          Make default for Share
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </form>
      </div>
    </DeskShell>
  );
}
