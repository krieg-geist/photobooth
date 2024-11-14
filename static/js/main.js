// Configuration
const CONFIG = {
    countdown: {
        duration: 3,
        imageBasePath: '/static/img',
        containerScale: 0.3, // 50% of container width
    },
    score: {
        imageBasePath: '/static/img/score.png',
        containerScale: 0.7,
        duration: 4000, // 3 seconds display time
        initialDelay: 1000, // 1 second delay after countdown
        columns: 1,
        rows: 5
    },
    ddrArrows: {
        tilesetPath: '/static/img/ddr_arrows_base.png',
        tileWidth: 64,
        tileHeight: 64,
        columns: 2,
        containerScale: 0.9, // 90% of container width
        gapScale: 0.02, // 2% gap between arrows
        topOffset: 20,
        rotations: [90, 0, 180, 270],
        animationInterval: 200,
        frameSequence: [0, 1]
    },
    photoReel: {
        maxPhotos: 3
    }
};

// Utility functions
class ImageLoader {
    static load(img) {
        return new Promise((resolve, reject) => {
            if (img.complete) {
                resolve(img);
            } else {
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error(`Failed to load ${img.src}`));
            }
        });
    }

    static preloadImages(paths) {
        return paths.map(path => {
            const img = new Image();
            img.src = path;
            return img;
        });
    }
}

// UI Components
class PhotoReel {
    constructor(reelElement, noPhotosElement) {
        this.reelElement = reelElement;
        this.noPhotosElement = noPhotosElement;
    }

    addPhoto(filename) {
        if (this.noPhotosElement) {
            this.noPhotosElement.remove();
        }

        const newImg = document.createElement('img');
        newImg.src = `/captures/${filename}`;
        newImg.alt = filename;
        newImg.onclick = () => window.open(newImg.src, '_blank');

        this.reelElement.insertBefore(newImg, this.reelElement.firstChild);
        
        if (this.reelElement.children.length > CONFIG.photoReel.maxPhotos) {
            this.reelElement.removeChild(this.reelElement.lastChild);
        }
    }
}

class PreviewDisplay {
    constructor(previewStream, latestPhoto, overlayLayer) {
        this.previewStream = previewStream;
        this.latestPhoto = latestPhoto;
        this.overlayLayer = overlayLayer;
    }

    showLatestPhoto(filename) {        
        // Then update and show the photo
        this.latestPhoto.src = `/captures/${filename}`;
        this.previewStream.style.display = 'none';
        this.latestPhoto.style.display = 'block';

        // Set timeout to return to preview
        setTimeout(() => this.returnToPreview(), 5000);
    }

    returnToPreview() {
        // Show the stream first
        this.previewStream.style.display = 'block';
        this.latestPhoto.style.display = 'none';
        
        // Then show the overlay with a small delay to ensure proper transition
        setTimeout(() => {
            if (this.overlayLayer) {
                this.overlayLayer.style.display = 'block'; // Changed from hidden property
            }
        }, 100);
    }
}

class TilesetSprite {
    constructor(tilesetPath, tileWidth, tileHeight, cols = 2) {
        this.image = new Image();
        this.image.src = tilesetPath;
        this.tileWidth = tileWidth;
        this.tileHeight = tileHeight;
        this.cols = cols;
        this.elements = new Set();
    }

    createSprite(x, y, width, height, rotation = 0) {
        const container = document.createElement('div');
        container.className = 'sprite-element';
        Object.assign(container.style, {
            width: `${width}px`,
            height: `${height}px`,
            left: `${x}px`,
            top: `${y}px`,
            transform: `rotate(${rotation}deg)`,
            position: 'absolute',
            imageRendering: 'pixelated',
            '-moz-crisp-edges': 'pixelated',
            '-webkit-crisp-edges': 'pixelated',
            msInterpolationMode: 'nearest-neighbor',
        });

        const canvas = document.createElement('canvas');
        canvas.width = this.tileWidth;
        canvas.height = this.tileHeight;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        
        container.appendChild(canvas);
        this.elements.add(container);
        
        return container;
    }

    getTileCoords(index) {
        return {
            row: Math.floor(index / this.cols),
            col: index % this.cols
        };
    }

    updateSprite(element, tileIndex) {
        const canvas = element.querySelector('canvas');
        const ctx = canvas.getContext('2d');
        const { row, col } = this.getTileCoords(tileIndex);
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(
            this.image,
            col * this.tileWidth,
            row * this.tileHeight,
            this.tileWidth,
            this.tileHeight,
            0,
            0,
            this.tileWidth,
            this.tileHeight
        );
    }

    animate(elements, frameSequence, interval) {
        let currentFrameIndex = 0;
        
        const updateFrame = () => {
            const tileIndex = frameSequence[currentFrameIndex];
            elements.forEach(element => this.updateSprite(element, tileIndex));
            currentFrameIndex = (currentFrameIndex + 1) % frameSequence.length;
        };

        updateFrame();
        return setInterval(updateFrame, interval);
    }
}

class TravelingArrowsManager {
    constructor(overlayLayer, config) {
        this.overlayLayer = overlayLayer;
        this.config = {
            ...CONFIG.ddrArrows,
            travelDuration: 900,
            arrowSpawnInterval: 300,
            tilesetPath: '/static/img/ddr_arrows.png',
            columns: 4,
            rows: 4,
            impactDuration: 200,
            fadeInDuration: 50,
            fadeOutDuration: 150,
            impactPath: '/static/img/flash.png'
        };
        
        this.sprites = new TilesetSprite(
            this.config.tilesetPath,
            this.config.tileWidth,
            this.config.tileHeight,
            this.config.columns
        );
        
        this.containerWidth = this.overlayLayer.offsetWidth;
        this.containerHeight = this.overlayLayer.offsetHeight;
        this.totalArrowsWidth = this.containerWidth * this.config.containerScale;
        this.gap = Math.floor(this.totalArrowsWidth * this.config.gapScale);
        this.arrowWidth = Math.floor((this.totalArrowsWidth - (this.gap * 3)) / 4);
        this.leftOffset = (this.containerWidth - this.totalArrowsWidth) / 2;

        this.activeSpawners = new Set();
        this.activeArrows = new Set();
        this.activeImpacts = new Set();
        this.animationFrameId = null;
        this.lastFrameTime = 0;
    }

    animate(elements, frameSequence, interval) {
        let currentFrameIndex = 0;
        let accumulatedTime = 0;
        
        const animate = (timestamp) => {
            if (!this.lastFrameTime) this.lastFrameTime = timestamp;
            const deltaTime = timestamp - this.lastFrameTime;
            
            accumulatedTime += deltaTime;
            
            if (accumulatedTime >= interval) {
                const tileIndex = frameSequence[currentFrameIndex];
                elements.forEach(element => this.updateSprite(element, tileIndex));
                currentFrameIndex = (currentFrameIndex + 1) % frameSequence.length;
                accumulatedTime = accumulatedTime % interval;
            }
            
            this.lastFrameTime = timestamp;
            this.animationFrameId = requestAnimationFrame(animate);
        };
        
        this.animationFrameId = requestAnimationFrame(animate);
        
        return this.animationFrameId;
    }

    clearAllArrows() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        this.activeSpawners.forEach(timer => {
            clearInterval(timer);
            clearTimeout(timer);
        });
        this.activeSpawners.clear();

        this.activeArrows.forEach(arrow => {
            arrow.style.transition = 'none';
            arrow.remove();
        });
        this.activeArrows.clear();

        this.activeImpacts.forEach(impact => {
            impact.style.transition = 'none';
            impact.remove();
        });
        this.activeImpacts.clear();
    }

    createImpactEffect(columnIndex, rotation) {
        // Create the impact sprite
        const impact = document.createElement('div');
        this.activeImpacts.add(impact);

        // Position the impact
        const xPos = this.leftOffset + (columnIndex * (this.arrowWidth + this.gap));
        
        Object.assign(impact.style, {
            position: 'absolute',
            left: `${xPos}px`,
            top: `${this.config.topOffset}px`,
            width: `${this.arrowWidth}px`,
            height: `${this.arrowWidth}px`,
            backgroundImage: `url(${this.config.impactPath})`,
            backgroundSize: '100% 100%',  // Changed: Scale image to fit div
            backgroundPosition: 'center',  // Changed: Center the background image
            backgroundRepeat: 'no-repeat', // Changed: Don't repeat the image
            opacity: '0',
            transition: `opacity ${this.config.fadeInDuration}ms ease-in`,
            zIndex: '1002'
        });

        this.overlayLayer.appendChild(impact);

        // Immediate fade in
        requestAnimationFrame(() => {
            impact.style.opacity = '1';
        });

        // Set up fade out
        setTimeout(() => {
            impact.style.transition = `opacity ${this.config.fadeOutDuration}ms ease-out`;
            impact.style.opacity = '0';
        }, this.config.impactDuration);

        // Remove after animations complete
        const removeTimeout = setTimeout(() => {
            this.activeImpacts.delete(impact);
            impact.remove();
        }, this.config.impactDuration + this.config.fadeOutDuration);

        this.activeSpawners.add(removeTimeout);
    }

    createTravelingArrow(columnIndex, rotation) {
        const arrow = this.sprites.createSprite(
            this.leftOffset + (columnIndex * (this.arrowWidth + this.gap)),
            this.containerHeight,
            this.arrowWidth,
            this.arrowWidth,
            rotation
        );

        this.activeArrows.add(arrow);

        Object.assign(arrow.style, {
            transition: `top ${this.config.travelDuration}ms linear`,
            opacity: '0.8'
        });

        this.overlayLayer.appendChild(arrow);

        requestAnimationFrame(() => {
            arrow.style.top = `${this.config.topOffset}px`;
        });

        // Create impact effect when arrow reaches top
        const impactTimeout = setTimeout(() => {
            this.createImpactEffect(columnIndex, rotation);
        }, this.config.travelDuration - 20);

        const removeTimeout = setTimeout(() => {
            this.activeArrows.delete(arrow);
            arrow.remove();
        }, this.config.travelDuration);
        
        this.activeSpawners.add(impactTimeout);
        this.activeSpawners.add(removeTimeout);

        const rowIndex = columnIndex;
        const frameSequence = Array.from(
            { length: this.config.columns }, 
            (_, i) => rowIndex * this.config.columns + i
        );
        
        this.sprites.animate([arrow], frameSequence, this.config.animationInterval);

        return arrow;
    }

    spawnArrowSequence() {
        let spawnCount = 0;
        const maxSpawns = Math.floor(this.config.travelDuration / this.config.arrowSpawnInterval);
        
        const spawner = setInterval(() => {
            if (spawnCount >= maxSpawns) {
                clearInterval(spawner);
                this.activeSpawners.delete(spawner);
                return;
            }

            const columnIndices = Array.from({ length: 4 }, (_, i) => i)
                .filter(() => Math.random() < 0.3);

            columnIndices.forEach(columnIndex => {
                this.createTravelingArrow(columnIndex, this.config.rotations[columnIndex]);
            });

            spawnCount++;
        }, this.config.arrowSpawnInterval);

        this.activeSpawners.add(spawner);

        return new Promise(resolve => {
            const finalTimeout = setTimeout(resolve, this.config.travelDuration + 100);
            this.activeSpawners.add(finalTimeout);
        });
    }
}

class CountdownManager {
    constructor(overlayLayer) {
        this.overlayLayer = overlayLayer;
        this.arrowsContainer = null;  // Will store reference to DDR arrows container
        this.images = ImageLoader.preloadImages(
            Array.from({ length: CONFIG.countdown.duration }, (_, i) => 
                `${CONFIG.countdown.imageBasePath}/${i + 1}.png`
            )
        );
        this.scoreImage = new Image();
        this.scoreImage.src = CONFIG.score.imageBasePath;
        this.travelingArrows = new TravelingArrowsManager(overlayLayer);

        // Create and store a permanent overlay element
        this.fadeOverlay = document.createElement('div');
        this.fadeOverlay.style.position = 'fixed';
        this.fadeOverlay.style.top = '0';
        this.fadeOverlay.style.left = '0';
        this.fadeOverlay.style.width = '100%';
        this.fadeOverlay.style.height = '100%';
        this.fadeOverlay.style.pointerEvents = 'none';
        this.fadeOverlay.style.zIndex = '1000';
        this.fadeOverlay.style.opacity = '0';
        this.fadeOverlay.style.transition = 'opacity 300ms';  // Default transition
        document.body.appendChild(this.fadeOverlay);

        // Add CSS keyframes for animations if not already present
        if (!document.getElementById('countdown-animations')) {
            const style = document.createElement('style');
            style.id = 'countdown-animations';
            style.textContent = `
                @keyframes countdownFadeInGrow {
                    0% {
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(0.8);
                    }
                    25% {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(0.8);
                    }
                    85% {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1);
                    }
                    100% {
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(1);
                    }
                }
                @keyframes scoreFadeInOut {
                    0% {
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(0.5);
                    }
                    10% {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1);
                    }
                    90% {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1);
                    }
                    100% {
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(1);
                    }
                }
                @keyframes sunburstRotate {
                    from {
                        transform: translate(-50%, -50%) rotate(0deg);
                    }
                    to {
                        transform: translate(-50%, -50%) rotate(360deg);
                    }
                }
                @keyframes sunburstPulse {
                    0% {
                        opacity: 0.15;
                        transform: translate(-50%, -50%) scale(0.95);
                    }
                    50% {
                        opacity: 0.25;
                        transform: translate(-50%, -50%) scale(1.05);
                    }
                    100% {
                        opacity: 0.15;
                        transform: translate(-50%, -50%) scale(0.95);
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }

    setArrowsContainer(container) {
        this.arrowsContainer = container;
    }

    hideArrows() {
        if (this.arrowsContainer) {
            this.arrowsContainer.style.opacity = 0;
        }
        this.travelingArrows.clearAllArrows();
    }

    showArrows() {
        if (this.arrowsContainer) {
            this.arrowsContainer.style.opacity = 1;
        }
    }

    async showNumber(image) {
        const numberPromise = new Promise(resolve => {
            const containerWidth = this.overlayLayer.offsetWidth;
            const numberWidth = containerWidth * CONFIG.countdown.containerScale;
            const numberHeight = numberWidth;
            
            const numberImg = document.createElement('img');
            Object.assign(numberImg.style, {
                position: 'absolute',
                width: `${numberWidth}px`,
                height: `${numberHeight}px`,
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%) scale(0.5)',
                zIndex: '1000',
                imageRendering: 'pixelated',
                '-moz-crisp-edges': 'pixelated',
                '-webkit-crisp-edges': 'pixelated',
                msInterpolationMode: 'nearest-neighbor',
                animation: 'countdownFadeInGrow 0.97s ease-in-out forwards'
            });
            numberImg.src = image.src;
            
            this.overlayLayer.appendChild(numberImg);
            
            numberImg.addEventListener('animationend', () => {
                numberImg.remove();
                resolve();
            }, { once: true });
        });

        // Spawn traveling arrows during the countdown
        await Promise.all([
            numberPromise,
            this.travelingArrows.spawnArrowSequence()
        ]);
    }

    async showScore() {
        // Create a canvas to show the specific score frame
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Set canvas dimensions to match the tile size
        canvas.width = this.scoreImage.width;
        canvas.height = this.scoreImage.height / CONFIG.score.rows;

        const containerWidth = this.overlayLayer.offsetWidth;
        const scoreWidth = containerWidth * CONFIG.score.containerScale;
        
        // Calculate height maintaining the canvas aspect ratio
        const aspectRatio = canvas.width / canvas.height;
        const scoreHeight = scoreWidth / aspectRatio;
        
        // Randomly select a score frame
        const randomFrame = Math.floor(Math.random() * CONFIG.score.rows);
        
        // Draw the selected frame
        ctx.drawImage(
            this.scoreImage,
            0,
            randomFrame * (this.scoreImage.height / CONFIG.score.rows),
            this.scoreImage.width,
            this.scoreImage.height / CONFIG.score.rows,
            0,
            0,
            canvas.width,
            canvas.height
        );

        // Create the score element
        const scoreElement = document.createElement('div');
        Object.assign(scoreElement.style, {
            position: 'absolute',
            width: `${scoreWidth}px`,
            height: `${scoreHeight}px`,
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%) scale(0.5)',
            zIndex: '1001',
            imageRendering: 'pixelated',
            '-moz-crisp-edges': 'pixelated',
            '-webkit-crisp-edges': 'pixelated',
            msInterpolationMode: 'nearest-neighbor',
            animation: `scoreFadeInOut ${CONFIG.score.duration}ms ease-in-out forwards, scoreGlow 1.5s ease-in-out infinite`,
            filter: 'drop-shadow(0 0 20px rgba(255, 255, 255, 0.7))'
        });

        // Set the canvas as background
        scoreElement.appendChild(canvas);
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        
        this.overlayLayer.appendChild(scoreElement);
        
        await new Promise(resolve => {
            scoreElement.addEventListener('animationend', () => {
                scoreElement.remove();
                resolve();
            }, { once: true });
        });
    }

    async startTripleCapture() {
        // Ensure all images are loaded
        await Promise.all([
            ...this.images.map(img => ImageLoader.load(img)),
            ImageLoader.load(this.scoreImage)
        ]);
        
        // Show countdown numbers
        for (let i = this.images.length - 1; i >= 0; i--) {
            await this.showNumber(this.images[i]);
        }
    
        this.hideArrows();
    
        // Three flashes with 1-second delay between them
        for (let i = 0; i < 3; i++) {
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            await this.flashScreen();
        }
    }

    async showFinalScore() {
        await this.showScore();
        // Smoother transition out
        await this.fadeScreen('transparent', { fadeInDuration: 0, fadeOutDuration: 300 });
    }

    async start() {
        // Ensure all images are loaded
        await Promise.all([
            ...this.images.map(img => ImageLoader.load(img)),
            ImageLoader.load(this.scoreImage)
        ]);
        
        // Show countdown numbers
        for (let i = this.images.length - 1; i >= 0; i--) {
            await this.showNumber(this.images[i]);
        }

    // Fade to white
        await this.fadeScreen('white', 300);
        await this.fadeScreen('black', 1500);
        await this.showScore();

        // Wait for the specified delay
        await new Promise(resolve => setTimeout(resolve, CONFIG.score.initialDelay));
        
    }

    // Helper method for screen fading
    async fadeScreen(color, { fadeInDuration = 300, fadeOutDuration = 300, holdDuration = 0 } = {}) {
        // Set initial transition
        this.fadeOverlay.style.transition = `opacity ${fadeInDuration}ms`;
        this.fadeOverlay.style.backgroundColor = color;
        
        // Force reflow
        this.fadeOverlay.offsetHeight;
        
        // Fade in
        this.fadeOverlay.style.opacity = '1';
        
        // Wait for fade in plus any hold time
        await new Promise(resolve => setTimeout(resolve, fadeInDuration + holdDuration));
        
        // If color is 'transparent' or we need to fade out
        if (color === 'transparent' || fadeOutDuration > 0) {
            // Update transition duration for fade out if different
            if (fadeInDuration !== fadeOutDuration) {
                this.fadeOverlay.style.transition = `opacity ${fadeOutDuration}ms`;
                // Force reflow for new transition
                this.fadeOverlay.offsetHeight;
            }
            
            this.fadeOverlay.style.opacity = '0';
            await new Promise(resolve => setTimeout(resolve, fadeOutDuration));
        }
    }

    async flashScreen() {
        // Instant white flash
        this.fadeOverlay.style.transition = 'none';
        this.fadeOverlay.style.backgroundColor = 'white';
        this.fadeOverlay.style.opacity = '1';
        
        // Force reflow
        this.fadeOverlay.offsetHeight;
        
        // Fade out
        this.fadeOverlay.style.transition = 'opacity 300ms';
        this.fadeOverlay.style.opacity = '0';
        await new Promise(resolve => setTimeout(resolve, 300));
    }
}

class CameraApp {
    constructor() {
        this.elements = {
            previewStream: document.getElementById('previewStream'),
            latestPhoto: document.getElementById('latestPhoto'),
            captureBtn: document.getElementById('captureBtn'),
            photoReel: document.getElementById('photoReel'),
            noPhotosMessage: document.getElementById('noPhotosMessage'),
            overlayLayer: document.getElementById('overlayLayer')
        };

        this.photoReel = new PhotoReel(
            this.elements.photoReel,
            this.elements.noPhotosMessage
        );
        
        this.previewDisplay = new PreviewDisplay(
            this.elements.previewStream,
            this.elements.latestPhoto,
            this.elements.overlayLayer
        );

        this.handleKeyPress = this.handleKeyPress.bind(this);

        this.countdown = new CountdownManager(this.elements.overlayLayer);
        
        this.initializeUI();
        this.initializeGamepad();

        // Store previous button states to detect new presses
        this.previousButtonStates = new Map();
        
        // Add cooldown tracking
        this.lastGamepadCapture = 0;
        this.gamepadCooldown = 10000; // 10 seconds in milliseconds
    }

    handleKeyPress(event) {
        if (event.key.toLowerCase() === 'c') {
            this.handleCapture();
        }
    }

    initializeGamepad() {
        // Listen for gamepad connections
        window.addEventListener("gamepadconnected", (e) => {
            console.log("Gamepad connected:", e.gamepad.id);
            // Clear previous states on new connection to prevent false triggers
            this.previousButtonStates.clear();
        });

        window.addEventListener("gamepaddisconnected", (e) => {
            console.log("Gamepad disconnected:", e.gamepad.id);
            // Clear states for disconnected gamepad
            this.previousButtonStates.clear();
        });

        // Start polling for gamepad input
        this.pollGamepad();
    }

    pollGamepad() {
        const gamepads = navigator.getGamepads();
        const currentTime = Date.now();
        
        for (const gamepad of gamepads) {
            if (!gamepad) continue;

            // Check each button
            gamepad.buttons.forEach((button, index) => {
                const prevState = this.previousButtonStates.get(`${gamepad.index}-${index}`) || false;
                const currentState = button.pressed;

                // If button is newly pressed and cooldown has expired
                if (currentState && !prevState && 
                    currentTime - this.lastGamepadCapture >= this.gamepadCooldown) {
                    this.handleCapture();
                    this.lastGamepadCapture = currentTime;
                }

                // Update previous state
                this.previousButtonStates.set(`${gamepad.index}-${index}`, currentState);
            });
        }

        // Continue polling
        requestAnimationFrame(() => this.pollGamepad());
    }


    async capturePhoto3() {
        try {
            const response = await fetch('/capture_3', { method: 'POST' });
            const data = await response.json();
            
            if (data.status !== 'success') {
                throw new Error('Failed to capture images');
            }
            
            // Add all photos to the reel without previewing
            data.filenames.forEach(filename => {
                this.photoReel.addPhoto(filename);
            });
            
            return data;
        } catch (error) {
            console.error('Capture error:', error);
            throw error;
        }
    }

    async handleCapture() {
        const captureBtn = this.elements.captureBtn;
        captureBtn.disabled = true;
        
        try {
            // Start both processes concurrently
            const [captureResult] = await Promise.all([
                this.capturePhoto3(),
                this.countdown.startTripleCapture()
            ]);
            
            // Show final score after capture completes
            await this.countdown.showFinalScore();

            this.countdown.showArrows();
            
        } catch (error) {
            alert(error.message || 'Failed to capture image.');
        } finally {
            captureBtn.disabled = false;
        }
    }

    async capturePhoto() {
        try {
            const response = await fetch('/capture', { method: 'POST' });
            const data = await response.json();
            
            if (data.status !== 'success') {
                throw new Error('Failed to capture image');
            }
            
            this.photoReel.addPhoto(data.filename);
            this.previewDisplay.showLatestPhoto(data.filename);
            
            return data;
        } catch (error) {
            console.error('Capture error:', error);
            throw error;
        }
    }

    initializeDDRArrows() {
        const { ddrArrows: config } = CONFIG;
        const sprites = new TilesetSprite(
            config.tilesetPath,
            config.tileWidth,
            config.tileHeight,
            config.columns
        );

        sprites.image.onload = () => {
            const containerWidth = this.elements.overlayLayer.offsetWidth;
            const totalArrowsWidth = containerWidth * config.containerScale;
            const gap = Math.floor(totalArrowsWidth * config.gapScale);
            const arrowWidth = Math.floor((totalArrowsWidth - (gap * 3)) / 4);
            const leftOffset = (containerWidth - totalArrowsWidth) / 2;

            // Create a container for the arrows
            const arrowsContainer = document.createElement('div');
            arrowsContainer.style.position = 'absolute';
            arrowsContainer.style.width = '100%';
            arrowsContainer.style.height = '100%';
            this.elements.overlayLayer.appendChild(arrowsContainer);

            const arrows = config.rotations.map((rotation, i) => {
                const arrow = sprites.createSprite(
                    leftOffset + (i * (arrowWidth + gap)),
                    config.topOffset,
                    arrowWidth,
                    arrowWidth,
                    rotation
                );
                arrowsContainer.appendChild(arrow);
                return arrow;
            });

            sprites.animate(arrows, config.frameSequence, config.animationInterval);
            
            // Set the arrows container reference in the countdown manager
            this.countdown.setArrowsContainer(arrowsContainer);
        };

        sprites.image.onerror = () => {
            console.error('Failed to load DDR arrows tileset');
        };
    }

    initializeUI() {
        this.elements.previewStream.style.display = 'block';
        this.elements.latestPhoto.style.display = 'none';
        
        this.elements.captureBtn.addEventListener(
            'click',
            () => this.handleCapture()
        );
        
        this.initializeDDRArrows();
    }
}

// Initialize the app when the page loads
window.addEventListener('load', () => {
    window.cameraApp = new CameraApp();
});