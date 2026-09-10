const control = require('./desktopControls');
class AudioService {
    async run(operation, value) {
        const result = await control('audio', operation, value);
        if (result.ok) result.message = operation === 'mute'
            ? (result.muted ? 'Audio silenciado.' : 'Audio activado.')
            : 'Volumen al ' + result.volume + '%.';
        return result;
    }
    getVolume() { return this.run('get'); }
    setVolume(percent) { return this.run('set', percent); }
    adjustVolume(delta) { return this.run('adjust', delta); }
    toggleMute() { return this.run('mute'); }
}
module.exports = new AudioService();
