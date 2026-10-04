import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Button from '../common/Button';
import Input from '../common/Input';
import Card from '../common/Card';
import { AlertBanner } from '../common/AlertBanner';
import { IconLock } from '../common/Icons';
import useAuth from '../../hooks/useAuth';
import { firstValidationMessage, userFacingMessage } from '../../utils/errors';

const LoginForm = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state && location.state.from && location.state.from.pathname) || '/earn';

  useEffect(() => {
    if (isAuthenticated) navigate(from, { replace: true });
  }, [isAuthenticated, navigate, from]);

  const validate = () => {
    const next = {};
    if (!email.trim()) next.email = 'Email is required.';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Please enter a valid email.';
    if (!password) next.password = 'Password is required.';
    return next;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setFormError(null);
    setSubmitLoading(true);
    try {
      await login({ email: email.trim(), password });
      navigate(from, { replace: true });
    } catch (err) {
      const validationMsg = firstValidationMessage(err);
      if (validationMsg) {
        setErrors({ email: validationMsg });
      } else {
        setFormError(userFacingMessage(err, 'Unable to sign in.'));
      }
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <Card className="vl-auth-card">
      <div className="vl-auth-card__head">
        <div className="vl-auth-card__icon" aria-hidden="true"><IconLock size={22} /></div>
        <h1 className="vl-auth-card__title">Welcome back</h1>
        <p className="vl-auth-card__subtitle">Sign in to earn rewards by completing CAPTCHA challenges.</p>
      </div>
      {formError ? (
        <div className="vl-auth-card__alert">
          <AlertBanner variant="error" onClose={() => setFormError(null)}>{formError}</AlertBanner>
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="vl-form" noValidate>
        <Input
          type="email"
          label="Email"
          placeholder="you@company.com"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <Input
          type="password"
          label="Password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <Button
          type="submit"
          size="lg"
          loading={submitLoading}
          className="vl-form__submit"
        >
          {submitLoading ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
      <p className="vl-auth-card__footer">
        Don&apos;t have an account?{' '}
        <Link to="/register" className="vl-link">Create one</Link>
      </p>
    </Card>
  );
};

export default LoginForm;
