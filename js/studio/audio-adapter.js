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
        
        // Map physical pen IDs to instrument mode IDs (can be changed via setPenMode)
        this.penModeMap = { 1: 1, 2: 2, 3: 3, 4: 4 };
        
        // Per PHYSICAL PEN, per INSTRUMENT TYPE state
        // Each pen has completely independent state for each instrument
        this.penStates = {};
        for (let i = 1; i <= 4; i++) {
            this.penStates[i] = {
                currentMode: i, // Track which mode is active
                note: null,
                frequency: null,
                drum: this.createDrumState(),
                bass: this.createBassState(),
                arp: this.createArpState(),
                vib: this.createVibState()
            };
        }
        
        this.drumKitLoader = null;
        this.drumBuffers = null;
    }
    
    createDrumState() {
        return {
            active: false,
            volume: 0.7,
            pattern: null,
            kitNumber: null,
            timeout: null,
            startTime: null,
            currentStep: 0
        };
    }
    
    createBassState() {
        return {
            active: false,
            volume: 0.7,
            octaveDrop: 3,
            filterCutoff: 800,
            filterResonance: 16,
            envAmount: 2600,
            oscillator: null,
            filter: null,
            gain: null,
            pattern: this.createBassPattern(),
            timeout: null,
            currentFrequency: null
        };
    }
    
    createArpState() {
        return {
            active: false,
            volume: 0.7,
            octaveShift: -1,
            octaves: 2,
            sustain: 0.35,
            frequencies: [],
            currentIndex: 0,
            timeout: null,
            startTime: null
        };
    }
    
    createVibState() {
        return {
            active: false,
            volume: 0.6,
            octaveShift: 1,
            vibratoRate: 5,
            vibratoDepth: 2,
            oscillators: [],
            vibratoLFOs: [],
            gain: null,
            filter: null,
            vibratoStarted: false,
            timeout: null,
            currentFrequency: null
        };
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
        
        // Load drum samples (shared by all pens in drum mode)
        this.drumKitLoader = new DrumKitLoader(this.audioContext);
        this.drumBuffers = await this.drumKitLoader.loadAll();
        
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

    // Set which mode a physical pen uses
    setPenMode(physicalPenId, modeId) {
        const penState = this.penStates[physicalPenId];
        if (!penState) return;
        
        const oldModeId = this.penModeMap[physicalPenId];
        
        // Stop the OLD instrument for THIS pen if it was playing
        if (penState.note) {
            switch (oldModeId) {
                case 1: this.stopDrums(penState.drum); break;
                case 2: this.stopBass(penState.bass); break;
                case 3: this.stopArpeggio(penState.arp); break;
                case 4: this.stopVibrato(penState.vib); break;
            }
        }
        
        // Update the mode
        this.penModeMap[physicalPenId] = modeId;
        penState.currentMode = modeId;
        
        // Start the NEW instrument if pen is currently over a note
        if (penState.note && penState.frequency) {
            switch (modeId) {
                case 1: this.startDrums(penState.drum, penState.note); break;
                case 2: this.startBass(penState.bass, penState.frequency); break;
                case 3: this.startArpeggio(penState.arp, penState.note, penState.frequency); break;
                case 4: this.startVibrato(penState.vib, penState.frequency); break;
            }
        }
        
        console.log(`Pen ${physicalPenId} now using mode ${modeId}`);
    }
    
    // Called when a pen enters a color
    async penEnter(penId, note, frequency) {
        await this.ensureAudioContext();
        
        const penState = this.penStates[penId];
        const modeId = this.penModeMap[penId] || penId;
        if (!penState) return;
        
        penState.note = note;
        penState.frequency = frequency;
        
        switch (modeId) {
            case 1: this.startDrums(penState.drum, note); break;
            case 2: this.startBass(penState.bass, frequency); break;
            case 3: this.startArpeggio(penState.arp, note, frequency); break;
            case 4: this.startVibrato(penState.vib, frequency); break;
        }
    }

    // Called when a pen leaves all colors
    penLeave(penId) {
        const penState = this.penStates[penId];
        const modeId = this.penModeMap[penId] || penId;
        if (!penState) return;
        
        penState.note = null;
        penState.frequency = null;
        
        switch (modeId) {
            case 1: this.stopDrums(penState.drum); break;
            case 2: this.stopBass(penState.bass); break;
            case 3: this.stopArpeggio(penState.arp); break;
            case 4: this.stopVibrato(penState.vib); break;
        }
    }

    // Called when pen moves to different note while still on paper
    penChange(penId, note, frequency) {
        const penState = this.penStates[penId];
        const modeId = this.penModeMap[penId] || penId;
        if (!penState || !penState.note) return;
        
        penState.note = note;
        penState.frequency = frequency;
        
        // Each instrument handles note changes differently
        switch (modeId) {
            case 1: 
                // Drums - update pattern for new note
                const { kitNumber, isVariation } = getKitForNote(note);
                penState.drum.pattern = getKitPattern(kitNumber, isVariation);
                penState.drum.kitNumber = kitNumber;
                break;
            case 2:
                // Bass - update frequency (used on next pattern iteration)
                const bassState = penState.bass;
                bassState.currentFrequency = frequency;
                if (bassState.oscillator) {
                    const adjFreq = frequency / Math.pow(2, bassState.octaveDrop);
                    bassState.oscillator.frequency.setValueAtTime(adjFreq, this.audioContext.currentTime);
                }
                break;
            case 3:
                // Arpeggio - regenerate pattern
                penState.arp.frequencies = generateArpeggioPattern(
                    { dataset: { note, frequency } },
                    { happyChords: true, octaves: penState.arp.octaves, noteFrequencyMap: this.noteFrequencyMap }
                );
                break;
            case 4:
                // Vibrato - shift note
                this.shiftVibratoNote(penState.vib, frequency);
                break;
        }
    }

    // ==================== DRUMS ====================
    
    startDrums(state, note) {
        if (!this.drumBuffers) return;
        
        const { kitNumber, isVariation } = getKitForNote(note);
        state.pattern = getKitPattern(kitNumber, isVariation);
        state.kitNumber = kitNumber;
        state.startTime = this.audioContext.currentTime;
        state.currentStep = 0;
        state.active = true;
        
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
        
        if (state.timeout) clearTimeout(state.timeout);
        
        if (state.active && delay > 0) {
            state.timeout = setTimeout(() => this.scheduleDrumStep(state), Math.min(delay, 5000));
        } else if (state.active) {
            state.timeout = setTimeout(() => this.scheduleDrumStep(state), 10);
        }
    }

    playDrumSound(state, time, sound) {
        if (!this.drumBuffers) return;
        
        let bufferKey = null;
        switch (state.kitNumber) {
            case 1: bufferKey = sound === 'tick' ? 'kit1_tick' : 'kit1_tock'; break;
            case 2: bufferKey = sound === 'typewriter' ? 'kit2_typewriter' : 'kit2_keyboard'; break;
            case 3: bufferKey = sound === 'woodblock' ? 'kit3_woodblock' : 'kit3_woodblock_hi'; break;
            case 4: bufferKey = sound === 'clap' ? 'kit4_clap' : 'kit4_coin'; break;
            case 5: bufferKey = 'kit5_woodblock2'; break;
            case 6: bufferKey = 'kit6_xylo'; break;
        }
        
        const buffer = this.drumBuffers[bufferKey];
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
        state.active = false;
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
        }
        state.startTime = null;
        state.currentStep = 0;
    }

    // ==================== BASS ====================
    
    startBass(state, frequency) {
        if (state.oscillator) {
            try { state.oscillator.stop(); } catch (e) {}
        }
        
        state.active = true;
        state.currentFrequency = frequency;
        
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
        
        const frequency = state.currentFrequency || 220;
        
        state.pattern.forEach((step) => {
            if (step.play) {
                const adjFreq = frequency / Math.pow(2, state.octaveDrop);
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
        if (state.timeout) clearTimeout(state.timeout);
        
        const delay = patternDuration * 1000;
        if (state.active) {
            state.timeout = setTimeout(() => this.scheduleBassPattern(state), delay);
        }
    }

    stopBass(state) {
        state.active = false;
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
        }
        if (state.oscillator) {
            try { state.oscillator.stop(); } catch (e) {}
            state.oscillator = null;
        }
    }

    // ==================== ARPEGGIO ====================
    
    startArpeggio(state, note, frequency) {
        state.active = true;
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
        
        if (state.timeout) clearTimeout(state.timeout);
        
        if (state.active && delay > 0) {
            state.timeout = setTimeout(() => this.scheduleArpeggioNote(state), Math.min(delay, 5000));
        } else if (state.active) {
            state.timeout = setTimeout(() => this.scheduleArpeggioNote(state), 10);
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
        state.active = false;
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
        }
        state.frequencies = [];
        state.currentIndex = 0;
        state.startTime = null;
    }

    // ==================== VIBRATO ====================
    
    startVibrato(state, frequency) {
        this.stopVibratoOscillators(state);
        
        state.active = true;
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
        state.timeout = setTimeout(() => this.startVibratoLFO(state), 300);
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
        state.active = false;
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
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
