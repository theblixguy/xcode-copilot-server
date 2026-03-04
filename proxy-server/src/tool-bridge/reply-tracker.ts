import type { FastifyReply } from "fastify";

export class ReplyTracker {
  private reply: FastifyReply | null = null;
  private streamingDoneCallbacks: (() => void)[] = [];

  get currentReply(): FastifyReply | null {
    return this.reply;
  }

  setReply(reply: FastifyReply): void {
    this.reply = reply;
  }

  clearReply(): void {
    this.reply = null;
  }

  notifyStreamingDone(): void {
    const callbacks = this.streamingDoneCallbacks;
    this.streamingDoneCallbacks = [];
    for (const cb of callbacks) cb();
  }

  waitForStreamingDone(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.streamingDoneCallbacks.push(resolve);
    });
  }
}
