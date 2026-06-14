interface IconProps {
  name: string;
  size?: number;
  className?: string;
  filled?: boolean;
}

export function Icon({ name, size = 24, className = '', filled }: IconProps) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{
        fontSize: size,
        fontVariationSettings: filled ? "'FILL' 1" : undefined,
      }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
