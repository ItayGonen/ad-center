import { useTranslation } from 'react-i18next';

const ISRAELI_PREFIXES = [
  { prefix: '050', label: '050' },
  { prefix: '051', label: '051' },
  { prefix: '052', label: '052' },
  { prefix: '053', label: '053' },
  { prefix: '054', label: '054' },
  { prefix: '055', label: '055' },
  { prefix: '058', label: '058' },
  { prefix: '02',  label: '02' },
  { prefix: '03',  label: '03' },
  { prefix: '04',  label: '04' },
  { prefix: '08',  label: '08' },
  { prefix: '09',  label: '09' },
  { prefix: '077', label: '077' },
];

interface PhoneInputProps {
  prefix: string;
  onPrefixChange: (prefix: string) => void;
  phoneNumber: string;
  onPhoneNumberChange: (number: string) => void;
  required?: boolean;
  error?: string;
}

export function validatePhone(prefix: string, number: string): string {
  const digits = number.replace(/[\s-]/g, '');
  if (!digits) return 'invalidPhoneNumber';
  if (!/^\d+$/.test(digits)) return 'phoneDigitsOnly';
  if (digits.length !== 7) return 'phoneExactly7Digits';
  return '';
}

export default function PhoneInput({
  prefix,
  onPrefixChange,
  phoneNumber,
  onPhoneNumberChange,
  required,
  error,
}: PhoneInputProps) {
  const { t } = useTranslation('auth');

  return (
    <div>
      <div className="phone-input-group">
        <select
          className="phone-input-select"
          value={prefix}
          onChange={e => onPrefixChange(e.target.value)}
          aria-label={t('phonePrefix')}
        >
          {ISRAELI_PREFIXES.map(p => (
            <option key={p.prefix} value={p.prefix}>
              {p.label}
            </option>
          ))}
        </select>
        <div className="phone-input-divider" />
        <input
          className="phone-input-number"
          type="tel"
          value={phoneNumber}
          onChange={e => onPhoneNumberChange(e.target.value)}
          placeholder="1234567"
          required={required}
          aria-label={t('localNumber')}
        />
      </div>
      {error && <div className="phone-input-error">{t(error)}</div>}
    </div>
  );
}
