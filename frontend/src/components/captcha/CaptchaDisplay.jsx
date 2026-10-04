import { timeRemaining } from '../../utils/format';
import { IconClock, IconShield } from '../common/Icons';
import { useEffect, useState } from 'react';

const CaptchaHeader = ({ challenge, step }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!challenge) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [challenge]);
  const t = timeRemaining(challenge ? challenge.expiresAt : null);
  const urgent = t.seconds > 0 && t.seconds <= 10;
  return (
    <div className="vl-captcha__head">
      <div className="vl-captcha__head-left">
        <span className="vl-pill vl-pill--neutral" aria-hidden="true">
          <IconShield size={14} /> <span>Server-verified</span>
        </span>
        <h2 className="vl-captcha__title">Prove you&apos;re human</h2>
        <p className="vl-captcha__subtitle">
          Select the option that matches the characters shown below.
        </p>
      </div>
      <div className={`vl-captcha__timer ${urgent ? 'vl-captcha__timer--urgent' : ''}`} aria-live="polite">
        <IconClock size={16} aria-hidden="true" />
        <span>
          {t.expired
            ? 'Expired'
            : step === 'VERIFYING' || step === 'SUCCESS' || step === 'INCORRECT' || step === 'CLAIMED'
              ? 'Locked'
              : t.label}
        </span>
      </div>
    </div>
  );
};

const CaptchaDisplay = ({ challenge }) => {
  if (!challenge) return null;
  return (
    <div className="vl-captcha-display" aria-label={`CAPTCHA text: ${challenge.captchaText}`}>
      <div className="vl-captcha-display__grid" aria-hidden="true">
        {challenge.captchaText.split('').map((c, i) => (
          <span key={i} className="vl-captcha-display__char" style={{ '--i': i }}>
            {c}
          </span>
        ))}
      </div>
      <p className="vl-captcha-display__hint">
        Match the sequence above — one of the four options is correct.
      </p>
    </div>
  );
};

export { CaptchaHeader, CaptchaDisplay };
