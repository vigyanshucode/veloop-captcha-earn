const OptionCard = ({ option, index, selected, disabled, onClick }) => {
  const letter = String.fromCharCode(65 + (index % 4));
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`vl-option ${selected ? 'vl-option--selected' : ''} ${disabled ? 'vl-option--disabled' : ''}`}
      aria-pressed={selected || undefined}
      aria-label={`Option ${letter}: ${option}`}
      style={{ '--idx': index }}
    >
      <span className="vl-option__letter" aria-hidden="true">{letter}</span>
      <span className="vl-option__text">{option}</span>
      <span className="vl-option__ring" aria-hidden="true" />
    </button>
  );
};

const OptionGrid = ({ options, selectedOption, disabled, onSelect }) => {
  if (!Array.isArray(options) || options.length === 0) return null;
  return (
    <div className="vl-options" role="radiogroup" aria-label="Choose the matching CAPTCHA option">
      {options.slice(0, 4).map((opt, i) => (
        <OptionCard
          key={opt + i}
          option={opt}
          index={i}
          selected={selectedOption === opt}
          disabled={disabled}
          onClick={() => !disabled && onSelect(opt)}
        />
      ))}
    </div>
  );
};

export { OptionCard, OptionGrid };
