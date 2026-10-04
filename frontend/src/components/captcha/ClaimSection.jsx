import Button from '../common/Button';
import { IconCheck, IconGem, IconPlay, IconSkip } from '../common/Icons';
import { formatGems } from '../../utils/format';

const ClaimSection = ({
  phase = 'post',
  rewardAmount,
  rewardStatus,
  claimed,
  walletGems,
  adDone = false,
  onWatchAd,
  onClaim,
  onNoThanks,
  watchLoading,
  claimLoading,
  skipLoading,
  isCorrect,
}) => {
  const canClaim = (adDone || phase === 'claimed' || !isCorrect) && phase !== 'claimed';
  const showWatch = isCorrect && !adDone && phase !== 'claimed';
  return (
    <div className="vl-claim">
      <div className="vl-claim__reward">
        <div className="vl-claim__gem" aria-hidden="true"><IconGem size={22} /></div>
        <div>
          <p className="vl-claim__label">Reward</p>
          <p className="vl-claim__amount">
            {Number.isFinite(rewardAmount) ? formatGems(rewardAmount) : '—'}
            <span className="vl-claim__unit">gems</span>
          </p>
          <p className={`vl-claim__status vl-claim__status--${rewardStatus || 'PENDING'}`}>
            {claimed ? 'Claimed to wallet' : `Status: ${rewardStatus || 'PENDING'}`}
          </p>
        </div>
      </div>

      <div className="vl-claim__actions">
        {phase === 'claimed' ? (
          <Button variant="success" size="lg" iconLeft={<IconCheck size={18} />} disabled>
            {`${formatGems(walletGems)} gems in wallet`}
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="md"
              onClick={onNoThanks}
              loading={skipLoading}
              iconLeft={<IconSkip size={16} />}
            >
              No thanks, next
            </Button>
            {showWatch ? (
              <Button
                variant="primary"
                size="lg"
                onClick={onWatchAd}
                loading={watchLoading}
                iconLeft={<IconPlay size={16} />}
              >
                Watch ad to unlock claim
              </Button>
            ) : (
              <Button
                variant="success"
                size="lg"
                onClick={onClaim}
                loading={claimLoading}
                disabled={!canClaim && claimLoading === false ? false : false}
                iconLeft={<IconGem size={18} />}
              >
                {claimLoading ? 'Adding to wallet…' : 'Claim reward'}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ClaimSection;
