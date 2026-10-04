import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '../common/Button';
import Input from '../common/Input';
import Card from '../common/Card';
import { AlertBanner } from '../common/AlertBanner';
import { IconUser } from '../common/Icons';
import useAuth from '../../hooks/useAuth';
import { firstValidationMessage, userFacingMessage } from '../../utils/errors';

const RegisterForm = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const { register, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) navigate('/earn', { replace: true });
  }, [isAuthenticated, navigate]);

  const validate = () => {
    const next = {};
    if (!name.trim()) next.name = 'Name is required.';
    else if (name.trim().length < 2) next.name = 'Name must be at least 2 characters.';
    if (!email.trim()) next.email = 'Email is required.';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Please enter a valid email.';
    if (!password) next.password = 'Password is required.';
    else if (password.length < 6) next.password = 'Password must be at least 6 characters.';
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
      await register({ name: name.trim(), email: email.trim(), password });
      navigate('/earn', { replace: true });
    } catch (err) {
      if (err && err.status === 409) {
        setErrors({ email: 'An account with this email already exists.' });
        return;
      }
      const validationMsg = firstValidationMessage(err);
      if (validationMsg) {
        setErrors({ _form: validationMsg });
      }
      setFormError(userFacingMessage(err, 'Unable to create account.'));
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <Card className="vl-auth-card">
      <div className="vl-auth-card__head">
        <div className="vl-auth-card__icon" aria-hidden="true"><IconUser size={22} /></div>
        <h1 className="vl-auth-card__title">Create your account</h1>
        <p className="vl-auth-card__subtitle">Start earning gems by solving CAPTCHAs in minutes.</p>
      </div>
      {formError ? (
        <div className="vl-auth-card__alert">
          <AlertBanner variant="error" onClose={() => setFormError(null)}>
            {errors._form || formError}
          </AlertBanner>
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="vl-form" noValidate>
        <Input
          label="Full name"
          placeholder="Alex Morgan"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
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
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="At least 6 characters."
          error={errors.password}
        />
        <Button type="submit" size="lg" loading={submitLoading} className="vl-form__submit">
          {submitLoading ? 'Creating account...' : 'Create account'}
        </Button>
      </form>
      <p className="vl-auth-card__footer">
        Already have an account?{' '}
        <Link to="/login" className="vl-link">Sign in</Link>
      </p>
    </Card>
  );
};

export default RegisterForm;
