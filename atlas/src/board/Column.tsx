import { useDroppable } from '@dnd-kit/core';
import type { Job, JobStage } from '../lib/types';
import { JobCard } from './JobCard';

export function Column({
  stage,
  jobs,
  profileName,
  onOpen,
  draggable,
}: {
  stage: { value: JobStage; label: string };
  jobs: Job[];
  profileName: (id: string | null) => string;
  onOpen: (id: string) => void;
  draggable: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.value });

  return (
    <section ref={setNodeRef} className={'column' + (isOver ? ' over' : '')}>
      <div className="column-head">
        <span>{stage.label}</span>
        <span className="count">{jobs.length}</span>
      </div>
      <div className="column-body">
        {jobs.map((j) => (
          <JobCard
            key={j.id}
            job={j}
            managerName={profileName(j.assigned_manager)}
            onOpen={onOpen}
            draggable={draggable}
          />
        ))}
        {jobs.length === 0 && <div className="empty muted">No jobs</div>}
      </div>
    </section>
  );
}
