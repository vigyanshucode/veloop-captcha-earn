import { useEffect, useMemo, useState } from 'react';
import Button from '../common/Button';
import { IconPlay, IconSpinner } from '../common/Icons';

const AdOverlay = ({ open, onClose, durationMs = 3500, onComplete }) => {
  const [remaining, setRemaining] = useState(durationMs);
  const canClose = remaining <= 0;

  useEffect(() => {
    if (!open) return;
    setRemaining(durationMs);
    const start = Date.now();
    const id = setInterval(() => {
      const left = Math.max(0, durationMs - (Date.now() - start));
      setRemaining(left);
      if (left <= 0) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [open, durationMs]);

  const progress = useMemo(() => {
    if (durationMs <= 0) return 1;
    return 1 - remaining / durationMs;
  }, [remaining, durationMs]);

  if (!open) return null;

  const sec = ((remaining / 1000)).toFixed(1);

  return (
    <div className="vl-ad-overlay" role="dialog" aria-modal="true" aria-label="Rewarded ad">
      <div className="vl-ad-overlay__panel">
        <div className="vl-ad-overlay__badge">Rewarded Ad</div>
        <div className="vl-ad-overlay__stage">
          <div className="vl-ad-overlay__logo" aria-hidden="true">
            <IconPlay size={28} />
          </div>
          <h3>Thanks for your attention</h3>
          <p>We appreciate your time — your reward is being prepared.</p>
          <div className="vl-ad-overlay__progress" aria-hidden="true">
            <div className="vl-ad-overlay__progress-bar" style={{ transform: `scaleX(${progress})` }} />
          </div>
          <div className="vl-ad-overlay__timer">
            {canClose ? (
              <span className="vl-ad-overlay__timer-ready">
                <IconSpinner size={16} /> Preparing reward…
              </span>
            ) : (
              <span>Watching… {sec}s</span>
            )}
          </div>
        </div>
        <div className="vl-ad-overlay__actions">
          <Button
            variant="primary"
            size="lg"
            onClick={onComplete}
            disabled={!canClose}
          >
            Continue to claim
          </Button>
        </div>
        <button
          type="button"
          className="vl-ad-overlay__close"
          onClick={onClose}
          disabled={!canClose}
          aria-label={canClose ? 'Close ad' : 'Ad in progress'}
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default AdOverlay;
