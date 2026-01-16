// Pen 1: Drum patterns using audio files

import { Pen } from '../pen.js';
import { DrumKitLoader, getKitForNote, getKitPattern, getKitName } from '../drum-kits.js';
import { createNoteFrequencyMap } from '../utils.js';

export class DrumPen extends Pen {
    constructor(audioContext, bpm) {
        super(1, audioContext, bpm);
        this.kitLoader = new DrumKitLoader(audioContext);
        this.buffers = null;
        this.currentPattern = null;
        this.volume = 0.7; // 0-1 range
        this.noteFrequencyMap = createNoteFrequencyMap();
        this.currentKitName = null;
        this.patternDisplay = null;
        this.scheduleTimeout = null; // Track timeout for cleanup
        this.startTime = null; // System clock reference for beat timing
        this.currentStep = 0; // Current step in the 16-beat measure
        this.setupControls();
        this.loadKits();
    }

    async loadKits() {
        this.buffers = await this.kitLoader.loadAll();
    }

    setupControls() {
        const volumeSlider = document.getElementById('pen1VolumeSlider');
        const volumeValue = document.getElementById('pen1VolumeValue');
        this.patternDisplay = document.getElementById('pen1PatternDisplay');

        if (volumeSlider && volumeValue) {
            volumeSlider.addEventListener('input', (e) => {
                this.volume = parseInt(e.target.value) / 100;
                volumeValue.textContent = `${parseInt(e.target.value)}%`;
            });
        }
    }

    getKitName(kitNumber) {
        const kitNames = {
            1: 'Clock Tick/Tock',
            2: 'Typewriter/Keyboard',
            3: 'Woodblock',
            4: 'Coin Purse (Bossa Nova)',
            5: 'Woodblock 2',
            6: 'Xylo'
        };
        return kitNames[kitNumber] || 'Unknown';
    }

    updatePatternDisplay(note, kitNumber, isVariation) {
        if (!this.patternDisplay) return;
        const kitName = this.getKitName(kitNumber);
        const variation = isVariation ? ' (Variation)' : '';
        this.patternDisplay.textContent = `${note}: ${kitName}${variation}`;
        this.currentKitName = kitName;
    }


    onTileEnter(tile) {
        if (!tile || !tile.dataset || !tile.dataset.note) return;
        if (!this.buffers) {
            // Kits not loaded yet, wait a bit
            setTimeout(() => this.onTileEnter(tile), 100);
            return;
        }
        const note = tile.dataset.note;
        const { kitNumber, isVariation } = getKitForNote(note);
        this.currentPattern = getKitPattern(kitNumber, isVariation);
        this.currentKitNumber = kitNumber;
        this.currentNote = note;
        this.updatePatternDisplay(note, kitNumber, isVariation);
        
        if (this.currentPattern && this.currentPattern.length > 0) {
            this.startDrumLoop();
        }
    }

    onTileStay(tile) {
        if (!tile || !tile.dataset || !tile.dataset.note) return;
        const note = tile.dataset.note;
        
        // If note changed, just swap the pattern - keep the clock running
        if (note !== this.currentNote) {
            const { kitNumber, isVariation } = getKitForNote(note);
            this.currentPattern = getKitPattern(kitNumber, isVariation);
            this.currentKitNumber = kitNumber;
            this.currentNote = note;
            this.updatePatternDisplay(note, kitNumber, isVariation);
            // Don't restart - the loop will pick up the new pattern
        }
    }

    onTileLeave() {
        this.stopDrums();
        if (this.patternDisplay) {
            this.patternDisplay.textContent = '-';
        }
    }

    startDrumLoop() {
        // Ensure audio context is available
        if (!this.audioContext && window.musicPlayer && window.musicPlayer.audioContext) {
            this.audioContext = window.musicPlayer.audioContext;
        }
        
        if (!this.audioContext || this.audioContext.state !== 'running') return;
        if (!this.currentPattern || !Array.isArray(this.currentPattern)) return;
        if (!this.buffers) return;
        
        // Set start time to now - this is our clock reference
        this.startTime = this.audioContext.currentTime;
        this.currentStep = 0;
        
        this.scheduleNextStep();
    }

    scheduleNextStep() {
        if (!this.audioContext || !this.currentPattern || !this.currentTile) return;
        
        const beatDuration = 60 / this.bpm;
        const sixteenthNote = beatDuration / 4;
        const currentTime = this.audioContext.currentTime;
        
        // Calculate when this step should play based on system clock
        const stepTime = this.startTime + (this.currentStep * sixteenthNote);
        const stepInMeasure = this.currentStep % 16;
        
        // Check if current pattern has a beat at this step position
        if (stepTime >= currentTime - 0.05) {
            const beat = this.currentPattern.find(b => b.pos === stepInMeasure);
            if (beat) {
                const playTime = Math.max(stepTime, currentTime);
                this.playDrumSound(playTime, {
                    sound: beat.sound,
                    kitNumber: this.currentKitNumber,
                    note: this.currentNote
                });
            }
        }
        
        this.currentStep++;
        
        // Schedule next step
        const nextStepTime = this.startTime + (this.currentStep * sixteenthNote);
        const delay = (nextStepTime - currentTime) * 1000;
        
        // Clear any existing timeout
        if (this.scheduleTimeout) {
            clearTimeout(this.scheduleTimeout);
        }
        
        if (this.currentTile && delay > 0) {
            this.scheduleTimeout = setTimeout(() => this.scheduleNextStep(), Math.min(delay, 5000));
        } else if (this.currentTile) {
            // If we're behind, catch up
            this.scheduleTimeout = setTimeout(() => this.scheduleNextStep(), 10);
        }
    }

    playDrumSound(time, soundInfo) {
        // Ensure audio context is available
        if (!this.audioContext && window.musicPlayer && window.musicPlayer.audioContext) {
            this.audioContext = window.musicPlayer.audioContext;
        }
        
        if (!this.audioContext || this.audioContext.state !== 'running') return;
        if (!this.buffers) return;
        
        const { sound, kitNumber, note } = soundInfo;
        let bufferKey = null;
        let playbackRate = 1.0;
        
        // Map sound name to buffer key and handle pitch shifting for xylo
        switch (kitNumber) {
            case 1: // Clock
                bufferKey = sound === 'tick' ? 'kit1_tick' : 'kit1_tock';
                break;
            case 2: // Typewriter/Keyboard
                bufferKey = sound === 'typewriter' ? 'kit2_typewriter' : 'kit2_keyboard';
                break;
            case 3: // Woodblock
                bufferKey = sound === 'woodblock' ? 'kit3_woodblock' : 'kit3_woodblock_hi';
                break;
            case 4: // Coin purse + clap
                bufferKey = sound === 'clap' ? 'kit4_clap' : 'kit4_coin';
                break;
            case 5: // Woodblock 2
                bufferKey = 'kit5_woodblock2';
                break;
            case 6: // Xylo - pitch shift to match note
                bufferKey = 'kit6_xylo';
                // Calculate playback rate to match note frequency
                // Assume xylo sample is at C4 (261.63 Hz)
                const targetFreq = this.noteFrequencyMap[note] || 261.63;
                const baseFreq = 261.63;
                playbackRate = targetFreq / baseFreq;
                break;
        }
        
        const buffer = this.buffers[bufferKey];
        if (!buffer) return;
        
        // Play the audio buffer
        const source = this.audioContext.createBufferSource();
        const gain = this.audioContext.createGain();
        
        source.buffer = buffer;
        source.playbackRate.value = playbackRate;
        
        gain.gain.setValueAtTime(this.volume, time);
        
        source.connect(gain);
        gain.connect(this.audioContext.destination);
        
        source.start(time);
        source.stop(time + buffer.duration / playbackRate);
    }

    stopDrums() {
        // Clear the scheduling timeout to stop the loop
        if (this.scheduleTimeout) {
            clearTimeout(this.scheduleTimeout);
            this.scheduleTimeout = null;
        }
        this.startTime = null;
        this.currentStep = 0;
        // Don't clear currentPattern - keep it for potential restart
    }
}
