import { formatGems } from '../../utils/format';
import { IconGem, IconSpinner } from '../common/Icons';

const WalletBadge = ({ gems = 0, loading = false }) => {
  const label = loading ? '…' : formatGems(gems);
  return (
    <div
      className={`vl-wallet-badge ${loading ? 'vl-wallet-badge--loading' : ''}`}
      title={`Wallet balance: ${label} gems`}
      aria-label={`Wallet balance: ${label} gems`}
    >
      <span className="vl-wallet-badge__icon" aria-hidden="true">
        {loading ? <IconSpinner size={16} /> : <IconGem size={16} />}
      </span>
      <span className="vl-wallet-badge__amount">{label}</span>
      <span className="vl-wallet-badge__unit">gems</span>
    </div>
  );
};

export default WalletBadge;
