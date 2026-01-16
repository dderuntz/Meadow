// Meadow Studio - Three.js Entry Point

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { StudioAudioEngine } from './audio-adapter.js';

// Scene globals
let scene, camera, renderer, controls;
let paper, pens = [];
let raycaster, mouse;
let draggedPen = null;
let dragPlane;
let audioEngine = null;
let pmremGenerator, envMap, cubeCamera, cubeRenderTarget;
let woodTexture;
const woodContrast = 1.5;

// Painting canvas for color sampling
let paintingMesh = null;
let paintingImageData = null;
let paintingCanvas = null;
const PAINTING_WIDTH = 9;  // Will be adjusted by aspect ratio
const PAINTING_HEIGHT = 7;

// Groups for positioning
let paperGroup = null;
let paintingGroup = null;
let paintingFrame = null; // Reference for thickness control

// Post-processing
let composer, colorCorrectionPass, bloomPass;
const colorCorrectionShader = {
    uniforms: {
        tDiffuse: { value: null },
        contrast: { value: 0.85 },
        saturation: { value: 1.0 },
        brightness: { value: -0.18 },
        blackPoint: { value: 0.0 },
        whitePoint: { value: 1.0 },
        gamma: { value: 0.65 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float contrast;
        uniform float saturation;
        uniform float brightness;
        uniform float blackPoint;
        uniform float whitePoint;
        uniform float gamma;
        varying vec2 vUv;
        
        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
            // Levels adjustment (black point, white point, gamma)
            color.rgb = clamp((color.rgb - blackPoint) / (whitePoint - blackPoint), 0.0, 1.0);
            color.rgb = pow(color.rgb, vec3(1.0 / gamma));
            
            // Brightness
            color.rgb += brightness;
            
            // Contrast
            color.rgb = (color.rgb - 0.5) * contrast + 0.5;
            
            // Saturation
            float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
            color.rgb = mix(vec3(gray), color.rgb, saturation);
            
            gl_FragColor = color;
        }
    `
};

// Lighting refs for controls
let mainLight, ambientLight;
let tableTexture; // For wood texture controls
let tableMaterial; // For polish control
let woodContrastUniform = { value: 1.2 }; // Wood texture contrast
let penLightIntensity = 1.5; // Base intensity for pen lights
let screenGlowIntensity = 0.15; // Screen glow intensity (emissive)
let screenLightIntensity = 2.0; // Screen RectAreaLight intensity

// Default camera position and target
const DEFAULT_CAMERA_POS = new THREE.Vector3(-3.6, 13.4, 17.0);
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(3.4, 0.9, 4.5);
let isResettingCamera = false;

// Paper dimensions (roughly A4 proportions)
const PAPER_WIDTH = 12;
const PAPER_HEIGHT = 16;

// Color regions on the paper (chromatic scale)
const NOTE_COLORS = [
    { note: 'C', frequency: 261.63, hue: 0 },
    { note: 'C#', frequency: 277.18, hue: 30 },
    { note: 'D', frequency: 293.66, hue: 60 },
    { note: 'D#', frequency: 311.13, hue: 90 },
    { note: 'E', frequency: 329.63, hue: 120 },
    { note: 'F', frequency: 349.23, hue: 150 },
    { note: 'F#', frequency: 369.99, hue: 180 },
    { note: 'G', frequency: 392.00, hue: 210 },
    { note: 'G#', frequency: 415.30, hue: 240 },
    { note: 'A', frequency: 440.00, hue: 270 },
    { note: 'A#', frequency: 466.16, hue: 300 },
    { note: 'B', frequency: 493.88, hue: 330 }
];

// Pen modes - can be cycled on click
const PEN_MODES = [
    { id: 1, name: 'Drum', emoji: '🥁' },
    { id: 2, name: 'Frog', emoji: '🐸' },
    { id: 3, name: 'Fairy', emoji: '🧚' },
    { id: 4, name: 'Robin', emoji: '🐦' }
];

// Pen configurations - all purple, same pen with 4 modes
// Defaults: 3 pens tipped on table, 1 (fairy) standing on paper playing
const PEN_CONFIGS = [
    { id: 1, name: 'Drum', color: 0xd5dee0, emoji: '🥁', modeIndex: 0, 
      defaultX: 0.2, defaultZ: -7.7, tipped: true },
    { id: 2, name: 'Frog', color: 0xd5dee0, emoji: '🐸', modeIndex: 1,
      defaultX: 7.4, defaultZ: -7.0, tipped: true },
    { id: 3, name: 'Fairy', color: 0xd5dee0, emoji: '🧚', modeIndex: 2,
      defaultX: -5.0, defaultZ: 6.5, tipped: false }, // Standing in white gap - requires drag to play
    { id: 4, name: 'Robin', color: 0xd5dee0, emoji: '🐦', modeIndex: 3,
      defaultX: 5.4, defaultZ: 8.7, tipped: true }
];

// Track mouse position for click detection
let mouseDownPos = { x: 0, y: 0 };
let isDragging = false;
const CLICK_THRESHOLD = 5; // pixels

function init() {
    // Scene - darker for bake, lightened after
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcccccc);
    scene.fog = new THREE.Fog(0xcccccc, 20, 60);
    
    // Camera - looking down at paper at an angle
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(-3.6, 13.4, 17.0);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.7;
    document.body.appendChild(renderer.domElement);
    
    // Initialize RectAreaLight support
    RectAreaLightUniformsLib.init();
    
    // Post-processing setup
    composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    
    // Bloom pass for screen glow effect
    bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.15,  // strength
        0.4,   // radius
        0.89   // threshold
    );
    composer.addPass(bloomPass);
    
    colorCorrectionPass = new ShaderPass(colorCorrectionShader);
    composer.addPass(colorCorrectionPass);
    
    // OutputPass applies tone mapping and color space conversion
    const outputPass = new OutputPass();
    composer.addPass(outputPass);
    
    // Load wood texture
    const textureLoader = new THREE.TextureLoader();
    woodTexture = textureLoader.load('images/wood.png');
    woodTexture.wrapS = THREE.RepeatWrapping;
    woodTexture.wrapT = THREE.RepeatWrapping;
    woodTexture.repeat.set(2, 2);
    
    // HDRI Environment map for reflections
    pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    
    // Cube camera for baked reflections (captures scene + HDRI)
    cubeRenderTarget = new THREE.WebGLCubeRenderTarget(512, {
        format: THREE.RGBFormat,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter
    });
    cubeCamera = new THREE.CubeCamera(0.1, 100, cubeRenderTarget);
    
    loadEnvironmentMap();
    
    // Controls (limited - mostly for dev)
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2.2; // Don't let camera go below paper
    controls.minDistance = 10;
    controls.maxDistance = 40;
    controls.target.set(3.4, 0.9, 4.5); // Look at this point
    
    // Raycaster for pen interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    
    // Drag plane (invisible plane for pen dragging - large enough for paper + painting)
    const dragPlaneGeo = new THREE.PlaneGeometry(150, 150);
    const dragPlaneMat = new THREE.MeshBasicMaterial({ visible: false });
    dragPlane = new THREE.Mesh(dragPlaneGeo, dragPlaneMat);
    dragPlane.rotation.x = -Math.PI / 2;
    dragPlane.position.y = 0.45; // Pen base height
    scene.add(dragPlane);
    
    // Lighting
    setupLighting();
    
    // Create paper with color regions
    createPaper();
    
    // Create painting canvas (still life)
    createPaintingCanvas();
    
    // Create pens
    createPens();
    
    // Event listeners
    setupEventListeners();
    setupLightingControls();
    
    // Initialize audio engine
    audioEngine = new StudioAudioEngine();
    
    // Hide loading
    setTimeout(() => {
        document.getElementById('loading').classList.add('hidden');
    }, 500);
    
    // Start animation
    animate();
}

function loadEnvironmentMap() {
    const loader = new THREE.TextureLoader();
    loader.load('images/AdobeStock_361336625.jpeg', (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        envMap = pmremGenerator.fromEquirectangular(texture).texture;
        
        // First set HDRI as environment so cube camera captures it
        scene.environment = envMap;
        
        // Bake reflections with cube camera after short delay
        setTimeout(() => {
            cubeCamera.position.set(0, 3, 0);
            cubeCamera.update(renderer, scene);
            // Use baked cube map for reflections (includes scene geometry + HDRI)
            scene.environment = cubeRenderTarget.texture;
            
            // Lighten background after bake
            scene.background = new THREE.Color(0xf5f5f5);
            scene.fog = new THREE.Fog(0xf5f5f5, 20, 60);
            
            // Update pen materials
            pens.forEach(pen => {
                pen.children.forEach(child => {
                    if (child.material && child.material.isMeshPhysicalMaterial) {
                        child.material.envMapIntensity = 1.2;
                        child.material.needsUpdate = true;
                    }
                });
            });
        }, 100);
        
        texture.dispose();
    });
}

function setupLighting() {
    // Ambient light
    ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    
    // Main directional light (sun-like)
    mainLight = new THREE.DirectionalLight(0xffffff, 1.7);
    mainLight.position.set(-19, 26, 30);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 4096;
    mainLight.shadow.mapSize.height = 4096;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 60;
    mainLight.shadow.camera.left = -20;
    mainLight.shadow.camera.right = 20;
    mainLight.shadow.camera.top = 20;
    mainLight.shadow.camera.bottom = -20;
    mainLight.shadow.bias = -0.0001;
    mainLight.shadow.radius = 4;
    scene.add(mainLight);
    
}

function createPaper() {
    // Create group for paper and all its elements
    paperGroup = new THREE.Group();
    paperGroup.position.set(-2, 0.25, 2.5); // X=-2, Z=2.5, Y=0.25
    scene.add(paperGroup);
    
    // Paper base - slightly off-white with subtle texture
    const paperGeo = new THREE.BoxGeometry(PAPER_WIDTH, 0.1, PAPER_HEIGHT);
    const paperMat = new THREE.MeshStandardMaterial({
        color: 0xfaf8f5,
        roughness: 0.85,
        metalness: 0
    });
    paper = new THREE.Mesh(paperGeo, paperMat);
    paper.receiveShadow = true;
    paper.castShadow = true;
    paper.position.y = 0.3;
    paper.scale.y = 0.6; // Default thickness
    paper.userData = { type: 'paperBase' }; // Mark as paper for white detection
    paperGroup.add(paper);
    
    // Mary Had a Little Lamb song pattern - no gaps between rows
    const MARY_LAMB = [
        { note: 'E', frequency: 329.63 },
        { note: 'D', frequency: 293.66 },
        { note: 'C', frequency: 261.63 },
        { note: 'D', frequency: 293.66 },
        { note: 'E', frequency: 329.63 },
        { note: 'E', frequency: 329.63 },
        { note: 'E', frequency: 329.63 },
        { note: 'D', frequency: 293.66 },
        { note: 'D', frequency: 293.66 },
        { note: 'D', frequency: 293.66 },
        { note: 'E', frequency: 329.63 },
        { note: 'G', frequency: 392.00 },
        { note: 'G', frequency: 392.00 },
        { note: 'E', frequency: 329.63 },
        { note: 'D', frequency: 293.66 },
        { note: 'C', frequency: 261.63 },
        { note: 'D', frequency: 293.66 },
        { note: 'E', frequency: 329.63 },
        { note: 'E', frequency: 329.63 },
        { note: 'E', frequency: 329.63 },
        { note: 'E', frequency: 329.63 },
        { note: 'D', frequency: 293.66 },
        { note: 'D', frequency: 293.66 },
        { note: 'E', frequency: 329.63 },
        { note: 'D', frequency: 293.66 },
        { note: 'C', frequency: 261.63 }
    ];
    
    // Get hue for a note
    const getHueForNote = (noteName) => {
        const noteData = NOTE_COLORS.find(n => n.note === noteName);
        return noteData ? noteData.hue : 0;
    };
    
    const margin = 0.8;
    
    // Layout - tiles per row and tile size (no gaps)
    const tilesPerRow = 9;
    const totalSongWidth = PAPER_WIDTH - margin * 2;
    const songTileWidth = totalSongWidth / tilesPerRow;
    const songTileHeight = 2.5; // Same as rainbow at bottom
    
    // Add "Mary Had a Little Lamb" title text
    const titleCanvas = document.createElement('canvas');
    titleCanvas.width = 512;
    titleCanvas.height = 64;
    const titleCtx = titleCanvas.getContext('2d');
    titleCtx.fillStyle = '#666666';
    titleCtx.font = 'italic 32px Georgia, serif';
    titleCtx.textAlign = 'center';
    titleCtx.textBaseline = 'middle';
    titleCtx.fillText('Mary Had a Little Lamb', 256, 32);
    
    const titleTexture = new THREE.CanvasTexture(titleCanvas);
    const titleGeo = new THREE.PlaneGeometry(8, 1);
    const titleMat = new THREE.MeshBasicMaterial({ 
        map: titleTexture, 
        transparent: true,
        depthWrite: false
    });
    const titleMesh = new THREE.Mesh(titleGeo, titleMat);
    titleMesh.rotation.x = -Math.PI / 2;
    titleMesh.position.set(0, 0.37, -PAPER_HEIGHT / 2 + 1.2);
    paperGroup.add(titleMesh);
    
    MARY_LAMB.forEach((noteData, i) => {
        const row = Math.floor(i / tilesPerRow);
        const col = i % tilesPerRow; // Always left-to-right like reading
        
        const tileGeo = new THREE.BoxGeometry(songTileWidth, 0.02, songTileHeight);
        const hue = getHueForNote(noteData.note);
        const color = new THREE.Color().setHSL(hue / 360, 0.7, 0.6);
        const tileMat = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.6,
            metalness: 0.05
        });
        
        const tile = new THREE.Mesh(tileGeo, tileMat);
        tile.position.x = -totalSongWidth / 2 + songTileWidth / 2 + col * songTileWidth;
        tile.position.y = 0.36;
        tile.position.z = -PAPER_HEIGHT / 2 + margin + 1.8 + songTileHeight / 2 + row * songTileHeight; // No gap between rows
        tile.receiveShadow = true;
        
        tile.userData = {
            type: 'colorStrip',
            note: noteData.note,
            frequency: noteData.frequency,
            hue: hue
        };
        
        paperGroup.add(tile);
    });
    
    // Add lamb emoji to the last empty spot (row 2, col 8 - end of third row)
    const lambCanvas = document.createElement('canvas');
    lambCanvas.width = 128;
    lambCanvas.height = 128;
    const lambCtx = lambCanvas.getContext('2d');
    lambCtx.fillStyle = '#f5f5f5';
    lambCtx.fillRect(0, 0, 128, 128);
    lambCtx.font = '80px Arial';
    lambCtx.textAlign = 'center';
    lambCtx.textBaseline = 'middle';
    lambCtx.fillText('🐑', 64, 68);
    
    const lambTexture = new THREE.CanvasTexture(lambCanvas);
    const lambGeo = new THREE.BoxGeometry(songTileWidth, 0.02, songTileHeight);
    const lambMat = new THREE.MeshStandardMaterial({ 
        map: lambTexture,
        roughness: 0.6,
        metalness: 0.05
    });
    const lambTile = new THREE.Mesh(lambGeo, lambMat);
    // Position at last spot (row 2, col 8 - end of third row)
    lambTile.position.x = -totalSongWidth / 2 + songTileWidth / 2 + 8 * songTileWidth;
    lambTile.position.y = 0.36;
    lambTile.position.z = -PAPER_HEIGHT / 2 + margin + 1.8 + songTileHeight / 2 + 2 * songTileHeight; // No gap
    lambTile.receiveShadow = true;
    paperGroup.add(lambTile);
    
    // Create chromatic color strips on the paper - bottom centered with margin
    const totalStripWidth = PAPER_WIDTH - margin * 2;
    const stripWidth = totalStripWidth / NOTE_COLORS.length;
    const stripHeight = 2.5;
    
    NOTE_COLORS.forEach((noteData, i) => {
        const stripGeo = new THREE.BoxGeometry(stripWidth, 0.02, stripHeight);
        const color = new THREE.Color().setHSL(noteData.hue / 360, 0.7, 0.6);
        const stripMat = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.6,
            metalness: 0.05
        });
        
        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.x = -totalStripWidth / 2 + stripWidth / 2 + i * stripWidth;
        strip.position.y = 0.36;
        strip.position.z = PAPER_HEIGHT / 2 - stripHeight / 2 - margin; // Bottom with margin
        strip.receiveShadow = true;
        
        strip.userData = {
            type: 'colorStrip',
            note: noteData.note,
            frequency: noteData.frequency,
            hue: noteData.hue
        };
        
        paperGroup.add(strip);
    });
    
    // Wood table with texture and contrast (double width for paper + painting)
    const tableGeo = new THREE.BoxGeometry(48, 0.8, 28);
    
    // Load separate texture instance for the table (avoid clone issues)
    const tableTextureLoader = new THREE.TextureLoader();
    tableTexture = tableTextureLoader.load('images/wood.png');
    tableTexture.wrapS = THREE.RepeatWrapping;
    tableTexture.wrapT = THREE.RepeatWrapping;
    tableTexture.repeat.set(2, 2.5); // Double X repeat for wider table
    
    tableMaterial = new THREE.MeshPhysicalMaterial({
        map: tableTexture,
        roughness: 0.8,  // Matte finish
        metalness: 0.0,
        clearcoat: 0.3,
        clearcoatRoughness: 0.1,
        reflectivity: 0.5,
        envMapIntensity: 0.3,  // Reduced HDRI reflection
        color: 0xffffff // Neutral - let texture show
    });
    
    // Add contrast to wood material (like pachinko)
    addContrastToMaterial(tableMaterial);
    
    const table = new THREE.Mesh(tableGeo, tableMaterial);
    table.position.y = -0.1;
    table.receiveShadow = true;
    table.castShadow = true;
    scene.add(table);
}

function addContrastToMaterial(material) {
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uContrast = woodContrastUniform;

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            uniform float uContrast;`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            #ifdef USE_MAP
                diffuseColor.rgb = (diffuseColor.rgb - 0.5) * uContrast + 0.5;
            #endif`
        );
    };
}

function createPaintingCanvas() {
    // Create group for painting and its frame
    paintingGroup = new THREE.Group();
    paintingGroup.position.set(8.5, -0.15, 1.0); // X=8.5, Z=1.0, Y=-0.15
    paintingGroup.scale.set(1.8, 1.8, 1.8); // Scale=1.8
    paintingGroup.rotation.y = -15 * Math.PI / 180; // Rotation=-15°
    scene.add(paintingGroup);
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = function() {
        // Store image data for pixel sampling
        paintingCanvas = document.createElement('canvas');
        paintingCanvas.width = img.width;
        paintingCanvas.height = img.height;
        const ctx = paintingCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        paintingImageData = ctx.getImageData(0, 0, img.width, img.height);
        
        // Calculate dimensions maintaining aspect ratio
        const aspectRatio = img.width / img.height;
        const paintingWidth = PAINTING_HEIGHT * aspectRatio;
        const paintingHeight = PAINTING_HEIGHT;
        const borderSize = 0.3;
        
        // Create white border frame (centered in group)
        const frameGeo = new THREE.BoxGeometry(paintingWidth + borderSize * 2, 0.1, paintingHeight + borderSize * 2);
        const frameMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.9,
            metalness: 0
        });
        paintingFrame = new THREE.Mesh(frameGeo, frameMat);
        paintingFrame.receiveShadow = true;
        paintingFrame.castShadow = true;
        paintingFrame.position.set(0, 0.3, 0); // Centered in group
        paintingFrame.scale.y = 0.6; // Default thickness (same as paper)
        paintingGroup.add(paintingFrame);
        
        // Create painting surface
        const paintingTexture = new THREE.Texture(img);
        paintingTexture.needsUpdate = true;
        
        const paintingGeo = new THREE.PlaneGeometry(paintingWidth, paintingHeight);
        const paintingMat = new THREE.MeshStandardMaterial({
            map: paintingTexture,
            roughness: 0.8,
            metalness: 0
        });
        
        paintingMesh = new THREE.Mesh(paintingGeo, paintingMat);
        paintingMesh.rotation.x = -Math.PI / 2;
        paintingMesh.position.set(0, 0.36, 0); // Centered in group
        paintingMesh.receiveShadow = true;
        
        // Store dimensions for UV calculations
        paintingMesh.userData = {
            type: 'painting',
            width: paintingWidth,
            height: paintingHeight,
            imageWidth: img.width,
            imageHeight: img.height
        };
        
        paintingGroup.add(paintingMesh);
        
        console.log('Painting canvas loaded:', img.width, 'x', img.height);
    };
    
    img.src = 'images/tahiti.png';
}

function samplePaintingColor(uv) {
    if (!paintingImageData || !paintingCanvas) return null;
    
    // UV coordinates: (0,0) is bottom-left, (1,1) is top-right
    // Image coordinates: (0,0) is top-left
    const centerX = Math.floor(uv.x * (paintingCanvas.width - 1));
    const centerY = Math.floor((1 - uv.y) * (paintingCanvas.height - 1)); // Flip Y
    
    // Sample a 5x5 area and average the colors
    const sampleRadius = 2; // 5x5 grid
    let totalR = 0, totalG = 0, totalB = 0;
    let sampleCount = 0;
    
    for (let dy = -sampleRadius; dy <= sampleRadius; dy++) {
        for (let dx = -sampleRadius; dx <= sampleRadius; dx++) {
            const x = Math.max(0, Math.min(paintingCanvas.width - 1, centerX + dx));
            const y = Math.max(0, Math.min(paintingCanvas.height - 1, centerY + dy));
            
            const index = (y * paintingCanvas.width + x) * 4;
            totalR += paintingImageData.data[index];
            totalG += paintingImageData.data[index + 1];
            totalB += paintingImageData.data[index + 2];
            sampleCount++;
        }
    }
    
    return {
        r: Math.round(totalR / sampleCount),
        g: Math.round(totalG / sampleCount),
        b: Math.round(totalB / sampleCount)
    };
}

function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    
    if (max === min) {
        h = s = 0; // achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    
    return {
        h: h * 360, // 0-360
        s: s,       // 0-1
        l: l        // 0-1
    };
}

function findClosestNoteByHue(hue) {
    let closestNote = NOTE_COLORS[0];
    let minDiff = Infinity;
    
    NOTE_COLORS.forEach(noteData => {
        // Calculate circular distance on hue wheel
        let diff = Math.abs(hue - noteData.hue);
        if (diff > 180) diff = 360 - diff;
        
        if (diff < minDiff) {
            minDiff = diff;
            closestNote = noteData;
        }
    });
    
    return closestNote;
}

function createPens() {
    PEN_CONFIGS.forEach((config, i) => {
        const penGroup = new THREE.Group();
        
        // Pen dimensions
        const penRadius = 0.7;
        const penHeight = 3.0;
        const topBevelRadius = penRadius * 0.3; // Smaller bevel = bigger screen
        const bottomBevelRadius = penRadius * 0.3; // Smaller bevel at bottom
        const topBevelSegments = 8;
        const bottomBevelSegments = 4;
        
        // Split pen into bottom 2/3 (plastic) and top 1/3 (wood)
        const woodStartHeight = penHeight * 0.67; // Where wood section begins
        
        // BOTTOM SECTION (plastic) - from bottom to woodStartHeight with chamfer
        const chamferSize = 0.06; // Size of chamfer at junction
        const chamferSteps = 3;
        
        const bottomPoints = [];
        bottomPoints.push(new THREE.Vector2(0, 0));
        
        // Bottom bevel
        for (let j = 0; j <= bottomBevelSegments; j++) {
            const angle = (Math.PI / 2) - (j / bottomBevelSegments) * (Math.PI / 2);
            const x = penRadius - bottomBevelRadius + Math.cos(angle) * bottomBevelRadius;
            const y = bottomBevelRadius - Math.sin(angle) * bottomBevelRadius;
            bottomPoints.push(new THREE.Vector2(x, y));
        }
        
        // Straight body up to chamfer start
        bottomPoints.push(new THREE.Vector2(penRadius, woodStartHeight - chamferSize));
        
        // 3-step chamfer at top of plastic section
        for (let j = 1; j <= chamferSteps; j++) {
            const t = j / chamferSteps;
            const x = penRadius - (chamferSize * t * 0.5); // Slight inward angle
            const y = woodStartHeight - chamferSize + (chamferSize * t);
            bottomPoints.push(new THREE.Vector2(x, y));
        }
        
        // Close the bottom section at the inside
        bottomPoints.push(new THREE.Vector2(0, woodStartHeight));
        
        const bottomGeo = new THREE.LatheGeometry(bottomPoints, 32);
        
        // Plastic material
        const bodyMat = new THREE.MeshPhysicalMaterial({
            color: config.color,
            roughness: 0.7,
            metalness: 0.0,
            clearcoat: 0.1,
            clearcoatRoughness: 0.8,
            reflectivity: 0.2,
            envMapIntensity: 0.3
        });
        
        const bottomBody = new THREE.Mesh(bottomGeo, bodyMat);
        bottomBody.castShadow = true;
        bottomBody.receiveShadow = true;
        penGroup.add(bottomBody);
        
        // TOP SECTION (wood) - from woodStartHeight to top with bevel
        const topPoints = [];
        topPoints.push(new THREE.Vector2(0, woodStartHeight));
        
        // Start at the chamfer edge (slightly inward)
        topPoints.push(new THREE.Vector2(penRadius - chamferSize * 0.5, woodStartHeight));
        
        // Small step out to full radius
        topPoints.push(new THREE.Vector2(penRadius, woodStartHeight + chamferSize * 0.3));
        
        // Straight body up to where top bevel starts
        topPoints.push(new THREE.Vector2(penRadius, penHeight - topBevelRadius));
        
        // Top bevel (8 segments of a quarter circle)
        for (let j = 0; j <= topBevelSegments; j++) {
            const angle = (j / topBevelSegments) * (Math.PI / 2);
            const x = penRadius - topBevelRadius + Math.cos(angle) * topBevelRadius;
            const y = penHeight - topBevelRadius + Math.sin(angle) * topBevelRadius;
            topPoints.push(new THREE.Vector2(x, y));
        }
        
        const topGeo = new THREE.LatheGeometry(topPoints, 32);
        
        // Project UVs straight through (like real wood grain)
        // Fixed: 90° rotation, 0.2 scale, X offset 0.65
        const uvAttr = topGeo.attributes.uv;
        const posAttr = topGeo.attributes.position;
        const woodAngle = Math.PI / 2;
        const woodScale = 0.2;
        const woodOffsetX = 0.65;
        for (let j = 0; j < uvAttr.count; j++) {
            const x = posAttr.getX(j);
            const y = posAttr.getY(j);
            const u = x * 0.5 + 0.5;
            const v = y * 0.3;
            const cu = u - 0.5;
            const cv = v - 0.5;
            const ru = cu * Math.cos(woodAngle) - cv * Math.sin(woodAngle);
            const rv = cu * Math.sin(woodAngle) + cv * Math.cos(woodAngle);
            uvAttr.setXY(j, (ru + 0.5) * woodScale + woodOffsetX, (rv + 0.5) * woodScale);
        }
        uvAttr.needsUpdate = true;
        
        // Wood material
        const penWoodTexture = woodTexture.clone();
        penWoodTexture.needsUpdate = true;
        penWoodTexture.wrapS = THREE.RepeatWrapping;
        penWoodTexture.wrapT = THREE.RepeatWrapping;
        
        const woodMat = new THREE.MeshStandardMaterial({
            map: penWoodTexture,
            roughness: 0.5,
            metalness: 0.0,
            envMapIntensity: 0.2
        });
        
        const topBody = new THREE.Mesh(topGeo, woodMat);
        topBody.castShadow = true;
        topBody.receiveShadow = true;
        topBody.userData.isWoodSection = true;
        topBody.userData.woodStartHeight = woodStartHeight;
        topBody.userData.penHeight = penHeight;
        penGroup.add(topBody);
        
        // Glowing screen with glass bubble dome
        const topCapRadius = penRadius - topBevelRadius; // Inner radius at top of bevel
        const glassHeight = 0.06; // Height of the dome
        const glassFloat = 0.01; // Tiny gap above screen
        
        // SCREEN - flush with pen top, emissive
        const screenGeo = new THREE.CircleGeometry(topCapRadius, 32);
        
        // Create canvas texture with emoji on darker background (for emissive)
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#8a9496'; // Darker grey-blue for emissive screen
        ctx.fillRect(0, 0, 128, 128);
        ctx.font = '72px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#222222'; // Dark emoji
        ctx.fillText(config.emoji, 64, 68);
        
        const screenTexture = new THREE.CanvasTexture(canvas);
        
        const screenMat = new THREE.MeshStandardMaterial({
            map: screenTexture,
            roughness: 0.4,
            metalness: 0.0,
            emissive: 0xffffff,
            emissiveMap: screenTexture,
            emissiveIntensity: screenGlowIntensity // Glow controlled by slider
        });
        const screen = new THREE.Mesh(screenGeo, screenMat);
        screen.rotation.x = -Math.PI / 2; // Face up
        screen.position.y = penHeight; // Flush with top
        penGroup.add(screen);
        
        // GLASS DOME LENS - solid lens shape with thickness
        const domeSegments = 16;
        const lensThickness = 0.025; // Thickness at the edge
        const glassPoints = [];
        
        // Start at center bottom (inside of lens)
        glassPoints.push(new THREE.Vector2(0, 0));
        
        // Bottom surface - flat or very slightly curved
        glassPoints.push(new THREE.Vector2(topCapRadius * 0.95, 0));
        
        // Edge/side wall
        glassPoints.push(new THREE.Vector2(topCapRadius, 0));
        glassPoints.push(new THREE.Vector2(topCapRadius, lensThickness));
        
        // Top dome surface - curve from edge up to center peak
        for (let j = domeSegments; j >= 0; j--) {
            const t = j / domeSegments;
            const r = t * topCapRadius;
            const h = lensThickness + (1 - t * t) * glassHeight; // Dome above the edge thickness
            glassPoints.push(new THREE.Vector2(r, h));
        }
        
        const glassGeo = new THREE.LatheGeometry(glassPoints, 32);
        
        const glassMat = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.3,
            roughness: 0.0, // Super glossy
            metalness: 0.0,
            transmission: 0.85,
            thickness: 0.05,
            ior: 1.5,
            envMapIntensity: 0.8, // Catch reflections
            clearcoat: 1.0,
            clearcoatRoughness: 0.0
        });
        const glassDome = new THREE.Mesh(glassGeo, glassMat);
        glassDome.position.y = penHeight + glassFloat; // Float just above screen
        penGroup.add(glassDome);
        
        // Scan light - RectAreaLight at the bottom of pen (scan area)
        const scanLightSize = penRadius * 1.2;
        const screenLight = new THREE.RectAreaLight(0xffffff, screenLightIntensity * 5, scanLightSize, scanLightSize);
        screenLight.position.set(0, 0.1, 0); // Near bottom of pen
        screenLight.lookAt(0, -1, 0); // Look downward toward paper/table
        penGroup.add(screenLight);
        
        // Keep references for updates
        const topCap = screen;
        screen.userData.isScreen = true; // Tag for glow slider
        screen.userData.canvas = canvas;
        screen.userData.ctx = ctx;
        screen.userData.texture = screenTexture;
        screen.userData.emoji = config.emoji;
        screen.userData.defaultColor = '#8a9496';
        
        // Glass/plastic washer at the bottom
        const washerOuterRadius = penRadius * 0.85;
        const washerInnerRadius = penRadius * 0.4;
        const washerHeight = 0.12;
        
        // Create washer profile (rectangular cross-section ring)
        const washerPoints = [];
        
        // Trace the washer cross-section: outer wall down, bottom, inner wall up, top
        washerPoints.push(new THREE.Vector2(washerOuterRadius, 0));           // Outer top
        washerPoints.push(new THREE.Vector2(washerOuterRadius, -washerHeight)); // Outer bottom
        washerPoints.push(new THREE.Vector2(washerInnerRadius, -washerHeight)); // Inner bottom
        washerPoints.push(new THREE.Vector2(washerInnerRadius, 0));           // Inner top
        
        const washerGeo = new THREE.LatheGeometry(washerPoints, 32);
        
        // Translucent glass/plastic material with emissive glow
        const washerMat = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            emissive: new THREE.Color(config.color),
            emissiveIntensity: 5.0,
            roughness: 0.1,
            metalness: 0.0,
            transparent: true,
            opacity: 0.7,
            clearcoat: 0.5,
            clearcoatRoughness: 0.1,
            depthWrite: false
        });
        
        const washer = new THREE.Mesh(washerGeo, washerMat);
        washer.position.y = -0.02; // Tiny gap below pen body to avoid z-fighting
        washer.castShadow = false;
        washer.receiveShadow = false;
        washer.name = 'washer'; // For toggling visibility
        washer.visible = true; // Default on
        washer.userData.penRadius = penRadius; // Store for resizing
        washer.userData.material = washerMat; // Store for glow control
        penGroup.add(washer);
        
        // Light at bottom of washer (shines down onto table/paper) - warm white
        // TEMPORARILY DISABLED - testing RectAreaLight scan light
        const penLight = new THREE.PointLight(0xfffaf0, 0, 4); // intensity 0 for now
        penLight.position.y = -washerHeight - 0.05; // Below the washer to illuminate table
        penGroup.add(penLight);
        
        // Position pen based on default config
        const tableHeight = 0.3;
        const penBaseHeight = 0.6;
        const tippedHeight = tableHeight + 0.9; // Height when laying on side
        
        if (config.tipped) {
            // Start tipped on table with random rotation (east-southeast range)
            const eseAngle = Math.PI / 8;
            const variation = (Math.random() - 0.5) * (Math.PI / 6);
            const randomRot = eseAngle + variation;
            
            penGroup.position.set(config.defaultX, tippedHeight, config.defaultZ);
            penGroup.rotation.x = Math.PI / 2; // Lay flat
            penGroup.rotation.z = randomRot;
            penGroup.userData.tippedOver = true;
            penGroup.userData.targetRotationX = Math.PI / 2;
            penGroup.userData.targetRotationZ = randomRot;
            penGroup.userData.targetY = tippedHeight;
            
            // Initialize screen color for tipped pens (grey/idle state)
            penGroup.userData.targetScreenHue = null;
            penGroup.userData.currentScreenHue = 0;
            penGroup.userData.currentScreenSat = 0;
            penGroup.userData.currentScreenLightness = 56;
        } else {
            // Start standing on paper
            penGroup.position.set(config.defaultX, penBaseHeight + 0.25, config.defaultZ); // 0.25 = paper height
            
            // Initialize screen color for standing pens
            penGroup.userData.targetScreenHue = null;
            penGroup.userData.currentScreenHue = 0;
            penGroup.userData.currentScreenSat = 0;
            penGroup.userData.currentScreenLightness = 56;
            penGroup.userData.tippedOver = false;
            penGroup.userData.targetRotationX = 0;
            penGroup.userData.targetRotationZ = 0;
            penGroup.userData.targetY = penBaseHeight + 0.25;
        }
        penGroup.userData = {
            type: 'pen',
            id: config.id,
            originalId: config.id, // Fixed ID for this physical pen
            modeIndex: config.modeIndex, // Current mode (0-3)
            name: config.name,
            color: config.color,
            light: penLight,
            screenLight: screenLight, // Light that casts from screen
            isPlaying: false,
            currentNote: null,
            lastColorChangeTime: 0 // Cooldown tracking
        };
        
        pens.push(penGroup);
        scene.add(penGroup);
    });
}

function setupEventListeners() {
    window.addEventListener('resize', onWindowResize);
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mouseup', onMouseUp);
    
    // Touch support
    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: false });
    renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    renderer.domElement.addEventListener('touchend', onTouchEnd);
}

function setupLightingControls() {
    // Pen height (gap above surface)
    const penHeightSlider = document.getElementById('penHeightSlider');
    const penHeightValue = document.getElementById('penHeightValue');
    if (penHeightSlider) {
        penHeightSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            // Pens will auto-adjust via adjustPenHeight in checkPenOverColor
            // Just update display and trigger recalc
            penHeightValue.textContent = value.toFixed(2);
            pens.forEach(pen => adjustPenHeight(pen));
        });
    }
    
    // Sheet thickness (affects both paper and painting frame)
    const sheetThicknessSlider = document.getElementById('sheetThicknessSlider');
    const sheetThicknessValue = document.getElementById('sheetThicknessValue');
    if (sheetThicknessSlider) {
        sheetThicknessSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (paper) paper.scale.y = value;
            if (paintingFrame) paintingFrame.scale.y = value;
            sheetThicknessValue.textContent = value.toFixed(1);
        });
    }
    
    // Paper position X
    const paperXSlider = document.getElementById('paperXSlider');
    const paperXValue = document.getElementById('paperXValue');
    if (paperXSlider) {
        paperXSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (paperGroup) paperGroup.position.x = value;
            paperXValue.textContent = value.toFixed(1);
        });
    }
    
    // Paper position Y (Z in 3D space since Y is up)
    const paperYSlider = document.getElementById('paperYSlider');
    const paperYValue = document.getElementById('paperYValue');
    if (paperYSlider) {
        paperYSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (paperGroup) paperGroup.position.z = value;
            paperYValue.textContent = value.toFixed(1);
        });
    }
    
    // Paper height (3D Y)
    const paperHSlider = document.getElementById('paperHSlider');
    const paperHValue = document.getElementById('paperHValue');
    if (paperHSlider) {
        paperHSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (paperGroup) paperGroup.position.y = value;
            paperHValue.textContent = value.toFixed(2);
        });
    }
    
    // Paper rotation
    const paperRotSlider = document.getElementById('paperRotSlider');
    const paperRotValue = document.getElementById('paperRotValue');
    if (paperRotSlider) {
        paperRotSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (paperGroup) paperGroup.rotation.y = value * Math.PI / 180;
            paperRotValue.textContent = value + '°';
        });
    }
    
    // Painting position X
    const paintXSlider = document.getElementById('paintXSlider');
    const paintXValue = document.getElementById('paintXValue');
    if (paintXSlider) {
        paintXSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (paintingGroup) paintingGroup.position.x = value;
            paintXValue.textContent = value.toFixed(1);
        });
    }
    
    // Painting position Y (Z in 3D space)
    const paintYSlider = document.getElementById('paintYSlider');
    const paintYValue = document.getElementById('paintYValue');
    if (paintYSlider) {
        paintYSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (paintingGroup) paintingGroup.position.z = value;
            paintYValue.textContent = value.toFixed(1);
        });
    }
    
    // Painting height (3D Y)
    const paintHSlider = document.getElementById('paintHSlider');
    const paintHValue = document.getElementById('paintHValue');
    if (paintHSlider) {
        paintHSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (paintingGroup) paintingGroup.position.y = value;
            paintHValue.textContent = value.toFixed(2);
        });
    }
    
    // Painting scale
    const paintScaleSlider = document.getElementById('paintScaleSlider');
    const paintScaleValue = document.getElementById('paintScaleValue');
    if (paintScaleSlider) {
        paintScaleSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (paintingGroup) {
                paintingGroup.scale.set(value, value, value);
            }
            paintScaleValue.textContent = value.toFixed(1);
        });
    }
    
    // Painting rotation
    const paintRotSlider = document.getElementById('paintRotSlider');
    const paintRotValue = document.getElementById('paintRotValue');
    if (paintRotSlider) {
        paintRotSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (paintingGroup) paintingGroup.rotation.y = value * Math.PI / 180;
            paintRotValue.textContent = value + '°';
        });
    }
    
    // Reset camera button
    const resetCameraBtn = document.getElementById('resetCameraBtn');
    if (resetCameraBtn) {
        resetCameraBtn.addEventListener('click', () => {
            resetCameraToDefault();
        });
    }
}

function resetCameraToDefault() {
    isResettingCamera = true;
}

function rebakeCubeCamera() {
    if (cubeCamera && renderer && scene) {
        // Temporarily use HDRI for baking
        scene.environment = envMap;
        cubeCamera.position.set(0, 3, 0);
        cubeCamera.update(renderer, scene);
        // Switch back to baked cube map
        scene.environment = cubeRenderTarget.texture;
        console.log('Reflections rebaked');
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

function updateMouse(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function onMouseDown(event) {
    updateMouse(event);
    mouseDownPos = { x: event.clientX, y: event.clientY };
    isDragging = false;
    
    // Check if clicking on a pen
    raycaster.setFromCamera(mouse, camera);
    const penMeshes = pens.map(p => p.children[0]); // Get body meshes
    const intersects = raycaster.intersectObjects(penMeshes);
    
    if (intersects.length > 0) {
        const clickedPen = intersects[0].object.parent;
        draggedPen = clickedPen;
        draggedPen.userData.isHeld = true; // Pen is being held - stay upright
        controls.enabled = false; // Disable orbit controls while dragging
        
        // Immediately start standing up if it was tipped over
        adjustPenHeight(draggedPen);
    }
}

function onMouseMove(event) {
    updateMouse(event);
    
    if (draggedPen) {
        // Check if we've moved enough to count as dragging
        const dx = event.clientX - mouseDownPos.x;
        const dy = event.clientY - mouseDownPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > CLICK_THRESHOLD) {
            isDragging = true;
        }
        
        // Move pen along drag plane
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(dragPlane);
        
        if (intersects.length > 0) {
            const point = intersects[0].point;
            // Constrain to full table area (48 wide x 28 deep)
            draggedPen.position.x = Math.max(-24, Math.min(24, point.x));
            draggedPen.position.z = Math.max(-14, Math.min(14, point.z));
            
            // Check what color the pen is over
            checkPenOverColor(draggedPen);
        }
    }
}

function onMouseUp(event) {
    if (draggedPen) {
        // If we didn't drag, it's a click - cycle pen mode
        if (!isDragging) {
            cyclePenMode(draggedPen);
        }
        
        // Release the pen - it may tip over if on table
        draggedPen.userData.isHeld = false;
        adjustPenHeight(draggedPen); // Recalculate - will tip if on table
        
        controls.enabled = true;
        draggedPen = null;
    }
}

function cyclePenMode(pen) {
    const physicalId = pen.userData.originalId;
    
    // Get current mode index and cycle to next
    let modeIndex = pen.userData.modeIndex || 0;
    modeIndex = (modeIndex + 1) % PEN_MODES.length;
    
    const newMode = PEN_MODES[modeIndex];
    pen.userData.modeIndex = modeIndex;
    pen.userData.id = newMode.id;
    pen.userData.name = newMode.name;
    
    // Update the emoji on the pen cap
    updatePenEmoji(pen, newMode.emoji);
    
    // Update audio engine mode mapping - this handles stopping old and starting new
    if (audioEngine) {
        audioEngine.setPenMode(physicalId, newMode.id);
    }
    
    console.log(`Pen ${physicalId} switched to ${newMode.name}`);
}

function updatePenEmoji(pen, emoji) {
    // Find the cap mesh (second child after body)
    const capMesh = pen.children.find(child => 
        child.geometry && child.geometry.type === 'CircleGeometry'
    );
    
    if (capMesh) {
        // Create new canvas texture with emoji
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, 128, 128);
        ctx.font = '72px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, 64, 68);
        
        const newTexture = new THREE.CanvasTexture(canvas);
        capMesh.material.map = newTexture;
        capMesh.material.needsUpdate = true;
    }
}

// Touch handlers
function onTouchStart(event) {
    event.preventDefault();
    if (event.touches.length === 1) {
        const touch = event.touches[0];
        onMouseDown({ clientX: touch.clientX, clientY: touch.clientY });
    }
}

function onTouchMove(event) {
    event.preventDefault();
    if (event.touches.length === 1 && draggedPen) {
        const touch = event.touches[0];
        onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
    }
}

function onTouchEnd(event) {
    onMouseUp(event);
}

// Get the base pen height from slider (or default)
function getBasePenHeight() {
    return 0.2; // Locked at 0.2
}

// Adjust pen height based on surface underneath (sets target, lerped in animate)
function adjustPenHeight(pen) {
    const basePenHeight = getBasePenHeight();
    const tableHeight = 0.3; // Table top surface
    
    // Cast ray downward from high above to detect surfaces
    const rayOrigin = new THREE.Vector3(pen.position.x, 5, pen.position.z);
    const downRay = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0));
    
    // Check paper
    let surfaceY = tableHeight;
    let onSurface = false; // true if over paper or painting
    
    if (paper) {
        const paperHits = downRay.intersectObject(paper);
        if (paperHits.length > 0) {
            surfaceY = Math.max(surfaceY, paperHits[0].point.y);
            onSurface = true;
        }
    }
    
    // Check painting frame
    if (paintingFrame) {
        const frameHits = downRay.intersectObject(paintingFrame);
        if (frameHits.length > 0) {
            surfaceY = Math.max(surfaceY, frameHits[0].point.y);
            onSurface = true;
        }
    }
    
    // Store surface info for later use
    pen.userData.onSurface = onSurface;
    pen.userData.surfaceY = surfaceY;
    
    // If being held/dragged, always stay upright
    if (pen.userData.isHeld) {
        pen.userData.targetY = surfaceY + basePenHeight;
        pen.userData.targetRotationX = 0;
        pen.userData.tippedOver = false;
        // Reset velocities when picked up
        pen.userData.velocityY = 0;
        pen.userData.velocityRotX = 0;
    } else if (onSurface) {
        // Standing upright on paper/painting
        pen.userData.targetY = surfaceY + basePenHeight;
        pen.userData.targetRotationX = 0;
        pen.userData.tippedOver = false;
    } else {
        // Laying on side on table (only when released)
        const penRadius = 0.9; // Pen radius when laying down - a bit higher off table
        pen.userData.targetY = tableHeight + penRadius;
        
        // Pen lays flat (X = 90 degrees exactly)
        // Only set random direction once when first tipping
        if (!pen.userData.tippedOver) {
            pen.userData.targetRotationX = Math.PI / 2; // Exactly 90 degrees - flat
            
            // Mostly point east-southeast (toward the light) with some variation
            const eseAngle = Math.PI / 8; // 22.5 degrees = east-southeast
            const variation = (Math.random() - 0.5) * (Math.PI / 6); // +/- 15 degrees (30 degree range)
            pen.userData.targetRotationZ = eseAngle + variation;
            
            // Give it initial drop velocity for bounce
            pen.userData.velocityY = -0.1;
        }
        pen.userData.tippedOver = true;
    }
    
    // Initialize if not set
    if (pen.userData.targetY !== undefined && pen.position.y < 0.1) {
        pen.position.y = pen.userData.targetY;
    }
    if (pen.userData.targetRotationX === undefined) {
        pen.userData.targetRotationX = 0;
    }
}

// Lerp pen heights and rotations towards targets (with bounce for drops)
function updatePenHeights() {
    const lerpFactor = 0.12;
    const bounceDamping = 0.15; // Low bounce - hard landing
    const gravity = 0.06; // Fast drop
    
    pens.forEach(pen => {
        if (pen.userData.tippedOver && !pen.userData.isHeld) {
            // Physics-based bounce for tipped pens
            const floorY = pen.userData.targetY || 0.8;
            const targetRotX = pen.userData.targetRotationX || Math.PI / 2;
            
            // Initialize velocity if needed
            if (pen.userData.velocityY === undefined) pen.userData.velocityY = 0;
            
            // Check if on floor FIRST
            const onFloor = pen.position.y <= floorY;
            
            if (onFloor) {
                // ON THE FLOOR
                pen.position.y = floorY; // Hard clamp
                
                // Bounce if coming down fast enough
                if (pen.userData.velocityY < -0.005) {
                    pen.userData.velocityY = Math.abs(pen.userData.velocityY) * bounceDamping;
                } else {
                    pen.userData.velocityY = 0; // Come to rest
                }
            } else {
                // IN THE AIR - apply gravity and move
                pen.userData.velocityY -= gravity;
                pen.position.y += pen.userData.velocityY;
                
                // Safety clamp - never go below floor
                if (pen.position.y < floorY) {
                    pen.position.y = floorY;
                }
            }
            
            // Tip rotation - simple lerp
            pen.rotation.x += (targetRotX - pen.rotation.x) * 0.15;
            
            // Lerp Z rotation to target (random compass direction)
            if (pen.userData.targetRotationZ !== undefined) {
                pen.rotation.z += (pen.userData.targetRotationZ - pen.rotation.z) * lerpFactor;
            }
            
            // Y rotation stays 0
            pen.rotation.y += (0 - pen.rotation.y) * lerpFactor;
        } else {
            // Normal lerp for held or upright pens
            if (pen.userData.targetY !== undefined) {
                pen.position.y += (pen.userData.targetY - pen.position.y) * lerpFactor;
            }
            if (pen.userData.targetRotationX !== undefined) {
                pen.rotation.x += (pen.userData.targetRotationX - pen.rotation.x) * lerpFactor;
            }
            // Reset Y and Z rotation when standing upright
            pen.rotation.y += (0 - pen.rotation.y) * lerpFactor;
            pen.rotation.z += (0 - pen.rotation.z) * lerpFactor;
        }
    });
}

function setScreenTargetHue(pen, hue, specialColor = null) {
    // Set the target hue for lerping - null means return to grey
    // specialColor can be 'white', 'black', or null
    pen.userData.targetScreenHue = hue;
    pen.userData.targetSpecialColor = specialColor;
    if (pen.userData.currentScreenHue === undefined) {
        pen.userData.currentScreenHue = hue !== null ? hue : 0;
        pen.userData.currentScreenSat = hue !== null ? 50 : 0;
    }
    if (pen.userData.currentScreenLightness === undefined) {
        pen.userData.currentScreenLightness = 40; // Default lightness
    }
}

function updateScreenColors() {
    // Lerp all pen screen colors toward their targets
    const lerpSpeed = 0.08;
    
    pens.forEach(pen => {
        // Always update tipped pens even if no target set
        const isTipped = pen.userData.tippedOver;
        
        // For tipped pens, ensure light is on even without color data
        if (isTipped && pen.userData.screenLight) {
            pen.userData.screenLight.color.set(0xffffff);
            pen.userData.screenLight.intensity = 2.0; // Lying down = 2.0
        }
        
        if (pen.userData.targetScreenHue === undefined && pen.userData.targetSpecialColor === undefined) return;
        
        const targetHue = pen.userData.targetScreenHue;
        const specialColor = pen.userData.targetSpecialColor;
        let currentHue = pen.userData.currentScreenHue || 0;
        let currentSat = pen.userData.currentScreenSat || 0;
        let currentLightness = pen.userData.currentScreenLightness || 40;
        
        // Determine target values based on special color or hue
        let targetSat, targetLightness;
        if (specialColor === 'white') {
            targetSat = 0;
            targetLightness = 95;
        } else if (specialColor === 'black') {
            targetSat = 0;
            targetLightness = 10;
        } else if (targetHue !== null) {
            targetSat = 50;
            targetLightness = 40;
        } else {
            targetSat = 0;
            targetLightness = 56; // Default grey (matches initial #8a9496)
        }
        
        // Lerp hue (handle wrap-around for smooth color wheel transitions)
        if (targetHue !== null && !specialColor) {
            let hueDiff = targetHue - currentHue;
            // Take shortest path around color wheel
            if (hueDiff > 180) hueDiff -= 360;
            if (hueDiff < -180) hueDiff += 360;
            currentHue += hueDiff * lerpSpeed;
            // Keep in 0-360 range
            if (currentHue < 0) currentHue += 360;
            if (currentHue >= 360) currentHue -= 360;
        }
        
        // Lerp saturation and lightness
        currentSat += (targetSat - currentSat) * lerpSpeed;
        currentLightness += (targetLightness - currentLightness) * lerpSpeed;
        
        pen.userData.currentScreenHue = currentHue;
        pen.userData.currentScreenSat = currentSat;
        pen.userData.currentScreenLightness = currentLightness;
        
        // Update the screen visuals
        pen.traverse(child => {
            if (child.userData && child.userData.isScreen) {
                const ctx = child.userData.ctx;
                const canvas = child.userData.canvas;
                const texture = child.userData.texture;
                const emoji = child.userData.emoji;
                
                if (ctx && canvas && texture) {
                    if (currentSat > 1) {
                        // Colored state
                        ctx.fillStyle = `hsl(${currentHue}, ${currentSat}%, ${currentLightness}%)`;
                        if (child.material && child.material.emissive) {
                            child.material.emissive.setHSL(currentHue / 360, currentSat / 100, currentLightness / 200);
                        }
                    } else {
                        // White, black, or grey state
                        ctx.fillStyle = `hsl(0, 0%, ${currentLightness}%)`;
                        if (child.material && child.material.emissive) {
                            child.material.emissive.setHSL(0, 0, currentLightness / 200);
                        }
                    }
                    ctx.fillRect(0, 0, 128, 128);
                    ctx.font = '72px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    // Dark text on light backgrounds, light text on dark backgrounds
                    ctx.fillStyle = currentLightness > 50 ? '#222222' : '#dddddd';
                    ctx.fillText(emoji, 64, 68);
                    
                    texture.needsUpdate = true;
                }
            }
        });
        
        // Update the scan RectAreaLight color and intensity
        // Always on - white when tipped/idle, colored when over colors
        if (pen.userData.screenLight) {
            const isTipped = pen.userData.tippedOver;
            
            if (isTipped) {
                // Tipped pens - white light, 2.0 intensity
                pen.userData.screenLight.color.set(0xffffff);
                pen.userData.screenLight.intensity = 2.0;
            } else if (currentSat > 1) {
                // Standing pen over color - colored light, 1.0 base
                pen.userData.screenLight.color.setHSL(currentHue / 360, 0.7, 0.5);
                pen.userData.screenLight.intensity = 1.0;
            } else if (currentLightness > 60) {
                // Over white area - 1.0 base
                pen.userData.screenLight.color.set(0xffffff);
                pen.userData.screenLight.intensity = 1.0;
            } else if (currentLightness < 25) {
                // Over black area - dim, 1.0 base
                pen.userData.screenLight.color.set(0x333333);
                pen.userData.screenLight.intensity = 1.0;
            } else {
                // Idle standing pen - white scanning light, 1.0 base
                pen.userData.screenLight.color.set(0xffffff);
                pen.userData.screenLight.intensity = 1.0;
            }
        }
    });
}

function checkPenOverColor(pen) {
    // Adjust pen height based on surface
    adjustPenHeight(pen);
    
    // Cast ray downward from pen position
    // Pen sits on surface, cast from above to detect color strips and painting
    const rayOrigin = new THREE.Vector3(
        pen.position.x,
        pen.position.y + 1,
        pen.position.z
    );
    
    const downRay = new THREE.Raycaster(
        rayOrigin,
        new THREE.Vector3(0, -1, 0)
    );
    
    // Find color strips (now inside paperGroup)
    const colorStrips = [];
    let paperBase = null;
    if (paperGroup) {
        paperGroup.traverse(obj => {
            if (obj.userData?.type === 'colorStrip') {
                colorStrips.push(obj);
            }
            if (obj.userData?.type === 'paperBase') {
                paperBase = obj;
            }
        });
    }
    const intersects = downRay.intersectObjects(colorStrips);
    
    // Check if over paper base (white area)
    let paperHit = null;
    if (paperBase) {
        const paperIntersects = downRay.intersectObject(paperBase);
        if (paperIntersects.length > 0) {
            paperHit = paperIntersects[0];
        }
    }
    
    // Check painting separately
    let paintingHit = null;
    if (paintingMesh) {
        const paintingIntersects = downRay.intersectObject(paintingMesh);
        if (paintingIntersects.length > 0) {
            paintingHit = paintingIntersects[0];
        }
    }
    
    // Determine what the pen is over (color strip or painting)
    let noteData = null;
    let specialColorData = null; // 'white' or 'black' - changes screen but no audio
    
    if (intersects.length > 0) {
        // Over a color strip
        const strip = intersects[0].object;
        noteData = strip.userData;
    } else if (paperHit && !paintingHit) {
        // Over white paper (not a tile, not the painting)
        specialColorData = 'white';
    } else if (paintingHit) {
        // Over the painting - sample color and find closest note
        const uv = paintingHit.uv;
        if (uv) {
            const rgb = samplePaintingColor(uv);
            if (rgb) {
                const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
                
                // Check white/black FIRST based on lightness (before hue)
                // Very light areas are white (even with some color cast like blue clouds)
                if (hsl.l > 0.8) {
                    specialColorData = 'white';
                }
                // Light areas with low saturation are also white
                else if (hsl.l > 0.65 && hsl.s < 0.25) {
                    specialColorData = 'white';
                }
                // Very dark areas are black
                else if (hsl.l < 0.15) {
                    specialColorData = 'black';
                }
                // Dark areas with low saturation are also black
                else if (hsl.l < 0.3 && hsl.s < 0.2) {
                    specialColorData = 'black';
                }
                // Otherwise check if saturated enough to be a color
                else if (hsl.s > 0.2) {
                    const closestNote = findClosestNoteByHue(hsl.h);
                    noteData = {
                        note: closestNote.note,
                        frequency: closestNote.frequency,
                        hue: closestNote.hue,
                        type: 'painting',
                        sampledHue: hsl.h,
                        sampledSat: hsl.s
                    };
                }
                // Gray areas (not saturated enough) - treat as white/black based on lightness
                else {
                    specialColorData = hsl.l > 0.5 ? 'white' : 'black';
                }
            }
        }
    }
    
    const now = Date.now();
    const canChangeColor = (now - pen.userData.lastColorChangeTime) >= COLOR_CHANGE_COOLDOWN;
    
    if (noteData) {
        if (pen.userData.currentNote !== noteData.note && canChangeColor) {
            const wasPlaying = pen.userData.isPlaying;
            const wasOverBlack = pen.userData.specialColor === 'black';
            const penId = pen.userData.originalId;  // Use physical pen ID, not mode ID!
            
            // If was over black, leave black mode first
            if (wasOverBlack && audioEngine) {
                audioEngine.penLeaveBlack(penId);
            }
            
            // Pen entered new color
            pen.userData.currentNote = noteData.note;
            pen.userData.isPlaying = true;
            pen.userData.specialColor = null;
            pen.userData.lastColorChangeTime = now; // Start cooldown
            
            // Update screen to show sensed color (will lerp)
            // sampledHue is already 0-360 from rgbToHsl, noteData.hue is also 0-360
            const screenHue = noteData.sampledHue !== undefined ? noteData.sampledHue : noteData.hue;
            setScreenTargetHue(pen, screenHue);
            
            // Turn on pen light - TEMPORARILY DISABLED
            // pen.userData.light.intensity = penLightIntensity;
            
            // Trigger audio
            if (audioEngine) {
                if (wasPlaying) {
                    // Changed to different note
                    audioEngine.penChange(penId, noteData.note, noteData.frequency);
                } else {
                    // Just started playing
                    audioEngine.penEnter(penId, noteData.note, noteData.frequency);
                }
            }
        }
    } else if (specialColorData) {
        // Over white or black - update screen, special audio for black
        if (pen.userData.specialColor !== specialColorData && canChangeColor) {
            const penId = pen.userData.originalId;
            const wasOverBlack = pen.userData.specialColor === 'black';
            
            pen.userData.specialColor = specialColorData;
            pen.userData.lastColorChangeTime = now; // Start cooldown
            
            // Stop regular audio if was playing
            if (pen.userData.isPlaying) {
                pen.userData.currentNote = null;
                pen.userData.isPlaying = false;
                pen.userData.light.intensity = 0;
                if (audioEngine) {
                    audioEngine.penLeave(penId);
                }
            }
            
            // Handle black area special sounds
            if (audioEngine) {
                if (wasOverBlack && specialColorData !== 'black') {
                    // Left black area
                    audioEngine.penLeaveBlack(penId);
                }
                if (specialColorData === 'black') {
                    // Entered black area - trigger special sounds (cricket for drums)
                    audioEngine.penEnterBlack(penId);
                }
            }
            
            // Update screen to white/black
            setScreenTargetHue(pen, null, specialColorData);
        }
    } else {
        if (pen.userData.isPlaying || pen.userData.specialColor) {
            // Pen left all colors/painting
            const penId = pen.userData.originalId;  // Use physical pen ID, not mode ID!
            const wasOverBlack = pen.userData.specialColor === 'black';
            
            pen.userData.currentNote = null;
            pen.userData.isPlaying = false;
            pen.userData.specialColor = null;
            
            // Reset screen to default color (will lerp)
            setScreenTargetHue(pen, null);
            
            // Turn off pen light
            pen.userData.light.intensity = 0;
            
            // Stop audio
            if (audioEngine) {
                if (wasOverBlack) {
                    audioEngine.penLeaveBlack(penId);
                }
                audioEngine.penLeave(penId);
            }
        }
    }
}

let lastPenCheck = 0;
const PEN_CHECK_INTERVAL = 100; // Check every 100ms
const COLOR_CHANGE_COOLDOWN = 150; // Min time (ms) between color changes
let lastCameraCheck = 0;

function animate() {
    requestAnimationFrame(animate);
    
    controls.update();
    
    // Camera reset lerping
    if (isResettingCamera) {
        const lerpSpeed = 0.08;
        camera.position.lerp(DEFAULT_CAMERA_POS, lerpSpeed);
        controls.target.lerp(DEFAULT_CAMERA_TARGET, lerpSpeed);
        
        // Check if close enough to stop
        if (camera.position.distanceTo(DEFAULT_CAMERA_POS) < 0.01 &&
            controls.target.distanceTo(DEFAULT_CAMERA_TARGET) < 0.01) {
            camera.position.copy(DEFAULT_CAMERA_POS);
            controls.target.copy(DEFAULT_CAMERA_TARGET);
            isResettingCamera = false;
        }
    }
    
    // Smoothly lerp pen heights
    updatePenHeights();
    
    // Smoothly lerp screen colors
    updateScreenColors();
    
    // Update camera info and reset button visibility (throttled)
    const currentTime = Date.now();
    if (currentTime - lastCameraCheck > 200) {
        lastCameraCheck = currentTime;
        
        // Update camera info display
        const camInfo = document.getElementById('cameraInfo');
        if (camInfo) {
            const rotX = (camera.rotation.x * 180 / Math.PI).toFixed(1);
            const rotY = (camera.rotation.y * 180 / Math.PI).toFixed(1);
            const rotZ = (camera.rotation.z * 180 / Math.PI).toFixed(1);
            camInfo.innerHTML = `Cam: ${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}<br>Rot: ${rotX}°, ${rotY}°, ${rotZ}°`;
        }
        
        // Show/hide reset button based on camera distance from default
        const resetBtn = document.getElementById('resetCameraBtn');
        if (resetBtn) {
            const posDist = camera.position.distanceTo(DEFAULT_CAMERA_POS);
            const targetDist = controls.target.distanceTo(DEFAULT_CAMERA_TARGET);
            if (posDist > 0.5 || targetDist > 0.5) {
                resetBtn.style.display = 'block';
            } else {
                resetBtn.style.display = 'none';
            }
        }
    }
    
    // Periodically check stationary pens
    const now = Date.now();
    if (now - lastPenCheck > PEN_CHECK_INTERVAL) {
        lastPenCheck = now;
        pens.forEach(pen => {
            if (pen !== draggedPen) {
                checkPenOverColor(pen);
            }
        });
    }
    
    // RectAreaLight pulsing - synced to audioContext time (100 BPM)
    // Use the audio engine's time source to stay in perfect sync
    if (audioEngine && audioEngine.audioContext) {
        const bpm = audioEngine.bpm;
        const beatDuration = 60 / bpm; // seconds per beat
        const audioTime = audioEngine.audioContext.currentTime;
        const beatsElapsed = audioTime / beatDuration;
        const beatPhase = beatsElapsed * Math.PI * 2; // One full sin wave per beat
        
        pens.forEach(pen => {
            if (pen.userData.screenLight) {
                const isTipped = pen.userData.tippedOver;
                const baseIntensity = isTipped ? 2.0 : 1.0; // 2.0 lying down, 1.0 upright
                
                if (pen.userData.isPlaying) {
                    // Pulse every 4 beats when playing (upright only)
                    pen.userData.screenLight.intensity = baseIntensity * 1.5 + Math.sin(beatPhase / 4) * (baseIntensity * 0.5);
                } else if (isTipped) {
                    // Gentle pulse every 8 beats when lying down
                    pen.userData.screenLight.intensity = baseIntensity + Math.sin(beatPhase / 8) * (baseIntensity * 0.15);
                } else {
                    // Gentle pulse every 8 beats when idle upright
                    pen.userData.screenLight.intensity = baseIntensity + Math.sin(beatPhase / 8) * (baseIntensity * 0.15);
                }
            }
        });
    }
    
    composer.render();
}

// Initialize on load
init();
