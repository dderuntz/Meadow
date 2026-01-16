// Pen 3: Arpeggiator - simple, clock-based, no buffer

import { Pen } from '../pen.js';
import { generateArpeggioPattern } from '../arpeggio.js';
import { createNoteFrequencyMap } from '../utils.js';

export class ArpeggioPen extends Pen {
    constructor(audioContext, bpm) {
        super(3, audioContext, bpm);
        this.octaves = 2;
        this.arpeggioRatio = 4; // Notes per beat
        this.volume = 0.7;
        this.octaveShift = -1; // -2 to +2 octaves
        this.sustain = 0.35; // 0.05-1.0, how long notes ring out
        this.noteFrequencyMap = createNoteFrequencyMap();
        this.frequencies = [];
        this.currentIndex = 0;
        this.pendingSchedule = null;
        this.startTime = null; // When the arpeggio started (system clock reference)
        this.setupControls();
    }

    setupControls() {
        const volumeSlider = document.getElementById('pen3VolumeSlider');
        const volumeValue = document.getElementById('pen3VolumeValue');
        const octaveSlider = document.getElementById('pen3OctaveSlider');
        const octaveValue = document.getElementById('pen3OctaveValue');
        const climbSlider = document.getElementById('pen3ClimbSlider');
        const climbValue = document.getElementById('pen3ClimbValue');
        const sustainSlider = document.getElementById('pen3SustainSlider');
        const sustainValue = document.getElementById('pen3SustainValue');

        if (volumeSlider && volumeValue) {
            volumeSlider.addEventListener('input', (e) => {
                this.volume = parseInt(e.target.value) / 100;
                volumeValue.textContent = `${parseInt(e.target.value)}%`;
            });
        }

        if (octaveSlider && octaveValue) {
            octaveSlider.addEventListener('input', (e) => {
                this.octaveShift = parseInt(e.target.value);
                octaveValue.textContent = this.octaveShift > 0 ? `+${this.octaveShift}` : `${this.octaveShift}`;
            });
        }

        if (climbSlider && climbValue) {
            climbSlider.addEventListener('input', (e) => {
                this.octaves = parseInt(e.target.value);
                climbValue.textContent = `${this.octaves} oct`;
                // Regenerate pattern if currently playing
                if (this.currentTile) {
                    this.frequencies = generateArpeggioPattern(this.currentTile, {
                        happyChords: true,
                        octaves: this.octaves,
                        noteFrequencyMap: this.noteFrequencyMap
                    });
                }
            });
        }

        if (sustainSlider && sustainValue) {
            sustainSlider.addEventListener('input', (e) => {
                this.sustain = parseInt(e.target.value) / 100;
                sustainValue.textContent = `${parseInt(e.target.value)}%`;
            });
        }
    }

    onTileEnter(tile) {
        if (!tile || !tile.dataset || !tile.dataset.note) return;
        this.startArpeggio(tile);
    }

    onTileStay(tile) {
        if (!tile || !tile.dataset || !tile.dataset.note) return;
        const note = tile.dataset.note;
        const currentNote = this.currentTile?.dataset?.note;
        if (note !== currentNote) {
            this.shiftArpeggio(tile);
        }
    }

    onTileLeave() {
        this.stopArpeggio();
    }

    startArpeggio(tile) {
        if (!this.audioContext && window.musicPlayer && window.musicPlayer.audioContext) {
            this.audioContext = window.musicPlayer.audioContext;
        }
        
        if (!this.audioContext || !tile || !tile.dataset) return;
        
        this.currentTile = tile;
        this.frequencies = generateArpeggioPattern(tile, {
            happyChords: true,
            octaves: this.octaves,
            noteFrequencyMap: this.noteFrequencyMap
        });
        
        if (!this.frequencies || this.frequencies.length === 0) return;
        
        const beatDuration = 60 / this.bpm;
        const measureDuration = beatDuration * 4; // 4 beats = 1 measure
        const currentSystemTime = this.audioContext.currentTime;
        
        // Align to measure boundaries using internal metronome (same as bass/drums)
        if (this.internalMetronome && this.internalMetronome.running) {
            const elapsed = currentSystemTime - this.internalMetronome.startTime;
            const measureNumber = Math.floor(elapsed / measureDuration);
            const currentMeasureStart = this.internalMetronome.startTime + (measureNumber * measureDuration);
            
            // If we're very close to the start of current measure, use it; otherwise start soon
            if (currentSystemTime - currentMeasureStart < 0.1) {
                this.startTime = currentMeasureStart;
            } else {
                this.startTime = currentSystemTime + 0.05;
            }
        } else {
            this.startTime = currentSystemTime + 0.05;
        }
        
        this.currentIndex = 0;
        
        this.scheduleNextNote();
    }

    shiftArpeggio(tile) {
        const newFrequencies = generateArpeggioPattern(tile, {
            happyChords: true,
            octaves: this.octaves,
            noteFrequencyMap: this.noteFrequencyMap
        });
        
        
        // Keep the same position in the pattern (don't reset index)
        // Just swap the frequencies - the clock keeps running
        this.frequencies = newFrequencies;
        this.currentTile = tile;
        
        // Don't reset startTime or currentIndex - maintain position
    }

    scheduleNextNote() {
        if (!this.audioContext || this.frequencies.length === 0 || !this.currentTile) return;
        
        const beatDuration = 60 / this.bpm;
        const noteInterval = beatDuration / this.arpeggioRatio;
        const currentTime = this.audioContext.currentTime;
        
        // Calculate note time based on system clock
        // noteTime = startTime + (currentIndex * noteInterval)
        const noteTime = this.startTime + (this.currentIndex * noteInterval);
        
        // Get frequency from pattern (wraps around)
        const freq = this.frequencies[this.currentIndex % this.frequencies.length];
        
        // Only play if note time is in the future (or just passed)
        if (noteTime >= currentTime - 0.05) {
            const playTime = Math.max(noteTime, currentTime);
            this.playArpeggioNote(freq, playTime);
        }
        
        this.currentIndex++;
        
        // Schedule next note
        const nextNoteTime = this.startTime + (this.currentIndex * noteInterval);
        const delay = (nextNoteTime - currentTime) * 1000;
        
        if (this.currentTile && delay > 0) {
            this.pendingSchedule = setTimeout(() => {
                if (this.currentTile) {
                    this.scheduleNextNote();
                }
            }, Math.min(delay, 5000));
        } else if (this.currentTile) {
            // If we're behind, catch up immediately
            this.pendingSchedule = setTimeout(() => {
                if (this.currentTile) {
                    this.scheduleNextNote();
                }
            }, 10);
        }
    }

    playArpeggioNote(frequency, time) {
        if (!this.audioContext || this.audioContext.state !== 'running') return;
        
        // Apply octave shift
        const shiftedFreq = frequency * Math.pow(2, this.octaveShift);
        
        // Create plucked string sound - fire and forget
        
        // 1. Noise burst for pluck attack
        const noiseBuffer = this.audioContext.createBuffer(1, this.audioContext.sampleRate * 0.01, this.audioContext.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseData.length; i++) {
            noiseData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (noiseData.length * 0.3));
        }
        
        const noiseSource = this.audioContext.createBufferSource();
        const noiseGain = this.audioContext.createGain();
        const noiseFilter = this.audioContext.createBiquadFilter();
        
        noiseSource.buffer = noiseBuffer;
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = shiftedFreq * 2;
        noiseFilter.Q.value = 5;
        
        noiseGain.gain.setValueAtTime(this.volume * 0.3, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, time + 0.01);
        
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.audioContext.destination);
        
        noiseSource.start(time);
        noiseSource.stop(time + 0.01);

        // 2. Main tone with plucked envelope
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        const toneFilter = this.audioContext.createBiquadFilter();

        oscillator.type = 'sine';
        oscillator.frequency.value = shiftedFreq;

        toneFilter.type = 'lowpass';
        toneFilter.frequency.value = shiftedFreq * 4;
        toneFilter.Q.value = 1;

        // Plucked envelope - sustain controls decay time
        // Low sustain (0.05) = very short, dead pluck
        // High sustain (1.0) = long ringing note
        const decayTime = 0.05 + (this.sustain * 0.95); // 0.05 to 1.0 seconds
        const sustainLevel = 0.05 + (this.sustain * 0.3); // How loud it stays
        
        gainNode.gain.setValueAtTime(0, time);
        gainNode.gain.linearRampToValueAtTime(this.volume * 0.5, time + 0.002);
        gainNode.gain.exponentialRampToValueAtTime(this.volume * sustainLevel, time + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, time + decayTime);

        oscillator.connect(toneFilter);
        toneFilter.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.start(time);
        oscillator.stop(time + decayTime + 0.1);
        
        // No tracking - notes play their duration and auto-stop
    }

    stopArpeggio() {
        if (this.pendingSchedule) {
            clearTimeout(this.pendingSchedule);
            this.pendingSchedule = null;
        }
        this.frequencies = [];
        this.currentIndex = 0;
        this.currentTile = null;
        this.startTime = null;
    }
}
