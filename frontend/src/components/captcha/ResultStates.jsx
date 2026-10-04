import { IconCheck, IconX, IconSpinner } from '../common/Icons';

const VerifyingState = () => (
  <div className="vl-state vl-state--verifying" role="status" aria-live="polite">
    <div className="vl-state__icon vl-state__icon--loading" aria-hidden="true">
      <IconSpinner size={28} />
    </div>
    <h3 className="vl-state__title">Verifying answer…</h3>
    <p className="vl-state__subtitle">Checking your selected option with the server.</p>
  </div>
);

const SuccessState = ({ rewardAmount, rewardStatus = 'PENDING' }) => (
  <div className="vl-state vl-state--success" role="status" aria-live="polite">
    <div className="vl-state__icon vl-state__icon--success" aria-hidden="true">
      <IconCheck size={28} />
    </div>
    <h3 className="vl-state__title">Correct!</h3>
    <p className="vl-state__subtitle">
      A reward of{' '}
      <strong className="vl-state__reward">{Number.isFinite(rewardAmount) ? rewardAmount : '—'} gems</strong>{' '}
      is <em>{rewardStatus}</em>. Complete the short ad to claim it to your wallet.
    </p>
  </div>
);

const IncorrectState = ({ rewardAmount }) => (
  <div className="vl-state vl-state--incorrect" role="status" aria-live="polite">
    <div className="vl-state__icon vl-state__icon--incorrect" aria-hidden="true">
      <IconX size={28} />
    </div>
    <h3 className="vl-state__title">Not quite right</h3>
    <p className="vl-state__subtitle">
      Your answer didn&apos;t match. You&apos;ll still receive{' '}
      <strong className="vl-state__reward">{Number.isFinite(rewardAmount) ? rewardAmount : '—'} gems</strong>{' '}
      for your effort — claim it or skip to the next challenge.
    </p>
  </div>
);

export { VerifyingState, SuccessState, IncorrectState };
