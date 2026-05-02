// DOM Elements
const videoUrlInput = document.getElementById('videoUrl');
const pasteBtn = document.getElementById('pasteBtn');
const fetchBtn = document.getElementById('fetchBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusDiv = document.getElementById('status');
const previewSection = document.getElementById('previewSection');
const progressSection = document.getElementById('progressSection');
const historyList = document.getElementById('historyList');

// Settings Elements
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeModalBtn = document.getElementById('closeModal');
const downloadLocationInput = document.getElementById('downloadLocation');
const currentLocationDisplay = document.getElementById('currentLocation');
const displayLocationSpan = document.getElementById('displayLocation');
const saveLocationBtn = document.getElementById('saveLocationBtn');
const resetLocationBtn = document.getElementById('resetLocationBtn');

// Quality and Mode Selection
let selectedQuality = null;
let selectedQualityLabel = '';
let selectedMode = 'video';
let downloadLocation = 'D:\Movie';
let availableFormats = [];
let availableAudioFormats = [];

// Initialize Event Listeners
document.addEventListener('DOMContentLoaded', init);

function init() {
    // Load download location
    loadDownloadLocation();

    // Mode selection
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedMode = btn.dataset.mode;
            showStatus(`Mode changed to: ${selectedMode}`, 'info');
            renderQualityOptions();
        });
    });

    // Quality selection container
    document.getElementById('qualityGrid').addEventListener('click', (event) => {
        const card = event.target.closest('.quality-card');
        if (!card) return;

        document.querySelectorAll('.quality-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        selectedQuality = card.dataset.formatId;
        selectedQualityLabel = card.dataset.label || card.querySelector('h4')?.textContent || '';
        document.getElementById('selectedQuality').value = selectedQuality;
        showStatus(`Quality selected: ${selectedQualityLabel}`, 'success');
        downloadBtn.disabled = false;
    });

    // Buttons
    pasteBtn.addEventListener('click', pasteFromClipboard);
    fetchBtn.addEventListener('click', fetchVideoDetails);
    downloadBtn.addEventListener('click', startDownload);
    document.getElementById('copyLinkBtn').addEventListener('click', copyVideoLink);
    document.getElementById('shareBtn').addEventListener('click', shareVideo);

    // Settings
    settingsBtn.addEventListener('click', openSettings);
    closeModalBtn.addEventListener('click', closeSettings);
    saveLocationBtn.addEventListener('click', saveDownloadLocation);
    resetLocationBtn.addEventListener('click', resetDownloadLocation);
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettings();
    });

    // Load history
    loadHistory();
}

// Load download location from localStorage
function loadDownloadLocation() {
    const stored = localStorage.getItem('downloadLocation');
    downloadLocation = stored || 'D:\\Movie';
    updateLocationDisplay();
}

// Update location display
function updateLocationDisplay() {
    displayLocationSpan.textContent = downloadLocation;
    currentLocationDisplay.textContent = downloadLocation;
    downloadLocationInput.value = downloadLocation;
}

// Open settings modal
function openSettings() {
    settingsModal.classList.add('active');
    downloadLocationInput.focus();
}

// Close settings modal
function closeSettings() {
    settingsModal.classList.remove('active');
}

// Save download location
function saveDownloadLocation() {
    const newLocation = downloadLocationInput.value.trim();

    if (!newLocation) {
        showStatus('Please enter a valid download location', 'error');
        return;
    }

    // Basic validation - check if path looks reasonable
    if (newLocation.length < 3) {
        showStatus('Download location path is too short', 'error');
        return;
    }

    downloadLocation = newLocation;
    localStorage.setItem('downloadLocation', downloadLocation);
    updateLocationDisplay();
    showStatus(`✓ Download location saved: ${downloadLocation}`, 'success');
    setTimeout(() => closeSettings(), 500);
}

// Reset download location to default
function resetDownloadLocation() {
    downloadLocation = 'D:\\Movie';
    localStorage.setItem('downloadLocation', downloadLocation);
    updateLocationDisplay();
    showStatus('✓ Download location reset to default', 'success');
}

// Paste from clipboard
async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        videoUrlInput.value = text;
        showStatus('Link pasted successfully!', 'success');
    } catch (err) {
        showStatus('Failed to paste from clipboard', 'error');
    }
}

// Extract YouTube ID from URL
function extractVideoId(url) {
    if (!url) return null;

    // Direct video ID
    if (url.match(/^[a-zA-Z0-9_-]{11}$/)) {
        return url;
    }

    // youtube.com/watch?v=...
    const match1 = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (match1) return match1[1];

    // youtu.be/...
    const match2 = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (match2) return match2[1];

    // youtube.com/embed/...
    const match3 = url.match(/embed\/([a-zA-Z0-9_-]{11})/);
    if (match3) return match3[1];

    return null;
}

// Fetch video details
async function fetchVideoDetails() {
    const url = videoUrlInput.value.trim();

    if (!url) {
        showStatus('Please enter a YouTube URL or video ID', 'error');
        return;
    }

    showStatus('Fetching video details...', 'info');
    fetchBtn.disabled = true;

    try {
        const response = await fetch(`/api/video?url=${encodeURIComponent(url)}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Could not fetch video details');
        }

        const videoId = extractVideoId(url);
        displayVideoPreview(data, videoId);
        availableFormats = data.availableVideoFormats || [];
        availableAudioFormats = data.availableAudioFormats || [];
        selectedQuality = null;
        selectedQualityLabel = '';
        renderQualityOptions();
        showStatus('Video details loaded successfully! Choose a quality to download.', 'success');
    } catch (error) {
        showStatus('Error fetching video details: ' + error.message, 'error');
        downloadBtn.disabled = true;
    } finally {
        fetchBtn.disabled = false;
    }
}

// Display video preview
function displayVideoPreview(videoData, videoId) {
    // Update player
    document.getElementById('player').src = `https://www.youtube.com/embed/${videoId}?rel=0`;

    // Update info
    document.getElementById('videoTitle').textContent = videoData.title;
    document.getElementById('videoChannel').textContent = `${videoData.channel} • ${videoData.views} views`;
    document.getElementById('viewCount').textContent = videoData.views;
    document.getElementById('videoDuration').textContent = videoData.duration;
    document.getElementById('uploadDate').textContent = videoData.uploadDate;
    document.getElementById('durationBadge').textContent = videoData.duration;

    // Update quality hint for mode
    const modeHint = selectedMode === 'audio' ? 'Choose an audio format to download.' : 'Choose a video quality to download.';
    document.getElementById('qualityHint').textContent = modeHint;

    // Load thumbnail
    const img = document.getElementById('thumbnail');
    img.src = videoData.thumbnail;
    img.onerror = () => {
        img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="225"%3E%3Crect fill="%23282828" width="400" height="225"/%3E%3C/svg%3E';
    };

    // Update link button
    document.getElementById('youtubeBtn').href = `https://www.youtube.com/watch?v=${videoId}`;

    // Show preview
    previewSection.style.display = 'block';
    previewSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Store current video ID
    videoUrlInput.dataset.currentId = videoId;
}

function renderQualityOptions() {
    const grid = document.getElementById('qualityGrid');
    const hint = document.getElementById('qualityHint');
    grid.innerHTML = '';

    const options = selectedMode === 'audio' ? availableAudioFormats : availableFormats;
    if (!options.length) {
        grid.innerHTML = '<div class="quality-placeholder">No quality options available for this mode. Try a different mode or another video.</div>';
        hint.textContent = selectedMode === 'audio' ? 'No audio formats found.' : 'No video qualities found.';
        downloadBtn.disabled = true;
        return;
    }

    options.forEach((option, index) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'quality-card';
        card.dataset.formatId = option.formatId;
        card.dataset.label = option.label;
        card.innerHTML = `
            <span class="quality-badge">${selectedMode === 'audio' ? '🔊' : '🎬'}</span>
            <h4>${option.label}</h4>
            <p>${option.description}</p>
        `;
        grid.appendChild(card);

        if (index === 0) {
            card.classList.add('active');
            selectedQuality = option.formatId;
            selectedQualityLabel = option.label;
        }
    });

    hint.textContent = selectedMode === 'audio' ? 'Select the audio stream you want to download.' : 'Select the video quality you want to download.';
    if (options.length > 0) {
        downloadBtn.disabled = false;
        showStatus(`Quality selected: ${selectedQualityLabel}. Ready to download.`, 'success');
    } else {
        selectedQuality = null;
        selectedQualityLabel = '';
        downloadBtn.disabled = true;
    }
}

// Start download
async function startDownload() {
    const url = videoUrlInput.value.trim();

    if (!url) {
        showStatus('Please fetch a video first', 'error');
        return;
    }

    if (!selectedQuality) {
        showStatus('Please choose a quality option before downloading.', 'error');
        return;
    }

    showStatus('Starting download...', 'info');
    downloadBtn.disabled = true;
    progressSection.style.display = 'block';
    progressSection.scrollIntoView({ behavior: 'smooth' });
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressText').textContent = '0%';
    document.getElementById('progressSpeed').textContent = 'Preparing...';

    const params = new URLSearchParams({
        url,
        formatId: selectedQuality,
        mode: selectedMode,
        location: downloadLocation
    });

    const eventSource = new EventSource(`/api/download-stream?${params.toString()}`);

    eventSource.addEventListener('progress', (event) => {
        const progress = JSON.parse(event.data);
        document.getElementById('progressFill').style.width = `${progress.percent}%`;
        document.getElementById('progressText').textContent = `${Math.round(progress.percent)}%`;
        document.getElementById('progressSpeed').textContent = progress.speed ? `Speed: ${progress.speed}` : progress.message;
    });

    eventSource.addEventListener('done', (event) => {
        const data = JSON.parse(event.data);
        document.getElementById('progressFill').style.width = '100%';
        document.getElementById('progressText').textContent = '100%';
        document.getElementById('progressSpeed').textContent = `Saved to: ${data.filePaths.join(', ')}`;
        showStatus(`Download completed! Saved to: ${data.filePaths.join(', ')}`, 'success');
        addToHistory(extractVideoId(url));
        downloadBtn.disabled = false;
        eventSource.close();
    });

    eventSource.addEventListener('error', (event) => {
        let message = 'Download failed';
        if (event.data) {
            const data = JSON.parse(event.data);
            message = data.message || message;
        }
        showStatus(message, 'error');
        downloadBtn.disabled = false;
        eventSource.close();
    });
}

// Copy video link
async function copyVideoLink() {
    const videoId = videoUrlInput.dataset.currentId;
    if (!videoId) return;

    const link = `https://www.youtube.com/watch?v=${videoId}`;
    try {
        await navigator.clipboard.writeText(link);
        showStatus('Link copied to clipboard!', 'success');
    } catch (err) {
        showStatus('Failed to copy link', 'error');
    }
}

// Share video
function shareVideo() {
    const videoId = videoUrlInput.dataset.currentId;
    if (!videoId) return;

    const link = `https://www.youtube.com/watch?v=${videoId}`;
    const title = document.getElementById('videoTitle').textContent;

    if (navigator.share) {
        navigator.share({
            title: title,
            url: link
        }).catch(err => console.log('Share cancelled'));
    } else {
        copyVideoLink();
    }
}

// Add to history
function addToHistory(videoId) {
    const history = getHistoryData();
    const videoTitle = document.getElementById('videoTitle').textContent;
    const thumbnail = document.getElementById('thumbnail').src;

    const newItem = {
        id: videoId,
        title: videoTitle,
        thumbnail: thumbnail,
        quality: selectedQuality,
        mode: selectedMode,
        location: downloadLocation,
        timestamp: new Date().toLocaleString()
    };

    history.unshift(newItem);
    if (history.length > 10) history.pop();

    localStorage.setItem('downloadHistory', JSON.stringify(history));
    loadHistory();
}

// Load history from localStorage
function loadHistory() {
    const history = getHistoryData();

    if (history.length === 0) {
        historyList.innerHTML = '<p class="empty-state">No downloads yet. Start by fetching a video!</p>';
        return;
    }

    historyList.innerHTML = history.map(item => `
        <div class="history-item">
            <img src="${item.thumbnail}" alt="Thumbnail" class="history-thumbnail" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%2256%22%3E%3Crect fill=%22%23282828%22 width=%22100%22 height=%2256%22/%3E%3C/svg%3E'">
            <div class="history-info">
                <div class="history-title" title="${item.title}">${item.title}</div>
                <div class="history-details">${item.timestamp}</div>
                <div class="history-location">📁 ${item.location || 'D:\\Movie'}</div>
                <div class="history-quality">${item.quality} • ${item.mode}</div>
            </div>
        </div>
    `).join('');
}

// Get history data
function getHistoryData() {
    const stored = localStorage.getItem('downloadHistory');
    return stored ? JSON.parse(stored) : [];
}

// Show status message
function showStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + type;

    if (type !== 'info') {
        setTimeout(() => {
            statusDiv.textContent = '';
            statusDiv.className = 'status';
        }, 5000);
    }
}

// Store current video ID
videoUrlInput.addEventListener('input', (e) => {
    if (e.target.value) {
        fetchBtn.disabled = false;
    }
});

// Allow Enter key to fetch
videoUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        fetchVideoDetails();
    }
});