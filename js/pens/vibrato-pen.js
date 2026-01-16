// Pen 4: Single note with vibrato

import { Pen } from '../pen.js';

export class VibratoPen extends Pen {
    constructor(audioContext, bpm) {
        super(4, audioContext, bpm);
        this.oscillators = []; // Array for multi-oscillator sounds
        this.vibratoLFOs = []; // Array of LFOs for each oscillator
        this.lfoGains = []; // Keep references to update depth live
        this.gain = null;
        this.filter = null; // Master filter
        this.currentFrequency = null;
        this.baseFrequency = null; // Before octave shift
        this.vibratoStarted = false;
        this.volume = 0.6; // 0-1 range
        this.waveType = 'flute'; // sine, triangle, sawtooth, square, voice, flute, reed
        this.octaveShift = 1; // -2 to +2 octaves
        this.filterCutoff = 8000; // Hz
        this.breathAmount = 6; // 0-20%
        this.vibratoRate = 5; // Hz
        this.vibratoDepth = 2; // % of frequency
        this.vibratoTimeout = null; // Track timeout for cleanup
        this.breathTimeout = null; // Breath retrigger timer
        this.breathSteps = 16; // Retrigger every N steps (like taking a breath)
        this.setupControls();
    }

    setupControls() {
        const volumeSlider = document.getElementById('pen4VolumeSlider');
        const volumeValue = document.getElementById('pen4VolumeValue');
        const waveSelect = document.getElementById('pen4WaveSelect');
        const octaveSlider = document.getElementById('pen4OctaveSlider');
        const octaveValue = document.getElementById('pen4OctaveValue');
        const filterSlider = document.getElementById('pen4FilterSlider');
        const filterValue = document.getElementById('pen4FilterValue');
        const breathSlider = document.getElementById('pen4BreathSlider');
        const breathValue = document.getElementById('pen4BreathValue');
        const rateSlider = document.getElementById('pen4RateSlider');
        const rateValue = document.getElementById('pen4RateValue');
        const depthSlider = document.getElementById('pen4DepthSlider');
        const depthValue = document.getElementById('pen4DepthValue');

        if (volumeSlider && volumeValue) {
            volumeSlider.addEventListener('input', (e) => {
                this.volume = parseInt(e.target.value) / 100;
                volumeValue.textContent = `${parseInt(e.target.value)}%`;
                // Update gain if playing
                if (this.gain) {
                    const currentTime = this.audioContext.currentTime;
                    this.gain.gain.setValueAtTime(0.3 * this.volume, currentTime);
                }
            });
        }

        if (waveSelect) {
            waveSelect.addEventListener('change', (e) => {
                this.waveType = e.target.value;
                // Restart note to apply new sound
                this.restartIfPlaying();
            });
        }

        if (octaveSlider && octaveValue) {
            octaveSlider.addEventListener('input', (e) => {
                this.octaveShift = parseInt(e.target.value);
                octaveValue.textContent = this.octaveShift > 0 ? `+${this.octaveShift}` : `${this.octaveShift}`;
                // Restart note to apply new octave
                this.restartIfPlaying();
            });
        }

        if (filterSlider && filterValue) {
            filterSlider.addEventListener('input', (e) => {
                this.filterCutoff = parseInt(e.target.value);
                filterValue.textContent = `${this.filterCutoff}Hz`;
                // Update filter if playing
                if (this.filter) {
                    this.filter.frequency.setValueAtTime(this.filterCutoff, this.audioContext.currentTime);
                }
            });
        }

        if (breathSlider && breathValue) {
            breathSlider.addEventListener('input', (e) => {
                this.breathAmount = parseInt(e.target.value);
                breathValue.textContent = `${this.breathAmount}%`;
                // Restart note to apply new breath amount
                this.restartIfPlaying();
            });
        }

        if (rateSlider && rateValue) {
            rateSlider.addEventListener('input', (e) => {
                this.vibratoRate = parseFloat(e.target.value);
                rateValue.textContent = `${this.vibratoRate}Hz`;
                // Update all LFOs if playing
                if (this.vibratoLFOs.length > 0) {
                    const currentTime = this.audioContext.currentTime;
                    this.vibratoLFOs.forEach(lfo => {
                        lfo.frequency.setValueAtTime(this.vibratoRate, currentTime);
                    });
                }
            });
        }

        if (depthSlider && depthValue) {
            depthSlider.addEventListener('input', (e) => {
                this.vibratoDepth = parseFloat(e.target.value);
                depthValue.textContent = `${this.vibratoDepth}%`;
                // Update all LFO gains if playing
                if (this.lfoGains.length > 0 && this.currentFrequency) {
                    const currentTime = this.audioContext.currentTime;
                    this.lfoGains.forEach(({ gain, ratio }) => {
                        const depth = this.currentFrequency * (this.vibratoDepth / 100) * ratio;
                        gain.gain.setValueAtTime(depth, currentTime);
                    });
                }
            });
        }
    }

    restartIfPlaying() {
        if (this.baseFrequency && this.oscillators.length > 0) {
            // Immediate cleanup for instant switch
            if (this.vibratoTimeout) {
                clearTimeout(this.vibratoTimeout);
                this.vibratoTimeout = null;
            }
            this.stopAllOscillators();
            this.vibratoStarted = false;
            // Start fresh
            this.startNote(this.baseFrequency);
        }
    }

    onTileEnter(tile) {
        const frequency = parseFloat(tile.dataset.frequency);
        this.baseFrequency = frequency; // Store original frequency before octave shift
        this.startNote(frequency);
    }

    onTileStay(tile) {
        const frequency = parseFloat(tile.dataset.frequency);
        if (frequency !== this.baseFrequency) {
            this.baseFrequency = frequency;
            const shiftedFrequency = frequency * Math.pow(2, this.octaveShift);
            this.shiftToNote(shiftedFrequency);
            this.currentFrequency = shiftedFrequency;
        }
    }

    onTileLeave() {
        this.stopNote();
    }

    startNote(frequency) {
        // Ensure audio context is available
        if (!this.audioContext && window.musicPlayer && window.musicPlayer.audioContext) {
            this.audioContext = window.musicPlayer.audioContext;
        }
        
        if (!this.audioContext) return;
        
        // Stop any existing note before starting new one
        this.stopAllOscillators();
        
        this.vibratoStarted = false;
        this.oscillators = [];
        this.vibratoLFOs = [];
        this.lfoGains = [];
        
        // Apply octave shift
        const shiftedFrequency = frequency * Math.pow(2, this.octaveShift);
        this.currentFrequency = shiftedFrequency;
        
        // Create master filter
        this.filter = this.audioContext.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = this.filterCutoff;
        this.filter.Q.value = 1;
        
        // Create main gain node
        this.gain = this.audioContext.createGain();
        this.gain.connect(this.filter);
        this.filter.connect(this.audioContext.destination);
        
        // Create oscillators based on wave type
        if (this.waveType === 'voice') {
            this.createVoiceSound(shiftedFrequency);
        } else if (this.waveType === 'flute') {
            this.createFluteSound(shiftedFrequency);
        } else if (this.waveType === 'reed') {
            this.createReedSound(shiftedFrequency);
        } else {
            // Standard oscillator types
            this.createSimpleOscillator(shiftedFrequency, this.waveType);
        }
        
        // Initial volume - fade in smoothly
        const currentTime = this.audioContext.currentTime;
        this.gain.gain.setValueAtTime(0, currentTime);
        this.gain.gain.linearRampToValueAtTime(0.3 * this.volume, currentTime + 0.08);
        
        // Start all oscillators
        this.oscillators.forEach(osc => osc.start());
        
        // Start vibrato after 0.3 seconds
        this.vibratoTimeout = setTimeout(() => {
            this.startVibrato();
        }, 300);
        
        // Schedule breath retrigger (like catching breath while singing)
        this.scheduleBreathRetrigger();
    }
    
    scheduleBreathRetrigger() {
        // Clear any existing breath timeout
        if (this.breathTimeout) {
            clearTimeout(this.breathTimeout);
        }
        
        // Calculate breath duration based on BPM and steps, aligned to measure
        const beatDuration = 60 / this.bpm;
        const sixteenthNote = beatDuration / 4;
        const measureDuration = beatDuration * 4;
        const breathDuration = sixteenthNote * this.breathSteps; // in seconds
        
        // Use internal metronome for timing alignment (same as bass/drums)
        const currentSystemTime = this.audioContext.currentTime;
        let nextBreathTime;
        
        if (this.internalMetronome && this.internalMetronome.running) {
            const elapsed = currentSystemTime - this.internalMetronome.startTime;
            const measureNumber = Math.floor(elapsed / measureDuration);
            const currentMeasureStart = this.internalMetronome.startTime + (measureNumber * measureDuration);
            // Schedule breath at next measure boundary after breathDuration
            nextBreathTime = currentMeasureStart + breathDuration;
            if (nextBreathTime <= currentSystemTime) {
                nextBreathTime += measureDuration;
            }
        } else {
            nextBreathTime = currentSystemTime + breathDuration;
        }
        
        const delay = (nextBreathTime - currentSystemTime) * 1000;
        
        this.breathTimeout = setTimeout(() => {
            if (this.baseFrequency && this.oscillators.length > 0) {
                // Quick fade out
                const now = this.audioContext.currentTime;
                if (this.gain) {
                    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
                    this.gain.gain.linearRampToValueAtTime(0.01, now + 0.1);
                }
                
                // Retrigger after fade
                setTimeout(() => {
                    if (this.baseFrequency) {
                        this.stopAllOscillators();
                        this.vibratoStarted = false;
                        this.startNote(this.baseFrequency);
                    }
                }, 120);
            }
        }, Math.max(delay, 100));
    }
    
    stopAllOscillators() {
        this.oscillators.forEach(osc => {
            try { osc.stop(); } catch (e) {}
        });
        this.vibratoLFOs.forEach(lfo => {
            try { lfo.stop(); } catch (e) {}
        });
        this.oscillators = [];
        this.vibratoLFOs = [];
        this.lfoGains = [];
    }
    
    createSimpleOscillator(frequency, type) {
        const osc = this.audioContext.createOscillator();
        osc.type = type;
        osc.frequency.value = frequency;
        osc.connect(this.gain);
        this.oscillators.push(osc);
    }
    
    createVoiceSound(frequency) {
        // Singing voice using formant synthesis
        // Formants are resonant frequencies that shape vowel sounds
        
        // Female "ah" vowel formants (soprano)
        const formants = [
            { freq: 800, gain: 1.0, Q: 10 },   // F1 - openness
            { freq: 1150, gain: 0.63, Q: 12 }, // F2 - front/back
            { freq: 2900, gain: 0.25, Q: 14 }, // F3 - presence
            { freq: 3900, gain: 0.1, Q: 14 },  // F4 - brightness
            { freq: 4950, gain: 0.05, Q: 14 }  // F5 - air
        ];
        
        // Create harmonically rich source (sawtooth has all harmonics)
        // Use multiple slightly detuned for choir effect
        const detuneAmounts = [-8, 0, 8];
        
        detuneAmounts.forEach(detune => {
            const osc = this.audioContext.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = frequency;
            osc.detune.value = detune;
            
            // Create formant filter bank for this oscillator
            const formantMix = this.audioContext.createGain();
            formantMix.gain.value = 0.15; // Scale down the harsh sawtooth
            
            formants.forEach(formant => {
                const filter = this.audioContext.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.value = formant.freq;
                filter.Q.value = formant.Q;
                
                const formantGain = this.audioContext.createGain();
                formantGain.gain.value = formant.gain;
                
                osc.connect(filter);
                filter.connect(formantGain);
                formantGain.connect(formantMix);
            });
            
            formantMix.connect(this.gain);
            this.oscillators.push(osc);
        });
        
        // Add subtle breath for realism
        if (this.breathAmount > 0) {
            this.addBreathNoise(frequency, this.breathAmount / 100 * 0.3);
        }
    }
    
    createFluteSound(frequency) {
        // Flute: fundamental + weak odd harmonics, breathy quality
        // Add noise for breath sound
        
        // Main tone - sine is pure like a flute
        const fundamental = this.audioContext.createOscillator();
        fundamental.type = 'sine';
        fundamental.frequency.value = frequency;
        fundamental.connect(this.gain);
        this.oscillators.push(fundamental);
        
        // Weak third harmonic
        const third = this.audioContext.createOscillator();
        const thirdGain = this.audioContext.createGain();
        third.type = 'sine';
        third.frequency.value = frequency * 3;
        thirdGain.gain.value = 0.08;
        third.connect(thirdGain);
        thirdGain.connect(this.gain);
        this.oscillators.push(third);
        
        // Add breath noise (controlled by breathAmount slider)
        if (this.breathAmount > 0) {
            this.addBreathNoise(frequency, this.breathAmount / 100);
        }
    }
    
    createReedSound(frequency) {
        // Reed/clarinet: strong odd harmonics (1, 3, 5, 7...)
        // Clarinets have a hollow, woody sound
        
        const harmonics = [1, 3, 5, 7, 9];
        const gains = [1.0, 0.5, 0.25, 0.15, 0.08];
        
        harmonics.forEach((harmonic, i) => {
            const osc = this.audioContext.createOscillator();
            const oscGain = this.audioContext.createGain();
            
            // Use square wave partials for that reedy buzz
            osc.type = 'sine';
            osc.frequency.value = frequency * harmonic;
            oscGain.gain.value = gains[i] * 0.4; // Scale down overall
            
            // Add slight lowpass to soften
            const filter = this.audioContext.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 3000;
            filter.Q.value = 1;
            
            osc.connect(filter);
            filter.connect(oscGain);
            oscGain.connect(this.gain);
            this.oscillators.push(osc);
        });
        
        // Add subtle breath/air (controlled by breathAmount slider)
        if (this.breathAmount > 0) {
            this.addBreathNoise(frequency, this.breathAmount / 100 * 0.5); // Reed uses less breath
        }
    }
    
    addBreathNoise(frequency, amount) {
        // Create filtered noise for breathy quality
        const bufferSize = this.audioContext.sampleRate * 2;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noise = this.audioContext.createBufferSource();
        noise.buffer = noiseBuffer;
        noise.loop = true;
        
        const noiseFilter = this.audioContext.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = frequency * 2;
        noiseFilter.Q.value = 2;
        
        const noiseGain = this.audioContext.createGain();
        noiseGain.gain.value = amount;
        
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.gain);
        
        // Don't start here - let startNote's forEach handle it
        this.oscillators.push(noise); // Track for cleanup
    }

    startVibrato() {
        if (!this.audioContext || this.oscillators.length === 0 || this.vibratoStarted) return;
        
        this.vibratoStarted = true;
        
        // Create vibrato LFO for each oscillator
        this.oscillators.forEach((osc, i) => {
            // Skip noise sources (they don't have frequency param like oscillators)
            if (!osc.frequency) return;
            
            const lfo = this.audioContext.createOscillator();
            const lfoGain = this.audioContext.createGain();
            
            lfo.type = 'sine';
            lfo.frequency.value = this.vibratoRate;
            
            // Scale depth based on oscillator's frequency ratio to fundamental
            const freqRatio = osc.frequency.value / this.currentFrequency;
            const depth = this.currentFrequency * (this.vibratoDepth / 100) * freqRatio;
            lfoGain.gain.value = depth;
            
            // Connect LFO to oscillator frequency
            lfo.connect(lfoGain);
            lfoGain.connect(osc.frequency);
            
            lfo.start();
            this.vibratoLFOs.push(lfo);
            this.lfoGains.push({ gain: lfoGain, ratio: freqRatio });
        });
    }

    shiftToNote(frequency) {
        if (this.oscillators.length > 0 && this.gain) {
            const currentTime = this.audioContext.currentTime;
            const oldFreq = this.currentFrequency;
            const crossfadeTime = 0.05; // Quick crossfade to avoid clicks
            
            // Fade down
            this.gain.gain.setValueAtTime(this.gain.gain.value, currentTime);
            this.gain.gain.linearRampToValueAtTime(0.05 * this.volume, currentTime + crossfadeTime);
            
            // Change frequencies at the low point
            setTimeout(() => {
                if (!this.oscillators.length || !this.gain) return;
                
                const now = this.audioContext.currentTime;
                
                this.oscillators.forEach(osc => {
                    // Skip noise sources
                    if (!osc.frequency) return;
                    
                    // Calculate the ratio this oscillator has to fundamental
                    const ratio = osc.frequency.value / oldFreq;
                    const newFreq = frequency * ratio;
                    
                    osc.frequency.setValueAtTime(newFreq, now);
                });
                
                // Update LFO depths for new frequency
                this.lfoGains.forEach(({ gain, ratio }) => {
                    const depth = frequency * (this.vibratoDepth / 100) * ratio;
                    gain.gain.setValueAtTime(depth, now);
                });
                
                this.currentFrequency = frequency;
                
                // Fade back up
                this.gain.gain.setValueAtTime(0.05 * this.volume, now);
                this.gain.gain.linearRampToValueAtTime(0.3 * this.volume, now + crossfadeTime);
            }, crossfadeTime * 1000);
        }
    }

    stopNote() {
        // Clear vibrato timeout to prevent orphaned callbacks
        if (this.vibratoTimeout) {
            clearTimeout(this.vibratoTimeout);
            this.vibratoTimeout = null;
        }
        
        // Clear breath timeout
        if (this.breathTimeout) {
            clearTimeout(this.breathTimeout);
            this.breathTimeout = null;
        }
        
        if (this.gain && this.audioContext) {
            const currentTime = this.audioContext.currentTime;
            this.gain.gain.exponentialRampToValueAtTime(0.01, currentTime + 0.1);
            
            // Stop all oscillators after fade
            setTimeout(() => {
                this.stopAllOscillators();
            }, 150);
        } else {
            this.stopAllOscillators();
        }
        
        this.vibratoStarted = false;
        this.currentFrequency = null;
        this.baseFrequency = null;
        this.filter = null;
    }
}
