import Link from 'next/link';
import { Pending } from '@/components/pending';
import { SPORT_DEFS, SPORTS, type SportId } from '@sigmaline/core';

export function SportTabs({ active, hrefFor }: { active: SportId; hrefFor: (s: SportId) => string }) {
  return (
    <nav aria-label="Sport" className="mx-auto max-w-3xl overflow-x-auto border-b border-line px-2">
      <ul className="flex min-w-max">
        {SPORTS.map((s) => {
          const on = s === active;
          return (
            <li key={s}>
              <Link
                href={hrefFor(s)}
                prefetch={false}
                aria-current={on ? 'page' : undefined}
                className={`tap flex items-center px-3 text-[13px] font-semibold tracking-[0.12em] ${on ? 'border-b-2 border-amber text-ink' : 'border-b-2 border-transparent text-muted hover:text-ink'}`}
              >
                {SPORT_DEFS[s].tab}
                <Pending />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
