import type { ReactNode } from 'react';
import { navigate } from '../lib/hooks.ts';
import { Icon } from './Icon.tsx';

// Navigation bar: back button with the parent's name on the left, optional inline title, actions on the right.
// Without `to`, back goes through the browser history.

type Props = { back?: string; to?: string; title?: string; children?: ReactNode };

export function Nav({ back, to, title, children }: Props) {
  return (
    <div className="nav">
      <div className="nav-left">
        {back === undefined && (
          <span className="seal" aria-hidden="true">
            掘
          </span>
        )}
        {back !== undefined && (
          <button className="nav-back" onClick={() => (to ? navigate(to) : history.back())} aria-label={`Back to ${back}`}>
            <Icon name="back" size={28} weight={2.1} />
            <span>{back}</span>
          </button>
        )}
      </div>
      <div className="nav-title">{title}</div>
      <div className="nav-right">{children}</div>
    </div>
  );
}
