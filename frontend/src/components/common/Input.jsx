import { forwardRef, useId } from 'react';

const Input = forwardRef(function Input(
  { label, hint, error, id, type = 'text', className = '', autoComplete, required, ...rest },
  ref
) {
  const autoId = useId();
  const inputId = id || autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errId = error ? `${inputId}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`vl-field ${error ? 'vl-field--error' : ''}`}>
      {label ? (
        <label htmlFor={inputId} className="vl-field__label">
          {label}
          {required ? <span className="vl-field__req" aria-hidden="true"> *</span> : null}
        </label>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        type={type}
        autoComplete={autoComplete}
        className={`vl-field__input ${className}`}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {error ? <p className="vl-field__error" id={errId} role="alert">{error}</p> : null}
      {!error && hint ? <p className="vl-field__hint" id={hintId}>{hint}</p> : null}
    </div>
  );
});

export default Input;
