import { useEffect, useMemo, useState } from 'react';
import useCaptcha from '../hooks/useCaptcha';
import useWallet from '../hooks/useWallet';
import useAuth from '../hooks/useAuth';
import Card from '../components/common/Card';
import Spinner from '../components/common/Spinner';
import Button from '../components/common/Button';
import { AlertBanner } from '../components/common/AlertBanner';
import { CaptchaHeader, CaptchaDisplay } from '../components/captcha/CaptchaDisplay';
import { OptionGrid } from '../components/captcha/OptionGrid';
import { VerifyingState, SuccessState, IncorrectState } from '../components/captcha/ResultStates';
import AdOverlay from '../components/captcha/AdOverlay';
import ClaimSection from '../components/captcha/ClaimSection';
import WalletCard from '../components/wallet/WalletCard';
import { IconRefresh, IconAlert } from '../components/common/Icons';
import { classifyApiError, userFacingMessage } from '../utils/errors';

const CaptchaEarnPage = () => {
  const { logout } = useAuth();
  const captcha = useCaptcha();
  const wallet = useWallet({ enabled: true });
  const [adOpen, setAdOpen] = useState(false);
  const [adWatchLoading, setAdWatchLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const {
    step,
    challenge,
    selectedOption,
    verifyResult,
    claimResult,
    adResult,
    lastError,
    walletGems,
    loadCurrent,
    selectOption,
    watchAd,
    claimReward,
    newChallenge,
    STEPS,
  } = captcha;

  useEffect(() => {
    if (lastError) {
      const info = classifyApiError(lastError);
      if (info.requiresLogin) {
        logout();
      }
    }
  }, [lastError, logout]);

  useEffect(() => {
    if (Number.isFinite(walletGems)) {
      wallet.setGemsFromBackend(walletGems);
    }
  }, [walletGems, wallet]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.duration || 4500);
    return () => clearTimeout(id);
  }, [toast]);

  const displayGems = useMemo(() => {
    if (Number.isFinite(walletGems)) return walletGems;
    return wallet.gems;
  }, [walletGems, wallet.gems]);

  const optionsDisabled = step !== STEPS.IDLE;
  const lastErrorInfo = lastError ? classifyApiError(lastError) : null;

  const earnedRecently = useMemo(() => {
    if (step === STEPS.CLAIMED && claimResult && Number.isFinite(claimResult.rewardAmount)) {
      return claimResult.rewardAmount;
    }
    if ((step === STEPS.SUCCESS || step === STEPS.INCORRECT) && verifyResult && Number.isFinite(verifyResult.rewardAmount)) {
      return null;
    }
    return null;
  }, [step, claimResult, verifyResult, STEPS]);

  const handleWatchAdClick = async () => {
    setAdWatchLoading(true);
    try {
      const res = await watchAd();
      setAdWatchLoading(false);
      if (!res) {
        setToast({ variant: 'warning', message: 'Could not prepare ad. Try again shortly.' });
        return;
      }
      setAdOpen(true);
    } catch (e) {
      setAdWatchLoading(false);
      setToast({ variant: 'error', message: userFacingMessage(e, 'Ad failed. Try again.') });
    }
  };

  const handleAdComplete = async () => {
    setAdOpen(false);
    try {
      await claimReward();
    } catch (e) {
      setToast({ variant: 'error', message: userFacingMessage(e, 'Claim failed. Retry.') });
    }
  };

  const handleClaimDirect = async () => {
    try {
      await claimReward();
    } catch (e) {
      setToast({ variant: 'error', message: userFacingMessage(e, 'Claim failed.') });
    }
  };

  const handleNext = async () => {
    const res = await newChallenge();
    if (!res && !challenge) {
      await loadCurrent();
    }
  };

  const claimed = step === STEPS.CLAIMED;
  const adDone = !!adResult;
  const isCorrect = verifyResult ? verifyResult.isCorrect === true : step === STEPS.SUCCESS || step === STEPS.CLAIMED || (!!adResult) ? true : false;

  const isCorrectFinal = (step === STEPS.SUCCESS || step === STEPS.CLAIMED) || (verifyResult && verifyResult.isCorrect === true) || false;

  return (
    <div className="vl-earn">
      {toast ? (
        <div className="vl-earn__toast" aria-live="polite">
          <AlertBanner variant={toast.variant || 'info'} onClose={() => setToast(null)}>
            {toast.message}
          </AlertBanner>
        </div>
      ) : null}

      <section className="vl-earn__wallet">
        <WalletCard
          gems={displayGems}
          loading={wallet.loading}
          onRefresh={wallet.invalidate}
          earnedRecently={earnedRecently}
        />
      </section>

      <Card className="vl-captcha">
        <CaptchaHeader challenge={challenge} step={step} />

        {step === STEPS.LOADING ? (
          <div className="vl-captcha__body">
            <Spinner label="Loading challenge…" />
          </div>
        ) : lastError && lastErrorInfo && (lastErrorInfo.category === 'auth') ? (
          <div className="vl-captcha__body">
            <AlertBanner variant="error" title="Session expired" onClose={() => {}}>
              Please sign in again to continue earning.
            </AlertBanner>
          </div>
        ) : !challenge ? (
          <div className="vl-captcha__body">
            <AlertBanner variant="warning" title="No challenge available">
              <p>We couldn&apos;t load a CAPTCHA right now.</p>
              <div style={{ marginTop: 12 }}>
                <Button size="md" iconLeft={<IconRefresh size={16} />} onClick={() => loadCurrent()}>
                  Try again
                </Button>
              </div>
            </AlertBanner>
          </div>
        ) : (
          <div className="vl-captcha__body">
            {step === STEPS.EXPIRED ? (
              <div className="vl-captcha__state-wrap">
                <AlertBanner variant="warning" icon={<IconAlert size={18} />} title="Challenge expired">
                  A fresh challenge is being loaded…
                </AlertBanner>
              </div>
            ) : null}
            {lastError && step !== STEPS.ERROR && step !== STEPS.EXPIRED ? (
              <div className="vl-captcha__alert">
                <AlertBanner variant={lastErrorInfo && lastErrorInfo.retryable ? 'warning' : 'error'} onClose={() => {}}>
                  {userFacingMessage(lastError)}
                </AlertBanner>
              </div>
            ) : null}

            {step !== STEPS.SUCCESS && step !== STEPS.INCORRECT && step !== STEPS.CLAIMED && step !== STEPS.VERIFYING ? (
              <>
                <CaptchaDisplay challenge={challenge} />
                <OptionGrid
                  options={challenge.options}
                  selectedOption={selectedOption}
                  disabled={optionsDisabled}
                  onSelect={selectOption}
                />
              </>
            ) : null}

            {step === STEPS.VERIFYING ? (
              <div className="vl-captcha__state-wrap">
                <VerifyingState />
              </div>
            ) : null}

            {step === STEPS.SUCCESS ? (
              <div className="vl-captcha__state-wrap">
                <SuccessState
                  rewardAmount={verifyResult && Number.isFinite(verifyResult.rewardAmount) ? verifyResult.rewardAmount : null}
                  rewardStatus={verifyResult ? verifyResult.rewardStatus : 'PENDING'}
                />
                <div className="vl-captcha__claim-wrap">
                  <ClaimSection
                    phase="post"
                    rewardAmount={verifyResult ? verifyResult.rewardAmount : null}
                    rewardStatus={verifyResult ? verifyResult.rewardStatus : 'PENDING'}
                    isCorrect={true}
                    adDone={adDone}
                    watchLoading={adWatchLoading}
                    claimLoading={step === STEPS.CLAIMING}
                    skipLoading={step === STEPS.SKIPPING}
                    onWatchAd={handleWatchAdClick}
                    onClaim={handleClaimDirect}
                    onNoThanks={handleNext}
                  />
                </div>
              </div>
            ) : null}

            {step === STEPS.INCORRECT ? (
              <div className="vl-captcha__state-wrap">
                <IncorrectState
                  rewardAmount={verifyResult && Number.isFinite(verifyResult.rewardAmount) ? verifyResult.rewardAmount : null}
                />
                <div className="vl-captcha__claim-wrap">
                  <ClaimSection
                    phase="post"
                    rewardAmount={verifyResult ? verifyResult.rewardAmount : null}
                    rewardStatus={verifyResult ? verifyResult.rewardStatus : 'PENDING'}
                    isCorrect={false}
                    adDone={true}
                    claimLoading={step === STEPS.CLAIMING}
                    skipLoading={step === STEPS.SKIPPING}
                    onClaim={handleClaimDirect}
                    onNoThanks={handleNext}
                  />
                </div>
              </div>
            ) : null}

            {step === STEPS.CLAIMED ? (
              <div className="vl-captcha__state-wrap">
                <SuccessState
                  rewardAmount={claimResult ? claimResult.rewardAmount : (verifyResult ? verifyResult.rewardAmount : null)}
                  rewardStatus={claimResult ? claimResult.rewardStatus : 'CLAIMED'}
                />
                <div className="vl-captcha__claim-wrap">
                  <ClaimSection
                    phase="claimed"
                    claimed={true}
                    rewardAmount={claimResult ? claimResult.rewardAmount : (verifyResult ? verifyResult.rewardAmount : null)}
                    rewardStatus="CLAIMED"
                    walletGems={displayGems}
                    isCorrect={isCorrectFinal}
                    adDone={true}
                    claimLoading={false}
                    skipLoading={step === STEPS.SKIPPING}
                    onNoThanks={handleNext}
                  />
                  <div style={{ marginTop: 12 }}>
                    <Button variant="primary" size="lg" onClick={handleNext} iconLeft={<IconRefresh size={16} />}>
                      Next challenge
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {step === STEPS.ERROR ? (
              <div className="vl-captcha__state-wrap">
                <AlertBanner variant="error" title="Something went wrong" onClose={() => {}}>
                  <p>{userFacingMessage(lastError, 'An error occurred.')}</p>
                  <div style={{ marginTop: 12 }}>
                    <Button variant="primary" size="md" iconLeft={<IconRefresh size={16} />} onClick={() => loadCurrent()}>
                      Reload challenge
                    </Button>
                    <span style={{ display: 'inline-block', width: 12 }} />
                    <Button variant="ghost" size="md" onClick={handleNext}>
                      Start with new challenge
                    </Button>
                  </div>
                </AlertBanner>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <AdOverlay
        open={adOpen}
        durationMs={3500}
        onClose={() => setAdOpen(false)}
        onComplete={handleAdComplete}
      />
    </div>
  );
};

export default CaptchaEarnPage;
