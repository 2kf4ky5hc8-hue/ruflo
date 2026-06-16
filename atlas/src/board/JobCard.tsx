import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Job } from '../lib/types';
import { paymentLabel } from '../lib/types';
import { moneyCompact, dateShort, isOverdue } from '../lib/format';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';

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
    opacity: isDragging ? 0.4 : 1,
  };
  const dragProps = draggable ? { ...listeners, ...attributes } : {};

  const hasOutstanding =
    job.amount_outstanding != null && job.amount_outstanding > 0;
  const showBadges = job.payment_status !== 'none' || hasOutstanding;
  const overdue = isOverdue(job.next_action_due);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        'card' + (draggable ? ' grabbable' : '') + (isDragging ? ' dragging' : '')
      }
      onClick={() => onOpen(job.id)}
      {...dragProps}
    >
      <div className="card-top">
        <div className="card-title">{job.job_name}</div>
        {job.estimated_value != null && (
          <div className="card-value">{moneyCompact(job.estimated_value)}</div>
        )}
      </div>
      {job.client_name && <div className="card-sub">{job.client_name}</div>}

      {job.site_address && (
        <div className="card-addr">
          <Icon name="pin" size={13} />
          <span>{job.site_address}</span>
        </div>
      )}

      {showBadges && (
        <div className="card-badges">
          {job.payment_status !== 'none' && (
            <span className={'badge pay-' + job.payment_status}>
              {paymentLabel(job.payment_status)}
            </span>
          )}
          {hasOutstanding && (
            <span className="badge outstanding">
              {moneyCompact(job.amount_outstanding)} due
            </span>
          )}
        </div>
      )}

      {job.next_action && (
        <div className="card-next">
          <span className="card-next-text">{job.next_action}</span>
          {job.next_action_due && (
            <span className={'due-pill' + (overdue ? ' overdue' : '')}>
              <Icon name="calendar" size={12} />
              {dateShort(job.next_action_due)}
            </span>
          )}
        </div>
      )}

      <div className="card-foot">
        {job.assigned_manager ? (
          <span className="who">
            <Avatar name={managerName} id={job.assigned_manager} size={22} />
            <span className="who-name">{managerName}</span>
          </span>
        ) : (
          <span className="who unassigned">
            <span className="avatar ph">?</span>
            <span className="who-name">Unassigned</span>
          </span>
        )}
      </div>
    </div>
  );
}
