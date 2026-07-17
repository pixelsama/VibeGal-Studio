/**
 * 剧本帧结构映射（纯函数）。
 *
 * 复刻 engine parseScenarioText 的帧语义：空行 = 帧边界，
 * 帧内有非阻塞指令且未被 @continue 抑制时在该空行处补一条隐式 pause。
 * 产出两份映射供编辑器使用：
 * - implicitPauseLines：哪些空行会产生隐式停顿（gutter 标记）；
 * - startIndexByLine：每一行“从该行起跑预览”对应的指令下标。
 */
import { isBlockingInstruction, parseScenarioLine } from "@vibegal/engine";

export interface ScenarioFrameMap {
  /** 产生隐式停顿的空行行号（1 起始）。 */
  implicitPauseLines: number[];
  /** 每行（0 起始下标）的起跑指令下标；等于指令总数表示节点末尾。 */
  startIndexByLine: number[];
}

export function mapScenarioFrames(text: string): ScenarioFrameMap {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const implicitPauseLines: number[] = [];
  const startIndexByLine: number[] = [];
  let instructionCount = 0;
  let frameHasBlocking = false;
  let frameHasAny = false;
  let frameSuppress = false;

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line.length === 0) {
      if (frameHasAny && !frameHasBlocking && !frameSuppress) {
        // 该空行触发隐式停顿：从这条 pause 起跑
        implicitPauseLines.push(index + 1);
        startIndexByLine.push(instructionCount);
        instructionCount += 1;
      } else {
        // 空帧或被抑制的帧：从后续指令起跑
        startIndexByLine.push(instructionCount);
      }
      frameHasBlocking = false;
      frameHasAny = false;
      frameSuppress = false;
      return;
    }

    const parsed = parseScenarioLine(line);
    if (parsed.ok) {
      if (parsed.suppressesImplicitPause) frameSuppress = true;
      if (parsed.instruction) {
        startIndexByLine.push(instructionCount);
        instructionCount += 1;
        frameHasAny = true;
        if (isBlockingInstruction(parsed.instruction)) frameHasBlocking = true;
        return;
      }
    }
    // @continue 或无法解析的行不产生指令：从后续指令起跑
    startIndexByLine.push(instructionCount);
  });

  return { implicitPauseLines, startIndexByLine };
}
