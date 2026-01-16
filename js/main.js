// Entry point for the music player application

import { MusicPlayer } from './music-player.js';
import { DrumPen } from './pens/drum-pen.js';
import { BassPen } from './pens/bass-pen.js';
import { ArpeggioPen } from './pens/arpeggio-pen.js';
import { VibratoPen } from './pens/vibrato-pen.js';

// Initialize the music player when page loads
window.addEventListener('DOMContentLoaded', async () => {
    const player = new MusicPlayer();
    
    // Store player globally for pen initialization
    window.musicPlayer = player;
    
    // Initialize audio and pens on first interaction
    const initPens = async () => {
        try {
            // Ensure audio context is ready
            await player.initAudio();
            
            // Wait for audio context to be running
            if (player.audioContext) {
                if (player.audioContext.state === 'suspended') {
                    await player.audioContext.resume();
                }
                
                // Create pens after audio is ready
                if (!player.pens && player.audioContext.state === 'running') {
                    const pens = [
                        new DrumPen(player.audioContext, player.bpm),
                        new BassPen(player.audioContext, player.bpm),
                        new ArpeggioPen(player.audioContext, player.bpm),
                        new VibratoPen(player.audioContext, player.bpm)
                    ];
                    
                    // Store pens in player for access
                    player.pens = pens;
                } else if (player.audioContext.state !== 'running') {
                    // Retry if audio context isn't running yet
                    setTimeout(initPens, 100);
                }
            }
        } catch (error) {
            console.error('Error initializing pens:', error);
        }
    };
    
    // Initialize on any interaction (click anywhere on page)
    const initOnInteraction = (e) => {
        initPens();
    };
    
    document.addEventListener('mousedown', initOnInteraction, { once: true });
    document.addEventListener('touchstart', initOnInteraction, { once: true });
    document.addEventListener('click', initOnInteraction, { once: true });
});
