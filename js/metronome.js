// Metronome class for keeping time

export class Metronome {
    constructor(audioContext, bpm = 100, volume = 0.5) {
        this.audioContext = audioContext;
        this.bpm = bpm;
        this.volume = volume;
        this.running = false;
        this.interval = null;
        this.currentBeat = 0;
    }

    playClick(time, isLoudBeat = false) {
        if (!this.audioContext) return;
        
        // Create a more percussive, wooden click sound
        // Use a combination of noise burst and short tone
        
        // Main click - short burst of noise filtered to sound like wood
        const bufferSize = this.audioContext.sampleRate * 0.01; // 10ms
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        
        // Generate filtered noise (simulates wooden click)
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
        }
        
        const noiseSource = this.audioContext.createBufferSource();
        const noiseGain = this.audioContext.createGain();
        const filter = this.audioContext.createBiquadFilter();
        
        noiseSource.buffer = buffer;
        filter.type = 'bandpass';
        filter.frequency.value = isLoudBeat ? 1200 : 800;
        filter.Q.value = 2;
        
        // Volume: loud beat is higher, quiet beats are louder now
        const baseVolume = isLoudBeat ? 0.4 : 0.3; // Increased quiet beats from 0.15 to 0.3
        const volume = baseVolume * this.volume;
        
        noiseGain.gain.setValueAtTime(0, time);
        noiseGain.gain.linearRampToValueAtTime(volume, time + 0.001);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, time + 0.01);
        
        noiseSource.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.audioContext.destination);
        
        noiseSource.start(time);
        noiseSource.stop(time + 0.01);
        
        // Add a subtle tone for the loud beat
        if (isLoudBeat) {
            const toneOsc = this.audioContext.createOscillator();
            const toneGain = this.audioContext.createGain();
            
            toneOsc.type = 'sine';
            toneOsc.frequency.value = 800;
            
            toneGain.gain.setValueAtTime(0, time);
            toneGain.gain.linearRampToValueAtTime(volume * 0.3, time + 0.001);
            toneGain.gain.exponentialRampToValueAtTime(0.01, time + 0.02);
            
            toneOsc.connect(toneGain);
            toneGain.connect(this.audioContext.destination);
            
            toneOsc.start(time);
            toneOsc.stop(time + 0.02);
        }
    }

    start() {
        if (this.running) return;
        
        this.running = true;
        let nextBeat = this.audioContext.currentTime;
        let beatInMeasure = 0; // 0-3, where 0 is the loud beat
        
        const scheduleBeat = () => {
            if (!this.running) return;
            
            // Recalculate beat duration dynamically based on current BPM
            const beatDuration = 60 / this.bpm;
            
            // Schedule click sound - loud on beat 0, quiet on beats 1-3
            const clickTime = nextBeat;
            const isLoudBeat = (beatInMeasure === 0);
            this.playClick(clickTime, isLoudBeat);
            
            // Visual indicator - brighter for loud beat
            const indicator = document.getElementById('metronomeIndicator');
            if (indicator) {
                indicator.classList.add('active');
                if (isLoudBeat) {
                    indicator.style.boxShadow = '0 0 15px #f5576c';
                } else {
                    indicator.style.boxShadow = '0 0 5px #f5576c';
                }
                setTimeout(() => {
                    indicator.classList.remove('active');
                    indicator.style.boxShadow = '';
                }, 50);
            }
            
            this.currentBeat++;
            beatInMeasure = (beatInMeasure + 1) % 4; // Cycle 0-3
            nextBeat += beatDuration;
            
            // Schedule next beat
            const delay = (nextBeat - this.audioContext.currentTime) * 1000;
            this.interval = setTimeout(scheduleBeat, Math.max(0, delay));
        };
        
        scheduleBeat();
    }

    stop() {
        this.running = false;
        if (this.interval) {
            clearTimeout(this.interval);
            this.interval = null;
        }
    }

    setBPM(bpm) {
        const wasRunning = this.running;
        this.bpm = bpm;
        if (wasRunning) {
            this.stop();
            this.start();
        }
    }

    setVolume(volume) {
        this.volume = volume;
    }
}
