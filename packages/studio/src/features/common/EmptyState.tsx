/**
 * EmptyState —— 引导性空态：图标 + 标题 + 说明 + 可选主操作。
 *
 * 视觉由 index.css 的 .gs-empty 系列 class 承担。
 * 用于项目列表、空画布、资产空分类等「这里什么都没有」的场景，
 * 比一行灰字更能引导下一步操作。
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  /** 主操作区（一个或多个按钮）。 */
  action?: ReactNode;
  iconSize?: number;
}

export function EmptyState({ icon: Icon, title, description, action, iconSize = 32 }: EmptyStateProps) {
  return (
    <div className="gs-empty">
      <div className="gs-empty__icon">
        <Icon size={iconSize} strokeWidth={1.5} />
      </div>
      <div className="gs-empty__title">{title}</div>
      {description != null && <div className="gs-empty__desc">{description}</div>}
      {action != null && <div className="gs-empty__actions">{action}</div>}
    </div>
  );
}
