const CONFIG = {
    BASE_URL: 'https://www.googleapis.com/youtube/v3',
    STORAGE_KEY: 'streamq_yt_api_key',
    CACHE_EXPIRY: { 
        TRENDING: 1000 * 60 * 60 * 1, // 1 Hour (Synced with City IP Cycle)
        SEARCH: 1000 * 60 * 60 * 1,   // 1 Hour
        LOCATION: 1000 * 60 * 60 * 1  // 1 Hour IP Lookup
    }
};

// Global YouTube Player instance reference
let ytPlayer = null;
let isYTAPIReady = false;

// YouTube IFrame API Ready Callback
window.onYouTubeIframeAPIReady = function() {
    isYTAPIReady = true;
};

// --- GEOLOCATION SERVICE (CITY-BASED) ---
const GeoService = {
    async getUserLocation(forceRefresh = false) {
        const cacheKey = 'yt_user_location_info';
        
        if (!forceRefresh) {
            const cached = CacheManager.get(cacheKey);
            if (cached) return cached;
        }
        
        try {
            // Free IP geolocation endpoint returning city details
            const res = await fetch('https://ipapi.co/json/');
            const data = await res.json();
            
            const locationInfo = {
                city: data.city || 'Bengaluru',
                code: data.country_code || 'IN', 
                name: data.country_name || 'India'
            };
            
            // Cache location for 1 hour to optimize network calls
            CacheManager.set(cacheKey, locationInfo, CONFIG.CACHE_EXPIRY.LOCATION);
            return locationInfo;
        } catch (error) {
            console.error('Failed to fetch location. Defaulting to fallback location.', error);
            const defaultLocation = { city: 'Bengaluru', code: 'IN', name: 'India' };
            CacheManager.set(cacheKey, defaultLocation, CONFIG.CACHE_EXPIRY.LOCATION);
            return defaultLocation;
        }
    },

    // Hourly background check interval for IP lookup & Feed auto-refresh
    startHourlyIPCheck() {
        setInterval(async () => {
            const oldLocation = CacheManager.get('yt_user_location_info');
            const newLocation = await this.getUserLocation(true); // Force fresh IP lookup
            
            // If city changed or IP cache expired, refresh the active UI feed automatically
            if (!oldLocation || oldLocation.city !== newLocation.city) {
                console.log(`IP Location updated to: ${newLocation.city}. Auto-refreshing feeds...`);
                UI.refreshCurrentFeed();
            }
        }, 1000 * 60 * 60); // Runs every 1 hour
    }
};

// --- FORMATTERS ---
const Formatters = {
    views(count) {
        if (!count) return '0 views';
        const num = Number(count);
        if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B views';
        if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M views';
        if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K views';
        return num.toLocaleString() + ' views';
    },
    likes(count) {
        if (!count) return '0';
        const num = Number(count);
        if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
        return num.toLocaleString();
    },
    date(isoString) {
        if (!isoString) return '';
        const date = new Date(isoString);
        const now = new Date();
        const seconds = Math.floor((now - date) / 1000);

        let interval = Math.floor(seconds / 31536000);
        if (interval >= 1) return interval + (interval === 1 ? ' year ago' : ' years ago');
        interval = Math.floor(seconds / 2592000);
        if (interval >= 1) return interval + (interval === 1 ? ' month ago' : ' months ago');
        interval = Math.floor(seconds / 86400);
        if (interval >= 1) return interval + (interval === 1 ? ' day ago' : ' days ago');
        interval = Math.floor(seconds / 3600);
        if (interval >= 1) return interval + (interval === 1 ? ' hour ago' : ' hours ago');
        interval = Math.floor(seconds / 60);
        if (interval >= 1) return interval + (interval === 1 ? ' minute ago' : ' minutes ago');
        return 'Just now';
    }
};

// --- KEY & CACHE MANAGERS ---
const KeyManager = {
    getKey: () => localStorage.getItem(CONFIG.STORAGE_KEY) || '',
    setKey: (key) => { localStorage.setItem(CONFIG.STORAGE_KEY, key.trim()); CacheManager.clearAll(); UI.updateStatusBadge(); },
    clearKey: () => { localStorage.removeItem(CONFIG.STORAGE_KEY); CacheManager.clearAll(); UI.updateStatusBadge(); UI.showModalMessage('Cleared.', 'info'); document.getElementById('apiKeyInput').value = ''; },
    saveKeyFromUI: () => {
        const input = document.getElementById('apiKeyInput').value.trim();
        if (!input) return UI.showModalMessage('Enter valid key.', 'error');
        KeyManager.setKey(input);
        UI.showModalMessage('Saved! Reloading...', 'success');
        setTimeout(() => { UI.closeModal(); UI.loadHome(); }, 1200);
    }
};

// --- CACHE & LIBRARY MANAGERS ---
const CacheManager = {
    set: (key, data, ttl) => localStorage.setItem(key, JSON.stringify({ data, expiry: Date.now() + ttl })),
    get: (key) => {
        const itemStr = localStorage.getItem(key);
        if (!itemStr) return null;
        try {
            const item = JSON.parse(itemStr);
            if (Date.now() > item.expiry) { localStorage.removeItem(key); return null; }
            return item.data;
        } catch { return null; }
    },
    clearAll: () => Object.keys(localStorage).forEach(k => { if (k.startsWith('yt_')) localStorage.removeItem(k); })
};

// --- LIBRARY MANAGER ---
const LibraryManager = {
    saveToHistory: (videoObj) => {
        let history = JSON.parse(localStorage.getItem('yt_history') || '[]');
        history = history.filter(v => v.id !== videoObj.id);
        history.unshift(videoObj);
        if (history.length > 50) history.pop();
        localStorage.setItem('yt_history', JSON.stringify(history));
    },
    getHistory: () => JSON.parse(localStorage.getItem('yt_history') || '[]'),
    toggleSaved: (videoObj) => {
        let saved = JSON.parse(localStorage.getItem('yt_saved') || '[]');
        const exists = saved.find(v => v.id === videoObj.id);
        if (exists) saved = saved.filter(v => v.id !== videoObj.id);
        else saved.unshift(videoObj);
        localStorage.setItem('yt_saved', JSON.stringify(saved));
        return !exists;
    },
    isSaved: (videoId) => JSON.parse(localStorage.getItem('yt_saved') || '[]').some(v => v.id === videoId),
    getSaved: () => JSON.parse(localStorage.getItem('yt_saved') || '[]')
};

// --- YOUTUBE API SERVICE ---
const YouTubeAPI = {
    async fetchWithKey(endpoint) {
        const apiKey = KeyManager.getKey();
        if (!apiKey) { UI.promptForKey('No authorization token found.'); return null; }
        const res = await fetch(`${CONFIG.BASE_URL}${endpoint}&key=${apiKey}`);
        const data = await res.json();
        if (!res.ok) {
            if (res.status === 400 || res.status === 403) UI.promptForKey(`API Error: ${data.error?.message}`);
            throw new Error(data.error?.message);
        }
        return data;
    },

    // Single-batch API enrichment call (Saves API Quota)
    async enrichVideoDetails(items) {
        if (!items || items.length === 0) return [];
        const videoIds = items.map(item => typeof item.id === 'object' ? item.id.videoId : item.id).filter(Boolean);
        if (videoIds.length === 0) return items;

        try {
            const data = await this.fetchWithKey(`/videos?part=snippet,statistics&id=${videoIds.join(',')}`);
            if (data && data.items) {
                const detailsMap = new Map(data.items.map(v => [v.id, v]));
                return items.map(item => {
                    const id = typeof item.id === 'object' ? item.id.videoId : item.id;
                    const fullDetails = detailsMap.get(id);
                    return {
                        id: id,
                        snippet: fullDetails?.snippet || item.snippet,
                        statistics: fullDetails?.statistics || {}
                    };
                });
            }
        } catch (e) {
            console.error('Error enriching video stats:', e);
        }
        return items;
    },

    async search(query, isLive = false, regionCode = 'IN') {
        if (!query) return [];
        const cacheKey = `yt_search_${query.replace(/\s+/g, '').toLowerCase()}_${isLive}_${regionCode}_v3`;
        const cached = CacheManager.get(cacheKey);
        if (cached) return cached;

        try {
            let endpoint = `/search?part=snippet&q=${encodeURIComponent(query)}&type=video&safeSearch=moderate&regionCode=${regionCode}&maxResults=24`;
            if (isLive) endpoint += '&eventType=live';

            const data = await this.fetchWithKey(endpoint);
            if (data && data.items) {
                const enrichedItems = await this.enrichVideoDetails(data.items);
                CacheManager.set(cacheKey, enrichedItems, CONFIG.CACHE_EXPIRY.SEARCH);
                return enrichedItems;
            }
            return [];
        } catch (error) { return []; }
    }
};

// --- UI CONTROLLER ---
const UI = {
    grid: document.getElementById('videoGrid'),
    playerView: document.getElementById('playerView'),
    loader: document.getElementById('loader'),
    searchInput: document.getElementById('searchInput'),
    title: document.getElementById('pageTitle'),
    currentVideoObj: null,
    currentActiveFeed: 'home', // Track current active section for feed refreshes

    modal: document.getElementById('apiKeyModal'),
    modalMsg: document.getElementById('modalMessage'),
    statusBadge: document.getElementById('keyStatusBadge'),

    updateStatusBadge() { this.statusBadge.className = `w-2 h-2 rounded-full ${KeyManager.getKey() ? 'bg-green-500' : 'bg-red-500'}`; },
    openModal() { document.getElementById('apiKeyInput').value = KeyManager.getKey(); this.modalMsg.classList.add('hidden'); this.modal.classList.remove('hidden'); this.modal.classList.add('flex'); },
    closeModal() { this.modal.classList.add('hidden'); this.modal.classList.remove('flex'); },
    showModalMessage(msg, type) {
        this.modalMsg.textContent = msg;
        this.modalMsg.className = `text-xs py-2 px-3 rounded-lg mt-2 ${type === 'error' ? 'bg-red-900/50 text-red-300' : type === 'success' ? 'bg-green-900/50 text-green-300' : 'bg-blue-900/50 text-blue-300'}`;
    },
    promptForKey(reason) { this.showLoader(false); this.openModal(); this.showModalMessage(reason, 'error'); },

    showLoader(show) { this.loader.classList.toggle('hidden', !show); if (show) this.grid.innerHTML = ''; },
    setActiveMenu(id) {
        document.querySelectorAll('.nav-link').forEach(el => {
            el.classList.remove('bg-gray-800', 'text-red-500');
            el.classList.add('text-gray-400');
        });
        const active = document.getElementById(id);
        if (active) {
            active.classList.remove('text-gray-400');
            active.classList.add('bg-gray-800', 'text-red-500');
        }

        const sidebar = document.getElementById('sidebar');
        if (sidebar && window.innerWidth < 768) {
            sidebar.classList.add('hidden');
        }
    },

    // Refresh active feed (called during hourly location checks)
    refreshCurrentFeed() {
        switch (this.currentActiveFeed) {
            case 'home': this.loadHome(); break;
            case 'trending': this.loadTrending(); break;
            case 'music': this.loadMusic(); break;
            case 'explore': this.loadExplore(); break;
            case 'newslive': this.loadNewslive(); break;
            default: break;
        }
    },

    // CITY-BASED HOME SECTION
    async loadHome() {
        this.currentActiveFeed = 'home';
        this.setActiveMenu('nav-home');
        const loc = await GeoService.getUserLocation();
        this.resetView(`Recommended For You <span class="text-sm font-normal text-gray-500 ml-2">(${loc.city}, ${loc.name})</span>`);
        
        // Custom search query targeting user's specific city
        const videos = await YouTubeAPI.search(`${loc.city} top trending videos`, false, loc.code);
        this.renderGrid(videos);
    },

    // CITY-BASED TRENDING SECTION
    async loadTrending() {
        this.currentActiveFeed = 'trending';
        this.setActiveMenu('nav-trending');
        const loc = await GeoService.getUserLocation();
        this.resetView(`Trending in ${loc.city}`);
        
        const videos = await YouTubeAPI.search(`Trending today in ${loc.city}`, false, loc.code);
        this.renderGrid(videos);
    },

    async loadMusic() {
        this.currentActiveFeed = 'music';
        this.setActiveMenu('nav-music');
        this.resetView(`Trending Music`);
        const videos = await YouTubeAPI.search('Trending tamil music video songs this week');
        this.renderGrid(videos);
    },

    // CITY-BASED EXPLORE SECTION
    async loadExplore() {
        this.currentActiveFeed = 'explore';
        this.setActiveMenu('nav-explore');
        const loc = await GeoService.getUserLocation();
        this.resetView(`Explore ${loc.city}`);
        
        const videos = await YouTubeAPI.search(`Explore ${loc.city} travel culture news technology`, false, loc.code);
        this.renderGrid(videos);
    },

    async loadNewslive() {
        this.currentActiveFeed = 'newslive';
        this.setActiveMenu('nav-newslive');
        this.resetView(`<span class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-red-500 animate-pulse"></span> Latest news </span>`);
        
        const videos = await YouTubeAPI.search(`Latest tamil news live today`);
        this.renderGrid(videos);
    },

    loadHistory() {
        this.currentActiveFeed = 'history';
        this.setActiveMenu('nav-history');
        this.resetView('Watch History');
        this.renderGrid(LibraryManager.getHistory(), true);
    },
    loadSaved() {
        this.currentActiveFeed = 'saved';
        this.setActiveMenu('nav-saved');
        this.resetView('Saved to Library');
        this.renderGrid(LibraryManager.getSaved(), true);
    },
    async handleSearch(query) {
        this.currentActiveFeed = 'search';
        this.setActiveMenu('');
        this.resetView(`Search Results for "${query}"`);
        const isLiveQuery = query.toLowerCase().includes('live');
        const loc = await GeoService.getUserLocation();
        const videos = await YouTubeAPI.search(query, isLiveQuery, loc.code);
        this.renderGrid(videos);
    },

    resetView(titleHTML) {
        this.playerView.classList.add('hidden');
        this.grid.classList.remove('hidden');
        this.title.innerHTML = titleHTML;
        this.title.classList.remove('hidden');
        this.showLoader(true);
        window.scrollTo({ top: 0 });
    },

    renderGrid(videos, isLibraryFormat = false) {
        this.showLoader(false);
        this.grid.innerHTML = '';

        if (!videos || videos.length === 0) {
            this.grid.innerHTML = `<div class="col-span-full text-center text-gray-500 py-16"><p>No playable videos found for this category.</p></div>`;
            return;
        }

        videos.forEach(video => {
            const videoId = typeof video.id === 'object' ? video.id.videoId : video.id;
            const snippet = video.snippet || {};
            const stats = video.statistics || {};

            const thumbnailUrl = snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || 'https://via.placeholder.com/640x360.png?text=No+Image';
            const isLive = snippet.liveBroadcastContent === 'live';
            const liveBadgeHTML = isLive ? `<div class="absolute bottom-2 right-2 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide flex items-center gap-1"><span class="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>Live</div>` : '';

            const formattedViews = Formatters.views(stats.viewCount);
            const formattedDate = Formatters.date(snippet.publishedAt);
            const metaInfoText = isLive ? 'Live Streaming' : `${formattedViews} • ${formattedDate}`;

            const card = document.createElement('div');
            card.className = 'video-card group cursor-pointer flex flex-col gap-3';
            card.onclick = () => this.openPlayer(video);

            card.innerHTML = `
                <div class="thumbnail-wrapper relative w-full aspect-video bg-gray-800 rounded-xl overflow-hidden">
                    <img src="${thumbnailUrl}" class="thumbnail-img w-full h-full object-cover" onload="this.classList.add('loaded')">
                    <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all"></div>
                    ${liveBadgeHTML}
                </div>
                <div class="flex gap-3 px-1">
                    <div class="flex-1 min-w-0">
                        <h3 class="text-sm font-semibold text-white line-clamp-2 leading-snug group-hover:text-red-400 transition-colors">${snippet.title || 'Untitled'}</h3>
                        <p class="text-xs text-gray-400 mt-1 hover:text-white transition">${snippet.channelTitle || ''}</p>
                        <p class="text-[11px] text-gray-500 mt-0.5">${metaInfoText}</p>
                    </div>
                </div>`;
            this.grid.appendChild(card);
        });
    },

    openPlayer(videoObj) {
        const bgAudio = document.getElementById('bgAudio');
        if (bgAudio) {
            bgAudio.play().catch(e => console.log('Silent audio playback start:', e));
        }

        this.grid.classList.add('hidden');
        this.title.classList.add('hidden');
        this.playerView.classList.remove('hidden');

        const nowPlayingMenu = document.getElementById('nav-now-playing-container');
        if (nowPlayingMenu) nowPlayingMenu.classList.remove('hidden');
        this.setActiveMenu('nav-now-playing');

        const videoId = typeof videoObj.id === 'object' ? videoObj.id.videoId : videoObj.id;
        const snippet = videoObj.snippet || {};
        const stats = videoObj.statistics || {};

        this.currentVideoObj = { id: videoId, snippet, statistics: stats };
        LibraryManager.saveToHistory(this.currentVideoObj);
        this.updateSaveButtonUI(LibraryManager.isSaved(videoId));

        const currentOrigin = (window.location.hostname === '' || window.location.hostname === 'localhost') ? 'https://localhost' : window.location.origin;

        if (ytPlayer) {
            ytPlayer.loadVideoById(videoId);
        } else {
            ytPlayer = new YT.Player('videoPlayer', {
                host: 'https://www.youtube-nocookie.com',
                videoId: videoId,
                playerVars: {
                    'autoplay': 1,
                    'playsinline': 1,
                    'enablejsapi': 1,
                    'rel': 0,
                    'modestbranding': 1,
                    'iv_load_policy': 3,
                    'origin': currentOrigin
                },
                events: {
                    'onStateChange': this.onPlayerStateChange
                }
            });
        }

        document.getElementById('videoTitle').textContent = snippet.title || 'Untitled';
        document.getElementById('videoChannel').textContent = snippet.channelTitle || 'Unknown Channel';
        document.getElementById('videoViews').textContent = Formatters.views(stats.viewCount);
        document.getElementById('videoDate').textContent = Formatters.date(snippet.publishedAt);
        document.getElementById('videoLikes').textContent = Formatters.likes(stats.likeCount);

        document.getElementById('contentArea').scrollTo({ top: 0, behavior: 'smooth' });

        this.setupMediaSession(snippet);
    },

    setupMediaSession(snippet) {
        if (!('mediaSession' in navigator)) return;

        navigator.mediaSession.metadata = new MediaMetadata({
            title: snippet.title || 'Untitled',
            artist: snippet.channelTitle || 'Unknown Channel',
            artwork: [
                {
                    src: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || 'https://via.placeholder.com/640x360.png',
                    sizes: '480x360',
                    type: 'image/jpeg'
                }
            ]
        });

        navigator.mediaSession.setActionHandler('play', async () => {
            const bgAudio = document.getElementById('bgAudio');
            if (bgAudio) await bgAudio.play().catch(() => {});
            if (ytPlayer && ytPlayer.playVideo) ytPlayer.playVideo();
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
            const bgAudio = document.getElementById('bgAudio');
            if (bgAudio) bgAudio.pause();
        });

        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            if (ytPlayer && ytPlayer.getCurrentTime) {
                const skipTime = details.seekOffset || 10;
                ytPlayer.seekTo(Math.max(ytPlayer.getCurrentTime() - skipTime, 0), true);
            }
        });

        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            if (ytPlayer && ytPlayer.getCurrentTime) {
                const skipTime = details.seekOffset || 10;
                ytPlayer.seekTo(ytPlayer.getCurrentTime() + skipTime, true);
            }
        });
    },

    onPlayerStateChange(event) {
        const bgAudio = document.getElementById('bgAudio');
        if (event.data === 1) {
            if (bgAudio && bgAudio.paused) bgAudio.play().catch(() => {});
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
        } else if (event.data === 2 || event.data === 0) {
            if (bgAudio) bgAudio.pause();
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
        }
    },

    showNowPlaying() {
        if (!this.currentVideoObj) return;
        this.setActiveMenu('nav-now-playing');
        this.grid.classList.add('hidden');
        this.title.classList.add('hidden');
        this.playerView.classList.remove('hidden');
    },

    minimisePlayer() {
        this.playerView.classList.add('hidden');
        this.grid.classList.remove('hidden');
        this.title.classList.remove('hidden');
        
        const nowPlayingMenu = document.getElementById('nav-now-playing-container');
        if (nowPlayingMenu) nowPlayingMenu.classList.remove('hidden');
    },

    closePlayer() {
        if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();

        const bgAudio = document.getElementById('bgAudio');
        if (bgAudio) bgAudio.pause();

        this.playerView.classList.add('hidden');
        this.grid.classList.remove('hidden');
        this.title.classList.remove('hidden');
        this.currentVideoObj = null;

        const nowPlayingMenu = document.getElementById('nav-now-playing-container');
        if (nowPlayingMenu) nowPlayingMenu.classList.add('hidden');

        if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    },

    toggleSaveCurrentVideo() {
        if (!this.currentVideoObj) return;
        const isNowSaved = LibraryManager.toggleSaved(this.currentVideoObj);
        this.updateSaveButtonUI(isNowSaved);
    },

    updateSaveButtonUI(isSaved) {
        const btn = document.getElementById('saveBtn');
        if (isSaved) {
            btn.innerHTML = `<i class="fa-solid fa-bookmark text-red-500"></i> <span class="text-red-500">Saved</span>`;
            btn.classList.add('border-red-500');
        } else {
            btn.innerHTML = `<i class="fa-regular fa-bookmark"></i> <span>Save</span>`;
            btn.classList.remove('border-red-500');
        }
    }
};

// --- VISIBILITY & BACKGROUND RESUMPTION ---
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        const bgAudio = document.getElementById('bgAudio');
        if (ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
            if (ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
                setTimeout(() => {
                    if (bgAudio) bgAudio.play().catch(() => {});
                    if (ytPlayer && ytPlayer.playVideo) ytPlayer.playVideo();
                }, 150);
            }
        }
    }
});

// --- FULLSCREEN ORIENTATION HANDLER ---
const handleFullscreenChange = async () => {
    const isFullscreen = document.fullscreenElement || 
                         document.webkitFullscreenElement || 
                         document.mozFullScreenElement || 
                         document.msFullscreenElement;

    if (isFullscreen) {
        if (screen.orientation && screen.orientation.lock) {
            try {
                await screen.orientation.lock('landscape');
            } catch (error) {
                console.warn('Orientation lock unsupported:', error);
            }
        }
    } else {
        if (screen.orientation && screen.orientation.unlock) {
            try {
                screen.orientation.unlock();
            } catch (error) {
                console.warn('Orientation unlock failed:', error);
            }
        }
    }
};

document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
document.addEventListener('mozfullscreenchange', handleFullscreenChange);
document.addEventListener('MSFullscreenChange', handleFullscreenChange);

let searchTimeout;
UI.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    searchTimeout = setTimeout(() => {
        if (query.length > 2) UI.handleSearch(query);
        else if (query.length === 0) UI.loadHome();
    }, 800);
});

// INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
    UI.updateStatusBadge();
    
    // Start hourly IP check interval
    GeoService.startHourlyIPCheck();

    if (!KeyManager.getKey()) UI.openModal();
    else UI.loadHome();
});
