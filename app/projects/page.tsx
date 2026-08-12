'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DeskShell } from '../components/desk-shell';
import { Button } from '../components/ui';
import {
  deleteStudioProject,
  listStudioProjects,
  setActiveStudioProjectId,
  type StudioProject,
} from '../lib/studio-projects';

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

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [status, setStatus] = useState('');

  function refresh() {
    const list = listStudioProjects();
    setProjects(list);
    setStatus(list.length ? `${list.length} saved project${list.length === 1 ? '' : 's'}` : 'No projects yet');
  }

  useEffect(() => {
    refresh();
  }, []);

  function openProject(id: string) {
    setActiveStudioProjectId(id);
    router.push(`/?project=${encodeURIComponent(id)}`);
  }

  function removeProject(id: string, title: string) {
    if (!window.confirm(`Delete project “${title}”?`)) return;
    deleteStudioProject(id);
    refresh();
  }

  return (
    <DeskShell
      footer={<span className="font-mono">{projects.length ? `${projects.length} local` : 'Projects'}</span>}
      headerLeft={status || 'Saved imports'}
      headerRight={
        <Button type="button" variant="secondary" onClick={() => router.push('/')}>
          New in Studio
        </Button>
      }
    >
      <div className="mx-auto max-w-[920px] space-y-5">
        <div>
          <h1 className="font-display text-[28px] font-medium tracking-tight text-text-primary">Projects</h1>
          <p className="mt-1 text-[14px] text-text-secondary">
            Every imported carousel is saved here so a refresh won’t wipe your work. Stored in this browser only.
          </p>
        </div>

        {projects.length === 0 ? (
          <div className="grid h-40 place-items-center rounded-xl border border-dashed border-border">
            <p className="px-6 text-center text-[13px] text-text-secondary">
              No projects yet. Import a TikTok URL in{' '}
              <Link href="/" className="font-semibold text-[#B87A12] hover:underline">
                Studio
              </Link>
              .
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {projects.map((project) => (
              <li
                key={project.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-background p-4 shadow-[0_1px_2px_rgba(20,19,17,0.03)]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-text-primary">{project.title}</p>
                  <p className="mt-1 font-mono text-[11px] text-text-tertiary">
                    Updated {formatWhen(project.updatedAt)}
                    {project.creator ? ` · @${project.creator.replace(/^@/, '')}` : ''}
                    {project.slides.length ? ` · ${project.slides.length} slides` : ''}
                    {project.selected.length ? ` · ${project.selected.length} photos picked` : ''}
                    {project.slide6DataUrl ? ' · promo ready' : ''}
                  </p>
                  {project.sourceUrl ? (
                    <p className="mt-1 truncate text-[12px] text-text-secondary">{project.sourceUrl}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" size="xs" onClick={() => openProject(project.id)}>
                    Open
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    onClick={() => removeProject(project.id, project.title)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DeskShell>
  );
}
