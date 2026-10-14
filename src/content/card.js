/*
 * Share Tweet as Image: draws a post as an image card, the way the app's share sheet renders one
 * for Stories. Images come through the background as data URLs, so the canvas stays readable.
 */
(function () {
    'use strict';

    const XPT = globalThis.XPT;

    const WIDTH = 1080;
    const PAD = 64;
    const AVATAR = 112;
    const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Noto Color Emoji", "Segoe UI Emoji", sans-serif';

    async function loadImage(url) {
        if (!url) return null;
        try {
            const result = await XPT.background({ type: 'fetchImage', url });
            if (!result?.dataUrl) return null;
            const image = new Image();
            image.src = result.dataUrl;
            await image.decode();
            return image;
        } catch {
            return null;
        }
    }

    /** Splits text into lines that fit width, breaking words that are longer than a line. */
    function wrap(context, text, width) {
        const lines = [];
        for (const paragraph of text.split('\n')) {
            let line = '';
            for (const word of paragraph.split(/(\s+)/)) {
                const candidate = line + word;
                if (context.measureText(candidate).width <= width) {
                    line = candidate;
                    continue;
                }
                if (line.trim()) lines.push(line.trimEnd());
                line = word.trimStart();
                while (context.measureText(line).width > width) {
                    let cut = line.length - 1;
                    while (cut > 1 && context.measureText(line.slice(0, cut)).width > width) cut--;
                    lines.push(line.slice(0, cut));
                    line = line.slice(cut);
                }
            }
            lines.push(line.trimEnd());
        }
        while (lines.length && !lines[lines.length - 1]) lines.pop();
        return lines;
    }

    function formatDate(createdAt) {
        const date = new Date(createdAt);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', year: 'numeric', month: 'short', day: 'numeric' });
    }

    /** The card as a PNG blob. */
    XPT.renderCard = async function (post, dark) {
        const colors = dark
            ? { background: '#000000', text: '#e7e9ea', muted: '#71767b', border: '#2f3336' }
            : { background: '#ffffff', text: '#0f1419', muted: '#536471', border: '#cfd9de' };

        const [avatar, photo] = await Promise.all([
            loadImage(post.avatar ? post.avatar.replace(/_normal(\.\w+)$/, '_400x400$1') : ''),
            loadImage(post.media[0]?.preview || ''),
        ]);

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const textWidth = WIDTH - PAD * 2;
        context.font = `400 40px ${FONT}`;
        const lines = post.text ? wrap(context, post.text, textWidth) : [];
        const lineHeight = 56;

        const photoHeight = photo ? Math.min(Math.round(textWidth * photo.naturalHeight / photo.naturalWidth), 1200) : 0;
        const height = PAD + AVATAR + 40 + lines.length * lineHeight + (photo ? photoHeight + 32 : 0) + 40 + 52 + PAD - 24;

        canvas.width = WIDTH;
        canvas.height = height;
        context.fillStyle = colors.background;
        context.fillRect(0, 0, WIDTH, height);

        // Author
        let y = PAD;
        if (avatar) {
            context.save();
            context.beginPath();
            context.arc(PAD + AVATAR / 2, y + AVATAR / 2, AVATAR / 2, 0, Math.PI * 2);
            context.clip();
            context.drawImage(avatar, PAD, y, AVATAR, AVATAR);
            context.restore();
        } else {
            context.fillStyle = colors.border;
            context.beginPath();
            context.arc(PAD + AVATAR / 2, y + AVATAR / 2, AVATAR / 2, 0, Math.PI * 2);
            context.fill();
        }

        const nameX = PAD + AVATAR + 28;
        context.textBaseline = 'alphabetic';
        context.fillStyle = colors.text;
        context.font = `700 40px ${FONT}`;
        context.fillText(post.name || post.screenName, nameX, y + 50, WIDTH - nameX - PAD);
        context.fillStyle = colors.muted;
        context.font = `400 34px ${FONT}`;
        context.fillText(`@${post.screenName}`, nameX, y + 96, WIDTH - nameX - PAD);
        y += AVATAR + 40;

        // Text
        context.fillStyle = colors.text;
        context.font = `400 40px ${FONT}`;
        for (const line of lines) {
            y += lineHeight;
            context.fillText(line, PAD, y - 14);
        }

        // First photo or video still
        if (photo) {
            y += 32;
            context.save();
            const radius = 24;
            context.beginPath();
            context.roundRect(PAD, y, textWidth, photoHeight, radius);
            context.clip();
            const scale = Math.max(textWidth / photo.naturalWidth, photoHeight / photo.naturalHeight);
            const drawWidth = photo.naturalWidth * scale;
            const drawHeight = photo.naturalHeight * scale;
            context.drawImage(photo, PAD + (textWidth - drawWidth) / 2, y + (photoHeight - drawHeight) / 2, drawWidth, drawHeight);
            context.restore();
            y += photoHeight;
        }

        // Footer
        y += 40;
        context.strokeStyle = colors.border;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(PAD, y);
        context.lineTo(WIDTH - PAD, y);
        context.stroke();
        y += 52;
        context.fillStyle = colors.muted;
        context.font = `400 30px ${FONT}`;
        const footer = [formatDate(post.createdAt), `x.com/${post.screenName}/status/${post.id}`].filter(Boolean).join('  ·  ');
        context.fillText(footer, PAD, y, textWidth);

        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not render the image'))), 'image/png');
        });
    };
})();
