import { forwardRef } from 'react';
import { IconSpinner } from './Icons';

const variants = {
  primary: 'vl-btn--primary',
  secondary: 'vl-btn--secondary',
  ghost: 'vl-btn--ghost',
  success: 'vl-btn--success',
  danger: 'vl-btn--danger',
};

const sizes = {
  sm: 'vl-btn--sm',
  md: 'vl-btn--md',
  lg: 'vl-btn--lg',
};

const Button = forwardRef(function Button(
  {
    as: Tag = 'button',
    variant = 'primary',
    size = 'md',
    className = '',
    loading = false,
    disabled = false,
    iconLeft = null,
    iconRight = null,
    children,
    type = 'button',
    ...rest
  },
  ref
) {
  const isDisabled = disabled || loading;
  const classes = [
    'vl-btn',
    variants[variant] || '',
    sizes[size] || '',
    isDisabled ? 'vl-btn--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag
      ref={ref}
      type={Tag === 'button' ? type : undefined}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={classes}
      {...rest}
    >
      {loading ? (
      <span className="vl-btn__spinner" aria-hidden="true">
        <IconSpinner size={size === 'lg' ? 22 : 18} />
      </span>
    ) : iconLeft ? <span className="vl-btn__icon vl-btn__icon--left" aria-hidden="true">{iconLeft}</span> : null}
      <span className="vl-btn__label">{children}</span>
      {!loading && iconRight ? <span className="vl-btn__icon vl-btn__icon--right" aria-hidden="true">{iconRight}</span> : null}
    </Tag>
  );
});

export default Button;
