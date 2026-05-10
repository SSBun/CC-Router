import { randomBytes } from "node:crypto";

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function generateMessageId(): string {
  return `msg_${randomHex(16)}`;
}

export function generateToolUseId(): string {
  return `toolu_${randomHex(16)}`;
}
