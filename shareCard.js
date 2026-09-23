// Canvas-based share card generator for the Closest to the Pin Challenge.
// Draws a dual-section card (green header + olive footer) matching the
// reference design, returns a canvas element that can be shown on screen
// and shared as a PNG image file.

const GREEN = '#175429';
const OLIVE = '#6C5B17';
const YELLOW = '#F0D700';
const WHITE = '#FFFFFF';
const BORDER_OLIVE = '#5C5724';
const DART_BLUE = '#3B82F6';
const PLAY_URL = 'https://foursomefinder.com/play';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBullseye(ctx, cx, cy, r) {
  // Outer ring (white)
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  // Middle ring (yellow)
  ctx.strokeStyle = YELLOW;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.65, 0, Math.PI * 2);
  ctx.stroke();
  // Inner circle (red center)
  ctx.fillStyle = '#DC2626';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  // Dart (blue) — arrow pointing into center from upper-right
  ctx.fillStyle = DART_BLUE;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4); // 45° from upper right
  // Shaft
  ctx.fillStyle = DART_BLUE;
  ctx.fillRect(-2, -r * 0.9, 4, r * 0.6);
  // Flight (fletching)
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.9);
  ctx.lineTo(-8, -r * 0.9 - 8);
  ctx.lineTo(8, -r * 0.9 - 8);
  ctx.closePath();
  ctx.fill();
  // Tip
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.3);
  ctx.lineTo(-3, -r * 0.3 + 6);
  ctx.lineTo(3, -r * 0.3 + 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Generates a share card canvas for the Closest to the Pin Challenge.
 * @param {Object} opts
 * @param {string} opts.playerName - Display name
 * @param {number} opts.distance - Best distance from pin in feet (0 = HIO)
 * @param {boolean} opts.isHoleInOne - True if the best shot was a hole in one
 * @param {number} opts.aceCount - Number of aces in the session
 * @param {string} opts.dateLabel - Date string, e.g. "Tuesday, Sep 22"
 * @param {number} [opts.dailyNumber] - Daily challenge number
 * @returns {HTMLCanvasElement}
 */
export function generateShareCard({ playerName, distance, isHoleInOne, aceCount, dateLabel, dailyNumber }) {
  const scale = 2; // retina
  const W = 360;
  const H = 500;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // ── Background sections ──
  const sectionBreak = 330;
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, W, sectionBreak);
  ctx.fillStyle = OLIVE;
  ctx.fillRect(0, sectionBreak, W, H - sectionBreak);

  // ── Top section (green) ──
  // Heading
  ctx.fillStyle = YELLOW;
  ctx.font = 'bold 15px Inter, Arial, sans-serif';
  const heading = dailyNumber
    ? `CLOSEST TO THE PIN CHALLENGE #${String(dailyNumber).padStart(3, '0')}`
    : 'CLOSEST TO THE PIN CHALLENGE';
  ctx.fillText(heading, W / 2, 35);

  // Date
  ctx.fillStyle = '#D4D4D4';
  ctx.font = '12px Inter, Arial, sans-serif';
  ctx.fillText(dateLabel || '', W / 2, 55);

  // Player name
  ctx.fillStyle = WHITE;
  ctx.font = 'bold 22px Inter, Arial, sans-serif';
  ctx.fillText(playerName || 'You', W / 2, 90);

  // Bullseye icon
  drawBullseye(ctx, W / 2, 165, 38);

  // Score result
  ctx.fillStyle = YELLOW;
  ctx.font = 'bold 40px Inter, Arial, sans-serif';
  const scoreText = isHoleInOne ? 'HIO!' : `${distance} ft`;
  ctx.fillText(scoreText, W / 2, 250);

  // Sub-label
  ctx.fillStyle = WHITE;
  ctx.font = '14px Inter, Arial, sans-serif';
  const subLabel = isHoleInOne
    ? 'Hole in One!'
    : 'from the pin';
  ctx.fillText(subLabel, W / 2, 275);

  // Ace count (if multiple aces)
  if (aceCount > 1) {
    ctx.fillStyle = YELLOW;
    ctx.font = 'bold 13px Inter, Arial, sans-serif';
    ctx.fillText(`${aceCount} Aces!`, W / 2, 295);
  }

  // Play link pill
  const pillText = `Play at ${PLAY_URL.replace('https://', '')}`;
  ctx.font = '11px Inter, Arial, sans-serif';
  const pillW = ctx.measureText(pillText).width + 28;
  const pillH = 30;
  const pillX = (W - pillW) / 2;
  const pillY = 305;
  ctx.strokeStyle = BORDER_OLIVE;
  ctx.lineWidth = 2;
  roundRect(ctx, pillX, pillY, pillW, pillH, 15);
  ctx.stroke();
  ctx.fillStyle = YELLOW;
  ctx.fillText(pillText, W / 2, pillY + 20);

  // ── Bottom section (olive) ──
  ctx.textAlign = 'left';
  const padX = 20;
  let lineY = sectionBreak + 32;

  // Message line 1
  ctx.fillStyle = WHITE;
  ctx.font = '13px Inter, Arial, sans-serif';
  const scorePhrase = isHoleInOne ? '🎯 HOLE IN ONE' : `🎯 ${distance} ft from pin`;
  ctx.fillText(scorePhrase, padX, lineY);
  lineY += 20;

  // Message line 2
  ctx.fillText('on Closest to the Pin Challenge!', padX, lineY);
  lineY += 24;

  // CTA
  ctx.font = 'bold 14px Inter, Arial, sans-serif';
  ctx.fillStyle = YELLOW;
  ctx.fillText('Can you beat me?', padX, lineY);
  lineY += 30;

  // URL (underlined)
  ctx.fillStyle = WHITE;
  ctx.font = '12px Inter, Arial, sans-serif';
  const urlText = PLAY_URL;
  ctx.fillText(urlText, padX, lineY);
  const urlW = ctx.measureText(urlText).width;
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, lineY + 3);
  ctx.lineTo(padX + urlW, lineY + 3);
  ctx.stroke();

  return canvas;
}

/**
 * Shows the share card on screen in a modal overlay and attempts to share
 * it as a PNG image file via navigator.share. Falls back to showing the
 * card for the user to screenshot.
 */
export async function shareCardImage(cardOpts) {
  const canvas = generateShareCard(cardOpts);
  const dataUrl = canvas.toDataURL('image/png');

  // Build a modal overlay showing the card
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;';

  const img = document.createElement('img');
  img.src = dataUrl;
  img.style.cssText = 'max-width:340px;width:100%;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.5);';
  modal.appendChild(img);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;justify-content:center;';

  const shareBtn = document.createElement('button');
  shareBtn.textContent = '📤 Share Image';
  shareBtn.style.cssText = 'background:#F0D700;color:#175429;border:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Close';
  closeBtn.style.cssText = 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.3);padding:12px 20px;border-radius:8px;font-size:14px;cursor:pointer;';

  btnRow.appendChild(shareBtn);
  btnRow.appendChild(closeBtn);
  modal.appendChild(btnRow);

  const hint = document.createElement('p');
  hint.textContent = 'Tip: screenshot this card to share anywhere';
  hint.style.cssText = 'color:rgba(255,255,255,0.6);font-size:12px;margin-top:10px;text-align:center;';
  modal.appendChild(hint);

  document.body.appendChild(modal);

  closeBtn.onclick = () => modal.remove();

  // Try sharing as an image file
  shareBtn.onclick = async () => {
    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], 'closest-to-the-pin.png', { type: 'image/png' });
      const shareText = `🎯 ${cardOpts.isHoleInOne ? 'Hole in One' : cardOpts.distance + ' ft from pin'} on Closest to the Pin Challenge! Can you beat me? ${PLAY_URL}`;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: shareText, title: 'Closest to the Pin Challenge' });
        modal.remove();
      } else if (navigator.share) {
        await navigator.share({ text: shareText, url: PLAY_URL, title: 'Closest to the Pin Challenge' });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareText);
        shareBtn.textContent = '✓ Copied link!';
        setTimeout(() => { shareBtn.textContent = '📤 Share Image'; }, 2000);
      }
    } catch (e) {
      // User cancelled or share failed — keep modal open so they can screenshot
    }
  };
}
