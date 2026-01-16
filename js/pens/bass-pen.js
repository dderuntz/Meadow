// Pen 2: 303-style bass with pattern ••--|•--•|•-•-|•--•|

import { Pen } from '../pen.js';

export class BassPen extends Pen {
    constructor(audioContext, bpm) {
        super(2, audioContext, bpm);
        // 32-step pattern (2 measures): •-------|•-------|•-------|•---•↑--|
        // Half-timed for long decay trails
        // Format: { play: bool, duration: number of sixteenth notes, octaveUp: bool }
        this.pattern = [
            { play: 1, duration: 1 },  // •
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 1, duration: 1 },  // •
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 1, duration: 1 },  // •
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 1, duration: 1 },  // •
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 1, duration: 1, octaveUp: true },  // • (octave up)
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 },  // -
            { play: 0, duration: 1 }   // -
        ];
        this.currentNote = null;
        this.oscillator = null;
        this.filter = null;
        this.gain = null;
        this.patternIndex = 0;
        this.octaveDrop = 3; // 0-3 octaves down, default 3
        this.volume = 0.7; // 0-1 range
        this.filterCutoff = 800; // Hz, base/resting filter frequency
        this.filterResonance = 16; // Q value
        this.decay = 1.0; // 0.3-1.0 range, how long notes trail
        this.envAmount = 2600; // 0-4000, how much filter opens on each note (sweep)
        this.squelchMode = true; // Toggle for squelchy preset
        this.scheduleTimeout = null; // Track timeout for cleanup
        this.setupControls();
    }

    setupControls() {
        const volumeSlider = document.getElementById('pen2VolumeSlider');
        const volumeValue = document.getElementById('pen2VolumeValue');
        const decaySlider = document.getElementById('pen2DecaySlider');
        const decayValue = document.getElementById('pen2DecayValue');
        const cutoffSlider = document.getElementById('pen2CutoffSlider');
        const cutoffValue = document.getElementById('pen2CutoffValue');
        const resonanceSlider = document.getElementById('pen2ResonanceSlider');
        const resonanceValue = document.getElementById('pen2ResonanceValue');

        if (volumeSlider && volumeValue) {
            volumeSlider.addEventListener('input', (e) => {
                this.volume = parseInt(e.target.value) / 100;
                volumeValue.textContent = `${parseInt(e.target.value)}%`;
            });
        }
        
        const octaveSlider = document.getElementById('pen2OctaveSlider');
        const octaveValue = document.getElementById('pen2OctaveValue');
        if (octaveSlider && octaveValue) {
            octaveSlider.addEventListener('input', (e) => {
                this.octaveDrop = parseInt(e.target.value);
                octaveValue.textContent = `-${e.target.value}`;
            });
        }
        
        if (decaySlider && decayValue) {
            decaySlider.addEventListener('input', (e) => {
                this.decay = parseInt(e.target.value) / 100;
                decayValue.textContent = `${parseInt(e.target.value)}%`;
            });
        }
        
        if (cutoffSlider && cutoffValue) {
            cutoffSlider.addEventListener('input', (e) => {
                this.filterCutoff = parseInt(e.target.value);
                cutoffValue.textContent = `${e.target.value}Hz`;
                // Update filter in real-time if playing
                if (this.filter) {
                    this.filter.frequency.setValueAtTime(this.filterCutoff, this.audioContext.currentTime);
                }
            });
        }
        
        if (resonanceSlider && resonanceValue) {
            resonanceSlider.addEventListener('input', (e) => {
                this.filterResonance = parseInt(e.target.value);
                resonanceValue.textContent = e.target.value;
                // Update filter in real-time if playing
                if (this.filter) {
                    this.filter.Q.setValueAtTime(this.filterResonance, this.audioContext.currentTime);
                }
            });
        }
        
        const sweepSlider = document.getElementById('pen2SweepSlider');
        const sweepValue = document.getElementById('pen2SweepValue');
        
        if (sweepSlider && sweepValue) {
            sweepSlider.addEventListener('input', (e) => {
                this.envAmount = parseInt(e.target.value);
                sweepValue.textContent = `${e.target.value}Hz`;
            });
        }
        
        // Squelch toggle - applies preset squelchy settings
        const squelchToggle = document.getElementById('pen2SquelchToggle');
        const squelchLabel = squelchToggle?.nextElementSibling;
        if (squelchToggle) {
            squelchToggle.addEventListener('change', (e) => {
                this.squelchMode = e.target.checked;
                if (squelchLabel) squelchLabel.textContent = this.squelchMode ? 'On' : 'Off';
                if (this.squelchMode) {
                    // Squelchy preset
                    this.filterCutoff = 800;
                    this.filterResonance = 16;
                    this.envAmount = 2600;
                } else {
                    // Normal preset
                    this.filterCutoff = 3000;
                    this.filterResonance = 6;
                    this.envAmount = 1400;
                }
                // Update sliders to match
                if (cutoffSlider) { cutoffSlider.value = this.filterCutoff; cutoffValue.textContent = `${this.filterCutoff}Hz`; }
                if (resonanceSlider) { resonanceSlider.value = this.filterResonance; resonanceValue.textContent = this.filterResonance; }
                if (sweepSlider) { sweepSlider.value = this.envAmount; sweepValue.textContent = `${this.envAmount}Hz`; }
                // Update filter in real-time if playing
                if (this.filter) {
                    this.filter.frequency.setValueAtTime(this.filterCutoff, this.audioContext.currentTime);
                    this.filter.Q.setValueAtTime(this.filterResonance, this.audioContext.currentTime);
                }
            });
        }
    }

    getAdjustedFrequency(frequency) {
        return frequency / Math.pow(2, this.octaveDrop);
    }

    onTileEnter(tile) {
        if (!tile || !tile.dataset || !tile.dataset.frequency) return;
        const frequency = parseFloat(tile.dataset.frequency);
        if (isNaN(frequency)) return;
        this.currentNote = frequency;
        this.startBassPattern();
    }

    onTileStay(tile) {
        if (!tile || !tile.dataset || !tile.dataset.frequency) return;
        const frequency = parseFloat(tile.dataset.frequency);
        if (isNaN(frequency)) return;
        if (frequency !== this.currentNote) {
            // Shift to new note (pass base frequency, shiftToNote will adjust)
            this.currentNote = frequency;
            this.shiftToNote(frequency);
        }
    }

    onTileLeave() {
        this.stopBass();
    }

    startBassPattern() {
        // Ensure audio context is available
        if (!this.audioContext && window.musicPlayer && window.musicPlayer.audioContext) {
            this.audioContext = window.musicPlayer.audioContext;
        }
        
        if (!this.audioContext || this.audioContext.state !== 'running') return;
        if (!this.currentNote) return;
        
        // Stop any existing bass before starting new one
        if (this.oscillator) {
            try {
                this.oscillator.stop();
            } catch (e) {
                // Oscillator might already be stopped
            }
            this.oscillator = null;
        }
        
        // Create 303-style bass sound
        this.oscillator = this.audioContext.createOscillator();
        this.filter = this.audioContext.createBiquadFilter();
        this.gain = this.audioContext.createGain();
        
        // Oscillator - sawtooth for 303 sound
        const adjustedFreq = this.getAdjustedFrequency(this.currentNote);
        this.oscillator.type = 'sawtooth';
        this.oscillator.frequency.value = adjustedFreq;
        
        // Filter - envelope will modulate this on each note
        this.filter.type = 'lowpass';
        this.filter.frequency.value = this.filterCutoff; // Resting frequency
        this.filter.Q.value = this.filterResonance; // High resonance for squelch
        
        // Gain envelope
        this.gain.gain.setValueAtTime(0, this.audioContext.currentTime);
        
        // Connect: oscillator -> filter -> gain
        this.oscillator.connect(this.filter);
        this.filter.connect(this.gain);
        this.gain.connect(this.audioContext.destination);
        
        this.oscillator.start();
        
        // Schedule pattern
        this.schedulePattern();
    }

    schedulePattern() {
        if (!this.audioContext || !this.currentNote || !this.oscillator) return;
        
        const beatDuration = 60 / this.bpm;
        const sixteenthNote = beatDuration / 4;
        const measureDuration = beatDuration * 4; // 4 beats = 1 measure (for alignment)
        const patternDuration = beatDuration * 8; // 8 beats = 2 measures = 32 sixteenth notes
        
        // Use system clock - calculate start time from internal metronome
        const currentSystemTime = this.audioContext.currentTime;
        let startTime;
        
        if (this.internalMetronome && this.internalMetronome.running) {
            // Calculate elapsed time since metronome started
            const elapsed = currentSystemTime - this.internalMetronome.startTime;
            // Align to MEASURE boundaries (not pattern boundaries) to stay in sync with drums
            const measureNumber = Math.floor(elapsed / measureDuration);
            const currentMeasureStart = this.internalMetronome.startTime + (measureNumber * measureDuration);
            
            // If we're very close to the start of current measure, use it; otherwise start soon
            if (currentSystemTime - currentMeasureStart < 0.1) {
                startTime = currentMeasureStart;
            } else {
                // Start very soon (within 50ms) to be responsive
                startTime = currentSystemTime + 0.05;
            }
        } else {
            // No metronome - start immediately
            startTime = currentSystemTime + 0.05;
        }
        
        let currentTime = startTime;
        
        // Schedule pattern for next measure
        this.pattern.forEach((step) => {
            const time = currentTime;
            const noteDuration = step.duration * sixteenthNote;
            
            if (step.play) {
                // Decay controls how long the note sustains before fading
                // Clamp sustain to not extend past next note (prevents harsh cutoffs)
                const maxSustain = noteDuration * 3.5; // Don't extend more than 3.5x note
                const sustainTime = Math.min(noteDuration * (0.5 + this.decay * 2), maxSustain);
                const fadeTime = 0.05 + this.decay * 0.15;
                
                // Set oscillator frequency (handle octave up notes)
                const baseFreq = this.getAdjustedFrequency(this.currentNote);
                const noteFreq = step.octaveUp ? baseFreq * 2 : baseFreq;
                this.oscillator.frequency.setValueAtTime(noteFreq, time);
                
                // === GAIN ENVELOPE ===
                // Quick fade down before attack (prevents click if previous note still ringing)
                this.gain.gain.linearRampToValueAtTime(0, time + 0.005);
                // Attack
                this.gain.gain.linearRampToValueAtTime(0.25 * this.volume, time + 0.02);
                // Sustain
                this.gain.gain.setValueAtTime(0.2 * this.volume, time + 0.025);
                this.gain.gain.linearRampToValueAtTime(0.15 * this.volume, time + sustainTime);
                // Fade out
                this.gain.gain.linearRampToValueAtTime(0, time + sustainTime + fadeTime);
                
                // === FILTER ENVELOPE (the squelch!) ===
                const filterPeak = Math.min(this.filterCutoff + this.envAmount, 8000);
                const filterRest = Math.max(this.filterCutoff * 0.3, 200);
                
                this.filter.frequency.linearRampToValueAtTime(filterPeak, time + 0.01);
                this.filter.frequency.setValueAtTime(filterPeak * 0.7, time + 0.03);
                this.filter.frequency.linearRampToValueAtTime(filterRest, time + sustainTime + fadeTime);
            }
            
            currentTime += noteDuration;
        });
        
        // Schedule next pattern using audio context timing (more precise than setTimeout)
        const nextPatternTime = startTime + patternDuration;
        const delay = (nextPatternTime - this.audioContext.currentTime) * 1000;
        
        // Clear any existing timeout before scheduling new one
        if (this.scheduleTimeout) {
            clearTimeout(this.scheduleTimeout);
            this.scheduleTimeout = null;
        }
        
        // Always schedule next pattern if we're still active (remove upper limit check)
        if (delay > 0 && this.currentNote && this.oscillator) {
            this.scheduleTimeout = setTimeout(() => {
                if (this.currentNote && this.oscillator) {
                    this.schedulePattern();
                }
            }, Math.min(delay, 10000)); // Cap at 10 seconds max
        } else if (delay <= 0 && this.currentNote && this.oscillator) {
            // If delay is negative or zero, schedule immediately for next measure
            this.scheduleTimeout = setTimeout(() => {
                if (this.currentNote && this.oscillator) {
                    this.schedulePattern();
                }
            }, 10);
        }
    }

    shiftToNote(baseFrequency) {
        if (this.oscillator) {
            // baseFrequency is the original tile frequency, need to adjust it
            const adjustedFreq = this.getAdjustedFrequency(baseFrequency);
            this.oscillator.frequency.setValueAtTime(
                adjustedFreq,
                this.audioContext.currentTime
            );
        }
    }

    stopBass() {
        // Clear the scheduling timeout to stop the loop
        if (this.scheduleTimeout) {
            clearTimeout(this.scheduleTimeout);
            this.scheduleTimeout = null;
        }
        if (this.oscillator) {
            this.oscillator.stop();
            this.oscillator = null;
        }
        this.currentNote = null;
    }
}
