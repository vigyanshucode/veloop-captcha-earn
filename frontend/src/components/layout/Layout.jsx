import Navbar from './Navbar';
import { ToastStack } from '../common/AlertBanner';

const Layout = ({ children, toasts = [], onDismissToast = null }) => (
  <div className="vl-shell">
    <Navbar />
    <main className="vl-shell__main" id="main">
      <div className="vl-shell__container">
        {children}
      </div>
    </main>
    <footer className="vl-shell__footer">
      <div className="vl-shell__container vl-shell__footer-inner">
        <span>© VELoop Rewards — CAPTCHA Earn</span>
        <span className="vl-shell__footer-note">Secure. Trustworthy. Rewarding.</span>
      </div>
    </footer>
    <ToastStack toasts={toasts} onDismiss={onDismissToast} />
  </div>
);

export default Layout;
