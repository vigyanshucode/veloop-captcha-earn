import { Link, Navigate } from 'react-router-dom';
import useAuth from '../hooks/useAuth';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import { IconShield, IconGem, IconPlay } from '../components/common/Icons';

const LandingPage = () => {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/earn" replace />;
  return (
    <div className="vl-landing">
      <div className="vl-landing__hero">
        <div className="vl-landing__badge" aria-hidden="true">
          <IconShield size={16} />
          <span>Secure Rewards Engine</span>
        </div>
        <h1 className="vl-landing__title">
          Earn gems for solving real CAPTCHA challenges.
        </h1>
        <p className="vl-landing__subtitle">
          A trustworthy, fintech-grade CAPTCHA Earn experience. Every answer is verified server-side — your rewards are final and protected.
        </p>
        <div className="vl-landing__cta">
          <Link to="/register">
            <Button size="lg" iconRight={<IconPlay size={16} />}>
              Start earning
            </Button>
          </Link>
          <Link to="/login">
            <Button size="lg" variant="secondary">
              Sign in
            </Button>
          </Link>
        </div>
      </div>
      <div className="vl-landing__cards" role="list">
        {[
          { t: 'Server-verified', d: 'CAPTCHA answers and rewards are computed only on the backend.', g: true },
          { t: 'Atomic accounting', d: 'Wallet increments are atomic — no duplicates, no race conditions.', g: true },
          { t: 'Rewards you can trust', d: 'Every transaction is audited and protected by idempotency keys.', g: true },
        ].map((c, i) => (
          <Card key={i} className="vl-landing__card" role="listitem">
            <div className="vl-landing__card-icon" aria-hidden="true">
              <IconGem size={22} />
            </div>
            <h3>{c.t}</h3>
            <p>{c.d}</p>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default LandingPage;
