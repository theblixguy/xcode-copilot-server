import type { FastifyReply } from "fastify";

export class ReplyTracker {
  private reply: FastifyReply | null = null;
  private streamingDone: (() => void) | null = null;

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
    if (this.streamingDone) {
      this.streamingDone();
      this.streamingDone = null;
    }
  }

  waitForStreamingDone(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.streamingDone = resolve;
    });
  }
}
