/**
 * 剧本帧结构映射（纯函数）。
 *
 * 复刻 engine parseScenarioText 的帧语义：空行 = 帧边界，
 * 帧内有非阻塞指令且未被 @continue 抑制时在该空行处补一条隐式 pause。
 *
 * Spec 35 Phase 2：choice / if 块整体算作一条顶层指令。块头行、option 行、
 * body 行、@to / @effects 行都映射到该块的顶层指令下标，使得选中块内任意行
 * 都会高亮整块、预览从该块起跑、拖拽移动整块。
 *
 * 产出两份映射供编辑器使用：
 * - implicitPauseLines：哪些空行会产生隐式停顿（gutter 标记）；
 * - startIndexByLine：每一行「从该行起跑预览」对应的指令下标；
 * - instructionIndexByLine：每行对应的真实/隐式指令下标；@continue 和无效行记为 null；
 * - lineByInstructionIndex：每条指令格式化后所在的行号（1 起始）。
 * - blockHeaderByLine：choice / if 块头所在的行号集合（gutter 块标记 / 重排边界）。
 */
import { isBlockingInstruction, parseScenarioLine } from "@vibegal/engine";

export interface ScenarioFrameMap {
  /** 产生隐式停顿的空行行号（1 起始）。 */
  implicitPauseLines: number[];
  /** 每行（0 起始下标）的起跑指令下标；等于指令总数表示节点末尾。 */
  startIndexByLine: number[];
  /** 每行对应的真实/隐式指令下标；@continue 和无效行记为 null。 */
  instructionIndexByLine: Array<number | null>;
  /** 每条指令格式化后所在的行号（1 起始）。 */
  lineByInstructionIndex: number[];
  /** choice / if 块头所在的行号（1 起始），用于重排时识别整块边界。 */
  blockHeaderLines: number[];
}

/** 行首缩进的展开宽度：tab = 4，空格原值。 */
function indentWidth(raw: string): number {
  let width = 0;
  for (const ch of raw) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4;
    else break;
  }
  return width;
}

export function mapScenarioFrames(text: string): ScenarioFrameMap {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const implicitPauseLines: number[] = [];
  const startIndexByLine: number[] = [];
  const instructionIndexByLine: Array<number | null> = [];
  const lineByInstructionIndex: number[] = [];
  const blockHeaderLines: number[] = [];
  let instructionCount = 0;
  let frameHasBlocking = false;
  let frameHasAny = false;
  let frameSuppress = false;
  // 当前打开的块：块头缩进；缩进 > 该值的行属于该块（除非开了新块）。
  // 嵌套块用栈处理；每条顶层指令在下推块头前先登记 instructionCount。
  const blockStack: Array<{ indent: number; topIndex: number }> = [];

  /** 当前行属于哪条顶层指令：栈空则为 instructionCount（待登记），否则为栈顶 topIndex。 */
  const currentTopIndex = () => (blockStack.length > 0 ? blockStack[blockStack.length - 1].topIndex : instructionCount);

  lines.forEach((raw, index) => {
    const line = raw.trim();
    const indent = indentWidth(raw);

    if (line.length === 0) {
      // 空行只在顶层（块栈空）作为帧边界。
      if (blockStack.length === 0) {
        if (frameHasAny && !frameHasBlocking && !frameSuppress) {
          implicitPauseLines.push(index + 1);
          startIndexByLine.push(instructionCount);
          instructionIndexByLine.push(instructionCount);
          lineByInstructionIndex.push(index + 1);
          instructionCount += 1;
        } else {
          startIndexByLine.push(instructionCount);
          instructionIndexByLine.push(null);
        }
        frameHasBlocking = false;
        frameHasAny = false;
        frameSuppress = false;
      } else {
        // 块内空行：不触发帧，归属当前块。
        startIndexByLine.push(currentTopIndex());
        instructionIndexByLine.push(currentTopIndex());
      }
      return;
    }

    // 弹出缩进 <= 当前的块（块结束）。else 与 if 同缩进，但属于同一块，
    // 故先识别 else 并跳过弹出（else 仍归属打开的 if 块）。
    const trimmedForPeek = line;
    const isElse = /^else(?:\s|$)/.test(trimmedForPeek);
    if (!isElse) {
      while (blockStack.length > 0 && blockStack[blockStack.length - 1].indent >= indent) {
        blockStack.pop();
      }
    }

    const parsed = parseScenarioLine(line);
    // 块头行：choice / if
    if (parsed.ok && (parsed.block === "choice" || parsed.block === "if")) {
      // 块头算作一条顶层指令（在块栈为空时登记；嵌套块的块头则属于父块，
      // 但当前帧语义只关心顶层，嵌套块头不会单独计入 instructionCount）。
      if (blockStack.length === 0) {
        blockHeaderLines.push(index + 1);
        // 先登记帧内可能的隐式 pause？不——块头本身登记为指令。
        startIndexByLine.push(instructionCount);
        instructionIndexByLine.push(instructionCount);
        lineByInstructionIndex.push(index + 1);
        blockStack.push({ indent, topIndex: instructionCount });
        instructionCount += 1;
        frameHasAny = true;
        // choice / if 不是 blocking。
      } else {
        // 嵌套块头：归到父块的 topIndex。
        startIndexByLine.push(currentTopIndex());
        instructionIndexByLine.push(currentTopIndex());
        blockStack.push({ indent, topIndex: currentTopIndex() });
      }
      return;
    }

    if (parsed.ok) {
      if (parsed.suppressesImplicitPause) frameSuppress = true;
      if (parsed.instruction) {
        // 普通叶子指令：栈空时计为顶层指令；块内时归属父块。
        if (blockStack.length === 0) {
          startIndexByLine.push(instructionCount);
          instructionIndexByLine.push(instructionCount);
          lineByInstructionIndex.push(index + 1);
          instructionCount += 1;
          frameHasAny = true;
          if (isBlockingInstruction(parsed.instruction)) frameHasBlocking = true;
        } else {
          startIndexByLine.push(currentTopIndex());
          instructionIndexByLine.push(currentTopIndex());
        }
        return;
      }
      // parsed.block === "else" 或其它无指令标记行
      if (parsed.ok && parsed.block === "else") {
        // else 行归属当前 if 块；不弹栈（else 与 if 同缩进已被上面的弹出处理）。
        startIndexByLine.push(currentTopIndex());
        instructionIndexByLine.push(currentTopIndex());
        return;
      }
    }
    // @continue / 块内的 @to / @effects / 无效行
    if (blockStack.length > 0) {
      startIndexByLine.push(currentTopIndex());
      instructionIndexByLine.push(currentTopIndex());
    } else {
      startIndexByLine.push(instructionCount);
      instructionIndexByLine.push(null);
    }
  });

  return {
    implicitPauseLines,
    startIndexByLine,
    instructionIndexByLine,
    lineByInstructionIndex,
    blockHeaderLines,
  };
}
