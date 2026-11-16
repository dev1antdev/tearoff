import { useEffect, useRef, useState } from 'react';
import {
  CheckIcon,
  CopySimpleIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@phosphor-icons/react';
import { maskDeviceKey } from '@irdashies/types';
import logger from '@irdashies/utils/logger';

interface BrowserLinkFieldProps {
  /** What the link opens, for a reader who cannot see what is around it. */
  label: string;
  url: string;
  /**
   * The key inside `url`. It is kept off the screen until it is asked for,
   * so a settings window on a stream gives nothing away; copying always
   * takes the whole link.
   */
  secret?: string | null;
  copyLabel?: string;
  /** Draws the copy button as the row's main action. */
  primary?: boolean;
}

const COPIED_MS = 2000;

/** A link to one of the web server's pages, to read and to copy. */
export const BrowserLinkField = ({
  label,
  url,
  secret,
  copyLabel = 'Copy',
  primary = false,
}: BrowserLinkFieldProps) => {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = () => {
    void Promise.resolve(navigator.clipboard?.writeText(url))
      .then(() => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      })
      // The link may hold the key, so only the failure is written down.
      .catch(() => logger.warn('Could not copy a browser page link'));
  };

  return (
    <div className="flex flex-wrap gap-2">
      <input
        type="text"
        readOnly
        aria-label={label}
        value={secret && !shown ? maskDeviceKey(url, secret) : url}
        className="settings-field min-w-48 flex-1 font-mono"
      />
      {secret && (
        <button
          type="button"
          className="settings-button whitespace-nowrap"
          aria-pressed={shown}
          onClick={() => setShown((current) => !current)}
        >
          {shown ? (
            <EyeSlashIcon size={14} aria-hidden="true" />
          ) : (
            <EyeIcon size={14} aria-hidden="true" />
          )}
          {shown ? 'Hide key' : 'Show key'}
        </button>
      )}
      <button
        type="button"
        className={`${primary ? 'settings-button-primary' : 'settings-button'} whitespace-nowrap`}
        onClick={copy}
      >
        {copied ? (
          <CheckIcon size={14} aria-hidden="true" />
        ) : (
          <CopySimpleIcon size={14} aria-hidden="true" />
        )}
        {copyLabel}
      </button>
      <span role="status" className="sr-only">
        {copied ? 'Copied' : ''}
      </span>
    </div>
  );
};
BrowserLinkField.displayName = 'BrowserLinkField';
