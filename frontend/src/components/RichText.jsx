import { Link } from 'react-router';

// Transforma @menções em links de perfil, preservando o resto do texto.
export default function RichText({ text }) {
  const parts = text.split(/(@[A-Za-z0-9_]{3,20})/g);
  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        /^@[A-Za-z0-9_]{3,20}$/.test(part) ? (
          <Link key={i} to={`/u/${part.slice(1)}`} className="text-brand-600 hover:underline" onClick={(e) => e.stopPropagation()}>
            {part}
          </Link>
        ) : (
          part
        ),
      )}
    </p>
  );
}
