import Card from '../common/Card';
import { IconGem, IconRefresh } from '../common/Icons';
import { formatGems } from '../../utils/format';
import Button from '../common/Button';

const WalletCard = ({ gems, loading = false, onRefresh, earnedRecently = null }) => {
  const display = loading ? '—' : formatGems(gems);
  return (
    <Card className="vl-wallet-card">
      <div className="vl-wallet-card__row">
        <div>
          <p className="vl-wallet-card__eyebrow">Your wallet</p>
          <div className="vl-wallet-card__amount">
            <span className="vl-wallet-card__icon" aria-hidden="true"><IconGem size={28} /></span>
            <span className="vl-wallet-card__value">{display}</span>
            <span className="vl-wallet-card__unit">gems</span>
          </div>
          {Number.isFinite(earnedRecently) ? (
            <p className="vl-wallet-card__earned">
              +{formatGems(earnedRecently)} from this challenge
            </p>
          ) : null}
        </div>
        <div>
          <Button
            variant="ghost"
            size="sm"
            loading={loading}
            onClick={onRefresh}
            iconLeft={<IconRefresh size={16} />}
          >
            Refresh
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default WalletCard;
