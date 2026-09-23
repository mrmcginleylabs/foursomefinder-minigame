// Self-contained 2D Par 3 game (Canvas + physics + UI). Verbatim copy of the
// proven engine — the sidecar renders this in a same-origin srcDoc iframe so
// the orchestration layer (main.js) can drive it via window hooks.
const minigameHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>4SF Par 3 Challenge - Embedded</title>
    <style>
        body, html {
            margin: 0; padding: 0; width: 100%; height: 100%;
            background-color: transparent;
            display: flex; justify-content: center; align-items: center;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            touch-action: none; user-select: none;
        }
        #game-container {
            position: relative; width: 100%; height: 100%;
            display: flex; justify-content: center; align-items: center;
            box-shadow: 0 0 20px rgba(0,0,0,0.8);
            background-color: #111; overflow: hidden;
        }
        canvas { display: block; max-width: 100%; max-height: 100%; cursor: pointer; }
        #ui-layer {
            position: absolute; top: 0; left: 0; width: 100%;
            pointer-events: none; padding: 20px; box-sizing: border-box; text-align: center;
        }
        #ui-layer h1 { margin: 0 0 5px 0; font-size: 24px; color: #fff; text-shadow: 1px 1px 3px #000; }
        #ui-layer p { margin: 0; font-size: 16px; color: #facc15; font-weight: bold; text-shadow: 1px 1px 2px #000; }
        #locked-overlay {
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: rgba(17, 24, 39, 0.95); border: 2px solid #ef4444; border-radius: 12px;
            padding: 25px; text-align: center; color: white; display: none;
            pointer-events: auto; width: 80%; max-width: 320px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.8); z-index: 100;
        }
        #locked-overlay h2 { margin-top: 0; color: #ef4444; font-size: 22px; }
        #warning-overlay {
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: rgba(17, 24, 39, 0.95); border: 2px solid #facc15; border-radius: 12px;
            padding: 25px; text-align: center; color: white; display: none;
            pointer-events: auto; width: 80%; max-width: 320px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.8); z-index: 100;
        }
        #warning-overlay h2 { margin-top: 0; color: #facc15; font-size: 20px; }
        #warning-overlay button { pointer-events: auto; }
    </style>
</head>
<body>
<div id="game-container">
    <canvas id="gameCanvas" width="400" height="700"></canvas>
    <div id="ui-layer">
        <h1 id="hole-header">Daily Closest to the Pin Challenge</h1>
        <p id="hole-subtitle" style="margin:2px 0 0 0;font-size:14px;color:#facc15;font-weight:bold;text-shadow:1px 1px 2px #000;display:none"></p>
    </div>
    <div id="warning-overlay">
        <h2>Replay Warning</h2>
        <p id="warning-text" style="line-height: 1.5; margin-bottom: 0;">Your previous score will be replaced on the leaderboard. Continue?</p>
        <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
            <button id="warning-confirm" style="padding: 8px 16px; background: #22c55e; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Play Again</button>
            <button id="warning-cancel" style="padding: 8px 16px; background: #6b7280; color: white; border: none; border-radius: 6px; cursor: pointer;">Cancel</button>
        </div>
    </div>
    <div id="locked-overlay">
        <h2>Action Denied</h2>
        <p id="locked-message-text" style="line-height: 1.5; margin-bottom: 0;">Create a free account for unlimited plays!</p>
    </div>
</div>

<script>
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    let instructionTextContent = "Drag to Aim";
    const lockedOverlay = document.getElementById('locked-overlay');
    const lockedMessageText = document.getElementById('locked-message-text');
    const holeHeader = document.getElementById('hole-header');

    let gameState = 0;
    const pxPerYard = 3.2;

    // === 7 hole definitions — one per weekday (Mon=1 ... Sun=7) ===
    const HOLE_DEFS = [
        { // Hole 1 (Monday) — The Opener
            name: 1, yardage: 140, greenX: 200, greenRadius: 75, teeX: 200,
            bunkers: [], water: [],
            trees: [{x:80,y:300,r:18,h:28},{x:320,y:400,r:15,h:25}]
        },
        { // Hole 2 (Tuesday) — Water's Edge
            name: 2, yardage: 155, greenX: 245, greenRadius: 70, teeX: 175,
            bunkers: [{x:150,y:350,r:28}],
            water: [{type:"lake",x:85,y:280,r:75}],
            trees: [{x:335,y:200,r:16,h:28},{x:345,y:460,r:14,h:24}]
        },
        { // Hole 3 (Wednesday) — Island Green
            name: 3, yardage: 150, greenX: 200, greenRadius: 72, teeX: 200,
            bunkers: [],
            water: [{type:"lake",x:200,y:195,r:100}],
            trees: [{x:65,y:420,r:15,h:26},{x:335,y:420,r:15,h:26},{x:75,y:560,r:13,h:22}]
        },
        { // Hole 4 (Thursday) — Bunker Beach
            name: 4, yardage: 135, greenX: 200, greenRadius: 68, teeX: 200,
            bunkers: [{x:145,y:215,r:28},{x:260,y:195,r:25},{x:200,y:140,r:22}],
            water: [],
            trees: [{x:55,y:400,r:16,h:27},{x:345,y:450,r:14,h:24}]
        },
        { // Hole 5 (Friday) — Tree Line
            name: 5, yardage: 160, greenX: 215, greenRadius: 65, teeX: 185,
            bunkers: [{x:175,y:250,r:20}],
            water: [],
            trees: [
                {x:95,y:350,r:18,h:30},{x:85,y:275,r:16,h:28},{x:105,y:425,r:15,h:26},
                {x:315,y:350,r:18,h:30},{x:325,y:275,r:16,h:28},{x:305,y:425,r:15,h:26}
            ]
        },
        { // Hole 6 (Saturday) — Island Green
            name: 6, yardage: 145, greenX: 200, greenRadius: 58, teeX: 200,
            bunkers: [],
            water: [{type:"lake",x:200,y:200,r:115}],
            trees: [{x:65,y:555,r:14,h:24},{x:335,y:555,r:14,h:24}]
        },
        { // Hole 7 (Sunday) — Island Gauntlet
            name: 7, yardage: 170, greenX: 225, greenRadius: 62, teeX: 175,
            bunkers: [{x:150,y:420,r:25}],
            water: [{type:"lake",x:225,y:131,r:95}],
            trees: [{x:65,y:320,r:15,h:27},{x:345,y:320,r:16,h:28},{x:75,y:560,r:12,h:22}]
        }
    ];

    let activeHole = HOLE_DEFS[0];
    const tee = { x: 200, y: 675 };
    const green = { x: 200, y: 200, radius: 75, slopeX: 0.0015, slopeY: 0.0005 };
    let hole = { yardage: 140, x: 200, y: 200, radius: 4 };
    let wind = { speed: 0, angle: 0 };
    let ball = { x: 200, y: 650, z: 0, vx: 0, vy: 0, radius: 3, flightProgress: 0, landX: 0, landY: 0 };
    const maxDistance = 200;
    let meter = { powerValue: 0, powerSpeed: 2.5, powerDirection: 1, accValue: 0, accSpeed: 1.5, accDirection: 1, finalPower: 0, finalAccuracy: 0 };
    let aimDeviation = 0;
    let isRequestingShot = false;
    let shotsRemainingText = "";
    let shotResultText = "";
    let resultTimeoutId = null;

    const warningOverlay = document.getElementById('warning-overlay');
    const warningText = document.getElementById('warning-text');

    // Load the Foursome Finder logo for the watermark
    const logoImg = new Image();
    logoImg.src = "https://media.base44.com/images/public/6a80e7c07aa31885a392902e/f54c731a3_Untitled-March192026at1924448.png";
    let logoLoaded = false;
    logoImg.onload = () => { logoLoaded = true; };

    // === Web Audio + Haptics ===
    let audioCtx = null;
    function initAudio() {
        if (!audioCtx) {
            try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
        }
        if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    }
    function playSound(type) {
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        if (type === "impact") {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.frequency.setValueAtTime(180, now);
            osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
            gain.gain.setValueAtTime(0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(now); osc.stop(now + 0.14);
        } else if (type === "roll") {
            const bufSize = audioCtx.sampleRate * 0.6;
            const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < bufSize; i++) d[i] = (Math.random()*2-1) * 0.25 * (1 - i/bufSize);
            const noise = audioCtx.createBufferSource(); noise.buffer = buf;
            const filter = audioCtx.createBiquadFilter();
            filter.type = "lowpass"; filter.frequency.value = 600;
            const gain = audioCtx.createGain();
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
            noise.connect(filter).connect(gain).connect(audioCtx.destination);
            noise.start(now);
        } else if (type === "cup") {
            for (let i = 0; i < 3; i++) {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.frequency.value = 900 + i * 250;
                gain.gain.setValueAtTime(0.15, now + i * 0.025);
                gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.025 + 0.1);
                osc.connect(gain).connect(audioCtx.destination);
                osc.start(now + i * 0.025); osc.stop(now + i * 0.025 + 0.12);
            }
        } else if (type === "cheer") {
            const bufSize = audioCtx.sampleRate * 1.5;
            const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < bufSize; i++) d[i] = (Math.random()*2-1) * 0.35;
            const noise = audioCtx.createBufferSource(); noise.buffer = buf;
            const filter = audioCtx.createBiquadFilter();
            filter.type = "bandpass";
            filter.frequency.setValueAtTime(400, now);
            filter.frequency.linearRampToValueAtTime(1800, now + 1.5);
            filter.Q.value = 1.5;
            const gain = audioCtx.createGain();
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.25, now + 0.15);
            gain.gain.setValueAtTime(0.25, now + 1.0);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 1.5);
            noise.connect(filter).connect(gain).connect(audioCtx.destination);
            noise.start(now);
        } else if (type === "golfclap") {
            const bufSize = audioCtx.sampleRate * 0.8;
            const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < bufSize; i++) d[i] = (Math.random()*2-1) * 0.18 * (1 - i/bufSize);
            const noise = audioCtx.createBufferSource(); noise.buffer = buf;
            const filter = audioCtx.createBiquadFilter();
            filter.type = "bandpass";
            filter.frequency.value = 1200;
            filter.Q.value = 2;
            const gain = audioCtx.createGain();
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.08, now + 0.1);
            gain.gain.setValueAtTime(0.08, now + 0.5);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
            noise.connect(filter).connect(gain).connect(audioCtx.destination);
            noise.start(now);
        }
    }
    function vibrate(p) {
        try { if (navigator.vibrate) navigator.vibrate(p); } catch(e) {}
    }

    window.playCelebration = function() {
        playSound("cheer");
        vibrate([60, 40, 60, 40, 120]);
    };

    let sessionShotCount = 0;
    window.setShotsRemaining = function(sessionCount) {
        sessionShotCount = sessionCount || 0;
        shotsRemainingText = "Shots: " + sessionShotCount + "/5";
    };

    function isInWater(x, y) {
        for (const w of activeHole.water) {
            if (w.type === "lake") {
                if (Math.hypot(x - w.x, y - w.y) < w.r) return true;
            } else if (w.type === "river") {
                if (y > w.y - w.width / 2 && y < w.y + w.width / 2) return true;
            }
        }
        return false;
    }

    function isInBunker(x, y) {
        for (const b of activeHole.bunkers) {
            if (Math.hypot(x - b.x, y - b.y) < b.r) return true;
        }
        return false;
    }

    function checkTreeCollision(x, y, z) {
        for (const t of activeHole.trees) {
            if (Math.hypot(x - t.x, y - t.y) < t.r && z < (t.h || 28)) return t;
        }
        return null;
    }

    window.setGameHeading = function(numberLabel, subtitle) {
        var header = hole.yardage ? hole.yardage + " Yards" : "";
        holeHeader.innerText = header;
        var sub = document.getElementById('hole-subtitle');
        if (sub) {
            sub.innerText = subtitle || "";
            sub.style.display = subtitle ? "block" : "none";
        }
    };

    // Captured template-default hazard coords so the daily green shift can move
    // hazards relative to their original placement without mutating HOLE_DEFS.
    let templateDefaults = null;
    function captureTemplateDefaults() {
        if (!templateDefaults || templateDefaults.name !== activeHole.name) {
            templateDefaults = {
                name: activeHole.name,
                yardage: activeHole.yardage,
                bunkers: activeHole.bunkers.map(b => ({ x: b.x, y: b.y, r: b.r })),
                water: activeHole.water.map(w => ({ ...w })),
                trees: activeHole.trees.map(t => ({ x: t.x, y: t.y, r: t.r, h: t.h })),
            };
        }
        return templateDefaults;
    }

    window.setDailyConditions = function(holeIndex, seed, conditions) {
        // Copy the template so reassigning its hazard arrays never mutates HOLE_DEFS.
        activeHole = { ...HOLE_DEFS[Math.max(0, Math.min(6, (holeIndex || 1) - 1))] };
        green.x = activeHole.greenX;
        green.radius = activeHole.greenRadius;
        tee.x = activeHole.teeX;

        const def = captureTemplateDefaults();
        const baseGreenY = tee.y - (def.yardage * pxPerYard);

        // Daily yardage (tee-to-green-center, 90-165). Shift the green up/down
        // from the template's designed position and drag every hazard along,
        // so each template's layout (bunkers/water/trees vs green) stays intact
        // at any distance.
        const yardage = (conditions && conditions.yardage) ? conditions.yardage : def.yardage;
        green.y = tee.y - (yardage * pxPerYard);
        const dy = green.y - baseGreenY;

        activeHole.bunkers = def.bunkers.map(b => ({ x: b.x, y: b.y + dy, r: b.r }));
        activeHole.water = def.water.map(w => ({ ...w, y: w.y + dy }));
        activeHole.trees = def.trees.map(t => ({ x: t.x, y: t.y + dy, r: t.r, h: t.h }));

        // Pin placement: server gives normalized -0.7..0.7 offsets, scaled by green radius.
        const pinNormX = (conditions && typeof conditions.pinNormX === "number") ? conditions.pinNormX : 0;
        const pinNormY = (conditions && typeof conditions.pinNormY === "number") ? conditions.pinNormY : 0;
        hole.x = green.x + pinNormX * green.radius;
        hole.y = green.y + pinNormY * green.radius;
        hole.yardage = yardage;

        // Wind: server gives speed (mph) + angle (degrees).
        wind.speed = (conditions && typeof conditions.windSpeed === "number") ? conditions.windSpeed : Math.floor(Math.random() * 12) + 4;
        if (conditions && typeof conditions.windAngleDeg === "number") {
            wind.angle = conditions.windAngleDeg * Math.PI / 180;
        } else {
            // Fallback: never blow straight up/down — keep at least 25° off vertical
            // so every shot drifts left-to-right or right-to-left.
            let deg = Math.floor(Math.random() * 360);
            const VA = 25;
            if (deg > 90 - VA && deg < 90 + VA) deg = deg < 90 ? 90 - VA : 90 + VA;
            else if (deg > 270 - VA && deg < 270 + VA) deg = deg < 270 ? 270 - VA : 270 + VA;
            wind.angle = deg * Math.PI / 180;
        }

        holeHeader.innerText = yardage + " Yards";
        resetGame();
    };

    let isDragging = false, hasDragged = false, dragStartX = 0, initialAim = 0;

    function getClientX(e) { return e.touches ? e.touches[0].clientX : e.clientX; }

    function getCanvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: (cx - rect.left) * (canvas.width / rect.width), y: (cy - rect.top) * (canvas.height / rect.height) };
    }

    function isLeaderboardArrowTap(x, y) {
        return x >= 10 && x <= 80 && y >= 580 && y <= 650;
    }

    function handleDown(e) {
        initAudio();
        if (gameState === 0) {
            const coords = getCanvasCoords(e);
            if (isLeaderboardArrowTap(coords.x, coords.y)) {
                if (window.onScrollToLeaderboard) window.onScrollToLeaderboard();
                return;
            }
            isDragging = true; hasDragged = false;
            dragStartX = getClientX(e); initialAim = aimDeviation;
        } else { handleTap(e); }
    }
    function handleMove(e) {
        if (isDragging && gameState === 0) {
            let cx = getClientX(e); let dx = cx - dragStartX;
            if (Math.abs(dx) > 5) hasDragged = true;
            aimDeviation = Math.max(-Math.PI/4, Math.min(Math.PI/4, initialAim + (dx * 0.005)));
        }
    }
    function handleUp(e) {
        if (isDragging && gameState === 0) { isDragging = false; if (!hasDragged) handleTap(e); }
    }

    async function handleTap(e) {
        if (e && e.cancelable) e.preventDefault();
        vibrate(15);
        if (gameState === 0) {
            if (sessionShotCount >= 5) return;
            startMeter();
        } else if (gameState === 1) {
            meter.finalPower = meter.powerValue; gameState = 2;
            meter.accValue = -50; meter.accDirection = 1;
            instructionTextContent = "Tap to lock Accuracy!";
        } else if (gameState === 2) {
            meter.finalAccuracy = meter.accValue;
            instructionTextContent = "In the air..."; hitBall();
        } else if (gameState === 5) {
            if (resultTimeoutId) { clearTimeout(resultTimeoutId); resultTimeoutId = null; }
            resetGame();
        }
    }

    function startMeter() {
        gameState = 1; meter.powerValue = 0; meter.powerDirection = 1;
        instructionTextContent = "Tap to lock Power!";
    }
    function showLockedMsg(msg) {
        lockedMessageText.innerText = msg || "Create a free account for unlimited plays!";
        lockedOverlay.style.display = 'block';
        instructionTextContent = "Action Denied";
    }

    let warningCallback = null;
    document.getElementById('warning-confirm').onclick = () => {
        warningOverlay.style.display = 'none';
        if (warningCallback) { warningCallback(); warningCallback = null; }
    };
    document.getElementById('warning-cancel').onclick = () => {
        warningOverlay.style.display = 'none';
        warningCallback = null;
        resetGame();
    };

    canvas.addEventListener('mousedown', handleDown);
    canvas.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    canvas.addEventListener('touchstart', handleDown, {passive: false});
    canvas.addEventListener('touchmove', handleMove, {passive: false});
    window.addEventListener('touchend', handleUp);

    function hitBall() {
        gameState = 3; ball.flightProgress = 0;
        playSound("impact"); vibrate(30);
        const distancePx = meter.finalPower * pxPerYard;
        const absAcc = Math.abs(meter.finalAccuracy);
        let deviationRads;
        if (absAcc <= 5) {
            deviationRads = meter.finalAccuracy * 0.003;
        } else {
            // Bad accuracy — heavy slice (positive) or hook (negative)
            const sign = Math.sign(meter.finalAccuracy);
            deviationRads = sign * (0.15 + (absAcc - 5) * 0.014 + Math.random() * 0.15);
        }
        const finalAngle = -Math.PI/2 + aimDeviation + deviationRads;
        const flightTimeScale = (meter.finalPower / maxDistance);
        const windDriftPx = wind.speed * flightTimeScale * 4;
        ball.landX = tee.x + Math.cos(finalAngle) * distancePx + Math.cos(wind.angle) * windDriftPx;
        ball.landY = tee.y + Math.sin(finalAngle) * distancePx + Math.sin(wind.angle) * windDriftPx;
    }

    function resetGame() {
        lockedOverlay.style.display = 'none';
        ball.x = tee.x; ball.y = tee.y; ball.z = 0; ball.vx = 0; ball.vy = 0;
        meter.powerValue = 0; meter.accValue = 0; aimDeviation = 0;
        gameState = 0;
        shotResultText = "";
        instructionTextContent = "Drag to Aim";
    }

    function endShot(isHoleInOne, distanceYards) {
        gameState = 5;
        sessionShotCount++;
        const distanceFeet = parseFloat((distanceYards * 3).toFixed(1));
        shotResultText = isHoleInOne ? "HOLE IN ONE!" : distanceFeet + " FT";
        instructionTextContent = sessionShotCount >= 5 ? "Session complete!" : "Tap to continue";
        if (isHoleInOne) {
            playSound("cup");
            setTimeout(() => playSound("cheer"), 200);
            vibrate([60, 40, 60, 40, 120]);
        } else {
            const onGreen = Math.hypot(ball.x - green.x, ball.y - green.y) <= green.radius;
            if (onGreen) {
                playSound("golfclap");
            } else {
                playSound("cup");
            }
            vibrate(25);
        }
        if (window.onShotComplete) { window.onShotComplete(distanceFeet, isHoleInOne); }
        if (sessionShotCount < 5) {
            resultTimeoutId = setTimeout(resetGame, 4000);
        }
    }

    function update() {
        if (gameState === 1) {
            meter.powerValue += meter.powerSpeed * meter.powerDirection;
            if (meter.powerValue >= maxDistance) { meter.powerValue = maxDistance; meter.powerDirection = -1; }
            else if (meter.powerValue <= 0) { meter.powerValue = 0; meter.powerDirection = 1; }
        } else if (gameState === 2) {
            meter.accValue += meter.accSpeed * meter.accDirection;
            if (meter.accValue >= 50) { meter.accValue = 50; meter.accDirection = -1; }
            else if (meter.accValue <= -50) { meter.accValue = -50; meter.accDirection = 1; }
        } else if (gameState === 3) {
            ball.flightProgress += 0.006;
            if (ball.flightProgress >= 1) {
                ball.flightProgress = 1;
                ball.x = ball.landX; ball.y = ball.landY;
                // Splash in water
                if (isInWater(ball.x, ball.y)) {
                    const d = Math.hypot(ball.x - hole.x, ball.y - hole.y);
                    endShot(false, parseFloat((d / pxPerYard).toFixed(1)));
                    return;
                }
                // Normal landing
                gameState = 4;
                const rollMomentum = (meter.finalPower / maxDistance) * 0.4;
                const angle = Math.atan2(ball.landY - tee.y, ball.landX - tee.x);
                ball.vx = Math.cos(angle) * rollMomentum;
                ball.vy = Math.sin(angle) * rollMomentum;
                playSound("roll");
            } else {
                ball.x = tee.x + (ball.landX - tee.x) * ball.flightProgress;
                ball.y = tee.y + (ball.landY - tee.y) * ball.flightProgress;
                ball.z = Math.sin(ball.flightProgress * Math.PI) * 40;
                // Tree collision during flight
                const tree = checkTreeCollision(ball.x, ball.y, ball.z);
                if (tree) {
                    ball.landX = ball.x; ball.landY = ball.y;
                    ball.flightProgress = 1;
                    if (isInWater(ball.x, ball.y)) {
                        const d = Math.hypot(ball.x - hole.x, ball.y - hole.y);
                        endShot(false, parseFloat((d / pxPerYard).toFixed(1)));
                        return;
                    }
                    gameState = 4;
                    playSound("roll");
                    const rollMomentum = (meter.finalPower / maxDistance) * 0.12;
                    const angle = Math.atan2(ball.landY - tee.y, ball.landX - tee.x);
                    ball.vx = Math.cos(angle) * rollMomentum;
                    ball.vy = Math.sin(angle) * rollMomentum;
                }
            }
        } else if (gameState === 4) {
            ball.x += ball.vx; ball.y += ball.vy;
            // Roll into water
            if (isInWater(ball.x, ball.y)) {
                const d = Math.hypot(ball.x - hole.x, ball.y - hole.y);
                endShot(false, parseFloat((d / pxPerYard).toFixed(1)));
                return;
            }
            const distToGreenCenter = Math.hypot(ball.x - green.x, ball.y - green.y);
            const onGreen = distToGreenCenter <= green.radius;
            let friction = 0.85;
            if (isInBunker(ball.x, ball.y)) friction = 0.7;
            else if (onGreen) { friction = 0.95; ball.vx += green.slopeX; ball.vy += green.slopeY; }
            ball.vx *= friction; ball.vy *= friction;
            const distToHolePx = Math.hypot(ball.x - hole.x, ball.y - hole.y);
            if (distToHolePx < hole.radius * 1.2 && Math.hypot(ball.vx, ball.vy) < 0.8) {
                ball.x = hole.x; ball.y = hole.y; ball.vx = 0; ball.vy = 0;
                endShot(true, 0);
            } else if (Math.abs(ball.vx) < 0.04 && Math.abs(ball.vy) < 0.04) {
                ball.vx = 0; ball.vy = 0;
                endShot(false, parseFloat((distToHolePx / pxPerYard).toFixed(1)));
            }
        }
    }

    function drawHazards() {
        // Water
        for (const w of activeHole.water) {
            ctx.fillStyle = '#1e6bb8';
            if (w.type === "lake") {
                ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#2a82d6';
                ctx.beginPath(); ctx.arc(w.x - w.r*0.2, w.y - w.r*0.2, w.r * 0.7, 0, Math.PI * 2); ctx.fill();
            } else if (w.type === "river") {
                ctx.fillRect(0, w.y - w.width/2, canvas.width, w.width);
                ctx.fillStyle = '#2a82d6';
                ctx.fillRect(0, w.y - w.width/2 + 3, canvas.width, w.width * 0.5);
            }
        }
        // Bunkers (sand)
        for (const b of activeHole.bunkers) {
            ctx.fillStyle = '#e8d5a3';
            ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#c4a96a'; ctx.lineWidth = 2; ctx.stroke();
        }
    }

    function drawTrees() {
        for (const t of activeHole.trees) {
            // Trunk
            ctx.fillStyle = '#5a3a1a';
            ctx.fillRect(t.x - 2, t.y - 2, 4, 8);
            // Canopy
            ctx.fillStyle = '#1a4d1a';
            ctx.beginPath(); ctx.arc(t.x, t.y - t.h * 0.5, t.r, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#2d6b2d';
            ctx.beginPath(); ctx.arc(t.x - t.r * 0.2, t.y - t.h * 0.5 - t.r * 0.2, t.r * 0.7, 0, Math.PI * 2); ctx.fill();
        }
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Background rough
        ctx.fillStyle = '#144526'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#0a2612';
        for (let i = 0; i < 16; i++) {
            ctx.beginPath();
            ctx.arc(5 + Math.sin(i * 0.8) * 20, i * 45, 40 + (Math.sin(i * 11) * 10), 0, Math.PI * 2);
            ctx.arc(395 + Math.cos(i * 0.5) * 20, i * 45, 40 + (Math.cos(i * 17) * 10), 0, Math.PI * 2);
            ctx.fill();
        }

        // Fairway
        ctx.fillStyle = '#267a3f';
        ctx.beginPath(); ctx.moveTo(140, 700);
        ctx.bezierCurveTo(180, 500, 90, 350, 130, 200);
        ctx.bezierCurveTo(130, 80, 280, 80, 270, 200);
        ctx.bezierCurveTo(280, 350, 220, 500, 260, 700);
        ctx.fill();

        // Hazards (water + bunkers)
        drawHazards();

        // Green
        ctx.fillStyle = '#329e51'; ctx.beginPath(); ctx.arc(green.x, green.y, green.radius + 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#4ade80'; ctx.beginPath(); ctx.arc(green.x, green.y, green.radius, 0, Math.PI * 2); ctx.fill();

        // Trees (on top of fairway, under ball)
        drawTrees();

        // Hole + pin + flag
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(hole.x, hole.y, hole.radius, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#eee'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(hole.x, hole.y); ctx.lineTo(hole.x, hole.y - 25); ctx.stroke();
        // Red flag triangle
        ctx.fillStyle = '#dc2626';
        ctx.beginPath();
        ctx.moveTo(hole.x, hole.y - 25);
        ctx.lineTo(hole.x + 14, hole.y - 22);
        ctx.lineTo(hole.x, hole.y - 19);
        ctx.closePath(); ctx.fill();

        // Tee box markers (white stakes)
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(tee.x - 28, tee.y + 2, 5, 15);
        ctx.fillRect(tee.x + 23, tee.y + 2, 5, 15);
        ctx.fillStyle = '#475569';
        ctx.fillRect(tee.x - 28, tee.y + 2, 5, 4);
        ctx.fillRect(tee.x + 23, tee.y + 2, 5, 4);

        // Aim line
        if (gameState === 0) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(tee.x, tee.y);
            const aimLen = 50; const finalAimAngle = -Math.PI/2 + aimDeviation;
            ctx.lineTo(tee.x + Math.cos(finalAimAngle) * aimLen, tee.y + Math.sin(finalAimAngle) * aimLen);
            ctx.stroke(); ctx.setLineDash([]);
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillText('Drag to Aim', tee.x, tee.y - aimLen - 12);
            ctx.fillStyle = '#facc15';
            ctx.fillText('Drag to Aim', tee.x, tee.y - aimLen - 13);
        }

        // Ball + shadow
        if (gameState >= 3) {
            const shadowRadius = ball.radius + (ball.z * 0.1);
            const opacity = Math.max(0.1, 0.4 - (ball.z * 0.005));
            ctx.fillStyle = "rgba(0, 0, 0, " + opacity + ")";
            ctx.beginPath(); ctx.arc(ball.x, ball.y, shadowRadius, 0, Math.PI * 2); ctx.fill();
        }
        const visualRadius = ball.radius + (ball.z * 0.05);
        ctx.beginPath(); ctx.arc(ball.x, ball.y - ball.z, visualRadius, 0, Math.PI * 2);
        const gradient = ctx.createRadialGradient(ball.x - 1, ball.y - ball.z - 1, 0, ball.x, ball.y - ball.z, visualRadius);
        gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(1, 'rgba(120,120,120,1)');
        ctx.fillStyle = gradient; ctx.fill();

        // Wind UI
        const windUIX = canvas.width - 75; const windUIY = 15;
        ctx.fillStyle = 'rgba(250, 250, 245, 0.95)';
        ctx.beginPath(); ctx.roundRect(windUIX, windUIY, 60, 60, 8); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.stroke();
        ctx.fillStyle = '#111'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(wind.speed + ' MPH', windUIX + 30, windUIY + 18);
        ctx.save(); ctx.translate(windUIX + 30, windUIY + 40); ctx.rotate(wind.angle);
        ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.lineTo(5, -5); ctx.moveTo(10, 0); ctx.lineTo(5, 5);
        ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();

        // Foursome Finder logo (bottom-right, visible in screenshots)
        if (logoLoaded) {
            const aspect = logoImg.naturalWidth / logoImg.naturalHeight || 1.3;
            const logoW = 130;
            const logoH = logoW / aspect;
            ctx.globalAlpha = 0.92;
            ctx.drawImage(logoImg, canvas.width - logoW - 5, canvas.height - logoH - 5, logoW, logoH);
            ctx.globalAlpha = 1;
        }

        // Power / accuracy meters
        if (gameState < 3) {
            const meterX = 25, meterY = 150, meterW = 40, meterH = 400;
            ctx.fillStyle = 'rgba(17, 17, 17, 0.8)'; ctx.fillRect(meterX, meterY, meterW, meterH);
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(meterX, meterY, meterW, meterH);
            ctx.fillStyle = '#fff'; ctx.font = '12px Arial'; ctx.textAlign = 'left';
            for (let yds = 0; yds <= maxDistance; yds += 20) {
                const yPos = meterY + meterH - (yds / maxDistance) * meterH;
                ctx.beginPath(); ctx.moveTo(meterX + meterW, yPos); ctx.lineTo(meterX + meterW + 10, yPos);
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
                ctx.fillStyle = '#aaa';
                if (yds > 0) ctx.fillText(yds, meterX + meterW + 15, yPos + 4);
            }
            let currentPower = (gameState === 1) ? meter.powerValue : (gameState >= 2 ? meter.finalPower : 0);
            const fillHeight = (currentPower / maxDistance) * meterH; const fillY = meterY + meterH - fillHeight;
            let pg = ctx.createLinearGradient(0, meterY + meterH, 0, meterY);
            pg.addColorStop(0, "#4ade80"); pg.addColorStop(0.5, "#facc15"); pg.addColorStop(1, "#ef4444");
            ctx.fillStyle = pg; ctx.fillRect(meterX, fillY, meterW, fillHeight);
            if (gameState >= 1) {
                const accX = 50, accY = canvas.height - 40, accW = 300, accH = 20;
                ctx.fillStyle = 'rgba(17, 17, 17, 0.8)'; ctx.fillRect(accX, accY, accW, accH);
                ctx.strokeStyle = '#fff'; ctx.strokeRect(accX, accY, accW, accH);
                ctx.fillStyle = '#4ade80'; ctx.fillRect(accX + accW/2 - 10, accY, 20, accH);
                ctx.fillStyle = '#fff'; ctx.fillRect(accX + accW/2 - 1, accY, 2, accH);
                let currentAcc = (gameState === 2) ? meter.accValue : meter.finalAccuracy;
                let cursorPixX = accX + (accW / 2) + ((currentAcc / 50) * (accW / 2));
                ctx.fillStyle = '#ffea00'; ctx.fillRect(cursorPixX - 3, accY - 5, 6, accH + 10);
            }
        }

        // Shots remaining (under power meter, large)
        if (shotsRemainingText) {
            ctx.font = 'bold 20px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillText(shotsRemainingText, 45, 580);
            ctx.fillStyle = '#fff';
            ctx.fillText(shotsRemainingText, 45, 578);
            // Bouncing down-arrow with "Leaderboard" label pointing below
            const bounceY = Math.sin(Date.now() / 300) * 4;
            const hintY = 598 + bounceY;
            // "Leaderboard" label
            ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillText('Leaderboard', 45, hintY + 2);
            ctx.fillStyle = '#facc15';
            ctx.fillText('Leaderboard', 45, hintY + 1);
            // Larger down arrow below the text
            ctx.strokeStyle = '#facc15'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(45, hintY + 8);
            ctx.lineTo(45, hintY + 24);
            ctx.lineTo(36, hintY + 15);
            ctx.moveTo(45, hintY + 24);
            ctx.lineTo(54, hintY + 15);
            ctx.stroke();
        }



        // Tap to Swing golf ball (right side)
        if (gameState === 0) {
            const tbX = 335, tbY = 500;
            const tbGrad = ctx.createRadialGradient(tbX - 6, tbY - 6, 0, tbX, tbY, 22);
            tbGrad.addColorStop(0, '#ffffff');
            tbGrad.addColorStop(1, '#999999');
            ctx.beginPath(); ctx.arc(tbX, tbY, 22, 0, Math.PI * 2);
            ctx.fillStyle = tbGrad; ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = 'rgba(0,0,0,0.08)';
            for (let dx = -12; dx <= 12; dx += 6) {
                for (let dy = -12; dy <= 12; dy += 6) {
                    if (Math.hypot(dx, dy) <= 12) {
                        ctx.beginPath(); ctx.arc(tbX + dx, tbY + dy, 1.5, 0, Math.PI * 2); ctx.fill();
                    }
                }
            }
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('Tap to', tbX, tbY + 40);
            ctx.fillText('Swing', tbX, tbY + 56);
            ctx.fillStyle = '#facc15';
            ctx.fillText('Tap to', tbX, tbY + 39);
            ctx.fillText('Swing', tbX, tbY + 55);
        }

        // Shot result (big text, center of screen)
        if (gameState === 5 && shotResultText) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.82)';
            ctx.fillRect(40, 265, 320, 135);
            ctx.strokeStyle = '#facc15'; ctx.lineWidth = 3;
            ctx.strokeRect(40, 265, 320, 135);
            ctx.textAlign = 'center';
            if (shotResultText === "HOLE IN ONE!") {
                ctx.fillStyle = '#facc15';
                ctx.font = 'bold 30px sans-serif';
                ctx.fillText(shotResultText, 200, 340);
            } else {
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 42px sans-serif';
                ctx.fillText(shotResultText, 200, 335);
                ctx.fillStyle = '#facc15';
                ctx.font = 'bold 15px sans-serif';
                ctx.fillText('FROM THE PIN', 200, 365);
            }
        }
    }

    function loop() { update(); draw(); requestAnimationFrame(loop); }
    loop();
    window.resetGame = resetGame;

    if (window.onGameReady) { window.onGameReady(); }
    else { window.setDailyConditions(1, "test-seed-123"); }
<\/script>
</body>
</html>`;

export default minigameHtml;
