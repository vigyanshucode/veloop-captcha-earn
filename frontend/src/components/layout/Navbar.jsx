import { Link, useNavigate } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import useWallet from '../../hooks/useWallet';
import WalletBadge from '../wallet/WalletBadge';
import { IconLogout, IconShield, IconGem } from '../common/Icons';

const Navbar = () => {
  const { isAuthenticated, user, logout } = useAuth();
  const { gems, loading: walletLoading } = useWallet({ enabled: isAuthenticated });
  const navigate = useNavigate();

  const onLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="vl-navbar">
      <div className="vl-navbar__inner">
        <Link to={isAuthenticated ? '/earn' : '/'} className="vl-navbar__brand" aria-label="VELoop Rewards home">
          <span className="vl-navbar__brand-logo" aria-hidden="true">
            <IconShield size={22} />
            <IconGem size={14} />
          </span>
          <span className="vl-navbar__brand-text">
            <span className="vl-navbar__brand-name">VELoop</span>
            <span className="vl-navbar__brand-sub">Rewards</span>
          </span>
        </Link>

        <nav className="vl-navbar__actions" aria-label="Account">
          {isAuthenticated ? (
            <>
              <WalletBadge gems={gems} loading={walletLoading} />
              <div className="vl-navbar__user" aria-label={`Signed in as ${user ? user.name : ''}`}>
                <div className="vl-navbar__avatar" aria-hidden="true">
                  {user && user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                </div>
                <div className="vl-navbar__user-text">
                  <span className="vl-navbar__user-name">{user ? user.name : 'User'}</span>
                  <span className="vl-navbar__user-email">{user ? user.email : ''}</span>
                </div>
              </div>
              <button
                type="button"
                className="vl-btn vl-btn--ghost vl-btn--sm"
                onClick={onLogout}
                aria-label="Sign out"
              >
                <span className="vl-btn__icon vl-btn__icon--left" aria-hidden="true"><IconLogout size={16} /></span>
                <span className="vl-btn__label">Sign out</span>
              </button>
            </>
          ) : (
            <div className="vl-navbar__cta">
              <Link to="/login" className="vl-btn vl-btn--ghost vl-btn--sm">
                <span className="vl-btn__label">Sign in</span>
              </Link>
              <Link to="/register" className="vl-btn vl-btn--primary vl-btn--sm">
                <span className="vl-btn__label">Create account</span>
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
};

export default Navbar;
