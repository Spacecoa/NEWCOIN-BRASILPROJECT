// Ícones em traço fino e uma só cor (herdam currentColor). Substituem os emoji da interface.
const PATHS = {
  home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3-4.3-4.3',
  at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm0 0v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
  channels: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8.5c.8-3.4 3.6-5.5 7-5.5s6.2 2.1 7 5.5',
  reply: 'M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z',
  repost: 'M7 7h10.5a2.5 2.5 0 0 1 2.5 2.5V12M17 17H6.5A2.5 2.5 0 0 1 4 14.5V12m12-8 3 3-3 3M8 20l-3-3 3-3',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z',
  trash: 'M5 7h14M10 7V5h4v2m-7 0 .8 12a1 1 0 0 0 1 .9h6.4a1 1 0 0 0 1-.9L17 7',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'M15 5l-7 7 7 7',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10',
  megaphone: 'M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1zm12-1.5a4 4 0 0 1 0 7',
  sliders: 'M4 7h9m4 0h3M4 17h3m4 0h9M15 5v4M9 15v4',
  check: 'M5 12.5 10 17l9-10',
  sprout: 'M12 21v-9m0 0C12 8 9.5 5.5 5 5.5 5 9.5 7.5 12 12 12zm0 0c0-3.2 2.1-5.8 6.5-5.8 0 3.2-2.1 5.8-6.5 5.8',
  circle: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-3.5-7a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01',
};

export default function Icon({ name, filled = false, className = 'h-5 w-5' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
