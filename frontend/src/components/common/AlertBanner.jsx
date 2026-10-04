import { useEffect } from 'react';
import { IconX } from './Icons';

const variants = {
  info: 'vl-banner--info',
  success: 'vl-banner--success',
  error: 'vl-banner--error',
  warning: 'vl-banner--warning',
};

const AlertBanner = ({ variant = 'info', title = null, children, onClose = null, className = '' }) => {
  const role = variant === 'error' ? 'alert' : 'status';
  return (
    <div className={`vl-banner ${variants[variant] || ''} ${className}`} role={role}>
      <div className="vl-banner__body">
        {title ? <p className="vl-banner__title">{title}</p> : null}
        {children ? <div className="vl-banner__content">{children}</div> : null}
      </div>
      {onClose ? (
        <button type="button" className="vl-banner__close" aria-label="Dismiss" onClick={onClose}>
          <IconX size={16} />
        </button>
      ) : null}
    </div>
  );
};

const ToastStack = ({ toasts, onDismiss }) => {
  useEffect(() => {
    if (!toasts || toasts.length === 0) return;
    const timers = toasts.map((t) =>
      t.duration !== 0 && setTimeout(() => onDismiss(t.id), t.duration || 4200)
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, onDismiss]);
  if (!toasts || toasts.length === 0) return null;
  return (
    <div className="vl-toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <AlertBanner
          key={t.id}
          variant={t.variant || 'info'}
        >
          {t.title ? <strong>{t.title} </strong> : null}
          {t.message}
        </AlertBanner>
      ))}
    </div>
  );
};

export { AlertBanner, ToastStack };
