// Small stroke icon set (24px grid, currentColor) so the UI does not depend on emoji fonts.

const PATHS: Record<string, string> = {
  watch: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M10 8.5v7l6-3.5-6-3.5Z',
  inbox: 'M4 13.5 6.2 5.6A2 2 0 0 1 8.1 4h7.8a2 2 0 0 1 1.9 1.6L20 13.5 M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5 M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20',
  book: 'M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2Z M12 6.5v13',
  chart: 'M4 20h16 M7 16v-4 M12 16V8 M17 16v-7',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M12 3v2.5 M12 18.5V21 M3 12h2.5 M18.5 12H21 M5.6 5.6l1.8 1.8 M16.6 16.6l1.8 1.8 M5.6 18.4l1.8-1.8 M16.6 7.4l1.8-1.8',
  back: 'M15 19l-7-7 7-7',
  chevron: 'M9.5 6l6 6-6 6',
  next: 'M14.5 6l-6 6 6 6',
  prev: 'M9.5 6l6 6-6 6',
  minus: 'M5 12h14',
  play: 'M8 5.5v13l10-6.5-10-6.5Z',
  stop: 'M7 7h10v10H7z',
  undo: 'M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  plus: 'M12 5v14 M5 12h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M20 20l-4-4',
  sync: 'M20 11a8 8 0 0 0-14.3-4.9L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14.3 4.9L20 16 M20 20v-4h-4',
  check: 'M5 12.5 10 17l9-10',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12 M9 7V4h6v3',
  card: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11Z M8 10h8 M8 14h5',
  wave: 'M4 10v4 M8 7v10 M12 4v16 M16 8v8 M20 11v2',
  upload: 'M12 16V4 M7 9l5-5 5 5 M5 20h14',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Z M14 6l4 4',
  text: 'M5 5h14 M5 9.5h14 M5 14h14 M5 18.5h9',
  copy: 'M9 9h10v11H9z M15 9V4H5v11h4',
  share: 'M12 15V4 M8 8l4-4 4 4 M6 11v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M11 18h2',
};

export function Icon({ name, size = 20, weight = 1.7, className }: { name: keyof typeof PATHS | string; size?: number; weight?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(PATHS[name] ?? '').split(' M').map((d, i) => (
        <path key={i} d={i ? `M${d}` : d} />
      ))}
    </svg>
  );
}
