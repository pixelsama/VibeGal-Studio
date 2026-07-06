/**
 * 共享按钮原语。
 *
 * 颜色 / 悬停 / 焦点 / 按下 / 禁用等状态统一由 index.css 的 .gs-btn 系列
 * class 承担（内联 style 写不了伪类），调用方只在需要时用 style 覆盖布局
 * （padding / 字号 / 宽高等）。这样各处按钮外观一致，也补齐了键盘焦点环。
 */
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

function classes(...parts: (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(" ");
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = "secondary", type = "button", className, ...rest }: ButtonProps) {
  return <button type={type} className={classes("gs-btn", `gs-btn--${variant}`, className)} {...rest} />;
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** 方形边长（含边框），默认 28。 */
  size?: number;
  /** 图标按钮无文本，无障碍标签必填。 */
  "aria-label": string;
}

export function IconButton({
  variant = "ghost",
  size = 28,
  type = "button",
  className,
  style,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={classes("gs-btn", "gs-icon-btn", `gs-btn--${variant}`, className)}
      style={{ width: size, height: size, ...style }}
      {...rest}
    />
  );
}
