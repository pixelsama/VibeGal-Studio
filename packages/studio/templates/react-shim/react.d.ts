/**
 * VibeGal-Studio 项目自带的最小 React 类型 shim。
 *
 * 渲染层运行时由宿主（Studio 预览 / web 导出包）注入真实 React；
 * 本文件只为让 `npx tsc --noEmit` 与编辑器补全在项目目录里可用。
 * 覆盖面是渲染层常用 API；用到 shim 之外的 React API 时 tsc 会报错，
 * 可在项目里按需扩展本文件（它是项目文件，不是生成物）。
 */

declare module "react" {
  export type Key = string | number;

  export interface ReactElement {
    type: any;
    props: any;
    key: Key | null;
  }

  export type ReactNode =
    | ReactElement
    | string
    | number
    | boolean
    | null
    | undefined
    | Iterable<ReactNode>;

  export type FC<P = {}> = (props: P) => ReactElement | null;
  export type ComponentType<P = {}> = FC<P>;
  export type RefObject<T> = { current: T };

  export interface CSSProperties {
    [property: string]: string | number | undefined;
  }

  export interface SyntheticEvent<T = Element> {
    currentTarget: T;
    target: EventTarget | null;
    preventDefault(): void;
    stopPropagation(): void;
  }

  export interface MouseEvent<T = Element> extends SyntheticEvent<T> {
    clientX: number;
    clientY: number;
    button: number;
    buttons: number;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }

  export interface KeyboardEvent<T = Element> extends SyntheticEvent<T> {
    key: string;
    code: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }

  export interface FormEvent<T = Element> extends SyntheticEvent<T> {}

  export type SetStateAction<S> = S | ((previous: S) => S);
  export type Dispatch<A> = (value: A) => void;

  export function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];

  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps?: readonly unknown[]): T;

  export function useRef<T>(initialValue: T): RefObject<T>;
  export function useRef<T>(initialValue: T | null): RefObject<T | null>;
  export function useRef<T = undefined>(): RefObject<T | undefined>;

  export function useId(): string;
  export function useSyncExternalStore<T>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T;

  export function memo<P>(Component: ComponentType<P>, propsAreEqual?: (previous: P, next: P) => boolean): ComponentType<P>;

  export function createElement(type: any, props?: any, ...children: any[]): ReactElement;
  export const Fragment: (props: { children?: ReactNode }) => ReactElement | null;

  const React: {
    createElement: typeof createElement;
    Fragment: typeof Fragment;
    useState: typeof useState;
    useEffect: typeof useEffect;
    useLayoutEffect: typeof useLayoutEffect;
    useMemo: typeof useMemo;
    useCallback: typeof useCallback;
    useRef: typeof useRef;
    useId: typeof useId;
    useSyncExternalStore: typeof useSyncExternalStore;
    memo: typeof memo;
  };
  export default React;
}

/** React 命名空间全局引用（如 React.CSSProperties），与 @types/react 的 UMD 形态对齐。 */
declare namespace React {
  type FC<P = {}> = import("react").FC<P>;
  type ComponentType<P = {}> = import("react").ComponentType<P>;
  type RefObject<T> = import("react").RefObject<T>;
  type CSSProperties = import("react").CSSProperties;
  type ReactElement = import("react").ReactElement;
  type ReactNode = import("react").ReactNode;
  type SyntheticEvent<T = Element> = import("react").SyntheticEvent<T>;
  type MouseEvent<T = Element> = import("react").MouseEvent<T>;
  type KeyboardEvent<T = Element> = import("react").KeyboardEvent<T>;
  type FormEvent<T = Element> = import("react").FormEvent<T>;
}

declare module "react/jsx-runtime" {
  import type { ReactElement, ReactNode, MouseEvent, KeyboardEvent, FormEvent } from "react";

  type AnyEventHandler = (event: any) => void;

  /** DOM 元素 props：已知事件 handler 有上下文类型，其余 on* 兜底为 any-handler，普通属性放行。 */
  interface DOMElementProps {
    [prop: string]: any;
    [handler: `on${string}`]: AnyEventHandler | undefined;
    children?: ReactNode;
    onClick?: (event: MouseEvent<any>) => void;
    onDoubleClick?: (event: MouseEvent<any>) => void;
    onMouseDown?: (event: MouseEvent<any>) => void;
    onMouseUp?: (event: MouseEvent<any>) => void;
    onMouseMove?: (event: MouseEvent<any>) => void;
    onMouseEnter?: (event: MouseEvent<any>) => void;
    onMouseLeave?: (event: MouseEvent<any>) => void;
    onContextMenu?: (event: MouseEvent<any>) => void;
    onKeyDown?: (event: KeyboardEvent<any>) => void;
    onKeyUp?: (event: KeyboardEvent<any>) => void;
    onChange?: (event: FormEvent<any>) => void;
    onInput?: (event: FormEvent<any>) => void;
    onSubmit?: (event: FormEvent<any>) => void;
  }

  export const Fragment: (props: { children?: ReactNode }) => ReactElement | null;
  export function jsx(type: any, props: any, key?: any): ReactElement;
  export function jsxs(type: any, props: any, key?: any): ReactElement;

  export namespace JSX {
    type Element = any;
    interface IntrinsicElements {
      [elementName: string]: DOMElementProps;
    }
    interface IntrinsicAttributes {
      key?: string | number | null;
    }
    interface ElementChildrenAttribute {
      children: {};
    }
  }
}

declare module "react/jsx-dev-runtime" {
  import type { ReactElement, ReactNode } from "react";

  export const Fragment: (props: { children?: ReactNode }) => ReactElement | null;
  export function jsx(type: any, props: any, key?: any): ReactElement;
  export function jsxs(type: any, props: any, key?: any): ReactElement;
  export function jsxDEV(type: any, props: any, key?: any, isStaticChildren?: boolean, source?: any, self?: any): ReactElement;

  export namespace JSX {
    type Element = any;
    interface IntrinsicElements {
      [elementName: string]: import("react/jsx-runtime").JSX.IntrinsicElements[string];
    }
    interface IntrinsicAttributes {
      key?: string | number | null;
    }
    interface ElementChildrenAttribute {
      children: {};
    }
  }
}

declare module "react-dom" {
  export function createPortal(children: any, container: Element | DocumentFragment, key?: any): any;
  export function flushSync<T>(fn: () => T): T;
}

declare module "react-dom/client" {
  export interface Root {
    render(children: any): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment | null, options?: any): Root;
  export function hydrateRoot(container: Element | Document, initialChildren: any, options?: any): Root;
}
