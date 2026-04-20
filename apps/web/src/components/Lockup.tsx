import "./Lockup.css";

type Props = {
  size?: number;
  variant?: "mark" | "lockup";
};

export default function Lockup({ size = 32, variant = "lockup" }: Props) {
  if (variant === "mark") {
    return (
      <svg
        className="obelus-lockup"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 64"
        width={size}
        height={size}
        role="img"
        aria-label="Obelus"
      >
        <title>Obelus</title>
        <g fill="var(--rubric)">
          <ellipse cx="32" cy="18.4" rx="3.9" ry="3.6" />
          <path d="M10.5,31.3 C12,30.9 18.6,30.8 32,30.8 C45.4,30.8 52,30.9 53.5,31.3 C53.8,31.9 53.8,32.6 53.5,33.2 C52,33.6 45.4,33.7 32,33.7 C18.6,33.7 12,33.6 10.5,33.2 C10.2,32.6 10.2,31.9 10.5,31.3 Z" />
          <ellipse cx="32" cy="46.1" rx="3.7" ry="3.9" />
        </g>
      </svg>
    );
  }
  const height = size;
  const width = size * 4;
  return (
    <svg
      className="obelus-lockup"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 320 80"
      width={width}
      height={height}
      role="img"
      aria-label="Obelus"
    >
      <title>Obelus</title>
      <g fill="var(--rubric)" transform="translate(8,8)">
        <ellipse cx="32" cy="18.4" rx="3.9" ry="3.6" />
        <path d="M10.5,31.3 C12,30.9 18.6,30.8 32,30.8 C45.4,30.8 52,30.9 53.5,31.3 C53.8,31.9 53.8,32.6 53.5,33.2 C52,33.6 45.4,33.7 32,33.7 C18.6,33.7 12,33.6 10.5,33.2 C10.2,32.6 10.2,31.9 10.5,31.3 Z" />
        <ellipse cx="32" cy="46.1" rx="3.7" ry="3.9" />
      </g>
      <text
        x="96"
        y="52"
        fill="var(--ink)"
        fontFamily="var(--font-display)"
        fontSize="44"
        fontWeight="400"
        fontStyle="italic"
        letterSpacing="0.5"
      >
        Obelus
      </text>
    </svg>
  );
}
