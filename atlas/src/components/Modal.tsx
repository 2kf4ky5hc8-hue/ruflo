import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'lg';
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className={'modal' + (size === 'lg' ? ' lg' : '')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="modal-sub">{subtitle}</div>}
          </div>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
