/**
 * 表单原语层。
 *
 * 项目原本没有输入控件的共享实现：凡是没手写内联 style 的组件都会渲染成浏览器
 * 原生控件（index.css 只给 input/select 加了过渡和焦点环）。变量与条件编辑器
 * 正是这样的重灾区。这里把字段布局、控件外观、焦点态统一到 .gs-field / .gs-input
 * 系列 class，调用方只描述语义。
 *
 * 设计约束：
 * - 一律受控组件，onChange 直接给出解析后的值（number 给 number，不给 string）；
 * - 尺寸/颜色只用 index.css 的 token，不写裸数值；
 * - 无障碍标签必填 —— label 关联或 aria-label 二选一，测试也依赖它定位。
 */
import type { ReactNode } from "react";
import { useId } from "react";
import { useStudioI18n } from "../../lib/i18n";

function classes(...parts: (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ── 字段容器 ───────────────────────────────────────────────────────────

export interface FieldProps {
  label: string;
  /** 控件下方的常驻说明。错误态时被 error 取代。 */
  hint?: string;
  error?: string;
  /** 与 label 同排右侧的附加操作（如「改用表达式」）。 */
  action?: ReactNode;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

/** 标准字段：标题 + 控件 + 说明/错误。控件通过 render prop 拿到 id 与 aria 关联。 */
export function Field({ label, hint, error, action, children }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;
  return (
    <div className="gs-field">
      <div className="gs-field__head">
        <label className="gs-field__label" htmlFor={id}>{label}</label>
        {action}
      </div>
      {children({ id, describedBy: message ? messageId : undefined, invalid: error != null })}
      {message && (
        <div id={messageId} className={classes("gs-field__message", error && "gs-field__message--error")} role={error ? "alert" : undefined}>
          {message}
        </div>
      )}
    </div>
  );
}

// ── 基础控件 ───────────────────────────────────────────────────────────

interface ControlBase {
  id?: string;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}

export interface TextInputProps extends ControlBase {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onBlur?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function TextInput({ value, onChange, placeholder, describedBy, invalid, ...rest }: TextInputProps) {
  return (
    <input
      {...rest}
      className={classes("gs-input", invalid && "gs-input--invalid")}
      type="text"
      value={value}
      placeholder={placeholder}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export interface NumberInputProps extends ControlBase {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function NumberInput({ value, onChange, min, max, step, describedBy, invalid, ...rest }: NumberInputProps) {
  return (
    <input
      {...rest}
      className={classes("gs-input", "gs-input--number", invalid && "gs-input--invalid")}
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      // 空输入框读出来是 NaN；保持上一个合法值，避免把 NaN 写进项目文件。
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(next);
      }}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
  /** 可选分组标题；相同 group 的选项会聚在一个 optgroup 下。 */
  group?: string;
  disabled?: boolean;
}

export interface SelectProps extends ControlBase {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** 值不在 options 里时显示的占位项（如变量被删后残留的引用）。 */
  placeholder?: string;
}

export function Select({ value, options, onChange, placeholder, describedBy, invalid, ...rest }: SelectProps) {
  const { t } = useStudioI18n();
  const groups = new Map<string, SelectOption[]>();
  for (const option of options) {
    const key = option.group ?? "";
    const bucket = groups.get(key);
    if (bucket) bucket.push(option);
    else groups.set(key, [option]);
  }
  const missing = value !== "" && !options.some((option) => option.value === value);
  return (
    <select
      {...rest}
      className={classes("gs-input", "gs-select", (invalid || missing) && "gs-input--invalid")}
      value={value}
      aria-describedby={describedBy}
      aria-invalid={invalid || missing || undefined}
      onChange={(event) => onChange(event.target.value)}
    >
      {placeholder != null && <option value="">{placeholder}</option>}
      {missing && <option value={value}>{t("form.invalidOption", { value })}</option>}
      {[...groups].map(([group, items]) => group === ""
        ? items.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)
        : (
          <optgroup key={group} label={group}>
            {items.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
          </optgroup>
        ))}
    </select>
  );
}

export interface SwitchProps extends ControlBase {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 开关右侧的文字；不传则只显示开关本体。 */
  label?: string;
}

/** 是/否开关。取代此前要求作者手打 `true` 的文本框。 */
export function Switch({ checked, onChange, label, describedBy, ...rest }: SwitchProps) {
  return (
    <label className="gs-switch">
      <input
        {...rest}
        type="checkbox"
        role="switch"
        className="gs-switch__input"
        checked={checked}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="gs-switch__track" aria-hidden="true"><span className="gs-switch__thumb" /></span>
      {label && <span className="gs-switch__label">{label}</span>}
    </label>
  );
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  "aria-label": string;
}

/** 二到三选一的互斥开关（「玩家选择／自动分流」「全部／任一」）。 */
export function SegmentedControl<T extends string>({ value, options, onChange, disabled, ...rest }: SegmentedControlProps<T>) {
  return (
    <div className="gs-segmented" role="radiogroup" {...rest}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          disabled={disabled}
          className={classes("gs-segmented__item", option.value === value && "gs-segmented__item--active")}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface SliderProps extends ControlBase {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** 滑轨下方的刻度标记（好感度分段）。 */
  marks?: Array<{ value: number; label: string }>;
  /** 拇指右侧显示的当前值文案，默认为数字本身。 */
  valueLabel?: string;
}

export function Slider({ value, min, max, step = 1, onChange, marks, valueLabel, describedBy, ...rest }: SliderProps) {
  const span = max - min || 1;
  return (
    <div className="gs-slider">
      <div className="gs-slider__row">
        <input
          {...rest}
          type="range"
          className="gs-slider__input"
          value={value}
          min={min}
          max={max}
          step={step}
          aria-describedby={describedBy}
          aria-valuetext={valueLabel}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="gs-slider__value">{valueLabel ?? value}</span>
      </div>
      {marks && marks.length > 0 && (
        <div className="gs-slider__marks" aria-hidden="true">
          {marks.map((mark) => (
            <span key={mark.value} className="gs-slider__mark" style={{ left: `${((mark.value - min) / span) * 100}%` }}>
              {mark.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export interface StepperProps extends ControlBase {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  /** 数字前的符号提示，如 `+` / `-`。 */
  prefix?: string;
}

/** 增减步进器。让「好感度 +3」不必写成表达式。 */
export function Stepper({ value, onChange, step = 1, min, max, prefix, disabled, describedBy, ...rest }: StepperProps) {
  const { t } = useStudioI18n();
  const clamp = (next: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next));
  const label = rest["aria-label"];
  return (
    <div className="gs-stepper">
      <button
        type="button"
        className="gs-btn gs-btn--ghost gs-stepper__button"
        aria-label={label
          ? t("form.decrease", { label })
          : t("form.decreaseDefault")}
        disabled={disabled || (min != null && value <= min)}
        onClick={() => onChange(clamp(value - step))}
      >
        −
      </button>
      {prefix && <span className="gs-stepper__prefix">{prefix}</span>}
      <input
        {...rest}
        type="number"
        className="gs-input gs-stepper__input"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(clamp(next));
        }}
      />
      <button
        type="button"
        className="gs-btn gs-btn--ghost gs-stepper__button"
        aria-label={label
          ? t("form.increase", { label })
          : t("form.increaseDefault")}
        disabled={disabled || (max != null && value >= max)}
        onClick={() => onChange(clamp(value + step))}
      >
        +
      </button>
    </div>
  );
}

// ── 句子行 ─────────────────────────────────────────────────────────────

export interface SentenceRowProps {
  children: ReactNode;
  /** 行首序号或连接词（「如果」「并且」）。 */
  lead?: ReactNode;
  /** 行尾操作（删除该子句等）。 */
  trailing?: ReactNode;
}

/**
 * 把若干控件排成一句可读的话。
 *
 * 这是「句子化 UI」能成立的关键原语：控件之间用 baseline 对齐、允许整体换行
 * 但不在词内断开，于是「雪·好感度 达到 喜欢」读起来是一句话而不是三个孤立控件。
 */
export function SentenceRow({ children, lead, trailing }: SentenceRowProps) {
  return (
    <div className="gs-sentence">
      {lead != null && <span className="gs-sentence__lead">{lead}</span>}
      <span className="gs-sentence__body">{children}</span>
      {trailing != null && <span className="gs-sentence__trailing">{trailing}</span>}
    </div>
  );
}

/** 句子里的固定词（「达到」「已发生」），非交互，只做视觉连接。 */
export function SentenceWord({ children }: { children: ReactNode }) {
  return <span className="gs-sentence__word">{children}</span>;
}
