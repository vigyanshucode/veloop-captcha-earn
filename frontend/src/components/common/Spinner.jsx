import { IconSpinner } from './Icons';

const Spinner = ({ size = 32, label = 'Loading', className = '' }) => (
  <div className={`vl-spinner-wrap ${className}`} role="status" aria-live="polite">
    <IconSpinner size={size} />
    <span className="vl-spinner-wrap__label">{label}</span>
  </div>
);

export default Spinner;
