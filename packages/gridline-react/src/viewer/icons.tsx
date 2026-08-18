import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      viewBox="0 0 24 24"
      width="18"
      {...props}
    >
      {children}
    </svg>
  );
}

const stroke = {
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.7,
};

export function FolderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 6.8h6l1.7 2h9.3v8.7a2 2 0 0 1-2 2h-15z" {...stroke} />
      <path d="M3.5 6.8v-.3a2 2 0 0 1 2-2h3l1.8 2.3" {...stroke} />
    </Icon>
  );
}

export function ExportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 15V3.8m0 0L8.3 7.5M12 3.8l3.7 3.7" {...stroke} />
      <path d="M5 11.5v7.2h14v-7.2" {...stroke} />
    </Icon>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.2 7.2H4.5v-3.7" {...stroke} />
      <path d="M4.8 7A8.5 8.5 0 1 1 4 14" {...stroke} />
    </Icon>
  );
}

export function RedoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15.8 7.2h3.7v-3.7" {...stroke} />
      <path d="M19.2 7A8.5 8.5 0 1 0 20 14" {...stroke} />
    </Icon>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m8.5 10 3.5 3.5 3.5-3.5" {...stroke} />
    </Icon>
  );
}

export function CollapseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m14.5 7-5 5 5 5" {...stroke} />
      <path d="M19 5v14" {...stroke} />
    </Icon>
  );
}

export function SheetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="17" rx="1" width="17" x="3.5" y="3.5" {...stroke} />
      <path d="M3.5 9h17M9 3.5v17" {...stroke} />
    </Icon>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="5" fill="currentColor" r="1.2" />
      <circle cx="12" cy="12" fill="currentColor" r="1.2" />
      <circle cx="12" cy="19" fill="currentColor" r="1.2" />
    </Icon>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 7h14M5 12h14M5 17h14" {...stroke} />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" {...stroke} />
    </Icon>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" {...stroke} />
    </Icon>
  );
}

