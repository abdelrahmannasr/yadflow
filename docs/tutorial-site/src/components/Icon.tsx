interface IconProps {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  fill?: boolean;
}

/** Material Symbols Outlined icon (font loaded in index.html). */
export function Icon({ name, size = 20, className, style, fill }: IconProps) {
  return (
    <span
      className={`material-symbols-outlined select-none ${className ?? ''}`}
      style={{
        fontSize: size,
        fontVariationSettings: fill ? "'FILL' 1" : "'FILL' 0",
        ...style,
      }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
