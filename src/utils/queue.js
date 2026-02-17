// ===== QUEUE DE MESSAGES =====
class MessageQueue {
  constructor(concurrency = 1) {
    this.queue = [];
    this.running = 0;
    this.concurrency = concurrency;
  }

  add(task) {
    this.queue.push(task);
    this.process();
  }

  async process() {
    if (this.running >= this.concurrency || this.queue.length === 0) {
      return;
    }

    this.running++;
    const task = this.queue.shift();

    try {
      await task();
    } catch (error) {
      console.error('Erreur dans la queue:', error);
    } finally {
      this.running--;
      this.process();
    }
  }
}

module.exports = MessageQueue;
