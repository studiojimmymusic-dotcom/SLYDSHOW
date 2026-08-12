'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { DeskShell } from '../components/desk-shell';
import { Button, fieldClassName } from '../components/ui';

type TikTokAccount = { id: string; label: string };
type TikTokPostMode = 'live' | 'inbox' | 'zernio';
type DeskSettings = {
  accounts: TikTokAccount[];
  activeAccountId: string;
  tiktokPostMode?: TikTokPostMode;
};

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

export default function SettingsPage() {
  const [accounts, setAccounts] = useState<TikTokAccount[]>([{ ...EMPTY_SLOT }, { ...EMPTY_SLOT }]);
  const [activeAccountId, setActiveAccountId] = useState('');
  const [tiktokPostMode, setTikTokPostMode] = useState<TikTokPostMode>('inbox');
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/settings');
        const data = (await res.json()) as DeskSettings & { error?: string };
        if (!res.ok) throw new Error(data.error || 'Failed to load settings');
        const next = slotsFromAccounts(data.accounts || []);
        const active = data.activeAccountId || data.accounts[0]?.id || '';
        const mode: TikTokPostMode =
          data.tiktokPostMode === 'live'
            ? 'live'
            : data.tiktokPostMode === 'zernio'
              ? 'zernio'
              : 'inbox';
        setAccounts(next);
        setActiveAccountId(active);
        setTikTokPostMode(mode);
        setSavedSnapshot(snapshot(next, active, mode));
        setLoaded(true);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Failed to load settings');
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

      const nextActive = cleaned.some((a) => a.id === activeAccountId)
        ? activeAccountId
        : cleaned[0].id;

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accounts: cleaned,
          activeAccountId: nextActive,
          tiktokPostMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');

      const next = slotsFromAccounts(data.accounts as TikTokAccount[]);
      const mode: TikTokPostMode =
        data.tiktokPostMode === 'live'
          ? 'live'
          : data.tiktokPostMode === 'zernio'
            ? 'zernio'
            : 'inbox';
      setAccounts(next);
      setActiveAccountId(data.activeAccountId);
      setTikTokPostMode(mode);
      setSavedSnapshot(snapshot(next, data.activeAccountId, mode));
      setStatus('Saved');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  function updateAccount(index: number, patch: Partial<TikTokAccount>) {
    setAccounts((prev) => prev.map((account, i) => (i === index ? { ...account, ...patch } : account)));
  }

  function clearAccount(index: number) {
    setAccounts((prev) => {
      const next = prev.map((account, i) => (i === index ? { ...EMPTY_SLOT } : account));
      const remaining = next.map((a) => a.id.trim()).filter(Boolean);
      if (!remaining.includes(activeAccountId)) {
        setActiveAccountId(remaining[0] || '');
      }
      return next;
    });
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
            Connect accounts and choose how Share delivers to TikTok.
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
                    <label className="flex cursor-pointer items-center gap-2.5 pt-1">
                      <input
                        type="radio"
                        name="default-account"
                        checked={activeAccountId === account.id.trim()}
                        onChange={() => setActiveAccountId(account.id.trim())}
                        className="size-4 accent-[var(--felar-accent)]"
                      />
                      <span className="text-[13px] text-text-secondary">Default for Share</span>
                    </label>
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
