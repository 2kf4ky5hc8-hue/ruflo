import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Job } from '../lib/types';
import { paymentLabel } from '../lib/types';
import { money, dateLabel, isOverdue } from '../lib/format';

export function JobCard({
  job,
  managerName,
  onOpen,
  draggable,
}: {
  job: Job;
  managerName: string;
  onOpen: (id: string) => void;
  draggable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: job.id, disabled: !draggable });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  const dragProps = draggable ? { ...listeners, ...attributes } : {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="card"
      onClick={() => onOpen(job.id)}
      {...dragProps}
    >
      <div className="card-title">{job.job_name}</div>
      {job.client_name && <div className="card-sub">{job.client_name}</div>}

      <div className="card-meta">
        <span title="Assigned manager">👤 {managerName}</span>
        {job.estimated_value != null && (
          <span title="Estimated value">💷 {money(job.estimated_value)}</span>
        )}
      </div>

      <div className="card-badges">
        <span className={'badge pay-' + job.payment_status}>
          {paymentLabel(job.payment_status)}
        </span>
        {job.amount_outstanding != null && job.amount_outstanding > 0 && (
          <span className="badge outstanding">
            {money(job.amount_outstanding)} due
          </span>
        )}
      </div>

      {job.next_action && (
        <div className="card-next">
          ▸ {job.next_action}
          {job.next_action_due && (
            <span className={'due' + (isOverdue(job.next_action_due) ? ' overdue' : '')}>
              {' '}
              · {dateLabel(job.next_action_due)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
