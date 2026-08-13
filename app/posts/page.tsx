'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DeskShell } from '../components/desk-shell';
import { Button } from '../components/ui';

type PendingInboxAccount = { username: string; count: number; titles: string[] };
type StudioPost = {
  id: string;
  title: string;
  status: string;
  platformStatus: string;
  createdAt: string;
  username: string;
  accountId: string;
  isInboxDraft: boolean;
  slideCount: number;
  platformPostId: string;
  platformPostUrl: string;
  error: string;
  thumbUrl: string;
  canRetry: boolean;
};

function formatWhen(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function modeLabel(post: StudioPost): string {
  if (post.isInboxDraft) return 'Creator Inbox';
  if (post.status === 'draft') return 'Zernio draft';
  return 'Live / direct';
}

export default function PostsPage() {
  const [posts, setPosts] = useState<StudioPost[]>([]);
  const [busy, setBusy] = useState(false);
  const [retryingId, setRetryingId] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [pendingAccounts, setPendingAccounts] = useState<PendingInboxAccount[]>([]);
  const [pendingLimit, setPendingLimit] = useState(5);

  const loadPosts = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/posts?limit=40');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load posts');
      setPosts((data.posts || []) as StudioPost[]);
      setTotal(Number(data.pagination?.total || 0));
      setPendingAccounts((data.pendingInbox?.accounts || []) as PendingInboxAccount[]);
      setPendingLimit(Number(data.pendingInbox?.limit || 5));
      setStatus(
        data.posts?.length
          ? `${data.posts.length} recent posts${data.pagination?.total ? ` · ${data.pagination.total} total` : ''}`
          : 'No posts yet'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load posts');
      setStatus('Could not load posts');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  async function retryPost(post: StudioPost) {
    if (!post.canRetry || retryingId) return;
    setRetryingId(post.id);
    setError('');
    setStatus(`Retrying inbox upload for @${post.username || 'tiktok'}…`);
    try {
      const res = await fetch('/api/posts/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: post.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Retry failed');
      setStatus(
        `Resent to @${data.username}. Open TikTok → Inbox → Activity → System notifications.`
      );
      await loadPosts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
      setStatus('Retry failed');
    } finally {
      setRetryingId('');
    }
  }

  return (
    <DeskShell
      footer={<span className="font-mono">{total ? `${total} on Zernio` : 'Sent posts'}</span>}
      headerLeft={status || 'Posts sent through Studio'}
      headerRight={
        <Button type="button" variant="secondary" onClick={() => void loadPosts()} disabled={busy || Boolean(retryingId)}>
          {busy ? 'Refreshing' : 'Refresh'}
        </Button>
      }
    >
      <div className="mx-auto max-w-[920px] space-y-5">
        <div>
          <h1 className="font-display text-[28px] font-medium tracking-tight text-text-primary">Posts</h1>
          <p className="mt-1 text-[14px] text-text-secondary">
            TikTok accepts these as Creator Inbox uploads. They never appear under Profile → Drafts. Open the
            TikTok app → Inbox → Activity → System notifications, then publish or discard them. Max {pendingLimit}{' '}
            unfinished uploads per account per 24 hours.
          </p>
        </div>

        {pendingAccounts.length ? (
          <div className="rounded-xl border border-border bg-background px-5 py-4">
            <p className="text-[13px] font-semibold text-text-primary">Unfinished TikTok inbox uploads</p>
            <ul className="mt-2 space-y-1 text-[13px] text-text-secondary">
              {pendingAccounts.map((account) => (
                <li key={account.username || account.titles[0]}>
                  @{account.username || 'tiktok'}: {account.count}/{pendingLimit}
                  {account.count >= pendingLimit ? ' — full, new shares will fail until you clear these' : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-xl border border-border bg-background px-5 py-3 text-[14px] text-[#B42318]">
            {error}
          </p>
        ) : null}

        {status && !error && /Resent|Retrying/.test(status) ? (
          <p className="rounded-xl border border-border bg-background px-5 py-3 text-[14px] text-success">
            {status}
          </p>
        ) : null}

        {busy && posts.length === 0 ? (
          <div className="grid h-40 place-items-center rounded-xl border border-dashed border-border">
            <p className="text-[13px] text-text-secondary">Loading posts…</p>
          </div>
        ) : posts.length === 0 ? (
          <div className="grid h-40 place-items-center rounded-xl border border-dashed border-border">
            <p className="px-6 text-center text-[13px] text-text-secondary">
              No posts yet. Share from <Link href="/" className="font-semibold text-[#B87A12] hover:underline">Studio</Link>{' '}
              first.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {posts.map((post) => (
              <li
                key={post.id}
                className="flex gap-4 rounded-xl border border-border bg-background p-4 shadow-[0_1px_2px_rgba(20,19,17,0.03)]"
              >
                <div className="h-20 w-14 shrink-0 overflow-hidden rounded-card bg-surface">
                  {post.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={post.thumbUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center font-mono text-[10px] text-text-tertiary">
                      —
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-text-primary">{post.title}</p>
                      <p className="mt-1 font-mono text-[11px] text-text-tertiary">
                        {formatWhen(post.createdAt)}
                        {post.username ? ` · @${post.username}` : ''}
                        {post.slideCount ? ` · ${post.slideCount} slides` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                        {modeLabel(post)}
                      </span>
                      <span className="rounded-full bg-surface px-2.5 py-1 font-mono text-[11px] text-text-tertiary">
                        {post.platformStatus || post.status || '—'}
                      </span>
                    </div>
                  </div>

                  {post.error ? (
                    <p className="mt-2 text-[12px] text-[#B42318]">{post.error}</p>
                  ) : post.isInboxDraft ? (
                    <p className="mt-2 text-[12px] text-text-secondary">
                      Look in TikTok Inbox → Activity → System notifications (not Profile Drafts).
                    </p>
                  ) : null}

                  {post.platformPostId ? (
                    <p className="mt-1 truncate font-mono text-[10px] text-text-tertiary">
                      {post.platformPostId}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="xs"
                      onClick={() => void retryPost(post)}
                      disabled={!post.canRetry || Boolean(retryingId) || busy}
                    >
                      {retryingId === post.id ? 'Retrying…' : 'Retry inbox'}
                    </Button>
                    {post.platformPostUrl ? (
                      <a
                        href={post.platformPostUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center rounded-button border border-border bg-background px-3 text-[13px] font-medium text-text-primary hover:bg-surface"
                      >
                        Open on TikTok
                      </a>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DeskShell>
  );
}
