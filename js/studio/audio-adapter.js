// Audio Adapter - Bridges Three.js pens to the existing audio engines

import { MusicPlayer } from '../music-player.js';
import { DrumKitLoader, getKitForNote, getKitPattern } from '../drum-kits.js';
import { generateArpeggioPattern } from '../arpeggio.js';
import { createNoteFrequencyMap, getChordFrequencies } from '../utils.js';

export class StudioAudioEngine {
    constructor() {
        this.audioContext = null;
        this.bpm = 100;
        this.noteFrequencyMap = createNoteFrequencyMap();
        
        // Per-pen state and settings
        this.penStates = {
            1: { // Woodpecker - Drums
                active: false,
                note: null,
                frequency: null,
                volume: 0.7,
                pattern: null,
                kitNumber: null,
                scheduleTimeout: null,
                startTime: null,
                currentStep: 0,
                buffers: null
            },
            2: { // Toad - Bass
                active: false,
                note: null,
                frequency: null,
                volume: 0.7,
                octaveDrop: 3,
                filterCutoff: 800,
                filterResonance: 16,
                envAmount: 2600,
                oscillator: null,
                filter: null,
                gain: null,
                scheduleTimeout: null,
                pattern: this.createBassPattern()
            },
            3: { // Fairy - Arpeggio
                active: false,
                note: null,
                frequency: null,
                volume: 0.7,
                octaveShift: -1,
                octaves: 2,
                sustain: 0.35,
                frequencies: [],
                currentIndex: 0,
                scheduleTimeout: null,
                startTime: null
            },
            4: { // Robin - Vibrato
                active: false,
                note: null,
                frequency: null,
                volume: 0.6,
                octaveShift: 1,
                vibratoRate: 5,
                vibratoDepth: 2,
                oscillators: [],
                vibratoLFOs: [],
                gain: null,
                filter: null,
                vibratoStarted: false,
                vibratoTimeout: null
            }
        };
        
        this.drumKitLoader = null;
    }

    createBassPattern() {
        // 32-step pattern for bass
        return [
            { play: 1, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 },
            { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 },
            { play: 1, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 },
            { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 },
            { play: 1, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 },
            { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 },
            { play: 1, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 },
            { play: 1, duration: 1, octaveUp: true }, { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 }
        ];
    }

    async init() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Load drum samples
        this.drumKitLoader = new DrumKitLoader(this.audioContext);
        this.penStates[1].buffers = await this.drumKitLoader.loadAll();
        
        console.log('Studio audio engine initialized');
    }

    async ensureAudioContext() {
        if (!this.audioContext) {
            await this.init();
        }
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    // Called when a pen enters a color
    async penEnter(penId, note, frequency) {
        await this.ensureAudioContext();
        
        const state = this.penStates[penId];
        if (!state) return;
        
        state.active = true;
        state.note = note;
        state.frequency = frequency;
        
        switch (penId) {
            case 1: this.startDrums(state, note); break;
            case 2: this.startBass(state, frequency); break;
            case 3: this.startArpeggio(state, note, frequency); break;
            case 4: this.startVibrato(state, frequency); break;
        }
    }

    // Called when a pen leaves all colors
    penLeave(penId) {
        const state = this.penStates[penId];
        if (!state) return;
        
        state.active = false;
        state.note = null;
        state.frequency = null;
        
        switch (penId) {
            case 1: this.stopDrums(state); break;
            case 2: this.stopBass(state); break;
            case 3: this.stopArpeggio(state); break;
            case 4: this.stopVibrato(state); break;
        }
    }

    // Called when pen moves to different note while still on paper
    penChange(penId, note, frequency) {
        const state = this.penStates[penId];
        if (!state || !state.active) return;
        
        state.note = note;
        state.frequency = frequency;
        
        // Each instrument handles note changes differently
        switch (penId) {
            case 1: 
                // Drums - update pattern for new note
                const { kitNumber, isVariation } = getKitForNote(note);
                state.pattern = getKitPattern(kitNumber, isVariation);
                state.kitNumber = kitNumber;
                break;
            case 2:
                // Bass - update oscillator frequency
                if (state.oscillator) {
                    const adjFreq = frequency / Math.pow(2, state.octaveDrop);
                    state.oscillator.frequency.setValueAtTime(adjFreq, this.audioContext.currentTime);
                }
                break;
            case 3:
                // Arpeggio - regenerate pattern
                state.frequencies = generateArpeggioPattern(
                    { dataset: { note, frequency } },
                    { happyChords: true, octaves: state.octaves, noteFrequencyMap: this.noteFrequencyMap }
                );
                break;
            case 4:
                // Vibrato - shift note
                this.shiftVibratoNote(state, frequency);
                break;
        }
    }

    // ==================== DRUMS (Pen 1) ====================
    
    startDrums(state, note) {
        if (!state.buffers) return;
        
        const { kitNumber, isVariation } = getKitForNote(note);
        state.pattern = getKitPattern(kitNumber, isVariation);
        state.kitNumber = kitNumber;
        state.startTime = this.audioContext.currentTime;
        state.currentStep = 0;
        
        this.scheduleDrumStep(state);
    }

    scheduleDrumStep(state) {
        if (!state.active || !state.pattern) return;
        
        const beatDuration = 60 / this.bpm;
        const sixteenthNote = beatDuration / 4;
        const currentTime = this.audioContext.currentTime;
        
        const stepTime = state.startTime + (state.currentStep * sixteenthNote);
        const stepInMeasure = state.currentStep % 16;
        
        if (stepTime >= currentTime - 0.05) {
            const beat = state.pattern.find(b => b.pos === stepInMeasure);
            if (beat) {
                this.playDrumSound(state, Math.max(stepTime, currentTime), beat.sound);
            }
        }
        
        state.currentStep++;
        
        const nextStepTime = state.startTime + (state.currentStep * sixteenthNote);
        const delay = (nextStepTime - currentTime) * 1000;
        
        if (state.scheduleTimeout) clearTimeout(state.scheduleTimeout);
        
        if (state.active && delay > 0) {
            state.scheduleTimeout = setTimeout(() => this.scheduleDrumStep(state), Math.min(delay, 5000));
        } else if (state.active) {
            state.scheduleTimeout = setTimeout(() => this.scheduleDrumStep(state), 10);
        }
    }

    playDrumSound(state, time, sound) {
        if (!state.buffers) return;
        
        let bufferKey = null;
        switch (state.kitNumber) {
            case 1: bufferKey = sound === 'tick' ? 'kit1_tick' : 'kit1_tock'; break;
            case 2: bufferKey = sound === 'typewriter' ? 'kit2_typewriter' : 'kit2_keyboard'; break;
            case 3: bufferKey = sound === 'woodblock' ? 'kit3_woodblock' : 'kit3_woodblock_hi'; break;
            case 4: bufferKey = sound === 'clap' ? 'kit4_clap' : 'kit4_coin'; break;
            case 5: bufferKey = 'kit5_woodblock2'; break;
            case 6: bufferKey = 'kit6_xylo'; break;
        }
        
        const buffer = state.buffers[bufferKey];
        if (!buffer) return;
        
        const source = this.audioContext.createBufferSource();
        const gain = this.audioContext.createGain();
        
        source.buffer = buffer;
        gain.gain.setValueAtTime(state.volume, time);
        
        source.connect(gain);
        gain.connect(this.audioContext.destination);
        
        source.start(time);
    }

    stopDrums(state) {
        if (state.scheduleTimeout) {
            clearTimeout(state.scheduleTimeout);
            state.scheduleTimeout = null;
        }
        state.startTime = null;
        state.currentStep = 0;
    }

    // ==================== BASS (Pen 2) ====================
    
    startBass(state, frequency) {
        if (state.oscillator) {
            try { state.oscillator.stop(); } catch (e) {}
        }
        
        const adjFreq = frequency / Math.pow(2, state.octaveDrop);
        
        state.oscillator = this.audioContext.createOscillator();
        state.filter = this.audioContext.createBiquadFilter();
        state.gain = this.audioContext.createGain();
        
        state.oscillator.type = 'sawtooth';
        state.oscillator.frequency.value = adjFreq;
        
        state.filter.type = 'lowpass';
        state.filter.frequency.value = state.filterCutoff;
        state.filter.Q.value = state.filterResonance;
        
        state.gain.gain.setValueAtTime(0, this.audioContext.currentTime);
        
        state.oscillator.connect(state.filter);
        state.filter.connect(state.gain);
        state.gain.connect(this.audioContext.destination);
        
        state.oscillator.start();
        this.scheduleBassPattern(state);
    }

    scheduleBassPattern(state) {
        if (!state.active || !state.oscillator) return;
        
        const beatDuration = 60 / this.bpm;
        const sixteenthNote = beatDuration / 4;
        const patternDuration = beatDuration * 8;
        
        const currentTime = this.audioContext.currentTime;
        let startTime = currentTime + 0.05;
        let currentStepTime = startTime;
        
        state.pattern.forEach((step) => {
            if (step.play) {
                const adjFreq = state.frequency / Math.pow(2, state.octaveDrop);
                const noteFreq = step.octaveUp ? adjFreq * 2 : adjFreq;
                
                state.oscillator.frequency.setValueAtTime(noteFreq, currentStepTime);
                
                // Gain envelope
                state.gain.gain.linearRampToValueAtTime(0, currentStepTime + 0.005);
                state.gain.gain.linearRampToValueAtTime(0.25 * state.volume, currentStepTime + 0.02);
                state.gain.gain.linearRampToValueAtTime(0.15 * state.volume, currentStepTime + 0.3);
                state.gain.gain.linearRampToValueAtTime(0, currentStepTime + 0.5);
                
                // Filter envelope (squelch)
                const filterPeak = Math.min(state.filterCutoff + state.envAmount, 8000);
                state.filter.frequency.linearRampToValueAtTime(filterPeak, currentStepTime + 0.01);
                state.filter.frequency.linearRampToValueAtTime(state.filterCutoff * 0.3, currentStepTime + 0.5);
            }
            currentStepTime += step.duration * sixteenthNote;
        });
        
        // Schedule next pattern
        if (state.scheduleTimeout) clearTimeout(state.scheduleTimeout);
        
        const delay = patternDuration * 1000;
        if (state.active) {
            state.scheduleTimeout = setTimeout(() => this.scheduleBassPattern(state), delay);
        }
    }

    stopBass(state) {
        if (state.scheduleTimeout) {
            clearTimeout(state.scheduleTimeout);
            state.scheduleTimeout = null;
        }
        if (state.oscillator) {
            try { state.oscillator.stop(); } catch (e) {}
            state.oscillator = null;
        }
    }

    // ==================== ARPEGGIO (Pen 3) ====================
    
    startArpeggio(state, note, frequency) {
        state.frequencies = generateArpeggioPattern(
            { dataset: { note, frequency } },
            { happyChords: true, octaves: state.octaves, noteFrequencyMap: this.noteFrequencyMap }
        );
        
        if (!state.frequencies.length) return;
        
        state.startTime = this.audioContext.currentTime + 0.05;
        state.currentIndex = 0;
        
        this.scheduleArpeggioNote(state);
    }

    scheduleArpeggioNote(state) {
        if (!state.active || !state.frequencies.length) return;
        
        const beatDuration = 60 / this.bpm;
        const noteInterval = beatDuration / 4; // 4 notes per beat
        const currentTime = this.audioContext.currentTime;
        
        const noteTime = state.startTime + (state.currentIndex * noteInterval);
        const freq = state.frequencies[state.currentIndex % state.frequencies.length];
        
        if (noteTime >= currentTime - 0.05) {
            this.playArpeggioNote(state, Math.max(noteTime, currentTime), freq);
        }
        
        state.currentIndex++;
        
        const nextNoteTime = state.startTime + (state.currentIndex * noteInterval);
        const delay = (nextNoteTime - currentTime) * 1000;
        
        if (state.scheduleTimeout) clearTimeout(state.scheduleTimeout);
        
        if (state.active && delay > 0) {
            state.scheduleTimeout = setTimeout(() => this.scheduleArpeggioNote(state), Math.min(delay, 5000));
        } else if (state.active) {
            state.scheduleTimeout = setTimeout(() => this.scheduleArpeggioNote(state), 10);
        }
    }

    playArpeggioNote(state, time, frequency) {
        const shiftedFreq = frequency * Math.pow(2, state.octaveShift);
        const decayTime = 0.05 + (state.sustain * 0.95);
        
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        oscillator.type = 'sine';
        oscillator.frequency.value = shiftedFreq;
        
        gainNode.gain.setValueAtTime(0, time);
        gainNode.gain.linearRampToValueAtTime(state.volume * 0.5, time + 0.002);
        gainNode.gain.exponentialRampToValueAtTime(0.01, time + decayTime);
        
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        oscillator.start(time);
        oscillator.stop(time + decayTime + 0.1);
    }

    stopArpeggio(state) {
        if (state.scheduleTimeout) {
            clearTimeout(state.scheduleTimeout);
            state.scheduleTimeout = null;
        }
        state.frequencies = [];
        state.currentIndex = 0;
        state.startTime = null;
    }

    // ==================== VIBRATO (Pen 4) ====================
    
    startVibrato(state, frequency) {
        this.stopVibratoOscillators(state);
        
        state.vibratoStarted = false;
        state.oscillators = [];
        state.vibratoLFOs = [];
        
        const shiftedFreq = frequency * Math.pow(2, state.octaveShift);
        state.currentFrequency = shiftedFreq;
        
        // Master filter
        state.filter = this.audioContext.createBiquadFilter();
        state.filter.type = 'lowpass';
        state.filter.frequency.value = 8000;
        
        // Main gain
        state.gain = this.audioContext.createGain();
        state.gain.connect(state.filter);
        state.filter.connect(this.audioContext.destination);
        
        // Create flute-like sound
        const fundamental = this.audioContext.createOscillator();
        fundamental.type = 'sine';
        fundamental.frequency.value = shiftedFreq;
        fundamental.connect(state.gain);
        state.oscillators.push(fundamental);
        
        // Third harmonic
        const third = this.audioContext.createOscillator();
        const thirdGain = this.audioContext.createGain();
        third.type = 'sine';
        third.frequency.value = shiftedFreq * 3;
        thirdGain.gain.value = 0.08;
        third.connect(thirdGain);
        thirdGain.connect(state.gain);
        state.oscillators.push(third);
        
        // Fade in
        const currentTime = this.audioContext.currentTime;
        state.gain.gain.setValueAtTime(0, currentTime);
        state.gain.gain.linearRampToValueAtTime(0.3 * state.volume, currentTime + 0.08);
        
        state.oscillators.forEach(osc => osc.start());
        
        // Start vibrato after delay
        state.vibratoTimeout = setTimeout(() => this.startVibratoLFO(state), 300);
    }

    startVibratoLFO(state) {
        if (!state.active || state.vibratoStarted) return;
        
        state.vibratoStarted = true;
        
        state.oscillators.forEach(osc => {
            if (!osc.frequency) return;
            
            const lfo = this.audioContext.createOscillator();
            const lfoGain = this.audioContext.createGain();
            
            lfo.type = 'sine';
            lfo.frequency.value = state.vibratoRate;
            
            const freqRatio = osc.frequency.value / state.currentFrequency;
            const depth = state.currentFrequency * (state.vibratoDepth / 100) * freqRatio;
            lfoGain.gain.value = depth;
            
            lfo.connect(lfoGain);
            lfoGain.connect(osc.frequency);
            
            lfo.start();
            state.vibratoLFOs.push(lfo);
        });
    }

    shiftVibratoNote(state, frequency) {
        if (!state.oscillators.length || !state.gain) return;
        
        const shiftedFreq = frequency * Math.pow(2, state.octaveShift);
        const oldFreq = state.currentFrequency;
        
        state.oscillators.forEach(osc => {
            if (!osc.frequency) return;
            const ratio = osc.frequency.value / oldFreq;
            osc.frequency.setValueAtTime(shiftedFreq * ratio, this.audioContext.currentTime);
        });
        
        state.currentFrequency = shiftedFreq;
    }

    stopVibratoOscillators(state) {
        state.oscillators.forEach(osc => {
            try { osc.stop(); } catch (e) {}
        });
        state.vibratoLFOs.forEach(lfo => {
            try { lfo.stop(); } catch (e) {}
        });
        state.oscillators = [];
        state.vibratoLFOs = [];
    }

    stopVibrato(state) {
        if (state.vibratoTimeout) {
            clearTimeout(state.vibratoTimeout);
            state.vibratoTimeout = null;
        }
        
        if (state.gain && this.audioContext) {
            state.gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);
            setTimeout(() => this.stopVibratoOscillators(state), 150);
        } else {
            this.stopVibratoOscillators(state);
        }
        
        state.vibratoStarted = false;
        state.currentFrequency = null;
    }
}
