import { initials, hashHue } from '../lib/format';

// Circular initials avatar with a stable colour derived from the person.
export function Avatar({
  name,
  id,
  size = 26,
}: {
  name: string;
  id?: string | null;
  size?: number;
}) {
  const seed = id ?? name;
  const hue = hashHue(seed);
  return (
    <span
      className="avatar"
      title={name}
      style={{
        width: size,
        height: size,
        background: `hsl(${hue} 58% 92%)`,
        color: `hsl(${hue} 42% 34%)`,
        fontSize: Math.round(size * 0.4),
      }}
    >
      {initials(name)}
    </span>
  );
}
