import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { STAGES, type Job, type JobStage, type Profile } from '../lib/types';
import { canCreateJobs, canEdit } from '../lib/permissions';
import { Column } from './Column';
import { JobModal } from './JobModal';
import { NewJobForm } from './NewJobForm';

export function Board() {
  const { profile, signOut } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const loadJobs = useCallback(async () => {
    const { data } = await supabase
      .from('jobs')
      .select('*')
      .eq('archived', showArchived)
      .order('created_at', { ascending: true });
    setJobs((data as Job[]) ?? []);
    setLoading(false);
  }, [showArchived]);

  const loadProfiles = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('full_name', { ascending: true });
    setProfiles((data as Profile[]) ?? []);
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    setLoading(true);
    loadJobs();
  }, [loadJobs]);

  // Live updates: refetch on any change to jobs (dataset is small).
  useEffect(() => {
    const channel = supabase
      .channel('jobs-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jobs' },
        () => loadJobs(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadJobs]);

  const profileName = useCallback(
    (id: string | null): string => {
      if (!id) return '—';
      const p = profiles.find((x) => x.id === id);
      return p?.full_name || p?.email || '—';
    },
    [profiles],
  );

  async function moveJob(jobId: string, stage: JobStage) {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, stage } : j)));
    const { error } = await supabase.from('jobs').update({ stage }).eq('id', jobId);
    if (error) {
      alert('Could not move job: ' + error.message);
      loadJobs();
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const jobId = e.active.id as string;
    const overStage = e.over?.id as JobStage | undefined;
    if (!overStage) return;
    const job = jobs.find((j) => j.id === jobId);
    if (job && job.stage !== overStage) moveJob(jobId, overStage);
  }

  const jobsByStage = useMemo(() => {
    const map: Record<string, Job[]> = {};
    for (const s of STAGES) map[s.value] = [];
    for (const j of jobs) (map[j.stage] ??= []).push(j);
    return map;
  }, [jobs]);

  const selected = jobs.find((j) => j.id === selectedId) ?? null;
  const dragEnabled = !showArchived && canEdit(profile?.role);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Atlas Core <span className="muted">· Cubitt Wren</span>
        </div>
        <div className="topbar-right">
          {canCreateJobs(profile?.role) && !showArchived && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              + New job
            </button>
          )}
          <label className="toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Archived
          </label>
          <span className="role-badge">
            {profile?.full_name || profile?.email}
            <span className="muted"> · {profile?.role}</span>
          </span>
          <button className="btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {loading ? (
        <div className="center muted">Loading board…</div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="board">
            {STAGES.map((s) => (
              <Column
                key={s.value}
                stage={s}
                jobs={jobsByStage[s.value] ?? []}
                profileName={profileName}
                onOpen={setSelectedId}
                draggable={dragEnabled}
              />
            ))}
          </div>
        </DndContext>
      )}

      {selected && (
        <JobModal
          job={selected}
          profiles={profiles}
          profileName={profileName}
          onClose={() => setSelectedId(null)}
          onChanged={loadJobs}
        />
      )}
      {creating && (
        <NewJobForm
          profiles={profiles}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            loadJobs();
          }}
        />
      )}
    </div>
  );
}
