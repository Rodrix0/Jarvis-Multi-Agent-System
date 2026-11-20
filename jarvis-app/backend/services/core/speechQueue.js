// One output device, one sentence at a time. Only an explicit stop cancels speech.
class SpeechQueue {
    constructor(play) { this.play = play; this.items = []; this.active = null; }
    speak(text, voice) {
        text = String(text || '').trim();
        if (!text) return Promise.resolve({ skipped: true });
        return new Promise((resolve, reject) => {
            this.items.push({ text, voice, resolve, reject, controller: new AbortController() });
            this.drain();
        });
    }
    stop() {
        const stopped = Boolean(this.active || this.items.length);
        for (const item of this.items.splice(0)) item.resolve({ cancelled: true });
        this.active?.controller.abort();
        return stopped;
    }
    isPlaying() { return Boolean(this.active || this.items.length); }
    async drain() {
        if (this.active || !this.items.length) return;
        const item = this.active = this.items.shift();
        try { item.resolve(await this.play(item.text, item.voice, item.controller.signal)); }
        catch (error) { item.reject(error); }
        finally { this.active = null; this.drain(); }
    }
}
module.exports = SpeechQueue;
