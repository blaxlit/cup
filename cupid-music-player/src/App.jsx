import { useCallback, useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './App.css';
import useAudioPlayer from './useAudioPlayer';
import useSpotifyPlayer from './useSpotifyPlayer'; // We still need this hook for streaming YouTube!
import useTheme from './useTheme';
import {
  login as youtubeLogin,
  logout as youtubeLogout,
  isLoggedIn as isYouTubeLoggedIn,
  isConfigured as isYouTubeConfigured,
} from './youtube/auth.js';
import {
  parsePlaylistUrl as parseYouTubePlaylistUrl,
  fetchPlaylistByUrl as fetchYouTubePlaylistByUrl,
  fetchMyPlaylists as fetchYouTubePlaylists,
  fetchPlaylistTracks as fetchYouTubeTracks,
} from './youtube/api.js';

import progressBarStars from '../assets/progress_bar_stars.png';
import star from '../assets/star.png';
import starSelected from '../assets/star_selected.png';

function useResize(corner) {
  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    let lastX = e.screenX;
    let lastY = e.screenY;

    const onMouseMove = (e) => {
      const dx = e.screenX - lastX;
      const dy = e.screenY - lastY;
      lastX = e.screenX;
      lastY = e.screenY;
      window.cupid?.resize({ dx, dy, corner });
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [corner]);

  return onMouseDown;
}

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function SettingsDropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    const updateRect = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setMenuRect({ top: r.bottom, left: r.left, width: r.width });
    };
    updateRect();

    const onMouseDown = (e) => {
      if (!triggerRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', () => setOpen(false), true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', updateRect);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className={`settings-dropdown ${open ? 'open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="settings-dropdown-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current?.label ?? value}</span>
        <span className="settings-dropdown-chevron" aria-hidden="true">▾</span>
      </button>
      {open && menuRect && createPortal(
        <div
          ref={menuRef}
          className="settings-dropdown-menu"
          role="listbox"
          style={{
            position: 'fixed',
            top: `${menuRect.top + 2}px`,
            left: `${menuRect.left}px`,
            width: `${menuRect.width}px`,
          }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`settings-dropdown-item ${o.value === value ? 'active' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>,
        document.querySelector('.player') ?? document.body,
      )}
    </div>
  );
}

function PlaylistList({ loading, playlists, loadingPlaylist, onSelect, emptyMessage = 'no playlists found' }) {
  return (
    <div className="settings-playlist-list">
      {loading ? (
        <div className="settings-label">loading...</div>
      ) : playlists.length === 0 ? (
        <div className="settings-label">{emptyMessage}</div>
      ) : (
        playlists.map((p) => (
          <button
            key={p.id}
            className={`settings-playlist-item ${loadingPlaylist ? 'disabled' : ''}`}
            onClick={() => onSelect(p.id)}
            disabled={loadingPlaylist}
          >
            {p.name}
          </button>
        ))
      )}
    </div>
  );
}

function MarqueeText({ className, text }) {
  const outerRef = useRef(null);
  const textRef = useRef(null);
  const [shouldScroll, setShouldScroll] = useState(false);

  useEffect(() => {
    const outer = outerRef.current;
    const textEl = textRef.current;
    if (!outer || !textEl) return;
    setShouldScroll(textEl.offsetWidth > outer.clientWidth);
  }, [text]);

  return (
    <div className={`${className} marquee-container`} ref={outerRef}>
      <span ref={textRef} className="marquee-measure">{text}</span>
      <span className={shouldScroll ? 'marquee-scroll' : ''}>
        {text}
        {shouldScroll && <span className="marquee-gap">{text}</span>}
      </span>
    </div>
  );
}

export default function App() {
  const [source, setSource] = useState('local'); 
  const [youtubeConnected, setYoutubeConnected] = useState(isYouTubeLoggedIn());
  const [youtubeLoggingIn, setYoutubeLoggingIn] = useState(false);
  const [youtubeUrlInput, setYoutubeUrlInput] = useState('');
  const [streamTracks, setStreamTracks] = useState([]);
  const [youtubePlaylists, setYoutubePlaylists] = useState([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);
  const [settingsError, setSettingsError] = useState(null);
  const [addingSong, setAddingSong] = useState(false);
  const [newSongTitle, setNewSongTitle] = useState('');
  const [newSongArtist, setNewSongArtist] = useState('');
  const [newSongArt, setNewSongArt] = useState('');
  const [showSongMenu, setShowSongMenu] = useState(false);
  const [isMiniMode, setIsMiniMode] = useState(false);
  
  // EDIT FIX: Save the explicit filename we are editing so it NEVER overwrites the wrong song
  const [editingFilename, setEditingFilename] = useState(null); 
  const [isEditingCurrent, setIsEditingCurrent] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editArtist, setEditArtist] = useState('');

  const [musicService, setMusicService] = useState(() => {
    try {
      const stored = localStorage.getItem('cupid-player-music-service');
      if (stored === 'youtube' || stored === 'local') return stored;
    } catch { }
    return 'local';
  }); 
  
  const [playMode, setPlayMode] = useState('normal'); 
  const [volumeHovered, setVolumeHovered] = useState(false);
  const [volumeDragging, setVolumeDragging] = useState(false);
  const volumeBarRef = useRef(null);
  const [showDebug] = useState(false);
  const [localTracks, setLocalTracks] = useState([]);

  const loadLocalPlaylist = useCallback(async () => {
    if (!window.cupid?.getLocalPlaylist) return;
    try {
      const tracks = await window.cupid.getLocalPlaylist();
      setLocalTracks(Array.isArray(tracks) ? tracks : []);
    } catch (err) {
      console.error('Failed to load local playlist:', err);
    }
  }, []);

  useEffect(() => { loadLocalPlaylist(); }, [loadLocalPlaylist]);

  const local = useAudioPlayer(localTracks, playMode, window.cupid?.getLocalAudioPath);
  const streaming = useSpotifyPlayer(streamTracks, playMode); // Handles YouTube Streams
  const player = source === 'streaming' ? streaming : local;

  useEffect(() => {
    if (source === 'streaming') {
      if (local.isPlaying && local.pause) local.pause();
    } else {
      if (streaming.isPlaying && streaming.pause) streaming.pause();
    }
  }, [source]);

  const {
    track,
    isPlaying,
    progress,
    duration,
    currentTime,
    togglePlay,
    next,
    prev,
    seek,
    volume,
    setVolume,
    muted,
    toggleMute,
  } = player;

  const cyclePlayMode = useCallback(() => {
    setPlayMode((m) => m === 'normal' ? 'shuffle' : m === 'shuffle' ? 'repeat' : 'normal');
  }, []);

  const loadYoutubePlaylists = useCallback((silent = false) => {
    setLoadingPlaylists(true);
    if (!silent) setSettingsError(null);
    fetchYouTubePlaylists()
      .then((p) => { setYoutubePlaylists(p); setSettingsError(null); })
      .catch((err) => { if (!silent) setSettingsError(err.message); })
      .finally(() => setLoadingPlaylists(false));
  }, []);

  const loadYoutubePlaylistFromUrl = useCallback(async (rawInput) => {
    setSettingsError(null);
    const parsed = parseYouTubePlaylistUrl(rawInput);
    if (!parsed) {
      setSettingsError('Not a recognised YouTube URL');
      return;
    }
    setLoadingPlaylist(true);
    try {
      const tracks = await fetchYouTubePlaylistByUrl(rawInput);
      if (tracks.length === 0) {
        setSettingsError('Playlist/Video is empty or private');
        return;
      }
      setStreamTracks(tracks);
      setSource('streaming');
      setYoutubeUrlInput('');
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setLoadingPlaylist(false);
    }
  }, []);

  useEffect(() => {
    if (isYouTubeLoggedIn()) loadYoutubePlaylists(true);
  }, []);

  const loadPlaylist = useCallback(async (id, service) => {
    setLoadingPlaylist(true);
    setSettingsError(null);
    try {
      const tracks = await fetchYouTubeTracks(id);
      if (tracks.length === 0) {
        setSettingsError('Playlist is empty');
        return;
      }
      setStreamTracks(tracks);
      setSource('streaming');
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setLoadingPlaylist(false);
    }
  }, []);

  const { theme, toggleTheme, assets } = useTheme();

  const [recordFrame, setRecordFrame] = useState(0);
  const [needleFrame, setNeedleFrame] = useState(0);
  const [isPink, setIsPink] = useState(theme === 'pink');
  const [swapping, setSwapping] = useState(false);
  const [needleLifted, setNeedleLifted] = useState(false);
  const [starHovered, setStarHovered] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hoverProgress, setHoverProgress] = useState(null);
  const seekRef = useRef(null);

  useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (e) => {
      const rect = seekRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      setHoverProgress(pct);
      seek(pct);
    };
    const onMouseUp = () => {
      setDragging(false);
      setStarHovered(false);
      setHoverProgress(null);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, seek]);

  useEffect(() => {
    if (!volumeDragging) return;
    const onMouseMove = (e) => {
      if (!volumeBarRef.current) return;
      const rect = volumeBarRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
      setVolume(pct);
    };
    const onMouseUp = () => {
      setVolumeDragging(false);
      setVolumeHovered(false);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [volumeDragging, setVolume]);

  const [needleChangeFrame, setNeedleChangeFrame] = useState(0);
  const prevTrackRef = useRef(null);

  const currentFrames = isPink ? assets.recordFramesA : assets.recordFramesB;
  const incomingFrames = isPink ? assets.recordFramesB : assets.recordFramesA;

  useEffect(() => {
    if (!isPlaying || swapping) return;
    const interval = setInterval(() => {
      setRecordFrame((f) => (f + 1) % currentFrames.length);
      setNeedleFrame((f) => (f + 1) % assets.needlePlayFrames.length);
    }, 400);
    return () => clearInterval(interval);
  }, [isPlaying, swapping, currentFrames.length]);

  useEffect(() => {
    if (prevTrackRef.current === track.title) return;
    const wasInitialOrPlaceholder = prevTrackRef.current === null || prevTrackRef.current === 'No track';
    prevTrackRef.current = track.title;
    if (track.title === 'No track') return;
    if (wasInitialOrPlaceholder) return;
    if (needleLifted) return;

    setNeedleLifted(true);
    setNeedleChangeFrame(0);

    setTimeout(() => setNeedleChangeFrame(1), 200);
    setTimeout(() => setSwapping(true), 400);
    setTimeout(() => {
      setIsPink((p) => !p);
      setRecordFrame(0);
      setSwapping(false);
    }, 1000);

    setTimeout(() => {
      setNeedleChangeFrame(0);
      setNeedleLifted(false);
      setNeedleFrame(0);
    }, 1100);

  }, [track.title, needleLifted]);

 // Listen for physical keyboard media keys
  useEffect(() => {
    if (!window.cupid?.onMediaAction) return;
    
    const cleanup = window.cupid.onMediaAction((action) => {
      
      // 1. If looking at local files, control local audio
      if (musicService === 'local') {
        if (action === 'play-pause') togglePlay();
        if (action === 'next') next();
        if (action === 'prev') prev();
      } 
      
      // 2. If looking at YouTube, control the streaming player
      else if (musicService === 'youtube') {
        if (action === 'play-pause') spotifyTogglePlay(); 
        if (action === 'next') spotifyNext();
        if (action === 'prev') spotifyPrev();
      }
      
    });

    // Clean up the listener when the app refreshes
    return () => {
      if (cleanup) cleanup();
    };
  }, [musicService, togglePlay, next, prev]); // Add your stream functions to this array if React complains!

  const resizeTL = useResize('top-left');
  const resizeTR = useResize('top-right');
  const resizeBL = useResize('bottom-left');
  const resizeBR = useResize('bottom-right');

  return (
    <div className={`player ${theme === 'blue' ? 'theme-blue' : ''} ${isMiniMode ? 'mini-mode' : ''}`}>
      <img src={assets.frame} className="layer" alt="" draggable={false} />
      <div className="window-title">cupid player</div>

      <img src={assets.recordPlayer} className="record-player" alt="" draggable={false} />
      <img src={currentFrames[recordFrame]} className={`record-player ${swapping ? 'record-slide-out' : ''}`} alt="" draggable={false} />
      {swapping && (
        <img src={incomingFrames[0]} className="record-player record-slide-in" alt="" draggable={false} />
      )}
      <img src={needleLifted ? assets.needleChangeFrames[needleChangeFrame] : assets.needlePlayFrames[needleFrame]} className="record-player" alt="" draggable={false} />

      <img src={assets.frameNoBg} className="layer frame-overlay" alt="" draggable={false} />
      <img src={assets.plant} className="layer layer-ui" alt="" draggable={false} />
      <img src={assets.progressBar} className="layer layer-ui" alt="" draggable={false} />
      
      <img
        src={progressBarStars}
        className="layer layer-ui"
        alt=""
        draggable={false}
        style={{ clipPath: `inset(0 ${(1 - (131 + (hoverProgress ?? progress) * 226 + 10) / 512) * 100}% 0 0)` }}
      />
      
      <img
        src={starHovered ? starSelected : star}
        className={`layer layer-ui star-indicator ${starHovered ? 'star-hovered' : ''}`}
        alt=""
        draggable={false}
        style={{ transform: `translateX(calc(-3 / 306 * 100vw + ${(hoverProgress ?? progress) * (226 / 512) * 171.9}vw))` }}
      />

      <img src={assets.backwardsButton} className="layer layer-ui" alt="" draggable={false} />
      <img src={isPlaying ? assets.pauseButton : assets.playButton} className="layer layer-ui" alt="" draggable={false} />
      <img src={assets.forwardsButton} className="layer layer-ui" alt="" draggable={false} />

      <img src={muted ? assets.muteButton : assets.volumeButton} className="layer layer-ui" alt="" draggable={false} style={{ opacity: 0.8 }} />
      <img src={playMode === 'repeat' ? assets.repeatButton : assets.shuffleButton} className="layer layer-ui" alt="" draggable={false} style={{ opacity: playMode === 'normal' ? 0.4 : 0.8 }} />

      <img src={assets.minimizerButton} className="layer layer-ui" alt="" draggable={false} />
      <img src={assets.windowButton} className="layer layer-ui" alt="" draggable={false} />
      <img src={assets.exitButton} className="layer layer-ui" alt="" draggable={false} />
      <img src={assets.settings} className="layer layer-ui settings-layer" alt="" draggable={false} />

      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <clipPath id="album-mask" clipPathUnits="objectBoundingBox">
            <rect x="0.07317" y="0" width="0.85366" height="1" />
            <rect x="0.04878" y="0.02439" width="0.90244" height="0.95122" />
            <rect x="0.02439" y="0.04878" width="0.95122" height="0.90244" />
            <rect x="0" y="0.07317" width="1" height="0.85366" />
          </clipPath>
        </defs>
      </svg>

      {track.art && (
        <div className="album-mask">
          <img src={track.art} className="album-art" alt="" draggable={false} />
        </div>
      )}

      <img src={assets.albumFrame} className="layer album-frame-layer" alt="" draggable={false} />

      <div className="now-playing" style={{ pointerEvents: 'auto', zIndex: 50 }}>
        {isEditingCurrent ? (
          <div className="track-info" style={{ position: 'relative', width: '100%' }}>
            <input 
              className="settings-input" 
              style={{ width: '100%', marginBottom: '4px', fontSize: '12px', backgroundColor: 'rgba(10, 10, 10, 0.85)', color: '#ffffff', border: '1px solid #555' }} 
              value={editTitle} 
              onChange={(e) => setEditTitle(e.target.value)} 
            />
            <input 
              className="settings-input" 
              style={{ width: '100%', marginBottom: '4px', fontSize: '12px', backgroundColor: 'rgba(10, 10, 10, 0.85)', color: '#ffffff', border: '1px solid #555' }} 
              value={editArtist} 
              onChange={(e) => setEditArtist(e.target.value)} 
            />
            <div style={{ display: 'flex', gap: '5px', marginTop: '2px' }}>
              <button 
                className="btn-edit-action btn-edit-cancel" 
                onClick={() => setIsEditingCurrent(false)}
              >
                cancel
              </button>
              
<button 
        className="btn-mini-toggle"
        onClick={() => {
          const nextState = !isMiniMode;
          setIsMiniMode(nextState);
          window.cupid?.toggleMiniPlayer(nextState);
        }}
      >
        {isMiniMode ? 'max' : 'mini'}
      </button>

              <button 
                className="btn-edit-action btn-edit-save" 
                onClick={async () => {
                  // FIX: Safely use the locked editingFilename, so it NEVER overwrites the wrong song!
                  if (!editingFilename) return;
                  
                  const success = await window.cupid?.editLocalSong({
                    filename: editingFilename,
                    metadata: { title: editTitle, artist: editArtist }
                  });
                  
                  if (success) {
                    setIsEditingCurrent(false);
                    loadLocalPlaylist();
                  }
                }}
              >
                save
              </button>
            </div>
          </div>
        ) : (
          <div className="track-info" style={{ position: 'relative', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <div className="now-playing-label">now playing...</div>
              
              {source === 'local' && track.title !== 'No track' && (
                <button 
                  className="btn-song-menu"
                  onClick={() => setShowSongMenu((v) => !v)}
                >
                  ⋮
                </button>
              )}
            </div>
            
            <MarqueeText className="track-title" text={track.title} />
            <div className="track-artist">by {track.artist}</div>
        
            {showSongMenu && (
              <div style={{ position: 'absolute', right: '-5px', top: '15px', background: 'rgba(15, 15, 15, 0.95)', border: '1px solid #444', borderRadius: '4px', padding: '5px', zIndex: 999, display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '80px' }}>
                <button 
                  className="settings-playlist-item" 
                  style={{ textAlign: 'center', width: '100%' }}
                  onClick={() => { 
                    setShowSongMenu(false); 
                    setEditTitle(track.title); 
                    setEditArtist(track.artist);
                    
                    // FIX: Lock in the exact filename we are editing!
                    const currentFile = localTracks[local.trackIndex]?.file;
                    setEditingFilename(currentFile);
                    
                    setIsEditingCurrent(true); 
                  }}
                >
                  edit
                </button>
                <button 
                  className="settings-playlist-item" 
                  style={{ color: '#ff6b6b', textAlign: 'center', width: '100%' }} 
                  onClick={async () => {
                    const currentFile = localTracks[local.trackIndex]?.file;
                    if (!currentFile) return;
                    
                    const confirmDelete = window.confirm(`Delete ${track.title}?`);
                    if (confirmDelete) {
                      const success = await window.cupid?.deleteLocalSong(currentFile);
                      if (success) {
                        setShowSongMenu(false);
                        next(); 
                        setTimeout(() => loadLocalPlaylist(), 300); 
                      }
                    }
                  }}
                >
                  delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="time-display">
        <span className="time-current">{formatTime(currentTime)}</span>
        <span className="time-remaining">{formatTime(duration - currentTime)}</span>
      </div>

      <div className="drag-region" />
      <div className="resize-handle top-left" onMouseDown={resizeTL} />
      <div className="resize-handle top-right" onMouseDown={resizeTR} />
      <div className="resize-handle bottom-left" onMouseDown={resizeBL} />
      <div className="resize-handle bottom-right" onMouseDown={resizeBR} />

      <div
        className="progress-seek"
        ref={seekRef}
        onMouseEnter={() => setStarHovered(true)}
        onMouseLeave={() => { if (!dragging) { setStarHovered(false); } }}
        onMouseDown={(e) => {
          e.preventDefault();
          setDragging(true);
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          setHoverProgress(pct);
          seek(pct);
        }}
      />

      <div className="btn btn-prev" onClick={prev} />
      <div className="btn btn-play" onClick={togglePlay} />
      <div className="btn btn-next" onClick={next} />

      {(volumeHovered || volumeDragging) && (
        <>
          <img src={assets.volumeBarLow} className="layer layer-ui volume-bar-layer" alt="" draggable={false} />
          <img
            src={assets.volumeBarHigh}
            className="layer layer-ui volume-bar-layer"
            alt=""
            draggable={false}
            style={{ clipPath: `inset(${((1 - (muted ? 0 : volume)) * (420 - 338) / 512 + 338 / 512) * 100}% 0 0 0)` }}
          />
        </>
      )}

      <div
        className={`volume-hover-zone ${(volumeHovered || volumeDragging) ? 'expanded' : ''}`}
        onMouseLeave={() => { if (!volumeDragging) setVolumeHovered(false); }}
      >
        <div className="btn-volume-icon" onClick={toggleMute} onMouseEnter={() => setVolumeHovered(true)} />
        {(volumeHovered || volumeDragging) && (
          <div
            className="volume-bar-area"
            ref={volumeBarRef}
            onMouseDown={(e) => {
              e.preventDefault();
              setVolumeDragging(true);
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
              setVolume(pct);
            }}
          />
        )}
      </div>

     <div className="btn btn-playmode" onClick={cyclePlayMode} title={playMode} />
      <div className="btn btn-minimize" onClick={() => window.cupid?.minimize()} />
      <div className="btn btn-window" onClick={() => window.cupid?.maximize()} />
      <div className="btn btn-exit" onClick={() => window.cupid?.close()} />
      <div className="btn btn-settings" onClick={() => setShowSettings((v) => !v)} />

      {/* --- MINI TOGGLE BUTTON --- */}
      <button 
        className="btn-mini-toggle"
        onClick={() => {
          const nextState = !isMiniMode;
          setIsMiniMode(nextState);
          window.cupid?.toggleMiniPlayer(nextState);
        }}
      >
        {isMiniMode ? 'max' : 'mini'}
      </button>

      <button 
        className={`btn-queue ${showQueue ? 'active' : ''}`}
        onClick={() => setShowQueue(v => !v)}
      >
        queue
      </button>

      {showQueue && (
        <div className="queue-panel">
          <div className="queue-panel-inner">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="settings-label">up next</div>
              <button 
                onClick={() => setShowQueue(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--color-panel-text)', cursor: 'pointer', fontFamily: "'Rainyhearts', monospace", fontSize: 'calc(11 / 306 * 100vw)', padding: 0 }}
              >
                [x]
              </button>
            </div>
            
            <div className="settings-playlist-list queue-list">
              {source === 'local' ? localTracks.map((t, index) => (
                <button 
                  key={index} 
                  className={`settings-playlist-item ${local.trackIndex === index ? 'active' : ''}`}
                  onClick={() => local.playTrack?.(index)}
                >
                  {t.title} {t.artist ? `- ${t.artist}` : ''}
                </button>
              )) : streamTracks.map((t, index) => (
                 <button 
                  key={index} 
                  className={`settings-playlist-item ${streaming.trackIndex === index ? 'active' : ''}`}
                  onClick={() => streaming.playTrack?.(index)}
                >
                  {t.title} {t.artist ? `- ${t.artist}` : ''}
                </button>
              ))}
              
              {((source === 'local' && localTracks.length === 0) || (source === 'streaming' && streamTracks.length === 0)) && (
                <div className="settings-label" style={{ opacity: 0.5, marginTop: '5px' }}>queue is empty</div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {showSettings && (
        <div className="settings-panel">
          <div className="settings-panel-inner">
            <div className="settings-label">theme</div>
            <div className="settings-theme-row">
              <button className={`settings-theme-btn ${theme === 'pink' ? 'active' : ''}`} onClick={() => { if (theme !== 'pink') toggleTheme(); }}>
                pink
              </button>
              <button className={`settings-theme-btn ${theme === 'blue' ? 'active' : ''}`} onClick={() => { if (theme !== 'blue') toggleTheme(); }}>
                charcoal
              </button>
            </div>
            <div className="settings-label">music</div>
            <SettingsDropdown
              value={musicService}
              options={[
                { value: 'local', label: 'local' },
                { value: 'youtube', label: 'youtube' },
              ]}
              onChange={(next) => {
                setMusicService(next);
                try { localStorage.setItem('cupid-player-music-service', next); } catch { }
                if (next === 'local') setSource('local');
              }}
            />

            {musicService === 'local' && (
              !addingSong ? (
                <div className="settings-theme-row">
                  <button className="settings-theme-btn" onClick={loadLocalPlaylist}>
                    reload
                  </button>
                  <button className="settings-theme-btn" onClick={() => setAddingSong(true)}>
                    add song +
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <input 
                    className="settings-input" 
                    placeholder="Title (leave blank for filename)" 
                    value={newSongTitle} 
                    onChange={(e) => setNewSongTitle(e.target.value)} 
                  />
                  <input 
                    className="settings-input" 
                    placeholder="Artist" 
                    value={newSongArtist} 
                    onChange={(e) => setNewSongArtist(e.target.value)} 
                  />
                  <input 
                    className="settings-input" 
                    placeholder="Art URL (optional)" 
                    value={newSongArt} 
                    onChange={(e) => setNewSongArt(e.target.value)} 
                  />
                  <div className="settings-theme-row" style={{ marginTop: '5px' }}>
                    <button 
                      className="settings-theme-btn" 
                      onClick={() => {
                        setAddingSong(false);
                        setSettingsError(null);
                      }}
                    >
                      cancel
                    </button>
                    <button 
                      className="settings-theme-btn" 
                      onClick={async () => {
                        setSettingsError(null);
                        const success = await window.cupid?.addLocalSong({ 
                          title: newSongTitle.trim(), 
                          artist: newSongArtist.trim() || "Unknown Artist", 
                          art: newSongArt.trim() 
                        });

                        if (success) {
                          loadLocalPlaylist();
                          setAddingSong(false);
                          setNewSongTitle('');
                          setNewSongArtist('');
                          setNewSongArt('');
                        } else {
                          setSettingsError("Failed to add song. Did you pick a file?");
                        }
                      }}
                    >
                      pick file & save
                    </button>
                    <button 
                    className="settings-theme-btn"
                    style={{ fontSize: '10px', background: '#5e72e4', color: '#fff', marginTop: '5px' }}
                    onClick={async () => {
                      // Force the user to type a song name first
                      const searchTerm = newSongTitle.trim(); 
                      if (!searchTerm) {
                        setSettingsError("Please type a song name in the Title box first!");
                        return;
                      }
                      
                      setSettingsError("Searching iTunes..."); 
                      const data = await window.cupid?.fetchSongMetadata(searchTerm);
                      
                      if (data) {
                        setNewSongTitle(data.title);
                        setNewSongArtist(data.artist);
                        setNewSongArt(data.art);
                        setSettingsError(null); // Clear message on success
                      } else {
                        setSettingsError("Could not find metadata automatically!");
                      }
                    }}
                  >
                    magic tag ✨
                  </button>
                  </div>
                </div>
              )
            )}
            
            {musicService === 'youtube' && (
              isYouTubeConfigured() ? (
                !youtubeConnected ? (
                  <button
                    className={`settings-theme-btn ${youtubeLoggingIn ? 'disabled' : ''}`}
                    disabled={youtubeLoggingIn}
                    onClick={async () => {
                      setYoutubeLoggingIn(true);
                      setSettingsError(null);
                      try {
                        await youtubeLogin();
                        setYoutubeConnected(true);
                        loadYoutubePlaylists();
                      } catch (err) {
                        setSettingsError(err.message);
                      } finally {
                        setYoutubeLoggingIn(false);
                      }
                    }}
                  >
                    {youtubeLoggingIn ? 'waiting for browser...' : 'log in with google'}
                  </button>
                ) : (
                  <>
                    <PlaylistList
                      loading={loadingPlaylists}
                      playlists={youtubePlaylists}
                      loadingPlaylist={loadingPlaylist}
                      onSelect={(id) => loadPlaylist(id, 'youtube')}
                    />
                    <div className="settings-theme-row">
                      <button className={`settings-theme-btn ${loadingPlaylists ? 'disabled' : ''}`} disabled={loadingPlaylists} onClick={() => loadYoutubePlaylists()}>
                        refresh
                      </button>
                      <button className="settings-theme-btn" onClick={() => {
                        youtubeLogout();
                        setYoutubeConnected(false);
                        setYoutubePlaylists([]);
                        if (source === 'streaming') setSource('local');
                      }}>
                        logout
                      </button>
                    </div>
                  </>
                )
              ) : (
                <>
                  <input
                    className="settings-input"
                    type="text"
                    placeholder="paste a youtube video/playlist link"
                    value={youtubeUrlInput}
                    onChange={(e) => setYoutubeUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && youtubeUrlInput.trim()) {
                        loadYoutubePlaylistFromUrl(youtubeUrlInput.trim());
                      }
                    }}
                    disabled={loadingPlaylist}
                  />
                  <button
                    className={`settings-theme-btn ${loadingPlaylist || !youtubeUrlInput.trim() ? 'disabled' : ''}`}
                    onClick={() => loadYoutubePlaylistFromUrl(youtubeUrlInput.trim())}
                    disabled={loadingPlaylist || !youtubeUrlInput.trim()}
                  >
                    {loadingPlaylist ? 'loading...' : 'load link'}
                  </button>
                </>
              )
            )}

            {settingsError && <div className="settings-error">{settingsError}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

#fix